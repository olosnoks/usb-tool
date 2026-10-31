// "frames" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.


export default function FramesTab({
  frames
}) {
  return (
    <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
      {frames.length === 0 ? (
        <div className="p-12 text-center text-slate-600 text-xs">
          No frames captured yet.
        </div>
      ) : (
        <table className="w-full text-left text-xs border-collapse">
          <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase">
            <tr>
              <th className="py-2 px-3">Time</th>
              <th className="py-2 px-3">Type</th>
              <th className="py-2 px-3">SSID / Info</th>
              <th className="py-2 px-3">Station / Source</th>
              <th className="py-2 px-3">BSSID</th>
              <th className="py-2 px-3">CH</th>
              <th className="py-2 px-3 text-right">RSSI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {frames.map((f, idx) => (
              <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{f.timestamp || f.lastSeen}</td>
                <td className="py-1.5 px-3 whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    f.isDeauth ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                    f.frameCategory === 'Data' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' :
                    'bg-slate-800 text-slate-300'
                  }`}>
                    {f.type}
                  </span>
                </td>
                <td className="py-1.5 px-3 text-cyan-300 whitespace-nowrap font-medium">
                  {f.ssid || f.reasonDescription || f.direction || '-'}
                </td>
                <td className="py-1.5 px-3 text-slate-300 whitespace-nowrap">{f.stationMac || f.sourceMac}</td>
                <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{f.bssid}</td>
                <td className="py-1.5 px-3 text-slate-300 whitespace-nowrap">CH {f.channel}</td>
                <td className="py-1.5 px-3 text-right whitespace-nowrap font-bold text-cyan-400">
                  {f.rssi} dBm
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
