import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Wifi,
  Usb,
  Trash2,
  Cpu,
  HardDrive,
  Terminal,
  Search,
  Sliders,
  RefreshCw,
  ExternalLink,
  Flame,
  Cable,
  Activity
} from 'lucide-react';
import { PigletToolkitClient } from '../../utils/pigletToolkit';
import PigletFileBrowser from './piglet/PigletFileBrowser';
import PigletConfigEditor from './piglet/PigletConfigEditor';
import PigletDeviceControl from './piglet/PigletDeviceControl';

export const DEFAULT_WARDRIVER_CFG = {
  // WiGLE & Upload Services
  wigleBasicToken: '',
  wdgwarsApiKey: '',
  wardriftApiKey: '',
  maxBootUploads: -1,

  // Wi-Fi Connectivity
  homeSsid: '',
  homePsk: '',
  wardriverSsid: 'WarHog-WARDRIVE',
  wardriverPsk: 'wardrive1234',
  autoStartAfterUpload: false,
  uploadOnNetworkSeen: true,

  // Radio & Scanning
  gpsBaud: 9600,
  scanMode: 'aggressive', // 'aggressive' | 'powersaving'
  scan24: true,
  scan5: true,
  bluetoothScan: true,

  // Mesh & BLE Bridge
  meshModeOnBoot: 'none', // 'none' | 'core' | 'node' | 'off'
  biscuitReport: false,
  blePhoneSolo: true,
  blePersonality: 'wardrivego', // 'wardrivego' | 'biscuit'

  // Hardware, Theme & Display
  board: 'auto', // 'auto' | 's3' | 'c5' | 'c6' | 'c3' | 'exp'
  theme: 'dracula', // 'dracula' | 'midnight' | 'nord' | 'gruvbox' | 'catppuccin' | 'tokyonight'
  speedUnits: 'mph', // 'mph' | 'kmh'
  battPin: 9, // GPIO 9 on CYD / -1 for disabled
  batteryTest: false,
  rotateScreen180: false,
  sdMaxSpiHz: 20000000,

  // Identification & Marauder
  deviceName: '',
  beaconSsid: '',

  // Network Whitelist (up to 10 SSIDs not logged to CSV)
  ssidWhitelist1: '',
  ssidWhitelist2: '',
  ssidWhitelist3: '',
  ssidWhitelist4: '',
  ssidWhitelist5: '',
  ssidWhitelist6: '',
  ssidWhitelist7: '',
  ssidWhitelist8: '',
  ssidWhitelist9: '',
  ssidWhitelist10: ''
};

export const HARDWARE_PRESETS = {
  'freenove-s3-cyd': {
    id: 'freenove-s3-cyd',
    label: '🐗 WarHog CYD — Freenove S3 (2.8" Capacitive Touch TFT)',
    description: 'ESP32-S3 Dual-Core, ILI9341 240x320 Touch, 4-bit SDIO, UART GPS (IO44/43), Batt ADC (IO9)',
    chipFamily: 'ESP32-S3',
    board: 's3',
    manifest: 'freenove-s3-cyd-ham-ui4.json',
    patch: {
      board: 's3',
      battPin: 9,
      theme: 'dracula',
      scan24: true,
      scan5: false,
      bluetoothScan: true,
      meshModeOnBoot: 'core',
      gpsBaud: 9600,
      deviceName: 'WarHog-CYD'
    }
  },
  'guition-jc8048w550': {
    id: 'guition-jc8048w550',
    label: '🐗 Guition JC8048W550 (5.0" 800x480 RGB IPS)',
    description: 'ESP32-S3 N16R8, GT911 Capacitive Touch, SPI SD (CS: IO10), UART GPS (IO44/43)',
    chipFamily: 'ESP32-S3',
    board: 's3',
    manifest: 'guition-jc8048w550.json',
    patch: {
      board: 's3',
      battPin: -1,
      theme: 'dracula',
      scan24: true,
      scan5: false,
      bluetoothScan: true,
      meshModeOnBoot: 'core',
      gpsBaud: 9600,
      deviceName: 'WarHog-550'
    }
  },
  'xiao-c5-core': {
    id: 'xiao-c5-core',
    label: '🐷 WarHog Core / Piglet — XIAO ESP32-C5 (Dual-Band 2.4/5GHz)',
    description: 'ESP32-C5 RISC-V, Dual-Band Wi-Fi 6, 0.96" OLED (I2C: 23/24), MicroSD SPI (7/8/9/10), GPS (12/11)',
    chipFamily: 'ESP32-C5',
    board: 'c5',
    manifest: 'xiao_c5.json',
    patch: {
      board: 'c5',
      battPin: -1,
      scan24: true,
      scan5: true,
      bluetoothScan: true,
      blePhoneSolo: true,
      blePersonality: 'wardrivego',
      meshModeOnBoot: 'none',
      gpsBaud: 9600,
      deviceName: 'Piglet-C5'
    }
  },
  'warhognode-c5': {
    id: 'warhognode-c5',
    label: '🐷 WarHogNode C5 (Headless Dual-Band Mesh Worker)',
    description: 'ESP32-C5 RISC-V, Dual-Band Wi-Fi 6 Worker Node for ESP-NOW Mesh Wardriving',
    chipFamily: 'ESP32-C5',
    board: 'c5',
    manifest: 'warhognode_c5.json',
    patch: {
      board: 'c5',
      scan24: true,
      scan5: true,
      bluetoothScan: false,
      meshModeOnBoot: 'node',
      deviceName: 'Node-C5'
    }
  },
  'c3-node': {
    id: 'c3-node',
    label: '🐗 WarHogNode C3 (0.42" OLED Micro-Node)',
    description: 'ESP32-C3 RISC-V Single-Core, 72x40 SSD1306 PigWorld Animation, Autonomous ESP-NOW Node',
    chipFamily: 'ESP32-C3',
    board: 'c3',
    manifest: 'esp32c3_oled.json',
    patch: {
      board: 'c3',
      scan24: true,
      scan5: false,
      meshModeOnBoot: 'node',
      deviceName: 'Node-C3'
    }
  },
  'xiao-s3': {
    id: 'xiao-s3',
    label: '🐷 Piglet — Seeed XIAO ESP32-S3',
    description: 'ESP32-S3 Dual-Core, 2.4GHz, MicroSD SPI (4/7/8/9), GPS UART (44/43), OLED (5/6)',
    chipFamily: 'ESP32-S3',
    board: 's3',
    manifest: null,
    patch: {
      board: 's3',
      battPin: -1,
      scan24: true,
      scan5: false,
      bluetoothScan: true,
      meshModeOnBoot: 'none',
      gpsBaud: 9600,
      deviceName: 'Piglet-S3'
    }
  },
  'tdongle-c5': {
    id: 'tdongle-c5',
    label: '🐗 LilyGo T-Dongle C5 (Dual-Band USB Dongle)',
    description: 'ESP32-C5 RISC-V, 0.96" Color TFT, MicroSD SPI, Qwiic GPS Port, USB-A form factor',
    chipFamily: 'ESP32-C5',
    board: 'c5',
    manifest: 'tdongle_c5-ham.json',
    patch: {
      board: 'c5',
      scan24: true,
      scan5: true,
      bluetoothScan: true,
      meshModeOnBoot: 'none',
      gpsBaud: 9600,
      deviceName: 'TDongle-C5'
    }
  },
  'waveshare-c6': {
    id: 'waveshare-c6',
    label: '🐗 Waveshare ESP32-C6 Mini (1.47" Color ST7789)',
    description: 'ESP32-C6 RISC-V Wi-Fi 6, 172x320 ST7789 TFT, MicroSD SPI, GPS UART (17/16)',
    chipFamily: 'ESP32-C6',
    board: 'c6',
    manifest: 'waveshare_c6.json',
    patch: {
      board: 'c6',
      scan24: true,
      scan5: false,
      bluetoothScan: true,
      meshModeOnBoot: 'none',
      gpsBaud: 9600,
      deviceName: 'Waveshare-C6'
    }
  }
};

export function serializeWardriverConfig(cfg) {
  const c = { ...DEFAULT_WARDRIVER_CFG, ...cfg };
  const lines = [
    '# ============================================================',
    '# WarHog Wardriver Configuration',
    '# Format: key=value',
    '# Lines starting with # are comments and ignored.',
    '# Upstream: https://github.com/olosnoks/warhog',
    '# ============================================================',
    '',
    '# ------------------------------------------------------------',
    '# WiGLE Upload',
    '# ------------------------------------------------------------',
    '# Encoded for Use token from https://wigle.net/account',
    `wigleBasicToken=${c.wigleBasicToken || ''}`,
    '',
    '# ------------------------------------------------------------',
    '# WatchDogsGoWars & Wardrift APIs',
    '# ------------------------------------------------------------',
    `wdgwarsApiKey=${c.wdgwarsApiKey || ''}`,
    `wardriftApiKey=${c.wardriftApiKey || ''}`,
    `maxBootUploads=${c.maxBootUploads !== undefined ? c.maxBootUploads : -1}`,
    '',
    '# ------------------------------------------------------------',
    '# Home Wi-Fi (STA mode) & SoftAP',
    '# ------------------------------------------------------------',
    `homeSsid=${c.homeSsid || ''}`,
    `homePsk=${c.homePsk || ''}`,
    `wardriverSsid=${c.wardriverSsid || 'WarHog-WARDRIVE'}`,
    `wardriverPsk=${c.wardriverPsk || 'wardrive1234'}`,
    `autoStartAfterUpload=${c.autoStartAfterUpload === true ? 'true' : 'false'}`,
    `uploadOnNetworkSeen=${c.uploadOnNetworkSeen !== false ? 'true' : 'false'}`,
    '',
    '# ------------------------------------------------------------',
    '# GPS & Radio Scanning',
    '# ------------------------------------------------------------',
    `gpsBaud=${c.gpsBaud || 9600}`,
    `scanMode=${c.scanMode || 'aggressive'}`,
    `scan24=${c.scan24 !== false ? 'true' : 'false'}`,
    `scan5=${c.scan5 === true ? 'true' : 'false'}`,
    `bluetoothScan=${c.bluetoothScan !== false ? 'true' : 'false'}`,
    '',
    '# ------------------------------------------------------------',
    '# Mesh Mode & BLE Bridge',
    '# ------------------------------------------------------------',
    `meshModeOnBoot=${c.meshModeOnBoot || 'none'}`,
    `biscuitReport=${c.biscuitReport === true ? 'true' : 'false'}`,
    `blePhoneSolo=${c.blePhoneSolo !== false ? 'true' : 'false'}`,
    `blePersonality=${c.blePersonality || 'wardrivego'}`,
    '',
    '# ------------------------------------------------------------',
    '# Hardware, Theme & Display',
    '# ------------------------------------------------------------',
    `board=${c.board || 'auto'}`,
    `theme=${c.theme || 'dracula'}`,
    `speedUnits=${c.speedUnits || 'mph'}`,
    `battPin=${c.battPin !== undefined ? c.battPin : 9}`,
    `batteryTest=${c.batteryTest === true ? 'true' : 'false'}`,
    `rotateScreen180=${c.rotateScreen180 === true ? 'true' : 'false'}`,
    `sdMaxSpiHz=${c.sdMaxSpiHz || 20000000}`,
    '',
    '# ------------------------------------------------------------',
    '# Device Name & Marauder Beacon',
    '# ------------------------------------------------------------',
    `deviceName=${c.deviceName || ''}`,
    `beaconSsid=${c.beaconSsid || ''}`,
    '',
    '# ------------------------------------------------------------',
    '# Network Whitelist (up to 10 SSIDs excluded from CSV log)',
    '# ------------------------------------------------------------'
  ];

  for (let i = 1; i <= 10; i++) {
    lines.push(`ssidWhitelist${i}=${c[`ssidWhitelist${i}`] || ''}`);
  }

  return lines.join('\n');
}

export function parseWardriverConfigText(rawText, fallback = DEFAULT_WARDRIVER_CFG) {
  if (!rawText || typeof rawText !== 'string') return { ...fallback };
  const next = { ...fallback };
  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith(';')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    if (key in next) {
      const sample = next[key];
      if (typeof sample === 'boolean') {
        next[key] = val.toLowerCase() === 'true' || val === '1';
      } else if (typeof sample === 'number') {
        const num = Number(val);
        if (!Number.isNaN(num)) next[key] = num;
      } else {
        next[key] = val;
      }
    }
  }
  return next;
}

const HARDWARE_PINOUTS = [
  {
    board: 'WarHog CYD (Freenove S3)',
    gps: 'RX: GPIO 44, TX: GPIO 43',
    storage: '4-bit SDIO (CMD 40, CLK 38, D0 39, D1 41, D2 48, D3 47)',
    display: '2.8" ILI9341 240x320 SPI + Capacitive Touch (SDA 16, SCL 15)',
    notes: 'Battery ADC on GPIO 9 (1:2 divider). Backlight PWM on GPIO 45.'
  },
  {
    board: 'Guition JC8048W550',
    gps: 'RX: GPIO 44, TX: GPIO 43',
    storage: 'SPI MicroSD (CS 10, MISO 11, SCK 12, MOSI 13)',
    display: '5.0" 800x480 RGB IPS + GT911 Touch (I2C1 SDA 19, SCL 20)',
    notes: 'ESP32-S3 N16R8 (16MB Flash, 8MB PSRAM). Backlight on GPIO 2.'
  },
  {
    board: 'WarHog Core / Piglet (XIAO C5)',
    gps: 'RX: GPIO 12, TX: GPIO 11 (ATGM336H / NEO-6M @ 9600 baud)',
    storage: 'SPI MicroSD (CS 7, SCK 8, MISO 9, MOSI 10)',
    display: '0.96" SSD1306 OLED (I2C SDA 23, SCL 24)',
    notes: 'Native 2.4 + 5 GHz Wi-Fi 6. Push button on GPIO 0.'
  },
  {
    board: 'WarHog / Piglet (XIAO S3)',
    gps: 'RX: GPIO 44, TX: GPIO 43',
    storage: 'SPI MicroSD (CS 4, SCK 7, MISO 8, MOSI 9)',
    display: '0.96" SSD1306 OLED (I2C SDA 5, SCL 6)',
    notes: 'Xtensa Dual-Core. Push button on GPIO 2.'
  },
  {
    board: 'WarHog / Piglet (XIAO C6)',
    gps: 'RX: GPIO 17, TX: GPIO 16',
    storage: 'SPI MicroSD (CS 21, SCK 19, MISO 20, MOSI 18)',
    display: '0.96" SSD1306 OLED (I2C SDA 22, SCL 23)',
    notes: 'RISC-V Wi-Fi 6. Push button on GPIO 1.'
  },
  {
    board: 'WarHogNode C3 (Micro-Node)',
    gps: 'Headless (No GPS onboard; relies on Core over ESP-NOW)',
    storage: 'Headless / Internal Flash',
    display: '0.42" 72x40 SSD1306 OLED (I2C SDA 6, SCL 7)',
    notes: 'PigWorld 1-bit flocking animation. Worker node on ch 6.'
  }
];

const FLASHER_URL = 'https://olosnoks.github.io/warhog/';

export default function WarhogPigletWorkbench() {
  const [activeTab, setActiveTab] = useState('sd'); // 'sd' | 'config' | 'device' | 'serial' | 'flasher' | 'pinouts'

  // Piglet Toolkit (WT protocol over USB): same client as the web flasher
  const [tkConnected, setTkConnected] = useState(false);
  const [tkConnecting, setTkConnecting] = useState(false);
  const [tkBusy, setTkBusyState] = useState(false);
  const [tkInfo, setTkInfo] = useState('');
  const [tkStatus, setTkStatus] = useState({ text: 'disconnected', tone: '' });
  const [tkLog, setTkLog] = useState('');
  const tkLogRef = useRef(null);
  const setTkBusy = useCallback((b) => setTkBusyState(b), []);
  const setStatus = useCallback((text, tone = '') => setTkStatus({ text, tone }), []);
  const log = useCallback((msg) => setTkLog((prev) => (prev + msg + '\n').slice(-20000)), []);

  // Serial console (shares the toolkit's USB session)
  const [serialLogs, setSerialLogs] = useState([]);
  const [serialInput, setSerialInput] = useState('');
  const logContainerRef = useRef(null);

  // Targets Captured
  const [capturedTargets, setCapturedTargets] = useState([]);
  const [bandFilter, setBandFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const clientRef = useRef(null);
  if (!clientRef.current) {
    clientRef.current = new PigletToolkitClient({
      onLog: (m) => log(m),
      onDebugLine: (line) => setSerialLogs((prev) => [...prev.slice(-500), line]),
      onDisconnect: () => {
        setTkConnected(false);
        setTkInfo('');
        setTkBusyState(false);
        setTkStatus((s) => (s.tone === 'bad' ? s : { text: 'disconnected', tone: '' }));
      }
    });
  }
  const client = clientRef.current;
  const serialSupported = PigletToolkitClient.isSupported();

  // Close the session (WT BYE, so the Piglet resumes scanning) when leaving the page.
  useEffect(() => () => { client.disconnect(); }, [client]);

  useEffect(() => {
    if (tkLogRef.current) tkLogRef.current.scrollTop = tkLogRef.current.scrollHeight;
  }, [tkLog]);

  const handleConnect = async () => {
    if (tkConnecting) return;
    if (tkConnected) { await client.disconnect(); return; }
    setTkConnecting(true);
    try {
      setStatus('waiting for the Piglet to answer…');
      const info = await client.connect();
      setTkInfo(info);
      setTkConnected(true);
      setStatus('connected · ' + info, 'ok');
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      const noPort = /No port/i.test(msg);
      setStatus(noPort ? 'no port selected' : 'error: ' + msg, noPort ? '' : 'bad');
    } finally {
      setTkConnecting(false);
    }
  };

  // Rows from a WiGLE CSV opened in the SD explorer feed the Captured Targets table.
  const handleCsvRows = useCallback((rows) => {
    if (!rows?.length) return;
    setCapturedTargets((prev) => {
      const map = new Map(prev.map((n) => [n.bssid, n]));
      for (const r of rows) {
        const sec = r.auth.replace(/\[ESS\]/ig, '').replace(/^\[|\]$/g, '').trim();
        map.set(r.mac, {
          bssid: r.mac,
          ssid: r.ssid,
          rssi: r.rssi,
          channel: r.ch,
          type: r.type,
          band: r.type === 'BLE' ? 'BLE' : (r.freq || 0) >= 4900 || (r.ch || 0) > 14 ? '5GHz' : '2.4GHz',
          auth: r.type === 'BLE' ? 'BLE' : (!sec || /^open$/i.test(sec) ? 'OPEN' : sec.replace(/\]\[/g, ' ')),
          lat: r.lat,
          lon: r.lon,
          time: r.seen
        });
      }
      return Array.from(map.values());
    });
  }, []);

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [serialLogs]);

  // Filtered captured targets
  const filteredTargets = useMemo(() => {
    return capturedTargets.filter(item => {
      if (bandFilter === '2.4GHz' && item.band !== '2.4GHz') return false;
      if (bandFilter === '5GHz' && item.band !== '5GHz') return false;
      if (bandFilter === 'BLE' && item.band !== 'BLE' && item.type !== 'BLE') return false;
      if (bandFilter === 'OPEN' && item.auth !== 'OPEN' && !item.auth?.includes('OPEN')) return false;

      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        (item.ssid && item.ssid.toLowerCase().includes(q)) ||
        (item.bssid && item.bssid.toLowerCase().includes(q)) ||
        (item.auth && item.auth.toLowerCase().includes(q))
      );
    });
  }, [capturedTargets, bandFilter, searchQuery]);

  const statusTone = tkStatus.tone === 'ok' ? 'text-emerald-300' : tkStatus.tone === 'bad' ? 'text-rose-300' : 'text-slate-400';

  return (
    <div className="space-y-4 max-w-7xl mx-auto p-2 sm:p-4 text-slate-200">
      {/* Header Banner */}
      <div className="bg-[#10131a] border border-amber-500/30 rounded-xl p-4 sm:p-5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-40 bg-gradient-to-bl from-amber-500/10 to-transparent pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🐗</span>
              <h1 className="text-xl sm:text-2xl font-black tracking-wider text-slate-100 uppercase">
                WARHOG &amp; PIGLET TOOLSUITE
              </h1>
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                WT Protocol v1
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 max-w-2xl">
              The Piglet Toolkit from the WarHog web flasher: connect your <strong className="text-amber-400">Piglet</strong> over USB to browse its SD card, view WiGLE logs, and edit <code className="text-cyan-300">wardriver.cfg</code> through the firmware&apos;s <code className="text-amber-300">SerialTool</code> WT protocol.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://github.com/olosnoks/warhog"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-amber-500/50 text-xs font-semibold text-slate-300 hover:text-amber-300 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>GitHub: olosnoks/warhog</span>
            </a>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('sd')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'sd'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Cable className="w-3.5 h-3.5" />
            <span>SD Card File Explorer (USB)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('config')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'config'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>wardriver.cfg Editor</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('device')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'device'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Device Control (USB)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('serial')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'serial'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Serial Console ({tkConnected ? 'Live' : 'Closed'})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('flasher')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'flasher'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Web Flasher</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pinouts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'pinouts'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Hardware Pinouts</span>
          </button>
        </div>
      </div>

      {/* Piglet Toolkit connection bar (shared by the SD, config and console tabs) */}
      {(activeTab === 'sd' || activeTab === 'config' || activeTab === 'device' || activeTab === 'serial') && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleConnect}
            disabled={!serialSupported || tkConnecting}
            className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg font-bold text-xs transition shadow-md disabled:opacity-50 ${
              tkConnected ? 'bg-rose-600/80 hover:bg-rose-600 text-white' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
            }`}
          >
            <Usb className="w-4 h-4" />
            <span>{!serialSupported ? 'USB not supported' : tkConnected ? 'Disconnect' : tkConnecting ? 'Connecting…' : 'Connect over USB'}</span>
          </button>
          <span className={`text-xs font-mono flex items-center gap-2 ${statusTone}`}>
            {(tkBusy || tkConnecting) && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />}
            {tkStatus.text}
          </span>
          {!serialSupported && (
            <span className="text-xs text-rose-300">WebSerial needs Chrome or Edge on desktop.</span>
          )}
          {!tkConnected && serialSupported && (
            <span className="text-[11px] text-slate-500 ml-auto">
              Plug the Piglet in with the same USB cable you flash with. Scanning pauses while the toolkit is connected.
            </span>
          )}
        </div>
      )}

      {/* TAB 1: SD CARD FILE EXPLORER (Piglet Toolkit over USB) */}
      <div className={activeTab === 'sd' ? 'space-y-4' : 'hidden'}>
        {tkConnected ? (
          <PigletFileBrowser
            client={client}
            connected={tkConnected}
            busy={tkBusy}
            setBusy={setTkBusy}
            setStatus={setStatus}
            log={log}
            onCsvRows={handleCsvRows}
          />
        ) : (
          <div className="bg-[#12151c] border border-slate-800 rounded-xl py-14 px-4 text-center text-xs text-slate-500 space-y-2">
            <HardDrive className="w-8 h-8 mx-auto text-slate-600" />
            <p>Connect the Piglet over USB to browse its SD card.</p>
            <p className="text-[11px] text-slate-600">
              Talks to the firmware&apos;s <code>SerialTool.cpp</code> WT protocol, exactly like the Piglet Toolkit in the web flasher.
              Flash the latest firmware if the Piglet doesn&apos;t answer.
            </p>
          </div>
        )}
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Toolkit log</span>
            <button type="button" onClick={() => setTkLog('')} className="text-[11px] text-slate-500 hover:text-slate-300">Clear</button>
          </div>
          <pre ref={tkLogRef} className="h-28 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-2 text-[11px] font-mono text-slate-400 whitespace-pre-wrap">{tkLog}</pre>
        </div>
      </div>

      {/* TAB 2: WARDRIVER.CFG EDITOR */}
      <div className={activeTab === 'config' ? '' : 'hidden'}>
        <PigletConfigEditor
          client={client}
          connected={tkConnected}
          busy={tkBusy}
          setBusy={setTkBusy}
          setStatus={setStatus}
          log={log}
        />
      </div>

      {/* TAB 3: DEVICE CONTROL over USB (replaces the SoftAP Web UI bridge) */}
      <div className={activeTab === 'device' ? '' : 'hidden'}>
        <PigletDeviceControl
          client={client}
          connected={tkConnected}
          active={activeTab === 'device'}
          busy={tkBusy}
          setBusy={setTkBusy}
          setStatus={setStatus}
          log={log}
          onEditConfig={() => setActiveTab('config')}
        />
      </div>

      {/* TAB 4: SERIAL CONSOLE (same USB session as the toolkit) */}
      {activeTab === 'serial' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-sm">Serial Console</h2>
                {tkInfo && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {tkInfo}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Firmware debug output from the toolkit&apos;s USB session. Lines you send go straight to the Piglet; WT replies that no file operation is waiting for show up here.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSerialLogs([])}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-xs text-slate-400 hover:text-slate-200 border border-slate-800"
            >
              Clear Logs
            </button>
          </div>

          <div
            ref={logContainerRef}
            className="w-full h-80 bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300 space-y-0.5"
          >
            {serialLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-600">
                {tkConnected ? 'Waiting for firmware output…' : 'Connect over USB to see the Piglet’s serial output.'}
              </div>
            ) : (
              serialLogs.map((l, i) => (
                <div key={i} className="break-all whitespace-pre-wrap">
                  {l}
                </div>
              ))
            )}
          </div>

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const line = serialInput.trim();
              if (!line || !tkConnected) return;
              try {
                await client.writeLine(line);
                setSerialLogs((prev) => [...prev, `> ${line}`]);
                setSerialInput('');
              } catch (err) {
                setSerialLogs((prev) => [...prev, `[ERROR] ${err.message}`]);
              }
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              placeholder={tkBusy ? 'Waiting for the current file operation…' : 'Send a line to the Piglet (e.g. WT HELLO)'}
              disabled={!tkConnected || tkBusy}
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-amber-500/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!tkConnected || tkBusy || !serialInput.trim()}
              className="px-4 py-1.5 rounded bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs transition"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* TAB 5: WEB FLASHER */}
      {activeTab === 'flasher' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-amber-400" />
                <h2 className="font-bold text-slate-100 text-sm">WarHog Web Flasher</h2>
              </div>
              <p className="text-xs text-slate-400">
                Firmware is flashed from the hosted WarHog web flasher (ESP Web Tools, plus a patched esptool-js for ESP32-C5 over native USB).
              </p>
            </div>
            <a
              href={FLASHER_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open the web flasher</span>
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(HARDWARE_PRESETS).map(([k, p]) => (
              <div
                key={k}
                className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl flex flex-col justify-between space-y-3"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-100">{p.label.split('—')[0]}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300">
                      {p.chipFamily}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1">{p.description}</p>
                </div>

                <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                  {p.manifest ? (
                    <>
                      <a
                        href={FLASHER_URL}
                        target="_blank"
                        rel="noreferrer"
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs transition"
                      >
                        <Flame className="w-3 h-3" />
                        <span>Flash in browser</span>
                      </a>
                      <a
                        href={`${FLASHER_URL}manifests/${p.manifest}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block text-[10px] text-slate-500 hover:text-slate-300 text-center font-mono"
                      >
                        manifest: {p.manifest}
                      </a>
                    </>
                  ) : (
                    <div className="text-[10px] text-slate-500 text-center">Not in the web flasher. Build it with PlatformIO.</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
            <h3 className="font-bold text-xs text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span>PlatformIO CLI Flashing (Direct Toolchain)</span>
            </h3>
            <p className="text-xs text-slate-400">
              Each hardware project in the repository contains its own pinned PlatformIO configuration:
            </p>
            <div className="p-2.5 bg-slate-900 border border-slate-800 rounded font-mono text-xs text-cyan-300 space-y-1">
              <div># Flash Freenove S3 CYD (2.8" Capacitive Touch):</div>
              <div className="text-slate-100 font-bold">cd WarHog_Freenove_S3_CYD_HAM_UI4 &amp;&amp; pio run -e freenove-s3-cyd-ham-ui4 -t upload</div>
              <div className="pt-1"># Flash XIAO C5 Core:</div>
              <div className="text-slate-100 font-bold">cd warhog_fork &amp;&amp; pio run -t upload</div>
              <div className="pt-1"># Flash WarHogNode C3 (0.42" OLED):</div>
              <div className="text-slate-100 font-bold">cd c3_node &amp;&amp; pio run -t upload</div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: HARDWARE PINOUTS */}
      {activeTab === 'pinouts' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="space-y-1 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Cpu className="w-4 h-4 text-emerald-400" />
              <h2 className="font-bold text-slate-100 text-sm">Official WarHog Hardware Pinouts</h2>
            </div>
            <p className="text-xs text-slate-400">
              Accurate pin assignments verified from <code className="text-amber-300">PinMapDefs.h</code> and <code className="text-cyan-300">BoardPins.h</code> in the WarHog repository.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {HARDWARE_PINOUTS.map((h, i) => (
              <div key={i} className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <div className="font-bold text-xs text-amber-300">{h.board}</div>
                <div className="text-xs space-y-1 text-slate-300">
                  <div>
                    <span className="text-slate-500 font-semibold">GPS: </span>
                    <span className="font-mono text-cyan-300">{h.gps}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-semibold">Storage: </span>
                    <span className="font-mono text-emerald-300">{h.storage}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 font-semibold">Display: </span>
                    <span className="font-mono text-pink-300">{h.display}</span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-900">
                  {h.notes}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Captured Targets Table (Always Available) */}
      <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wifi className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-slate-100 text-sm">
              Captured Targets ({filteredTargets.length})
            </h3>
            <div className="flex items-center gap-1 ml-2">
              {['ALL', '2.4GHz', '5GHz', 'BLE', 'OPEN'].map(b => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBandFilter(b)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                    bandFilter === b
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {b}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2" />
              <input
                type="text"
                placeholder="Filter SSID, BSSID, Auth..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 outline-none w-52 focus:border-amber-500/50"
              />
            </div>
            <button
              type="button"
              onClick={() => setCapturedTargets([])}
              className="p-1.5 rounded-lg bg-slate-950 text-slate-400 hover:text-rose-400 border border-slate-800"
              title="Clear targets"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-lg">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-slate-400 uppercase text-[10px] sticky top-0">
              <tr>
                <th className="py-2 px-3">Signal</th>
                <th className="py-2 px-3">SSID / Name</th>
                <th className="py-2 px-3">BSSID / MAC</th>
                <th className="py-2 px-3">Band / CH</th>
                <th className="py-2 px-3">Auth</th>
                <th className="py-2 px-3">GPS Fix</th>
                <th className="py-2 px-3 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {filteredTargets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500">
                    No targets loaded. Connect the Piglet over USB and open a <code className="text-cyan-300">.csv</code> log in the SD Card File Explorer.
                  </td>
                </tr>
              ) : (
                filteredTargets.map((item, idx) => (
                  <tr key={`${item.bssid || idx}-${idx}`} className="hover:bg-slate-800/40 transition">
                    <td className="py-2 px-3 font-mono font-bold text-amber-400">
                      {item.rssi ? `${item.rssi} dBm` : '--'}
                    </td>
                    <td className="py-2 px-3 font-bold text-slate-200 truncate max-w-xs">
                      {item.ssid || '<Hidden SSID>'}
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-slate-400">
                      {item.bssid}
                    </td>
                    <td className="py-2 px-3">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">
                        {item.channel ? `CH ${item.channel}` : item.band || '2.4G'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        item.auth?.includes('OPEN')
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-300'
                      }`}>
                        {item.auth || 'WPA2'}
                      </span>
                    </td>
                    <td className="py-2 px-3 font-mono text-[11px] text-emerald-400">
                      {item.lat && item.lon ? `${Number(item.lat).toFixed(4)}, ${Number(item.lon).toFixed(4)}` : 'None'}
                    </td>
                    <td className="py-2 px-3 text-right text-slate-500 text-[11px]">
                      {item.time || item.firstSeen || '--'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
