/**
 * Memory Partition Layout Presets and Offset Utilities
 * For ESP32, ESP8266, ESP32-S3/C3, and Generic Microcontrollers
 */

export const PARTITION_PRESETS = [
  {
    id: 'esp32-classic',
    name: 'ESP32 (Classic)',
    description: 'Standard ESP-IDF / Arduino layout for original ESP32-D0WD / ESP32-WROOM',
    partitions: [
      { id: 'bootloader', label: 'Bootloader', offset: '0x1000', defaultEnabled: true },
      { id: 'partitions', label: 'Partition Table', offset: '0x8000', defaultEnabled: true },
      { id: 'app', label: 'App Firmware', offset: '0x10000', defaultEnabled: true },
      { id: 'extra', label: 'SPIFFS / LittleFS', offset: '0x210000', defaultEnabled: false }
    ]
  },
  {
    id: 'esp32-s3-c3',
    name: 'ESP32-S3 / C3 / C2 / C6',
    description: 'RISC-V & Xtensa LX7 modern targets with bootloader at offset 0x0',
    partitions: [
      { id: 'bootloader', label: 'Bootloader', offset: '0x0000', defaultEnabled: true },
      { id: 'partitions', label: 'Partition Table', offset: '0x8000', defaultEnabled: true },
      { id: 'app', label: 'App Firmware', offset: '0x10000', defaultEnabled: true },
      { id: 'extra', label: 'Storage / NVS', offset: '0x210000', defaultEnabled: false }
    ]
  },
  {
    id: 'esp8266',
    name: 'ESP8266 / NodeMCU',
    description: 'Legacy ESP8266 non-OS or RTOS SDK layout',
    partitions: [
      { id: 'app', label: 'Firmware (All-in-one)', offset: '0x00000', defaultEnabled: true },
      { id: 'init', label: 'Default / RF Init Data', offset: '0x3FC000', defaultEnabled: false },
      { id: 'blank', label: 'Blank Config Sector', offset: '0x3FE000', defaultEnabled: false }
    ]
  },
  {
    id: 'single-custom',
    name: 'Single Custom Binary',
    description: 'Flash a single monolithic binary, Intel HEX, or UF2 file at a custom offset',
    partitions: [
      { id: 'binary-0', label: 'Custom Binary Payload', offset: '0x0000', defaultEnabled: true }
    ]
  }
];

/**
 * Parses a hex or decimal offset string into a numeric byte offset
 * Supports "0x1000", "0X8000", "10000", "65536"
 * @param {string} str
 * @returns {number|null}
 */
export function parseHexOffset(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return null;
  const cleaned = String(str).trim();
  if (!cleaned) return null;

  if (cleaned.toLowerCase().startsWith('0x')) {
    const val = parseInt(cleaned, 16);
    return isNaN(val) || val < 0 ? null : val;
  }

  // If strictly hex characters (A-F present), treat as hex, otherwise decimal if no prefix
  if (/[a-f]/i.test(cleaned)) {
    const val = parseInt(cleaned, 16);
    return isNaN(val) || val < 0 ? null : val;
  }

  // Treat pure digits as hex if commonly formatted, or fallback
  const hexVal = parseInt(cleaned, 16);
  return isNaN(hexVal) || hexVal < 0 ? null : hexVal;
}

/**
 * Formats a numeric offset into clean 8-character hex string: 0x00010000
 * @param {number} num
 * @returns {string}
 */
export function formatHexOffset(num) {
  if (typeof num !== 'number' || isNaN(num) || num < 0) return '0x00000000';
  return `0x${num.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * Calculates total byte size of enabled partition slots
 * @param {Array<{ enabled: boolean, fileInfo?: { size: number } }>} slots
 * @returns {number}
 */
export function calculateTotalPayloadSize(slots) {
  if (!Array.isArray(slots)) return 0;
  return slots.reduce((total, slot) => {
    if (slot.enabled && slot.fileInfo?.size) {
      return total + slot.fileInfo.size;
    }
    return total;
  }, 0);
}
