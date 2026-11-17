/**
 * adbDriver.js — Android Debug Bridge (ADB) over WebUSB.
 *
 * Implements the ADB transport protocol: the 24-byte message framing, the
 * CNXN/AUTH authentication handshake (RSA, via adbCrypto), stream multiplexing
 * (OPEN/OKAY/WRTE/CLSE), and the common services — `shell:`, the `sync:`
 * file-transfer sub-protocol (streaming push/pull, stat_v2), `shell,v2:` (an
 * interactive pty shell with separate stdout/stderr and an exit status),
 * `tcpip:` and `reboot:`.
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
const SYNC_DATA_MAX = 64 * 1024; // the sync protocol's per-DATA-packet limit

const te = new TextEncoder();
const td = new TextDecoder();

/**
 * Features this host really implements, advertised in the CNXN banner. Only add
 * a name here once the code behind it exists:
 *   shell_v2 — `openShell()` / `shellV2()` (stdin/stdout/stderr/exit framing)
 *   stat_v2  — `stat()` and `list()` use STA2/LIS2 when the device has it, so
 *              sizes above 4 GiB are exact
 * (`cmd` is not advertised: nothing here uses the `cmd` / abb services.)
 */
export const HOST_FEATURES = ['shell_v2', 'stat_v2'];
export const hostBanner = (features = HOST_FEATURES) => `host::features=${features.join(',')}`;

/** Parse the `features=a,b,c` part of a device banner into a Set. */
export function parseBannerFeatures(banner) {
  const m = String(banner || '').match(/(?:^|[;:])features=([^;]*)/);
  return new Set((m?.[1] || '').split(',').map((f) => f.trim()).filter(Boolean));
}

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

const concatBytes = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const throwIfAborted = (signal) => { if (signal?.aborted) throw new AdbError('Cancelled.'); };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Buffers transport.read() so the driver can pull exact byte counts. */
class Reader {
  constructor(transport) { this.transport = transport; this.buf = new Uint8Array(0); this.closed = false; }
  abort() { this.closed = true; }
  async readExact(n) {
    while (this.buf.length < n) {
      if (this.closed) throw new AdbError('Connection closed.');
      const chunk = await this.transport.read(Math.max(n - this.buf.length, 512));
      if (!chunk || chunk.length === 0) {
        if (this.closed) throw new AdbError('Connection closed.');
        await tick(); // never spin the microtask queue on an idle link
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
  constructor(transport, { keyStore = defaultKeyStore(), logger = () => {}, name = hostBanner() } = {}) {
    this.transport = transport;
    this.reader = new Reader(transport);
    this.keyStore = keyStore;
    this.logger = logger;
    this.hostBanner = name;
    this.maxPayload = MAX_PAYLOAD;
    this.nextLocalId = 1;
    this.connected = false;
    this.features = new Set();
    this.streams = new Map(); // localId -> AdbStream
    this._pumping = null;
    this._sendChain = Promise.resolve();
  }

  log(msg, type = 'info') { this.logger(msg, type); }

  hasFeature(name) { return this.features.has(name); }

  /** Sends are serialised so two streams never interleave a header and payload. */
  _send(command, arg0, arg1, payload) {
    const p = this._sendChain.then(() => this.transport.write(packMessage(command, arg0, arg1, payload)));
    this._sendChain = p.catch(() => {});
    return p;
  }

  async _recv() {
    const header = parseHeader(await this.reader.readExact(24));
    const data = header.length ? await this.reader.readExact(header.length) : new Uint8Array();
    return { ...header, data };
  }

  /**
   * Read and route one incoming message. Every stream that is waiting calls
   * this; concurrent callers share the one in-flight read, so several streams
   * (an interactive shell plus a transfer, say) can be open together.
   */
  _pump() {
    if (!this._pumping) {
      this._pumping = this._recvAndRoute().finally(() => { this._pumping = null; });
    }
    return this._pumping;
  }

  async _recvAndRoute() {
    const m = await this._recv();
    await this.streams.get(m.arg1)?._onMessage(m);
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
        this.features = parseBannerFeatures(this.banner);
        this.log(`Connected: ${this.banner}`, 'ok');
        return { banner: this.banner, maxPayload: this.maxPayload, features: [...this.features] };
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
    const stream = new AdbStream(this, localId);
    this.streams.set(localId, stream);
    try {
      await this._send(A_OPEN, localId, 0, te.encode(`${service}\u0000`));
      await stream._until(() => stream.remoteId !== null || stream.closed);
    } catch (e) {
      this.streams.delete(localId);
      throw e;
    }
    if (stream.remoteId === null) {
      this.streams.delete(localId);
      throw new AdbError(`Device refused service "${service}".`);
    }
    return stream;
  }

  /** Read a stream to its end and return all bytes. */
  async _collect(stream) {
    const chunks = [];
    for (;;) {
      const data = await stream.read();
      if (data === null) break;
      chunks.push(data);
    }
    return concatBytes(chunks);
  }

  /** Run a shell command and collect its full output as text (legacy `shell:`, stdout+stderr merged). */
  async shell(command) {
    return td.decode(await this._collect(await this.open(`shell:${command}`)));
  }

  /** Run a command without a pty and return its raw output bytes (binary-safe, e.g. screencap -p). */
  async execOut(command) {
    return this._collect(await this.open(`exec:${command}`));
  }

  // --- shell_v2 -------------------------------------------------------------

  _requireShellV2() {
    if (!this.hasFeature('shell_v2')) throw new AdbError('This device does not advertise shell_v2 (Android 7+ does); the interactive shell needs it.');
  }

  /**
   * Run one command over `shell,v2:` and return { stdout, stderr, exitCode }
   * with the streams kept apart and the real exit status.
   */
  async shellV2(command, { stdin } = {}) {
    this._requireShellV2();
    const stream = await this.open(`shell,v2:${command}`);
    if (stdin?.length) await stream.write(packShellPacket(SHELL.STDIN, stdin));
    if (stdin) await stream.write(packShellPacket(SHELL.CLOSE_STDIN));
    const out = []; const err = []; let exitCode = null;
    const dec = new ShellPacketDecoder();
    for (;;) {
      const chunk = await stream.read();
      if (chunk === null) break;
      for (const pkt of dec.push(chunk)) {
        if (pkt.id === SHELL.STDOUT) out.push(pkt.data);
        else if (pkt.id === SHELL.STDERR) err.push(pkt.data);
        else if (pkt.id === SHELL.EXIT) exitCode = pkt.data[0] ?? 0;
      }
    }
    return { stdout: td.decode(concatBytes(out)), stderr: td.decode(concatBytes(err)), exitCode };
  }

  /**
   * Start an interactive shell on a pty. `onData(text, 'stdout'|'stderr')`
   * receives decoded output as it arrives. Resolves to a ShellSession.
   */
  async openShell({ command = '', term = 'dumb', rows = 24, cols = 80, onData } = {}) {
    this._requireShellV2();
    const stream = await this.open(`shell,v2,TERM=${term},pty:${command}`);
    const session = new ShellSession(stream, onData);
    if (rows && cols) await session.resize(rows, cols);
    return session;
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

  /**
   * stat a remote path: { exists, mode, size, mtime, isDir, isLink }. Uses
   * STA2 (64-bit sizes) when the device advertises stat_v2, else STAT.
   */
  async stat(remotePath) {
    const s = await this._syncOpen();
    try {
      const v2 = this.hasFeature('stat_v2');
      await s.write(syncPacket(v2 ? 'STA2' : 'STAT', te.encode(remotePath)));
      const id = String.fromCharCode(...(await s.readBytes(4)));
      if (v2) {
        if (id !== 'STA2') throw new AdbError(`stat: unexpected "${id}".`);
        const b = await s.readBytes(68);
        const dv = new DataView(b.buffer, b.byteOffset, 68);
        const error = dv.getUint32(0, true);
        const mode = dv.getUint32(20, true);
        return statInfo(error === 0, mode, Number(dv.getBigUint64(36, true)), Number(dv.getBigInt64(52, true)));
      }
      if (id !== 'STAT') throw new AdbError(`stat: unexpected "${id}".`);
      const b = await s.readBytes(12);
      const dv = new DataView(b.buffer, b.byteOffset, 12);
      const mode = dv.getUint32(0, true);
      return statInfo(mode !== 0, mode, dv.getUint32(4, true), dv.getUint32(8, true));
    } finally {
      await s.quitSync();
    }
  }

  /**
   * Push in-memory bytes to `remotePath` with POSIX `mode`. For anything big use
   * `pushFrom()`, which never holds the whole file. `onProgress(fraction, bytes, total)`.
   */
  async push(remotePath, data, { mode = 0o644, onProgress, signal } = {}) {
    return this._push(remotePath, bytesChunks(data), data.length, { mode, onProgress, signal });
  }

  /** Push a File/Blob, read in chunks (File.stream() when available), never fully in memory. */
  async pushFrom(file, remotePath, { mode = 0o644, onProgress, signal } = {}) {
    const mtime = file.lastModified ? Math.floor(file.lastModified / 1000) : undefined;
    return this._push(remotePath, blobChunks(file), file.size, { mode, onProgress, signal, mtime });
  }

  async _push(remotePath, chunks, total, { mode, onProgress, signal, mtime }) {
    const s = await this._syncOpen();
    try {
      await s.write(syncPacket('SEND', te.encode(`${remotePath},${mode}`)));
      let done = 0;
      let batch = []; let batchLen = 0;
      const flush = async () => {
        if (!batch.length) return;
        await s.write(concatBytes(batch));
        batch = []; batchLen = 0;
        onProgress?.(total ? Math.min(done / total, 1) : 1, done, total);
      };
      for await (const part of chunks) {
        throwIfAborted(signal);
        const pkt = syncPacket('DATA', part);
        if (batchLen + pkt.length > this.maxPayload) await flush();
        batch.push(pkt); batchLen += pkt.length; done += part.length;
      }
      await flush();
      throwIfAborted(signal);
      const doneMsg = new Uint8Array(8);
      const dv = new DataView(doneMsg.buffer);
      dv.setUint32(0, 0x454e4f44, true); // 'DONE'
      dv.setUint32(4, mtime ?? Math.floor(Date.now() / 1000), true);
      await s.write(doneMsg);
      const resp = await s.readSync();
      if (resp.id === 'FAIL') throw new AdbError(`push failed: ${td.decode(resp.data)}`);
      if (resp.id !== 'OKAY') throw new AdbError(`push: unexpected "${resp.id}".`);
      if (total === 0) onProgress?.(1, 0, 0);
    } finally {
      await s.quitSync();
    }
  }

  /**
   * Stream `remotePath` into `writable` — anything with `write(Uint8Array)`: a
   * FileSystemWritableFileStream, a WritableStreamDefaultWriter, or a plain
   * object. Chunks go straight through, so memory stays flat for any size. The
   * caller closes the writable. `onProgress(fraction|null, bytes, total|null)`.
   * Returns the number of bytes written.
   */
  async pullTo(remotePath, writable, { onProgress, signal, total } = {}) {
    let size = total;
    if (size === undefined) {
      try { const st = await this.stat(remotePath); size = st.exists ? st.size : null; } catch (e) { size = null; }
    }
    const s = await this._syncOpen();
    let done = 0;
    try {
      await s.write(syncPacket('RECV', te.encode(remotePath)));
      for (;;) {
        throwIfAborted(signal);
        const pkt = await s.readSync();
        if (pkt.id === 'DONE') break;
        if (pkt.id === 'FAIL') throw new AdbError(`pull failed: ${td.decode(pkt.data)}`);
        if (pkt.id !== 'DATA') throw new AdbError(`pull: unexpected "${pkt.id}".`);
        await writable.write(pkt.data);
        done += pkt.data.length;
        onProgress?.(size ? Math.min(done / size, 1) : null, done, size ?? null);
      }
      return done;
    } finally {
      await s.quitSync();
    }
  }

  /** Pull `remotePath` fully into memory. Fine for small files; use `pullTo()` for big ones. */
  async pull(remotePath, { onProgress, signal } = {}) {
    const chunks = [];
    await this.pullTo(remotePath, { write: (c) => { chunks.push(c); } }, { total: null, signal, onProgress });
    return concatBytes(chunks);
  }

  /**
   * List a directory: [{ name, mode, size, mtime, isDir, isLink }]. Uses LIS2
   * (64-bit sizes) when the device advertises stat_v2, else LIST (sizes wrap at 4 GiB).
   */
  async list(remotePath) {
    const s = await this._syncOpen();
    try {
      const v2 = this.hasFeature('stat_v2');
      await s.write(syncPacket(v2 ? 'LIS2' : 'LIST', te.encode(remotePath)));
      const out = [];
      for (;;) {
        const id = String.fromCharCode(...(await s.readBytes(4)));
        if (id === 'DONE') { await s.readBytes(v2 ? 72 : 16); break; }
        if (id === 'FAIL') {
          const len = new DataView((await s.readBytes(4)).buffer).getUint32(0, true);
          throw new AdbError(`list failed: ${td.decode(await s.readBytes(len))}`);
        }
        let entry;
        if (v2) {
          if (id !== 'DNT2') throw new AdbError(`list: unexpected "${id}".`);
          const b = await s.readBytes(72);
          const dv = new DataView(b.buffer, b.byteOffset, 72);
          const name = td.decode(await s.readBytes(dv.getUint32(68, true)));
          entry = { name, mode: dv.getUint32(20, true), size: Number(dv.getBigUint64(36, true)), mtime: Number(dv.getBigInt64(52, true)) };
        } else {
          if (id !== 'DENT') throw new AdbError(`list: unexpected "${id}".`);
          const b = await s.readBytes(16);
          const dv = new DataView(b.buffer, b.byteOffset, 16);
          const name = td.decode(await s.readBytes(dv.getUint32(12, true)));
          entry = { name, mode: dv.getUint32(0, true), size: dv.getUint32(4, true), mtime: dv.getUint32(8, true) };
        }
        if (entry.name === '.' || entry.name === '..') continue;
        const type = entry.mode & 0o170000;
        out.push({ ...entry, isDir: type === 0o040000, isLink: type === 0o120000 });
      }
      return out.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name));
    } finally {
      await s.quitSync();
    }
  }

  async close() {
    this.connected = false;
    this.reader.abort();
    for (const s of this.streams.values()) s.closed = true;
    this.streams.clear();
    if (this.transport.close) await this.transport.close();
  }
}

function statInfo(exists, mode, size, mtime) {
  const type = mode & 0o170000;
  return { exists, mode, size, mtime, isDir: exists && type === 0o040000, isLink: exists && type === 0o120000 };
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

async function* bytesChunks(data, size = SYNC_DATA_MAX) {
  for (let off = 0; off < data.length; off += size) yield data.subarray(off, Math.min(off + size, data.length));
}

/** Yield a Blob in <= `size`-byte pieces: via blob.stream() when present, else slice(). */
export async function* blobChunks(blob, size = SYNC_DATA_MAX) {
  if (typeof blob.stream === 'function') {
    const reader = blob.stream().getReader();
    let carry = new Uint8Array(0);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        let buf = carry.length ? concatBytes([carry, value]) : value;
        let off = 0;
        while (buf.length - off >= size) { yield buf.subarray(off, off + size); off += size; }
        carry = buf.subarray(off);
      }
    } finally { try { reader.releaseLock(); } catch (e) { /* ignore */ } }
    if (carry.length) yield carry;
    return;
  }
  const step = size * 16; // slice() reads a megabyte at a time, then we cut it up
  for (let off = 0; off < blob.size; off += step) {
    const buf = new Uint8Array(await blob.slice(off, Math.min(off + step, blob.size)).arrayBuffer());
    yield* bytesChunks(buf, size);
  }
}

// ---------------------------------------------------------------------------
// shell_v2 framing: 1-byte id | u32 LE length | data
// ---------------------------------------------------------------------------

export const SHELL = { STDIN: 0, STDOUT: 1, STDERR: 2, EXIT: 3, CLOSE_STDIN: 4, WINDOW_SIZE: 5 };

export function packShellPacket(id, data = new Uint8Array()) {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  const out = new Uint8Array(5 + bytes.length);
  out[0] = id;
  new DataView(out.buffer).setUint32(1, bytes.length, true);
  out.set(bytes, 5);
  return out;
}

/** Reassembles shell_v2 packets from arbitrarily split stream chunks. */
export class ShellPacketDecoder {
  constructor() { this.buf = new Uint8Array(0); }
  push(chunk) {
    this.buf = this.buf.length ? concatBytes([this.buf, chunk]) : chunk;
    const out = [];
    let off = 0;
    while (this.buf.length - off >= 5) {
      const len = new DataView(this.buf.buffer, this.buf.byteOffset + off + 1, 4).getUint32(0, true);
      if (this.buf.length - off < 5 + len) break;
      out.push({ id: this.buf[off], data: this.buf.slice(off + 5, off + 5 + len) });
      off += 5 + len;
    }
    this.buf = this.buf.slice(off);
    return out;
  }
}

/** An interactive shell_v2 session (pty). Output arrives through `onData`; `done` resolves at exit. */
export class ShellSession {
  constructor(stream, onData = () => {}) {
    this.stream = stream;
    this.onData = onData;
    this.exitCode = null;
    this.decoders = { [SHELL.STDOUT]: new TextDecoder(), [SHELL.STDERR]: new TextDecoder() };
    this.packets = new ShellPacketDecoder();
    this.done = this._loop();
  }

  async _loop() {
    try {
      for (;;) {
        const chunk = await this.stream.read();
        if (chunk === null) break;
        for (const pkt of this.packets.push(chunk)) {
          if (pkt.id === SHELL.STDOUT || pkt.id === SHELL.STDERR) {
            const text = this.decoders[pkt.id].decode(pkt.data, { stream: true });
            if (text) this.onData(text, pkt.id === SHELL.STDOUT ? 'stdout' : 'stderr');
          } else if (pkt.id === SHELL.EXIT) {
            this.exitCode = pkt.data[0] ?? 0;
          }
        }
      }
    } catch (e) {
      return { exitCode: this.exitCode, error: e };
    }
    return { exitCode: this.exitCode };
  }

  get closed() { return this.stream.closed; }

  /** Send text or bytes to the shell's stdin (the pty echoes and edits it). */
  async write(data) {
    if (this.stream.closed) return;
    await this.stream.write(packShellPacket(SHELL.STDIN, data));
  }

  /** Ctrl-C: the pty turns byte 0x03 into SIGINT for the foreground process. */
  interrupt() { return this.write(new Uint8Array([0x03])); }

  /** Ctrl-D: end-of-input on the pty (exits an idle shell). */
  sendEof() { return this.write(new Uint8Array([0x04])); }

  resize(rows, cols) {
    return this.stream.write(packShellPacket(SHELL.WINDOW_SIZE, `${rows}x${cols},0x0`));
  }

  async close() { await this.stream.close(); }
}

/**
 * One ADB stream. Reads and writes are independent: a shell can be written to
 * while its output is being read, and several streams can be open at once.
 * Writes are flow-controlled (one WRTE in flight, released by the device's
 * OKAY); incoming WRTEs are acknowledged only when the consumer reads them, so
 * a slow consumer slows the device instead of buffering without bound.
 */
export class AdbStream {
  constructor(connection, localId) {
    this.c = connection;
    this.localId = localId;
    this.remoteId = null; // set by the device's OKAY to our OPEN
    this.inbox = [];
    this.closed = false;
    this.sentClose = false;
    this.acked = true;
    this.syncBuf = new Uint8Array(0);
    this._writeChain = Promise.resolve();
  }

  // Called by the connection's pump for each message addressed to this stream.
  async _onMessage(m) {
    if (m.command === A_OKAY) {
      if (this.remoteId === null) this.remoteId = m.arg0; else this.acked = true;
    } else if (m.command === A_WRTE) {
      this.inbox.push(m.data);
    } else if (m.command === A_CLSE) {
      this.closed = true;
      this.c.streams.delete(this.localId);
      if (!this.sentClose && this.remoteId !== null) {
        this.sentClose = true;
        try { await this.c._send(A_CLSE, this.localId, this.remoteId); } catch (e) { /* ignore */ }
      }
    }
  }

  async _until(cond) {
    while (!cond()) await this.c._pump();
  }

  write(data) {
    const run = async () => {
      if (data.length === 0) {
        this.acked = false;
        await this.c._send(A_WRTE, this.localId, this.remoteId);
        await this._until(() => this.acked || this.closed);
        return;
      }
      for (let off = 0; off < data.length; off += this.c.maxPayload) {
        if (this.closed) throw new AdbError('Stream closed by the device.');
        const part = data.subarray(off, Math.min(off + this.c.maxPayload, data.length));
        this.acked = false;
        await this.c._send(A_WRTE, this.localId, this.remoteId, part);
        await this._until(() => this.acked || this.closed);
      }
    };
    const p = this._writeChain.then(run);
    this._writeChain = p.catch(() => {});
    return p;
  }

  /** Next incoming chunk, or null once the stream is closed and drained. */
  async read() {
    await this._until(() => this.inbox.length > 0 || this.closed);
    if (!this.inbox.length) return null;
    const chunk = this.inbox.shift();
    if (!this.closed) { try { await this.c._send(A_OKAY, this.localId, this.remoteId); } catch (e) { /* ignore */ } }
    return chunk;
  }

  async _need(n) {
    while (this.syncBuf.length < n) {
      const more = await this.read();
      if (more === null) throw new AdbError('Stream closed mid sync packet.');
      this.syncBuf = this.syncBuf.length ? concatBytes([this.syncBuf, more]) : more;
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
    await this._need(8);
    const dv = new DataView(this.syncBuf.buffer, this.syncBuf.byteOffset, 8);
    const id = String.fromCharCode(this.syncBuf[0], this.syncBuf[1], this.syncBuf[2], this.syncBuf[3]);
    const len = dv.getUint32(4, true);
    await this._need(8 + len);
    const data = this.syncBuf.slice(8, 8 + len);
    this.syncBuf = this.syncBuf.slice(8 + len);
    return { id, data };
  }

  async quitSync() {
    try { await this.write(syncPacket('QUIT')); } catch (e) { /* ignore */ }
    await this.close();
  }

  async close() {
    if (this.closed) return;
    this.sentClose = true;
    this.closed = true;
    this.c.streams.delete(this.localId);
    if (this.remoteId === null) return;
    try {
      await this.c._send(A_CLSE, this.localId, this.remoteId);
    } catch (e) { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Key storage (persists the host key so the device remembers authorization)
// ---------------------------------------------------------------------------

/**
 * The host key lives in localStorage as a JWK (private exponent included).
 *
 * Why not a non-extractable CryptoKey in IndexedDB? adbd's AUTH_TOKEN is already
 * a SHA-1 digest and must be signed as RSASSA-PKCS1-v1_5 over that digest with
 * no further hashing (see adbCrypto.js). SubtleCrypto can only sign *messages*
 * (it hashes them first) and exposes no raw-RSA / pre-hashed signing, so a
 * non-extractable key would produce signatures adbd rejects, and the phone would
 * show "Allow USB debugging?" on every connect. The signing therefore needs the
 * private exponent in JS. `clear()` lets the user delete the key (and make the
 * device forget this browser) from the UI.
 */
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
    },
    clear() {
      try { localStorage?.removeItem(storageKey); } catch (e) { /* ignore */ }
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

/** Turn a WebUSB open/claim failure into advice a user can act on. */
export function explainUsbError(err, stage = 'claim') {
  const detail = err?.message ? ` (${err.message})` : '';
  if (stage === 'claim' || /access denied|busy|in use|claim/i.test(err?.message || '') || err?.name === 'SecurityError') {
    return 'Another program (usually the adb server) owns this device. Run "adb kill-server", close Android Studio, scrcpy or other phone tools, then connect again. '
      + `On Windows the phone also needs a WinUSB driver for its ADB interface (Zadig or the Google USB driver).${detail}`;
  }
  return `Could not open the USB device${detail}.`;
}

export class AdbUsbTransport {
  constructor(device) { this.device = device; }
  async open() {
    const d = this.device;
    try {
      if (!d.opened) await d.open();
    } catch (e) {
      throw new AdbError(explainUsbError(e, 'open'));
    }
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = findAdbInterface(d.configuration);
    if (!found) throw new AdbError('No ADB interface. Enable USB debugging and keep the phone in Android (not fastboot/recovery).');
    this.interfaceNumber = found.interfaceNumber;
    this.epOut = found.epOut; this.epIn = found.epIn;
    try {
      await d.claimInterface(this.interfaceNumber);
    } catch (e) {
      try { await d.close(); } catch (e2) { /* ignore */ }
      throw new AdbError(explainUsbError(e, 'claim'));
    }
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
