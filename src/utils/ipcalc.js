// IPv4 / IPv6 and CIDR math — pure, dependency-free, fully client-side.

// ---------- IPv4 ----------

/** Parse dotted-quad IPv4 to a uint32, or null if invalid. */
export function parseIpv4(str) {
  const m = String(str).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  // leading zeros are ambiguous (octal in some stacks) and are rejected
  if (m.slice(1).some((o) => o.length > 1 && o[0] === '0')) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** uint32 -> dotted-quad string. */
export function ipv4ToStr(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** Compute the full report for an IPv4 CIDR (ip, prefix 0..32). */
export function computeV4(ip, prefix) {
  if (prefix < 0 || prefix > 32) throw new Error('IPv4 prefix must be 0–32');
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const wildcard = (~mask) >>> 0;
  const network = (ip & mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = 2 ** (32 - prefix);
  let first; let last; let usable;
  if (prefix >= 31) { first = network; last = broadcast; usable = prefix === 32 ? 1 : 2; }
  else { first = (network + 1) >>> 0; last = (broadcast - 1) >>> 0; usable = total - 2; }
  return {
    version: 4,
    cidr: `${ipv4ToStr(network)}/${prefix}`,
    address: ipv4ToStr(ip),
    netmask: ipv4ToStr(mask),
    wildcard: ipv4ToStr(wildcard),
    network: ipv4ToStr(network),
    broadcast: ipv4ToStr(broadcast),
    firstHost: ipv4ToStr(first),
    lastHost: ipv4ToStr(last),
    totalAddresses: total,
    usableHosts: usable,
    prefix,
    isPrivate: isPrivateV4(network),
  };
}

function isPrivateV4(n) {
  const a = (n >>> 24) & 255; const b = (n >>> 16) & 255;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 127 || (a === 169 && b === 254);
}

/** Does an IPv4 CIDR contain an address? */
export function v4Contains(cidrNetwork, prefix, ip) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ip & mask) >>> 0) === ((cidrNetwork & mask) >>> 0);
}

// ---------- IPv6 ----------

/** Parse an IPv6 string (with :: and embedded IPv4) to a BigInt, or null. */
export function parseIpv6(str) {
  let s = String(str).trim();
  if (s.includes('.')) {
    // embedded IPv4 in the last group
    const idx = s.lastIndexOf(':');
    const v4 = parseIpv4(s.slice(idx + 1));
    if (v4 === null) return null;
    s = s.slice(0, idx + 1) + ((v4 >>> 16) & 0xffff).toString(16) + ':' + (v4 & 0xffff).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
  let groups;
  if (tail === null) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array(missing).fill('0'), ...tail];
  }
  let v = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    v = (v << 16n) | BigInt(parseInt(g, 16));
  }
  return v;
}

/** BigInt -> canonical compressed IPv6 string. */
export function ipv6ToStr(v) {
  const groups = [];
  // groups[0] is the most-significant 16-bit group (printed first)
  for (let j = 0; j < 8; j++) groups[j] = Number((v >> BigInt((7 - j) * 16)) & 0xffffn);
  const hex = groups.map((g) => g.toString(16));
  // find longest run of zero groups to compress
  let bestStart = -1; let bestLen = 0; let curStart = -1; let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) { if (curStart < 0) curStart = i; curLen++; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; } }
    else { curStart = -1; curLen = 0; }
  }
  if (bestLen < 2) return hex.join(':');
  const before = hex.slice(0, bestStart).join(':');
  const after = hex.slice(bestStart + bestLen).join(':');
  return `${before}::${after}`;
}

/** Compute the report for an IPv6 CIDR (BigInt ip, prefix 0..128). */
export function computeV6(ip, prefix) {
  if (prefix < 0 || prefix > 128) throw new Error('IPv6 prefix must be 0–128');
  const full = (1n << 128n) - 1n;
  const mask = prefix === 0 ? 0n : (full << BigInt(128 - prefix)) & full;
  const network = ip & mask;
  const last = network | (~mask & full);
  return {
    version: 6,
    cidr: `${ipv6ToStr(network)}/${prefix}`,
    address: ipv6ToStr(ip),
    network: ipv6ToStr(network),
    firstHost: ipv6ToStr(network),
    lastHost: ipv6ToStr(last),
    totalAddresses: 2n ** BigInt(128 - prefix),
    prefix,
  };
}


// ---------- parsing / dispatch ----------

const V4_MAX = 0xffffffffn;
const V6_MAX = (1n << 128n) - 1n;
const maxOf = (version) => (version === 4 ? V4_MAX : V6_MAX);
const bitsOf = (version) => (version === 4 ? 32 : 128);

/** Parse a bare address (v4 or v6) to { version, bits, value:BigInt } or null. */
function parseAddress(str) {
  const v4 = parseIpv4(str);
  if (v4 !== null) return { version: 4, bits: 32, value: BigInt(v4) };
  const v6 = parseIpv6(str);
  if (v6 !== null) return { version: 6, bits: 128, value: v6 };
  return null;
}

const fmtAddr = (version, value) => (version === 4 ? ipv4ToStr(Number(value)) : ipv6ToStr(value));
const maskBig = (version, prefix) => {
  const bits = bitsOf(version);
  return prefix === 0 ? 0n : (maxOf(version) << BigInt(bits - prefix)) & maxOf(version);
};

/**
 * Parse the part after "/" into a prefix length. Accepts a decimal prefix, or
 * (IPv4) a contiguous dotted netmask or wildcard. "0.0.0.0" is read as a
 * netmask (/0). Throws "Invalid prefix" for anything else (including empty).
 */
function parsePrefix(prefixStr, version) {
  if (/^\d{1,3}$/.test(prefixStr)) {
    if (prefixStr.length > 1 && prefixStr[0] === '0') throw new Error('Invalid prefix');
    const p = Number(prefixStr);
    if (p > bitsOf(version)) throw new Error(`IPv${version} prefix must be 0–${bitsOf(version)}`);
    return p;
  }
  if (version === 4 && /^\d{1,3}(\.\d{1,3}){3}$/.test(prefixStr)) {
    const m = parseIpv4(prefixStr);
    if (m !== null) {
      const inv = (~m) >>> 0;
      if ((inv & ((inv + 1) >>> 0)) === 0) return 32 - Math.log2(inv + 1);
      if ((m & ((m + 1) >>> 0)) === 0) return 32 - Math.log2(m + 1);
    }
  }
  throw new Error('Invalid prefix');
}

/**
 * Strictly parse "addr[/prefix]" (netmask/wildcard accepted as prefix).
 * Returns { version, bits, address, prefix, network, hasPrefix }.
 */
export function parseCidr(input, { requirePrefix = false } = {}) {
  const str = String(input).trim();
  if (/\s/.test(str)) throw new Error('Invalid address: whitespace inside the address or prefix');
  const slash = str.indexOf('/');
  if (slash !== str.lastIndexOf('/')) throw new Error('Invalid prefix');
  const addr = slash < 0 ? str : str.slice(0, slash);
  const a = parseAddress(addr);
  if (!a) throw new Error('Not a valid IPv4 or IPv6 address');
  if (slash < 0 && requirePrefix) throw new Error('Invalid prefix: expected addr/prefix');
  const prefix = slash < 0 ? a.bits : parsePrefix(str.slice(slash + 1), a.version);
  return { version: a.version, bits: a.bits, address: a.value, prefix, network: a.value & maskBig(a.version, prefix), hasPrefix: slash >= 0 };
}

/** Parse "ip/prefix" (either family) and return the computed report. */
export function computeCidr(input) {
  const p = parseCidr(input);
  const report = p.version === 4 ? computeV4(Number(p.address), p.prefix) : computeV6(p.address, p.prefix);
  const cls = classifyAddress(fmtAddr(p.version, p.network));
  report.classification = cls;
  if (p.version === 6) report.isPrivate = ['ula', 'link-local', 'loopback'].includes(cls.kind);
  return report;
}

// ---------- classification ----------

const V4_RANGES = [
  ['255.255.255.255/32', 'broadcast', 'Limited broadcast'],
  ['0.0.0.0/32', 'unspecified', 'Unspecified address'],
  ['0.0.0.0/8', 'reserved', '"This network" (0.0.0.0/8)'],
  ['10.0.0.0/8', 'private', 'Private (RFC 1918, 10.0.0.0/8)'],
  ['100.64.0.0/10', 'cgnat', 'Carrier-grade NAT (RFC 6598, 100.64.0.0/10)'],
  ['127.0.0.0/8', 'loopback', 'Loopback (127.0.0.0/8)'],
  ['169.254.0.0/16', 'link-local', 'Link-local (169.254.0.0/16)'],
  ['172.16.0.0/12', 'private', 'Private (RFC 1918, 172.16.0.0/12)'],
  ['192.0.0.0/24', 'reserved', 'IETF protocol assignments (192.0.0.0/24)'],
  ['192.0.2.0/24', 'documentation', 'Documentation (TEST-NET-1, 192.0.2.0/24)'],
  ['192.88.99.0/24', 'reserved', 'Deprecated 6to4 relay anycast (192.88.99.0/24)'],
  ['192.168.0.0/16', 'private', 'Private (RFC 1918, 192.168.0.0/16)'],
  ['198.18.0.0/15', 'benchmarking', 'Benchmarking (RFC 2544, 198.18.0.0/15)'],
  ['198.51.100.0/24', 'documentation', 'Documentation (TEST-NET-2, 198.51.100.0/24)'],
  ['203.0.113.0/24', 'documentation', 'Documentation (TEST-NET-3, 203.0.113.0/24)'],
  ['224.0.0.0/4', 'multicast', 'Multicast (224.0.0.0/4)'],
  ['240.0.0.0/4', 'reserved', 'Reserved for future use (240.0.0.0/4)'],
].map(([c, kind, label]) => { const p = parseCidr(c); return { net: p.network, prefix: p.prefix, kind, label }; });

const V6_RANGES = [
  ['::1/128', 'loopback', 'Loopback (::1)'],
  ['::/128', 'unspecified', 'Unspecified address (::)'],
  ['::ffff:0:0/96', 'ipv4-mapped', 'IPv4-mapped (::ffff:0:0/96)'],
  ['2001:db8::/32', 'documentation', 'Documentation (2001:db8::/32)'],
  ['fc00::/7', 'ula', 'Unique local address (fc00::/7)'],
  ['fe80::/10', 'link-local', 'Link-local (fe80::/10)'],
  ['ff00::/8', 'multicast', 'Multicast (ff00::/8)'],
  ['2000::/3', 'public', 'Global unicast (2000::/3)'],
].map(([c, kind, label]) => { const p = parseCidr(c); return { net: p.network, prefix: p.prefix, kind, label }; });

/**
 * Classify an address: returns { version, kind, label } or null if invalid.
 * kind: loopback | private | link-local | cgnat | documentation | benchmarking |
 * multicast | reserved | broadcast | unspecified | ula | ipv4-mapped | public.
 */
export function classifyAddress(ip) {
  const a = parseAddress(String(ip).trim().split('/')[0]);
  if (!a) return null;
  const table = a.version === 4 ? V4_RANGES : V6_RANGES;
  let best = null;
  for (const r of table) {
    if ((a.value & maskBig(a.version, r.prefix)) === r.net && (!best || r.prefix > best.prefix)) best = r;
  }
  if (best) return { version: a.version, kind: best.kind, label: best.label };
  return a.version === 4
    ? { version: 4, kind: 'public', label: 'Public (globally routable)' }
    : { version: 6, kind: 'reserved', label: 'Reserved / unallocated IPv6 space' };
}

// ---------- subnet tools ----------

const cidrStr = (version, network, prefix) => `${fmtAddr(version, network)}/${prefix}`;
const sizeOf = (version, prefix) => 1n << BigInt(bitsOf(version) - prefix);

/** Split a CIDR into equal subnets of newPrefix. Refuses more than `limit` outputs. */
export function splitCidr(cidr, newPrefix, limit = 1024) {
  const p = parseCidr(cidr, { requirePrefix: true });
  if (!Number.isInteger(newPrefix) || newPrefix < p.prefix || newPrefix > p.bits) {
    throw new Error(`New prefix must be between /${p.prefix} and /${p.bits}`);
  }
  const count = 1n << BigInt(newPrefix - p.prefix);
  if (count > BigInt(limit)) throw new Error(`Split would produce ${count.toLocaleString('en-US')} networks (limit ${limit})`);
  const step = sizeOf(p.version, newPrefix);
  const out = [];
  for (let i = 0n; i < count; i++) out.push(cidrStr(p.version, p.network + i * step, newPrefix));
  return out;
}

/** Prefix length needed for `hosts` usable hosts (IPv4, network + broadcast reserved). */
export function prefixForHosts(hosts) {
  if (!Number.isInteger(hosts) || hosts < 1) throw new Error('Host count must be a positive integer');
  let size = 4; let prefix = 30;
  while (size - 2 < hosts) { size *= 2; prefix -= 1; }
  if (prefix < 0) throw new Error('Too many hosts for IPv4');
  return prefix;
}

/**
 * VLSM allocation inside an IPv4 parent, largest requirement first.
 * Returns [{ requested, cidr, prefix, usable, first, last }]; throws if it does not fit.
 */
export function vlsm(parent, hostCounts) {
  const p = parseCidr(parent, { requirePrefix: true });
  if (p.version !== 4) throw new Error('VLSM supports IPv4 parents only');
  const reqs = hostCounts.map((h, i) => ({ requested: h, index: i, prefix: prefixForHosts(h) }));
  reqs.sort((a, b) => a.prefix - b.prefix || a.index - b.index);
  let cursor = p.network;
  const end = p.network + sizeOf(4, p.prefix);
  const out = [];
  for (const r of reqs) {
    if (r.prefix < p.prefix) throw new Error(`${r.requested} hosts needs a /${r.prefix}, larger than the parent /${p.prefix}`);
    const size = sizeOf(4, r.prefix);
    if (cursor + size > end) throw new Error(`Parent ${parent} is too small for the requested host counts`);
    const net = cursor;
    cursor += size;
    out.push({
      requested: r.requested, prefix: r.prefix, cidr: cidrStr(4, net, r.prefix), usable: Number(size) - 2,
      first: ipv4ToStr(Number(net) + 1), last: ipv4ToStr(Number(net + size) - 2),
    });
  }
  return out;
}

const toBlock = (c) => { const p = parseCidr(c); return { version: p.version, start: p.network, end: p.network + sizeOf(p.version, p.prefix) - 1n, prefix: p.prefix }; };

/** Merge CIDRs into the minimal covering set (drops contained, joins siblings). IPv4 first. */
export function aggregate(cidrs) {
  const out = [];
  for (const version of [4, 6]) {
    let nets = cidrs.map((c) => parseCidr(c)).filter((p) => p.version === version)
      .map((p) => ({ network: p.network, prefix: p.prefix }));
    if (!nets.length) continue;
    nets.sort((a, b) => (a.network < b.network ? -1 : a.network > b.network ? 1 : a.prefix - b.prefix));
    // drop networks contained in a previous one
    const kept = [];
    for (const n of nets) {
      const last = kept[kept.length - 1];
      if (last && n.network <= last.network + sizeOf(version, last.prefix) - 1n) continue;
      kept.push(n);
    }
    nets = kept;
    let changed = true;
    while (changed) {
      changed = false;
      const next = [];
      for (let i = 0; i < nets.length; i++) {
        const a = nets[i]; const b = nets[i + 1];
        if (b && a.prefix === b.prefix && a.prefix > 0
          && b.network === a.network + sizeOf(version, a.prefix)
          && (a.network & maskBig(version, a.prefix - 1)) === a.network) {
          next.push({ network: a.network, prefix: a.prefix - 1 });
          i++; changed = true;
        } else next.push(a);
      }
      nets = next;
    }
    nets.forEach((n) => out.push(cidrStr(version, n.network, n.prefix)));
  }
  return out;
}

/** Minimal list of CIDRs covering the inclusive range a..b (same family). */
export function rangeToCidrs(a, b) {
  const x = parseAddress(String(a).trim()); const y = parseAddress(String(b).trim());
  if (!x || !y) throw new Error('Not a valid IPv4 or IPv6 address');
  if (x.version !== y.version) throw new Error('Range endpoints must be the same IP version');
  if (x.value > y.value) throw new Error('Range start is after range end');
  const out = [];
  let cur = x.value;
  while (cur <= y.value) {
    // largest power-of-two block aligned at cur that fits within the range
    let size = 1n; let prefix = x.bits;
    while (prefix > 0) {
      const bigger = size << 1n;
      if (cur % bigger !== 0n || cur + bigger - 1n > y.value) break;
      size = bigger; prefix -= 1;
    }
    out.push(cidrStr(x.version, cur, prefix));
    cur += size;
  }
  return out;
}

/** Relationship of two CIDRs/addresses: equal | a-contains-b | b-contains-a | overlap | disjoint | mixed. */
export function cidrRelation(a, b) {
  const x = toBlock(a); const y = toBlock(b);
  if (x.version !== y.version) return 'disjoint';
  if (x.start === y.start && x.end === y.end) return 'equal';
  if (x.start <= y.start && x.end >= y.end) return 'a-contains-b';
  if (y.start <= x.start && y.end >= x.end) return 'b-contains-a';
  return x.start <= y.end && y.start <= x.end ? 'overlap' : 'disjoint';
}

/** Do two CIDRs (or addresses) share any address? */
export function overlaps(a, b) {
  return cidrRelation(a, b) !== 'disjoint';
}

/** Reverse-DNS name (in-addr.arpa / ip6.arpa) for an address. */
export function reverseName(ip) {
  const a = parseAddress(String(ip).trim().split('/')[0]);
  if (!a) throw new Error('Not a valid IPv4 or IPv6 address');
  if (a.version === 4) return `${ipv4ToStr(Number(a.value)).split('.').reverse().join('.')}.in-addr.arpa`;
  return `${a.value.toString(16).padStart(32, '0').split('').reverse().join('.')}.ip6.arpa`;
}

/** Binary view of an address split at the prefix: { network, host } (grouped by 8 / 16 bits). */
export function binaryView(ip, prefix) {
  const a = parseAddress(String(ip).trim().split('/')[0]);
  if (!a) throw new Error('Not a valid IPv4 or IPv6 address');
  const group = a.version === 4 ? 8 : 16;
  const bin = a.value.toString(2).padStart(a.bits, '0');
  const sep = a.version === 4 ? '.' : ':';
  const render = (from, to) => {
    let out = '';
    for (let i = from; i < to; i++) { if (i > from && i % group === 0) out += sep; out += bin[i]; }
    return out;
  };
  return { network: render(0, prefix), host: render(prefix, a.bits) };
}
