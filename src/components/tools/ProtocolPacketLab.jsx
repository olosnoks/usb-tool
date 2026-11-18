import React, { useState, useEffect } from 'react';
import { Layers, Binary, Wifi, Radio } from 'lucide-react';
import PacketAnalyzerWorkbench from './PacketAnalyzerWorkbench';
import KismetStudioWorkbench from './KismetStudioWorkbench';
import HexViewer from '../common/HexViewer';
import PacketFramer from '../PacketFramer';

export default function ProtocolPacketLab({
  initialTab = 'analyzer',
  byteStream = [],
  hexByteStream = [],
  onClearHex,
  isConnected = false,
  onLogMessage
}) {
  const [activeSubTab, setActiveSubTab] = useState(
    initialTab === 'hex' ? 'hex' : initialTab === 'packets' ? 'packets' : initialTab === 'kismet' ? 'kismet' : 'analyzer'
  );

  useEffect(() => {
    if (initialTab === 'hex' || initialTab === 'packets' || initialTab === 'analyzer' || initialTab === 'kismet') {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  const tabs = [
    { id: 'analyzer', label: 'Wi-Fi & PCAP Analyzer', Icon: Wifi, active: 'purple', title: 'Open and inspect radiotap .pcap captures' },
    { id: 'kismet', label: 'Kismet Studio (Alfa / 802.11)', Icon: Radio, active: 'purple', title: 'Kismet server client for 802.11 monitor setups' },
    { id: 'hex', label: 'Hex Stream Viewer', Icon: Binary, active: 'cyan', title: 'Live hex/ASCII view of the serial stream' },
    { id: 'packets', label: 'Packet Framer (SLIP / COBS)', Icon: Layers, active: 'emerald', title: 'Frame the serial stream into packets' },
  ];
  const activeClass = {
    purple: 'bg-purple-500/20 text-purple-300 border border-purple-500/40',
    cyan: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40',
    emerald: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
  };

  return (
    <div className="w-full space-y-2">
      <div role="tablist" aria-label="Protocol Packet Lab views" className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        {tabs.map(({ id, label, Icon, active, title }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeSubTab === id}
            title={title}
            onClick={() => setActiveSubTab(id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition focus:outline-none focus-visible:ring-1 focus-visible:ring-purple-400 ${
              activeSubTab === id ? activeClass[active] : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* Active Tab View */}
      <div className="w-full">
        {activeSubTab === 'analyzer' && <PacketAnalyzerWorkbench />}
        {activeSubTab === 'kismet' && <KismetStudioWorkbench onLogMessage={onLogMessage} />}
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
