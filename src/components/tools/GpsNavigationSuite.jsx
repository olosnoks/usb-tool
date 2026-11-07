import React, { useState, useEffect } from 'react';
import { Compass, Navigation, Radio, MapPin, Sparkles } from 'lucide-react';
import GpsWardriverDeck from '../GpsWardriverDeck';
import UbxConfigDeck from '../UbxConfigDeck';
import WardriveGeneratorWorkbench from './WardriveGeneratorWorkbench';

export default function GpsNavigationSuite({
  initialTab = 'wardrive',
  latestTextStream = '',
  isConnected = false,
  onLogMessage = () => {},
  onSendRawBytes = () => {}
}) {
  const [activeSubTab, setActiveSubTab] = useState(
    initialTab === 'ubx' ? 'ubx' : initialTab === 'generator' ? 'generator' : 'wardrive'
  );

  useEffect(() => {
    if (initialTab === 'ubx' || initialTab === 'wardrive' || initialTab === 'generator') {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="w-full space-y-4">
      {/* Suite Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
            <Compass className="w-5 h-5" />
          </div>
          <div>
            <p className="text-xs text-slate-400">
              Live NMEA sentence parser, tactical wardriving map & u-blox UBX binary protocol configurator
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveSubTab('wardrive')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'wardrive'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-3.5 h-3.5" />
            <span>GPS Wardriver & NMEA</span>
          </button>
          <button
            onClick={() => setActiveSubTab('ubx')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'ubx'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Navigation className="w-3.5 h-3.5" />
            <span>u-blox UBX Config</span>
          </button>
          <button
            onClick={() => setActiveSubTab('generator')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'generator'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Demo Vector Generator</span>
          </button>
        </div>
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
        ) : (
          <WardriveGeneratorWorkbench
            onLogMessage={onLogMessage}
          />
        )}
      </div>
    </div>
  );
}
