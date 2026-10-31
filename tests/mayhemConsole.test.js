import { describe, it, expect, beforeEach } from 'vitest';
import { MayhemPortaPackDriver } from '../src/utils/mayhemDriver';
import { _resetPortManager } from '../src/utils/portManager';

const enc = new TextEncoder(), dec = new TextDecoder();

// Fake Mayhem USB serial console: echoes the command, prints its output, then
// the `ch>` prompt. Output is delivered in small, uneven chunks so lines and
// prompts arrive split, as they do over USB.
function makeFakeMayhem() {
  let controller, pending = '';
  const dev = { sent: [], freq: null, buttons: [], touches: [] };
  const SCREEN = ['  __', ' _ _', '____'];   // 4x3 test frame
  const reply = (text) => {
    const bytes = enc.encode(text);
    let i = 0, k = 0;
    while (i < bytes.length) { const n = 1 + ((k++ * 7) % 5); controller.enqueue(bytes.slice(i, i + n)); i += n; }
  };
  function run(cmd) {
    dev.sent.push(cmd);
    const [verb, ...args] = cmd.split(' ');
    let out = '';
    if (verb === 'info') out = 'Mayhem v2.1.0\r\nHackRF One r10\r\n';
    else if (verb === 'setfreq') { dev.freq = +args[0]; out = 'ok\r\n'; }
    else if (verb === 'button') { dev.buttons.push(+args[0]); out = 'ok\r\n'; }
    else if (verb === 'touch') { dev.touches.push(args.map(Number)); out = 'ok\r\n'; }
    else if (verb === 'screenframeshort') out = SCREEN.join('\r\n') + '\r\n';
    else if (verb === 'applist') out = 'adsbrx\r\nsubghzd\r\n';
    else out = `${verb}: command not found\r\n`;
    reply(cmd + '\r\n' + out + 'ch> ');
  }
  const port = {
    readable: null, writable: null,
    getInfo: () => ({ usbVendorId: 0x1d50, usbProductId: 0x6018 }),
    async open() {
      this.readable = new ReadableStream({ start(c) { controller = c; } });
      this.writable = new WritableStream({
        write(ch) {
          pending += dec.decode(ch);
          let n;
          while ((n = pending.indexOf('\r\n')) >= 0) { const l = pending.slice(0, n); pending = pending.slice(n + 2); setTimeout(() => run(l), 5); }
        }
      });
    },
    async close() { this.readable = null; this.writable = null; }
  };
  dev.asyncLine = (t) => reply(t);
  return { port, dev };
}

async function connected() {
  const { port, dev } = makeFakeMayhem();
  const serial = { requestPort: async () => port, addEventListener() {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serial } });
  const d = new MayhemPortaPackDriver();
  const logs = [];
  d.onLogCallback = (e) => logs.push(e);
  await d.connectHardware();
  return { d, dev, logs };
}

beforeEach(() => _resetPortManager());

describe('PortaPack Mayhem serial console (simulated device)', () => {
  it('reads the real identity on connect instead of keeping the demo one', async () => {
    const { d } = await connected();
    expect(d.isDemo).toBe(false);
    expect(d.firmwareVersion).toBe('Mayhem v2.1.0');
    expect(d.batteryMv).toBe(null);
    expect(d.boardId).toBe(null);
    await d.disconnect();
  });

  it('tunes with setfreq, presses real buttons, and touches', async () => {
    const { d, dev } = await connected();
    await d.sendCommand('freq 433920000');
    expect(dev.freq).toBe(433920000);
    expect(d.frequency).toBe(433920000);
    d.pressKey('up'); d.pressKey('select'); d.pressKey('step_up');
    await d.sendTouch(10, 20);
    expect(dev.buttons).toEqual([4, 5, 8]);
    expect(dev.touches).toEqual([[10, 20]]);
    await d.disconnect();
  });

  it('serializes overlapping commands instead of colliding on the writer', async () => {
    const { d, dev } = await connected();
    await Promise.all([d.sendCommand('freq 100000000'), d.sendCommand('freq 200000000'), d.sendCommand('freq 300000000')]);
    expect(dev.sent.filter((c) => c.startsWith('setfreq'))).toEqual(['setfreq 100000000', 'setfreq 200000000', 'setfreq 300000000']);
    expect(d.frequency).toBe(300000000);
    await d.disconnect();
  });

  it('says amp / gain need HackRF mode instead of sending unknown commands', async () => {
    const { d, dev, logs } = await connected();
    const before = dev.sent.length;
    await d.sendCommand('amp 1');
    expect(dev.sent.length).toBe(before);
    expect(logs.some((l) => /isn't available over the Mayhem serial console/.test(l.text))).toBe(true);
    await d.disconnect();
  });

  it('decodes screenframeshort into RGBA', async () => {
    const { d } = await connected();
    const f = await d.captureScreen();
    expect([f.width, f.height]).toEqual([4, 3]);
    // ' ' (32) = black, '_' (95) = 63 = white
    expect(Array.from(f.rgba.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(f.rgba.slice(8, 12))).toEqual([255, 255, 255, 255]);
    await d.disconnect();
  });

  it('reassembles async lines split across chunks', async () => {
    const { d, dev, logs } = await connected();
    dev.asyncLine('*8D4840D6202CC371C32CE0576098;\r\nhello from mayhem\r\n');
    await new Promise((r) => setTimeout(r, 30));
    expect(logs.some((l) => l.text === '[MAYHEM] hello from mayhem')).toBe(true);
    expect(logs.some((l) => l.text === '[MAYHEM] *8D4840D6202CC371C32CE0576098;')).toBe(true);
    await d.disconnect();
  });

  it('demo mode still works and keeps its labeled identity', async () => {
    const d = new MayhemPortaPackDriver();
    await d.connectDemo();
    expect(d.isDemo).toBe(true);
    expect(d.firmwareVersion).toMatch(/Mayhem/);
    await d.sendCommand('freq 915000000');
    expect(d.frequency).toBe(915000000);
  });
});
