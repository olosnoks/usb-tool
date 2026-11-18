import { describe, it, expect } from 'vitest';
import {
  defineMessage, encodeMessage, decodeMessage, toJsonSafe, ProtoError,
} from '../src/utils/meshtastic/protobuf.js';
import { encodeFrame, FrameParser, START1, START2 } from '../src/utils/meshtastic/frames.js';
import {
  FromRadio, ToRadio, Data, Routing, Position, Config,
} from '../src/utils/meshtastic/schema.js';
import {
  buildWantConfigFrame, buildTextFrame, buildHeartbeatFrame, decodeFromRadioPayload,
  decodeToRadioPayload, applyFromRadio, createSession, beginSync, recordOutgoingText,
  summarizeNodes, summarizeChannels, configJson, nodeIdFromNum, numFromNodeId,
  coordFromI, BROADCAST_NUM, appendConsoleText,
} from '../src/utils/meshtastic.js';

// ---- helpers that build wire bytes by hand (independent of the encoder) ----------------

const varint = (n) => {
  const out = [];
  let v = BigInt(n);
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
};
const tag = (no, wire) => varint((no << 3) | wire);
const vi = (no, n) => [...tag(no, 0), ...varint(n)];
const fx32 = (no, n) => [...tag(no, 5), n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const ld = (no, bytes) => [...tag(no, 2), ...varint(bytes.length), ...bytes];
const str = (no, s) => ld(no, [...new TextEncoder().encode(s)]);
const f32 = (no, x) => {
  const dv = new DataView(new ArrayBuffer(4));
  dv.setFloat32(0, x, true);
  return [...tag(no, 5), ...new Uint8Array(dv.buffer)];
};
const bytesOf = (...parts) => Uint8Array.from(parts.flat());

// ---- protobuf codec ----------------------------------------------------------------------

const Inner = defineMessage('Inner', [[1, 'x', 'uint32']]);
const Everything = defineMessage('Everything', [
  [1, 'a', 'uint32'],
  [2, 'b', 'sint32'],
  [3, 'c', 'int32'],
  [4, 'd', 'fixed32'],
  [5, 'e', 'sfixed32'],
  [6, 'f', 'float'],
  [7, 'g', 'string'],
  [8, 'h', 'bytes'],
  [9, 'i', 'message', { msg: Inner }],
  [10, 'j', 'uint32', { rep: true }],
  [11, 'k', 'fixed64'],
  [12, 'l', 'bool'],
  [13, 'm', 'sint64'],
]);

describe('protobuf codec', () => {
  it('round-trips every supported scalar, nested message and repeated field', () => {
    const value = {
      a: 300,
      b: -5,
      c: -1,
      d: 0xdeadbeef,
      e: -2,
      f: 1.5,
      g: 'héllo',
      h: Uint8Array.from([1, 2, 3]),
      i: { x: 7 },
      j: [1, 2, 3],
      k: (1n << 40n) + 5n,
      l: true,
      m: -123456789,
    };
    const decoded = decodeMessage(Everything, encodeMessage(Everything, value));
    expect(decoded.a).toBe(300);
    expect(decoded.b).toBe(-5);
    expect(decoded.c).toBe(-1);
    expect(decoded.d).toBe(0xdeadbeef);
    expect(decoded.e).toBe(-2);
    expect(decoded.f).toBe(1.5);
    expect(decoded.g).toBe('héllo');
    expect(Array.from(decoded.h)).toEqual([1, 2, 3]);
    expect(decoded.i).toEqual({ x: 7 });
    expect(decoded.j).toEqual([1, 2, 3]);
    expect(decoded.k).toBe((1n << 40n) + 5n);
    expect(decoded.l).toBe(true);
    expect(decoded.m).toBe(-123456789);
  });

  it('matches known wire vectors', () => {
    expect(Array.from(encodeMessage(Everything, { a: 300 }))).toEqual([0x08, 0xac, 0x02]);
    expect(Array.from(encodeMessage(Everything, { b: -1 }))).toEqual([0x10, 0x01]); // zigzag 1
    expect(Array.from(encodeMessage(Everything, { c: -1 }))).toEqual([
      0x18, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01,
    ]);
    expect(Array.from(encodeMessage(Everything, { d: 0x01020304 }))).toEqual([0x25, 0x04, 0x03, 0x02, 0x01]);
    expect(Array.from(encodeMessage(Everything, { g: 'a' }))).toEqual([0x3a, 0x01, 0x61]);
    expect(Array.from(encodeMessage(Everything, { l: true }))).toEqual([0x60, 0x01]);
  });

  it('decodes zigzag and negative int32 values from their wire form', () => {
    expect(decodeMessage(Everything, bytesOf(vi(2, 9)))).toEqual({ b: -5 });
    expect(decodeMessage(Everything, bytesOf(vi(3, 0xffffffff)))).toEqual({ c: -1 });
  });

  it('keeps unknown fields instead of failing', () => {
    const decoded = decodeMessage(Inner, bytesOf(vi(1, 4), vi(99, 12), str(42, 'x')));
    expect(decoded.x).toBe(4);
    expect(decoded._unknown.map((u) => u.no)).toEqual([99, 42]);
  });

  it('reads packed repeated scalars', () => {
    const packed = ld(10, [...varint(1), ...varint(200), ...varint(3)]);
    expect(decodeMessage(Everything, bytesOf(packed)).j).toEqual([1, 200, 3]);
  });

  it('rejects truncated input and group wire types', () => {
    expect(() => decodeMessage(Inner, Uint8Array.from([0x08]))).toThrow(ProtoError);
    expect(() => decodeMessage(Inner, Uint8Array.from([0x0b]))).toThrow(ProtoError); // group start
    expect(() => decodeMessage(Inner, Uint8Array.from([0x0a, 0x05, 0x61]))).toThrow(ProtoError);
  });

  it('redacts secret-looking keys in JSON output', () => {
    const json = toJsonSafe({ network: { wifi_psk: 'hunter2', wifi_ssid: 'lab' }, raw: Uint8Array.from([0xab, 0x01]) });
    expect(json.network.wifi_psk).toBe('[redacted]');
    expect(json.network.wifi_ssid).toBe('lab');
    expect(json.raw).toBe('ab01');
  });
});

// ---- framing -----------------------------------------------------------------------------

describe('serial frames', () => {
  it('encodes a ToRadio want_config_id with the documented header', () => {
    expect(Array.from(buildWantConfigFrame(1))).toEqual([START1, START2, 0x00, 0x02, 0x18, 0x01]);
    expect(Array.from(buildHeartbeatFrame())).toEqual([START1, START2, 0x00, 0x02, 0x3a, 0x00]);
  });

  it('rejects payloads that do not fit the frame length field', () => {
    expect(() => encodeFrame(new Uint8Array(0))).toThrow(RangeError);
    expect(() => encodeFrame(new Uint8Array(513))).toThrow(RangeError);
  });

  function collect(parser, chunks) {
    const frames = [];
    let logs = '';
    for (const chunk of chunks) {
      for (const ev of parser.push(chunk)) {
        if (ev.type === 'frame') frames.push(Array.from(ev.payload));
        else logs += ev.text;
      }
    }
    return { frames, logs };
  }

  const payloadA = [0x08, 0x01, 0x10, 0x02];
  const payloadB = Array.from({ length: 300 }, (_, i) => i & 0xff);
  const logText = new TextEncoder().encode('boot: radio ok\n');
  const between = new TextEncoder().encode('x\n');
  const stream = Uint8Array.from([
    ...logText,
    ...encodeFrame(Uint8Array.from(payloadA)),
    ...between,
    ...encodeFrame(Uint8Array.from(payloadB)),
    ...new TextEncoder().encode('tail\n'),
  ]);

  it('gives the same result for one chunk and byte-by-byte delivery', () => {
    const whole = collect(new FrameParser(), [stream]);
    const bytewise = collect(new FrameParser(), Array.from(stream, (b) => Uint8Array.of(b)));
    expect(whole.frames).toEqual([payloadA, payloadB]);
    expect(bytewise.frames).toEqual(whole.frames);
    expect(whole.logs).toBe('boot: radio ok\nx\ntail\n');
    expect(bytewise.logs).toBe(whole.logs);
  });

  it('handles arbitrary split points, including inside the header', () => {
    for (let cut = 1; cut < stream.length; cut += 7) {
      const res = collect(new FrameParser(), [stream.slice(0, cut), stream.slice(cut)]);
      expect(res.frames).toEqual([payloadA, payloadB]);
      expect(res.logs).toBe('boot: radio ok\nx\ntail\n');
    }
  });

  it('holds a partial frame until the rest arrives', () => {
    const parser = new FrameParser();
    const frame = encodeFrame(Uint8Array.from(payloadA));
    expect(parser.push(frame.slice(0, 3))).toEqual([]);
    const events = parser.push(frame.slice(3));
    expect(events).toEqual([{ type: 'frame', payload: Uint8Array.from(payloadA) }]);
  });

  it('treats a stray 0x94 that is not a frame header as log text', () => {
    const parser = new FrameParser();
    const events = parser.push(Uint8Array.from([0x94, 0x41, 0x42, 0x0a]));
    const logs = events.filter((e) => e.type === 'log').map((e) => e.text).join('');
    expect(events.some((e) => e.type === 'frame')).toBe(false);
    expect(logs).toContain('AB\n');
  });

  it('keeps multi-byte UTF-8 log text intact across chunks', () => {
    const parser = new FrameParser();
    const bytes = new TextEncoder().encode('é ok\n');
    const logs = [...parser.push(bytes.slice(0, 1)), ...parser.push(bytes.slice(1))]
      .filter((e) => e.type === 'log').map((e) => e.text).join('');
    expect(logs).toBe('é ok\n');
  });
});

// ---- decoding crafted device messages ---------------------------------------------------

describe('FromRadio decoding', () => {
  it('decodes a hand-assembled NodeInfo with user and position', () => {
    const user = bytesOf(str(1, '!12345678'), str(2, 'Hill Station'), str(3, 'HS'), vi(5, 43));
    const pos = bytesOf(
      fx32(1, 515074000),
      fx32(2, -1278000),
      fx32(4, 1700000000),
    );
    const nodeInfo = bytesOf(
      vi(1, 0x12345678 >>> 0),
      ld(2, user),
      ld(3, pos),
      f32(4, -7.5),
      fx32(5, 1700000100),
    );
    const fromRadio = bytesOf(vi(1, 9), ld(4, nodeInfo));

    const res = decodeFromRadioPayload(fromRadio);
    expect(res.ok).toBe(true);
    const msg = res.message;
    expect(msg.id).toBe(9);
    expect(msg.node_info.num).toBe(0x12345678);
    expect(msg.node_info.user.long_name).toBe('Hill Station');
    expect(msg.node_info.user.hw_model).toBe(43);
    expect(msg.node_info.snr).toBeCloseTo(-7.5);
    expect(msg.node_info.position.time).toBe(1700000000);
    expect(coordFromI(msg.node_info.position.latitude_i)).toBeCloseTo(51.5074, 6);
    expect(coordFromI(msg.node_info.position.longitude_i)).toBeCloseTo(-0.1278, 6);
  });

  it('reports malformed input as a decode failure instead of throwing', () => {
    const res = decodeFromRadioPayload(Uint8Array.from([0x22, 0x10, 0x01]));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/past end|Truncated/i);
  });

  it('decodes my_info, channels, config and the handshake completion', () => {
    const { state, frame } = beginSync(() => 0.5);
    expect(state.phase).toBe('syncing');
    expect(Array.from(frame.slice(0, 4))).toEqual([START1, START2, 0x00, 0x06]);
    const id = state.wantConfigId;

    const myInfo = ld(3, bytesOf(vi(1, 0xabcd0001), vi(15, 4)));
    const channel = ld(10, bytesOf(vi(1, 0), ld(2, bytesOf(str(3, 'LongFast'), ld(2, [1, 2, 3, 4]))), vi(3, 1)));
    const cfg = ld(5, bytesOf(ld(6, bytesOf(vi(7, 1), vi(2, 0))), str(99, 'x')));
    const complete = vi(7, id);
    const stale = vi(7, id + 1);

    for (const buf of [myInfo, channel, cfg, stale]) {
      const r = decodeFromRadioPayload(bytesOf(buf));
      expect(r.ok).toBe(true);
      applyFromRadio(state, r.message, 1700000000000);
    }
    expect(state.phase).toBe('syncing');
    applyFromRadio(state, decodeFromRadioPayload(bytesOf(complete)).message, 1700000000000);
    expect(state.phase).toBe('ready');

    expect(state.myNum).toBe(0xabcd0001);
    expect(nodeIdFromNum(state.myNum)).toBe('!abcd0001');
    const channels = summarizeChannels(state);
    expect(channels).toEqual([{ index: 0, role: 1, name: 'LongFast', pskBytes: 4, uplink: false, downlink: false }]);
    const json = configJson(state);
    expect(json.config.lora.region).toBe(1);
    expect(json.config.lora.modem_preset).toBe(0);
    expect(json.notDecoded).toEqual([{ scope: 'config', field: 99, wire: 2 }]);
  });

  it('turns text packets into messages and dedupes our own echo', () => {
    const { state, frame } = beginSync(() => 0.25);
    applyFromRadio(state, { my_info: { my_node_num: 0x1000 } }, 0);
    const sent = buildTextFrame({ text: 'hi there', to: BROADCAST_NUM, packetId: 0x77 });
    expect(Array.from(sent.frame.slice(0, 2))).toEqual([START1, START2]);
    expect(frame.length).toBeGreaterThan(0);
    recordOutgoingText(state, { id: 0x77, to: BROADCAST_NUM, channel: 0, text: 'hi there', nowMs: 0 });

    // Firmware echoes our packet back (from = our node): must not duplicate it.
    const echo = decodeFromRadioPayload(bytesOf(ld(2, bytesOf(fx32(1, 0x1000), fx32(2, BROADCAST_NUM), fx32(6, 0x77), ld(4, encodeMessage(Data, { portnum: 1, payload: new TextEncoder().encode('hi there') }))))));
    applyFromRadio(state, echo.message, 0);
    expect(state.messages.filter((m) => m.id === 0x77)).toHaveLength(1);

    // Routing ack for that packet marks it acked.
    const routing = encodeMessage(Routing, { error_reason: 0 });
    const ackData = encodeMessage(Data, { portnum: 5, payload: routing, request_id: 0x77 });
    const ack = decodeFromRadioPayload(bytesOf(ld(2, bytesOf(fx32(1, 0x2000), fx32(2, 0x1000), ld(4, ackData)))));
    applyFromRadio(state, ack.message, 0);
    expect(state.messages[0].status).toBe('acked');

    // An incoming broadcast from another node.
    const inbound = decodeFromRadioPayload(bytesOf(ld(2, bytesOf(fx32(1, 0x2000), fx32(2, BROADCAST_NUM), vi(3, 2), ld(4, encodeMessage(Data, { portnum: 1, payload: new TextEncoder().encode('hello mesh') }))))));
    applyFromRadio(state, inbound.message, 0);
    const last = state.messages[state.messages.length - 1];
    expect(last).toMatchObject({ direction: 'in', text: 'hello mesh', channel: 2, from: 0x2000, direct: false });
  });

  it('marks a failed routing reply with its reason', () => {
    const state = createSession();
    state.myNum = 0x1000;
    recordOutgoingText(state, { id: 5, to: 0x3000, channel: 0, text: 'x', nowMs: 0 });
    const nak = encodeMessage(Routing, { error_reason: 3 });
    applyFromRadio(state, { packet: { from: 0x3000, to: 0x1000, decoded: { portnum: 5, payload: nak, request_id: 5 } } }, 0);
    expect(state.messages[0]).toMatchObject({ status: 'failed', error: 'TIMEOUT' });
  });

  it('places a node on the map only when it has a real fix', () => {
    const state = createSession();
    applyFromRadio(state, { node_info: { num: 1, position: { latitude_i: 0, longitude_i: 0 } } }, 0);
    applyFromRadio(state, { node_info: { num: 2, position: { latitude_i: 515074000, longitude_i: -1278000 } } }, 0);
    const rows = summarizeNodes(state, 0);
    expect(rows.find((r) => r.num === 1).position).toBeNull();
    expect(rows.find((r) => r.num === 2).position.lat).toBeCloseTo(51.5074, 6);
  });

  it('splits console text into lines and keeps the partial tail', () => {
    const state = createSession();
    appendConsoleText(state, 'one\ntw');
    appendConsoleText(state, 'o\n\nthree');
    expect(state.logs.map((l) => l.text)).toEqual(['one', 'two']);
    expect(state.logTail).toBe('three');
  });

  it('round-trips the ToRadio text packet built by the client', () => {
    const { frame, packetId } = buildTextFrame({ text: 'ping', to: 0x42, channel: 1, packetId: 0x99, hopLimit: 5 });
    const payload = frame.slice(4);
    const decoded = decodeToRadioPayload(payload);
    expect(decoded.packet.to).toBe(0x42);
    expect(decoded.packet.channel).toBe(1);
    expect(decoded.packet.id).toBe(0x99);
    expect(decoded.packet.want_ack).toBe(true);
    expect(decoded.packet.hop_limit).toBe(5);
    expect(decoded.packet.decoded.portnum).toBe(1);
    expect(new TextDecoder().decode(decoded.packet.decoded.payload)).toBe('ping');
    expect(packetId).toBe(0x99);
  });

  it('exposes stable schema field numbers used by the client', () => {
    expect(FromRadio.byNo.get(7).name).toBe('config_complete_id');
    expect(ToRadio.byNo.get(3).name).toBe('want_config_id');
    expect(Position.byNo.get(1).type).toBe('sfixed32');
    expect(Config.byNo.get(6).name).toBe('lora');
  });
});

describe('node id helpers', () => {
  it('converts between node numbers and !hex ids', () => {
    expect(nodeIdFromNum(0xa1b2c3d4)).toBe('!a1b2c3d4');
    expect(nodeIdFromNum(0x1)).toBe('!00000001');
    expect(numFromNodeId('!a1b2c3d4')).toBe(0xa1b2c3d4);
    expect(numFromNodeId('nothex!')).toBeNull();
  });
});
