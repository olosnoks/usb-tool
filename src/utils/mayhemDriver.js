import { globalAdsbDecoder } from './adsbDecoder.js';
import { powerSpectrumFromIQ } from './fft.js';

export const MAYHEM_USB_IDS = {
  HACKRF_RUNTIME: { vid: '1d50', pid: '6089', name: 'Great Scott Gadgets HackRF One / PortaPack Mayhem' },
  LPC43XX_DFU: { vid: '1fc9', pid: '000c', name: 'NXP LPC43xx DFU Bootloader (HackRF SPI Flashing)' }
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

export const MAYHEM_APPS = [
  { id: 'menu', name: 'Main Menu', category: 'System', icon: 'Grid' },
  { id: 'audio_rx', name: 'Audio Receiver (AM/NFM/WFM)', category: 'Receiver', icon: 'Headphones' },
  { id: 'adsb', name: 'ADS-B Aircraft Radar', category: 'Receiver', icon: 'Plane' },
  { id: 'ais', name: 'AIS Marine Vessel Tracker', category: 'Receiver', icon: 'Ship' },
  { id: 'pocsag', name: 'POCSAG Pager Decoder', category: 'Receiver', icon: 'MessageSquare' },
  { id: 'capture', name: 'Raw C16 IQ Capture', category: 'Capture', icon: 'Disc' },
  { id: 'replay', name: 'C16 IQ Replay', category: 'Transmitter', icon: 'Play' },
  { id: 'subghz_rx', name: 'Sub-GHz Sniffer', category: 'Receiver', icon: 'Radio' },
  { id: 'subghz_tx', name: 'Sub-GHz Transmitter', category: 'Transmitter', icon: 'Send' },
  { id: 'signal_gen', name: 'RF Signal Generator', category: 'Transmitter', icon: 'Zap' },
  { id: 'freqman', name: 'Frequency Manager', category: 'Tools', icon: 'Book' },
  { id: 'antenna', name: 'Antenna Length Calc', category: 'Tools', icon: 'Ruler' }
];

export class MayhemPortaPackDriver {
  constructor() {
    this.isConnected = false;
    this.isDemo = true;
    this.connectionType = 'demo'; // 'demo', 'serial', 'webusb'
    this.port = null;
    this.usbDevice = null;
    this.reader = null;
    this.writer = null;

    // Radio State
    this.frequency = 433920000; // 433.92 MHz
    this.amp = 0; // 0 or 14 dB
    this.lnaGain = 16; // 0 - 40 dB in 8dB steps
    this.vgaGain = 20; // 0 - 62 dB in 2dB steps
    this.sampleRate = 2000000; // 2 MSPS
    this.activeApp = 'menu';
    this.selectedMenuIndex = 0;
    this.firmwareVersion = 'Mayhem v2.0.0 (Nightly-Git)';
    this.boardId = 'HackRF One (rev. r9)';
    this.cpldVersion = 'CPLD v1.0.0';
    this.batteryMv = 4050; // 4.05V (~90%)
    this.sdCardMounted = true;
    this.sdCardFreeGb = '14.2 GB / 16 GB';

    // Virtual Screen Buffer (320x240 RGB565)
    this.width = 320;
    this.height = 240;
    this.canvas = null;
    this.ctx = null;
    this.animFrame = null;
    this.rssi = -85; // dBm

    // Frequency Manager Table
    this.freqList = [...FREQMAN_PRESETS];

    // Logs & Terminal History
    this.logs = [];
    this.onLogCallback = null;
    this.onStateChangeCallback = null;

    // Live FFT spectrum from the real HackRF IQ stream (WebUSB mode)
    this.latestSpectrum = null;   // Float32Array of dBFS bins, DC centered
    this.latestLevelDbfs = -120;  // peak bin, dBFS
    this.spectrumFftSize = 256;
    this.onSpectrumCallback = null;
    this._lastSpectrumTs = 0;
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
        isDemo: this.isDemo,
        frequency: this.frequency,
        amp: this.amp,
        lnaGain: this.lnaGain,
        vgaGain: this.vgaGain,
        sampleRate: this.sampleRate,
        activeApp: this.activeApp,
        selectedMenuIndex: this.selectedMenuIndex,
        firmwareVersion: this.firmwareVersion,
        boardId: this.boardId,
        cpldVersion: this.cpldVersion,
        batteryMv: this.batteryMv,
        sdCardMounted: this.sdCardMounted,
        sdCardFreeGb: this.sdCardFreeGb,
        rssi: this.rssi
      });
    }
  }

  async connectDemo() {
    this.isConnected = true;
    this.isDemo = true;
    this.log('Connected to Virtual PortaPack Mayhem H2+ (Demo Mode)', 'success');
    this.log('Hardware: HackRF One (LPC4330 + MAX2837 + R820T2 + XC6SLX9 CPLD)', 'info');
    this.log(`Firmware: ${this.firmwareVersion}`, 'info');
    this.log(`SD Card: 16GB FAT32 Mounted, ${this.sdCardFreeGb} free`, 'info');
    this.notifyState();
    return true;
  }

  async connectHardware(options = {}) {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.');
    }

    const baudRate = options.baudRate || 115200;
    const forceNoFilter = options.noFilter === true;

    try {
      this.log(`Opening Web Serial selector (${forceNoFilter ? 'Showing All COM Ports' : 'Filtered for PortaPack VID 1D50'})...`, 'info');
      
      // If forceNoFilter is true, call requestPort() with NO arguments to guarantee all COM ports show
      this.port = forceNoFilter 
        ? await navigator.serial.requestPort()
        : await navigator.serial.requestPort({
            filters: [
              { usbVendorId: 0x1d50, usbProductId: 0x6018 },
              { usbVendorId: 0x1d50, usbProductId: 0x6089 },
              { usbVendorId: 0x1d50 }
            ]
          });

      await this.port.open({ baudRate });
      this.isConnected = true;
      this.isDemo = false;
      this.connectionType = 'serial';

      const info = this.port.getInfo ? this.port.getInfo() : {};
      const vidHex = info.usbVendorId ? '0x' + info.usbVendorId.toString(16).toUpperCase() : '1D50';
      const pidHex = info.usbProductId ? '0x' + info.usbProductId.toString(16).toUpperCase() : '6018';

      this.log(`PortaPack Hardware connected on serial port at ${baudRate} baud (${vidHex}:${pidHex}).`, 'success');
      this.sendCommand('version');

      this.startReading();
      this.notifyState();
      return true;
    } catch (err) {
      this.log(`Serial port connection cancelled or failed: ${err.message}`, 'error');
      throw err;
    }
  }

  async connectWebUsb() {
    if (!('usb' in navigator)) {
      throw new Error('WebUSB is not supported in this browser. Please use Chrome or Edge.');
    }

    try {
      this.log('Opening WebUSB device selector for HackRF One (WinUSB)...', 'info');
      this.usbDevice = await navigator.usb.requestDevice({
        filters: [
          { vendorId: 0x1d50, productId: 0x6089 }, // HackRF One / r9 / Pro (WinUSB)
          { vendorId: 0x1d50, productId: 0x604b }, // Jawbreaker
          { vendorId: 0x1d50, productId: 0xcc15 }, // rad1o
          { vendorId: 0x1d50, productId: 0x6018 }, // PortaPack Mayhem CDC serial
          { vendorId: 0x1d50 },                    // Any Great Scott Gadgets device
          { vendorId: 0x1fc9, productId: 0x000c }  // LPC43xx DFU bootloader
        ]
      });

      // RocketGod: Check if PortaPack is left in Mayhem Serial mode (0x6018)
      if (this.usbDevice.productId === 0x6018) {
        this.log("PortaPack detected in Mayhem Serial mode (0x6018). For direct HackRF DSP, switch PortaPack on-screen to 'HackRF' mode, or click 'Connect Web Serial'.", 'warning');
      }

      await this.usbDevice.open();
      if (this.usbDevice.configuration === null) {
        await this.usbDevice.selectConfiguration(1);
      }
      try {
        await this.usbDevice.claimInterface(0);
      } catch (e) {
        // Interface may be vendor-specific
      }

      this.isConnected = true;
      this.isDemo = false;
      this.connectionType = 'webusb';

      const pName = this.usbDevice.productName || 'HackRF One';
      const vid = '0x' + this.usbDevice.vendorId.toString(16).toUpperCase();
      const pid = '0x' + this.usbDevice.productId.toString(16).toUpperCase();
      this.log(`Connected to ${pName} via WebUSB (VID: ${vid}, PID: ${pid}) - libhackrf protocol.`, 'success');

      // 1. Clean slate (RocketGod bring-up pattern):
      // Turn off HW Sync (Request 29) to avoid waiting for external trigger
      try {
        await this.usbDevice.controlTransferOut({
          requestType: 'vendor',
          recipient: 'device',
          request: 29, // SET_HW_SYNC_MODE
          value: 0,
          index: 0
        });
      } catch (_) {}

      // 2. Query Firmware Version (Request 15 = VERSION_STRING_READ)
      try {
        const verRes = await this.usbDevice.controlTransferIn({
          requestType: 'vendor',
          recipient: 'device',
          request: 15,
          value: 0,
          index: 0
        }, 64);
        if (verRes && verRes.data) {
          const decoder = new TextDecoder();
          const verStr = decoder.decode(verRes.data).replace(/\0/g, '').trim();
          if (verStr) {
            this.firmwareVersion = verStr;
            this.log(`HackRF Firmware: ${verStr}`, 'success');
          }
        }
      } catch (_) {}

      // 3. Query Board ID (Request 14 = BOARD_ID_READ)
      try {
        const bRes = await this.usbDevice.controlTransferIn({
          requestType: 'vendor',
          recipient: 'device',
          request: 14,
          value: 0,
          index: 0
        }, 1);
        if (bRes && bRes.data) {
          const bId = bRes.data.getUint8(0);
          const boardNames = ['Jellybean', 'Jawbreaker', 'HackRF One', 'rad1o', 'HackRF One r9', 'HackRF Pro'];
          this.boardId = boardNames[bId] || `HackRF Board ID ${bId}`;
          this.log(`Board ID: ${bId} (${this.boardId})`, 'info');
        }
      } catch (_) {}

      // 4. Set Sample Rate (Request 6 = SAMPLE_RATE_SET) & Baseband Filter (Request 7)
      try {
        const rateBuf = new ArrayBuffer(8);
        const rateView = new DataView(rateBuf);
        rateView.setUint32(0, 2000000, true); // 2 MSPS
        rateView.setUint32(4, 1, true); // divider 1
        await this.usbDevice.controlTransferOut({
          requestType: 'vendor',
          recipient: 'device',
          request: 6,
          value: 0,
          index: 0
        }, rateBuf);

        // BASEBAND_FILTER_BW_SET (7): low 16 in value, high 16 in index
        const bw = 1750000;
        await this.usbDevice.controlTransferOut({
          requestType: 'vendor',
          recipient: 'device',
          request: 7,
          value: bw & 0xFFFF,
          index: (bw >> 16) & 0xFFFF
        });
      } catch (_) {}

      // 5. Apply current frequency, amp, and gains with RocketGod Pro cache-busting retune
      await this.setWebUsbFreq(this.frequency);
      await this.setWebUsbAmp(this.amp);
      await this.setWebUsbGains(this.lnaGain, this.vgaGain);

      // RocketGod cache-bust retune (+1 MHz then back)
      try {
        await this.setWebUsbFreq(this.frequency + 1000000);
        await this.setWebUsbFreq(this.frequency);
      } catch (_) {}

      // 6. Enter Receive Mode (Request 1 = SET_TRANSCEIVER_MODE, 1 = RECEIVE)
      try {
        await this.usbDevice.controlTransferOut({
          requestType: 'vendor',
          recipient: 'device',
          request: 1,
          value: 1, // MODE_RECEIVE
          index: 0
        });
        this.log('HackRF: RX transceiver mode engaged (streaming IQ)', 'success');
        this.startWebUsbBulkReading();
      } catch (_) {}

      this.notifyState();
      return true;
    } catch (err) {
      this.log(`WebUSB Connection Error: ${err.message}`, 'error');
      throw err;
    }
  }

  async startWebUsbBulkReading() {
    this.log('[HackRF WebUSB] Async IQ receiver stream active on bulk endpoint 1.', 'info');
    while (this.isConnected && this.connectionType === 'webusb') {
      try {
        if (!this.usbDevice || !this.usbDevice.opened) break;
        // HackRF bulk IN endpoint is endpoint 1
        const result = await this.usbDevice.transferIn(1, 16384);
        if (result && result.data && result.data.buffer) {
          // Real FFT spectrum from the IQ, throttled to ~25 fps.
          const now = performance.now();
          if (now - this._lastSpectrumTs >= 40 && result.data.byteLength >= this.spectrumFftSize * 2) {
            this._lastSpectrumTs = now;
            const spec = powerSpectrumFromIQ(result.data, this.spectrumFftSize);
            this.latestSpectrum = spec;
            let peak = -200;
            for (let i = 0; i < spec.length; i++) if (spec[i] > peak) peak = spec[i];
            this.latestLevelDbfs = peak;
            this.rssi = Math.round(peak); // real relative level (dBFS)
            if (this.onSpectrumCallback) {
              this.onSpectrumCallback(spec, peak, this.frequency, this.sampleRate);
            }
          }
          // If receiver is on or near 1090 MHz (ADS-B), decode real Mode-S packets!
          if (Math.abs(this.frequency - 1090000000) < 6000000) {
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

      await this.usbDevice.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: 16, // HACKRF_VENDOR_REQUEST_SET_FREQ
        value: 0,
        index: 0
      }, buf);
      this.frequency = hz;
      this.log(`[TUNER WebUSB] Synthesizer locked to ${(hz / 1000000).toFixed(4)} MHz`, 'success');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to tune frequency via WebUSB: ${err.message}`, 'error');
    }
  }

  async setWebUsbAmp(ampOn) {
    if (!this.usbDevice || !this.usbDevice.opened) return;
    try {
      await this.usbDevice.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: 17, // HACKRF_VENDOR_REQUEST_AMP_ENABLE
        value: ampOn > 0 ? 1 : 0,
        index: 0
      });
      this.amp = ampOn > 0 ? 14 : 0;
      this.log(`[RF WebUSB] RF Front-End Amp: ${this.amp > 0 ? '+14 dB (ENABLED)' : '0 dB (BYPASSED)'}`, 'info');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to set Amp via WebUSB: ${err.message}`, 'error');
    }
  }

  async setWebUsbGains(lna, vga) {
    if (!this.usbDevice || !this.usbDevice.opened) return;
    try {
      // SET_LNA_GAIN (19)
      await this.usbDevice.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: 19,
        value: 0,
        index: Math.min(40, Math.max(0, lna))
      });
      this.lnaGain = lna;

      // SET_VGA_GAIN (20)
      await this.usbDevice.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: 20,
        value: 0,
        index: Math.min(62, Math.max(0, vga))
      });
      this.vgaGain = vga;
      this.log(`[RF WebUSB] Gains set: LNA ${lna} dB | VGA ${vga} dB`, 'info');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to set gains via WebUSB: ${err.message}`, 'error');
    }
  }

  async startReading() {
    if (!this.port || !this.port.readable) return;
    const textDecoder = new TextDecoderStream();
    this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.reader = textDecoder.readable.getReader();

    try {
      while (this.isConnected) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          const lines = value.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed) {
              this.log(`[MAYHEM] ${trimmed}`, 'info');
              this.parseResponse(trimmed);
            }
          }
        }
      }
    } catch (err) {
      if (this.isConnected) {
        this.log(`Read loop terminated: ${err.message}`, 'error');
      }
    }
  }

  parseResponse(text) {
    // Process real ADS-B line if present from PortaPack serial stream
    globalAdsbDecoder.processLine(text);

    if (text.includes('Mayhem')) {
      this.firmwareVersion = text;
      this.notifyState();
    } else if (text.startsWith('freq:')) {
      const parts = text.split(':');
      if (parts[1]) {
        this.frequency = parseInt(parts[1], 10);
        this.notifyState();
      }
    }
  }

  async sendCommand(cmd) {
    this.log(`> ${cmd}`, 'sent');
    if (this.isDemo) {
      this.handleDemoCommand(cmd);
      return;
    }

    if (this.connectionType === 'webusb') {
      const parts = cmd.trim().split(' ');
      const action = parts[0].toLowerCase();
      if (action === 'freq' && parts[1]) {
        await this.setWebUsbFreq(parseInt(parts[1], 10));
      } else if (action === 'amp') {
        await this.setWebUsbAmp(parts[1] === '1' ? 14 : 0);
      } else if (action === 'lna' && parts[1]) {
        await this.setWebUsbGains(parseInt(parts[1], 10), this.vgaGain);
      } else if (action === 'vga' && parts[1]) {
        await this.setWebUsbGains(this.lnaGain, parseInt(parts[1], 10));
      } else if (action === 'version') {
        this.log(`[HACKRF WebUSB] Hardware: ${this.boardId} | Firmware: ${this.firmwareVersion}`, 'info');
      } else {
        this.log(`Command '${action}' acknowledged via WebUSB control pipe.`, 'info');
      }
      return;
    }

    if (!this.port || !this.port.writable) return;
    const encoder = new TextEncoder();
    const writer = this.port.writable.getWriter();
    await writer.write(encoder.encode(cmd + '\r\n'));
    writer.releaseLock();
  }

  handleDemoCommand(cmd) {
    const parts = cmd.trim().split(' ');
    const action = parts[0].toLowerCase();

    switch (action) {
      case 'version':
        this.log(`[PORTAPACK] ${this.firmwareVersion} | Board: ${this.boardId} | ${this.cpldVersion}`, 'info');
        break;
      case 'freq':
        if (parts[1]) {
          const f = parseInt(parts[1], 10);
          if (!isNaN(f) && f >= 1000000 && f <= 6000000000) {
            this.frequency = f;
            this.log(`[TUNER] Synthesizer locked: ${(f / 1000000).toFixed(4)} MHz`, 'success');
            this.notifyState();
          } else {
            this.log('Invalid frequency (Range: 1,000,000 Hz to 6,000,000,000 Hz)', 'warning');
          }
        }
        break;
      case 'amp':
        this.amp = parts[1] === '1' ? 14 : 0;
        this.log(`[RF] RF Amplifier: ${this.amp > 0 ? '+14 dB (ENABLED)' : '0 dB (BYPASSED)'}`, 'info');
        this.notifyState();
        break;
      case 'lna':
        if (parts[1]) {
          this.lnaGain = Math.min(40, Math.max(0, parseInt(parts[1], 10)));
          this.log(`[RF] LNA Gain: ${this.lnaGain} dB`, 'info');
          this.notifyState();
        }
        break;
      case 'vga':
        if (parts[1]) {
          this.vgaGain = Math.min(62, Math.max(0, parseInt(parts[1], 10)));
          this.log(`[RF] Baseband VGA Gain: ${this.vgaGain} dB`, 'info');
          this.notifyState();
        }
        break;
      case 'app':
        if (parts[1]) {
          this.activeApp = parts[1];
          this.log(`[UI] Launched PortaPack App: ${parts[1].toUpperCase()}`, 'info');
          this.notifyState();
        }
        break;
      case 'screenshot':
        this.log('[LCD] Framebuffer dumped: 320x240 RGB565 (153,600 bytes received)', 'success');
        break;
      case 'reboot':
        this.log('[SYS] Rebooting PortaPack Mayhem...', 'warning');
        setTimeout(() => {
          this.log('[SYS] Mayhem boot complete. Ready.', 'success');
        }, 1500);
        break;
      case 'dfu':
        this.log('[SYS] Entering NXP LPC43xx DFU bootloader mode (VID 1FC9, PID 000C)...', 'warning');
        break;
      default:
        this.log(`Unknown PortaPack command: ${cmd}`, 'warning');
    }
  }

  // Keypad & D-Pad Navigation Controls
  pressKey(key) {
    if (this.activeApp === 'menu') {
      const total = MAYHEM_APPS.length;
      if (key === 'up') {
        this.selectedMenuIndex = (this.selectedMenuIndex - 3 + total) % total;
      } else if (key === 'down') {
        this.selectedMenuIndex = (this.selectedMenuIndex + 3) % total;
      } else if (key === 'left') {
        this.selectedMenuIndex = (this.selectedMenuIndex - 1 + total) % total;
      } else if (key === 'right') {
        this.selectedMenuIndex = (this.selectedMenuIndex + 1) % total;
      } else if (key === 'select') {
        this.activeApp = MAYHEM_APPS[this.selectedMenuIndex].id;
        this.log(`Launched ${MAYHEM_APPS[this.selectedMenuIndex].name}`, 'info');
      }
    } else {
      if (key === 'back') {
        this.activeApp = 'menu';
        this.log('Returned to Mayhem Main Menu', 'info');
      } else if (key === 'step_up') {
        this.frequency += 25000; // +25 kHz
        this.log(`Tuned: ${(this.frequency / 1000000).toFixed(4)} MHz`, 'info');
      } else if (key === 'step_down') {
        this.frequency -= 25000; // -25 kHz
        this.log(`Tuned: ${(this.frequency / 1000000).toFixed(4)} MHz`, 'info');
      }
    }
    this.notifyState();
  }

  // Frequency Manager Helpers
  addFrequency(freq, mod, label, bw = 12500, category = 'Custom') {
    const item = {
      id: `custom-${Date.now()}`,
      freq,
      mod,
      label,
      bw,
      category
    };
    this.freqList.unshift(item);
    this.log(`Added ${(freq / 1000000).toFixed(4)} MHz (${label}) to FREQMAN`, 'success');
    return item;
  }

  deleteFrequency(id) {
    this.freqList = this.freqList.filter(f => f.id !== id);
    this.log('Entry removed from FREQMAN', 'info');
  }

  exportFreqmanTxt() {
    let out = '# PortaPack Mayhem Frequency Manager File\n';
    out += '# Format: f=Hz,a=Modulation,d=Description,bw=Bandwidth\n';
    for (const item of this.freqList) {
      out += `f=${item.freq},a=${item.mod},d=${item.label},bw=${item.bw}\n`;
    }
    return out;
  }

  async disconnect() {
    this.isConnected = false;
    this.connectionType = 'demo';
    if (this.usbDevice) {
      try { await this.usbDevice.close(); } catch (_) {}
      this.usbDevice = null;
    }
    if (this.reader) {
      try { await this.reader.cancel(); } catch (_) {}
    }
    if (this.port) {
      try { await this.port.close(); } catch (_) {}
    }
    this.port = null;
    this.log('Hardware disconnected. Returned to demo mode.', 'info');
    this.notifyState();
  }
}
