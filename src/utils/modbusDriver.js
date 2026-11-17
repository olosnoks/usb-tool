/**
 * Modbus RTU & RS-485 protocol driver (live hardware only; no simulation).
 *
 * Includes:
 * - Modbus RTU frame construction and CRC16 calculation
 * - Function codes used by the workbench:
 *   - 03: Read Holding Registers
 *   - 06: Write Single Register (echo, exception and CRC checked)
 * - Standard exception code names (describeModbusException)
 * - Register rows shaped as uint16 / hex / int16
 *
 * buildModbusRtuRequest can frame any 6-byte-PDU request (e.g. 01, 02, 04, 05),
 * but the client has no coil, discrete-input or float32 helpers.
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

export class ModbusClient {
  constructor(logger = console.log) {
    this.logger = logger;
    this.isConnected = false;
    this.slaveId = 1;
    this.baudRate = 9600;
    this.parity = 'none';
    // Live transport: an async (txBytes, { expectedLength, timeoutMs }) => Uint8Array
    // provided by SerialContext.transceive when talking to real RS-485 hardware.
    this.transceive = null;
  }

  // Bind to a real serial/RS-485 adapter via SerialContext.transceive.
  connectLive(transceiveFn, slaveId = 1, baud = 9600) {
    if (typeof transceiveFn !== 'function') {
      throw new Error('connectLive requires a transceive function');
    }
    this.transceive = transceiveFn;
    this.isConnected = true;
    this.slaveId = slaveId;
    this.baudRate = baud;
    this.logger(`[MODBUS RTU] LIVE — bound to serial port @ ${baud} bps (8-N-1). Polling Slave ID ${slaveId} over RS-485.`);
    return true;
  }

  disconnect() {
    this.isConnected = false;
    this.transceive = null;
    this.logger('[MODBUS RTU] Disconnected from RS-485 bus.');
  }

  // Poll holding registers (Function code 0x03)
  async readHoldingRegisters(startAddr = 0, count = 8) {
    if (!this.isConnected) return [];

    const reqFrame = buildModbusRtuRequest(this.slaveId, 0x03, startAddr, count);
    this.logger(`[MODBUS TX] => ${toHexString(reqFrame)}`);

    return this.readHoldingRegistersLive(reqFrame, startAddr, count);
  }

  // Live FC 0x03: transmit the request frame and parse the real slave response.
  async readHoldingRegistersLive(reqFrame, startAddr, count) {
    // Response = slaveId(1) + func(1) + byteCount(1) + data(2*count) + CRC(2)
    const expectedLength = 5 + 2 * count;
    let resp;
    try {
      resp = await this.transceive(reqFrame, { expectedLength, timeoutMs: 800 });
    } catch (err) {
      this.logger(`[MODBUS RX] <= Transport error: ${err.message}`);
      return [];
    }

    if (!resp || resp.length === 0) {
      this.logger('[MODBUS RX] <= No response (timeout). Check A/B polarity, baud, parity, slave ID, and bus termination.');
      return [];
    }

    // Exception response: function code with high bit set (len 5: addr+func+code+CRC)
    if (resp.length >= 5 && (resp[1] & 0x80)) {
      const code = resp[2];
      this.logger(`[MODBUS RX] <= Exception 0x${code.toString(16).padStart(2, '0')}: ${MODBUS_EXCEPTIONS[code] || 'Unknown'}.`);
      return [];
    }

    const byteCount = resp[2];
    const frameLen = 3 + byteCount + 2;
    if (resp.length < frameLen) {
      this.logger(`[MODBUS RX] <= Short frame (${resp.length} bytes, expected ${frameLen}). ${toHexString(resp)}`);
      return [];
    }

    const frame = resp.slice(0, frameLen);
    if (!this.verifyCrc(frame)) {
      this.logger(`[MODBUS RX] <= CRC mismatch — frame rejected: ${toHexString(frame)}`);
      return [];
    }

    const results = [];
    const regCount = Math.min(count, byteCount >> 1);
    for (let i = 0; i < regCount; i++) {
      const rawVal = (frame[3 + i * 2] << 8) | frame[3 + i * 2 + 1];
      results.push(this.formatRegister(startAddr + i, rawVal));
    }

    this.logger(`[MODBUS RX] <= ${toHexString(frame)} — ${regCount} registers, CRC OK.`);
    return results;
  }

  // Write single holding register (Function code 0x06).
  // Returns a detailed result: { ok, reason, exceptionCode?, exceptionName?, message }
  // reason: 'ok' | 'not-connected' | 'transport' | 'timeout' | 'exception' | 'crc' | 'mismatch'
  async writeSingleRegisterDetailed(addr, value) {
    if (!this.isConnected || typeof this.transceive !== 'function') {
      return { ok: false, reason: 'not-connected', message: 'Not connected.' };
    }

    const reqFrame = buildModbusRtuRequest(this.slaveId, 0x06, addr, value);
    this.logger(`[MODBUS TX] => Write Reg ${addr}: ${toHexString(reqFrame)}`);

    let resp;
    try {
      // A successful 0x06 response is an echo of the 8-byte request
      resp = await this.transceive(reqFrame, { expectedLength: 8, timeoutMs: 800 });
    } catch (err) {
      this.logger(`[MODBUS RX] <= Transport error: ${err.message}`);
      return { ok: false, reason: 'transport', message: `Transport error: ${err.message}` };
    }
    if (!resp || resp.length < 5) {
      this.logger('[MODBUS RX] <= Write not acknowledged (timeout / short frame).');
      return { ok: false, reason: 'timeout', message: 'No response (timeout).' };
    }
    if (resp[1] & 0x80) {
      const code = resp[2];
      const name = describeModbusException(code);
      this.logger(`[MODBUS RX] <= Write exception 0x${code.toString(16).padStart(2, '0')}: ${name}.`);
      return {
        ok: false,
        reason: 'exception',
        exceptionCode: code,
        exceptionName: name,
        message: `Exception 0x${code.toString(16).padStart(2, '0')}: ${name}`
      };
    }
    const frame = resp.slice(0, 8);
    if (frame.length < 8 || !this.verifyCrc(frame)) {
      this.logger(`[MODBUS RX] <= Write ack CRC mismatch / malformed: ${toHexString(resp)}`);
      return { ok: false, reason: 'crc', message: 'Malformed or CRC-failed response.' };
    }
    // The echo must repeat the request (slave, function, address, value)
    for (let i = 0; i < 6; i++) {
      if (frame[i] !== reqFrame[i]) {
        this.logger(`[MODBUS RX] <= Write echo does not match request: ${toHexString(frame)}`);
        return { ok: false, reason: 'mismatch', message: 'Response did not echo the write.' };
      }
    }
    this.logger(`[MODBUS RX] <= Write Reg ${addr} acknowledged by Slave ${this.slaveId} (echo OK).`);
    return { ok: true, reason: 'ok', message: 'Acknowledged.' };
  }

  // Boolean convenience wrapper: true only when the write echo is confirmed.
  async writeSingleRegister(addr, value) {
    return (await this.writeSingleRegisterDetailed(addr, value)).ok;
  }

  // Validate a complete Modbus RTU frame's trailing CRC-16 (little-endian).
  verifyCrc(frame) {
    if (frame.length < 3) return false;
    const payload = frame.slice(0, frame.length - 2);
    const crcCalc = calculateModbusCrc16(payload);
    const crcRecv = frame[frame.length - 2] | (frame[frame.length - 1] << 8);
    return crcCalc === crcRecv;
  }

  // Shape a raw register value into the table row the workbench renders.
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
    const LABELS = [
      'AC Grid Voltage (0.1V)',
      'AC Grid Current (0.1A)',
      'Active Output Power (W)',
      'Grid Frequency (0.01Hz)',
      'Power Factor (0.01)',
      'Inverter Temp (0.1°C)',
      'Daily Yield (0.01 kWh)',
      'Lifetime Yield (1 kWh)'
    ];
    return LABELS[addr] || `User Register ${addr}`;
  }
}
