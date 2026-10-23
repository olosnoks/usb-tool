import React from 'react';
import { 
  Zap, 
  Terminal, 
  Sliders, 
  Activity, 
  FileCode, 
  HelpCircle,
  Layers
} from 'lucide-react';

export const WORKSPACE_PRESETS = [
  {
    id: 'flasher',
    name: 'Flasher Mode',
    shortName: 'Flash',
    icon: Zap,
    toolId: 'flasher',
    openDrawer: true,
    color: 'from-amber-500 to-amber-600',
    border: 'border-amber-500/50',
    text: 'text-amber-300',
    glow: 'shadow-amber-glow',
    desc: 'Multi-partition queue + live bootloader console'
  },
  {
    id: 'terminal',
    name: 'Terminal Mode',
    shortName: 'Terminal',
    icon: Terminal,
    toolId: 'terminal',
    openDrawer: false,
    color: 'from-cyan-500 to-cyan-600',
    border: 'border-cyan-500/50',
    text: 'text-cyan-300',
    glow: 'shadow-cyan-glow',
    desc: 'Full-screen ANSI console, Hex stream & Baud hunter'
  },
  {
    id: 'hardware',
    name: 'Hardware Mode',
    shortName: 'Hardware',
    icon: Sliders,
    toolId: 'hardware',
    openDrawer: true,
    color: 'from-emerald-500 to-teal-600',
    border: 'border-emerald-500/50',
    text: 'text-emerald-300',
    glow: 'shadow-emerald-glow',
    desc: 'Strapping pulse sliders, DTR/RTS toggles & U-Boot spammer'
  },
  {
    id: 'plotter',
    name: 'Telemetry Mode',
    shortName: 'Plotter',
    icon: Activity,
    toolId: 'plotter',
    openDrawer: true,
    color: 'from-rose-500 to-rose-600',
    border: 'border-rose-500/50',
    text: 'text-rose-300',
    glow: 'shadow-rose-glow',
    desc: 'Real-time oscilloscope waveform graph & dials'
  },
  {
    id: 'micropython',
    name: 'MicroPython Mode',
    shortName: 'Python',
    icon: FileCode,
    toolId: 'micropython',
    openDrawer: true,
    color: 'from-purple-500 to-purple-600',
    border: 'border-purple-500/50',
    text: 'text-purple-300',
    glow: 'shadow-purple-glow',
    desc: 'On-chip file browser + REPL terminal drawer'
  },
  {
    id: 'setup',
    name: 'Help & Drivers',
    shortName: 'Help',
    icon: HelpCircle,
    toolId: 'setup',
    openDrawer: false,
    color: 'from-blue-500 to-indigo-600',
    border: 'border-blue-500/50',
    text: 'text-blue-300',
    glow: 'shadow-blue-glow',
    desc: 'Linux permissions, udev rules & USB bridge drivers'
  }
];

export default function WorkspacePresets({
  activePreset,
  onSelectPreset
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none font-mono">
      <span className="text-[10px] text-slate-500 font-bold uppercase hidden xl:inline mr-1">
        WORKSPACE:
      </span>
      {WORKSPACE_PRESETS.map((preset) => {
        const Icon = preset.icon;
        const isActive = activePreset === preset.id;

        return (
          <button
            key={preset.id}
            onClick={() => onSelectPreset(preset)}
            title={preset.desc}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border transition-all shrink-0 ${
              isActive
                ? `bg-gradient-to-r ${preset.color} text-slate-950 border-transparent shadow-lg font-extrabold scale-102`
                : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">{preset.name}</span>
            <span className="sm:hidden">{preset.shortName}</span>
          </button>
        );
      })}
    </div>
  );
}
