/**
 * scpiTools.js — higher-level SCPI on top of a USBTMC instrument: IEEE 488.2
 * binary blocks, instrument family detection from *IDN?, waveform and
 * screenshot capture for common oscilloscopes, DMM readings and command presets.
 *
 * `inst` is anything with write(cmd), read() -> Uint8Array and query(cmd) -> string
 * (UsbTmcDevice, or a fake in tests).
 */

const td = new TextDecoder();

/** Extract the payload of an IEEE 488.2 block ("#<n><len><data>" or "#0<data>\n"), skipping any text header. */
export function parseIeeeBlock(bytes) {
  const start = bytes.indexOf(0x23); // '#'
  if (start < 0) throw new Error('No IEEE 488.2 block (#) in the response.');
  const n = bytes[start + 1] - 0x30;
  if (n < 0 || n > 9) throw new Error('Malformed block header.');
  if (n === 0) {
    let end = bytes.length;
    while (end > start + 2 && (bytes[end - 1] === 0x0a || bytes[end - 1] === 0x0d)) end--;
    return bytes.subarray(start + 2, end);
  }
  const len = Number(td.decode(bytes.subarray(start + 2, start + 2 + n)));
  const from = start + 2 + n;
  if (from + len > bytes.length) throw new Error(`Block is cut short: header says ${len} bytes, got ${bytes.length - from}.`);
  return bytes.subarray(from, from + len);
}

/** Build a block for tests and simulators. */
export function buildIeeeBlock(data) {
  const len = String(data.length);
  const head = new TextEncoder().encode(`#${len.length}${len}`);
  const out = new Uint8Array(head.length + data.length + 1);
  out.set(head);
  out.set(data, head.length);
  out[out.length - 1] = 0x0a;
  return out;
}

export function imageMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'image/bmp';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  return null;
}

// ---------------------------------------------------------------------------
// Instrument identification
// ---------------------------------------------------------------------------

/**
 * Work out what is connected from its *IDN? answer.
 * family selects the command dialect: rigol, keysight, siglent, tek or generic.
 */
export function detectProfile(idn) {
  const [maker = '', model = '', serial = '', firmware = ''] = String(idn).split(',').map((s) => s.trim());
  const m = model.toUpperCase();
  const v = maker.toUpperCase();
  let family = 'generic';
  if (/RIGOL/.test(v)) family = 'rigol';
  else if (/KEYSIGHT|AGILENT|HEWLETT/.test(v)) family = 'keysight';
  else if (/SIGLENT/.test(v)) family = 'siglent';
  else if (/TEKTRONIX/.test(v)) family = 'tek';
  let kind = 'unknown';
  if (/^(DS|MSO|DSO|TBS|TDS|SDS|DHO|MDO|DPO|EDUX|SIM-SCOPE)/.test(m) || /SCOPE/.test(m)) kind = 'scope';
  else if (/^(DM|SDM|344|34[0-9]{3}|U12|DMM)/.test(m) || /DMM|MULTIMETER/.test(m)) kind = 'dmm';
  else if (/^(DP|SPD|E36|DPS|PSU|SPS|N67)/.test(m) || /SUPPLY/.test(m)) kind = 'psu';
  else if (/^(DG|SDG|335|33[0-9]{3}|AFG)/.test(m)) kind = 'awg';
  return { maker, model, serial, firmware, family, kind };
}

// ---------------------------------------------------------------------------
// Waveforms
// ---------------------------------------------------------------------------

const nums = (text) => String(text).split(/[,;\s]+/).filter(Boolean).map(Number);

/** Parse the 10-field :WAV:PRE? answer used by Rigol and Keysight. */
export function parsePreamble(text) {
  const f = nums(text);
  if (f.length < 10 || f.some((x) => Number.isNaN(x))) throw new Error(`Unexpected waveform preamble: ${text}`);
  return { format: f[0], type: f[1], points: f[2], count: f[3], xinc: f[4], xorig: f[5], xref: f[6], yinc: f[7], yorig: f[8], yref: f[9] };
}

/**
 * Read one channel's displayed waveform.
 * Returns { times, volts, xinc, points, source, formula }.
 */
export async function fetchWaveform(inst, profile, channel = 1, { points = 1000 } = {}) {
  const fam = profile.family;
  if (fam === 'siglent') {
    const ch = `C${channel}`;
    const vdiv = parseNumber(await inst.query(`${ch}:VDIV?`));
    const ofst = parseNumber(await inst.query(`${ch}:OFST?`));
    const tdiv = parseNumber(await inst.query('TDIV?'));
    const sara = parseNumber(await inst.query('SARA?'));
    await inst.write(`${ch}:WF? DAT2`);
    const raw = parseIeeeBlock(await inst.read());
    const volts = new Float64Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      const code = raw[i] > 127 ? raw[i] - 256 : raw[i];
      volts[i] = code * (vdiv / 25) - ofst;
    }
    const xinc = 1 / sara;
    const t0 = -(tdiv * 14) / 2; // 14 horizontal divisions, trigger in the middle
    return { times: Float64Array.from(volts, (_, i) => t0 + i * xinc), volts, xinc, points: raw.length, source: ch, formula: 'code × VDIV/25 − OFST' };
  }
  if (fam === 'tek') {
    await inst.write(`DATA:SOURCE CH${channel}`);
    await inst.write('DATA:ENCDG RIBINARY');
    await inst.write('DATA:WIDTH 1');
    await inst.write('DATA:START 1');
    await inst.write(`DATA:STOP ${points}`);
    const g = async (q) => nums(await inst.query(q))[0];
    const xinc = await g('WFMOUTPRE:XINCR?');
    const xzero = await g('WFMOUTPRE:XZERO?');
    const ymult = await g('WFMOUTPRE:YMULT?');
    const yoff = await g('WFMOUTPRE:YOFF?');
    const yzero = await g('WFMOUTPRE:YZERO?');
    await inst.write('CURVE?');
    const raw = parseIeeeBlock(await inst.read());
    const volts = Float64Array.from(raw, (b) => ((b > 127 ? b - 256 : b) - yoff) * ymult + yzero);
    return { times: Float64Array.from(volts, (_, i) => xzero + i * xinc), volts, xinc, points: raw.length, source: `CH${channel}`, formula: '(code − YOFF) × YMULT + YZERO' };
  }
  // Rigol and Keysight / generic InfiniiVision-style.
  await inst.write(`:WAV:SOUR CHAN${channel}`);
  if (fam === 'rigol') await inst.write(':WAV:MODE NORM');
  else {
    await inst.write(':WAV:POIN:MODE NORM');
    await inst.write(`:WAV:POIN ${points}`);
    await inst.write(':WAV:UNS ON');
  }
  await inst.write(':WAV:FORM BYTE');
  const pre = parsePreamble(await inst.query(':WAV:PRE?'));
  await inst.write(':WAV:DATA?');
  const raw = parseIeeeBlock(await inst.read());
  const volts = new Float64Array(raw.length);
  // Rigol: (code − YORigin − YREFerence) × YINCrement. Keysight: (code − yref) × yinc + yorigin.
  if (fam === 'rigol') for (let i = 0; i < raw.length; i++) volts[i] = (raw[i] - pre.yorig - pre.yref) * pre.yinc;
  else for (let i = 0; i < raw.length; i++) volts[i] = (raw[i] - pre.yref) * pre.yinc + pre.yorig;
  const times = Float64Array.from(volts, (_, i) => (i - pre.xref) * pre.xinc + pre.xorig);
  return {
    times, volts, xinc: pre.xinc, points: raw.length, source: `CHAN${channel}`,
    formula: fam === 'rigol' ? '(code − YOR − YREF) × YINC' : '(code − YREF) × YINC + YOR'
  };
}

/** Peak-to-peak, mean, RMS and an estimate of frequency from mean crossings. */
export function waveformStats(volts, xinc) {
  const n = volts.length;
  if (!n) return null;
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sq = 0;
  for (const v of volts) { if (v < min) min = v; if (v > max) max = v; sum += v; sq += v * v; }
  const mean = sum / n;
  // Rising crossings of the mid level, with hysteresis so noise doesn't count.
  const mid = (min + max) / 2;
  const hyst = (max - min) * 0.1;
  const rises = [];
  let low = volts[0] < mid;
  for (let i = 1; i < n; i++) {
    if (low && volts[i] > mid + hyst) { rises.push(i); low = false; } else if (!low && volts[i] < mid - hyst) low = true;
  }
  const freq = rises.length >= 2 ? (rises.length - 1) / ((rises[rises.length - 1] - rises[0]) * xinc) : null;
  return { min, max, pp: max - min, mean, rms: Math.sqrt(sq / n), freq, periods: Math.max(0, rises.length - 1) };
}

export function waveformCsv(wf) {
  const rows = ['time_s,volts'];
  for (let i = 0; i < wf.volts.length; i++) rows.push(`${wf.times[i].toExponential(6)},${wf.volts[i].toPrecision(6)}`);
  return rows.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------

/** Grab the instrument's screen. Returns { mime, data }. */
export async function fetchScreenshot(inst, profile) {
  let raw;
  if (profile.family === 'siglent') {
    await inst.write('SCDP');
    raw = await inst.read();
  } else if (profile.family === 'rigol') {
    await inst.write(':DISP:DATA? ON,OFF,PNG');
    raw = await inst.read();
  } else if (profile.family === 'tek') {
    throw new Error('Tektronix scopes save screenshots to their own storage; use SAVE:IMAGE on the instrument.');
  } else {
    await inst.write(':DISP:DATA? PNG,COL');
    raw = await inst.read();
  }
  let data = imageMime(raw) ? raw : parseIeeeBlock(raw);
  const mime = imageMime(data);
  if (!mime) throw new Error('The instrument answered, but not with a PNG, BMP or JPEG image.');
  return { mime, data: Uint8Array.from(data) };
}

// ---------------------------------------------------------------------------
// DMM and presets
// ---------------------------------------------------------------------------

export const DMM_FUNCTIONS = [
  { id: 'VOLT:DC', label: 'DC voltage', unit: 'V' },
  { id: 'VOLT:AC', label: 'AC voltage', unit: 'V' },
  { id: 'CURR:DC', label: 'DC current', unit: 'A' },
  { id: 'CURR:AC', label: 'AC current', unit: 'A' },
  { id: 'RES', label: 'Resistance (2-wire)', unit: 'Ω' },
  { id: 'FRES', label: 'Resistance (4-wire)', unit: 'Ω' },
  { id: 'FREQ', label: 'Frequency', unit: 'Hz' },
  { id: 'CAP', label: 'Capacitance', unit: 'F' },
  { id: 'TEMP', label: 'Temperature', unit: '°C' }
];

/** First number in an answer like "+3.30012E+00" or "VOLT 3.3V". NaN when there is none. */
export function parseNumber(text) {
  // Drop a leading SCPI header such as "C1:VDIV " or "CH1:VOLT " first.
  const body = String(text).trim().replace(/^[A-Za-z*][\w:*?]*\s+/, '');
  const m = body.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
  const v = m ? Number(m[0]) : NaN;
  return Math.abs(v) >= 9.9e37 ? Infinity : v; // 9.9E37 is SCPI for overload
}

export async function dmmRead(inst, fnId) {
  return parseNumber(await inst.query(`MEAS:${fnId}?`));
}

export const PRESETS = {
  common: ['*IDN?', '*RST', '*CLS', '*OPC?', 'SYST:ERR?', '*TST?'],
  scope: {
    rigol: [':RUN', ':STOP', ':SING', ':AUT', ':TFOR', ':MEAS:ITEM? VPP,CHAN1', ':MEAS:ITEM? FREQ,CHAN1', ':CHAN1:SCAL?', ':TIM:SCAL?'],
    keysight: [':RUN', ':STOP', ':SING', ':AUT', ':TRIG:FORC', ':MEAS:VPP? CHAN1', ':MEAS:FREQ? CHAN1', ':CHAN1:SCAL?', ':TIM:SCAL?'],
    siglent: ['ARM', 'STOP', 'TRMD SINGLE', 'ASET', 'FRTR', 'C1:PAVA? PKPK', 'C1:PAVA? FREQ', 'C1:VDIV?', 'TDIV?'],
    tek: ['ACQUIRE:STATE RUN', 'ACQUIRE:STATE STOP', 'AUTOSET EXECUTE', 'TRIGGER FORCE', 'MEASUREMENT:IMMED:VALUE?', 'CH1:SCALE?', 'HORIZONTAL:SCALE?'],
    generic: [':RUN', ':STOP', ':SING', ':AUT', ':MEAS:VPP? CHAN1', ':MEAS:FREQ? CHAN1']
  },
  dmm: ['MEAS:VOLT:DC?', 'MEAS:VOLT:AC?', 'MEAS:CURR:DC?', 'MEAS:RES?', 'MEAS:FREQ?', 'READ?', 'CONF?'],
  psu: {
    rigol: [':APPL? CH1', ':APPL CH1,3.3,0.5', ':OUTP CH1,ON', ':OUTP CH1,OFF', ':MEAS:ALL? CH1'],
    siglent: ['CH1:VOLT 3.3', 'CH1:CURR 0.5', 'OUTP CH1,ON', 'OUTP CH1,OFF', 'MEAS:VOLT? CH1', 'MEAS:CURR? CH1'],
    generic: ['INST:NSEL 1', 'VOLT 3.3', 'CURR 0.5', 'OUTP ON', 'OUTP OFF', 'MEAS:VOLT?', 'MEAS:CURR?']
  },
  awg: {
    siglent: ['C1:BSWV WVTP,SINE,FRQ,1000,AMP,1', 'C1:OUTP ON', 'C1:OUTP OFF', 'C1:BSWV?'],
    rigol: [':SOUR1:APPL:SIN 1000,1,0,0', ':OUTP1 ON', ':OUTP1 OFF', ':SOUR1:APPL?'],
    generic: ['FUNC SIN', 'FREQ 1000', 'VOLT 1', 'OUTP ON', 'OUTP OFF', 'APPL?']
  }
};

export function presetsFor(profile) {
  const pick = (group) => (Array.isArray(group) ? group : group?.[profile.family] || group?.generic || []);
  return [...PRESETS.common, ...pick(PRESETS[profile.kind])];
}

// ---------------------------------------------------------------------------
// Simulated scope pieces
// ---------------------------------------------------------------------------

/** A 24-bit BMP of a sine trace, for the demo instrument's screenshot. */
export function demoScreenshotBmp(width = 160, height = 100) {
  const rowSize = (width * 3 + 3) & ~3;
  const size = 54 + rowSize * height;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true); dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, rowSize * height, true);
  const px = (x, y, r, g, bl) => { const o = 54 + (height - 1 - y) * rowSize + x * 3; b[o] = bl; b[o + 1] = g; b[o + 2] = r; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grid = x % 20 === 0 || y % 20 === 0;
    px(x, y, grid ? 40 : 0, grid ? 40 : 0, grid ? 40 : 10);
  }
  for (let x = 0; x < width; x++) {
    const y = Math.round(height / 2 - Math.sin((x / width) * Math.PI * 6) * height * 0.3);
    for (let t = -1; t <= 1; t++) if (y + t >= 0 && y + t < height) px(x, y + t, 250, 220, 0);
  }
  return b;
}

/** Bytes of a 1 kHz, 3.3 Vpp square-ish wave for the demo's :WAV:DATA?, with the matching preamble. */
export function demoWaveform(points = 1000) {
  const xinc = 5e-6;
  const yinc = 0.02;
  const yref = 20;
  const yorig = 0;
  const data = new Uint8Array(points);
  for (let i = 0; i < points; i++) {
    const t = i * xinc;
    const v = 1.65 + 1.65 * Math.tanh(8 * Math.sin(2 * Math.PI * 1000 * t)) + Math.sin(i * 1.7) * 0.03;
    data[i] = Math.max(0, Math.min(255, Math.round(v / yinc + yref)));
  }
  const preamble = `0,0,${points},1,${xinc},${-(points / 2) * xinc},0,${yinc},${yorig},${yref}`;
  return { data, preamble };
}
