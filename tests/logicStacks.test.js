import { describe, it, expect } from 'vitest';
import { decodeSpi, decodeUartFrames, decodeCan, decodeI2cBus, DECODERS, runStack } from '../src/utils/logicDecoders';
import { stackSpiFlash, stackI2cRegisters, stackNmea, stackCanNames, describeJedecId } from '../src/utils/logicStacks';
import { SignalWriter, synthSpi, synthUart, synthCan, synthI2c } from '../src/utils/logicSynth';

const writer = (rate, n, idle) => {
  const buf = new Uint8Array(n);
  return { buf, w: new SignalWriter(buf, rate, idle) };
};
const ch = { cs: 4, clk: 7, mosi: 5, miso: 6 };

function spiLabels(transactions) {
  const { buf, w } = writer(8e6, 40000, { 4: 1, 7: 0 });
  w.at(5);
  for (const [m, r] of transactions) synthSpi(w, ch, m, r);
  return stackSpiFlash(decodeSpi(buf, { ...ch })).map((x) => x.label);
}

describe('SPI flash stack', () => {
  it('turns a recorded 0x9F transaction into the JEDEC ID and part name', () => {
    expect(spiLabels([[[0x9f, 0, 0, 0], [0xff, 0xef, 0x40, 0x18]]])).toEqual(['JEDEC ID EF 40 18 (Winbond W25Q128)']);
    expect(describeJedecId([0xc2, 0x20, 0x17])).toBe('JEDEC ID C2 20 17 (Macronix MX25L6406E)');
    expect(describeJedecId([0xef, 0x99, 0x15])).toBe('JEDEC ID EF 99 15 (Winbond, 2 MiB)');
    expect(describeJedecId([0x12, 0x34, 0x00])).toContain('unknown manufacturer');
  });

  it('annotates read, write enable, page program, erase and status commands', () => {
    const labels = spiLabels([
      [[0x06], [0xff]],
      [[0x20, 0x00, 0x10, 0x00], [0, 0, 0, 0]],
      [[0x02, 0x00, 0x10, 0x00, 0xde, 0xad], [0, 0, 0, 0, 0, 0]],
      [[0x05, 0x00], [0xff, 0x03]],
      [[0x03, 0x00, 0x10, 0x00, 0, 0], [0, 0, 0, 0, 0xde, 0xad]],
      [[0xd8, 0x01, 0x00, 0x00], [0, 0, 0, 0]]
    ]);
    expect(labels).toEqual([
      'WRITE ENABLE',
      'SECTOR ERASE 4 KB 0x001000',
      'PAGE PROGRAM 0x001000, 2 bytes: DE AD',
      'READ STATUS 1 = 0x03 (BUSY|WEL)',
      'READ 0x001000, 2 bytes: DE AD',
      'BLOCK ERASE 64 KB 0x010000'
    ]);
  });

  it('is declared on the SPI decoder and reachable through runStack', () => {
    expect(DECODERS.spi.stack.map((s) => s.id)).toEqual(['spiflash']);
    const { buf, w } = writer(8e6, 8000, { 4: 1, 7: 0 });
    w.at(5);
    synthSpi(w, ch, [0x9f, 0, 0, 0], [0xff, 0xef, 0x40, 0x18]);
    const items = decodeSpi(buf, ch);
    expect(runStack('spi', 'spiflash', items, {})[0].label).toContain('Winbond W25Q128');
    expect(runStack('spi', 'nope', items, {})).toEqual([]);
  });
});

describe('I2C register stack', () => {
  const addr = (a, read, ack = true) => ({ type: 'address', start: 0, end: 1, addr: a, read, ack });
  const data = (b, ack = true) => ({ type: 'data', start: 2, end: 3, byte: b, ack });

  it('names registers and merges pointer write + read', () => {
    const out = stackI2cRegisters([
      { type: 'start' }, addr(0x68, false), data(0x6b), data(0x00), { type: 'stop' },
      { type: 'start' }, addr(0x68, false), data(0x75), { type: 'start', label: 'Sr' }, addr(0x68, true), data(0x68), { type: 'stop' }
    ]);
    expect(out.map((o) => o.label)).toEqual([
      '0x68 MPU-6050 / DS3231 write reg 0x6B PWR_MGMT_1 = 00',
      '0x68 MPU-6050 / DS3231 read reg 0x75 WHO_AM_I = 68'
    ]);
  });

  it('decodes EEPROM reads and writes with the configured address width', () => {
    const items = [
      { type: 'start' }, addr(0x50, false), data(0x00), data(0x10), data(0xaa), data(0xbb), { type: 'stop' },
      { type: 'start' }, addr(0x50, false), data(0x00), data(0x10), { type: 'start', label: 'Sr' }, addr(0x50, true), data(0xaa), data(0xbb), { type: 'stop' }
    ];
    expect(stackI2cRegisters(items, { addrBytes: 2 }).map((o) => o.label)).toEqual([
      'EEPROM 0x50 write @0x0010, 2 bytes: AA BB',
      'EEPROM 0x50 read @0x0010, 2 bytes: AA BB'
    ]);
  });

  it('flags an address NACK and handles OLED control bytes', () => {
    const out = stackI2cRegisters([addr(0x20, false, false), addr(0x3c, false), data(0x00), data(0xae)]);
    expect(out[0]).toMatchObject({ kind: 'error' });
    expect(out[1].label).toContain('display off');
  });

  it('works on a real decoded capture', () => {
    const { buf, w } = writer(4e6, 20000, { 0: 1, 1: 1 });
    w.at(10);
    synthI2c(w, 0, 1, [{ addr: 0x76, data: [0xf4, 0x27] }]);
    const out = stackI2cRegisters(decodeI2cBus(buf, { scl: 0, sda: 1 }));
    expect(out[0].label).toContain('write reg 0xF4 CTRL_MEAS = 27');
  });
});

describe('NMEA stack', () => {
  const nmeaLabels = (text) => {
    const { buf, w } = writer(1e6, text.length * 1200 + 3000, { 2: 1 });
    w.at(20);
    synthUart(w, 2, [...new TextEncoder().encode(text)], { baud: 9600 });
    return stackNmea(decodeUartFrames(buf, { channel: 2, baud: 9600, sampleRate: 1e6 }));
  };
  const sumOf = (body) => [...body].reduce((x, c) => x ^ c.charCodeAt(0), 0).toString(16).toUpperCase().padStart(2, '0');
  const withSum = (body) => '$' + body + '*' + sumOf(body) + '\r\n';
  const GGA_BODY = 'GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,';
  const GGA = withSum(GGA_BODY);

  it('decodes a GGA sentence and verifies its checksum', () => {
    const [s] = nmeaLabels(GGA);
    expect(s.checksumOk).toBe(true);
    expect(s.label).toContain('GPGGA 12:35:19 48.11730, 11.51667 fix 1');
    expect(s.label).toContain('8 sats');
    expect(s.label).toContain('alt 545.4 M');
    expect(s.kind).toBe('data');
  });

  it('flags a bad checksum', () => {
    const good = sumOf(GGA_BODY);
    const bad = (parseInt(good, 16) ^ 1).toString(16).toUpperCase().padStart(2, '0');
    const [s] = nmeaLabels('$' + GGA_BODY + '*' + bad + '\r\n');
    expect(s.checksumOk).toBe(false);
    expect(s.kind).toBe('error');
    expect(s.label).toContain('CHECKSUM BAD (got ' + bad + ', expected ' + good + ')');
  });

  it('splits back-to-back sentences', () => {
    const rmc = withSum('GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W');
    const out = nmeaLabels(GGA + rmc);
    expect(out).toHaveLength(2);
    expect(out[1].label).toContain('GPRMC');
    expect(out[1].label).toContain('valid');
    expect(out[1].checksumOk).toBe(true);
  });
});

describe('CAN names stack', () => {
  it('names UDS and OBD requests, responses and negative responses', () => {
    const f = (id, data, extended = false) => ({ type: 'frame', start: 0, end: 10, id, extended, rtr: false, data });
    const out = stackCanNames([
      f(0x7e0, [0x03, 0x22, 0xf1, 0x90]),
      f(0x7e8, [0x07, 0x62, 0xf1, 0x90, 1, 2, 3, 4]),
      f(0x7e8, [0x03, 0x7f, 0x22, 0x78]),
      f(0x7e8, [0x03, 0x7f, 0x27, 0x35]),
      f(0x7df, [0x02, 0x01, 0x0c]),
      f(0x7e0, [0x02, 0x3e, 0x00])
    ]).map((o) => o.label);
    expect(out[0]).toBe('UDS ReadDataByIdentifier request: DID F190 VIN');
    expect(out[1]).toBe('UDS ReadDataByIdentifier response: DID F190 VIN');
    expect(out[2]).toBe('NEGATIVE ReadDataByIdentifier: response pending (NRC 0x78)');
    expect(out[3]).toBe('NEGATIVE SecurityAccess: invalid key (NRC 0x35)');
    expect(out[4]).toBe('OBD Show current data request: PID/IC 0x0C');
    expect(out[5]).toBe('UDS TesterPresent request');
  });

  it('decodes J1939 frames from a decoded capture', () => {
    const { buf, w } = writer(4e6, 40000, { 3: 1 });
    synthCan(w, 3, [
      { id: 0x18fef100, extended: true, data: [0, 0x00, 0x64, 0, 0, 0, 0, 0] },
      { id: 0x0cf00400, extended: true, data: [0xf0, 0x7d, 0x7d, 0x40, 0x1f, 0, 0xf0, 0x7d] }
    ]);
    const out = stackCanNames(decodeCan(buf, { channel: 3, bitrate: 500000, sampleRate: 4e6 }));
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe('CCVS SA 00: Wheel-based vehicle speed 100 km/h, Cruise control set speed 0 km/h');
    expect(out[1].label).toContain('EEC1 SA 00');
    expect(out[1].label).toContain('Engine speed 1000 rpm');
  });
});
