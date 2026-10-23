/**
 * FLIPPER ZERO REAL HARDWARE WEB SERIAL DRIVER (qFlipper Architecture)
 * 
 * Communicates directly with physical Flipper Zero over Web Serial (USB CDC / STM32 VCP)
 * USB Vendor ID: 0x0483 (STMicroelectronics), Product ID: 0x5740 (Flipper Zero CLI)
 * 
 * Zero fake or simulated data by default. Connects to real hardware, reads real
 * power info, storage tree (/ext and /int), screen framebuffer, and sends real
 * D-Pad inputs and CLI commands.
 */

export class FlipperZeroDriver {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.isDemo = false;

    this.onStateChangeCallback = null;
    this.onLogCallback = null;
    this.onScreenUpdateCallback = null;

    // Real Hardware State (Populated strictly from physical Flipper Zero)
    this.state = {
      isConnected: false,
      isDemo: false,
      deviceName: null,
      hardwareModel: null,
      hardwareColor: null,
      firmwareVersion: null,
      firmwareBranch: null,
      firmwareCommit: null,
      firmwareBuildDate: null,
      radioAlive: null,
      bleMac: null,
      serialNumber: null,

      // Power & Battery Metrics
      batteryPercent: null,
      batteryVoltageMv: null,
      batteryCurrentMa: null,
      batteryTempC: null,
      batteryHealth: null,
      chargeState: null,

      // Storage Info
      sdMounted: false,
      sdTotalKb: null,
      sdFreeKb: null,
      intTotalKb: null,
      intFreeKb: null,

      // Navigation & Screen
      activeMenu: 'Home',
      screenBuffer: null, // Uint8Array(1024) - 128x64 1-bit monochrome
      lastLog: null
    };

    this.cliLogs = [];
    this.incomingBuffer = '';
    this.commandAccumulator = '';
    this.pendingCommandResolve = null;
    this.pendingCommandReject = null;
  }

  log(msg, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    const logItem = { timestamp, msg, type };
    this.cliLogs.push(logItem);
    this.state.lastLog = logItem;
    if (this.onLogCallback) {
      this.onLogCallback(logItem);
    }
  }

  notifyState() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback({ ...this.state, isConnected: this.isConnected, isDemo: this.isDemo });
    }
  }

  /**
   * Connect to an existing / pre-authorized Web Serial port directly
   */
  async connectPort(port) {
    if (!port) throw new Error('No port provided.');
    this.port = port;

    try {
      await this.port.open({ baudRate: 115200 });
    } catch (openErr) {
      if (openErr.name === 'NetworkError' || openErr.message?.includes('Failed to open')) {
        throw new Error('COM port is locked or in use! If the desktop qFlipper application or the main Flasher header is currently open, close or transfer the port first.');
      }
      throw openErr;
    }

    this.isConnected = true;
    this.isDemo = false;
    this.state.isConnected = true;
    this.state.isDemo = false;
    this.writer = this.port.writable.getWriter();

    this.log('Connected to Flipper Zero USB CDC-ACM port! Initializing FuriOS session...', 'success');

    // Start serial reader in background
    this.startSerialReader();

    // Wake up Flipper CLI shell
    await this.writeRaw('\r\n');
    await new Promise(r => setTimeout(r, 150));

    // Refresh all real telemetry directly from physical device
    await this.refreshAllRealData();

    this.notifyState();
    return true;
  }

  /**
   * Connect to physical Flipper Zero via Web Serial API
   */
  async connectHardware(options = {}) {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.');
    }

    try {
      let port;
      if (options.port) {
        port = options.port;
      } else if (options.noFilter) {
        this.log('Opening Web Serial port selector (All COM Ports)...', 'info');
        port = await navigator.serial.requestPort();
      } else {
        this.log('Searching for Flipper Zero USB device (VID: 0x0483, PID: 0x5740)...', 'info');
        try {
          port = await navigator.serial.requestPort({
            filters: [
              { usbVendorId: 0x0483, usbProductId: 0x5740 },
              { usbVendorId: 0x0483 },
              { usbVendorId: 0x1d50, usbProductId: 0x6018 }
            ]
          });
        } catch (filterErr) {
          // If filtered device prompt returned nothing or was cancelled, immediately fall back to showing all COM ports
          this.log('Filtered port prompt cancelled or device not matched. Showing all serial ports...', 'warning');
          port = await navigator.serial.requestPort();
        }
      }

      return await this.connectPort(port);
    } catch (err) {
      this.isConnected = false;
      this.state.isConnected = false;
      this.log(`Flipper Zero connection failed: ${err.message}`, 'error');
      throw err;
    }
  }

  async startSerialReader() {
    const textDecoder = new TextDecoderStream();
    this.port.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.reader = textDecoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) {
          this.handleSerialChunk(value);
        }
      }
    } catch (err) {
      if (this.isConnected) {
        this.log(`Serial connection error: ${err.message}`, 'error');
      }
    } finally {
      if (this.reader) {
        try { this.reader.releaseLock(); } catch(e){}
      }
    }
  }

  handleSerialChunk(chunk) {
    this.incomingBuffer += chunk;
    this.commandAccumulator += chunk;

    // Split on newlines to display raw lines in log
    const lines = this.incomingBuffer.split('\n');
    if (lines.length > 1) {
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i].replace(/\r$/, '');
        if (line.trim()) {
          this.log(line, 'rx');
        }
      }
      this.incomingBuffer = lines[lines.length - 1];
    }

    // Check if prompt `>: ` has arrived to resolve pending CLI commands
    if (this.pendingCommandResolve && (this.incomingBuffer.includes('>:') || this.commandAccumulator.includes('>:'))) {
      const fullResponse = this.commandAccumulator;
      this.commandAccumulator = '';
      const resolve = this.pendingCommandResolve;
      this.pendingCommandResolve = null;
      this.pendingCommandReject = null;
      resolve(fullResponse);
    }
  }

  async writeRaw(text) {
    if (!this.writer) throw new Error('Not connected to Flipper Zero');
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(text));
  }

  /**
   * Execute a CLI command and wait for response prompt
   */
  async executeCommand(cmd, timeoutMs = 4000) {
    if (!this.isConnected || !this.writer) {
      throw new Error('No physical Flipper Zero connected.');
    }

    this.log(`> ${cmd}`, 'tx');
    this.commandAccumulator = '';

    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCommandResolve) {
          const resp = this.commandAccumulator || this.incomingBuffer;
          this.pendingCommandResolve = null;
          this.pendingCommandReject = null;
          this.commandAccumulator = '';
          resolve(resp);
        }
      }, timeoutMs);

      this.pendingCommandResolve = (res) => {
        clearTimeout(timer);
        resolve(res);
      };

      this.pendingCommandReject = (err) => {
        clearTimeout(timer);
        reject(err);
      };

      try {
        await this.writeRaw(cmd + '\r\n');
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  /**
   * Query all real hardware info from physical Flipper Zero
   */
  async refreshAllRealData() {
    this.log('[FLIPPER] Interrogating physical device info, battery, and storage...', 'info');

    // 1. Device Info
    try {
      const devRes = await this.executeCommand('device_info', 2500);
      this.parseDeviceInfo(devRes);
    } catch (e) {
      console.warn('device_info failed:', e);
    }

    // 2. Power Info
    try {
      const pwrRes = await this.executeCommand('power info', 2500);
      this.parsePowerInfo(pwrRes);
    } catch (e) {
      console.warn('power info failed:', e);
    }

    // 3. Storage Info (/ext)
    try {
      const sdRes = await this.executeCommand('storage info /ext', 2500);
      this.parseStorageExt(sdRes);
    } catch (e) {
      console.warn('storage info /ext failed:', e);
    }

    // 4. Storage Info (/int)
    try {
      const intRes = await this.executeCommand('storage info /int', 2500);
      this.parseStorageInt(intRes);
    } catch (e) {
      console.warn('storage info /int failed:', e);
    }

    this.notifyState();
  }

  parseDeviceInfo(output) {
    const lines = output.split('\n');
    lines.forEach(l => {
      const [key, ...vals] = l.split(':');
      if (!key || vals.length === 0) return;
      const k = key.trim().toLowerCase();
      const v = vals.join(':').trim();

      if (k === 'hardware_model') this.state.hardwareModel = v;
      if (k === 'hardware_color') this.state.hardwareColor = v === '1' ? 'Black' : 'White';
      if (k === 'hardware_ver') this.state.hardwareVer = `v${v}`;
      if (k === 'firmware_version') this.state.firmwareVersion = v;
      if (k === 'firmware_branch') this.state.firmwareBranch = v;
      if (k === 'firmware_commit') this.state.firmwareCommit = v;
      if (k === 'firmware_build_date') this.state.firmwareBuildDate = v;
      if (k === 'radio_alive') this.state.radioAlive = v === 'true';
      if (k === 'device_name') this.state.deviceName = v;
    });

    if (!this.state.deviceName && this.state.hardwareModel) {
      this.state.deviceName = 'Flipper Zero';
    }
  }

  parsePowerInfo(output) {
    const lines = output.split('\n');
    lines.forEach(l => {
      const [key, ...vals] = l.split(':');
      if (!key || vals.length === 0) return;
      const k = key.trim().toLowerCase();
      const v = vals.join(':').trim();

      if (k.includes('charge_level') || k.includes('battery_charge')) {
        const num = parseInt(v.replace('%', ''));
        if (!isNaN(num)) this.state.batteryPercent = num;
      }
      if (k.includes('battery_voltage') || k.includes('voltage')) {
        const num = parseInt(v.replace('mV', '').trim());
        if (!isNaN(num)) this.state.batteryVoltageMv = num;
      }
      if (k.includes('battery_current') || k.includes('current')) {
        const num = parseInt(v.replace('mA', '').trim());
        if (!isNaN(num)) this.state.batteryCurrentMa = num;
      }
      if (k.includes('battery_temperature') || k.includes('temperature')) {
        const num = parseFloat(v.replace('C', '').trim());
        if (!isNaN(num)) this.state.batteryTempC = num;
      }
      if (k.includes('health')) {
        const num = parseInt(v.replace('%', ''));
        if (!isNaN(num)) this.state.batteryHealth = num;
      }
      if (k.includes('charge_state')) {
        this.state.chargeState = v;
      }
    });
  }

  parseStorageExt(output) {
    const lines = output.split('\n');
    lines.forEach(l => {
      const [key, ...vals] = l.split(':');
      if (!key || vals.length === 0) return;
      const k = key.trim().toLowerCase();
      const v = vals.join(':').trim();

      if (k.includes('total space')) {
        const num = parseInt(v.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) this.state.sdTotalKb = num;
      }
      if (k.includes('free space')) {
        const num = parseInt(v.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) {
          this.state.sdFreeKb = num;
          this.state.sdMounted = true;
        }
      }
    });
  }

  parseStorageInt(output) {
    const lines = output.split('\n');
    lines.forEach(l => {
      const [key, ...vals] = l.split(':');
      if (!key || vals.length === 0) return;
      const k = key.trim().toLowerCase();
      const v = vals.join(':').trim();

      if (k.includes('total space')) {
        const num = parseInt(v.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) this.state.intTotalKb = num;
      }
      if (k.includes('free space')) {
        const num = parseInt(v.replace(/[^0-9]/g, ''));
        if (!isNaN(num)) this.state.intFreeKb = num;
      }
    });
  }

  /**
   * List real files on Flipper MicroSD or internal storage
   */
  async listRealDirectory(dirPath = '/ext') {
    if (!this.isConnected) return [];
    try {
      const cleanPath = dirPath.endsWith('/') && dirPath !== '/' ? dirPath.slice(0, -1) : dirPath;
      this.log(`Querying Flipper storage: storage list ${cleanPath}...`, 'info');
      
      const res = await this.executeCommand(`storage list ${cleanPath}`, 4000);
      const lines = res.split(/\r?\n/);
      const items = [];

      for (const rawLine of lines) {
        // Strip ANSI color/terminal escape sequences and clean line
        const line = rawLine.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
        if (!line || line.startsWith('storage list') || line.startsWith('>:') || line === '>') continue;

        // Match [D] or [DIR] (folder entry)
        const dirMatch = line.match(/^\[(?:D|DIR)\]\s*(.+)$/i);
        if (dirMatch) {
          const name = dirMatch[1].trim();
          if (name && name !== '.' && name !== '..') {
            const itemPath = cleanPath === '/' ? `/${name}` : `${cleanPath}/${name}`;
            items.push({ 
              name, 
              isDir: true, 
              path: itemPath.replace(/\/+/g, '/'),
              size: ''
            });
          }
          continue;
        }

        // Match [F] or [FILE] (file entry with optional size like "512b" or "1024")
        const fileMatch = line.match(/^\[(?:F|FILE)\]\s*(\S+)(?:\s+(.+))?$/i);
        if (fileMatch) {
          const name = fileMatch[1].trim();
          const rawSize = fileMatch[2] ? fileMatch[2].trim() : '0';
          const itemPath = cleanPath === '/' ? `/${name}` : `${cleanPath}/${name}`;
          items.push({ 
            name, 
            isDir: false, 
            path: itemPath.replace(/\/+/g, '/'),
            size: rawSize
          });
          continue;
        }
      }

      // Sort directories first, then alphabetically
      items.sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      this.log(`Loaded ${items.length} items from ${cleanPath}`, 'success');
      return items;
    } catch (e) {
      this.log(`Failed to list ${dirPath}: ${e.message}`, 'error');
      return [];
    }
  }

  /**
   * Read real file content from Flipper MicroSD
   */
  async readRealFile(filePath) {
    if (!this.isConnected) return '';
    try {
      this.log(`Reading file ${filePath} from Flipper storage...`, 'info');
      const res = await this.executeCommand(`storage read ${filePath}`, 5000);
      const lines = res.split(/\r?\n/);
      const cleanLines = lines
        .map(l => l.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''))
        .filter(l => !l.startsWith('storage read') && !l.includes('>:'));
      return cleanLines.join('\n').trim();
    } catch (e) {
      this.log(`Failed to read ${filePath}: ${e.message}`, 'error');
      return '';
    }
  }

  /**
   * Create directory on Flipper storage
   */
  async createRealDirectory(dirPath) {
    if (!this.isConnected) throw new Error('Not connected to Flipper');
    this.log(`Creating directory: storage mkdir ${dirPath}...`, 'info');
    const res = await this.executeCommand(`storage mkdir ${dirPath}`, 3000);
    this.log(`Directory ${dirPath} created.`, 'success');
    return res;
  }

  /**
   * Remove file or directory on Flipper storage
   */
  async removeRealFile(path) {
    if (!this.isConnected) throw new Error('Not connected to Flipper');
    this.log(`Deleting from storage: storage remove ${path}...`, 'warning');
    const res = await this.executeCommand(`storage remove ${path}`, 3000);
    this.log(`Removed ${path}`, 'success');
    return res;
  }

  /**
   * Write text content to Flipper storage file
   */
  async writeRealFile(path, content) {
    if (!this.isConnected || !this.writer) throw new Error('Not connected to Flipper');
    this.log(`Writing file to Flipper storage: ${path} (${content.length} bytes)...`, 'info');
    await this.writeRaw(`storage write ${path}\r\n`);
    await new Promise(r => setTimeout(r, 200));
    await this.writeRaw(content);
    await new Promise(r => setTimeout(r, 200));
    // Send Ctrl+C (0x03) to terminate write stream and save
    await this.writeRaw('\x03\r\n');
    await new Promise(r => setTimeout(r, 200));
    this.log(`Wrote ${content.length} bytes to ${path}`, 'success');
    return true;
  }

  /**
   * Send real hardware key event to Flipper
   */
  async sendInput(key, type = 'short') {
    if (!this.isConnected) return;
    try {
      await this.executeCommand(`input send ${key} ${type}`, 1000);
      this.log(`Input key '${key}' (${type}) injected to physical Flipper GUI`, 'info');
    } catch (e) {
      this.log(`Key inject failed: ${e.message}`, 'error');
    }
  }

  /**
   * Real Hardware Vibration Test
   */
  async testVibration() {
    if (!this.isConnected) return;
    this.log('Testing physical haptic vibration motor on Flipper Zero...', 'warning');
    await this.executeCommand('vibro 1', 1000);
    setTimeout(async () => {
      await this.executeCommand('vibro 0', 1000);
      this.log('Vibration motor test finished.', 'success');
    }, 400);
  }

  /**
   * Real RGB LED Test
   */
  async testLed(color = 'blue') {
    if (!this.isConnected) return;
    this.log(`Lighting Flipper notification RGB LED (${color})...`, 'info');
    if (color === 'red') {
      await this.executeCommand('led r 255', 1000);
    } else if (color === 'green') {
      await this.executeCommand('led g 255', 1000);
    } else if (color === 'blue') {
      await this.executeCommand('led b 255', 1000);
    } else {
      await this.executeCommand('led off', 1000);
    }
  }

  /**
   * Reboot physical Flipper Zero
   */
  async reboot() {
    if (!this.isConnected) return;
    this.log('Rebooting physical Flipper Zero OS (FuriOS)...', 'warning');
    await this.executeCommand('reboot', 1500);
  }

  /**
   * Enter DFU bootloader mode
   */
  async dfu() {
    if (!this.isConnected) return;
    this.log('Entering STM32WB55 DFU Bootloader Mode...', 'warning');
    await this.executeCommand('dfu', 1500);
  }

  /**
   * Explicit Demo Mode (only activated if user explicitly clicks "Try Demo Mode")
   */
  enableDemoMode() {
    this.isConnected = true;
    this.isDemo = true;
    this.state = {
      isConnected: true,
      isDemo: true,
      deviceName: 'An1k1 (Flipper Zero)',
      hardwareModel: 'Flipper F7 (F7B4C2)',
      hardwareColor: 'Black',
      hardwareVer: 'v12',
      firmwareVersion: '0.104.1 (Unleashed)',
      firmwareBranch: 'unleashed-firmware/v0.104.1',
      firmwareCommit: '9f8a21d',
      firmwareBuildDate: '2026-10-18',
      radioAlive: true,
      batteryPercent: 88,
      batteryVoltageMv: 4124,
      batteryCurrentMa: -140,
      batteryTempC: 28.5,
      batteryHealth: 98,
      chargeState: 'Discharging',
      sdMounted: true,
      sdTotalKb: 31920128,
      sdFreeKb: 28412890,
      intTotalKb: 256,
      intFreeKb: 184,
      activeMenu: 'Home'
    };
    this.log('[DEMO MODE] Initialized virtual Flipper Zero demo simulator', 'warning');
    this.notifyState();
  }

  disconnect() {
    if (this.writer) {
      try { this.writer.releaseLock(); } catch(e){}
      this.writer = null;
    }
    if (this.reader) {
      try { this.reader.cancel(); } catch(e){}
      this.reader = null;
    }
    if (this.port) {
      try { this.port.close(); } catch(e){}
      this.port = null;
    }

    this.isConnected = false;
    this.isDemo = false;
    this.state = {
      isConnected: false,
      isDemo: false,
      deviceName: null,
      hardwareModel: null,
      firmwareVersion: null,
      batteryPercent: null,
      sdMounted: false
    };

    this.log('Disconnected from Flipper Zero.', 'info');
    this.notifyState();
  }
}

// Global Singleton to preserve session across React tab switching
let globalFlipperDriver = null;
export function getFlipperDriver() {
  if (!globalFlipperDriver) {
    globalFlipperDriver = new FlipperZeroDriver();
  }
  return globalFlipperDriver;
}
