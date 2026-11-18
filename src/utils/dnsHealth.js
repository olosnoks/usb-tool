// Pure helpers for the DNS Toolkit: reverse names, dig command strings, DKIM key
// analysis and a rule-based health summary of a finished lookup.

/** IPv4/IPv6 address -> PTR query name (in-addr.arpa / ip6.arpa), or null. */
export function ipToArpa(ip) {
  const s = String(ip || '').trim();
  const v4 = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const o = v4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return null;
    return `${o.reverse().join('.')}.in-addr.arpa`;
  }
  if (!/^[0-9a-f:]+$/i.test(s) || !s.includes(':') || (s.match(/::/g) || []).length > 1) return null;
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  let groups;
  if (s.includes('::')) {
    const fill = 8 - h.length - t.length;
    if (fill < 1) return null;
    groups = [...h, ...Array(fill).fill('0'), ...t];
  } else groups = h;
  if (groups.length !== 8 || groups.some((g) => !g || g.length > 4)) return null;
  return `${groups.map((g) => g.padStart(4, '0')).join('').split('').reverse().join('.')}.ip6.arpa`;
}

const DIG_SERVER = { google: '8.8.8.8', cloudflare: '1.1.1.1', quad9: '9.9.9.9' };

/** A dig command equivalent to the lookup (an export for the CLI tool; the browser used DoH). */
export function digCommand(name, type, resolver = 'google', { short = false } = {}) {
  const srv = DIG_SERVER[resolver] ? ` @${DIG_SERVER[resolver]}` : '';
  return `dig${short ? ' +short' : ''}${srv} ${name} ${type}`;
}

function readTlv(buf, pos) {
  const tag = buf[pos];
  let len = buf[pos + 1];
  let off = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 4) return null;
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[off + k];
    off += n;
  }
  if (!(off + len <= buf.length)) return null;
  return { tag, start: off, end: off + len };
}

/** RSA modulus size in bits from a base64 SubjectPublicKeyInfo, or null. */
export function rsaBitsFromSpki(b64) {
  let bin;
  try { bin = atob(String(b64).replace(/\s+/g, '')); } catch { return null; }
  const buf = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const spki = readTlv(buf, 0);
  if (!spki || spki.tag !== 0x30) return null;
  const alg = readTlv(buf, spki.start);
  if (!alg || alg.tag !== 0x30) return null;
  const bits = readTlv(buf, alg.end);
  if (!bits || bits.tag !== 0x03) return null;
  const rsa = readTlv(buf, bits.start + 1); // skip the unused-bits byte
  if (!rsa || rsa.tag !== 0x30) return null;
  const n = readTlv(buf, rsa.start);
  if (!n || n.tag !== 0x02) return null;
  let s = n.start;
  while (s < n.end - 1 && buf[s] === 0) s++;
  const top = buf[s];
  if (!top) return null;
  return (n.end - s - 1) * 8 + (32 - Math.clz32(top));
}

/** Parse a DKIM key record. Returns tags plus keyType, bits, revoked, testing, notes. */
export function parseDkim(raw) {
  const tags = {};
  String(raw || '').split(';').forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq > 0) tags[pair.slice(0, eq).trim().toLowerCase()] = pair.slice(eq + 1).trim();
  });
  const keyType = (tags.k || 'rsa').toLowerCase();
  const p = (tags.p || '').replace(/\s+/g, '');
  const revoked = 'p' in tags && p === '';
  const flags = (tags.t || '').split(':').map((x) => x.trim().toLowerCase());
  const testing = flags.includes('y');
  const bits = keyType === 'rsa' && p ? rsaBitsFromSpki(p) : null;
  const notes = [];
  if (!('p' in tags)) notes.push({ level: 'error', text: 'no p= tag (public key)' });
  if (revoked) notes.push({ level: 'warn', text: 'empty p= means this key is revoked' });
  if (tags.v && tags.v.toUpperCase() !== 'DKIM1') notes.push({ level: 'error', text: `unexpected v=${tags.v}` });
  if (testing) notes.push({ level: 'warn', text: 't=y marks the domain as testing; receivers may ignore failures' });
  if (keyType === 'rsa' && p && bits === null) notes.push({ level: 'warn', text: 'could not read the RSA key size' });
  if (bits !== null && bits < 1024) notes.push({ level: 'error', text: `RSA ${bits}-bit key is too weak; use 2048` });
  else if (bits !== null && bits < 2048) notes.push({ level: 'warn', text: `RSA ${bits}-bit key; 2048-bit is recommended` });
  return { tags, keyType, bits, revoked, testing, notes };
}

/**
 * Rule-based findings for a finished lookup `info` (the workbench's state).
 * Returns [{ level: 'error'|'warn'|'ok'|'info', text }] ordered worst first.
 */
export function healthFindings(info) {
  if (!info) return [];
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const err = info.recErrors || {};

  if (!info.ns.length && !err.NS) add('warn', 'No NS records returned. This is expected only for a subdomain inside a parent zone.');
  else if (info.ns.length === 1) add('warn', 'Only one nameserver; use at least two, ideally on different networks.');
  const spfRecords = (info.txtStrings || []).filter((t) => /^v=spf1/i.test(t));
  if (spfRecords.length > 1) add('error', `${spfRecords.length} SPF records published; receivers return a permerror. Merge them into one.`);

  if (info.cname.length && (info.mx.length || info.ns.length || info.soa.length)) add('error', 'CNAME at a name that also holds other records (MX/NS/SOA); a CNAME cannot coexist with them.');
  if (!info.a.length && !info.aaaa.length && !info.cname.length && !err.A) add('info', 'No A, AAAA or CNAME: the name does not resolve to a web address.');
  if (info.a.length && !info.aaaa.length && !err.AAAA) add('info', 'No AAAA record; IPv6-only clients cannot reach this name.');

  if (!info.mx.length) {
    if (!err.MX) add('info', 'No MX records. With an A record mail falls back to it; otherwise the domain cannot receive mail.');
  } else {
    const mxVals = info.mx.map((r) => String(r.data).split(/\s+/));
    if (info.mx.length === 1) add('info', 'A single MX host; a second one gives mail somewhere to queue if it is down.');
    mxVals.forEach(([, h]) => { if (h && /^\d+\.\d+\.\d+\.\d+\.?$/.test(h)) add('error', `MX target ${h} is an IP address; it must be a hostname.`); });
    if (mxVals.length === 1 && mxVals[0][1] === '.') add('ok', 'Null MX (RFC 7505): the domain declares it accepts no mail.');
    else if (!info.mxIps.length) add('error', 'MX hosts did not resolve to any IPv4 address.');
  }

  if (!info.spf && !info.txtError) add(info.mx.length ? 'error' : 'warn', `No SPF record${info.mx.length ? ' on a domain that has MX records.' : '.'}`);
  if (info.spf) {
    if (info.spf.all?.qualifier === '+') add('error', 'SPF ends in +all, which authorises every sender.');
    else if (!info.spf.all && !/redirect=/i.test(info.spf.raw)) add('warn', 'SPF has no "all" term or redirect, so unlisted senders get a neutral result.');
    else if (info.spf.all?.qualifier === '?') add('warn', 'SPF ends in ?all (neutral); use ~all or -all.');
    if (info.spf.lookups > 10) add('error', `SPF needs ${info.spf.lookups} DNS lookups; the limit is 10.`);
    else if (info.spf.lookups >= 9) add('warn', `SPF uses ${info.spf.lookups} of 10 DNS lookups.`);
    if (/\bptr\b/i.test(info.spf.raw)) add('warn', 'SPF uses the discouraged ptr mechanism.');
    (info.spf.expansion?.errors || []).forEach((e) => add('error', `SPF: ${e}`));
  }

  if (!info.dmarc && !info.dmarcError) add(info.mx.length || info.spf ? 'error' : 'warn', `No DMARC record at _dmarc.${info.name}.`);
  if (info.dmarc) {
    if (info.dmarc.policy === 'none') add('warn', 'DMARC p=none only monitors; move to quarantine or reject once reports look clean.');
    if (!info.dmarc.rua) add('warn', 'DMARC has no rua= address, so no aggregate reports arrive.');
    if (info.dmarc.pct !== 100 && info.dmarc.policy !== 'none') add('warn', `DMARC pct=${info.dmarc.pct}: the policy applies to only that share of mail.`);
  }

  (info.dkim || []).forEach((d) => {
    const k = parseDkim(d.raw);
    k.notes.forEach((n) => add(n.level, `DKIM ${d.selector}: ${n.text}`));
    if (!k.notes.length) add('ok', `DKIM ${d.selector}: ${k.keyType.toUpperCase()}${k.bits ? ` ${k.bits}-bit` : ''} key looks fine.`);
  });
  if (!(info.dkim || []).length) add('info', 'No DKIM key found for the selector(s) tried; tick "also try common selectors" or enter your selector.');

  if (!info.caa.length && !err.CAA) add('info', 'No CAA record, so any public CA may issue certificates for this name.');
  if (info.dnssec?.state === 'unsigned') add('info', 'DNSSEC is not enabled for this zone.');
  if (info.dnssec?.state === 'incomplete') add('error', 'DNSSEC is half-configured (DS and DNSKEY disagree); validating resolvers may fail the domain.');
  if (info.dnsbl?.length) add('error', `${info.dnsbl.length} DNSBL listing(s) for the mail server IPs.`);
  Object.entries(info.resolverChecks || {}).forEach(([t, c]) => { if (c.comparable && !c.agree) add('warn', `${t} answers differ between resolvers (geo-DNS, a recent change still propagating, or tampering).`); });
  const soa = info.soa[0] && String(info.soa[0].data).split(/\s+/);
  if (soa && soa.length >= 7) {
    const [, , , refresh, retry, expire] = soa.map(Number);
    if (expire && refresh && expire < refresh * 2) add('warn', 'SOA expire is less than twice the refresh interval.');
    if (retry && refresh && retry > refresh) add('info', 'SOA retry is longer than refresh.');
  }

  if (!out.some((f) => f.level === 'error' || f.level === 'warn')) add('ok', 'No errors or warnings found by these checks.');
  const rank = { error: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
