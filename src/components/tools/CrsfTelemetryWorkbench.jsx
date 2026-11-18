import React, { useEffect, useRef, useState } from 'react';
import { Radio, Activity, Battery, Compass, Satellite, Search, Download, Trash2, Usb, Terminal, Play, Square, Pencil, ListTree, Plane, Signal, ShieldAlert } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  CRSF_BAUD_RATES, CRSF_DEFAULT_BAUD, CRSF_SYNC, FRAME_TYPE, FRAME_TYPE_NAMES, ADDRESS_NAMES, PARAM_TYPE, PARAM_TYPE_NAMES,
  createCrsfParser, createParamClient, buildDevicePing, decodeTelemetry, encodeParamValue, toHex,
} from '../../utils/crsfProtocol';

const SYNC_OPTIONS = [
  [CRSF_SYNC.TX_MODULE, 'TX module (0xEE)'],
  [CRSF_SYNC.FLIGHT_CONTROLLER, 'Flight controller (0xC8)'],
  [CRSF_SYNC.RECEIVER, 'Receiver (0xEC)'],
];
const TABS = [['live', 'LIVE TELEMETRY', Activity], ['params', 'DEVICE PARAMETERS', ListTree], ['log', 'RAW FRAMES', Terminal]];
const LOG_LIMIT = 300;
const HIST_LIMIT = 120;
const FLUSH_MS = 150;

const hex2 = (n) => `0x${n.toString(16).padStart(2, '0').toUpperCase()}`;
const fmt = (v, digits = 1, unit = '') => (typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(digits)}${unit}` : '—');
const stamp = () => new Date().toLocaleTimeString();

function emptyStore() {
  return {
    link: null, linkHist: [], rc: null, battery: null, gps: null, attitude: null, flightMode: null,
    devices: new Map(), counts: {}, log: [], dirty: false,
  };
}

function snapshotOf(store, parser) {
  return {
    link: store.link,
    linkHist: store.linkHist.slice(),
    rc: store.rc,
    battery: store.battery,
    gps: store.gps,
    attitude: store.attitude,
    flightMode: store.flightMode,
    devices: new Map(store.devices),
    counts: { ...store.counts },
    log: store.log.slice(),
    parser: parser ? parser.stats : { frames: 0, badCrc: 0, skipped: 0 },
  };
}

const EMPTY_SNAP = snapshotOf(emptyStore(), null);

/** Link quality (0..100) and uplink RSSI (-120..0 dBm) over the last few seconds of link frames. */
function LinkTrend({ hist }) {
  if (hist.length < 2) {
    return (
      <div className="h-28 flex items-center justify-center text-[11px] text-slate-600 border border-slate-800 rounded bg-black">
        The LQ / RSSI chart fills in as link statistics frames arrive.
      </div>
    );
  }
  const W = 600;
  const H = 120;
  const pts = (pick) => hist.map((h, i) => {
    const v = Math.max(0, Math.min(1, pick(h)));
    return `${((i / (hist.length - 1)) * W).toFixed(1)},${(H - v * H).toFixed(1)}`;
  }).join(' ');
  const lq = pts((h) => (h.lq ?? 0) / 100);
  const rssi = pts((h) => ((h.rssi ?? -120) + 120) / 120);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full bg-black border border-slate-800 rounded" style={{ height: H }}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#1e293b" />)}
        <polyline points={rssi} fill="none" stroke="#22d3ee" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <polyline points={lq} fill="none" stroke="#34d399" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute top-1 left-2 text-[10px] text-slate-500">100% LQ / 0 dBm</div>
      <div className="absolute bottom-1 left-2 text-[10px] text-slate-500">0% LQ / -120 dBm</div>
      <div className="absolute top-1 right-2 text-[10px]"><span className="text-emerald-400">LQ</span> <span className="text-cyan-400">uplink RSSI ant.1</span></div>
    </div>
  );
}

function ChannelBars({ us }) {
  if (!us) {
    return <div className="text-[11px] text-slate-600">No RC channel frames yet.</div>;
  }
  return (
    <div className="flex items-end gap-1 h-32">
      {us.map((v, i) => {
        const pct = Math.max(0, Math.min(100, ((v - 988) / (2012 - 988)) * 100));
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <div className="w-full flex-1 bg-slate-900 rounded-sm flex items-end overflow-hidden">
              <div className="w-full bg-cyan-500/70" style={{ height: `${pct}%` }} />
            </div>
            <div className="text-[9px] text-slate-500 font-mono">{i + 1}</div>
            <div className="text-[9px] text-slate-400 font-mono">{v}</div>
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded p-2 min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-sm font-mono text-slate-100 truncate">{value}</div>
      {sub && <div className="text-[10px] text-slate-500 font-mono truncate">{sub}</div>}
    </div>
  );
}

export default function CrsfTelemetryWorkbench({ onLogMessage }) {
  const serial = useOptionalSerial();
  const isConnected = !!serial?.isConnected;
  const [tab, setTab] = useState('live');
  const [snap, setSnap] = useState(EMPTY_SNAP);
  const [syncByte, setSyncByte] = useState(CRSF_SYNC.TX_MODULE);
  const [selectedAddr, setSelectedAddr] = useState(null);
  const [params, setParams] = useState(new Map());
  const [paramErrors, setParamErrors] = useState(new Map());
  const [showHidden, setShowHidden] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [reading, setReading] = useState(false);
  const [readProgress, setReadProgress] = useState(0);
  const [writeMsg, setWriteMsg] = useState('');
  const [hideRc, setHideRc] = useState(true);
  const [pingCount, setPingCount] = useState(0);
  // Baud shown and used when connecting. Starts at the ELRS default; while connected the port's rate is shown.
  const [baudPref, setBaudPref] = useState(CRSF_DEFAULT_BAUD);

  const storeRef = useRef(emptyStore());
  const parserRef = useRef(null);
  const clientRef = useRef(null);
  const serialRef = useRef(serial);
  const syncRef = useRef(syncByte);
  const cancelReadRef = useRef(false);
  serialRef.current = serial;
  syncRef.current = syncByte;

  const notify = (text, level = 'sys') => { if (typeof onLogMessage === 'function') onLogMessage(text, level); };

  // Frame sink: shared between the RX subscription and the param client.
  const logFrame = (dir, bytes, type) => {
    const s = storeRef.current;
    s.log.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, t: stamp(), dir, type, hex: toHex(bytes) });
    if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
    s.dirty = true;
  };

  const sendFrame = (bytes, type) => {
    const s = serialRef.current;
    if (!s?.isConnected) throw new Error('Port is not connected.');
    logFrame('tx', bytes, type);
    const r = s.sendRawBytes(bytes);
    if (r && typeof r.catch === 'function') r.catch((err) => notify(`CRSF send failed: ${err.message}`, 'err'));
  };

  const handleFrame = (frame) => {
    const s = storeRef.current;
    s.counts[frame.type] = (s.counts[frame.type] || 0) + 1;
    logFrame('rx', frame.raw, frame.type);
    const t = decodeTelemetry(frame);
    if (t && t.data) {
      switch (t.kind) {
        case 'rc': s.rc = t.data; break;
        case 'link':
          s.link = t.data;
          s.linkHist.push({ lq: t.data.upLq, rssi: t.data.upRssi1 });
          if (s.linkHist.length > HIST_LIMIT) s.linkHist.splice(0, s.linkHist.length - HIST_LIMIT);
          break;
        case 'battery': s.battery = t.data; break;
        case 'gps': s.gps = t.data; break;
        case 'attitude': s.attitude = t.data; break;
        case 'flightMode': s.flightMode = t.data; break;
        case 'device': s.devices.set(t.data.address, { ...t.data, seen: stamp() }); break;
        default: break;
      }
    }
    clientRef.current?.feed(frame);
    s.dirty = true;
  };

  // Periodic UI flush so a 400 Hz RC stream does not re-render React 400 times a second.
  useEffect(() => {
    const id = setInterval(() => {
      const s = storeRef.current;
      if (!s.dirty) return;
      s.dirty = false;
      setSnap(snapshotOf(s, parserRef.current));
    }, FLUSH_MS);
    return () => clearInterval(id);
  }, []);

  // Subscribe to the shared port while connected. A fresh parser and store per connection.
  useEffect(() => {
    if (!isConnected || !serial?.subscribeRx) return undefined;
    storeRef.current = emptyStore();
    const parser = createCrsfParser();
    parserRef.current = parser;
    setSnap(snapshotOf(storeRef.current, parser));
    const unsub = serial.subscribeRx((bytes) => {
      for (const frame of parser.push(bytes)) handleFrame(frame);
    });
    return () => {
      unsub();
      parser.reset();
      parserRef.current = null;
      clientRef.current?.reset('Port disconnected.');
      clientRef.current = null;
      cancelReadRef.current = true;
      setReading(false);
      setParams(new Map());
      setParamErrors(new Map());
      setSelectedAddr(null);
    };
    // handleFrame only touches refs, so it is safe to capture from this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, serial?.subscribeRx]);

  const devices = Array.from(snap.devices.values());
  const selected = selectedAddr !== null ? snap.devices.get(selectedAddr) : null;

  const selectDevice = (addr) => {
    cancelReadRef.current = true;
    clientRef.current?.reset('Device changed.');
    setParams(new Map());
    setParamErrors(new Map());
    setDrafts({});
    setWriteMsg('');
    setSelectedAddr(addr);
    clientRef.current = createParamClient({
      send: (bytes) => sendFrame(bytes, FRAME_TYPE.PARAMETER_READ),
      dest: addr,
      sync: syncRef.current,
    });
  };

  const ping = () => {
    try {
      sendFrame(buildDevicePing(syncByte), FRAME_TYPE.DEVICE_PING);
      setPingCount((n) => n + 1);
    } catch (err) { notify(err.message, 'err'); }
  };

  const onBaudChange = async (e) => {
    const next = Number(e.target.value);
    setBaudPref(next);
    if (!serial) return;
    if (serial.isConnected) {
      try { await serial.reconfigureActivePort({ baudRate: next }); } catch (err) { notify(`Baud change failed: ${err.message}`, 'err'); }
    } else {
      serial.setBaudRate(next);
    }
  };

  const connect = async () => {
    if (!serial) return;
    if (!serial.hasWebSerialSupport) {
      notify('Web Serial is not available in this browser. Use Chrome, Edge or Opera on desktop.', 'err');
      return;
    }
    if (serial.baudRate !== baudPref) serial.setBaudRate(baudPref);
    try { await serial.connect(); } catch (err) { notify(`Connect failed: ${err.message}`, 'err'); }
  };

  // Sequential read of every parameter the device advertised in its device info.
  const readAll = async () => {
    const client = clientRef.current;
    const info = selected;
    if (!client || !info) return;
    const count = info.paramCount;
    if (!count) { setWriteMsg('This device reports 0 parameters.'); return; }
    cancelReadRef.current = false;
    setReading(true);
    setParamErrors(new Map());
    const collected = new Map();
    const errors = new Map();
    for (let n = 1; n <= count && !cancelReadRef.current; n++) {
      setReadProgress(n);
      try {
        const p = await client.readParam(n);
        collected.set(n, p);
      } catch (err) {
        errors.set(n, err.message);
      }
      if (n % 5 === 0 || n === count) {
        setParams(new Map(collected));
        setParamErrors(new Map(errors));
      }
    }
    setParams(new Map(collected));
    setParamErrors(new Map(errors));
    setReading(false);
    if (cancelReadRef.current) setWriteMsg('Read stopped.');
  };

  const stopRead = () => { cancelReadRef.current = true; };

  const writeParam = async (p) => {
    const client = clientRef.current;
    if (!client) return;
    const raw = p.type === PARAM_TYPE.COMMAND ? null : drafts[p.paramNum] ?? String(p.value);
    const value = p.type === PARAM_TYPE.COMMAND ? 1 : Number(raw);
    try {
      encodeParamValue(p, value);
    } catch (err) {
      setWriteMsg(`Parameter ${p.paramNum} (${p.name}): ${err.message}`);
      return;
    }
    const shown = p.type === PARAM_TYPE.COMMAND ? 'run command' : `${p.type === PARAM_TYPE.TEXT_SELECTION ? p.options[value] : value}${p.unit ? ` ${p.unit}` : ''}`;
    const ok = typeof window !== 'undefined' && window.confirm(
      `Write ${shown} to parameter ${p.paramNum} "${p.name}" on device ${hex2(selected.address)}?\n\nThis changes the device's configuration and can affect the link.`
    );
    if (!ok) return;
    try {
      const rb = await client.writeParam(p, value);
      setParams((prev) => new Map(prev).set(p.paramNum, rb));
      setWriteMsg(`Parameter ${p.paramNum} written. Device reports: ${rb.type === PARAM_TYPE.TEXT_SELECTION ? rb.options[rb.value] : rb.value}${rb.unit ? ` ${rb.unit}` : ''}`);
      notify(`CRSF parameter ${p.paramNum} "${p.name}" written and read back.`, 'sys');
    } catch (err) {
      setWriteMsg(`Write failed for parameter ${p.paramNum}: ${err.message}`);
    }
  };

  const downloadLog = () => {
    const text = snap.log.map((e) => `${e.t}\t${e.dir.toUpperCase()}\t${FRAME_TYPE_NAMES[e.type] || hex2(e.type)}\t${e.hex}`).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `crsf-frames-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const apiMissing = typeof navigator !== 'undefined' && !('serial' in navigator);
  const link = snap.link;
  const rc = snap.rc;
  const gps = snap.gps;
  const bat = snap.battery;
  const att = snap.attitude;
  const counts = snap.counts;
  const paramList = Array.from(params.values())
    .filter((p) => showHidden || !p.hidden)
    .sort((a, b) => a.paramNum - b.paramNum);
  const folderNames = new Map(Array.from(params.values()).filter((p) => p.type === PARAM_TYPE.FOLDER).map((p) => [p.paramNum, p.name]));
  const selectedBaud = isConnected ? serial.baudRate : baudPref;

  return (
    <div className="flex flex-col gap-3 p-3 text-slate-200 bg-slate-950 min-h-full font-sans">
      <div className="flex flex-wrap items-center gap-2 bg-slate-900/70 border border-slate-800 rounded p-2">
        <Radio className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-semibold tracking-wide">ELRS / CRSF</span>
        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${isConnected ? 'border-emerald-700 text-emerald-300' : 'border-slate-700 text-slate-500'}`}>
          {isConnected ? `CONNECTED @ ${selectedBaud} bps` : 'NOT CONNECTED'}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-slate-400 flex items-center gap-1">
            Baud
            <select value={selectedBaud} onChange={onBaudChange} disabled={!serial} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-xs font-mono">
              {CRSF_BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-[11px] text-slate-400 flex items-center gap-1">
            Host sync
            <select value={syncByte} onChange={(e) => setSyncByte(Number(e.target.value))} className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5 text-xs">
              {SYNC_OPTIONS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </label>
          {!isConnected ? (
            <button type="button" onClick={connect} disabled={!serial} className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-xs font-semibold">
              <Usb className="w-3.5 h-3.5" /> CONNECT PORT
            </button>
          ) : (
            <button type="button" onClick={() => serial.disconnect()} className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs">
              DISCONNECT
            </button>
          )}
        </div>
      </div>

      {!serial && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2 flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          The shared serial port is not available in this view, so nothing can be connected here.
        </div>
      )}
      {serial && apiMissing && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2 flex gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          Web Serial is not available in this browser. Use Chrome, Edge or Opera on desktop.
        </div>
      )}

      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} type="button" onClick={() => setTab(id)}
            className={`flex items-center gap-1 px-3 py-1.5 text-[11px] font-semibold border-b-2 -mb-px ${tab === id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {tab === 'live' && (
        <div className="flex flex-col gap-3">
          {!isConnected && (
            <div className="text-xs text-slate-500 border border-dashed border-slate-800 rounded p-4 text-center">
              Connect a port carrying CRSF (an ELRS TX module, a receiver or a flight controller on the CRSF line) to see live data.
              Values appear only when frames arrive; nothing here is simulated.
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Uplink LQ" value={fmt(link?.upLq, 0, '%')} sub={`SNR ${fmt(link?.upSnr, 0, ' dB')}`} />
            <Stat label="Uplink RSSI" value={link ? `${link.upRssi1} / ${link.upRssi2} dBm` : '—'} sub={`ant ${link?.antenna ?? '—'}`} />
            <Stat label="Downlink LQ" value={fmt(link?.downLq, 0, '%')} sub={`RSSI ${link ? `${link.downRssi} dBm` : '—'}`} />
            <Stat label="TX power" value={link?.upPowerMw != null ? `${link.upPowerMw} mW` : '—'} sub={link ? `RF mode index ${link.rfMode}` : ''} />
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded p-3">
            <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-2"><Signal className="w-3.5 h-3.5" /> LINK TREND</div>
            <LinkTrend hist={snap.linkHist} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div className="bg-slate-900/50 border border-slate-800 rounded p-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span className="flex items-center gap-2"><Activity className="w-3.5 h-3.5" /> RC CHANNELS (µs)</span>
                <span className="font-mono text-slate-500">{rc ? 'frames received' : ''}</span>
              </div>
              <ChannelBars us={rc?.us} />
            </div>
            <div className="flex flex-col gap-3">
              <div className="bg-slate-900/50 border border-slate-800 rounded p-3 grid grid-cols-2 gap-2">
                <Stat label="Battery" value={bat ? fmt(bat.voltageV, 1, ' V') : '—'} sub={bat ? `${fmt(bat.currentA, 1, ' A')} · ${bat.capacityMah} mAh used · ${bat.remainingPct}%` : ''} />
                <Stat label="Flight mode" value={snap.flightMode ?? '—'} />
                <Stat label="Attitude (deg)" value={att ? `P ${att.pitchDeg.toFixed(1)} R ${att.rollDeg.toFixed(1)}` : '—'} sub={att ? `Y ${att.yawDeg.toFixed(1)}` : ''} />
                <Stat label="GPS" value={gps ? `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}` : '—'} sub={gps ? `${gps.satellites} sats · ${gps.altitudeM} m · ${gps.groundspeedKmh.toFixed(1)} km/h` : ''} />
              </div>
              <div className="bg-slate-900/50 border border-slate-800 rounded p-3">
                <div className="flex items-center gap-2 text-[11px] text-slate-400 mb-2"><Compass className="w-3.5 h-3.5" /> FRAMES SEEN</div>
                <div className="text-[11px] font-mono text-slate-400 grid grid-cols-2 gap-x-3 gap-y-0.5 max-h-28 overflow-auto">
                  {Object.keys(counts).length === 0 && <span className="text-slate-600 col-span-2">None yet.</span>}
                  {Object.entries(counts).map(([t, n]) => (
                    <span key={t} className="flex justify-between gap-2"><span>{FRAME_TYPE_NAMES[t] || hex2(Number(t))}</span><span>{n}</span></span>
                  ))}
                </div>
                <div className="text-[10px] font-mono text-slate-600 mt-2">
                  valid {snap.parser.frames} · bad CRC {snap.parser.badCrc} · skipped bytes {snap.parser.skipped}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'params' && (
        <div className="flex flex-col gap-3">
          <div className="bg-slate-900/50 border border-slate-800 rounded p-3 flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={ping} disabled={!isConnected || reading} className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-xs font-semibold">
                <Search className="w-3.5 h-3.5" /> PING DEVICES
              </button>
              <span className="text-[11px] text-slate-500 font-mono">{pingCount ? `${pingCount} ping(s) sent · ${devices.length} answered` : 'Send a device ping to list devices on the link.'}</span>
            </div>
            {devices.length === 0 ? (
              <div className="text-[11px] text-slate-600">No device info received yet. Devices answer a ping with a device info frame (0x29).</div>
            ) : (
              <div className="grid md:grid-cols-2 gap-2">
                {devices.map((d) => {
                  const active = d.address === selectedAddr;
                  return (
                    <div key={d.address} className={`border rounded p-2 text-xs ${active ? 'border-cyan-600 bg-cyan-950/30' : 'border-slate-800 bg-slate-950'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-slate-200 truncate">{d.name || 'Unnamed device'}</span>
                        <button type="button" onClick={() => selectDevice(d.address)} disabled={reading}
                          className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px]">
                          {active ? 'SELECTED' : 'USE'}
                        </button>
                      </div>
                      <div className="font-mono text-[11px] text-slate-500 mt-1">
                        address {hex2(d.address)} ({ADDRESS_NAMES[d.address] || 'unknown'}) · {d.paramCount} params · param v{d.paramVersion}
                      </div>
                      <div className="font-mono text-[10px] text-slate-600">
                        serial {d.serial} · hw {d.hardwareId.toString(16)} · fw {d.firmwareId.toString(16)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800">
              <button type="button" onClick={readAll} disabled={!selected || reading || !isConnected}
                className="flex items-center gap-1 px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-xs font-semibold">
                <Play className="w-3.5 h-3.5" /> READ ALL PARAMETERS
              </button>
              <button type="button" onClick={stopRead} disabled={!reading}
                className="flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs">
                <Square className="w-3.5 h-3.5" /> STOP
              </button>
              {reading && <span className="text-[11px] font-mono text-amber-300">reading {readProgress} / {selected?.paramCount}</span>}
              <label className="text-[11px] text-slate-400 flex items-center gap-1 ml-auto">
                <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> show hidden
              </label>
            </div>
            <div className="text-[10px] text-slate-600">
              Parameters are read one at a time with a timeout and retries. Writes ask for confirmation, then read the value back from the device.
            </div>
          </div>

          {writeMsg && <div className="text-xs font-mono text-slate-300 bg-slate-900 border border-slate-800 rounded p-2">{writeMsg}</div>}

          {paramList.length === 0 ? (
            <div className="text-xs text-slate-600 border border-dashed border-slate-800 rounded p-4 text-center">
              {selected ? 'Read the parameters to list them here.' : 'Ping devices and select one to browse its parameters.'}
            </div>
          ) : (
            <div className="overflow-auto border border-slate-800 rounded">
              <table className="w-full text-xs font-mono">
                <thead className="bg-slate-900 text-slate-500 text-left">
                  <tr>
                    <th className="p-2">#</th><th className="p-2">Name</th><th className="p-2">Type</th><th className="p-2">Folder</th>
                    <th className="p-2">Value</th><th className="p-2">Range / unit</th><th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {paramList.map((p) => {
                    const isFolder = p.type === PARAM_TYPE.FOLDER;
                    const draftVal = drafts[p.paramNum] ?? String(p.value ?? '');
                    return (
                      <tr key={p.paramNum} className="border-t border-slate-800 align-top">
                        <td className="p-2 text-slate-500">{p.paramNum}</td>
                        <td className={`p-2 ${isFolder ? 'text-amber-300' : 'text-slate-200'}`}>
                          {p.name}{p.hidden && <span className="ml-1 text-[9px] text-slate-500">[hidden]</span>}
                        </td>
                        <td className="p-2 text-slate-500">{p.typeName || PARAM_TYPE_NAMES[p.type]}</td>
                        <td className="p-2 text-slate-500">{p.parent ? (folderNames.get(p.parent) ?? `#${p.parent}`) : 'root'}</td>
                        <td className="p-2">
                          {isFolder && <span className="text-slate-500">{p.children.length} item(s)</span>}
                          {p.type === PARAM_TYPE.INFO && <span className="text-slate-300">{p.value}</span>}
                          {p.type === PARAM_TYPE.STRING && <span className="text-slate-300">{p.value}</span>}
                          {p.type === PARAM_TYPE.COMMAND && <span className="text-slate-300">{p.info} (status {p.status})</span>}
                          {p.type === PARAM_TYPE.TEXT_SELECTION && (
                            <select value={drafts[p.paramNum] ?? String(p.value)} onChange={(e) => setDrafts((d) => ({ ...d, [p.paramNum]: e.target.value }))}
                              className="bg-slate-950 border border-slate-700 rounded px-1 py-0.5">
                              {p.options.map((o, i) => <option key={i} value={i}>{o}</option>)}
                            </select>
                          )}
                          {p.writable && p.type <= PARAM_TYPE.FLOAT && (
                            <input type="number" value={draftVal} step={p.type === PARAM_TYPE.FLOAT ? p.step || 0.1 : 1}
                              onChange={(e) => setDrafts((d) => ({ ...d, [p.paramNum]: e.target.value }))}
                              className="w-24 bg-slate-950 border border-slate-700 rounded px-1 py-0.5" />
                          )}
                          {p.raw && <span className="text-slate-500">{p.raw.map((b) => b.toString(16).padStart(2, '0')).join(' ')}</span>}
                        </td>
                        <td className="p-2 text-slate-500">
                          {p.min !== undefined && p.max !== undefined ? `${p.min} … ${p.max}` : ''}{p.unit ? ` ${p.unit}` : ''}
                          {p.options && <div className="text-[10px]">{p.options.join(' / ')}</div>}
                          {p.note && <div className="text-[10px]">{p.note}</div>}
                        </td>
                        <td className="p-2">
                          {p.writable && p.type === PARAM_TYPE.COMMAND && (
                            <button type="button" onClick={() => writeParam(p)} disabled={reading}
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-[11px]">
                              <Play className="w-3 h-3" /> RUN
                            </button>
                          )}
                          {p.writable && p.type !== PARAM_TYPE.COMMAND && (
                            <button type="button" onClick={() => writeParam(p)} disabled={reading}
                              className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-[11px]">
                              <Pencil className="w-3 h-3" /> WRITE
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {paramErrors.size > 0 && (
            <div className="text-[11px] font-mono text-rose-300 bg-rose-950/30 border border-rose-900 rounded p-2 max-h-28 overflow-auto">
              {Array.from(paramErrors.entries()).map(([n, msg]) => <div key={n}>parameter {n}: {msg}</div>)}
            </div>
          )}
        </div>
      )}

      {tab === 'log' && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <label className="flex items-center gap-1 text-slate-400">
              <input type="checkbox" checked={hideRc} onChange={(e) => setHideRc(e.target.checked)} /> hide RC channel frames
            </label>
            <span className="font-mono text-slate-600">{snap.log.length} entries kept (last {LOG_LIMIT})</span>
            <button type="button" onClick={() => { storeRef.current.log = []; storeRef.current.dirty = true; }}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700">
              <Trash2 className="w-3 h-3" /> CLEAR
            </button>
            <button type="button" onClick={downloadLog} disabled={snap.log.length === 0}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40">
              <Download className="w-3 h-3" /> DOWNLOAD .TXT
            </button>
          </div>
          <div className="font-mono text-[11px] bg-black border border-slate-800 rounded h-96 overflow-auto p-2">
            {snap.log.length === 0 && <div className="text-slate-600">No frames yet.</div>}
            {snap.log.filter((e) => !(hideRc && e.type === FRAME_TYPE.RC_CHANNELS_PACKED)).slice().reverse().map((e) => (
              <div key={e.id} className="whitespace-nowrap">
                <span className="text-slate-600">{e.t}</span>{' '}
                <span className={e.dir === 'tx' ? 'text-amber-300' : 'text-cyan-300'}>{e.dir.toUpperCase()}</span>{' '}
                <span className="text-slate-400 inline-block w-28">{FRAME_TYPE_NAMES[e.type] || hex2(e.type)}</span>{' '}
                <span className="text-slate-300">{e.hex}</span>
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-600">
            Frames are shown as received after the CRC check; frames with a bad CRC are counted on the Live tab but not listed.
            TX rows are frames this tool sent.
          </div>
        </div>
      )}

      <div className="text-[10px] text-slate-600 flex items-center gap-1">
        <Plane className="w-3 h-3" /> Decoded: RC channels, link statistics, battery, GPS, attitude, flight mode, device info.
        <Battery className="w-3 h-3 ml-2" /> Parameter write support: integer, float, text select and command.
        <Satellite className="w-3 h-3 ml-2" /> Frames are not sent unless you press a button.
      </div>
    </div>
  );
}
