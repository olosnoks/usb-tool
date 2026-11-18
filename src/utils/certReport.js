// Pure helpers for the Certificate Inspector: fingerprint comparison, validity
// timeline, text/JSON reports and openssl command equivalents.

/** Strip separators/whitespace/"sha256:" prefixes and upper-case a hex string. */
export function normalizeHex(s) {
  return String(s || '').replace(/^\s*(sha-?\d+)\s*[:=]?\s*/i, '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/**
 * Compare a user-supplied fingerprint with the computed ones (colon hex) and the SPKI pin.
 * Returns { match, algorithm } or { match:false, reason }; null for empty input.
 */
export function matchFingerprint(input, fps) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const b64 = raw.replace(/^pin-sha256=["']?|["']$/gi, '');
  if (fps.pin && b64 === fps.pin) return { match: true, algorithm: 'SPKI pin (SHA-256)' };
  const hex = normalizeHex(raw);
  if (!hex) return { match: false, reason: 'Not a hex fingerprint or base64 pin.' };
  for (const [name, key] of [['SHA-256', 'sha256'], ['SHA-1', 'sha1'], ['SHA-512', 'sha512']]) {
    if (fps[key] && normalizeHex(fps[key]) === hex) return { match: true, algorithm: name };
  }
  const lens = { 40: 'SHA-1', 64: 'SHA-256', 128: 'SHA-512' };
  return { match: false, reason: lens[hex.length] ? `${lens[hex.length]}-length value does not match this certificate.` : `Unrecognised length (${hex.length} hex digits).` };
}

/** Where "now" sits in the validity window. */
export function validityTimeline(parsed, now = new Date()) {
  const start = parsed.notBefore.getTime(); const end = parsed.notAfter.getTime();
  const total = Math.max(1, end - start);
  const elapsed = now.getTime() - start;
  const pct = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const day = 86400000;
  const daysSinceIssued = Math.floor(elapsed / day);
  const daysLeft = Math.floor((end - now.getTime()) / day);
  let state = 'valid';
  if (now.getTime() > end) state = 'expired'; else if (now.getTime() < start) state = 'not-yet-valid'; else if (daysLeft <= 30) state = 'expiring';
  return { pct: Math.round(pct * 10) / 10, daysSinceIssued, daysLeft, totalDays: Math.round(total / day), state };
}

const list = (v) => (Array.isArray(v) ? v.join(', ') : v);

/** Plain-text report, loosely in the spirit of `openssl x509 -text` (not byte-identical). */
export function certToText(parsed, fps = {}) {
  const pk = parsed.publicKey || {};
  const lines = [
    ['Subject', parsed.subject], ['Issuer', parsed.issuer],
    ['Not Before', parsed.notBefore.toISOString()], ['Not After', parsed.notAfter.toISOString()],
    ['Version', `v${parsed.version}`], ['Serial', parsed.serial], ['Signature Algorithm', parsed.signatureAlgorithm],
    ['Public Key', `${pk.algorithm || ''}${pk.bits ? ` ${pk.bits}-bit` : ''}${pk.curve ? ` ${pk.curve}` : ''}`.trim()],
    ['Subject Alt Names', list(parsed.subjectAltNames)], ['Key Usage', list(parsed.keyUsage)],
    ['Extended Key Usage', list(parsed.extKeyUsage)],
    ['Basic Constraints', parsed.basicConstraints ? `CA:${parsed.basicConstraints.ca}${parsed.basicConstraints.pathLen != null ? `, pathlen:${parsed.basicConstraints.pathLen}` : ''}` : ''],
    ['Subject Key ID', parsed.subjectKeyIdentifier], ['Authority Key ID', parsed.authorityKeyIdentifier],
    ['CRL', list(parsed.crlDistributionPoints)], ['OCSP', list(parsed.ocsp)], ['CA Issuers', list(parsed.caIssuers)],
    ['SHA-256', fps.sha256], ['SHA-1', fps.sha1], ['SPKI pin (SHA-256, base64)', fps.pin],
  ];
  return lines.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}: ${v}`).join('\n');
}

/** JSON-safe summary object. */
export function certToJson(parsed, fps = {}) {
  const pk = parsed.publicKey || {};
  return {
    subject: parsed.subject, issuer: parsed.issuer,
    notBefore: parsed.notBefore.toISOString(), notAfter: parsed.notAfter.toISOString(),
    version: parsed.version, serial: parsed.serial, signatureAlgorithm: parsed.signatureAlgorithm,
    publicKey: { algorithm: pk.algorithm, bits: pk.bits, curve: pk.curve },
    subjectAltNames: parsed.subjectAltNames || [], keyUsage: parsed.keyUsage || [], extKeyUsage: parsed.extKeyUsage || [],
    isCA: !!parsed.isCA, selfSigned: !!parsed.selfSigned,
    ocsp: parsed.ocsp || [], crl: parsed.crlDistributionPoints || [], caIssuers: parsed.caIssuers || [],
    fingerprints: { sha256: fps.sha256, sha1: fps.sha1, sha512: fps.sha512, spkiPinSha256: fps.pin },
  };
}

/** openssl commands to reproduce checks on a saved PEM file. Text only; nothing is executed. */
export function opensslCommands({ file = 'cert.pem', host = '', chainFile = '' } = {}) {
  const h = String(host).trim().replace(/[^A-Za-z0-9.\-:_*]/g, '');
  const cmds = [
    { label: 'Full text dump', cmd: `openssl x509 -in ${file} -noout -text` },
    { label: 'SHA-256 fingerprint', cmd: `openssl x509 -in ${file} -noout -fingerprint -sha256` },
    { label: 'Dates', cmd: `openssl x509 -in ${file} -noout -dates` },
    { label: 'Expires within 30 days? (exit 1 = yes)', cmd: `openssl x509 -in ${file} -noout -checkend 2592000` },
    { label: 'SPKI pin (base64)', cmd: `openssl x509 -in ${file} -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl base64` },
  ];
  if (h) cmds.push({ label: 'Hostname check', cmd: `openssl x509 -in ${file} -noout -checkhost ${h}` });
  if (chainFile) cmds.push({ label: 'Verify against chain file', cmd: `openssl verify -untrusted ${chainFile} ${file}` });
  return cmds;
}
