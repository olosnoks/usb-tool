import React, { useState } from 'react';
import { 
  Cpu, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  ExternalLink, 
  ShieldCheck, 
  Zap, 
  Sliders, 
  X,
  Layers,
  Info
} from 'lucide-react';
import { USB_CHIP_DATABASE, identifyUsbChip } from '../utils/usbDatabase';

export default function HardwareIntelligenceModal({
  isOpen,
  onClose,
  portInfo
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChipKey, setSelectedChipKey] = useState(null);

  if (!isOpen) return null;

  // Active connected board's chip
  const activeChip = identifyUsbChip(portInfo?.usbVendorId, portInfo?.usbProductId);
  const activeVidPid = portInfo?.usbVendorId && portInfo?.usbProductId
    ? `${portInfo.usbVendorId.toString(16).padStart(4, '0')}:${portInfo.usbProductId.toString(16).padStart(4, '0')}`
    : null;

  // Search across all database entries
  const allEntries = Object.entries(USB_CHIP_DATABASE).map(([vidPid, data]) => ({
    vidPid,
    ...data
  }));

  const filteredEntries = searchQuery.trim()
    ? allEntries.filter(e => 
        e.vidPid.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.chip.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.manufacturer.toLowerCase().includes(searchQuery.toLowerCase()) ||
        e.notes.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allEntries;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-mono">
      <div 
        className="bg-[#030712] border border-cyan-500/40 rounded-2xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950">
          <div className="flex items-center gap-2.5">
            <Cpu className="w-5 h-5 text-cyber-cyan" />
            <div>
              <h2 className="text-sm font-bold text-slate-100 tracking-wider">
                HARDWARE INTELLIGENCE // USB CHIP & VID:PID SPECIFICATIONS
              </h2>
              <span className="text-[11px] text-slate-500">
                Operating voltages, DTR/RTS strapping behaviors, driver latency quirks & pinout specs
              </span>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 overflow-y-auto flex-1 flex flex-col gap-4">
          {/* Active Connected Chip Banner */}
          {activeVidPid && (
            <div className="bg-[#090e1a] border border-cyan-500/50 rounded-xl p-4 shadow-cyan-glow flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-cyber-cyan font-bold uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyber-emerald animate-ping" />
                  CURRENTLY CONNECTED USB HARDWARE [VID:PID {activeVidPid.toUpperCase()}]
                </span>
                <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyber-cyan text-[10px] font-bold border border-cyan-500/40">
                  {activeChip.manufacturer}
                </span>
              </div>

              <div className="text-sm font-bold text-slate-100">
                {activeChip.chip}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">
                    Operating Logic Voltage
                  </span>
                  <span className="text-cyber-amber font-semibold text-xs">
                    {activeChip.voltage}
                  </span>
                </div>

                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">
                    Auto-Reset / Strapping
                  </span>
                  <span className="text-cyber-emerald font-semibold text-xs">
                    {activeChip.autoReset}
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 text-xs text-slate-300 leading-relaxed">
                <span className="text-[10px] text-slate-500 uppercase block font-bold mb-1">
                  Hardware Engineer Notes & Driver Quirks
                </span>
                {activeChip.notes}
              </div>
            </div>
          )}

          {/* Search Chip Catalog */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
                <Search className="w-3.5 h-3.5 text-cyber-cyan" />
                USB UART CHIP DATABASE ({allEntries.length} Supported ICs)
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by VID:PID (e.g. 10c4:ea60), chip name (e.g. CP2102, FT232, CH340), or manufacturer..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Catalog Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {filteredEntries.map(entry => (
              <div 
                key={entry.vidPid}
                className="bg-slate-950 border border-slate-800 hover:border-slate-700 rounded-xl p-3 flex flex-col justify-between gap-2 transition-colors text-xs"
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-mono text-cyber-cyan font-bold">
                      VID:PID {entry.vidPid.toUpperCase()}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      {entry.manufacturer}
                    </span>
                  </div>
                  <div className="font-bold text-slate-200 text-xs mb-1">
                    {entry.chip}
                  </div>
                  <div className="text-[11px] text-cyber-amber mb-1">
                    ⚡ {entry.voltage}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-tight">
                    {entry.notes}
                  </p>
                </div>

                <div className="pt-1 border-t border-slate-900 flex items-center justify-between text-[10px] text-slate-500 font-mono">
                  <span>Auto-Reset: {entry.autoReset}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-3 border-t border-slate-800 bg-slate-950 text-xs">
          <div className="flex items-center gap-2 text-slate-500 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-cyber-emerald" />
            <span>Always check VCCIO voltage jumper before wiring 3.3V microcontrollers to prevent silicon damage.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-bold"
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}
