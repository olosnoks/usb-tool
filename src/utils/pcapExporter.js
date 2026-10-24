/**
 * PCAP Exporter for Wireshark Integration
 * Generates standard libpcap files with LINKTYPE_IEEE802_11_RADIOTAP (127).
 */

const PCAP_MAGIC = 0xa1b2c3d4;
const PCAP_VERSION_MAJOR = 2;
const PCAP_VERSION_MINOR = 4;
const PCAP_LINKTYPE_RADIOTAP = 127; // IEEE 802.11 plus radiotap header
const PCAP_SNAPLEN = 65535;

/**
 * Generate a PCAP binary buffer from an array of raw packet buffers.
 * @param {Array<Uint8Array|{data: Uint8Array, timestamp?: number}>} packets 
 * @returns {Uint8Array}
 */
export function generatePcapBuffer(packets) {
  const packetList = packets || [];
  
  // Calculate total buffer size: 24-byte global header + (16-byte record header + packet bytes)
  let totalLength = 24;
  const normalizedPackets = [];

  for (const item of packetList) {
    let bytes;
    let tsMs = Date.now();

    if (item instanceof Uint8Array) {
      bytes = item;
    } else if (item && item.data instanceof Uint8Array) {
      bytes = item.data;
      if (typeof item.timestamp === 'number') {
        tsMs = item.timestamp;
      }
    } else if (Array.isArray(item)) {
      bytes = new Uint8Array(item);
    }

    if (bytes && bytes.length > 0) {
      const capLen = Math.min(bytes.length, PCAP_SNAPLEN);
      normalizedPackets.push({ bytes: bytes.slice(0, capLen), origLen: bytes.length, tsMs });
      totalLength += 16 + capLen;
    }
  }

  const pcapBuffer = new Uint8Array(totalLength);
  const view = new DataView(pcapBuffer.buffer);

  // --- 1. Global PCAP Header (24 bytes) ---
  // Magic Number (0xa1b2c3d4 = Little-Endian standard)
  view.setUint32(0, PCAP_MAGIC, true);
  // Major Version (2)
  view.setUint16(4, PCAP_VERSION_MAJOR, true);
  // Minor Version (4)
  view.setUint16(6, PCAP_VERSION_MINOR, true);
  // Timezone GMT correction (0)
  view.setInt32(8, 0, true);
  // Timestamp accuracy / sigfigs (0)
  view.setUint32(12, 0, true);
  // Snaplen (65535)
  view.setUint32(16, PCAP_SNAPLEN, true);
  // LinkType (127 = LINKTYPE_IEEE802_11_RADIOTAP)
  view.setUint32(20, PCAP_LINKTYPE_RADIOTAP, true);

  // --- 2. Packet Records (16 bytes header + payload) ---
  let offset = 24;
  for (const pkt of normalizedPackets) {
    const sec = Math.floor(pkt.tsMs / 1000);
    const usec = (pkt.tsMs % 1000) * 1000;
    const inclLen = pkt.bytes.length;

    // ts_sec
    view.setUint32(offset, sec, true);
    // ts_usec
    view.setUint32(offset + 4, usec, true);
    // incl_len
    view.setUint32(offset + 8, inclLen, true);
    // orig_len
    view.setUint32(offset + 12, pkt.origLen, true);

    offset += 16;
    pcapBuffer.set(pkt.bytes, offset);
    offset += inclLen;
  }

  return pcapBuffer;
}

/**
 * Generate a downloadable PCAP Blob for Wireshark.
 * @param {Array<Uint8Array|{data: Uint8Array, timestamp?: number}>} packets 
 * @returns {Blob}
 */
export function generatePcap(packets) {
  const buffer = generatePcapBuffer(packets);
  return new Blob([buffer], { type: 'application/vnd.tcpdump.pcap' });
}

/**
 * Trigger download of PCAP file in browser.
 * @param {Array<Uint8Array>} packets 
 * @param {string} filename 
 */
export function downloadPcap(packets, filename) {
  const blob = generatePcap(packets);
  const url = URL.createObjectURL(blob);
  const name = filename || `wifi_capture_${new Date().toISOString().replace(/[:.]/g, '-')}.pcap`;
  
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Helper to format 6 raw bytes into an uppercase colon-delimited MAC string.
 * @param {Uint8Array} buf 
 * @param {number} offset 
 * @returns {string}
 */
function formatMacAtOffset(buf, offset) {
  if (offset + 6 > buf.length) return '';
  const parts = [];
  for (let i = 0; i < 6; i++) {
    parts.push(buf[offset + i].toString(16).padStart(2, '0').toUpperCase());
  }
  return parts.join(':');
}

/**
 * Extract MAC addresses (Addr1, Addr2, Addr3, Addr4) from an 802.11 frame (with or without Radiotap header).
 * @param {Uint8Array} buffer 
 * @returns {string[]}
 */
export function extractMacsFromPacket(buffer) {
  if (!buffer || buffer.length < 10) return [];

  let headerOffset = 0;

  // Check for Radiotap header: header revision is typically 0 at buffer[0]
  if (buffer.length >= 4) {
    const radiotapLen = buffer[2] | (buffer[3] << 8);
    if (radiotapLen > 0 && radiotapLen + 10 <= buffer.length) {
      headerOffset = radiotapLen;
    }
  }

  // Minimum 802.11 frame with Addr1 is headerOffset + 10 bytes
  if (headerOffset + 10 > buffer.length) return [];

  const macs = [];

  // Address 1 (Destination / RA): bytes 4..9
  const addr1 = formatMacAtOffset(buffer, headerOffset + 4);
  if (addr1) macs.push(addr1);

  // Address 2 (Source / TA): bytes 10..15
  if (headerOffset + 16 <= buffer.length) {
    const addr2 = formatMacAtOffset(buffer, headerOffset + 10);
    if (addr2) macs.push(addr2);
  }

  // Address 3 (BSSID / Filtering): bytes 16..21
  if (headerOffset + 22 <= buffer.length) {
    const addr3 = formatMacAtOffset(buffer, headerOffset + 16);
    if (addr3) macs.push(addr3);
  }

  // Address 4 (WDS mode): bytes 24..29
  // Check if Frame Control To DS and From DS bits are set (bits 0 and 1 of byte 1)
  const fcByte1 = buffer[headerOffset + 1];
  if ((fcByte1 & 0x03) === 0x03 && headerOffset + 30 <= buffer.length) {
    const addr4 = formatMacAtOffset(buffer, headerOffset + 24);
    if (addr4) macs.push(addr4);
  }

  return macs;
}

/**
 * Filter an array of raw packet buffers to only those matching a specific MAC address.
 * Matches against Address 1, Address 2, Address 3, or Address 4 of the 802.11 header.
 * 
 * @param {Array<Uint8Array|{data: Uint8Array, timestamp?: number}>} packets 
 * @param {string} targetMac 
 * @returns {Array<Uint8Array|{data: Uint8Array, timestamp?: number}>}
 */
export function filterPacketsByMac(packets, targetMac) {
  if (!packets || !Array.isArray(packets)) return [];
  if (!targetMac || targetMac === '*' || targetMac.toUpperCase() === 'ANY') {
    return [...packets];
  }

  const normalizedTarget = targetMac.trim().replace(/[-.]/g, ':').toUpperCase();

  return packets.filter(item => {
    let buf = null;
    if (item instanceof Uint8Array) {
      buf = item;
    } else if (item && item.data instanceof Uint8Array) {
      buf = item.data;
    } else if (Array.isArray(item)) {
      buf = new Uint8Array(item);
    }

    if (!buf) return false;

    const macs = extractMacsFromPacket(buf);
    return macs.includes(normalizedTarget);
  });
}

/**
 * Downloads a targeted PCAP containing only packets related to a specific MAC address.
 * @param {Array<Uint8Array|{data: Uint8Array, timestamp?: number}>} packets 
 * @param {string} targetMac 
 * @param {string} [filename] 
 * @returns {number} Number of packets extracted and downloaded
 */
export function downloadTargetedPcap(packets, targetMac, filename) {
  const filtered = filterPacketsByMac(packets, targetMac);
  const cleanMac = (targetMac || 'all').replace(/[:.-]/g, '').toLowerCase();
  const name = filename || `device_${cleanMac}_${new Date().toISOString().replace(/[:.]/g, '-')}.pcap`;
  downloadPcap(filtered, name);
  return filtered.length;
}

