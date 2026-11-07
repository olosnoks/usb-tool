/**
 * massStorageDriver.js — read-only USB Mass Storage (Bulk-Only Transport) +
 * SCSI, for inspecting a drive: INQUIRY (what it is), READ CAPACITY (how big),
 * and READ(10) (raw sectors). It deliberately implements no WRITE command, so
 * it cannot modify the drive.
 *
 * I/O goes through an injected transport so the CBW/CSW framing is testable
 * against a fake drive with no hardware (see tests/massStorage.test.js):
 *
 *     transport.write(Uint8Array) -> Promise<void>   (bulk OUT)
 *     transport.read(maxLength)   -> Promise<Uint8Array> (bulk IN)
 *     transport.close()           -> Promise<void>
 *
 * NOTE: a drive claimed here is taken away from the operating system for the
 * session. Prefer a drive the OS has not mounted, and never a disk with data
 * you care about mounted and in use.
 *
 * References: USB Mass Storage Bulk-Only Transport 1.0; SCSI SPC/SBC.
 */

import { buildFatVolume, buildMbrDisk } from './diskImage';

export const MSC_CLASS = { classCode: 0x08, subclassCode: 0x06, protocolCode: 0x50 }; // SCSI transparent, BOT
const CBW_SIGNATURE = 0x43425355; // 'USBC'
const CSW_SIGNATURE = 0x53425355; // 'USBS'

export class MassStorageError extends Error {}

const SENSE_KEYS = {
  0x0: 'no sense', 0x1: 'recovered error', 0x2: 'not ready', 0x3: 'medium error', 0x4: 'hardware error',
  0x5: 'illegal request', 0x6: 'unit attention', 0x7: 'data protect', 0xb: 'aborted command'
};
const ASC_TEXT = {
  0x3a00: 'medium not present', 0x0401: 'becoming ready', 0x1100: 'unrecovered read error', 0x2100: 'LBA out of range',
  0x2000: 'invalid command', 0x2400: 'invalid field in CDB', 0x2800: 'medium may have changed', 0x2900: 'power on or reset'
};

/** Fixed-format sense data -> { key, asc, ascq, text }. */
export function parseSense(b) {
  const key = b[2] & 0x0f;
  const asc = b[12];
  const ascq = b[13];
  const detail = ASC_TEXT[(asc << 8) | ascq] || ASC_TEXT[asc << 8] || `ASC ${asc.toString(16).padStart(2, '0')}/${ascq.toString(16).padStart(2, '0')}`;
  return { key, asc, ascq, text: `${SENSE_KEYS[key] || `sense key ${key}`}: ${detail}` };
}

const PERIPHERAL_TYPES = {
  0x00: 'Direct-access block device (disk)', 0x05: 'CD/DVD', 0x07: 'Optical memory',
  0x0e: 'Simplified direct-access (RBC)'
};
const ascii = (bytes) => new TextDecoder().decode(bytes).replace(/\u0000+$/, '').trim();

/** Build a 31-byte Command Block Wrapper. */
export function buildCbw(tag, dataLength, dirIn, lun, cdb) {
  const b = new Uint8Array(31);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, CBW_SIGNATURE, true);
  dv.setUint32(4, tag >>> 0, true);
  dv.setUint32(8, dataLength, true);
  b[12] = dirIn ? 0x80 : 0x00;
  b[13] = lun & 0x0f;
  b[14] = cdb.length & 0x1f;
  b.set(cdb.slice(0, 16), 15);
  return b;
}

/** Parse a 13-byte Command Status Wrapper. */
export function parseCsw(bytes) {
  if (bytes.length < 13) throw new MassStorageError(`Short CSW (${bytes.length} bytes).`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== CSW_SIGNATURE) throw new MassStorageError('Bad CSW signature.');
  return { tag: dv.getUint32(4, true), residue: dv.getUint32(8, true), status: bytes[12] };
}

export function parseInquiry(b) {
  return {
    peripheralType: b[0] & 0x1f,
    peripheralName: PERIPHERAL_TYPES[b[0] & 0x1f] || `type 0x${(b[0] & 0x1f).toString(16)}`,
    removable: !!(b[1] & 0x80),
    vendor: ascii(b.slice(8, 16)),
    product: ascii(b.slice(16, 32)),
    revision: ascii(b.slice(32, 36))
  };
}

export function parseCapacity(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const lastLba = dv.getUint32(0, false); // big-endian
  const blockSize = dv.getUint32(4, false);
  const blocks = lastLba + 1;
  return { lastLba, blockSize, blocks, totalBytes: blocks * blockSize };
}

export class MassStorageDevice {
  constructor(transport, { logger = () => {} } = {}) {
    this.transport = transport;
    this.logger = logger;
    this.tag = 0;
    this.chain = Promise.resolve();
    this.blockSize = 512;
  }

  _serialize(fn) { const r = this.chain.then(fn, fn); this.chain = r.then(() => {}, () => {}); return r; }

  async open() { if (this.transport.open) await this.transport.open(); }

  /** Run one SCSI command: send CBW, move `dataLength` bytes IN, read the CSW. */
  _command(cdb, dataLength, dirIn = true) {
    return this._serialize(async () => {
      const tag = (this.tag = (this.tag + 1) >>> 0);
      await this.transport.write(buildCbw(tag, dataLength, dirIn, 0, cdb));
      let data = new Uint8Array();
      if (dataLength > 0 && dirIn) {
        const parts = [];
        let got = 0;
        while (got < dataLength) {
          const chunk = await this.transport.read(dataLength - got);
          if (!chunk.length) break;
          parts.push(chunk); got += chunk.length;
        }
        data = new Uint8Array(got);
        let off = 0; parts.forEach((p) => { data.set(p.subarray(0, Math.min(p.length, got - off)), off); off += p.length; });
      }
      const csw = parseCsw(await this.transport.read(13));
      if (csw.tag !== tag) throw new MassStorageError(`CSW tag ${csw.tag} != CBW tag ${tag}.`);
      if (csw.status === 1) {
        const err = new MassStorageError('SCSI command failed (CSW status 01).');
        err.checkCondition = true;
        throw err;
      }
      if (csw.status === 2) throw new MassStorageError('Phase error (CSW status 02).');
      return data;
    });
  }

  async testUnitReady() {
    try { await this._command([0x00, 0, 0, 0, 0, 0], 0, false); return true; }
    catch (e) { return false; }
  }

  async requestSense() {
    return parseSense(await this._command([0x03, 0, 0, 0, 18, 0], 18, true));
  }

  /** Re-throw a failed command with the drive's own explanation (REQUEST SENSE). */
  async _explain(fn) {
    try {
      return await fn();
    } catch (e) {
      if (!e.checkCondition) throw e;
      let sense;
      try { sense = await this.requestSense(); } catch (x) { throw e; }
      const err = new MassStorageError(`The drive refused the command: ${sense.text}.`);
      err.sense = sense;
      throw err;
    }
  }

  async inquiry() {
    const data = await this._command([0x12, 0, 0, 0, 36, 0], 36, true);
    return parseInquiry(data);
  }

  async readCapacity() {
    const data = await this._explain(() => this._command([0x25, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8, true));
    const cap = parseCapacity(data);
    this.blockSize = cap.blockSize || 512;
    return cap;
  }

  /** Read `count` blocks starting at LBA `lba`. READ(10). */
  async read(lba, count = 1) {
    const bs = this.blockSize || 512;
    const cdb = [0x28, 0,
      (lba >>> 24) & 0xff, (lba >>> 16) & 0xff, (lba >>> 8) & 0xff, lba & 0xff,
      0, (count >>> 8) & 0xff, count & 0xff, 0];
    return this._explain(() => this._command(cdb, count * bs, true));
  }

  async close() { if (this.transport.close) await this.transport.close(); }
}

// ---------------------------------------------------------------------------
// WebUSB transport
// ---------------------------------------------------------------------------

export function findMscInterface(configuration) {
  for (const iface of configuration?.interfaces || []) {
    for (const alt of iface.alternates || []) {
      if (alt.interfaceClass === 0x08 && alt.interfaceProtocol === 0x50) {
        const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
        const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
        if (out && inn) return { interfaceNumber: iface.interfaceNumber, epOut: out.endpointNumber, epIn: inn.endpointNumber };
      }
    }
  }
  return null;
}

export class MscUsbTransport {
  constructor(device) { this.device = device; }
  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = findMscInterface(d.configuration);
    if (!found) throw new MassStorageError('No Bulk-Only Mass Storage interface (class 08 / protocol 50).');
    this.interfaceNumber = found.interfaceNumber;
    this.epOut = found.epOut; this.epIn = found.epIn;
    await d.claimInterface(this.interfaceNumber);
  }
  async write(bytes) {
    const r = await this.device.transferOut(this.epOut, bytes);
    if (r.status !== 'ok') throw new MassStorageError(`USB OUT ${r.status}`);
  }
  async read(maxLength) {
    const r = await this.device.transferIn(this.epIn, maxLength);
    if (r.status !== 'ok' && !r.data) throw new MassStorageError(`USB IN ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }
  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

// WebUSB rejects a filter that has protocolCode without subclassCode. Match the
// standard Bulk-Only / SCSI-transparent triple, then fall back to any class 0x08
// device so drives that report an unusual subclass still appear in the chooser.
export const MSC_USB_FILTERS = [MSC_CLASS, { classCode: MSC_CLASS.classCode }];

export async function requestMassStorageDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new MassStorageError('WebUSB needs Chrome or Edge over HTTPS.');
  const device = await navigator.usb.requestDevice({ filters: MSC_USB_FILTERS });
  return new MscUsbTransport(device);
}
