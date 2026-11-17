// Port of tests/test_transactions.py (multi-packet transactions). Driver generation is not ported.
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { capture_from_messages } from '../../src/utils/usbrea/synth.js';

const arr = (u) => Array.from(u);
const EP = ['bulk', 0x02];

function lcd(name, ...v) {
  if (name === 'backlight') return [Uint8Array.of(0x12, 0x34, v[0], 0x00), Uint8Array.of(0x12, 0x99, 0x01, 0x00)];
  if (name === 'color') {
    const rgb = Uint8Array.from(v);
    return [Uint8Array.of(0x20, 0x01), Uint8Array.of(0x21, ...rgb), Uint8Array.of(0x22, rgb.reduce((a, b) => a + b, 0) & 0xff)];
  }
  return [Uint8Array.of(0x30, v[0])];
}

const ACTIONS = [['backlight', 0], ['backlight', 40], ['backlight', 100], ['color', 255, 0, 0],
  ['color', 0, 128, 255], ['color', 9, 8, 7], ['rotate', 0], ['rotate', 1], ['rotate', 2]];

function capture() {
  const msgs = ACTIONS.map((a) => [a.join(' '), lcd(...a), EP]);
  const { capture: cap, markers } = capture_from_messages(msgs, 0x1234, 0x5678);
  return analyze(cap, markers);
}

describe('multi-packet transactions', () => {
  it('structure', () => {
    const c = Object.fromEntries(capture().commands.map((x) => [x.name, x]));
    expect(new Set(Object.keys(c))).toEqual(new Set(['backlight', 'color', 'rotate']));
    expect(c.backlight.steps.length).toBe(1);
    expect(c.color.steps.length).toBe(2);
    expect(c.rotate.steps).toEqual([]);
    for (const x of Object.values(c)) expect(x.confidence).toBe(1.0);
    const commit = Object.fromEntries(c.color.steps[1].fields.map((f) => [f.offset, f]));
    expect([commit[1].kind, commit[1].source, commit[1].algo]).toEqual(['checksum', 1, 'sum8']);
  });

  it('encodes unseen values', () => {
    const c = Object.fromEntries(capture().commands.map((x) => [x.name, x]));
    const same = (got, want) => expect(got.map(arr)).toEqual(want.map(arr));
    same(c.backlight.encode_all(70), lcd('backlight', 70));
    same(c.color.encode_all(1, 2, 3), lcd('color', 1, 2, 3));
    same(c.rotate.encode_all(3), lcd('rotate', 3));
  });
});
