import React, { useState, useEffect } from 'react';
import { Keyboard, Sparkles, Layers, ShieldCheck } from 'lucide-react';
import DuckyScriptStudio from './DuckyScriptStudio';
import CyberChefWorkbench from './CyberChefWorkbench';

export default function BadUsbPayloadSuite({ initialTab = 'ducky' }) {
  const [activeSubTab, setActiveSubTab] = useState(initialTab === 'cyberchef' ? 'cyberchef' : 'ducky');

  useEffect(() => {
    if (initialTab === 'cyberchef' || initialTab === 'ducky') {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  return (
    <div className="w-full space-y-4">
      {/* Suite Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
            <Keyboard className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              BADUSB & PAYLOAD LAB
              <span className="text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Studio Suite
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              Interactive DuckyScript keystroke compiler, live simulator & CyberChef recipe encoder
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setActiveSubTab('ducky')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'ducky'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Keyboard className="w-3.5 h-3.5" />
            <span>DuckyScript Studio</span>
          </button>
          <button
            onClick={() => setActiveSubTab('cyberchef')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'cyberchef'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>CyberChef Obfuscator</span>
          </button>
        </div>
      </div>

      {/* Active Tab View */}
      <div className="w-full">
        {activeSubTab === 'ducky' ? (
          <DuckyScriptStudio />
        ) : (
          <CyberChefWorkbench />
        )}
      </div>
    </div>
  );
}
