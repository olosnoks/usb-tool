/**
 * Modbus RTU & RS-485 protocol driver (live hardware only; no simulation).
 *
 * Includes:
 * - Modbus RTU frame construction and CRC16 calculation
 * - Generic request(fc, addr, arg): FC 01/02/03/04/05/06/15/16/17 and 0x2B/0x0E,
 *   validating CRC, slave ID, function code and length; exceptions are decoded
 * - A serialised request queue (never two requests in flight), retries,
 *   error counters and response-time statistics
 * - Slave-ID scan (cancelable)
 * - createRxTransceive(): a transport built on subscribeRx that ends the wait as
 *   soon as a complete (or exception) frame has arrived
 *
 * Data-type decoding and register maps live in modbusTypes.js. Register rows are
 * generic ("Register N"); no device-specific labels are ever applied.
 */

// Modbus CRC-16 (Polynomial 0xA001)
export function calculateModbusCrc16(buffer) {
  let crc = 0xFFFF;
  for (let pos = 0; pos < buffer.length; pos++) {
    crc ^= buffer[pos];
    for (let i = 8; i !== 0; i--) {
      if ((crc & 0x0001) !== 0) {
        crc >>= 1;
        crc ^= 0xA001;
      } else {
        crc >>= 1;
      }
    }
  }
  return crc; // Low byte first in packet
}

// Format a byte buffer as space-separated uppercase hex for logs
function toHexString(buffer) {
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// Standard Modbus exception code descriptions
const MODBUS_EXCEPTIONS = {
  0x01: 'Illegal Function',
  0x02: 'Illegal Data Address',
  0x03: 'Illegal Data Value',
  0x04: 'Slave Device Failure',
  0x05: 'Acknowledge (processing)',
  0x06: 'Slave Device Busy',
  0x08: 'Memory Parity Error',
  0x0A: 'Gateway Path Unavailable',
  0x0B: 'Gateway Target Failed to Respond'
};

export function describeModbusException(code) {
  return MODBUS_EXCEPTIONS[code] || 'Unknown';
}

export function buildModbusRtuRequest(slaveId, functionCode, startAddress, quantityOrValue) {
  const pdu = new Uint8Array(6);
  pdu[0] = slaveId & 0xFF;
  pdu[1] = functionCode & 0xFF;
  pdu[2] = (startAddress >> 8) & 0xFF;
  pdu[3] = startAddress & 0xFF;
  pdu[4] = (quantityOrValue >> 8) & 0xFF;
  pdu[5] = quantityOrValue & 0xFF;

  const crc = calculateModbusCrc16(pdu);
  const frame = new Uint8Array(8);
  frame.set(pdu, 0);
  frame[6] = crc & 0xFF;         // CRC Low
  frame[7] = (crc >> 8) & 0xFF;  // CRC High
  return frame;
}

export const FUNCTION_NAMES = {
  0x01: 'Read Coils',
  0x02: 'Read Discrete Inputs',
  0x03: 'Read Holding Registers',
  0x04: 'Read Input Registers',
  0x05: 'Write Single Coil',
  0x06: 'Write Single Register',
  0x0F: 'Write Multiple Coils',
  0x10: 'Write Multiple Registers',
  0x11: 'Report Server ID',
  0x2B: 'Read Device Identification'
};

const DEVICE_ID_NAMES = {
  0: 'VendorName', 1: 'ProductCode', 2: 'MajorMinorRevision', 3: 'VendorUrl',
  4: 'ProductName', 5: 'ModelName', 6: 'UserApplicationName'
};

// Maximum quantity per function code (Modbus Application Protocol spec).
export const MAX_QUANTITY = { 0x01: 2000, 0x02: 2000, 0x03: 125, 0x04: 125, 0x0F: 1968, 0x10: 123 };

/** Append the CRC-16 (low byte first) to a slave+PDU byte array. */
export function frameWithCrc(bytes) {
  const out = new Uint8Array(bytes.length + 2);
  out.set(bytes, 0);
  const crc = calculateModbusCrc16(bytes);
  out[bytes.length] = crc & 0xFF;
  out[bytes.length + 1] = (crc >> 8) & 0xFF;
  return out;
}

export function verifyFrameCrc(frame) {
  if (!frame || frame.length < 4) return false;
  const crcCalc = calculateModbusCrc16(frame.slice(0, frame.length - 2));
  const crcRecv = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
  return crcCalc === crcRecv;
}

function checkRange(name, v, max) {
  if (!Number.isInteger(v) || v < 0 || v > max) throw new Error(`${name} must be an integer 0-${max}`);
}

/**
 * Build a request frame. Returns { frame, expectedLength } where expectedLength
 * is the full response length when known (0 when variable).
 * arg: quantity (01-04), boolean/number (05), uint16 (06), bool[] (15), uint16[] (16),
 *      objectId for 0x2B/0x0E (addr = read device ID code 1-4); ignored for 17.
 */
export function buildRequest(slaveId, fc, addr = 0, arg = 0) {
  checkRange('Slave ID', slaveId, 255);
  let pdu;
  let expectedLength = 0;
  switch (fc) {
    case 0x01: case 0x02: case 0x03: case 0x04: {
      checkRange('Address', addr, 0xFFFF);
      const max = MAX_QUANTITY[fc];
      if (!Number.isInteger(arg) || arg < 1 || arg > max) throw new Error(`Quantity must be 1-${max}`);
      pdu = [fc, addr >> 8, addr & 0xFF, arg >> 8, arg & 0xFF];
      expectedLength = fc <= 2 ? 5 + Math.ceil(arg / 8) : 5 + 2 * arg;
      break;
    }
    case 0x05: {
      checkRange('Address', addr, 0xFFFF);
      const on = arg === true || arg === 1 || arg === 0xFF00;
      pdu = [fc, addr >> 8, addr & 0xFF, on ? 0xFF : 0x00, 0x00];
      expectedLength = 8;
      break;
    }
    case 0x06: {
      checkRange('Address', addr, 0xFFFF);
      checkRange('Value', arg, 0xFFFF);
      pdu = [fc, addr >> 8, addr & 0xFF, arg >> 8, arg & 0xFF];
      expectedLength = 8;
      break;
    }
    case 0x0F: {
      checkRange('Address', addr, 0xFFFF);
      if (!Array.isArray(arg) || arg.length < 1 || arg.length > MAX_QUANTITY[0x0F]) throw new Error(`Coil count must be 1-${MAX_QUANTITY[0x0F]}`);
      const n = arg.length;
      const bytes = new Array(Math.ceil(n / 8)).fill(0);
      arg.forEach((v, i) => { if (v) bytes[i >> 3] |= 1 << (i & 7); });
      pdu = [fc, addr >> 8, addr & 0xFF, n >> 8, n & 0xFF, bytes.length, ...bytes];
      expectedLength = 8;
      break;
    }
    case 0x10: {
      checkRange('Address', addr, 0xFFFF);
      if (!Array.isArray(arg) || arg.length < 1 || arg.length > MAX_QUANTITY[0x10]) throw new Error(`Register count must be 1-${MAX_QUANTITY[0x10]}`);
      const n = arg.length;
      const data = [];
      for (const w of arg) { checkRange('Value', w, 0xFFFF); data.push(w >> 8, w & 0xFF); }
      pdu = [fc, addr >> 8, addr & 0xFF, n >> 8, n & 0xFF, data.length, ...data];
      expectedLength = 8;
      break;
    }
    case 0x11:
      pdu = [fc];
      break;
    case 0x2B: {
      const code = addr || 1;
      if (![1, 2, 3, 4].includes(code)) throw new Error('Read Device ID code must be 1-4');
      checkRange('Object ID', arg, 0xFF);
      pdu = [fc, 0x0E, code, arg];
      break;
    }
    default:
      throw new Error(`Unsupported function code 0x${Number(fc).toString(16)}`);
  }
  return { frame: frameWithCrc(Uint8Array.from([slaveId & 0xFF, ...pdu])), expectedLength };
}

/**
 * Total response length if it can already be determined from `buf`, else null.
 * Exception frames are 5 bytes. Variable frames (0x2B) return null.
 */
export function responseFrameLength(buf) {
  if (buf.length < 2) return null;
  if (buf[1] & 0x80) return 5;
  switch (buf[1]) {
    case 0x01: case 0x02: case 0x03: case 0x04: case 0x11:
      return buf.length >= 3 ? 5 + buf[2] : null;
    case 0x05: case 0x06: case 0x0F: case 0x10:
      return 8;
    default:
      return null;
  }
}

/** True once `buf` holds a complete response frame. */
export function isCompleteResponse(buf) {
  const len = responseFrameLength(buf);
  if (len !== null) return buf.length >= len;
  // Unknown length (0x2B etc.): complete when the whole buffer carries a valid CRC
  return buf.length >= 6 && verifyFrameCrc(buf);
}

/**
 * Transport built on the context's subscribeRx + sendRawBytes. Unlike a plain
 * length/quiet-gap collector it ends the wait the moment a full frame (or a
 * 5-byte exception frame) is in, so exceptions do not cost a full timeout.
 */
export function createRxTransceive({ send, subscribeRx }) {
  return (txBytes, { timeoutMs = 800 } = {}) => new Promise((resolve, reject) => {
    let buf = new Uint8Array(0);
    let done = false;
    let unsub = null;
    let timer = null;
    const finish = (err) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      if (unsub) unsub();
      if (err) reject(err); else resolve(buf);
    };
    unsub = subscribeRx((chunk) => {
      const next = new Uint8Array(buf.length + chunk.length);
      next.set(buf, 0);
      next.set(chunk, buf.length);
      buf = next;
      if (isCompleteResponse(buf)) finish();
    });
    timer = setTimeout(() => finish(), timeoutMs);
    Promise.resolve(send(txBytes)).catch((e) => finish(e));
  });
}

function emptyStats() {
  return { sent: 0, ok: 0, timeouts: 0, crcErrors: 0, exceptions: 0, mismatches: 0, transportErrors: 0, shortFrames: 0, lastMs: null, minMs: null, maxMs: null, avgMs: null, totalMs: 0, timed: 0 };
}

export class ModbusClient {
  constructor(logger = console.log, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    this.logger = logger;
    this.now = now;
    this.isConnected = false;
    this.slaveId = 1;
    this.baudRate = 9600;
    this.parity = 'none';
    this.stopBits = 1;
    this.timeoutMs = 800;
    this.retries = 0;
    this.stats = emptyStats();
    this._chain = Promise.resolve();
    this.inFlight = 0;
    this.maxInFlight = 0; // observed peak concurrency (should always be 1)
    // Live transport: an async (txBytes, { expectedLength, timeoutMs, fc }) => Uint8Array
    // provided by SerialContext.transceive or createRxTransceive for real RS-485 hardware.
    this.transceive = null;
  }

  // Bind to a real serial/RS-485 adapter.
  connectLive(transceiveFn, slaveId = 1, baud = 9600, framing = {}) {
    if (typeof transceiveFn !== 'function') {
      throw new Error('connectLive requires a transceive function');
    }
    this.transceive = transceiveFn;
    this.isConnected = true;
    this.slaveId = slaveId;
    this.baudRate = baud;
    this.parity = framing.parity || 'none';
    this.stopBits = framing.stopBits || 1;
    const p = { none: 'N', even: 'E', odd: 'O' }[this.parity] || 'N';
    this.logger(`[MODBUS RTU] LIVE — bound to serial port @ ${baud} bps (8-${p}-${this.stopBits}). Polling Slave ID ${slaveId} over RS-485.`);
    return true;
  }

  disconnect() {
    this.isConnected = false;
    this.transceive = null;
    this.logger('[MODBUS RTU] Disconnected from RS-485 bus.');
  }

  resetStats() { this.stats = emptyStats(); }

  _record(reason, ms) {
    const s = this.stats;
    s.sent++;
    if (reason === 'ok') s.ok++;
    else if (reason === 'timeout') s.timeouts++;
    else if (reason === 'crc') s.crcErrors++;
    else if (reason === 'exception') s.exceptions++;
    else if (reason === 'mismatch') s.mismatches++;
    else if (reason === 'transport') s.transportErrors++;
    else if (reason === 'short') s.shortFrames++;
    // Response-time stats only for frames that actually came back valid.
    if (reason === 'ok' || reason === 'exception') {
      s.lastMs = ms;
      s.minMs = s.minMs === null ? ms : Math.min(s.minMs, ms);
      s.maxMs = s.maxMs === null ? ms : Math.max(s.maxMs, ms);
      s.totalMs += ms;
      s.timed++;
      s.avgMs = s.totalMs / s.timed;
    }
  }

  /**
   * Generic request, serialised through an internal queue so two requests are
   * never in flight. Resolves (never rejects) with
   * { ok, reason, fc, slaveId, message, ms, ... }.
   * reason: ok | not-connected | invalid | transport | timeout | short | crc | mismatch | exception
   * opts: { slaveId, timeoutMs, retries, quiet }
   */
  request(fc, addr = 0, arg = 0, opts = {}) {
    const run = () => this._requestNow(fc, addr, arg, opts);
    const p = this._chain.then(run, run);
    this._chain = p.catch(() => {});
    return p;
  }

  async _requestNow(fc, addr, arg, opts) {
    const slaveId = opts.slaveId ?? this.slaveId;
    if (!this.isConnected || typeof this.transceive !== 'function') {
      return { ok: false, reason: 'not-connected', fc, slaveId, message: 'Not connected.' };
    }
    let req;
    try {
      req = buildRequest(slaveId, fc, addr, arg);
    } catch (err) {
      return { ok: false, reason: 'invalid', fc, slaveId, message: err.message };
    }
    const retries = opts.retries ?? this.retries;
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const fname = FUNCTION_NAMES[fc] || `FC ${fc}`;
    let result;
    for (let attempt = 0; attempt <= retries; attempt++) {
      this.inFlight++;
      this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
      const t0 = this.now();
      let resp;
      let transportErr = null;
      try {
        if (!opts.quiet) this.logger(`[MODBUS TX] => ${fname}${attempt ? ` (retry ${attempt})` : ''}: ${toHexString(req.frame)}`);
        resp = await this.transceive(req.frame, { expectedLength: req.expectedLength, timeoutMs, fc });
      } catch (err) {
        transportErr = err;
      } finally {
        this.inFlight--;
      }
      const ms = Math.max(0, this.now() - t0);
      if (transportErr) {
        this.logger(`[MODBUS RX] <= Transport error: ${transportErr.message}`);
        result = { ok: false, reason: 'transport', fc, slaveId, ms, message: `Transport error: ${transportErr.message}` };
      } else {
        result = this._parse(resp, fc, slaveId, addr, arg, req, ms, opts.quiet);
      }
      this._record(result.reason, ms);
      if (!['timeout', 'crc', 'short'].includes(result.reason)) break;
    }
    return result;
  }

  _parse(resp, fc, slaveId, addr, arg, req, ms, quiet) {
    const log = (m) => { if (!quiet) this.logger(m); };
    const base = { fc, slaveId, ms };
    if (!resp || resp.length === 0) {
      log('[MODBUS RX] <= No response (timeout). Check A/B polarity, baud, parity, slave ID, and bus termination.');
      return { ...base, ok: false, reason: 'timeout', message: 'No response (timeout).' };
    }
    if (resp.length < 5) {
      log(`[MODBUS RX] <= Short frame (${resp.length} bytes): ${toHexString(resp)}`);
      return { ...base, ok: false, reason: 'short', message: `Short frame (${resp.length} bytes).` };
    }
    let len = responseFrameLength(resp);
    if (len === null) len = resp.length;
    if (resp.length < len) {
      log(`[MODBUS RX] <= Short frame (${resp.length} bytes, expected ${len}). ${toHexString(resp)}`);
      return { ...base, ok: false, reason: 'short', message: `Short frame (${resp.length} of ${len} bytes).` };
    }
    const frame = resp.slice(0, len);
    if (!verifyFrameCrc(frame)) {
      log(`[MODBUS RX] <= CRC mismatch — frame rejected: ${toHexString(frame)}`);
      return { ...base, ok: false, reason: 'crc', message: 'Malformed or CRC-failed response.' };
    }
    if (frame[0] !== (slaveId & 0xFF)) {
      log(`[MODBUS RX] <= Response from slave ${frame[0]}, expected ${slaveId}: ${toHexString(frame)}`);
      return { ...base, ok: false, reason: 'mismatch', detail: 'slave', message: `Response from slave ${frame[0]}, expected ${slaveId}.` };
    }
    if (frame[1] === (fc | 0x80)) {
      const code = frame[2];
      const name = describeModbusException(code);
      log(`[MODBUS RX] <= Exception 0x${code.toString(16).padStart(2, '0')}: ${name}.`);
      return { ...base, ok: false, reason: 'exception', exceptionCode: code, exceptionName: name, message: `Exception 0x${code.toString(16).padStart(2, '0')}: ${name}` };
    }
    if (frame[1] !== fc) {
      log(`[MODBUS RX] <= Unexpected function 0x${frame[1].toString(16)} (expected 0x${fc.toString(16)}): ${toHexString(frame)}`);
      return { ...base, ok: false, reason: 'mismatch', detail: 'function', message: `Unexpected function code 0x${frame[1].toString(16)}.` };
    }

    const mismatch = (detail, message) => {
      log(`[MODBUS RX] <= ${message} ${toHexString(frame)}`);
      return { ...base, ok: false, reason: 'mismatch', detail, message };
    };

    switch (fc) {
      case 0x01: case 0x02: {
        const need = Math.ceil(arg / 8);
        if (frame[2] !== need) return mismatch('length', `Byte count ${frame[2]}, expected ${need}.`);
        const bits = [];
        for (let i = 0; i < arg; i++) bits.push(((frame[3 + (i >> 3)] >> (i & 7)) & 1) === 1);
        log(`[MODBUS RX] <= ${toHexString(frame)} — ${arg} ${fc === 1 ? 'coils' : 'inputs'}, CRC OK.`);
        return { ...base, ok: true, reason: 'ok', message: 'OK', bits };
      }
      case 0x03: case 0x04: {
        if (frame[2] !== 2 * arg) return mismatch('length', `Byte count ${frame[2]}, expected ${2 * arg}.`);
        const words = [];
        for (let i = 0; i < arg; i++) words.push((frame[3 + i * 2] << 8) | frame[4 + i * 2]);
        log(`[MODBUS RX] <= ${toHexString(frame)} — ${arg} registers, CRC OK.`);
        return { ...base, ok: true, reason: 'ok', message: 'OK', words };
      }
      case 0x05: case 0x06: {
        for (let i = 0; i < 6; i++) {
          if (frame[i] !== req.frame[i]) return mismatch('echo', 'Response did not echo the write.');
        }
        log(`[MODBUS RX] <= ${fc === 5 ? 'Coil' : 'Reg'} ${addr} acknowledged by Slave ${slaveId} (echo OK).`);
        return { ...base, ok: true, reason: 'ok', message: 'Acknowledged.' };
      }
      case 0x0F: case 0x10: {
        const count = Array.isArray(arg) ? arg.length : 0;
        const echoAddr = (frame[2] << 8) | frame[3];
        const echoQty = (frame[4] << 8) | frame[5];
        if (echoAddr !== addr || echoQty !== count) return mismatch('echo', `Write echo ${echoAddr}/${echoQty} does not match request ${addr}/${count}.`);
        log(`[MODBUS RX] <= Wrote ${count} ${fc === 0x0F ? 'coils' : 'registers'} at ${addr} (echo OK).`);
        return { ...base, ok: true, reason: 'ok', message: 'Acknowledged.', quantity: count };
      }
      case 0x11: {
        const count = frame[2];
        const data = Array.from(frame.slice(3, 3 + count));
        const serverId = data[0];
        const runIndicator = data.length > 1 ? data[1] : null;
        const extra = data.slice(2);
        const text = extra.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join('');
        log(`[MODBUS RX] <= ${toHexString(frame)} — Server ID ${serverId}, CRC OK.`);
        return { ...base, ok: true, reason: 'ok', message: 'OK', serverId, running: runIndicator === null ? null : runIndicator === 0xFF, data, text };
      }
      case 0x2B: {
        if (frame[2] !== 0x0E) return mismatch('function', 'Unexpected MEI type.');
        const readCode = frame[3];
        const more = frame[5] === 0xFF;
        const nextObjectId = frame[6];
        const n = frame[7];
        const objects = [];
        let pos = 8;
        for (let i = 0; i < n; i++) {
          if (pos + 2 > frame.length - 2) return mismatch('length', 'Truncated device identification objects.');
          const id = frame[pos];
          const l = frame[pos + 1];
          if (pos + 2 + l > frame.length - 2) return mismatch('length', 'Truncated device identification object.');
          const value = Array.from(frame.slice(pos + 2, pos + 2 + l)).map((b) => String.fromCharCode(b)).join('');
          objects.push({ id, name: DEVICE_ID_NAMES[id] || `Object 0x${id.toString(16)}`, value });
          pos += 2 + l;
        }
        log(`[MODBUS RX] <= ${toHexString(frame)} — ${objects.length} device ID objects, CRC OK.`);
        return { ...base, ok: true, reason: 'ok', message: 'OK', readCode, more, nextObjectId, objects };
      }
      default:
        return { ...base, ok: true, reason: 'ok', message: 'OK', raw: Array.from(frame) };
    }
  }

  // ---- Convenience wrappers ----

  readCoils(addr, qty, opts) { return this.request(0x01, addr, qty, opts); }
  readDiscreteInputs(addr, qty, opts) { return this.request(0x02, addr, qty, opts); }
  readInputRegistersDetailed(addr, qty, opts) { return this.request(0x04, addr, qty, opts); }
  writeSingleCoil(addr, on, opts) { return this.request(0x05, addr, on, opts); }
  writeMultipleCoils(addr, bits, opts) { return this.request(0x0F, addr, bits, opts); }
  writeMultipleRegisters(addr, words, opts) { return this.request(0x10, addr, words, opts); }
  reportServerId(opts) { return this.request(0x11, 0, 0, opts); }
  readDeviceId(code = 1, objectId = 0, opts) { return this.request(0x2B, code, objectId, opts); }

  // Poll holding registers (Function code 0x03). Returns generic rows ([] on failure).
  async readHoldingRegisters(startAddr = 0, count = 8) {
    const r = await this.request(0x03, startAddr, count);
    if (!r.ok) return [];
    return r.words.map((w, i) => this.formatRegister(startAddr + i, w));
  }

  // Write single holding register (Function code 0x06).
  // Returns a detailed result: { ok, reason, exceptionCode?, exceptionName?, message }
  // reason: 'ok' | 'not-connected' | 'transport' | 'timeout' | 'exception' | 'crc' | 'mismatch' | ...
  async writeSingleRegisterDetailed(addr, value) {
    return this.request(0x06, addr, value);
  }

  // Boolean convenience wrapper: true only when the write echo is confirmed.
  async writeSingleRegister(addr, value) {
    return (await this.writeSingleRegisterDetailed(addr, value)).ok;
  }

  /**
   * Scan slave IDs for a device that answers. A valid exception frame also
   * counts as present. Cancelable via signal ({ aborted } or AbortSignal).
   * probe: { fc, addr, qty }. Returns [{ slaveId, kind: 'ok'|'exception', message }].
   */
  async scan({ from = 1, to = 247, probe = { fc: 0x03, addr: 0, qty: 1 }, timeoutMs = 250, signal = null, onProgress = null } = {}) {
    const found = [];
    for (let id = from; id <= to; id++) {
      if (signal && signal.aborted) break;
      const r = await this.request(probe.fc, probe.addr, probe.qty, { slaveId: id, timeoutMs, retries: 0, quiet: true });
      if (r.ok || r.reason === 'exception') {
        found.push({ slaveId: id, kind: r.ok ? 'ok' : 'exception', message: r.message });
      }
      if (onProgress) onProgress({ slaveId: id, from, to, found: found.slice() });
    }
    return found;
  }

  // Validate a complete Modbus RTU frame's trailing CRC-16 (little-endian).
  verifyCrc(frame) {
    return verifyFrameCrc(frame);
  }

  // Shape a raw register value into a generic table row (no device-specific labels).
  formatRegister(addr, rawVal) {
    return {
      address: addr,
      registerNumber: 40001 + addr,
      rawUint16: rawVal,
      hex: '0x' + rawVal.toString(16).padStart(4, '0').toUpperCase(),
      int16: rawVal > 32767 ? rawVal - 65536 : rawVal,
      label: this.getRegisterLabel(addr)
    };
  }

  getRegisterLabel(addr) {
    return `Register ${addr}`;
  }
}
