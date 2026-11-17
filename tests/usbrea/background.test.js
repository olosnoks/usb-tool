import { describe, it, expect } from 'vitest';
import {
  find_background, drop_background, segment_by_gaps, assign, load_markers, append_marker, observations,
  pattern, read_labels, commands_of,
} from '../../src/utils/usbrea/actions.js';
import { read_transfers } from '../../src/utils/usbrea/pcap.js';
import { capture_from_messages, make_capture, PyRandom } from '../../src/utils/usbrea/synth.js';
import { hex } from '../../src/utils/usbrea/bytes.js';

const LAMP = ['brightness 0%', 'brightness 25%', 'brightness 50%', 'brightness 75%', 'brightness 100%',
  'power off', 'power on', 'hue 0', 'hue 120', 'hue 240'];

describe('background traffic', () => {
  it.each([0.25, 0.7, 2.0])('finds the status poll (period %s)', (period) => {
    const { capture } = make_capture({ poll: period });
    const all = read_transfers(capture);
    const bg = find_background(all);
    expect(bg.length).toBe(1);
    expect(hex(bg[0].data, ' ')).toBe('aa 10 00 00 ba');
    expect(bg[0].mask).toEqual([]);
    expect(bg[0].period).toBeCloseTo(period, 1);
    // dropping it leaves exactly the clean capture's host->device messages
    const rest = drop_background(all, bg).filter((t) => t.is_out && t.data.length);
    expect(rest.length).toBe(10);
  });

  it('finds polls with a sequence number', () => {
    for (const period of [0.25, 0.7]) {
      const { capture } = make_capture({ poll: period, poll_seq: true });
      const bg = find_background(read_transfers(capture));
      expect(bg.length).toBe(1);
      expect(pattern(bg[0].data, bg[0].mask)).toBe('aa 10 ?? 00 ??');
    }
  });

  it('polls break naive segmentation', () => {
    const { capture } = make_capture({ poll: 0.25 });
    const marks = segment_by_gaps(read_transfers(capture), LAMP);
    expect(Math.max(...marks.map((m) => m.end - m.start))).toBeGreaterThan(1.0);
  });

  it('a constant apply packet is not background', () => {
    const msgs = [0, 10, 20, 30, 40, 50].map((v) => [`level ${v}`,
      [Uint8Array.from([0x12, 0x34, v, 0]), Uint8Array.from([0x12, 0x99, 1, 0])], ['bulk', 2]]);
    for (const v of [0, 1, 2]) msgs.push([`mode ${v}`, Uint8Array.from([0x30, v]), ['bulk', 2]]);
    const { capture } = capture_from_messages(msgs, 0x1234, 0x5678);
    expect(find_background(read_transfers(capture))).toEqual([]);
  });

  it('a value stepped by one is not background', () => {
    const msgs = [0, 1, 2, 3, 4, 5, 6].map((v) => [`level ${v}`, Uint8Array.from([0x40, 0x01, v, (0x41 + v) & 0xFF]), ['bulk', 2]]);
    const { capture } = capture_from_messages(msgs, 0x1234, 0x5678);
    expect(find_background(read_transfers(capture))).toEqual([]);
  });

  it('no polls, no background', () => {
    const { capture } = make_capture({ device: 'fan' });
    expect(find_background(read_transfers(capture))).toEqual([]);
  });
});

describe('segment_by_gaps / assign', () => {
  it('labels without markers match the marked analysis', () => {
    const { capture, markers } = make_capture({ device: 'fan' });
    const ts = read_transfers(capture);
    const acts = assign(ts, load_markers(markers));
    const labels = acts.map((a) => a.label);
    const seg = segment_by_gaps(ts, labels);
    const acts2 = assign(ts, seg);
    expect(acts2.map((a) => commands_of(a).map((t) => t.frame))).toEqual(acts.map((a) => commands_of(a).map((t) => t.frame)));
  });

  it('too many labels raise', () => {
    const { capture } = make_capture({ actions: ['brightness 0%', 'brightness 50%'] });
    expect(() => segment_by_gaps(read_transfers(capture), ['a 1', 'a 2', 'a 3'])).toThrow(/3 labels but only 2/);
  });
});

describe('markers', () => {
  it('load_markers fills open ends and observations', () => {
    const m = load_markers(JSON.stringify([
      { label: 'b 2', start: 2.0, end: null }, { label: 'a 1', start: 1.0 },
      { label: 'seen rpm 1180', start: 1.5 }, { label: 'c 3', start: 3.0, end: 4.0 }]));
    expect(m.map((x) => x.label)).toEqual(['a 1', 'seen rpm 1180', 'b 2', 'c 3']);
    expect(m[0].end).toBe(2.0);
    expect(m[1].end).toBe(1.5);
    expect(m[2].end).toBe(3.0);
    expect(observations(m, 1.0)).toEqual([{ label: 'seen rpm 1180', ts: 1.5, time: 0.5, name: 'rpm', value: 1180 }]);
    const last = load_markers([{ label: 'x 1', start: 1 }]);
    expect(last[0].end).toBe(Infinity);
  });

  it('append_marker closes the open action; observations do not', () => {
    const marks = [];
    append_marker(marks, 'a 1', 10);
    append_marker(marks, 'seen x 1', 11);
    expect(marks[0].end).toBeNull();
    append_marker(marks, 'b 2', 12);
    expect(marks[0].end).toBe(12);
    expect(marks[1]).toEqual({ label: 'seen x 1', start: 11, end: 11 });
  });

  it('read_labels', () => {
    expect(read_labels('a 1; b 2;;c 3')).toEqual(['a 1', 'b 2', 'c 3']);
    expect(read_labels('# clicked in order\na 1\n\nb 2\n')).toEqual(['a 1', 'b 2']);
  });
});

describe('PyRandom matches CPython', () => {
  it('random() values', () => {
    expect(new PyRandom(0).random()).toBe(0.8444218515250481);
    expect(new PyRandom(1).random()).toBe(0.13436424411240122);
    expect(new PyRandom(42).random()).toBe(0.6394267984578837);
  });
  it('randint / randbytes', () => {
    const r = new PyRandom(0);
    expect([r.randint(1, 10), r.randint(1, 10), r.randint(1, 10)]).toEqual([7, 7, 1]);
    expect(Array.from(new PyRandom(7).randbytes(4)).length).toBe(4);
  });
});
