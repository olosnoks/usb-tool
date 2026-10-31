// MicroPython raw REPL over serial, following micropython's tools/pyboard.py:
//   Ctrl-C x2 (stop the running program) -> Ctrl-A, wait for
//   "raw REPL; CTRL-B to exit\r\n>" -> send code in 256-byte chunks ->
//   Ctrl-D -> "OK" -> stdout ... \x04 stderr ... \x04 ">" -> Ctrl-B to leave.
// Replies are read from every received chunk (not a batched UI prop), and the
// wait ends on the protocol's terminators, so long outputs aren't cut short.

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class RawRepl {
  /**
   * @param {(bytes: Uint8Array) => Promise<void>} write
   * @param {(fn: (bytes: Uint8Array) => void) => () => void} subscribe
   */
  constructor(write, subscribe) {
    this.write = write;
    this.subscribe = subscribe;
    this.buf = '';
    this.waiter = null;
    this.dec = new TextDecoder();
  }

  _start() {
    if (this.unsub) return;
    this.unsub = this.subscribe((bytes) => {
      this.buf += this.dec.decode(bytes, { stream: true });
      if (this.waiter) { const w = this.waiter; this.waiter = null; w(); }
    });
  }

  stop() { if (this.unsub) { this.unsub(); this.unsub = null; } }

  /** Wait until `marker` is in the buffer; returns the text before it and consumes through it. */
  async _until(marker, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const i = this.buf.indexOf(marker);
      if (i >= 0) {
        const before = this.buf.slice(0, i);
        this.buf = this.buf.slice(i + marker.length);
        return before;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no "${JSON.stringify(marker).slice(1, -1)}" from the board within ${Math.round(timeoutMs / 1000)} s`);
      await Promise.race([new Promise((r) => { this.waiter = r; }), sleep(Math.min(left, 100))]);
    }
  }

  async enter() {
    this._start();
    await this.write(enc.encode('\r\x03\x03'));
    await sleep(100);
    this.buf = '';
    await this.write(enc.encode('\r\x01'));
    try {
      await this._until('raw REPL; CTRL-B to exit\r\n>', 3000);
    } catch (e) {
      throw new Error('the board did not enter the raw REPL. Is it running MicroPython / CircuitPython, and not busy?');
    }
  }

  /** Run code; resolves { stdout, stderr }. */
  async exec(code, timeoutMs = 10000) {
    const bytes = enc.encode(code);
    for (let i = 0; i < bytes.length; i += 256) {
      await this.write(bytes.subarray(i, i + 256));
      await sleep(10);
    }
    await this.write(Uint8Array.of(0x04));
    await this._until('OK', 3000);
    const stdout = await this._until('\x04', timeoutMs);
    const stderr = await this._until('\x04', timeoutMs);
    await this._until('>', 2000).catch(() => {});
    return { stdout, stderr };
  }

  async exit() {
    try { await this.write(Uint8Array.of(0x02)); } finally { this.stop(); }
  }
}

/** Enter the raw REPL, run code, leave. stderr (a traceback) is returned after stdout. */
export async function runInRawRepl(write, subscribe, code, timeoutMs) {
  const repl = new RawRepl(write, subscribe);
  try {
    await repl.enter();
    const { stdout, stderr } = await repl.exec(code, timeoutMs);
    return stderr ? `${stdout}\n${stderr}` : stdout;
  } finally {
    await repl.exit().catch(() => {});
  }
}
