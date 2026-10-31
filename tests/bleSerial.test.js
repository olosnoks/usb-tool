import { describe, it, expect } from 'vitest';
import {
  BleSerialPort,
  BLE_UART_PROFILES,
  pickUartCharacteristics,
  looksLikeUart,
  uartProfileFor
} from '../src/utils/bleSerial';
import { canonicalUuid } from '../src/utils/bleDriver';

const NUS = BLE_UART_PROFILES.find((p) => p.id === 'nus');

class FakeTarget {
  constructor() { this.listeners = {}; }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn); }
  emit(t, e) { (this.listeners[t] || []).forEach((fn) => fn(e)); }
}

class FakeChar extends FakeTarget {
  constructor(uuid, properties) {
    super();
    this.uuid = uuid;
    this.properties = properties;
    this.writes = [];
    this.notifying = false;
  }
  async startNotifications() { this.notifying = true; }
  async stopNotifications() { this.notifying = false; }
  async writeValueWithoutResponse(b) { this.writes.push(Array.from(b)); }
  async writeValueWithResponse(b) { this.writes.push(Array.from(b)); }
  notify(bytes) {
    const u8 = new Uint8Array(bytes);
    this.value = new DataView(u8.buffer);
    this.emit('characteristicvaluechanged', { target: this });
  }
}

function fakeDevice(serviceUuid, chars) {
  const device = new FakeTarget();
  device.id = 'dev-1';
  device.name = 'ESP32-UART';
  const service = { uuid: serviceUuid, getCharacteristics: async () => chars };
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this; },
    disconnect() { this.connected = false; device.emit('gattserverdisconnected', {}); },
    async getPrimaryService(u) {
      if (canonicalUuid(u) !== canonicalUuid(serviceUuid)) throw new Error('NotFoundError');
      return service;
    }
  };
  return device;
}

async function readSome(port) {
  const reader = port.readable.getReader();
  const { value } = await reader.read();
  reader.releaseLock();
  return Array.from(value);
}

describe('UART characteristic detection', () => {
  it('uses the assigned UUIDs of a known profile', () => {
    const rx = new FakeChar(NUS.rx, { notify: true });
    const tx = new FakeChar(NUS.tx, { write: true, writeWithoutResponse: true });
    const picked = pickUartCharacteristics(NUS.service, [tx, rx]);
    expect(picked.rx).toBe(rx);
    expect(picked.tx).toBe(tx);
    expect(picked.profile.id).toBe('nus');
  });

  it('falls back to notify + write properties for unknown services', () => {
    const custom = '12345678-0000-0000-0000-000000000000';
    const a = new FakeChar('aaaa0001-0000-0000-0000-000000000000', { read: true });
    const n = new FakeChar('aaaa0002-0000-0000-0000-000000000000', { notify: true });
    const w = new FakeChar('aaaa0003-0000-0000-0000-000000000000', { write: true });
    expect(pickUartCharacteristics(custom, [a, n, w])).toMatchObject({ rx: n, tx: w, profile: null });
    expect(looksLikeUart(custom, [a, n, w])).toBe(true);
    expect(looksLikeUart(custom, [a])).toBe(false);
  });

  it('knows the HM-10 single-characteristic profile', () => {
    expect(uartProfileFor('ffe0').id).toBe('hm10');
    const both = new FakeChar(canonicalUuid(0xffe1), { notify: true, writeWithoutResponse: true });
    const picked = pickUartCharacteristics(0xffe0, [both]);
    expect(picked.rx).toBe(both);
    expect(picked.tx).toBe(both);
  });
});

describe('BleSerialPort', () => {
  it('auto-detects the UART service and streams notifications as bytes', async () => {
    const rx = new FakeChar(NUS.rx, { notify: true });
    const tx = new FakeChar(NUS.tx, { writeWithoutResponse: true });
    const port = new BleSerialPort(fakeDevice(NUS.service, [rx, tx]));
    await port.open({ baudRate: 115200 });
    expect(port.serviceUuid).toBe(NUS.service);
    expect(rx.notifying).toBe(true);
    const pending = readSome(port);
    rx.notify([0x68, 0x69, 0x0a]);
    expect(await pending).toEqual([0x68, 0x69, 0x0a]);
    expect(port.getInfo()).toMatchObject({ bluetoothName: 'ESP32-UART' });
  });

  it('splits writes into 20-byte packets', async () => {
    const rx = new FakeChar(NUS.rx, { notify: true });
    const tx = new FakeChar(NUS.tx, { writeWithoutResponse: true });
    const port = new BleSerialPort(fakeDevice(NUS.service, [rx, tx]));
    await port.open();
    const writer = port.writable.getWriter();
    await writer.write(new Uint8Array(45).fill(0x41));
    writer.releaseLock();
    expect(tx.writes.map((w) => w.length)).toEqual([20, 20, 5]);
  });

  it('reports a dropped link once and closes the stream', async () => {
    const rx = new FakeChar(NUS.rx, { notify: true });
    const tx = new FakeChar(NUS.tx, { write: true });
    const device = fakeDevice(NUS.service, [rx, tx]);
    const port = new BleSerialPort(device);
    await port.open();
    let drops = 0;
    port.ondisconnect = () => { drops++; };
    const reader = port.readable.getReader();
    device.gatt.disconnect();
    expect(drops).toBe(1);
    expect((await reader.read()).done).toBe(true);
    expect(port.isOpen).toBe(false);
  });

  it('close() stops notifications and disconnects without firing ondisconnect', async () => {
    const rx = new FakeChar(NUS.rx, { notify: true });
    const tx = new FakeChar(NUS.tx, { write: true });
    const device = fakeDevice(NUS.service, [rx, tx]);
    const port = new BleSerialPort(device);
    await port.open();
    let drops = 0;
    port.ondisconnect = () => { drops++; };
    await port.close();
    expect(rx.notifying).toBe(false);
    expect(device.gatt.connected).toBe(false);
    expect(drops).toBe(0);
  });

  it('fails clearly when the device has no UART service', async () => {
    const port = new BleSerialPort(fakeDevice('0000180f-0000-1000-8000-00805f9b34fb', []));
    await expect(port.open()).rejects.toThrow(/No BLE serial/);
  });
});
