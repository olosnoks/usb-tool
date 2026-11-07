// IPv4 / IPv6 and CIDR math — pure, dependency-free, fully client-side.

// ---------- IPv4 ----------

/** Parse dotted-quad IPv4 to a uint32, or null if invalid. */
export function parseIpv4(str) {
  const m = String(str).trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
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

// ---------- dispatch ----------

/** Parse "ip/prefix" (either family) and return the computed report. */
export function computeCidr(input) {
  const str = String(input).trim();
  const [addr, prefixStr] = str.split('/');
  const v4 = parseIpv4(addr);
  if (v4 !== null) {
    const prefix = prefixStr === undefined ? 32 : Number(prefixStr);
    if (!Number.isInteger(prefix)) throw new Error('Invalid prefix');
    return computeV4(v4, prefix);
  }
  const v6 = parseIpv6(addr);
  if (v6 !== null) {
    const prefix = prefixStr === undefined ? 128 : Number(prefixStr);
    if (!Number.isInteger(prefix)) throw new Error('Invalid prefix');
    return computeV6(v6, prefix);
  }
  throw new Error('Not a valid IPv4 or IPv6 address');
}
