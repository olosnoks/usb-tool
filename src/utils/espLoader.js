/**
 * Web Serial ESP8266 / ESP32-family ROM bootloader client.
 *
 * Request/response, like esptool in ROM mode (no stub): every command waits
 * for the chip's reply and checks its status, so a failed sync, erase or
 * write is an error instead of a "success" log line. Steps:
 *   reset into the bootloader (classic DTR/RTS or USB-Serial/JTAG sequence)
 *   -> SYNC until the ROM answers -> read the chip-detect register
 *   -> SPI_ATTACH + SPI_SET_PARAMS (ESP32 family) -> per image:
 *   FLASH_BEGIN (erase, timeout scaled by size) -> FLASH_DATA blocks
 *   -> SPI_FLASH_MD5 verify (not on ESP8266: its ROM has no MD5 command)
 *   -> hard reset into the app.
 * Protocol reference: esptool.py / esptool-js (Espressif, Apache-2.0).
 */
import CryptoJS from 'crypto-js';

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

const ROM_ERRORS = {
  0x05: 'invalid message', 0x06: 'failed to act on message', 0x07: 'invalid CRC',
  0x08: 'flash write error', 0x09: 'flash read error', 0x0a: 'flash read length error', 0x0b: 'deflate error'
};

const ROM_BLOCK_SIZE = 0x400;          // FLASH_WRITE_SIZE in ROM mode
const FLASH_SECTOR = 0x1000;
const ERASE_MS_PER_MB = 30000;         // esptool ERASE_REGION_TIMEOUT_PER_MB
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

export class EspBootloaderClient {
  constructor(port, logger) {
    this.port = port;
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

  async _prepareFlash() {
    if (this.isEsp8266) return;
    await this.command(ESP_CMD.SPI_ATTACH, u32(0, 0));
    // id, total size (16 MB: let the ROM accept any offset), block 64 KB, sector 4 KB, page 256, status mask
    await this.command(ESP_CMD.SPI_SET_PARAMS, u32(0, 16 * 1024 * 1024, 0x10000, FLASH_SECTOR, 0x100, 0xffff));
  }

  /** Reset into the ROM, sync, identify the chip and attach SPI flash. */
  async connect(resetDurationMs, bootHoldDurationMs, syncRetries = 8) {
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

  /**
   * Write one image and verify it.
   * @param {Uint8Array} binaryData
   * @param {number} flashOffset
   * @param {number} blockSize  clamped to the ROM's 1 KB write size
   * @param {function} onProgress (percent, written, total, block, blocks)
   * @param {boolean} rebootAfter
   */
  async flashPartition(binaryData, flashOffset = 0x10000, blockSize = ROM_BLOCK_SIZE, onProgress, rebootAfter = true) {
    await this._ensurePrepared();
    const bs = Math.min(blockSize || ROM_BLOCK_SIZE, ROM_BLOCK_SIZE);
    // Pad to a 4-byte multiple, as esptool does.
    const pad4 = (4 - (binaryData.length % 4)) % 4;
    const image = new Uint8Array(binaryData.length + pad4);
    image.set(binaryData); image.fill(0xff, binaryData.length);
    const blocks = Math.ceil(image.length / bs);
    const eraseSize = this.isEsp8266 ? esp8266EraseSize(flashOffset, image.length) : image.length;
    const mb = image.length / (1024 * 1024);

    this.log(`Erasing ${image.length} bytes at 0x${flashOffset.toString(16)}...`);
    const begin = this.isEsp8266 || this.chip === 'ESP32'
      ? u32(eraseSize, blocks, bs, flashOffset)
      : u32(eraseSize, blocks, bs, flashOffset, 0);   // newer ROMs take an "encrypted" word
    await this.command(ESP_CMD.FLASH_BEGIN, begin, 0, Math.max(3000, ERASE_MS_PER_MB * Math.max(mb, 0.1)));

    for (let seq = 0; seq < blocks; seq++) {
      const block = new Uint8Array(bs).fill(0xff);
      block.set(image.subarray(seq * bs, Math.min((seq + 1) * bs, image.length)));
      const payload = new Uint8Array(16 + bs);
      payload.set(u32(bs, seq, 0, 0));
      payload.set(block, 16);
      await this.command(ESP_CMD.FLASH_DATA, payload, espChecksum(block), 5000);
      const written = Math.min((seq + 1) * bs, binaryData.length);
      if (onProgress) onProgress(Math.min(100, Number((((seq + 1) / blocks) * 100).toFixed(1))), written, binaryData.length, seq + 1, blocks);
    }

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

  async flashMultiplePartitions(partitions, blockSize = ROM_BLOCK_SIZE, onProgress) {
    if (!partitions || partitions.length === 0) throw new Error('No partitions specified for flashing.');
    const totalAllBytes = partitions.reduce((sum, p) => sum + p.data.length, 0);
    let bytesWrittenPrior = 0;
    for (let i = 0; i < partitions.length; i++) {
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
      }, false);
      bytesWrittenPrior += part.data.length;
    }
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
