// "roaming" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { ArrowRightLeft } from 'lucide-react';
import { lookupVendor } from '../../../utils/wifiParser';

export default function RoamingTab({
  deviceAnnotations,
  roamHistory,
  setRoamHistory
}) {
  return (
    <div className="p-4 space-y-4">
      {/* Top Controls & KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Roam Events</div>
          <div className="text-xl font-bold text-cyan-300 font-mono mt-0.5">
            {roamHistory.length}
          </div>
        </div>
        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="text-[10px] text-slate-500 uppercase font-semibold">Fastest Roam</div>
          <div className="text-xl font-bold text-emerald-400 font-mono mt-0.5">
            {roamHistory.length > 0 ? `${Math.min(...roamHistory.map(r => r.roamTime))} ms` : '—'}
          </div>
        </div>
        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Roam Time</div>
          <div className="text-xl font-bold text-amber-300 font-mono mt-0.5">
            {roamHistory.length > 0 
              ? `${Math.round(roamHistory.reduce((acc, r) => acc + r.roamTime, 0) / roamHistory.length)} ms`
              : '—'}
          </div>
        </div>
        <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between">
          <div>
            <div className="text-[10px] text-slate-500 uppercase font-semibold">Roaming Clients</div>
            <div className="text-xl font-bold text-purple-300 font-mono mt-0.5">
              {new Set(roamHistory.map(r => r.clientMac)).size}
            </div>
          </div>
          {roamHistory.length > 0 && (
            <button
              onClick={() => setRoamHistory([])}
              className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-300 text-[10px] font-semibold border border-slate-700 transition"
              title="Clear roaming event log"
            >
              Clear Log
            </button>
          )}
        </div>
      </div>

      {/* Roaming Events Table */}
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
        {roamHistory.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <ArrowRightLeft className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
            <p className="font-semibold text-slate-400">No client roaming handoffs detected yet.</p>
            <p className="text-[11px] text-slate-600 mt-1 max-w-md mx-auto">
              A roaming handoff is automatically logged when a client station switches association between Access Points within 30 seconds.
            </p>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase">
              <tr>
                <th className="py-2.5 px-3">Timestamp</th>
                <th className="py-2.5 px-3">Client MAC</th>
                <th className="py-2.5 px-3">From BSSID</th>
                <th className="py-2.5 px-3">To BSSID</th>
                <th className="py-2.5 px-3">Roam Time</th>
                <th className="py-2.5 px-3">CH</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {roamHistory.map((roam) => {
                const clientAnnotation = deviceAnnotations[roam.clientMac?.toUpperCase()] || null;
                const clientVendor = lookupVendor(roam.clientMac);

                let timeBadge = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                if (roam.roamTime > 1000) {
                  timeBadge = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
                } else if (roam.roamTime > 300) {
                  timeBadge = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                }

                return (
                  <tr 
                    key={roam.id}
                    className="hover:bg-slate-900/50 transition-colors"
                  >
                    <td className="py-2 px-3 text-slate-400 font-mono whitespace-nowrap">
                      {roam.timestamp}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <div className="flex flex-col">
                        {clientAnnotation?.customLabel ? (
                          <span className="font-bold text-amber-300">{clientAnnotation.customLabel}</span>
                        ) : null}
                        <span className="font-mono text-cyan-300 font-bold">{roam.clientMac}</span>
                        <span className="text-[10px] text-slate-500">{clientVendor}</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-rose-300/90">
                      {roam.fromBssid}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap font-mono text-emerald-300/90">
                      {roam.toBssid}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${timeBadge}`}>
                        {roam.roamTime} ms
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-slate-400">
                      CH {roam.channel || '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
