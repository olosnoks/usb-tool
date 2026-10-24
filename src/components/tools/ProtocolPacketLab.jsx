import React, { useState, useEffect } from 'react';
import { Layers, Binary, Activity, Wifi, Filter, Terminal, Radio } from 'lucide-react';
import PacketAnalyzerWorkbench from './PacketAnalyzerWorkbench';
import KismetStudioWorkbench from './KismetStudioWorkbench';
import HexViewer from '../common/HexViewer';
import PacketFramer from '../PacketFramer';

export default function ProtocolPacketLab({
  initialTab = 'analyzer',
  byteStream = [],
  hexByteStream = [],
  onClearHex,
  isConnected = false
}) {
  const [activeSubTab, setActiveSubTab] = useState(
    initialTab === 'hex' ? 'hex' : initialTab === 'packets' ? 'packets' : initialTab === 'kismet' ? 'kismet' : 'analyzer'
  );

  useEffect(() => {
    if (initialTab === 'hex' || initialTab === 'packets' || initialTab === 'analyzer' || initialTab === 'kismet') {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="w-full space-y-4">
      {/* Suite Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-purple-500/10 border border-purple-500/30 rounded-lg text-purple-400">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              PACKET & PROTOCOL LAB
              <span className="text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                Unified Suite
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              802.11 Wi-Fi frames, PCAP exporter, real-time hex inspection & SLIP/COBS packet framing
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveSubTab('analyzer')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'analyzer'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>Wi-Fi & PCAP Analyzer</span>
          </button>
          <button
            onClick={() => setActiveSubTab('kismet')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'kismet'
                ? 'bg-gradient-to-r from-purple-500/30 to-indigo-500/30 text-purple-200 border border-purple-500/50 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-purple-400" />
            <span>Kismet Studio (Alfa / 802.11)</span>
          </button>
          <button
            onClick={() => setActiveSubTab('hex')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'hex'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Binary className="w-3.5 h-3.5" />
            <span>Hex Stream Viewer</span>
          </button>
          <button
            onClick={() => setActiveSubTab('packets')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'packets'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Packet Framer (SLIP / COBS)</span>
          </button>
        </div>
      </div>

      {/* Active Tab View */}
      <div className="w-full">
        {activeSubTab === 'analyzer' && <PacketAnalyzerWorkbench />}
        {activeSubTab === 'kismet' && <KismetStudioWorkbench />}
        {activeSubTab === 'hex' && (
          <HexViewer
            byteStream={hexByteStream}
            onClear={onClearHex}
            maxDisplayBytes={4096}
          />
        )}
        {activeSubTab === 'packets' && (
          <PacketFramer
            activeHexByteStream={hexByteStream}
            isConnected={isConnected}
          />
        )}
      </div>
    </div>
  );
}
