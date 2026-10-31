import { describe, it, expect } from 'vitest';
import { SerialLink, FakeSerialPort } from '../src/utils/serialLink';
import { BusExplorerClient } from '../src/utils/busExplorerDriver';

import { fakeBusPirate } from './helpers/fakeBusPirate';

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
