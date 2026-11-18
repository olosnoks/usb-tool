/**
 * Web NFC / NDEF helpers. Pure logic, no browser APIs (safe to unit-test).
 *
 * - Offline NDEF: parse a raw NDEF message (MB/ME/CF/SR/IL/TNF framing, chunked
 *   records, smart posters) and build one from composed records.
 * - URI RTD prefix table (codes 0x00-0x23) with compression on build.
 * - Text RTD status byte (UTF-16 bit, language length).
 * - Type 2 tag TLV unwrap (0x03 NDEF TLV, 0xFE terminator, 0xFF 3-byte length).
 * - Wi-Fi Simple Configuration (WSC) credential encoder/decoder for the
 *   `application/vnd.wfa.wsc` MIME record.
 * - Bridge from the Web NFC `NDEFReadingEvent` / `NDEFRecord` shapes to the same
 *   normalized record model the offline parser produces.
 */

export const TNF = { EMPTY: 0, WELL_KNOWN: 1, MIME: 2, ABSOLUTE_URI: 3, EXTERNAL: 4, UNKNOWN: 5, UNCHANGED: 6, RESERVED: 7 };
export const TNF_NAMES = ['empty', 'well-known', 'mime', 'absolute-uri', 'external', 'unknown', 'unchanged', 'reserved'];

/** NFC Forum URI RTD prefix table, index = code 0x00-0x23. */
export const URI_PREFIXES = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:',
  'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://',
  'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:', 'sip:', 'sips:', 'tftp:',
  'btspp://', 'btl2cap://', 'btgoep://', 'tcpobex://', 'irdaobex://', 'file://',
  'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

export const WSC_MIME = 'application/vnd.wfa.wsc';
export const WSC_AUTH = { open: 0x0001, wpa: 0x0002, wpa2: 0x0020, 'wpa-wpa2': 0x0022 };
export const WSC_ENC = { none: 0x0001, tkip: 0x0004, aes: 0x0008, 'tkip+aes': 0x000C };
const WSC_AUTH_NAMES = { 0x0001: 'Open', 0x0002: 'WPA-Personal', 0x0020: 'WPA2-Personal', 0x0022: 'WPA/WPA2-Personal' };
const WSC_ENC_NAMES = { 0x0001: 'None', 0x0002: 'WEP', 0x0004: 'TKIP', 0x0008: 'AES', 0x000C: 'TKIP+AES' };

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- bytes / hex ----------

export function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Accepts spaces, colons, dashes, commas and 0x prefixes. Throws on anything else. */
export function hexToBytes(text) {
  const s = String(text ?? '').replace(/0x/gi, '').replace(/[\s:,-]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error('Not a hex string (use 0-9 a-f; spaces, colons and dashes are ignored)');
  if (s.length % 2) throw new Error('Hex string has an odd number of digits');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

const ascii = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join('');
const asciiBytes = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const hex16 = (n) => `0x${n.toString(16).padStart(4, '0')}`;

export function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Normalizes ArrayBuffer / typed array / DataView / string into a Uint8Array. */
export function viewToBytes(data) {
  if (data == null) return new Uint8Array(0);
  if (typeof data === 'string') return enc.encode(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('Unsupported record data type');
}

// ---------- URI RTD ----------

/** Builds a URI RTD payload (prefix code + remainder), using the longest matching prefix. */
export function compressUri(uri) {
  const s = String(uri);
  let code = 0;
  let best = '';
  for (let i = 1; i < URI_PREFIXES.length; i++) {
    const p = URI_PREFIXES[i];
    if (p.length > best.length && s.startsWith(p)) { best = p; code = i; }
  }
  return concatBytes([Uint8Array.from([code]), enc.encode(s.slice(best.length))]);
}

/** Decodes a URI RTD payload back to the full URI string. */
export function expandUri(payload) {
  if (!payload.length) return '';
  const code = payload[0];
  const prefix = code < URI_PREFIXES.length ? URI_PREFIXES[code] : '';
  return prefix + dec.decode(payload.subarray(1));
}

// ---------- Text RTD ----------

export function encodeTextPayload(text, lang = 'en') {
  if (!/^[A-Za-z0-9-]{1,63}$/.test(lang)) throw new Error('Language code must be 1-63 ASCII letters, digits or dashes');
  const langBytes = asciiBytes(lang);
  return concatBytes([Uint8Array.from([langBytes.length]), langBytes, enc.encode(String(text))]);
}

/** Decodes UTF-16 text: honours a BOM (FE FF = BE, FF FE = LE); without one, BE per the NFC Forum text RTD. */
export function decodeUtf16(bytes) {
  let b = bytes;
  let label = 'utf-16be';
  if (b[0] === 0xff && b[1] === 0xfe) { label = 'utf-16le'; b = b.subarray(2); }
  else if (b[0] === 0xfe && b[1] === 0xff) b = b.subarray(2);
  return new TextDecoder(label).decode(b);
}

export function parseTextPayload(payload) {
  if (!payload.length) throw new Error('Text record is empty');
  const status = payload[0];
  const utf16 = (status & 0x80) !== 0;
  const langLen = status & 0x3f;
  if (1 + langLen > payload.length) throw new Error('Text record language length runs past the payload');
  return {
    encoding: utf16 ? 'utf-16' : 'utf-8',
    lang: ascii(payload.subarray(1, 1 + langLen)),
    textBytes: payload.subarray(1 + langLen),
  };
}

// ---------- NDEF message encode / decode ----------

/**
 * Encodes records ({ tnf, type, id, payload } of Uint8Arrays) into an NDEF message.
 * Sets MB on the first and ME on the last record, SR when payload <= 255 bytes,
 * IL when an id is present.
 */
export function encodeNdefMessage(records) {
  if (!records.length) throw new Error('An NDEF message needs at least one record');
  const parts = [];
  records.forEach((r, i) => {
    const tnf = r.tnf ?? TNF.UNKNOWN;
    const type = r.type ?? new Uint8Array(0);
    const id = r.id ?? new Uint8Array(0);
    const payload = r.payload ?? new Uint8Array(0);
    if (tnf < 0 || tnf > 7) throw new Error(`Invalid TNF ${tnf}`);
    if (type.length > 255) throw new Error('Record type longer than 255 bytes');
    if (id.length > 255) throw new Error('Record id longer than 255 bytes');
    const sr = payload.length <= 255;
    const il = id.length > 0;
    let flags = tnf;
    if (i === 0) flags |= 0x80;
    if (i === records.length - 1) flags |= 0x40;
    if (sr) flags |= 0x10;
    if (il) flags |= 0x08;
    const header = [flags, type.length];
    if (sr) header.push(payload.length);
    else header.push((payload.length >>> 24) & 0xff, (payload.length >>> 16) & 0xff, (payload.length >>> 8) & 0xff, payload.length & 0xff);
    if (il) header.push(id.length);
    parts.push(Uint8Array.from(header), type, id, payload);
  });
  return concatBytes(parts);
}

/** Converts a raw record (TNF/type/payload bytes) into the normalized model. */
function normalizeRawRecord({ tnf, type, id, payload }, depth) {
  const typeStr = ascii(type);
  const base = {
    tnf,
    tnfName: TNF_NAMES[tnf],
    typeHex: bytesToHex(type),
    id: bytesToHex(id),
    mediaType: '',
    encoding: '',
    lang: '',
    payload,
  };
  if (tnf === TNF.WELL_KNOWN) {
    if (typeStr === 'T') {
      const t = parseTextPayload(payload);
      return { ...base, recordType: 'text', encoding: t.encoding, lang: t.lang, payload: t.textBytes };
    }
    if (typeStr === 'U') return { ...base, recordType: 'url', payload: enc.encode(expandUri(payload)) };
    if (typeStr === 'Sp') {
      if (depth > 4) throw new Error('Smart poster nesting is too deep');
      return { ...base, recordType: 'smart-poster', payload: new Uint8Array(0), nested: decodeNdefRecords(payload, depth + 1).records };
    }
    return { ...base, recordType: `well-known:${typeStr}` };
  }
  if (tnf === TNF.MIME) return { ...base, recordType: 'mime', mediaType: typeStr };
  if (tnf === TNF.ABSOLUTE_URI) return { ...base, recordType: 'absolute-url', uri: typeStr };
  if (tnf === TNF.EXTERNAL) return { ...base, recordType: typeStr };
  if (tnf === TNF.EMPTY) return { ...base, recordType: 'empty' };
  return { ...base, recordType: 'unknown' };
}

/**
 * Parses NDEF bytes into normalized records. Handles MB/ME, CF chunking (TNF 6
 * continuation), SR/IL flags and nested smart posters. Returns
 * `{ records, trailing, warnings }`; throws on truncated or reserved-TNF data.
 */
export function decodeNdefRecords(bytes, depth = 0) {
  const data = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  const out = [];
  const warnings = [];
  let pos = 0;
  let chunk = null;
  let sawEnd = false;
  const take = (n) => {
    if (pos + n > data.length) throw new Error(`Truncated NDEF data at byte ${pos} (needs ${n} more)`);
    const s = data.subarray(pos, pos + n);
    pos += n;
    return s;
  };
  if (!data.length) throw new Error('No NDEF bytes to parse');
  while (pos < data.length) {
    const recStart = pos;
    const flags = take(1)[0];
    const tnf = flags & 0x07;
    const typeLen = take(1)[0];
    let payloadLen;
    if (flags & 0x10) payloadLen = take(1)[0];
    else payloadLen = new DataView(take(4).slice().buffer).getUint32(0);
    const idLen = flags & 0x08 ? take(1)[0] : 0;
    const type = take(typeLen).slice();
    const id = take(idLen).slice();
    const payload = take(payloadLen).slice();
    const cf = (flags & 0x20) !== 0;
    const me = (flags & 0x40) !== 0;
    if (!(flags & 0x80) && out.length === 0 && !chunk) warnings.push(`record at byte ${recStart} lacks the MB flag`);
    if (tnf === TNF.RESERVED) throw new Error(`Reserved TNF 0x07 at byte ${recStart}`);
    let done = null;
    if (chunk) {
      if (tnf !== TNF.UNCHANGED || typeLen !== 0) throw new Error(`Chunk continuation at byte ${recStart} must be TNF 0x06 with no type`);
      chunk.parts.push(payload);
      if (!cf) {
        done = { tnf: chunk.tnf, type: chunk.type, id: chunk.id, payload: concatBytes(chunk.parts) };
        chunk = null;
      }
    } else if (cf) {
      chunk = { tnf, type, id, parts: [payload] };
    } else {
      done = { tnf, type, id, payload };
    }
    if (done) {
      out.push(normalizeRawRecord(done, depth));
      if (me) { sawEnd = true; break; }
    }
  }
  if (chunk) throw new Error('Message ended inside a chunked record');
  if (!sawEnd) warnings.push('no record carries the ME flag; the message may be truncated');
  return { records: out, trailing: data.length - pos, warnings };
}

// ---------- Type 2 tag TLV ----------

/**
 * Finds the NDEF message TLV (0x03) in a Type 2 tag memory image that starts at
 * the TLV area (user memory, page 4 onward). Skips NULL (0x00), lock (0x01) and
 * memory control (0x02) TLVs. Supports the 0xFF 3-byte length form.
 */
export function unwrapType2Tlv(bytes) {
  let pos = 0;
  while (pos < bytes.length) {
    const t = bytes[pos++];
    if (t === 0x00) continue;
    if (t === 0xfe) break;
    if (pos >= bytes.length) throw new Error('Truncated TLV header');
    let len = bytes[pos++];
    if (len === 0xff) {
      if (pos + 2 > bytes.length) throw new Error('Truncated 3-byte TLV length');
      len = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
    }
    if (pos + len > bytes.length) throw new Error(`TLV 0x${t.toString(16).padStart(2, '0')} length ${len} runs past the data`);
    if (t === 0x03) return bytes.slice(pos, pos + len);
    pos += len;
  }
  throw new Error('No NDEF message TLV (0x03) found in the data');
}

/** Wraps an NDEF message in a Type 2 TLV (0x03 + length + message + 0xFE). */
export function wrapType2Tlv(ndef) {
  const len = ndef.length;
  const header = len < 0xff ? [0x03, len] : [0x03, 0xff, (len >> 8) & 0xff, len & 0xff];
  return concatBytes([Uint8Array.from(header), ndef, Uint8Array.from([0xfe])]);
}

/**
 * Accepts pasted hex that is either a raw NDEF message (first byte has MB set) or a
 * Type 2 TLV stream. Returns `{ source, ndef }`.
 */
export function readNdefInput(text) {
  const bytes = hexToBytes(text);
  if (!bytes.length) throw new Error('Paste some hex first');
  if (bytes[0] & 0x80) return { source: 'raw', ndef: bytes };
  return { source: 'type2-tlv', ndef: unwrapType2Tlv(bytes) };
}

// ---------- WSC (Wi-Fi Simple Configuration) ----------

function wscTlv(type, value) {
  const v = value instanceof Uint8Array ? value : Uint8Array.from(value);
  if (v.length > 0xffff) throw new Error('WSC attribute too long');
  const out = new Uint8Array(4 + v.length);
  out[0] = (type >> 8) & 0xff;
  out[1] = type & 0xff;
  out[2] = (v.length >> 8) & 0xff;
  out[3] = v.length & 0xff;
  out.set(v, 4);
  return out;
}

const u16 = (n) => Uint8Array.from([(n >> 8) & 0xff, n & 0xff]);

/**
 * Builds the WSC credential (attribute 0x100E wrapping network index, SSID, auth
 * type, encryption type and network key) used as the payload of an
 * `application/vnd.wfa.wsc` record.
 */
export function buildWscCredential({ ssid, key = '', auth = 'wpa2', encryption = 'aes', networkIndex = 1 } = {}) {
  const ssidBytes = enc.encode(String(ssid ?? ''));
  if (ssidBytes.length < 1 || ssidBytes.length > 32) throw new Error('SSID must be 1-32 bytes (UTF-8)');
  if (!(auth in WSC_AUTH)) throw new Error(`Unknown auth type "${auth}"`);
  if (!(encryption in WSC_ENC)) throw new Error(`Unknown encryption type "${encryption}"`);
  const keyStr = String(key);
  if (auth === 'open') {
    if (encryption !== 'none') throw new Error('An open network must use encryption "none"');
    if (keyStr) throw new Error('An open network must not have a key');
  } else {
    if (encryption === 'none') throw new Error('A WPA network needs an encryption type (TKIP, AES or TKIP+AES)');
    if (!/^[\x20-\x7e]{8,63}$/.test(keyStr)) throw new Error('WPA passphrase must be 8-63 printable ASCII characters');
  }
  if (!Number.isInteger(networkIndex) || networkIndex < 1 || networkIndex > 255) throw new Error('Network index must be 1-255');
  const inner = concatBytes([
    wscTlv(0x1026, [networkIndex]),
    wscTlv(0x1045, ssidBytes),
    wscTlv(0x1003, u16(WSC_AUTH[auth])),
    wscTlv(0x100f, u16(WSC_ENC[encryption])),
    wscTlv(0x1027, asciiBytes(keyStr)),
  ]);
  return wscTlv(0x100e, inner);
}

function readWscTlvs(bytes) {
  const out = [];
  let pos = 0;
  while (pos + 4 <= bytes.length) {
    const type = (bytes[pos] << 8) | bytes[pos + 1];
    const len = (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
    if (pos + len > bytes.length) throw new Error(`WSC attribute ${hex16(type)} overruns the payload`);
    out.push({ type, value: bytes.subarray(pos, pos + len) });
    pos += len;
  }
  if (pos !== bytes.length) throw new Error('Trailing bytes after the last WSC attribute');
  return out;
}

/** Decodes a WSC credential (0x100E wrapper, or its bare attribute list). */
export function parseWscCredential(bytes) {
  let attrs = readWscTlvs(bytes);
  if (attrs.length === 1 && attrs[0].type === 0x100e) attrs = readWscTlvs(attrs[0].value);
  const get = (t) => attrs.find((a) => a.type === t)?.value;
  const num = (v) => (v && v.length === 2 ? (v[0] << 8) | v[1] : undefined);
  const auth = num(get(0x1003));
  const encv = num(get(0x100f));
  const idx = get(0x1026);
  const ssid = get(0x1045);
  const key = get(0x1027);
  return {
    networkIndex: idx?.length ? idx[0] : undefined,
    ssid: ssid ? dec.decode(ssid) : '',
    networkKey: key ? dec.decode(key) : '',
    authType: auth,
    authName: auth === undefined ? '' : WSC_AUTH_NAMES[auth] ?? `unknown (${hex16(auth)})`,
    encryptionType: encv,
    encryptionName: encv === undefined ? '' : WSC_ENC_NAMES[encv] ?? `unknown (${hex16(encv)})`,
  };
}

// ---------- vCard / Android application record ----------

export function buildVCard({ name, org = '', title = '', phone = '', email = '', url = '' } = {}) {
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const n = String(name ?? '').trim();
  if (!n) throw new Error('vCard needs a name');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(n)};;;;`, `FN:${esc(n)}`];
  if (org) lines.push(`ORG:${esc(org)}`);
  if (title) lines.push(`TITLE:${esc(title)}`);
  if (phone) lines.push(`TEL:${esc(phone)}`);
  if (email) lines.push(`EMAIL:${esc(email)}`);
  if (url) lines.push(`URL:${esc(url)}`);
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

export const ANDROID_AAR_TYPE = 'android.com:pkg';

// ---------- composer specs -> records ----------

export const COMPOSER_KINDS = [
  { id: 'text', label: 'Text' },
  { id: 'url', label: 'URL' },
  { id: 'wifi', label: 'Wi-Fi (WSC)' },
  { id: 'vcard', label: 'vCard' },
  { id: 'json', label: 'MIME JSON' },
  { id: 'android', label: 'Android app record' },
  { id: 'raw-mime', label: 'Raw MIME (hex)' },
  { id: 'raw-external', label: 'Raw external (hex)' },
];

/** Validates an absolute URL and returns it exactly as typed (no normalization). */
function checkAbsoluteUrl(uri) {
  const s = String(uri ?? '').trim();
  try { new URL(s); } catch { throw new Error('URL must be absolute, e.g. https://example.com'); }
  return s;
}

const mimeRecord = (mediaType, payload) => {
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mediaType)) throw new Error(`Invalid MIME type "${mediaType}"`);
  return { tnf: TNF.MIME, type: asciiBytes(mediaType), payload };
};
const externalRecord = (type, payload) => {
  if (!/^[a-z0-9.-]+:[A-Za-z0-9._-]+$/.test(type)) throw new Error(`Invalid external type "${type}" (expected domain:name)`);
  return { tnf: TNF.EXTERNAL, type: asciiBytes(type), payload };
};

/** Turns one composer entry into an NDEF record `{ tnf, type, payload }` (Uint8Arrays). */
export function specToNdefRecord(spec) {
  switch (spec.kind) {
    case 'text':
      if (!String(spec.text ?? '').length) throw new Error('Text record is empty');
      return { tnf: TNF.WELL_KNOWN, type: Uint8Array.from([0x54]), payload: encodeTextPayload(spec.text, spec.lang || 'en') };
    case 'url':
      return { tnf: TNF.WELL_KNOWN, type: Uint8Array.from([0x55]), payload: compressUri(checkAbsoluteUrl(spec.uri)) };
    case 'wifi':
      return mimeRecord(WSC_MIME, buildWscCredential(spec));
    case 'vcard':
      return mimeRecord('text/vcard', enc.encode(buildVCard(spec.fields || spec)));
    case 'json': {
      try { JSON.parse(String(spec.text ?? '')); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
      return mimeRecord('application/json', enc.encode(String(spec.text)));
    }
    case 'android': {
      const pkg = String(spec.pkg ?? '').trim();
      if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/.test(pkg)) throw new Error('Package name must look like com.example.app');
      return externalRecord(ANDROID_AAR_TYPE, enc.encode(pkg));
    }
    case 'raw-mime':
      return mimeRecord(String(spec.mediaType ?? ''), hexToBytes(spec.hex));
    case 'raw-external':
      return externalRecord(String(spec.type ?? ''), hexToBytes(spec.hex));
    default:
      throw new Error(`Unknown record kind "${spec.kind}"`);
  }
}

export function buildNdefFromSpecs(specs) {
  return encodeNdefMessage(specs.map(specToNdefRecord));
}

/** Maps a composer entry to a Web NFC `NDEFMessage` record for `NDEFReader.write()`. */
export function specToWebNfcRecord(spec) {
  switch (spec.kind) {
    case 'text': return { recordType: 'text', lang: spec.lang || 'en', encoding: 'utf-8', data: String(spec.text) };
    case 'url': return { recordType: 'url', data: checkAbsoluteUrl(spec.uri) };
    default: {
      const r = specToNdefRecord(spec);
      if (r.tnf === TNF.MIME) return { recordType: 'mime', mediaType: ascii(r.type), data: toArrayBuffer(r.payload) };
      if (r.tnf === TNF.EXTERNAL) return { recordType: ascii(r.type), data: toArrayBuffer(r.payload) };
      throw new Error('Unsupported record for Web NFC');
    }
  }
}

export function buildWebNfcMessage(specs) {
  return { records: specs.map(specToWebNfcRecord) };
}

// ---------- Web NFC bridge ----------

/** Converts a Web NFC `NDEFRecord` (recordType, mediaType, data as DataView, ...) to the normalized model. */
export function fromWebNfcRecord(rec) {
  const bytes = viewToBytes(rec.data);
  const base = {
    tnf: null,
    tnfName: '',
    typeHex: '',
    id: rec.id ? String(rec.id) : '',
    mediaType: rec.mediaType || '',
    encoding: rec.encoding || '',
    lang: rec.lang || '',
    payload: bytes,
  };
  const rt = rec.recordType;
  if (rt === 'smart-poster') {
    const nested = typeof rec.toRecords === 'function' ? rec.toRecords() : [];
    return { ...base, recordType: rt, payload: new Uint8Array(0), nested: nested.map(fromWebNfcRecord) };
  }
  if (rt === 'url') return { ...base, recordType: rt };
  if (rt === 'absolute-url') return { ...base, recordType: rt, payload: new Uint8Array(0), uri: dec.decode(bytes) };
  return { ...base, recordType: rt || 'unknown' };
}

export function fromWebNfcEvent(event) {
  const records = event?.message?.records ?? [];
  return { serialNumber: event?.serialNumber ?? '', records: records.map(fromWebNfcRecord) };
}

// ---------- presentation ----------

/** Decodes a normalized record for display and JSON export. Pure. */
export function describeRecord(rec) {
  const p = rec.payload ?? new Uint8Array(0);
  const base = {
    recordType: rec.recordType,
    mediaType: rec.mediaType || '',
    id: rec.id || '',
    encoding: rec.encoding || '',
    lang: rec.lang || '',
    size: p.length,
    hex: bytesToHex(p),
  };
  const t = rec.recordType;
  if (t === 'text') {
    return { ...base, kind: 'text', text: rec.encoding === 'utf-16' ? decodeUtf16(p) : dec.decode(p) };
  }
  if (t === 'url') return { ...base, kind: 'uri', uri: dec.decode(p) };
  if (t === 'absolute-url') return { ...base, kind: 'uri', uri: rec.uri || '' };
  if (t === 'smart-poster') return { ...base, kind: 'smart-poster', records: (rec.nested || []).map(describeRecord) };
  if (t === 'mime') return { ...base, ...describeMime(rec.mediaType, p) };
  if (t === 'empty') return { ...base, kind: 'empty' };
  if (t === 'unknown' || t.startsWith('well-known:')) return { ...base, kind: 'unknown' };
  if (t === ANDROID_AAR_TYPE) return { ...base, kind: 'android-app', externalType: t, pkg: dec.decode(p) };
  return { ...base, kind: 'external', externalType: t };
}

function describeMime(mediaType, p) {
  const mt = String(mediaType || '').toLowerCase();
  if (mt === 'application/json' || mt.endsWith('+json')) {
    const text = dec.decode(p);
    try { return { kind: 'json', text: JSON.stringify(JSON.parse(text), null, 2) }; } catch (e) { return { kind: 'text', text, note: `Invalid JSON: ${e.message}` }; }
  }
  if (mt.startsWith('text/')) return { kind: 'text', text: dec.decode(p) };
  if (mt === WSC_MIME) {
    try { return { kind: 'wsc', wsc: parseWscCredential(p) }; } catch (e) { return { kind: 'binary', note: `WSC decode failed: ${e.message}` }; }
  }
  return { kind: 'binary' };
}

// ---------- capacity and clone helpers ----------

/**
 * Common Type 2 tags: total user memory and the largest NDEF message NXP specifies for each
 * (the NDEF TLV header, terminator and any lock/memory-control TLVs already subtracted).
 */
export const TAG_TYPES = [
  { id: 'ultralight', name: 'MIFARE Ultralight', userBytes: 48, maxNdef: 46 },
  { id: 'ntag213', name: 'NTAG213', userBytes: 144, maxNdef: 137 },
  { id: 'ntag215', name: 'NTAG215', userBytes: 504, maxNdef: 492 },
  { id: 'ntag216', name: 'NTAG216', userBytes: 888, maxNdef: 868 },
];

/** Bytes a Type 2 tag spends on the NDEF TLV around a message of this size (header + 0xFE). */
export function tlvOverhead(ndefLength) {
  return (ndefLength < 0xff ? 2 : 4) + 1;
}

/** For an NDEF message size, says which common tags it fits and how full each would be. */
export function tagFit(ndefLength) {
  const size = Math.max(0, ndefLength | 0);
  return TAG_TYPES.map((t) => ({
    ...t,
    fits: size <= t.maxNdef,
    percent: Math.min(100, Math.round((size / t.maxNdef) * 100)),
    free: t.maxNdef - size,
  }));
}

/**
 * Converts decoded records (from `describeRecord`) into composer entries `{ kind, f }` so a
 * scanned tag can be copied onto another tag. Records the composer cannot express are listed in
 * `skipped` instead of being guessed.
 */
export function recordsToComposerEntries(records) {
  const entries = [];
  const skipped = [];
  (records || []).forEach((r, i) => {
    const label = `#${i + 1} ${r.recordType}`;
    if (r.kind === 'text' && r.recordType === 'text') {
      entries.push({ kind: 'text', f: { text: r.text || '', lang: r.lang || 'en' } });
    } else if (r.recordType === 'url' || r.recordType === 'absolute-url') {
      entries.push({ kind: 'url', f: { uri: r.uri || '' } });
    } else if (r.kind === 'android-app') {
      entries.push({ kind: 'android', f: { pkg: r.pkg || '' } });
    } else if (r.recordType === 'mime' && r.mediaType) {
      entries.push({ kind: 'raw-mime', f: { mediaType: r.mediaType, hex: r.hex || '' } });
    } else if (r.kind === 'external' && r.externalType) {
      entries.push({ kind: 'raw-external', f: { type: r.externalType, hex: r.hex || '' } });
    } else {
      skipped.push(label);
    }
  });
  return { entries, skipped };
}

/** Web NFC message that clears a tag's NDEF content (a single empty record). */
export function buildEraseMessage() {
  return { records: [{ recordType: 'empty' }] };
}
