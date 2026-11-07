// Dependency-free parser for classic libpcap (.pcap) capture files.
// Parses the global header and per-packet records, then decodes Ethernet II ->
// IPv4/IPv6 -> TCP/UDP/ICMP enough to produce a readable packet list.
// pcapng (.pcapng) is detected and reported as unsupported rather than
// mis-parsed.

const LINKTYPE_ETHERNET = 1;
const LINKTYPE_RAW = 101;
const LINKTYPE_NULL = 0;

function u16(dv, o, le) { return dv.getUint16(o, le); }
function u32(dv, o, le) { return dv.getUint32(o, le); }

function fmtMac(b, o) {
  return Array.from({ length: 6 }, (_, i) => b[o + i].toString(16).padStart(2, '0')).join(':');
}
function fmtIPv4(b, o) {
  return `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
}
function fmtIPv6(b, o) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) parts.push(((b[o + i] << 8) | b[o + i + 1]).toString(16));
  return parts.join(':').replace(/(:0)+:/, '::');
}

function decodeIP(bytes, off, out) {
  const ipVer = bytes[off] >> 4;
  if (ipVer === 4) {
    const ihl = (bytes[off] & 0x0f) * 4;
    out.src = fmtIPv4(bytes, off + 12);
    out.dst = fmtIPv4(bytes, off + 16);
    const proto = bytes[off + 9];
    decodeL4(bytes, off + ihl, proto, out);
  } else if (ipVer === 6) {
    out.src = fmtIPv6(bytes, off + 8);
    out.dst = fmtIPv6(bytes, off + 24);
    decodeL4(bytes, off + 40, bytes[off + 6], out);
  }
}

function decodeL4(bytes, off, proto, out) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  if (proto === 6) { out.proto = 'TCP'; out.sport = dv.getUint16(off); out.dport = dv.getUint16(off + 2); out.info = tcpFlags(bytes[off + 13]); }
  else if (proto === 17) { out.proto = 'UDP'; out.sport = dv.getUint16(off); out.dport = dv.getUint16(off + 2); }
  else if (proto === 1) { out.proto = 'ICMP'; out.info = `type ${bytes[off]}`; }
  else if (proto === 58) { out.proto = 'ICMPv6'; out.info = `type ${bytes[off]}`; }
  else out.proto = `IP proto ${proto}`;
}

function tcpFlags(b) {
  const f = [];
  if (b & 0x02) f.push('SYN');
  if (b & 0x10) f.push('ACK');
  if (b & 0x01) f.push('FIN');
  if (b & 0x04) f.push('RST');
  if (b & 0x08) f.push('PSH');
  if (b & 0x20) f.push('URG');
  return f.join(',');
}

function decodeFrame(bytes, linktype, out) {
  if (linktype === LINKTYPE_ETHERNET) {
    out.ethSrc = fmtMac(bytes, 6);
    out.ethDst = fmtMac(bytes, 0);
    const etype = (bytes[12] << 8) | bytes[13];
    if (etype === 0x0800) { out.l3 = 'IPv4'; decodeIP(bytes, 14, out); }
    else if (etype === 0x86dd) { out.l3 = 'IPv6'; decodeIP(bytes, 14, out); }
    else if (etype === 0x0806) { out.l3 = 'ARP'; out.proto = 'ARP'; }
    else out.l3 = `0x${etype.toString(16)}`;
  } else if (linktype === LINKTYPE_RAW) {
    out.l3 = (bytes[0] >> 4) === 6 ? 'IPv6' : 'IPv4';
    decodeIP(bytes, 0, out);
  } else if (linktype === LINKTYPE_NULL) {
    decodeIP(bytes, 4, out); // BSD loopback: 4-byte family header
  } else {
    out.l3 = `linktype ${linktype}`;
  }
}

/**
 * Parse an ArrayBuffer of a .pcap file. Returns { linktype, packets: [...] } or
 * throws with a clear message for unsupported formats.
 */
export function parsePcap(arrayBuffer, maxPackets = 5000) {
  const dv = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  if (arrayBuffer.byteLength < 24) throw new Error('File too small to be a pcap');

  const magic = dv.getUint32(0, false);
  if (magic === 0x0a0d0d0a) {
    throw new Error('This is a pcapng file. Only classic .pcap is supported; convert with: editcap -F pcap in.pcapng out.pcap');
  }
  let le;
  if (magic === 0xa1b2c3d4) le = false;
  else if (magic === 0xd4c3b2a1) le = true;
  else if (magic === 0xa1b23c4d) le = false; // nanosecond variant
  else if (magic === 0x4d3cb2a1) le = true;
  else throw new Error(`Not a pcap file (bad magic 0x${magic.toString(16)})`);

  const linktype = u32(dv, 20, le);
  const packets = [];
  let off = 24;
  let n = 0;
  while (off + 16 <= arrayBuffer.byteLength && n < maxPackets) {
    const tsSec = u32(dv, off, le);
    const tsSub = u32(dv, off + 4, le);
    const caplen = u32(dv, off + 8, le);
    const origlen = u32(dv, off + 12, le);
    off += 16;
    if (off + caplen > arrayBuffer.byteLength) break;
    const frame = bytes.subarray(off, off + caplen);
    const rec = { index: n + 1, ts: tsSec + tsSub / 1e6, caplen, origlen, l3: '', proto: '' };
    try { decodeFrame(frame, linktype, rec); } catch { /* leave partial decode */ }
    packets.push(rec);
    off += caplen;
    n++;
  }
  return { linktype, packetCount: packets.length, packets };
}
