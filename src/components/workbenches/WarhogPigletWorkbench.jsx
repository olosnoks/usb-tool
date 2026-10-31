import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Compass,
  Wifi,
  Radio,
  Usb,
  Upload,
  Download,
  Trash2,
  Cpu,
  HardDrive,
  Terminal,
  MapPin,
  ShieldCheck,
  Activity,
  Layers,
  Search,
  Check,
  Copy,
  Navigation,
  Zap,
  Sliders,
  FileText,
  Folder,
  FolderOpen,
  FileCode,
  Save,
  RefreshCw,
  Plus,
  ExternalLink,
  Flame,
  Globe,
  Battery,
  Play,
  Square,
  RotateCcw,
  Info,
  Code2,
  CheckCircle2,
  AlertTriangle,
  Cable
} from 'lucide-react';
import { parseNmeaSentence, parseWardriveLine, parseWigleCsvFile } from '../../utils/nmeaParser';

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

// ============================================================================
//  WarHog "WT" Protocol Helpers (Mirrors SerialTool.cpp & toolkit.js)
// ============================================================================
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const hex8 = (n) => (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function b64decode(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(2) + ' MB';
}

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

export default function WarhogPigletWorkbench() {
  const [activeTab, setActiveTab] = useState('sd'); // 'sd' | 'config' | 'web' | 'serial' | 'flasher' | 'pinouts'
  const [sdSourceMode, setSdSourceMode] = useState('usb'); // 'usb' | 'picker' | 'web'
  const [selectedFolder, setSelectedFolder] = useState('/logs'); // '/logs' | '/uploaded' | '/archived' | '/'
  const [selectedPresetKey, setSelectedPresetKey] = useState('freenove-s3-cyd');
  const [config, setConfig] = useState(DEFAULT_WARDRIVER_CFG);
  const [rawConfigText, setRawConfigText] = useState(() => serializeWardriverConfig(DEFAULT_WARDRIVER_CFG));
  const [cfgViewMode, setCfgViewMode] = useState('visual'); // 'visual' | 'code'

  // Physical SD Card / USB SD State
  const [sdFiles, setSdFiles] = useState([]);
  const [selectedSdFile, setSelectedSdFile] = useState(null);
  const [fileContent, setFileContent] = useState('');
  const [sdStatusMsg, setSdStatusMsg] = useState('');

  // WT Protocol Serial State
  const [wtPort, setWtPort] = useState(null);
  const [wtConnected, setWtConnected] = useState(false);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtDeviceInfo, setWtDeviceInfo] = useState('');
  const [wtTransferProgress, setWtTransferProgress] = useState('');

  // Browser File System Access API
  const [sdHandle, setSdHandle] = useState(null);
  const [sdMounted, setSdMounted] = useState(false);

  // Web UI / REST Bridge (HTTP to 192.168.4.1 or device IP)
  const [deviceIp, setDeviceIp] = useState('192.168.4.1');
  const [webConnected, setWebConnected] = useState(false);
  const [webConnecting, setWebConnecting] = useState(false);
  const [webTelemetry, setWebTelemetry] = useState(null);
  const [webFiles, setWebFiles] = useState([]);
  const [webActionStatus, setWebActionStatus] = useState('');

  // WebSerial UART Console
  const [serialBaud, setSerialBaud] = useState(115200);
  const [serialLogs, setSerialLogs] = useState([]);
  const [serialInput, setSerialInput] = useState('');

  // Targets Captured
  const [capturedTargets, setCapturedTargets] = useState([]);
  const [bandFilter, setBandFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const wtReaderRef = useRef(null);
  const wtWriterRef = useRef(null);
  const wtLineHandlerRef = useRef(null);
  const logContainerRef = useRef(null);

  // Apply Hardware Preset
  const handleApplyPreset = (presetKey) => {
    setSelectedPresetKey(presetKey);
    const preset = HARDWARE_PRESETS[presetKey];
    if (!preset) return;
    const updated = { ...config, ...preset.patch };
    setConfig(updated);
    setRawConfigText(serializeWardriverConfig(updated));
    setSdStatusMsg(`Applied preset: ${preset.label}`);
  };

  const handleConfigChange = (key, val) => {
    const updated = { ...config, [key]: val };
    setConfig(updated);
    setRawConfigText(serializeWardriverConfig(updated));
  };

  const handleRawTextChange = (text) => {
    setRawConfigText(text);
    const parsed = parseWardriverConfigText(text, config);
    setConfig(parsed);
  };

  // -------------------------------------------------------------
  //  OFFICIAL WARHOG "WT" SERIAL PROTOCOL IMPLEMENTATION
  // -------------------------------------------------------------
  const writeWtLine = async (line) => {
    if (!wtWriterRef.current) throw new Error('Not connected to WarHog via USB.');
    const encoder = new TextEncoder();
    await wtWriterRef.current.write(encoder.encode(line + '\n'));
  };

  const runWtOp = (sendFn, handlerFactory, timeoutMs = 15000) => {
    return new Promise((resolve, reject) => {
      let settled = false;
      const t = setTimeout(() => {
        if (!settled) {
          settled = true;
          wtLineHandlerRef.current = null;
          reject(new Error('Operation timed out'));
        }
      }, timeoutMs);

      const finish = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        wtLineHandlerRef.current = null;
        fn();
      };

      wtLineHandlerRef.current = handlerFactory(
        (val) => finish(() => resolve(val)),
        (err) => finish(() => reject(err instanceof Error ? err : new Error(String(err))))
      );

      Promise.resolve(sendFn()).catch((e) => finish(() => reject(e)));
    });
  };

  const wtHello = async () => {
    return runWtOp(
      () => writeWtLine('WT HELLO'),
      (done) => (line) => {
        if (line.startsWith('WT HELLO')) {
          done(line.slice(8).trim());
        }
      },
      6000
    );
  };

  const wtLs = async (dir) => {
    const files = [];
    const dirs = [];
    return runWtOp(
      () => writeWtLine('WT LS ' + dir),
      (done, fail) => (line) => {
        if (line.startsWith('WT F ')) {
          const m = line.match(/^WT F (\d+) (.+)$/);
          if (m) files.push({ size: +m[1], path: m[2] });
        } else if (line.startsWith('WT DIR ')) {
          dirs.push(line.slice(7).trim());
        } else if (line === 'WT END') {
          done({ files, dirs });
        } else if (line.startsWith('WT ERR')) {
          fail(line.slice(6).trim());
        }
      },
      25000
    );
  };

  const wtGet = async (path, onProgress) => {
    let size = 0;
    let received = 0;
    const chunks = [];
    return runWtOp(
      () => writeWtLine('WT GET ' + path),
      (done, fail) => (line) => {
        if (line.startsWith('WT BEGIN ')) {
          size = +line.slice(9).trim();
        } else if (line.startsWith('WT DATA ')) {
          const bytes = b64decode(line.slice(8));
          chunks.push(bytes);
          received += bytes.length;
          if (onProgress && size) onProgress(received, size);
        } else if (line.startsWith('WT END ')) {
          const expectedCrc = parseInt(line.slice(7).trim(), 16) >>> 0;
          const out = new Uint8Array(received);
          let offset = 0;
          for (const c of chunks) {
            out.set(c, offset);
            offset += c.length;
          }
          if ((crc32(out) >>> 0) !== expectedCrc) {
            fail(new Error('CRC32 checksum mismatch in transfer'));
            return;
          }
          done(out);
        } else if (line.startsWith('WT ERR')) {
          fail(line.slice(6).trim());
        }
      },
      120000
    );
  };

  const wtPutBytes = async (cmd, bytes, onProgress) => {
    const fileCrc = crc32(bytes);
    const CHUNK = 384;
    return runWtOp(
      () => writeWtLine(`${cmd} ${bytes.length} ${hex8(fileCrc)}`),
      (done, fail) => (line) => {
        if (line === 'WT READY') {
          (async () => {
            try {
              for (let i = 0; i < bytes.length; i += CHUNK) {
                const slice = bytes.subarray(i, i + CHUNK);
                await writeWtLine('WT DATA ' + b64encode(slice));
                if (onProgress) onProgress(Math.min(i + CHUNK, bytes.length), bytes.length);
              }
              if (bytes.length === 0) await writeWtLine('WT DATA ');
            } catch (e) {
              fail(e);
            }
          })();
        } else if (line.startsWith('WT OK')) {
          done(line.slice(5).trim());
        } else if (line.startsWith('WT ERR')) {
          fail(line.slice(6).trim());
        }
      },
      120000
    );
  };

  const wtPut = (path, bytes, p) => wtPutBytes('WT PUT ' + path, bytes, p);
  const wtCfgPut = (bytes, p) => wtPutBytes('WT CFG PUT', bytes, p);

  const wtRm = async (path) => {
    return runWtOp(
      () => writeWtLine('WT RM ' + path),
      (done, fail) => (line) => {
        if (line.startsWith('WT OK')) done();
        else if (line.startsWith('WT ERR')) fail(line.slice(6).trim());
      },
      15000
    );
  };

  const wtBye = async () => {
    try {
      await writeWtLine('WT BYE');
    } catch {
      // ignore
    }
  };

  // Connect over WebSerial and establish WT session
  const handleConnectUsbSerial = async () => {
    if (!navigator.serial) {
      alert('WebSerial is not supported in this browser. Please use Google Chrome, Microsoft Edge, or Brave.');
      return;
    }
    try {
      setSdStatusMsg('Connecting to WarHog via USB...');
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      setWtPort(port);

      const writer = port.writable.getWriter();
      const reader = port.readable.getReader();
      wtWriterRef.current = writer;
      wtReaderRef.current = reader;

      startWtReaderLoop(reader);

      setSdStatusMsg('Sending WT HELLO to WarHog...');
      const info = await wtHello();
      setWtDeviceInfo(info);
      setWtConnected(true);
      setSdStatusMsg(`Connected to WarHog! (${info})`);

      // Refresh directory list
      await refreshWtFiles(selectedFolder);
    } catch (err) {
      setSdStatusMsg(`USB connection failed: ${err.message}`);
      await handleDisconnectUsbSerial();
    }
  };

  const handleDisconnectUsbSerial = async () => {
    try {
      if (wtConnected) await wtBye();
    } catch {}
    setWtConnected(false);
    setWtDeviceInfo('');
    try {
      if (wtReaderRef.current) {
        await wtReaderRef.current.cancel();
        wtReaderRef.current = null;
      }
    } catch {}
    try {
      if (wtWriterRef.current) {
        wtWriterRef.current.releaseLock();
        wtWriterRef.current = null;
      }
    } catch {}
    try {
      if (wtPort) {
        await wtPort.close();
        setWtPort(null);
      }
    } catch {}
    setSdStatusMsg('Disconnected from WarHog USB.');
  };

  const startWtReaderLoop = async (reader) => {
    const decoder = new TextDecoder();
    let lineBuffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        lineBuffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = lineBuffer.indexOf('\n')) >= 0) {
          let line = lineBuffer.slice(0, nl).replace(/\r$/, '');
          lineBuffer = lineBuffer.slice(nl + 1);

          // Route WT protocol lines to active operation handler
          if (line.startsWith('WT ') || line === 'WT') {
            if (wtLineHandlerRef.current) {
              wtLineHandlerRef.current(line);
            }
          } else {
            // Debug output from firmware -> serial log
            setSerialLogs(prev => [...prev.slice(-300), line]);
          }
        }
      }
    } catch (err) {
      if (err.name !== 'NetworkError') {
        console.warn('WT reader loop terminated:', err);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {}
    }
  };

  const refreshWtFiles = async (folder = selectedFolder) => {
    if (!wtWriterRef.current) return;
    setWtBusy(true);
    setSdStatusMsg(`Listing ${folder} over USB...`);
    try {
      const { files } = await wtLs(folder);
      const mapped = files.map(f => {
        const name = f.path.split('/').pop() || f.path;
        return {
          name,
          path: f.path,
          size: f.size,
          source: 'usb',
          type: name.endsWith('.cfg') || name.endsWith('.conf') ? 'config' : name.endsWith('.csv') ? 'log' : 'file'
        };
      });
      mapped.sort((a, b) => a.path.localeCompare(b.path));
      setSdFiles(mapped);
      setSdStatusMsg(`Loaded ${mapped.length} files from ${folder} via WT protocol.`);

      // If in root, check if wardriver.cfg is present and load it
      if (folder === '/') {
        const cfgFile = mapped.find(f => f.name.toLowerCase() === 'wardriver.cfg');
        if (cfgFile) {
          handleSelectUsbFile(cfgFile);
        }
      }
    } catch (err) {
      setSdStatusMsg(`Failed to list ${folder}: ${err.message}`);
    } finally {
      setWtBusy(false);
    }
  };

  const handleSelectUsbFile = async (item) => {
    setSelectedSdFile(item);
    if (item.source === 'usb') {
      setWtBusy(true);
      setWtTransferProgress(`Downloading ${item.path}...`);
      try {
        const bytes = await wtGet(item.path, (recv, total) => {
          setWtTransferProgress(`Downloading ${item.path}: ${fmtSize(recv)} / ${fmtSize(total)}`);
        });
        const decoder = new TextDecoder();
        const text = decoder.decode(bytes);
        setFileContent(text);
        setWtTransferProgress('');
        setSdStatusMsg(`Downloaded ${item.path} (${fmtSize(bytes.length)}) with verified CRC32!`);

        if (item.name.endsWith('.cfg') || item.name.endsWith('.conf')) {
          setRawConfigText(text);
          setConfig(parseWardriverConfigText(text));
        } else if (item.name.endsWith('.csv')) {
          const parsed = parseWigleCsvFile(text);
          if (parsed.networks?.length > 0) {
            setCapturedTargets(prev => {
              const map = new Map(prev.map(n => [n.bssid, n]));
              parsed.networks.forEach(n => map.set(n.bssid, n));
              return Array.from(map.values());
            });
            setSdStatusMsg(`Parsed ${parsed.networks.length} targets from ${item.name}!`);
          }
        }
      } catch (err) {
        setSdStatusMsg(`Failed to download ${item.path}: ${err.message}`);
      } finally {
        setWtBusy(false);
        setWtTransferProgress('');
      }
    } else if (item.handle) {
      // Local File System Access API
      handleSelectSdFile(item);
    }
  };

  const handleDownloadFileToComputer = async (item) => {
    if (item.source === 'usb') {
      try {
        setWtBusy(true);
        setWtTransferProgress(`Downloading ${item.path} to PC...`);
        const bytes = await wtGet(item.path, (recv, total) => {
          setWtTransferProgress(`Downloading: ${fmtSize(recv)} / ${fmtSize(total)}`);
        });
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = item.name;
        a.click();
        URL.revokeObjectURL(a.href);
        setSdStatusMsg(`Saved ${item.name} (${fmtSize(bytes.length)}) to PC.`);
      } catch (err) {
        alert(`Download error: ${err.message}`);
      } finally {
        setWtBusy(false);
        setWtTransferProgress('');
      }
    }
  };

  const handleDeleteUsbFile = async (item) => {
    if (!confirm(`Delete ${item.path} from WarHog SD card? This cannot be undone.`)) return;
    if (item.source === 'usb') {
      try {
        setWtBusy(true);
        await wtRm(item.path);
        setSdStatusMsg(`Deleted ${item.path} from SD card.`);
        await refreshWtFiles(selectedFolder);
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      } finally {
        setWtBusy(false);
      }
    }
  };

  // Mount Physical MicroSD Card via Directory Picker (Card Reader / PC slot)
  const handleMountDirectory = async () => {
    try {
      if (!window.showDirectoryPicker) {
        alert('File System Access API is not supported in this browser. Please use Chrome, Edge, or Brave to mount physical SD cards directly.');
        return;
      }
      setSdStatusMsg('Requesting SD Card root directory...');
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      setSdHandle(dirHandle);
      setSdMounted(true);
      await scanSdDirectory(dirHandle);
      setSdStatusMsg(`Mounted directory: "${dirHandle.name}". Ready.`);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setSdStatusMsg(`SD mount failed: ${err.message}`);
      }
    }
  };

  const scanSdDirectory = async (dirHandle) => {
    const files = [];
    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const file = await entry.getFile();
          files.push({
            name: entry.name,
            path: `/${entry.name}`,
            size: file.size,
            handle: entry,
            source: 'picker',
            type: entry.name.endsWith('.cfg') ? 'config' : entry.name.endsWith('.csv') ? 'log' : 'file'
          });
        } else if (entry.kind === 'directory') {
          const subDirHandle = entry;
          for await (const subEntry of subDirHandle.values()) {
            if (subEntry.kind === 'file') {
              const file = await subEntry.getFile();
              files.push({
                name: subEntry.name,
                path: `/${entry.name}/${subEntry.name}`,
                size: file.size,
                handle: subEntry,
                source: 'picker',
                type: subEntry.name.endsWith('.csv') ? 'log' : subEntry.name.endsWith('.pcap') ? 'pcap' : 'file'
              });
            }
          }
        }
      }
      setSdFiles(files);

      const cfgEntry = files.find(f => f.name.toLowerCase() === 'wardriver.cfg');
      if (cfgEntry) {
        const file = await cfgEntry.handle.getFile();
        const text = await file.text();
        setFileContent(text);
        setSelectedSdFile(cfgEntry);
        setRawConfigText(text);
        setConfig(parseWardriverConfigText(text));
        setSdStatusMsg(`Found and loaded /wardriver.cfg from SD card.`);
      }
    } catch (err) {
      setSdStatusMsg(`Failed to list SD card files: ${err.message}`);
    }
  };

  const handleSelectSdFile = async (item) => {
    setSelectedSdFile(item);
    try {
      const file = await item.handle.getFile();
      const text = await file.text();
      setFileContent(text);

      if (item.name.endsWith('.cfg') || item.name.endsWith('.conf')) {
        setRawConfigText(text);
        setConfig(parseWardriverConfigText(text));
        setSdStatusMsg(`Loaded config file: ${item.path}`);
      } else if (item.name.endsWith('.csv')) {
        const parsed = parseWigleCsvFile(text);
        if (parsed.networks && parsed.networks.length > 0) {
          setCapturedTargets(prev => {
            const map = new Map(prev.map(n => [n.bssid, n]));
            parsed.networks.forEach(n => map.set(n.bssid, n));
            return Array.from(map.values());
          });
          setSdStatusMsg(`Loaded ${parsed.networks.length} Wi-Fi/BLE targets from ${item.name}`);
        }
      }
    } catch (err) {
      setSdStatusMsg(`Failed to read file ${item.name}: ${err.message}`);
    }
  };

  const handleSaveToSd = async () => {
    const textToSave = cfgViewMode === 'code' ? rawConfigText : serializeWardriverConfig(config);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(textToSave);

    if (wtConnected && wtWriterRef.current) {
      // Use official WT CFG PUT over USB serial cable
      setWtBusy(true);
      setWtTransferProgress('Uploading /wardriver.cfg to WarHog over USB...');
      try {
        await wtCfgPut(bytes, (sent, total) => {
          setWtTransferProgress(`Uploading config: ${fmtSize(sent)} / ${fmtSize(total)}`);
        });
        setSdStatusMsg('Successfully uploaded /wardriver.cfg! Firmware automatically reloaded configuration.');
      } catch (err) {
        alert(`Config upload failed: ${err.message}`);
      } finally {
        setWtBusy(false);
        setWtTransferProgress('');
      }
      return;
    }

    if (sdHandle) {
      try {
        const fileHandle = await sdHandle.getFileHandle('wardriver.cfg', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(textToSave);
        await writable.close();
        setSdStatusMsg('Successfully saved /wardriver.cfg directly to MicroSD root!');
        await scanSdDirectory(sdHandle);
      } catch (err) {
        setSdStatusMsg(`Failed to save to SD card: ${err.message}`);
      }
      return;
    }

    alert('Please connect to the Hog via USB (WT Protocol) or mount your MicroSD card root directory.');
  };

  const handleDownloadConfigFile = () => {
    const textToSave = cfgViewMode === 'code' ? rawConfigText : serializeWardriverConfig(config);
    const blob = new Blob([textToSave], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wardriver.cfg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSdStatusMsg('Downloaded wardriver.cfg to your computer.');
  };

  // HTTP Web REST Client
  const fetchWebStatus = async () => {
    try {
      setWebConnecting(true);
      const res = await fetch(`http://${deviceIp}/status.json`, { mode: 'cors' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setWebTelemetry(data);
      setWebConnected(true);
      if (data.config) {
        setConfig(prev => ({ ...prev, ...data.config }));
      }
      setWebActionStatus(`Connected to WarHog Web UI at ${deviceIp}`);
      fetchWebFiles();
    } catch (err) {
      setWebConnected(false);
      setWebActionStatus(`Cannot connect to http://${deviceIp}/status.json (${err.message}). Are you connected to "WarHog-WARDRIVE"?`);
    } finally {
      setWebConnecting(false);
    }
  };

  const fetchWebFiles = async () => {
    try {
      const res = await fetch(`http://${deviceIp}/files.json`, { mode: 'cors' });
      if (res.ok) {
        const data = await res.json();
        if (data.files) {
          setWebFiles(data.files);
          if (sdSourceMode === 'web') {
            setSdFiles(data.files.map(f => ({
              name: f.name.split('/').pop(),
              path: f.name,
              size: f.size,
              source: 'web',
              type: f.name.endsWith('.cfg') ? 'config' : f.name.endsWith('.csv') ? 'log' : 'file'
            })));
          }
        }
      }
    } catch (err) {
      console.warn('files.json fetch failed:', err);
    }
  };

  const triggerWebAction = async (endpoint, label) => {
    try {
      setWebActionStatus(`Sending ${label}...`);
      const res = await fetch(`http://${deviceIp}${endpoint}`, { method: 'POST', mode: 'cors' });
      if (res.ok) {
        setWebActionStatus(`${label} succeeded!`);
        fetchWebStatus();
      } else {
        setWebActionStatus(`${label} failed: HTTP ${res.status}`);
      }
    } catch (err) {
      setWebActionStatus(`${label} failed: ${err.message}`);
    }
  };

  const handlePushConfigOverWeb = async () => {
    try {
      setWebActionStatus('Pushing /wardriver.cfg to device over HTTP...');
      const params = new URLSearchParams();
      Object.entries(config).forEach(([k, v]) => {
        params.append(k, String(v));
      });
      const res = await fetch(`http://${deviceIp}/saveConfig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        mode: 'cors'
      });
      if (res.ok) {
        setWebActionStatus('Configuration saved to /wardriver.cfg on device SD!');
        fetchWebStatus();
      } else {
        setWebActionStatus(`Save failed: HTTP ${res.status}`);
      }
    } catch (err) {
      setWebActionStatus(`Save failed: ${err.message}`);
    }
  };

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
              Connect to your <strong className="text-amber-400">WarHog</strong> over USB to read the SD card directly using your firmware's native <code className="text-amber-300">SerialTool</code> WT protocol. View WiGLE logs, edit <code className="text-cyan-300">wardriver.cfg</code> in-place, and monitor live scans.
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
            <span>SD Card File Explorer (Over USB / Disk)</span>
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
            onClick={() => setActiveTab('web')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
              activeTab === 'web'
                ? 'bg-amber-500 text-slate-950 shadow-md'
                : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>Web UI Bridge ({webConnected ? 'Connected' : 'Offline'})</span>
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
            <span>Serial UART Console ({wtConnected ? 'Live' : 'Closed'})</span>
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

      {/* TAB 1: READ SD CARD OVER USB & EXPLORER */}
      {activeTab === 'sd' && (
        <div className="space-y-4">
          {/* Method Selection Bar */}
          <div className="bg-[#12151c] border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Connection Mode:
              </span>
              <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSdSourceMode('usb')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition ${
                    sdSourceMode === 'usb'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Cable className="w-3.5 h-3.5" />
                  <span>USB WT Protocol</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSdSourceMode('picker')}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition ${
                    sdSourceMode === 'picker'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <HardDrive className="w-3.5 h-3.5" />
                  <span>PC Card Reader / Slot</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSdSourceMode('web');
                    fetchWebStatus();
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded text-xs font-bold transition ${
                    sdSourceMode === 'web'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Over Wi-Fi (SoftAP)</span>
                </button>
              </div>
            </div>

            {/* Folder selection for WT protocol */}
            {sdSourceMode === 'usb' && wtConnected && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-400 font-semibold">Folder:</span>
                <select
                  value={selectedFolder}
                  onChange={(e) => {
                    const nextFolder = e.target.value;
                    setSelectedFolder(nextFolder);
                    refreshWtFiles(nextFolder);
                  }}
                  disabled={wtBusy}
                  className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-amber-300 outline-none"
                >
                  <option value="/logs">/logs (Wardriving CSVs &amp; PCAPs)</option>
                  <option value="/uploaded">/uploaded (Completed Uploads)</option>
                  <option value="/archived">/archived (Archived Logs)</option>
                  <option value="/">/ (Root &amp; wardriver.cfg)</option>
                </select>
              </div>
            )}

            {/* Mode-specific connect triggers */}
            <div className="flex items-center gap-2">
              {sdSourceMode === 'usb' && (
                wtConnected ? (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      <span>{wtDeviceInfo || 'WT Protocol Live'}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => refreshWtFiles(selectedFolder)}
                      disabled={wtBusy}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
                    >
                      <RefreshCw className={`w-3 h-3 ${wtBusy ? 'animate-spin' : ''}`} />
                      <span>Refresh</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDisconnectUsbSerial}
                      className="px-2.5 py-1 rounded bg-rose-600/80 hover:bg-rose-600 text-white text-xs font-bold transition"
                    >
                      Disconnect
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleConnectUsbSerial}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-md"
                  >
                    <Usb className="w-4 h-4" />
                    <span>Connect Hog over USB</span>
                  </button>
                )
              )}

              {sdSourceMode === 'picker' && (
                <button
                  type="button"
                  onClick={handleMountDirectory}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>{sdMounted ? 'Change Directory' : 'Mount SD Card Folder'}</span>
                </button>
              )}

              {sdSourceMode === 'web' && (
                <button
                  type="button"
                  onClick={fetchWebStatus}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Fetch Files from 192.168.4.1</span>
                </button>
              )}
            </div>
          </div>

          {/* Progress / Status banner */}
          {(wtTransferProgress || sdStatusMsg) && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-amber-300 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {wtBusy && <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-400" />}
                <span>{wtTransferProgress || sdStatusMsg}</span>
              </div>
            </div>
          )}

          {/* Main Layout: Left Browser, Right File Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* File Tree */}
            <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4 text-amber-400" />
                  <h3 className="font-bold text-slate-100 text-xs uppercase tracking-wider">
                    SD Card Files ({sdFiles.length})
                  </h3>
                </div>
              </div>

              <div className="space-y-1 max-h-96 overflow-y-auto border border-slate-800/80 rounded-lg p-2 bg-slate-950/60">
                {sdFiles.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 space-y-2">
                    {sdSourceMode === 'usb' ? (
                      wtConnected ? (
                        <p>No files found in {selectedFolder}.</p>
                      ) : (
                        <div>
                          <p>Plug your Hog in via USB and click <strong>"Connect Hog over USB"</strong> above to read the SD card directly.</p>
                          <p className="text-[11px] text-slate-600 mt-1">Talks to your firmware's <code>SerialTool.cpp</code> WT protocol.</p>
                        </div>
                      )
                    ) : (
                      <p>No SD files loaded. Use the connection bar above.</p>
                    )}
                  </div>
                ) : (
                  sdFiles.map(file => (
                    <div
                      key={file.path}
                      className={`flex items-center justify-between p-2 rounded text-xs font-mono transition ${
                        selectedSdFile?.path === file.path
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <div
                        onClick={() => handleSelectUsbFile(file)}
                        className="flex items-center gap-2 truncate cursor-pointer flex-1"
                      >
                        {file.type === 'config' ? (
                          <Sliders className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : file.type === 'log' ? (
                          <FileText className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        ) : (
                          <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                        <span className="truncate">{file.path}</span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-[10px] text-slate-500">
                          {fmtSize(file.size)}
                        </span>
                        {file.source === 'usb' && (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => handleDownloadFileToComputer(file)}
                              className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-amber-300"
                              title="Download to PC"
                            >
                              <Download className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteUsbFile(file)}
                              className="p-1 rounded bg-slate-800 hover:bg-rose-900/60 text-slate-400 hover:text-rose-400"
                              title="Delete from SD"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Upload file to SD over USB */}
              {wtConnected && (
                <div className="pt-2 flex flex-col gap-1.5 border-t border-slate-800">
                  <label className="text-[11px] text-slate-400 font-semibold">Upload file to Hog SD ({selectedFolder}):</label>
                  <input
                    type="file"
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      const path = (selectedFolder === '/' ? '' : selectedFolder) + '/' + f.name;
                      const bytes = new Uint8Array(await f.arrayBuffer());
                      try {
                        setWtBusy(true);
                        setWtTransferProgress(`Uploading ${path} over USB...`);
                        await wtPut(path, bytes, (sent, total) => {
                          setWtTransferProgress(`Uploading ${f.name}: ${fmtSize(sent)} / ${fmtSize(total)}`);
                        });
                        setSdStatusMsg(`Uploaded ${path} successfully!`);
                        await refreshWtFiles(selectedFolder);
                      } catch (err) {
                        alert(`Upload failed: ${err.message}`);
                      } finally {
                        setWtBusy(false);
                        setWtTransferProgress('');
                      }
                    }}
                    className="text-xs text-slate-400 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-bold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700 cursor-pointer"
                  />
                </div>
              )}
            </div>

            {/* Viewer / Editor */}
            <div className="lg:col-span-2 bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-cyan-400" />
                  <h3 className="font-bold text-slate-100 text-xs uppercase tracking-wider">
                    {selectedSdFile ? selectedSdFile.path : 'File Content'}
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  {selectedSdFile?.path?.endsWith('.cfg') && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('config')}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-amber-300 font-bold transition"
                    >
                      Open in Form Editor
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSaveToSd}
                    disabled={wtBusy}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Save to SD over USB</span>
                  </button>
                </div>
              </div>

              <textarea
                value={fileContent}
                onChange={(e) => {
                  setFileContent(e.target.value);
                  if (selectedSdFile?.path?.endsWith('.cfg')) {
                    setRawConfigText(e.target.value);
                    setConfig(parseWardriverConfigText(e.target.value));
                  }
                }}
                placeholder="Click on a file from the MicroSD browser on the left to read its contents over USB..."
                className="w-full h-96 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 outline-none resize-none focus:border-amber-500/50"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WARDRIVER.CFG EDITOR */}
      {activeTab === 'config' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-5">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 pb-4 border-b border-slate-800">
            <div className="space-y-1">
              <h2 className="font-bold text-slate-100 text-sm flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>WarHog /wardriver.cfg Configuration</span>
              </h2>
              <p className="text-xs text-slate-400">
                Official key=value configuration file placed at the root of your MicroSD card.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-slate-950 p-1 border border-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setCfgViewMode('visual')}
                  className={`px-3 py-1 rounded text-xs font-bold transition ${
                    cfgViewMode === 'visual' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Visual Form
                </button>
                <button
                  type="button"
                  onClick={() => setCfgViewMode('code')}
                  className={`px-3 py-1 rounded text-xs font-bold transition ${
                    cfgViewMode === 'code' ? 'bg-amber-500 text-slate-950' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Code View
                </button>
              </div>

              <button
                type="button"
                onClick={handleSaveToSd}
                disabled={wtBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs transition"
                title="Save configuration to Hog SD card via WT protocol"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save to Hog over USB</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadConfigFile}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download .cfg</span>
              </button>
            </div>
          </div>

          {/* Hardware Presets Strip */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              1-Click Hardware Target Presets:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {Object.entries(HARDWARE_PRESETS).map(([key, item]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleApplyPreset(key)}
                  className={`p-2.5 rounded-lg border text-left transition flex flex-col justify-between ${
                    selectedPresetKey === key
                      ? 'bg-amber-500/15 border-amber-500/60 text-slate-100'
                      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-xs">{item.label}</div>
                  <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">{item.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* View Mode: Visual Form */}
          {cfgViewMode === 'visual' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
              {/* Cloud & Upload APIs */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Cloud Upload APIs</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-0.5">WiGLE Encoded Token (wigleBasicToken)</label>
                    <input
                      type="text"
                      value={config.wigleBasicToken}
                      onChange={(e) => handleConfigChange('wigleBasicToken', e.target.value)}
                      placeholder="e.g. QUlEMTIzNDU..."
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">WDGoWars API Key (wdgwarsApiKey)</label>
                    <input
                      type="text"
                      value={config.wdgwarsApiKey}
                      onChange={(e) => handleConfigChange('wdgwarsApiKey', e.target.value)}
                      placeholder="From https://wdgwars.pl/profile"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Wardrift API Key (wardriftApiKey)</label>
                    <input
                      type="text"
                      value={config.wardriftApiKey}
                      onChange={(e) => handleConfigChange('wardriftApiKey', e.target.value)}
                      placeholder="wdk_..."
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Max Boot Uploads (-1 = All, 0 = Off)</label>
                    <input
                      type="number"
                      value={config.maxBootUploads}
                      onChange={(e) => handleConfigChange('maxBootUploads', parseInt(e.target.value) || 0)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>
              </div>

              {/* Wi-Fi & SoftAP */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Wifi className="w-3.5 h-3.5" />
                  <span>Wi-Fi &amp; Access Point</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-0.5">Home Wi-Fi SSID (homeSsid)</label>
                    <input
                      type="text"
                      value={config.homeSsid}
                      onChange={(e) => handleConfigChange('homeSsid', e.target.value)}
                      placeholder="MyHomeWifi"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Home Wi-Fi Password (homePsk)</label>
                    <input
                      type="password"
                      value={config.homePsk}
                      onChange={(e) => handleConfigChange('homePsk', e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Device SoftAP SSID (wardriverSsid)</label>
                    <input
                      type="text"
                      value={config.wardriverSsid}
                      onChange={(e) => handleConfigChange('wardriverSsid', e.target.value)}
                      placeholder="WarHog-WARDRIVE"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Device SoftAP Password (wardriverPsk)</label>
                    <input
                      type="text"
                      value={config.wardriverPsk}
                      onChange={(e) => handleConfigChange('wardriverPsk', e.target.value)}
                      placeholder="wardrive1234"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div className="pt-1 flex items-center justify-between">
                    <label className="text-slate-400">Upload on Home Network Seen</label>
                    <input
                      type="checkbox"
                      checked={config.uploadOnNetworkSeen}
                      onChange={(e) => handleConfigChange('uploadOnNetworkSeen', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-slate-400">Auto-Start After Boot Upload</label>
                    <input
                      type="checkbox"
                      checked={config.autoStartAfterUpload}
                      onChange={(e) => handleConfigChange('autoStartAfterUpload', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Radio & Scanning */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-pink-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Radio className="w-3.5 h-3.5" />
                  <span>Radio &amp; GPS</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-0.5">GPS Baud Rate (gpsBaud)</label>
                    <select
                      value={config.gpsBaud}
                      onChange={(e) => handleConfigChange('gpsBaud', parseInt(e.target.value))}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    >
                      <option value="9600">9600 (Standard ATGM336H / NEO-6M)</option>
                      <option value="38400">38400</option>
                      <option value="115200">115200 (High-Speed GNSS)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Scan Mode (scanMode)</label>
                    <select
                      value={config.scanMode}
                      onChange={(e) => handleConfigChange('scanMode', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    >
                      <option value="aggressive">Aggressive (100ms dwell, 1.5s gap)</option>
                      <option value="powersaving">Power Saving (200ms dwell, 10s gap)</option>
                    </select>
                  </div>
                  <div className="pt-1 flex items-center justify-between">
                    <label className="text-slate-400">Scan 2.4 GHz Band (scan24)</label>
                    <input
                      type="checkbox"
                      checked={config.scan24}
                      onChange={(e) => handleConfigChange('scan24', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-slate-400">Scan 5 GHz Band (scan5 - C5 only)</label>
                    <input
                      type="checkbox"
                      checked={config.scan5}
                      onChange={(e) => handleConfigChange('scan5', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-slate-400">BLE Sniffer &amp; Wardrive (bluetoothScan)</label>
                    <input
                      type="checkbox"
                      checked={config.bluetoothScan}
                      onChange={(e) => handleConfigChange('bluetoothScan', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Mesh & Companion App Bridge */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5" />
                  <span>Mesh &amp; Companion App</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-0.5">Mesh Mode on Boot (meshModeOnBoot)</label>
                    <select
                      value={config.meshModeOnBoot}
                      onChange={(e) => handleConfigChange('meshModeOnBoot', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    >
                      <option value="none">None (Solo Wardriving)</option>
                      <option value="core">Core (ESP-NOW Coordinator)</option>
                      <option value="node">Node (Worker Node)</option>
                      <option value="off">Off (Radio Idle)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">BLE Companion App (blePersonality)</label>
                    <select
                      value={config.blePersonality}
                      onChange={(e) => handleConfigChange('blePersonality', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    >
                      <option value="wardrivego">Wardrive Go / WarBLE Go (RocketGod)</option>
                      <option value="biscuit">Biscuit Manager (Hedge / Biscuit Shop)</option>
                    </select>
                  </div>
                  <div className="pt-1 flex items-center justify-between">
                    <label className="text-slate-400">Enable BLE Bridge in Solo Mode</label>
                    <input
                      type="checkbox"
                      checked={config.blePhoneSolo}
                      onChange={(e) => handleConfigChange('blePhoneSolo', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-slate-400">Biscuit Report over ESP-NOW</label>
                    <input
                      type="checkbox"
                      checked={config.biscuitReport}
                      onChange={(e) => handleConfigChange('biscuitReport', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Hardware, Theme & UI */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>Hardware &amp; Theme</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-0.5">Board Architecture (board)</label>
                    <select
                      value={config.board}
                      onChange={(e) => handleConfigChange('board', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    >
                      <option value="auto">auto (Detect by Chip)</option>
                      <option value="s3">s3 (ESP32-S3 / CYD)</option>
                      <option value="c5">c5 (XIAO ESP32-C5 Dual-Band)</option>
                      <option value="c6">c6 (XIAO ESP32-C6 / Waveshare)</option>
                      <option value="c3">c3 (ESP32-C3 Node)</option>
                      <option value="exp">exp (S3 + Expansion Base)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">UI Color Theme (theme)</label>
                    <select
                      value={config.theme}
                      onChange={(e) => handleConfigChange('theme', e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    >
                      <option value="dracula">Dracula (Default)</option>
                      <option value="midnight">Midnight</option>
                      <option value="nord">Nord</option>
                      <option value="gruvbox">Gruvbox</option>
                      <option value="catppuccin">Catppuccin</option>
                      <option value="tokyonight">Tokyo Night</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-slate-400">Speed Units</label>
                    <select
                      value={config.speedUnits}
                      onChange={(e) => handleConfigChange('speedUnits', e.target.value)}
                      className="bg-slate-900 border border-slate-800 rounded px-2 py-0.5 text-slate-200 text-xs"
                    >
                      <option value="mph">MPH</option>
                      <option value="kmh">KM/H</option>
                    </select>
                  </div>
                  <div className="flex items-center justify-between">
                    <label className="text-slate-400">Rotate Screen 180°</label>
                    <input
                      type="checkbox"
                      checked={config.rotateScreen180}
                      onChange={(e) => handleConfigChange('rotateScreen180', e.target.checked)}
                      className="accent-amber-500"
                    />
                  </div>
                </div>
              </div>

              {/* Identification & Whitelist */}
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                <div className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Device Name &amp; Whitelist</span>
                </div>
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-slate-400 block mb-0.5">Custom Device Name (deviceName)</label>
                    <input
                      type="text"
                      value={config.deviceName}
                      onChange={(e) => handleConfigChange('deviceName', e.target.value)}
                      placeholder="e.g. rover1"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">Marauder Beacon SSID (beaconSsid)</label>
                    <input
                      type="text"
                      value={config.beaconSsid}
                      onChange={(e) => handleConfigChange('beaconSsid', e.target.value)}
                      placeholder="Custom SSID for beacon spam"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">SSID Whitelist 1 (never logged)</label>
                    <input
                      type="text"
                      value={config.ssidWhitelist1}
                      onChange={(e) => handleConfigChange('ssidWhitelist1', e.target.value)}
                      placeholder="e.g. HomeNet"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block mb-0.5">SSID Whitelist 2</label>
                    <input
                      type="text"
                      value={config.ssidWhitelist2}
                      onChange={(e) => handleConfigChange('ssidWhitelist2', e.target.value)}
                      placeholder="e.g. WorkGuest"
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500/50"
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* View Mode: Code View */
            <div className="space-y-2">
              <textarea
                value={rawConfigText}
                onChange={(e) => handleRawTextChange(e.target.value)}
                className="w-full h-96 bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 outline-none resize-none focus:border-amber-500/50"
              />
            </div>
          )}
        </div>
      )}

      {/* TAB 3: WEB UI REST BRIDGE */}
      {activeTab === 'web' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-cyan-400" />
                <h2 className="font-bold text-slate-100 text-sm">WarHog Web UI REST Bridge</h2>
              </div>
              <p className="text-xs text-slate-400">
                Connect your PC's Wi-Fi to the WarHog SoftAP (<code className="text-amber-300">WarHog-WARDRIVE</code> @ 192.168.4.1) or home Wi-Fi IP to pull live telemetry, download SD logs, and control scanning.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={deviceIp}
                onChange={(e) => setDeviceIp(e.target.value)}
                placeholder="192.168.4.1"
                className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 outline-none w-32"
              />
              <button
                type="button"
                onClick={fetchWebStatus}
                disabled={webConnecting}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
              >
                <RefreshCw className={`w-3 h-3 ${webConnecting ? 'animate-spin' : ''}`} />
                <span>{webConnected ? 'Refresh' : 'Connect'}</span>
              </button>
            </div>
          </div>

          {webActionStatus && (
            <div className="p-2.5 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-amber-300">
              {webActionStatus}
            </div>
          )}

          {/* Telemetry Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Scanning Status</div>
              <div className={`text-sm font-bold ${webTelemetry?.allowScan ? 'text-emerald-400' : 'text-slate-400'}`}>
                {webTelemetry ? (webTelemetry.allowScan ? 'ACTIVE' : 'IDLE / PAUSED') : '--'}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">GPS Fix</div>
              <div className={`text-sm font-bold ${webTelemetry?.gpsFix ? 'text-emerald-400' : 'text-rose-400'}`}>
                {webTelemetry ? (webTelemetry.gpsFix ? '3D FIX' : 'SEARCHING') : '--'}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Found 2.4 GHz</div>
              <div className="text-sm font-bold text-amber-400">
                {webTelemetry?.found2g ?? '--'}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Found 5 GHz</div>
              <div className="text-sm font-bold text-pink-400">
                {webTelemetry?.found5g ?? '--'}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Found BLE</div>
              <div className="text-sm font-bold text-indigo-400">
                {webTelemetry?.foundBle ?? '--'}
              </div>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1">
              <div className="text-[10px] uppercase font-bold text-slate-500">Battery</div>
              <div className="text-sm font-bold text-emerald-400">
                {webTelemetry?.batteryPresent
                  ? `${webTelemetry.batteryVolts?.toFixed(2)}V (${webTelemetry.batteryPercent}%)`
                  : 'USB Powered'}
              </div>
            </div>
          </div>

          {/* Device Controls */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => triggerWebAction('/start', 'Start Wardriving')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Start Scan</span>
            </button>
            <button
              type="button"
              onClick={() => triggerWebAction('/stop', 'Stop Wardriving')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition"
            >
              <Square className="w-3.5 h-3.5" />
              <span>Stop Scan</span>
            </button>
            <button
              type="button"
              onClick={() => triggerWebAction('/uploadViaHome', 'Trigger Home Upload')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Trigger Home Upload</span>
            </button>
            <button
              type="button"
              onClick={handlePushConfigOverWeb}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Push /wardriver.cfg to Device</span>
            </button>
            <button
              type="button"
              onClick={() => triggerWebAction('/reboot', 'Reboot Device')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reboot</span>
            </button>
          </div>
        </div>
      )}

      {/* TAB 4: WEBSERIAL UART CONSOLE */}
      {activeTab === 'serial' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <h2 className="font-bold text-slate-100 text-sm">WebSerial UART Console</h2>
                {wtDeviceInfo && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    {wtDeviceInfo}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Direct hardware console at 115200 baud. Monitor live scans, debug messages, and send WT protocol commands.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={serialBaud}
                onChange={(e) => setSerialBaud(Number(e.target.value))}
                disabled={wtConnected}
                className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 outline-none"
              >
                <option value="115200">115200 (WarHog Standard)</option>
                <option value="9600">9600</option>
              </select>

              {wtConnected ? (
                <button
                  type="button"
                  onClick={handleDisconnectUsbSerial}
                  className="px-3 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConnectUsbSerial}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                >
                  <Usb className="w-3 h-3" />
                  <span>Connect Serial</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Hardware Keys */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Quick WT Commands:</span>
            <button
              type="button"
              onClick={() => wtHello().then(i => setSdStatusMsg(`WT HELLO: ${i}`)).catch(e => setSdStatusMsg(`Err: ${e.message}`))}
              disabled={!wtConnected || wtBusy}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-mono font-bold text-amber-300 border border-slate-700 transition"
            >
              WT HELLO
            </button>
            <button
              type="button"
              onClick={() => refreshWtFiles('/logs')}
              disabled={!wtConnected || wtBusy}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-mono font-bold text-cyan-300 border border-slate-700 transition"
            >
              WT LS /logs
            </button>
            <button
              type="button"
              onClick={() => refreshWtFiles('/')}
              disabled={!wtConnected || wtBusy}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-mono font-bold text-pink-300 border border-slate-700 transition"
            >
              WT LS / (Root)
            </button>
            <button
              type="button"
              onClick={() => wtBye().then(() => setSdStatusMsg('WT BYE: scanning resumed')).catch(e => setSdStatusMsg(`Err: ${e.message}`))}
              disabled={!wtConnected}
              className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-xs font-mono font-bold text-emerald-300 border border-slate-700 transition"
            >
              WT BYE (Resume Scanning)
            </button>
            <button
              type="button"
              onClick={() => setSerialLogs([])}
              className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-xs text-slate-400 hover:text-slate-200 border border-slate-800 ml-auto"
            >
              Clear Logs
            </button>
          </div>

          {/* Log Window */}
          <div
            ref={logContainerRef}
            className="w-full h-80 bg-slate-950 border border-slate-800 rounded-lg p-3 overflow-y-auto font-mono text-[11px] leading-relaxed text-slate-300 space-y-0.5"
          >
            {serialLogs.length === 0 ? (
              <div className="py-12 text-center text-slate-600">
                UART log stream empty. Connect via WebSerial to monitor live scans and debug lines.
              </div>
            ) : (
              serialLogs.map((l, i) => (
                <div key={i} className="break-all whitespace-pre-wrap">
                  {l}
                </div>
              ))
            )}
          </div>

          {/* Command Input */}
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (serialInput.trim() && wtWriterRef.current) {
                try {
                  await writeWtLine(serialInput.trim());
                  setSerialLogs(prev => [...prev, `> ${serialInput.trim()}`]);
                  setSerialInput('');
                } catch (err) {
                  setSerialLogs(prev => [...prev, `[ERROR] ${err.message}`]);
                }
              }
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              placeholder="Send line to WarHog (e.g. WT HELLO, WT LS /logs)..."
              disabled={!wtConnected}
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-amber-500/50 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!wtConnected || !serialInput.trim()}
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
          <div className="space-y-1 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <h2 className="font-bold text-slate-100 text-sm">WarHog Browser Web Flasher</h2>
            </div>
            <p className="text-xs text-slate-400">
              Zero-install browser flashing for ESP32 boards directly from GitHub Releases using ESP Web Tools and WebSerial.
            </p>
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
                  <a
                    href="https://github.com/olosnoks/warhog/releases/latest"
                    target="_blank"
                    rel="noreferrer"
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs transition"
                  >
                    <Download className="w-3 h-3" />
                    <span>Download Firmware Binary</span>
                  </a>
                  {p.manifest && (
                    <div className="text-[10px] text-slate-500 text-center font-mono">
                      Manifest: {p.manifest}
                    </div>
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
                    No targets loaded. Connect your Hog over USB, select a <code className="text-cyan-300">.csv</code> log file, or mount your SD card.
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
