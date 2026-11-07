/**
 * fastbootDriver.js — Android fastboot protocol over WebUSB.
 *
 * Driver half of the driver + workbench pattern (same shape as dfuDriver.js):
 * it owns the fastboot wire protocol but touches neither React nor
 * `navigator.usb`. All I/O goes through an injected transport:
 *
 *     transport.write(Uint8Array)     -> Promise<void>   (bulk OUT)
 *     transport.read(maxLength)       -> Promise<Uint8Array> (bulk IN)
 *     transport.close()               -> Promise<void>
 *
 * so the whole command/download state machine is unit-testable against a fake
 * bootloader with no hardware present (see tests/fastboot.test.js).
 *
 * Fastboot is a thin request/response text protocol on a bulk endpoint pair:
 *   - the host writes an ASCII command (<= 64 bytes);
 *   - the device answers with one or more 4-byte-prefixed packets:
 *       OKAY<payload>   success, payload is the result
 *       FAIL<reason>    the command failed
 *       DATA<8 hex>     device is ready for (download) or sending (upload) N bytes
 *       INFO<text>      progress text; more packets follow
 *       TEXT<text>      free-form text (newer bootloaders); more packets follow
 *
 * This supports only owner-controlled operations: reading variables, unlocking
 * your own bootloader (which the device gates behind an on-screen confirmation),
 * flashing/erasing partitions, and rebooting. There is no lock bypass here —
 * `flashing unlock` just issues the request; the phone itself asks the user to
 * approve it with the volume/power keys, and unlocking wipes user data.
 *
 * References: AOSP fastboot protocol doc (fastboot/README.md), fastboot.c.
 */

import { isSparse, parseSparse, LOGICAL_PARTITIONS } from './fastbootTools';

// Interface descriptor that marks a fastboot interface, whatever the VID.
export const FASTBOOT_CLASS = { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x03 };

// Common Android vendor IDs, so the chooser shows fastboot devices.
export const FASTBOOT_USB_FILTERS = [
  { vendorId: 0x18d1 }, // Google
  { vendorId: 0x04e8 }, // Samsung
  { vendorId: 0x2a70 }, // OnePlus / Oppo (BBK)
  { vendorId: 0x22b8 }, // Motorola
  { vendorId: 0x2717 }, // Xiaomi
  { vendorId: 0x1004 }, // LG
  { vendorId: 0x0fce }, // Sony
  { vendorId: 0x12d1 }, // Huawei
  { vendorId: 0x2916 }, // Fairphone
  { vendorId: 0x0e8d }, // MediaTek
  { vendorId: 0x0bb4 }  // HTC
];

export class FastbootError extends Error {
  constructor(message, command) {
    super(message);
    this.name = 'FastbootError';
    this.command = command;
  }
}

const te = new TextEncoder();
const td = new TextDecoder();
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * One fastboot response packet, split into its 4-char tag and payload.
 * Unknown tags (no device should send them) are treated as a failure.
 */
export function parseResponse(bytes) {
  const text = td.decode(bytes);
  const tag = text.slice(0, 4);
  const payload = text.slice(4);
  if (!['OKAY', 'FAIL', 'DATA', 'INFO', 'TEXT'].includes(tag)) {
    return { tag: 'FAIL', payload: `unexpected reply "${text.slice(0, 32)}"` };
  }
  return { tag, payload };
}

// ---------------------------------------------------------------------------
// WebUSB transport
// ---------------------------------------------------------------------------

/** Find the fastboot interface (class ff / 42 / 03) and its bulk endpoints. */
export function findFastbootInterface(configuration) {
  for (const iface of configuration?.interfaces || []) {
    for (const alt of iface.alternates || []) {
      if (alt.interfaceClass !== FASTBOOT_CLASS.classCode) continue;
      if (alt.interfaceSubclass !== FASTBOOT_CLASS.subclassCode) continue;
      if (alt.interfaceProtocol !== FASTBOOT_CLASS.protocolCode) continue;
      const out = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      const inn = alt.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      if (out && inn) {
        return { interfaceNumber: iface.interfaceNumber, alternate: alt.alternateSetting, epOut: out.endpointNumber, epIn: inn.endpointNumber, inPacketSize: inn.packetSize || 64 };
      }
    }
  }
  return null;
}

export class FastbootUsbTransport {
  constructor(device) {
    this.device = device;
    this.inPacketSize = 64;
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const found = findFastbootInterface(d.configuration);
    if (!found) throw new FastbootError('No fastboot interface on this device. Is it in bootloader/fastboot mode (not Android, not recovery)?');
    this.interfaceNumber = found.interfaceNumber;
    this.epOut = found.epOut;
    this.epIn = found.epIn;
    this.inPacketSize = found.inPacketSize;
    await d.claimInterface(this.interfaceNumber);
    if (found.alternate) await d.selectAlternateInterface(this.interfaceNumber, found.alternate);
  }

  async write(bytes) {
    const r = await this.device.transferOut(this.epOut, bytes);
    if (r.status !== 'ok') throw new FastbootError(`USB OUT ${r.status}`);
  }

  async read(maxLength = 256) {
    const r = await this.device.transferIn(this.epIn, maxLength);
    if (r.status === 'stall') { try { await this.device.clearHalt('in', this.epIn); } catch (e) { /* ignore */ } }
    if (r.status !== 'ok' && !r.data) throw new FastbootError(`USB IN ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }

  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

export async function requestFastbootDevice() {
  if (typeof navigator === 'undefined' || !navigator.usb) throw new FastbootError('WebUSB needs Chrome or Edge over HTTPS.');
  const device = await navigator.usb.requestDevice({ filters: FASTBOOT_USB_FILTERS });
  return new FastbootUsbTransport(device);
}

// ---------------------------------------------------------------------------
// Fastboot device
// ---------------------------------------------------------------------------

export class FastbootDevice {
  constructor(transport, { logger = () => {}, responseTimeoutMs = 20000 } = {}) {
    this.transport = transport;
    this.logger = logger;
    this.responseTimeoutMs = responseTimeoutMs;
    this.chain = Promise.resolve();
    this.maxDownloadSize = 0;
  }

  log(msg, type = 'info') { this.logger(msg, type); }

  async open() {
    if (this.transport.open) await this.transport.open();
    // max-download-size caps how much we can send in one download; older
    // bootloaders don't report it, so fall back to a safe 256 MiB.
    try {
      const v = await this.getVar('max-download-size');
      this.maxDownloadSize = parseInt(v, v.startsWith('0x') ? 16 : 10) || 0;
    } catch (e) { this.maxDownloadSize = 0; }
    if (!this.maxDownloadSize) this.maxDownloadSize = 256 * 1024 * 1024;
    return this;
  }

  /**
   * Read response packets until a terminal OKAY/FAIL/DATA, collecting INFO/TEXT
   * as progress. Returns { tag, payload, info: [...] }.
   */
  async _readUntilTerminal(command, onInfo) {
    const info = [];
    const deadline = Date.now() + this.responseTimeoutMs;
    for (;;) {
      if (Date.now() > deadline) throw new FastbootError(`Timed out waiting for a reply to "${command}".`, command);
      const bytes = await this.transport.read(256);
      if (!bytes.length) continue;
      const { tag, payload } = parseResponse(bytes);
      if (tag === 'INFO' || tag === 'TEXT') {
        info.push(payload);
        onInfo?.(payload);
        this.log(`(bootloader) ${payload}`, 'info');
        continue;
      }
      return { tag, payload, info };
    }
  }

  // Run commands strictly one at a time (shared bulk pipe).
  _serialize(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(() => {}, () => {});
    return run;
  }

  /** Send one command and resolve its payload, or throw on FAIL. */
  command(cmd, { onInfo } = {}) {
    return this._serialize(async () => {
      const bytes = te.encode(cmd);
      if (bytes.length > 64) throw new FastbootError(`Command "${cmd.slice(0, 20)}..." exceeds 64 bytes.`, cmd);
      await this.transport.write(bytes);
      const r = await this._readUntilTerminal(cmd, onInfo);
      if (r.tag === 'FAIL') throw new FastbootError(r.payload || 'command failed', cmd);
      if (r.tag === 'DATA') throw new FastbootError(`Device unexpectedly asked to transfer ${r.payload} bytes for "${cmd}".`, cmd);
      return { payload: r.payload, info: r.info };
    });
  }

  async getVar(name) {
    const { payload } = await this.command(`getvar:${name}`);
    return payload;
  }

  /**
   * getvar:all — the device streams every variable as INFO lines of the form
   * "name:value" (or "name[i]:value"). Returns an object plus the raw lines.
   */
  async getAllVars() {
    const vars = {};
    const lines = [];
    await this.command('getvar:all', {
      onInfo: (line) => {
        lines.push(line);
        // Variable names themselves contain colons (partition-type:boot:raw),
        // so the value is after the LAST colon, the name is everything before.
        const idx = line.lastIndexOf(':');
        if (idx > 0) vars[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
    });
    return { vars, lines };
  }

  /**
   * Upload `data` into the device's download buffer. The device first answers
   * DATA<size>; the host then streams exactly that many bytes, then reads OKAY.
   */
  download(data, onProgress) {
    return this._serialize(async () => {
      if (data.length > this.maxDownloadSize) {
        throw new FastbootError(`Image is ${data.length} bytes but the bootloader's max-download-size is ${this.maxDownloadSize}. Flash a smaller image or use a sparse image.`);
      }
      await this.transport.write(te.encode(`download:${hex8(data.length)}`));
      const first = await this._readUntilTerminal('download');
      if (first.tag === 'FAIL') throw new FastbootError(first.payload || 'download rejected', 'download');
      if (first.tag !== 'DATA') throw new FastbootError(`Expected DATA, got ${first.tag}.`, 'download');
      const expected = parseInt(first.payload, 16);
      if (expected !== data.length) throw new FastbootError(`Bootloader wants ${expected} bytes, not ${data.length}.`, 'download');
      // Stream in chunks so progress updates and the USB stack stays happy.
      const chunk = 1024 * 1024;
      for (let off = 0; off < data.length; off += chunk) {
        await this.transport.write(data.subarray(off, Math.min(off + chunk, data.length)));
        onProgress?.(Math.min(off + chunk, data.length) / data.length);
      }
      if (data.length === 0) onProgress?.(1);
      const done = await this._readUntilTerminal('download');
      if (done.tag !== 'OKAY') throw new FastbootError(done.payload || 'download not acknowledged', 'download');
      return done.payload;
    });
  }

  /** Download an image, then flash it to a partition. */
  async flash(partition, data, { onProgress, onInfo } = {}) {
    this.log(`Downloading ${data.length} bytes...`, 'info');
    await this.download(data, (p) => onProgress?.({ phase: 'download', percent: Math.round(p * 100) }));
    this.log(`Flashing ${partition}...`, 'info');
    const r = await this.command(`flash:${partition}`, { onInfo });
    this.log(`Flashed ${partition}.`, 'ok');
    return r.payload;
  }

  erase(partition) { return this.command(`erase:${partition}`).then((r) => r.payload); }
  setActiveSlot(slot) { return this.command(`set_active:${slot}`).then((r) => r.payload); }

  reboot(target = '') {
    // target: '' (system), 'bootloader', 'fastboot' (userspace fastbootd), 'recovery'
    const cmd = target ? `reboot-${target}` : 'reboot';
    return this.command(cmd).then((r) => r.payload).catch((e) => {
      // Many devices drop the USB link as they reboot before sending OKAY.
      if (/IN|OUT|transfer|disconnect|No device/i.test(e.message)) return 'rebooting';
      throw e;
    });
  }

  /**
   * Request a bootloader unlock. The phone shows its own confirmation screen;
   * the user must approve it with the hardware keys. This WIPES user data.
   * Tries the modern `flashing unlock` then the legacy `oem unlock`.
   */
  async unlock({ critical = false } = {}) {
    const cmd = critical ? 'flashing unlock_critical' : 'flashing unlock';
    const msg = (r) => r.info.join(' ').trim() || r.payload || 'Unlock requested — confirm on the device screen.';
    try {
      return await this.command(cmd).then(msg);
    } catch (e) {
      if (critical) throw e;
      return this.command('oem unlock').then(msg);
    }
  }

  async lock() {
    try { return await this.command('flashing lock').then((r) => r.payload); }
    catch (e) { return this.command('oem lock').then((r) => r.payload); }
  }

  /** Download an image and boot it once without flashing (fastboot boot). */
  async bootImage(data, onProgress) {
    await this.download(data, (p) => onProgress?.(Math.round(p * 100)));
    return this.command('boot').then((r) => r.payload).catch((e) => {
      if (/IN|OUT|transfer|disconnect/i.test(e.message)) return 'booting';
      throw e;
    });
  }

  async close() { if (this.transport.close) await this.transport.close(); }
}


/** A short, friendly summary of the common getvar:all fields. */
export function summarizeVars(vars) {
  const pick = (k) => vars[k] ?? vars[k.replace(/-/g, '_')] ?? null;
  return {
    product: pick('product'),
    variant: pick('variant'),
    bootloaderVersion: pick('version-bootloader'),
    basebandVersion: pick('version-baseband'),
    serialno: pick('serialno'),
    secure: pick('secure'),
    unlocked: pick('unlocked'),
    currentSlot: pick('current-slot'),
    maxDownloadSize: pick('max-download-size'),
    partitionTypes: Object.keys(vars).filter((k) => k.startsWith('partition-type:')).map((k) => k.slice('partition-type:'.length))
  };
}
