import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Gamepad2, Mouse, Usb, Vibrate, RotateCcw, Play, Square, Trash2, Ruler, Scroll, Activity, Copy, Download } from 'lucide-react';
import {
  STANDARD_BUTTON_NAMES, SONY_VENDOR_ID, DS4_USB_OFFSETS, DUALSENSE_USB_OFFSETS,
  updateRateFromTimestamps, eventsPerSecond, summarizeSeries, histogram, intervalStats,
  analyzeClicks, normalizeWheelDelta, summarizeWheel, sumMovement, dpiFromCounts, distanceToInches,
  applyRadialDeadzone, driftStats, createCircularityTracker, addCirclePoint, circularityReport,
  triggerResponse, sonyFamily, decodeSonyReport, hexDump,
  createButtonTracker, updateButtonTracker, buttonTrackerSummary, createAxisTracker, updateAxisTracker,
  axisRangeReport, suggestDeadzone, buildGamepadReport, formatGamepadReport,
} from '../../utils/inputTester.js';

/**
 * Gamepad & Mouse Tester.
 * Gamepad tab: Gamepad API polling (requestAnimationFrame) with pads, buttons, sticks,
 * deadzone, rest drift, circularity, triggers, report rate and rumble, plus an optional
 * WebHID view of raw Sony (DS4 / DualSense) USB input reports.
 * Mouse tab: pointer event rate, click/chatter analysis, wheel log and a DPI estimator.
 * Every number on screen comes from the device or the user's own input.
 */

const TRAIL_LEN = 90;
const TRIG_LEN = 240;
const TS_LEN = 400;
const DRIFT_MS = 3000;
const CIRC_BINS = 360;
const BUTTON_NAMES_MOUSE = ['Left', 'Middle', 'Right', 'Back', 'Forward'];
const UI_INTERVAL_MS = 100;

const card = 'bg-slate-950 border border-slate-800 rounded p-2';
const label = 'text-[10px] uppercase tracking-wider text-slate-500';
const btn = 'px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 text-gray-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1';
const btnPrimary = 'px-2.5 py-1 text-xs rounded border border-emerald-800 bg-emerald-900/40 text-emerald-200 hover:bg-emerald-900/70 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1';

const pct = (v, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}`);
const fmt = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));

function pushBounded(arr, v, max) {
  arr.push(v);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function listPads() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return Array.from(navigator.getGamepads() || []).filter(Boolean);
}

function samePadList(a, b) {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.index === b[i].index && p.id === b[i].id && p.mapping === b[i].mapping);
}

function pickStick(pad, which) {
  const ax = pad.axes;
  return which === 'right' ? { x: ax[2] ?? 0, y: ax[3] ?? 0 } : { x: ax[0] ?? 0, y: ax[1] ?? 0 };
}

// ---------------------------------------------------------------------------
// Canvas drawing
// ---------------------------------------------------------------------------

function drawStick(canvas, trail, cur, dz) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const c = S / 2;
  const R = S / 2 - 10;
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.moveTo(c, 4); ctx.lineTo(c, S - 4); ctx.moveTo(4, c); ctx.lineTo(S - 4, c);
  ctx.stroke();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(c, c, R * dz, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  trail.forEach((p, i) => {
    ctx.fillStyle = `rgba(52,211,153,${((i + 1) / trail.length) * 0.5})`;
    ctx.beginPath();
    ctx.arc(c + p.x * R, c + p.y * R, 2, 0, Math.PI * 2);
    ctx.fill();
  });
  const inside = Math.hypot(cur.x, cur.y) <= dz;
  ctx.fillStyle = inside ? '#64748b' : '#34d399';
  ctx.beginPath();
  ctx.arc(c + cur.x * R, c + cur.y * R, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawCircularity(canvas, report) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const c = S / 2;
  const R = S / 2 - 10;
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.arc(c, c, R, 0, Math.PI * 2);
  ctx.moveTo(c, 4); ctx.lineTo(c, S - 4); ctx.moveTo(4, c); ctx.lineTo(S - 4, c);
  ctx.stroke();
  if (report && report.polygon.length > 1) {
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    report.polygon.forEach((p, i) => (i === 0 ? ctx.moveTo(c + p.x * R, c + p.y * R) : ctx.lineTo(c + p.x * R, c + p.y * R)));
    ctx.closePath();
    ctx.stroke();
    ctx.lineWidth = 1;
    if (report.meanRadius) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(c, c, R * report.meanRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function drawTrace(canvas, series) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(0, H - 1); ctx.lineTo(W, H - 1);
  ctx.stroke();
  const colors = { l2: '#22d3ee', r2: '#c084fc' };
  for (const key of Object.keys(series)) {
    const arr = series[key];
    if (arr.length < 2) continue;
    ctx.strokeStyle = colors[key];
    ctx.beginPath();
    arr.forEach((v, i) => {
      const x = W - ((arr.length - 1 - i) / (TRIG_LEN - 1)) * W;
      const y = H - 2 - v * (H - 4);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}

function drawCurve(canvas, low, high, raw) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.moveTo(4, S - 4); ctx.lineTo(4, 4); ctx.moveTo(4, S - 4); ctx.lineTo(S - 4, S - 4);
  ctx.stroke();
  ctx.strokeStyle = '#22d3ee';
  ctx.beginPath();
  for (let i = 0; i <= 100; i++) {
    const x = i / 100;
    const y = triggerResponse(x, { low, high });
    const px = 4 + x * (S - 8);
    const py = S - 4 - y * (S - 8);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
  const mapped = triggerResponse(raw, { low, high });
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.arc(4 + raw * (S - 8), S - 4 - mapped * (S - 8), 4, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Gamepad tab
// ---------------------------------------------------------------------------

function GamepadTab({ log }) {
  const supported = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  const [pads, setPads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [deadzone, setDeadzone] = useState(0.1);
  const [stick, setStick] = useState('left');
  const [trigLow, setTrigLow] = useState(0);
  const [trigHigh, setTrigHigh] = useState(1);
  const [snap, setSnap] = useState(null);
  const [vibeMsg, setVibeMsg] = useState('');
  const [copyMsg, setCopyMsg] = useState('');

  const cfgRef = useRef({});
  cfgRef.current = { deadzone, stick, trigLow, trigHigh };
  const snapRef = useRef(null);
  const logRef = useRef(log);
  logRef.current = log;

  const stickLRef = useRef(null);
  const stickRRef = useRef(null);
  const circRef = useRef(null);
  const traceRef = useRef(null);
  const curveRef = useRef(null);

  // Everything the frame loop accumulates; the UI reads a snapshot of it ~10 times a second.
  const live = useRef({
    selected: null,
    trailL: [], trailR: [],
    raw: null,
    tsBuf: [], lastTs: null,
    trig: { l2: [], r2: [] },
    drift: null, driftResult: null,
    circ: null,
    btnT: createButtonTracker(), axT: createAxisTracker(),
    lastUi: 0,
  });

  // Pad list: browsers only expose a pad after a button press, so poll as well as listening for events.
  useEffect(() => {
    if (!supported) return undefined;
    const refresh = () => {
      const list = listPads().map((p) => ({ index: p.index, id: p.id, mapping: p.mapping }));
      setPads((prev) => (samePadList(prev, list) ? prev : list));
      setSelected((prev) => (list.some((p) => p.index === prev) ? prev : (list[0]?.index ?? null)));
    };
    const onConnect = (e) => { logRef.current?.(`Gamepad connected: ${e.gamepad.id}`, 'info'); refresh(); };
    const onDisconnect = (e) => { logRef.current?.(`Gamepad disconnected: ${e.gamepad.id}`, 'info'); refresh(); };
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onDisconnect);
    refresh();
    const timer = setInterval(refresh, 1000);
    return () => {
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onDisconnect);
      clearInterval(timer);
    };
  }, [supported]);

  // Switching pads resets the per-pad measurements.
  useEffect(() => {
    const L = live.current;
    L.selected = selected;
    L.trailL = []; L.trailR = []; L.tsBuf = []; L.lastTs = null;
    L.trig = { l2: [], r2: [] };
    L.drift = null; L.driftResult = null; L.circ = null;
    L.btnT = createButtonTracker(); L.axT = createAxisTracker();
  }, [selected]);

  // Frame loop: read the pad, accumulate measurements, draw, and publish a snapshot ~10 Hz.
  useEffect(() => {
    if (!supported) return undefined;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const L = live.current;
      const cfg = cfgRef.current;
      const pad = L.selected === null ? null : listPads().find((p) => p.index === L.selected) || null;

      if (pad) {
        const left = pickStick(pad, 'left');
        const right = pickStick(pad, 'right');
        pushBounded(L.trailL, left, TRAIL_LEN);
        pushBounded(L.trailR, right, TRAIL_LEN);
        L.raw = { left, right };
        if (pad.timestamp !== L.lastTs) {
          L.lastTs = pad.timestamp;
          pushBounded(L.tsBuf, pad.timestamp, TS_LEN);
        }
        updateButtonTracker(L.btnT, pad.buttons, now);
        updateAxisTracker(L.axT, pad.axes);
        pushBounded(L.trig.l2, pad.buttons[6]?.value ?? 0, TRIG_LEN);
        pushBounded(L.trig.r2, pad.buttons[7]?.value ?? 0, TRIG_LEN);

        if (L.drift) {
          const s = pickStick(pad, L.drift.stick);
          L.drift.samples.push(s);
          if (now - L.drift.startAt >= DRIFT_MS) {
            const stats = driftStats(L.drift.samples);
            L.driftResult = stats ? { stick: L.drift.stick, ...stats } : null;
            L.drift = null;
          }
        }
        if (L.circ && L.circ.active) {
          const s = pickStick(pad, L.circ.stick);
          addCirclePoint(L.circ.tracker, s.x, s.y);
        }
      } else {
        L.raw = null;
      }

      if (now - L.lastUi >= UI_INTERVAL_MS) {
        L.lastUi = now;
        setSnap({
          pad: pad ? {
            index: pad.index,
            id: pad.id,
            mapping: pad.mapping,
            timestamp: pad.timestamp,
            buttons: Array.from(pad.buttons, (b) => ({ value: b.value, pressed: b.pressed })),
            axes: Array.from(pad.axes),
          } : null,
          rate: updateRateFromTimestamps(L.tsBuf),
          drift: L.drift ? { status: 'measuring', elapsedMs: now - L.drift.startAt, samples: L.drift.samples.length, stick: L.drift.stick }
            : (L.driftResult ? { status: 'done', ...L.driftResult } : { status: 'idle' }),
          btn: pad ? { counts: { ...L.btnT.counts }, chatter: { ...L.btnT.chatter }, minGap: { ...L.btnT.minGap }, ever: { ...L.btnT.everPressed }, summary: buttonTrackerSummary(L.btnT, pad.buttons.length) } : null,
          axr: pad ? axisRangeReport(L.axT, pad.axes.length) : null,
          circ: L.circ ? { active: L.circ.active, stick: L.circ.stick, report: circularityReport(L.circ.tracker) } : null,
        });
      }

      const { deadzone: dz, trigLow: lo, trigHigh: hi } = cfg;
      if (pad) {
        const r = L.raw;
        drawStick(stickLRef.current, L.trailL, r.left, dz);
        drawStick(stickRRef.current, L.trailR, r.right, dz);
        drawTrace(traceRef.current, L.trig);
        drawCurve(curveRef.current, lo, hi, pad.buttons[6]?.value ?? 0);
        if (L.circ) drawCircularity(circRef.current, circularityReport(L.circ.tracker));
        else drawCircularity(circRef.current, null);
      } else {
        for (const ref of [stickLRef, stickRRef]) {
          const c = ref.current;
          if (c) c.getContext('2d').clearRect(0, 0, c.width, c.height);
        }
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [supported]);

  const startDrift = () => {
    live.current.driftResult = null;
    live.current.drift = { startAt: performance.now(), samples: [], stick: cfgRef.current.stick };
    logRef.current?.('Drift capture started (3 s). Keep the sticks released.', 'info');
  };
  const startCircularity = () => {
    live.current.circ = { tracker: createCircularityTracker(CIRC_BINS), stick: cfgRef.current.stick, active: true };
    logRef.current?.('Circularity capture started. Rotate the stick through full deflection.', 'info');
  };
  const stopCircularity = () => {
    if (live.current.circ) live.current.circ.active = false;
  };
  const resetCircularity = () => {
    live.current.circ = null;
    drawCircularity(circRef.current, null);
  };

  const resetButtons = () => {
    live.current.btnT = createButtonTracker();
    live.current.axT = createAxisTracker();
  };
  const currentReport = () => {
    const sn = snapRef.current;
    if (!sn?.pad) return null;
    const dr = sn.drift?.status === 'done' ? sn.drift : null;
    return buildGamepadReport({
      pad: { id: sn.pad.id, mapping: sn.pad.mapping, buttons: sn.pad.buttons.length, axes: sn.pad.axes.length },
      drift: dr,
      circularity: sn.circ?.report && sn.circ.report.visitedBins ? sn.circ.report : null,
      rate: sn.rate,
      buttons: sn.btn?.summary,
      axes: sn.axr,
      deadzone: cfgRef.current.deadzone,
    });
  };
  const copyReport = async () => {
    const r = currentReport();
    if (!r) return;
    try {
      await navigator.clipboard.writeText(formatGamepadReport(r));
      setCopyMsg('Report copied.');
    } catch (e) {
      setCopyMsg(`Copy failed: ${e.message}`);
    }
  };
  const downloadReport = () => {
    const r = currentReport();
    if (!r) return;
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gamepad-report.json';
    a.click();
    URL.revokeObjectURL(url);
    setCopyMsg('Report downloaded.');
  };

  const testRumble = async () => {
    const pad = listPads().find((p) => p.index === selected);
    const actuator = pad?.vibrationActuator;
    if (!actuator || typeof actuator.playEffect !== 'function') {
      setVibeMsg('Rumble not available: this pad or browser exposes no vibrationActuator.playEffect.');
      return;
    }
    setVibeMsg('Playing dual-rumble...');
    try {
      const result = await actuator.playEffect('dual-rumble', { startDelay: 0, duration: 600, weakMagnitude: 0.5, strongMagnitude: 1.0 });
      setVibeMsg(`dual-rumble finished: ${result}.`);
    } catch (e) {
      setVibeMsg(`Rumble failed: ${e.message}`);
    }
  };

  if (!supported) {
    return <div className={card + ' text-sm text-amber-300'}>The Gamepad API is not available in this browser or context. Use a Chromium-based browser over HTTPS or localhost.</div>;
  }

  snapRef.current = snap;
  const pad = snap?.pad;
  const drift = snap?.drift;
  const circ = snap?.circ;
  const rate = snap?.rate;
  const circReport = circ?.report;
  const l2 = pad?.buttons?.[6]?.value ?? 0;
  const r2 = pad?.buttons?.[7]?.value ?? 0;

  return (
    <div className="space-y-2">
      <div className={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className={label}>Connected gamepads ({pads.length})</div>
          <div className="text-[10px] text-slate-500">Chromium exposes a pad only after you press a button on it.</div>
        </div>
        {pads.length === 0 ? (
          <div className="mt-2 text-xs text-slate-400">No gamepad detected. Plug one in and press any button on it.</div>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {pads.map((p) => (
              <button
                key={p.index}
                onClick={() => setSelected(p.index)}
                className={`text-left px-2 py-1.5 rounded border text-xs font-mono ${selected === p.index ? 'border-emerald-600 bg-emerald-900/30 text-emerald-200' : 'border-slate-700 bg-slate-900 text-gray-300 hover:bg-slate-800'}`}
              >
                <div>[{p.index}] {p.id}</div>
                <div className="text-[10px] text-slate-500">mapping: {p.mapping || '(none)'}</div>
              </button>
            ))}
          </div>
        )}
        {pad && (
          <div className="mt-2 text-[11px] text-slate-500 font-mono">
            Selected: index {pad.index}, mapping "{pad.mapping || 'non-standard'}", {pad.buttons.length} buttons, {pad.axes.length} axes.
            {pad.mapping !== 'standard' && ' Button names below are generic because the mapping is not "standard".'}
          </div>
        )}
      </div>

      {pad && (
        <>
          <div className={card}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className={label}>Buttons (analog 0-1, press count, chatter)</div>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-500 font-mono">tested {snap?.btn?.summary.tested ?? 0}/{pad.buttons.length}, presses {snap?.btn?.summary.totalPresses ?? 0}, chatter {snap?.btn?.summary.totalChatter ?? 0}</span>
                <button onClick={resetButtons} className={btn} title="Reset press counts, chatter and axis ranges" aria-label="Reset button counts"><RotateCcw size={11} /></button>
                <button onClick={copyReport} className={btn} title="Copy a text report of this session" aria-label="Copy report"><Copy size={11} /></button>
                <button onClick={downloadReport} className={btn} title="Download the session as JSON" aria-label="Download report"><Download size={11} /></button>
              </div>
            </div>
            {copyMsg && <div className="text-[10px] text-slate-400">{copyMsg}</div>}
            <div className="mt-1.5 grid grid-cols-2 @md:grid-cols-4 gap-1">
              {pad.buttons.map((b, i) => {
                const name = pad.mapping === 'standard' ? (STANDARD_BUTTON_NAMES[i] || `Button ${i}`) : `Button ${i}`;
                return (
                  <div key={i} className={`rounded border px-2 py-1 text-[11px] font-mono ${b.pressed ? 'border-emerald-600 bg-emerald-900/30' : 'border-slate-800 bg-slate-900'}`}>
                    <div className="flex justify-between gap-2">
                      <span className="truncate text-gray-300">{i}: {name}</span>
                      <span className={b.pressed ? 'text-emerald-300' : 'text-slate-500'}>{fmt(b.value, 2)}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 flex justify-between">
                      <span>{snap?.btn?.ever[i] ? 'tested' : 'untested'} x{snap?.btn?.counts[i] || 0}</span>
                      {snap?.btn?.chatter[i] ? <span className="text-amber-300" title={`Shortest press-to-press gap ${fmt(snap.btn.minGap[i], 0)} ms`}>chatter {snap.btn.chatter[i]}</span> : null}
                    </div>
                    <div className="h-1 bg-slate-800 rounded mt-1 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${Math.round(b.value * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 text-[11px] font-mono text-slate-400 break-all">
              Axes: {pad.axes.map((a, i) => `[${i}] ${fmt(a, 3)}`).join('   ')}
            </div>
            <div className="mt-1 text-[10px] font-mono text-slate-500 break-all" title="Sweep each stick fully. An axis that never reaches both -0.95 and +0.95 is not marked ok.">
              Range seen: {(snap?.axr || []).map((a) => `[${a.axis}] ${fmt(a.min, 2)}..${fmt(a.max, 2)}${a.fullRange ? ' ok' : ''}`).join('   ')}
            </div>
          </div>

          <div className="grid @lg:grid-cols-2 gap-2">
            <div className={card}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className={label}>Sticks (trail = last {TRAIL_LEN} frames)</div>
                <label className="text-[11px] text-slate-400 flex items-center gap-2">
                  Deadzone {deadzone.toFixed(2)}
                  <input type="range" min="0" max="0.5" step="0.01" value={deadzone} onChange={(e) => setDeadzone(Number(e.target.value))} aria-label="Deadzone" />
                </label>
              </div>
              <div className="mt-2 flex gap-3 justify-center flex-wrap">
                {[['Left', stickLRef, 'left'], ['Right', stickRRef, 'right']].map(([name, ref, which]) => {
                  const raw = pickStick(pad, which);
                  const dzv = applyRadialDeadzone(raw.x, raw.y, deadzone);
                  return (
                    <div key={name} className="text-center">
                      <canvas ref={ref} width={180} height={180} className="rounded border border-slate-800" aria-label={`${name} stick plot`} />
                      <div className="mt-1 text-[10px] font-mono text-slate-400">
                        {name}: x {fmt(raw.x, 3)} y {fmt(raw.y, 3)}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        after deadzone: {fmt(dzv.x, 2)}, {fmt(dzv.y, 2)} {dzv.inside ? '(inside ring)' : ''}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 text-[10px] text-slate-500">Dashed amber ring = deadzone. Green dot = outside the deadzone.</div>
            </div>

            <div className={card}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className={label}>Stick under test</div>
                <div className="flex gap-1">
                  {['left', 'right'].map((s) => (
                    <button key={s} onClick={() => setStick(s)} className={`${btn} ${stick === s ? 'border-cyan-700 text-cyan-200' : ''}`}>{s}</button>
                  ))}
                </div>
              </div>

              <div className="mt-2 border-t border-slate-800 pt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs text-gray-200">Drift at rest (3 s capture)</div>
                  <button onClick={startDrift} disabled={drift?.status === 'measuring'} className={btn}><Play size={11} /> Measure rest</button>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Release the sticks, then measure. Average and max are the distance from zero, as % of full deflection.</div>
                <div className="mt-1 font-mono text-xs">
                  {drift?.status === 'measuring' && <span className="text-amber-300">Measuring... {fmt(Math.min(drift.elapsedMs, DRIFT_MS) / 1000, 1)} s ({drift.samples} samples, {drift.stick})</span>}
                  {drift?.status === 'done' && (
                    <span className="text-gray-200">
                      {drift.stick} stick: avg {pct(drift.avgPct, 2)}% max {pct(drift.maxPct, 2)}% (center x {fmt(drift.centerX, 3)}, y {fmt(drift.centerY, 3)}, {drift.count} samples)
                      {' '}Suggested deadzone: <span className="text-emerald-300">{fmt(suggestDeadzone(drift), 2)}</span>
                      <button onClick={() => setDeadzone(suggestDeadzone(drift))} className={`${btn} ml-1`} title="Set the deadzone slider to the suggested value">Apply</button>
                    </span>
                  )}
                  {(!drift || drift.status === 'idle') && <span className="text-slate-500">No drift result yet.</span>}
                </div>
              </div>

              <div className="mt-2 border-t border-slate-800 pt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="text-xs text-gray-200">Circularity (max-extent polygon)</div>
                  <div className="flex gap-1">
                    <button onClick={startCircularity} disabled={circ?.active} className={btn}><Play size={11} /> Start</button>
                    <button onClick={stopCircularity} disabled={!circ?.active} className={btn}><Square size={11} /> Stop</button>
                    <button onClick={resetCircularity} className={btn}><RotateCcw size={11} /> Reset</button>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Rotate the stick slowly through full deflection in one turn. The cyan line is the max reach per degree; the dashed amber circle is the mean radius.</div>
                <div className="flex gap-3 mt-2 items-start">
                  <canvas ref={circRef} width={160} height={160} className="rounded border border-slate-800 shrink-0" aria-label="Circularity plot" />
                  <div className="font-mono text-[11px] text-gray-300 space-y-0.5">
                    <div>Stick: {circ?.stick || stick}, {circ?.active ? 'capturing' : 'stopped'}</div>
                    <div>Coverage: {circReport ? `${(circReport.coverage * 100).toFixed(0)}%` : '—'} ({circReport?.visitedBins ?? 0}/{CIRC_BINS} bins)</div>
                    <div>Error vs perfect circle: {circReport?.errorPct != null ? `${circReport.errorPct.toFixed(2)}%` : '—'}</div>
                    <div>Mean radius: {fmt(circReport?.meanRadius, 3)}</div>
                    <div>Min / max radius: {fmt(circReport?.minRadius, 3)} / {fmt(circReport?.maxRadius, 3)}</div>
                    {circReport && circReport.coverage < 0.95 && <div className="text-amber-300">Coverage is low: unvisited bins are left out of the error figure.</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="grid @lg:grid-cols-2 gap-2">
            <div className={card}>
              <div className={label}>Triggers (L2 cyan, R2 purple; buttons 6 and 7)</div>
              <canvas ref={traceRef} width={360} height={60} className="mt-2 w-full rounded border border-slate-800" aria-label="Trigger trace" />
              <div className="mt-2 flex gap-3 items-start flex-wrap">
                <canvas ref={curveRef} width={120} height={120} className="rounded border border-slate-800 shrink-0" aria-label="Trigger response curve" />
                <div className="text-[11px] font-mono text-gray-300 space-y-1">
                  <div>L2 raw {fmt(l2, 3)} / R2 raw {fmt(r2, 3)}</div>
                  <div>L2 mapped {fmt(triggerResponse(l2, { low: trigLow, high: trigHigh }), 3)}</div>
                  <label className="flex items-center gap-2">Low {trigLow.toFixed(2)}
                    <input type="range" min="0" max="0.95" step="0.01" value={trigLow} onChange={(e) => setTrigLow(Math.min(Number(e.target.value), trigHigh - 0.01))} aria-label="Trigger low threshold" />
                  </label>
                  <label className="flex items-center gap-2">High {trigHigh.toFixed(2)}
                    <input type="range" min="0.05" max="1" step="0.01" value={trigHigh} onChange={(e) => setTrigHigh(Math.max(Number(e.target.value), trigLow + 0.01))} aria-label="Trigger high threshold" />
                  </label>
                  <div className="text-[10px] text-slate-500">Low/high remap the raw 0-1 range (values below low read 0, above high read 1). They do not change the raw readings.</div>
                </div>
              </div>
            </div>

            <div className={card}>
              <div className={label}>Report rate (from gamepad.timestamp changes)</div>
              <div className="mt-2 font-mono text-xs text-gray-200 space-y-0.5">
                <div>Distinct reports: {rate?.reports ?? 0}</div>
                <div>Average: {rate?.avgHz ? `${rate.avgHz.toFixed(1)} Hz` : '—'}</div>
                <div>Min / max: {rate?.minHz ? `${rate.minHz.toFixed(1)}` : '—'} / {rate?.maxHz ? `${rate.maxHz.toFixed(1)}` : '—'} Hz</div>
                <div>Jitter (std dev): {rate?.jitterMs != null ? `${rate.jitterMs.toFixed(2)} ms` : '—'}</div>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">Estimate only. Chromium advances the timestamp when the pad sends new state, so move the sticks while this runs. It is not a USB poll-rate measurement.</div>
            </div>
          </div>

          <div className={card}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className={label}>Vibration</div>
              <button onClick={testRumble} className={btn}><Vibrate size={11} /> Test rumble (dual-rumble)</button>
            </div>
            <div className="mt-2 text-xs text-gray-300 font-mono">{vibeMsg || 'Press the button to play a 600 ms rumble on the selected pad.'}</div>
          </div>
        </>
      )}

      <HidPanel log={log} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// WebHID raw report view (Sony DS4 / DualSense, USB report 0x01)
// ---------------------------------------------------------------------------

function makeReportHandler(store) {
  return (ev) => {
    const data = new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength);
    const bytes = new Uint8Array(data.length + 1);
    bytes[0] = ev.reportId;
    bytes.set(data, 1);
    store.last = bytes;
    store.count++;
  };
}

function HidPanel({ log }) {
  const hidSupported = typeof navigator !== 'undefined' && !!navigator.hid;
  const [device, setDevice] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState({ count: 0, bytes: null });
  const store = useRef({ device: null, family: null, handler: null, last: null, count: 0, seenCount: -1 });
  const logRef = useRef(log);
  logRef.current = log;

  const detach = useCallback(() => {
    const s = store.current;
    if (s.device) {
      try { s.device.removeEventListener('inputreport', s.handler); } catch { /* ignore */ }
      s.device.close?.().catch?.(() => {});
    }
    s.device = null; s.family = null; s.handler = null; s.last = null; s.count = 0; s.seenCount = -1;
  }, []);

  useEffect(() => {
    if (!hidSupported) return undefined;
    const onDisconnect = (e) => {
      if (store.current.device && e.device === store.current.device) {
        logRef.current?.('Sony HID device disconnected.', 'info');
        detach();
        setDevice(null);
        setView({ count: 0, bytes: null });
      }
    };
    navigator.hid.addEventListener('disconnect', onDisconnect);
    const timer = setInterval(() => {
      const s = store.current;
      if (!s.device || s.count === s.seenCount) return;
      s.seenCount = s.count;
      setView({ count: s.count, bytes: s.last });
    }, 150);
    return () => {
      navigator.hid.removeEventListener('disconnect', onDisconnect);
      clearInterval(timer);
      detach();
    };
  }, [hidSupported, detach]);

  const connect = async () => {
    setError('');
    try {
      const [dev] = await navigator.hid.requestDevice({ filters: [{ vendorId: SONY_VENDOR_ID }] });
      if (!dev) return;
      detach();
      if (!dev.opened) await dev.open();
      const s = store.current;
      s.device = dev;
      s.family = sonyFamily(dev.productId);
      s.handler = makeReportHandler(s);
      dev.addEventListener('inputreport', s.handler);
      setDevice({ name: dev.productName || 'Sony HID device', productId: dev.productId, family: s.family });
      setView({ count: 0, bytes: null });
      logRef.current?.(`WebHID opened ${dev.productName || 'Sony device'} (PID 0x${dev.productId.toString(16)}).`, 'info');
    } catch (e) {
      setError(e.name === 'NotFoundError' ? 'No device selected.' : e.message);
    }
  };

  const disconnect = () => {
    detach();
    setDevice(null);
    setView({ count: 0, bytes: null });
  };

  const decoded = device && view.bytes ? decodeSonyReport(device.family, view.bytes) : null;
  const offsets = device?.family === 'DualSense' ? DUALSENSE_USB_OFFSETS : DS4_USB_OFFSETS;
  const pressed = decoded ? Object.entries(decoded.buttons).filter(([, v]) => v).map(([k]) => k) : [];

  return (
    <div className={card}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-200"><Usb size={12} /> Raw HID reports (WebHID, Sony vendor 0x054C)</div>
        {device ? (
          <button onClick={disconnect} className={btn}>Close device</button>
        ) : (
          <button onClick={connect} disabled={!hidSupported} className={btnPrimary}>Connect Sony controller (WebHID)</button>
        )}
      </div>
      {!hidSupported && <div className="mt-2 text-[11px] text-amber-300">WebHID is not available here. Use a Chromium-based browser over HTTPS or localhost.</div>}
      {error && <div className="mt-2 text-[11px] text-red-300">{error}</div>}
      <div className="mt-1 text-[10px] text-slate-500">
        Best-effort decode of USB input report 0x01 for DS4 (PID 0x05C4 / 0x09CC) and DualSense (PID 0x0CE6 / 0x0DF2). Offsets come from community driver documentation and have not been checked against hardware in this build. Bluetooth reports (0x11, 0x31) and other IDs show raw bytes only.
      </div>

      {device && (
        <div className="mt-2 space-y-2">
          <div className="font-mono text-[11px] text-gray-300">
            {device.name} (PID 0x{device.productId.toString(16).padStart(4, '0')}), family {device.family || 'unknown'}, reports received: {view.count}
          </div>
          {!device.family && <div className="text-[11px] text-amber-300">This product ID is not a DS4 or DualSense, so no fields are decoded. Raw bytes only.</div>}
          {view.bytes && (
            <>
              <div className="text-[11px] font-mono text-slate-400">Last report ID 0x{view.bytes[0].toString(16).padStart(2, '0')}, {view.bytes.length} bytes</div>
              {decoded ? (
                <div className="grid @md:grid-cols-2 gap-2 text-[11px] font-mono text-gray-300">
                  <div className="space-y-0.5">
                    <div>Left stick {fmt(decoded.sticks.left.x, 3)}, {fmt(decoded.sticks.left.y, 3)}</div>
                    <div>Right stick {fmt(decoded.sticks.right.x, 3)}, {fmt(decoded.sticks.right.y, 3)}</div>
                    <div>L2 {fmt(decoded.triggers.l2, 3)} / R2 {fmt(decoded.triggers.r2, 3)}</div>
                    <div>D-pad {decoded.dpad}</div>
                    <div>Pressed: {pressed.length ? pressed.join(', ') : 'none'}</div>
                    <div>Sensor timestamp {decoded.sensorTimestamp}</div>
                  </div>
                  <div className="space-y-0.5">
                    <div>Gyro raw {decoded.gyroRaw.join(', ')}</div>
                    <div>Gyro approx {decoded.gyroDps.map((v) => v.toFixed(1)).join(', ')} deg/s</div>
                    <div>Accel raw {decoded.accelRaw.join(', ')}</div>
                    <div>Accel approx {decoded.accelG.map((v) => v.toFixed(2)).join(', ')} g</div>
                    <div className="text-[10px] text-slate-500">Approximate scale (raw / 1024 deg/s, raw / 8192 g), uncalibrated.</div>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-amber-300">Report 0x{view.bytes[0].toString(16).padStart(2, '0')} is not decoded here (only 0x01 is).</div>
              )}
              <pre className="text-[10px] font-mono text-slate-400 bg-slate-900 rounded p-2 overflow-auto max-h-40">{hexDump(view.bytes.slice(0, 64))}</pre>
            </>
          )}
          {!view.bytes && <div className="text-[11px] text-slate-500">Waiting for input reports. Move a stick or press a button.</div>}
          <details className="text-[10px] text-slate-500">
            <summary className="cursor-pointer">Byte offsets used ({device.family || 'DS4'} layout, byte 0 = report ID)</summary>
            <div className="font-mono mt-1 space-y-0.5">
              {Object.entries(offsets).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mouse tab
// ---------------------------------------------------------------------------

const RATE_TICK_MS = 250;
const MOVE_WINDOW_MS = 2000; // move timestamps older than this are pruned on each tick
const SERIES_CAP = 2000;
const PRESS_CAP = 500;
const WHEEL_CAP = 5000;

function MouseTab({ log }) {
  const surfaceRef = useRef(null);
  const moveRef = useRef([]);
  const seriesRef = useRef([]);
  const wheelRef = useRef([]);
  const dpiRef = useRef({ measuring: false, samples: [], settings: null, unadjusted: false });
  const logRef = useRef(log);
  logRef.current = log;

  const [held, setHeld] = useState([]);
  const [presses, setPresses] = useState([]);
  const [chatterMs, setChatterMs] = useState(50);
  const [doubleMs, setDoubleMs] = useState(500);
  const [view, setView] = useState({ rate: null, summary: null, intervals: null, hist: null, wheel: null, wheelLast: [] });
  const [dpi, setDpi] = useState({ measuring: false, distance: '10', unit: 'cm', axis: 'x', counts: 0, result: null, error: '', note: '' });
  const dpiCfgRef = useRef(dpi);
  dpiCfgRef.current = dpi;

  const rawSupported = typeof window !== 'undefined' && 'onpointerrawupdate' in window;

  // Pointer rate: pointerrawupdate where available, else pointermove.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return undefined;
    const type = rawSupported ? 'pointerrawupdate' : 'pointermove';
    const onMove = () => {
      moveRef.current.push(performance.now());
    };
    el.addEventListener(type, onMove);
    const tick = setInterval(() => {
      const now = performance.now();
      const times = moveRef.current;
      let cut = 0;
      while (cut < times.length && times[cut] < now - MOVE_WINDOW_MS) cut++;
      if (cut > 0) times.splice(0, cut);
      if (dpiRef.current.measuring) {
        const counts = sumMovement(dpiRef.current.samples, dpiCfgRef.current.axis);
        setDpi((p) => ({ ...p, counts }));
      }
      const rate = eventsPerSecond(times, now, 1000);
      const movingNow = times.length > 0 && times[times.length - 1] >= now - 1000;
      if (movingNow) pushBounded(seriesRef.current, rate, SERIES_CAP);
      const recent = times.slice(-300);
      const gaps = [];
      for (let i = 1; i < recent.length; i++) gaps.push(recent[i] - recent[i - 1]);
      const wheelEntries = wheelRef.current;
      setView({
        rate,
        summary: summarizeSeries(seriesRef.current),
        intervals: intervalStats(gaps),
        hist: histogram(gaps, { binWidth: 0.25, bins: 32, start: 0 }),
        wheel: summarizeWheel(wheelEntries),
        wheelLast: wheelEntries.slice(-30).reverse(),
      });
    }, RATE_TICK_MS);
    return () => {
      el.removeEventListener(type, onMove);
      clearInterval(tick);
    };
  }, [rawSupported]);

  // Wheel: passive:false so the page does not scroll under the test surface.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      pushBounded(wheelRef.current, {
        dx: normalizeWheelDelta(e.deltaX, e.deltaMode),
        dy: normalizeWheelDelta(e.deltaY, e.deltaMode),
        mode: e.deltaMode,
        t: performance.now(),
      }, WHEEL_CAP);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const finishDpi = useCallback((note) => {
    const d = dpiRef.current;
    const cfg = dpiCfgRef.current;
    d.measuring = false;
    let result = null;
    let error = '';
    try {
      const counts = sumMovement(d.samples, cfg.axis);
      result = dpiFromCounts(counts, Number(cfg.distance), cfg.unit);
      if (!result) error = 'No pointer counts were recorded. Move the mouse while measuring.';
    } catch (e) {
      error = e.message;
    }
    setDpi((prev) => ({ ...prev, measuring: false, counts: sumMovement(d.samples, cfg.axis), result, error, note }));
    if (result) logRef.current?.(`DPI estimate: ${result.dpi} (${result.counts} counts over ${result.inches.toFixed(3)} in)`, 'info');
  }, []);

  // Accumulate raw deltas while pointer lock is held on the surface.
  useEffect(() => {
    const onMove = (e) => {
      const d = dpiRef.current;
      if (!d.measuring) return;
      if (document.pointerLockElement !== surfaceRef.current) return;
      d.samples.push({ dx: e.movementX || 0, dy: e.movementY || 0 });
    };
    const onLockChange = () => {
      const d = dpiRef.current;
      if (d.measuring && document.pointerLockElement !== surfaceRef.current) finishDpi('Pointer lock released; measurement stopped.');
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerlockchange', onLockChange);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerlockchange', onLockChange);
      if (document.pointerLockElement === surfaceRef.current) document.exitPointerLock?.();
    };
  }, [finishDpi]);

  const startDpi = async () => {
    const el = surfaceRef.current;
    const d = dpiRef.current;
    try {
      distanceToInches(Number(dpiCfgRef.current.distance), dpiCfgRef.current.unit); // throws on bad input
    } catch (e) {
      setDpi((p) => ({ ...p, error: e.message }));
      return;
    }
    d.samples = [];
    d.measuring = true;
    let unadjusted = true;
    try {
      await el.requestPointerLock({ unadjustedMovement: true });
    } catch {
      unadjusted = false;
      try {
        await el.requestPointerLock();
      } catch (e) {
        d.measuring = false;
        setDpi((p) => ({ ...p, error: `Pointer lock refused: ${e.message}` }));
        return;
      }
    }
    d.unadjusted = unadjusted;
    setDpi((p) => ({
      ...p,
      measuring: true,
      counts: 0,
      result: null,
      error: '',
      note: unadjusted
        ? 'Measuring with unadjusted movement (OS pointer speed and acceleration bypassed). Move the mouse along the ruler, then press Stop or Esc.'
        : 'Unadjusted movement is not available here, so OS pointer acceleration may still apply. Turn off "Enhance pointer precision" before measuring.',
    }));
  };

  const stopDpi = () => {
    const d = dpiRef.current;
    if (document.pointerLockElement === surfaceRef.current) document.exitPointerLock?.();
    if (d.measuring) finishDpi(d.unadjusted ? '' : 'Unadjusted movement was not available; OS acceleration may have affected this result.');
  };

  const resetDpi = () => {
    dpiRef.current.samples = [];
    setDpi((p) => ({ ...p, counts: 0, result: null, error: '', note: '' }));
  };

  const onDown = (e) => {
    e.preventDefault();
    const t = performance.now();
    setHeld((h) => (h.includes(e.button) ? h : [...h, e.button]));
    setPresses((prev) => {
      const next = prev.length >= PRESS_CAP ? prev.slice(prev.length - PRESS_CAP + 1) : prev.slice();
      next.push({ button: e.button, time: t });
      return next;
    });
  };
  const onUp = (e) => setHeld((h) => h.filter((b) => b !== e.button));

  const analysis = analyzeClicks(presses, { chatterMs, doubleClickMs: doubleMs });
  const lastPairs = analysis.pairs.slice(-12).reverse();

  const rate = view.rate;
  const sum = view.summary;
  const hist = view.hist;
  const maxBin = hist ? Math.max(1, ...hist.counts) : 1;

  return (
    <div className="space-y-2">
      <div className="grid @lg:grid-cols-2 gap-2">
        <div className={card}>
          <div className={label}>Pointer surface (move, click, scroll here)</div>
          <div
            ref={surfaceRef}
            onPointerDown={onDown}
            onPointerUp={onUp}
            onPointerLeave={() => setHeld([])}
            onContextMenu={(e) => e.preventDefault()}
            className="mt-2 h-40 rounded border border-dashed border-slate-700 bg-slate-900 flex items-center justify-center text-xs text-slate-500 select-none touch-none"
            aria-label="Mouse test surface"
          >
            {rawSupported ? 'Rate uses pointerrawupdate' : 'Rate uses pointermove (pointerrawupdate not available)'}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {BUTTON_NAMES_MOUSE.map((name, i) => {
              const count = analysis.perButton[i] || 0;
              const down = held.includes(i);
              return (
                <div key={i} className={`flex-1 min-w-[72px] rounded border px-2 py-1.5 text-center text-[11px] font-mono ${down ? 'border-emerald-500 bg-emerald-900/40 text-emerald-200' : 'border-slate-800 bg-slate-900 text-gray-300'}`}>
                  <div>{i}: {name}</div>
                  <div className="text-[10px] text-slate-500">{count} press{count === 1 ? '' : 'es'}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-2 text-[10px] text-slate-500">Back and Forward can trigger browser history navigation on some mice.</div>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className={label}>Clicks: double-click and chatter</div>
            <button onClick={() => setPresses([])} className={btn}><Trash2 size={11} /> Clear</button>
          </div>
          <div className="mt-2 flex gap-3 text-[11px] font-mono items-center flex-wrap">
            <label className="flex items-center gap-1 text-slate-400">Chatter below
              <input type="number" min="1" max="200" value={chatterMs} onChange={(e) => setChatterMs(Math.max(1, Number(e.target.value) || 1))} className="w-16 bg-slate-900 border border-slate-800 rounded px-1 py-0.5" aria-label="Chatter threshold ms" /> ms
            </label>
            <label className="flex items-center gap-1 text-slate-400">Double-click up to
              <input type="number" min="100" max="2000" value={doubleMs} onChange={(e) => setDoubleMs(Math.max(chatterMs + 1, Number(e.target.value) || 500))} className="w-20 bg-slate-900 border border-slate-800 rounded px-1 py-0.5" aria-label="Double-click window ms" /> ms
            </label>
          </div>
          <div className="mt-2 font-mono text-xs text-gray-200 space-y-0.5">
            <div>Presses: {analysis.total}</div>
            <div>Double clicks: {analysis.doubleClicks} (avg interval {analysis.avgDoubleIntervalMs != null ? `${analysis.avgDoubleIntervalMs.toFixed(0)} ms` : '—'})</div>
            <div className={analysis.chatter ? 'text-amber-300' : ''}>Chatter (accidental double press): {analysis.chatter}</div>
          </div>
          <div className="mt-2 max-h-36 overflow-auto font-mono text-[11px]">
            {lastPairs.length === 0 && <div className="text-slate-500">Press a button twice on the surface to see press-to-press intervals.</div>}
            {lastPairs.map((p, i) => (
              <div key={i} className="flex justify-between border-b border-slate-900 py-0.5">
                <span className="text-slate-400">{BUTTON_NAMES_MOUSE[p.button] || `Button ${p.button}`}</span>
                <span>{p.intervalMs.toFixed(0)} ms</span>
                <span className={p.kind === 'chatter' ? 'text-amber-300' : p.kind === 'double' ? 'text-cyan-300' : 'text-slate-500'}>{p.kind}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid @lg:grid-cols-2 gap-2">
        <div className={card}>
          <div className={label}><span className="inline-flex items-center gap-1"><Activity size={10} /> Polling rate (events per second, 1 s window)</span></div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center font-mono">
            <Stat k="Now" v={rate != null ? rate.toFixed(0) : '—'} />
            <Stat k="Min" v={sum ? sum.min.toFixed(0) : '—'} />
            <Stat k="Avg" v={sum ? sum.avg.toFixed(0) : '—'} />
            <Stat k="Max" v={sum ? sum.max.toFixed(0) : '—'} />
          </div>
          <div className="mt-2 text-[11px] font-mono text-gray-300">
            Interval jitter: {view.intervals?.jitterMs != null ? `${view.intervals.jitterMs.toFixed(3)} ms std dev` : '—'}
            {view.intervals?.avgMs != null ? `, mean gap ${view.intervals.avgMs.toFixed(3)} ms` : ''}
          </div>
          <div className="mt-2">
            <div className="text-[10px] text-slate-500 mb-1">Gap histogram (0.25 ms bins, last 300 events)</div>
            <div className="flex items-end gap-px h-20" aria-label="Interval histogram">
              {hist ? hist.counts.map((c, i) => (
                <div key={i} title={`${(i * 0.25).toFixed(2)}-${((i + 1) * 0.25).toFixed(2)} ms: ${c}`} className="flex-1 bg-cyan-700/70" style={{ height: `${(c / maxBin) * 100}%` }} />
              )) : <div className="text-[11px] text-slate-500">Move the mouse over the surface.</div>}
            </div>
            {hist && hist.overflow > 0 && <div className="text-[10px] text-slate-500">{hist.overflow} gaps longer than 8 ms are off the chart.</div>}
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            This is the event rate the browser delivers, not the USB poll rate. Browsers can coalesce events, so the figure can be lower than the hardware rate.
          </div>
        </div>

        <div className={card}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className={label}><span className="inline-flex items-center gap-1"><Scroll size={10} /> Scroll wheel</span></div>
            <button onClick={() => { wheelRef.current = []; setView((v) => ({ ...v, wheel: null, wheelLast: [] })); }} className={btn}><Trash2 size={11} /> Clear</button>
          </div>
          <div className="mt-2 font-mono text-xs text-gray-200 space-y-0.5">
            <div>Events: {view.wheel?.events ?? 0} (up {view.wheel?.up ?? 0}, down {view.wheel?.down ?? 0}, left {view.wheel?.left ?? 0}, right {view.wheel?.right ?? 0})</div>
            <div>Sum deltaY: {view.wheel ? view.wheel.sumY.toFixed(0) : 0} px, sum deltaX: {view.wheel ? view.wheel.sumX.toFixed(0) : 0} px</div>
          </div>
          <div className="mt-2 max-h-40 overflow-auto font-mono text-[11px] border border-slate-800 rounded">
            {view.wheelLast.length === 0 && <div className="p-2 text-slate-500">Scroll over the surface. Totals cover the last 5000 events.</div>}
            {view.wheelLast.map((w, i) => (
              <div key={i} className="flex justify-between px-2 py-0.5 border-b border-slate-900">
                <span>dy {w.dy.toFixed(0)} px</span>
                <span>dx {w.dx.toFixed(0)} px</span>
                <span className="text-slate-500">mode {w.mode}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className={label}><span className="inline-flex items-center gap-1"><Ruler size={10} /> DPI estimator</span></div>
          <div className="flex gap-1">
            {!dpi.measuring ? (
              <button onClick={startDpi} className={btnPrimary}><Play size={11} /> Start</button>
            ) : (
              <button onClick={stopDpi} className={btn}><Square size={11} /> Stop</button>
            )}
            <button onClick={resetDpi} disabled={dpi.measuring} className={btn}><RotateCcw size={11} /> Reset</button>
          </div>
        </div>
        <div className="mt-2 flex gap-3 flex-wrap items-center text-[11px] font-mono text-slate-400">
          <label className="flex items-center gap-1">Distance
            <input value={dpi.distance} onChange={(e) => setDpi((p) => ({ ...p, distance: e.target.value }))} disabled={dpi.measuring} className="w-20 bg-slate-900 border border-slate-800 rounded px-1 py-0.5" aria-label="Known distance" />
          </label>
          <label className="flex items-center gap-1">Unit
            <select value={dpi.unit} onChange={(e) => setDpi((p) => ({ ...p, unit: e.target.value }))} disabled={dpi.measuring} className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5" aria-label="Distance unit">
              <option value="cm">cm</option>
              <option value="in">in</option>
            </select>
          </label>
          <label className="flex items-center gap-1">Axis
            <select value={dpi.axis} onChange={(e) => setDpi((p) => ({ ...p, axis: e.target.value }))} disabled={dpi.measuring} className="bg-slate-900 border border-slate-800 rounded px-1 py-0.5" aria-label="Movement axis">
              <option value="x">X (horizontal ruler)</option>
              <option value="y">Y (vertical ruler)</option>
              <option value="path">Path length</option>
            </select>
          </label>
        </div>
        <div className="mt-2 text-[11px] text-slate-400">
          Turn off OS "Enhance pointer precision" first. Start, then push the mouse exactly the known distance along a ruler, and press Stop or Esc. Counts are the sum of absolute movement on the chosen axis (or path length). Result = counts / inches.
        </div>
        <div className="mt-2 font-mono text-xs text-gray-200">
          Counts: {dpi.counts} {dpi.result && <>| Inches: {dpi.result.inches.toFixed(3)} | Counts per inch: <span className="text-emerald-300">{dpi.result.countsPerInch.toFixed(1)}</span> (DPI {dpi.result.dpi})</>}
        </div>
        {dpi.note && <div className="mt-1 text-[11px] text-amber-300">{dpi.note}</div>}
        {dpi.error && <div className="mt-1 text-[11px] text-red-300">{dpi.error}</div>}
        <div className="mt-2 text-[10px] text-slate-500">
          The estimate is only as good as the distance you pushed. A few percent of error is normal for a hand-moved mouse; repeat over a long move for a better number.
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900 py-1.5">
      <div className="text-[10px] text-slate-500">{k}</div>
      <div className="text-sm text-gray-100">{v}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'gamepad', name: 'Gamepad', icon: Gamepad2 },
  { id: 'mouse', name: 'Mouse', icon: Mouse },
];

export default function InputTesterWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('gamepad');
  const log = useCallback((text, level) => onLogMessage?.(text, level), [onLogMessage]);

  return (
    <div className="space-y-2 text-sm text-gray-200">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[11px] text-slate-500">Reads your real devices in the browser; nothing is simulated or uploaded. Chromium only.</div>
        <div className="flex gap-1" role="tablist">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`px-2.5 py-1 text-xs rounded border inline-flex items-center gap-1.5 ${active ? 'border-emerald-700 bg-emerald-900/30 text-emerald-200' : 'border-slate-800 bg-slate-900 text-gray-400 hover:text-gray-200'}`}
              >
                <Icon size={12} /> {t.name}
              </button>
            );
          })}
        </div>
      </div>
      {tab === 'gamepad' ? <GamepadTab log={log} /> : <MouseTab log={log} />}
    </div>
  );
}
