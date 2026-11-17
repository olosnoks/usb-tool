/**
 * AVR ISP programmer driver.
 *
 * Real hardware: an Arduino running the ArduinoISP sketch (or any STK500v1
 * programmer) on a serial port. The programmer talks SPI to the target AVR;
 * this driver speaks STK500v1 to the programmer: sync, enter programming
 * mode, universal SPI commands for signature / fuses / lock bits / chip erase,
 * and page-wise flash writes with read-back verification.
 *
 * Simulation: a virtual ATmega328P for exploring the interface.
 */

import { SerialLink } from './serialLink';
import { AVR_CHIP_DATABASE, eepromAfterErase } from './avrChipDatabase';

export { AVR_CHIP_DATABASE, eepromAfterErase };

/**
 * Fuse values that would cut off ISP programming. Returns a list of plain
 * explanations; empty means the values are safe to write over ISP.
 */
export function fuseHazards(chip, fuses) {
  const out = [];
  const g = chip?.guard || {};
  if (g.spien && (fuses[g.spien[0]] & g.spien[1])) out.push('SPIEN would be unprogrammed: serial (ISP) programming gets disabled and only a high-voltage programmer can recover the chip.');
  if (g.rstdisbl && !(fuses[g.rstdisbl[0]] & g.rstdisbl[1])) out.push('RSTDISBL would be programmed: the reset pin becomes GPIO and ISP stops working.');
  if (g.dwen && !(fuses[g.dwen[0]] & g.dwen[1])) out.push('DWEN would be programmed: debugWIRE takes over the reset pin and ISP stops working until debugWIRE is turned off.');
  return out;
}

// ---- STK500v1 protocol --------------------------------------------------------
export const STK = {
  OK: 0x10, FAILED: 0x11, NODEVICE: 0x13, INSYNC: 0x14, NOSYNC: 0x15, CRC_EOP: 0x20,
  GET_SYNC: 0x30, GET_PARAMETER: 0x41, SET_DEVICE: 0x42, ENTER_PROGMODE: 0x50, LEAVE_PROGMODE: 0x51,
  LOAD_ADDRESS: 0x55, UNIVERSAL: 0x56, PROG_PAGE: 0x64, READ_PAGE: 0x74, READ_SIGN: 0x75,
  HW_VER: 0x80, SW_MAJOR: 0x81, SW_MINOR: 0x82
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

/** Speaks STK500v1 over a SerialLink. */
export class Stk500Programmer {
  constructor(link, log = () => {}) {
    this.link = link;
    this.log = log;
  }

  /** Send a command; expect INSYNC, `replyLen` data bytes, OK. Returns the data. */
  async cmd(bytes, replyLen = 0, timeoutMs = 1000) {
    await this.link.write([...bytes, STK.CRC_EOP]);
    const first = (await this.link.read(1, timeoutMs, 'the programmer'))[0];
    if (first === STK.NOSYNC) throw new Error('Programmer is out of sync (got NOSYNC)');
    if (first !== STK.INSYNC) throw new Error(`Unexpected reply 0x${hex2(first)} from the programmer`);
    const data = replyLen ? await this.link.read(replyLen, timeoutMs, 'command data') : new Uint8Array(0);
    const last = (await this.link.read(1, timeoutMs, 'command status'))[0];
    if (last === STK.NODEVICE) throw new Error('Programmer reports no target device');
    if (last !== STK.OK) throw new Error(`Programmer reported failure (0x${hex2(last)})`);
    return data;
  }

  async sync(attempts = 6) {
    for (let i = 0; i < attempts; i++) {
      await this.link.drain(30);
      try {
        await this.cmd([STK.GET_SYNC], 0, 300);
        return true;
      } catch (e) { /* retry */ }
    }
    throw new Error('No reply from the programmer. Is ArduinoISP running at 19200 baud? A 10 µF capacitor between RESET and GND on the programmer board stops it from resetting.');
  }

  async version() {
    const hw = (await this.cmd([STK.GET_PARAMETER, STK.HW_VER], 1))[0];
    const major = (await this.cmd([STK.GET_PARAMETER, STK.SW_MAJOR], 1))[0];
    const minor = (await this.cmd([STK.GET_PARAMETER, STK.SW_MINOR], 1))[0];
    return { hw, sw: `${major}.${minor}` };
  }

  /** Tell the programmer the page / memory sizes (ArduinoISP uses the page size). */
  async setDevice(chip) {
    const p = new Array(20).fill(0);
    p[0] = 0x86; // device code (ignored by ArduinoISP)
    p[2] = 0x00; p[3] = 0x01; p[4] = 0x01; p[5] = 0x01;
    p[6] = 0x01; p[7] = 0x03;
    p[8] = 0xff; p[9] = 0xff; p[10] = 0xff; p[11] = 0xff;
    p[12] = (chip.pageSize >> 8) & 0xff; p[13] = chip.pageSize & 0xff;
    p[14] = (chip.eepromSize >> 8) & 0xff; p[15] = chip.eepromSize & 0xff;
    p[16] = (chip.flashSize >>> 24) & 0xff; p[17] = (chip.flashSize >> 16) & 0xff;
    p[18] = (chip.flashSize >> 8) & 0xff; p[19] = chip.flashSize & 0xff;
    await this.cmd([STK.SET_DEVICE, ...p]);
  }

  enterProgmode() { return this.cmd([STK.ENTER_PROGMODE], 0, 2000); }
  leaveProgmode() { return this.cmd([STK.LEAVE_PROGMODE]); }

  /** Four-byte ISP instruction passed straight to the target. Returns the 4th byte read back. */
  async universal(a, b, c, d) {
    return (await this.cmd([STK.UNIVERSAL, a, b, c, d], 1))[0];
  }

  async readSignature() {
    const s = [];
    for (let i = 0; i < 3; i++) s.push(await this.universal(0x30, 0x00, i, 0x00));
    return (s[0] << 16) | (s[1] << 8) | s[2];
  }

  async readFuses() {
    return {
      lfuse: await this.universal(0x50, 0x00, 0x00, 0x00),
      hfuse: await this.universal(0x58, 0x08, 0x00, 0x00),
      efuse: await this.universal(0x50, 0x08, 0x00, 0x00),
      lock: await this.universal(0x58, 0x00, 0x00, 0x00)
    };
  }

  async writeFuse(which, value) {
    const op = { lfuse: [0xac, 0xa0], hfuse: [0xac, 0xa8], efuse: [0xac, 0xa4], lock: [0xac, 0xe0] }[which];
    if (!op) throw new Error(`Unknown fuse ${which}`);
    await this.universal(op[0], op[1], 0x00, value & 0xff);
    await sleep(10); // t_WD_FUSE is 4.5 ms
  }

  async chipErase() {
    await this.universal(0xac, 0x80, 0x00, 0x00);
    await sleep(30); // t_WD_ERASE is 9 ms
  }

  async loadAddress(byteAddress, chip) {
    const word = byteAddress >>> 1;
    // Above 128 KB the target needs the extended address byte (ATmega2560).
    if (chip.flashSize > 131072) await this.universal(0x4d, 0x00, (word >> 16) & 0xff, 0x00);
    await this.cmd([STK.LOAD_ADDRESS, word & 0xff, (word >> 8) & 0xff]);
  }

  /** Read one EEPROM byte with the universal ISP command (works on any STK500v1 programmer). */
  readEepromByte(addr) { return this.universal(0xa0, (addr >> 8) & 0xff, addr & 0xff, 0x00); }

  async writeEepromByte(addr, value) {
    await this.universal(0xc0, (addr >> 8) & 0xff, addr & 0xff, value & 0xff);
    await sleep(6); // t_WD_EEPROM is 3.6 to 4 ms
  }

  /** STK_READ_SIGN: signature as reported by a bootloader (no ISP involved). */
  async readBootloaderSignature() {
    const d = await this.cmd([STK.READ_SIGN], 3);
    return (d[0] << 16) | (d[1] << 8) | d[2];
  }

  async writePage(byteAddress, data, chip) {
    await this.loadAddress(byteAddress, chip);
    await this.cmd([STK.PROG_PAGE, (data.length >> 8) & 0xff, data.length & 0xff, 0x46, ...data], 0, 2000);
  }

  async readPage(byteAddress, length, chip) {
    await this.loadAddress(byteAddress, chip);
    return this.cmd([STK.READ_PAGE, (length >> 8) & 0xff, length & 0xff, 0x46], length, 2000);
  }
}

/**
 * Split an image into pages, skipping pages that are entirely 0xFF (erased)
 * unless `skipBlank` is false (needed when the old contents are not erased first).
 * Returns [{ address, data }] with each data padded to a full page.
 */
export function pagesFromImage(data, startAddress, pageSize, { skipBlank = true } = {}) {
  const pages = [];
  const first = Math.floor(startAddress / pageSize) * pageSize;
  const end = startAddress + data.length;
  for (let addr = first; addr < end; addr += pageSize) {
    const page = new Uint8Array(pageSize).fill(0xff);
    for (let i = 0; i < pageSize; i++) {
      const src = addr + i - startAddress;
      if (src >= 0 && src < data.length) page[i] = data[src];
    }
    if (!skipBlank || page.some((b) => b !== 0xff)) pages.push({ address: addr, data: page });
  }
  return pages;
}

export class AvrIspClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.isConnected = false;
    this.chip = null;
    this.signature = null;
    this.programmer = null;
    this.link = null;
    this.programmerInfo = null;
    this.fuses = { lfuse: 0xFF, hfuse: 0xDE, efuse: 0xFD, lock: 0x0F };
    this._owner = { name: 'AVR ISP Programmer', release: () => this.disconnect() };
  }

  log(msg) { this.logger(`[AVR ISP] ${msg}`); }

  /**
   * Open an ArduinoISP / STK500v1 programmer. `link` may be passed in (tests);
   * otherwise the serial port picker opens.
   */
  async connectHardware({ link = null, baudRate = 19200, bootDelayMs = 2000 } = {}) {
    this.link = link || await SerialLink.request(this._owner, { baudRate });
    this.programmer = new Stk500Programmer(this.link, (m) => this.log(m));
    try {
      // Opening the port resets an Arduino-based programmer; give it time to boot.
      if (bootDelayMs) await sleep(bootDelayMs);
      await this.programmer.sync();
      this.programmerInfo = await this.programmer.version();
      this.log(`Programmer answered: hardware v${this.programmerInfo.hw}, firmware ${this.programmerInfo.sw}.`);
      this.isConnected = true;
      return this.programmerInfo;
    } catch (e) {
      await this.link.close();
      this.link = null;
      this.programmer = null;
      throw e;
    }
  }

  async disconnect() {
    const link = this.link;
    this.link = null;
    if (link && this.programmer) {
      try { await this.programmer.leaveProgmode(); } catch (e) { /* target may be gone */ }
    }
    this.programmer = null;
    if (link) await link.close();
    this.isConnected = false;
    this.chip = null;
    this.signature = null;
    this.log('Disconnected.');
  }

  // Run fn inside programming mode (target held in reset), always leaving it.
  async _prog(fn) {
    await this.programmer.enterProgmode();
    try {
      return await fn(this.programmer);
    } finally {
      try { await this.programmer.leaveProgmode(); } catch (e) { /* ignore */ }
    }
  }

  /** Read the 3-byte signature and look the chip up. */
  async readSignature() {
    if (!this.isConnected) return null;
    // Set a generic page size first so programming mode can start.
    await this.programmer.setDevice({ pageSize: 128, eepromSize: 1024, flashSize: 32768 });
    const sig = await this._prog((p) => p.readSignature());
    this.signature = sig;
    if (sig === 0x000000 || sig === 0xffffff) {
      throw new Error(`Signature read as 0x${sig.toString(16).padStart(6, '0')}: the target isn't answering. Check wiring (MOSI, MISO, SCK, RESET to pin 10), power, and that the target clock is running.`);
    }
    this.chip = AVR_CHIP_DATABASE[sig] || null;
    this.log(`Signature ${hex2(sig >> 16)} ${hex2((sig >> 8) & 0xff)} ${hex2(sig & 0xff)} (${this.chip ? this.chip.name : 'not in the chip list'})`);
    if (this.chip) await this.programmer.setDevice(this.chip);
    return this.chip
      ? { signature: sig, ...this.chip }
      : { signature: sig, name: 'Unknown AVR', family: 'unknown', flashSize: 0, eepromSize: 0, pageSize: 0 };
  }

  async readFuses() {
    if (!this.isConnected) return null;
    this.fuses = await this._prog((p) => p.readFuses());
    const f = this.fuses;
    this.log(`Fuses L=0x${hex2(f.lfuse)} H=0x${hex2(f.hfuse)} E=0x${hex2(f.efuse)} Lock=0x${hex2(f.lock)}`);
    return { ...f };
  }

  /**
   * Write fuses. Refuses values that would disable ISP unless `allowHazards`.
   * Reads them back and returns what the chip now holds.
   */
  async writeFuses(newFuses, { allowHazards = false } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    const hazards = fuseHazards(this.chip, newFuses);
    if (hazards.length && !allowHazards) throw new Error(hazards.join(' '));
    if (!this.chip) throw new Error('Read the signature first: fuses are only written to a recognized chip.');
    await this._prog(async (p) => {
      if (!this.chip.noEfuse) await p.writeFuse('efuse', newFuses.efuse);
      await p.writeFuse('hfuse', newFuses.hfuse);
      await p.writeFuse('lfuse', newFuses.lfuse);
    });
    const back = await this.readFuses();
    const mask = this.chip.efuseUnused ?? 0xf8; // unused efuse bits always read back as 1
    const keys = ['lfuse', 'hfuse', ...(this.chip.noEfuse ? [] : ['efuse'])];
    const mism = keys.filter((k) => {
      const m = k === 'efuse' ? mask : 0;
      return ((back[k] | m) & 0xff) !== ((newFuses[k] | m) & 0xff);
    });
    if (mism.length) throw new Error(`Fuse read-back differs for ${mism.join(', ')}`);
    return back;
  }

  /**
   * Read the high fuse and say what a chip erase will do to the EEPROM.
   * Returns { status: 'preserved' | 'wiped' | 'unknown', text, hfuse }.
   */
  async eraseImpact() {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (!this.chip) throw new Error('Read the signature first.');
    const f = await this.readFuses();
    return { ...eepromAfterErase(this.chip, f.hfuse), hfuse: f.hfuse };
  }

  /**
   * Erase flash (and EEPROM unless EESAVE is programmed). With `preserveEeprom`
   * the EEPROM is dumped first and written back afterwards.
   */
  async chipErase({ preserveEeprom = false, onProgress } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (preserveEeprom && !this.chip) throw new Error('Read the signature first: the EEPROM size comes from the chip.');
    await this._prog(async (p) => {
      const saved = preserveEeprom ? await this._readEeprom(p, (f) => onProgress?.(Math.round(f * 40))) : null;
      await p.chipErase();
      if (saved) {
        // The erase ends programming mode on some programmers: re-enter.
        await p.leaveProgmode();
        await p.enterProgmode();
        await this._writeEeprom(p, saved, 0, (f) => onProgress?.(40 + Math.round(f * 60)));
      }
    });
    this.log(preserveEeprom ? 'Chip erased, EEPROM restored.' : 'Chip erased: flash and EEPROM are 0xFF (unless EESAVE was set), lock bits cleared.');
  }

  // ---- reading --------------------------------------------------------------

  async _readFlash(p, start, length, onProgress) {
    const pageSize = this.chip.pageSize;
    const first = Math.floor(start / pageSize) * pageSize;
    const end = start + length;
    const out = new Uint8Array(length);
    for (let addr = first; addr < end; addr += pageSize) {
      const page = await p.readPage(addr, pageSize, this.chip);
      for (let i = 0; i < pageSize; i++) {
        const dst = addr + i - start;
        if (dst >= 0 && dst < length) out[dst] = page[i];
      }
      onProgress?.(Math.min(1, (addr + pageSize - start) / length));
    }
    return out;
  }

  /** Read `length` bytes of flash from `start` (default: all of it). */
  async readFlash({ start = 0, length = null, onProgress } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (!this.chip) throw new Error('Read the signature first: the flash size and page size come from the chip.');
    const len = length ?? (this.chip.flashSize - start);
    if (start < 0 || len <= 0 || start + len > this.chip.flashSize) throw new Error(`Range 0x${start.toString(16)}+${len} is outside the ${this.chip.name}'s ${this.chip.flashSize / 1024} KB flash.`);
    return this._prog((p) => this._readFlash(p, start, len, onProgress));
  }

  /**
   * Compare flash with an image. Returns { ok, checked, firstMismatch, expected, actual }.
   */
  async verifyFlash(image, { onProgress } = {}) {
    if (!this.chip) throw new Error('Read the signature first.');
    const end = image.startAddress + image.data.length;
    if (end > this.chip.flashSize) throw new Error(`Image ends at 0x${end.toString(16)}, past the ${this.chip.name}'s ${this.chip.flashSize / 1024} KB flash.`);
    const back = await this.readFlash({ start: image.startAddress, length: image.data.length, onProgress });
    const bad = image.data.findIndex((b, i) => back[i] !== b);
    return bad < 0
      ? { ok: true, checked: image.data.length, firstMismatch: null }
      : { ok: false, checked: image.data.length, firstMismatch: image.startAddress + bad, expected: image.data[bad], actual: back[bad] };
  }

  async _readEeprom(p, onProgress) {
    const n = this.chip.eepromSize;
    const out = new Uint8Array(n);
    for (let a = 0; a < n; a++) {
      out[a] = await p.readEepromByte(a);
      if ((a & 0x1f) === 0x1f || a === n - 1) onProgress?.((a + 1) / n);
    }
    return out;
  }

  /** Read the whole EEPROM. */
  async readEeprom({ onProgress } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (!this.chip) throw new Error('Read the signature first: the EEPROM size comes from the chip.');
    return this._prog((p) => this._readEeprom(p, onProgress));
  }

  // Byte-wise write that skips bytes already holding the right value, then verifies.
  async _writeEeprom(p, data, start, onProgress) {
    let written = 0;
    for (let i = 0; i < data.length; i++) {
      const a = start + i;
      if ((await p.readEepromByte(a)) !== data[i]) {
        await p.writeEepromByte(a, data[i]);
        written++;
      }
      if ((i & 0x1f) === 0x1f || i === data.length - 1) onProgress?.((i + 1) / data.length);
    }
    for (let i = 0; i < data.length; i++) {
      const got = await p.readEepromByte(start + i);
      if (got !== data[i]) throw new Error(`EEPROM verify failed at 0x${(start + i).toString(16)}: wrote 0x${hex2(data[i])}, read 0x${hex2(got)}`);
    }
    return written;
  }

  /** Write `data` into the EEPROM at `start` and verify it. */
  async writeEeprom(data, { start = 0, onProgress } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (!this.chip) throw new Error('Read the signature first: the EEPROM size comes from the chip.');
    if (start + data.length > this.chip.eepromSize) throw new Error(`EEPROM data ends at 0x${(start + data.length).toString(16)}, past the ${this.chip.name}'s ${this.chip.eepromSize}-byte EEPROM.`);
    const written = await this._prog((p) => this._writeEeprom(p, data, start, onProgress));
    this.log(`EEPROM: ${data.length} bytes verified (${written} changed).`);
    return { bytes: data.length, written };
  }

  /**
   * Erase, write an image page by page and verify it.
   * The erase also wipes the EEPROM unless EESAVE is programmed; `preserveEeprom`
   * dumps it first and restores it afterwards.
   * @param {{ data: Uint8Array, startAddress: number }} image  e.g. from parseIntelHex.
   */
  async flashImage(image, { onProgress, erase = true, preserveEeprom = false } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (!this.chip) throw new Error('Read the signature first: the page size comes from the chip.');
    const end = image.startAddress + image.data.length;
    if (end > this.chip.flashSize) throw new Error(`Image ends at 0x${end.toString(16)}, past the ${this.chip.name}'s ${this.chip.flashSize / 1024} KB flash.`);
    const pages = pagesFromImage(image.data, image.startAddress, this.chip.pageSize);
    await this._prog(async (p) => {
      const saved = erase && preserveEeprom ? await this._readEeprom(p) : null;
      if (erase) {
        await p.chipErase();
        // The erase ends programming mode on some programmers: re-enter.
        await p.leaveProgmode();
        await p.enterProgmode();
      }
      let done = 0;
      for (const page of pages) {
        await p.writePage(page.address, page.data, this.chip);
        done++;
        onProgress?.(Math.round((done / pages.length) * 70));
      }
      done = 0;
      for (const page of pages) {
        const back = await p.readPage(page.address, page.data.length, this.chip);
        const bad = page.data.findIndex((b, i) => back[i] !== b);
        if (bad >= 0) throw new Error(`Verify failed at 0x${(page.address + bad).toString(16)}: wrote 0x${hex2(page.data[bad])}, read 0x${hex2(back[bad])}`);
        done++;
        onProgress?.(70 + Math.round((done / pages.length) * 30));
      }
      if (saved) await this._writeEeprom(p, saved, 0);
    });
    this.log(`Wrote and verified ${pages.length} page(s), ${image.data.length} bytes.`);
    return { pages: pages.length, bytes: image.data.length };
  }

  /**
   * Burn a bootloader: erase, set the chip's Arduino fuses, write the
   * bootloader image, verify, then set the lock bits that protect it.
   */
  async burnBootloader(image, onProgress) {
    if (!this.isConnected) throw new Error('AVR ISP programmer not connected.');
    if (!image) throw new Error('Load a bootloader .hex file first.');
    if (!this.chip) throw new Error('Read the signature first.');
    const preset = this.chip.defaultFuses;
    if (!preset) throw new Error(`The Arduino fuse defaults for the ${this.chip.name} are not known, so "burn bootloader" is disabled for it. Write the fuses and flash the bootloader separately.`);
    await this.chipErase();
    await this.writeFuses({ ...preset, lock: 0x3f });
    await this.flashImage(image, { onProgress, erase: false });
    await this._prog((p) => p.writeFuse('lock', preset.lock));
    this.fuses = await this.readFuses();
    this.log('Bootloader burned, fuses and lock bits set.');
    return true;
  }
}

// ---- Intel HEX export ---------------------------------------------------------

/**
 * Serialise bytes as Intel HEX (data, extended-linear-address and EOF records).
 * 16-byte rows that are entirely 0xFF are left out, as erased flash needs no record.
 */
export function toIntelHex(data, startAddress = 0, { skipBlank = true } = {}) {
  const lines = [];
  const rec = (len, addr, type, bytes) => {
    let sum = len + (addr >> 8) + (addr & 0xff) + type;
    for (const b of bytes) sum += b;
    const chk = (-sum) & 0xff;
    return `:${hex2(len)}${hex2(addr >> 8)}${hex2(addr & 0xff)}${hex2(type)}${bytes.map(hex2).join('')}${hex2(chk)}`;
  };
  let upper = -1;
  for (let off = 0; off < data.length;) {
    const abs = startAddress + off;
    // Rows never cross a 16-byte boundary or a 64 KB segment.
    const room = Math.min(16 - (abs & 0x0f), data.length - off);
    const row = Array.from(data.subarray(off, off + room));
    off += room;
    if (skipBlank && row.every((b) => b === 0xff)) continue;
    if ((abs >>> 16) !== upper) {
      upper = abs >>> 16;
      lines.push(rec(2, 0, 4, [(upper >> 8) & 0xff, upper & 0xff]));
    }
    lines.push(rec(row.length, abs & 0xffff, 0, row));
  }
  lines.push(':00000001FF');
  return `${lines.join('\n')}\n`;
}

// ---- Arduino bootloader upload (STK500v1: optiboot, ATmegaBOOT_168) -------------

/**
 * Boards that can be programmed through their serial bootloader.
 * `appLimit` is the first flash byte the bootloader occupies (conservative:
 * the Arduino IDE's maximum sketch size for the board).
 */
export const ARDUINO_BOARDS = {
  uno: { name: 'Arduino Uno (optiboot)', baud: 115200, signature: 0x1e950f, appLimit: 32256 },
  'nano-new': { name: 'Arduino Nano, new bootloader (optiboot)', baud: 115200, signature: 0x1e950f, appLimit: 32256 },
  'nano-old': { name: 'Arduino Nano, old bootloader (ATmegaBOOT)', baud: 57600, signature: 0x1e950f, appLimit: 30720 },
  'pro-mini': { name: 'Arduino Pro Mini, ATmega328P (5V 16 MHz or 3.3V 8 MHz)', baud: 57600, signature: 0x1e950f, appLimit: 30720 }
};

/**
 * Upload a sketch through an STK500v1 bootloader, like `avrdude -c arduino`.
 * Never touches fuses or the chip erase command and does not use ISP:
 * sync, signature check, page writes, read-back verify, run.
 *
 * @param {SerialLink} link  open at the board's baud rate
 * @param {{ data: Uint8Array, startAddress: number }} image
 * @param {{ board: object, resetWithDtr?: boolean, onProgress?: (n:number)=>void, log?: (m:string)=>void }} opts
 */
export async function uploadViaBootloader(link, image, { board, resetWithDtr = true, onProgress, log = () => {}, bootWaitMs = 400 } = {}) {
  if (!board) throw new Error('Choose a board first.');
  const chip = AVR_CHIP_DATABASE[board.signature];
  const end = image.startAddress + image.data.length;
  if (image.startAddress >= board.appLimit) {
    throw new Error(`The image starts at 0x${image.startAddress.toString(16)}, inside the bootloader area (above 0x${board.appLimit.toString(16)}). Load the sketch .hex (it starts at 0), not a bootloader.`);
  }
  if (end > board.appLimit) throw new Error(`The image ends at 0x${end.toString(16)}, past the ${board.appLimit} bytes this board leaves for sketches (the bootloader lives above).`);

  const stk = new Stk500Programmer(link, log);
  if (resetWithDtr) {
    await link.setSignals({ dataTerminalReady: false, requestToSend: false });
    await sleep(250);
    await link.setSignals({ dataTerminalReady: true, requestToSend: true });
    await sleep(bootWaitMs);
  }
  await stk.sync(10);
  const sig = await stk.readBootloaderSignature();
  if (sig !== board.signature) {
    throw new Error(`The bootloader reports signature 0x${sig.toString(16).padStart(6, '0')}, but ${board.name} has 0x${board.signature.toString(16).padStart(6, '0')}. Pick the right board.`);
  }
  // No erase is issued: the bootloader erases each page itself, so blank pages must be written too.
  const pages = pagesFromImage(image.data, image.startAddress, chip.pageSize, { skipBlank: false });
  let done = 0;
  for (const page of pages) {
    await stk.writePage(page.address, page.data, chip);
    done++;
    onProgress?.(Math.round((done / pages.length) * 70));
  }
  done = 0;
  for (const page of pages) {
    const back = await stk.readPage(page.address, page.data.length, chip);
    const bad = page.data.findIndex((b, i) => back[i] !== b);
    if (bad >= 0) throw new Error(`Verify failed at 0x${(page.address + bad).toString(16)}: wrote 0x${hex2(page.data[bad])}, read 0x${hex2(back[bad])}`);
    done++;
    onProgress?.(70 + Math.round((done / pages.length) * 30));
  }
  await stk.leaveProgmode(); // the bootloader starts the sketch
  log(`Uploaded and verified ${pages.length} page(s), ${image.data.length} bytes.`);
  return { pages: pages.length, bytes: image.data.length };
}
