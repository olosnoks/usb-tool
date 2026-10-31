/**
 * serialLink.js — a byte-oriented request/response link over one serial port.
 *
 * Binary protocols (STK500, Bus Pirate binary mode, SUMP) need "write these
 * bytes, then read exactly N back within T ms". SerialLink owns a port for one
 * tool: it registers with the shared port manager, runs one background reader
 * into a buffer, and offers read(n, timeout) / readUntil / drain on top of it.
 *
 * Any object shaped like a Web Serial SerialPort works (open, readable,
 * writable, close, optional setSignals), so tests drive it with a fake device.
 */

import { requestPortFor, releasePort, closeSerialPort } from './portManager';

export class SerialTimeoutError extends Error {
  constructor(what, got = 0, wanted = 0) {
    super(`Timed out waiting for ${what}${wanted ? ` (got ${got} of ${wanted} bytes)` : ''}`);
    this.name = 'SerialTimeoutError';
  }
}

export class SerialLink {
  /**
   * @param {any} port  An unopened SerialPort (or fake).
   * @param {{ name: string, release?: () => any }} [owner]  Port-manager owner.
   */
  constructor(port, owner = null) {
    this.port = port;
    this.owner = owner;
    this.buffer = [];
    this.waiters = [];
    this.reader = null;
    this.readLoop = null;
    this.isOpen = false;
    this.onData = null; // optional (Uint8Array) => void tap for logging
  }

  /** Show the port picker, claim the port for `owner`, and open it. */
  static async request(owner, openOptions, requestOptions) {
    const port = await requestPortFor(owner, requestOptions);
    const link = new SerialLink(port, owner);
    try {
      await link.open(openOptions);
    } catch (e) {
      releasePort(port, owner);
      throw e;
    }
    return link;
  }

  async open(options = { baudRate: 115200 }) {
    await this.port.open(options);
    this.isOpen = true;
    this.readLoop = this._runReader();
  }

  async _runReader() {
    while (this.isOpen && this.port.readable) {
      try {
        this.reader = this.port.readable.getReader();
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && value.length) {
            for (const b of value) this.buffer.push(b);
            if (this.onData) this.onData(value);
            this._wake();
          }
        }
      } catch (e) {
        if (!this.isOpen) break;
      } finally {
        try { this.reader?.releaseLock(); } catch (e) { /* ignore */ }
        this.reader = null;
      }
      if (!this.isOpen) break;
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  _wake() {
    const pending = this.waiters;
    this.waiters = [];
    pending.forEach((w) => w());
  }

  _waitForData(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== done);
        resolve(false);
      }, ms);
      const done = () => { clearTimeout(t); resolve(true); };
      this.waiters.push(done);
    });
  }

  async write(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const writer = this.port.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      writer.releaseLock();
    }
  }

  /** Bytes currently buffered. */
  get available() { return this.buffer.length; }

  /** Read exactly n bytes, or throw SerialTimeoutError after `timeoutMs`. */
  async read(n, timeoutMs = 1000, what = 'a reply') {
    const deadline = Date.now() + timeoutMs;
    while (this.buffer.length < n) {
      const left = deadline - Date.now();
      if (left <= 0 || !(await this._waitForData(left))) {
        if (this.buffer.length >= n) break;
        throw new SerialTimeoutError(what, this.buffer.length, n);
      }
    }
    return Uint8Array.from(this.buffer.splice(0, n));
  }

  /** Read until `predicate(bytesSoFar)` is true. Returns the bytes consumed. */
  async readUntil(predicate, timeoutMs = 1000, what = 'a reply') {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      for (let i = 1; i <= this.buffer.length; i++) {
        if (predicate(this.buffer.slice(0, i))) return Uint8Array.from(this.buffer.splice(0, i));
      }
      const left = deadline - Date.now();
      if (left <= 0 || !(await this._waitForData(left))) throw new SerialTimeoutError(what);
    }
  }

  /** Wait `quietMs` and throw away whatever arrived (stale replies, banners). */
  async drain(quietMs = 50) {
    await new Promise((r) => setTimeout(r, quietMs));
    const n = this.buffer.length;
    this.buffer = [];
    return n;
  }

  async setSignals(signals) {
    if (this.port.setSignals) await this.port.setSignals(signals);
  }

  async close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    await closeSerialPort(this.port, { reader: this.reader, readLoop: this.readLoop });
    if (this.owner) releasePort(this.port, this.owner);
    this._wake();
  }
}

/**
 * A fake serial port for tests and demos: `respond(bytes, port)` is called for
 * every write and may call port.feed(...) to answer.
 */
export class FakeSerialPort {
  constructor(respond = () => {}) {
    this.respond = respond;
    this.writes = [];
    this.signals = [];
    this.opened = null;
    this._controller = null;
    this.readable = null;
    this.writable = null;
  }

  async open(options) {
    this.opened = options;
    this.readable = new ReadableStream({ start: (c) => { this._controller = c; } });
    this.writable = new WritableStream({
      write: (chunk) => {
        const bytes = Uint8Array.from(chunk);
        this.writes.push(bytes);
        this.respond(bytes, this);
      }
    });
  }

  feed(bytes) {
    if (this._controller) this._controller.enqueue(Uint8Array.from(bytes));
  }

  async setSignals(s) { this.signals.push(s); }

  async close() {
    try { this._controller?.close(); } catch (e) { /* already closed */ }
    this.readable = null;
    this.writable = null;
  }

  getInfo() { return {}; }
}
