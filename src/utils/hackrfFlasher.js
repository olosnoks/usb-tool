/**
 * hackrfFlasher.js — first-time setup and firmware flashing for a HackRF One /
 * PortaPack over WebUSB.
 *
 * Writing firmware is the same thing `hackrf_spiflash -w` does: a handful of
 * libhackrf vendor requests against a HackRF that is running *any* HackRF
 * firmware (stock, or a PortaPack switched to HackRF mode):
 *   SPIFLASH_ERASE (18)              chip erase of the 1 MiB W25Q80BV
 *   SPIFLASH_WRITE (12) addr, ≤256 B one page at a time, address in wValue:wIndex
 *   SPIFLASH_READ  (13) addr, ≤256 B read-back for verification
 *   RESET          (22)              reboot into the new firmware
 *
 * A bricked or brand-new board can be started through the LPC43xx ROM DFU
 * bootloader (1fc9:000c, hold DFU while plugging in): the stock
 * hackrf_one_usb.dfu is loaded into RAM with the standard DFU protocol (see
 * dfuDriver.js), the board re-enumerates as a HackRF, and the SPI flash can
 * then be written as above.
 *
 * The SD-card half of a Mayhem install (the COPY_TO_SDCARD zip) is written
 * with the File System Access API into a folder the user picks.
 */
import { parseDfuSuffix, DfuDevice, discoverDfuInterface } from './dfuDriver.js';

export const HACKRF_FLASH_REQ = {
  SET_TRANSCEIVER_MODE: 1,
  SPIFLASH_WRITE: 12,
  SPIFLASH_READ: 13,
  BOARD_ID_READ: 14,
  VERSION_STRING_READ: 15,
  SPIFLASH_ERASE: 18,
  RESET: 22
};

export const HACKRF_SPI_FLASH_BYTES = 1 << 20;   // W25Q80BV: 1 MiB
export const HACKRF_SPI_PAGE = 256;

export const SETUP_USB_IDS = {
  HACKRF: { vid: 0x1d50, pid: 0x6089 },
  JAWBREAKER: { vid: 0x1d50, pid: 0x604b },
  RAD1O: { vid: 0x1d50, pid: 0xcc15 },
  MAYHEM_SERIAL: { vid: 0x1d50, pid: 0x6018 },
  LPC43XX_DFU: { vid: 0x1fc9, pid: 0x000c }
};

const BOARD_NAMES = ['Jellybean', 'Jawbreaker', 'HackRF One', 'rad1o', 'HackRF One r9', 'HackRF Pro'];

/** What a USB VID:PID means for the setup flow. */
export function classifyUsbDevice(vid, pid) {
  if (vid === 0x1fc9 && pid === 0x000c) return 'lpc-dfu';
  if (vid === 0x1d50 && pid === 0x6018) return 'mayhem-serial';
  if (vid === 0x1d50 && (pid === 0x6089 || pid === 0x604b || pid === 0xcc15)) return 'hackrf';
  return 'unknown';
}

/**
 * Sanity-check an SPI flash image. Errors block the flash; warnings are shown.
 * HackRF / Mayhem SPI images start with the LPC43xx boot header (0x1A 0x3F).
 */
export function validateSpiImage(bytes) {
  const errors = [], warnings = [];
  let unrecognised = false;
  if (!bytes || !bytes.length) errors.push('The image is empty.');
  else if (bytes.length > HACKRF_SPI_FLASH_BYTES) errors.push(`The image is ${bytes.length} bytes; the HackRF SPI flash holds ${HACKRF_SPI_FLASH_BYTES} (1 MiB).`);
  if (bytes && bytes.length >= 2 && !(bytes[0] === 0x1a && bytes[1] === 0x3f)) {
    unrecognised = true;
    warnings.push('The first bytes are not the LPC43xx boot header (1A 3F); this does not look like a HackRF / Mayhem SPI image (.bin). A .dfu is for the DFU bootloader step, not the SPI flash.');
  }
  if (bytes && bytes.length > 0 && bytes.length < 64 * 1024) warnings.push('The image is unusually small for a HackRF firmware.');
  // `unrecognised` blocks a flash unless overridden; other warnings are advisory.
  return { ok: errors.length === 0, errors, warnings, unrecognised };
}

export class HackRfSpiFlasher {
  constructor(usbDevice, { log = () => {} } = {}) {
    this.dev = usbDevice;
    this.log = log;
  }

  _out(request, value, index, data) {
    return this.dev.controlTransferOut({ requestType: 'vendor', recipient: 'device', request, value, index }, data);
  }

  _in(request, value, index, length) {
    return this.dev.controlTransferIn({ requestType: 'vendor', recipient: 'device', request, value, index }, length);
  }

  async identify() {
    const out = { firmwareVersion: null, boardId: null, boardName: null };
    try {
      const v = await this._in(HACKRF_FLASH_REQ.VERSION_STRING_READ, 0, 0, 255);
      out.firmwareVersion = v?.data ? new TextDecoder().decode(v.data).replace(/\0/g, '').trim() : null;
    } catch (_) {}
    try {
      const b = await this._in(HACKRF_FLASH_REQ.BOARD_ID_READ, 0, 0, 1);
      if (b?.data?.byteLength) { out.boardId = b.data.getUint8(0); out.boardName = BOARD_NAMES[out.boardId] || `board ${out.boardId}`; }
    } catch (_) {}
    return out;
  }

  /** Leave RX/TX so the firmware is idle before touching the flash. */
  async stopRadio() {
    try { await this._out(HACKRF_FLASH_REQ.SET_TRANSCEIVER_MODE, 0, 0); } catch (_) {}
  }

  async erase() {
    await this._out(HACKRF_FLASH_REQ.SPIFLASH_ERASE, 0, 0);
  }

  async writePage(address, bytes) {
    if (bytes.length > HACKRF_SPI_PAGE) throw new Error(`page write of ${bytes.length} bytes exceeds ${HACKRF_SPI_PAGE}`);
    if (address + bytes.length > HACKRF_SPI_FLASH_BYTES) throw new Error(`write past the end of flash at 0x${address.toString(16)}`);
    const r = await this._out(HACKRF_FLASH_REQ.SPIFLASH_WRITE, (address >> 16) & 0xffff, address & 0xffff, bytes);
    if (r && r.status && r.status !== 'ok') throw new Error(`SPIFLASH_WRITE at 0x${address.toString(16)} returned ${r.status}`);
    if (r && typeof r.bytesWritten === 'number' && r.bytesWritten !== bytes.length) throw new Error(`SPIFLASH_WRITE at 0x${address.toString(16)}: ${r.bytesWritten}/${bytes.length} bytes accepted`);
  }

  async readPage(address, length = HACKRF_SPI_PAGE) {
    const r = await this._in(HACKRF_FLASH_REQ.SPIFLASH_READ, (address >> 16) & 0xffff, address & 0xffff, length);
    if (!r?.data) throw new Error(`SPIFLASH_READ at 0x${address.toString(16)} returned no data`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }

  async reset() {
    // The board drops off the bus as it reboots, so a transfer error here is expected.
    try { await this._out(HACKRF_FLASH_REQ.RESET, 0, 0); } catch (_) {}
  }

  /**
   * Erase, write every page, read everything back, then reset.
   * onProgress({ phase: 'erase'|'write'|'verify'|'reset'|'done', done, total })
   */
  async flash(image, { verify = true, onProgress = () => {}, allowUnrecognised = false } = {}) {
    const bytes = image instanceof Uint8Array ? image : new Uint8Array(image);
    const check = validateSpiImage(bytes);
    if (!check.ok) throw new Error(check.errors.join(' '));
    if (check.unrecognised && !allowUnrecognised) throw new Error(check.warnings[0]);
    const total = bytes.length;
    const pages = Math.ceil(total / HACKRF_SPI_PAGE);

    await this.stopRadio();
    this.log(`Erasing the SPI flash (1 MiB)…`);
    onProgress({ phase: 'erase', done: 0, total });
    await this.erase();

    this.log(`Writing ${total} bytes in ${pages} pages…`);
    for (let p = 0; p < pages; p++) {
      const addr = p * HACKRF_SPI_PAGE;
      await this.writePage(addr, bytes.subarray(addr, Math.min(total, addr + HACKRF_SPI_PAGE)));
      if ((p & 15) === 15 || p === pages - 1) onProgress({ phase: 'write', done: Math.min(total, addr + HACKRF_SPI_PAGE), total });
    }

    let verified = false;
    if (verify) {
      this.log('Reading the flash back to verify…');
      for (let p = 0; p < pages; p++) {
        const addr = p * HACKRF_SPI_PAGE;
        const want = bytes.subarray(addr, Math.min(total, addr + HACKRF_SPI_PAGE));
        const got = await this.readPage(addr, want.length);
        for (let i = 0; i < want.length; i++) {
          if (got[i] !== want[i]) throw new Error(`Verify failed at 0x${(addr + i).toString(16)}: wrote 0x${want[i].toString(16)}, read 0x${(got[i] ?? 0).toString(16)}. Do not unplug; flash again.`);
        }
        if ((p & 15) === 15 || p === pages - 1) onProgress({ phase: 'verify', done: Math.min(total, addr + HACKRF_SPI_PAGE), total });
      }
      verified = true;
    }

    onProgress({ phase: 'reset', done: total, total });
    this.log('Resetting the board into the new firmware.');
    await this.reset();
    onProgress({ phase: 'done', done: total, total });
    return { bytes: total, pages, verified };
  }
}

/**
 * Load a HackRF RAM image (hackrf_one_usb.dfu) into a board sitting in the
 * LPC43xx ROM DFU bootloader. The board then re-enumerates as a HackRF running
 * from RAM, ready for the SPI flash write.
 */
export async function dfuBootRamImage(usbDevice, dfuBytes, { log = () => {}, onProgress } = {}) {
  const parsed = parseDfuSuffix(dfuBytes);
  if (parsed.present && !parsed.valid) throw new Error('The .dfu file has a DFU suffix with a bad CRC; the download is probably corrupt.');
  const payload = parsed.payload;
  await usbDevice.open();
  if (!usbDevice.configuration) await usbDevice.selectConfiguration(1);
  const info = await discoverDfuInterface(usbDevice);
  if (!info) throw new Error('The device exposes no DFU interface. Hold the DFU button while plugging the HackRF in, then try again.');
  await usbDevice.claimInterface(info.interfaceNumber);
  const dfu = new DfuDevice(usbDevice, info.interfaceNumber, { transferSize: info.transferSize || 2048, log });
  log(`DFU interface ${info.interfaceNumber}, ${info.transferSize || 2048}-byte blocks; sending ${payload.length} bytes to RAM.`);
  try {
    await dfu.download(payload, onProgress);
  } catch (e) {
    // The ROM jumps to the image as soon as the download completes and the
    // device vanishes; errors in the final status poll are expected.
    log(`DFU finished with "${e.message}" (normal if the board rebooted into the image).`);
  }
  try { await usbDevice.close(); } catch (_) {}
  return { bytes: payload.length };
}

// ---- release discovery (GitHub) -------------------------------------------

export const FIRMWARE_SOURCES = {
  mayhem: { id: 'mayhem', label: 'PortaPack Mayhem', repo: 'portapack-mayhem/mayhem-firmware' },
  hackrf: { id: 'hackrf', label: 'Stock HackRF (Great Scott Gadgets)', repo: 'greatscottgadgets/hackrf' }
};

export async function fetchGithubReleases(repo, { perPage = 10, fetchImpl = (typeof fetch !== 'undefined' ? fetch : null) } = {}) {
  if (!fetchImpl) throw new Error('fetch is not available');
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=${perPage}`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}${res.status === 403 ? ' (rate limit: try again in a few minutes)' : ''}`);
  const list = await res.json();
  return list.map((r) => ({
    tag: r.tag_name, name: r.name || r.tag_name, publishedAt: r.published_at, prerelease: !!r.prerelease,
    url: r.html_url,
    assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url }))
  }));
}

/** Pick the useful assets out of a release's asset list. */
export function pickReleaseAssets(assets = []) {
  const find = (re) => assets.find((a) => re.test(a.name)) || null;
  return {
    firmwareZip: find(/_FIRMWARE\.zip$/i) || find(/^hackrf-\d{4}\.\d{2}\.\d+\.zip$/i),
    sdcardZip: find(/COPY_TO_SDCARD\.zip$/i),
    ppfw: find(/\.ppfw\.tar$/i)
  };
}

/** From a list of zip entry names, the SPI image (.bin) and the RAM image (.dfu). */
export function pickImagesFromZip(names = []) {
  const bin = names.find((n) => /portapack.*mayhem.*\.bin$/i.test(n))
    || names.find((n) => /mayhem.*\.bin$/i.test(n))
    || names.find((n) => /hackrf_one_usb\.bin$/i.test(n))
    || names.find((n) => /\.bin$/i.test(n) && !/cpld|xsvf/i.test(n))
    || null;
  const dfu = names.find((n) => /hackrf_one_usb\.dfu$/i.test(n)) || names.find((n) => /\.dfu$/i.test(n)) || null;
  return { bin, dfu };
}

/**
 * Normalise zip entry paths for the SD card: drop a single wrapping folder
 * (e.g. "sdcard/" or "mayhem_v2.1.0_COPY_TO_SDCARD/") and skip junk.
 */
export function sdcardEntryPaths(names = []) {
  const files = names.filter((n) => n && !n.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/i.test(n));
  const tops = new Set(files.map((n) => n.split('/')[0]));
  let strip = '';
  if (tops.size === 1) {
    const only = [...tops][0];
    if (files.every((n) => n.includes('/')) && /sdcard|copy_to/i.test(only)) strip = only + '/';
  }
  return files.map((n) => ({ entry: n, path: strip ? n.slice(strip.length) : n }));
}

/** Write zip entries (JSZip instance) into a directory handle (File System Access API). */
export async function copyZipToDirectory(zip, dirHandle, { onProgress = () => {} } = {}) {
  const list = sdcardEntryPaths(Object.keys(zip.files));
  let done = 0, bytes = 0;
  for (const { entry, path } of list) {
    const parts = path.split('/').filter(Boolean);
    const fileName = parts.pop();
    let dir = dirHandle;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
    const data = await zip.file(entry).async('uint8array');
    const fh = await dir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
    bytes += data.length; done++;
    onProgress({ done, total: list.length, path, bytes });
  }
  return { files: done, bytes };
}
