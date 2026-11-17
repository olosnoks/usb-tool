import React, { useState, useRef, useEffect } from 'react';
import { Camera, Usb, Power, ShieldAlert, Sparkles, Download, RefreshCw, Loader2, Image as ImageIcon, Trash2, Aperture, Upload, SlidersHorizontal, Bell } from 'lucide-react';
import JSZip from 'jszip';
import { PtpDevice, requestPtpDevice, objectFormatName, PTP_OP, PTP_EVENT } from '../../utils/ptpDriver';
import { imageMime } from '../../utils/scpiTools';
import StatusBadge from '../common/StatusBadge';

import { confirmAction, useSessionError } from '../../utils/sessionLog';
const fmtBytes = (n) => {
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
};

export default function PtpWorkbench() {
  const [ptp, setPtp] = useState(null);
  const [status, setStatus] = useState('offline');
  const [info, setInfo] = useState(null);
  const [objects, setObjects] = useState([]); // { handle, info }
  const [busy, setBusy] = useState('');
  const [error, setError] = useSessionError('PTP');
  const [storage, setStorage] = useState([]);
  const [battery, setBattery] = useState(null);
  const [thumbs, setThumbs] = useState({}); // handle -> object URL
  const [selected, setSelected] = useState(new Set());
  const [bulk, setBulk] = useState(null); // { done, total }
  const [props, setProps] = useState([]); // property descriptors the camera reported
  const [events, setEvents] = useState([]);
  const [eventsOn, setEventsOn] = useState(false);
  const ptpRef = useRef(null);
  const pollRef = useRef(null);
  const fileRef = useRef(null);
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  // Stop event polling and close the camera when the tool is closed.
  useEffect(() => () => {
    pollRef.current?.stop();
    const dev = ptpRef.current;
    ptpRef.current = null;
    if (dev) dev.closeSession().then(() => dev.close()).catch(() => {});
  }, []);

  const loadProps = async (dev) => { try { setProps(await dev.getCommonProps()); } catch (e) { setProps([]); } };

  const changeProp = async (code, raw) => {
    setBusy('prop'); setError('');
    try {
      const next = await ptp.setDeviceProp(code, raw);
      setProps((list) => list.map((p) => (p.code === code ? next : p)));
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const toggleEvents = (on, dev = ptp) => {
    pollRef.current?.stop();
    pollRef.current = null;
    setEventsOn(false);
    if (!on || !dev) return;
    const h = dev.startEventPolling((ev) => {
      setEvents((list) => [{ ...ev, at: new Date().toLocaleTimeString() }, ...list].slice(0, 50));
      if (ev.code === PTP_EVENT.DevicePropChanged) loadProps(dev);
    }, { onError: (e) => setError(`Event polling: ${e.message}`) });
    pollRef.current = h;
    setEventsOn(!!h);
  };

  const upload = async (file) => {
    if (!file) return;
    if (!confirmAction(`Copy "${file.name}" (${fmtBytes(file.size)}) to the camera storage?`)) return;
    setBusy('upload'); setError('');
    try {
      const [storageId] = storage.length ? [storage[0].id] : await ptp.getStorageIds();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await ptp.uploadObject({ storageId, filename: file.name, bytes });
      await loadObjects(ptp);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };

  const loadObjects = async (dev) => {
    const handles = await dev.getObjectHandles();
    const list = [];
    for (const h of handles.slice(0, 2000)) {
      try { list.push({ handle: h, info: await dev.getObjectInfo(h) }); } catch (e) { /* skip */ }
    }
    // Hide folders (associations); show files only.
    setObjects(list.filter((o) => o.info.objectFormat !== 0x3001));
  };

  const connect = async () => {
    setBusy('connect'); setError('');
    try {
      const transport = await requestPtpDevice();
      const dev = new PtpDevice(transport);
      await dev.open();
      await dev.openSession();
      setInfo(await dev.getDeviceInfo());
      setPtp(dev); ptpRef.current = dev; setStatus('online');
      await loadProps(dev);
      const ids = await dev.getStorageIds().catch(() => []);
      const st = [];
      for (const id of ids) { try { st.push({ id, ...(await dev.getStorageInfo(id)) }); } catch (e) { /* not supported */ } }
      setStorage(st);
      setBattery(await dev.getBatteryLevel());
      await loadObjects(dev);
    } catch (err) { setError(err.message); setStatus('warning'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    toggleEvents(false);
    ptpRef.current = null;
    try { await ptp?.closeSession(); await ptp?.close(); } catch (e) { /* ignore */ }
    setProps([]); setEvents([]);
    setPtp(null); setStatus('offline'); setInfo(null); setObjects([]);
    Object.values(thumbs).forEach((u) => URL.revokeObjectURL(u));
    setThumbs({}); setSelected(new Set()); setStorage([]); setBattery(null);
  };

  const loadThumbs = async () => {
    setBusy('thumbs'); setError('');
    try {
      const next = { ...thumbs };
      for (const o of objects.slice(0, 300)) {
        if (next[o.handle] || !o.info.thumbCompressedSize) continue;
        const data = await ptp.getThumb(o.handle);
        if (data && imageMime(data)) next[o.handle] = URL.createObjectURL(new Blob([data], { type: imageMime(data) }));
        setThumbs({ ...next });
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  /** Save several files: into a folder you pick (Chrome/Edge) or as one zip. */
  const downloadMany = async (list) => {
    if (!list.length) return;
    setBusy('bulk'); setError('');
    try {
      let dir = null;
      if (window.showDirectoryPicker) {
        try { dir = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name === 'AbortError') return; }
      }
      const zip = dir ? null : new JSZip();
      for (let i = 0; i < list.length; i++) {
        setBulk({ done: i, total: list.length });
        const o = list[i];
        const name = o.info.filename || `object_${o.handle}`;
        const data = await ptp.getObject(o.handle);
        if (dir) {
          const fh = await dir.getFileHandle(name, { create: true });
          const w = await fh.createWritable();
          await w.write(data);
          await w.close();
        } else zip.file(name, data);
      }
      if (zip) {
        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${info?.model || 'camera'}-photos.zip`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setBulk({ done: list.length, total: list.length });
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const deleteSelected = async () => {
    const list = objects.filter((o) => selected.has(o.handle));
    if (!list.length || !confirmAction(`Delete ${list.length} file(s) from the camera? This cannot be undone.`)) return;
    setBusy('delete'); setError('');
    try {
      for (const o of list) await ptp.deleteObject(o.handle);
      setSelected(new Set());
      await loadObjects(ptp);
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const capture = async () => {
    setBusy('capture'); setError('');
    try {
      const fresh = await ptp.capture();
      await loadObjects(ptp);
      setSelected(new Set(fresh));
    } catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const toggle = (h) => setSelected((prev) => { const n = new Set(prev); if (n.has(h)) n.delete(h); else n.add(h); return n; });

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

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Pull photos and metadata off a camera or phone in <b>PTP mode</b> (on a phone: USB → "Transfer photos / PTP"). See storage and
              battery, browse with thumbnails, download one, several or all files, delete, and fire the shutter remotely on cameras that allow it.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'PTP' : status === 'warning' ? 'ERR' : 'IDLE'} value={ptp ? 'Connected' : 'Offline'} />
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
            <button onClick={() => connect()} disabled={!webUsbAvailable || !!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-xs font-bold disabled:opacity-40">
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} CONNECT CAMERA (WEBUSB)
            </button>
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
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl grid grid-cols-2 @sm:grid-cols-4 gap-3">
          <Field label="Manufacturer" value={info.manufacturer} />
          <Field label="Model" value={info.model} />
          <Field label="Firmware" value={info.deviceVersion} />
          <Field label="Serial" value={info.serialNumber} />
          {battery !== null && <Field label="Battery" value={`${battery}%`} />}
          {storage.map((st) => (
            <Field key={st.id} label={`Storage ${st.description || st.id.toString(16)}`} value={`${fmtBytes(st.freeSpace)} free of ${fmtBytes(st.maxCapacity)}${st.volumeLabel ? ` · ${st.volumeLabel}` : ''}${st.readOnly ? ' · read-only' : ''}`} />
          ))}
        </div>
      )}

      {ptp && (props.length > 0 || ptp.canPollEvents) && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          {props.length > 0 && (
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-200 flex items-center gap-2"><SlidersHorizontal className="w-4 h-4 text-cyan-400" /> CAMERA SETTINGS</span>
                <button onClick={() => { setBusy('props'); loadProps(ptp).finally(() => setBusy('')); }} disabled={!!busy} className="p-1 rounded bg-slate-900 text-cyan-400 border border-slate-800 disabled:opacity-40" title="Read again">
                  <RefreshCw className={`w-3.5 h-3.5 ${busy === 'props' ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="grid grid-cols-2 @sm:grid-cols-3 gap-2 pt-2">
                {props.map((p) => (
                  <div key={p.code} className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-[10px] text-slate-500 font-bold uppercase block">{p.name}</span>
                    {p.writable && p.options && ptp.supports(PTP_OP.SetDevicePropValue) ? (
                      <select
                        value={p.value}
                        disabled={!!busy}
                        onChange={(e) => changeProp(p.code, e.target.value)}
                        aria-label={p.name}
                        className="mt-0.5 w-full bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-slate-200 font-semibold disabled:opacity-40"
                      >
                        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    ) : (
                      <span className="text-slate-200 font-semibold">{p.display}{p.writable ? '' : ' (read-only)'}</span>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-600 pt-1">Only settings this camera reports are shown. Changes apply to the camera right away.</p>
            </div>
          )}
          {ptp.canPollEvents && (
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-200 flex items-center gap-2"><Bell className="w-4 h-4 text-amber-400" /> CAMERA EVENTS</span>
                <label className="flex items-center gap-1.5 text-slate-400">
                  <input type="checkbox" checked={eventsOn} onChange={(e) => toggleEvents(e.target.checked)} /> listen
                </label>
              </div>
              <div className="pt-1 max-h-32 overflow-auto text-[11px]">
                {events.length === 0 ? <p className="text-slate-600">{eventsOn ? 'Waiting for events (press the shutter, change a setting)...' : 'Turn on "listen" to see ObjectAdded, DevicePropChanged and CaptureComplete as they happen.'}</p> : events.map((ev, i) => (
                  <div key={i} className="text-slate-400"><span className="text-slate-600">[{ev.at}]</span> <span className="text-cyan-300">{ev.name}</span>{ev.params.length ? ` (${ev.params.map((x) => `0x${x.toString(16)}`).join(', ')})` : ''}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {ptp && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200">FILES</span>
            <span className="text-slate-500">{objects.length} object(s){selected.size ? ` · ${selected.size} selected` : ''}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button onClick={loadThumbs} disabled={!!busy || !objects.length} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40"><ImageIcon className="w-3.5 h-3.5" /> THUMBNAILS</button>
            <button onClick={() => downloadMany(objects.filter((o) => selected.has(o.handle)))} disabled={!!busy || !selected.size} className="flex items-center gap-1 px-2 py-1 rounded bg-purple-500/20 border border-purple-500/40 text-purple-300 font-bold disabled:opacity-40"><Download className="w-3.5 h-3.5" /> DOWNLOAD SELECTED</button>
            <button onClick={() => downloadMany(objects)} disabled={!!busy || !objects.length} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40"><Download className="w-3.5 h-3.5" /> DOWNLOAD ALL</button>
            {ptp.supports(PTP_OP.DeleteObject) && (
              <button onClick={deleteSelected} disabled={!!busy || !selected.size} className="flex items-center gap-1 px-2 py-1 rounded bg-rose-500/20 border border-rose-500/40 text-rose-300 font-bold disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /> DELETE</button>
            )}
            {ptp.supports(PTP_OP.InitiateCapture) && (
              <button onClick={capture} disabled={!!busy} className="flex items-center gap-1 px-2 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold disabled:opacity-40">
                {busy === 'capture' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Aperture className="w-3.5 h-3.5" />} CAPTURE
              </button>
            )}
            {ptp.canUpload && (
              <>
                <input ref={fileRef} type="file" className="hidden" aria-label="File to upload" onChange={(e) => upload(e.target.files?.[0])} />
                <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-200 font-bold disabled:opacity-40">
                  {busy === 'upload' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} UPLOAD FILE
                </button>
              </>
            )}
            {bulk && busy === 'bulk' && <span className="text-slate-400">{bulk.done} / {bulk.total}</span>}
            {bulk && busy !== 'bulk' && bulk.done === bulk.total && <span className="text-emerald-300">Saved {bulk.total} file(s).</span>}
          </div>
          <div className="mt-2 max-h-96 overflow-auto">
            {objects.length === 0 ? (
              <p className="text-slate-600">No files found (or still loading).</p>
            ) : (
              <table className="w-full text-left">
                <thead className="text-slate-500 text-[10px] uppercase">
                  <tr><th className="py-1 w-6"><input type="checkbox" checked={selected.size === objects.length} onChange={(e) => setSelected(e.target.checked ? new Set(objects.map((o) => o.handle)) : new Set())} /></th><th /><th className="py-1">Filename</th><th>Format</th><th>Size</th><th>Dimensions</th><th>Date</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {objects.map((o) => (
                    <tr key={o.handle} className="hover:bg-slate-900/40">
                      <td><input type="checkbox" checked={selected.has(o.handle)} onChange={() => toggle(o.handle)} /></td>
                      <td>{thumbs[o.handle] && <img src={thumbs[o.handle]} alt="" className="h-10 rounded border border-slate-800" />}</td>
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
