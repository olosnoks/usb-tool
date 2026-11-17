// Python text-formatting helpers for the usb-rea port. The generators (report, scaffold, dissector) must
// print exactly what the Python originals printed: f-string specs (:g, :.0%, :02x, !r), repr() of
// str/list/tuple/dict/float, and banker's rounding.

/** Marks a JS number that Python holds as a float, so repr prints 1.0 and not 1. */
export class PyFloat {
  constructor(v) { this.v = v; }
  valueOf() { return this.v; }
}
export function pyfloat(v) { return v === null || v === undefined ? null : new PyFloat(Number(v)); }

/** Marks an array that Python holds as a tuple (repr uses parentheses). */
export class PyTuple extends Array {}
export function pytuple(arr) {
  if (arr === null || arr === undefined) return null;
  const t = new PyTuple();
  for (const x of arr) t.push(x);
  return t;
}

// ---- digit rounding (exact, round half to even like CPython's float formatting) ----

/** Round a digit string to n significant digits, half-even on exact ties. Returns {digits, carry}. */
function roundDigits(digits, n) {
  const head = digits.slice(0, n).padEnd(n, '0');
  const rest = digits.slice(n);
  if (rest === '') return { digits: head, carry: false };
  const up = rest[0] > '5' || (rest[0] === '5' && (/[1-9]/.test(rest.slice(1)) || (head.charCodeAt(n - 1) - 48) % 2 === 1));
  if (!up) return { digits: head, carry: false };
  const inc = (BigInt(head) + 1n).toString().padStart(n, '0');
  if (inc.length > n) return { digits: inc.slice(1), carry: true };
  return { digits: inc, carry: false };
}

/** Decimal digits of a positive finite double as d1d2d3... with value d1.d2d3... x 10^exp. */
function sci(ax) {
  const [m, e] = ax.toExponential(100).split('e');
  return { digits: m.replace('.', ''), exp: Number(e) };
}

function negative(x) { return x < 0 || Object.is(x, -0); }

/** f"{x:.{nd}f}" */
export function fmt_fixed(x, nd = 6) {
  x = Number(x);
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const sign = negative(x) ? '-' : '';
  const ax = Math.abs(x);
  let ip, fp;
  if (ax >= 1e21) { ip = BigInt(ax).toString(); fp = '0'.repeat(nd + 5); }
  else { [ip, fp = ''] = ax.toFixed(Math.min(100, nd + 60)).split('.'); }
  const r = roundDigits(ip + fp, ip.length + nd);
  const il = ip.length + (r.carry ? 1 : 0);
  const d = r.carry ? '1' + r.digits : r.digits;
  return sign + d.slice(0, il) + (nd > 0 ? '.' + d.slice(il, il + nd) : '');
}

/** f"{x:.{nd}%}" (usb-rea uses .0%) */
export function fmt_pct(x, nd = 0) { return fmt_fixed(Number(x) * 100, nd) + '%'; }

/** f"{x:g}" (precision p, default 6). */
export function fmt_g(x, p = 6) {
  x = Number(x);
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (p === 0) p = 1;
  const sign = negative(x) ? '-' : '';
  if (x === 0) return sign + '0';
  let { digits, exp } = sci(Math.abs(x));
  const r = roundDigits(digits, p);
  digits = r.digits;
  if (r.carry) { digits = '1' + '0'.repeat(p - 1); exp += 1; }
  if (exp < -4 || exp >= p) {
    const rest = digits.slice(1).replace(/0+$/, '');
    const ae = Math.abs(exp);
    return `${sign}${digits[0]}${rest ? '.' + rest : ''}e${exp < 0 ? '-' : '+'}${ae < 10 ? '0' : ''}${ae}`;
  }
  let ip, fp;
  if (exp >= 0) { ip = digits.slice(0, exp + 1); fp = digits.slice(exp + 1); }
  else { ip = '0'; fp = '0'.repeat(-exp - 1) + digits; }
  fp = fp.replace(/0+$/, '');
  return sign + ip + (fp ? '.' + fp : '');
}

/** f"{n:0{width}x}" for an integer. */
export function fmt_hex(n, width = 0) {
  const b = BigInt(n);
  const s = (b < 0n ? -b : b).toString(16);
  if (b < 0n) return '-' + s.padStart(Math.max(0, width - 1), '0');
  return s.padStart(width, '0');
}

/** repr(float) / str(float): shortest round-trip digits, Python's exponent switch (e < -4 or e >= 16). */
export function py_float_str(x) {
  x = Number(x);
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  const sign = negative(x) ? '-' : '';
  if (x === 0) return sign + '0.0';
  const [m, e] = Math.abs(x).toExponential().split('e');
  const digits = m.replace('.', '');
  const exp = Number(e);
  if (exp < -4 || exp >= 16) {
    const rest = digits.slice(1);
    const ae = Math.abs(exp);
    return `${sign}${digits[0]}${rest ? '.' + rest : ''}e${exp < 0 ? '-' : '+'}${ae < 10 ? '0' : ''}${ae}`;
  }
  let ip, fp;
  if (exp >= 0) { ip = digits.slice(0, exp + 1).padEnd(exp + 1, '0'); fp = digits.slice(exp + 1); }
  else { ip = '0'; fp = '0'.repeat(-exp - 1) + digits; }
  return sign + ip + '.' + (fp || '0');
}

/** round(x) with Python 3 semantics: half to even, returns an integer. */
export function py_round(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** repr(str) */
export function py_str_repr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === q) out += '\\' + q;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && /[\p{Z}\p{C}]/u.test(ch)) {
      out += cp < 0x100 ? '\\x' + cp.toString(16).padStart(2, '0')
        : cp < 0x10000 ? '\\u' + cp.toString(16).padStart(4, '0')
          : '\\U' + cp.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + q;
}

/** repr(bytes) */
export function py_bytes_repr(b) {
  const q = b.includes(0x27) && !b.includes(0x22) ? '"' : "'";
  let out = 'b' + q;
  for (const c of b) {
    if (c === 0x5c) out += '\\\\';
    else if (c === q.charCodeAt(0)) out += '\\' + q;
    else if (c === 10) out += '\\n';
    else if (c === 13) out += '\\r';
    else if (c === 9) out += '\\t';
    else if (c < 0x20 || c >= 0x7f) out += '\\x' + c.toString(16).padStart(2, '0');
    else out += String.fromCharCode(c);
  }
  return out + q;
}

/**
 * repr() of a value. A JS number prints as int when integral, else as float; wrap a float that may be
 * integral with pyfloat(). pytuple() makes a tuple, Map a dict with any keys (insertion order kept),
 * a plain object a dict with string keys, Uint8Array bytes.
 */
export function py_repr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof PyFloat) return py_float_str(v.v);
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : py_float_str(v);
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return py_str_repr(v);
  if (v instanceof Uint8Array) return py_bytes_repr(v);
  if (v instanceof PyTuple) return '(' + v.map(py_repr).join(', ') + (v.length === 1 ? ',' : '') + ')';
  if (Array.isArray(v)) return '[' + v.map(py_repr).join(', ') + ']';
  if (v instanceof Map) return '{' + [...v].map(([k, x]) => `${py_repr(k)}: ${py_repr(x)}`).join(', ') + '}';
  if (typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => `${py_str_repr(k)}: ${py_repr(x)}`).join(', ') + '}';
  return String(v);
}

/** Entries of a Python dict held as a Map or a plain object (numeric-looking keys of a plain object become numbers). */
export function dict_items(d) {
  if (d instanceof Map) return [...d];
  return Object.entries(d).map(([k, v]) => [/^-?\d+(\.\d+)?$/.test(k) ? Number(k) : k, v]);
}

/** Entries of a dict whose keys are strings (e.g. hex strings): a Map or a plain object, keys left as text. */
export function dict_entries(d) {
  return d instanceof Map ? [...d] : Object.entries(d);
}

/** str.format() with only named {field} placeholders and {{ }} escapes; values are inserted verbatim. */
export function py_format(tpl, vars) {
  return tpl.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, k) => (m === '{{' ? '{' : m === '}}' ? '}' : String(vars[k])));
}
