import { describe, it, expect } from 'vitest';
import {
  encodeRemainingLength, decodeRemainingLength, encodeConnect, encodeConnack, encodePublish,
  encodePuback, encodePubrec, encodePubrel, encodePubcomp, encodeSubscribe, encodeSuback,
  encodeUnsubscribe, encodeUnsuback, encodePingreq, encodePingresp, encodeDisconnect,
  decodePacket, decodeBody, parseFrame, MqttStreamParser, MqttProtocolError, MqttClient,
  matchTopic, topicNameError, topicFilterError, brokerUrlError, mixedContentWarning,
  stripProfileSecrets, saveProfiles, loadProfiles, PROFILE_STORAGE_KEY, prettyJson, hexDump, parseHex,
  parseBase64, diffLines, mqttxCommand, bytesToBase64,
} from '../src/utils/mqttClient.js';

// Compare bytes as lowercase space-separated hex, so each expected value is readable
// and can be checked by hand against the MQTT 3.1.1 specification.
const hx = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');

describe('remaining length varint', () => {
  it('encodes the boundary values', () => {
    expect(encodeRemainingLength(0)).toEqual([0x00]);
    expect(encodeRemainingLength(127)).toEqual([0x7f]);
    expect(encodeRemainingLength(128)).toEqual([0x80, 0x01]);
    expect(encodeRemainingLength(16383)).toEqual([0xff, 0x7f]);
    expect(encodeRemainingLength(16384)).toEqual([0x80, 0x80, 0x01]);
    expect(encodeRemainingLength(2097151)).toEqual([0xff, 0xff, 0x7f]);
    expect(encodeRemainingLength(2097152)).toEqual([0x80, 0x80, 0x80, 0x01]);
    expect(encodeRemainingLength(268435455)).toEqual([0xff, 0xff, 0xff, 0x7f]);
  });

  it('rejects values above 268435455 and negatives', () => {
    expect(() => encodeRemainingLength(268435456)).toThrow(RangeError);
    expect(() => encodeRemainingLength(-1)).toThrow(RangeError);
  });

  it('decodes the boundary values and reports how many bytes it used', () => {
    expect(decodeRemainingLength([0x7f])).toEqual({ value: 127, length: 1 });
    expect(decodeRemainingLength([0x80, 0x01])).toEqual({ value: 128, length: 2 });
    expect(decodeRemainingLength([0xff, 0x7f])).toEqual({ value: 16383, length: 2 });
    expect(decodeRemainingLength([0x80, 0x80, 0x01])).toEqual({ value: 16384, length: 3 });
    expect(decodeRemainingLength([0xff, 0xff, 0xff, 0x7f])).toEqual({ value: 268435455, length: 4 });
  });

  it('returns null while the varint is incomplete and throws on a fifth continuation', () => {
    expect(decodeRemainingLength([0x80])).toBeNull();
    expect(decodeRemainingLength([0xff, 0xff])).toBeNull();
    expect(() => decodeRemainingLength([0x80, 0x80, 0x80, 0x80])).toThrow(MqttProtocolError);
  });
});

describe('packet encoders against hand-computed bytes', () => {
  it('CONNECT minimal: protocol "MQTT" level 4, clean session, keep-alive 60, client id "c"', () => {
    // fixed 10 0D | 00 04 'MQTT' | 04 | flags 02 | keep-alive 00 3C | 00 01 'c'
    expect(hx(encodeConnect({ clientId: 'c', cleanSession: true, keepAlive: 60 })))
      .toBe('10 0d 00 04 4d 51 54 54 04 02 00 3c 00 01 63');
  });

  it('CONNECT with will, user name and password: flags CE', () => {
    // flags = user 0x80 | pass 0x40 | will QoS1 0x08 | will 0x04 | clean 0x02 = 0xCE
    const bytes = encodeConnect({
      clientId: 'a', cleanSession: true, keepAlive: 10,
      will: { topic: 't', payload: 'm', qos: 1, retain: false },
      username: 'u', password: 'p',
    });
    expect(hx(bytes)).toBe('10 19 00 04 4d 51 54 54 04 ce 00 0a 00 01 61 00 01 74 00 01 6d 00 01 75 00 01 70');
  });

  it('CONNACK accepted and refused', () => {
    expect(hx(encodeConnack())).toBe('20 02 00 00');
    expect(hx(encodeConnack({ sessionPresent: true, returnCode: 5 }))).toBe('20 02 01 05');
  });

  it('PUBLISH QoS 0 with retain: fixed byte 31, no packet id', () => {
    expect(hx(encodePublish({ topic: 'a', payload: 'hi', qos: 0, retain: true }))).toBe('31 05 00 01 61 68 69');
  });

  it('PUBLISH QoS 1 with packet id 7', () => {
    expect(hx(encodePublish({ topic: 'a', payload: 'hi', qos: 1, packetId: 7 }))).toBe('32 07 00 01 61 00 07 68 69');
  });

  it('PUBLISH QoS 2 with DUP and retain, packet id 0x0102, empty payload: fixed byte 3D', () => {
    expect(hx(encodePublish({ topic: 'a', payload: '', qos: 2, dup: true, retain: true, packetId: 0x0102 })))
      .toBe('3d 05 00 01 61 01 02');
  });

  it('PUBLISH with a 128-byte payload uses a two-byte remaining length (0x83 0x01)', () => {
    const payload = new Uint8Array(128).fill(0x41);
    const bytes = encodePublish({ topic: 'a', payload });
    expect(hx(bytes.subarray(0, 6))).toBe('30 83 01 00 01 61');
    expect(bytes.length).toBe(1 + 2 + 3 + 128);
    const pkt = decodePacket(bytes);
    expect(pkt.payload.length).toBe(128);
    expect(pkt.payload.every((b) => b === 0x41)).toBe(true);
  });

  it('PUBACK / PUBREC / PUBREL / PUBCOMP', () => {
    expect(hx(encodePuback(0x1234))).toBe('40 02 12 34');
    expect(hx(encodePubrec(1))).toBe('50 02 00 01');
    expect(hx(encodePubrel(1))).toBe('62 02 00 01');
    expect(hx(encodePubcomp(0x0102))).toBe('70 02 01 02');
  });

  it('SUBSCRIBE id 1 for "a/b" at QoS 1', () => {
    // 82 | remaining 8 | id 00 01 | 00 03 'a/b' | qos 01
    expect(hx(encodeSubscribe({ packetId: 1, subscriptions: [{ filter: 'a/b', qos: 1 }] })))
      .toBe('82 08 00 01 00 03 61 2f 62 01');
  });

  it('SUBACK with granted 0, 1 and failure 0x80', () => {
    expect(hx(encodeSuback({ packetId: 1, returnCodes: [0, 1, 0x80] }))).toBe('90 05 00 01 00 01 80');
  });

  it('UNSUBSCRIBE id 2 for "a/b" and UNSUBACK', () => {
    expect(hx(encodeUnsubscribe({ packetId: 2, filters: ['a/b'] }))).toBe('a2 07 00 02 00 03 61 2f 62');
    expect(hx(encodeUnsuback(2))).toBe('b0 02 00 02');
  });

  it('PINGREQ, PINGRESP and DISCONNECT', () => {
    expect(hx(encodePingreq())).toBe('c0 00');
    expect(hx(encodePingresp())).toBe('d0 00');
    expect(hx(encodeDisconnect())).toBe('e0 00');
  });

  it('refuses invalid input instead of producing bad bytes', () => {
    expect(() => encodePublish({ topic: 'a/#', payload: 'x' })).toThrow(/wildcard/);
    expect(() => encodePublish({ topic: 'a', payload: 'x', qos: 1 })).toThrow(/Packet identifier/);
    expect(() => encodePublish({ topic: 'a', payload: 'x', qos: 3 })).toThrow(/QoS/);
    expect(() => encodeSubscribe({ packetId: 1, subscriptions: [{ filter: 'a/#/b', qos: 0 }] })).toThrow(/#/);
    expect(() => encodeConnect({ clientId: 'x', password: 'p' })).toThrow(/user name/);
    expect(() => encodeConnect({ clientId: '', cleanSession: false })).toThrow(/clean session/);
  });
});

describe('decoding', () => {
  it('round-trips every packet type through decodePacket', () => {
    expect(decodePacket(encodeConnect({ clientId: 'c', keepAlive: 60, username: 'u', password: 'p', will: { topic: 'w', payload: 'x', qos: 2, retain: true } })))
      .toMatchObject({
        type: 'CONNECT', protocolName: 'MQTT', protocolLevel: 4, cleanSession: true, keepAlive: 60, clientId: 'c',
        username: 'u', will: { topic: 'w', qos: 2, retain: true },
      });
    expect(decodePacket(encodeConnack({ sessionPresent: true, returnCode: 4 }))).toEqual({ type: 'CONNACK', sessionPresent: true, returnCode: 4 });
    expect(decodePacket(encodePublish({ topic: 'a/b', payload: 'hi', qos: 1, packetId: 3, retain: true })))
      .toMatchObject({ type: 'PUBLISH', topic: 'a/b', qos: 1, packetId: 3, retain: true, dup: false });
    expect(decodePacket(encodePuback(5))).toEqual({ type: 'PUBACK', packetId: 5 });
    expect(decodePacket(encodePubrec(5))).toEqual({ type: 'PUBREC', packetId: 5 });
    expect(decodePacket(encodePubrel(5))).toEqual({ type: 'PUBREL', packetId: 5 });
    expect(decodePacket(encodePubcomp(5))).toEqual({ type: 'PUBCOMP', packetId: 5 });
    expect(decodePacket(encodeSubscribe({ packetId: 9, subscriptions: [{ filter: '+/x', qos: 2 }] })))
      .toEqual({ type: 'SUBSCRIBE', packetId: 9, subscriptions: [{ filter: '+/x', qos: 2 }] });
    expect(decodePacket(encodeSuback({ packetId: 9, returnCodes: [2, 0x80] })))
      .toEqual({ type: 'SUBACK', packetId: 9, returnCodes: [2, 0x80] });
    expect(decodePacket(encodeUnsubscribe({ packetId: 4, filters: ['a', 'b/#'] })))
      .toEqual({ type: 'UNSUBSCRIBE', packetId: 4, filters: ['a', 'b/#'] });
    expect(decodePacket(encodeUnsuback(4))).toEqual({ type: 'UNSUBACK', packetId: 4 });
    expect(decodePacket(encodePingreq())).toEqual({ type: 'PINGREQ' });
    expect(decodePacket(encodePingresp())).toEqual({ type: 'PINGRESP' });
    expect(decodePacket(encodeDisconnect())).toEqual({ type: 'DISCONNECT' });
  });

  it('decodes the hand-computed CONNECT with will, user and password', () => {
    const bytes = Uint8Array.from([0x10, 0x19, 0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, 0x04, 0xce, 0x00, 0x0a,
      0x00, 0x01, 0x61, 0x00, 0x01, 0x74, 0x00, 0x01, 0x6d, 0x00, 0x01, 0x75, 0x00, 0x01, 0x70]);
    const pkt = decodePacket(bytes);
    expect(pkt.clientId).toBe('a');
    expect(pkt.will).toEqual({ topic: 't', payload: Uint8Array.from([0x6d]), qos: 1, retain: false });
    expect(pkt.username).toBe('u');
    expect(Array.from(pkt.password)).toEqual([0x70]);
  });

  it('decodes a hand-computed SUBACK', () => {
    expect(decodePacket(Uint8Array.from([0x90, 0x05, 0x00, 0x01, 0x00, 0x01, 0x80])))
      .toEqual({ type: 'SUBACK', packetId: 1, returnCodes: [0, 1, 0x80] });
  });

  it('rejects wrong fixed-header flags, packet id 0 and wildcard topics in PUBLISH', () => {
    expect(() => decodePacket(Uint8Array.from([0x80, 0x05, 0x00, 0x01, 0x00, 0x01, 0x61]))).toThrow(/flags/);
    expect(() => decodePacket(Uint8Array.from([0x40, 0x02, 0x00, 0x00]))).toThrow(/zero/);
    expect(() => decodePacket(Uint8Array.from([0x30, 0x04, 0x00, 0x02, 0x61, 0x2b]))).toThrow(/Invalid topic/);
    expect(() => decodeBody(15, 0, new Uint8Array(0))).toThrow(/Unknown packet type/);
  });

  it('rejects extra or missing bytes', () => {
    expect(() => decodePacket(Uint8Array.from([0xc0, 0x00, 0x00]))).toThrow(/Extra bytes/);
    expect(() => decodePacket(Uint8Array.from([0x30, 0x05, 0x00, 0x01, 0x61]))).toThrow(/Incomplete/);
  });
});

describe('streaming parser', () => {
  const qos1 = encodePublish({ topic: 'sensors/t', payload: '21.5', qos: 1, packetId: 300 });

  it('reassembles a packet delivered one byte at a time', () => {
    const p = new MqttStreamParser();
    const out = [];
    for (const b of qos1) out.push(...p.push(Uint8Array.from([b])));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'PUBLISH', topic: 'sensors/t', packetId: 300 });
    expect(new TextDecoder().decode(out[0].payload)).toBe('21.5');
    expect(p.pendingBytes).toBe(0);
  });

  it('waits when the split falls inside the multi-byte remaining length', () => {
    const big = encodePublish({ topic: 'a', payload: new Uint8Array(200).fill(7) }); // remaining length 203 = 2 bytes
    const p = new MqttStreamParser();
    expect(p.push(big.subarray(0, 1))).toEqual([]);
    expect(p.push(big.subarray(1, 2))).toEqual([]);      // only the first varint byte so far
    const done = p.push(big.subarray(2));
    expect(done).toHaveLength(1);
    expect(done[0].payload.length).toBe(200);
  });

  it('splits two packets that arrive in one WebSocket message', () => {
    const p = new MqttStreamParser();
    const both = Uint8Array.from([...encodePingresp(), ...encodePuback(42)]);
    expect(p.push(both)).toEqual([{ type: 'PINGRESP' }, { type: 'PUBACK', packetId: 42 }]);
  });

  it('holds a trailing partial packet until the rest arrives', () => {
    const p = new MqttStreamParser();
    const combined = Uint8Array.from([...encodePuback(1), ...qos1.subarray(0, 5)]);
    const first = p.push(combined);
    expect(first).toEqual([{ type: 'PUBACK', packetId: 1 }]);
    const second = p.push(qos1.subarray(5));
    expect(second[0]).toMatchObject({ type: 'PUBLISH', packetId: 300 });
  });

  it('accepts ArrayBuffer chunks as the WebSocket delivers them', () => {
    const p = new MqttStreamParser();
    const ab = encodePingresp().buffer;
    expect(p.push(ab)).toEqual([{ type: 'PINGRESP' }]);
  });

  it('a malformed varint throws and clears the buffer', () => {
    const p = new MqttStreamParser();
    expect(() => p.push(Uint8Array.from([0x30, 0x80, 0x80, 0x80, 0x80]))).toThrow(MqttProtocolError);
    expect(p.pendingBytes).toBe(0);
    expect(p.push(encodePingresp())).toEqual([{ type: 'PINGRESP' }]);
  });

  it('frame helper reports incomplete frames as null', () => {
    expect(parseFrame(Uint8Array.from([0x30, 0x05, 0x00]))).toBeNull();
    expect(parseFrame(Uint8Array.from([]))).toBeNull();
    expect(parseFrame(encodePingreq())).toMatchObject({ type: 12, flags: 0, end: 2 });
  });
});

describe('topic matching', () => {
  it('matches exact topics and the single-level + wildcard', () => {
    expect(matchTopic('sport/tennis/player1', 'sport/tennis/player1')).toBe(true);
    expect(matchTopic('sport/tennis/player1', 'sport/tennis')).toBe(false);
    expect(matchTopic('sport/+/player1', 'sport/tennis/player1')).toBe(true);
    expect(matchTopic('sport/+', 'sport')).toBe(false);
    expect(matchTopic('sport/+', 'sport/')).toBe(true);
    expect(matchTopic('+', 'sport')).toBe(true);
    expect(matchTopic('+', 'sport/x')).toBe(false);
    expect(matchTopic('a/+/c', 'a/b/c/d')).toBe(false);
  });

  it('matches the multi-level # wildcard, including the parent level', () => {
    expect(matchTopic('#', 'a/b/c')).toBe(true);
    expect(matchTopic('sport/#', 'sport')).toBe(true);
    expect(matchTopic('sport/#', 'sport/tennis/player1')).toBe(true);
    expect(matchTopic('sport/#', 'sports')).toBe(false);
    expect(matchTopic('sport/+/#', 'sport/tennis/x/y')).toBe(true);
  });

  it('never matches $ topics with a wildcard-leading filter, but matches them explicitly', () => {
    expect(matchTopic('#', '$SYS/broker/uptime')).toBe(false);
    expect(matchTopic('+/broker/uptime', '$SYS/broker/uptime')).toBe(false);
    expect(matchTopic('$SYS/#', '$SYS/broker/uptime')).toBe(true);
    expect(matchTopic('$SYS/broker/+', '$SYS/broker/uptime')).toBe(true);
  });

  it('validates topic names and filters', () => {
    expect(topicNameError('')).toMatch(/empty/);
    expect(topicNameError('a/+')).toMatch(/wildcard/);
    expect(topicNameError('home/kitchen/temp')).toBeNull();
    expect(topicFilterError('a/#/b')).toMatch(/last level/);
    expect(topicFilterError('a/b#')).toMatch(/whole level/);
    expect(topicFilterError('a+/b')).toMatch(/whole level/);
    expect(topicFilterError('+/#')).toBeNull();
    expect(topicFilterError('a//b')).toBeNull();
  });
});

describe('connection and profile helpers', () => {
  it('checks broker URLs and flags mixed content', () => {
    expect(brokerUrlError('wss://broker.hivemq.com:8884/mqtt')).toBeNull();
    expect(brokerUrlError('http://broker')).toMatch(/ws/);
    expect(brokerUrlError('')).toMatch(/Enter/);
    expect(mixedContentWarning('https:', 'ws://192.168.1.5:9001')).toMatch(/mixed content/);
    expect(mixedContentWarning('https:', 'wss://x:8884')).toBeNull();
    expect(mixedContentWarning('http:', 'ws://localhost:9001')).toBeNull();
  });

  it('never stores the password unless "remember" was ticked', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    saveProfiles(storage, [
      { name: 'a', url: 'wss://x', password: 'secret', savePassword: false },
      { name: 'b', url: 'wss://y', password: 'kept', savePassword: true },
    ]);
    const raw = store.get(PROFILE_STORAGE_KEY);
    expect(raw).not.toContain('secret');
    expect(raw).toContain('kept');
    const loaded = loadProfiles(storage);
    expect(loaded.map((p) => p.name)).toEqual(['a', 'b']);
    expect(loaded[0].password).toBeUndefined();
    expect(stripProfileSecrets({ name: 'c', password: 'x' })).toEqual({ name: 'c' });
  });

  it('loadProfiles tolerates missing or corrupt storage', () => {
    expect(loadProfiles(undefined)).toEqual([]);
    expect(loadProfiles({ getItem: () => '{not json' })).toEqual([]);
    expect(loadProfiles({ getItem: () => '{"a":1}' })).toEqual([]);
  });

  it('parses hex payloads and rejects odd digit counts', () => {
    expect(hx(parseHex('de ad:BE'))).toBe('de ad be');
    expect(hx(parseHex('0x0a'))).toBe('0a');
    expect(() => parseHex('abc')).toThrow(/even number/);
    expect(() => parseHex('zz')).toThrow(/even number/);
  });

  it('pretty-prints JSON payloads and returns null otherwise, and hex-dumps bytes', () => {
    expect(prettyJson(new TextEncoder().encode('{"on":true,"n":2}'))).toBe('{\n  "on": true,\n  "n": 2\n}');
    expect(prettyJson(new TextEncoder().encode('ON'))).toBeNull();
    expect(hexDump(new TextEncoder().encode('Hi!'))).toMatch(/^00000000  48 69 21 +\|Hi!\|$/);
  });
});

// A minimal WebSocket stand-in so the client flows can be driven without a broker.
class FakeWS {
  static last = null;
  constructor(url, protocol) {
    this.url = url;
    this.protocol = protocol;
    this.readyState = 0;
    this.sent = [];
    FakeWS.last = this;
  }
  send(data) {
    this.sent.push(new Uint8Array(data));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  deliver(bytes) {
    this.onmessage?.({ data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  lastPacket() {
    return decodePacket(this.sent[this.sent.length - 1]);
  }
}

function newClient(extra = {}) {
  return new MqttClient({
    url: 'ws://localhost:9001', clientId: 'tester', WebSocketImpl: FakeWS,
    connectTimeoutMs: 1000, ackTimeoutMs: 1000, ...extra,
  });
}

async function connectedClient(extra = {}) {
  const client = newClient(extra);
  const p = client.connect();
  const ws = FakeWS.last;
  ws.open();
  ws.deliver(encodeConnack());
  await p;
  return { client, ws };
}

describe('MqttClient over a fake WebSocket', () => {
  it('uses the mqtt subprotocol, binary frames and sends CONNECT first', async () => {
    const { ws, client } = await connectedClient();
    expect(ws.url).toBe('ws://localhost:9001');
    expect(ws.protocol).toBe('mqtt');
    expect(client.state).toBe('connected');
    expect(decodePacket(ws.sent[0])).toMatchObject({ type: 'CONNECT', clientId: 'tester', keepAlive: 60 });
  });

  it('rejects a refused CONNACK with the broker message', async () => {
    const client = newClient();
    const p = client.connect();
    const ws = FakeWS.last;
    ws.open();
    ws.deliver(encodeConnack({ returnCode: 5 }));
    await expect(p).rejects.toThrow('Refused: not authorized');
    expect(client.state).toBe('disconnected');
  });

  it('subscribes, reports the granted QoS, and treats 0x80 as failure', async () => {
    const { ws, client } = await connectedClient();
    const p = client.subscribe('sensors/#', 1);
    const sub = ws.lastPacket();
    expect(sub).toMatchObject({ type: 'SUBSCRIBE', subscriptions: [{ filter: 'sensors/#', qos: 1 }] });
    ws.deliver(encodeSuback({ packetId: sub.packetId, returnCodes: [1] }));
    expect(await p).toEqual({ filter: 'sensors/#', granted: 1, failed: false });

    const p2 = client.subscribe('secret/#', 0);
    ws.deliver(encodeSuback({ packetId: ws.lastPacket().packetId, returnCodes: [0x80] }));
    expect(await p2).toEqual({ filter: 'secret/#', granted: null, failed: true });
  });

  it('delivers an incoming QoS 1 message once and answers PUBACK', async () => {
    const { ws, client } = await connectedClient();
    const got = [];
    client.onMessage = (m) => got.push(m);
    ws.deliver(encodePublish({ topic: 'a/b', payload: 'x', qos: 1, packetId: 11 }));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ topic: 'a/b', qos: 1, direction: 'in' });
    expect(ws.lastPacket()).toEqual({ type: 'PUBACK', packetId: 11 });
  });

  it('handles an incoming QoS 2 message exactly once: PUBREC, then PUBCOMP on PUBREL', async () => {
    const { ws, client } = await connectedClient();
    const got = [];
    client.onMessage = (m) => got.push(m);
    ws.deliver(encodePublish({ topic: 'a/b', payload: 'x', qos: 2, packetId: 5 }));
    expect(ws.lastPacket()).toEqual({ type: 'PUBREC', packetId: 5 });
    ws.deliver(encodePublish({ topic: 'a/b', payload: 'x', qos: 2, packetId: 5, dup: true }));
    expect(got).toHaveLength(1);
    expect(ws.lastPacket()).toEqual({ type: 'PUBREC', packetId: 5 });
    ws.deliver(encodePubrel(5));
    expect(ws.lastPacket()).toEqual({ type: 'PUBCOMP', packetId: 5 });
  });

  it('runs the outgoing QoS 2 flow PUBLISH, PUBREC, PUBREL, PUBCOMP before resolving', async () => {
    const { ws, client } = await connectedClient();
    const p = client.publish('cmnd/plug/POWER', 'ON', { qos: 2, retain: false });
    const pub = ws.lastPacket();
    expect(pub).toMatchObject({ type: 'PUBLISH', topic: 'cmnd/plug/POWER', qos: 2, retain: false });
    ws.deliver(encodePubrec(pub.packetId));
    expect(ws.lastPacket()).toEqual({ type: 'PUBREL', packetId: pub.packetId });
    ws.deliver(encodePubcomp(pub.packetId));
    await expect(p).resolves.toEqual({ qos: 2, packetId: pub.packetId });
    expect(client.pending.size).toBe(0);
  });

  it('resolves an outgoing QoS 1 publish on PUBACK and QoS 0 immediately', async () => {
    const { ws, client } = await connectedClient();
    const p = client.publish('a', 'v', { qos: 1 });
    const pub = ws.lastPacket();
    ws.deliver(encodePuback(pub.packetId));
    await expect(p).resolves.toEqual({ qos: 1, packetId: pub.packetId });
    await expect(client.publish('a', new Uint8Array([1, 2]))).resolves.toEqual({ qos: 0, packetId: undefined });
    expect(ws.lastPacket()).toMatchObject({ type: 'PUBLISH', qos: 0, topic: 'a' });
  });

  it('rejects publishes with wildcards before anything is sent', async () => {
    const { ws, client } = await connectedClient();
    const before = ws.sent.length;
    await expect(client.publish('a/+', 'x')).rejects.toThrow(/wildcard/);
    expect(ws.sent.length).toBe(before);
  });

  it('unsubscribes and answers UNSUBACK', async () => {
    const { ws, client } = await connectedClient();
    const p = client.unsubscribe('a/#');
    ws.deliver(encodeUnsuback(ws.lastPacket().packetId));
    await expect(p).resolves.toEqual({ filter: 'a/#' });
  });

  it('tolerates an unsolicited PINGRESP and sends DISCONNECT on disconnect', async () => {
    const { ws, client } = await connectedClient();
    ws.deliver(encodePingresp()); // no reply expected; must not throw
    client.disconnect();
    expect(ws.sent[ws.sent.length - 1]).toEqual(encodeDisconnect());
    expect(client.state).toBe('disconnected');
  });

  it('fails in-flight publishes when the socket closes', async () => {
    const { ws, client } = await connectedClient();
    const p = client.publish('a', 'v', { qos: 1 });
    ws.onclose?.({ code: 1006, reason: '' });
    await expect(p).rejects.toThrow(/Connection closed/);
    expect(client.state).toBe('disconnected');
  });
});

describe('base64 payloads', () => {
  it('round-trips bytes and accepts URL-safe/unpadded input', () => {
    const b = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xfb]);
    expect(Array.from(parseBase64(bytesToBase64(b)))).toEqual(Array.from(b));
    expect(Array.from(parseBase64('3q2-7_s'))).toEqual(Array.from(b));
    expect(parseBase64('').length).toBe(0);
  });
  it('rejects invalid base64', () => {
    expect(() => parseBase64('a$b')).toThrow(/base64/);
  });
});

const NL = String.fromCharCode(10);
describe('diffLines', () => {
  it('marks added, removed and unchanged lines', () => {
    const d = diffLines(['{', '  "a": 1,', '  "b": 2', '}'].join(NL), ['{', '  "a": 1,', '  "b": 3', '}'].join(NL));
    expect(d.filter((x) => x.type === 'del').map((x) => x.text)).toEqual(['  "b": 2']);
    expect(d.filter((x) => x.type === 'add').map((x) => x.text)).toEqual(['  "b": 3']);
    expect(d.filter((x) => x.type === 'same').length).toBe(3);
  });
  it('reports identical text as all same', () => {
    expect(diffLines('x', 'x')).toEqual([{ type: 'same', text: 'x' }]);
  });
});

describe('mqttxCommand', () => {
  it('builds a subscribe command for a wss broker without the password', () => {
    const c = mqttxCommand('sub', { url: 'wss://broker.hivemq.com:8884/mqtt', clientId: 'c1', username: 'u', filters: ['a/#', 'b/+'], qos: 1 });
    expect(c).toBe("mqttx sub -l wss -h 'broker.hivemq.com' -p 8884 --path '/mqtt' -i 'c1' -u 'u' -P '<password>' -t 'a/#' -t 'b/+' -q 1");
  });
  it('builds a publish command and quotes single quotes', () => {
    const c = mqttxCommand('pub', { url: 'ws://localhost:9001', topic: 't', payload: "it's", retain: true });
    expect(c).toBe("mqttx pub -l ws -h 'localhost' -p 9001 -t 't' -q 0 -m 'it'\\''s' -r");
  });
  it('returns null for bad URLs or missing topic', () => {
    expect(mqttxCommand('sub', { url: 'mqtt://x' })).toBeNull();
    expect(mqttxCommand('pub', { url: 'ws://x' })).toBeNull();
  });
});
