/**
 * Layer 3 (IP, ARP & DHCP) Telemetry Parser
 * 
 * Extracts unencrypted Layer 3 metadata from 802.11 Data frame payloads:
 * - ARP (EtherType 0x0806): Sender Hardware Address (MAC) & Sender Protocol Address (IP)
 * - DHCP (UDP Port 67/68): Client Hardware MAC (chaddr), Assigned/Requested IP (yiaddr/ciaddr), and DHCP Hostname (Option 12)
 */

/**
 * Format 4 bytes into IPv4 dot-decimal string.
 * @param {Uint8Array|Array} bytes 
 * @param {number} start 
 * @returns {string}
 */
export function formatIpv4(bytes, start = 0) {
  if (!bytes || bytes.length < start + 4) return '0.0.0.0';
  return `${bytes[start]}.${bytes[start + 1]}.${bytes[start + 2]}.${bytes[start + 3]}`;
}

/**
 * Format 6 bytes into colon-separated MAC string.
 * @param {Uint8Array|Array} bytes 
 * @param {number} start 
 * @returns {string}
 */
export function formatMacAddress(bytes, start = 0) {
  if (!bytes || bytes.length < start + 6) return '00:00:00:00:00:00';
  return Array.from(bytes.slice(start, start + 6))
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Parses an ARP packet from a byte buffer at a given payload offset.
 * 
 * @param {Uint8Array} buffer 
 * @param {number} offset - Start of ARP payload
 * @returns {{ protocol: 'ARP', op: 'Request'|'Reply', mac: string, ip: string, targetMac: string, targetIp: string }|null}
 */
export function parseArpPayload(buffer, offset = 0) {
  if (!buffer || buffer.length < offset + 28) return null;

  const htype = (buffer[offset] << 8) | buffer[offset + 1];
  const ptype = (buffer[offset + 2] << 8) | buffer[offset + 3];
  const hlen = buffer[offset + 4];
  const plen = buffer[offset + 5];
  const opcode = (buffer[offset + 6] << 8) | buffer[offset + 7];

  // Must be Ethernet (1) and IPv4 (0x0800) with MAC len 6 and IPv4 len 4
  if (htype !== 1 || ptype !== 0x0800 || hlen !== 6 || plen !== 4) {
    return null;
  }

  const senderMac = formatMacAddress(buffer, offset + 8);
  const senderIp = formatIpv4(buffer, offset + 14);
  const targetMac = formatMacAddress(buffer, offset + 18);
  const targetIp = formatIpv4(buffer, offset + 24);

  // Ignore 0.0.0.0 or broadcast MAC
  if (senderIp === '0.0.0.0' && targetIp === '0.0.0.0') {
    return null;
  }

  return {
    protocol: 'ARP',
    op: opcode === 1 ? 'Request' : opcode === 2 ? 'Reply' : `Opcode ${opcode}`,
    mac: senderMac,
    ip: senderIp !== '0.0.0.0' ? senderIp : targetIp,
    targetMac,
    targetIp
  };
}

/**
 * Parses a DHCP payload from a byte buffer at a given payload offset.
 * 
 * @param {Uint8Array} buffer 
 * @param {number} offset - Start of BOOTP/DHCP payload
 * @returns {{ protocol: 'DHCP', mac: string, ip: string, hostname: string|null, messageType?: string }|null}
 */
export function parseDhcpPayload(buffer, offset = 0) {
  if (!buffer || buffer.length < offset + 240) return null;

  // Verify BOOTP op: 1 = BOOTREQUEST (Client), 2 = BOOTREPLY (Server)
  const op = buffer[offset];
  if (op !== 1 && op !== 2) return null;

  const htype = buffer[offset + 1];
  const hlen = buffer[offset + 2];
  if (htype !== 1 || hlen !== 6) return null;

  // Verify DHCP Magic Cookie: 0x63, 0x82, 0x53, 0x63 at offset + 236
  if (
    buffer[offset + 236] !== 0x63 ||
    buffer[offset + 237] !== 0x82 ||
    buffer[offset + 238] !== 0x53 ||
    buffer[offset + 239] !== 0x63
  ) {
    return null;
  }

  const ciaddr = formatIpv4(buffer, offset + 12); // Client IP
  const yiaddr = formatIpv4(buffer, offset + 16); // 'Your' assigned IP
  const clientMac = formatMacAddress(buffer, offset + 28); // Client Hardware Address (chaddr)

  let hostname = null;
  let requestedIp = null;
  let messageType = null;

  // Parse DHCP Options starting at offset + 240
  let optPos = offset + 240;
  while (optPos < buffer.length) {
    const opt = buffer[optPos];
    if (opt === 0) { // Pad option
      optPos++;
      continue;
    }
    if (opt === 255) { // End option
      break;
    }

    if (optPos + 1 >= buffer.length) break;
    const len = buffer[optPos + 1];
    const dataStart = optPos + 2;
    const dataEnd = dataStart + len;
    if (dataEnd > buffer.length) break;

    if (opt === 12 && len > 0) {
      // Option 12: Host Name
      try {
        const raw = buffer.slice(dataStart, dataEnd);
        hostname = new TextDecoder('utf-8', { fatal: false }).decode(raw).trim() || null;
      } catch (e) {
        hostname = null;
      }
    } else if (opt === 50 && len === 4) {
      // Option 50: Requested IP Address
      requestedIp = formatIpv4(buffer, dataStart);
    } else if (opt === 53 && len === 1) {
      // Option 53: DHCP Message Type
      const typeNum = buffer[dataStart];
      const types = {
        1: 'Discover',
        2: 'Offer',
        3: 'Request',
        4: 'Decline',
        5: 'ACK',
        6: 'NAK',
        7: 'Release',
        8: 'Inform'
      };
      messageType = types[typeNum] || `Type ${typeNum}`;
    }

    optPos = dataEnd;
  }

  // Determine active IP (yiaddr takes priority for assigned IP, then ciaddr, then requested IP)
  const resolvedIp = yiaddr !== '0.0.0.0' 
    ? yiaddr 
    : (ciaddr !== '0.0.0.0' ? ciaddr : (requestedIp || '0.0.0.0'));

  if (clientMac === '00:00:00:00:00:00') return null;

  return {
    protocol: 'DHCP',
    mac: clientMac,
    ip: resolvedIp !== '0.0.0.0' ? resolvedIp : null,
    hostname,
    messageType
  };
}

/**
 * Extracts Layer 3 metadata (ARP or DHCP mappings) from an unencrypted 802.11 Data frame buffer.
 * 
 * @param {Uint8Array} buffer - Complete raw frame buffer
 * @param {number} macOffset - Offset where 802.11 MAC header starts
 * @param {boolean} isQoS - Whether frame is QoS Data (subtype 8)
 * @returns {{ protocol: 'ARP'|'DHCP', mac: string, ip: string|null, hostname: string|null, details?: string }|null}
 */
export function extractLayer3Metadata(buffer, macOffset = 0, isQoS = false) {
  if (!buffer || buffer.length < macOffset + 24) return null;

  // Frame Control check: Bit 14 is Protected / Encrypted frame
  const fc = buffer[macOffset] | (buffer[macOffset + 1] << 8);
  if ((fc & 0x4000) !== 0) return null; // Encrypted frame cannot expose cleartext Layer 3

  const macHeaderLen = isQoS ? 26 : 24;
  let payloadOffset = macOffset + macHeaderLen;
  if (payloadOffset >= buffer.length) return null;

  // 1. Check for standard 802.11 LLC/SNAP encapsulation
  // AA AA 03 [3-byte OUI: 00 00 00] [2-byte EtherType]
  if (
    buffer.length >= payloadOffset + 8 &&
    buffer[payloadOffset] === 0xAA &&
    buffer[payloadOffset + 1] === 0xAA &&
    buffer[payloadOffset + 2] === 0x03
  ) {
    const etherType = (buffer[payloadOffset + 6] << 8) | buffer[payloadOffset + 7];

    // Case A: ARP (EtherType 0x0806)
    if (etherType === 0x0806) {
      return parseArpPayload(buffer, payloadOffset + 8);
    }

    // Case B: IPv4 (EtherType 0x0800) -> Check for DHCP UDP port 67/68
    if (etherType === 0x0800) {
      const ipOffset = payloadOffset + 8;
      if (ipOffset + 20 <= buffer.length) {
        const version = buffer[ipOffset] >> 4;
        const ihl = (buffer[ipOffset] & 0x0F) * 4;
        const protocol = buffer[ipOffset + 9];

        if (version === 4 && protocol === 17 && ipOffset + ihl + 8 <= buffer.length) {
          const udpOffset = ipOffset + ihl;
          const srcPort = (buffer[udpOffset] << 8) | buffer[udpOffset + 1];
          const dstPort = (buffer[udpOffset + 2] << 8) | buffer[udpOffset + 3];

          if ((srcPort === 67 && dstPort === 68) || (srcPort === 68 && dstPort === 67)) {
            return parseDhcpPayload(buffer, udpOffset + 8);
          }
        }
      }
    }
  }

  // 2. Direct / Fallback scan for ARP packet structure without standard LLC/SNAP
  if (payloadOffset + 28 <= buffer.length) {
    const directArp = parseArpPayload(buffer, payloadOffset);
    if (directArp) return directArp;
  }

  // 3. Fallback scan for DHCP Magic Cookie in unencrypted payload
  for (let i = payloadOffset; i <= buffer.length - 240; i++) {
    if (
      buffer[i] === 0x63 &&
      buffer[i + 1] === 0x82 &&
      buffer[i + 2] === 0x53 &&
      buffer[i + 3] === 0x63
    ) {
      // Magic cookie is at offset + 236 of DHCP payload
      const candidateDhcpStart = i - 236;
      if (candidateDhcpStart >= payloadOffset) {
        const dhcp = parseDhcpPayload(buffer, candidateDhcpStart);
        if (dhcp) return dhcp;
      }
    }
  }

  return null;
}
