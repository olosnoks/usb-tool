import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Usb, Power, PowerOff, Download, Upload, Cpu, HardDrive, ShieldAlert, Loader2, RotateCcw, CheckCircle2, AlertTriangle, Eraser, Search, ShieldCheck } from 'lucide-react';
import {
  PICOBOOT_USB_FILTERS, PicobootConnection, PicobootError, XIP_BASE, FLASH_SECTOR_SIZE, WRITE_CHUNK_SIZE, READ_CHUNK_SIZE,
  chipFromPid, findPicobootInterface, planFlashWrite, uf2ToFlashImage, formatRange, parseBinaryInfo, PICOBOOT_EXCLUSIVE,
  parseSize, usedLength, binToUf2, compareImages, digestHex, crc32Hex, picotoolCommands, UF2_FAMILY,
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
  const [saveFormat, setSaveFormat] = useState('bin');
  const [trimFF, setTrimFF] = useState(false);
  const [readSummary, setReadSummary] = useState(null);
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
    setConn(null); setDevice(null); setChip(null); setIface(null); setVectors(null); setDump(''); setBinInfo(null); setVerifyResult(null); setReadSummary(null);
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
    const len = parseSize(readLength);
    if (off === null || len === null || len <= 0) throw new PicobootError('Enter a valid offset and a length greater than zero (hex, decimal, or like 2M / 256K).');
    if (off + len > 16 * 1024 * 1024) throw new PicobootError('Range runs past 16 MB.');
    addLog(`Reading ${fmtBytes(len)} from offset ${hex(off)}.`);
    let bytes = await readFlash(c, XIP_BASE + off, len, reportProgress);
    if (trimFF) {
      const used = usedLength(bytes);
      if (used === 0) throw new PicobootError('The range is all 0xFF (erased); nothing to save.');
      bytes = bytes.subarray(0, used);
    }
    const sha = await digestHex(bytes);
    setReadSummary({ size: bytes.length, crc: crc32Hex(bytes), sha });
    if (saveFormat === 'uf2') {
      const fam = chip === 'RP2350' ? UF2_FAMILY.RP2350_ARM_S : UF2_FAMILY.RP2040;
      download(binToUf2(bytes, XIP_BASE + off, fam), `flash_${hex(off, 6)}_${bytes.length}.uf2`);
    } else {
      download(bytes, `flash_${hex(off, 6)}_${bytes.length}.bin`);
    }
    addLog(`Read ${fmtBytes(bytes.length)} OK, saved as .${saveFormat}. CRC-32 ${crc32Hex(bytes)}, SHA-256 ${sha.slice(0, 16)}...`);
  });

  const doVerifyOnly = () => run('Verify', async () => {
    const c = connRef.current;
    if (!c) return;
    const img = resolveImage();
    const p = planFlashWrite(img.data, img.offset);
    const back = await readFlash(c, XIP_BASE + p.writeStart, p.dataLength + p.imageOffset, reportProgress);
    const cmp = compareImages(p.image.subarray(p.imageOffset, p.imageOffset + p.dataLength), back.subarray(p.imageOffset));
    const result = cmp.equal
      ? { ok: true, text: `Verify OK: ${fmtBytes(p.dataLength)} at ${hex(img.offset)} match the file (no write done).` }
      : { ok: false, text: `Verify FAILED: ${cmp.mismatches} byte(s) differ, first at ${hex(img.offset + cmp.firstIndex)}.` };
    setVerifyResult(result);
    addLog(result.text, result.ok ? 'info' : 'error');
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
    const cmp = compareImages(p.image, back);
    const result = cmp.equal
      ? { ok: true, text: `Verify OK: ${fmtBytes(p.image.length)} match.` }
      : { ok: false, text: `Verify FAILED: ${cmp.mismatches} byte(s) differ, first at ${hex(p.writeStart + cmp.firstIndex)}.` };
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

  const btn = 'px-2 py-1 rounded border border-slate-700 hover:bg-slate-800 disabled:opacity-40 text-[11px] font-mono flex items-center gap-1';
  const input = 'flex-1 min-w-0 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs font-mono';
  const card = 'rounded border border-slate-800 bg-slate-900/60 p-2.5 space-y-2';
  const cliCommands = picotoolCommands({
    readOffset: parseNum(readOffset) ?? 0,
    readLength: parseSize(readLength) ?? 0,
    writeFile: writeFile?.name ?? null,
    writeOffset: parseNum(writeOffset) ?? 0,
    kind: saveFormat,
  });

  return (
    <div className="h-full overflow-auto bg-slate-950 text-slate-200 font-sans text-xs">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Cpu className="w-4 h-4 text-cyan-400" />
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${connected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
            {connected ? `CONNECTED · ${chip ?? 'unknown'}` : 'NOT CONNECTED'}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-amber-700 text-amber-300">UNTESTED ON HARDWARE</span>
          <div className="ml-auto flex gap-2">
            {!connected ? (
              <button onClick={connect} disabled={busyNow || !webUsbAvailable}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-700 hover:bg-cyan-600 disabled:opacity-40 text-white text-[11px] font-mono">
                {busy === 'Connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} CONNECT (WEBUSB)
              </button>
            ) : (
              <button onClick={disconnect} disabled={busyNow} className={btn}>
                <PowerOff className="w-3.5 h-3.5" /> DISCONNECT
              </button>
            )}
          </div>
        </div>

        {!webUsbAvailable && (
          <div className="flex gap-2 items-start p-2 rounded border border-amber-800 bg-amber-950/40 text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            WebUSB is not available here. Use Chrome, Edge or Opera on a desktop{!isSecureContext ? ' over HTTPS (this page is not a secure context)' : ''}.
          </div>
        )}

        <details className="text-slate-400">
          <summary className="cursor-pointer text-[11px]">About this tool</summary>
          <p className="pt-1">
            Talks to the PICOBOOT vendor interface of a board in BOOTSEL mode (USB IDs 2e8a:0003 RP2040, 2e8a:000f RP2350).
            The mass-storage (UF2 drive) interface is not claimed. Nothing is written until you press Write.
          </p>
        </details>

        {error && (
          <div className="flex gap-2 items-start p-2 rounded border border-rose-800 bg-rose-950/40 text-rose-200 font-mono">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 font-mono text-cyan-300">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy}…
            {progress && progress.total > 0 && (
              <span className="text-slate-400">{Math.round((progress.done / progress.total) * 100)}% ({fmtBytes(progress.done)} / {fmtBytes(progress.total)})</span>
            )}
          </div>
        )}

        {connected && (
          <div className="grid @xl:grid-cols-2 gap-2">
            <section className={card}>
              <h3 className="font-semibold text-slate-300 flex items-center gap-1.5"><HardDrive className="w-3.5 h-3.5" /> Device</h3>
              <dl className="font-mono grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 break-words">
                <dt className="text-slate-500">chip</dt><dd>{chip ?? 'unknown'} (PID {hex(device?.productId ?? 0, 4)})</dd>
                <dt className="text-slate-500">interface</dt><dd>{iface?.interfaceNumber} (OUT {iface?.outEndpoint} / IN {iface?.inEndpoint})</dd>
                <dt className="text-slate-500">vector SP</dt><dd>{sp !== null ? hex(sp, 8) : '—'} {spLooksRam ? <span className="text-emerald-400">RAM stack pointer</span> : sp !== null ? <span className="text-amber-400">not a RAM address</span> : ''}</dd>
                <dt className="text-slate-500">reset vector</dt><dd>{vectors ? hex(vectors.reset, 8) : '—'} {resetLooksFlash ? <span className="text-emerald-400">in flash</span> : vectors ? <span className="text-amber-400">not in flash (blank or RAM image?)</span> : ''}</dd>
              </dl>
              <div className="flex flex-wrap gap-1.5">
                <button onClick={rescan} disabled={busyNow} title="Re-read the first 64 KB of flash" className={btn}><RotateCcw className="w-3 h-3" /> rescan</button>
                <button onClick={() => doReboot('app')} disabled={busyNow} className={btn}><Power className="w-3 h-3" /> reboot to app</button>
                <button onClick={() => doReboot('bootsel')} disabled={busyNow || chip !== 'RP2350'} title="RP2350 only" className={btn}><Usb className="w-3 h-3" /> to BOOTSEL (RP2350)</button>
              </div>
            </section>

            <section className={card}>
              <h3 className="font-semibold text-slate-300 flex items-center gap-1.5"><Search className="w-3.5 h-3.5" /> binary_info (picotool info)</h3>
              {!binInfo && <p className="text-slate-500">Scanning...</p>}
              {binInfo && !binInfo.found && <p className="text-slate-500">No binary_info header in the first {fmtBytes(SCAN_BYTES)} of flash. The image may be blank or not built with the pico-sdk.</p>}
              {binInfo?.found && (
                <div className="font-mono space-y-1">
                  <div className="text-slate-500">header at flash offset {hex(binInfo.headerOffset)}; {binInfo.entries.length} entries</div>
                  {binInfo.program.strings?.length > 0 && (
                    <ul className="list-disc pl-4 text-slate-200">{binInfo.program.strings.map((s, i) => <li key={i}>{s}</li>)}</ul>
                  )}
                  {binInfo.program.strings?.length === 0 && <div className="text-slate-500">No string entries with the Raspberry Pi tag (RP).</div>}
                  {binInfo.program.pinEntries > 0 && <div className="text-amber-400">{binInfo.program.pinEntries} pin/other entries found; pin decoding is not implemented.</div>}
                </div>
              )}
            </section>

            <details className="@xl:col-span-2 rounded border border-slate-800 bg-slate-900/60 p-2.5">
              <summary className="cursor-pointer font-semibold text-slate-300">First 256 bytes of flash (0x10000000)</summary>
              <pre className="mt-2 text-[11px] leading-4 text-emerald-300 overflow-x-auto whitespace-pre">{dump || '—'}</pre>
            </details>

            <section className={card}>
              <h3 className="font-semibold text-slate-300 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Save flash (picotool save)</h3>
              <div className="flex gap-2 items-center font-mono">
                <label htmlFor="pb-read-off" className="text-slate-500 w-12">offset</label>
                <input id="pb-read-off" value={readOffset} onChange={(e) => setReadOffset(e.target.value)} className={input} />
              </div>
              <div className="flex gap-2 items-center font-mono">
                <label htmlFor="pb-read-len" className="text-slate-500 w-12">length</label>
                <input id="pb-read-len" value={readLength} onChange={(e) => setReadLength(e.target.value)} className={input} />
              </div>
              <div className="flex flex-wrap gap-1 items-center">
                <span className="text-slate-500 text-[11px]">size:</span>
                {['256K', '1M', '2M', '4M', '16M'].map((sz) => (
                  <button key={sz} type="button" onClick={() => setReadLength(sz)} className="px-1.5 py-0.5 rounded border border-slate-700 hover:bg-slate-800 text-[11px] font-mono">{sz}</button>
                ))}
              </div>
              <div className="flex flex-wrap gap-3 items-center">
                <label className="flex items-center gap-1.5 text-[11px]">format
                  <select value={saveFormat} onChange={(e) => setSaveFormat(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 font-mono">
                    <option value="bin">.bin</option>
                    <option value="uf2">.uf2</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px]" title="Drop trailing 0xFF (erased) bytes, keeping 256-byte pages">
                  <input type="checkbox" checked={trimFF} onChange={(e) => setTrimFF(e.target.checked)} /> trim trailing 0xFF
                </label>
              </div>
              <button onClick={doRead} disabled={busyNow} className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px] font-mono flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> READ AND DOWNLOAD</button>
              {readSummary && (
                <div className="text-[11px] font-mono text-slate-400 break-all space-y-0.5">
                  <div>{fmtBytes(readSummary.size)} saved · CRC-32 {readSummary.crc}</div>
                  <div>SHA-256 {readSummary.sha}</div>
                </div>
              )}
            </section>

            <section className={card}>
              <h3 className="font-semibold text-slate-300 flex items-center gap-1.5"><Upload className="w-3.5 h-3.5" /> Write / verify .bin or .uf2</h3>
              <input type="file" aria-label="Firmware file" accept=".bin,.uf2" onChange={onPickFile} disabled={busyNow} className="text-xs max-w-full" />
              {writeFile && <div className="font-mono text-slate-400 break-all">{writeFile.name} · {fmtBytes(writeFile.size)} · {writeFile.kind === 'uf2' ? 'UF2 (addresses from file)' : 'raw .bin'}</div>}
              {writeFile?.kind === 'bin' && (
                <div className="flex gap-2 items-center font-mono">
                  <label htmlFor="pb-write-off" className="text-slate-500 w-12">offset</label>
                  <input id="pb-write-off" value={writeOffset} onChange={(e) => { setWriteOffset(e.target.value); setWriteConfirmed(false); }} className={input} />
                </div>
              )}
              {plan && !plan.error && (
                <div className="text-[11px] font-mono text-slate-400 space-y-0.5">
                  <div>erase {formatRange(plan.eraseStart, plan.eraseSize)} ({plan.eraseSize / FLASH_SECTOR_SIZE} x 4 KB sectors)</div>
                  <div>program {formatRange(plan.writeStart, plan.image.length)} (padded to 256-byte pages with 0xFF)</div>
                  <div className="text-amber-400">Bytes in the erased sectors outside the image are lost.</div>
                </div>
              )}
              {plan?.error && <div className="text-rose-300 font-mono">{plan.error}</div>}
              <button onClick={doVerifyOnly} disabled={busyNow || !plan || !!plan?.error} title="Compare flash with the file; nothing is written" className={btn}>
                <ShieldCheck className="w-3.5 h-3.5" /> VERIFY ONLY (picotool verify)
              </button>
              <label className="flex items-center gap-2 text-amber-300">
                <input type="checkbox" checked={writeConfirmed} onChange={(e) => setWriteConfirmed(e.target.checked)} disabled={!plan || !!plan.error} />
                I understand this erases and overwrites the flash range above.
              </label>
              <button onClick={doWrite} disabled={busyNow || !writeConfirmed || !plan || !!plan?.error}
                className="px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 disabled:opacity-40 text-white text-[11px] font-mono flex items-center gap-1.5">
                <Eraser className="w-3.5 h-3.5" /> ERASE, WRITE AND VERIFY
              </button>
              {verifyResult && (
                <div className={`flex items-center gap-2 ${verifyResult.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {verifyResult.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <ShieldAlert className="w-4 h-4 shrink-0" />} {verifyResult.text}
                </div>
              )}
            </section>

            <details className="@xl:col-span-2 rounded border border-slate-800 bg-slate-900/60 p-2.5">
              <summary className="cursor-pointer font-semibold text-slate-300">Equivalent picotool commands</summary>
              <p className="text-slate-500 text-[11px] pt-1">Export for the desktop CLI, built from your current settings. This page does not run picotool.</p>
              <pre className="mt-1 text-[11px] text-cyan-300 overflow-x-auto whitespace-pre">{cliCommands.join('\n')}</pre>
              <button onClick={() => navigator.clipboard?.writeText(cliCommands.join('\n'))} className={`${btn} mt-1`}>copy</button>
            </details>
          </div>
        )}

        <section className="rounded border border-slate-800 bg-slate-950 p-2">
          <h3 className="font-semibold text-slate-400 mb-1">Log</h3>
          <div className="font-mono text-[11px] space-y-0.5 max-h-40 overflow-auto">
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
