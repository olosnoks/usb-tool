/**
 * Fast Pre-Worker Packet Filtering Pipeline
 * 
 * Performs lightweight, zero-copy heuristic inspection on raw 802.11 frames
 * in the main thread before dispatching to the Web Worker. This eliminates
 * postMessage IPC serialization and heavy IE parsing for unwanted frames.
 */

/**
 * Normalizes and converts a colon/hyphen delimited MAC string into a 6-byte array.
 * @param {string} macStr 
 * @returns {number[]|null}
 */
export function parseMacToBytes(macStr) {
  if (!macStr || typeof macStr !== 'string') return null;
  const parts = macStr.trim().split(/[:-]/);
  if (parts.length !== 6) return null;
  const bytes = parts.map(p => parseInt(p, 16));
  if (bytes.some(b => isNaN(b) || b < 0 || b > 255)) return null;
  return bytes;
}

/**
 * Compares 6 bytes in a buffer at a given offset against target MAC bytes.
 * @param {Uint8Array} buffer 
 * @param {number} offset 
 * @param {number[]} targetBytes 
 * @returns {boolean}
 */
export function matchMacBytes(buffer, offset, targetBytes) {
  if (!buffer || !targetBytes || buffer.length < offset + 6 || targetBytes.length !== 6) {
    return false;
  }
  return (
    buffer[offset] === targetBytes[0] &&
    buffer[offset + 1] === targetBytes[1] &&
    buffer[offset + 2] === targetBytes[2] &&
    buffer[offset + 3] === targetBytes[3] &&
    buffer[offset + 4] === targetBytes[4] &&
    buffer[offset + 5] === targetBytes[5]
  );
}

/**
 * Fast heuristic inspection to determine whether a raw frame should pass to the worker.
 * 
 * @param {Uint8Array} buffer - Raw frame buffer (with or without Radiotap header)
 * @param {Object} options - Filter configuration
 * @param {number} [options.rfSensitivity] - RSSI threshold in dBm (e.g. -80). Drops frames with RSSI < threshold.
 * @param {boolean} [options.ignoreManagement=false] - Drop 802.11 Management frames (Type 0)
 * @param {boolean} [options.ignoreControl=false] - Drop 802.11 Control frames (Type 1)
 * @param {boolean} [options.ignoreData=false] - Drop 802.11 Data frames (Type 2)
 * @param {string|number[]} [options.macFilter] - Target MAC to match against Dest, Src, or BSSID
 * @returns {boolean} True if frame passes all filters and should be processed; false to discard.
 */
export function fastFilterPacket(buffer, options = {}) {
  if (!buffer || buffer.length < 10) return false;

  let macOffset = 0;
  let rssi = null;

  // 1. Fast Radiotap inspection
  if (buffer[0] === 0x00 && buffer.length >= 4) {
    const radiotapLen = buffer[2] | (buffer[3] << 8);
    if (radiotapLen > 0 && radiotapLen < buffer.length) {
      macOffset = radiotapLen;

      // Extract RSSI if present bit 5 is set
      if (buffer.length >= 8) {
        const present = buffer[4] | (buffer[5] << 8) | (buffer[6] << 16) | (buffer[7] << 24);
        if (present & (1 << 5)) {
          let fieldOffset = 8;
          let curPresent = present;
          while ((curPresent & (1 << 31)) && fieldOffset + 4 <= radiotapLen) {
            curPresent = buffer[fieldOffset] | (buffer[fieldOffset + 1] << 8) | (buffer[fieldOffset + 2] << 16) | (buffer[fieldOffset + 3] << 24);
            fieldOffset += 4;
          }
          if (present & (1 << 0)) fieldOffset = ((fieldOffset + 7) & ~7) + 8;
          if (present & (1 << 1)) fieldOffset += 1;
          if (present & (1 << 2)) fieldOffset += 1;
          if (present & (1 << 3)) fieldOffset = ((fieldOffset + 1) & ~1) + 4;
          if (present & (1 << 4)) fieldOffset = ((fieldOffset + 1) & ~1) + 2;
          if (fieldOffset < radiotapLen) {
            const rawSignal = buffer[fieldOffset];
            const parsedRssi = rawSignal > 127 ? rawSignal - 256 : -rawSignal;
            if (parsedRssi < 0 && parsedRssi >= -120) rssi = parsedRssi;
            else if (rawSignal > 127) rssi = rawSignal - 256;
          }
        }
      }
    }
  }

  // Check 1: RSSI Threshold Filter
  if (typeof options.rfSensitivity === 'number' && options.rfSensitivity > -100) {
    if (rssi !== null && rssi < options.rfSensitivity) {
      return false; // Discard: signal weaker than threshold
    }
  }

  // Ensure buffer contains at least 802.11 MAC Frame Control + addresses
  if (buffer.length - macOffset < 24) {
    // If it's a short control frame (e.g. ACK/CTS = 10-14 bytes), check type first
    if (buffer.length - macOffset < 10) return false;
  }

  // Check 2: 802.11 Frame Type Filter
  const fc = buffer[macOffset] | (buffer[macOffset + 1] << 8);
  const frameType = (fc >> 2) & 0x03; // 0 = Management, 1 = Control, 2 = Data

  if (frameType === 0 && options.ignoreManagement) return false;
  if (frameType === 1 && options.ignoreControl) return false;
  if (frameType === 2 && options.ignoreData) return false;

  // Check 3: MAC Address Filter
  if (options.macFilter) {
    const targetBytes = Array.isArray(options.macFilter) 
      ? options.macFilter 
      : parseMacToBytes(options.macFilter);

    if (targetBytes && targetBytes.length === 6) {
      const remaining = buffer.length - macOffset;
      let matched = false;

      // Address 1 (Destination / Receiver): offset 4..9
      if (remaining >= 10 && matchMacBytes(buffer, macOffset + 4, targetBytes)) {
        matched = true;
      }
      // Address 2 (Source / Transmitter): offset 10..15
      else if (remaining >= 16 && matchMacBytes(buffer, macOffset + 10, targetBytes)) {
        matched = true;
      }
      // Address 3 (BSSID / Filtering): offset 16..21
      else if (remaining >= 22 && matchMacBytes(buffer, macOffset + 16, targetBytes)) {
        matched = true;
      }

      if (!matched) {
        return false; // Discard: does not match target MAC
      }
    }
  }

  return true;
}
