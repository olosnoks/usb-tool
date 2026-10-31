// "spectrum" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { ALL_SPECTRUM_CHANNELS } from './shared';
import { BarChart2 } from 'lucide-react';

export default function SpectrumTab({
  channel,
  channelStats,
  handleChannelChange,
  setSpectrumBand,
  spectrumBand,
  spectrumChannels,
  spectrumStats
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Top Controls & KPI Cards */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        {/* Band Selector */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-semibold">Band Filter:</span>
          <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-xs">
            <button
              onClick={() => setSpectrumBand('all')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                spectrumBand === 'all' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Channels ({ALL_SPECTRUM_CHANNELS.length})
            </button>
            <button
              onClick={() => setSpectrumBand('2.4')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                spectrumBand === '2.4' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              2.4 GHz (1-14)
            </button>
            <button
              onClick={() => setSpectrumBand('5')}
              className={`px-2.5 py-1 rounded font-semibold transition ${
                spectrumBand === '5' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              5 GHz (36-165)
            </button>
          </div>
        </div>

        {/* KPI Metrics */}
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-500 text-[10px] uppercase block">Total Logged</span>
            <span className="font-bold text-cyan-300 text-sm">{spectrumStats.totalPkts.toLocaleString()} pkts</span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
            <span className="text-slate-500 text-[10px] uppercase block">Peak Congestion</span>
            <span className="font-bold text-rose-400 text-sm">
              {spectrumStats.maxCh ? `CH ${spectrumStats.maxCh} (${spectrumStats.maxPkts} pkts)` : 'None'}
            </span>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40">
            <span className="text-emerald-400 text-[10px] uppercase font-bold block">Recommended Channel</span>
            <span className="font-bold text-emerald-300 text-sm">
              CH {spectrumStats.recommendedCh} (Least Traffic)
            </span>
          </div>
        </div>
      </div>

      {/* Bar Chart Visualization */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="font-semibold text-slate-300">
            Channel Packet Density (Click any channel bar to retune radio)
          </span>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span> Low Traffic</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500"></span> Moderate</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500"></span> Congested</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-2 border-cyan-400 bg-cyan-500/40"></span> Active CH</span>
          </div>
        </div>

        <div className="h-64 bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex items-end gap-1 sm:gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800">
          {spectrumChannels.map(c => {
            const count = channelStats[c.ch] || 0;
            const pct = spectrumStats.maxPkts > 0 ? Math.round((count / spectrumStats.maxPkts) * 100) : 0;
            const isActive = channel === c.ch;

            let barColor = 'bg-slate-800 hover:bg-slate-700';
            if (count > 0) {
              if (pct > 60) barColor = 'bg-rose-500 hover:bg-rose-400 shadow-rose-glow';
              else if (pct > 25) barColor = 'bg-amber-500 hover:bg-amber-400';
              else barColor = 'bg-emerald-500 hover:bg-emerald-400';
            }
            if (isActive) {
              barColor += ' ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950';
            }

            const barHeightPct = Math.max(pct, count > 0 ? 8 : 3);

            return (
              <div
                key={c.ch}
                onClick={() => handleChannelChange(c.ch)}
                title={`CH ${c.ch} (${c.freq}): ${count} packets (${pct}% relative congestion). Click to tune.`}
                className="flex-1 min-w-[28px] max-w-[48px] h-full flex flex-col justify-end items-center cursor-pointer group select-none transition"
              >
                {/* Packet Count label */}
                <div className="text-[9px] text-slate-400 group-hover:text-cyan-300 font-mono mb-1 truncate">
                  {count > 0 ? count : ''}
                </div>

                {/* Bar */}
                <div
                  style={{ height: `${barHeightPct}%` }}
                  className={`w-full rounded-t-sm transition-all duration-300 ${barColor}`}
                />

                {/* Channel Number Label */}
                <div className={`mt-2 text-[10px] font-bold font-mono transition ${
                  isActive ? 'text-cyan-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
                }`}>
                  {c.ch}
                </div>

                {/* Band Badge */}
                <div className="text-[8px] text-slate-500">
                  {c.band.replace(' GHz', 'G')}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Spectrum Guidance Note */}
      <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-start gap-2.5">
        <BarChart2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-slate-200">Spectrum Optimization Guide:</span>{' '}
          In 2.4 GHz, use non-overlapping channels <span className="font-mono text-cyan-300 font-semibold">1, 6, or 11</span> to minimize co-channel interference. In 5 GHz, UNII channels (<span className="font-mono text-cyan-300">36-48</span> and <span className="font-mono text-cyan-300">149-165</span>) provide wider 80MHz bandwidth and significantly less noise.
        </div>
      </div>
    </div>
  );
}
