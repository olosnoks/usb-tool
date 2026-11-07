/**
 * adbDriver.js — Android Debug Bridge (ADB) over WebUSB.
 *
 * Implements the ADB transport protocol: the 24-byte message framing, the
 * CNXN/AUTH authentication handshake (RSA, via adbCrypto), stream multiplexing
 * (OPEN/OKAY/WRTE/CLSE), and the common services — `shell:`, the `sync:`
 * file-transfer sub-protocol (push/pull), `tcpip:` and `reboot:`.
 *
 * I/O goes through an injected transport so the whole thing is testable against
 * a fake adbd with no device present (see tests/adb.test.js):
 *
 *     transport.write(Uint8Array) -> Promise<void>
 *     transport.read(maxLength)   -> Promise<Uint8Array>
 *     transport.close()           -> Promise<void>
 *
 * This only does what a device owner can already do with `adb` once they tap
 * "Allow USB debugging" on the phone: run shell commands, move files, go
 * wireless, reboot. It is not a lock bypass — an un-authorized device simply
 * never sends its CNXN and the connect call reports that the prompt was declined.
 *
 * References: AOSP system/core/adb/protocol.txt and SERVICES.TXT.
 */

import { generateAdbKey, signAdbToken, encodeAdbPublicKey } from './adbCrypto';

const A_CNXN = 0x4e584e43;
const A_AUTH = 0x48545541;
const A_OPEN = 0x4e45504f;
const A_OKAY = 0x59414b4f;
const A_CLSE = 0x45534c43;
const A_WRTE = 0x45545257;

export const ADB_COMMANDS = { A_CNXN, A_AUTH, A_OPEN, A_OKAY, A_CLSE, A_WRTE };

const A_VERSION = 0x01000001;
const MAX_PAYLOAD = 256 * 1024;
const AUTH_TOKEN = 1;
const AUTH_SIGNATURE = 2;
const AUTH_RSAPUBLICKEY = 3;

const te = new TextEncoder();
const td = new TextDecoder();

export class AdbError extends Error {}

/** Pack a message: 24-byte header (little-endian) + payload. */
export function packMessage(command, arg0, arg1, payload = new Uint8Array()) {
  const header = new ArrayBuffer(24);
  const dv = new DataView(header);
  dv.setUint32(0, command >>> 0, true);
  dv.setUint32(4, arg0 >>> 0, true);
  dv.setUint32(8, arg1 >>> 0, true);
  dv.setUint32(12, payload.length, true);
  dv.setUint32(16, checksum(payload), true);
  dv.setUint32(20, (command ^ 0xffffffff) >>> 0, true);
  const out = new Uint8Array(24 + payload.length);
  out.set(new Uint8Array(header), 0);
  out.set(payload, 24);
  return out;
}

export function parseHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, 24);
  return {
    command: dv.getUint32(0, true),
    arg0: dv.getUint32(4, true),
    arg1: dv.getUint32(8, true),
    length: dv.getUint32(12, true),
    checksum: dv.getUint32(16, true),
    magic: dv.getUint32(20, true)
  };
}

/** ADB's payload checksum: the sum of the bytes, modulo 2^32. */
export function checksum(payload) {
  let sum = 0;
  for (const b of payload) sum = (sum + b) >>> 0;
  return sum;
}

const cmdName = (c) => Object.keys(ADB_COMMANDS).find((k) => ADB_COMMANDS[k] === c)?.slice(2) || `0x${c.toString(16)}`;

/** Buffers transport.read() so the driver can pull exact byte counts. */
class Reader {
  constructor(transport) { this.transport = transport; this.buf = new Uint8Array(0); }
  async readExact(n) {
    while (this.buf.length < n) {
      const chunk = await this.transport.read(Math.max(n - this.buf.length, 512));
      if (!chunk || chunk.length === 0) {
        if (this.closed) throw new AdbError('Connection closed by the device.');
        continue;
      }
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf); merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    const out = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return out;
  }
}

export class AdbConnection {
  constructor(transport, { keyStore = defaultKeyStore(), logger = () => {}, name = 'host::features=shell_v2,cmd,stat_v2' } = {}) {
    this.transport = transport;
    this.reader = new Reader(transport);
    this.keyStore = keyStore;
    this.logger = logger;
    this.hostBanner = name;
    this.maxPayload = MAX_PAYLOAD;
    this.nextLocalId = 1;
    this.connected = false;
  }

  log(msg, type = 'info') { this.logger(msg, type); }

  async _send(command, arg0, arg1, payload) {
    await this.transport.write(packMessage(command, arg0, arg1, payload));
  }

  async _recv() {
    const header = parseHeader(await this.reader.readExact(24));
    const data = header.length ? await this.reader.readExact(header.length) : new Uint8Array();
    return { ...header, data };
  }

  /**
   * CNXN + AUTH handshake. Signs the device's token with the stored key; if the
   * device doesn't recognise it, sends the public key, which triggers the
   * on-device "Allow USB debugging?" dialog. Resolves with the device banner.
   */
  async connect({ onPrompt } = {}) {
    if (this.transport.open) await this.transport.open();
    const key = await this.keyStore.get();
    await this._send(A_CNXN, A_VERSION, MAX_PAYLOAD, te.encode(`${this.hostBanner}\u0000`));
    let sentSignature = false;
    let promptShown = false;
    for (;;) {
      const m = await this._recv();
      if (m.command === A_CNXN) {
        this.maxPayload = m.arg1 || MAX_PAYLOAD;
        this.connected = true;
        this.banner = td.decode(m.data).replace(/\u0000+$/, '');
        this.log(`Connected: ${this.banner}`, 'ok');
        return { banner: this.banner, maxPayload: this.maxPayload };
      }
      if (m.command === A_AUTH && m.arg0 === AUTH_TOKEN) {
        if (!sentSignature) {
          const sig = signAdbToken(key.privateJwk, m.data);
          await this._send(A_AUTH, AUTH_SIGNATURE, 0, sig);
          sentSignature = true;
        } else {
          // Our stored key is unknown to the device: offer the public key,
          // which makes the phone show its authorization dialog.
          if (!promptShown) { promptShown = true; onPrompt?.(); this.log('Sent public key — tap "Allow USB debugging" on the device.', 'info'); }
          await this._send(A_AUTH, AUTH_RSAPUBLICKEY, 0, te.encode(encodeAdbPublicKey(key.publicJwk)));
        }
        continue;
      }
      throw new AdbError(`Unexpected ${cmdName(m.command)} during connect.`);
    }
  }

  /** Open a service (e.g. "shell:ls", "sync:", "tcpip:5555"). */
  async open(service) {
    if (!this.connected) throw new AdbError('Not connected.');
    const localId = this.nextLocalId++;
    await this._send(A_OPEN, localId, 0, te.encode(`${service}\u0000`));
    for (;;) {
      const m = await this._recv();
      if (m.arg1 !== localId && m.command !== A_CNXN) continue; // not for us
      if (m.command === A_OKAY) return new AdbStream(this, localId, m.arg0);
      if (m.command === A_CLSE) throw new AdbError(`Device refused service "${service}".`);
    }
  }

  /** Read a stream to its end and return all bytes. */
  async _collect(stream) {
    const chunks = [];
    for (;;) {
      const data = await stream.read();
      if (data === null) break;
      chunks.push(data);
    }
    let total = 0; chunks.forEach((c) => (total += c.length));
    const all = new Uint8Array(total);
    let off = 0; chunks.forEach((c) => { all.set(c, off); off += c.length; });
    return all;
  }

  /** Run a shell command and collect its full output as text. */
  async shell(command) {
    return td.decode(await this._collect(await this.open(`shell:${command}`)));
  }

  /** Run a command without a pty and return its raw output bytes (binary-safe, e.g. screencap -p). */
  async execOut(command) {
    return this._collect(await this.open(`exec:${command}`));
  }

  /** Put adbd into TCP/IP mode on `port`, so you can `adb connect ip:port`. */
  async tcpip(port = 5555) {
    const stream = await this.open(`tcpip:${port}`);
    const msg = td.decode((await stream.read()) || new Uint8Array());
    await stream.close();
    return msg.trim() || `restarting adbd in TCP mode on port ${port}`;
  }

  async reboot(target = '') {
    const stream = await this.open(`reboot:${target}`);
    try { await stream.read(); } catch (e) { /* link drops as it reboots */ }
  }

  // --- sync: file transfer ------------------------------------------------

  async _syncOpen() { return this.open('sync:'); }

  /** Push bytes to `remotePath` with POSIX `mode`. */
  async push(remotePath, data, { mode = 0o644, onProgress } = {}) {
    const s = await this._syncOpen();
    try {
      const pathMode = `${remotePath},${mode}`;
      await s.write(syncPacket('SEND', te.encode(pathMode)));
      const chunk = 64 * 1024; // sync protocol max
      for (let off = 0; off < data.length; off += chunk) {
        const part = data.subarray(off, Math.min(off + chunk, data.length));
        await s.write(syncPacket('DATA', part));
        onProgress?.(Math.min(off + chunk, data.length) / Math.max(data.length, 1));
      }
      const done = new Uint8Array(8);
      const dv = new DataView(done.buffer);
      dv.setUint32(0, 0x454e4f44, true); // 'DONE'
      dv.setUint32(4, Math.floor(Date.now() / 1000), true); // mtime
      await s.write(done);
      const resp = await s.readSync();
      if (resp.id === 'FAIL') throw new AdbError(`push failed: ${td.decode(resp.data)}`);
      if (resp.id !== 'OKAY') throw new AdbError(`push: unexpected "${resp.id}".`);
    } finally {
      await s.quitSync();
    }
  }

  /** Pull `remotePath` and return its bytes. */
  async pull(remotePath, { onProgress } = {}) {
    const s = await this._syncOpen();
    try {
      await s.write(syncPacket('RECV', te.encode(remotePath)));
      const chunks = [];
      for (;;) {
        const pkt = await s.readSync();
        if (pkt.id === 'DONE') break;
        if (pkt.id === 'FAIL') throw new AdbError(`pull failed: ${td.decode(pkt.data)}`);
        if (pkt.id !== 'DATA') throw new AdbError(`pull: unexpected "${pkt.id}".`);
        chunks.push(pkt.data);
        onProgress?.(chunks.length);
      }
      let total = 0; chunks.forEach((c) => (total += c.length));
      const all = new Uint8Array(total);
      let off = 0; chunks.forEach((c) => { all.set(c, off); off += c.length; });
      return all;
    } finally {
      await s.quitSync();
    }
  }

  /** List a directory with the sync protocol: [{ name, mode, size, mtime, isDir, isLink }]. */
  async list(remotePath) {
    const s = await this._syncOpen();
    try {
      await s.write(syncPacket('LIST', te.encode(remotePath)));
      const out = [];
      for (;;) {
        const head = await s.readBytes(4);
        const id = String.fromCharCode(...head);
        if (id === 'DONE') { await s.readBytes(16); break; }
        if (id === 'FAIL') {
          const len = new DataView((await s.readBytes(4)).buffer).getUint32(0, true);
          throw new AdbError(`list failed: ${td.decode(await s.readBytes(len))}`);
        }
        if (id !== 'DENT') throw new AdbError(`list: unexpected "${id}".`);
        const b = await s.readBytes(16);
        const dv = new DataView(b.buffer, b.byteOffset, 16);
        const mode = dv.getUint32(0, true);
        const name = td.decode(await s.readBytes(dv.getUint32(12, true)));
        if (name === '.' || name === '..') continue;
        const type = mode & 0o170000;
        out.push({ name, mode, size: dv.getUint32(4, true), mtime: dv.getUint32(8, true), isDir: type === 0o040000, isLink: type === 0o120000 });
      }
      return out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    } finally {
      await s.quitSync();
    }
  }

  async close() {
    this.connected = false;
    if (this.transport.close) await this.transport.close();
  }
}

/** Build a sync sub-packet: 4-char id + u32 length + data. */
export function syncPacket(id, data = new Uint8Array()) {
  const out = new Uint8Array(8 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, id.charCodeAt(0) | (id.charCodeAt(1) << 8) | (id.charCodeAt(2) << 16) | (id.charCodeAt(3) << 24), true);
  dv.setUint32(4, data.length, true);
  out.set(data, 8);
  return out;
}

/**
 * One ADB stream. Writes are flow-controlled: each WRTE waits for the device's
 * OKAY. Incoming WRTEs are acknowledged and buffered. Used half-duplex, which
 * is all shell/sync need.
 */
export class AdbStream {
  constructor(connection, localId, remoteId) {
    this.c = connection;
    this.localId = localId;
    this.remoteId = remoteId;
    this.inbox = [];
    this.closed = false;
    this.sentClose = false;
    this.syncBuf = new Uint8Array(0);
  }

  // Pump messages for this stream until `mode` is satisfied:
  //   'okay' — the device acknowledged our last WRTE
  //   'data' — a WRTE arrived (buffered in inbox), or the stream closed
  async _pumpUntil(mode) {
    for (;;) {
      if (mode === 'data' && this.inbox.length) return;
      if (this.closed) return;
      const m = await this.c._recv();
      if (m.arg1 !== this.localId) continue; // for another stream (we run one at a time)
      if (m.command === A_WRTE) {
        this.inbox.push(m.data);
        await this.c._send(A_OKAY, this.localId, this.remoteId);
        if (mode === 'data') return;
      } else if (m.command === A_OKAY) {
        if (mode === 'okay') return;
      } else if (m.command === A_CLSE) {
        // The device half-closed; acknowledge with our own CLSE once.
        this.closed = true;
        if (!this.sentClose) { this.sentClose = true; try { await this.c._send(A_CLSE, this.localId, this.remoteId); } catch (e) { /* ignore */ } }
        return;
      }
    }
  }

  async write(data) {
    if (data.length === 0) {
      await this.c._send(A_WRTE, this.localId, this.remoteId);
      await this._pumpUntil('okay');
      return;
    }
    for (let off = 0; off < data.length; off += this.c.maxPayload) {
      const part = data.subarray(off, Math.min(off + this.c.maxPayload, data.length));
      await this.c._send(A_WRTE, this.localId, this.remoteId, part);
      await this._pumpUntil('okay');
    }
  }

  /** Next incoming chunk, or null once the stream is closed. */
  async read() {
    if (this.inbox.length) return this.inbox.shift();
    if (this.closed) return null;
    await this._pumpUntil('data');
    return this.inbox.length ? this.inbox.shift() : null;
  }

  async _need(n) {
    while (this.syncBuf.length < n) {
      const more = await this.read();
      if (more === null) throw new AdbError('Stream closed mid sync packet.');
      const merged = new Uint8Array(this.syncBuf.length + more.length);
      merged.set(this.syncBuf); merged.set(more, this.syncBuf.length);
      this.syncBuf = merged;
    }
  }

  /** Exactly `n` bytes of the stream, spanning WRTE chunks. */
  async readBytes(n) {
    await this._need(n);
    const out = this.syncBuf.slice(0, n);
    this.syncBuf = this.syncBuf.slice(n);
    return out;
  }

  // Read one sync sub-packet (id + length-prefixed data), spanning WRTE chunks.
  async readSync() {
    const need = (n) => this._need(n);
    await need(8);
    const dv = new DataView(this.syncBuf.buffer, this.syncBuf.byteOffset, 8);
    const id = String.fromCharCode(this.syncBuf[0], this.syncBuf[1], this.syncBuf[2], this.syncBuf[3]);
    const len = dv.getUint32(4, true);
    await need(8 + len);
    const data = this.syncBuf.slice(8, 8 + len);
    this.syncBuf = this.syncBuf.slice(8 + len);
    return { id, data };
  }

  async quitSync() {
    try { await this.write(syncPacket('QUIT')); } catch (e) { /* ignore */ }
    await this.close();
  }

  async close() {
    if (this.closed) { this.closed = true; return; }
    this.sentClose = true;
    try {
      await this.c._send(A_CLSE, this.localId, this.remoteId);
    } catch (e) { /* ignore */ }
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Key storage (persists the host key so the device remembers authorization)
// ---------------------------------------------------------------------------

export function defaultKeyStore(storageKey = 'adb.hostKey') {
  return {
    async get() {
      if (typeof localStorage !== 'undefined') {
        const saved = localStorage.getItem(storageKey);
        if (saved) { try { return JSON.parse(saved); } catch (e) { /* regenerate */ } }
      }
      const key = await generateAdbKey();
      try { localStorage?.setItem(storageKey, JSON.stringify(key)); } catch (e) { /* non-persistent */ }
      return key;
    }
  };
}

// ---------------------------------------------------------------------------
// WebUSB transport
// ---------------------------------------------------------------------------

export const ADB_INTERFACE_CLASS = { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 };

export function findAdbInterface(configuration) {
  for (const iface of configuration?.interfaces || []) {
    for (const alt of iface.alternates || []) {
      if (alt.interfaceClass === 0xff && alt.interfaceSubclass === 0x42 && alt.interfaceProtocol === 0x01) {
        const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
        const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
        if (out && inn) return { interfaceNumber: iface.interfaceNumber, epOut: out.endpointNumber, epIn: inn.endpointNumber };
      }
    }
  }
  return null;
}

export class AdbUsbTransport {
  constructor(device) { this.device = device; }
  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = findAdbInterface(d.configuration);
    if (!found) throw new AdbError('No ADB interface. Enable USB debugging and keep the phone in Android (not fastboot/recovery).');
    this.interfaceNumber = found.interfaceNumber;
    this.epOut = found.epOut; this.epIn = found.epIn;
    await d.claimInterface(this.interfaceNumber);
  }
  async write(bytes) {
    const r = await this.device.transferOut(this.epOut, bytes);
    if (r.status !== 'ok') throw new AdbError(`USB OUT ${r.status}`);
  }
  async read(maxLength) {
    const r = await this.device.transferIn(this.epIn, maxLength);
    if (r.status !== 'ok' && !r.data) throw new AdbError(`USB IN ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

export const ADB_USB_FILTERS = [{ classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 }];

export async function requestAdbDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new AdbError('WebUSB needs Chrome or Edge over HTTPS.');
  const device = await navigator.usb.requestDevice({ filters: ADB_USB_FILTERS });
  return new AdbUsbTransport(device);
}
