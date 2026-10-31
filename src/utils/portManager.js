// ============================================================================
//  Shared serial-port manager
//
//  Every tool that opens a Web Serial port goes through here, so that:
//   - two tools can't fight over one device: a port has one owner at a time,
//     and a second tool asks before taking it over (the first tool is told to
//     disconnect cleanly instead of being left with a dead port);
//   - ports are always torn down in the order the Streams API needs
//     (cancel reader -> wait for the read loop -> release locks -> close),
//     each step with a timeout, so a dead or rebooting device can't leave a
//     port locked ("port is already open" on the next connect).
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function withTimeout(promise, ms, label = 'operation') {
  let t;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(t)),
    new Promise((_, reject) => { t = setTimeout(() => reject(new Error(label + ' timed out')), ms); })
  ]);
}

export class PortBusyError extends Error {
  constructor(ownerName) {
    super(`This device is already in use by ${ownerName}. Disconnect it there first.`);
    this.name = 'PortBusyError';
    this.ownerName = ownerName;
  }
}

// port -> { name, release }
const owners = new Map();
let listening = false;

function listenForUnplug(serial) {
  if (listening || !serial || !serial.addEventListener) return;
  listening = true;
  // An unplugged device frees its port; the owning tool sees its own read end.
  serial.addEventListener('disconnect', (e) => { owners.delete(e.target); });
}

/** Name of the tool holding `port`, or null. */
export function portOwner(port) {
  const o = owners.get(port);
  return o ? o.name : null;
}

/**
 * Take ownership of `port` for `owner` ({ name, release }).
 * `release()` must disconnect the owner's session (it is awaited on takeover).
 * With `takeover`, a different current owner is asked to release first.
 */
export async function claimPort(port, owner, { takeover = false, releaseTimeoutMs = 5000 } = {}) {
  if (!port) throw new Error('claimPort: no port');
  if (!owner || !owner.name) throw new Error('claimPort: owner needs a name');
  const cur = owners.get(port);
  if (cur && cur !== owner && cur.name !== owner.name) {
    if (!takeover) throw new PortBusyError(cur.name);
    try {
      if (cur.release) await withTimeout(cur.release(), releaseTimeoutMs, cur.name + ' disconnect');
    } catch (e) { /* forcing it below */ }
    owners.delete(port);
    // A release that couldn't close the port leaves it open: say so plainly.
    if (port.readable || port.writable) {
      try { await withTimeout(port.close(), 1500, 'close'); } catch (e) { /* ignore */ }
    }
  } else if (!cur && (port.readable || port.writable)) {
    // Opened by code that doesn't use the manager (or a session we lost track of).
    throw new PortBusyError('another tool');
  }
  owners.set(port, owner);
  return port;
}

/** Give up ownership (call from the tool's disconnect). Only the owner can release. */
export function releasePort(port, owner) {
  const cur = owners.get(port);
  if (cur && (cur === owner || (owner && cur.name === owner.name))) owners.delete(port);
}

const defaultConfirm = (msg) => (typeof window !== 'undefined' && window.confirm ? window.confirm(msg) : false);

/**
 * Show the browser's port picker and claim the chosen port for `owner`.
 * If another tool has it, ask (via `confirm`) whether to take it over.
 */
export async function requestPortFor(owner, requestOptions, { serial, confirm = defaultConfirm } = {}) {
  const ser = serial || (typeof navigator !== 'undefined' ? navigator.serial : undefined);
  if (!ser) throw new Error('Web Serial needs Chrome or Edge on desktop.');
  listenForUnplug(ser);
  const port = requestOptions ? await ser.requestPort(requestOptions) : await ser.requestPort();
  await claimForTool(port, owner, { confirm });
  return port;
}

/** claimPort with the "take it over?" prompt. */
export async function claimForTool(port, owner, { confirm = defaultConfirm } = {}) {
  try {
    return await claimPort(port, owner);
  } catch (e) {
    if (!(e instanceof PortBusyError) || e.ownerName === 'another tool') throw e;
    if (!confirm(`${e.ownerName} is using this device.\n\nDisconnect it there and connect here instead?`)) throw e;
    return claimPort(port, owner, { takeover: true });
  }
}

/**
 * Stop a read loop cleanly: cancel the reader, wait for the loop to finish,
 * then make sure the lock is released. Safe to call with nulls.
 * @param {any} reader
 * @param {Promise<any> | null} [loopPromise]
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function stopReader(reader, loopPromise, { timeoutMs = 1000 } = {}) {
  if (reader) { try { await withTimeout(reader.cancel(), timeoutMs, 'reader cancel'); } catch (e) { /* ignore */ } }
  if (loopPromise) { try { await withTimeout(loopPromise, timeoutMs, 'read loop'); } catch (e) { /* ignore */ } }
  if (reader) { try { reader.releaseLock(); } catch (e) { /* already released */ } }
}

/**
 * Close a port in the order the Streams API needs. Pass whatever the tool
 * holds: its reader, the read-loop promise, its writer, and for piped
 * streams (TextDecoderStream etc.) the pipeTo() promise.
 * @param {any} port
 * @param {{ reader?: any, readLoop?: Promise<any> | null, writer?: any, pipes?: Array<Promise<any> | null>, timeoutMs?: number }} [opts]
 */
export async function closeSerialPort(port, { reader, readLoop, writer, pipes = [], timeoutMs = 1500 } = {}) {
  await stopReader(reader, readLoop);
  for (const p of pipes) { if (p) { try { await withTimeout(p.catch(() => {}), timeoutMs, 'pipe'); } catch (e) { /* ignore */ } } }
  if (writer) {
    try { writer.releaseLock(); } catch (e) { /* ignore */ }
  }
  if (port) {
    try { await withTimeout(port.close(), timeoutMs, 'port close'); }
    catch (e) {
      // A lock we didn't know about: give the stream a moment, then try once more.
      await sleep(100);
      try { await withTimeout(port.close(), timeoutMs, 'port close'); } catch (e2) { /* give up */ }
    }
  }
}

// Test hook
export function _resetPortManager() { owners.clear(); listening = false; }
