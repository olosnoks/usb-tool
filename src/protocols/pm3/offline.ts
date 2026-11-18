import { PM3_COMMANDS } from './commands';

/** Offline (no hardware) helpers for the Proxmark workbench. All pure. */

export function parseHexBytes(input: string): Uint8Array | null {
  const clean = input.replace(/0x/gi, '').replace(/[\s:,-]/g, '');
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export const toHex = (b: ArrayLike<number>, sep = ''): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(sep);

// ---------------------------------------------------------------- opcodes
export function describeOpcode(cmd: number): string {
  for (const [name, v] of Object.entries(PM3_COMMANDS)) if (v === cmd) return name;
  return 'UNKNOWN';
}

// ---------------------------------------------------------------- ISO14443A
const SAK_TYPES: Record<number, string> = {
  0x00: 'MIFARE Ultralight / NTAG (Type 2)',
  0x01: 'TNP3xxx (Texas Instruments NFC)',
  0x08: 'MIFARE Classic 1K',
  0x09: 'MIFARE Mini',
  0x10: 'MIFARE Plus 2K (SL2)',
  0x11: 'MIFARE Plus 4K (SL2)',
  0x18: 'MIFARE Classic 4K',
  0x19: 'MIFARE Classic 2K',
  0x20: 'ISO 14443-4 card (DESFire, Plus SL3, JCOP, etc.)',
  0x28: 'JCOP31/41 or SmartMX with Classic 1K emulation',
  0x38: 'SmartMX with Classic 4K emulation',
  0x88: 'Infineon MIFARE Classic 1K',
  0x98: 'Gemplus MPCOS'
};

export interface Iso14aInfo {
  uidLength: number | null;
  uidBytes: Uint8Array | null;
  uidProblem: string | null;
  bccValid: boolean | null;
  randomUid: boolean;
  atqaUidSize: string;
  cardType: string;
  uidComplete: boolean;
  iso14443_4: boolean;
}

export function decodeIso14a(uidHex: string, atqaHex: string, sakHex: string): Iso14aInfo | { error: string } {
  const uid = uidHex.trim() ? parseHexBytes(uidHex) : null;
  const atqa = parseHexBytes(atqaHex);
  const sak = parseHexBytes(sakHex);
  if (uidHex.trim() && !uid) return { error: 'UID is not valid hex.' };
  if (!atqa || atqa.length !== 2) return { error: 'ATQA must be 2 bytes of hex (e.g. 0004).' };
  if (!sak || sak.length !== 1) return { error: 'SAK must be 1 byte of hex (e.g. 08).' };
  const sizeBits = (atqa[0] >> 6) & 3;
  const expected = [4, 7, 10, null][sizeBits];
  let uidProblem: string | null = null;
  if (uid && expected && uid.length !== expected && !(sizeBits === 0 && uid.length === 5)) {
    uidProblem = `ATQA announces a ${expected}-byte UID but ${uid.length} bytes were given.`;
  }
  let bccValid: boolean | null = null;
  if (uid && uid.length === 5) bccValid = (uid[0] ^ uid[1] ^ uid[2] ^ uid[3]) === uid[4];
  const s = sak[0];
  return {
    uidLength: expected,
    uidBytes: uid,
    uidProblem,
    bccValid,
    randomUid: !!uid && uid[0] === 0x08 && (uid.length === 4 || uid.length === 5),
    atqaUidSize: expected ? `${expected} bytes` : 'reserved',
    cardType: SAK_TYPES[s & 0xfb] ?? 'Unknown (not in the built-in SAK table)',
    uidComplete: (s & 0x04) === 0,
    iso14443_4: (s & 0x20) !== 0
  };
}

// ---------------------------------------------------------------- Mifare access bits
const DATA_RULES: Record<string, string> = {
  '000': 'read A|B, write A|B, increment A|B, decrement/transfer/restore A|B (transport)',
  '010': 'read A|B, write never, increment never, decrement never',
  '100': 'read A|B, write B, increment never, decrement never',
  '110': 'read A|B, write B, increment B, decrement/transfer/restore A|B (value block)',
  '001': 'read A|B, write never, increment never, decrement/transfer/restore A|B (value block)',
  '011': 'read B, write B, increment never, decrement never',
  '101': 'read B, write never, increment never, decrement never',
  '111': 'no access'
};
const TRAILER_RULES: Record<string, string> = {
  '000': 'Key A: write A. Access bits: read A. Key B: read A, write A',
  '010': 'Key A: never written. Access bits: read A. Key B: read A',
  '100': 'Key A: write B. Access bits: read A|B. Key B: write B',
  '110': 'Keys never written. Access bits: read A|B',
  '001': 'Key A: write A. Access bits: read A, write A. Key B: read A, write A (transport default)',
  '011': 'Key A: write B. Access bits: read A|B, write B. Key B: write B',
  '101': 'Keys never written. Access bits: read A|B, write B',
  '111': 'Keys never written. Access bits: read A|B (locked)'
};

export interface AccessBitsResult {
  valid: boolean;
  blocks: Array<{ block: number; c: string; rule: string; trailer: boolean }>;
  userByte: number;
  warning: string | null;
}

/** Decode the 4 access bytes (bytes 6-9 of a sector trailer). */
export function decodeAccessBits(hex: string): AccessBitsResult | { error: string } {
  const b = parseHexBytes(hex);
  if (!b || b.length !== 4) return { error: 'Enter exactly 4 bytes (e.g. FF078069).' };
  const [b6, b7, b8, b9] = b;
  const blocks = [];
  let valid = true;
  for (let i = 0; i < 4; i++) {
    const c1 = (b7 >> (4 + i)) & 1;
    const c2 = (b8 >> i) & 1;
    const c3 = (b8 >> (4 + i)) & 1;
    const n1 = (b6 >> i) & 1;
    const n2 = (b6 >> (4 + i)) & 1;
    const n3 = (b7 >> i) & 1;
    if (c1 === n1 || c2 === n2 || c3 === n3) valid = false;
    const c = `${c1}${c2}${c3}`;
    blocks.push({ block: i, c, trailer: i === 3, rule: i === 3 ? TRAILER_RULES[c] : DATA_RULES[c] });
  }
  return {
    valid,
    blocks,
    userByte: b9,
    warning: valid
      ? null
      : 'Inverted bits do not match: the sector would be permanently unreadable if written. Never write this trailer.'
  };
}

// ---------------------------------------------------------------- EM410x
export interface Em410xResult {
  idHex: string;
  decimal40: string;
  decimal32: string;
  customer: number;
  frameBits: string;
}

/** Decode a 5-byte EM410x ID and build its 64-bit on-air frame (9 header ones, row/column parity, stop bit). */
export function decodeEm410x(hex: string): Em410xResult | { error: string } {
  const b = parseHexBytes(hex);
  if (!b || b.length !== 5) return { error: 'EM410x IDs are exactly 5 bytes (10 hex digits).' };
  let bits = '1'.repeat(9);
  const cols = [0, 0, 0, 0];
  for (const byte of b) {
    for (const nib of [byte >> 4, byte & 0xf]) {
      let ones = 0;
      for (let k = 3; k >= 0; k--) {
        const bit = (nib >> k) & 1;
        bits += bit;
        ones += bit;
        cols[3 - k] ^= bit;
      }
      bits += ones & 1;
    }
  }
  bits += cols.join('') + '0';
  let big = 0n;
  for (const byte of b) big = (big << 8n) | BigInt(byte);
  return {
    idHex: toHex(b),
    decimal40: big.toString(10),
    decimal32: (big & 0xffffffffn).toString(10),
    customer: b[0],
    frameBits: bits
  };
}

// ---------------------------------------------------------------- log export
export interface FrameLog { type: string; text: string; time: string }

export function filterLogs(logs: FrameLog[], types: Set<string>, query: string): FrameLog[] {
  const q = query.trim().toLowerCase();
  return logs.filter((l) => types.has(l.type) && (!q || l.text.toLowerCase().includes(q)));
}

export function formatLogsText(logs: FrameLog[]): string {
  return logs.map((l) => `[${l.time}] ${l.type.toUpperCase().padEnd(5)} ${l.text}`).join('\n');
}
