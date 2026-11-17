import React, { useState, useRef } from 'react';
import { Cpu, Usb, Zap, HardDrive, Upload, Play, Square, RefreshCw, CheckCircle2, AlertTriangle, Power, Search } from 'lucide-react';
import {
  Ice40Programmer,
  WebUsbFtdiTransport,
  BOARD_PRESETS,
  CLOCK_CHOICES_HZ,
  inspectBitstream,
  ProgrammerCancelledError
} from '../../utils/fpgaProgrammer';

const parseAddress = (text) => {
  const t = String(text).trim();
  if (t === '') return 0;
  const n = /^0x/i.test(t) ? parseInt(t, 16) : Number(t);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
};

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
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const programmerRef = useRef(null);

  const preset = BOARD_PRESETS.find((p) => p.id === presetId) || BOARD_PRESETS[0];
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;
  const offset = parseAddress(offsetText);
  const offsetValid = Number.isInteger(offset);

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
    setFile({ name: f.name, bytes, info });
    setCdone(null);
    setVerifyResult(null);
    if (info.ok) addLog(`Loaded ${f.name}: ${bytes.length} bytes, sync at ${hex(info.syncOffset)}.`);
    else addLog(`${f.name} is not an iCE40 bitstream: ${info.reason}`, 'error');
    info.warnings.forEach((w) => addLog(w));
  };

  const canProgram = connected && !busy && file?.info?.ok;
  const logLines = log.slice(-200);

  return (
    <div className="p-4 space-y-4 text-slate-200 font-mono text-xs">
      <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu size={18} className="text-cyan-400" />
          <h2 className="text-sm font-bold tracking-wide text-slate-100">FPGA PROGRAMMER · LATTICE iCE40</h2>
          <span className={`ml-auto px-2 py-0.5 rounded border ${connected ? 'border-emerald-500/40 text-emerald-400' : 'border-slate-700 text-slate-500'}`}>
            {connected ? 'CONNECTED' : 'NOT CONNECTED'}
          </span>
        </div>
        <p className="text-slate-400 leading-relaxed">
          Programs iCE40 FPGAs through an FTDI FT2232H or FT232H (iCEstick, iCEBreaker, UPduino v3, Alchitry Cu)
          with MPSSE over WebUSB. Same flow as iceprog: SRAM (volatile) or SPI flash (persistent, verified).
        </p>
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-950/30 p-2 text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Written without hardware access: this has not been tested on a real board. Check the pin mapping against your board
            before writing flash, and keep a backup of the existing flash contents if you need one.
          </span>
        </div>
        {!webUsbAvailable && (
          <div className="rounded border border-rose-500/40 bg-rose-950/30 p-2 text-rose-300">
            WebUSB is not available in this browser. Use Chrome or Edge over HTTPS or localhost.
          </div>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-500/40 bg-rose-950/30 p-2 text-rose-300 break-words">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Connection */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-3">
          <h3 className="text-slate-300 font-bold flex items-center gap-2"><Usb size={14} /> CONNECTION</h3>
          <label className="block">
            <span className="text-slate-500">Board preset</span>
            <select
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              disabled={connected || !!busy}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5"
            >
              {BOARD_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <p className="text-slate-500 leading-relaxed">{preset.notes}</p>
          <label className="block">
            <span className="text-slate-500">SPI clock</span>
            <select
              value={clockHz}
              onChange={(e) => setClockHz(Number(e.target.value))}
              disabled={!!busy}
              className="mt-1 w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5"
            >
              {CLOCK_CHOICES_HZ.map((hz) => <option key={hz} value={hz}>{hz / 1e6} MHz</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                type="button"
                onClick={connect}
                disabled={!webUsbAvailable || !!busy}
                className="px-3 py-1.5 rounded border border-cyan-500/50 text-cyan-300 hover:bg-cyan-950/40 disabled:opacity-40"
              >
                CONNECT FTDI (WEBUSB)
              </button>
            ) : (
              <button
                type="button"
                onClick={disconnect}
                disabled={!!busy}
                className="px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
              >
                <Power size={12} className="inline mr-1" />DISCONNECT
              </button>
            )}
            <button
              type="button"
              onClick={detect}
              disabled={!connected || !!busy}
              className="px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <Search size={12} className="inline mr-1" />DETECT FLASH
            </button>
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-2 space-y-1">
            <div className="text-slate-500">Flash</div>
            {flash ? (
              <>
                <div>JEDEC {flash.id} · {flash.manufacturer}</div>
                <div>Capacity {flash.capacityBytes ? `${flash.capacityBytes / 1024} KB` : 'unknown (not checked)'}</div>
              </>
            ) : (
              <div className="text-slate-600">Not read yet.</div>
            )}
            <div className="text-slate-500 pt-1">CDONE after last SRAM load</div>
            <div>{cdone === null ? <span className="text-slate-600">no SRAM load in this session</span> : cdone ? <span className="text-emerald-400">HIGH (FPGA running)</span> : <span className="text-rose-400">LOW (FPGA did not start)</span>}</div>
          </div>
          <p className="text-slate-600 leading-relaxed">
            Windows: bind WinUSB to interface 0 (Interface A) with Zadig, not the whole device. Linux: unbind ftdi_sio from interface 0.
          </p>
        </section>

        {/* Bitstream and actions */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-lg p-4 space-y-3">
          <h3 className="text-slate-300 font-bold flex items-center gap-2"><HardDrive size={14} /> BITSTREAM</h3>
          <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer">
            <Upload size={12} /> CHOOSE .BIN
            <input type="file" accept=".bin,application/octet-stream" className="hidden" onChange={onFile} />
          </label>
          {file ? (
            <div className="rounded border border-slate-800 bg-slate-950 p-2 space-y-1">
              <div className="text-slate-200 break-all">{file.name}</div>
              <div>{file.bytes.length.toLocaleString()} bytes</div>
              {file.info.ok ? (
                <div className="text-emerald-400">
                  Sync word 7E AA 99 7E at {hex(file.info.syncOffset)}{file.info.hasLeader ? ' · 0xFF 0x00 leader present' : ''}
                </div>
              ) : (
                <div className="text-rose-400">{file.info.reason}</div>
              )}
            </div>
          ) : (
            <div className="text-slate-600">No bitstream chosen. Use an icepack .bin (not .asc or .hex).</div>
          )}

          <label className="block">
            <span className="text-slate-500">Flash offset (byte address; 0x prefix for hex)</span>
            <input
              value={offsetText}
              onChange={(e) => setOffsetText(e.target.value)}
              disabled={!!busy}
              className={`mt-1 w-full bg-slate-950 border rounded px-2 py-1.5 ${offsetValid ? 'border-slate-800' : 'border-rose-500/60'}`}
            />
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={loadSram}
              disabled={!canProgram}
              className="px-3 py-2 rounded border border-emerald-500/50 text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40"
            >
              <Zap size={12} className="inline mr-1" />PROGRAM SRAM (VOLATILE)
            </button>
            <button
              type="button"
              onClick={programFlash}
              disabled={!canProgram || !offsetValid}
              className="px-3 py-2 rounded border border-amber-500/50 text-amber-300 hover:bg-amber-950/40 disabled:opacity-40"
            >
              <HardDrive size={12} className="inline mr-1" />PROGRAM FLASH (ERASE + VERIFY)
            </button>
            <button
              type="button"
              onClick={verifyFlash}
              disabled={!canProgram || !offsetValid}
              className="px-3 py-2 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
            >
              <CheckCircle2 size={12} className="inline mr-1" />VERIFY FLASH
            </button>
            <button
              type="button"
              onClick={stop}
              disabled={!busy}
              className="px-3 py-2 rounded border border-rose-500/50 text-rose-300 hover:bg-rose-950/40 disabled:opacity-40"
            >
              <Square size={12} className="inline mr-1" />STOP
            </button>
          </div>

          {busy && (
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-cyan-300"><RefreshCw size={12} className="animate-spin" />{busy}{progress?.stage ? ` · ${progress.stage}` : ''}</div>
              <div className="h-2 rounded bg-slate-800 overflow-hidden">
                <div className="h-full bg-cyan-400 transition-all" style={{ width: `${Math.round((progress?.fraction || 0) * 100)}%` }} />
              </div>
            </div>
          )}

          {verifyResult && (
            <div className={`rounded border p-2 ${verifyResult.ok ? 'border-emerald-500/40 text-emerald-300' : 'border-rose-500/40 text-rose-300'}`}>
              {verifyResult.ok
                ? `Verify OK: ${verifyResult.checked.toLocaleString()} bytes match the file.`
                : `Verify FAILED at ${hex(verifyResult.mismatchAt)} after ${verifyResult.checked.toLocaleString()} matching bytes.`}
            </div>
          )}
        </section>
      </div>

      <section className="bg-slate-900/60 border border-slate-800 rounded-lg p-4">
        <h3 className="text-slate-300 font-bold mb-2 flex items-center gap-2"><Play size={14} /> LOG</h3>
        <div className="h-48 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-2 space-y-0.5">
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
