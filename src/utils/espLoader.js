/**
 * Web Serial ESP8266 / ESP32-family ROM bootloader client.
 *
 * Request/response, like esptool in ROM mode (no stub): every command waits
 * for the chip's reply and checks its status, so a failed sync, erase or
 * write is an error instead of a "success" log line. Steps:
 *   reset into the bootloader (classic DTR/RTS or USB-Serial/JTAG sequence)
 *   -> SYNC until the ROM answers -> read the chip-detect register
 *   -> optional CHANGE_BAUDRATE (port reopened, re-sync; falls back to 115200)
 *   -> SPI_ATTACH, JEDEC flash-size detection, SPI_SET_PARAMS (ESP32 family)
 *   -> per image: FLASH_BEGIN (erase, timeout scaled by size) -> FLASH_DATA
 *   blocks, or FLASH_DEFL_BEGIN/DATA/END with a zlib stream (ESP32 family)
 *   -> SPI_FLASH_MD5 verify (not on ESP8266: its ROM has no MD5 command)
 *   -> hard reset into the app.
 * Protocol reference: esptool.py / esptool-js (Espressif, Apache-2.0).
 */
import CryptoJS from 'crypto-js';
import { deflate } from 'pako';

export const ESP_CMD = {
  FLASH_BEGIN: 0x02,
  FLASH_DATA: 0x03,
  FLASH_END: 0x04,
  MEM_BEGIN: 0x05,
  MEM_END: 0x06,
  MEM_DATA: 0x07,
  SYNC: 0x08,
  WRITE_REG: 0x09,
  READ_REG: 0x0a,
  SPI_SET_PARAMS: 0x0b,
  SPI_ATTACH: 0x0d,
  CHANGE_BAUDRATE: 0x0f,
  FLASH_DEFL_BEGIN: 0x10,
  FLASH_DEFL_DATA: 0x11,
  FLASH_DEFL_END: 0x12,
  SPI_FLASH_MD5: 0x13,
  READ_FLASH_SLOW: 0x0e
};

// SLIP special delimiters
const SLIP_DELIMITER = 0xC0;
const SLIP_ESC = 0xDB;
const SLIP_ESC_DELIM = 0xDC;
const SLIP_ESC_ESC = 0xDD;

export function slipEncode(data) {
  const result = [SLIP_DELIMITER];
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === SLIP_DELIMITER) result.push(SLIP_ESC, SLIP_ESC_DELIM);
    else if (b === SLIP_ESC) result.push(SLIP_ESC, SLIP_ESC_ESC);
    else result.push(b);
  }
  result.push(SLIP_DELIMITER);
  return new Uint8Array(result);
}

export function slipDecode(data) {
  const result = [];
  let inEscape = false;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === SLIP_DELIMITER) continue;
    if (inEscape) {
      if (b === SLIP_ESC_DELIM) result.push(SLIP_DELIMITER);
      else if (b === SLIP_ESC_ESC) result.push(SLIP_ESC);
      else result.push(b);
      inEscape = false;
    } else if (b === SLIP_ESC) {
      inEscape = true;
    } else {
      result.push(b);
    }
  }
  return new Uint8Array(result);
}

export function espChecksum(data) {
  let chk = 0xEF;
  for (let i = 0; i < data.length; i++) chk ^= data[i];
  return chk;
}

export function buildEspCommand(opCode, data = new Uint8Array(0), checksum = 0) {
  const packet = new Uint8Array(8 + data.length);
  packet[0] = 0x00;                       // direction: host -> chip
  packet[1] = opCode;
  packet[2] = data.length & 0xff;
  packet[3] = (data.length >> 8) & 0xff;
  packet[4] = checksum & 0xff;
  packet[5] = (checksum >> 8) & 0xff;
  packet[6] = (checksum >> 16) & 0xff;
  packet[7] = (checksum >> 24) & 0xff;
  if (data.length > 0) packet.set(data, 8);
  return slipEncode(packet);
}

const u32 = (...words) => {
  const b = new Uint8Array(words.length * 4);
  const v = new DataView(b.buffer);
  words.forEach((w, i) => v.setUint32(i * 4, w >>> 0, true));
  return b;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CHIP_DETECT_MAGIC_REG (0x40001000) values from esptool. Chips newer than
// these (C5, P4, ...) return other values and are treated as ESP32-family.
const CHIP_MAGIC = {
  0xfff0c101: 'ESP8266',
  0x00f01d83: 'ESP32',
  0x000007c6: 'ESP32-S2',
  0x00000009: 'ESP32-S3',
  0x6921506f: 'ESP32-C3', 0x1b31506f: 'ESP32-C3', 0x4881606f: 'ESP32-C3', 0x4361606f: 'ESP32-C3',
  0x6f51306f: 'ESP32-C2', 0x7c41a06f: 'ESP32-C2',
  0x2ce0806f: 'ESP32-C6',
  0xd7b73e80: 'ESP32-H2'
};
export const CHIP_DETECT_MAGIC_REG = 0x40001000;

// SPI0/1 host registers used to read the JEDEC id (esptool run_spiflash_command).
// ESP8266 is intentionally absent: its ROM stays at 115200 with no detection.
const SPI_LAYOUT_NEW = { usr: 0x18, usr2: 0x20, mosiDlen: 0x24, misoDlen: 0x28, w0: 0x58 };
export const SPI_REGS = {
  'ESP32': { base: 0x3ff42000, usr: 0x1c, usr2: 0x24, mosiDlen: 0x28, misoDlen: 0x2c, w0: 0x80 },
  'ESP32-S2': { base: 0x3f402000, ...SPI_LAYOUT_NEW },
  'ESP32-S3': { base: 0x60002000, ...SPI_LAYOUT_NEW },
  'ESP32-C3': { base: 0x60002000, ...SPI_LAYOUT_NEW },
  'ESP32-C2': { base: 0x60002000, ...SPI_LAYOUT_NEW },
  'ESP32-C6': { base: 0x60003000, ...SPI_LAYOUT_NEW },
  'ESP32-H2': { base: 0x60003000, ...SPI_LAYOUT_NEW }
};
const SPI_CMD_USR = 1 << 18;
const SPI_USR_COMMAND = 1 << 31;
const SPI_USR_MISO = 1 << 28;

/** JEDEC capacity byte -> flash size in bytes (0x12 = 256 KB ... 0x1c = 256 MB), else null. */
export function flashSizeFromJedec(jedecId) {
  const cap = (jedecId >>> 16) & 0xff;
  return cap >= 0x12 && cap <= 0x1c ? 2 ** cap : null;
}

const ROM_ERRORS = {
  0x05: 'invalid message', 0x06: 'failed to act on message', 0x07: 'invalid CRC',
  0x08: 'flash write error', 0x09: 'flash read error', 0x0a: 'flash read length error', 0x0b: 'deflate error'
};

const ROM_BLOCK_SIZE = 0x400;          // FLASH_WRITE_SIZE in ROM mode
const FLASH_SECTOR = 0x1000;
const ERASE_MS_PER_MB = 40000;         // esptool ERASE_REGION_TIMEOUT_PER_MB (40 s per 1e6 bytes; the ROM erases up front)
const MD5_MS_PER_MB = 8000;            // esptool MD5_TIMEOUT_PER_MB

function md5Hex(bytes) {
  return CryptoJS.MD5(CryptoJS.lib.WordArray.create(bytes)).toString();
}

// ESP8266 ROM erases too much in FLASH_BEGIN; esptool's workaround.
function esp8266EraseSize(offset, size) {
  const sectorsPerBlock = 16;
  const numSectors = Math.floor((size + FLASH_SECTOR - 1) / FLASH_SECTOR);
  const startSector = Math.floor(offset / FLASH_SECTOR);
  let headSectors = sectorsPerBlock - (startSector % sectorsPerBlock);
  if (numSectors < headSectors) headSectors = numSectors;
  if (numSectors < 2 * headSectors) return Math.floor((numSectors + 1) / 2) * FLASH_SECTOR;
  return (numSectors - headSectors) * FLASH_SECTOR;
}

/** Thrown when a flash is cancelled through an AbortSignal. */
export class FlashAbortedError extends Error {
  constructor(msg = 'Flash aborted by user.') { super(msg); this.name = 'FlashAbortedError'; this.aborted = true; }
}

export class EspBootloaderClient {
  /**
   * @param {object} port  Web Serial port
   * @param {function} logger
   * @param {object} [opts]
   * @param {boolean} [opts.compress=false] use FLASH_DEFL_* (zlib) writes on the ESP32 family
   */
  constructor(port, logger, opts = {}) {
    this.port = port;
    this.compress = !!opts.compress;
    this.baud = 115200;           // current host-side rate
    this.flashSize = null;        // bytes, from the JEDEC id; null = unknown
    this._resetTimings = [100, 50];
    this.logger = logger || console.log;
    this.reader = null;
    this.writer = null;
    this.readLoop = null;
    this.rx = [];                 // bytes not yet framed
    this.frames = [];             // decoded response frames
    this.waiter = null;           // resolves when new frames arrive
    this.chip = null;             // e.g. 'ESP32-S3'
    this.isEsp8266 = false;
  }

  log(msg, type = 'sys') {
    this.logger(`[ESP LOADER] ${msg}`, type);
  }

  // ---- transport ----
  _startReading() {
    if (this.reader || !this.port.readable) return;
    this.reader = this.port.readable.getReader();
    const reader = this.reader;
    this.readLoop = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this._ingest(value);
        }
      } catch (e) { /* cancelled */ }
      finally { try { reader.releaseLock(); } catch (e) { /* ignore */ } }
    })();
  }

  _ingest(bytes) {
    for (const b of bytes) this.rx.push(b);
    // Split on SLIP delimiters; anything outside frames (boot log text) is dropped.
    let start = this.rx.indexOf(SLIP_DELIMITER);
    while (start >= 0) {
      const end = this.rx.indexOf(SLIP_DELIMITER, start + 1);
      if (end < 0) { this.rx = this.rx.slice(start); break; }
      const body = this.rx.slice(start + 1, end);
      this.rx = this.rx.slice(end);              // keep the closing 0xC0 as the next opener
      if (body.length >= 8) this.frames.push(slipDecode(Uint8Array.from(body)));
      start = 0;
    }
    if (start < 0) this.rx = [];
    if (this.rx.length > 1 << 20) this.rx = [];
    if (this.waiter) { const w = this.waiter; this.waiter = null; w(); }
  }

  async _write(bytes) {
    if (!this.writer) this.writer = this.port.writable.getWriter();
    await this.writer.write(bytes);
  }

  /** Wait for the response to `op`. Returns { value, data }. Throws on timeout or an error status. */
  async _response(op, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      while (this.frames.length) {
        const f = this.frames.shift();
        if (f[0] !== 0x01 || f[1] !== op) continue;           // not ours (e.g. extra SYNC replies)
        const size = f[2] | (f[3] << 8);
        const value = (f[4] | (f[5] << 8) | (f[6] << 16) | (f[7] << 24)) >>> 0;
        const data = f.subarray(8, 8 + size);
        const statusLen = this.isEsp8266 ? 2 : 4;
        if (data.length >= 2) {
          const sIdx = data.length >= statusLen ? data.length - statusLen : 0;
          if (data[sIdx] !== 0) {
            const code = data[sIdx + 1];
            throw new Error(`chip rejected command 0x${op.toString(16)}: ${ROM_ERRORS[code] || 'error 0x' + code.toString(16)}`);
          }
          return { value, data: data.subarray(0, sIdx) };
        }
        return { value, data };
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no reply to command 0x${op.toString(16)} within ${Math.round(timeoutMs / 1000)} s`);
      await Promise.race([new Promise((r) => { this.waiter = r; }), sleep(Math.min(left, 100))]);
    }
  }

  async command(op, data = new Uint8Array(0), checksum = 0, timeoutMs = 3000) {
    this._startReading();
    await this._write(buildEspCommand(op, data, checksum));
    return this._response(op, timeoutMs);
  }

  // ---- reset sequences ----
  get _isUsbJtag() {
    const info = this.port.getInfo ? this.port.getInfo() : {};
    return info.usbVendorId === 0x303a && info.usbProductId === 0x1001;
  }

  /** Into the ROM bootloader: classic DTR/RTS auto-reset, or the USB-Serial/JTAG sequence. */
  async hardwareResetToBootloader(resetDurationMs = 100, bootHoldDurationMs = 50) {
    if (!this.port.setSignals) return;
    const set = (s) => this.port.setSignals(s);
    if (this._isUsbJtag) {
      this.log('Resetting into the bootloader (USB-Serial/JTAG sequence)...');
      await set({ requestToSend: false, dataTerminalReady: false }); await sleep(100);
      await set({ dataTerminalReady: true }); await set({ requestToSend: false }); await sleep(100);
      await set({ requestToSend: true }); await set({ dataTerminalReady: false }); await set({ requestToSend: true }); await sleep(100);
      await set({ dataTerminalReady: false }); await set({ requestToSend: false });
    } else {
      this.log(`Resetting into the bootloader (DTR/RTS, ${resetDurationMs} ms EN, ${bootHoldDurationMs} ms IO0)...`);
      await set({ dataTerminalReady: false, requestToSend: true }); await sleep(resetDurationMs);   // EN low
      await set({ dataTerminalReady: true, requestToSend: false }); await sleep(bootHoldDurationMs); // EN high, IO0 low
      await set({ dataTerminalReady: false, requestToSend: false });
    }
    await sleep(50);
  }

  /** Hard reset into the flashed application. */
  async hardwareResetToApp() {
    if (!this.port.setSignals) return;
    this.log('Resetting the chip to run the application...');
    await this.port.setSignals({ dataTerminalReady: false, requestToSend: true });
    await sleep(this._isUsbJtag ? 200 : 100);
    await this.port.setSignals({ requestToSend: false });
    await sleep(50);
  }

  // ---- ROM session ----
  /** SYNC until the ROM answers. Throws if it never does. */
  async sync(maxRetries = 8) {
    this._startReading();
    const syncData = new Uint8Array(36);
    syncData.set([0x07, 0x07, 0x12, 0x20]);
    syncData.fill(0x55, 4);
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.frames = [];
      try {
        await this.command(ESP_CMD.SYNC, syncData, 0, 150);
        await sleep(100);
        this.frames = [];                     // the ROM sends several SYNC replies; drop the rest
        this.log(`ROM bootloader answered (sync attempt ${attempt}).`);
        return true;
      } catch (e) {
        if (/rejected/.test(e.message)) throw e;
      }
    }
    throw new Error('The chip did not answer SYNC. Check that it is an ESP chip, the port and cable, and hold BOOT (IO0) while resetting if auto-reset does not work.');
  }

  async detectChip() {
    const { value } = await this.command(ESP_CMD.READ_REG, u32(CHIP_DETECT_MAGIC_REG));
    this.chip = CHIP_MAGIC[value] || `ESP32-family (magic 0x${value.toString(16)})`;
    this.isEsp8266 = this.chip === 'ESP8266';
    this.log(`Chip: ${this.chip}`);
    return this.chip;
  }

  async writeReg(address, value, mask = 0xffffffff, delayUs = 0) {
    await this.command(ESP_CMD.WRITE_REG, u32(address, value, mask, delayUs));
  }

  /** Read the 24-bit JEDEC id (0x9F) through the SPI host registers; null if this chip isn't mapped or reads nothing. */
  async readFlashJedec() {
    const r = SPI_REGS[this.chip];
    if (!r) return null;
    const oldUsr = await this.readReg(r.base + r.usr);
    const oldUsr2 = await this.readReg(r.base + r.usr2);
    await this.writeReg(r.base + r.misoDlen, 24 - 1);
    await this.writeReg(r.base + r.usr, (SPI_USR_COMMAND | SPI_USR_MISO) >>> 0);
    await this.writeReg(r.base + r.usr2, ((7 << 28) | 0x9f) >>> 0);
    await this.writeReg(r.base + r.w0, 0);
    await this.writeReg(r.base, SPI_CMD_USR);
    for (let i = 0; i < 10; i++) {
      if (((await this.readReg(r.base)) & SPI_CMD_USR) === 0) break;
      if (i === 9) throw new Error('SPI flash id read did not finish');
    }
    const id = (await this.readReg(r.base + r.w0)) & 0xffffff;
    await this.writeReg(r.base + r.usr, oldUsr);
    await this.writeReg(r.base + r.usr2, oldUsr2);
    return id === 0 || id === 0xffffff ? null : id;
  }

  async _prepareFlash() {
    if (this.isEsp8266) return;
    await this.command(ESP_CMD.SPI_ATTACH, u32(0, 0));
    this.flashSize = null;
    try {
      const jedec = await this.readFlashJedec();
      this.flashSize = jedec == null ? null : flashSizeFromJedec(jedec);
      if (this.flashSize) this.log(`Flash: JEDEC 0x${jedec.toString(16).padStart(6, '0')}, ${this.flashSize / 1048576} MB.`);
      else this.log('Flash size could not be detected; images are not range-checked against the flash.');
    } catch (e) {
      this.log(`Flash size detection failed (${e.message}); images are not range-checked against the flash.`);
    }
    // id, total size (detected, else 16 MB so the ROM accepts any offset), block 64 KB, sector 4 KB, page 256, status mask
    await this.command(ESP_CMD.SPI_SET_PARAMS, u32(0, this.flashSize || 16 * 1024 * 1024, 0x10000, FLASH_SECTOR, 0x100, 0xffff));
  }

  // ---- baud rate ----
  /** Close and reopen the port at `baudRate` (streams are released first). */
  async _reopen(baudRate) {
    await this.release();
    try { await this.port.close(); } catch (e) { /* already closed */ }
    await this.port.open({ baudRate, bufferSize: 16384 });
    this.rx = []; this.frames = [];
    this.baud = baudRate;
  }

  /**
   * CHANGE_BAUDRATE, reopen the port at the new rate and re-sync. Throws if the
   * chip stops answering (the caller falls back with negotiateBaud()).
   */
  async changeBaud(baudRate) {
    await this.command(ESP_CMD.CHANGE_BAUDRATE, u32(baudRate, 0));
    await sleep(50);
    await this._reopen(baudRate);
    await this.sync(5);
  }

  /**
   * Try to run at `baudRate`. ESP8266 and USB-Serial/JTAG ports stay at 115200.
   * On any failure the port goes back to 115200, the chip is reset into the ROM
   * again and the session continues there. Returns the rate in use.
   */
  async negotiateBaud(baudRate) {
    if (!baudRate || baudRate <= 115200 || this.isEsp8266 || this._isUsbJtag) return this.baud;
    try {
      this.log(`Switching to ${baudRate} baud...`);
      await this.changeBaud(baudRate);
      this.log(`Running at ${baudRate} baud.`);
    } catch (e) {
      this.log(`${baudRate} baud failed (${e.message}); falling back to 115200.`);
      await this._reopen(115200);
      await this.connect(this._resetTimings[0], this._resetTimings[1]);
    }
    return this.baud;
  }

  /** Put the port back at the rate the Terminal expects (call after flashing, before release()). */
  async restoreBaud(baudRate) {
    if (!baudRate || this.baud === baudRate) return;
    await this._reopen(baudRate);
  }

  /** Reset into the ROM, sync, identify the chip and attach SPI flash. */
  async connect(resetDurationMs, bootHoldDurationMs, syncRetries = 8) {
    if (resetDurationMs != null) this._resetTimings = [resetDurationMs, bootHoldDurationMs];
    await this.hardwareResetToBootloader(resetDurationMs, bootHoldDurationMs);
    await this.sync(syncRetries);
    await this.detectChip();
    await this._prepareFlash();
    this._prepared = true;
  }

  async _ensurePrepared() {
    if (this._prepared) return;
    if (!this.chip) await this.detectChip();
    await this._prepareFlash();
    this._prepared = true;
  }

  /** Reject an image that would end past the detected flash. Runs before any erase. */
  _checkFits(offset, length) {
    if (this.flashSize && offset + length > this.flashSize) {
      throw new Error(`Image at 0x${offset.toString(16)} (${length} bytes) ends at 0x${(offset + length).toString(16)}, past the detected ${this.flashSize / 1048576} MB flash. Nothing was erased.`);
    }
  }

  /**
   * Write one image and verify it.
   * @param {Uint8Array} binaryData
   * @param {number} flashOffset
   * @param {number} blockSize  clamped to the ROM's 1 KB write size
   * @param {function} onProgress (percent, written, total, block, blocks)
   * @param {boolean} rebootAfter
   */
  async flashPartition(binaryData, flashOffset = 0x10000, blockSize = ROM_BLOCK_SIZE, onProgress, rebootAfter = true, signal) {
    if (signal?.aborted) throw new FlashAbortedError();
    await this._ensurePrepared();
    const bs = Math.min(blockSize || ROM_BLOCK_SIZE, ROM_BLOCK_SIZE);
    // Pad to a 4-byte multiple, as esptool does.
    const pad4 = (4 - (binaryData.length % 4)) % 4;
    const image = new Uint8Array(binaryData.length + pad4);
    image.set(binaryData); image.fill(0xff, binaryData.length);
    this._checkFits(flashOffset, image.length);
    const mb = image.length / (1024 * 1024);
    const wantDeflate = this.compress && !this.isEsp8266;
    const compressed = wantDeflate ? deflate(image, { level: 9 }) : null;
    // Incompressible data would only add overhead: use the plain path.
    const useDeflate = !!compressed && compressed.length < image.length;
    if (wantDeflate && !useDeflate) this.log('Image does not compress; writing it uncompressed.');
    this.lastWrite = { compressed: useDeflate, bytesSent: 0 };

    if (useDeflate) {
      const blocks = Math.ceil(compressed.length / bs);
      this.log(`Erasing ${image.length} bytes at 0x${flashOffset.toString(16)} (compressed ${image.length} -> ${compressed.length} bytes)...`);
      const eraseBlocks = Math.ceil(image.length / bs);
      const writeSize = eraseBlocks * bs;
      const begin = this.chip === 'ESP32'
        ? u32(writeSize, blocks, bs, flashOffset)
        : u32(writeSize, blocks, bs, flashOffset, 0);
      await this.command(ESP_CMD.FLASH_DEFL_BEGIN, begin, 0, Math.max(3000, ERASE_MS_PER_MB * Math.max(writeSize / 1e6, 0.1)));   // ROM erases the whole region on BEGIN
      for (let seq = 0; seq < blocks; seq++) {
        if (signal?.aborted) throw new FlashAbortedError(`Flash aborted by user after ${seq} of ${blocks} blocks.`);
        const block = compressed.subarray(seq * bs, Math.min((seq + 1) * bs, compressed.length));   // last block is not padded
        const payload = new Uint8Array(16 + block.length);
        payload.set(u32(block.length, seq, 0, 0));
        payload.set(block, 16);
        await this.command(ESP_CMD.FLASH_DEFL_DATA, payload, espChecksum(block), 5000);
        this.lastWrite.bytesSent += block.length;
        // Progress is reported in uncompressed bytes so the bar matches the image size.
        const frac = (seq + 1) / blocks;
        const written = Math.min(Math.round(frac * binaryData.length), binaryData.length);
        if (onProgress) onProgress(Math.min(100, Number((frac * 100).toFixed(1))), written, binaryData.length, seq + 1, blocks);
      }
      // esptool does not send FLASH_DEFL_END to the ROM when it is to stay in the loader
      // (flag 1 = do not reboot): the ROM treats it as leaving the bootloader. The ROM has
      // already written every block, and the MD5 check below confirms it. A reboot is a
      // hardware reset, not a FLASH_DEFL_END(0).
    } else {
      const blocks = Math.ceil(image.length / bs);
      const eraseSize = this.isEsp8266 ? esp8266EraseSize(flashOffset, image.length) : image.length;

      this.log(`Erasing ${image.length} bytes at 0x${flashOffset.toString(16)}...`);
      const begin = this.isEsp8266 || this.chip === 'ESP32'
        ? u32(eraseSize, blocks, bs, flashOffset)
        : u32(eraseSize, blocks, bs, flashOffset, 0);   // newer ROMs take an "encrypted" word
      await this.command(ESP_CMD.FLASH_BEGIN, begin, 0, Math.max(3000, ERASE_MS_PER_MB * Math.max(mb, 0.1)));

      for (let seq = 0; seq < blocks; seq++) {
        if (signal?.aborted) throw new FlashAbortedError(`Flash aborted by user after ${seq} of ${blocks} blocks.`);
        const block = new Uint8Array(bs).fill(0xff);
        block.set(image.subarray(seq * bs, Math.min((seq + 1) * bs, image.length)));
        const payload = new Uint8Array(16 + bs);
        payload.set(u32(bs, seq, 0, 0));
        payload.set(block, 16);
        await this.command(ESP_CMD.FLASH_DATA, payload, espChecksum(block), 5000);
        this.lastWrite.bytesSent += bs;
        const written = Math.min((seq + 1) * bs, binaryData.length);
        if (onProgress) onProgress(Math.min(100, Number((((seq + 1) / blocks) * 100).toFixed(1))), written, binaryData.length, seq + 1, blocks);
      }
    }

    if (signal?.aborted) throw new FlashAbortedError();
    if (this.isEsp8266) {
      this.log('Written (the ESP8266 ROM cannot report an MD5, so this image is not verified).');
    } else {
      const { data } = await this.command(ESP_CMD.SPI_FLASH_MD5, u32(flashOffset, image.length, 0, 0), 0, Math.max(3000, MD5_MS_PER_MB * Math.max(mb, 0.1)));
      const got = data.length >= 32
        ? new TextDecoder().decode(data.subarray(0, 32)).toLowerCase()
        : Array.from(data.subarray(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const want = md5Hex(image);
      if (got !== want) throw new Error(`verify failed at 0x${flashOffset.toString(16)}: flash MD5 ${got}, image MD5 ${want}`);
      this.log(`Verified 0x${flashOffset.toString(16)} (MD5 ${want}).`);
    }
    if (rebootAfter) await this.hardwareResetToApp();
    return true;
  }

  async flashMultiplePartitions(partitions, blockSize = ROM_BLOCK_SIZE, onProgress, signal) {
    if (!partitions || partitions.length === 0) throw new Error('No partitions specified for flashing.');
    await this._ensurePrepared();
    for (const p of partitions) this._checkFits(p.offset, p.data.length + ((4 - (p.data.length % 4)) % 4));
    const totalAllBytes = partitions.reduce((sum, p) => sum + p.data.length, 0);
    let bytesWrittenPrior = 0;
    for (let i = 0; i < partitions.length; i++) {
      if (signal?.aborted) throw new FlashAbortedError();
      const part = partitions[i];
      this.log(`[${i + 1}/${partitions.length}] ${part.label}: ${part.data.length} bytes -> 0x${part.offset.toString(16)}`);
      await this.flashPartition(part.data, part.offset, blockSize, (partPct, partWritten, partTotal, curBlock, totalBlocks) => {
        const overallWritten = bytesWrittenPrior + partWritten;
        if (onProgress) {
          onProgress({
            partitionIndex: i,
            totalPartitions: partitions.length,
            label: part.label,
            partitionPercent: partPct,
            aggregatePercent: totalAllBytes > 0 ? Math.min(100, Number(((overallWritten / totalAllBytes) * 100).toFixed(1))) : partPct,
            writtenBytes: overallWritten,
            totalBytes: totalAllBytes,
            currentBlock: curBlock,
            totalBlocks
          });
        }
      }, false, signal);
      bytesWrittenPrior += part.data.length;
    }
    if (signal?.aborted) throw new FlashAbortedError();
    await this.hardwareResetToApp();
    return true;
  }

  async flashBinary(binaryData, flashOffset = 0x10000, blockSize = ROM_BLOCK_SIZE, onProgress) {
    return this.flashPartition(binaryData, flashOffset, blockSize, onProgress, true);
  }

  /** READ_REG: one 32-bit register. */
  async readReg(address) {
    const { value } = await this.command(ESP_CMD.READ_REG, u32(address));
    return value;
  }

  /**
   * Read flash through the ROM (READ_FLASH_SLOW, 64 bytes per request). Only the
   * ESP8266 and original ESP32 ROMs have this command; newer chips need the
   * esptool stub, which this client doesn't load.
   */
  async readFlashSlow(offset, length, onProgress) {
    await this._ensurePrepared();
    if (!(this.isEsp8266 || this.chip === 'ESP32')) {
      throw new Error(`${this.chip} ROM cannot read flash: reading needs the esptool stub flasher, which isn't supported here yet. Use esptool.py read_flash.`);
    }
    const out = new Uint8Array(length);
    for (let pos = 0; pos < length; pos += 64) {
      const n = Math.min(64, length - pos);
      const { data } = await this.command(ESP_CMD.READ_FLASH_SLOW, u32(offset + pos, n), 0, 3000);
      if (data.length < n) throw new Error(`short flash read at 0x${(offset + pos).toString(16)} (${data.length} of ${n} bytes)`);
      out.set(data.subarray(0, n), pos);
      if (onProgress) onProgress(Math.min(100, Number((((pos + n) / length) * 100).toFixed(1))), pos + n, length);
    }
    return out;
  }

  /** Stop reading and release both stream locks (the port stays open). */
  async release() {
    if (this.reader) {
      try { await this.reader.cancel(); } catch (e) { /* ignore */ }
      try { if (this.readLoop) await this.readLoop; } catch (e) { /* ignore */ }
      try { this.reader.releaseLock(); } catch (e) { /* ignore */ }
      this.reader = null; this.readLoop = null;
    }
    if (this.writer) {
      try { this.writer.releaseLock(); } catch (e) { /* ignore */ }
      this.writer = null;
    }
  }
}
