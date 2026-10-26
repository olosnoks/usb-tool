/**
 * dfuDriver.js — USB DFU 1.1 + ST DfuSe (DFU extension) in-browser flasher.
 *
 * This module is the "pure driver" half of the driver + workbench pattern: it
 * owns the DFU class protocol, the .dfu suffix / DfuSe container parsing, and
 * the download state machine, but it does NOT touch React or `navigator.usb`
 * directly. Every device interaction goes through a tiny injected "device"
 * object that only needs the two WebUSB control-transfer methods:
 *
 *     controlTransferOut({ requestType, recipient, request, value, index }, data?) -> { status, bytesWritten }
 *     controlTransferIn ({ requestType, recipient, request, value, index }, length) -> { status, data: DataView }
 *
 * Because the device is injected, the whole download loop is unit-testable
 * against a fake device with no hardware present (see tests/dfuDriver.test.js).
 *
 * References: USB DFU 1.1 spec; ST AN3156 (DfuSe over USB); dfu-util.
 */

// ---------------------------------------------------------------------------
// Class request codes (bRequest), states, and status codes
// ---------------------------------------------------------------------------

export const DFU_REQUEST = {
  DETACH: 0x00,
  DNLOAD: 0x01,
  UPLOAD: 0x02,
  GETSTATUS: 0x03,
  CLRSTATUS: 0x04,
  GETSTATE: 0x05,
  ABORT: 0x06
};

export const DFU_STATE = {
  appIDLE: 0,
  appDETACH: 1,
  dfuIDLE: 2,
  dfuDNLOAD_SYNC: 3,
  dfuDNBUSY: 4,
  dfuDNLOAD_IDLE: 5,
  dfuMANIFEST_SYNC: 6,
  dfuMANIFEST: 7,
  dfuMANIFEST_WAIT_RESET: 8,
  dfuUPLOAD_IDLE: 9,
  dfuERROR: 10
};

const DFU_STATE_NAMES = Object.fromEntries(
  Object.entries(DFU_STATE).map(([k, v]) => [v, k])
);

// bStatus values from the spec, mapped to a human string.
const DFU_STATUS_NAMES = {
  0x00: 'OK',
  0x01: 'errTARGET',
  0x02: 'errFILE',
  0x03: 'errWRITE',
  0x04: 'errERASE',
  0x05: 'errCHECK_ERASED',
  0x06: 'errPROG',
  0x07: 'errVERIFY',
  0x08: 'errADDRESS',
  0x09: 'errNOTDONE',
  0x0a: 'errFIRMWARE',
  0x0b: 'errVENDOR',
  0x0c: 'errUSBR',
  0x0d: 'errPOR',
  0x0e: 'errUNKNOWN',
  0x0f: 'errSTALLEDPKT'
};

// DfuSe special download commands (sent as DNLOAD block 0).
const DFUSE_CMD = {
  GET_COMMANDS: 0x00,
  SET_ADDRESS: 0x21,
  ERASE: 0x41,
  READ_UNPROTECT: 0x92
};

// DFU interface descriptor identifiers (class-specific).
export const DFU_INTERFACE_CLASS = 0xfe;
export const DFU_INTERFACE_SUBCLASS = 0x01;
const DFU_FUNCTIONAL_DESCRIPTOR = 0x21;

// ---------------------------------------------------------------------------
// CRC-32 used by the DFU file suffix.
//
// The DFU suffix stores a standard reflected CRC-32 (poly 0xEDB88320, init
// 0xFFFFFFFF) computed over every byte of the file EXCEPT the final 4 CRC
// bytes — and, unlike zlib's crc32, the result is NOT finally inverted.
// dfu-util does the same (no `^ 0xffffffff` at the end).
// ---------------------------------------------------------------------------

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

export function dfuCrc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return crc >>> 0; // deliberately NOT inverted — this is the DFU convention
}

// ---------------------------------------------------------------------------
// File parsing: DFU suffix + DfuSe container
// ---------------------------------------------------------------------------

/**
 * Parse the optional 16-byte DFU suffix from the end of a firmware file.
 * Returns { present, valid, ... } and the payload with the suffix stripped.
 * A missing suffix is not an error (raw .bin files have none) — it just means
 * we cannot cross-check VID/PID, so `present` is false.
 */
export function parseDfuSuffix(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length < 16) {
    return { present: false, valid: false, payload: bytes };
  }

  const suffix = bytes.subarray(bytes.length - 16);
  // Signature: suffix[8..10] = 'D','F','U'; suffix[11] = bLength (16).
  const sigOk =
    suffix[8] === 0x44 && suffix[9] === 0x46 && suffix[10] === 0x55 && suffix[11] === 16;

  if (!sigOk) {
    return { present: false, valid: false, payload: bytes };
  }

  const dv = new DataView(suffix.buffer, suffix.byteOffset, suffix.byteLength);
  const bcdDevice = dv.getUint16(0, true);
  const idProduct = dv.getUint16(2, true);
  const idVendor = dv.getUint16(4, true);
  const bcdDFU = dv.getUint16(6, true);
  const crcStored = dv.getUint32(12, true) >>> 0;
  const crcCalc = dfuCrc32(bytes.subarray(0, bytes.length - 4));

  return {
    present: true,
    valid: crcStored === crcCalc,
    bcdDevice,
    idProduct,
    idVendor,
    bcdDFU,
    crcStored,
    crcCalc,
    // The DFU payload is everything before the 16-byte suffix.
    payload: bytes.subarray(0, bytes.length - 16)
  };
}

/**
 * Parse a DfuSe (ST "DfuSe") container. These start with the ASCII prefix
 * "DfuSe" and carry one or more targets, each with one or more elements that
 * pin an absolute flash address to a data blob. Returns `{ isDfuSe: false }`
 * for plain binaries. Call `parseDfuSuffix` first and feed it the `payload`.
 */
export function parseDfuSeImage(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // "DfuSe" = 0x44 0x66 0x75 0x53 0x65
  const isDfuSe =
    bytes.length >= 11 &&
    bytes[0] === 0x44 &&
    bytes[1] === 0x66 &&
    bytes[2] === 0x75 &&
    bytes[3] === 0x53 &&
    bytes[4] === 0x65;

  if (!isDfuSe) {
    return { isDfuSe: false, targets: [] };
  }

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bTargets = bytes[10];
  let off = 11; // after szSignature(5) + bVersion(1) + DFUImageSize(4) + bTargets(1)

  const targets = [];
  for (let t = 0; t < bTargets; t++) {
    // Target prefix: szSignature[6]='Target', bAlternateSetting(1),
    // bTargetNamed(4), szTargetName[255], dwTargetSize(4), dwNbElements(4)
    const alternate = bytes[off + 6];
    const nbElements = dv.getUint32(off + 270, true);
    let eoff = off + 274;

    const elements = [];
    for (let e = 0; e < nbElements; e++) {
      const address = dv.getUint32(eoff, true) >>> 0;
      const size = dv.getUint32(eoff + 4, true) >>> 0;
      const data = bytes.subarray(eoff + 8, eoff + 8 + size);
      elements.push({ address, data });
      eoff += 8 + size;
    }

    targets.push({ alternate, elements });
    off = eoff;
  }

  return { isDfuSe: true, targets };
}

/**
 * Decode a 6-byte DFU_GETSTATUS response into a structured object.
 * Layout: bStatus(1), bwPollTimeout(3, LE), bState(1), iString(1).
 */
export function parseDfuStatus(dataView) {
  const dv =
    dataView instanceof DataView
      ? dataView
      : new DataView(dataView.buffer ?? dataView, dataView.byteOffset ?? 0);
  const status = dv.getUint8(0);
  const pollTimeout = dv.getUint8(1) | (dv.getUint8(2) << 8) | (dv.getUint8(3) << 16);
  const state = dv.getUint8(4);
  return {
    status,
    statusText: DFU_STATUS_NAMES[status] ?? `0x${status.toString(16)}`,
    pollTimeout,
    state,
    stateText: DFU_STATE_NAMES[state] ?? `0x${state.toString(16)}`
  };
}

// ---------------------------------------------------------------------------
// Functional-descriptor parsing (to discover wTransferSize)
//
// WebUSB's USBAlternateInterface does not surface the class-specific DFU
// functional descriptor, so we read the raw CONFIGURATION descriptor via a
// standard GET_DESCRIPTOR control transfer and walk it ourselves.
// ---------------------------------------------------------------------------

/**
 * Walk a raw configuration descriptor and return the first DFU functional
 * descriptor's attributes, or null. `{ bmAttributes, detachTimeout,
 * transferSize, bcdDFU }`.
 */
export function parseDfuFunctionalDescriptor(configBytes) {
  const bytes =
    configBytes instanceof Uint8Array ? configBytes : new Uint8Array(configBytes);
  let i = 0;
  while (i + 1 < bytes.length) {
    const bLength = bytes[i];
    const bDescriptorType = bytes[i + 1];
    if (bLength < 2) break; // malformed; avoid infinite loop
    if (bDescriptorType === DFU_FUNCTIONAL_DESCRIPTOR && bLength >= 7) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset + i, bLength);
      return {
        bmAttributes: dv.getUint8(2),
        detachTimeout: dv.getUint16(3, true),
        transferSize: dv.getUint16(5, true),
        bcdDFU: bLength >= 9 ? dv.getUint16(7, true) : null,
        // Convenience flags decoded from bmAttributes.
        canDownload: (dv.getUint8(2) & 0x01) !== 0,
        canUpload: (dv.getUint8(2) & 0x02) !== 0,
        manifestationTolerant: (dv.getUint8(2) & 0x04) !== 0,
        willDetach: (dv.getUint8(2) & 0x08) !== 0
      };
    }
    i += bLength;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

// ---------------------------------------------------------------------------
// DfuDevice — the stateful driver bound to one claimed DFU interface.
// ---------------------------------------------------------------------------

export class DfuDevice {
  /**
   * @param {object} device   Object exposing WebUSB controlTransferIn/Out.
   * @param {number} interfaceNumber  The claimed interface's bInterfaceNumber.
   * @param {object} [opts]
   * @param {number} [opts.transferSize=1024]  Max bytes per DNLOAD block.
   * @param {boolean}[opts.dfuse=false]         Use ST DfuSe command set.
   * @param {(msg:string)=>void} [opts.log]     Optional log sink.
   */
  constructor(device, interfaceNumber, opts = {}) {
    this.device = device;
    this.interfaceNumber = interfaceNumber;
    this.transferSize = opts.transferSize || 1024;
    this.dfuse = Boolean(opts.dfuse);
    this.log = typeof opts.log === 'function' ? opts.log : () => {};
  }

  // -- raw class transfers --------------------------------------------------

  async _out(request, value, data) {
    const result = await this.device.controlTransferOut(
      {
        requestType: 'class',
        recipient: 'interface',
        request,
        value,
        index: this.interfaceNumber
      },
      data
    );
    if (result && result.status && result.status !== 'ok') {
      throw new Error(`DFU control OUT (req 0x${request.toString(16)}) failed: ${result.status}`);
    }
    return result;
  }

  async _in(request, value, length) {
    const result = await this.device.controlTransferIn(
      {
        requestType: 'class',
        recipient: 'interface',
        request,
        value,
        index: this.interfaceNumber
      },
      length
    );
    if (result && result.status && result.status !== 'ok') {
      throw new Error(`DFU control IN (req 0x${request.toString(16)}) failed: ${result.status}`);
    }
    return result;
  }

  // -- class requests -------------------------------------------------------

  async getStatus() {
    const res = await this._in(DFU_REQUEST.GETSTATUS, 0, 6);
    return parseDfuStatus(res.data);
  }

  async clearStatus() {
    await this._out(DFU_REQUEST.CLRSTATUS, 0);
  }

  async abort() {
    await this._out(DFU_REQUEST.ABORT, 0);
  }

  /**
   * Issue one DNLOAD then poll GETSTATUS until the device leaves the busy
   * state, honoring the device-reported poll timeout. Returns the final status.
   */
  async _downloadBlock(blockNum, data) {
    await this._out(DFU_REQUEST.DNLOAD, blockNum, data);
    let status = await this.getStatus();
    // The device may ask us to wait (dfuDNBUSY) one or more times.
    while (status.state === DFU_STATE.dfuDNBUSY) {
      await sleep(status.pollTimeout);
      status = await this.getStatus();
    }
    if (status.status !== 0x00) {
      throw new Error(
        `DFU download error at block ${blockNum}: ${status.statusText} (state ${status.stateText})`
      );
    }
    return status;
  }

  /**
   * Bring the device to a clean dfuIDLE state. If it is in dfuERROR we clear
   * it; if it is mid-download we abort first.
   */
  async ensureIdle() {
    let status = await this.getStatus();
    if (status.state === DFU_STATE.dfuERROR) {
      await this.clearStatus();
      status = await this.getStatus();
    }
    if (
      status.state !== DFU_STATE.dfuIDLE &&
      status.state !== DFU_STATE.appIDLE
    ) {
      await this.abort();
      status = await this.getStatus();
    }
    return status;
  }

  // -- DfuSe command set (ST) ----------------------------------------------

  /** Encode a 32-bit little-endian address into the DfuSe command payload. */
  static _dfuseCmd(cmd, address) {
    const buf = new Uint8Array(address == null ? 1 : 5);
    buf[0] = cmd;
    if (address != null) {
      buf[1] = address & 0xff;
      buf[2] = (address >>> 8) & 0xff;
      buf[3] = (address >>> 16) & 0xff;
      buf[4] = (address >>> 24) & 0xff;
    }
    return buf;
  }

  async dfuseSetAddress(address) {
    await this._downloadBlock(0, DfuDevice._dfuseCmd(DFUSE_CMD.SET_ADDRESS, address));
  }

  async dfuseErasePage(address) {
    await this._downloadBlock(0, DfuDevice._dfuseCmd(DFUSE_CMD.ERASE, address));
  }

  async dfuseMassErase() {
    // ERASE command with no address => mass erase.
    await this._downloadBlock(0, DfuDevice._dfuseCmd(DFUSE_CMD.ERASE, null));
  }

  // -- high-level download --------------------------------------------------

  /**
   * Plain DFU 1.1 download. Writes `data` as sequential blocks starting at
   * wBlockNum = 0, then sends a zero-length DNLOAD and runs the manifest phase.
   * @param {Uint8Array} data
   * @param {(info:{written:number,total:number})=>void} [onProgress]
   */
  async download(data, onProgress) {
    await this.ensureIdle();

    const total = data.length;
    let blockNum = 0;
    let offset = 0;

    while (offset < total) {
      const chunk = data.subarray(offset, offset + this.transferSize);
      await this._downloadBlock(blockNum, chunk);
      offset += chunk.length;
      blockNum += 1;
      onProgress?.({ written: offset, total });
    }

    // Zero-length DNLOAD signals end-of-download -> manifest.
    await this._out(DFU_REQUEST.DNLOAD, blockNum, new Uint8Array(0));
    await this._manifest();
    onProgress?.({ written: total, total });
  }

  /**
   * DfuSe download for one element: set the target address, erase the pages it
   * covers, then program it. DfuSe data blocks use wBlockNum starting at 2, and
   * the device derives the write address from the previously-set pointer plus
   * (wBlockNum - 2) * transferSize.
   * @param {number} address
   * @param {Uint8Array} data
   * @param {object} [opts] { erasePageSize }
   * @param {(info:{written:number,total:number})=>void} [onProgress]
   */
  async dfuseDownloadElement(address, data, opts = {}, onProgress) {
    await this.ensureIdle();

    const erasePageSize = opts.erasePageSize || 0;
    if (erasePageSize > 0) {
      for (let a = address; a < address + data.length; a += erasePageSize) {
        this.log(`Erasing page @ 0x${a.toString(16)}`);
        await this.dfuseErasePage(a);
      }
    } else {
      // Fall back to a mass erase when page geometry is unknown.
      this.log('Page size unknown — performing mass erase');
      await this.dfuseMassErase();
    }

    await this.dfuseSetAddress(address);

    const total = data.length;
    let offset = 0;
    let blockNum = 2; // DfuSe data blocks start at 2
    while (offset < total) {
      const chunk = data.subarray(offset, offset + this.transferSize);
      await this._downloadBlock(blockNum, chunk);
      offset += chunk.length;
      blockNum += 1;
      onProgress?.({ written: offset, total });
    }

    // Terminate + manifest.
    await this.dfuseSetAddress(address);
    await this._out(DFU_REQUEST.DNLOAD, 0, new Uint8Array(0));
    await this._manifest();
    onProgress?.({ written: total, total });
  }

  /**
   * Run the manifestation phase: poll until the device finishes writing /
   * leaves manifest. Devices that are not manifestation-tolerant drop off the
   * bus here (a USB error / stall), which we treat as success.
   */
  async _manifest() {
    try {
      let status = await this.getStatus();
      while (
        status.state === DFU_STATE.dfuMANIFEST ||
        status.state === DFU_STATE.dfuMANIFEST_SYNC
      ) {
        await sleep(status.pollTimeout);
        status = await this.getStatus();
      }
      if (status.status !== 0x00 && status.state === DFU_STATE.dfuERROR) {
        throw new Error(`DFU manifest error: ${status.statusText}`);
      }
    } catch (err) {
      // A device that resets itself during manifest will make GETSTATUS fail.
      // That is the expected, successful outcome for non-tolerant devices.
      this.log(`Manifest phase ended (device likely reset): ${err.message}`);
    }
  }
}

/**
 * Discover the DFU interface on an opened WebUSB device by reading the raw
 * configuration descriptor and locating the interface with DFU class/subclass
 * plus its functional descriptor. Returns null if the device is not DFU.
 *
 * @param {USBDevice} usbDevice  An opened WebUSB device.
 * @returns {Promise<null|{interfaceNumber:number, alternate:number,
 *   transferSize:number, bcdDFU:number|null, attributes:object}>}
 */
export async function discoverDfuInterface(usbDevice) {
  const configValue = usbDevice.configuration?.configurationValue ?? 1;

  // GET_DESCRIPTOR (CONFIGURATION): wValue = (type << 8) | index.
  // First grab the 4-byte header to learn wTotalLength, then the whole thing.
  const header = await usbDevice.controlTransferIn(
    {
      requestType: 'standard',
      recipient: 'device',
      request: 0x06, // GET_DESCRIPTOR
      value: (0x02 << 8) | (configValue - 1),
      index: 0
    },
    4
  );
  if (!header.data || header.data.byteLength < 4) return null;
  const totalLength = header.data.getUint16(2, true);

  const full = await usbDevice.controlTransferIn(
    {
      requestType: 'standard',
      recipient: 'device',
      request: 0x06,
      value: (0x02 << 8) | (configValue - 1),
      index: 0
    },
    totalLength
  );
  if (!full.data) return null;

  const bytes = new Uint8Array(full.data.buffer);
  const func = parseDfuFunctionalDescriptor(bytes);

  // Find the DFU interface from WebUSB's own parsed descriptors.
  for (const cfg of usbDevice.configurations) {
    for (const iface of cfg.interfaces) {
      for (const alt of iface.alternates) {
        if (
          alt.interfaceClass === DFU_INTERFACE_CLASS &&
          alt.interfaceSubclass === DFU_INTERFACE_SUBCLASS
        ) {
          return {
            interfaceNumber: iface.interfaceNumber,
            alternate: alt.alternateSetting,
            transferSize: func?.transferSize || 1024,
            bcdDFU: func?.bcdDFU ?? null,
            attributes: func || {}
          };
        }
      }
    }
  }
  return null;
}
