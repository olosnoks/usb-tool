// Capture-level stream tests from usb-rea test_streams.py, test_bmp_streams.py, test_webp_streams.py,
// test_raw_streams.py and test_multi_endpoint_streams.py (through pipeline.analyze and synth.make_capture).
// Report/scaffold/driver assertions of the originals belong to the report.js / scaffold.js tests.
import { describe, it, expect } from 'vitest';
import { analyze } from '../../src/utils/usbrea/pipeline.js';
import { describe as describeStream } from '../../src/utils/usbrea/streams.js';
import { LCD_ACTIONS, make_capture } from '../../src/utils/usbrea/synth.js';

const lcd = (o = {}) => make_capture({ device: 'lcd', image_stream: true, ...o });
const cmds = (p) => p.commands.map((c) => [c.name, c.endpoint, c.confidence]);

describe('jpeg stream', () => {
  it('stream found and brightness kept on its own endpoint', () => {
    const { capture, markers } = lcd();
    const proto = analyze(capture, markers);
    expect(cmds(proto)).toEqual([['brightness', 0x01, 1.0]]);
    const value = proto.commands[0].fields.filter((f) => f.kind === 'value');
    expect(value.map((f) => [f.offset, f.scale, f.bias])).toEqual([[4, 1.0, 0.0]]);
    expect(proto.streams).toHaveLength(1);
    const [s] = proto.streams;
    expect([s.endpoint, s.xfer_type, s.format, s.chunk, s.padded]).toEqual([0x03, 1, 'jpeg', 512, true]);
    expect([s.header_len, s.first_header, s.next_header]).toEqual([4, '08 nn 00 80', '08 ii 00 00']);
    expect([s.count_offset, s.index_offset, s.index_base]).toEqual([1, 1, 0]);
    expect(s.size).toEqual([240, 240]);
    expect(s.fps).toBe(20.0);
    expect(s.partial).toBeGreaterThanOrEqual(1);
    expect(s.ack.endpoint).toBe(0x84);
    expect(s.ack.payload.startsWith('08 81 00')).toBe(true);
    // the acks are not taken for replies to the brightness command
    expect(proto.responses).toEqual([]);
    expect(proto.background).toEqual([]);
    expect('ids' in proto.to_dict().streams[0]).toBe(false);
  });

  it('labels mode splits only the commands', () => {
    const { capture } = lcd();
    const proto = analyze(capture, null, null, LCD_ACTIONS);
    expect(proto.commands.map((c) => [c.name, c.confidence])).toEqual([['brightness', 1.0]]);
    expect(proto.commands[0].samples.map((x) => x[0])).toEqual(LCD_ACTIONS);
  });

  it('without a stream nothing changes', () => {
    let { capture, markers } = make_capture({ device: 'lcd' });
    let proto = analyze(capture, markers);
    expect(proto.streams).toEqual([]);
    expect(proto.commands.map((c) => c.name)).toEqual(['brightness']);
    ({ capture, markers } = make_capture({ device: 'fan', poll: 0.5 }));
    expect(analyze(capture, markers).streams).toEqual([]);
    expect(() => make_capture({ device: 'fan', image_stream: true })).toThrow();
  });

  it('jpeg is still the default and the bmp/webp flags are checked', () => {
    const { capture, markers } = lcd();
    expect(analyze(capture, markers).streams[0].format).toBe('jpeg');
    expect(() => lcd({ bmp: true, raw: 'rgb565' })).toThrow();
    expect(() => make_capture({ device: 'fan', image_stream: true, bmp: true })).toThrow();
    expect(() => lcd({ webp: true, raw: 'rgb565' })).toThrow();
    expect(() => make_capture({ device: 'fan', image_stream: true, webp: true })).toThrow();
    expect(() => lcd({ bmp: true, webp: true })).toThrow();
  });
});

describe('bmp / webp streams in synthetic captures', () => {
  for (const fmt of ['bmp', 'webp']) {
    it(`synth ${fmt} stream found`, () => {
      const { capture, markers } = lcd({ [fmt]: true });
      const proto = analyze(capture, markers);
      expect(proto.commands.map((c) => c.name)).toEqual(['brightness']);
      expect(proto.streams).toHaveLength(1);
      const [s] = proto.streams;
      expect([s.endpoint, s.xfer_type, s.format, s.chunk, s.padded]).toEqual([0x03, 1, fmt, 512, true]);
      expect([s.header_len, s.first_header, s.next_header]).toEqual([4, '08 nn 00 80', '08 ii 00 00']);
      expect(s.size).toEqual([64, 64]);
      expect(s.frames).toBeGreaterThanOrEqual(3);
      expect(s.fps).toBe(20.0);
      expect(s.image_bytes).not.toBeNull();
      expect(s.image_bytes[0]).toBeGreaterThanOrEqual(1500);
      expect(s.ack.endpoint).toBe(0x84);
    });
  }
});

describe('raw pixel streams in synthetic captures', () => {
  it('rgb565 stream with a region command', () => {
    const { capture, markers } = lcd({ raw: 'rgb565' });
    const proto = analyze(capture, markers);
    expect(cmds(proto)).toEqual([['brightness', 0x01, 1.0]]);
    expect(proto.streams).toHaveLength(1);
    const [s] = proto.streams;
    expect([s.raw, s.format, s.endpoint, s.xfer_type, s.chunk]).toEqual([true, 'rgb565', 0x02, 3, 512]);
    expect([s.size, s.frame_bytes, s.byteorder, s.fps]).toEqual([[160, 128], 40960, 'little', 10.0]);
    expect(s.header_packet).toBe('55 aa 02 00 xx xx yy yy ww ww hh hh');
    expect(s.region).toEqual({ layout: 'xywh', offset: 4, endian: 'little' });
    expect([s.regions, s.header_len]).toEqual([20, 0]);
    expect(s.partial).toBeGreaterThan(0);
    expect(s.ack.endpoint).toBe(0x82);
    expect(s.ack.payload).toBe('55 aa 82 00');
    expect(proto.responses).toEqual([]);
    expect(proto.background).toEqual([]);
  });

  it('rgb888 with a 16-bit packet index and count', () => {
    const { capture, markers } = lcd({ raw: 'rgb888' });
    const proto = analyze(capture, markers);
    expect(proto.commands.map((c) => c.name)).toEqual(['brightness']);
    const [s] = proto.streams;
    expect([s.format, s.size, s.chunk, s.header_len]).toEqual(['rgb888', [128, 160], 64, 4]);
    expect([s.first_header, s.next_header]).toEqual(['00 00 nn nn', 'ii ii nn nn']);
    expect([s.count_offset, s.count_width, s.count_endian]).toEqual([2, 2, 'little']);
    expect([s.index_offset, s.index_width, s.index_endian, s.index_base]).toEqual([0, 2, 'little', 0]);
    expect(s.size_alternatives).toEqual(['rgb888 160x128']);
    expect(s.header_packet).toBeNull();
  });
});

describe('streams over several endpoints', () => {
  for (const layout of ['alternate', 'blocks']) {
    it(`jpeg frames over two endpoints (${layout})`, () => {
      const { capture, markers } = lcd({ endpoints: layout });
      const proto = analyze(capture, markers);
      expect(cmds(proto)).toEqual([['brightness', 0x01, 1.0]]);
      expect(proto.streams).toHaveLength(1);
      const [s] = proto.streams;
      expect([s.format, s.endpoint, s.endpoints, s.endpoint_layout]).toEqual(['jpeg', 0x03, [0x03, 0x05], layout]);
      expect(s.header_endpoint).toBeNull();
      expect(s.frames).toBe(159);
      expect(s.size).toEqual([240, 240]);
      expect([s.first_header, s.next_header]).toEqual(['08 nn 00 80', '08 ii 00 00']);
      expect(s.ack.endpoint).toBe(0x84);
      expect(proto.responses).toEqual([]);
      expect(describeStream(s)).toContain('EP 0x03 + 0x05');
    });

    it(`raw rgb565 frames over two endpoints (${layout})`, () => {
      const { capture, markers } = lcd({ raw: 'rgb565', endpoints: layout });
      const proto = analyze(capture, markers);
      expect(cmds(proto)).toEqual([['brightness', 0x01, 1.0]]);
      const [s] = proto.streams;
      expect([s.format, s.endpoints, s.endpoint_layout, s.header_endpoint]).toEqual(['rgb565', [0x02, 0x04], layout, null]);
      expect([s.size, s.frames, s.regions, s.byteorder]).toEqual([[160, 128], 79, 20, 'little']);
      expect(s.header_packet).toBe('55 aa 02 00 xx xx yy yy ww ww hh hh');
      expect(s.ack.endpoint).toBe(0x82);
    });

    it(`raw rgb888 halves are not two small screens (${layout})`, () => {
      // each endpoint alone carries 32768 bytes a frame, which also fits a 128x128 RGB565 screen
      const { capture, markers } = lcd({ raw: 'rgb888', endpoints: layout });
      const [s] = analyze(capture, markers).streams;
      expect([s.format, s.size, s.endpoints, s.endpoint_layout]).toEqual(['rgb888', [128, 160], [0x02, 0x04], layout]);
      expect([s.first_header, s.next_header]).toEqual(['00 00 nn nn', 'ii ii nn nn']);
    });
  }

  it('draw command on the command endpoint', () => {
    const { capture, markers } = lcd({ raw: 'rgb565', endpoints: 'command' });
    const proto = analyze(capture, markers);
    // the draw commands on EP 0x01 go with the pixels, brightness on the same endpoint stays a command
    expect(cmds(proto)).toEqual([['brightness', 0x01, 1.0]]);
    const [s] = proto.streams;
    expect([s.endpoint, s.endpoints, s.endpoint_layout, s.header_endpoint]).toEqual([0x02, [0x02], null, 0x01]);
    expect(s.region).toEqual({ layout: 'xywh', offset: 4, endian: 'little' });
    expect([s.frames, s.regions]).toEqual([79, 20]);
    expect(describeStream(s)).toContain('command on EP 0x01');
  });

  it('single endpoint streams say so', () => {
    const { capture, markers } = lcd({ raw: 'rgb565' });
    const [s] = analyze(capture, markers).streams;
    expect([s.endpoints, s.endpoint_layout, s.header_endpoint]).toEqual([[0x02], null, null]);
  });

  it('endpoints option checks', () => {
    expect(() => lcd({ endpoints: 'command' })).toThrow(); // JPEG has no draw command
    expect(() => make_capture({ device: 'lcd', endpoints: 'alternate' })).toThrow();
  });
});
