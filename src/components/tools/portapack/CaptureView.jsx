// "capture" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Disc, Play } from 'lucide-react';

export default function CaptureView({
  driver,
  iqFileStats,
  setIqFileStats
}) {
  return (
    <div className="space-y-4 flex-1">
      <div className="border-2 border-dashed border-slate-700 hover:border-purple-500/50 rounded-xl p-6 text-center bg-slate-950/60 transition cursor-pointer">
        <Disc className="w-8 h-8 text-purple-400 mx-auto mb-2 animate-pulse" />
        <div className="text-xs font-bold text-slate-200">
          DRAG & DROP MAYHEM .C16 RAW IQ CAPTURE FILE
        </div>
        <div className="text-[11px] text-slate-400 mt-1">
          Or click to inspect sample capture (433.92 MHz Weather Station / OOK TPMS)
        </div>
        <button
          onClick={() => {
            setIqFileStats({
              name: 'capture_433M92_2MSPS.C16',
              sizeBytes: 16777216,
              sampleRate: '2.0 MSPS',
              duration: '2.097 seconds',
              format: 'Signed 16-bit Complex (I/Q interleaved)',
              centerFreq: '433.920 MHz'
            });
            driver.log('Loaded 16MB sample capture: capture_433M92_2MSPS.C16', 'success');
          }}
          className="mt-3 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 border border-slate-700 rounded text-xs font-mono transition"
        >
          Load Sample C16 File
        </button>
      </div>

      {iqFileStats && (
        <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs space-y-2">
          <div className="flex justify-between border-b border-slate-800 pb-2">
            <span className="text-slate-400">File:</span>
            <span className="text-cyan-300 font-bold">{iqFileStats.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Format:</span>
            <span className="text-slate-200">{iqFileStats.format}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Center Frequency:</span>
            <span className="text-emerald-400 font-bold">{iqFileStats.centerFreq}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Sample Rate:</span>
            <span className="text-slate-200">{iqFileStats.sampleRate}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Duration:</span>
            <span className="text-amber-400">{iqFileStats.duration}</span>
          </div>

          <div className="pt-2 flex gap-2">
            <button
              onClick={() => {
                driver.sendCommand('app replay');
                driver.log(`Transmitting replay buffer at ${iqFileStats.centerFreq}`, 'warning');
              }}
              className="flex-1 py-1.5 bg-rose-600/30 hover:bg-rose-600/50 text-rose-300 border border-rose-500/40 rounded text-xs font-bold transition flex items-center justify-center gap-1.5"
            >
              <Play className="w-3.5 h-3.5" /> Replay Over HackRF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
