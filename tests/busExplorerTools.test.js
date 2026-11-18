import { describe, it, expect } from 'vitest';
import { SerialLink } from '../src/utils/serialLink';
import { BusExplorerClient } from '../src/utils/busExplorerDriver';
import {
  parseI2cTransfer, parseHexBytes, formatHexDump, diffDumps, formatI2cdetect, spiModeToConfig
} from '../src/utils/busExplorerTools';
import { fakeBusPirate } from './helpers/fakeBusPirate';

describe('parseI2cTransfer', () => {
  it('parses a register read', () => {
    expect(parseI2cTransfer('w1@0x68 0x75 r1')).toEqual({ addr: 0x68, ops: [{ type: 'w', bytes: [0x75] }, { type: 'r', count: 1 }] });
  });
  it('reuses the address and defaults read length', () => {
    const r = parseI2cTransfer('w2@50 00 10 r4@0x51');
    expect(r.addr).toBe(0x51);
    expect(r.ops[1]).toEqual({ type: 'r', count: 4 });
  });
  it('rejects bad input', () => {
    expect(() => parseI2cTransfer('')).toThrow();
    expect(() => parseI2cTransfer('w1 0x75')).toThrow(/address/i);
    expect(() => parseI2cTransfer('w2@0x68 00')).toThrow(/w2/);
    expect(() => parseI2cTransfer('r1@0x7f')).toThrow(/range/);
    expect(() => parseI2cTransfer('r300@0x68')).toThrow(/256/);
    expect(() => parseI2cTransfer('zz@0x68')).toThrow();
  });
});

describe('formatting helpers', () => {
  it('parses hex bytes', () => {
    expect(parseHexBytes('9F 0x00,ab12')).toEqual([0x9f, 0, 0xab, 0x12]);
    expect(() => parseHexBytes('9')).toThrow();
  });
  it('builds an i2cdump-style listing with ASCII', () => {
    const t = formatHexDump([0x48, 0x69, 0x00], 0);
    expect(t.split('\n')[1].trimEnd()).toBe('00: 48 69 00 -- -- -- -- -- -- -- -- -- -- -- -- --    Hi.');
  });
  it('diffs dumps', () => {
    expect(diffDumps([1, 2, 3], [1, 9, 3])).toEqual([1]);
    expect(diffDumps(null, [1])).toEqual([]);
  });
  it('formats i2cdetect output', () => {
    const t = formatI2cdetect([0x3c, 0x68]);
    expect(t).toContain('30: -- -- -- -- -- -- -- -- -- -- -- -- 3c -- -- --');
    expect(t).toContain('60: -- -- -- -- -- -- -- -- 68 -- -- -- -- -- -- --');
  });
  it('maps SPI modes to Bus Pirate flags', () => {
    expect(spiModeToConfig(0)).toMatchObject({ idleHigh: false, edge: true });
    expect(spiModeToConfig(1)).toMatchObject({ idleHigh: false, edge: false });
    expect(spiModeToConfig(2)).toMatchObject({ idleHigh: true, edge: true });
    expect(spiModeToConfig(3)).toMatchObject({ idleHigh: true, edge: false });
  });
});

describe('client transfers', () => {
  async function connected() {
    const fake = fakeBusPirate();
    const link = new SerialLink(fake.port);
    await link.open({ baudRate: 115200 });
    const client = new BusExplorerClient(() => {});
    await client.connectHardware({ link });
    return { client, ...fake };
  }
  it('runs a write-then-read transfer', async () => {
    const { client } = await connected();
    const { addr, ops } = parseI2cTransfer('w1@0x68 0x75 r1');
    const res = await client.i2cTransfer(addr, ops);
    expect(res[1].bytes).toEqual([0x68]);
  });
  it('reports a missing device', async () => {
    const { client } = await connected();
    await expect(client.i2cTransfer(0x50, [{ type: 'r', count: 1 }])).rejects.toThrow(/No ACK from 0x50/);
  });
  it('applies the SPI mode', async () => {
    const { client } = await connected();
    await client.configure({ spiMode: 3 });
    expect(client.settings.spiMode).toBe(3);
    expect(await client.spiTransfer([0x9f, 0, 0, 0])).toHaveLength(4);
  });
});
