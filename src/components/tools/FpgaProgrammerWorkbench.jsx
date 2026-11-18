import React, { useState, useRef } from 'react';
import { Cpu, Usb, Zap, HardDrive, Upload, Play, Square, RefreshCw, CheckCircle2, AlertTriangle, Power, Search, Download, Eraser, Copy } from 'lucide-react';
import {
  Ice40Programmer,
  WebUsbFtdiTransport,
  BOARD_PRESETS,
  CLOCK_CHOICES_HZ,
  inspectBitstream,
  parseAddress,
  firstNonBlank,
  crc32Hex,
  buildCliCommands,
  ProgrammerCancelledError
} from '../../utils/fpgaProgrammer';

const hex = (n) => `0x${n.toString(16).toUpperCase()}`;

export default function FpgaProgrammerWorkbench({ onLogMessage }) {
  const [presetId, setPresetId] = useState(BOARD_PRESETS[0].id);
  const [clockHz, setClockHz] = useState(15e6);
  const [offsetText, setOffsetText] = useState('0');
  const [connected, setConnected] = useState(false);
  const [flash, setFlash] = useState(null);
  const [cdone, setCdone] = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [file, setFile] = useState(null); // { name, bytes, info }
  const [lengthText, setLengthText] = useState('');
  const [dump, setDump] = useState(null); // { offset, length, crc, blankAt }
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const programmerRef = useRef(null);

  const preset = BOARD_PRESETS.find((p) => p.id === presetId) || BOARD_PRESETS[0];
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;
  const offset = parseAddress(offsetText);
  const offsetValid = Number.isInteger(offset);
  const lengthParsed = parseAddress(lengthText);
  const lengthValid = lengthText.trim() === '' || (Number.isInteger(lengthParsed) && lengthParsed > 0);

  const addLog = (text, level = 'info') => {
    setLog((prev) => [...prev.slice(-299), { ts: new Date().toLocaleTimeString(), text, level }]);
    if (onLogMessage) onLogMessage(text, level);
  };

  const connect = async () => {
    if (busy || connected) return;
    setBusy('Connecting');
    setError('');
    let transport = null;
    try {
      transport = await WebUsbFtdiTransport.request();
      const programmer = new Ice40Programmer(transport, {
        log: (text) => addLog(text),
        onProgress: (p) => setProgress(p)
      });
      await programmer.connect({ clockHz });
      programmerRef.current = programmer;
      setConnected(true);
      addLog(`Connected: ${preset.chip} (${preset.name}), interface A.`);
    } catch (err) {
      programmerRef.current = null;
      if (transport) await transport.close();
      setError(err.message);
      addLog(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    const p = programmerRef.current;
    programmerRef.current = null;
    setConnected(false);
    setFlash(null);
    setCdone(null);
    setVerifyResult(null);
    setProgress(null);
    setDump(null);
    if (p) {
      try { await p.close(); } catch (e) { /* ignore */ }
      addLog('Disconnected. CRESET released.');
    }
  };

  /** Run one programmer job with the busy state; errors go to the error line and the log. */
  const run = async (label, fn) => {
    const p = programmerRef.current;
    if (busy || !p) return;
    setBusy(label);
    setError('');
    setVerifyResult(null);
    try {
      await fn(p);
    } catch (err) {
      if (err instanceof ProgrammerCancelledError) addLog('Stopped by user.');
      else {
        setError(err.message);
        addLog(err.message, 'error');
      }
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const detect = () => run('Detecting flash', async (p) => {
    const info = await p.detectFlash();
    setFlash(info);
  });

  const loadSram = () => run('Loading SRAM', async (p) => {
    const r = await p.programSram(file.bytes, { clockHz });
    setCdone(r.cdone);
  });

  const programFlash = () => run('Programming flash', async (p) => {
    if (!offsetValid) throw new Error('Flash offset is not a number.');
    await p.programFlash(file.bytes, { offset, clockHz });
    setFlash(p.flash);
    setCdone(null);
  });

  const verifyFlash = () => run('Verifying flash', async (p) => {
    if (!offsetValid) throw new Error('Flash offset is not a number.');
    const r = await p.verifyFlash(file.bytes, { offset });
    setVerifyResult(r);
  });

  const dumpRange = () => run('Reading flash', async (p) => {
    if (!offsetValid || !lengthValid) throw new Error('Offset or length is not a valid number.');
    const length = lengthText.trim() === '' ? undefined : lengthParsed;
    const data = await p.dumpFlash({ offset, length });
    const blankAt = firstNonBlank(data);
    setDump({ offset, length: data.length, crc: crc32Hex(data), blankAt });
    const blob = new Blob([data], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flash-${hex(offset).toLowerCase()}-${data.length}.bin`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    addLog(`Saved ${a.download}: CRC-32 ${crc32Hex(data)}${blankAt < 0 ? ', range is blank (all 0xFF)' : ''}.`);
  });

  const eraseAll = () => {
    if (!window.confirm('Erase the ENTIRE flash chip? Everything on it, including any bootloader or user data, is lost.')) return;
    return run('Erasing chip', async (p) => {
      await p.eraseChip();
      setDump(null);
    });
  };

  const copyText = async (text) => {
    try { await navigator.clipboard.writeText(text); addLog('Copied to clipboard.'); } catch (e) { addLog('Clipboard is not available.', 'error'); }
  };

  const stop = () => {
    programmerRef.current?.cancel();
    addLog('Stop requested; the current USB transfer finishes first.');
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const info = inspectBitstream(bytes);
    setFile({ name: f.name, bytes, info, crc: crc32Hex(bytes) });
    setCdone(null);
    setVerifyResult(null);
    if (info.ok) addLog(`Loaded ${f.name}: ${bytes.length} bytes, sync at ${hex(info.syncOffset)}.`);
    else addLog(`${f.name} is not an iCE40 bitstream: ${info.reason}`, 'error');
    info.warnings.forEach((w) => addLog(w));
  };

  const canProgram = connected && !busy && file?.info?.ok;
  const logLines = log.slice(-200);
  const cliMode = (m) => buildCliCommands({ mode: m, file: file?.name || 'bitstream.bin', offset: offsetValid ? offset : 0, chip: preset.chip });

  const card = 'bg-slate-900/60 border border-slate-800 rounded p-2.5 space-y-2';
  const input = 'mt-0.5 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 focus:outline-none focus:border-cyan-500/60';
  const btn = 'px-2 py-1 rounded border disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400';
  const neutral = `${btn} border-slate-600 text-slate-300 hover:bg-slate-800`;

  return (
    <div className="space-y-2 text-slate-200 font-mono text-[11px]">
      <div className="flex flex-wrap items-center gap-2">
        <Cpu size={14} className="text-cyan-400" />
        <span className="text-slate-400">Lattice iCE40 via FTDI MPSSE (WebUSB)</span>
        <span className={`ml-auto px-1.5 py-0.5 rounded border ${connected ? 'border-emerald-500/40 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>
          {connected ? 'CONNECTED' : 'NOT CONNECTED'}
        </span>
      </div>
      <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-950/30 p-1.5 text-amber-300">
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        <span>
          Written without hardware access: this has not been tested on a real board. Check the pin mapping against your board
          before writing flash, and keep a backup of the existing flash contents if you need one (use DUMP FLASH).
        </span>
      </div>
      {!webUsbAvailable && (
        <div className="rounded border border-rose-500/40 bg-rose-950/30 p-1.5 text-rose-300">
          WebUSB is not available in this browser. Use Chrome or Edge over HTTPS or localhost.
        </div>
      )}
      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-950/30 p-1.5 text-rose-300 break-words">{error}</div>
      )}

      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2">
        {/* Connection */}
        <section className={card}>
          <h3 className="text-slate-300 font-bold flex items-center gap-1.5"><Usb size={12} /> CONNECTION</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-slate-500">Board preset</span>
              <select value={presetId} onChange={(e) => setPresetId(e.target.value)} disabled={connected || !!busy} className={input}>
                {BOARD_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-slate-500">SPI clock</span>
              <select value={clockHz} onChange={(e) => setClockHz(Number(e.target.value))} disabled={!!busy} className={input}>
                {CLOCK_CHOICES_HZ.map((hz) => <option key={hz} value={hz}>{hz / 1e6} MHz</option>)}
              </select>
            </label>
          </div>
          <p className="text-slate-500 leading-snug">{preset.notes}</p>
          <div className="flex flex-wrap gap-1.5">
            {!connected ? (
              <button type="button" onClick={connect} disabled={!webUsbAvailable || !!busy} className={`${btn} border-cyan-500/50 text-cyan-300 hover:bg-cyan-950/40`}>
                CONNECT FTDI (WEBUSB)
              </button>
            ) : (
              <button type="button" onClick={disconnect} disabled={!!busy} className={neutral}>
                <Power size={11} className="inline mr-1" />DISCONNECT
              </button>
            )}
            <button type="button" onClick={detect} disabled={!connected || !!busy} className={neutral}>
              <Search size={11} className="inline mr-1" />DETECT FLASH
            </button>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-1.5 space-y-0.5">
            {flash ? (
              <div>Flash: JEDEC {flash.id} · {flash.manufacturer} · {flash.capacityBytes ? `${flash.capacityBytes / 1024} KB` : 'size unknown'}</div>
            ) : (
              <div className="text-slate-600">Flash: not read yet.</div>
            )}
            <div>
              <span className="text-slate-500">CDONE after last SRAM load: </span>
              {cdone === null ? <span className="text-slate-600">none this session</span> : cdone ? <span className="text-emerald-400">HIGH (FPGA running)</span> : <span className="text-rose-400">LOW (FPGA did not start)</span>}
            </div>
          </div>
          <details className="text-slate-500">
            <summary className="cursor-pointer text-slate-400">Driver setup</summary>
            <p className="leading-snug mt-1">
              Windows: bind WinUSB to interface 0 (Interface A) with Zadig, not the whole device. Linux: unbind ftdi_sio from interface 0.
            </p>
          </details>
        </section>

        {/* Bitstream and actions */}
        <section className={card}>
          <h3 className="text-slate-300 font-bold flex items-center gap-1.5"><HardDrive size={12} /> BITSTREAM</h3>
          <label className={`${neutral} inline-flex items-center gap-1.5 cursor-pointer`}>
            <Upload size={11} /> CHOOSE .BIN
            <input type="file" accept=".bin,application/octet-stream" className="hidden" onChange={onFile} />
          </label>
          {file ? (
            <div className="rounded border border-slate-800 bg-slate-950 p-1.5 space-y-0.5">
              <div className="text-slate-200 break-all">{file.name} · {file.bytes.length.toLocaleString()} bytes · CRC-32 {file.crc}</div>
              {file.info.ok ? (
                <div className="text-emerald-400">
                  Sync 7E AA 99 7E at {hex(file.info.syncOffset)}{file.info.hasLeader ? ' · FF 00 leader' : ''}
                </div>
              ) : (
                <div className="text-rose-400">{file.info.reason}</div>
              )}
            </div>
          ) : (
            <div className="text-slate-600">No bitstream chosen. Use an icepack .bin (not .asc or .hex).</div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-slate-500">Flash offset (dec or 0x hex)</span>
              <input
                value={offsetText}
                onChange={(e) => setOffsetText(e.target.value)}
                disabled={!!busy}
                aria-label="Flash offset"
                className={`${input} ${offsetValid ? '' : 'border-rose-500/60'}`}
              />
            </label>
            <label className="block">
              <span className="text-slate-500">Dump length (blank = to end)</span>
              <input
                value={lengthText}
                onChange={(e) => setLengthText(e.target.value)}
                disabled={!!busy}
                aria-label="Dump length"
                placeholder="whole chip"
                className={`${input} ${lengthValid ? '' : 'border-rose-500/60'}`}
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={loadSram} disabled={!canProgram} className={`${btn} border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/40`}>
              <Zap size={11} className="inline mr-1" />PROGRAM SRAM
            </button>
            <button type="button" onClick={programFlash} disabled={!canProgram || !offsetValid} className={`${btn} border-amber-500/50 text-amber-300 hover:bg-amber-950/40`}>
              <HardDrive size={11} className="inline mr-1" />PROGRAM FLASH
            </button>
            <button type="button" onClick={verifyFlash} disabled={!canProgram || !offsetValid} className={neutral}>
              <CheckCircle2 size={11} className="inline mr-1" />VERIFY FLASH
            </button>
            <button type="button" onClick={dumpRange} disabled={!connected || !!busy || !offsetValid || !lengthValid} title="Read flash and save it as a .bin file" className={neutral}>
              <Download size={11} className="inline mr-1" />DUMP FLASH
            </button>
            <button type="button" onClick={eraseAll} disabled={!connected || !!busy} title="Erase the whole flash chip (asks first)" className={`${btn} border-rose-500/40 text-rose-300 hover:bg-rose-950/40`}>
              <Eraser size={11} className="inline mr-1" />ERASE CHIP
            </button>
            <button type="button" onClick={stop} disabled={!busy} className={`${btn} border-rose-500/50 text-rose-300 hover:bg-rose-950/40`}>
              <Square size={11} className="inline mr-1" />STOP
            </button>
          </div>
          <div className="text-slate-600">Program flash = erase, write, read back and compare.</div>

          {busy && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-cyan-300"><RefreshCw size={11} className="animate-spin" />{busy}{progress?.stage ? ` · ${progress.stage}` : ''}</div>
              <div className="h-1.5 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.round((progress?.fraction || 0) * 100)}%` }} />
              </div>
            </div>
          )}

          {verifyResult && (
            <div className={`rounded border p-1.5 ${verifyResult.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-rose-500/40 text-rose-300'}`}>
              {verifyResult.ok
                ? `Verify OK: ${verifyResult.checked.toLocaleString()} bytes match the file.`
                : `Verify FAILED at ${hex(verifyResult.mismatchAt)} after ${verifyResult.checked.toLocaleString()} matching bytes.`}
            </div>
          )}
          {dump && (
            <div className="rounded border border-slate-700 bg-slate-950 p-1.5">
              Dumped {dump.length.toLocaleString()} bytes from {hex(dump.offset)} · CRC-32 {dump.crc}
              {dump.blankAt < 0 ? ' · blank (all 0xFF)' : ` · first data byte at ${hex(dump.offset + dump.blankAt)}`}
            </div>
          )}
        </section>
      </div>

      <details className={card}>
        <summary className="cursor-pointer text-slate-300 font-bold">EQUIVALENT CLI COMMANDS (copy only, not run)</summary>
        <div className="mt-2 space-y-1">
          {[['SRAM', 'sram'], ['Flash', 'flash'], ['Verify', 'verify']].map(([label, m]) => {
            const c = cliMode(m);
            return ['iceprog', 'openFPGALoader'].map((tool) => (
              <div key={`${m}-${tool}`} className="flex items-center gap-1.5">
                <span className="w-28 shrink-0 text-slate-500">{label} / {tool === 'iceprog' ? 'iceprog' : 'oFL'}</span>
                <code className="flex-1 min-w-0 break-all text-slate-300">{c[tool]}</code>
                <button type="button" onClick={() => copyText(c[tool])} title="Copy command" aria-label={`Copy ${label} ${tool} command`} className={`${neutral} px-1`}><Copy size={10} /></button>
              </div>
            ));
          })}
          <p className="text-slate-600 leading-snug">Check names with openFPGALoader --list-boards / --list-cables; your board may need a specific -b value.</p>
        </div>
      </details>

      <section className={card}>
        <div className="flex items-center gap-1.5">
          <h3 className="text-slate-300 font-bold flex items-center gap-1.5"><Play size={12} /> LOG</h3>
          <button type="button" onClick={() => copyText(log.map((l) => `${l.ts} ${l.text}`).join('\n'))} disabled={log.length === 0} title="Copy log" aria-label="Copy log" className={`${neutral} ml-auto px-1`}><Copy size={10} /></button>
          <button type="button" onClick={() => setLog([])} disabled={log.length === 0} className={`${neutral} px-1.5`}>CLEAR</button>
        </div>
        <div className="h-32 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-1.5 space-y-0.5">
          {logLines.length === 0 && <div className="text-slate-600">Nothing yet.</div>}
          {logLines.map((l, i) => (
            <div key={i} className={l.level === 'error' ? 'text-rose-400' : 'text-slate-400'}>
              <span className="text-slate-600">{l.ts}</span> {l.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
