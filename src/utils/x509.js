// Minimal, dependency-free X.509 (DER/ASN.1) certificate parser.
// Extracts the fields a certificate inspector needs: version, serial, signature
// algorithm, issuer, subject, validity window, public-key algorithm, and
// subjectAltName DNS/IP entries. Not a full ASN.1 implementation; it targets the
// standard RFC 5280 certificate shape.

const OIDS = {
  '2.5.4.3': 'CN', '2.5.4.6': 'C', '2.5.4.7': 'L', '2.5.4.8': 'ST',
  '2.5.4.10': 'O', '2.5.4.11': 'OU', '2.5.4.5': 'serialNumber',
  '1.2.840.113549.1.9.1': 'E',
  '1.2.840.113549.1.1.1': 'RSA',
  '1.2.840.113549.1.1.11': 'SHA256withRSA',
  '1.2.840.113549.1.1.5': 'SHA1withRSA',
  '1.2.840.113549.1.1.12': 'SHA384withRSA',
  '1.2.840.113549.1.1.13': 'SHA512withRSA',
  '1.2.840.10045.2.1': 'EC',
  '1.2.840.10045.4.3.2': 'ECDSAwithSHA256',
  '1.2.840.10045.4.3.3': 'ECDSAwithSHA384',
  '2.5.29.17': 'subjectAltName',
};

// Parse one TLV at offset. Returns descriptor with content bounds.
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
  while (p < parent.contentEnd) {
    const t = readTLV(buf, p);
    kids.push(t);
    p = t.next;
  }
  return kids;
}

function decodeOID(buf, tlv) {
  const b = buf.subarray(tlv.contentStart, tlv.contentEnd);
  const parts = [];
  const first = b[0];
  parts.push(Math.floor(first / 40), first % 40);
  let val = 0;
  for (let i = 1; i < b.length; i++) {
    val = val * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { parts.push(val); val = 0; }
  }
  return parts.join('.');
}

function decodeString(buf, tlv) {
  return new TextDecoder().decode(buf.subarray(tlv.contentStart, tlv.contentEnd));
}

function decodeTime(buf, tlv) {
  const s = decodeString(buf, tlv); // UTCTime (YY..) or GeneralizedTime (YYYY..)
  let y, mo, d, h, mi, se;
  if (tlv.tag === 0x17) { // UTCTime YYMMDDHHMMSSZ
    y = parseInt(s.slice(0, 2), 10);
    y += y < 50 ? 2000 : 1900;
    [mo, d, h, mi, se] = [s.slice(2, 4), s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12)].map((x) => parseInt(x, 10) || 0);
  } else { // GeneralizedTime YYYYMMDDHHMMSSZ
    y = parseInt(s.slice(0, 4), 10);
    [mo, d, h, mi, se] = [s.slice(4, 6), s.slice(6, 8), s.slice(8, 10), s.slice(10, 12), s.slice(12, 14)].map((x) => parseInt(x, 10) || 0);
  }
  return new Date(Date.UTC(y, mo - 1, d, h, mi, se));
}

function decodeInteger(buf, tlv) {
  const b = buf.subarray(tlv.contentStart, tlv.contentEnd);
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(':');
}

function parseName(buf, nameTlv) {
  // Name = SEQUENCE OF RDN (SET OF AttributeTypeAndValue{OID, value})
  const rdns = readSeqChildren(buf, nameTlv);
  const parts = [];
  for (const rdn of rdns) {
    for (const atv of readSeqChildren(buf, rdn)) {
      const kids = readSeqChildren(buf, atv);
      if (kids.length < 2) continue;
      const oid = decodeOID(buf, kids[0]);
      const label = OIDS[oid] || oid;
      parts.push(`${label}=${decodeString(buf, kids[1])}`);
    }
  }
  return parts.join(', ');
}

function parseSAN(buf, extnValueTlv) {
  // extnValue is an OCTET STRING wrapping a SEQUENCE OF GeneralName
  const inner = readTLV(buf, extnValueTlv.contentStart);
  const names = [];
  for (const gn of readSeqChildren(buf, inner)) {
    const content = buf.subarray(gn.contentStart, gn.contentEnd);
    if (gn.tag === 0x82) names.push('DNS:' + new TextDecoder().decode(content)); // dNSName
    else if (gn.tag === 0x81) names.push('email:' + new TextDecoder().decode(content)); // rfc822Name
    else if (gn.tag === 0x87) names.push('IP:' + Array.from(content).join('.')); // iPAddress
  }
  return names;
}

function findExtensions(buf, tbsChildren) {
  // extensions are in a [3] EXPLICIT context tag (0xA3) at the end of TBS
  const extsCtx = tbsChildren.find((c) => c.tag === 0xa3);
  if (!extsCtx) return [];
  const seq = readTLV(buf, extsCtx.contentStart);
  return readSeqChildren(buf, seq);
}

/** Parse a DER-encoded certificate (Uint8Array). Returns a plain info object. */
export function parseCertificate(der) {
  const cert = readTLV(der, 0);
  if (cert.tag !== 0x30) throw new Error('Not a DER SEQUENCE (invalid certificate)');
  const top = readSeqChildren(der, cert);
  const tbs = top[0];
  const tbsKids = readSeqChildren(der, tbs);

  let idx = 0;
  let version = 1;
  if (tbsKids[0] && tbsKids[0].tag === 0xa0) {
    const vInt = readTLV(der, tbsKids[0].contentStart);
    version = der[vInt.contentStart] + 1;
    idx = 1;
  }
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
  const pubKeyAlgOid = decodeOID(der, readSeqChildren(der, readSeqChildren(der, spki)[0])[0]);

  // subjectAltName
  let sans = [];
  for (const ext of findExtensions(der, tbsKids)) {
    const extKids = readSeqChildren(der, ext);
    const oid = decodeOID(der, extKids[0]);
    if (oid === '2.5.29.17') {
      const extnValue = extKids[extKids.length - 1]; // OCTET STRING (critical flag optional)
      try { sans = parseSAN(der, extnValue); } catch { /* ignore malformed SAN */ }
    }
  }

  const now = new Date();
  return {
    version,
    serial,
    signatureAlgorithm: OIDS[sigAlgOid] || sigAlgOid,
    publicKeyAlgorithm: OIDS[pubKeyAlgOid] || pubKeyAlgOid,
    issuer,
    subject,
    notBefore,
    notAfter,
    expired: now > notAfter,
    notYetValid: now < notBefore,
    subjectAltNames: sans,
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
  // string that is not PEM: treat as binary latin1
  return Uint8Array.from(String(input), (c) => c.charCodeAt(0));
}
