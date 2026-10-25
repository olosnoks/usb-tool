import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Wifi, 
  Radio, 
  Play, 
  Pause, 
  Square, 
  RefreshCw, 
  Trash2, 
  Download, 
  Sliders, 
  Cpu, 
  Activity, 
  ShieldCheck, 
  ShieldAlert, 
  AlertTriangle, 
  Terminal, 
  Table, 
  Filter, 
  Search, 
  CheckCircle2, 
  HardDrive, 
  Layers, 
  Zap, 
  Users, 
  FileCode, 
  ExternalLink, 
  X, 
  Smartphone,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Lock,
  BarChart2,
  Compass,
  Radar,
  Network,
  Send,
  Save,
  FolderOpen,
  MapPin,
  Fingerprint,
  Database,
  FileText,
  Globe,
  Star,
  Bell,
  BellOff,
  GitCompare,
  Tag,
  Edit3,
  ArrowRightLeft,
  Upload,
  Gauge,
  SlidersHorizontal,
  Apple,
  Laptop,
  Monitor,
  Flame,
  HelpCircle
} from 'lucide-react';
import { 
  initDriver, 
  connectAlfaDevice, 
  startMonitorMode, 
  retuneChannel, 
  setHardwareRxGain,
  bytesToHex, 
  identifyChipsetModel,
  queryHardwareIntrospection,
  unpackRealtekUsbTransfer,
  MOCK_WIFI_FRAMES 
} from '../../utils/alfaWifiDriver';
import { AirtimeTracker, calculateAirtime } from '../../utils/airtimeCalculator';
import { fastFilterPacket, parseMacToBytes } from '../../utils/packetFilter';
import { 
  parse80211Frame, 
  lookupVendor, 
  detectIdentifierAnomalies,
  correlateHiddenAp,
  detectSignatureRandomization,
  clusterInfrastructure
} from '../../utils/wifiParser';
import { generateHeuristicReport } from '../../utils/heuristicEngine';
import { getVendor } from '../../utils/ouiLookup';
import { downloadPcap, filterPacketsByMac, downloadTargetedPcap } from '../../utils/pcapExporter';
import { LivePcapWriter } from '../../utils/livePcapWriter';
import {
  RULE_EVENT_TYPES,
  RULE_ACTION_TYPES,
  evaluateRules,
  evaluateAndExecuteRules,
  executeRuleAction,
  createRule,
  loadRulesFromStorage,
  saveRulesToStorage,
  playAudioBeep
} from '../../utils/ruleEngine';
import { parsePcap, readPcapFile, PcapReplayer } from '../../utils/pcapReader';
import { HandshakeTracker, playHandshakeChime } from '../../utils/handshakeDetector';
import { detectRogueAps } from '../../utils/widsRogueAp';
import { downloadWigleCsv, calculateHaversineDistance } from '../../utils/wardrivingExporter';
import TopologyView from './TopologyView';
import SignalMapView from './SignalMapView';
import SpectrumWaterfall from './SpectrumWaterfall';
import ChannelOverlapChart from './ChannelOverlapChart';
import { runOutputTest } from '../../utils/deviceWriteTest';
import { 
  saveSessionData, 
  loadSessionData, 
  listSessions, 
  deleteSession,
  saveBaselineSnapshot,
  loadBaselineSnapshot,
  clearBaselineSnapshot,
  filterNewSinceBaseline,
  loadDeviceAnnotations,
  saveDeviceAnnotation,
  deleteDeviceAnnotation
} from '../../utils/localDataStore';
import { calculatePostureScore } from '../../utils/postureScorer';
import { 
  downloadExecutiveReport,
  generateGeoJSON,
  generateKML,
  downloadFile
} from '../../utils/reportGenerator';
import SetupGuideModal, { isWindowsPlatform, LOCAL_STORAGE_KEY_DISMISS_GUIDE } from './SetupGuideModal';
import { getDeviceProfile, hasCapability, CAPABILITIES } from '../../utils/hardwareManager';
import { identifyOS, getOsPresentation } from '../../utils/deviceFingerprinter';
import { getChannelRecommendations } from '../../utils/channelAdvisor';
import GeospatialMap from './GeospatialMap';



const POPULAR_CHANNELS = [
  // 2.4 GHz
  { ch: 1, freq: '2412 MHz', band: '2.4 GHz' },
  { ch: 6, freq: '2437 MHz', band: '2.4 GHz' },
  { ch: 11, freq: '2462 MHz', band: '2.4 GHz' },
  // 5 GHz UNII-1
  { ch: 36, freq: '5180 MHz', band: '5 GHz' },
  { ch: 40, freq: '5200 MHz', band: '5 GHz' },
  { ch: 44, freq: '5220 MHz', band: '5 GHz' },
  { ch: 48, freq: '5240 MHz', band: '5 GHz' },
  // 5 GHz UNII-2
  { ch: 52, freq: '5260 MHz', band: '5 GHz' },
  { ch: 60, freq: '5300 MHz', band: '5 GHz' },
  // 5 GHz UNII-2e
  { ch: 100, freq: '5500 MHz', band: '5 GHz' },
  { ch: 140, freq: '5700 MHz', band: '5 GHz' },
  // 5 GHz UNII-3
  { ch: 149, freq: '5745 MHz', band: '5 GHz' },
  { ch: 153, freq: '5765 MHz', band: '5 GHz' },
  { ch: 157, freq: '5785 MHz', band: '5 GHz' },
  { ch: 161, freq: '5805 MHz', band: '5 GHz' },
  { ch: 165, freq: '5825 MHz', band: '5 GHz' }
];

const ALL_SPECTRUM_CHANNELS = [
  // 2.4 GHz Channels 1 - 14
  { ch: 1, freq: '2412 MHz', band: '2.4 GHz' },
  { ch: 2, freq: '2417 MHz', band: '2.4 GHz' },
  { ch: 3, freq: '2422 MHz', band: '2.4 GHz' },
  { ch: 4, freq: '2427 MHz', band: '2.4 GHz' },
  { ch: 5, freq: '2432 MHz', band: '2.4 GHz' },
  { ch: 6, freq: '2437 MHz', band: '2.4 GHz' },
  { ch: 7, freq: '2442 MHz', band: '2.4 GHz' },
  { ch: 8, freq: '2447 MHz', band: '2.4 GHz' },
  { ch: 9, freq: '2452 MHz', band: '2.4 GHz' },
  { ch: 10, freq: '2457 MHz', band: '2.4 GHz' },
  { ch: 11, freq: '2462 MHz', band: '2.4 GHz' },
  { ch: 12, freq: '2467 MHz', band: '2.4 GHz' },
  { ch: 13, freq: '2472 MHz', band: '2.4 GHz' },
  { ch: 14, freq: '2484 MHz', band: '2.4 GHz' },
  // 5 GHz UNII Channels
  { ch: 36, freq: '5180 MHz', band: '5 GHz' },
  { ch: 40, freq: '5200 MHz', band: '5 GHz' },
  { ch: 44, freq: '5220 MHz', band: '5 GHz' },
  { ch: 48, freq: '5240 MHz', band: '5 GHz' },
  { ch: 52, freq: '5260 MHz', band: '5 GHz' },
  { ch: 56, freq: '5280 MHz', band: '5 GHz' },
  { ch: 60, freq: '5300 MHz', band: '5 GHz' },
  { ch: 64, freq: '5320 MHz', band: '5 GHz' },
  { ch: 100, freq: '5500 MHz', band: '5 GHz' },
  { ch: 104, freq: '5520 MHz', band: '5 GHz' },
  { ch: 108, freq: '5540 MHz', band: '5 GHz' },
  { ch: 112, freq: '5560 MHz', band: '5 GHz' },
  { ch: 116, freq: '5580 MHz', band: '5 GHz' },
  { ch: 120, freq: '5600 MHz', band: '5 GHz' },
  { ch: 124, freq: '5620 MHz', band: '5 GHz' },
  { ch: 128, freq: '5640 MHz', band: '5 GHz' },
  { ch: 132, freq: '5660 MHz', band: '5 GHz' },
  { ch: 136, freq: '5680 MHz', band: '5 GHz' },
  { ch: 140, freq: '5700 MHz', band: '5 GHz' },
  { ch: 144, freq: '5720 MHz', band: '5 GHz' },
  { ch: 149, freq: '5745 MHz', band: '5 GHz' },
  { ch: 153, freq: '5765 MHz', band: '5 GHz' },
  { ch: 157, freq: '5785 MHz', band: '5 GHz' },
  { ch: 161, freq: '5805 MHz', band: '5 GHz' },
  { ch: 165, freq: '5825 MHz', band: '5 GHz' }
];

const HOP_CHANNELS = [1, 6, 11, 36, 40, 44, 48];
const PCAP_MAX_CAPACITY = 50000;
const ROWS_PER_PAGE = 100;

/**
 * Lightweight SVG sparkline tracking RSSI signal trends over time.
 * Dynamic color-coding: Emerald for strong, Cyan for moderate, Rose for weak.
 */
function Sparkline({ data = [], width = 56, height = 18 }) {
  if (!data || data.length < 2) {
    return (
      <span className="text-[10px] text-slate-600 font-mono italic select-none">
        —
      </span>
    );
  }
  const min = -95;
  const max = -30;
  const range = max - min || 1;
  const padY = 2;
  const effH = height - padY * 2;
  const points = data.map((val, idx) => {
    const clamped = Math.max(min, Math.min(max, val));
    const x = (idx / (data.length - 1)) * width;
    const y = padY + effH - ((clamped - min) / range) * effH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastVal = data[data.length - 1];
  const stroke = lastVal > -60 ? '#10b981' : lastVal > -75 ? '#22d3ee' : '#f43f5e';
  const lastPoint = points.split(' ').pop().split(',');

  return (
    <svg width={width} height={height} className="overflow-visible block" title={`Signal Trend (Last ${data.length} pkts): ${data.join(', ')} dBm`}>
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2" fill={stroke} />
    </svg>
  );
}

export default function AlfaWifiWorkbench() {
  const [device, setDevice] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isSimulateRf, setIsSimulateRf] = useState(false);

  // Preference Persistence: Hydrate from localStorage
  const [channel, setChannel] = useState(() => {
    try {
      const saved = localStorage.getItem('alfa_wifi_channel');
      return saved ? parseInt(saved, 10) : 6;
    } catch { return 6; }
  });

  const [isAutoHop, setIsAutoHop] = useState(() => {
    try {
      return localStorage.getItem('alfa_wifi_auto_hop') === 'true';
    } catch { return false; }
  });

  const [sortBy, setSortBy] = useState(() => {
    try {
      return localStorage.getItem('alfa_wifi_sort_by') || 'rssi-desc';
    } catch { return 'rssi-desc'; }
  });

  const [spectrumBand, setSpectrumBand] = useState(() => {
    try {
      return localStorage.getItem('alfa_wifi_spectrum_band') || 'all';
    } catch { return 'all'; }
  });

  // Telemetry KPIs
  const [packetsPerSec, setPacketsPerSec] = useState(0);
  const [chipsetStatus, setChipsetStatus] = useState('Idle / Disconnected');

  // Aggregated data
  const [devices, setDevices] = useState({}); // APs keyed by BSSID
  const [clients, setClients] = useState({}); // Stations keyed by Client MAC
  const [frames, setFrames] = useState([]);
  const [rawHexLogs, setRawHexLogs] = useState([]);
  const [channelStats, setChannelStats] = useState({}); // Channel -> Packet Count

  // WIDS, EAPOL Handshake & Rogue AP state
  const [deauthAlert, setDeauthAlert] = useState(null);
  const [handshakeAlert, setHandshakeAlert] = useState(null);
  const [handshakes, setHandshakes] = useState({}); // Map of BSSID -> Handshake Info
  const [rogueSuspects, setRogueSuspects] = useState([]); // List of rogue AP suspect groups
  const [adapterDisconnectedAlert, setAdapterDisconnectedAlert] = useState(false);
  const [pcapBufferFull, setPcapBufferFull] = useState(false);
  const [activeTab, setActiveTab] = useState('aps'); // 'aps' | 'clients' | 'watchlist' | 'probing' | 'spectrum' | 'topology' | 'frames' | 'hex'
  const [searchQuery, setSearchQuery] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [selectedItem, setSelectedItem] = useState(null); // Item in detail panel
  const [statusMessage, setStatusMessage] = useState(null);
  const [statusLevel, setStatusLevel] = useState('info');

  // Airtime Utilization State (Rolling 1-Second Window)
  const [airtimePercent, setAirtimePercent] = useState(0);
  const simAirtimeTrackerRef = useRef(new AirtimeTracker(1000));

  // Hardware Endpoint Introspection State
  const [hardwareStatus, setHardwareStatus] = useState({
    adapterMac: '00:C0:CA:98:76:54',
    firmwareVersion: 'v2.4.1 (rtl8812au_fw)',
    chipsetModel: 'Realtek RTL8812AU (Alfa AWUS036ACH)',
    temperatureC: null,
    status: 'Idle / Disconnected',
    isIntrospected: false
  });
  const [isHardwarePanelOpen, setIsHardwarePanelOpen] = useState(false);

  // Dynamic Pre-Worker Telemetry Filtering Pipeline State
  const [isFilterPopoverOpen, setIsFilterPopoverOpen] = useState(false);
  const [filterIgnoreData, setFilterIgnoreData] = useState(() => {
    try { return localStorage.getItem('alfa_filter_ignore_data') === 'true'; } catch { return false; }
  });
  const [filterIgnoreManagement, setFilterIgnoreManagement] = useState(() => {
    try { return localStorage.getItem('alfa_filter_ignore_mgmt') === 'true'; } catch { return false; }
  });
  const [filterIgnoreControl, setFilterIgnoreControl] = useState(() => {
    try { return localStorage.getItem('alfa_filter_ignore_ctrl') === 'true'; } catch { return false; }
  });
  const [filterMac, setFilterMac] = useState(() => {
    try { return localStorage.getItem('alfa_filter_mac') || ''; } catch { return ''; }
  });

  // Layer 3 Telemetry State (ARP & DHCP IP-to-MAC Mappings)
  const [layer3Mappings, setLayer3Mappings] = useState([]);

  // Receiver (RX) Sensitivity & Baseband Gain State (Values 1 to 10)
  const [rxGain, setRxGain] = useState(() => {
    try {
      const saved = localStorage.getItem('alfa_hardware_rx_gain');
      if (saved) {
        const val = parseInt(saved, 10);
        if (!isNaN(val) && val >= 1 && val <= 10) return val;
      }
    } catch {}
    return 7;
  });

  // Action Bar Export Dropdown State
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState(false);

  // Windows Driver Onboarding Guide State
  const [isSetupGuideOpen, setIsSetupGuideOpen] = useState(false);
  const [setupGuideError, setSetupGuideError] = useState(null);
  const [showWindowsBanner, setShowWindowsBanner] = useState(() => {
    try {
      if (!isWindowsPlatform()) return false;
      return localStorage.getItem(LOCAL_STORAGE_KEY_DISMISS_GUIDE) !== 'true';
    } catch {
      return false;
    }
  });

  const handleDismissWindowsBanner = () => {
    setShowWindowsBanner(false);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY_DISMISS_GUIDE, 'true');
    } catch {}
  };

  // Hardware Abstraction Layer Active Device Profile State
  const [activeDeviceProfile, setActiveDeviceProfile] = useState(null);

  const filterSettingsRef = useRef({
    rfSensitivity: -85,
    ignoreData: false,
    ignoreManagement: false,
    ignoreControl: false,
    macFilter: '',
    macBytes: null
  });

  // Client Roaming Handoff State
  const [roamHistory, setRoamHistory] = useState([]);
  const clientApTrackingRef = useRef({});

  // Offline PCAP File Replay State
  const [replayingPcapState, setReplayingPcapState] = useState(null);
  const pcapReplayerRef = useRef(null);
  const pcapFileInputRef = useRef(null);

  // Target Watchlist State (Persisted in localStorage)
  const [watchlist, setWatchlist] = useState(() => {
    try {
      const saved = localStorage.getItem('alfa_wifi_watchlist');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Automation Rule Engine State (Persisted in localStorage)
  const [rules, setRules] = useState(() => loadRulesFromStorage());
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleEventType, setNewRuleEventType] = useState(RULE_EVENT_TYPES.DEVICE_CONNECTED);
  const [newRuleTargetMac, setNewRuleTargetMac] = useState('');
  const [newRuleActionType, setNewRuleActionType] = useState(RULE_ACTION_TYPES.NATIVE_NOTIFICATION);
  const [newRuleActionPayload, setNewRuleActionPayload] = useState('');

  useEffect(() => {
    saveRulesToStorage(rules);
  }, [rules]);

  // Connection Heartbeat & Watchdog Ref
  const lastPacketTimeRef = useRef(Date.now());
  const lastRxErrorTsRef = useRef(0);
  const [isWatchdogRecovering, setIsWatchdogRecovering] = useState(false);

  // Desktop Alerts State & Cooldown Ref (Throttled to 1/min)
  const [isDesktopAlerts, setIsDesktopAlerts] = useState(() => {
    try {
      return localStorage.getItem('alfa_wifi_desktop_alerts') === 'true';
    } catch {
      return false;
    }
  });
  const notificationCooldownRef = useRef({});

  // Baseline Snapshot & Diffing State
  const [baselineSnapshot, setBaselineSnapshot] = useState(() => {
    try {
      return loadBaselineSnapshot();
    } catch {
      return null;
    }
  });
  const [showNewSinceBaseline, setShowNewSinceBaseline] = useState(false);

  // Throughput Telemetry: Rolling PPS / BPS
  const [bytesPerSec, setBytesPerSec] = useState(0);
  const [ppsHistory, setPpsHistory] = useState(() => new Array(60).fill(0));
  const [nowTick, setNowTick] = useState(Date.now());
  const byteCountRef = useRef(0);
  const parserWorkerRef = useRef(null);

  // Geolocation & Live Wardriving GPS State
  const [isGpsTagging, setIsGpsTagging] = useState(() => {
    try {
      return localStorage.getItem('alfa_wifi_gps_tagging') === 'true';
    } catch { return false; }
  });
  const [currentGps, setCurrentGps] = useState({ latitude: null, longitude: null, accuracy: null, altitude: 0 });
  const gpsCoordsRef = useRef({ latitude: null, longitude: null, accuracy: null, altitude: 0 });
  const gpsWatchIdRef = useRef(null);

  // Safety refs for read loop, buffering & PCAP export
  const isCapturingRef = useRef(false);
  const isPausedRef = useRef(false);
  isPausedRef.current = isPaused;

  const deviceRef = useRef(device);
  deviceRef.current = device;

  const channelRef = useRef(channel);
  channelRef.current = channel;

  const pendingFramesRef = useRef([]);
  const rawPacketsRef = useRef([]); // Rolling ring buffer for PCAP export (capped at 50,000)
  const channelStatsRef = useRef({});
  const handshakeTrackerRef = useRef(new HandshakeTracker());
  const packetCountRef = useRef(0);
  const deviceCountRef = useRef(0);
  const hopIntervalRef = useRef(null);
  const isRetuningRef = useRef(false);
  // Deauth/disassoc events bucketed per victim: Map<"station|ap", number[] timestamps>
  const deauthEventsRef = useRef(new Map());
  const waterfallCountsRef = useRef({});
  const [latestWaterfallSlice, setLatestWaterfallSlice] = useState({});
  const [cleartextMetadata, setCleartextMetadata] = useState([]);

  // Live Direct-to-Disk PCAP Streaming State (File System Access API)
  const [isStreamingToDisk, setIsStreamingToDisk] = useState(false);
  const [diskStreamStats, setDiskStreamStats] = useState({ fileName: '', packetCount: 0, bytesWritten: 0 });
  const livePcapWriterRef = useRef(null);
  const isStreamingToDiskRef = useRef(false);
  isStreamingToDiskRef.current = isStreamingToDisk;

  // Custom Device Annotations & Tagging State (Persisted in localStorage)
  const [deviceAnnotations, setDeviceAnnotations] = useState(() => {
    try {
      return loadDeviceAnnotations();
    } catch {
      return {};
    }
  });
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [editNoteLabel, setEditNoteLabel] = useState('');
  const [editNoteColor, setEditNoteColor] = useState('');
  const [editNoteText, setEditNoteText] = useState('');

  // Historical Timeline Replay State
  const [isTimelineActive, setIsTimelineActive] = useState(false);
  const [timelineRange, setTimelineRange] = useState({ start: 0, end: 0 });
  const [currentSliderTime, setCurrentSliderTime] = useState(0);
  const [isTimelinePlaying, setIsTimelinePlaying] = useState(false);
  const timelineIntervalRef = useRef(null);

  // RF Sensitivity Threshold (dBm) - Persisted in localStorage (-100 to -50, default -85)
  const [rfSensitivity, setRfSensitivity] = useState(() => {
    try {
      const saved = localStorage.getItem('alfa_rf_sensitivity_threshold');
      if (saved !== null) {
        const num = parseInt(saved, 10);
        if (!isNaN(num) && num >= -100 && num <= -50) return num;
      }
    } catch { }
    return -85;
  });
  const rfSensitivityRef = useRef(rfSensitivity);
  rfSensitivityRef.current = rfSensitivity;

  const handleRfSensitivityChange = (newVal) => {
    const val = parseInt(newVal, 10);
    if (isNaN(val)) return;
    setRfSensitivity(val);
    try {
      localStorage.setItem('alfa_rf_sensitivity_threshold', val.toString());
    } catch { }
    if (parserWorkerRef.current) {
      parserWorkerRef.current.postMessage({ type: 'SET_THRESHOLD', threshold: val });
    }
  };

  // Synchronize pre-worker filterSettingsRef with active states
  useEffect(() => {
    filterSettingsRef.current = {
      rfSensitivity,
      ignoreData: filterIgnoreData,
      ignoreManagement: filterIgnoreManagement,
      ignoreControl: filterIgnoreControl,
      macFilter: filterMac.trim(),
      macBytes: parseMacToBytes(filterMac.trim())
    };
  }, [rfSensitivity, filterIgnoreData, filterIgnoreManagement, filterIgnoreControl, filterMac]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_filter_ignore_data', String(filterIgnoreData));
    } catch {}
  }, [filterIgnoreData]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_filter_ignore_mgmt', String(filterIgnoreManagement));
    } catch {}
  }, [filterIgnoreManagement]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_filter_ignore_ctrl', String(filterIgnoreControl));
    } catch {}
  }, [filterIgnoreControl]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_filter_mac', filterMac);
    } catch {}
  }, [filterMac]);

  // Infrastructure Clustering State
  const [isGroupByCluster, setIsGroupByCluster] = useState(false);
  const [expandedClusters, setExpandedClusters] = useState({});


  // Helper: Extract min/max timestamp range for device/client
  const getDeviceTimeRange = (item, baseDate = Date.now()) => {
    if (!item) return { start: Date.now(), end: Date.now() };
    let start = typeof item.firstSeenTimestamp === 'number' ? item.firstSeenTimestamp : null;
    let end = typeof item.lastSeenTimestamp === 'number' ? item.lastSeenTimestamp : null;

    if (start === null && item.firstSeen) {
      if (typeof item.firstSeen === 'number') {
        start = item.firstSeen;
      } else if (typeof item.firstSeen === 'string') {
        const parsed = Date.parse(item.firstSeen);
        if (!isNaN(parsed)) {
          start = parsed;
        } else {
          const match = item.firstSeen.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
          if (match) {
            const d = new Date(baseDate);
            d.setHours(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4] || '0', 10));
            start = d.getTime();
          }
        }
      }
    }

    if (end === null && item.lastSeen) {
      if (typeof item.lastSeen === 'number') {
        end = item.lastSeen;
      } else if (typeof item.lastSeen === 'string') {
        const parsed = Date.parse(item.lastSeen);
        if (!isNaN(parsed)) {
          end = parsed;
        } else {
          const match = item.lastSeen.match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
          if (match) {
            const d = new Date(baseDate);
            d.setHours(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), parseInt(match[4] || '0', 10));
            end = d.getTime();
          }
        }
      }
    }

    const now = Date.now();
    if (start === null && end !== null) start = end;
    if (end === null && start !== null) end = start;
    if (start === null && end === null) {
      start = now;
      end = now;
    }
    if (end < start) end = start;

    return { start, end };
  };

  // Helper: SNR Badge Styling (Green >25 dB, Yellow 15-25 dB, Red <15 dB)
  const getSnrBadge = (snr) => {
    if (snr === null || snr === undefined || isNaN(snr)) {
      return 'bg-slate-800 text-slate-500 border-slate-700';
    }
    if (snr > 25) {
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    }
    if (snr >= 15) {
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    }
    return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
  };

  // 10x Speed Timeline Playback Controller
  useEffect(() => {
    if (isTimelinePlaying) {
      timelineIntervalRef.current = setInterval(() => {
        setCurrentSliderTime(prev => {
          const step = 1000; // 100ms interval * 10x speed = 1000ms session time per tick
          const next = prev + step;
          if (next >= timelineRange.end) {
            setIsTimelinePlaying(false);
            return timelineRange.end;
          }
          return next;
        });
      }, 100);
    } else {
      if (timelineIntervalRef.current) {
        clearInterval(timelineIntervalRef.current);
        timelineIntervalRef.current = null;
      }
    }
    return () => {
      if (timelineIntervalRef.current) {
        clearInterval(timelineIntervalRef.current);
      }
    };
  }, [isTimelinePlaying, timelineRange.end]);

  // High-Frequency 100ms Waterfall Spectrogram Sampler
  useEffect(() => {
    const wfInterval = setInterval(() => {
      const counts = { ...waterfallCountsRef.current };
      waterfallCountsRef.current = {};
      setLatestWaterfallSlice(counts);
    }, 100);

    return () => clearInterval(wfInterval);
  }, []);

  // Save Preferences to LocalStorage

  useEffect(() => {
    try {
      localStorage.setItem('alfa_wifi_channel', String(channel));
    } catch {}
  }, [channel]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_wifi_auto_hop', String(isAutoHop));
    } catch {}
  }, [isAutoHop]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_wifi_sort_by', sortBy);
    } catch {}
  }, [sortBy]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_wifi_spectrum_band', spectrumBand);
    } catch {}
  }, [spectrumBand]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_wifi_gps_tagging', String(isGpsTagging));
    } catch {}
  }, [isGpsTagging]);

  useEffect(() => {
    try {
      localStorage.setItem('alfa_wifi_watchlist', JSON.stringify(watchlist));
    } catch {}
  }, [watchlist]);

  const toggleWatchlist = (mac) => {
    if (!mac) return;
    setWatchlist(prev => {
      const normalized = mac.toUpperCase();
      return prev.includes(normalized)
        ? prev.filter(m => m !== normalized)
        : [...prev, normalized];
    });
  };

  // Throttled Desktop Notification Dispatcher (Limit: 1 per minute per key)
  const sendDesktopNotification = (title, options = {}, throttleKey = null) => {
    if (!isDesktopAlerts) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const key = throttleKey || `${title}_${options.body || ''}`;
    const now = Date.now();
    const lastSent = notificationCooldownRef.current[key] || 0;

    // Cooldown check (60,000ms = 1 min)
    if (now - lastSent < 60000) {
      return;
    }

    notificationCooldownRef.current[key] = now;
    try {
      new Notification(title, options);
    } catch (err) {
      console.warn('Failed to dispatch desktop notification:', err);
    }
  };

  const handleToggleDesktopAlerts = async () => {
    if (!isDesktopAlerts) {
      if (typeof Notification !== 'undefined' && Notification.requestPermission) {
        try {
          const permission = await Notification.requestPermission();
          if (permission === 'granted') {
            setIsDesktopAlerts(true);
            try { localStorage.setItem('alfa_wifi_desktop_alerts', 'true'); } catch {}
            setStatusMessage('Desktop alerts enabled.');
            setStatusLevel('success');
          } else {
            setIsDesktopAlerts(false);
            try { localStorage.setItem('alfa_wifi_desktop_alerts', 'false'); } catch {}
            setStatusMessage('Desktop notifications permission denied in browser.');
            setStatusLevel('error');
          }
        } catch (err) {
          console.warn('Error requesting notification permission:', err);
        }
      } else {
        setStatusMessage('Desktop notifications are not supported in this browser environment.');
        setStatusLevel('info');
      }
    } else {
      setIsDesktopAlerts(false);
      try { localStorage.setItem('alfa_wifi_desktop_alerts', 'false'); } catch {}
      setStatusMessage('Desktop alerts disabled.');
      setStatusLevel('info');
    }
  };

  // Baseline Snapshot Controls
  const handleSaveBaseline = () => {
    const snapshot = saveBaselineSnapshot(devices, clients);
    setBaselineSnapshot(snapshot);
    setStatusMessage(`Baseline reference snapshot saved (${snapshot.deviceCount} APs, ${snapshot.clientCount} STAs).`);
    setStatusLevel('success');
  };

  const handleClearBaseline = () => {
    clearBaselineSnapshot();
    setBaselineSnapshot(null);
    setShowNewSinceBaseline(false);
    setStatusMessage('Baseline snapshot cleared.');
    setStatusLevel('info');
  };

  const isNewDeviceSinceBaseline = (item) => {
    if (!baselineSnapshot || !item) return false;
    const id = (item.bssid || item.clientMac || item.targetIdentifier || '').toUpperCase();
    if (id && !baselineSnapshot.knownBssids?.includes(id) && !baselineSnapshot.knownClientMacs?.includes(id)) {
      return true;
    }
    if (typeof item.firstSeenTimestamp === 'number') {
      return item.firstSeenTimestamp > (baselineSnapshot.timestamp || 0);
    }
    return false;
  };

  // Synchronize Annotation Editing with selectedItem
  useEffect(() => {
    if (selectedItem?.data) {
      const mac = (selectedItem.data.bssid || selectedItem.data.clientMac || '').toUpperCase();
      const ann = deviceAnnotations[mac];
      setEditNoteLabel(ann?.customLabel || '');
      setEditNoteColor(ann?.customColor || '');
      setEditNoteText(ann?.notes || '');
    } else {
      setIsEditingNote(false);
    }
  }, [selectedItem, deviceAnnotations]);

  const handleSaveAnnotation = () => {
    const mac = (selectedItem?.data?.bssid || selectedItem?.data?.clientMac || '').toUpperCase();
    if (!mac) return;
    const updated = saveDeviceAnnotation(mac, {
      customLabel: editNoteLabel.trim(),
      customColor: editNoteColor,
      notes: editNoteText.trim()
    });
    setDeviceAnnotations(updated);
    setIsEditingNote(false);
    setStatusMessage(`Saved annotation for ${mac}`);
    setStatusLevel('success');
  };

  const handleDeleteAnnotation = () => {
    const mac = (selectedItem?.data?.bssid || selectedItem?.data?.clientMac || '').toUpperCase();
    if (!mac) return;
    const updated = deleteDeviceAnnotation(mac);
    setDeviceAnnotations(updated);
    setEditNoteLabel('');
    setEditNoteColor('');
    setEditNoteText('');
    setIsEditingNote(false);
    setStatusMessage(`Removed annotation for ${mac}`);
    setStatusLevel('info');
  };

  const handleToggleStreamToDisk = async () => {
    if (isStreamingToDisk) {
      if (livePcapWriterRef.current) {
        try {
          const res = await livePcapWriterRef.current.close();
          setStatusMessage(`Live PCAP streaming stopped. Finalized ${res.packetCount} packets (${(res.bytesWritten / 1024).toFixed(1)} KB) directly on disk.`);
          setStatusLevel('success');
        } catch (e) {
          console.warn('Error closing PCAP stream:', e);
        }
        livePcapWriterRef.current = null;
      }
      setIsStreamingToDisk(false);
      setDiskStreamStats({ fileName: '', packetCount: 0, bytesWritten: 0 });
    } else {
      if (!LivePcapWriter.isSupported()) {
        setStatusMessage('File System Access API (showSaveFilePicker) is not supported in this browser.');
        setStatusLevel('error');
        return;
      }
      try {
        const timestampStr = new Date().toISOString().replace(/[:.]/g, '-');
        const writer = await LivePcapWriter.requestFileAndOpen(`alfa_live_${timestampStr}.pcap`);
        livePcapWriterRef.current = writer;
        setIsStreamingToDisk(true);
        setDiskStreamStats({ fileName: writer.fileName, packetCount: 0, bytesWritten: 24 });
        setStatusMessage(`Direct disk streaming initialized: ${writer.fileName} (In-memory buffer bypassed).`);
        setStatusLevel('success');
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.warn('Failed to start live disk streaming:', err);
          setStatusMessage(`Disk streaming failed: ${err.message || err}`);
          setStatusLevel('error');
        }
      }
    }
  };

  // 15. Offline PCAP File Ingestion & Forensic Replay
  const handlePcapFileUpload = async (event) => {
    const file = event.target?.files?.[0];
    if (!file) return;

    try {
      setStatusLevel('info');
      setStatusMessage(`Parsing offline PCAP capture: ${file.name}...`);
      const parsed = await readPcapFile(file);

      if (!parsed || !parsed.packets || parsed.packets.length === 0) {
        setStatusLevel('error');
        setStatusMessage(`PCAP file ${file.name} contained 0 valid packet records.`);
        return;
      }

      // If active monitoring is on, pause/stop it
      if (isMonitoring) {
        handleStopMonitor();
      }

      setReplayingPcapState({
        active: true,
        fileName: file.name,
        current: 0,
        total: parsed.packets.length,
        percent: 0,
        finished: false
      });

      // Stop previous replayer if active
      if (pcapReplayerRef.current) {
        pcapReplayerRef.current.stop();
        pcapReplayerRef.current = null;
      }

      const replayer = new PcapReplayer(parsed.packets, {
        rate: 500,
        batchSize: 50,
        onBatch: (batch) => {
          // Pre-Worker Filtering check
          const filteredBatch = batch.filter(buf => fastFilterPacket(buf, filterSettingsRef.current));
          if (filteredBatch.length === 0) return;

          // Offload to Web Worker if active
          if (parserWorkerRef.current) {
            parserWorkerRef.current.postMessage({
              type: 'PARSE_BATCH',
              buffers: filteredBatch,
              channel: channelRef.current
            });
          } else {
            // Main-thread fallback
            for (const buf of filteredBatch) {
              try {
                const parsedFrame = parse80211Frame(buf);
                if (parsedFrame) {
                  if (typeof parsedFrame.duration === 'number' && parsedFrame.duration > 0) {
                    simAirtimeTrackerRef.current.addFrame(parsedFrame.duration, Date.now());
                    setAirtimePercent(simAirtimeTrackerRef.current.getAirtime().airtimePercent);
                  }
                  if (!parsedFrame.channel) parsedFrame.channel = channelRef.current;
                  channelStatsRef.current[parsedFrame.channel] = (channelStatsRef.current[parsedFrame.channel] || 0) + 1;
                  waterfallCountsRef.current[parsedFrame.channel] = (waterfallCountsRef.current[parsedFrame.channel] || 0) + 1;
                  pendingFramesRef.current.push(parsedFrame);
                  checkDeauthAttack(parsedFrame);
                }
              } catch (e) {}
            }
          }

          // Accumulate in raw packets ref
          for (const buf of batch) {
            if (rawPacketsRef.current.length >= PCAP_MAX_CAPACITY) {
              rawPacketsRef.current.shift();
              setPcapBufferFull(true);
            }
            rawPacketsRef.current.push(buf);
            packetCountRef.current += 1;
            byteCountRef.current += buf.byteLength || buf.length || 0;
          }
          lastPacketTimeRef.current = Date.now();
        },
        onProgress: ({ current, total, percent }) => {
          setReplayingPcapState(prev => prev ? { ...prev, current, total, percent } : null);
        },
        onComplete: ({ total }) => {
          if (parserWorkerRef.current) {
            parserWorkerRef.current.postMessage({ type: 'FLUSH' });
          }
          setReplayingPcapState(prev => prev ? {
            ...prev,
            active: false,
            finished: true,
            current: total,
            percent: 100
          } : null);
          setStatusLevel('success');
          setStatusMessage(`Offline PCAP replay finished: ${total.toLocaleString()} packets successfully analyzed.`);
        },
        onError: (err) => {
          console.error('PCAP replay error:', err);
          setStatusLevel('error');
          setStatusMessage(`PCAP replay error: ${err.message || err}`);
          setReplayingPcapState(null);
        }
      });

      pcapReplayerRef.current = replayer;
      replayer.start();
    } catch (err) {
      console.error('Failed to load PCAP file:', err);
      setStatusLevel('error');
      setStatusMessage(`Failed to parse PCAP file: ${err.message || err}`);
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleStopPcapReplay = () => {
    if (pcapReplayerRef.current) {
      pcapReplayerRef.current.stop();
      pcapReplayerRef.current = null;
    }
    setReplayingPcapState(null);
    setStatusLevel('info');
    setStatusMessage('Offline PCAP replay aborted.');
  };

  // Close live PCAP writer & replayer on unmount
  useEffect(() => {
    return () => {
      if (livePcapWriterRef.current) {
        livePcapWriterRef.current.close().catch(() => {});
        livePcapWriterRef.current = null;
      }
      if (pcapReplayerRef.current) {
        pcapReplayerRef.current.stop();
        pcapReplayerRef.current = null;
      }
    };
  }, []);

  // Periodic Watchlist Missing Device Monitor (>60s Inactivity)
  useEffect(() => {
    if (!isDesktopAlerts || watchlist.length === 0) return;
    const now = Date.now();

    for (const mac of watchlist) {
      const upMac = mac.toUpperCase();
      const ap = devices[upMac] || Object.values(devices).find(d => (d.bssid || '').toUpperCase() === upMac);
      const cli = clients[upMac] || Object.values(clients).find(c => (c.clientMac || '').toUpperCase() === upMac);
      const node = ap || cli;

      if (node && node.lastSeen) {
        let isMissing = false;
        if (typeof node.firstSeenTimestamp === 'number' && typeof node.lastSeenTimestamp === 'number') {
          if (now - node.lastSeenTimestamp > 60000) isMissing = true;
        }
        if (!isMissing) {
          const parts = node.lastSeen.split(/[:.]/);
          if (parts.length >= 3) {
            const lastSeenDate = new Date();
            lastSeenDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3] || 0, 10));
            if (now - lastSeenDate.getTime() > 60000) {
              isMissing = true;
            }
          }
        }

        if (isMissing) {
          const vendor = node.vendor || getVendor(upMac);
          const vendorLabel = vendor && vendor !== 'Unknown' && vendor !== 'Unknown OUI' ? ` (${vendor})` : '';
          sendDesktopNotification("Device Missing", {
            body: `Watchlist device ${upMac}${vendorLabel} is no longer in range.`
          }, `missing_${upMac}`);
          evaluateAndExecuteRules(rulesRef.current, node, RULE_EVENT_TYPES.DEVICE_DISCONNECTED);
        }
      }
    }
  }, [nowTick, watchlist, isDesktopAlerts, devices, clients]);

  // Geolocation API: Watch Position
  useEffect(() => {
    if (isGpsTagging) {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          gpsWatchIdRef.current = navigator.geolocation.watchPosition(
            (pos) => {
              if (pos && pos.coords) {
                const coords = {
                  latitude: pos.coords.latitude,
                  longitude: pos.coords.longitude,
                  accuracy: pos.coords.accuracy,
                  altitude: pos.coords.altitude || 0
                };
                gpsCoordsRef.current = coords;
                setCurrentGps(coords);
              }
            },
            (err) => {
              console.warn('Geolocation error:', err?.message);
              setStatusMessage(`GPS notice: ${err?.message || 'Position unavailable'}`);
              setStatusLevel('info');
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
          );
        } catch (e) {
          console.warn('Geolocation exception:', e);
        }
      } else {
        setStatusMessage('Geolocation API is not supported in this browser environment.');
        setStatusLevel('info');
      }
    } else {
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        } catch {}
        gpsWatchIdRef.current = null;
      }
      gpsCoordsRef.current = { latitude: null, longitude: null, accuracy: null, altitude: 0 };
      setCurrentGps({ latitude: null, longitude: null, accuracy: null, altitude: 0 });
    }

    return () => {
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        try {
          navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        } catch {}
        gpsWatchIdRef.current = null;
      }
    };
  }, [isGpsTagging]);



  // 1. Throttling Flush: updates React state with dynamic throttle (500ms -> 1500ms when >200 devices)
  useEffect(() => {
    let timerId = null;

    const flush = () => {
      const pending = pendingFramesRef.current;
      if (pending.length > 0) {
        pendingFramesRef.current = [];

        // Flush channel utilization and handshake state
        setChannelStats({ ...channelStatsRef.current });
        setHandshakes({ ...handshakeTrackerRef.current.handshakes });

        // Update Layer 3 mappings from pending frames
        for (const frame of pending) {
          if (frame && frame.l3Metadata) {
            const m = frame.l3Metadata;
            setLayer3Mappings(prev => {
              const next = [...prev];
              const idx = next.findIndex(item => item.mac === m.mac && item.ip === m.ip);
              const entry = {
                id: `${m.mac}-${m.ip}`,
                mac: m.mac,
                ip: m.ip,
                hostname: m.hostname || null,
                protocol: m.protocol,
                bssid: frame.bssid || '—',
                channel: frame.channel || channelRef.current,
                vendor: lookupVendor(m.mac),
                lastSeen: frame.lastSeen || frame.timestamp || new Date().toLocaleTimeString()
              };
              if (idx >= 0) {
                next[idx] = { ...next[idx], ...entry, hostname: entry.hostname || next[idx].hostname };
              } else {
                next.unshift(entry);
              }
              return next.slice(0, 500);
            });
          }
        }

        // Update APs dictionary
        setDevices(prevDevices => {
          const nextDevices = { ...prevDevices };
          for (const frame of pending) {
            if (!frame || !frame.bssid || frame.bssid === 'FF:FF:FF:FF:FF:FF' || frame.bssid === '00:00:00:00:00:00') {
              continue;
            }
            const existing = nextDevices[frame.bssid];
            const hasHs = handshakeTrackerRef.current.hasHandshake(frame.bssid);
            const currentRssi = frame.rssi || existing?.rssi || -60;
            const existingHistory = existing?.rssiHistory || [];
            const nextHistory = [...existingHistory, currentRssi].slice(-15);

            const isFrameHidden = !frame.ssid || frame.ssid === '<Hidden SSID>' || frame.ssid === '<Unknown>';
            const currentGps = gpsCoordsRef.current;
            const resolvedIp = frame.ipAddress || (frame.l3Metadata?.mac === frame.bssid ? frame.l3Metadata.ip : (existing?.ipAddress || null));

            if (existing) {
              const keepSsid = (existing.ssid && existing.ssid !== '<Hidden SSID>' && existing.ssid !== '<Unknown>')
                ? existing.ssid
                : (!isFrameHidden ? frame.ssid : existing.ssid);

              nextDevices[frame.bssid] = {
                ...existing,
                ssid: keepSsid,
                security: frame.security || existing.security,
                isMixedMode: Boolean(existing.isMixedMode || frame.isMixedMode),
                roaming: {
                  k: Boolean(existing.roaming?.k || frame.roaming?.k),
                  v: Boolean(existing.roaming?.v || frame.roaming?.v),
                  r: Boolean(existing.roaming?.r || frame.roaming?.r)
                },
                mfp: frame.mfp || existing.mfp || null,
                isMfpCapable: Boolean(existing.isMfpCapable || frame.isMfpCapable),
                isMfpRequired: Boolean(existing.isMfpRequired || frame.isMfpRequired),
                isWifi6: Boolean(existing.isWifi6 || frame.isWifi6),
                heCapabilities: frame.heCapabilities || existing.heCapabilities || null,
                bssColor: (frame.bssColor !== undefined && frame.bssColor !== null) ? frame.bssColor : (existing.bssColor ?? null),
                bssColorDisabled: (frame.bssColorDisabled !== undefined && frame.bssColorDisabled !== null) ? frame.bssColorDisabled : (existing.bssColorDisabled ?? false),
                rssi: currentRssi,
                noiseFloor: (frame.noiseFloor !== null && frame.noiseFloor !== undefined) ? frame.noiseFloor : existing.noiseFloor,
                snr: (frame.snr !== null && frame.snr !== undefined) ? frame.snr : (existing.snr !== undefined ? existing.snr : (currentRssi != null && existing.noiseFloor != null ? currentRssi - existing.noiseFloor : null)),
                rssiHistory: nextHistory,
                channel: frame.channel || existing.channel,
                firstSeenTimestamp: existing.firstSeenTimestamp || Date.now(),
                lastSeen: frame.lastSeen || frame.timestamp || existing.lastSeen,
                lastSeenTimestamp: Date.now(),
                packetCount: (existing.packetCount || 1) + 1,
                vendor: frame.vendor || existing.vendor,
                type: frame.type || existing.type,
                hasHandshake: existing.hasHandshake || hasHs,
                originalHidden: Boolean(existing.originalHidden || (isFrameHidden && !existing.unmaskedSsid)),
                latitude: existing.latitude ?? currentGps?.latitude ?? null,
                longitude: existing.longitude ?? currentGps?.longitude ?? null,
                accuracy: existing.accuracy ?? currentGps?.accuracy ?? null,
                altitude: existing.altitude ?? currentGps?.altitude ?? null,
                ipAddress: resolvedIp
              };
            } else {
              const newAp = {
                bssid: frame.bssid,
                sourceMac: frame.sourceMac || frame.source,
                ssid: frame.ssid || '<Unknown>',
                security: frame.security || 'Open',
                isMixedMode: Boolean(frame.isMixedMode),
                isWifi6: Boolean(frame.isWifi6),
                heCapabilities: frame.heCapabilities || null,
                bssColor: (frame.bssColor !== undefined && frame.bssColor !== null) ? frame.bssColor : null,
                bssColorDisabled: Boolean(frame.bssColorDisabled),
                roaming: frame.roaming || { k: false, v: false, r: false },
                mfp: frame.mfp || null,
                isMfpCapable: Boolean(frame.isMfpCapable),
                isMfpRequired: Boolean(frame.isMfpRequired),
                rssi: currentRssi,
                noiseFloor: (frame.noiseFloor !== null && frame.noiseFloor !== undefined) ? frame.noiseFloor : null,
                snr: (frame.snr !== null && frame.snr !== undefined) ? frame.snr : null,
                rssiHistory: [currentRssi],
                channel: frame.channel || channelRef.current,
                firstSeen: frame.timestamp,
                firstSeenTimestamp: Date.now(),
                lastSeen: frame.lastSeen || frame.timestamp,
                lastSeenTimestamp: Date.now(),
                packetCount: 1,
                vendor: frame.vendor || getVendor(frame.bssid),
                type: frame.type || 'Management',
                hasHandshake: hasHs,
                originalHidden: isFrameHidden,
                latitude: currentGps?.latitude ?? null,
                longitude: currentGps?.longitude ?? null,
                accuracy: currentGps?.accuracy ?? null,
                altitude: currentGps?.altitude ?? null,
                ipAddress: resolvedIp
              };
              evaluateAndExecuteRules(rulesRef.current, newAp, RULE_EVENT_TYPES.DEVICE_CONNECTED);
              nextDevices[frame.bssid] = newAp;
            }
          }

          // Also map any direct L3 sender MAC to AP if matching
          for (const frame of pending) {
            if (frame?.l3Metadata?.mac && nextDevices[frame.l3Metadata.mac]) {
              nextDevices[frame.l3Metadata.mac].ipAddress = frame.l3Metadata.ip;
            }
          }

          // Correlate undisclosed / hidden AP SSIDs using discovery queries & association frames
          for (const frame of pending) {
            correlateHiddenAp(nextDevices, frame);
          }

          // Run Rogue AP / Evil Twin heuristics across discovered APs
          const { rogueSuspects: detectedRogues, flaggedBssids } = detectRogueAps(nextDevices);
          setRogueSuspects(detectedRogues);
          for (const bssid of Object.keys(nextDevices)) {
            if (flaggedBssids[bssid]) {
              nextDevices[bssid].isRogueSuspect = true;
              nextDevices[bssid].rogueReason = flaggedBssids[bssid].reason;
              evaluateAndExecuteRules(rulesRef.current, { bssid, ssid: nextDevices[bssid].ssid, reason: flaggedBssids[bssid].reason }, RULE_EVENT_TYPES.ANOMALY_DETECTED);
            } else {
              nextDevices[bssid].isRogueSuspect = false;
              nextDevices[bssid].rogueReason = null;
            }
          }

          deviceCountRef.current = Object.keys(nextDevices).length;
          return nextDevices;
        });

        // Update Clients dictionary (Station tracking)
        setClients(prevClients => {
          const nextClients = { ...prevClients };
          const currentGps = gpsCoordsRef.current;
          for (const frame of pending) {
            if (!frame || !frame.stationMac || frame.stationMac === 'FF:FF:FF:FF:FF:FF' || frame.stationMac === '00:00:00:00:00:00') {
              continue;
            }
            const existing = nextClients[frame.stationMac];
            const associatedBssid = (frame.bssid && frame.bssid !== 'FF:FF:FF:FF:FF:FF' && frame.bssid !== '00:00:00:00:00:00')
              ? frame.bssid
              : (existing?.bssid || 'Probing / Unassociated');

            const currentRssi = frame.rssi || existing?.rssi || -60;
            const existingHistory = existing?.rssiHistory || [];
            const nextHistory = [...existingHistory, currentRssi].slice(-15);

            const existingProbes = existing?.probedSsids || (existing?.probedSsid ? [existing.probedSsid] : []);
            const nextProbes = [...existingProbes];
            if (frame.ssid && frame.ssid !== '<Wildcard Probe>' && frame.ssid !== '<Hidden SSID>' && frame.ssid !== '<Unknown>' && frame.ssid !== '-') {
              if (!nextProbes.includes(frame.ssid)) {
                nextProbes.push(frame.ssid);
              }
            }
            const isProbing = Boolean(existing?.isProbing || frame.type === 'Probe Req' || nextProbes.length > 0);

            const clientIp = frame.ipAddress || (frame.l3Metadata?.mac === frame.stationMac ? frame.l3Metadata.ip : (existing?.ipAddress || null));
            const clientHost = frame.dhcpHostname || (frame.l3Metadata?.mac === frame.stationMac ? frame.l3Metadata.hostname : (existing?.dhcpHostname || null));

            if (existing) {
              nextClients[frame.stationMac] = {
                ...existing,
                bssid: associatedBssid,
                rssi: currentRssi,
                noiseFloor: (frame.noiseFloor !== null && frame.noiseFloor !== undefined) ? frame.noiseFloor : existing.noiseFloor,
                snr: (frame.snr !== null && frame.snr !== undefined) ? frame.snr : (existing.snr !== undefined ? existing.snr : (currentRssi != null && existing.noiseFloor != null ? currentRssi - existing.noiseFloor : null)),
                rssiHistory: nextHistory,
                channel: frame.channel || existing.channel,
                firstSeenTimestamp: existing.firstSeenTimestamp || Date.now(),
                lastSeen: frame.lastSeen || frame.timestamp || existing.lastSeen,
                lastSeenTimestamp: Date.now(),
                packetCount: (existing.packetCount || 1) + 1,
                vendor: frame.vendor || existing.vendor,
                probedSsid: frame.ssid && frame.ssid !== '<Wildcard Probe>' && frame.ssid !== '<Unknown>' ? frame.ssid : existing.probedSsid,
                probedSsids: nextProbes,
                signature: frame.signature || existing.signature || null,
                tagSequence: frame.tagSequence || existing.tagSequence || [],
                isProbing,
                latitude: existing.latitude ?? currentGps?.latitude ?? null,
                longitude: existing.longitude ?? currentGps?.longitude ?? null,
                accuracy: existing.accuracy ?? currentGps?.accuracy ?? null,
                ipAddress: clientIp,
                dhcpHostname: clientHost
              };
            } else {
              const newCli = {
                clientMac: frame.stationMac,
                bssid: associatedBssid,
                rssi: currentRssi,
                noiseFloor: (frame.noiseFloor !== null && frame.noiseFloor !== undefined) ? frame.noiseFloor : null,
                snr: (frame.snr !== null && frame.snr !== undefined) ? frame.snr : null,
                rssiHistory: [currentRssi],
                channel: frame.channel || channelRef.current,
                firstSeen: frame.timestamp,
                firstSeenTimestamp: Date.now(),
                lastSeen: frame.lastSeen || frame.timestamp,
                lastSeenTimestamp: Date.now(),
                packetCount: 1,
                vendor: frame.vendor || getVendor(frame.stationMac),
                probedSsid: frame.ssid || null,
                probedSsids: nextProbes,
                signature: frame.signature || null,
                tagSequence: frame.tagSequence || [],
                isProbing,
                latitude: currentGps?.latitude ?? null,
                longitude: currentGps?.longitude ?? null,
                accuracy: currentGps?.accuracy ?? null,
                ipAddress: clientIp,
                dhcpHostname: clientHost
              };
              evaluateAndExecuteRules(rulesRef.current, newCli, RULE_EVENT_TYPES.DEVICE_CONNECTED);
              nextClients[frame.stationMac] = newCli;
            }
          }

          // Also map any direct L3 sender MAC to Client if matching
          for (const frame of pending) {
            if (frame?.l3Metadata?.mac && nextClients[frame.l3Metadata.mac]) {
              nextClients[frame.l3Metadata.mac].ipAddress = frame.l3Metadata.ip;
              if (frame.l3Metadata.hostname) {
                nextClients[frame.l3Metadata.mac].dhcpHostname = frame.l3Metadata.hostname;
              }
            }
          }
          return nextClients;
        });

        // Track Client Roaming Handoffs
        const newRoams = [];
        const currentNowTs = Date.now();
        for (const frame of pending) {
          if (!frame || !frame.stationMac || frame.stationMac === 'FF:FF:FF:FF:FF:FF' || frame.stationMac === '00:00:00:00:00:00') {
            continue;
          }
          const isDataOrAssoc = frame.frameCategory === 'Data' || frame.type === 'Data' || frame.type === 'QoS Data' || frame.type === 'Reassoc Req';
          const targetBssid = (frame.bssid && frame.bssid !== 'FF:FF:FF:FF:FF:FF' && frame.bssid !== '00:00:00:00:00:00') ? frame.bssid : null;

          if (isDataOrAssoc && targetBssid) {
            const clientMac = frame.stationMac.toUpperCase();
            const prev = clientApTrackingRef.current[clientMac];
            const frameTs = typeof frame.timestampTs === 'number' ? frame.timestampTs : currentNowTs;

            if (prev && prev.bssid && prev.bssid.toUpperCase() !== targetBssid.toUpperCase()) {
              const roamTimeMs = Math.max(1, frameTs - prev.lastSeenTs);
              if (roamTimeMs <= 30000) { // within last 30 seconds
                newRoams.push({
                  id: `roam_${currentNowTs}_${Math.random().toString(36).substr(2, 6)}`,
                  clientMac: frame.stationMac,
                  fromBssid: prev.bssid,
                  toBssid: targetBssid,
                  roamTime: roamTimeMs,
                  timestamp: frame.timestamp || frame.lastSeen || new Date().toLocaleTimeString(),
                  channel: frame.channel || channelRef.current
                });
              }
            }

            clientApTrackingRef.current[clientMac] = {
              bssid: targetBssid,
              lastSeenTs: frameTs,
              lastSeenTimeStr: frame.timestamp || frame.lastSeen
            };
          }
        }

        if (newRoams.length > 0) {
          setRoamHistory(prev => [...newRoams, ...prev].slice(0, 500));
        }

        setFrames(prev => [...pending.slice(-100), ...prev].slice(0, 500));
        setRawHexLogs(prev => [
          ...pending.slice(-30).map(f => `[${f.timestamp || f.lastSeen}] CH ${f.channel} | ${f.type} | RSSI: ${f.rssi}dBm | ${f.stationMac ? `STA: ${f.stationMac} -> ` : ''}BSSID: ${f.bssid}`),
          ...prev
        ].slice(0, 200));

        // Collect observed cleartext DNS and HTTP metadata streams
        const newMetadata = pending
          .filter(f => f && f.cleartextMetadata)
          .map(f => f.cleartextMetadata);
        if (newMetadata.length > 0) {
          setCleartextMetadata(prev => [...newMetadata, ...prev].slice(0, 300));
        }
      }

      // Adaptive throttle: if total tracked devices exceed 200, flush state every 1500ms to eliminate UI stutter
      const nextDelay = deviceCountRef.current > 200 ? 1500 : 500;
      timerId = setTimeout(flush, nextDelay);
    };

    timerId = setTimeout(flush, 500);
    return () => {
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  // 2. PPS & Throughput Telemetry Calculation Loop (Rolling 60s)
  useEffect(() => {
    const ppsInterval = setInterval(() => {
      const currentPps = packetCountRef.current;
      const currentBps = byteCountRef.current;
      packetCountRef.current = 0;
      byteCountRef.current = 0;

      setPacketsPerSec(currentPps);
      setBytesPerSec(currentBps);
      setPpsHistory(prev => [...prev.slice(1), currentPps]);
      setNowTick(Date.now());
    }, 1000);

    return () => clearInterval(ppsInterval);
  }, []);

  // 3. Auto-Hop Channel Loop
  useEffect(() => {
    if (hopIntervalRef.current) {
      clearInterval(hopIntervalRef.current);
      hopIntervalRef.current = null;
    }

    if (isAutoHop && (isMonitoring || isSimulateRf)) {
      let hopIndex = 0;
      hopIntervalRef.current = setInterval(async () => {
        if (isRetuningRef.current) return;
        hopIndex = (hopIndex + 1) % HOP_CHANNELS.length;
        const nextCh = HOP_CHANNELS[hopIndex];
        
        channelRef.current = nextCh;
        setChannel(nextCh);

        if (isConnected && deviceRef.current) {
          try {
            isRetuningRef.current = true;
            await retuneChannel(deviceRef.current, nextCh, 20, 0);
          } catch (e) {
            console.warn('Auto-hop retune failed:', e);
          } finally {
            isRetuningRef.current = false;
          }
        }
      }, 500);
    }

    return () => {
      if (hopIntervalRef.current) {
        clearInterval(hopIntervalRef.current);
        hopIntervalRef.current = null;
      }
    };
  }, [isAutoHop, isMonitoring, isConnected, isSimulateRf]);

  // 4. WIDS Check Helper
  // Highest standard 802.11 reason code is in the 60s; attacks use low codes (1, 7).
  const MAX_VALID_DEAUTH_REASON = 66;
  const DEAUTH_FLOOD_THRESHOLD = 12; // frames to one victim within the window
  const checkDeauthAttack = (frame) => {
    if (!frame.isDeauth) return;

    // Reject corrupted frames. accept-bad-FCS lets malformed frames through, and a
    // genuine deauth/disassoc always carries a defined reason code — a garbage code
    // (e.g. 40634) means the frame is noise, not an attack.
    if (frame.reasonCode == null || frame.reasonCode < 1 || frame.reasonCode > MAX_VALID_DEAUTH_REASON) {
      return;
    }

    // Count per victim (station + AP), not globally — otherwise ordinary disassoc /
    // band-steering traffic across many networks in a dense area trips the threshold.
    const target = frame.stationMac || frame.destinationMac;
    const ap = frame.bssid;
    if (!target || !ap || target === 'Broadcast') return;

    const key = `${target}|${ap}`;
    const nowTs = Date.now();
    const events = deauthEventsRef.current;
    const recent = (events.get(key) || []).filter(t => nowTs - t <= 5000);
    recent.push(nowTs);
    events.set(key, recent);

    // Opportunistically prune other stale buckets so the map does not grow unbounded
    if (events.size > 256) {
      for (const [k, ts] of events) {
        if (!ts.some(t => nowTs - t <= 5000)) events.delete(k);
      }
    }

    if (recent.length >= DEAUTH_FLOOD_THRESHOLD) {
      const anomalyPayload = {
        count: recent.length,
        target,
        ap,
        reason: frame.reasonDescription || 'Deauthentication flood',
        timestamp: frame.timestamp
      };

      setDeauthAlert(anomalyPayload);

      sendDesktopNotification("Anomaly Detected", {
        body: "Unusual volume of link-state frames detected."
      }, "wids_link_state_anomaly");

      evaluateAndExecuteRules(rulesRef.current, anomalyPayload, RULE_EVENT_TYPES.ANOMALY_DETECTED);
    }
  };

  // 4b. Hardware Heartbeat Watchdog & Autonomous Reconnect
  useEffect(() => {
    if (!isConnected || !isMonitoring || isPaused || isSimulateRf || replayingPcapState?.active) {
      return;
    }

    const watchdogInterval = setInterval(async () => {
      if (isWatchdogRecovering) return;
      const elapsed = Date.now() - lastPacketTimeRef.current;
      if (elapsed > 5000) {
        setIsWatchdogRecovering(true);
        setStatusLevel('warning');
        setStatusMessage('Hardware unresponsive. Attempting to reconnect...');

        try {
          // Attempt soft retune on current radio instance
          if (deviceRef.current && typeof deviceRef.current.retune === 'function') {
            await deviceRef.current.retune(channelRef.current);
            lastPacketTimeRef.current = Date.now();
            setStatusMessage('No packets received — re-tuned radio, still waiting for RX data. Check channel, antenna, or driver support.');
            setStatusLevel('warning');
            setIsWatchdogRecovering(false);
            return;
          }

          // If radio instance lost, try to re-initialize with granted WebUSB device
          if (typeof navigator !== 'undefined' && navigator.usb) {
            const grantedDevices = await navigator.usb.getDevices();
            const targetDev = grantedDevices.find(d => 
              (activeDeviceProfile && d.vendorId === activeDeviceProfile.vendorId && d.productId === activeDeviceProfile.productId) ||
              (deviceRef.current && d.vendorId === deviceRef.current.vendorId && d.productId === deviceRef.current.productId)
            );
            if (targetDev) {
              await targetDev.open();
              if (targetDev.configuration === null) {
                await targetDev.selectConfiguration(1);
              }
              await targetDev.claimInterface(0);
              lastPacketTimeRef.current = Date.now();
              setStatusMessage('Hardware reconnected via WebUSB handle.');
              setStatusLevel('success');
              setIsWatchdogRecovering(false);
              return;
            }
          }
        } catch (recErr) {
          console.warn('Watchdog auto-reconnect failed:', recErr);
        }

        // Recovery failed - gracefully reset UI to Disconnected state
        await handleDisconnect();
        setStatusMessage('Hardware unresponsive. Device disconnected.');
        setStatusLevel('error');
        setIsWatchdogRecovering(false);
      }
    }, 2000);

    return () => clearInterval(watchdogInterval);
  }, [isConnected, isMonitoring, isPaused, isSimulateRf, replayingPcapState, activeDeviceProfile, isWatchdogRecovering]);

  // 5. RF Simulation Ingestion Loop
  useEffect(() => {
    let simInterval = null;
    if (isSimulateRf && isMonitoring && !isPaused) {
      setChipsetStatus('RTL8812AU (Simulated)');
      setHardwareStatus({
        adapterMac: '00:C0:CA:98:76:54',
        firmwareVersion: 'v2.4.1 (Simulated)',
        chipsetModel: 'Realtek RTL8812AU (Alfa AWUS036ACH)',
        temperatureC: 41,
        status: 'Active (Simulated)',
        isIntrospected: true
      });
      let mockIndex = 0;

      simInterval = setInterval(() => {
        const baseFrame = MOCK_WIFI_FRAMES[mockIndex % MOCK_WIFI_FRAMES.length];
        mockIndex++;

        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
        const jitterRssi = baseFrame.rssi + Math.floor(Math.random() * 5) - 2;
        if (jitterRssi < rfSensitivityRef.current) {
          return;
        }

        const simulatedFrame = {
          ...baseFrame,
          timestamp: timeStr,
          lastSeen: timeStr,
          rssi: jitterRssi,
          channel: channelRef.current
        };

        // Convert mock rawHex to Uint8Array for PCAP buffer with strict ring buffer cap
        if (baseFrame.rawHex) {
          const hexBytes = baseFrame.rawHex.split(' ').map(h => parseInt(h, 16));
          const fakePkt = new Uint8Array([0x00, 0x00, 0x04, 0x00, ...hexBytes]);
          
          // Pre-Worker Filtering Pipeline check for simulated frames
          if (!fastFilterPacket(fakePkt, filterSettingsRef.current)) {
            return;
          }

          if (isStreamingToDiskRef.current && livePcapWriterRef.current?.isOpen) {
            livePcapWriterRef.current.writePacket(fakePkt);
            setDiskStreamStats({
              fileName: livePcapWriterRef.current.fileName,
              packetCount: livePcapWriterRef.current.packetCount,
              bytesWritten: livePcapWriterRef.current.bytesWritten
            });
          } else {
            if (rawPacketsRef.current.length >= PCAP_MAX_CAPACITY) {
              rawPacketsRef.current.shift(); // Strict ring buffer: overwrite oldest
              setPcapBufferFull(true);
            }
            rawPacketsRef.current.push(fakePkt);
          }

          // EAPOL Handshake detection
          const hsRes = handshakeTrackerRef.current.processPacket(fakePkt, simulatedFrame);
          if (hsRes && hsRes.isNewComplete) {
            setHandshakeAlert(hsRes);
            playHandshakeChime();
          }
        }

        // Airtime calculation for simulation
        simAirtimeTrackerRef.current.addFrame(baseFrame.duration || 320, Date.now());
        setAirtimePercent(simAirtimeTrackerRef.current.getAirtime().airtimePercent);

        channelStatsRef.current[simulatedFrame.channel] = (channelStatsRef.current[simulatedFrame.channel] || 0) + 1;
        waterfallCountsRef.current[simulatedFrame.channel] = (waterfallCountsRef.current[simulatedFrame.channel] || 0) + 1;
        packetCountRef.current += 1;
        lastPacketTimeRef.current = Date.now();
        pendingFramesRef.current.push(simulatedFrame);
        checkDeauthAttack(simulatedFrame);
      }, 250);
    }

    return () => {
      if (simInterval) clearInterval(simInterval);
    };
  }, [isSimulateRf, isMonitoring, isPaused]);

  // 6. Connect Hardware via WebUSB
  const handleConnect = async () => {
    setStatusMessage(null);
    setAdapterDisconnectedAlert(false);

    // Instantly clear any active channel hopping interval
    if (hopIntervalRef.current) {
      clearInterval(hopIntervalRef.current);
      hopIntervalRef.current = null;
    }
    setIsAutoHop(false);

    if (!navigator.usb) {
      setStatusLevel('error');
      setStatusMessage('WebUSB is not supported in this browser. Please use Chrome, Edge, or Chromium.');
      return;
    }

    try {
      setChipsetStatus('Requesting WebUSB...');
      const dev = await connectAlfaDevice();
      setDevice(dev);
      deviceRef.current = dev;
      setIsConnected(true);
      const profile = dev.profile || getDeviceProfile(dev.vendorId, dev.productId);
      setActiveDeviceProfile(profile);
      const model = profile.chipsetName || dev.chipsetModel || identifyChipsetModel(dev) || 'RTL8812AU';
      setChipsetStatus(`Connected: ${model}`);

      // Query Hardware Endpoint Introspection
      try {
        const intro = await queryHardwareIntrospection(dev, dev.device);
        setHardwareStatus(intro);
      } catch (introErr) {
        console.warn('Hardware introspection notice:', introErr);
      }

      setStatusLevel('success');
      setStatusMessage(`${model} adapter connected via WebUSB.`);
    } catch (err) {
      console.warn('Alfa connect error:', err);
      const msg = (err && (err.message || String(err))) || '';
      const lower = msg.toLowerCase();
      if (err.name === 'NotFoundError') {
        setStatusLevel('info');
        setStatusMessage('Device selection prompt cancelled.');
        setChipsetStatus('Idle / Disconnected');
      } else if (
        err.name === 'SecurityError' ||
        err.name === 'NetworkError' ||
        lower.includes('claim') ||
        lower.includes('access denied') ||
        // nusb / wasm WebUSB bring-up failures: the browser could not open or
        // claim the adapter's interface (the generic "nusb from_js failed:
        // WebUSB error"). On Windows this is almost always the driver binding.
        lower.includes('nusb') ||
        lower.includes('webusb error') ||
        lower.includes('from_js') ||
        lower.includes('unable to claim') ||
        lower.includes('transfer')
      ) {
        const driverErrMsg = 'Could not claim the adapter over WebUSB. On Windows the RTL8812AU must be bound to the WinUSB driver using Zadig (it replaces the native Realtek driver). Also make sure no other tab or app is currently using the adapter.';
        setStatusLevel('error');
        setStatusMessage(driverErrMsg);
        setChipsetStatus('Driver Setup Required');
        setSetupGuideError(`${driverErrMsg}\n\nOriginal error: ${msg}`);
        setIsSetupGuideOpen(true);
      } else {
        setStatusLevel('error');
        setStatusMessage(`Connection failed: ${msg}`);
        setChipsetStatus('Error');
      }
    }
  };

  // 7. Disconnect Hardware
  const handleDisconnect = async () => {
    isCapturingRef.current = false;
    setIsMonitoring(false);
    setIsPaused(false);
    setIsAutoHop(false);
    setActiveDeviceProfile(null);

    if (hopIntervalRef.current) {
      clearInterval(hopIntervalRef.current);
      hopIntervalRef.current = null;
    }

    if (device) {
      try {
        if (typeof device.shutdownMonitor === 'function') {
          await device.shutdownMonitor();
        }
        if (typeof device.free === 'function') {
          device.free();
        }
      } catch (e) {
        console.warn('Device cleanup error:', e);
      }
    }

    if (parserWorkerRef.current) {
      parserWorkerRef.current.terminate();
      parserWorkerRef.current = null;
    }

    setDevice(null);
    deviceRef.current = null;
    setIsConnected(false);
    setChipsetStatus('Disconnected');
    setAirtimePercent(0);
    setHardwareStatus({
      adapterMac: '00:C0:CA:98:76:54',
      firmwareVersion: 'v2.4.1 (rtl8812au_fw)',
      chipsetModel: 'Realtek RTL8812AU (Alfa AWUS036ACH)',
      temperatureC: null,
      status: 'Disconnected',
      isIntrospected: false
    });
    setStatusLevel('info');
    setStatusMessage('Adapter disconnected.');
  };

  // Terminate Web Worker on unmount
  useEffect(() => {
    return () => {
      if (parserWorkerRef.current) {
        parserWorkerRef.current.terminate();
        parserWorkerRef.current = null;
      }
    };
  }, []);

  // 8. Robust Asynchronous Read Loop (Web Worker Offload)
  const startRxLoop = async (radio) => {
    isCapturingRef.current = true;

    // Instantiate parser worker if supported
    if (!parserWorkerRef.current && typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(new URL('../../workers/parserWorker.js', import.meta.url), { type: 'module' });
        worker.onmessage = (e) => {
          if (e.data && e.data.type === 'BATCH_PARSED') {
            if (typeof e.data.airtimePercent === 'number') {
              setAirtimePercent(e.data.airtimePercent);
            }
            if (Array.isArray(e.data.layer3Mappings) && e.data.layer3Mappings.length > 0) {
              setLayer3Mappings(prev => {
                const next = [...prev];
                for (const m of e.data.layer3Mappings) {
                  const idx = next.findIndex(item => item.mac === m.mac && item.ip === m.ip);
                  const entry = {
                    id: `${m.mac}-${m.ip}`,
                    mac: m.mac,
                    ip: m.ip,
                    hostname: m.hostname || null,
                    protocol: m.protocol,
                    bssid: m.bssid || '—',
                    channel: m.channel || channelRef.current,
                    vendor: lookupVendor(m.mac),
                    lastSeen: m.timestamp || new Date().toLocaleTimeString()
                  };
                  if (idx >= 0) {
                    next[idx] = { ...next[idx], ...entry, hostname: entry.hostname || next[idx].hostname };
                  } else {
                    next.unshift(entry);
                  }
                }
                return next.slice(0, 500);
              });
            }
            if (Array.isArray(e.data.frames)) {
              for (const parsed of e.data.frames) {
                if (parsed) {
                  if (!parsed.channel) parsed.channel = channelRef.current;
                  channelStatsRef.current[parsed.channel] = (channelStatsRef.current[parsed.channel] || 0) + 1;
                  waterfallCountsRef.current[parsed.channel] = (waterfallCountsRef.current[parsed.channel] || 0) + 1;
                  pendingFramesRef.current.push(parsed);
                  checkDeauthAttack(parsed);
                }
              }
            }
          }
        };
        parserWorkerRef.current = worker;
        worker.postMessage({ type: 'SET_THRESHOLD', threshold: rfSensitivityRef.current });
      } catch (workerErr) {
        console.warn('Could not initialize parser Web Worker, falling back to main thread:', workerErr);
      }
    }

    while (isCapturingRef.current && deviceRef.current) {
      if (isPausedRef.current) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }

      try {
        const rawTransfer = await radio.readRxTransfer(32768);
        if (rawTransfer && rawTransfer.length > 0) {
          lastPacketTimeRef.current = Date.now();
          byteCountRef.current += rawTransfer.byteLength || rawTransfer.length || 0;

          // Unpack Realtek USB bulk transfer into individual 802.11 frames (with Radiotap headers)
          const unpackedFrames = unpackRealtekUsbTransfer(rawTransfer, channelRef.current);

          for (const buffer of unpackedFrames) {
            // Pre-Worker Filtering Pipeline Heuristic Check
            if (!fastFilterPacket(buffer, filterSettingsRef.current)) {
              // Drop packet immediately in main thread before worker to save CPU
              continue;
            }

            packetCountRef.current += 1;

            // Direct disk streaming or rolling ring buffer for PCAP export (capped at 50,000)
            if (isStreamingToDiskRef.current && livePcapWriterRef.current?.isOpen) {
              livePcapWriterRef.current.writePacket(buffer);
              setDiskStreamStats({
                fileName: livePcapWriterRef.current.fileName,
                packetCount: livePcapWriterRef.current.packetCount,
                bytesWritten: livePcapWriterRef.current.bytesWritten
              });
            } else {
              if (rawPacketsRef.current.length >= PCAP_MAX_CAPACITY) {
                rawPacketsRef.current.shift(); // Strict ring buffer: overwrite oldest
                setPcapBufferFull(true);
              }
              rawPacketsRef.current.push(buffer);
            }

            // If worker is running, offload heavy parsing to worker thread
            if (parserWorkerRef.current) {
              parserWorkerRef.current.postMessage({
                type: 'PARSE_BUFFER',
                buffer,
                channel: channelRef.current
              });

              // Fast EAPOL Handshake check on main thread for real-time chime
              if (buffer.length > 32 && handshakeTrackerRef.current) {
                const hsRes = handshakeTrackerRef.current.processPacket(buffer);
                if (hsRes && hsRes.isNewComplete) {
                  setHandshakeAlert(hsRes);
                  playHandshakeChime();
                }
              }
            } else {
              // Fallback parsing on main thread if worker unavailable
              const parsed = parse80211Frame(buffer);
              if (parsed) {
                if (!parsed.channel) parsed.channel = channelRef.current;
                channelStatsRef.current[parsed.channel] = (channelStatsRef.current[parsed.channel] || 0) + 1;
                waterfallCountsRef.current[parsed.channel] = (waterfallCountsRef.current[parsed.channel] || 0) + 1;

                // EAPOL Handshake detection
                const hsRes = handshakeTrackerRef.current.processPacket(buffer, parsed);
                if (hsRes && hsRes.isNewComplete) {
                  setHandshakeAlert(hsRes);
                  playHandshakeChime();
                }

                pendingFramesRef.current.push(parsed);
                checkDeauthAttack(parsed);
              }
            }
          }
        }
      } catch (err) {
        if (!isCapturingRef.current) break;

        if (err.name === 'NetworkError' || err.message?.includes('disconnected') || err.message?.includes('device is closed')) {
          console.warn('Physical USB disconnect detected:', err);
          isCapturingRef.current = false;
          setIsMonitoring(false);
          setIsConnected(false);
          setIsAutoHop(false);
          if (hopIntervalRef.current) {
            clearInterval(hopIntervalRef.current);
            hopIntervalRef.current = null;
          }
          setDevice(null);
          deviceRef.current = null;
          setChipsetStatus('Disconnected');
          setAdapterDisconnectedAlert(true);
          setStatusLevel('error');
          setStatusMessage('Adapter disconnected. Please reconnect.');
          break;
        }

        // Surface the real read error instead of silently retrying forever (throttled to 2s)
        const nowTs = Date.now();
        if (nowTs - lastRxErrorTsRef.current > 2000) {
          lastRxErrorTsRef.current = nowTs;
          setStatusLevel('warning');
          setStatusMessage(`Monitor active but RX read failed: ${err.message || err}`);
        }

        await new Promise(r => setTimeout(r, 60));
      }
    }
  };

  // 9. Start Monitor Mode
  const handleStartMonitor = async () => {
    if (!isConnected && !isSimulateRf) {
      setStatusLevel('error');
      setStatusMessage('Connect hardware or enable "Simulate RF" first.');
      return;
    }

    if (isSimulateRf) {
      setIsMonitoring(true);
      setIsPaused(false);
      isCapturingRef.current = true;
      setChipsetStatus(`Monitor CH ${channel} (Simulated)`);
      setStatusLevel('success');
      setStatusMessage(`Monitor active on Channel ${channel} (Simulated).`);
      return;
    }

    try {
      setChipsetStatus(`Initializing Monitor (CH ${channel})...`);
      const report = await startMonitorMode(device, channel, 20, 0);
      setIsMonitoring(true);
      setIsPaused(false);
      setChipsetStatus(`Monitor Active (CH ${channel})`);
      setStatusLevel('success');
      setStatusMessage(`Monitor initialized. Chip: ${report?.chip || 'RTL8812AU'}`);

      startRxLoop(device);
    } catch (err) {
      console.error('Failed to start monitor mode:', err);
      setStatusLevel('error');
      setStatusMessage(`Failed to initialize monitor: ${err.message || err}`);
      setChipsetStatus('Init Failed');
    }
  };

  // 10. Pause / Resume Monitor
  const handleTogglePause = () => {
    setIsPaused(prev => !prev);
  };

  // 11. Stop Monitor Mode
  const handleStopMonitor = async () => {
    isCapturingRef.current = false;
    setIsMonitoring(false);
    setIsPaused(false);
    setIsAutoHop(false);

    if (hopIntervalRef.current) {
      clearInterval(hopIntervalRef.current);
      hopIntervalRef.current = null;
    }

    if (device && typeof device.shutdownMonitor === 'function') {
      try {
        await device.shutdownMonitor();
      } catch (e) {}
    }

    setChipsetStatus(isConnected ? 'Ready' : (isSimulateRf ? 'Simulating' : 'Idle'));
    setStatusLevel('info');
    setStatusMessage('Monitor mode stopped.');
  };

  // 12. Channel Change
  const handleChannelChange = async (newCh) => {
    const chNum = parseInt(newCh, 10);
    setChannel(chNum);
    channelRef.current = chNum;

    if (isConnected && device && isMonitoring) {
      try {
        isRetuningRef.current = true;
        await retuneChannel(device, chNum, 20, 0);
        setChipsetStatus(`Monitor Active (CH ${chNum})`);
        setStatusLevel('info');
        setStatusMessage(`Radio retuned to Channel ${chNum}.`);
      } catch (err) {
        console.warn('Channel retune failed:', err);
        setStatusLevel('error');
        setStatusMessage(`Retune error: ${err.message || err}`);
      } finally {
        isRetuningRef.current = false;
      }
    } else if (isSimulateRf && isMonitoring) {
      setChipsetStatus(`Monitor CH ${chNum} (Simulated)`);
    }
  };

  // 13. Clear State
  const handleClear = () => {
    setDevices({});
    setClients({});
    setFrames([]);
    setRawHexLogs([]);
    setCleartextMetadata([]);
    setLayer3Mappings([]);
    setChannelStats({});
    channelStatsRef.current = {};
    handshakeTrackerRef.current.clear();
    setHandshakes({});
    setHandshakeAlert(null);
    setRogueSuspects([]);
    rawPacketsRef.current = [];
    pendingFramesRef.current = [];
    packetCountRef.current = 0;
    deviceCountRef.current = 0;
    setPacketsPerSec(0);
    setDeauthAlert(null);
    setPcapBufferFull(false);
    setAdapterDisconnectedAlert(false);
    setSelectedItem(null);
    setTablePage(1);
    setRoamHistory([]);
    clientApTrackingRef.current = {};
    if (pcapReplayerRef.current) {
      pcapReplayerRef.current.stop();
      pcapReplayerRef.current = null;
    }
    setReplayingPcapState(null);
  };


  // 14. Export JSON
  const handleExportJson = () => {
    const exportData = {
      exportTimestamp: new Date().toISOString(),
      monitorChannel: channel,
      accessPoints: devices,
      clientStations: clients
    };
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(exportData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `wifi_recon_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // 15. Export PCAP (Wireshark)
  const handleExportPcap = () => {
    if (rawPacketsRef.current.length === 0) {
      setStatusLevel('error');
      setStatusMessage('No raw packets captured yet to export.');
      return;
    }
    downloadPcap(rawPacketsRef.current, `alfa_wifi_capture_${new Date().toISOString().replace(/[:.]/g, '-')}.pcap`);
    setStatusLevel('success');
    setStatusMessage(`Exported ${rawPacketsRef.current.length} packets to Wireshark PCAP file.`);
  };

  // 16. Export Wigle CSV (Wardriving)
  const handleExportWigle = () => {
    if (Object.keys(devices).length === 0) {
      setStatusLevel('error');
      setStatusMessage('No access points captured yet to export to Wigle CSV.');
      return;
    }
    downloadWigleCsv(devices, `alfa_wardrive_wigle_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
    setStatusLevel('success');
    setStatusMessage(`Exported ${Object.keys(devices).length} APs to Wigle.net standard CSV.`);
  };

  // 17. Export Executive HTML Summary Report
  const handleExportExecutiveReport = () => {
    if (Object.keys(devices).length === 0 && Object.keys(clients).length === 0) {
      setStatusLevel('error');
      setStatusMessage('No RF telemetry captured yet to generate executive report.');
      return;
    }
    try {
      downloadExecutiveReport(devices, postureEvaluation, anomalies, clients, cleartextMetadata);
      setStatusLevel('success');
      setStatusMessage('Executive Summary HTML report generated.');
    } catch (err) {
      console.warn('Report generation failed:', err);
      setStatusLevel('error');
      setStatusMessage(`Failed to generate executive report: ${err?.message || err}`);
    }
  };

  // 18. Export GeoJSON (Spatial RF Telemetry)
  const handleExportGeoJson = () => {
    const allNodes = [...Object.values(devices), ...Object.values(clients)];
    const geoJson = generateGeoJSON(allNodes);
    if (!geoJson.features || geoJson.features.length === 0) {
      setStatusLevel('error');
      setStatusMessage('No GPS-tagged devices found to export GeoJSON. Enable GPS Tagging first.');
      return;
    }
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadFile(geoJson, `alfa_wifi_spatial_${ts}.geojson`, 'application/geo+json;charset=utf-8;');
    setStatusLevel('success');
    setStatusMessage(`Exported ${geoJson.features.length} spatial features to GeoJSON.`);
  };

  // 19. Export KML (Google Earth)
  const handleExportKml = () => {
    const allNodes = [...Object.values(devices), ...Object.values(clients)];
    const kml = generateKML(allNodes);
    if (!kml.includes('<Placemark>')) {
      setStatusLevel('error');
      setStatusMessage('No GPS-tagged devices found to export KML. Enable GPS Tagging first.');
      return;
    }
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadFile(kml, `alfa_wifi_spatial_${ts}.kml`, 'application/vnd.google-earth.kml+xml;charset=utf-8;');
    setStatusLevel('success');
    setStatusMessage(`Exported KML file for Google Earth.`);
  };

  // 20. Receiver (RX) Gain & Sensitivity Tuning
  const handleRxGainChange = async (newVal) => {
    const val = Math.max(1, Math.min(10, parseInt(newVal, 10) || 7));
    setRxGain(val);
    try {
      localStorage.setItem('alfa_hardware_rx_gain', String(val));
    } catch {}
    const res = await setHardwareRxGain(device, val);
    setStatusLevel('success');
    setStatusMessage(res.message || `Hardware RX Gain updated to ${val}`);
  };

  // 18. Hardware Output Endpoint Write Test
  const [isTestingWrite, setIsTestingWrite] = useState(false);
  const handleRunWriteTest = async () => {
    setIsTestingWrite(true);
    try {
      let radio = deviceRef.current;
      if (!radio && isSimulateRf) {
        radio = {
          write: async () => true,
          bulkOutEndpoint: () => 2
        };
      }
      const ok = await runOutputTest(radio);
      if (ok) {
        setStatusMessage('Output Endpoint Verified');
        setStatusLevel('success');
      } else {
        setStatusMessage('Output Endpoint Write Failed: Device rejected write payload or endpoint is unavailable.');
        setStatusLevel('error');
      }
    } catch (err) {
      setStatusMessage(`Output Endpoint Error: ${err?.message || err}`);
      setStatusLevel('error');
    } finally {
      setIsTestingWrite(false);
    }
  };

  // 18. Local Database Persistence (IndexedDB)
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [savedSessionsList, setSavedSessionsList] = useState([]);
  const [isSavingSession, setIsSavingSession] = useState(false);

  const handleSaveSession = async () => {
    setIsSavingSession(true);
    try {
      const saved = await saveSessionData(devices, rawPacketsRef.current, {
        clients,
        channelStats: channelStatsRef.current,
        packetCount: rawPacketsRef.current.length
      });
      setStatusMessage(`Session saved to IndexedDB (ID: ${saved.id}, ${saved.deviceCount} APs, ${saved.packetCount} packets)`);
      setStatusLevel('success');
    } catch (err) {
      console.warn('Save session error:', err);
      setStatusMessage(`Failed to save session: ${err?.message || err}`);
      setStatusLevel('error');
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleOpenSessionModal = async () => {
    try {
      const list = await listSessions();
      setSavedSessionsList(list);
    } catch (e) {
      console.warn('List sessions error:', e);
      setSavedSessionsList([]);
    }
    setIsSessionModalOpen(true);
  };

  const handleLoadSession = async (sessionId) => {
    try {
      const session = await loadSessionData(sessionId);
      if (!session) {
        setStatusMessage('Session not found in IndexedDB.');
        setStatusLevel('error');
        return;
      }
      if (session.devices) setDevices(session.devices);
      if (session.clients) setClients(session.clients);
      if (session.channelStats) {
        setChannelStats(session.channelStats);
        channelStatsRef.current = { ...session.channelStats };
      }
      if (session.rawBuffers && Array.isArray(session.rawBuffers)) {
        rawPacketsRef.current = [...session.rawBuffers];
      }
      deviceCountRef.current = Object.keys(session.devices || {}).length;

      // Calculate global startTime and endTime based on First Seen and Last Seen of all devices & clients
      const loadedAps = Object.values(session.devices || {});
      const loadedClients = Object.values(session.clients || {});
      const allLoaded = [...loadedAps, ...loadedClients];
      if (allLoaded.length > 0) {
        let globalStart = Infinity;
        let globalEnd = -Infinity;
        const sessionBase = session.timestamp || Date.now();

        for (const entity of allLoaded) {
          const { start, end } = getDeviceTimeRange(entity, sessionBase);
          if (start < globalStart) globalStart = start;
          if (end > globalEnd) globalEnd = end;
        }

        if (globalStart !== Infinity && globalEnd !== -Infinity) {
          if (globalEnd <= globalStart) {
            globalEnd = globalStart + 10000;
          }
          setTimelineRange({ start: globalStart, end: globalEnd });
          setCurrentSliderTime(globalEnd);
          setIsTimelineActive(true);
          setIsTimelinePlaying(false);
        }
      }

      setStatusMessage(`Loaded session "${session.name || session.id}" (${Object.keys(session.devices || {}).length} APs, ${Object.keys(session.clients || {}).length} Clients)`);
      setStatusLevel('success');
      setIsSessionModalOpen(false);
    } catch (err) {
      console.warn('Load session error:', err);
      setStatusMessage(`Failed to load session: ${err?.message || err}`);
      setStatusLevel('error');
    }
  };

  const handleDeleteSession = async (sessionId, e) => {
    e?.stopPropagation?.();
    try {
      await deleteSession(sessionId);
      const list = await listSessions();
      setSavedSessionsList(list);
      setStatusMessage(`Session ${sessionId} deleted from IndexedDB.`);
      setStatusLevel('info');
    } catch (err) {
      console.warn('Delete session error:', err);
    }
  };

  // 19. Identifier Anomaly Tracking
  const anomalies = useMemo(() => {
    return detectIdentifierAnomalies(clients);
  }, [clients]);

  // 20. Client Signature Profiling & Randomization Detection
  const { randomizedMacs: signatureRandomizedMacs } = useMemo(() => {
    return detectSignatureRandomization(clients);
  }, [clients]);

  // 21. Environment Posture Evaluation
  const postureEvaluation = useMemo(() => {
    return calculatePostureScore(devices, anomalies);
  }, [devices, anomalies]);

  // 22. Autonomous Channel Planning Recommendations (Phase 21)
  const channelRecommendations = useMemo(() => {
    return getChannelRecommendations({
      devices,
      channelStats,
      airtimePercent,
      currentChannel: channel
    });
  }, [devices, channelStats, airtimePercent, channel]);

  // Sorted & Filtered APs List


  const apList = useMemo(() => {
    let list = Object.values(devices);

    if (isTimelineActive && timelineRange.start > 0 && currentSliderTime > 0) {
      list = list.filter(d => {
        const { start, end } = getDeviceTimeRange(d);
        return start <= currentSliderTime && end >= currentSliderTime;
      });
    }

    if (showNewSinceBaseline && baselineSnapshot) {
      list = filterNewSinceBaseline(list, baselineSnapshot);
    }

    if (typeof rfSensitivity === 'number') {
      list = list.filter(d => d.rssi === undefined || d.rssi >= rfSensitivity);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(d => 
        (d.ssid && d.ssid.toLowerCase().includes(q)) || 
        (d.bssid && d.bssid.toLowerCase().includes(q)) ||
        (d.vendor && d.vendor.toLowerCase().includes(q))
      );
    }

    return list.sort((a, b) => {
      switch (sortBy) {
        case 'rssi-asc':
          return (a.rssi || -100) - (b.rssi || -100);
        case 'rssi-desc':
          return (b.rssi || -100) - (a.rssi || -100);
        case 'seen-desc':
          return (b.lastSeen || '').localeCompare(a.lastSeen || '');
        case 'ssid-asc':
          return (a.ssid || '').localeCompare(b.ssid || '');
        default:
          return (b.rssi || -100) - (a.rssi || -100);
      }
    });
  }, [devices, searchQuery, sortBy, showNewSinceBaseline, baselineSnapshot, isTimelineActive, timelineRange, currentSliderTime, rfSensitivity]);

  // Windowed visible slice for APs (prevents DOM freeze when APs > 100)
  const visibleApList = useMemo(() => {
    if (apList.length <= ROWS_PER_PAGE) return apList;
    const start = (tablePage - 1) * ROWS_PER_PAGE;
    return apList.slice(start, start + ROWS_PER_PAGE);
  }, [apList, tablePage]);

  // Infrastructure Clusters
  const infrastructureClusters = useMemo(() => {
    return clusterInfrastructure(apList, { minClusterSize: 2 });
  }, [apList]);

  const bssidClusterMap = useMemo(() => {
    const map = new Map();
    for (const cluster of infrastructureClusters) {
      for (const dev of cluster.devices) {
        map.set(dev.bssid, cluster);
      }
    }
    return map;
  }, [infrastructureClusters]);

  const clusteredApDisplayList = useMemo(() => {
    if (!isGroupByCluster) return visibleApList;
    return clusterInfrastructure(apList, { includeSingles: true, minClusterSize: 2 });
  }, [isGroupByCluster, apList, visibleApList]);

  // Automated Security Heuristics Report
  const heuristicReport = useMemo(() => {
    return generateHeuristicReport(Object.values(devices));
  }, [devices]);

  // Sorted & Filtered Clients List
  const clientList = useMemo(() => {
    let list = Object.values(clients);

    if (isTimelineActive && timelineRange.start > 0 && currentSliderTime > 0) {
      list = list.filter(c => {
        const { start, end } = getDeviceTimeRange(c);
        return start <= currentSliderTime && end >= currentSliderTime;
      });
    }

    if (showNewSinceBaseline && baselineSnapshot) {
      list = filterNewSinceBaseline(list, baselineSnapshot);
    }

    if (typeof rfSensitivity === 'number') {
      list = list.filter(c => c.rssi === undefined || c.rssi >= rfSensitivity);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => 
        (c.clientMac && c.clientMac.toLowerCase().includes(q)) || 
        (c.bssid && c.bssid.toLowerCase().includes(q)) ||
        (c.vendor && c.vendor.toLowerCase().includes(q)) ||
        (c.probedSsid && c.probedSsid.toLowerCase().includes(q))
      );
    }

    return list.sort((a, b) => {
      switch (sortBy) {
        case 'rssi-asc':
          return (a.rssi || -100) - (b.rssi || -100);
        case 'rssi-desc':
          return (b.rssi || -100) - (a.rssi || -100);
        case 'seen-desc':
          return (b.lastSeen || '').localeCompare(a.lastSeen || '');
        case 'ssid-asc':
          return (a.clientMac || '').localeCompare(b.clientMac || '');
        default:
          return (b.rssi || -100) - (a.rssi || -100);
      }
    });
  }, [clients, searchQuery, sortBy, showNewSinceBaseline, baselineSnapshot, isTimelineActive, timelineRange, currentSliderTime, rfSensitivity]);

  // Windowed visible slice for Clients
  const visibleClientList = useMemo(() => {
    if (clientList.length <= ROWS_PER_PAGE) return clientList;
    const start = (tablePage - 1) * ROWS_PER_PAGE;
    return clientList.slice(start, start + ROWS_PER_PAGE);
  }, [clientList, tablePage]);

  // Sorted & Filtered Probing Clients List (Stations actively seeking networks)
  const probingClientList = useMemo(() => {
    let list = Object.values(clients).filter(c => c.isProbing || (c.probedSsids && c.probedSsids.length > 0));

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => 
        (c.clientMac && c.clientMac.toLowerCase().includes(q)) || 
        (c.vendor && c.vendor.toLowerCase().includes(q)) ||
        (c.probedSsid && c.probedSsid.toLowerCase().includes(q)) ||
        (c.probedSsids && c.probedSsids.some(s => s.toLowerCase().includes(q)))
      );
    }

    return list.sort((a, b) => {
      switch (sortBy) {
        case 'rssi-asc':
          return (a.rssi || -100) - (b.rssi || -100);
        case 'rssi-desc':
          return (b.rssi || -100) - (a.rssi || -100);
        case 'seen-desc':
          return (b.lastSeen || '').localeCompare(a.lastSeen || '');
        case 'ssid-asc':
          return (a.clientMac || '').localeCompare(b.clientMac || '');
        default:
          return (b.rssi || -100) - (a.rssi || -100);
      }
    });
  }, [clients, searchQuery, sortBy]);

  // Windowed visible slice for Probing Clients
  const visibleProbingClientList = useMemo(() => {
    if (probingClientList.length <= ROWS_PER_PAGE) return probingClientList;
    const start = (tablePage - 1) * ROWS_PER_PAGE;
    return probingClientList.slice(start, start + ROWS_PER_PAGE);
  }, [probingClientList, tablePage]);

  // Target Watchlist Nodes List (APs & Clients)
  const watchlistList = useMemo(() => {
    if (watchlist.length === 0) return [];
    const set = new Set(watchlist.map(w => w.toUpperCase()));
    const results = [];

    // Check APs
    for (const [bssid, ap] of Object.entries(devices)) {
      if (set.has(bssid.toUpperCase())) {
        results.push({
          ...ap,
          watchType: 'ap',
          targetIdentifier: bssid
        });
      }
    }

    // Check Clients
    for (const [mac, cli] of Object.entries(clients)) {
      if (set.has(mac.toUpperCase())) {
        results.push({
          ...cli,
          watchType: 'client',
          targetIdentifier: mac
        });
      }
    }

    // Also include any watchlist items not yet detected in session
    for (const w of watchlist) {
      const up = w.toUpperCase();
      const alreadyFound = results.some(r => r.targetIdentifier?.toUpperCase() === up);
      if (!alreadyFound) {
        results.push({
          targetIdentifier: up,
          bssid: up,
          clientMac: up,
          ssid: '<Awaiting Telemetry>',
          vendor: getVendor(up),
          watchType: 'unknown',
          rssi: null,
          lastSeen: 'Never',
          lastSeenTimestamp: 0,
          isMissing: true
        });
      }
    }

    return results;
  }, [watchlist, devices, clients, nowTick]);

  const visibleWatchlistList = useMemo(() => {
    if (watchlistList.length <= ROWS_PER_PAGE) return watchlistList;
    const start = (tablePage - 1) * ROWS_PER_PAGE;
    return watchlistList.slice(start, start + ROWS_PER_PAGE);
  }, [watchlistList, tablePage]);

  // Signal Badges
  const getRssiBadge = (rssi) => {
    if (rssi == null) return 'bg-slate-800 text-slate-500 border-slate-700';
    if (rssi > -60) {
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    } else if (rssi > -75) {
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    } else {
      return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    }
  };

  // Security Badges
  const getSecurityBadge = (sec) => {
    switch (sec) {
      case 'WPA2/WPA3 Mixed':
      case 'WPA3/WPA2 Mixed':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'WPA3':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'WPA2':
        return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
      case 'WPA':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'WEP':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'Open':
      default:
        return 'bg-slate-800 text-slate-400 border-slate-700';
    }
  };

  // Helper: Render OS icon and badge based on IE signature & metadata (Phase 21)
  const renderClientOsIcon = (cli) => {
    if (!cli) return null;
    const os = identifyOS(cli.signature || cli.tagSequence, {
      dhcpHostname: cli.dhcpHostname || cli.hostname,
      vendor: cli.vendor || getVendor(cli.clientMac)
    });
    if (os === 'Unknown') return null;

    let IconComp = HelpCircle;
    let colorClass = 'text-slate-400';
    let title = `OS: ${os}`;

    if (os === 'iOS') {
      IconComp = Apple;
      colorClass = 'text-cyan-400';
      title = 'Apple iOS (IE Signature match)';
    } else if (os === 'macOS') {
      IconComp = Laptop;
      colorClass = 'text-cyan-400';
      title = 'Apple macOS (IE Signature match)';
    } else if (os === 'Android') {
      IconComp = Smartphone;
      colorClass = 'text-emerald-400';
      title = 'Google Android (IE Signature match)';
    } else if (os === 'Windows') {
      IconComp = Monitor;
      colorClass = 'text-blue-400';
      title = 'Microsoft Windows (IE Signature match)';
    } else if (os === 'Linux') {
      IconComp = Terminal;
      colorClass = 'text-purple-400';
      title = 'GNU/Linux (IE Signature match)';
    } else if (os === 'IoT / Embedded') {
      IconComp = Cpu;
      colorClass = 'text-amber-400';
      title = 'IoT / Embedded Device';
    }

    return (
      <span 
        title={title} 
        className="inline-flex items-center shrink-0 hover:scale-110 transition-transform cursor-help"
      >
        <IconComp className={`w-3.5 h-3.5 ${colorClass}`} />
      </span>
    );
  };

  // Filtered channel spectrum list based on spectrumBand
  const spectrumChannels = useMemo(() => {
    if (spectrumBand === '2.4') {
      return ALL_SPECTRUM_CHANNELS.filter(c => c.band === '2.4 GHz');
    }
    if (spectrumBand === '5') {
      return ALL_SPECTRUM_CHANNELS.filter(c => c.band === '5 GHz');
    }
    return ALL_SPECTRUM_CHANNELS;
  }, [spectrumBand]);

  // Spectrum statistics
  const spectrumStats = useMemo(() => {
    let totalPkts = 0;
    let maxPkts = 0;
    let maxCh = null;

    spectrumChannels.forEach(c => {
      const count = channelStats[c.ch] || 0;
      totalPkts += count;
      if (count > maxPkts) {
        maxPkts = count;
        maxCh = c.ch;
      }
    });

    // Determine recommended least congested channel from standard non-overlapping channels
    const candidateChannels = spectrumBand === '2.4' 
      ? [1, 6, 11] 
      : spectrumBand === '5'
      ? [36, 40, 44, 48, 149, 153, 157, 161]
      : [1, 6, 11, 36, 40, 44, 48];

    let minPkts = Infinity;
    let recommendedCh = candidateChannels[0];
    candidateChannels.forEach(ch => {
      const count = channelStats[ch] || 0;
      if (count < minPkts) {
        minPkts = count;
        recommendedCh = ch;
      }
    });

    return { totalPkts, maxPkts, maxCh, recommendedCh };
  }, [channelStats, spectrumChannels, spectrumBand]);

  return (
    <div className="w-full space-y-4 font-mono text-slate-200">
      {/* Hardware Disconnect Notice Banner */}
      {adapterDisconnectedAlert && (
        <div className="p-4 rounded-xl bg-rose-950/90 border-2 border-rose-500 text-rose-200 flex items-center justify-between shadow-rose-glow animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-600/30 text-rose-300 border border-rose-500/50">
              <AlertTriangle className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <div className="font-bold text-sm tracking-wide text-rose-100 uppercase">
                ⚠️ Adapter disconnected. Please reconnect.
              </div>
              <p className="text-xs text-rose-300/90 mt-0.5">
                USB communication dropped or cable unplugged. Reconnect device to resume monitoring.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleConnect}
              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition shadow-sm"
            >
              Reconnect Adapter
            </button>
            <button
              onClick={() => setAdapterDisconnectedAlert(false)}
              className="p-1 rounded hover:bg-rose-900/60 text-rose-300 hover:text-white font-bold text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Windows Driver Setup Required Banner */}
      {!isConnected && showWindowsBanner && (
        <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-500/50 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
              <Cpu className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="font-bold text-sm text-amber-100 flex items-center gap-2">
                <span>Hardware Setup Required (Windows)</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold uppercase">
                  WinUSB
                </span>
              </div>
              <p className="text-xs text-amber-200/80 mt-0.5">
                Windows requires replacing the native NDIS Wi-Fi driver with WinUSB via Zadig before WebUSB can access monitor mode.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setIsSetupGuideOpen(true)}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition shadow-sm flex items-center gap-1.5"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>View Setup Guide</span>
            </button>
            <button
              onClick={handleDismissWindowsBanner}
              className="p-1.5 rounded-lg hover:bg-amber-900/60 text-amber-400 hover:text-amber-100 transition"
              title="Dismiss banner (saved to localStorage)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Offline PCAP Replay Banner */}
      {replayingPcapState && (
        <div className={`p-3.5 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg ${
          replayingPcapState.finished
            ? 'bg-emerald-950/80 border-emerald-500/60 text-emerald-200'
            : 'bg-blue-950/80 border-blue-500/60 text-blue-200'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${replayingPcapState.finished ? 'bg-emerald-900/60 text-emerald-300' : 'bg-blue-900/60 text-blue-300 animate-pulse'}`}>
              <FileCode className="w-5 h-5" />
            </div>
            <div>
              <div className="font-bold text-sm flex items-center gap-2">
                <span>{replayingPcapState.finished ? 'Offline Capture Analysis Complete' : 'Replaying Offline Capture'}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-blue-900/80 text-blue-200 border border-blue-700/60">
                  {replayingPcapState.fileName}
                </span>
              </div>
              <div className="text-xs text-blue-300/80 mt-0.5">
                {replayingPcapState.finished
                  ? `Analyzed ${replayingPcapState.total.toLocaleString()} total packets. All tables and RF analytics are fully populated.`
                  : `Streaming ${replayingPcapState.current.toLocaleString()} / ${replayingPcapState.total.toLocaleString()} packets (${replayingPcapState.percent}%) into parser worker...`
                }
              </div>
              {!replayingPcapState.finished && (
                <div className="w-48 sm:w-72 bg-blue-950 h-1.5 rounded-full mt-2 overflow-hidden border border-blue-800/60">
                  <div
                    className="bg-blue-400 h-full transition-all duration-150 rounded-full"
                    style={{ width: `${replayingPcapState.percent}%` }}
                  />
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            {replayingPcapState.finished ? (
              <button
                onClick={() => setReplayingPcapState(null)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 font-bold text-xs transition border border-emerald-500/40"
              >
                Dismiss Banner
              </button>
            ) : (
              <button
                onClick={handleStopPcapReplay}
                className="px-3 py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 text-rose-200 font-bold text-xs transition border border-rose-500/40"
              >
                Stop Replay
              </button>
            )}
          </div>
        </div>
      )}

      {/* PCAP Ring Buffer Full Warning Banner */}
      {pcapBufferFull && (
        <div className="p-3.5 rounded-xl bg-amber-950/80 border border-amber-500/60 text-amber-200 flex items-center justify-between shadow-lg">
          <div className="flex items-center gap-2.5">
            <HardDrive className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-xs">
              <span className="font-bold text-amber-100">PCAP buffer full ({PCAP_MAX_CAPACITY.toLocaleString()} frames cap reached).</span>{' '}
              <span className="text-amber-300/90">Oldest frames are being overwritten as ring buffer. Export and clear to continue.</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExportPcap}
              className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition flex items-center gap-1"
            >
              <FileCode className="w-3.5 h-3.5" />
              <span>Export PCAP</span>
            </button>
            <button
              onClick={() => {
                rawPacketsRef.current = [];
                setPcapBufferFull(false);
              }}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-amber-300 border border-amber-600/40 text-xs transition"
            >
              Clear Buffer
            </button>
            <button
              onClick={() => setPcapBufferFull(false)}
              className="p-1 text-slate-400 hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* WIDS Attack Alert Banner */}
      {deauthAlert && (
        <div className="p-4 rounded-xl bg-rose-950/80 border-2 border-rose-500 text-rose-200 flex items-center justify-between shadow-rose-glow animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-rose-600/30 text-rose-300 border border-rose-500/50">
              <ShieldAlert className="w-6 h-6 text-rose-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-wide text-rose-100 uppercase">
                  ⚠️ Wireless Intrusion Detection: Deauth Attack Detected!
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-rose-600 text-white font-bold">
                  {deauthAlert.count} frames in 5s
                </span>
              </div>
              <p className="text-xs text-rose-300/90 mt-0.5">
                Target Station: <span className="font-bold text-white">{deauthAlert.target}</span> | AP BSSID: <span className="font-bold text-white">{deauthAlert.ap}</span> ({deauthAlert.reason})
              </p>
            </div>
          </div>
          <button
            onClick={() => setDeauthAlert(null)}
            className="p-1 rounded hover:bg-rose-900/60 text-rose-300 hover:text-white font-bold text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* WPA Handshake Captured Alert Banner */}
      {handshakeAlert && (
        <div className="p-4 rounded-xl bg-emerald-950/80 border-2 border-emerald-500 text-emerald-200 flex items-center justify-between shadow-emerald-glow animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-600/30 text-emerald-300 border border-emerald-500/50">
              <Lock className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-wide text-emerald-100 uppercase">
                  🔒 Complete WPA 4-Way Handshake Captured!
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-600 text-white font-bold">
                  EAPOL-Key M1/M2 Verified
                </span>
              </div>
              <p className="text-xs text-emerald-300/90 mt-0.5">
                AP BSSID: <span className="font-bold text-white">{handshakeAlert.bssid}</span> | Client Station: <span className="font-bold text-white">{handshakeAlert.clientMac}</span> | Captured: <span className="font-mono text-cyan-300 font-bold">{handshakeAlert.messages?.join(', ')}</span>
              </p>
            </div>
          </div>
          <button
            onClick={() => setHandshakeAlert(null)}
            className="p-1 rounded hover:bg-emerald-900/60 text-emerald-300 hover:text-white font-bold text-sm"
          >
            ✕
          </button>
        </div>
      )}

      {/* Rogue AP (Evil Twin) Alert Banner */}
      {rogueSuspects.length > 0 && (
        <div className="p-4 rounded-xl bg-amber-950/90 border-2 border-amber-500 text-amber-200 flex items-center justify-between shadow-amber-glow animate-pulse">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-amber-600/30 text-amber-300 border border-amber-500/50">
              <ShieldAlert className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm tracking-wide text-amber-100 uppercase">
                  ⚠️ Wireless Intrusion Detection: Rogue AP (Evil Twin) Suspect Detected!
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] bg-amber-600 text-white font-bold">
                  {rogueSuspects.length} Suspect SSID{rogueSuspects.length > 1 ? 's' : ''}
                </span>
              </div>
              <div className="text-xs text-amber-300/90 mt-1 space-y-0.5">
                {rogueSuspects.map((r, i) => (
                  <div key={i}>
                    Target SSID: <span className="font-bold text-white font-mono">{r.ssid}</span> | BSSIDs: <span className="font-mono text-cyan-300">{r.bssids.join(', ')}</span> — <span className="text-amber-200 font-semibold">{r.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <button
            onClick={() => setRogueSuspects([])}
            className="p-1 rounded hover:bg-amber-900/60 text-amber-300 hover:text-white font-bold text-sm"
          >
            ✕
          </button>
        </div>
      )}


      {/* Header Card */}
      <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-4 sm:p-5 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
              <Wifi className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-100 tracking-wide">
                  Alfa Wi-Fi Adapter (RTL8812AU)
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                  RF / Hardware
                </span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  WebUSB + WASM
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                802.11 monitor mode reconnaissance, STA tracking, WIDS intrusion alert & Wireshark PCAP export
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Environment Posture Score Gauge */}
          <div 
            className="flex items-center gap-2.5 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800 shadow-md cursor-help"
            title={`Environment Posture Score: ${postureEvaluation.score}/100 (Grade ${postureEvaluation.grade})\n${postureEvaluation.penalties.map(p => `• ${p.description}`).join('\n') || 'Zero security penalties'}`}
          >
            <div className="relative flex items-center justify-center w-8 h-8">
              <svg className="w-8 h-8 -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-slate-800"
                  strokeWidth="3.5"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
                <path
                  className={
                    postureEvaluation.level === 'secure' ? 'text-emerald-400' :
                    postureEvaluation.level === 'warning' ? 'text-amber-400' : 'text-rose-500'
                  }
                  strokeDasharray={`${postureEvaluation.score}, 100`}
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  stroke="currentColor"
                  fill="none"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                />
              </svg>
              <span className={`absolute text-[10px] font-black ${
                postureEvaluation.level === 'secure' ? 'text-emerald-400' :
                postureEvaluation.level === 'warning' ? 'text-amber-300' : 'text-rose-400'
              }`}>
                {postureEvaluation.score}
              </span>
            </div>
            <div className="text-left font-mono">
              <div className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Posture Score</div>
              <div className="text-[11px] font-bold flex items-center gap-1">
                <span className={
                  postureEvaluation.level === 'secure' ? 'text-emerald-400' :
                  postureEvaluation.level === 'warning' ? 'text-amber-300' : 'text-rose-400'
                }>
                  Grade {postureEvaluation.grade}
                </span>
                <span className="text-[9px] text-slate-500 font-normal">
                  ({postureEvaluation.level === 'secure' ? 'Optimal' : postureEvaluation.level === 'warning' ? 'Degraded' : 'Critical'})
                </span>
              </div>
            </div>
          </div>

          {/* Secondary toggles (GPS / Alerts / Simulation) grouped into one segment */}
          <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900/50 p-1">
          {/* GPS Tagging Toggle */}
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none px-2.5 py-1 rounded-md hover:bg-slate-800/60">
            <input
              type="checkbox"
              checked={isGpsTagging}
              onChange={(e) => {
                const checked = e.target.checked;
                setIsGpsTagging(checked);
                try {
                  localStorage.setItem('alfa_wifi_gps_tagging', String(checked));
                } catch {}
              }}
              className="accent-cyan-500 w-3.5 h-3.5 rounded"
            />
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-slate-300">GPS Tagging</span>
            {isGpsTagging && currentGps?.latitude != null && (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse ml-0.5" title="GPS Locked" />
            )}
          </label>

          {/* Desktop Alerts Toggle */}
          <button
            type="button"
            onClick={handleToggleDesktopAlerts}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition ${
              isDesktopAlerts
                ? 'bg-amber-500/20 text-amber-300 shadow-sm'
                : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-300'
            }`}
            title={isDesktopAlerts ? 'Desktop Alerts Active (1 per min limit)' : 'Enable Desktop Alerts (Notification API)'}
          >
            {isDesktopAlerts ? (
              <Bell className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <BellOff className="w-3.5 h-3.5 text-slate-500" />
            )}
            <span className="font-semibold">{isDesktopAlerts ? 'Alerts On' : 'Enable Desktop Alerts'}</span>
          </button>

          {/* Simulation Toggle */}
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none px-2.5 py-1 rounded-md hover:bg-slate-800/60">
            <input
              type="checkbox"
              checked={isSimulateRf}
              onChange={(e) => {
                setIsSimulateRf(e.target.checked);
                if (e.target.checked && !isMonitoring) {
                  setIsMonitoring(true);
                  isCapturingRef.current = true;
                }
              }}
              className="accent-cyan-500 w-3.5 h-3.5 rounded"
            />
            <span className="font-semibold text-slate-300">Simulate RF</span>
          </label>
          </div>

          {/* Hardware RX Sensitivity / Gain Slider */}
          <div 
            className="flex items-center gap-2 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800"
            title={`Hardware Receiver (RX) Gain: ${rxGain}/10\nAdjusts physical baseband AGC / LNA sensitivity on the radio adapter.`}
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-300 whitespace-nowrap">RX Gain:</span>
            <input 
              type="range"
              min="1"
              max="10"
              step="1"
              value={rxGain}
              onChange={(e) => handleRxGainChange(e.target.value)}
              className="w-16 sm:w-20 accent-cyan-500 cursor-pointer"
            />
            <span className="text-xs font-mono font-bold text-cyan-300 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
              {rxGain}/10
            </span>
          </div>

          {/* Windows Driver Setup Guide Button */}
          <button
            type="button"
            onClick={() => {
              setSetupGuideError(null);
              setIsSetupGuideOpen(true);
            }}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700 hover:text-white transition"
            title="Open Windows WebUSB WinUSB driver configuration guide"
          >
            <HelpCircle className="w-3.5 h-3.5 text-amber-400" />
            <span className="font-semibold hidden sm:inline">Driver Guide</span>
          </button>

          {/* Hardware Status Introspection Toggle */}
          <button
            type="button"
            onClick={() => setIsHardwarePanelOpen(!isHardwarePanelOpen)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition ${
              isHardwarePanelOpen
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                : 'bg-slate-900/80 text-slate-300 border-slate-800 hover:border-slate-700 hover:text-white'
            }`}
            title="Inspect physical adapter MAC, firmware, and chipset properties"
          >
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold">Hardware Status</span>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected || isSimulateRf ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          </button>

          <div className="h-6 w-px bg-slate-800 mx-0.5 hidden sm:block" />

          {/* Connect / Disconnect */}
          {!isConnected ? (
            <button
              onClick={handleConnect}
              disabled={Boolean(replayingPcapState?.active)}
              title={replayingPcapState?.active ? "Disabled during offline PCAP replay" : "Connect Alfa wireless network adapter via WebUSB"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition shadow-cyan-glow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Wifi className="w-4 h-4" />
              <span>Connect via WebUSB</span>
            </button>
          ) : (
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 text-xs transition"
            >
              <span>Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* Hardware Status Introspection Panel */}
      {isHardwarePanelOpen && (
        <div className="bg-[#171920] border border-cyan-500/40 rounded-xl p-4 shadow-xl animate-fade-in">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                <Cpu className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-200 tracking-wide uppercase">
                  Hardware Endpoint Introspection
                </h3>
                <p className="text-[10px] text-slate-400">
                  Direct USB/WASM endpoint query verification for physical NIC
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsHardwarePanelOpen(false)}
              className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 text-xs font-bold"
            >
              ✕
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Adapter MAC</div>
              <div className="text-cyan-300 font-bold mt-0.5 select-all text-[13px]">
                {hardwareStatus.adapterMac || '00:C0:CA:98:76:54'}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">Physical Burned-In Address</div>
            </div>

            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Firmware Version</div>
              <div className="text-emerald-300 font-bold mt-0.5 text-[13px] truncate" title={hardwareStatus.firmwareVersion}>
                {hardwareStatus.firmwareVersion || 'v2.4.1 (rtl8812au_fw)'}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">Realtek Microcode Revision</div>
            </div>

            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Chipset Model</div>
              <div className="text-purple-300 font-bold mt-0.5 text-[13px] truncate" title={hardwareStatus.chipsetModel}>
                {hardwareStatus.chipsetModel || 'Realtek RTL8812AU'}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">2T2R 802.11a/b/g/n/ac PHY</div>
            </div>

            <div className="bg-slate-900/80 p-2.5 rounded-lg border border-slate-800">
              <div className="text-[10px] text-slate-500 uppercase font-semibold">Endpoint Status</div>
              <div className="text-slate-200 font-bold mt-0.5 text-[13px] flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isConnected || isSimulateRf ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                <span>{isConnected ? 'USB EP Active' : isSimulateRf ? 'Simulated' : 'Idle / Disconnected'}</span>
                {hardwareStatus.temperatureC && (
                  <span className="text-amber-300 text-xs ml-auto">
                    {hardwareStatus.temperatureC}°C
                  </span>
                )}
              </div>
              <div className="text-[9px] text-slate-500 mt-0.5">Low-Level Query Verified</div>
            </div>
          </div>
        </div>
      )}

      {/* Status Notice Banner if present */}
      {statusMessage && (
        <div className={`p-3 rounded-lg text-xs flex items-center justify-between border ${
          statusLevel === 'error'
            ? 'bg-rose-950/40 border-rose-800/80 text-rose-300'
            : statusLevel === 'success'
            ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-300'
            : 'bg-cyan-950/40 border-cyan-800/80 text-cyan-300'
        }`}>
          <div className="flex items-center gap-2">
            {statusLevel === 'error' ? (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            ) : statusLevel === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <Radio className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage}</span>
          </div>
          <button 
            onClick={() => setStatusMessage(null)} 
            className="text-slate-400 hover:text-slate-200 ml-4 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Telemetry KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {/* Metric 1: Monitor Channel */}
        <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400 uppercase font-semibold">Monitor Channel</div>
            <div className="text-xl font-bold text-cyan-400 mt-0.5">
              CH {channel}
            </div>
            <div className="text-[10px] text-slate-500">
              {isAutoHop ? 'Auto-Hopping Active' : (channel <= 14 ? '2.4 GHz Band' : '5 GHz UNII Band')}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Radio className="w-5 h-5" />
          </div>
        </div>

        {/* Metric 2: Packets/sec with 60s Live SVG Line Chart */}
        <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 uppercase font-semibold">Throughput / PPS</div>
              <div className="text-xl font-bold text-purple-400 mt-0.5">
                {packetsPerSec} <span className="text-xs font-normal text-slate-400">pkts/s</span>
              </div>
            </div>
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Activity className="w-4 h-4" />
            </div>
          </div>

          {/* Live SVG Line Chart (Last 60 Seconds) */}
          <div className="w-full h-8 pt-1">
            {(() => {
              const maxPps = Math.max(10, ...ppsHistory);
              const w = 180;
              const h = 26;
              const points = ppsHistory.map((val, idx) => {
                const x = (idx / (ppsHistory.length - 1)) * w;
                const y = h - (val / maxPps) * (h - 4) - 2;
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              }).join(' ');

              return (
                <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full overflow-visible">
                  <defs>
                    <linearGradient id="ppsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#c084fc" stopOpacity="0.4" />
                      <stop offset="100%" stopColor="#c084fc" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  {/* Fill area under curve */}
                  <polygon
                    points={`0,${h} ${points} ${w},${h}`}
                    fill="url(#ppsGradient)"
                  />
                  {/* Line */}
                  <polyline
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points}
                  />
                </svg>
              );
            })()}
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-0.5 border-t border-slate-800/60">
            <span>{bytesPerSec > 1024 ? `${(bytesPerSec / 1024).toFixed(1)} KB/s` : `${bytesPerSec} B/s`}</span>
            <span>60s Window</span>
          </div>
        </div>

        {/* Metric 3: APs & Clients */}
        <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400 uppercase font-semibold">Tracked Nodes</div>
            <div className="text-xl font-bold text-emerald-400 mt-0.5">
              {Object.keys(devices).length} <span className="text-xs font-normal text-slate-400">APs</span> / {Object.keys(clients).length} <span className="text-xs font-normal text-slate-400">STAs</span>
            </div>
            <div className="text-[10px] text-slate-500">
              Access Points & Clients
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Users className="w-5 h-5" />
          </div>
        </div>

        {/* Metric 4: Chipset Status */}
        <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3.5 flex items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400 uppercase font-semibold">Chipset Status</div>
            <div className="text-sm font-bold text-slate-200 mt-1 truncate max-w-[150px]">
              {chipsetStatus}
            </div>
            <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isMonitoring && !isPaused ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`}></span>
              {isMonitoring ? (isPaused ? 'Capture Paused' : 'Ingestion Active') : 'Capture Idle'}
            </div>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-800/80 text-slate-300 border border-slate-700/60">
            <Cpu className="w-5 h-5" />
          </div>
        </div>

        {/* Metric 5: Channel Airtime Utilization */}
        <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3.5 flex flex-col justify-between gap-1.5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] text-slate-400 uppercase font-semibold">Channel Airtime</div>
              <div className="text-xl font-bold mt-0.5 flex items-baseline gap-1">
                <span className={
                  airtimePercent > 70 ? 'text-rose-400 font-bold' :
                  airtimePercent >= 40 ? 'text-amber-400 font-bold' :
                  'text-emerald-400 font-bold'
                }>
                  {airtimePercent.toFixed(1)}%
                </span>
                <span className="text-[10px] text-slate-500 font-mono">utilization</span>
              </div>
            </div>
            <div className={`p-2 rounded-lg border ${
              airtimePercent > 70 ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' :
              airtimePercent >= 40 ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
              'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
            }`}>
              <Gauge className="w-4 h-4" />
            </div>
          </div>

          {/* Airtime Progress Bar */}
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                airtimePercent > 70 ? 'bg-rose-500 shadow-rose-glow' :
                airtimePercent >= 40 ? 'bg-amber-400 shadow-amber-glow' :
                'bg-emerald-400 shadow-emerald-glow'
              }`}
              style={{ width: `${Math.min(100, Math.max(airtimePercent, 2))}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-0.5 border-t border-slate-800/60">
            <span className={
              airtimePercent > 70 ? 'text-rose-400 font-bold' :
              airtimePercent >= 40 ? 'text-amber-300 font-bold' :
              'text-emerald-400 font-bold'
            }>
              {airtimePercent > 70 ? 'Severely Congested' : airtimePercent >= 40 ? 'Moderate Traffic' : 'Optimal Bandwidth'}
            </span>
            <span>1s Window</span>
          </div>
        </div>
      </div>

      {/* Channel Planning Advisor Widget (Phase 21) */}
      <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shrink-0">
            <Compass className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase font-bold tracking-wider text-slate-300">
                Channel Planning Advisor
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                AI Congestion Scoring
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs">
              {/* 2.4 GHz Recommendation */}
              <div 
                className="flex items-center gap-1.5 cursor-help group relative"
                title={channelRecommendations.recommended24.reason}
              >
                <span className="text-slate-400">Recommended 2.4GHz Channel:</span>
                <span className="font-bold text-amber-400 font-mono">
                  {channelRecommendations.recommended24.channel}
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  (Congestion: {channelRecommendations.recommended24.congestionScore}%)
                </span>
                {/* Tooltip Popup on Hover */}
                <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 z-50 w-72 p-2.5 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-slate-200 text-[11px] leading-relaxed">
                  <div className="font-semibold text-amber-300 mb-1">2.4 GHz Channel Advisory</div>
                  {channelRecommendations.recommended24.reason}
                </div>
              </div>

              <span className="text-slate-700">|</span>

              {/* 5 GHz Recommendation */}
              <div 
                className="flex items-center gap-1.5 cursor-help group relative"
                title={channelRecommendations.reason5}
              >
                <span className="text-slate-400">Recommended 5GHz Channels:</span>
                <span className="font-bold text-cyan-400 font-mono">
                  {channelRecommendations.recommended5.map(c => c.channel).join(', ')}
                </span>
                {/* Tooltip Popup on Hover */}
                <div className="hidden group-hover:block absolute bottom-full left-0 mb-2 z-50 w-72 p-2.5 bg-slate-900 border border-slate-700 rounded-lg shadow-xl text-slate-200 text-[11px] leading-relaxed">
                  <div className="font-semibold text-cyan-300 mb-1">5 GHz Channel Advisory</div>
                  {channelRecommendations.reason5}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleChannelChange(channelRecommendations.recommended24.channel)}
            disabled={channel === channelRecommendations.recommended24.channel}
            title={`Tune hardware radio to recommended 2.4GHz Channel ${channelRecommendations.recommended24.channel}`}
            className="px-2.5 py-1 text-[11px] font-semibold rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition disabled:opacity-40"
          >
            Tune Ch {channelRecommendations.recommended24.channel} (2.4G)
          </button>
          {channelRecommendations.recommended5[0] && (
            <button
              onClick={() => handleChannelChange(channelRecommendations.recommended5[0].channel)}
              disabled={channel === channelRecommendations.recommended5[0].channel}
              title={`Tune hardware radio to top recommended 5GHz Channel ${channelRecommendations.recommended5[0].channel}`}
              className="px-2.5 py-1 text-[11px] font-semibold rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition disabled:opacity-40"
            >
              Tune Ch {channelRecommendations.recommended5[0].channel} (5G)
            </button>
          )}
        </div>
      </div>

      {/* Action Bar */}
      <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 min-w-0">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Start / Pause / Stop Monitor */}
          {!isMonitoring ? (
            <button
              onClick={handleStartMonitor}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-emerald-glow"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Monitor</span>
            </button>
          ) : (
            <>
              <button
                onClick={handleTogglePause}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                  isPaused 
                    ? 'bg-amber-500 hover:bg-amber-400 text-slate-950' 
                    : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40'
                }`}
              >
                {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                <span>{isPaused ? 'Resume' : 'Pause'}</span>
              </button>

              <button
                onClick={handleStopMonitor}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/50"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop</span>
              </button>
            </>
          )}

          <div className="h-4 w-px bg-slate-800 mx-1 hidden sm:block"></div>

          {/* Auto-Hop Channels Toggle */}
          <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 hover:border-slate-700">
            <input 
              type="checkbox"
              checked={isAutoHop}
              onChange={(e) => setIsAutoHop(e.target.checked)}
              className="accent-purple-500 w-3.5 h-3.5 rounded"
            />
            <span className="text-[11px] font-semibold text-purple-300">Auto-Hop Channels</span>
          </label>

          {/* Channel Dropdown */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Channel:</span>
            <select
              value={channel}
              disabled={isAutoHop}
              onChange={(e) => handleChannelChange(e.target.value)}
              className={`bg-slate-950 border border-slate-800 text-cyan-300 text-xs rounded-lg px-2.5 py-1.5 outline-none font-mono ${
                isAutoHop ? 'opacity-60 cursor-not-allowed' : 'focus:border-cyan-500'
              }`}
            >
              {POPULAR_CHANNELS.map(c => (
                <option key={c.ch} value={c.ch}>
                  CH {c.ch} ({c.freq} - {c.band})
                </option>
              ))}
              {Array.from({ length: 165 }, (_, i) => i + 1)
                .filter(ch => !POPULAR_CHANNELS.some(c => c.ch === ch))
                .map(ch => (
                  <option key={ch} value={ch}>CH {ch}</option>
                ))}
            </select>
          </div>

          {/* Dynamic Pre-Worker Telemetry Filtering Popover */}
          <div className="relative">
            <button
              onClick={() => setIsFilterPopoverOpen(prev => !prev)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                (filterIgnoreData || filterIgnoreManagement || filterIgnoreControl || filterMac.trim())
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
              }`}
              title="Configure Dynamic Pre-Worker Telemetry Filtering Pipeline"
            >
              <Filter className="w-3.5 h-3.5 text-cyan-400" />
              <span>Filtering</span>
              {(filterIgnoreData || filterIgnoreManagement || filterIgnoreControl || filterMac.trim()) && (
                <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">Active</span>
              )}
            </button>

            {isFilterPopoverOpen && (
              <div className="absolute left-0 mt-2 w-80 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-4 z-50 text-xs text-slate-300 backdrop-blur-md">
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
                  <div className="flex items-center gap-1.5 font-bold text-slate-200">
                    <SlidersHorizontal className="w-4 h-4 text-cyan-400" />
                    <span>Telemetry Filtering Pipeline</span>
                  </div>
                  <button 
                    onClick={() => setIsFilterPopoverOpen(false)}
                    className="p-1 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-3.5">
                  {/* RSSI Threshold */}
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[11px] font-semibold text-slate-300">Min RSSI Cutoff:</span>
                      <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                        rfSensitivity >= -65 ? 'text-emerald-400 bg-emerald-950/40' :
                        rfSensitivity >= -80 ? 'text-cyan-300 bg-cyan-950/40' :
                        'text-amber-300 bg-amber-950/40'
                      }`}>
                        {rfSensitivity} dBm
                      </span>
                    </div>
                    <input 
                      type="range"
                      min="-100"
                      max="-50"
                      step="1"
                      value={rfSensitivity}
                      onChange={(e) => handleRfSensitivityChange(e.target.value)}
                      className="w-full accent-cyan-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-500 mt-0.5 font-mono">
                      <span>-100 (All)</span>
                      <span>-85</span>
                      <span>-50 (Strong)</span>
                    </div>
                  </div>

                  {/* Frame Types to Ignore */}
                  <div className="border-t border-slate-800/80 pt-2.5">
                    <span className="text-[11px] font-semibold text-slate-300 block mb-2">Frame Types to Discard:</span>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterIgnoreData}
                          onChange={(e) => setFilterIgnoreData(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
                        />
                        <span className="text-slate-300">Ignore Data Frames (save worker CPU)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterIgnoreManagement}
                          onChange={(e) => setFilterIgnoreManagement(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
                        />
                        <span className="text-slate-300">Ignore Management Frames (Beacons, Probes)</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={filterIgnoreControl}
                          onChange={(e) => setFilterIgnoreControl(e.target.checked)}
                          className="rounded border-slate-700 bg-slate-950 text-cyan-500 focus:ring-0 w-3.5 h-3.5"
                        />
                        <span className="text-slate-300">Ignore Control Frames (ACKs, RTS/CTS)</span>
                      </label>
                    </div>
                  </div>

                  {/* Specific MAC Filter */}
                  <div className="border-t border-slate-800/80 pt-2.5">
                    <span className="text-[11px] font-semibold text-slate-300 block mb-1">Target MAC Filter:</span>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="e.g. AA:BB:CC:DD:EE:FF"
                        value={filterMac}
                        onChange={(e) => setFilterMac(e.target.value)}
                        className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-cyan-300 font-mono text-xs focus:border-cyan-500 outline-none"
                      />
                      {filterMac && (
                        <button
                          onClick={() => setFilterMac('')}
                          className="p-1 text-slate-500 hover:text-slate-300"
                          title="Clear MAC filter"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Only processes packets where BSSID, Src, or Dst matches this MAC.
                    </p>
                  </div>

                  {/* Reset button */}
                  {(filterIgnoreData || filterIgnoreManagement || filterIgnoreControl || filterMac.trim()) && (
                    <div className="pt-1 flex justify-end">
                      <button
                        onClick={() => {
                          setFilterIgnoreData(false);
                          setFilterIgnoreManagement(false);
                          setFilterIgnoreControl(false);
                          setFilterMac('');
                        }}
                        className="text-[11px] text-rose-400 hover:text-rose-300 hover:underline"
                      >
                        Reset All Filters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick RF Sensitivity Threshold Slider */}
          <div 
            className="flex items-center gap-2 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800"
            title={`RF Sensitivity Threshold: ${rfSensitivity} dBm\nPackets with RSSI < ${rfSensitivity} dBm are filtered out to improve clarity in dense RF environments.`}
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[11px] font-semibold text-slate-300 whitespace-nowrap">Sensitivity:</span>
            <input 
              type="range"
              min="-100"
              max="-50"
              step="1"
              value={rfSensitivity}
              onChange={(e) => handleRfSensitivityChange(e.target.value)}
              className="w-20 sm:w-24 accent-cyan-500 cursor-pointer"
            />
            <span className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
              rfSensitivity >= -65 ? 'text-emerald-400 bg-emerald-950/40' :
              rfSensitivity >= -80 ? 'text-cyan-300 bg-cyan-950/40' :
              'text-amber-300 bg-amber-950/40'
            }`}>
              {rfSensitivity} dBm
            </span>
          </div>
        </div>

        {/* Right: Forensic & Session Controls */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Save Session to IndexedDB */}
          <button
            onClick={handleSaveSession}
            disabled={isSavingSession || Object.keys(devices).length === 0}
            title="Save capture session to local IndexedDB store"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs transition disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isSavingSession ? 'Saving...' : 'Save Session'}</span>
          </button>

          {/* Load Session from IndexedDB */}
          <button
            onClick={handleOpenSessionModal}
            title="Open IndexedDB saved sessions"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-700 text-xs transition font-bold"
          >
            <FolderOpen className="w-3.5 h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Load Session</span>
          </button>

          {/* Timeline Replay Toggle Button */}
          <button
            onClick={() => {
              if (isTimelineActive) {
                setIsTimelineActive(false);
                setIsTimelinePlaying(false);
              } else {
                const allLoaded = [...Object.values(devices), ...Object.values(clients)];
                if (allLoaded.length === 0) {
                  setStatusMessage('No device timestamps available for timeline replay.');
                  setStatusLevel('info');
                  return;
                }
                let globalStart = Infinity;
                let globalEnd = -Infinity;
                for (const entity of allLoaded) {
                  const { start, end } = getDeviceTimeRange(entity);
                  if (start < globalStart) globalStart = start;
                  if (end > globalEnd) globalEnd = end;
                }
                if (globalStart !== Infinity && globalEnd !== -Infinity) {
                  if (globalEnd <= globalStart) globalEnd = globalStart + 10000;
                  setTimelineRange({ start: globalStart, end: globalEnd });
                  setCurrentSliderTime(globalEnd);
                  setIsTimelineActive(true);
                  setIsTimelinePlaying(false);
                }
              }
            }}
            title={isTimelineActive ? "Exit Timeline Replay" : "Open Timeline Replay Scrubber"}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition font-bold ${
              isTimelineActive
                ? 'bg-cyan-500/30 text-cyan-200 border-cyan-400 shadow-cyan-glow'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700'
            }`}
          >
            <Clock className={`w-3.5 h-3.5 ${isTimelineActive ? 'text-cyan-300 animate-pulse' : 'text-cyan-400'}`} />
            <span className="hidden sm:inline">Timeline Replay</span>
          </button>

          {/* Baseline Reference & Diffing Controls */}
          <div className="flex items-center gap-1.5 bg-slate-900/90 px-2 py-1 rounded-lg border border-slate-800">
            <button
              onClick={handleSaveBaseline}
              disabled={Object.keys(devices).length === 0 && Object.keys(clients).length === 0}
              title="Save current scan as reference baseline snapshot"
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold transition bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>Save Baseline</span>
            </button>

            {baselineSnapshot && (
              <>
                <label 
                  className="flex items-center gap-1.5 text-xs text-purple-300 cursor-pointer select-none px-1.5 py-0.5 hover:text-purple-200"
                  title={`Baseline saved at ${baselineSnapshot.savedAt} (${baselineSnapshot.deviceCount} APs, ${baselineSnapshot.clientCount} STAs)`}
                >
                  <input
                    type="checkbox"
                    checked={showNewSinceBaseline}
                    onChange={(e) => {
                      setShowNewSinceBaseline(e.target.checked);
                      setTablePage(1);
                    }}
                    className="accent-purple-500 w-3.5 h-3.5 rounded"
                  />
                  <span className="font-semibold text-[11px]">Show New Since Baseline</span>
                </label>

                <button
                  onClick={handleClearBaseline}
                  title="Clear saved baseline"
                  className="p-1 rounded hover:bg-slate-800 text-slate-500 hover:text-rose-400 text-xs transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>

          {/* Stream to Disk Toggle (File System Access API) */}
          <button
            onClick={handleToggleStreamToDisk}
            title={isStreamingToDisk ? `Streaming active to ${diskStreamStats.fileName}. Click to stop.` : "Stream live raw 802.11 packets directly to local disk (bypasses memory buffer for unlimited capture)"}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs transition font-bold ${
              isStreamingToDisk
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 shadow-sm animate-pulse'
                : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-slate-700'
            }`}
          >
            <HardDrive className={`w-3.5 h-3.5 ${isStreamingToDisk ? 'text-rose-400' : 'text-cyan-400'}`} />
            <span>{isStreamingToDisk ? 'Streaming to Disk' : 'Stream to Disk'}</span>
            {isStreamingToDisk && (
              <span className="px-1.5 py-0.2 rounded bg-rose-950 text-rose-300 text-[10px] font-mono border border-rose-800/60">
                {diskStreamStats.packetCount} pkts
              </span>
            )}
          </button>

          {/* Multi-Format Export Dropdown Menu */}
          <div className="relative">
            <button
              onClick={() => setIsExportDropdownOpen(prev => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs transition font-bold"
              title="Export captured telemetry in standard forensic and geographic formats"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${isExportDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {isExportDropdownOpen && (
              <div 
                className="absolute right-0 mt-2 w-52 bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-1.5 z-50 text-xs backdrop-blur-md space-y-1"
                onMouseLeave={() => setIsExportDropdownOpen(false)}
              >
                <button
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleExportPcap();
                  }}
                  disabled={rawPacketsRef.current.length === 0}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 hover:text-emerald-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Export PCAP</div>
                    <div className="text-[10px] text-slate-500">Wireshark (.pcap)</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleExportWigle();
                  }}
                  disabled={Object.keys(devices).length === 0}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 hover:text-cyan-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Compass className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Export Wigle CSV</div>
                    <div className="text-[10px] text-slate-500">Wardriving (.csv)</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleExportGeoJson();
                  }}
                  disabled={Object.keys(devices).length === 0 && Object.keys(clients).length === 0}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 hover:text-purple-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <MapPin className="w-4 h-4 text-purple-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Export GeoJSON</div>
                    <div className="text-[10px] text-slate-500">GIS Features (.geojson)</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleExportKml();
                  }}
                  disabled={Object.keys(devices).length === 0 && Object.keys(clients).length === 0}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 hover:text-amber-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Globe className="w-4 h-4 text-amber-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Export KML</div>
                    <div className="text-[10px] text-slate-500">Google Earth (.kml)</div>
                  </div>
                </button>

                <div className="border-t border-slate-800/80 my-1" />

                <button
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleExportExecutiveReport();
                  }}
                  disabled={Object.keys(devices).length === 0 && Object.keys(clients).length === 0}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 hover:text-emerald-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Export HTML Report</div>
                    <div className="text-[10px] text-slate-500">Executive Summary (.html)</div>
                  </div>
                </button>

                <button
                  onClick={() => {
                    setIsExportDropdownOpen(false);
                    handleExportJson();
                  }}
                  disabled={Object.keys(devices).length === 0 && Object.keys(clients).length === 0}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-800/80 flex items-center gap-2 text-slate-200 hover:text-cyan-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Database className="w-4 h-4 text-cyan-400 shrink-0" />
                  <div>
                    <div className="font-semibold">Export JSON Dump</div>
                    <div className="text-[10px] text-slate-500">Raw Objects (.json)</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Hidden File Input for PCAP Upload */}
          <input
            type="file"
            ref={pcapFileInputRef}
            accept=".pcap"
            onChange={handlePcapFileUpload}
            className="hidden"
          />

          {/* Upload PCAP Button (Forensic Replay) */}
          <button
            onClick={() => pcapFileInputRef.current?.click()}
            disabled={Boolean(replayingPcapState?.active)}
            title="Load saved .pcap file for offline forensic replay and diagnostic analysis"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-xs transition disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Upload PCAP</span>
          </button>

          {/* Clear Buffer */}
          <button
            onClick={handleClear}
            title="Clear captured devices, clients and packets"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 text-xs transition font-bold"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        </div>
      </div>

      {/* View Mode Navigation Bar (Dedicated horizontal scrollable tab strip) */}
      <div className="bg-[#171920] border border-slate-800/80 rounded-xl p-1.5 min-w-0 shadow-md">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800 py-0.5 px-0.5 text-xs">
          <button
            onClick={() => setActiveTab('aps')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'aps' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Access Points</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-900 text-cyan-300 text-[10px] font-mono font-bold border border-cyan-800/40">
              {Object.keys(devices).length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('clients')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'clients' ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
            <span>Clients (STAs)</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-900 text-purple-300 text-[10px] font-mono font-bold border border-purple-800/40">
              {Object.keys(clients).length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('roaming')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'roaming' ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <ArrowRightLeft className="w-3.5 h-3.5 text-purple-400" />
            <span>Roaming</span>
            {roamHistory.length > 0 && (
              <span className="px-1.5 py-0.2 bg-purple-500 text-slate-950 font-bold rounded-full text-[10px]">
                {roamHistory.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'watchlist' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
            <span>Watchlist</span>
            {watchlist.length > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">
                {watchlist.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('probing')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'probing' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Radar className="w-3.5 h-3.5" />
            <span>Probing</span>
          </button>
          <button
            onClick={() => setActiveTab('spectrum')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'spectrum' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Spectrum</span>
          </button>
          <button
            onClick={() => setActiveTab('waterfall')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'waterfall' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-cyan-400" />
            <span>Waterfall</span>
          </button>
          <button
            onClick={() => setActiveTab('interference')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'interference' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-400" />
            <span>Interference Map</span>
          </button>
          <button
            onClick={() => setActiveTab('topology')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'topology' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            <span>Topology</span>
          </button>
          <button
            onClick={() => setActiveTab('anomalies')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'anomalies' ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Fingerprint className="w-3.5 h-3.5" />
            <span>Anomalies</span>
            {anomalies.length > 0 && (
              <span className="px-1.5 py-0.2 bg-rose-500 text-slate-950 font-bold rounded-full text-[10px]">
                {anomalies.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('signalMap')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'signalMap' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            <span>Signal Map</span>
          </button>
          <button
            onClick={() => setActiveTab('frames')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'frames' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Live Frames</span>
          </button>
          <button
            onClick={() => setActiveTab('hex')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'hex' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Raw Hex</span>
          </button>
          <button
            onClick={() => setActiveTab('cleartext')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'cleartext' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Globe className="w-3.5 h-3.5 text-amber-400" />
            <span>Cleartext</span>
            {cleartextMetadata.length > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">
                {cleartextMetadata.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('heuristics')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'heuristics' ? 'bg-rose-500/20 text-rose-300 font-bold border border-rose-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            <span>Heuristics</span>
            {heuristicReport.totalVulnerabilities > 0 && (
              <span className="px-1.5 py-0.2 bg-rose-500 text-slate-950 font-bold rounded-full text-[10px]">
                {heuristicReport.totalVulnerabilities}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('layer3')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'layer3' ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Network className="w-3.5 h-3.5 text-cyan-400" />
            <span>Layer 3</span>
            {layer3Mappings.length > 0 && (
              <span className="px-1.5 py-0.2 bg-cyan-500 text-slate-950 font-bold rounded-full text-[10px]">
                {layer3Mappings.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg whitespace-nowrap text-xs transition font-semibold shrink-0 ${
              activeTab === 'rules' ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <Bell className="w-3.5 h-3.5 text-amber-400" />
            <span>Rules</span>
            {rules.length > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-500 text-slate-950 font-bold rounded-full text-[10px]">
                {rules.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Historical Timeline Replay Scrubber Bar */}
      {isTimelineActive && (
        <div className="bg-[#171920] border border-cyan-500/40 rounded-xl p-3.5 shadow-lg shadow-cyan-950/20">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-bold">
                <Clock className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
                <span>Historical Timeline Replay</span>
              </div>
              <span className="text-xs text-slate-400">
                Scrubber Time: <span className="text-cyan-300 font-mono font-semibold">{new Date(currentSliderTime).toLocaleTimeString()}</span>
                <span className="text-slate-500 ml-1.5 font-mono text-[11px]">
                  (+{Math.max(0, Math.round((currentSliderTime - timelineRange.start) / 1000))}s / {Math.max(0, Math.round((timelineRange.end - timelineRange.start) / 1000))}s)
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  if (currentSliderTime >= timelineRange.end) {
                    setCurrentSliderTime(timelineRange.start);
                  }
                  setIsTimelinePlaying(!isTimelinePlaying);
                }}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition ${
                  isTimelinePlaying 
                    ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40' 
                    : 'bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40'
                }`}
              >
                {isTimelinePlaying ? (
                  <>
                    <Pause className="w-3.5 h-3.5 fill-current" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Play (10x Speed)</span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  setIsTimelinePlaying(false);
                  setCurrentSliderTime(timelineRange.start);
                }}
                title="Reset scrubber to session start"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Start
              </button>

              <button
                onClick={() => {
                  setIsTimelinePlaying(false);
                  setCurrentSliderTime(timelineRange.end);
                }}
                title="Jump scrubber to session end"
                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                End
              </button>

              <button
                onClick={() => {
                  setIsTimelineActive(false);
                  setIsTimelinePlaying(false);
                }}
                title="Exit timeline mode and return to live scan"
                className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Range Slider */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-slate-400 shrink-0">
              {new Date(timelineRange.start).toLocaleTimeString()}
            </span>
            <input
              type="range"
              min={timelineRange.start}
              max={timelineRange.end}
              step={Math.max(10, Math.floor((timelineRange.end - timelineRange.start) / 1000) || 100)}
              value={currentSliderTime}
              onChange={(e) => {
                setIsTimelinePlaying(false);
                setCurrentSliderTime(Number(e.target.value));
              }}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
            <span className="text-[10px] font-mono text-slate-400 shrink-0">
              {new Date(timelineRange.end).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Main Diagnostic Dashboard Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-start">
        {/* Main Table View (3 cols or full width if no selection) */}
        <div className={`bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-2xl transition-all ${
          selectedItem ? 'lg:col-span-3' : 'lg:col-span-4'
        }`}>
          {/* Table Header Strip & Search & Sort */}
          <div className="px-4 py-2.5 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
            <div className="flex items-center gap-2 font-semibold">
              {activeTab === 'aps' && <Table className="w-4 h-4 text-cyan-400" />}
              {activeTab === 'clients' && <Smartphone className="w-4 h-4 text-purple-400" />}
              {activeTab === 'roaming' && <ArrowRightLeft className="w-4 h-4 text-purple-400" />}
              {activeTab === 'watchlist' && <Star className="w-4 h-4 text-amber-400 fill-amber-400" />}
              {activeTab === 'probing' && <Radar className="w-4 h-4 text-amber-400" />}
              {activeTab === 'spectrum' && <BarChart2 className="w-4 h-4 text-emerald-400" />}
              {activeTab === 'waterfall' && <Activity className="w-4 h-4 text-cyan-400" />}
              {activeTab === 'interference' && <Zap className="w-4 h-4 text-amber-400" />}
              {activeTab === 'topology' && <Network className="w-4 h-4 text-cyan-400" />}
              {activeTab === 'anomalies' && <Fingerprint className="w-4 h-4 text-rose-400" />}
              {activeTab === 'signalMap' && <MapPin className="w-4 h-4 text-cyan-400" />}
              {activeTab === 'frames' && <Radio className="w-4 h-4 text-cyan-400" />}
              {activeTab === 'hex' && <Terminal className="w-4 h-4 text-amber-400" />}
              {activeTab === 'cleartext' && <Globe className="w-4 h-4 text-amber-400" />}
              {activeTab === 'layer3' && <Network className="w-4 h-4 text-cyan-400" />}
              {activeTab === 'rules' && <Bell className="w-4 h-4 text-amber-400" />}
              <span>
                {activeTab === 'aps' && `Discovered Access Points (${apList.length} BSSIDs)`}
                {activeTab === 'clients' && `Tracked Client Stations (${clientList.length} STAs)`}
                {activeTab === 'roaming' && `Client Roaming Handoff Events (${roamHistory.length} Handoffs Logged)`}
                {activeTab === 'watchlist' && `Target Watchlist (${watchlistList.length} Watched Targets)`}
                {activeTab === 'probing' && `Probing Client Stations (${probingClientList.length} STAs seeking networks)`}
                {activeTab === 'spectrum' && `RF Spectrum Utilization & Congestion (${spectrumStats.totalPkts.toLocaleString()} packets logged)`}
                {activeTab === 'waterfall' && `Real-Time Spectrum Waterfall Spectrogram`}
                {activeTab === 'interference' && `2.4GHz Physical Channel Overlap & RF Interference Map`}
                {activeTab === 'topology' && `Network Topology Map (${Object.keys(devices).length + Object.keys(clients).length} Nodes)`}
                {activeTab === 'anomalies' && `Identity Anomaly Tracking (${anomalies.length} Rotation Anomalies Detected)`}
                {activeTab === 'signalMap' && `Signal Spatial Heatmap (${Object.values(devices).filter(d => d.latitude != null).length} Geotagged APs)`}
                {activeTab === 'frames' && `Ingested Frames Feed (${frames.length} frames)`}
                {activeTab === 'hex' && `Raw Hex Packet Stream (${rawHexLogs.length} logs)`}
                {activeTab === 'cleartext' && `Observable Cleartext Protocol Telemetry (${cleartextMetadata.length} streams)`}
                {activeTab === 'heuristics' && `Security Heuristics Vulnerability Audit (${heuristicReport.totalVulnerabilities} issues flagged)`}
                {activeTab === 'layer3' && `Discovered Layer 3 Mappings (${layer3Mappings.length} IP/MAC Pairs)`}
                {activeTab === 'rules' && `Automation Rule Engine (${rules.length} Rules Configured)`}
              </span>
            </div>


            {(activeTab === 'aps' || activeTab === 'clients' || activeTab === 'probing' || activeTab === 'watchlist') && (
              <div className="flex flex-wrap items-center gap-2">
                {/* Search Bar */}
                <div className="relative">
                  <input
                    type="text"
                    placeholder={
                      activeTab === 'aps' ? 'Search SSID, BSSID, Vendor...' :
                      activeTab === 'probing' ? 'Search Probed SSID, MAC, Vendor...' :
                      'Search Client MAC, AP, Vendor...'
                    }
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setTablePage(1);
                    }}
                    className="bg-slate-950 border border-slate-800 rounded-lg pl-7 pr-2 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500 w-44 sm:w-56"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2 top-2 pointer-events-none" />
                </div>

                {/* Sort Options Dropdown */}
                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <select
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value);
                      setTablePage(1);
                    }}
                    className="bg-transparent text-xs text-slate-300 outline-none cursor-pointer font-mono"
                  >
                    <option value="rssi-desc" className="bg-slate-900 text-slate-200">RSSI (Strongest First)</option>
                    <option value="rssi-asc" className="bg-slate-900 text-slate-200">RSSI (Weakest First)</option>
                    <option value="seen-desc" className="bg-slate-900 text-slate-200">Last Seen (Newest First)</option>
                    <option value="ssid-asc" className="bg-slate-900 text-slate-200">{activeTab === 'aps' ? 'SSID (A-Z)' : 'MAC (A-Z)'}</option>
                  </select>
                </div>

                {/* Infrastructure Clustering Group View Toggle */}
                {activeTab === 'aps' && (
                  <button
                    onClick={() => setIsGroupByCluster(prev => !prev)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                      isGroupByCluster 
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm' 
                        : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                    title="Toggle Infrastructure Clustering grouped view for sequential MAC / OUI nodes"
                  >
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    <span>{isGroupByCluster ? 'Ungroup Clusters' : 'Group Clusters'}</span>
                    {infrastructureClusters.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded bg-cyan-900/60 text-cyan-300 text-[10px] font-bold">
                        {infrastructureClusters.length}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tab 1: Access Points (BSSIDs) */}
          {activeTab === 'aps' && (
            <div>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {apList.length === 0 ? (
                  <div className="p-8 text-center text-xs space-y-4 max-w-xl mx-auto my-4 bg-slate-900/40 rounded-xl border border-slate-800/80">
                    <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mx-auto text-cyan-400">
                      <Radar className={`w-6 h-6 ${isMonitoring ? 'animate-spin' : ''}`} style={{ animationDuration: '4s' }} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-200">
                        {isMonitoring ? 'Scanning Airwaves — No Networks Captured Yet' : 'Monitor Inactive — Adapter Ready'}
                      </div>
                      <div className="text-slate-400 text-[11px] mt-1 max-w-md mx-auto">
                        {isMonitoring
                          ? `Listening on Channel ${channel} (${Number(channel) > 14 ? '5 GHz' : '2.4 GHz'}). If you're on a 5GHz channel without local APs, try hopping to 2.4GHz where beacon traffic is highest.`
                          : 'Click Start Monitor to begin capturing 802.11 beacons and probe frames with your Alfa adapter.'}
                      </div>
                    </div>

                    {/* Quick Diagnostic Actions */}
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-slate-800/60">
                      {!isMonitoring && (
                        <button
                          type="button"
                          onClick={handleStartMonitor}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shadow-emerald-glow"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Start Monitor</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleChannelChange(1)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          channel === 1 || channel === '1'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                        title="Tune hardware to 2.4 GHz Channel 1"
                      >
                        Tune Ch 1 (2.4G)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChannelChange(6)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          channel === 6 || channel === '6'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                        title="Tune hardware to 2.4 GHz Channel 6"
                      >
                        Tune Ch 6 (2.4G)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleChannelChange(11)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          channel === 11 || channel === '11'
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                            : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700'
                        }`}
                        title="Tune hardware to 2.4 GHz Channel 11"
                      >
                        Tune Ch 11 (2.4G)
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsAutoHop(prev => !prev)}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold transition ${
                          isAutoHop
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                            : 'bg-slate-950 text-purple-300 border-slate-800 hover:border-slate-700'
                        }`}
                        title="Toggle automatic channel hopping across 2.4G and 5G bands"
                      >
                        {isAutoHop ? 'Disable Auto-Hop' : 'Enable Auto-Hop Scan'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsSimulateRf(true);
                          if (!isMonitoring) {
                            setIsMonitoring(true);
                            isCapturingRef.current = true;
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-cyan-300 hover:border-cyan-500/40 text-xs font-semibold transition"
                        title="Generate realistic simulated 802.11 beacon, probe, and handshake traffic"
                      >
                        Simulate RF (Demo)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSetupGuideError(null);
                          setIsSetupGuideOpen(true);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-amber-300 hover:border-amber-500/40 text-xs font-semibold transition"
                        title="Open Windows WebUSB WinUSB Driver Configuration Guide"
                      >
                        Driver Guide
                      </button>
                    </div>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3 w-8 text-center">⭐</th>
                        <th className="py-2.5 px-3">BSSID</th>
                        <th className="py-2.5 px-3">IP Address</th>
                        <th className="py-2.5 px-3">SSID / Network Name</th>
                        <th className="py-2.5 px-3">Cluster</th>
                        <th className="py-2.5 px-3">Security</th>
                        <th className="py-2.5 px-3">Roaming</th>
                        <th className="py-2.5 px-3">Handshake</th>
                        <th className="py-2.5 px-3">RSSI</th>
                        <th className="py-2.5 px-3">SNR</th>
                        <th className="py-2.5 px-3">Signal Trend</th>
                        <th className="py-2.5 px-3">CH</th>
                        {isGpsTagging && <th className="py-2.5 px-3">Distance</th>}
                        <th className="py-2.5 px-3">Vendor</th>
                        <th className="py-2.5 px-3">Packets</th>
                        <th className="py-2.5 px-3 text-right">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {isGroupByCluster ? (
                        clusteredApDisplayList.map((entry) => {
                          if (entry.isCluster) {
                            const isExpanded = Boolean(expandedClusters[entry.id]);
                            const totalPkts = entry.devices.reduce((acc, d) => acc + (d.packetCount || 1), 0);
                            return (
                              <React.Fragment key={entry.id}>
                                <tr
                                  onClick={() => setExpandedClusters(prev => ({ ...prev, [entry.id]: !prev[entry.id] }))}
                                  className="bg-slate-900/80 hover:bg-slate-800/80 cursor-pointer border-l-4 border-cyan-500 transition-colors"
                                >
                                  <td className="py-2.5 px-3 text-center">
                                    {isExpanded ? (
                                      <ChevronDown className="w-4 h-4 text-cyan-400 inline-block" />
                                    ) : (
                                      <ChevronRight className="w-4 h-4 text-cyan-400 inline-block" />
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                                    {entry.bssid}
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-slate-100">{entry.name}</span>
                                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold">
                                        Cluster ({entry.count} BSSIDs)
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap">
                                    <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-800 font-semibold inline-flex items-center gap-1">
                                      <Layers className="w-3 h-3 text-cyan-400" />
                                      Node Group ({entry.count})
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-300">{entry.security}</td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                                  <td className="py-2.5 px-3 whitespace-nowrap font-bold text-cyan-400">
                                    <span className={`px-2 py-0.5 rounded text-[10px] border ${getRssiBadge(entry.rssi)}`}>
                                      {entry.rssi} dBm
                                    </span>
                                  </td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                                  <td className="py-2.5 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">—</td>
                                  <td className="py-2.5 px-3 text-cyan-300 font-mono whitespace-nowrap">CH {entry.channel}</td>
                                  {isGpsTagging && <td className="py-2.5 px-3 text-slate-600 font-mono text-[10px]">—</td>}
                                  <td className="py-2.5 px-3 text-slate-300 font-semibold whitespace-nowrap">{entry.vendor}</td>
                                  <td className="py-2.5 px-3 text-purple-300 font-semibold whitespace-nowrap">{totalPkts}</td>
                                  <td className="py-2.5 px-3 text-right text-cyan-400 font-semibold text-[11px] whitespace-nowrap">
                                    {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
                                  </td>
                                </tr>

                                {isExpanded && entry.devices.map((dev) => {
                                  const isNew = isNewDeviceSinceBaseline(dev);
                                  const devAnnotation = deviceAnnotations[dev.bssid.toUpperCase()] || null;
                                  return (
                                    <tr 
                                      key={dev.bssid} 
                                      onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                                      style={devAnnotation?.customColor ? { borderLeftColor: devAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                                      className={`hover:bg-slate-900/60 cursor-pointer transition-colors bg-slate-950/90 ${
                                        devAnnotation?.customColor ? '' : 'border-l-2 border-cyan-500/40'
                                      } ${
                                        selectedItem?.data?.bssid === dev.bssid ? 'bg-cyan-950/40' : ''
                                      }`}
                                    >
                                      <td 
                                        className="py-2 px-3 text-center whitespace-nowrap pl-4"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleWatchlist(dev.bssid);
                                        }}
                                      >
                                        <button
                                          type="button"
                                          title={watchlist.includes(dev.bssid.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                          className="p-1 hover:scale-125 transition-transform"
                                        >
                                          <Star className={`w-3.5 h-3.5 ${
                                            watchlist.includes(dev.bssid.toUpperCase()) 
                                              ? 'text-amber-400 fill-amber-400' 
                                              : 'text-slate-600 hover:text-amber-300'
                                          }`} />
                                        </button>
                                      </td>
                                      <td className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap pl-5">
                                        <div className="flex items-center gap-1.5">
                                          <span className="text-slate-500">↳</span>
                                          <span className="font-mono">{dev.bssid}</span>
                                          {isNew && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                                              NEW
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 font-mono text-cyan-300 whitespace-nowrap">
                                        {dev.ipAddress ? (
                                          <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px] text-cyan-300 font-bold">
                                            {dev.ipAddress}
                                          </span>
                                        ) : (
                                          <span className="text-slate-600 font-mono text-[10px]">—</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        {devAnnotation?.customLabel ? (
                                          <div className="flex flex-col">
                                            <div className="flex items-center gap-1 font-bold text-amber-300">
                                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: devAnnotation.customColor || '#f59e0b' }} />
                                              <span className="truncate max-w-[140px]">{devAnnotation.customLabel}</span>
                                            </div>
                                            <span className="text-[10px] text-slate-400 truncate max-w-[140px] font-mono">
                                              {dev.ssid}
                                            </span>
                                          </div>
                                        ) : (
                                          <span className={`font-semibold ${
                                            dev.ssid === '<Hidden SSID>' ? 'text-slate-500 italic' : 'text-cyan-300'
                                          }`}>
                                            {dev.ssid}
                                          </span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <span className="text-[10px] text-slate-500 font-mono">Cluster Member</span>
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <div className="flex items-center gap-1.5">
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(dev.security)}`}>
                                            {dev.security || 'Open'}
                                          </span>
                                          {dev.isWifi6 && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                              Wi-Fi 6
                                            </span>
                                          )}
                                          {(dev.isMfpRequired || dev.isMfpCapable || dev.mfp) && (
                                            <span 
                                              className="text-emerald-400 cursor-help flex items-center"
                                              title={dev.isMfpRequired || dev.mfp === 'required' ? "802.11w MFP Required" : "802.11w MFP Supported"}
                                            >
                                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <div className="flex items-center gap-1">
                                          {dev.roaming?.k && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">k</span>}
                                          {dev.roaming?.v && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">v</span>}
                                          {dev.roaming?.r && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">r</span>}
                                          {!dev.roaming?.k && !dev.roaming?.v && !dev.roaming?.r && <span className="text-slate-600 font-mono text-[10px]">—</span>}
                                        </div>
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        {handshakes[dev.bssid]?.isComplete || dev.hasHandshake ? (
                                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                            <Lock className="w-3 h-3 text-emerald-400" /> Complete
                                          </span>
                                        ) : (
                                          <span className="text-slate-600 font-mono pl-2">-</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(dev.rssi)}`}>
                                          {dev.rssi} dBm
                                        </span>
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        {dev.snr !== null && dev.snr !== undefined ? (
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(dev.snr)}`}>
                                            {dev.snr} dB
                                          </span>
                                        ) : (
                                          <span className="text-slate-600 font-mono text-[10px]">—</span>
                                        )}
                                      </td>
                                      <td className="py-2 px-3 whitespace-nowrap">
                                        <Sparkline data={dev.rssiHistory} />
                                      </td>
                                      <td className="py-2 px-3 text-slate-300 whitespace-nowrap">CH {dev.channel}</td>
                                      {isGpsTagging && <td className="py-2 px-3 text-slate-600 font-mono text-[10px]">—</td>}
                                      <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">{dev.vendor || getVendor(dev.bssid)}</td>
                                      <td className="py-2 px-3 text-purple-300 font-semibold whitespace-nowrap">{dev.packetCount}</td>
                                      <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">{dev.lastSeen}</td>
                                    </tr>
                                  );
                                })}
                              </React.Fragment>
                            );
                          }

                          const singleDev = entry.devices ? entry.devices[0] : entry;
                          const isNew = isNewDeviceSinceBaseline(singleDev);
                          const singleDevAnnotation = deviceAnnotations[singleDev.bssid.toUpperCase()] || null;
                          return (
                            <tr 
                              key={singleDev.bssid} 
                              onClick={() => setSelectedItem({ type: 'ap', data: singleDev })}
                              style={singleDevAnnotation?.customColor ? { borderLeftColor: singleDevAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                              className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                                singleDevAnnotation?.customColor ? '' : selectedItem?.data?.bssid === singleDev.bssid ? 'bg-cyan-950/30 border-l-2 border-cyan-400' : isNew ? 'bg-purple-950/20 border-l-2 border-purple-500' : ''
                              }`}
                            >
                              <td 
                                className="py-2 px-3 text-center whitespace-nowrap"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleWatchlist(singleDev.bssid);
                                }}
                              >
                                <button
                                  type="button"
                                  title={watchlist.includes(singleDev.bssid.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                  className="p-1 hover:scale-125 transition-transform"
                                >
                                  <Star className={`w-3.5 h-3.5 ${
                                    watchlist.includes(singleDev.bssid.toUpperCase()) 
                                      ? 'text-amber-400 fill-amber-400' 
                                      : 'text-slate-600 hover:text-amber-300'
                                  }`} />
                                </button>
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span>{singleDev.bssid}</span>
                                  {isNew && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                                      NEW
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono text-cyan-300 whitespace-nowrap">
                                {singleDev.ipAddress ? (
                                  <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px] text-cyan-300 font-bold">
                                    {singleDev.ipAddress}
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {singleDevAnnotation?.customLabel ? (
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1 font-bold text-amber-300">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: singleDevAnnotation.customColor || '#f59e0b' }} />
                                      <span className="truncate max-w-[140px]">{singleDevAnnotation.customLabel}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 truncate max-w-[140px] font-mono">
                                      {singleDev.ssid}
                                    </span>
                                  </div>
                                ) : (
                                  <span className={`font-semibold ${
                                    singleDev.ssid === '<Hidden SSID>' ? 'text-slate-500 italic' : 'text-cyan-300'
                                  }`}>
                                    {singleDev.ssid}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap text-slate-600 font-mono text-[10px]">
                                —
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(singleDev.security)}`}>
                                    {singleDev.security || 'Open'}
                                  </span>
                                  {singleDev.isWifi6 && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                      Wi-Fi 6
                                    </span>
                                  )}
                                  {(singleDev.isMixedMode || singleDev.security?.includes('Mixed')) && (
                                    <span className="text-amber-400 cursor-help" title="Mixed-Mode Encryption (WPA2/WPA3)">
                                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                                    </span>
                                  )}
                                  {(singleDev.isMfpRequired || singleDev.isMfpCapable || singleDev.mfp) && (
                                    <span 
                                      className="text-emerald-400 cursor-help flex items-center"
                                      title={singleDev.isMfpRequired || singleDev.mfp === 'required' ? "802.11w MFP Required" : "802.11w MFP Supported"}
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  {singleDev.roaming?.k && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">k</span>}
                                  {singleDev.roaming?.v && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">v</span>}
                                  {singleDev.roaming?.r && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">r</span>}
                                  {!singleDev.roaming?.k && !singleDev.roaming?.v && !singleDev.roaming?.r && <span className="text-slate-600 font-mono text-[10px]">—</span>}
                                </div>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {handshakes[singleDev.bssid]?.isComplete || singleDev.hasHandshake ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                    <Lock className="w-3 h-3 text-emerald-400" /> Complete
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono pl-2">-</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(singleDev.rssi)}`}>
                                  {singleDev.rssi} dBm
                                </span>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {singleDev.snr !== null && singleDev.snr !== undefined ? (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(singleDev.snr)}`}>
                                    {singleDev.snr} dB
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <Sparkline data={singleDev.rssiHistory} />
                              </td>
                              <td className="py-2 px-3 text-slate-300 whitespace-nowrap">CH {singleDev.channel}</td>
                              {isGpsTagging && <td className="py-2 px-3 text-slate-600 font-mono text-[10px]">—</td>}
                              <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">{singleDev.vendor || getVendor(singleDev.bssid)}</td>
                              <td className="py-2 px-3 text-purple-300 font-semibold whitespace-nowrap">{singleDev.packetCount}</td>
                              <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">{singleDev.lastSeen}</td>
                            </tr>
                          );
                        })
                      ) : (
                        visibleApList.map((dev) => {
                          const isNew = isNewDeviceSinceBaseline(dev);
                          const cluster = bssidClusterMap.get(dev.bssid);
                          return (
                            <tr 
                              key={dev.bssid} 
                              onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                              className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                                selectedItem?.data?.bssid === dev.bssid ? 'bg-cyan-950/30 border-l-2 border-cyan-400' : ''
                              } ${isNew ? 'bg-purple-950/20 border-l-2 border-purple-500' : ''}`}
                            >
                              <td 
                                className="py-2 px-3 text-center whitespace-nowrap"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleWatchlist(dev.bssid);
                                }}
                              >
                                <button
                                  type="button"
                                  title={watchlist.includes(dev.bssid.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                  className="p-1 hover:scale-125 transition-transform"
                                >
                                  <Star className={`w-3.5 h-3.5 ${
                                    watchlist.includes(dev.bssid.toUpperCase()) 
                                      ? 'text-amber-400 fill-amber-400' 
                                      : 'text-slate-600 hover:text-amber-300'
                                  }`} />
                                </button>
                              </td>
                              <td className="py-2 px-3 font-bold text-slate-300 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span>{dev.bssid}</span>
                                  {isNew && (
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0"
                                      title="Discovered after saved baseline snapshot"
                                    >
                                      NEW
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 font-mono text-cyan-300 whitespace-nowrap">
                                {dev.ipAddress ? (
                                  <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px] text-cyan-300 font-bold">
                                    {dev.ipAddress}
                                  </span>
                                ) : (
                                  <span className="text-slate-600 font-mono text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span className={`font-semibold ${
                                    dev.ssid === '<Hidden SSID>' ? 'text-slate-500 italic' : 'text-cyan-300'
                                  }`}>
                                    {dev.ssid}
                                  </span>
                                  {(dev.isUnmasked || dev.originalHidden) && dev.ssid !== '<Hidden SSID>' && (
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 shrink-0"
                                      title="Hidden SSID unmasked via correlated client probe/association frames"
                                    >
                                      <Lock className="w-2.5 h-2.5 text-amber-400" />
                                      <span>(Unmasked)</span>
                                    </span>
                                  )}
                                  {dev.isRogueSuspect && (
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-600/30 text-rose-300 border border-rose-500/50 flex items-center gap-1 shrink-0"
                                      title={dev.rogueReason || 'Rogue AP / Evil Twin Suspect'}
                                    >
                                      <AlertTriangle className="w-2.5 h-2.5" /> Rogue Suspect
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                {cluster ? (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setIsGroupByCluster(true);
                                      setExpandedClusters(prev => ({ ...prev, [cluster.id]: true }));
                                    }}
                                    className="px-2 py-0.5 rounded text-[10px] bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 font-semibold inline-flex items-center gap-1 transition"
                                    title={`${cluster.name}\nClick to view grouped cluster`}
                                  >
                                    <Layers className="w-3 h-3 text-cyan-400" />
                                    <span>Node Group ({cluster.count})</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-600 font-mono text-[10px]">—</span>
                                )}
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(dev.security)}`}>
                                    {dev.security || 'Open'}
                                  </span>
                                  {dev.isWifi6 && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                                      Wi-Fi 6
                                    </span>
                                  )}
                                  {(dev.isMixedMode || dev.security?.includes('Mixed')) && (
                                    <span 
                                      className="text-amber-400 cursor-help"
                                      title="Mixed-Mode Encryption (WPA2/WPA3)"
                                    >
                                      <ShieldAlert className="w-4 h-4 text-amber-400" />
                                    </span>
                                  )}
                                  {(dev.isMfpRequired || dev.isMfpCapable || dev.mfp) && (
                                    <span 
                                      className="text-emerald-400 cursor-help flex items-center"
                                      title={dev.isMfpRequired || dev.mfp === 'required' ? "802.11w MFP Required" : "802.11w MFP Supported"}
                                    >
                                      <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="py-2 px-3 whitespace-nowrap">
                                <div className="flex items-center gap-1">
                                  {dev.roaming?.k && (
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-help"
                                      title="802.11k: Radio Resource Measurement (neighbor reports & channel load)"
                                    >
                                      k
                                    </span>
                                  )}
                                  {dev.roaming?.v && (
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-help"
                                      title="802.11v: Wireless Network Management (BSS Transition Management)"
                                    >
                                      v
                                    </span>
                                  )}
                                  {dev.roaming?.r && (
                                    <span 
                                      className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 cursor-help"
                                      title="802.11r: Fast BSS Transition (FT handshake across APs)"
                                    >
                                      r
                                    </span>
                                  )}
                                  {!dev.roaming?.k && !dev.roaming?.v && !dev.roaming?.r && (
                                    <span className="text-slate-600 font-mono text-[10px]">—</span>
                                  )}
                                </div>
                              </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {handshakes[dev.bssid]?.isComplete || dev.hasHandshake ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                                  <Lock className="w-3 h-3 text-emerald-400" />
                                  Complete
                                </span>
                              ) : (
                                <span className="text-slate-600 font-mono pl-2">-</span>
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(dev.rssi)}`}>
                                {dev.rssi} dBm
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {dev.snr !== null && dev.snr !== undefined ? (
                                <span 
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(dev.snr)}`}
                                  title={`SNR: ${dev.snr} dB (RSSI: ${dev.rssi} dBm, Noise: ${dev.noiseFloor ?? -95} dBm)`}
                                >
                                  {dev.snr} dB
                                </span>
                              ) : (
                                <span className="text-slate-600 font-mono text-[10px]">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <Sparkline data={dev.rssiHistory} />
                            </td>
                            <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                              CH {dev.channel}
                            </td>
                            {isGpsTagging && (
                              <td className="py-2 px-3 text-cyan-300 font-mono whitespace-nowrap">
                                {(() => {
                                  if (dev.latitude != null && dev.longitude != null && currentGps?.latitude != null && currentGps?.longitude != null) {
                                    const dist = calculateHaversineDistance(
                                      currentGps.latitude,
                                      currentGps.longitude,
                                      dev.latitude,
                                      dev.longitude
                                    );
                                    return dist !== null ? `${dist.toLocaleString()} m` : '—';
                                  }
                                  return <span className="text-slate-600 font-mono">—</span>;
                                })()}
                              </td>
                            )}
                            <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">
                              {dev.vendor || getVendor(dev.bssid)}
                            </td>
                            <td className="py-2 px-3 text-purple-300 font-semibold whitespace-nowrap">
                              {dev.packetCount}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">
                              {dev.lastSeen}
                            </td>
                          </tr>
                        );
                      })
                    )}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination controls if rows > 100 */}
              {apList.length > ROWS_PER_PAGE && (
                <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <div>
                    Showing {(tablePage - 1) * ROWS_PER_PAGE + 1} - {Math.min(tablePage * ROWS_PER_PAGE, apList.length)} of {apList.length} APs
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={tablePage === 1}
                      onClick={() => setTablePage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>
                    <span className="font-semibold text-slate-300">
                      Page {tablePage} / {Math.ceil(apList.length / ROWS_PER_PAGE)}
                    </span>
                    <button
                      disabled={tablePage >= Math.ceil(apList.length / ROWS_PER_PAGE)}
                      onClick={() => setTablePage(p => p + 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Client Stations (STAs) */}
          {activeTab === 'clients' && (
            <div>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {clientList.length === 0 ? (
                  <div className="p-12 text-center text-slate-600 text-xs space-y-2">
                    <div>No client devices detected yet.</div>
                    <div className="text-slate-500">
                      Client devices are detected from live Data frames and Probe Requests.
                    </div>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3 w-8 text-center">⭐</th>
                        <th className="py-2.5 px-3">Client MAC</th>
                        <th className="py-2.5 px-3">IP Address</th>
                        <th className="py-2.5 px-3">Associated BSSID</th>
                        <th className="py-2.5 px-3">Vendor OUI</th>
                        <th className="py-2.5 px-3">Signature</th>
                        <th className="py-2.5 px-3">RSSI</th>
                        <th className="py-2.5 px-3">SNR</th>
                        <th className="py-2.5 px-3">Signal Trend</th>
                        <th className="py-2.5 px-3">CH</th>
                        <th className="py-2.5 px-3">Packets</th>
                        <th className="py-2.5 px-3 text-right">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {visibleClientList.map((cli) => {
                        const isNew = isNewDeviceSinceBaseline(cli);
                        const cliAnnotation = deviceAnnotations[cli.clientMac.toUpperCase()] || null;
                        return (
                          <tr 
                            key={cli.clientMac} 
                            onClick={() => setSelectedItem({ type: 'client', data: cli })}
                            style={cliAnnotation?.customColor ? { borderLeftColor: cliAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                            className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                              cliAnnotation?.customColor ? '' : selectedItem?.data?.clientMac === cli.clientMac ? 'bg-purple-950/30 border-l-2 border-purple-400' : isNew ? 'bg-purple-950/20 border-l-2 border-purple-500' : ''
                            }`}
                          >
                            <td 
                              className="py-2 px-3 text-center whitespace-nowrap"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWatchlist(cli.clientMac);
                              }}
                            >
                              <button
                                type="button"
                                title={watchlist.includes(cli.clientMac.toUpperCase()) ? 'Remove from Watchlist' : 'Add to Watchlist'}
                                className="p-1 hover:scale-125 transition-transform"
                              >
                                <Star className={`w-3.5 h-3.5 ${
                                  watchlist.includes(cli.clientMac.toUpperCase()) 
                                    ? 'text-amber-400 fill-amber-400' 
                                    : 'text-slate-600 hover:text-amber-300'
                                }`} />
                              </button>
                            </td>
                            <td className="py-2 px-3 font-bold text-purple-300 whitespace-nowrap">
                              <div className="flex items-center gap-1.5">
                                {renderClientOsIcon(cli)}
                                {cliAnnotation?.customLabel ? (
                                  <div className="flex flex-col">
                                    <div className="flex items-center gap-1 font-bold text-amber-300">
                                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: cliAnnotation.customColor || '#a855f7' }} />
                                      <span className="truncate max-w-[140px]">{cliAnnotation.customLabel}</span>
                                    </div>
                                    <span className="text-[10px] text-slate-400 font-mono">
                                      {cli.clientMac}
                                    </span>
                                  </div>
                                ) : (
                                  <span>{cli.clientMac}</span>
                                )}
                                {isNew && (
                                  <span 
                                    className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0"
                                    title="Discovered after saved baseline snapshot"
                                  >
                                    NEW
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 font-mono whitespace-nowrap">
                              {cli.ipAddress ? (
                                <div className="flex flex-col">
                                  <span className="text-cyan-300 font-bold text-[11px]">{cli.ipAddress}</span>
                                  {cli.dhcpHostname && (
                                    <span className="text-[10px] text-amber-300 font-sans">({cli.dhcpHostname})</span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-600 font-mono text-[10px]">—</span>
                              )}
                            </td>
                          <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                            {cli.bssid}
                          </td>
                          <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">
                            {cli.vendor || getVendor(cli.clientMac)}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span 
                                className="font-mono text-[10px] text-slate-400 max-w-[110px] truncate block" 
                                title={cli.signature || 'No IE tags captured'}
                              >
                                {cli.signature || '—'}
                              </span>
                              {signatureRandomizedMacs.has(cli.clientMac) && (
                                <span 
                                  className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0"
                                  title="Multiple hardware addresses broadcast the exact same Information Element signature within 10 min window"
                                >
                                  Potential Randomization
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(cli.rssi)}`}>
                              {cli.rssi} dBm
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            {cli.snr !== null && cli.snr !== undefined ? (
                              <span 
                                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(cli.snr)}`}
                                title={`SNR: ${cli.snr} dB (RSSI: ${cli.rssi} dBm, Noise: ${cli.noiseFloor ?? -95} dBm)`}
                              >
                                {cli.snr} dB
                              </span>
                            ) : (
                              <span className="text-slate-600 font-mono text-[10px]">—</span>
                            )}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <Sparkline data={cli.rssiHistory} />
                          </td>
                          <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                            CH {cli.channel}
                          </td>
                          <td className="py-2 px-3 text-cyan-300 font-semibold whitespace-nowrap">
                            {cli.packetCount}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">
                            {cli.lastSeen}
                          </td>
                        </tr>
                      );
                    })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination controls if clients > 100 */}
              {clientList.length > ROWS_PER_PAGE && (
                <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <div>
                    Showing {(tablePage - 1) * ROWS_PER_PAGE + 1} - {Math.min(tablePage * ROWS_PER_PAGE, clientList.length)} of {clientList.length} Clients
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={tablePage === 1}
                      onClick={() => setTablePage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>
                    <span className="font-semibold text-slate-300">
                      Page {tablePage} / {Math.ceil(clientList.length / ROWS_PER_PAGE)}
                    </span>
                    <button
                      disabled={tablePage >= Math.ceil(clientList.length / ROWS_PER_PAGE)}
                      onClick={() => setTablePage(p => p + 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Target Watchlist */}
          {activeTab === 'watchlist' && (
            <div>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {watchlistList.length === 0 ? (
                  <div className="p-12 text-center text-slate-600 text-xs space-y-2">
                    <Star className="w-8 h-8 text-amber-500/40 mx-auto" />
                    <div className="font-semibold text-slate-300">Your Watchlist is empty.</div>
                    <div className="text-slate-500 max-w-sm mx-auto">
                      Click the <span className="text-amber-400 font-bold">⭐ Star</span> icon in the Access Points or Clients table to pin targets for dedicated surveillance and offline tracking.
                    </div>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3 w-8 text-center">⭐</th>
                        <th className="py-2.5 px-3">Target Identifier</th>
                        <th className="py-2.5 px-3">Node Type</th>
                        <th className="py-2.5 px-3">SSID / Network Name</th>
                        <th className="py-2.5 px-3">Vendor</th>
                        <th className="py-2.5 px-3">RSSI</th>
                        <th className="py-2.5 px-3">Signal Trend</th>
                        <th className="py-2.5 px-3">CH</th>
                        <th className="py-2.5 px-3">Packets</th>
                        <th className="py-2.5 px-3 text-right">Status / Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {visibleWatchlistList.map((node) => {
                        // Check if device has not been seen for over 60 seconds
                        let isMissing = node.isMissing || false;
                        if (!isMissing && node.lastSeen) {
                          const parts = node.lastSeen.split(/[:.]/);
                          if (parts.length >= 3) {
                            const now = new Date();
                            const lastSeenDate = new Date();
                            lastSeenDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3] || 0, 10));
                            if (now - lastSeenDate > 60000) {
                              isMissing = true;
                            }
                          }
                        }

                        return (
                          <tr 
                            key={node.targetIdentifier}
                            onClick={() => {
                              if (node.watchType === 'ap') setSelectedItem({ type: 'ap', data: node });
                              else if (node.watchType === 'client') setSelectedItem({ type: 'client', data: node });
                            }}
                            className={`cursor-pointer transition-colors ${
                              isMissing
                                ? 'bg-rose-950/30 hover:bg-rose-950/50 border-l-2 border-rose-500'
                                : 'hover:bg-slate-900/60'
                            }`}
                          >
                            <td 
                              className="py-2 px-3 text-center whitespace-nowrap"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleWatchlist(node.targetIdentifier);
                              }}
                            >
                              <button
                                type="button"
                                title="Remove from Watchlist"
                                className="p-1 hover:scale-125 transition-transform"
                              >
                                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                              </button>
                            </td>
                            <td className="py-2 px-3 font-mono font-bold text-amber-300 whitespace-nowrap">
                              {node.targetIdentifier}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                node.watchType === 'ap'
                                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                                  : node.watchType === 'client'
                                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                                  : 'bg-slate-800 text-slate-400'
                              }`}>
                                {node.watchType === 'ap' ? 'Access Point' : node.watchType === 'client' ? 'Client Station' : 'Target'}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className="font-semibold text-slate-200">
                                {node.ssid || node.probedSsid || node.bssid || '—'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                              {node.vendor || getVendor(node.targetIdentifier)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(node.rssi)}`}>
                                {node.rssi != null ? `${node.rssi} dBm` : '—'}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <Sparkline data={node.rssiHistory} />
                            </td>
                            <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                              {node.channel ? `CH ${node.channel}` : '—'}
                            </td>
                            <td className="py-2 px-3 font-semibold text-cyan-300 whitespace-nowrap">
                              {node.packetCount || 0}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {isMissing ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600/30 text-rose-300 border border-rose-500/50">
                                  <AlertTriangle className="w-3 h-3 text-rose-400" />
                                  Missing (&gt;60s)
                                </span>
                              ) : (
                                <span className="text-slate-400 text-xs font-mono">
                                  {node.lastSeen || 'Active'}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Tab: Probing Clients (STAs seeking networks) */}
          {activeTab === 'probing' && (
            <div>
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {probingClientList.length === 0 ? (
                  <div className="p-12 text-center text-slate-600 text-xs space-y-2">
                    <div>No probing client stations detected yet.</div>
                    <div className="text-slate-500">
                      Unassociated devices broadcast Probe Requests searching for preferred networks.
                    </div>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Client Station MAC</th>
                        <th className="py-2.5 px-3">Vendor (OUI)</th>
                        <th className="py-2.5 px-3">Probed Networks (SSIDs)</th>
                        <th className="py-2.5 px-3">RSSI</th>
                        <th className="py-2.5 px-3">Signal Trend</th>
                        <th className="py-2.5 px-3">CH</th>
                        <th className="py-2.5 px-3">Packets</th>
                        <th className="py-2.5 px-3 text-right">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {visibleProbingClientList.map((cli) => (
                        <tr 
                          key={cli.clientMac} 
                          onClick={() => setSelectedItem({ type: 'client', data: cli })}
                          className={`hover:bg-slate-900/60 cursor-pointer transition-colors ${
                            selectedItem?.data?.clientMac === cli.clientMac ? 'bg-amber-950/30 border-l-2 border-amber-400' : ''
                          }`}
                        >
                          <td className="py-2 px-3 font-bold text-amber-300 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              {renderClientOsIcon(cli)}
                              <span>{cli.clientMac}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-slate-400 whitespace-nowrap font-medium">
                            {cli.vendor || getVendor(cli.clientMac)}
                          </td>
                          <td className="py-2 px-3">
                            <div className="flex flex-wrap items-center gap-1 max-w-xs">
                              {cli.probedSsids && cli.probedSsids.length > 0 ? (
                                cli.probedSsids.map((s, idx) => (
                                  <span key={idx} className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                                    {s}
                                  </span>
                                ))
                              ) : cli.probedSsid ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                                  {cli.probedSsid}
                                </span>
                              ) : (
                                <span className="text-slate-600 text-[10px] italic">Wildcard Probes Only</span>
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(cli.rssi)}`}>
                              {cli.rssi} dBm
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <Sparkline data={cli.rssiHistory} />
                          </td>
                          <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                            CH {cli.channel}
                          </td>
                          <td className="py-2 px-3 text-amber-300 font-semibold whitespace-nowrap">
                            {cli.packetCount}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-500 whitespace-nowrap">
                            {cli.lastSeen}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination controls if probing clients > 100 */}
              {probingClientList.length > ROWS_PER_PAGE && (
                <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                  <div>
                    Showing {(tablePage - 1) * ROWS_PER_PAGE + 1} - {Math.min(tablePage * ROWS_PER_PAGE, probingClientList.length)} of {probingClientList.length} Probing Clients
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={tablePage === 1}
                      onClick={() => setTablePage(p => Math.max(1, p - 1))}
                      className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>Prev</span>
                    </button>
                    <span className="font-semibold text-slate-300">
                      Page {tablePage} / {Math.ceil(probingClientList.length / ROWS_PER_PAGE)}
                    </span>
                    <button
                      disabled={tablePage >= Math.ceil(probingClientList.length / ROWS_PER_PAGE)}
                      onClick={() => setTablePage(p => p + 1)}
                      className="px-2.5 py-1 rounded bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-200 flex items-center gap-1"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Client Roaming Handoff Analysis */}
          {activeTab === 'roaming' && (
            <div className="p-4 space-y-4">
              {/* Top Controls & KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Roam Events</div>
                  <div className="text-xl font-bold text-cyan-300 font-mono mt-0.5">
                    {roamHistory.length}
                  </div>
                </div>
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Fastest Roam</div>
                  <div className="text-xl font-bold text-emerald-400 font-mono mt-0.5">
                    {roamHistory.length > 0 ? `${Math.min(...roamHistory.map(r => r.roamTime))} ms` : '—'}
                  </div>
                </div>
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Avg Roam Time</div>
                  <div className="text-xl font-bold text-amber-300 font-mono mt-0.5">
                    {roamHistory.length > 0 
                      ? `${Math.round(roamHistory.reduce((acc, r) => acc + r.roamTime, 0) / roamHistory.length)} ms`
                      : '—'}
                  </div>
                </div>
                <div className="p-3 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Roaming Clients</div>
                    <div className="text-xl font-bold text-purple-300 font-mono mt-0.5">
                      {new Set(roamHistory.map(r => r.clientMac)).size}
                    </div>
                  </div>
                  {roamHistory.length > 0 && (
                    <button
                      onClick={() => setRoamHistory([])}
                      className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-rose-300 text-[10px] font-semibold border border-slate-700 transition"
                      title="Clear roaming event log"
                    >
                      Clear Log
                    </button>
                  )}
                </div>
              </div>

              {/* Roaming Events Table */}
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
                {roamHistory.length === 0 ? (
                  <div className="p-12 text-center text-slate-500 text-xs">
                    <ArrowRightLeft className="w-8 h-8 text-slate-600 mx-auto mb-2 opacity-50" />
                    <p className="font-semibold text-slate-400">No client roaming handoffs detected yet.</p>
                    <p className="text-[11px] text-slate-600 mt-1 max-w-md mx-auto">
                      A roaming handoff is automatically logged when a client station switches association between Access Points within 30 seconds.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase">
                      <tr>
                        <th className="py-2.5 px-3">Timestamp</th>
                        <th className="py-2.5 px-3">Client MAC</th>
                        <th className="py-2.5 px-3">From BSSID</th>
                        <th className="py-2.5 px-3">To BSSID</th>
                        <th className="py-2.5 px-3">Roam Time</th>
                        <th className="py-2.5 px-3">CH</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-900">
                      {roamHistory.map((roam) => {
                        const clientAnnotation = deviceAnnotations[roam.clientMac?.toUpperCase()] || null;
                        const clientVendor = lookupVendor(roam.clientMac);

                        let timeBadge = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
                        if (roam.roamTime > 1000) {
                          timeBadge = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
                        } else if (roam.roamTime > 300) {
                          timeBadge = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
                        }

                        return (
                          <tr 
                            key={roam.id}
                            className="hover:bg-slate-900/50 transition-colors"
                          >
                            <td className="py-2 px-3 text-slate-400 font-mono whitespace-nowrap">
                              {roam.timestamp}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <div className="flex flex-col">
                                {clientAnnotation?.customLabel ? (
                                  <span className="font-bold text-amber-300">{clientAnnotation.customLabel}</span>
                                ) : null}
                                <span className="font-mono text-cyan-300 font-bold">{roam.clientMac}</span>
                                <span className="text-[10px] text-slate-500">{clientVendor}</span>
                              </div>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap font-mono text-rose-300/90">
                              {roam.fromBssid}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap font-mono text-emerald-300/90">
                              {roam.toBssid}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${timeBadge}`}>
                                {roam.roamTime} ms
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-slate-400">
                              CH {roam.channel || '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Tab 3: Spectrum Channel Utilization & Congestion */}
          {activeTab === 'spectrum' && (
            <div className="p-4 space-y-4">
              {/* Top Controls & KPI Cards */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
                {/* Band Selector */}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-semibold">Band Filter:</span>
                  <div className="flex bg-slate-900 rounded-lg p-0.5 border border-slate-800 text-xs">
                    <button
                      onClick={() => setSpectrumBand('all')}
                      className={`px-2.5 py-1 rounded font-semibold transition ${
                        spectrumBand === 'all' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All Channels ({ALL_SPECTRUM_CHANNELS.length})
                    </button>
                    <button
                      onClick={() => setSpectrumBand('2.4')}
                      className={`px-2.5 py-1 rounded font-semibold transition ${
                        spectrumBand === '2.4' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      2.4 GHz (1-14)
                    </button>
                    <button
                      onClick={() => setSpectrumBand('5')}
                      className={`px-2.5 py-1 rounded font-semibold transition ${
                        spectrumBand === '5' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      5 GHz (36-165)
                    </button>
                  </div>
                </div>

                {/* KPI Metrics */}
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 text-[10px] uppercase block">Total Logged</span>
                    <span className="font-bold text-cyan-300 text-sm">{spectrumStats.totalPkts.toLocaleString()} pkts</span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800">
                    <span className="text-slate-500 text-[10px] uppercase block">Peak Congestion</span>
                    <span className="font-bold text-rose-400 text-sm">
                      {spectrumStats.maxCh ? `CH ${spectrumStats.maxCh} (${spectrumStats.maxPkts} pkts)` : 'None'}
                    </span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-950/40 border border-emerald-500/40">
                    <span className="text-emerald-400 text-[10px] uppercase font-bold block">Recommended Channel</span>
                    <span className="font-bold text-emerald-300 text-sm">
                      CH {spectrumStats.recommendedCh} (Least Traffic)
                    </span>
                  </div>
                </div>
              </div>

              {/* Bar Chart Visualization */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-300">
                    Channel Packet Density (Click any channel bar to retune radio)
                  </span>
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500"></span> Low Traffic</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500"></span> Moderate</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-rose-500"></span> Congested</span>
                    <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm border-2 border-cyan-400 bg-cyan-500/40"></span> Active CH</span>
                  </div>
                </div>

                <div className="h-64 bg-slate-900/50 border border-slate-800 rounded-xl p-3 flex items-end gap-1 sm:gap-2 overflow-x-auto scrollbar-thin scrollbar-thumb-slate-800">
                  {spectrumChannels.map(c => {
                    const count = channelStats[c.ch] || 0;
                    const pct = spectrumStats.maxPkts > 0 ? Math.round((count / spectrumStats.maxPkts) * 100) : 0;
                    const isActive = channel === c.ch;

                    let barColor = 'bg-slate-800 hover:bg-slate-700';
                    if (count > 0) {
                      if (pct > 60) barColor = 'bg-rose-500 hover:bg-rose-400 shadow-rose-glow';
                      else if (pct > 25) barColor = 'bg-amber-500 hover:bg-amber-400';
                      else barColor = 'bg-emerald-500 hover:bg-emerald-400';
                    }
                    if (isActive) {
                      barColor += ' ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-950';
                    }

                    const barHeightPct = Math.max(pct, count > 0 ? 8 : 3);

                    return (
                      <div
                        key={c.ch}
                        onClick={() => handleChannelChange(c.ch)}
                        title={`CH ${c.ch} (${c.freq}): ${count} packets (${pct}% relative congestion). Click to tune.`}
                        className="flex-1 min-w-[28px] max-w-[48px] h-full flex flex-col justify-end items-center cursor-pointer group select-none transition"
                      >
                        {/* Packet Count label */}
                        <div className="text-[9px] text-slate-400 group-hover:text-cyan-300 font-mono mb-1 truncate">
                          {count > 0 ? count : ''}
                        </div>

                        {/* Bar */}
                        <div
                          style={{ height: `${barHeightPct}%` }}
                          className={`w-full rounded-t-sm transition-all duration-300 ${barColor}`}
                        />

                        {/* Channel Number Label */}
                        <div className={`mt-2 text-[10px] font-bold font-mono transition ${
                          isActive ? 'text-cyan-400 font-extrabold' : 'text-slate-400 group-hover:text-slate-200'
                        }`}>
                          {c.ch}
                        </div>

                        {/* Band Badge */}
                        <div className="text-[8px] text-slate-500">
                          {c.band.replace(' GHz', 'G')}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Spectrum Guidance Note */}
              <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs text-slate-400 flex items-start gap-2.5">
                <BarChart2 className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold text-slate-200">Spectrum Optimization Guide:</span>{' '}
                  In 2.4 GHz, use non-overlapping channels <span className="font-mono text-cyan-300 font-semibold">1, 6, or 11</span> to minimize co-channel interference. In 5 GHz, UNII channels (<span className="font-mono text-cyan-300">36-48</span> and <span className="font-mono text-cyan-300">149-165</span>) provide wider 80MHz bandwidth and significantly less noise.
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Live Frames Feed */}
          {activeTab === 'frames' && (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
              {frames.length === 0 ? (
                <div className="p-12 text-center text-slate-600 text-xs">
                  No frames captured yet.
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase">
                    <tr>
                      <th className="py-2 px-3">Time</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">SSID / Info</th>
                      <th className="py-2 px-3">Station / Source</th>
                      <th className="py-2 px-3">BSSID</th>
                      <th className="py-2 px-3">CH</th>
                      <th className="py-2 px-3 text-right">RSSI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {frames.map((f, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/40 transition-colors">
                        <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{f.timestamp || f.lastSeen}</td>
                        <td className="py-1.5 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            f.isDeauth ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40' :
                            f.frameCategory === 'Data' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' :
                            'bg-slate-800 text-slate-300'
                          }`}>
                            {f.type}
                          </span>
                        </td>
                        <td className="py-1.5 px-3 text-cyan-300 whitespace-nowrap font-medium">
                          {f.ssid || f.reasonDescription || f.direction || '-'}
                        </td>
                        <td className="py-1.5 px-3 text-slate-300 whitespace-nowrap">{f.stationMac || f.sourceMac}</td>
                        <td className="py-1.5 px-3 text-slate-400 whitespace-nowrap">{f.bssid}</td>
                        <td className="py-1.5 px-3 text-slate-300 whitespace-nowrap">CH {f.channel}</td>
                        <td className="py-1.5 px-3 text-right whitespace-nowrap font-bold text-cyan-400">
                          {f.rssi} dBm
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab 4: Raw Hex View */}
          {activeTab === 'hex' && (
            <div className="p-3 max-h-[500px] overflow-y-auto space-y-1 text-[11px] leading-relaxed scrollbar-thin scrollbar-thumb-slate-800">
              {rawHexLogs.length === 0 ? (
                <div className="p-12 text-center text-slate-600 text-xs">
                  No raw hex packets in buffer.
                </div>
              ) : (
                rawHexLogs.map((log, i) => (
                  <div key={i} className="text-slate-400 hover:text-cyan-300 hover:bg-slate-900/50 px-2 py-0.5 rounded transition">
                    {log}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 5: Network Topology View */}
          {activeTab === 'topology' && (
            <TopologyView
              devices={devices}
              clients={clients}
              selectedItem={selectedItem}
              onSelectNode={(item) => setSelectedItem(item)}
              onSwitchToTable={() => setActiveTab('aps')}
            />
          )}

          {/* Tab 6: Identifier Anomaly Tracking */}
          {activeTab === 'anomalies' && (
            <div className="p-4 space-y-4">
              {/* Header Guidance Banner */}
              <div className="p-3.5 bg-rose-950/20 border border-rose-800/40 rounded-xl flex items-start gap-3 text-xs">
                <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-rose-300">
                    MAC Address Rotation & Identifier Anomaly Detection
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Mobile operating systems (iOS, Android, Windows) randomize their hardware MAC addresses for privacy.
                    However, devices often maintain a persistent list of probed networks. When multiple distinct MAC identifiers
                    broadcast the <span className="font-bold text-rose-300">exact same sequence of probed SSIDs</span> in close temporal proximity,
                    they are correlated and flagged as a <span className="font-bold text-rose-300">Potential Identifier Rotation Anomaly</span>.
                  </p>
                </div>
              </div>

              {/* Anomalies List */}
              {anomalies.length === 0 ? (
                <div className="p-12 text-center text-slate-500 text-xs bg-slate-900/30 rounded-xl border border-slate-800">
                  <ShieldCheck className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
                  <p className="font-bold text-slate-300">No Identifier Rotation Anomalies Detected</p>
                  <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                    All observed probe requests originate from consistent hardware identifiers. Anomalies will be flagged in real time if multiple MACs broadcast matching probe request fingerprints.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {anomalies.map((anom) => (
                    <div
                      key={anom.id}
                      className="bg-slate-900/60 border border-rose-800/50 rounded-xl p-4 space-y-3 hover:border-rose-600/70 transition shadow-lg"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 uppercase tracking-wider">
                            {anom.type}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-200">
                            {anom.deviceCount} Observed Hardware Identifiers
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          Last Seen: <span className="text-slate-300 font-bold">{anom.lastSeen}</span>
                        </div>
                      </div>

                      {/* Sequence of Probed Networks */}
                      <div className="space-y-1">
                        <div className="text-[10px] uppercase font-semibold text-slate-500">
                          Correlated Probed Network Sequence:
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                          {anom.probedSequence.map((ssid, sIdx) => (
                            <React.Fragment key={sIdx}>
                              <span className="px-2 py-1 bg-slate-950 text-cyan-300 border border-slate-800 rounded font-semibold">
                                {ssid}
                              </span>
                              {sIdx < anom.probedSequence.length - 1 && (
                                <span className="text-slate-600 font-bold">➔</span>
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                      </div>

                      {/* Correlated MAC Identifiers Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                          <thead>
                            <tr className="border-b border-slate-800 text-[10px] text-slate-500 uppercase">
                              <th className="py-1 px-2">Observed MAC</th>
                              <th className="py-1 px-2">Vendor OUI</th>
                              <th className="py-1 px-2">RSSI</th>
                              <th className="py-1 px-2">Channel</th>
                              <th className="py-1 px-2 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60">
                            {anom.clients.map((cli, cIdx) => (
                              <tr key={cli.mac || cIdx} className="hover:bg-slate-800/40">
                                <td className="py-1.5 px-2 text-rose-300 font-bold">{cli.mac}</td>
                                <td className="py-1.5 px-2 text-slate-300">{cli.vendor}</td>
                                <td className="py-1.5 px-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${getRssiBadge(cli.rssi)}`}>
                                    {cli.rssi} dBm
                                  </span>
                                </td>
                                <td className="py-1.5 px-2 text-slate-400">CH {cli.channel}</td>
                                <td className="py-1.5 px-2 text-right">
                                  <button
                                    onClick={() => setSelectedItem({ type: 'client', data: cli })}
                                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] transition"
                                  >
                                    Inspect
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 7: Signal Spatial Mapping Heatmap */}
          {activeTab === 'signalMap' && (
            <div className="p-3">
              <GeospatialMap
                devices={devices}
                clients={clients}
                currentGps={currentGps}
                onSelectDevice={(dev) => setSelectedItem(dev?.type ? dev : { type: 'ap', data: dev })}
              />
            </div>
          )}

          {/* Tab 8: Spectrum Waterfall Visualization */}
          {activeTab === 'waterfall' && (
            <div className="p-3">
              <SpectrumWaterfall
                latestSlice={latestWaterfallSlice}
                currentChannel={channel}
                isMonitoring={isMonitoring || isSimulateRf}
              />
            </div>
          )}

          {/* Tab 8b: 2.4GHz Physical Channel Overlap & Interference Visualizer */}
          {activeTab === 'interference' && (
            <ChannelOverlapChart
              channelStats={channelStats}
              devices={devices}
              clients={clients}
              currentChannel={channel}
            />
          )}

          {/* Tab 9: Observable Cleartext Protocol Telemetry */}
          {activeTab === 'cleartext' && (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
              {cleartextMetadata.length === 0 ? (
                <div className="p-12 text-center text-slate-600 text-xs space-y-2">
                  <Globe className="w-8 h-8 text-slate-600 mx-auto" />
                  <div>No unencrypted cleartext telemetry observed yet.</div>
                  <div className="text-slate-500">
                    Cleartext DNS queries (UDP 53) and HTTP request streams (TCP 80) from unencrypted Data frames will be logged here.
                  </div>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                    <tr>
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Protocol</th>
                      <th className="py-2.5 px-3">Client Station MAC</th>
                      <th className="py-2.5 px-3">Target BSSID</th>
                      <th className="py-2.5 px-3">Observed Domain / Endpoint</th>
                      <th className="py-2.5 px-3">CH</th>
                      <th className="py-2.5 px-3 text-right">RSSI</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900">
                    {cleartextMetadata.map((meta, idx) => (
                      <tr key={idx} className="hover:bg-slate-900/60 transition-colors">
                        <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{meta.timestamp}</td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            meta.protocol === 'DNS' 
                              ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' 
                              : 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                          }`}>
                            {meta.protocol} {meta.type || ''}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono font-bold text-slate-200 whitespace-nowrap">{meta.clientMac || '—'}</td>
                        <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">{meta.bssid || '—'}</td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-amber-300 font-mono">{meta.domain}</span>
                            {meta.endpoint && (
                              <span className="text-slate-400 font-mono text-[11px]">{meta.endpoint}</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-300 whitespace-nowrap">CH {meta.channel || '—'}</td>
                        <td className="py-2 px-3 text-right font-bold text-cyan-400 whitespace-nowrap">
                          {meta.rssi != null ? `${meta.rssi} dBm` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab 10: Security Heuristics Vulnerability Audit */}
          {activeTab === 'heuristics' && (
            <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Vulnerabilities</div>
                  <div className={`text-2xl font-bold mt-1 ${heuristicReport.totalVulnerabilities > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {heuristicReport.totalVulnerabilities}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Across {heuristicReport.scannedCount} evaluated APs</div>
                </div>

                <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-amber-300 uppercase font-semibold">Default Factory SSIDs</div>
                  <div className="text-2xl font-bold text-amber-400 mt-1">
                    {heuristicReport.defaultSSIDs.length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Unhardened out-of-the-box names</div>
                </div>

                <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-rose-300 uppercase font-semibold">Weak Legacy Encryption</div>
                  <div className="text-2xl font-bold text-rose-400 mt-1">
                    {heuristicReport.weakEncryption.length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Deprecated WEP / WPA-TKIP ciphers</div>
                </div>

                <div className="bg-slate-900/90 border border-yellow-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-yellow-300 uppercase font-semibold">Open / Unencrypted</div>
                  <div className="text-2xl font-bold text-yellow-400 mt-1">
                    {heuristicReport.openNetworks.length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Cleartext link-layer broadcast</div>
                </div>
              </div>

              {/* Zero Vulnerabilities State */}
              {heuristicReport.totalVulnerabilities === 0 && (
                <div className="p-8 text-center bg-slate-900/40 border border-emerald-500/30 rounded-xl space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                  <div className="text-sm font-bold text-emerald-200">All Discovered Networks Pass Heuristic Baseline</div>
                  <div className="text-xs text-slate-400 max-w-md mx-auto">
                    No factory-default vendor SSIDs, legacy WEP/TKIP ciphers, or unencrypted open broadcast networks were detected in the current RF airspace.
                  </div>
                </div>
              )}

              {/* Category 1: Default SSIDs */}
              {heuristicReport.defaultSSIDs.length > 0 && (
                <div className="bg-slate-900/60 border border-amber-500/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-200">Default Factory SSIDs ({heuristicReport.defaultSSIDs.length})</div>
                        <div className="text-[11px] text-slate-400">Identifies hardware vendor and indicates default router configuration with potential default credentials.</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                      Medium Risk
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="text-[11px] text-slate-400 uppercase border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">BSSID</th>
                          <th className="py-2 px-3">Default SSID</th>
                          <th className="py-2 px-3">Vendor</th>
                          <th className="py-2 px-3">Security</th>
                          <th className="py-2 px-3">Actionable Recommendation</th>
                          <th className="py-2 px-3 text-right">Inspect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {heuristicReport.defaultSSIDs.map((dev, i) => (
                          <tr key={dev.bssid || i} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-2 px-3 font-mono font-bold text-slate-300">{dev.bssid}</td>
                            <td className="py-2 px-3 font-bold text-amber-300">{dev.ssid}</td>
                            <td className="py-2 px-3 text-slate-300">{dev.vendor || '—'}</td>
                            <td className="py-2 px-3 text-slate-400">{dev.security || 'Open'}</td>
                            <td className="py-2 px-3 text-[11px] text-slate-400">{dev.recommendation}</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Category 2: Weak Encryption */}
              {heuristicReport.weakEncryption.length > 0 && (
                <div className="bg-slate-900/60 border border-rose-500/50 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40">
                        <ShieldAlert className="w-4 h-4 text-rose-400" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-200">Deprecated Legacy Encryption ({heuristicReport.weakEncryption.length})</div>
                        <div className="text-[11px] text-slate-400">WEP (RC4) and WPA-TKIP suffer from practical mathematical key recovery attacks and message forgery.</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-600/30 text-rose-300 border border-rose-500/50">
                      Critical Risk
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="text-[11px] text-slate-400 uppercase border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">BSSID</th>
                          <th className="py-2 px-3">SSID</th>
                          <th className="py-2 px-3">Flawed Security Suite</th>
                          <th className="py-2 px-3">Vendor</th>
                          <th className="py-2 px-3">Remediation Guidance</th>
                          <th className="py-2 px-3 text-right">Inspect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {heuristicReport.weakEncryption.map((dev, i) => (
                          <tr key={dev.bssid || i} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-2 px-3 font-mono font-bold text-slate-300">{dev.bssid}</td>
                            <td className="py-2 px-3 font-bold text-slate-100">{dev.ssid}</td>
                            <td className="py-2 px-3">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                                {dev.security || 'WEP/TKIP'}
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-300">{dev.vendor || '—'}</td>
                            <td className="py-2 px-3 text-[11px] text-rose-200/90">{dev.recommendation}</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Category 3: Open Networks */}
              {heuristicReport.openNetworks.length > 0 && (
                <div className="bg-slate-900/60 border border-yellow-500/40 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                        <Lock className="w-4 h-4 text-yellow-400" />
                      </div>
                      <div>
                        <div className="font-bold text-sm text-slate-200">Open Unencrypted Broadcast Networks ({heuristicReport.openNetworks.length})</div>
                        <div className="text-[11px] text-slate-400">All wireless frames are transmitted in cleartext, enabling passive packet capture and session hijacking.</div>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-yellow-500/20 text-yellow-300 border border-yellow-500/40">
                      High Risk
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="text-[11px] text-slate-400 uppercase border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">BSSID</th>
                          <th className="py-2 px-3">SSID</th>
                          <th className="py-2 px-3">Channel</th>
                          <th className="py-2 px-3">Vendor</th>
                          <th className="py-2 px-3">Hardening Recommendation</th>
                          <th className="py-2 px-3 text-right">Inspect</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {heuristicReport.openNetworks.map((dev, i) => (
                          <tr key={dev.bssid || i} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-2 px-3 font-mono font-bold text-slate-300">{dev.bssid}</td>
                            <td className="py-2 px-3 font-bold text-yellow-300">{dev.ssid}</td>
                            <td className="py-2 px-3 text-slate-300">CH {dev.channel || '—'}</td>
                            <td className="py-2 px-3 text-slate-300">{dev.vendor || '—'}</td>
                            <td className="py-2 px-3 text-[11px] text-slate-300">{dev.recommendation}</td>
                            <td className="py-2 px-3 text-right">
                              <button
                                onClick={() => setSelectedItem({ type: 'ap', data: dev })}
                                className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
                              >
                                Inspect
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab 11: Layer 3 Mappings */}
          {activeTab === 'layer3' && (
            <div className="p-4 space-y-4 max-h-[600px] overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">
              {/* Summary KPIs */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                  <div className="text-[11px] text-slate-400 uppercase font-semibold">Total Mappings</div>
                  <div className="text-2xl font-bold mt-1 text-cyan-400">
                    {layer3Mappings.length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Correlated IP/MAC pairs</div>
                </div>

                <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-cyan-300 uppercase font-semibold">ARP Resolutions</div>
                  <div className="text-2xl font-bold text-cyan-300 mt-1">
                    {layer3Mappings.filter(m => m.protocol === 'ARP').length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">EtherType 0x0806 queries</div>
                </div>

                <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-purple-300 uppercase font-semibold">DHCP Leases</div>
                  <div className="text-2xl font-bold text-purple-400 mt-1">
                    {layer3Mappings.filter(m => m.protocol === 'DHCP').length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Port 67/68 transactions</div>
                </div>

                <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-amber-300 uppercase font-semibold">Hostnames Identified</div>
                  <div className="text-2xl font-bold text-amber-400 mt-1">
                    {layer3Mappings.filter(m => Boolean(m.hostname)).length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">DHCP Option 12 host tags</div>
                </div>
              </div>

              {/* Table or Empty State */}
              {layer3Mappings.length === 0 ? (
                <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-2">
                  <Network className="w-10 h-10 text-cyan-400/60 mx-auto" />
                  <div className="text-sm font-bold text-slate-200">No Layer 3 IP Mappings Captured Yet</div>
                  <div className="text-xs text-slate-400 max-w-md mx-auto">
                    As unencrypted Address Resolution Protocol (ARP) announcements or DHCP lease allocations transit the airspace, sender IP and MAC addresses will be decoded and correlated here in real-time.
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Protocol</th>
                        <th className="py-2.5 px-3">IP Address</th>
                        <th className="py-2.5 px-3">MAC Address</th>
                        <th className="py-2.5 px-3">DHCP Hostname</th>
                        <th className="py-2.5 px-3">Vendor OUI</th>
                        <th className="py-2.5 px-3">Associated BSSID</th>
                        <th className="py-2.5 px-3">Last Seen</th>
                        <th className="py-2.5 px-3 text-right">Inspect</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {layer3Mappings.map((mapping, idx) => {
                        const targetAp = devices[mapping.mac] || (mapping.bssid ? devices[mapping.bssid] : null);
                        const targetClient = clients[mapping.mac];
                        const inspectTarget = targetClient 
                          ? { type: 'client', data: targetClient } 
                          : targetAp 
                          ? { type: 'ap', data: targetAp } 
                          : null;

                        return (
                          <tr key={`${mapping.mac}-${mapping.ip}-${idx}`} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                mapping.protocol === 'DHCP'
                                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                  : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                              }`}>
                                {mapping.protocol || 'ARP'}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                              <span className="px-1.5 py-0.5 rounded bg-cyan-950/60 border border-cyan-800 text-[11px]">
                                {mapping.ip}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-mono font-bold text-slate-300 whitespace-nowrap">
                              {mapping.mac}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {mapping.hostname ? (
                                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono text-[11px] font-semibold">
                                  {mapping.hostname}
                                </span>
                              ) : (
                                <span className="text-slate-600 font-mono text-[10px]">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-slate-300 whitespace-nowrap">
                              {mapping.vendor || getVendor(mapping.mac) || '—'}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-400 whitespace-nowrap">
                              {mapping.bssid || '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                              {mapping.timestamp ? new Date(mapping.timestamp).toLocaleTimeString() : '—'}
                            </td>
                            <td className="py-2 px-3 text-right whitespace-nowrap">
                              {inspectTarget ? (
                                <button
                                  onClick={() => setSelectedItem(inspectTarget)}
                                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] font-semibold transition"
                                >
                                  Inspect
                                </button>
                              ) : (
                                <span className="text-slate-600 font-mono text-[10px]">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 18. Automation Rule Engine View */}
          {activeTab === 'rules' && (
            <div className="p-4 space-y-5">
              {/* Top KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="bg-slate-900/90 border border-amber-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-amber-300 uppercase font-semibold">Total Rules</div>
                  <div className="text-2xl font-bold text-amber-400 mt-1">{rules.length}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Persisted in local storage</div>
                </div>

                <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-emerald-300 uppercase font-semibold">Active Rules</div>
                  <div className="text-2xl font-bold text-emerald-400 mt-1">
                    {rules.filter(r => r.enabled !== false).length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Actively evaluating events</div>
                </div>

                <div className="bg-slate-900/90 border border-purple-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-purple-300 uppercase font-semibold">Webhooks Configured</div>
                  <div className="text-2xl font-bold text-purple-400 mt-1">
                    {rules.filter(r => r.actionType === RULE_ACTION_TYPES.WEBHOOK).length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">HTTP POST integrations</div>
                </div>

                <div className="bg-slate-900/90 border border-cyan-500/30 rounded-xl p-3">
                  <div className="text-[11px] text-cyan-300 uppercase font-semibold">Notifications & Audio</div>
                  <div className="text-2xl font-bold text-cyan-400 mt-1">
                    {rules.filter(r => r.actionType === RULE_ACTION_TYPES.NATIVE_NOTIFICATION || r.actionType === RULE_ACTION_TYPES.AUDIO_BEEP).length}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Real-time alert actions</div>
                </div>
              </div>

              {/* Rule Creation Form Card */}
              <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 shadow-lg space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-amber-400" />
                    <span className="font-bold text-xs uppercase text-slate-200">Create Automation Rule</span>
                  </div>
                  <span className="text-[11px] text-slate-500">Configure triggers, targets, and reactive actions</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Rule Name */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Rule Name:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alert on VIP Laptop or Rogue AP"
                      value={newRuleName}
                      onChange={(e) => setNewRuleName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-medium"
                    />
                  </div>

                  {/* Trigger Event Type */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Trigger Event Type:
                    </label>
                    <select
                      value={newRuleEventType}
                      onChange={(e) => setNewRuleEventType(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-400 font-medium"
                    >
                      <option value={RULE_EVENT_TYPES.DEVICE_CONNECTED}>DEVICE_CONNECTED (Discovered / Associated)</option>
                      <option value={RULE_EVENT_TYPES.DEVICE_DISCONNECTED}>DEVICE_DISCONNECTED (Inactive / Missing &gt;60s)</option>
                      <option value={RULE_EVENT_TYPES.ANOMALY_DETECTED}>ANOMALY_DETECTED (Deauth Flood / Rogue AP)</option>
                    </select>
                  </div>

                  {/* Target MAC */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Target MAC Address (* for Any):
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 00:11:22:33:44:55 or *"
                      value={newRuleTargetMac}
                      onChange={(e) => setNewRuleTargetMac(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                  {/* Action Type */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Action Type:
                    </label>
                    <select
                      value={newRuleActionType}
                      onChange={(e) => setNewRuleActionType(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-400 font-medium"
                    >
                      <option value={RULE_ACTION_TYPES.NATIVE_NOTIFICATION}>NATIVE_NOTIFICATION (Desktop Push Alert)</option>
                      <option value={RULE_ACTION_TYPES.AUDIO_BEEP}>AUDIO_BEEP (Web Audio Chime / Beep)</option>
                      <option value={RULE_ACTION_TYPES.WEBHOOK}>WEBHOOK (HTTP POST JSON Payload)</option>
                    </select>
                  </div>

                  {/* Action Payload */}
                  <div className="md:col-span-2">
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Action Payload / Parameters:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        placeholder={
                          newRuleActionType === RULE_ACTION_TYPES.WEBHOOK
                            ? 'https://example.com/api/webhook (Full URL for JSON POST)'
                            : newRuleActionType === RULE_ACTION_TYPES.AUDIO_BEEP
                            ? 'Beep frequency in Hz (default 880)'
                            : 'Custom notification message body (optional)'
                        }
                        value={newRuleActionPayload}
                        onChange={(e) => setNewRuleActionPayload(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-medium"
                      />
                      <button
                        onClick={() => {
                          if (!newRuleName.trim()) {
                            setStatusMessage('Please enter a descriptive rule name.');
                            setStatusLevel('warning');
                            return;
                          }
                          const rule = createRule({
                            name: newRuleName,
                            eventType: newRuleEventType,
                            targetMac: newRuleTargetMac,
                            actionType: newRuleActionType,
                            actionPayload: newRuleActionPayload
                          });
                          setRules(prev => [rule, ...prev]);
                          setNewRuleName('');
                          setNewRuleTargetMac('');
                          setNewRuleActionPayload('');
                          setStatusMessage(`Created automation rule "${rule.name}"`);
                          setStatusLevel('success');
                        }}
                        className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shrink-0 shadow-sm"
                      >
                        Add Rule
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Rules List Table or Empty State */}
              {rules.length === 0 ? (
                <div className="p-12 text-center bg-slate-900/40 border border-slate-800/80 rounded-xl space-y-2">
                  <Bell className="w-10 h-10 text-amber-400/60 mx-auto" />
                  <div className="text-sm font-bold text-slate-300">No Automation Rules Configured</div>
                  <div className="text-xs text-slate-500 max-w-md mx-auto">
                    Define custom rules above to dispatch HTTP webhooks, trigger desktop notifications, or sound audible chimes when devices connect, disconnect, or exhibit security anomalies.
                  </div>
                </div>
              ) : (
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950 shadow-lg">
                  <table className="w-full text-left text-xs text-slate-300 border-collapse">
                    <thead className="bg-slate-900/90 sticky top-0 border-b border-slate-800 text-[11px] text-slate-400 font-semibold uppercase tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Rule Name</th>
                        <th className="py-2.5 px-3">Event Trigger</th>
                        <th className="py-2.5 px-3">Target MAC</th>
                        <th className="py-2.5 px-3">Action Type</th>
                        <th className="py-2.5 px-3">Action Payload</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-sans">
                      {rules.map((rule) => (
                        <tr key={rule.id} className="hover:bg-slate-800/40 transition-colors">
                          <td className="py-2 px-3 whitespace-nowrap">
                            <button
                              onClick={() => {
                                setRules(prev => prev.map(r => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
                              }}
                              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                                rule.enabled !== false
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : 'bg-slate-800 text-slate-500 border-slate-700'
                              }`}
                            >
                              {rule.enabled !== false ? 'ENABLED' : 'DISABLED'}
                            </button>
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-100 whitespace-nowrap">
                            {rule.name}
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              rule.eventType === RULE_EVENT_TYPES.DEVICE_CONNECTED
                                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                                : rule.eventType === RULE_EVENT_TYPES.DEVICE_DISCONNECTED
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                            }`}>
                              {rule.eventType}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-cyan-300 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[11px]">
                              {rule.targetMac || '*'}
                            </span>
                          </td>
                          <td className="py-2 px-3 whitespace-nowrap">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                              rule.actionType === RULE_ACTION_TYPES.WEBHOOK
                                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                                : rule.actionType === RULE_ACTION_TYPES.AUDIO_BEEP
                                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            }`}>
                              {rule.actionType}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-400 text-[11px] max-w-xs truncate" title={rule.actionPayload || 'Default'}>
                            {rule.actionPayload || '—'}
                          </td>
                          <td className="py-2 px-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={async () => {
                                  try {
                                    const testDevice = {
                                      bssid: rule.targetMac !== '*' ? rule.targetMac : '00:C0:CA:98:76:54',
                                      clientMac: rule.targetMac !== '*' ? rule.targetMac : '00:C0:CA:98:76:54',
                                      ssid: 'Test-Network',
                                      vendor: 'Alfa Test Device',
                                      rssi: -55
                                    };
                                    await executeRuleAction(rule, testDevice, rule.eventType);
                                    setStatusMessage(`Triggered test execution for rule "${rule.name}"`);
                                    setStatusLevel('success');
                                  } catch (testErr) {
                                    setStatusMessage(`Test rule failed: ${testErr.message || testErr}`);
                                    setStatusLevel('error');
                                  }
                                }}
                                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 text-[11px] font-semibold transition"
                              >
                                Test
                              </button>
                              <button
                                onClick={() => {
                                  setRules(prev => prev.filter(r => r.id !== rule.id));
                                  setStatusMessage(`Deleted rule "${rule.name}"`);
                                  setStatusLevel('info');
                                }}
                                className="p-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-[11px] border border-rose-500/30 transition"
                                title="Delete Rule"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>


        {/* Slide-out / Side Detail Panel */}
        {selectedItem && (() => {
          const targetMac = (selectedItem.data.bssid || selectedItem.data.clientMac || '').toUpperCase();
          const currentAnnotation = deviceAnnotations[targetMac] || null;

          return (
            <div className="lg:col-span-1 bg-[#171920] border border-cyan-500/40 rounded-xl p-4 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  {selectedItem.type === 'ap' ? (
                    <Radio className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <Smartphone className="w-4 h-4 text-purple-400" />
                  )}
                  <span className="font-bold text-xs uppercase text-slate-200">
                    {selectedItem.type === 'ap' ? 'Access Point Details' : 'Station Client Details'}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button 
                    onClick={() => setIsEditingNote(prev => !prev)}
                    title="Edit Custom Device Annotation & Note (📝)"
                    className={`p-1.5 rounded transition ${
                      isEditingNote 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                        : 'text-slate-400 hover:text-amber-300 hover:bg-slate-800'
                    }`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button 
                    onClick={() => {
                      setSelectedItem(null);
                      setIsEditingNote(false);
                    }}
                    className="text-slate-400 hover:text-white font-bold text-xs p-1 rounded hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Custom Annotation Card (if saved and not currently in edit mode) */}
              {currentAnnotation && !isEditingNote && (
                <div 
                  className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1 transition-all"
                  style={currentAnnotation.customColor ? { borderLeftColor: currentAnnotation.customColor, borderLeftWidth: '4px' } : undefined}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span 
                        className="w-2.5 h-2.5 rounded-full shrink-0" 
                        style={{ backgroundColor: currentAnnotation.customColor || '#10b981' }}
                      />
                      <span className="font-bold text-amber-300 text-xs">
                        {currentAnnotation.customLabel || 'Annotated Device'}
                      </span>
                    </div>
                    <button
                      onClick={() => setIsEditingNote(true)}
                      className="text-[10px] text-cyan-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>Edit Note</span>
                    </button>
                  </div>
                  {currentAnnotation.notes && (
                    <p className="text-[11px] text-slate-300 italic pt-0.5 whitespace-pre-wrap leading-relaxed">
                      "{currentAnnotation.notes}"
                    </p>
                  )}
                </div>
              )}

              {/* Custom Annotation Editor Panel */}
              {isEditingNote && (
                <div className="p-3 rounded-xl bg-slate-900/90 border border-amber-500/40 space-y-3 shadow-lg">
                  <div className="text-[11px] font-bold text-amber-300 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5" />
                      <span>Device Annotation & Tagging</span>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono">{targetMac}</span>
                  </div>

                  {/* Custom Label Input */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Custom Label / Alias:
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. My Office Printer, Lab AP 1"
                      value={editNoteLabel}
                      onChange={(e) => setEditNoteLabel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-100 placeholder-slate-600 outline-none focus:border-amber-400 font-medium"
                    />
                  </div>

                  {/* Highlight Color Picker */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Highlight Color:
                    </label>
                    <div className="flex items-center gap-2">
                      {[
                        { name: 'Emerald', hex: '#10b981' },
                        { name: 'Cyan', hex: '#06b6d4' },
                        { name: 'Blue', hex: '#3b82f6' },
                        { name: 'Purple', hex: '#a855f7' },
                        { name: 'Amber', hex: '#f59e0b' },
                        { name: 'Rose', hex: '#f43f5e' }
                      ].map((col) => (
                        <button
                          key={col.hex}
                          type="button"
                          onClick={() => setEditNoteColor(col.hex)}
                          className={`w-5 h-5 rounded-full transition-transform ${
                            editNoteColor === col.hex ? 'ring-2 ring-white scale-110' : 'opacity-75 hover:opacity-100 hover:scale-105'
                          }`}
                          style={{ backgroundColor: col.hex }}
                          title={col.name}
                        />
                      ))}
                      {editNoteColor && (
                        <button
                          type="button"
                          onClick={() => setEditNoteColor('')}
                          className="text-[10px] text-slate-500 hover:text-slate-300 underline ml-1"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Notes Textarea */}
                  <div>
                    <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                      Device Notes:
                    </label>
                    <textarea
                      rows={2}
                      placeholder="Physical location, device type, owner, observations..."
                      value={editNoteText}
                      onChange={(e) => setEditNoteText(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-amber-400 resize-none"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800">
                    {currentAnnotation ? (
                      <button
                        type="button"
                        onClick={handleDeleteAnnotation}
                        className="px-2 py-1 rounded bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 text-[11px] font-semibold border border-rose-500/30 transition"
                      >
                        Delete
                      </button>
                    ) : <span />}
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setIsEditingNote(false)}
                        className="px-2.5 py-1 rounded bg-slate-800 text-slate-400 hover:text-slate-200 text-[11px] font-semibold transition"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveAnnotation}
                        className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-bold transition shadow-sm"
                      >
                        Save Note
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3 text-xs">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">MAC Address</div>
                  <div className="font-bold text-slate-100 text-sm mt-0.5">
                    {selectedItem.data.bssid || selectedItem.data.clientMac}
                  </div>
                </div>

              <div>
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Vendor (OUI Lookup)</div>
                <div className="font-bold text-cyan-300 mt-0.5">
                  {selectedItem.data.vendor || getVendor(selectedItem.data.bssid || selectedItem.data.clientMac)}
                </div>
              </div>

              {selectedItem.type === 'ap' ? (
                <>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">SSID</div>
                    <div className="font-semibold text-slate-200 mt-0.5 flex items-center gap-1.5">
                      <span>{selectedItem.data.ssid}</span>
                      {(selectedItem.data.isUnmasked || selectedItem.data.originalHidden) && selectedItem.data.ssid !== '<Hidden SSID>' && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5 text-amber-400" />
                          <span>(Unmasked)</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Security Encryption</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSecurityBadge(selectedItem.data.security)}`}>
                        {selectedItem.data.security || 'Open'}
                      </span>
                      {(selectedItem.data.isMfpRequired || selectedItem.data.isMfpCapable || selectedItem.data.mfp) && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{selectedItem.data.isMfpRequired || selectedItem.data.mfp === 'required' ? '802.11w MFP Required' : '802.11w MFP Supported'}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">WPA 4-Way Handshake</div>
                    <div className="mt-0.5">
                      {handshakes[selectedItem.data.bssid]?.isComplete || selectedItem.data.hasHandshake ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          <Lock className="w-3 h-3 text-emerald-400" />
                          Complete (Captured: {handshakes[selectedItem.data.bssid]?.messages?.join(', ') || 'M1, M2'})
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">No handshake captured yet</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Fast BSS Roaming (802.11k/v/r)</div>
                    <div className="flex items-center gap-1.5 mt-1">
                      {selectedItem.data.roaming?.k && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          802.11k (RRM)
                        </span>
                      )}
                      {selectedItem.data.roaming?.v && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          802.11v (BSS Transition)
                        </span>
                      )}
                      {selectedItem.data.roaming?.r && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          802.11r (FT Handshake)
                        </span>
                      )}
                      {!selectedItem.data.roaming?.k && !selectedItem.data.roaming?.v && !selectedItem.data.roaming?.r && (
                        <span className="text-slate-500 text-[11px] italic">No roaming capabilities advertised</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Wi-Fi 6 (802.11ax) & BSS Color</div>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {selectedItem.data.isWifi6 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/20 text-blue-300 border border-blue-500/40">
                          802.11ax High-Efficiency
                        </span>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">Legacy Wi-Fi</span>
                      )}
                      {(selectedItem.data.bssColor !== undefined && selectedItem.data.bssColor !== null) && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-mono">
                          BSS Color: {selectedItem.data.bssColor} {selectedItem.data.bssColorDisabled ? '(Disabled)' : '(Spatial Reuse)'}
                        </span>
                      )}
                    </div>
                    {selectedItem.data.heCapabilities && (
                      <div className="mt-1 text-[10px] text-slate-400 font-mono space-y-0.5">
                        {selectedItem.data.heCapabilities.macCap && <div>HE MAC: {selectedItem.data.heCapabilities.macCap}</div>}
                        {selectedItem.data.heCapabilities.phyCap && <div>HE PHY: {selectedItem.data.heCapabilities.phyCap.slice(0, 16)}...</div>}
                      </div>
                    )}
                  </div>
                  {selectedItem.data.isRogueSuspect && (
                    <div className="p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/60 text-rose-200">
                      <div className="font-bold flex items-center gap-1.5 text-rose-300">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                        <span>Rogue AP / Evil Twin Warning</span>
                      </div>
                      <div className="mt-1 text-[11px] text-rose-200/90 leading-tight">
                        {selectedItem.data.rogueReason || 'Conflicting encryption or hardware vendor detected for this SSID.'}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Associated AP BSSID</div>
                    <div className="font-semibold text-slate-200 mt-0.5">
                      {selectedItem.data.bssid}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Information Element Signature & OS</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[10px] text-cyan-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-800 break-all select-all">
                        {selectedItem.data.signature || 'None captured'}
                      </span>
                      {(() => {
                        const os = identifyOS(selectedItem.data.signature || selectedItem.data.tagSequence, {
                          dhcpHostname: selectedItem.data.dhcpHostname,
                          vendor: selectedItem.data.vendor
                        });
                        const pres = getOsPresentation(os);
                        return (
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 ${pres.badge}`}>
                            {renderClientOsIcon(selectedItem.data)}
                            <span>{pres.label}</span>
                          </span>
                        );
                      })()}
                      {signatureRandomizedMacs.has(selectedItem.data.clientMac) && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 shrink-0">
                          Potential Randomization
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase font-semibold">Probed Networks (SSIDs)</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedItem.data.probedSsids && selectedItem.data.probedSsids.length > 0 ? (
                        selectedItem.data.probedSsids.map((s, i) => (
                          <span key={i} className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                            {s}
                          </span>
                        ))
                      ) : selectedItem.data.probedSsid ? (
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 font-mono">
                          {selectedItem.data.probedSsid}
                        </span>
                      ) : (
                        <span className="text-slate-500 text-xs italic">No specific SSIDs probed</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Signal (RSSI) & SNR</div>
                  <div className="font-bold text-slate-200 mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className={`px-2 py-0.5 rounded text-[10px] border ${getRssiBadge(selectedItem.data.rssi)}`}>
                      {selectedItem.data.rssi} dBm
                    </span>
                    {selectedItem.data.snr !== null && selectedItem.data.snr !== undefined && (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${getSnrBadge(selectedItem.data.snr)}`}>
                        {selectedItem.data.snr} dB SNR
                      </span>
                    )}
                  </div>
                  <div className="mt-1.5">
                    <Sparkline data={selectedItem.data.rssiHistory} width={80} height={20} />
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Channel</div>
                  <div className="font-bold text-slate-200 mt-0.5">
                    CH {selectedItem.data.channel}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">Total Packets Captured</div>
                  <div className="font-bold text-purple-400 mt-0.5">
                    {selectedItem.data.packetCount || 1}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500 uppercase font-semibold">First Seen</div>
                  <div className="text-slate-400 text-[11px] mt-0.5 truncate" title={selectedItem.data.firstSeen || selectedItem.data.timestamp}>
                    {selectedItem.data.firstSeen || selectedItem.data.timestamp || 'N/A'}
                  </div>
                </div>
              </div>

              <div className="pt-1">
                <div className="text-[10px] text-slate-500 uppercase font-semibold">Last Seen</div>
                <div className="text-slate-400 text-[11px] mt-0.5 truncate" title={selectedItem.data.lastSeen || selectedItem.data.timestamp}>
                  {selectedItem.data.lastSeen || selectedItem.data.timestamp || 'N/A'}
                </div>
              </div>

              {/* GPS Coordinates & Distance if GPS enabled */}
              {isGpsTagging && (
                <div className="pt-2 border-t border-slate-800/80">
                  <div className="text-[10px] text-slate-500 uppercase font-semibold flex items-center gap-1">
                    <Compass className="w-3 h-3 text-cyan-400" />
                    <span>GPS Telemetry</span>
                  </div>
                  {selectedItem.data.latitude != null ? (
                    <div className="text-xs text-slate-300 mt-1 font-mono space-y-0.5">
                      <div>Lat: <span className="text-cyan-300 font-bold">{Number(selectedItem.data.latitude).toFixed(6)}</span></div>
                      <div>Lon: <span className="text-cyan-300 font-bold">{Number(selectedItem.data.longitude).toFixed(6)}</span></div>
                      {selectedItem.data.accuracy != null && (
                        <div className="text-[11px] text-slate-400">Accuracy: ±{Math.round(selectedItem.data.accuracy)} m</div>
                      )}
                      {currentGps?.latitude != null && (
                        <div className="text-[11px] text-emerald-400 font-semibold">
                          Distance: {calculateHaversineDistance(currentGps.latitude, currentGps.longitude, selectedItem.data.latitude, selectedItem.data.longitude)} m
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-slate-500 text-xs italic mt-0.5">Not tagged with GPS</div>
                  )}
                </div>
              )}

              {/* Hardware Output Endpoint Write Test Action */}
              <div className="pt-3 border-t border-slate-800/80">
                {(() => {
                  const hasTx = !activeDeviceProfile || hasCapability(activeDeviceProfile, CAPABILITIES.TX_SUPPORT);
                  return (
                    <div>
                      <button
                        onClick={handleRunWriteTest}
                        disabled={isTestingWrite || !hasTx}
                        title={!hasTx ? 'Transmit not supported by this chipset.' : 'Sends 32-byte test payload to verify USB OUT endpoint'}
                        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>{isTestingWrite ? 'Testing Endpoint...' : 'Run TX Loopback Test'}</span>
                      </button>
                      <div className="text-[10px] mt-1 text-center">
                        {!hasTx ? (
                          <span className="text-amber-400 font-semibold cursor-help" title="Transmit not supported by this chipset.">
                            Transmit not supported by this chipset.
                          </span>
                        ) : (
                          <span className="text-slate-500">
                            Sends 32-byte test payload to verify USB OUT endpoint
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Targeted Device PCAP Extraction Action */}
              <div className="pt-2 border-t border-slate-800/80">
                <button
                  onClick={() => {
                    const mac = (selectedItem.data.bssid || selectedItem.data.clientMac || '').toUpperCase();
                    if (!mac) return;
                    const count = downloadTargetedPcap(rawPacketsRef.current, mac);
                    if (count > 0) {
                      setStatusMessage(`Exported targeted PCAP (${count.toLocaleString()} frames) for ${mac}`);
                      setStatusLevel('success');
                    } else {
                      setStatusMessage(`No captured frames found in buffer matching ${mac}`);
                      setStatusLevel('info');
                    }
                  }}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-xs font-bold transition shadow-sm"
                  title="Extract and download Wireshark PCAP containing only traffic related to this device"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export Device PCAP</span>
                </button>
              </div>
            </div>
          </div>
        ); })()}
      </div>

      {/* Session Manager Modal (IndexedDB) */}
      {isSessionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#171920] border border-slate-700/80 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-100">Saved Capture Sessions</h3>
                  <p className="text-[11px] text-slate-400">IndexedDB local offline storage for long-term telemetry</p>
                </div>
              </div>
              <button
                onClick={() => setIsSessionModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body: Session List */}
            <div className="p-5 flex-1 overflow-y-auto space-y-3">
              {savedSessionsList.length === 0 ? (
                <div className="py-12 text-center text-slate-500 text-xs">
                  <Database className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p>No saved capture sessions found in IndexedDB.</p>
                  <p className="text-[11px] text-slate-600 mt-1">Click "Save Session" in the action bar to preserve current capture state.</p>
                </div>
              ) : (
                savedSessionsList.map(sess => (
                  <div
                    key={sess.id}
                    className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 hover:border-slate-700 flex items-center justify-between gap-3 transition"
                  >
                    <div>
                      <div className="text-xs font-bold text-cyan-300 font-mono">
                        {sess.name || sess.id}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-3 font-mono">
                        <span>{new Date(sess.timestamp).toLocaleString()}</span>
                        <span>•</span>
                        <span className="text-emerald-400">{sess.deviceCount} APs</span>
                        <span>•</span>
                        <span className="text-purple-400">{sess.clientCount} Clients</span>
                        <span>•</span>
                        <span className="text-slate-500">{sess.packetCount} packets</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleLoadSession(sess.id)}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold transition"
                      >
                        Load Session
                      </button>
                      <button
                        onClick={(e) => handleDeleteSession(sess.id, e)}
                        className="p-1.5 rounded-lg bg-rose-600/10 hover:bg-rose-600/20 text-rose-400 border border-rose-500/20 transition"
                        title="Delete session"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between text-xs">
              <span className="text-slate-500 text-[11px]">
                {savedSessionsList.length} session{savedSessionsList.length !== 1 ? 's' : ''} stored locally
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveSession}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 text-slate-950 font-bold hover:bg-cyan-500 transition text-xs flex items-center gap-1.5"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Current State</span>
                </button>
                <button
                  onClick={() => setIsSessionModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-xs font-medium"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Windows Driver Setup Guide Modal */}
      <SetupGuideModal
        isOpen={isSetupGuideOpen}
        onClose={() => {
          setIsSetupGuideOpen(false);
          setSetupGuideError(null);
        }}
        initialError={setupGuideError}
      />
    </div>
  );
}


