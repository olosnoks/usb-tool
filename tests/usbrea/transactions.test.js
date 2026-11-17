// Hand-built variant of test_transactions.py: no capture needed, goes straight through infer().
import { describe, it, expect } from 'vitest';
import { infer } from '../../src/utils/usbrea/infer.js';
import { Action, Transfer } from '../../src/utils/usbrea/model.js';

const arr = (u) => Array.from(u);
function lcd(name, ...v) {
  if (name === 'backlight') return [[0x12, 0x34, v[0], 0x00], [0x12, 0x99, 0x01, 0x00]];
  if (name === 'color') return [[0x20, 0x01], [0x21, ...v], [0x22, v.reduce((a, b) => a + b, 0) & 0xff]];
  return [[0x30, v[0]]];
}
const ACTIONS = [['backlight', 0], ['backlight', 40], ['backlight', 100], ['color', 255, 0, 0],
  ['color', 0, 128, 255], ['color', 9, 8, 7], ['rotate', 0], ['rotate', 1], ['rotate', 2]];

function protocol() {
  let frame = 0;
  const acts = ACTIONS.map((a, i) => {
    const ts = i * 2;
    const transfers = lcd(...a).map((d, k) => new Transfer({
      frame: ++frame, ts: ts + 0.3 + 0.02 * k, bus: 1, device: 5, endpoint: 0x02, xfer_type: 3, data: Uint8Array.from(d),
    }));
    return new Action({ label: a.join(' '), start: ts, end: ts + 1, transfers });
  });
  return infer(acts, 0x1234, 0x5678);
}

describe('transactions (hand-built)', () => {
  it('structure', () => {
    const p = protocol();
    const c = Object.fromEntries(p.commands.map((x) => [x.name, x]));
    expect(new Set(Object.keys(c))).toEqual(new Set(['backlight', 'color', 'rotate']));
    expect(c.backlight.steps.length).toBe(1);
    expect(c.color.steps.length).toBe(2);
    expect(c.rotate.steps).toEqual([]);
    for (const x of p.commands) expect(x.confidence).toBe(1.0);
    const commit = Object.fromEntries(c.color.steps[1].fields.map((f) => [f.offset, f]));
    expect([commit[1].kind, commit[1].source, commit[1].algo]).toEqual(['checksum', 1, 'sum8']);
    expect(c.color.notes.some((n) => n.includes('multi-packet transaction: 3 packets'))).toBe(true);
    expect(c.color.steps[0].name).toBe('color [packet 2]');
  });

  it('encodes unseen values', () => {
    const c = Object.fromEntries(protocol().commands.map((x) => [x.name, x]));
    const same = (got, want) => expect(got.map(arr)).toEqual(want);
    same(c.backlight.encode_all(70), lcd('backlight', 70));
    same(c.color.encode_all(1, 2, 3), lcd('color', 1, 2, 3));
    same(c.rotate.encode_all(3), lcd('rotate', 3));
  });
});
