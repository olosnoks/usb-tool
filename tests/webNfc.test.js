import { describe, it, expect } from 'vitest';
import {
  TNF, URI_PREFIXES, encodeNdefMessage, decodeNdefRecords, compressUri, expandUri,
  encodeTextPayload, parseTextPayload, decodeUtf16, unwrapType2Tlv, wrapType2Tlv, readNdefInput,
  buildWscCredential, parseWscCredential, buildVCard, buildNdefFromSpecs, specToNdefRecord,
  buildWebNfcMessage, fromWebNfcEvent, describeRecord, hexToBytes, bytesToHex, WSC_MIME,
} from '../src/utils/webNfc.js';

const enc = (s) => new TextEncoder().encode(s);

describe('hex helpers', () => {
  it('accepts spaces, colons and 0x prefixes and rejects junk', () => {
    expect(bytesToHex(hexToBytes('D1 01:0c-0x55'))).toBe('d1010c55');
    expect(() => hexToBytes('abc')).toThrow(/odd/);
    expect(() => hexToBytes('zz')).toThrow(/Not a hex/);
  });
});

describe('URI RTD prefix table', () => {
  it('has codes 0x00 to 0x23 at the spec positions', () => {
    expect(URI_PREFIXES).toHaveLength(0x24);
    expect(URI_PREFIXES[0x00]).toBe('');
    expect(URI_PREFIXES[0x02]).toBe('https://www.');
    expect(URI_PREFIXES[0x04]).toBe('https://');
    expect(URI_PREFIXES[0x05]).toBe('tel:');
    expect(URI_PREFIXES[0x06]).toBe('mailto:');
    expect(URI_PREFIXES[0x1d]).toBe('file://');
    expect(URI_PREFIXES[0x23]).toBe('urn:nfc:');
  });

  it('compresses with the longest matching prefix', () => {
    expect(bytesToHex(compressUri('https://www.example.com'))).toBe('02' + bytesToHex(enc('example.com')));
    expect(bytesToHex(compressUri('https://example.com'))).toBe('04' + bytesToHex(enc('example.com')));
    expect(bytesToHex(compressUri('mailto:a@b.c'))).toBe('06' + bytesToHex(enc('a@b.c')));
    expect(bytesToHex(compressUri('gopher://x'))).toBe('00' + bytesToHex(enc('gopher://x')));
  });

  it('round-trips every prefix', () => {
    for (let i = 0; i < URI_PREFIXES.length; i++) {
      const uri = `${URI_PREFIXES[i]}host/path?q=1`;
      expect(expandUri(compressUri(uri))).toBe(uri);
    }
  });
});

describe('NDEF message encode/decode', () => {
  it('matches the known text record vector "Hello" en', () => {
    const msg = encodeNdefMessage([{ tnf: TNF.WELL_KNOWN, type: Uint8Array.from([0x54]), payload: encodeTextPayload('Hello', 'en') }]);
    expect(bytesToHex(msg)).toBe('d101085402656e48656c6c6f');
  });

  it('matches the known URI record vector', () => {
    const msg = buildNdefFromSpecs([{ kind: 'url', uri: 'https://www.example.com' }]);
    // 0xD1 = MB|ME|SR|TNF 1; type length 1; payload length 12; type 'U'; prefix 0x02; "example.com"
    expect(bytesToHex(msg)).toBe('d1010c5502' + bytesToHex(enc('example.com')));
  });

  it('round-trips a multi-record message with id, long payload and MIME', () => {
    const big = new Uint8Array(600).map((_, i) => i & 0xff);
    const bytes = encodeNdefMessage([
      { tnf: TNF.WELL_KNOWN, type: Uint8Array.from([0x54]), id: enc('t1'), payload: encodeTextPayload('ünïcode ok', 'de') },
      { tnf: TNF.MIME, type: enc('application/octet-stream'), payload: big },
      { tnf: TNF.EXTERNAL, type: enc('android.com:pkg'), payload: enc('com.example.app') },
    ]);
    const { records, trailing, warnings } = decodeNdefRecords(bytes);
    expect(trailing).toBe(0);
    expect(warnings).toEqual([]);
    expect(records.map((r) => r.recordType)).toEqual(['text', 'mime', 'android.com:pkg']);
    expect(records[0].id).toBe(bytesToHex(enc('t1')));
    expect(new TextDecoder().decode(records[0].payload)).toBe('ünïcode ok');
    expect(records[0].lang).toBe('de');
    expect(records[1].mediaType).toBe('application/octet-stream');
    expect(bytesToHex(records[1].payload)).toBe(bytesToHex(big));
    expect(new TextDecoder().decode(records[2].payload)).toBe('com.example.app');
  });

  it('re-encodes raw framing to identical bytes (TNF, type, id, payload)', () => {
    const raw = [
      { tnf: TNF.MIME, type: enc('application/x-test'), id: enc('abc'), payload: Uint8Array.from([1, 2, 3]) },
      { tnf: TNF.EXTERNAL, type: enc('example.com:thing'), payload: new Uint8Array(300).fill(7) },
      { tnf: TNF.UNKNOWN, payload: new Uint8Array(0) },
    ];
    const bytes = encodeNdefMessage(raw);
    const parsed = decodeNdefRecords(bytes).records;
    expect(parsed.map((r) => r.tnf)).toEqual([TNF.MIME, TNF.EXTERNAL, TNF.UNKNOWN]);
    expect(parsed[0].id).toBe(bytesToHex(enc('abc')));
    const again = encodeNdefMessage(parsed.map((r) => ({
      tnf: r.tnf,
      type: hexToBytes(r.typeHex),
      id: hexToBytes(r.id),
      payload: r.payload,
    })));
    expect(bytesToHex(again)).toBe(bytesToHex(bytes));
  });

  it('decodes a smart poster into nested records', () => {
    const inner = encodeNdefMessage([
      { tnf: TNF.WELL_KNOWN, type: Uint8Array.from([0x55]), payload: compressUri('https://example.com/a') },
      { tnf: TNF.WELL_KNOWN, type: Uint8Array.from([0x54]), payload: encodeTextPayload('Title', 'en') },
    ]);
    const sp = encodeNdefMessage([{ tnf: TNF.WELL_KNOWN, type: enc('Sp'), payload: inner }]);
    const [rec] = decodeNdefRecords(sp).records;
    expect(rec.recordType).toBe('smart-poster');
    expect(rec.nested.map((r) => r.recordType)).toEqual(['url', 'text']);
    expect(new TextDecoder().decode(rec.nested[0].payload)).toBe('https://example.com/a');
    expect(describeRecord(rec).records[1].text).toBe('Title');
  });

  it('reassembles chunked (CF) records', () => {
    // First chunk: MB|CF|SR|TNF 1, type 'T', payload = status 0x00 (utf-8, no lang) + "hello".
    // Last chunk: ME|SR|TNF 6 (unchanged), no type, payload = " world" (raw continuation bytes).
    const first = Uint8Array.from([0x80 | 0x20 | 0x10 | 0x01, 0x01, 0x06, 0x54, 0x00, ...enc('hello')]);
    const last = Uint8Array.from([0x40 | 0x10 | 0x06, 0x00, 0x06, ...enc(' world')]);
    const { records } = decodeNdefRecords(Uint8Array.from([...first, ...last]));
    expect(records).toHaveLength(1);
    expect(records[0].recordType).toBe('text');
    expect(new TextDecoder().decode(records[0].payload)).toBe('hello world');
  });

  it('throws on truncated data and reports a missing ME flag as a warning', () => {
    const full = buildNdefFromSpecs([{ kind: 'text', text: 'abcdef' }]);
    expect(() => decodeNdefRecords(full.subarray(0, full.length - 2))).toThrow(/Truncated/);
    const noME = Uint8Array.from(full);
    noME[0] &= ~0x40;
    expect(decodeNdefRecords(noME).warnings.join(' ')).toMatch(/ME/);
  });

  it('rejects reserved TNF 7', () => {
    // 0xD7 = MB|ME|SR|TNF 7, then type length 0 and payload length 0
    expect(() => decodeNdefRecords(Uint8Array.from([0xd7, 0x00, 0x00]))).toThrow(/Reserved TNF/);
  });
});

describe('text RTD', () => {
  it('sets the language length in the status byte and decodes UTF-16 BOM text', () => {
    const p = encodeTextPayload('x', 'fr-CA');
    expect(p[0]).toBe(5);
    expect(parseTextPayload(p).lang).toBe('fr-CA');
    const utf16 = Uint8Array.from([0x80 | 2, 0x65, 0x6e, 0xfe, 0xff, 0x00, 0x41]);
    const parsed = parseTextPayload(utf16);
    expect(parsed.encoding).toBe('utf-16');
    expect(decodeUtf16(parsed.textBytes)).toBe('A');
    // Little-endian BOM variant
    expect(decodeUtf16(Uint8Array.from([0xff, 0xfe, 0x41, 0x00]))).toBe('A');
    // No BOM: big-endian per the text RTD
    expect(decodeUtf16(Uint8Array.from([0x00, 0x42]))).toBe('B');
  });
});

describe('Type 2 TLV unwrap', () => {
  const ndef = buildNdefFromSpecs([{ kind: 'url', uri: 'https://example.com' }]);

  it('unwraps a 0x03 TLV with a 1-byte length and the 0xFE terminator', () => {
    const tlv = wrapType2Tlv(ndef);
    expect(tlv[0]).toBe(0x03);
    expect(tlv[1]).toBe(ndef.length);
    expect(tlv[tlv.length - 1]).toBe(0xfe);
    expect(bytesToHex(unwrapType2Tlv(tlv))).toBe(bytesToHex(ndef));
  });

  it('skips NULL, lock and memory control TLVs first', () => {
    // NULL, NULL, lock control (len 3), memory control (len 3), then the NDEF TLV
    const data = Uint8Array.from([0x00, 0x00, 0x01, 0x03, 0xa0, 0x10, 0x02, 0x02, 0x03, 0x01, 0x02, 0x03, ...wrapType2Tlv(ndef)]);
    expect(bytesToHex(unwrapType2Tlv(data))).toBe(bytesToHex(ndef));
  });

  it('handles the 0xFF three-byte length form for large messages', () => {
    const big = buildNdefFromSpecs([{ kind: 'raw-mime', mediaType: 'application/octet-stream', hex: 'ab'.repeat(400) }]);
    const tlv = wrapType2Tlv(big);
    expect(tlv[1]).toBe(0xff);
    expect(bytesToHex(unwrapType2Tlv(tlv))).toBe(bytesToHex(big));
  });

  it('readNdefInput auto-detects raw NDEF versus TLV', () => {
    expect(readNdefInput(bytesToHex(ndef)).source).toBe('raw');
    expect(readNdefInput(bytesToHex(wrapType2Tlv(ndef))).source).toBe('type2-tlv');
    expect(() => readNdefInput('00')).toThrow(/No NDEF/);
  });
});

describe('WSC credential (application/vnd.wfa.wsc)', () => {
  it('encodes the 0x100E wrapper with the expected attributes', () => {
    const cred = buildWscCredential({ ssid: 'MyNet', key: 'password123', auth: 'wpa2', encryption: 'aes', networkIndex: 1 });
    const hex = bytesToHex(cred);
    expect(hex.startsWith('100e0029')).toBe(true);
    expect(hex).toContain('1026000101'); // network index attribute 0x1026, len 1, value 01
    expect(hex).toContain('10450005' + bytesToHex(enc('MyNet')));
    expect(hex).toContain('10030002' + '0020');
    expect(hex).toContain('100f0002' + '0008');
    expect(hex).toContain('1027000b' + bytesToHex(enc('password123')));
    expect(cred.length).toBe(4 + 0x29);
  });

  it('round-trips through the decoder', () => {
    const cred = buildWscCredential({ ssid: 'Café WiFi', key: 'correct horse', auth: 'wpa-wpa2', encryption: 'tkip+aes' });
    expect(parseWscCredential(cred)).toEqual({
      networkIndex: 1,
      ssid: 'Café WiFi',
      networkKey: 'correct horse',
      authType: 0x0022,
      authName: 'WPA/WPA2-Personal',
      encryptionType: 0x000c,
      encryptionName: 'TKIP+AES',
    });
  });

  it('allows an open network with no key and encryption none', () => {
    const cred = buildWscCredential({ ssid: 'Guest', auth: 'open', encryption: 'none' });
    const parsed = parseWscCredential(cred);
    expect(parsed.authName).toBe('Open');
    expect(parsed.networkKey).toBe('');
  });

  it('rejects inconsistent or invalid input', () => {
    expect(() => buildWscCredential({ ssid: '', key: 'password1' })).toThrow(/SSID/);
    expect(() => buildWscCredential({ ssid: 'x'.repeat(33), key: 'password1' })).toThrow(/SSID/);
    expect(() => buildWscCredential({ ssid: 'a', key: 'short' })).toThrow(/8-63/);
    expect(() => buildWscCredential({ ssid: 'a', key: 'password1', auth: 'open', encryption: 'none' })).toThrow(/must not have a key/);
    expect(() => buildWscCredential({ ssid: 'a', key: 'password1', auth: 'wpa2', encryption: 'none' })).toThrow(/encryption type/);
  });

  it('is embedded as a MIME record with the WFA type', () => {
    const rec = specToNdefRecord({ kind: 'wifi', ssid: 'Net', key: 'password1', auth: 'wpa2', encryption: 'aes' });
    expect(rec.tnf).toBe(TNF.MIME);
    expect(new TextDecoder().decode(rec.type)).toBe(WSC_MIME);
    const [decoded] = decodeNdefRecords(encodeNdefMessage([rec])).records;
    expect(describeRecord(decoded).wsc.ssid).toBe('Net');
  });
});

describe('vCard and Android application record', () => {
  it('escapes vCard special characters and needs a name', () => {
    const v = buildVCard({ name: 'Doe; Jane, Jr', email: 'j@example.com' });
    expect(v).toContain('FN:Doe\\; Jane\\, Jr');
    expect(v.startsWith('BEGIN:VCARD\r\nVERSION:3.0')).toBe(true);
    expect(v.endsWith('END:VCARD')).toBe(true);
    expect(() => buildVCard({ name: '  ' })).toThrow(/name/);
  });

  it('builds an android.com:pkg external record', () => {
    const rec = specToNdefRecord({ kind: 'android', pkg: 'com.example.app' });
    expect(rec.tnf).toBe(TNF.EXTERNAL);
    expect(new TextDecoder().decode(rec.type)).toBe('android.com:pkg');
    const [decoded] = decodeNdefRecords(encodeNdefMessage([rec])).records;
    expect(describeRecord(decoded).kind).toBe('android-app');
    expect(describeRecord(decoded).pkg).toBe('com.example.app');
    expect(() => specToNdefRecord({ kind: 'android', pkg: 'nodots' })).toThrow(/com.example/);
  });
});

describe('composer and Web NFC bridge', () => {
  it('rejects invalid JSON and relative URLs', () => {
    expect(() => specToNdefRecord({ kind: 'json', text: '{nope' })).toThrow(/JSON/);
    expect(() => specToNdefRecord({ kind: 'url', uri: 'example.com' })).toThrow(/absolute/);
  });

  it('maps composer entries to Web NFC record objects', () => {
    const msg = buildWebNfcMessage([
      { kind: 'text', text: 'hi', lang: 'en' },
      { kind: 'url', uri: 'https://example.com' },
      { kind: 'android', pkg: 'com.example.app' },
    ]);
    expect(msg.records[0]).toEqual({ recordType: 'text', lang: 'en', encoding: 'utf-8', data: 'hi' });
    expect(msg.records[1]).toEqual({ recordType: 'url', data: 'https://example.com' });
    expect(msg.records[2].recordType).toBe('android.com:pkg');
  });

  it('normalizes a Web NFC reading event and decodes JSON mime', () => {
    const json = enc('{"b":2,"a":[1]}');
    const event = {
      serialNumber: '04:AA:BB:CC',
      message: {
        records: [
          { recordType: 'text', mediaType: 'text/plain', encoding: 'utf-8', lang: 'en', id: 'x', data: new DataView(enc('Hey').buffer) },
          { recordType: 'mime', mediaType: 'application/json', data: new DataView(json.buffer) },
          { recordType: 'smart-poster', toRecords: () => [{ recordType: 'url', data: new DataView(enc('https://a.example').buffer) }] },
          { recordType: 'mime', mediaType: 'image/png', data: new DataView(Uint8Array.from([0x89, 0x50]).buffer) },
        ],
      },
    };
    const ev = fromWebNfcEvent(event);
    expect(ev.serialNumber).toBe('04:AA:BB:CC');
    const d = ev.records.map(describeRecord);
    expect(d[0]).toMatchObject({ kind: 'text', text: 'Hey', lang: 'en' });
    expect(d[1].kind).toBe('json');
    expect(JSON.parse(d[1].text)).toEqual({ b: 2, a: [1] });
    expect(d[2].kind).toBe('smart-poster');
    expect(d[2].records[0]).toMatchObject({ kind: 'uri', uri: 'https://a.example' });
    expect(d[3]).toMatchObject({ kind: 'binary', hex: '8950' });
  });

  it('describes unknown records as hex without guessing', () => {
    const [rec] = decodeNdefRecords(encodeNdefMessage([{ tnf: TNF.UNKNOWN, payload: Uint8Array.from([1, 2, 3]) }])).records;
    expect(describeRecord(rec)).toMatchObject({ kind: 'unknown', hex: '010203' });
  });
});
