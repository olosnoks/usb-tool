import { describe, it, expect } from 'vitest';
import {
  ModbusClient, buildModbusRtuRequest, calculateModbusCrc16, frameWithCrc, buildRequest,
  createRxTransceive, isCompleteResponse
} from '../src/utils/modbusDriver';

const hex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join(' ');
const frame = (bytes) => frameWithCrc(Uint8Array.from(bytes));

// A mocked slave: handler(txFrame) -> response bytes (array | Uint8Array | null | Error)
function connected(handler, opts = {}) {
  const c = new ModbusClient(() => {});
  const seen = [];
  let inFlight = 0;
  let peak = 0;
  c.connectLive(async (tx, o) => {
    inFlight++; peak = Math.max(peak, inFlight);
    seen.push({ tx, o });
    await new Promise((r) => setTimeout(r, opts.delay ?? 0));
    inFlight--;
    const r = handler(tx);
    if (r instanceof Error) throw r;
    return r ? Uint8Array.from(r) : new Uint8Array(0);
  }, 1, 9600);
  c.seen = seen;
  c.peak = () => peak;
  return c;
}

describe('modbus framing', () => {
  it('matches the spec known vector 01 03 00 00 00 0A C5 CD', () => {
    expect(hex(buildModbusRtuRequest(1, 3, 0, 10))).toBe('01 03 00 00 00 0a c5 cd');
    expect(hex(buildRequest(1, 3, 0, 10).frame)).toBe('01 03 00 00 00 0a c5 cd');
  });
  it('builds the other function codes', () => {
    expect(hex(buildRequest(1, 1, 0x13, 0x25).frame.slice(0, 6))).toBe('01 01 00 13 00 25');
    expect(hex(buildRequest(1, 5, 0xAC, true).frame.slice(0, 6))).toBe('01 05 00 ac ff 00');
    expect(hex(buildRequest(1, 5, 0xAC, false).frame.slice(0, 6))).toBe('01 05 00 ac 00 00');
    expect(hex(buildRequest(1, 15, 0x13, [1, 0, 1, 1, 0, 0, 1, 1, 1, 0]).frame.slice(0, 9))).toBe('01 0f 00 13 00 0a 02 cd 01');
    expect(hex(buildRequest(1, 16, 1, [0x000A, 0x0102]).frame.slice(0, 11))).toBe('01 10 00 01 00 02 04 00 0a 01 02');
    expect(hex(buildRequest(1, 17).frame.slice(0, 2))).toBe('01 11');
    expect(hex(buildRequest(1, 0x2B, 1, 0).frame.slice(0, 5))).toBe('01 2b 0e 01 00');
  });
  it('rejects out-of-range requests', () => {
    expect(() => buildRequest(1, 3, 0, 126)).toThrow(/Quantity/);
    expect(() => buildRequest(1, 1, 0, 2001)).toThrow(/Quantity/);
    expect(() => buildRequest(1, 16, 0, new Array(124).fill(0))).toThrow(/count/);
    expect(() => buildRequest(1, 99)).toThrow(/Unsupported/);
  });
});

describe('modbus function codes round-trip against a mocked slave', () => {
  it('FC01 / FC02 read bits', async () => {
    const c = connected(() => frame([1, 1, 2, 0b11001101, 0b00000001]));
    const r = await c.readCoils(0x13, 10);
    expect(r.ok).toBe(true);
    expect(r.bits).toEqual([true, false, true, true, false, false, true, true, true, false]);
    const c2 = connected(() => frame([1, 2, 1, 0b00000101]));
    expect((await c2.readDiscreteInputs(0, 3)).bits).toEqual([true, false, true]);
  });
  it('FC03 / FC04 read words', async () => {
    const c = connected(() => frame([1, 3, 4, 0x12, 0x34, 0xAB, 0xCD]));
    expect((await c.request(3, 0, 2)).words).toEqual([0x1234, 0xABCD]);
    const c2 = connected(() => frame([1, 4, 2, 0, 7]));
    expect((await c2.readInputRegistersDetailed(5, 1)).words).toEqual([7]);
  });
  it('FC05 / FC06 need an exact echo', async () => {
    const c = connected((tx) => tx);
    expect((await c.writeSingleCoil(3, true)).ok).toBe(true);
    expect((await c.request(6, 1, 500)).ok).toBe(true);
    const bad = connected(() => buildModbusRtuRequest(1, 6, 1, 999));
    expect(await bad.request(6, 1, 500)).toMatchObject({ ok: false, reason: 'mismatch', detail: 'echo' });
  });
  it('FC15 / FC16 check the address and quantity echo', async () => {
    const c = connected((tx) => frame([1, tx[1], tx[2], tx[3], tx[4], tx[5]]));
    expect((await c.writeMultipleCoils(0x13, [1, 0, 1])).ok).toBe(true);
    expect((await c.writeMultipleRegisters(1, [1, 2])).ok).toBe(true);
    const wrong = connected(() => frame([1, 16, 0, 1, 0, 3]));
    expect(await wrong.writeMultipleRegisters(1, [1, 2])).toMatchObject({ ok: false, reason: 'mismatch' });
  });
  it('FC17 report server id', async () => {
    const c = connected(() => frame([1, 0x11, 5, 0x2A, 0xFF, 0x41, 0x42, 0x43]));
    const r = await c.reportServerId();
    expect(r).toMatchObject({ ok: true, serverId: 0x2A, running: true, text: 'ABC' });
  });
  it('FC43/14 device identification', async () => {
    const v = [...'ACME'].map((ch) => ch.charCodeAt(0));
    const p = [...'X1'].map((ch) => ch.charCodeAt(0));
    const c = connected(() => frame([1, 0x2B, 0x0E, 1, 0x01, 0x00, 0x00, 2, 0, v.length, ...v, 1, p.length, ...p]));
    const r = await c.readDeviceId(1, 0);
    expect(r.ok).toBe(true);
    expect(r.objects).toEqual([{ id: 0, name: 'VendorName', value: 'ACME' }, { id: 1, name: 'ProductCode', value: 'X1' }]);
  });
});

describe('modbus error reporting is distinct', () => {
  it('timeout, exception, crc, slave and function mismatch, short, transport', async () => {
    expect(await connected(() => null).request(3, 0, 1)).toMatchObject({ reason: 'timeout' });
    expect(await connected(() => frame([1, 0x83, 2])).request(3, 0, 1)).toMatchObject({ reason: 'exception', exceptionCode: 2, exceptionName: 'Illegal Data Address' });
    const badCrc = frame([1, 3, 2, 0, 1]); badCrc[badCrc.length - 1] ^= 0xFF;
    expect(await connected(() => badCrc).request(3, 0, 1)).toMatchObject({ reason: 'crc' });
    expect(await connected(() => frame([2, 3, 2, 0, 1])).request(3, 0, 1)).toMatchObject({ reason: 'mismatch', detail: 'slave' });
    expect(await connected(() => frame([1, 4, 2, 0, 1])).request(3, 0, 1)).toMatchObject({ reason: 'mismatch', detail: 'function' });
    expect(await connected(() => frame([1, 3, 4, 0, 1, 0, 2])).request(3, 0, 1)).toMatchObject({ reason: 'mismatch', detail: 'length' });
    expect(await connected(() => [1, 3, 2]).request(3, 0, 1)).toMatchObject({ reason: 'short' });
    expect(await connected(() => new Error('boom')).request(3, 0, 1)).toMatchObject({ reason: 'transport' });
    const idle = new ModbusClient(() => {});
    expect(await idle.request(3, 0, 1)).toMatchObject({ reason: 'not-connected' });
    expect(await connected(() => null).request(3, 0, 500)).toMatchObject({ reason: 'invalid' });
  });
  it('retries timeouts but not exceptions', async () => {
    let n = 0;
    const c = connected(() => { n++; return n < 3 ? null : frame([1, 3, 2, 0, 9]); });
    c.retries = 2;
    expect((await c.request(3, 0, 1)).words).toEqual([9]);
    expect(n).toBe(3);
    let m = 0;
    const e = connected(() => { m++; return frame([1, 0x83, 2]); });
    e.retries = 3;
    await e.request(3, 0, 1);
    expect(m).toBe(1);
  });
  it('counts errors and response times', async () => {
    let t = 0;
    const c = new ModbusClient(() => {}, () => t);
    let step = 0;
    c.connectLive(async () => {
      t += [10, 30, 5][step % 3];
      const r = [frame([1, 3, 2, 0, 1]), null, frame([1, 0x83, 2])][step % 3];
      step++;
      return r ?? new Uint8Array(0);
    });
    await c.request(3, 0, 1); await c.request(3, 0, 1); await c.request(3, 0, 1);
    expect(c.stats).toMatchObject({ sent: 3, ok: 1, timeouts: 1, exceptions: 1, minMs: 5, maxMs: 10 });
    expect(c.stats.avgMs).toBe(7.5);
  });
});

describe('request queue', () => {
  it('never has two requests in flight', async () => {
    const c = connected(() => frame([1, 3, 2, 0, 1]), { delay: 5 });
    await Promise.all([c.request(3, 0, 1), c.request(3, 1, 1), c.request(4, 2, 1), c.request(3, 3, 1)]);
    expect(c.peak()).toBe(1);
    expect(c.maxInFlight).toBe(1);
    expect(c.seen).toHaveLength(4);
  });
});

describe('connection framing and write wrappers', () => {
  it('records parity and stop bits', () => {
    const c = new ModbusClient(() => {});
    c.connectLive(async () => new Uint8Array(0), 1, 9600, { parity: 'even', stopBits: 1 });
    expect(c).toMatchObject({ parity: 'even', stopBits: 1 });
  });
  it('readHoldingRegisters returns generic rows, never device labels', async () => {
    const c = connected(() => frame([1, 3, 4, 0x08, 0xFC, 0, 55]));
    const rows = await c.readHoldingRegisters(0, 2);
    expect(rows.map((r) => r.label)).toEqual(['Register 0', 'Register 1']);
    expect(rows[0].rawUint16).toBe(2300);
  });
});

describe('slave scan', () => {
  it('finds responders (including exception replies) and can be cancelled', async () => {
    const c = connected((tx) => {
      if (tx[0] === 3) return frame([3, 3, 2, 0, 1]);
      if (tx[0] === 5) return frame([5, 0x83, 2]);
      return null;
    });
    const found = await c.scan({ from: 1, to: 8, timeoutMs: 10 });
    expect(found.map((f) => [f.slaveId, f.kind])).toEqual([[3, 'ok'], [5, 'exception']]);

    const signal = { aborted: false };
    let probed = 0;
    const out = await c.scan({ from: 1, to: 247, signal, onProgress: () => { probed++; if (probed === 4) signal.aborted = true; } });
    expect(probed).toBe(4);
    expect(out.map((f) => f.slaveId)).toEqual([3]);
  });
});

describe('rx transport ends on a complete frame', () => {
  it('resolves immediately on an exception frame and on chunked frames', async () => {
    let listener;
    const subscribeRx = (fn) => { listener = fn; return () => { listener = null; }; };
    const t = createRxTransceive({ subscribeRx, send: async () => {
      const f = frame([1, 0x83, 2]);
      setTimeout(() => { listener(f.slice(0, 2)); listener(f.slice(2)); }, 0);
    } });
    const start = Date.now();
    const out = await t(new Uint8Array([1]), { timeoutMs: 2000 });
    expect(Date.now() - start).toBeLessThan(500);
    expect(isCompleteResponse(out)).toBe(true);
    expect(listener).toBeNull();
  });
  it('resolves empty on timeout and unsubscribes', async () => {
    let subscribed = 0;
    const t = createRxTransceive({ subscribeRx: () => { subscribed++; return () => { subscribed--; }; }, send: async () => {} });
    expect((await t(new Uint8Array([1]), { timeoutMs: 20 })).length).toBe(0);
    expect(subscribed).toBe(0);
  });
  it('crc helper stays consistent', () => {
    expect(calculateModbusCrc16(Uint8Array.from([1, 3, 0, 0, 0, 10]))).toBe(0xCDC5);
  });
});
