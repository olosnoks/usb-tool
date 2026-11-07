import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Gauge, Usb, Power, ShieldAlert, Sparkles, Play, Loader2, Activity, Camera, Download, Square, FileCode, Terminal } from 'lucide-react';
import { UsbTmcDevice, requestUsbTmcDevice } from '../../utils/usbtmcDriver';
import {
  detectProfile, presetsFor, fetchWaveform, waveformStats, waveformCsv, fetchScreenshot, DMM_FUNCTIONS, parseNumber
} from '../../utils/scpiTools';
import StatusBadge from '../common/StatusBadge';
import { record } from '../../utils/sessionLog';

const CH_COLORS = ['#facc15', '#22d3ee', '#f472b6', '#60a5fa'];
const TABS = [['console', 'CONSOLE', Terminal], ['scope', 'SCOPE', Activity], ['logger', 'DMM / PSU LOGGER', Gauge], ['script', 'SCRIPT', FileCode]];

const si = (v, unit = '') => {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!Number.isFinite(v)) return 'OVERLOAD';
  const a = Math.abs(v);
  const [div, p] = a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'k'] : a >= 1 || a === 0 ? [1, ''] : a >= 1e-3 ? [1e-3, 'm'] : a >= 1e-6 ? [1e-6, 'µ'] : [1e-9, 'n'];
  return `${(v / div).toPrecision(4)} ${p}${unit}`;
};

const download = (data, name, type) => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** A small SVG line chart. series: [{ xs, ys, color }] */
function LineChart({ series, height = 220, xLabel = '', yLabel = '' }) {
  const all = series.filter((s) => s.ys.length);
  if (!all.length) return <div className="h-24 flex items-center justify-center text-slate-600">No data yet.</div>;
  const xs = all.flatMap((s) => [s.xs[0], s.xs[s.xs.length - 1]]);
  let ymin = Infinity;
  let ymax = -Infinity;
  for (const s of all) for (const y of s.ys) if (Number.isFinite(y)) { if (y < ymin) ymin = y; if (y > ymax) ymax = y; }
  if (ymin === ymax) { ymin -= 1; ymax += 1; }
  const pad = (ymax - ymin) * 0.08;
  ymin -= pad; ymax += pad;
  const xmin = Math.min(...xs);
  const xmax = Math.max(...xs) || xmin + 1;
  const W = 1000;
  const H = height;
  const px = (x) => ((x - xmin) / (xmax - xmin || 1)) * W;
  const py = (y) => H - ((y - ymin) / (ymax - ymin)) * H;
  const path = (s) => {
    // Decimate to about 2 points per pixel column so huge records still draw fast.
    const step = Math.max(1, Math.floor(s.ys.length / (W * 2)));
    let d = '';
    for (let i = 0; i < s.ys.length; i += step) if (Number.isFinite(s.ys[i])) d += `${d ? 'L' : 'M'}${px(s.xs[i]).toFixed(1)},${py(s.ys[i]).toFixed(1)}`;
    return d;
  };
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full bg-black border border-slate-800 rounded" style={{ height: H }}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#1e293b" strokeWidth="1" />)}
        {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((f) => <line key={f} y1="0" y2={H} x1={W * f} x2={W * f} stroke="#1e293b" strokeWidth="1" />)}
        {ymin < 0 && ymax > 0 && <line x1="0" x2={W} y1={py(0)} y2={py(0)} stroke="#475569" strokeDasharray="4 4" />}
        {all.map((s, i) => <path key={i} d={path(s)} fill="none" stroke={s.color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div className="absolute top-1 left-2 text-[10px] text-slate-500">{si(ymax, yLabel)}</div>
      <div className="absolute bottom-1 left-2 text-[10px] text-slate-500">{si(ymin, yLabel)}</div>
      <div className="absolute bottom-1 right-2 text-[10px] text-slate-500">{xLabel}</div>
    </div>
  );
}

export default function UsbTmcWorkbench({ initialTab = 'console' }) {
  const [inst, setInst] = useState(null);
  const [status, setStatus] = useState('offline');
  const [idn, setIdn] = useState('');
  const [profile, setProfile] = useState(null);
  const [tab, setTab] = useState(initialTab);
  const [cmd, setCmd] = useState('*IDN?');
  const [history, setHistory] = useState([]);
  const [histPos, setHistPos] = useState(-1);
  const [checkErrors, setCheckErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const busyRef = useRef(false);
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  // Scope
  const [channels, setChannels] = useState([1]);
  const [points, setPoints] = useState(1000);
  const [waves, setWaves] = useState({}); // ch -> waveform
  const [shot, setShot] = useState(null); // { url, mime, data }

  // Logger
  const [dmmFn, setDmmFn] = useState('VOLT:DC');
  const [customQuery, setCustomQuery] = useState('');
  const [interval, setIntervalMs] = useState(500);
  const [logging, setLogging] = useState(false);
  const [samples, setSamples] = useState([]); // [{ t, v }]
  const loggingRef = useRef(false);

  // Script
  const [script, setScript] = useState('# One command per line. "wait 500" pauses 500 ms.\n*IDN?\n*CLS\nSYST:ERR?\n');
  const [scriptRunning, setScriptRunning] = useState(false);
  const stopScript = useRef(false);

  const addLog = useCallback((dir, text) => {
    record('USBTMC', dir === 'err' ? 'error' : 'info', dir === 'out' ? `> ${text}` : text);
    setLog((prev) => [...prev.slice(-499), { ts: new Date().toLocaleTimeString(), dir, text }]);
  }, []);

  /** One instrument action at a time (the logger shares the instrument with the console). */
  const exclusive = async (fn) => {
    while (busyRef.current) await new Promise((r) => setTimeout(r, 10));
    busyRef.current = true;
    setBusy(true);
    try { return await fn(); } finally { busyRef.current = false; setBusy(false); }
  };

  const connect = async () => {
    setBusy(true);
    try {
      const transport = await requestUsbTmcDevice();
      const d = new UsbTmcDevice(transport);
      await d.open();
      const id = await d.identify();
      const p = detectProfile(id);
      setInst(d); setIdn(id); setProfile(p); setStatus('online');
      if (p.kind === 'scope' && initialTab === 'console') setTab('scope');
      else if ((p.kind === 'dmm' || p.kind === 'psu') && initialTab === 'console') setTab('logger');
      if (p.kind === 'psu') setCustomQuery(p.family === 'rigol' ? ':MEAS:VOLT? CH1' : 'MEAS:VOLT? CH1');
      addLog('in', id);
    } catch (err) {
      setStatus('warning'); addLog('err', err.message);
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    loggingRef.current = false;
    setLogging(false);
    stopScript.current = true;
    try { await inst?.close(); } catch (e) { /* ignore */ }
    setInst(null); setIdn(''); setProfile(null); setStatus('offline'); setWaves({}); setShot(null);
  };

  const send = async (command) => {
    addLog('out', command);
    if (command.includes('?')) addLog('in', await inst.query(command));
    else await inst.write(command);
    if (checkErrors && !/ERR/i.test(command)) {
      const e = await inst.query('SYST:ERR?');
      if (!/^\+?0\b/.test(e.trim())) addLog('err', `Instrument error: ${e}`);
    }
  };

  const run = async (command) => {
    if (!inst || !command.trim()) return;
    setHistory((h) => [command, ...h.filter((x) => x !== command)].slice(0, 50));
    setHistPos(-1);
    try { await exclusive(() => send(command.trim())); } catch (err) { addLog('err', err.message); }
  };

  const onCmdKey = (e) => {
    if (e.key === 'Enter') run(cmd);
    else if (e.key === 'ArrowUp' && history.length) {
      const p = Math.min(history.length - 1, histPos + 1);
      setHistPos(p); setCmd(history[p]); e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      const p = histPos - 1;
      setHistPos(Math.max(-1, p)); setCmd(p < 0 ? '' : history[p]); e.preventDefault();
    }
  };

  // --- Scope ------------------------------------------------------------------

  const fetchWaves = () => exclusive(async () => {
    const next = {};
    for (const ch of channels) {
      try {
        addLog('out', `fetch waveform channel ${ch}`);
        const wf = await fetchWaveform(inst, profile, ch, { points: Number(points) || 1000 });
        next[ch] = { ...wf, stats: waveformStats(wf.volts, wf.xinc) };
        addLog('in', `${wf.points} points from ${wf.source}, scaled as ${wf.formula}`);
      } catch (err) {
        addLog('err', `Channel ${ch}: ${err.message}`);
      }
    }
    setWaves(next);
  });

  const grabScreen = () => exclusive(async () => {
    try {
      addLog('out', 'screenshot');
      const s = await fetchScreenshot(inst, profile);
      if (shot?.url) URL.revokeObjectURL(shot.url);
      setShot({ ...s, url: URL.createObjectURL(new Blob([s.data], { type: s.mime })) });
      addLog('in', `${s.mime}, ${s.data.length} bytes`);
    } catch (err) { addLog('err', err.message); }
  });

  // --- Logger -------------------------------------------------------------------

  useEffect(() => {
    if (!logging || !inst) return undefined;
    loggingRef.current = true;
    const t0 = Date.now();
    let timer = null;
    const tick = async () => {
      if (!loggingRef.current) return;
      try {
        const q = customQuery.trim() || `MEAS:${dmmFn}?`;
        const v = await exclusive(async () => parseNumber(await inst.query(q)));
        setSamples((prev) => [...prev.slice(-9999), { t: (Date.now() - t0) / 1000, v, at: new Date().toISOString() }]);
      } catch (err) {
        addLog('err', `Logger stopped: ${err.message}`);
        loggingRef.current = false;
        setLogging(false);
        return;
      }
      timer = setTimeout(tick, Math.max(50, Number(interval) || 500));
    };
    tick();
    return () => { loggingRef.current = false; clearTimeout(timer); };
  }, [logging, inst]);

  const loggerUnit = customQuery.trim() ? '' : (DMM_FUNCTIONS.find((f) => f.id === dmmFn)?.unit || '');
  const finite = samples.map((s) => s.v).filter(Number.isFinite);
  const lstats = finite.length ? {
    last: samples[samples.length - 1].v,
    min: Math.min(...finite),
    max: Math.max(...finite),
    avg: finite.reduce((a, b) => a + b, 0) / finite.length,
    std: Math.sqrt(finite.reduce((a, b) => a + (b - finite.reduce((x, y) => x + y, 0) / finite.length) ** 2, 0) / finite.length)
  } : null;

  // --- Script -------------------------------------------------------------------

  const runScript = async () => {
    stopScript.current = false;
    setScriptRunning(true);
    try {
      for (const raw of script.split('\n')) {
        if (stopScript.current) { addLog('err', 'Script stopped.'); break; }
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const wait = line.match(/^wait\s+(\d+)$/i);
        if (wait) { await new Promise((r) => setTimeout(r, Number(wait[1]))); continue; }
        try { await exclusive(() => send(line)); } catch (err) { addLog('err', `${line}: ${err.message}`); break; }
      }
    } finally {
      setScriptRunning(false);
    }
  };

  const presets = profile ? presetsFor(profile) : [];
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const btn = 'flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40';
  const btn2 = 'flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 text-slate-300 border border-slate-700 font-bold disabled:opacity-40';
  const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none';

  return (
    <div className="space-y-4 font-mono text-xs">

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-400" /> <span>USBTMC INSTRUMENT (SCPI)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Control a USBTMC instrument (oscilloscope, DMM, power supply, signal generator) with SCPI over WebUSB. Pull scope
              waveforms and screenshots (Rigol, Keysight, Siglent, Tektronix), log meter readings to CSV and run command scripts.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'SCPI' : status === 'warning' ? 'ERR' : 'IDLE'} value={inst ? 'Connected' : 'Offline'} />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!inst ? (
            <button onClick={() => connect()} disabled={!webUsbAvailable || busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} CONNECT INSTRUMENT (WEBUSB)
            </button>
          ) : (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> DISCONNECT
            </button>
          )}
          {profile && (
            <span className="text-[11px] text-slate-400">
              <span className="text-emerald-400">{profile.maker} {profile.model}</span> · {profile.kind === 'unknown' ? 'instrument' : profile.kind} · {profile.family === 'generic' ? 'generic SCPI' : `${profile.family} commands`}
            </span>
          )}
        </div>
      </div>

      {inst && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
            {TABS.map(([id, label, Icon]) => (
              <button key={id} onClick={() => setTab(id)} className={`flex items-center gap-1 px-2.5 py-1 rounded font-bold border ${tab === id ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50' : 'bg-slate-900 text-slate-400 border-slate-800'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === 'console' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-cyan-400">SCPI</span>
                <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={onCmdKey} placeholder="↑/↓ for history" className={`${inp} flex-1`} />
                <button onClick={() => run(cmd)} disabled={busy} className={btn}><Play className="w-3.5 h-3.5" /> SEND</button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {presets.map((q) => (
                  <button key={q} onClick={() => { setCmd(q); run(q); }} disabled={busy} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 disabled:opacity-40">{q}</button>
                ))}
                <label className="ml-auto flex items-center gap-1 text-slate-400"><input type="checkbox" checked={checkErrors} onChange={(e) => setCheckErrors(e.target.checked)} className="accent-cyan-500" /> check SYST:ERR? after each command</label>
              </div>
            </>
          )}

          {tab === 'scope' && (
            <div className="space-y-2">
              {profile?.kind !== 'scope' && <div className="text-amber-300">This doesn't identify as an oscilloscope; waveform commands may not work.</div>}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 font-bold">CHANNELS</span>
                {[1, 2, 3, 4].map((c) => (
                  <label key={c} className="flex items-center gap-1" style={{ color: CH_COLORS[c - 1] }}>
                    <input type="checkbox" checked={channels.includes(c)} onChange={(e) => setChannels((p) => (e.target.checked ? [...p, c].sort() : p.filter((x) => x !== c)))} /> CH{c}
                  </label>
                ))}
                {profile && profile.family !== 'rigol' && profile.family !== 'siglent' && (
                  <>
                    <span className="text-slate-500 font-bold ml-2">POINTS</span>
                    <select value={points} onChange={(e) => setPoints(e.target.value)} className={inp}>
                      {[250, 500, 1000, 2000, 5000, 10000].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </>
                )}
                <button onClick={fetchWaves} disabled={busy || !channels.length} className={btn}><Activity className="w-3.5 h-3.5" /> FETCH WAVEFORM</button>
                <button onClick={grabScreen} disabled={busy} className={btn2}><Camera className="w-3.5 h-3.5" /> SCREENSHOT</button>
                {Object.keys(waves).length > 0 && (
                  <button onClick={() => Object.entries(waves).forEach(([ch, wf]) => download(waveformCsv(wf), `CH${ch}-${stamp()}.csv`, 'text/csv'))} className={btn2}><Download className="w-3.5 h-3.5" /> CSV</button>
                )}
              </div>
              <LineChart
                series={Object.entries(waves).map(([ch, wf]) => ({ xs: wf.times, ys: wf.volts, color: CH_COLORS[ch - 1] }))}
                xLabel={Object.values(waves)[0] ? `${si(Object.values(waves)[0].times[0], 's')} … ${si(Object.values(waves)[0].times[Object.values(waves)[0].times.length - 1], 's')}` : ''}
                yLabel="V"
              />
              {Object.keys(waves).length > 0 && (
                <table className="w-full text-[11px]">
                  <thead className="text-slate-500 text-left"><tr><th>CH</th><th>POINTS</th><th>Vpp</th><th>MIN</th><th>MAX</th><th>MEAN</th><th>RMS</th><th>FREQ</th><th>SAMPLE RATE</th></tr></thead>
                  <tbody>
                    {Object.entries(waves).map(([ch, wf]) => (
                      <tr key={ch} className="border-t border-slate-900 text-slate-300">
                        <td style={{ color: CH_COLORS[ch - 1] }} className="font-bold">CH{ch}</td>
                        <td>{wf.points}</td>
                        <td>{si(wf.stats?.pp, 'V')}</td>
                        <td>{si(wf.stats?.min, 'V')}</td>
                        <td>{si(wf.stats?.max, 'V')}</td>
                        <td>{si(wf.stats?.mean, 'V')}</td>
                        <td>{si(wf.stats?.rms, 'V')}</td>
                        <td>{wf.stats?.freq ? si(wf.stats.freq, 'Hz') : '—'}</td>
                        <td>{si(1 / wf.xinc, 'Sa/s')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {shot && (
                <div className="space-y-1">
                  <img src={shot.url} alt="Instrument screenshot" className="max-w-full border border-slate-800 rounded" style={{ imageRendering: 'pixelated' }} />
                  <button onClick={() => download(shot.data, `screen-${stamp()}.${shot.mime.split('/')[1]}`, shot.mime)} className={btn2}><Download className="w-3.5 h-3.5" /> SAVE IMAGE</button>
                </div>
              )}
            </div>
          )}

          {tab === 'logger' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-slate-500 font-bold">MEASURE</span>
                <select value={dmmFn} onChange={(e) => setDmmFn(e.target.value)} disabled={!!customQuery.trim() || logging} className={inp}>
                  {DMM_FUNCTIONS.map((f) => <option key={f.id} value={f.id}>{f.label} (MEAS:{f.id}?)</option>)}
                </select>
                <span className="text-slate-500">or query</span>
                <input value={customQuery} onChange={(e) => setCustomQuery(e.target.value)} disabled={logging} placeholder="e.g. READ? or MEAS:VOLT? CH1" className={`${inp} w-48`} />
                <span className="text-slate-500 font-bold">EVERY</span>
                <input type="number" min="50" value={interval} onChange={(e) => setIntervalMs(e.target.value)} disabled={logging} className={`${inp} w-20`} />
                <span className="text-slate-500">ms</span>
                {!logging ? (
                  <button onClick={() => setLogging(true)} className={btn}><Play className="w-3.5 h-3.5" /> START</button>
                ) : (
                  <button onClick={() => { loggingRef.current = false; setLogging(false); }} className={btn2}><Square className="w-3.5 h-3.5" /> STOP</button>
                )}
                <button onClick={() => setSamples([])} disabled={logging} className={btn2}>CLEAR</button>
                <button
                  onClick={() => download(['time_iso,elapsed_s,value', ...samples.map((s) => `${s.at},${s.t.toFixed(3)},${s.v}`)].join('\n') + '\n', `log-${stamp()}.csv`, 'text/csv')}
                  disabled={!samples.length}
                  className={btn2}
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </button>
              </div>
              {lstats && (
                <div className="grid grid-cols-2 @sm:grid-cols-5 gap-2">
                  {[['NOW', lstats.last], ['MIN', lstats.min], ['MAX', lstats.max], ['MEAN', lstats.avg], ['STD DEV', lstats.std]].map(([k, v]) => (
                    <div key={k} className="bg-slate-950 border border-slate-800 rounded p-2 text-center">
                      <div className="text-[10px] text-slate-500 font-bold">{k}</div>
                      <div className={`font-extrabold ${k === 'NOW' ? 'text-xl text-emerald-300' : 'text-sm text-slate-200'}`}>{si(v, loggerUnit)}</div>
                    </div>
                  ))}
                </div>
              )}
              <LineChart series={[{ xs: samples.map((s) => s.t), ys: samples.map((s) => s.v), color: '#34d399' }]} height={180} xLabel={samples.length ? `${samples[samples.length - 1].t.toFixed(1)} s · ${samples.length} readings` : ''} yLabel={loggerUnit} />
            </div>
          )}

          {tab === 'script' && (
            <div className="space-y-2">
              <textarea value={script} onChange={(e) => setScript(e.target.value)} rows={8} spellCheck={false} className={`${inp} w-full`} />
              <div className="flex items-center gap-2">
                {!scriptRunning ? (
                  <button onClick={runScript} className={btn}><Play className="w-3.5 h-3.5" /> RUN SCRIPT</button>
                ) : (
                  <button onClick={() => { stopScript.current = true; }} className={btn2}><Square className="w-3.5 h-3.5" /> STOP</button>
                )}
                <span className="text-slate-500">Stops at the first command that fails. Turn on "check SYST:ERR?" in the console to stop on instrument errors too.</span>
              </div>
            </div>
          )}

          <div className="bg-slate-950 border border-slate-800 rounded p-2 max-h-72 overflow-auto space-y-0.5">
            <div className="flex justify-between text-slate-600">
              <span>EXCHANGES</span>
              {log.length > 0 && <button onClick={() => download(log.map((e) => `${e.ts} ${e.dir} ${e.text}`).join('\n') + '\n', `scpi-${stamp()}.txt`, 'text/plain')} className="hover:text-cyan-300">save</button>}
            </div>
            {log.length === 0 && <p className="text-slate-600">No exchanges yet.</p>}
            {log.map((e, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-slate-600">{e.ts}</span>
                <span className={e.dir === 'out' ? 'text-amber-300' : e.dir === 'err' ? 'text-rose-400' : 'text-emerald-300'}>{e.dir === 'out' ? '»' : e.dir === 'err' ? '✗' : '«'}</span>
                <span className="text-slate-300 whitespace-pre-wrap break-all">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
