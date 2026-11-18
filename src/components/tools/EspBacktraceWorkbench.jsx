import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bug, Copy, Check, Radio, Trash2, Upload } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import { decodeBacktrace, formatReport, prepareElf, extractLatestPanic } from '../../utils/espBacktrace.js';

/**
 * ESP32 / ESP8266 crash decoder. Offline: crash text + the firmware .elf -> function
 * names and file:line for the backtrace, registers and stack-dump code candidates.
 * Crash text comes from a paste or from the shared serial port (the last panic block
 * received while the port is connected).
 */

const RX_LIMIT = 200000;
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1.5 text-xs font-mono';
const btnCls = 'px-2.5 py-1 text-xs rounded border bg-slate-900 border-slate-700 text-gray-300 hover:text-cyan-200 hover:border-cyan-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
const hex = (n) => (n === null || n === undefined ? '' : `0x${(n >>> 0).toString(16).padStart(8, '0')}`);
const fnText = (s) => (s.func ? `${s.func}${s.offset ? `+0x${s.offset.toString(16)}` : ''}` : '??');

const LINE_STATUS = {
  full: { text: 'file:line from DWARF .debug_line', cls: 'text-emerald-300' },
  partial: { text: 'file:line partly available', cls: 'text-amber-300' },
  'function-only': { text: 'function names only', cls: 'text-amber-300' },
  none: { text: 'no line info (no .debug_line)', cls: 'text-slate-400' },
};

function CopyButton({ text, label = 'Copy as text', disabled }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button type="button" onClick={copy} disabled={disabled} className={btnCls}>
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : label}
    </button>
  );
}

function Section({ title, children, right }) {
  return (
    <section className="bg-[#171920] border border-slate-800 rounded p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-[11px] uppercase tracking-wider text-slate-400">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

function CauseCard({ result }) {
  const c = result.cause;
  const rows = [
    ['Kind', result.kind],
    ['Architecture', `${result.arch}${result.chip ? ` (${result.chip})` : ''}`],
    result.core !== null && result.core !== undefined && ['Core', result.core],
    c && ['Cause', c.name + (c.code !== null && c.code !== undefined ? ` (${c.code})` : '')],
    result.faultAddress !== null && result.faultAddress !== undefined && [`Fault address (${result.faultRegister})`, hex(result.faultAddress)],
    result.assert && ['Assert', `${result.assert.file}:${result.assert.line} in ${result.assert.func}${result.assert.expr ? ` (${result.assert.expr})` : ''}`],
    result.reset && ['Reset reason', `${result.reset.name}${result.reset.boot ? ` / boot ${result.reset.boot}` : ''}`],
  ].filter(Boolean);
  return (
    <Section title="Cause">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-mono text-gray-200 break-all">{String(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      {c && c.explanation && <p className="mt-2 text-xs text-gray-300 leading-relaxed">{c.explanation}</p>}
      {!c && result.kind !== 'unknown' && <p className="mt-2 text-xs text-slate-500">No exception cause in the text.</p>}
    </Section>
  );
}

function FrameTable({ frames, hasElf }) {
  if (!frames.length) {
    return <p className="text-xs text-slate-500">No code addresses in this crash text.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead className="text-left text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="py-1 pr-2 font-normal">#</th>
            <th className="py-1 pr-2 font-normal">Address</th>
            <th className="py-1 pr-2 font-normal">Function + offset</th>
            <th className="py-1 pr-2 font-normal">File:line</th>
            <th className="py-1 font-normal">Source of address</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((f) => (
            <tr key={f.index} className="border-b border-slate-900 align-top">
              <td className="py-1 pr-2 text-slate-500">{f.index}</td>
              <td className="py-1 pr-2 text-cyan-300 whitespace-nowrap">
                {hex(f.pc)}
                {f.lookup !== f.pc && <div className="text-[10px] text-slate-500">looked up {hex(f.lookup)}</div>}
              </td>
              <td className="py-1 pr-2 text-gray-200 break-all">{f.func ? fnText(f) : (hasElf ? <span className="text-slate-600">??</span> : <span className="text-slate-600">no ELF</span>)}</td>
              <td className="py-1 pr-2 text-emerald-300 break-all">{f.file ? `${f.file}:${f.line}` : <span className="text-slate-600">-</span>}</td>
              <td className="py-1 text-slate-400">{f.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterTable({ registers }) {
  if (!registers.length) return <p className="text-xs text-slate-500">No register dump in this text.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <tbody>
          {registers.map((r) => (
            <tr key={r.name} className="border-b border-slate-900">
              <td className="py-0.5 pr-3 text-slate-500 whitespace-nowrap">{r.name}</td>
              <td className="py-0.5 pr-3 text-gray-200 whitespace-nowrap">{r.hex}</td>
              <td className="py-0.5 text-gray-300 break-all">
                {r.symbol ? (
                  <>
                    {fnText(r.symbol)}
                    {r.symbol.file && <span className="text-emerald-300"> {r.symbol.file}:{r.symbol.line}</span>}
                    {r.isReturn && <span className="text-slate-600"> (return address)</span>}
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CandidateTable({ candidates }) {
  if (!candidates.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <tbody>
          {candidates.map((c) => (
            <tr key={c.addr} className="border-b border-slate-900">
              <td className="py-0.5 pr-3 text-cyan-300 whitespace-nowrap">{c.hex}</td>
              <td className="py-0.5 pr-3 text-gray-200 break-all">{c.func ? fnText(c) : '??'}</td>
              <td className="py-0.5 text-emerald-300 break-all">{c.file ? `${c.file}:${c.line}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function EspBacktraceWorkbench({ onLogMessage }) {
  const serial = useOptionalSerial();
  const subscribeRx = serial?.subscribeRx;
  const rxRef = useRef('');
  const [rxChars, setRxChars] = useState(0);
  const [serialMsg, setSerialMsg] = useState('');
  const [panicText, setPanicText] = useState('');
  const [prepared, setPrepared] = useState(null);
  const [elfInfo, setElfInfo] = useState(null); // {name, size}
  const [elfError, setElfError] = useState('');
  const [elfBusy, setElfBusy] = useState(false);

  // Buffer serial text while mounted (only fills while the shared port is connected).
  useEffect(() => {
    if (!subscribeRx) return undefined;
    const dec = new TextDecoder();
    const unsub = subscribeRx((bytes) => {
      rxRef.current = (rxRef.current + dec.decode(bytes, { stream: true })).slice(-RX_LIMIT);
      setRxChars(rxRef.current.length);
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  }, [subscribeRx]);

  const useLatestFromSerial = () => {
    const found = extractLatestPanic(rxRef.current);
    if (!found.found) {
      setSerialMsg(rxRef.current.length
        ? 'No panic block in the serial text buffered so far.'
        : 'Nothing buffered yet. Connect the serial port in the header; text is captured while it is open.');
      return;
    }
    setPanicText(found.text);
    setSerialMsg('Loaded the most recent panic block from the serial buffer.');
    onLogMessage?.('ESP backtrace: loaded latest panic block from serial', 'info');
  };

  const clearSerial = () => {
    rxRef.current = '';
    setRxChars(0);
    setSerialMsg('Serial buffer cleared.');
  };

  const onElfFile = async (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    setElfBusy(true);
    setElfError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const p = prepareElf(bytes);
      setPrepared(p);
      setElfInfo({ name: file.name, size: file.size });
      onLogMessage?.(`ESP backtrace: loaded ${file.name} (${p.summary.functionCount} functions, line info: ${p.lineInfo})`, 'info');
    } catch (err) {
      setPrepared(null);
      setElfInfo(null);
      setElfError(err.message);
    } finally {
      setElfBusy(false);
      input.value = '';
    }
  };

  const result = useMemo(
    () => (panicText.trim() ? decodeBacktrace(panicText, prepared) : null),
    [panicText, prepared],
  );
  const reportText = useMemo(() => (result ? formatReport(result) : ''), [result]);
  const lineStatus = prepared ? LINE_STATUS[prepared.lineInfo] : null;
  const recognised = result && (result.kind !== 'unknown' || result.arch !== 'unknown' || result.frames.length);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Bug size={16} className="text-rose-400 shrink-0" />
        <h2 className="text-sm font-semibold text-gray-100">ESP Backtrace Decoder</h2>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-emerald-900 text-emerald-300 bg-emerald-950/30">offline</span>
      </div>
      <p className="text-xs text-slate-400 leading-relaxed">
        Decodes an ESP32 (Xtensa or RISC-V) or ESP8266 crash into function names and file:line, the way
        <code className="text-slate-300"> idf.py monitor</code> and the Arduino exception decoder do. Everything runs in
        this browser; nothing is uploaded. Use the <span className="text-slate-300">.elf from the same build</span> that crashed.
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <Section title="1. Firmware ELF" right={null}>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <span className={btnCls}><Upload size={12} /> {elfBusy ? 'Reading...' : 'Choose .elf file'}</span>
            <input type="file" accept=".elf,.axf,application/octet-stream" aria-label="Firmware ELF file" className="sr-only" onChange={onElfFile} disabled={elfBusy} />
          </label>
          {elfError && <p role="alert" className="mt-2 text-xs text-red-300">{elfError}</p>}
          {elfInfo && prepared && (
            <div className="mt-2 text-xs text-gray-300 space-y-0.5">
              <div className="font-mono break-all">{elfInfo.name} <span className="text-slate-500">({(elfInfo.size / 1024).toFixed(0)} KiB)</span></div>
              <div>Arch <span className="font-mono">{prepared.summary.arch}</span> · {prepared.summary.functionCount} functions · {prepared.summary.execRangeCount} executable section(s)</div>
              <div className={lineStatus.cls}>Lines: {lineStatus.text}{prepared.summary.lineRows ? ` (${prepared.summary.lineRows} rows, DWARF ${prepared.summary.dwarfVersions.join('/')})` : ''}</div>
              {prepared.lineNote && <div className="text-amber-300/90">{prepared.lineNote}</div>}
            </div>
          )}
          {!prepared && !elfError && <p className="mt-2 text-xs text-slate-500">No ELF loaded. Addresses will be shown without names until you load one.</p>}
        </Section>

        <Section title="2. Serial capture" right={<span className="text-[10px] text-slate-500 font-mono">{rxChars.toLocaleString()} chars buffered</span>}>
          <p className="text-xs text-slate-400">
            {serial?.isConnected
              ? 'The serial port is connected. The last panic block in the buffer can be loaded below.'
              : 'Connect the serial port in the header to capture crash output. Text is buffered only while the port is connected.'}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={useLatestFromSerial} className={btnCls}><Radio size={12} /> Use latest from serial</button>
            <button type="button" onClick={clearSerial} className={btnCls}><Trash2 size={12} /> Clear buffer</button>
          </div>
          {serialMsg && <p role="status" className="mt-2 text-xs text-slate-300">{serialMsg}</p>}
        </Section>
      </div>

      <Section title="3. Crash text" right={<button type="button" onClick={() => { setPanicText(''); setSerialMsg(''); }} disabled={!panicText} className={btnCls}>Clear text</button>}>
        <textarea
          aria-label="Crash text"
          value={panicText}
          onChange={(e) => setPanicText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'Paste the Guru Meditation / Backtrace / Exception block here, or use "Use latest from serial".'}
          className={`w-full ${inputCls} resize-y`}
        />
      </Section>

      {!result && (
        <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded p-3">
          Paste crash text (or use the serial buffer) to decode it. The ELF is optional, but without it you only get raw addresses.
        </p>
      )}

      {result && !recognised && (
        <p role="status" className="text-xs text-amber-300 border border-amber-900 bg-amber-950/20 rounded p-3">
          No ESP panic markers were recognised in this text. Expected a Guru Meditation Error, Backtrace:, abort() was called, a
          Fatal exception / Exception (n) block, or a register dump.
        </p>
      )}

      {result && recognised && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">Decoded {result.frames.length} frame(s), {result.registers.length} register(s), {result.candidates.length} stack candidate(s).</span>
            <CopyButton text={reportText} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <CauseCard result={result} />
            <Section title="Notes">
              {result.notes.length ? (
                <ul className="space-y-1 text-xs text-amber-200/90 list-disc pl-4">
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              ) : <p className="text-xs text-slate-500">No warnings.</p>}
              {result.backtraceCorrupted && <p className="mt-2 text-xs text-amber-300">The backtrace is marked CORRUPTED: frames after the marker are not reliable.</p>}
            </Section>
          </div>
          <Section title="Backtrace">
            <FrameTable frames={result.frames} hasElf={!!prepared} />
          </Section>
          <Section title="Registers">
            <RegisterTable registers={result.registers} />
          </Section>
          {result.candidates.length > 0 && (
            <Section title="Stack-dump code candidates (not proven frames)">
              <p className="text-[11px] text-slate-500 mb-2">Values from the stack dump that point into this ELF's executable sections. They may be stale return addresses or plain data.</p>
              <CandidateTable candidates={result.candidates} />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}
