import React from 'react';
import { 
  Terminal, 
  HardDrive, 
  Sliders, 
  HelpCircle, 
  Layers, 
  Activity, 
  ShieldAlert,
  ArrowRight
} from 'lucide-react';

export const PRIMARY_TABS = [
  {
    id: 'terminal',
    name: 'Terminal & Diagnostics',
    shortName: 'Terminal',
    icon: Terminal,
    desc: 'Serial console, Hex viewer, Baud hunter & Injector',
    accent: 'cyan'
  },
  {
    id: 'flasher',
    name: 'Firmware Flasher',
    shortName: 'Flasher',
    icon: HardDrive,
    desc: 'Multi-binary partition queue & ROM bootloader engine',
    accent: 'amber'
  },
  {
    id: 'hardware',
    name: 'Hardware & Bootloader Controls',
    shortName: 'Hardware',
    icon: Sliders,
    desc: 'Strapping timing, DTR/RTS toggles & U-Boot spammer',
    accent: 'emerald'
  },
  {
    id: 'setup',
    name: 'Setup & Troubleshooting',
    shortName: 'Setup & Help',
    icon: HelpCircle,
    desc: 'Linux permissions, udev rules & USB bridge drivers',
    accent: 'purple'
  },
  {
    id: 'advanced',
    name: 'Advanced Lab',
    shortName: 'More Tools',
    icon: Layers,
    desc: 'Oscilloscope, MitM sniffer, MicroPython & GPS tools',
    accent: 'rose'
  }
];

export default function TabNavigation({ activeTab, onSelectTab }) {
  const getTabStyles = (tab, isActive) => {
    if (!isActive) {
      return 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent';
    }

    switch (tab.accent) {
      case 'cyan':
        return 'bg-gradient-to-r from-cyan-500/20 to-cyan-500/10 text-cyan-300 border-cyan-500/60 shadow-[0_0_15px_rgba(6,182,212,0.15)]';
      case 'amber':
        return 'bg-gradient-to-r from-amber-500/20 to-amber-500/10 text-amber-300 border-amber-500/60 shadow-[0_0_15px_rgba(245,158,11,0.15)]';
      case 'emerald':
        return 'bg-gradient-to-r from-emerald-500/20 to-emerald-500/10 text-emerald-300 border-emerald-500/60 shadow-[0_0_15px_rgba(16,185,129,0.15)]';
      case 'purple':
        return 'bg-gradient-to-r from-purple-500/20 to-purple-500/10 text-purple-300 border-purple-500/60 shadow-[0_0_15px_rgba(168,85,247,0.15)]';
      case 'rose':
        return 'bg-gradient-to-r from-rose-500/20 to-rose-500/10 text-rose-300 border-rose-500/60 shadow-[0_0_15px_rgba(244,63,94,0.15)]';
      default:
        return 'bg-slate-800 text-slate-100 border-slate-700';
    }
  };

  return (
    <nav className="bg-[#040817] border-b border-cyber-border px-3 sm:px-5 py-1.5 sticky top-[57px] z-30 font-mono">
      <div className="w-full flex items-center justify-between gap-2 overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-1.5 sm:gap-2">
          {PRIMARY_TABS.map((tab, idx) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl font-bold text-xs border transition-all shrink-0 ${getTabStyles(
                  tab,
                  isActive
                )}`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'scale-110' : 'opacity-70'}`} />
                <span className="hidden md:inline">{tab.name}</span>
                <span className="md:hidden">{tab.shortName}</span>
                <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                  isActive ? 'bg-slate-950/80 text-slate-300' : 'bg-slate-900 text-slate-500'
                }`}>
                  {idx + 1}
                </span>
              </button>
            );
          })}
        </div>

        {/* Quick hint */}
        <div className="hidden lg:flex items-center gap-2 text-[11px] text-slate-500">
          <span className="text-slate-600">WORKSPACE:</span>
          <span className="text-slate-400 capitalize">{PRIMARY_TABS.find(t => t.id === activeTab)?.desc}</span>
        </div>
      </div>
    </nav>
  );
}
