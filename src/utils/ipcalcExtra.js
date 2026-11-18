import { parseCidr, ipv4ToStr, ipv6ToStr, rangeToCidrs, computeCidr } from './ipcalc.js';

/** Extra pure helpers for the IP calculator (address forms, exclude, prefix table). */

const fmt = (version, v) => (version === 4 ? ipv4ToStr(Number(v)) : ipv6ToStr(v));

/** Alternate representations of a single address (the prefix, if any, is ignored). */
export function addressForms(input) {
  const p = parseCidr(String(input).trim().split('/')[0]);
  const forms = [['Decimal integer', p.address.toString(10)], ['Hexadecimal', `0x${p.address.toString(16).padStart(p.bits / 4, '0')}`]];
  if (p.version === 4) {
    const n = Number(p.address);
    forms.push(['IPv4-mapped IPv6', `::ffff:${ipv4ToStr(n)}`]);
    forms.push(['IPv4-mapped (hex)', `::ffff:${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`]);
    forms.push(['Binary', ipv4ToStr(n).split('.').map((o) => Number(o).toString(2).padStart(8, '0')).join('.')]);
  } else {
    const groups = [];
    for (let j = 0; j < 8; j++) groups.push(Number((p.address >> BigInt((7 - j) * 16)) & 0xffffn).toString(16).padStart(4, '0'));
    forms.push(['Compressed', ipv6ToStr(p.address)]);
    forms.push(['Expanded', groups.join(':')]);
    const v4 = Number(p.address & 0xffffffffn);
    if (p.address >> 32n === 0xffffn) forms.push(['Embedded IPv4', ipv4ToStr(v4)]);
  }
  return forms;
}

/** Remove `exclude` from `parent`; returns the minimal CIDR list that remains. */
export function excludeCidr(parent, exclude) {
  const a = parseCidr(parent, { requirePrefix: true });
  const b = parseCidr(exclude, { requirePrefix: true });
  if (a.version !== b.version) throw new Error('Both networks must be the same IP version');
  const size = (p) => 1n << BigInt(p.bits - p.prefix);
  const aStart = a.network; const aEnd = aStart + size(a) - 1n;
  const bStart = b.network; const bEnd = bStart + size(b) - 1n;
  if (bEnd < aStart || bStart > aEnd) return [`${fmt(a.version, aStart)}/${a.prefix}`];
  const out = [];
  if (bStart > aStart) out.push(...rangeToCidrs(fmt(a.version, aStart), fmt(a.version, bStart - 1n)));
  if (bEnd < aEnd) out.push(...rangeToCidrs(fmt(a.version, bEnd + 1n), fmt(a.version, aEnd)));
  return out;
}

/** Prefix cheat sheet rows: prefix, netmask (v4), wildcard (v4), addresses, usable hosts. */
export function prefixTable(version = 4) {
  const bits = version === 4 ? 32 : 128;
  const rows = [];
  const range = version === 4 ? [0, 32] : [0, 128];
  const step = version === 4 ? 1 : 4;
  for (let p = range[0]; p <= range[1]; p += step) {
    const total = 1n << BigInt(bits - p);
    const row = { prefix: p, addresses: total };
    if (version === 4) {
      const r = computeCidr(`0.0.0.0/${p}`);
      row.netmask = r.netmask; row.wildcard = r.wildcard; row.usable = BigInt(r.usableHosts);
    }
    rows.push(row);
  }
  return rows;
}

/** Cisco-style ACL wildcard line for a network (IPv4). */
export function aclEntry(cidr) {
  const r = computeCidr(cidr);
  if (!r.wildcard) throw new Error('Wildcard masks apply to IPv4 only');
  return `${r.network} ${r.wildcard}`;
}
