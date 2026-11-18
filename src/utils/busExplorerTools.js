/**
 * Pure helpers for the Bus Explorer: i2ctransfer-style parsing, hex dumps,
 * dump diffing, i2cdetect-style output and SPI mode mapping.
 */

const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();

export const SPI_MODES = [
  { value: 0, label: 'Mode 0 (CPOL 0, CPHA 0)' },
  { value: 1, label: 'Mode 1 (CPOL 0, CPHA 1)' },
  { value: 2, label: 'Mode 2 (CPOL 1, CPHA 0)' },
  { value: 3, label: 'Mode 3 (CPOL 1, CPHA 1)' }
];

/** Bus Pirate raw-SPI flags for an SPI mode: CKE=1 means data changes on the active-to-idle edge (CPHA 0). */
export function spiModeToConfig(mode) {
  const m = Number(mode) & 3;
  return { push: true, idleHigh: (m & 2) !== 0, edge: (m & 1) === 0, sampleEnd: false };
}

export function parseHexByte(text) {
  const t = String(text).trim().replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,2}$/i.test(t)) return NaN;
  return parseInt(t, 16);
}

/** Parse "9F 00 00", "0x9f,0x00" or "9f0000" into bytes. Throws on odd or invalid input. */
export function parseHexBytes(text) {
  const tokens = String(text).split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const tok of tokens) {
    const t = tok.replace(/^0x/i, '');
    if (!/^[0-9a-f]+$/i.test(t) || t.length % 2) throw new Error(`"${tok}" is not whole hex bytes.`);
    for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
  }
  return out;
}

function parseAddr(text) {
  const a = text.toLowerCase();
  if (a.startsWith('0x')) return parseInt(a, 16);
  return parseInt(a, 16);
}

/**
 * i2ctransfer-style script. Messages: `w<N>@<addr> b0 b1 ...` and `r<N>[@<addr>]`.
 * The address (hex) may be omitted after the first message. A `w` takes the bytes that
 * follow it; N is optional for w but checked if given.
 * Example: "w1@0x68 0x75 r1" = write pointer 0x75, repeated START, read 1 byte.
 * Returns { addr, ops: [{ type: 'w', bytes } | { type: 'r', count }] }.
 */
export function parseI2cTransfer(text) {
  const tokens = String(text).trim().split(/[\s,]+/).filter(Boolean);
  if (!tokens.length) throw new Error('Enter a transfer such as: w1@0x68 0x75 r1');
  const ops = [];
  let addr = null;
  let cur = null;
  const finishWrite = () => {
    if (cur && cur.declared != null && cur.declared !== cur.bytes.length) {
      throw new Error(`w${cur.declared} was followed by ${cur.bytes.length} byte(s).`);
    }
    cur = null;
  };
  for (const tok of tokens) {
    const m = /^([wr])(\d*)(?:@(0x[0-9a-f]+|[0-9a-f]{1,2}))?$/i.exec(tok);
    if (m) {
      finishWrite();
      const kind = m[1].toLowerCase();
      if (m[3] !== undefined) {
        const a = parseAddr(m[3]);
        if (!(a >= 0x03 && a <= 0x77)) throw new Error(`Address ${m[3]} is outside the 7-bit range 0x03-0x77.`);
        addr = a;
      }
      if (kind === 'r') {
        const n = m[2] === '' ? 1 : Number(m[2]);
        if (!(n >= 1 && n <= 256)) throw new Error('Read length must be 1 to 256.');
        ops.push({ type: 'r', count: n });
      } else {
        cur = { type: 'w', bytes: [], declared: m[2] === '' ? null : Number(m[2]) };
        ops.push(cur);
      }
      continue;
    }
    if (!cur) throw new Error(`"${tok}" is not a message. Start with w<N>@<addr> or r<N>@<addr>.`);
    const v = parseHexByte(tok);
    if (Number.isNaN(v)) throw new Error(`"${tok}" is not a hex byte.`);
    cur.bytes.push(v);
  }
  finishWrite();
  if (addr == null) throw new Error('Give a device address, e.g. w1@0x68.');
  if (ops.length > 16) throw new Error('At most 16 messages per transfer.');
  return { addr, ops: ops.map((o) => (o.type === 'w' ? { type: 'w', bytes: o.bytes } : o)) };
}

export function formatBytes(bytes) {
  return Array.from(bytes, hex2).join(' ');
}

/** i2cdump-style listing: offset, 16 hex columns, ASCII column. */
export function formatHexDump(bytes, start = 0) {
  const lines = ['     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f    0123456789abcdef'];
  const first = start - (start % 16);
  for (let row = first; row < start + bytes.length; row += 16) {
    let hex = '';
    let asc = '';
    for (let i = 0; i < 16; i++) {
      const idx = row + i - start;
      if (idx < 0 || idx >= bytes.length) { hex += ' --'; asc += ' '; continue; }
      const v = bytes[idx];
      hex += ' ' + hex2(v).toLowerCase();
      asc += v >= 0x20 && v < 0x7f ? String.fromCharCode(v) : '.';
    }
    lines.push(`${hex2(row).toLowerCase()}:${hex}    ${asc}`);
  }
  return lines.join('\n');
}

/** Indices where `next` differs from `prev` (empty when there is no previous dump). */
export function diffDumps(prev, next) {
  if (!prev) return [];
  const out = [];
  for (let i = 0; i < next.length; i++) if (prev[i] !== next[i]) out.push(i);
  return out;
}

/** Output in the same layout as `i2cdetect -y`. */
export function formatI2cdetect(found) {
  const set = new Set(found);
  const lines = ['     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f'];
  for (let row = 0; row < 8; row++) {
    let line = `${row}0:`;
    for (let col = 0; col < 16; col++) {
      const a = row * 16 + col;
      if (a < 0x03 || a > 0x77) line += '   ';
      else line += set.has(a) ? ' ' + hex2(a).toLowerCase() : ' --';
    }
    lines.push(line);
  }
  return lines.join('\n');
}
