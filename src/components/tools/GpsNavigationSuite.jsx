import React, { useState, useEffect } from 'react';
import { Compass, Navigation, Radio, MapPin } from 'lucide-react';
import GpsWardriverDeck from '../GpsWardriverDeck';
import UbxConfigDeck from '../UbxConfigDeck';

export default function GpsNavigationSuite({
  initialTab = 'wardrive',
  latestTextStream = '',
  isConnected = false,
  onLogMessage = () => {},
  onSendRawBytes = () => {}
}) {
  const [activeSubTab, setActiveSubTab] = useState(
    initialTab === 'ubx' ? 'ubx' : 'wardrive'
  );

  useEffect(() => {
    if (initialTab === 'ubx' || initialTab === 'wardrive') {
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
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              GPS & NAVIGATION SUITE
              <span className="text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                GNSS Lab
              </span>
            </h2>
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
        ) : (
          <UbxConfigDeck
            isConnected={isConnected}
            onSendRawBytes={onSendRawBytes}
            onLogMessage={onLogMessage}
          />
        )}
      </div>
    </div>
  );
}
