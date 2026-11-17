/**
 * usbtmcDriver.js — USBTMC (USB Test & Measurement Class) over WebUSB, the
 * standard way oscilloscopes, DMMs, power supplies and signal generators take
 * SCPI commands over USB.
 *
 * I/O goes through an injected transport so the bulk framing is testable
 * against a fake instrument (see tests/usbtmc.test.js):
 *
 *     transport.write(Uint8Array) -> Promise<void>   (bulk OUT)
 *     transport.read(maxLength)   -> Promise<Uint8Array> (bulk IN)
 *     transport.close()           -> Promise<void>
 *
 * Optional, for timeouts / abort / clear / USB488 (transports without them
 * simply skip recovery and those features throw a clear error):
 *
 *     transport.controlTransfer({ recipient, request, value, index }, length)
 *         -> Promise<Uint8Array>   class-specific control IN
 *     transport.clearHalt('in' | 'out') -> Promise<void>
 *     transport.cancel(kind)           -> void   (best-effort cancel hook)
 *     transport.interfaceNumber, transport.epIn, transport.epOut, transport.epInt
 *
 * References: USBTMC 1.0 and USBTMC-USB488 1.0 (USB-IF).
 */


export const USBTMC_CLASS = { classCode: 0xfe, subclassCode: 0x03 }; // Application / Test & Measurement
export const MSGID = { DEV_DEP_MSG_OUT: 1, REQUEST_DEV_DEP_MSG_IN: 2, DEV_DEP_MSG_IN: 2 };

/** Class-specific control request codes (USBTMC 1.0 table 15, USB488 table 9). */
export const TMC_REQUEST = {
  INITIATE_ABORT_BULK_OUT: 1,
  CHECK_ABORT_BULK_OUT_STATUS: 2,
  INITIATE_ABORT_BULK_IN: 3,
  CHECK_ABORT_BULK_IN_STATUS: 4,
  INITIATE_CLEAR: 5,
  CHECK_CLEAR_STATUS: 6,
  GET_CAPABILITIES: 7,
  INDICATOR_PULSE: 64,
  // USB488
  READ_STATUS_BYTE: 128,
  REN_CONTROL: 160,
  GO_TO_LOCAL: 161,
  LOCAL_LOCKOUT: 162
};

/** USBTMC_status values. */
export const TMC_STATUS = {
  SUCCESS: 0x01,
  PENDING: 0x02,
  FAILED: 0x80,
  TRANSFER_NOT_IN_PROGRESS: 0x81,
  SPLIT_NOT_IN_PROGRESS: 0x82,
  SPLIT_IN_PROGRESS: 0x83
};

export const DEFAULT_TIMEOUT_MS = 5000;

const td = new TextDecoder();
const te = new TextEncoder();
const align4 = (n) => (n + 3) & ~3;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export class UsbTmcError extends Error {
  constructor(message, { timeout = false } = {}) {
    super(message);
    this.name = 'UsbTmcError';
    this.timeout = timeout;
  }
}

/** Build a DEV_DEP_MSG_OUT bulk-OUT packet carrying `data`. */
export function buildMsgOut(bTag, data, eom = true) {
  const payload = align4(data.length);
  const buf = new Uint8Array(12 + payload);
  const dv = new DataView(buf.buffer);
  buf[0] = MSGID.DEV_DEP_MSG_OUT;
  buf[1] = bTag;
  buf[2] = (~bTag) & 0xff;
  buf[3] = 0;
  dv.setUint32(4, data.length, true);  // TransferSize
  buf[8] = eom ? 0x01 : 0x00;          // bmTransferAttributes: EOM
  buf.set(data, 12);
  return buf;
}

/** Build a REQUEST_DEV_DEP_MSG_IN bulk-OUT packet asking for up to `maxLen`. */
export function buildRequestIn(bTag, maxLen, termChar = null) {
  const buf = new Uint8Array(12);
  const dv = new DataView(buf.buffer);
  buf[0] = MSGID.REQUEST_DEV_DEP_MSG_IN;
  buf[1] = bTag;
  buf[2] = (~bTag) & 0xff;
  buf[3] = 0;
  dv.setUint32(4, maxLen, true);       // TransferSize (max we will accept)
  buf[8] = termChar != null ? 0x02 : 0x00; // bmTransferAttributes: TermChar used
  buf[9] = termChar != null ? termChar : 0;
  return buf;
}

/** Parse a DEV_DEP_MSG_IN bulk-IN packet: { bTag, eom, data }. */
export function parseMsgIn(bytes) {
  if (bytes.length < 12) throw new UsbTmcError(`Short USBTMC IN packet (${bytes.length} bytes).`);
  if (bytes[0] !== MSGID.DEV_DEP_MSG_IN) throw new UsbTmcError(`Unexpected USBTMC MsgID 0x${bytes[0].toString(16)}.`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = dv.getUint32(4, true);
  const eom = (bytes[8] & 0x01) === 0x01;
  const data = bytes.slice(12, 12 + size);
  return { bTag: bytes[1], eom, size, data };
}

/** Decode a 24-byte GET_CAPABILITIES response (USBTMC + USB488 fields). */
export function parseCapabilities(b) {
  if (!b || b.length < 24) throw new UsbTmcError(`Short GET_CAPABILITIES response (${b ? b.length : 0} bytes).`);
  if (b[0] !== TMC_STATUS.SUCCESS) throw new UsbTmcError(`GET_CAPABILITIES failed (status 0x${b[0].toString(16)}).`);
  const bcd = (lo, hi) => `${hi.toString(16)}.${lo.toString(16).padStart(2, '0')}`;
  return {
    bcdUSBTMC: bcd(b[2], b[3]),
    listenOnly: (b[4] & 0x01) !== 0,
    talkOnly: (b[4] & 0x02) !== 0,
    indicatorPulse: (b[4] & 0x04) !== 0,
    termChar: (b[5] & 0x01) !== 0,
    bcdUSB488: bcd(b[12], b[13]),
    usb488: {
      trigger: (b[14] & 0x01) !== 0,
      remoteLocal: (b[14] & 0x02) !== 0, // REN_CONTROL / GO_TO_LOCAL / LOCAL_LOCKOUT
      is488_2: (b[14] & 0x04) !== 0,
      dt1: (b[15] & 0x01) !== 0,
      rl1: (b[15] & 0x02) !== 0,
      sr1: (b[15] & 0x04) !== 0,
      scpi: (b[15] & 0x08) !== 0
    }
  };
}

export class UsbTmcDevice {
  /**
   * @param {object} transport
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs=5000]   default per-operation timeout
   * @param {number} [opts.recoverTimeoutMs=3000] cap on one abort/clear recovery
   * @param {number} [opts.abortDrainMs=300] wait for a stuck bulk-IN to end after INITIATE_ABORT_BULK_IN
   */
  constructor(transport, { logger = () => {}, maxTransfer = 1024 * 1024, timeoutMs = DEFAULT_TIMEOUT_MS, recoverTimeoutMs = 3000, abortDrainMs = 300 } = {}) {
    this.transport = transport;
    this.logger = logger;
    this.maxTransfer = maxTransfer;
    this.timeoutMs = timeoutMs;
    this.recoverTimeoutMs = recoverTimeoutMs;
    this.abortDrainMs = abortDrainMs;
    this.bTag = 0;
    this.lastOutTag = 0;
    this.lastInTag = 0;
    this._sbTag = 2;
    this.chain = Promise.resolve();
    this._pendingRead = null;
    this.capabilities = null;
  }

  _nextTag() { this.bTag = (this.bTag % 255) + 1; return this.bTag; } // 1..255, never 0

  _serialize(fn) { const r = this.chain.then(fn, fn); this.chain = r.then(() => {}, () => {}); return r; }

  /**
   * Run one bus operation inside the serialized chain with a timeout. On
   * timeout the transport cancel hook fires, the matching abort/clear
   * procedure runs (itself bounded), and the call rejects with a timeout
   * UsbTmcError, so the chain always settles and the next command can run.
   */
  _op(kind, timeoutMs, fn) {
    const ms = timeoutMs ?? this.timeoutMs;
    return this._serialize(async () => {
      let timer;
      let timedOut = false;
      const work = Promise.resolve().then(fn);
      const clock = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new UsbTmcError(`USBTMC ${kind} timed out after ${ms} ms.`, { timeout: true }));
        }, ms);
      });
      try {
        return await Promise.race([work, clock]);
      } catch (err) {
        if (timedOut && (kind === 'read' || kind === 'write')) {
          work.catch(() => {});
          try { this.transport.cancel?.(kind); } catch (e) { /* best effort */ }
          await this._recoverBounded(kind);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }
    });
  }

  async _recoverBounded(kind) {
    if (!this.transport.controlTransfer) return;
    let timer;
    const cap = new Promise((resolve) => { timer = setTimeout(() => resolve('cap'), this.recoverTimeoutMs); });
    try {
      const r = await Promise.race([this._recover(kind).then(() => 'done'), cap]);
      if (r === 'cap') this.logger(`USBTMC recovery after ${kind} timeout exceeded ${this.recoverTimeoutMs} ms.`);
    } catch (e) {
      this.logger(`USBTMC recovery after ${kind} timeout failed: ${e.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Abort the stuck transfer ('in' or 'out'); fall back to INITIATE_CLEAR if the abort is refused. */
  async _recover(kind) {
    let ok;
    try {
      ok = kind === 'read' ? await this._abortBulkIn() : await this._abortBulkOut();
    } catch (e) {
      ok = false;
    }
    if (!ok) await this._clear();
  }

  // -- control-request plumbing ---------------------------------------------

  _need(fn) {
    if (typeof this.transport[fn] !== 'function') {
      throw new UsbTmcError(`This transport does not support USBTMC control requests (${fn}).`);
    }
  }

  _ctl(recipient, request, value, index, length) {
    this._need('controlTransfer');
    return this.transport.controlTransfer({ recipient, request, value, index }, length);
  }

  get _inAddr() { return 0x80 | (this.transport.epIn ?? 0); }
  get _outAddr() { return this.transport.epOut ?? 0; }
  get _iface() { return this.transport.interfaceNumber ?? 0; }

  /** INITIATE_ABORT_BULK_IN then drain and CHECK_ABORT_BULK_IN_STATUS. Returns true when handled. */
  async _abortBulkIn() {
    const tag = this.lastInTag;
    const init = await this._ctl('endpoint', TMC_REQUEST.INITIATE_ABORT_BULK_IN, tag, this._inAddr, 2);
    if (init[0] === TMC_STATUS.TRANSFER_NOT_IN_PROGRESS) return true; // nothing to abort
    if (init[0] !== TMC_STATUS.SUCCESS) return false;
    // The device ends the stuck bulk-IN; give that transfer a moment to complete.
    const stuck = this._pendingRead;
    if (stuck) await Promise.race([stuck.catch(() => {}), delay(this.abortDrainMs)]);
    for (let i = 0; i < 50; i++) {
      const chk = await this._ctl('endpoint', TMC_REQUEST.CHECK_ABORT_BULK_IN_STATUS, 0, this._inAddr, 8);
      if (chk[0] === TMC_STATUS.PENDING) { await delay(10); continue; }
      return chk[0] === TMC_STATUS.SUCCESS;
    }
    return false;
  }

  /** INITIATE_ABORT_BULK_OUT, CHECK_ABORT_BULK_OUT_STATUS, then clear the OUT halt. */
  async _abortBulkOut() {
    const tag = this.lastOutTag;
    const init = await this._ctl('endpoint', TMC_REQUEST.INITIATE_ABORT_BULK_OUT, tag, this._outAddr, 2);
    if (init[0] === TMC_STATUS.TRANSFER_NOT_IN_PROGRESS) return true;
    if (init[0] !== TMC_STATUS.SUCCESS) return false;
    for (let i = 0; i < 50; i++) {
      const chk = await this._ctl('endpoint', TMC_REQUEST.CHECK_ABORT_BULK_OUT_STATUS, 0, this._outAddr, 8);
      if (chk[0] === TMC_STATUS.PENDING) { await delay(10); continue; }
      if (chk[0] !== TMC_STATUS.SUCCESS) return false;
      await this.transport.clearHalt?.('out');
      return true;
    }
    return false;
  }

  /** INITIATE_CLEAR, CHECK_CLEAR_STATUS until done, then clear both halts. Returns true when the device confirmed. */
  async _clear() {
    const init = await this._ctl('interface', TMC_REQUEST.INITIATE_CLEAR, 0, this._iface, 1);
    if (init[0] !== TMC_STATUS.SUCCESS) return false;
    for (let i = 0; i < 100; i++) {
      const chk = await this._ctl('interface', TMC_REQUEST.CHECK_CLEAR_STATUS, 0, this._iface, 2);
      if (chk[0] === TMC_STATUS.PENDING) {
        // bmClear bit 0: device still has data; drain bulk-IN (bounded) until it finishes.
        if ((chk[1] & 0x01) && this.transport.read) {
          await Promise.race([this.transport.read(64).catch(() => {}), delay(100)]);
        } else {
          await delay(10);
        }
        continue;
      }
      await this.transport.clearHalt?.('out');
      await this.transport.clearHalt?.('in');
      return chk[0] === TMC_STATUS.SUCCESS;
    }
    return false;
  }

  /** Public: abort the current bulk-IN transfer (host-initiated, e.g. a UI Abort button). */
  abortBulkIn() { return this._serialize(() => this._abortBulkIn()); }
  /** Public: abort the current bulk-OUT transfer. */
  abortBulkOut() { return this._serialize(() => this._abortBulkOut()); }
  /** Public: INITIATE_CLEAR / CHECK_CLEAR_STATUS plus clearHalt on both bulk endpoints. */
  clear() { return this._serialize(() => this._clear()); }
  /**
   * Public: full recovery for a wedged instrument: abort bulk-IN and bulk-OUT
   * (best effort) then clear. Jumps the queue, because a stuck op holds the chain
   * only until its own timeout; this is what an "Abort / Clear" button calls.
   */
  async abortAndClear() {
    this._need('controlTransfer');
    const run = async () => {
      try { await this._abortBulkIn(); } catch (e) { /* continue */ }
      try { await this._abortBulkOut(); } catch (e) { /* continue */ }
      return this._clear();
    };
    // Don't wait behind a stuck operation: cancel hook first, then run unserialized.
    try { this.transport.cancel?.('abort'); } catch (e) { /* best effort */ }
    return run();
  }

  // -- USBTMC / USB488 requests ---------------------------------------------

  /** GET_CAPABILITIES (USBTMC + USB488 fields). */
  getCapabilities() {
    return this._op('control', undefined, async () => {
      const b = await this._ctl('interface', TMC_REQUEST.GET_CAPABILITIES, 0, this._iface, 24);
      this.capabilities = parseCapabilities(b);
      return this.capabilities;
    });
  }

  /** INDICATOR_PULSE: blink the instrument's activity indicator (if supported). */
  indicatorPulse() {
    return this._op('control', undefined, async () => {
      const b = await this._ctl('interface', TMC_REQUEST.INDICATOR_PULSE, 0, this._iface, 1);
      if (b[0] !== TMC_STATUS.SUCCESS) throw new UsbTmcError(`INDICATOR_PULSE failed (status 0x${b[0].toString(16)}).`);
      return true;
    });
  }

  /** USB488 READ_STATUS_BYTE; returns the IEEE 488.1 status byte (STB). */
  readStatusByte() {
    return this._op('control', undefined, async () => {
      const tag = this._sbTag; // 2..127
      this._sbTag = this._sbTag >= 127 ? 2 : this._sbTag + 1;
      const b = await this._ctl('interface', TMC_REQUEST.READ_STATUS_BYTE, tag, this._iface, 3);
      if (b[0] !== TMC_STATUS.SUCCESS) throw new UsbTmcError(`READ_STATUS_BYTE failed (status 0x${b[0].toString(16)}).`);
      if (this.transport.epInt != null && this.transport.readInterrupt) {
        const n = await this.transport.readInterrupt(2); // [0x80|tag, STB]
        return n[1];
      }
      return b[2];
    });
  }

  async _ren(request, value) {
    this._need('controlTransfer');
    const b = await this._ctl('interface', request, value, this._iface, 1);
    if (b[0] !== TMC_STATUS.SUCCESS) throw new UsbTmcError(`USB488 request ${request} failed (status 0x${b[0].toString(16)}).`);
    return true;
  }

  /** USB488 REN_CONTROL: true = remote enable, false = release. */
  remoteEnable(enable = true) { return this._op('control', undefined, () => this._ren(TMC_REQUEST.REN_CONTROL, enable ? 1 : 0)); }
  /** USB488 GO_TO_LOCAL: unlock the front panel. */
  goToLocal() { return this._op('control', undefined, () => this._ren(TMC_REQUEST.GO_TO_LOCAL, 0)); }
  /** USB488 LOCAL_LOCKOUT. */
  localLockout() { return this._op('control', undefined, () => this._ren(TMC_REQUEST.LOCAL_LOCKOUT, 0)); }

  async open() { if (this.transport.open) await this.transport.open(); }

  /** Send a SCPI command string (no response expected). */
  write(command, { timeoutMs } = {}) {
    return this._op('write', timeoutMs, async () => {
      const data = te.encode(command.endsWith('\n') ? command : command + '\n');
      const tag = this._nextTag();
      this.lastOutTag = tag;
      await this.transport.write(buildMsgOut(tag, data, true));
    });
  }

  /** Read one response message, reassembling across EOM-less fragments. */
  read({ timeoutMs } = {}) {
    return this._op('read', timeoutMs, async () => {
      const chunks = [];
      for (;;) {
        const tag = this._nextTag();
        this.lastInTag = tag;
        await this.transport.write(buildRequestIn(tag, Math.min(this.maxTransfer, 0x100000)));
        const pending = this.transport.read(12 + Math.min(this.maxTransfer, 0x100000));
        this._pendingRead = pending;
        const raw = await pending;
        this._pendingRead = null;
        const msg = parseMsgIn(raw);
        chunks.push(msg.data);
        if (msg.eom) break;
      }
      let total = 0; chunks.forEach((c) => (total += c.length));
      const all = new Uint8Array(total);
      let off = 0; chunks.forEach((c) => { all.set(c, off); off += c.length; });
      return all;
    });
  }

  /** Send a query and return its text response (e.g. "*IDN?"). */
  async query(command, opts) {
    await this.write(command, opts);
    return td.decode(await this.read(opts)).replace(/[\r\n]+$/, '');
  }

  /** Query returning raw bytes (for binary blocks like waveform data). */
  async queryBinary(command, opts) {
    await this.write(command, opts);
    return this.read(opts);
  }

  identify() { return this.query('*IDN?'); }

  /**
   * Close the session. When the transport supports USB488 and `unlock` is set
   * (default), the front panel is returned to local first (best effort).
   */
  async close({ unlock = true } = {}) {
    if (unlock && this.transport.controlTransfer) {
      try { await Promise.race([this.goToLocal(), delay(1500)]); } catch (e) { /* instrument may not support USB488 */ }
    }
    if (this.transport.close) await this.transport.close();
  }
}

// ---------------------------------------------------------------------------
// WebUSB transport
// ---------------------------------------------------------------------------

export function findUsbtmcInterface(configuration) {
  for (const iface of configuration?.interfaces || []) {
    for (const alt of iface.alternates || []) {
      if (alt.interfaceClass === 0xfe && alt.interfaceSubclass === 0x03) {
        const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
        const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
        const intr = alt.endpoints.find((e) => e.type === 'interrupt' && e.direction === 'in');
        if (out && inn) {
          return {
            interfaceNumber: iface.interfaceNumber,
            epOut: out.endpointNumber,
            epIn: inn.endpointNumber,
            epInt: intr ? intr.endpointNumber : null
          };
        }
      }
    }
  }
  return null;
}

export class UsbTmcUsbTransport {
  constructor(device) { this.device = device; }
  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = findUsbtmcInterface(d.configuration);
    if (!found) throw new UsbTmcError('No USBTMC interface (class FE / subclass 03) on this device.');
    this.interfaceNumber = found.interfaceNumber;
    this.epOut = found.epOut; this.epIn = found.epIn; this.epInt = found.epInt;
    await d.claimInterface(this.interfaceNumber);
  }
  async write(bytes) {
    const r = await this.device.transferOut(this.epOut, bytes);
    if (r.status !== 'ok') {
      if (r.status === 'stall') await this.clearHalt('out');
      throw new UsbTmcError(`USB OUT ${r.status}`);
    }
  }
  async read(maxLength) {
    const r = await this.device.transferIn(this.epIn, maxLength);
    if (r.status !== 'ok' && !r.data) {
      if (r.status === 'stall') await this.clearHalt('in');
      throw new UsbTmcError(`USB IN ${r.status}`);
    }
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  async readInterrupt(maxLength) {
    const r = await this.device.transferIn(this.epInt, maxLength);
    if (!r.data) throw new UsbTmcError(`USB interrupt IN ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  /** Class-specific control IN (requestType 'class'). */
  async controlTransfer({ recipient, request, value, index }, length) {
    const r = await this.device.controlTransferIn({ requestType: 'class', recipient, request, value, index }, length);
    if (r.status !== 'ok' && !r.data) throw new UsbTmcError(`USBTMC control request ${request} ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  async clearHalt(direction) {
    try { await this.device.clearHalt(direction, direction === 'in' ? this.epIn : this.epOut); } catch (e) { /* ignore */ }
  }
  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

export const USBTMC_USB_FILTERS = [{ classCode: 0xfe, subclassCode: 0x03 }];

export async function requestUsbTmcDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new UsbTmcError('WebUSB needs Chrome or Edge over HTTPS.');
  const device = await navigator.usb.requestDevice({ filters: USBTMC_USB_FILTERS });
  return new UsbTmcUsbTransport(device);
}
