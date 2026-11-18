import React, { useMemo, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import {
  WIDTHS, parseNumber, parseDecimal, analyzeNumber, hexOf, toUnsigned, toSigned,
  toggleBit, getBit, parseFieldSpec, getField, setField, fieldMax, fieldMask, genCMacros,
  FLOAT_FORMATS, floatFormat, decodeFloat, encodeFloat, floatFromBytes, floatSpecials,
  parseHexBytes, parseQFormat, qInfo, qFromRaw, qFromReal, bitwiseOp, inspectBytes,
  reverseBits, toggleFloatBit, floatNeighbors, evalExpression,
} from '../../utils/bitConverter.js';

/**
 * Bits & Numbers converter for firmware and register work. Fully offline: every result is
 * computed in the browser from what you type. Tabs: Number, Bits & fields, Float,
 * Fixed-point (Q format), Data view and Bitwise.
 */

const TABS = [
  ['calc', 'Calc'],
  ['number', 'Number'],
  ['bits', 'Bits & fields'],
  ['float', 'Float'],
  ['fixed', 'Fixed-point'],
  ['data', 'Data view'],
  ['bitwise', 'Bitwise'],
];

const BITWISE_OPTIONS = [
  ['and', 'A AND B'], ['or', 'A OR B'], ['xor', 'A XOR B'], ['not', 'NOT A'],
  ['shl', 'A << B (SHL)'], ['shr', 'A >> B (SHR, logical)'], ['sar', 'A >> B (SAR, arithmetic)'],
  ['rol', 'rotate A left by B'], ['ror', 'rotate A right by B'],
];

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-700';
const selectCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-gray-200';
const btnCls = 'px-2 py-1 text-xs rounded border border-slate-700 text-slate-300 hover:border-cyan-700 hover:text-cyan-300';

const hexBytes = (bytes) => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

function copyText(text) {
  try {
    navigator.clipboard?.writeText(String(text)).catch(() => {});
  } catch {
    /* clipboard not available */
  }
}

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      className="text-slate-600 hover:text-cyan-400 shrink-0"
      onClick={() => {
        copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 900);
      }}
    >
      {done ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function KV({ k, v, copyable = true }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5 border-b border-slate-900 last:border-0">
      <span className="text-slate-500 text-xs shrink-0">{k}</span>
      <span className="flex items-center gap-1.5 font-mono text-xs text-gray-200 break-all text-right">
        {String(v)}
        {copyable && <CopyBtn text={v} label={`Copy ${k}`} />}
      </span>
    </div>
  );
}

const H = ({ children }) => <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-3 mb-1">{children}</div>;
const Err = ({ children }) => (
  <div className="p-2 mt-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{children}</div>
);
const Note = ({ children }) => <div className="text-xs text-slate-500 mt-1">{children}</div>;

/**
 * Text input that commits a parsed value on every valid keystroke. While the user types it
 * keeps its own draft, so "0x" prefixes and partial values do not fight the controlled value.
 * parse(text) must return { ok, value } or { ok: false, error }.
 */
function NumInput({ shown, parse, onCommit, className = '', ...rest }) {
  const [draft, setDraft] = useState(null);
  const text = draft ?? shown;
  const bad = draft !== null && !parse(draft).ok;
  return (
    <input
      {...rest}
      value={text}
      spellCheck={false}
      aria-invalid={bad}
      onChange={(e) => {
        setDraft(e.target.value);
        const r = parse(e.target.value);
        if (r.ok) onCommit(r.value);
      }}
      onBlur={() => setDraft(null)}
      className={`${inputCls} ${bad ? 'border-red-800' : ''} ${className}`}
    />
  );
}

function parseInRange(text, lo, hi) {
  const p = parseNumber(text);
  if (!p.ok) return p;
  if (p.value < lo || p.value > hi) return { ok: false, error: `Must be between ${lo} and ${hi}` };
  return { ok: true, value: p.value };
}

/* ------------------------------------------------------------------- Number */

function NumberTab({ width }) {
  const [text, setText] = useState('0xDEADBEEF');
  const a = useMemo(() => analyzeNumber(text, width), [text, width]);
  return (
    <div>
      <label className="block text-xs text-slate-400">
        Number: 0x hex, 0b binary, 0o octal, decimal, negative, underscores allowed
        <input
          className={`${inputCls} w-full mt-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Number input"
        />
      </label>
      {!a.ok ? (
        <Err>{a.error}</Err>
      ) : (
        <>
          {a.truncated && (
            <div className="text-xs text-amber-300 mt-2">
              The value does not fit in {width} bits. The {width}-bit views show the low {width} bits.
            </div>
          )}
          <H>Radix at {width} bits</H>
          <KV k="hex" v={a.hex} />
          <KV k="unsigned" v={a.unsigned.toString()} />
          <KV k="signed" v={a.signed.toString()} />
          <KV k="octal" v={a.oct} />
          <KV k="binary" v={a.bin} />

          <H>Interpretations by width (two&apos;s complement)</H>
          <div className="font-mono text-xs">
            <div className="grid grid-cols-[2.5rem_1fr_1fr_1fr] @md:grid-cols-[4rem_1fr_1fr_1fr] gap-2 text-slate-500 pb-1 border-b border-slate-800">
              <span>bits</span><span>unsigned</span><span>signed</span><span>hex</span>
            </div>
            {a.widths.map((w) => (
              <div key={w.width} className="grid grid-cols-[2.5rem_1fr_1fr_1fr] @md:grid-cols-[4rem_1fr_1fr_1fr] gap-2 py-0.5 border-b border-slate-900 text-gray-200 break-all">
                <span className="text-slate-400">{w.width}</span>
                <span>{w.unsigned.toString()}</span>
                <span>{w.signed.toString()}</span>
                <span>{w.hex}</span>
              </div>
            ))}
          </div>

          <H>Byte order</H>
          <KV k="bytes, big-endian" v={hexBytes(a.bytesBE)} />
          <KV k="bytes, little-endian" v={hexBytes(a.bytesLE)} />
          <KV k="byte-swapped value" v={`${a.swapped.toString()} (${a.swappedHex})`} />
          <KV k="bit-reversed value" v={hexOf(reverseBits(a.unsigned, width), width)} />
          <KV k="ASCII view (big-endian)" v={`"${a.ascii}"`} />

          <H>Bit counts</H>
          <KV k="population count (ones)" v={a.popcount} copyable={false} />
          <KV k="bit length" v={a.bitLength} copyable={false} />
          <KV k="leading zeros" v={a.leadingZeros} copyable={false} />
          <KV k="trailing zeros" v={a.trailingZeros} copyable={false} />
          <KV k="next power of 2" v={`${a.nextPow2.toString()} (${hexOf(a.nextPow2, width)})`} />
          {!a.nextPow2Fits && (
            <Note>The next power of 2 does not fit in {width} bits.</Note>
          )}
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------- Calc */

function CalcTab({ width }) {
  const [text, setText] = useState('(0xF0 | 0x0F) & ~(1 << 3)');
  const [hist, setHist] = useState([]);
  const r = useMemo(() => evalExpression(text, width), [text, width]);
  return (
    <div>
      <label className="block text-xs text-slate-400">
        C-style integer expression: + - * / % &lt;&lt; &gt;&gt; &amp; | ^ ~ ( ), literals 0x 0b 0o decimal
        <input
          className={`${inputCls} w-full mt-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && r.ok) setHist((h) => [{ text, hex: hexOf(r.value, width) }, ...h.filter((x) => x.text !== text)].slice(0, 8));
          }}
          spellCheck={false}
          aria-label="Expression"
        />
      </label>
      {!r.ok ? <Err>{r.error}</Err> : (
        <>
          {r.wrapped && <div className="text-xs text-amber-300 mt-1.5">The exact result does not fit {width} bits; showing the wrapped value (exact: {r.raw.toString()}).</div>}
          <H>Result at {width} bits (Enter saves to history)</H>
          <KV k="hex" v={hexOf(r.value, width)} />
          <KV k="unsigned" v={r.value.toString()} />
          <KV k="signed" v={r.signed.toString()} />
          <KV k="binary" v={'0b' + r.value.toString(2).padStart(width, '0')} />
          <KV k="octal" v={'0o' + r.value.toString(8)} />
        </>
      )}
      {hist.length > 0 && (
        <>
          <H>History</H>
          <div className="flex flex-wrap gap-1.5">
            {hist.map((h) => (
              <button key={h.text} type="button" className={`${btnCls} font-mono`} title="Load this expression" onClick={() => setText(h.text)}>
                {h.text} = {h.hex}
              </button>
            ))}
          </div>
        </>
      )}
      <Note>Math is exact, then wrapped to the width like C unsigned arithmetic. Division truncates toward zero. Precedence follows C.</Note>
    </div>
  );
}

/* ------------------------------------------------------------- Bits & fields */

const DEFAULT_FIELDS = 'EN[0] MODE[3:1] DIV[11:4]';

function FieldRow({ field, value, onCommit }) {
  const max = fieldMax(field);
  const parse = (t) => parseInRange(t, 0n, max);
  return (
    <div className="grid grid-cols-[4rem_3.5rem_1fr] @md:grid-cols-[6rem_5rem_1fr_7rem_6rem] gap-2 items-center py-1 border-b border-slate-900 font-mono text-xs">
      <span className="text-cyan-300">{field.name}</span>
      <span className="text-slate-400">[{field.msb}:{field.lsb}]</span>
      <NumInput
        aria-label={`${field.name} value`}
        shown={getField(value, field).toString()}
        parse={parse}
        onCommit={onCommit}
        className="w-full py-1"
      />
      <span className="hidden @md:inline text-slate-400 break-all">{hexOf(getField(value, field), field.width)}</span>
      <span className="hidden @md:inline text-slate-500 break-all">mask 0x{fieldMask(field).toString(16).toUpperCase()}</span>
    </div>
  );
}

function BitsTab({ width }) {
  const [reg, setReg] = useState(0n);
  const value = toUnsigned(reg, width);
  const [fieldText, setFieldText] = useState(DEFAULT_FIELDS);
  const [prefix, setPrefix] = useState('REG');
  const parsed = useMemo(() => parseFieldSpec(fieldText, width), [fieldText, width]);
  const modLo = -(1n << BigInt(width - 1));
  const modHi = (1n << BigInt(width)) - 1n;
  const nibbles = [];
  for (let hi = width - 4; hi >= 0; hi -= 4) nibbles.push(hi);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">
          Register value (hex or decimal)
          <NumInput
            aria-label="Register value"
            shown={hexOf(value, width)}
            parse={(t) => parseInRange(t, modLo, modHi)}
            onCommit={(v) => setReg(toUnsigned(v, width))}
            className="block w-56 mt-1"
          />
        </label>
        <div className="text-xs text-slate-400 font-mono">
          dec {value.toString()} · signed {toSigned(value, width).toString()} · ones {value.toString(2).split('').filter((c) => c === '1').length}
        </div>
        <div className="flex gap-2">
          <button type="button" className={btnCls} onClick={() => setReg(0n)}>Clear</button>
          <button type="button" className={btnCls} onClick={() => setReg((1n << BigInt(width)) - 1n)}>Set all</button>
        </div>
      </div>

      <H>Bit grid ({width} bits, click to toggle)</H>
      <div className="flex flex-wrap gap-x-3 gap-y-2">
        {nibbles.map((hi) => (
          <div key={hi} className="flex gap-1">
            {[3, 2, 1, 0].map((k) => {
              const i = hi + k;
              const on = getBit(value, i) === 1n;
              return (
                <div key={i} className="flex flex-col items-center w-6">
                  <button
                    type="button"
                    aria-label={`bit ${i}`}
                    aria-pressed={on}
                    onClick={() => setReg(toggleBit(value, i, width))}
                    className={`w-6 h-6 rounded font-mono text-xs border ${on ? 'bg-cyan-900/60 border-cyan-600 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600'}`}
                  >
                    {on ? '1' : '0'}
                  </button>
                  <span className="text-[9px] text-slate-600 font-mono">{i}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <H>Bitfields (C-style description)</H>
      <textarea
        aria-label="Bitfield description"
        value={fieldText}
        onChange={(e) => setFieldText(e.target.value)}
        rows={2}
        spellCheck={false}
        className={`${inputCls} w-full`}
        placeholder="EN[0] MODE[3:1] DIV[11:4]"
      />
      <Note>Format: NAME[bit] or NAME[msb:lsb], separated by spaces or commas. Fields must not overlap.</Note>
      {parsed.errors.length > 0 && (
        <Err>
          {parsed.errors.map((e) => <div key={e}>{e}</div>)}
        </Err>
      )}
      {parsed.fields.length > 0 && (
        <div className="mt-2">
          <div className="grid grid-cols-[4rem_3.5rem_1fr] @md:grid-cols-[6rem_5rem_1fr_7rem_6rem] gap-2 text-[10px] uppercase text-slate-600 pb-1 border-b border-slate-800">
            <span>name</span><span>bits</span><span>value (edit to insert)</span><span className="hidden @md:inline">hex</span><span className="hidden @md:inline">mask</span>
          </div>
          {parsed.fields.map((f) => (
            <FieldRow
              key={f.name}
              field={f}
              value={value}
              onCommit={(fv) => {
                const r = setField(value, f, fv, width);
                if (r.ok) setReg(r.value);
              }}
            />
          ))}

          <H>C macros</H>
          <label className="text-xs text-slate-400 flex items-center gap-2">
            Name prefix
            <input
              aria-label="Macro prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              className={`${inputCls} w-40`}
              spellCheck={false}
            />
          </label>
          <div className="relative mt-2">
            <textarea
              readOnly
              aria-label="Generated C macros"
              value={genCMacros(parsed.fields, { width, prefix })}
              rows={Math.min(14, parsed.fields.length * 4 + 2)}
              className={`${inputCls} w-full text-[11px] leading-snug`}
            />
            <div className="absolute top-1.5 right-1.5">
              <CopyBtn text={genCMacros(parsed.fields, { width, prefix })} label="Copy C macros" />
            </div>
          </div>
          <Note>Uses uint32_t up to 32 bits and uint64_t above that. Include &lt;stdint.h&gt; in your C file.</Note>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Float */

function FloatTab() {
  const [fmt, setFmt] = useState('single');
  const [src, setSrc] = useState('dec');
  const [decText, setDecText] = useState('0.1');
  const [bitsText, setBitsText] = useState('0x3DCCCCCD');
  const [bytesText, setBytesText] = useState('CD CC CC 3D');
  const [endian, setEndian] = useState('LE');
  const info = floatFormat(fmt);

  let res = null;
  let enc = null;
  let err = null;
  if (src === 'dec') {
    const p = parseDecimal(decText);
    if (!p.ok) err = p.error;
    else {
      enc = encodeFloat(fmt, p.value);
      res = enc;
    }
  } else if (src === 'bits') {
    const p = parseNumber(bitsText);
    if (!p.ok) err = p.error;
    else if (p.value < 0n || p.value >= 1n << BigInt(info.bits)) err = `${info.key} patterns are ${info.bits} bits`;
    else res = decodeFloat(fmt, p.value);
  } else {
    const p = parseHexBytes(bytesText);
    if (!p.ok) err = p.error;
    else {
      const f = floatFromBytes(fmt, p.bytes, endian === 'LE');
      if (!f.ok) err = f.error;
      else res = f;
    }
  }

  const specials = floatSpecials(fmt);
  const neighbors = res ? floatNeighbors(fmt, BigInt(res.hex)) : null;
  const digits = res ? res.hex.slice(2) : '';
  const be = res ? hexBytes(digits.match(/../g).map((h) => parseInt(h, 16))) : '';
  const le = res ? hexBytes(digits.match(/../g).map((h) => parseInt(h, 16)).reverse()) : '';

  return (
    <div>
      <label className="text-xs text-slate-400 block">
        Format
        <select aria-label="Float format" value={fmt} onChange={(e) => setFmt(e.target.value)} className={`${selectCls} block mt-1`}>
          {Object.entries(FLOAT_FORMATS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
        </select>
      </label>
      <div className="grid gap-2 mt-3">
        <label className="text-xs text-slate-400 flex items-center gap-2">
          <span className="w-24 @md:w-44 shrink-0">Decimal</span>
          <input
            aria-label="Decimal input"
            value={decText}
            onFocus={() => setSrc('dec')}
            onChange={(e) => { setSrc('dec'); setDecText(e.target.value); }}
            className={`${inputCls} flex-1 min-w-0`}
            spellCheck={false}
          />
        </label>
        <label className="text-xs text-slate-400 flex items-center gap-2">
          <span className="w-24 @md:w-44 shrink-0">Bit pattern (hex)</span>
          <input
            aria-label="Bit pattern input"
            value={bitsText}
            onFocus={() => setSrc('bits')}
            onChange={(e) => { setSrc('bits'); setBitsText(e.target.value); }}
            className={`${inputCls} flex-1 min-w-0`}
            spellCheck={false}
          />
        </label>
        <label className="text-xs text-slate-400 flex items-center gap-2">
          <span className="w-24 @md:w-44 shrink-0">Bytes</span>
          <input
            aria-label="Byte input"
            value={bytesText}
            onFocus={() => setSrc('bytes')}
            onChange={(e) => { setSrc('bytes'); setBytesText(e.target.value); }}
            className={`${inputCls} flex-1 min-w-0`}
            spellCheck={false}
          />
          <select aria-label="Byte order" value={endian} onChange={(e) => setEndian(e.target.value)} className={selectCls}>
            <option value="LE">little-endian</option>
            <option value="BE">big-endian</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-3">
        <span className="text-[11px] text-slate-500 mr-1 self-center">Specials:</span>
        {Object.keys(specials).map((name) => (
          <button
            key={name}
            type="button"
            className={btnCls}
            onClick={() => {
              setSrc('bits');
              setBitsText(hexOf(specials[name], info.bits));
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <Note>The field you edit last drives the result. Bytes and bit patterns decode exactly; a decimal is rounded to the nearest representable value.</Note>

      {err && <Err>{err}</Err>}
      {res && (
        <>
          <H>Breakdown ({info.bits} bits)</H>
          <div className="flex flex-wrap gap-px font-mono text-xs bg-slate-950 border border-slate-800 rounded p-1.5" role="group" aria-label="Float bits, click to toggle">
            {(res.signBits + res.expBits + res.mantBits).split('').map((c, k) => {
              const idx = info.bits - 1 - k;
              const color = k === 0 ? 'text-amber-300' : k <= info.ebits ? 'text-cyan-300' : 'text-emerald-300';
              return (
                <button
                  key={idx}
                  type="button"
                  aria-label={`float bit ${idx}`}
                  aria-pressed={c === '1'}
                  title={`bit ${idx} (${k === 0 ? 'sign' : k <= info.ebits ? 'exponent' : 'mantissa'})`}
                  onClick={() => { setSrc('bits'); setBitsText(hexOf(toggleFloatBit(fmt, BigInt(res.hex), idx), info.bits)); }}
                  className={`w-4 h-5 rounded-sm hover:bg-slate-800 ${color} ${c === '1' ? 'font-bold bg-slate-900' : 'opacity-60'} ${k === 1 || k === 1 + info.ebits ? 'ml-1.5' : ''}`}
                >
                  {c}
                </button>
              );
            })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">sign (amber) · exponent (cyan) · mantissa (green), bias {res.bias}. Click a bit to flip it.</div>
          <KV k="hex" v={res.hex} />
          <KV k="bytes, big-endian" v={be} />
          <KV k="bytes, little-endian" v={le} />
          <KV k="sign / exponent field / mantissa field" v={`${res.sign} / ${res.expField} / ${res.mantField.toString()}`} copyable={false} />
          <KV
            k="unbiased exponent"
            v={res.unbiasedExponent === null ? 'n/a' : String(res.unbiasedExponent)}
            copyable={false}
          />
          <KV k="class" v={res.kind === 'nan' ? `NaN (${res.quiet ? 'quiet' : 'signaling'})` : res.kind} copyable={false} />
          <KV k="value" v={String(res.value)} />
          {neighbors && (neighbors.up !== null || neighbors.down !== null) && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
              <span className="text-[11px] text-slate-500">Neighbours:</span>
              {[['down', 'prev value'], ['up', 'next value']].map(([k, label]) => neighbors[k] !== null && (
                <button
                  key={k}
                  type="button"
                  className={btnCls}
                  title={`Load the ${label} (one step) as the bit pattern`}
                  onClick={() => { setSrc('bits'); setBitsText(hexOf(neighbors[k], info.bits)); }}
                >
                  {label} {hexOf(neighbors[k], info.bits)} = {String(decodeFloat(fmt, neighbors[k]).value)}
                </button>
              ))}
            </div>
          )}
          {enc && (
            <>
              <KV k="input" v={String(enc.input)} copyable={false} />
              <KV k="exact" v={enc.exact ? 'yes' : 'no, rounded to nearest'} copyable={false} />
              {enc.error !== null && (
                <>
                  <KV k="error (value - input)" v={enc.error.toExponential(3)} copyable={false} />
                  <KV k="relative error" v={enc.relativeError === null ? 'n/a' : enc.relativeError.toExponential(3)} copyable={false} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- Fixed-point */

function FixedTab() {
  const [qText, setQText] = useState('Q1.15');
  const [mode, setMode] = useState('real');
  const [realText, setRealText] = useState('0.5');
  const [rawText, setRawText] = useState('0x4000');
  const [rounding, setRounding] = useState('nearest');
  const [overflow, setOverflow] = useState('saturate');
  const q = parseQFormat(qText);

  if (!q.ok) {
    return (
      <div>
        <label className="text-xs text-slate-400 block">
          Q format
          <input aria-label="Q format" value={qText} onChange={(e) => setQText(e.target.value)} className={`${inputCls} block w-48 mt-1`} spellCheck={false} />
        </label>
        <Err>{q.error}</Err>
      </div>
    );
  }
  const info = qInfo(q);
  let res;
  if (mode === 'real') {
    const p = parseDecimal(realText);
    res = p.ok ? qFromReal(q, p.value, { rounding, overflow }) : { ok: false, error: p.error };
  } else {
    res = qFromRaw(q, rawText);
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">
          Q format (Qm.n signed, UQm.n unsigned)
          <input aria-label="Q format" value={qText} onChange={(e) => setQText(e.target.value)} className={`${inputCls} block w-48 mt-1`} spellCheck={false} />
        </label>
        <label className="text-xs text-slate-400">
          Convert
          <select aria-label="Conversion direction" value={mode} onChange={(e) => setMode(e.target.value)} className={`${selectCls} block mt-1`}>
            <option value="real">real value to raw</option>
            <option value="raw">raw to real value</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3 mt-3">
        {mode === 'real' ? (
          <>
            <label className="text-xs text-slate-400">
              Real value
              <input aria-label="Real value" value={realText} onChange={(e) => setRealText(e.target.value)} className={`${inputCls} block w-48 mt-1`} spellCheck={false} />
            </label>
            <label className="text-xs text-slate-400">
              Rounding
              <select aria-label="Rounding" value={rounding} onChange={(e) => setRounding(e.target.value)} className={`${selectCls} block mt-1`}>
                <option value="nearest">nearest (ties to even)</option>
                <option value="truncate">truncate toward zero</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Overflow
              <select aria-label="Overflow" value={overflow} onChange={(e) => setOverflow(e.target.value)} className={`${selectCls} block mt-1`}>
                <option value="saturate">saturate</option>
                <option value="wrap">wrap</option>
              </select>
            </label>
          </>
        ) : (
          <label className="text-xs text-slate-400">
            Raw value (hex or decimal, two&apos;s complement for signed)
            <input aria-label="Raw value" value={rawText} onChange={(e) => setRawText(e.target.value)} className={`${inputCls} block w-56 mt-1`} spellCheck={false} />
          </label>
        )}
      </div>

      <H>Format {info.label}</H>
      <KV k="total width" v={`${info.width} bits (${info.intBits} integer incl. sign, ${info.fracBits} fraction)`} copyable={false} />
      <KV k="range" v={`${info.minValue} .. ${info.maxValue}`} copyable={false} />
      <KV k="resolution (LSB)" v={String(info.resolution)} copyable={false} />

      <H>Result</H>
      {!res.ok ? (
        <Err>{res.error}</Err>
      ) : (
        <>
          <KV k="raw (hex)" v={res.rawHex} />
          <KV k="raw (decimal)" v={res.raw.toString()} />
          <KV k="real value" v={String(res.value)} />
          {mode === 'real' && <KV k="error (value - input)" v={String(res.error)} copyable={false} />}
          {mode === 'real' && res.overflowed && (
            <Note>The value is outside the range; result {overflow === 'saturate' ? 'saturated to the limit' : 'wrapped'}.</Note>
          )}
          {mode === 'raw' && res.outOfRange && (
            <Note>The raw value is outside the {info.width}-bit range and was wrapped.</Note>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Data */

function DataTab() {
  const [bytesText, setBytesText] = useState('DE AD BE EF 48 69 21 00');
  const [offText, setOffText] = useState('0');
  const bytes = parseHexBytes(bytesText);
  const off = parseNumber(offText);
  const offOk = off.ok && off.value >= 0n;
  const rows = bytes.ok && offOk ? inspectBytes(bytes.bytes, Number(off.value)) : null;

  return (
    <div>
      <label className="block text-xs text-slate-400">
        Paste hex bytes (spaces, commas or colons between bytes are fine)
        <textarea
          aria-label="Hex bytes"
          value={bytesText}
          onChange={(e) => setBytesText(e.target.value)}
          rows={3}
          spellCheck={false}
          className={`${inputCls} w-full mt-1`}
        />
      </label>
      <div className="flex items-center gap-3 mt-2">
        <label className="text-xs text-slate-400 flex items-center gap-2">
          Offset (decimal or 0x)
          <input aria-label="Offset" value={offText} onChange={(e) => setOffText(e.target.value)} className={`${inputCls} w-32`} spellCheck={false} />
        </label>
        {bytes.ok && <span className="text-xs text-slate-500">{bytes.bytes.length} bytes</span>}
      </div>
      {!bytes.ok && <Err>{bytes.error}</Err>}
      {bytes.ok && !offOk && <Err>{off.ok ? 'Offset must be zero or positive' : off.error}</Err>}
      {rows && (
        <>
          <H>Interpretations at offset {Number(off.value)}</H>
          <div className="font-mono text-xs">
            {rows.map((r) => (
              <div key={r.label} className="grid grid-cols-[9rem_1fr] gap-2 py-0.5 border-b border-slate-900 last:border-0">
                <span className="text-slate-500">{r.label}</span>
                <span className="text-gray-200 break-all">
                  {r.value === null ? <span className="text-slate-600">{r.note}</span> : r.value}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Bitwise */

function BitwiseTab({ width }) {
  const [aText, setAText] = useState('0xF0');
  const [bText, setBText] = useState('0x3C');
  const [op, setOp] = useState('and');
  const unary = op === 'not';
  const shift = ['shl', 'shr', 'sar', 'rol', 'ror'].includes(op);
  const a = parseNumber(aText);
  const b = parseNumber(bText);
  let result = null;
  let err = null;
  if (!a.ok) err = `A: ${a.error}`;
  else if (!unary && !b.ok) err = `B: ${b.error}`;
  else {
    const r = bitwiseOp(op, a.value, unary ? 0n : b.value, width);
    if (!r.ok) err = r.error;
    else result = r.result;
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-400">
          A
          <input aria-label="Operand A" value={aText} onChange={(e) => setAText(e.target.value)} className={`${inputCls} block w-44 mt-1`} spellCheck={false} />
        </label>
        {!unary && (
          <label className="text-xs text-slate-400">
            {shift ? 'B (count)' : 'B'}
            <input aria-label="Operand B" value={bText} onChange={(e) => setBText(e.target.value)} className={`${inputCls} block w-44 mt-1`} spellCheck={false} />
          </label>
        )}
        <label className="text-xs text-slate-400">
          Operation
          <select aria-label="Operation" value={op} onChange={(e) => setOp(e.target.value)} className={`${selectCls} block mt-1`}>
            {BITWISE_OPTIONS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
      </div>
      <Note>Width is {width} bits (set at the top). Inputs are reduced to the low {width} bits. Shifts of {width} or more give 0 (or sign fill for SAR); rotates use the count modulo {width}.</Note>
      {err && <Err>{err}</Err>}
      {result !== null && (
        <>
          <H>Result at {width} bits</H>
          <KV k="hex" v={hexOf(result, width)} />
          <KV k="unsigned" v={result.toString()} />
          <KV k="signed" v={toSigned(result, width).toString()} />
          <KV k="binary" v={'0b' + result.toString(2).padStart(width, '0')} />
          <KV k="ones" v={result.toString(2).split('').filter((c) => c === '1').length} copyable={false} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

export default function BitConverterWorkbench() {
  const [tab, setTab] = useState('calc');
  const [width, setWidth] = useState(32);

  return (
    <div className="min-h-[calc(100%+1.5rem)] -m-3 p-2 bg-slate-950 text-gray-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
        <div role="tablist" className="flex flex-wrap gap-0.5">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              type="button"
              onClick={() => setTab(k)}
              className={`px-2 py-1 text-xs border-b-2 -mb-px ${tab === k ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-xs text-slate-400 flex items-center gap-1.5" title="Offline: everything is computed in your browser">
          Width
          <select aria-label="Register width" value={width} onChange={(e) => setWidth(Number(e.target.value))} className={selectCls}>
            {WIDTHS.map((w) => <option key={w} value={w}>{w} bits</option>)}
          </select>
        </label>
      </div>

      <div className="mt-2">
        {tab === 'calc' && <CalcTab width={width} />}
        {tab === 'number' && <NumberTab width={width} />}
        {tab === 'bits' && <BitsTab width={width} />}
        {tab === 'float' && <FloatTab />}
        {tab === 'fixed' && <FixedTab />}
        {tab === 'data' && <DataTab />}
        {tab === 'bitwise' && <BitwiseTab width={width} />}
      </div>
    </div>
  );
}
