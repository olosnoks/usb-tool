/**
 * CH341A USB programmer: SPI NOR flash and I2C 24Cxx EEPROMs over WebUSB.
 *
 * The CH341A in "programmer" mode (1A86:5512) takes 32-byte command packets on
 * bulk endpoint 2. SPI goes through SPI_STREAM packets (bytes are shifted LSB
 * first, so every byte is bit-reversed), chip select is a UIO_STREAM pin write,
 * and I2C goes through I2C_STREAM sub-commands. The packet layout follows
 * flashrom's ch341a_spi.c and the vendor CH341DLL I2C stream.
 *
 * All I/O goes through a transport { out(bytes), in(maxLength) } so the
 * simulated programmer (which speaks the same byte protocol) can test it.
 */

// --- Chip database ----------------------------------------------------------

const MB = 1024 * 1024;
const chip = (manufacturer, model, sizeBytes) => ({ manufacturer, model, sizeBytes, pageSize: 256, sectorSize: 4096 });

export const SPI_FLASH_DATABASE = {
  0xEF4014: chip('Winbond', 'W25Q80', 1 * MB), 0xEF4015: chip('Winbond', 'W25Q16', 2 * MB), 0xEF4016: chip('Winbond', 'W25Q32', 4 * MB),
  0xEF4017: chip('Winbond', 'W25Q64', 8 * MB), 0xEF4018: chip('Winbond', 'W25Q128', 16 * MB), 0xEF4019: chip('Winbond', 'W25Q256', 32 * MB),
  0xEF7018: chip('Winbond', 'W25Q128JV-M', 16 * MB), 0xEF6017: chip('Winbond', 'W25Q64DW (1.8 V)', 8 * MB), 0xEF3013: chip('Winbond', 'W25X40', 512 * 1024),
  0xC22014: chip('Macronix', 'MX25L8005', 1 * MB), 0xC22015: chip('Macronix', 'MX25L1605', 2 * MB), 0xC22016: chip('Macronix', 'MX25L3205', 4 * MB),
  0xC22017: chip('Macronix', 'MX25L6405', 8 * MB), 0xC22018: chip('Macronix', 'MX25L12835F', 16 * MB), 0xC22019: chip('Macronix', 'MX25L25635F', 32 * MB),
  0xC84015: chip('GigaDevice', 'GD25Q16', 2 * MB), 0xC84016: chip('GigaDevice', 'GD25Q32', 4 * MB), 0xC84017: chip('GigaDevice', 'GD25Q64', 8 * MB),
  0xC84018: chip('GigaDevice', 'GD25Q128', 16 * MB), 0xC86017: chip('GigaDevice', 'GD25LQ64 (1.8 V)', 8 * MB),
  0x20BA18: chip('Micron', 'N25Q128', 16 * MB), 0x20BA19: chip('Micron', 'N25Q256', 32 * MB),
  0x1C3017: chip('EON', 'EN25Q64', 8 * MB), 0x1C7018: chip('EON', 'EN25QH128', 16 * MB),
  0xBF2541: chip('SST / Microchip', 'SST25VF016B', 2 * MB), 0xBF254A: chip('SST / Microchip', 'SST25VF032B', 4 * MB),
  0x1F8501: chip('Adesto', 'AT25SF081', 1 * MB), 0x1F4701: chip('Adesto', 'AT25DF321A', 4 * MB),
  0x9D6017: chip('ISSI', 'IS25LP064', 8 * MB), 0x9D6018: chip('ISSI', 'IS25LP128', 16 * MB),
  0x856015: chip('Puya', 'P25Q16H', 2 * MB), 0x856017: chip('Puya', 'P25Q64H', 8 * MB),
  0x684017: chip('Boya', 'BY25Q64AS', 8 * MB), 0x684018: chip('Boya', 'BY25Q128AS', 16 * MB),
  0x0B4017: chip('XTX', 'XT25F64B', 8 * MB), 0x0B4018: chip('XTX', 'XT25F128B', 16 * MB),
  0x204017: chip('XMC', 'XM25QH64', 8 * MB), 0x207018: chip('XMC', 'XM25QH128A', 16 * MB),
  0x5E4017: chip('Zbit', 'ZB25VQ64', 8 * MB), 0xA14017: chip('Fudan', 'FM25Q64', 8 * MB)
};

const MANUFACTURERS = { 0xef: 'Winbond', 0xc2: 'Macronix', 0xc8: 'GigaDevice', 0x20: 'Micron / XMC', 0x1c: 'EON', 0xbf: 'SST', 0x1f: 'Adesto', 0x9d: 'ISSI', 0x85: 'Puya', 0x68: 'Boya', 0x0b: 'XTX', 0x5e: 'Zbit', 0xa1: 'Fudan', 0x01: 'Spansion / Infineon' };

/** Look up a JEDEC ID; unknown chips get their size from the capacity byte. */
export function identifyChip(id) {
  const known = SPI_FLASH_DATABASE[id];
  if (known) return { ...known, jedecId: id };
  const cap = id & 0xff;
  return {
    manufacturer: MANUFACTURERS[id >>> 16] || `vendor 0x${(id >>> 16).toString(16).toUpperCase()}`,
    model: `JEDEC 0x${id.toString(16).toUpperCase().padStart(6, '0')}`,
    sizeBytes: cap >= 0x10 && cap <= 0x1c ? 2 ** cap : null,
    pageSize: 256, sectorSize: 4096, jedecId: id, guessed: true
  };
}

/** 24Cxx EEPROMs: size, page size, address bytes, and how many address bits ride in the device address. */
export const EEPROM_DATABASE = {
  '24C01': { size: 128, page: 8, addrBytes: 1 },
  '24C02': { size: 256, page: 8, addrBytes: 1 },
  '24C04': { size: 512, page: 16, addrBytes: 1 },
  '24C08': { size: 1024, page: 16, addrBytes: 1 },
  '24C16': { size: 2048, page: 16, addrBytes: 1 },
  '24C32': { size: 4096, page: 32, addrBytes: 2 },
  '24C64': { size: 8192, page: 32, addrBytes: 2 },
  '24C128': { size: 16384, page: 64, addrBytes: 2 },
  '24C256': { size: 32768, page: 64, addrBytes: 2 },
  '24C512': { size: 65536, page: 128, addrBytes: 2 },
  '24CM01': { size: 131072, page: 256, addrBytes: 2 },
  '24CM02': { size: 262144, page: 256, addrBytes: 2 }
};

export const SPI_CMD = {
  WREN: 0x06, WRDI: 0x04, RDSR: 0x05, RDSR2: 0x35, RDSR3: 0x15, WRSR: 0x01, WRSR2: 0x31, WRSR3: 0x11,
  READ: 0x03, READ4: 0x13, FAST_READ: 0x0B, PAGE_PROG: 0x02, PAGE_PROG4: 0x12,
  SECTOR_ERASE: 0x20, SECTOR_ERASE4: 0x21, BLOCK_ERASE_32K: 0x52, BLOCK_ERASE_64K: 0xD8, CHIP_ERASE: 0xC7,
  JEDEC_ID: 0x9F, SFDP: 0x5A, ENTER_4B: 0xB7, EXIT_4B: 0xE9
};

export const CH341_USB = {
  VID: 0x1A86, PID_PARALLEL: 0x5512, PID_SERIAL: 0x7523,
  PACKET: 32,
  CMD_SPI_STREAM: 0xA8, CMD_I2C_STREAM: 0xAA, CMD_UIO_STREAM: 0xAB,
  I2C_STM_START: 0x74, I2C_STM_STOP: 0x75, I2C_STM_OUT: 0x80, I2C_STM_IN: 0xC0, I2C_STM_SET: 0x60, I2C_STM_END: 0x00,
  UIO_STM_IN: 0x00, UIO_STM_DIR: 0x40, UIO_STM_OUT: 0x80, UIO_STM_US: 0xC0, UIO_STM_END: 0x20
};

const REVERSE = new Uint8Array(256).map((_, i) => {
  let r = 0;
  for (let b = 0; b < 8; b++) if (i & (1 << b)) r |= 0x80 >> b;
  return r;
});
export const reverseBits = (b) => REVERSE[b];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Transport --------------------------------------------------------------

export class Ch341UsbTransport {
  constructor(device) { this.device = device; }

  static async request() {
    if (typeof navigator === 'undefined' || !navigator.usb) throw new Error('WebUSB needs Chrome or Edge.');
    const device = await navigator.usb.requestDevice({ filters: [{ vendorId: CH341_USB.VID, productId: CH341_USB.PID_PARALLEL }] });
    const t = new Ch341UsbTransport(device);
    await t.open();
    return t;
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    await d.claimInterface(0);
  }

  async out(bytes) {
    const r = await this.device.transferOut(2, bytes);
    if (r.status !== 'ok') throw new Error(`USB OUT ${r.status}`);
  }

  async in(maxLength) {
    const r = await this.device.transferIn(2, maxLength);
    if (r.status !== 'ok') throw new Error(`USB IN ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }

  async close() {
    try { await this.device.releaseInterface(0); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

// --- Protocol ----------------------------------------------------------------

export class Ch341 {
  constructor(transport) {
    this.t = transport;
    this.chain = Promise.resolve();
  }

  _serial(fn) { const r = this.chain.then(fn, fn); this.chain = r.catch(() => {}); return r; }

  async _readExact(n) {
    const out = new Uint8Array(n);
    let got = 0;
    let empty = 0;
    while (got < n) {
      const chunk = await this.t.in(Math.min(n - got, 4096));
      if (!chunk.length) { if (++empty > 50) throw new Error(`The programmer sent ${got} of ${n} bytes.`); continue; }
      out.set(chunk.subarray(0, n - got), got);
      got += chunk.length;
    }
    return out;
  }

  /** I2C clock (0 = 20k, 1 = 100k, 2 = 400k, 3 = 750k); also sets the SPI shift mode. */
  configure(speed = 1) {
    return this._serial(() => this.t.out(Uint8Array.from([CH341_USB.CMD_I2C_STREAM, CH341_USB.I2C_STM_SET | (speed & 7), CH341_USB.I2C_STM_END])));
  }

  /** D0-D5 as outputs (CS high, SCK low) or all released to inputs. */
  enablePins(on) {
    return this._serial(() => this.t.out(Uint8Array.from([CH341_USB.CMD_UIO_STREAM, CH341_USB.UIO_STM_OUT | 0x37, CH341_USB.UIO_STM_DIR | (on ? 0x3f : 0x00), CH341_USB.UIO_STM_END])));
  }

  /**
   * One SPI transaction: CS low, clock out `write`, clock in `readCount` bytes, CS high.
   * Layout: a 32-byte UIO packet (CS pulse), then SPI_STREAM packets of 31 data bytes.
   */
  spi(write, readCount = 0) {
    return this._serial(async () => {
      const total = write.length + readCount;
      const packets = Math.ceil(total / (CH341_USB.PACKET - 1));
      const buf = new Uint8Array(CH341_USB.PACKET + packets + total);
      buf.set([CH341_USB.CMD_UIO_STREAM, CH341_USB.UIO_STM_OUT | 0x37, CH341_USB.UIO_STM_OUT | 0x36, CH341_USB.UIO_STM_END]);
      let o = CH341_USB.PACKET;
      let wi = 0;
      let left = total;
      while (left > 0) {
        const n = Math.min(CH341_USB.PACKET - 1, left);
        buf[o++] = CH341_USB.CMD_SPI_STREAM;
        for (let k = 0; k < n; k++, wi++) buf[o++] = wi < write.length ? REVERSE[write[wi]] : 0xff;
        left -= n;
      }
      await this.t.out(buf);
      const back = total ? await this._readExact(total) : new Uint8Array(0);
      await this.t.out(Uint8Array.from([CH341_USB.CMD_UIO_STREAM, CH341_USB.UIO_STM_OUT | 0x37, CH341_USB.UIO_STM_END]));
      return back.subarray(write.length).map((b) => REVERSE[b]);
    });
  }

  /**
   * One I2C transaction: START, write bytes (address first), optional repeated
   * START + read `readCount` bytes (last one NACKed), STOP. Must fit one packet.
   */
  i2c(write, readCount = 0, readAddr = null) {
    return this._serial(async () => {
      const b = [CH341_USB.CMD_I2C_STREAM, CH341_USB.I2C_STM_START, CH341_USB.I2C_STM_OUT | write.length, ...write];
      if (readCount) {
        b.push(CH341_USB.I2C_STM_START, CH341_USB.I2C_STM_OUT | 1, readAddr ?? (write[0] | 1));
        if (readCount > 1) b.push(CH341_USB.I2C_STM_IN | (readCount - 1));
        b.push(CH341_USB.I2C_STM_IN);
      }
      b.push(CH341_USB.I2C_STM_STOP, CH341_USB.I2C_STM_END);
      if (b.length > CH341_USB.PACKET) throw new Error('I2C transaction too long for one CH341 packet.');
      await this.t.out(Uint8Array.from(b));
      return readCount ? this._readExact(readCount) : new Uint8Array(0);
    });
  }
}

// --- SPI flash -----------------------------------------------------------------

export function decodeStatus(sr1, sr2 = null, sr3 = null) {
  return {
    busy: !!(sr1 & 1), wel: !!(sr1 & 2), bp: (sr1 >> 2) & 7, tb: !!(sr1 & 0x20), sec: !!(sr1 & 0x40), srp0: !!(sr1 & 0x80),
    srp1: sr2 === null ? null : !!(sr2 & 1), qe: sr2 === null ? null : !!(sr2 & 2), cmp: sr2 === null ? null : !!(sr2 & 0x40),
    wps: sr3 === null ? null : !!(sr3 & 4),
    protected: ((sr1 >> 2) & 7) !== 0
  };
}

/** Byte ranges where two buffers differ, merged when closer than `gap`. */
export function diffBuffers(a, b, { gap = 16, maxRanges = 1000 } = {}) {
  const n = Math.max(a.length, b.length);
  const ranges = [];
  let bytes = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    bytes++;
    const last = ranges[ranges.length - 1];
    if (last && i - last.end <= gap) last.end = i + 1;
    else if (ranges.length < maxRanges) ranges.push({ start: i, end: i + 1 });
  }
  return { bytes, ranges, sizeDiffers: a.length !== b.length };
}

export class SpiFlash {
  constructor(ch) {
    this.ch = ch;
    this.chip = null;
  }

  async jedecId() {
    const r = await this.ch.spi([SPI_CMD.JEDEC_ID], 3);
    return (r[0] << 16) | (r[1] << 8) | r[2];
  }

  /** Density from the SFDP basic flash parameter table, or null. */
  async sfdpSize() {
    const head = await this.ch.spi([SPI_CMD.SFDP, 0, 0, 0, 0], 16);
    if (String.fromCharCode(...head.subarray(0, 4)) !== 'SFDP') return null;
    const ptr = head[12] | (head[13] << 8) | (head[14] << 16);
    const len = head[11] * 4;
    if (len < 8) return null;
    const t = await this.ch.spi([SPI_CMD.SFDP, (ptr >> 16) & 0xff, (ptr >> 8) & 0xff, ptr & 0xff, 0], 8);
    const d2 = (t[4] | (t[5] << 8) | (t[6] << 16) | (t[7] << 24)) >>> 0;
    const bits = d2 & 0x80000000 ? 2 ** (d2 & 0x7fffffff) : d2 + 1;
    return bits / 8;
  }

  async identify() {
    const id = await this.jedecId();
    if (id === 0xffffff || id === 0) throw new Error('No SPI flash answered (ID FF FF FF / 00 00 00). Check the clip, pin 1 and the 3.3 V jumper.');
    const c = identifyChip(id);
    if (c.guessed) {
      const sfdp = await this.sfdpSize().catch(() => null);
      if (sfdp) { c.sizeBytes = sfdp; c.sizeFrom = 'SFDP'; } else if (c.sizeBytes) c.sizeFrom = 'capacity byte';
    }
    this.chip = c;
    return c;
  }

  get fourByte() { return (this.chip?.sizeBytes || 0) > 16 * MB; }
  _addr(a) { return this.fourByte ? [(a >>> 24) & 0xff, (a >> 16) & 0xff, (a >> 8) & 0xff, a & 0xff] : [(a >> 16) & 0xff, (a >> 8) & 0xff, a & 0xff]; }

  async status() {
    const [sr1] = await this.ch.spi([SPI_CMD.RDSR], 1);
    const [sr2] = await this.ch.spi([SPI_CMD.RDSR2], 1);
    const [sr3] = await this.ch.spi([SPI_CMD.RDSR3], 1);
    return { sr1, sr2, sr3, ...decodeStatus(sr1, sr2, sr3) };
  }

  async waitReady(timeoutMs = 5000) {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const [sr] = await this.ch.spi([SPI_CMD.RDSR], 1);
      if (!(sr & 1)) return;
      if (Date.now() > end) throw new Error('The flash stayed busy (WIP) too long.');
      await sleep(1);
    }
  }

  async writeStatus(sr1, sr2 = null) {
    await this.ch.spi([SPI_CMD.WREN]);
    await this.ch.spi(sr2 === null ? [SPI_CMD.WRSR, sr1] : [SPI_CMD.WRSR, sr1, sr2]);
    await this.waitReady();
  }

  /** Clear the block-protect bits (BP0-2, TB, SEC) so the whole chip can be written. */
  async unprotect() {
    const s = await this.status();
    await this.writeStatus(s.sr1 & ~0x7c);
    const after = await this.status();
    if (after.protected) throw new Error('Protection bits did not clear: the WP# pin is probably held low with SRP set.');
    return after;
  }

  async read(addr, length, onProgress) {
    const out = new Uint8Array(length);
    const op = this.fourByte ? SPI_CMD.READ4 : SPI_CMD.READ;
    const chunk = 4096;
    for (let off = 0; off < length; off += chunk) {
      const n = Math.min(chunk, length - off);
      out.set(await this.ch.spi([op, ...this._addr(addr + off)], n), off);
      onProgress?.((off + n) / length);
    }
    return out;
  }

  async eraseSector(addr) {
    await this.ch.spi([SPI_CMD.WREN]);
    await this.ch.spi([this.fourByte ? SPI_CMD.SECTOR_ERASE4 : SPI_CMD.SECTOR_ERASE, ...this._addr(addr)]);
    await this.waitReady(2000);
  }

  async chipErase() {
    await this.ch.spi([SPI_CMD.WREN]);
    await this.ch.spi([SPI_CMD.CHIP_ERASE]);
    await this.waitReady(240000);
  }

  async programPage(addr, data) {
    await this.ch.spi([SPI_CMD.WREN]);
    await this.ch.spi([this.fourByte ? SPI_CMD.PAGE_PROG4 : SPI_CMD.PAGE_PROG, ...this._addr(addr), ...data]);
    await this.waitReady(100);
  }

  /**
   * Write `data` at `addr`: per 4 KB sector, skip it if it already matches,
   * erase only if a bit has to go 0 -> 1, program the pages that changed, then verify.
   */
  async write(addr, data, onProgress) {
    const sector = 4096;
    const start = addr - (addr % sector);
    const end = addr + data.length;
    let erased = 0;
    let programmed = 0;
    let skipped = 0;
    for (let s = start; s < end; s += sector) {
      const cur = await this.read(s, sector);
      const want = cur.slice();
      const from = Math.max(s, addr);
      const to = Math.min(s + sector, end);
      want.set(data.subarray(from - addr, to - addr), from - s);
      let same = true;
      let needErase = false;
      for (let i = 0; i < sector; i++) {
        if (cur[i] !== want[i]) { same = false; if ((~cur[i] & want[i]) & 0xff) { needErase = true; break; } }
      }
      if (same) { skipped++; onProgress?.((to - addr) / data.length, 'skip'); continue; }
      if (needErase) { await this.eraseSector(s); erased++; }
      for (let p = 0; p < sector; p += 256) {
        const page = want.subarray(p, p + 256);
        const base = needErase ? null : cur.subarray(p, p + 256);
        if (needErase ? page.every((b) => b === 0xff) : page.every((b, i) => b === base[i])) continue;
        await this.programPage(s + p, page);
        programmed++;
      }
      const back = await this.read(s, sector);
      for (let i = 0; i < sector; i++) {
        if (back[i] !== want[i]) throw new Error(`Verify failed at 0x${(s + i).toString(16).toUpperCase()}: wrote 0x${want[i].toString(16)}, read 0x${back[i].toString(16)}. Is the chip write-protected?`);
      }
      onProgress?.((to - addr) / data.length, 'write');
    }
    return { erased, programmed, skipped };
  }
}

// --- I2C EEPROM ----------------------------------------------------------------

export class I2cEeprom {
  constructor(ch, type = '24C02', deviceAddr = 0x50) {
    const spec = EEPROM_DATABASE[type];
    if (!spec) throw new Error(`Unknown EEPROM type ${type}.`);
    Object.assign(this, { ch, type, deviceAddr, ...spec });
  }

  /** Device address and address bytes for a memory offset (24C04-16 put high bits in the device address). */
  _address(off) {
    if (this.addrBytes === 1) return { dev: this.deviceAddr | ((off >> 8) & 7), bytes: [off & 0xff] };
    return { dev: this.deviceAddr | ((off >> 16) & 3), bytes: [(off >> 8) & 0xff, off & 0xff] };
  }

  async read(onProgress) {
    const out = new Uint8Array(this.size);
    let off = 0;
    while (off < this.size) {
      const n = Math.min(24, this.size - off, 256 - (off % 256)); // don't cross a 256-byte block (24C04-16)
      const { dev, bytes } = this._address(off);
      out.set(await this.ch.i2c([dev << 1, ...bytes], n), off);
      off += n;
      onProgress?.(off / this.size);
    }
    return out;
  }

  async write(data, onProgress) {
    if (data.length > this.size) throw new Error(`${data.length} bytes do not fit a ${this.type} (${this.size} bytes).`);
    const maxData = 32 - 6 - this.addrBytes;
    for (let off = 0; off < data.length;) {
      const n = Math.min(maxData, this.page - (off % this.page), data.length - off);
      const { dev, bytes } = this._address(off);
      await this.ch.i2c([dev << 1, ...bytes, ...data.subarray(off, off + n)]);
      await sleep(6); // write cycle (tWR is 5 ms max)
      off += n;
      onProgress?.(off / data.length);
    }
    const back = await this.read();
    for (let i = 0; i < data.length; i++) {
      if (back[i] !== data[i]) throw new Error(`Verify failed at 0x${i.toString(16)}: is WP tied high?`);
    }
  }
}

// --- Client used by the workbench ---------------------------------------------------

export class Ch341aClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.transport = null;
    this.ch = null;
    this.flash = null;
    this.connected = false;
    this.simulated = false;
    this.detectedChip = null;
  }

  log(msg, type = 'sys') { this.logger?.(`[CH341A] ${msg}`, type); }

  async _attach(transport, simulated) {
    this.transport = transport;
    this.ch = new Ch341(transport);
    await this.ch.configure(1);
    await this.ch.enablePins(true);
    this.flash = new SpiFlash(this.ch);
    this.connected = true;
    this.simulated = simulated;
  }

  async connect() {
    this.log('Requesting CH341A programmer (1A86:5512, the jumper on SPI/I2C)...');
    await this._attach(await Ch341UsbTransport.request(), false);
    this.log('Programmer connected.');
    return true;
  }

  async disconnect() {
    try { await this.ch?.enablePins(false); } catch (e) { /* ignore */ }
    try { await this.transport?.close?.(); } catch (e) { /* ignore */ }
    this.transport = null; this.ch = null; this.flash = null;
    this.connected = false; this.simulated = false; this.detectedChip = null;
    this.log('Disconnected from programmer.');
  }

  _need() { if (!this.connected) throw new Error('Programmer not connected.'); }

  async readJedecId() {
    this._need();
    this.detectedChip = await this.flash.identify();
    this.log(`Detected ${this.detectedChip.manufacturer} ${this.detectedChip.model}.`);
    return this.detectedChip;
  }

  async readFlash(startAddress = 0, length = 65536, onProgress) {
    this._need();
    return this.flash.read(startAddress, length, (f) => onProgress?.(Number((f * 100).toFixed(1)), Math.round(f * length), length));
  }

  async writeFlash(startAddress, dataBytes, onProgress) {
    this._need();
    const r = await this.flash.write(startAddress, dataBytes, (f) => onProgress?.(Number((f * 100).toFixed(1)), Math.round(f * dataBytes.length), dataBytes.length));
    this.log(`Write done: ${r.erased} sectors erased, ${r.programmed} pages programmed, ${r.skipped} sectors already matched; verified.`);
    return r;
  }

  async eraseChip() { this._need(); await this.flash.chipErase(); }
  async readStatus() { this._need(); return this.flash.status(); }
  async writeStatus(sr1, sr2) { this._need(); await this.flash.writeStatus(sr1, sr2); return this.flash.status(); }
  async unprotect() { this._need(); return this.flash.unprotect(); }

  eeprom(type, deviceAddr = 0x50) { this._need(); return new I2cEeprom(this.ch, type, deviceAddr); }
}

