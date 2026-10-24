import React, { useState, useEffect } from 'react';
import { Cpu, HardDrive, Layers, Zap, CheckCircle2 } from 'lucide-react';
import Ch341aProgrammer from './Ch341aProgrammer';
import CmsisDapDebugger from './CmsisDapDebugger';
import JtagWorkbench from './JtagWorkbench';
import AvrIspWorkbench from './AvrIspWorkbench';

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

  return (
    <div className="w-full space-y-4">
      {/* Suite Header & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-400">
            <Cpu className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              HARDWARE PROGRAMMERS & DEBUGGERS
              <span className="text-[10px] font-normal uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                IC Pro Deck
              </span>
            </h2>
            <p className="text-xs text-slate-400">
              SPI/I2C BIOS flash, ARM Cortex-M SWD halt/step, JTAG boundary scan & AVR ISP bootloaders
            </p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex flex-wrap items-center bg-slate-950 p-1 rounded-lg border border-slate-800 gap-1">
          <button
            onClick={() => setActiveSubTab('ch341a')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'ch341a'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span>CH341A BIOS Flash</span>
          </button>
          <button
            onClick={() => setActiveSubTab('cmsis-dap')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'cmsis-dap'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>CMSIS-DAP Debugger</span>
          </button>
          <button
            onClick={() => setActiveSubTab('jtag')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'jtag'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>JTAG / SVF Player</span>
          </button>
          <button
            onClick={() => setActiveSubTab('avr')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              activeSubTab === 'avr'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>AVR ISP & Bootloader</span>
          </button>
        </div>
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
