import { describe, it, expect } from 'vitest';
import { gzip } from 'pako';
import { read_transfers, find_ids, iter_packets, USBPCAP } from '../../src/utils/usbrea/pcap.js';
import { make_capture, encode, VID, PID } from '../../src/utils/usbrea/synth.js';
import { concat, eq } from '../../src/utils/usbrea/bytes.js';

describe('pcap', () => {
  it('parses a synthetic capture', () => {
    const { capture } = make_capture({});
    const ts = read_transfers(capture);
    const outs = ts.filter((t) => t.is_out && t.data.length);
    expect(outs.length).toBe(10);
    expect(eq(outs[2].data, encode('brightness', 50))).toBe(true);
    expect(outs[2].endpoint).toBe(0x01);
    expect(outs[2].kind).toBe('bulk');
    expect(find_ids(ts)).toEqual({ 5: [VID, PID] });
    // frame numbers are 1-based and increasing
    expect(ts[0].frame).toBeGreaterThanOrEqual(1);
    for (let i = 0; i + 1 < ts.length; i++) expect(ts[i].frame).toBeLessThan(ts[i + 1].frame);
  });

  it('parses the control transport', () => {
    const { capture } = make_capture({ transport: 'control' });
    const outs = read_transfers(capture).filter((t) => t.is_out && t.data.length);
    expect(outs[0].kind).toBe('control');
    expect(Array.from(outs[0].setup.subarray(0, 2))).toEqual([0x21, 0x09]);
    expect(outs[0].data[0]).toBe(0xAA);
  });

  function toPcapng(raw) {
    const blk = (t, body) => {
      const pad = (-body.length % 4 + 4) % 4;
      const b = new Uint8Array(body.length + pad);
      b.set(body);
      const n = 12 + b.length;
      const head = new Uint8Array(8);
      const hv = new DataView(head.buffer);
      hv.setUint32(0, t, true);
      hv.setUint32(4, n, true);
      const tail = new Uint8Array(4);
      new DataView(tail.buffer).setUint32(0, n, true);
      return concat(head, b, tail);
    };
    const shb = new Uint8Array(16);
    const sv = new DataView(shb.buffer);
    sv.setUint32(0, 0x1A2B3C4D, true); sv.setUint16(4, 1, true); sv.setUint16(6, 0, true); sv.setBigInt64(8, -1n, true);
    const idb = new Uint8Array(8);
    const iv = new DataView(idb.buffer);
    iv.setUint16(0, 220, true); iv.setUint32(4, 65535, true);
    const parts = [blk(0x0A0D0D0A, shb), blk(1, idb)];
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    let off = 24;
    while (off < raw.length) {
      const s = dv.getUint32(off, true); const us = dv.getUint32(off + 4, true);
      const inc = dv.getUint32(off + 8, true); const orig = dv.getUint32(off + 12, true);
      const tsv = BigInt(s) * 1000000n + BigInt(us);
      const eh = new Uint8Array(20);
      const ev = new DataView(eh.buffer);
      ev.setUint32(0, 0, true);
      ev.setUint32(4, Number(tsv >> 32n), true);
      ev.setUint32(8, Number(tsv & 0xFFFFFFFFn), true);
      ev.setUint32(12, inc, true);
      ev.setUint32(16, orig, true);
      parts.push(blk(6, concat(eh, raw.subarray(off + 16, off + 16 + inc))));
      off += 16 + inc;
    }
    return concat(...parts);
  }

  it('reads pcapng the same as pcap', () => {
    const { capture } = make_capture({ noise: false });
    const a = read_transfers(capture).map((t) => t.data);
    const b = read_transfers(toPcapng(capture)).map((t) => t.data);
    expect(b.length).toBe(a.length);
    a.forEach((d, i) => expect(eq(d, b[i])).toBe(true));
  });

  it('reads gzip-compressed captures', () => {
    const { capture } = make_capture({ noise: false });
    const a = read_transfers(capture);
    const b = read_transfers(gzip(capture));
    expect(b.length).toBe(a.length);
    expect(b.map((t) => t.ts)).toEqual(a.map((t) => t.ts));
    expect(find_ids(b)).toEqual({ 5: [VID, PID] });
  });

  it('rejects non-pcap data', () => {
    expect(() => [...iter_packets(Uint8Array.from([1, 2, 3, 4, 5, 6]))]).toThrow(/not a pcap/);
  });

  it('parses USBPcap bulk records', () => {
    const rec = (info, ep, payload) => {
      const h = new Uint8Array(27);
      const v = new DataView(h.buffer);
      v.setUint16(0, 27, true);
      h[16] = info;
      v.setUint16(17, 1, true);
      v.setUint16(19, 7, true);
      h[21] = ep;
      h[22] = 3; // bulk
      v.setUint32(23, payload.length, true);
      return concat(h, Uint8Array.from(payload));
    };
    const recs = [rec(0, 0x02, [1, 2, 3]), rec(1, 0x81, [9, 8]), rec(1, 0x02, [5]), rec(0, 0x02, [])];
    const parts = [];
    const gh = new Uint8Array(24);
    const gv = new DataView(gh.buffer);
    gv.setUint32(0, 0xA1B2C3D4, true); gv.setUint16(4, 2, true); gv.setUint16(6, 4, true);
    gv.setUint32(16, 65535, true); gv.setUint32(20, USBPCAP, true);
    parts.push(gh);
    recs.forEach((r, i) => {
      const rh = new Uint8Array(16);
      const rv = new DataView(rh.buffer);
      rv.setUint32(0, 100 + i, true); rv.setUint32(8, r.length, true); rv.setUint32(12, r.length, true);
      parts.push(rh, r);
    });
    const ts = read_transfers(concat(...parts));
    expect(ts.length).toBe(2);
    expect(ts[0].is_out && ts[0].device === 7 && ts[0].endpoint === 0x02).toBe(true);
    expect(Array.from(ts[0].data)).toEqual([1, 2, 3]);
    expect(ts[1].is_in).toBe(true);
    expect(ts[1].frame).toBe(2);
    expect(ts[1].ts).toBe(101);
  });
});
