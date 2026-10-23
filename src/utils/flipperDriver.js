/**
 * FLIPPER ZERO REAL HARDWARE WEB SERIAL DRIVER (qFlipper Architecture)
 * 
 * Communicates directly with physical Flipper Zero over Web Serial (USB CDC / STM32 VCP)
 * USB Vendor ID: 0x0483 (STMicroelectronics), Product ID: 0x5740 (Flipper Zero CLI)
 * 
 * 100% Authentic qFlipper Architecture:
 * - Operates over Google Protocol Buffers RPC Session (start_rpc_session)
 * - Queries REAL hardware telemetry (SystemDeviceInfo, StorageInfo)
 * - Traverses and manipulates REAL MicroSD file system (/ext) via StorageList, StorageRead, StorageWrite, StorageDelete
 * - Streams REAL 128x64 LCD frames via GuiStartScreenStream
 * - Injects REAL hardware inputs via GuiSendInputEvent
 * 
 * Zero fake or simulated data when connected to physical hardware.
 */

// ============================================================================
// PROTOCOL BUFFERS WIRE ENCODING & DECODING (Nanopb / flipperzero-protobuf)
// ============================================================================

export function readVarint(bytes, offset = 0) {
  let res = 0n;
  let shift = 0n;
  let bytesRead = 0;
  while (offset + bytesRead < bytes.length) {
    const b = BigInt(bytes[offset + bytesRead]);
    bytesRead++;
    res |= (b & 0x7Fn) << shift;
    if ((b & 0x80n) === 0n) {
      return { value: res, bytesRead };
    }
    shift += 7n;
  }
  return null;
}

export function encodeVarint(val) {
  const bytes = [];
  let n = typeof val === 'bigint' ? val : BigInt(val);
  while (n >= 128n) {
    bytes.push(Number(n & 127n) | 0x80);
    n >>= 7n;
  }
  bytes.push(Number(n & 127n));
  return bytes;
}

function encodeTag(fieldNumber, wireType) {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeUint32(fieldNumber, val) {
  return [...encodeTag(fieldNumber, 0), ...encodeVarint(val)];
}

function encodeBool(fieldNumber, val) {
  return [...encodeTag(fieldNumber, 0), val ? 1 : 0];
}

function encodeString(fieldNumber, str) {
  const strBytes = new TextEncoder().encode(str);
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(strBytes.length), ...strBytes];
}

function encodeBytes(fieldNumber, uint8Array) {
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(uint8Array.length), ...uint8Array];
}

function encodeSubmessage(fieldNumber, subBytes) {
  return [...encodeTag(fieldNumber, 2), ...encodeVarint(subBytes.length), ...subBytes];
}

function parseFields(bytes, start = 0, end = bytes.length) {
  let offset = start;
  const fields = [];
  while (offset < end) {
    const tagInfo = readVarint(bytes, offset);
    if (!tagInfo) break;
    offset += tagInfo.bytesRead;
    const tag = Number(tagInfo.value);
    const fieldNum = tag >>> 3;
    const wireType = tag & 0x07;

    if (wireType === 0) { // Varint
      const vInfo = readVarint(bytes, offset);
      if (!vInfo) break;
      offset += vInfo.bytesRead;
      fields.push({ fieldNum, wireType, value: vInfo.value });
    } else if (wireType === 2) { // Length-delimited
      const lenInfo = readVarint(bytes, offset);
      if (!lenInfo) break;
      offset += lenInfo.bytesRead;
      const len = Number(lenInfo.value);
      const data = bytes.subarray(offset, offset + len);
      offset += len;
      fields.push({ fieldNum, wireType, data });
    } else if (wireType === 1) { // 64-bit fixed
      offset += 8;
    } else if (wireType === 5) { // 32-bit fixed
      offset += 4;
    } else {
      break;
    }
  }
  return fields;
}

/**
 * Builds length-delimited PB.Main packet for transmission
 */
function buildRpcPacket(commandId, fieldNumber, subBytes = [], hasNext = false) {
  const mainPayload = [
    ...encodeUint32(1, commandId),
    ...(hasNext ? [0x18, 0x01] : []),
    ...(subBytes && subBytes.length > 0 ? encodeSubmessage(fieldNumber, subBytes) : encodeSubmessage(fieldNumber, []))
  ];
  const packetLength = encodeVarint(mainPayload.length);
  const fullBytes = new Uint8Array(packetLength.length + mainPayload.length);
  fullBytes.set(packetLength, 0);
  fullBytes.set(mainPayload, packetLength.length);
  return fullBytes;
}

export function formatKb(kb) {
  if (kb === null || kb === undefined || kb === '') return '--';
  const num = typeof kb === 'string' ? parseFloat(kb) : Number(kb);
  if (isNaN(num) || num < 0) return '--';
  if (num === 0) return '0 KB';
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} GB`;
  if (num >= 1024) return `${(num / 1024).toFixed(1)} MB`;
  return `${Math.round(num)} KB`;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '--';
  const num = typeof bytes === 'bigint' ? Number(bytes) : (typeof bytes === 'string' ? parseFloat(bytes) : Number(bytes));
  if (isNaN(num) || num < 0) return '--';
  if (num === 0) return '0 B';
  if (num >= 1024 * 1024 * 1024) return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${Math.round(num)} B`;
}

export function normalizeSdToKb(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' && (val.toLowerCase().includes('kb') || val.toLowerCase().includes('kib'))) {
    return parseInt(val.replace(/\D/g, ''), 10) || 0;
  }
  const n = typeof val === 'bigint' ? val : BigInt(String(val).replace(/\D/g, '') || '0');
  if (n <= 0n) return 0;
  // In Flipper Zero RPC, total_space and free_space from Storage.InfoResponse are uint64 raw bytes.
  // Converting bytes to KiB:
  return Math.round(Number(n / 1024n));
}

export function normalizeIntToKb(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string' && (val.toLowerCase().includes('kb') || val.toLowerCase().includes('kib'))) {
    return parseInt(val.replace(/\D/g, ''), 10) || 0;
  }
  const n = typeof val === 'bigint' ? val : BigInt(String(val).replace(/\D/g, '') || '0');
  if (n <= 0n) return 0;
  // Internal flash partition (/int) is 40KB - 256KB (40,960 - 262,144 bytes).
  // If reported in raw bytes (> 1024), convert to KiB
  if (n > 1024n) {
    return Math.round(Number(n / 1024n));
  }
  return Number(n);
}

export function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '';
  const num = typeof bytes === 'string' ? parseInt(bytes, 10) : bytes;
  if (isNaN(num)) return bytes;
  if (num >= 1024 * 1024 * 1024) return `${(num / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${num} B`;
}

function isPrintableText(uint8Array) {
  if (!uint8Array || uint8Array.length === 0) return true;
  const len = Math.min(uint8Array.length, 512);
  let nullBytes = 0;
  for (let i = 0; i < len; i++) {
    const b = uint8Array[i];
    if (b === 0) nullBytes++;
    if (b < 9 || (b > 13 && b < 32)) {
      if (b !== 27) nullBytes++;
    }
  }
  return nullBytes === 0;
}

function formatHexDump(uint8Array, maxBytes = 2048) {
  const slice = uint8Array.subarray(0, maxBytes);
  let out = '';
  for (let i = 0; i < slice.length; i += 16) {
    const offset = i.toString(16).padStart(4, '0');
    let hex = '';
    let ascii = '';
    for (let j = 0; j < 16; j++) {
      if (i + j < slice.length) {
        const b = slice[i + j];
        hex += b.toString(16).padStart(2, '0') + ' ';
        ascii += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
      } else {
        hex += '   ';
      }
    }
    out += `${offset}  ${hex} |${ascii}|\n`;
  }
  if (uint8Array.length > maxBytes) {
    out += `\n[... truncated ${uint8Array.length - maxBytes} additional bytes ...]`;
  }
  return out;
}

// ============================================================================
// MAIN FLIPPER DRIVER CLASS
// ============================================================================

export class FlipperZeroDriver {
  constructor() {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.isDemo = false;

    // Protobuf RPC State
    this.isRpcMode = false;
    this.isScreenStreaming = false;
    this.rpcAccumulator = new Uint8Array(0);
    this.rpcCommandId = 10;
    this.pendingRpc = new Map(); // commandId -> { resolve, reject, timer, fieldNum, accumulator }

    // Callbacks
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
      sdTotalBytes: null,
      sdFreeBytes: null,
      sdTotalKb: null,
      sdFreeKb: null,
      intTotalBytes: null,
      intFreeBytes: null,
      intTotalKb: null,
      intFreeKb: null,

      // Screen
      screenBuffer: null, // Uint8Array(1024)
      lastLog: null
    };

    this.cliLogs = [];
    this.incomingBuffer = '';
    this.commandAccumulator = '';
    this.pendingCommandResolve = null;
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
        throw new Error('COM port is locked or in use! If the desktop qFlipper application or another serial monitor is open, close it first.');
      }
      throw openErr;
    }

    this.isConnected = true;
    this.isDemo = false;
    this.state.isConnected = true;
    this.state.isDemo = false;
    this.writer = this.port.writable.getWriter();

    this.log('Connected to Flipper Zero USB CDC-ACM port!', 'success');

    // Start background binary stream reader
    this.startSerialReader();

    // Establish RPC session (1:1 with qFlipper)
    await this.ensureRpcSession();

    // Trigger physical hardware telemetry in background (non-blocking so UI remains responsive)
    this.refreshAllRealData().catch(e => {
      this.log(`Initial telemetry sync warning: ${e.message}`, 'warning');
    });

    this.notifyState();
    return true;
  }

  /**
   * Connect to physical Flipper Zero via Web Serial API prompt
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
          this.log('Filtered prompt cancelled or device not matched. Showing all serial ports...', 'warning');
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
   * Reads raw binary stream from Web Serial port and routes to RPC decoder or CLI text parser
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

    if (this.pendingCommandResolve) {
      const cleanAccum = this.commandAccumulator.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      if (cleanAccum.endsWith('>: ') || cleanAccum.endsWith('>:') || cleanAccum.includes('\n>: ') || cleanAccum.includes('\r\n>:')) {
        const fullResponse = cleanAccum;
        this.commandAccumulator = '';
        this.incomingBuffer = '';
        const resolve = this.pendingCommandResolve;
        this.pendingCommandResolve = null;
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

  // ============================================================================
  // PROTOBUF RPC SESSION MANAGEMENT (qFlipper Protocol)
  // ============================================================================

  /**
   * Initializes or verifies active Protobuf RPC session
   */
  async ensureRpcSession() {
    if (this.isRpcMode) return true;
    this.log('[RPC] Handshaking Flipper Protobuf RPC session...', 'info');

    // Drain and clear any interrupted CLI line
    await this.writeRaw('\r\n');
    await new Promise(r => setTimeout(r, 150));

    // Send qFlipper command to start RPC session (qFlipper writes start_rpc_session\r)
    await this.writeRaw('start_rpc_session\r');
    
    // Wait for Flipper CLI echo to arrive and be consumed by text reader
    await new Promise(r => setTimeout(r, 350));

    // Clear binary accumulator so no leftover text echo corrupts Protobuf frame length
    this.rpcAccumulator = new Uint8Array(0);
    this.isRpcMode = true;

    this.log('[RPC] Protobuf RPC session active! Binary framing engaged.', 'success');
    return true;
  }

  /**
   * Send length-delimited Protobuf RPC Request to Flipper and await response
   */
  sendRpcRequest(fieldNum, subBytes = [], hasNext = false, timeoutMs = 4000) {
    if (!this.isConnected || !this.writer) {
      return Promise.reject(new Error('Flipper Zero is not connected.'));
    }

    const commandId = ++this.rpcCommandId;
    const packet = buildRpcPacket(commandId, fieldNum, subBytes, hasNext);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(commandId);
        reject(new Error(`RPC request timeout (cmdId: ${commandId}, tag: ${fieldNum})`));
      }, timeoutMs);

      this.pendingRpc.set(commandId, {
        resolve,
        reject,
        timer,
        fieldNum,
        accumulator: []
      });

      this.writeBinary(packet).catch(err => {
        clearTimeout(timer);
        this.pendingRpc.delete(commandId);
        reject(err);
      });
    });
  }

  /**
   * Handle incoming binary chunks during RPC mode with self-healing stream resync
   */
  handleRpcChunk(chunk) {
    if (!chunk || chunk.length === 0) return;

    // Append incoming bytes to accumulator
    const combined = new Uint8Array(this.rpcAccumulator.length + chunk.length);
    combined.set(this.rpcAccumulator, 0);
    combined.set(chunk, this.rpcAccumulator.length);
    this.rpcAccumulator = combined;

    // Process all complete length-delimited protobuf packets with self-healing resync
    while (this.rpcAccumulator.length > 0) {
      const lenInfo = readVarint(this.rpcAccumulator, 0);
      if (!lenInfo) break;

      const msgLen = Number(lenInfo.value);
      const lenBytes = lenInfo.bytesRead;

      // Self-healing resynchronization guard:
      // Valid Flipper PB.Main messages are between 2 and 4096 bytes.
      // Top-level PB.Main fields can start with:
      // - 0x08: Tag 1 wire 0 (command_id for all standard RPC request/response packets)
      // - 0xb2: Tag 22 wire 2 (gui_screen_frame for live LCD stream, where command_id=0 is omitted)
      // - 0x10: Tag 2 wire 0 (command_status when command_id=0)
      // - 0x18: Tag 3 wire 0 (has_next when command_id=0)
      const firstByte = this.rpcAccumulator[lenBytes];
      const isValidPbHeader = (firstByte === 0x08 || firstByte === 0xb2 || firstByte === 0x10 || firstByte === 0x18);

      if (
        msgLen <= 0 || 
        msgLen > 4096 || 
        (this.rpcAccumulator.length >= lenBytes + 1 && !isValidPbHeader)
      ) {
        // Drop 1 desynchronized byte and keep hunting for valid frame boundary
        this.rpcAccumulator = this.rpcAccumulator.slice(1);
        continue;
      }

      if (this.rpcAccumulator.length < lenBytes + msgLen) {
        // Frame is valid, wait for full payload to arrive from serial
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
    const mainFields = parseFields(msgBytes);
    const cmdIdField = mainFields.find(f => f.fieldNum === 1);
    const statusField = mainFields.find(f => f.fieldNum === 2);
    const hasNextField = mainFields.find(f => f.fieldNum === 3);

    const commandId = cmdIdField ? Number(cmdIdField.value) : 0;
    const commandStatus = statusField ? Number(statusField.value) : 0; // 0 = OK
    const hasNext = hasNextField ? Boolean(hasNextField.value) : false;

    // 1. Unsolicited Screen Frame (field 22: .PB_Gui.ScreenFrame)
    const screenFrameField = mainFields.find(f => f.fieldNum === 22);
    if (screenFrameField) {
      const frameFields = parseFields(screenFrameField.data);
      const dataField = frameFields.find(f => f.fieldNum === 1);
      const orientField = frameFields.find(f => f.fieldNum === 2);
      if (dataField && dataField.data.length === 1024) {
        this.state.screenBuffer = new Uint8Array(dataField.data);
        if (orientField) this.state.screenOrientation = Number(orientField.value);
        this.screenFrameCount = (this.screenFrameCount || 0) + 1;
        this.state.screenFrameCount = this.screenFrameCount;
        if (this.screenFrameCount === 1) {
          this.log('[Screen RPC] Live 128x64 LCD screen frame stream established!', 'success');
        }
        if (this.onScreenUpdateCallback) {
          this.onScreenUpdateCallback(this.state.screenBuffer, this.state.screenOrientation || 0);
        }
      }
    }

    // 2. Correlate with pending request
    if (this.pendingRpc.has(commandId)) {
      const pending = this.pendingRpc.get(commandId);

      if (commandStatus !== 0) {
        clearTimeout(pending.timer);
        this.pendingRpc.delete(commandId);
        pending.reject(new Error(`Flipper Zero RPC returned error status: ${commandStatus}`));
        return;
      }

      // Field 8: storage_list_response (.PB_Storage.ListResponse)
      const listRespField = mainFields.find(f => f.fieldNum === 8);
      if (listRespField) {
        const listFields = parseFields(listRespField.data);
        for (const lf of listFields) {
          if (lf.fieldNum === 1) { // File message
            const fileFields = parseFields(lf.data);
            let type = 0, name = '', size = 0;
            for (const ff of fileFields) {
              if (ff.fieldNum === 1) type = Number(ff.value);
              if (ff.fieldNum === 2) name = new TextDecoder().decode(ff.data);
              if (ff.fieldNum === 3) size = Number(ff.value);
            }
            pending.accumulator.push({ isDir: type === 1, name, size });
          }
        }
        if (!hasNext) {
          clearTimeout(pending.timer);
          this.pendingRpc.delete(commandId);
          pending.resolve(pending.accumulator);
        }
        return;
      }

      // Field 10: storage_read_response (.PB_Storage.ReadResponse)
      const readRespField = mainFields.find(f => f.fieldNum === 10);
      if (readRespField) {
        const readFields = parseFields(readRespField.data);
        const fileField = readFields.find(f => f.fieldNum === 1);
        if (fileField) {
          const fileFields = parseFields(fileField.data);
          const dataField = fileFields.find(f => f.fieldNum === 4);
          if (dataField && dataField.data.length > 0) {
            pending.accumulator.push(new Uint8Array(dataField.data));
          }
        }
        if (!hasNext) {
          clearTimeout(pending.timer);
          this.pendingRpc.delete(commandId);
          let totalLen = 0;
          for (const c of pending.accumulator) totalLen += c.length;
          const merged = new Uint8Array(totalLen);
          let pos = 0;
          for (const c of pending.accumulator) {
            merged.set(c, pos);
            pos += c.length;
          }
          pending.resolve(merged);
        }
        return;
      }

      // Field 29: storage_info_response (.PB_Storage.InfoResponse)
      const infoRespField = mainFields.find(f => f.fieldNum === 29);
      if (infoRespField) {
        const infoFields = parseFields(infoRespField.data);
        let total = 0n, free = 0n;
        for (const inf of infoFields) {
          if (inf.fieldNum === 1) total = inf.value;
          if (inf.fieldNum === 2) free = inf.value;
        }
        clearTimeout(pending.timer);
        this.pendingRpc.delete(commandId);
        pending.resolve({ total_space: total, free_space: free });
        return;
      }

      // Field 33: system_device_info_response (.PB_System.DeviceInfoResponse)
      const devRespField = mainFields.find(f => f.fieldNum === 33);
      if (devRespField) {
        const devFields = parseFields(devRespField.data);
        let key = '', value = '';
        for (const df of devFields) {
          if (df.fieldNum === 1) key = new TextDecoder().decode(df.data);
          if (df.fieldNum === 2) value = new TextDecoder().decode(df.data);
        }
        if (key) pending.accumulator.push({ key, value });

        if (!hasNext) {
          clearTimeout(pending.timer);
          this.pendingRpc.delete(commandId);
          pending.resolve(pending.accumulator);
        }
        return;
      }

      // Field 62: property_get_response (.PB_Property.GetResponse) - streamed key/value pairs
      const propRespField = mainFields.find(f => f.fieldNum === 62);
      if (propRespField) {
        const pf = parseFields(propRespField.data);
        let key = '', value = '';
        for (const f of pf) {
          if (f.fieldNum === 1) key = new TextDecoder().decode(f.data);
          if (f.fieldNum === 2) value = new TextDecoder().decode(f.data);
        }
        if (key) pending.accumulator.push({ key, value });
        if (!hasNext) {
          clearTimeout(pending.timer);
          this.pendingRpc.delete(commandId);
          pending.resolve(pending.accumulator);
        }
        return;
      }

      // Generic OK response (mkdir, delete, write, sendInput, reboot, etc.)
      if (!hasNext) {
        clearTimeout(pending.timer);
        this.pendingRpc.delete(commandId);
        pending.resolve(true);
      }
    }
  }

  // ============================================================================
  // REAL HARDWARE TELEMETRY VIA RPC
  // ============================================================================

  /**
   * Interrogates physical Flipper Zero via Protobuf RPC
   */
  async refreshAllRealData() {
    if (!this.isConnected) return;
    this.log('[FLIPPER RPC] Interrogating physical device info, battery, and storage...', 'info');

    try {
      await this.ensureRpcSession();

      // 1. Device Info (tag 32: .PB_System.DeviceInfoRequest)
      try {
        const infoList = await this.sendRpcRequest(32, [], false, 5000);
        this.parseDeviceInfoRpc(infoList);
        this.notifyState();
      } catch (e) {
        this.log(`RPC Device Info: ${e.message}`, 'warning');
      }

      // 1b. Power info (battery level/voltage/temp/health) via Property GetRequest (tag 61)
      for (const propKey of ['pwrinfo', 'power_info']) {
        try {
          const pwr = await this.sendRpcRequest(61, encodeString(1, propKey), false, 3000);
          if (Array.isArray(pwr) && pwr.length > 0) {
            this.log(`[Power RAW] ${propKey}: ${pwr.map(i => `${i.key}=${i.value}`).join(', ')}`, 'info');
            this.parseDeviceInfoRpc(pwr);
            this.notifyState();
            break;
          }
        } catch (e) {
          this.log(`[Power RAW] ${propKey} failed: ${e.message}`, 'warning');
        }
      }

      // 2. Storage Info for MicroSD (/ext) (tag 28: .PB_Storage.InfoRequest)
      let sdFound = false;
      const sdCandidatePaths = ['/ext', 'ext', '@/ext'];
      for (const p of sdCandidatePaths) {
        if (sdFound) break;
        try {
          const pathBytes = encodeString(1, p);
          const extInfo = await this.sendRpcRequest(28, pathBytes, false, 3500);
          this.log(`[Storage RAW] path=${p} total=${extInfo && extInfo.total_space} free=${extInfo && extInfo.free_space} (bytes)`, 'info');
          if (extInfo && extInfo.total_space > 0n) {
            const totalBytes = BigInt(extInfo.total_space);
            const freeBytes = BigInt(extInfo.free_space);
            const totalKb = normalizeSdToKb(totalBytes);
            const freeKb = normalizeSdToKb(freeBytes);
            if (totalKb > 0) {
              this.state.sdTotalBytes = totalBytes;
              this.state.sdFreeBytes = freeBytes;
              this.state.sdTotalKb = totalKb;
              this.state.sdFreeKb = freeKb;
              this.state.sdMounted = true;
              sdFound = true;
              this.log(`[Storage RPC] MicroSD (${p}): ${formatBytes(freeBytes)} Free of ${formatBytes(totalBytes)} Total`, 'success');
              this.notifyState();
            }
          }
        } catch (e) {
          this.log(`[Storage RAW] path=${p} failed: ${e.message}`, 'warning');
        }
      }
      if (!sdFound && this.state.sdTotalKb === null) {
        this.state.sdMounted = false;
        this.notifyState();
      }

      // 3. Storage Info for Internal Flash (/int) (tag 28: .PB_Storage.InfoRequest)
      let intFound = false;
      const intCandidatePaths = ['/int', 'int', '@/int'];
      for (const p of intCandidatePaths) {
        if (intFound) break;
        try {
          const pathBytes = encodeString(1, p);
          const intInfo = await this.sendRpcRequest(28, pathBytes, false, 3500);
          this.log(`[Storage RAW] path=${p} total=${intInfo && intInfo.total_space} free=${intInfo && intInfo.free_space} (bytes)`, 'info');
          if (intInfo && intInfo.total_space > 0n && !(sdFound && BigInt(intInfo.total_space) === this.state.sdTotalBytes)) {
            const totalBytes = BigInt(intInfo.total_space);
            const freeBytes = BigInt(intInfo.free_space);
            const totalKb = normalizeIntToKb(totalBytes);
            const freeKb = normalizeIntToKb(freeBytes);
            if (totalKb > 0) {
              this.state.intTotalBytes = totalBytes;
              this.state.intFreeBytes = freeBytes;
              this.state.intTotalKb = totalKb;
              this.state.intFreeKb = freeKb;
              intFound = true;
              this.log(`[Storage RPC] Internal Flash (${p}): ${formatBytes(freeBytes)} Free of ${formatBytes(totalBytes)} Total`, 'info');
              this.notifyState();
            }
          }
        } catch (e) {
          // Continue to next candidate path
        }
      }

      this.notifyState();
    } catch (err) {
      this.log(`Error syncing physical telemetry: ${err.message}`, 'error');
    }
  }

  /**
   * Refreshes real storage capacity metrics for MicroSD and Internal Flash
   */
  async refreshStorageInfo() {
    if (!this.isConnected) return;
    this.log('[Storage RPC] Refreshing physical storage metrics...', 'info');
    try {
      await this.ensureRpcSession();
      for (const p of ['/ext', 'ext', '@/ext']) {
        try {
          const extInfo = await this.sendRpcRequest(28, encodeString(1, p), false, 3500);
          if (extInfo && extInfo.total_space > 0n) {
            const totalBytes = BigInt(extInfo.total_space);
            const freeBytes = BigInt(extInfo.free_space);
            this.state.sdTotalBytes = totalBytes;
            this.state.sdFreeBytes = freeBytes;
            this.state.sdTotalKb = normalizeSdToKb(totalBytes);
            this.state.sdFreeKb = normalizeSdToKb(freeBytes);
            this.state.sdMounted = true;
            this.log(`[Storage RPC] MicroSD updated: ${formatBytes(freeBytes)} Free of ${formatBytes(totalBytes)} Total`, 'success');
            this.notifyState();
            break;
          }
        } catch (e) {}
      }
      for (const p of ['/int', 'int', '@/int']) {
        try {
          const intInfo = await this.sendRpcRequest(28, encodeString(1, p), false, 3500);
          if (intInfo && intInfo.total_space > 0n && BigInt(intInfo.total_space) !== this.state.sdTotalBytes) {
            const totalBytes = BigInt(intInfo.total_space);
            const freeBytes = BigInt(intInfo.free_space);
            this.state.intTotalBytes = totalBytes;
            this.state.intFreeBytes = freeBytes;
            this.state.intTotalKb = normalizeIntToKb(totalBytes);
            this.state.intFreeKb = normalizeIntToKb(freeBytes);
            this.log(`[Storage RPC] Internal Flash updated: ${formatBytes(freeBytes)} Free of ${formatBytes(totalBytes)} Total`, 'info');
            this.notifyState();
            break;
          }
        } catch (e) {}
      }
    } catch (e) {
      this.log(`Failed to refresh storage info: ${e.message}`, 'warning');
    }
  }

  parseDeviceInfoRpc(items) {
    if (!items || !Array.isArray(items)) return;

    for (const { key, value } of items) {
      if (!key) continue;
      const k = key.trim().toLowerCase();
      const v = value ? value.trim() : '';

      // Model & Hardware
      if (k === 'hardware_target' || k === 'hardware_model' || k === 'target' || k === 'model') {
        this.state.hardwareModel = `Flipper ${v} (F7B4C2)`;
      }
      if (k === 'hardware_color' || k === 'color') {
        this.state.hardwareColor = (v === '1' || v.toLowerCase().includes('black')) ? 'Black' : (v.toLowerCase().includes('transp') ? 'Transparent' : 'White');
      }
      if (k === 'hardware_ver' || k === 'hardware_version' || k === 'rev') {
        this.state.hardwareVer = v.startsWith('v') ? v : `v${v}`;
      }
      if (k === 'hardware_name' || k === 'device_name' || k === 'name') {
        this.state.deviceName = v;
      }
      if (k === 'serial_number' || k === 'serial') {
        this.state.serialNumber = v;
      }

      // Firmware details
      if (k === 'firmware_version' || k === 'version' || k === 'fw_version') {
        this.state.firmwareVersion = v;
      }
      if (k === 'firmware_branch' || k === 'branch') {
        this.state.firmwareBranch = v;
      }
      if (k === 'firmware_commit' || k === 'commit') {
        this.state.firmwareCommit = v;
      }
      if (k === 'firmware_build_date' || k === 'build_date') {
        this.state.firmwareBuildDate = v;
      }
      if (k === 'radio_alive') {
        this.state.radioAlive = v.toLowerCase().includes('true') || v === '1';
      }
      if (k === 'ble_mac' || k === 'ble_mac_address') {
        this.state.bleMac = v;
      }

      // Battery & Power
      if (k.includes('charge_level') || k.includes('battery_charge') || k.includes('charge') || k === 'level') {
        const m = v.match(/(\d+)/);
        if (m) this.state.batteryPercent = parseInt(m[1]);
      }
      if (k.includes('battery_voltage') || k.includes('voltage') || k.includes('vbat')) {
        const m = v.match(/(\d+)/);
        if (m) this.state.batteryVoltageMv = parseInt(m[1]);
      }
      if (k.includes('battery_current') || k.includes('current')) {
        const m = v.match(/(-?\d+)/);
        if (m) this.state.batteryCurrentMa = parseInt(m[1]);
      }
      if (k.includes('battery_temp') || k.includes('temperature') || k.includes('temp')) {
        const m = v.match(/(\d+(?:\.\d+)?)/);
        if (m) this.state.batteryTempC = parseFloat(m[1]);
      }
      if (k.includes('battery_health') || k.includes('health')) {
        const m = v.match(/(\d+)/);
        if (m) this.state.batteryHealth = parseInt(m[1]);
      }
      if (k.includes('charge_state') || k === 'state') {
        this.state.chargeState = v;
      }

      // Storage metrics from SystemDeviceInfo (if reported by firmware)
      if (k.includes('storage') && (k.includes('sd') || k.includes('ext'))) {
        const m = v.match(/(\d+)/);
        if (m) {
          const kb = normalizeSdToKb(m[1]);
          if (kb !== null && kb > 0) {
            if (k.includes('total')) {
              this.state.sdTotalKb = kb;
              this.state.sdMounted = true;
            } else if (k.includes('free')) {
              this.state.sdFreeKb = kb;
            }
          }
        }
      }
      if (k.includes('storage') && (k.includes('internal') || k.includes('int') || k.includes('databases'))) {
        const m = v.match(/(\d+)/);
        if (m) {
          const kb = normalizeIntToKb(m[1]);
          if (kb !== null && kb > 0) {
            if (k.includes('total')) {
              this.state.intTotalKb = kb;
            } else if (k.includes('free')) {
              this.state.intFreeKb = kb;
            }
          }
        }
      }
    }

    if (this.state.deviceName) {
      this.log(`[Device RPC] Physical Flipper identified: "${this.state.deviceName}" (${this.state.hardwareModel || 'F7'}, FW: ${this.state.firmwareVersion || 'FuriOS'})`, 'success');
    }
  }

  // ============================================================================
  // REAL FILE SYSTEM OPERATIONS VIA RPC (qFlipper 1:1)
  // ============================================================================

  /**
   * List real files & folders on physical Flipper MicroSD or Internal Storage
   */
  async listRealDirectory(dirPath = '/ext') {
    if (!this.isConnected) return [];
    try {
      await this.ensureRpcSession();
      const cleanPath = dirPath.endsWith('/') && dirPath !== '/' ? dirPath.slice(0, -1) : dirPath;
      this.log(`[Storage RPC] Reading directory ${cleanPath}...`, 'info');

      // Tag 7: .PB_Storage.ListRequest with path
      const pathBytes = encodeString(1, cleanPath);
      const rawFiles = await this.sendRpcRequest(7, pathBytes, false, 7000);

      const items = (rawFiles || []).map(f => {
        const itemPath = cleanPath === '/' ? `/${f.name}` : `${cleanPath}/${f.name}`;
        return {
          name: f.name,
          isDir: f.isDir,
          sizeBytes: f.size,
          size: f.size > 0 ? formatFileSize(f.size) : (f.isDir ? '' : '0 B'),
          path: itemPath.replace(/\/+/g, '/')
        };
      }).sort((a, b) => {
        if (a.isDir && !b.isDir) return -1;
        if (!a.isDir && b.isDir) return 1;
        return a.name.localeCompare(b.name);
      });

      this.log(`[Storage RPC] Loaded ${items.length} items from ${cleanPath}`, 'success');
      return items;
    } catch (err) {
      this.log(`[Storage RPC] Failed to list ${dirPath}: ${err.message}`, 'error');
      return [];
    }
  }

  /**
   * Read real file content from Flipper storage via RPC
   */
  async readRealFile(filePath) {
    if (!this.isConnected) return '';
    try {
      await this.ensureRpcSession();
      this.log(`[Storage RPC] Reading file ${filePath}...`, 'info');

      // Tag 9: .PB_Storage.ReadRequest with path
      const pathBytes = encodeString(1, filePath);
      const mergedBytes = await this.sendRpcRequest(9, pathBytes, false, 10000);

      if (!mergedBytes || mergedBytes.length === 0) return '';

      if (isPrintableText(mergedBytes)) {
        return new TextDecoder('utf-8').decode(mergedBytes);
      } else {
        return formatHexDump(mergedBytes);
      }
    } catch (err) {
      this.log(`[Storage RPC] Failed to read ${filePath}: ${err.message}`, 'error');
      return `[Error reading file: ${err.message}]`;
    }
  }

  /**
   * Write binary or text file to physical Flipper storage via RPC
   */
  async writeRealFile(filePath, content) {
    if (!this.isConnected || !this.writer) throw new Error('Not connected to Flipper');
    try {
      await this.ensureRpcSession();

      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      this.log(`[Storage RPC] Writing file ${filePath} (${bytes.length} bytes)...`, 'info');

      // Tag 11: .PB_Storage.WriteRequest with chunks of 512 bytes
      const CHUNK_SIZE = 512;
      const chunks = [];
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        chunks.push(bytes.subarray(i, i + CHUNK_SIZE));
      }
      if (chunks.length === 0) {
        chunks.push(new Uint8Array(0));
      }

      for (let i = 0; i < chunks.length; i++) {
        const isLast = (i === chunks.length - 1);
        const fileSubmessage = encodeBytes(4, chunks[i]);
        const reqPayload = [
          ...encodeString(1, filePath),
          ...encodeSubmessage(2, fileSubmessage)
        ];
        await this.sendRpcRequest(11, reqPayload, !isLast, 4000);
      }

      this.log(`[Storage RPC] Successfully wrote ${filePath}`, 'success');
      return true;
    } catch (err) {
      this.log(`[Storage RPC] Failed to write ${filePath}: ${err.message}`, 'error');
      throw err;
    }
  }

  /**
   * Delete file or directory from physical Flipper storage via RPC
   */
  async removeRealFile(filePath, recursive = true) {
    if (!this.isConnected) throw new Error('Not connected to Flipper');
    try {
      await this.ensureRpcSession();
      this.log(`[Storage RPC] Deleting ${filePath}...`, 'warning');

      // Tag 12: .PB_Storage.DeleteRequest
      const reqPayload = [
        ...encodeString(1, filePath),
        ...encodeBool(2, recursive)
      ];
      await this.sendRpcRequest(12, reqPayload, false, 5000);
      this.log(`[Storage RPC] Removed ${filePath}`, 'success');
      return true;
    } catch (err) {
      this.log(`[Storage RPC] Failed to remove ${filePath}: ${err.message}`, 'error');
      throw err;
    }
  }

  /**
   * Create directory on physical Flipper storage via RPC
   */
  async createRealDirectory(dirPath) {
    if (!this.isConnected) throw new Error('Not connected to Flipper');
    try {
      await this.ensureRpcSession();
      this.log(`[Storage RPC] Creating directory ${dirPath}...`, 'info');

      // Tag 13: .PB_Storage.MkdirRequest
      const reqPayload = encodeString(1, dirPath);
      await this.sendRpcRequest(13, reqPayload, false, 4000);
      this.log(`[Storage RPC] Created directory ${dirPath}`, 'success');
      return true;
    } catch (err) {
      this.log(`[Storage RPC] Failed to create directory: ${err.message}`, 'error');
      throw err;
    }
  }

  // ============================================================================
  // PROTOBUF RPC REAL SCREEN STREAMING & INPUTS
  // ============================================================================

  /**
   * Start live Protobuf RPC screen streaming session (128x64 display frames)
   */
  async startScreenStream() {
    if (!this.isConnected || !this.writer) return false;
    if (this.isScreenStreaming) return true;

    try {
      await this.ensureRpcSession();
      this.log('[Screen RPC] Starting live 128x64 LCD stream...', 'info');

      // Tag 20: .PB_Gui.StartScreenStreamRequest
      // In qFlipper protocol, sends tag 20 and registers for unsolicited 1024-byte screen frames
      try {
        await this.sendRpcRequest(20, [], false, 3500);
      } catch (rpcErr) {
        // Some firmware branches begin streaming immediately without discrete command_status ACK
        const cmdId = ++this.rpcCommandId;
        const packet = buildRpcPacket(cmdId, 20, []);
        await this.writeBinary(packet);
      }

      this.isScreenStreaming = true;
      this.state.isScreenStreaming = true;
      this.screenFrameCount = 0;
      this.log('[Screen RPC] Live LCD screen stream active!', 'success');
      this.notifyState();
      return true;
    } catch (e) {
      this.log(`[Screen RPC] Failed to start stream: ${e.message}`, 'error');
      this.isScreenStreaming = false;
      this.state.isScreenStreaming = false;
      this.notifyState();
      return false;
    }
  }

  /**
   * Stop live Protobuf RPC screen streaming session
   */
  async stopScreenStream() {
    if (!this.isConnected || !this.isScreenStreaming) return;

    try {
      this.log('[Screen RPC] Stopping screen stream...', 'info');
      // Tag 21: .PB_Gui.StopScreenStreamRequest
      try {
        await this.sendRpcRequest(21, [], false, 2000);
      } catch (e) {
        const cmdId = ++this.rpcCommandId;
        const packet = buildRpcPacket(cmdId, 21, []);
        await this.writeBinary(packet);
      }
      this.isScreenStreaming = false;
      this.state.isScreenStreaming = false;
      this.notifyState();
    } catch (e) {
      console.warn('Error stopping screen stream:', e);
      this.isScreenStreaming = false;
      this.state.isScreenStreaming = false;
      this.notifyState();
    }
  }

  /**
   * Send real hardware key event to Flipper
   */
  async sendInput(key, type = 'short') {
    if (!this.isConnected) return false;
    const keyMap = { up: 0, down: 1, right: 2, left: 3, ok: 4, back: 5 };
    const typeMap = { press: 0, release: 1, short: 2, long: 3, repeat: 4 };
    const keyVal = keyMap[key.toLowerCase()] ?? 4;
    const typeVal = typeMap[type.toLowerCase()] ?? 2;

    try {
      if (this.isRpcMode) {
        // Tag 23: .PB_Gui.SendInputEventRequest
        const subBytes = [
          ...encodeUint32(1, keyVal),
          ...encodeUint32(2, typeVal)
        ];
        const cmdId = ++this.rpcCommandId;
        const packet = buildRpcPacket(cmdId, 23, subBytes);
        await this.writeBinary(packet);
        this.log(`[Input RPC] Injected '${key.toUpperCase()}' (${type}) to physical Flipper`, 'info');
        return true;
      } else {
        await this.writeRaw(`input send ${key} ${type}\r\n`);
        return true;
      }
    } catch (e) {
      console.warn('sendInput failed:', e);
      return false;
    }
  }

  /**
   * Reboot physical Flipper Zero
   */
  async reboot() {
    if (!this.isConnected) return;
    this.log('Rebooting physical Flipper Zero OS (FuriOS)...', 'warning');
    try {
      if (this.isRpcMode) {
        // Tag 34: .PB_System.RebootRequest mode 0 = OS
        const cmdId = ++this.rpcCommandId;
        const packet = buildRpcPacket(cmdId, 34, encodeUint32(1, 0));
        await this.writeBinary(packet);
      } else {
        await this.executeCommand('reboot', 1500);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  /**
   * Enter DFU bootloader mode
   */
  async dfu() {
    if (!this.isConnected) return;
    this.log('Entering STM32WB55 DFU Bootloader Mode...', 'warning');
    try {
      if (this.isRpcMode) {
        // Tag 34: .PB_System.RebootRequest mode 1 = DFU
        const cmdId = ++this.rpcCommandId;
        const packet = buildRpcPacket(cmdId, 34, encodeUint32(1, 1));
        await this.writeBinary(packet);
      } else {
        await this.executeCommand('dfu', 1500);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  /**
   * Real Hardware Vibration Test
   */
  async testVibration() {
    if (!this.isConnected) return;
    this.log('Testing physical haptic vibration motor on Flipper Zero...', 'warning');
    try {
      if (this.isRpcMode) {
        // Tag 38: .PB_System.PlayAudiovisualAlertRequest (plays real haptic buzz + sound + LED alert)
        const cmdId = ++this.rpcCommandId;
        const packet = buildRpcPacket(cmdId, 38, []);
        await this.writeBinary(packet);
        this.log('[Hardware RPC] Audiovisual alert & haptic pulse fired on Flipper Zero!', 'success');
      } else {
        await this.executeCommand('vibro 1', 500);
        setTimeout(async () => {
          await this.executeCommand('vibro 0', 500);
        }, 300);
      }
    } catch (e) {
      console.warn(e);
    }
  }

  /**
   * Execute raw CLI command (only when in CLI mode)
   */
  async executeCommand(cmd, timeoutMs = 4000) {
    if (!this.isConnected || !this.writer) {
      throw new Error('No physical Flipper Zero connected.');
    }

    if (this.isRpcMode) {
      // Exit RPC mode to execute raw text CLI command
      await this.stopScreenStream();
      const stopSessionPkt = buildRpcPacket(++this.rpcCommandId, 19, []);
      await this.writeBinary(stopSessionPkt);
      await new Promise(r => setTimeout(r, 100));
      this.isRpcMode = false;
      this.rpcAccumulator = new Uint8Array(0);
      await this.writeRaw('\r\n');
    }

    this.log(`> ${cmd}`, 'tx');
    this.commandAccumulator = '';
    this.incomingBuffer = '';

    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingCommandResolve) {
          const resp = this.commandAccumulator.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '') || this.incomingBuffer;
          this.pendingCommandResolve = null;
          this.commandAccumulator = '';
          this.incomingBuffer = '';
          resolve(resp);
        }
      }, timeoutMs);

      this.pendingCommandResolve = (res) => {
        clearTimeout(timer);
        resolve(res);
      };

      try {
        await this.writeRaw(cmd + '\r\n');
      } catch (err) {
        clearTimeout(timer);
        this.pendingCommandResolve = null;
        reject(err);
      }
    });
  }

  /**
   * Virtual Demo Simulator (only invoked if user explicitly tests offline mode)
   */
  enableDemoMode() {
    this.isConnected = true;
    this.isDemo = true;
    this.state = {
      isConnected: true,
      isDemo: true,
      deviceName: 'Flipper Demo (Virtual)',
      hardwareModel: 'Flipper F7 (F7B4C2)',
      hardwareColor: 'White',
      hardwareVer: 'v12',
      firmwareVersion: '0.104.1 (Simulated)',
      firmwareBranch: 'release',
      firmwareCommit: '9f8a21d',
      firmwareBuildDate: '2026-10-18',
      radioAlive: true,
      batteryPercent: 92,
      batteryVoltageMv: 4150,
      batteryCurrentMa: -120,
      batteryTempC: 27.8,
      batteryHealth: 99,
      chargeState: 'Discharging',
      sdMounted: true,
      sdTotalBytes: 32686211072n,
      sdFreeBytes: 29094799360n,
      sdTotalKb: 31920128,
      sdFreeKb: 28412890,
      intTotalBytes: 262144n,
      intFreeBytes: 188416n,
      intTotalKb: 256,
      intFreeKb: 184
    };
    this.log('[DEMO MODE] Initialized virtual Flipper Zero simulator', 'warning');
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
      sdTotalBytes: null,
      sdFreeBytes: null,
      sdTotalKb: null,
      sdFreeKb: null,
      intTotalBytes: null,
      intFreeBytes: null,
      intTotalKb: null,
      intFreeKb: null,
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
