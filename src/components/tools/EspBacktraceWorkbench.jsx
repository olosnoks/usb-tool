import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Check, Radio, Trash2, Upload } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  decodeBacktrace, formatReport, formatMarkdown, prepareElf, extractLatestPanic, annotateCrashText,
  parseAddressList, lookupAddresses, buildAddr2lineCommand, baseName,
} from '../../utils/espBacktrace.js';

/**
 * ESP32 / ESP8266 crash decoder. Offline: crash text + the firmware .elf -> function
 * names and file:line for the backtrace, registers and stack-dump code candidates.
 * Crash text comes from a paste or from the shared serial port (the last panic block
 * received while the port is connected).
 */

const RX_LIMIT = 200000;
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono';
const btnCls = 'px-2 py-1 text-[11px] rounded border bg-slate-900 border-slate-700 text-gray-300 hover:text-cyan-200 hover:border-cyan-800 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
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
    <section className="bg-[#171920] border border-slate-800 rounded p-2 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1.5">
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
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-xs">
        {rows.map(([k, v]) => (
          <React.Fragment key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-mono text-gray-200 break-all">{String(v)}</dd>
          </React.Fragment>
        ))}
      </dl>
      {c && c.explanation && <p className="mt-1.5 text-xs text-gray-300 leading-relaxed">{c.explanation}</p>}
      {!c && result.kind !== 'unknown' && <p className="mt-1.5 text-xs text-slate-500">No exception cause in the text.</p>}
    </Section>
  );
}

function FrameTable({ frames, hasElf, short }) {
  const path = (f) => (short ? baseName(f) : f);
  if (!frames.length) {
    return <p className="text-xs text-slate-500">No code addresses in this crash text.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead className="text-left text-slate-500">
          <tr className="border-b border-slate-800">
            <th className="py-0.5 pr-2 font-normal">#</th>
            <th className="py-0.5 pr-2 font-normal">Address</th>
            <th className="py-0.5 pr-2 font-normal">Function + offset</th>
            <th className="py-0.5 pr-2 font-normal">File:line</th>
            <th className="py-0.5 font-normal">Source of address</th>
          </tr>
        </thead>
        <tbody>
          {frames.map((f) => (
            <tr key={f.index} className="border-b border-slate-900 align-top">
              <td className="py-0.5 pr-2 text-slate-500">{f.index}</td>
              <td className="py-0.5 pr-2 text-cyan-300 whitespace-nowrap">
                {hex(f.pc)}
                {f.lookup !== f.pc && <div className="text-[10px] text-slate-500">looked up {hex(f.lookup)}</div>}
              </td>
              <td className="py-0.5 pr-2 text-gray-200 break-all">{f.func ? fnText(f) : (hasElf ? <span className="text-slate-600">??</span> : <span className="text-slate-600">no ELF</span>)}</td>
              <td className="py-0.5 pr-2 text-emerald-300 break-all">{f.file ? `${path(f.file)}:${f.line}` : <span className="text-slate-600">-</span>}</td>
              <td className="py-0.5 text-slate-400">{f.role}</td>
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
  const [shortPaths, setShortPaths] = useState(false);
  const [resultTab, setResultTab] = useState('frames'); // frames | annotated
  const [addrText, setAddrText] = useState('');
  const [addrReturn, setAddrReturn] = useState(false);
  const [addrArch, setAddrArch] = useState('xtensa');

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
  const markdownText = useMemo(() => (result ? formatMarkdown(result) : ''), [result]);
  const lineStatus = prepared ? LINE_STATUS[prepared.lineInfo] : null;
  const annotated = useMemo(() => (result && prepared ? annotateCrashText(panicText, prepared) : ''), [result, prepared, panicText]);
  const cliCommand = useMemo(() => {
    if (!result || !result.frames.length) return '';
    return buildAddr2lineCommand(result.frames.map((f) => f.lookup), {
      arch: result.arch, chip: result.chip, elfName: elfInfo ? elfInfo.name : 'build/app.elf',
    });
  }, [result, elfInfo]);
  const addrRows = useMemo(() => {
    const list = parseAddressList(addrText);
    return list.length ? lookupAddresses(list, prepared, { arch: addrArch, asReturn: addrReturn }) : [];
  }, [addrText, prepared, addrArch, addrReturn]);
  const recognised = result && (result.kind !== 'unknown' || result.arch !== 'unknown' || result.frames.length);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200 space-y-2">
      <div className="grid gap-2 @lg:grid-cols-2">
        <Section title="Firmware ELF" right={<span className="text-[10px] px-1.5 rounded border border-emerald-900 text-emerald-300 bg-emerald-950/30">offline</span>}>
          <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
            <span className={btnCls}><Upload size={12} /> {elfBusy ? 'Reading...' : 'Choose .elf file'}</span>
            <input type="file" accept=".elf,.axf,application/octet-stream" aria-label="Firmware ELF file" className="sr-only" onChange={onElfFile} disabled={elfBusy} />
          </label>
          {elfError && <p role="alert" className="mt-1.5 text-xs text-red-300">{elfError}</p>}
          {elfInfo && prepared && (
            <div className="mt-1.5 text-xs text-gray-300 space-y-0.5">
              <div className="font-mono break-all">{elfInfo.name} <span className="text-slate-500">({(elfInfo.size / 1024).toFixed(0)} KiB)</span></div>
              <div>Arch <span className="font-mono">{prepared.summary.arch}</span> · {prepared.summary.functionCount} functions · {prepared.summary.execRangeCount} exec section(s)</div>
              <div className={lineStatus.cls}>Lines: {lineStatus.text}{prepared.summary.lineRows ? ` (${prepared.summary.lineRows} rows, DWARF ${prepared.summary.dwarfVersions.join('/')})` : ''}</div>
              {prepared.lineNote && <div className="text-amber-300/90">{prepared.lineNote}</div>}
            </div>
          )}
          {!prepared && !elfError && <p className="mt-1.5 text-xs text-slate-500">Use the .elf from the build that crashed. Without it only raw addresses are shown. Nothing is uploaded.</p>}
        </Section>

        <Section title="Serial capture" right={<span className="text-[10px] text-slate-500 font-mono">{rxChars.toLocaleString()} chars</span>}>
          <p className="text-xs text-slate-400">
            {serial?.isConnected
              ? 'Port connected. The last panic block in the buffer can be loaded.'
              : 'Connect the serial port in the header; text is buffered only while it is open.'}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button type="button" onClick={useLatestFromSerial} className={btnCls}><Radio size={12} /> Use latest from serial</button>
            <button type="button" onClick={clearSerial} className={btnCls}><Trash2 size={12} /> Clear buffer</button>
          </div>
          {serialMsg && <p role="status" className="mt-1.5 text-xs text-slate-300">{serialMsg}</p>}
        </Section>
      </div>

      <Section title="Crash text" right={<button type="button" onClick={() => { setPanicText(''); setSerialMsg(''); }} disabled={!panicText} className={btnCls}>Clear text</button>}>
        <textarea
          aria-label="Crash text"
          value={panicText}
          onChange={(e) => setPanicText(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={'Paste the Guru Meditation / Backtrace / Exception block here, or use "Use latest from serial".'}
          className={`w-full ${inputCls} resize-y`}
        />
      </Section>

      {!result && (
        <p className="text-xs text-slate-500 border border-dashed border-slate-800 rounded p-2">
          Paste crash text (or use the serial buffer) to decode it. The ELF is optional.
        </p>
      )}

      {result && !recognised && (
        <p role="status" className="text-xs text-amber-300 border border-amber-900 bg-amber-950/20 rounded p-2">
          No ESP panic markers were recognised in this text. Expected a Guru Meditation Error, Backtrace:, abort() was called, a
          Fatal exception / Exception (n) block, or a register dump.
        </p>
      )}

      {result && recognised && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400">{result.frames.length} frame(s), {result.registers.length} register(s), {result.candidates.length} stack candidate(s).</span>
            <div className="flex flex-wrap items-center gap-1.5">
              <label className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                <input type="checkbox" checked={shortPaths} onChange={(e) => setShortPaths(e.target.checked)} /> Short paths
              </label>
              <CopyButton text={reportText} />
              <CopyButton text={markdownText} label="Copy as Markdown" />
            </div>
          </div>
          <div className="grid gap-2 @lg:grid-cols-2">
            <CauseCard result={result} />
            <Section title="Notes">
              {result.notes.length ? (
                <ul className="space-y-0.5 text-xs text-amber-200/90 list-disc pl-4">
                  {result.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              ) : <p className="text-xs text-slate-500">No warnings.</p>}
              {result.backtraceCorrupted && <p className="mt-1.5 text-xs text-amber-300">The backtrace is marked CORRUPTED: frames after the marker are not reliable.</p>}
            </Section>
          </div>
          <Section
            title="Backtrace"
            right={(
              <div role="tablist" aria-label="Backtrace view" className="flex gap-1">
                {[['frames', 'Frames'], ['annotated', 'Annotated text']].map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={resultTab === k}
                    onClick={() => setResultTab(k)}
                    className={`${btnCls} ${resultTab === k ? 'border-cyan-700 text-cyan-200' : ''}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          >
            {resultTab === 'frames' ? (
              <FrameTable frames={result.frames} hasElf={!!prepared} short={shortPaths} />
            ) : prepared ? (
              <div className="space-y-1.5">
                <div className="flex justify-end"><CopyButton text={annotated} label="Copy annotated" /></div>
                <pre aria-label="Annotated crash text" className="text-[11px] font-mono text-gray-300 bg-slate-950 border border-slate-800 rounded p-2 overflow-auto max-h-72 whitespace-pre">{annotated}</pre>
              </div>
            ) : <p className="text-xs text-slate-500">Load an ELF to annotate the crash text.</p>}
          </Section>
          {cliCommand && (
            <details className="bg-[#171920] border border-slate-800 rounded p-2">
              <summary className="text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer">addr2line command (CLI export)</summary>
              <p className="mt-1.5 text-[11px] text-slate-500">
                A command for the ESP toolchain on your PC that decodes the same lookup addresses. This tool does not run it; return addresses are already mapped. Adjust the ELF path.
              </p>
              <pre className="mt-1.5 text-[11px] font-mono text-gray-300 bg-slate-950 border border-slate-800 rounded p-2 overflow-auto whitespace-pre-wrap break-all">{cliCommand}</pre>
              <div className="mt-1.5"><CopyButton text={cliCommand} label="Copy command" /></div>
            </details>
          )}
          <Section title="Registers">
            <RegisterTable registers={result.registers} />
          </Section>
          {result.candidates.length > 0 && (
            <Section title="Stack-dump code candidates (not proven frames)">
              <p className="text-[11px] text-slate-500 mb-1.5">Values from the stack dump that point into this ELF's executable sections. They may be stale return addresses or plain data.</p>
              <CandidateTable candidates={result.candidates} />
            </Section>
          )}
        </div>
      )}

      <details className="bg-[#171920] border border-slate-800 rounded p-2">
        <summary className="text-[11px] uppercase tracking-wider text-slate-400 cursor-pointer">Address lookup (like addr2line)</summary>
        <div className="mt-1.5 space-y-1.5">
          <textarea
            aria-label="Addresses to look up"
            value={addrText}
            onChange={(e) => setAddrText(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="0x400d1234 0x400d5678 (any text; hex addresses are picked out)"
            className={`w-full ${inputCls} resize-y`}
          />
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={addrReturn} onChange={(e) => setAddrReturn(e.target.checked)} /> Treat as return addresses
            </label>
            <label className="inline-flex items-center gap-1">
              Arch
              <select aria-label="Architecture for return-address mapping" value={addrArch} onChange={(e) => setAddrArch(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[11px]">
                <option value="xtensa">Xtensa (ESP32/S2/S3)</option>
                <option value="riscv">RISC-V (C3/C6/H2)</option>
                <option value="esp8266">ESP8266</option>
              </select>
            </label>
          </div>
          {!prepared && addrRows.length > 0 && <p className="text-xs text-slate-500">Load an ELF to resolve these.</p>}
          {addrRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <tbody>
                  {addrRows.map((r) => (
                    <tr key={r.addr} className="border-b border-slate-900 align-top">
                      <td className="py-0.5 pr-2 text-cyan-300 whitespace-nowrap">{r.hex}{r.lookup !== r.addr && <span className="text-[10px] text-slate-500"> as {hex(r.lookup)}</span>}</td>
                      <td className="py-0.5 pr-2 text-gray-200 break-all">{r.func ? fnText(r) : '??'}</td>
                      <td className="py-0.5 text-emerald-300 break-all">{r.file ? `${shortPaths ? baseName(r.file) : r.file}:${r.line}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
