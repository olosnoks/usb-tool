/**
 * Arduino bootloader uploader.
 *
 * Talks to the bootloader that is already on the board, over its own serial
 * port. It only erases and rewrites the flash pages the sketch needs. Fuses,
 * lock bits and the bootloader itself are never written.
 *
 *  - STK500v1 (Optiboot or ATmegaBOOT): Uno, Nano, Pro Mini. A DTR/RTS pulse
 *    resets the board into the bootloader, then GET_SYNC, READ_SIGN,
 *    LOAD_ADDRESS, PROG_PAGE, READ_PAGE and LEAVE_PROGMODE.
 *  - AVR109 (Caterina): Leonardo, Micro, Pro Micro. A 1200-baud open/close
 *    ("touch") starts the bootloader, which re-enumerates as a different USB
 *    serial port. The user then picks that port. Then S, A, B, g and E.
 *
 * Byte sequences follow avrdude's `arduino` (STK500v1) and `avr109` programmers.
 * Only the serial link is abstracted: anything with write / read / drain /
 * setSignals / close works, so tests drive it with a scripted bootloader.
 */

import { SerialTimeoutError } from './serialLink';

export const PROTOCOL_STK500V1 = 'stk500v1';
export const PROTOCOL_AVR109 = 'avr109';

/** Baud rate that starts a Caterina bootloader when opened and closed. */
export const TOUCH_BAUD = 1200;

/**
 * Board presets. `appLimit` is the first byte of the bootloader area: an image
 * must end at or below it. Sizes are the ATmega328P / ATmega32U4 datasheet
 * values, and the bootloader sizes are the ones each bootloader is built for
 * (Optiboot 512 B, ATmegaBOOT 2 KB, Caterina 4 KB).
 * `signature` is the device signature read back over STK500v1. AVR109 has no
 * signature command, so for those boards it is only shown, never checked.
 */
export const ARDUINO_BOARDS = {
  uno: {
    id: 'uno',
    name: 'Arduino Uno (ATmega328P, Optiboot)',
    protocol: PROTOCOL_STK500V1,
    baud: 115200,
    signature: 0x1e950f,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 32256,
    bootloader: 'Optiboot (512 bytes)'
  },
  'nano-new': {
    id: 'nano-new',
    name: 'Arduino Nano, new bootloader (ATmega328P, Optiboot)',
    protocol: PROTOCOL_STK500V1,
    baud: 115200,
    signature: 0x1e950f,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 32256,
    bootloader: 'Optiboot (512 bytes)'
  },
  'nano-old': {
    id: 'nano-old',
    name: 'Arduino Nano, old bootloader (ATmega328P, ATmegaBOOT)',
    protocol: PROTOCOL_STK500V1,
    baud: 57600,
    signature: 0x1e950f,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 30720,
    bootloader: 'ATmegaBOOT (2 KB)'
  },
  'pro-mini': {
    id: 'pro-mini',
    name: 'Arduino Pro Mini (ATmega328P, 5 V 16 MHz or 3.3 V 8 MHz)',
    protocol: PROTOCOL_STK500V1,
    baud: 57600,
    signature: 0x1e950f,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 30720,
    bootloader: 'ATmegaBOOT (2 KB)'
  },
  leonardo: {
    id: 'leonardo',
    name: 'Arduino Leonardo (ATmega32U4, Caterina)',
    protocol: PROTOCOL_AVR109,
    baud: 57600,
    signature: 0x1e9587,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 28672,
    bootloader: 'Caterina (4 KB)',
    expectedId: 'CATERIN'
  },
  micro: {
    id: 'micro',
    name: 'Arduino Micro (ATmega32U4, Caterina)',
    protocol: PROTOCOL_AVR109,
    baud: 57600,
    signature: 0x1e9587,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 28672,
    bootloader: 'Caterina (4 KB)',
    expectedId: 'CATERIN'
  },
  'pro-micro': {
    id: 'pro-micro',
    name: 'Arduino Pro Micro (ATmega32U4, Caterina)',
    protocol: PROTOCOL_AVR109,
    baud: 57600,
    signature: 0x1e9587,
    flashSize: 32768,
    pageSize: 128,
    appLimit: 28672,
    bootloader: 'Caterina (4 KB)',
    expectedId: 'CATERIN'
  }
};

export const ARDUINO_BOARD_IDS = Object.keys(ARDUINO_BOARDS);

// STK500v1 framing (avrdude arduino.c / Optiboot).
const STK = {
  INSYNC: 0x14,
  OK: 0x10,
  GET_SYNC: 0x30,
  READ_SIGN: 0x75,
  LOAD_ADDRESS: 0x55,
  PROG_PAGE: 0x64,
  READ_PAGE: 0x74,
  LEAVE_PROGMODE: 0x51,
  MEM_FLASH: 0x46, // 'F'
  EOP: 0x20
};

// AVR109 commands (Caterina / avr109). Every command except 'S' and 'g' is
// answered with a single CR (0x0D).
const AVR = {
  SOFTWARE_ID: 0x53, // 'S'  -> 7 ASCII bytes, "CATERIN" for Caterina
  SET_ADDRESS: 0x41, // 'A'  word address, big-endian
  BLOCK_WRITE: 0x42, // 'B'  length (big-endian), memtype, data
  BLOCK_READ: 0x67, // 'g'  length (big-endian), memtype -> data
  EXIT: 0x45, // 'E'  start the application
  CR: 0x0d,
  MEM_FLASH: 0x46 // 'F'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex2 = (n) => (n & 0xff).toString(16).padStart(2, '0').toUpperCase();
const hexAddr = (a) => `0x${a.toString(16).toUpperCase()}`;
const bytesHex = (bytes) => Array.from(bytes, hex2).join(' ');
const asciiOf = (bytes) => String.fromCharCode(...bytes);

export function getBoard(id) {
  const board = ARDUINO_BOARDS[id];
  if (!board) throw new Error(`Unknown board preset "${id}".`);
  return board;
}

/**
 * Split an image into flash pages for `board`. The image is padded with 0xFF
 * (erased flash) out to whole pages, and must lie entirely below `appLimit`.
 * @returns {{ addr: number, data: Uint8Array }[]}
 */
export function buildFlashPages(board, image) {
  const data = image && image.data;
  const start = (image && image.startAddress) || 0;
  if (!data || data.length === 0) throw new Error('The firmware image is empty.');
  const end = start + data.length;
  if (start >= board.appLimit) {
    throw new Error(
      `The image starts at ${hexAddr(start)}, inside the ${board.bootloader} area (from ${hexAddr(board.appLimit)}). Load the sketch .hex (it starts at 0), not a bootloader.`
    );
  }
  if (end > board.appLimit) {
    throw new Error(
      `The image ends at ${hexAddr(end)}, past the ${board.appLimit} bytes this board leaves for sketches (the ${board.bootloader} lives above ${hexAddr(board.appLimit)}).`
    );
  }
  const ps = board.pageSize;
  const base = Math.floor(start / ps) * ps;
  const top = Math.ceil(end / ps) * ps;
  const buf = new Uint8Array(top - base).fill(0xff);
  buf.set(data, start - base);
  const pages = [];
  for (let off = 0; off < buf.length; off += ps) {
    pages.push({ addr: base + off, data: buf.subarray(off, off + ps) });
  }
  return pages;
}

/** First index where the two arrays differ, or -1 when they are equal. */
export function firstMismatch(expected, got) {
  const n = Math.min(expected.length, got.length);
  for (let i = 0; i < n; i++) if (expected[i] !== got[i]) return i;
  return expected.length === got.length ? -1 : n;
}

/**
 * Intel HEX text for `data` placed at `startAddress`. Used for the read-back
 * dump; readable by parseIntelHex and by avrdude.
 */
export function toIntelHex(data, startAddress = 0, recordLength = 16) {
  const out = [];
  const record = (type, addr, bytes) => {
    let sum = bytes.length + ((addr >> 8) & 0xff) + (addr & 0xff) + type;
    let s = `:${hex2(bytes.length)}${(addr & 0xffff).toString(16).toUpperCase().padStart(4, '0')}${hex2(type)}`;
    for (const b of bytes) {
      s += hex2(b);
      sum += b;
    }
    return s + hex2(-sum);
  };
  let upper = -1;
  for (let off = 0; off < data.length; off += recordLength) {
    const addr = startAddress + off;
    const hi = Math.floor(addr / 0x10000);
    if (hi !== upper) {
      out.push(record(0x04, 0, [(hi >> 8) & 0xff, hi & 0xff]));
      upper = hi;
    }
    const n = Math.min(recordLength, data.length - off);
    out.push(record(0x00, addr & 0xffff, data.subarray(off, off + n)));
  }
  out.push(':00000001FF');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// STK500v1 (Optiboot / ATmegaBOOT)
// ---------------------------------------------------------------------------

export class Stk500v1Programmer {
  /**
   * @param {{ write(b: Uint8Array|number[]): Promise<void>, read(n: number, ms: number, what?: string): Promise<Uint8Array>, drain(ms?: number): Promise<number> }} link
   */
  constructor(link, { timeoutMs = 1000, log = () => {} } = {}) {
    this.link = link;
    this.timeoutMs = timeoutMs;
    this.log = log;
  }

  /** [INSYNC, OK] or throw, for commands that answer with no payload. */
  async _expectOk(bytes, what) {
    await this.link.write(bytes);
    const r = await this.link.read(2, this.timeoutMs, what);
    if (r[0] !== STK.INSYNC || r[1] !== STK.OK) {
      throw new Error(`${what}: the bootloader answered ${bytesHex(r)} (expected 14 10).`);
    }
  }

  /** GET_SYNC (30 20) until the bootloader answers 14 10. Optiboot waits about a second after reset. */
  async sync(attempts = 20) {
    for (let i = 0; i < attempts; i++) {
      await this.link.write([STK.GET_SYNC, STK.EOP]);
      try {
        const r = await this.link.read(2, 150, 'the sync reply');
        if (r[0] === STK.INSYNC && r[1] === STK.OK) {
          this.log('Bootloader in sync.');
          return;
        }
      } catch (e) {
        if (!(e instanceof SerialTimeoutError)) throw e;
      }
      await this.link.drain(10);
    }
    throw new Error(
      'The board did not answer the STK500v1 sync (30 20). Check the board and the selected preset (baud rate), and that its bootloader is present.'
    );
  }

  /** READ_SIGN (75 20): the three signature bytes as one number, e.g. 0x1E950F. */
  async readSignature() {
    await this.link.write([STK.READ_SIGN, STK.EOP]);
    const r = await this.link.read(5, this.timeoutMs, 'the signature');
    if (r[0] !== STK.INSYNC || r[4] !== STK.OK) {
      throw new Error(`Reading the signature failed: the bootloader answered ${bytesHex(r)}.`);
    }
    return ((r[1] << 16) | (r[2] << 8) | r[3]) >>> 0;
  }

  /** LOAD_ADDRESS (55 lo hi 20). The address is a WORD address (byte address / 2). */
  async loadAddress(wordAddr) {
    if (wordAddr < 0 || wordAddr > 0xffff) throw new Error(`Word address ${hexAddr(wordAddr)} out of range.`);
    await this._expectOk([STK.LOAD_ADDRESS, wordAddr & 0xff, (wordAddr >> 8) & 0xff, STK.EOP], 'Load address');
  }

  /** PROG_PAGE (64 len-hi len-lo 'F' data 20): writes at the address set by loadAddress. */
  async programPage(data) {
    const n = data.length;
    const frame = new Uint8Array(n + 5);
    frame[0] = STK.PROG_PAGE;
    frame[1] = (n >> 8) & 0xff;
    frame[2] = n & 0xff;
    frame[3] = STK.MEM_FLASH;
    frame.set(data, 4);
    frame[n + 4] = STK.EOP;
    await this._expectOk(frame, 'Write page');
  }

  /** READ_PAGE (74 len-hi len-lo 'F' 20) -> `n` bytes of flash at the address set by loadAddress. */
  async readPage(n) {
    await this.link.write([STK.READ_PAGE, (n >> 8) & 0xff, n & 0xff, STK.MEM_FLASH, STK.EOP]);
    const r = await this.link.read(n + 2, this.timeoutMs, 'a flash read');
    if (r[0] !== STK.INSYNC || r[n + 1] !== STK.OK) {
      throw new Error(`Reading flash failed: the bootloader answered ${bytesHex(r.subarray(0, 2))} ... (expected 14 ... 10).`);
    }
    return r.subarray(1, n + 1);
  }

  /** LEAVE_PROGMODE (51 20): the bootloader starts the sketch. */
  async leave() {
    await this._expectOk([STK.LEAVE_PROGMODE, STK.EOP], 'Leave programming mode');
  }
}

/**
 * Reset an Uno / Nano / Pro Mini into its bootloader: a DTR and RTS pulse
 * (the auto-reset circuit), then a short wait for the bootloader to start.
 */
export async function enterStk500Bootloader(link, { resetPulseMs = 250, bootWaitMs = 300 } = {}) {
  await link.setSignals({ dataTerminalReady: false, requestToSend: false });
  await sleep(resetPulseMs);
  await link.setSignals({ dataTerminalReady: true, requestToSend: true });
  await sleep(bootWaitMs);
  await link.drain(20);
}

// ---------------------------------------------------------------------------
// AVR109 (Caterina)
// ---------------------------------------------------------------------------

export class Avr109Programmer {
  constructor(link, { timeoutMs = 1000, log = () => {} } = {}) {
    this.link = link;
    this.timeoutMs = timeoutMs;
    this.log = log;
  }

  /** Commands answered with one CR. */
  async _ack(bytes, what) {
    await this.link.write(bytes);
    const r = await this.link.read(1, this.timeoutMs, what);
    if (r[0] !== AVR.CR) throw new Error(`${what}: the bootloader answered ${hex2(r[0])} (expected 0D).`);
  }

  /** 'S' -> the 7-byte software id ("CATERIN" on Caterina). */
  async softwareId() {
    await this.link.write([AVR.SOFTWARE_ID]);
    const r = await this.link.read(7, this.timeoutMs, 'the bootloader id');
    return asciiOf(r);
  }

  /** 'A' + word address, big-endian. */
  async setAddress(wordAddr) {
    if (wordAddr < 0 || wordAddr > 0xffff) throw new Error(`Word address ${hexAddr(wordAddr)} out of range.`);
    await this._ack([AVR.SET_ADDRESS, (wordAddr >> 8) & 0xff, wordAddr & 0xff], 'Set address');
  }

  /** 'B' + length (big-endian) + 'F' + data. Writes at the address set by setAddress. */
  async writeBlock(data) {
    const n = data.length;
    const frame = new Uint8Array(n + 4);
    frame[0] = AVR.BLOCK_WRITE;
    frame[1] = (n >> 8) & 0xff;
    frame[2] = n & 0xff;
    frame[3] = AVR.MEM_FLASH;
    frame.set(data, 4);
    await this._ack(frame, 'Write block');
  }

  /** 'g' + length (big-endian) + 'F' -> `n` bytes of flash. */
  async readBlock(n) {
    await this.link.write([AVR.BLOCK_READ, (n >> 8) & 0xff, n & 0xff, AVR.MEM_FLASH]);
    return this.link.read(n, this.timeoutMs, 'a flash read');
  }

  /** 'E': leave the bootloader and start the sketch. */
  async exit() {
    await this._ack([AVR.EXIT], 'Exit bootloader');
  }
}

/**
 * The 1200-baud touch. Opening the Caterina port at 1200 baud and closing it
 * makes the bootloader start. The board then re-enumerates as a NEW serial
 * port, so the caller must ask the user to pick that port next.
 * @param {{ open(o: object): Promise<void>, close(): Promise<void> }} port  an unopened SerialPort
 */
export async function touchForBootloader(port) {
  await port.open({ baudRate: TOUCH_BAUD });
  await sleep(100);
  await port.close();
}

// ---------------------------------------------------------------------------
// Whole-board operations
// ---------------------------------------------------------------------------

function checkAbort(shouldAbort) {
  if (shouldAbort && shouldAbort()) throw new Error('Stopped by the user. The board may hold a partly written sketch: upload again before running it.');
}

function checkSignature(board, sig) {
  if (sig !== board.signature) {
    throw new Error(
      `The board reports signature ${hexAddr(sig)}, not ${hexAddr(board.signature)} for ${board.name}. Pick the right board preset. Nothing was written.`
    );
  }
}

function checkBootloaderId(board, id) {
  if (id !== board.expectedId) {
    throw new Error(
      `The port answered "${id}" instead of "${board.expectedId}". Select the bootloader port that appeared after the 1200-baud touch, not the normal Arduino port.`
    );
  }
}

/**
 * Write `image` to the board and read every written page back to compare.
 * Resolves only when the verify pass matched, so a return value means verified.
 *
 * @param {object} link  an open transport (SerialLink or a test double)
 * @param {object} board  a preset from ARDUINO_BOARDS
 * @param {{ data: Uint8Array, startAddress?: number }} image
 * @param {{ onProgress?: (p: object) => void, log?: (s: string) => void, shouldAbort?: () => boolean, resetPulseMs?: number, bootWaitMs?: number, timeoutMs?: number }} [opts]
 */
export async function programBoard(link, board, image, opts = {}) {
  const { onProgress = () => {}, log = () => {}, shouldAbort, resetPulseMs, bootWaitMs, timeoutMs } = opts;
  const pages = buildFlashPages(board, image);
  const total = pages.length;
  const bytes = total * board.pageSize;

  if (board.protocol === PROTOCOL_STK500V1) {
    const prog = new Stk500v1Programmer(link, { timeoutMs, log });
    log('Resetting the board (DTR/RTS pulse).');
    await enterStk500Bootloader(link, { resetPulseMs, bootWaitMs });
    await prog.sync();
    const sig = await prog.readSignature();
    checkSignature(board, sig);
    log(`Signature ${hexAddr(sig)} matches ${board.name}.`);

    for (let i = 0; i < total; i++) {
      checkAbort(shouldAbort);
      await prog.loadAddress(pages[i].addr >> 1);
      await prog.programPage(pages[i].data);
      onProgress({ phase: 'write', done: i + 1, total });
    }
    log(`Wrote ${bytes} bytes in ${total} pages. Verifying.`);

    for (let i = 0; i < total; i++) {
      checkAbort(shouldAbort);
      await prog.loadAddress(pages[i].addr >> 1);
      const got = await prog.readPage(board.pageSize);
      const bad = firstMismatch(pages[i].data, got);
      if (bad >= 0) {
        throw new Error(
          `Verify failed at ${hexAddr(pages[i].addr + bad)}: wrote ${hex2(pages[i].data[bad])}, read back ${hex2(got[bad])}. Upload again; if it repeats, check the cable and the baud rate.`
        );
      }
      onProgress({ phase: 'verify', done: i + 1, total });
    }
    await prog.leave();
    log('Verified. Bootloader released the board to run the sketch.');
    return { pages: total, bytes, verified: true, signature: sig };
  }

  if (board.protocol === PROTOCOL_AVR109) {
    const prog = new Avr109Programmer(link, { timeoutMs, log });
    checkBootloaderId(board, await prog.softwareId());
    log(`Bootloader ${board.expectedId} found.`);

    for (let i = 0; i < total; i++) {
      checkAbort(shouldAbort);
      await prog.setAddress(pages[i].addr >> 1);
      await prog.writeBlock(pages[i].data);
      onProgress({ phase: 'write', done: i + 1, total });
    }
    log(`Wrote ${bytes} bytes in ${total} blocks. Verifying.`);

    for (let i = 0; i < total; i++) {
      checkAbort(shouldAbort);
      await prog.setAddress(pages[i].addr >> 1);
      const got = await prog.readBlock(board.pageSize);
      const bad = firstMismatch(pages[i].data, got);
      if (bad >= 0) {
        throw new Error(
          `Verify failed at ${hexAddr(pages[i].addr + bad)}: wrote ${hex2(pages[i].data[bad])}, read back ${hex2(got[bad])}. Upload again; if it repeats, check the port and the cable.`
        );
      }
      onProgress({ phase: 'verify', done: i + 1, total });
    }
    await prog.exit();
    log('Verified. Bootloader exited and the sketch was started.');
    return { pages: total, bytes, verified: true, signature: null };
  }

  throw new Error(`Unsupported protocol "${board.protocol}".`);
}

/**
 * Read the whole flash (all `board.flashSize` bytes) back from the board.
 * The bootloader area is read too when the bootloader allows it. The board
 * is released to run its sketch at the end.
 * @returns {Promise<Uint8Array>}
 */
export async function readBoardFlash(link, board, opts = {}) {
  const { onProgress = () => {}, log = () => {}, shouldAbort, resetPulseMs, bootWaitMs, timeoutMs } = opts;
  const ps = board.pageSize;
  const total = board.flashSize / ps;
  const out = new Uint8Array(board.flashSize);

  if (board.protocol === PROTOCOL_STK500V1) {
    const prog = new Stk500v1Programmer(link, { timeoutMs, log });
    await enterStk500Bootloader(link, { resetPulseMs, bootWaitMs });
    await prog.sync();
    checkSignature(board, await prog.readSignature());
    for (let i = 0; i < total; i++) {
      checkAbort(shouldAbort);
      await prog.loadAddress((i * ps) >> 1);
      out.set(await prog.readPage(ps), i * ps);
      onProgress({ phase: 'read', done: i + 1, total });
    }
    await prog.leave();
    return out;
  }

  if (board.protocol === PROTOCOL_AVR109) {
    const prog = new Avr109Programmer(link, { timeoutMs, log });
    checkBootloaderId(board, await prog.softwareId());
    for (let i = 0; i < total; i++) {
      checkAbort(shouldAbort);
      await prog.setAddress((i * ps) >> 1);
      out.set(await prog.readBlock(ps), i * ps);
      onProgress({ phase: 'read', done: i + 1, total });
    }
    await prog.exit();
    return out;
  }

  throw new Error(`Unsupported protocol "${board.protocol}".`);
}

/** CRC-32 (IEEE, as used by zip/PNG) of `data`, as an unsigned integer. */
export function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Size facts about an image for `board`: byte count, share of the sketch area
 * and of the whole flash, pages touched and a CRC-32 of the data bytes.
 */
export function imageStats(board, image) {
  const data = image.data;
  const start = image.startAddress || 0;
  const pages = Math.ceil((start + data.length) / board.pageSize) - Math.floor(start / board.pageSize);
  return {
    bytes: data.length,
    start,
    end: start + data.length,
    pages,
    sketchAreaPct: Math.round(((start + data.length) / board.appLimit) * 1000) / 10,
    flashPct: Math.round(((start + data.length) / board.flashSize) * 1000) / 10,
    freeBytes: Math.max(0, board.appLimit - (start + data.length)),
    crc32: crc32(data)
  };
}

/**
 * Compare flash read from a board with an image (verify only, no writing).
 * Only the image's own byte range is compared. Returns the mismatching byte
 * count, the first mismatching address and up to `maxRanges` differing runs.
 */
export function compareFlashToImage(flash, image, maxRanges = 8) {
  const start = image.startAddress || 0;
  const data = image.data;
  if (start + data.length > flash.length) {
    throw new Error('The image is larger than the flash that was read.');
  }
  let mismatches = 0;
  let first = -1;
  const ranges = [];
  let cur = null;
  for (let i = 0; i < data.length; i++) {
    if (flash[start + i] !== data[i]) {
      mismatches++;
      if (first < 0) first = start + i;
      if (cur && cur.end === start + i) cur.end++;
      else {
        cur = { start: start + i, end: start + i + 1 };
        if (ranges.length < maxRanges) ranges.push(cur);
      }
    } else cur = null;
  }
  return { match: mismatches === 0, checked: data.length, mismatches, firstAddress: first, ranges };
}

const AVRDUDE_PART = { 0x1e950f: 'm328p', 0x1e9587: 'm32u4' };
const AVRDUDE_PROGRAMMER = { stk500v1: 'arduino', avr109: 'avr109' };

/**
 * avrdude command line equivalent to this tool's write (or verify-only) for
 * `board`. Export for the CLI tool: this app does not run avrdude. The port
 * is a placeholder because the browser never exposes the real port name.
 */
export function avrdudeCommand(board, fileName = 'sketch.hex', { verifyOnly = false, port = '<PORT>' } = {}) {
  const part = AVRDUDE_PART[board.signature] || 'm328p';
  const programmer = AVRDUDE_PROGRAMMER[board.protocol] || 'arduino';
  const quoted = /[\s"'$`\\]/.test(fileName) ? `"${fileName.replace(/(["\\$`])/g, '\\$1')}"` : fileName;
  const parts = ['avrdude', `-p ${part}`, `-c ${programmer}`, `-P ${port}`];
  if (board.protocol === PROTOCOL_STK500V1) parts.push(`-b ${board.baud}`);
  parts.push(`-U flash:${verifyOnly ? 'v' : 'w'}:${quoted}:i`);
  return parts.join(' ');
}
