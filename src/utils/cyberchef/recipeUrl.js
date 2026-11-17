/**
 * recipeUrl.js (DAT-6)
 * Shareable recipes: encode/decode a recipe + input into a URL hash, and import/export
 * recipe strings in real CyberChef's format, e.g.
 *     To_Base64('A-Za-z0-9+/=')From_Hex('Auto')Gunzip()
 * Only operations present in both tools can round-trip through CyberChef's format. Anything
 * else is reported in `unsupported` (never silently dropped). Operations that exist only in
 * this tool use their own id with positional arguments, e.g. parse_jwt().
 */

import { registry } from './operations/index.js';
import { base64ToBytes, bytesToBase64, expandAlphabet } from './operations/opHelpers.js';

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

class UnsupportedArgs extends Error {}
const no = (reason) => { throw new UnsupportedArgs(reason); };

const isTrue = (v, d) => (v === undefined || v === null ? d : v === true || v === 'true' || v === 'Yes');
const yn = (b) => (b ? 'Yes' : 'No');
const text = (v, d = '') => (v === undefined || v === null ? d : String(v));
/** CyberChef "binaryString"-style args arrive as {option, string}. */
const optString = (v) => (v && typeof v === 'object' ? { option: v.option ?? '', string: text(v.string) } : { option: '', string: text(v) });

const SEARCH_MAP = { 'Regex': 'Regex', 'Simple string': 'Simple string' };
function searchMode(option) {
  if (SEARCH_MAP[option]) return SEARCH_MAP[option];
  if (String(option).startsWith('Extended')) return 'Extended (\\n, \\t, \\x...)';
  return no(`search type "${option}"`);
}
const ccSearchOption = (mode) => (mode === 'Regex' ? 'Regex' : mode === 'Simple string' ? 'Simple string' : 'Extended (\\n, \\t, \\b...)');

const CC_B64 = 'A-Za-z0-9+/=';
const BITCOIN_B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B45_CC = '0-9A-Z $%*+\\-./:';
const B45_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const DELIMS = ['Line feed', 'CRLF', 'Space', 'Comma', 'Semi-colon', 'Colon', 'Tab'];
const delim = (v, d = 'Line feed') => (DELIMS.includes(text(v, d)) ? text(v, d) : no(`delimiter "${v}"`));

const CHARSET_BY_CODEPAGE = {
  65001: 'UTF-8', 1200: 'UTF-16LE', 1201: 'UTF-16BE', 28591: 'ISO-8859-1', 28592: 'ISO-8859-2', 28605: 'ISO-8859-15',
  1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 20866: 'KOI8-R', 866: 'IBM866', 20127: 'US-ASCII',
  932: 'Shift_JIS', 936: 'GBK', 949: 'EUC-KR', 950: 'Big5', 51932: 'EUC-JP', 54936: 'GB18030'
};
const CC_CHARSET_NAME = {
  'UTF-8': 'UTF-8 (65001)', 'UTF-16LE': 'UTF-16LE (1200)', 'UTF-16BE': 'UTF-16BE (1201)',
  'ISO-8859-1': 'ISO-8859-1 Latin 1 Western European (28591)', 'windows-1252': 'Windows-1252 Western European (1252)',
  'windows-1251': 'Windows-1251 Cyrillic (1251)', 'windows-1250': 'Windows-1250 Central European (1250)'
};
function charsetFromCC(label) {
  const m = /\((\d+)\)\s*$/.exec(text(label));
  const cs = m && CHARSET_BY_CODEPAGE[m[1]];
  return cs || no(`character set "${label}"`);
}

const SHA2_BY_SIZE = { '512': 'sha512', '384': 'sha384', '256': 'sha256', '224': 'sha224', '512/256': 'sha512_256' };
const SIZE_BY_SHA2 = Object.fromEntries(Object.entries(SHA2_BY_SIZE).map(([k, v]) => [v, k]));
const HMAC_NAMES = { 'MD4': 'MD4', 'MD5': 'MD5', 'SHA1': 'SHA-1', 'SHA2 224': 'SHA-224', 'SHA2 256': 'SHA-256', 'SHA2 384': 'SHA-384', 'SHA2 512': 'SHA-512', 'RIPEMD-160': 'RIPEMD-160' };
const HMAC_BY_OURS = Object.fromEntries(Object.entries(HMAC_NAMES).map(([k, v]) => [v, k]));
const HMAC_KEY_FMT = { 'Hex': 'Hex', 'Base64': 'Base64', 'UTF8': 'UTF8', 'Latin1': 'Latin1' };

/** Entry: { cc, ids, from(a) -> {id, args}, to(id, args) -> array } */
const same = (cc, id) => ({ cc, ids: [id], from: () => ({ id, args: {} }), to: () => [] });
const mapped = (cc, id, from, to) => ({ cc, ids: [id], from: (a) => ({ id, args: from(a) }), to: (_id, o) => to(o) });
const extractor = (cc, id, hasIp) => ({
  cc,
  ids: [id],
  from: (a) => {
    if (hasIp) {
      if (!isTrue(a[0], true) || isTrue(a[2], false)) no('IPv4-off or "remove local" options');
      if (isTrue(a[3], false) || isTrue(a[4], false)) no('"display total" and "sort" options');
      return { id, args: { includeIpv6: yn(isTrue(a[1], false)), uniqueOnly: yn(isTrue(a[5], false)) } };
    }
    if (isTrue(a[0], false) || isTrue(a[1], false)) no('"display total" and "sort" options');
    return { id, args: { uniqueOnly: yn(isTrue(a[2], false)) } };
  },
  to: (_id, o) => (hasIp ? [true, o.includeIpv6 === 'Yes', false, false, false, o.uniqueOnly === 'Yes'] : [false, false, o.uniqueOnly === 'Yes'])
});

export const CYBERCHEF_MAP = [
  mapped('To Base64', 'to_base64', (a) => ({ alphabet: text(a[0], CC_B64) }), (o) => [o.alphabet ?? CC_B64]),
  {
    cc: 'From Base64',
    ids: ['from_base64'],
    from: (a) => {
      if (isTrue(a[2], false)) no('"strict mode"');
      return { id: 'from_base64', args: { alphabet: text(a[0], CC_B64) } };
    },
    to: (_id, o) => [o.alphabet ?? CC_B64, true, false]
  },
  mapped('To Hex', 'to_hex', (a) => {
    const d = text(a[0], 'Space');
    const m = { 'Space': 'Space', 'None': 'None', '0x': '0x prefix', 'Comma': 'Comma' }[d];
    if (!m) no(`delimiter "${d}"`);
    if (Number(a[1] || 0) > 0) no('"bytes per line"');
    return { delimiter: m };
  }, (o) => [{ 'Space': 'Space', 'None': 'None', '0x prefix': '0x', 'Comma': 'Comma' }[o.delimiter] || 'Space', 0]),
  { cc: 'From Hex', ids: ['from_hex'], from: () => ({ id: 'from_hex', args: {} }), to: () => ['Auto'] },
  mapped('To Hexdump', 'to_hexdump', (a) => {
    if (isTrue(a[1], false) || isTrue(a[2], false) || isTrue(a[3], false)) no('upper-case / final length / UNIX format options');
    return { width: Number(a[0] ?? 16) };
  }, (o) => [Number(o.width ?? 16), false, false, false]),
  same('From Hexdump', 'from_hexdump'),
  mapped('To Binary', 'to_binary', (a) => {
    const d = text(a[0], 'Space');
    if (!['Space', 'Comma', 'Line feed'].includes(d) && d !== 'None') no(`delimiter "${d}"`);
    if (Number(a[1] ?? 8) !== 8) no('byte length other than 8');
    return { delimiter: d };
  }, (o) => [o.delimiter ?? 'Space', 8]),
  { cc: 'From Binary', ids: ['from_binary'], from: (a) => { if (Number(a[1] ?? 8) !== 8) no('byte length other than 8'); return { id: 'from_binary', args: {} }; }, to: () => ['Space', 8] },
  mapped('To Decimal', 'to_decimal', (a) => {
    const d = text(a[0], 'Space');
    if (!['Space', 'Comma', 'Semi-colon', 'Line feed'].includes(d)) no(`delimiter "${d}"`);
    if (isTrue(a[1], false)) no('signed numbers');
    return { delimiter: d };
  }, (o) => [o.delimiter ?? 'Space', false]),
  { cc: 'From Decimal', ids: ['from_decimal'], from: (a) => { if (isTrue(a[1], false)) no('signed numbers'); return { id: 'from_decimal', args: {} }; }, to: () => ['Auto', false] },
  mapped('To Base32', 'to_base32', (a) => {
    const al = text(a[0], 'A-Z2-7=');
    if (al === 'A-Z2-7=') return { pad: 'Yes' };
    if (al === 'A-Z2-7') return { pad: 'No' };
    return no('custom Base32 alphabet');
  }, (o) => [o.pad === 'No' ? 'A-Z2-7' : 'A-Z2-7=']),
  { cc: 'From Base32', ids: ['from_base32'], from: (a) => { if (text(a[0], 'A-Z2-7=') !== 'A-Z2-7=') no('custom Base32 alphabet'); return { id: 'from_base32', args: {} }; }, to: () => ['A-Z2-7=', true] },
  mapped('To Base58', 'to_base58', (a) => { if (text(a[0], BITCOIN_B58) !== BITCOIN_B58) no('non-Bitcoin Base58 alphabet'); return {}; }, () => [BITCOIN_B58]),
  { cc: 'From Base58', ids: ['from_base58'], from: (a) => { if (text(a[0], BITCOIN_B58) !== BITCOIN_B58) no('non-Bitcoin Base58 alphabet'); return { id: 'from_base58', args: {} }; }, to: () => [BITCOIN_B58, true] },
  mapped('To Base62', 'to_base62', (a) => ({ alphabet: text(a[0], '0-9A-Za-z') }), (o) => [o.alphabet ?? '0-9A-Za-z']),
  mapped('From Base62', 'from_base62', (a) => ({ alphabet: text(a[0], '0-9A-Za-z') }), (o) => [o.alphabet ?? '0-9A-Za-z']),
  {
    cc: 'To Base45',
    ids: ['to_base45'],
    from: (a) => { if (a[0] !== undefined && expandAlphabet(a[0]).join('') !== B45_CHARS) no('custom Base45 alphabet'); return { id: 'to_base45', args: {} }; },
    to: () => [B45_CC]
  },
  {
    cc: 'From Base45',
    ids: ['from_base45'],
    from: (a) => { if (a[0] !== undefined && expandAlphabet(a[0]).join('') !== B45_CHARS) no('custom Base45 alphabet'); return { id: 'from_base45', args: {} }; },
    to: () => [B45_CC, true]
  },
  mapped('URL Encode', 'url_encode', (a) => ({ encodeAll: yn(isTrue(a[0], false)) }), (o) => [o.encodeAll === 'Yes']),
  same('URL Decode', 'url_decode'),
  {
    cc: 'ROT13',
    ids: ['rot13', 'rot_n'],
    from: (a) => {
      if (!isTrue(a[0], true) || !isTrue(a[1], true)) no('rotating only upper or only lower case');
      const amount = Number(a[2] ?? 13);
      return amount === 13 ? { id: 'rot13', args: {} } : { id: 'rot_n', args: { amount, letters: 'Yes', digits: 'No' } };
    },
    to: (id, o) => {
      if (id === 'rot_n' && (o.letters === 'No' || o.digits === 'Yes')) no('digit rotation / letters-off');
      return [true, true, id === 'rot13' ? 13 : Number(o.amount ?? 13)];
    }
  },
  mapped('ROT47', 'rot47', (a) => ({ amount: Number(a[0] ?? 47) }), (o) => [Number(o.amount ?? 47)]),
  mapped('Reverse', 'reverse', (a) => ({ by: text(a[0], 'Character') }), (o) => [o.by ?? 'Character']),
  mapped('Find / Replace', 'find_replace', (a) => {
    const f = optString(a[0]);
    return {
      find: f.string, replace: text(a[1]), mode: searchMode(f.option || 'Regex'),
      global: yn(isTrue(a[2], true)), ignoreCase: yn(isTrue(a[3], false)), multiline: yn(isTrue(a[4], true)), dotAll: yn(isTrue(a[5], false))
    };
  }, (o) => [{ option: ccSearchOption(o.mode), string: o.find ?? '' }, o.replace ?? '', o.global !== 'No', o.ignoreCase === 'Yes', o.multiline !== 'No', o.dotAll === 'Yes']),
  mapped('Regular expression', 'regular_expression', (a) => {
    const fmt = text(a[8], 'Highlight matches');
    if (fmt === 'Highlight matches') no('"Highlight matches" output (choose a List output format)');
    return {
      regex: text(a[1]), ignoreCase: yn(isTrue(a[2], true)), multiline: yn(isTrue(a[3], true)), dotAll: yn(isTrue(a[4], false)),
      unicode: yn(isTrue(a[5], false) || isTrue(a[6], false)), displayTotal: yn(isTrue(a[7], false)), outputFormat: fmt
    };
  }, (o) => {
    if (o.outputFormat === 'Replace') no('Replace output format');
    return ['User defined', o.regex ?? '', o.ignoreCase !== 'No', o.multiline !== 'No', o.dotAll === 'Yes', o.unicode === 'Yes', false, o.displayTotal === 'Yes', o.outputFormat ?? 'List matches'];
  }),
  mapped('To Upper case', 'to_upper_case', (a) => ({ scope: text(a[0], 'All') }), (o) => [o.scope ?? 'All']),
  same('To Lower case', 'to_lower_case'),
  mapped('Sort', 'sort', (a) => {
    const order = text(a[2], 'Alphabetical (case sensitive)');
    if (!['Alphabetical (case sensitive)', 'Alphabetical (case insensitive)', 'IP address', 'Numeric'].includes(order)) no(`sort order "${order}"`);
    return { delimiter: delim(a[0]), reverse: yn(isTrue(a[1], false)), order };
  }, (o) => [o.delimiter ?? 'Line feed', o.reverse === 'Yes', o.order ?? 'Alphabetical (case sensitive)']),
  mapped('Unique', 'unique', (a) => ({ delimiter: delim(a[0]), displayCount: yn(isTrue(a[1], false)) }), (o) => [o.delimiter ?? 'Line feed', o.displayCount === 'Yes']),
  mapped('Head', 'head', (a) => ({ delimiter: delim(a[0]), number: Number(a[1] ?? 10) }), (o) => [o.delimiter ?? 'Line feed', Number(o.number ?? 10)]),
  mapped('Tail', 'tail', (a) => ({ delimiter: delim(a[0]), number: Number(a[1] ?? 10) }), (o) => [o.delimiter ?? 'Line feed', Number(o.number ?? 10)]),
  mapped('Remove whitespace', 'remove_whitespace', (a) => ({
    spaces: yn(isTrue(a[0], true)), carriageReturns: yn(isTrue(a[1], true)), lineFeeds: yn(isTrue(a[2], true)),
    tabs: yn(isTrue(a[3], true)), formFeeds: yn(isTrue(a[4], true)), fullStops: yn(isTrue(a[5], false))
  }), (o) => [o.spaces !== 'No', o.carriageReturns !== 'No', o.lineFeeds !== 'No', o.tabs !== 'No', o.formFeeds !== 'No', o.fullStops === 'Yes']),
  same('Remove null bytes', 'remove_null_bytes'),
  mapped('Count occurrences', 'count_occurrences', (a) => {
    const s = optString(a[0]);
    return { search: s.string, mode: searchMode(s.option || 'Regex') };
  }, (o) => [{ option: ccSearchOption(o.mode), string: o.search ?? '' }]),
  mapped('Swap endianness', 'swap_endianness', (a) => ({ dataFormat: text(a[0], 'Hex'), wordLength: Number(a[1] ?? 4), padIncomplete: yn(isTrue(a[2], false)) }),
    (o) => [o.dataFormat ?? 'Hex', Number(o.wordLength ?? 4), o.padIncomplete === 'Yes']),
  mapped('Add line numbers', 'add_line_numbers', (a) => ({ offset: Number(a[0] ?? 0) }), (o) => [Number(o.offset ?? 0)]),
  mapped('Vigenere Encode', 'vigenere_encode', (a) => ({ key: text(a[0]) }), (o) => [o.key ?? '']),
  mapped('Vigenere Decode', 'vigenere_decode', (a) => ({ key: text(a[0]) }), (o) => [o.key ?? '']),
  same('Atbash Cipher', 'atbash_cipher'),
  mapped('To Morse Code', 'to_morse_code', (a) => ({ format: text(a[0], '-/.'), letterDelimiter: text(a[1], 'Space'), wordDelimiter: text(a[2], 'Line feed') }),
    (o) => [o.format ?? '-/.', o.letterDelimiter ?? 'Space', o.wordDelimiter ?? 'Line feed']),
  mapped('From Morse Code', 'from_morse_code', (a) => ({ letterDelimiter: text(a[0], 'Space'), wordDelimiter: text(a[1], 'Line feed') }),
    (o) => [o.letterDelimiter ?? 'Space', o.wordDelimiter ?? 'Line feed']),
  mapped('A1Z26 Cipher Encode', 'a1z26_encode', (a) => ({ delimiter: text(a[0], 'Space') }), (o) => [o.delimiter ?? 'Space']),
  mapped('A1Z26 Cipher Decode', 'a1z26_decode', (a) => ({ delimiter: text(a[0], 'Space') }), (o) => [o.delimiter ?? 'Space']),
  mapped('To HTML Entity', 'to_html_entity', (a) => {
    const f = { 'Named entities': 'Named entities where possible', 'Numeric entities': 'Numeric (decimal)', 'Hex entities': 'Numeric (hex)' }[text(a[1], 'Named entities')];
    if (!f) no(`entity format "${a[1]}"`);
    return { convertAll: yn(isTrue(a[0], false)), format: f };
  }, (o) => [o.convertAll === 'Yes', { 'Named entities where possible': 'Named entities', 'Numeric (decimal)': 'Numeric entities', 'Numeric (hex)': 'Hex entities' }[o.format] || 'Named entities']),
  same('From HTML Entity', 'from_html_entity'),
  mapped('To Punycode', 'to_punycode', (a) => ({ domain: yn(isTrue(a[0], false)) }), (o) => [o.domain !== 'No']),
  mapped('From Punycode', 'from_punycode', (a) => ({ domain: yn(isTrue(a[0], false)) }), (o) => [o.domain !== 'No']),
  same('To Quoted Printable', 'to_quoted_printable'),
  same('From Quoted Printable', 'from_quoted_printable'),
  mapped('Encode text', 'encode_text', (a) => ({ charset: charsetFromCC(a[0] ?? 'UTF-8 (65001)') }),
    (o) => [CC_CHARSET_NAME[o.charset] || no(`character set "${o.charset}"`)]),
  mapped('Decode text', 'decode_text', (a) => ({ charset: charsetFromCC(a[0] ?? 'UTF-8 (65001)') }),
    (o) => [CC_CHARSET_NAME[o.charset] || no(`character set "${o.charset}"`)]),
  mapped('Defang URL', 'defang_url', (a) => ({
    escapeDots: yn(isTrue(a[0], true)), escapeHttp: yn(isTrue(a[1], true)), escapeColon: yn(isTrue(a[2], true)), process: text(a[3], 'Valid domains and full URLs')
  }), (o) => [o.escapeDots !== 'No', o.escapeHttp !== 'No', o.escapeColon !== 'No', o.process ?? 'Valid domains and full URLs']),
  mapped('Fang URL', 'fang_url', (a) => ({ restoreDots: yn(isTrue(a[0], true)), restoreHttp: yn(isTrue(a[1], true)), restoreColon: yn(isTrue(a[2], true)) }),
    (o) => [o.restoreDots !== 'No', o.restoreHttp !== 'No', o.restoreColon !== 'No']),
  same('Defang IP Addresses', 'defang_ip'),
  mapped('JSON to CSV', 'json_to_csv', (a) => ({ cellDelimiter: text(a[0], ','), rowDelimiter: text(a[1], '\\r\\n') }), (o) => [o.cellDelimiter ?? ',', o.rowDelimiter ?? '\\r\\n']),
  mapped('CSV to JSON', 'csv_to_json', (a) => ({ cellDelimiter: text(a[0], ','), rowDelimiter: text(a[1], '\\r\\n'), format: text(a[2], 'Array of dictionaries') }),
    (o) => [o.cellDelimiter ?? ',', o.rowDelimiter ?? '\\r\\n', o.format ?? 'Array of dictionaries']),
  same('PEM to Hex', 'pem_to_hex'),
  mapped('Hex to PEM', 'hex_to_pem', (a) => ({ label: text(a[0], 'CERTIFICATE') }), (o) => [o.label ?? 'CERTIFICATE']),
  same('MD5', 'md5'),
  same('SHA1', 'sha1'),
  same('MD4', 'md4'),
  same('NT Hash', 'ntlm_hash'),
  {
    cc: 'SHA2',
    ids: Object.values(SHA2_BY_SIZE),
    from: (a) => {
      const id = SHA2_BY_SIZE[text(a[0], '512')];
      return id ? { id, args: {} } : no(`SHA2 size "${a[0]}"`);
    },
    to: (id) => [SIZE_BY_SHA2[id], 160]
  },
  mapped('SHA3', 'sha3', (a) => {
    const size = text(a[0], '512');
    if (!['224', '256', '384', '512'].includes(size)) no(`SHA3 size "${size}"`);
    return { length: size };
  }, (o) => [o.length ?? '256']),
  { cc: 'RIPEMD', ids: ['ripemd160'], from: (a) => { if (text(a[0], '320') !== '160') no('RIPEMD sizes other than 160'); return { id: 'ripemd160', args: {} }; }, to: () => ['160'] },
  mapped('HMAC', 'hmac', (a) => {
    const key = optString(a[0]);
    const fmt = HMAC_KEY_FMT[key.option || 'UTF8'];
    if (!fmt) no(`HMAC key format "${key.option}"`);
    const hash = HMAC_NAMES[text(a[1], 'MD5')];
    if (!hash) no(`HMAC hash "${a[1]}"`);
    return { key: key.string, keyFormat: fmt, hash };
  }, (o) => [{ option: o.keyFormat ?? 'UTF8', string: o.key ?? '' }, HMAC_BY_OURS[o.hash] || no(`HMAC hash "${o.hash}"`)]),
  mapped('BLAKE2b', 'blake2b', (a) => {
    const size = text(a[0], '512');
    if (!['512', '256'].includes(size)) no(`BLAKE2b size "${size}"`);
    if (text(a[1], 'Hex') !== 'Hex' || optString(a[2]).string) no('keyed hashing / non-hex output');
    return { length: size };
  }, (o) => [o.length ?? '512', 'Hex', { option: 'Hex', string: '' }]),
  mapped('BLAKE2s', 'blake2s', (a) => {
    const size = text(a[0], '256');
    if (!['256', '224', '160', '128'].includes(size)) no(`BLAKE2s size "${size}"`);
    if (text(a[1], 'Hex') !== 'Hex' || optString(a[2]).string) no('keyed hashing / non-hex output');
    return { length: size };
  }, (o) => [o.length ?? '256', 'Hex', { option: 'Hex', string: '' }]),
  { cc: 'CRC-32 Checksum', ids: ['crc32'], from: (a) => { if (a.length && !(a.length === 1 && a[0] === 'Hex')) no('arguments'); return { id: 'crc32', args: {} }; }, to: () => ['Hex'] },
  same('Adler-32 Checksum', 'adler32'),
  same('Fletcher-16 Checksum', 'fletcher16'),
  same('Fletcher-32 Checksum', 'fletcher32'),
  same('Gunzip', 'gunzip'),
  extractor('Extract email addresses', 'extract_emails', false),
  extractor('Extract URLs', 'extract_urls', false),
  extractor('Extract domains', 'extract_domains', false),
  extractor('Extract MAC addresses', 'extract_mac_addresses', false),
  extractor('Extract IP addresses', 'extract_ip_addresses', true),
  mapped('JSON Beautify', 'json_beautify', (a) => {
    const indent = text(a[0], '    ');
    if (!/^ *$/.test(indent) || indent.length === 0) no('non-space indent string');
    if (isTrue(a[1], false) || isTrue(a[2], false)) no('sort keys / unquoted keys options');
    return { indent: indent.length };
  }, (o) => [' '.repeat(Number(o.indent ?? 2)), false, false]),
  same('JSON Minify', 'json_minify')
];

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
const BY_CC = new Map(CYBERCHEF_MAP.map((e) => [norm(e.cc), e]));
const BY_CC_LOWER = new Map(CYBERCHEF_MAP.map((e) => [norm(e.cc).toLowerCase(), e]));
const BY_ID = new Map();
for (const e of CYBERCHEF_MAP) for (const id of e.ids) BY_ID.set(id, e);

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function defaultArgs(op) {
  const out = {};
  for (const a of op.args || []) if (a.default !== undefined) out[a.name] = a.default;
  return out;
}

/** Positional array or object to a full name->value object using the op schema. */
function argsToObject(op, args) {
  const out = defaultArgs(op);
  if (Array.isArray(args)) args.forEach((v, i) => { if (op.args[i] && v !== undefined) out[op.args[i].name] = v; });
  else if (args && typeof args === 'object') Object.assign(out, args);
  return out;
}

function makeStep(op, args, flags = {}) {
  const step = { op: op.name, args: { ...defaultArgs(op), ...args } };
  if (flags.disabled) step.disabled = true;
  if (flags.breakpoint) step.breakpoint = true;
  return step;
}

// ---------------------------------------------------------------------------
// Parsing CyberChef recipe strings
// ---------------------------------------------------------------------------

/** Convert CyberChef's single-quoted argument list into a JSON array. */
function argsTextToArray(argsText, opName) {
  let out = '';
  for (let i = 0; i < argsText.length; i++) {
    const ch = argsText[i];
    if (ch === "'") {
      let j = i + 1;
      let inner = '';
      while (j < argsText.length && argsText[j] !== "'") {
        if (argsText[j] === '\\' && j + 1 < argsText.length) {
          if (argsText[j + 1] === "'") { inner += "'"; j += 2; continue; }
          inner += argsText[j] + argsText[j + 1];
          j += 2;
          continue;
        }
        inner += argsText[j] === '"' ? '\\"' : argsText[j];
        j++;
      }
      if (j >= argsText.length) throw new Error(`Unterminated string in the arguments of ${opName}.`);
      out += `"${inner}"`;
      i = j;
    } else {
      out += ch;
    }
  }
  try {
    const arr = JSON.parse(`[${out}]`);
    return arr;
  } catch (e) {
    throw new Error(`Could not read the arguments of ${opName}: ${e.message}`);
  }
}

/** Split a CyberChef recipe string into [{ rawName, args, flags }]. */
export function tokenizeCyberChefRecipe(source) {
  const s = String(source ?? '');
  const tokens = [];
  let i = 0;
  const skip = () => { while (i < s.length && /[\s,]/.test(s[i])) i++; };
  skip();
  while (i < s.length) {
    const nameStart = i;
    while (i < s.length && s[i] !== '(' && !/\s/.test(s[i])) i++;
    const rawName = s.slice(nameStart, i);
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '(' || !rawName) {
      throw new Error(`Expected "(" after "${rawName || s.slice(nameStart, nameStart + 20)}" at position ${nameStart + 1}. CyberChef recipes look like To_Base64('A-Za-z0-9+/=')From_Hex('Auto').`);
    }
    i++;
    const argStart = i;
    let depth = 0;
    let inStr = false;
    let flagsAt = -1;
    for (; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (c === '\\') i++;
        else if (c === "'") inStr = false;
      } else if (c === "'") inStr = true;
      else if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') depth--;
      else if (c === '/' && depth === 0 && flagsAt < 0) flagsAt = i;
      else if (c === ')' && depth === 0) break;
    }
    if (i >= s.length) throw new Error(`Missing ")" closing the arguments of ${rawName}.`);
    const argsText = s.slice(argStart, flagsAt >= 0 ? flagsAt : i);
    const flagText = flagsAt >= 0 ? s.slice(flagsAt + 1, i) : '';
    const flags = {
      disabled: /(^|\/)disabled(\/|$)/.test(flagText),
      breakpoint: /(^|\/)breakpoint(\/|$)/.test(flagText)
    };
    tokens.push({ rawName, args: argsTextToArray(argsText.trim(), rawName), flags });
    i++;
    skip();
  }
  return tokens;
}

/**
 * Import a CyberChef recipe string.
 * @returns {{steps: Array, unsupported: Array<{name:string, index:number, reason:string}>, warnings: string[]}}
 */
export function parseCyberChefRecipe(source) {
  const tokens = tokenizeCyberChefRecipe(source);
  const steps = [];
  const unsupported = [];
  tokens.forEach((t, index) => {
    const displayName = t.rawName.replace(/_/g, ' ');
    const entry = BY_CC.get(norm(displayName)) || null;
    const found = entry ? null : registry.get(t.rawName);
    // Native (non-CyberChef) steps are only accepted by exact op id, so look-alike CyberChef names
    // with different argument layouts (XOR, AES Encrypt, ...) are reported instead of mis-imported.
    const nativeOp = found && found.id === t.rawName ? found : null;
    try {
      if (entry) {
        const { id, args } = entry.from(t.args);
        const op = registry.get(id);
        if (!op) throw new UnsupportedArgs('operation is not registered in this tool');
        steps.push(makeStep(op, args, t.flags));
      } else if (nativeOp) {
        steps.push(makeStep(nativeOp, argsToObject(nativeOp, t.args), t.flags));
      } else {
        const loose = BY_CC_LOWER.get(norm(displayName).toLowerCase());
        if (!loose) throw new UnsupportedArgs('operation not available in this tool');
        const { id, args } = loose.from(t.args);
        steps.push(makeStep(registry.get(id), args, t.flags));
      }
    } catch (e) {
      if (!(e instanceof UnsupportedArgs)) throw e;
      unsupported.push({ name: displayName, index, reason: e.message.startsWith('operation') ? e.message : `unsupported ${e.message}` });
    }
  });
  return { steps, unsupported, warnings: [] };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatCyberChefArgs(args) {
  return JSON.stringify(args)
    .slice(1, -1)
    .replace(/'/g, "\\'")
    .replace(/"((?:[^"\\]|\\.)*)"/g, "'$1'")
    .replace(/\\"/g, '"');
}

function stepFlags(step) {
  return (step.disabled ? '/disabled' : '') + (step.breakpoint ? '/breakpoint' : '');
}

function resolveStepOp(step) {
  return registry.get(step?.op || step?.name || step?.id);
}

/**
 * Format steps as a recipe string.
 * @param {Array} steps
 * @param {{native?: boolean, newline?: boolean}} [options] native: also emit steps that CyberChef lacks,
 *   using this tool's op id and positional arguments (needed for share links). Otherwise they are
 *   listed in `skipped`.
 * @returns {{text: string, skipped: Array<{name:string, reason:string}>}}
 */
export function formatCyberChefRecipe(steps, { native = false, newline = false } = {}) {
  const parts = [];
  const skipped = [];
  for (const step of steps || []) {
    const op = resolveStepOp(step);
    const label = step?.op || step?.name || step?.id || '(unnamed)';
    if (!op) {
      skipped.push({ name: String(label), reason: 'unknown operation' });
      continue;
    }
    const args = argsToObject(op, step.args);
    const entry = BY_ID.get(op.id);
    let arr = null;
    let name;
    if (entry) {
      try {
        arr = entry.to(op.id, args);
        name = entry.cc.replace(/ /g, '_');
      } catch (e) {
        if (!(e instanceof UnsupportedArgs)) throw e;
        if (!native) {
          skipped.push({ name: op.name, reason: `has ${e.message} that CyberChef cannot express` });
          continue;
        }
      }
    }
    if (!arr) {
      if (!native) {
        skipped.push({ name: op.name, reason: 'operation does not exist in CyberChef' });
        continue;
      }
      name = op.id;
      arr = (op.args || []).map((a) => args[a.name]);
      while (arr.length && arr[arr.length - 1] === (op.args[arr.length - 1] || {}).default) arr.pop();
    }
    parts.push(`${name}(${formatCyberChefArgs(arr)}${stepFlags(step)})`);
  }
  return { text: parts.join(newline ? '\n' : ''), skipped };
}

// ---------------------------------------------------------------------------
// URL hash
// ---------------------------------------------------------------------------

const MAX_HASH_INPUT_CHARS = 2000;

function utf8ToB64NoPad(str) {
  return bytesToBase64(new TextEncoder().encode(str)).replace(/=+$/, '');
}

/**
 * Build the hash fragment (without "#") for a recipe + input.
 * The input is included only when it is short text.
 */
export function encodeRecipeHash({ steps = [], input = '' } = {}) {
  const { text: recipe } = formatCyberChefRecipe(steps, { native: true });
  const enc = (v) => encodeURIComponent(v).replace(/%28/g, '(').replace(/%29/g, ')').replace(/%2C/g, ',').replace(/%27/g, "'");
  let hash = `recipe=${enc(recipe)}`;
  if (input && input.length <= MAX_HASH_INPUT_CHARS) hash += `&input=${encodeURIComponent(utf8ToB64NoPad(input))}`;
  return hash;
}

function safeDecode(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`The ${label} in the link has malformed percent-encoding.`);
  }
}

function decodeInputParam(raw) {
  const value = safeDecode(raw, 'input');
  const compact = value.replace(/ /g, '+');
  if (/^[A-Za-z0-9+/_-]*={0,2}$/.test(compact) && compact.length > 0) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(compact));
    } catch {
      // not valid base64 text: treat as a literal (older share links stored raw text)
    }
  }
  return value;
}

/**
 * Parse a location hash such as "#recipe=...&input=...".
 * Accepts CyberChef recipe strings and the older JSON-array format.
 * @returns {{steps: Array|null, input: string|null, unsupported: Array, warnings: string[]}}
 */
export function decodeRecipeHash(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const result = { steps: null, input: null, unsupported: [], warnings: [] };
  if (!raw) return result;
  const params = {};
  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const key = eq < 0 ? part : part.slice(0, eq);
    params[key] = eq < 0 ? '' : part.slice(eq + 1);
  }
  if (params.recipe !== undefined) {
    const recipe = safeDecode(params.recipe, 'recipe');
    if (recipe.trim().startsWith('[')) {
      let parsed;
      try { parsed = JSON.parse(recipe); } catch (e) { throw new Error(`The recipe in the link is not valid JSON: ${e.message}`); }
      if (!Array.isArray(parsed)) throw new Error('The recipe in the link must be a JSON array.');
      const norm2 = normalizeSteps(parsed);
      result.steps = norm2;
      result.unsupported = unknownOps(norm2).map((name, index) => ({ name, index, reason: 'operation not available in this tool' }));
    } else if (recipe.trim()) {
      const parsed = parseCyberChefRecipe(recipe);
      result.steps = parsed.steps;
      result.unsupported = parsed.unsupported;
      result.warnings = parsed.warnings;
    } else {
      result.steps = [];
    }
  }
  if (params.input !== undefined) result.input = decodeInputParam(params.input);
  return result;
}

// ---------------------------------------------------------------------------
// Saved-recipe normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise recipe steps from any source (localStorage, files, links) by operation id/name:
 * the step's op becomes the registry's canonical name, args become a name->value object.
 * Steps whose operation cannot be found are returned unchanged (see unknownOps).
 */
export function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps.filter((s) => s && typeof s === 'object').map((s) => {
    const op = resolveStepOp(s);
    const { op: _o, name: _n, id: _i, args, ...rest } = s;
    if (!op) return { ...rest, op: s.op || s.name || s.id || '', args: args && !Array.isArray(args) ? args : {} };
    return { ...rest, op: op.name, args: argsToObject(op, args) };
  });
}

/** Names of steps whose operation is not registered. */
export function unknownOps(steps) {
  return (steps || []).filter((s) => s && !resolveStepOp(s)).map((s) => String(s.op || s.name || s.id || '(unnamed)'));
}

export function describeImportProblems(unsupported) {
  return unsupported.map((u) => `${u.name} (step ${u.index + 1}): ${u.reason}`);
}
