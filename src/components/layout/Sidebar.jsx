import React, { useState } from 'react';
import { 
  Terminal, 
  HardDrive, 
  Sliders, 
  Binary, 
  Activity, 
  Layers, 
  ArrowLeftRight, 
  Navigation, 
  FileCode, 
  Wifi, 
  Gauge, 
  Compass, 
  ShieldAlert, 
  Bot, 
  Usb, 
  HelpCircle, 
  Cpu, 
  BookOpen, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  Flame,
  Radio,
  Sparkles,
  Zap,
  ShieldCheck,
  Keyboard
} from 'lucide-react';

export const SIDEBAR_SECTIONS = [
  {
    id: 'core',
    title: 'CORE OPERATIONS',
    items: [
      { id: 'terminal', name: 'Terminal & Console', icon: Terminal, accent: 'cyan', desc: 'Real-time serial log & baud hunter' },
      { id: 'flasher', name: 'Firmware Flasher', icon: HardDrive, accent: 'amber', desc: 'Multi-binary partition flashing' },
      { id: 'hardware', name: 'Hardware Controls', icon: Sliders, accent: 'emerald', desc: 'Strapping timers, DTR/RTS, U-Boot' }
    ]
  },
  {
    id: 'analysis',
    title: 'ANALYSIS & PROTOCOL LAB',
    items: [
      { id: 'packet-analyzer', name: 'Packet & Protocol Lab', icon: Activity, accent: 'purple', desc: 'Wi-Fi 802.11, PCAP, Hex Stream & Packet Framer' },
      { id: 'logic-analyzer', name: '24MHz Logic Analyzer', icon: Activity, accent: 'cyan', desc: '8-channel digital waveforms & protocol decoders' },
      { id: 'can-bus', name: 'CAN Bus & OBD-II Scanner', icon: Gauge, accent: 'emerald', desc: 'Live packet sniffer & automotive diagnostics' },
      { id: 'bus-explorer', name: 'I2C & SPI Bus Explorer', icon: Cpu, accent: 'emerald', desc: '1-click chip identification & register watch' },
      { id: 'modbus-rtu', name: 'Modbus RTU & RS-485', icon: Activity, accent: 'amber', desc: 'Industrial holding registers & inverter telemetry' },
      { id: 'plotter', name: 'Oscilloscope Plotter', icon: Activity, accent: 'rose', desc: 'Multi-channel live waveforms' },
      { id: 'bridge', name: 'MitM Serial Bridge', icon: ArrowLeftRight, accent: 'cyan', desc: 'Dual-port pass-through sniffer' }
    ]
  },
  {
    id: 'rf',
    title: 'RF, WIRELESS & BADGES',
    items: [
      { id: 'flipper', name: 'Flipper Zero Suite', icon: Bot, accent: 'amber', desc: 'qFlipper companion: 128x64 LCD, BadUSB, Sub-GHz, NFC & SD' },
      { id: 'proxmark', name: 'Proxmark3 / PM5 Suite', icon: Radio, accent: 'cyan', desc: '13.56MHz & 125kHz RFID cloner, raw NG framing & WebFlash' },
      { id: 'mayhem', name: 'PortaPack Mayhem SDR', icon: Radio, accent: 'purple', desc: 'HackRF Sub-GHz RF deck, LCD screen & FREQMAN' },
      { id: 'wardrive', name: 'GPS & Wardrive Suite', icon: Compass, accent: 'emerald', desc: 'NMEA sentence tracker, live map & u-blox UBX' }
    ]
  },
  {
    id: 'programmers',
    title: 'HARDWARE & PAYLOADS',
    items: [
      { id: 'ducky', name: 'BadUSB & Payload Studio', icon: Keyboard, accent: 'amber', desc: 'DuckyScript compiler, simulator & CyberChef obfuscator' },
      { id: 'programmers', name: 'Hardware Programmers', icon: Cpu, accent: 'cyan', desc: 'CH341A BIOS flash, CMSIS-DAP, JTAG SVF & AVR ISP' },
      { id: 'usb-pd', name: 'USB-PD Power Delivery', icon: Zap, accent: 'amber', desc: 'PPS variable voltage trigger & VBUS analyzer' }
    ]
  },
  {
    id: 'utilities',
    title: 'DEVICE UTILITIES',
    items: [
      { id: 'micropython', name: 'MicroPython Files', icon: FileCode, accent: 'purple', desc: 'On-chip filesystem explorer' },
      { id: 'improv', name: 'Improv Wi-Fi', icon: Wifi, accent: 'emerald', desc: 'Standard serial Wi-Fi provisioner' },
      { id: 'telemetry', name: 'Telemetry Gauges', icon: Gauge, accent: 'cyan', desc: 'Speedometer sensor dials' },
      { id: 'alerts', name: 'Crash & Panic Alerts', icon: ShieldAlert, accent: 'rose', desc: 'Auto-detect kernel panics' },
      { id: 'automation', name: 'Test Runner & Scripts', icon: Bot, accent: 'purple', desc: 'Automated JS test routines' },
      { id: 'autopsy', name: 'USB Recon & Autopsy', icon: Usb, accent: 'amber', desc: 'Mystery chip descriptor analysis' }
    ]
  },
  {
    id: 'setup',
    title: 'SETUP & REFERENCE',
    items: [
      { id: 'setup', name: 'Linux Setup & Drivers', icon: HelpCircle, accent: 'purple', desc: 'udev rules & USB-UART drivers' },
      { id: 'esp-dump', name: 'Silicon Memory Dump', icon: Cpu, accent: 'amber', desc: 'Direct eFuse and flash reader' },
      { id: 'pinouts-modal', name: 'Pinouts Reference', icon: BookOpen, isModal: true, accent: 'cyan', desc: 'ESP32 & USB wiring diagrams' },
      { id: 'intel-modal', name: 'Chip Intelligence', icon: Cpu, isModal: true, accent: 'cyan', desc: 'VID/PID device identification' }
    ]
  }
];

export default function Sidebar({
  activeTool,
  onSelectTool,
  isCollapsed,
  onToggleCollapse,
  onOpenPinouts,
  onOpenHardwareIntel
}) {
  const [filterQuery, setFilterQuery] = useState('');

  const handleItemClick = (item) => {
    if (item.id === 'pinouts-modal') {
      onOpenPinouts?.();
    } else if (item.id === 'intel-modal') {
      onOpenHardwareIntel?.();
    } else {
      onSelectTool(item.id);
    }
  };

  const getAccentStyles = (item, isActive) => {
    if (!isActive) {
      return 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border-transparent';
    }

    switch (item.accent) {
      case 'amber':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-amber-glow font-bold';
      case 'emerald':
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-emerald-glow font-bold';
      case 'purple':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/50 shadow-purple-glow font-bold';
      case 'rose':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-rose-glow font-bold';
      case 'cyan':
      default:
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-cyan-glow font-bold';
    }
  };

  return (
    <aside
      className={`border-r border-cyber-border bg-[#030712] flex flex-col shrink-0 transition-all duration-200 z-30 font-mono select-none ${
        isCollapsed ? 'w-14 sm:w-16' : 'w-60 lg:w-64'
      }`}
    >
      {/* Sidebar Header & Search */}
      <div className="p-2.5 border-b border-slate-900 flex items-center justify-between gap-2">
        {!isCollapsed ? (
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Filter tools..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2 pointer-events-none" />
          </div>
        ) : (
          <div className="w-full flex justify-center py-1">
            <button
              onClick={() => onToggleCollapse(!isCollapsed)}
              title="Expand sidebar"
              className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-900 text-cyan-400 border border-slate-800"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <button
          onClick={() => onToggleCollapse(!isCollapsed)}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="p-1.5 rounded-lg bg-slate-950 hover:bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800 shrink-0 hidden sm:block"
        >
          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* Nav Tool List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-3 scrollbar-thin scrollbar-thumb-slate-800">
        {SIDEBAR_SECTIONS.map((section) => {
          const visibleItems = section.items.filter(
            item => !filterQuery || item.name.toLowerCase().includes(filterQuery.toLowerCase()) || item.desc.toLowerCase().includes(filterQuery.toLowerCase())
          );

          if (visibleItems.length === 0) return null;

          return (
            <div key={section.id} className="space-y-1">
              {!isCollapsed && (
                <div className="px-2 pt-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {section.title}
                </div>
              )}

              <div className="space-y-0.5">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = 
                    activeTool === item.id ||
                    (item.id === 'packet-analyzer' && ['packet-analyzer', 'hex', 'packets'].includes(activeTool)) ||
                    (item.id === 'ducky' && ['ducky', 'cyberchef'].includes(activeTool)) ||
                    (item.id === 'wardrive' && ['wardrive', 'ubx'].includes(activeTool)) ||
                    (item.id === 'programmers' && ['programmers', 'ch341a', 'cmsis-dap', 'jtag-programmer', 'avr-isp'].includes(activeTool));

                  return (
                    <button
                      key={item.id}
                      onClick={() => handleItemClick(item)}
                      title={`${item.name} — ${item.desc}`}
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs border transition-all text-left ${getAccentStyles(
                        item,
                        isActive
                      )} ${isCollapsed ? 'justify-center px-1' : ''}`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'scale-110' : 'opacity-70'}`} />
                      {!isCollapsed && (
                        <div className="truncate flex-1">
                          <div className="truncate">{item.name}</div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Sidebar Footer collapse toggle for mobile/desktop */}
      <div className="p-2 border-t border-slate-900 bg-slate-950/60 flex items-center justify-between text-[11px] text-slate-500">
        {!isCollapsed && (
          <span className="text-[10px] truncate">Skon's USB Tool v2.0</span>
        )}
        <button
          onClick={() => onToggleCollapse(!isCollapsed)}
          className="w-full sm:w-auto p-1 rounded hover:bg-slate-900 text-slate-400 hover:text-slate-200 flex items-center justify-center"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>
      </div>
    </aside>
  );
}
