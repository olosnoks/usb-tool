// Port of tests/test_handshake.py: handshake steps, tokens, retries, reopens and branches.
// Driver (open()) tests are not ported: they execute generated Python.
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { render } from '../../src/utils/usbrea/report.js';
import { make_capture, UsbmonWriter, device_descriptor } from '../../src/utils/usbrea/synth.js';

const T0 = 1_760_000_000.0;
const B = (...x) => Uint8Array.from(x);
const GET_DESC = () => B(0x80, 6, 0, 1, 0, 0, 18, 0);
const run = (kw) => {
  const { capture, markers } = make_capture(kw);
  return analyze(capture, markers);
};
const SCENARIOS = [{}, { poll: 0.5, observe: true }, { poll: 0.25, transport: 'control' }];
const sig = (p) => p.commands.map((c) => [c.name, c.fields.map((f) => f.describe())]);

/** Write the capture and analyze it with the given markers. */
function done(w, marks) {
  return analyze(w.save(), marks);
}
function levelMarks(n = 4, t0 = T0) {
  return [10, 20, 30, 40].slice(0, n).map((v, i) => ({ label: `level ${v}`, start: t0 + 1 + i, end: t0 + 1 + i + 0.9 }));
}

describe.each(SCENARIOS)('fan handshake %j', (kw) => {
  it('found', () => {
    const p = run({ device: 'fan', handshake: true, ...kw });
    const hs = p.handshake;
    expect(hs.map((s) => s.request.slice(0, 8))).toEqual(['5a 00 01', '5a 00 02', '5a 00 03']); // polls are not in it
    expect(hs.map((s) => s.expect)).toEqual(['a5 01 ?? ?? ?? ?? ??', 'a5 02 01 ??', 'a5 03 01 ??']);
    expect(hs[0].tokens).toEqual([{ reply_offset: 2, width: 4, used_by: [{ step: 2, offset: 3 }] }]);
    expect(hs[1].uses).toEqual([{ step: 1, reply_offset: 2, offset: 3, width: 4 }]);
    expect(hs.every((s) => s.request_checksum.algo === 'crc16_modbus')).toBe(true);
    expect(hs.every((s) => s.reply_checksum.algo === 'sum8')).toBe(true);
    expect(p.commands.map((c) => c.name)).toEqual(['fan', 'color', 'mode']); // the actions are unchanged
    if (kw.observe) expect(p.observations.every((o) => o.matched.length > 0)).toBe(true);
  });

  it('sent again is a reopen', () => {
    const base = run({ device: 'fan', handshake: true, ...kw });
    const p = run({ device: 'fan', handshake: true, reopen: true, ...kw });
    expect(p.handshake.map((s) => s.request.slice(0, 8))).toEqual(['5a 00 01', '5a 00 02', '5a 00 03']);
    expect(p.handshake.map((s) => s.reopens.length)).toEqual([1, 1, 1]);
    expect(p.handshake.map((s) => s.expect)).toEqual(base.handshake.map((s) => s.expect));
    expect(sig(p)).toEqual(sig(base));
    expect(render(p)).toContain('sent the whole handshake again later');
    JSON.stringify(p.to_dict());
  });

  it('branch on reply byte', () => {
    const base = run({ device: 'fan', handshake: true, ...kw });
    const p = run({ device: 'fan', handshake: true, branch: true, ...kw });
    const hs = p.handshake;
    expect(hs.map((s) => s.request.slice(0, 8))).toEqual(['5a 00 01', '5a 00 02', '5a 00 03']);
    expect(hs.map((s) => s.reopens.length)).toEqual([2, 2, 1]); // start was only sent again in the 01 session
    expect(hs[1].expect).toBe('a5 02 ?? ??');
    expect('branches' in hs[0]).toBe(false);
    expect('branches' in hs[2]).toBe(false);
    const br = hs[1].branches;
    expect([br.offset, br.default]).toEqual([2, '01']);
    expect(Object.keys(br.cases)).toEqual(['01', '02']);
    expect(br.cases['01'].main).toBe(true);
    expect(br.cases['01'].count).toBe(2);
    const two = br.cases['02'];
    expect([two.count, two.main]).toEqual([1, false]);
    expect(two.steps.map((x) => [x.step, x.request.slice(0, 11), x.expect])).toEqual([
      [3, '5a 00 04 01', 'a5 04 01 ??'], [4, '5a 00 03 01', 'a5 03 01 ??']]);
    expect(two.steps.every((x) => x.request_checksum.algo === 'crc16_modbus')).toBe(true);
    expect(sig(p)).toEqual(sig(base)); // branch messages are not actions
    const md = render(p);
    expect(md).toContain('Step 2 branches on reply byte 2');
    expect(md).toContain('falls back to the most common one (`01`)');
    JSON.stringify(p.to_dict());
  });
});

describe('handshake', () => {
  it('no handshake without session setup', () => {
    expect(run({ device: 'fan', poll: 0.5 }).handshake).toEqual([]);
    expect(run({}).handshake).toEqual([]);
  });

  it('report and json', () => {
    const p = run({ device: 'fan', handshake: true });
    const md = render(p);
    expect(md).toContain('## Handshake (sent once, before the first action)');
    expect(md).toContain('| 2 | bulk EP 0x01 | `5a 00 02');
    expect(md).toContain('Step 2 request bytes 3-6 repeat bytes 2-5');
    const d = JSON.parse(JSON.stringify(p.to_dict()));
    expect(d.handshake.length).toBe(3);
    expect(d.handshake[1].uses[0].offset).toBe(3);
  });

  it('a message sent again later is not handshake', () => {
    const w = new UsbmonWriter();
    w.control_in(T0, GET_DESC(), device_descriptor());
    w.out(T0 + 0.1, 0x01, B(0x10, 0x01, 0x02, 0x03)); // hello, once
    w.in_(T0 + 0.105, 0x81, B(0x90, 0x00));
    w.out(T0 + 0.2, 0x01, B(0x20, 0, 0, 0)); // status, also sent later
    const marks = [];
    [10, 20, 30, 40].forEach((v, i) => {
      const t = T0 + 1 + i;
      w.out(t + 0.3, 0x01, B(0x30, v, 0, 0));
      if (i === 2) w.out(t + 0.6, 0x01, B(0x20, 0, 0, 0));
      marks.push({ label: `level ${v}`, start: t, end: t + 0.9 });
    });
    const hs = done(w, marks).handshake;
    expect(hs.map((s) => s.request)).toEqual(['10 01 02 03']);
    expect(hs[0].reply).toBe('90 00');
    expect(hs[0].request_checksum).toBeNull();
    expect(hs[0].expect).toBe('90 00');
  });

  it('partial repeat is not a reopen', () => {
    const w = new UsbmonWriter();
    w.control_in(T0, GET_DESC(), device_descriptor());
    w.out(T0 + 0.1, 0x01, B(0x10, 0x01, 0x02, 0x03));
    w.in_(T0 + 0.105, 0x81, B(0x90, 0x00));
    w.out(T0 + 0.2, 0x01, B(0x11, 0, 0, 0));
    w.in_(T0 + 0.205, 0x81, B(0x91, 0x00));
    const marks = [];
    [10, 20, 30, 40].forEach((v, i) => {
      const t = T0 + 1 + i;
      w.out(t + 0.3, 0x01, B(0x30, v, 0, 0));
      if (i === 2) w.out(t + 0.6, 0x01, B(0x10, 0x01, 0x02, 0x03));
      marks.push({ label: `level ${v}`, start: t, end: t + 0.9 });
    });
    const hs = done(w, marks).handshake;
    expect(hs.map((s) => s.request)).toEqual(['11 00 00 00']);
    expect(hs[0].reopens).toEqual([]);
  });
});

function tokenCapture() {
  // open: 01 00 00 00 -> 81 <token 4> ; every command 02 <token 4> <level>.
  const w = new UsbmonWriter();
  w.control_in(T0, GET_DESC(), device_descriptor());
  const token = B(0x12, 0x34, 0x56, 0x78);
  w.out(T0 + 0.1, 0x01, B(0x01, 0, 0, 0));
  w.in_(T0 + 0.103, 0x81, B(0x81, ...token));
  const marks = [];
  [10, 20, 30, 40].forEach((v, i) => {
    const t = T0 + 1 + i;
    w.out(t + 0.3, 0x01, B(0x02, ...token, v));
    marks.push({ label: `level ${v}`, start: t, end: t + 0.9 });
  });
  return done(w, marks);
}

describe('session tokens and retries', () => {
  it('token reused by commands', () => {
    const p = tokenCapture();
    const hs = p.handshake;
    expect(hs[0].tokens).toEqual([{ reply_offset: 1, width: 4, used_by: [{ command: 'level', packet: 0, offset: 1 }] }]);
    expect(hs[0].expect).toBe('81 ?? ?? ?? ??');
    expect(p.commands[0].notes.some((n) => n.includes('session token'))).toBe(true);
    expect(render(p)).toContain('Command `level` bytes 1-4 repeat bytes 1-4 of the reply to step 1');
  });

  function retryCapture() {
    // hello sent twice (first copy unanswered), auth answered 'busy' once and resent, then commands.
    const w = new UsbmonWriter();
    w.control_in(T0, GET_DESC(), device_descriptor());
    const token = B(0x12, 0x34, 0x56, 0x78);
    w.out(T0 + 0.1, 0x01, B(0x01, 0, 0, 0)); // hello, no reply
    w.out(T0 + 0.35, 0x01, B(0x01, 0, 0, 0)); // hello again
    w.in_(T0 + 0.353, 0x81, B(0x81, ...token));
    w.out(T0 + 0.4, 0x01, B(0x03, ...token)); // auth
    w.in_(T0 + 0.403, 0x81, B(0xe0, 0x01)); // busy
    w.out(T0 + 0.5, 0x01, B(0x03, ...token)); // auth again
    w.in_(T0 + 0.503, 0x81, B(0x83, 0x00));
    const marks = [];
    [10, 20, 30, 40].forEach((v, i) => {
      const t = T0 + 1 + i;
      w.out(t + 0.3, 0x01, B(0x02, ...token, v));
      marks.push({ label: `level ${v}`, start: t, end: t + 0.9 });
    });
    return done(w, marks);
  }

  it('retries are one step', () => {
    const p = retryCapture();
    const hs = p.handshake;
    expect(hs.map((s) => s.request)).toEqual(['01 00 00 00', '03 12 34 56 78']);
    expect(hs.map((s) => s.retries.length)).toEqual([1, 1]);
    expect(hs[0].retries[0].reply).toBeNull();
    expect(hs[1].retries[0].reply).toBe('e0 01');
    expect(hs[0].reply).toBe('81 12 34 56 78');
    expect(hs[1].reply).toBe('83 00');
    expect(hs[1].uses).toEqual([{ step: 1, reply_offset: 1, offset: 1, width: 4 }]);
    expect(render(p)).toContain('Step 1 was sent 2 times in a row');
  });
});

describe('branches from hand-built captures', () => {
  /** hello -> 90 00 <id 3>, start; between two actions hello again, answered `second`, then 12 00 00. */
  function branchCapture(second) {
    const w = new UsbmonWriter();
    w.control_in(T0, GET_DESC(), device_descriptor());
    w.out(T0 + 0.1, 0x01, B(0x10, 0x01, 0, 0));
    w.in_(T0 + 0.103, 0x81, B(0x90, 0, 0, 0));
    w.out(T0 + 0.2, 0x01, B(0x11, 0, 0, 0));
    w.in_(T0 + 0.203, 0x81, B(0x91, 0));
    const marks = [];
    [10, 20, 30, 40].forEach((v, i) => {
      const t = T0 + 1 + 1.5 * i;
      if (i === 2) {
        w.out(t - 0.3, 0x01, B(0x10, 0x01, 0, 0));
        w.in_(t - 0.297, 0x81, second);
        w.out(t - 0.2, 0x01, B(0x12, 0, 0, 0));
        w.in_(t - 0.197, 0x81, B(0x92, 0));
      }
      w.out(t + 0.3, 0x01, B(0x30, v, 0, 0));
      marks.push({ label: `level ${v}`, start: t, end: t + 0.9 });
    });
    return done(w, marks);
  }

  it('other messages after the same reply are not a branch', () => {
    const p = branchCapture(B(0x90, 0, 0, 0));
    expect(p.handshake.map((s) => s.request)).toEqual(['11 00 00 00']);
    expect(p.handshake.some((s) => s.branches)).toBe(false);
  });

  it('branch on a mode byte', () => {
    const p = branchCapture(B(0x90, 0x01, 0, 0));
    const hs = p.handshake;
    expect(hs.map((s) => s.request)).toEqual(['10 01 00 00', '11 00 00 00']);
    expect(hs[0].expect).toBe('90 ?? 00 00');
    const cases = hs[0].branches.cases;
    expect(hs[0].branches.offset).toBe(1);
    expect(Object.keys(cases)).toEqual(['00', '01']);
    expect(cases['01'].steps.map((x) => x.request)).toEqual(['12 00 00 00']);
    expect(p.commands.map((c) => c.name)).toEqual(['level']);
    expect(p.commands[0].samples.length).toBe(4);
  });
});
