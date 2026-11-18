// Extra pure helpers for the Firmware Image Analyzer: byte histogram, digests,
// "interesting string" classification and a binwalk-style text listing.

/** Count of each byte value 0..255 in bytes[start, end). */
export function byteHistogram(bytes, start = 0, end = bytes.length) {
  const counts = new Array(256).fill(0);
  const e = Math.min(end, bytes.length);
  for (let i = Math.max(0, start); i < e; i++) counts[bytes[i]]++;
  const total = Math.max(0, e - Math.max(0, start));
  const zeros = counts[0];
  const ff = counts[255];
  let printable = 0;
  for (let i = 0x20; i < 0x7f; i++) printable += counts[i];
  const pct = (n) => (total ? +((n / total) * 100).toFixed(2) : 0);
  let distinct = 0;
  for (const c of counts) if (c) distinct++;
  return { counts, total, distinct, zeroPct: pct(zeros), ffPct: pct(ff), printablePct: pct(printable) };
}

const toHex = (buf) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');

/** Hex digest of bytes using Web Crypto. algo: SHA-1, SHA-256, SHA-384 or SHA-512. */
export async function digestHex(bytes, algo = 'SHA-256') {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto is not available in this browser context.');
  return toHex(await subtle.digest(algo, bytes));
}

export const HASH_ALGOS = ['SHA-256', 'SHA-1', 'SHA-512'];

/** Rules for strings worth a second look in firmware. Pure regexes, no network. */
export const STRING_RULES = [
  { id: 'url', label: 'URL', re: /\b(?:https?|ftp|tftp|mqtts?|rtsp|telnet|ssh):\/\/[^\s"'<>]{3,}/i },
  { id: 'ip', label: 'IPv4 address', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/ },
  { id: 'email', label: 'E-mail', re: /\b[\w.+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/ },
  { id: 'private-key', label: 'Key material', re: /-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----/ },
  { id: 'credential', label: 'Credential-like', re: /\b(?:passw(?:or)?d|passwd|secret|api[_-]?key|token|admin|root)\b\s*[=:]/i },
  { id: 'version', label: 'Version banner', re: /\b(?:Linux version|U-Boot \d|BusyBox v|OpenSSL \d|uClibc|GCC: \(|dropbear|lighttpd\/|OpenWrt|Copyright \(c\))/i },
  { id: 'path', label: 'Config / system path', re: /(?:\/etc\/[\w./-]+|\/bin\/(?:sh|busybox)|\/dev\/[\w/]+|\/proc\/[\w/]+)/ }
];

/** Tag strings ({offset, encoding, text}) with the first matching rule. Returns only matches. */
export function classifyStrings(list, rules = STRING_RULES) {
  const out = [];
  for (const s of list) {
    for (const r of rules) {
      const m = r.re.exec(s.text);
      if (m) {
        out.push({ ...s, rule: r.id, label: r.label, match: m[0] });
        break;
      }
    }
  }
  return out;
}

/** Counts per rule id from classifyStrings() output. */
export function countByRule(tagged) {
  const c = {};
  for (const t of tagged) c[t.rule] = (c[t.rule] || 0) + 1;
  return c;
}

/** binwalk-style listing: DECIMAL, HEXADECIMAL, DESCRIPTION. This is our own output, not binwalk's. */
export function signaturesToText(hits) {
  const lines = ['DECIMAL       HEXADECIMAL     DESCRIPTION', '-'.repeat(60)];
  for (const h of hits) {
    const hex = `0x${h.offset.toString(16).toUpperCase()}`;
    const detail = (h.fields || []).map(([k, v]) => `${k}: ${v}`).join(', ');
    lines.push(`${String(h.offset).padEnd(13)} ${hex.padEnd(15)} ${h.name}${h.size != null ? `, ${h.size} bytes` : ''}${detail ? `, ${detail}` : ''}`);
  }
  return lines.join('\n');
}
