import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, Play, Square, Volume2, VolumeX, Download, Plane, Usb, Circle } from 'lucide-react';
import { DspCore, SPEC_RANGE_DB, SPEC_FLOOR_PAD_DB } from '../../utils/hackrfDsp.js';
import {
  RtlSdrReceiver, RtlSdrWebUsb, isWebUsbAvailable, isValidSampleRate,
  u8ToInt8, IqRecorder, cu8FileName,
} from '../../utils/rtlSdr.js';

const SAMPLE_RATES = [1024000, 1200000, 2048000, 2400000, 2560000, 3200000];
const ADSB_FREQ_HZ = 1090000000;
const ADSB_RATE_HZ = 2000000;
const MODES = [
  { id: 'WFM', label: 'WFM', hint: 'Broadcast FM, 75 us de-emphasis' },
  { id: 'NFM', label: 'NFM', hint: 'Narrow FM (voice radio)' },
  { id: 'AM', label: 'AM', hint: 'Amplitude modulation' },
  { id: 'ADSB', label: 'ADS-B 1090', hint: 'Mode-S 1090 MHz, decodes aircraft (2 MS/s)' },
];
const LOG_TAG = 'rtl-sdr';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

// Blue -> yellow -> white colour map for the waterfall (256 entries, RGB).
const LUT = (() => {
  const out = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    out[i * 3] = 255 * clamp01(1.6 * t - 0.2);
    out[i * 3 + 1] = 255 * clamp01(1.8 * t - 0.5);
    out[i * 3 + 2] = 255 * clamp01(1.2 - 1.3 * t + 0.3 * Math.sin(t * 3));
  }
  return out;
})();

const dbToT = (db, floorDb) => {
  const base = (floorDb ?? -100) - SPEC_FLOOR_PAD_DB;
  return clamp01((db - base) / SPEC_RANGE_DB);
};

function formatMHz(hz) {
  return `${(hz / 1e6).toFixed(3)} MHz`;
}

function explainUsbError(err) {
  const msg = String(err?.message || err);
  if (/claim|access|NotAllowed|NetworkError|in use|open/i.test(msg) || err?.name === 'NetworkError') {
    return `${msg}. On Windows the dongle needs the WinUSB driver: run Zadig, pick the RTL2832U device and install WinUSB, then reconnect.`;
  }
  return msg;
}

export default function RtlSdrWorkbench({ onLogMessage }) {
  const log = useCallback((text, level = 'info') => {
    if (typeof onLogMessage === 'function') onLogMessage(`[${LOG_TAG}] ${text}`, level);
  }, [onLogMessage]);

  const [status, setStatus] = useState('idle');        // idle | connecting | ready | error
  const [error, setError] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [tunerProbe, setTunerProbe] = useState(null);
  const [freqMHz, setFreqMHz] = useState('100.000');
  const [centerHz, setCenterHz] = useState(0);
  const [sampleRate, setSampleRate] = useState(2048000);
  const [gainDb, setGainDb] = useState(30);
  const [tunerAuto, setTunerAuto] = useState(true);
  const [rtlAgc, setRtlAgc] = useState(false);
  const [ppm, setPpm] = useState('0');
  const [mode, setMode] = useState('WFM');
  const [volume, setVolume] = useState(0.6);
  const [squelchDb, setSquelchDb] = useState(-120);
  const [audioOn, setAudioOn] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordInfo, setRecordInfo] = useState(null);
  const [stats, setStats] = useState({ mbps: 0, bytes: 0, peakDb: null, floorDb: null, squelchOpen: null });
  const [aircraft, setAircraft] = useState([]);
  const [adsbFrames, setAdsbFrames] = useState(0);

  const receiverRef = useRef(null);
  const dspRef = useRef(null);
  const adsbRef = useRef(null);
  const recorderRef = useRef(null);
  const specCanvasRef = useRef(null);
  const wfCanvasRef = useRef(null);
  const audioCtxRef = useRef(null);
  const gainNodeRef = useRef(null);
  const nextAudioTimeRef = useRef(0);
  const liveRef = useRef({ bytes: 0, t0: 0, peakDb: null, floorDb: null, squelchOpen: null, frames: 0 });
  const modeRef = useRef(mode);
  const audioOnRef = useRef(audioOn);
  const sampleRateRef = useRef(sampleRate);
  const centerRef = useRef(0);
  const volumeRef = useRef(volume);
  modeRef.current = mode;
  audioOnRef.current = audioOn;
  sampleRateRef.current = sampleRate;
  centerRef.current = centerHz;
  volumeRef.current = volume;

  // ---- spectrum and waterfall drawing ----

  const drawSpectrum = useCallback((spec, floorDb) => {
    const canvas = specCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = '#05070b';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(148,163,184,0.15)';
    for (let g = 1; g < 4; g++) {
      ctx.beginPath(); ctx.moveTo(0, (h * g) / 4); ctx.lineTo(w, (h * g) / 4); ctx.stroke();
    }
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const b = Math.min(spec.length - 1, Math.floor((x * spec.length) / w));
      const y = h - dbToT(spec[b], floorDb) * h;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }, []);

  const drawWaterfallRow = useCallback((spec, floorDb) => {
    const canvas = wfCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    ctx.drawImage(canvas, 0, 0, w, h - 1, 0, 1, w, h - 1);
    const row = ctx.createImageData(w, 1);
    for (let x = 0; x < w; x++) {
      const b = Math.min(spec.length - 1, Math.floor((x * spec.length) / w));
      const idx = Math.round(dbToT(spec[b], floorDb) * 255);
      row.data[x * 4] = LUT[idx * 3];
      row.data[x * 4 + 1] = LUT[idx * 3 + 1];
      row.data[x * 4 + 2] = LUT[idx * 3 + 2];
      row.data[x * 4 + 3] = 255;
    }
    ctx.putImageData(row, 0, 0);
  }, []);

  // ---- audio ----

  const playAudio = useCallback((samples, rate) => {
    const ctx = audioCtxRef.current;
    if (!ctx || ctx.state !== 'running') return;
    const buf = ctx.createBuffer(1, samples.length, rate);
    buf.copyToChannel(samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gainNodeRef.current);
    const now = ctx.currentTime;
    if (nextAudioTimeRef.current < now + 0.05 || nextAudioTimeRef.current > now + 0.5) {
      nextAudioTimeRef.current = now + 0.1;   // underrun or runaway queue: resync
    }
    src.start(nextAudioTimeRef.current);
    nextAudioTimeRef.current += buf.duration;
  }, []);

  // ---- per-chunk processing ----

  const handleChunk = useCallback((u8) => {
    const live = liveRef.current;
    live.bytes += u8.length;
    if (recorderRef.current) recorderRef.current.push(u8);
    const i8 = u8ToInt8(u8);
    const dsp = dspRef.current;
    if (dsp) {
      const out = dsp.process(i8);
      if (out.spectrum) {
        const { spec, peakDb, floorDb } = out.spectrum;
        live.peakDb = peakDb;
        live.floorDb = floorDb;
        drawSpectrum(spec, floorDb);
        drawWaterfallRow(spec, floorDb);
      }
      if (out.audio) {
        live.squelchOpen = out.audio.open;
        if (out.audio.open && audioOnRef.current) playAudio(out.audio.samples, out.audio.rate);
      }
    }
    if (adsbRef.current && modeRef.current === 'ADSB') {
      adsbRef.current.processRawIq(i8.buffer);
      live.frames = adsbRef.current.totalFramesDecoded;
    }
  }, [drawSpectrum, drawWaterfallRow, playAudio]);

  // ---- live stats (throttled to 2 Hz) ----

  useEffect(() => {
    if (!streaming) return undefined;
    liveRef.current = { ...liveRef.current, bytes: 0, t0: performance.now() };
    const timer = setInterval(() => {
      const live = liveRef.current;
      const dt = (performance.now() - live.t0) / 1000;
      setStats({
        mbps: dt > 0 ? live.bytes / dt / 1e6 : 0,
        bytes: live.bytes,
        peakDb: live.peakDb,
        floorDb: live.floorDb,
        squelchOpen: live.squelchOpen,
      });
      setAdsbFrames(live.frames);
      setAircraft(adsbRef.current && modeRef.current === 'ADSB' ? adsbRef.current.getAircraftList().slice(0, 40) : []);
      live.bytes = 0;
      live.t0 = performance.now();
    }, 500);
    return () => clearInterval(timer);
  }, [streaming]);

  // ---- device lifecycle ----

  const connect = useCallback(async () => {
    setError('');
    if (!isWebUsbAvailable()) {
      setError('WebUSB is not available here. Use Chrome, Edge or Opera on https or localhost.');
      setStatus('error');
      return;
    }
    setStatus('connecting');
    try {
      const usb = await RtlSdrWebUsb.requestDevice();
      const rx = new RtlSdrReceiver(usb);
      rx.ppm = Number(ppm) || 0;
      await rx.open();
      receiverRef.current = rx;
      setDeviceName(usb.productName);
      setTunerProbe(rx.tunerProbe);
      await rx.setSampleRate(sampleRate);
      const hz = Math.round(parseFloat(freqMHz) * 1e6);
      await rx.tune(hz);
      await rx.setGain(tunerAuto ? null : Math.round(gainDb * 10));
      await rx.setRtlAgc(rtlAgc);
      setCenterHz(rx.centerHz);
      setStatus('ready');
      log(`Connected to ${usb.productName}; tuned ${formatMHz(rx.centerHz)} at ${sampleRate} S/s.`);
    } catch (e) {
      const msg = explainUsbError(e);
      receiverRef.current = null;
      setError(msg);
      setStatus('error');
      log(`Connect failed: ${msg}`, 'error');
    }
  }, [ppm, freqMHz, sampleRate, tunerAuto, gainDb, rtlAgc, log]);

  const disconnect = useCallback(async () => {
    const rx = receiverRef.current;
    receiverRef.current = null;
    dspRef.current = null;
    if (rx) await rx.close();
    setStreaming(false);
    setStatus('idle');
    setDeviceName('');
    setTunerProbe(null);
    setCenterHz(0);
    log('Disconnected.');
  }, [log]);

  useEffect(() => () => {
    const rx = receiverRef.current;
    receiverRef.current = null;
    if (rx) rx.close().catch(() => {});
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
  }, []);

  // ---- actions ----

  const tuneTo = useCallback(async (hz) => {
    const rx = receiverRef.current;
    if (!rx) return;
    try {
      await rx.tune(hz);
      setCenterHz(rx.centerHz);
      setFreqMHz((rx.centerHz / 1e6).toFixed(3));
      log(`Tuned to ${formatMHz(rx.centerHz)}.`);
    } catch (e) {
      setError(explainUsbError(e));
      log(`Tune failed: ${e.message}`, 'error');
    }
  }, [log]);

  const onTuneSubmit = (e) => {
    e.preventDefault();
    const mhz = parseFloat(freqMHz);
    if (!Number.isFinite(mhz) || mhz < 24 || mhz > 1766) {
      setError('Enter a frequency between 24 and 1766 MHz.');
      return;
    }
    tuneTo(Math.round(mhz * 1e6));
  };

  const onSpectrumClick = (e) => {
    const canvas = specCanvasRef.current;
    const rx = receiverRef.current;
    if (!canvas || !rx || !rx.centerHz) return;
    const rect = canvas.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    const sr = sampleRateRef.current;
    const hz = Math.round((rx.centerHz - sr / 2 + frac * sr) / 1000) * 1000;
    setFreqMHz((hz / 1e6).toFixed(3));
    tuneTo(hz);
  };

  const applySampleRate = async (rate) => {
    setSampleRate(rate);
    const rx = receiverRef.current;
    if (rx) {
      try { await rx.setSampleRate(rate); } catch (e) { setError(e.message); }
    }
  };

  const applyGain = async (auto, db) => {
    const rx = receiverRef.current;
    if (!rx) return;
    try { await rx.setGain(auto ? null : Math.round(db * 10)); } catch (e) { setError(e.message); }
  };

  const applyPpm = async () => {
    const rx = receiverRef.current;
    const v = Number(ppm);
    if (!Number.isFinite(v) || Math.abs(v) > 200) { setError('PPM must be between -200 and 200.'); return; }
    if (!rx) return;
    try {
      await rx.applyCorrection(v);
      setCenterHz(rx.centerHz);
      log(`Frequency correction set to ${v} ppm.`);
    } catch (e) { setError(e.message); }
  };

  const startAudio = async () => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        gainNodeRef.current = audioCtxRef.current.createGain();
        gainNodeRef.current.connect(audioCtxRef.current.destination);
      }
      await audioCtxRef.current.resume();
      gainNodeRef.current.gain.value = volumeRef.current;
      nextAudioTimeRef.current = 0;
      setAudioOn(true);
    } catch (e) {
      setError(`Audio unavailable: ${e.message}`);
    }
  };

  const stopAudio = () => {
    setAudioOn(false);
    if (audioCtxRef.current) audioCtxRef.current.suspend().catch(() => {});
  };

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = volume;
  }, [volume]);

  // Rebuild the DSP chain when the mode, rate or audio state changes.
  useEffect(() => {
    if (!dspRef.current) return;
    const isAdsb = mode === 'ADSB';
    dspRef.current.configure({
      sampleRate,
      mode: isAdsb ? 'WFM' : mode,
      audioOn: audioOn && !isAdsb,
      squelchDb,
      fftN: 4096,
      bins: 1024,
    });
  }, [mode, sampleRate, audioOn, squelchDb]);

  const selectMode = async (next) => {
    setMode(next);
    const rx = receiverRef.current;
    if (next === 'ADSB') {
      if (!adsbRef.current) {
        // Imported lazily: the module creates a global decoder that asks for geolocation on load.
        const { AdsbDecoder } = await import('../../utils/adsbDecoder.js');
        adsbRef.current = new AdsbDecoder();
      }
      if (rx) {
        try {
          await rx.setSampleRate(ADSB_RATE_HZ);
          await tuneTo(ADSB_FREQ_HZ);
        } catch (e) { setError(e.message); }
      }
      setSampleRate(ADSB_RATE_HZ);
      setFreqMHz('1090.000');
    } else if (rx && modeRef.current === 'ADSB') {
      setSampleRate(2048000);
      try { await rx.setSampleRate(2048000); } catch (e) { setError(e.message); }
    }
  };

  const startStreaming = () => {
    const rx = receiverRef.current;
    if (!rx || streaming) return;
    setError('');
    dspRef.current = new DspCore({
      sampleRate: sampleRateRef.current,
      mode: modeRef.current === 'ADSB' ? 'WFM' : modeRef.current,
      audioOn: audioOnRef.current && modeRef.current !== 'ADSB',
      squelchDb,
      fftN: 4096,
      bins: 1024,
    });
    setStreaming(true);
    log('Streaming started.');
    rx.startStreaming(handleChunk)
      .catch((e) => { setError(explainUsbError(e)); log(`Stream stopped: ${e.message}`, 'error'); })
      .finally(() => {
        setStreaming(false);
        setRecording(false);
      });
  };

  const stopStreaming = () => {
    const rx = receiverRef.current;
    if (rx) rx.stopStreaming();
    setStreaming(false);
    log('Streaming stopped.');
  };

  const toggleRecord = () => {
    if (recording) {
      const rec = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (rec && rec.bytes) {
        const blob = rec.toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = cu8FileName(centerRef.current, sampleRateRef.current);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setRecordInfo({ bytes: rec.bytes, truncated: rec.truncated, name: a.download });
        log(`Saved ${rec.bytes} bytes of cu8${rec.truncated ? ' (capped)' : ''}.`);
      }
      return;
    }
    recorderRef.current = new IqRecorder();
    setRecordInfo(null);
    setRecording(true);
  };

  const sampleOk = isValidSampleRate(sampleRate);
  const ready = status === 'ready';

  return (
    <div className="flex flex-col gap-3 p-3 text-slate-200 bg-slate-950 min-h-full font-mono text-xs">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border border-slate-800 rounded-md p-3 bg-slate-900/60">
        <Radio className="w-5 h-5 text-cyan-400" />
        <div className="flex-1 min-w-[220px]">
          <div className="text-sm font-semibold text-slate-100">RTL-SDR Receiver</div>
          <div className="text-slate-400">
            RTL2832U + Rafael R820T/R828D over WebUSB. Spectrum, waterfall, WFM/NFM/AM audio, ADS-B 1090 and .cu8 recording.
            On Windows, install the WinUSB driver for the dongle with Zadig first (the default driver blocks WebUSB).
          </div>
        </div>
        <span className={`px-2 py-0.5 rounded border ${status === 'ready' ? 'border-emerald-500 text-emerald-300' : status === 'error' ? 'border-rose-500 text-rose-300' : 'border-slate-700 text-slate-400'}`}>
          {status === 'ready' ? `CONNECTED: ${deviceName}` : status === 'connecting' ? 'CONNECTING' : status === 'error' ? 'ERROR' : 'NOT CONNECTED'}
        </span>
        {status !== 'ready' ? (
          <button type="button" onClick={connect} disabled={status === 'connecting'}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50">
            <Usb className="w-3.5 h-3.5" /> CONNECT RTL-SDR (WEBUSB)
          </button>
        ) : (
          <button type="button" onClick={disconnect} className="px-3 py-1.5 rounded border border-slate-700 hover:border-rose-500">
            DISCONNECT
          </button>
        )}
      </div>

      {error && (
        <div className="border border-rose-700 bg-rose-950/40 text-rose-200 rounded p-2 break-words">{error}</div>
      )}

      {!isWebUsbAvailable() && (
        <div className="border border-amber-700 bg-amber-950/30 text-amber-200 rounded p-2">
          WebUSB is not available in this browser. Use Chrome, Edge or Opera.
        </div>
      )}

      {/* Tuning and receiver controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <form onSubmit={onTuneSubmit} className="border border-slate-800 rounded-md p-3 bg-slate-900/40 flex flex-col gap-2">
          <div className="text-slate-400 uppercase tracking-wide">Tuning</div>
          <div className="flex gap-2 items-center">
            <input value={freqMHz} onChange={(e) => setFreqMHz(e.target.value)} disabled={!ready}
              className="w-32 bg-slate-950 border border-slate-700 rounded px-2 py-1" aria-label="Frequency in MHz" />
            <span className="text-slate-400">MHz</span>
            <button type="submit" disabled={!ready} className="px-2 py-1 rounded border border-slate-700 hover:border-cyan-500 disabled:opacity-40">TUNE</button>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Mode</span>
            {MODES.map((m) => (
              <button key={m.id} type="button" title={m.hint} disabled={!ready && m.id !== mode}
                onClick={() => selectMode(m.id)}
                className={`px-2 py-1 rounded border ${mode === m.id ? 'border-cyan-500 text-cyan-300' : 'border-slate-700 text-slate-300'} disabled:opacity-40`}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Sample rate</span>
            <select value={sampleRate} disabled={!ready || mode === 'ADSB'} onChange={(e) => applySampleRate(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1">
              {SAMPLE_RATES.map((r) => <option key={r} value={r}>{(r / 1e6).toFixed(3)} MS/s</option>)}
            </select>
            {!sampleOk && <span className="text-rose-300">unsupported</span>}
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">PPM</span>
            <input value={ppm} onChange={(e) => setPpm(e.target.value)} disabled={!ready}
              className="w-20 bg-slate-950 border border-slate-700 rounded px-2 py-1" aria-label="Frequency correction ppm" />
            <button type="button" onClick={applyPpm} disabled={!ready} className="px-2 py-1 rounded border border-slate-700 disabled:opacity-40">APPLY</button>
          </div>
          <div className="text-slate-500">Mode hint: {MODES.find((m) => m.id === mode)?.hint}</div>
        </form>

        <div className="border border-slate-800 rounded-md p-3 bg-slate-900/40 flex flex-col gap-2">
          <div className="text-slate-400 uppercase tracking-wide">Gain, AGC and audio</div>
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={tunerAuto} disabled={!ready}
                onChange={(e) => { setTunerAuto(e.target.checked); applyGain(e.target.checked, gainDb); }} />
              Tuner AGC (auto gain)
            </label>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Gain</span>
            <input type="range" min={0} max={49} step={1} value={gainDb} disabled={!ready || tunerAuto}
              onChange={(e) => setGainDb(Number(e.target.value))}
              onMouseUp={() => applyGain(false, gainDb)} onTouchEnd={() => applyGain(false, gainDb)}
              className="flex-1" aria-label="Manual gain in dB" />
            <span className="w-16 text-right">{tunerAuto ? 'auto' : `${gainDb} dB`}</span>
          </div>
          <div className="flex gap-2 items-center">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={rtlAgc} disabled={!ready}
                onChange={(e) => { setRtlAgc(e.target.checked); receiverRef.current?.setRtlAgc(e.target.checked).catch((err) => setError(err.message)); }} />
              RTL2832U digital AGC
            </label>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Squelch</span>
            <input type="range" min={-120} max={0} step={1} value={squelchDb} onChange={(e) => setSquelchDb(Number(e.target.value))}
              className="flex-1" aria-label="Squelch threshold dBFS" />
            <span className="w-24 text-right">{squelchDb <= -120 ? 'off' : `${squelchDb} dBFS`}</span>
          </div>
          <div className="flex gap-2 items-center">
            <span className="text-slate-400 w-20">Volume</span>
            <input type="range" min={0} max={1} step={0.05} value={volume} onChange={(e) => setVolume(Number(e.target.value))}
              className="flex-1" aria-label="Volume" />
            <button type="button" onClick={audioOn ? stopAudio : startAudio} disabled={mode === 'ADSB'}
              className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 disabled:opacity-40">
              {audioOn ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              {audioOn ? 'AUDIO OFF' : 'AUDIO ON'}
            </button>
          </div>
        </div>
      </div>

      {/* Stream controls and KPIs */}
      <div className="flex flex-wrap items-center gap-2">
        {!streaming ? (
          <button type="button" onClick={startStreaming} disabled={!ready}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40">
            <Play className="w-3.5 h-3.5" /> START
          </button>
        ) : (
          <button type="button" onClick={stopStreaming}
            className="flex items-center gap-1 px-3 py-1.5 rounded bg-rose-700 hover:bg-rose-600">
            <Square className="w-3.5 h-3.5" /> STOP
          </button>
        )}
        <button type="button" onClick={toggleRecord} disabled={!streaming && !recording}
          className={`flex items-center gap-1 px-3 py-1.5 rounded border ${recording ? 'border-rose-500 text-rose-300' : 'border-slate-700'} disabled:opacity-40`}>
          {recording ? <Download className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
          {recording ? 'STOP & SAVE .CU8' : 'RECORD IQ (.CU8)'}
        </button>
        {recordInfo && (
          <span className="text-slate-400">
            saved {recordInfo.name} ({(recordInfo.bytes / 1e6).toFixed(1)} MB{recordInfo.truncated ? ', capped' : ''})
          </span>
        )}
        <div className="ml-auto grid grid-cols-2 md:grid-cols-5 gap-2 text-right">
          <div><div className="text-slate-500">Center</div><div>{centerHz ? formatMHz(centerHz) : '-'}</div></div>
          <div><div className="text-slate-500">Span</div><div>{(sampleRate / 1e6).toFixed(3)} MHz</div></div>
          <div><div className="text-slate-500">Throughput</div><div>{streaming ? `${stats.mbps.toFixed(2)} MB/s` : '-'}</div></div>
          <div><div className="text-slate-500">Peak / floor</div><div>{stats.peakDb != null ? `${stats.peakDb.toFixed(0)} / ${stats.floorDb?.toFixed(0)} dB` : '-'}</div></div>
          <div><div className="text-slate-500">Channel</div><div>{mode === 'ADSB' ? `${adsbFrames} frames` : audioOn ? (stats.squelchOpen ? 'open' : 'squelched') : '-'}</div></div>
        </div>
      </div>

      {tunerProbe && (
        <div className="text-slate-500">
          Tuner chip-ID register reads 0x{tunerProbe.chipId.toString(16).padStart(2, '0')}
          {tunerProbe.looksLikeRafael ? ' (matches the R82xx family, 0x69).' : ' (not 0x69; the tuner may not be an R820T/R828D).'}
        </div>
      )}

      {/* Spectrum + waterfall */}
      <div className="border border-slate-800 rounded-md bg-black overflow-hidden">
        <canvas ref={specCanvasRef} width={1024} height={150} onClick={onSpectrumClick}
          className="w-full h-[150px] cursor-crosshair" aria-label="Spectrum; click to tune" />
        <div className="flex justify-between px-2 py-0.5 text-slate-500 bg-slate-950">
          <span>{ready && centerHz ? formatMHz(centerHz - sampleRate / 2) : '-'}</span>
          <span>click the spectrum to tune</span>
          <span>{ready && centerHz ? formatMHz(centerHz + sampleRate / 2) : '-'}</span>
        </div>
        <canvas ref={wfCanvasRef} width={1024} height={200} className="w-full h-[200px]" aria-label="Waterfall" />
      </div>

      {mode === 'ADSB' && (
        <div className="border border-slate-800 rounded-md p-3 bg-slate-900/40">
          <div className="flex items-center gap-2 text-slate-400 uppercase tracking-wide mb-2">
            <Plane className="w-3.5 h-3.5" /> Aircraft (Mode-S DF17/18 frames; the shared decoder does not check CRC)
          </div>
          {aircraft.length === 0 ? (
            <div className="text-slate-500">No aircraft yet. Start streaming on 1090 MHz; frames are only decoded from whole bulk chunks.</div>
          ) : (
            <table className="w-full text-left">
              <thead className="text-slate-500">
                <tr><th>ICAO</th><th>Callsign</th><th>Alt (ft)</th><th>Lat / Lon</th><th>Speed (kt)</th></tr>
              </thead>
              <tbody>
                {aircraft.map((a) => {
                  // The decoder falls back to the receiver location until a real position frame arrives,
                  // so only positions decoded from the aircraft's own frames (the trail) are shown.
                  const last = a.trail && a.trail.length ? a.trail[a.trail.length - 1] : null;
                  return (
                    <tr key={a.id} className="border-t border-slate-800">
                      <td>{a.icaoHex}</td>
                      <td>{a.callsign || '-'}</td>
                      <td>{a.altFt || '-'}</td>
                      <td>{last ? `${last[1].toFixed(3)}, ${last[0].toFixed(3)}` : '-'}</td>
                      <td>{a.spdKts || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      <div className="text-slate-500 leading-relaxed">
        Not yet verified on hardware: the register programming is ported from librtlsdr and webrtlsdr but has only been run against a
        simulated bus. Demodulation and the spectrum run on the page's main thread.
      </div>
    </div>
  );
}
