import { describe, it, expect } from 'vitest';
import {
  PIN,
  PIN_DIR_OUT,
  FTDI_BITMODE_MPSSE_VALUE,
  FLASH_CMD,
  stripFtdiStatus,
  mpsseClockOut,
  mpsseClockInOut,
  mpsseSetClockDivisor,
  mpsseSetLowPins,
  mpsseSendImmediate,
  clockDivisorFor,
  inspectBitstream,
  planErase,
  planPages,
  decodeJedec,
  Ice40Programmer,
  FpgaProgrammerError
} from '../src/utils/fpgaProgrammer';

// --- Fake FTDI device -------------------------------------------------------------
//
// Interprets the MPSSE bytes the driver writes and routes SPI traffic to a simulated
// bus: an SPI NOR flash (used while CRESET is low) or an iCE40 configuration port
// (used while CRESET is high). Read-back data is wrapped in 2-byte FTDI status headers
// per packet, so the driver's stripping is exercised end to end.

class FakeSpiFlash {
  constructor({ size = 1 << 20, jedec = [0xef, 0x40, 0x14] } = {}) {
    this.mem = new Uint8Array(size).fill(0xff);
    this.jedec = jedec;
    this.wel = false;
    this.busyReads = 0;
    this.ops = [];
    this.resetCommand();
  }

  resetCommand() {
    this.cmd = null;
    this.args = [];
    this.readAddr = 0;
    this.pendingWrite = null;
  }

  csLow() { this.resetCommand(); }

  csHigh() {
    const c = this.cmd;
    if (c === FLASH_CMD.SECTOR_ERASE_4K || c === FLASH_CMD.BLOCK_ERASE_64K) {
      if (!this.wel) throw new Error('erase without WREN');
      const size = c === FLASH_CMD.BLOCK_ERASE_64K ? 65536 : 4096;
      const addr = this.addr3();
      this.mem.fill(0xff, addr, addr + size);
      this.ops.push({ op: c === FLASH_CMD.BLOCK_ERASE_64K ? 'erase64k' : 'erase4k', addr });
      this.wel = false;
      this.busyReads = 2;
    }
    if (c === FLASH_CMD.PAGE_PROGRAM) {
      this.wel = false;
      this.busyReads = 2;
    }
    this.resetCommand();
  }

  addr3() {
    return (this.args[0] << 16) | (this.args[1] << 8) | this.args[2];
  }

  spiByte(b) {
    if (this.cmd === null) {
      this.cmd = b;
      if (b === FLASH_CMD.WRITE_ENABLE) this.wel = true;
      return 0;
    }
    switch (this.cmd) {
      case FLASH_CMD.READ_JEDEC_ID: {
        const i = this.args.length;
        this.args.push(b);
        return this.jedec[i] ?? 0;
      }
      case FLASH_CMD.READ_STATUS: {
        const busy = this.busyReads > 0 ? 1 : 0;
        if (this.busyReads > 0) this.busyReads -= 1;
        return busy | (this.wel ? 2 : 0);
      }
      case FLASH_CMD.READ_DATA: {
        if (this.args.length < 3) {
          this.args.push(b);
          return 0;
        }
        const addr = this.addr3() + this.readAddr;
        this.readAddr += 1;
        return this.mem[addr % this.mem.length];
      }
      case FLASH_CMD.PAGE_PROGRAM: {
        if (this.args.length < 3) {
          this.args.push(b);
          if (this.args.length === 3) {
            if (!this.wel) throw new Error('page program without WREN');
            this.pendingWrite = this.addr3();
            this.ops.push({ op: 'pageprogram', addr: this.pendingWrite });
          }
          return 0;
        }
        const pageBase = this.pendingWrite & ~0xff;
        const idx = this.pendingWrite & 0xff;
        // Flash programming can only clear bits (AND).
        this.mem[pageBase + idx] &= b;
        this.pendingWrite = pageBase + ((idx + 1) & 0xff);
        return 0;
      }
      case FLASH_CMD.SECTOR_ERASE_4K:
      case FLASH_CMD.BLOCK_ERASE_64K:
        this.args.push(b);
        return 0;
      default:
        return 0;
    }
  }
}

class FakeFpga {
  constructor() {
    this.loaded = [];
    this.cdone = false;
    this.zeroRun = 0;
    this.sawSync = false;
    this.window = [];
  }

  csLow() {}

  csHigh() {
    if (this.sawSync && this.zeroRun >= 7) this.cdone = true;
  }

  spiByte(b) {
    this.loaded.push(b);
    this.zeroRun = b === 0 ? this.zeroRun + 1 : 0;
    this.window = [...this.window, b].slice(-4);
    if (this.window.join(',') === '126,170,153,126') this.sawSync = true;
    return 0;
  }
}

class FakeFtdiTransport {
  constructor({ flash, fpga, packetSize = 64 }) {
    this.flash = flash;
    this.fpga = fpga;
    this.packetSize = packetSize;
    this.controls = [];
    this.writes = [];
    this.pending = [];
    this.low = PIN.CS | PIN.CRESET;
    this.lowDir = 0;
    this.divisor = null;
    this.closed = false;
  }

  async control(request, value, index = 1) {
    this.controls.push({ request, value, index });
  }

  async write(bytes) {
    const copy = Uint8Array.from(bytes);
    this.writes.push(copy);
    this.interpret(copy);
  }

  /** Returns one or more FTDI packets (status header + payload), like a real bulk IN. */
  async read(maxLen) {
    const out = [];
    do {
      const payload = this.pending.splice(0, this.packetSize - 2);
      out.push(0x01, 0x60, ...payload);
    } while (this.pending.length > 0 && out.length + this.packetSize <= maxLen);
    return Uint8Array.from(out);
  }

  async close() {
    this.closed = true;
  }

  target() {
    return this.low & PIN.CRESET ? this.fpga : this.flash;
  }

  setLow(value) {
    const wasCs = this.low & PIN.CS;
    this.low = value;
    const nowCs = this.low & PIN.CS;
    if (wasCs && !nowCs) {
      this.flash.csLow();
      this.fpga.csLow();
    } else if (!wasCs && nowCs) {
      this.flash.csHigh();
      this.fpga.csHigh();
    }
  }

  spiByteFromMaster(b) {
    // Only talk to the slave when CS is asserted.
    if (this.low & PIN.CS) return 0;
    return this.target().spiByte(b);
  }

  interpret(bytes) {
    let i = 0;
    while (i < bytes.length) {
      const op = bytes[i++];
      switch (op) {
        case 0x85:
        case 0x8a:
        case 0x8b:
        case 0x87:
          break;
        case 0x86:
          this.divisor = bytes[i] | (bytes[i + 1] << 8);
          i += 2;
          break;
        case 0x80:
          this.lowDir = bytes[i + 1];
          this.setLow(bytes[i]);
          i += 2;
          break;
        case 0x82:
          i += 2;
          break;
        case 0x81: {
          const cdone = this.fpga.cdone ? PIN.CDONE : 0;
          this.pending.push((this.low & (PIN.CS | PIN.CRESET | PIN.MOSI)) | cdone);
          break;
        }
        case 0x11:
        case 0x31: {
          const n = (bytes[i] | (bytes[i + 1] << 8)) + 1;
          i += 2;
          for (let k = 0; k < n; k++) {
            const out = this.spiByteFromMaster(bytes[i + k]);
            if (op === 0x31) this.pending.push(out);
          }
          i += n;
          break;
        }
        default:
          throw new Error(`unexpected MPSSE opcode 0x${op.toString(16)} at byte ${i - 1}`);
      }
    }
  }
}

const sleepNone = async () => {};

/** Synthetic iCE40-style bitstream: 0xFF 0x00 leader, filler, sync word, payload, trailing zeros. */
function makeBitstream(payloadLength, seed = 1) {
  const bytes = [0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0x7e, 0xaa, 0x99, 0x7e];
  let x = seed;
  for (let i = 0; i < payloadLength; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    bytes.push((x >> 16) & 0xff);
  }
  return Uint8Array.from(bytes);
}

const hexOf = (arr) => Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join(' ');

// --- MPSSE builders ---------------------------------------------------------------

describe('MPSSE command builders', () => {
  it('builds the clock-out command with a little-endian length (n - 1)', () => {
    expect(hexOf(mpsseClockOut(Uint8Array.of(0xde, 0xad)))).toBe('11 01 00 de ad');
    expect(hexOf(mpsseClockOut(Uint8Array.of(0x55)))).toBe('11 00 00 55');
  });

  it('builds the clock-in/out command (0x31) with the data bytes after the length', () => {
    expect(hexOf(mpsseClockInOut(new Uint8Array(3)))).toBe('31 02 00 00 00 00');
  });

  it('rejects byte counts outside 1..65536', () => {
    expect(() => mpsseClockOut(new Uint8Array(0))).toThrow(RangeError);
    expect(() => mpsseClockOut(new Uint8Array(65537))).toThrow(RangeError);
    expect(mpsseClockOut(new Uint8Array(65536))[1]).toBe(0xff);
  });

  it('builds the clock divisor command (0x86, low byte first)', () => {
    expect(hexOf(mpsseSetClockDivisor(0x0102))).toBe('86 02 01');
    expect(() => mpsseSetClockDivisor(0x10000)).toThrow(RangeError);
  });

  it('builds set-low-GPIO (0x80) with value and direction, and send-immediate (0x87)', () => {
    expect(hexOf(mpsseSetLowPins(0x90, PIN_DIR_OUT))).toBe('80 90 93');
    expect(mpsseSendImmediate()[0]).toBe(0x87);
  });

  it('uses the iceprog pin mapping: SCK, MOSI, CS, CRESET outputs', () => {
    expect(PIN.SCK).toBe(0x01);
    expect(PIN.MOSI).toBe(0x02);
    expect(PIN.MISO).toBe(0x04);
    expect(PIN.CS).toBe(0x10);
    expect(PIN.CDONE).toBe(0x40);
    expect(PIN.CRESET).toBe(0x80);
    expect(PIN_DIR_OUT).toBe(0x93);
  });

  it('computes the clock divisor for 60 MHz base with divide-by-5 disabled', () => {
    expect(clockDivisorFor(30e6)).toMatchObject({ divisor: 0, hz: 30e6 });
    expect(clockDivisorFor(15e6)).toMatchObject({ divisor: 1, hz: 15e6 });
    expect(clockDivisorFor(10e6)).toMatchObject({ divisor: 2, hz: 10e6 });
    expect(clockDivisorFor(6e6)).toMatchObject({ divisor: 4, hz: 6e6 });
    expect(clockDivisorFor(1)).toMatchObject({ divisor: 0xffff });
  });

  it('uses the MPSSE bitmode value (mode 0x02 in the high byte)', () => {
    expect(FTDI_BITMODE_MPSSE_VALUE).toBe(0x0200);
  });
});

// --- Status header stripping --------------------------------------------------------

describe('stripFtdiStatus', () => {
  it('removes the 2-byte modem status from every packet', () => {
    // packetSize 5: [s0 s1 a b c] [s0 s1 d]
    const raw = Uint8Array.of(0x01, 0x60, 10, 11, 12, 0x01, 0x60, 13);
    expect(Array.from(stripFtdiStatus(raw, 5))).toEqual([10, 11, 12, 13]);
  });

  it('yields nothing for a status-only packet', () => {
    expect(stripFtdiStatus(Uint8Array.of(0x01, 0x60), 64).length).toBe(0);
  });

  it('handles several full 64-byte packets', () => {
    const raw = new Uint8Array(64 * 3);
    for (let p = 0; p < 3; p++) {
      raw[p * 64] = 0x01;
      raw[p * 64 + 1] = 0x60;
      for (let i = 2; i < 64; i++) raw[p * 64 + i] = p * 100 + i;
    }
    const data = stripFtdiStatus(raw, 64);
    expect(data.length).toBe(3 * 62);
    expect(data[0]).toBe(2);
    expect(data[61]).toBe(63);
    expect(data[62]).toBe(102);
  });

  it('rejects a packet size that cannot carry a payload', () => {
    expect(() => stripFtdiStatus(new Uint8Array(4), 2)).toThrow(RangeError);
  });
});

// --- Bitstream and flash planning ---------------------------------------------------

describe('bitstream header detection', () => {
  it('accepts a bitstream with the sync word and the 0xFF 0x00 leader', () => {
    const info = inspectBitstream(makeBitstream(100));
    expect(info.ok).toBe(true);
    expect(info.hasLeader).toBe(true);
    expect(info.syncOffset).toBe(6);
    expect(info.warnings).toEqual([]);
  });

  it('accepts a sync word without the leader but warns', () => {
    const info = inspectBitstream(Uint8Array.of(0x00, 0x7e, 0xaa, 0x99, 0x7e, 0x01));
    expect(info.ok).toBe(true);
    expect(info.hasLeader).toBe(false);
    expect(info.warnings.length).toBe(1);
  });

  it('rejects a file without the sync word', () => {
    const info = inspectBitstream(Uint8Array.of(0xff, 0x00, 1, 2, 3, 4, 5));
    expect(info.ok).toBe(false);
    expect(info.reason).toMatch(/sync/);
  });

  it('rejects an empty file', () => {
    expect(inspectBitstream(new Uint8Array(0)).ok).toBe(false);
  });
});

describe('flash planning', () => {
  it('erases one 4 KB sector for a short bitstream at offset 0', () => {
    expect(planErase(0, 3000)).toEqual([{ cmd: FLASH_CMD.SECTOR_ERASE_4K, addr: 0, size: 4096 }]);
  });

  it('uses 64 KB blocks where a full block fits and 4 KB sectors for the tail', () => {
    const ops = planErase(0, 70000);
    expect(ops[0]).toEqual({ cmd: FLASH_CMD.BLOCK_ERASE_64K, addr: 0, size: 65536 });
    expect(ops.slice(1).map((o) => o.addr)).toEqual([65536, 69632]);
    expect(ops.slice(1).every((o) => o.cmd === FLASH_CMD.SECTOR_ERASE_4K)).toBe(true);
  });

  it('splits page programming at 256-byte page boundaries', () => {
    const pages = planPages(250, Uint8Array.from({ length: 10 }, (_, i) => i));
    expect(pages.map((p) => [p.addr, p.bytes.length])).toEqual([[250, 6], [256, 4]]);
    expect(Array.from(pages[1].bytes)).toEqual([6, 7, 8, 9]);
  });

  it('decodes a JEDEC ID', () => {
    expect(decodeJedec(Uint8Array.of(0xef, 0x40, 0x14))).toEqual({
      id: 'EF4014',
      manufacturer: 'Winbond',
      capacityBytes: 1 << 20,
      answered: true
    });
    expect(decodeJedec(Uint8Array.of(0xff, 0xff, 0xff)).answered).toBe(false);
  });
});

// --- Programmer flows against the fake device ---------------------------------------

function setup({ flashSize, packetSize, jedec } = {}) {
  const flash = new FakeSpiFlash({
    ...(flashSize ? { size: flashSize } : {}),
    ...(jedec ? { jedec } : {})
  });
  const fpga = new FakeFpga();
  const transport = new FakeFtdiTransport({ flash, fpga, packetSize });
  const logs = [];
  const programmer = new Ice40Programmer(transport, { sleep: sleepNone, log: (t) => logs.push(t) });
  return { flash, fpga, transport, programmer, logs };
}

describe('Ice40Programmer on a fake FT232H/FT2232H', () => {
  it('initialises interface A with the FTDI control requests and MPSSE mode', async () => {
    const { transport, programmer } = setup();
    await programmer.connect({ clockHz: 15e6 });
    expect(transport.controls).toEqual([
      { request: 0x00, value: 0x0000, index: 1 },
      { request: 0x00, value: 0x0001, index: 1 },
      { request: 0x00, value: 0x0002, index: 1 },
      { request: 0x0b, value: 0x0200, index: 1 },
      { request: 0x09, value: 0x0001, index: 1 }
    ]);
    // Loopback off, divide-by-5 off, CS and CRESET driven high; then divisor 1 (15 MHz).
    expect(hexOf(transport.writes[0])).toBe('85 8a 80 90 93');
    expect(hexOf(transport.writes[1])).toBe('86 01 00');
    expect(programmer.mpsse.clockHz).toBe(15e6);
  });

  it('detects the flash JEDEC ID and releases reset afterwards', async () => {
    const { programmer, transport } = setup();
    await programmer.connect();
    const info = await programmer.detectFlash();
    expect(info.id).toBe('EF4014');
    expect(info.capacityBytes).toBe(1 << 20);
    // Reset is held only while the ID is read; the FPGA is running again afterwards.
    expect(transport.low & PIN.CRESET).toBeTruthy();
  });

  it('loads an SRAM bitstream, clocks trailing zeros and reports CDONE high', async () => {
    const { programmer, fpga, transport, logs } = setup();
    await programmer.connect();
    const bits = makeBitstream(500, 7);
    const result = await programmer.programSram(bits);
    expect(result.cdone).toBe(true);
    expect(fpga.loaded.slice(0, bits.length)).toEqual(Array.from(bits));
    // At least 49 extra clocks after the bitstream: 8 zero bytes = 64 clocks.
    expect(fpga.loaded.slice(bits.length).length).toBe(8);
    expect(fpga.loaded.slice(bits.length).every((b) => b === 0)).toBe(true);
    expect(transport.low & PIN.CRESET).toBeTruthy();
    expect(logs.some((l) => /CDONE is high/.test(l))).toBe(true);
  });

  it('rejects a file that is not an iCE40 bitstream before touching the device', async () => {
    const { programmer, transport } = setup();
    await programmer.connect();
    const writesBefore = transport.writes.length;
    await expect(programmer.programSram(Uint8Array.of(1, 2, 3))).rejects.toBeInstanceOf(FpgaProgrammerError);
    expect(transport.writes.length).toBe(writesBefore);
  });

  it('programs flash: erases the sectors, programs pages, verifies and releases reset', async () => {
    const { programmer, flash, transport } = setup({ flashSize: 1 << 20 });
    // Pre-fill with zeros so the erase is visible in the result.
    flash.mem.fill(0x00);
    await programmer.connect();
    const bits = makeBitstream(1000, 3);
    const result = await programmer.programFlash(bits, { offset: 0 });
    expect(result.verified).toBe(true);
    expect(Array.from(flash.mem.subarray(0, bits.length))).toEqual(Array.from(bits));
    // Bytes after the bitstream inside the erased sector are 0xFF.
    expect(flash.mem[bits.length]).toBe(0xff);
    expect(flash.ops.filter((o) => o.op === 'erase4k')).toEqual([{ op: 'erase4k', addr: 0 }]);
    expect(flash.ops.filter((o) => o.op === 'pageprogram').length).toBe(Math.ceil(bits.length / 256));
    // Reset released at the end.
    expect(transport.low & PIN.CRESET).toBeTruthy();
  });

  it('programs at a non-zero offset and verifies only that range', async () => {
    const { programmer, flash } = setup({ flashSize: 1 << 20 });
    await programmer.connect();
    const bits = makeBitstream(300, 9);
    await programmer.programFlash(bits, { offset: 0x2000 });
    expect(Array.from(flash.mem.subarray(0x2000, 0x2000 + bits.length))).toEqual(Array.from(bits));
    expect(flash.mem[0]).toBe(0xff);
  });

  it('reports a verify mismatch at the first differing byte', async () => {
    const { programmer, flash, transport } = setup({ flashSize: 1 << 20 });
    await programmer.connect();
    const bits = makeBitstream(200, 5);
    await programmer.programFlash(bits);
    flash.mem[10] = bits[10] ^ 0xff;
    const check = await programmer.verifyFlash(bits, { offset: 0, keepReset: true });
    expect(check).toMatchObject({ ok: false, mismatchAt: 10, checked: 10 });
    // keepReset: the FPGA stays held in reset (the failed-program path).
    expect(transport.low & PIN.CRESET).toBe(0);
  });

  it('works with a 64-byte full-speed packet size as well as 512-byte', async () => {
    for (const packetSize of [64, 512]) {
      const { programmer, flash } = setup({ flashSize: 1 << 20, packetSize });
      await programmer.connect();
      const bits = makeBitstream(5000, packetSize);
      await programmer.programFlash(bits);
      expect(Array.from(flash.mem.subarray(0, bits.length))).toEqual(Array.from(bits));
    }
  });

  it('refuses a bitstream larger than the detected flash', async () => {
    // JEDEC 0x10 = 64 KB capacity.
    const { programmer } = setup({ flashSize: 1 << 16, jedec: [0xef, 0x40, 0x10] });
    await programmer.connect();
    const big = makeBitstream(200000, 2);
    await expect(programmer.programFlash(big)).rejects.toThrow(/does not fit/);
  });

  it('stops between USB transfers when cancelled', async () => {
    const { programmer } = setup({ flashSize: 1 << 20 });
    await programmer.connect();
    // Cancel from inside the progress callback so the job stops at its next check.
    let cancelled = false;
    programmer.onProgress = () => {
      if (!cancelled) {
        cancelled = true;
        programmer.cancel();
      }
    };
    await expect(programmer.programFlash(makeBitstream(10000, 4))).rejects.toThrow(/Cancelled/);
  });
});
