// "heuristics" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { AlertTriangle, CheckCircle2, Lock, ShieldAlert } from 'lucide-react';

export default function HeuristicsTab({
  heuristicReport,
  setSelectedItem
}) {
  return (
    <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Vulnerabilities</div>
          <div className={`text-2xl font-bold mt-1 ${heuristicReport.totalVulnerabilities > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {heuristicReport.totalVulnerabilities}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Across {heuristicReport.scannedCount} evaluated APs</div>
        </div>

        <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3">
          <div className="text-[11px] text-amber-300 uppercase font-semibold">Default Factory SSIDs</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {heuristicReport.defaultSSIDs.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Unhardened out-of-the-box names</div>
        </div>

        <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-3">
          <div className="text-[11px] text-rose-300 uppercase font-semibold">Weak Legacy Encryption</div>
          <div className="text-2xl font-bold text-rose-400 mt-1">
            {heuristicReport.weakEncryption.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Deprecated WEP / WPA-TKIP ciphers</div>
        </div>

        <div className="bg-slate-900/90 border border-yellow-500/30 rounded-xl p-3">
          <div className="text-[11px] text-yellow-300 uppercase font-semibold">Open / Unencrypted</div>
          <div className="text-2xl font-bold text-yellow-400 mt-1">
            {heuristicReport.openNetworks.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Cleartext link-layer broadcast</div>
        </div>
      </div>

      {/* Zero Vulnerabilities State */}
      {heuristicReport.totalVulnerabilities === 0 && (
        <div className="p-8 text-center bg-slate-900/40 border border-emerald-500/30 rounded-xl space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
          <div className="text-sm font-bold text-emerald-200">All Discovered Networks Pass Heuristic Baseline</div>
          <div className="text-xs text-slate-400 max-w-md mx-auto">
            No factory-default vendor SSIDs, legacy WEP/TKIP ciphers, or unencrypted open broadcast networks were detected in the current RF airspace.
          </div>
        </div>
      )}

      {/* Category 1: Default SSIDs */}
      {heuristicReport.defaultSSIDs.length > 0 && (
        <div className="bg-slate-900/60 border border-amber-500/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <div className="font-bold text-sm text-slate-200">Default Factory SSIDs ({heuristicReport.defaultSSIDs.length})</div>
                <div className="text-[11px] text-slate-400">Identifies hardware vendor and indicates default router configuration with potential default credentials.</div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
              Medium Risk
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="text-[11px] text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">BSSID</th>
                  <th className="py-2 px-3">Default SSID</th>
                  <th className="py-2 px-3">Vendor</th>
                  <th className="py-2 px-3">Security</th>
                  <th className="py-2 px-3">Actionable Recommendation</th>
                  <th className="py-2 px-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {heuristicReport.defaultSSIDs.map((dev, i) => (
                  <tr key={dev.bssid || i} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 px-3 font-mono font-bold text-slate-300">{dev.bssid}</td>
                    <td className="py-2 px-3 font-bold text-amber-300">{dev.ssid}</td>
                    <td className="py-2 px-3 text-slate-300">{dev.vendor || '—'}</td>
                    <td className="py-2 px-3 text-slate-400">{dev.security || 'Open'}</td>
                    <td className="py-2 px-3 text-[11px] text-slate-400">{dev.recommendation}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
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
      )}

      {/* Category 2: Weak Encryption */}
      {heuristicReport.weakEncryption.length > 0 && (
        <div className="bg-slate-900/60 border border-rose-500/50 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40">
                <ShieldAlert className="w-4 h-4 text-rose-400" />
              </div>
              <div>
                <div className="font-bold text-sm text-slate-200">Deprecated Legacy Encryption ({heuristicReport.weakEncryption.length})</div>
                <div className="text-[11px] text-slate-400">WEP (RC4) and WPA-TKIP suffer from practical mathematical key recovery attacks and message forgery.</div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600/30 text-rose-300 border border-rose-500/50">
              Critical Risk
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="text-[11px] text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">BSSID</th>
                  <th className="py-2 px-3">SSID</th>
                  <th className="py-2 px-3">Flawed Security Suite</th>
                  <th className="py-2 px-3">Vendor</th>
                  <th className="py-2 px-3">Remediation Guidance</th>
                  <th className="py-2 px-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {heuristicReport.weakEncryption.map((dev, i) => (
                  <tr key={dev.bssid || i} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 px-3 font-mono font-bold text-slate-300">{dev.bssid}</td>
                    <td className="py-2 px-3 font-bold text-slate-100">{dev.ssid}</td>
                    <td className="py-2 px-3">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        {dev.security || 'WEP/TKIP'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-300">{dev.vendor || '—'}</td>
                    <td className="py-2 px-3 text-[11px] text-rose-200/90">{dev.recommendation}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
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
      )}

      {/* Category 3: Open Networks */}
      {heuristicReport.openNetworks.length > 0 && (
        <div className="bg-slate-900/60 border border-yellow-500/40 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                <Lock className="w-4 h-4 text-yellow-400" />
              </div>
              <div>
                <div className="font-bold text-sm text-slate-200">Open Unencrypted Broadcast Networks ({heuristicReport.openNetworks.length})</div>
                <div className="text-[11px] text-slate-400">All wireless frames are transmitted in cleartext, enabling passive packet capture and session hijacking.</div>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
              High Risk
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="text-[11px] text-slate-400 uppercase border-b border-slate-800">
                <tr>
                  <th className="py-2 px-3">BSSID</th>
                  <th className="py-2 px-3">SSID</th>
                  <th className="py-2 px-3">Channel</th>
                  <th className="py-2 px-3">Vendor</th>
                  <th className="py-2 px-3">Hardening Recommendation</th>
                  <th className="py-2 px-3 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {heuristicReport.openNetworks.map((dev, i) => (
                  <tr key={dev.bssid || i} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 px-3 font-mono font-bold text-slate-300">{dev.bssid}</td>
                    <td className="py-2 px-3 font-bold text-yellow-300">{dev.ssid}</td>
                    <td className="py-2 px-3 text-slate-300">CH {dev.channel || '—'}</td>
                    <td className="py-2 px-3 text-slate-300">{dev.vendor || '—'}</td>
                    <td className="py-2 px-3 text-[11px] text-slate-300">{dev.recommendation}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
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
      )}
    </div>
  );
}
