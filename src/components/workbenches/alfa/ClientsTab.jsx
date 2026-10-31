// "clients" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { getVendor } from '../../../utils/ouiLookup';
import { ROWS_PER_PAGE, Sparkline } from './shared';

export default function ClientsTab({
  clientList,
  deviceAnnotations,
  getRssiBadge,
  getSnrBadge,
  isNewDeviceSinceBaseline,
  renderClientOsIcon,
  selectedItem,
  setSelectedItem,
  setTablePage,
  signatureRandomizedMacs,
  tablePage,
  toggleWatchlist,
  visibleClientList,
  watchlist
}) {
  return (
    <div>
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
        {clientList.length === 0 ? (
          <div className="p-12 text-center text-slate-600 text-xs space-y-2">
            <div>No client devices detected yet.</div>
            <div className="text-slate-500">
              Client devices are detected from live Data frames and Probe Requests.
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3 w-8 text-center">⭐</th>
                <th className="py-2.5 px-3">Client MAC</th>
                <th className="py-2.5 px-3">IP Address</th>
                <th className="py-2.5 px-3">Associated BSSID</th>
                <th className="py-2.5 px-3">Vendor OUI</th>
                <th className="py-2.5 px-3">Signature</th>
                <th className="py-2.5 px-3">RSSI</th>
                <th className="py-2.5 px-3">SNR</th>
                <th className="py-2.5 px-3">Signal Trend</th>
                <th className="py-2.5 px-3">CH</th>
                <th className="py-2.5 px-3">Packets</th>
                <th className="py-2.5 px-3 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {visibleClientList.map((cli) => {
                const isNew = isNewDeviceSinceBaseline(cli);
                const cliAnnotation = deviceAnnotations[cli.clientMac.toUpperCase()] || null;
                return (
                  <tr 
                    key={cli.clientMac} 
                    onClick={() => setSelectedItem({ type: 'client', data: cli })}
                    style={cliAnnotation?.customColor ? { borderLeftColor: cliAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                    className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                      cliAnnotation?.customColor ? '' : selectedItem?.data?.clientMac === cli.clientMac ? 'bg-purple-950/30 border-l-2 border-purple-400' : isNew ? 'bg-purple-950/20 border-l-2 border-purple-500' : ''
                    }`}
                  >
                    <td 
                      className="py-2 px-3 text-center whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatchlist(cli.clientMac);
                      }}
                    >
                      <button
                        type="button"
                        title={watchlist.includes(cli.clientMac.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                        className="p-1 hover:scale-125 transition-transform"
                      >
                        <Star className={`w-3.5 h-3.5 ${
                          watchlist.includes(cli.clientMac.toUpperCase()) 
                            ? 'text-amber-400 fill-amber-400' 
                            : 'text-slate-600 hover:text-amber-300'
                        }`} />
                      </button>
                    </td>
                    <td className="py-2 px-3 font-bold text-purple-300 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {renderClientOsIcon(cli)}
                        {cliAnnotation?.customLabel ? (
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1 font-bold text-amber-300">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cliAnnotation.customColor || '#a855f7' }} />
                              <span className="truncate max-w-[140px]">{cliAnnotation.customLabel}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {cli.clientMac}
                            </span>
                          </div>
                        ) : (
                          <span>{cli.clientMac}</span>
                        )}
                        {isNew && (
                          <span 
                            className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0"
                            title="Discovered after saved baseline snapshot"
                          >
                            NEW
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 font-mono whitespace-nowrap">
                      {cli.ipAddress ? (
                        <div className="flex flex-col">
                          <span className="text-cyan-300 font-bold text-[11px]">{cli.ipAddress}</span>
                          {cli.dhcpHostname && (
                            <span className="text-[10px] text-amber-300 font-sans">({cli.dhcpHostname})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-600 font-mono text-[10px]">—</span>
                      )}
                    </td>
                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                    {cli.bssid}
                  </td>
                  <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">
                    {cli.vendor || getVendor(cli.clientMac)}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span 
                        className="font-mono text-[10px] text-slate-400 max-w-[110px] truncate block" 
                        title={cli.signature || 'No IE tags captured'}
                      >
                        {cli.signature || '—'}
                      </span>
                      {signatureRandomizedMacs.has(cli.clientMac) && (
                        <span 
                          className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0"
                          title="Multiple hardware addresses broadcast the exact same Information Element signature within 10 min window"
                        >
                          Potential Randomization
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(cli.rssi)}`}>
                      {cli.rssi} dBm
                    </span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    {cli.snr !== null && cli.snr !== undefined ? (
                      <span 
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(cli.snr)}`}
                        title={`SNR: ${cli.snr} dB (RSSI: ${cli.rssi} dBm, Noise: ${cli.noiseFloor ?? -95} dBm)`}
                      >
                        {cli.snr} dB
                      </span>
                    ) : (
                      <span className="text-slate-600 font-mono text-[10px]">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <Sparkline data={cli.rssiHistory} />
                  </td>
                  <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                    CH {cli.channel}
                  </td>
                  <td className="py-2 px-3 text-cyan-300 font-semibold whitespace-nowrap">
                    {cli.packetCount}
                  </td>
                  <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">
                    {cli.lastSeen}
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination controls if clients > 100 */}
      {clientList.length > ROWS_PER_PAGE && (
        <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing {(tablePage - 1) * ROWS_PER_PAGE + 1} - {Math.min(tablePage * ROWS_PER_PAGE, clientList.length)} of {clientList.length} Clients
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
              Page {tablePage} / {Math.ceil(clientList.length / ROWS_PER_PAGE)}
            </span>
            <button
              disabled={tablePage >= Math.ceil(clientList.length / ROWS_PER_PAGE)}
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
