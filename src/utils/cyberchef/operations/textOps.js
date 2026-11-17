/**
 * Text Operations (DAT-6)
 * Find/Replace, Regular expression, case, Sort, Unique, Head/Tail, whitespace and
 * null removal, Count occurrences, Strings, Swap endianness, Reverse, line numbers, Diff.
 */

import { Dish } from '../core/Dish.js';
import { defineOp, hexToBytes, bytesToHex, intArg, unescapeShort } from './opHelpers.js';

const YES_NO = ['Yes', 'No'];
const isYes = (v) => v === true || v === 'Yes' || v === 'yes' || v === 'true';

export const DELIMITERS = {
  'Line feed': '\n',
  'CRLF': '\r\n',
  'Space': ' ',
  'Comma': ',',
  'Semi-colon': ';',
  'Colon': ':',
  'Tab': '\t'
};
const DELIMITER_NAMES = Object.keys(DELIMITERS);

export function resolveDelimiter(name, label = 'Delimiter') {
  if (Object.prototype.hasOwnProperty.call(DELIMITERS, name)) return DELIMITERS[name];
  throw new Error(`${label} must be one of: ${DELIMITER_NAMES.join(', ')}.`);
}

export function choice(value, options, label) {
  if (!options.includes(value)) throw new Error(`${label} must be one of: ${options.join(', ')}.`);
  return value;
}

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const SEARCH_MODES = ['Simple string', 'Extended (\\n, \\t, \\x...)', 'Regex'];

/** Build a RegExp from a user pattern in one of SEARCH_MODES. */
export function buildRegex(pattern, mode, flags) {
  if (pattern === undefined || pattern === null || pattern === '') {
    throw new Error('The search pattern must not be empty.');
  }
  choice(mode, SEARCH_MODES, 'Search mode');
  let source;
  if (mode === 'Regex') source = String(pattern);
  else if (mode === 'Simple string') source = escapeRegex(String(pattern));
  else source = escapeRegex(unescapeShort(pattern));
  try {
    return new RegExp(source, flags);
  } catch (e) {
    throw new Error(`Invalid regular expression: ${e.message}`);
  }
}

const MAX_MATCHES = 200000;

function collectMatches(re, text) {
  const out = [];
  for (const m of text.matchAll(re)) {
    out.push(m);
    if (out.length > MAX_MATCHES) throw new Error(`More than ${MAX_MATCHES} matches; narrow the pattern.`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Find / Replace
// ---------------------------------------------------------------------------

export const findReplaceOperation = defineOp(
  {
    name: 'Find / Replace',
    id: 'find_replace',
    module: 'Text',
    description: 'Replaces occurrences of a string or regular expression. In Regex mode the replacement may use $1, $&, $<name>.',
    keywords: ['find', 'replace', 'substitute', 'regex', 'search', 'sub'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'find', label: 'Find', type: 'text', default: '' },
      { name: 'replace', label: 'Replace', type: 'text', default: '' },
      { name: 'mode', label: 'Find Mode', type: 'select', options: SEARCH_MODES, default: 'Simple string' },
      { name: 'global', label: 'Global match', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'ignoreCase', label: 'Case insensitive', type: 'select', options: YES_NO, default: 'No' },
      { name: 'multiline', label: 'Multiline (^ and $ match lines)', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'dotAll', label: 'Dot matches newline', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (input, a = {}) => {
    const { find = '', replace = '', mode = 'Simple string' } = a;
    if (find === '') throw new Error('"Find" must not be empty.');
    const flags = (isYes(a.global ?? 'Yes') ? 'g' : '') + (isYes(a.ignoreCase) ? 'i' : '') +
      (isYes(a.multiline ?? 'Yes') ? 'm' : '') + (isYes(a.dotAll) ? 's' : '');
    const re = buildRegex(find, mode, flags);
    if (mode === 'Regex') return input.replace(re, replace);
    const literal = mode === 'Extended (\\n, \\t, \\x...)' ? unescapeShort(replace) : replace;
    return input.replace(re, () => literal);
  }
);

// ---------------------------------------------------------------------------
// Regular expression
// ---------------------------------------------------------------------------

const REGEX_OUTPUTS = ['List matches', 'List capture groups', 'List matches with capture groups', 'Replace'];

export const regularExpressionOperation = defineOp(
  {
    name: 'Regular expression',
    id: 'regular_expression',
    module: 'Text',
    description: 'Runs a regular expression over the input and lists the matches, capture groups, or replaces them.',
    keywords: ['regex', 'regexp', 'match', 'groups', 'capture', 'extract', 'grep', 'replace'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'regex', label: 'Regex', type: 'text', default: '' },
      { name: 'ignoreCase', label: 'Case insensitive', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'multiline', label: 'Multiline (^ and $ match lines)', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'dotAll', label: 'Dot matches newline', type: 'select', options: YES_NO, default: 'No' },
      { name: 'unicode', label: 'Unicode mode', type: 'select', options: YES_NO, default: 'No' },
      { name: 'outputFormat', label: 'Output format', type: 'select', options: REGEX_OUTPUTS, default: 'List matches' },
      { name: 'replacement', label: 'Replacement (Replace mode)', type: 'text', default: '' },
      { name: 'displayTotal', label: 'Display total', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (input, a = {}) => {
    const { regex = '', outputFormat = 'List matches', replacement = '' } = a;
    choice(outputFormat, REGEX_OUTPUTS, 'Output format');
    if (regex === '') return input;
    const flags = 'g' + (isYes(a.ignoreCase ?? 'Yes') ? 'i' : '') + (isYes(a.multiline ?? 'Yes') ? 'm' : '') +
      (isYes(a.dotAll) ? 's' : '') + (isYes(a.unicode) ? 'u' : '');
    const re = buildRegex(regex, 'Regex', flags);
    if (outputFormat === 'Replace') return input.replace(re, replacement);
    const matches = collectMatches(re, input);
    const lines = [];
    for (const m of matches) {
      if (outputFormat === 'List matches') {
        lines.push(m[0]);
      } else if (outputFormat === 'List capture groups') {
        for (let g = 1; g < m.length; g++) if (m[g] !== undefined) lines.push(m[g]);
      } else {
        lines.push(m[0]);
        for (let g = 1; g < m.length; g++) lines.push(`  Group ${g}: ${m[g] === undefined ? '' : m[g]}`);
      }
    }
    const body = lines.join('\n');
    return isYes(a.displayTotal) ? `Total found: ${matches.length}\n\n${body}` : body;
  }
);

// ---------------------------------------------------------------------------
// Case
// ---------------------------------------------------------------------------

const CASE_SCOPES = ['All', 'Word', 'Sentence', 'Paragraph'];

export const toUpperCaseOperation = defineOp(
  {
    name: 'To Upper case',
    id: 'to_upper_case',
    module: 'Text',
    description: 'Converts text to upper case: all letters, the first letter of each word, sentence or paragraph.',
    keywords: ['uppercase', 'capitalize', 'title case', 'capital letters', 'case'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'scope', label: 'Scope', type: 'select', options: CASE_SCOPES, default: 'All' }]
  },
  async (input, { scope = 'All' } = {}) => {
    choice(scope, CASE_SCOPES, 'Scope');
    switch (scope) {
      case 'Word': return input.replace(/\b\w/g, (m) => m.toUpperCase());
      case 'Sentence': return input.toLowerCase().replace(/(^|[.!?]\s+)(\w)/g, (_, p, c) => p + c.toUpperCase());
      case 'Paragraph': return input.toLowerCase().replace(/(^|\n)(\w)/g, (_, p, c) => p + c.toUpperCase());
      default: return input.toUpperCase();
    }
  }
);

export const toLowerCaseOperation = defineOp(
  {
    name: 'To Lower case',
    id: 'to_lower_case',
    module: 'Text',
    description: 'Converts all letters to lower case.',
    keywords: ['lowercase', 'case', 'small letters'],
    inputType: 'string',
    outputType: 'string',
    args: []
  },
  async (input) => input.toLowerCase()
);

// ---------------------------------------------------------------------------
// Sort / Unique / Head / Tail
// ---------------------------------------------------------------------------

const SORT_ORDERS = ['Alphabetical (case sensitive)', 'Alphabetical (case insensitive)', 'IP address', 'Numeric'];

function ipKey(s) {
  const m = /^\s*(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\s*$/.exec(s);
  return m ? ((+m[1] * 256 + +m[2]) * 256 + +m[3]) * 256 + +m[4] : null;
}

export const sortOperation = defineOp(
  {
    name: 'Sort',
    id: 'sort',
    module: 'Text',
    description: 'Sorts delimited items alphabetically, numerically or by IPv4 address. Items that are not valid for the chosen order are placed last.',
    keywords: ['sort', 'order', 'alphabetical', 'numeric', 'ip', 'lines'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'delimiter', label: 'Delimiter', type: 'select', options: DELIMITER_NAMES, default: 'Line feed' },
      { name: 'reverse', label: 'Reverse', type: 'select', options: YES_NO, default: 'No' },
      { name: 'order', label: 'Order', type: 'select', options: SORT_ORDERS, default: SORT_ORDERS[0] }
    ]
  },
  async (input, { delimiter = 'Line feed', reverse = 'No', order = SORT_ORDERS[0] } = {}) => {
    const d = resolveDelimiter(delimiter);
    choice(order, SORT_ORDERS, 'Order');
    const items = input.split(d);
    let cmp;
    if (order === 'Alphabetical (case insensitive)') {
      cmp = (x, y) => { const a = x.toLowerCase(), b = y.toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; };
    } else if (order === 'IP address') {
      cmp = (x, y) => {
        const a = ipKey(x), b = ipKey(y);
        if (a === null && b === null) return 0;
        if (a === null) return 1;
        if (b === null) return -1;
        return a - b;
      };
    } else if (order === 'Numeric') {
      cmp = (x, y) => {
        const a = parseFloat(x), b = parseFloat(y);
        if (Number.isNaN(a) && Number.isNaN(b)) return 0;
        if (Number.isNaN(a)) return 1;
        if (Number.isNaN(b)) return -1;
        return a - b;
      };
    } else {
      cmp = (x, y) => (x < y ? -1 : x > y ? 1 : 0);
    }
    items.sort(cmp);
    if (isYes(reverse)) items.reverse();
    return items.join(d);
  }
);

export const uniqueOperation = defineOp(
  {
    name: 'Unique',
    id: 'unique',
    module: 'Text',
    description: 'Removes duplicate delimited items, keeping the first occurrence of each.',
    keywords: ['unique', 'dedupe', 'duplicates', 'distinct', 'uniq'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'delimiter', label: 'Delimiter', type: 'select', options: DELIMITER_NAMES, default: 'Line feed' },
      { name: 'displayCount', label: 'Display count only', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (input, { delimiter = 'Line feed', displayCount = 'No' } = {}) => {
    const d = resolveDelimiter(delimiter);
    const uniq = [...new Set(input.split(d))];
    return isYes(displayCount) ? `Total number of unique values: ${uniq.length}` : uniq.join(d);
  }
);

function headTailArgs() {
  return [
    { name: 'delimiter', label: 'Delimiter', type: 'select', options: DELIMITER_NAMES, default: 'Line feed' },
    { name: 'number', label: 'Number of items (negative = all but that many)', type: 'number', default: 10 }
  ];
}

export const headOperation = defineOp(
  {
    name: 'Head',
    id: 'head',
    module: 'Text',
    description: 'Keeps the first N delimited items. A negative N drops the last |N| items instead.',
    keywords: ['head', 'first', 'lines', 'top', 'limit', 'take'],
    inputType: 'string',
    outputType: 'string',
    args: headTailArgs()
  },
  async (input, { delimiter = 'Line feed', number = 10 } = {}) => {
    const d = resolveDelimiter(delimiter);
    const n = intArg(number, 'Number of items', -1e9, 1e9);
    const items = input.split(d);
    return (n >= 0 ? items.slice(0, n) : items.slice(0, items.length + n)).join(d);
  }
);

export const tailOperation = defineOp(
  {
    name: 'Tail',
    id: 'tail',
    module: 'Text',
    description: 'Keeps the last N delimited items. A negative N drops the first |N| items instead.',
    keywords: ['tail', 'last', 'lines', 'bottom', 'end'],
    inputType: 'string',
    outputType: 'string',
    args: headTailArgs()
  },
  async (input, { delimiter = 'Line feed', number = 10 } = {}) => {
    const d = resolveDelimiter(delimiter);
    const n = intArg(number, 'Number of items', -1e9, 1e9);
    const items = input.split(d);
    return (n >= 0 ? items.slice(Math.max(0, items.length - n)) : items.slice(-n)).join(d);
  }
);

// ---------------------------------------------------------------------------
// Whitespace / nulls / counting
// ---------------------------------------------------------------------------

export const removeWhitespaceOperation = defineOp(
  {
    name: 'Remove whitespace',
    id: 'remove_whitespace',
    module: 'Text',
    description: 'Strips selected whitespace characters and optionally full stops.',
    keywords: ['whitespace', 'spaces', 'tabs', 'newlines', 'strip', 'trim', 'clean'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'spaces', label: 'Spaces', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'carriageReturns', label: 'Carriage returns (\\r)', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'lineFeeds', label: 'Line feeds (\\n)', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'tabs', label: 'Tabs', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'formFeeds', label: 'Form feeds (\\f)', type: 'select', options: YES_NO, default: 'Yes' },
      { name: 'fullStops', label: 'Full stops', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (input, a = {}) => {
    let cls = '';
    if (isYes(a.spaces ?? 'Yes')) cls += ' ';
    if (isYes(a.carriageReturns ?? 'Yes')) cls += '\\r';
    if (isYes(a.lineFeeds ?? 'Yes')) cls += '\\n';
    if (isYes(a.tabs ?? 'Yes')) cls += '\\t';
    if (isYes(a.formFeeds ?? 'Yes')) cls += '\\f';
    if (isYes(a.fullStops)) cls += '.';
    if (!cls) return input;
    return input.replace(new RegExp(`[${cls}]`, 'g'), '');
  }
);

export const removeNullBytesOperation = defineOp(
  {
    name: 'Remove null bytes',
    id: 'remove_null_bytes',
    module: 'Text',
    description: 'Removes all 0x00 bytes from the input (for example UTF-16 text read as bytes).',
    keywords: ['null', 'nul', '0x00', 'zero bytes', 'strip', 'utf-16'],
    inputType: 'Dish',
    outputType: 'string',
    args: []
  },
  async (dish) => {
    const bytes = (dish instanceof Dish ? dish : new Dish(dish)).toUint8Array();
    const out = new Uint8Array(bytes.length);
    let n = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) out[n++] = bytes[i];
    return Dish.fromBytes(out.slice(0, n));
  }
);

export const countOccurrencesOperation = defineOp(
  {
    name: 'Count occurrences',
    id: 'count_occurrences',
    module: 'Text',
    description: 'Counts how many times a string or regular expression matches in the input.',
    keywords: ['count', 'occurrences', 'frequency', 'tally', 'matches'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'search', label: 'Search', type: 'text', default: '' },
      { name: 'mode', label: 'Search Mode', type: 'select', options: SEARCH_MODES, default: 'Simple string' }
    ]
  },
  async (input, { search = '', mode = 'Simple string' } = {}) => {
    const re = buildRegex(search, mode, 'g');
    return String(collectMatches(re, input).filter((m) => m[0].length > 0).length);
  }
);

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const STRING_ENCODINGS = ['Single byte', '16-bit little endian', '16-bit big endian'];
const STRING_CLASSES = ['Printable ASCII (0x20-0x7E)', 'Printable ASCII + tab/CR/LF', 'Alphanumeric only'];

export function extractStrings(bytes, { encoding = 'Single byte', minLength = 4, charClass = STRING_CLASSES[0] } = {}) {
  const wide = encoding !== 'Single byte';
  const step = wide ? 2 : 1;
  const test = charClass === STRING_CLASSES[2]
    ? (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    : charClass === STRING_CLASSES[1]
      ? (c) => (c >= 32 && c <= 126) || c === 9 || c === 10 || c === 13
      : (c) => c >= 32 && c <= 126;
  const found = [];
  let cur = '';
  let start = 0;
  const flush = () => { if (cur.length >= minLength) found.push({ offset: start, text: cur }); cur = ''; };
  for (let i = 0; i + step <= bytes.length; i += step) {
    let c = bytes[i];
    if (wide) c = encoding === '16-bit little endian' ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
    if (test(c)) {
      if (cur === '') start = i;
      cur += String.fromCharCode(c);
    } else {
      flush();
    }
  }
  flush();
  return found;
}

export const stringsOperation = defineOp(
  {
    name: 'Strings',
    id: 'strings',
    module: 'Text',
    description: 'Extracts printable strings from binary data (like the Unix strings tool), including UTF-16 text.',
    keywords: ['strings', 'extract', 'printable', 'ascii', 'binary', 'utf-16', 'forensics'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'encoding', label: 'Encoding', type: 'select', options: STRING_ENCODINGS, default: 'Single byte' },
      { name: 'minLength', label: 'Minimum length', type: 'number', default: 4 },
      { name: 'charClass', label: 'Characters', type: 'select', options: STRING_CLASSES, default: STRING_CLASSES[0] },
      { name: 'showOffsets', label: 'Show offsets', type: 'select', options: YES_NO, default: 'No' },
      { name: 'unique', label: 'Unique only', type: 'select', options: YES_NO, default: 'No' },
      { name: 'sort', label: 'Sort', type: 'select', options: YES_NO, default: 'No' },
      { name: 'displayTotal', label: 'Display total', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (dish, a = {}) => {
    const encoding = choice(a.encoding ?? 'Single byte', STRING_ENCODINGS, 'Encoding');
    const charClass = choice(a.charClass ?? STRING_CLASSES[0], STRING_CLASSES, 'Characters');
    const minLength = intArg(a.minLength ?? 4, 'Minimum length', 1, 100000);
    const bytes = (dish instanceof Dish ? dish : new Dish(dish)).toUint8Array();
    let found = extractStrings(bytes, { encoding, minLength, charClass });
    if (isYes(a.unique)) {
      const seen = new Set();
      found = found.filter((f) => (seen.has(f.text) ? false : seen.add(f.text)));
    }
    if (isYes(a.sort)) found = [...found].sort((x, y) => (x.text < y.text ? -1 : x.text > y.text ? 1 : 0));
    const lines = found.map((f) => (isYes(a.showOffsets) ? `0x${f.offset.toString(16).padStart(8, '0')}: ${f.text}` : f.text));
    const body = lines.join('\n');
    return isYes(a.displayTotal) ? `Total found: ${found.length}\n\n${body}` : body;
  }
);

// ---------------------------------------------------------------------------
// Swap endianness / Reverse / line numbers
// ---------------------------------------------------------------------------

export function swapEndianness(bytes, wordLength, pad) {
  const out = new Uint8Array(pad ? Math.ceil(bytes.length / wordLength) * wordLength : bytes.length);
  out.set(bytes);
  const full = pad ? out.length : Math.floor(bytes.length / wordLength) * wordLength;
  for (let i = 0; i < full; i += wordLength) out.subarray(i, i + wordLength).reverse();
  return out;
}

export const swapEndiannessOperation = defineOp(
  {
    name: 'Swap endianness',
    id: 'swap_endianness',
    module: 'Text',
    description: 'Reverses the byte order inside each fixed-size word. A trailing partial word is left unchanged unless padding is enabled.',
    keywords: ['endianness', 'byte order', 'little endian', 'big endian', 'bswap', 'word', 'swap'],
    inputType: 'Dish',
    outputType: 'string',
    args: [
      { name: 'dataFormat', label: 'Data format', type: 'select', options: ['Hex', 'Raw'], default: 'Hex' },
      { name: 'wordLength', label: 'Word length (bytes)', type: 'number', default: 4 },
      { name: 'padIncomplete', label: 'Pad incomplete word with zeros', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (dish, { dataFormat = 'Hex', wordLength = 4, padIncomplete = 'No' } = {}) => {
    choice(dataFormat, ['Hex', 'Raw'], 'Data format');
    const wl = intArg(wordLength, 'Word length', 1, 1024);
    const d = dish instanceof Dish ? dish : new Dish(dish);
    if (dataFormat === 'Hex') {
      const bytes = hexToBytes(d.toString(), 'Input');
      return bytesToHex(swapEndianness(bytes, wl, isYes(padIncomplete)));
    }
    return Dish.fromBytes(swapEndianness(d.toUint8Array(), wl, isYes(padIncomplete)));
  }
);

const REVERSE_MODES = ['Character', 'Byte', 'Line'];

export const reverseOperation = defineOp(
  {
    name: 'Reverse',
    id: 'reverse',
    module: 'Text',
    description: 'Reverses the input by character, by byte, or the order of its lines.',
    keywords: ['reverse', 'flip', 'backwards', 'mirror'],
    inputType: 'Dish',
    outputType: 'string',
    args: [{ name: 'by', label: 'Reverse by', type: 'select', options: REVERSE_MODES, default: 'Character' }]
  },
  async (dish, { by = 'Character' } = {}) => {
    choice(by, REVERSE_MODES, 'Reverse by');
    const d = dish instanceof Dish ? dish : new Dish(dish);
    if (by === 'Byte') return Dish.fromBytes(d.toUint8Array().slice().reverse());
    if (by === 'Line') return d.toString().split(/\r?\n/).reverse().join('\n');
    return Array.from(d.toString()).reverse().join('');
  }
);

export const addLineNumbersOperation = defineOp(
  {
    name: 'Add line numbers',
    id: 'add_line_numbers',
    module: 'Text',
    description: 'Prefixes every line with its right-aligned line number.',
    keywords: ['line numbers', 'number lines', 'nl', 'cat -n'],
    inputType: 'string',
    outputType: 'string',
    args: [{ name: 'offset', label: 'Offset (first line number minus one)', type: 'number', default: 0 }]
  },
  async (input, { offset = 0 } = {}) => {
    const off = intArg(offset, 'Offset', -1e9, 1e9);
    const lines = input.split('\n');
    const width = String(lines.length + off).length;
    return lines.map((l, i) => `${String(i + 1 + off).padStart(width, ' ')} ${l}`).join('\n');
  }
);

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const DIFF_MODES = ['Character', 'Word', 'Line'];
const MAX_DIFF_CELLS = 4000000;

function tokenize(text, by) {
  if (by === 'Line') return text.split('\n');
  if (by === 'Word') return text.split(/(\s+)/).filter((t) => t !== '');
  return Array.from(text);
}

/** LCS-based diff returning [{type:'same'|'del'|'add', text}]. */
export function diffTokens(a, b, eq = (x, y) => x === y) {
  let pre = 0;
  while (pre < a.length && pre < b.length && eq(a[pre], b[pre])) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && eq(a[a.length - 1 - suf], b[b.length - 1 - suf])) suf++;
  const A = a.slice(pre, a.length - suf);
  const B = b.slice(pre, b.length - suf);
  const n = A.length, m = B.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) throw new Error('The two samples differ too much to diff at this granularity. Try diffing by line or word.');
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * w + j] = eq(A[i], B[j]) ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    }
  }
  const ops = a.slice(0, pre).map((t) => ({ type: 'same', text: t }));
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (eq(A[i], B[j])) { ops.push({ type: 'same', text: A[i] }); i++; j++; }
    else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push({ type: 'del', text: A[i++] }); }
    else { ops.push({ type: 'add', text: B[j++] }); }
  }
  while (i < n) ops.push({ type: 'del', text: A[i++] });
  while (j < m) ops.push({ type: 'add', text: B[j++] });
  for (const t of a.slice(a.length - suf)) ops.push({ type: 'same', text: t });
  return ops;
}

export const diffOperation = defineOp(
  {
    name: 'Diff',
    id: 'diff',
    module: 'Text',
    description: 'Compares two samples separated by a delimiter. Line mode prefixes lines with "- ", "+ " or two spaces; other modes mark removals as [-text-] and additions as {+text+}.',
    keywords: ['diff', 'compare', 'difference', 'changes', 'patch'],
    inputType: 'string',
    outputType: 'string',
    args: [
      { name: 'sampleDelimiter', label: 'Sample delimiter', type: 'text', default: '\\n\\n' },
      { name: 'diffBy', label: 'Difference by', type: 'select', options: DIFF_MODES, default: 'Line' },
      { name: 'ignoreWhitespace', label: 'Ignore whitespace differences', type: 'select', options: YES_NO, default: 'No' }
    ]
  },
  async (input, { sampleDelimiter = '\\n\\n', diffBy = 'Line', ignoreWhitespace = 'No' } = {}) => {
    choice(diffBy, DIFF_MODES, 'Difference by');
    const delim = unescapeShort(sampleDelimiter);
    if (delim === '') throw new Error('Sample delimiter must not be empty.');
    const at = input.indexOf(delim);
    if (at < 0) throw new Error('Input must contain two samples separated by the sample delimiter.');
    const left = input.slice(0, at);
    const right = input.slice(at + delim.length);
    const norm = isYes(ignoreWhitespace) ? (s) => s.replace(/\s+/g, ' ').trim() : (s) => s;
    const ops = diffTokens(tokenize(left, diffBy), tokenize(right, diffBy), (x, y) => norm(x) === norm(y));
    if (diffBy === 'Line') {
      return ops.map((o) => (o.type === 'same' ? '  ' : o.type === 'del' ? '- ' : '+ ') + o.text).join('\n');
    }
    let out = '';
    let kind = null;
    let buf = '';
    const flush = () => {
      if (!buf) return;
      out += kind === 'del' ? `[-${buf}-]` : kind === 'add' ? `{+${buf}+}` : buf;
      buf = '';
    };
    for (const o of ops) {
      if (o.type !== kind) { flush(); kind = o.type; }
      buf += o.text;
    }
    flush();
    return out;
  }
);

export const textOperations = [
  findReplaceOperation, regularExpressionOperation, toUpperCaseOperation, toLowerCaseOperation,
  sortOperation, uniqueOperation, headOperation, tailOperation,
  removeWhitespaceOperation, removeNullBytesOperation, countOccurrencesOperation, stringsOperation,
  swapEndiannessOperation, reverseOperation, addLineNumbersOperation, diffOperation
];

export default textOperations;
