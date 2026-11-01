// Shared IQ recorder pieces for the PortaPack Mayhem workbench. The receiver
// tab shows the compact REC button next to LISTEN; the IQ Recorder tab shows
// the full card. Both drive the same recording in the driver, and the finished
// capture lives on the driver (lastCapture) so it can be saved from either tab.
import { useEffect, useState } from 'react';
import { Disc, Square, Download, FileText, X } from 'lucide-react';
import { HACKRF_CAPTURE_MAX_BYTES } from '../../../utils/mayhemDriver';

export const CAPTURE_LIMITS_MB = [16, 32, 64, 128, 256, 512].filter((m) => m * 1048576 <= HACKRF_CAPTURE_MAX_BYTES);
const LIMIT_KEY = 'skon-iq-capture-mb';

export const fmtMb = (b) => (b / 1048576).toFixed(1);

export function loadLimitMb() {
  try {
    const v = parseInt(localStorage.getItem(LIMIT_KEY), 10);
    if (CAPTURE_LIMITS_MB.includes(v)) return v;
  } catch (_) { /* no storage */ }
  return 64;
}
export function saveLimitMb(mb) { try { localStorage.setItem(LIMIT_KEY, String(mb)); } catch (_) { /* ignore */ } }

/** Save Blob parts without ever concatenating them (a 512 MB .c8 stays in chunks). */
export function downloadParts(name, parts, type = 'application/octet-stream') {
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const captureBaseName = (r) => `HackRF_${Math.round(r.centerHz)}Hz_${r.sampleRate}sps`;

/** The last finished recording, re-read whenever the driver bumps captureSeq. */
export function useLastCapture(driver, state) {
  const seq = state?.captureSeq ?? 0;
  const [cap, setCap] = useState(() => driver?.lastCapture ?? null);
  useEffect(() => { setCap(driver?.lastCapture ?? null); }, [driver, seq]);
  return cap;
}

/** Save the finished capture as .c8 or Mayhem .C16 + .TXT. */
export function saveC8(result) { downloadParts(`${captureBaseName(result)}.c8`, result.c8Parts ?? [result.c8]); }
export function saveC16(result, driver) {
  const parts = result.c16Parts ? Array.from(result.c16Parts()) : [result.toC16()];
  downloadParts(`${captureBaseName(result)}.C16`, parts);
  downloadParts(`${captureBaseName(result)}.TXT`, [result.sidecar], 'text/plain');
  driver?.log?.('[Capture] Saved Mayhem .C16 + .TXT pair. Copy both to the SD card /CAPTURES folder for Replay.', 'success');
}

/**
 * REC / STOP with the size limit and a live counter.
 * compact: one row for the receiver's audio bar.
 */
export function RecordControls({ driver, state, compact = false }) {
  const [maxMb, setMaxMb] = useState(loadLimitMb);
  const [status, setStatus] = useState(null);
  const canCapture = state.connectionType === 'webusb';
  const recording = !!state.capturing;

  useEffect(() => {
    if (!recording) { setStatus(null); return undefined; }
    setStatus(driver.captureStatus());
    const iv = setInterval(() => setStatus(driver.captureStatus()), 250);
    return () => clearInterval(iv);
  }, [recording, driver]);

  const start = () => {
    try { driver.startCapture({ maxBytes: maxMb * 1048576 }); }
    catch (e) { driver.log(e.message, 'error'); }
  };
  const stop = () => { driver.stopCapture(); };
  const pick = (mb) => { setMaxMb(mb); saveLimitMb(mb); };

  const btn = compact ? 'px-2.5 py-1 rounded font-bold flex items-center gap-1.5 transition disabled:opacity-40' : 'px-3 py-1.5 font-bold rounded-lg flex items-center gap-1.5 disabled:opacity-40';
  return (
    <div className={`flex items-center ${compact ? 'gap-1.5' : 'gap-2'}`}>
      <label className={`text-slate-400 flex items-center gap-1.5 ${compact ? 'text-[11px]' : ''}`} title="Stop automatically at this size (int8 I/Q, 2 bytes per sample)">
        {compact ? 'MAX' : 'LIMIT'}
        <select value={maxMb} onChange={(e) => pick(parseInt(e.target.value, 10))} disabled={recording}
          className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1">
          {CAPTURE_LIMITS_MB.map((m) => <option key={m} value={m}>{m} MB</option>)}
        </select>
      </label>
      {recording ? (
        <button onClick={stop} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`} title="Stop recording">
          <Square className="w-3.5 h-3.5" /> STOP
        </button>
      ) : (
        <button onClick={start} disabled={!canCapture}
          title={canCapture ? `Record the raw IQ stream at ${(state.frequency / 1e6).toFixed(4)} MHz, ${state.sampleRate / 1e6} Msps` : 'Connect over WebUSB (HackRF mode) to record'}
          className={`${btn} ${compact ? 'bg-slate-900 text-rose-300 border border-rose-500/40 hover:bg-rose-600 hover:text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
          <Disc className="w-3.5 h-3.5" /> REC
        </button>
      )}
      {recording && status && (
        <span className={`flex items-center gap-2 ${compact ? 'text-[11px]' : 'text-[11px]'}`}>
          <span className="text-rose-300 font-bold animate-pulse">●</span>
          <span className="text-slate-200 tabular-nums">{status.seconds.toFixed(1)} s</span>
          <span className="text-slate-400 tabular-nums">{fmtMb(status.bytes)} / {maxMb} MB</span>
          {!compact && (
            <span className="w-32 h-1.5 bg-slate-800 rounded overflow-hidden inline-block">
              <span className="block h-full bg-rose-500" style={{ width: `${Math.min(100, (status.bytes / (maxMb * 1048576)) * 100)}%` }} />
            </span>
          )}
          {status.full && <span className="text-amber-300">limit reached</span>}
        </span>
      )}
    </div>
  );
}

/** One-line "last capture" strip with the save buttons, for the receiver tab. */
export function CaptureResultStrip({ driver, state }) {
  const result = useLastCapture(driver, state);
  if (!result) return null;
  return (
    <div className="bg-slate-950/80 border border-rose-500/30 rounded-xl px-3 py-2 flex flex-wrap items-center justify-between gap-2 font-mono text-xs" data-testid="capture-result-strip">
      <div className="flex flex-wrap items-center gap-3">
        <Disc className="w-3.5 h-3.5 text-rose-400" />
        <span className="text-slate-200 font-bold">{captureBaseName(result)}</span>
        <span className="text-slate-400">{result.seconds.toFixed(2)} s · {fmtMb(result.bytes)} MB · {(result.centerHz / 1e6).toFixed(4)} MHz @ {result.sampleRate / 1e6} Msps</span>
        {result.full && <span className="text-amber-300">stopped at the limit</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => saveC8(result)} className="px-2.5 py-1 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> .c8
        </button>
        <button onClick={() => saveC16(result, driver)} className="px-2.5 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Mayhem .C16 + .TXT
        </button>
        <button onClick={() => driver.clearLastCapture()} title="Discard this capture and free its memory" className="p-1 text-slate-500 hover:text-rose-300">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Full result card for the IQ Recorder tab. */
export function CaptureResultCard({ driver, state }) {
  const result = useLastCapture(driver, state);
  if (!result) return null;
  return (
    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
      <div className="flex justify-between border-b border-slate-800 pb-2">
        <span className="text-slate-400">Capture</span>
        <span className="text-cyan-300 font-bold">{captureBaseName(result)}</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <div><span className="text-slate-500 block">Center</span><span className="text-emerald-400 font-bold">{(result.centerHz / 1e6).toFixed(4)} MHz</span></div>
        <div><span className="text-slate-500 block">Sample rate</span><span className="text-slate-200">{result.sampleRate / 1e6} Msps</span></div>
        <div><span className="text-slate-500 block">Duration</span><span className="text-amber-400">{result.seconds.toFixed(2)} s</span></div>
        <div><span className="text-slate-500 block">Size</span><span className="text-slate-200">{fmtMb(result.bytes)} MB (int8 I/Q){result.full ? ' · limit' : ''}</span></div>
      </div>
      <div className="pt-2 flex flex-wrap gap-2">
        <button onClick={() => saveC8(result)}
          className="px-3 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded flex items-center gap-1.5">
          <Download className="w-3.5 h-3.5" /> Save .c8 (HackRF / hackrf_transfer)
        </button>
        <button onClick={() => saveC16(result, driver)}
          className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5" /> Save Mayhem .C16 + .TXT (Replay)
        </button>
        <button onClick={() => driver.clearLastCapture()}
          className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded flex items-center gap-1.5">
          <X className="w-3.5 h-3.5" /> Discard
        </button>
      </div>
      <div className="text-[10px] text-slate-500">
        The .C16 is twice the size (int8 scaled to int16). Mayhem Replay reads the sample rate and centre from the .TXT; keep both files together.
        The recording is held in browser memory until you discard it or reload the page.
      </div>
    </div>
  );
}
