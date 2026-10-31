/**
 * fido2Driver.js — read a FIDO2 / U2F security key over CTAP-HID (WebHID).
 *
 * This is read-only discovery: CTAPHID_INIT to allocate a channel, then
 * authenticatorGetInfo (CTAP2) to report the key's versions, AAGUID, options
 * and limits, plus a PING round-trip. It intentionally does NOT create, list,
 * or delete credentials, change the PIN, or reset the key.
 *
 * I/O goes through an injected transport of 64-byte reports so the HID framing
 * and CBOR decoding are testable against a fake authenticator (tests/fido2.test.js):
 *
 *     transport.write(Uint8Array(64)) -> Promise<void>
 *     transport.read()                -> Promise<Uint8Array(64)>
 *     transport.close()               -> Promise<void>
 *
 * References: FIDO CTAP 2.1 (CTAPHID + authenticatorGetInfo); RFC 8949 (CBOR).
 */

export const CTAPHID = {
  PING: 0x81, MSG: 0x83, INIT: 0x86, CBOR: 0x90, CANCEL: 0x91,
  KEEPALIVE: 0xbb, ERROR: 0xbf
};
export const CTAP2_CMD = { GET_INFO: 0x04 };
export const BROADCAST_CID = 0xffffffff;
const PACKET = 64;
const td = new TextDecoder();

export class Fido2Error extends Error {}

// --- tiny CBOR decoder (the subset authenticatorGetInfo uses) ---------------

export function decodeCbor(bytes, offset = 0) {
  const b = bytes;
  let o = offset;
  const ib = b[o++];
  const mt = ib >> 5;
  const ai = ib & 0x1f;
  const readLen = () => {
    if (ai < 24) return ai;
    if (ai === 24) return b[o++];
    if (ai === 25) { const v = (b[o] << 8) | b[o + 1]; o += 2; return v; }
    if (ai === 26) { const v = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; o += 4; return v; }
    throw new Fido2Error('CBOR length too large.');
  };
  switch (mt) {
    case 0: { const v = readLen(); return { value: v, offset: o }; }
    case 1: { const v = readLen(); return { value: -1 - v, offset: o }; }
    case 2: { const n = readLen(); const s = b.slice(o, o + n); return { value: s, offset: o + n }; }
    case 3: { const n = readLen(); const s = td.decode(b.slice(o, o + n)); return { value: s, offset: o + n }; }
    case 4: { const n = readLen(); const arr = []; for (let i = 0; i < n; i++) { const r = decodeCbor(b, o); arr.push(r.value); o = r.offset; } return { value: arr, offset: o }; }
    case 5: { const n = readLen(); const map = new Map(); for (let i = 0; i < n; i++) { const k = decodeCbor(b, o); const v = decodeCbor(b, k.offset); map.set(k.value, v.value); o = v.offset; } return { value: map, offset: o }; }
    case 7: {
      if (ai === 20) return { value: false, offset: o };
      if (ai === 21) return { value: true, offset: o };
      if (ai === 22) return { value: null, offset: o };
      if (ai === 23) return { value: undefined, offset: o };
      throw new Fido2Error(`Unsupported CBOR simple value ${ai}.`);
    }
    default: throw new Fido2Error(`Unsupported CBOR major type ${mt}.`);
  }
}

export function aaguidToString(bytes) {
  const h = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Parse an authenticatorGetInfo CBOR map into named fields. */
export function parseGetInfo(cborBytes) {
  const { value: map } = decodeCbor(cborBytes);
  if (!(map instanceof Map)) throw new Fido2Error('GetInfo did not return a CBOR map.');
  const options = map.get(0x04);
  const optObj = {};
  if (options instanceof Map) for (const [k, v] of options) optObj[k] = v;
  const aaguid = map.get(0x03);
  return {
    versions: map.get(0x01) || [],
    extensions: map.get(0x02) || [],
    aaguid: aaguid ? aaguidToString(aaguid) : null,
    options: optObj,
    maxMsgSize: map.get(0x05) ?? null,
    pinUvAuthProtocols: map.get(0x06) || [],
    maxCredentialCountInList: map.get(0x07) ?? null,
    maxCredentialIdLength: map.get(0x08) ?? null,
    transports: map.get(0x09) || [],
    algorithms: map.get(0x0a) || []
  };
}

// --- CTAP-HID framing -------------------------------------------------------

/** Split a message into 64-byte CTAP-HID packets (init + continuations). */
export function buildPackets(cid, cmd, data) {
  const packets = [];
  const init = new Uint8Array(PACKET);
  const dv = new DataView(init.buffer);
  dv.setUint32(0, cid >>> 0, false);
  init[4] = cmd | 0x80;
  dv.setUint16(5, data.length, false);
  const firstChunk = Math.min(data.length, PACKET - 7);
  init.set(data.subarray(0, firstChunk), 7);
  packets.push(init);
  let off = firstChunk;
  let seq = 0;
  while (off < data.length) {
    const cont = new Uint8Array(PACKET);
    new DataView(cont.buffer).setUint32(0, cid >>> 0, false);
    cont[4] = seq++ & 0x7f;
    const chunk = Math.min(data.length - off, PACKET - 5);
    cont.set(data.subarray(off, off + chunk), 5);
    packets.push(cont);
    off += chunk;
  }
  return packets;
}

export class Fido2Device {
  constructor(transport, { logger = () => {} } = {}) {
    this.transport = transport;
    this.logger = logger;
    this.cid = BROADCAST_CID;
    this.chain = Promise.resolve();
  }

  _serialize(fn) { const r = this.chain.then(fn, fn); this.chain = r.then(() => {}, () => {}); return r; }

  async open() { if (this.transport.open) await this.transport.open(); }

  async _send(cmd, data) {
    for (const pkt of buildPackets(this.cid, cmd, data)) await this.transport.write(pkt);
  }

  async _recv() {
    for (;;) {
      const first = await this.transport.read();
      const dv = new DataView(first.buffer, first.byteOffset, first.byteLength);
      const cmd = first[4] & 0x7f;
      if ((first[4] & 0x80) === 0) continue; // not an init packet; ignore stray continuation
      if (first[4] === CTAPHID.KEEPALIVE) continue; // device still working; wait for the real reply
      const bcnt = dv.getUint16(5, false);
      const data = new Uint8Array(bcnt);
      let off = Math.min(bcnt, PACKET - 7);
      data.set(first.subarray(7, 7 + off), 0);
      while (off < bcnt) {
        const cont = await this.transport.read();
        const chunk = Math.min(bcnt - off, PACKET - 5);
        data.set(cont.subarray(5, 5 + chunk), off);
        off += chunk;
      }
      if (first[4] === CTAPHID.ERROR) throw new Fido2Error(`CTAPHID error 0x${(data[0] || 0).toString(16)}.`);
      return { cmd, data };
    }
  }

  /** CTAPHID_INIT: allocate a channel and read the key's CTAPHID capabilities. */
  init() {
    return this._serialize(async () => {
      const nonce = crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(8)) : Uint8Array.from({ length: 8 }, (_, i) => i);
      this.cid = BROADCAST_CID;
      await this._send(CTAPHID.INIT, nonce);
      const { data } = await this._recv();
      for (let i = 0; i < 8; i++) if (data[i] !== nonce[i]) throw new Fido2Error('CTAPHID_INIT nonce mismatch.');
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      this.cid = dv.getUint32(8, false);
      this.ctapInfo = {
        protocolVersion: data[12],
        deviceVersion: `${data[13]}.${data[14]}.${data[15]}`,
        capabilities: data[16],
        capWink: !!(data[16] & 0x01),
        capCbor: !!(data[16] & 0x04),
        capNmsg: !!(data[16] & 0x08)
      };
      return this.ctapInfo;
    });
  }

  /** authenticatorGetInfo (CTAP2 CBOR command 0x04). */
  getInfo() {
    return this._serialize(async () => {
      await this._send(CTAPHID.CBOR, Uint8Array.from([CTAP2_CMD.GET_INFO]));
      const { data } = await this._recv();
      if (data[0] !== 0x00) throw new Fido2Error(`authenticatorGetInfo returned CTAP status 0x${data[0].toString(16)}.`);
      return parseGetInfo(data.slice(1));
    });
  }

  /** CTAPHID_PING round-trip: returns true if the echo matches. */
  ping(size = 16) {
    return this._serialize(async () => {
      const payload = crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(size)) : new Uint8Array(size);
      await this._send(CTAPHID.PING, payload);
      const { data } = await this._recv();
      return data.length === payload.length && data.every((b, i) => b === payload[i]);
    });
  }

  async close() { if (this.transport.close) await this.transport.close(); }
}

// --- WebHID transport -------------------------------------------------------

export const FIDO_USAGE = { page: 0xf1d0, usage: 0x01 };

export class Fido2HidTransport {
  constructor(device) { this.device = device; this.queue = []; this.waiters = []; }
  _onReport = (e) => {
    const data = new Uint8Array(64);
    data.set(new Uint8Array(e.data.buffer, e.data.byteOffset, Math.min(e.data.byteLength, 64)));
    const w = this.waiters.shift();
    if (w) w(data); else this.queue.push(data);
  };
  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this._onReport);
  }
  async write(bytes) { await this.device.sendReport(0, bytes); }
  read() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== done); reject(new Fido2Error('Security key did not answer (HID timeout).')); }, 5000);
      const done = (d) => { clearTimeout(t); resolve(d); };
      this.waiters.push(done);
    });
  }
  async close() {
    try { this.device.removeEventListener('inputreport', this._onReport); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

export async function requestFido2Device() {
  if (typeof navigator === 'undefined' || !navigator.hid) throw new Fido2Error('WebHID needs Chrome or Edge over HTTPS.');
  const [dev] = await navigator.hid.requestDevice({ filters: [{ usagePage: FIDO_USAGE.page, usage: FIDO_USAGE.usage }] });
  if (!dev) throw new Fido2Error('No security key selected.');
  return new Fido2HidTransport(dev);
}

// --- simulated authenticator (demo + tests) --------------------------------

function cborBytes(...parts) { let n = 0; parts.forEach((p) => (n += p.length)); const o = new Uint8Array(n); let k = 0; parts.forEach((p) => { o.set(p, k); k += p.length; }); return o; }
function cborText(s) { const u = new TextEncoder().encode(s); return cborBytes(Uint8Array.from([0x60 | u.length]), u); }
function cborArray(items) { return cborBytes(Uint8Array.from([0x80 | items.length]), ...items); }

export function createSimulatedFido2() {
  const state = { simulated: true, cid: 0x11223344 };
  let pending = [];
  const reply = (cid, cmd, data) => { for (const p of buildPackets(cid, cmd, data)) pending.push(p); };
  // authenticatorGetInfo: status 0x00 + CBOR map {1:[versions],3:aaguid,4:{options}}
  const aaguid = Uint8Array.from({ length: 16 }, (_, i) => i + 1);
  const getInfoCbor = cborBytes(
    Uint8Array.from([0x00]), // CTAP status OK
    Uint8Array.from([0xa3]), // map(3)
    Uint8Array.from([0x01]), cborArray([cborText('U2F_V2'), cborText('FIDO_2_0'), cborText('FIDO_2_1')]),
    Uint8Array.from([0x03]), cborBytes(Uint8Array.from([0x50]), aaguid), // bstr(16)
    Uint8Array.from([0x04]), cborBytes(Uint8Array.from([0xa2]), cborText('rk'), Uint8Array.from([0xf5]), cborText('uv'), Uint8Array.from([0xf5]))
  );
  return {
    state,
    async open() {}, async close() {},
    async write(bytes) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const cmd = bytes[4] & 0x7f;
      if ((bytes[4] & 0x80) === 0) return; // continuation; our tests send single-packet commands
      const bcnt = dv.getUint16(5, false);
      const data = bytes.slice(7, 7 + bcnt);
      if (bytes[4] === CTAPHID.INIT) {
        const resp = new Uint8Array(17);
        resp.set(data.subarray(0, 8), 0); // echo nonce
        new DataView(resp.buffer).setUint32(8, state.cid, false);
        resp[12] = 2; resp[13] = 5; resp[14] = 2; resp[15] = 4; resp[16] = 0x04 | 0x08; // CBOR+NMSG caps
        reply(BROADCAST_CID, CTAPHID.INIT, resp);
      } else if (bytes[4] === CTAPHID.CBOR) {
        if (data[0] === CTAP2_CMD.GET_INFO) reply(state.cid, CTAPHID.CBOR, getInfoCbor);
        else reply(state.cid, CTAPHID.CBOR, Uint8Array.from([0x01])); // CTAP1_ERR_INVALID_COMMAND
      } else if (bytes[4] === CTAPHID.PING) {
        reply(state.cid, CTAPHID.PING, data);
      }
    },
    async read() { return pending.length ? pending.shift() : new Uint8Array(64); }
  };
}
