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
  PING: 0x81, MSG: 0x83, LOCK: 0x84, INIT: 0x86, WINK: 0x88, CBOR: 0x90, CANCEL: 0x91,
  KEEPALIVE: 0xbb, ERROR: 0xbf
};
export const CTAP2_CMD = { GET_INFO: 0x04 };
export const BROADCAST_CID = 0xffffffff;
const PACKET = 64;
const td = new TextDecoder();

export class Fido2Error extends Error {}

/** Default wait for a reply, and the wait when the key may need a touch / PIN. */
export const TIMEOUT_MS = 10000;
export const INTERACTIVE_TIMEOUT_MS = 30000;

// --- tiny CBOR decoder (the subset CTAP2 / WebAuthn use) ---------------------
// Malformed or truncated input always throws a Fido2Error, never a RangeError / TypeError.

const MAX_CBOR_DEPTH = 32;

export function decodeCbor(bytes, offset = 0, depth = 0) {
  const b = bytes;
  let o = offset;
  if (depth > MAX_CBOR_DEPTH) throw new Fido2Error('CBOR nested too deeply.');
  const need = (n) => { if (o + n > b.length) throw new Fido2Error('CBOR data is truncated.'); };
  need(1);
  const ib = b[o++];
  const mt = ib >> 5;
  const ai = ib & 0x1f;
  const readLen = () => {
    if (ai < 24) return ai;
    if (ai === 24) { need(1); return b[o++]; }
    if (ai === 25) { need(2); const v = (b[o] << 8) | b[o + 1]; o += 2; return v; }
    if (ai === 26) { need(4); const v = ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; o += 4; return v; }
    if (ai === 27) {
      need(8);
      const v = new DataView(b.buffer, b.byteOffset + o, 8).getBigUint64(0, false);
      o += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Fido2Error('CBOR integer too large.');
      return Number(v);
    }
    throw new Fido2Error('CBOR length form is not supported (indefinite length).');
  };
  switch (mt) {
    case 0: { const v = readLen(); return { value: v, offset: o }; }
    case 1: { const v = readLen(); return { value: -1 - v, offset: o }; }
    case 2: { const n = readLen(); need(n); const s = b.slice(o, o + n); return { value: s, offset: o + n }; }
    case 3: { const n = readLen(); need(n); const s = td.decode(b.slice(o, o + n)); return { value: s, offset: o + n }; }
    case 4: {
      const n = readLen();
      if (n > b.length - o) throw new Fido2Error('CBOR array longer than the data.');
      const arr = [];
      for (let i = 0; i < n; i++) { const r = decodeCbor(b, o, depth + 1); arr.push(r.value); o = r.offset; }
      return { value: arr, offset: o };
    }
    case 5: {
      const n = readLen();
      if (n > b.length - o) throw new Fido2Error('CBOR map longer than the data.');
      const map = new Map();
      for (let i = 0; i < n; i++) {
        const k = decodeCbor(b, o, depth + 1);
        const v = decodeCbor(b, k.offset, depth + 1);
        map.set(k.value, v.value);
        o = v.offset;
      }
      return { value: map, offset: o };
    }
    case 6: { readLen(); return decodeCbor(b, o, depth + 1); } // tag: return the tagged item
    case 7: {
      if (ai === 20) return { value: false, offset: o };
      if (ai === 21) return { value: true, offset: o };
      if (ai === 22) return { value: null, offset: o };
      if (ai === 23) return { value: undefined, offset: o };
      if (ai === 26) { need(4); const v = new DataView(b.buffer, b.byteOffset + o, 4).getFloat32(0, false); return { value: v, offset: o + 4 }; }
      if (ai === 27) { need(8); const v = new DataView(b.buffer, b.byteOffset + o, 8).getFloat64(0, false); return { value: v, offset: o + 8 }; }
      throw new Fido2Error(`Unsupported CBOR simple value ${ai}.`);
    }
    default: throw new Fido2Error(`Unsupported CBOR major type ${mt}.`);
  }
}

export function aaguidToString(bytes) {
  const h = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Authenticator names come from the community passkey AAGUID list
// (github.com/passkeydeveloper/passkey-authenticator-aaguids). That repository publishes no
// license, so the list is not bundled: it is fetched on demand from the public file and kept in
// memory for the session. If it can't be fetched (offline, retired list) names show as unknown.
export const AAGUID_LIST_URL =
  'https://raw.githubusercontent.com/passkeydeveloper/passkey-authenticator-aaguids/main/aaguid.json';
let AAGUIDS = {};
let aaguidLoad = null;

/** Replace the in-memory name table ({ uuid: name }); used by tests and after a fetch. */
export function setAaguidNames(map) {
  AAGUIDS = {};
  for (const [k, v] of Object.entries(map || {})) {
    const name = typeof v === 'string' ? v : v?.name;
    if (name) AAGUIDS[k.toLowerCase()] = String(name);
  }
}

/** Fetch the community list once per session. Resolves to the number of names known (0 on failure). */
export function loadAaguidNames(fetchImpl = globalThis.fetch) {
  if (!aaguidLoad) {
    aaguidLoad = Promise.resolve()
      .then(() => fetchImpl(AAGUID_LIST_URL, { cache: 'force-cache' }))
      .then((r) => (r.ok ? r.json() : {}))
      .then((json) => { setAaguidNames(json); return Object.keys(AAGUIDS).length; })
      .catch(() => { aaguidLoad = null; return 0; });
  }
  return aaguidLoad;
}

/** Authenticator model for an AAGUID (UUID string, any case), or null when it is not in the loaded list. */
export function aaguidName(uuid) {
  if (!uuid) return null;
  return AAGUIDS[String(uuid).toLowerCase()] || null;
}

const COSE_ALGS = { '-7': 'ES256', '-8': 'EdDSA', '-35': 'ES384', '-36': 'ES512', '-37': 'PS256', '-257': 'RS256', '-47': 'ES256K' };
export const coseAlgName = (alg) => COSE_ALGS[String(alg)] || `COSE ${alg}`;

/** Parse an authenticatorGetInfo CBOR map into named fields (CTAP 2.1 keys 0x01-0x16). */
export function parseGetInfo(cborBytes) {
  const { value: map } = decodeCbor(cborBytes);
  if (!(map instanceof Map)) throw new Fido2Error('GetInfo did not return a CBOR map.');
  const options = map.get(0x04);
  const optObj = {};
  if (options instanceof Map) for (const [k, v] of options) optObj[k] = v;
  const aaguid = map.get(0x03);
  const aaguidStr = aaguid instanceof Uint8Array && aaguid.length === 16 ? aaguidToString(aaguid) : null;
  const algorithms = (map.get(0x0a) || []).map((a) => (a instanceof Map
    ? { type: a.get('type') ?? null, alg: a.get('alg') ?? null, name: a.has('alg') ? coseAlgName(a.get('alg')) : null }
    : { type: null, alg: a, name: coseAlgName(a) }));
  const certs = map.get(0x13);
  return {
    versions: map.get(0x01) || [],
    extensions: map.get(0x02) || [],
    aaguid: aaguidStr,
    aaguidName: aaguidName(aaguidStr),
    options: optObj,
    maxMsgSize: map.get(0x05) ?? null,
    pinUvAuthProtocols: map.get(0x06) || [],
    maxCredentialCountInList: map.get(0x07) ?? null,
    maxCredentialIdLength: map.get(0x08) ?? null,
    transports: map.get(0x09) || [],
    algorithms,
    maxSerializedLargeBlobArray: map.get(0x0b) ?? null,
    forcePinChange: map.get(0x0c) ?? null,
    minPinLength: map.get(0x0d) ?? null,
    firmwareVersion: map.get(0x0e) ?? null,
    maxCredBlobLength: map.get(0x0f) ?? null,
    maxRpIdsForSetMinPinLength: map.get(0x10) ?? null,
    preferredPlatformUvAttempts: map.get(0x11) ?? null,
    uvModality: map.get(0x12) ?? null,
    certifications: certs instanceof Map ? Object.fromEntries(certs) : {},
    remainingDiscoverableCredentials: map.get(0x14) ?? null,
    vendorPrototypeConfigCommands: map.get(0x15) || [],
    attestationFormats: map.get(0x16) || []
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

  /**
   * Read one complete CTAPHID message addressed to `cid`. Frames for other channels and stray continuation
   * packets are ignored; KEEPALIVEs are skipped (and reset nothing: the deadline is absolute). Rejects with a
   * Fido2Error once `timeout` ms pass without a complete reply, even if the transport never answers.
   */
  async _recv({ timeout = TIMEOUT_MS, cid = this.cid, accept = null } = {}) {
    const deadline = Date.now() + timeout;
    const read = () => {
      const left = deadline - Date.now();
      if (left <= 0) throw new Fido2Error('Security key did not answer (timeout).');
      let timer;
      const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Fido2Error('Security key did not answer (timeout).')), left); });
      return Promise.race([Promise.resolve(this.transport.read(left)), expired]).finally(() => clearTimeout(timer));
    };
    const cidOf = (pkt) => new DataView(pkt.buffer, pkt.byteOffset, pkt.byteLength).getUint32(0, false);
    for (;;) {
      const first = await read();
      if (cidOf(first) !== (cid >>> 0)) continue; // another channel
      if ((first[4] & 0x80) === 0) continue; // not an init packet; ignore stray continuation
      if (first[4] === CTAPHID.KEEPALIVE) continue; // device still working; wait for the real reply
      const dv = new DataView(first.buffer, first.byteOffset, first.byteLength);
      const cmd = first[4] & 0x7f;
      const bcnt = dv.getUint16(5, false);
      const data = new Uint8Array(bcnt);
      let off = Math.min(bcnt, PACKET - 7);
      data.set(first.subarray(7, 7 + off), 0);
      let seq = 0;
      while (off < bcnt) {
        const cont = await read();
        if (cidOf(cont) !== (cid >>> 0)) continue;
        if (cont[4] & 0x80) throw new Fido2Error('Security key sent a new message in the middle of one.');
        if (cont[4] !== seq) throw new Fido2Error('CTAPHID continuation packets arrived out of order.');
        seq += 1;
        const chunk = Math.min(bcnt - off, PACKET - 5);
        data.set(cont.subarray(5, 5 + chunk), off);
        off += chunk;
      }
      if (first[4] === CTAPHID.ERROR) throw new Fido2Error(`CTAPHID error 0x${(data[0] || 0).toString(16)}.`);
      if (accept && !accept(data)) continue; // e.g. an INIT reply to someone else's nonce
      return { cmd, data };
    }
  }

  /** CTAPHID_INIT: allocate a channel and read the key's CTAPHID capabilities. */
  init() {
    return this._serialize(async () => {
      if (!(typeof crypto !== 'undefined' && crypto.getRandomValues)) throw new Fido2Error('This browser has no secure random source (crypto.getRandomValues).');
      const nonce = crypto.getRandomValues(new Uint8Array(8));
      this.cid = BROADCAST_CID;
      await this._send(CTAPHID.INIT, nonce);
      const { data } = await this._recv({ cid: BROADCAST_CID, accept: (d) => d.length >= 17 && nonce.every((n, i) => d[i] === n) });
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

  /** authenticatorGetInfo (CTAP2 CBOR command 0x04). Throws for U2F-only keys, which have no CBOR. */
  getInfo() {
    return this._serialize(async () => {
      if (this.ctapInfo && !this.ctapInfo.capCbor) throw new Fido2Error('This key is U2F-only (no CTAP2/CBOR support), so authenticatorGetInfo is not available.');
      await this._send(CTAPHID.CBOR, Uint8Array.from([CTAP2_CMD.GET_INFO]));
      const { data } = await this._recv();
      if (data[0] !== 0x00) throw new Fido2Error(`authenticatorGetInfo returned CTAP status 0x${(data[0] ?? 0).toString(16)}.`);
      return parseGetInfo(data.slice(1));
    });
  }

  /** CTAPHID_WINK: blink the key's LED (only if INIT reported the capability). */
  wink() {
    return this._serialize(async () => {
      if (this.ctapInfo && !this.ctapInfo.capWink) throw new Fido2Error('This key does not support WINK.');
      await this._send(CTAPHID.WINK, new Uint8Array(0));
      await this._recv();
      return true;
    });
  }

  /** CTAPHID_PING round-trip: returns true if the echo matches. */
  ping(size = 16) {
    return this._serialize(async () => {
      if (!(typeof crypto !== 'undefined' && crypto.getRandomValues)) throw new Fido2Error('This browser has no secure random source (crypto.getRandomValues).');
      const payload = crypto.getRandomValues(new Uint8Array(size));
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
  read(timeoutMs = 5000) {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiters = this.waiters.filter((w) => w !== done); reject(new Fido2Error('Security key did not answer (HID timeout).')); }, timeoutMs);
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
