// "watchlist" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { AlertTriangle, Star } from 'lucide-react';
import { getVendor } from '../../../utils/ouiLookup';
import { Sparkline } from './shared';

export default function WatchlistTab({
  getRssiBadge,
  setSelectedItem,
  toggleWatchlist,
  visibleWatchlistList,
  watchlistList
}) {
  return (
    <div>
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
        {watchlistList.length === 0 ? (
          <div className="p-12 text-center text-slate-600 text-xs space-y-2">
            <Star className="w-8 h-8 text-amber-500/40 mx-auto" />
            <div className="font-semibold text-slate-300">Your Watchlist is empty.</div>
            <div className="text-slate-500 max-w-sm mx-auto">
              Click the <span className="text-amber-400 font-bold">⭐ Star</span> icon in the Access Points or Clients table to pin targets for dedicated surveillance and offline tracking.
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3 w-8 text-center">⭐</th>
                <th className="py-2.5 px-3">Target Identifier</th>
                <th className="py-2.5 px-3">Node Type</th>
                <th className="py-2.5 px-3">SSID / Network Name</th>
                <th className="py-2.5 px-3">Vendor</th>
                <th className="py-2.5 px-3">RSSI</th>
                <th className="py-2.5 px-3">Signal Trend</th>
                <th className="py-2.5 px-3">CH</th>
                <th className="py-2.5 px-3">Packets</th>
                <th className="py-2.5 px-3 text-right">Status / Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {visibleWatchlistList.map((node) => {
                // Check if device has not been seen for over 60 seconds
                let isMissing = node.isMissing || false;
                if (!isMissing && node.lastSeen) {
                  const parts = node.lastSeen.split(/[:.]/);
                  if (parts.length >= 3) {
                    const now = new Date();
                    const lastSeenDate = new Date();
                    lastSeenDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3] || 0, 10));
                    if (now - lastSeenDate > 60000) {
                      isMissing = true;
                    }
                  }
                }

                return (
                  <tr 
                    key={node.targetIdentifier}
                    onClick={() => {
                      if (node.watchType === 'ap') setSelectedItem({ type: 'ap', data: node });
                      else if (node.watchType === 'client') setSelectedItem({ type: 'client', data: node });
                    }}
                    className={`cursor-pointer transition-colors ${
                      isMissing
                        ? 'bg-rose-950/30 hover:bg-rose-950/50 border-l-2 border-rose-500'
                        : 'hover:bg-slate-900/60'
                    }`}
                  >
                    <td 
                      className="py-2 px-3 text-center whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(node.targetIdentifier);
                      }}
                    >
                      <button
                        type="button"
                        title="Remove from Watchlist"
                        className="p-1 hover:scale-125 transition-transform"
                      >
                        <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                      </button>
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-amber-300 whitespace-nowrap">
                      {node.targetIdentifier}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        node.watchType === 'ap'
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                          : node.watchType === 'client'
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {node.watchType === 'ap' ? 'Access Point' : node.watchType === 'client' ? 'Client Station' : 'Target'}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-semibold text-slate-200">
                        {node.ssid || node.probedSsid || node.bssid || '—'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {node.vendor || getVendor(node.targetIdentifier)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(node.rssi)}`}>
                        {node.rssi != null ? `${node.rssi} dBm` : '—'}
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <Sparkline data={node.rssiHistory} />
                    </td>
                    <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                      {node.channel ? `CH ${node.channel}` : '—'}
                    </td>
                    <td className="py-2 px-3 font-semibold text-cyan-300 whitespace-nowrap">
                      {node.packetCount || 0}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {isMissing ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600/30 text-rose-300 border border-rose-500/50">
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                          Missing (&gt;60s)
                        </span>
                      ) : (
                        <span className="text-slate-400 text-xs font-mono">
                          {node.lastSeen || 'Active'}
                        </span>
                      )}
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
