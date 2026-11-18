import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Usb, Power, PowerOff, Download, Upload, Cpu, HardDrive, ShieldAlert, Loader2, RotateCcw, CheckCircle2, AlertTriangle, Eraser, Search } from 'lucide-react';
import {
  PICOBOOT_USB_FILTERS, PicobootConnection, PicobootError, XIP_BASE, FLASH_SECTOR_SIZE, WRITE_CHUNK_SIZE, READ_CHUNK_SIZE,
  chipFromPid, findPicobootInterface, planFlashWrite, uf2ToFlashImage, formatRange, parseBinaryInfo, PICOBOOT_EXCLUSIVE,
} from '../../utils/picoboot';

const SCAN_BYTES = 64 * 1024; // how much flash the connect step reads for vectors and binary_info
const hex = (n, w = 6) => `0x${(n >>> 0).toString(16).padStart(w, '0')}`;
const fmtBytes = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(2)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

function download(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hexDump(bytes, length = 256) {
  const rows = [];
  for (let i = 0; i < Math.min(length, bytes.length); i += 16) {
    const chunk = bytes.subarray(i, Math.min(i + 16, bytes.length));
    const txt = Array.from(chunk, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const asc = Array.from(chunk, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    rows.push(`${hex(i)}  ${txt.padEnd(47)}  ${asc}`);
  }
  return rows.join('\n');
}

/** Read `length` bytes from XIP address `addr` in READ_CHUNK_SIZE pieces. */
async function readFlash(conn, addr, length, onProgress) {
  const out = new Uint8Array(length);
  for (let done = 0; done < length; done += READ_CHUNK_SIZE) {
    const n = Math.min(READ_CHUNK_SIZE, length - done);
    const part = await conn.read(addr + done, n);
    if (!part || part.length !== n) throw new PicobootError(`Short read at ${hex(addr + done)}: got ${part?.length ?? 0} of ${n}`);
    out.set(part, done);
    onProgress?.(done + n, length);
  }
  return out;
}

export default function PicobootWorkbench({ onLogMessage }) {
  const [device, setDevice] = useState(null);
  const [conn, setConn] = useState(null);
  const [chip, setChip] = useState(null);
  const [iface, setIface] = useState(null);
  const [vectors, setVectors] = useState(null); // { sp, reset }
  const [dump, setDump] = useState('');
  const [binInfo, setBinInfo] = useState(null);
  const [busy, setBusy] = useState(null); // label of the running operation
  const [progress, setProgress] = useState(null); // { done, total }
  const [readOffset, setReadOffset] = useState('0x000000');
  const [readLength, setReadLength] = useState('0x010000');
  const [writeOffset, setWriteOffset] = useState('0x000000');
  const [writeFile, setWriteFile] = useState(null); // { name, bytes, kind }
  const [writeConfirmed, setWriteConfirmed] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const connRef = useRef(null);

  const webUsbAvailable = typeof navigator !== 'undefined' && !!navigator.usb;
  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;

  const addLog = useCallback((text, level = 'info') => {
    setLog((prev) => [...prev.slice(-199), { ts: new Date().toLocaleTimeString(), text, level }]);
    if (typeof onLogMessage === 'function') onLogMessage(`[PICOBOOT] ${text}`, level);
  }, [onLogMessage]);

  useEffect(() => () => {
    connRef.current?.close().catch(() => {});
  }, []);

  /** Serialise flash operations; one at a time over the single bulk pipe. */
  const run = async (label, fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    setError('');
    setProgress(null);
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message || String(err);
      setError(msg);
      addLog(`${label} failed: ${msg}`, 'error');
      return undefined;
    } finally {
      busyRef.current = false;
      setBusy(null);
      setProgress(null);
    }
  };

  const reportProgress = (done, total) => setProgress({ done, total });

  const connect = () => run('Connect', async () => {
    const dev = await navigator.usb.requestDevice({ filters: PICOBOOT_USB_FILTERS });
    const found = findPicobootInterface(dev);
    if (!found) throw new PicobootError('This device has no PICOBOOT vendor interface. Put the board in BOOTSEL mode (hold BOOTSEL while plugging in, or use the reboot-to-BOOTSEL option of the running app).');
    const c = new PicobootConnection(dev, found);
    await c.open();
    try {
      await c.resetInterface();
    } catch (e) {
      addLog(`Interface reset request not accepted (${e.message}); continuing.`, 'warn');
    }
    await c.exclusiveAccess(PICOBOOT_EXCLUSIVE.EXCLUSIVE);
    const scan = await readFlash(c, XIP_BASE, SCAN_BYTES);
    const dv = new DataView(scan.buffer);
    setVectors({ sp: dv.getUint32(0, true), reset: dv.getUint32(4, true) });
    setDump(hexDump(scan, 256));
    setBinInfo(parseBinaryInfo(scan));
    connRef.current = c;
    setConn(c);
    setDevice(dev);
    setChip(chipFromPid(dev.productId));
    setIface(found);
    addLog(`Connected: ${chipFromPid(dev.productId) ?? 'unknown chip'} PID ${hex(dev.productId, 4)}, interface ${found.interfaceNumber} (bulk OUT ${found.outEndpoint}, IN ${found.inEndpoint}).`);
    addLog(`Read the first ${fmtBytes(SCAN_BYTES)} of flash for the vector table and binary_info.`);
  });

  const disconnect = async () => {
    const c = connRef.current;
    connRef.current = null;
    setConn(null); setDevice(null); setChip(null); setIface(null); setVectors(null); setDump(''); setBinInfo(null); setVerifyResult(null);
    if (c) await c.close();
    addLog('Disconnected and released the PICOBOOT interface.');
  };

  const rescan = () => run('Rescan', async () => {
    const c = connRef.current;
    if (!c) return;
    const scan = await readFlash(c, XIP_BASE, SCAN_BYTES, reportProgress);
    const dv = new DataView(scan.buffer);
    setVectors({ sp: dv.getUint32(0, true), reset: dv.getUint32(4, true) });
    setDump(hexDump(scan, 256));
    setBinInfo(parseBinaryInfo(scan));
    addLog('Flash scan refreshed.');
  });

  const doRead = () => run('Read', async () => {
    const c = connRef.current;
    if (!c) return;
    const off = parseNum(readOffset);
    const len = parseNum(readLength);
    if (off === null || len === null || len <= 0) throw new PicobootError('Enter a valid offset and a length greater than zero (hex or decimal).');
    if (off + len > 16 * 1024 * 1024) throw new PicobootError('Range runs past 16 MB.');
    addLog(`Reading ${fmtBytes(len)} from offset ${hex(off)}.`);
    const bytes = await readFlash(c, XIP_BASE + off, len, reportProgress);
    download(bytes, `flash_${hex(off, 6)}_${len}.bin`);
    addLog(`Read ${fmtBytes(len)} OK and saved as .bin.`);
  });

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setWriteConfirmed(false);
    setVerifyResult(null);
    if (!file) return setWriteFile(null);
    const name = file.name.toLowerCase();
    if (!name.endsWith('.bin') && !name.endsWith('.uf2')) {
      setError('Only .bin and .uf2 are accepted here. Convert Intel HEX first.');
      return setWriteFile(null);
    }
    setError('');
    const buf = await file.arrayBuffer();
    setWriteFile({ name: file.name, buffer: buf, kind: name.endsWith('.uf2') ? 'uf2' : 'bin', size: buf.byteLength });
  };

  /** Resolve the image and the flash offset it writes to (UF2 carries its own addresses). */
  const resolveImage = () => {
    if (!writeFile) throw new PicobootError('Choose a .bin or .uf2 file first.');
    if (writeFile.kind === 'uf2') {
      const img = uf2ToFlashImage(writeFile.buffer);
      return { data: img.data, offset: img.flashOffset, source: 'UF2 addresses' };
    }
    const off = parseNum(writeOffset);
    if (off === null) throw new PicobootError('Enter a valid write offset.');
    return { data: new Uint8Array(writeFile.buffer), offset: off, source: 'offset field' };
  };

  const plan = useMemo(() => {
    try {
      if (!writeFile) return null;
      const img = writeFile.kind === 'uf2'
        ? (() => { const u = uf2ToFlashImage(writeFile.buffer); return { data: u.data, offset: u.flashOffset, source: 'UF2 addresses' }; })()
        : (() => {
          const off = parseNum(writeOffset);
          if (off === null) throw new PicobootError('Enter a valid write offset.');
          return { data: new Uint8Array(writeFile.buffer), offset: off, source: 'offset field' };
        })();
      const p = planFlashWrite(img.data, img.offset);
      return { ...p, source: img.source, error: null };
    } catch (err) {
      return { error: err.message };
    }
  }, [writeFile, writeOffset]);

  const doWrite = () => run('Write', async () => {
    const c = connRef.current;
    if (!c) return;
    const img = resolveImage();
    const p = planFlashWrite(img.data, img.offset);
    setVerifyResult(null);
    addLog(`Erase ${formatRange(p.eraseStart, p.eraseSize)} (${p.eraseSize / FLASH_SECTOR_SIZE} sectors), then program ${fmtBytes(p.image.length)}.`);
    try {
      await c.exitXip();
      await c.flashErase(XIP_BASE + p.eraseStart, p.eraseSize);
      setProgress({ done: 0, total: p.image.length });
      for (let done = 0; done < p.image.length; done += WRITE_CHUNK_SIZE) {
        const part = p.image.subarray(done, Math.min(done + WRITE_CHUNK_SIZE, p.image.length));
        await c.write(XIP_BASE + p.writeStart + done, part);
        reportProgress(done + part.length, p.image.length);
      }
    } finally {
      try { await c.enterCmdXip(); } catch (e) { addLog(`Could not restore XIP mode: ${e.message}`, 'warn'); }
    }
    addLog('Program complete. Verifying by reading back...');
    const back = await readFlash(c, XIP_BASE + p.writeStart, p.image.length, reportProgress);
    let mismatches = 0;
    let first = -1;
    for (let i = 0; i < p.image.length; i++) {
      if (back[i] !== p.image[i]) { mismatches++; if (first < 0) first = i; }
    }
    const result = mismatches === 0
      ? { ok: true, text: `Verify OK: ${fmtBytes(p.image.length)} match.` }
      : { ok: false, text: `Verify FAILED: ${mismatches} byte(s) differ, first at ${hex(p.writeStart + first)}.` };
    setVerifyResult(result);
    addLog(result.text, result.ok ? 'info' : 'error');
  });

  const doReboot = (target) => run('Reboot', async () => {
    const c = connRef.current;
    if (!c) return;
    if (target === 'bootsel' && chip !== 'RP2350') {
      throw new PicobootError('Reboot to BOOTSEL over PICOBOOT is only wired for RP2350 here. On RP2040 use the BOOTSEL button.');
    }
    addLog(target === 'bootsel' ? 'Rebooting back into BOOTSEL...' : 'Rebooting to the application...');
    const r = await c.reboot(chip, target);
    connRef.current = null;
    setConn(null); setDevice(null); setChip(null); setIface(null); setVectors(null); setDump(''); setBinInfo(null);
    addLog(r.disconnectedAfterCommand ? 'Reboot sent. The device disconnected as expected; reconnect to continue.' : 'Reboot command acknowledged.');
  });

  const busyNow = !!busy;
  const connected = !!conn;
  const sp = vectors?.sp ?? null;
  const spLooksRam = sp !== null && sp >= 0x20000000 && sp < 0x20100000;
  const resetLooksFlash = vectors && (vectors.reset >>> 24) === 0x10;

  return (
    <div className="h-full overflow-auto bg-slate-950 text-slate-200 p-4 font-sans text-sm">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <Cpu className="w-5 h-5 text-cyan-400" />
          <h2 className="text-base font-semibold">Raspberry Pi PICOBOOT (RP2040 / RP2350)</h2>
          <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${connected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
            {connected ? `CONNECTED · ${chip ?? 'unknown'}` : 'NOT CONNECTED'}
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-amber-700 text-amber-300">UNTESTED ON HARDWARE</span>
          <div className="ml-auto flex gap-2">
            {!connected ? (
              <button onClick={connect} disabled={busyNow || !webUsbAvailable}
                className="flex items-center gap-2 px-3 py-1.5 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-xs font-mono">
                {busy === 'Connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Usb className="w-4 h-4" />} CONNECT PICOBOOT (WEBUSB)
              </button>
            ) : (
              <button onClick={disconnect} disabled={busyNow}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-slate-700 hover:bg-slate-800 text-xs font-mono">
                <PowerOff className="w-4 h-4" /> DISCONNECT
              </button>
            )}
          </div>
        </header>

        {!webUsbAvailable && (
          <div className="flex gap-2 items-start p-3 rounded border border-amber-800 bg-amber-950/40 text-amber-200 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            WebUSB is not available here. Use Chrome, Edge or Opera on a desktop{!isSecureContext ? ' over HTTPS (this page is not a secure context)' : ''}.
          </div>
        )}

        <p className="text-xs text-slate-400">
          Connects to the PICOBOOT vendor interface of a board in BOOTSEL mode (USB IDs 2e8a:0003 RP2040, 2e8a:000f RP2350).
          The mass-storage (UF2 drive) interface is not claimed. Nothing is written until you press Write.
        </p>

        {error && (
          <div className="flex gap-2 items-start p-3 rounded border border-rose-800 bg-rose-950/40 text-rose-200 text-xs font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-3 text-xs font-mono text-cyan-300">
            <Loader2 className="w-4 h-4 animate-spin" /> {busy}…
            {progress && progress.total > 0 && (
              <span className="text-slate-400">{Math.round((progress.done / progress.total) * 100)}% ({fmtBytes(progress.done)} / {fmtBytes(progress.total)})</span>
            )}
          </div>
        )}

        {connected && (
          <div className="grid md:grid-cols-2 gap-4">
            <section className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2"><HardDrive className="w-4 h-4" /> Device</h3>
              <dl className="text-xs font-mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-slate-500">chip</dt><dd>{chip ?? 'unknown'} (from PID {hex(device?.productId ?? 0, 4)})</dd>
                <dt className="text-slate-500">interface</dt><dd>{iface?.interfaceNumber} (vendor, bulk OUT {iface?.outEndpoint} / IN {iface?.inEndpoint})</dd>
                <dt className="text-slate-500">vector SP</dt><dd>{sp !== null ? hex(sp, 8) : '—'} {spLooksRam ? <span className="text-emerald-400">RAM stack pointer</span> : sp !== null ? <span className="text-amber-400">not a RAM address</span> : ''}</dd>
                <dt className="text-slate-500">reset vector</dt><dd>{vectors ? hex(vectors.reset, 8) : '—'} {resetLooksFlash ? <span className="text-emerald-400">in flash</span> : vectors ? <span className="text-amber-400">not in flash (blank or RAM image?)</span> : ''}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={rescan} disabled={busyNow} className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 text-xs font-mono flex items-center gap-1"><RotateCcw className="w-3 h-3" /> rescan flash</button>
                <button onClick={() => doReboot('app')} disabled={busyNow} className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 text-xs font-mono flex items-center gap-1"><Power className="w-3 h-3" /> reboot to app</button>
                <button onClick={() => doReboot('bootsel')} disabled={busyNow || chip !== 'RP2350'} title="RP2350 only" className="px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40 text-xs font-mono flex items-center gap-1"><Usb className="w-3 h-3" /> reboot to BOOTSEL (RP2350)</button>
              </div>
            </section>

            <section className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2"><Search className="w-4 h-4" /> binary_info (picotool info)</h3>
              {!binInfo && <p className="text-xs text-slate-500">Scanning...</p>}
              {binInfo && !binInfo.found && <p className="text-xs text-slate-500">No binary_info header in the first {fmtBytes(SCAN_BYTES)} of flash. The image may be blank or not built with the pico-sdk.</p>}
              {binInfo?.found && (
                <div className="text-xs font-mono space-y-1">
                  <div className="text-slate-500">header at flash offset {hex(binInfo.headerOffset)}; {binInfo.entries.length} entries</div>
                  {binInfo.program.strings?.length > 0 && (
                    <ul className="list-disc pl-4 text-slate-200">{binInfo.program.strings.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  )}
                  {binInfo.program.strings?.length === 0 && <div className="text-slate-500">No string entries with the Raspberry Pi tag (RP).</div>}
                  {binInfo.program.pinEntries > 0 && <div className="text-amber-400">{binInfo.program.pinEntries} pin/other entries found; pin decoding is not implemented.</div>}
                </div>
              )}
            </section>

            <section className="md:col-span-2 rounded border border-slate-800 bg-slate-900/60 p-3">
              <h3 className="text-xs font-semibold text-slate-300 mb-2">First 256 bytes of flash (0x10000000)</h3>
              <pre className="text-[11px] leading-4 text-emerald-300 overflow-x-auto whitespace-pre">{dump || '—'}</pre>
            </section>

            <section className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2"><Download className="w-4 h-4" /> Read flash to .bin</h3>
              <div className="flex gap-2 items-center text-xs font-mono">
                <label className="text-slate-500 w-14">offset</label>
                <input value={readOffset} onChange={(e) => setReadOffset(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
              </div>
              <div className="flex gap-2 items-center text-xs font-mono">
                <label className="text-slate-500 w-14">length</label>
                <input value={readLength} onChange={(e) => setReadLength(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
              </div>
              <button onClick={doRead} disabled={busyNow} className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-mono flex items-center gap-2"><Download className="w-4 h-4" /> READ AND DOWNLOAD</button>
            </section>

            <section className="rounded border border-slate-800 bg-slate-900/60 p-3 space-y-2">
              <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2"><Upload className="w-4 h-4" /> Write .bin or .uf2</h3>
              <input type="file" accept=".bin,.uf2" onChange={onPickFile} disabled={busyNow} className="text-xs" />
              {writeFile && <div className="text-xs font-mono text-slate-400">{writeFile.name} · {fmtBytes(writeFile.size)} · {writeFile.kind === 'uf2' ? 'UF2 (addresses from file)' : 'raw .bin'}</div>}
              {writeFile?.kind === 'bin' && (
                <div className="flex gap-2 items-center text-xs font-mono">
                  <label className="text-slate-500 w-14">offset</label>
                  <input value={writeOffset} onChange={(e) => { setWriteOffset(e.target.value); setWriteConfirmed(false); }} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1" />
                </div>
              )}
              {plan && !plan.error && (
                <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
                  <div>erase {formatRange(plan.eraseStart, plan.eraseSize)} ({plan.eraseSize / FLASH_SECTOR_SIZE} x 4 KB sectors)</div>
                  <div>program {formatRange(plan.writeStart, plan.image.length)} (padded to 256-byte pages with 0xFF)</div>
                  <div className="text-amber-400">Bytes in the erased sectors outside the image are lost.</div>
                </div>
              )}
              {plan?.error && <div className="text-xs text-rose-300 font-mono">{plan.error}</div>}
              <label className="flex items-center gap-2 text-xs text-amber-300">
                <input type="checkbox" checked={writeConfirmed} onChange={(e) => setWriteConfirmed(e.target.checked)} disabled={!plan || !!plan.error} />
                I understand this erases and overwrites the flash range above.
              </label>
              <button onClick={doWrite} disabled={busyNow || !writeConfirmed || !plan || !!plan?.error}
                className="px-3 py-1.5 rounded bg-rose-800 hover:bg-rose-700 disabled:opacity-40 text-white text-xs font-mono flex items-center gap-2">
                <Eraser className="w-4 h-4" /> ERASE, WRITE AND VERIFY
              </button>
              {verifyResult && (
                <div className={`text-xs flex items-center gap-2 ${verifyResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {verifyResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />} {verifyResult.text}
                </div>
              )}
            </section>
          </div>
        )}

        <section className="rounded border border-slate-800 bg-slate-950 p-3">
          <h3 className="text-xs font-semibold text-slate-400 mb-2">Log</h3>
          <div className="font-mono text-[11px] space-y-0.5 max-h-48 overflow-auto">
            {log.length === 0 && <div className="text-slate-600">No activity yet.</div>}
            {log.map((l, i) => (
              <div key={i} className={l.level === 'error' ? 'text-rose-300' : l.level === 'warn' ? 'text-amber-300' : 'text-slate-400'}>
                <span className="text-slate-600">{l.ts}</span> {l.text}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** Parse "0x1000" or "4096" (decimal). Returns null when invalid. */
function parseNum(s) {
  const t = String(s).trim();
  if (!t) return null;
  const n = /^0x/i.test(t) ? parseInt(t, 16) : /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}
