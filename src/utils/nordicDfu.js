/**
 * nordicDfu.js — Nordic Secure DFU (nRF5 SDK bootloader) over Web Bluetooth,
 * plus a value encoder for writing characteristics.
 *
 * DFU service 0xFE59: control point 8EC90001 (write + notify), packet 8EC90002
 * (write without response), buttonless 8EC90003 / 8EC90004 (indicate). A
 * firmware .zip holds manifest.json, an init packet (.dat) and the image (.bin).
 * Each object is created, streamed, CRC-checked and executed; an object that
 * the device already holds (same offset and CRC) is skipped, so an interrupted
 * update resumes.
 */

import JSZip from 'jszip';
import { crc32 } from './adbTools';

export const DFU_UUIDS = {
  SERVICE: '0000fe59-0000-1000-8000-00805f9b34fb',
  CONTROL: '8ec90001-f315-4f60-9fb8-838830daea50',
  PACKET: '8ec90002-f315-4f60-9fb8-838830daea50',
  BUTTONLESS: '8ec90003-f315-4f60-9fb8-838830daea50',
  BUTTONLESS_BONDED: '8ec90004-f315-4f60-9fb8-838830daea50'
};

export const DFU_OP = { CREATE: 0x01, SET_PRN: 0x02, CALC_CRC: 0x03, EXECUTE: 0x04, SELECT: 0x06, RESPONSE: 0x60 };
export const DFU_OBJ = { COMMAND: 0x01, DATA: 0x02 };
const RESULTS = {
  0x00: 'invalid opcode', 0x01: 'success', 0x02: 'opcode not supported', 0x03: 'invalid parameter', 0x04: 'insufficient resources',
  0x05: 'invalid object', 0x07: 'unsupported type', 0x08: 'operation not permitted', 0x0a: 'operation failed', 0x0b: 'extended error'
};
const EXT_ERRORS = {
  0x02: 'wrong command format', 0x03: 'unknown init command', 0x04: 'firmware version too low', 0x05: 'hardware version mismatch',
  0x06: 'SoftDevice version not supported', 0x07: 'init packet has no signature', 0x08: 'unsupported hash type', 0x09: 'hash failed',
  0x0a: 'unsupported signature type', 0x0b: 'verification failed (wrong signing key)', 0x0c: 'not enough space'
};

export class DfuError extends Error {}

const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/** CRC-32 of bytes [0, n) — what the device reports for the data it holds. */
const crcOf = (data, n) => crc32(data.subarray(0, n));

/** Read a nRF Connect / nrfutil DFU package. Returns the parts in flashing order. */
export async function readDfuPackage(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new DfuError('Not a DFU package: manifest.json is missing.');
  const manifest = JSON.parse(await manifestFile.async('string')).manifest || {};
  const order = ['softdevice_bootloader', 'softdevice', 'bootloader', 'application'];
  const parts = [];
  for (const type of order) {
    const m = manifest[type];
    if (!m) continue;
    const dat = zip.file(m.dat_file);
    const bin = zip.file(m.bin_file);
    if (!dat || !bin) throw new DfuError(`The package's ${type} entry points at files that are not in the zip.`);
    parts.push({ type, initPacket: await dat.async('uint8array'), firmware: await bin.async('uint8array') });
  }
  if (!parts.length) throw new DfuError('The manifest lists no application, bootloader or SoftDevice.');
  return parts;
}

export class NordicSecureDfu {
  /** control / packet: BluetoothRemoteGATTCharacteristic (or fakes with the same methods). */
  constructor(control, packet, { chunkSize = 20, prn = 0, log = () => {} } = {}) {
    this.control = control;
    this.packet = packet;
    this.chunkSize = chunkSize;
    this.prn = prn;
    this.log = log;
    this.waiter = null;
    this.onNotify = (e) => {
      const v = e.target?.value ?? e;
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      const w = this.waiter;
      this.waiter = null;
      w?.(b);
    };
  }

  async start() {
    await this.control.startNotifications();
    this.control.addEventListener('characteristicvaluechanged', this.onNotify);
    if (this.prn) await this.command([DFU_OP.SET_PRN, this.prn & 0xff, this.prn >> 8]);
  }

  stop() {
    try { this.control.removeEventListener('characteristicvaluechanged', this.onNotify); } catch (e) { /* gone */ }
  }

  /** Send a control-point request and wait for its response notification. */
  command(bytes, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waiter = null; reject(new DfuError(`No answer to DFU opcode 0x${bytes[0].toString(16)}.`)); }, timeoutMs);
      this.waiter = (b) => {
        clearTimeout(t);
        if (b[0] !== DFU_OP.RESPONSE || b[1] !== bytes[0]) { reject(new DfuError(`Unexpected DFU response ${Array.from(b.subarray(0, 3)).join(' ')}.`)); return; }
        if (b[2] !== 0x01) {
          const ext = b[2] === 0x0b ? `: ${EXT_ERRORS[b[3]] || `code ${b[3]}`}` : '';
          reject(new DfuError(`DFU opcode 0x${bytes[0].toString(16)} failed: ${RESULTS[b[2]] || `result ${b[2]}`}${ext}.`));
          return;
        }
        resolve(b.subarray(3));
      };
      this.control.writeValueWithResponse(Uint8Array.from(bytes)).catch((e) => { clearTimeout(t); this.waiter = null; reject(e); });
    });
  }

  async select(type) {
    const r = await this.command([DFU_OP.SELECT, type]);
    return { maxSize: u32(r, 0), offset: u32(r, 4), crc: u32(r, 8) };
  }

  async calcCrc() {
    const r = await this.command([DFU_OP.CALC_CRC]);
    return { offset: u32(r, 0), crc: u32(r, 4) };
  }

  async _stream(bytes) {
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      await this.packet.writeValueWithoutResponse(bytes.subarray(i, i + this.chunkSize));
    }
  }

  /** Send one object type (init packet or firmware) in chunks of the device's max object size. */
  async sendObject(type, data, onProgress) {
    const sel = await this.select(type);
    let start = 0;
    const crcOk = sel.offset > 0 && sel.offset <= data.length && sel.crc === crcOf(data, sel.offset);
    if (crcOk && type === DFU_OBJ.COMMAND && sel.offset === data.length) {
      await this.command([DFU_OP.EXECUTE]); // same init packet already on the device
      onProgress?.(1);
      return { resumed: true };
    }
    if (crcOk && type === DFU_OBJ.DATA) {
      if (sel.offset % sel.maxSize === 0 || sel.offset === data.length) {
        // The last object is complete: execute it (an error just means it already was) and go on after it.
        await this.command([DFU_OP.EXECUTE]).catch(() => {});
        start = sel.offset;
      } else {
        start = sel.offset - (sel.offset % sel.maxSize); // a partial object is sent again
      }
      if (start >= data.length) { onProgress?.(1); return { resumed: true }; }
      this.log(`Resuming the firmware at byte ${start}.`);
    }
    for (let off = start; off < data.length; off += sel.maxSize) {
      const obj = data.subarray(off, Math.min(off + sel.maxSize, data.length));
      await this.command([DFU_OP.CREATE, type, ...le32(obj.length)]);
      await this._stream(obj);
      const c = await this.calcCrc();
      const end = off + obj.length;
      if (c.offset !== end || c.crc !== crcOf(data, end)) {
        throw new DfuError(`CRC mismatch after byte ${end} (device has offset ${c.offset}, CRC 0x${c.crc.toString(16)}). Move closer and retry; the update resumes.`);
      }
      await this.command([DFU_OP.EXECUTE]);
      onProgress?.(end / data.length);
    }
    return { resumed: start > 0 };
  }

  /** Init packet, then firmware. The device validates and reboots into the new image. */
  async update({ initPacket, firmware }, onProgress) {
    onProgress?.('init', 0);
    await this.sendObject(DFU_OBJ.COMMAND, initPacket, (f) => onProgress?.('init', f));
    onProgress?.('firmware', 0);
    await this.sendObject(DFU_OBJ.DATA, firmware, (f) => onProgress?.('firmware', f));
  }
}

/** Buttonless DFU: ask the application to restart into its bootloader. */
export async function enterBootloader(buttonlessChar, timeoutMs = 5000) {
  await buttonlessChar.startNotifications();
  const reply = new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(null), timeoutMs); // many devices reset before indicating
    buttonlessChar.addEventListener('characteristicvaluechanged', (e) => {
      clearTimeout(t);
      const v = e.target.value;
      const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      if (b[0] === 0x20 && b[1] === 0x01 && b[2] !== 0x01) reject(new DfuError(`The device refused to enter the bootloader (result ${b[2]}).`));
      else resolve(b);
    }, { once: true });
  });
  await buttonlessChar.writeValueWithResponse(Uint8Array.from([0x01]));
  return reply;
}

// ---------------------------------------------------------------------------
// Value encoder for characteristic writes
// ---------------------------------------------------------------------------

export const WRITE_FORMATS = {
  hex: 'Hex bytes', utf8: 'Text (UTF-8)', u8: 'uint8', i8: 'int8', u16le: 'uint16 LE', u16be: 'uint16 BE',
  i16le: 'int16 LE', u32le: 'uint32 LE', u32be: 'uint32 BE', i32le: 'int32 LE', f32le: 'float32 LE'
};

/** Encode text in a format: numbers may be a list ("1, 2, 300") for repeated values. */
export function encodeValue(text, format) {
  if (format === 'utf8') return new TextEncoder().encode(text);
  if (format === 'hex') {
    const clean = String(text).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
    if (!clean.length || clean.length % 2) throw new Error('Hex must be whole bytes.');
    return Uint8Array.from(clean.match(/../g).map((h) => parseInt(h, 16)));
  }
  const spec = {
    u8: [1, 'setUint8', 0, 0xff], i8: [1, 'setInt8', -128, 127],
    u16le: [2, 'setUint16', 0, 0xffff, true], u16be: [2, 'setUint16', 0, 0xffff, false], i16le: [2, 'setInt16', -32768, 32767, true],
    u32le: [4, 'setUint32', 0, 0xffffffff, true], u32be: [4, 'setUint32', 0, 0xffffffff, false], i32le: [4, 'setInt32', -2147483648, 2147483647, true],
    f32le: [4, 'setFloat32', -Infinity, Infinity, true]
  }[format];
  if (!spec) throw new Error(`Unknown format ${format}.`);
  const [size, setter, min, max, little] = spec;
  const nums = String(text).split(/[\s,;]+/).filter(Boolean).map(Number);
  if (!nums.length || nums.some((n) => Number.isNaN(n))) throw new Error('Enter one or more numbers.');
  const out = new Uint8Array(nums.length * size);
  const dv = new DataView(out.buffer);
  nums.forEach((n, i) => {
    if (format !== 'f32le' && (!Number.isInteger(n) || n < min || n > max)) throw new Error(`${n} does not fit ${WRITE_FORMATS[format]}.`);
    if (size === 1) dv[setter](i, n); else dv[setter](i * size, n, little);
  });
  return out;
}
