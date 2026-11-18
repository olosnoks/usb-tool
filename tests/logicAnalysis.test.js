import { describe, it, expect } from 'vitest';
import { nearestEdge, edgesBetween, filterDecoded, sigrokCliCommand } from '../src/utils/logicAnalysis';

// D0: 0 0 0 1 1 1 1 0 0 0 (edges at 3 and 7)
const buf = Uint8Array.from([0, 0, 0, 1, 1, 1, 1, 0, 0, 0]);

describe('nearestEdge', () => {
  it('snaps to the closest edge', () => {
    expect(nearestEdge(buf, 0, 4)).toBe(3);
    expect(nearestEdge(buf, 0, 6)).toBe(7);
    expect(nearestEdge(buf, 0, 3)).toBe(3);
  });
  it('returns the sample when the channel is flat', () => {
    expect(nearestEdge(buf, 1, 5)).toBe(5);
  });
  it('works on wide buffers', () => {
    const w = Uint16Array.from([0, 0, 0x100, 0x100]);
    expect(nearestEdge(w, 8, 3)).toBe(2);
  });
});

describe('edgesBetween', () => {
  it('counts rising and falling edges', () => {
    expect(edgesBetween(buf, 0, 0, 9)).toMatchObject({ rising: 1, falling: 1, total: 2 });
    expect(edgesBetween(buf, 0, 9, 4)).toMatchObject({ rising: 0, falling: 1 });
  });
  it('gives the mean period of rising edges', () => {
    const sq = Uint8Array.from([0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
    expect(edgesBetween(sq, 0, 0, 9).periodSamples).toBe(4);
  });
});

describe('filterDecoded', () => {
  const items = [{ type: 'i2c', label: 'W 0x68 ACK' }, { type: 'i2c', label: 'DATA 0x1F', kind: 'data' }, { type: 'uart', label: 'ERR', kind: 'error' }];
  it('matches all words, ignoring case', () => {
    expect(filterDecoded(items, 'data 0x1f')).toHaveLength(1);
    expect(filterDecoded(items, 'UART')).toHaveLength(1);
    expect(filterDecoded(items, '')).toBe(items);
  });
});

describe('sigrokCliCommand', () => {
  it('builds I2C and UART lines', () => {
    expect(sigrokCliCommand('i2c', { scl: 0, sda: 1 })).toBe('sigrok-cli -i capture.sr -P i2c:scl=D0:sda=D1');
    const u = sigrokCliCommand('uart', { rx: 2 }, { baud: 9600, dataBits: 8, parity: 'none', stopBits: 1, inverted: false });
    expect(u).toContain('uart:rx=D2:baudrate=9600');
    expect(u).toContain('invert_rx=no');
  });
  it('maps SPI mode, omits unused channels and honours names', () => {
    const s = sigrokCliCommand('spi', { cs: -1, clk: 7, mosi: 5, miso: 6 }, { mode: 3, wordSize: 8, msbFirst: true, csActiveLow: true }, { file: 'x.sr', chName: (n) => `CH${n}` });
    expect(s).toContain('-i x.sr');
    expect(s).toContain('cpol=1:cpha=1');
    expect(s).not.toContain(':cs=');
    expect(s).toContain('clk=CH7');
  });
  it('picks the IR decoder', () => {
    expect(sigrokCliCommand('ir', { ir: 7 }, { protocol: 'rc5', activeLow: true })).toContain('ir_rc5:ir=D7');
  });
});
