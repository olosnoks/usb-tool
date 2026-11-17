// Ports of tests/test_infer.py and test_infer_advanced.py (the parts that build Transfers/Actions by hand),
// plus py_round_n / describe sanity checks.
import { describe, it, expect } from 'vitest';
import { infer, py_round_n, _fit_linear, formula } from '../../src/utils/usbrea/infer.js';
import { Action, Transfer } from '../../src/utils/usbrea/model.js';

const T = (frame, ts, bus, device, endpoint, xfer_type, setup, data) =>
  new Transfer({ frame, ts, bus, device, endpoint, xfer_type, setup, data: Uint8Array.from(data) });
const arr = (u) => Array.from(u);

describe('infer (hand-built transfers)', () => {
  it('detects xor checksum', () => {
    const acts = [];
    [0, 10, 20, 30].forEach((v, i) => {
      const body = [0x5a, 0x07, v, 0x01];
      let x = 0;
      for (const c of body) x ^= c;
      acts.push(new Action({ label: `speed ${v}`, start: i - 0.1, end: i + 0.1, transfers: [T(i + 1, i, 1, 3, 0x02, 3, null, [...body, x])] }));
    });
    const c = infer(acts).commands[0];
    expect(c.fields[4].kind).toBe('checksum');
    expect(c.fields[4].algo).toBe('xor8');
    expect(c.fields[2].kind).toBe('value');
    expect(c.fields[2].scale).toBe(1);
  });

  it('ignores background chatter', () => {
    const acts = [];
    [1, 2, 3, 4].forEach((v, i) => {
      const ka = T(10 * i + 1, i, 1, 3, 0x01, 3, null, [0xff, 0xee]);
      const cmd = T(10 * i + 2, i + 0.01, 1, 3, 0x01, 3, null, [0x10, v]);
      acts.push(new Action({ label: `mode ${v}`, start: i - 0.1, end: i + 0.5, transfers: [ka, cmd] }));
    });
    const c = infer(acts).commands[0];
    expect(c.length).toBe(2);
    expect(c.fields[1].kind).toBe('value');
  });

  it('32-bit big-endian value', () => {
    const acts = [];
    [0, 0x01020304, 0x0a0b0c0d, 0x10203040, 0x7f7f7f7f].forEach((v, i) => {
      const body = [0xcc, 0x01, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      acts.push(new Action({ label: `count ${v}`, start: i - 0.1, end: i + 0.1, transfers: [T(i + 1, i, 1, 3, 0x01, 3, null, body)] }));
    });
    const c = infer(acts).commands[0];
    const f = c.fields.find((x) => x.kind === 'value');
    expect(f.width).toBe(4);
    expect(f.endian).toBe('be');
    expect(f.scale).toBe(1);
    expect(arr(c.encode(0x11223344))).toEqual([0xcc, 0x01, 0x11, 0x22, 0x33, 0x44]);
  });

  it('12-bit bitfield across two bytes', () => {
    const acts = [];
    [0, 100, 500, 2047, 3000].forEach((v, i) => {
      const word = 0x5000 | (v & 0x0fff);
      acts.push(new Action({ label: `gain ${v}`, start: i - 0.1, end: i + 0.1, transfers: [T(i + 1, i, 1, 3, 0x01, 3, null, [0xdd, word & 0xff, word >> 8])] }));
    });
    const c = infer(acts).commands[0];
    const bf = c.fields.find((x) => x.kind === 'bitfield');
    expect(bf.offset).toBe(1);
    expect(bf.width).toBe(2);
    expect(bf.bit_offset).toBe(0);
    expect(bf.bit_width).toBe(12);
    expect(arr(c.encode(1500))).toEqual([0xdd, 0xdc, 0x55]);
  });

  it('brightness-style value + sum8 checksum, unseen values encode', () => {
    const acts = [];
    [0, 25, 50, 75, 100].forEach((v, i) => {
      const body = [0xaa, 0x01, v, 0x00];
      const s = body.reduce((a, b) => a + b, 0) & 0xff;
      acts.push(new Action({ label: `brightness ${v}`, start: i - 0.1, end: i + 0.1, transfers: [T(i + 1, i, 1, 3, 0x01, 3, null, [...body, s])] }));
    });
    const p = infer(acts, 0x1234, 0xabcd);
    expect([p.vid, p.pid]).toEqual([0x1234, 0xabcd]);
    const c = p.commands[0];
    expect(c.confidence).toBe(1.0);
    expect(arr(c.encode(33))).toEqual([0xaa, 0x01, 33, 0x00, (0xaa + 1 + 33) & 0xff]);
    expect(c.fields[2].describe()).toBe('round(value * 1 + 0)');
  });
});

describe('helpers', () => {
  it('py_round_n is banker\'s rounding', () => {
    expect(py_round_n(2.5)).toBe(2);
    expect(py_round_n(3.5)).toBe(4);
    expect(py_round_n(-0.5)).toBe(0);
    expect(py_round_n(0.125, 2)).toBe(0.12);
    expect(py_round_n(0.15, 1)).toBe(0.1);
    expect(py_round_n(0.6, 2)).toBe(0.6);
  });
  it('_fit_linear', () => {
    expect(_fit_linear([0, 10, 20, 30], [0, 10, 20, 30])).toEqual([1, 0]);
    expect(_fit_linear([1, 2, 3], [17, 34, 71])).toBeNull();
    expect(formula(1, 0)).toBe('raw');
    expect(formula(10, 3)).toBe('(raw - 3) / 10');
    expect(formula(1, -2)).toBe('raw + 2');
  });
});
