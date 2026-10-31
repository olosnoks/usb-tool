/**
 * bleSerial.js — a BLE "UART" peripheral exposed as a SerialPort-shaped object.
 *
 * Many boards (ESP32 / nRF sketches, HM-10 / JDY modules, Flipper Zero, Microchip
 * RN4870 ...) carry a serial console over a GATT service: one characteristic
 * notifies incoming bytes, another accepts writes. BleSerialPort wraps that pair
 * in the same open / readable / writable / close / getInfo shape as the Web
 * Serial API and WebUsbSerialPort, so the Terminal and every serial tool can use
 * a BLE device without knowing it isn't a USB cable.
 */

import { canonicalUuid } from './bleDriver.js';

// Known UART profiles. `rx` notifies (device -> us), `tx` takes writes (us -> device).
export const BLE_UART_PROFILES = [
  {
    id: 'nus', name: 'Nordic UART Service',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
  },
  {
    id: 'hm10', name: 'HM-10 / JDY serial (FFE0)',
    service: canonicalUuid(0xffe0), rx: canonicalUuid(0xffe1), tx: canonicalUuid(0xffe1)
  },
  {
    id: 'microchip', name: 'Microchip / ISSC Transparent UART',
    service: '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    rx: '49535343-1e4d-4bd9-ba61-23c647249616',
    tx: '49535343-8841-43f4-a8d4-ecbe34729bb3'
  },
  {
    id: 'flipper', name: 'Flipper Zero serial',
    service: '8fe5b3d5-2e7f-4a98-2a48-7acc60fe0000',
    rx: '19ed82ae-ed21-4c9d-4145-228e61fe0000',
    tx: '19ed82ae-ed21-4c9d-4145-228e62fe0000'
  }
];

export const BLE_UART_SERVICE_UUIDS = BLE_UART_PROFILES.map((p) => p.service);

/** The UART profile a service UUID belongs to, or null. */
export function uartProfileFor(serviceUuid) {
  const u = canonicalUuid(serviceUuid);
  return BLE_UART_PROFILES.find((p) => p.service === u) || null;
}

/**
 * Pick the RX (notify/indicate) and TX (write) characteristics of a service.
 * Known profiles use their assigned UUIDs; anything else falls back to "first
 * notifying characteristic" + "first writable characteristic".
 */
export function pickUartCharacteristics(serviceUuid, characteristics) {
  const byUuid = (u) => characteristics.find((c) => canonicalUuid(c.uuid) === u);
  const profile = uartProfileFor(serviceUuid);
  const p = (c) => c.properties || {};
  const notifies = (c) => c && (p(c).notify || p(c).indicate);
  const writes = (c) => c && (p(c).writeWithoutResponse || p(c).write);
  // A profile's UUID only counts if the characteristic really can do the job.
  let rx = profile && notifies(byUuid(profile.rx)) ? byUuid(profile.rx) : null;
  let tx = profile && writes(byUuid(profile.tx)) ? byUuid(profile.tx) : null;
  if (!rx) rx = characteristics.find((c) => p(c).notify || p(c).indicate) || null;
  if (!tx) tx = characteristics.find((c) => p(c).writeWithoutResponse || p(c).write) || null;
  return { rx, tx, profile };
}

/** True when a service could carry a serial stream (known UART, or notify + write). */
export function looksLikeUart(serviceUuid, characteristics) {
  if (uartProfileFor(serviceUuid)) return true;
  const { rx, tx } = pickUartCharacteristics(serviceUuid, characteristics);
  return Boolean(rx && tx);
}

export class BleSerialPort {
  /**
   * @param {BluetoothDevice} device  A device from navigator.bluetooth.requestDevice.
   * @param {object} [opts]
   * @param {string} [opts.serviceUuid]  Use this service instead of auto-detecting.
   * @param {number} [opts.chunkSize=20] Bytes per write (20 fits the default ATT MTU).
   */
  constructor(device, { serviceUuid = null, chunkSize = 20 } = {}) {
    this.device = device;
    this.serviceUuid = serviceUuid ? canonicalUuid(serviceUuid) : null;
    this.chunkSize = chunkSize;
    this.profile = null;
    this.rx = null;
    this.tx = null;
    this.readable = null;
    this.writable = null;
    this.isOpen = false;
    this.ondisconnect = null; // called once if the link drops while open
    this._controller = null;
    this._onValue = (e) => {
      const dv = e.target.value;
      if (this._controller && dv) {
        const bytes = new Uint8Array(dv.buffer.slice(dv.byteOffset, dv.byteOffset + dv.byteLength));
        try { this._controller.enqueue(bytes); } catch (err) { /* stream closed */ }
      }
    };
    this._onGattDisconnect = () => {
      if (!this.isOpen) return;
      this._teardown();
      if (this.ondisconnect) this.ondisconnect();
    };
  }

  getInfo() {
    return {
      bluetoothDeviceId: this.device.id,
      bluetoothName: this.device.name || null,
      bluetoothServiceClassId: this.serviceUuid
    };
  }

  /** Connect GATT, find the UART pair, start notifications. Serial options are ignored. */
  async open() {
    if (this.isOpen) throw new Error('Port is already open');
    const server = this.device.gatt.connected ? this.device.gatt : await this.device.gatt.connect();

    let service = null;
    if (this.serviceUuid) {
      service = await server.getPrimaryService(this.serviceUuid);
    } else {
      for (const uuid of BLE_UART_SERVICE_UUIDS) {
        try {
          service = await server.getPrimaryService(uuid);
          this.serviceUuid = uuid;
          break;
        } catch (e) { /* not on this device */ }
      }
    }
    if (!service) throw new Error('No BLE serial (UART) service found on this device');

    const chars = await service.getCharacteristics();
    const { rx, tx, profile } = pickUartCharacteristics(this.serviceUuid, chars);
    if (!rx && !tx) throw new Error('The service has no notifying or writable characteristic');
    this.rx = rx;
    this.tx = tx;
    this.profile = profile;

    this.readable = new ReadableStream({
      start: (controller) => { this._controller = controller; },
      cancel: () => { this._controller = null; }
    });
    this.writable = new WritableStream({ write: (chunk) => this._write(chunk) });

    if (rx) {
      rx.addEventListener('characteristicvaluechanged', this._onValue);
      await rx.startNotifications();
    }
    this.device.addEventListener('gattserverdisconnected', this._onGattDisconnect);
    this.isOpen = true;
  }

  async _write(chunk) {
    if (!this.tx) throw new Error('This BLE serial device has no writable characteristic');
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    const props = this.tx.properties || {};
    const noResponse = props.writeWithoutResponse && typeof this.tx.writeValueWithoutResponse === 'function';
    for (let i = 0; i < bytes.length; i += this.chunkSize) {
      const part = bytes.slice(i, i + this.chunkSize);
      if (noResponse) await this.tx.writeValueWithoutResponse(part);
      else if (typeof this.tx.writeValueWithResponse === 'function') await this.tx.writeValueWithResponse(part);
      else await this.tx.writeValue(part);
    }
  }

  _teardown() {
    this.isOpen = false;
    if (this.rx) this.rx.removeEventListener('characteristicvaluechanged', this._onValue);
    this.device.removeEventListener('gattserverdisconnected', this._onGattDisconnect);
    if (this._controller) { try { this._controller.close(); } catch (e) { /* already closed */ } }
    this._controller = null;
  }

  async close() {
    if (!this.isOpen) return;
    const rx = this.rx;
    this._teardown();
    if (rx) { try { await rx.stopNotifications(); } catch (e) { /* link may be gone */ } }
    try { if (this.device.gatt.connected) this.device.gatt.disconnect(); } catch (e) { /* ignore */ }
  }
}

/**
 * Show the browser's Bluetooth picker filtered to known UART services.
 * `acceptAll` lists every device instead (for custom firmware). Extra service
 * UUIDs are added to optionalServices so their UART can be used.
 */
export async function requestBleSerialPort({ acceptAll = false, extraServices = [] } = {}) {
  if (typeof navigator === 'undefined' || !navigator.bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser');
  }
  const extras = extraServices.map((u) => canonicalUuid(u));
  const optionalServices = [...BLE_UART_SERVICE_UUIDS, ...extras];
  const device = await navigator.bluetooth.requestDevice(
    acceptAll
      ? { acceptAllDevices: true, optionalServices }
      : { filters: BLE_UART_SERVICE_UUIDS.map((s) => ({ services: [s] })), optionalServices }
  );
  return new BleSerialPort(device);
}
