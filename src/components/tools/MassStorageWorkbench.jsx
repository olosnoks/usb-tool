import React, { useState, useRef, useEffect } from 'react';
import { Usb, Power, ShieldAlert, Search, Loader2, Folder, FileText, Download, ChevronRight, Trash2, Square, Hash, FileUp, ScanSearch } from 'lucide-react';
import { MassStorageDevice, requestMassStorageDevice } from '../../utils/massStorageDriver';
import { DiskReader, readPartitionTable, detectFilesystem, openVolume, fileSectorReader } from '../../utils/diskImage';
import { imageRange, verifyRange, badSectorMap, formatImageLog } from '../../utils/imaging';
import { carve } from '../../utils/carve';
import StatusBadge from '../common/StatusBadge';

import { confirmAction, useSessionError } from '../../utils/sessionLog';
const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 2 : 0)} ${u[i]}`;
};

const saveBlob = (parts, name, type) => {
  const url = URL.createObjectURL(new Blob(parts, type ? { type } : undefined));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const MAX_SAVE = 512 * 1024 * 1024;
// Device reads are split so one SCSI command never asks for more than 128 KB at 512-byte blocks.
const DEVICE_CMD_SECTORS = 256;

export default function MassStorageWorkbench() {
  const [dev, setDev] = useState(null);
  const [source, setSource] = useState(null); // { kind: 'device' | 'file', label, blockSize, blocks, readSectors, size? }
  const [status, setStatus] = useState('offline');
  const [inquiry, setInquiry] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const [lba, setLba] = useState('0');
  const [sector, setSector] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useSessionError('Mass Storage');
  const [blockedKind, setBlockedKind] = useState('');
  const [table, setTable] = useState(null); // { scheme, partitions: [{ ..., fs }] }
  const [browser, setBrowser] = useState(null); // { part, vol, path: [{ name, entry }], entries }
  const [showDeleted, setShowDeleted] = useState(true);
  const [preview, setPreview] = useState(null); // { name, text, bytes, truncated }
  const [dump, setDump] = useState(null); // { label, phase, done, total, startedAt, hashes, badRanges, ... }
  const [continueOnError, setContinueOnError] = useState(false);
  const [verifyPass, setVerifyPass] = useState(false);
  const [carving, setCarving] = useState(null); // { label, done, total } while running
  const [carved, setCarved] = useState(null); // { label, base, files, scannedBytes, cancelled }
  const [carvePreview, setCarvePreview] = useState(null); // { name, url?, bytes }
  const readerRef = useRef(null);
  const sourceRef = useRef(null);
  const devRef = useRef(null);
  const fileInput = useRef(null);
  const cancelDump = useRef(false);
  const cancelCarve = useRef(false);
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;
  const isFile = source?.kind === 'file';

  // Release the claimed interface and stop long jobs if the tool is closed.
  useEffect(() => () => {
    cancelDump.current = true; cancelCarve.current = true;
    devRef.current?.close().catch(() => {});
  }, []);
  useEffect(() => () => { if (carvePreview?.url) URL.revokeObjectURL(carvePreview.url); }, [carvePreview]);

  const reset = () => {
    setInquiry(null); setCapacity(null); setSector(null); setTable(null); setBrowser(null);
    setPreview(null); setDump(null); setCarved(null); setCarvePreview(null); setCarving(null);
  };

  const scanPartitions = async (src) => {
    const reader = new DiskReader((start, n) => src.readSectors(start, Math.max(1, Math.min(n, src.blocks - start))), { blockSize: src.blockSize });
    readerRef.current = reader;
    try {
      const pt = await readPartitionTable((o, n) => reader.read(o, n), { blockSize: src.blockSize });
      for (const p of pt.partitions) {
        if (p.sectors === null) p.sectors = src.blocks;
        try { p.fs = await detectFilesystem(reader.at(p.startLba * src.blockSize)); } catch (e) { p.fs = { type: 'unreadable' }; }
      }
      setTable(pt);
    } catch (e) {
      setError(`Partition table: ${e.message}`);
    }
  };

  // --- Open a disk image file (the way that works in practice) -------------------

  const openImage = async (file) => {
    if (!file) return;
    setBusy('open'); setError(''); setBlockedKind('');
    try {
      try { await dev?.close(); } catch (e) { /* ignore */ }
      devRef.current = null; setDev(null);
      reset();
      const blockSize = 512;
      const src = {
        kind: 'file', label: file.name, blockSize, blocks: Math.ceil(file.size / blockSize), size: file.size,
        readSectors: fileSectorReader(file, blockSize)
      };
      if (!file.size) throw new Error('That file is empty.');
      sourceRef.current = src; setSource(src);
      setCapacity({ blockSize, blocks: src.blocks, totalBytes: file.size });
      setStatus('online');
      await scanPartitions(src);
    } catch (err) { setError(err.message); setStatus('warning'); }
    finally { setBusy(''); if (fileInput.current) fileInput.current.value = ''; }
  };

  // --- Live drive (experimental) ---------------------------------------------------

  const connect = async () => {
    if (!confirmAction('Inspect a USB mass-storage device?\n\nChrome usually blocks WebUSB from the mass-storage class, so this often fails; opening a disk image file is the dependable route.\n\nIf it does connect, it CLAIMS the drive for this tab, taking it away from the operating system for the session. Use a drive that is NOT mounted/in use. This tool is read-only (no writes), but unmounting an in-use disk can still disrupt the OS.')) return;
    setBusy('connect'); setError(''); setBlockedKind('');
    try {
      const transport = await requestMassStorageDevice();
      const d = new MassStorageDevice(transport);
      await d.open();
      await d.testUnitReady();
      setInquiry(await d.inquiry());
      const cap = await d.readCapacity();
      setCapacity(cap);
      const readSectors = async (start, n) => {
        if (n <= DEVICE_CMD_SECTORS) return d.read(start, n);
        const out = new Uint8Array(n * cap.blockSize);
        for (let done = 0; done < n; done += DEVICE_CMD_SECTORS) {
          const take = Math.min(DEVICE_CMD_SECTORS, n - done);
          out.set(await d.read(start + done, take), done * cap.blockSize);
        }
        return out;
      };
      const src = { kind: 'device', label: 'drive', blockSize: cap.blockSize, blocks: cap.blocks, readSectors };
      sourceRef.current = src; setSource(src);
      devRef.current = d; setDev(d); setStatus('online');
      await scanPartitions(src);
    } catch (err) { setError(err.message); setBlockedKind(err.kind || ''); setStatus('warning'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    cancelDump.current = true; cancelCarve.current = true;
    try { await dev?.close(); } catch (e) { /* ignore */ }
    devRef.current = null; sourceRef.current = null;
    setDev(null); setSource(null); setStatus('offline'); reset();
  };

  const readSector = async () => {
    if (!source) return;
    setBusy('read'); setError('');
    try {
      const n = parseInt(lba, 10);
      if (Number.isNaN(n) || n < 0 || (capacity && n >= capacity.blocks)) throw new Error(`LBA must be 0..${(capacity?.blocks ?? 1) - 1}.`);
      setSector({ lba: n, data: await source.readSectors(n, 1) });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  // --- File browser ---------------------------------------------------------

  const browse = async (part) => {
    setBusy('browse'); setError(''); setPreview(null);
    try {
      const vol = await openVolume(readerRef.current.at(part.startLba * capacity.blockSize));
      if (!vol) throw new Error(`${part.fs?.type || 'This filesystem'} can't be browsed here (FAT12/16/32 and exFAT can). Hash or image the partition and open it in Autopsy / The Sleuth Kit, or run the file carver on it.`);
      setBrowser({ part, vol, path: [], entries: await vol.list() });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const showDir = async (path) => {
    setBusy('browse'); setPreview(null);
    try {
      const vol = browser.vol;
      const last = path[path.length - 1]?.entry;
      const entries = !last ? await vol.list() : vol.type === 'exFAT' ? await vol.list(last) : await vol.list(last.cluster);
      setBrowser({ ...browser, path, entries });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const readEntry = (entry) => {
    if (entry.size > MAX_SAVE) throw new Error('Files over 512 MB are better copied out of a full image.');
    return browser.vol.readFile(entry);
  };

  const saveFile = async (entry) => {
    setBusy('file'); setError('');
    try {
      saveBlob([await readEntry(entry)], entry.name.replace(/^\?/, '_'));
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const previewFile = async (entry) => {
    setBusy('file'); setError('');
    try {
      const max = 64 * 1024;
      const data = await readEntry({ ...entry, size: Math.min(entry.size, max), validSize: Math.min(entry.validSize ?? entry.size, max) });
      const isText = data.length > 0 && data.every((b) => b === 9 || b === 10 || b === 13 || b >= 32) && !data.includes(0x7f);
      setPreview({ name: entry.name, text: isText ? new TextDecoder().decode(data) : null, bytes: data, truncated: entry.size > data.length });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  // --- Imaging / hashing ----------------------------------------------------

  /**
   * Image the whole drive or one partition to a file (live drive), or just hash it
   * (image file), computing MD5 / SHA-1 / SHA-256 in the same pass. Optionally keeps
   * going past unreadable sectors and re-reads the source to verify.
   */
  const dumpRange = async (label, startLba, sectors) => {
    const src = sourceRef.current;
    if (!src) return;
    const bs = src.blockSize;
    const hashOnly = src.kind === 'file';
    const total = hashOnly ? Math.min(sectors * bs, Math.max(0, src.size - startLba * bs)) : sectors * bs;
    const name = `${label.replace(/[^\w.-]+/g, '_')}.img`;
    let writable = null;
    const parts = [];
    if (!hashOnly && window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Disk image', accept: { 'application/octet-stream': ['.img', '.bin'] } }] });
        writable = await handle.createWritable();
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    if (!hashOnly && !writable && total > 1024 * 1024 * 1024) { setError('Images over 1 GB need a browser that can save straight to disk (Chrome or Edge).'); return; }
    cancelDump.current = false;
    setError('');
    const startedAt = performance.now();
    const common = {
      readSectors: src.readSectors, startLba, sectors, blockSize: bs, byteLength: total,
      chunkSectors: hashOnly ? 2048 : 128, continueOnError: !hashOnly && continueOnError,
      recover: devRef.current ? () => devRef.current.resetRecovery() : null,
      shouldCancel: () => cancelDump.current
    };
    const base = { label, hashOnly, startLba, sectors, total, startedAt };
    setDump({ ...base, phase: hashOnly ? 'hashing' : 'imaging', done: 0, badSectors: 0 });
    try {
      const res = await imageRange({
        ...common,
        write: writable ? (d) => writable.write(d) : hashOnly ? null : async (d) => { parts.push(d); },
        onProgress: (p) => setDump((cur) => ({ ...(cur || base), ...base, phase: hashOnly ? 'hashing' : 'imaging', done: p.done, badSectors: p.badSectors }))
      });
      if (writable) await writable.close(); else if (!hashOnly) saveBlob(parts, name);
      let verify = null;
      if (verifyPass && !hashOnly) {
        setDump({ ...base, phase: 'verifying', done: 0, badSectors: res.badSectors, hashes: res.hashes, badRanges: res.badRanges });
        const v = await verifyRange({
          ...common,
          onProgress: (p) => setDump((cur) => ({ ...(cur || base), phase: 'verifying', done: p.done }))
        }, res.hashes.sha256);
        verify = { ok: v.ok, sha256: v.hashes.sha256 };
      }
      setDump({ ...base, phase: 'done', done: total, hashes: res.hashes, badRanges: res.badRanges, badSectors: res.badSectors, verify, seconds: (performance.now() - startedAt) / 1000 });
    } catch (err) {
      if (writable) { try { await writable.abort(); } catch (e) { /* ignore */ } }
      setError(err.message);
      setDump(null);
    }
  };

  const downloadLog = () => {
    if (!dump?.hashes) return;
    saveBlob([formatImageLog({ name: dump.label, startLba: dump.startLba, sectors: dump.sectors, blockSize: source.blockSize, hashes: dump.hashes, badRanges: dump.badRanges })],
      `${dump.label.replace(/[^\w.-]+/g, '_')}-imaging-log.txt`, 'text/plain');
  };

  // --- Carving --------------------------------------------------------------

  /** Byte-range read straight from the source (no chunk cache), used for the long sequential carve scan. */
  const rawRead = (offset, length) => {
    const src = sourceRef.current;
    const bs = src.blockSize;
    const first = Math.floor(offset / bs);
    const last = Math.min(src.blocks, Math.ceil((offset + length) / bs));
    if (last <= first) return Promise.resolve(new Uint8Array(length));
    return src.readSectors(first, last - first).then((d) => {
      const out = new Uint8Array(length);
      const from = offset - first * bs;
      out.set(d.subarray(from, Math.min(d.length, from + length)));
      return out;
    });
  };

  const runCarve = async (label, startLba, sectors, { freeSpaceOf } = {}) => {
    const src = sourceRef.current;
    if (!src) return;
    const bs = src.blockSize;
    const base = startLba * bs;
    const length = Math.min(sectors * bs, (src.size ?? src.blocks * bs) - base);
    cancelCarve.current = false;
    setError(''); setCarved(null); setCarvePreview(null);
    setCarving({ label, done: 0, total: length });
    try {
      let ranges = null;
      if (freeSpaceOf) {
        const vol = await openVolume(readerRef.current.at(base));
        if (!vol || typeof vol.freeRanges !== 'function') throw new Error('Free-space carving needs a FAT volume (exFAT and other filesystems: carve the whole partition).');
        ranges = await vol.freeRanges();
        if (!ranges.length) throw new Error('This volume has no unallocated clusters.');
      }
      const res = await carve((o, n) => rawRead(base + o, n), length, {
        ranges, shouldCancel: () => cancelCarve.current,
        onProgress: (p) => setCarving({ label, done: p.done, total: p.total })
      });
      setCarved({ label: freeSpaceOf ? `${label} (unallocated space)` : label, base, ...res });
    } catch (err) { setError(err.message); }
    finally { setCarving(null); }
  };

  const readCarved = (f) => {
    if (f.length > MAX_SAVE) throw new Error('Carved files over 512 MB are better cut out of the image with dd.');
    return rawRead(carved.base + f.offset, f.length);
  };

  const saveCarved = async (f) => {
    setBusy('file'); setError('');
    try { saveBlob([await readCarved(f)], `carved_${(carved.base + f.offset).toString(16)}.${f.ext}`, f.mime); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const viewCarved = async (f) => {
    setBusy('file'); setError('');
    try {
      const isImage = /^image\/(jpeg|png|gif)$/.test(f.mime) && f.length <= 32 * 1024 * 1024;
      const bytes = await (isImage ? readCarved(f) : rawRead(carved.base + f.offset, Math.min(f.length, 4096)));
      setCarvePreview({ name: `${f.label} at byte ${(carved.base + f.offset).toLocaleString()}`, bytes: bytes.subarray(0, 4096), url: isImage ? URL.createObjectURL(new Blob([bytes], { type: f.mime })) : null });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const dumping = !!(dump && dump.phase !== 'done');
  const working = dumping || !!carving;
  const btnSm = 'px-2 py-0.5 rounded border font-bold disabled:opacity-40';
  const online = !!source;

  return (
    <div className="space-y-4 font-mono text-xs">

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Open a raw disk image (.img / .dd / .raw / .bin) or inspect a drive: SCSI identity and capacity, partition table (MBR / GPT), filesystems,
              FAT and exFAT browsing with deleted-file recovery, raw sectors, MD5 / SHA-1 / SHA-256 hashes, imaging that survives bad sectors, and signature file carving.
              Read-only: nothing is ever written to the source, and no WRITE command is implemented.
              Chrome blocks WebUSB from the mass-storage class on most systems, so image files are the dependable route; reading an image never leaves your browser.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? (isFile ? 'IMAGE' : 'SCSI') : status === 'warning' ? 'ERR' : 'IDLE'} value={isFile ? 'Image file' : dev ? 'Connected' : 'Offline'} />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost. Opening a disk image file works in any browser.
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <div className="space-y-2">
              <div>{error}</div>
              {blockedKind && (
                <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 px-3 py-1 rounded bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 font-bold">
                  <FileUp className="w-3.5 h-3.5" /> OPEN DISK IMAGE FILE INSTEAD
                </button>
              )}
            </div>
          </div>
        )}

        <input ref={fileInput} type="file" className="hidden" data-testid="image-file-input" onChange={(e) => openImage(e.target.files?.[0])} />
        <div className="pt-3 flex flex-wrap items-center gap-2">
          <button onClick={() => fileInput.current?.click()} disabled={!!busy || working} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 text-xs font-bold disabled:opacity-40">
            {busy === 'open' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileUp className="w-3.5 h-3.5" />} OPEN DISK IMAGE FILE
          </button>
          {!dev ? (
            <button onClick={() => connect()} disabled={!webUsbAvailable || !!busy || working} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-xs font-bold disabled:opacity-40" title="Chrome normally refuses WebUSB access to the mass-storage class">
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} LIVE DRIVE (WEBUSB, EXPERIMENTAL)
            </button>
          ) : null}
          {online && (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> {isFile ? 'CLOSE IMAGE' : 'DISCONNECT'}
            </button>
          )}
        </div>
        {!online && <p className="pt-2 text-[10px] text-slate-500">Live drive mode is experimental: Chrome usually blocks the storage class for WebUSB, and the page then explains why.</p>}
      </div>

      {isFile && capacity && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl grid grid-cols-2 @sm:grid-cols-4 gap-3">
          <Field label="Image file" value={source.label} />
          <Field label="Size" value={`${fmtBytes(capacity.totalBytes)} (${capacity.totalBytes.toLocaleString()} B)`} />
          <Field label="Sectors (512 B)" value={capacity.blocks.toLocaleString()} />
          <Field label="Access" value="read-only, range-sliced" />
        </div>
      )}

      {inquiry && capacity && !isFile && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl grid grid-cols-2 @sm:grid-cols-4 gap-3">
          <Field label="Vendor" value={inquiry.vendor} />
          <Field label="Product" value={inquiry.product} />
          <Field label="Revision" value={inquiry.revision} />
          <Field label="Type" value={inquiry.peripheralName} />
          <Field label="Removable" value={inquiry.removable ? 'yes' : 'no'} />
          <Field label="Block size" value={`${capacity.blockSize} B`} />
          <Field label="Blocks" value={`${capacity.blocks.toLocaleString()}${capacity.capacity16 ? ' (READ CAPACITY 16)' : ''}`} />
          <Field label="Capacity" value={fmtBytes(capacity.totalBytes)} />
        </div>
      )}

      {online && table && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-200">
              PARTITIONS{' '}
              <span className="text-slate-500 font-normal">
                ({table.scheme === 'gpt' ? `GPT, disk ${table.diskGuid}` : table.scheme === 'mbr' ? `MBR, disk ID ${table.diskId}` : 'no partition table'})
              </span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => runCarve(isFile ? source.label : 'drive', 0, capacity.blocks)} disabled={!!busy || working} className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40">
                <ScanSearch className="w-3.5 h-3.5" /> CARVE FILES (WHOLE {isFile ? 'IMAGE' : 'DRIVE'})
              </button>
              <button onClick={() => dumpRange(isFile ? `${source.label}-full` : `${inquiry?.product || 'drive'}-full`, 0, capacity.blocks)} disabled={!!busy || working} className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold disabled:opacity-40">
                {isFile ? <Hash className="w-3.5 h-3.5" /> : <Download className="w-3.5 h-3.5" />} {isFile ? 'HASH IMAGE' : 'IMAGE WHOLE DRIVE'} ({fmtBytes(capacity.totalBytes)})
              </button>
            </div>
          </div>
          {!isFile && (
            <div className="flex flex-wrap items-center gap-4 text-slate-400">
              <label className="flex items-center gap-1" title="Zero-fill sectors that cannot be read and keep going; the unreadable ranges are logged. Off: the first read error stops the job.">
                <input type="checkbox" checked={continueOnError} onChange={(e) => setContinueOnError(e.target.checked)} className="accent-amber-500" /> continue past bad sectors (zero-fill and log)
              </label>
              <label className="flex items-center gap-1" title="After imaging, read the source again and compare SHA-256.">
                <input type="checkbox" checked={verifyPass} onChange={(e) => setVerifyPass(e.target.checked)} className="accent-amber-500" /> verify pass (re-read and compare)
              </label>
            </div>
          )}
          {table.partitions.length === 0 && <div className="text-slate-500">No partitions found (a blank drive, or a layout this tool doesn't read). You can still hash it, view sectors, or carve files from the whole {isFile ? 'image' : 'drive'}.</div>}
          {table.partitions.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="text-slate-500 text-left">
                <tr><th className="py-1">#</th><th>TYPE</th><th>NAME</th><th>START LBA</th><th>SIZE</th><th>FILESYSTEM</th><th /></tr>
              </thead>
              <tbody>
                {table.partitions.map((p) => (
                  <tr key={`${p.index}-${p.startLba}`} className="border-t border-slate-900">
                    <td className="py-1 text-slate-400">{p.index}{p.bootable ? '*' : ''}</td>
                    <td className="text-slate-300">{p.typeName}</td>
                    <td className="text-slate-400">{p.name || ''}</td>
                    <td className="text-slate-400">{p.startLba.toLocaleString()}</td>
                    <td className="text-slate-300">{fmtBytes(p.sectors * capacity.blockSize)}</td>
                    <td className="text-emerald-300">
                      {p.fs?.type}{p.fs?.label ? ` "${p.fs.label}"` : ''}{p.fs?.serial ? ` · ${p.fs.serial}` : ''}{p.fs?.uuid ? ` · ${p.fs.uuid}` : ''}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {/FAT/i.test(p.fs?.type || '') && (
                        <button onClick={() => browse(p)} disabled={!!busy} className={`${btnSm} border-cyan-500/40 text-cyan-300 mr-1`}>BROWSE</button>
                      )}
                      <button onClick={() => setLba(String(p.startLba))} className={`${btnSm} border-slate-700 text-slate-300 mr-1`} title="Put this partition's first sector in the sector viewer">LBA</button>
                      <button onClick={() => runCarve(`partition${p.index}`, p.startLba, p.sectors)} disabled={!!busy || working} className={`${btnSm} border-cyan-500/40 text-cyan-300 mr-1`} title="Signature-carve the whole partition">CARVE</button>
                      {/^FAT/i.test(p.fs?.type || '') && (
                        <button onClick={() => runCarve(`partition${p.index}`, p.startLba, p.sectors, { freeSpaceOf: true })} disabled={!!busy || working} className={`${btnSm} border-cyan-500/40 text-cyan-300 mr-1`} title="Carve only clusters the FAT marks free (where deleted data lives)">CARVE FREE</button>
                      )}
                      <button onClick={() => dumpRange(`partition${p.index}-${p.fs?.label || p.typeName}`, p.startLba, p.sectors)} disabled={!!busy || working} className={`${btnSm} border-amber-500/40 text-amber-300`}>{isFile ? 'HASH' : 'IMAGE'}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {dump && (
            <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-300 font-bold">{dump.label}</span>
                <span className="text-slate-500">{dump.phase === 'verifying' ? 'verifying ' : ''}{fmtBytes(dump.done)} / {fmtBytes(dump.total)}</span>
                {dump.badSectors > 0 && <span className="text-rose-300">{dump.badSectors.toLocaleString()} unreadable sectors zero-filled</span>}
                {(() => {
                  const secs = (performance.now() - dump.startedAt) / 1000;
                  const rate = secs > 0 ? dump.done / secs : 0;
                  return dumping && rate > 0 ? <span className="text-slate-500">{fmtBytes(rate)}/s · about {Math.round((dump.total - dump.done) / rate)} s left</span> : null;
                })()}
                {dumping && (
                  <button onClick={() => { cancelDump.current = true; }} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/40 text-rose-300">
                    <Square className="w-3 h-3" /> CANCEL
                  </button>
                )}
              </div>
              <div className="h-1.5 bg-slate-900 rounded"><div className="h-1.5 bg-amber-400 rounded" style={{ width: `${dump.total ? (dump.done / dump.total) * 100 : 0}%` }} /></div>
              {dump.hashes && (
                <div className="space-y-0.5 text-emerald-300 break-all">
                  <div className="flex items-start gap-1"><Hash className="w-3.5 h-3.5 shrink-0 mt-0.5" /> MD5 {dump.hashes.md5}</div>
                  <div className="pl-5">SHA-1 {dump.hashes.sha1}</div>
                  <div className="pl-5">SHA-256 {dump.hashes.sha256} {dump.seconds != null && <span className="text-slate-500">({dump.seconds.toFixed(1)} s)</span>}</div>
                  {dump.verify && (
                    <div className={`pl-5 font-bold ${dump.verify.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {dump.verify.ok ? 'Verify pass: re-read matches the image.' : `Verify pass MISMATCH: re-read SHA-256 ${dump.verify.sha256}. The source gave different data on the second read.`}
                    </div>
                  )}
                  <div className="pl-5"><button onClick={downloadLog} className={`${btnSm} border-slate-700 text-slate-300`}>DOWNLOAD LOG (HASHES{dump.badRanges?.length ? ' + BAD RANGES' : ''})</button></div>
                </div>
              )}
              {dump.phase === 'done' && dump.badRanges?.length > 0 && <BadSectorMap dump={dump} />}
            </div>
          )}
          {carving && (
            <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-300 font-bold">Carving {carving.label}</span>
                <span className="text-slate-500">{fmtBytes(carving.done)} / {fmtBytes(carving.total)} scanned</span>
                <button onClick={() => { cancelCarve.current = true; }} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-rose-500/40 text-rose-300">
                  <Square className="w-3 h-3" /> CANCEL
                </button>
              </div>
              <div className="h-1.5 bg-slate-900 rounded"><div className="h-1.5 bg-cyan-400 rounded" style={{ width: `${carving.total ? (carving.done / carving.total) * 100 : 0}%` }} /></div>
            </div>
          )}
        </div>
      )}

      {carved && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
          <div className="font-bold text-slate-200">
            CARVED FILES <span className="text-slate-500 font-normal">({carved.label}: {carved.files.length} found in {fmtBytes(carved.scannedBytes)} scanned{carved.cancelled ? ', cancelled early' : ''})</span>
          </div>
          {carved.files.length === 0 && <div className="text-slate-500">No JPEG, PNG, GIF, PDF, ZIP/Office, SQLite or MP4/MOV files with intact structure were found in the scanned area.</div>}
          {carved.files.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="text-slate-500 text-left"><tr><th className="py-1">TYPE</th><th>OFFSET (DISK)</th><th>SIZE</th><th /></tr></thead>
              <tbody>
                {carved.files.map((f, i) => (
                  <tr key={`${f.offset}-${i}`} className="border-t border-slate-900 text-slate-300">
                    <td className="py-0.5">{f.label} <span className="text-slate-500">.{f.ext}</span>{f.truncated && <span className="text-amber-400"> (end not found)</span>}</td>
                    <td className="text-slate-400">{(carved.base + f.offset).toLocaleString()} <span className="text-slate-600">0x{(carved.base + f.offset).toString(16)}</span></td>
                    <td>{fmtBytes(f.length)}</td>
                    <td className="text-right whitespace-nowrap">
                      <button onClick={() => viewCarved(f)} disabled={!!busy} className={`${btnSm} border-slate-700 text-slate-300 mr-1`}>VIEW</button>
                      <button onClick={() => saveCarved(f)} disabled={!!busy} className={`${btnSm} border-cyan-500/40 text-cyan-300`}>SAVE</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-slate-500">
            Carving matches file signatures and the length each format records for itself. Fragmented files come out only as far as their first contiguous run, and a match is a candidate, not proof the file is whole: open the result before relying on it.
          </p>
          {carvePreview && (
            <div>
              <div className="text-slate-400 mb-1">{carvePreview.name}</div>
              {carvePreview.url && <img src={carvePreview.url} alt="carved file preview" className="max-h-72 max-w-full border border-slate-800 rounded mb-2" />}
              <HexView lba={null} data={carvePreview.bytes} />
            </div>
          )}
        </div>
      )}

      {browser && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="font-bold text-slate-200 mr-2">FILES ({browser.vol.type}, read-only)</span>
            <button onClick={() => showDir([])} className="text-cyan-300 hover:underline">{browser.part.fs?.label || `partition ${browser.part.index}`}</button>
            {browser.path.map((p, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="w-3 h-3 text-slate-600" />
                <button onClick={() => showDir(browser.path.slice(0, i + 1))} className="text-cyan-300 hover:underline">{p.name}</button>
              </span>
            ))}
            <label className="ml-auto flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} className="accent-rose-500" /> show deleted
            </label>
          </div>
          <table className="w-full text-[11px]">
            <thead className="text-slate-500 text-left"><tr><th className="py-1">NAME</th><th>SIZE</th><th>MODIFIED (UTC)</th><th>ATTR</th><th /></tr></thead>
            <tbody>
              {browser.entries.filter((e) => showDeleted || !e.deleted).map((e, i) => (
                <tr key={`${e.name}-${i}`} className={`border-t border-slate-900 ${e.deleted ? 'text-rose-300/80' : 'text-slate-300'}`}>
                  <td className="py-0.5">
                    {e.isDir && !e.deleted ? (
                      <button onClick={() => showDir([...browser.path, { name: e.name, entry: e }])} className="flex items-center gap-1 text-cyan-300 hover:underline">
                        <Folder className="w-3.5 h-3.5" /> {e.name}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1">
                        {e.isDir ? <Folder className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5 text-slate-500" />} {e.name}
                        {e.deleted && <span className="flex items-center gap-0.5 text-[10px] text-rose-400"><Trash2 className="w-3 h-3" /> deleted</span>}
                      </span>
                    )}
                  </td>
                  <td>{e.isDir ? '' : fmtBytes(e.size)}</td>
                  <td className="text-slate-500">{e.modified && !Number.isNaN(e.modified.getTime()) ? e.modified.toISOString().replace('T', ' ').slice(0, 16) : ''}</td>
                  <td className="text-slate-500">{[e.readOnly && 'R', e.hidden && 'H', e.system && 'S'].filter(Boolean).join('')}</td>
                  <td className="text-right whitespace-nowrap">
                    {!e.isDir && (
                      <>
                        <button onClick={() => previewFile(e)} disabled={!!busy} className={`${btnSm} border-slate-700 text-slate-300 mr-1`}>VIEW</button>
                        <button onClick={() => saveFile(e)} disabled={!!busy} className={`${btnSm} border-cyan-500/40 text-cyan-300`}>{e.deleted ? 'RECOVER' : 'SAVE'}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {browser.entries.some((e) => e.deleted) && (
            <p className="text-[10px] text-slate-500">
              Deleted files are recovered by reading contiguous clusters from their first cluster. That works for files that were not fragmented and whose space has not been reused.
            </p>
          )}
          {preview && (
            <div>
              <div className="text-slate-400 mb-1">{preview.name}{preview.truncated ? ' (first 64 KB)' : ''}</div>
              {preview.text !== null
                ? <pre className="bg-slate-950 border border-slate-800 rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap text-slate-200">{preview.text}</pre>
                : <HexView lba={null} data={preview.bytes.subarray(0, 4096)} />}
            </div>
          )}
        </div>
      )}

      {online && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-slate-200">SECTOR VIEWER</span>
            <span className="text-slate-500">LBA</span>
            <input value={lba} onChange={(e) => setLba(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && readSector()} className="w-28 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
            <button onClick={readSector} disabled={!!busy} className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold disabled:opacity-40"><Search className="w-3.5 h-3.5" /> {busy === 'read' ? 'READING...' : 'READ SECTOR'}</button>
          </div>
          {sector && <HexView lba={sector.lba} data={sector.data} />}
        </div>
      )}
    </div>
  );
}

/** A strip across the imaged range: red where sectors were unreadable, amber where they were skipped unread. */
function BadSectorMap({ dump }) {
  const cells = badSectorMap(dump.badRanges, dump.startLba, dump.sectors, 100);
  return (
    <div className="space-y-1">
      <div className="text-rose-300 font-bold">
        {dump.badRanges.length} unreadable range{dump.badRanges.length === 1 ? '' : 's'} (zero-filled in the image)
      </div>
      <div className="flex h-3 rounded overflow-hidden border border-slate-800" title="Start of range on the left, end on the right">
        {cells.map((c, i) => (
          <div key={i} className={`flex-1 ${c.bad ? 'bg-rose-500' : c.skipped ? 'bg-amber-500' : 'bg-emerald-900/60'}`} />
        ))}
      </div>
      <div className="text-[10px] text-slate-500">Green read fine, red could not be read, amber was skipped without a read after repeated errors.</div>
      <div className="max-h-32 overflow-auto text-[11px] text-slate-300">
        {dump.badRanges.slice(0, 200).map((r, i) => (
          <div key={i}>LBA {r.startLba.toLocaleString()} - {(r.startLba + r.sectors - 1).toLocaleString()} ({r.sectors.toLocaleString()} sectors){r.skipped ? ' skipped' : ''} <span className="text-slate-500">{r.error}</span></div>
        ))}
        {dump.badRanges.length > 200 && <div className="text-slate-500">...and {dump.badRanges.length - 200} more in the downloaded log.</div>}
      </div>
    </div>
  );
}

function HexView({ lba, data }) {
  const rows = [];
  for (let off = 0; off < data.length; off += 16) {
    const slice = data.subarray(off, off + 16);
    const hex = Array.from(slice).map((b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice).map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '·')).join('');
    rows.push({ off, hex, ascii });
  }
  return (
    <div>
      <div className="text-[11px] text-slate-500 mb-1">{lba !== null ? `LBA ${lba} — ` : ''}{data.length} bytes</div>
      <div className="bg-slate-950 border border-slate-800 rounded p-2 max-h-80 overflow-auto text-[11px] leading-snug">
        {rows.map((r) => (
          <div key={r.off} className="flex gap-3 whitespace-pre">
            <span className="text-slate-600">{r.off.toString(16).padStart(4, '0')}</span>
            <span className="text-cyan-300">{r.hex.padEnd(47, ' ')}</span>
            <span className="text-purple-300">{r.ascii}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
      <span className="text-[10px] text-slate-500 font-bold uppercase block">{label}</span>
      <span className="text-slate-200 font-semibold break-all">{value ?? '—'}</span>
    </div>
  );
}
