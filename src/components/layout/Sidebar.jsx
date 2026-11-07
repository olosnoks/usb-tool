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
  Keyboard,
  Download,
  Bluetooth,
  Smartphone,
  Camera,
  KeyRound,
  ScrollText,
  MapPin,
  Database,
  Network,
  Regex,
  Calculator,
  Hash,
  Radar,
  Link2
} from 'lucide-react';

import { windowKeyFor } from '../../utils/windowManager';

export const SIDEBAR_SECTIONS = [
  {
    id: 'core',
    title: 'CORE OPERATIONS',
    items: [
      { id: 'terminal', name: 'Terminal & Console', icon: Terminal, accent: 'cyan', desc: 'Real-time serial log & baud hunter', keywords: ['console', 'uart', 'baud', 'serial', 'com', 'monitor', 'log', 'echo', 'terminal'] },
      { id: 'flasher', name: 'Firmware Flasher', icon: HardDrive, accent: 'amber', desc: 'Multi-binary partition flashing', keywords: ['esp32', 'esp8266', 'esptool', 'bin', 'rom', 'partitions', 'flash', 'bootloader', 'ota', 'flasher'] },
      { id: 'hardware', name: 'Hardware Controls', icon: Sliders, accent: 'emerald', desc: 'Strapping timers, DTR/RTS, U-Boot', keywords: ['strapping', 'gpio0', 'reset', 'dtr', 'rts', 'uboot', 'bootloader', 'timers', 'hardware'] }
    ]
  },
  {
    id: 'analysis',
    title: 'ANALYSIS & PROTOCOL LAB',
    items: [
      { id: 'packet-analyzer', name: 'Packet & Protocol Lab', icon: Activity, accent: 'purple', desc: 'Wi-Fi 802.11, PCAP, Hex Stream & Packet Framer', keywords: ['pcap', 'hex', 'packets', 'kismet', 'wireshark', 'dissector', 'framer', 'sniff', 'raw', 'protocol', 'analyzer'] },
      { id: 'logic-analyzer', name: '24MHz Logic Analyzer', icon: Activity, accent: 'cyan', desc: '8-channel capture (SUMP, fx2lafw, VCD/.sr) with I2C, UART, SPI, 1-Wire, CAN, WS2812, IR & SWD decoders', keywords: ['sump', 'fx2lafw', 'sigrok', 'vcd', 'sr', '8-channel', 'i2c', 'uart', 'spi', '1-wire', 'can', 'ws2812', 'ir', 'swd', 'logic', 'analyzer'] },
      { id: 'can-bus', name: 'CAN Bus & OBD-II Scanner', icon: Gauge, accent: 'emerald', desc: 'Sniffer with DBC decoding, replay, OBD-II and UDS diagnostics', keywords: ['can', 'obd', 'obd2', 'obd-ii', 'dbc', 'automotive', 'uds', 'vehicle', 'car', 'elm327', 'replay', 'bus'] },
      { id: 'bus-explorer', name: 'I2C & SPI Bus Explorer', icon: Cpu, accent: 'emerald', desc: 'I2C scan, registers, live sensor readouts, OLED test and SPI flash dumps via Bus Pirate', keywords: ['bus pirate', 'i2c', 'spi', 'scan', 'registers', 'sensors', 'oled', 'eeprom', 'flash dump', 'explorer'] },
      { id: 'modbus-rtu', name: 'Modbus RTU & RS-485', icon: Activity, accent: 'amber', desc: 'Industrial holding registers & inverter telemetry', keywords: ['modbus', 'rs485', 'holding registers', 'inverter', 'plc', 'scada', 'industrial', 'rtu'] },
      { id: 'plotter', name: 'Oscilloscope Plotter', icon: Activity, accent: 'rose', desc: 'Multi-channel live waveforms', keywords: ['scope', 'oscilloscope', 'waveform', 'analog', 'adc', 'graph', 'telemetry', 'channels', 'plotter'] },
      { id: 'bridge', name: 'MitM Serial Bridge', icon: ArrowLeftRight, accent: 'cyan', desc: 'Dual-port pass-through sniffer', keywords: ['mitm', 'man in the middle', 'bridge', 'dual-port', 'pass-through', 'sniffer', 'uart'] },
      { id: 'usbtmc', name: 'USBTMC Instrument', icon: Gauge, accent: 'cyan', desc: 'SCPI console, scope waveforms & screenshots, DMM logging and scripts over WebUSB', keywords: ['usbtmc', 'scpi', 'scope', 'multimeter', 'dmm', 'rigol', 'sigrok', 'visa', 'instrument'] },
      { id: 'cyberchef', name: 'CyberChef Workbench', icon: Sparkles, accent: 'purple', desc: 'Cyber Swiss Army Knife: 200+ crypto, encoding, compression & parsing operations', keywords: ['cyberchef', 'chef', 'crypto', 'base64', 'hex', 'deobfuscate', 'magic', 'entropy', 'hash', 'recipe', 'pipeline', 'gchq'] }
    ]
  },
  {
    id: 'rf',
    title: 'RF, WIRELESS & BADGES',
    items: [
      { id: 'alfa-wifi', name: 'Wi-Fi Monitor (Alfa / Panda PAU09)', icon: Wifi, accent: 'cyan', desc: 'WebUSB monitor mode & 802.11 frame capture for Alfa RTL8812AU & Panda PAU09 (RT5572)', keywords: ['alfa', 'panda', 'pau09', 'rt5572', 'rtl8812au', 'monitor mode', 'wifi', 'wi-fi', '802.11', 'pcap', 'sniffer', 'injection', 'wifi-scanner'] },
      { id: 'flipper', name: 'Flipper Zero Suite', icon: Bot, accent: 'amber', desc: 'qFlipper companion: 128x64 LCD, BadUSB, Sub-GHz, NFC & SD', keywords: ['flipper', 'flipper zero', 'qflipper', 'sub-ghz', 'subghz', 'nfc', 'rfid', 'badusb', 'screen mirror'] },
      { id: 'proxmark', name: 'Proxmark3 / PM5 Suite', icon: Radio, accent: 'cyan', desc: '13.56MHz & 125kHz RFID cloner, raw NG framing & WebFlash', keywords: ['proxmark', 'pm5', 'rfid', 'nfc', '13.56mhz', '125khz', 'mifare', 't5577', 'em4100', 'cloner', 'rfid-nfc'] },
      { id: 'mayhem', name: 'PortaPack Mayhem SDR', icon: Radio, accent: 'purple', desc: 'HackRF receiver: zoomable spectrum & waterfall, audio, sweep, ADS-B, IQ recorder, firmware flasher & first-time setup', keywords: ['mayhem', 'portapack', 'hackrf', 'sdr', 'spectrum', 'waterfall', 'ads-b', 'aircraft', 'iq', 'radio', 'sub-ghz'] },
      { id: 'wardrive', name: 'GPS & Wardrive Suite', icon: Compass, accent: 'emerald', desc: 'Warhog CYD, Piglet, Panda PAU09, NMEA tracker & u-blox UBX', keywords: ['wardrive', 'gps', 'nmea', 'ubx', 'u-blox', 'wigle', 'mapper', 'kml', 'tracking'] },
      { id: 'warhog-piglet', name: 'Warhog CYD & Piglet Suite', icon: Sparkles, accent: 'amber', desc: 'Warhog CYD (ESP32-2432S028R) & Piglet ESP32-C5/S3 wardriver deck', keywords: ['warhog', 'piglet', 'cyd', 'cheap yellow display', 'esp32-2432s028r', 'esp32-c5', 'esp32-s3', 'sd card', 'wardriver.cfg', 'screen mirror'] },
      { id: 'wardrive-generator', name: 'Demo Wardrive Generator', icon: MapPin, accent: 'emerald', desc: 'Synthetic wardriving vector art for Kepler.gl & WiGLE (inspired by OSINTIAL)', keywords: ['demo generator', 'wardrive generator', 'kepler', 'kepler.gl', 'wigle', 'vector', 'svg', 'map art', 'osintial', 'synthetic'] },
      { id: 'ble', name: 'Bluetooth LE Explorer', icon: Bluetooth, accent: 'cyan', desc: 'Web Bluetooth GATT client: services, notify, typed writes, Nordic DFU updates', keywords: ['ble', 'bluetooth', 'gatt', 'nordic', 'dfu', 'nrf', 'nrf52', 'services', 'characteristics', 'wireless'] },
      // Wireless / crypto / packet security
      { id: 'hashcat-cracker', name: 'Hash Cracker', icon: Zap, accent: 'amber', desc: 'Dictionary attack: MD5/SHA-1/256/384/512', keywords: ['hashcat', 'crack', 'hash', 'md5', 'sha', 'password'] },
      { id: 'aircrack-wifi', name: 'WPA PMKID Cracker', icon: Wifi, accent: 'cyan', desc: 'Offline WPA/WPA2 PMKID dictionary attack', keywords: ['aircrack', 'wifi', 'wpa', 'pmkid', 'crack'] },
      { id: 'tcpdump-viewer', name: 'PCAP Viewer', icon: ShieldAlert, accent: 'rose', desc: 'Parse and filter .pcap captures in-browser', keywords: ['tcpdump', 'pcap', 'viewer', 'packet'] }
    ]
  },
  {
    id: 'webapp',
    title: 'WEB APP TESTING',
    items: [
      { id: 'http-workbench', name: 'HTTP Workbench', icon: ShieldCheck, accent: 'purple', desc: 'Repeater, Intruder, Comparer & Decoder plus an OpenAPI/Swagger API client with schema fuzzing', keywords: ['burp', 'repeater', 'intruder', 'comparer', 'decoder', 'proxy', 'http', 'https', 'request', 'web app', 'api', 'openapi', 'swagger', 'rest', 'postman', 'hoppscotch', 'endpoint', 'fuzz', 'schema'] },
      { id: 'owasp-zap', name: 'Web Scanner', icon: ShieldAlert, accent: 'amber', desc: 'Passive web vuln scan: headers, cookies, CORS, TLS', keywords: ['owasp', 'zap', 'vulnerability', 'scanner', 'web', 'passive', 'headers'] },
      { id: 'nikto-scanner', name: 'Web Path Prober', icon: Sparkles, accent: 'rose', desc: 'Probe common sensitive paths and server header', keywords: ['nikto', 'vulnerability', 'scanner', 'web', 'paths'] },
      { id: 'hydra-bruteforce', name: 'HTTP Basic Auth Tester', icon: Cpu, accent: 'emerald', desc: 'Try credential lists against HTTP Basic auth', keywords: ['hydra', 'bruteforce', 'login', 'basic auth', 'http'] },
      { id: 'nmap-scanner', name: 'Port Scanner', icon: Radio, accent: 'cyan', desc: 'Browser connect-timing TCP port scan', keywords: ['nmap', 'port scanner', 'service discovery', 'network', 'recon'] },
      { id: 'dns-toolkit', name: 'DNS Toolkit', icon: Network, accent: 'indigo', desc: 'Records, email auth (SPF/DMARC/DKIM/DNSBL) & subdomain brute-force over DNS-over-HTTPS', keywords: ['dns', 'enumerate', 'doh', 'records', 'subdomain', 'recon', 'mail', 'mxtoolbox', 'spf', 'dmarc', 'dkim', 'dnsbl', 'blacklist', 'mx', 'txt', 'caa', 'email', 'deliverability', 'toolkit'] },
      { id: 'cert-inspect', name: 'Certificate Inspector', icon: ShieldCheck, accent: 'cyan', desc: 'Parse X.509 PEM/DER certificates (TLS/SSL)', keywords: ['certificate', 'x509', 'pem', 'der', 'tls', 'ssl'] },
      { id: 'pwned-passwords', name: 'Pwned Passwords', icon: ShieldCheck, accent: 'rose', desc: 'Check passwords against HaveIBeenPwned (k-anonymity)', keywords: ['pwned', 'hibp', 'breach', 'password', 'haveibeenpwned'] },
      { id: 'db-browser', name: 'Lite DB Browser', icon: Database, accent: 'emerald', desc: 'Open SQLite files read-only & query DB/REST endpoints (PostgREST, CouchDB, Elasticsearch, Datasette)', keywords: ['database', 'db', 'sqlite', 'sql', 'postgrest', 'couchdb', 'elasticsearch', 'datasette', 'rest', 'endpoint', 'table', 'browser', 'viewer'] },
      { id: 'regex-tester', name: 'Regex Tester', icon: Regex, accent: 'purple', desc: 'Live regex match highlighting, capture groups & replace preview (regex101-style, fully offline)', keywords: ['regex', 'regexp', 'regular expression', 'regex101', 'match', 'capture group', 'pattern', 'replace'] },
      { id: 'jwt-inspector', name: 'JWT Inspector', icon: KeyRound, accent: 'amber', desc: 'Decode JWT header/claims & verify HS/RS/ES/PS signatures with Web Crypto (jwt.io-style, offline)', keywords: ['jwt', 'jwt.io', 'json web token', 'jws', 'bearer', 'claims', 'hs256', 'rs256', 'es256', 'verify', 'signature', 'decode'] },
      { id: 'crtsh-finder', name: 'crt.sh Subdomain Finder', icon: Search, accent: 'emerald', desc: 'Passive subdomain enumeration from Certificate Transparency logs (crt.sh, via proxy)', keywords: ['crt.sh', 'crtsh', 'certificate transparency', 'ct logs', 'subdomain', 'enumeration', 'passive', 'recon', 'osint'] },
      { id: 'ip-calculator', name: 'IP / CIDR Calculator', icon: Calculator, accent: 'purple', desc: 'IPv4 & IPv6 subnet math: network, broadcast, mask, host range & counts (fully offline)', keywords: ['ip', 'cidr', 'subnet', 'netmask', 'wildcard', 'ipv4', 'ipv6', 'calculator', 'network', 'broadcast', 'range'] },
      { id: 'hash-calculator', name: 'Hash & HMAC Calculator', icon: Hash, accent: 'amber', desc: 'MD5 / SHA-1 / SHA-256/384/512 + HMAC for text and files via Web Crypto (fully offline)', keywords: ['hash', 'md5', 'sha', 'sha256', 'sha1', 'sha512', 'hmac', 'checksum', 'digest', 'fingerprint', 'file hash'] },
      { id: 'osint-clients', name: 'OSINT API Clients', icon: Radar, accent: 'cyan', desc: 'Shodan, urlscan.io & HackerTarget clients — bring your own API key (via proxy)', keywords: ['osint', 'shodan', 'urlscan', 'hackertarget', 'recon', 'intelligence', 'api', 'host lookup', 'reverse ip'] },
      { id: 'url-inspector', name: 'URL / Link Analyzer', icon: Link2, accent: 'purple', desc: 'Fetch a page & map its links, scripts, styles, images, forms, meta & security headers (via proxy)', keywords: ['url', 'link', 'analyzer', 'crawl', 'scrape', 'links', 'resources', 'forms', 'headers', 'security headers', 'meta', 'urlscan'] }
    ]
  },
  {
    id: 'programmers',
    title: 'HARDWARE & PAYLOADS',
    items: [
      { id: 'ducky', name: 'BadUSB & Payload Studio', icon: Keyboard, accent: 'amber', desc: 'DuckyScript keystroke compiler, syntax validator & live simulator', keywords: ['ducky', 'duckyscript', 'badusb', 'rubber ducky', 'keystroke injection', 'hid', 'payload', 'payload studio', 'arduino', 'circuitpython'] },
      { id: 'programmers', name: 'Hardware Programmers', icon: Cpu, accent: 'cyan', desc: 'CH341A SPI flash, CMSIS-DAP debugger (RTT, SWO, flash), JTAG / SVF and AVR ISP', keywords: ['programmers', 'ch341a', 'cmsis-dap', 'cmsis', 'dap', 'swd', 'rtt', 'swo', 'jtag', 'svf', 'cpld', 'avr', 'isp', 'atmega', 'spi flash', 'bios'] },
      { id: 'usb-pd', name: 'USB-PD Power Delivery', icon: Zap, accent: 'amber', desc: 'STUSB4500 sink: contract readout, voltage requests and verified NVM (power-up PDOs)', keywords: ['usb-pd', 'power delivery', 'pd', 'type-c', 'stusb4500', 'pdo', 'voltage trigger', '9v', '12v', '15v', '20v', 'e-marker'] },
      { id: 'dfu', name: 'WebUSB DFU Flasher', icon: Download, accent: 'cyan', desc: 'USB DFU 1.1 & ST DfuSe firmware download: STM32, nRF & more', keywords: ['dfu', 'dfuse', 'stm32', 'bootloader', 'flash', 'firmware update', 'gd32', 'arm'] },
      { id: 'fastboot', name: 'Android Fastboot', icon: Smartphone, accent: 'emerald', desc: 'Unlock, sparse-aware flashing, A/B slots, factory image zips, reboot over WebUSB', keywords: ['fastboot', 'android', 'bootloader', 'unlock', 'partitions', 'sparse', 'recovery', 'reboot'] },
      { id: 'adb', name: 'Android ADB', icon: Smartphone, accent: 'emerald', desc: 'Device info, shell, files, apps, logcat, screen with tap control, wireless ADB', keywords: ['adb', 'android', 'shell', 'logcat', 'screen mirror', 'tap', 'file manager', 'wireless adb', 'apk'] }
    ]
  },
  {
    id: 'utilities',
    title: 'DEVICE UTILITIES',
    items: [
      { id: 'micropython', name: 'MicroPython Files', icon: FileCode, accent: 'purple', desc: 'On-chip filesystem explorer', keywords: ['micropython', 'repl', 'mip', 'files', 'ampy', 'python', 'pyboard'] },
      { id: 'improv', name: 'Improv Wi-Fi', icon: Wifi, accent: 'emerald', desc: 'Standard serial Wi-Fi provisioner', keywords: ['improv', 'wifi', 'provisioner', 'home assistant', 'serial wifi'] },
      { id: 'telemetry', name: 'Telemetry Gauges', icon: Gauge, accent: 'cyan', desc: 'Speedometer sensor dials', keywords: ['telemetry', 'gauges', 'speedometer', 'dials', 'sensors', 'dashboard'] },
      { id: 'alerts', name: 'Crash & Panic Alerts', icon: ShieldAlert, accent: 'rose', desc: 'Auto-detect kernel panics', keywords: ['alerts', 'crash', 'panic', 'watchdog', 'coredump', 'kernel panic', 'backtrace'] },
      { id: 'automation', name: 'Test Runner & Scripts', icon: Bot, accent: 'purple', desc: 'Automated JS test routines', keywords: ['automation', 'scripts', 'test runner', 'javascript', 'testing'] },
      { id: 'autopsy', name: 'USB Recon & Autopsy', icon: Usb, accent: 'amber', desc: 'Mystery chip descriptor analysis', keywords: ['autopsy', 'recon', 'mystery chip', 'vape', 'vid pid', 'baud hunter', 'reverse engineering'] },
      { id: 'usb-descriptors', name: 'USB Descriptor Explorer', icon: Usb, accent: 'cyan', desc: 'lsusb -v in the browser: configs, interfaces, endpoints', keywords: ['descriptors', 'usb-descriptors', 'lsusb', 'tree', 'endpoints', 'interfaces', 'configs'] },
      { id: 'hid', name: 'HID Inspector', icon: Keyboard, accent: 'purple', desc: 'Decode live reports, report rate, record/playback, output & feature reports (WebHID)', keywords: ['hid', 'webhid', 'reports', 'gamepad', 'keyboard', 'mouse', 'input reports'] },
      { id: 'mass-storage', name: 'Mass Storage Inspector', icon: HardDrive, accent: 'amber', desc: 'Read-only: partitions, FAT/exFAT browsing, deleted-file recovery, imaging with SHA-256', keywords: ['mass storage', 'usb drive', 'flash drive', 'fat32', 'exfat', 'forensics', 'carving', 'mbr', 'scsi', 'msc', 'bot'] },
      { id: 'ptp', name: 'PTP / MTP Camera', icon: Camera, accent: 'purple', desc: 'Storage, thumbnails, bulk download, delete and remote capture over WebUSB', keywords: ['ptp', 'mtp', 'camera', 'dslr', 'photos', 'canon', 'nikon', 'sony', 'tether'] },
      { id: 'fido2', name: 'FIDO2 Security Key', icon: KeyRound, accent: 'emerald', desc: 'Read a security key: versions, AAGUID, options (WebHID, read-only)', keywords: ['fido2', 'webauthn', 'u2f', 'security key', 'yubikey', 'ctap2', 'aaguid'] }
    ]
  },
  {
    id: 'setup',
    title: 'SETUP & REFERENCE',
    items: [
      { id: 'wiki-external', name: 'Knowledge Base Wiki', icon: BookOpen, href: './wiki/', accent: 'amber', desc: 'Standalone documentation & firmware manual', keywords: ['wiki', 'docs', 'documentation', 'manual', 'help', 'guides'] },
      { id: 'session-log', name: 'Session Log & Report', icon: ScrollText, accent: 'emerald', desc: 'Everything the hardware tools did this session: devices, actions, errors. Export Markdown / JSON', keywords: ['session log', 'audit', 'report', 'export', 'markdown', 'json', 'history'] },
      { id: 'setup', name: 'Linux Setup & Drivers', icon: HelpCircle, accent: 'purple', desc: 'udev rules & USB-UART drivers', keywords: ['setup', 'drivers', 'udev', 'linux', 'zadig', 'winusb', 'ch340', 'cp2102'] },
      { id: 'esp-dump', name: 'Silicon Memory Dump', icon: Cpu, accent: 'amber', desc: 'Direct eFuse and flash reader', keywords: ['esp-dump', 'efuse', 'silicon', 'flash dump', 'rom', 'mac address'] },
      { id: 'pinouts-modal', name: 'Pinouts Reference', icon: BookOpen, isModal: true, accent: 'cyan', desc: 'ESP32 & USB wiring diagrams', keywords: ['pinouts', 'wiring', 'diagrams', 'esp32', 'level shift'] },
      { id: 'intel-modal', name: 'Chip Intelligence', icon: Cpu, isModal: true, accent: 'cyan', desc: 'VID/PID device identification', keywords: ['chip', 'intel', 'vid', 'pid', 'lookup', 'usb id'] }
    ]
  }
];

export default function Sidebar({
  activeTool,
  openTools = [],          // window ids currently open on the desktop
  onSelectTool,
  isCollapsed,
  onToggleCollapse,
  onOpenPinouts,
  onOpenHardwareIntel
}) {
  const [filterQuery, setFilterQuery] = useState('');

  const handleItemClick = (item, ev) => {
    if (item.id === 'wiki-external' || item.href) {
      const targetUrl = item.id === 'wiki-external'
        ? (activeTool ? `./wiki/?tool=${activeTool}` : './wiki/?article=workspace')
        : item.href;
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (item.id === 'pinouts-modal') {
      onOpenPinouts?.();
    } else if (item.id === 'intel-modal') {
      onOpenHardwareIntel?.();
    } else {
      // Alt/Ctrl-click opens another instance in a new window instead of
      // focusing the one that's already open.
      onSelectTool(item.id, (ev && (ev.altKey || ev.ctrlKey || ev.metaKey)) ? { forceNew: true } : undefined);
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
          const visibleItems = section.items.filter((item) => {
            if (!filterQuery) return true;
            const q = filterQuery.toLowerCase().trim();
            const searchCorpus = [
              item.name,
              item.desc,
              item.id,
              ...(item.keywords || [])
            ].join(' ').toLowerCase();
            return q.split(/\s+/).every((token) => searchCorpus.includes(token));
          });

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
                    (item.id === 'alfa-wifi' && ['alfa-wifi', 'wifi-scanner'].includes(activeTool)) ||
                    (item.id === 'packet-analyzer' && ['packet-analyzer', 'hex', 'packets', 'kismet'].includes(activeTool)) ||
                    (item.id === 'wardrive' && ['wardrive', 'ubx'].includes(activeTool)) ||
                    (item.id === 'programmers' && ['programmers', 'ch341a', 'cmsis-dap', 'jtag-programmer', 'avr-isp'].includes(activeTool));
                  const isOpen = !item.isModal && !item.href && openTools.includes(windowKeyFor(item.id));

                  return (
                    <button
                      key={item.id}
                      onClick={(e) => handleItemClick(item, e)}
                      title={
                        item.id === 'wiki-external'
                          ? `Knowledge Base Wiki: Open documentation${activeTool ? ` for ${activeTool}` : ''}`
                          : `${item.name}: ${item.desc}${isOpen ? ' (open — click to bring its window to the front; Alt-click to open another instance)' : ''}`
                      }
                      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl text-xs border transition-all text-left ${getAccentStyles(
                        item,
                        isActive
                      )} ${isCollapsed ? 'justify-center px-1' : ''}`}
                    >
                      <span className="relative shrink-0">
                        <Icon className={`w-4 h-4 ${isActive ? 'scale-110' : 'opacity-70'}`} />
                        {isOpen && <span data-open-dot className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-emerald-400'}`} />}
                      </span>
                      {!isCollapsed && (
                        <div className="truncate flex-1 flex items-center gap-1.5">
                          <div className="truncate">{item.name}</div>
                          {item.demoOnly && (
                            <span className="shrink-0 px-1 rounded text-[9px] font-bold tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/40">DEMO</span>
                          )}
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
