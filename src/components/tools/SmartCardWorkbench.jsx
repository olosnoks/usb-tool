import React, { useMemo, useState } from 'react';
import { CreditCard, Copy, Check, Info, ListTree, Terminal, Hammer, Binary, FileCode } from 'lucide-react';
import {
  parseHex, toHex, parseAtr, decodeCommandApdu, decodeResponseApdu, parseTrace, parseTlv,
  KNOWN_AIDS, buildApdu, buildSelectByAid, buildGetResponse, buildReadRecord, buildGetData, VERIFY_NOTE, EXAMPLES,
} from '../../utils/smartcardTools.js';
import { explainAtrInterface, formatAtrReport, parseScript, exportScript, convertToolOutputToTrace } from '../../utils/smartcardScript.js';

/**
 * Smart Card toolkit. Offline analysis only: ATR, APDU, trace logs, TLV and an
 * APDU builder. This page cannot drive a reader (see the notice at the top).
 */

const TABS = [
  ['atr', 'ATR', CreditCard],
  ['apdu', 'APDU', Terminal],
  ['trace', 'Trace', ListTree],
  ['tlv', 'TLV', Binary],
  ['build', 'Build', Hammer],
  ['script', 'Script', FileCode],
];

const inputCls = 'w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-700';
const btnCls = 'px-2 py-1 rounded border border-slate-700 text-[11px] text-slate-300 hover:border-cyan-700 hover:text-cyan-300';
const panelCls = 'bg-slate-900/60 border border-slate-800 rounded p-2';
const labelCls = 'text-[10px] uppercase tracking-wider text-slate-500 mb-1';

const copyText = (t) => { try { navigator.clipboard?.writeText(String(t)); } catch { /* clipboard unavailable */ } };

function CopyBtn({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { copyText(text); setDone(true); setTimeout(() => setDone(false), 900); }}
      className={`${btnCls} inline-flex items-center gap-1`}
      aria-label={label}
    >
      {done ? <Check size={11} /> : <Copy size={11} />} {label}
    </button>
  );
}

function ErrorLine({ children }) {
  return <div className="text-xs text-red-300 bg-red-950/30 border border-red-900 rounded px-2 py-1">{children}</div>;
}

function Notice({ children, tone = 'amber' }) {
  const cls = tone === 'amber' ? 'text-amber-200 bg-amber-950/30 border-amber-900' : 'text-slate-300 bg-slate-900 border-slate-800';
  return <div className={`text-xs border rounded px-2 py-1.5 ${cls}`}>{children}</div>;
}

function KV({ k, v, mono = true }) {
  return (
    <div className="flex items-start justify-between gap-2 py-0.5 border-b border-slate-900 last:border-0">
      <span className="text-slate-500 text-xs shrink-0">{k}</span>
      <span className={`text-xs text-gray-200 text-right break-all ${mono ? 'font-mono' : ''}`}>{v === null || v === undefined || v === '' ? '-' : String(v)}</span>
    </div>
  );
}

// ---------------------------------------------------------------- ATR tab

function AtrTab() {
  const [text, setText] = useState(EXAMPLES.atr);
  const { atr, error } = useMemo(() => {
    if (!text.trim()) return { atr: null, error: '' };
    try { return { atr: parseAtr(parseHex(text)), error: '' }; } catch (e) { return { atr: null, error: e.message }; }
  }, [text]);

  return (
    <div className="space-y-2">
      <div>
        <div className={labelCls}>ATR (hex, from pcsc-tools, a reader log, or a card dump)</div>
        <textarea className={inputCls} rows={3} spellCheck={false} aria-label="ATR hex" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2 mt-1">
          <button type="button" className={btnCls} onClick={() => setText(EXAMPLES.atr)}>Load example (T=0)</button>
          <button type="button" className={btnCls} onClick={() => setText(EXAMPLES.atrT1)}>Load example (T=1, TA1)</button>
          <button type="button" className={btnCls} onClick={() => setText('')}>Clear</button>
          {atr && <CopyBtn text={formatAtrReport(atr, atr.rawHex)} label="Copy report" />}
        </div>
        <div className="text-[10px] text-slate-500 mt-1">The example ATRs are illustrative inputs for the parser, not readings from a card.</div>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      {atr && (
        <div className="grid gap-2 @md:grid-cols-2">
          <div className={panelCls}>
            <div className={labelCls}>Header</div>
            <KV k="Convention (TS)" v={atr.TS === null ? '-' : `${atr.TS.toString(16).toUpperCase().padStart(2, '0')} (${atr.convention})`} />
            <KV k="T0" v={atr.T0 === null ? '-' : atr.T0.toString(16).toUpperCase().padStart(2, '0')} />
            <KV k="Y1 (interface flags)" v={atr.Y1 === null ? '-' : `${atr.Y1.toString(2).padStart(4, '0')} (TA ${atr.Y1 & 1 ? 'yes' : 'no'}, TB ${atr.Y1 & 2 ? 'yes' : 'no'}, TC ${atr.Y1 & 4 ? 'yes' : 'no'}, TD ${atr.Y1 & 8 ? 'yes' : 'no'})`} />
            <KV k="K (historical bytes)" v={atr.K} />
            <KV k="Length" v={`${atr.length} bytes${atr.expectedLength !== undefined ? ` (expected ${atr.expectedLength})` : ''}`} />
            <KV k="Protocols (TDi)" v={atr.protocols.length ? atr.protocols.map((p) => `T=${p}`).join(', ') : 'none listed (T=0 only)'} />
            <KV k="TCK" v={!atr.tck.required ? 'not required (T=0 only)' : atr.tck.present ? `${atr.tck.value.toString(16).toUpperCase().padStart(2, '0')} ${atr.tck.ok ? '(XOR check passed)' : '(XOR check FAILED)'}` : 'missing'} />
          </div>
          <div className={panelCls}>
            <div className={labelCls}>Transmission (FI / DI)</div>
            {atr.fiDi ? (
              <>
                <KV k="FI" v={atr.fiDi.F === null ? `${atr.fiDi.FI.toString(16).toUpperCase()} (not tabulated here)` : `${atr.fiDi.FI.toString(16).toUpperCase()} -> F = ${atr.fiDi.F}`} />
                <KV k="DI" v={atr.fiDi.D === null ? `${atr.fiDi.DI.toString(16).toUpperCase()} (RFU or not tabulated)` : `${atr.fiDi.DI.toString(16).toUpperCase()} -> D = ${atr.fiDi.D}`} />
                <KV k="Bit rate estimate" v={atr.fiDi.baud === null ? '-' : `${atr.fiDi.baud.toLocaleString()} bps at ${(atr.fiDi.clockHz / 1e6).toFixed(4)} MHz clock`} />
                <KV k="Source" v={atr.fiDi.defaulted ? 'ISO default (TA1 absent)' : 'TA1 in the ATR'} />
              </>
            ) : <div className="text-xs text-slate-500">No FI/DI data.</div>}
          </div>
          <div className={`${panelCls} @md:col-span-2`}>
            <div className={labelCls}>Interface bytes</div>
            {atr.interface.length === 0 ? <div className="text-xs text-slate-500">No interface bytes after T0.</div> : (
              <table className="w-full text-xs font-mono">
                <thead className="text-slate-500 text-left">
                  <tr><th className="py-1 pr-2">Group</th><th className="pr-2">TA</th><th className="pr-2">TB</th><th className="pr-2">TC</th><th className="pr-2">TD</th><th>Meaning</th></tr>
                </thead>
                <tbody>
                  {atr.interface.map((g, gi) => {
                    const hx = (v) => (v === null ? '-' : v.toString(16).toUpperCase().padStart(2, '0'));
                    const notes = explainAtrInterface(atr)[gi]?.notes ?? [];
                    return (
                      <tr key={g.index} className="border-t border-slate-900 align-top">
                        <td className="py-1 pr-2 text-slate-400">{g.index}</td>
                        <td className="pr-2">{hx(g.TA)}</td><td className="pr-2">{hx(g.TB)}</td><td className="pr-2">{hx(g.TC)}</td><td className="pr-2">{hx(g.TD)}</td>
                        <td className="font-sans text-slate-300">{notes.map((n, ni) => <div key={ni}>{n}</div>)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className={`${panelCls} @md:col-span-2`}>
            <div className={labelCls}>Historical bytes</div>
            <KV k="Hex" v={atr.historical.hex || '(none)'} />
            <KV k="ASCII" v={atr.historical.ascii || '-'} />
            <KV k="Category" v={atr.historical.categoryName || '-'} mono={false} />
            {atr.historical.compactTlv.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-slate-500 mb-1">Compact-TLV objects (tag nibble, length nibble, value)</div>
                {atr.historical.compactTlv.map((o, i) => (
                  <div key={i} className="text-xs font-mono text-gray-300">tag {o.tag.toString(16).toUpperCase()} len {o.len}: {o.value}{o.truncated ? ' (truncated)' : ''}</div>
                ))}
              </div>
            )}
          </div>
          {(atr.patterns.length > 0 || atr.errors.length > 0 || atr.warnings.length > 0) && (
            <div className={`${panelCls} @md:col-span-2 space-y-2`}>
              {atr.patterns.map((p) => (
                <Notice key={p.id} tone="slate"><span className="font-semibold text-cyan-300">Hint: {p.label}.</span> {p.note}</Notice>
              ))}
              {atr.warnings.map((w, i) => <Notice key={`w${i}`}>{w}</Notice>)}
              {atr.errors.map((e, i) => <ErrorLine key={`e${i}`}>{e}</ErrorLine>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- APDU tab

const hexOut = (bytes) => toHex(bytes);

function ApduTab() {
  const [cmd, setCmd] = useState('00 A4 04 00 08 A0 00 00 03 08 00 00 10');
  const [rsp, setRsp] = useState('61 22');
  const cmdRes = useMemo(() => {
    if (!cmd.trim()) return null;
    try { return decodeCommandApdu(parseHex(cmd)); } catch (e) { return { ok: false, error: e.message }; }
  }, [cmd]);
  const rspRes = useMemo(() => {
    if (!rsp.trim()) return null;
    try { return decodeResponseApdu(parseHex(rsp)); } catch (e) { return { ok: false, error: e.message }; }
  }, [rsp]);

  return (
    <div className="space-y-2">
      <div className="grid gap-2 @md:grid-cols-2">
        <div>
          <div className={labelCls}>Command APDU (hex)</div>
          <textarea className={inputCls} rows={3} spellCheck={false} aria-label="Command APDU hex" value={cmd} onChange={(e) => setCmd(e.target.value)} />
        </div>
        <div>
          <div className={labelCls}>Response APDU (hex, optional)</div>
          <textarea className={inputCls} rows={3} spellCheck={false} aria-label="Response APDU hex" value={rsp} onChange={(e) => setRsp(e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2">
        <button type="button" className={btnCls} onClick={() => { setCmd(EXAMPLES.apdu); setRsp('6F 02 90 00'); }}>Load example</button>
        <button type="button" className={btnCls} onClick={() => { setCmd(''); setRsp(''); }}>Clear</button>
      </div>
      <div className="grid gap-2 @md:grid-cols-2">
        <div className={panelCls}>
          <div className={labelCls}>Command</div>
          {!cmdRes && <div className="text-xs text-slate-500">Paste a command APDU.</div>}
          {cmdRes && !cmdRes.ok && <ErrorLine>{cmdRes.error}</ErrorLine>}
          {cmdRes && cmdRes.ok && (
            <>
              <KV k="CLA" v={`${cmdRes.cla}  (${cmdRes.classInfo.kind})`} />
              {cmdRes.classInfo.chain && <KV k="Chaining" v={cmdRes.classInfo.chain} mono={false} />}
              {cmdRes.classInfo.secureMessaging && <KV k="Secure messaging" v={cmdRes.classInfo.secureMessaging} mono={false} />}
              {cmdRes.classInfo.logicalChannel !== null && <KV k="Logical channel" v={cmdRes.classInfo.logicalChannel} />}
              {cmdRes.classInfo.note && <div className="text-[11px] text-slate-500 mt-1">{cmdRes.classInfo.note}</div>}
              <KV k="INS" v={`${cmdRes.ins}  ${cmdRes.insInfo.name}`} />
              {cmdRes.insInfo.families && <KV k="Used by" v={cmdRes.insInfo.families} mono={false} />}
              <KV k="P1 P2" v={`${cmdRes.p1} ${cmdRes.p2}`} />
              <KV k="Case / encoding" v={`case ${cmdRes.case}, ${cmdRes.encoding} length`} mono={false} />
              <KV k="Lc" v={cmdRes.lc} />
              <KV k="Data" v={cmdRes.data.length ? `${hexOut(cmdRes.data)}  (${cmdRes.data.length} bytes)` : '-'} />
              <KV k="Le" v={cmdRes.leMeaning || (cmdRes.le === null ? 'none' : cmdRes.le)} />
            </>
          )}
        </div>
        <div className={panelCls}>
          <div className={labelCls}>Response</div>
          {!rspRes && <div className="text-xs text-slate-500">Paste a response APDU to see the status word.</div>}
          {rspRes && !rspRes.ok && <ErrorLine>{rspRes.error}</ErrorLine>}
          {rspRes && rspRes.ok && (
            <>
              <KV k="SW" v={rspRes.sw.sw} />
              <div className={`text-xs mt-1 ${rspRes.sw.kind === 'success' ? 'text-emerald-300' : rspRes.sw.kind === 'warning' ? 'text-amber-300' : 'text-red-300'}`}>{rspRes.sw.meaning}</div>
              <KV k="Data" v={rspRes.data.length ? `${rspRes.dataHex}  (${rspRes.data.length} bytes)` : '-'} />
              <div className="text-[10px] text-slate-500 mt-2">Data bytes can be decoded with the TLV tab.</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Trace tab

function TraceTab() {
  const [text, setText] = useState(EXAMPLES.trace);
  const [convNote, setConvNote] = useState('');
  const trace = useMemo(() => parseTrace(text), [text]);
  const lines = trace.steps.length;
  return (
    <div className="space-y-2">
      <div>
        <div className={labelCls}>Trace log. Lines start with &gt;&gt; (command) or &lt;&lt; (response). ATR lines start with &lt;&lt; and 3B or 3F.</div>
        <textarea className={inputCls} rows={7} spellCheck={false} aria-label="Trace log" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2 mt-1">
          <button type="button" className={btnCls} onClick={() => setText(EXAMPLES.trace)}>Load example</button>
          <button type="button" className={btnCls} onClick={() => setText('')}>Clear</button>
          <button
            type="button"
            className={btnCls}
            title="Rewrite gp -d (A>> / A<<) or scriptor (Sending: / Response:) output into >> / << lines"
            onClick={() => { const r = convertToolOutputToTrace(text); if (r.trace) { setText(r.trace); setConvNote(r.skipped ? `${r.skipped} unrecognised line(s) dropped.` : 'Converted.'); } else setConvNote('Nothing recognised (expects gp -d or scriptor output).'); }}
          >Convert gp -d / scriptor output</button>
        </div>
        {convNote && <div className="text-[10px] text-slate-400 mt-1">{convNote}</div>}
        <div className="text-[10px] text-slate-500 mt-1">The example trace is illustrative (a PIV-style select and read), not a capture from a card.</div>
      </div>
      {!text.trim() ? <div className="text-xs text-slate-500">Paste a trace to see the conversation.</div> : (
        <div className={panelCls}>
          <div className="text-[10px] text-slate-500 mb-2">{trace.commands} command(s), {lines} step(s){trace.ignored ? `, ${trace.ignored} line(s) ignored` : ''}</div>
          <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
            {trace.steps.map((s) => (
              <div key={s.n} className="border-b border-slate-900 pb-2 last:border-0">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-600 w-10">L{s.line}</span>
                  {s.dir === 'atr' && <span className="text-cyan-300 font-semibold">ATR</span>}
                  {s.dir === 'cmd' && <span className="text-cyan-300">CMD</span>}
                  {s.dir === 'rsp' && <span className="text-emerald-300">RSP</span>}
                  <span className="font-mono text-gray-200 break-all">{s.hex}</span>
                  <CopyBtn text={s.hex} label="Hex" />
                </div>
                {s.dir === 'cmd' && s.apdu && (
                  <div className="ml-12 text-[11px] text-slate-400">
                    {s.apdu.ok ? (
                      <>{s.apdu.insInfo.name}, CLA {s.apdu.cla} INS {s.apdu.ins} P1P2 {s.apdu.p1} {s.apdu.p2}, case {s.apdu.case}{s.apdu.lc !== null ? `, Lc ${s.apdu.lc}` : ''}{s.apdu.leMeaning ? `, ${s.apdu.leMeaning}` : ''}</>
                    ) : <span className="text-red-300">{s.apdu.error}</span>}
                    {s.noResponse && <span className="text-amber-300"> (no response line followed)</span>}
                  </div>
                )}
                {s.dir === 'rsp' && s.rapdu && s.rapdu.ok && (
                  <div className="ml-12 text-[11px] text-slate-400">
                    <span className={s.rapdu.sw.kind === 'success' ? 'text-emerald-300' : s.rapdu.sw.kind === 'warning' ? 'text-amber-300' : 'text-red-300'}>{s.rapdu.sw.sw}</span> {s.rapdu.sw.meaning}
                    {s.rapdu.data.length > 0 && <div className="font-mono text-slate-500 break-all">data {s.rapdu.dataHex}</div>}
                    {s.orphan && <span className="text-amber-300"> (response without a preceding command)</span>}
                  </div>
                )}
                {s.dir === 'atr' && s.atr && (
                  <div className="ml-12 text-[11px] text-slate-400">
                    {s.atr.ok ? `Protocols ${s.atr.protocols.length ? s.atr.protocols.map((p) => `T=${p}`).join(', ') : 'T=0'}, ${s.atr.historical.hex ? `${s.atr.K} historical bytes` : 'no historical bytes'}` : s.atr.errors.join(' ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- TLV tab

function TlvNode({ node, depth }) {
  const [open, setOpen] = useState(true);
  const shown = node.hex.length > 96 ? `${node.hex.slice(0, 96)} ...` : node.hex;
  return (
    <div style={{ marginLeft: depth ? 14 : 0 }} className="font-mono text-[11px]">
      <div className="flex items-start gap-2 py-0.5">
        {node.constructed && node.children.length > 0 ? (
          <button type="button" onClick={() => setOpen(!open)} className="text-slate-500 w-4 text-left" aria-label={open ? 'Collapse' : 'Expand'}>{open ? '-' : '+'}</button>
        ) : <span className="w-4 text-slate-700">.</span>}
        <span className="text-slate-600 w-12">@{node.offset}</span>
        <span className="text-cyan-300 w-20">{node.tag}</span>
        <span className="text-slate-500 w-24">{node.tagClass}{node.constructed ? ', constr.' : ''}</span>
        <span className="text-slate-500 w-28">len {node.length}</span>
        <span className="text-gray-200 font-sans">{node.name || ''}</span>
        {!node.constructed && node.hex && <span className="text-slate-400 break-all">{shown}</span>}
        {node.truncated && <span className="text-amber-300 font-sans">truncated</span>}
      </div>
      {open && node.children.map((c, i) => <TlvNode key={`${c.offset}-${i}`} node={c} depth={depth + 1} />)}
    </div>
  );
}

function TlvTab() {
  const [text, setText] = useState(EXAMPLES.tlv);
  const { result, error } = useMemo(() => {
    if (!text.trim()) return { result: null, error: '' };
    try { return { result: parseTlv(parseHex(text)), error: '' }; } catch (e) { return { result: null, error: e.message }; }
  }, [text]);
  return (
    <div className="space-y-2">
      <div>
        <div className={labelCls}>BER-TLV data (hex). Use the response data from a READ RECORD, GET DATA or SELECT FCI.</div>
        <textarea className={inputCls} rows={4} spellCheck={false} aria-label="TLV hex" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2 mt-1">
          <button type="button" className={btnCls} onClick={() => setText(EXAMPLES.tlv)}>Load example (EMV record)</button>
          <button type="button" className={btnCls} onClick={() => setText(EXAMPLES.tlvNested)}>Load example (nested 77)</button>
          <button type="button" className={btnCls} onClick={() => setText('')}>Clear</button>
        </div>
        <div className="text-[10px] text-slate-500 mt-1">Names come from an EMV dictionary, then a PIV dictionary. Overlapping tags (for example 82 and 70) are labelled with the EMV meaning first.</div>
      </div>
      {error && <ErrorLine>{error}</ErrorLine>}
      {result && (
        <div className={panelCls}>
          <div className="text-[10px] text-slate-500 mb-2">{result.bytesUsed} byte(s), {result.nodes.length} top-level object(s)</div>
          {result.nodes.length === 0 && <div className="text-xs text-slate-500">No objects found.</div>}
          {result.nodes.map((n, i) => <TlvNode key={`${n.offset}-${i}`} node={n} depth={0} />)}
          {result.errors.length > 0 && <div className="mt-2 space-y-1">{result.errors.map((e, i) => <ErrorLine key={i}>{e}</ErrorLine>)}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Build tab

function Field({ label, value, onChange, width = 'w-24', placeholder }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-slate-500">{label}</span>
      <input className={`${inputCls} ${width}`} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} placeholder={placeholder} />
    </label>
  );
}

function BuildTab() {
  const [mode, setMode] = useState('select');
  const [aidId, setAidId] = useState('piv');
  const [customAid, setCustomAid] = useState('');
  const [leResp, setLeResp] = useState('22');
  const [record, setRecord] = useState('1');
  const [sfi, setSfi] = useState('0');
  const [leRec, setLeRec] = useState('0');
  const [tag, setTag] = useState('5FC102');
  const [leData, setLeData] = useState('0');
  const [cla, setCla] = useState('00');
  const [ins, setIns] = useState('A4');
  const [p1, setP1] = useState('04');
  const [p2, setP2] = useState('00');
  const [data, setData] = useState('');
  const [le, setLe] = useState('');
  const [forceExt, setForceExt] = useState(false);

  const out = useMemo(() => {
    try {
      if (mode === 'select') {
        const aid = aidId === 'custom' ? customAid : KNOWN_AIDS.find((a) => a.id === aidId).aid;
        if (!aid.trim()) return { error: 'Enter an AID.' };
        return { res: buildSelectByAid(aid), note: null };
      }
      if (mode === 'getresponse') {
        return { res: buildGetResponse(parseIntField(leResp, 0, 256)), note: 'Use the 61 xx value from the previous response as Le.' };
      }
      if (mode === 'readrecord') {
        return { res: buildReadRecord({ record: parseIntField(record, 1, 255), sfi: parseIntField(sfi, 0, 30), le: parseIntField(leRec, 0, 256) }), note: null };
      }
      if (mode === 'getdata') {
        return { res: buildGetData({ tag, le: parseIntField(leData, 0, 256) }), note: 'GET DATA P1P2 is the tag. Some applets (PIV) use the 0xCB INS with a tag list instead.' };
      }
      if (mode === 'verify') {
        return { res: null, note: VERIFY_NOTE };
      }
      // custom
      const byteOf = (h, name) => {
        const b = parseHex(h.trim() === '' ? '00' : h);
        if (b.length !== 1) throw new Error(`${name} must be exactly one byte (2 hex digits).`);
        return b[0];
      };
      const d = data.trim() ? parseHex(data) : new Uint8Array(0);
      const leVal = le.trim() === '' ? null : parseIntField(le, 0, 65536);
      const res = buildApdu({
        cla: byteOf(cla, 'CLA'), ins: byteOf(ins, 'INS'), p1: byteOf(p1, 'P1'), p2: byteOf(p2, 'P2'),
        data: d, le: leVal, extended: forceExt,
      });
      return { res, note: null };
    } catch (e) {
      return { error: e.message };
    }
  }, [mode, aidId, customAid, leResp, record, sfi, leRec, tag, leData, cla, ins, p1, p2, data, le, forceExt]);

  const modes = [['select', 'SELECT by AID'], ['getresponse', 'GET RESPONSE'], ['readrecord', 'READ RECORD'], ['getdata', 'GET DATA'], ['verify', 'VERIFY note'], ['custom', 'Custom APDU']];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {modes.map(([id, label]) => (
          <button key={id} type="button" onClick={() => setMode(id)} className={`${btnCls} ${mode === id ? 'border-cyan-600 text-cyan-300' : ''}`}>{label}</button>
        ))}
      </div>
      <div className={`${panelCls} space-y-2`}>
        {mode === 'select' && (
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-500">Known AID</span>
              <select className={`${inputCls} w-80`} value={aidId} onChange={(e) => setAidId(e.target.value)}>
                {KNOWN_AIDS.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                <option value="custom">Custom AID (enter below)</option>
              </select>
            </label>
            {aidId === 'custom' && <Field label="AID (hex, 5-16 bytes)" value={customAid} onChange={setCustomAid} width="w-96" />}
            <div className="text-[11px] text-slate-400 font-mono break-all">{aidId !== 'custom' ? KNOWN_AIDS.find((a) => a.id === aidId).aid : ''}</div>
          </div>
        )}
        {mode === 'getresponse' && <Field label="Le (bytes to fetch, from 61 xx)" value={leResp} onChange={setLeResp} />}
        {mode === 'readrecord' && (
          <div className="flex flex-wrap gap-2">
            <Field label="Record number" value={record} onChange={setRecord} />
            <Field label="SFI (0 = current file)" value={sfi} onChange={setSfi} />
            <Field label="Le" value={leRec} onChange={setLeRec} />
          </div>
        )}
        {mode === 'getdata' && (
          <div className="flex flex-wrap gap-2">
            <Field label="Tag (1 or 2 bytes hex)" value={tag} onChange={setTag} width="w-40" />
            <Field label="Le" value={leData} onChange={setLeData} />
          </div>
        )}
        {mode === 'custom' && (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="CLA" value={cla} onChange={setCla} />
            <Field label="INS" value={ins} onChange={setIns} />
            <Field label="P1" value={p1} onChange={setP1} />
            <Field label="P2" value={p2} onChange={setP2} />
            <Field label="Data (hex, optional)" value={data} onChange={setData} width="w-80" />
            <Field label="Le (empty = none)" value={le} onChange={setLe} />
            <label className="flex items-center gap-1.5 text-xs text-slate-400 pb-1.5">
              <input type="checkbox" checked={forceExt} onChange={(e) => setForceExt(e.target.checked)} /> force extended length
            </label>
          </div>
        )}
        {out.error && <ErrorLine>{out.error}</ErrorLine>}
        {out.note && <Notice tone="slate">{out.note}</Notice>}
        {out.res && (
          <div className="bg-slate-950 border border-slate-800 rounded p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-mono text-sm text-cyan-200 break-all select-all">{out.res.hex}</div>
              <CopyBtn text={out.res.hex} label="Copy hex" />
            </div>
            <div className="text-[11px] text-slate-500 mt-1">{out.res.bytes.length} bytes, case {out.res.case}, {out.res.encoding} length. Paste the hex into your reader tool (pcsc-tools, or the raw APDU field of your Proxmark3 or other client).</div>
          </div>
        )}
      </div>
    </div>
  );
}

function parseIntField(s, min, max) {
  const t = String(s).trim();
  const n = /^0x/i.test(t) ? parseInt(t, 16) : parseInt(t, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Expected a number from ${min} to ${max}, got "${s}".`);
  return n;
}

// ---------------------------------------------------------------- Script tab

const SCRIPT_EXAMPLE = '# select the PIV application, then read the CHUID\n/reset\n00 A4 04 00 09 A0 00 00 03 08 00 00 10 00\n00 CB 3F FF 05 5C 03 5F C1 02 00\n';
const EXPORTS = [['scriptor', 'scriptor file'], ['opensc', 'opensc-tool -s'], ['gp', 'gp -a'], ['pyscard', 'pyscard']];

function ScriptTab() {
  const [text, setText] = useState(SCRIPT_EXAMPLE);
  const [fmt, setFmt] = useState('scriptor');
  const parsed = useMemo(() => parseScript(text), [text]);
  const exported = useMemo(() => { try { return exportScript(parsed, fmt); } catch { return ''; } }, [parsed, fmt]);
  return (
    <div className="space-y-2">
      <div>
        <div className={labelCls}>Script: one APDU per line (hex), # comments, /reset lines kept</div>
        <textarea className={inputCls} rows={5} spellCheck={false} aria-label="APDU script" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex gap-2 mt-1">
          <button type="button" className={btnCls} onClick={() => setText(SCRIPT_EXAMPLE)}>Load example</button>
          <button type="button" className={btnCls} onClick={() => setText('')}>Clear</button>
        </div>
        <div className="text-[10px] text-slate-500 mt-1">This page only checks and converts the script. It sends nothing; run the exported text with your own tool on your own card.</div>
      </div>
      {parsed.errors.map((e, i) => <ErrorLine key={`e${i}`}>Line {e.line}: {e.message}</ErrorLine>)}
      {parsed.warnings.map((w, i) => <Notice key={`w${i}`}>{w.message}</Notice>)}
      {parsed.commands.length > 0 && (
        <div className={panelCls}>
          <div className={labelCls}>{parsed.commands.length} command(s)</div>
          {parsed.commands.map((c) => (
            <div key={c.line} className="flex items-start gap-2 text-xs border-b border-slate-900 last:border-0 py-0.5">
              <span className="text-slate-600 w-8 shrink-0">L{c.line}</span>
              <span className="font-mono text-cyan-200 break-all flex-1">{c.hex}</span>
              <span className="text-slate-400 shrink-0">{c.ins} {c.name}</span>
            </div>
          ))}
        </div>
      )}
      <div className={panelCls}>
        <div className="flex flex-wrap items-center gap-1.5 mb-1">
          <span className={labelCls + ' mb-0'}>Export for</span>
          {EXPORTS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setFmt(id)} className={`${btnCls} ${fmt === id ? 'border-cyan-600 text-cyan-300' : ''}`}>{label}</button>
          ))}
          <CopyBtn text={exported} label="Copy" />
        </div>
        <pre className="text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all max-h-40 overflow-auto">{exported || 'Nothing to export.'}</pre>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- shell

export default function SmartCardWorkbench({ onLogMessage } = {}) {
  const [tab, setTab] = useState('atr');
  const log = (t, level = 'info') => { try { onLogMessage?.(t, level); } catch { /* ignore */ } };
  const switchTab = (id) => { setTab(id); log(`Smart Card: ${id.toUpperCase()} tab`); };

  return (
    <div className="space-y-2 text-gray-200 text-sm">
      <details className="text-xs border rounded text-amber-200 bg-amber-950/30 border-amber-900">
        <summary className="cursor-pointer px-2 py-1.5 flex items-center gap-1.5">
          <Info size={13} className="shrink-0" />
          <span><span className="font-semibold">Smart Card toolkit.</span> Offline: nothing is read from hardware. (details)</span>
        </summary>
        <div className="px-2 pb-2 space-y-1">
          <div><span className="font-semibold">This page cannot drive a smart-card reader.</span> Chrome's WebUSB blocks the smart-card interface class (0x0B), so a CCID reader (contact or contactless) cannot be opened from a normal web page. The Web Smart Card API exists only for Isolated Web Apps.</div>
          <div>Paste data captured elsewhere: pcsc-tools output, a Proxmark3 <span className="font-mono">hf 14a apdu</span> session, a Flipper NFC dump, or a log. Nothing here is read from hardware.</div>
        </div>
      </details>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-800 pb-1.5" role="tablist">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => switchTab(id)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border ${tab === id ? 'border-cyan-600 text-cyan-300 bg-cyan-950/30' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      {tab === 'atr' && <AtrTab />}
      {tab === 'apdu' && <ApduTab />}
      {tab === 'trace' && <TraceTab />}
      {tab === 'tlv' && <TlvTab />}
      {tab === 'build' && <BuildTab />}
      {tab === 'script' && <ScriptTab />}
    </div>
  );
}
