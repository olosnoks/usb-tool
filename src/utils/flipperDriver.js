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

// Protobuf Varint Helpers
function readVarint(bytes, offset = 0) {
  let res = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < bytes.length) {
    const b = bytes[offset + bytesRead];
    bytesRead++;
    res |= (b & 0x7F) << shift;
    if ((b & 0x80) === 0) {
      return { value: res, bytesRead };
    }
    shift += 7;
  }
  return null;
}

function writeVarint(val) {
  const bytes = [];
  let n = val;
  while (n >= 0x80) {
    bytes.push((n & 0x7F) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return bytes;
}

export class FlipperZeroDriver {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.isDemo = false;

    // RPC Screen Stream State
    this.isRpcMode = false;
    this.isScreenStreaming = false;
    this.rpcAccumulator = new Uint8Array(0);
    this.rpcCommandId = 1;

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
      hardwareVer: null,
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

    // Start raw binary serial reader in background (handles both CLI text and RPC binary)
    this.startSerialReader();

    // Wake up Flipper CLI shell
    await this.writeRaw('\r\n');
    await new Promise(r => setTimeout(r, 200));

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

  /**
   * Reads raw binary stream from Web Serial port.
   * If in RPC mode, dispatches raw bytes to protobuf frame decoder.
   * If in CLI mode, decodes UTF-8 text and dispatches to CLI accumulator.
   */
  async startSerialReader() {
    this.reader = this.port.readable.getReader();
    const textDecoder = new TextDecoder();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) {
          if (this.isRpcMode) {
            this.handleRpcChunk(value);
          } else {
            const text = textDecoder.decode(value, { stream: true });
            this.handleSerialChunk(text);
          }
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

    // Check if CLI prompt `>: ` has arrived to resolve pending CLI commands
    if (this.pendingCommandResolve) {
      const cleanAccum = this.commandAccumulator.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      if (cleanAccum.endsWith('>: ') || cleanAccum.endsWith('>:') || cleanAccum.includes('\n>: ') || cleanAccum.includes('\r\n>:')) {
        const fullResponse = cleanAccum;
        this.commandAccumulator = '';
        this.incomingBuffer = '';
        const resolve = this.pendingCommandResolve;
        this.pendingCommandResolve = null;
        this.pendingCommandReject = null;
        resolve(fullResponse);
      }
    }
  }

  async writeRaw(text) {
    if (!this.writer) throw new Error('Not connected to Flipper Zero');
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(text));
  }

  async writeBinary(uint8Array) {
    if (!this.writer) throw new Error('Not connected to Flipper Zero');
    await this.writer.write(uint8Array);
  }

  /**
   * Execute a CLI command and wait for response prompt
   */
  async executeCommand(cmd, timeoutMs = 4000) {
    if (!this.isConnected || !this.writer) {
      throw new Error('No physical Flipper Zero connected.');
    }

    // If currently in RPC screen stream mode, temporarily stop it to execute text CLI command
    if (this.isRpcMode) {
      await this.stopScreenStream();
    }

    this.log(`> ${cmd}`, 'tx');
    this.commandAccumulator = '';
    this.incomingBuffer = '';

    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCommandResolve) {
          const resp = this.commandAccumulator.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') || this.incomingBuffer;
          this.pendingCommandResolve = null;
          this.pendingCommandReject = null;
          this.commandAccumulator = '';
          this.incomingBuffer = '';
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

    // 1. Device Info (try 'device_info', fallback to 'info device' for Momentum / modern FW)
    try {
      let devRes = await this.executeCommand('device_info', 3000);
      this.parseDeviceInfo(devRes);
      if (!this.state.deviceName || !this.state.firmwareVersion) {
        devRes = await this.executeCommand('info device', 3000);
        this.parseDeviceInfo(devRes);
      }
    } catch (e) {
      console.warn('device_info failed:', e);
    }

    // 2. Power Info (try 'power info', fallback to 'info power', fallback to 'power')
    try {
      let pwrRes = await this.executeCommand('power info', 3000);
      this.parsePowerInfo(pwrRes);
      if (this.state.batteryPercent === null) {
        pwrRes = await this.executeCommand('info power', 3000);
        this.parsePowerInfo(pwrRes);
      }
      if (this.state.batteryPercent === null) {
        pwrRes = await this.executeCommand('power', 3000);
        this.parsePowerInfo(pwrRes);
      }
    } catch (e) {
      console.warn('power info failed:', e);
    }

    // 3. Storage Info (/ext)
    try {
      const sdRes = await this.executeCommand('storage info /ext', 3500);
      this.parseStorageExt(sdRes);
    } catch (e) {
      console.warn('storage info /ext failed:', e);
    }

    // 4. Storage Info (/int)
    try {
      const intRes = await this.executeCommand('storage info /int', 3500);
      this.parseStorageInt(intRes);
    } catch (e) {
      console.warn('storage info /int failed:', e);
    }

    this.notifyState();
  }

  parseDeviceInfo(output) {
    if (!output) return;
    const cleanOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const lines = cleanOutput.split(/\r?\n/);

    lines.forEach(l => {
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('device_info') || trimmed.startsWith('info device')) return;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return;

      const k = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const v = trimmed.slice(colonIdx + 1).trim();
      if (!v) return;

      // Model & Hardware
      if (k === 'hardware_model' || k === 'model' || k === 'hardware' || k === 'target') {
        this.state.hardwareModel = v;
      }
      // Color
      if (k === 'hardware_color' || k === 'color') {
        this.state.hardwareColor = (v === '1' || v.toLowerCase().includes('black')) ? 'Black' : (v.toLowerCase().includes('transp') ? 'Transparent' : 'White');
      }
      // Hardware Version
      if (k === 'hardware_ver' || k === 'hardware version' || k === 'rev') {
        this.state.hardwareVer = v.startsWith('v') ? v : `v${v}`;
      }
      // Firmware Version & Commit
      if (k === 'firmware_version' || k === 'firmware' || k === 'fw') {
        this.state.firmwareVersion = v;
      }
      if (k === 'firmware_branch' || k === 'branch') {
        this.state.firmwareBranch = v;
      }
      if (k === 'firmware_commit' || k === 'commit') {
        this.state.firmwareCommit = v;
      }
      if (k === 'firmware_build_date' || k === 'build date') {
        this.state.firmwareBuildDate = v;
      }
      if (k === 'radio_alive' || k === 'radio fw' || k === 'radio') {
        this.state.radioAlive = v.toLowerCase().includes('true') || v.length > 0;
      }
      // Device Name
      if (k === 'device_name' || k === 'name' || k === 'ble_name') {
        this.state.deviceName = v;
      }
    });

    if (this.state.deviceName) {
      this.log(`[Device] Identified Flipper: "${this.state.deviceName}" (${this.state.hardwareModel || 'F7'}, FW: ${this.state.firmwareVersion || 'FuriOS'})`, 'success');
    }
  }

  parsePowerInfo(output) {
    if (!output) return;
    const cleanOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const lines = cleanOutput.split(/\r?\n/);

    lines.forEach(l => {
      const trimmed = l.trim();
      if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('power')) return;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return;

      const k = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const v = trimmed.slice(colonIdx + 1).trim();

      // Battery percentage
      if (k.includes('charge_level') || k.includes('battery_charge') || k.includes('level') || k.includes('state of charge')) {
        const match = v.match(/(\d+)/);
        if (match) this.state.batteryPercent = parseInt(match[1]);
      }
      // Voltage
      if (k.includes('voltage') || k.includes('battery_voltage') || k.includes('vbat')) {
        const match = v.match(/(\d+)/);
        if (match) this.state.batteryVoltageMv = parseInt(match[1]);
      }
      // Current
      if (k.includes('current') || k.includes('battery_current')) {
        const match = v.match(/(-?\d+)/);
        if (match) this.state.batteryCurrentMa = parseInt(match[1]);
      }
      // Temperature
      if (k.includes('temp') || k.includes('gauge_temp') || k.includes('temperature')) {
        const match = v.match(/(\d+(?:\.\d+)?)/);
        if (match) this.state.batteryTempC = parseFloat(match[1]);
      }
      // Health
      if (k.includes('health') || k.includes('state of health')) {
        const match = v.match(/(\d+)/);
        if (match) this.state.batteryHealth = parseInt(match[1]);
      }
      // Charge state
      if (k.includes('charge_state') || k === 'state') {
        this.state.chargeState = v;
      }
    });

    if (this.state.batteryPercent !== null) {
      this.log(`[Power] Battery: ${this.state.batteryPercent}% (${this.state.batteryVoltageMv || '--'} mV, ${this.state.batteryTempC || '--'}°C)`, 'info');
    }
  }

  parseStorageExt(output) {
    if (!output) return;
    const cleanOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const lines = cleanOutput.split(/\r?\n/);

    lines.forEach(l => {
      const trimmed = l.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return;

      const k = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const v = trimmed.slice(colonIdx + 1).trim();

      if (k.includes('total space') || k.includes('total')) {
        const match = v.match(/(\d+)/);
        if (match) {
          let num = parseInt(match[1]);
          if (num > 100000000) num = Math.round(num / 1024);
          this.state.sdTotalKb = num;
        }
      }
      if (k.includes('free space') || k.includes('free')) {
        const match = v.match(/(\d+)/);
        if (match) {
          let num = parseInt(match[1]);
          if (num > 100000000) num = Math.round(num / 1024);
          this.state.sdFreeKb = num;
          this.state.sdMounted = true;
        }
      }
    });

    if (this.state.sdMounted && this.state.sdTotalKb) {
      this.log(`[Storage] MicroSD mounted: ${(this.state.sdFreeKb / 1024 / 1024).toFixed(1)} GB Free of ${(this.state.sdTotalKb / 1024 / 1024).toFixed(1)} GB`, 'info');
    }
  }

  parseStorageInt(output) {
    if (!output) return;
    const cleanOutput = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
    const lines = cleanOutput.split(/\r?\n/);

    lines.forEach(l => {
      const trimmed = l.trim();
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx === -1) return;

      const k = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const v = trimmed.slice(colonIdx + 1).trim();

      if (k.includes('total space') || k.includes('total')) {
        const match = v.match(/(\d+)/);
        if (match) this.state.intTotalKb = parseInt(match[1]);
      }
      if (k.includes('free space') || k.includes('free')) {
        const match = v.match(/(\d+)/);
        if (match) this.state.intFreeKb = parseInt(match[1]);
      }
    });
  }

  // ==========================================
  // PROTOBUF RPC REAL SCREEN STREAMING
  // ==========================================

  /**
   * Start live Protobuf RPC screen streaming session (128x64 display frames)
   */
  async startScreenStream() {
    if (!this.isConnected || !this.writer) return false;
    if (this.isRpcMode && this.isScreenStreaming) return true;

    try {
      this.log('[Screen] Initializing Protobuf RPC Screen Stream session...', 'info');

      if (!this.isRpcMode) {
        // Send command to transition CLI to Protobuf RPC mode
        await this.writeRaw('start_rpc_session\r\n');
        this.isRpcMode = true;
        this.rpcAccumulator = new Uint8Array(0);
        await new Promise(r => setTimeout(r, 150));
      }

      // Send GuiStartScreenStreamRequest:
      // PB.Main envelope:
      // - field 1 (command_id = 1): tag 0x08, val 0x01
      // - field 20 (.PB_Gui.StartScreenStreamRequest gui_start_screen_stream_request): tag (20<<3)|2 = 162 = [0xA2, 0x01], len 0 = 0x00
      // Envelope length = 5 bytes -> length varint = 0x05
      const packet = new Uint8Array([0x05, 0x08, 0x01, 0xa2, 0x01, 0x00]);
      await this.writeBinary(packet);

      this.isScreenStreaming = true;
      this.log('[Screen] Live Screen Stream started! Receiving 128x64 LCD frames...', 'success');
      return true;
    } catch (e) {
      this.log(`[Screen] Failed to start screen stream: ${e.message}`, 'error');
      return false;
    }
  }

  /**
   * Stop live Protobuf RPC screen streaming session and return to CLI mode
   */
  async stopScreenStream() {
    if (!this.isConnected || !this.isRpcMode) return;

    try {
      this.log('[Screen] Stopping RPC Screen Stream session...', 'info');
      // GuiStopScreenStreamRequest = 21: tag (21<<3)|2 = 170 = [0xAA, 0x01], len 0 = 0x00
      const stopStreamPkt = new Uint8Array([0x05, 0x08, 0x02, 0xaa, 0x01, 0x00]);
      await this.writeBinary(stopStreamPkt);
      await new Promise(r => setTimeout(r, 100));

      // StopSession = 19: tag (19<<3)|2 = 154 = [0x9A, 0x01], len 0 = 0x00
      const stopSessionPkt = new Uint8Array([0x05, 0x08, 0x03, 0x9a, 0x01, 0x00]);
      await this.writeBinary(stopSessionPkt);
      await new Promise(r => setTimeout(r, 150));

      this.isRpcMode = false;
      this.isScreenStreaming = false;
      this.rpcAccumulator = new Uint8Array(0);

      // Restore CLI shell prompt
      await this.writeRaw('\r\n');
      this.log('[Screen] Stream stopped. Restored Flipper CLI shell.', 'info');
    } catch (e) {
      console.warn('Error stopping screen stream:', e);
      this.isRpcMode = false;
      this.isScreenStreaming = false;
    }
  }

  /**
   * Handle incoming raw binary chunks while in RPC mode
   */
  handleRpcChunk(chunk) {
    if (!chunk || chunk.length === 0) return;

    // Append chunk to binary accumulator
    const combined = new Uint8Array(this.rpcAccumulator.length + chunk.length);
    combined.set(this.rpcAccumulator, 0);
    combined.set(chunk, this.rpcAccumulator.length);
    this.rpcAccumulator = combined;

    // Parse all complete length-delimited protobuf packets
    while (this.rpcAccumulator.length > 0) {
      const lenInfo = readVarint(this.rpcAccumulator, 0);
      if (!lenInfo) break;

      const msgLen = lenInfo.value;
      const lenBytes = lenInfo.bytesRead;

      if (this.rpcAccumulator.length < lenBytes + msgLen) {
        // Wait for remainder of this packet
        break;
      }

      const msgBytes = this.rpcAccumulator.subarray(lenBytes, lenBytes + msgLen);
      this.rpcAccumulator = this.rpcAccumulator.slice(lenBytes + msgLen);

      this.parseRpcMessage(msgBytes);
    }
  }

  /**
   * Parse PB.Main protobuf packet
   */
  parseRpcMessage(msgBytes) {
    let offset = 0;
    while (offset < msgBytes.length) {
      const tagInfo = readVarint(msgBytes, offset);
      if (!tagInfo) break;
      offset += tagInfo.bytesRead;
      const tag = tagInfo.value;
      const fieldNum = tag >>> 3;
      const wireType = tag & 0x07;

      if (wireType === 0) { // varint
        const vInfo = readVarint(msgBytes, offset);
        if (!vInfo) break;
        offset += vInfo.bytesRead;
      } else if (wireType === 2) { // length-delimited
        const lenInfo = readVarint(msgBytes, offset);
        if (!lenInfo) break;
        offset += lenInfo.bytesRead;
        const fieldLen = lenInfo.value;
        const fieldData = msgBytes.subarray(offset, offset + fieldLen);
        offset += fieldLen;

        // field 22: .PB_Gui.ScreenFrame gui_screen_frame
        if (fieldNum === 22) {
          this.parseScreenFrame(fieldData);
        }
      } else if (wireType === 1) {
        offset += 8;
      } else if (wireType === 5) {
        offset += 4;
      } else {
        break;
      }
    }
  }

  /**
   * Extract 1024-byte display framebuffer from PB_Gui.ScreenFrame
   */
  parseScreenFrame(frameData) {
    let offset = 0;
    while (offset < frameData.length) {
      const tagInfo = readVarint(frameData, offset);
      if (!tagInfo) break;
      offset += tagInfo.bytesRead;
      const fieldNum = tagInfo.value >>> 3;
      const wireType = tagInfo.value & 0x07;

      if (wireType === 2) {
        const lenInfo = readVarint(frameData, offset);
        if (!lenInfo) break;
        offset += lenInfo.bytesRead;
        const dataLen = lenInfo.value;
        const dataBytes = frameData.subarray(offset, offset + dataLen);
        offset += dataLen;

        // Field 1: bytes data (1024 bytes for 128x64 display)
        if (fieldNum === 1 && dataLen === 1024) {
          this.state.screenBuffer = new Uint8Array(dataBytes);
          if (this.onScreenUpdateCallback) {
            this.onScreenUpdateCallback(this.state.screenBuffer);
          }
        }
      } else if (wireType === 0) {
        const vInfo = readVarint(frameData, offset);
        if (!vInfo) break;
        offset += vInfo.bytesRead;
      } else {
        break;
      }
    }
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
   * Works in both Protobuf RPC screen streaming mode and CLI shell mode
   */
  async sendInput(key, type = 'short') {
    if (!this.isConnected) return;

    if (this.isRpcMode) {
      // In RPC mode, send PB_Gui.SendInputEventRequest
      const keyMap = { 'up': 0, 'down': 1, 'right': 2, 'left': 3, 'ok': 4, 'back': 5 };
      const typeMap = { 'press': 0, 'release': 1, 'short': 2, 'long': 3, 'repeat': 4 };
      const kVal = keyMap[key.toLowerCase()] ?? 4;
      const tVal = typeMap[type.toLowerCase()] ?? 2;

      // Sub-message SendInputEventRequest: [0x08, kVal, 0x10, tVal]
      const subMsg = [0x08, kVal, 0x10, tVal];
      // Main: command_id = 5 (tag 0x08 0x05), tag 23 gui_send_input_event_request (tag 0xBA 0x01, len 4)
      const mainPayload = [0x08, 0x05, 0xba, 0x01, subMsg.length, ...subMsg];
      const packet = new Uint8Array([mainPayload.length, ...mainPayload]);

      try {
        await this.writeBinary(packet);
        this.log(`[Input] Injected '${key.toUpperCase()}' (${type}) via RPC`, 'info');
      } catch (e) {
        console.warn('RPC input send error:', e);
      }
    } else {
      // In CLI mode, send 'input send <key> <type>'
      try {
        await this.executeCommand(`input send ${key} ${type}`, 1000);
        this.log(`Input key '${key}' (${type}) injected to physical Flipper GUI`, 'info');
      } catch (e) {
        this.log(`Key inject failed: ${e.message}`, 'error');
      }
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
    if (this.isScreenStreaming || this.isRpcMode) {
      this.isRpcMode = false;
      this.isScreenStreaming = false;
      this.rpcAccumulator = new Uint8Array(0);
    }

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
      hardwareColor: null,
      firmwareVersion: null,
      batteryPercent: null,
      sdMounted: false,
      screenBuffer: null
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
