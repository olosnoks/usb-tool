import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Keyboard,
  Usb,
  Power,
  ShieldAlert,
  Activity,
  Send
} from 'lucide-react';
import {
  describeCollections,
  decodeReport,
  hexDump,
  usageName,
  requestHidDevice,
  listGrantedHidDevices
} from '../../utils/hidInspector';
import StatusBadge from '../common/StatusBadge';
import HidReportTools from './hid/HidReportTools';
import HidDescriptorDecoder from './hid/HidDescriptorDecoder';

import { useSessionError } from '../../utils/sessionLog';

export default function HidInspectorWorkbench() {
  const [device, setDevice] = useState(null);
  const [info, setInfo] = useState(null); // described collections
  const [meta, setMeta] = useState(null); // { vendorId, productId, productName }
  const [granted, setGranted] = useState([]);
  const [error, setError] = useSessionError('HID');
  const [lastReport, setLastReport] = useState(null); // { reportId, hex, fields }
  const reportMapRef = useRef({}); // reportId -> describedReport
  const listenerRef = useRef(null);
  const tapsRef = useRef(new Set());
  // Subscribe to every input report (reportId, bytes, timestamp ms); returns the unsubscribe.
  const addTap = useCallback((fn) => { tapsRef.current.add(fn); return () => tapsRef.current.delete(fn); }, []);

  const webHidAvailable = typeof navigator !== 'undefined' && 'hid' in navigator;

  const refreshGranted = useCallback(async () => setGranted(await listGrantedHidDevices()), []);
  useEffect(() => { refreshGranted(); }, [refreshGranted]);

  // Keep the "already allowed" count current when devices are plugged in or removed.
  useEffect(() => {
    if (!webHidAvailable) return undefined;
    const onChange = () => { refreshGranted(); };
    navigator.hid.addEventListener('connect', onChange);
    navigator.hid.addEventListener('disconnect', onChange);
    return () => {
      navigator.hid.removeEventListener('connect', onChange);
      navigator.hid.removeEventListener('disconnect', onChange);
    };
  }, [webHidAvailable, refreshGranted]);

  const buildReportMap = (collections) => {
    const map = {};
    for (const col of collections) for (const r of col.inputReports) map[r.reportId] = r;
    reportMapRef.current = map;
  };

  const stopEverything = () => {
    if (device && listenerRef.current) { try { device.removeEventListener('inputreport', listenerRef.current); } catch (e) { /* ignore */ } }
    listenerRef.current = null;
  };

  const onInputReport = (reportId, dataView) => {
    // No silent fallback to report 0: an id the descriptor does not declare is shown raw, not mis-decoded.
    const described = reportMapRef.current[reportId];
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    const t = performance.now();
    for (const tap of tapsRef.current) tap(reportId, bytes, t);
    let fields = [];
    try { if (described) fields = decodeReport(described, dataView); } catch (e) { /* undecodable */ }
    setLastReport({ reportId, hex: hexDump(bytes), fields, unknownId: !described });
  };

  const connect = async () => {
    setError('');
    try {
      const dev = await requestHidDevice();
      if (!dev) return;
      if (!dev.opened) await dev.open();
      const collections = describeCollections(dev.collections);
      buildReportMap(collections);
      const handler = (e) => onInputReport(e.reportId, e.data);
      dev.addEventListener('inputreport', handler);
      listenerRef.current = handler;
      setDevice(dev);
      setInfo(collections);
      setMeta({ vendorId: dev.vendorId, productId: dev.productId, productName: dev.productName });
      await refreshGranted();
    } catch (err) {
      setError(err.message);
    }
  };


  const disconnect = async () => {
    stopEverything();
    try { if (device) await device.close(); } catch (e) { /* ignore */ }
    setDevice(null);
    setInfo(null);
    setMeta(null);
    setLastReport(null);
  };

  useEffect(() => () => stopEverything(), []); // cleanup on unmount

  return (
    <div className="space-y-4 font-mono text-xs">

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Inspect any HID device — keyboard, mouse, game controller, or a vendor gadget — and watch its input reports decode
              live into named fields (buttons, axes, keys). Measure its report rate, record and play back reports, and send output
              or feature reports (keyboard LEDs, vendor settings) when you choose to.
            </p>
          </div>
          <StatusBadge status={device ? 'online' : 'offline'} label="HID" value={device ? 'Live' : 'Idle'} pulse={!!device} />
        </div>

        {!webHidAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebHID needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}
        {error && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!device ? (
            <>
              <button onClick={connect} disabled={!webHidAvailable} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-xs font-bold disabled:opacity-40">
                <Usb className="w-3.5 h-3.5" /> OPEN HID DEVICE
              </button>
            </>
          ) : (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> CLOSE
            </button>
          )}
          {granted.length > 0 && !device && (
            <span className="text-[11px] text-slate-500">{granted.length} device(s) already allowed</span>
          )}
        </div>
        {meta && <p className="mt-2 text-[11px] text-slate-500">{meta.vendorId?.toString(16).padStart(4, '0')}:{meta.productId?.toString(16).padStart(4, '0')} — {meta.productName || '(no name)'}</p>}
      </div>

      <HidDescriptorDecoder />

      {info && (
        <div className="grid grid-cols-1 @lg:grid-cols-2 gap-4">
          {/* Live input */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
            <span className="font-bold text-slate-200 flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /> LIVE INPUT</span>
            {!lastReport ? (
              <p className="text-slate-500">Move / press the device to see reports…</p>
            ) : (
              <>
                <div className="text-[11px] text-slate-500">Report {lastReport.reportId} — <span className="text-cyan-300">{lastReport.hex}</span></div>
                {lastReport.unknownId && (
                  <div className="text-[11px] text-amber-300">Report id {lastReport.reportId} is not in this device's descriptor, so it is shown raw and not decoded.</div>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  {lastReport.fields.map((f, i) => (
                    <div key={i} className="flex justify-between gap-2 px-2 py-1 rounded bg-slate-950 border border-slate-800">
                      <span className="text-slate-400 truncate">{f.label}</span>
                      <span className={`font-bold ${f.type === 'array' ? 'text-purple-300' : f.value ? 'text-emerald-300' : 'text-slate-500'}`}>
                        {f.type === 'array' ? (f.active.join(', ') || '—') : f.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          <HidReportTools
            device={device}
            info={info}
            meta={meta}
            addTap={addTap}
            inject={(reportId, bytes) => onInputReport(reportId, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength))}
          />

          {/* Report descriptor */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
            <span className="font-bold text-slate-200">REPORT DESCRIPTOR</span>
            {info.map((col, ci) => (
              <div key={ci} className="space-y-1 border-l-2 border-slate-800 pl-2">
                <div className="text-cyan-300 font-bold">{col.name} <span className="text-slate-600 text-[10px]">[{col.usagePage}/{col.usage}]</span></div>
                {['inputReports', 'outputReports', 'featureReports'].map((kind) => col[kind].map((r, ri) => (
                  <div key={`${kind}-${ri}`} className="text-[11px]">
                    <span className="text-slate-500">{kind.replace('Reports', '').toUpperCase()} report {r.reportId} — {r.byteLength}B:</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {r.fields.map((f, fi) => (
                        <span key={fi} className="px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400">
                          {f.isConstant ? 'pad' : (f.usages[0]?.name || usageName(f.usagePage, 0))}{f.count > 1 ? `×${f.count}` : ''} ({f.bitSize}b)
                        </span>
                      ))}
                    </div>
                  </div>
                )))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
