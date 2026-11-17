import React, { useState, useEffect, useRef, useMemo } from 'react';
import { searchTools } from '../utils/toolSearch';
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
  Radio,
  MapPin,
  Keyboard,
  Sparkles,
  Bluetooth,
  Smartphone,
  Camera,
  KeyRound,
  BookOpen,
  ScrollText,
  HelpCircle
} from 'lucide-react';

import { SIDEBAR_SECTIONS } from './layout/Sidebar';
import { toolMeta } from './ToolRegistry';

export default function CommandPalette({
  isOpen,
  onClose,
  onSelectTab,
  activeTool,
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

  const ALL_ACTIONS = useMemo(() => {
    // 1. Automatically index all tools and modules from SIDEBAR_SECTIONS
    const sidebarToolActions = SIDEBAR_SECTIONS.flatMap((section) =>
      section.items.map((item) => {
        let action;
        if (item.id === 'wiki-external') {
          action = () => window.open(activeTool ? `./wiki/?tool=${activeTool}` : './wiki/?article=workspace', '_blank', 'noopener,noreferrer');
        } else if (item.id === 'pinouts-modal') {
          action = () => onOpenPinouts?.();
        } else if (item.id === 'intel-modal') {
          action = () => onOpenHardwareIntel?.();
        } else {
          action = () => onSelectTab(item.id);
        }

        return {
          id: `sidebar-${item.id}`,
          name: `Open ${item.name}`,
          category: section.title,
          icon: item.icon,
          desc: item.desc,
          toolId: item.id,
          keywords: item.keywords || [],
          action
        };
      })
    );

    // 2. Specific deep-link subtab entries for fast targeting
    const subtabActions = [
      {
        id: 'sub-ch341a',
        name: 'Open CH341A USB SPI/I2C BIOS & Flash Programmer',
        category: 'HARDWARE & PAYLOADS',
        icon: HardDrive,
        toolId: 'ch341a',
        desc: 'CH341A SPI 25xx flash, 24xx EEPROM and I2C programmer',
        keywords: ['ch341a', 'bios', 'eeprom', 'spi', 'i2c', 'programmer', 'flash'],
        action: () => onSelectTab('ch341a')
      },
      {
        id: 'sub-cmsis-dap',
        name: 'Open CMSIS-DAP / ARM Cortex-M SWD Debugger',
        category: 'HARDWARE & PAYLOADS',
        icon: Cpu,
        toolId: 'cmsis-dap',
        desc: 'SWD hardware debugging, RTT console, memory inspector and flash download',
        keywords: ['cmsis', 'cmsis-dap', 'dap', 'swd', 'cortex', 'arm', 'debugger', 'rtt'],
        action: () => onSelectTab('cmsis-dap')
      },
      {
        id: 'sub-jtag',
        name: 'Open JTAG Boundary Scanner & SVF / CPLD Player',
        category: 'HARDWARE & PAYLOADS',
        icon: Layers,
        toolId: 'jtag-programmer',
        desc: 'Scan chain TAP detection, IDCODE readout and automated SVF player',
        keywords: ['jtag', 'svf', 'cpld', 'tap', 'idcode', 'boundary scan'],
        action: () => onSelectTab('jtag-programmer')
      },
      {
        id: 'sub-avr-isp',
        name: 'Open AVR ISP Microchip ATmega Programmer',
        category: 'HARDWARE & PAYLOADS',
        icon: Cpu,
        toolId: 'avr-isp',
        desc: 'In-System Programming for ATmega328P, ATtiny, and AVR microcontrollers',
        keywords: ['avr', 'isp', 'atmega', 'arduino', 'fuses', 'lock bits', 'hex'],
        action: () => onSelectTab('avr-isp')
      },
      {
        id: 'sub-hex',
        name: 'Open Hex Stream Dissector & Line Framer',
        category: 'ANALYSIS & PROTOCOL LAB',
        icon: Binary,
        toolId: 'hex',
        desc: 'Real-time serial hex byte stream viewer and delimiter dissector',
        keywords: ['hex', 'stream', 'dissector', 'bytes', 'hexdump', 'raw'],
        action: () => onSelectTab('hex')
      },
      {
        id: 'sub-packets',
        name: 'Open Binary Packet Framer',
        category: 'ANALYSIS & PROTOCOL LAB',
        icon: Layers,
        toolId: 'packets',
        desc: 'Construct structured binary packets with headers, CRC checks, and payloads',
        keywords: ['packets', 'framer', 'binary', 'crc', 'checksum', 'framing'],
        action: () => onSelectTab('packets')
      },
      {
        id: 'sub-kismet',
        name: 'Open Kismet REST API Client',
        category: 'ANALYSIS & PROTOCOL LAB',
        icon: Radio,
        toolId: 'kismet',
        desc: 'Connect to live remote Kismet wardriving servers and live packet feeds',
        keywords: ['kismet', 'server', 'wardriving', 'wifi', 'pcap', 'rest api'],
        action: () => onSelectTab('kismet')
      },
      {
        id: 'sub-ubx',
        name: 'Open u-blox GPS Configurator (UBX)',
        category: 'RF, WIRELESS & BADGES',
        icon: Navigation,
        toolId: 'ubx',
        desc: 'Configure NEO-6M / M8N GNSS constellations, navigation rates, and binary protocols',
        keywords: ['ubx', 'u-blox', 'gps', 'gnss', 'constellation', 'glonass', 'galileo', 'nmea'],
        action: () => onSelectTab('ubx')
      },
      {
        id: 'sub-wifi-scanner',
        name: 'Open Wi-Fi Scanner & Spectrum View',
        category: 'RF, WIRELESS & BADGES',
        icon: Wifi,
        toolId: 'wifi-scanner',
        desc: 'Scan 2.4GHz & 5GHz AP channels, RSSI signal levels, and encryption status',
        keywords: ['wifi scanner', 'spectrum', 'channels', 'ssid', 'rssi', 'alfa'],
        action: () => onSelectTab('wifi-scanner')
      },
      {
        id: 'sub-rfid-nfc',
        name: 'Open Proxmark RFID & NFC Cloner',
        category: 'RF, WIRELESS & BADGES',
        icon: Radio,
        toolId: 'rfid-nfc',
        desc: 'Clone and emulate Mifare Classic, Ultralight, EM4100, and T5577 tags',
        keywords: ['rfid', 'nfc', 'badge', 'cloner', 'mifare', 't5577', 'em4100', '13.56mhz', '125khz'],
        action: () => onSelectTab('rfid-nfc')
      },
      {
        id: 'sub-warhog-sd',
        name: 'Open WarHog Piglet SD Card File Explorer (USB)',
        category: 'RF, WIRELESS & BADGES',
        icon: HardDrive,
        toolId: 'warhog-sd',
        desc: 'Browse, manage, and download .wigle.csv logs directly from Piglet onboard SD',
        keywords: ['warhog', 'piglet', 'sd card', 'files', 'csv', 'download', 'fat32'],
        action: () => onSelectTab('warhog-sd')
      },
      {
        id: 'sub-warhog-config',
        name: 'Open WarHog wardriver.cfg Editor',
        category: 'RF, WIRELESS & BADGES',
        icon: Sliders,
        toolId: 'warhog-config',
        desc: 'Interactive visual editor for Piglet device configurations and WiGLE API keys',
        keywords: ['warhog', 'piglet', 'config', 'wardriver.cfg', 'editor', 'settings'],
        action: () => onSelectTab('warhog-config')
      },
      {
        id: 'sub-warhog-console',
        name: 'Open WarHog Piglet Live Console & Screen Mirror',
        category: 'RF, WIRELESS & BADGES',
        icon: Terminal,
        toolId: 'warhog-console',
        desc: 'Live serial console and real-time screen mirror of CYD / Piglet display',
        keywords: ['warhog', 'piglet', 'screen mirror', 'lcd', 'console', 'live stream'],
        action: () => onSelectTab('warhog-console')
      },
      {
        id: 'sub-warhog-flasher',
        name: 'Open WarHog Web Flasher (Board Carousel)',
        category: 'RF, WIRELESS & BADGES',
        icon: Zap,
        toolId: 'warhog-flasher',
        desc: 'Web flasher with board carousel for all 7 supported Warhog and Piglet boards',
        keywords: ['warhog', 'piglet', 'flasher', 'web flasher', 'carousel', 'esp32-c5', 'cyd'],
        action: () => onSelectTab('warhog-flasher')
      },
      {
        id: 'sub-warhog-pinouts',
        name: 'Open WarHog Hardware Pinouts Reference',
        category: 'RF, WIRELESS & BADGES',
        icon: Cpu,
        toolId: 'warhog-pinouts',
        desc: 'ESP32-2432S028R & Piglet board pin assignments, GPS UART wiring & SD pinouts',
        keywords: ['warhog', 'piglet', 'pinouts', 'wiring', 'gps pins', 'gpio', 'cyd'],
        action: () => onSelectTab('warhog-pinouts')
      },
      {
        id: 'sub-adb',
        name: 'Open ADB (Android Debug Bridge) over WebUSB',
        category: 'HARDWARE & PAYLOADS',
        icon: Smartphone,
        toolId: 'adb',
        desc: 'Android device info, shell, file push/pull, apps, logcat, screen mirror and wireless ADB',
        keywords: ['adb', 'android debug bridge', 'adb shell', 'logcat', 'apk', 'install apk', 'push', 'pull', 'screen mirror', 'wireless adb', 'android'],
        action: () => onSelectTab('adb')
      },
      {
        id: 'sub-fastboot',
        name: 'Open Fastboot Flasher (Android bootloader)',
        category: 'HARDWARE & PAYLOADS',
        icon: Smartphone,
        toolId: 'fastboot',
        desc: 'Bootloader unlock, sparse image flashing, A/B slots, factory zips and reboot modes',
        keywords: ['fastboot', 'bootloader', 'oem unlock', 'unlock bootloader', 'flash partition', 'sparse', 'a/b slots', 'factory zip', 'factory image', 'reboot bootloader', 'android'],
        action: () => onSelectTab('fastboot')
      },
      {
        id: 'sub-usb-descriptors',
        name: 'Open USB Descriptor Explorer (lsusb -v)',
        category: 'DEVICE UTILITIES',
        icon: Usb,
        toolId: 'usb-descriptors',
        desc: 'Browse a USB device\'s configurations, interfaces and endpoints like lsusb -v',
        keywords: ['usb-descriptors', 'lsusb', 'lsusb -v', 'descriptors', 'usb tree', 'endpoints', 'interfaces', 'configurations', 'vid pid', 'usbview'],
        action: () => onSelectTab('usb-descriptors')
      },
      {
        id: 'sub-autopsy',
        name: 'Open USB Autopsy (mystery chip recon & baud hunter)',
        category: 'DEVICE UTILITIES',
        icon: Usb,
        toolId: 'autopsy',
        desc: 'Interrogate an unknown USB device: identify the chip and hunt for its baud rate',
        keywords: ['autopsy', 'recon', 'mystery chip', 'unknown device', 'baud hunter', 'baud scan', 'autobaud', 'reverse engineering', 'vid pid', 'vape'],
        action: () => onSelectTab('autopsy')
      },
      {
        id: 'sub-burp-proxy',
        name: 'Open Burp-style Repeater (HTTP Workbench)',
        category: 'WEB APP TESTING',
        icon: Activity,
        toolId: 'burp-proxy',
        desc: 'Send and replay HTTP requests: repeater, intruder, comparer and decoder',
        keywords: ['burp', 'burp suite', 'burp-proxy', 'repeater', 'intruder', 'comparer', 'decoder', 'http request', 'web proxy'],
        action: () => onSelectTab('burp-proxy')
      },
      {
        id: 'sub-api-client',
        name: 'Open OpenAPI / Swagger API Client',
        category: 'WEB APP TESTING',
        icon: Activity,
        toolId: 'api-client',
        desc: 'Load an OpenAPI/Swagger spec, call endpoints and fuzz the schema',
        keywords: ['api-client', 'api client', 'openapi', 'swagger', 'postman', 'rest', 'endpoint', 'schema fuzz', 'fuzz', 'api testing'],
        action: () => onSelectTab('api-client')
      },
      {
        id: 'sub-nikto-scanner',
        name: 'Open Sensitive Path Scanner (Nikto-style)',
        category: 'WEB APP TESTING',
        icon: ShieldAlert,
        toolId: 'nikto-scanner',
        desc: 'Probe a site for sensitive files and paths (Web Analyzer, paths tab)',
        keywords: ['nikto', 'nikto-scanner', 'paths', 'content discovery', 'dirb', 'dirbuster', 'directory brute force', 'sensitive paths', 'web scanner'],
        action: () => onSelectTab('nikto-scanner')
      },
      {
        id: 'sub-owasp-zap',
        name: 'Open Passive Web Scan (OWASP ZAP-style)',
        category: 'WEB APP TESTING',
        icon: ShieldAlert,
        toolId: 'owasp-zap',
        desc: 'Passive header, cookie, CORS and TLS checks for a URL (Web Analyzer, passive tab)',
        keywords: ['owasp', 'zap', 'owasp-zap', 'passive scan', 'security headers', 'cookies', 'cors', 'tls', 'web scanner', 'vulnerability scanner'],
        action: () => onSelectTab('owasp-zap')
      },
      {
        id: 'sub-url-inspector',
        name: 'Open URL Inspector (links, resources & forms)',
        category: 'WEB APP TESTING',
        icon: Search,
        toolId: 'url-inspector',
        desc: 'Extract links, resources, forms and meta tags from a URL (Web Analyzer, links tab)',
        keywords: ['url-inspector', 'url inspector', 'links', 'link extractor', 'resources', 'forms', 'crawl', 'scrape', 'meta tags'],
        action: () => onSelectTab('url-inspector')
      },
      {
        id: 'sub-dns-enumerator',
        name: 'Open DNS Records & Subdomain Enumerator',
        category: 'WEB APP TESTING',
        icon: Radar,
        toolId: 'dns-enumerator',
        desc: 'DNS record lookup (A/AAAA/MX/TXT/NS...) over DoH and subdomain brute force',
        keywords: ['dns-enumerator', 'dns enumerator', 'dig', 'nslookup', 'dns records', 'subdomain', 'subdomain brute force', 'doh', 'mx', 'txt'],
        action: () => onSelectTab('dns-enumerator')
      },
      {
        id: 'sub-dns-mail-doctor',
        name: 'Open Email DNS Doctor (SPF / DKIM / DMARC / DNSBL)',
        category: 'WEB APP TESTING',
        icon: Radar,
        toolId: 'dns-mail-doctor',
        desc: 'Check a domain\'s email authentication records and blacklist status',
        keywords: ['dns-mail-doctor', 'mail doctor', 'mxtoolbox', 'spf', 'dkim', 'dmarc', 'dnsbl', 'blacklist', 'email deliverability', 'email security'],
        action: () => onSelectTab('dns-mail-doctor')
      }
    ];

    // 3. Workspace Hardware Actions & Controls
    const workspaceActions = [
      {
        id: 'act-connect',
        name: isConnected ? 'Disconnect Active Serial Port' : 'Connect New USB / Serial Port',
        category: 'DEVICE CONTROLS',
        icon: Usb,
        desc: isConnected ? 'Safely close active WebSerial connection' : 'Request browser WebSerial connection to USB-UART',
        keywords: ['connect', 'disconnect', 'serial', 'port', 'usb', 'com'],
        action: () => isConnected ? onDisconnect() : onConnect()
      },
      {
        id: 'act-clear',
        name: 'Clear Active Terminal Buffer',
        category: 'DEVICE CONTROLS',
        icon: Trash2,
        desc: 'Wipe all serial history lines and hex buffers from console',
        keywords: ['clear', 'terminal', 'buffer', 'wipe', 'reset', 'console'],
        action: () => onClearLogs()
      },
      {
        id: 'act-export',
        name: 'Export Workspace Session (.json)',
        category: 'DEVICE CONTROLS',
        icon: Download,
        desc: 'Download JSON report of all board settings, logs, and telemetry',
        keywords: ['export', 'session', 'json', 'download', 'report', 'backup'],
        action: () => onExportSession()
      },
      {
        id: 'act-intel',
        name: 'Open Hardware Intelligence & VID/PID Lookup',
        category: 'SETUP & REFERENCE',
        icon: Cpu,
        desc: 'Lookup 1,000+ USB Vendor IDs and Product IDs to identify unknown boards',
        keywords: ['vid', 'pid', 'intel', 'lookup', 'hardware', 'usb id', 'identification'],
        action: () => onOpenHardwareIntel()
      },
      {
        id: 'act-pinouts',
        name: 'Open ESP32 / USB Pinouts Reference',
        category: 'SETUP & REFERENCE',
        icon: Sliders,
        desc: 'Hardware pinout diagrams, strapping pins, and 5V level shifter calculator',
        keywords: ['pinouts', 'wiring', 'esp32', 'level shift', 'diagram', 'gpio'],
        action: () => onOpenPinouts()
      },
      {
        id: 'act-wiki-current',
        name: `Open Wiki Manual for ${activeTool ? toolMeta(activeTool).title : 'Workspace'}`,
        category: 'DOCUMENTATION & MANUAL',
        icon: BookOpen,
        desc: `Jump directly to the technical knowledge base article for ${activeTool ? toolMeta(activeTool).title : 'Workspace'}`,
        keywords: ['wiki', 'docs', 'manual', 'help', 'guide', 'documentation', activeTool || 'workspace'],
        action: () => window.open(activeTool ? `./wiki/?tool=${activeTool}` : './wiki/?article=workspace', '_blank', 'noopener,noreferrer')
      },
      {
        id: 'act-wiki-all',
        name: 'Open Knowledge Base Wiki (All Articles)',
        category: 'DOCUMENTATION & MANUAL',
        icon: BookOpen,
        desc: 'Browse complete offline documentation, protocols, and hardware manuals',
        keywords: ['wiki', 'docs', 'manual', 'help', 'guide', 'knowledge base'],
        action: () => window.open('./wiki/', '_blank', 'noopener,noreferrer')
      }
    ];

    // 4. Common Baud Rates
    const baudActions = [
      { id: 'baud-115200', name: 'Set Baud Rate: 115,200 bps (Standard)', category: 'BAUD RATES', icon: Zap, desc: 'Default baud rate for ESP32, Arduino, MicroPython & GPS', keywords: ['baud', '115200', 'rate', 'speed'], action: () => onSetBaud(115200) },
      { id: 'baud-921600', name: 'Set Baud Rate: 921,600 bps (High Speed Flash)', category: 'BAUD RATES', icon: Zap, desc: 'Maximum reliable speed for ESP32 flash programming', keywords: ['baud', '921600', 'high speed', 'fast'], action: () => onSetBaud(921600) },
      { id: 'baud-460800', name: 'Set Baud Rate: 460,800 bps', category: 'BAUD RATES', icon: Zap, desc: 'Intermediate high-speed baud rate', keywords: ['baud', '460800', 'speed'], action: () => onSetBaud(460800) },
      { id: 'baud-74880', name: 'Set Baud Rate: 74,880 bps (ESP8266 Boot ROM)', category: 'BAUD RATES', icon: Zap, desc: 'ESP8266 bootloader ROM startup messages at 26MHz crystal', keywords: ['baud', '74880', 'esp8266', 'bootrom'], action: () => onSetBaud(74880) },
      { id: 'baud-9600', name: 'Set Baud Rate: 9,600 bps (Legacy / GPS)', category: 'BAUD RATES', icon: Zap, desc: 'Standard legacy GPS NMEA and serial peripheral rate', keywords: ['baud', '9600', 'legacy', 'gps'], action: () => onSetBaud(9600) }
    ];

    return [...sidebarToolActions, ...subtabActions, ...workspaceActions, ...baudActions];
  }, [activeTool, isConnected, onConnect, onDisconnect, onClearLogs, onSetBaud, onOpenHardwareIntel, onOpenPinouts, onExportSession, onSelectTab]);

  const filtered = useMemo(() => {
    if (!query) return ALL_ACTIONS;
    return searchTools(ALL_ACTIONS, query);
  }, [ALL_ACTIONS, query]);

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
      setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % (filtered.length || 1));
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
    <div 
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150 font-mono"
      onClick={onClose}
    >
      <div 
        className="w-full max-w-2xl bg-[#030712] border border-cyan-500/50 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Input Bar */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-800 bg-slate-950/80">
          <Search className="w-5 h-5 text-cyan-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search tools, subtabs, protocols, baud rates, or wiki guides..."
            className="flex-1 bg-transparent text-slate-100 placeholder-slate-500 outline-none text-sm"
          />
          <kbd className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[10px] text-slate-400">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 divide-y divide-slate-900/60">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-500 text-xs space-y-1">
              <div>No matching actions found for <span className="text-slate-300 font-bold">"{query}"</span></div>
              <div className="text-[11px] text-slate-600">Try searching for keywords like "pcap", "logic", "can", "ducky", "cyberchef", "swd", or "wifi".</div>
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
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl cursor-pointer transition-all ${
                    isSelected 
                      ? 'bg-cyan-500/20 text-white border border-cyan-500/50 shadow-cyan-glow' 
                      : 'text-slate-300 hover:bg-slate-900/60 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Icon className={`w-4 h-4 shrink-0 ${isSelected ? 'text-cyan-300' : 'text-slate-500'}`} />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.name}</div>
                      {item.desc && (
                        <div className="text-[10px] text-slate-400 truncate">{item.desc}</div>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-[9px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 uppercase tracking-wider">
                    {item.category}
                  </span>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Hint */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-slate-900 bg-slate-950 text-[10px] text-slate-500">
          <div className="flex items-center gap-3">
            <span>↑↓ Navigate</span>
            <span>↵ Select</span>
            <span>ESC Close</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-600">{filtered.length} actions available</span>
            <span className="text-cyan-400 font-bold">SKON'S PALETTE</span>
          </div>
        </div>
      </div>
    </div>
  );
}
