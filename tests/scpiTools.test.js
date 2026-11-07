import { describe, it, expect } from 'vitest';
import {
  parseIeeeBlock, buildIeeeBlock, imageMime, detectProfile, parsePreamble, fetchWaveform, waveformStats, waveformCsv,
  fetchScreenshot, parseNumber, presetsFor, dmmRead
} from '../src/utils/scpiTools';
import { UsbTmcDevice } from '../src/utils/usbtmcDriver';
import { createSimulatedUsbTmc } from './helpers/sim/usbtmc';

const enc = (s) => new TextEncoder().encode(s);

// An instrument that answers queries from a table and serves binary reads.
function fakeInst(answers) {
  const sent = [];
  let next = null;
  return {
    sent,
    async write(cmd) {
      sent.push(cmd);
      const a = answers[cmd];
      next = a === undefined ? null : typeof a === 'function' ? a() : a;
    },
    async read() { const r = next; next = null; return r instanceof Uint8Array ? r : enc(`${r ?? ''}\n`); },
    async query(cmd) { await this.write(cmd); return new TextDecoder().decode(await this.read()).trim(); }
  };
}

describe('IEEE 488.2 blocks', () => {
  it('parses definite and indefinite blocks, with or without a text header', () => {
    const data = Uint8Array.from([1, 2, 3, 0x0a, 0x23]);
    expect(Array.from(parseIeeeBlock(buildIeeeBlock(data)))).toEqual([1, 2, 3, 0x0a, 0x23]);
    expect(Array.from(parseIeeeBlock(Uint8Array.from([...enc('C1:WF DAT2,#9000000002'), 7, 8, 10, 10])))).toEqual([7, 8]);
    expect(Array.from(parseIeeeBlock(Uint8Array.from([...enc('#0'), 4, 5, 6, 10])))).toEqual([4, 5, 6]);
    expect(() => parseIeeeBlock(enc('#3100ab'))).toThrow(/cut short/);
    expect(() => parseIeeeBlock(enc('no block'))).toThrow(/No IEEE/);
  });

  it('sniffs image formats', () => {
    expect(imageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(imageMime(enc('BM....'))).toBe('image/bmp');
    expect(imageMime(enc('hello'))).toBeNull();
  });
});

describe('instrument identification', () => {
  it.each([
    ['RIGOL TECHNOLOGIES,DS1054Z,DS1ZA1234,00.04.04', 'rigol', 'scope'],
    ['KEYSIGHT TECHNOLOGIES,DSOX1204G,CN1234,02.12', 'keysight', 'scope'],
    ['Siglent Technologies,SDS1104X-E,SDSMMEBC1234,8.2.6.1.37R9', 'siglent', 'scope'],
    ['TEKTRONIX,TBS1052B,C010101,CF:91.1CT FV:v1.00', 'tek', 'scope'],
    ['Keysight Technologies,34461A,MY123,A.02.14', 'keysight', 'dmm'],
    ['Siglent Technologies,SPD3303X,SPD3X123,1.01', 'siglent', 'psu'],
    ['Rigol Technologies,DG1032Z,DG1Z123,00.01.12', 'rigol', 'awg'],
    ['ACME,Widget,1,1', 'generic', 'unknown']
  ])('%s', (idn, family, kind) => {
    expect(detectProfile(idn)).toMatchObject({ family, kind });
  });

  it('offers family-specific presets', () => {
    expect(presetsFor(detectProfile('Siglent Technologies,SPD3303X,1,1'))).toContain('OUTP CH1,ON');
    expect(presetsFor(detectProfile('RIGOL TECHNOLOGIES,DS1054Z,1,1'))).toContain(':SING');
    expect(presetsFor(detectProfile('x,y,z,w'))).toContain('*IDN?');
  });
});

describe('waveforms', () => {
  it('scales Rigol data with (code - YOR - YREF) * YINC', async () => {
    const inst = fakeInst({ ':WAV:PRE?': '0,0,4,1,1e-6,-2e-6,0,0.04,0,127', ':WAV:DATA?': buildIeeeBlock(Uint8Array.from([127, 152, 177, 102])) });
    const wf = await fetchWaveform(inst, { family: 'rigol' }, 2);
    expect(inst.sent).toContain(':WAV:SOUR CHAN2');
    expect(inst.sent).toContain(':WAV:MODE NORM');
    expect(Array.from(wf.volts).map((v) => +v.toFixed(3))).toEqual([0, 1, 2, -1]);
    expect(Array.from(wf.times).map((t) => +(t * 1e6).toFixed(3))).toEqual([-2, -1, 0, 1]);
  });

  it('scales Keysight data with (code - yref) * yinc + yorigin', async () => {
    const inst = fakeInst({ ':WAV:PRE?': '+0,+0,+3,+1,+2.0E-09,-1.0E-09,+0,+1.0E-02,+5.0E-01,+128', ':WAV:DATA?': buildIeeeBlock(Uint8Array.from([128, 228, 28])) });
    const wf = await fetchWaveform(inst, { family: 'keysight' }, 1, { points: 3 });
    expect(inst.sent).toContain(':WAV:POIN 3');
    expect(Array.from(wf.volts).map((v) => +v.toFixed(3))).toEqual([0.5, 1.5, -0.5]);
  });

  it('reads Siglent WF? DAT2 with signed codes and VDIV/25', async () => {
    const inst = fakeInst({
      'C1:VDIV?': 'C1:VDIV 1.00E+00V', 'C1:OFST?': 'C1:OFST 0.00E+00V', 'TDIV?': 'TDIV 1.00E-03S', 'SARA?': 'SARA 1.00E+06Sa/s',
      'C1:WF? DAT2': Uint8Array.from([...enc('C1:WF DAT2,#9000000003'), 25, 0, 231, 10, 10])
    });
    const wf = await fetchWaveform(inst, { family: 'siglent' }, 1);
    expect(Array.from(wf.volts)).toEqual([1, 0, -1]);
    expect(wf.xinc).toBeCloseTo(1e-6);
  });

  it('reads Tektronix CURVE? with WFMOUTPRE scaling', async () => {
    const inst = fakeInst({
      'WFMOUTPRE:XINCR?': '1.0E-6', 'WFMOUTPRE:XZERO?': '0', 'WFMOUTPRE:YMULT?': '0.04', 'WFMOUTPRE:YOFF?': '0', 'WFMOUTPRE:YZERO?': '0',
      'CURVE?': buildIeeeBlock(Uint8Array.from([25, 231]))
    });
    const wf = await fetchWaveform(inst, { family: 'tek' }, 1, { points: 2 });
    expect(Array.from(wf.volts).map((v) => +v.toFixed(2))).toEqual([1, -1]);
  });

  it('measures a sine', () => {
    const xinc = 1e-5;
    const volts = Float64Array.from({ length: 1000 }, (_, i) => 2 * Math.sin(2 * Math.PI * 1000 * i * xinc));
    const s = waveformStats(volts, xinc);
    expect(s.pp).toBeCloseTo(4, 1);
    expect(s.rms).toBeCloseTo(Math.SQRT2, 1);
    expect(s.freq).toBeCloseTo(1000, -1);
    expect(waveformCsv({ times: [0, 1e-5], volts: [0, 0.5] }).split('\n')[2]).toBe('1.000000e-5,0.500000');
  });

  it('rejects a bad preamble', () => {
    expect(() => parsePreamble('1,2,3')).toThrow(/Unexpected/);
  });
});

describe('screenshots and readings', () => {
  it('unwraps block-wrapped PNGs and raw Siglent BMPs', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    const ks = fakeInst({ ':DISP:DATA? PNG,COL': buildIeeeBlock(png) });
    expect(await fetchScreenshot(ks, { family: 'keysight' })).toEqual({ mime: 'image/png', data: png });
    const bmp = enc('BM rest of bitmap');
    const sg = fakeInst({ SCDP: bmp });
    expect((await fetchScreenshot(sg, { family: 'siglent' })).mime).toBe('image/bmp');
    await expect(fetchScreenshot(fakeInst({}), { family: 'tek' })).rejects.toThrow(/Tektronix/);
  });

  it('parses SCPI numbers and overloads', async () => {
    expect(parseNumber('+3.30012E+00')).toBeCloseTo(3.30012);
    expect(parseNumber('CH1:VOLT 12.5V')).toBe(12.5);
    expect(parseNumber('9.9E37')).toBe(Infinity);
    expect(parseNumber('n/a')).toBeNaN();
    expect(await dmmRead(fakeInst({ 'MEAS:RES?': '+1.000E+03' }), 'RES')).toBe(1000);
  });
});

describe('demo instrument end to end', () => {
  it('serves a waveform and a screenshot through USBTMC framing', async () => {
    const dev = new UsbTmcDevice(createSimulatedUsbTmc());
    await dev.open();
    const profile = detectProfile(await dev.identify());
    expect(profile.kind).toBe('scope');
    const wf = await fetchWaveform(dev, profile, 1);
    const stats = waveformStats(wf.volts, wf.xinc);
    expect(wf.points).toBe(1000);
    expect(stats.pp).toBeGreaterThan(3);
    expect(stats.freq).toBeCloseTo(1000, -1);
    const shot = await fetchScreenshot(dev, profile);
    expect(shot.mime).toBe('image/bmp');
  });
});
