import React, { useState, useEffect } from 'react';
import { setCurrentTool } from '../../utils/sessionLog';
import { Cpu, HardDrive, Layers, Zap } from 'lucide-react';
import Ch341aProgrammer from './Ch341aProgrammer';
import CmsisDapDebugger from './CmsisDapDebugger';
import JtagWorkbench from './JtagWorkbench';
import AvrIspWorkbench from './AvrIspWorkbench';

const TABS = [
  { id: 'ch341a', label: 'CH341A BIOS Flash', short: 'CH341A', Icon: HardDrive, active: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { id: 'cmsis-dap', label: 'CMSIS-DAP Debugger', short: 'CMSIS-DAP', Icon: Cpu, active: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' },
  { id: 'jtag', label: 'JTAG / SVF Player', short: 'JTAG', Icon: Layers, active: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  { id: 'avr', label: 'AVR ISP & Bootloader', short: 'AVR', Icon: Zap, active: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
];

export default function HardwareProgrammersSuite({ initialTab = 'ch341a' }) {
  const [activeSubTab, setActiveSubTab] = useState(
    ['ch341a', 'cmsis-dap', 'jtag', 'jtag-programmer', 'avr', 'avr-isp'].includes(initialTab)
      ? initialTab.replace('-programmer', '').replace('-isp', '')
      : 'ch341a'
  );

  useEffect(() => {
    if (initialTab) {
      const normalized = initialTab.replace('-programmer', '').replace('-isp', '');
      if (['ch341a', 'cmsis-dap', 'jtag', 'avr'].includes(normalized)) {
        setActiveSubTab(normalized);
      }
    }
  }, [initialTab]);

  useEffect(() => {
    setCurrentTool({ ch341a: 'CH341A', 'cmsis-dap': 'CMSIS-DAP', jtag: 'JTAG', avr: 'AVR ISP' }[activeSubTab] || 'Programmers');
  }, [activeSubTab]);

  return (
    <div className="w-full space-y-2">
      {/* Sub-navigation */}
      <div role="tablist" aria-label="Programmer" className="flex flex-wrap items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 gap-0.5">
        {TABS.map(({ id, label, short, Icon, active }) => (
          <button
            key={id}
            role="tab"
            aria-selected={activeSubTab === id}
            title={label}
            onClick={() => setActiveSubTab(id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition ${
              activeSubTab === id ? `${active} border shadow-sm` : 'text-slate-400 hover:text-slate-200 border border-transparent'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden @sm:inline">{label}</span>
            <span className="@sm:hidden">{short}</span>
          </button>
        ))}
      </div>

      {/* Active Tab View */}
      <div className="w-full">
        {activeSubTab === 'ch341a' && <Ch341aProgrammer />}
        {activeSubTab === 'cmsis-dap' && <CmsisDapDebugger />}
        {activeSubTab === 'jtag' && <JtagWorkbench />}
        {activeSubTab === 'avr' && <AvrIspWorkbench />}
      </div>
    </div>
  );
}
