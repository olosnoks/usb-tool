import React, { useState, useEffect, useRef } from 'react';
import { 
  Wifi, 
  WifiOff, 
  Signal, 
  Lock, 
  Unlock, 
  Play, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Globe, 
  Key, 
  Cpu, 
  ExternalLink, 
  ShieldCheck
} from 'lucide-react';

// Improv Wi-Fi State constants
const IMPROV_STATE_UNKNOWN = 0x00;
const IMPROV_STATE_AUTHORIZATION_REQUIRED = 0x01;
const IMPROV_STATE_AUTHORIZED = 0x02;
const IMPROV_STATE_PROVISIONING = 0x03;
const IMPROV_STATE_PROVISIONED = 0x04;

const IMPROV_STATE_NAMES = {
  [IMPROV_STATE_UNKNOWN]: 'INITIALIZING / UNKNOWN',
  [IMPROV_STATE_AUTHORIZATION_REQUIRED]: 'AUTH REQUIRED (PRESS BUTTON ON DEVICE)',
  [IMPROV_STATE_AUTHORIZED]: 'AUTHORIZED // READY TO PROVISION',
  [IMPROV_STATE_PROVISIONING]: 'PROVISIONING WI-FI (CONNECTING)...',
  [IMPROV_STATE_PROVISIONED]: 'PROVISIONED & CONNECTED!'
};

export default function ImprovWifiDeck({
  isConnected = false,
  onSendRawBytes,
  onSendString,
  latestRxText = '',
  onLogMessage,
  boards = [],
  activeBoardId = 'board-1',
  onSelectBoard
}) {
  const [provisionMode, setProvisionMode] = useState('improv'); // 'improv', 'micropython', 'at'
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [improvState, setImprovState] = useState(IMPROV_STATE_AUTHORIZED);
  const [assignedIp, setAssignedIp] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready to scan or provision Wi-Fi');

  // Scanned AP list
  const [scannedNetworks, setScannedNetworks] = useState([
    { ssid: 'Lab-IoT-5G', rssi: -48, secure: true },
    { ssid: 'Embedded_Workbench', rssi: -58, secure: true },
    { ssid: 'Field-Sensor-Mesh', rssi: -72, secure: true },
    { ssid: 'Guest-Open', rssi: -82, secure: false }
  ]);

  const lastProcessedTextRef = useRef('');

  // Inspect incoming serial data for Improv frames or Wi-Fi responses
  useEffect(() => {
    if (!latestRxText || latestRxText === lastProcessedTextRef.current) return;
    const newText = latestRxText.slice(lastProcessedTextRef.current.length);
    lastProcessedTextRef.current = latestRxText;

    // Look for IP addresses: e.g. 192.168.1.100 or "ip": "..." or "STAIP,..."
    const ipMatch = newText.match(/\b(?:192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/);
    if (ipMatch) {
      setAssignedIp(ipMatch[0]);
      setImprovState(IMPROV_STATE_PROVISIONED);
      setIsProvisioning(false);
      setStatusMessage(`Device connected successfully! IP: ${ipMatch[0]}`);
      onLogMessage?.(`[WI-FI PROVISIONED] Device connected: ${ipMatch[0]}`, 'sys');
    }

    if (newText.includes('WIFI CONNECTED') || newText.includes('WIFI GOT IP') || newText.includes('Connected with IP')) {
      setImprovState(IMPROV_STATE_PROVISIONED);
      setIsProvisioning(false);
    }

    if (newText.includes('WIFI DISCONNECT') || newText.includes('FAIL') || newText.includes('NO AP FOUND')) {
      setIsProvisioning(false);
      setStatusMessage('Connection failed: Invalid password or AP out of range');
    }
  }, [latestRxText, onLogMessage]);

  // Construct Improv Wi-Fi packet
  const buildImprovFrame = (packetType, dataPayload) => {
    // Header: 'IMPROV', Version: 1
    const header = [0x49, 0x4D, 0x50, 0x52, 0x4F, 0x56, 0x01];
    const type = [packetType];
    const len = [dataPayload.length];
    const frame = [...header, ...type, ...len, ...dataPayload];

    // Checksum: sum of all bytes modulo 256
    let sum = 0;
    for (let i = 0; i < frame.length; i++) {
      sum = (sum + frame[i]) & 0xFF;
    }
    frame.push(sum);
    return new Uint8Array(frame);
  };

  // 1. Send Improv Scan Request (RPC command 0x02)
  const handleScanNetworks = () => {
    if (!isConnected) return;
    setIsScanning(true);
    setStatusMessage('Scanning nearby Wi-Fi access points...');

    if (provisionMode === 'improv') {
      // Send Improv RPC Scan (Command 0x02)
      const scanRpcPayload = [0x02]; // Command 0x02: Scan
      const frame = buildImprovFrame(0x03, scanRpcPayload);
      onSendRawBytes?.(frame);
      onLogMessage?.('[IMPROV] Sent RPC Wi-Fi Scan command over serial', 'tx');
    } else if (provisionMode === 'at') {
      onSendString?.('AT+CWLAP\r\n');
      onLogMessage?.('[AT] Sent AT+CWLAP (Scan APs)', 'tx');
    } else if (provisionMode === 'micropython') {
      onSendString?.("import network; w = network.WLAN(network.STA_IF); w.active(True); print('SCAN_RES:', w.scan())\r\n");
      onLogMessage?.('[MICROPYTHON] Triggered wlan.scan()', 'tx');
    }

    setTimeout(() => {
      setIsScanning(false);
      setStatusMessage('Scan completed. Select network below.');
    }, 2000);
  };

  // 2. Send Improv Provision Request (RPC command 0x01: SSID + Password)
  const handleProvision = (e) => {
    e.preventDefault();
    if (!ssid || !isConnected) return;

    setIsProvisioning(true);
    setImprovState(IMPROV_STATE_PROVISIONING);
    setStatusMessage(`Provisioning network "${ssid}"...`);

    if (provisionMode === 'improv') {
      // Improv RPC 0x01: [0x01, len(ssid), ...ssid_bytes, len(pass), ...pass_bytes]
      const encoder = new TextEncoder();
      const ssidBytes = encoder.encode(ssid);
      const passBytes = encoder.encode(password);

      const rpcData = [
        0x01, // Command 0x01: Send Wi-Fi Settings
        ssidBytes.length,
        ...ssidBytes,
        passBytes.length,
        ...passBytes
      ];

      const frame = buildImprovFrame(0x03, rpcData);
      onSendRawBytes?.(frame);
      onLogMessage?.(`[IMPROV] Provisioning "${ssid}" via Improv serial frame`, 'tx');
    } else if (provisionMode === 'at') {
      onSendString?.(`AT+CWMODE=1\r\nAT+CWJAP="${ssid}","${password}"\r\n`);
      onLogMessage?.(`[AT] Sent AT+CWJAP for "${ssid}"`, 'tx');
    } else if (provisionMode === 'micropython') {
      const uPyScript = `import network; w=network.WLAN(network.STA_IF); w.active(True); w.connect('${ssid}', '${password}'); import time; time.sleep(1); print('IP:', w.ifconfig()[0])\r\n`;
      onSendString?.(uPyScript);
      onLogMessage?.(`[MICROPYTHON] Sent Wi-Fi connect script for "${ssid}"`, 'tx');
    }
  };

  const getSignalBars = (rssi) => {
    if (rssi >= -55) return 'text-emerald-400 font-bold';
    if (rssi >= -70) return 'text-cyan-400';
    if (rssi >= -85) return 'text-amber-400';
    return 'text-rose-400';
  };

  return (
    <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-slate-200 text-xs font-mono space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <Wifi className="w-5 h-5 text-emerald-400" />
          <div>
            <h2 className="font-bold text-sm text-slate-100 uppercase tracking-wider flex items-center gap-2">
              IMPROV WI-FI SERIAL PROVISIONER
              <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-bold">
                ESP WEB TOOLS STANDARD
              </span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Provision ESP32, ESP8266, and Raspberry Pi Pico Wi-Fi credentials directly over serial without flashing.
            </p>
          </div>
        </div>

        {/* Provision Mode Pills */}
        <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setProvisionMode('improv')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              provisionMode === 'improv' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            IMPROV RPC
          </button>
          <button
            onClick={() => setProvisionMode('micropython')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              provisionMode === 'micropython' ? 'bg-amber-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            MICROPYTHON
          </button>
          <button
            onClick={() => setProvisionMode('at')}
            className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
              provisionMode === 'at' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ESP-AT CMD
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left Column: Scanned Access Points */}
        <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="font-bold text-slate-200 flex items-center gap-1.5">
              <Signal className="w-4 h-4 text-emerald-400" />
              NEARBY ACCESS POINTS ({scannedNetworks.length})
            </span>
            <button
              onClick={handleScanNetworks}
              disabled={!isConnected || isScanning}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-bold border transition-colors ${
                !isConnected 
                  ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500' 
                  : isScanning
                    ? 'bg-slate-800 text-slate-400 border-slate-700 animate-pulse'
                    : 'bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60'
              }`}
            >
              <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'SCANNING...' : 'SCAN APs'}</span>
            </button>
          </div>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {scannedNetworks.map(net => (
              <div
                key={net.ssid}
                onClick={() => setSsid(net.ssid)}
                className={`p-2 rounded-lg border cursor-pointer transition-all flex items-center justify-between ${
                  ssid === net.ssid 
                    ? 'bg-emerald-950/50 border-emerald-500/80 shadow-emerald-glow/20' 
                    : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  {net.secure ? <Lock className="w-3.5 h-3.5 text-slate-500" /> : <Unlock className="w-3.5 h-3.5 text-amber-500" />}
                  <span className="font-bold text-slate-200 font-mono text-xs">{net.ssid}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px]">
                  <span className={getSignalBars(net.rssi)}>{net.rssi} dBm</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-500">
            Click any network above to automatically populate the credentials field.
          </p>
        </div>

        {/* Center & Right Column: Credentials Input & Device State */}
        <div className="lg:col-span-2 space-y-4">
          {/* Status Banner */}
          <div className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
            improvState === IMPROV_STATE_PROVISIONED 
              ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200' 
              : isProvisioning 
                ? 'bg-amber-950/40 border-amber-500/50 text-amber-200 animate-pulse'
                : 'bg-slate-900 border-slate-800 text-slate-300'
          }`}>
            <div className="flex items-center gap-2">
              {improvState === IMPROV_STATE_PROVISIONED ? (
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
              ) : isProvisioning ? (
                <RefreshCw className="w-5 h-5 text-amber-400 shrink-0 animate-spin" />
              ) : (
                <Cpu className="w-5 h-5 text-cyan-400 shrink-0" />
              )}
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">DEVICE STATUS:</span>
                <span className="font-bold text-xs">{IMPROV_STATE_NAMES[improvState]}</span>
              </div>
            </div>

            {assignedIp && (
              <a
                href={`http://${assignedIp}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors shadow-emerald-glow"
              >
                <span>OPEN {assignedIp}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>

          {/* Credentials Form */}
          <form onSubmit={handleProvision} className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
            <span className="font-bold text-slate-200 flex items-center gap-1.5 border-b border-slate-800 pb-2">
              <Key className="w-4 h-4 text-emerald-400" />
              WI-FI CREDENTIALS & DEPLOYMENT
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Network SSID:
                </label>
                <input
                  type="text"
                  placeholder="e.g. MyHomeWiFi"
                  value={ssid}
                  onChange={e => setSsid(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 text-emerald-300 font-mono text-xs outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="text-[10px] text-slate-400 uppercase font-bold block mb-1">
                  Wi-Fi Password:
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="WPA2 / WPA3 Pre-Shared Key"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-1.5 pr-8 text-slate-200 font-mono text-xs outline-none focus:border-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <span className="text-[10px] text-slate-500">
                Mode: <strong className="text-emerald-400 uppercase">{provisionMode}</strong> | Frame Checksum: <strong className="text-cyan-400">MOD256</strong>
              </span>

              <button
                type="submit"
                disabled={!isConnected || !ssid || isProvisioning}
                className={`flex items-center gap-2 px-5 py-2 rounded-xl font-bold text-xs transition-all ${
                  !isConnected || !ssid || isProvisioning
                    ? 'opacity-40 cursor-not-allowed bg-slate-800 text-slate-500'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-glow'
                }`}
              >
                {isProvisioning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                <span>{isProvisioning ? 'CONNECTING DEVICE...' : 'CONNECT BOARD TO WI-FI'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
