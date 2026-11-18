import React, { useState, useCallback, useMemo } from 'react';
import { hex4, parseVidPid, findBridge, detectCapabilities, adviceFor, filterEntries, TROUBLE_ENTRIES } from '../../utils/setupDiagnostics.js';
import { UDEV_SETUP_COMMAND, UDEV_RULES_PATH, DIALOUT_COMMAND } from '../../data/udevRules.js';
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
  ChevronUp,
  Search,
  RefreshCw,
  Trash2
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

function guessOs() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  if (/windows/i.test(ua)) return 'windows';
  if (/mac/i.test(ua)) return 'mac';
  return 'linux';
}

function TroubleshootList() {
  const [q, setQ] = useState('');
  const rows = useMemo(() => filterEntries(TROUBLE_ENTRIES, q), [q]);
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 focus-within:border-amber-500/50">
        <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search symptoms (e.g. timeout, windows, baud)"
          aria-label="Search troubleshooting entries"
          className="w-full bg-transparent text-[11px] text-slate-200 outline-none placeholder:text-slate-600"
        />
      </label>
      <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
        {rows.map((e) => (
          <div key={e.id} className="bg-slate-950 p-2 rounded-lg border border-slate-800">
            <div className="text-[11px] font-bold text-amber-300 pb-0.5">{e.title}</div>
            <p className="text-[10px] text-slate-400 leading-relaxed">{e.body}</p>
          </div>
        ))}
        {rows.length === 0 && <div className="text-[11px] text-slate-500">No matching entries.</div>}
      </div>
    </div>
  );
}

function DiagnosticsPanel() {
  const os = guessOs();
  const caps = useMemo(() => {
    const n = typeof navigator !== 'undefined' ? navigator : {};
    return detectCapabilities({
      secure: typeof window !== 'undefined' && !!window.isSecureContext,
      ua: n.userAgent || '',
      serial: 'serial' in n,
      usb: 'usb' in n,
      hid: 'hid' in n,
      bluetooth: 'bluetooth' in n,
    });
  }, []);
  const [devices, setDevices] = useState(null); // null = not scanned yet
  const [err, setErr] = useState('');
  const [lookup, setLookup] = useState('');

  const refresh = useCallback(async () => {
    setErr('');
    const out = [];
    try {
      if (navigator.serial?.getPorts) {
        for (const port of await navigator.serial.getPorts()) {
          const i = port.getInfo?.() || {};
          out.push({ kind: 'Serial', vid: i.usbVendorId, pid: i.usbProductId, handle: port });
        }
      }
      if (navigator.usb?.getDevices) {
        for (const d of await navigator.usb.getDevices()) {
          out.push({ kind: 'USB', vid: d.vendorId, pid: d.productId, name: d.productName, handle: d });
        }
      }
      setDevices(out);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  }, []);

  const forget = async (d) => {
    try { await d.handle.forget?.(); } catch (e) { setErr(String(e?.message || e)); }
    refresh();
  };

  const parsed = parseVidPid(lookup);
  const bridge = parsed ? findBridge(parsed.vid) : null;

  return (
    <div className="border border-slate-800 rounded-lg bg-[#030712]/90 p-2 space-y-2" data-testid="setup-diagnostics">
      <div className="text-[11px] font-bold text-slate-100 flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />BROWSER CHECK</div>
      <ul className="grid grid-cols-1 @md:grid-cols-2 gap-1">
        {caps.rows.map((r) => (
          <li key={r.id} className="text-[10px] flex items-start gap-1.5 bg-slate-950 border border-slate-800 rounded px-2 py-1">
            <span className={r.ok ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>{r.ok ? 'OK' : 'NO'}</span>
            <span className="text-slate-300">{r.label}{!r.ok && <span className="block text-slate-500">{r.fix}</span>}</span>
          </li>
        ))}
      </ul>
      {caps.notes.map((n) => <div key={n} className="text-[10px] text-amber-300">{n}</div>)}

      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-slate-100">PERMITTED DEVICES</div>
        <button onClick={refresh} title="List devices this site already has permission for" className="flex items-center gap-1 px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[10px] text-cyan-300 hover:border-cyan-500/40">
          <RefreshCw className="w-3 h-3" /> Scan
        </button>
      </div>
      {err && <div className="text-[10px] text-rose-400">{err}</div>}
      {devices && devices.length === 0 && <div className="text-[10px] text-slate-500">No devices have been granted to this site yet. Connect one from the Terminal or another tool first. (Browsers never list devices you have not permitted.)</div>}
      {devices && devices.map((d, i) => (
        <div key={i} className="bg-slate-950 border border-slate-800 rounded p-2 flex items-start justify-between gap-2">
          <div className="min-w-0 text-[10px]">
            <div className="text-slate-200 font-bold">{d.kind}{d.name ? ` - ${d.name}` : ''} <span className="text-cyan-400 font-mono">{d.vid !== undefined ? `${hex4(d.vid)}:${hex4(d.pid)}` : 'non-USB port'}</span></div>
            {d.vid !== undefined && <div className="text-slate-500">{adviceFor(d.vid, os)}</div>}
          </div>
          {typeof d.handle.forget === 'function' && (
            <button onClick={() => forget(d)} title="Revoke this site's permission for the device" aria-label="Forget device" className="p-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-rose-300 shrink-0">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}

      <div className="text-[11px] font-bold text-slate-100">VID:PID LOOKUP</div>
      <input
        value={lookup}
        onChange={(e) => setLookup(e.target.value)}
        placeholder="1a86:7523 or VID_1A86&PID_7523 (Device Manager / lsusb)"
        aria-label="VID:PID lookup"
        className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 outline-none focus:border-cyan-500/50 placeholder:text-slate-600"
      />
      {lookup.trim() && !parsed && <div className="text-[10px] text-rose-400">Could not read that. Use hex like 1a86:7523.</div>}
      {parsed && (
        <div className="text-[10px] text-slate-300" data-testid="lookup-result">
          <span className="text-cyan-400">{hex4(parsed.vid)}{parsed.pid !== null ? `:${hex4(parsed.pid)}` : ''}</span>{' - '}
          {bridge ? <>{bridge.name}. Windows: {bridge.windows}. Linux/macOS: {bridge.other}.</> : 'Vendor not in the built-in bridge list.'}
        </div>
      )}
    </div>
  );
}

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
    <div className="flex flex-col gap-2 font-mono">
      <DiagnosticsPanel />

      {/* 1. Linux Permissions & udev Rules Dropdown */}
      <div className={`border rounded-lg transition-all overflow-hidden ${
        openSections.linux ? 'bg-[#030712] border-purple-500/50 shadow-purple-glow' : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
      }`}>
        <div 
          onClick={() => toggleSection('linux')}
          role="button"
          aria-expanded={openSections.linux}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection('linux'); }}
          className="p-2 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              openSections.linux ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' : 'bg-slate-900 text-purple-400 border-slate-800'
            }`}>
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[11px] @sm:text-xs font-bold text-slate-100 flex items-center gap-2">
                <span>LINUX USB PERMISSIONS & UDEV RULES</span>
              </h2>
              <div className="text-[10px] text-slate-500 hidden @sm:block">
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
              <span>{openSections.linux ? 'HIDE' : 'SHOW'}</span>
              {openSections.linux ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {openSections.linux && (
          <div className="p-2.5 border-t border-slate-900 bg-[#020510] space-y-3">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              On Linux (Ubuntu, Debian, Arch, Fedora), non-root users are restricted from accessing <code className="text-purple-300 bg-slate-900 px-1 py-0.5 rounded">/dev/ttyUSB*</code> and <code className="text-purple-300 bg-slate-900 px-1 py-0.5 rounded">/dev/ttyACM*</code> nodes by default. Do either of these (the udev rule below is per-vendor and never makes ports world-writable):
            </p>

            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2 pt-1">
              {/* Method A: Dialout group */}
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex flex-col justify-between gap-2.5">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Option 1: Add User to `dialout` Group</span>
                    <span className="text-[10px] text-emerald-400 font-bold">Standard</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Adds your user to the dialout group (Debian, Ubuntu, Fedora; use the uucp group on Arch). Requires a one-time log out and back in.
                  </p>
                </div>

                <div className="relative bg-slate-900 rounded-lg p-2.5 text-xs text-amber-300 font-mono select-all border border-slate-800 flex items-center justify-between">
                  <code>{DIALOUT_COMMAND}</code>
                  <button
                    onClick={() => copyToClipboard(DIALOUT_COMMAND, 'cmd-dialout')}
                    className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 shrink-0 ml-2"
                    title="Copy command"
                  >
                    {copiedKey === 'cmd-dialout' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Method B: udev rule. The displayed text and the copied text are the same string. */}
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 flex flex-col justify-between gap-2.5 @md:col-span-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-200">Option 2: Per-vendor udev rule (uaccess, 0660)</span>
                    <span className="text-[10px] text-cyan-400 font-bold">No logout needed for the seated user</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Writes <code>{UDEV_RULES_PATH}</code> with one rule per USB vendor, grants access with <code>TAG+="uaccess"</code> (and group <code>dialout</code>, mode 0660 for ssh sessions) and tells ModemManager to leave these ports alone. Replug the device afterwards.
                  </p>
                </div>

                <div className="relative bg-slate-900 rounded-lg p-2.5 text-[11px] text-cyan-300 font-mono border border-slate-800">
                  <button
                    onClick={() => copyToClipboard(UDEV_SETUP_COMMAND, 'cmd-udev')}
                    className="absolute top-1.5 right-1.5 p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-cyan-300"
                    title="Copy udev commands"
                    aria-label="Copy udev commands"
                  >
                    {copiedKey === 'cmd-udev' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <pre data-testid="udev-command" className="whitespace-pre overflow-x-auto pr-8 select-all">{UDEV_SETUP_COMMAND}</pre>
                </div>
              </div>
            </div>

            <ul className="text-[10px] text-slate-400 leading-relaxed list-disc pl-4 space-y-1">
              <li>Arch Linux: the serial group is <code>uucp</code>. Change <code>GROUP="dialout"</code> to <code>GROUP="uucp"</code> and run <code>sudo usermod -a -G uucp $USER</code>.</li>
              <li>If a CH340 port vanishes right after plug-in on Ubuntu or Debian, <code>brltty</code> may be claiming it: <code>sudo apt remove brltty</code>.</li>
              <li>ModemManager can grab a port and send AT commands to it. The rule above sets <code>ID_MM_DEVICE_IGNORE</code> for the listed vendors.</li>
              <li>macOS has no udev: ports appear as <code>/dev/cu.usbserial-*</code> and <code>/dev/cu.usbmodem*</code>. Use the <code>cu.*</code> node, for example <code>cu -l /dev/cu.usbserial-0001 -s 115200</code>.</li>
              <li>Web Serial works in Chromium-based browsers (Chrome, Edge, Opera) on https or localhost only. Firefox and Safari do not support it.</li>
            </ul>
          </div>
        )}
      </div>

      {/* 2. Common USB-UART Bridge Drivers Dropdown */}
      <div className={`border rounded-lg transition-all overflow-hidden ${
        openSections.drivers ? 'bg-[#030712] border-cyan-500/50 shadow-cyan-glow' : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
      }`}>
        <div 
          onClick={() => toggleSection('drivers')}
          role="button"
          aria-expanded={openSections.drivers}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection('drivers'); }}
          className="p-2 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              openSections.drivers ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-900 text-cyan-400 border-slate-800'
            }`}>
              <Cpu className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[11px] @sm:text-xs font-bold text-slate-100 flex items-center gap-2">
                <span>USB-TO-UART BRIDGE DRIVERS</span>
              </h2>
              <div className="text-[10px] text-slate-500 hidden @sm:block">
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
              <span>{openSections.drivers ? 'HIDE' : 'SHOW'}</span>
              {openSections.drivers ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {openSections.drivers && (
          <div className="p-2.5 border-t border-slate-900 bg-[#020510]">
            <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-2">
              {COMMON_DRIVERS.map((driver) => (
                <div
                  key={driver.name}
                  className="bg-slate-950 p-2.5 rounded-lg border border-slate-800 hover:border-slate-700 flex flex-col justify-between gap-3 shadow-md transition-all"
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
      <div className={`border rounded-lg transition-all overflow-hidden ${
        openSections.troubleshooting ? 'bg-[#030712] border-amber-500/50 shadow-amber-glow' : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
      }`}>
        <div 
          onClick={() => toggleSection('troubleshooting')}
          role="button"
          aria-expanded={openSections.troubleshooting}
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggleSection('troubleshooting'); }}
          className="p-2 flex items-center justify-between cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate">
            <div className={`p-1.5 rounded-lg border shrink-0 ${
              openSections.troubleshooting ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-900 text-amber-400 border-slate-800'
            }`}>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-[11px] @sm:text-xs font-bold text-slate-100 flex items-center gap-2">
                <span>TROUBLESHOOTING (SEARCHABLE)</span>
              </h2>
              <div className="text-[10px] text-slate-500 hidden @sm:block">
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
              <span>{openSections.troubleshooting ? 'HIDE' : 'SHOW'}</span>
              {openSections.troubleshooting ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {openSections.troubleshooting && (
          <div className="p-2.5 border-t border-slate-900 bg-[#020510]">
            <TroubleshootList />
          </div>
        )}
      </div>
    </div>
  );
}
