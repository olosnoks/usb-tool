/**
 * RP2040 / RP2350 PICOBOOT protocol over WebUSB.
 *
 * PICOBOOT is the vendor-class interface (class 0xFF, subclass 0x00, protocol 0x00) that the
 * BOOTSEL-mode device exposes next to its mass-storage interface. Each operation is:
 *   1. a 32-byte command struct on bulk OUT,
 *   2. an optional data phase (bulk IN for device-to-host commands, bulk OUT otherwise),
 *   3. a zero-length ACK in the reverse direction of the data phase.
 *
 * Constants come from the pico-sdk boot_picoboot_headers (picoboot.h, picoboot_constants.h).
 * The ACK direction and the RP2040 REBOOT arguments are taken from the picotool design and are
 * NOT verified against real hardware yet (see the Picoboot workbench wiki article).
 *
 * This module has no React code. The transport only needs a WebUSB-like object with
 * transferOut(endpoint, data), transferIn(endpoint, length), controlTransferOut(setup) and
 * claimInterface/open helpers, so Vitest can drive it with a fake device.
 */
import { parseUF2 } from './firmwareParser';

export const PICOBOOT_MAGIC = 0x431fd10b;
export const PICOBOOT_RESET_REQUEST = 0x41; // vendor, interface-recipient OUT control request
export const PICOBOOT_CMD = Object.freeze({
  EXCLUSIVE_ACCESS: 0x01,
  REBOOT: 0x02, // RP2040
  FLASH_ERASE: 0x03,
  READ: 0x84, // device-to-host (bit 7 set)
  WRITE: 0x05,
  EXIT_XIP: 0x06,
  ENTER_CMD_XIP: 0x07,
  EXEC: 0x08,
  VECTORIZE_FLASH: 0x09,
  REBOOT2: 0x0a, // RP2350
  GET_INFO: 0x8b, // device-to-host (RP2350); not used by this tool yet
  OTP_READ: 0x8c,
  OTP_WRITE: 0x0d,
});
export const PICOBOOT_EXCLUSIVE = Object.freeze({ NOT_EXCLUSIVE: 0, EXCLUSIVE: 1, EXCLUSIVE_AND_EJECT: 2 });

// REBOOT2 (RP2350) flags, from picoboot_constants.h
export const REBOOT2_TYPE_NORMAL = 0x0;
export const REBOOT2_TYPE_BOOTSEL = 0x2;
export const REBOOT2_NO_RETURN_ON_SUCCESS = 0x100;

export const USB_VID_RASPBERRY_PI = 0x2e8a;
export const USB_PID_RP2040_BOOTSEL = 0x0003;
export const USB_PID_RP2350_BOOTSEL = 0x000f;

export const XIP_BASE = 0x10000000; // flash as seen on the bus; PICOBOOT flash ops take these addresses
export const MAX_FLASH_WINDOW = 16 * 1024 * 1024; // largest flash window this tool will address
export const FLASH_SECTOR_SIZE = 4096; // erase granularity
export const FLASH_PAGE_SIZE = 256; // program granularity
export const WRITE_CHUNK_SIZE = 4096;
export const READ_CHUNK_SIZE = 4096;

/** WebUSB filters for navigator.usb.requestDevice (BOOTSEL PIDs only, not the app-mode CDC PIDs). */
export const PICOBOOT_USB_FILTERS = [
  { vendorId: USB_VID_RASPBERRY_PI, productId: USB_PID_RP2040_BOOTSEL },
  { vendorId: USB_VID_RASPBERRY_PI, productId: USB_PID_RP2350_BOOTSEL },
];

export class PicobootError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PicobootError';
  }
}

/** Chip family from the USB product id. Returns null for anything that is not a known BOOTSEL PID. */
export function chipFromPid(pid) {
  if (pid === USB_PID_RP2040_BOOTSEL) return 'RP2040';
  if (pid === USB_PID_RP2350_BOOTSEL) return 'RP2350';
  return null;
}

const u32 = (v) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v >>> 0, true);
  return b;
};

/** Little-endian uint32 list packed into a fixed-size argument block. */
function packArgs(words, size) {
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  words.forEach((w, i) => dv.setUint32(i * 4, (w ?? 0) >>> 0, true));
  return out;
}

/** Arguments for FLASH_ERASE / READ / WRITE: address then size (or length). 8 bytes. */
export function rangeArgs(address, size) {
  return packArgs([address, size], 8);
}

/** Arguments for EXCLUSIVE_ACCESS: one byte. */
export function exclusiveArgs(mode = PICOBOOT_EXCLUSIVE.EXCLUSIVE) {
  return Uint8Array.of(mode & 0xff);
}

/** Arguments for RP2040 REBOOT: dPC, dSP, dDelayMS. 12 bytes. */
export function rebootArgs({ pc = 0, sp = 0, delayMs = 0 } = {}) {
  return packArgs([pc, sp, delayMs], 12);
}

/** Arguments for RP2350 REBOOT2: dFlags, dDelayMS, dParam0, dParam1. 16 bytes. */
export function reboot2Args({ flags = REBOOT2_TYPE_NORMAL, delayMs = 0, param0 = 0, param1 = 0 } = {}) {
  return packArgs([flags, delayMs, param0, param1], 16);
}

/**
 * Pack one 32-byte PICOBOOT command struct (little-endian):
 *   u32 dMagic, u32 dToken, u8 bCmdId, u8 bCmdSize, u16 reserved, u32 dTransferLength, u8 args[16]
 */
export function encodeCommand({ cmdId, token = 1, transferLength = 0, args = [], cmdSize } = {}) {
  const a = args instanceof Uint8Array ? args : Uint8Array.from(args);
  if (a.length > 16) throw new PicobootError('PICOBOOT command arguments exceed 16 bytes');
  if (!Number.isInteger(cmdId) || cmdId < 0 || cmdId > 0xff) throw new PicobootError('Invalid PICOBOOT command id');
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, PICOBOOT_MAGIC, true);
  dv.setUint32(4, token >>> 0, true);
  out[8] = cmdId;
  out[9] = cmdSize ?? a.length;
  dv.setUint16(10, 0, true);
  dv.setUint32(12, transferLength >>> 0, true);
  out.set(a, 16);
  return out;
}

/** Inverse of encodeCommand, used by tests and for logging. */
export function decodeCommand(bytes) {
  if (!bytes || bytes.length !== 32) throw new PicobootError('PICOBOOT command must be 32 bytes');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    magic: dv.getUint32(0, true),
    token: dv.getUint32(4, true),
    cmdId: bytes[8],
    cmdSize: bytes[9],
    transferLength: dv.getUint32(12, true),
    args: bytes.slice(16, 32),
  };
}

/**
 * Plan a flash write of `data` at `flashOffset` (offset from XIP_BASE).
 * Erase covers whole 4 KB sectors that the image touches. The program image is padded with 0xFF
 * to whole 256-byte pages, so the bytes before/after the image inside those pages are 0xFF.
 * Returns the erase range and the padded image to program starting at `writeAddress`.
 */
export function planFlashWrite(data, flashOffset, { sector = FLASH_SECTOR_SIZE, page = FLASH_PAGE_SIZE } = {}) {
  if (!(data instanceof Uint8Array) || data.length === 0) throw new PicobootError('Nothing to write: image is empty');
  if (!Number.isInteger(flashOffset) || flashOffset < 0) throw new PicobootError('Flash offset must be a non-negative integer');
  const end = flashOffset + data.length;
  const eraseStart = Math.floor(flashOffset / sector) * sector;
  const eraseEnd = Math.ceil(end / sector) * sector;
  const writeStart = Math.floor(flashOffset / page) * page;
  const writeEnd = Math.ceil(end / page) * page;
  const image = new Uint8Array(writeEnd - writeStart).fill(0xff);
  image.set(data, flashOffset - writeStart);
  return {
    eraseStart,
    eraseSize: eraseEnd - eraseStart,
    writeStart,
    image,
    imageOffset: flashOffset - writeStart,
    dataLength: data.length,
  };
}

/**
 * Convert a UF2 file to a flash image. UF2 target addresses must lie in flash (>= XIP_BASE).
 * Returns the bytes plus the offset from XIP_BASE where they belong. Gaps between blocks are 0xFF.
 */
export function uf2ToFlashImage(buffer) {
  const parsed = parseUF2(buffer);
  if (parsed.size === 0) throw new PicobootError('UF2 file contains no data blocks');
  const flashEnd = XIP_BASE + MAX_FLASH_WINDOW;
  if (parsed.startAddress < XIP_BASE || parsed.startAddress + parsed.size > flashEnd) {
    throw new PicobootError(`UF2 target 0x${parsed.startAddress.toString(16)} is outside the flash window 0x${XIP_BASE.toString(16)}-0x${flashEnd.toString(16)} (RAM images are not supported)`);
  }
  return { data: parsed.data, flashOffset: parsed.startAddress - XIP_BASE, familyId: parsed.familyId };
}

/** Offset/length to a hex-friendly label, e.g. "0x000000 - 0x0001ff". */
export function formatRange(offset, length) {
  const hex = (n) => `0x${n.toString(16).padStart(6, '0')}`;
  return `${hex(offset)} - ${hex(offset + length - 1)}`;
}

// ---------------------------------------------------------------------------------------------
// binary_info (picotool info)
// ---------------------------------------------------------------------------------------------

/**
 * pico-sdk binary_info: a header in flash holds pointers to the start and end of a table of
 * pointers to binary_info entries. The entry structs (core {u16 type, u16 tag}, then type-specific
 * fields) follow structure.h. The header marker and layout below are as recalled from the pico-sdk
 * and are NOT verified against a real binary; treat parsed results as best effort.
 */
export const BINARY_INFO_MARKER_START = 0x7188ebf2;
export const BINARY_INFO_TYPE = Object.freeze({
  ID_AND_INT: 5,
  ID_AND_STRING: 6,
});

/** Tag is two ASCII characters packed as BINARY_INFO_MAKE_TAG(c1, c2): c1 low byte, c2 high byte. */
export function binaryInfoTagString(tag) {
  return String.fromCharCode(tag & 0xff, (tag >> 8) & 0xff);
}

function readCString(bytes, offset, max = 256) {
  let s = '';
  for (let i = 0; i < max && offset + i < bytes.length; i++) {
    const c = bytes[offset + i];
    if (c === 0) break;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?';
  }
  return s;
}

/**
 * Parse binary_info from a flash image read starting at XIP_BASE (bytes[0] = flash 0x10000000).
 * Returns { found, headerOffset, entries: [{ type, tag, tagText, id?, value?, text? , raw? }], program }.
 * Entries of type PINS_* and other types are returned with `raw: true` (not decoded).
 */
export function parseBinaryInfo(bytes, { base = XIP_BASE, maxEntries = 256 } = {}) {
  const result = { found: false, headerOffset: -1, entries: [], program: {} };
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return result;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let header = -1;
  for (let off = 0; off + 16 <= bytes.length; off += 4) {
    if (dv.getUint32(off, true) === BINARY_INFO_MARKER_START) { header = off; break; }
  }
  if (header < 0) return result;

  const startPtr = dv.getUint32(header + 8, true);
  const endPtr = dv.getUint32(header + 12, true);
  const tableStart = startPtr - base;
  const tableEnd = endPtr - base;
  if (startPtr < base || endPtr <= startPtr || tableEnd > bytes.length) {
    return { ...result, found: true, headerOffset: header };
  }

  const count = Math.min(maxEntries, Math.floor((endPtr - startPtr) / 4));
  for (let i = 0; i < count; i++) {
    const ptr = dv.getUint32(tableStart + i * 4, true);
    const at = ptr - base;
    if (ptr < base || at + 4 > bytes.length) continue;
    const type = dv.getUint16(at, true);
    const tag = dv.getUint16(at + 2, true);
    const entry = { type, tag, tagText: binaryInfoTagString(tag) };
    if (type === BINARY_INFO_TYPE.ID_AND_INT && at + 12 <= bytes.length) {
      entry.id = dv.getUint32(at + 4, true);
      entry.value = dv.getInt32(at + 8, true);
    } else if (type === BINARY_INFO_TYPE.ID_AND_STRING && at + 12 <= bytes.length) {
      entry.id = dv.getUint32(at + 4, true);
      const sp = dv.getUint32(at + 8, true);
      entry.text = sp >= base && sp - base < bytes.length ? readCString(bytes, sp - base) : '';
    } else {
      entry.raw = true;
    }
    result.entries.push(entry);
  }

  result.found = true;
  result.headerOffset = header;
  result.program = summarizeBinaryInfo(result.entries);
  return result;
}

/**
 * Pick the entries that are most likely the program identity. Only the 'RP' tag (reserved for
 * Raspberry Pi use) is trusted; string entries are listed as-is so the user can read them.
 */
export function summarizeBinaryInfo(entries) {
  const strings = entries.filter((e) => e.text !== undefined && e.tagText === 'RP').map((e) => e.text);
  const ints = entries.filter((e) => e.value !== undefined && e.tagText === 'RP');
  return { strings, ints, pinEntries: entries.filter((e) => e.raw).length };
}

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

/** Find the PICOBOOT vendor interface (class 0xFF, subclass 0, protocol 0) with bulk IN and OUT. */
export function findPicobootInterface(device) {
  const configs = device?.configurations ?? [];
  for (const cfg of configs) {
    for (const iface of cfg.interfaces ?? []) {
      const alt = iface.alternates?.[0];
      if (!alt || alt.interfaceClass !== 0xff || alt.interfaceSubclass !== 0x00 || alt.interfaceProtocol !== 0x00) continue;
      const outEp = alt.endpoints?.find((e) => e.direction === 'out' && e.type === 'bulk');
      const inEp = alt.endpoints?.find((e) => e.direction === 'in' && e.type === 'bulk');
      if (outEp && inEp) {
        return {
          configurationValue: cfg.configurationValue,
          interfaceNumber: iface.interfaceNumber,
          outEndpoint: outEp.endpointNumber,
          inEndpoint: inEp.endpointNumber,
        };
      }
    }
  }
  return null;
}

const toBytes = (dataView) => (dataView ? new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength) : new Uint8Array(0));

export class PicobootConnection {
  /**
   * @param {object} device WebUSB USBDevice (or a fake with the same methods)
   * @param {{interfaceNumber:number, outEndpoint:number, inEndpoint:number, configurationValue?:number}} iface
   */
  constructor(device, iface) {
    this.device = device;
    this.iface = iface;
    this.token = 1;
    this.claimed = false;
  }

  nextToken() {
    const t = this.token;
    this.token = (this.token + 1) >>> 0 || 1;
    return t;
  }

  async open() {
    if (!this.device.opened) await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(this.iface.configurationValue ?? 1);
    await this.device.claimInterface(this.iface.interfaceNumber);
    this.claimed = true;
  }

  async close() {
    if (!this.claimed) return;
    this.claimed = false;
    try { await this.device.releaseInterface(this.iface.interfaceNumber); } catch (e) { /* already gone */ }
  }

  /** Vendor control request 0x41: resets the PICOBOOT interface state. */
  async resetInterface() {
    const r = await this.device.controlTransferOut({
      requestType: 'vendor',
      recipient: 'interface',
      request: PICOBOOT_RESET_REQUEST,
      value: 0,
      index: this.iface.interfaceNumber,
    });
    if (r && r.status && r.status !== 'ok') throw new PicobootError(`Interface reset failed: ${r.status}`);
  }

  async bulkOut(bytes) {
    const r = await this.device.transferOut(this.iface.outEndpoint, bytes);
    if (r.status !== 'ok') throw new PicobootError(`Bulk OUT failed: ${r.status}`);
  }

  async bulkIn(length) {
    const r = await this.device.transferIn(this.iface.inEndpoint, length);
    if (r.status !== 'ok') throw new PicobootError(`Bulk IN failed: ${r.status}`);
    return toBytes(r.data);
  }

  /**
   * Run one PICOBOOT command: command packet, optional data phase, then the zero-length ACK.
   * Device-to-host commands (bCmdId bit 7) return the IN data; host-to-device commands take `out`.
   */
  async execute(cmd, { out = null } = {}) {
    const isIn = (cmd.cmdId & 0x80) !== 0;
    await this.bulkOut(encodeCommand({ ...cmd, token: this.nextToken() }));
    let data = null;
    if (cmd.transferLength > 0) {
      if (isIn) {
        data = await this.bulkIn(cmd.transferLength);
      } else {
        if (!out || out.length !== cmd.transferLength) throw new PicobootError('Data phase length does not match command');
        await this.bulkOut(out);
      }
    }
    if (isIn) await this.bulkOut(new Uint8Array(0)); // host ACKs device-to-host data
    else await this.bulkIn(0); // device ACKs host-to-device / no-data commands
    return data;
  }

  exclusiveAccess(mode = PICOBOOT_EXCLUSIVE.EXCLUSIVE) {
    return this.execute({ cmdId: PICOBOOT_CMD.EXCLUSIVE_ACCESS, cmdSize: 1, args: exclusiveArgs(mode) });
  }

  exitXip() {
    return this.execute({ cmdId: PICOBOOT_CMD.EXIT_XIP, cmdSize: 0 });
  }

  enterCmdXip() {
    return this.execute({ cmdId: PICOBOOT_CMD.ENTER_CMD_XIP, cmdSize: 0 });
  }

  flashErase(address, size) {
    return this.execute({ cmdId: PICOBOOT_CMD.FLASH_ERASE, args: rangeArgs(address, size) });
  }

  read(address, size) {
    return this.execute({ cmdId: PICOBOOT_CMD.READ, transferLength: size, args: rangeArgs(address, size) });
  }

  write(address, bytes) {
    return this.execute({ cmdId: PICOBOOT_CMD.WRITE, transferLength: bytes.length, args: rangeArgs(address, bytes.length) }, { out: bytes });
  }

  /**
   * Reboot. The device disconnects, so the ACK may fail; that is reported as success.
   * RP2040: REBOOT (pc/sp/delay). RP2350: REBOOT2 (flags select normal or BOOTSEL).
   */
  async reboot(chip, target = 'app') {
    const cmd = chip === 'RP2350'
      ? { cmdId: PICOBOOT_CMD.REBOOT2, args: reboot2Args({ flags: target === 'bootsel' ? REBOOT2_TYPE_BOOTSEL : REBOOT2_TYPE_NORMAL, delayMs: 100 }) }
      : { cmdId: PICOBOOT_CMD.REBOOT, args: rebootArgs({ pc: 0, sp: 0, delayMs: 100 }) };
    try {
      await this.execute(cmd);
    } catch (e) {
      // Expected once the chip resets: the ACK transfer fails with a disconnect. The caller
      // must re-scan for the device rather than trust this call.
      return { disconnectedAfterCommand: true, reason: e.message };
    }
    return { disconnectedAfterCommand: false };
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers for save / verify / export (pure functions)
// ---------------------------------------------------------------------------------------------

export const UF2_FAMILY = Object.freeze({ RP2040: 0xe48bff56, RP2350_ARM_S: 0xe48bff59 });

/** Parse "0x1000", "4096", or sizes like "2M" / "256K". Returns null when invalid. */
export function parseSize(s) {
  const t = String(s ?? '').trim();
  if (!t) return null;
  const m = /^(0x[0-9a-f]+|\d+)\s*([kKmM]?)$/i.exec(t);
  if (!m) return null;
  const base = /^0x/i.test(m[1]) ? parseInt(m[1], 16) : parseInt(m[1], 10);
  const mul = m[2] ? (m[2].toLowerCase() === 'k' ? 1024 : 1024 * 1024) : 1;
  const n = base * mul;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Length of `data` without trailing 0xFF (erased flash) bytes, rounded up to `align`. */
export function usedLength(data, align = FLASH_PAGE_SIZE) {
  let end = data.length;
  while (end > 0 && data[end - 1] === 0xff) end--;
  if (end === 0) return 0;
  return Math.min(data.length, Math.ceil(end / align) * align);
}

/** Encode a flash image as UF2 (256-byte payload blocks, familyID present). `address` is the bus address. */
export function binToUf2(data, address = XIP_BASE, family = UF2_FAMILY.RP2040) {
  const PAYLOAD = 256;
  const blocks = Math.ceil(data.length / PAYLOAD);
  const out = new Uint8Array(blocks * 512);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < blocks; i++) {
    const o = i * 512;
    const part = data.subarray(i * PAYLOAD, (i + 1) * PAYLOAD);
    dv.setUint32(o, 0x0a324655, true);
    dv.setUint32(o + 4, 0x9e5d5157, true);
    dv.setUint32(o + 8, 0x2000, true);
    dv.setUint32(o + 12, (address + i * PAYLOAD) >>> 0, true);
    dv.setUint32(o + 16, PAYLOAD, true);
    dv.setUint32(o + 20, i, true);
    dv.setUint32(o + 24, blocks, true);
    dv.setUint32(o + 28, family >>> 0, true);
    out.set(part, o + 32);
    dv.setUint32(o + 508, 0x0ab16f30, true);
  }
  return out;
}

/** Compare two byte arrays. Returns { equal, mismatches, firstIndex, lengthA, lengthB }. */
export function compareImages(expected, actual) {
  const n = Math.min(expected.length, actual.length);
  let mismatches = Math.abs(expected.length - actual.length);
  let first = expected.length === actual.length ? -1 : n;
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) { mismatches++; if (first < 0 || i < first) first = i; }
  }
  return { equal: mismatches === 0, mismatches, firstIndex: first, lengthA: expected.length, lengthB: actual.length };
}

/** Hex digest using Web Crypto (SHA-256 by default). */
export async function digestHex(bytes, algo = 'SHA-256') {
  const d = await crypto.subtle.digest(algo, bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** CRC-32 (IEEE) as 8 hex digits. */
export function crc32Hex(bytes) {
  let c = ~0;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ((~c) >>> 0).toString(16).padStart(8, '0');
}

/**
 * Equivalent picotool command lines for the current settings. These are an export for the
 * desktop CLI; the browser does not run picotool.
 */
export function picotoolCommands({ readOffset = 0, readLength = 0, writeFile = null, writeOffset = 0, kind = 'bin' } = {}) {
  const h = (n) => `0x${(n >>> 0).toString(16)}`;
  const cmds = ['picotool info -a'];
  if (readLength > 0) cmds.push(`picotool save -r ${h(XIP_BASE + readOffset)} ${h(XIP_BASE + readOffset + readLength)} flash.${kind === 'uf2' ? 'uf2' : 'bin'}`);
  if (writeFile) {
    const f = /\s/.test(writeFile) ? `"${writeFile}"` : writeFile;
    if (/\.uf2$/i.test(writeFile)) {
      cmds.push(`picotool load ${f} -v`, `picotool verify ${f}`);
    } else {
      cmds.push(`picotool load ${f} -o ${h(XIP_BASE + writeOffset)} -v`, `picotool verify ${f} -o ${h(XIP_BASE + writeOffset)}`);
    }
  }
  cmds.push('picotool reboot');
  return cmds;
}
