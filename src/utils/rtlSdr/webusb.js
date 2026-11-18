/**
 * webusb.js — WebUSB transport for RTL-SDR (RTL2832U) dongles.
 *
 * Only this file touches navigator.usb; every call is made from a user gesture
 * (requestDevice) or from the receiver loop. On Windows the device needs the
 * WinUSB driver (Zadig) before Chrome can claim it; see the wiki article.
 */

/** Known RTL2832U dongle USB IDs (Realtek VID 0x0BDA). */
export const RTL_SDR_USB_FILTERS = Object.freeze([
  { vendorId: 0x0bda, productId: 0x2838 },   // RTL2832U default (RTL-SDR, most dongles)
  { vendorId: 0x0bda, productId: 0x2832 },   // RTL2832U alternate
]);

/** Bulk IN endpoint 0x81 = endpoint number 1 for WebUSB transferIn. */
export const RTL_BULK_ENDPOINT_NUMBER = 1;
/** Bytes per bulk read (librtlsdr DEFAULT_BUF_LENGTH). */
export const RTL_BULK_LENGTH = 262144;

export function isWebUsbAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.usb;
}

const toBytes = (dv) => new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);

export class RtlSdrWebUsb {
  constructor(device) {
    this.device = device;
  }

  /** Ask the user to pick an RTL-SDR (must be called from a click handler). */
  static async requestDevice() {
    if (!isWebUsbAvailable()) throw new Error('WebUSB is not available in this browser (use Chrome, Edge or Opera on a secure origin).');
    const device = await navigator.usb.requestDevice({ filters: RTL_SDR_USB_FILTERS });
    return new RtlSdrWebUsb(device);
  }

  get productName() {
    return this.device?.productName || 'RTL2832U';
  }

  async open() {
    await this.device.open();
    if (this.device.configuration === null) await this.device.selectConfiguration(1);
    await this.device.claimInterface(0);
  }

  async ctrlOut(value, index, bytes) {
    const res = await this.device.controlTransferOut(
      { requestType: 'vendor', recipient: 'device', request: 0, value, index },
      bytes
    );
    if (res.status !== 'ok') throw new Error(`USB control write failed (${res.status})`);
  }

  async ctrlIn(value, index, len) {
    const res = await this.device.controlTransferIn(
      { requestType: 'vendor', recipient: 'device', request: 0, value, index },
      len
    );
    if (res.status !== 'ok' || !res.data) throw new Error(`USB control read failed (${res.status})`);
    return toBytes(res.data);
  }

  /** One bulk read from endpoint 0x81. Returns null when the endpoint stalled and was cleared. */
  async bulkRead(len = RTL_BULK_LENGTH) {
    const res = await this.device.transferIn(RTL_BULK_ENDPOINT_NUMBER, len);
    if (res.status === 'stall') {
      await this.device.clearHalt('in', RTL_BULK_ENDPOINT_NUMBER);
      return null;
    }
    if (res.status !== 'ok' || !res.data) throw new Error(`USB bulk read failed (${res.status})`);
    return toBytes(res.data);
  }

  async close() {
    try { await this.device.close(); } catch { /* already gone */ }
  }
}
