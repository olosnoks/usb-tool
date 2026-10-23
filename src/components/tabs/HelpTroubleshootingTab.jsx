import React, { useState } from 'react';
import { 
  HelpCircle, 
  Terminal, 
  Copy, 
  Check, 
  ExternalLink, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  Cpu, 
  ShieldAlert, 
  Info,
  Layers,
  Smartphone,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

const COMMON_DRIVERS = [
  {
    name: 'WCH CH340 / CH341 / CH9102',
    chipset: 'WCH (Nanjing Qinheng Microelectronics)',
    vidPid: 'VID: 0x1A86 | PID: 0x7523, 0x5523',
    description: 'The most common USB-to-UART bridge on budget ESP32, ESP8266, NodeMCU, and Arduino clone boards.',
    status: 'Native on Linux & modern macOS. Windows requires WCH CH341SER driver.',
    downloadUrl: 'https://www.wch-ic.com/downloads/CH341SER_EXE.html'
  },
  {
    name: 'Silicon Labs CP2102 / CP2104 / CP210x',
    chipset: 'Silicon Laboratories',
    vidPid: 'VID: 0x10C4 | PID: 0xEA60, 0xEA70',
    description: 'High-performance UART bridge on NodeMCU v2, LilyGO, Heltec, and genuine development boards.',
    status: 'Standard VCP driver available for Windows 10/11, macOS, and Linux.',
    downloadUrl: 'https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers'
  },
  {
    name: 'FTDI FT232R / FT2232H / FT232H',
    chipset: 'Future Technology Devices International',
    vidPid: 'VID: 0x0403 | PID: 0x6001, 0x6010, 0x6014',
    description: 'Industrial-grade serial & JTAG bridge with multi-megabaud support and hardware break signaling.',
    status: 'Standard FTDI VCP and D2XX drivers.',
    downloadUrl: 'https://ftdichip.com/drivers/vcp-drivers/'
  },
  {
    name: 'Prolific PL2303 (PL2303HX / TA / GS)',
    chipset: 'Prolific Technology Inc.',
    vidPid: 'VID: 0x067B | PID: 0x2303',
    description: 'Common on serial adapter cables, GPS modules, and legacy industrial hardware.',
    status: 'Requires official Prolific PL2303 Windows 11 driver.',
    downloadUrl: 'https://www.prolific.com.tw/US/ShowProduct.aspx?p_id=225&pcid=41'
  },
  {
    name: 'Espressif Native USB-JTAG / Serial',
    chipset: 'ESP32-S3 / ESP32-C3 / ESP32-C6 / ESP32-H2',
    vidPid: 'VID: 0x303A | PID: 0x1001',
    description: 'Integrated USB peripheral on modern ESP32 SoC chips directly connected to D+/D- pins.',
    status: 'No external driver needed. Uses standard USB CDC-ACM.',
    downloadUrl: 'https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-guides/usb-serial-jtag-console.html'
  },
  {
    name: 'Raspberry Pi RP2040 / Pico (CDC)',
    chipset: 'Raspberry Pi Trading Ltd',
    vidPid: 'VID: 0x2E8A | PID: 0x0005, 0x000A',
    description: 'Standard USB CDC UART stream on Raspberry Pi Pico running MicroPython, CircuitPython, or C/C++.',
    status: 'Native plug-and-play USB CDC-ACM on all modern operating systems.',
    downloadUrl: 'https://www.raspberrypi.com/documentation/microcontrollers/raspberry-pi-pico.html'
  }
];

export default function HelpTroubleshootingTab() {
  const [copiedKey, setCopiedKey] = useState(null);
  
  // All dropdown sections default to false so you don't see anything until clicked
  const [openSections, setOpenSections] = useState({
    linux: false,
    drivers: false,
    troubleshooting: false
  });

  const toggleSection = (key) => {
    setOpenSections(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* 1. Linux Permissions & udev Rules Dropdown */}
      <div className={`border rounded-xl shadow-xl transition-all overflow-hidden ${
        openSections.linux ? 'bg-[#030712] border-purple-500/50 shadow-purple-glow' : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
      }`}>
        <div 
          onClick={() => toggleSection('linux')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection('linux'); }}
          className="p-3.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              openSections.linux ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' : 'bg-slate-900 text-purple-400 border-slate-800'
            }`}>
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>HOW TO CONFIGURE LINUX USB PERMISSIONS & UDEV RULES</span>
              </h2>
              <div className="text-[11px] text-slate-500 hidden sm:block">
                Fix "Access Denied" on /dev/ttyUSB* & /dev/ttyACM* ports without needing root
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 ${
              openSections.linux 
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' 
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-purple-500/40 hover:text-purple-300'
            }`}>
              <span>{openSections.linux ? 'HIDE INSTRUCTIONS' : 'CLICK TO EXPAND'}</span>
              {openSections.linux ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {openSections.linux && (
          <div className="p-4 border-t border-slate-900 bg-[#020510] space-y-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              On Linux (Ubuntu, Debian, Arch, Fedora), non-root users are restricted from accessing <code className="text-purple-300 bg-slate-900 px-1 py-0.5 rounded">/dev/ttyUSB*</code> and <code className="text-purple-300 bg-slate-900 px-1 py-0.5 rounded">/dev/ttyACM*</code> nodes by default. Run either of these commands in your terminal:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
              {/* Method A: Dialout group */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Option 1: Add User to `dialout` Group</span>
                    <span className="text-[10px] text-emerald-400 font-bold">Standard</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Adds your current user account to the system dialout group. Requires a one-time log out or reboot.
                  </p>
                </div>

                <div className="relative bg-slate-900 rounded-lg p-2.5 text-xs text-amber-300 font-mono select-all border border-slate-800 flex items-center justify-between">
                  <code>sudo usermod -a -G dialout $USER</code>
                  <button
                    onClick={() => copyToClipboard('sudo usermod -a -G dialout $USER', 'cmd-dialout')}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 shrink-0 ml-2"
                    title="Copy command"
                  >
                    {copiedKey === 'cmd-dialout' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Method B: udev rule */}
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Option 2: Universal udev Rule (0666)</span>
                    <span className="text-[10px] text-cyan-400 font-bold">Immediate</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Grants read/write permissions to any connected USB-UART bridge without requiring user logout.
                  </p>
                </div>

                <div className="relative bg-slate-900 rounded-lg p-2 text-[11px] text-cyan-300 font-mono select-all border border-slate-800 flex items-center justify-between">
                  <code className="truncate mr-2">
                    echo 'SUBSYSTEM=="tty", ATTRS&#123;idVendor&#125;=="*", MODE="0666"' | sudo tee /etc/udev/rules.d/99-serial.rules &amp;&amp; sudo udevadm control --reload-rules
                  </code>
                  <button
                    onClick={() => copyToClipboard('echo \'SUBSYSTEM=="tty", ATTRS{idVendor}=="*", MODE="0666"\' | sudo tee /etc/udev/rules.d/99-serial.rules\nsudo udevadm control --reload-rules', 'cmd-udev')}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 shrink-0"
                    title="Copy udev commands"
                  >
                    {copiedKey === 'cmd-udev' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2. Common USB-UART Bridge Drivers Dropdown */}
      <div className={`border rounded-xl shadow-xl transition-all overflow-hidden ${
        openSections.drivers ? 'bg-[#030712] border-cyan-500/50 shadow-cyan-glow' : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
      }`}>
        <div 
          onClick={() => toggleSection('drivers')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection('drivers'); }}
          className="p-3.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              openSections.drivers ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-900 text-cyan-400 border-slate-800'
            }`}>
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>HOW TO IDENTIFY & INSTALL USB-TO-UART BRIDGE DRIVERS</span>
              </h2>
              <div className="text-[11px] text-slate-500 hidden sm:block">
                CH340/CH341, CP2102, FTDI FT232, PL2303, ESP32-S3 CDC, and RP2040 Pico
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 ${
              openSections.drivers 
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' 
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-500/40 hover:text-cyan-300'
            }`}>
              <span>{openSections.drivers ? 'HIDE DRIVERS' : 'CLICK TO EXPAND'}</span>
              {openSections.drivers ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {openSections.drivers && (
          <div className="p-4 border-t border-slate-900 bg-[#020510]">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {COMMON_DRIVERS.map((driver) => (
                <div
                  key={driver.name}
                  className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 hover:border-slate-700 flex flex-col justify-between gap-3 shadow-md transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-100 text-xs">{driver.name}</span>
                    </div>
                    <div className="text-[10px] text-cyan-400 font-mono mt-0.5">{driver.vidPid}</div>
                    <div className="text-[10px] text-slate-500 font-semibold">{driver.chipset}</div>

                    <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                      {driver.description}
                    </p>
                    <div className="mt-2 text-[10px] text-slate-500 bg-slate-900/80 p-2 rounded border border-slate-850">
                      {driver.status}
                    </div>
                  </div>

                  <a
                    href={driver.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 hover:border-cyan-500/40 text-[11px] font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Driver Download Page</span>
                    <ExternalLink className="w-3 h-3 opacity-60 ml-1" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Diagnostic & Troubleshooting Checklist Dropdown */}
      <div className={`border rounded-xl shadow-xl transition-all overflow-hidden ${
        openSections.troubleshooting ? 'bg-[#030712] border-amber-500/50 shadow-amber-glow' : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
      }`}>
        <div 
          onClick={() => toggleSection('troubleshooting')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection('troubleshooting'); }}
          className="p-3.5 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              openSections.troubleshooting ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-900 text-amber-400 border-slate-800'
            }`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>HOW TO TROUBLESHOOT SERIAL CONNECTIVITY & FLASHER ERRORS</span>
              </h2>
              <div className="text-[11px] text-slate-500 hidden sm:block">
                Solutions for port locks, packet header timeouts, baud mismatch, and missing capacitors
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 ${
              openSections.troubleshooting 
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-amber-500/40 hover:text-amber-300'
            }`}>
              <span>{openSections.troubleshooting ? 'HIDE CHECKLIST' : 'CLICK TO EXPAND'}</span>
              {openSections.troubleshooting ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {openSections.troubleshooting && (
          <div className="p-4 border-t border-slate-900 bg-[#020510]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="font-bold text-amber-300 flex items-center gap-1.5 pb-1">
                  <span>⚠️ "Failed to open serial port / Access Denied"</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Serial ports can only be opened by one process at a time. Make sure you close the <strong>Arduino IDE Serial Monitor</strong>, <strong>Cura 3D Slicer</strong>, <strong>PlatformIO Terminal</strong>, or any other browser tab using Web Serial.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="font-bold text-rose-300 flex items-center gap-1.5 pb-1">
                  <span>⚡ "ESP32: Timed out waiting for packet header"</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Many cheap ESP32 boards lack the proper 10uF capacitor between <strong>EN and GND</strong>, causing the automatic DTR/RTS reset pulse to miss. <strong>Workaround:</strong> Hold down the physical <strong>BOOT / IO0 button</strong> on the board while clicking "Flash Partitions", then release it once flashing begins.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="font-bold text-cyan-300 flex items-center gap-1.5 pb-1">
                  <span>🔤 "Terminal shows garbage / unreadable characters"</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Your baud rate is mismatched. ESP8266 ROM boot output uses <strong>74880 bps</strong>, while ESP32 typically uses <strong>115200 bps</strong>. Open the <strong>Baud Hunter</strong> in Tab 1 to automatically detect and apply the correct rate.
                </p>
              </div>

              <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
                <div className="font-bold text-emerald-300 flex items-center gap-1.5 pb-1">
                  <span>🌐 "Browser compatibility & Mobile OTG"</span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  The Web Serial API requires Google Chrome, Microsoft Edge, Opera, or Brave on Desktop. On Android, you can connect directly with a USB-OTG cable using Chrome via the built-in WebUSB driver fallback!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
