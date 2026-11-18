/**
 * Smart Card analysis toolkit: ATR parser (ISO 7816-3), APDU command/response
 * decoder (ISO 7816-4), trace-log parser, BER-TLV decoder with EMV/PIV tag
 * dictionaries, and an APDU builder. Pure logic, no hardware access.
 *
 * This analyses data captured elsewhere (pcsc-tools, Proxmark3 `hf 14a apdu`,
 * Flipper NFC dumps, logs). It does not talk to a reader.
 */

// ---------------------------------------------------------------- hex helpers

/**
 * Parse a hex string. Accepts "3B 8F", "3b8f", "3B:8F", "0x3B,0x8F", "3B-8F".
 * Returns a Uint8Array, or throws with a readable message.
 */
export function parseHex(text) {
  let s = String(text ?? '').trim();
  s = s.replace(/0x/gi, '').replace(/[\s:,\-]/g, '');
  if (s.length === 0) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error('Not a hex string (only 0-9 A-F and separators allowed)');
  if (s.length % 2 !== 0) throw new Error('Hex has an odd number of digits');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

export const toHex = (bytes, sep = ' ') =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(sep);

const hexByte = (b) => b.toString(16).padStart(2, '0').toUpperCase();

function asciiPreview(bytes) {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
}

function reverseBits(b) {
  let r = 0;
  for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i);
  return r;
}

// ---------------------------------------------------------------- ATR (ISO 7816-3)

// Table 7 (FI -> F). Only values that are confidently known are listed; others
// are reported as "not tabulated here" rather than guessed.
const F_TABLE = { 0x0: 372, 0x1: 372, 0x2: 558, 0x3: 744, 0x4: 1116, 0x5: 1488, 0x6: 1860, 0x9: 512, 0xa: 768 };
// Table 8 (DI -> D).
const D_TABLE = { 0x1: 1, 0x2: 2, 0x3: 4, 0x4: 8, 0x5: 16, 0x6: 32, 0x7: 64, 0x8: 12, 0x9: 20 };
export const DEFAULT_CLOCK_HZ = 3571200; // ISO default f (3.5712 MHz) used for the baud estimate

/** Baud estimate for a TA1 value (FI/DI). Returns { F, D, baud } or nulls where not tabulated. */
export function fiDiToBaud(ta1, clockHz = DEFAULT_CLOCK_HZ) {
  const fi = (ta1 >> 4) & 0x0f;
  const di = ta1 & 0x0f;
  const F = F_TABLE[fi] ?? null;
  const D = D_TABLE[di] ?? null;
  const baud = F && D ? Math.round((clockHz * D) / F) : null;
  return { FI: fi, DI: di, F, D, baud, clockHz };
}

export const PROTOCOL_NAMES = { 0: 'T=0 (asynchronous, character)', 1: 'T=1 (asynchronous, block)' };

/**
 * Known ATR / pseudo-ATR patterns. These are hints only: they match on bytes
 * that are either documented or appear in many cards, and they do not prove
 * the card type.
 */
export const KNOWN_ATR_PATTERNS = [
  {
    id: 'pcsc-pseudo-atr',
    label: 'PC/SC pseudo-ATR for a contactless (ISO 14443) tag',
    confidence: 'hint',
    test: (hex) => hex.startsWith('3B 8F 80 01 80 4F 0C A0 00 00 03 06'),
    note: 'The reader synthesised this ATR from the ISO 14443 tag. It is not a contact smart card ATR.',
  },
  {
    id: 'yubikey-text',
    label: 'Historical bytes spell "YubiKey"',
    confidence: 'hint',
    test: (hex, bytes) => asciiPreview(bytes).includes('YubiKey'),
    note: 'Text match only. Consistent with a Yubico YubiKey, but confirm with the card application list.',
  },
  {
    id: 'javacard-text',
    label: 'Historical bytes contain "Java" text',
    confidence: 'hint',
    test: (hex, bytes) => /Java/i.test(asciiPreview(bytes)),
    note: 'Text match only. Many Java Card based products include such text; it does not identify the vendor.',
  },
];

/**
 * Parse an ATR. Returns a structured object; never throws for malformed input
 * (errors are listed in `errors`, and `ok` is false).
 */
export function parseAtr(input) {
  const raw = input instanceof Uint8Array ? input : parseHex(input);
  const result = {
    ok: false,
    errors: [],
    warnings: [],
    rawHex: toHex(raw),
    length: raw.length,
    convention: null,
    TS: null,
    T0: null,
    Y1: null,
    K: null,
    interface: [], // [{ index, TA, TB, TC, TD, ... }]
    protocols: [],
    fiDi: null,
    historical: { bytes: new Uint8Array(0), hex: '', category: null, categoryName: null, ascii: '', compactTlv: [] },
    tck: { required: false, present: false, value: null, ok: null },
    patterns: [],
  };
  if (raw.length < 2) {
    result.errors.push('An ATR is at least 2 bytes (TS and T0).');
    return result;
  }
  const TS = raw[0];
  if (TS === 0x3b) result.convention = 'direct';
  else if (TS === 0x3f) result.convention = 'inverse';
  else {
    result.errors.push(`TS must be 3B (direct) or 3F (inverse), got ${hexByte(TS)}.`);
    return result;
  }
  result.TS = TS;

  // For the inverse convention each following byte is transmitted bit-reversed.
  const d = result.convention === 'inverse' ? Uint8Array.from(raw, (b, i) => (i === 0 ? b : reverseBits(b))) : raw;
  if (result.convention === 'inverse') {
    result.warnings.push('Inverse convention (TS=3F): bytes after TS were bit-reversed for parsing. The raw hex is shown unchanged.');
  }

  const T0 = d[1];
  result.T0 = T0;
  const K = T0 & 0x0f;
  result.Y1 = T0 >> 4;
  result.K = K;

  let pos = 2;
  let y = result.Y1;
  let group = 1;
  let anyNonZeroProtocol = false;
  let fiDiSet = false;
  let ok = true;

  while (true) {
    const entry = { index: group, TA: null, TB: null, TC: null, TD: null };
    // y is the high nibble of T0 (or of the previous TD): bit 0 = TA present, 1 = TB, 2 = TC, 3 = TD
    const need = (y & 0x1 ? 1 : 0) + (y & 0x2 ? 1 : 0) + (y & 0x4 ? 1 : 0) + (y & 0x8 ? 1 : 0);
    if (pos + need > d.length) {
      result.errors.push(`ATR is truncated inside interface group ${group}.`);
      ok = false;
      break;
    }
    if (y & 0x1) { entry.TA = d[pos++]; }
    if (y & 0x2) { entry.TB = d[pos++]; }
    if (y & 0x4) { entry.TC = d[pos++]; }
    if (y & 0x8) { entry.TD = d[pos++]; }
    result.interface.push(entry);

    if (group === 1 && entry.TA !== null) {
      result.fiDi = fiDiToBaud(entry.TA, DEFAULT_CLOCK_HZ);
      fiDiSet = true;
    }
    if (group === 1 && entry.TB !== null && entry.TB !== 0) {
      result.warnings.push(`TB1 is ${hexByte(entry.TB)}. TB1 was VPP in older standards; modern cards send 00.`);
    }
    if (entry.TD !== null) {
      const proto = entry.TD & 0x0f;
      result.protocols.push(proto);
      if (proto !== 0) anyNonZeroProtocol = true;
      y = entry.TD >> 4;
      group++;
      if (y === 0) break;
    } else {
      break;
    }
  }
  if (!fiDiSet) result.fiDi = { ...fiDiToBaud(0x11, DEFAULT_CLOCK_HZ), defaulted: true }; // ISO default FI=1, DI=1 (9600 bps) when TA1 absent
  else result.fiDi = { ...result.fiDi, defaulted: false };

  if (!ok) {
    result.errors.push('Interface byte parsing stopped early, so the historical bytes cannot be located.');
    return finishAtr(result, raw, d, pos, K, anyNonZeroProtocol, false);
  }
  return finishAtr(result, raw, d, pos, K, anyNonZeroProtocol, true);
}

function finishAtr(result, raw, d, pos, K, anyNonZeroProtocol, parsedInterface) {
  // Historical bytes
  if (parsedInterface) {
    const histEnd = pos + K;
    if (histEnd > d.length) {
      result.errors.push(`T0 announces ${K} historical bytes but only ${Math.max(0, d.length - pos)} remain.`);
    } else {
      const hist = raw.slice(pos, histEnd); // show raw bytes
      const histDec = d.slice(pos, histEnd); // interpreted bytes
      result.historical.bytes = hist;
      result.historical.hex = toHex(hist);
      result.historical.ascii = asciiPreview(histDec);
      if (histDec.length > 0) {
        const cat = histDec[0];
        result.historical.category = cat;
        if (cat === 0x80) {
          result.historical.categoryName = 'Compact-TLV data objects (ISO 7816-4 category 0x80)';
          result.historical.compactTlv = parseCompactTlv(histDec.slice(1));
        } else if (cat === 0x00) {
          result.historical.categoryName = 'Status indicator / no data objects (category 0x00)';
        } else if (cat === 0x10) {
          result.historical.categoryName = 'DIR data reference (category 0x10)';
        } else {
          result.historical.categoryName = `Proprietary or RFU category ${hexByte(cat)}`;
        }
      }
    }
    // TCK
    const tckRequired = anyNonZeroProtocol;
    result.tck.required = tckRequired;
    const expectedLen = pos + K + (tckRequired ? 1 : 0);
    if (d.length >= expectedLen && tckRequired) {
      // XOR of T0 .. TCK must be zero (bytes from index 1)
      let x = 0;
      for (let i = 1; i < expectedLen; i++) x ^= d[i];
      result.tck.present = true;
      result.tck.value = d[expectedLen - 1];
      result.tck.ok = x === 0;
      if (x !== 0) result.errors.push(`TCK check failed (XOR of T0..TCK is ${hexByte(x)}, expected 00).`);
    } else if (tckRequired) {
      result.errors.push('TCK is required (a T!=0 protocol is indicated) but missing.');
    }
    if (raw.length > expectedLen) {
      result.warnings.push(`${raw.length - expectedLen} extra byte(s) after the ATR.`);
    }
    if (raw.length < expectedLen) {
      result.errors.push(`ATR is ${expectedLen - raw.length} byte(s) shorter than T0, the interface bytes and TCK imply.`);
    }
    result.expectedLength = expectedLen;
  }

  for (const p of result.protocols) {
    if (p !== 0 && p !== 1) result.warnings.push(`Protocol T=${p} is RFU or proprietary in ISO 7816-3.`);
  }
  for (const pat of KNOWN_ATR_PATTERNS) {
    try {
      if (pat.test(toHex(raw), raw)) result.patterns.push({ id: pat.id, label: pat.label, confidence: pat.confidence, note: pat.note });
    } catch { /* ignore pattern errors */ }
  }
  result.ok = result.errors.length === 0;
  return result;
}

/** Compact-TLV (ISO 7816-4 8.1.1.2.2): each object is one byte, tag nibble + length nibble, then value. */
function parseCompactTlv(bytes) {
  const out = [];
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    const tag = b >> 4;
    const len = b & 0x0f;
    if (tag === 0 && len === 0) { i++; continue; } // padding
    if (i + 1 + len > bytes.length) {
      out.push({ tag, len, value: toHex(bytes.slice(i + 1)), truncated: true });
      break;
    }
    out.push({ tag, len, value: toHex(bytes.slice(i + 1, i + 1 + len)) });
    i += 1 + len;
  }
  return out;
}

// ---------------------------------------------------------------- SW table (ISO 7816-4 + common)

/** Meaning of a status word (SW1 SW2). Always returns { sw, meaning, kind }. */
export function swInfo(sw1, sw2) {
  const sw = ((sw1 & 0xff) << 8) | (sw2 & 0xff);
  const hex = hexByte(sw1) + ' ' + hexByte(sw2);
  const out = (meaning, kind = 'error') => ({ sw: hex, meaning, kind });
  const exact = SW_EXACT[sw];
  if (exact) {
    const kind = sw1 === 0x90 || sw1 === 0x61 ? 'success' : (sw1 === 0x62 || sw1 === 0x63 ? 'warning' : 'error');
    return out(exact, kind);
  }
  if (sw1 === 0x61) return out(`${sw2 === 0 ? 256 : sw2} more response byte(s) available. Send GET RESPONSE (00 C0 00 00 ${hexByte(sw2)}).`, 'success');
  if (sw1 === 0x6c) return out(`Wrong Le. The exact length is ${sw2 === 0 ? 256 : sw2}; resend the command with Le=${hexByte(sw2)}.`);
  if (sw1 === 0x63 && (sw2 & 0xf0) === 0xc0) return out(`Verification failed. Counter ${sw2 & 0x0f} (remaining tries, ISO 7816-4 63 Cx).`);
  if (sw1 === 0x91) return out(`Proprietary "91 xx": ${sw2} byte(s) of response pending. Often used by Java Card / GlobalPlatform stacks.`, 'success');
  if (sw1 === 0x62) return out('Warning: state of non-volatile memory unchanged (62 xx).', 'warning');
  if (sw1 === 0x63) return out('Warning: state of non-volatile memory changed (63 xx).', 'warning');
  return out('Unknown or vendor-specific status word.', sw1 === 0x90 ? 'success' : 'error');
}

const SW_EXACT = {
  0x9000: 'Success. Command completed normally.',
  0x6200: 'Warning: no information given (62 00).',
  0x6281: 'Warning: part of returned data may be corrupted.',
  0x6282: 'Warning: end of file or record reached before Le bytes were read.',
  0x6283: 'Warning: selected file invalidated.',
  0x6284: 'Warning: FCI not formatted according to ISO 7816-4.',
  0x6300: 'Authentication failed (63 00).',
  0x6400: 'Execution error: state of non-volatile memory unchanged.',
  0x6500: 'Execution error: memory failure (state changed).',
  0x6581: 'Memory failure.',
  0x6700: 'Wrong length (Lc or Le).',
  0x6800: 'CLA function not supported (68 00).',
  0x6881: 'Logical channel not supported.',
  0x6882: 'Secure messaging not supported.',
  0x6900: 'Command not allowed (69 00).',
  0x6981: 'Command incompatible with the file structure.',
  0x6982: 'Security status not satisfied (authenticate or verify first).',
  0x6983: 'Authentication method blocked.',
  0x6984: 'Referenced data invalidated (for example a blocked key or PIN).',
  0x6985: 'Conditions of use not satisfied.',
  0x6986: 'Command not allowed (no current EF selected).',
  0x6988: 'Incorrect secure messaging data objects.',
  0x6A80: 'Incorrect parameters in the data field.',
  0x6A81: 'Function not supported (or wrong key or card type).',
  0x6A82: 'File or application not found.',
  0x6A83: 'Record not found.',
  0x6A84: 'Not enough memory space in the file.',
  0x6A86: 'Incorrect P1 or P2.',
  0x6A88: 'Referenced data (key, object or PIN) not found.',
  0x6B00: 'Wrong P1 or P2 (offset out of range).',
  0x6D00: 'Instruction (INS) not supported or invalid.',
  0x6E00: 'Class (CLA) not supported.',
  0x6F00: 'No precise diagnosis.',
  0x9302: 'Invalid MAC (wrong secure-messaging authentication).',
  0x9303: 'Application blocked.',
  0x9403: 'Key or file not found.',
  0x9840: 'Security error: authentication or access condition failed.',
};

// ---------------------------------------------------------------- INS table

// ISO 7816-4 interindustry instructions, plus common GlobalPlatform / EMV / PIV /
// OpenPGP names. The same INS can mean different things in different applets;
// `names` lists each family so the user can judge.
const INS_TABLE = {
  0x0e: ['ERASE BINARY', 'ISO'],
  0x20: ['VERIFY', 'ISO; EMV; PIV'],
  0x22: ['MANAGE SECURITY ENVIRONMENT', 'ISO'],
  0x24: ['CHANGE REFERENCE DATA (PIN change)', 'ISO; EMV; PIV'],
  0x2a: ['PERFORM SECURITY OPERATION (PSO)', 'ISO; EMV; OpenPGP'],
  0x2c: ['RESET RETRY COUNTER / UNBLOCK', 'ISO; PIV'],
  0x44: ['ACTIVATE FILE', 'ISO'],
  0x46: ['GENERATE ASYMMETRIC KEY PAIR (older)', 'ISO'],
  0x47: ['GENERATE ASYMMETRIC KEY PAIR', 'PIV; OpenPGP'],
  0x50: ['INITIALIZE UPDATE', 'GlobalPlatform'],
  0x70: ['MANAGE CHANNEL', 'ISO'],
  0x82: ['EXTERNAL / MUTUAL AUTHENTICATE', 'ISO; GlobalPlatform; EMV'],
  0x84: ['GET CHALLENGE', 'ISO; EMV'],
  0x86: ['GENERAL AUTHENTICATE (older)', 'ISO'],
  0x87: ['GENERAL AUTHENTICATE', 'PIV; ISO'],
  0x88: ['INTERNAL AUTHENTICATE', 'ISO; EMV'],
  0xa4: ['SELECT FILE / SELECT by AID', 'ISO; EMV; GlobalPlatform; PIV'],
  0xa8: ['GET PROCESSING OPTIONS', 'EMV'],
  0xae: ['GENERATE AC (application cryptogram)', 'EMV'],
  0xb0: ['READ BINARY', 'ISO'],
  0xb1: ['READ BINARY (odd INS, extended offset)', 'ISO'],
  0xb2: ['READ RECORD', 'ISO; EMV'],
  0xb3: ['READ RECORD (odd INS)', 'ISO'],
  0xc0: ['GET RESPONSE', 'ISO'],
  0xc2: ['ENVELOPE', 'ISO'],
  0xca: ['GET DATA', 'ISO; EMV; GlobalPlatform; PIV; OpenPGP'],
  0xcb: ['GET DATA (odd INS)', 'ISO'],
  0xd0: ['WRITE BINARY', 'ISO'],
  0xd2: ['WRITE RECORD', 'ISO'],
  0xd6: ['UPDATE BINARY', 'ISO'],
  0xd8: ['PUT KEY', 'GlobalPlatform'],
  0xda: ['PUT DATA', 'ISO; PIV; OpenPGP'],
  0xdc: ['UPDATE RECORD', 'ISO'],
  0xe0: ['CREATE FILE', 'ISO; GlobalPlatform'],
  0xe2: ['APPEND RECORD / STORE DATA', 'ISO; GlobalPlatform'],
  0xe4: ['DELETE FILE / DELETE', 'ISO; GlobalPlatform'],
  0xe6: ['INSTALL', 'GlobalPlatform'],
  0xe8: ['LOAD', 'GlobalPlatform'],
  0xf0: ['SET STATUS', 'GlobalPlatform'],
  0xf2: ['GET STATUS', 'GlobalPlatform'],
  0xf8: ['PERFORM SECURITY OPERATION (PIV)', 'PIV'],
  0xf9: ['ATTEST', 'PIV (YubiKey extension)'],
  0xfd: ['GET VERSION', 'PIV (YubiKey extension)'],
  0xfe: ['IMPORT ASYMMETRIC KEY', 'PIV'],
  0xff: ['SET MANAGEMENT KEY', 'PIV (YubiKey extension)'],
};

export function insName(ins) {
  const e = INS_TABLE[ins];
  return e ? { name: e[0], families: e[1] } : { name: 'Unknown or proprietary INS', families: '' };
}

// ---------------------------------------------------------------- APDU decode

/**
 * Decode an APDU command. Cases 1-4, short and extended.
 *   Case 1: CLA INS P1 P2
 *   Case 2: + Le
 *   Case 3: + Lc Data
 *   Case 4: + Lc Data Le
 * Short Le of 00 means 256. Extended: a leading 00 introduces 2-byte Lc / Le;
 * extended Le 0000 means 65536.
 */
export function decodeCommandApdu(input) {
  const b = input instanceof Uint8Array ? input : parseHex(input);
  if (b.length < 4) return { ok: false, error: 'A command APDU needs at least 4 bytes (CLA INS P1 P2).' };
  const cla = b[0];
  const ins = b[1];
  const p1 = b[2];
  const p2 = b[3];
  const out = {
    ok: true,
    error: null,
    cla: hexByte(cla),
    ins: hexByte(ins),
    p1: hexByte(p1),
    p2: hexByte(p2),
    classInfo: describeCla(cla),
    insInfo: insName(ins),
    case: 1,
    encoding: 'short',
    lc: null,
    data: new Uint8Array(0),
    le: null,
    leMeaning: null,
    rawLength: b.length,
  };
  const n = b.length;

  if (n === 4) {
    out.case = 1;
    return out;
  }
  if (n === 5) {
    out.case = 2;
    out.le = b[4] === 0 ? 256 : b[4];
    out.leMeaning = `Le=${b[4] === 0 ? '00 (256 bytes)' : b[4]}`;
    return out;
  }
  if (b[4] !== 0 || n === 6) {
    // short Lc
    const lc = b[4];
    if (n === 5 + lc) {
      out.case = 3;
      out.lc = lc;
      out.data = b.slice(5);
      return out;
    }
    if (lc > 0 && n === 5 + lc + 1) {
      out.case = 4;
      out.lc = lc;
      out.data = b.slice(5, 5 + lc);
      out.le = b[n - 1] === 0 ? 256 : b[n - 1];
      out.leMeaning = `Le=${b[n - 1] === 0 ? '00 (256 bytes)' : b[n - 1]}`;
      return out;
    }
    if (lc === 0 && n === 6) {
      // "00 00" as Le in a 6-byte APDU is a short Le of 0 with one stray byte: treat as malformed
      out.ok = false;
      out.error = 'Ambiguous length: 6 bytes with Lc=00 is not a valid short APDU.';
      return out;
    }
    // Fall through to extended
  }
  if (b[4] === 0 && n >= 7) {
    out.encoding = 'extended';
    if (n === 7) {
      out.case = 2;
      const le = (b[5] << 8) | b[6];
      out.le = le === 0 ? 65536 : le;
      out.leMeaning = `Le=${le === 0 ? '0000 (65536 bytes)' : le}`;
      return out;
    }
    const lc = (b[5] << 8) | b[6];
    if (n === 7 + lc) {
      out.case = 3;
      out.lc = lc;
      out.data = b.slice(7);
      return out;
    }
    if (n === 7 + lc + 2) {
      out.case = 4;
      out.lc = lc;
      out.data = b.slice(7, 7 + lc);
      const le = (b[n - 2] << 8) | b[n - 1];
      out.le = le === 0 ? 65536 : le;
      out.leMeaning = `Le=${le === 0 ? '0000 (65536 bytes)' : le}`;
      return out;
    }
  }
  out.ok = false;
  out.error = `Length ${n} does not match any APDU case (Lc field implies a different length).`;
  return out;
}

function describeCla(cla) {
  if ((cla & 0x80) === 0) {
    // ISO interindustry class (b8 = 0)
    const chain = (cla & 0x10) ? 'chaining: more blocks follow' : 'chaining: last or only block';
    const smBits = (cla & 0x0c) >> 2;
    const sm = ['no secure messaging', 'proprietary secure messaging', 'secure messaging, header not authenticated', 'secure messaging, header authenticated'][smBits];
    const channel = cla & 0x03;
    return { kind: 'ISO interindustry', chain, secureMessaging: sm, logicalChannel: channel, note: '' };
  }
  return { kind: 'Proprietary class (b8 = 1)', chain: '', secureMessaging: '', logicalChannel: null, note: 'Meaning depends on the application (for example GlobalPlatform 0x84 or 0x80).' };
}

/** Decode a response APDU: data plus SW1 SW2. */
export function decodeResponseApdu(input) {
  const b = input instanceof Uint8Array ? input : parseHex(input);
  if (b.length < 2) return { ok: false, error: 'A response APDU needs at least 2 bytes (SW1 SW2).' };
  const sw1 = b[b.length - 2];
  const sw2 = b[b.length - 1];
  return {
    ok: true,
    error: null,
    data: b.slice(0, b.length - 2),
    dataHex: toHex(b.slice(0, b.length - 2)),
    sw: swInfo(sw1, sw2),
  };
}

// ---------------------------------------------------------------- trace log

/**
 * Parse a trace log. Lines carry a direction marker: `>>` or `>` or `->` or `TX`
 * for reader-to-card commands, `<<` or `<` or `<-` or `RX` for card-to-reader
 * responses. The leading run of two-digit hex bytes after the marker is used;
 * a timestamp or label before the marker is ignored, and anything after the
 * hex run (for example a "(12 bytes)" comment) is ignored too.
 */
const DIR_RE = /^\s*(?:\[[^\]]*\]\s*|\d[\d:.\-]*\s+)?(>>|<<|->|<-|TX:?|RX:?|>|<)\s*(.*)$/i;

export function parseTrace(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const steps = [];
  let ignored = 0;
  let pendingCommand = null;
  let atrLine = null;

  lines.forEach((line, idx) => {
    if (!line.trim()) return;
    const m = DIR_RE.exec(line);
    if (!m) { ignored++; return; }
    const marker = m[1];
    const dir = /^(>|->|>>|TX)/i.test(marker) ? 'cmd' : 'rsp';
    // Only the leading run of hex bytes after the marker counts; trailing comments are ignored.
    const lead = /^\s*((?:0x)?[0-9A-Fa-f]{2}(?:[\s:,\-]+(?:0x)?[0-9A-Fa-f]{2})*)/i.exec(m[2]);
    if (!lead) { ignored++; return; }
    let bytes;
    try {
      bytes = parseHex(lead[1]);
    } catch {
      ignored++;
      return;
    }
    if (dir === 'rsp' && steps.length === 0 && (bytes[0] === 0x3b || bytes[0] === 0x3f) && atrLine === null) {
      atrLine = { line: idx + 1, bytes };
      steps.push({ n: steps.length + 1, line: idx + 1, dir: 'atr', hex: toHex(bytes), atr: parseAtr(bytes) });
      return;
    }
    if (dir === 'cmd') {
      if (pendingCommand) {
        // Previous command never got a response
        steps.push({ n: steps.length + 1, line: pendingCommand.line, dir: 'cmd', hex: toHex(pendingCommand.bytes), apdu: decodeCommandApdu(pendingCommand.bytes), noResponse: true });
      }
      pendingCommand = { bytes, line: idx + 1 };
    } else {
      if (pendingCommand) {
        steps.push({ n: steps.length + 1, line: pendingCommand.line, dir: 'cmd', hex: toHex(pendingCommand.bytes), apdu: decodeCommandApdu(pendingCommand.bytes) });
        steps.push({ n: steps.length + 1, line: idx + 1, dir: 'rsp', hex: toHex(bytes), rapdu: decodeResponseApdu(bytes) });
        pendingCommand = null;
      } else {
        steps.push({ n: steps.length + 1, line: idx + 1, dir: 'rsp', hex: toHex(bytes), rapdu: decodeResponseApdu(bytes), orphan: true });
      }
    }
  });
  if (pendingCommand) {
    steps.push({ n: steps.length + 1, line: pendingCommand.line, dir: 'cmd', hex: toHex(pendingCommand.bytes), apdu: decodeCommandApdu(pendingCommand.bytes), noResponse: true });
  }
  return { steps, ignored, commands: steps.filter((s) => s.dir === 'cmd').length };
}

// ---------------------------------------------------------------- BER-TLV

/** Known tags (EMV Book 3 / common issuer tags). Lower-case hex keys. */
export const EMV_TAGS = {
  '4f': 'Application Identifier (AID)',
  '50': 'Application Label',
  '57': 'Track 2 Equivalent Data',
  '5a': 'Application Primary Account Number (PAN)',
  '5f20': 'Cardholder Name',
  '5f24': 'Application Expiration Date',
  '5f25': 'Application Effective Date',
  '5f28': 'Issuer Country Code',
  '5f2a': 'Transaction Currency Code',
  '5f2d': 'Language Preference',
  '5f30': 'Service Code',
  '5f34': 'Application PAN Sequence Number',
  '5f36': 'Transaction Currency Exponent',
  '5f50': 'Issuer URL',
  '5f53': 'International Bank Account Number (IBAN)',
  '5f54': 'Bank Identifier Code (BIC)',
  '61': 'Application Template',
  '6f': 'File Control Information (FCI) Template',
  '70': 'READ RECORD Response Message Template',
  '77': 'Response Message Template Format 2',
  '80': 'Response Message Template Format 1',
  '82': 'Application Interchange Profile (AIP)',
  '84': 'Dedicated File (DF) Name',
  '87': 'Application Priority Indicator',
  '88': 'Short File Identifier (SFI)',
  '8a': 'Authorisation Response Code',
  '8c': 'Card Risk Management Data Object List 1 (CDOL1)',
  '8d': 'Card Risk Management Data Object List 2 (CDOL2)',
  '8e': 'Cardholder Verification Method (CVM) List',
  '8f': 'Certification Authority Public Key Index',
  '90': 'Issuer Public Key Certificate',
  '91': 'Issuer Authentication Data',
  '92': 'Issuer Public Key Remainder',
  '93': 'Signed Static Application Data',
  '94': 'Application File Locator (AFL)',
  '95': 'Terminal Verification Results (TVR)',
  '9a': 'Transaction Date',
  '9b': 'Transaction Status Information',
  '9c': 'Transaction Type',
  '9d': 'Directory Definition File (DDF) Name',
  'a5': 'File Control Information (FCI) Proprietary Template',
  'bf0c': 'File Control Information (FCI) Issuer Discretionary Data',
  '9f01': 'Acquirer Identifier',
  '9f02': 'Amount, Authorised (Numeric)',
  '9f03': 'Amount, Other (Numeric)',
  '9f06': 'Application Identifier (AID), terminal',
  '9f07': 'Application Usage Control',
  '9f08': 'Application Version Number, ICC',
  '9f09': 'Application Version Number, terminal',
  '9f0d': 'Issuer Action Code - Default',
  '9f0e': 'Issuer Action Code - Denial',
  '9f0f': 'Issuer Action Code - Online',
  '9f10': 'Issuer Application Data (IAD)',
  '9f11': 'Issuer Code Table Index',
  '9f12': 'Application Preferred Name',
  '9f13': 'Last Online Application Transaction Counter (ATC) Register',
  '9f14': 'Lower Consecutive Offline Limit',
  '9f15': 'Merchant Category Code',
  '9f16': 'Merchant Identifier',
  '9f17': 'PIN Try Counter',
  '9f1a': 'Terminal Country Code',
  '9f1e': 'Interface Device (IFD) Serial Number',
  '9f1f': 'Track 1 Discretionary Data',
  '9f21': 'Transaction Time',
  '9f26': 'Application Cryptogram (AC)',
  '9f27': 'Cryptogram Information Data (CID)',
  '9f2d': 'ICC PIN Encipherment Public Key Certificate',
  '9f32': 'Issuer Public Key Exponent',
  '9f33': 'Terminal Capabilities',
  '9f34': 'Cardholder Verification (CVM) Results',
  '9f35': 'Terminal Type',
  '9f36': 'Application Transaction Counter (ATC)',
  '9f37': 'Unpredictable Number',
  '9f38': 'Processing Options Data Object List (PDOL)',
  '9f39': 'Point-of-Service (POS) Entry Mode',
  '9f40': 'Additional Terminal Capabilities',
  '9f41': 'Transaction Sequence Counter',
  '9f42': 'Application Currency Code',
  '9f44': 'Application Currency Exponent',
  '9f46': 'ICC Public Key Certificate',
  '9f47': 'ICC Public Key Exponent',
  '9f48': 'ICC Public Key Remainder',
  '9f49': 'Dynamic Data Authentication Data Object List (DDOL)',
  '9f4a': 'Static Data Authentication Tag List',
  '9f4c': 'ICC Dynamic Number',
  '9f4d': 'Log Entry',
  '9f4e': 'Merchant Name and Location',
  '9f4f': 'Log Format',
};

/** PIV tags (NIST SP 800-73). */
export const PIV_TAGS = {
  '53': 'PIV data object wrapper (discretionary data)',
  '5c': 'Tag list',
  '5fc101': 'Card Authentication certificate (card auth key)',
  '5fc102': 'Card Holder Unique Identifier (CHUID)',
  '5fc105': 'X.509 certificate, PIV Authentication (9A)',
  '5fc106': 'Security object',
  '5fc107': 'Card Capability Container (CCC)',
  '5fc108': 'Facial image',
  '5fc109': 'Printed information',
  '5fc10a': 'X.509 certificate, Digital Signature (9C)',
  '5fc10b': 'X.509 certificate, Key Management (9D)',
  '5fc10c': 'Key history object',
  '7e': 'Discovery object',
  '7f21': 'X.509 certificate (PIV certificate template)',
  '7f49': 'Public key information template',
  '7f61': 'Biometric information template',
  '71': 'CertInfo (PIV certificate info)',
  '81': 'RSA modulus (public key)',
  '86': 'ECC public key point or general auth data',
};

/** Look up a tag name: EMV first, then PIV. */
export function tagName(tagHex) {
  const k = tagHex.toLowerCase();
  if (EMV_TAGS[k]) return { name: EMV_TAGS[k], dictionary: 'EMV' };
  if (PIV_TAGS[k]) return { name: PIV_TAGS[k], dictionary: 'PIV' };
  return { name: null, dictionary: null };
}

/**
 * Decode BER-TLV. Returns { nodes, errors, bytesUsed }.
 * Node: { offset, tag, tagClass, constructed, length, lengthEncoding, value (Uint8Array), hex, name, dictionary, children }
 * Padding 00 / FF bytes between top-level objects are skipped.
 */
export function parseTlv(input, { maxDepth = 12 } = {}) {
  const b = input instanceof Uint8Array ? input : parseHex(input);
  const errors = [];
  const nodes = parseTlvRange(b, 0, b.length, 0, maxDepth, errors);
  return { nodes, errors, bytesUsed: b.length };
}

function parseTlvRange(b, start, end, depth, maxDepth, errors) {
  const nodes = [];
  let p = start;
  while (p < end) {
    if (b[p] === 0x00 || b[p] === 0xff) {
      if (depth === 0) { p++; continue; } // padding at top level
    }
    const tagStart = p;
    const first = b[p++];
    let tagHex = hexByte(first);
    if ((first & 0x1f) === 0x1f) {
      // multi-byte tag: subsequent bytes continue while bit 8 is set
      let more = true;
      while (more) {
        if (p >= end) { errors.push(`Truncated tag at offset ${tagStart}.`); return nodes; }
        const tb = b[p++];
        tagHex += hexByte(tb);
        more = (tb & 0x80) !== 0;
      }
    }
    if (p >= end) { errors.push(`Missing length after tag ${tagHex} at offset ${tagStart}.`); return nodes; }
    let length;
    let lengthEncoding = 'short';
    const lb = b[p++];
    if (lb < 0x80) {
      length = lb;
    } else if (lb === 0x80) {
      errors.push(`Indefinite length (80) for tag ${tagHex} at offset ${tagStart} is BER-only and is not supported here.`);
      return nodes;
    } else {
      const n = lb & 0x7f;
      if (n > 4) { errors.push(`Length field of ${n} bytes is too large at offset ${tagStart}.`); return nodes; }
      if (p + n > end) { errors.push(`Truncated length at offset ${tagStart}.`); return nodes; }
      length = 0;
      for (let i = 0; i < n; i++) length = length * 256 + b[p++];
      lengthEncoding = `long (${n} byte${n > 1 ? 's' : ''})`;
    }
    if (p + length > end) {
      errors.push(`Tag ${tagHex} at offset ${tagStart} claims ${length} bytes but only ${end - p} remain.`);
      const value = b.slice(p, end);
      nodes.push(makeNode(tagStart, tagHex, first, length, lengthEncoding, value, depth, maxDepth, errors, true));
      return nodes;
    }
    const value = b.slice(p, p + length);
    nodes.push(makeNode(tagStart, tagHex, first, length, lengthEncoding, value, depth, maxDepth, errors, false));
    p += length;
  }
  return nodes;
}

function makeNode(offset, tagHex, first, length, lengthEncoding, value, depth, maxDepth, errors, truncated) {
  const constructed = (first & 0x20) !== 0;
  const classes = ['Universal', 'Application', 'Context-specific', 'Private'];
  const info = tagName(tagHex);
  const node = {
    offset,
    tag: tagHex.toUpperCase(),
    tagClass: classes[(first & 0xc0) >> 6],
    constructed,
    length,
    lengthEncoding,
    value,
    hex: toHex(value),
    name: info.name,
    dictionary: info.dictionary,
    truncated,
    children: [],
  };
  if (constructed && !truncated && depth + 1 < maxDepth) {
    node.children = parseTlvRange(value, 0, value.length, depth + 1, maxDepth, errors);
  } else if (constructed && depth + 1 >= maxDepth) {
    errors.push(`Nesting deeper than ${maxDepth} levels at tag ${tagHex}; not descended.`);
  }
  return node;
}

// ---------------------------------------------------------------- AID list and APDU builder

export const KNOWN_AIDS = [
  { id: 'piv', name: 'PIV (NIST SP 800-73)', aid: 'A000000308000010000100' },
  { id: 'openpgp', name: 'OpenPGP card', aid: 'D27600012401' },
  { id: 'visa', name: 'Visa (RID A000000003, PIX 1010)', aid: 'A0000000031010' },
  { id: 'mastercard', name: 'Mastercard (RID A000000004, PIX 1010)', aid: 'A0000000041010' },
  { id: 'maestro', name: 'Maestro (RID A000000004, PIX 3060)', aid: 'A0000000043060' },
  { id: 'gp-isd', name: 'GlobalPlatform Issuer Security Domain (default)', aid: 'A000000151000000' },
  { id: 'ndef', name: 'NFC Forum Type 4 NDEF application', aid: 'D2760000850101' },
  { id: 'ppse-contactless', name: 'PPSE "2PAY.SYS.DDF01" (contactless payment directory)', aid: '325041592E5359532E4444463031' },
  { id: 'ppse-contact', name: 'PPSE "1PAY.SYS.DDF01" (contact payment directory)', aid: '315041592E5359532E4444463031' },
];

const hex2 = (n) => {
  if (!Number.isInteger(n) || n < 0 || n > 255) throw new Error(`Byte out of range: ${n}`);
  return hexByte(n);
};

/**
 * Build an APDU from parts. Chooses short encoding unless `extended` is true or
 * the data/Le does not fit. Returns { hex, bytes, case, encoding }.
 *   le: null (no Le) | 0..65536 (0 means the maximum for the encoding)
 */
export function buildApdu({ cla = 0, ins = 0, p1 = 0, p2 = 0, data = new Uint8Array(0), le = null, extended = false } = {}) {
  const d = data instanceof Uint8Array ? data : parseHex(data);
  const header = [cla, ins, p1, p2].map(hex2);
  const bytes = header.map((h) => parseInt(h, 16));
  const useExt = extended || d.length > 255 || (le !== null && le > 256);
  let caseNo;
  if (d.length === 0 && le === null) caseNo = 1;
  else if (d.length === 0) caseNo = 2;
  else if (le === null) caseNo = 3;
  else caseNo = 4;

  if (!useExt) {
    if (d.length > 255) throw new Error('Data longer than 255 bytes needs extended length.');
    if (le !== null && (le < 0 || le > 256)) throw new Error('Short Le must be 0-256.');
    if (d.length > 0) bytes.push(d.length, ...d);
    if (le !== null) bytes.push(le === 256 ? 0 : le);
    return { hex: toHex(bytes, ''), bytes: Uint8Array.from(bytes), case: caseNo, encoding: 'short' };
  }
  if (d.length > 65535) throw new Error('Data longer than 65535 bytes cannot be encoded in an APDU.');
  if (le !== null && (le < 0 || le > 65536)) throw new Error('Extended Le must be 0-65536.');
  if (d.length > 0) {
    // Extended Lc: 00 Lc(2) Data; extended Le (if any) is 2 more bytes
    bytes.push(0, (d.length >> 8) & 0xff, d.length & 0xff, ...d);
    if (le !== null) bytes.push((le >> 8) & 0xff, le & 0xff);
  } else if (le !== null) {
    bytes.push(0, (le >> 8) & 0xff, le & 0xff);
  }
  return { hex: toHex(bytes, ''), bytes: Uint8Array.from(bytes), case: caseNo, encoding: 'extended' };
}

/** SELECT by DF name / AID (ISO 7816-4 P1=04, P2=00, Le=00 for FCI). */
export function buildSelectByAid(aidHex) {
  const aid = parseHex(aidHex);
  if (aid.length < 5 || aid.length > 16) throw new Error('An AID is 5 to 16 bytes.');
  return buildApdu({ cla: 0x00, ins: 0xa4, p1: 0x04, p2: 0x00, data: aid, le: 0 });
}

export function buildGetResponse(le) {
  return buildApdu({ cla: 0x00, ins: 0xc0, p1: 0x00, p2: 0x00, le });
}

export function buildReadRecord({ record = 1, sfi = 0, le = 0 } = {}) {
  if (record < 1 || record > 255) throw new Error('Record number must be 1-255.');
  if (sfi < 0 || sfi > 30) throw new Error('SFI must be 0-30 (0 means the currently selected file).');
  const p2 = sfi === 0 ? 0x04 : ((sfi << 3) | 0x04);
  return buildApdu({ cla: 0x00, ins: 0xb2, p1: record, p2, le });
}

export function buildGetData({ tag, le = 0 }) {
  const t = parseHex(tag);
  if (t.length === 1) return buildApdu({ cla: 0x00, ins: 0xca, p1: 0x00, p2: t[0], le });
  if (t.length === 2) return buildApdu({ cla: 0x00, ins: 0xca, p1: t[0], p2: t[1], le });
  throw new Error('GET DATA tag must be 1 or 2 bytes.');
}

/** Note shown in the builder instead of a VERIFY template. */
export const VERIFY_NOTE =
  'VERIFY (00 20 00 <qualifier> Lc <PIN>) carries a PIN. This tool does not build PIN APDUs, so enter one in your reader tool directly. Watch the retry counter: a wrong PIN decrements it (63 Cx), and a blocked PIN returns 69 83 or 69 84.';

// ---------------------------------------------------------------- example inputs (labelled as examples)

export const EXAMPLES = {
  atr: '3B 6E 00 00 80 31 80 66 B1 84 0C 01 6E 01 83 00 90 00',
  atrT1: '3B 95 11 81 01 AA BB CC DD EE EA',
  apdu: '00 A4 04 00 08 A0 00 00 03 08 00 00 10',
  trace: [
    '<< 3B 8F 80 01 80 4F 0C A0 00 00 03 06 03 00 03 00 00 00 00 68',
    '>> 00 A4 04 00 0B A0 00 00 03 08 00 00 10 00 01 00',
    '<< 61 22',
    '>> 00 C0 00 00 22',
    '<< 6F 20 84 0B A0 00 00 03 08 00 00 10 00 01 00 A5 11 50 0F 50 49 56 20 41 70 70 6C 69 63 61 74 69 6F 6E 90 00',
    '>> 00 20 00 80 08 FF FF FF FF FF FF FF FF',
    '<< 63 C2',
    '>> 00 CB 3F FF 05 5C 03 5F C1 02 00',
    '<< 6A 82',
  ].join('\n'),
  tlv: '70 15 5A 08 47 61 73 90 01 01 01 19 5F 24 03 25 12 31 9F 36 02 00 4D',
  tlvNested: '77 0A 82 02 19 80 94 04 08 01 01 00',
};
