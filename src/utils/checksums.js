/**
 * Utility functions for Checksum and CRC generation
 * Engineered for hardware reverse engineering and frame crafting
 */

/**
 * Parses raw hex string, comma separated, or \x escaped string into Uint8Array
 * @param {string} input - e.g. "01 03 00 00 00 02" or "010300000002" or "\x01\x03" or "0x01, 0x03"
 * @returns {Uint8Array}
 */
export function parseHexInput(input) {
  if (!input || typeof input !== 'string') return new Uint8Array(0);

  // Clean common prefixes and delimiters
  let cleaned = input
    .replace(/0x/gi, '')
    .replace(/\\x/gi, '')
    .replace(/[,;\s\-_:]/g, '')
    .trim();

  // If odd length, pad with leading zero
  if (cleaned.length % 2 !== 0) {
    cleaned = '0' + cleaned;
  }

  // Validate hex characters
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new Error('Invalid hexadecimal characters detected');
  }

  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes[i / 2] = parseInt(cleaned.substr(i, 2), 16);
  }
  return bytes;
}

/**
 * Formats byte array to formatted hex string
 * @param {Uint8Array|Array<number>} bytes
 * @param {string} delimiter
 * @param {boolean} uppercase
 * @returns {string}
 */
export function formatBytesToHex(bytes, delimiter = ' ', uppercase = true) {
  if (!bytes || bytes.length === 0) return '';
  const hexArr = Array.from(bytes).map(b => (b & 0xff).toString(16).padStart(2, '0'));
  const res = hexArr.join(delimiter);
  return uppercase ? res.toUpperCase() : res;
}

/**
 * Modbus CRC-16 Calculation
 * Polynomial: 0xA001 (reversed 0x8005)
 * Initial Value: 0xFFFF
 * Modbus convention transmits Low-Byte first (Little Endian)
 * @param {Uint8Array} bytes
 * @returns {{ crc: number, lowByte: number, highByte: number, hexLE: string, hexBE: string }}
 */
export function calculateModbusCRC16(bytes) {
  let crc = 0xFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] & 0xFF);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x0001) !== 0) {
        crc = ((crc >> 1) ^ 0xA001) & 0xFFFF;
      } else {
        crc = (crc >> 1) & 0xFFFF;
      }
    }
  }

  const lowByte = crc & 0xFF;
  const highByte = (crc >> 8) & 0xFF;

  return {
    crc,
    lowByte,
    highByte,
    hexLE: `${lowByte.toString(16).padStart(2, '0').toUpperCase()} ${highByte.toString(16).padStart(2, '0').toUpperCase()}`,
    hexBE: `${highByte.toString(16).padStart(2, '0').toUpperCase()} ${lowByte.toString(16).padStart(2, '0').toUpperCase()}`
  };
}

/**
 * 8-bit Additive Sum (Modulo 256)
 * @param {Uint8Array} bytes
 * @returns {{ sum: number, hex: string }}
 */
export function calculateSum8(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + bytes[i]) & 0xFF;
  }
  return {
    sum,
    hex: sum.toString(16).padStart(2, '0').toUpperCase()
  };
}

/**
 * 8-bit XOR Checksum (Longitudinal Redundancy Check / LRC)
 * @param {Uint8Array} bytes
 * @returns {{ xor: number, hex: string }}
 */
export function calculateXOR(bytes) {
  let xor = 0;
  for (let i = 0; i < bytes.length; i++) {
    xor ^= (bytes[i] & 0xFF);
  }
  return {
    xor,
    hex: xor.toString(16).padStart(2, '0').toUpperCase()
  };
}

/**
 * Two's Complement Sum8 (Intel Hex / standard protocol checksum)
 * @param {Uint8Array} bytes
 * @returns {{ sum: number, hex: string }}
 */
export function calculateTwoComplementSum8(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    sum = (sum + bytes[i]) & 0xFF;
  }
  const checksum = ((~sum + 1) & 0xFF);
  return {
    sum: checksum,
    hex: checksum.toString(16).padStart(2, '0').toUpperCase()
  };
}

/**
 * CCITT-16 (XMODEM: Poly 0x1021, Init 0x0000)
 * @param {Uint8Array} bytes
 * @returns {{ crc: number, hex: string }}
 */
export function calculateCRC16CCITT(bytes) {
  let crc = 0x0000;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= (bytes[i] << 8);
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return {
    crc,
    hex: crc.toString(16).padStart(4, '0').toUpperCase()
  };
}
