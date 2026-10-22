/**
 * WebUSB Serial Transport Adapter
 * Implements a drop-in SerialPort interface using native WebUSB API (navigator.usb)
 * Enables out-of-the-box USB-OTG serial communication on Android Chrome with ZERO flags!
 * Supports CDC-ACM, CP2102/CP2104, CH340, and FTDI chips.
 */

export const SUPPORTED_USB_DEVICES = [
  // CDC-ACM Standard USB Class
  { classCode: 0x02 },
  { classCode: 0x0a },
  // Silicon Labs CP210x
  { vendorId: 0x10c4 },
  // WCH CH340 / CH341
  { vendorId: 0x1a86 },
  // FTDI FT232 / FT2232
  { vendorId: 0x0403 },
  // Espressif Native USB
  { vendorId: 0x303a },
  // Raspberry Pi Pico (RP2040)
  { vendorId: 0x2e8a },
  // Arduino
  { vendorId: 0x2341 },
  // STMicroelectronics VCP
  { vendorId: 0x0483 },
  // Prolific PL2303
  { vendorId: 0x067b }
];

export class WebUsbSerialPort {
  constructor(usbDevice) {
    this.device = usbDevice;
    this.interfaceNumber = 0;
    this.inEndpoint = null;
    this.outEndpoint = null;
    this.isOpen = false;
    this.readLoopActive = false;
    this.readable = null;
    this.writable = null;
    this._readableController = null;
    this._signals = {
      clearToSend: true,
      dataSetReady: true,
      dataCarrierDetect: true,
      ringIndicator: false
    };
  }

  getInfo() {
    return {
      usbVendorId: this.device.vendorId,
      usbProductId: this.device.productId
    };
  }

  /**
   * Opens USB device and configures interface & endpoints
   */
  async open(options = {}) {
    const baudRate = options.baudRate || 115200;
    const dataBits = options.dataBits || 8;
    const stopBits = options.stopBits || 1;
    const parity = options.parity || 'none';

    await this.device.open();

    if (this.device.configuration === null) {
      await this.device.selectConfiguration(1);
    }

    // Locate endpoints & interface
    let foundInterface = false;
    for (const iface of this.device.configuration.interfaces) {
      for (const alt of iface.alternates) {
        // Look for bulk endpoints
        let inEp = null;
        let outEp = null;
        for (const ep of alt.endpoints) {
          if (ep.type === 'bulk') {
            if (ep.direction === 'in') inEp = ep;
            else if (ep.direction === 'out') outEp = ep;
          }
        }
        if (inEp && outEp) {
          this.interfaceNumber = iface.interfaceNumber;
          this.inEndpoint = inEp;
          this.outEndpoint = outEp;
          foundInterface = true;
          break;
        }
      }
      if (foundInterface) break;
    }

    if (!foundInterface) {
      // Fallback: claim interface 0
      this.interfaceNumber = 0;
    }

    try {
      await this.device.claimInterface(this.interfaceNumber);
    } catch (e) {
      console.warn('Could not claim interface, attempting to continue:', e);
    }

    // Configure Baud Rate based on Chip Vendor
    await this._configureLineCoding(baudRate, dataBits, stopBits, parity);

    this.isOpen = true;
    this.readLoopActive = true;

    // Create standard W3C ReadableStream
    this.readable = new ReadableStream({
      start: (controller) => {
        this._readableController = controller;
        this._startReadLoop();
      },
      cancel: () => {
        this.readLoopActive = false;
      }
    });

    // Create standard W3C WritableStream
    this.writable = new WritableStream({
      write: async (chunk) => {
        await this._writeChunk(chunk);
      }
    });

    return true;
  }

  /**
   * Configures line coding (Baud, parity, bits)
   */
  async _configureLineCoding(baudRate, dataBits = 8, stopBits = 1, parity = 'none') {
    const vid = this.device.vendorId;

    try {
      if (vid === 0x10c4) {
        // Silicon Labs CP210x
        // 1. Enable IFC
        await this.device.controlTransferOut({
          requestType: 'vendor',
          recipient: 'interface',
          request: 0x00, // IFC_ENABLE
          value: 0x01,
          index: this.interfaceNumber
        });
        // 2. Set Baud Rate
        const baudBuffer = new ArrayBuffer(4);
        new DataView(baudBuffer).setUint32(0, baudRate, true);
        await this.device.controlTransferOut({
          requestType: 'vendor',
          recipient: 'interface',
          request: 0x1e, // SET_BAUDRATE
          value: 0x00,
          index: this.interfaceNumber
        }, baudBuffer);
        // 3. Set 8N1 Line Control
        await this.device.controlTransferOut({
          requestType: 'vendor',
          recipient: 'interface',
          request: 0x03, // SET_LINE_CTL
          value: 0x0800, // 8 data bits, no parity, 1 stop bit
          index: this.interfaceNumber
        });
      } else if (vid === 0x0403) {
        // FTDI Chip (FT232R)
        let divisor = Math.floor(24000000 / (baudRate * 16));
        if (divisor === 0) divisor = 1;
        await this.device.controlTransferOut({
          requestType: 'vendor',
          recipient: 'device',
          request: 0x03, // SIO_SET_BAUD_RATE
          value: divisor,
          index: 0
        });
      } else {
        // Standard USB CDC-ACM (SET_LINE_CODING: Request 0x20)
        const lineCoding = new ArrayBuffer(7);
        const view = new DataView(lineCoding);
        view.setUint32(0, baudRate, true); // Baud
        view.setUint8(4, stopBits === 1 ? 0 : 2); // Stop bits (0: 1 stop bit)
        view.setUint8(5, parity === 'even' ? 2 : parity === 'odd' ? 1 : 0); // Parity
        view.setUint8(6, dataBits); // Data bits

        await this.device.controlTransferOut({
          requestType: 'class',
          recipient: 'interface',
          request: 0x20, // SET_LINE_CODING
          value: 0,
          index: this.interfaceNumber
        }, lineCoding);

        // Assert DTR & RTS
        await this.device.controlTransferOut({
          requestType: 'class',
          recipient: 'interface',
          request: 0x22, // SET_CONTROL_LINE_STATE
          value: 0x03, // DTR=1, RTS=1
          index: this.interfaceNumber
        });
      }
    } catch (err) {
      console.warn('Vendor line coding warning (device may use default baud):', err);
    }
  }

  /**
   * Internal bulk read loop
   */
  async _startReadLoop() {
    const epNum = this.inEndpoint ? this.inEndpoint.endpointNumber : 1;
    const packetSize = (this.inEndpoint && this.inEndpoint.packetSize) || 64;

    while (this.readLoopActive && this.device.opened) {
      try {
        const result = await this.device.transferIn(epNum, packetSize * 4);
        if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
          const uint8 = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);

          // FTDI chips include 2 status bytes at the beginning of each packet
          let payload = uint8;
          if (this.device.vendorId === 0x0403 && uint8.length >= 2) {
            payload = uint8.subarray(2);
          }

          if (payload.length > 0 && this._readableController) {
            this._readableController.enqueue(payload);
          }
        }
      } catch (err) {
        if (!this.readLoopActive) break;
        // Pause briefly before retrying transfer
        await new Promise(r => setTimeout(r, 20));
      }
    }
  }

  /**
   * Writes byte chunk to USB bulk OUT endpoint
   */
  async _writeChunk(data) {
    if (!this.device.opened) return;
    const epNum = this.outEndpoint ? this.outEndpoint.endpointNumber : 2;
    await this.device.transferOut(epNum, data);
  }

  /**
   * Control hardware lines (DTR, RTS, Break)
   */
  async setSignals(signals = {}) {
    const dtr = signals.dataTerminalReady !== undefined ? signals.dataTerminalReady : true;
    const rts = signals.requestToSend !== undefined ? signals.requestToSend : true;
    const isBreak = !!signals.break;

    const vid = this.device.vendorId;
    try {
      if (vid === 0x10c4) {
        // CP210x SET_MHS (0x07)
        // Control mask: bit 8 DTR, bit 9 RTS. Value: bit 0 DTR, bit 1 RTS
        let mask = 0x0300;
        let val = (dtr ? 0x01 : 0) | (rts ? 0x02 : 0);
        await this.device.controlTransferOut({
          requestType: 'vendor',
          recipient: 'interface',
          request: 0x07, // SET_MHS
          value: mask | val,
          index: this.interfaceNumber
        });
      } else {
        // Standard CDC-ACM SET_CONTROL_LINE_STATE
        const val = (dtr ? 0x01 : 0) | (rts ? 0x02 : 0);
        await this.device.controlTransferOut({
          requestType: 'class',
          recipient: 'interface',
          request: 0x22,
          value: val,
          index: this.interfaceNumber
        });
      }
    } catch (e) {
      console.warn('Set signals warning:', e);
    }
  }

  async getSignals() {
    return this._signals;
  }

  async close() {
    this.readLoopActive = false;
    this.isOpen = false;
    if (this._readableController) {
      try { this._readableController.close(); } catch (e) {}
    }
    try {
      await this.device.releaseInterface(this.interfaceNumber);
    } catch (e) {}
    try {
      await this.device.close();
    } catch (e) {}
  }
}

/**
 * Requests and pairs a USB-Serial device via WebUSB
 * @returns {Promise<WebUsbSerialPort>}
 */
export async function requestWebUsbSerialPort() {
  if (!navigator.usb) {
    throw new Error('WebUSB API is not supported in this browser.');
  }

  const usbDevice = await navigator.usb.requestDevice({
    filters: SUPPORTED_USB_DEVICES
  });

  return new WebUsbSerialPort(usbDevice);
}
