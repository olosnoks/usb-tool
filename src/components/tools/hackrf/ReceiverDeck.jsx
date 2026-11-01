// ReceiverDeck — the HackRF receiver in one page: tuner + gains, a zoomable
// spectrum/waterfall, audio demodulation, and the wideband "Looking Glass"
// sweep drawn into the same display.
//
// Mouse on the display: wheel = zoom at the cursor, drag = pan, click = pick the
// channel to listen to (live) or tune there (sweep), double-click = move the LO
// to that frequency. Everything shown comes from the HackRF IQ stream.
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Headphones, Volume2, Sliders, Activity, Scan, Play, Square, ZoomIn, ZoomOut, Maximize2,
  Crosshair, ArrowUpRight, Radio, Flame
} from 'lucide-react';
import { MODE_BANDWIDTH_HZ } from '../../../utils/hackrfDemod';
import { HACKRF_SAMPLE_RATES, HACKRF_FREQ_MIN, HACKRF_FREQ_MAX } from '../../../utils/mayhemDriver';
import { SPEC_RANGE_DB, SPEC_FLOOR_PAD_DB } from '../../../utils/hackrfDsp';
import { createHackRfAudioPlayer } from '../../../utils/hackrfAudioPlayer';
import { WATERFALL_THEMES, buildLut, getTheme, themeGradient, loadThemeId, saveThemeId } from '../../../utils/waterfallThemes';
import { RecordControls, CaptureResultStrip } from '../portapack/IqRecorder';

export const SWEEP_PRESETS = [
  { name: 'HF (1-30 MHz)', startHz: 1000000, endHz: 30000000 },
  { name: 'FM Broadcast (88-108)', startHz: 88000000, endHz: 108000000 },
  { name: 'VHF Air & Marine (108-162)', startHz: 108000000, endHz: 162000000 },
  { name: 'UHF Ham & LMR (400-470)', startHz: 400000000, endHz: 470000000 },
  { name: 'ISM & LoRa (860-930)', startHz: 860000000, endHz: 930000000 },
  { name: 'ADS-B & GPS (1080-1600)', startHz: 1080000000, endHz: 1600000000 },
  { name: '2.4 GHz ISM / Wi-Fi (2400-2500)', startHz: 2400000000, endHz: 2500000000 }
];

const QUICK_FREQS = [
  { label: '100.1 FM', hz: 100100000, mode: 'WFM' },
  { label: '121.5 Air', hz: 121500000, mode: 'AM' },
  { label: '162.4 NOAA', hz: 162400000, mode: 'NFM' },
  { label: '315', hz: 315000000, mode: 'NFM' },
  { label: '433.92', hz: 433920000, mode: 'NFM' },
  { label: '868.3', hz: 868300000, mode: 'NFM' },
  { label: '915', hz: 915000000, mode: 'NFM' },
  { label: '1090 ADS-B', hz: 1090000000, mode: null }
];
const TUNE_STEPS = [{ l: '5 kHz', v: 5000 }, { l: '12.5 kHz', v: 12500 }, { l: '25 kHz', v: 25000 }, { l: '100 kHz', v: 100000 }, { l: '1 MHz', v: 1000000 }];

const W = 1200, SPEC_H = 150, WF_H = 240, H = SPEC_H + WF_H;
const MAX_ROWS = WF_H;


const clampHz = (hz) => Math.max(HACKRF_FREQ_MIN, Math.min(HACKRF_FREQ_MAX, Math.round(hz)));
const fmtMHz = (hz, span = 2e6) => {
  const dec = span < 50e3 ? 5 : span < 500e3 ? 4 : span < 5e6 ? 3 : span < 100e6 ? 2 : 1;
  return `${(hz / 1e6).toFixed(dec)} MHz`;
};
const fmtSpan = (hz) => (hz >= 1e6 ? `${(hz / 1e6).toFixed(hz >= 10e6 ? 0 : 2)} MHz` : `${(hz / 1e3).toFixed(hz >= 100e3 ? 0 : 1)} kHz`);
const niceStep = (span, ticks = 7) => {
  const raw = span / ticks;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
};

// Max dB over the bins of `row` covering [f0, f1); interpolated inside a bin.
function sampleRow(row, f0, f1) {
  const { lo, hi, data } = row;
  if (f1 <= lo || f0 >= hi) return NaN;
  const N = data.length;
  const k = N / (hi - lo);
  let b0 = Math.floor((f0 - lo) * k), b1 = Math.ceil((f1 - lo) * k);
  if (b0 < 0) b0 = 0; if (b1 > N) b1 = N;
  if (b1 - b0 <= 1) {
    const pos = Math.max(0, Math.min(N - 1.001, (((f0 + f1) / 2) - lo) * k - 0.5));
    const i = Math.floor(pos), t = pos - i;
    const a = data[i], b = data[Math.min(N - 1, i + 1)];
    return a + (b - a) * t;
  }
  let m = -Infinity;
  for (let b = b0; b < b1; b++) if (data[b] > m) m = data[b];
  return m;
}

export default function ReceiverDeck({ driver, state }) {
  const isLiveRf = state.connectionType === 'webusb';
  const [rxMode, setRxMode] = useState('live');          // 'live' | 'sweep'
  // Waterfall colour theme (remembered across sessions).
  const [themeId, setThemeId] = useState(() => loadThemeId());
  const lutRef = useRef(buildLut(themeId));
  const themeIdRef = useRef(themeId);
  const traceColorRef = useRef(getTheme(themeId).trace);
  useEffect(() => { lutRef.current = buildLut(themeId); themeIdRef.current = themeId; traceColorRef.current = getTheme(themeId).trace; saveThemeId(themeId); }, [themeId]);
  const rxModeRef = useRef('live');

  // Tuner
  const [freqInput, setFreqInput] = useState((state.frequency / 1e6).toFixed(4));
  const [stepHz, setStepHz] = useState(25000);
  useEffect(() => { if (rxModeRef.current !== 'sweep') setFreqInput((state.frequency / 1e6).toFixed(4)); }, [state.frequency]);

  // Audio
  const [audioOn, setAudioOn] = useState(false);
  const [audioMode, setAudioMode] = useState('WFM');
  const [squelchDb, setSquelchDb] = useState(-200);
  const [volume, setVolume] = useState(75);
  const [channelDb, setChannelDb] = useState(null);
  const [squelchOpen, setSquelchOpen] = useState(true);
  const playerRef = useRef(null);
  const chanTsRef = useRef(0);

  // Sweep
  const [preset, setPreset] = useState(SWEEP_PRESETS[1]);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [sweepRunning, setSweepRunning] = useState(true);
  const [thresholdDb, setThresholdDb] = useState(-55);
  const [peaks, setPeaks] = useState([]);
  const [sweepPass, setSweepPass] = useState(0);
  const thresholdRef = useRef(thresholdDb);
  useEffect(() => { thresholdRef.current = thresholdDb; }, [thresholdDb]);
  const band = (() => {
    const s = parseFloat(customStart), e = parseFloat(customEnd);
    if (!isNaN(s) && !isNaN(e) && e > s) return { name: 'Custom', startHz: clampHz(s * 1e6), endHz: clampHz(e * 1e6) };
    return preset;
  })();
  const bandRef = useRef(band);
  useEffect(() => { bandRef.current = band; }, [band]);
  const SWEEP_CELLS = 2048;
  const sweepRef = useRef(null);   // { startHz, endHz, cells, cursorHz, floorDb }

  // Display
  const canvasRef = useRef(null);
  const viewRef = useRef(null);          // { lo, hi } or null = fit
  const baseRef = useRef(null);
  const rowsRef = useRef([]);            // newest first: { lo, hi, data }
  const liveFrameRef = useRef(null);
  const rowsVerRef = useRef(0);
  const pushRow = (row) => { rowsRef.current.unshift(row); if (rowsRef.current.length > MAX_ROWS) rowsRef.current.pop(); rowsVerRef.current++; };
  const [viewInfo, setViewInfo] = useState({ lo: 0, hi: 0, zoomed: false });
  const wfCacheRef = useRef({ img: null, key: '' });
  const dragRef = useRef(null);
  const peaksRef = useRef([]);
  const audioOnRef = useRef(false);
  const squelchRef = useRef(-200);
  useEffect(() => { peaksRef.current = peaks; }, [peaks]);
  useEffect(() => { audioOnRef.current = audioOn; }, [audioOn]);
  useEffect(() => { squelchRef.current = squelchDb; }, [squelchDb]);
  useEffect(() => { rxModeRef.current = rxMode; rowsRef.current = []; rowsVerRef.current++; viewRef.current = null; }, [rxMode]);

  // ---- live spectrum frames from the driver -------------------------------
  useEffect(() => {
    let seq = 0;
    driver.onSpectrumCallback = (spec, peakDb, centerHz, sampleRate, floorDb) => {
      liveFrameRef.current = { spec, peakDb, centerHz, sampleRate, floorDb, seq: ++seq };
    };
    return () => { driver.onSpectrumCallback = null; };
  }, [driver]);

  // ---- audio -----------------------------------------------------------------
  useEffect(() => { driver.setSquelch(squelchDb); }, [squelchDb, driver]);
  useEffect(() => { if (audioOn) driver.setAudioMode(audioMode); }, [audioMode, audioOn, driver]);
  useEffect(() => { if (playerRef.current) playerRef.current.setVolume(volume / 100); }, [volume]);
  useEffect(() => {
    if (!audioOn || !isLiveRf) return undefined;
    let cancelled = false;
    let player = null;
    (async () => {
      try { player = await createHackRfAudioPlayer({ volume: volume / 100 }); }
      catch (e) { driver.log(e.message, 'warning'); setAudioOn(false); return; }
      if (cancelled) { player.close(); return; }
      playerRef.current = player;
      driver.log(`[Audio] Playback through ${player.kind === 'worklet' ? 'an AudioWorklet' : 'scheduled buffers'} at ${player.context.sampleRate} Hz.`, 'info');
      driver.enableAudio(audioMode);
      driver.onAudioCallback = (samples, rate, meta) => {
        const now = performance.now();
        if (now - chanTsRef.current > 150) { chanTsRef.current = now; setChannelDb(meta.channelDb); setSquelchOpen(meta.open); }
        if (!meta.open) return;
        player.push(samples, rate);
      };
    })();
    return () => {
      cancelled = true;
      driver.onAudioCallback = null;
      driver.disableAudio();
      if (playerRef.current) { playerRef.current.close(); playerRef.current = null; }
      setChannelDb(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioOn, isLiveRf, driver]);
  useEffect(() => { if (!isLiveRf && audioOn) setAudioOn(false); }, [isLiveRf, audioOn]);

  // ---- tuning helpers -----------------------------------------------------------
  const tuneTo = useCallback((hz, mode) => {
    const f = clampHz(hz);
    if (rxModeRef.current === 'sweep') { setSweepRunning(false); driver.stopSweep(); setRxMode('live'); }
    driver.sendCommand(`freq ${f}`);
    driver.setChannelOffset(0);
    if (mode) setAudioMode(mode);
  }, [driver]);
  const tuneAndListen = tuneTo;
  const pickChannel = useCallback((hz) => {
    const snap = audioMode === 'WFM' ? 100000 : 1000;
    const off = Math.round((hz - driver.frequency) / snap) * snap;
    driver.setChannelOffset(off);
  }, [driver, audioMode]);

  // ---- sweep runner ---------------------------------------------------------------
  useEffect(() => {
    if (rxMode !== 'sweep' || !sweepRunning || !isLiveRf) return undefined;
    let active = true;
    const { startHz, endHz } = band;
    const model = { startHz, endHz, cells: new Float32Array(SWEEP_CELLS).fill(NaN), cursorHz: startHz, floorDb: null };
    sweepRef.current = model;
    const cellOf = (f) => Math.min(SWEEP_CELLS - 1, Math.max(0, Math.floor(((f - startHz) / (endHz - startHz)) * SWEEP_CELLS)));

    const buildPeaks = () => {
      const cells = model.cells;
      const found = [];
      for (let i = 2; i < cells.length - 2; i++) {
        const v = cells[i];
        if (!(v > thresholdRef.current)) continue;
        if (v >= cells[i - 1] && v > cells[i + 1] && v >= cells[i - 2] && v > cells[i + 2]) {
          found.push({ id: i, freqHz: Math.round(startHz + ((i + 0.5) / SWEEP_CELLS) * (endHz - startHz)), powerDb: Math.round(v) });
        }
      }
      found.sort((a, b) => b.powerDb - a.powerDb);
      setPeaks(found.slice(0, 24));
    };

    const run = async () => {
      while (active) {
        try {
          await driver.sweepBand({
            startHz, endHz,
            onSegment: ({ centerHz, spanHz, useSpanHz, spec }) => {
              if (!active) return;
              const N = spec.length;
              const lo = centerHz - spanHz / 2;
              const dcMask = spanHz * 0.012;
              const winLo = centerHz - useSpanHz / 2, winHi = centerHz + useSpanHz / 2;
              // Per cell max over the bins that fall into it (DC spike masked).
              const tmp = new Map();
              for (let i = 0; i < N; i++) {
                const f = lo + ((i + 0.5) / N) * spanHz;
                if (f < winLo || f > winHi || f < startHz || f > endHz) continue;
                const d = Math.abs(f - centerHz);
                let v = spec[i];
                if (d < dcMask) {
                  // Use the bin just outside the DC mask instead of the spike.
                  const j = Math.min(N - 1, Math.max(0, i + Math.round((dcMask * 1.3 * N) / spanHz) * (f < centerHz ? -1 : 1)));
                  v = spec[j];
                }
                const c = cellOf(f);
                const cur = tmp.get(c);
                if (cur === undefined || v > cur) tmp.set(c, v);
              }
              tmp.forEach((v, c) => { model.cells[c] = v; });
              model.cursorHz = winHi;
            }
          });
        } catch (e) { driver.log(`Sweep stopped: ${e.message}`, 'warning'); break; }
        if (!active) break;
        // One pass done: a row for the waterfall, the peaks, the floor.
        const filled = Array.from(model.cells).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
        model.floorDb = filled.length ? filled[filled.length >> 1] : null;
        pushRow({ lo: startHz, hi: endHz, data: Float32Array.from(model.cells) });
        buildPeaks();
        setSweepPass((p) => p + 1);
      }
    };
    run();
    return () => { active = false; driver.stopSweep(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rxMode, sweepRunning, isLiveRf, band.startHz, band.endHz, driver]);

  // ---- view (zoom / pan) ------------------------------------------------------------
  const currentBase = useCallback(() => {
    if (rxModeRef.current === 'sweep') { const b = bandRef.current; return { lo: b.startHz, hi: b.endHz }; }
    const c = driver.frequency, sr = driver.sampleRate;
    return { lo: c - sr / 2, hi: c + sr / 2 };
  }, [driver]);
  const getView = useCallback(() => {
    const base = currentBase();
    const prev = baseRef.current;
    if (!prev || prev.lo !== base.lo || prev.hi !== base.hi) {
      baseRef.current = base;
      const v = viewRef.current;
      if (v) {
        // Keep the zoom if it still fits in the new span, else fit.
        const span = v.hi - v.lo;
        if (span >= base.hi - base.lo) viewRef.current = null;
        else {
          let lo = Math.max(base.lo, Math.min(v.lo, base.hi - span));
          viewRef.current = { lo, hi: lo + span };
        }
      }
    }
    return viewRef.current || base;
  }, [currentBase]);
  const setView = useCallback((lo, hi) => {
    const base = baseRef.current || currentBase();
    const baseSpan = base.hi - base.lo;
    const minSpan = Math.max(baseSpan / 400, 2000);
    let span = Math.max(minSpan, Math.min(baseSpan, hi - lo));
    if (span >= baseSpan - 1) { viewRef.current = null; return; }
    lo = Math.max(base.lo, Math.min(lo, base.hi - span));
    viewRef.current = { lo, hi: lo + span };
  }, [currentBase]);
  const zoomAt = useCallback((fHz, factor) => {
    const v = getView();
    const span = v.hi - v.lo;
    const t = (fHz - v.lo) / span;
    const nspan = span * factor;
    setView(fHz - t * nspan, fHz - t * nspan + nspan);
  }, [getView, setView]);
  const zoomCenter = (factor) => { const v = getView(); zoomAt((v.lo + v.hi) / 2, factor); };
  const resetView = () => { viewRef.current = null; };

  const xToHz = useCallback((clientX) => {
    const cvs = canvasRef.current; if (!cvs) return 0;
    const rect = cvs.getBoundingClientRect();
    const v = getView();
    return v.lo + ((clientX - rect.left) / rect.width) * (v.hi - v.lo);
  }, [getView]);

  // Native wheel listener (React's is passive, so preventDefault would not stop page scroll).
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return undefined;
    const onWheel = (e) => { e.preventDefault(); zoomAt(xToHz(e.clientX), e.deltaY > 0 ? 1.25 : 0.8); };
    cvs.addEventListener('wheel', onWheel, { passive: false });
    return () => cvs.removeEventListener('wheel', onWheel);
  }, [zoomAt, xToHz]);

  const onMouseDown = (e) => { dragRef.current = { x0: e.clientX, view: { ...getView() }, moved: false }; };
  const onMouseMove = (e) => {
    const d = dragRef.current; if (!d) return;
    const cvs = canvasRef.current; if (!cvs) return;
    const rect = cvs.getBoundingClientRect();
    const dx = e.clientX - d.x0;
    if (Math.abs(dx) > 4) d.moved = true;
    if (!d.moved) return;
    const span = d.view.hi - d.view.lo;
    const dHz = -(dx / rect.width) * span;
    setView(d.view.lo + dHz, d.view.hi + dHz);
  };
  const onMouseUp = (e) => {
    const d = dragRef.current; dragRef.current = null;
    if (!d || d.moved) return;
    const f = xToHz(e.clientX);
    if (rxModeRef.current === 'sweep') tuneAndListen(f);
    else if (isLiveRf) pickChannel(f);
  };
  const onDoubleClick = (e) => { if (rxModeRef.current === 'live') tuneTo(xToHz(e.clientX)); };

  // ---- render loop -------------------------------------------------------------------
  useEffect(() => {
    const cvs = canvasRef.current; if (!cvs) return undefined;
    const ctx = cvs.getContext('2d');
    let anim, lastSeq = -1, lastInfoTs = 0;
    const colStarts = new Float64Array(W + 1);

    const render = () => {
      const live = driver.connectionType === 'webusb';
      const mode = rxModeRef.current;
      const view = getView();
      const vlo = view.lo, vhi = view.hi, vspan = vhi - vlo;
      for (let x = 0; x <= W; x++) colStarts[x] = vlo + (x / W) * vspan;
      const now = performance.now();
      if (now - lastInfoTs > 200) {
        lastInfoTs = now;
        const base = baseRef.current;
        setViewInfo((p) => (p.lo === vlo && p.hi === vhi ? p : { lo: vlo, hi: vhi, zoomed: !!viewRef.current && !!base }));
      }

      // Ingest the newest live frame as a waterfall row.
      const f = liveFrameRef.current;
      let newRow = false;
      if (mode === 'live' && live && f && f.seq !== lastSeq) {
        lastSeq = f.seq;
        pushRow({ lo: f.centerHz - f.sampleRate / 2, hi: f.centerHz + f.sampleRate / 2, data: f.spec });
        newRow = true;
      }
      const sweep = sweepRef.current;
      const trace = mode === 'sweep'
        ? (sweep ? { lo: sweep.startHz, hi: sweep.endHz, data: sweep.cells } : null)
        : (live && f ? rowsRef.current[0] : null);
      const floor = mode === 'sweep' ? (sweep && sweep.floorDb != null ? sweep.floorDb : (f ? f.floorDb : -60)) : (f && f.floorDb != null ? f.floorDb : -60);
      const dbLo = floor - SPEC_FLOOR_PAD_DB, dbHi = floor + SPEC_RANGE_DB;
      const frac = (db) => (db - dbLo) / (dbHi - dbLo);

      // --- spectrum panel ---
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, W, SPEC_H);
      ctx.font = '10px monospace';
      ctx.lineWidth = 1;
      // dB grid
      const dbStep = 10;
      for (let db = Math.ceil(dbLo / dbStep) * dbStep; db <= dbHi; db += dbStep) {
        const y = Math.round(SPEC_H - frac(db) * SPEC_H) + 0.5;
        ctx.strokeStyle = '#111c2e'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillStyle = '#475569'; ctx.fillText(`${db} dBFS`, 4, y - 2);
      }
      // frequency ticks
      const step = niceStep(vspan);
      const dec = step >= 1e6 ? (step >= 10e6 ? 0 : 1) : step >= 1e5 ? 2 : step >= 1e4 ? 3 : step >= 1e3 ? 4 : 5;
      for (let fTick = Math.ceil(vlo / step) * step; fTick <= vhi; fTick += step) {
        const x = Math.round(((fTick - vlo) / vspan) * W) + 0.5;
        ctx.strokeStyle = '#1e293b'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        ctx.fillStyle = '#64748b';
        const label = `${(fTick / 1e6).toFixed(dec)}`;
        ctx.fillText(label, Math.min(W - 60, x + 3), SPEC_H - 4);
      }

      if (!live) {
        ctx.fillStyle = '#94a3b8'; ctx.font = '13px monospace';
        ctx.fillText(driver.connectionType === 'serial'
          ? 'The serial console has no IQ. Put the PortaPack in HackRF mode and click Connect WebUSB for the receiver.'
          : 'Connect a HackRF One (or a PortaPack in HackRF mode) over WebUSB to see the live spectrum.', 16, SPEC_H / 2);
        ctx.fillStyle = '#0b1120'; ctx.fillRect(0, SPEC_H, W, WF_H);
        anim = requestAnimationFrame(render);
        return;
      }

      // trace
      if (trace) {
        ctx.beginPath();
        let started = false;
        let peakV = -Infinity, peakX = 0;
        for (let x = 0; x < W; x++) {
          const v = sampleRow(trace, colStarts[x], colStarts[x + 1]);
          if (!Number.isFinite(v)) { started = false; continue; }
          const y = SPEC_H - 2 - Math.max(0, Math.min(1, frac(v))) * (SPEC_H - 14);
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
          if (v > peakV) { peakV = v; peakX = x; }
        }
        ctx.strokeStyle = mode === 'sweep' ? '#22d3ee' : traceColorRef.current;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        if (Number.isFinite(peakV)) {
          ctx.fillStyle = '#64748b';
          ctx.fillText(`peak ${peakV.toFixed(0)} dBFS @ ${fmtMHz(colStarts[peakX], vspan)}   floor ${floor.toFixed(0)} dBFS`, W - 330, 12);
        }
      } else {
        ctx.fillStyle = '#94a3b8'; ctx.font = '12px monospace';
        ctx.fillText(mode === 'sweep' ? 'Press START SWEEP to scan the band.' : 'Waiting for IQ from the HackRF…', 16, SPEC_H / 2);
      }

      if (mode === 'live') {
        // LO centre and the listening channel.
        const c = driver.frequency;
        const xC = ((c - vlo) / vspan) * W;
        if (xC >= 0 && xC <= W) {
          ctx.strokeStyle = 'rgba(148,163,184,0.35)'; ctx.setLineDash([3, 3]);
          ctx.beginPath(); ctx.moveTo(xC + 0.5, 0); ctx.lineTo(xC + 0.5, H); ctx.stroke(); ctx.setLineDash([]);
        }
        const lf = c + driver.channelOffsetHz;
        const bw = MODE_BANDWIDTH_HZ[driver.audioMode] || 12500;
        const x0 = ((lf - bw / 2 - vlo) / vspan) * W, x1 = ((lf + bw / 2 - vlo) / vspan) * W;
        if (x1 >= 0 && x0 <= W) {
          ctx.fillStyle = audioOnRef.current ? 'rgba(168,85,247,0.22)' : 'rgba(168,85,247,0.12)';
          ctx.fillRect(Math.max(0, x0), 0, Math.max(1.5, Math.min(W, x1) - Math.max(0, x0)), SPEC_H);
          const xm = ((lf - vlo) / vspan) * W;
          ctx.strokeStyle = '#c084fc'; ctx.beginPath(); ctx.moveTo(xm + 0.5, 0); ctx.lineTo(xm + 0.5, SPEC_H); ctx.stroke();
          ctx.fillStyle = '#c084fc'; ctx.font = 'bold 10px monospace';
          ctx.fillText(`${fmtMHz(lf, vspan)} ${driver.audioMode}`, Math.min(W - 120, Math.max(2, xm + 4)), 24);
          ctx.font = '10px monospace';
        }
        const sql = squelchRef.current;
        if (sql > -150) {
          const y = Math.round(SPEC_H - Math.max(0, Math.min(1, frac(sql))) * SPEC_H) + 0.5;
          ctx.strokeStyle = '#f59e0b'; ctx.setLineDash([4, 4]);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = '#f59e0b'; ctx.fillText(`SQL ${sql} dBFS`, W - 100, y - 3);
        }
      } else if (sweep) {
        const y = Math.round(SPEC_H - Math.max(0, Math.min(1, frac(thresholdRef.current))) * SPEC_H) + 0.5;
        ctx.strokeStyle = 'rgba(239,68,68,0.6)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#ef4444'; ctx.fillText(`THRESHOLD ${thresholdRef.current} dBFS`, W - 150, y - 3);
        const xc = ((sweep.cursorHz - vlo) / vspan) * W;
        if (xc >= 0 && xc <= W) { ctx.fillStyle = 'rgba(34,211,238,0.5)'; ctx.fillRect(xc - 1, 0, 2, SPEC_H); }
        ctx.fillStyle = '#f87171';
        for (const p of peaksRef.current) {
          const x = ((p.freqHz - vlo) / vspan) * W;
          if (x < 0 || x > W) continue;
          ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.closePath(); ctx.fill();
        }
      }

      // --- waterfall ---
      const rows = rowsRef.current;
      const LUT = lutRef.current;
      const wfKey = `${vlo}:${vhi}:${rowsVerRef.current}:${Math.round(floor * 2)}:${themeIdRef.current}`;
      const cache = wfCacheRef.current;
      if (!cache.img || cache.key !== wfKey || newRow) {
        const img = cache.img && cache.img.width === W ? cache.img : ctx.createImageData(W, WF_H);
        const px = img.data;
        px.fill(0);
        const mapCache = new Map();
        const scale = 255 / (dbHi - dbLo);
        for (let r = 0; r < rows.length && r < WF_H; r++) {
          const row = rows[r];
          const mk = `${row.lo}:${row.hi}:${row.data.length}`;
          let map = mapCache.get(mk);
          if (!map) {
            // Per column: [b0, b1) bin range in this row (b1 <= b0 means empty).
            map = new Int32Array(W * 2);
            const N = row.data.length, k = N / (row.hi - row.lo);
            for (let x = 0; x < W; x++) {
              const f0 = colStarts[x], f1 = colStarts[x + 1];
              if (f1 <= row.lo || f0 >= row.hi) { map[2 * x] = 0; map[2 * x + 1] = 0; continue; }
              let b0 = Math.floor((f0 - row.lo) * k), b1 = Math.ceil((f1 - row.lo) * k);
              if (b0 < 0) b0 = 0; if (b1 > N) b1 = N; if (b1 <= b0) b1 = Math.min(N, b0 + 1);
              map[2 * x] = b0; map[2 * x + 1] = b1;
            }
            mapCache.set(mk, map);
          }
          const data = row.data;
          let o = r * W * 4;
          for (let x = 0; x < W; x++, o += 4) {
            const b0 = map[2 * x], b1 = map[2 * x + 1];
            if (b1 <= b0) { px[o + 3] = 255; px[o] = 6; px[o + 1] = 8; px[o + 2] = 19; continue; }
            let m = -Infinity;
            for (let b = b0; b < b1; b++) if (data[b] > m) m = data[b];
            if (!Number.isFinite(m)) { px[o + 3] = 255; px[o] = 6; px[o + 1] = 8; px[o + 2] = 19; continue; }
            let v = ((m - dbLo) * scale) | 0;
            if (v < 0) v = 0; else if (v > 255) v = 255;
            px[o] = LUT[v * 3]; px[o + 1] = LUT[v * 3 + 1]; px[o + 2] = LUT[v * 3 + 2]; px[o + 3] = 255;
          }
        }
        // Rows not yet filled: dark.
        for (let o = rows.length * W * 4; o < px.length; o += 4) { px[o] = 6; px[o + 1] = 8; px[o + 2] = 19; px[o + 3] = 255; }
        cache.img = img; cache.key = wfKey;
      }
      ctx.putImageData(cache.img, 0, SPEC_H);

      anim = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(anim);
  }, [driver, getView]);

  // ---- UI ----------------------------------------------------------------------------
  const listeningHz = state.frequency + (state.channelOffsetHz || 0);
  const vspan = viewInfo.hi - viewInfo.lo;
  const chip = (active, extra = '') => `px-2 py-0.5 rounded transition ${active ? 'bg-purple-600 text-white font-bold' : 'text-slate-400 hover:text-slate-200'} ${extra}`;

  return (
    <div className="space-y-3 font-mono text-xs">
      {/* Tuner bar */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 space-y-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Radio className="w-4 h-4 text-purple-400" />
            <span className="font-bold text-slate-200">LO</span>
            <input
              type="text" value={freqInput} onChange={(e) => setFreqInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { const m = parseFloat(freqInput); if (!isNaN(m)) tuneTo(m * 1e6); } }}
              className="w-28 bg-slate-900 border border-slate-700 text-cyan-300 px-2 py-1 rounded text-sm focus:outline-none focus:border-cyan-500"
              title="Centre frequency in MHz (Enter to tune)"
            />
            <span className="text-slate-500">MHz</span>
            <button onClick={() => { const m = parseFloat(freqInput); if (!isNaN(m)) tuneTo(m * 1e6); }}
              className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold rounded">TUNE</button>
            <button onClick={() => tuneTo(state.frequency - stepHz)} className="px-2 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded hover:bg-slate-700" title="Step down">−</button>
            <select value={stepHz} onChange={(e) => setStepHz(parseInt(e.target.value, 10))} className="bg-slate-900 border border-slate-700 text-slate-300 rounded px-1 py-1">
              {TUNE_STEPS.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
            <button onClick={() => tuneTo(state.frequency + stepHz)} className="px-2 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded hover:bg-slate-700" title="Step up">+</button>
          </div>

          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-slate-400">SPAN</span>
            <select value={state.sampleRate} onChange={(e) => driver.setSampleRate(parseInt(e.target.value, 10))}
              className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1" title="HackRF sample rate = visible bandwidth">
              {HACKRF_SAMPLE_RATES.map((r) => <option key={r} value={r}>{r / 1e6} MHz</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-500 text-[10px] uppercase font-bold mr-1">Quick:</span>
          {QUICK_FREQS.map((q) => (
            <button key={q.hz} onClick={() => tuneTo(q.hz, q.mode)}
              className={`px-2 py-0.5 rounded border text-[11px] ${state.frequency === q.hz ? 'bg-purple-600/30 border-purple-500/50 text-purple-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}`}>
              {q.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1 border-t border-slate-800/80">
          <label className="block">
            <span className="flex justify-between text-slate-400 mb-0.5"><span>LNA (RF)</span><span className="text-emerald-400 font-bold">{state.lnaGain} dB</span></span>
            <input type="range" min="0" max="40" step="8" value={state.lnaGain} disabled={!isLiveRf || state.agcEnabled}
              onChange={(e) => driver.sendCommand(`lna ${e.target.value}`)} className="w-full accent-emerald-500 disabled:opacity-40" />
          </label>
          <label className="block">
            <span className="flex justify-between text-slate-400 mb-0.5"><span>VGA (baseband)</span><span className="text-cyan-400 font-bold">{state.vgaGain} dB</span></span>
            <input type="range" min="0" max="62" step="2" value={state.vgaGain} disabled={!isLiveRf || state.agcEnabled}
              onChange={(e) => driver.sendCommand(`vga ${e.target.value}`)} className="w-full accent-cyan-500 disabled:opacity-40" />
          </label>
          <div className="flex items-end gap-2">
            <button onClick={() => driver.sendCommand(`amp ${state.amp > 0 ? '0' : '1'}`)} disabled={!isLiveRf}
              className={`flex-1 py-1 rounded border font-bold disabled:opacity-40 ${state.amp > 0 ? 'bg-rose-600/30 border-rose-500 text-rose-200' : 'bg-slate-900 border-slate-700 text-slate-400'}`}
              title="RF front-end amplifier (+14 dB). Keep off on strong signals.">
              AMP {state.amp > 0 ? '+14 dB' : 'OFF'}
            </button>
            <button onClick={() => driver.setAgc(!state.agcEnabled)} disabled={!isLiveRf}
              className={`flex-1 py-1 rounded border font-bold flex items-center justify-center gap-1 disabled:opacity-40 ${state.agcEnabled ? 'bg-emerald-600 border-emerald-500 text-white' : 'bg-slate-900 border-slate-700 text-slate-400'}`}
              title="Automatic gain: holds the IQ RMS between 7 and 22 ADC counts (VGA first, then LNA)">
              <Activity className="w-3.5 h-3.5" /> AGC
            </button>
          </div>
          <div className="text-[11px] text-slate-400 flex flex-col justify-end">
            <span>Listening: <span className="text-purple-300 font-bold">{(listeningHz / 1e6).toFixed(4)} MHz</span>
              {state.channelOffsetHz ? <span className="text-slate-500"> ({state.channelOffsetHz > 0 ? '+' : ''}{(state.channelOffsetHz / 1e3).toFixed(1)} kHz)</span> : null}
              {state.channelOffsetHz ? <button onClick={() => tuneTo(listeningHz)} className="ml-1.5 px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-300 hover:text-white" title="Move the LO onto the channel"><Crosshair className="w-3 h-3 inline" /> centre</button> : null}
            </span>
            <span>{state.boardId || 'HackRF'}{state.firmwareVersion && isLiveRf ? ` · ${state.firmwareVersion}` : ''}{isLiveRf ? ` · level ${state.rssi} dBFS` : ''}</span>
          </div>
        </div>
      </div>

      {/* Mode + display toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center bg-slate-900 border border-slate-700 rounded p-0.5">
          <button onClick={() => setRxMode('live')} className={chip(rxMode === 'live', 'flex items-center gap-1')}><Flame className="w-3.5 h-3.5" /> LIVE {fmtSpan(state.sampleRate)}</button>
          <button onClick={() => { setRxMode('sweep'); setSweepRunning(true); }} className={chip(rxMode === 'sweep', 'flex items-center gap-1')}><Scan className="w-3.5 h-3.5" /> SWEEP (Looking Glass)</button>
        </div>
        {rxMode === 'sweep' && (
          <>
            <select value={preset.name} onChange={(e) => { setPreset(SWEEP_PRESETS.find((p) => p.name === e.target.value) || SWEEP_PRESETS[0]); setCustomStart(''); setCustomEnd(''); }}
              className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1">
              {SWEEP_PRESETS.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <input type="text" placeholder="start MHz" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-24 bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1" />
            <input type="text" placeholder="end MHz" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-24 bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1" />
            <button onClick={() => setSweepRunning((v) => !v)} disabled={!isLiveRf}
              className={`px-3 py-1 rounded font-bold flex items-center gap-1 disabled:opacity-40 ${sweepRunning ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'}`}>
              {sweepRunning ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />} {sweepRunning ? 'PAUSE' : 'START SWEEP'}
            </button>
            <label className="flex items-center gap-1 text-rose-300">THRESHOLD
              <input type="range" min="-90" max="-10" value={thresholdDb} onChange={(e) => setThresholdDb(parseInt(e.target.value, 10))} className="w-24 accent-rose-500" />
              <span className="w-14">{thresholdDb} dB</span>
            </label>
            <span className="text-slate-500">pass {sweepPass} · {fmtSpan(state.sampleRate * 0.6)} per hop</span>
          </>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <label className="flex items-center gap-1.5 mr-2" title="Waterfall colour theme">
            <span className="inline-block w-10 h-3 rounded border border-slate-700" style={{ background: themeGradient(themeId) }} />
            <select value={themeId} onChange={(e) => setThemeId(e.target.value)} className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1">
              {WATERFALL_THEMES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <span className="text-slate-500">{fmtMHz(viewInfo.lo, vspan)} – {fmtMHz(viewInfo.hi, vspan)} ({fmtSpan(vspan || 0)})</span>
          <button onClick={() => zoomCenter(0.5)} className="p-1 bg-slate-800 border border-slate-700 rounded text-slate-300 hover:text-white" title="Zoom in (or mouse wheel on the display)"><ZoomIn className="w-3.5 h-3.5" /></button>
          <button onClick={() => zoomCenter(2)} className="p-1 bg-slate-800 border border-slate-700 rounded text-slate-300 hover:text-white" title="Zoom out"><ZoomOut className="w-3.5 h-3.5" /></button>
          <button onClick={resetView} className={`p-1 border rounded hover:text-white ${viewInfo.zoomed ? 'bg-purple-600/30 border-purple-500/50 text-purple-200' : 'bg-slate-800 border-slate-700 text-slate-300'}`} title="Fit the whole span"><Maximize2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      {/* Display */}
      <div className="relative bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl">
        <canvas
          ref={canvasRef} width={W} height={H} className="w-full block select-none"
          style={{ cursor: dragRef.current ? 'grabbing' : 'crosshair', aspectRatio: `${W} / ${H}` }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={() => { dragRef.current = null; }}
          onDoubleClick={onDoubleClick}
        />
        <div className="absolute bottom-1 right-2 text-[10px] text-slate-500 pointer-events-none">
          wheel: zoom · drag: pan · click: {rxMode === 'sweep' ? 'tune & listen' : 'pick channel'} · double-click: centre LO
        </div>
      </div>

      {/* Audio row */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={() => setAudioOn(!audioOn)} disabled={!isLiveRf}
            title={isLiveRf ? 'Demodulate the channel to audio through your speakers' : 'Connect over WebUSB (HackRF mode) to listen'}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-bold transition disabled:opacity-40 ${audioOn ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-emerald-300 border border-emerald-500/40'}`}>
            <Headphones className="w-3.5 h-3.5" /> {audioOn ? 'LISTENING' : 'LISTEN'}
          </button>
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded p-0.5">
            {['WFM', 'NFM', 'AM', 'USB', 'LSB'].map((m) => (
              <button key={m} onClick={() => setAudioMode(m)} className={chip(audioMode === m)}>{m}</button>
            ))}
          </div>
          <span className="text-slate-500 text-[11px]">{fmtSpan(MODE_BANDWIDTH_HZ[audioMode])} channel</span>
          <span className="w-px h-5 bg-slate-800 mx-1" />
          <RecordControls driver={driver} state={state} compact />
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-slate-300" title="Channel power vs. the squelch">
            <span className={`w-2 h-2 rounded-full ${audioOn ? (squelchOpen ? 'bg-emerald-400' : 'bg-slate-600') : 'bg-slate-700'}`} />
            <div className="w-24 h-1.5 bg-slate-800 rounded overflow-hidden">
              <div className={`h-full ${squelchOpen ? 'bg-emerald-500' : 'bg-slate-500'}`} style={{ width: `${channelDb == null ? 0 : Math.max(0, Math.min(100, ((channelDb + 100) / 100) * 100))}%` }} />
            </div>
            <span className="w-16 text-right text-[11px]">{channelDb == null ? '—' : `${channelDb.toFixed(0)} dBFS`}</span>
          </div>
          <label className="flex items-center gap-1.5 text-amber-300">SQL
            <input type="range" min="-100" max="-10" value={Math.max(-100, squelchDb)} onChange={(e) => setSquelchDb(parseInt(e.target.value, 10) <= -100 ? -200 : parseInt(e.target.value, 10))} className="w-20 accent-amber-500" />
            <span className="w-14 text-right">{squelchDb <= -100 ? 'open' : `${squelchDb} dB`}</span>
          </label>
          <label className="flex items-center gap-1.5 text-cyan-300"><Volume2 className="w-3.5 h-3.5" />
            <input type="range" min="0" max="100" value={volume} onChange={(e) => setVolume(parseInt(e.target.value, 10))} className="w-16 accent-cyan-500" />
            <span className="w-8 text-right">{volume}%</span>
          </label>
        </div>
      </div>

      <CaptureResultStrip driver={driver} state={state} />

      {/* Sweep peaks */}
      {rxMode === 'sweep' && (
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between text-slate-400 pb-1 border-b border-slate-800">
            <span className="font-bold text-slate-200 flex items-center gap-2"><Sliders className="w-3.5 h-3.5" /> PEAKS ABOVE THRESHOLD ({peaks.length})</span>
            <span className="text-[10px] text-slate-500">{band.name}: {(band.startHz / 1e6).toFixed(1)} – {(band.endHz / 1e6).toFixed(1)} MHz · from the last complete pass</span>
          </div>
          {peaks.length === 0 ? (
            <div className="text-slate-500 text-[11px] py-2">{sweepPass === 0 ? 'Waiting for the first pass…' : 'Nothing above the threshold. Lower it, or widen the span for a faster pass.'}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto">
              {peaks.map((p) => (
                <div key={p.id} className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 hover:border-purple-500/30 flex items-center justify-between gap-2">
                  <span className="font-bold text-purple-300">{(p.freqHz / 1e6).toFixed(4)} MHz</span>
                  <span className="text-slate-400">{p.powerDb} dBFS</span>
                  <button onClick={() => tuneAndListen(p.freqHz)} className="px-2 py-0.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded flex items-center gap-1">
                    <ArrowUpRight className="w-3 h-3" /> Tune & Listen
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
