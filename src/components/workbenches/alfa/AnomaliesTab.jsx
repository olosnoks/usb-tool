// "anomalies" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import React from 'react';

export default function AnomaliesTab({
  anomalies,
  getRssiBadge,
  setSelectedItem
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Header Guidance Banner */}
      <div className="p-3.5 bg-rose-950/20 border border-rose-800/40 rounded-xl flex items-start gap-3 text-xs">
        <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <div className="font-bold text-rose-300">
            MAC Address Rotation & Identifier Anomaly Detection
          </div>
          <p className="text-slate-300 leading-relaxed text-[11px]">
            Mobile operating systems (iOS, Android, Windows) randomize their hardware MAC addresses for privacy.
            However, devices often maintain a persistent list of probed networks. When multiple distinct MAC identifiers
            broadcast the <span className="font-bold text-rose-300">exact same sequence of probed SSIDs</span> in close temporal proximity,
            they are correlated and flagged as a <span className="font-bold text-rose-300">Potential Identifier Rotation Anomaly</span>.
          </p>
        </div>
      </div>

      {/* Anomalies List */}
      {anomalies.length === 0 ? (
        <div className="p-12 text-center text-slate-500 text-xs bg-slate-900/30 rounded-xl border border-slate-800">
          <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="font-bold text-slate-300">No Identifier Rotation Anomalies Detected</p>
          <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
            All observed probe requests originate from consistent hardware identifiers. Anomalies will be flagged in real time if multiple MACs broadcast matching probe request fingerprints.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {anomalies.map((anom) => (
            <div
              key={anom.id}
              className="bg-slate-900/60 border border-rose-800/50 rounded-xl p-4 space-y-3 hover:border-rose-600/70 transition shadow-lg"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase tracking-wider">
                    {anom.type}
                  </span>
                  <span className="text-xs font-mono font-bold text-slate-200">
                    {anom.deviceCount} Observed Hardware Identifiers
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Last Seen: <span className="text-slate-300 font-bold">{anom.lastSeen}</span>
                </div>
              </div>

              {/* Sequence of Probed Networks */}
              <div className="space-y-1">
                <div className="text-[10px] uppercase font-semibold text-slate-500">
                  Correlated Probed Network Sequence:
                </div>
                <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                  {anom.probedSequence.map((ssid, sIdx) => (
                    <React.Fragment key={sIdx}>
                      <span className="px-2 py-1 bg-slate-950 text-cyan-300 border border-slate-800 rounded font-semibold">
                        {ssid}
                      </span>
                      {sIdx < anom.probedSequence.length - 1 && (
                        <span className="text-slate-600 font-bold">➔</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {/* Correlated MAC Identifiers Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase">
                      <th className="py-1 px-2">Observed MAC</th>
                      <th className="py-1 px-2">Vendor OUI</th>
                      <th className="py-1 px-2">RSSI</th>
                      <th className="py-1 px-2">Channel</th>
                      <th className="py-1 px-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {anom.clients.map((cli, cIdx) => (
                      <tr key={cli.mac || cIdx} className="hover:bg-slate-800/40">
                        <td className="py-1.5 px-2 text-rose-300 font-bold">{cli.mac}</td>
                        <td className="py-1.5 px-2 text-slate-300">{cli.vendor}</td>
                        <td className="py-1.5 px-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(cli.rssi)}`}>
                            {cli.rssi} dBm
                          </span>
                        </td>
                        <td className="py-1.5 px-2 text-slate-400">CH {cli.channel}</td>
                        <td className="py-1.5 px-2 text-right">
                          <button
                            onClick={() => setSelectedItem({ type: 'client', data: cli })}
                            className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
