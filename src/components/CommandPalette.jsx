import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Terminal, 
  HardDrive, 
  Cpu, 
  ArrowLeftRight, 
  Layers, 
  Navigation, 
  FileCode, 
  Bot, 
  ShieldAlert, 
  Activity, 
  Binary, 
  Radar, 
  Compass, 
  Command, 
  Usb, 
  Trash2, 
  Download, 
  Sliders, 
  Zap, 
  X,
  Wifi,
  Gauge,
  Radio
} from 'lucide-react';

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectTab,
  onConnect,
  onDisconnect,
  onClearLogs,
  onSetBaud,
  onOpenHardwareIntel,
  onOpenPinouts,
  onExportSession,
  isConnected
}) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const ALL_ACTIONS = [
    // Tools
    { id: 'tab-flasher', name: 'Open ESP32 Flasher', category: 'Tools', icon: HardDrive, action: () => onSelectTab('flasher') },
    { id: 'tab-usb-pd', name: 'Open USB-PD Power Delivery Analyzer & Voltage Trigger', category: 'Tools', icon: Zap, action: () => onSelectTab('usb-pd') },
    { id: 'tab-bus-explorer', name: 'Open I2C & SPI Bus Explorer & Sensor Identifier', category: 'Tools', icon: Cpu, action: () => onSelectTab('bus-explorer') },
    { id: 'tab-jtag', name: 'Open JTAG Boundary Scanner & SVF / CPLD Player', category: 'Tools', icon: Layers, action: () => onSelectTab('jtag-programmer') },
    { id: 'tab-modbus', name: 'Open Industrial Modbus RTU & RS-485 Field Deck', category: 'Tools', icon: Activity, action: () => onSelectTab('modbus-rtu') },
    { id: 'tab-avr-isp', name: 'Open AVR & Microchip UPDI / ISP Bootloader Programmer', category: 'Tools', icon: Cpu, action: () => onSelectTab('avr-isp') },
    { id: 'tab-rfid-nfc', name: 'Open RFID / NFC Badge Deck & Proxmark3 Companion', category: 'Tools', icon: Radio, action: () => onSelectTab('rfid-nfc') },
    { id: 'tab-mayhem', name: 'Open PortaPack Mayhem & HackRF Sub-GHz SDR Suite', category: 'Tools', icon: Radio, action: () => onSelectTab('mayhem') },
    { id: 'tab-logic-analyzer', name: 'Open 24MHz 8-Channel USB Logic Analyzer & Protocol Decoder', category: 'Tools', icon: Activity, action: () => onSelectTab('logic-analyzer') },
    { id: 'tab-can-bus', name: 'Open Automotive CAN Bus & OBD-II Diagnostic Deck', category: 'Tools', icon: Gauge, action: () => onSelectTab('can-bus') },
    { id: 'tab-ch341a', name: 'Open CH341A USB SPI/I2C BIOS & Flash Programmer', category: 'Tools', icon: HardDrive, action: () => onSelectTab('ch341a') },
    { id: 'tab-cmsis-dap', name: 'Open CMSIS-DAP / ARM Cortex-M SWD Debugger', category: 'Tools', icon: Cpu, action: () => onSelectTab('cmsis-dap') },
    { id: 'tab-dump', name: 'Open Silicon & Flash Dump', category: 'Tools', icon: Cpu, action: () => onSelectTab('esp-dump') },
    { id: 'tab-bridge', name: 'Open MitM Serial Bridge & Sniffer', category: 'Tools', icon: ArrowLeftRight, action: () => onSelectTab('bridge') },
    { id: 'tab-packets', name: 'Open Binary Packet Framer', category: 'Tools', icon: Layers, action: () => onSelectTab('packets') },
    { id: 'tab-ubx', name: 'Open u-blox GPS Configurator (UBX)', category: 'Tools', icon: Navigation, action: () => onSelectTab('ubx') },
    { id: 'tab-micropython', name: 'Open MicroPython On-Chip File Explorer & mip', category: 'Tools', icon: FileCode, action: () => onSelectTab('micropython') },
    { id: 'tab-improv', name: 'Open Improv Wi-Fi Serial Provisioner', category: 'Tools', icon: Wifi, action: () => onSelectTab('improv') },
    { id: 'tab-telemetry', name: 'Open Telemetry Dashboard & Speedometer Gauges', category: 'Tools', icon: Gauge, action: () => onSelectTab('telemetry') },
    { id: 'tab-responder', name: 'Open Auto-Responder & Trigger Alarms', category: 'Tools', icon: Bot, action: () => onSelectTab('responder') },
    { id: 'tab-scripting', name: 'Open Automated Test Runner / Scripting', category: 'Tools', icon: Bot, action: () => onSelectTab('scripting') },
    { id: 'tab-alerts', name: 'Open Crash & Watchdog Alerts', category: 'Tools', icon: ShieldAlert, action: () => onSelectTab('alerts') },
    { id: 'tab-plotter', name: 'Open Live Oscilloscope / Telemetry', category: 'Tools', icon: Activity, action: () => onSelectTab('plotter') },
    { id: 'tab-uboot', name: 'Open U-Boot Bootloader Triage', category: 'Tools', icon: ShieldAlert, action: () => onSelectTab('uboot') },
    { id: 'tab-injector', name: 'Open Raw Hex Frame Injector', category: 'Tools', icon: Binary, action: () => onSelectTab('injector') },
    { id: 'tab-diagnostics', name: 'Open RE Diagnostics & Baud Scanner', category: 'Tools', icon: Radar, action: () => onSelectTab('diagnostics') },
    { id: 'tab-wardrive', name: 'Open Wardrive / GPS NMEA Mapper', category: 'Tools', icon: Compass, action: () => onSelectTab('wardrive') },
    { id: 'tab-macros', name: 'Open Macro Decks & Custom Keypads', category: 'Tools', icon: Command, action: () => onSelectTab('macros') },
    { id: 'tab-autopsy', name: 'Open USB Autopsy & Bootloader Forcer (Vapes / Mystery Chips)', category: 'Tools', icon: Usb, action: () => onSelectTab('autopsy') },

    // Actions
    { id: 'act-connect', name: isConnected ? 'Disconnect Active Serial Port' : 'Connect New USB / Serial Port', category: 'Actions', icon: Usb, action: () => isConnected ? onDisconnect() : onConnect() },
    { id: 'act-clear', name: 'Clear Active Terminal Buffer', category: 'Actions', icon: Trash2, action: () => onClearLogs() },
    { id: 'act-export', name: 'Export Workspace Session (.json)', category: 'Actions', icon: Download, action: () => onExportSession() },
    { id: 'act-intel', name: 'Open Hardware Intelligence & VID/PID Lookup', category: 'Actions', icon: Cpu, action: () => onOpenHardwareIntel() },
    { id: 'act-pinouts', name: 'Open ESP32 / USB Pinouts Reference', category: 'Actions', icon: Sliders, action: () => onOpenPinouts() },

    // Baud Rates
    { id: 'baud-115200', name: 'Set Baud Rate: 115,200 bps (Standard)', category: 'Baud Rates', icon: Zap, action: () => onSetBaud(115200) },
    { id: 'baud-921600', name: 'Set Baud Rate: 921,600 bps (High Speed Flash)', category: 'Baud Rates', icon: Zap, action: () => onSetBaud(921600) },
    { id: 'baud-460800', name: 'Set Baud Rate: 460,800 bps', category: 'Baud Rates', icon: Zap, action: () => onSetBaud(460800) },
    { id: 'baud-74880', name: 'Set Baud Rate: 74,880 bps (ESP8266 Boot ROM)', category: 'Baud Rates', icon: Zap, action: () => onSetBaud(74880) },
    { id: 'baud-9600', name: 'Set Baud Rate: 9,600 bps (GPS / Legacy)', category: 'Baud Rates', icon: Zap, action: () => onSetBaud(9600) }
  ];

  const filtered = ALL_ACTIONS.filter(item => 
    item.name.toLowerCase().includes(query.toLowerCase()) || 
    item.category.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filtered.length) % (filtered.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) {
        filtered[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 font-mono">
      <div 
        className="w-full max-w-xl bg-[#030712] border border-cyan-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-950/80">
          <Search className="w-5 h-5 text-cyber-cyan shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command, tool, baud rate, or action..."
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 outline-none text-sm"
          />
          <kbd className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-400">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-slate-900/60">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No matching actions found for "{query}".
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    item.action();
                    onClose();
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-cyan-500/15 text-white border border-cyan-500/40 shadow-cyan-glow' 
                      : 'text-slate-300 hover:bg-slate-900/60'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 ${isSelected ? 'text-cyber-cyan' : 'text-slate-500'}`} />
                    <span className="text-xs font-semibold">{item.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                    {item.category}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Hint */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-900 bg-slate-950 text-[10px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <span className="text-cyber-cyan font-bold">SKON'S PALETTE</span>
        </div>
      </div>
    </div>
  );
}
