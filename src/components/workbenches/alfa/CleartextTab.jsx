// "cleartext" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Globe } from 'lucide-react';

export default function CleartextTab({
  cleartextMetadata
}) {
  return (
    <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
      {cleartextMetadata.length === 0 ? (
        <div className="p-12 text-center text-slate-600 text-xs space-y-2">
          <Globe className="w-8 h-8 text-slate-600 mx-auto" />
          <div>No unencrypted cleartext telemetry observed yet.</div>
          <div className="text-slate-500">
            Cleartext DNS queries (UDP 53) and HTTP request streams (TCP 80) from unencrypted Data frames will be logged here.
          </div>
        </div>
      ) : (
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
            <tr>
              <th className="py-2.5 px-3">Timestamp</th>
              <th className="py-2.5 px-3">Protocol</th>
              <th className="py-2.5 px-3">Client Station MAC</th>
              <th className="py-2.5 px-3">Target BSSID</th>
              <th className="py-2.5 px-3">Observed Domain / Endpoint</th>
              <th className="py-2.5 px-3">CH</th>
              <th className="py-2.5 px-3 text-right">RSSI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {cleartextMetadata.map((meta, idx) => (
              <tr key={idx} className="hover:bg-slate-900/60 transition-colors">
                <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{meta.timestamp}</td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                    meta.protocol === 'DNS' 
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' 
                      : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  }`}>
                    {meta.protocol} {meta.type || ''}
                  </span>
                </td>
                <td className="py-2 px-3 font-mono font-bold text-slate-200 whitespace-nowrap">{meta.clientMac || '—'}</td>
                <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">{meta.bssid || '—'}</td>
                <td className="py-2 px-3 whitespace-nowrap">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-amber-300 font-mono">{meta.domain}</span>
                    {meta.endpoint && (
                      <span className="text-slate-400 font-mono text-[11px]">{meta.endpoint}</span>
                    )}
                  </div>
                </td>
                <td className="py-2 px-3 text-slate-300 whitespace-nowrap">CH {meta.channel || '—'}</td>
                <td className="py-2 px-3 text-right font-bold text-cyan-400 whitespace-nowrap">
                  {meta.rssi != null ? `${meta.rssi} dBm` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
