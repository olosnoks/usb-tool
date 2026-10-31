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

// Fuse bits are active-low: 0 = programmed.
// `guard` lists the bits that lock you out of ISP if set wrong.
export const AVR_CHIP_DATABASE = {
  0x1E950F: {
    name: 'ATmega328P', family: 'megaAVR', flashSize: 32768, eepromSize: 1024, pageSize: 128,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xDE, efuse: 0xFD, lock: 0x0F },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] },
    desc: 'Arduino Uno R3, Nano v3, Pro Mini 5V/16MHz'
  },
  0x1E9514: {
    name: 'ATmega328PB', family: 'megaAVR', flashSize: 32768, eepromSize: 1024, pageSize: 128, efuseUnused: 0xf0,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xDE, efuse: 0xF5, lock: 0x0F },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] },
    desc: 'Enhanced ATmega328 with dual USART, SPI, and I2C'
  },
  0x1E9406: {
    name: 'ATmega168', family: 'megaAVR', flashSize: 16384, eepromSize: 512, pageSize: 128,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xDD, efuse: 0xF8, lock: 0x0F },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] },
    desc: 'Arduino Diecimila / older Nano and Pro Mini'
  },
  0x1E9307: {
    name: 'ATmega8', family: 'megaAVR', flashSize: 8192, eepromSize: 512, pageSize: 64, noEfuse: true,
    defaultFuses: { lfuse: 0xBF, hfuse: 0xCA, efuse: 0xFF, lock: 0x0F },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80] },
    desc: 'Arduino NG / early boards'
  },
  0x1E9801: {
    name: 'ATmega2560', family: 'megaAVR', flashSize: 262144, eepromSize: 4096, pageSize: 256,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xD8, efuse: 0xFD, lock: 0x0F },
    guard: { spien: ['hfuse', 0x20] },
    desc: 'Arduino Mega 2560, 3D Printer Controller (RAMPS)'
  },
  0x1E9705: {
    name: 'ATmega1284P', family: 'megaAVR', flashSize: 131072, eepromSize: 4096, pageSize: 256,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xDE, efuse: 0xFD, lock: 0x0F },
    guard: { spien: ['hfuse', 0x20] },
    desc: 'Sanguino / large-memory 40-pin AVR'
  },
  0x1E9587: {
    name: 'ATmega32U4', family: 'megaAVR (Native USB)', flashSize: 32768, eepromSize: 1024, pageSize: 128, efuseUnused: 0xf0,
    defaultFuses: { lfuse: 0xFF, hfuse: 0xD8, efuse: 0xCB, lock: 0x2F },
    guard: { spien: ['hfuse', 0x20] },
    desc: 'Arduino Leonardo, Pro Micro, BadUSB Keyboard Emulators'
  },
  0x1E930B: {
    name: 'ATtiny85', family: 'tinyAVR', flashSize: 8192, eepromSize: 512, pageSize: 64, efuseUnused: 0xfe,
    defaultFuses: { lfuse: 0x62, hfuse: 0xDF, efuse: 0xFF, lock: 0xFF },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] },
    desc: '8-pin ultra-compact microcontroller (Digispark)'
  },
  0x1E9206: {
    name: 'ATtiny45', family: 'tinyAVR', flashSize: 4096, eepromSize: 256, pageSize: 64, efuseUnused: 0xfe,
    defaultFuses: { lfuse: 0x62, hfuse: 0xDF, efuse: 0xFF, lock: 0xFF },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] },
    desc: '8-pin tinyAVR, 4 KB flash'
  },
  0x1E930C: {
    name: 'ATtiny84', family: 'tinyAVR', flashSize: 8192, eepromSize: 512, pageSize: 64, efuseUnused: 0xfe,
    defaultFuses: { lfuse: 0x62, hfuse: 0xDF, efuse: 0xFF, lock: 0xFF },
    guard: { spien: ['hfuse', 0x20], rstdisbl: ['hfuse', 0x80], dwen: ['hfuse', 0x40] },
    desc: '14-pin tinyAVR'
  },
  0x1E9007: {
    name: 'ATtiny13A', family: 'tinyAVR', flashSize: 1024, eepromSize: 64, pageSize: 32, noEfuse: true,
    defaultFuses: { lfuse: 0x6A, hfuse: 0xFF, efuse: 0xFF, lock: 0xFF },
    guard: { spien: ['lfuse', 0x80], rstdisbl: ['hfuse', 0x01], dwen: ['hfuse', 0x08] },
    desc: '8-pin, 1 KB flash'
  }
};

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
  LOAD_ADDRESS: 0x55, UNIVERSAL: 0x56, PROG_PAGE: 0x64, READ_PAGE: 0x74,
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
 * Split an image into pages, skipping pages that are entirely 0xFF (erased).
 * Returns [{ address, data }] with each data padded to a full page.
 */
export function pagesFromImage(data, startAddress, pageSize) {
  const pages = [];
  const first = Math.floor(startAddress / pageSize) * pageSize;
  const end = startAddress + data.length;
  for (let addr = first; addr < end; addr += pageSize) {
    const page = new Uint8Array(pageSize).fill(0xff);
    for (let i = 0; i < pageSize; i++) {
      const src = addr + i - startAddress;
      if (src >= 0 && src < data.length) page[i] = data[src];
    }
    if (page.some((b) => b !== 0xff)) pages.push({ address: addr, data: page });
  }
  return pages;
}

export class AvrIspClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.isConnected = false;
    this.isSimulated = false;
    this.chip = null;
    this.signature = null;
    this.programmer = null;
    this.link = null;
    this.programmerInfo = null;
    this.fuses = { lfuse: 0xFF, hfuse: 0xDE, efuse: 0xFD, lock: 0x0F };
    this._owner = { name: 'AVR ISP Programmer', release: () => this.disconnect() };
  }

  log(msg) { this.logger(`[AVR ISP] ${msg}`); }

  connectSimulation(sig = 0x1E950F) {
    this.isConnected = true;
    this.isSimulated = true;
    this.chip = AVR_CHIP_DATABASE[sig];
    this.signature = sig;
    this.fuses = { ...this.chip.defaultFuses };
    this.log('Connected to a simulated programmer and ATmega328P.');
    return true;
  }

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
      this.isSimulated = false;
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
    this.isSimulated = false;
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
    if (this.isSimulated) {
      this.chip = AVR_CHIP_DATABASE[0x1E950F];
      this.signature = 0x1E950F;
      this.log(`Signature 1E 95 0F (${this.chip.name})`);
      return { signature: 0x1E950F, ...this.chip };
    }
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
    if (!this.isSimulated) this.fuses = await this._prog((p) => p.readFuses());
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
    if (this.isSimulated) {
      this.fuses = { ...newFuses };
      this.log('Fuses written (simulated).');
      return { ...this.fuses };
    }
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

  async chipErase() {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (this.isSimulated) { this.log('Chip erased (simulated).'); return; }
    await this._prog((p) => p.chipErase());
    this.log('Chip erased: flash and EEPROM are 0xFF, lock bits cleared.');
  }

  /**
   * Erase, write an image page by page and verify it.
   * @param {{ data: Uint8Array, startAddress: number }} image  e.g. from parseIntelHex.
   */
  async flashImage(image, { onProgress, erase = true } = {}) {
    if (!this.isConnected) throw new Error('Programmer not connected.');
    if (this.isSimulated) {
      for (let p = 0; p <= 100; p += 20) { onProgress?.(p); await sleep(60); }
      this.log('Image written and verified (simulated).');
      return { pages: 0, bytes: image.data.length };
    }
    if (!this.chip) throw new Error('Read the signature first: the page size comes from the chip.');
    const end = image.startAddress + image.data.length;
    if (end > this.chip.flashSize) throw new Error(`Image ends at 0x${end.toString(16)}, past the ${this.chip.name}'s ${this.chip.flashSize / 1024} KB flash.`);
    const pages = pagesFromImage(image.data, image.startAddress, this.chip.pageSize);
    await this._prog(async (p) => {
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
    if (this.isSimulated) {
      this.log('Erasing chip memory (simulated)...');
      for (let p = 0; p <= 100; p += 20) { onProgress?.(p); await sleep(80); }
      this.log('Bootloader written and verified (simulated).');
      return true;
    }
    if (!image) throw new Error('Load a bootloader .hex file first.');
    if (!this.chip) throw new Error('Read the signature first.');
    const preset = this.chip.defaultFuses;
    await this.chipErase();
    await this.writeFuses({ ...preset, lock: 0x3f });
    await this.flashImage(image, { onProgress, erase: false });
    await this._prog((p) => p.writeFuse('lock', preset.lock));
    this.fuses = await this.readFuses();
    this.log('Bootloader burned, fuses and lock bits set.');
    return true;
  }
}
