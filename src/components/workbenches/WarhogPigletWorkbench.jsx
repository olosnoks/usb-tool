import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Compass,
  Wifi,
  Radio,
  Usb,
  Upload,
  Download,
  Trash2,
  Play,
  Square,
  Sparkles,
  Cpu,
  HardDrive,
  Terminal,
  MapPin,
  ShieldAlert,
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
  Edit3,
  Eye
} from 'lucide-react';
import { parseNmeaSentence, parseWardriveLine, parseWigleCsvFile } from '../../utils/nmeaParser';

const PORKCHOP_MODES = [
  {
    id: 'warhog',
    name: 'SGT WARHOG',
    badge: 'GPS WARDRIVE',
    desc: 'Automated 2.4/5GHz + BLE channel sweep with NMEA GPS correlation & WiGLE v1.6 SD logging',
    cmd: 'mode warhog'
  },
  {
    id: 'oink',
    name: 'OINK RECON',
    badge: 'PASSIVE SNIFFER',
    desc: 'Passive 802.11 management frame monitor, hidden SSID decloaker & EAPOL/PMKID detector',
    cmd: 'mode oink'
  },
  {
    id: 'truffle',
    name: 'TRUFFLE HUNTER',
    badge: 'BLE & TRACKERS',
    desc: 'Bluetooth Low Energy advertisement hunter (AirTag, Flipper, Axon, Smart Glasses, Skimmers)',
    cmd: 'mode truffle'
  },
  {
    id: 'bacon',
    name: 'BACON SPECTRUM',
    badge: 'CHANNEL LOAD',
    desc: 'Real-time RSSI waterfall and per-channel congestion monitor across 2.4GHz & 5GHz bands',
    cmd: 'mode bacon'
  }
];

const SIMULATED_RIG_NETWORKS = [
  { bssid: 'A0:B7:65:12:9F:01', ssid: 'WARHOG-CYD-Uplink', rssi: -48, channel: 6, frequency: 2437, auth: 'WPA2-PSK', deviceType: 'WIFI', sourceDevice: 'warhog-cyd' },
  { bssid: '30:3A:10:C5:55:01', ssid: 'Piglet-C5-5GHz-Mesh', rssi: -51, channel: 36, frequency: 5180, auth: 'WPA3-SAE', deviceType: 'WIFI', sourceDevice: 'piglet' },
  { bssid: 'C8:C9:A3:44:08:7B', ssid: 'CoffeeShop_Free_WiFi', rssi: -63, channel: 11, frequency: 2462, auth: 'OPEN', deviceType: 'WIFI', sourceDevice: 'warhog-cyd' },
  { bssid: 'E4:5F:01:88:31:D2', ssid: 'Flipper-Zero-BLE', rssi: -56, channel: 37, frequency: 2402, auth: 'BLE-ADV', deviceType: 'BLE', sourceDevice: 'warhog-cyd' },
  { bssid: '30:3A:10:C5:88:19', ssid: 'ATGM336H-Backhaul-5G', rssi: -58, channel: 149, frequency: 5745, auth: 'WPA2-PSK', deviceType: 'WIFI', sourceDevice: 'piglet' },
  { bssid: '70:4D:7B:91:CC:14', ssid: 'WPA-SEC-Handshake-AP', rssi: -53, channel: 1, frequency: 2412, auth: 'WPA2-PSK [PMKID]', deviceType: 'WIFI', sourceDevice: 'warhog-cyd' },
  { bssid: '8C:AA:B5:77:12:E0', ssid: 'Municipal-Hotspot-5G', rssi: -67, channel: 44, frequency: 5220, auth: 'OPEN', deviceType: 'WIFI', sourceDevice: 'piglet' }
];

const DEFAULT_WARDRIVER_CONFIG = {
  device_name: 'Piglet-C5-Unit01',
  callsign: 'SGT_WARHOG',
  hardware_preset: 'piglet-c5',
  default_mode: 'warhog',
  // Radio & Channels
  enable_24ghz: true,
  enable_5ghz: true,
  enable_ble_sweep: true,
  hop_interval_ms: 350,
  min_rssi_dbm: -90,
  dedup_bloom_filter: true,
  // GPS & UART
  gps_rx_pin: 17,
  gps_tx_pin: 16,
  gps_baud: 9600,
  require_gps_fix: true,
  hdop_max_filter: 5.0,
  timezone_offset: -5,
  // SD Card & File Rotation
  sd_cs_pin: 2,
  sd_sck_pin: 8,
  sd_miso_pin: 9,
  sd_mosi_pin: 10,
  log_dir: '/wardriving',
  rotate_file_kb: 400,
  // Cloud Sync & Keys
  sync_wifi_ssid: '',
  sync_wifi_pass: '',
  wigle_api_name: '',
  wigle_api_token: '',
  wpasec_key: '',
  auto_upload_on_home_wifi: false,
  // UI & Peripherals
  display_type: 'SSD1306_128X64',
  tft_rotation: 1,
  led_blink_on_ap: true,
  sound_buzzer: false
};

const HARDWARE_CONFIG_PRESETS = {
  'piglet-c5': {
    label: '🐷 Piglet (Seeed XIAO ESP32-C5 Dual-Band + ATGM336H)',
    patch: {
      device_name: 'Piglet-C5-Unit01',
      hardware_preset: 'piglet-c5',
      enable_24ghz: true,
      enable_5ghz: true,
      enable_ble_sweep: true,
      gps_rx_pin: 17,
      gps_tx_pin: 16,
      gps_baud: 9600,
      sd_cs_pin: 2,
      sd_sck_pin: 8,
      sd_miso_pin: 9,
      sd_mosi_pin: 10,
      log_dir: '/wardriving',
      display_type: 'SSD1306_128X64'
    }
  },
  'piglet-s3': {
    label: '🐷 Piglet (Seeed XIAO ESP32-S3 + ATGM336H)',
    patch: {
      device_name: 'Piglet-S3-Unit01',
      hardware_preset: 'piglet-s3',
      enable_24ghz: true,
      enable_5ghz: false,
      enable_ble_sweep: true,
      gps_rx_pin: 44,
      gps_tx_pin: 43,
      gps_baud: 9600,
      sd_cs_pin: 2,
      sd_sck_pin: 7,
      sd_miso_pin: 8,
      sd_mosi_pin: 9,
      log_dir: '/wardriving',
      display_type: 'SSD1306_128X64'
    }
  },
  'warhog-cyd': {
    label: '🐗 Warhog CYD (ESP32-2432S028R Porkchop Port)',
    patch: {
      device_name: 'Warhog-CYD-2432S028R',
      hardware_preset: 'warhog-cyd',
      enable_24ghz: true,
      enable_5ghz: false,
      enable_ble_sweep: true,
      gps_rx_pin: 27,
      gps_tx_pin: 22,
      gps_baud: 9600,
      sd_cs_pin: 5,
      sd_sck_pin: 18,
      sd_miso_pin: 19,
      sd_mosi_pin: 23,
      log_dir: '/m5porkchop/wardriving',
      display_type: 'ILI9341_320X240'
    }
  },
  'cardputer-adv': {
    label: '🐗 M5Porkchop (M5Stack Cardputer + LoRa/GPS Hat)',
    patch: {
      device_name: 'Porkchop-Cardputer',
      hardware_preset: 'cardputer-adv',
      enable_24ghz: true,
      enable_5ghz: false,
      enable_ble_sweep: true,
      gps_rx_pin: 15,
      gps_tx_pin: 13,
      gps_baud: 115200,
      sd_cs_pin: 12,
      sd_sck_pin: 40,
      sd_miso_pin: 39,
      sd_mosi_pin: 14,
      log_dir: '/m5porkchop/wardriving',
      display_type: 'ST7789_240X135'
    }
  }
};

export function serializeWardriverConfig(cfg, format = 'ini') {
  if (format === 'json') {
    return JSON.stringify(cfg, null, 2);
  }
  return [
    '# ==========================================================',
    '# Piglet & Warhog CYD — wardriver.config',
    '# Place in SD root (/wardriver.config) or /m5porkchop/config/',
    '# ==========================================================',
    '',
    '[device]',
    `device_name = "${cfg.device_name}"`,
    `callsign = "${cfg.callsign}"`,
    `hardware_preset = "${cfg.hardware_preset}"`,
    `default_mode = "${cfg.default_mode}"`,
    '',
    '[radio]',
    `enable_24ghz = ${cfg.enable_24ghz}`,
    `enable_5ghz = ${cfg.enable_5ghz}`,
    `enable_ble_sweep = ${cfg.enable_ble_sweep}`,
    `hop_interval_ms = ${cfg.hop_interval_ms}`,
    `min_rssi_dbm = ${cfg.min_rssi_dbm}`,
    `dedup_bloom_filter = ${cfg.dedup_bloom_filter}`,
    '',
    '[gps]',
    `gps_rx_pin = ${cfg.gps_rx_pin}`,
    `gps_tx_pin = ${cfg.gps_tx_pin}`,
    `gps_baud = ${cfg.gps_baud}`,
    `require_gps_fix = ${cfg.require_gps_fix}`,
    `hdop_max_filter = ${cfg.hdop_max_filter}`,
    `timezone_offset = ${cfg.timezone_offset}`,
    '',
    '[sdcard]',
    `sd_cs_pin = ${cfg.sd_cs_pin}`,
    `sd_sck_pin = ${cfg.sd_sck_pin}`,
    `sd_miso_pin = ${cfg.sd_miso_pin}`,
    `sd_mosi_pin = ${cfg.sd_mosi_pin}`,
    `log_dir = "${cfg.log_dir}"`,
    `rotate_file_kb = ${cfg.rotate_file_kb}`,
    '',
    '[cloud]',
    `sync_wifi_ssid = "${cfg.sync_wifi_ssid}"`,
    `sync_wifi_pass = "${cfg.sync_wifi_pass}"`,
    `wigle_api_name = "${cfg.wigle_api_name}"`,
    `wigle_api_token = "${cfg.wigle_api_token}"`,
    `wpasec_key = "${cfg.wpasec_key}"`,
    `auto_upload_on_home_wifi = ${cfg.auto_upload_on_home_wifi}`,
    '',
    '[display]',
    `display_type = "${cfg.display_type}"`,
    `tft_rotation = ${cfg.tft_rotation}`,
    `led_blink_on_ap = ${cfg.led_blink_on_ap}`,
    `sound_buzzer = ${cfg.sound_buzzer}`
  ].join('\n');
}

export function parseWardriverConfigText(rawText, fallback = DEFAULT_WARDRIVER_CONFIG) {
  if (!rawText || typeof rawText !== 'string') return { ...fallback };
  const trimmed = rawText.trim();
  if (trimmed.startsWith('{')) {
    try {
      return { ...fallback, ...JSON.parse(trimmed) };
    } catch {
      return { ...fallback };
    }
  }
  const next = { ...fallback };
  const lines = trimmed.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
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

const INITIAL_SD_FILES = [
  {
    path: '/wardriver.config',
    name: 'wardriver.config',
    folder: '/',
    sizeBytes: 912,
    modified: '2026-10-30 19:20',
    type: 'config',
    content: serializeWardriverConfig(DEFAULT_WARDRIVER_CONFIG, 'ini')
  },
  {
    path: '/m5porkchop/config/porkchop.conf',
    name: 'porkchop.conf',
    folder: '/m5porkchop/config',
    sizeBytes: 845,
    modified: '2026-10-30 19:15',
    type: 'config',
    content: serializeWardriverConfig(
      { ...DEFAULT_WARDRIVER_CONFIG, ...HARDWARE_CONFIG_PRESETS['warhog-cyd'].patch },
      'json'
    )
  },
  {
    path: '/wardriving/piglet_c5_20261030_001.wigle.csv',
    name: 'piglet_c5_20261030_001.wigle.csv',
    folder: '/wardriving',
    sizeBytes: 1840,
    modified: '2026-10-30 18:45',
    type: 'wigle',
    content: [
      'WigleWifi-1.6,appRelease=1.2,model=ESP32-C5,release=1.0,device=Piglet-ESP32C5,display=SSD1306,board=XIAO_C5,brand=Hamspiced',
      'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type',
      '30:3A:10:C5:55:01,"Piglet-C5-5GHz-Mesh",[WPA3-SAE-CCMP][ESS],2026-10-30 18:41:10,36,5180,-51,37.775120,-122.419210,18.4,3.5,,,WIFI',
      '30:3A:10:C5:88:19,"ATGM336H-Backhaul-5G",[WPA2-PSK-CCMP][ESS],2026-10-30 18:42:15,149,5745,-58,37.775340,-122.418990,19.1,3.2,,,WIFI',
      '8C:AA:B5:77:12:E0,"Municipal-Hotspot-5G",[ESS],2026-10-30 18:43:02,44,5220,-67,37.775610,-122.418710,17.8,4.0,,,WIFI'
    ].join('\n')
  },
  {
    path: '/m5porkchop/wardriving/warhog_cyd_001.wigle.csv',
    name: 'warhog_cyd_001.wigle.csv',
    folder: '/m5porkchop/wardriving',
    sizeBytes: 1620,
    modified: '2026-10-30 18:10',
    type: 'wigle',
    content: [
      'WigleWifi-1.6,appRelease=0.1.8,model=ESP32-2432S028R,release=1.0,device=Porkchop-Warhog-CYD,display=ILI9341,board=CYD,brand=0ct0sec',
      'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type',
      'A0:B7:65:12:9F:01,"WARHOG-CYD-Uplink",[WPA2-PSK-CCMP][ESS],2026-10-30 18:05:11,6,2437,-48,37.774929,-122.419416,16.4,3.8,,,WIFI',
      'C8:C9:A3:44:08:7B,"CoffeeShop_Free_WiFi",[ESS],2026-10-30 18:06:44,11,2462,-63,37.775012,-122.419301,16.8,4.1,,,WIFI',
      'E4:5F:01:88:31:D2,"Flipper-Zero-BLE",[BLE-ADV],2026-10-30 18:07:22,37,2402,-56,37.775088,-122.419180,17.0,3.9,,,BLE'
    ].join('\n')
  },
  {
    path: '/m5porkchop/handshakes/Corp_WPA2_PMKID.22000',
    name: 'Corp_WPA2_PMKID.22000',
    folder: '/m5porkchop/handshakes',
    sizeBytes: 342,
    modified: '2026-10-30 17:55',
    type: 'handshake',
    content: 'WPA*01*4d4fe7aac3a2cecab195321099a7d05b*704d7b91cc14*a0b765129f01*5750412d5345432d48616e647368616b652d4150***'
  },
  {
    path: '/logs/piglet_boot.log',
    name: 'piglet_boot.log',
    folder: '/logs',
    sizeBytes: 518,
    modified: '2026-10-30 17:30',
    type: 'log',
    content: [
      '[00.012] Piglet Dual-Band Wardriver v1.2 (Seeed XIAO ESP32-C5)',
      '[00.045] Mounting FAT32 MicroSD on CS=GPIO2... OK (31,840 MB free)',
      '[00.088] Loaded /wardriver.config (callsign=SGT_WARHOG, hop=350ms, 5GHz=ENABLED)',
      '[00.140] UART1 ATGM336H GPS initialized on RX=GPIO17 TX=GPIO16 @ 9600 baud',
      '[02.410] GPS 3D Fix acquired (10 satellites, HDOP 1.1)',
      '[02.415] Starting WiGLE v1.6 logger -> /wardriving/piglet_c5_20261030_001.wigle.csv'
    ].join('\n')
  }
];

const CYD_PINOUT_ROWS = [
  { connector: 'CN1 / P3 (4-Pin JST)', signal: 'GPS TX -> CYD RX', pin: 'GPIO 27 (or GPIO 35)', notes: 'Connect ATGM336H / NEO-6M TX to IO27 (9600/115200 NMEA)' },
  { connector: 'CN1 / P3 (4-Pin JST)', signal: 'GPS RX <- CYD TX', pin: 'GPIO 22 (optional)', notes: 'Optional UBX config TX line to GPS module RX' },
  { connector: 'CN1 / P3 (4-Pin JST)', signal: 'VCC / GND', pin: '3.3V / GND', notes: 'Powers ATGM336H / BN-220 GPS module directly' },
  { connector: 'MicroSD Slot (TF)', signal: 'SD_CS / MOSI / MISO / SCK', pin: 'GPIO 5 / 23 / 19 / 18', notes: 'Logs /m5porkchop/wardriving/*.wigle.csv & *.pcap' },
  { connector: 'ILI9341 2.8" TFT', signal: 'TFT_DC / CS / SCLK / MOSI / BL', pin: 'GPIO 2 / 15 / 14 / 13 / 21', notes: '320x240 Warhog HUD & XP status bar' },
  { connector: 'RGB LED (Rear)', signal: 'LED_R / LED_G / LED_B', pin: 'GPIO 4 / 16 / 17', notes: 'Pulses Green on GPS 3D Fix, Amber on Handshake' }
];

const PIGLET_PINOUT_ROWS = [
  { connector: 'Seeed XIAO ESP32-C5 / S3', signal: 'GPS TX -> XIAO RX (D7)', pin: 'GPIO 17 / RX (D7)', notes: 'ATGM336H TX -> XIAO RX @ 9600 or 115200 baud' },
  { connector: 'Seeed XIAO ESP32-C5 / S3', signal: 'GPS RX <- XIAO TX (D6)', pin: 'GPIO 16 / TX (D6)', notes: 'ATGM336H RX <- XIAO TX' },
  { connector: 'MicroSD SPI Breakout', signal: 'CS / SCK / MISO / MOSI', pin: 'D2 / D8 / D9 / D10', notes: 'Stores WiGLE CSV v1.6 dual-band wardrive logs' },
  { connector: 'SSD1306 0.96" OLED (Optional)', signal: 'I2C SDA / SCL', pin: 'D4 (SDA) / D5 (SCL)', notes: 'Compact Piglet live AP & satellite counter display' },
  { connector: 'RF Antenna Connector', signal: 'IPEX / U.FL Dual-Band', pin: '2.4GHz + 5GHz Whip', notes: 'ESP32-C5 native 802.11a/b/g/n/ac/ax dual-band sweep' }
];

export default function WarhogPigletWorkbench() {
  const [activeRig, setActiveRig] = useState(() => {
    try {
      return localStorage.getItem('warhog_piglet_active_rig') || 'warhog-cyd';
    } catch {
      return 'warhog-cyd';
    }
  });
  // Tabs: 'live' | 'sd-explorer' | 'config-editor' | 'sd-logs' | 'console' | 'hardware'
  const [activeTab, setActiveTab] = useState('live');
  const [activePersona, setActivePersona] = useState('warhog');
  const [isSerialConnected, setIsSerialConnected] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [bandFilter, setBandFilter] = useState('ALL');
  const [statusBanner, setStatusBanner] = useState(null);
  const [consoleInput, setConsoleInput] = useState('');
  const [importedFiles, setImportedFiles] = useState([]);
  const [serialLogs, setSerialLogs] = useState([
    '[SYSTEM] Warhog CYD & Piglet Workbench initialized.',
    '[WARHOG] Ready for 115200 UART stream, SD Card Explorer, or wardriver.config editing.'
  ]);

  // SD Card File Explorer State
  const [sdFiles, setSdFiles] = useState(INITIAL_SD_FILES);
  const [selectedFolder, setSelectedFolder] = useState('ALL');
  const [selectedSdFilePath, setSelectedSdFilePath] = useState('/wardriver.config');
  const [sdEditorBuffer, setSdEditorBuffer] = useState(INITIAL_SD_FILES[0].content);
  const [isSdFileDirty, setIsSdFileDirty] = useState(false);
  const [mountedDirectoryName, setMountedDirectoryName] = useState(null);

  // wardriver.config / porkchop.conf Studio State
  const [wardriverConfig, setWardriverConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('piglet_wardriver_config');
      return saved ? { ...DEFAULT_WARDRIVER_CONFIG, ...JSON.parse(saved) } : DEFAULT_WARDRIVER_CONFIG;
    } catch {
      return DEFAULT_WARDRIVER_CONFIG;
    }
  });
  const [configFormat, setConfigFormat] = useState('ini'); // 'ini' (wardriver.config) | 'json' (porkchop.conf)
  const [rawConfigText, setRawConfigText] = useState(() =>
    serializeWardriverConfig(DEFAULT_WARDRIVER_CONFIG, 'ini')
  );

  const [gpsState, setGpsState] = useState({
    lat: 37.774929,
    lon: -122.419416,
    altitude: 18.2,
    speedKmh: 0,
    heading: 65,
    satellites: 10,
    fixLabel: 'Standby (No Fix)',
    valid: false,
    time: '00:00:00 UTC'
  });
  const [trackPoints, setTrackPoints] = useState([]);
  const [networks, setNetworks] = useState([]);

  const serialPortRef = useRef(null);
  const serialReaderRef = useRef(null);
  const fileInputRef = useRef(null);
  const configUploadInputRef = useRef(null);
  const dirHandleRef = useRef(null);

  // Keep rawConfigText synced when wardriverConfig or configFormat changes via visual controls
  const updateConfigField = (key, value) => {
    setWardriverConfig((prev) => {
      const next = { ...prev, [key]: value };
      setRawConfigText(serializeWardriverConfig(next, configFormat));
      try {
        localStorage.setItem('piglet_wardriver_config', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleApplyHardwarePreset = (presetKey) => {
    const preset = HARDWARE_CONFIG_PRESETS[presetKey];
    if (!preset) return;
    setWardriverConfig((prev) => {
      const next = { ...prev, ...preset.patch };
      setRawConfigText(serializeWardriverConfig(next, configFormat));
      try {
        localStorage.setItem('piglet_wardriver_config', JSON.stringify(next));
      } catch {}
      return next;
    });
    setStatusBanner(`Applied hardware pinout & radio preset: ${preset.label}`);
  };

  const handleSaveConfigToSdTree = async () => {
    const targetPath = configFormat === 'ini' ? '/wardriver.config' : '/m5porkchop/config/porkchop.conf';
    const targetName = configFormat === 'ini' ? 'wardriver.config' : 'porkchop.conf';
    const targetFolder = configFormat === 'ini' ? '/' : '/m5porkchop/config';
    const serialized = serializeWardriverConfig(wardriverConfig, configFormat);
    setRawConfigText(serialized);

    setSdFiles((prev) => {
      const exists = prev.some((f) => f.path === targetPath);
      const updatedEntry = {
        path: targetPath,
        name: targetName,
        folder: targetFolder,
        sizeBytes: new Blob([serialized]).size,
        modified: new Date().toISOString().slice(0, 16).replace('T', ' '),
        type: 'config',
        content: serialized
      };
      if (exists) {
        return prev.map((f) => (f.path === targetPath ? updatedEntry : f));
      }
      return [updatedEntry, ...prev];
    });

    // If a physical SD card folder is mounted via File System Access API, write to disk
    if (dirHandleRef.current && configFormat === 'ini') {
      try {
        const fileHandle = await dirHandleRef.current.getFileHandle('wardriver.config', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(serialized);
        await writable.close();
        setStatusBanner(`Saved ${targetPath} directly to mounted SD card (${mountedDirectoryName})!`);
        return;
      } catch {
        // fall through to virtual SD save notice
      }
    }

    setStatusBanner(`Saved ${targetPath} (${new Blob([serialized]).size} bytes) to SD Card File Explorer.`);
  };

  const handleDownloadConfigFile = () => {
    const filename = configFormat === 'ini' ? 'wardriver.config' : 'porkchop.conf';
    const content = serializeWardriverConfig(wardriverConfig, configFormat);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadConfigFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const isJson = file.name.endsWith('.conf') || file.name.endsWith('.json') || text.trim().startsWith('{');
      const parsed = parseWardriverConfigText(text, DEFAULT_WARDRIVER_CONFIG);
      const nextFmt = isJson ? 'json' : 'ini';
      setConfigFormat(nextFmt);
      setWardriverConfig(parsed);
      setRawConfigText(serializeWardriverConfig(parsed, nextFmt));
      setStatusBanner(`Loaded configuration from ${file.name}`);
    } catch (err) {
      setStatusBanner(`Failed to parse config file: ${err?.message || 'Invalid format'}`);
    } finally {
      e.target.value = '';
    }
  };

  // Mount Physical MicroSD Card Directory via Browser File System Access API
  const handleMountLocalSdDirectory = async () => {
    try {
      if (typeof window === 'undefined' || !window.showDirectoryPicker) {
        setStatusBanner('Directory Picker API require Chrome/Edge, or use "Import SD .wigle.csv" to load files.');
        return;
      }
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      dirHandleRef.current = dirHandle;
      setMountedDirectoryName(dirHandle.name);

      const loaded = [];
      const scanDir = async (handle, prefix = '') => {
        for await (const [name, entry] of handle.entries()) {
          const fullPath = `${prefix}/${name}`;
          if (entry.kind === 'file') {
            try {
              const file = await entry.getFile();
              const isText =
                /\.(config|conf|json|csv|txt|log|22000|ini)$/i.test(name) && file.size < 2 * 1024 * 1024;
              const content = isText ? await file.text() : `[Binary file: ${name} (${file.size} bytes)]`;
              const type =
                /\.(config|conf|json|ini)$/i.test(name)
                  ? 'config'
                  : /\.csv$/i.test(name)
                  ? 'wigle'
                  : /\.22000|pcap$/i.test(name)
                  ? 'handshake'
                  : 'log';
              loaded.push({
                path: fullPath,
                name,
                folder: prefix || '/',
                sizeBytes: file.size,
                modified: new Date(file.lastModified).toISOString().slice(0, 16).replace('T', ' '),
                type,
                content,
                fileHandle: entry
              });
            } catch {}
          } else if (entry.kind === 'directory' && prefix.split('/').length < 4) {
            await scanDir(entry, fullPath);
          }
        }
      };

      await scanDir(dirHandle, '');
      if (loaded.length > 0) {
        setSdFiles(loaded);
        setSelectedSdFilePath(loaded[0].path);
        setSdEditorBuffer(loaded[0].content);
        setIsSdFileDirty(false);
      }
      setStatusBanner(`Mounted MicroSD volume "${dirHandle.name}" (${loaded.length} files indexed).`);
    } catch (err) {
      if (err?.name !== 'AbortError') {
        setStatusBanner(`Could not mount SD folder: ${err?.message || 'Cancelled'}`);
      }
    }
  };

  const selectedSdFile = useMemo(
    () => sdFiles.find((f) => f.path === selectedSdFilePath) || sdFiles[0] || null,
    [sdFiles, selectedSdFilePath]
  );

  const sdFolders = useMemo(() => {
    const set = new Set(['/', '/wardriving', '/m5porkchop/config', '/m5porkchop/wardriving', '/m5porkchop/handshakes', '/logs']);
    for (const f of sdFiles) set.add(f.folder || '/');
    return ['ALL', ...Array.from(set)];
  }, [sdFiles]);

  const visibleSdFiles = useMemo(() => {
    if (selectedFolder === 'ALL') return sdFiles;
    return sdFiles.filter((f) => f.folder === selectedFolder);
  }, [sdFiles, selectedFolder]);

  const handleSelectSdFile = (file) => {
    setSelectedSdFilePath(file.path);
    setSdEditorBuffer(file.content);
    setIsSdFileDirty(false);
  };

  const handleSaveSelectedSdFile = async () => {
    if (!selectedSdFile) return;
    const nextSize = new Blob([sdEditorBuffer]).size;
    setSdFiles((prev) =>
      prev.map((f) =>
        f.path === selectedSdFile.path
          ? {
              ...f,
              content: sdEditorBuffer,
              sizeBytes: nextSize,
              modified: new Date().toISOString().slice(0, 16).replace('T', ' ')
            }
          : f
      )
    );
    setIsSdFileDirty(false);

    // If it's wardriver.config or porkchop.conf, also sync into Config Studio
    if (selectedSdFile.type === 'config') {
      const parsed = parseWardriverConfigText(sdEditorBuffer, wardriverConfig);
      setWardriverConfig(parsed);
      setRawConfigText(sdEditorBuffer);
    }

    if (selectedSdFile.fileHandle?.createWritable) {
      try {
        const writable = await selectedSdFile.fileHandle.createWritable();
        await writable.write(sdEditorBuffer);
        await writable.close();
        setStatusBanner(`Wrote ${selectedSdFile.path} (${nextSize} B) to physical MicroSD card!`);
        return;
      } catch {}
    }
    setStatusBanner(`Saved changes to ${selectedSdFile.path} (${nextSize} B).`);
  };

  const handleCreateNewSdFile = () => {
    const folder = selectedFolder === 'ALL' ? '/wardriving' : selectedFolder;
    const name = `custom_${Date.now().toString().slice(-4)}.config`;
    const path = folder === '/' ? `/${name}` : `${folder}/${name}`;
    const content = serializeWardriverConfig(wardriverConfig, 'ini');
    const newEntry = {
      path,
      name,
      folder,
      sizeBytes: new Blob([content]).size,
      modified: new Date().toISOString().slice(0, 16).replace('T', ' '),
      type: 'config',
      content
    };
    setSdFiles((prev) => [newEntry, ...prev]);
    setSelectedSdFilePath(path);
    setSdEditorBuffer(content);
    setIsSdFileDirty(false);
    setStatusBanner(`Created ${path} on SD card tree.`);
  };

  const handleDeleteSdFile = (pathToDelete) => {
    setSdFiles((prev) => {
      const next = prev.filter((f) => f.path !== pathToDelete);
      if (selectedSdFilePath === pathToDelete && next[0]) {
        setSelectedSdFilePath(next[0].path);
        setSdEditorBuffer(next[0].content);
      }
      return next;
    });
    setStatusBanner(`Deleted ${pathToDelete} from SD card.`);
  };

  const handleSelectRig = (rig) => {
    setActiveRig(rig);
    try {
      localStorage.setItem('warhog_piglet_active_rig', rig);
    } catch {}
    setStatusBanner(
      rig === 'warhog-cyd'
        ? 'Switched to Warhog CYD (Porkchop SGT WARHOG on ESP32-2432S028R)'
        : 'Switched to Piglet Wardriver (Seeed XIAO ESP32-C5 / S3 Dual-Band + ATGM336H)'
    );
  };

  const appendSerialLog = useCallback((line) => {
    setSerialLogs((prev) => [...prev.slice(-250), line]);
  }, []);

  const ingestRawTextChunk = useCallback((chunk) => {
    if (!chunk) return;
    const lines = chunk.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      appendSerialLog(line);

      if (line.includes('$GP') || line.includes('$GN')) {
        const parsedGps = parseNmeaSentence(line);
        if (parsedGps) {
          setGpsState((prev) => ({ ...prev, ...parsedGps }));
          if (parsedGps.lat && parsedGps.lon) {
            setTrackPoints((prev) => [...prev.slice(-300), { lat: parsedGps.lat, lon: parsedGps.lon }]);
          }
        }
      }

      const parsedNet = parseWardriveLine(line);
      if (parsedNet) {
        setNetworks((prev) => {
          const map = new Map(prev.map((n) => [n.bssid, n]));
          map.set(parsedNet.bssid, parsedNet);
          return Array.from(map.values()).slice(-500);
        });
        if (parsedNet.lat && parsedNet.lon) {
          setGpsState((prev) => ({
            ...prev,
            lat: parsedNet.lat,
            lon: parsedNet.lon,
            altitude: parsedNet.altitude ?? prev.altitude,
            fixLabel: activeRig === 'warhog-cyd' ? 'Warhog CYD 3D Fix' : 'Piglet ATGM336H Fix',
            valid: true,
            time: new Date().toISOString().slice(11, 19) + ' UTC'
          }));
          setTrackPoints((prev) => [...prev.slice(-300), { lat: parsedNet.lat, lon: parsedNet.lon }]);
        }
      }
    }
  }, [activeRig, appendSerialLog]);

  const handleConnectSerial = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.serial) {
        setStatusBanner('WebSerial API is not available in this browser. Use Chrome or Edge.');
        return;
      }
      const filters =
        activeRig === 'piglet'
          ? [
              { usbVendorId: 0x303a, usbProductId: 0x1001 },
              { usbVendorId: 0x303a },
              { usbVendorId: 0x1a86, usbProductId: 0x7523 },
              { usbVendorId: 0x10c4, usbProductId: 0xea60 }
            ]
          : [
              { usbVendorId: 0x1a86, usbProductId: 0x7523 },
              { usbVendorId: 0x1a86, usbProductId: 0x55d4 },
              { usbVendorId: 0x10c4, usbProductId: 0xea60 },
              { usbVendorId: 0x303a }
            ];
      const port = await navigator.serial.requestPort({ filters });
      await port.open({ baudRate: 115200 });
      serialPortRef.current = port;
      setIsSerialConnected(true);
      const label = activeRig === 'warhog-cyd' ? 'Warhog CYD (115200)' : 'Piglet ESP32-C5 (115200)';
      setStatusBanner(`Connected to ${label} via WebSerial`);
      appendSerialLog(`[CONNECTED] ${label} opened at 115200 8N1`);

      const decoder = new TextDecoder();
      let buffer = '';
      const reader = port.readable.getReader();
      serialReaderRef.current = reader;
      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) {
              buffer += decoder.decode(value, { stream: true });
              const idx = buffer.lastIndexOf('\n');
              if (idx !== -1) {
                const complete = buffer.slice(0, idx + 1);
                buffer = buffer.slice(idx + 1);
                ingestRawTextChunk(complete);
              }
            }
          }
        } catch {
          // closed
        }
      })();
    } catch (err) {
      setStatusBanner(`Serial connection cancelled: ${err?.message || 'No port chosen'}`);
    }
  };

  const handleDisconnectSerial = async () => {
    try {
      if (serialReaderRef.current) {
        await serialReaderRef.current.cancel();
        serialReaderRef.current.releaseLock();
      }
      if (serialPortRef.current) {
        await serialPortRef.current.close();
      }
    } catch {}
    serialReaderRef.current = null;
    serialPortRef.current = null;
    setIsSerialConnected(false);
    setStatusBanner('Disconnected WebSerial rig');
  };

  const handleSendSerialCommand = async (cmdText) => {
    const clean = (cmdText || '').trim();
    if (!clean) return;
    appendSerialLog(`> ${clean}`);
    if (serialPortRef.current?.writable) {
      try {
        const writer = serialPortRef.current.writable.getWriter();
        await writer.write(new TextEncoder().encode(clean + '\r\n'));
        writer.releaseLock();
      } catch (err) {
        appendSerialLog(`[ERR] Failed to write serial command: ${err?.message}`);
      }
    } else {
      appendSerialLog(`[SIM-ACK] ${activeRig.toUpperCase()} executed "${clean}"`);
    }
  };

  const handleImportWigleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    let totalImported = 0;
    const newFileSummaries = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const { metadata, aps, track } = parseWigleCsvFile(text);
        totalImported += aps.length;
        newFileSummaries.push({
          name: file.name,
          sizeKb: (file.size / 1024).toFixed(1),
          format: metadata.format || 'WigleWifi-1.6',
          device: metadata.device || metadata.model || 'ESP32',
          apCount: aps.length,
          trackCount: track.length,
          importedAt: new Date().toLocaleTimeString()
        });

        if (aps.length > 0) {
          setNetworks((prev) => {
            const map = new Map(prev.map((n) => [n.bssid, n]));
            for (const ap of aps) map.set(ap.bssid, ap);
            return Array.from(map.values()).slice(-1000);
          });
        }
        if (track.length > 0) {
          const last = track[track.length - 1];
          setTrackPoints((prev) => [...prev, ...track].slice(-500));
          setGpsState((prev) => ({
            ...prev,
            lat: last.lat,
            lon: last.lon,
            fixLabel: `SD Log (${metadata.device || file.name})`,
            valid: true
          }));
        }
      } catch (err) {
        appendSerialLog(`[ERR] Failed to parse ${file.name}: ${err?.message}`);
      }
    }

    setImportedFiles((prev) => [...newFileSummaries, ...prev]);
    setStatusBanner(`Imported ${totalImported} unique networks from ${files.length} SD card log file(s).`);
    e.target.value = '';
  };

  const handleExportMergedWigleCsv = () => {
    if (networks.length === 0) return;
    const deviceTag = activeRig === 'warhog-cyd' ? 'Porkchop-Warhog-CYD' : 'Piglet-ESP32C5';
    const preHeader = `WigleWifi-1.6,appRelease=1.0,model=ESP32,release=1.0,device=${deviceTag},display=TFT,board=ESP32,brand=Skons\n`;
    const header = 'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type\n';
    const rows = networks
      .map((ap) => {
        const ch = Number(ap.channel) || 6;
        const freq = ap.frequency || (ch > 14 ? 5000 + ch * 5 : 2407 + ch * 5);
        const lat = ap.lat ?? gpsState.lat ?? 0;
        const lon = ap.lon ?? gpsState.lon ?? 0;
        const alt = ap.altitude ?? gpsState.altitude ?? 0;
        const type = ap.deviceType || 'WIFI';
        return `${ap.bssid},"${ap.ssid}",${ap.auth},${new Date().toISOString()},${ch},${freq},${ap.rssi},${lat},${lon},${alt},4.0,,,${type}`;
      })
      .join('\n');

    const blob = new Blob([preHeader + header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${deviceTag.toLowerCase()}-merged-${Date.now()}.wigle.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Simulation Loop for Warhog CYD & Piglet
  useEffect(() => {
    if (!isSimulating) return;
    let step = 0;
    const timer = setInterval(() => {
      step += 1;
      const item = SIMULATED_RIG_NETWORKS[step % SIMULATED_RIG_NETWORKS.length];
      const nextLat = gpsState.lat + Math.cos(step * 0.3) * 0.00015;
      const nextLon = gpsState.lon + Math.sin(step * 0.3) * 0.00015;
      const rssi = Math.max(-90, Math.min(-38, item.rssi + Math.round((Math.random() - 0.5) * 8)));

      const simEntry = {
        ...item,
        rssi,
        lat: Number(nextLat.toFixed(6)),
        lon: Number(nextLon.toFixed(6)),
        seenTime: new Date().toLocaleTimeString()
      };

      setNetworks((prev) => {
        const map = new Map(prev.map((n) => [n.bssid, n]));
        map.set(simEntry.bssid, simEntry);
        return Array.from(map.values());
      });
      setGpsState((prev) => ({
        ...prev,
        lat: simEntry.lat,
        lon: simEntry.lon,
        speedKmh: 31.2,
        heading: (prev.heading + 15) % 360,
        satellites: 11,
        fixLabel: activeRig === 'warhog-cyd' ? 'SGT WARHOG 3D Fix' : 'Piglet ATGM336H Lock',
        valid: true,
        time: new Date().toISOString().slice(11, 19) + ' UTC'
      }));
      setTrackPoints((prev) => [...prev.slice(-300), { lat: simEntry.lat, lon: simEntry.lon }]);
      appendSerialLog(
        `[${activeRig === 'warhog-cyd' ? 'WARHOG' : 'PIGLET'}] BSSID: ${simEntry.bssid} | SSID: ${simEntry.ssid} | CH: ${simEntry.channel} | RSSI: ${simEntry.rssi} | GPS: ${simEntry.lat},${simEntry.lon}`
      );
    }, 950);

    return () => clearInterval(timer);
  }, [isSimulating, activeRig, gpsState.lat, gpsState.lon, appendSerialLog]);

  // Computed Telemetry & Rank Metrics
  const stats = useMemo(() => {
    let wifi24 = 0;
    let wifi5 = 0;
    let ble = 0;
    let openNet = 0;
    let wpa3 = 0;
    let handshakes = 0;

    for (const n of networks) {
      if (n.deviceType === 'BLE') ble += 1;
      else if (Number(n.channel) > 14 || (n.frequency && n.frequency >= 5000)) wifi5 += 1;
      else wifi24 += 1;

      const authUpper = (n.auth || '').toUpperCase();
      if (authUpper.includes('OPEN')) openNet += 1;
      if (authUpper.includes('WPA3') || authUpper.includes('SAE')) wpa3 += 1;
      if (authUpper.includes('PMKID') || authUpper.includes('EAPOL')) handshakes += 1;
    }

    const xp = wifi24 * 10 + wifi5 * 18 + ble * 8 + handshakes * 75;
    const rank =
      xp >= 1000
        ? 'WARHOG SUPREME'
        : xp >= 400
        ? 'SGT WARHOG'
        : xp >= 120
        ? 'RAZORBACK'
        : 'PIGLET SCOUT';

    return { wifi24, wifi5, ble, openNet, wpa3, handshakes, xp, rank };
  }, [networks]);

  const filteredNetworks = useMemo(() => {
    return networks.filter((n) => {
      if (bandFilter === '2.4GHz' && (n.deviceType === 'BLE' || Number(n.channel) > 14)) return false;
      if (bandFilter === '5GHz' && (n.deviceType === 'BLE' || Number(n.channel) <= 14)) return false;
      if (bandFilter === 'BLE' && n.deviceType !== 'BLE') return false;
      if (bandFilter === 'OPEN' && !(n.auth || '').toUpperCase().includes('OPEN')) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        (n.ssid || '').toLowerCase().includes(q) ||
        (n.bssid || '').toLowerCase().includes(q) ||
        (n.auth || '').toLowerCase().includes(q)
      );
    });
  }, [networks, bandFilter, searchQuery]);

  return (
    <div className="w-full space-y-4 font-mono text-xs">
      {/* Top Workbench Header */}
      <div className="bg-[#171920] border border-slate-800 rounded-xl p-4 shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`p-2.5 rounded-xl border ${
              activeRig === 'warhog-cyd'
                ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                : 'bg-pink-500/10 text-pink-400 border-pink-500/30'
            }`}
          >
            <Compass className="w-6 h-6" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-100 tracking-wide">
                WARHOG CYD & PIGLET SUITE
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40">
                SGT WARHOG / PORKCHOP
              </span>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/40">
                PIGLET ESP32-C5/S3
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Dedicated wardriving & field telemetry workbench for Porkchop-CYD (ESP32-2432S028R) and Seeed XIAO ESP32-C5/S3 Piglet rigs
            </p>
          </div>
        </div>

        {/* Rig Selector & Primary Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1"
            role="group"
            aria-label="Warhog or Piglet Hardware Toggle"
          >
            <button
              type="button"
              onClick={() => handleSelectRig('warhog-cyd')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${
                activeRig === 'warhog-cyd'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span>🐗 Warhog CYD</span>
              <span className="text-[9px] px-1 rounded bg-amber-950 text-amber-400 border border-amber-500/30">
                2432S028R
              </span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectRig('piglet')}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition flex items-center gap-1.5 ${
                activeRig === 'piglet'
                  ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span>🐷 Piglet</span>
              <span className="text-[9px] px-1 rounded bg-pink-950 text-pink-400 border border-pink-500/30">
                ESP32-C5
              </span>
            </button>
          </div>

          {!isSerialConnected ? (
            <button
              type="button"
              onClick={handleConnectSerial}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs border transition ${
                activeRig === 'warhog-cyd'
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border-amber-500/40'
                  : 'bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 border-pink-500/40'
              }`}
            >
              <Usb className="w-4 h-4" />
              <span>Connect {activeRig === 'warhog-cyd' ? 'Warhog CYD' : 'Piglet'} (Serial)</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDisconnectSerial}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs"
            >
              <span>Disconnect Rig</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsSimulating((s) => !s)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold text-xs border transition ${
              isSimulating
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>{isSimulating ? 'Stop Simulation' : 'Simulate Field Sweep'}</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".csv,.wigle.csv,.txt"
            onChange={handleImportWigleFiles}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 font-bold text-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Import SD .wigle.csv</span>
          </button>

          <button
            type="button"
            onClick={handleExportMergedWigleCsv}
            disabled={networks.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-bold text-xs disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            <span>Export WiGLE v1.6</span>
          </button>
        </div>
      </div>

      {statusBanner && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-lg px-3.5 py-2 flex items-center justify-between text-xs text-slate-200">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{statusBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setStatusBanner(null)}
            className="text-slate-500 hover:text-slate-300 text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#12151c] border border-slate-800 rounded-xl p-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {[
            { id: 'live', label: 'Live HUD & Wardrive Deck', icon: Compass },
            { id: 'sd-explorer', label: `Piglet / Warhog SD File Explorer (${sdFiles.length})`, icon: FolderOpen },
            { id: 'config-editor', label: 'wardriver.config & porkchop.conf Editor', icon: Sliders },
            { id: 'sd-logs', label: `WiGLE CSV Merger (${importedFiles.length})`, icon: HardDrive },
            { id: 'console', label: 'Serial Console', icon: Terminal },
            { id: 'hardware', label: 'CYD & Piglet Pinouts', icon: Cpu }
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  activeTab === tab.id
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Gamified XP & Rank Pill */}
        <div className="flex items-center gap-2 px-3 py-1 rounded-lg bg-slate-950 border border-slate-800">
          <span className="text-[10px] uppercase text-slate-400">Rank:</span>
          <span className="text-amber-400 font-bold">{stats.rank}</span>
          <span className="text-slate-600">|</span>
          <span className="text-emerald-400 font-bold">{stats.xp} XP</span>
        </div>
      </div>

      {/* TAB 1: LIVE HUD & WARDRIVE DECK */}
      {activeTab === 'live' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Virtual CYD 320x240 / Piglet OLED Screen Mirror */}
            <div className="bg-[#050811] border-2 border-amber-500/40 rounded-xl p-3.5 flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-bold text-amber-300 text-xs">
                    {activeRig === 'warhog-cyd'
                      ? 'CYD 320x240 TFT MIRROR — SGT WARHOG'
                      : 'PIGLET SSD1306 HUD — DUAL-BAND C5'}
                  </span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                  {gpsState.time}
                </span>
              </div>

              {/* ASCII Mascot & Live Telemetry Readout */}
              <div className="my-3 bg-slate-950/90 border border-slate-800/90 rounded-lg p-3 flex items-center justify-between gap-3">
                <pre className="text-[10px] leading-tight text-amber-400 font-bold select-none">
{activeRig === 'warhog-cyd'
  ? `  ^..^   [SGT WARHOG]
 ( oo )  MODE: ${activePersona.toUpperCase()}
  /  \\   FIX:  ${gpsState.fixLabel}`
  : `  ^..^   [PIGLET C5]
 ( oo )  2.4G + 5GHz
  (..)   SAT: ${gpsState.satellites} LOCK`}
                </pre>
                <div className="text-right space-y-1">
                  <div className="text-[10px] text-slate-400">GPS COORDINATES</div>
                  <div className="text-xs font-bold text-emerald-400">
                    {gpsState.lat.toFixed(5)}° N
                  </div>
                  <div className="text-xs font-bold text-cyan-400">
                    {gpsState.lon.toFixed(5)}° W
                  </div>
                </div>
              </div>

              {/* 4-Metric Mini Grid inside Display */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-slate-900/90 border border-slate-800 rounded p-1.5">
                  <div className="text-[9px] text-slate-400">2.4 GHz</div>
                  <div className="text-sm font-bold text-cyan-300">{stats.wifi24}</div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded p-1.5">
                  <div className="text-[9px] text-slate-400">5 GHz</div>
                  <div className="text-sm font-bold text-emerald-300">{stats.wifi5}</div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded p-1.5">
                  <div className="text-[9px] text-slate-400">BLE</div>
                  <div className="text-sm font-bold text-purple-300">{stats.ble}</div>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded p-1.5">
                  <div className="text-[9px] text-slate-400">PMKID/HS</div>
                  <div className="text-sm font-bold text-amber-300">{stats.handshakes}</div>
                </div>
              </div>
            </div>

            {/* Telemetry Cards & Quick Mode Selector */}
            <div className="lg:col-span-2 bg-[#12151c] border border-slate-800 rounded-xl p-4 flex flex-col justify-between gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-400" />
                  Active Porkchop / Piglet Operating Persona
                </span>
                <span className="text-[11px] text-slate-400">
                  Track Points: <strong className="text-emerald-400">{trackPoints.length}</strong> • Unique BSSIDs:{' '}
                  <strong className="text-cyan-300">{networks.length}</strong>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {PORKCHOP_MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      setActivePersona(m.id);
                      handleSendSerialCommand(m.cmd);
                    }}
                    className={`text-left p-2.5 rounded-lg border transition ${
                      activePersona === m.id
                        ? 'bg-amber-500/15 border-amber-500/50 text-slate-100'
                        : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-amber-300">{m.name}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-900 text-cyan-300 border border-slate-800">
                        {m.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{m.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Captured Networks Table with Band Filter */}
          <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Wifi className="w-4 h-4 text-amber-400" />
                <span className="font-bold text-slate-100">
                  CAPTURED WARDRIVE TARGETS ({filteredNetworks.length})
                </span>
                <div className="flex items-center gap-1 ml-2">
                  {['ALL', '2.4GHz', '5GHz', 'BLE', 'OPEN'].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setBandFilter(f)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                        bandFilter === f
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {f}
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
                    className="bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 outline-none w-52"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setNetworks([])}
                  className="p-1.5 rounded-lg bg-slate-950 text-slate-400 hover:text-rose-400 border border-slate-800"
                  title="Clear captured networks"
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
                    <th className="py-2 px-3">Auth / Mode</th>
                    <th className="py-2 px-3">GPS Coordinates</th>
                    <th className="py-2 px-3 text-right">Seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {filteredNetworks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500">
                        No targets logged yet. Click &quot;Simulate Field Sweep&quot;, connect your Warhog CYD / Piglet over USB Serial, or import a .wigle.csv file.
                      </td>
                    </tr>
                  ) : (
                    filteredNetworks.map((n) => {
                      const is5G = Number(n.channel) > 14 || (n.frequency && n.frequency >= 5000);
                      return (
                        <tr key={n.bssid} className="hover:bg-slate-900/50">
                          <td
                            className={`py-1.5 px-3 font-bold ${
                              n.rssi >= -60
                                ? 'text-emerald-400'
                                : n.rssi >= -75
                                ? 'text-amber-300'
                                : 'text-rose-400'
                            }`}
                          >
                            {n.rssi} dBm
                          </td>
                          <td className="py-1.5 px-3 font-bold text-slate-100">{n.ssid}</td>
                          <td className="py-1.5 px-3 text-slate-400">{n.bssid}</td>
                          <td className="py-1.5 px-3">
                            {n.deviceType === 'BLE' ? (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                                BLE ADV
                              </span>
                            ) : (
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${
                                  is5G
                                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                                    : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                }`}
                              >
                                {is5G ? '5GHz' : '2.4GHz'} CH {n.channel}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-3 text-slate-300">{n.auth}</td>
                          <td className="py-1.5 px-3 text-slate-400">
                            {n.lat && n.lon ? `${n.lat.toFixed(5)}, ${n.lon.toFixed(5)}` : '—'}
                          </td>
                          <td className="py-1.5 px-3 text-right text-slate-500">{n.seenTime}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: PIGLET & WARHOG SD CARD FILE EXPLORER */}
      {activeTab === 'sd-explorer' && (
        <div className="space-y-4">
          <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-pink-400" />
                <span>Piglet & Warhog CYD MicroSD File Explorer</span>
                {mountedDirectoryName && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    Mounted: {mountedDirectoryName}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Browse, inspect, edit, and load <code className="text-pink-300">/wardriver.config</code>, <code className="text-amber-300">/m5porkchop/config/porkchop.conf</code>, WiGLE v1.6 logs, and <code className="text-cyan-300">.22000</code> handshakes.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleMountLocalSdDirectory}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500/20 hover:bg-pink-500/30 text-pink-300 border border-pink-500/40 font-bold text-xs"
                title="Mount a FAT32 Piglet or Warhog MicroSD card folder from your computer"
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Mount Local SD Card Folder</span>
              </button>

              <button
                type="button"
                onClick={() => handleSendSerialCommand('sd ls -la /')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-500/30 font-bold text-xs"
                title="Query SD directory listing over USB Serial from connected Piglet / Warhog CYD"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh via Serial (sd ls)</span>
              </button>

              <button
                type="button"
                onClick={handleCreateNewSdFile}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 font-bold text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Config File</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Left Column: Directory Filter + File Tree */}
            <div className="bg-[#12151c] border border-slate-800 rounded-xl p-3.5 space-y-3">
              <div className="flex flex-wrap items-center gap-1 border-b border-slate-800 pb-2.5">
                {sdFolders.map((folder) => (
                  <button
                    key={folder}
                    type="button"
                    onClick={() => setSelectedFolder(folder)}
                    className={`px-2 py-1 rounded text-[10px] font-bold transition flex items-center gap-1 ${
                      selectedFolder === folder
                        ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40'
                        : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Folder className="w-3 h-3" />
                    <span>{folder}</span>
                  </button>
                ))}
              </div>

              <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
                {visibleSdFiles.map((file) => {
                  const isSelected = selectedSdFile?.path === file.path;
                  return (
                    <div
                      key={file.path}
                      onClick={() => handleSelectSdFile(file)}
                      className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between gap-2 ${
                        isSelected
                          ? 'bg-amber-500/15 border-amber-500/50 text-slate-100'
                          : 'bg-slate-950/80 border-slate-800/90 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <FileCode
                            className={`w-3.5 h-3.5 shrink-0 ${
                              file.type === 'config'
                                ? 'text-pink-400'
                                : file.type === 'wigle'
                                ? 'text-emerald-400'
                                : file.type === 'handshake'
                                ? 'text-amber-400'
                                : 'text-cyan-400'
                            }`}
                          />
                          <span className="font-bold truncate">{file.name}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate mt-0.5">
                          {file.path} • {file.sizeBytes} B
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteSdFile(file.path);
                        }}
                        className="p-1 rounded hover:bg-rose-500/20 text-slate-500 hover:text-rose-400"
                        title="Delete file from SD tree"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right 2 Columns: File Inspector & Inline Editor */}
            <div className="lg:col-span-2 bg-[#12151c] border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              {selectedSdFile ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-100 text-sm">{selectedSdFile.path}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-slate-900 text-slate-400 border border-slate-800">
                          {selectedSdFile.sizeBytes} bytes
                        </span>
                        {isSdFileDirty && (
                          <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40">
                            Unsaved edits
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        Last Modified: {selectedSdFile.modified}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {selectedSdFile.type === 'config' && (
                        <button
                          type="button"
                          onClick={() => {
                            const isJson = selectedSdFile.name.endsWith('.conf') || sdEditorBuffer.trim().startsWith('{');
                            const parsed = parseWardriverConfigText(sdEditorBuffer, DEFAULT_WARDRIVER_CONFIG);
                            setConfigFormat(isJson ? 'json' : 'ini');
                            setWardriverConfig(parsed);
                            setRawConfigText(sdEditorBuffer);
                            setActiveTab('config-editor');
                            setStatusBanner(`Opened ${selectedSdFile.path} in Visual wardriver.config Editor`);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-pink-500/20 text-pink-300 border border-pink-500/40 font-bold text-xs"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>Open in Visual Config Editor</span>
                        </button>
                      )}

                      {selectedSdFile.type === 'wigle' && (
                        <button
                          type="button"
                          onClick={() => {
                            const { aps, track } = parseWigleCsvFile(sdEditorBuffer);
                            if (aps.length > 0) {
                              setNetworks((prev) => {
                                const map = new Map(prev.map((n) => [n.bssid, n]));
                                for (const ap of aps) map.set(ap.bssid, ap);
                                return Array.from(map.values());
                              });
                            }
                            if (track.length > 0) {
                              setTrackPoints((prev) => [...prev, ...track]);
                            }
                            setActiveTab('live');
                            setStatusBanner(`Loaded ${aps.length} networks from ${selectedSdFile.name} into Live Wardrive Deck!`);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-xs"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                          <span>Load into Wardrive Deck</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={handleSaveSelectedSdFile}
                        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs"
                      >
                        <Save className="w-3.5 h-3.5" />
                        <span>Save File</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const blob = new Blob([sdEditorBuffer], { type: 'text/plain' });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = selectedSdFile.name;
                          a.click();
                          URL.revokeObjectURL(url);
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    value={sdEditorBuffer}
                    onChange={(e) => {
                      setSdEditorBuffer(e.target.value);
                      setIsSdFileDirty(true);
                    }}
                    rows={16}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-slate-200 outline-none focus:border-amber-500/50 leading-relaxed"
                  />
                </>
              ) : (
                <div className="py-16 text-center text-slate-500">
                  Select a file from the Piglet / Warhog SD card tree on the left to inspect or edit it.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WARDRIVER.CONFIG & PORKCHOP.CONF VISUAL + RAW EDITOR */}
      {activeTab === 'config-editor' && (
        <div className="space-y-4">
          {/* Top Bar: Presets & Save/Download Actions */}
          <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>Piglet <code className="text-pink-300">wardriver.config</code> & Warhog <code className="text-amber-300">porkchop.conf</code> Studio</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure GPIO pins for ATGM336H / NEO-6M GPS, SPI MicroSD pins, 2.4/5GHz channel hopping, and WiGLE / WPA-SEC API keys.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfigFormat('ini');
                    setRawConfigText(serializeWardriverConfig(wardriverConfig, 'ini'));
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-bold ${
                    configFormat === 'ini'
                      ? 'bg-pink-500/20 text-pink-300 border border-pink-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  wardriver.config (INI)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfigFormat('json');
                    setRawConfigText(serializeWardriverConfig(wardriverConfig, 'json'));
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-bold ${
                    configFormat === 'json'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  porkchop.conf (JSON)
                </button>
              </div>

              <input
                ref={configUploadInputRef}
                type="file"
                accept=".config,.conf,.json,.ini,.txt"
                onChange={handleUploadConfigFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => configUploadInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/30 font-bold text-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Load File</span>
              </button>

              <button
                type="button"
                onClick={handleSaveConfigToSdTree}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold text-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save to SD Card</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  handleSendSerialCommand(
                    `config write ${configFormat === 'ini' ? '/wardriver.config' : '/m5porkchop/config/porkchop.conf'}`
                  )
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>Push via Serial</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadConfigFile}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-bold text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download {configFormat === 'ini' ? 'wardriver.config' : 'porkchop.conf'}</span>
              </button>
            </div>
          </div>

          {/* 1-Click Hardware Board Presets */}
          <div className="bg-[#12151c] border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold uppercase text-slate-400 mr-1">
              1-Click Hardware Board Preset:
            </span>
            {Object.entries(HARDWARE_CONFIG_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleApplyHardwarePreset(key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition ${
                  wardriverConfig.hardware_preset === key
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Visual Form Controls */}
            <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-4">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300 border-b border-slate-800 pb-2">
                1. Device Identity & Radio Sweep Settings
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Device Name</span>
                  <input
                    type="text"
                    value={wardriverConfig.device_name}
                    onChange={(e) => updateConfigField('device_name', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Operator Callsign</span>
                  <input
                    type="text"
                    value={wardriverConfig.callsign}
                    onChange={(e) => updateConfigField('callsign', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Hop Interval (ms)</span>
                  <input
                    type="number"
                    value={wardriverConfig.hop_interval_ms}
                    onChange={(e) => updateConfigField('hop_interval_ms', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-cyan-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Minimum RSSI Filter (dBm)</span>
                  <input
                    type="number"
                    value={wardriverConfig.min_rssi_dbm}
                    onChange={(e) => updateConfigField('min_rssi_dbm', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-cyan-300"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-4 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wardriverConfig.enable_24ghz}
                    onChange={(e) => updateConfigField('enable_24ghz', e.target.checked)}
                    className="accent-cyan-500"
                  />
                  <span className="text-slate-200">2.4 GHz Sweep</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wardriverConfig.enable_5ghz}
                    onChange={(e) => updateConfigField('enable_5ghz', e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span className="text-emerald-300 font-bold">5 GHz Dual-Band (ESP32-C5)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={wardriverConfig.enable_ble_sweep}
                    onChange={(e) => updateConfigField('enable_ble_sweep', e.target.checked)}
                    className="accent-purple-500"
                  />
                  <span className="text-purple-300">BLE Advertisement Sweep</span>
                </label>
              </div>

              <h4 className="text-xs font-bold uppercase tracking-wider text-cyan-300 border-b border-slate-800 pb-2 pt-2">
                2. GPS UART & MicroSD SPI Pin Assignment
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">GPS RX Pin (GPIO)</span>
                  <input
                    type="number"
                    value={wardriverConfig.gps_rx_pin}
                    onChange={(e) => updateConfigField('gps_rx_pin', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-emerald-300 font-bold"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">GPS TX Pin (GPIO)</span>
                  <input
                    type="number"
                    value={wardriverConfig.gps_tx_pin}
                    onChange={(e) => updateConfigField('gps_tx_pin', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-emerald-300 font-bold"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">GPS Baud Rate</span>
                  <select
                    value={wardriverConfig.gps_baud}
                    onChange={(e) => updateConfigField('gps_baud', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  >
                    <option value={9600}>9600 bps (ATGM336H / NEO-6M)</option>
                    <option value={38400}>38400 bps</option>
                    <option value={115200}>115200 bps (Fast GNSS)</option>
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">SD CS Pin (GPIO)</span>
                  <input
                    type="number"
                    value={wardriverConfig.sd_cs_pin}
                    onChange={(e) => updateConfigField('sd_cs_pin', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-amber-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">SD Log Directory</span>
                  <input
                    type="text"
                    value={wardriverConfig.log_dir}
                    onChange={(e) => updateConfigField('log_dir', e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Rotate Size (KB)</span>
                  <input
                    type="number"
                    value={wardriverConfig.rotate_file_kb}
                    onChange={(e) => updateConfigField('rotate_file_kb', Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
              </div>

              <h4 className="text-xs font-bold uppercase tracking-wider text-pink-300 border-b border-slate-800 pb-2 pt-2">
                3. WiGLE & WPA-SEC Cloud Sync Credentials
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Home Sync Wi-Fi SSID</span>
                  <input
                    type="text"
                    value={wardriverConfig.sync_wifi_ssid}
                    onChange={(e) => updateConfigField('sync_wifi_ssid', e.target.value)}
                    placeholder="Optional home SSID for auto-sync"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">WiGLE API Token (Encoded)</span>
                  <input
                    type="password"
                    value={wardriverConfig.wigle_api_token}
                    onChange={(e) => updateConfigField('wigle_api_token', e.target.value)}
                    placeholder="AID..."
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
                <label className="col-span-2 space-y-1">
                  <span className="text-[11px] text-slate-400">WPA-SEC Key (wpa-sec.stanev.org)</span>
                  <input
                    type="password"
                    value={wardriverConfig.wpasec_key}
                    onChange={(e) => updateConfigField('wpasec_key', e.target.value)}
                    placeholder="32-char hex WPA-SEC key for .22000 handshake uploads"
                    className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                  />
                </label>
              </div>
            </div>

            {/* Live Synchronized Raw Config Preview & Editor */}
            <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-3">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <span className="font-bold text-slate-100">
                  Live File Preview ({configFormat === 'ini' ? '/wardriver.config' : '/m5porkchop/config/porkchop.conf'})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseWardriverConfigText(rawConfigText, wardriverConfig);
                    setWardriverConfig(parsed);
                    setStatusBanner('Synced raw text edits back to visual controls.');
                  }}
                  className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-[11px]"
                >
                  Apply Raw Text Edits
                </button>
              </div>

              <textarea
                value={rawConfigText}
                onChange={(e) => setRawConfigText(e.target.value)}
                rows={22}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 font-mono text-xs text-emerald-300 outline-none focus:border-pink-500/50 leading-relaxed"
              />
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: SD CARD & WIGLE LOG MERGER */}
      {activeTab === 'sd-logs' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                MicroSD WiGLE v1.6 Log Merger & Deduplicator
              </h3>
              <p className="text-xs text-slate-400">
                Drop multiple chunked <code className="text-amber-300">/m5porkchop/wardriving/*.wigle.csv</code> or Piglet CSV files to deduplicate BSSIDs and export a single master WiGLE v1.6 upload file.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-xs"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Add SD .wigle.csv Files</span>
              </button>
              <button
                type="button"
                onClick={handleExportMergedWigleCsv}
                disabled={networks.length === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold text-xs disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Merged WiGLE v1.6 ({networks.length} APs)</span>
              </button>
            </div>
          </div>

          {importedFiles.length === 0 ? (
            <div className="border border-dashed border-slate-800 rounded-xl p-8 text-center text-slate-500">
              No SD card log files imported in this session yet. Click &quot;Add SD .wigle.csv Files&quot; above to load files from your Warhog CYD or Piglet MicroSD card.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {importedFiles.map((f, idx) => (
                <div key={idx} className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-amber-300 truncate">{f.name}</span>
                    <span className="text-[10px] text-slate-500">{f.sizeKb} KB</span>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Format: <strong className="text-slate-200">{f.format}</strong> • Device:{' '}
                    <strong className="text-cyan-300">{f.device}</strong>
                  </div>
                  <div className="text-[11px] text-emerald-400 font-bold">
                    {f.apCount} networks • {f.trackCount} GPS fixes
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: PORKCHOP PERSONAS & SERIAL CONSOLE */}
      {activeTab === 'console' && (
        <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-slate-100">
              Live 115200 UART Telemetry & Command Console ({activeRig === 'warhog-cyd' ? 'Warhog CYD' : 'Piglet ESP32-C5'})
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {['status', 'mode warhog', 'mode oink', 'wigle stat', 'sd ls'].map((quickCmd) => (
                <button
                  key={quickCmd}
                  type="button"
                  onClick={() => handleSendSerialCommand(quickCmd)}
                  className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-amber-300 border border-slate-800 text-[11px]"
                >
                  {quickCmd}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 h-64 overflow-y-auto font-mono text-[11px] space-y-1 text-slate-300">
            {serialLogs.map((line, i) => (
              <div key={i} className="leading-relaxed break-all">
                {line}
              </div>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendSerialCommand(consoleInput);
              setConsoleInput('');
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={consoleInput}
              onChange={(e) => setConsoleInput(e.target.value)}
              placeholder="Send serial command to Warhog CYD or Piglet..."
              className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 outline-none"
            />
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold text-xs"
            >
              Send UART
            </button>
          </form>
        </div>
      )}

      {/* TAB 6: HARDWARE WIRING & PINOUT REFERENCE */}
      {activeTab === 'hardware' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-[#12151c] border border-amber-500/30 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-amber-300">
              🐗 Warhog CYD (ESP32-2432S028R) GPS & SD Pinout
            </h3>
            <div className="border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="py-1.5 px-2.5">Header</th>
                    <th className="py-1.5 px-2.5">Signal</th>
                    <th className="py-1.5 px-2.5">ESP32 Pin</th>
                    <th className="py-1.5 px-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {CYD_PINOUT_ROWS.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-2.5 text-amber-300 font-bold">{r.connector}</td>
                      <td className="py-1.5 px-2.5 text-slate-200">{r.signal}</td>
                      <td className="py-1.5 px-2.5 text-cyan-300">{r.pin}</td>
                      <td className="py-1.5 px-2.5 text-slate-400">{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-[#12151c] border border-pink-500/30 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-pink-300">
              🐷 Piglet (Seeed XIAO ESP32-C5 / S3) GPS & SD Pinout
            </h3>
            <div className="border border-slate-800 rounded-lg overflow-hidden">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-900 text-slate-400">
                  <tr>
                    <th className="py-1.5 px-2.5">Module</th>
                    <th className="py-1.5 px-2.5">Signal</th>
                    <th className="py-1.5 px-2.5">XIAO Pin</th>
                    <th className="py-1.5 px-2.5">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {PIGLET_PINOUT_ROWS.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1.5 px-2.5 text-pink-300 font-bold">{r.connector}</td>
                      <td className="py-1.5 px-2.5 text-slate-200">{r.signal}</td>
                      <td className="py-1.5 px-2.5 text-cyan-300">{r.pin}</td>
                      <td className="py-1.5 px-2.5 text-slate-400">{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
