// Port of tests/test_states.py and tests/test_state_replies.py (capture-driven; the generated-driver tests are
// not ported because they execute generated Python).
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { render } from '../../src/utils/usbrea/report.js';
import { make_capture, encode_fan, fan_reply, UsbmonWriter, device_descriptor } from '../../src/utils/usbrea/synth.js';

const run = (kw) => {
  const { capture, markers } = make_capture(kw);
  return analyze(capture, markers);
};
const cmds = (p) => Object.fromEntries(p.commands.map((c) => [c.name, c]));

describe('states (test_states.py)', () => {
  it('color only sent in mode 3', () => {
    const proto = run({ device: 'fan', states: true });
    const c = cmds(proto);
    expect(proto.states.map((r) => r.command)).toEqual(['color']);
    const req = c.color.requires[0];
    expect([req.state, req.value, req.count, req.other_values]).toEqual(['mode', 3.0, 3, [1.0, 2.0]]);
    expect(req.setter_frames.length).toBe(2);
    expect(req.frames).toEqual(c.color.frames);
    expect(c.fan.requires).toBeNull();
    expect(c.mode.requires).toBeNull();
    expect(c.color.notes.some((n) => n.includes('only sent while mode was 3'))).toBe(true);
    expect(render(proto)).toContain('Only sent while `mode 3`: 3x');
    expect(proto.to_dict().commands[2].requires[0].value).toBe(3.0);
  });

  it('no precondition without a known or changing state', () => {
    // default fan capture: fan and color come before any mode command, so their state is unknown
    expect(run({ device: 'fan' }).states).toEqual([]);
    // color in mode 3 and in mode 1: not tied to one state
    let acts = ['mode 1', 'fan 800', 'color 1 2 3', 'mode 3', 'color 255 0 0', 'color 0 128 255', 'mode 2', 'fan 1200'];
    expect(run({ device: 'fan', actions: acts }).states).toEqual([]);
    // the mode never changes while other commands run: nothing to compare against
    acts = ['mode 1', 'mode 2', 'mode 3', 'color 255 0 0', 'color 0 128 255', 'color 10 20 30'];
    expect(run({ device: 'fan', actions: acts }).states).toEqual([]);
  });

  it('states only for the fan', () => {
    expect(() => make_capture({ states: true })).toThrow();
  });
});

describe('state replies (test_state_replies.py)', () => {
  it('color only sent while the fan reports turbo', () => {
    const proto = run({ device: 'fan', reported: true });
    const c = cmds(proto);
    expect(proto.states.map((r) => r.command)).toEqual(['color']);
    const req = c.color.requires[0];
    expect([req.source, req.state, req.value, req.reply, req.where]).toEqual(['reply', 'mode', 'turbo', 'poll 1', 'byte 5']);
    expect(req.count).toBe(3);
    expect(req.other_values).toEqual(['auto', 'balanced', 'silent']);
    expect(req.frames).toEqual(c.color.frames);
    expect(req.reply_frames.length).toBe(3);
    expect(req.reply_frames.every((r, i) => r < req.frames[i])).toBe(true); // the reply came before each color
    expect([req.setter.command, req.setter.value, req.setter.count]).toEqual(['mode', 3.0, 3]);
    expect(c.fan.requires).toBeNull();
    expect(c.mode.requires).toBeNull(); // mode is how the state is set
    expect(c.color.notes.some((n) => n.includes('only sent while the device reported mode turbo'))).toBe(true);
    JSON.stringify(proto.to_dict());
  });

  it('report and demo text', () => {
    const text = render(run({ device: 'fan', reported: true }));
    expect(text).toContain('Only sent while the device reported `mode turbo` (poll 1 byte 5): 3x');
    expect(text).toContain('switches it with `mode 3`');
  });

  it('no reported precondition on weak evidence', () => {
    // color seen while the fan reported turbo and while it reported silent: not tied to one mode
    const acts = ['fan 800', 'press mode 3', 'color 255 0 0', 'press mode 1', 'color 0 128 255', 'fan 1200',
      'mode 2', 'fan 2650', 'mode 3', 'color 10 20 30', 'mode 1', 'fan 4000'];
    expect(run({ device: 'fan', reported: true, actions: acts }).states).toEqual([]);
    // without 'seen mode ...' markers the mode byte is an unnamed reading: no state to talk about
    const { capture, markers } = make_capture({ device: 'fan', reported: true });
    const proto = analyze(capture, markers.filter((x) => !x.label.startsWith('seen')));
    expect(proto.states).toEqual([]);
    expect(cmds(proto).color.requires).toBeNull();
  });

  it('driver-less: a mode only changed by the fan button has no setter', () => {
    const acts = ['fan 800', 'press mode 3', 'color 255 0 0', 'color 0 128 255', 'press mode 1', 'fan 1200',
      'fan 2650', 'press mode 3', 'color 10 20 30', 'press mode 2', 'fan 4000'];
    const proto = run({ device: 'fan', reported: true, actions: acts });
    expect(proto.states[0].value).toBe('turbo');
    expect(proto.states[0].setter).toBeNull();
  });

  it('mode switch inside the color action', () => {
    const proto = run({ device: 'fan', switch: true });
    const c = cmds(proto);
    expect(Object.keys(c)).toEqual(['mode', 'fan', 'color']);
    const color = c.color;
    expect(color.steps).toEqual([]);
    expect(color.fields.filter((f) => f.kind === 'command').map((f) => f.const)).toEqual([0x20]);
    expect(color.samples.slice(0, 2).map((s) => s[0])).toEqual(['color 255 0 0', 'color 0 128 255']);
    const sw = color.switch;
    expect([sw.state, sw.enter, sw.restore, sw.count, sw.packets]).toEqual(['mode', 3.0, 'previous', 4, 3]);
    expect(sw.restore_values).toEqual([1.0, 2.0, 2.0, 1.0]);
    sw.enter_frames.forEach((a, i) => {
      expect(a < color.frames[i] && color.frames[i] < sw.restore_frames[i]).toBe(true);
    });
    expect(proto.switches[0].command).toBe('color');
    expect(proto.states).toEqual([]);
    expect(color.confidence).toBe(1.0);
    expect(color.notes.some((n) => n.includes('multi-packet'))).toBe(false);
    expect(render(proto)).toContain('Switches `mode` inside the action: 4x');
  });
});

const T0 = 1_760_000_000.0;

/** Fan capture: 'mode 1', then colors each sent as mode <enter>, color, mode <back> (null: no last packet). */
function wrapped(enters, backs) {
  const w = new UsbmonWriter();
  let t = T0;
  w.control_in(t, Uint8Array.of(0x80, 6, 0, 1, 0, 0, 18, 0), device_descriptor());
  t += 0.5;
  const marks = [];
  let seq = 0x40;
  const plan = [['mode 1', [['mode', [1]]]], ['mode 2', [['mode', [2]]]], ['mode 3', [['mode', [3]]]]];
  enters.forEach((e, k) => {
    const b = backs[k];
    const rgb = [10 * k, 20 + k, 200 - k];
    const pk = [['mode', [e]], ['color', rgb], ...(b ? [['mode', [b]]] : [])];
    plan.push([`color ${rgb[0]} ${rgb[1]} ${rgb[2]}`, pk]);
    plan.push([`fan ${800 + 400 * k}`, [['fan', [800 + 400 * k]]]]);
  });
  for (const [label, pkts] of plan) {
    pkts.forEach(([name, vals], j) => {
      seq += 1;
      const msg = encode_fan(name, vals, seq);
      w.out(t + 0.3 + 0.03 * j, 0x01, msg);
      w.in_(t + 0.31 + 0.03 * j, 0x81, fan_reply(msg, name === 'fan' ? vals : [0]));
    });
    marks.push({ label, start: t, end: t + 1.0 });
    t += 1.5;
  }
  return analyze(w.save(), marks);
}

describe('switch only when the packets agree', () => {
  it('back to a fixed mode', () => {
    // back to a fixed mode 1 (the mode before was 3): a fixed restore value
    const color = cmds(wrapped([2, 2, 2], [1, 1, 1])).color;
    expect([color.switch.enter, color.switch.restore]).toEqual([2.0, 1.0]);
  });
  it('no last packet', () => {
    const color = cmds(wrapped([3, 3, 3], [null, null, null])).color;
    expect(color.switch.restore).toBeNull();
    expect(color.switch.packets).toBe(2);
  });
  it('the first packet picks different modes', () => {
    const proto = wrapped([1, 2, 3], [1, 1, 1]);
    const color = cmds(proto).color;
    expect(color.switch).toBeNull();
    expect(color.steps.length).toBe(2);
    expect(proto.switches).toEqual([]);
    expect(color.notes.some((n) => n.includes('with different values'))).toBe(true);
  });
  it('the last packet is neither the mode from before nor one fixed value', () => {
    const color = cmds(wrapped([3, 3, 3], [1, 2, 1])).color;
    expect(color.switch).toBeNull();
    expect(color.notes.some((n) => n.includes('neither the value from before'))).toBe(true);
  });
});
