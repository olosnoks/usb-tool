// Ports of the pure-stream tests of usb-rea: test_streams.py, test_bmp_streams.py, test_webp_streams.py,
// test_raw_streams.py and test_multi_endpoint_streams.py (the parts that do not go through analyze/scaffold/report).
import { describe, it, expect } from 'vitest';
import { Transfer } from '../../src/utils/usbrea/model.js';
import { ascii, concat, hex } from '../../src/utils/usbrea/bytes.js';
import {
  _ended, _region, _rgb565_order, _size, describe as describeStream, find_streams, drop_streams, testcard,
  write_testcard,
} from '../../src/utils/usbrea/streams.js';
import { UsbmonWriter, device_descriptor, fake_bmp, fake_jpeg, fake_webp, gradient, lcd_frames } from '../../src/utils/usbrea/synth.js';
import { read_transfers } from '../../src/utils/usbrea/pcap.js';

const _t = (frame, ts, ep, data, xfer = 3) => new Transfer({ frame, ts, bus: 1, device: 2, endpoint: ep, xfer_type: xfer, setup: null, data });
const be32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);
const range = (a, b) => Uint8Array.from({ length: b - a }, (_, i) => a + i);

describe('jpeg / png streams', () => {
  it('png stream without header and jpeg thumbnail', () => {
    // raw PNG files written back to back on a bulk endpoint, no per-packet header
    const body = range(1, 200);
    const png = concat(Uint8Array.of(0x89), ascii('PNG\r\n'), Uint8Array.of(0x1a, 0x0a), Uint8Array.of(0, 0, 0, 0x0d), ascii('IHDR'),
      be32(480), be32(272), body, body, body, Uint8Array.of(0, 0, 0, 0), ascii('IEND'), Uint8Array.of(0xae, 0x42, 0x60, 0x82));
    const ts = [];
    let n = 0;
    for (let f = 0; f < 4; f++) {
      for (let k = 0; k < png.length; k += 256) {
        n += 1;
        ts.push(_t(n, f + k / 1e4, 0x02, png.slice(k, k + 256)));
      }
    }
    n += 1;
    ts.push(_t(n, 10.0, 0x02, Uint8Array.of(0x05, 0x01, 0x40))); // a command on the same endpoint stays out of the stream
    const found = find_streams(ts);
    expect(found).toHaveLength(1);
    const [s] = found;
    expect([s.format, s.header_len, s.frames, s.size, s.ack]).toEqual(['png', 0, 4, [480, 272], null]);
    expect(s.packets).toBe(ts.length - 1);
    expect(s.image_bytes).toEqual([png.length, png.length]);
    expect(drop_streams(ts, found)).toHaveLength(1);
    // an EXIF thumbnail (its own SOI/EOI) does not end the outer JPEG early
    const inner = fake_jpeg(100, 32);
    let outer = fake_jpeg(300);
    outer = concat(outer.slice(0, 2), Uint8Array.of(0xff, 0xe1), Uint8Array.of((inner.length + 2) >> 8, (inner.length + 2) & 255), inner, outer.slice(2));
    expect(_ended('jpeg', outer)).toBe(outer.length);
    expect(_size('jpeg', fake_jpeg(500, 320))).toEqual([320, 320]);
  });

  it('too few frames is not a stream', () => {
    const img = fake_jpeg(600);
    const ts = [...lcd_frames(img), ...lcd_frames(img)].map((p, i) => _t(i + 1, i, 0x01, p));
    expect(find_streams(ts)).toEqual([]);
  });
});

describe('bmp / webp streams', () => {
  const frames = (img, chunk, nframes) => {
    const ts = [];
    let n = 0;
    for (let f = 0; f < nframes; f++) {
      lcd_frames(img, chunk).forEach((pkt, k) => { n += 1; ts.push(_t(n, f + k / 1e4, 0x02, pkt, 3)); });
    }
    return ts;
  };
  const rawFrames = (img, nframes) => {
    const ts = [];
    let n = 0;
    for (let f = 0; f < nframes; f++) {
      for (let k = 0; k < img.length; k += 256) { n += 1; ts.push(_t(n, f + k / 1e4, 0x02, img.slice(k, k + 256))); }
    }
    return ts;
  };

  it('bmp with a usb header offset', () => {
    const img = fake_bmp(1800, 80, 3);
    expect(_size('bmp', img)).toEqual([80, 80]);
    expect(_ended('bmp', img)).toBe(img.length);
    expect(_ended('bmp', img.slice(0, 40))).toBeNull();
    const [s] = find_streams(frames(img, 256, 4));
    expect([s.format, s.header_len, s.frames, s.size]).toEqual(['bmp', 4, 4, [80, 80]]);
    expect(s.image_bytes).toEqual([img.length, img.length]);
  });

  it('top-down bmp height and no header', () => {
    const img = fake_bmp(1200, 64, 1, true);
    expect(_size('bmp', img)).toEqual([64, 64]);
    const [s] = find_streams(rawFrames(img, 3));
    expect([s.format, s.header_len, s.frames, s.size]).toEqual(['bmp', 0, 3, [64, 64]]);
  });

  it('webp with a usb header offset', () => {
    const img = fake_webp(1800, 80, 3);
    expect(_size('webp', img)).toEqual([80, 80]);
    expect(_ended('webp', img)).toBe(img.length);
    expect(_ended('webp', img.slice(0, 40))).toBeNull();
    const [s] = find_streams(frames(img, 256, 4));
    expect([s.format, s.header_len, s.frames, s.size]).toEqual(['webp', 4, 4, [80, 80]]);
    expect(s.image_bytes).toEqual([img.length, img.length]);
  });

  it('webp without header, and RIFF without WEBP is ignored', () => {
    const img = fake_webp(1200, 64, 1);
    expect(_size('webp', img)).toEqual([64, 64]);
    const [s] = find_streams(rawFrames(img, 3));
    expect([s.format, s.header_len, s.frames, s.size]).toEqual(['webp', 0, 3, [64, 64]]);
    const wave = concat(ascii('RIFF'), Uint8Array.of(100, 0, 0, 0), ascii('WAVE'), new Uint8Array(100));
    const junk = [];
    let n = 0;
    for (let f = 0; f < 3; f++) {
      for (let k = 0; k < wave.length; k += 64) { n += 1; junk.push(_t(n, f + k / 1e4, 0x02, wave.slice(k, k + 64))); }
    }
    expect(find_streams(junk)).toEqual([]);
  });
});

describe('raw pixel streams', () => {
  const turing_cmd = (cmd, x = 0, y = 0, ex = 0, ey = 0) => {
    const v = (BigInt(x) << 30n) | (BigInt(y) << 20n) | (BigInt(ex) << 10n) | BigInt(ey);
    const out = new Uint8Array(6);
    for (let i = 0; i < 5; i++) out[i] = Number((v >> BigInt(8 * (4 - i))) & 0xffn);
    out[5] = cmd;
    return out;
  };
  const HELLO = 69;
  const BRIGHTNESS = 110;
  const ORIENTATION = 121;
  const DISPLAY_BITMAP = 197;

  it('Turing Smart Screen rev A: the stream (hello/orientation/brightness stay commands)', () => {
    // documented protocol: x, y, end x, end y as four 10-bit fields packed big-endian into 5 bytes + command code
    const w = new UsbmonWriter();
    let t = 1_760_000_000.0;
    w.control_in(t, Uint8Array.of(0x80, 6, 0, 1, 0, 0, 18, 0), device_descriptor());
    w.out(t + 0.1, 0x01, turing_cmd(HELLO, HELLO, HELLO, HELLO, HELLO));
    w.out(t + 0.2, 0x01, turing_cmd(ORIENTATION));
    const full = gradient(320, 480);
    t += 1.0;
    const updates = [[0, 0, 320, 480], [10, 200, 100, 20], [0, 0, 320, 480], [60, 300, 200, 40], [0, 0, 320, 480], [10, 200, 100, 20], [0, 0, 320, 480]];
    const levels = [0, 64, 128, 252];
    updates.forEach(([x, y, wd, ht], i) => {
      const pix = wd === 320 && ht === 480 ? full : gradient(wd, ht, i);
      w.out(t, 0x01, turing_cmd(DISPLAY_BITMAP, x, y, x + wd - 1, y + ht - 1));
      for (let k = 0; k < pix.length; k += 4096) w.out(t + 0.001 + (0.004 * k) / 4096, 0x01, pix.slice(k, k + 4096));
      t += 0.5;
      if (i < levels.length) {
        w.out(t + 0.1, 0x01, turing_cmd(BRIGHTNESS, levels[i]));
        t += 0.5;
      }
    });
    const found = find_streams(read_transfers(w.save()));
    expect(found).toHaveLength(1);
    const [s] = found;
    expect([s.format, s.endpoint, s.frames, s.regions]).toEqual(['rgb565', 0x01, 7, 3]);
    expect([s.size, s.byteorder, s.chunk]).toEqual([[320, 480], 'little', 4096]);
    expect(s.header_packet).toBe('rr rr rr rr rr c5');
    expect(s.region).toEqual({ layout: 'box10', offset: 0, endian: 'big' });
  });

  it('one transfer per frame back to back', () => {
    // one 115200-byte URB per 240x240 RGB565 frame, no command and no pause between frames
    const pix = gradient(240, 240);
    const ts = Array.from({ length: 6 }, (_, i) => _t(i + 1, i * 0.01, 0x02, pix));
    const [s] = find_streams(ts);
    expect([s.format, s.size, s.frames, s.packets]).toEqual(['rgb565', [240, 240], 6, 6]);
  });

  it('no raw stream for firmware or short commands', () => {
    // a firmware download: large chunks, but the totals are no screen size and never repeat
    const ts = [];
    let n = 0;
    let t = 0.0;
    for (const block of [70000, 91000, 33333]) {
      for (let k = 0; k < block; k += 1024) {
        n += 1;
        ts.push(_t(n, t, 0x02, new Uint8Array(Math.min(1024, block - k))));
        t += 0.001;
      }
      t += 1.0;
    }
    for (let i = 0; i < 10; i++) ts.push(_t(n + 1 + i, t + i, 0x01, Uint8Array.of(0xaa, i, 0, 0, 0)));
    expect(find_streams(ts)).toEqual([]);
    // two screen-sized frames are not enough
    const pix = gradient(128, 128);
    expect(find_streams([0, 1].map((i) => _t(i + 1, i, 0x02, pix)))).toEqual([]);
  });

  it('helpers', () => {
    expect(_region('box10', turing_cmd(197, 0, 0, 319, 479), 0, 'big')).toEqual([0, 0, 320, 480]);
    expect(hex(turing_cmd(197, 0, 0, 319, 479), ' ')).toBe('00 00 04 fd df c5');
    expect(_rgb565_order(gradient(64, 8, 0, 2, 'big'))).toBe('big');
    expect(_rgb565_order(new Uint8Array(512))).toBeNull();
  });

  it('testcard and write_testcard', () => {
    const px = testcard(8, 4);
    expect(px).toHaveLength(8 * 4 * 3);
    expect(Array.from(px.slice(0, 3))).toEqual([255, 0, 0]);
    const png = write_testcard(16, 8);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(hex(png.slice(-12))).toBe('0000000049454e44ae426082');
  });
});

describe('streams over several endpoints', () => {
  it('two screens on two endpoints stay two streams', () => {
    // one device, two screens with their own frame rates: frames never span both endpoints
    const w = new UsbmonWriter();
    const t0 = 1_760_000_000.0;
    w.control_in(t0, Uint8Array.of(0x80, 6, 0, 1, 0, 0, 18, 0), device_descriptor());
    for (const [ep, [wd, ht], fps] of [[0x02, [160, 80], 10.0], [0x04, [128, 128], 7.0]]) {
      let t = t0 + 0.05 + ep / 100;
      let n = 0;
      while (t < t0 + 3.0) {
        const pix = gradient(wd, ht, n);
        for (let k = 0; k < pix.length; k += 512) w.out(t + (0.0004 * k) / 512, ep, pix.slice(k, k + 512), 3);
        t += 1 / fps;
        n += 1;
      }
    }
    const found = find_streams(read_transfers(w.save()));
    expect(found.map((s) => [s.endpoints, s.size]).sort((a, b) => a[0][0] - b[0][0])).toEqual([[[0x02], [160, 80]], [[0x04], [128, 128]]]);
    expect(describeStream(found[0])).toContain('stream on');
  });
});
