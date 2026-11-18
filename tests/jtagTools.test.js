import { describe, it, expect } from 'vitest';
import { analyzeSvf, formatSvfSummary, diffCells, changedPorts, filterPins, pinsToCsv, openocdChainConfig } from '../src/utils/jtagTools';

const SVF = `FREQUENCY 1000000 HZ;
SIR 6 TDI(09);
SDR 32 TDI(00000000) TDO(03628093) MASK(0FFFFFFF);
RUNTEST 1000 TCK;
RUNTEST IDLE 0.5 SEC MAXIMUM 2 SEC;
PIO (H);`;

describe('analyzeSvf', () => {
  it('counts bits, checks and run time', () => {
    const a = analyzeSvf(SVF);
    expect(a.statements).toBe(6);
    expect(a.sirBits).toBe(6);
    expect(a.sdrBits).toBe(32);
    expect(a.tdoChecks).toBe(1);
    expect(a.runtestClocks).toBe(1000);
    expect(a.runtestSeconds).toBe(0.5);
    expect(a.estSeconds).toBeCloseTo(1038 / 1e6 + 0.5, 6);
    expect(a.warnings.some((w) => w.includes('PIO'))).toBe(true);
    expect(formatSvfSummary(a)).toContain('6 statements');
  });
  it('reports parse errors instead of throwing', () => {
    expect(analyzeSvf('SIR 6 TDI(09)').error).toMatch(/without a ';'/);
  });
  it('flags unknown commands', () => {
    expect(analyzeSvf('FOO 1;').warnings[0]).toMatch(/unknown/);
  });
});

describe('boundary helpers', () => {
  const a = [{ port: 'LED', pins: ['12'], input: 0, output: 1, driving: true, outputCell: 2 }, { port: 'BTN', pins: ['13'], input: 0, output: null, driving: false }];
  const b = [{ ...a[0] }, { ...a[1], input: 1 }];
  it('diffs cells and ports', () => {
    expect(diffCells([0, 1, 1], [0, 0, 1, 1])).toEqual([1, 3]);
    expect([...changedPorts(a, b)]).toEqual(['BTN']);
  });
  it('filters by port or pin', () => {
    expect(filterPins(a, 'led')).toHaveLength(1);
    expect(filterPins(a, '13')[0].port).toBe('BTN');
    expect(filterPins(a, '')).toHaveLength(2);
  });
  it('writes CSV', () => {
    expect(pinsToCsv(a).split('\n')).toEqual(['port,pin,input,output,driving', 'LED,12,0,1,1', 'BTN,13,0,,']);
  });
});

describe('openocdChainConfig', () => {
  it('emits newtap lines and notes unknown IR lengths', () => {
    const t = openocdChainConfig([{ idcode: 0x03628093, irlen: 6 }, { idcode: 0x4ba00477, irlen: null }, { idcode: null }], [null, 4, undefined]);
    expect(t).toContain('jtag newtap chip tap0 -irlen 6 -expected-id 0x03628093');
    expect(t).toContain('jtag newtap chip tap1 -irlen 4 -expected-id 0x4ba00477');
    expect(t).toContain('# tap2: IR length unknown');
  });
});
