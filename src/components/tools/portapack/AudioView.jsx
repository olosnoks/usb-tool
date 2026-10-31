// "audio" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Flame, Volume2 } from 'lucide-react';

export default function AudioView({
  agcEnabled,
  audioMode,
  setAudioMode,
  setSquelchDb,
  setVolume,
  squelchDb,
  volume,
  waterfallCanvasRef
}) {
  return (
    <div className="space-y-4 flex-1 flex flex-col font-mono text-xs">
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-bold">DEMOD:</span>
          <div className="flex items-center bg-slate-900 border border-slate-700 rounded p-0.5 text-xs">
            {['WFM', 'NFM', 'AM', 'USB', 'LSB'].map(m => (
              <button
                key={m}
                onClick={() => setAudioMode(m)}
                className={`px-2 py-0.5 rounded transition ${audioMode === m ? 'bg-purple-600 text-white font-bold' : 'text-slate-400'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-amber-300">
            <span>SQUELCH:</span>
            <input
              type="range"
              min="-110"
              max="-40"
              value={squelchDb}
              onChange={(e) => setSquelchDb(parseInt(e.target.value))}
              className="w-20 accent-amber-500"
            />
            <span className="w-12 text-right">{squelchDb} dB</span>
          </div>

          <div className="flex items-center gap-1.5 text-cyan-300">
            <Volume2 className="w-3.5 h-3.5" />
            <input
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(e) => setVolume(parseInt(e.target.value))}
              className="w-16 accent-cyan-500"
            />
            <span className="w-8 text-right">{volume}%</span>
          </div>
        </div>
      </div>

      {/* Real-time Spectrum Trace & Inferno Waterfall Canvas */}
      <div className="relative bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl flex-1 min-h-[360px]">
        <canvas
          ref={waterfallCanvasRef}
          width={1200}
          height={360}
          className="w-full h-full block"
        />
      </div>

      {/* RocketGod Waterfall Information Footer */}
      <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/60 border border-slate-800/60 rounded-lg px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-purple-300">
          <Flame className="w-3.5 h-3.5 text-orange-400" />
          <strong>Inferno Waterfall:</strong> 40 dB dynamic range • Carrier auto-label • Median noise floor
        </span>
        <span className="text-emerald-400 font-bold">
          AGC: {agcEnabled ? 'RMS Locked (7-22 counts)' : 'Manual Trim'}
        </span>
      </div>
    </div>
  );
}
