import { describe, it, expect } from 'vitest';
import CryptoJS from 'crypto-js';
import { inflate } from 'pako';
import { EspBootloaderClient, slipEncode, slipDecode, ESP_CMD, SPI_REGS, flashSizeFromJedec } from '../src/utils/espLoader';
import { inspectEspSilicon, dumpFlashRange } from '../src/utils/espMemoryTool';

const MAGIC = { ESP8266: 0xfff0c101, ESP32: 0x00f01d83, 'ESP32-S3': 0x00000009, 'ESP32-C3': 0x6921506f };
const md5 = (b) => CryptoJS.MD5(CryptoJS.lib.WordArray.create(b)).toString();

// Fake ESP ROM bootloader (esptool protocol, ROM mode, no stub).
// jedecCap: JEDEC capacity byte (0x16 = 4 MB). failBaud: the chip goes silent after CHANGE_BAUDRATE
// (as if the adapter cannot do the rate); a reset puts it back at 115200.
function makeFakeRom({ chip = 'ESP32-S3', silent = false, corruptWrite = false, jedecCap = 0x16, failBaud = false, mac = [0x24, 0x6f, 0x28, 0xaa, 0xbb, 0xcc] } = {}) {
  let controller;
  const flash = new Uint8Array(0x400000).fill(0xff);
  const dev = { flash, ops: [], attached: false, begin: null, signals: 0, inRom: false, chipBaud: 115200, baudChanges: [], opens: [], regs: {}, defl: null, deflBytes: 0, setParams: null, beginOps: [] };
  const esp8266 = chip === 'ESP8266';
  const reply = (op, data = new Uint8Array(0), value = 0, status = 0, err = 0) => {
    const st = esp8266 ? [status, err] : [status, err, 0, 0];
    const body = new Uint8Array(8 + data.length + st.length);
    body[0] = 1; body[1] = op;
    const size = data.length + st.length;
    body[2] = size & 0xff; body[3] = size >> 8;
    new DataView(body.buffer).setUint32(4, value >>> 0, true);
    body.set(data, 8); body.set(st, 8 + data.length);
    controller.enqueue(slipEncode(body));
  };
  const w = (d, i) => new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(i * 4, true);
  const MAC_LO = { ESP32: 0x3FF5A004, 'ESP32-S3': 0x60007044, 'ESP32-C3': 0x60008844 }[chip];

  function handle(pkt) {
    const op = pkt[1], size = pkt[2] | (pkt[3] << 8), chk = pkt[4];
    const data = pkt.subarray(8, 8 + size);
    dev.ops.push(op);
    if (silent || !dev.inRom) return;
    if (dev.chipBaud !== port.baud) return;          // host and chip disagree on the rate: line noise
    switch (op) {
      case ESP_CMD.SYNC: for (let i = 0; i < 8; i++) reply(op); return;
      case ESP_CMD.READ_REG: {
        const a = w(data, 0);
        if (a === 0x40001000) return reply(op, undefined, MAGIC[chip]);
        const sr = SPI_REGS[chip];
        if (sr && a === sr.base + sr.w0 && (dev.regs[sr.base + sr.usr2] & 0xff) === 0x9f) {
          return reply(op, undefined, (0xef | (0x40 << 8) | (jedecCap << 16)) >>> 0);
        }
        if (sr && a === sr.base) return reply(op, undefined, 0);        // SPI_CMD_USR already cleared
        if (dev.regs[a] !== undefined && !(MAC_LO && (a === MAC_LO || a === MAC_LO + 4))) return reply(op, undefined, dev.regs[a]);
        if (a === MAC_LO) return reply(op, undefined, ((mac[2] << 24) | (mac[3] << 16) | (mac[4] << 8) | mac[5]) >>> 0);
        if (a === MAC_LO + 4) return reply(op, undefined, (mac[0] << 8) | mac[1]);
        return reply(op, undefined, 0);
      }
      case ESP_CMD.SPI_ATTACH: dev.attached = true; return reply(op);
      case ESP_CMD.SPI_SET_PARAMS: dev.setParams = { total: w(data, 1) }; return reply(op);
      case ESP_CMD.WRITE_REG: dev.regs[w(data, 0)] = w(data, 1); return reply(op);
      case ESP_CMD.CHANGE_BAUDRATE:
        dev.baudChanges.push(w(data, 0));
        reply(op);
        dev.chipBaud = failBaud ? 0 : w(data, 0);
        return;
      case ESP_CMD.FLASH_DEFL_BEGIN: {
        const wantLen = (chip === 'ESP32' || esp8266) ? 16 : 20;
        if (esp8266 || data.length !== wantLen || !dev.attached) return reply(op, undefined, 0, 1, 0x05);
        dev.defl = { size: w(data, 0), blocks: w(data, 1), bs: w(data, 2), off: w(data, 3), next: 0, parts: [] };
        flash.fill(0xff, dev.defl.off, dev.defl.off + dev.defl.size);
        return reply(op);
      }
      case ESP_CMD.FLASH_DEFL_DATA: {
        const len = w(data, 0), seq = w(data, 1);
        const block = data.subarray(16, 16 + len);
        let c = 0xef; for (const b of block) c ^= b;
        if (!dev.defl || seq !== dev.defl.next || c !== chk) return reply(op, undefined, 0, 1, 0x07);
        dev.defl.parts.push(Uint8Array.from(block));
        dev.deflBytes += len;
        dev.defl.next++;
        return reply(op);
      }
      case ESP_CMD.FLASH_DEFL_END: {
        if (!dev.defl || dev.defl.next !== dev.defl.blocks) return reply(op, undefined, 0, 1, 0x0b);
        const all = new Uint8Array(dev.defl.parts.reduce((n, p) => n + p.length, 0));
        let o = 0; for (const p of dev.defl.parts) { all.set(p, o); o += p.length; }
        const out = inflate(all);
        flash.set(out, dev.defl.off);
        if (corruptWrite) flash[dev.defl.off] ^= 0xff;
        return reply(op);
      }
      case ESP_CMD.FLASH_BEGIN: {
        const wantLen = (chip === 'ESP32' || esp8266) ? 16 : 20;
        if (data.length !== wantLen) return reply(op, undefined, 0, 1, 0x05);
        if (!esp8266 && !dev.attached) return reply(op, undefined, 0, 1, 0x06);
        dev.begin = { size: w(data, 0), blocks: w(data, 1), bs: w(data, 2), off: w(data, 3), next: 0 };
        flash.fill(0xff, dev.begin.off, dev.begin.off + dev.begin.size);
        return reply(op);
      }
      case ESP_CMD.FLASH_DATA: {
        const len = w(data, 0), seq = w(data, 1);
        const block = data.subarray(16, 16 + len);
        let c = 0xef; for (const b of block) c ^= b;
        if (!dev.begin || seq !== dev.begin.next || c !== chk || len !== dev.begin.bs) return reply(op, undefined, 0, 1, 0x07);
        const at = dev.begin.off + seq * dev.begin.bs;
        flash.set(block, at);
        if (corruptWrite && seq === 0) flash[at] ^= 0xff;
        dev.begin.next++;
        return reply(op);
      }
      case ESP_CMD.SPI_FLASH_MD5: {
        if (esp8266) return reply(op, undefined, 0, 1, 0x05);
        const off = w(data, 0), n = w(data, 1);
        return reply(op, new TextEncoder().encode(md5(flash.subarray(off, off + n))));
      }
      case ESP_CMD.READ_FLASH_SLOW: {
        if (!(esp8266 || chip === 'ESP32')) return reply(op, undefined, 0, 1, 0x05);
        const off = w(data, 0), n = w(data, 1);
        const out = new Uint8Array(64); out.set(flash.subarray(off, off + n));
        return reply(op, out);
      }
      default: return reply(op, undefined, 0, 1, 0x05);
    }
  }

  let rx = [];
  const port = {
    readable: null, writable: null,
    getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
    baud: 115200,
    async setSignals() { dev.signals++; dev.chipBaud = 115200; if (dev.signals >= 3) dev.inRom = true; },
    async open(opts) {
      this.baud = opts?.baudRate ?? 115200;
      dev.opens.push(this.baud);
      rx = [];
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({
        write(chunk) {
          for (const b of chunk) {
            rx.push(b);
            if (b === 0xc0 && rx.length > 1) {
              const body = slipDecode(Uint8Array.from(rx));
              rx = [];
              if (body.length >= 8) setTimeout(() => handle(body), 1);
            } else if (b === 0xc0) rx = [0xc0];
          }
        }
      });
    },
    async close() {}
  };
  return { port, dev };
}

async function opened(opts) {
  const f = makeFakeRom(opts);
  await f.port.open();
  return f;
}

const image = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

describe('ESP ROM flasher against a simulated bootloader', () => {
  it('syncs, detects the chip, writes two images and verifies them by MD5', async () => {
    const { port, dev } = await opened({ chip: 'ESP32-S3' });
    const logs = [];
    const c = new EspBootloaderClient(port, (m) => logs.push(m));
    await c.connect(10, 10);
    expect(c.chip).toBe('ESP32-S3');
    const boot = image(3001, 7), app = image(5000, 9);
    const progress = [];
    await c.flashMultiplePartitions([
      { data: boot, offset: 0x0, label: 'bootloader' },
      { data: app, offset: 0x10000, label: 'app' }
    ], 4096, (p) => progress.push(p.aggregatePercent));
    await c.release();
    expect(Array.from(dev.flash.subarray(0, 3001))).toEqual(Array.from(boot));
    expect(Array.from(dev.flash.subarray(0x10000, 0x10000 + 5000))).toEqual(Array.from(app));
    expect(progress[progress.length - 1]).toBe(100);
    expect(logs.join('\n')).toMatch(/Verified 0x10000/);
  }, 20000);

  it('uses the 4-word FLASH_BEGIN on the original ESP32', async () => {
    const { port, dev } = await opened({ chip: 'ESP32' });
    const c = new EspBootloaderClient(port, () => {});
    await c.connect(10, 10);
    await c.flashBinary(image(1500), 0x1000);
    await c.release();
    expect(Array.from(dev.flash.subarray(0x1000, 0x1000 + 1500))).toEqual(Array.from(image(1500)));
  }, 20000);

  it('fails clearly when no chip answers instead of reporting success', async () => {
    const { port } = await opened({ silent: true });
    const c = new EspBootloaderClient(port, () => {});
    await expect(c.connect(10, 10, 3)).rejects.toThrow(/did not answer SYNC/);
    await c.release();
  }, 20000);

  it('fails the verify step when the flash does not hold what was sent', async () => {
    const { port } = await opened({ chip: 'ESP32-C3', corruptWrite: true });
    const c = new EspBootloaderClient(port, () => {});
    await c.connect(10, 10);
    await expect(c.flashBinary(image(2048), 0x10000)).rejects.toThrow(/verify failed/);
    await c.release();
  }, 20000);

  it('ESP8266: no MD5 in ROM, so it writes without claiming verification', async () => {
    const { port, dev } = await opened({ chip: 'ESP8266' });
    const logs = [];
    const c = new EspBootloaderClient(port, (m) => logs.push(m));
    await c.connect(10, 10);
    await c.flashBinary(image(1024), 0x0);
    await c.release();
    expect(Array.from(dev.flash.subarray(0, 1024))).toEqual(Array.from(image(1024)));
    expect(logs.join('\n')).toMatch(/not verified/);
  }, 20000);
});

describe('ESP silicon inspector and flash dump', () => {
  it('reads the real MAC through the ROM', async () => {
    const { port } = await opened({ chip: 'ESP32-S3' });
    const info = await inspectEspSilicon(port, () => {});
    expect(info.chipFamily).toBe('ESP32-S3');
    expect(info.mac).toBe('24:6F:28:AA:BB:CC');
  }, 20000);

  it('throws when the chip does not answer instead of inventing an identity', async () => {
    const { port } = await opened({ silent: true });
    await expect(inspectEspSilicon(port, () => {})).rejects.toThrow(/did not answer SYNC/);
  }, 30000);

  it('dumps real flash contents on the original ESP32', async () => {
    const { port, dev } = await opened({ chip: 'ESP32' });
    dev.flash.set(image(200, 3), 0x9000);
    const data = await dumpFlashRange(port, 0x9000, 200, () => {}, () => {});
    expect(Array.from(data)).toEqual(Array.from(image(200, 3)));
  }, 20000);

  it('refuses to dump on chips whose ROM cannot read flash', async () => {
    const { port } = await opened({ chip: 'ESP32-S3' });
    await expect(dumpFlashRange(port, 0x9000, 128, () => {}, () => {})).rejects.toThrow(/cannot read flash/);
  }, 20000);
});

describe('ESP ROM flasher: baud, compression and flash size', () => {
  const compressible = (n) => Uint8Array.from({ length: n }, (_, i) => ((i >> 6) * 7) & 0xff);

  it('detects the flash size from the JEDEC id and passes it to SPI_SET_PARAMS', async () => {
    const { port, dev } = await opened({ chip: 'ESP32-S3', jedecCap: 0x17 });
    const c = new EspBootloaderClient(port, () => {});
    await c.connect(10, 10);
    expect(c.flashSize).toBe(8 * 1024 * 1024);
    expect(dev.setParams.total).toBe(8 * 1024 * 1024);
    await c.release();
    expect(flashSizeFromJedec(0x160000 | 0x4000 | 0xef)).toBe(4 * 1024 * 1024);
    expect(flashSizeFromJedec(0x000000)).toBeNull();
  }, 20000);

  it('compressed write of a 64 KB image sends fewer bytes than raw and passes the MD5 verify', async () => {
    const { port, dev } = await opened({ chip: 'ESP32-S3' });
    const logs = [];
    const c = new EspBootloaderClient(port, (m) => logs.push(m), { compress: true });
    await c.connect(10, 10);
    const img = compressible(65536);
    await c.flashBinary(img, 0x10000);
    await c.release();
    expect(c.lastWrite.compressed).toBe(true);
    expect(dev.deflBytes).toBeGreaterThan(0);
    expect(dev.deflBytes).toBeLessThan(65536);
    expect(c.lastWrite.bytesSent).toBe(dev.deflBytes);
    expect(dev.ops).toContain(ESP_CMD.FLASH_DEFL_BEGIN);
    expect(dev.ops).not.toContain(ESP_CMD.FLASH_DATA);
    expect(Array.from(dev.flash.subarray(0x10000, 0x20000))).toEqual(Array.from(img));
    expect(logs.join('\n')).toMatch(/Verified 0x10000/);
  }, 20000);

  it('a bad compressed write is caught by the MD5 verify', async () => {
    const { port } = await opened({ chip: 'ESP32-C3', corruptWrite: true });
    const c = new EspBootloaderClient(port, () => {}, { compress: true });
    await c.connect(10, 10);
    await expect(c.flashBinary(compressible(8192), 0x10000)).rejects.toThrow(/verify failed/);
    await c.release();
  }, 20000);

  it('ESP8266 falls back to uncompressed writes even when compression is requested', async () => {
    const { port, dev } = await opened({ chip: 'ESP8266' });
    const c = new EspBootloaderClient(port, () => {}, { compress: true });
    await c.connect(10, 10);
    await c.flashBinary(compressible(4096), 0x0);
    await c.release();
    expect(c.lastWrite.compressed).toBe(false);
    expect(dev.ops).not.toContain(ESP_CMD.FLASH_DEFL_BEGIN);
    expect(dev.ops).toContain(ESP_CMD.FLASH_DATA);
    expect(Array.from(dev.flash.subarray(0, 4096))).toEqual(Array.from(compressible(4096)));
  }, 20000);

  it('changes baud: command, port reopened at the new rate, re-sync, then flashes', async () => {
    const { port, dev } = await opened({ chip: 'ESP32-S3' });
    const c = new EspBootloaderClient(port, () => {}, { compress: true });
    await c.connect(10, 10);
    const rate = await c.negotiateBaud(921600);
    expect(rate).toBe(921600);
    expect(dev.baudChanges).toEqual([921600]);
    expect(dev.opens.at(-1)).toBe(921600);
    expect(port.baud).toBe(921600);
    const img = compressible(16384);
    await c.flashBinary(img, 0x10000);
    expect(Array.from(dev.flash.subarray(0x10000, 0x10000 + 16384))).toEqual(Array.from(img));
    await c.restoreBaud(115200);
    expect(port.baud).toBe(115200);
    await c.release();
  }, 30000);

  it('falls back to 115200 when the new rate fails and still flashes', async () => {
    const { port, dev } = await opened({ chip: 'ESP32-S3', failBaud: true });
    const logs = [];
    const c = new EspBootloaderClient(port, (m) => logs.push(m));
    await c.connect(10, 10);
    const rate = await c.negotiateBaud(460800);
    expect(rate).toBe(115200);
    expect(dev.baudChanges).toEqual([460800]);
    expect(dev.opens.slice(-2)).toEqual([460800, 115200]);
    expect(logs.join('\n')).toMatch(/falling back to 115200/);
    const img = image(2048, 5);
    await c.flashBinary(img, 0x10000);
    await c.release();
    expect(Array.from(dev.flash.subarray(0x10000, 0x10000 + 2048))).toEqual(Array.from(img));
  }, 40000);

  it('keeps ESP8266 at 115200 without sending CHANGE_BAUDRATE', async () => {
    const { port, dev } = await opened({ chip: 'ESP8266' });
    const c = new EspBootloaderClient(port, () => {});
    await c.connect(10, 10);
    expect(await c.negotiateBaud(921600)).toBe(115200);
    expect(dev.baudChanges).toEqual([]);
    await c.release();
  }, 20000);

  it('rejects an image past the detected flash before any erase', async () => {
    const { port, dev } = await opened({ chip: 'ESP32-S3', jedecCap: 0x14 });   // 1 MB
    const c = new EspBootloaderClient(port, () => {});
    await c.connect(10, 10);
    const before = dev.ops.length;
    await expect(c.flashMultiplePartitions([
      { data: image(1024), offset: 0x1000, label: 'ok' },
      { data: image(0x400), offset: 0xffe00, label: 'too far' }
    ], 1024)).rejects.toThrow(/past the detected 1 MB flash/);
    const sent = dev.ops.slice(before);
    expect(sent).not.toContain(ESP_CMD.FLASH_BEGIN);
    expect(sent).not.toContain(ESP_CMD.FLASH_DEFL_BEGIN);
    await c.release();
  }, 20000);
});
