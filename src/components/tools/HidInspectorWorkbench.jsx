import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Keyboard,
  Usb,
  Power,
  ShieldAlert,
  Sparkles,
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
import { DemoBanner } from '../common/DemoNotice';

// A simulated mouse, so the live view can be explored with no device.
const DEMO_COLLECTIONS = [{
  usagePage: 0x01, usage: 0x02,
  inputReports: [{ reportId: 0, items: [
    { reportSize: 1, reportCount: 3, usagePage: 0x09, usageMinimum: 1, usageMaximum: 3, logicalMinimum: 0, logicalMaximum: 1 },
    { reportSize: 5, reportCount: 1, isConstant: true },
    { reportSize: 8, reportCount: 2, usagePage: 0x01, usages: [0x30, 0x31], logicalMinimum: -127, logicalMaximum: 127 }
  ] }],
  outputReports: [], featureReports: []
}];

export default function HidInspectorWorkbench() {
  const [device, setDevice] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [info, setInfo] = useState(null); // described collections
  const [meta, setMeta] = useState(null); // { vendorId, productId, productName }
  const [granted, setGranted] = useState([]);
  const [error, setError] = useState('');
  const [lastReport, setLastReport] = useState(null); // { reportId, hex, fields }
  const reportMapRef = useRef({}); // reportId -> describedReport
  const demoTimer = useRef(null);
  const listenerRef = useRef(null);

  const webHidAvailable = typeof navigator !== 'undefined' && 'hid' in navigator;

  const refreshGranted = useCallback(async () => setGranted(await listGrantedHidDevices()), []);
  useEffect(() => { refreshGranted(); }, [refreshGranted]);

  const buildReportMap = (collections) => {
    const map = {};
    for (const col of collections) for (const r of col.inputReports) map[r.reportId] = r;
    reportMapRef.current = map;
  };

  const stopEverything = () => {
    if (demoTimer.current) { clearInterval(demoTimer.current); demoTimer.current = null; }
    if (device && listenerRef.current) { try { device.removeEventListener('inputreport', listenerRef.current); } catch (e) { /* ignore */ } }
    listenerRef.current = null;
  };

  const onInputReport = (reportId, dataView) => {
    const described = reportMapRef.current[reportId] || reportMapRef.current[0];
    const bytes = new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength);
    let fields = [];
    try { if (described) fields = decodeReport(described, dataView); } catch (e) { /* undecodable */ }
    setLastReport({ reportId, hex: hexDump(bytes), fields });
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
      setIsSimulated(false);
      setInfo(collections);
      setMeta({ vendorId: dev.vendorId, productId: dev.productId, productName: dev.productName });
      await refreshGranted();
    } catch (err) {
      setError(err.message);
    }
  };

  const connectDemo = () => {
    stopEverything();
    const collections = describeCollections(DEMO_COLLECTIONS);
    buildReportMap(collections);
    setDevice({ demo: true });
    setIsSimulated(true);
    setInfo(collections);
    setMeta({ vendorId: 0x1234, productId: 0x0002, productName: 'Simulated Mouse' });
    demoTimer.current = setInterval(() => {
      const buttons = Math.floor(Math.random() * 8) & 0b101;
      const x = (Math.floor(Math.random() * 11) - 5) & 0xff;
      const y = (Math.floor(Math.random() * 11) - 5) & 0xff;
      onInputReport(0, new DataView(Uint8Array.from([buttons, x, y]).buffer));
    }, 250);
  };

  const disconnect = async () => {
    stopEverything();
    try { if (device && !device.demo) await device.close(); } catch (e) { /* ignore */ }
    setDevice(null);
    setIsSimulated(false);
    setInfo(null);
    setMeta(null);
    setLastReport(null);
  };

  useEffect(() => () => stopEverything(), []); // cleanup on unmount

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated mouse: the live reports below are random, not from a device.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Keyboard className="w-4 h-4 text-purple-400" />
              <span>HID INSPECTOR (WEBHID)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Inspect any HID device — keyboard, mouse, game controller, or a vendor gadget — and watch its input reports decode
              live into named fields (buttons, axes, keys). Read-only unless you explicitly send an output report.
            </p>
          </div>
          <StatusBadge status={device && !isSimulated ? 'online' : isSimulated ? 'warning' : 'offline'} label="HID" value={device ? (isSimulated ? 'Demo' : 'Live') : 'Idle'} pulse={!!device} />
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
              <button onClick={connectDemo} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-purple-300 border border-purple-500/40 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" /> DEMO
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

      {info && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Live input */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
            <span className="font-bold text-slate-200 flex items-center gap-2"><Activity className="w-4 h-4 text-emerald-400" /> LIVE INPUT</span>
            {!lastReport ? (
              <p className="text-slate-500">Move / press the device to see reports…</p>
            ) : (
              <>
                <div className="text-[11px] text-slate-500">Report {lastReport.reportId} — <span className="text-cyan-300">{lastReport.hex}</span></div>
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
