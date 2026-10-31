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

export const MSC_CLASS = { classCode: 0x08, subclassCode: 0x06, protocolCode: 0x50 }; // SCSI transparent, BOT
const CBW_SIGNATURE = 0x43425355; // 'USBC'
const CSW_SIGNATURE = 0x53425355; // 'USBS'

export class MassStorageError extends Error {}

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
      if (csw.status === 1) throw new MassStorageError('SCSI command failed (CSW status 01). Try TEST UNIT READY / REQUEST SENSE.');
      if (csw.status === 2) throw new MassStorageError('Phase error (CSW status 02).');
      return data;
    });
  }

  async testUnitReady() {
    try { await this._command([0x00, 0, 0, 0, 0, 0], 0, false); return true; }
    catch (e) { return false; }
  }

  async inquiry() {
    const data = await this._command([0x12, 0, 0, 0, 36, 0], 36, true);
    return parseInquiry(data);
  }

  async readCapacity() {
    const data = await this._command([0x25, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8, true);
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
    return this._command(cdb, count * bs, true);
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

export const MSC_USB_FILTERS = [{ classCode: 0x08, protocolCode: 0x50 }];

export async function requestMassStorageDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new MassStorageError('WebUSB needs Chrome or Edge over HTTPS.');
  const device = await navigator.usb.requestDevice({ filters: MSC_USB_FILTERS });
  return new MscUsbTransport(device);
}

/**
 * A simulated 8 MiB thumbdrive for the workbench demo (opt-in, labeled). Holds
 * a tiny FAT-ish signature so sector 0 looks plausible.
 */
export function createSimulatedMassStorage() {
  const blockSize = 512;
  const blocks = 16384; // 8 MiB
  const sector0 = new Uint8Array(blockSize);
  sector0[0] = 0xeb; sector0[1] = 0x3c; sector0[2] = 0x90; // JMP
  new TextEncoder().encodeInto('MSDOS5.0', sector0.subarray(3));
  sector0[510] = 0x55; sector0[511] = 0xaa; // boot signature
  const state = { simulated: true, lastCdb: null };
  let pending = [];
  const push = (b) => pending.push(b);
  return {
    state,
    async open() {}, async close() {},
    async write(bytes) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (dv.getUint32(0, true) !== CBW_SIGNATURE) return;
      const tag = dv.getUint32(4, true);
      const dataLen = dv.getUint32(8, true);
      const cdb = bytes.slice(15, 15 + bytes[14]);
      state.lastCdb = Array.from(cdb);
      const op = cdb[0];
      let data = null;
      if (op === 0x12) { // INQUIRY
        data = new Uint8Array(36);
        data[0] = 0x00; data[1] = 0x80; // disk, removable
        new TextEncoder().encodeInto('SIMUSB  ', data.subarray(8));
        new TextEncoder().encodeInto('Virtual Disk', data.subarray(16));
        new TextEncoder().encodeInto('1.0 ', data.subarray(32));
      } else if (op === 0x25) { // READ CAPACITY
        data = new Uint8Array(8); const d = new DataView(data.buffer);
        d.setUint32(0, blocks - 1, false); d.setUint32(4, blockSize, false);
      } else if (op === 0x28) { // READ(10)
        const lba = (cdb[2] << 24) | (cdb[3] << 16) | (cdb[4] << 8) | cdb[5];
        const count = (cdb[7] << 8) | cdb[8];
        data = new Uint8Array(count * blockSize);
        for (let i = 0; i < count; i++) {
          const abs = lba + i;
          if (abs === 0) data.set(sector0, 0);
          else for (let j = 0; j < blockSize; j++) data[i * blockSize + j] = (abs + j) & 0xff;
        }
      } else if (op === 0x00) { /* TEST UNIT READY */ data = new Uint8Array(); }
      if (data && data.length) push(data);
      const csw = new Uint8Array(13); const c = new DataView(csw.buffer);
      c.setUint32(0, CSW_SIGNATURE, true); c.setUint32(4, tag, true);
      c.setUint32(8, Math.max(0, dataLen - (data ? data.length : 0)), true); csw[12] = 0;
      push(csw);
    },
    async read() { return pending.length ? pending.shift() : new Uint8Array(); }
  };
}
