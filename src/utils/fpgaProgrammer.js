/**
 * fpgaProgrammer.js — Lattice iCE40 configuration over an FTDI FT2232H / FT232H
 * (iCEstick, iCEBreaker, UPduino v3, Alchitry Cu) using MPSSE over WebUSB.
 *
 * The flow follows the open-source iceprog tool:
 *   SRAM  : CRESET low + SS low, release CRESET, clock the bitstream, 49+ extra
 *           clocks, then read CDONE.
 *   Flash : hold the FPGA in reset, JEDEC ID (0x9F), erase (0x20 / 0xD8), page
 *           program (0x02) with WIP polling (0x05), read back (0x03) and compare,
 *           then release reset.
 *
 * Pin mapping (iceprog default, channel A = interface 0):
 *   ADBUS0 SCK, ADBUS1 MOSI, ADBUS2 MISO (in), ADBUS4 CS, ADBUS6 CDONE (in), ADBUS7 CRESET.
 *
 * I/O goes through an injected transport so the protocol logic runs in tests
 * against a fake device (see tests/fpgaProgrammer.test.js):
 *
 *     transport.control(request, value, index?) -> Promise<void>   vendor control OUT
 *     transport.write(Uint8Array)               -> Promise<void>   bulk OUT
 *     transport.read(maxLength)                 -> Promise<Uint8Array> bulk IN (raw, status-prefixed)
 *     transport.packetSize                      -> number (64 full speed, 512 high speed)
 *     transport.close()                         -> Promise<void>
 *
 * Nothing here is tested against real hardware yet.
 */

export const FTDI_VENDOR_ID = 0x0403;
/** wIndex for control requests on interface A (interface 0 + 1). */
export const FTDI_INTERFACE_A_INDEX = 1;
export const FTDI_REQUEST = { RESET: 0x00, SET_LATENCY_TIMER: 0x09, SET_BITMODE: 0x0b };
export const FTDI_RESET = { SIO: 0, PURGE_RX: 1, PURGE_TX: 2 };
export const FTDI_BITMODE_MPSSE = 0x02;
/** SET_BITMODE wValue: direction mask 0x00 in the low byte, MPSSE mode in the high byte. */
export const FTDI_BITMODE_MPSSE_VALUE = FTDI_BITMODE_MPSSE << 8;

export const MPSSE = {
  DISABLE_LOOPBACK: 0x85,
  DISABLE_DIV5: 0x8a,
  ENABLE_DIV5: 0x8b,
  SET_CLOCK_DIVISOR: 0x86,
  SET_LOW_BITS: 0x80,
  READ_LOW_BITS: 0x81,
  SET_HIGH_BITS: 0x82,
  CLOCK_OUT_NEG: 0x11, // clock data bytes out, MSB first, on the -ve edge
  CLOCK_IN_OUT_NEG: 0x31, // clock data bytes in and out, MSB first, -ve edge out / +ve edge in
  SEND_IMMEDIATE: 0x87
};

/** ADBUS bit positions on the low byte. */
export const PIN = { SCK: 0x01, MOSI: 0x02, MISO: 0x04, CS: 0x10, CDONE: 0x40, CRESET: 0x80 };
/** Output pins: SCK, MOSI, CS, CRESET. MISO and CDONE are inputs. */
export const PIN_DIR_OUT = PIN.SCK | PIN.MOSI | PIN.CS | PIN.CRESET; // 0x93

export const BASE_CLOCK_HZ = 60e6; // with divide-by-5 disabled
export const DEFAULT_CLOCK_HZ = 15e6;
export const CLOCK_CHOICES_HZ = [30e6, 15e6, 10e6, 6e6];

export const SECTOR_SIZE = 4096;
export const BLOCK_SIZE = 65536;
export const PAGE_SIZE = 256;
/** Max bytes per MPSSE clock command we emit (keeps FTDI buffers comfortable). */
export const SPI_CHUNK = 4096;
/** Never split an MPSSE command across USB writes (each emitted command is at most ~4.1 KB). */
export const WRITE_CHUNK = 65536;
export const READ_REQUEST_BYTES = 512;
/** iCE40 needs at least 49 clocks after the last bitstream byte; 8 bytes = 64 clocks. */
export const EXTRA_CLOCK_BYTES = 8;

export const FLASH_CMD = {
  WRITE_ENABLE: 0x06,
  READ_STATUS: 0x05,
  READ_DATA: 0x03,
  PAGE_PROGRAM: 0x02,
  SECTOR_ERASE_4K: 0x20,
  BLOCK_ERASE_64K: 0xd8,
  READ_JEDEC_ID: 0x9f,
  RELEASE_POWER_DOWN: 0xab
};

/** iCE40 bitstream sync word (the bytes after the leader). */
export const ICE40_SYNC = Uint8Array.of(0x7e, 0xaa, 0x99, 0x7e);
const SYNC_SEARCH_LIMIT = 8192;

export class FpgaProgrammerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FpgaProgrammerError';
  }
}

export class ProgrammerCancelledError extends FpgaProgrammerError {
  constructor() {
    super('Cancelled.');
    this.name = 'ProgrammerCancelledError';
  }
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const toBytes = (x) => {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  return Uint8Array.from(x);
};

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// --- FTDI status header --------------------------------------------------------

/**
 * Every packet an FTDI chip sends on bulk IN starts with two modem/line status bytes.
 * Remove them from each packet of `bytes` (packets are `packetSize` long; the last may be short).
 */
export function stripFtdiStatus(bytes, packetSize = 64) {
  if (!Number.isInteger(packetSize) || packetSize <= 2) throw new RangeError('packetSize must be an integer > 2');
  const src = toBytes(bytes);
  let total = 0;
  for (let off = 0; off < src.length; off += packetSize) {
    total += Math.max(0, Math.min(src.length, off + packetSize) - off - 2);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let off = 0; off < src.length; off += packetSize) {
    const end = Math.min(src.length, off + packetSize);
    if (end - off > 2) {
      out.set(src.subarray(off + 2, end), o);
      o += end - off - 2;
    }
  }
  return out;
}

// --- FTDI control transfers ----------------------------------------------------

/** The vendor control requests needed to put interface A into MPSSE mode. */
export function ftdiInitRequests() {
  return [
    { request: FTDI_REQUEST.RESET, value: FTDI_RESET.SIO },
    { request: FTDI_REQUEST.RESET, value: FTDI_RESET.PURGE_RX },
    { request: FTDI_REQUEST.RESET, value: FTDI_RESET.PURGE_TX },
    { request: FTDI_REQUEST.SET_BITMODE, value: FTDI_BITMODE_MPSSE_VALUE },
    { request: FTDI_REQUEST.SET_LATENCY_TIMER, value: 1 }
  ];
}

// --- MPSSE command builders ------------------------------------------------------

export function mpsseDisableLoopback() {
  return Uint8Array.of(MPSSE.DISABLE_LOOPBACK);
}

export function mpsseDisableDivideBy5() {
  return Uint8Array.of(MPSSE.DISABLE_DIV5);
}

export function mpsseSetClockDivisor(divisor) {
  if (!Number.isInteger(divisor) || divisor < 0 || divisor > 0xffff) throw new RangeError(`divisor ${divisor} out of 0..65535`);
  return Uint8Array.of(MPSSE.SET_CLOCK_DIVISOR, divisor & 0xff, (divisor >> 8) & 0xff);
}

/** Set the low byte (ADBUS0-7): `value` is the output levels, `dir` 1 = output. */
export function mpsseSetLowPins(value, dir = PIN_DIR_OUT) {
  return Uint8Array.of(MPSSE.SET_LOW_BITS, value & 0xff, dir & 0xff);
}

export function mpsseSetHighPins(value, dir = 0) {
  return Uint8Array.of(MPSSE.SET_HIGH_BITS, value & 0xff, dir & 0xff);
}

export function mpsseReadLowPins() {
  return Uint8Array.of(MPSSE.READ_LOW_BITS);
}

export function mpsseSendImmediate() {
  return Uint8Array.of(MPSSE.SEND_IMMEDIATE);
}

function lengthField(n) {
  if (!Number.isInteger(n) || n < 1 || n > 65536) throw new RangeError(`MPSSE byte count ${n} out of 1..65536`);
  const l = n - 1;
  return [l & 0xff, (l >> 8) & 0xff];
}

/** Clock `data` out on MOSI, MSB first, data driven on the falling SCK edge. */
export function mpsseClockOut(data) {
  const bytes = toBytes(data);
  return concatBytes(Uint8Array.of(MPSSE.CLOCK_OUT_NEG, ...lengthField(bytes.length)), bytes);
}

/** Clock `data` out on MOSI while sampling MISO; returns one byte per byte sent. */
export function mpsseClockInOut(data) {
  const bytes = toBytes(data);
  return concatBytes(Uint8Array.of(MPSSE.CLOCK_IN_OUT_NEG, ...lengthField(bytes.length)), bytes);
}

/**
 * Divisor for a wanted SCK frequency with divide-by-5 disabled:
 *   SCK = 60 MHz / ((1 + divisor) * 2)
 */
export function clockDivisorFor(hz) {
  if (!Number.isFinite(hz) || hz <= 0) throw new RangeError('clock must be positive');
  const raw = Math.round(BASE_CLOCK_HZ / (2 * hz)) - 1;
  const divisor = Math.min(0xffff, Math.max(0, raw));
  return { divisor, hz: BASE_CLOCK_HZ / ((divisor + 1) * 2) };
}

// --- Bitstream and flash planning ---------------------------------------------------

/**
 * Check an iCE40 .bin bitstream. The sync word 7E AA 99 7E must appear near the start
 * (icepack output has a short 0xFF/0x00 leader before it). A missing leader is only a warning.
 */
export function inspectBitstream(bytes) {
  const data = toBytes(bytes);
  const result = { size: data.length, syncOffset: -1, hasLeader: false, ok: false, warnings: [], reason: '' };
  if (data.length === 0) {
    result.reason = 'The file is empty.';
    return result;
  }
  result.hasLeader = data[0] === 0xff && data[1] === 0x00;
  const limit = Math.min(data.length - ICE40_SYNC.length, SYNC_SEARCH_LIMIT);
  for (let i = 0; i <= limit; i++) {
    let match = true;
    for (let k = 0; k < ICE40_SYNC.length; k++) {
      if (data[i + k] !== ICE40_SYNC[k]) { match = false; break; }
    }
    if (match) { result.syncOffset = i; break; }
  }
  if (result.syncOffset < 0) {
    result.reason = 'No iCE40 sync word (7E AA 99 7E) in the first 8 KB. This is not an iCE40 .bin bitstream.';
    return result;
  }
  if (!result.hasLeader) result.warnings.push('No 0xFF 0x00 leader at the start; accepted because the sync word is present.');
  result.ok = true;
  return result;
}

function requireBitstream(bytes) {
  const data = toBytes(bytes);
  const info = inspectBitstream(data);
  if (!info.ok) throw new FpgaProgrammerError(info.reason);
  return data;
}

/** Erase operations covering [offset, offset + length), rounded out to 4 KB sectors. */
export function planErase(offset, length) {
  if (length <= 0) return [];
  const start = Math.floor(offset / SECTOR_SIZE) * SECTOR_SIZE;
  const end = Math.ceil((offset + length) / SECTOR_SIZE) * SECTOR_SIZE;
  const ops = [];
  let addr = start;
  while (addr < end) {
    if (addr % BLOCK_SIZE === 0 && addr + BLOCK_SIZE <= end) {
      ops.push({ cmd: FLASH_CMD.BLOCK_ERASE_64K, addr, size: BLOCK_SIZE });
      addr += BLOCK_SIZE;
    } else {
      ops.push({ cmd: FLASH_CMD.SECTOR_ERASE_4K, addr, size: SECTOR_SIZE });
      addr += SECTOR_SIZE;
    }
  }
  return ops;
}

/** Split data at `offset` into page-program pieces that never cross a 256-byte page boundary. */
export function planPages(offset, data) {
  const bytes = toBytes(data);
  const pages = [];
  let pos = 0;
  while (pos < bytes.length) {
    const addr = offset + pos;
    const room = PAGE_SIZE - (addr % PAGE_SIZE);
    const n = Math.min(room, bytes.length - pos);
    pages.push({ addr, bytes: bytes.subarray(pos, pos + n) });
    pos += n;
  }
  return pages;
}

const MANUFACTURERS = {
  0x01: 'Cypress/Spansion',
  0x1f: 'Adesto/Atmel',
  0x20: 'Micron/Numonyx',
  0x85: 'Puya',
  0x9d: 'ISSI',
  0xbf: 'Microchip/SST',
  0xc2: 'Macronix',
  0xc8: 'GigaDevice',
  0xef: 'Winbond'
};

/** Decode a JEDEC ID (manufacturer, memory type, capacity code). */
export function decodeJedec(bytes) {
  const b = toBytes(bytes);
  if (b.length < 3) return null;
  const hex = Array.from(b.subarray(0, 3), (x) => x.toString(16).toUpperCase().padStart(2, '0')).join('');
  const blank = b.subarray(0, 3).every((x) => x === 0x00) || b.subarray(0, 3).every((x) => x === 0xff);
  // Most SPI NOR parts encode capacity as 2^n bytes in the third byte (0x14 = 1 MB, 0x18 = 16 MB).
  const capacityBytes = b[2] >= 0x10 && b[2] <= 0x25 ? 2 ** b[2] : 0;
  return {
    id: hex,
    manufacturer: MANUFACTURERS[b[0]] || 'Unknown',
    capacityBytes,
    answered: !blank
  };
}

/** Board presets: labels and notes. The pin mapping is the same iceprog default for all of them. */
export const BOARD_PRESETS = [
  {
    id: 'icestick',
    name: 'iCEstick (HX1K)',
    chip: 'FT2232H',
    notes: 'FT2232H channel A (interface 0) drives the FPGA SPI and flash; channel B is the UART and is not touched.'
  },
  {
    id: 'icebreaker',
    name: 'iCEBreaker (UP5K)',
    chip: 'FT2232H',
    notes: 'FT2232H channel A (interface 0) drives the FPGA SPI and flash; channel B is the UART and is not touched.'
  },
  {
    id: 'upduino3',
    name: 'UPduino v3 (UP5K)',
    chip: 'FT232H',
    notes: 'Single-channel FT232H. The pin mapping is assumed to be the iceprog default; check your board schematic before programming.'
  },
  {
    id: 'alchitry-cu',
    name: 'Alchitry Cu (HX8K)',
    chip: 'FT232H',
    notes: 'Single-channel FT232H. The pin mapping is assumed to be the iceprog default; check your board schematic before programming.'
  },
  {
    id: 'generic',
    name: 'Generic iCE40 (FT2232H / FT232H)',
    chip: 'FT2232H or FT232H',
    notes: 'Any board that wires the iceprog pinout (ADBUS0 SCK, 1 MOSI, 2 MISO, 4 CS, 6 CDONE, 7 CRESET) to interface A.'
  }
];

// --- FTDI transport over WebUSB ---------------------------------------------------------

export class WebUsbFtdiTransport {
  constructor(device) {
    this.device = device;
    this.interfaceNumber = 0;
    this.epIn = null;
    this.epOut = null;
    this.packetSize = 64;
  }

  /** Ask the user to pick an FTDI device (must run from a click). */
  static async request() {
    if (typeof navigator === 'undefined' || !navigator.usb) {
      throw new FpgaProgrammerError('WebUSB is not available. Use Chrome or Edge over HTTPS or localhost.');
    }
    const device = await navigator.usb.requestDevice({ filters: [{ vendorId: FTDI_VENDOR_ID }] });
    const transport = new WebUsbFtdiTransport(device);
    await transport.open();
    return transport;
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (d.configuration === null) await d.selectConfiguration(1);
    const iface = d.configuration.interfaces.find((i) => i.interfaceNumber === this.interfaceNumber);
    const alt = iface?.alternates?.[0];
    const bulk = (alt?.endpoints || []).filter((e) => e.type === 'bulk');
    this.epIn = bulk.find((e) => e.direction === 'in') || null;
    this.epOut = bulk.find((e) => e.direction === 'out') || null;
    if (!this.epIn || !this.epOut) throw new FpgaProgrammerError('Interface A has no bulk IN/OUT endpoints. Is this an FT2232H or FT232H?');
    this.packetSize = this.epIn.packetSize || 64;
    try {
      await d.claimInterface(this.interfaceNumber);
    } catch (err) {
      throw new FpgaProgrammerError(
        `Could not claim interface A (${err.message}). On Windows, bind WinUSB to interface 0 with Zadig. ` +
        'On Linux, unbind the ftdi_sio driver from interface 0 first.'
      );
    }
  }

  async control(request, value, index = FTDI_INTERFACE_A_INDEX) {
    const r = await this.device.controlTransferOut({ requestType: 'vendor', recipient: 'device', request, value, index });
    if (r.status !== 'ok') throw new FpgaProgrammerError(`FTDI control request 0x${request.toString(16)} failed: ${r.status}`);
  }

  async write(bytes) {
    const r = await this.device.transferOut(this.epOut.endpointNumber, bytes);
    if (r.status !== 'ok') throw new FpgaProgrammerError(`USB OUT failed: ${r.status}`);
  }

  async read(maxLength = READ_REQUEST_BYTES) {
    const r = await this.device.transferIn(this.epIn.endpointNumber, maxLength);
    if (r.status !== 'ok') throw new FpgaProgrammerError(`USB IN failed: ${r.status}`);
    return new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
  }

  async close() {
    try { await this.device.releaseInterface(this.interfaceNumber); } catch (e) { /* ignore */ }
    try { await this.device.close(); } catch (e) { /* ignore */ }
  }
}

// --- MPSSE session ----------------------------------------------------------------

export class FtdiMpsse {
  constructor(transport, { sleep = defaultSleep } = {}) {
    this.transport = transport;
    this.sleep = sleep;
    this.packetSize = transport.packetSize || 64;
    this.readTimeoutMs = 3000;
    /** Current low-byte output levels. Idle: CS deasserted, CRESET released (FPGA running). */
    this.low = PIN.CS | PIN.CRESET;
    this.clockHz = 0;
  }

  async init({ clockHz = DEFAULT_CLOCK_HZ } = {}) {
    for (const req of ftdiInitRequests()) await this.transport.control(req.request, req.value);
    await this.exchange(concatBytes(mpsseDisableLoopback(), mpsseDisableDivideBy5(), this.pinCommand()));
    return this.setClock(clockHz);
  }

  async setClock(hz) {
    const { divisor, hz: actual } = clockDivisorFor(hz);
    await this.exchange(mpsseSetClockDivisor(divisor));
    this.clockHz = actual;
    return actual;
  }

  pinCommand() {
    return mpsseSetLowPins(this.low, PIN_DIR_OUT);
  }

  /** Update CS / CRESET and return the MPSSE command that drives the new levels. */
  pinsCmd({ cs, creset } = {}) {
    if (cs !== undefined) this.low = cs ? this.low | PIN.CS : this.low & ~PIN.CS;
    if (creset !== undefined) this.low = creset ? this.low | PIN.CRESET : this.low & ~PIN.CRESET;
    return this.pinCommand();
  }

  /**
   * Send MPSSE bytes. If `readCount` > 0, a SEND_IMMEDIATE is appended and exactly
   * that many data bytes are collected (status headers removed).
   */
  async exchange(cmd, readCount = 0) {
    const bytes = readCount > 0 ? concatBytes(cmd, mpsseSendImmediate()) : cmd;
    for (let o = 0; o < bytes.length; o += WRITE_CHUNK) {
      await this.transport.write(bytes.subarray(o, o + WRITE_CHUNK));
    }
    if (readCount <= 0) return new Uint8Array(0);
    return this.readData(readCount);
  }

  async readData(count) {
    const out = new Uint8Array(count);
    let got = 0;
    const deadline = Date.now() + this.readTimeoutMs;
    while (got < count) {
      if (Date.now() > deadline) throw new FpgaProgrammerError(`Timed out waiting for FTDI data (got ${got} of ${count} bytes).`);
      const raw = await this.transport.read(READ_REQUEST_BYTES);
      if (raw.length === 0) continue;
      const data = stripFtdiStatus(raw, this.packetSize);
      if (got + data.length > count) throw new FpgaProgrammerError('FTDI returned more data than requested (protocol out of step).');
      out.set(data, got);
      got += data.length;
    }
    return out;
  }

  /** MPSSE bytes for one CS-framed SPI transaction (CS low, out bytes, in clocks, CS high). */
  spiBytes(out, readCount = 0) {
    if (readCount > SPI_CHUNK) throw new RangeError(`use readFlash for more than ${SPI_CHUNK} bytes`);
    const parts = [this.pinsCmd({ cs: false })];
    if (out.length) parts.push(mpsseClockOut(out));
    if (readCount > 0) parts.push(mpsseClockInOut(new Uint8Array(readCount)));
    parts.push(this.pinsCmd({ cs: true }));
    return concatBytes(...parts);
  }

  /** One SPI transaction: send `out`, return `readCount` bytes clocked in. */
  async spi(out, readCount = 0) {
    return this.exchange(this.spiBytes(out, readCount), readCount);
  }

  /** Read `length` bytes starting at `addr` with one CS-framed 0x03 transaction, in chunks. */
  async readFlash(addr, length, { onChunk = () => {}, checkCancel = () => {} } = {}) {
    const out = new Uint8Array(length);
    const header = concatBytes(
      this.pinsCmd({ cs: false }),
      mpsseClockOut(Uint8Array.of(FLASH_CMD.READ_DATA, (addr >> 16) & 0xff, (addr >> 8) & 0xff, addr & 0xff))
    );
    let pending = header;
    try {
      for (let got = 0; got < length;) {
        checkCancel();
        const n = Math.min(SPI_CHUNK, length - got);
        const data = await this.exchange(concatBytes(pending, mpsseClockInOut(new Uint8Array(n))), n);
        pending = new Uint8Array(0);
        out.set(data, got);
        got += n;
        onChunk(got);
      }
    } finally {
      await this.exchange(this.pinsCmd({ cs: true }));
    }
    return out;
  }
}

// --- Programmer -----------------------------------------------------------------

export class Ice40Programmer {
  constructor(transport, { log = () => {}, sleep = defaultSleep, onProgress = () => {} } = {}) {
    this.transport = transport;
    this.mpsse = new FtdiMpsse(transport, { sleep });
    this.sleep = sleep;
    this.log = log;
    this.onProgress = onProgress;
    this.cancelled = false;
    this.flash = null;
  }

  /** Stop the current job after the current USB transfer. */
  cancel() {
    this.cancelled = true;
  }

  checkCancel() {
    if (this.cancelled) throw new ProgrammerCancelledError();
  }

  progress(stage, fraction) {
    this.onProgress({ stage, fraction });
  }

  async connect({ clockHz = DEFAULT_CLOCK_HZ } = {}) {
    this.cancelled = false;
    const actual = await this.mpsse.init({ clockHz });
    this.log(`MPSSE ready. SCK ${(actual / 1e6).toFixed(2)} MHz.`);
    return actual;
  }

  /** Release CRESET so the FPGA runs, then release the USB interface. */
  async close() {
    try {
      await this.mpsse.exchange(this.mpsse.pinsCmd({ cs: true, creset: true }));
    } catch (e) { /* device may already be gone */ }
    await this.transport.close();
  }

  async setClock(clockHz) {
    if (clockHz && Math.abs(clockHz - this.mpsse.clockHz) > 1) await this.mpsse.setClock(clockHz);
  }

  /** Read the JEDEC ID with the FPGA held in reset; reset is released again afterwards. */
  async detectFlash() {
    this.begin();
    const m = this.mpsse;
    await m.exchange(m.pinsCmd({ cs: true, creset: false }));
    let id;
    try {
      await m.spi(Uint8Array.of(FLASH_CMD.RELEASE_POWER_DOWN), 0);
      id = await m.spi(Uint8Array.of(FLASH_CMD.READ_JEDEC_ID), 3);
    } finally {
      await m.exchange(m.pinsCmd({ cs: true, creset: true }));
    }
    const info = decodeJedec(id);
    this.flash = info;
    if (!info.answered) {
      throw new FpgaProgrammerError(
        `No SPI flash answered (JEDEC ${info.id}). Check the flash is powered, the ADBUS wiring and the board preset.`
      );
    }
    this.log(`Flash JEDEC ${info.id}: ${info.manufacturer}${info.capacityBytes ? `, ${info.capacityBytes / 1024} KB` : ', capacity unknown'}.`);
    return info;
  }

  begin() {
    this.cancelled = false;
  }

  /**
   * SRAM load (volatile). Returns { cdone } read after the load.
   */
  async programSram(bitstream, { clockHz } = {}) {
    const bits = requireBitstream(bitstream);
    this.begin();
    await this.setClock(clockHz);
    const m = this.mpsse;
    this.progress('SRAM: resetting FPGA', 0);
    await m.exchange(m.pinsCmd({ cs: false, creset: false }));
    await this.sleep(2);
    await m.exchange(m.pinsCmd({ creset: true }));
    await this.sleep(2); // > 1200 us after CRESET release before configuration starts
    for (let o = 0; o < bits.length; o += SPI_CHUNK) {
      this.checkCancel();
      await m.exchange(mpsseClockOut(bits.subarray(o, o + SPI_CHUNK)));
      this.progress('SRAM: clocking bitstream', Math.min(1, (o + SPI_CHUNK) / bits.length));
    }
    await m.exchange(mpsseClockOut(new Uint8Array(EXTRA_CLOCK_BYTES)));
    const cdoneRead = await m.exchange(concatBytes(m.pinsCmd({ cs: true }), mpsseReadLowPins()), 1);
    const cdone = (cdoneRead[0] & PIN.CDONE) !== 0;
    this.log(cdone ? 'SRAM load done: CDONE is high.' : 'SRAM load finished but CDONE is LOW. The FPGA did not start.');
    this.progress('SRAM: done', 1);
    return { cdone, bytes: bits.length };
  }

  async waitIdle(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      this.checkCancel();
      const status = (await this.mpsse.spi(Uint8Array.of(FLASH_CMD.READ_STATUS), 1))[0];
      if ((status & 1) === 0) return;
      if (Date.now() > deadline) throw new FpgaProgrammerError('Flash stayed busy (WIP) past the timeout.');
    }
  }

  async writeEnable() {
    await this.mpsse.spi(Uint8Array.of(FLASH_CMD.WRITE_ENABLE), 0);
  }

  /**
   * Erase, program, verify and release reset. `offset` is the flash address for byte 0.
   * Returns { bytes, verified: true } on success; throws on a mismatch.
   */
  async programFlash(bitstream, { offset = 0, clockHz } = {}) {
    const bits = requireBitstream(bitstream);
    this.begin();
    await this.setClock(clockHz);
    // detectFlash releases reset when it finishes, so read the ID first and hold reset afterwards.
    const info = this.flash || (await this.detectFlash());
    const m = this.mpsse;
    await m.exchange(m.pinsCmd({ cs: true, creset: false }));
    if (info.capacityBytes && offset + bits.length > info.capacityBytes) {
      throw new FpgaProgrammerError(`Bitstream (${bits.length} bytes at offset ${offset}) does not fit a ${info.capacityBytes / 1024} KB flash.`);
    }
    if (!info.capacityBytes) this.log('Flash capacity is unknown; the bitstream was not checked against it.');

    const erase = planErase(offset, bits.length);
    this.log(`Erasing ${erase.length} block(s).`);
    for (let i = 0; i < erase.length; i++) {
      this.checkCancel();
      const op = erase[i];
      await this.writeEnable();
      await m.exchange(m.spiBytes(Uint8Array.of(op.cmd, (op.addr >> 16) & 0xff, (op.addr >> 8) & 0xff, op.addr & 0xff)));
      await this.waitIdle();
      this.progress('Erasing flash', (i + 1) / erase.length);
    }

    const pages = planPages(offset, bits);
    for (let i = 0; i < pages.length; i++) {
      this.checkCancel();
      const page = pages[i];
      const pp = concatBytes(Uint8Array.of(FLASH_CMD.PAGE_PROGRAM, (page.addr >> 16) & 0xff, (page.addr >> 8) & 0xff, page.addr & 0xff), page.bytes);
      await m.exchange(concatBytes(m.spiBytes(Uint8Array.of(FLASH_CMD.WRITE_ENABLE)), m.spiBytes(pp)));
      await this.waitIdle();
      if (i % 16 === 0 || i === pages.length - 1) this.progress('Programming flash', (i + 1) / pages.length);
    }
    this.log(`Programmed ${bits.length} bytes at 0x${offset.toString(16)}.`);

    const result = await this.verifyFlash(bits, { offset, keepReset: true });
    if (!result.ok) {
      throw new FpgaProgrammerError(`Verify failed at flash address 0x${result.mismatchAt.toString(16)}. The FPGA stays in reset.`);
    }
    await m.exchange(m.pinsCmd({ cs: true, creset: true }));
    this.log('Verified. FPGA reset released; it should boot from flash.');
    this.progress('Flash: done', 1);
    return { bytes: bits.length, verified: true };
  }

  /**
   * Read back [offset, offset + length) and compare with `bitstream`.
   * Reset is released afterwards unless `keepReset` is set (used by programFlash on failure).
   */
  async verifyFlash(bitstream, { offset = 0, keepReset = false } = {}) {
    const bits = toBytes(bitstream);
    const m = this.mpsse;
    await m.exchange(m.pinsCmd({ cs: true, creset: false }));
    try {
      const back = await m.readFlash(offset, bits.length, {
        onChunk: (got) => this.progress('Reading back', got / bits.length),
        checkCancel: () => this.checkCancel()
      });
      for (let i = 0; i < bits.length; i++) {
        if (back[i] !== bits[i]) {
          this.log(`Verify mismatch at 0x${(offset + i).toString(16)}: flash 0x${back[i].toString(16)}, file 0x${bits[i].toString(16)}.`);
          return { ok: false, checked: i, mismatchAt: offset + i };
        }
      }
      this.log(`Verify OK: ${bits.length} bytes match.`);
      return { ok: true, checked: bits.length, mismatchAt: -1 };
    } finally {
      if (!keepReset) await m.exchange(m.pinsCmd({ cs: true, creset: true }));
    }
  }
}
