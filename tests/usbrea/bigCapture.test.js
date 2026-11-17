import { describe, it, expect } from 'vitest';
import { UsbmonWriter, encode, make_capture } from '../../src/utils/usbrea/synth.js';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { read_transfers } from '../../src/utils/usbrea/pcap.js';
import { assign } from '../../src/utils/usbrea/actions.js';
import { minOf, maxOf } from '../../src/utils/usbrea/bytes.js';
import { run_job } from '../../src/utils/usbrea/worker.js';

function bigCapture(n) {
  const w = new UsbmonWriter(1, 5);
  const t0 = 1_700_000_000;
  const vals = [0, 50, 100];
  let seed = 12345; // deterministic jitter so the traffic is not mistaken for a periodic keep-alive
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let t = t0;
  for (let i = 0; i < n; i++) {
    const v = vals[Math.floor(i / (n / 3))];
    t += 0.0005 + rnd() * 0.001;
    w.out(t, 0x01, encode('brightness', v));
  }
  const dur = t - t0 + 0.001;
  const markers = vals.map((v, k) => ({ label: `brightness ${v}%`, start: t0 + (k * dur) / 3, end: t0 + ((k + 1) * dur) / 3 - 0.0005 }));
  return { bytes: w.to_bytes(), markers, t0, dur };
}

describe('big captures', () => {
  it('minOf / maxOf handle huge arrays and NaN', () => {
    const a = new Array(500000).fill(0).map((_, i) => i);
    expect(minOf(a)).toBe(0);
    expect(maxOf(a)).toBe(499999);
    expect(minOf([])).toBe(Infinity);
    expect(Number.isNaN(minOf([1, NaN]))).toBe(true);
  });

  it('analyzes >150k transfers without RangeError, reporting progress', () => {
    const { bytes, markers } = bigCapture(160000);
    expect(read_transfers(bytes).length).toBeGreaterThan(150000);
    const stages = [];
    const proto = analyze(bytes, markers, null, null, { onProgress: (s) => stages.push(s) });
    expect(Array.isArray(proto.commands)).toBe(true);
    expect(stages[0]).toBe('Reading capture');
    expect(stages[stages.length - 1]).toBe('Done');
  }, 120000);

  it('run_job posts progress then a result', async () => {
    const { capture, markers } = make_capture({});
    const msgs = [];
    await run_job({ id: 1, bytes: capture, name: 'x.pcap', markers }, (m) => msgs.push(m));
    expect(msgs.some((m) => m.type === 'progress')).toBe(true);
    const last = msgs[msgs.length - 1];
    expect(last.type).toBe('result');
    expect(last.outputs.report.length).toBeGreaterThan(0);
  });

  it('run_job reports errors instead of throwing', async () => {
    const msgs = [];
    await run_job({ id: 2, bytes: new Uint8Array([1, 2, 3, 4]), name: 'x', markers: [] }, (m) => msgs.push(m));
    expect(msgs[msgs.length - 1].type).toBe('error');
  });

  it('a truncated capture loads the good part and reports the frame', () => {
    const { capture } = make_capture({});
    const full = read_transfers(capture);
    const info = {};
    const cut = read_transfers(capture.subarray(0, capture.length - 10), info);
    expect(info.truncated_at).toBe(info.frames + 1);
    expect(cut.length).toBeLessThanOrEqual(full.length);
    expect(cut.length).toBeGreaterThan(0);
    const clean = {};
    read_transfers(capture, clean);
    expect(clean.truncated_at).toBeNull();
  });

  it('the marker offset shifts assignment', () => {
    const { capture } = make_capture({});
    const ts = read_transfers(capture).filter((t) => t.is_out && t.data.length);
    const first = ts[0].ts;
    const marks = [{ label: 'a', start: first - 5, end: first - 4 }];
    expect(assign(ts, marks)[0].transfers.length).toBe(0);
    expect(assign(ts, marks, 5)[0].transfers.length).toBeGreaterThan(0);
  });
});
