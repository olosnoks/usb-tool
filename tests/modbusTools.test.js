import { describe, it, expect } from 'vitest';
import { readRequestHex, mbpollCommand, pushHistory, sparklinePoints, changedAddresses } from '../src/utils/modbusTools';

describe('modbusTools', () => {
  it('builds the canonical FC03 request with CRC', () => {
    expect(readRequestHex(1, 3, 0, 10)).toBe('01 03 00 00 00 0A C5 CD');
  });
  it('reports invalid requests instead of throwing', () => {
    expect(readRequestHex(1, 3, 0, 500)).toMatch(/^invalid/);
  });
  it('exports an mbpoll command', () => {
    expect(mbpollCommand({ slaveId: 5, baud: 19200, parity: 'even', stopBits: 1, table: 'holding', start: 100, qty: 4 }))
      .toBe('mbpoll -m rtu -a 5 -b 19200 -P even -s 1 -t 4 -0 -r 100 -c 4 -1 /dev/ttyUSB0');
    expect(mbpollCommand({ slaveId: 1, baud: 9600, parity: 'none', stopBits: 2, table: 'coils', start: 0, qty: 8, once: false, port: 'COM3' }))
      .toBe('mbpoll -m rtu -a 1 -b 9600 -P none -s 2 -t 0 -0 -r 0 -c 8 COM3');
  });
  it('keeps a bounded numeric history', () => {
    let h = {};
    for (let i = 0; i < 5; i++) h = pushHistory(h, { a: i, b: 'x' }, 3);
    expect(h.a).toEqual([2, 3, 4]);
    expect(h.b).toBeUndefined();
  });
  it('makes sparkline points', () => {
    expect(sparklinePoints([1])).toBe('');
    expect(sparklinePoints([0, 10], 10, 10)).toBe('0.0,10.0 10.0,0.0');
    expect(sparklinePoints([5, 5], 10, 10)).toBe('0.0,5.0 10.0,5.0');
  });
  it('detects changed registers', () => {
    expect(changedAddresses([], [{ address: 0, hex: '0001' }]).size).toBe(0);
    const c = changedAddresses([{ address: 0, hex: '0001' }, { address: 1, hex: '0002' }], [{ address: 0, hex: '0001' }, { address: 1, hex: '0003' }]);
    expect([...c]).toEqual([1]);
  });
});
