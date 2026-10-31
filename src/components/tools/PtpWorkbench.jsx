import React, { useState, useCallback } from 'react';
import { Camera, Usb, Power, ShieldAlert, Sparkles, Download, RefreshCw, Loader2 } from 'lucide-react';
import { PtpDevice, requestPtpDevice, createSimulatedPtp, objectFormatName } from '../../utils/ptpDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export default function PtpWorkbench() {
  const [ptp, setPtp] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState('offline');
  const [info, setInfo] = useState(null);
  const [objects, setObjects] = useState([]); // { handle, info }
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const loadObjects = async (dev) => {
    const handles = await dev.getObjectHandles();
    const list = [];
    for (const h of handles.slice(0, 2000)) {
      try { list.push({ handle: h, info: await dev.getObjectInfo(h) }); } catch (e) { /* skip */ }
    }
    // Hide folders (associations); show files only.
    setObjects(list.filter((o) => o.info.objectFormat !== 0x3001));
  };

  const connect = async (simulated) => {
    setBusy('connect'); setError('');
    try {
      const transport = simulated ? createSimulatedPtp() : await requestPtpDevice();
      const dev = new PtpDevice(transport);
      await dev.open();
      await dev.openSession();
      setInfo(await dev.getDeviceInfo());
      setPtp(dev); setIsSimulated(simulated); setStatus(simulated ? 'warning' : 'online');
      await loadObjects(dev);
    } catch (err) { setError(err.message); setStatus('warning'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    try { await ptp?.closeSession(); await ptp?.close(); } catch (e) { /* ignore */ }
    setPtp(null); setIsSimulated(false); setStatus('offline'); setInfo(null); setObjects([]);
  };

  const download = async (obj) => {
    setBusy(`dl-${obj.handle}`); setError('');
    try {
      const data = await ptp.getObject(obj.handle);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a');
      a.href = url; a.download = obj.info.filename || `object_${obj.handle}`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated camera: the device info and photos below are invented, not from hardware.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Camera className="w-4 h-4 text-purple-400" /> <span>PTP / MTP CAMERA</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Pull photos and metadata off a camera or phone in <b>PTP mode</b> (on a phone: USB → "Transfer photos / PTP"). List files,
              read their info, and download them. Read-only browsing — nothing is deleted.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'PTP' : status === 'warning' ? 'SIM' : 'IDLE'} value={ptp ? (isSimulated ? 'Demo' : 'Connected') : 'Offline'} />
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
          {!ptp ? (
            <>
              <button onClick={() => connect(false)} disabled={!webUsbAvailable || !!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-xs font-bold disabled:opacity-40">
                {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} CONNECT CAMERA (WEBUSB)
              </button>
              <button onClick={() => connect(true)} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-purple-300 border border-purple-500/40 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" /> DEMO
              </button>
            </>
          ) : (
            <>
              <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
                <Power className="w-3.5 h-3.5" /> DISCONNECT
              </button>
              <button onClick={() => { setBusy('refresh'); loadObjects(ptp).finally(() => setBusy('')); }} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-slate-800 text-xs font-bold disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> REFRESH
              </button>
            </>
          )}
        </div>
      </div>

      {info && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Manufacturer" value={info.manufacturer} />
          <Field label="Model" value={info.model} />
          <Field label="Firmware" value={info.deviceVersion} />
          <Field label="Serial" value={info.serialNumber} />
        </div>
      )}

      {ptp && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200">FILES</span>
            <span className="text-slate-500">{objects.length} object(s)</span>
          </div>
          <div className="mt-2 max-h-96 overflow-auto">
            {objects.length === 0 ? (
              <p className="text-slate-600">No files found (or still loading).</p>
            ) : (
              <table className="w-full text-left">
                <thead className="text-slate-500 text-[10px] uppercase">
                  <tr><th className="py-1">Filename</th><th>Format</th><th>Size</th><th>Dimensions</th><th>Date</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {objects.map((o) => (
                    <tr key={o.handle} className="hover:bg-slate-900/40">
                      <td className="py-1 text-slate-200">{o.info.filename || `#${o.handle}`}</td>
                      <td className="text-slate-400">{objectFormatName(o.info.objectFormat)}</td>
                      <td className="text-slate-400">{fmtBytes(o.info.compressedSize)}</td>
                      <td className="text-slate-500">{o.info.imagePixWidth ? `${o.info.imagePixWidth}×${o.info.imagePixHeight}` : '—'}</td>
                      <td className="text-slate-600">{o.info.captureDate || '—'}</td>
                      <td className="text-right">
                        <button onClick={() => download(o)} disabled={!!busy} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 disabled:opacity-40">
                          {busy === `dl-${o.handle}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} get
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
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
