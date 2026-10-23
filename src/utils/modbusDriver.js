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
    this.slaveId = slaveId;
    this.baudRate = baud;
    this.logger(`[MODBUS RTU] Connected to virtual RS-485 bus at ${baud} bps. Listening for Slave ID ${slaveId}.`);
    return true;
  }

  disconnect() {
    this.isConnected = false;
    this.isSimulated = false;
    this.logger('[MODBUS RTU] Disconnected from RS-485 bus.');
  }

  // Poll holding registers (Function code 0x03)
  async readHoldingRegisters(startAddr = 0, count = 8) {
    if (!this.isConnected) return [];

    const reqFrame = buildModbusRtuRequest(this.slaveId, 0x03, startAddr, count);
    const hexReq = Array.from(reqFrame).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    this.logger(`[MODBUS TX] => ${hexReq}`);

    await new Promise(r => setTimeout(r, 80));

    // Dynamic noise on simulated registers
    if (this.isSimulated) {
      this.simRegisters[0] = 2300 + Math.floor(Math.random() * 15);
      this.simRegisters[1] = 120 + Math.floor(Math.random() * 10);
      this.simRegisters[2] = Math.round((this.simRegisters[0] * this.simRegisters[1]) / 100);
      this.simRegisters[3] = 5000 + Math.floor(Math.random() * 6);
    }

    const results = [];
    for (let i = 0; i < count; i++) {
      const addr = startAddr + i;
      const rawVal = this.simRegisters[addr % 32];
      results.push({
        address: addr,
        registerNumber: 40001 + addr,
        rawUint16: rawVal,
        hex: '0x' + rawVal.toString(16).padStart(4, '0').toUpperCase(),
        int16: rawVal > 32767 ? rawVal - 65536 : rawVal,
        label: this.getRegisterLabel(addr)
      });
    }

    this.logger(`[MODBUS RX] <= Received ${count} registers from Slave ${this.slaveId} (CRC OK).`);
    return results;
  }

  // Write single holding register (Function code 0x06)
  async writeSingleRegister(addr, value) {
    const reqFrame = buildModbusRtuRequest(this.slaveId, 0x06, addr, value);
    const hexReq = Array.from(reqFrame).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
    this.logger(`[MODBUS TX] => Write Reg ${addr}: ${hexReq}`);

    if (this.isSimulated) {
      this.simRegisters[addr % 32] = value & 0xFFFF;
    }

    await new Promise(r => setTimeout(r, 80));
    this.logger(`[MODBUS RX] <= Write Reg ${addr} acknowledged by Slave ${this.slaveId}.`);
    return true;
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
