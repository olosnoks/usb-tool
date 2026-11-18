import React, { useState, useEffect, useRef } from 'react';
import { useSerial } from '../context/SerialContext';
import {
  ImprovParser, improvRpc, improvWifiSettings, IMPROV_CMD, IMPROV_STATE_NAMES,
  parseCwlapLine, parseMicropythonScan, frameToHex, describeImprovPacket, validateWifiCredentials,
  buildAtScan, buildAtProvision, buildMicropythonScan, buildMicropythonProvision, micropythonSnippet
} from '../utils/improvSerial';
import {
  Wifi, Signal, Lock, Unlock, RefreshCw, Cpu, ExternalLink, ShieldCheck, Eye, EyeOff, Copy, Lightbulb, RotateCw
} from 'lucide-react';

const STATE_PROVISIONING = 0x03;
const STATE_PROVISIONED = 0x04;
const PROVISION_TIMEOUT_MS = 30000;
const MAX_LOG = 60;

const btn = 'flex items-center gap-1 px-2 py-1 rounded text-[11px] font-bold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500';
const btnGhost = `${btn} bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800`;

export default function ImprovWifiDeck({
  isConnected = false,
  onSendRawBytes,
  onSendString,
  onLogMessage
}) {
  const [provisionMode, setProvisionMode] = useState('improv'); // 'improv', 'micropython', 'at'
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isProvisioning, setIsProvisioning] = useState(false);
  // Nothing is assumed: the state, networks and device info come from the device.
  const [improvState, setImprovState] = useState(0);
  const [assignedIp, setAssignedIp] = useState('');
  const [statusMessage, setStatusMessage] = useState('Ready to scan or provision Wi-Fi.');
  const [deviceInfo, setDeviceInfo] = useState(null);  // Improv GET_INFO: [firmware, version, chip, name]
  const [scannedNetworks, setScannedNetworks] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [packetLog, setPacketLog] = useState([]);
  const [copied, setCopied] = useState('');

  const { subscribeRx } = useSerial();
  const parserRef = useRef(new ImprovParser());
  const scanAccRef = useRef([]);
  const scanTimerRef = useRef(null);
  const provTimerRef = useRef(null);
  const textBufRef = useRef('');
  const modeRef = useRef(provisionMode);
  modeRef.current = provisionMode;

  const endProvisioning = () => { clearTimeout(provTimerRef.current); setIsProvisioning(false); };
  useEffect(() => () => { clearTimeout(scanTimerRef.current); clearTimeout(provTimerRef.current); }, []);

  const finishScan = (list, note) => {
    clearTimeout(scanTimerRef.current);
    const byName = new Map();
    for (const n of list) if (n.ssid && (!byName.has(n.ssid) || byName.get(n.ssid).rssi < n.rssi)) byName.set(n.ssid, n);
    const sorted = [...byName.values()].sort((a, b) => b.rssi - a.rssi);
    setScannedNetworks(sorted);
    setScanned(true);
    setIsScanning(false);
    setStatusMessage(note || `Found ${sorted.length} network${sorted.length === 1 ? '' : 's'}. Select one below.`);
  };

  const handleText = (line) => {
    const mode = modeRef.current;
    if (mode === 'at') {
      const net = parseCwlapLine(line);
      if (net) { scanAccRef.current.push(net); return; }
      if (/^OK\b/.test(line) && scanAccRef.current.length) { finishScan(scanAccRef.current); scanAccRef.current = []; return; }
    }
    if (mode === 'micropython') {
      const nets = parseMicropythonScan(line);
      if (nets) { finishScan(nets); return; }
    }
    if (mode !== 'improv') {
      const ipMatch = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/);
      if (ipMatch && ipMatch[0] !== '0.0.0.0' && /IP|ip|CIFSR|STAIP/.test(line)) {
        setAssignedIp(ipMatch[0]);
        setImprovState(STATE_PROVISIONED);
        endProvisioning();
        setStatusMessage(`Device connected. IP: ${ipMatch[0]}`);
        onLogMessage?.(`[WI-FI PROVISIONED] Device connected: ${ipMatch[0]}`, 'sys');
      } else if (/WIFI DISCONNECT|FAIL|NO AP FOUND|\+CWJAP:\d/.test(line)) {
        endProvisioning();
        setStatusMessage('Connection failed: wrong password or network out of range.');
      }
    }
  };

  const handleImprov = (pkt) => {
    setPacketLog((l) => [...l.slice(-(MAX_LOG - 1)), { t: new Date().toLocaleTimeString(), text: describeImprovPacket(pkt) }]);
    if (pkt.kind === 'state') {
      setImprovState(pkt.state);
      if (pkt.state === STATE_PROVISIONING) setStatusMessage('Device is connecting to the network…');
    } else if (pkt.kind === 'error' && pkt.code !== 0) {
      endProvisioning();
      setIsScanning(false);
      setStatusMessage(`Device reported an error: ${pkt.message}.`);
      onLogMessage?.(`[IMPROV] Error: ${pkt.message}`, 'sys');
    } else if (pkt.kind === 'result') {
      if (pkt.command === IMPROV_CMD.SCAN) {
        if (!pkt.strings.length) { finishScan(scanAccRef.current); scanAccRef.current = []; return; }   // empty = end of list
        const [name, rssi, auth] = pkt.strings;
        scanAccRef.current.push({ ssid: name, rssi: parseInt(rssi, 10) || -100, secure: auth !== 'NO' });
      } else if (pkt.command === IMPROV_CMD.WIFI_SETTINGS) {
        endProvisioning();
        setImprovState(STATE_PROVISIONED);
        const url = pkt.strings[0] || '';
        setAssignedIp(url);
        setStatusMessage(url ? `Provisioned. Device page: ${url}` : 'Provisioned.');
        onLogMessage?.(`[IMPROV] Provisioned${url ? ': ' + url : ''}`, 'sys');
      } else if (pkt.command === IMPROV_CMD.GET_INFO) {
        setDeviceInfo(pkt.strings);
      }
    }
  };

  // Every received chunk: Improv packets (binary) and text lines (AT / MicroPython).
  useEffect(() => {
    if (!subscribeRx) return undefined;
    const dec = new TextDecoder();
    return subscribeRx((bytes) => {
      for (const pkt of parserRef.current.push(bytes)) handleImprov(pkt);
      textBufRef.current += dec.decode(bytes, { stream: true });
      const lines = textBufRef.current.split(/\r?\n/);
      textBufRef.current = lines.pop().slice(-4096);
      for (const l of lines) if (l.trim()) handleText(l.trim());
    });
  }, [subscribeRx]);

  const queryDevice = () => {
    setImprovState(0);
    setDeviceInfo(null);
    onSendRawBytes?.(improvRpc(IMPROV_CMD.GET_STATE));
    onSendRawBytes?.(improvRpc(IMPROV_CMD.GET_INFO));
  };

  // Improv: ask for the current state and device info when connected.
  useEffect(() => {
    if (!isConnected || provisionMode !== 'improv') return;
    queryDevice();
  }, [isConnected, provisionMode]);

  const handleScanNetworks = () => {
    if (!isConnected) return;
    setIsScanning(true);
    scanAccRef.current = [];
    setStatusMessage('Scanning nearby Wi-Fi access points...');
    if (provisionMode === 'improv') {
      onSendRawBytes?.(improvRpc(IMPROV_CMD.SCAN));
      onLogMessage?.('[IMPROV] Sent RPC 0x04 (request scanned networks)', 'tx');
    } else if (provisionMode === 'at') {
      onSendString?.(buildAtScan());
      onLogMessage?.('[AT] Sent AT+CWLAP (Scan APs)', 'tx');
    } else if (provisionMode === 'micropython') {
      onSendString?.(buildMicropythonScan());
      onLogMessage?.('[MICROPYTHON] Triggered wlan.scan()', 'tx');
    }
    clearTimeout(scanTimerRef.current);
    scanTimerRef.current = setTimeout(() => {
      if (scanAccRef.current.length) finishScan(scanAccRef.current);
      else { setIsScanning(false); setStatusMessage('No scan reply from the device. Check the mode (Improv / AT / MicroPython) and that the firmware supports it.'); }
      scanAccRef.current = [];
    }, 15000);
  };

  const handleIdentify = () => {
    if (!isConnected) return;
    onSendRawBytes?.(improvRpc(IMPROV_CMD.IDENTIFY));
    onLogMessage?.('[IMPROV] Sent RPC 0x05 (identify device)', 'tx');
    setStatusMessage('Identify sent. A supporting device blinks its LED; others answer "unknown RPC command".');
  };

  const creds = validateWifiCredentials(ssid, password);

  const handleProvision = (e) => {
    e.preventDefault();
    if (!isConnected || creds.errors.length) return;
    setIsProvisioning(true);
    setStatusMessage(`Provisioning network "${ssid}"...`);
    if (provisionMode === 'improv') {
      onSendRawBytes?.(improvWifiSettings(ssid, password));
      onLogMessage?.(`[IMPROV] Provisioning "${ssid}" via Improv RPC 0x01`, 'tx');
    } else if (provisionMode === 'at') {
      onSendString?.(buildAtProvision(ssid, password));
      onLogMessage?.(`[AT] Sent AT+CWJAP for "${ssid}"`, 'tx');
    } else if (provisionMode === 'micropython') {
      onSendString?.(buildMicropythonProvision(ssid, password));
      onLogMessage?.(`[MICROPYTHON] Sent Wi-Fi connect script for "${ssid}"`, 'tx');
    }
    clearTimeout(provTimerRef.current);
    provTimerRef.current = setTimeout(() => {
      setIsProvisioning(false);
      setStatusMessage('No result from the device after 30 s. Check the password and range, then read the packet log or serial log.');
    }, PROVISION_TIMEOUT_MS);
  };

  const copyText = async (key, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(key); setTimeout(() => setCopied(''), 1500); } catch { setStatusMessage('Clipboard is not available in this browser context.'); }
  };

  const getSignalBars = (rssi) => {
    if (rssi >= -55) return 'text-emerald-400 font-bold';
    if (rssi >= -70) return 'text-cyan-400';
    if (rssi >= -85) return 'text-amber-400';
    return 'text-rose-400';
  };

  const previewFrame = provisionMode === 'improv' && ssid && !creds.errors.length ? improvWifiSettings(ssid, password) : null;
  const canSubmit = isConnected && ssid && !creds.errors.length && !isProvisioning;
  const done = improvState === STATE_PROVISIONED;

  return (
    <div className="text-slate-200 text-xs font-mono space-y-2">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Wifi className="w-4 h-4 text-emerald-400 shrink-0" />
        <label className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-slate-400">
          Mode
          <select
            value={provisionMode}
            onChange={(e) => setProvisionMode(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded px-1.5 py-1 text-[11px] font-bold text-emerald-400 outline-none focus:border-emerald-500 cursor-pointer"
          >
            <option value="improv">Improv RPC (standard)</option>
            <option value="micropython">MicroPython REPL</option>
            <option value="at">ESP-AT commands</option>
          </select>
        </label>
        <div className="flex items-center gap-1 ml-auto">
          {provisionMode === 'improv' && (
            <>
              <button type="button" onClick={queryDevice} disabled={!isConnected} title="Ask the device for its state and info again" aria-label="Refresh device state" className={btnGhost}>
                <RotateCw className="w-3 h-3" /><span className="hidden @sm:inline">State</span>
              </button>
              <button type="button" onClick={handleIdentify} disabled={!isConnected} title="Improv Identify RPC (0x05): the device may blink an LED if its firmware supports it" aria-label="Identify device" className={btnGhost}>
                <Lightbulb className="w-3 h-3" /><span className="hidden @sm:inline">Identify</span>
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleScanNetworks}
            disabled={!isConnected || isScanning}
            title="Ask the device to scan for Wi-Fi networks"
            className={`${btn} ${isScanning ? 'bg-slate-800 text-slate-400 border-slate-700 animate-pulse' : 'bg-emerald-950/60 text-emerald-300 border-emerald-800 hover:bg-emerald-900/60'}`}
          >
            <RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />
            <span>{isScanning ? 'Scanning...' : 'Scan APs'}</span>
          </button>
        </div>
      </div>

      {/* Status */}
      <div className={`p-2 rounded-lg border flex flex-wrap items-center justify-between gap-2 ${
        done ? 'bg-emerald-950/40 border-emerald-500/50 text-emerald-200'
          : isProvisioning ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
            : 'bg-slate-900 border-slate-800 text-slate-300'
      }`} role="status" aria-live="polite">
        <div className="flex items-center gap-2 min-w-0">
          {done ? <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            : isProvisioning ? <RefreshCw className="w-4 h-4 text-amber-400 shrink-0 animate-spin" />
              : <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />}
          <div className="min-w-0">
            <div className="font-bold">
              {provisionMode === 'improv' ? (IMPROV_STATE_NAMES[improvState] || `State 0x${improvState.toString(16)}`) : (done ? 'Connected' : 'Waiting')}
            </div>
            <div className="text-[11px] text-slate-400 break-words">{statusMessage}</div>
            {deviceInfo && deviceInfo.length > 0 && (
              <div className="text-[11px] text-slate-400">Device: {deviceInfo.filter(Boolean).join(' · ')}</div>
            )}
          </div>
        </div>
        {assignedIp && (
          <a
            href={/^https?:\/\//.test(assignedIp) ? assignedIp : `http://${assignedIp}`}
            target="_blank"
            rel="noreferrer"
            className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500`}
          >
            <span>Open {assignedIp}</span><ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2">
        {/* Networks */}
        <div className="bg-slate-900/60 p-2 rounded-lg border border-slate-800 space-y-1.5">
          <div className="font-bold text-slate-200 flex items-center gap-1.5">
            <Signal className="w-3.5 h-3.5 text-emerald-400" />
            Nearby APs ({scannedNetworks.length})
          </div>
          <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
            {scannedNetworks.length === 0 && (
              <div className="py-3 text-center text-[11px] text-slate-500">
                {scanned ? 'The device reported no networks.' : 'No scan yet. Press Scan APs to ask the device.'}
              </div>
            )}
            {scannedNetworks.map((net) => (
              <button
                type="button"
                key={net.ssid}
                onClick={() => setSsid(net.ssid)}
                aria-pressed={ssid === net.ssid}
                title="Use this network"
                className={`w-full text-left px-2 py-1 rounded border flex items-center justify-between gap-2 focus:outline-none focus-visible:ring-1 focus-visible:ring-emerald-500 ${
                  ssid === net.ssid ? 'bg-emerald-950/50 border-emerald-500/80' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {net.secure ? <Lock className="w-3 h-3 text-slate-500 shrink-0" /> : <Unlock className="w-3 h-3 text-amber-500 shrink-0" />}
                  <span className="font-bold text-slate-200 truncate">{net.ssid}</span>
                </span>
                <span className={`text-[10px] shrink-0 ${getSignalBars(net.rssi)}`}>{net.rssi} dBm</span>
              </button>
            ))}
          </div>
        </div>

        {/* Credentials */}
        <form onSubmit={handleProvision} className="bg-slate-900/60 p-2 rounded-lg border border-slate-800 space-y-2">
          <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-1 gap-2">
            <div>
              <label htmlFor="improv-ssid" className="text-[10px] text-slate-400 uppercase font-bold block mb-0.5">Network SSID</label>
              <input
                id="improv-ssid"
                type="text"
                placeholder="e.g. MyHomeWiFi"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 text-emerald-300 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label htmlFor="improv-pass" className="text-[10px] text-slate-400 uppercase font-bold block mb-0.5">Wi-Fi password</label>
              <div className="relative">
                <input
                  id="improv-pass"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="WPA2 / WPA3 key (empty = open)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="off"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 pr-7 text-slate-200 text-xs outline-none focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-1.5 top-1.5 text-slate-500 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {ssid && creds.errors.map((m) => <div key={m} className="text-[11px] text-rose-400">{m}</div>)}
          {ssid && !creds.errors.length && creds.warnings.map((m) => <div key={m} className="text-[11px] text-amber-400">{m}</div>)}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              {provisionMode === 'improv' ? 'Improv RPC 0x01, checksum sum mod 256' : provisionMode === 'at' ? 'AT+CWMODE=1, AT+CWJAP' : 'network.WLAN one-liner'}
            </span>
            <button
              type="submit"
              disabled={!canSubmit}
              className={`${btn} px-3 py-1.5 ${canSubmit ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-500' : 'bg-slate-800 text-slate-500 border-slate-700'}`}
            >
              {isProvisioning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wifi className="w-3 h-3" />}
              <span>{isProvisioning ? 'Connecting...' : 'Connect board to Wi-Fi'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Details */}
      <details className="bg-slate-900/60 rounded-lg border border-slate-800">
        <summary className="px-2 py-1.5 cursor-pointer text-[11px] font-bold text-slate-300">Packet log and export</summary>
        <div className="p-2 pt-0 space-y-2">
          {provisionMode === 'improv' && (
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Frame that Connect will send (hex)</div>
              <div className="flex items-start gap-1">
                <code className="flex-1 bg-slate-950 border border-slate-800 rounded p-1.5 text-[10px] text-cyan-300 break-all">
                  {previewFrame ? frameToHex(previewFrame) : 'Enter a valid SSID to preview.'}
                </code>
                <button type="button" disabled={!previewFrame} onClick={() => copyText('hex', frameToHex(previewFrame))} title="Copy frame hex" aria-label="Copy frame hex" className={btnGhost}>
                  <Copy className="w-3 h-3" />{copied === 'hex' && <span>Copied</span>}
                </button>
              </div>
            </div>
          )}
          {provisionMode === 'micropython' && (
            <div>
              <div className="text-[10px] uppercase font-bold text-slate-400 mb-0.5">Python for Thonny or mpremote</div>
              <div className="flex items-start gap-1">
                <pre className="flex-1 bg-slate-950 border border-slate-800 rounded p-1.5 text-[10px] text-cyan-300 whitespace-pre-wrap break-all">
                  {ssid && !creds.errors.length ? micropythonSnippet(ssid, showPassword ? password : password.replace(/./g, '*')) : 'Enter a valid SSID to preview.'}
                </pre>
                <button type="button" disabled={!ssid || !!creds.errors.length} onClick={() => copyText('py', micropythonSnippet(ssid, password))} title="Copy Python (with the real password)" aria-label="Copy Python" className={btnGhost}>
                  <Copy className="w-3 h-3" />{copied === 'py' && <span>Copied</span>}
                </button>
              </div>
            </div>
          )}
          {provisionMode === 'at' && (
            <div className="text-[11px] text-slate-400">AT commands are sent as typed text. SSID and password are escaped for quotes, commas and backslashes.</div>
          )}
          {provisionMode === 'improv' && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] uppercase font-bold text-slate-400">Received Improv packets ({packetLog.length})</span>
                <button type="button" onClick={() => setPacketLog([])} disabled={!packetLog.length} className={btnGhost}>Clear</button>
              </div>
              <div className="max-h-32 overflow-y-auto bg-slate-950 border border-slate-800 rounded p-1.5 text-[10px] space-y-0.5">
                {packetLog.length === 0 && <div className="text-slate-500">No Improv packets received yet.</div>}
                {packetLog.map((p, i) => <div key={i}><span className="text-slate-500">{p.t}</span> {p.text}</div>)}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
