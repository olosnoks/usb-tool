// Pure helpers for the DNS / Mail Doctor: SPF / DMARC parsing, reverse-IP and
// DNSBL name construction. No network here — the component does DoH fetches and
// feeds the TXT strings to these parsers.

/** Parse an SPF record (v=spf1 …) into mechanisms + the `all` qualifier. */
export function parseSpf(txt) {
  if (!txt || !/^v=spf1/i.test(txt.trim())) return null;
  const terms = txt.trim().split(/\s+/).slice(1);
  const mechanisms = [];
  let all = null;
  for (const t of terms) {
    const m = t.match(/^([+\-~?]?)(all)$/i);
    if (m) { all = { qualifier: m[1] || '+', meaning: { '+': 'pass', '-': 'fail (hard)', '~': 'softfail', '?': 'neutral' }[m[1] || '+'] }; continue; }
    mechanisms.push(t);
  }
  return { raw: txt.trim(), mechanisms, all, lookups: mechanisms.filter((t) => /^(include:|a$|a:|mx$|mx:|ptr|exists:|redirect=)/i.test(t)).length };
}

/** Parse a DMARC record (v=DMARC1; …) into its tags. */
export function parseDmarc(txt) {
  if (!txt || !/^v=DMARC1/i.test(txt.trim())) return null;
  const tags = {};
  txt.trim().split(';').forEach((pair) => {
    const [k, v] = pair.split('=').map((s) => (s || '').trim());
    if (k) tags[k.toLowerCase()] = v;
  });
  const policy = tags.p || 'none';
  return {
    raw: txt.trim(),
    tags,
    policy,
    strength: policy === 'reject' ? 'strong' : policy === 'quarantine' ? 'moderate' : 'weak',
    pct: tags.pct ? Number(tags.pct) : 100,
    rua: tags.rua || null,
  };
}

/** Classify a TXT record for display (SPF / DMARC / DKIM / verification / other). */
export function classifyTxt(txt) {
  if (/^v=spf1/i.test(txt)) return 'SPF';
  if (/^v=DMARC1/i.test(txt)) return 'DMARC';
  if (/^v=DKIM1/i.test(txt) || /(^|;)\s*k=/i.test(txt) && /p=/i.test(txt)) return 'DKIM';
  if (/^(google-site-verification|MS=|facebook-domain|apple-domain|v=verifydomain|atlassian-)/i.test(txt)) return 'verification';
  return 'other';
}

/** Reverse an IPv4 address for DNSBL / PTR queries: 1.2.3.4 -> 4.3.2.1. */
export function reverseIpv4(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4 || parts.some((p) => !/^\d+$/.test(p) || Number(p) > 255)) return null;
  return parts.reverse().join('.');
}

/** Build the DNSBL lookup name for an IPv4 address against a zone. */
export function dnsblName(ip, zone) {
  const rev = reverseIpv4(ip);
  return rev ? `${rev}.${zone}` : null;
}

/** Public DNSBL zones checked for listed mail-server IPs. */
export const DNSBL_ZONES = [
  'zen.spamhaus.org',
  'bl.spamcop.net',
  'b.barracudacentral.org',
  'dnsbl.sorbs.net',
];

/** A DNSBL "listed" answer is an A record in 127.0.0.0/8; map it to a reason. */
export function interpretDnsbl(answerIp) {
  if (!answerIp || !answerIp.startsWith('127.')) return null;
  return { listed: true, code: answerIp };
}
