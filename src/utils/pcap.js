// Dependency-free parser for libpcap (.pcap) and pcapng (.pcapng) capture files.
// Parses the container (classic global header + records, or pcapng SHB/IDB/EPB/SPB blocks), then decodes
// Ethernet II / 802.1Q / Linux cooked (SLL) / radiotap+802.11 / raw IP / BSD loopback -> IPv4/IPv6 ->
// TCP/UDP/ICMP and a few application one-liners (DNS, HTTP, TLS SNI, DHCP, ARP).
//
// The pcapng block walk follows the same block layout as src/utils/usbrea/pcap.js (_iter_pcapng), which is
// left untouched; this walker additionally keeps the original length, bounds-checks every block and
// reports damage instead of throwing mid-file.
import { parseArpPayload, parseDhcpPayload } from './layer3Parser.js';

export const DEFAULT_MAX_PACKETS = 200000;

export const LINKTYPE_NULL = 0;
export const LINKTYPE_ETHERNET = 1;
export const LINKTYPE_RAW = 101;
export const LINKTYPE_SLL = 113;
export const LINKTYPE_RADIOTAP = 127;
export const LINKTYPE_IPV4 = 228;
export const LINKTYPE_IPV6 = 229;

export const LINKTYPE_NAMES = {
  0: 'NULL/Loopback',
  1: 'Ethernet',
  101: 'Raw IP',
  113: 'Linux cooked (SLL)',
  127: '802.11 + radiotap',
  228: 'Raw IPv4',
  229: 'Raw IPv6',
};

const u16 = (b, o) => ((b[o] << 8) | b[o + 1]) >>> 0;
const u32 = (b, o) => (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);

function fmtMac(b, o) {
  return Array.from({ length: 6 }, (_, i) => (b[o + i] ?? 0).toString(16).padStart(2, '0')).join(':');
}
function fmtIPv4(b, o) {
  return `${b[o]}.${b[o + 1]}.${b[o + 2]}.${b[o + 3]}`;
}
/** Canonical RFC 5952 text: lowercase, longest run (>= 2) of zero groups compressed, leftmost on ties. */
export function fmtIPv6(b, o) {
  const g = [];
  for (let i = 0; i < 16; i += 2) g.push((b[o + i] << 8) | b[o + i + 1]);
  let bestStart = -1;
  let bestLen = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) { bestStart = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (bestLen < 2) return hex.join(':');
  const left = hex.slice(0, bestStart).join(':');
  const right = hex.slice(bestStart + bestLen).join(':');
  return `${left}::${right}`;
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

// ---------------------------------------------------------------- container readers

function toU8(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('Expected an ArrayBuffer or Uint8Array');
}

/** Yield { ts, caplen, origlen, linktype, data } per packet. `info` collects format, linktype, warnings. */
function* readRecords(bytes, info) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const m = dv.getUint32(0, false);
  if (m === 0x0a0d0d0a) {
    info.format = 'pcapng';
    yield* readPcapng(bytes, dv, info);
    return;
  }
  let le;
  let nano = false;
  if (m === 0xa1b2c3d4) le = false;
  else if (m === 0xd4c3b2a1) le = true;
  else if (m === 0xa1b23c4d) { le = false; nano = true; } else if (m === 0x4d3cb2a1) { le = true; nano = true; } else throw new Error(`Not a pcap or pcapng file (bad magic 0x${m.toString(16)})`);
  info.format = 'pcap';
  const linktype = dv.getUint32(20, le);
  info.linktype = linktype;
  let off = 24;
  while (off + 16 <= bytes.length) {
    const sec = dv.getUint32(off, le);
    const sub = dv.getUint32(off + 4, le);
    const caplen = dv.getUint32(off + 8, le);
    const origlen = dv.getUint32(off + 12, le);
    off += 16;
    if (off + caplen > bytes.length) { info.warnings.push('File ends in the middle of a packet record; the last packet was dropped.'); return; }
    yield { ts: sec + sub / (nano ? 1e9 : 1e6), caplen, origlen, linktype, data: bytes.subarray(off, off + caplen) };
    off += caplen;
  }
  if (off < bytes.length) info.warnings.push('Trailing bytes after the last complete packet record were ignored.');
}

function* readPcapng(bytes, dv, info) {
  let off = 0;
  let le = true;
  let ifaces = []; // { linktype, res }
  let sawBlock = false;
  while (off + 12 <= bytes.length) {
    // The byte order is only known from the SHB, so read the block type as a palindrome-safe check first.
    const isShb = bytes[off] === 0x0a && bytes[off + 1] === 0x0d && bytes[off + 2] === 0x0d && bytes[off + 3] === 0x0a;
    if (isShb) {
      const bom = dv.getUint32(off + 8, false);
      if (bom === 0x4d3c2b1a) le = true;
      else if (bom === 0x1a2b3c4d) le = false;
      else { info.warnings.push('Section header with an unknown byte-order magic; stopped reading.'); return; }
      ifaces = [];
    }
    const btype = isShb ? 0x0a0d0d0a : dv.getUint32(off, le);
    const blen = dv.getUint32(off + 4, le);
    if (blen < 12 || blen % 4 !== 0) { info.warnings.push(`Bad pcapng block length ${blen} at offset ${off}; stopped reading.`); return; }
    if (off + blen > bytes.length) { info.warnings.push('File ends in the middle of a pcapng block; the last block was dropped.'); return; }
    sawBlock = true;
    const body = bytes.subarray(off + 8, off + blen - 4);
    const bv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    if (btype === 1 && body.length >= 8) { // IDB
      const linktype = bv.getUint16(0, le);
      let res = 1e-6;
      let o = 8;
      while (o + 4 <= body.length) {
        const code = bv.getUint16(o, le);
        const ln = bv.getUint16(o + 2, le);
        if (code === 0) break;
        if (code === 9 && ln >= 1 && o + 4 < body.length) {
          const v = body[o + 4];
          res = (v & 0x80) ? 2 ** -(v & 0x7f) : 10 ** -v;
        }
        o += 4 + ((ln + 3) & ~3);
      }
      ifaces.push({ linktype, res });
      if (info.linktype === undefined) info.linktype = linktype;
    } else if (btype === 6 && body.length >= 20) { // EPB
      const iid = bv.getUint32(0, le);
      const hi = bv.getUint32(4, le);
      const lo = bv.getUint32(8, le);
      const caplen = bv.getUint32(12, le);
      const origlen = bv.getUint32(16, le);
      const ifc = ifaces[iid];
      if (!ifc) { info.warnings.push(`Packet references unknown interface ${iid}; skipped.`); } else if (20 + caplen > body.length) { info.warnings.push('Enhanced packet block shorter than its captured length; skipped.'); } else {
        yield { ts: (hi * 4294967296 + lo) * ifc.res, caplen, origlen, linktype: ifc.linktype, data: body.subarray(20, 20 + caplen) };
      }
    } else if (btype === 3 && body.length >= 4 && ifaces.length) { // SPB
      const origlen = bv.getUint32(0, le);
      const data = body.subarray(4, 4 + Math.min(origlen, body.length - 4));
      yield { ts: 0, caplen: data.length, origlen, linktype: ifaces[0].linktype, data };
    }
    off += blen;
  }
  if (!sawBlock) throw new Error('pcapng file contains no readable blocks');
}

// ---------------------------------------------------------------- decoders

const L = (out, name, fields) => { if (out.layers) out.layers.push({ name, fields }); };

const DNS_TYPES = { 1: 'A', 2: 'NS', 5: 'CNAME', 6: 'SOA', 12: 'PTR', 15: 'MX', 16: 'TXT', 28: 'AAAA', 33: 'SRV', 41: 'OPT', 43: 'DS', 46: 'RRSIG', 48: 'DNSKEY', 65: 'HTTPS', 255: 'ANY' };
const DNS_RCODES = { 0: 'NOERROR', 1: 'FORMERR', 2: 'SERVFAIL', 3: 'NXDOMAIN', 4: 'NOTIMP', 5: 'REFUSED' };
const IP_PROTOS = { 1: 'ICMP', 2: 'IGMP', 6: 'TCP', 17: 'UDP', 47: 'GRE', 50: 'ESP', 58: 'ICMPv6', 89: 'OSPF', 132: 'SCTP' };
const WIFI_MGMT = { 0: 'Assoc Req', 1: 'Assoc Resp', 2: 'Reassoc Req', 3: 'Reassoc Resp', 4: 'Probe Req', 5: 'Probe Resp', 8: 'Beacon', 10: 'Disassoc', 11: 'Auth', 12: 'Deauth', 13: 'Action' };

function readDnsName(b, start, base, end) {
  const labels = [];
  let o = start;
  let next = -1;
  for (let hops = 0; hops < 32; hops++) {
    if (o >= end) return null;
    const len = b[o];
    if (len === 0) { if (next < 0) next = o + 1; return { name: labels.join('.') || '.', next }; }
    if ((len & 0xc0) === 0xc0) {
      if (o + 1 >= end) return null;
      if (next < 0) next = o + 2;
      o = base + (((len & 0x3f) << 8) | b[o + 1]);
      continue;
    }
    if (o + 1 + len > end) return null;
    labels.push(String.fromCharCode(...b.subarray(o + 1, o + 1 + len)));
    o += 1 + len;
  }
  return null;
}

function decodeDns(b, off, out) {
  if (b.length < off + 12) return false;
  const flags = u16(b, off + 2);
  const qd = u16(b, off + 4);
  const an = u16(b, off + 6);
  if (qd < 1 || qd > 16) return false;
  const q = readDnsName(b, off + 12, off, b.length);
  if (!q || q.next + 4 > b.length) return false;
  const qtype = DNS_TYPES[u16(b, q.next)] || `TYPE${u16(b, q.next)}`;
  const isResp = (flags & 0x8000) !== 0;
  const rcode = flags & 0xf;
  out.proto = 'DNS';
  out.dns = { id: u16(b, off), response: isResp, qname: q.name, qtype, rcode: DNS_RCODES[rcode] || String(rcode), answers: an };
  out.info = isResp ? `Response ${qtype} ${q.name} (${DNS_RCODES[rcode] || rcode}, ${an} answer${an === 1 ? '' : 's'})` : `${qtype} ${q.name}`;
  L(out, 'DNS', [['Transaction ID', `0x${u16(b, off).toString(16)}`], ['Type', isResp ? 'Response' : 'Query'], ['Question', `${q.name} ${qtype}`], ['Rcode', DNS_RCODES[rcode] || String(rcode)], ['Answers', an]]);
  return true;
}

function decodeHttp(b, off, out) {
  const n = Math.min(b.length - off, 200);
  if (n < 8) return false;
  let s = '';
  for (let i = 0; i < n; i++) { const c = b[off + i]; if (c === 0x0d || c === 0x0a) break; s += (c >= 32 && c < 127) ? String.fromCharCode(c) : '.'; }
  if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE) \S+ HTTP\/1\.[01]$/.test(s) || /^HTTP\/1\.[01] \d{3}/.test(s)) {
    out.proto = 'HTTP';
    out.info = s;
    L(out, 'HTTP', [['Line', s]]);
    return true;
  }
  return false;
}

function decodeTls(b, off, out) {
  if (b.length < off + 44 || b[off] !== 0x16 || b[off + 1] !== 3 || b[off + 5] !== 1) return false;
  let ver = (b[off + 9] << 8) | b[off + 10];
  let o = off + 43; // session id length
  o += 1 + b[o];
  o += 2 + u16(b, o); // cipher suites
  o += 1 + b[o]; // compression
  if (o + 2 > b.length) return false;
  const extEnd = Math.min(b.length, o + 2 + u16(b, o));
  o += 2;
  let sni = null;
  while (o + 4 <= extEnd) {
    const type = u16(b, o);
    const len = u16(b, o + 2);
    const d = o + 4;
    if (type === 0 && len >= 5 && d + 5 <= b.length) {
      const nlen = u16(b, d + 3);
      if (d + 5 + nlen <= b.length) sni = String.fromCharCode(...b.subarray(d + 5, d + 5 + nlen));
    } else if (type === 43 && len >= 3) {
      for (let i = d + 1; i + 1 < d + 1 + b[d] && i + 1 < b.length; i += 2) if (u16(b, i) === 0x0304) ver = 0x0304;
    }
    o = d + len;
  }
  const verName = { 0x0301: 'TLS 1.0', 0x0302: 'TLS 1.1', 0x0303: 'TLS 1.2', 0x0304: 'TLS 1.3' }[ver] || `0x${ver.toString(16)}`;
  out.proto = 'TLS';
  out.tls = { sni, version: verName };
  out.info = `Client Hello${sni ? ` SNI=${sni}` : ''} (${verName})`;
  L(out, 'TLS', [['Handshake', 'Client Hello'], ['Version', verName], ['SNI', sni || '(none)']]);
  return true;
}

function decodeL4(b, off, proto, out) {
  out.ipProto = proto;
  if (proto === 6 && b.length >= off + 20) {
    out.l4 = 'TCP';
    out.proto = 'TCP';
    out.sport = u16(b, off);
    out.dport = u16(b, off + 2);
    const hlen = (b[off + 12] >> 4) * 4;
    const flags = tcpFlags(b[off + 13]);
    const pOff = off + Math.max(hlen, 20);
    const plen = Math.max(0, b.length - pOff);
    out.tcp = { seq: u32(b, off + 4), ack: u32(b, off + 8), flagBits: b[off + 13], pOff, plen };
    out.info = flags + (plen ? ` Len=${plen}` : '');
    L(out, 'TCP', [['Source port', out.sport], ['Destination port', out.dport], ['Seq', u32(b, off + 4)], ['Ack', u32(b, off + 8)], ['Flags', flags || '(none)'], ['Payload', `${plen} bytes`]]);
    if (plen > 0) { decodeTls(b, pOff, out) || decodeHttp(b, pOff, out); }
  } else if (proto === 17 && b.length >= off + 8) {
    out.l4 = 'UDP';
    out.proto = 'UDP';
    out.sport = u16(b, off);
    out.dport = u16(b, off + 2);
    L(out, 'UDP', [['Source port', out.sport], ['Destination port', out.dport], ['Length', u16(b, off + 4)]]);
    const pOff = off + 8;
    if (out.sport === 53 || out.dport === 53 || out.sport === 5353 || out.dport === 5353) decodeDns(b, pOff, out);
    else if ((out.sport === 67 || out.sport === 68) && (out.dport === 67 || out.dport === 68)) {
      const d = parseDhcpPayload(b, pOff);
      out.proto = 'DHCP';
      out.info = d ? `${d.messageType || 'DHCP'} ${d.mac}${d.ip ? ` ${d.ip}` : ''}` : 'DHCP';
      L(out, 'DHCP', d ? [['Message', d.messageType || '?'], ['Client MAC', d.mac], ['IP', d.ip || '-'], ['Hostname', d.hostname || '-']] : [['Message', 'unparsed']]);
    }
  } else if (proto === 1) {
    out.l4 = 'ICMP'; out.proto = 'ICMP'; out.info = `type ${b[off]}`;
    L(out, 'ICMP', [['Type', b[off]], ['Code', b[off + 1]]]);
  } else if (proto === 58) {
    out.l4 = 'ICMPv6'; out.proto = 'ICMPv6'; out.info = `type ${b[off]}`;
    L(out, 'ICMPv6', [['Type', b[off]], ['Code', b[off + 1]]]);
  } else {
    out.l4 = IP_PROTOS[proto] || `IP proto ${proto}`;
    out.proto = out.l4;
  }
}

function decodeIP(b, off, out) {
  const ver = b[off] >> 4;
  if (ver === 4 && b.length >= off + 20) {
    out.l3 = 'IPv4';
    const ihl = (b[off] & 0x0f) * 4;
    out.src = fmtIPv4(b, off + 12);
    out.dst = fmtIPv4(b, off + 16);
    const proto = b[off + 9];
    const ff = u16(b, off + 6);
    const fragOff = ff & 0x1fff;
    const more = (ff & 0x2000) !== 0;
    L(out, 'IPv4', [['Source', out.src], ['Destination', out.dst], ['Protocol', IP_PROTOS[proto] || proto], ['TTL', b[off + 8]], ['Flags', `${(ff & 0x4000) ? 'DF ' : ''}${more ? 'MF' : ''}`.trim() || '-'], ['Fragment offset', fragOff * 8]]);
    if (more || fragOff > 0) {
      out.frag = true;
      out.ipProto = proto;
      out.l4 = IP_PROTOS[proto] || `IP proto ${proto}`;
      out.proto = 'IPv4';
      out.info = `Fragmented IP protocol (${out.l4}, off=${fragOff * 8}${more ? ', MF' : ''})`;
      if (fragOff > 0) return; // no L4 header in later fragments
    }
    decodeL4(b, off + Math.max(ihl, 20), proto, out);
  } else if (ver === 6 && b.length >= off + 40) {
    out.l3 = 'IPv6';
    out.src = fmtIPv6(b, off + 8);
    out.dst = fmtIPv6(b, off + 24);
    let nh = b[off + 6];
    let o = off + 40;
    let fragOff = 0;
    let fragMore = false;
    for (let i = 0; i < 8; i++) {
      if (nh === 0 || nh === 43 || nh === 60) { nh = b[o]; o += (b[o + 1] + 1) * 8; } else if (nh === 51) { nh = b[o]; o += (b[o + 1] + 2) * 4; } else if (nh === 44) {
        fragOff = (u16(b, o + 2) >> 3) & 0x1fff;
        fragMore = (u16(b, o + 2) & 1) === 1;
        nh = b[o]; o += 8;
      } else break;
    }
    L(out, 'IPv6', [['Source', out.src], ['Destination', out.dst], ['Next header', IP_PROTOS[nh] || nh], ['Hop limit', b[off + 7]]]);
    if (fragOff > 0 || fragMore) {
      out.frag = true;
      out.ipProto = nh;
      out.l4 = IP_PROTOS[nh] || `IP proto ${nh}`;
      out.proto = 'IPv6';
      out.info = `Fragmented IPv6 (${out.l4}, off=${fragOff * 8}${fragMore ? ', MF' : ''})`;
      if (fragOff > 0) return;
    }
    decodeL4(b, o, nh, out);
  }
}

function decodeEthertype(b, off, etype, out) {
  for (let i = 0; i < 2 && (etype === 0x8100 || etype === 0x88a8); i++) {
    const tci = u16(b, off);
    out.vlan = tci & 0x0fff;
    L(out, '802.1Q VLAN', [['VLAN ID', out.vlan], ['Priority', tci >> 13]]);
    etype = u16(b, off + 2);
    off += 4;
  }
  if (etype === 0x0800 || etype === 0x86dd) decodeIP(b, off, out);
  else if (etype === 0x0806) {
    out.l3 = 'ARP'; out.proto = 'ARP';
    const a = parseArpPayload(b, off);
    if (a) {
      out.info = a.op === 'Request' ? `Who has ${a.targetIp}? Tell ${a.ip}` : a.op === 'Reply' ? `${a.ip} is at ${a.mac}` : a.op;
      L(out, 'ARP', [['Operation', a.op], ['Sender', `${a.mac} / ${a.ip}`], ['Target', `${a.targetMac} / ${a.targetIp}`]]);
    } else out.info = 'ARP';
  } else out.l3 = `0x${etype.toString(16)}`;
}

function decode80211(b, off, out) {
  if (b.length < off + 10) return;
  const fc0 = b[off];
  const fc1 = b[off + 1];
  const type = (fc0 >> 2) & 3;
  const sub = fc0 >> 4;
  out.proto = '802.11';
  out.l3 = '802.11';
  out.ethDst = fmtMac(b, off + 4);
  if (b.length >= off + 16) out.ethSrc = fmtMac(b, off + 10);
  const tname = ['Management', 'Control', 'Data', 'Extension'][type];
  out.info = type === 0 ? (WIFI_MGMT[sub] || `Mgmt subtype ${sub}`) : type === 2 ? `Data${(sub & 8) ? ' (QoS)' : ''}${(fc1 & 0x40) ? ' [protected]' : ''}` : `${tname} subtype ${sub}`;
  L(out, '802.11', [['Type', tname], ['Subtype', out.info], ['Addr1 (RA/DA)', out.ethDst], ['Addr2 (TA/SA)', out.ethSrc || '-'], ['Addr3 (BSSID)', b.length >= off + 22 ? fmtMac(b, off + 16) : '-']]);
  if (type === 2 && !(fc1 & 0x40)) {
    let hdr = 24;
    if ((fc1 & 3) === 3) hdr += 6;
    if (sub & 8) hdr += 2;
    const p = off + hdr;
    if (b.length >= p + 8 && b[p] === 0xaa && b[p + 1] === 0xaa && b[p + 2] === 0x03) decodeEthertype(b, p + 8, u16(b, p + 6), out);
  }
}

function decodeFrame(b, linktype, out) {
  if (linktype === LINKTYPE_ETHERNET) {
    if (b.length < 14) return;
    out.ethSrc = fmtMac(b, 6);
    out.ethDst = fmtMac(b, 0);
    L(out, 'Ethernet', [['Source', out.ethSrc], ['Destination', out.ethDst]]);
    decodeEthertype(b, 14, u16(b, 12), out);
  } else if (linktype === LINKTYPE_SLL) {
    if (b.length < 16) return;
    if (u16(b, 4) === 6) out.ethSrc = fmtMac(b, 6);
    L(out, 'Linux cooked', [['Packet type', u16(b, 0)], ['Address', out.ethSrc || '-']]);
    decodeEthertype(b, 16, u16(b, 14), out);
  } else if (linktype === LINKTYPE_RADIOTAP) {
    if (b.length < 8) return;
    const rtLen = b[2] | (b[3] << 8);
    L(out, 'Radiotap', [['Header length', rtLen]]);
    decode80211(b, rtLen, out);
  } else if (linktype === LINKTYPE_RAW || linktype === LINKTYPE_IPV4 || linktype === LINKTYPE_IPV6) {
    decodeIP(b, 0, out);
  } else if (linktype === LINKTYPE_NULL) {
    decodeIP(b, 4, out); // BSD loopback: 4-byte family header
  } else {
    out.l3 = `linktype ${linktype}`;
  }
}

function buildRecord(index, r, withLayers) {
  const rec = { index, ts: r.ts, caplen: r.caplen, origlen: r.origlen, linktype: r.linktype, data: r.data, l3: '', proto: '' };
  if (withLayers) rec.layers = [{ name: 'Frame', fields: [['Captured', `${r.caplen} bytes`], ['On wire', `${r.origlen} bytes`], ['Link type', LINKTYPE_NAMES[r.linktype] || r.linktype]] }];
  try { decodeFrame(r.data, r.linktype, rec); } catch { /* leave partial decode */ }
  return rec;
}

/** Re-decode one record with the full layer tree (for the detail pane). */
export function decodePacketDetail(rec) {
  return buildRecord(rec.index, rec, true).layers;
}

/**
 * Parse an ArrayBuffer/Uint8Array of a .pcap or .pcapng file.
 * Returns { format, linktype, packetCount, totalPackets, truncated, warnings, packets }.
 * `totalPackets` counts every packet in the file; only the first `maxPackets` are decoded and returned,
 * and `truncated` is true when that limit hid some of them.
 */
export function parsePcap(input, maxPackets = DEFAULT_MAX_PACKETS) {
  const bytes = toU8(input);
  if (bytes.length < 12) throw new Error('File too small to be a pcap or pcapng capture');
  const info = { format: '', linktype: undefined, warnings: [] };
  const packets = [];
  let total = 0;
  for (const r of readRecords(bytes, info)) {
    total++;
    if (packets.length < maxPackets) packets.push(buildRecord(total, r, false));
  }
  return {
    format: info.format,
    linktype: info.linktype ?? packets[0]?.linktype ?? 0,
    packetCount: packets.length,
    totalPackets: total,
    truncated: total > packets.length,
    warnings: info.warnings,
    packets,
  };
}

// ---------------------------------------------------------------- filtering, summaries, export

const PROTO_WORDS = new Set(['tcp', 'udp', 'icmp', 'icmpv6', 'arp', 'dns', 'http', 'tls', 'dhcp', 'ip', 'ipv4', 'ipv6', 'vlan']);

function hayOf(p) {
  return `${p.proto} ${p.l4 || ''} ${p.l3} ${p.src || ''} ${p.dst || ''} ${p.sport || ''} ${p.dport || ''} ${p.ethSrc || ''} ${p.ethDst || ''} ${p.info || ''}`.toLowerCase();
}

function protoMatches(p, w) {
  if (w === 'ip') return p.l3 === 'IPv4' || p.l3 === 'IPv6';
  if (w === 'ipv4') return p.l3 === 'IPv4';
  if (w === 'ipv6') return p.l3 === 'IPv6';
  if (w === 'vlan') return p.vlan !== undefined;
  return (p.proto || '').toLowerCase() === w || (p.l4 || '').toLowerCase() === w || (p.l3 || '').toLowerCase() === w
    || (w === 'dns' && !!p.dns) || (w === 'tls' && !!p.tls);
}

/**
 * Compile a display filter into a predicate. Space-separated terms are ANDed:
 * tcp | udp | dns | ... (protocol), `port N`, `host X`, anything else is a substring match.
 * "and" between terms is ignored.
 */
export function compileFilter(text) {
  const words = (text || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  // OR-separated groups of AND-ed terms; `not` or a leading `!` negates the next term.
  const groups = [[]];
  let negate = false;
  const push = (t) => { const f = negate ? (p) => !t(p) : t; negate = false; groups[groups.length - 1].push(f); };
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    if (w === 'and' || w === '&&') continue;
    if (w === 'or' || w === '||') { groups.push([]); negate = false; continue; }
    if (w === 'not' || w === '!') { negate = !negate; continue; }
    if (w.startsWith('!') && w.length > 1) { negate = !negate; w = w.slice(1); }
    if (w === 'port' && i + 1 < words.length) {
      const n = Number(words[++i]);
      push((p) => p.sport === n || p.dport === n);
    } else if ((w === 'host' || w === 'src' || w === 'dst') && i + 1 < words.length) {
      const h = words[++i];
      const eq = (v) => (v || '').toLowerCase() === h;
      if (w === 'src') push((p) => eq(p.src) || eq(p.ethSrc));
      else if (w === 'dst') push((p) => eq(p.dst) || eq(p.ethDst));
      else push((p) => eq(p.src) || eq(p.dst) || eq(p.ethSrc) || eq(p.ethDst));
    } else if ((w === 'len' || w === 'length') && i + 2 < words.length && /^(>=|<=|>|<|==|=)$/.test(words[i + 1]) && /^\d+$/.test(words[i + 2])) {
      const op = words[++i]; const n = Number(words[++i]);
      push((p) => (op === '>' ? p.origlen > n : op === '<' ? p.origlen < n : op === '>=' ? p.origlen >= n : op === '<=' ? p.origlen <= n : p.origlen === n));
    } else if (TCP_FLAG_WORDS[w] !== undefined) {
      const bit = TCP_FLAG_WORDS[w];
      push((p) => !!p.tcp && (p.tcp.flagBits & bit) !== 0);
    } else if (PROTO_WORDS.has(w)) {
      push((p) => protoMatches(p, w));
    } else {
      push((p) => hayOf(p).includes(w));
    }
  }
  const active = groups.filter((g) => g.length);
  if (!active.length) return () => true;
  return (p) => active.some((g) => g.every((t) => t(p)));
}

const TCP_FLAG_WORDS = { fin: 0x01, syn: 0x02, rst: 0x04, psh: 0x08, ack: 0x10, urg: 0x20 };

/** Per-protocol packet/byte counts, most frequent first. */
export function protocolHierarchy(packets) {
  const m = new Map();
  for (const p of packets) {
    const k = p.proto || p.l3 || 'unknown';
    const e = m.get(k) || { proto: k, packets: 0, bytes: 0 };
    e.packets++; e.bytes += p.origlen;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.packets - a.packets);
}

/** Conversations (bidirectional address pairs). Every packet lands in exactly one row. */
export function conversations(packets) {
  const m = new Map();
  for (const p of packets) {
    let a; let b; let kind;
    if (p.src && p.dst) {
      kind = p.l4 || p.l3 || 'IP';
      a = p.sport ? `${p.src}:${p.sport}` : p.src;
      b = p.dport ? `${p.dst}:${p.dport}` : p.dst;
    } else if (p.ethSrc || p.ethDst) {
      kind = p.proto || p.l3 || 'L2';
      a = p.ethSrc || '?'; b = p.ethDst || '?';
    } else { kind = p.proto || p.l3 || 'unknown'; a = '(no address)'; b = '(no address)'; }
    const [x, y] = a <= b ? [a, b] : [b, a];
    const key = `${kind}|${x}|${y}`;
    let e = m.get(key);
    if (!e) { e = { key, proto: kind, a: x, b: y, packets: 0, bytes: 0, first: p.ts, last: p.ts }; m.set(key, e); }
    e.packets++; e.bytes += p.origlen;
    if (p.ts < e.first) e.first = p.ts;
    if (p.ts > e.last) e.last = p.ts;
  }
  return [...m.values()].map((e) => ({ ...e, duration: e.last - e.first })).sort((p, q) => q.packets - p.packets);
}

function csvCell(v) {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+@]/.test(s)) s = `'${s}`; // keep spreadsheets from evaluating attacker-controlled text
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of decoded rows (header + one row per packet). */
export function packetsToCsv(packets, t0 = packets[0]?.ts ?? 0) {
  const rows = [['No', 'Time (s)', 'Epoch', 'Source', 'Destination', 'Protocol', 'Length', 'Info']];
  for (const p of packets) {
    rows.push([
      p.index, (p.ts - t0).toFixed(6), p.ts.toFixed(6),
      p.src ? `${p.src}${p.sport ? `:${p.sport}` : ''}` : (p.ethSrc || ''),
      p.dst ? `${p.dst}${p.dport ? `:${p.dport}` : ''}` : (p.ethDst || ''),
      p.proto || p.l3, p.origlen, p.info || '',
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * Write a classic little-endian pcap (microsecond) from decoded records, using the link type of the first
 * record. Records of another link type cannot share one classic pcap and are counted in `skipped`.
 */
export function writePcap(packets) {
  const lt = packets[0]?.linktype ?? LINKTYPE_ETHERNET;
  const use = packets.filter((p) => p.linktype === lt);
  const total = use.reduce((n, p) => n + 16 + p.data.length, 24);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0xa1b2c3d4, true);
  dv.setUint16(4, 2, true); dv.setUint16(6, 4, true);
  dv.setUint32(16, 262144, true);
  dv.setUint32(20, lt, true);
  let o = 24;
  for (const p of use) {
    const sec = Math.floor(p.ts);
    dv.setUint32(o, sec, true);
    dv.setUint32(o + 4, Math.min(999999, Math.round((p.ts - sec) * 1e6)), true);
    dv.setUint32(o + 8, p.data.length, true);
    dv.setUint32(o + 12, p.origlen, true);
    out.set(p.data, o + 16);
    o += 16 + p.data.length;
  }
  return { bytes: out, linktype: lt, written: use.length, skipped: packets.length - use.length };
}
