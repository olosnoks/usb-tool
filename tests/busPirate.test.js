import { describe, it, expect } from 'vitest';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import { BusExplorerClient } from '../src/utils/busExplorerDriver';

const enc = new TextEncoder();

// Bus Pirate v3 firmware model: text console -> BBIO -> I2C / SPI.
function fakeBusPirate({ devices = { 0x68: { 0x75: 0x68, 0x6b: 0x40 } }, zerosNeeded = 3 } = {}) {
  const st = { mode: 'console', zeros: 0, i2c: { started: false, addr: null, reading: false, ptr: 0 }, spiCs: false, periph: 0, log: [] };
  const port = new FakeSerialPort((bytes, p) => {
    let i = 0;
    while (i < bytes.length) {
      const c = bytes[i++];
      st.log.push(c);
      if (st.mode === 'console') {
        if (c === 0x00 && ++st.zeros >= zerosNeeded) { st.mode = 'bbio'; p.feed(enc.encode('BBIO1')); }
        continue;
      }
      if (c === 0x00) { st.mode = 'bbio'; p.feed(enc.encode('BBIO1')); continue; }
      if (st.mode === 'bbio') {
        if (c === 0x02) { st.mode = 'i2c'; p.feed(enc.encode('I2C1')); }
        else if (c === 0x01) { st.mode = 'spi'; p.feed(enc.encode('SPI1')); }
        else if (c === 0x0f) { st.mode = 'console'; st.zeros = 0; p.feed([0x01]); }
        continue;
      }
      if ((c & 0xf0) === 0x40) { st.periph = c & 0x0f; p.feed([0x01]); continue; }
      if ((c & 0xf8) === 0x60) { p.feed([0x01]); continue; }
      if (st.mode === 'i2c') {
        const t = st.i2c;
        if (c === 0x02) { t.started = true; t.addr = null; p.feed([0x01]); }
        else if (c === 0x03) { t.started = false; p.feed([0x01]); }
        else if (c === 0x06 || c === 0x07) p.feed([0x01]);
        else if (c === 0x04) { const dev = devices[t.addr] || {}; p.feed([dev[t.ptr] ?? 0]); t.ptr++; }
        else if ((c & 0xf0) === 0x10) {
          const n = (c & 0x0f) + 1;
          const data = bytes.slice(i, i + n); i += n;
          const acks = [];
          let first = t.addr === null || !t.reading;
          data.forEach((b, k) => {
            if (k === 0 && (t.addr === null || first)) {
              const a = b >> 1;
              const ack = a in devices;
              if (ack) { t.addr = a; t.reading = (b & 1) === 1; }
              acks.push(ack ? 0 : 1);
              first = false;
              t.regNext = !t.reading;
            } else if (t.regNext) { t.ptr = b; t.regNext = false; acks.push(0); }
            else { devices[t.addr][t.ptr++] = b; acks.push(0); }
          });
          p.feed([0x01, ...acks]);
        }
        continue;
      }
      if (st.mode === 'spi') {
        if (c === 0x02) { st.spiCs = true; st.spiBuf = []; p.feed([0x01]); }
        else if (c === 0x03) { st.spiCs = false; p.feed([0x01]); }
        else if ((c & 0xf0) === 0x80) p.feed([0x01]);
        else if ((c & 0xf0) === 0x10) {
          const n = (c & 0x0f) + 1;
          const data = Array.from(bytes.slice(i, i + n)); i += n;
          const out = data.map(() => 0xff);
          st.spiBuf.push(...data);
          if (st.spiBuf[0] === 0x9f) {
            const id = [0xff, 0xef, 0x40, 0x17];
            const base = st.spiBuf.length - data.length;
            for (let k = 0; k < data.length; k++) out[k] = id[base + k] ?? 0xff;
          }
          p.feed([0x01, ...out]);
        }
      }
    }
  });
  return { port, st, devices };
}

async function connected(opts) {
  const fake = fakeBusPirate(opts);
  const link = new SerialLink(fake.port);
  await link.open({ baudRate: 115200 });
  const client = new BusExplorerClient(() => {});
  await client.connectHardware({ link });
  return { client, ...fake };
}

describe('Bus Pirate binary mode', () => {
  it('enters BBIO and raw I2C from the text console', async () => {
    const { client, st } = await connected();
    expect(client.isConnected).toBe(true);
    expect(st.mode).toBe('i2c');
  });

  it('scans the bus and finds only devices that ACK', async () => {
    const { client } = await connected({ devices: { 0x3c: {}, 0x68: {} } });
    expect(await client.scanI2cBus()).toEqual([0x3c, 0x68]);
  });

  it('reads registers with a repeated start and writes them', async () => {
    const { client, devices } = await connected();
    client.initSimulatedRegisters(0x68);
    expect(await client.readRegisters(0x75, 1)).toEqual([0x68]);
    await client.writeRegister(0x6b, 0x00);
    expect(devices[0x68][0x6b]).toBe(0x00);
    expect(await client.readRegisters(0x6b, 1)).toEqual([0x00]);
  });

  it('reports a missing device instead of returning zeros', async () => {
    const { client } = await connected();
    client.initSimulatedRegisters(0x50);
    await expect(client.readRegisters(0, 4)).rejects.toThrow(/No ACK from 0x50/);
  });

  it('switches to SPI and reads a JEDEC ID', async () => {
    const { client, st } = await connected();
    const id = await client.spiTransfer([0x9f, 0, 0, 0]);
    expect(id).toEqual([0xff, 0xef, 0x40, 0x17]);
    expect(st.mode).toBe('spi');
    expect(st.spiCs).toBe(false); // CS released after the transfer
  });

  it('turns power and pull-ups on and off', async () => {
    const { client, st } = await connected();
    await client.configure({ power: true, pullups: true });
    expect(st.periph & 0x0c).toBe(0x0c);
    await client.disconnect();
    expect(st.mode).toBe('console');
  });

  it('fails clearly on something that is not a Bus Pirate', async () => {
    const port = new FakeSerialPort(() => {});
    const link = new SerialLink(port);
    await link.open({ baudRate: 115200 });
    const client = new BusExplorerClient(() => {});
    await expect(client.connectHardware({ link })).rejects.toThrow(/BBIO1/);
  }, 10000);
});
