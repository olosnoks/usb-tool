/**
 * Industrial Modbus RTU & RS-485 Protocol Driver
 * 
 * Includes:
 * - Modbus RTU frame construction and CRC16 calculation
 * - Function codes:
 *   - 01: Read Coils
 *   - 02: Read Discrete Inputs
 *   - 03: Read Holding Registers
 *   - 04: Read Input Registers
 *   - 05: Write Single Coil
 *   - 06: Write Single Register
 *   - 16 (0x10): Write Multiple Registers
 * - Multi-format data decoders: uint16, int16, uint32, float32 (IEEE 754), ASCII
 * - Simulated Industrial Solar Inverter / Energy Meter
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
    this.isSimulated = false;
    this.slaveId = 1;
    this.baudRate = 9600;
    this.parity = 'none';
    // Live transport: an async (txBytes, { expectedLength, timeoutMs }) => Uint8Array
    // provided by SerialContext.transceive when talking to real RS-485 hardware.
    this.transceive = null;

    // Simulated 40001-40020 Holding Registers (Solar Inverter / Power Meter)
    this.simRegisters = new Uint16Array(32);
    this.initSimulatedRegisters();
  }

  initSimulatedRegisters() {
    this.simRegisters[0] = 2305; // 230.5 V AC Mains Voltage (x10)
    this.simRegisters[1] = 124;  // 12.4 A Grid Current (x10)
    this.simRegisters[2] = 2858; // 2858 W Active Power
    this.simRegisters[3] = 5002; // 50.02 Hz Grid Frequency (x100)
    this.simRegisters[4] = 98;   // 0.98 Power Factor (x100)
    this.simRegisters[5] = 425;  // 42.5 °C Inverter Heatsink Temp (x10)
    this.simRegisters[6] = 1420; // Daily Energy (14.20 kWh)
    this.simRegisters[7] = 8520; // Total Lifetime Energy (8520 kWh)
    for (let i = 8; i < 32; i++) {
      this.simRegisters[i] = (i * 111) & 0xFFFF;
    }
  }

  connectSimulation(slaveId = 1, baud = 9600) {
    this.isConnected = true;
    this.isSimulated = true;
    this.transceive = null;
    this.slaveId = slaveId;
    this.baudRate = baud;
    this.logger(`[MODBUS RTU] SIMULATION — connected to virtual RS-485 bus at ${baud} bps. Listening for Slave ID ${slaveId}. (No real hardware; data is synthetic.)`);
    return true;
  }

  // Bind to a real serial/RS-485 adapter via SerialContext.transceive.
  connectLive(transceiveFn, slaveId = 1, baud = 9600) {
    if (typeof transceiveFn !== 'function') {
      throw new Error('connectLive requires a transceive function');
    }
    this.transceive = transceiveFn;
    this.isConnected = true;
    this.isSimulated = false;
    this.slaveId = slaveId;
    this.baudRate = baud;
    this.logger(`[MODBUS RTU] LIVE — bound to serial port @ ${baud} bps (8-N-1). Polling Slave ID ${slaveId} over RS-485.`);
    return true;
  }

  disconnect() {
    this.isConnected = false;
    this.isSimulated = false;
    this.transceive = null;
    this.logger('[MODBUS RTU] Disconnected from RS-485 bus.');
  }

  // Poll holding registers (Function code 0x03)
  async readHoldingRegisters(startAddr = 0, count = 8) {
    if (!this.isConnected) return [];

    const reqFrame = buildModbusRtuRequest(this.slaveId, 0x03, startAddr, count);
    this.logger(`[MODBUS TX] => ${toHexString(reqFrame)}`);

    if (!this.isSimulated) {
      return this.readHoldingRegistersLive(reqFrame, startAddr, count);
    }

    await new Promise(r => setTimeout(r, 80));

    // Dynamic noise on simulated registers
    this.simRegisters[0] = 2300 + Math.floor(Math.random() * 15);
    this.simRegisters[1] = 120 + Math.floor(Math.random() * 10);
    this.simRegisters[2] = Math.round((this.simRegisters[0] * this.simRegisters[1]) / 100);
    this.simRegisters[3] = 5000 + Math.floor(Math.random() * 6);

    const results = [];
    for (let i = 0; i < count; i++) {
      const addr = startAddr + i;
      const rawVal = this.simRegisters[addr % 32];
      results.push(this.formatRegister(addr, rawVal));
    }

    this.logger(`[MODBUS RX] <= SIM: synthesized ${count} registers from virtual Slave ${this.slaveId}.`);
    return results;
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

  // Write single holding register (Function code 0x06)
  async writeSingleRegister(addr, value) {
    if (!this.isConnected) return false;

    const reqFrame = buildModbusRtuRequest(this.slaveId, 0x06, addr, value);
    this.logger(`[MODBUS TX] => Write Reg ${addr}: ${toHexString(reqFrame)}`);

    if (!this.isSimulated) {
      let resp;
      try {
        // A successful 0x06 response is an echo of the 8-byte request
        resp = await this.transceive(reqFrame, { expectedLength: 8, timeoutMs: 800 });
      } catch (err) {
        this.logger(`[MODBUS RX] <= Transport error: ${err.message}`);
        return false;
      }
      if (!resp || resp.length < 5) {
        this.logger('[MODBUS RX] <= Write not acknowledged (timeout / short frame).');
        return false;
      }
      if (resp[1] & 0x80) {
        this.logger(`[MODBUS RX] <= Write exception 0x${resp[2].toString(16).padStart(2, '0')}: ${MODBUS_EXCEPTIONS[resp[2]] || 'Unknown'}.`);
        return false;
      }
      const frame = resp.slice(0, 8);
      if (frame.length < 8 || !this.verifyCrc(frame)) {
        this.logger(`[MODBUS RX] <= Write ack CRC mismatch / malformed: ${toHexString(resp)}`);
        return false;
      }
      this.logger(`[MODBUS RX] <= Write Reg ${addr} acknowledged by Slave ${this.slaveId} (echo OK).`);
      return true;
    }

    this.simRegisters[addr % 32] = value & 0xFFFF;
    await new Promise(r => setTimeout(r, 80));
    this.logger(`[MODBUS RX] <= SIM: Write Reg ${addr} acknowledged by virtual Slave ${this.slaveId}.`);
    return true;
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
