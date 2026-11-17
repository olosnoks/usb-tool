// Pure helpers for the DNS / Mail Doctor: SPF / DMARC parsing, reverse-IP and
// DNSBL name construction. No network here — the component does DoH fetches and
// feeds the TXT strings to these parsers.

const SPF_LOOKUP = /^[+\-~?]?(include:|a$|a:|a\/|mx$|mx:|mx\/|ptr|exists:)|^[+\-~?]?redirect=/i;

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
  return { raw: txt.trim(), mechanisms, all, lookups: mechanisms.filter((t) => SPF_LOOKUP.test(t)).length };
}

/** Parse a DMARC record (v=DMARC1; …) into its tags. */
export function parseDmarc(txt) {
  if (!txt || !/^v=DMARC1/i.test(txt.trim())) return null;
  const tags = {};
  // Split each tag on the FIRST '=' only: values like rua=mailto:a@b?x=y keep their '='.
  txt.trim().split(';').forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return;
    const k = pair.slice(0, eq).trim().toLowerCase();
    if (k) tags[k] = pair.slice(eq + 1).trim();
  });
  const policy = tags.p || 'none';
  return {
    raw: txt.trim(),
    tags,
    policy,
    strength: policy === 'reject' ? 'strong' : policy === 'quarantine' ? 'moderate' : 'weak',
    pct: tags.pct ? Number(tags.pct) : 100,
    rua: tags.rua || null,
    ruf: tags.ruf || null,
    sp: tags.sp || null,
    adkim: tags.adkim || 'r',
    aspf: tags.aspf || 'r',
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
];

/**
 * Interpret a DNSBL A answer. Anything in 127.0.0.0/8 is normally a listing, EXCEPT
 * Spamhaus' 127.255.255.25x codes, which mean the query was refused (public/open
 * resolver, rate limit, bad query) -- not that the IP is listed.
 * -> null (not a DNSBL answer) | { listed:false, inconclusive:true, ... } | { listed:true, code }
 */
export function interpretDnsbl(answerIp) {
  if (!answerIp || !answerIp.startsWith('127.')) return null;
  if (/^127\.255\.255\.25\d$/.test(answerIp)) {
    return { listed: false, inconclusive: true, code: answerIp, reason: 'resolver refused' };
  }
  return { listed: true, code: answerIp };
}

const SPF_LIMIT = 10;

/**
 * Recursively expand an SPF record's include:/redirect= chain and count the DNS
 * lookups an evaluator would do (RFC 7208 4.6.4: include, a, mx, ptr, exists and
 * redirect each count one; limit 10). `fetchTxt(domain)` -> Promise<string[]> of the
 * domain's TXT strings (empty = no data/NXDOMAIN; may throw).
 * -> { record, lookups, voidLookups, overLimit, errors[], warnings[], tree }
 */
export async function expandSpf(domain, fetchTxt, { maxDepth = 10, maxNodes = 60 } = {}) {
  const errors = []; const warnings = [];
  let lookups = 0; let voidLookups = 0; let nodes = 0; let overReported = false;
  let rootRecord = null;

  const walk = async (dom, path, depth) => {
    const node = { domain: dom, record: null, children: [] };
    if (++nodes > maxNodes) { errors.push(`Stopped expanding after ${maxNodes} records at ${path.join(' -> ')}`); return node; }
    let txts;
    try { txts = await fetchTxt(dom); } catch (e) { errors.push(`TXT lookup failed for ${dom}: ${e?.message || e}`); node.failed = true; return node; }
    const spfs = (txts || []).filter((t) => /^v=spf1(\s|$)/i.test(String(t).trim()));
    if (spfs.length === 0) { node.missing = true; return node; }
    if (spfs.length > 1) errors.push(`${dom} publishes ${spfs.length} SPF records (permerror: only one is allowed)`);
    const rec = String(spfs[0]).trim();
    node.record = rec;
    if (depth === 0) rootRecord = rec;
    if (rec.length > 450) warnings.push(`${dom}: SPF record is ${rec.length} characters; very long TXT answers risk UDP truncation.`);
    else if (rec.length > 255) warnings.push(`${dom}: SPF record exceeds 255 characters; it must be published as multiple TXT strings.`);

    for (const raw of rec.split(/\s+/).slice(1)) {
      const t = raw.replace(/^[+\-~?]/, '');
      const lower = t.toLowerCase();
      if (/^(include:|a$|a:|a\/|mx$|mx:|mx\/|ptr|exists:)/.test(lower) || lower.startsWith('redirect=')) {
        lookups += 1;
        if (lookups > SPF_LIMIT && !overReported) {
          overReported = true;
          errors.push(`SPF exceeds the ${SPF_LIMIT}-lookup limit (lookup ${lookups}) at ${[...path, raw].join(' -> ')}`);
        }
      }
      if (lower.startsWith('ptr')) warnings.push(`${dom}: the ptr mechanism is deprecated (RFC 7208); remove it.`);
      const m = /^(include:|redirect=)(.+)$/i.exec(t);
      if (!m) continue;
      const target = m[2].replace(/\.$/, '');
      const kind = m[1].toLowerCase().replace(/[:=]$/, '');
      if (path.some((p) => p === target || p.endsWith(`:${target}`)) || target === dom) {
        errors.push(`SPF loop: ${[...path, raw].join(' -> ')} -> ${target}`);
        continue;
      }
      if (depth + 1 > maxDepth) { errors.push(`SPF nesting deeper than ${maxDepth} at ${[...path, raw].join(' -> ')}`); continue; }
      const child = await walk(target, [...path, `${kind}:${target}`], depth + 1);
      node.children.push({ kind, ...child });
      if (child.missing) {
        voidLookups += 1;
        errors.push(`${kind}:${target} has no SPF record (permerror), referenced from ${path.join(' -> ')}`);
      }
    }
    return node;
  };

  const tree = await walk(domain, [domain], 0);
  if (voidLookups > 2) warnings.push(`${voidLookups} void lookups; evaluators stop after 2 (RFC 7208 4.6.4).`);
  return { record: rootRecord, lookups, voidLookups, overLimit: lookups > SPF_LIMIT, errors, warnings, tree };
}

function parseTags(txt) {
  const tags = {};
  String(txt).split(';').forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq > 0) tags[pair.slice(0, eq).trim().toLowerCase()] = pair.slice(eq + 1).trim();
  });
  return tags;
}

/** Parse "v=STSv1; id=..." (MTA-STS DNS record). */
export function parseMtaStsTxt(txt) {
  if (!txt || !/^v=STSv1/i.test(txt.trim())) return null;
  return { raw: txt.trim(), id: parseTags(txt).id || null };
}

/** Parse the body of https://mta-sts.<domain>/.well-known/mta-sts.txt. */
export function parseMtaStsPolicy(body) {
  const p = { version: null, mode: null, mx: [], maxAge: null };
  for (const line of String(body || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase(); const v = line.slice(i + 1).trim();
    if (k === 'version') p.version = v;
    else if (k === 'mode') p.mode = v.toLowerCase();
    else if (k === 'mx') p.mx.push(v);
    else if (k === 'max_age') p.maxAge = Number(v);
  }
  return p.version ? p : null;
}

/** Parse "v=TLSRPTv1; rua=..." (SMTP TLS reporting). */
export function parseTlsRpt(txt) {
  if (!txt || !/^v=TLSRPTv1/i.test(txt.trim())) return null;
  return { raw: txt.trim(), rua: parseTags(txt).rua || null };
}

/** Parse "v=BIMI1; l=<svg url>; a=<vmc url>". */
export function parseBimi(txt) {
  if (!txt || !/^v=BIMI1/i.test(txt.trim())) return null;
  const t = parseTags(txt);
  return { raw: txt.trim(), logo: t.l || null, authority: t.a || null };
}

/** Selectors worth trying for the optional multi-selector DKIM probe. */
export const COMMON_DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'mail', 'dkim', 's1', 's2', 'mandrill', 'smtp'];

/**
 * Compare one question answered by several resolvers.
 * `results`: [{ resolver, ok, values[], error? }] -> { agree, comparable, groups[], failed[] }
 */
export function compareResolvers(results) {
  const failed = results.filter((r) => !r.ok).map((r) => ({ resolver: r.resolver, error: r.error }));
  const ok = results.filter((r) => r.ok);
  const key = (r) => [...r.values].map(String).sort().join('|');
  const groups = new Map();
  for (const r of ok) groups.set(key(r), [...(groups.get(key(r)) || []), r.resolver]);
  return {
    agree: ok.length > 1 && groups.size === 1,
    comparable: ok.length > 1,
    groups: [...groups.entries()].map(([k, resolvers]) => ({ values: k ? k.split('|') : [], resolvers })),
    failed,
  };
}

/** DNSSEC verdict from DS/DNSKEY presence and the resolver's AD flag. */
export function dnssecVerdict({ ad, hasDs, hasDnskey }) {
  if (hasDs && ad) return { state: 'validated', text: 'Signed and validated by the resolver (AD set)' };
  if (hasDs) return { state: 'unverified', text: 'DS published but the resolver did not set AD (validation not confirmed)' };
  if (hasDnskey) return { state: 'incomplete', text: 'DNSKEY present but no DS at the parent: chain of trust not established' };
  return { state: 'unsigned', text: 'Not signed with DNSSEC' };
}
