/**
 * Browser I/O for the USB power meter tool. Protocol logic is in ../usbPowerMeter.js.
 * Nothing here runs at import time; every API is checked when a user clicks Connect.
 */

import { SerialLink } from '../serialLink';
import {
  RUIDENG_BAUD,
  RUIDENG_REQUEST,
  RUIDENG_FRAME_LEN,
  FNIRSI_DEVICES,
  parseRuiDengDump,
  fnirsiCommand,
  decodeFnirsiPacket,
  fnirsiSamples,
} from '../usbPowerMeter';

export const RUIDENG_POLL_MS = 1000;
export const FNIRSI_POLL_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// RuiDeng over Web Serial (Bluetooth SPP appears as a COM port)
// ---------------------------------------------------------------------------

export function webSerialAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.serial;
}

/** Ask the user for the meter's serial port (must run from a click) and open it at 9600 baud. */
export async function connectRuiDengPort() {
  if (!webSerialAvailable()) throw new Error('Web Serial needs Chrome or Edge over HTTPS.');
  return SerialLink.request(
    { name: 'USB Power Meter (RuiDeng)' },
    { baudRate: RUIDENG_BAUD, dataBits: 8, stopBits: 1, parity: 'none' },
  );
}

/**
 * Polls the meter: send 0xF0, read the 130-byte dump, hand it to onDump.
 * Stale bytes are drained before each request so the dump stays aligned.
 */
export class RuiDengPoller {
  constructor(link, { onDump, onError, pollMs = RUIDENG_POLL_MS } = {}) {
    this.link = link;
    this.onDump = onDump || (() => {});
    this.onError = onError || (() => {});
    this.pollMs = pollMs;
    this.running = false;
    this.loop = null;
  }

  start() {
    this.running = true;
    this.loop = this._run();
    return this;
  }

  async _run() {
    while (this.running) {
      const t0 = Date.now();
      try {
        await this.link.drain(40);
        await this.link.write(Uint8Array.of(RUIDENG_REQUEST));
        const bytes = await this.link.read(RUIDENG_FRAME_LEN, 1500, 'a RuiDeng 130-byte dump');
        if (!this.running) break;
        const dump = parseRuiDengDump(bytes);
        this.onDump(dump, Date.now());
      } catch (e) {
        if (!this.running) break;
        this.onError(e);
      }
      const wait = this.pollMs - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
    }
  }

  async stop() {
    this.running = false;
    try { await this.loop; } catch (e) { /* loop reports its own errors */ }
  }
}

// ---------------------------------------------------------------------------
// FNIRSI over WebHID
// ---------------------------------------------------------------------------

export function webHidAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.hid;
}

/** Ask the user to pick a FNIRSI meter (must run from a click). Returns the device or null. */
export async function requestFnirsiDevice() {
  if (!webHidAvailable()) throw new Error('WebHID needs Chrome or Edge over HTTPS.');
  const filters = FNIRSI_DEVICES.map((d) => ({ vendorId: d.vendorId, productId: d.productId }));
  const devices = await navigator.hid.requestDevice({ filters });
  return devices[0] || null;
}

/** Which FNIRSI model a HID device is, from its vendor and product IDs. */
export function fnirsiModelFor(device) {
  return FNIRSI_DEVICES.find((d) => d.vendorId === device.vendorId && d.productId === device.productId) || null;
}

/**
 * Streams samples from a FNIRSI meter: opens the device, sends the model's init
 * commands, polls with 0xAA 0x83 once a second, and decodes every input report.
 */
export class FnirsiStream {
  constructor(device, model, { onSamples, onStats, onError, pollMs = FNIRSI_POLL_MS } = {}) {
    this.device = device;
    this.model = model;
    this.onSamples = onSamples || (() => {});
    this.onStats = onStats || (() => {});
    this.onError = onError || (() => {});
    this.pollMs = pollMs;
    this.packets = 0;
    this.rejected = 0;
    this.pollTimer = null;
    this.handler = null;
  }

  async start() {
    if (!this.device.opened) await this.device.open();
    this.handler = (ev) => this._onReport(ev);
    this.device.addEventListener('inputreport', this.handler);
    for (const cmd of this.model.init) {
      await this.send(cmd);
      await sleep(50);
    }
    this.pollTimer = setInterval(() => {
      this.send(0x83).catch((e) => this.onError(e));
    }, this.pollMs);
    return this;
  }

  send(cmd) {
    return this.device.sendReport(0, fnirsiCommand(cmd));
  }

  _onReport(ev) {
    const view = ev.data;
    const raw = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    const packet = raw.length >= 64 ? raw.subarray(0, 64) : raw;
    const result = decodeFnirsiPacket(packet);
    if (!result.ok) {
      if (result.reason === 'crc') this.rejected++;
      this.onStats({ packets: this.packets, rejected: this.rejected });
      return;
    }
    this.packets++;
    this.onSamples(fnirsiSamples(result.samples, Date.now()));
    this.onStats({ packets: this.packets, rejected: this.rejected });
  }

  async stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.handler) this.device.removeEventListener('inputreport', this.handler);
    this.handler = null;
    try { if (this.device.opened) await this.device.close(); } catch (e) { /* already gone */ }
  }
}
