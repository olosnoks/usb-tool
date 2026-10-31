// "aps" tab of the Wi-Fi Monitor workbench (AlfaWifiWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Layers, Lock, Play, Radar, ShieldAlert, ShieldCheck, Star } from 'lucide-react';
import React from 'react';
import { ROWS_PER_PAGE, Sparkline } from './shared';
import { getVendor } from '../../../utils/ouiLookup';
import { calculateHaversineDistance } from '../../../utils/wardrivingExporter';

export default function ApsTab({
  apList,
  bssidClusterMap,
  channel,
  clusteredApDisplayList,
  currentGps,
  deviceAnnotations,
  expandedClusters,
  getRssiBadge,
  getSecurityBadge,
  getSnrBadge,
  handleChannelChange,
  handleStartMonitor,
  handshakes,
  isAutoHop,
  isCapturingRef,
  isGpsTagging,
  isGroupByCluster,
  isMonitoring,
  isNewDeviceSinceBaseline,
  selectedItem,
  setExpandedClusters,
  setIsAutoHop,
  setIsGroupByCluster,
  setIsMonitoring,
  setIsSetupGuideOpen,
  setIsSimulateRf,
  setSelectedItem,
  setSetupGuideError,
  setTablePage,
  tablePage,
  toggleWatchlist,
  visibleApList,
  watchlist
}) {
  return (
    <div>
      <div className="overflow-x-auto max-h-[75vh] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
        {apList.length === 0 ? (
          <div className="p-8 text-center text-xs space-y-4 max-w-xl mx-auto my-4 bg-slate-900/40 rounded-xl border border-slate-800/80">
            <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto text-cyan-400">
              <Radar className={`w-6 h-6 ${isMonitoring ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-200">
                {isMonitoring ? 'Scanning Airwaves — No Networks Captured Yet' : 'Monitor Inactive — Adapter Ready'}
              </div>
              <div className="text-slate-400 text-[11px] mt-1 max-w-md mx-auto">
                {isMonitoring
                  ? `Listening on Channel ${channel} (${Number(channel) > 14 ? '5 GHz' : '2.4 GHz'}). If you're on a 5GHz channel without local APs, try hopping to 2.4GHz where beacon traffic is highest.`
                  : 'Click Start Monitor to begin capturing 802.11 beacons and probe frames with your Alfa adapter.'}
              </div>
            </div>

            {/* Quick Diagnostic Actions */}
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-slate-800/60">
              {!isMonitoring && (
                <button
                  type="button"
                  onClick={handleStartMonitor}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-emerald-glow"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Start Monitor</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleChannelChange(1)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  channel === 1 || channel === '1'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
                title="Tune hardware to 2.4 GHz Channel 1"
              >
                Tune Ch 1 (2.4G)
              </button>
              <button
                type="button"
                onClick={() => handleChannelChange(6)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  channel === 6 || channel === '6'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
                title="Tune hardware to 2.4 GHz Channel 6"
              >
                Tune Ch 6 (2.4G)
              </button>
              <button
                type="button"
                onClick={() => handleChannelChange(11)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  channel === 11 || channel === '11'
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
                title="Tune hardware to 2.4 GHz Channel 11"
              >
                Tune Ch 11 (2.4G)
              </button>
              <button
                type="button"
                onClick={() => setIsAutoHop(prev => !prev)}
                className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                  isAutoHop
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                    : 'bg-slate-950 text-purple-300 border-slate-800 hover:border-slate-700'
                }`}
                title="Toggle automatic channel hopping across 2.4G and 5G bands"
              >
                {isAutoHop ? 'Disable Auto-Hop' : 'Enable Auto-Hop Scan'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsSimulateRf(true);
                  if (!isMonitoring) {
                    setIsMonitoring(true);
                    isCapturingRef.current = true;
                  }
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-cyan-300 hover:border-cyan-500/40 text-xs font-semibold transition"
                title="Generate realistic simulated 802.11 beacon, probe, and handshake traffic"
              >
                Simulate RF (Demo)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSetupGuideError(null);
                  setIsSetupGuideOpen(true);
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-amber-300 hover:border-amber-500/40 text-xs font-semibold transition"
                title="Open Windows WebUSB WinUSB Driver Configuration Guide"
              >
                Driver Guide
              </button>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
              <tr>
                <th className="py-2.5 px-3 w-8 text-center">⭐</th>
                <th className="py-2.5 px-3">BSSID</th>
                <th className="py-2.5 px-3">IP Address</th>
                <th className="py-2.5 px-3">SSID / Network Name</th>
                <th className="py-2.5 px-3">Cluster</th>
                <th className="py-2.5 px-3">Security</th>
                <th className="py-2.5 px-3">Roaming</th>
                <th className="py-2.5 px-3">Handshake</th>
                <th className="py-2.5 px-3">RSSI</th>
                <th className="py-2.5 px-3">SNR</th>
                <th className="py-2.5 px-3">Signal Trend</th>
                <th className="py-2.5 px-3">CH</th>
                {isGpsTagging && <th className="py-2.5 px-3">Distance</th>}
                <th className="py-2.5 px-3">Vendor</th>
                <th className="py-2.5 px-3">Packets</th>
                <th className="py-2.5 px-3 text-right">Last Seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900">
              {isGroupByCluster ? (
                clusteredApDisplayList.map((entry) => {
                  if (entry.isCluster) {
                    const isExpanded = Boolean(expandedClusters[entry.id]);
                    const totalPkts = entry.devices.reduce((acc, d) => acc + (d.packetCount || 1), 0);
                    return (
                      <React.Fragment key={entry.id}>
                        <tr
                          onClick={() => setExpandedClusters(prev => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                          className="bg-slate-900/80 hover:bg-slate-800/80 cursor-pointer border-l-4 border-cyan-500 transition-colors"
                        >
                          <td className="py-2.5 px-3 text-center">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-cyan-400 inline-block" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-cyan-400 inline-block" />
                            )}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                            {entry.bssid}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-100">{entry.name}</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                                Cluster ({entry.count} BSSIDs)
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 font-semibold inline-flex items-center gap-1">
                              <Layers className="w-3 h-3 text-cyan-400" />
                              Node Group ({entry.count})
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-300">{entry.security}</td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                          <td className="py-2.5 px-3 whitespace-nowrap font-bold text-cyan-400">
                            <span className={`px-2 py-0.5 rounded text-[10px] border ${getRssiBadge(entry.rssi)}`}>
                              {entry.rssi} dBm
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                          <td className="py-2.5 px-3 text-cyan-300 font-mono whitespace-nowrap">CH {entry.channel}</td>
                          {isGpsTagging && <td className="py-2.5 px-3 text-slate-600 font-mono text-[10px]">—</td>}
                          <td className="py-2.5 px-3 text-slate-300 font-semibold whitespace-nowrap">{entry.vendor}</td>
                          <td className="py-2.5 px-3 text-purple-300 font-semibold whitespace-nowrap">{totalPkts}</td>
                          <td className="py-2.5 px-3 text-right text-cyan-400 font-semibold text-[11px] whitespace-nowrap">
                            {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
                          </td>
                        </tr>

                        {isExpanded && entry.devices.map((dev) => {
                          const isNew = isNewDeviceSinceBaseline(dev);
                          const devAnnotation = deviceAnnotations[dev.bssid.toUpperCase()] || null;
                          return (
                            <tr 
                              key={dev.bssid} 
                              onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                              style={devAnnotation?.customColor ? { borderLeftColor: devAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                              className={`hover:bg-slate-900/60 cursor-pointer transition-colors bg-slate-950/90 ${
                                devAnnotation?.customColor ? '' : 'border-l-2 border-cyan-500/40'
                              } ${
                                selectedItem?.data?.bssid === dev.bssid ? 'bg-cyan-950/40' : ''
                              }`}
                            >
                              <td 
                                className="py-2 px-3 text-center whitespace-nowrap pl-4"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleWatchlist(dev.bssid);
                                }}
                              >
                                <button
                                  type="button"
                                  title={watchlist.includes(dev.bssid.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                  className="p-1 hover:scale-125 transition-transform"
                                >
                                  <Star className={`w-3.5 h-3.5 ${
                                    watchlist.includes(dev.bssid.toUpperCase()) 
                                      ? 'text-amber-400 fill-amber-400' 
                                      : 'text-slate-600 hover:text-amber-300'
                                  }`} />
                                </button>
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap pl-5">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-slate-500">↳</span>
                                  <span className="font-mono">{dev.bssid}</span>
                                  {isNew && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                                      NEW
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono text-cyan-300 whitespace-nowrap">
                                {dev.ipAddress ? (
                                  <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px] text-cyan-300 font-bold">
                                    {dev.ipAddress}
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {devAnnotation?.customLabel ? (
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1 font-bold text-amber-300">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: devAnnotation.customColor || '#f59e0b' }} />
                                      <span className="truncate max-w-[140px]">{devAnnotation.customLabel}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 truncate max-w-[140px] font-mono">
                                      {dev.ssid}
                                    </span>
                                  </div>
                                ) : (
                                  <span className={`font-semibold ${
                                    dev.ssid === '<Hidden SSID>' ? 'text-slate-500 italic' : 'text-cyan-300'
                                  }`}>
                                    {dev.ssid}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className="text-[10px] text-slate-500 font-mono">Cluster Member</span>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(dev.security)}`}>
                                    {dev.security || 'Open'}
                                  </span>
                                  {dev.isWifi6 && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                      Wi-Fi 6
                                    </span>
                                  )}
                                  {(dev.isMfpRequired || dev.isMfpCapable || dev.mfp) && (
                                    <span 
                                      className="text-emerald-400 cursor-help flex items-center"
                                      title={dev.isMfpRequired || dev.mfp === 'required' ? "802.11w MFP Required" : "802.11w MFP Supported"}
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  {dev.roaming?.k && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">k</span>}
                                  {dev.roaming?.v && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">v</span>}
                                  {dev.roaming?.r && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">r</span>}
                                  {!dev.roaming?.k && !dev.roaming?.v && !dev.roaming?.r && <span className="text-slate-600 font-mono text-[10px]">—</span>}
                                </div>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {handshakes[dev.bssid]?.isComplete || dev.hasHandshake ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                    <Lock className="w-3 h-3 text-emerald-400" /> Complete
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono pl-2">-</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(dev.rssi)}`}>
                                  {dev.rssi} dBm
                                </span>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {dev.snr !== null && dev.snr !== undefined ? (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(dev.snr)}`}>
                                    {dev.snr} dB
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <Sparkline data={dev.rssiHistory} />
                              </td>
                              <td className="py-2 px-3 text-slate-300 whitespace-nowrap">CH {dev.channel}</td>
                              {isGpsTagging && <td className="py-2 px-3 text-slate-600 font-mono text-[10px]">—</td>}
                              <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">{dev.vendor || getVendor(dev.bssid)}</td>
                              <td className="py-2 px-3 text-purple-300 font-semibold whitespace-nowrap">{dev.packetCount}</td>
                              <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">{dev.lastSeen}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  }

                  const singleDev = entry.devices ? entry.devices[0] : entry;
                  const isNew = isNewDeviceSinceBaseline(singleDev);
                  const singleDevAnnotation = deviceAnnotations[singleDev.bssid.toUpperCase()] || null;
                  return (
                    <tr 
                      key={singleDev.bssid} 
                      onClick={() => setSelectedItem({ type: 'ap', data: singleDev })}
                      style={singleDevAnnotation?.customColor ? { borderLeftColor: singleDevAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                      className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                        singleDevAnnotation?.customColor ? '' : selectedItem?.data?.bssid === singleDev.bssid ? 'bg-cyan-950/30 border-l-2 border-cyan-400' : isNew ? 'bg-purple-950/20 border-l-2 border-purple-500' : ''
                      }`}
                    >
                      <td 
                        className="py-2 px-3 text-center whitespace-nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatchlist(singleDev.bssid);
                        }}
                      >
                        <button
                          type="button"
                          title={watchlist.includes(singleDev.bssid.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                          className="p-1 hover:scale-125 transition-transform"
                        >
                          <Star className={`w-3.5 h-3.5 ${
                            watchlist.includes(singleDev.bssid.toUpperCase()) 
                              ? 'text-amber-400 fill-amber-400' 
                              : 'text-slate-600 hover:text-amber-300'
                          }`} />
                        </button>
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{singleDev.bssid}</span>
                          {isNew && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                              NEW
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 font-mono text-cyan-300 whitespace-nowrap">
                        {singleDev.ipAddress ? (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px] text-cyan-300 font-bold">
                            {singleDev.ipAddress}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {singleDevAnnotation?.customLabel ? (
                          <div className="flex flex-col">
                            <div className="flex items-center gap-1 font-bold text-amber-300">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: singleDevAnnotation.customColor || '#f59e0b' }} />
                              <span className="truncate max-w-[140px]">{singleDevAnnotation.customLabel}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 truncate max-w-[140px] font-mono">
                              {singleDev.ssid}
                            </span>
                          </div>
                        ) : (
                          <span className={`font-semibold ${
                            singleDev.ssid === '<Hidden SSID>' ? 'text-slate-500 italic' : 'text-cyan-300'
                          }`}>
                            {singleDev.ssid}
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">
                        —
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(singleDev.security)}`}>
                            {singleDev.security || 'Open'}
                          </span>
                          {singleDev.isWifi6 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                              Wi-Fi 6
                            </span>
                          )}
                          {(singleDev.isMixedMode || singleDev.security?.includes('Mixed')) && (
                            <span className="text-amber-400 cursor-help" title="Mixed-Mode Encryption (WPA2/WPA3)">
                              <ShieldAlert className="w-4 h-4 text-amber-400" />
                            </span>
                          )}
                          {(singleDev.isMfpRequired || singleDev.isMfpCapable || singleDev.mfp) && (
                            <span 
                              className="text-emerald-400 cursor-help flex items-center"
                              title={singleDev.isMfpRequired || singleDev.mfp === 'required' ? "802.11w MFP Required" : "802.11w MFP Supported"}
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {singleDev.roaming?.k && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">k</span>}
                          {singleDev.roaming?.v && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">v</span>}
                          {singleDev.roaming?.r && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">r</span>}
                          {!singleDev.roaming?.k && !singleDev.roaming?.v && !singleDev.roaming?.r && <span className="text-slate-600 font-mono text-[10px]">—</span>}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {handshakes[singleDev.bssid]?.isComplete || singleDev.hasHandshake ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                            <Lock className="w-3 h-3 text-emerald-400" /> Complete
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono pl-2">-</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(singleDev.rssi)}`}>
                          {singleDev.rssi} dBm
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {singleDev.snr !== null && singleDev.snr !== undefined ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(singleDev.snr)}`}>
                            {singleDev.snr} dB
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <Sparkline data={singleDev.rssiHistory} />
                      </td>
                      <td className="py-2 px-3 text-slate-300 whitespace-nowrap">CH {singleDev.channel}</td>
                      {isGpsTagging && <td className="py-2 px-3 text-slate-600 font-mono text-[10px]">—</td>}
                      <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">{singleDev.vendor || getVendor(singleDev.bssid)}</td>
                      <td className="py-2 px-3 text-purple-300 font-semibold whitespace-nowrap">{singleDev.packetCount}</td>
                      <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">{singleDev.lastSeen}</td>
                    </tr>
                  );
                })
              ) : (
                visibleApList.map((dev) => {
                  const isNew = isNewDeviceSinceBaseline(dev);
                  const cluster = bssidClusterMap.get(dev.bssid);
                  return (
                    <tr 
                      key={dev.bssid} 
                      onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                      className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                        selectedItem?.data?.bssid === dev.bssid ? 'bg-cyan-950/30 border-l-2 border-cyan-400' : ''
                      } ${isNew ? 'bg-purple-950/20 border-l-2 border-purple-500' : ''}`}
                    >
                      <td 
                        className="py-2 px-3 text-center whitespace-nowrap"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWatchlist(dev.bssid);
                        }}
                      >
                        <button
                          type="button"
                          title={watchlist.includes(dev.bssid.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                          className="p-1 hover:scale-125 transition-transform"
                        >
                          <Star className={`w-3.5 h-3.5 ${
                            watchlist.includes(dev.bssid.toUpperCase()) 
                              ? 'text-amber-400 fill-amber-400' 
                              : 'text-slate-600 hover:text-amber-300'
                          }`} />
                        </button>
                      </td>
                      <td className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{dev.bssid}</span>
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
                      <td className="py-2 px-3 font-mono text-cyan-300 whitespace-nowrap">
                        {dev.ipAddress ? (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px] text-cyan-300 font-bold">
                            {dev.ipAddress}
                          </span>
                        ) : (
                          <span className="text-slate-600 font-mono text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`font-semibold ${
                            dev.ssid === '<Hidden SSID>' ? 'text-slate-500 italic' : 'text-cyan-300'
                          }`}>
                            {dev.ssid}
                          </span>
                          {(dev.isUnmasked || dev.originalHidden) && dev.ssid !== '<Hidden SSID>' && (
                            <span 
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0"
                              title="Hidden SSID unmasked via correlated client probe/association frames"
                            >
                              <Lock className="w-2.5 h-2.5 text-amber-400" />
                              <span>(Unmasked)</span>
                            </span>
                          )}
                          {dev.isRogueSuspect && (
                            <span 
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-600/30 text-rose-300 border border-rose-500/50 flex items-center gap-1 shrink-0"
                              title={dev.rogueReason || 'Rogue AP / Evil Twin Suspect'}
                            >
                              <AlertTriangle className="w-2.5 h-2.5" /> Rogue Suspect
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {cluster ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsGroupByCluster(true);
                              setExpandedClusters(prev => ({ ...prev, [cluster.id]: true }));
                            }}
                            className="px-2 py-0.5 rounded text-[10px] bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 font-semibold inline-flex items-center gap-1 transition"
                            title={`${cluster.name}\nClick to view grouped cluster`}
                          >
                            <Layers className="w-3 h-3 text-cyan-400" />
                            <span>Node Group ({cluster.count})</span>
                          </button>
                        ) : (
                          <span className="text-slate-600 font-mono text-[10px]">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(dev.security)}`}>
                            {dev.security || 'Open'}
                          </span>
                          {dev.isWifi6 && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                              Wi-Fi 6
                            </span>
                          )}
                          {(dev.isMixedMode || dev.security?.includes('Mixed')) && (
                            <span 
                              className="text-amber-400 cursor-help"
                              title="Mixed-Mode Encryption (WPA2/WPA3)"
                            >
                              <ShieldAlert className="w-4 h-4 text-amber-400" />
                            </span>
                          )}
                          {(dev.isMfpRequired || dev.isMfpCapable || dev.mfp) && (
                            <span 
                              className="text-emerald-400 cursor-help flex items-center"
                              title={dev.isMfpRequired || dev.mfp === 'required' ? "802.11w MFP Required" : "802.11w MFP Supported"}
                            >
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          {dev.roaming?.k && (
                            <span 
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-help"
                              title="802.11k: Radio Resource Measurement (neighbor reports & channel load)"
                            >
                              k
                            </span>
                          )}
                          {dev.roaming?.v && (
                            <span 
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-help"
                              title="802.11v: Wireless Network Management (BSS Transition Management)"
                            >
                              v
                            </span>
                          )}
                          {dev.roaming?.r && (
                            <span 
                              className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-help"
                              title="802.11r: Fast BSS Transition (FT handshake across APs)"
                            >
                              r
                            </span>
                          )}
                          {!dev.roaming?.k && !dev.roaming?.v && !dev.roaming?.r && (
                            <span className="text-slate-600 font-mono text-[10px]">—</span>
                          )}
                        </div>
                      </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {handshakes[dev.bssid]?.isComplete || dev.hasHandshake ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <Lock className="w-3 h-3 text-emerald-400" />
                          Complete
                        </span>
                      ) : (
                        <span className="text-slate-600 font-mono pl-2">-</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(dev.rssi)}`}>
                        {dev.rssi} dBm
                      </span>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {dev.snr !== null && dev.snr !== undefined ? (
                        <span 
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(dev.snr)}`}
                          title={`SNR: ${dev.snr} dB (RSSI: ${dev.rssi} dBm, Noise: ${dev.noiseFloor ?? -95} dBm)`}
                        >
                          {dev.snr} dB
                        </span>
                      ) : (
                        <span className="text-slate-600 font-mono text-[10px]">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <Sparkline data={dev.rssiHistory} />
                    </td>
                    <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                      CH {dev.channel}
                    </td>
                    {isGpsTagging && (
                      <td className="py-2 px-3 text-cyan-300 font-mono whitespace-nowrap">
                        {(() => {
                          if (dev.latitude != null && dev.longitude != null && currentGps?.latitude != null && currentGps?.longitude != null) {
                            const dist = calculateHaversineDistance(
                              currentGps.latitude,
                              currentGps.longitude,
                              dev.latitude,
                              dev.longitude
                            );
                            return dist !== null ? `${dist.toLocaleString()} m` : '—';
                          }
                          return <span className="text-slate-600 font-mono">—</span>;
                        })()}
                      </td>
                    )}
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">
                      {dev.vendor || getVendor(dev.bssid)}
                    </td>
                    <td className="py-2 px-3 text-purple-300 font-semibold whitespace-nowrap">
                      {dev.packetCount}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">
                      {dev.lastSeen}
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination controls if rows > 100 */}
      {apList.length > ROWS_PER_PAGE && (
        <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing {(tablePage - 1) * ROWS_PER_PAGE + 1} - {Math.min(tablePage * ROWS_PER_PAGE, apList.length)} of {apList.length} APs
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
              Page {tablePage} / {Math.ceil(apList.length / ROWS_PER_PAGE)}
            </span>
            <button
              disabled={tablePage >= Math.ceil(apList.length / ROWS_PER_PAGE)}
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
