// Ports of the capture-driven parts of tests/test_infer.py and test_infer_advanced.py.
// Needs pipeline.js and synth.js (written by the lead / other agents). Driver generation tests are not ported.
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { make_capture, encode, encode_fan, encode_dial, VID, PID } from '../../src/utils/usbrea/synth.js';

const arr = (u) => Array.from(u);
const run = (kw = {}) => {
  const { capture, markers } = make_capture(kw);
  return analyze(capture, markers);
};

describe.each(['bulk', 'control'])('lamp over %s', (transport) => {
  it('protocol recovered', () => {
    const p = run({ transport });
    expect([p.vid, p.pid]).toEqual([VID, PID]);
    const cmds = Object.fromEntries(p.commands.map((c) => [c.name, c]));
    expect(new Set(Object.keys(cmds))).toEqual(new Set(['brightness', 'power', 'hue']));
    const b = cmds.brightness;
    expect(b.fields.map((f) => f.kind)).toEqual(['const', 'command', 'value', 'const', 'checksum']);
    expect(b.fields[4].algo).toBe('sum8');
    expect(b.confidence).toBe(1.0);
    for (const v of [10, 33, 90]) expect(arr(b.encode(v))).toEqual(arr(encode('brightness', v)));
    for (const v of [2, 100, 358]) expect(arr(cmds.hue.encode(v))).toEqual(arr(encode('hue', v)));
    expect(arr(cmds.power.encode(1))).toEqual(arr(encode('power', 1)));
  });
});

describe('fan', () => {
  const proto = () => run({ device: 'fan' });
  const byName = (p) => Object.fromEntries(p.commands.map((c) => [c.name, c]));
  const byOff = (c) => Object.fromEntries(c.fields.map((f) => [f.offset, f]));

  it('fields', () => {
    const c = byName(proto());
    expect(new Set(Object.keys(c))).toEqual(new Set(['fan', 'color', 'mode']));
    const fan = byOff(c.fan);
    expect([fan[1].kind, fan[1].step]).toEqual(['counter', 1]);
    expect(fan[2].kind).toBe('command');
    expect([fan[3].kind, fan[3].width, fan[3].endian, fan[3].scale]).toEqual(['value', 2, 'be', 1]);
    expect([fan[6].kind, fan[6].algo, fan[6].width]).toEqual(['checksum', 'crc16_modbus', 2]);
    const col = byOff(c.color);
    expect([3, 4, 5].map((i) => [col[i].kind, col[i].index])).toEqual([['value', 0], ['value', 1], ['value', 2]]);
    const mode = byOff(c.mode);
    expect(mode[3].kind).toBe('lookup');
    expect([...mode[3].table]).toEqual([[1, 0x11], [2, 0x22], [3, 0x47]]);
    for (const cmd of Object.values(c)) expect(cmd.confidence).toBe(1.0);
  });

  it('encodes unseen values', () => {
    const c = byName(proto());
    expect(arr(c.fan.encode(3100, { seq: 7 }))).toEqual(arr(encode_fan('fan', [3100], 7)));
    expect(arr(c.color.encode(1, 2, 3, { seq: 9 }))).toEqual(arr(encode_fan('color', [1, 2, 3], 9)));
    expect(arr(c.mode.encode(2, { seq: 1 }))).toEqual(arr(encode_fan('mode', [2], 1)));
  });
});

describe('dial', () => {
  it('u32 and bitfield', () => {
    const p = run({ device: 'dial' });
    const c = Object.fromEntries(p.commands.map((x) => [x.name, x]));
    expect(new Set(Object.keys(c))).toEqual(new Set(['position', 'level']));
    const pos = Object.fromEntries(c.position.fields.map((f) => [f.offset, f]));
    expect([pos[0].kind, pos[0].const]).toEqual(['const', 0xa5]);
    expect([pos[1].kind, pos[1].const]).toEqual(['command', 0x01]);
    expect([pos[2].kind, pos[2].width, pos[2].endian, pos[2].scale, pos[2].bias]).toEqual(['value', 4, 'le', 1, 0]);
    expect([pos[6].kind, pos[6].algo]).toEqual(['checksum', 'sum8']);
    expect(arr(c.position.encode(0x11223344))).toEqual(arr(encode_dial('position', [0x11223344])));
    const lvl = Object.fromEntries(c.level.fields.map((f) => [f.offset, f]));
    expect([lvl[0].kind, lvl[0].const]).toEqual(['const', 0xa5]);
    expect([lvl[1].kind, lvl[1].const]).toEqual(['command', 0x02]);
    const bf = lvl[2];
    expect([bf.kind, bf.bit_offset, bf.bit_width, bf.scale, bf.bias]).toEqual(['bitfield', 0, 4, 1, 0]);
    expect(arr(c.level.encode(9))).toEqual(arr(encode_dial('level', [9])));
    expect(arr(c.level.encode(15))).toEqual(arr(encode_dial('level', [15])));
    for (const cmd of Object.values(c)) expect(cmd.confidence).toBe(1.0);
  });
});
