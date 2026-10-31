// "display" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Activity } from 'lucide-react';
import { MAYHEM_APPS } from '../../../utils/mayhemDriver';

export default function DisplayView({
  agcEnabled,
  customFreqInput,
  driver,
  handleCustomTune,
  setAgcEnabled,
  setCustomFreqInput,
  state
}) {
  return (
    <div className="space-y-4 flex-1">
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-4">
        <label className="text-xs font-mono text-slate-400 block mb-1">
          SYNTHESIZER FREQUENCY (MHz)
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={customFreqInput}
            onChange={(e) => setCustomFreqInput(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-700 text-cyan-300 font-mono px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-cyan-500"
            placeholder="e.g. 433.920"
          />
          <button
            onClick={handleCustomTune}
            className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold font-mono text-xs rounded-lg transition"
          >
            TUNE
          </button>
        </div>

        {/* Quick frequency presets */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {[
            { label: '315 MHz', freq: 315.0 },
            { label: '433.92 MHz', freq: 433.92 },
            { label: '868.3 MHz', freq: 868.3 },
            { label: '915.0 MHz', freq: 915.0 },
            { label: '1090 ADS-B', freq: 1090.0 },
            { label: '162.4 NOAA', freq: 162.4 }
          ].map(p => (
            <button
              key={p.label}
              onClick={() => {
                setCustomFreqInput(p.freq.toString());
                driver.sendCommand(`freq ${Math.round(p.freq * 1000000)}`);
              }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[11px] font-mono transition"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* AGC (Automatic Gain Control - RocketGod Mayhem Feature) */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-200">AUTOMATIC GAIN CONTROL (AGC)</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-purple-900/60 border border-purple-500/40 text-purple-300 rounded font-mono">RocketGod DSP</span>
          </div>
          <span className="text-[10px] text-slate-400">Holds 8-bit ADC RMS level between 7 and 22 counts for optimal dynamic range</span>
        </div>
        <button
          onClick={() => setAgcEnabled(!agcEnabled)}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition flex items-center gap-1.5 ${
            agcEnabled
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          {agcEnabled ? 'AGC ACTIVE' : 'AGC OFF (MANUAL)'}
        </button>
      </div>

      {/* Gains Deck */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs font-mono mb-2">
            <span className="text-slate-400">LNA GAIN (IF)</span>
            <span className="text-emerald-400 font-bold">{state.lnaGain} dB</span>
          </div>
          <input
            type="range"
            min="0"
            max="40"
            step="8"
            value={state.lnaGain}
            onChange={(e) => driver.sendCommand(`lna ${e.target.value}`)}
            className="w-full accent-emerald-500"
          />
          <span className="text-[10px] text-slate-500 block mt-1">Steps: 0, 8, 16, 24, 32, 40 dB</span>
        </div>

        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
          <div className="flex items-center justify-between text-xs font-mono mb-2">
            <span className="text-slate-400">VGA GAIN (BASEBAND)</span>
            <span className="text-cyan-400 font-bold">{state.vgaGain} dB</span>
          </div>
          <input
            type="range"
            min="0"
            max="62"
            step="2"
            value={state.vgaGain}
            onChange={(e) => driver.sendCommand(`vga ${e.target.value}`)}
            className="w-full accent-cyan-500"
          />
          <span className="text-[10px] text-slate-500 block mt-1">Steps: 0 to 62 dB (2 dB res)</span>
        </div>
      </div>

      {/* Amp Toggle & Sample Rate */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 flex items-center justify-between">
        <div>
          <span className="text-xs font-bold text-slate-200 block">RF FRONTEND AMPLIFIER (+14 dB)</span>
          <span className="text-[10px] text-slate-400">MAX2837 RX/TX pre-amp driver</span>
        </div>
        <button
          onClick={() => driver.sendCommand(`amp ${state.amp > 0 ? '0' : '1'}`)}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition ${
            state.amp > 0
              ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/30'
              : 'bg-slate-800 text-slate-400 border border-slate-700'
          }`}
        >
          {state.amp > 0 ? 'ENABLED (+14dB)' : 'BYPASS (0dB)'}
        </button>
      </div>

      {/* Quick App Launcher */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5">
        <span className="text-xs font-mono text-slate-400 block mb-2">LAUNCH MAYHEM APPLICATION</span>
        <div className="grid grid-cols-3 gap-2">
          {MAYHEM_APPS.slice(1, 7).map(app => (
            <button
              key={app.id}
              onClick={() => driver.sendCommand(`app ${app.id}`)}
              className="px-2.5 py-1.5 bg-slate-900 hover:bg-purple-900/30 border border-slate-800 hover:border-purple-500/40 text-slate-300 rounded text-xs font-mono transition text-left truncate"
            >
              {app.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
