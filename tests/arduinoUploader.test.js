import { describe, it, expect } from 'vitest';
import {
  ARDUINO_BOARDS,
  ARDUINO_BOARD_IDS,
  Stk500v1Programmer,
  Avr109Programmer,
  buildFlashPages,
  firstMismatch,
  toIntelHex,
  touchForBootloader,
  programBoard,
  readBoardFlash,
  getBoard
} from '../src/utils/arduinoUploader';
import { parseIntelHex } from '../src/utils/firmwareParser';
import { SerialTimeoutError } from '../src/utils/serialLink';

// A scripted bootloader behind the same write/read/drain/setSignals surface as
// SerialLink. It keeps real flash memory and answers each frame the way
// Optiboot (STK500v1) or Caterina (AVR109) does, so the driver's byte sequences
// are checked both on the wire and through a full program/verify/read cycle.
class ScriptedBootloader {
  constructor({
    protocol = 'stk500v1',
    flashSize = 32768,
    signature = [0x1e, 0x95, 0x0f],
    bootId = 'CATERIN',
    alive = true,
    corruptPageAt = null
  } = {}) {
    this.protocol = protocol;
    this.flashSize = flashSize;
    this.signature = signature;
    this.bootId = bootId;
    this.alive = alive;
    this.corruptPageAt = corruptPageAt;
    this.flash = new Uint8Array(flashSize).fill(0xff);
    this.rx = [];
    this.writes = [];
    this.signals = [];
    this.inBootloader = false;
    this.wordAddr = 0;
    this.running = false;
  }

  async write(bytes) {
    const b = Uint8Array.from(bytes);
    this.writes.push(Array.from(b));
    if (!this.alive) return;
    if (this.protocol === 'stk500v1') this._stk(b);
    else this._avr(b);
  }

  read(n, _timeoutMs, what = 'a reply') {
    if (this.rx.length < n) throw new SerialTimeoutError(what, this.rx.length, n);
    return Uint8Array.from(this.rx.splice(0, n));
  }

  async drain() {
    const n = this.rx.length;
    this.rx = [];
    return n;
  }

  async setSignals(s) {
    this.signals.push({ ...s });
    if (s.dataTerminalReady === true && this.signals.length >= 2) this.inBootloader = true;
  }

  async close() {}

  _writeFlash(byteAddr, data) {
    this.flash.set(data, byteAddr);
    if (this.corruptPageAt !== null && this.corruptPageAt >= byteAddr && this.corruptPageAt < byteAddr + data.length) {
      this.flash[this.corruptPageAt] ^= 0x01;
    }
  }

  _stk(b) {
    if (!this.inBootloader) return;
    const ok = [0x14, 0x10];
    switch (b[0]) {
      case 0x30: // GET_SYNC 30 20
        this.rx.push(...ok);
        break;
      case 0x75: // READ_SIGN 75 20
        this.rx.push(0x14, ...this.signature, 0x10);
        break;
      case 0x55: // LOAD_ADDRESS 55 lo hi 20
        this.wordAddr = b[1] | (b[2] << 8);
        this.rx.push(...ok);
        break;
      case 0x64: { // PROG_PAGE 64 hi lo 'F' data 20
        const n = (b[1] << 8) | b[2];
        this._writeFlash(this.wordAddr * 2, b.subarray(4, 4 + n));
        this.rx.push(...ok);
        break;
      }
      case 0x74: { // READ_PAGE 74 hi lo 'F' 20
        const n = (b[1] << 8) | b[2];
        this.rx.push(0x14, ...this.flash.subarray(this.wordAddr * 2, this.wordAddr * 2 + n), 0x10);
        break;
      }
      case 0x51: // LEAVE_PROGMODE 51 20
        this.rx.push(...ok);
        this.running = true;
        break;
      default:
        this.rx.push(0x11); // STK_FAILED for anything else
    }
  }

  _avr(b) {
    switch (b[0]) {
      case 0x53: // 'S'
        for (const c of this.bootId) this.rx.push(c.charCodeAt(0));
        break;
      case 0x41: // 'A' word address big-endian
        this.wordAddr = (b[1] << 8) | b[2];
        this.rx.push(0x0d);
        break;
      case 0x42: { // 'B' len hi lo 'F' data
        const n = (b[1] << 8) | b[2];
        this._writeFlash(this.wordAddr * 2, b.subarray(4, 4 + n));
        this.rx.push(0x0d);
        break;
      }
      case 0x67: { // 'g' len hi lo 'F' -> data, no CR
        const n = (b[1] << 8) | b[2];
        this.rx.push(...this.flash.subarray(this.wordAddr * 2, this.wordAddr * 2 + n));
        break;
      }
      case 0x45: // 'E'
        this.rx.push(0x0d);
        this.running = true;
        break;
      default:
        this.rx.push(0x3f); // '?'
    }
  }
}

const pattern = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);
const fast = { resetPulseMs: 0, bootWaitMs: 0, timeoutMs: 200 };

// A link that just records writes and answers with a fixed reply queue.
function recordingLink(replies = []) {
  const writes = [];
  return {
    writes,
    async write(b) { writes.push(Array.from(b)); },
    read(n, _t, what) {
      if (replies.length < n) throw new SerialTimeoutError(what, replies.length, n);
      return Uint8Array.from(replies.splice(0, n));
    },
    async drain() { return 0; },
    async setSignals() {}
  };
}

describe('board presets', () => {
  it('has the four STK500v1 and three AVR109 presets from the brief', () => {
    expect([...ARDUINO_BOARD_IDS].sort()).toEqual(['leonardo', 'micro', 'nano-new', 'nano-old', 'pro-micro', 'pro-mini', 'uno']);
    expect(ARDUINO_BOARDS.uno.baud).toBe(115200);
    expect(ARDUINO_BOARDS['nano-new'].baud).toBe(115200);
    expect(ARDUINO_BOARDS['nano-old'].baud).toBe(57600);
    expect(ARDUINO_BOARDS['pro-mini'].baud).toBe(57600);
    expect(ARDUINO_BOARDS.leonardo.protocol).toBe('avr109');
  });

  it('keeps every application limit on a page boundary below the bootloader', () => {
    for (const b of Object.values(ARDUINO_BOARDS)) {
      expect(b.appLimit % b.pageSize).toBe(0);
      expect(b.appLimit).toBeLessThan(b.flashSize);
    }
    expect(getBoard('uno').appLimit).toBe(32768 - 512);
    expect(getBoard('nano-old').appLimit).toBe(32768 - 2048);
    expect(getBoard('leonardo').appLimit).toBe(32768 - 4096);
  });

  it('rejects unknown presets', () => {
    expect(() => getBoard('mega')).toThrow(/Unknown board/);
  });
});

describe('flash page planning', () => {
  it('pads the image with 0xFF out to whole pages and keeps the data in place', () => {
    const board = getBoard('uno');
    const pages = buildFlashPages(board, { data: pattern(200), startAddress: 0 });
    expect(pages.map((p) => p.addr)).toEqual([0, 128]);
    expect(pages[1].data.length).toBe(128);
    expect(Array.from(pages[0].data)).toEqual(Array.from(pattern(128)));
    expect(Array.from(pages[1].data.subarray(0, 72))).toEqual(Array.from(pattern(200).subarray(128)));
    expect(pages[1].data[72]).toBe(0xff);
  });

  it('starts on the page that holds a non-zero start address', () => {
    const pages = buildFlashPages(getBoard('uno'), { data: new Uint8Array([1, 2, 3]), startAddress: 0x100 + 5 });
    expect(pages[0].addr).toBe(0x100);
    expect(pages[0].data[5]).toBe(1);
    expect(pages[0].data[7]).toBe(3);
    expect(pages[0].data[4]).toBe(0xff);
  });

  it('refuses an image that would overwrite the bootloader', () => {
    const uno = getBoard('uno');
    expect(() => buildFlashPages(uno, { data: new Uint8Array(uno.appLimit + 1), startAddress: 0 })).toThrow(/past the 32256 bytes/);
    expect(() => buildFlashPages(uno, { data: new Uint8Array(4), startAddress: uno.appLimit })).toThrow(/inside the Optiboot/);
    expect(() => buildFlashPages(getBoard('leonardo'), { data: new Uint8Array(28673), startAddress: 0 })).toThrow(/past the 28672/);
    expect(buildFlashPages(getBoard('leonardo'), { data: new Uint8Array(28672), startAddress: 0 }).length).toBe(224);
  });

  it('refuses an empty image', () => {
    expect(() => buildFlashPages(getBoard('uno'), { data: new Uint8Array(0) })).toThrow(/empty/);
  });
});

describe('verify helpers and Intel HEX output', () => {
  it('firstMismatch finds the first differing byte and length differences', () => {
    expect(firstMismatch(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(-1);
    expect(firstMismatch(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toBe(1);
    expect(firstMismatch(new Uint8Array([1, 2]), new Uint8Array([1]))).toBe(1);
  });

  it('writes Intel HEX that the existing parser reads back, across a 64 KB boundary', () => {
    const data = pattern(40, 3);
    const text = toIntelHex(data, 0xfff0, 16);
    expect(text).toContain(':020000040001F9'); // extended linear address record for upper 16 bits = 0x0001
    const parsed = parseIntelHex(text);
    expect(parsed.startAddress).toBe(0xfff0);
    expect(Array.from(parsed.data)).toEqual(Array.from(data));
    expect(text.trimEnd().endsWith(':00000001FF')).toBe(true);
  });
});

describe('STK500v1 byte sequences', () => {
  it('sends GET_SYNC as 30 20 and accepts 14 10', async () => {
    const link = recordingLink([0x14, 0x10]);
    await new Stk500v1Programmer(link).sync();
    expect(link.writes).toEqual([[0x30, 0x20]]);
  });

  it('reads the signature with 75 20 and assembles the three bytes', async () => {
    const link = recordingLink([0x14, 0x1e, 0x95, 0x0f, 0x10]);
    const sig = await new Stk500v1Programmer(link).readSignature();
    expect(link.writes).toEqual([[0x75, 0x20]]);
    expect(sig).toBe(0x1e950f);
  });

  it('sends LOAD_ADDRESS as 55 low high 20 (word address)', async () => {
    const link = recordingLink([0x14, 0x10]);
    await new Stk500v1Programmer(link).loadAddress(0x1234);
    expect(link.writes).toEqual([[0x55, 0x34, 0x12, 0x20]]);
  });

  it('sends PROG_PAGE as 64 len-hi len-lo F data 20', async () => {
    const link = recordingLink([0x14, 0x10]);
    await new Stk500v1Programmer(link).programPage(new Uint8Array([1, 2, 3, 4]));
    expect(link.writes).toEqual([[0x64, 0x00, 0x04, 0x46, 1, 2, 3, 4, 0x20]]);
  });

  it('sends READ_PAGE as 74 len-hi len-lo F 20 and strips the framing', async () => {
    const link = recordingLink([0x14, 9, 8, 7, 6, 0x10]);
    const got = await new Stk500v1Programmer(link).readPage(4);
    expect(link.writes).toEqual([[0x74, 0x00, 0x04, 0x46, 0x20]]);
    expect(Array.from(got)).toEqual([9, 8, 7, 6]);
  });

  it('sends LEAVE_PROGMODE as 51 20', async () => {
    const link = recordingLink([0x14, 0x10]);
    await new Stk500v1Programmer(link).leave();
    expect(link.writes).toEqual([[0x51, 0x20]]);
  });

  it('reports a rejected command with the bytes it got', async () => {
    const link = recordingLink([0x14, 0x11]);
    await expect(new Stk500v1Programmer(link).programPage(new Uint8Array(2))).rejects.toThrow(/14 11/);
  });
});

describe('AVR109 byte sequences', () => {
  it('sends S for the software id and returns the 7 bytes as text', async () => {
    const link = recordingLink([...'CATERIN'].map((c) => c.charCodeAt(0)));
    const id = await new Avr109Programmer(link).softwareId();
    expect(link.writes).toEqual([[0x53]]);
    expect(id).toBe('CATERIN');
  });

  it('sends A as word address big-endian', async () => {
    const link = recordingLink([0x0d]);
    await new Avr109Programmer(link).setAddress(0x1234);
    expect(link.writes).toEqual([[0x41, 0x12, 0x34]]);
  });

  it('sends B as B len-hi len-lo F data, expecting CR', async () => {
    const link = recordingLink([0x0d]);
    await new Avr109Programmer(link).writeBlock(new Uint8Array([9, 8]));
    expect(link.writes).toEqual([[0x42, 0x00, 0x02, 0x46, 9, 8]]);
  });

  it('sends g as g len-hi len-lo F and returns the raw bytes', async () => {
    const link = recordingLink([5, 6, 7, 8]);
    const got = await new Avr109Programmer(link).readBlock(4);
    expect(link.writes).toEqual([[0x67, 0x00, 0x04, 0x46]]);
    expect(Array.from(got)).toEqual([5, 6, 7, 8]);
  });

  it('sends E to exit and expects CR', async () => {
    const link = recordingLink([0x0d]);
    await new Avr109Programmer(link).exit();
    expect(link.writes).toEqual([[0x45]]);
  });

  it('touches at 1200 baud: open then close, in that order', async () => {
    const calls = [];
    await touchForBootloader({
      open: async (o) => calls.push(['open', o.baudRate]),
      close: async () => calls.push(['close'])
    });
    expect(calls).toEqual([['open', 1200], ['close']]);
  });
});

describe('full program, verify and read-back through a scripted bootloader', () => {
  it('programs an Uno over STK500v1: reset pulse, sync, write, verify, run', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1' });
    const image = { data: pattern(1000, 11), startAddress: 0 };
    const progress = [];
    const log = [];
    const result = await programBoard(boot, getBoard('uno'), image, {
      ...fast,
      onProgress: (p) => progress.push(p),
      log: (s) => log.push(s)
    });

    expect(result.verified).toBe(true);
    expect(result.signature).toBe(0x1e950f);
    expect(boot.signals).toEqual([
      { dataTerminalReady: false, requestToSend: false },
      { dataTerminalReady: true, requestToSend: true }
    ]);
    expect(Array.from(boot.flash.subarray(0, 1000))).toEqual(Array.from(image.data));
    expect(boot.flash[1000]).toBe(0xff);
    expect(boot.running).toBe(true);
    // 1000 bytes -> 8 pages of 128 bytes, written then verified.
    expect(progress.filter((p) => p.phase === 'write').length).toBe(8);
    expect(progress.filter((p) => p.phase === 'verify').length).toBe(8);
    expect(progress[progress.length - 1]).toEqual({ phase: 'verify', done: 8, total: 8 });
    // The frames went out in the STK500v1 order.
    const firstCmds = boot.writes.map((w) => w[0]);
    expect(firstCmds.slice(0, 3)).toEqual([0x30, 0x75, 0x55]);
    expect(firstCmds[firstCmds.length - 1]).toBe(0x51);
    expect(log.some((s) => /Verified/.test(s))).toBe(true);
  });

  it('reads the whole flash back over STK500v1 and returns the same bytes', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1' });
    const image = { data: pattern(300, 5), startAddress: 0 };
    await programBoard(boot, getBoard('nano-new'), image, fast);
    boot.running = false;
    const flash = await readBoardFlash(boot, getBoard('nano-new'), fast);
    expect(flash.length).toBe(32768);
    expect(Array.from(flash.subarray(0, 300))).toEqual(Array.from(image.data));
    expect(boot.running).toBe(true);
  });

  it('programs a Leonardo over AVR109 (Caterina): id, address, block write, verify, exit', async () => {
    const boot = new ScriptedBootloader({ protocol: 'avr109', bootId: 'CATERIN' });
    const image = { data: pattern(257, 2), startAddress: 0 };
    const result = await programBoard(boot, getBoard('leonardo'), image, fast);
    expect(result.verified).toBe(true);
    expect(result.signature).toBe(null); // AVR109 has no signature command
    expect(Array.from(boot.flash.subarray(0, 257))).toEqual(Array.from(image.data));
    const cmds = boot.writes.map((w) => String.fromCharCode(w[0]));
    expect(cmds[0]).toBe('S');
    expect(cmds[cmds.length - 1]).toBe('E');
    expect(cmds).toContain('B');
    expect(cmds).toContain('g');
    expect(boot.running).toBe(true);
  });

  it('reads the Caterina flash back and exits the bootloader', async () => {
    const boot = new ScriptedBootloader({ protocol: 'avr109' });
    await programBoard(boot, getBoard('micro'), { data: pattern(128, 9), startAddress: 0 }, fast);
    boot.running = false;
    const flash = await readBoardFlash(boot, getBoard('micro'), fast);
    expect(flash.length).toBe(32768);
    expect(Array.from(flash.subarray(0, 128))).toEqual(Array.from(pattern(128, 9)));
    expect(boot.running).toBe(true);
  });

  it('round-trips the read-back through Intel HEX', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1' });
    const image = { data: pattern(64, 4), startAddress: 0 };
    await programBoard(boot, getBoard('uno'), image, fast);
    const flash = await readBoardFlash(boot, getBoard('uno'), fast);
    const parsed = parseIntelHex(toIntelHex(flash.subarray(0, 512)));
    expect(Array.from(parsed.data.subarray(0, 64))).toEqual(Array.from(image.data));
  });
});

describe('failure cases never report success', () => {
  it('reports a verify mismatch and names the address', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1', corruptPageAt: 0x80 + 3 });
    const image = { data: pattern(300, 1), startAddress: 0 };
    await expect(programBoard(boot, getBoard('uno'), image, fast)).rejects.toThrow(/Verify failed at 0x83/);
  });

  it('stops before writing when the signature is for another chip', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1', signature: [0x1e, 0x93, 0x0b] });
    await expect(programBoard(boot, getBoard('uno'), { data: pattern(10) }, fast)).rejects.toThrow(/signature 0x1E930B/);
    expect(boot.writes.some((w) => w[0] === 0x64)).toBe(false);
  });

  it('reports a missing bootloader after the sync attempts', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1', alive: false });
    await expect(programBoard(boot, getBoard('pro-mini'), { data: pattern(10) }, fast)).rejects.toThrow(/did not answer the STK500v1 sync/);
    expect(boot.writes.length).toBe(20);
  });

  it('refuses a Caterina port that does not identify as CATERIN', async () => {
    const boot = new ScriptedBootloader({ protocol: 'avr109', bootId: 'OTHER00' });
    await expect(programBoard(boot, getBoard('leonardo'), { data: pattern(10) }, fast)).rejects.toThrow(/answered "OTHER00"/);
    expect(boot.writes.some((w) => w[0] === 0x42)).toBe(false);
  });

  it('stops when the user aborts and does not start the sketch', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1' });
    await expect(
      programBoard(boot, getBoard('uno'), { data: pattern(300) }, { ...fast, shouldAbort: () => true })
    ).rejects.toThrow(/Stopped by the user/);
    expect(boot.running).toBe(false);
  });

  it('rejects an oversized image before touching the board', async () => {
    const boot = new ScriptedBootloader({ protocol: 'stk500v1' });
    await expect(programBoard(boot, getBoard('uno'), { data: new Uint8Array(40000) }, fast)).rejects.toThrow(/past the 32256/);
    expect(boot.writes.length).toBe(0);
  });
});
