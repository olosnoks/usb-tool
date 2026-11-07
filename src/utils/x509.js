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
  return { tag, len, headerLen, contentStart, contentEnd: contentStart + len, next: contentStart + len };
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

function parseSAN(buf, inner) {
  const names = [];
  for (const gn of readSeqChildren(buf, inner)) {
    const content = buf.subarray(gn.contentStart, gn.contentEnd);
    if (gn.tag === 0x82) names.push('DNS:' + new TextDecoder().decode(content));
    else if (gn.tag === 0x81) names.push('email:' + new TextDecoder().decode(content));
    else if (gn.tag === 0x86) names.push('URI:' + new TextDecoder().decode(content));
    else if (gn.tag === 0x87) {
      if (content.length === 4) names.push('IP:' + Array.from(content).join('.'));
      else if (content.length === 16) { const h = Array.from(content).map((x) => x.toString(16).padStart(2, '0')); const g = []; for (let i = 0; i < 16; i += 2) g.push(h[i] + h[i + 1]); names.push('IP:' + g.join(':')); }
    }
  }
  return names;
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

function interpretExtensions(der, extList) {
  const result = { subjectAltNames: [], keyUsage: [], extKeyUsage: [], basicConstraints: null, ski: null, aki: null, crl: [], ocsp: [], caIssuers: [], critical: [] };
  for (const ext of extList) {
    const kids = readSeqChildren(der, ext);
    const oid = decodeOID(der, kids[0]);
    const name = OIDS[oid] || oid;
    const critical = kids.length === 3 && der[kids[1].contentStart] !== 0; // BOOLEAN TRUE
    if (critical) result.critical.push(name);
    const extnValue = kids[kids.length - 1];
    let inner;
    try { inner = readTLV(der, extnValue.contentStart); } catch { continue; }
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
      }
    } catch { /* tolerate a malformed extension */ }
  }
  return result;
}

function publicKeyDetails(der, spki) {
  const spkiKids = readSeqChildren(der, spki);
  const algSeq = spkiKids[0];
  const algKids = readSeqChildren(der, algSeq);
  const algOid = decodeOID(der, algKids[0]);
  const algName = OIDS[algOid] || algOid;
  const detail = { algorithm: algName, bits: null, curve: null, exponent: null };
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
      if (algKids[1]) detail.curve = OIDS[decodeOID(der, algKids[1])] || decodeOID(der, algKids[1]);
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
  const issuer = parseName(der, tbsKids[idx]); idx++;
  const validity = tbsKids[idx]; idx++;
  const subject = parseName(der, tbsKids[idx]); idx++;
  const spki = tbsKids[idx]; idx++;

  const validityKids = readSeqChildren(der, validity);
  const notBefore = decodeTime(der, validityKids[0]);
  const notAfter = decodeTime(der, validityKids[1]);
  const sigAlgOid = decodeOID(der, readSeqChildren(der, sigAlgSeq)[0]);
  const pk = publicKeyDetails(der, spki);

  // extensions in the [3] EXPLICIT context tag
  let exts = { subjectAltNames: [], keyUsage: [], extKeyUsage: [], basicConstraints: null, ski: null, aki: null, crl: [], ocsp: [], caIssuers: [], critical: [] };
  const extsCtx = tbsKids.find((c) => c.tag === 0xa3);
  if (extsCtx) { try { exts = interpretExtensions(der, readSeqChildren(der, readTLV(der, extsCtx.contentStart))); } catch { /* ignore */ } }

  const now = new Date();
  const msDay = 86400000;
  return {
    version, serial,
    signatureAlgorithm: OIDS[sigAlgOid] || sigAlgOid,
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
