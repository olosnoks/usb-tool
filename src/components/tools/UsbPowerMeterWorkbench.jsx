import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gauge, Zap, Battery, Thermometer, Bluetooth, Usb, Download, Trash2, Plug, Square, Pause, Play, AlertTriangle } from 'lucide-react';
import {
  createSessionStats,
  addSessionSample,
  samplesToCsv,
  ruiDengSample,
  FNIRSI_DEVICES,
} from '../../utils/usbPowerMeter';
import {
  webSerialAvailable,
  webHidAvailable,
  connectRuiDengPort,
  RuiDengPoller,
  requestFnirsiDevice,
  fnirsiModelFor,
  FnirsiStream,
} from '../../utils/usbPowerMeter/driver';
import {
  ALARM_KINDS,
  parseLimit,
  createAlarmState,
  updateAlarmState,
  createAverager,
  addAverage,
  averages,
  batteryRuntimeHours,
  formatDuration,
  loadResistance,
} from '../../utils/usbPowerMeter/analysis';

const CHART_POINTS = 600;
const MAX_ROWS = 200000;
const FAMILIES = {
  ruideng: {
    label: 'RuiDeng UM24C / UM25C / UM34C',
    sub: 'Bluetooth SPP, shown as a serial port. Web Serial, 9600 baud.',
    icon: Bluetooth,
  },
  fnirsi: {
    label: 'FNIRSI FNB48 / FNB58 / C1',
    sub: 'USB HID. WebHID, 64-byte reports.',
    icon: Usb,
  },
};

const fmt = (v, digits) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

function Tile({ label, value, unit, icon: Icon, accent = 'cyan' }) {
  const color = { cyan: 'text-cyan-300', emerald: 'text-emerald-300', amber: 'text-amber-300', rose: 'text-rose-300' }[accent];
  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
        {Icon ? <Icon size={12} /> : null}
        {label}
      </div>
      <div className={`font-mono text-xl ${color}`}>
        {value}
        {unit ? <span className="ml-1 text-xs text-slate-500">{unit}</span> : null}
      </div>
    </div>
  );
}

// Each series is scaled to its own min..max in the visible window. The legend says so.
const SERIES = [
  { key: 'volts', label: 'Voltage (V)', color: '#67e8f9', digits: 3 },
  { key: 'amps', label: 'Current (A)', color: '#6ee7b7', digits: 4 },
  { key: 'watts', label: 'Power (W)', color: '#fcd34d', digits: 3 },
];
const WINDOWS = [100, 300, 600];

function PowerChart({ points, visible, onToggle }) {
  const W = 800;
  const H = 160;
  const n = points.length;
  return (
    <div className="rounded border border-slate-800 bg-slate-950 p-2">
      {n < 2 ? (
        <div className="flex h-36 items-center justify-center text-xs text-slate-600">Chart fills in once two samples arrive.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" preserveAspectRatio="none" role="img" aria-label="Live V, A and W chart">
          {SERIES.filter((s) => visible[s.key]).map((s) => {
            let lo = Infinity;
            let hi = -Infinity;
            for (const p of points) {
              const v = p[s.key];
              if (typeof v === 'number' && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
            }
            const span = hi - lo || 1;
            const d = points.map((p, i) => {
              const v = p[s.key];
              const x = (i / (n - 1)) * W;
              const y = H - 6 - ((v - lo) / span) * (H - 12);
              return `${x.toFixed(1)},${y.toFixed(1)}`;
            }).join(' ');
            return <polyline key={s.key} points={d} fill="none" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />;
          })}
        </svg>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-slate-400">
        {SERIES.map((s) => {
          const vals = points.map((p) => p[s.key]).filter((v) => typeof v === 'number' && Number.isFinite(v));
          const lo = vals.length ? Math.min(...vals) : NaN;
          const hi = vals.length ? Math.max(...vals) : NaN;
          return (
            <label key={s.key} className="flex items-center gap-1" style={{ color: s.color }}>
              <input type="checkbox" checked={visible[s.key]} onChange={() => onToggle(s.key)} aria-label={`Show ${s.label}`} />
              {s.label}: {fmt(lo, s.digits)} to {fmt(hi, s.digits)}
            </label>
          );
        })}
        <span className="text-slate-600">each line scaled to its own range</span>
      </div>
    </div>
  );
}

const BTN = 'flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 hover:border-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-40';
const INPUT = 'w-full rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500';

export default function UsbPowerMeterWorkbench({ onLogMessage }) {
  const log = useCallback((text, level) => { if (onLogMessage) onLogMessage(text, level); }, [onLogMessage]);

  const [family, setFamily] = useState('ruideng');
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [latest, setLatest] = useState(null);
  const [points, setPoints] = useState([]);
  const [summary, setSummary] = useState(null);
  const [streamStats, setStreamStats] = useState({ packets: 0, rejected: 0 });
  const [rowCount, setRowCount] = useState(0);
  const [avgs, setAvgs] = useState(null);
  const [alarmView, setAlarmView] = useState(null);
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState([]);
  const [windowSize, setWindowSize] = useState(600);
  const [visible, setVisible] = useState({ volts: true, amps: true, watts: true });
  const [limitText, setLimitText] = useState({ maxAmps: '', maxWatts: '', minVolts: '', maxTempC: '' });
  const [batt, setBatt] = useState({ mah: '', volts: '3.7', eff: '85' });

  const sessionRef = useRef(createSessionStats());
  const avgRef = useRef(createAverager());
  const alarmRef = useRef(createAlarmState());
  const limitsRef = useRef({});
  const rowsRef = useRef([]);
  const startRef = useRef(null);
  const deviceRef = useRef(null); // { kind, stop(), ... }

  const limits = {};
  for (const k of ALARM_KINDS) limits[k.key] = parseLimit(limitText[k.key]);
  limitsRef.current = limits;

  const snapshot = () => {
    const s = sessionRef.current;
    return { count: s.count, gaps: s.gaps, mAh: s.mAh, mWh: s.mWh, min: { ...s.min }, max: { ...s.max } };
  };

  const ingest = useCallback((samples) => {
    if (!samples.length) return;
    const added = [];
    for (const sample of samples) {
      const totals = addSessionSample(sessionRef.current, sample);
      addAverage(avgRef.current, sample);
      updateAlarmState(alarmRef.current, sample, limitsRef.current);
      const row = { ...sample, ...totals };
      if (rowsRef.current.length < MAX_ROWS) rowsRef.current.push(row);
      added.push(row);
    }
    if (startRef.current === null) startRef.current = added[0].tMs;
    setLatest(added[added.length - 1]);
    setPoints((prev) => {
      const next = prev.concat(added);
      return next.length > CHART_POINTS ? next.slice(next.length - CHART_POINTS) : next;
    });
    setSummary(snapshot());
    setAvgs(averages(avgRef.current));
    const a = alarmRef.current;
    setAlarmView({ active: [...a.active], events: { ...a.events }, total: a.total });
    setRowCount(rowsRef.current.length);
  }, []);

  const teardown = useCallback(async () => {
    const d = deviceRef.current;
    deviceRef.current = null;
    if (!d) return;
    if (d.kind === 'ruideng') {
      await d.poller.stop();
      try { await d.link.close(); } catch (e) { /* port already gone */ }
    } else {
      await d.stream.stop();
    }
  }, []);

  useEffect(() => () => { teardown(); }, [teardown]);

  const connect = async () => {
    setError('');
    setNote('');
    setBusy(true);
    try {
      if (family === 'ruideng') {
        const link = await connectRuiDengPort();
        const poller = new RuiDengPoller(link, {
          onDump: (dump, tMs) => ingest([ruiDengSample(dump, tMs)]),
          onError: (e) => setError(e.message),
        });
        deviceRef.current = { kind: 'ruideng', link, poller };
        poller.start();
        setConnected(true);
        log('USB power meter: RuiDeng port opened at 9600 baud, polling 0xF0', 'info');
      } else {
        const device = await requestFnirsiDevice();
        if (!device) { setNote('No device chosen.'); return; }
        const model = fnirsiModelFor(device);
        if (!model) throw new Error('That HID device is not a FNIRSI model this tool knows.');
        const stream = new FnirsiStream(device, model, {
          onSamples: ingest,
          onStats: setStreamStats,
          onError: (e) => setError(e.message),
        });
        deviceRef.current = { kind: 'fnirsi', device, stream, model };
        await stream.start();
        setConnected(true);
        log(`USB power meter: ${model.name} opened over WebHID`, 'info');
      }
    } catch (e) {
      await teardown();
      setConnected(false);
      setError(e.message || String(e));
      log(`USB power meter: ${e.message || e}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    await teardown();
    setConnected(false);
    setBusy(false);
    log('USB power meter: disconnected', 'info');
  };

  const clearSession = () => {
    sessionRef.current = createSessionStats();
    avgRef.current = createAverager();
    alarmRef.current = createAlarmState();
    rowsRef.current = [];
    startRef.current = null;
    setPoints([]);
    setFrozen([]);
    setSummary(null);
    setAvgs(null);
    setAlarmView(null);
    setLatest(null);
    setRowCount(0);
    setStreamStats({ packets: 0, rejected: 0 });
  };

  const exportCsv = () => {
    const rows = rowsRef.current;
    if (!rows.length) return;
    const csv = samplesToCsv(rows, startRef.current ?? rows[0].tMs);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `usb-power-${family}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const togglePause = () => {
    if (!paused) setFrozen(points);
    setPaused(!paused);
  };

  const apiMissing = family === 'ruideng' ? !webSerialAvailable() : !webHidAvailable();
  const isRuiDeng = family === 'ruideng';
  const supportedFnirsi = FNIRSI_DEVICES.map((d) => d.name.replace('FNIRSI ', '')).join(', ');
  const minmax = summary ? summary.min : {};
  const maxes = summary ? summary.max : {};
  const modelName = latest?.source === 'ruideng' ? 'RuiDeng' : latest?.source === 'fnirsi' ? 'FNIRSI' : null;
  const shown = (paused ? frozen : points).slice(-windowSize);
  const resistance = latest ? loadResistance(latest.volts, latest.amps) : null;
  const elapsedS = latest && startRef.current !== null ? (latest.tMs - startRef.current) / 1000 : null;
  const activeAlarms = alarmView ? alarmView.active : [];
  const mahNum = Number(batt.mah);
  const runtimeH = batteryRuntimeHours({
    capacityMah: mahNum,
    nominalVolts: Number(batt.volts),
    loadWatts: avgs?.watts ?? undefined,
    efficiency: Number(batt.eff) / 100,
  });

  return (
    <div className="space-y-2 bg-slate-950 font-mono text-xs text-slate-200">
      <div className="grid gap-2 @md:grid-cols-2">
        {Object.entries(FAMILIES).map(([key, f]) => {
          const Icon = f.icon;
          const active = family === key;
          return (
            <button
              key={key}
              type="button"
              disabled={connected || busy}
              onClick={() => { setFamily(key); setError(''); setNote(''); }}
              aria-pressed={active}
              className={`rounded border p-2 text-left text-xs focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-60 ${active ? 'border-cyan-500 bg-cyan-950/40 text-cyan-200' : 'border-slate-800 bg-slate-900 text-slate-400 hover:border-slate-600'}`}
            >
              <div className="flex items-center gap-2 font-semibold"><Icon size={14} /> {f.label}</div>
              <div className="mt-0.5 text-[11px] text-slate-500">{f.sub}</div>
            </button>
          );
        })}
      </div>

      {apiMissing ? (
        <div className="rounded border border-amber-700 bg-amber-950/40 p-2 text-xs text-amber-200">
          {isRuiDeng
            ? 'Web Serial is not available here. Use Chrome or Edge over HTTPS (or localhost).'
            : 'WebHID is not available here. Use Chrome or Edge over HTTPS (or localhost).'}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!connected ? (
          <button
            type="button"
            onClick={connect}
            disabled={busy || apiMissing}
            className="flex items-center gap-1.5 rounded border border-cyan-600 bg-cyan-900/40 px-2 py-1 text-xs text-cyan-200 hover:bg-cyan-900/70 focus:outline-none focus:ring-1 focus:ring-cyan-500 disabled:opacity-50"
          >
            <Plug size={13} /> {isRuiDeng ? 'Choose serial port and connect' : 'Choose FNIRSI device and connect'}
          </button>
        ) : (
          <button
            type="button"
            onClick={disconnect}
            disabled={busy}
            className="flex items-center gap-1.5 rounded border border-rose-700 bg-rose-950/40 px-2 py-1 text-xs text-rose-200 hover:bg-rose-950/70 focus:outline-none focus:ring-1 focus:ring-rose-500 disabled:opacity-50"
          >
            <Square size={13} /> Disconnect
          </button>
        )}
        <span className="text-xs text-slate-400">
          {connected ? (latest ? `Receiving ${modelName} samples` : 'Connected, waiting for the first reading') : 'Not connected'}
        </span>
        {note ? <span className="text-xs text-slate-500">{note}</span> : null}
      </div>

      {error ? <div className="rounded border border-rose-800 bg-rose-950/40 p-2 text-xs text-rose-200">{error}</div> : null}

      {activeAlarms.length ? (
        <div role="alert" className="flex items-center gap-1.5 rounded border border-rose-700 bg-rose-950/50 p-2 text-xs text-rose-200">
          <AlertTriangle size={13} />
          Limit exceeded: {ALARM_KINDS.filter((k) => activeAlarms.includes(k.key)).map((k) => `${k.label} ${fmt(limits[k.key], 3)} ${k.unit}`).join(', ')}
        </div>
      ) : null}

      {!isRuiDeng && connected && !latest ? (
        <div className="text-xs text-slate-500">
          No packets yet. Check that the meter is on and that Chrome has access to it. Packets with a bad CRC are dropped and counted below.
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 @lg:grid-cols-4">
        <Tile label="Voltage" value={fmt(latest?.volts, 3)} unit="V" icon={Zap} accent="cyan" />
        <Tile label="Current" value={fmt(latest?.amps, 4)} unit="A" icon={Gauge} accent="emerald" />
        <Tile label="Power" value={fmt(latest?.watts, 3)} unit="W" icon={Battery} accent="amber" />
        <Tile label="Temperature" value={fmt(latest?.tempC, 1)} unit="°C" icon={Thermometer} accent="rose" />
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px] @lg:grid-cols-4">
        {isRuiDeng && latest?.source === 'ruideng' ? (
          <>
            <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Model <span className="text-slate-200">{latest.model}</span></div>
            <div className="rounded border border-slate-800 bg-slate-900 p-1.5">D+ <span className="text-slate-200">{fmt(latest.dPlus, 2)} V</span> · D- <span className="text-slate-200">{fmt(latest.dMinus, 2)} V</span></div>
            <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Charging <span className="text-slate-200">{latest.chargingModeName}</span></div>
            <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Resistance <span className="text-slate-200">{fmt(latest.resistanceOhms, 1)} Ω</span></div>
          </>
        ) : null}
        <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Elapsed <span className="text-slate-200">{formatDuration(elapsedS)}</span></div>
        <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Load V/I <span className="text-slate-200">{resistance === null ? '—' : `${fmt(resistance, 2)} Ω`}</span></div>
        <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Avg <span className="text-slate-200">{fmt(avgs?.watts, 3)} W</span> · {fmt(avgs?.amps, 4)} A</div>
        <div className="rounded border border-slate-800 bg-slate-900 p-1.5">Peak <span className="text-slate-200">{avgs ? fmt(avgs.peakW, 3) : '—'} W</span> · {avgs ? fmt(avgs.peakA, 4) : '—'} A</div>
      </div>

      <div className="grid gap-2 @md:grid-cols-2">
        <div className="rounded border border-slate-800 bg-slate-900 p-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Device-reported (meter&apos;s data group)</div>
          {isRuiDeng && latest?.deviceMah !== null && latest?.deviceMah !== undefined ? (
            <div className="mt-1 grid grid-cols-2 gap-2 font-mono">
              <div><span className="text-xl text-emerald-300">{fmt(latest.deviceMah, 3)}</span> <span className="text-xs text-slate-500">mAh</span></div>
              <div><span className="text-xl text-amber-300">{fmt(latest.deviceMwh, 3)}</span> <span className="text-xs text-slate-500">mWh</span></div>
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-500">
              {isRuiDeng ? 'Waiting for the first dump.' : 'Not reported by this family in the verified packet format.'}
            </div>
          )}
        </div>
        <div className="rounded border border-slate-800 bg-slate-900 p-2">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Computed this session (integrated)</div>
          <div className="mt-1 grid grid-cols-2 gap-2 font-mono">
            <div><span className="text-xl text-emerald-300">{summary ? fmt(summary.mAh, 3) : '—'}</span> <span className="text-xs text-slate-500">mAh</span></div>
            <div><span className="text-xl text-amber-300">{summary ? fmt(summary.mWh, 3) : '—'}</span> <span className="text-xs text-slate-500">mWh</span></div>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-600">Trapezoid over sample time. Gaps longer than 5 s are not integrated.</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={togglePause} className={BTN} title={paused ? 'Resume the chart (logging never stops)' : 'Freeze the chart (logging continues)'}>
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? 'Resume chart' : 'Pause chart'}
        </button>
        <label className="flex items-center gap-1 text-[11px] text-slate-400">
          Window
          <select value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} className={`${INPUT} w-auto`} aria-label="Chart window in samples">
            {WINDOWS.map((w) => <option key={w} value={w}>{w} samples</option>)}
          </select>
        </label>
      </div>
      <PowerChart points={shown} visible={visible} onToggle={(k) => setVisible((v) => ({ ...v, [k]: !v[k] }))} />

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={exportCsv} disabled={!rowCount} className={BTN}>
          <Download size={13} /> Export CSV ({rowCount} rows)
        </button>
        <button type="button" onClick={clearSession} disabled={!rowCount && !summary} className={BTN}>
          <Trash2 size={13} /> Clear session
        </button>
      </div>

      <details className="rounded border border-slate-800 bg-slate-900 p-2" open={Boolean(alarmView && alarmView.total)}>
        <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-slate-400">
          Limit alarms{alarmView && alarmView.total ? ` (${alarmView.total} events)` : ''}
        </summary>
        <p className="mt-1 text-[11px] text-slate-500">
          Leave a field blank to turn that limit off. This only warns on screen and counts events; it does not cut power.
        </p>
        <div className="mt-1 grid grid-cols-2 gap-2 @lg:grid-cols-4">
          {ALARM_KINDS.map((k) => (
            <label key={k.key} className="text-[11px] text-slate-400">
              {k.label} ({k.unit})
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                value={limitText[k.key]}
                onChange={(e) => setLimitText((t) => ({ ...t, [k.key]: e.target.value }))}
                className={`${INPUT} mt-0.5`}
              />
              <span className="text-slate-600">events: {alarmView?.events[k.key] || 0}</span>
            </label>
          ))}
        </div>
      </details>

      <details className="rounded border border-slate-800 bg-slate-900 p-2">
        <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-slate-400">Battery runtime estimate</summary>
        <p className="mt-1 text-[11px] text-slate-500">
          Capacity divided by the session average power. A rough guide: real cells lose capacity at high load and low temperature.
        </p>
        <div className="mt-1 grid grid-cols-3 gap-2">
          <label className="text-[11px] text-slate-400">Capacity (mAh)
            <input type="number" min="0" step="any" value={batt.mah} onChange={(e) => setBatt((b) => ({ ...b, mah: e.target.value }))} className={`${INPUT} mt-0.5`} />
          </label>
          <label className="text-[11px] text-slate-400">Cell volts (V)
            <input type="number" min="0" step="any" value={batt.volts} onChange={(e) => setBatt((b) => ({ ...b, volts: e.target.value }))} className={`${INPUT} mt-0.5`} />
          </label>
          <label className="text-[11px] text-slate-400">Efficiency (%)
            <input type="number" min="1" max="100" step="any" value={batt.eff} onChange={(e) => setBatt((b) => ({ ...b, eff: e.target.value }))} className={`${INPUT} mt-0.5`} />
          </label>
        </div>
        <div className="mt-1 text-xs text-slate-300">
          Estimated runtime: {runtimeH === null ? '—' : `${formatDuration(runtimeH * 3600)} (${fmt(runtimeH, 2)} h)`}
          <span className="ml-2 text-[11px] text-slate-600">at {fmt(avgs?.watts, 3)} W average</span>
        </div>
      </details>

      <details className="rounded border border-slate-800 bg-slate-900 p-2">
        <summary className="cursor-pointer text-[11px] uppercase tracking-wide text-slate-400">Session min / max</summary>
        <table className="mt-1 w-full text-xs">
          <thead className="text-slate-500">
            <tr><th className="text-left font-normal">Quantity</th><th className="text-right font-normal">Min</th><th className="text-right font-normal">Max</th></tr>
          </thead>
          <tbody>
            {[['Voltage (V)', 'volts', 3], ['Current (A)', 'amps', 4], ['Power (W)', 'watts', 3], ['Temperature (°C)', 'tempC', 1]].map(([label, key, d]) => (
              <tr key={key} className="border-t border-slate-800">
                <td className="py-0.5">{label}</td>
                <td className="py-0.5 text-right text-slate-200">{fmt(minmax[key], d)}</td>
                <td className="py-0.5 text-right text-slate-200">{fmt(maxes[key], d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-1 text-[11px] text-slate-500">
          Samples: {summary?.count ?? 0}
          {!isRuiDeng ? ` · packets: ${streamStats.packets} · CRC rejected: ${streamStats.rejected}` : ''}
          {summary?.gaps ? ` · gaps: ${summary.gaps}` : ''}
        </div>
      </details>

      <div className="text-[11px] leading-relaxed text-slate-600">
        Only real readings from the meter are shown. Nothing is simulated. FNIRSI support covers {supportedFnirsi}. Only the sample packet layout is decoded. The meter&apos;s own mAh and mWh totals are not used for FNIRSI.
      </div>
    </div>
  );
}
