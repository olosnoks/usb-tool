// Dependency-free X.509 (DER/ASN.1) certificate parser.
// Extracts the fields a certificate inspector needs: version, serial, signature
// and public-key algorithms (with RSA key size / EC curve), issuer & subject DNs,
// validity window, and the common v3 extensions — subjectAltName, key usage,
// extended key usage, basic constraints, SKI/AKI, CRL distribution points and
// authorityInfoAccess (OCSP / CA Issuers). Targets the RFC 5280 shape; it is a
// pragmatic parser, not a full ASN.1 implementation.

const OIDS = {
  // Distinguished-name attributes
  '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST',
  '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber',
  '2.5.4.4': 'SN', '2.5.4.42': 'GN', '2.5.4.12': 'title', '2.5.4.9': 'street',
  '2.5.4.17': 'postalCode', '0.9.2342.19200300.100.1.25': 'DC',
  '1.2.840.113549.1.9.1': 'E',
  // Public-key algorithms
  '1.2.840.113549.1.1.1': 'RSA', '1.2.840.10045.2.1': 'EC',
  '1.3.101.112': 'Ed25519', '1.3.101.113': 'Ed448',
  // Signature algorithms
  '1.2.840.113549.1.1.11': 'SHA256withRSA', '1.2.840.113549.1.1.5': 'SHA1withRSA',
  '1.2.840.113549.1.1.12': 'SHA384withRSA', '1.2.840.113549.1.1.13': 'SHA512withRSA',
  '1.2.840.113549.1.1.14': 'SHA224withRSA', '1.2.840.113549.1.1.10': 'RSASSA-PSS',
  '1.2.840.10045.4.3.2': 'ECDSAwithSHA256', '1.2.840.10045.4.3.3': 'ECDSAwithSHA384',
  '1.2.840.10045.4.3.4': 'ECDSAwithSHA512', '1.2.840.10045.4.3.1': 'ECDSAwithSHA224',
  // EC named curves
  '1.2.840.10045.3.1.7': 'P-256 (secp256r1)', '1.3.132.0.34': 'P-384 (secp384r1)',
  '1.3.132.0.35': 'P-521 (secp521r1)', '1.3.132.0.10': 'secp256k1',
  // Extensions
  '2.5.29.17': 'subjectAltName', '2.5.29.15': 'keyUsage', '2.5.29.37': 'extKeyUsage',
  '2.5.29.19': 'basicConstraints', '2.5.29.14': 'subjectKeyIdentifier',
  '2.5.29.35': 'authorityKeyIdentifier', '2.5.29.31': 'cRLDistributionPoints',
  '1.3.6.1.5.5.7.1.1': 'authorityInfoAccess', '2.5.29.32': 'certificatePolicies',
  // Extended key usages
  '1.3.6.1.5.5.7.3.1': 'serverAuth', '1.3.6.1.5.5.7.3.2': 'clientAuth',
  '1.3.6.1.5.5.7.3.3': 'codeSigning', '1.3.6.1.5.5.7.3.4': 'emailProtection',
  '1.3.6.1.5.5.7.3.8': 'timeStamping', '1.3.6.1.5.5.7.3.9': 'OCSPSigning',
  // More signature / hash / extension / policy names
  '1.2.840.113549.1.1.4': 'MD5withRSA', '1.2.840.10045.4.1': 'ECDSAwithSHA1',
  '1.3.14.3.2.26': 'SHA-1', '2.16.840.1.101.3.4.2.1': 'SHA-256', '2.16.840.1.101.3.4.2.2': 'SHA-384',
  '2.16.840.1.101.3.4.2.3': 'SHA-512', '2.16.840.1.101.3.4.2.4': 'SHA-224',
  '2.5.29.30': 'nameConstraints', '2.5.29.18': 'issuerAltName', '2.5.29.33': 'policyMappings',
  '2.5.29.36': 'policyConstraints', '2.5.29.46': 'freshestCRL', '2.5.29.54': 'inhibitAnyPolicy',
  '2.5.29.9': 'subjectDirectoryAttributes', '1.3.6.1.5.5.7.1.24': 'tlsFeature',
  '1.3.6.1.4.1.11129.2.4.2': 'signedCertificateTimestampList', '1.3.6.1.4.1.11129.2.4.3': 'ctPoison',
  '2.23.140.1.2.1': 'domain-validated (DV)', '2.23.140.1.2.2': 'organization-validated (OV)',
  '2.23.140.1.2.3': 'extended-validation (EV)', '2.23.140.1.2.4': 'individual-validated (IV)',
  '2.23.140.1.1': 'CA/B Forum EV guidelines', '2.5.29.32.0': 'anyPolicy',
  '1.3.6.1.5.5.7.2.1': 'CPS', '1.3.6.1.5.5.7.2.2': 'userNotice',
  // AIA access methods
  '1.3.6.1.5.5.7.48.1': 'OCSP', '1.3.6.1.5.5.7.48.2': 'caIssuers',
};

const KEY_USAGE_BITS = ['digitalSignature', 'nonRepudiation', 'keyEncipherment', 'dataEncipherment', 'keyAgreement', 'keyCertSign', 'cRLSign', 'encipherOnly', 'decipherOnly'];

function readTLV(buf, offset) {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let headerLen = 2;
  if (len & 0x80) {
    const numBytes = len & 0x7f;
    len = 0;
    for (let i = 0; i < numBytes; i++) len = len * 256 + buf[offset + 2 + i];
    headerLen = 2 + numBytes;
  }
  const contentStart = offset + headerLen;
  return { tag, len, headerLen, start: offset, contentStart, contentEnd: contentStart + len, next: contentStart + len };
}

function readSeqChildren(buf, parent) {
  const kids = [];
  let p = parent.contentStart;
  while (p < parent.contentEnd) { const t = readTLV(buf, p); kids.push(t); p = t.next; }
  return kids;
}

function decodeOID(buf, tlv) {
  const b = buf.subarray(tlv.contentStart, tlv.contentEnd);
  const parts = [];
  parts.push(Math.floor(b[0] / 40), b[0] % 40);
  let val = 0;
  for (let i = 1; i < b.length; i++) { val = val * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(val); val = 0; } }
  return parts.join('.');
}

const decodeString = (buf, tlv) => new TextDecoder().decode(buf.subarray(tlv.contentStart, tlv.contentEnd));
const hex = (bytes) => Array.from(bytes).map((x) => x.toString(16).padStart(2, '0')).join(':');

function decodeTime(buf, tlv) {
  const s = decodeString(buf, tlv);
  let y; let rest;
  if (tlv.tag === 0x17) { y = parseInt(s.slice(0, 2), 10); y += y < 50 ? 2000 : 1900; rest = s.slice(2); }
  else { y = parseInt(s.slice(0, 4), 10); rest = s.slice(4); }
  const [mo, d, h, mi, se] = [rest.slice(0, 2), rest.slice(2, 4), rest.slice(4, 6), rest.slice(6, 8), rest.slice(8, 10)].map((x) => parseInt(x, 10) || 0);
  return new Date(Date.UTC(y, mo - 1, d, h, mi, se));
}

function decodeInteger(buf, tlv) { return hex(buf.subarray(tlv.contentStart, tlv.contentEnd)); }

function parseName(buf, nameTlv) {
  const parts = [];
  for (const rdn of readSeqChildren(buf, nameTlv)) {
    for (const atv of readSeqChildren(buf, rdn)) {
      const kids = readSeqChildren(buf, atv);
      if (kids.length < 2) continue;
      const oid = decodeOID(buf, kids[0]);
      parts.push(`${OIDS[oid] || oid}=${decodeString(buf, kids[1])}`);
    }
  }
  return parts.join(', ');
}

const hexc = (bytes) => Array.from(bytes).map((x) => x.toString(16).padStart(2, '0')).join('');

function ipv6String(c) {
  const g = [];
  for (let i = 0; i < c.length; i += 2) g.push(c[i].toString(16).padStart(2, '0') + c[i + 1].toString(16).padStart(2, '0'));
  return g.join(':');
}

// One GeneralName -> "DNS:x" / "IP:x" / ... or null when the form is not decoded.
function generalNameToString(buf, gn) {
  const content = buf.subarray(gn.contentStart, gn.contentEnd);
  const text = () => new TextDecoder().decode(content);
  if (gn.tag === 0x82) return 'DNS:' + text();
  if (gn.tag === 0x81) return 'email:' + text();
  if (gn.tag === 0x86) return 'URI:' + text();
  if (gn.tag === 0x87) {
    if (content.length === 4) return 'IP:' + Array.from(content).join('.');
    if (content.length === 8) return 'IP:' + Array.from(content.subarray(0, 4)).join('.') + '/' + Array.from(content.subarray(4)).join('.');
    if (content.length === 16) return 'IP:' + ipv6String(content);
    if (content.length === 32) return 'IP:' + ipv6String(content.subarray(0, 16)) + '/' + ipv6String(content.subarray(16));
    return null;
  }
  if (gn.tag === 0xa4) { try { return 'dirName:' + parseName(buf, readTLV(buf, gn.contentStart)); } catch { return null; } }
  if (gn.tag === 0x88) { try { return 'RID:' + decodeOID(buf, { contentStart: gn.contentStart, contentEnd: gn.contentEnd }); } catch { return null; } }
  if (gn.tag === 0xa0) { try { const k = readTLV(buf, gn.contentStart); return 'otherName:' + decodeOID(buf, k); } catch { return null; } }
  return null;
}

function parseSAN(buf, inner) {
  const names = [];
  for (const gn of readSeqChildren(buf, inner)) {
    const s = generalNameToString(buf, gn);
    // Preserve the historical behaviour for forms the old parser skipped.
    if (s && (gn.tag === 0x82 || gn.tag === 0x81 || gn.tag === 0x86 || gn.tag === 0x87 || gn.tag === 0xa4 || gn.tag === 0x88)) names.push(s);
  }
  return names;
}

function parseNameConstraints(buf, inner) {
  const out = { permitted: [], excluded: [] };
  for (const k of readSeqChildren(buf, inner)) {
    const target = k.tag === 0xa0 ? out.permitted : k.tag === 0xa1 ? out.excluded : null;
    if (!target) continue;
    for (const subtree of readSeqChildren(buf, k)) {
      const gn = readSeqChildren(buf, subtree)[0];
      if (!gn) continue;
      target.push(generalNameToString(buf, gn) || `(tag 0x${gn.tag.toString(16)})`);
    }
  }
  return out;
}

function parseCertificatePolicies(buf, inner) {
  const out = [];
  for (const pi of readSeqChildren(buf, inner)) {
    const kids = readSeqChildren(buf, pi);
    if (!kids[0]) continue;
    const oid = decodeOID(buf, kids[0]);
    const pol = { oid, name: OIDS[oid] || null, cps: [], notices: [] };
    if (kids[1]) {
      for (const q of readSeqChildren(buf, kids[1])) {
        const qk = readSeqChildren(buf, q);
        if (qk.length < 2) continue;
        const qid = decodeOID(buf, qk[0]);
        if (qid === '1.3.6.1.5.5.7.2.1') pol.cps.push(decodeString(buf, qk[1]));
        else if (qid === '1.3.6.1.5.5.7.2.2') {
          // UserNotice: look for an explicitText string inside
          const found = [];
          const walk = (t) => { if ([0x0c, 0x16, 0x1a, 0x1e].includes(t.tag)) found.push(decodeString(buf, t)); else if (t.tag & 0x20) readSeqChildren(buf, t).forEach(walk); };
          walk(qk[1]);
          if (found.length) pol.notices.push(found.join(' '));
        }
      }
    }
    out.push(pol);
  }
  return out;
}

// RFC 6962 SignedCertificateTimestampList (TLS encoding) inside the extension.
function parseSctList(bytes) {
  const out = [];
  if (bytes.length < 2) return out;
  const total = (bytes[0] << 8) | bytes[1];
  let p = 2;
  const end = Math.min(bytes.length, 2 + total);
  while (p + 2 <= end) {
    const len = (bytes[p] << 8) | bytes[p + 1]; p += 2;
    const sct = bytes.subarray(p, p + len); p += len;
    if (sct.length < 41) break;
    let ts = 0n;
    for (let i = 0; i < 8; i++) ts = (ts << 8n) | BigInt(sct[33 + i]);
    out.push({ version: sct[0] + 1, logId: hexc(sct.subarray(1, 33)), timestamp: new Date(Number(ts)).toISOString() });
  }
  return out;
}

// Collect all TLVs with a given tag within [start,end) (shallow recursive scan).
function scanForTag(buf, start, end, tag, out) {
  let p = start;
  while (p < end) {
    let t;
    try { t = readTLV(buf, p); } catch { break; }
    if (t.contentEnd > end || t.len < 0) break;
    if (t.tag === tag) out.push(new TextDecoder().decode(buf.subarray(t.contentStart, t.contentEnd)));
    // recurse into constructed types
    if (t.tag & 0x20) scanForTag(buf, t.contentStart, t.contentEnd, tag, out);
    p = t.next;
    if (p <= start) break;
  }
}

function emptyExts() {
  return { subjectAltNames: [], keyUsage: [], extKeyUsage: [], basicConstraints: null, ski: null, aki: null, crl: [], ocsp: [], caIssuers: [], critical: [], policies: [], nameConstraints: null, tlsFeatures: [], mustStaple: false, scts: null, unknown: [] };
}

function interpretExtensions(der, extList) {
  const result = emptyExts();
  for (const ext of extList) {
    const kids = readSeqChildren(der, ext);
    const oid = decodeOID(der, kids[0]);
    const name = OIDS[oid] || oid;
    const critical = kids.length === 3 && der[kids[1].contentStart] !== 0; // BOOLEAN TRUE
    if (critical) result.critical.push(name);
    const extnValue = kids[kids.length - 1];
    let inner;
    try { inner = readTLV(der, extnValue.contentStart); } catch { continue; }
    let handled = true;
    try {
      if (oid === '2.5.29.17') result.subjectAltNames = parseSAN(der, inner);
      else if (oid === '2.5.29.15') {
        // keyUsage: BIT STRING; first content byte = unused bits
        const bytes = der.subarray(inner.contentStart + 1, inner.contentEnd);
        KEY_USAGE_BITS.forEach((n, i) => { const byte = bytes[Math.floor(i / 8)]; if (byte && (byte & (0x80 >> (i % 8)))) result.keyUsage.push(n); });
      } else if (oid === '2.5.29.37') {
        for (const o of readSeqChildren(der, inner)) result.extKeyUsage.push(OIDS[decodeOID(der, o)] || decodeOID(der, o));
      } else if (oid === '2.5.29.19') {
        const kids2 = readSeqChildren(der, inner);
        let ca = false; let pathLen = null;
        for (const k of kids2) { if (k.tag === 0x01) ca = der[k.contentStart] !== 0; else if (k.tag === 0x02) pathLen = der[k.contentStart]; }
        result.basicConstraints = { ca, pathLen };
      } else if (oid === '2.5.29.14') {
        result.ski = hex(der.subarray(inner.contentStart, inner.contentEnd));
      } else if (oid === '2.5.29.35') {
        const k0 = readSeqChildren(der, inner).find((k) => k.tag === 0x80);
        if (k0) result.aki = hex(der.subarray(k0.contentStart, k0.contentEnd));
      } else if (oid === '2.5.29.31') {
        scanForTag(der, inner.contentStart, inner.contentEnd, 0x86, result.crl);
      } else if (oid === '1.3.6.1.5.5.7.1.1') {
        for (const ad of readSeqChildren(der, inner)) {
          const adKids = readSeqChildren(der, ad);
          if (adKids.length < 2) continue;
          const method = decodeOID(der, adKids[0]);
          const loc = adKids[1];
          const uri = loc.tag === 0x86 ? new TextDecoder().decode(der.subarray(loc.contentStart, loc.contentEnd)) : null;
          if (!uri) continue;
          if (method === '1.3.6.1.5.5.7.48.1') result.ocsp.push(uri);
          else if (method === '1.3.6.1.5.5.7.48.2') result.caIssuers.push(uri);
        }
      } else if (oid === '2.5.29.32') {
        result.policies = parseCertificatePolicies(der, inner);
      } else if (oid === '2.5.29.30') {
        result.nameConstraints = parseNameConstraints(der, inner);
      } else if (oid === '1.3.6.1.5.5.7.1.24') {
        result.tlsFeatures = readSeqChildren(der, inner).map((k) => { let v = 0; for (let i = k.contentStart; i < k.contentEnd; i++) v = v * 256 + der[i]; return v; });
        result.mustStaple = result.tlsFeatures.includes(5);
      } else if (oid === '1.3.6.1.4.1.11129.2.4.2') {
        result.scts = parseSctList(der.subarray(inner.contentStart, inner.contentEnd));
      } else handled = false;
    } catch { /* tolerate a malformed extension */ }
    if (!handled) result.unknown.push({ oid, name: OIDS[oid] || null, critical, hex: hexc(der.subarray(extnValue.contentStart, extnValue.contentEnd)) });
  }
  return result;
}

function subjectCommonName(buf, nameTlv) {
  let cn = null;
  try {
    for (const rdn of readSeqChildren(buf, nameTlv)) {
      for (const atv of readSeqChildren(buf, rdn)) {
        const kids = readSeqChildren(buf, atv);
        if (kids.length >= 2 && decodeOID(buf, kids[0]) === '2.5.4.3') cn = decodeString(buf, kids[1]);
      }
    }
  } catch { /* ignore */ }
  return cn;
}

function publicKeyDetails(der, spki) {
  const spkiKids = readSeqChildren(der, spki);
  const algSeq = spkiKids[0];
  const algKids = readSeqChildren(der, algSeq);
  const algOid = decodeOID(der, algKids[0]);
  const algName = OIDS[algOid] || algOid;
  const detail = { algorithm: algName, bits: null, curve: null, namedCurve: null, exponent: null };
  try {
    if (algName === 'RSA') {
      const bitStr = spkiKids[1]; // BIT STRING
      const rsaSeq = readTLV(der, bitStr.contentStart + 1); // skip unused-bits byte
      const rsaKids = readSeqChildren(der, rsaSeq);
      let mod = der.subarray(rsaKids[0].contentStart, rsaKids[0].contentEnd);
      if (mod[0] === 0x00) mod = mod.subarray(1);
      detail.bits = mod.length * 8;
      const expBytes = der.subarray(rsaKids[1].contentStart, rsaKids[1].contentEnd);
      detail.exponent = Array.from(expBytes).reduce((a, b) => a * 256 + b, 0);
    } else if (algName === 'EC') {
      if (algKids[1]) {
        detail.curve = OIDS[decodeOID(der, algKids[1])] || decodeOID(der, algKids[1]);
        const m = /^P-(256|384|521)/.exec(detail.curve);
        if (m) detail.namedCurve = `P-${m[1]}`;
      }
    }
  } catch { /* ignore */ }
  return detail;
}

/** Parse a DER-encoded certificate (Uint8Array). Returns a plain info object. */
export function parseCertificate(der) {
  const cert = readTLV(der, 0);
  if (cert.tag !== 0x30) throw new Error('Not a DER SEQUENCE (invalid certificate)');
  const top = readSeqChildren(der, cert);
  const tbs = top[0];
  const tbsKids = readSeqChildren(der, tbs);

  let idx = 0; let version = 1;
  if (tbsKids[0] && tbsKids[0].tag === 0xa0) { const vInt = readTLV(der, tbsKids[0].contentStart); version = der[vInt.contentStart] + 1; idx = 1; }
  const serial = decodeInteger(der, tbsKids[idx]); idx++;
  const sigAlgSeq = tbsKids[idx]; idx++;
  const issuerTlv = tbsKids[idx];
  const issuer = parseName(der, tbsKids[idx]); idx++;
  const validity = tbsKids[idx]; idx++;
  const subjectTlv = tbsKids[idx];
  const subject = parseName(der, tbsKids[idx]); idx++;
  const spki = tbsKids[idx]; idx++;

  const validityKids = readSeqChildren(der, validity);
  const notBefore = decodeTime(der, validityKids[0]);
  const notAfter = decodeTime(der, validityKids[1]);
  const sigAlgKids = readSeqChildren(der, sigAlgSeq);
  const sigAlgOid = decodeOID(der, sigAlgKids[0]);
  const sigParams = sigAlgKids[1] && sigAlgKids[1].tag === 0x30 ? der.slice(sigAlgKids[1].start, sigAlgKids[1].next) : null;
  const sigBits = top[2];
  const signatureValue = sigBits ? der.slice(sigBits.contentStart + 1, sigBits.contentEnd) : new Uint8Array(0);
  const subjectCN = subjectCommonName(der, subjectTlv);
  const pk = publicKeyDetails(der, spki);

  // extensions in the [3] EXPLICIT context tag
  let exts = emptyExts();
  const extsCtx = tbsKids.find((c) => c.tag === 0xa3);
  if (extsCtx) { try { exts = interpretExtensions(der, readSeqChildren(der, readTLV(der, extsCtx.contentStart))); } catch { /* ignore */ } }

  const now = new Date();
  const msDay = 86400000;
  return {
    version, serial,
    signatureAlgorithm: OIDS[sigAlgOid] || sigAlgOid,
    signatureAlgorithmOid: sigAlgOid,
    signatureParams: sigParams,
    signatureValue,
    tbsDer: der.slice(tbs.start, tbs.next),
    spkiDer: der.slice(spki.start, spki.next),
    issuerRaw: hexc(der.subarray(issuerTlv.start, issuerTlv.next)),
    subjectRaw: hexc(der.subarray(subjectTlv.start, subjectTlv.next)),
    subjectCN,
    publicKeyAlgorithm: pk.algorithm,
    publicKey: pk,
    issuer, subject,
    notBefore, notAfter,
    expired: now > notAfter,
    notYetValid: now < notBefore,
    daysUntilExpiry: Math.floor((notAfter - now) / msDay),
    validityDays: Math.round((notAfter - notBefore) / msDay),
    selfSigned: issuer === subject,
    subjectAltNames: exts.subjectAltNames,
    keyUsage: exts.keyUsage,
    extKeyUsage: exts.extKeyUsage,
    basicConstraints: exts.basicConstraints,
    isCA: !!(exts.basicConstraints && exts.basicConstraints.ca),
    subjectKeyIdentifier: exts.ski,
    authorityKeyIdentifier: exts.aki,
    crlDistributionPoints: exts.crl,
    ocsp: exts.ocsp,
    caIssuers: exts.caIssuers,
    criticalExtensions: exts.critical,
    certificatePolicies: exts.policies,
    nameConstraints: exts.nameConstraints,
    tlsFeatures: exts.tlsFeatures,
    mustStaple: exts.mustStaple,
    scts: exts.scts,
    unknownExtensions: exts.unknown,
  };
}

/** Accept either a PEM string or raw DER bytes and return DER Uint8Array. */
export function toDER(input) {
  if (typeof input === 'string' && input.includes('-----BEGIN')) {
    const b64 = input.replace(/-----(BEGIN|END)[^-]+-----/g, '').replace(/\s+/g, '');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (input instanceof Uint8Array) return input;
  return Uint8Array.from(String(input), (c) => c.charCodeAt(0));
}

/** Split a PEM bundle into individual certificate blocks (for chains). */
export function splitPemChain(pem) {
  const blocks = [];
  const re = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g;
  let m;
  while ((m = re.exec(pem)) !== null) blocks.push(m[0]);
  return blocks;
}

// ---------------------------------------------------------------------------
// Bundles (PEM, PKCS#7), PEM output, fingerprints and pins
// ---------------------------------------------------------------------------

const OID_SIGNED_DATA = '1.2.840.113549.1.7.2';

/** Extract the DER certificates from a PKCS#7 SignedData (.p7b / .p7c) blob. */
export function extractCertsFromPkcs7(der) {
  const ci = readTLV(der, 0);
  if (ci.tag !== 0x30) throw new Error('Not a PKCS#7 structure.');
  if (der[1] === 0x80) throw new Error('This PKCS#7 uses BER indefinite lengths, which this tool cannot read. Convert it first: openssl pkcs7 -in file.p7b -print_certs -out bundle.pem');
  const kids = readSeqChildren(der, ci);
  if (!kids[0] || kids[0].tag !== 0x06 || decodeOID(der, kids[0]) !== OID_SIGNED_DATA) throw new Error('PKCS#7 content is not SignedData.');
  const content = kids[1];
  if (!content) throw new Error('PKCS#7 has no content.');
  const sd = readTLV(der, content.contentStart);
  const certsCtx = readSeqChildren(der, sd).find((k) => k.tag === 0xa0);
  if (!certsCtx) return [];
  return readSeqChildren(der, certsCtx).filter((c) => c.tag === 0x30).map((c) => der.slice(c.start, c.next));
}

function isPkcs7Der(bytes) {
  try {
    const ci = readTLV(bytes, 0);
    if (ci.tag !== 0x30) return false;
    const first = readTLV(bytes, ci.contentStart);
    return first.tag === 0x06 && decodeOID(bytes, first) === OID_SIGNED_DATA;
  } catch { return false; }
}

/**
 * Turn any certificate container into an array of DER certificates:
 * a PEM bundle (every block), a PEM/DER PKCS#7, or a single DER certificate.
 * `input` is a string or bytes.
 */
export function loadCertificateBundle(input) {
  let text = null;
  if (typeof input === 'string') text = input;
  else {
    const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64));
    if (head.includes('-----BEGIN')) text = new TextDecoder().decode(bytes);
    else return isPkcs7Der(bytes) ? extractCertsFromPkcs7(bytes) : [bytes];
  }
  const blocks = splitPemChain(text);
  if (blocks.length) return blocks.map((b) => toDER(b));
  const p7 = /-----BEGIN (?:PKCS7|CMS)-----[\s\S]*?-----END (?:PKCS7|CMS)-----/.exec(text);
  if (p7) return extractCertsFromPkcs7(toDER(p7[0]));
  if (text.includes('-----BEGIN')) throw new Error('No certificate found in the PEM (only CERTIFICATE and PKCS7 blocks are read).');
  return [toDER(text)];
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** DER -> PEM text. Chunked so very large inputs cannot overflow the call stack. */
export function pemFromDer(der, label = 'CERTIFICATE') {
  const b64 = bytesToBase64(der).replace(/(.{64})/g, '$1\n').replace(/\n$/, '');
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----\n`;
}

/** Colon-separated upper-case hex digest of DER bytes (SHA-1/256/384/512). */
export async function fingerprintHex(der, alg = 'SHA-256') {
  const buf = await crypto.subtle.digest(alg, der);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/** HPKP-style pin: base64(SHA-256(SubjectPublicKeyInfo DER)). */
export async function spkiPin(parsed) {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', parsed.spkiDer)));
}

// ---------------------------------------------------------------------------
// Hostname matching (RFC 6125)
// ---------------------------------------------------------------------------

function expandIPv6(s) {
  if (!s.includes(':')) return null;
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  let all;
  if (tail === undefined) {
    if (h.length !== 8) return null;
    all = h;
  } else {
    const missing = 8 - h.length - t.length;
    if (missing < 0) return null;
    all = [...h, ...Array(missing).fill('0'), ...t];
  }
  if (all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return all.map((g) => g.toLowerCase().padStart(4, '0')).join(':');
}

function dnsMatch(pattern, host) {
  const p = pattern.toLowerCase().replace(/\.$/, '');
  if (!p.includes('*')) return p === host;
  const pl = p.split('.');
  // Only a whole leftmost label "*", and at least two labels after it (no "*.com").
  if (pl[0] !== '*' || pl.slice(1).some((l) => l.includes('*')) || pl.length < 3) return false;
  const hl = host.split('.');
  return hl.length === pl.length && hl[0].length > 0 && pl.slice(1).every((l, i) => l === hl[i + 1]);
}

/**
 * Does the certificate cover `hostInput`? SAN DNS/IP entries are authoritative;
 * the subject CN is consulted only when the certificate has no SAN at all.
 * Wildcards match exactly one label, only as the whole leftmost label.
 */
export function matchHostname(parsed, hostInput) {
  const host = String(hostInput || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return { match: false, matchedName: null, via: null, reason: 'No hostname given.', names: [] };
  const isV4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const v6 = isV4 ? null : expandIPv6(host);
  const sans = parsed.subjectAltNames || [];
  if (isV4 || v6) {
    const ips = sans.filter((n) => n.startsWith('IP:')).map((n) => n.slice(3));
    const hit = ips.find((ip) => (isV4 ? ip === host : expandIPv6(ip) === v6));
    return hit
      ? { match: true, matchedName: `IP:${hit}`, via: 'SAN', reason: 'IP address matches a SAN entry.', names: ips }
      : { match: false, matchedName: null, via: null, reason: 'IP address is not in the certificate SAN (the CN is never used for IPs).', names: ips };
  }
  const dns = sans.filter((n) => n.startsWith('DNS:')).map((n) => n.slice(4));
  const useCN = dns.length === 0 && !sans.some((n) => n.startsWith('IP:'));
  const candidates = dns.length ? dns : (useCN && parsed.subjectCN ? [parsed.subjectCN] : []);
  const hit = candidates.find((n) => dnsMatch(n, host));
  if (hit) return { match: true, matchedName: hit, via: dns.length ? 'SAN' : 'CN', reason: dns.length ? 'Matches a SAN dNSName.' : 'Matches the subject CN (certificate has no SAN; deprecated by RFC 6125).', names: candidates };
  return { match: false, matchedName: null, via: null, reason: candidates.length ? `No ${dns.length ? 'SAN dNSName' : 'CN'} matches ${host}.` : 'Certificate has no SAN dNSName or CN to match.', names: candidates };
}

// ---------------------------------------------------------------------------
// Signature verification and chain building
// ---------------------------------------------------------------------------

const SIG_ALGS = {
  '1.2.840.113549.1.1.4': { kind: 'rsa', hash: null, label: 'MD5' },
  '1.2.840.113549.1.1.5': { kind: 'rsa', hash: 'SHA-1' },
  '1.2.840.113549.1.1.14': { kind: 'rsa', hash: null, label: 'SHA-224' },
  '1.2.840.113549.1.1.11': { kind: 'rsa', hash: 'SHA-256' },
  '1.2.840.113549.1.1.12': { kind: 'rsa', hash: 'SHA-384' },
  '1.2.840.113549.1.1.13': { kind: 'rsa', hash: 'SHA-512' },
  '1.2.840.113549.1.1.10': { kind: 'pss' },
  '1.2.840.10045.4.1': { kind: 'ecdsa', hash: 'SHA-1' },
  '1.2.840.10045.4.3.1': { kind: 'ecdsa', hash: null, label: 'SHA-224' },
  '1.2.840.10045.4.3.2': { kind: 'ecdsa', hash: 'SHA-256' },
  '1.2.840.10045.4.3.3': { kind: 'ecdsa', hash: 'SHA-384' },
  '1.2.840.10045.4.3.4': { kind: 'ecdsa', hash: 'SHA-512' },
  '1.3.101.112': { kind: 'ed25519' },
};
const HASH_BY_OID = { '1.3.14.3.2.26': 'SHA-1', '2.16.840.1.101.3.4.2.1': 'SHA-256', '2.16.840.1.101.3.4.2.2': 'SHA-384', '2.16.840.1.101.3.4.2.3': 'SHA-512', '2.16.840.1.101.3.4.2.4': 'SHA-224' };
const SUPPORTED_PSS_HASH = ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

function parsePssParams(params) {
  const out = { hash: 'SHA-1', saltLength: 20 };
  if (!params) return out;
  const seq = readTLV(params, 0);
  for (const k of readSeqChildren(params, seq)) {
    if (k.tag === 0xa0) {
      const algId = readTLV(params, k.contentStart);
      out.hash = HASH_BY_OID[decodeOID(params, readSeqChildren(params, algId)[0])] || 'unknown';
    } else if (k.tag === 0xa2) {
      const i = readTLV(params, k.contentStart);
      let v = 0;
      for (let n = i.contentStart; n < i.contentEnd; n++) v = v * 256 + params[n];
      out.saltLength = v;
    }
  }
  return out;
}

function derSigToRaw(sig, size) {
  const t = readTLV(sig, 0);
  if (t.tag !== 0x30) throw new Error('ECDSA signature is not a DER SEQUENCE');
  const [r, s] = readSeqChildren(sig, t);
  const fix = (x) => {
    let v = sig.subarray(x.contentStart, x.contentEnd);
    while (v.length > 0 && v[0] === 0) v = v.subarray(1);
    if (v.length > size) throw new Error('ECDSA r/s value too large for the curve');
    const o = new Uint8Array(size);
    o.set(v, size - v.length);
    return o;
  };
  const out = new Uint8Array(size * 2);
  out.set(fix(r), 0);
  out.set(fix(s), size);
  return out;
}

/**
 * Verify `cert`'s signature with `issuer`'s public key (Web Crypto).
 * Returns { ok: true | false | null, reason }; null means "could not evaluate".
 */
export async function verifyCertSignature(cert, issuer) {
  const sa = SIG_ALGS[cert.signatureAlgorithmOid];
  if (!sa) return { ok: null, reason: `Signature algorithm ${cert.signatureAlgorithm} is not supported for verification.` };
  if (sa.kind !== 'pss' && sa.kind !== 'ed25519' && !sa.hash) return { ok: null, reason: `${sa.label} signatures cannot be verified (not available in Web Crypto).` };
  const pkAlg = issuer.publicKey?.algorithm;
  try {
    const subtle = crypto.subtle;
    let ok;
    if (sa.kind === 'rsa' || sa.kind === 'pss') {
      if (pkAlg !== 'RSA' && pkAlg !== 'RSASSA-PSS') return { ok: false, reason: `Issuer key is ${pkAlg}, but the signature is RSA.` };
      if (sa.kind === 'rsa') {
        const key = await subtle.importKey('spki', issuer.spkiDer, { name: 'RSASSA-PKCS1-v1_5', hash: sa.hash }, false, ['verify']);
        ok = await subtle.verify({ name: 'RSASSA-PKCS1-v1_5' }, key, cert.signatureValue, cert.tbsDer);
      } else {
        const pp = parsePssParams(cert.signatureParams);
        if (!SUPPORTED_PSS_HASH.includes(pp.hash)) return { ok: null, reason: `RSASSA-PSS hash ${pp.hash} is not supported for verification.` };
        const key = await subtle.importKey('spki', issuer.spkiDer, { name: 'RSA-PSS', hash: pp.hash }, false, ['verify']);
        ok = await subtle.verify({ name: 'RSA-PSS', saltLength: pp.saltLength }, key, cert.signatureValue, cert.tbsDer);
      }
    } else if (sa.kind === 'ecdsa') {
      if (pkAlg !== 'EC') return { ok: false, reason: `Issuer key is ${pkAlg}, but the signature is ECDSA.` };
      const curve = issuer.publicKey.namedCurve;
      if (!curve) return { ok: null, reason: `Curve ${issuer.publicKey.curve} is not supported by Web Crypto.` };
      const size = { 'P-256': 32, 'P-384': 48, 'P-521': 66 }[curve];
      const raw = derSigToRaw(cert.signatureValue, size);
      const key = await subtle.importKey('spki', issuer.spkiDer, { name: 'ECDSA', namedCurve: curve }, false, ['verify']);
      ok = await subtle.verify({ name: 'ECDSA', hash: sa.hash }, key, raw, cert.tbsDer);
    } else {
      if (pkAlg !== 'Ed25519') return { ok: false, reason: `Issuer key is ${pkAlg}, but the signature is Ed25519.` };
      const key = await subtle.importKey('spki', issuer.spkiDer, { name: 'Ed25519' }, false, ['verify']);
      ok = await subtle.verify({ name: 'Ed25519' }, key, cert.signatureValue, cert.tbsDer);
    }
    return { ok, reason: ok ? 'Signature valid.' : 'Signature does NOT verify against the issuer key.' };
  } catch (e) {
    return { ok: null, reason: `Could not verify: ${e.message}` };
  }
}

const normName = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
const sameName = (issuerOf, subjectOf) => issuerOf.issuerRaw === subjectOf.subjectRaw || normName(issuerOf.issuer) === normName(subjectOf.subject);

/** Weakness hints for one certificate: array of { level: 'bad' | 'warn', text }. */
export function weaknessHints(p, { isLeaf = !p.isCA } = {}) {
  const hints = [];
  const sig = p.signatureAlgorithm || '';
  if (/MD5/i.test(sig)) hints.push({ level: 'bad', text: 'Signed with MD5 (broken).' });
  else if (/SHA1/i.test(sig)) hints.push({ level: 'bad', text: 'Signed with SHA-1 (deprecated, collision attacks).' });
  if (p.publicKey?.algorithm === 'RSA' && p.publicKey.bits && p.publicKey.bits < 2048) hints.push({ level: 'bad', text: `RSA key is only ${p.publicKey.bits} bits (minimum 2048).` });
  if (p.publicKey?.curve === 'secp256k1') hints.push({ level: 'warn', text: 'secp256k1 is not accepted by browsers for TLS.' });
  if (isLeaf && !p.isCA) {
    if (p.validityDays > 398) hints.push({ level: 'warn', text: `Validity is ${p.validityDays} days (publicly trusted TLS certificates are limited to 398 days or less).` });
    if (!p.subjectAltNames || p.subjectAltNames.length === 0) hints.push({ level: 'warn', text: 'No subjectAltName: modern clients ignore the CN.' });
  }
  return hints;
}

/**
 * Order DER certificates leaf -> root and verify every link.
 * Returns { chain: [{ index, parsed, der, sig, issuerMissing, selfSigned, notes }],
 * unused: [index], problems: [string], valid }.
 * "valid" means the supplied certificates form a complete, correctly signed,
 * unexpired path to a self-signed root; it does NOT consult a trust store.
 */
export async function buildChain(ders, { now = new Date(), leafIndex } = {}) {
  const certs = ders.map((der, index) => ({ index, der, parsed: parseCertificate(der) }));
  const problems = [];
  if (certs.length === 0) return { chain: [], unused: [], problems: ['No certificates.'], valid: false };

  let leaf;
  if (leafIndex != null && certs[leafIndex]) leaf = certs[leafIndex];
  else leaf = certs.find((c) => !certs.some((o) => o !== c && sameName(o.parsed, c.parsed))) || certs[0];

  const chain = [];
  const used = new Set();
  let cur = leaf;
  for (let guard = 0; guard < certs.length + 1; guard++) {
    used.add(cur);
    const entry = { index: cur.index, parsed: cur.parsed, der: cur.der, sig: null, issuerMissing: false, selfSigned: false, notes: [] };
    chain.push(entry);
    const p = cur.parsed;
    if (now > p.notAfter) entry.notes.push({ level: 'bad', text: 'Expired.' });
    else if (now < p.notBefore) entry.notes.push({ level: 'bad', text: 'Not yet valid.' });
    for (const h of weaknessHints(p, { isLeaf: chain.length === 1 })) entry.notes.push(h);

    if (sameName(p, p)) {
      entry.selfSigned = true;
      entry.sig = await verifyCertSignature(p, p);
      entry.notes.push({ level: 'info', text: 'Self-signed (root). Trust is not evaluated.' });
      break;
    }
    let cands = certs.filter((c) => !used.has(c) && sameName(p, c.parsed));
    if (p.authorityKeyIdentifier) {
      const byKey = cands.filter((c) => c.parsed.subjectKeyIdentifier === p.authorityKeyIdentifier);
      if (byKey.length) cands = [...byKey, ...cands.filter((c) => !byKey.includes(c))];
    }
    if (cands.length === 0) {
      entry.issuerMissing = true;
      entry.notes.push({ level: 'bad', text: 'Issuer certificate not found.' });
      break;
    }
    let chosen = null;
    let chosenSig = null;
    for (const c of cands) {
      const r = await verifyCertSignature(p, c.parsed);
      if (r.ok) { chosen = c; chosenSig = r; break; }
      if (!chosen) { chosen = c; chosenSig = r; }
    }
    entry.sig = chosenSig;
    const ip = chosen.parsed;
    if (!ip.isCA) entry.notes.push({ level: 'bad', text: 'Issuer is not a CA (basicConstraints CA:TRUE missing).' });
    else if (ip.keyUsage.length && !ip.keyUsage.includes('keyCertSign')) entry.notes.push({ level: 'bad', text: 'Issuer keyUsage lacks keyCertSign.' });
    cur = chosen;
  }

  for (const [i, e] of chain.entries()) {
    const label = `#${i} ${e.parsed.subject}`;
    if (e.issuerMissing) problems.push(`${label}: issuer certificate not found`);
    if (e.sig && e.sig.ok === false) problems.push(`${label}: signature check failed`);
    if (e.sig && e.sig.ok === null) problems.push(`${label}: signature could not be verified (${e.sig.reason})`);
    for (const n of e.notes) if (n.level === 'bad' && n.text !== 'Issuer certificate not found.' && !/^Signed with|^RSA key is only/.test(n.text)) problems.push(`${label}: ${n.text}`);
  }
  const unused = certs.filter((c) => !used.has(c)).map((c) => c.index);
  if (unused.length) problems.push(`${unused.length} certificate(s) are not part of the leaf's chain`);
  return { chain, unused, problems, valid: problems.length === 0 };
}
