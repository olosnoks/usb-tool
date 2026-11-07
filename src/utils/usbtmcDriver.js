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
 * References: USBTMC 1.0 and USBTMC-USB488 1.0 (USB-IF).
 */


export const USBTMC_CLASS = { classCode: 0xfe, subclassCode: 0x03 }; // Application / Test & Measurement
export const MSGID = { DEV_DEP_MSG_OUT: 1, REQUEST_DEV_DEP_MSG_IN: 2, DEV_DEP_MSG_IN: 2 };

const td = new TextDecoder();
const te = new TextEncoder();
const align4 = (n) => (n + 3) & ~3;

export class UsbTmcError extends Error {}

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

export class UsbTmcDevice {
  constructor(transport, { logger = () => {}, maxTransfer = 1024 * 1024 } = {}) {
    this.transport = transport;
    this.logger = logger;
    this.maxTransfer = maxTransfer;
    this.bTag = 0;
    this.chain = Promise.resolve();
  }

  _nextTag() { this.bTag = (this.bTag % 255) + 1; return this.bTag; } // 1..255, never 0

  _serialize(fn) { const r = this.chain.then(fn, fn); this.chain = r.then(() => {}, () => {}); return r; }

  async open() { if (this.transport.open) await this.transport.open(); }

  /** Send a SCPI command string (no response expected). */
  write(command) {
    return this._serialize(async () => {
      const data = te.encode(command.endsWith('\n') ? command : command + '\n');
      await this.transport.write(buildMsgOut(this._nextTag(), data, true));
    });
  }

  /** Read one response message, reassembling across EOM-less fragments. */
  read() {
    return this._serialize(async () => {
      const chunks = [];
      for (;;) {
        const tag = this._nextTag();
        await this.transport.write(buildRequestIn(tag, Math.min(this.maxTransfer, 0x100000)));
        const raw = await this.transport.read(12 + Math.min(this.maxTransfer, 0x100000));
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
  async query(command) {
    await this.write(command);
    return td.decode(await this.read()).replace(/[\r\n]+$/, '');
  }

  /** Query returning raw bytes (for binary blocks like waveform data). */
  async queryBinary(command) {
    await this.write(command);
    return this.read();
  }

  identify() { return this.query('*IDN?'); }

  async close() { if (this.transport.close) await this.transport.close(); }
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
        if (out && inn) return { interfaceNumber: iface.interfaceNumber, epOut: out.endpointNumber, epIn: inn.endpointNumber };
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
    this.epOut = found.epOut; this.epIn = found.epIn;
    await d.claimInterface(this.interfaceNumber);
  }
  async write(bytes) {
    const r = await this.device.transferOut(this.epOut, bytes);
    if (r.status !== 'ok') throw new UsbTmcError(`USB OUT ${r.status}`);
  }
  async read(maxLength) {
    const r = await this.device.transferIn(this.epIn, maxLength);
    if (r.status !== 'ok' && !r.data) throw new UsbTmcError(`USB IN ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
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

