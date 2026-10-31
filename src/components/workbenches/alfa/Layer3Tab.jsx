// "layer3" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Network } from 'lucide-react';
import { getVendor } from '../../../utils/ouiLookup';

export default function Layer3Tab({
  clients,
  devices,
  layer3Mappings,
  setSelectedItem
}) {
  return (
    <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
          <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Mappings</div>
          <div className="text-2xl font-bold mt-1 text-cyan-400">
            {layer3Mappings.length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Correlated IP/MAC pairs</div>
        </div>

        <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3">
          <div className="text-[11px] text-cyan-300 uppercase font-semibold">ARP Resolutions</div>
          <div className="text-2xl font-bold text-cyan-300 mt-1">
            {layer3Mappings.filter(m => m.protocol === 'ARP').length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">EtherType 0x0806 queries</div>
        </div>

        <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl p-3">
          <div className="text-[11px] text-purple-300 uppercase font-semibold">DHCP Leases</div>
          <div className="text-2xl font-bold text-purple-400 mt-1">
            {layer3Mappings.filter(m => m.protocol === 'DHCP').length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">Port 67/68 transactions</div>
        </div>

        <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3">
          <div className="text-[11px] text-amber-300 uppercase font-semibold">Hostnames Identified</div>
          <div className="text-2xl font-bold text-amber-400 mt-1">
            {layer3Mappings.filter(m => Boolean(m.hostname)).length}
          </div>
          <div className="text-[10px] text-slate-500 mt-0.5">DHCP Option 12 host tags</div>
        </div>
      </div>

      {/* Table or Empty State */}
      {layer3Mappings.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-2">
          <Network className="w-10 h-10 text-cyan-400/60 mx-auto" />
          <div className="text-sm font-bold text-slate-200">No Layer 3 IP Mappings Captured Yet</div>
          <div className="text-xs text-slate-400 max-w-md mx-auto">
            As unencrypted Address Resolution Protocol (ARP) announcements or DHCP lease allocations transit the airspace, sender IP and MAC addresses will be decoded and correlated here in real-time.
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Protocol</th>
                <th className="py-2.5 px-3">IP Address</th>
                <th className="py-2.5 px-3">MAC Address</th>
                <th className="py-2.5 px-3">DHCP Hostname</th>
                <th className="py-2.5 px-3">Vendor OUI</th>
                <th className="py-2.5 px-3">Associated BSSID</th>
                <th className="py-2.5 px-3">Last Seen</th>
                <th className="py-2.5 px-3 text-right">Inspect</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {layer3Mappings.map((mapping, idx) => {
                const targetAp = devices[mapping.mac] || (mapping.bssid ? devices[mapping.bssid] : null);
                const targetClient = clients[mapping.mac];
                const inspectTarget = targetClient 
                  ? { type: 'client', data: targetClient } 
                  : targetAp 
                  ? { type: 'ap', data: targetAp } 
                  : null;

                return (
                  <tr key={`${mapping.mac}-${mapping.ip}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        mapping.protocol === 'DHCP'
                          ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                      }`}>
                        {mapping.protocol || 'ARP'}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                      <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px]">
                        {mapping.ip}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono font-bold text-slate-300 whitespace-nowrap">
                      {mapping.mac}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {mapping.hostname ? (
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[11px] font-semibold">
                          {mapping.hostname}
                        </span>
                      ) : (
                        <span className="text-slate-600 font-mono text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                      {mapping.vendor || getVendor(mapping.mac) || '—'}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">
                      {mapping.bssid || '—'}
                    </td>
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {mapping.timestamp ? new Date(mapping.timestamp).toLocaleTimeString() : '—'}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {inspectTarget ? (
                        <button
                          onClick={() => setSelectedItem(inspectTarget)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
                        >
                          Inspect
                        </button>
                      ) : (
                        <span className="text-slate-600 font-mono text-[10px]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
