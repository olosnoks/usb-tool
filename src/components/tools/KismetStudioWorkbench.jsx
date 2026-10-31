import React, { useState, useEffect, useMemo, useRef } from 'react';
import { DemoBanner } from '../common/DemoNotice';
import {
  Radio,
  Wifi,
  Shield,
  ShieldAlert,
  AlertTriangle,
  Server,
  Play,
  Square,
  RefreshCw,
  Download,
  Terminal,
  Search,
  Filter,
  Copy,
  Check,
  ExternalLink,
  HardDrive,
  Cpu,
  Activity,
  Signal,
  BarChart2,
  Globe,
  Clock,
  Compass,
  Info,
  CheckCircle2,
  Sliders,
  ChevronDown,
  ChevronRight,
  Layers,
  Lock,
  Unlock,
  Users
} from 'lucide-react';

// Common Alfa Network Adapter Hardware Profiles
const ALFA_PROFILES = [
  {
    id: 'awus036ach',
    name: 'Alfa AWUS036ACH',
    chipset: 'Realtek RTL8812AU',
    bands: 'Dual-Band 2.4 GHz & 5 GHz (802.11ac)',
    txPower: 'High Power (Up to 30 dBm / 1000 mW)',
    antennas: '2x 5dBi Dual-Band Dipole (RP-SMA)',
    driverLinux: 'rtl8812au-dkms (aircrack-ng repo)',
    monitorSupport: 'Monitor Mode + Frame Injection',
    desc: 'The industry-standard dual-band penetration testing card. Exceptional 5GHz ac packet capture.'
  },
  {
    id: 'awus1900',
    name: 'Alfa AWUS1900',
    chipset: 'Realtek RTL8814AU',
    bands: 'Dual-Band 2.4 GHz & 5 GHz (802.11ac 1900Mbps)',
    txPower: 'High Power (Quad Amplifier)',
    antennas: '4x 5dBi High-Gain Dual-Band Antennas',
    driverLinux: 'rtl8814au-dkms',
    monitorSupport: 'Monitor Mode + 4x4 MIMO Capture',
    desc: 'Quad-antenna monster with 4T4R MIMO. Ideal for congested corporate 5GHz high-density audits.'
  },
  {
    id: 'awus036nha',
    name: 'Alfa AWUS036NHA',
    chipset: 'Qualcomm Atheros AR9271',
    bands: '2.4 GHz (802.11b/g/n 150Mbps)',
    txPower: 'Standard High-Gain (28 dBm)',
    antennas: '1x 5dBi Dipole (RP-SMA)',
    driverLinux: 'ath9k_htc (Linux Kernel In-Tree)',
    monitorSupport: 'Flawless Monitor + Packet Injection',
    desc: 'Legendary rock-solid 2.4GHz injection stability. Plug-and-play with 100% open-source firmware.'
  },
  {
    id: 'awus036axm',
    name: 'Alfa AWUS036AXM / AXML',
    chipset: 'MediaTek MT7921AUN',
    bands: 'Tri-Band 2.4 GHz, 5 GHz & 6 GHz (Wi-Fi 6E 802.11ax)',
    txPower: 'High Efficiency Wi-Fi 6E',
    antennas: '2x Tri-Band High Gain Antennas',
    driverLinux: 'mt7921u (In-tree Linux 5.18+)',
    monitorSupport: '6GHz Monitor Mode + OFDMA Capture',
    desc: 'Next-gen Wi-Fi 6E capture card. Capable of sniffing uncrowded 6GHz spectrum with native kernel drivers.'
  },
  {
    id: 'awus036nh',
    name: 'Alfa AWUS036NH',
    chipset: 'Ralink RT3070',
    bands: '2.4 GHz (802.11b/g/n)',
    txPower: 'Ultra High Power (2000 mW)',
    antennas: '1x 5dBi High-Gain Dipole',
    driverLinux: 'rt2800usb (Kernel In-Tree)',
    monitorSupport: 'Monitor Mode + Long-Range Injection',
    desc: 'Classic long-range 2.4GHz powerhouse. High sensitivity for distant or rural wireless reconnaissance.'
  },
  {
    id: 'pau09',
    name: 'Panda Wireless PAU09',
    chipset: 'Ralink RT5572',
    bands: 'Dual-Band 2.4 GHz & 5 GHz (802.11a/b/g/n N600)',
    txPower: 'High Gain Dual-Band (300Mbps + 300Mbps)',
    antennas: '2x 5dBi Detachable Dual-Band Dipole (SMA)',
    driverLinux: 'rt2800usb (In-tree Linux Kernel)',
    monitorSupport: 'Dual-Band Monitor Mode + Packet Injection',
    desc: 'Plug-and-play N600 dual-band 2x2:2 audit adapter powered by Ralink RT5572 (VID 0x148F : PID 0x5572).'
  }
];

// Rich simulated Alfa + Kismet capture telemetry
const MOCK_KISMET_DEVICES = [
  {
    bssid: 'E0:E1:A9:44:B2:10',
    ssid: 'Corporate_Corp_Sec5G',
    type: 'AP',
    channel: 36,
    frequency: '5.180 GHz',
    band: '5GHz',
    signal: -48,
    signalQuality: 92,
    crypto: 'WPA3-SAE / WPA2-Enterprise',
    manufacturer: 'Cisco Systems, Inc.',
    packets: 14820,
    clients: 8,
    firstSeen: '10 mins ago',
    lastSeen: '1s ago',
    clientList: ['3C:71:BF:11:22:33 (Apple MacBook)', '94:E6:F7:88:99:AA (Intel AX211)', '40:98:AD:CC:DD:EE (iPhone 15 Pro)']
  },
  {
    bssid: '70:4F:57:33:91:FA',
    ssid: 'Skyline_Guest_Public',
    type: 'AP',
    channel: 6,
    frequency: '2.437 GHz',
    band: '2.4GHz',
    signal: -62,
    signalQuality: 74,
    crypto: 'Open (Captive Portal / OWE)',
    manufacturer: 'Ubiquiti Networks Inc.',
    packets: 8430,
    clients: 14,
    firstSeen: '12 mins ago',
    lastSeen: '2s ago',
    clientList: ['12:34:56:78:9A:BC (Samsung Galaxy)', '58:94:6B:12:43:A1 (Google Pixel 8)']
  },
  {
    bssid: '24:A4:3C:99:10:E2',
    ssid: 'IoT_Telemetry_Hidden',
    type: 'AP',
    channel: 1,
    frequency: '2.412 GHz',
    band: '2.4GHz',
    signal: -71,
    signalQuality: 58,
    crypto: 'WPA2-PSK [AES-CCMP]',
    manufacturer: 'Espressif Systems',
    packets: 4120,
    clients: 6,
    firstSeen: '8 mins ago',
    lastSeen: '3s ago',
    clientList: ['84:F3:EB:20:11:22 (ESP32-S3 Node)', 'DC:54:75:A0:44:55 (ESP8266 Sensor)']
  },
  {
    bssid: 'B0:BE:76:88:21:40',
    ssid: 'Tesla_Powerwall_Grid',
    type: 'AP',
    channel: 11,
    frequency: '2.462 GHz',
    band: '2.4GHz',
    signal: -78,
    signalQuality: 45,
    crypto: 'WPA2-PSK [AES-CCMP]',
    manufacturer: 'Tesla Motors',
    packets: 1950,
    clients: 1,
    firstSeen: '15 mins ago',
    lastSeen: '8s ago',
    clientList: ['B0:BE:76:88:21:41 (Gateway Monitor)']
  },
  {
    bssid: '00:26:86:14:22:90',
    ssid: 'Lab_Internal_Audit_149',
    type: 'AP',
    channel: 149,
    frequency: '5.745 GHz',
    band: '5GHz',
    signal: -53,
    signalQuality: 86,
    crypto: 'WPA3-SAE Only',
    manufacturer: 'Aruba Networks',
    packets: 9840,
    clients: 4,
    firstSeen: '5 mins ago',
    lastSeen: '1s ago',
    clientList: ['F4:D4:88:77:66:55 (Dell Precision Workstation)']
  },
  {
    bssid: '3C:71:BF:11:22:33',
    ssid: 'Probing: Corporate_Corp_Sec5G',
    type: 'STA',
    channel: 36,
    frequency: '5.180 GHz',
    band: '5GHz',
    signal: -51,
    signalQuality: 88,
    crypto: 'Station / Supplicant',
    manufacturer: 'Apple, Inc.',
    packets: 3200,
    clients: 0,
    firstSeen: '7 mins ago',
    lastSeen: '1s ago',
    clientList: []
  },
  {
    bssid: '1A:2B:3C:D4:E5:F6',
    ssid: 'Probing: Home_Wi-Fi_Starbucks',
    type: 'STA',
    channel: 6,
    frequency: '2.437 GHz',
    band: '2.4GHz',
    signal: -69,
    signalQuality: 60,
    crypto: 'Station / Supplicant',
    manufacturer: 'Intel Corporate',
    packets: 1120,
    clients: 0,
    firstSeen: '4 mins ago',
    lastSeen: '4s ago',
    clientList: []
  }
];

const MOCK_WIDS_ALERTS = [
  {
    id: 1,
    type: 'DEAUTH_FLOOD',
    severity: 'CRITICAL',
    target: 'Corporate_Corp_Sec5G (E0:E1:A9:44:B2:10)',
    desc: 'Burst of 124 802.11 Deauthentication frames detected within 800ms. Potential client disconnection / handshake capture attempt.',
    channel: 36,
    time: '2 mins ago'
  },
  {
    id: 2,
    type: 'ROGUE_AP_SSID_SPOOF',
    severity: 'WARN',
    target: 'Skyline_Guest_Public (F0:99:BF:AA:BB:CC)',
    desc: 'Known SSID broadcasting from unfamiliar BSSID with different security parameters. Possible Evil Twin or unauthorized repeater.',
    channel: 1,
    time: '5 mins ago'
  },
  {
    id: 3,
    type: 'NULL_PROBE_RESPONSE',
    severity: 'INFO',
    target: '70:4F:57:33:91:FA',
    desc: 'AP answered broadcast probe request without specifying SSID element. Standard non-stealth beacon response.',
    channel: 6,
    time: '8 mins ago'
  }
];

export default function KismetStudioWorkbench() {
  // Connection states
  const [serverUrl, setServerUrl] = useState('http://localhost:2501');
  const [apiKey, setApiKey] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [useDemoMode, setUseDemoMode] = useState(false);   // opt-in: real Kismet server by default
  const [activeTab, setActiveTab] = useState('inventory'); // inventory, spectrum, alerts, hardware
  
  // Hardware profile & command assistant
  const [selectedAlfa, setSelectedAlfa] = useState(ALFA_PROFILES[0]);
  const [selectedOs, setSelectedOs] = useState('linux');
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Data states
  // Empty until connected. Only the demo fills these (with MOCK_*); the real
  // server path does not fetch devices or alerts yet.
  const [devices, setDevices] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('ALL'); // ALL, AP, STA, 5G, 2.4G, WPA3, OPEN
  const [selectedDevice, setSelectedDevice] = useState(null);

  // Telemetry stats
  const [packetRate, setPacketRate] = useState(1420);
  const [serverUptime, setServerUptime] = useState('02:45:12');

  // Command generator text based on selected Alfa & OS
  const launchCommands = useMemo(() => {
    const iface = selectedOs === 'macos' ? 'en0' : 'wlan1';
    const monIface = selectedOs === 'macos' ? 'en0' : 'wlan1mon';
    
    if (selectedOs === 'docker') {
      return `# Launch official Kismet Docker container with Alfa adapter pass-through:
docker run -it --rm \\
  --net=host \\
  --privileged \\
  -v /dev/bus/usb:/dev/bus/usb \\
  -v /var/run/dbus:/var/run/dbus \\
  -v ~/.kismet:/root/.kismet \\
  kismet/kismet:latest \\
  kismet -c ${iface}:type=linuxwifi`;
    }

    if (selectedOs === 'wsl2') {
      return `# 1. In Windows PowerShell (Admin), attach the Alfa USB device to WSL2:
usbipd wsl list
usbipd wsl attach --busid <BUS_ID> -d <DISTRO_NAME>

# 2. Inside WSL2 Linux Terminal:
sudo apt update && sudo apt install -y kismet
sudo ip link set ${iface} down
sudo iw dev ${iface} set type monitor
sudo ip link set ${iface} up
kismet -c ${iface}:type=linuxwifi`;
    }

    return `# 1. Kill interfering background network managers:
sudo airmon-ng check kill

# 2. Put ${selectedAlfa.name} (${selectedAlfa.chipset}) into Monitor Mode:
sudo airmon-ng start ${iface}

# 3. Launch Kismet daemon binding to the Alfa monitor interface:
kismet -c ${monIface} --no-ncurses`;
  }, [selectedAlfa, selectedOs]);

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(launchCommands);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2500);
  };

  // Toggle server connection / demo mode
  const handleToggleConnect = async () => {
    if (isConnected) {
      setIsConnected(false);
      return;
    }

    setIsConnecting(true);
    if (useDemoMode) {
      // Demo: load the mock capture
      setTimeout(() => {
        setDevices(MOCK_KISMET_DEVICES);
        setAlerts(MOCK_WIDS_ALERTS);
        setIsConnected(true);
        setIsConnecting(false);
      }, 600);
    } else {
      // Real REST query to Kismet API
      try {
        const res = await fetch(`${serverUrl}/system/status.json`, {
          headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}
        });
        if (res.ok) {
          setDevices([]);
          setAlerts([]);
          setIsConnected(true);
        } else {
          alert(`Kismet server returned status ${res.status}. Check API credentials.`);
        }
      } catch (err) {
        alert(`Cannot reach Kismet daemon at ${serverUrl}. Ensure Kismet is running with: kismet -c wlan1mon\n\nError: ${err.message}`);
      } finally {
        setIsConnecting(false);
      }
    }
  };

  // Filtered devices
  const filteredDevices = useMemo(() => {
    return devices.filter(d => {
      const q = searchQuery.toLowerCase();
      const matchQuery = !q ||
        d.ssid.toLowerCase().includes(q) ||
        d.bssid.toLowerCase().includes(q) ||
        d.manufacturer.toLowerCase().includes(q) ||
        d.crypto.toLowerCase().includes(q);

      if (!matchQuery) return false;

      if (filterType === 'AP') return d.type === 'AP';
      if (filterType === 'STA') return d.type === 'STA';
      if (filterType === '5G') return d.band === '5GHz';
      if (filterType === '2.4G') return d.band === '2.4GHz';
      if (filterType === 'WPA3') return d.crypto.includes('WPA3');
      if (filterType === 'OPEN') return d.crypto.toLowerCase().includes('open');

      return true;
    });
  }, [devices, searchQuery, filterType]);

  // Channel congestion map data
  const channelData24 = useMemo(() => {
    const map = {};
    for (let c = 1; c <= 13; c++) map[c] = 0;
    devices.filter(d => d.band === '2.4GHz').forEach(d => {
      if (map[d.channel] !== undefined) map[d.channel]++;
    });
    return map;
  }, [devices]);

  const channelData5G = useMemo(() => {
    const channels = [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 149, 153, 157, 161];
    const map = {};
    channels.forEach(c => map[c] = 0);
    devices.filter(d => d.band === '5GHz').forEach(d => {
      if (map[d.channel] !== undefined) map[d.channel]++;
    });
    return map;
  }, [devices]);

  // Export Kismet JSON
  const handleExportJson = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(devices, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `kismet_alfa_inventory_${Date.now()}.json`);
    dlAnchor.click();
  };

  // Export WiGLE CSV
  const handleExportWigleCsv = () => {
    let csv = "WigleWifi-1.4,appRelease=SkonsKismetStudio-1.0,model=AlfaAdapter,osVersion=Web,device=WebUSB\n";
    csv += "MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type\n";
    devices.forEach(d => {
      csv += `${d.bssid},${d.ssid},[${d.crypto}],2026-10-24 02:00:00,${d.channel},${d.signal},0.0,0.0,0,10,WIFI\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", url);
    dlAnchor.setAttribute("download", `kismet_wigle_${Date.now()}.csv`);
    dlAnchor.click();
  };

  return (
    <div className="flex flex-col gap-4 font-mono text-slate-100">
      {isConnected && useDemoMode && (
        <DemoBanner>The devices, alerts and rates below are a canned Alfa + Kismet capture, not your server.</DemoBanner>
      )}
      {isConnected && !useDemoMode && (
        <div role="note" className="p-2.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-xs text-sky-200">
          Connected to the Kismet server at {serverUrl}. Live device and alert listing from Kismet isn&apos;t implemented yet, so the tables below stay empty.
        </div>
      )}
      {/* Top Banner Card */}
      <div className="bg-[#171920] border border-[#2b303c] rounded-2xl p-4 shadow-xl flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-400 shadow-inner">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                KISMET STUDIO & ALFA ADAPTER
              </h2>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                802.11 Monitor Lab
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Dual-Band 2.4 / 5GHz
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Integrated Kismet REST/WebSocket engine for Alfa Wi-Fi adapters, 802.11 frame monitor mode, device catalogs & WIDS IDS alerts
            </p>
          </div>
        </div>

        {/* Server & Demo Mode Controller */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
          <div className="flex items-center bg-slate-950 px-2.5 py-1.5 rounded-xl border border-slate-800 text-xs gap-2">
            <Server className="w-3.5 h-3.5 text-slate-400" />
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:2501"
              disabled={isConnected}
              className="bg-transparent text-slate-200 outline-none w-36 text-xs font-mono"
            />
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-300 bg-slate-900/80 px-2.5 py-1.5 rounded-xl border border-slate-800 cursor-pointer hover:bg-slate-800 transition">
            <input
              type="checkbox"
              checked={useDemoMode}
              onChange={(e) => setUseDemoMode(e.target.checked)}
              disabled={isConnected}
              className="rounded text-purple-500 focus:ring-purple-500"
            />
            <span className="text-[11px]">Simulate Alfa RF</span>
          </label>

          <button
            onClick={handleToggleConnect}
            disabled={isConnecting}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition shadow-sm ${
              isConnected
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-500 hover:to-indigo-500 border border-purple-400/30'
            }`}
          >
            {isConnecting ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : isConnected ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Disconnect</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Connect Kismet</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Live Capture Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Active Hardware</div>
            <div className="text-sm font-bold text-cyan-400 mt-0.5">{selectedAlfa.name}</div>
            <div className="text-[10px] text-slate-500">{selectedAlfa.chipset}</div>
          </div>
          <Cpu className="w-5 h-5 text-cyan-400/40" />
        </div>

        <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Packet Telemetry</div>
            <div className="text-sm font-bold text-purple-400 mt-0.5">
              {isConnected && useDemoMode ? `${packetRate.toLocaleString()} pkts/s` : '-- pkts/s'}
            </div>
            <div className="text-[10px] text-slate-500">Uptime: {isConnected && useDemoMode ? serverUptime : '--:--:--'}</div>
          </div>
          <Activity className="w-5 h-5 text-purple-400/40" />
        </div>

        <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-semibold">Discovered Devices</div>
            <div className="text-sm font-bold text-emerald-400 mt-0.5">{devices.length} Nodes</div>
            <div className="text-[10px] text-slate-500">
              {devices.filter(d => d.type === 'AP').length} APs / {devices.filter(d => d.type === 'STA').length} STAs
            </div>
          </div>
          <Wifi className="w-5 h-5 text-emerald-400/40" />
        </div>

        <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase text-slate-400 font-semibold">WIDS IDS Alerts</div>
            <div className="text-sm font-bold text-amber-400 mt-0.5">
              {alerts.length} Warnings
            </div>
            <div className="text-[10px] text-slate-500">
              {alerts.filter(a => a.severity === 'CRITICAL').length} Critical Floods
            </div>
          </div>
          <ShieldAlert className="w-5 h-5 text-amber-400/40" />
        </div>
      </div>

      {/* Main Workbench Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#171920] border border-[#2b303c] rounded-xl p-1.5">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'inventory'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Wifi className="w-3.5 h-3.5" />
            <span>Device Inventory ({devices.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('spectrum')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'spectrum'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Channels & Congestion</span>
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'alerts'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>WIDS Intrusion Alerts ({alerts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('hardware')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'hardware'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Alfa Adapter Setup & CLI</span>
          </button>
        </div>

        {/* Global Export Options */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportWigleCsv}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Export captured access points to WiGLE CSV format"
          >
            <Compass className="w-3 h-3 text-emerald-400" />
            <span>WiGLE CSV</span>
          </button>
          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
            title="Export full device tree in Kismet JSON format"
          >
            <Download className="w-3 h-3 text-purple-400" />
            <span>Kismet JSON</span>
          </button>
        </div>
      </div>

      {/* TAB 1: DEVICE INVENTORY */}
      {activeTab === 'inventory' && (
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#171920] border border-[#2b303c] rounded-xl p-3 text-xs">
            <div className="flex items-center bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-800 w-full sm:w-72">
              <Search className="w-3.5 h-3.5 text-slate-400 mr-2" />
              <input
                type="text"
                placeholder="Search SSID, BSSID, OUI or Crypto..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-slate-200 placeholder-slate-500 outline-none w-full text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 text-[11px]">
              {['ALL', 'AP', 'STA', '5G', '2.4G', 'WPA3', 'OPEN'].map(type => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`px-2.5 py-1 rounded-md font-semibold transition ${
                    filterType === type
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl overflow-x-auto shadow-lg">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="bg-slate-950/80 text-[10px] text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Network / SSID</th>
                  <th className="py-2.5 px-3">BSSID / MAC</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Channel / Band</th>
                  <th className="py-2.5 px-3">Signal (dBm)</th>
                  <th className="py-2.5 px-3">Cryptography</th>
                  <th className="py-2.5 px-3">Clients</th>
                  <th className="py-2.5 px-3">Packets</th>
                  <th className="py-2.5 px-3 text-right">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {filteredDevices.map((dev, idx) => {
                  const is5G = dev.band === '5GHz';
                  const isEncrypted = !dev.crypto.toLowerCase().includes('open');
                  return (
                    <tr
                      key={idx}
                      onClick={() => setSelectedDevice(dev)}
                      className="hover:bg-slate-800/40 cursor-pointer transition"
                    >
                      <td className="py-2.5 px-3 font-semibold text-slate-100 flex items-center gap-2">
                        {isEncrypted ? (
                          <Lock className="w-3.5 h-3.5 text-amber-400/80 shrink-0" />
                        ) : (
                          <Unlock className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
                        )}
                        <span className="truncate max-w-[180px]">{dev.ssid}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        <div className="text-slate-200">{dev.bssid}</div>
                        <div className="text-[10px] text-slate-500 truncate max-w-[140px]">{dev.manufacturer}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          dev.type === 'AP'
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                        }`}>
                          {dev.type}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          is5G ? 'bg-indigo-500/20 text-indigo-300' : 'bg-emerald-500/20 text-emerald-300'
                        }`}>
                          Ch {dev.channel} ({dev.band})
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold ${
                            dev.signal >= -60 ? 'text-emerald-400' : dev.signal >= -75 ? 'text-amber-400' : 'text-rose-400'
                          }`}>
                            {dev.signal} dBm
                          </span>
                          <div className="w-12 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${
                                dev.signal >= -60 ? 'bg-emerald-400' : dev.signal >= -75 ? 'bg-amber-400' : 'bg-rose-400'
                              }`}
                              style={{ width: `${dev.signalQuality}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-slate-300 text-[11px]">
                        {dev.crypto}
                      </td>
                      <td className="py-2.5 px-3 text-slate-300">
                        {dev.clients > 0 ? (
                          <span className="flex items-center gap-1 text-purple-300">
                            <Users className="w-3 h-3" />
                            {dev.clients}
                          </span>
                        ) : (
                          <span className="text-slate-600">--</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {dev.packets.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-400 text-[11px]">
                        {dev.lastSeen}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Modal / Detail Drawer for Selected Device */}
          {selectedDevice && (
            <div className="bg-slate-900 border border-purple-500/40 rounded-xl p-4 shadow-2xl relative animate-in fade-in">
              <button
                onClick={() => setSelectedDevice(null)}
                className="absolute top-3 right-3 text-slate-400 hover:text-white text-sm"
              >
                ✕ Close
              </button>
              <div className="flex items-center gap-2 mb-3">
                <Wifi className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white">
                  {selectedDevice.ssid} ({selectedDevice.bssid})
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300">
                  {selectedDevice.type}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">OUI Manufacturer</span>
                  <span className="text-slate-200 font-semibold">{selectedDevice.manufacturer}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Frequency / Band</span>
                  <span className="text-slate-200 font-semibold">{selectedDevice.frequency} (Ch {selectedDevice.channel})</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Security Architecture</span>
                  <span className="text-slate-200 font-semibold">{selectedDevice.crypto}</span>
                </div>
                <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-500 text-[10px] block">Signal Strength</span>
                  <span className="text-emerald-400 font-semibold">{selectedDevice.signal} dBm ({selectedDevice.signalQuality}%)</span>
                </div>
              </div>
              {selectedDevice.clientList && selectedDevice.clientList.length > 0 && (
                <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs">
                  <span className="text-slate-400 font-semibold block mb-1.5 flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5 text-purple-400" />
                    Associated Client Stations ({selectedDevice.clientList.length}):
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {selectedDevice.clientList.map((c, i) => (
                      <span key={i} className="px-2 py-1 rounded bg-slate-900 border border-slate-700 text-slate-300 text-[11px]">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: SPECTRUM & CHANNELS */}
      {activeTab === 'spectrum' && (
        <div className="space-y-4">
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Signal className="w-4 h-4 text-emerald-400" />
              2.4 GHz ISM Band Spectrum Congestion (Channels 1–13)
            </h3>
            <p className="text-[11px] text-slate-400 mb-3">
              Standard 20MHz Wi-Fi channels overlap significantly. Non-overlapping channels (1, 6, 11) are highlighted in cyan.
            </p>
            <div className="grid grid-cols-13 gap-1.5 h-32 items-end bg-slate-950 p-3 rounded-xl border border-slate-800">
              {Object.entries(channelData24).map(([ch, count]) => {
                const isClean = [1, 6, 11].includes(Number(ch));
                const heightPct = Math.min(100, count * 25 + 10);
                return (
                  <div key={ch} className="flex flex-col items-center h-full justify-end group">
                    <span className="text-[10px] text-slate-400 mb-1 group-hover:text-white font-bold">
                      {count}
                    </span>
                    <div
                      className={`w-full rounded-t transition-all ${
                        isClean
                          ? count > 0 ? 'bg-cyan-500' : 'bg-cyan-500/20'
                          : count > 0 ? 'bg-purple-600' : 'bg-slate-800'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className={`text-[10px] font-bold mt-1 ${isClean ? 'text-cyan-400' : 'text-slate-500'}`}>
                      {ch}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Signal className="w-4 h-4 text-indigo-400" />
              5 GHz UNII-1 / UNII-2 / UNII-3 Band Distribution
            </h3>
            <p className="text-[11px] text-slate-400 mb-3">
              5 GHz channels offer 80MHz/160MHz wide channels with zero channel overlap between non-DFS channels.
            </p>
            <div className="grid grid-cols-8 sm:grid-cols-16 gap-1.5 h-32 items-end bg-slate-950 p-3 rounded-xl border border-slate-800">
              {Object.entries(channelData5G).map(([ch, count]) => {
                const heightPct = Math.min(100, count * 35 + 10);
                return (
                  <div key={ch} className="flex flex-col items-center h-full justify-end group">
                    <span className="text-[10px] text-slate-400 mb-1 group-hover:text-white font-bold">
                      {count}
                    </span>
                    <div
                      className={`w-full rounded-t transition-all ${
                        count > 0 ? 'bg-indigo-500' : 'bg-slate-800'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[10px] font-bold mt-1 text-indigo-400">
                      {ch}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: WIDS INTRUSION ALERTS */}
      {activeTab === 'alerts' && (
        <div className="space-y-3">
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                Live Wireless Intrusion Detection System (WIDS) Log
              </h3>
              <span className="text-[10px] text-slate-400">
                Rule engine running directly on Kismet RF stream
              </span>
            </div>

            <div className="space-y-2">
              {alerts.map((alt) => (
                <div
                  key={alt.id}
                  className={`p-3 rounded-xl border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    alt.severity === 'CRITICAL'
                      ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                      : alt.severity === 'WARN'
                      ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                      : 'bg-slate-900 border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        alt.severity === 'CRITICAL'
                          ? 'bg-rose-500 text-white'
                          : alt.severity === 'WARN'
                          ? 'bg-amber-500 text-black'
                          : 'bg-blue-500 text-white'
                      }`}>
                        {alt.type}
                      </span>
                      <span className="font-semibold">{alt.target}</span>
                      <span className="text-[11px] text-slate-400">on Channel {alt.channel}</span>
                    </div>
                    <p className="text-[11px] opacity-90">{alt.desc}</p>
                  </div>
                  <div className="text-[10px] text-slate-400 shrink-0">
                    {alt.time}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: ALFA HARDWARE PROFILES & CLI ASSISTANT */}
      {activeTab === 'hardware' && (
        <div className="space-y-4">
          {/* Alfa Model Selector */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-4">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              Select Alfa Wi-Fi Adapter Model
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {ALFA_PROFILES.map((card) => {
                const isSelected = selectedAlfa.id === card.id;
                return (
                  <div
                    key={card.id}
                    onClick={() => setSelectedAlfa(card)}
                    className={`p-3 rounded-xl border cursor-pointer transition flex flex-col justify-between ${
                      isSelected
                        ? 'bg-purple-950/40 border-purple-500 text-white shadow-md'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-xs">{card.name}</span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-purple-400" />}
                      </div>
                      <div className="text-[11px] text-cyan-400 mt-0.5">{card.chipset}</div>
                      <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
                        {card.desc}
                      </p>
                    </div>
                    <div className="mt-3 pt-2 border-t border-slate-800/60 text-[10px] text-slate-400">
                      <div><strong className="text-slate-300">Bands:</strong> {card.bands}</div>
                      <div><strong className="text-slate-300">Driver:</strong> {card.driverLinux}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Launch Script Generator */}
          <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-purple-400" />
                  Monitor Mode & Kismet Launch Terminal Commands
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Run these commands in your host terminal to bring up your Alfa card in monitor mode and link Kismet to this dashboard.
                </p>
              </div>

              {/* OS Selector */}
              <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                {['linux', 'wsl2', 'docker', 'macos'].map((os) => (
                  <button
                    key={os}
                    onClick={() => setSelectedOs(os)}
                    className={`px-2.5 py-1 rounded font-semibold uppercase ${
                      selectedOs === os
                        ? 'bg-purple-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {os}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-emerald-400 text-xs font-mono overflow-x-auto leading-relaxed">
                {launchCommands}
              </pre>
              <button
                onClick={handleCopyCommand}
                className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-500 text-white shadow transition"
              >
                {copiedCmd ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Script</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
