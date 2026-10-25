import { globalAdsbDecoder } from './adsbDecoder.js';

/**
 * PortaPack Mayhem driver.
 *
 * Two real transports, no simulation:
 *   1. Serial "USB Serial Console" (the ChibiOS shell the Mayhem firmware exposes
 *      in normal mode, prompt `ch>`). Used for the live screen mirror, button /
 *      touch / keyboard injection, device info, and tuning. This is the same
 *      interface hackrf.app and "mayhem mobile" drive.
 *   2. WebUSB libhackrf (when the PortaPack is switched to HackRF mode) for raw
 *      IQ — used here to decode real ADS-B.
 *
 * Mayhem serial console reference:
 *   - screenframeshort: 1 char per pixel, char = value + 32, value packs 6-bit
 *     color as 00RRGGBB (2 bits/channel). Black = 32 (space), white = 95 ('_').
 *     One text line per screen row, so width = chars/line and height = line count.
 *   - button N: 1=Right 2=Left 3=Down 4=Up 5=Select 6=DFU 7=RotaryLeft 8=RotaryRight.
 *   - touch <x> <y>, keyboard <hexpairs>, info, sysinfo, radioinfo, systime,
 *     setfreq <Hz>, applist, appstart <name>, reboot, dfu.
 */

export const MAYHEM_USB_IDS = {
  MAYHEM_SERIAL: { vid: '1d50', pid: '6018', name: 'PortaPack Mayhem USB Serial Console (normal mode)' },
  HACKRF_RUNTIME: { vid: '1d50', pid: '6089', name: 'Great Scott Gadgets HackRF One / PortaPack (HackRF mode)' },
  LPC43XX_DFU: { vid: '1fc9', pid: '000c', name: 'NXP LPC43xx DFU Bootloader (HackRF SPI Flashing)' }
};

// Mayhem physical buttons as exposed by the `button N` console command.
export const MAYHEM_BUTTONS = {
  right: 1,
  left: 2,
  down: 3,
  up: 4,
  select: 5,
  dfu: 6,
  rotaryLeft: 7,
  rotaryRight: 8
};

export const FREQMAN_PRESETS = [
  { id: 'ism-433', freq: 433920000, mod: 'NFM', label: 'ISM 433.920 MHz (Keyfobs & Weather)', bw: 12500, category: 'ISM' },
  { id: 'ism-868', freq: 868300000, mod: 'NFM', label: 'ISM 868.300 MHz (EU LoRa / Smart Meters)', bw: 25000, category: 'ISM' },
  { id: 'ism-915', freq: 915000000, mod: 'NFM', label: 'ISM 915.000 MHz (US LoRa / Utility Meters)', bw: 25000, category: 'ISM' },
  { id: 'adsb-1090', freq: 1090000000, mod: 'SPEC', label: 'ADS-B 1090 MHz (Aircraft Mode-S)', bw: 2000000, category: 'Aviation' },
  { id: 'air-guard', freq: 121500000, mod: 'AM', label: 'VHF Air Guard 121.500 MHz (Emergency)', bw: 25000, category: 'Aviation' },
  { id: 'noaa-wx1', freq: 162400000, mod: 'NFM', label: 'NOAA Weather Radio 162.400 MHz (WX1)', bw: 16000, category: 'Weather' },
  { id: 'marine-16', freq: 156800000, mod: 'NFM', label: 'Marine VHF Ch 16 (156.800 MHz Distress)', bw: 25000, category: 'Marine' },
  { id: 'aprs-2m', freq: 144390000, mod: 'NFM', label: 'APRS 144.390 MHz (Ham Radio Packet)', bw: 12500, category: 'Ham Radio' },
  { id: 'iss-downlink', freq: 145800000, mod: 'NFM', label: 'ISS Downlink 145.800 MHz (Voice / SSTV)', bw: 12500, category: 'Satellite' },
  { id: 'cb-19', freq: 27185000, mod: 'AM', label: 'CB Radio Channel 19 Highway (27.185 MHz)', bw: 10000, category: 'HF/CB' },
  { id: 'subghz-315', freq: 315000000, mod: 'ASK', label: 'Car TPMS & Gate 315.000 MHz (US/Asia)', bw: 50000, category: 'Automotive' }
];

export class MayhemPortaPackDriver {
  constructor() {
    this.isConnected = false;
    this.connectionType = null; // 'serial' | 'webusb'
    this.port = null;
    this.usbDevice = null;
    this.reader = null;
    this.writer = null;

    // Radio state (read back from the device, never invented)
    this.frequency = null;
    this.firmwareVersion = null;
    this.boardId = null;

    // Serial console read-loop state
    this.rxBuffer = '';          // rolling text buffer for async lines
    this.consoleWaiter = null;   // { buffer, resolve, prompt }

    // Last decoded screen frame { width, height, rgba }
    this.lastFrame = null;

    this.logs = [];
    this.onLogCallback = null;
    this.onStateChangeCallback = null;
  }

  log(msg, type = 'info') {
    const entry = { time: new Date().toLocaleTimeString(), text: msg, type };
    this.logs.push(entry);
    if (this.logs.length > 200) this.logs.shift();
    if (this.onLogCallback) this.onLogCallback(entry);
  }

  notifyState() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({
        isConnected: this.isConnected,
        connectionType: this.connectionType,
        frequency: this.frequency,
        firmwareVersion: this.firmwareVersion,
        boardId: this.boardId
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Serial USB Serial Console (the real Mayhem shell)
  // ---------------------------------------------------------------------------

  async connectSerial(options = {}) {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser. Use Chrome, Edge, or Opera.');
    }
    const baudRate = options.baudRate || 115200;
    const forceNoFilter = options.noFilter === true;

    this.port = forceNoFilter
      ? await navigator.serial.requestPort()
      : await navigator.serial.requestPort({
          filters: [
            { usbVendorId: 0x1d50, usbProductId: 0x6018 }, // Mayhem serial console
            { usbVendorId: 0x1d50 }
          ]
        });

    await this.port.open({ baudRate });
    this.isConnected = true;
    this.connectionType = 'serial';

    const info = this.port.getInfo ? this.port.getInfo() : {};
    const vidHex = info.usbVendorId ? '0x' + info.usbVendorId.toString(16).toUpperCase() : '0x1D50';
    const pidHex = info.usbProductId ? '0x' + info.usbProductId.toString(16).toUpperCase() : '0x6018';
    this.log(`PortaPack serial console connected (${vidHex}:${pidHex} @ ${baudRate} baud).`, 'success');
    this.log('Keep the PortaPack in NORMAL mode (not the blue HackRF screen) for the console to respond.', 'info');

    this.startReading();

    // Pull real identity; failures are logged but non-fatal.
    try { await this.refreshInfo(); } catch (e) { this.log(`info query failed: ${e.message}`, 'warning'); }

    this.notifyState();
    return true;
  }

  async startReading() {
    if (!this.port || !this.port.readable) return;
    const textDecoder = new TextDecoderStream();
    this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.reader = textDecoder.readable.getReader();

    try {
      while (this.isConnected && this.connectionType === 'serial') {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;

        // Feed an in-flight console command, if any.
        if (this.consoleWaiter) {
          this.consoleWaiter.buffer += value;
          if (this.consoleWaiter.buffer.includes(this.consoleWaiter.prompt)) {
            const w = this.consoleWaiter;
            this.consoleWaiter = null;
            clearTimeout(w.timer);
            w.resolve(w.buffer);
          }
          continue;
        }

        // Otherwise treat as async output (e.g. ADS-B stream) and log lines.
        this.rxBuffer += value;
        let nl;
        while ((nl = this.rxBuffer.indexOf('\n')) >= 0) {
          const line = this.rxBuffer.slice(0, nl).replace(/\r$/, '');
          this.rxBuffer = this.rxBuffer.slice(nl + 1);
          if (line && line !== 'ch>') {
            globalAdsbDecoder.processLine(line);
          }
        }
      }
    } catch (err) {
      if (this.isConnected) this.log(`Serial read loop ended: ${err.message}`, 'error');
    }
  }

  /**
   * Send a console command and read until the `ch>` prompt returns.
   * Returns the raw response text (echo + output), with echo/prompt trimmed.
   */
  async sendConsoleCommand(cmd, { timeoutMs = 4000 } = {}) {
    if (this.connectionType !== 'serial' || !this.port || !this.port.writable) {
      throw new Error('Serial console not connected');
    }
    if (this.consoleWaiter) {
      throw new Error('A console command is already in flight');
    }

    const response = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.consoleWaiter && this.consoleWaiter.timer === timer) {
          const partial = this.consoleWaiter.buffer;
          this.consoleWaiter = null;
          resolve(partial); // resolve with whatever arrived; caller validates
        }
      }, timeoutMs);
      this.consoleWaiter = { buffer: '', resolve, prompt: 'ch>', timer };

      const writer = this.port.writable.getWriter();
      writer.write(new TextEncoder().encode(cmd + '\r\n'))
        .catch(reject)
        .finally(() => writer.releaseLock());
    });

    // Strip the echoed command line and trailing prompt.
    let out = response;
    const firstNl = out.indexOf('\n');
    if (firstNl >= 0 && out.slice(0, firstNl).trim().startsWith(cmd.split(' ')[0])) {
      out = out.slice(firstNl + 1);
    }
    out = out.replace(/\r?\n?ch>\s*$/, '');
    return out;
  }

  async refreshInfo() {
    const info = await this.sendConsoleCommand('info');
    this.firmwareVersion = (info.match(/Mayhem[^\r\n]*/) || [null])[0] || info.trim().split(/\r?\n/)[0] || 'Mayhem';
    this.log(`Device info: ${this.firmwareVersion}`, 'info');
    this.notifyState();
    return info;
  }

  async getSysInfo() { return this.sendConsoleCommand('sysinfo'); }
  async getRadioInfo() { return this.sendConsoleCommand('radioinfo'); }
  async getSysTime() { return this.sendConsoleCommand('systime'); }
  async listApps() { return this.sendConsoleCommand('applist'); }

  async startApp(shortName) {
    const r = await this.sendConsoleCommand(`appstart ${shortName}`);
    this.log(`appstart ${shortName}`, 'sent');
    return r;
  }

  async setFrequency(hz) {
    const r = await this.sendConsoleCommand(`setfreq ${Math.round(hz)}`);
    this.frequency = Math.round(hz);
    this.log(`setfreq ${this.frequency} Hz`, 'sent');
    this.notifyState();
    return r;
  }

  async pressButton(n) {
    if (n < 1 || n > 8) throw new Error('button must be 1..8');
    await this.sendConsoleCommand(`button ${n}`, { timeoutMs: 1500 });
  }

  async press(name) {
    const n = MAYHEM_BUTTONS[name];
    if (!n) throw new Error(`unknown button: ${name}`);
    return this.pressButton(n);
  }

  async sendTouch(x, y) {
    await this.sendConsoleCommand(`touch ${Math.round(x)} ${Math.round(y)}`, { timeoutMs: 1500 });
  }

  async sendKeyboard(text) {
    const hex = Array.from(new TextEncoder().encode(text))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    await this.sendConsoleCommand(`keyboard ${hex}`);
  }

  async reboot() { try { await this.sendConsoleCommand('reboot', { timeoutMs: 1000 }); } catch (_) {} }
  async enterDfu() { try { await this.sendConsoleCommand('dfu', { timeoutMs: 1000 }); } catch (_) {} }

  /**
   * Capture the live LCD via `screenframeshort` and decode it to RGBA.
   * Dimensions are inferred from the response (width = chars/line, height = lines),
   * so it self-adapts to whatever the firmware emits.
   * @returns {{ width:number, height:number, rgba:Uint8ClampedArray } | null}
   */
  async captureScreen() {
    const raw = await this.sendConsoleCommand('screenframeshort', { timeoutMs: 6000 });
    const lines = raw.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.length > 0 && l !== 'ch>');
    if (lines.length === 0) return null;

    // Width = the dominant line length (screen rows are equal length; drop stragglers).
    const widths = {};
    for (const l of lines) widths[l.length] = (widths[l.length] || 0) + 1;
    const width = parseInt(Object.keys(widths).sort((a, b) => widths[b] - widths[a])[0], 10);
    const rows = lines.filter(l => l.length === width);
    const height = rows.length;
    if (!width || !height) return null;

    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = rows[y];
      for (let x = 0; x < width; x++) {
        const v = row.charCodeAt(x) - 32;          // 6-bit 00RRGGBB
        const r = ((v >> 4) & 0x03) * 85;           // 2 bits -> 0,85,170,255
        const g = ((v >> 2) & 0x03) * 85;
        const b = (v & 0x03) * 85;
        const i = (y * width + x) * 4;
        rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
      }
    }
    this.lastFrame = { width, height, rgba };
    return this.lastFrame;
  }

  // ---------------------------------------------------------------------------
  // WebUSB libhackrf path (real IQ, for ADS-B) — used only when the PortaPack is
  // switched to HackRF mode. Left intact; not simulated.
  // ---------------------------------------------------------------------------

  async connectWebUsb() {
    if (!('usb' in navigator)) {
      throw new Error('WebUSB is not supported in this browser. Use Chrome or Edge.');
    }
    this.usbDevice = await navigator.usb.requestDevice({
      filters: [
        { vendorId: 0x1d50, productId: 0x6089 }, // HackRF One / r9 / Pro
        { vendorId: 0x1d50, productId: 0x604b }, // Jawbreaker
        { vendorId: 0x1d50, productId: 0xcc15 }, // rad1o
        { vendorId: 0x1d50 },
        { vendorId: 0x1fc9, productId: 0x000c }  // LPC43xx DFU
      ]
    });

    await this.usbDevice.open();
    if (this.usbDevice.configuration === null) await this.usbDevice.selectConfiguration(1);
    try { await this.usbDevice.claimInterface(0); } catch (_) {}

    this.isConnected = true;
    this.connectionType = 'webusb';

    const pName = this.usbDevice.productName || 'HackRF One';
    const vid = '0x' + this.usbDevice.vendorId.toString(16).toUpperCase();
    const pid = '0x' + this.usbDevice.productId.toString(16).toUpperCase();
    this.log(`Connected to ${pName} via WebUSB (${vid}:${pid}) — libhackrf.`, 'success');

    try {
      await this.usbDevice.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 29, value: 0, index: 0 });
    } catch (_) {}
    try {
      const verRes = await this.usbDevice.controlTransferIn({ requestType: 'vendor', recipient: 'device', request: 15, value: 0, index: 0 }, 64);
      if (verRes && verRes.data) {
        const verStr = new TextDecoder().decode(verRes.data).replace(/\0/g, '').trim();
        if (verStr) { this.firmwareVersion = verStr; this.log(`HackRF Firmware: ${verStr}`, 'success'); }
      }
    } catch (_) {}
    try {
      const bRes = await this.usbDevice.controlTransferIn({ requestType: 'vendor', recipient: 'device', request: 14, value: 0, index: 0 }, 1);
      if (bRes && bRes.data) {
        const bId = bRes.data.getUint8(0);
        const boardNames = ['Jellybean', 'Jawbreaker', 'HackRF One', 'rad1o', 'HackRF One r9', 'HackRF Pro'];
        this.boardId = boardNames[bId] || `HackRF Board ID ${bId}`;
        this.log(`Board ID: ${bId} (${this.boardId})`, 'info');
      }
    } catch (_) {}

    try {
      const rateBuf = new ArrayBuffer(8);
      const rateView = new DataView(rateBuf);
      rateView.setUint32(0, 2000000, true);
      rateView.setUint32(4, 1, true);
      await this.usbDevice.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 6, value: 0, index: 0 }, rateBuf);
      const bw = 1750000;
      await this.usbDevice.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 7, value: bw & 0xFFFF, index: (bw >> 16) & 0xFFFF });
    } catch (_) {}

    await this.setWebUsbFreq(this.frequency || 1090000000);
    try { await this.usbDevice.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 1, value: 1, index: 0 }); this.startWebUsbBulkReading(); } catch (_) {}

    this.notifyState();
    return true;
  }

  async startWebUsbBulkReading() {
    this.log('[HackRF WebUSB] IQ receiver stream active on bulk endpoint 1.', 'info');
    while (this.isConnected && this.connectionType === 'webusb') {
      try {
        if (!this.usbDevice || !this.usbDevice.opened) break;
        const result = await this.usbDevice.transferIn(1, 16384);
        if (result && result.data && result.data.buffer) {
          if (Math.abs((this.frequency || 0) - 1090000000) < 6000000) {
            globalAdsbDecoder.processRawIq(result.data.buffer);
          }
        }
      } catch (err) {
        if (!this.isConnected) break;
        await new Promise(r => setTimeout(r, 60));
      }
    }
  }

  async setWebUsbFreq(hz) {
    if (!this.usbDevice || !this.usbDevice.opened) return;
    try {
      const freqMhz = Math.floor(hz / 1000000);
      const freqHz = hz % 1000000;
      const buf = new ArrayBuffer(8);
      const view = new DataView(buf);
      view.setUint32(0, freqMhz, true);
      view.setUint32(4, freqHz, true);
      await this.usbDevice.controlTransferOut({ requestType: 'vendor', recipient: 'device', request: 16, value: 0, index: 0 }, buf);
      this.frequency = hz;
      this.notifyState();
    } catch (err) {
      this.log(`Failed to tune via WebUSB: ${err.message}`, 'error');
    }
  }

  // ---------------------------------------------------------------------------

  async disconnect() {
    this.isConnected = false;
    const wasType = this.connectionType;
    this.connectionType = null;
    if (this.consoleWaiter) { try { clearTimeout(this.consoleWaiter.timer); } catch (_) {} this.consoleWaiter = null; }
    if (this.reader) { try { await this.reader.cancel(); } catch (_) {} this.reader = null; }
    if (this.port) { try { await this.port.close(); } catch (_) {} this.port = null; }
    if (this.usbDevice) { try { await this.usbDevice.close(); } catch (_) {} this.usbDevice = null; }
    this.log(`Disconnected (${wasType || 'none'}).`, 'info');
    this.notifyState();
  }

  // Frequency Manager helpers (local list management; unchanged behavior)
  exportFreqmanTxt(list) {
    let out = '# PortaPack Mayhem Frequency Manager File\n';
    out += '# Format: f=Hz,a=Modulation,d=Description,bw=Bandwidth\n';
    for (const item of (list || FREQMAN_PRESETS)) {
      out += `f=${item.freq},a=${item.mod},d=${item.label},bw=${item.bw}\n`;
    }
    return out;
  }
}
