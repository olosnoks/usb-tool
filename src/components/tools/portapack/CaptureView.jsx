// "capture" view of the PortaPack workbench: record the real HackRF IQ stream.
// Saves HackRF-native .c8 (int8 I/Q, hackrf_transfer compatible) or Mayhem's
// .C16 + .TXT pair (int16 I/Q plus sample_rate / center_frequency metadata)
// for the PortaPack Replay app.
import { useEffect, useState } from 'react';
import { Disc, Square, Download, FileText } from 'lucide-react';

const fmtMb = (b) => (b / 1048576).toFixed(1);

function download(name, parts, type = 'application/octet-stream') {
  const blob = new Blob(parts, { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CaptureView({ driver, state }) {
  const [status, setStatus] = useState(null);     // live { bytes, seconds, full }
  const [result, setResult] = useState(null);     // finished capture
  const [maxMb, setMaxMb] = useState(64);
  const canCapture = state.connectionType === 'webusb';
  const recording = !!state.capturing;

  useEffect(() => {
    if (!recording) return undefined;
    const iv = setInterval(() => setStatus(driver.captureStatus()), 250);
    return () => clearInterval(iv);
  }, [recording, driver]);

  const start = () => {
    setResult(null);
    try { driver.startCapture({ maxBytes: maxMb * 1048576 }); setStatus(driver.captureStatus()); }
    catch (e) { driver.log(e.message, 'error'); }
  };
  const stop = () => { const r = driver.stopCapture(); setStatus(null); setResult(r); };

  const baseName = (r) => `HackRF_${Math.round(r.centerHz)}Hz_${r.sampleRate}sps`;

  return (
    <div className="space-y-4 flex-1 font-mono text-xs">
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-bold text-slate-200 flex items-center gap-2">
              <Disc className={`w-4 h-4 ${recording ? 'text-rose-400 animate-pulse' : 'text-purple-400'}`} />
              RAW IQ RECORDER
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Records the live 8-bit IQ exactly as the HackRF streams it
              {canCapture ? ` — ${(state.frequency / 1e6).toFixed(4)} MHz at ${state.sampleRate / 1e6} Msps (${(state.sampleRate * 2 / 1048576).toFixed(1)} MB/s).` : '. Connect over WebUSB (HackRF mode) to record.'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-slate-400 flex items-center gap-1.5">
              LIMIT
              <select value={maxMb} onChange={(e) => setMaxMb(parseInt(e.target.value, 10))} disabled={recording}
                className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-1">
                {[16, 32, 64, 128, 256].map((m) => <option key={m} value={m}>{m} MB</option>)}
              </select>
            </label>
            {recording ? (
              <button onClick={stop} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg flex items-center gap-1.5">
                <Square className="w-3.5 h-3.5" /> STOP
              </button>
            ) : (
              <button onClick={start} disabled={!canCapture}
                className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold rounded-lg flex items-center gap-1.5">
                <Disc className="w-3.5 h-3.5" /> RECORD
              </button>
            )}
          </div>
        </div>

        {recording && status && (
          <div className="flex items-center gap-4 text-[11px] border-t border-slate-800 pt-2">
            <span className="text-rose-300 font-bold">● REC</span>
            <span className="text-slate-300">{status.seconds.toFixed(1)} s</span>
            <span className="text-slate-300">{fmtMb(status.bytes)} MB</span>
            <div className="flex-1 h-1.5 bg-slate-800 rounded overflow-hidden">
              <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, (status.bytes / (maxMb * 1048576)) * 100)}%` }} />
            </div>
            {status.full && <span className="text-amber-300">limit reached</span>}
          </div>
        )}
      </div>

      {result && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <span className="text-slate-400">Capture</span>
            <span className="text-cyan-300 font-bold">{baseName(result)}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div><span className="text-slate-500 block">Center</span><span className="text-emerald-400 font-bold">{(result.centerHz / 1e6).toFixed(4)} MHz</span></div>
            <div><span className="text-slate-500 block">Sample rate</span><span className="text-slate-200">{result.sampleRate / 1e6} Msps</span></div>
            <div><span className="text-slate-500 block">Duration</span><span className="text-amber-400">{result.seconds.toFixed(2)} s</span></div>
            <div><span className="text-slate-500 block">Size</span><span className="text-slate-200">{fmtMb(result.bytes)} MB (int8 I/Q)</span></div>
          </div>
          <div className="pt-2 flex flex-wrap gap-2">
            <button onClick={() => download(`${baseName(result)}.c8`, [result.c8])}
              className="px-3 py-1.5 bg-cyan-600/30 hover:bg-cyan-600/50 text-cyan-200 border border-cyan-500/40 rounded flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Save .c8 (HackRF / hackrf_transfer)
            </button>
            <button onClick={() => {
              const c16 = result.toC16();
              download(`${baseName(result)}.C16`, [c16]);
              download(`${baseName(result)}.TXT`, [result.sidecar], 'text/plain');
              driver.log('[Capture] Saved Mayhem .C16 + .TXT pair. Copy both to the SD card /CAPTURES folder for Replay.', 'success');
            }}
              className="px-3 py-1.5 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5" /> Save Mayhem .C16 + .TXT (Replay)
            </button>
          </div>
          <div className="text-[10px] text-slate-500">
            The .C16 is twice the size (int8 scaled to int16). Mayhem Replay reads the sample rate and centre from the .TXT; keep both files together.
          </div>
        </div>
      )}
    </div>
  );
}
