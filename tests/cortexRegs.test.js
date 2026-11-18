import { describe, it, expect } from 'vitest';
import {
  decodeXpsr, formatXpsr, decodeSpecial, decodeCfsr, decodeHfsr, summariseFaults, decodeExcReturn,
  labelStackFrame, exceptionName, parseAddress, resolveWatch, formatMemoryRows, memoryDumpText, SCB
} from '../src/utils/cortexRegs';
import { CmsisDapClient } from '../src/utils/cmsisDapDriver';

describe('xPSR and special registers', () => {
  it('decodes flags, Thumb bit and exception number', () => {
    const d = decodeXpsr(0x61000003);
    expect(d).toMatchObject({ N: false, Z: true, C: true, V: false, thumb: true, exception: 3, mode: 'HardFault' });
    expect(formatXpsr(0x61000003)).toBe('nZCv HardFault');
    expect(formatXpsr(0x01000000)).toBe('nzcv Thread mode');
    expect(formatXpsr(0)).toContain('T bit clear');
  });
  it('names IRQs and unknown exceptions', () => {
    expect(exceptionName(16)).toBe('IRQ 0');
    expect(exceptionName(31)).toBe('IRQ 15');
    expect(exceptionName(15)).toBe('SysTick');
  });
  it('unpacks PRIMASK, BASEPRI, FAULTMASK and CONTROL', () => {
    const s = decodeSpecial(0x03_01_20_01 >>> 0);
    expect(s).toMatchObject({ primask: 1, basepri: 0x20, faultmask: 1, control: 3, privileged: false, stack: 'PSP' });
    expect(decodeSpecial(0)).toMatchObject({ privileged: true, stack: 'MSP' });
  });
});

describe('fault decoding', () => {
  it('decodes CFSR bits by group', () => {
    const items = decodeCfsr((1 << 25) | (1 << 9) | (1 << 15) | 2);
    expect(items.map((i) => i.name)).toEqual(['DACCVIOL', 'PRECISERR', 'BFARVALID', 'DIVBYZERO']);
    expect(items.find((i) => i.name === 'DIVBYZERO').group).toBe('UsageFault');
    expect(items.find((i) => i.name === 'PRECISERR').group).toBe('BusFault');
  });
  it('decodes HFSR', () => {
    expect(decodeHfsr(0x40000000).map((i) => i.name)).toEqual(['FORCED']);
    expect(decodeHfsr(0x80000002).map((i) => i.name)).toEqual(['VECTTBL', 'DEBUGEVT']);
    expect(decodeHfsr(0)).toEqual([]);
  });
  it('reports fault addresses only when marked valid', () => {
    const r = summariseFaults({ cfsr: 0x8200, hfsr: 0x40000000, mmfar: 0x1111, bfar: 0x40021000 });
    expect(r.faulted).toBe(true);
    expect(r.addresses).toEqual([{ name: 'BFAR', value: 0x40021000 }]);
    expect(r.lines.join('\n')).toContain('BFAR = 0x40021000');
    expect(r.lines.join('\n')).toContain('HFSR.FORCED');
    expect(r.lines.join('\n')).not.toContain('MMFAR');
  });
  it('says nothing faulted for zeros', () => {
    expect(summariseFaults({}).faulted).toBe(false);
  });
});

describe('exception frames', () => {
  it('reads EXC_RETURN', () => {
    expect(decodeExcReturn(0xfffffff9)).toMatchObject({ returnTo: 'Thread mode', stack: 'MSP', fpFrame: false });
    expect(decodeExcReturn(0xfffffffd)).toMatchObject({ returnTo: 'Thread mode', stack: 'PSP' });
    expect(decodeExcReturn(0xffffffe1)).toMatchObject({ returnTo: 'Handler mode', fpFrame: true });
    expect(decodeExcReturn(0x08001235)).toBeNull();
  });
  it('labels a basic frame', () => {
    const f = labelStackFrame([1, 2, 3, 4, 5, 6, 0x08000100, 0x01000000]);
    expect(f[6]).toEqual({ name: 'PC', value: 0x08000100 });
    expect(f).toHaveLength(8);
  });
});

describe('addresses and watch expressions', () => {
  const table = [{ name: 'counter', addr: 0x20000010 }, { name: 'main', addr: 0x08000100 }];
  it('parses addresses', () => {
    expect(parseAddress('0x20000000')).toBe(0x20000000);
    expect(parseAddress('4096')).toBe(4096);
    expect(parseAddress('DEADBEEF')).toBe(0xdeadbeef);
    expect(parseAddress('zzz')).toBeNull();
    expect(parseAddress('')).toBeNull();
  });
  it('resolves symbols with offsets', () => {
    expect(resolveWatch('counter', table)).toBe(0x20000010);
    expect(resolveWatch('counter + 4', table)).toBe(0x20000014);
    expect(resolveWatch('main+0x10', table)).toBe(0x08000110);
    expect(resolveWatch('nope', table)).toBeNull();
    expect(resolveWatch('counter', null)).toBeNull();
    expect(resolveWatch('0x20000000', null)).toBe(0x20000000);
  });
});

describe('memory formatting', () => {
  const words = [
    { address: 0x20000000, value: 0x44434241 },
    { address: 0x20000004, value: 0x00000a30 },
    { address: 0x20000008, value: 0xffffffff },
    { address: 0x2000000c, value: 0x12345678 },
    { address: 0x20000010, value: 0x01020304 }
  ];
  it('splits 16 bytes per row with ASCII', () => {
    const rows = formatMemoryRows(words, 32);
    expect(rows).toHaveLength(2);
    expect(rows[0].address).toBe(0x20000000);
    expect(rows[0].cells[0]).toBe('44434241');
    expect(rows[0].ascii.startsWith('ABCD0.')).toBe(true);
    expect(rows[1].address).toBe(0x20000010);
  });
  it('shows bytes and halfwords little-endian', () => {
    expect(formatMemoryRows(words, 8)[0].cells.slice(0, 4)).toEqual(['41', '42', '43', '44']);
    expect(formatMemoryRows(words, 16)[0].cells.slice(0, 2)).toEqual(['4241', '4443']);
  });
  it('builds copyable text', () => {
    const t = memoryDumpText(words, 32);
    expect(t.split('\n')[0].startsWith('20000000  44434241 ')).toBe(true);
    expect(t).toContain('|ABCD0');
  });
  it('handles empty input', () => {
    expect(formatMemoryRows([], 32)).toEqual([]);
  });
});

describe('client fault register access', () => {
  it('reads CFSR/HFSR then MMFAR/BFAR and clears with write-one', async () => {
    const c = new CmsisDapClient(() => {});
    const mem = new Map([[SCB.CFSR, 0x82], [SCB.HFSR, 0x40000000], [SCB.MMFAR, 0x2000], [SCB.BFAR, 0x3000]]);
    const writes = [];
    c.connected = true;
    c.target = {
      readWords: async (a, n) => Array.from({ length: n }, (_, i) => mem.get(a + i * 4) ?? 0),
      writeWord: async (a, v) => { writes.push([a, v]); }
    };
    expect(await c.readFaultRegisters()).toEqual({ cfsr: 0x82, hfsr: 0x40000000, mmfar: 0x2000, bfar: 0x3000 });
    await c.clearFaultRegisters();
    expect(writes).toEqual([[SCB.CFSR, 0xffffffff], [SCB.HFSR, 0xffffffff]]);
    expect(await c.readWordsAt(0x20000003, 1)).toEqual([0]);
  });
});
