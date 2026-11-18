import React, { useState, useEffect } from 'react';
import { Keyboard, Sparkles } from 'lucide-react';
import DuckyScriptStudio from './DuckyScriptStudio';
import CyberChefWorkbench from './CyberChefWorkbench';

export default function BadUsbPayloadSuite({ initialTab = 'ducky' }) {
  const [activeSubTab, setActiveSubTab] = useState(initialTab === 'cyberchef' ? 'cyberchef' : 'ducky');

  useEffect(() => {
    if (initialTab === 'cyberchef' || initialTab === 'ducky') {
      setActiveSubTab(initialTab);
    }
  }, [initialTab]);

  const base = 'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition focus:outline-none focus:ring-1';
  const idle = 'text-slate-400 hover:text-slate-200 focus:ring-slate-500';

  return (
    <div className="w-full space-y-2">
      <div role="tablist" aria-label="Payload tools" className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 w-fit max-w-full">
        <button
          role="tab"
          aria-selected={activeSubTab === 'ducky'}
          onClick={() => setActiveSubTab('ducky')}
          className={`${base} ${activeSubTab === 'ducky' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 focus:ring-amber-400' : idle}`}
        >
          <Keyboard className="w-3 h-3" />
          <span>DuckyScript Studio</span>
        </button>
        <button
          role="tab"
          aria-selected={activeSubTab === 'cyberchef'}
          onClick={() => setActiveSubTab('cyberchef')}
          className={`${base} ${activeSubTab === 'cyberchef' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 focus:ring-cyan-400' : idle}`}
        >
          <Sparkles className="w-3 h-3" />
          <span>CyberChef Obfuscator</span>
        </button>
      </div>

      <div className="w-full">
        {activeSubTab === 'ducky' ? <DuckyScriptStudio /> : <CyberChefWorkbench />}
      </div>
    </div>
  );
}
