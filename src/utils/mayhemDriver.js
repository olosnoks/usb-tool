import { globalAdsbDecoder } from './adsbDecoder.js';
import { requestPortFor, releasePort, closeSerialPort } from './portManager';
import { createHackRfDsp } from './hackrfDspClient.js';

/*
 * Two real transports (no demo mode):
 *   - Serial: the Mayhem "USB Serial Console" (ChibiOS shell, prompt `ch>`) in
 *     normal mode. Commands used here: info, setfreq <Hz>, button <1-8>,
 *     touch <x> <y>, keyboard <hex>, screenframeshort, applist,
 *     appstart <name>, reboot, dfu. The shell has no RF amp / LNA / VGA
 *     commands; those work only in HackRF mode (WebUSB).
 *   - WebUSB libhackrf (HackRF mode): raw IQ, tuning, amp and gains. The
 *     control-transfer semantics follow libhackrf exactly (the gain requests
 *     are IN transfers that return a 1-byte ack), and the RX bring-up order is
 *     the one RocketGod's mayhem-mobile proved on HackRF One / r9 / Pro.
 * screenframeshort: one text line per screen row, one char per pixel,
 * char - 32 = 6-bit colour 00RRGGBB.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// libhackrf vendor request numbers.
export const HACKRF_REQ = {
  SET_TRANSCEIVER_MODE: 1, SAMPLE_RATE_SET: 6, BASEBAND_FILTER_BW_SET: 7,
  BOARD_ID_READ: 14, VERSION_STRING_READ: 15, SET_FREQ: 16, AMP_ENABLE: 17,
  SET_LNA_GAIN: 19, SET_VGA_GAIN: 20, SET_TXVGA_GAIN: 21, SET_HW_SYNC_MODE: 29, BOARD_REV_READ: 45
};
const MODE_OFF = 0, MODE_RECEIVE = 1;
const BOARD_NAMES = ['Jellybean', 'Jawbreaker', 'HackRF One', 'rad1o', 'HackRF One r9', 'HackRF Pro'];

// HackRF baseband filter bandwidths (Hz). libhackrf picks the largest value
// strictly below the sample rate; fall back to the narrowest.
const HACKRF_BB_FILTERS = [
  1750000, 2500000, 3500000, 5000000, 5500000, 6000000, 7000000, 8000000,
  9000000, 10000000, 12000000, 14000000, 15000000, 20000000, 24000000, 28000000
];
export function basebandFilterBwForRate(rateHz) {
  let best = HACKRF_BB_FILTERS[0];
  for (const bw of HACKRF_BB_FILTERS) { if (bw < rateHz) best = bw; else break; }
  return best;
}

/** Sample rates the receiver offers (HackRF: 2–20 Msps). */
export const HACKRF_SAMPLE_RATES = [2000000, 4000000, 8000000, 10000000, 20000000];
export const HACKRF_FREQ_MIN = 1000000;
export const HACKRF_FREQ_MAX = 6000000000;

export const MAYHEM_USB_IDS = {
  MAYHEM_SERIAL: { vid: '1d50', pid: '6018', name: 'PortaPack Mayhem USB Serial Console (normal mode)' },
  HACKRF_RUNTIME: { vid: '1d50', pid: '6089', name: 'Great Scott Gadgets HackRF One / PortaPack Mayhem' },
  LPC43XX_DFU: { vid: '1fc9', pid: '000c', name: 'NXP LPC43xx DFU Bootloader (HackRF SPI Flashing)' }
};

// Mayhem physical buttons as exposed by the `button N` console command.
export const MAYHEM_BUTTONS = {
  right: 1, left: 2, down: 3, up: 4, select: 5, dfu: 6, rotaryLeft: 7, rotaryRight: 8
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

// AGC window in ADC counts (RocketGod's agcStep): hold the IQ RMS between
// these so the 8-bit ADC is neither starved nor clipping.
const AGC_LO_COUNTS = 7, AGC_HI_COUNTS = 22, AGC_PERIOD_MS = 400;

export class MayhemPortaPackDriver {
  constructor() {
    this.isConnected = false;
    this.connectionType = null; // null (offline), 'serial', or 'webusb'
    this.port = null;
    this.usbDevice = null;
    this.reader = null;
    this.writer = null;

    // Radio State
    this.frequency = 433920000; // 433.92 MHz
    this.amp = 0; // 0 or 14 dB
    this.lnaGain = 24; // 0 - 40 dB in 8dB steps (RocketGod default 24)
    this.vgaGain = 24; // 0 - 62 dB in 2dB steps (RocketGod default 24)
    this.rxEndpoint = 1; // bulk IN endpoint number (0x81), discovered on connect
    this.sampleRate = 2000000; // 2 MSPS
    this.agcEnabled = false;
    this._agcLastTs = 0;
    this.activeApp = 'menu';
    this.selectedMenuIndex = 0;
    // Device identity: filled in only from the real device.
    this.firmwareVersion = null; this.boardId = null; this.boardIdNum = null; this.boardRev = null; this.cpldVersion = null;
    this.batteryMv = null; this.sdCardMounted = null; this.sdCardFreeGb = null;

    // Serial console state
    this.rxBuffer = '';               // partial line carried between chunks
    this.consoleWaiter = null;        // in-flight command: { buffer, resolve, timer }
    this._consoleChain = Promise.resolve();   // one console command at a time
    this.lastFrame = null;            // last screenframeshort { width, height, rgba }

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

    // Live spectrum from the real HackRF IQ stream (WebUSB mode), computed by
    // the DSP worker: averaged Hann FFTs, `spectrumBins` dBFS values, DC centred.
    this.latestSpectrum = null;   // Float32Array of dBFS bins
    this.latestLevelDbfs = -120;  // peak bin, dBFS
    this.latestFloorDb = null;    // median noise floor, dBFS
    this.latestRmsCounts = 0;     // IQ RMS in ADC counts
    this.spectrumBins = 1024;
    this.spectrumSeq = 0;         // bumps on every spectrum frame
    this.onSpectrumCallback = null;   // (spec, peakDb, centerHz, sampleRate, floorDb)

    // Audio demodulation (WebUSB only): demod runs in the DSP worker and
    // hands audio chunks to onAudioCallback(samples, rate, { channelDb, open }).
    this.audioMode = 'WFM';
    this.audioOn = false;
    this.channelOffsetHz = 0;     // listen this far from the LO centre
    this.squelchDb = -200;
    this.onAudioCallback = null;
    this.dsp = null;

    // Raw IQ capture (WebUSB only)
    this._capture = null;
  }

  // ---- audio / channel ---------------------------------------------------

  /** Start demodulating the live IQ to audio in the given mode (WFM/NFM/AM/USB/LSB). */
  enableAudio(mode = this.audioMode) {
    this.audioMode = mode; this.audioOn = true;
    this._dspConfig({ audioOn: true, mode });
    this.log(`[HackRF WebUSB] Audio demod: ${mode}${this.channelOffsetHz ? ` at ${((this.frequency + this.channelOffsetHz) / 1e6).toFixed(4)} MHz` : ''}.`, 'info');
  }

  setAudioMode(mode) { this.audioMode = mode; this._dspConfig({ mode }); }
  disableAudio() { this.audioOn = false; this._dspConfig({ audioOn: false }); }

  /** Listen `hz` away from the LO centre (click-to-tune on the waterfall). */
  setChannelOffset(hz) {
    const half = this.sampleRate / 2;
    this.channelOffsetHz = Math.max(-half, Math.min(half, Math.round(hz || 0)));
    this._dspConfig({ offsetHz: this.channelOffsetHz });
    this.notifyState();
  }

  /** Squelch threshold on the channel power (dBFS); -200 keeps it open. */
  setSquelch(db) { this.squelchDb = db; this._dspConfig({ squelchDb: db }); }

  /** The frequency the audio is actually listening to. */
  get listeningHz() { return this.frequency + this.channelOffsetHz; }

  _dspConfig(partial) { if (this.dsp) this.dsp.configure(partial); }

  _ensureDsp() {
    if (this.dsp) return this.dsp;
    const dsp = createHackRfDsp({
      sampleRate: this.sampleRate, bins: this.spectrumBins, mode: this.audioMode,
      offsetHz: this.channelOffsetHz, audioOn: this.audioOn, squelchDb: this.squelchDb
    });
    dsp.onSpectrum = (f) => {
      this.latestSpectrum = f.spec;
      this.latestLevelDbfs = f.peakDb;
      this.latestFloorDb = f.floorDb;
      this.latestRmsCounts = f.rmsCounts;
      this.rssi = Math.round(f.peakDb);
      this.spectrumSeq++;
      this._agcTick(f.rmsCounts);
      if (this.onSpectrumCallback) this.onSpectrumCallback(f.spec, f.peakDb, this.frequency, f.sampleRate, f.floorDb);
    };
    dsp.onAudio = (a) => { if (this.onAudioCallback) this.onAudioCallback(a.samples, a.rate, { channelDb: a.channelDb, open: a.open }); };
    this.dsp = dsp;
    return dsp;
  }

  // ---- AGC ---------------------------------------------------------------

  setAgc(on) {
    this.agcEnabled = !!on;
    this.log(`[RF WebUSB] AGC ${this.agcEnabled ? 'on: holding the IQ RMS between 7 and 22 counts' : 'off (manual gains)'}.`, 'info');
    this.notifyState();
  }

  /** One AGC step (RocketGod agcStep): VGA first, then LNA, in the native step sizes. */
  _agcTick(rmsCounts) {
    if (!this.agcEnabled || this.connectionType !== 'webusb' || this._sweeping || this._gainBusy) return;
    const now = performance.now();
    if (now - this._agcLastTs < AGC_PERIOD_MS) return;
    this._agcLastTs = now;
    let lna = this.lnaGain, vga = this.vgaGain;
    if (rmsCounts < AGC_LO_COUNTS) {
      if (vga < 62) vga += 2; else if (lna < 40) lna += 8; else return;
    } else if (rmsCounts > AGC_HI_COUNTS) {
      if (vga > 0) vga -= 2; else if (lna > 0) lna -= 8; else return;
    } else return;
    this.setWebUsbGains(lna, vga, { quiet: true }).catch(() => {});
  }

  // ---- IQ capture --------------------------------------------------------

  /** Record the raw int8 IQ stream (HackRF native .c8) until stopCapture(). */
  startCapture({ maxBytes = 64 * 1024 * 1024 } = {}) {
    if (this.connectionType !== 'webusb') throw new Error('IQ capture needs a WebUSB HackRF connection.');
    this._capture = { chunks: [], bytes: 0, maxBytes, startedAt: Date.now(), centerHz: this.frequency, sampleRate: this.sampleRate, full: false };
    this.log(`[Capture] Recording IQ at ${(this.frequency / 1e6).toFixed(4)} MHz, ${this.sampleRate / 1e6} Msps (up to ${Math.round(maxBytes / 1048576)} MB).`, 'info');
    this.notifyState();
    return this._capture;
  }

  captureStatus() {
    const c = this._capture;
    if (!c) return null;
    return { bytes: c.bytes, seconds: c.bytes / 2 / c.sampleRate, full: c.full, centerHz: c.centerHz, sampleRate: c.sampleRate };
  }

  /** Stop and return { c8 (Int8Array), c16 (Int16Array builder), sidecar, ... }. */
  stopCapture() {
    const c = this._capture;
    this._capture = null;
    this.notifyState();
    if (!c) return null;
    const c8 = new Int8Array(c.bytes);
    let o = 0;
    for (const ch of c.chunks) { c8.set(ch, o); o += ch.length; }
    const seconds = c.bytes / 2 / c.sampleRate;
    this.log(`[Capture] Stopped: ${(c.bytes / 1048576).toFixed(1)} MB, ${seconds.toFixed(2)} s of IQ.`, 'success');
    return {
      c8, bytes: c.bytes, seconds, centerHz: c.centerHz, sampleRate: c.sampleRate,
      // Mayhem's capture metadata (.TXT next to the .C16), so Replay can play it.
      sidecar: `sample_rate=${c.sampleRate}\ncenter_frequency=${c.centerHz}\n`,
      /** Mayhem .C16: signed 16-bit I/Q (int8 << 8). */
      toC16() { const out = new Int16Array(c8.length); for (let i = 0; i < c8.length; i++) out[i] = c8[i] << 8; return out; }
    };
  }

  // ---- logging / state ---------------------------------------------------

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
        channelOffsetHz: this.channelOffsetHz,
        amp: this.amp,
        lnaGain: this.lnaGain,
        vgaGain: this.vgaGain,
        agcEnabled: this.agcEnabled,
        sampleRate: this.sampleRate,
        capturing: !!this._capture,
        activeApp: this.activeApp,
        selectedMenuIndex: this.selectedMenuIndex,
        firmwareVersion: this.firmwareVersion,
        boardId: this.boardId,
        boardRev: this.boardRev,
        cpldVersion: this.cpldVersion,
        batteryMv: this.batteryMv,
        sdCardMounted: this.sdCardMounted,
        sdCardFreeGb: this.sdCardFreeGb,
        rssi: this.rssi
      });
    }
  }

  // ---- serial console connect --------------------------------------------

  async connectHardware(options = {}) {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.');
    }

    const baudRate = options.baudRate || 115200;
    const forceNoFilter = options.noFilter === true;

    try {
      this.log(`Opening Web Serial selector (${forceNoFilter ? 'Showing All COM Ports' : 'Filtered for PortaPack VID 1D50'})...`, 'info');

      // If forceNoFilter is true, call requestPort() with NO arguments to guarantee all COM ports show
      if (!this._portOwner) this._portOwner = { name: 'PortaPack Mayhem SDR', release: () => this.disconnect() };
      const port = await requestPortFor(this._portOwner, forceNoFilter ? undefined : {
        filters: [
          { usbVendorId: 0x1d50, usbProductId: 0x6018 },
          { usbVendorId: 0x1d50, usbProductId: 0x6089 },
          { usbVendorId: 0x1d50 }
        ]
      });
      try { await port.open({ baudRate }); }
      catch (e) { releasePort(port, this._portOwner); throw e; }
      this.port = port;
      this.isConnected = true;
      this.connectionType = 'serial';
      // Fill in only what the device reports.
      this.firmwareVersion = null; this.boardId = null; this.boardIdNum = null; this.boardRev = null; this.cpldVersion = null;
      this.batteryMv = null; this.sdCardMounted = null; this.sdCardFreeGb = null;
      this.rxBuffer = ''; this.consoleWaiter = null; this.lastFrame = null;

      const info = this.port.getInfo ? this.port.getInfo() : {};
      const vidHex = info.usbVendorId ? '0x' + info.usbVendorId.toString(16).toUpperCase() : '1D50';
      const pidHex = info.usbProductId ? '0x' + info.usbProductId.toString(16).toUpperCase() : '6018';

      this.log(`PortaPack serial console connected (${vidHex}:${pidHex} @ ${baudRate} baud).`, 'success');
      this.log('Keep the PortaPack in NORMAL mode (not the blue HackRF screen) for the console to answer.', 'info');

      this._readLoop = this.startReading();
      try { await this.refreshInfo(); } catch (e) { this.log(`info query failed: ${e.message}`, 'warning'); }
      this.notifyState();
      return true;
    } catch (err) {
      this.log(`Serial port connection cancelled or failed: ${err.message}`, 'error');
      throw err;
    }
  }

  // ---- WebUSB (libhackrf) -------------------------------------------------

  _ctrlOut(request, value = 0, index = 0, data) {
    return this.usbDevice.controlTransferOut({ requestType: 'vendor', recipient: 'device', request, value, index }, data);
  }

  _ctrlIn(request, value, index, length) {
    return this.usbDevice.controlTransferIn({ requestType: 'vendor', recipient: 'device', request, value, index }, length);
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

      // A PortaPack left in Mayhem serial mode (0x6018) speaks a different protocol.
      if (this.usbDevice.productId === 0x6018) {
        this.log("PortaPack detected in Mayhem Serial mode (0x6018). For direct HackRF DSP, switch PortaPack on-screen to 'HackRF' mode, or click 'COM Port' for the console.", 'warning');
        throw new Error('PortaPack is in Mayhem serial mode: switch it to HackRF mode on its screen, then connect again.');
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

      // Discover the bulk IN endpoint (HackRF exposes 0x81) instead of assuming it.
      try {
        const iface = this.usbDevice.configuration?.interfaces?.find((i) => i.claimed) || this.usbDevice.configuration?.interfaces?.[0];
        const alt = iface?.alternate;
        const ep = alt?.endpoints?.find((e) => e.direction === 'in' && e.type === 'bulk');
        if (ep) this.rxEndpoint = ep.endpointNumber;
      } catch (_) {}

      this.isConnected = true;
      this.connectionType = 'webusb';
      this.firmwareVersion = null; this.boardId = null; this.boardIdNum = null; this.boardRev = null;

      const pName = this.usbDevice.productName || 'HackRF One';
      const vid = '0x' + this.usbDevice.vendorId.toString(16).toUpperCase();
      const pid = '0x' + this.usbDevice.productId.toString(16).toUpperCase();
      this.log(`Connected to ${pName} via WebUSB (VID: ${vid}, PID: ${pid}) - libhackrf protocol.`, 'success');

      // Identify: version string, board id, board rev (rev read may be unsupported).
      try {
        const verRes = await this._ctrlIn(HACKRF_REQ.VERSION_STRING_READ, 0, 0, 255);
        const verStr = verRes?.data ? new TextDecoder().decode(verRes.data).replace(/\0/g, '').trim() : '';
        if (verStr) { this.firmwareVersion = verStr; this.log(`HackRF Firmware: ${verStr}`, 'success'); }
      } catch (_) {}
      try {
        const bRes = await this._ctrlIn(HACKRF_REQ.BOARD_ID_READ, 0, 0, 1);
        if (bRes?.data?.byteLength) {
          const bId = bRes.data.getUint8(0);
          this.boardIdNum = bId;
          this.boardId = BOARD_NAMES[bId] || `HackRF Board ID ${bId}`;
          this.log(`Board ID: ${bId} (${this.boardId})`, 'info');
          if (bId === 5) this.log('HackRF Pro: expect to need roughly 28 dB more VGA than a HackRF One for the same level (or turn AGC on).', 'info');
        }
      } catch (_) {}
      try {
        const rRes = await this._ctrlIn(HACKRF_REQ.BOARD_REV_READ, 0, 0, 1);
        if (rRes?.data?.byteLength) this.boardRev = rRes.data.getUint8(0);
      } catch (_) {}

      await this._bringUpRx();
      this.startWebUsbBulkReading();
      this.notifyState();
      return true;
    } catch (err) {
      this.log(`WebUSB Connection Error: ${err.message}`, 'error');
      if (this.usbDevice) { try { await this.usbDevice.close(); } catch (_) {} this.usbDevice = null; }
      this.isConnected = false; this.connectionType = null;
      throw err;
    }
  }

  /**
   * RX bring-up in the order mayhem-mobile proved on One / r9 / Pro:
   * OFF → settle → HW sync off → sample rate → baseband filter → freq → amp →
   * gains → RECEIVE → settle → cache-bust retune (+1 MHz and back; the Pro's
   * tuning path caches the frequency so an unchanged re-tune is a no-op) →
   * re-assert gains → settle. A HackRF left in RECEIVE makes a second RECEIVE
   * a no-op that streams zeros, hence the OFF first.
   */
  async _bringUpRx() {
    await this._ctrlOut(HACKRF_REQ.SET_TRANSCEIVER_MODE, MODE_OFF);
    await sleep(100);
    try { await this._ctrlOut(HACKRF_REQ.SET_HW_SYNC_MODE, 0); } catch (_) {}
    await this._applySampleRate(this.sampleRate);
    await this._setFreqRaw(this.frequency);
    await this.setWebUsbAmp(this.amp, { quiet: true });
    await this.setWebUsbGains(this.lnaGain, this.vgaGain, { quiet: true });
    await this._ctrlOut(HACKRF_REQ.SET_TRANSCEIVER_MODE, MODE_RECEIVE);
    await sleep(40);
    await this._setFreqRaw(this.frequency + 1000000);
    await this._setFreqRaw(this.frequency);
    await this.setWebUsbGains(this.lnaGain, this.vgaGain, { quiet: true });
    await sleep(60);
    this.log(`HackRF: RX engaged at ${(this.frequency / 1e6).toFixed(4)} MHz, ${this.sampleRate / 1e6} Msps, LNA ${this.lnaGain} / VGA ${this.vgaGain} dB, amp ${this.amp ? 'on' : 'off'}.`, 'success');
  }

  async _applySampleRate(rateHz) {
    // SAMPLE_RATE_SET (6): { u32 rate, u32 divider } little-endian.
    const rateBuf = new ArrayBuffer(8);
    const v = new DataView(rateBuf);
    v.setUint32(0, rateHz, true);
    v.setUint32(4, 1, true);
    await this._ctrlOut(HACKRF_REQ.SAMPLE_RATE_SET, 0, 0, rateBuf);
    // BASEBAND_FILTER_BW_SET (7): low 16 in value, high 16 in index.
    const bw = basebandFilterBwForRate(rateHz);
    await this._ctrlOut(HACKRF_REQ.BASEBAND_FILTER_BW_SET, bw & 0xFFFF, (bw >> 16) & 0xFFFF);
    this.sampleRate = rateHz;
  }

  /** Change the sample rate (span) while streaming; the DSP follows. */
  async setSampleRate(rateHz) {
    if (this.connectionType !== 'webusb' || !this.usbDevice?.opened) { this.sampleRate = rateHz; this.notifyState(); return; }
    const rate = Math.max(1000000, Math.min(20000000, Math.round(rateHz)));
    try {
      await this._applySampleRate(rate);
      // Retune (cache-bust) so the new filter and rate settle on the Pro too.
      await this._setFreqRaw(this.frequency + 1000000);
      await this._setFreqRaw(this.frequency);
      this.setChannelOffset(this.channelOffsetHz);   // clamp to the new span
      this._dspConfig({ sampleRate: rate });
      this._adsbRateWarned = false;
      this.log(`[HackRF WebUSB] Sample rate ${rate / 1e6} Msps, baseband filter ${basebandFilterBwForRate(rate) / 1e6} MHz.`, 'info');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to set sample rate: ${err.message}`, 'error');
    }
  }

  // HackRF One streams ~4 MB/s of IQ at 2 Msps (40 MB/s at 20); one transfer
  // at a time leaves gaps in which the device's FIFO overflows and the firmware
  // halts the stream. mayhem-mobile keeps 8 × 64 KiB in flight — so do we:
  // INFLIGHT independent pump loops, each always holding a transferIn.
  startWebUsbBulkReading() {
    const ep = this.rxEndpoint;
    const INFLIGHT = 8;
    const SIZE = 65536;
    this._ensureDsp();
    this.log(`[HackRF WebUSB] IQ stream active on bulk endpoint 0x${(0x80 | ep).toString(16)} (${INFLIGHT} transfers in flight, DSP ${this.dsp.kind === 'worker' ? 'in a worker' : 'inline'}).`, 'info');
    this._allZeroWarned = false;
    this._gotIq = false;
    this._iqStartTs = performance.now();

    const pump = async () => {
      while (this.isConnected && this.connectionType === 'webusb' && this.usbDevice && this.usbDevice.opened) {
        try {
          const result = await this.usbDevice.transferIn(ep, SIZE);
          if (result.status === 'stall') {
            try { await this.usbDevice.clearHalt('in', ep); } catch (_) {}
            continue;
          }
          if (result.data && result.data.byteLength) this._processIqBuffer(result.data);
        } catch (err) {
          if (!this.isConnected) break;
          await sleep(20);
        }
      }
    };

    this._iqPumps = [];
    for (let i = 0; i < INFLIGHT; i++) this._iqPumps.push(pump());

    // If nothing arrives in the first ~1.5 s, the PortaPack is probably not in
    // HackRF mode (or the bring-up did not take). Say so once.
    setTimeout(() => {
      if (this.connectionType === 'webusb' && !this._gotIq) {
        this.log('[HackRF WebUSB] No IQ received. On a PortaPack, switch the device to "HackRF" mode on its screen; a bare HackRF One should just stream. Check the cable and USB power too.', 'warning');
      }
    }, 1500);
  }

  _processIqBuffer(data) {
    this._gotIq = true;
    // One-time hint if the radio streams only zeros (wrong mode / no bring-up).
    if (!this._allZeroWarned) {
      let nonZero = false;
      for (let i = 0; i < Math.min(512, data.byteLength); i++) { if (data.getUint8(i) !== 0) { nonZero = true; break; } }
      if (!nonZero) { this._allZeroWarned = true; this.log('[HackRF WebUSB] IQ stream is all zeros — is the PortaPack in HackRF mode? (RX bring-up may not have taken; try Disconnect and connect again.)', 'warning'); }
    }
    const bytes = new Int8Array(data.buffer, data.byteOffset, data.byteLength);
    // Near 1090 MHz, decode real Mode-S (ADS-B) packets from the raw IQ. The
    // preamble correlator is written for 2 Msps (1 µs = 2 samples).
    if (Math.abs(this.frequency - 1090000000) < 6000000) {
      if (this.sampleRate === 2000000) globalAdsbDecoder.processRawIq(data.buffer);
      else if (!this._adsbRateWarned) { this._adsbRateWarned = true; this.log('[ADS-B] The Mode-S decoder needs the 2 MHz span; set SPAN to 2 MHz to decode aircraft.', 'warning'); }
    }
    // Raw IQ recording (copy: the buffer is handed to the worker next).
    const cap = this._capture;
    if (cap && !cap.full) {
      const room = cap.maxBytes - cap.bytes;
      const take = Math.min(room, bytes.length);
      if (take > 0) { cap.chunks.push(bytes.slice(0, take)); cap.bytes += take; }
      if (cap.bytes >= cap.maxBytes) { cap.full = true; this.log('[Capture] Buffer full; recording stopped at the size limit.', 'warning'); }
    }
    // Spectrum, AGC level and audio come back from the DSP (worker or inline).
    const buf = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? data.buffer : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this._ensureDsp().push(buf);
  }

  /** SET_FREQ (16): { u32 MHz, u32 Hz remainder } little-endian. */
  async _setFreqRaw(hz) {
    const freqMhz = Math.floor(hz / 1000000);
    const freqHz = hz - freqMhz * 1000000;
    const buf = new ArrayBuffer(8);
    const view = new DataView(buf);
    view.setUint32(0, freqMhz, true);
    view.setUint32(4, freqHz, true);
    await this._ctrlOut(HACKRF_REQ.SET_FREQ, 0, 0, buf);
  }

  async setWebUsbFreq(hz, { quiet = false } = {}) {
    if (!this.usbDevice || !this.usbDevice.opened) return;
    const target = Math.max(HACKRF_FREQ_MIN, Math.min(HACKRF_FREQ_MAX, Math.round(hz)));
    try {
      // Cache-bust retune (+1 MHz then the target): on a HackRF Pro an
      // unchanged re-tune is a firmware no-op; harmless on a One.
      await this._setFreqRaw(target + 1000000);
      await this._setFreqRaw(target);
      this.frequency = target;
      if (!quiet && !this._sweeping) this.log(`[TUNER WebUSB] Synthesizer locked to ${(target / 1000000).toFixed(4)} MHz`, 'success');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to tune frequency via WebUSB: ${err.message}`, 'error');
    }
  }

  async setWebUsbAmp(ampOn, { quiet = false } = {}) {
    if (!this.usbDevice || !this.usbDevice.opened) return;
    try {
      await this._ctrlOut(HACKRF_REQ.AMP_ENABLE, ampOn > 0 ? 1 : 0, 0);
      this.amp = ampOn > 0 ? 14 : 0;
      if (!quiet) this.log(`[RF WebUSB] RF Front-End Amp: ${this.amp > 0 ? '+14 dB (ENABLED)' : '0 dB (BYPASSED)'}`, 'info');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to set Amp via WebUSB: ${err.message}`, 'error');
    }
  }

  /**
   * LNA / VGA gains. libhackrf sends these as IN control transfers with the
   * gain in wIndex and reads a 1-byte ack (0 = rejected). Values are rounded
   * to the hardware steps (LNA 8 dB, VGA 2 dB) exactly as libhackrf does.
   */
  async setWebUsbGains(lna, vga, { quiet = false } = {}) {
    if (!this.usbDevice || !this.usbDevice.opened) return;
    const lnaDb = Math.min(40, Math.max(0, Math.round(lna))) & ~7;
    const vgaDb = Math.min(62, Math.max(0, Math.round(vga))) & ~1;
    this._gainBusy = true;
    try {
      const ackL = await this._ctrlIn(HACKRF_REQ.SET_LNA_GAIN, 0, lnaDb, 1);
      if (ackL?.data?.byteLength && ackL.data.getUint8(0) === 0) throw new Error(`LNA gain ${lnaDb} dB rejected by the firmware`);
      this.lnaGain = lnaDb;
      const ackV = await this._ctrlIn(HACKRF_REQ.SET_VGA_GAIN, 0, vgaDb, 1);
      if (ackV?.data?.byteLength && ackV.data.getUint8(0) === 0) throw new Error(`VGA gain ${vgaDb} dB rejected by the firmware`);
      this.vgaGain = vgaDb;
      if (!quiet) this.log(`[RF WebUSB] Gains set: LNA ${lnaDb} dB | VGA ${vgaDb} dB`, 'info');
      this.notifyState();
    } catch (err) {
      this.log(`Failed to set gains via WebUSB: ${err.message}`, 'error');
    } finally {
      this._gainBusy = false;
    }
  }

  /**
   * Wideband sweep: retune the HackRF across [startHz, endHz] one window at a
   * time (the flat central `useFraction` of the span, DC spike masked) and hand
   * each settled, averaged FFT segment to onSegment. Each step waits for
   * `settleFrames` fresh spectrum frames so buffers still in flight from the
   * previous frequency are not counted. Returns when the band is covered or
   * stopSweep() is called; the dial is restored afterwards.
   */
  async sweepBand({ startHz, endHz, onSegment, settleFrames = 3, settleMs = 400, useFraction = 0.6, dwellMs = 0 } = {}) {
    if (this.connectionType !== 'webusb') throw new Error('Sweep needs a WebUSB HackRF connection (PortaPack in HackRF mode).');
    if (!(endHz > startHz)) throw new Error('Sweep end must be above the start.');
    this._sweeping = true;
    const span = this.sampleRate;
    const useSpan = span * useFraction;
    const savedFreq = this.frequency;
    const savedAudio = this.audioOn;
    if (savedAudio) this._dspConfig({ audioOn: false });   // no audio churn mid-sweep
    try {
      for (let center = startHz + useSpan / 2; center - useSpan / 2 < endHz && this._sweeping; center += useSpan) {
        const c = Math.round(Math.max(HACKRF_FREQ_MIN, Math.min(HACKRF_FREQ_MAX, center)));
        await this.setWebUsbFreq(c, { quiet: true });
        const target = this.spectrumSeq + settleFrames;
        const t0 = performance.now();
        while (this._sweeping && this.spectrumSeq < target && performance.now() - t0 < settleMs + dwellMs) await sleep(5);
        if (dwellMs) await sleep(dwellMs);
        const spec = this.latestSpectrum;
        if (spec && onSegment && this._sweeping) {
          onSegment({ centerHz: c, spanHz: span, useSpanHz: useSpan, spec: Float32Array.from(spec), floorDb: this.latestFloorDb });
        }
      }
    } finally {
      this._sweeping = false;
      if (savedAudio) this._dspConfig({ audioOn: true });
      try { await this.setWebUsbFreq(savedFreq, { quiet: true }); } catch (_) {}
    }
  }

  stopSweep() { this._sweeping = false; }

  async startReading() {
    if (!this.port || !this.port.readable) return;
    const textDecoder = new TextDecoderStream();
    // Kept so disconnect can wait for the pipe to let go of port.readable.
    this._pipe = this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
    const reader = textDecoder.readable.getReader();
    this.reader = reader;

    try {
      while (this.isConnected) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) this.handleSerialText(value);
      }
    } catch (err) {
      if (this.isConnected) {
        this.log(`Read loop terminated: ${err.message}`, 'error');
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  }

  // A chunk can end mid-line and hold a reply plus unrelated output: feed an
  // in-flight console command until its `ch>` prompt; otherwise split into
  // whole lines, carrying the partial last line to the next chunk.
  handleSerialText(text) {
    if (this.consoleWaiter) {
      this.consoleWaiter.buffer += text;
      const i = this.consoleWaiter.buffer.indexOf('ch>');
      if (i < 0) return;
      const w = this.consoleWaiter;
      this.consoleWaiter = null;
      clearTimeout(w.timer);
      const rest = w.buffer.slice(i + 3);
      w.resolve(w.buffer.slice(0, i + 3));
      if (rest) this.handleSerialText(rest);
      return;
    }
    this.rxBuffer += text;
    let nl;
    while ((nl = this.rxBuffer.indexOf('\n')) >= 0) {
      const line = this.rxBuffer.slice(0, nl).replace(/\r$/, '').trim();
      this.rxBuffer = this.rxBuffer.slice(nl + 1);
      if (line && line !== 'ch>') {
        this.log(`[MAYHEM] ${line}`, 'info');
        this.parseResponse(line);
      }
    }
    if (this.rxBuffer.length > 65536) this.rxBuffer = this.rxBuffer.slice(-4096);
  }

  // One command at a time: send it and read until the `ch>` prompt returns.
  // Resolves with the output (echo and prompt stripped); on timeout, with
  // whatever arrived.
  sendConsoleCommand(cmd, { timeoutMs = 4000 } = {}) {
    const run = () => this._consoleCommand(cmd, timeoutMs);
    const p = this._consoleChain.then(run, run);
    this._consoleChain = p.catch(() => {});
    return p;
  }

  async _consoleCommand(cmd, timeoutMs) {
    if (this.connectionType !== 'serial' || !this.port || !this.port.writable) {
      throw new Error('Serial console not connected');
    }
    const raw = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.consoleWaiter && this.consoleWaiter.timer === timer) {
          const partial = this.consoleWaiter.buffer;
          this.consoleWaiter = null;
          resolve(partial);
        }
      }, timeoutMs);
      this.consoleWaiter = { buffer: '', resolve, timer };
      let writer;
      try { writer = this.port.writable.getWriter(); }
      catch (e) { clearTimeout(timer); this.consoleWaiter = null; reject(e); return; }
      writer.write(new TextEncoder().encode(cmd + '\r\n'))
        .catch((e) => { clearTimeout(timer); this.consoleWaiter = null; reject(e); })
        .finally(() => { try { writer.releaseLock(); } catch (_) {} });
    });
    let out = raw;
    const firstNl = out.indexOf('\n');
    if (firstNl >= 0 && out.slice(0, firstNl).trim().startsWith(cmd.split(' ')[0])) out = out.slice(firstNl + 1);
    return out.replace(/\r?\n?ch>\s*$/, '').replace(/ch>\s*$/, '');
  }

  async refreshInfo() {
    const info = await this.sendConsoleCommand('info');
    const first = info.trim().split(/\r?\n/)[0] || '';
    this.firmwareVersion = (info.match(/Mayhem[^\r\n]*/) || [null])[0] || first || null;
    if (this.firmwareVersion) this.log(`Device info: ${this.firmwareVersion}`, 'info');
    this.notifyState();
    return info;
  }

  async setFrequency(hz) {
    const f = Math.round(hz);
    await this.sendConsoleCommand(`setfreq ${f}`);
    this.frequency = f;
    this.notifyState();
  }

  async press(name) {
    const n = MAYHEM_BUTTONS[name];
    if (!n) throw new Error(`unknown button: ${name}`);
    await this.sendConsoleCommand(`button ${n}`, { timeoutMs: 1500 });
  }

  async sendTouch(x, y) {
    await this.sendConsoleCommand(`touch ${Math.round(x)} ${Math.round(y)}`, { timeoutMs: 1500 });
  }

  async sendKeyboard(text) {
    const hex = Array.from(new TextEncoder().encode(text)).map((b) => b.toString(16).padStart(2, '0')).join('');
    await this.sendConsoleCommand(`keyboard ${hex}`);
  }

  listApps() { return this.sendConsoleCommand('applist'); }
  startApp(name) { return this.sendConsoleCommand(`appstart ${name}`); }

  /** Live LCD via `screenframeshort`, decoded to RGBA. Size comes from the reply. */
  async captureScreen() {
    const raw = await this.sendConsoleCommand('screenframeshort', { timeoutMs: 6000 });
    const lines = raw.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0 && l !== 'ch>');
    if (!lines.length) return null;
    const widths = {};
    for (const l of lines) widths[l.length] = (widths[l.length] || 0) + 1;
    const width = parseInt(Object.keys(widths).sort((a, b) => widths[b] - widths[a])[0], 10);
    const rows = lines.filter((l) => l.length === width);
    const height = rows.length;
    if (!width || !height) return null;
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const v = rows[y].charCodeAt(x) - 32;
        const i = (y * width + x) * 4;
        rgba[i] = ((v >> 4) & 3) * 85; rgba[i + 1] = ((v >> 2) & 3) * 85; rgba[i + 2] = (v & 3) * 85; rgba[i + 3] = 255;
      }
    }
    this.lastFrame = { width, height, rgba };
    return this.lastFrame;
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
    if (!this.isConnected) {
      this.log('Not connected. Connect a HackRF over WebUSB, or a PortaPack over serial, first.', 'warning');
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
      } else if (action === 'rate' && parts[1]) {
        await this.setSampleRate(parseInt(parts[1], 10));
      } else if (action === 'agc') {
        this.setAgc(parts[1] !== '0' && parts[1] !== 'off');
      } else if (action === 'version') {
        this.log(`[HACKRF WebUSB] Hardware: ${this.boardId}${this.boardRev != null ? ` rev ${this.boardRev}` : ''} | Firmware: ${this.firmwareVersion}`, 'info');
      } else {
        this.log(`'${action}' is not a HackRF (WebUSB) command. Available: freq <Hz>, amp 0|1, lna <dB>, vga <dB>, rate <Hz>, agc on|off, version. Mayhem shell commands need the serial console.`, 'warning');
      }
      return;
    }

    if (this.connectionType !== 'serial') return;
    // The UI's verbs, mapped onto the Mayhem shell. Anything else is sent as typed.
    const parts = cmd.trim().split(/\s+/);
    const action = parts[0].toLowerCase();
    try {
      if (action === 'freq' && parts[1]) {
        await this.setFrequency(parseInt(parts[1], 10));
      } else if (action === 'version') {
        await this.refreshInfo();
      } else if (action === 'app' && parts[1]) {
        await this.startApp(parts[1]);
      } else if (action === 'amp' || action === 'lna' || action === 'vga') {
        this.log(`'${action}' isn't available over the Mayhem serial console. Switch the PortaPack to HackRF mode and connect over WebUSB to set the RF amp and gains.`, 'warning');
      } else {
        const out = await this.sendConsoleCommand(cmd.trim(), { timeoutMs: action === 'reboot' || action === 'dfu' ? 1000 : 4000 });
        for (const line of out.split(/\r?\n/)) if (line.trim()) this.log(`[MAYHEM] ${line.trim()}`, 'info');
      }
    } catch (e) {
      this.log(`${action} failed: ${e.message}`, 'error');
    }
  }

  // Keypad & D-Pad Navigation Controls
  pressKey(key) {
    if (this.connectionType === 'serial') {
      const map = { up: 'up', down: 'down', left: 'left', right: 'right', select: 'select',
                    step_up: 'rotaryRight', step_down: 'rotaryLeft', back: 'left' };
      const name = map[key];
      if (name) this.press(name).catch((e) => this.log(`button failed: ${e.message}`, 'error'));
      return;
    }
    if (this.connectionType === 'webusb') {
      this.log('Buttons need the serial console: switch the PortaPack to normal mode and connect over serial.', 'warning');
      return;
    }
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
    this.connectionType = null;
    this._sweeping = false;
    this._capture = null;
    if (this.usbDevice) {
      // Leave the radio idle so the next bring-up starts from OFF.
      try { if (this.usbDevice.opened) await this._ctrlOut(HACKRF_REQ.SET_TRANSCEIVER_MODE, MODE_OFF); } catch (_) {}
      try { await this.usbDevice.close(); } catch (_) {}
      this.usbDevice = null;
    }
    // Let the IQ pump loops unwind (their in-flight transfers reject on close).
    if (this._iqPumps) { try { await Promise.allSettled(this._iqPumps); } catch (_) {} this._iqPumps = null; }
    if (this.dsp) { this.dsp.terminate(); this.dsp = null; }
    this.latestSpectrum = null; this.latestFloorDb = null;
    if (this.consoleWaiter) { clearTimeout(this.consoleWaiter.timer); this.consoleWaiter.resolve(this.consoleWaiter.buffer); this.consoleWaiter = null; }
    this.rxBuffer = '';
    const port = this.port, reader = this.reader, readLoop = this._readLoop, pipe = this._pipe;
    this.port = null; this.reader = null; this._readLoop = null; this._pipe = null;
    if (port) {
      // Cancelling the decoder's reader cancels the pipe, which releases port.readable.
      await closeSerialPort(port, { reader, readLoop, pipes: [pipe] });
      releasePort(port, this._portOwner);
    } else if (reader) {
      try { await reader.cancel(); } catch (_) {}
    }
    this.log('Hardware disconnected.', 'info');
    this.notifyState();
  }
}
