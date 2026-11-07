import React, { useState, useRef } from 'react';
import { HardDrive, Usb, Power, ShieldAlert, Sparkles, Search, Loader2, Folder, FileText, Download, ChevronRight, Trash2, Square, Hash } from 'lucide-react';
import { MassStorageDevice, requestMassStorageDevice } from '../../utils/massStorageDriver';
import { DiskReader, readPartitionTable, detectFilesystem, openVolume, Sha256 } from '../../utils/diskImage';
import StatusBadge from '../common/StatusBadge';

import { confirmAction, useSessionError } from '../../utils/sessionLog';
const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 2 : 0)} ${u[i]}`;
};

const saveBlob = (parts, name) => {
  const url = URL.createObjectURL(new Blob(parts));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function MassStorageWorkbench() {
  const [dev, setDev] = useState(null);
  const [status, setStatus] = useState('offline');
  const [inquiry, setInquiry] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const [lba, setLba] = useState('0');
  const [sector, setSector] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useSessionError('Mass Storage');
  const [table, setTable] = useState(null); // { scheme, partitions: [{ ..., fs }] }
  const [browser, setBrowser] = useState(null); // { part, vol, path: [{ name, entry }], entries }
  const [showDeleted, setShowDeleted] = useState(true);
  const [preview, setPreview] = useState(null); // { name, text, bytes, truncated }
  const [dump, setDump] = useState(null); // { label, done, total, startedAt, sha256 }
  const readerRef = useRef(null);
  const cancelDump = useRef(false);
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const scanPartitions = async (d, cap) => {
    const reader = new DiskReader((start, n) => d.read(start, Math.max(1, Math.min(n, cap.blocks - start))), { blockSize: cap.blockSize });
    readerRef.current = reader;
    try {
      const pt = await readPartitionTable((o, n) => reader.read(o, n), { blockSize: cap.blockSize });
      for (const p of pt.partitions) {
        if (p.sectors === null) p.sectors = cap.blocks;
        try { p.fs = await detectFilesystem(reader.at(p.startLba * cap.blockSize)); } catch (e) { p.fs = { type: 'unreadable' }; }
      }
      setTable(pt);
    } catch (e) {
      setError(`Partition table: ${e.message}`);
    }
  };

  const connect = async () => {
    if (!confirmAction('Inspect a USB mass-storage device?\n\nThis CLAIMS the drive for this tab, taking it away from the operating system for the session. Use a drive that is NOT mounted/in use, and never one with data you cannot lose mounted elsewhere. This tool is read-only (no writes), but unmounting an in-use disk can still disrupt the OS.')) return;
    setBusy('connect'); setError('');
    try {
      const transport = await requestMassStorageDevice();
      const d = new MassStorageDevice(transport);
      await d.open();
      await d.testUnitReady();
      setInquiry(await d.inquiry());
      const cap = await d.readCapacity();
      setCapacity(cap);
      setDev(d); setStatus('online');
      await scanPartitions(d, cap);
    } catch (err) { setError(err.message); setStatus('warning'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    cancelDump.current = true;
    try { await dev?.close(); } catch (e) { /* ignore */ }
    setDev(null); setStatus('offline'); setInquiry(null); setCapacity(null); setSector(null);
    setTable(null); setBrowser(null); setPreview(null); setDump(null);
  };

  const readSector = async () => {
    if (!dev) return;
    setBusy('read'); setError('');
    try {
      const n = parseInt(lba, 10);
      if (Number.isNaN(n) || n < 0 || (capacity && n >= capacity.blocks)) throw new Error(`LBA must be 0..${(capacity?.blocks ?? 1) - 1}.`);
      setSector({ lba: n, data: await dev.read(n, 1) });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  // --- File browser ---------------------------------------------------------

  const browse = async (part) => {
    setBusy('browse'); setError(''); setPreview(null);
    try {
      const vol = await openVolume(readerRef.current.at(part.startLba * capacity.blockSize));
      if (!vol) throw new Error(`${part.fs?.type || 'This filesystem'} can't be browsed here (FAT12/16/32 and exFAT can).`);
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
    if (entry.size > 512 * 1024 * 1024) throw new Error('Files over 512 MB are better copied out of a full image.');
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

  // --- Imaging --------------------------------------------------------------

  /** Image the whole drive or one partition to a file, hashing as it goes. */
  const dumpRange = async (label, startLba, sectors) => {
    if (!dev) return;
    const bs = capacity.blockSize;
    const total = sectors * bs;
    const name = `${label.replace(/[^\w.-]+/g, '_')}.img`;
    let writable = null;
    const parts = [];
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: name, types: [{ description: 'Disk image', accept: { 'application/octet-stream': ['.img', '.bin'] } }] });
        writable = await handle.createWritable();
      } catch (e) {
        if (e.name === 'AbortError') return;
      }
    }
    if (!writable && total > 1024 * 1024 * 1024) { setError('Images over 1 GB need a browser that can save straight to disk (Chrome or Edge).'); return; }
    cancelDump.current = false;
    setError('');
    const hash = new Sha256();
    const startedAt = performance.now();
    setDump({ label, done: 0, total, startedAt, sha256: null });
    const chunk = 128; // sectors per READ(10): 64 KB with 512-byte sectors
    try {
      for (let off = 0; off < sectors; off += chunk) {
        if (cancelDump.current) throw new Error('Imaging cancelled.');
        const n = Math.min(chunk, sectors - off);
        const data = await dev.read(startLba + off, n);
        hash.update(data);
        if (writable) await writable.write(data); else parts.push(data);
        if (off % (chunk * 16) === 0 || off + n >= sectors) setDump({ label, done: (off + n) * bs, total, startedAt, sha256: null });
      }
      const sha256 = hash.hex();
      if (writable) await writable.close(); else saveBlob(parts, name);
      setDump({ label, done: total, total, startedAt, sha256, seconds: (performance.now() - startedAt) / 1000 });
    } catch (err) {
      if (writable) { try { await writable.abort(); } catch (e) { /* ignore */ } }
      setError(err.message);
      setDump(null);
    }
  };

  const dumping = !!(dump && !dump.sha256);
  const btnSm = 'px-2 py-0.5 rounded border font-bold disabled:opacity-40';

  return (
    <div className="space-y-4 font-mono text-xs">

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Read a USB drive's SCSI identity, capacity, partition table (MBR / GPT) and filesystems; browse FAT and exFAT volumes,
              recover deleted files, view raw sectors and save a full image with its SHA-256. Read-only: it issues no WRITE command.
              Connecting claims the drive from the OS for this tab, so use an unmounted drive.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'SCSI' : status === 'warning' ? 'ERR' : 'IDLE'} value={dev ? 'Connected' : 'Offline'} />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!dev ? (
            <button onClick={() => connect()} disabled={!webUsbAvailable || !!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 text-xs font-bold disabled:opacity-40">
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} INSPECT A DRIVE (WEBUSB)
            </button>
          ) : (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> DISCONNECT
            </button>
          )}
        </div>
      </div>

      {inquiry && capacity && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl grid grid-cols-2 @sm:grid-cols-4 gap-3">
          <Field label="Vendor" value={inquiry.vendor} />
          <Field label="Product" value={inquiry.product} />
          <Field label="Revision" value={inquiry.revision} />
          <Field label="Type" value={inquiry.peripheralName} />
          <Field label="Removable" value={inquiry.removable ? 'yes' : 'no'} />
          <Field label="Block size" value={`${capacity.blockSize} B`} />
          <Field label="Blocks" value={capacity.blocks.toLocaleString()} />
          <Field label="Capacity" value={fmtBytes(capacity.totalBytes)} />
        </div>
      )}

      {dev && table && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-200">
              PARTITIONS{' '}
              <span className="text-slate-500 font-normal">
                ({table.scheme === 'gpt' ? `GPT, disk ${table.diskGuid}` : table.scheme === 'mbr' ? `MBR, disk ID ${table.diskId}` : 'no partition table'})
              </span>
            </span>
            <button onClick={() => dumpRange(`${inquiry?.product || 'drive'}-full`, 0, capacity.blocks)} disabled={!!busy || dumping} className="flex items-center gap-1 px-3 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold disabled:opacity-40">
              <Download className="w-3.5 h-3.5" /> IMAGE WHOLE DRIVE ({fmtBytes(capacity.totalBytes)})
            </button>
          </div>
          {table.partitions.length === 0 && <div className="text-slate-500">No partitions found (a blank drive, or a layout this tool doesn't read).</div>}
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
                      <button onClick={() => dumpRange(`partition${p.index}-${p.fs?.label || p.typeName}`, p.startLba, p.sectors)} disabled={!!busy || dumping} className={`${btnSm} border-amber-500/40 text-amber-300`}>IMAGE</button>
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
                <span className="text-slate-500">{fmtBytes(dump.done)} / {fmtBytes(dump.total)}</span>
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
              <div className="h-1.5 bg-slate-900 rounded"><div className="h-1.5 bg-amber-400 rounded" style={{ width: `${(dump.done / dump.total) * 100}%` }} /></div>
              {dump.sha256 && (
                <div className="flex items-center gap-1 text-emerald-300 break-all">
                  <Hash className="w-3.5 h-3.5 shrink-0" /> SHA-256 {dump.sha256} <span className="text-slate-500">({dump.seconds.toFixed(1)} s)</span>
                </div>
              )}
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

      {dev && (
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
