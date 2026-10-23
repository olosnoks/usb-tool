/**
 * Automotive CAN Bus & OBD-II Diagnostic Driver
 * Implements SLCAN protocol (CANable, Candlelight, USB-CAN) & ELM327 OBD-II AT commands.
 */

export const CAN_BAUD_RATES = [
  { code: 'S3', baud: 100000, label: '100 kbps' },
  { code: 'S4', baud: 125000, label: '125 kbps (Low-speed / Body CAN)' },
  { code: 'S5', baud: 250000, label: '250 kbps (Commercial / Marine NMEA 2000)' },
  { code: 'S6', baud: 500000, label: '500 kbps (Standard Automotive High-Speed)' },
  { code: 'S8', baud: 1000000, label: '1000 kbps (1 Mbps / Fast Industrial)' }
];

export const OBD_PIDS = [
  { pid: '010C', name: 'Engine RPM', unit: 'RPM', parse: (bytes) => ((bytes[0] * 256) + bytes[1]) / 4 },
  { pid: '010D', name: 'Vehicle Speed', unit: 'km/h', parse: (bytes) => bytes[0] },
  { pid: '0105', name: 'Coolant Temperature', unit: '°C', parse: (bytes) => bytes[0] - 40 },
  { pid: '0104', name: 'Engine Load', unit: '%', parse: (bytes) => Number(((bytes[0] * 100) / 255).toFixed(1)) },
  { pid: '0111', name: 'Throttle Position', unit: '%', parse: (bytes) => Number(((bytes[0] * 100) / 255).toFixed(1)) },
  { pid: '012F', name: 'Fuel Level', unit: '%', parse: (bytes) => Number(((bytes[0] * 100) / 255).toFixed(1)) },
  { pid: '0142', name: 'Battery Voltage', unit: 'V', parse: (bytes) => Number((((bytes[0] * 256) + bytes[1]) / 1000).toFixed(2)) }
];

export const COMMON_DTCS = {
  'P0300': 'Random / Multiple Cylinder Misfire Detected',
  'P0301': 'Cylinder 1 Misfire Detected',
  'P0171': 'System Too Lean (Bank 1)',
  'P0420': 'Catalyst System Efficiency Below Threshold (Bank 1)',
  'P0128': 'Coolant Thermostat (Coolant Temp Below Regulating Temp)',
  'P0455': 'Evaporative Emission System Leak Detected (Gross Leak)',
  'P0500': 'Vehicle Speed Sensor (VSS) Malfunction'
};

/**
 * Parses an SLCAN ASCII frame line:
 * t12381122334455667788 -> { id: 0x123, isExtended: false, dlc: 8, data: Uint8Array([0x11, 0x22...]) }
 * T18DAF11081122334455667788 -> { id: 0x18DAF110, isExtended: true, dlc: 8, data: ... }
 */
export function parseSlcanFrame(line) {
  if (!line || typeof line !== 'string') return null;
  const trimmed = line.trim();
  const type = trimmed[0];

  if (type === 't') {
    // Standard 11-bit ID (3 hex chars) + DLC (1 digit) + Data (2*DLC hex chars)
    const id = parseInt(trimmed.substring(1, 4), 16);
    const dlc = parseInt(trimmed[4], 10);
    const dataStr = trimmed.substring(5, 5 + (dlc * 2));
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc; i++) {
      data[i] = parseInt(dataStr.substring(i * 2, (i * 2) + 2), 16) || 0;
    }
    return { id, isExtended: false, dlc, data, raw: trimmed };
  } else if (type === 'T') {
    // Extended 29-bit ID (8 hex chars) + DLC (1 digit) + Data
    const id = parseInt(trimmed.substring(1, 9), 16);
    const dlc = parseInt(trimmed[9], 10);
    const dataStr = trimmed.substring(10, 10 + (dlc * 2));
    const data = new Uint8Array(dlc);
    for (let i = 0; i < dlc; i++) {
      data[i] = parseInt(dataStr.substring(i * 2, (i * 2) + 2), 16) || 0;
    }
    return { id, isExtended: true, dlc, data, raw: trimmed };
  }

  return null;
}

/**
 * Encodes a CAN frame into an SLCAN string
 */
export function buildSlcanFrame(id, dataBytes, isExtended = false) {
  const dlc = dataBytes.length;
  const hexData = Array.from(dataBytes)
    .map(b => (b & 0xFF).toString(16).padStart(2, '0').toUpperCase())
    .join('');

  if (isExtended) {
    const idStr = (id & 0x1FFFFFFF).toString(16).padStart(8, '0').toUpperCase();
    return `T${idStr}${dlc}${hexData}\r`;
  } else {
    const idStr = (id & 0x7FF).toString(16).padStart(3, '0').toUpperCase();
    return `t${idStr}${dlc}${hexData}\r`;
  }
}
