import React, { useState, useEffect } from 'react';
import { Compass, Navigation, MapPin, Wrench } from 'lucide-react';
import GpsWardriverDeck from '../GpsWardriverDeck';
import UbxConfigDeck from '../UbxConfigDeck';
import WardriveGeneratorWorkbench from './WardriveGeneratorWorkbench';
import GpsToolkitPanel from './GpsToolkitPanel';

const TAB_IDS = ['wardrive', 'ubx', 'toolkit', 'generator'];

export default function GpsNavigationSuite({
  initialTab = 'wardrive',
  latestTextStream = '',
  isConnected = false,
  onLogMessage = () => {},
  onSendRawBytes = () => {}
}) {
  const [activeSubTab, setActiveSubTab] = useState(
    TAB_IDS.includes(initialTab) ? initialTab : 'wardrive'
  );

  useEffect(() => {
    if (TAB_IDS.includes(initialTab)) {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  const tabs = [
    ['wardrive', Compass, 'GPS Wardriver & NMEA', 'emerald'],
    ['ubx', Navigation, 'u-blox UBX Config', 'cyan'],
    ['toolkit', Wrench, 'NMEA/UBX Toolkit', 'amber'],
    ['generator', MapPin, 'Demo Vector Generator', 'purple']
  ];
  const active = {
    emerald: 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40',
    cyan: 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40',
    amber: 'bg-amber-500/20 text-amber-300 border border-amber-500/40',
    purple: 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
  };

  return (
    <div className="w-full space-y-2">
      <div role="tablist" aria-label="GPS tools" className="flex flex-wrap items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
        {tabs.map(([id, Icon, text, color]) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeSubTab === id}
            onClick={() => setActiveSubTab(id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition focus:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
              activeSubTab === id ? active[color] : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{text}</span>
          </button>
        ))}
      </div>

      {/* Active Tab View */}
      <div className="w-full">
        {activeSubTab === 'wardrive' ? (
          <GpsWardriverDeck
            latestTextStream={latestTextStream}
            isConnected={isConnected}
            onLogMessage={onLogMessage}
          />
        ) : activeSubTab === 'ubx' ? (
          <UbxConfigDeck
            isConnected={isConnected}
            onSendRawBytes={onSendRawBytes}
            onLogMessage={onLogMessage}
          />
        ) : activeSubTab === 'toolkit' ? (
          <GpsToolkitPanel
            isConnected={isConnected}
            onSendRawBytes={onSendRawBytes}
            onLogMessage={onLogMessage}
          />
        ) : (
          <WardriveGeneratorWorkbench
            onLogMessage={onLogMessage}
          />
        )}
      </div>
    </div>
  );
}
