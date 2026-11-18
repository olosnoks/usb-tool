// Checksum-file parsing and verification (sha256sum -c style). Pure functions.

const TAG_TO_ID = {
  'MD5': 'MD5', 'SHA1': 'SHA-1', 'SHA-1': 'SHA-1', 'SHA224': 'SHA-224', 'SHA256': 'SHA-256',
  'SHA384': 'SHA-384', 'SHA512': 'SHA-512', 'SHA512/256': 'SHA-512/256', 'SHA3-224': 'SHA3-224',
  'SHA3-256': 'SHA3-256', 'SHA3-384': 'SHA3-384', 'SHA3-512': 'SHA3-512', 'RMD160': 'RIPEMD-160',
  'RIPEMD160': 'RIPEMD-160', 'RIPEMD-160': 'RIPEMD-160', 'CRC32': 'CRC-32', 'ADLER32': 'Adler-32',
};
const ID_TO_TAG = {
  'SHA-1': 'SHA1', 'SHA-224': 'SHA224', 'SHA-256': 'SHA256', 'SHA-384': 'SHA384', 'SHA-512': 'SHA512',
  'SHA-512/256': 'SHA512/256', 'RIPEMD-160': 'RIPEMD160', 'CRC-32': 'CRC32', 'Adler-32': 'ADLER32',
};

const HEX = /^[0-9a-fA-F]+$/;

/**
 * Parse checksum-file text. Understands GNU ("hash  name" / "hash *name"),
 * BSD ("SHA256 (name) = hash") and SFV ("name crc32"). Lines starting with # or ;
 * are skipped. Returns { entries: [{ hash, name, algo|null }], bad: [lineNumber] }.
 */
export function parseChecksumFile(text) {
  const entries = [];
  const bad = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/^﻿/, '').trim();
    if (!line || line[0] === '#' || line[0] === ';') return;
    let m = line.match(/^([A-Za-z0-9/-]+)\s*\((.+)\)\s*=\s*([0-9a-fA-F]+)$/);
    if (m) {
      const algo = TAG_TO_ID[m[1].toUpperCase()] || null;
      if (algo) { entries.push({ hash: m[3].toLowerCase(), name: m[2], algo }); return; }
    }
    m = line.match(/^\\?([0-9a-fA-F]{8,128})[ \t]+[ *]?(.+)$/);
    if (m && HEX.test(m[1]) && m[1].length % 2 === 0) {
      entries.push({ hash: m[1].toLowerCase(), name: m[2], algo: null });
      return;
    }
    m = line.match(/^(.+?)\s+([0-9a-fA-F]{8})$/);
    if (m) { entries.push({ hash: m[2].toLowerCase(), name: m[1], algo: 'CRC-32' }); return; }
    bad.push(i + 1);
  });
  return { entries, bad };
}

const base = (n) => String(n).replace(/\\/g, '/').split('/').pop();

/**
 * Check parsed entries against hashed files.
 * files: [{ name, rows: [{ id, value }] }]. Returns per-entry
 * { name, status: 'ok'|'failed'|'missing'|'unknown', algo } plus a summary.
 */
export function verifyChecksums(entries, files) {
  const results = entries.map((e) => {
    const f = files.find((x) => x.name === e.name)
      || files.find((x) => base(x.name) === base(e.name))
      || files.find((x) => base(x.name).toLowerCase() === base(e.name).toLowerCase());
    if (!f) return { name: e.name, status: 'missing', algo: e.algo };
    const len = e.hash.length;
    const cands = (f.rows || []).filter((r) => r.value && !r.error && r.id !== 'NTLM'
      && (e.algo ? r.id === e.algo : r.value.length === len));
    if (!cands.length) return { name: e.name, status: 'unknown', algo: e.algo };
    const hit = cands.find((r) => r.value.toLowerCase() === e.hash);
    return { name: e.name, status: hit ? 'ok' : 'failed', algo: (hit || cands[0]).id };
  });
  const count = (s) => results.filter((r) => r.status === s).length;
  const used = new Set(entries.map((e) => base(e.name).toLowerCase()));
  const unlisted = files.filter((f) => !used.has(base(f.name).toLowerCase())).map((f) => f.name);
  return { results, ok: count('ok'), failed: count('failed'), missing: count('missing'), unknown: count('unknown'), unlisted };
}

/** BSD/--tag lines: "SHA256 (name) = hash". */
export function formatBsdSums(entries, algoId) {
  const tag = ID_TO_TAG[algoId] || algoId;
  return entries.map((e) => `${tag} (${e.name}) = ${e.value}`).join('\n') + (entries.length ? '\n' : '');
}
