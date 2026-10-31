// "freqman" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Download, Trash2 } from 'lucide-react';

export default function FreqmanView({
  customFreqInput,
  customLabel,
  customMod,
  driver,
  handleAddCustomFreq,
  handleExportFreqman,
  handleTunePreset,
  setCustomFreqInput,
  setCustomLabel,
  setCustomMod
}) {
  return (
    <div className="space-y-4 flex-1 flex flex-col">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-slate-400">
          /FREQMAN/ DATABASE ({driver.freqList.length} FREQUENCIES)
        </span>
        <button
          onClick={handleExportFreqman}
          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 rounded text-xs font-mono transition flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" /> Export FREQMAN.TXT
        </button>
      </div>

      {/* Frequency List Table */}
      <div className="flex-1 bg-slate-950 border border-slate-800 rounded-xl overflow-y-auto max-h-64 divide-y divide-slate-800/60 font-mono text-xs">
        {driver.freqList.map((item) => (
          <div key={item.id} className="p-2.5 flex items-center justify-between hover:bg-slate-900/60 transition">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-cyan-400">
                  {(item.freq / 1000000).toFixed(4)} MHz
                </span>
                <span className="text-[10px] px-1.5 py-0.2 bg-purple-950/60 text-purple-300 border border-purple-500/30 rounded">
                  {item.mod}
                </span>
                <span className="text-[10px] text-slate-500">{item.category}</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">{item.label}</div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => handleTunePreset(item)}
                className="px-2 py-1 bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 rounded text-[11px] transition"
              >
                TUNE
              </button>
              <button
                onClick={() => driver.deleteFrequency(item.id)}
                className="p-1 hover:text-rose-400 text-slate-500 transition"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Custom Frequency Entry */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 grid grid-cols-1 md:grid-cols-4 gap-2">
        <input
          type="text"
          value={customFreqInput}
          onChange={(e) => setCustomFreqInput(e.target.value)}
          placeholder="Freq (MHz)"
          className="bg-slate-900 border border-slate-700 text-slate-200 font-mono px-2.5 py-1 rounded text-xs"
        />
        <select
          value={customMod}
          onChange={(e) => setCustomMod(e.target.value)}
          className="bg-slate-900 border border-slate-700 text-slate-200 font-mono px-2 py-1 rounded text-xs"
        >
          <option value="NFM">NFM (Narrow)</option>
          <option value="WFM">WFM (Wide)</option>
          <option value="AM">AM (Voice)</option>
          <option value="SPEC">SPEC (Raw)</option>
          <option value="ASK">ASK (OOK)</option>
        </select>
        <input
          type="text"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.target.value)}
          placeholder="Description label"
          className="bg-slate-900 border border-slate-700 text-slate-200 font-mono px-2.5 py-1 rounded text-xs"
        />
        <button
          onClick={handleAddCustomFreq}
          className="bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold rounded py-1 transition"
        >
          + ADD
        </button>
      </div>
    </div>
  );
}
