// "probing" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { getVendor } from '../../../utils/ouiLookup';
import { ROWS_PER_PAGE, Sparkline } from './shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export default function ProbingTab({
  getRssiBadge,
  probingClientList,
  renderClientOsIcon,
  selectedItem,
  setSelectedItem,
  setTablePage,
  tablePage,
  visibleProbingClientList
}) {
  return (
    <div>
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
        {probingClientList.length === 0 ? (
          <div className="p-12 text-center text-slate-600 text-xs space-y-2">
            <div>No probing client stations detected yet.</div>
            <div className="text-slate-500">
              Unassociated devices broadcast Probe Requests searching for preferred networks.
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Client Station MAC</th>
                <th className="py-2.5 px-3">Vendor (OUI)</th>
                <th className="py-2.5 px-3">Probed Networks (SSIDs)</th>
                <th className="py-2.5 px-3">RSSI</th>
                <th className="py-2.5 px-3">Signal Trend</th>
                <th className="py-2.5 px-3">CH</th>
                <th className="py-2.5 px-3">Packets</th>
                <th className="py-2.5 px-3 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {visibleProbingClientList.map((cli) => (
                <tr 
                  key={cli.clientMac} 
                  onClick={() => setSelectedItem({ type: 'client', data: cli })}
                  className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                    selectedItem?.data?.clientMac === cli.clientMac ? 'bg-amber-950/30 border-l-2 border-amber-400' : ''
                  }`}
                >
                  <td className="py-2 px-3 font-bold text-amber-300 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {renderClientOsIcon(cli)}
                      <span>{cli.clientMac}</span>
                    </div>
                  </td>
                  <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">
                    {cli.vendor || getVendor(cli.clientMac)}
                  </td>
                  <td className="py-2 px-3">
                    <div className="flex flex-wrap items-center gap-1 max-w-xs">
                      {cli.probedSsids && cli.probedSsids.length > 0 ? (
                        cli.probedSsids.map((s, idx) => (
                          <span key={idx} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                            {s}
                          </span>
                        ))
                      ) : cli.probedSsid ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                          {cli.probedSsid}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-[10px] italic">Wildcard Probes Only</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(cli.rssi)}`}>
                      {cli.rssi} dBm
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <Sparkline data={cli.rssiHistory} />
                  </td>
                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                    CH {cli.channel}
                  </td>
                  <td className="py-2 px-3 text-amber-300 font-semibold whitespace-nowrap">
                    {cli.packetCount}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">
                    {cli.lastSeen}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination controls if probing clients > 100 */}
      {probingClientList.length > ROWS_PER_PAGE && (
        <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing {(tablePage - 1) * ROWS_PER_PAGE + 1} - {Math.min(tablePage * ROWS_PER_PAGE, probingClientList.length)} of {probingClientList.length} Probing Clients
          </div>
          <div className="flex items-center gap-2">
            <button
              disabled={tablePage === 1}
              onClick={() => setTablePage(p => Math.max(1, p - 1))}
              className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              <span>Prev</span>
            </button>
            <span className="font-semibold text-slate-300">
              Page {tablePage} / {Math.ceil(probingClientList.length / ROWS_PER_PAGE)}
            </span>
            <button
              disabled={tablePage >= Math.ceil(probingClientList.length / ROWS_PER_PAGE)}
              onClick={() => setTablePage(p => p + 1)}
              className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
            >
              <span>Next</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
