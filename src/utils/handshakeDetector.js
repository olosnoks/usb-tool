/**
 * 802.11 WPA / WPA2 4-Way Handshake (EAPOL) Detector & Tracker
 * Detects EAPOL-Key frames (M1, M2, M3, M4), validates message numbers,
 * and maintains real-time state tracking for complete capture sessions.
 */

import { formatMac } from './wifiParser.js';

/**
 * Parses raw 802.11 packet buffer for IEEE 802.1X / EAPOL-Key frames.
 * 
 * @param {Uint8Array|Array} inputBuffer - Raw packet buffer with or without Radiotap header
 * @param {Object} [parsedFrame=null] - Pre-parsed 802.11 metadata if available
 * @returns {Object|null} EAPOL details if detected, otherwise null
 */
export function detectEapolFrame(inputBuffer, parsedFrame = null) {
  if (!inputBuffer || inputBuffer.length < 32) {
    return null;
  }

  const buffer = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);

  // 1. Determine start of 802.11 MAC header (skipping Radiotap if present)
  let macOffset = 0;
  if (buffer[0] === 0x00 && buffer.length >= 4) {
    const radiotapLen = buffer[2] | (buffer[3] << 8);
    if (radiotapLen > 0 && radiotapLen < buffer.length) {
      macOffset = radiotapLen;
    }
  }

  // 2. Scan for EAPOL EtherType (0x888E) followed by EAPOL-Key packet type (0x03)
  let eapolOffset = -1;
  for (let i = macOffset + 24; i < buffer.length - 8; i++) {
    // Check for EtherType 0x88 0x8E followed by version (1, 2, or 3) and packet type 0x03 (Key)
    if (buffer[i] === 0x88 && buffer[i + 1] === 0x8e) {
      const type = buffer[i + 3];
      if (type === 0x03) {
        eapolOffset = i;
        break;
      }
    }
  }

  if (eapolOffset === -1 || eapolOffset + 9 < buffer.length) {
    // If not found with EtherType, also scan for standard SNAP header: AA AA 03 00 00 00 88 8E
    if (eapolOffset === -1) {
      for (let i = macOffset + 24; i < buffer.length - 16; i++) {
        if (
          buffer[i] === 0xaa && buffer[i + 1] === 0xaa && buffer[i + 2] === 0x03 &&
          buffer[i + 3] === 0x00 && buffer[i + 4] === 0x00 && buffer[i + 5] === 0x00 &&
          buffer[i + 6] === 0x88 && buffer[i + 7] === 0x8e && buffer[i + 9] === 0x03
        ) {
          eapolOffset = i + 6;
          break;
        }
      }
    }
  }

  if (eapolOffset === -1 || eapolOffset + 9 >= buffer.length) {
    return null;
  }

  // 3. Extract EAPOL Header
  const eapolVersion = buffer[eapolOffset + 2];
  const eapolType = buffer[eapolOffset + 3]; // 3 = EAPOL-Key
  const eapolBodyLen = (buffer[eapolOffset + 4] << 8) | buffer[eapolOffset + 5];

  // 4. Extract Key Descriptor & Key Information
  const descriptorType = buffer[eapolOffset + 6]; // 2 = RSN (WPA2), 254 = WPA1, 1 = RC4
  const keyInfo = (buffer[eapolOffset + 7] << 8) | buffer[eapolOffset + 8];

  const keyDescVersion = keyInfo & 0x0007;
  const isPairwise = (keyInfo & 0x0008) !== 0;
  const isInstall = (keyInfo & 0x0040) !== 0;
  const isAck = (keyInfo & 0x0080) !== 0;
  const isMic = (keyInfo & 0x0100) !== 0;
  const isSecure = (keyInfo & 0x0200) !== 0;

  // 5. Determine Handshake Message Type (M1, M2, M3, M4 or Group G1, G2)
  let messageType = 'Unknown EAPOL';
  let messageNumber = 0;

  if (isPairwise) {
    if (isAck && !isMic) {
      messageType = 'M1';
      messageNumber = 1;
    } else if (!isAck && isMic && !isSecure) {
      messageType = 'M2';
      messageNumber = 2;
    } else if (isAck && isMic) {
      messageType = 'M3';
      messageNumber = 3;
    } else if (!isAck && isMic && isSecure) {
      messageType = 'M4';
      messageNumber = 4;
    } else if (!isAck && isMic) {
      // Fallback for M2/M4 variants
      messageType = 'M2';
      messageNumber = 2;
    }
  } else {
    if (isAck && isMic) {
      messageType = 'G1';
      messageNumber = 1;
    } else if (!isAck && isMic) {
      messageType = 'G2';
      messageNumber = 2;
    }
  }

  // 6. Extract MAC Addresses from 802.11 Header
  let bssid = parsedFrame?.bssid || null;
  let clientMac = parsedFrame?.stationMac || null;

  if (!bssid || !clientMac || bssid === 'FF:FF:FF:FF:FF:FF' || clientMac === 'FF:FF:FF:FF:FF:FF') {
    if (buffer.length >= macOffset + 24) {
      const fc = buffer[macOffset] | (buffer[macOffset + 1] << 8);
      const toDs = (fc & 0x0100) !== 0;
      const fromDs = (fc & 0x0200) !== 0;

      const addr1 = formatMac(buffer, macOffset + 4);
      const addr2 = formatMac(buffer, macOffset + 10);
      const addr3 = formatMac(buffer, macOffset + 16);

      if (toDs && !fromDs) {
        // Client -> AP
        bssid = addr1;
        clientMac = addr2;
      } else if (!toDs && fromDs) {
        // AP -> Client
        clientMac = addr1;
        bssid = addr2;
      } else {
        // Direct or Ad-hoc: infer from M1/M3 (AP transmitter) vs M2/M4 (Client transmitter)
        if (messageNumber === 1 || messageNumber === 3) {
          bssid = addr2;
          clientMac = addr1;
        } else {
          bssid = addr1;
          clientMac = addr2;
        }
      }
    }
  }

  // 7. Extract Replay Counter & Nonce
  let replayCounter = '0';
  let nonce = '';
  if (eapolOffset + 50 < buffer.length) {
    const replayBytes = buffer.slice(eapolOffset + 11, eapolOffset + 19);
    replayCounter = Array.from(replayBytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const nonceBytes = buffer.slice(eapolOffset + 19, eapolOffset + 51);
    nonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  return {
    isEapol: true,
    message: messageType,
    messageNumber,
    isPairwise,
    bssid: bssid || 'Unknown BSSID',
    clientMac: clientMac || 'Unknown Client',
    timestamp: timeStr,
    descriptorType: descriptorType === 2 ? 'RSN (WPA2/WPA3)' : (descriptorType === 254 ? 'WPA1' : 'Unknown'),
    keyInfoHex: '0x' + keyInfo.toString(16).padStart(4, '0'),
    replayCounter,
    noncePreview: nonce ? nonce.slice(0, 16) + '...' : 'N/A'
  };
}

/**
 * Handshake Tracker class to maintain discovered EAPOL messages
 * and evaluate handshake completeness across access points and client stations.
 */
export class HandshakeTracker {
  constructor() {
    this.handshakes = new Map(); // key: `${bssid}_${clientMac}` -> HandshakeRecord
  }

  /**
   * Generates unique key for an AP <-> Client pairing.
   */
  getKey(bssid, clientMac) {
    const b = (bssid || '').toUpperCase();
    const c = (clientMac || '').toUpperCase();
    return `${b}_${c}`;
  }

  /**
   * Process a captured packet.
   * If an EAPOL frame is found, update tracking state and determine if complete.
   * 
   * @param {Uint8Array} buffer 
   * @param {Object} [parsedFrame=null] 
   * @returns {Object|null} Result with event details and status
   */
  processPacket(buffer, parsedFrame = null) {
    const eapol = detectEapolFrame(buffer, parsedFrame);
    if (!eapol || !eapol.bssid || !eapol.clientMac) {
      return null;
    }

    const key = this.getKey(eapol.bssid, eapol.clientMac);
    let record = this.handshakes.get(key);

    const now = eapol.timestamp;
    let isNewComplete = false;

    if (!record) {
      record = {
        bssid: eapol.bssid,
        clientMac: eapol.clientMac,
        messages: new Set([eapol.message]),
        descriptorType: eapol.descriptorType,
        packetCount: 1,
        firstSeen: now,
        lastSeen: now,
        isComplete: false
      };
      this.handshakes.set(key, record);
    } else {
      record.messages.add(eapol.message);
      record.packetCount += 1;
      record.lastSeen = now;
      if (!record.descriptorType || record.descriptorType === 'Unknown') {
        record.descriptorType = eapol.descriptorType;
      }
    }

    // Complete if we have M1 and M2, or all 4
    const wasComplete = record.isComplete;
    if (record.messages.has('M1') && record.messages.has('M2')) {
      record.isComplete = true;
      if (!wasComplete) {
        isNewComplete = true;
      }
    }

    return {
      ...eapol,
      isNewComplete,
      isComplete: record.isComplete,
      capturedMessages: Array.from(record.messages).sort(),
      totalMessages: record.messages.size
    };
  }

  /**
   * Returns whether a handshake is captured for a given BSSID.
   * @param {string} bssid 
   * @returns {boolean}
   */
  hasHandshake(bssid) {
    if (!bssid) return false;
    const target = bssid.toUpperCase();
    for (const record of this.handshakes.values()) {
      if (record.bssid.toUpperCase() === target && record.isComplete) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns all handshake records for a given BSSID.
   * @param {string} bssid 
   * @returns {Array<Object>}
   */
  getHandshakesForBssid(bssid) {
    if (!bssid) return [];
    const target = bssid.toUpperCase();
    const matches = [];
    for (const record of this.handshakes.values()) {
      if (record.bssid.toUpperCase() === target) {
        matches.push({
          ...record,
          messages: Array.from(record.messages).sort()
        });
      }
    }
    return matches;
  }

  /**
   * Returns all active tracked handshake records.
   * @returns {Array<Object>}
   */
  getAllHandshakes() {
    return Array.from(this.handshakes.values()).map(r => ({
      ...r,
      messages: Array.from(r.messages).sort()
    }));
  }

  /**
   * Clears all tracked handshakes.
   */
  clear() {
    this.handshakes.clear();
  }
}

/**
 * Synthesizes a subtle, pleasant chime for handshake capture using Web Audio API.
 */
export function playHandshakeChime() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now); // A5
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.12); // E6

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.35);
  } catch (e) {
    // Ignore autoplay restriction or missing sound device
  }
}
