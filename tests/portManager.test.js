import { describe, it, expect, beforeEach } from 'vitest';
import {
  claimPort,
  claimForTool,
  releasePort,
  portOwner,
  requestPortFor,
  closeSerialPort,
  stopReader,
  PortBusyError,
  _resetPortManager
} from '../src/utils/portManager';

// A SerialPort-like object with real streams. close() fails while a stream is
// locked, like Chrome's ("Cannot cancel a locked stream").
function makePort() {
  let controller;
  const port = {
    readable: null,
    writable: null,
    closed: 0,
    async open() {
      if (this.readable) throw new Error('The port is already open.');
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({ write() {} });
    },
    async close() {
      if (this.readable && this.readable.locked) throw new TypeError('Cannot cancel a locked stream');
      if (this.writable && this.writable.locked) throw new TypeError('Cannot close a locked stream');
      this.readable = null; this.writable = null; this.closed++;
    },
    push(bytes) { controller.enqueue(bytes); }
  };
  return port;
}

// The read-loop shape every tool uses.
function startLoop(port, { slowRelease = 0 } = {}) {
  const reader = port.readable.getReader();
  const loop = (async () => {
    try { while (true) { const { done } = await reader.read(); if (done) break; } }
    catch (e) { /* cancelled */ }
    finally {
      if (slowRelease) await new Promise((r) => setTimeout(r, slowRelease));
      try { reader.releaseLock(); } catch (e) { /* ignore */ }
    }
  })();
  return { reader, loop };
}

beforeEach(() => _resetPortManager());

describe('port ownership', () => {
  it('lets one tool own a port and tells a second tool who has it', async () => {
    const port = makePort();
    const terminal = { name: 'Terminal (port 1)', release: async () => {} };
    const flipper = { name: 'Flipper Zero Suite', release: async () => {} };
    await claimPort(port, terminal);
    expect(portOwner(port)).toBe('Terminal (port 1)');
    await expect(claimPort(port, flipper)).rejects.toThrow(PortBusyError);
    await expect(claimPort(port, flipper)).rejects.toThrow(/in use by Terminal \(port 1\)/);
    releasePort(port, terminal);
    await claimPort(port, flipper);
    expect(portOwner(port)).toBe('Flipper Zero Suite');
  });

  it('the same tool can reclaim its own port (reconnect)', async () => {
    const port = makePort();
    await claimPort(port, { name: 'GPS & Wardrive Suite' });
    await claimPort(port, { name: 'GPS & Wardrive Suite' });   // new owner object, same tool
    expect(portOwner(port)).toBe('GPS & Wardrive Suite');
  });

  it('only the owner can release', async () => {
    const port = makePort();
    const a = { name: 'A' }, b = { name: 'B' };
    await claimPort(port, a);
    releasePort(port, b);
    expect(portOwner(port)).toBe('A');
  });

  it('takeover asks the current owner to disconnect cleanly first', async () => {
    const port = makePort();
    let reader, loop, released = false;
    const terminal = {
      name: 'Terminal (port 1)',
      release: async () => { await closeSerialPort(port, { reader, readLoop: loop }); releasePort(port, terminal); released = true; }
    };
    await claimPort(port, terminal);   // tools claim, then open
    await port.open();
    ({ reader, loop } = startLoop(port));
    const asked = [];
    await claimForTool(port, { name: 'Proxmark3 Suite' }, { confirm: (m) => { asked.push(m); return true; } });
    expect(asked[0]).toMatch(/Terminal \(port 1\) is using this device/);
    expect(released).toBe(true);
    expect(port.readable).toBe(null);
    expect(portOwner(port)).toBe('Proxmark3 Suite');
    await port.open();   // and it can be opened again
  });

  it('declining the takeover leaves the first tool alone', async () => {
    const port = makePort();
    await claimPort(port, { name: 'Terminal (port 1)', release: async () => { throw new Error('should not be called'); } });
    await expect(claimForTool(port, { name: 'Flipper Zero Suite' }, { confirm: () => false })).rejects.toThrow(PortBusyError);
    expect(portOwner(port)).toBe('Terminal (port 1)');
  });

  it('a port opened outside the manager counts as busy', async () => {
    const port = makePort();
    await port.open();
    await expect(claimPort(port, { name: 'Flipper Zero Suite' })).rejects.toThrow(/another tool/);
  });

  it('requestPortFor shows the picker and claims the port', async () => {
    const port = makePort();
    const serial = { requestPort: async () => port, addEventListener() {} };
    const got = await requestPortFor({ name: 'PortaPack Mayhem SDR' }, { filters: [] }, { serial });
    expect(got).toBe(port);
    expect(portOwner(port)).toBe('PortaPack Mayhem SDR');
  });
});

describe('ordered teardown', () => {
  it('closes after the read loop has released its lock, even when it releases late', async () => {
    const port = makePort();
    await port.open();
    // The old pattern: cancel(), then close() straight away -> close fails while
    // the loop still holds the lock, and the port stays open.
    const { reader, loop } = startLoop(port, { slowRelease: 30 });
    await closeSerialPort(port, { reader, readLoop: loop });
    expect(port.closed).toBe(1);
    expect(port.readable).toBe(null);
  });

  it('the old cancel-then-close pattern really does leave the port open', async () => {
    const port = makePort();
    await port.open();
    const { reader } = startLoop(port, { slowRelease: 30 });
    await reader.cancel();
    await expect(port.close()).rejects.toThrow(/locked/);
    await expect(port.open()).rejects.toThrow(/already open/);
  });

  it('releases a writer lock and closes a piped stream', async () => {
    const port = makePort();
    await port.open();
    const writer = port.writable.getWriter();
    const decoder = new TextDecoderStream();
    const pipe = port.readable.pipeTo(decoder.writable).catch(() => {});
    const reader = decoder.readable.getReader();
    const loop = (async () => { try { while (!(await reader.read()).done); } catch (e) {} finally { try { reader.releaseLock(); } catch (e) {} } })();
    await closeSerialPort(port, { reader, readLoop: loop, writer, pipes: [pipe] });
    expect(port.closed).toBe(1);
  });

  it('stopReader is safe with nothing to stop', async () => {
    await stopReader(null, null);
  });

  it('a hung close does not hang the caller', async () => {
    const port = { close: () => new Promise(() => {}) };
    const t0 = Date.now();
    await closeSerialPort(port, { timeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
