import React, { useState, useCallback } from 'react';
import { HardDrive, Usb, Power, ShieldAlert, Sparkles, Search, Loader2 } from 'lucide-react';
import { MassStorageDevice, requestMassStorageDevice, createSimulatedMassStorage } from '../../utils/massStorageDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 2 : 0)} ${u[i]}`;
};

export default function MassStorageWorkbench() {
  const [dev, setDev] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState('offline');
  const [inquiry, setInquiry] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const [lba, setLba] = useState('0');
  const [sector, setSector] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const connect = async (simulated) => {
    if (!simulated && !window.confirm('Inspect a USB mass-storage device?\n\nThis CLAIMS the drive for this tab, taking it away from the operating system for the session. Use a drive that is NOT mounted/in use, and never one with data you cannot lose mounted elsewhere. This tool is read-only (no writes), but unmounting an in-use disk can still disrupt the OS.')) return;
    setBusy('connect'); setError('');
    try {
      const transport = simulated ? createSimulatedMassStorage() : await requestMassStorageDevice();
      const d = new MassStorageDevice(transport);
      await d.open();
      await d.testUnitReady();
      setInquiry(await d.inquiry());
      setCapacity(await d.readCapacity());
      setDev(d); setIsSimulated(simulated); setStatus(simulated ? 'warning' : 'online');
    } catch (err) { setError(err.message); setStatus('warning'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    try { await dev?.close(); } catch (e) { /* ignore */ }
    setDev(null); setIsSimulated(false); setStatus('offline'); setInquiry(null); setCapacity(null); setSector(null);
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

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated 8 MiB drive: the identity and sector contents below are invented.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-amber-400" /> <span>USB MASS STORAGE INSPECTOR (READ-ONLY)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Read a USB drive's SCSI identity (INQUIRY), its capacity, and raw sectors over the Bulk-Only Transport. Read-only —
              it issues no WRITE command. Connecting claims the drive from the OS for this tab, so use an unmounted drive.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'SCSI' : status === 'warning' ? 'SIM' : 'IDLE'} value={dev ? (isSimulated ? 'Demo' : 'Connected') : 'Offline'} />
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
            <>
              <button onClick={() => connect(false)} disabled={!webUsbAvailable || !!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600 text-slate-950 text-xs font-bold disabled:opacity-40">
                {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} INSPECT A DRIVE (WEBUSB)
              </button>
              <button onClick={() => connect(true)} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-amber-300 border border-amber-500/40 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" /> DEMO
              </button>
            </>
          ) : (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> DISCONNECT
            </button>
          )}
        </div>
      </div>

      {inquiry && capacity && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl grid grid-cols-2 sm:grid-cols-4 gap-3">
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
      <div className="text-[11px] text-slate-500 mb-1">LBA {lba} — {data.length} bytes</div>
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
