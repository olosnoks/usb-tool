import { describe, it, expect } from 'vitest';
import CryptoJS from 'crypto-js';
import { EspBootloaderClient, slipEncode, slipDecode, ESP_CMD } from '../src/utils/espLoader';
import { inspectEspSilicon, dumpFlashRange } from '../src/utils/espMemoryTool';

const MAGIC = { ESP8266: 0xfff0c101, ESP32: 0x00f01d83, 'ESP32-S3': 0x00000009, 'ESP32-C3': 0x6921506f };
const md5 = (b) => CryptoJS.MD5(CryptoJS.lib.WordArray.create(b)).toString();

// Fake ESP ROM bootloader (esptool protocol, ROM mode, no stub).
function makeFakeRom({ chip = 'ESP32-S3', silent = false, corruptWrite = false, mac = [0x24, 0x6f, 0x28, 0xaa, 0xbb, 0xcc] } = {}) {
  let controller;
  const flash = new Uint8Array(0x400000).fill(0xff);
  const dev = { flash, ops: [], attached: false, begin: null, signals: 0, inRom: false };
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
    switch (op) {
      case ESP_CMD.SYNC: for (let i = 0; i < 8; i++) reply(op); return;
      case ESP_CMD.READ_REG: {
        const a = w(data, 0);
        if (a === 0x40001000) return reply(op, undefined, MAGIC[chip]);
        if (a === MAC_LO) return reply(op, undefined, ((mac[2] << 24) | (mac[3] << 16) | (mac[4] << 8) | mac[5]) >>> 0);
        if (a === MAC_LO + 4) return reply(op, undefined, (mac[0] << 8) | mac[1]);
        return reply(op, undefined, 0);
      }
      case ESP_CMD.SPI_ATTACH: dev.attached = true; return reply(op);
      case ESP_CMD.SPI_SET_PARAMS: return reply(op);
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
    async setSignals() { dev.signals++; if (dev.signals >= 3) dev.inRom = true; },
    async open() {
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
