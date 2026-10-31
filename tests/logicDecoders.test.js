import { describe, it, expect } from 'vitest';
import {
  decodeUartFrames, estimateBaud, decodeI2cBus, i2cTransactions, decodeSpi, decodeOneWire, decodeCan,
  decodeWs2812, decodeIrNec, decodeIrRc5, decodeSwd, findTrigger, measureChannel,
  exportVcd, importVcd, importVcdFile, exportSigrok, importSigrok, canCrc15, dallasCrc8, DECODERS
} from '../src/utils/logicDecoders';
import {
  SignalWriter, synthUart, synthI2c, synthSpi, synthOneWire, synthCan, synthWs2812, synthNec, synthRc5, synthSwd, demoCapture
} from '../src/utils/logicSynth';

const writer = (rate, n, idle) => {
  const buf = new Uint8Array(n);
  return { buf, w: new SignalWriter(buf, rate, idle) };
};
const bitsOf = (bytes) => bytes.flatMap((b) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1));

describe('reference CRCs', () => {
  it('CRC-15/CAN of "123456789" is 0x059E', () => {
    expect(canCrc15(bitsOf([...new TextEncoder().encode('123456789')]))).toBe(0x059e);
  });
  it('CRC-8/MAXIM of "123456789" is 0xA1', () => {
    expect(dallasCrc8([...new TextEncoder().encode('123456789')])).toBe(0xa1);
  });
});

describe('UART', () => {
  it('decodes 8N1 and guesses the baud rate', () => {
    const { buf, w } = writer(2e6, 20000, { 2: 1 });
    w.at(20);
    synthUart(w, 2, [...new TextEncoder().encode('Hi!U')], { baud: 57600 });
    const out = decodeUartFrames(buf, { channel: 2, baud: 57600, sampleRate: 2e6 });
    expect(out.map((o) => o.byte)).toEqual([0x48, 0x69, 0x21, 0x55]);
    expect(out.every((o) => o.errors.length === 0)).toBe(true);
    expect(estimateBaud(buf, 2, 2e6).baud).toBe(57600);
  });

  it('checks even parity and flags a wrong baud as errors', () => {
    const { buf, w } = writer(1e6, 5000, { 0: 1 });
    w.at(10);
    synthUart(w, 0, [0x31, 0x07], { baud: 9600, parity: 'even' });
    const ok = decodeUartFrames(buf, { channel: 0, baud: 9600, sampleRate: 1e6, parity: 'even' });
    expect(ok.map((o) => [o.byte, o.errors])).toEqual([[0x31, []], [0x07, []]]);
    const odd = decodeUartFrames(buf, { channel: 0, baud: 9600, sampleRate: 1e6, parity: 'odd' });
    expect(odd.every((o) => o.errors.includes('parity'))).toBe(true);
  });
});

describe('I2C', () => {
  it('splits address, data, repeated start and NACK', () => {
    const { buf, w } = writer(4e6, 30000, { 0: 1, 1: 1 });
    w.at(10);
    synthI2c(w, 0, 1, [{ addr: 0x76, data: [0xd0] }, { addr: 0x76, read: true, data: [0x60], nack: 0 }, { addr: 0x50, addrNack: true }]);
    const items = decodeI2cBus(buf, { scl: 0, sda: 1 });
    const txs = i2cTransactions(items);
    expect(txs).toHaveLength(3);
    expect(txs[0]).toMatchObject({ addr: 0x76, read: false, bytes: [0xd0], ack: true });
    expect(txs[1]).toMatchObject({ addr: 0x76, read: true, bytes: [0x60] });
    expect(txs[2]).toMatchObject({ addr: 0x50, ack: false, nacked: true });
    expect(items.find((i) => i.type === 'address').label).toContain('BME280');
  });
});

describe('SPI', () => {
  for (const mode of [0, 1, 2, 3]) {
    it(`decodes mode ${mode}`, () => {
      const { buf, w } = writer(8e6, 10000, { 4: 1, 7: mode >> 1 });
      w.at(5);
      synthSpi(w, { cs: 4, clk: 7, mosi: 5, miso: 6 }, [0x9f, 0x00, 0x00], [0xff, 0xef, 0x40], { mode });
      const out = decodeSpi(buf, { cs: 4, clk: 7, mosi: 5, miso: 6, mode });
      const words = out.filter((o) => o.type === 'word');
      expect(words.map((x) => [x.mosi, x.miso])).toEqual([[0x9f, 0xff], [0, 0xef], [0, 0x40]]);
      expect(out.find((o) => o.type === 'cs').label).toBe('CS 3 words');
    });
  }

  it('decodes LSB-first', () => {
    const { buf, w } = writer(8e6, 5000, { 4: 1, 7: 0 });
    synthSpi(w, { cs: 4, clk: 7, mosi: 5, miso: 6 }, [0x01], [0x80], { msbFirst: false });
    const [word] = decodeSpi(buf, { msbFirst: false }).filter((o) => o.type === 'word');
    expect([word.mosi, word.miso]).toEqual([0x01, 0x80]);
  });
});

describe('1-Wire', () => {
  it('decodes reset, presence, commands and a ROM ID with its CRC', () => {
    const { buf, w } = writer(1e6, 20000, { 3: 1 });
    const rom = [0x28, 0xff, 0x4c, 0x2a, 0x91, 0x16, 0x04];
    synthOneWire(w, 3, [0x55, ...rom, dallasCrc8(rom), 0x44]);
    const out = decodeOneWire(buf, { channel: 3, sampleRate: 1e6 });
    expect(out.slice(0, 3).map((o) => o.type)).toEqual(['reset', 'presence', 'byte']);
    expect(out[2].label).toBe('MATCH ROM');
    const romItem = out.find((o) => o.type === 'rom');
    expect(romItem.crcOk).toBe(true);
    expect(romItem.label).toContain('DS18B20');
    expect(out[out.length - 1].label).toContain('CONVERT T');
  });

  it('flags a bad ROM CRC', () => {
    const { buf, w } = writer(1e6, 20000, { 3: 1 });
    synthOneWire(w, 3, [0x33, 0x28, 1, 2, 3, 4, 5, 6, 0x00]);
    expect(decodeOneWire(buf, { channel: 3, sampleRate: 1e6 }).find((o) => o.type === 'rom').crcOk).toBe(false);
  });
});

describe('CAN', () => {
  it('decodes standard, extended and RTR frames, with stuffing and CRC', () => {
    const { buf, w } = writer(4e6, 40000, { 3: 1 });
    synthCan(w, 3, [
      { id: 0x7df, data: [0x02, 0x01, 0x0c, 0, 0, 0, 0, 0] },
      { id: 0x18db33f1, extended: true, data: [0xff, 0xff, 0x00] },
      { id: 0x123, rtr: true, data: [0, 0] }
    ], { bitrate: 500000 });
    const frames = decodeCan(buf, { channel: 3, bitrate: 500000, sampleRate: 4e6 });
    expect(frames.map((f) => f.type)).toEqual(['frame', 'frame', 'frame']);
    expect(frames[0]).toMatchObject({ id: 0x7df, extended: false, dlc: 8, data: [2, 1, 0x0c, 0, 0, 0, 0, 0], crcOk: true, ack: true });
    expect(frames[1]).toMatchObject({ id: 0x18db33f1, extended: true, data: [0xff, 0xff, 0], crcOk: true });
    expect(frames[2]).toMatchObject({ id: 0x123, rtr: true, dlc: 2, data: [] });
  });

  it('tolerates a slightly off bit rate by resynchronising on edges', () => {
    const { buf, w } = writer(4e6, 20000, { 3: 1 });
    synthCan(w, 3, [{ id: 0x100, data: [0x00, 0x00, 0x00, 0xff, 0xff, 0xff] }], { bitrate: 507000 });
    const [f] = decodeCan(buf, { channel: 3, bitrate: 500000, sampleRate: 4e6 });
    expect(f).toMatchObject({ id: 0x100, crcOk: true });
  });

  it('reports a missing ACK', () => {
    const { buf, w } = writer(4e6, 20000, { 3: 1 });
    synthCan(w, 3, [{ id: 0x55, data: [1], ack: false }]);
    expect(decodeCan(buf, { channel: 3, sampleRate: 4e6 })[0].ack).toBe(false);
  });
});

describe('WS2812', () => {
  it('decodes GRB pixels and the latch', () => {
    const { buf, w } = writer(12e6, 8000, { 7: 0 });
    synthWs2812(w, 7, [{ r: 255, g: 0, b: 0 }, { r: 1, g: 2, b: 3 }]);
    const out = decodeWs2812(buf, { channel: 7, sampleRate: 12e6 });
    const leds = out.filter((o) => o.type === 'led');
    expect(leds.map((l) => [l.r, l.g, l.b])).toEqual([[255, 0, 0], [1, 2, 3]]);
    expect(out[out.length - 1]).toMatchObject({ type: 'reset', label: 'RESET (2 LEDs)' });
  });
});

describe('IR remotes', () => {
  it('decodes NEC frames and repeats', () => {
    const { buf, w } = writer(100e3, 14000, { 7: 1 });
    synthNec(w, 7, 0x04, 0x08, { repeat: true });
    const out = decodeIrNec(buf, { channel: 7, sampleRate: 100e3 });
    expect(out[0]).toMatchObject({ type: 'nec', address: 0x04, command: 0x08, valid: true, extended: false });
    expect(out[1].type).toBe('repeat');
  });

  it('decodes RC-5 including the RC-5X command bit', () => {
    for (const [address, command, toggle] of [[0, 12, 0], [5, 0x35, 1], [31, 0x41, 0]]) {
      const { buf, w } = writer(100e3, 4000, { 7: 1 });
      synthRc5(w, 7, address, command, { toggle });
      const [f] = decodeIrRc5(buf, { channel: 7, sampleRate: 100e3 });
      expect(f).toMatchObject({ address, command, toggle });
    }
  });
});

describe('SWD', () => {
  it('decodes a line reset, DP and AP reads and writes, and WAIT', () => {
    const { buf, w } = writer(8e6, 30000, { 0: 1, 1: 1 });
    synthSwd(w, 0, 1, [
      { ap: false, read: true, addr: 0x0, data: 0x2ba01477 },
      { ap: false, read: false, addr: 0x8, data: 0x000000f0 },
      { ap: true, read: true, addr: 0xc, data: 0xdeadbeef },
      { ap: true, read: true, addr: 0xc, ack: 2 }
    ]);
    const out = decodeSwd(buf, { swclk: 0, swdio: 1 });
    expect(out[0].type).toBe('reset');
    const t = out.filter((o) => o.type === 'transfer');
    expect(t[0]).toMatchObject({ ap: false, read: true, reg: 'IDCODE', ackName: 'OK', data: 0x2ba01477, parityOk: true });
    expect(t[1]).toMatchObject({ ap: false, read: false, reg: 'SELECT', data: 0xf0, parityOk: true });
    expect(t[2]).toMatchObject({ ap: true, reg: 'DRW', data: 0xdeadbeef });
    expect(t[3]).toMatchObject({ ackName: 'WAIT', data: null });
  });
});

describe('triggers and measurements', () => {
  const buf = Uint8Array.from([0, 0, 1, 1, 0, 0, 1, 0, 0, 3, 3, 0]);
  it('finds edges, patterns and glitches in both directions', () => {
    expect(findTrigger(buf, { kind: 'rising', channel: 0 })).toBe(2);
    expect(findTrigger(buf, { kind: 'rising', channel: 0, from: 2 })).toBe(6);
    expect(findTrigger(buf, { kind: 'falling', channel: 0, from: 11, direction: -1 })).toBe(7);
    expect(findTrigger(buf, { kind: 'pattern', mask: 3, value: 3 })).toBe(9);
    expect(findTrigger(buf, { kind: 'pulse', channel: 0, maxWidth: 1 })).toBe(6);
    expect(findTrigger(buf, { kind: 'rising', channel: 5 })).toBe(-1);
  });

  it('measures frequency and duty cycle', () => {
    const sq = new Uint8Array(1000).map((_, i) => (i % 10 < 3 ? 1 : 0));
    const m = measureChannel(sq, 0, 1e6);
    expect(m.frequency).toBeCloseTo(100000, 0);
    expect(m.duty).toBeCloseTo(30, 0);
  });
});

describe('capture files', () => {
  const { samples, sampleRate } = demoCapture('i2c');

  it('round-trips VCD', () => {
    const vcd = exportVcd(samples, sampleRate, ['SCL', 'SDA']);
    expect(vcd).toContain('$timescale 1 ns $end');
    const back = importVcdFile(vcd);
    expect(back.sampleRate).toBe(sampleRate);
    expect(back.names.slice(0, 2)).toEqual(['SCL', 'SDA']);
    expect(Array.from(back.samples.slice(0, 1000))).toEqual(Array.from(samples.slice(0, 1000)));
  });

  it('imports a foreign VCD by its timescale', () => {
    const text = '$timescale 10 ns $end\n$var wire 1 ! clk $end\n$var wire 1 " d $end\n$enddefinitions $end\n#0\n0!\n1"\n#5\n1!\n#10\n0!\n0"\n#15\n';
    const back = importVcd(text);
    expect(back.sampleRate).toBe(20e6);
    expect(Array.from(back.samples)).toEqual([2, 3, 0]);
  });

  it('round-trips a sigrok session', async () => {
    const sr = await exportSigrok(samples, sampleRate);
    const back = await importSigrok(sr);
    expect(back.sampleRate).toBe(sampleRate);
    expect(back.samples).toEqual(samples);
  });
});

describe('demo captures', () => {
  it.each(Object.keys(DECODERS))('%s demo decodes cleanly', (id) => {
    const d = DECODERS[id];
    const { samples, sampleRate } = demoCapture(id);
    const items = d.run(samples, d.channels, d.params, sampleRate);
    expect(items.length).toBeGreaterThan(1);
    // The only errors in demos are the deliberate NACK / WAIT examples.
    expect(items.filter((i) => i.kind === 'error' && !/NACK|WAIT/.test(i.label))).toEqual([]);
  });
});
