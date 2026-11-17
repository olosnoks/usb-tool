// Capture-level tests from usb-rea test_responses.py and test_observations.py (through pipeline.analyze and
// synth.make_capture). Report, scaffold and generated-driver assertions of the originals belong to the
// report.js / scaffold.js tests.
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import {
  FAN_ACTIONS, PyRandom, UsbmonWriter, capture_from_messages, device_descriptor, make_capture,
} from '../../src/utils/usbrea/synth.js';

const by = (p) => Object.fromEntries(p.responses.map((r) => [r.query, r]));
const roles = (r) => Object.fromEntries(r.fields.map((f) => [f.offset, f]));

describe('device replies', () => {
  for (const [period, transport] of [[0.25, 'bulk'], [0.7, 'bulk'], [0.5, 'control']]) {
    it(`fan status poll reply (${period}, ${transport})`, () => {
      const { capture, markers } = make_capture({ device: 'fan', poll: period, transport });
      const p = analyze(capture, markers);
      const r = by(p)['poll 1'];
      expect(r.source).toBe('background');
      expect(r.answered).toBe(r.queries);
      expect(r.answered).toBe(p.background[0].count);
      const f = roles(r);
      expect([f[0].kind, f[0].const]).toEqual(['const', 0xa5]);
      expect([f[1].kind, f[1].echo, f[1].const]).toEqual(['echo', 2, 0x40]); // echoed command id
      expect([f[2].kind, f[2].width, f[2].endian]).toEqual(['reading', 2, 'le']); // current RPM
      expect(f[2].limits[0]).toBeGreaterThanOrEqual(988 - 200);
      expect(f[2].limits[1]).toBeLessThanOrEqual(4012);
      expect([f[4].kind, f[4].width]).toEqual(['reading', 1]);
      expect(f[4].limits[0]).toBeGreaterThanOrEqual(35);
      expect(f[4].limits[1]).toBeLessThanOrEqual(45);
      expect([f[6].kind, f[6].algo, f[6].covers]).toEqual(['checksum', 'sum8', [0, 6]]);
      expect(r.explained).toBe(4);
      expect(r.notes.some((n) => n.includes('no label to explain'))).toBe(true);
    });
  }

  it('poll replies also with labels', () => {
    const { capture } = make_capture({ device: 'fan', poll: 0.25 });
    const p = analyze(capture, null, null, FAN_ACTIONS);
    expect(p.commands.map((c) => c.name)).toEqual(['fan', 'color', 'mode']);
    expect(roles(by(p)['poll 1'])[2].kind).toBe('reading');
  });

  it('command reply fitted to label', () => {
    const { capture, markers } = make_capture({ device: 'fan' });
    const r = by(analyze(capture, markers));
    const f = roles(r.fan);
    expect([f[1].kind, f[1].const, f[1].echo]).toEqual(['echo', 0x10, 2]);
    expect([f[2].kind, f[2].echo, f[2].const]).toEqual(['echo', 1, null]); // sequence number echoed
    expect([f[3].kind, f[3].width, f[3].endian, f[3].scale, f[3].bias]).toEqual(['value', 2, 'le', 1.0, 0.0]);
    expect([f[5].kind, f[5].covers]).toEqual(['checksum', [0, 5]]);
    expect([roles(r.mode)[3].kind, roles(r.mode)[3].echo]).toEqual(['echo', 3]);
    expect(r.fan.samples.map((s) => s[0])).toEqual(['fan 800', 'fan 1200', 'fan 2650', 'fan 4000']);
  });

  it('a poll between a command and its reply does not steal it', () => {
    // at 0.25 s the synthetic polls land a few ms before or after every click: replies must not swap
    const { capture, markers } = make_capture({ poll: 0.25 });
    const r = by(analyze(capture, markers));
    for (const [name, cmd] of [['brightness', 1], ['power', 2], ['hue', 3]]) {
      const f = roles(r[name])[1];
      expect([f.kind, f.const, f.echo]).toEqual(['echo', cmd, 1]);
    }
    expect(roles(r['poll 1'])[1].const).toBe(0x10);
  });

  it('sequence poll reply echoes the counter', () => {
    const { capture, markers } = make_capture({ poll: 0.7, poll_seq: true });
    const p = analyze(capture, markers);
    const r = by(p)['poll 1'];
    const f = roles(r);
    expect([f[2].kind, f[2].echo]).toEqual(['echo', 2]);
    expect(r.query_payload).toBe('aa 10 ?? 00 ??');
    const kinds = Object.fromEntries(r.request.fields.map((x) => [x.offset, x.kind]));
    expect([kinds[2], kinds[4]]).toEqual(['counter', 'checksum']);
  });

  // Commands 'level N' (bulk OUT) answered with an ACK whose last byte is random, plus a
  // GET_REPORT(Input, id 3) every 0.4 s answered with 03 <temp> 00.
  function getreportCapture() {
    const rnd = new PyRandom(3);
    const w = new UsbmonWriter();
    let t = 1_760_000_000.0;
    w.control_in(t, Uint8Array.of(0x80, 6, 0, 1, 0, 0, 18, 0), device_descriptor());
    t += 0.5;
    const marks = [];
    let temp = 30;
    for (const v of [0, 10, 20, 30, 40, 50]) {
      w.out(t + 0.3, 0x02, Uint8Array.of(0x40, v, 0x00));
      w.in_(t + 0.305, 0x82, Uint8Array.of(0x41, rnd.randrange(0, 256)));
      marks.push({ label: `level ${v}`, start: t, end: t + 1.0 });
      t += 1.5;
    }
    let tp = 1_760_000_000.2;
    while (tp < t) {
      temp = Math.min(40, Math.max(25, temp + rnd.choice([-1, 0, 1])));
      w.control_in(tp, Uint8Array.of(0xa1, 0x01, 0x03, 0x01, 0, 0, 3, 0), Uint8Array.of(0x03, temp, 0x00));
      tp += 0.4;
    }
    return { capture: w.save(), markers: marks };
  }

  it('GET_REPORT and unexplained reply bytes', () => {
    const { capture, markers } = getreportCapture();
    const p = analyze(capture, markers);
    const r = by(p);
    const g = r['GET_REPORT Input 0x03'];
    expect(g.source).toBe('control read');
    expect(g.answered).toBe(g.queries);
    expect(g.answered).toBeGreaterThan(10);
    const f = roles(g);
    expect(f[0].const).toBe(3);
    expect(f[1].kind).toBe('reading');
    expect(f[1].limits[0]).toBeGreaterThanOrEqual(25);
    expect(f[2].const).toBe(0);
    const lv = roles(r.level);
    expect(lv[0].const).toBe(0x41);
    expect(lv[1].kind).toBe('reading');
    expect(r.level.notes.some((n) => n.includes('do not follow the action values'))).toBe(true);
  });

  it('no replies, no section', () => {
    const msgs = [0, 10, 20, 30].map((v) => [`level ${v}`, Uint8Array.of(0x12, v), ['bulk', 2]]);
    const { capture, markers } = capture_from_messages(msgs, 0x1234, 0x5678);
    expect(analyze(capture, markers).responses).toEqual([]);
  });

  it('json output', () => {
    const { capture, markers } = make_capture({ device: 'fan', poll: 0.5 });
    const d = JSON.parse(JSON.stringify(analyze(capture, markers).to_dict()));
    const poll = d.responses.find((r) => r.query === 'poll 1');
    expect(poll.request.setup).toBeNull();
    expect(poll.fields[2].kind).toBe('reading');
  });
});

describe('observations through make_capture', () => {
  it('fan readings are named', () => {
    const plain = analyze(...Object.values(make_capture({ device: 'fan', poll: 0.5 })));
    const seen = analyze(...Object.values(make_capture({ device: 'fan', poll: 0.5, observe: true })));
    // observation markers are not actions: commands, background and segmentation are unchanged
    const sig = (p) => p.commands.map((c) => [c.name, c.samples, c.fields.map((f) => f.describe())]);
    expect(sig(seen)).toEqual(sig(plain));
    expect(seen.unmatched).toEqual([]);
    expect(plain.unmatched).toEqual([]);
    expect(seen.background).toEqual(plain.background);
    const r = seen.responses.find((x) => /^(poll|GET_REPORT)/.test(x.query));
    const n = Object.fromEntries(r.fields.filter((f) => f.name).map((f) => [f.name, f]));
    expect([n.rpm.offset, n.rpm.width, n.rpm.endian, n.rpm.scale, n.rpm.bias]).toEqual([2, 2, 'le', 1.0, 0.0]);
    expect([n.temp.offset, n.temp.width, n.temp.kind]).toEqual([4, 1, 'reading']);
    expect(n.rpm.observed.every(([v, raw]) => raw === v)).toBe(true);
    expect(r.explained).toBe(7);
    expect(seen.observations).toHaveLength(21);
    expect(seen.observations.every((o) => o.matched.length)).toBe(true);
    expect(n.mode.offset).toBe(5);
    expect(n.mode.table).toEqual(new Map([[0x00, 'auto'], [0x11, 'silent'], [0x22, 'balanced'], [0x47, 'turbo']]));
    expect(r.notes.some((x) => x.includes('no label to explain'))).toBe(false);
    const d = JSON.parse(JSON.stringify(seen.to_dict()));
    expect(d.observations[0].matched).toEqual(['poll 1 bytes 2-3']);
  });

  it('observations never become commands', () => {
    const { capture, markers } = make_capture({ device: 'fan', poll: 0.5, observe: true });
    let p = analyze(capture, markers);
    expect(p.commands.map((c) => c.name)).toEqual(['fan', 'color', 'mode']);
    expect(p.commands.some((c) => c.samples.some((s) => s[0].includes('seen')))).toBe(false);
    // --labels mode: a 'seen' label has no timestamp, so it is skipped
    p = analyze(capture, null, null, [...FAN_ACTIONS.slice(0, 4), 'seen rpm 1200', ...FAN_ACTIONS.slice(4)]);
    expect(p.commands.map((c) => c.name)).toEqual(['fan', 'color', 'mode']);
    expect(p.observations).toEqual([]);
  });
});
