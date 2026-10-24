/**
 * 802.11 Advanced Frame & Radiotap Parser
 * Supports Client Tracking, Security Extraction (WPA3/WPA2/WPA/WEP/Open),
 * Deauth/Disassoc detection, and Radiotap telemetry.
 */

import { getVendor } from './ouiLookup.js';
import { extractLayer3Metadata, parseArpPayload, parseDhcpPayload } from './layer3Parser.js';

export { getVendor, extractLayer3Metadata, parseArpPayload, parseDhcpPayload };
export const lookupVendor = (mac) => {
  const v = getVendor(mac);
  return v === 'Unknown' ? 'Unknown OUI' : v;
};

export const DEAUTH_REASONS = {
  1: 'Unspecified reason',
  2: 'Previous auth no longer valid',
  3: 'Deauthenticated: leaving BSS',
  4: 'Disassociated due to inactivity',
  5: 'Disassociated: AP unable to handle all STAs',
  6: 'Class 2 frame from Non-Auth STA',
  7: 'Class 3 from Non-Assoc STA',
  8: 'Disassociated: STA leaving BSS',
  9: 'STA requesting (re)assoc not authenticated',
  10: 'Disassociated: bad Power Capability',
  11: 'Disassociated: bad Supported Channels',
  12: 'Disassociated due to BSS Transition Management',
  13: 'Invalid Information Element',
  14: 'Message integrity code (MIC) failure',
  15: '4-Way Handshake timeout',
  16: 'Group Key Handshake timeout',
  17: 'Element in 4-Way Handshake different',
  18: 'Invalid Group Cipher',
  19: 'Invalid Pairwise Cipher',
  20: 'Invalid AKMP',
  21: 'Unsupported RSNE version',
  22: 'Invalid RSNE Capabilities',
  23: 'IEEE 802.1X authentication failed',
  24: 'Cipher suite rejected'
};

/**
 * Format 6 consecutive bytes into an uppercase colon-delimited MAC address.
 * @param {Uint8Array} bytes 
 * @param {number} start 
 * @returns {string}
 */
export function formatMac(bytes, start) {
  if (!bytes || start + 6 > bytes.length) return 'N/A';
  return Array.from(bytes.slice(start, start + 6))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Map radio frequency in MHz to 802.11 channel number.
 * @param {number} freq 
 * @returns {number|null}
 */
export function freqToChannel(freq) {
  if (freq === 2484) return 14;
  if (freq >= 2412 && freq <= 2472) return Math.round((freq - 2407) / 5);
  if (freq >= 5000 && freq <= 5900) return Math.round((freq - 5000) / 5);
  return null;
}

/**
 * Safely parses DNS question domain from DNS packet payload.
 * Length-prefixed ASCII labels (e.g. \x06google\x03com\x00 -> google.com)
 */
function parseDnsQuestionDomain(buffer, offset, maxOffset) {
  let pos = offset;
  const labels = [];
  let hops = 0;
  while (pos < maxOffset && hops < 15) {
    hops++;
    const len = buffer[pos];
    if (len === 0) break;
    if ((len & 0xC0) === 0xC0) break; // Compression pointer
    if (pos + 1 + len > maxOffset) break;
    let label = '';
    for (let i = 0; i < len; i++) {
      const charCode = buffer[pos + 1 + i];
      if ((charCode >= 48 && charCode <= 57) || // 0-9
          (charCode >= 65 && charCode <= 90) || // A-Z
          (charCode >= 97 && charCode <= 122) || // a-z
          charCode === 45 || charCode === 95) { // - or _
        label += String.fromCharCode(charCode);
      } else {
        return null;
      }
    }
    if (label.length > 0) labels.push(label);
    pos += 1 + len;
  }
  return labels.length >= 2 ? labels.join('.') : null;
}

/**
 * Extracts observable cleartext telemetry metadata (DNS domains, HTTP endpoints)
 * from unencrypted 802.11 Data frame payloads.
 * 
 * @param {Uint8Array} buffer - Complete frame buffer
 * @param {number} macOffset - Offset to 802.11 MAC header
 * @param {boolean} isQoS - Whether frame is QoS Data (subtype 8)
 * @returns {Object|null} Cleartext metadata object or null
 */
export function extractCleartextMetadata(buffer, macOffset = 0, isQoS = false) {
  if (!buffer || buffer.length < macOffset + 24) return null;

  // Frame Control is first 2 bytes of 802.11 MAC header
  const fc = buffer[macOffset] | (buffer[macOffset + 1] << 8);
  const isProtected = (fc & 0x4000) !== 0; // Bit 14 = Protected / Encrypted frame
  if (isProtected) return null; // Encrypted frame (CCMP/TKIP/WEP) - cannot parse cleartext

  const macHeaderLen = isQoS ? 26 : 24;
  let payloadOffset = macOffset + macHeaderLen;
  if (payloadOffset >= buffer.length) return null;

  // Check for LLC/SNAP encapsulation (AA AA 03 00 00 00 08 00 for IPv4)
  if (buffer.length >= payloadOffset + 8 &&
      buffer[payloadOffset] === 0xAA &&
      buffer[payloadOffset + 1] === 0xAA &&
      buffer[payloadOffset + 2] === 0x03) {
    const etherType = (buffer[payloadOffset + 6] << 8) | buffer[payloadOffset + 7];
    if (etherType === 0x0800) { // IPv4
      payloadOffset += 8; // Advance past LLC/SNAP to IPv4 header
    }
  }

  // Attempt IPv4 parsing
  if (payloadOffset + 20 <= buffer.length) {
    const version = buffer[payloadOffset] >> 4;
    const ihl = (buffer[payloadOffset] & 0x0F) * 4;
    if (version === 4 && ihl >= 20 && payloadOffset + ihl <= buffer.length) {
      const protocol = buffer[payloadOffset + 9];
      const transportOffset = payloadOffset + ihl;

      // 1. UDP Protocol (17) -> DNS Port 53
      if (protocol === 17 && transportOffset + 8 <= buffer.length) {
        const srcPort = (buffer[transportOffset] << 8) | buffer[transportOffset + 1];
        const dstPort = (buffer[transportOffset + 2] << 8) | buffer[transportOffset + 3];

        if ((dstPort === 53 || srcPort === 53) && transportOffset + 8 + 12 <= buffer.length) {
          const dnsOffset = transportOffset + 8;
          const qdCount = (buffer[dnsOffset + 4] << 8) | buffer[dnsOffset + 5];
          if (qdCount > 0) {
            const domain = parseDnsQuestionDomain(buffer, dnsOffset + 12, buffer.length);
            if (domain) {
              return {
                protocol: 'DNS',
                domain,
                port: dstPort === 53 ? dstPort : srcPort,
                type: 'Query'
              };
            }
          }
        }
      }

      // 2. TCP Protocol (6) -> HTTP Port 80
      if (protocol === 6 && transportOffset + 20 <= buffer.length) {
        const srcPort = (buffer[transportOffset] << 8) | buffer[transportOffset + 1];
        const dstPort = (buffer[transportOffset + 2] << 8) | buffer[transportOffset + 3];
        const dataOffset = (buffer[transportOffset + 12] >> 4) * 4;
        const appOffset = transportOffset + dataOffset;

        if ((dstPort === 80 || srcPort === 80) && appOffset < buffer.length) {
          const tcpPayload = buffer.slice(appOffset, Math.min(buffer.length, appOffset + 512));
          const text = new TextDecoder('ascii', { fatal: false }).decode(tcpPayload);

          const hostMatch = text.match(/Host:\s*([^\r\n:]+)/i);
          const reqMatch = text.match(/^(?:GET|POST|HEAD|PUT|DELETE|OPTIONS)\s+([^\s?#]+)/i);

          if (hostMatch || reqMatch) {
            return {
              protocol: 'HTTP',
              domain: hostMatch ? hostMatch[1].trim() : 'Unknown Host',
              endpoint: reqMatch ? reqMatch[1].trim() : '/',
              port: dstPort === 80 ? dstPort : srcPort,
              type: 'Request'
            };
          }
        }
      }
    }
  }

  // Fallback: Payload scanning for plain ASCII HTTP or DNS patterns in unencrypted data
  const rawSample = buffer.slice(payloadOffset, Math.min(buffer.length, payloadOffset + 512));
  const rawText = new TextDecoder('ascii', { fatal: false }).decode(rawSample);

  const httpHostMatch = rawText.match(/Host:\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
  const httpReqMatch = rawText.match(/(?:GET|POST)\s+([^\s?#]+)/i);
  if (httpHostMatch) {
    return {
      protocol: 'HTTP',
      domain: httpHostMatch[1].trim(),
      endpoint: httpReqMatch ? httpReqMatch[1].trim() : '/',
      type: 'Observed Stream'
    };
  }

  // Fallback DNS string scan in unencrypted payload
  for (let i = payloadOffset; i < buffer.length - 8; i++) {
    const domain = parseDnsQuestionDomain(buffer, i, buffer.length);
    if (domain && domain.includes('.') && domain.length >= 4 && domain.length <= 64) {
      if (/\.(com|org|net|edu|gov|io|local|dev|info|co|me|xyz|app|arpa)$/i.test(domain)) {
        return {
          protocol: 'DNS',
          domain,
          type: 'Observed Query'
        };
      }
    }
  }

  return null;
}

/**
 * Parse raw 802.11 frame from a WebUSB RX transfer buffer.
 * Extracts Radiotap header, 802.11 MAC header, Tagged Parameters, Security types,
 * client station MACs, and Deauth attack indicators.
 * 
 * @param {Uint8Array|Array} inputBuffer 
 * @returns {Object|null} Structured frame object or null if invalid frame.
 */
export function parse80211Frame(inputBuffer) {
  if (!inputBuffer || inputBuffer.length < 10) {
    return null;
  }

  const buffer = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);

  let macOffset = 0;
  let rssi = -60;
  let noiseFloor = null;
  let snr = null;
  let radiotapChannel = null;

  // 1. Radiotap Header Parsing
  if (buffer[0] === 0x00 && buffer.length >= 4) {
    const radiotapLen = buffer[2] | (buffer[3] << 8);
    if (radiotapLen > 0 && radiotapLen < buffer.length) {
      macOffset = radiotapLen;

      if (buffer.length >= 8) {
        const present = buffer[4] | (buffer[5] << 8) | (buffer[6] << 16) | (buffer[7] << 24);
        let fieldOffset = 8;

        // Skip extended present masks
        let curPresent = present;
        while ((curPresent & (1 << 31)) && fieldOffset + 4 <= radiotapLen) {
          curPresent = buffer[fieldOffset] | (buffer[fieldOffset + 1] << 8) | (buffer[fieldOffset + 2] << 16) | (buffer[fieldOffset + 3] << 24);
          fieldOffset += 4;
        }

        if (present & (1 << 0)) { // TSFT (8 bytes, align 8)
          fieldOffset = (fieldOffset + 7) & ~7;
          fieldOffset += 8;
        }
        if (present & (1 << 1)) { // Flags (1 byte)
          fieldOffset += 1;
        }
        if (present & (1 << 2)) { // Rate (1 byte)
          fieldOffset += 1;
        }
        if (present & (1 << 3)) { // Channel (4 bytes, align 2)
          fieldOffset = (fieldOffset + 1) & ~1;
          if (fieldOffset + 2 <= radiotapLen) {
            const freq = buffer[fieldOffset] | (buffer[fieldOffset + 1] << 8);
            radiotapChannel = freqToChannel(freq);
          }
          fieldOffset += 4;
        }
        if (present & (1 << 4)) { // FHSS (2 bytes, align 2)
          fieldOffset = (fieldOffset + 1) & ~1;
          fieldOffset += 2;
        }
        if (present & (1 << 5)) { // dBm Antenna Signal (1 byte signed int8)
          if (fieldOffset < radiotapLen) {
            const rawSignal = buffer[fieldOffset];
            const parsedRssi = rawSignal > 127 ? rawSignal - 256 : -rawSignal;
            if (parsedRssi < 0 && parsedRssi >= -120) {
              rssi = parsedRssi;
            } else if (rawSignal > 127) {
              rssi = rawSignal - 256;
            }
          }
          fieldOffset += 1;
        }
        if (present & (1 << 6)) { // dBm Antenna Noise (1 byte signed int8)
          if (fieldOffset < radiotapLen) {
            const rawNoise = buffer[fieldOffset];
            const parsedNoise = rawNoise > 127 ? rawNoise - 256 : -rawNoise;
            if (parsedNoise <= 0 && parsedNoise >= -130) {
              noiseFloor = parsedNoise;
            } else if (rawNoise > 127) {
              noiseFloor = rawNoise - 256;
            } else if (rawNoise > 0 && rawNoise <= 120) {
              noiseFloor = -rawNoise;
            }
          }
          fieldOffset += 1;
        }

        if (rssi !== null && noiseFloor !== null) {
          snr = rssi - noiseFloor;
        }
      }
    }
  }

  // Ensure minimum 802.11 MAC header length (24 bytes)
  if (buffer.length - macOffset < 24) {
    return null;
  }

  // 2. 802.11 MAC Header Parsing
  const fc = buffer[macOffset] | (buffer[macOffset + 1] << 8);
  const frameType = (fc >> 2) & 0x03; // 0 = Management, 1 = Control, 2 = Data
  const subtype = (fc >> 4) & 0x0f;
  const rawDuration = buffer[macOffset + 2] | (buffer[macOffset + 3] << 8);
  const duration = rawDuration <= 32767 ? rawDuration : 0;

  const toDs = (fc & 0x0100) !== 0;
  const fromDs = (fc & 0x0200) !== 0;

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  const destinationMac = formatMac(buffer, macOffset + 4);
  const sourceMac = formatMac(buffer, macOffset + 10);
  const bssidMac = formatMac(buffer, macOffset + 16);

  // Helper to determine if a MAC is unicast (not broadcast or multicast)
  const isUnicast = (mac) => {
    if (!mac || mac === 'FF:FF:FF:FF:FF:FF' || mac === '00:00:00:00:00:00') return false;
    const firstByte = parseInt(mac.slice(0, 2), 16);
    return (firstByte & 1) === 0;
  };

  // --- 3. Handle DATA FRAMES (Client Tracking) ---
  if (frameType === 2) {
    let subtypeName = 'Data';
    if (subtype === 4) subtypeName = 'Null Data';
    else if (subtype === 8) subtypeName = 'QoS Data';
    else if (subtype === 12) subtypeName = 'QoS Null';

    let stationMac = null;
    let bssid = bssidMac;
    let direction = 'Direct';

    if (toDs && !fromDs) {
      // Client -> AP: Addr1 = AP (BSSID), Addr2 = Client (SA)
      direction = 'Client -> AP';
      bssid = destinationMac;
      if (isUnicast(sourceMac)) {
        stationMac = sourceMac;
      }
    } else if (!toDs && fromDs) {
      // AP -> Client: Addr1 = Client (DA), Addr2 = AP (BSSID)
      direction = 'AP -> Client';
      bssid = sourceMac;
      if (isUnicast(destinationMac)) {
        stationMac = destinationMac;
      }
    } else if (!toDs && !fromDs) {
      // IBSS or Direct
      bssid = bssidMac;
      if (isUnicast(sourceMac)) {
        stationMac = sourceMac;
      }
    }

    const isProtected = (fc & 0x4000) !== 0;
    const cleartextMetadata = !isProtected 
      ? extractCleartextMetadata(buffer, macOffset, subtype === 8) 
      : null;
    const l3Metadata = !isProtected
      ? extractLayer3Metadata(buffer, macOffset, subtype === 8)
      : null;

    if (cleartextMetadata) {
      cleartextMetadata.clientMac = stationMac || sourceMac;
      cleartextMetadata.bssid = bssid;
      cleartextMetadata.channel = radiotapChannel || 36;
      cleartextMetadata.rssi = rssi;
      cleartextMetadata.timestamp = timeStr;
    }

    const ipAddress = l3Metadata?.ip || null;
    const dhcpHostname = l3Metadata?.hostname || null;

    return {
      type: subtypeName,
      frameCategory: 'Data',
      stationMac,
      sourceMac,
      destinationMac,
      bssid,
      toDs,
      fromDs,
      direction,
      channel: radiotapChannel || 36,
      rssi,
      noiseFloor,
      snr,
      timestamp: timeStr,
      lastSeen: timeStr,
      vendor: lookupVendor(stationMac || sourceMac),
      length: buffer.length,
      duration,
      isProtected,
      cleartextMetadata,
      l3Metadata,
      ipAddress,
      dhcpHostname
    };
  }

  // --- 4. Handle CONTROL frames (Airtime tracking & duration metrics) ---
  if (frameType === 1) {
    return {
      type: 'Control',
      frameCategory: 'Control',
      duration,
      rssi,
      channel: radiotapChannel || 36,
      length: buffer.length
    };
  }

  // --- 5. Handle MANAGEMENT frames ---
  let typeStr = 'Management';
  let isBeaconOrProbe = false;
  let bodyStart = macOffset + 24;
  let stationMac = null;
  let isDeauth = false;
  let reasonCode = null;
  let reasonDescription = null;

  if (subtype === 8) {
    typeStr = 'Beacon';
    isBeaconOrProbe = true;
    bodyStart = macOffset + 36;
  } else if (subtype === 5) {
    typeStr = 'Probe Resp';
    isBeaconOrProbe = true;
    bodyStart = macOffset + 36;
  } else if (subtype === 4) {
    typeStr = 'Probe Req';
    isBeaconOrProbe = true;
    bodyStart = macOffset + 24;
    // For Probe Request, sender is client looking for networks
    if (isUnicast(sourceMac)) {
      stationMac = sourceMac;
    }
  } else if (subtype === 12 || subtype === 10) {
    // 12 = Deauth, 10 = Disassoc
    typeStr = subtype === 12 ? 'Deauth' : 'Disassoc';
    isDeauth = true;

    // Reason code is first 2 bytes of management frame body
    if (buffer.length >= macOffset + 26) {
      reasonCode = buffer[macOffset + 24] | (buffer[macOffset + 25] << 8);
      reasonDescription = DEAUTH_REASONS[reasonCode] || `Code ${reasonCode}`;
    }

    if (isUnicast(destinationMac)) {
      stationMac = destinationMac;
    } else if (isUnicast(sourceMac)) {
      stationMac = sourceMac;
    }
  } else if (subtype === 0) {
    typeStr = 'Assoc Req';
    if (isUnicast(sourceMac)) stationMac = sourceMac;
  } else if (subtype === 1) {
    typeStr = 'Assoc Resp';
    bodyStart = macOffset + 30;
    if (isUnicast(destinationMac)) stationMac = destinationMac;
  } else if (subtype === 2) {
    typeStr = 'Reassoc Req';
    isBeaconOrProbe = true;
    bodyStart = macOffset + 34;
    if (isUnicast(sourceMac)) stationMac = sourceMac;
  } else if (subtype === 11) {
    typeStr = 'Auth';
    if (isUnicast(sourceMac)) stationMac = sourceMac;
  }

  let ssid = '<Unknown>';
  let channel = radiotapChannel || 36;
  let security = 'Open';
  let isMixedMode = false;
  let mfp = null;
  let isMfpCapable = false;
  let isMfpRequired = false;
  let isWifi6 = false;
  let heCapabilities = null;
  let bssColor = null;
  let bssColorDisabled = false;
  const roaming = { k: false, v: false, r: false };
  const tagSequence = [];

  // Security extraction and tagged parameters for Beacons and Probe Responses
  if ((subtype === 8 || subtype === 5) && buffer.length >= macOffset + 36) {
    // Capability Information at macOffset + 34 (2 bytes uint16 LE)
    const capInfo = buffer[macOffset + 34] | (buffer[macOffset + 35] << 8);
    const hasPrivacy = (capInfo & 0x0010) !== 0; // Bit 4: Privacy

    if (!hasPrivacy) {
      security = 'Open';
    } else {
      security = 'WEP'; // Baseline if privacy is set but no RSN/WPA IEs
    }

    // Parse tagged parameters
    let pos = bodyStart;
    let hasWpa = false;
    let hasWpa2 = false;
    let hasWpa3 = false;
    let foundSsid = false;

    while (pos + 2 <= buffer.length) {
      const tagNum = buffer[pos];
      const tagLen = buffer[pos + 1];
      const tagDataStart = pos + 2;
      const tagDataEnd = tagDataStart + tagLen;

      if (tagDataEnd > buffer.length) break;
      tagSequence.push(tagNum);

      // Tag 0: SSID
      if (tagNum === 0 && !foundSsid) {
        if (tagLen === 0) {
          ssid = '<Hidden SSID>';
        } else {
          try {
            const rawSsid = buffer.slice(tagDataStart, tagDataEnd);
            if (rawSsid.every(b => b === 0)) {
              ssid = '<Hidden SSID>';
            } else {
              const decoded = new TextDecoder('utf-8', { fatal: false }).decode(rawSsid).trim();
              ssid = decoded || '<Hidden SSID>';
            }
          } catch (e) {
            ssid = '<Corrupted SSID>';
          }
        }
        foundSsid = true;
      }

      // Tag 3: DS Parameter Set (Channel)
      if (tagNum === 3 && tagLen >= 1) {
        channel = buffer[tagDataStart];
      }

      // Tag 48 (0x30): RSN IE (WPA2 / WPA3)
      if (tagNum === 48 && hasPrivacy) {
        hasWpa2 = true;
        if (tagLen >= 8) {
          const pairwiseCount = buffer[tagDataStart + 6] | (buffer[tagDataStart + 7] << 8);
          const akmOffset = tagDataStart + 8 + (pairwiseCount * 4);
          if (akmOffset + 2 <= tagDataEnd) {
            const akmCount = buffer[akmOffset] | (buffer[akmOffset + 1] << 8);
            const akmListStart = akmOffset + 2;
            let akmHasPsk = false;
            let akmHasSae = false;

            for (let k = 0; k < akmCount; k++) {
              const suiteStart = akmListStart + (k * 4);
              if (suiteStart + 4 <= tagDataEnd) {
                const suiteType = buffer[suiteStart + 3];
                if (suiteType === 2 || suiteType === 6) { // PSK or FT-PSK (WPA2)
                  akmHasPsk = true;
                }
                if (suiteType === 8 || suiteType === 9) { // SAE or FT-SAE (WPA3)
                  akmHasSae = true;
                  hasWpa3 = true;
                }
              }
            }

            // Flag Mixed-Mode when both WPA2 (PSK) and WPA3 (SAE) are advertised simultaneously
            if (akmHasPsk && akmHasSae) {
              isMixedMode = true;
            }

            // Parse RSN Capabilities (2 bytes uint16 LE)
            const rsnCapOffset = akmListStart + (akmCount * 4);
            if (rsnCapOffset + 2 <= tagDataEnd) {
              const rsnCap = buffer[rsnCapOffset] | (buffer[rsnCapOffset + 1] << 8);
              // Bit 6: MFP Capable (0x0040)
              // Bit 7: MFP Required (0x0080)
              if ((rsnCap & 0x0080) !== 0) {
                isMfpRequired = true;
                isMfpCapable = true;
                mfp = 'required';
              } else if ((rsnCap & 0x0040) !== 0) {
                isMfpCapable = true;
                mfp = 'supported';
              }
            }
          }
        }
      }

      // Tag 54 (0x36): Mobility Domain (802.11r Fast BSS Transition)
      if (tagNum === 54 && tagLen >= 2) {
        roaming.r = true;
      }

      // Tag 70 (0x46): Radio Measurement (RM) Enabled Capabilities (802.11k)
      if (tagNum === 70 && tagLen >= 1) {
        roaming.k = true;
      }

      // Tag 127 (0x7F): Extended Capabilities (802.11v BSS Transition Management)
      if (tagNum === 127 && tagLen >= 3) {
        // Octet 3 (index 2), bit 19 overall -> bit 3 of octet 3 (0x08)
        if ((buffer[tagDataStart + 2] & 0x08) !== 0) {
          roaming.v = true;
        } else {
          // Fallback: If tag 127 is present on enterprise APs, flag 802.11v if length >= 3
          roaming.v = true;
        }
      }

      // Tag 221 (0xDD): Vendor Specific WPA1 IE
      if (tagNum === 221 && tagLen >= 4 && hasPrivacy) {
        if (
          buffer[tagDataStart] === 0x00 &&
          buffer[tagDataStart + 1] === 0x50 &&
          buffer[tagDataStart + 2] === 0xF2 &&
          buffer[tagDataStart + 3] === 0x01
        ) {
          hasWpa = true;
        }
      }

      // Tag 255 (0xFF): Extension Element (802.11ax Wi-Fi 6 HE Capabilities / HE Operation)
      if (tagNum === 255 && tagLen >= 1) {
        const extId = buffer[tagDataStart];
        if (extId === 35) { // HE Capabilities (Element ID Extension 35)
          isWifi6 = true;
          const macCap = tagLen >= 7
            ? Array.from(buffer.slice(tagDataStart + 1, Math.min(tagDataEnd, tagDataStart + 7)))
                .map(b => b.toString(16).padStart(2, '0')).join('')
            : null;
          const phyCap = tagLen >= 18
            ? Array.from(buffer.slice(tagDataStart + 7, Math.min(tagDataEnd, tagDataStart + 18)))
                .map(b => b.toString(16).padStart(2, '0')).join('')
            : null;
          heCapabilities = { macCap, phyCap, extId };
        } else if (extId === 36) { // HE Operation (Element ID Extension 36)
          isWifi6 = true;
          if (tagLen >= 2) {
            const opByte0 = buffer[tagDataStart + 1];
            // Bits 0-5: BSS Color (0..63)
            // Bit 6: Partial BSS Color
            // Bit 7: BSS Color Disabled
            bssColor = opByte0 & 0x3F;
            bssColorDisabled = Boolean(opByte0 & 0x80);
          }
        }
      }

      pos = tagDataEnd;
    }

    if (isMixedMode) {
      security = 'WPA2/WPA3 Mixed';
    } else if (hasWpa3) {
      security = 'WPA3';
    } else if (hasWpa2) {
      security = 'WPA2';
    } else if (hasWpa) {
      security = 'WPA';
    }
  } else if ((subtype === 4 || subtype === 0 || subtype === 2) && bodyStart < buffer.length) {
    // Tag parsing for Probe Requests (4), Association Requests (0), Reassociation Requests (2)
    let pos = bodyStart;
    let foundSsid = false;
    while (pos + 2 <= buffer.length) {
      const tagNum = buffer[pos];
      const tagLen = buffer[pos + 1];
      const tagDataStart = pos + 2;
      const tagDataEnd = tagDataStart + tagLen;
      if (tagDataEnd > buffer.length) break;

      tagSequence.push(tagNum);

      if (tagNum === 0 && !foundSsid) {
        if (tagLen === 0) {
          ssid = subtype === 4 ? '<Wildcard Probe>' : '<Hidden SSID>';
        } else {
          try {
            const rawSsid = buffer.slice(tagDataStart, tagDataEnd);
            ssid = new TextDecoder('utf-8', { fatal: false }).decode(rawSsid).trim() || (subtype === 4 ? '<Wildcard Probe>' : '<Hidden SSID>');
          } catch (e) {
            ssid = subtype === 4 ? '<Wildcard Probe>' : '<Corrupted SSID>';
          }
        }
        foundSsid = true;
      }
      pos = tagDataEnd;
    }
  }

  const signature = tagSequence.length > 0 ? tagSequence.join(',') : null;

  return {
    type: typeStr,
    frameCategory: 'Management',
    sourceMac,
    destinationMac,
    bssid: bssidMac,
    stationMac,
    ssid,
    security,
    isMixedMode: Boolean(isMixedMode),
    mfp,
    isMfpCapable: Boolean(isMfpCapable),
    isMfpRequired: Boolean(isMfpRequired),
    isWifi6: Boolean(isWifi6),
    heCapabilities,
    bssColor,
    bssColorDisabled: Boolean(bssColorDisabled),
    roaming: { ...roaming },
    rssi,
    noiseFloor,
    snr,
    channel,
    isDeauth,
    reasonCode,
    reasonDescription,
    tagSequence,
    signature,
    timestamp: timeStr,
    lastSeen: timeStr,
    vendor: lookupVendor(stationMac || sourceMac),
    length: buffer.length,
    duration
  };
}

const IGNORED_ANOMALY_PROBES = new Set(['', '<Wildcard Probe>', '<Hidden SSID>', '<Unknown>', '-']);

/**
 * Correlates discovery / association frames to unmask hidden Access Point SSIDs.
 * If an AP has a hidden/unknown SSID and a frame with a valid cleartext SSID addresses
 * that AP's BSSID, the AP is unmasked.
 * 
 * @param {Object} devices - Map of BSSID -> AP record
 * @param {Object} frame - Parsed 802.11 frame
 * @returns {Object|null} The unmasked AP object, or null if no unmasking occurred
 */
export function correlateHiddenAp(devices, frame) {
  if (!devices || !frame || !frame.ssid) return null;
  const rawSsid = frame.ssid.trim();
  if (IGNORED_ANOMALY_PROBES.has(rawSsid) || rawSsid.length === 0) return null;

  // Potential target BSSIDs (frame.bssid or frame.destinationMac)
  const candidateBssids = [frame.bssid, frame.destinationMac].filter(
    b => b && b !== 'FF:FF:FF:FF:FF:FF' && b !== '00:00:00:00:00:00'
  );

  for (const bssid of candidateBssids) {
    const ap = devices[bssid];
    if (ap) {
      const isHidden = !ap.ssid || 
        ap.ssid === '<Hidden SSID>' || 
        ap.ssid === '<Unknown>' || 
        ap.ssid === '-' ||
        ap.originalHidden;

      if (isHidden && ap.ssid !== rawSsid) {
        ap.ssid = rawSsid;
        ap.unmaskedSsid = rawSsid;
        ap.isUnmasked = true;
        ap.originalHidden = true;
        return ap;
      }
    }
  }

  return null;
}

/**
 * Detects client signature randomization.
 * Identifies distinct client MAC addresses broadcasting the identical tag ID signature.
 * 
 * @param {Object|Array} clients - Map of clientMac -> client record or array of clients
 * @param {number} [timeWindowMs=600000] - 10-minute sliding window
 * @returns {{ randomizedMacs: Set<string>, clusters: Array<Object> }}
 */
export function detectSignatureRandomization(clients, timeWindowMs = 600000) {
  const clientList = Array.isArray(clients) ? clients : Object.values(clients || {});
  const signatureGroups = new Map();

  for (const client of clientList) {
    if (!client || !client.clientMac || !client.signature) continue;

    if (!signatureGroups.has(client.signature)) {
      signatureGroups.set(client.signature, []);
    }
    signatureGroups.get(client.signature).push(client);
  }

  const randomizedMacs = new Set();
  const clusters = [];

  for (const [sig, group] of signatureGroups.entries()) {
    const uniqueMacs = Array.from(new Set(group.map(c => c.clientMac)));
    if (uniqueMacs.length < 2) continue;

    // Check timestamps if available
    const parseTs = (client) => {
      if (typeof client.lastSeenTs === 'number') return client.lastSeenTs;
      if (typeof client.timestampTs === 'number') return client.timestampTs;
      return null;
    };

    const timestamps = group.map(parseTs).filter(t => t !== null);
    if (timestamps.length >= 2) {
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      if (maxTs - minTs > timeWindowMs) continue;
    }

    uniqueMacs.forEach(mac => randomizedMacs.add(mac));
    clusters.push({
      signature: sig,
      macCount: uniqueMacs.length,
      macs: uniqueMacs,
      clients: group
    });
  }

  return { randomizedMacs, clusters };
}


/**
 * Detect Identifier Rotation Anomalies (MAC Randomization / Device Rotation).
 * 
 * Heuristic:
 * Track the SSID and Probe Requests sent by devices. If multiple different hardware
 * identifiers (MAC addresses) are broadcasting the exact same sequence of probed SSIDs
 * within a short time window, flag them as a "Potential Identifier Rotation Anomaly".
 * 
 * @param {Object|Array} clients - Map of clientMac -> clientInfo or array of clients
 * @param {Object} [options={}] - Options (timeWindowMs, etc.)
 * @returns {Array<Object>} List of detected rotation anomalies
 */
export function detectIdentifierAnomalies(clients, options = {}) {
  if (!clients) return [];
  const clientList = Array.isArray(clients) ? clients : Object.values(clients);
  const timeWindowMs = options.timeWindowMs ?? 600000; // 10 minutes default window

  const sequenceMap = new Map();

  for (const client of clientList) {
    if (!client || !client.clientMac) continue;

    const probes = client.probedSsids && Array.isArray(client.probedSsids)
      ? client.probedSsids
      : (client.probedSsid ? [client.probedSsid] : []);

    const cleanedProbes = probes
      .map(p => (typeof p === 'string' ? p.trim() : ''))
      .filter(p => p && !IGNORED_ANOMALY_PROBES.has(p));

    if (cleanedProbes.length === 0) continue;

    // Sequence signature representing ordered probe requests
    const signature = cleanedProbes.join(' ➔ ');

    if (!sequenceMap.has(signature)) {
      sequenceMap.set(signature, {
        signature,
        probedSequence: cleanedProbes,
        clients: []
      });
    }

    sequenceMap.get(signature).clients.push(client);
  }

  const anomalies = [];

  for (const [signature, entry] of sequenceMap.entries()) {
    const uniqueMacMap = new Map();
    for (const c of entry.clients) {
      if (!uniqueMacMap.has(c.clientMac)) {
        uniqueMacMap.set(c.clientMac, c);
      }
    }

    const uniqueClients = Array.from(uniqueMacMap.values());
    if (uniqueClients.length < 2) continue; // Normal single MAC

    // Timestamp window check if timestamps are numeric milliseconds
    const parseTs = (client) => {
      if (typeof client.lastSeenTs === 'number') return client.lastSeenTs;
      if (typeof client.timestampTs === 'number') return client.timestampTs;
      return null;
    };

    const timestamps = uniqueClients.map(parseTs).filter(t => t !== null);
    if (timestamps.length >= 2) {
      const minTs = Math.min(...timestamps);
      const maxTs = Math.max(...timestamps);
      if (maxTs - minTs > timeWindowMs) {
        continue;
      }
    }

    const observedMacs = uniqueClients.map(c => c.clientMac);
    const vendors = Array.from(new Set(uniqueClients.map(c => c.vendor || lookupVendor(c.clientMac))));

    anomalies.push({
      id: `anomaly_${signature.replace(/[^a-zA-Z0-9]/g, '_')}`,
      type: 'Potential Identifier Rotation Anomaly',
      signature,
      probedSequence: entry.probedSequence,
      observedMacs,
      vendors,
      deviceCount: uniqueClients.length,
      lastSeen: uniqueClients[uniqueClients.length - 1].lastSeen || 'Recent',
      clients: uniqueClients.map(c => ({
        mac: c.clientMac,
        vendor: c.vendor || lookupVendor(c.clientMac),
        rssi: c.rssi,
        lastSeen: c.lastSeen,
        channel: c.channel
      }))
    });
  }

  return anomalies;
}

/**
 * Enterprise Infrastructure Clustering via MAC OUI & Sequential Addressing.
 * Groups Access Points if:
 * 1. Their first 5 bytes of the MAC address are identical, OR
 * 2. Their MAC addresses are within a sequential range (default ±5) AND share the same OUI (first 3 bytes).
 *
 * @param {Array<Object>} devices - Array of AP device objects
 * @param {Object} [options] - Configuration options
 * @param {number} [options.minClusterSize=2] - Minimum device count to qualify as a cluster
 * @param {number} [options.maxSequentialDiff=5] - Maximum sequential address difference
 * @param {boolean} [options.includeSingles=false] - Whether to include unclustered singletons
 * @returns {Array<Object>} List of cluster group objects
 */
export function clusterInfrastructure(devices = [], options = {}) {
  if (!Array.isArray(devices) || devices.length === 0) return [];

  const minClusterSize = options.minClusterSize !== undefined ? options.minClusterSize : 2;
  const maxSequentialDiff = options.maxSequentialDiff !== undefined ? options.maxSequentialDiff : 5;
  const includeSingles = Boolean(options.includeSingles);

  const getMac = (d) => (d.bssid || d.mac || d.sourceMac || d.source || '').toUpperCase();

  const parseMac = (macStr) => {
    if (!macStr || typeof macStr !== 'string') return null;
    const parts = macStr.trim().split(/[:-]/);
    if (parts.length !== 6) return null;
    const bytes = parts.map(p => parseInt(p, 16));
    if (bytes.some(b => isNaN(b) || b < 0 || b > 255)) return null;
    return bytes;
  };

  const getNicNumber = (bytes) => (bytes[3] << 16) | (bytes[4] << 8) | bytes[5];

  const parsedItems = devices.map((dev, index) => {
    const mac = getMac(dev);
    const bytes = parseMac(mac);
    return { dev, index, mac, bytes };
  }).filter(item => item.bytes !== null);

  if (parsedItems.length === 0) return [];

  // Disjoint-set / Union-Find data structure
  const parent = Array.from({ length: parsedItems.length }, (_, i) => i);
  const find = (i) => {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  };
  const union = (i, j) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  };

  // Compare each pair
  for (let i = 0; i < parsedItems.length; i++) {
    const p1 = parsedItems[i];
    for (let j = i + 1; j < parsedItems.length; j++) {
      const p2 = parsedItems[j];

      // Check 1: First 5 bytes identical
      const first5Match = 
        p1.bytes[0] === p2.bytes[0] &&
        p1.bytes[1] === p2.bytes[1] &&
        p1.bytes[2] === p2.bytes[2] &&
        p1.bytes[3] === p2.bytes[3] &&
        p1.bytes[4] === p2.bytes[4];

      if (first5Match) {
        union(i, j);
        continue;
      }

      // Check 2: Same OUI (first 3 bytes) AND sequential within ±maxSequentialDiff
      const sameOui = 
        p1.bytes[0] === p2.bytes[0] &&
        p1.bytes[1] === p2.bytes[1] &&
        p1.bytes[2] === p2.bytes[2];

      if (sameOui) {
        const nic1 = getNicNumber(p1.bytes);
        const nic2 = getNicNumber(p2.bytes);
        if (Math.abs(nic1 - nic2) <= maxSequentialDiff) {
          union(i, j);
        }
      }
    }
  }

  // Aggregate into groups
  const groupsMap = new Map();
  for (let i = 0; i < parsedItems.length; i++) {
    const root = find(i);
    if (!groupsMap.has(root)) {
      groupsMap.set(root, []);
    }
    groupsMap.get(root).push(parsedItems[i].dev);
  }

  const clusters = [];
  let clusterIndex = 1;

  for (const [, members] of groupsMap.entries()) {
    const isCluster = members.length >= 2;
    if (!isCluster && !includeSingles) {
      continue;
    }

    const firstDev = members[0];
    const mac = getMac(firstDev);
    const oui = mac.slice(0, 8);
    const vendor = firstDev.vendor || lookupVendor(mac) || 'Unknown Vendor';
    const clusterId = `cluster_${oui.replace(/[^a-zA-Z0-9]/g, '')}_${clusterIndex++}`;
    const name = isCluster 
      ? `${vendor} - Node Group (${members.length} APs)`
      : (firstDev.ssid || firstDev.bssid || 'Single AP');

    const ssids = Array.from(new Set(members.map(m => m.ssid).filter(Boolean)));
    const channels = Array.from(new Set(members.map(m => m.channel).filter(c => c !== undefined && c !== null)));
    const maxRssi = Math.max(...members.map(m => typeof m.rssi === 'number' ? m.rssi : -100));

    clusters.push({
      id: clusterId,
      name,
      vendor,
      oui,
      count: members.length,
      devices: members,
      isCluster,
      bssid: isCluster ? `${oui}:XX:XX (Cluster)` : (firstDev.bssid || mac),
      ssid: ssids.length === 1 ? ssids[0] : (ssids.length > 1 ? `${ssids[0]} (+${ssids.length - 1} more)` : (firstDev.ssid || 'Cluster')),
      channel: channels.join(', '),
      rssi: maxRssi > -100 ? maxRssi : (firstDev.rssi || -60),
      security: firstDev.security || 'WPA2'
    });
  }

  return clusters;
}


