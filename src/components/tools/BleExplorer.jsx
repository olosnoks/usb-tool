import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Bluetooth,
  BluetoothConnected,
  BluetoothSearching,
  Bell,
  BellOff,
  Pencil,
  Power,
  ShieldAlert,
  Info,
  Loader2,
  Radio,
  RefreshCw,
  Tag,
  Plus,
  X,
  TerminalSquare,
  KeyRound,
  Download,
  ChevronDown
} from 'lucide-react';
import {
  buildGattTree,
  readAllValues,
  isPairingError,
  parseCharacteristicValue,
  bytesToHex,
  canonicalUuid,
  STANDARD_SERVICE_UUIDS,
  VENDOR_SERVICES
} from '../../utils/bleDriver';
import { BleSerialPort, BLE_UART_SERVICE_UUIDS, looksLikeUart, uartProfileFor } from '../../utils/bleSerial';
import { useSerial } from '../../context/SerialContext';
import StatusBadge from '../common/StatusBadge';
import { WriteComposer, DfuPanel } from './ble/BleWriteAndDfu';
import { record } from '../../utils/sessionLog';
import {
  gattToJson,
  gattToMarkdown,
  notificationsToCsv,
  numericValue,
  pushBounded,
  teardownSubscriptions,
  releaseBleSession,
  NOTIFY_HISTORY_CAP
} from '../../utils/bleExport';
import pkg from '../../../package.json';

function downloadText(text, filename, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const PROP_LABELS = [
  ['read', 'Read'],
  ['write', 'Write'],
  ['writeWithoutResponse', 'Write without response'],
  ['notify', 'Notify'],
  ['indicate', 'Indicate']
];

const hex16 = (n) => `0x${n.toString(16).padStart(4, '0')}`;

// Custom service UUIDs the user added, kept between visits.
const CUSTOM_KEY = 'bleExplorer.customServices';
const FULL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function loadCustomServices() {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
    return Array.isArray(list) ? list.filter((u) => typeof u === 'string' && FULL_UUID.test(u)) : [];
  } catch {
    return [];
  }
}

/** Normalize user input ("ffe0", "0xFFE0", or a 128-bit UUID) or return null. */
export function normalizeServiceInput(text) {
  const u = canonicalUuid(String(text || '').trim());
  return FULL_UUID.test(u) ? u : null;
}

/**
 * Every service the browser should grant access to. Web Bluetooth hides any
 * service not listed here, so this covers all SIG services, common vendor
 * services, the BLE UART profiles and whatever the user added.
 */
export function buildOptionalServices(custom = []) {
  const all = [
    ...STANDARD_SERVICE_UUIDS.map((n) => canonicalUuid(n)),
    ...Object.keys(VENDOR_SERVICES),
    ...BLE_UART_SERVICE_UUIDS,
    ...custom
  ];
  return [...new Set(all)];
}

export default function BleExplorer() {
  const [device, setDevice] = useState(null);
  const [server, setServer] = useState(null);
  const [tree, setTree] = useState([]); // services with characteristics (+ descriptors)
  const [values, setValues] = useState({}); // characteristic uuid or "char/desc" -> value | { error }
  const [status, setStatus] = useState('offline');
  const [statusMsg, setStatusMsg] = useState('No BLE device connected');
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [lastRead, setLastRead] = useState(null);
  const [log, setLog] = useState([]);
  const [customServices, setCustomServices] = useState(loadCustomServices);
  const [customInput, setCustomInput] = useState('');
  // Set when the device asked for pairing (or dropped the link mid-read, which
  // is how many devices react to an unencrypted read of a protected value).
  const [pairingHint, setPairingHint] = useState(null);
  const [writeTarget, setWriteTarget] = useState(null);
  const lastDeviceRef = useRef(null);
  const readingRef = useRef(false);
  const { connectBle, isConnected: serialConnected, transportType: serialTransport } = useSerial();

  // Live notify subscriptions: uuid -> { characteristic, handler }
  const notifyRefs = useRef({});
  // Bounded per-characteristic notification history (uuid -> entries), shown via historyTick.
  const historyRef = useRef({});
  const [, setHistoryTick] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  // The gattserverdisconnected listener, kept so it can be removed.
  const disconnectListenerRef = useRef(null);
  // Advertisement watching (Chromium only, behind a flag in some versions).
  const [adv, setAdv] = useState(null);
  const [advWatching, setAdvWatching] = useState(false);
  const advRef = useRef(null); // { dev, handler, abort }
  const serialLiveRef = useRef(false);

  const bleAvailable = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  const addLog = useCallback((msg, kind = 'info') => {
    record('BLE', kind, msg);
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-199), { ts, msg, kind }]);
  }, []);

  const stopAdvertisements = useCallback(() => {
    const cur = advRef.current;
    advRef.current = null;
    if (!cur) return;
    try { cur.dev.removeEventListener('advertisementreceived', cur.handler); } catch { /* ignore */ }
    try { cur.abort.abort(); } catch { /* ignore */ }
  }, []);

  const teardownNotifications = useCallback(() => {
    teardownSubscriptions(notifyRefs.current);
    notifyRefs.current = {};
  }, []);

  const resetState = () => {
    teardownNotifications();
    stopAdvertisements();
    setAdv(null);
    setAdvWatching(false);
    if (disconnectListenerRef.current) {
      const { dev, fn } = disconnectListenerRef.current;
      try { dev.removeEventListener('gattserverdisconnected', fn); } catch { /* ignore */ }
      disconnectListenerRef.current = null;
    }
    setDevice(null);
    setServer(null);
    setTree([]);
    setValues({});
    setLastRead(null);
    historyRef.current = {};
    setHistoryTick((t) => t + 1);
    setStatus('offline');
    setStatusMsg('No BLE device connected');
  };

  // Read every readable characteristic and every descriptor, showing each
  // value as it arrives.
  const readEverything = async (gattTree) => {
    setReading(true);
    readingRef.current = true;
    try {
      const all = await readAllValues(gattTree, (key, v) => {
        setValues((prev) => ({ ...prev, [key]: { ...v, notifying: prev[key]?.notifying } }));
      });
      const errors = Object.values(all).filter((v) => v.error);
      const locked = errors.filter((v) => isPairingError(v.error)).length;
      setLastRead(new Date());
      addLog(`Read ${Object.keys(all).length - errors.length} value(s)${errors.length ? `, ${errors.length} refused by the device` : ''}.`, errors.length ? 'info' : 'ok');
      if (locked) {
        setPairingHint('protected');
        addLog(`${locked} value(s) need the device to be paired first.`, 'err');
      }
    } finally {
      setReading(false);
      readingRef.current = false;
    }
  };

  // --- Connect ------------------------------------------------------------
  const handleConnect = async () => {
    if (!bleAvailable) {
      setStatus('warning');
      setStatusMsg('Web Bluetooth is unavailable (use Chrome/Edge over HTTPS).');
      return;
    }
    try {
      setStatus('connecting');
      setStatusMsg('Requesting device… pick one in the browser chooser.');
      // acceptAllDevices lets any peripheral appear; optionalServices must be
      // declared up-front or GATT access to those services is blocked.
      // The browser silently drops blocklisted services (e.g. HID) from this list.
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: buildOptionalServices(customServices)
      });
      lastDeviceRef.current = dev;
      setPairingHint(null);
      setValues({});
      if (disconnectListenerRef.current) {
        const prev = disconnectListenerRef.current;
        try { prev.dev.removeEventListener('gattserverdisconnected', prev.fn); } catch { /* ignore */ }
      }
      const onGattDisconnected = () => {
        if (lastDeviceRef.current !== dev) return; // user disconnected or picked another device
        // Dropping the link while values are being read is the usual sign the
        // device wants an encrypted (paired) connection.
        const midRead = readingRef.current;
        addLog(midRead ? 'Device disconnected while reading values: it probably needs pairing.' : 'Device disconnected.', 'err');
        if (midRead) setPairingHint('dropped');
        // Keep what was already read on screen; Reconnect picks up from here.
        setServer(null);
        setStatus('offline');
        setStatusMsg(`${dev.name || 'Device'} disconnected. Values below are from the last read.`);
      };
      dev.addEventListener('gattserverdisconnected', onGattDisconnected);
      disconnectListenerRef.current = { dev, fn: onGattDisconnected };
      await connectTo(dev);
    } catch (err) {
      setBusy(false);
      setStatus(device ? 'online' : 'warning');
      setStatusMsg(err.message || 'Connection cancelled');
      addLog(`Connect failed: ${err.message}`, 'err');
    }
  };

  // Connect GATT to a device already picked in the chooser.
  const connectTo = async (dev) => {
    setStatus('connecting');
    setStatusMsg('Connecting GATT…');
    const gatt = await dev.gatt.connect();

    setBusy(true);
    const gattTree = await buildGattTree(gatt);
    setBusy(false);

    setDevice(dev);
    setServer(gatt);
    setTree(gattTree);

    setStatus('online');
    setStatusMsg(`${dev.name || 'Unnamed device'} • ${gattTree.length} service(s)`);
    const totalChars = gattTree.reduce((a, s) => a + s.characteristics.length, 0);
    addLog(
      `Connected to ${dev.name || dev.id} — ${gattTree.length} services, ${totalChars} characteristics.`,
      'ok'
    );
    await readEverything(gattTree);
  };

  const handleReconnect = async () => {
    const dev = lastDeviceRef.current;
    if (!dev) return handleConnect();
    try {
      addLog(`Reconnecting to ${dev.name || dev.id}…`, 'info');
      await connectTo(dev);
    } catch (err) {
      setBusy(false);
      setStatus('warning');
      setStatusMsg(err.message || 'Reconnect failed');
      addLog(`Reconnect failed: ${err.message}`, 'err');
    }
  };

  const handleDisconnect = () => {
    const dev = lastDeviceRef.current;
    lastDeviceRef.current = null; // so the disconnect event is not reported as a drop
    setPairingHint(null);
    try {
      if (!server?.connected && dev?.gatt?.connected) dev.gatt.disconnect();
      if (server?.connected) server.disconnect();
    } catch {
      /* ignore */
    }
    addLog('Disconnected.', 'info');
    resetState();
  };

  // --- Characteristic actions --------------------------------------------
  const handleToggleNotify = async (ch) => {
    const existing = notifyRefs.current[ch.uuid];
    try {
      if (existing) {
        await ch._ref.stopNotifications();
        ch._ref.removeEventListener('characteristicvaluechanged', existing.handler);
        delete notifyRefs.current[ch.uuid];
        addLog(`Unsubscribed from ${ch.name}.`, 'info');
        setValues((v) => ({ ...v, [ch.uuid]: { ...(v[ch.uuid] || {}), notifying: false } }));
        return;
      }
      const handler = (e) => {
        const parsed = parseCharacteristicValue(ch.uuid, e.target.value);
        const now = Date.now();
        const list = historyRef.current[ch.uuid] || (historyRef.current[ch.uuid] = []);
        pushBounded(list, {
          ts: now,
          characteristic: ch.uuid,
          name: ch.name,
          hex: parsed.hex,
          decoded: parsed.decoded ? `${parsed.decoded.label}: ${parsed.decoded.text}` : '',
          numeric: numericValue(parsed)
        }, NOTIFY_HISTORY_CAP);
        setHistoryTick((t) => t + 1);
        setValues((v) => ({ ...v, [ch.uuid]: { ...parsed, ts: Date.now(), notifying: true } }));
      };
      await ch._ref.startNotifications();
      ch._ref.addEventListener('characteristicvaluechanged', handler);
      notifyRefs.current[ch.uuid] = { characteristic: ch._ref, handler };
      setValues((v) => ({ ...v, [ch.uuid]: { ...(v[ch.uuid] || {}), notifying: true } }));
      addLog(`Subscribed to ${ch.name} notifications.`, 'ok');
    } catch (err) {
      addLog(`Notify ${ch.name} failed: ${err.message}`, 'err');
    }
  };

  // Writes go through the inline composer (formats, preview, history).
  const handleWrite = (ch) => setWriteTarget(ch);

  const saveCustom = (list) => {
    setCustomServices(list);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  };

  const handleAddCustom = () => {
    const u = normalizeServiceInput(customInput);
    if (!u) {
      addLog(`"${customInput}" is not a service UUID. Use 4 hex digits (ffe0) or a full 128-bit UUID.`, 'err');
      return;
    }
    if (!customServices.includes(u)) saveCustom([...customServices, u]);
    setCustomInput('');
    addLog(`Added service ${u}. ${device ? 'Disconnect and connect again so the browser grants access to it.' : 'It will be requested on the next connect.'}`, 'ok');
  };

  // Hand a UART-style service to the Terminal (and every serial tool) as a port.
  const handleUseAsSerial = async (service) => {
    if (!device) return;
    // Our own subscriptions on this service would double-deliver notifications.
    for (const ch of service.characteristics) {
      const sub = notifyRefs.current[ch.uuid];
      if (sub) {
        try { await ch._ref.stopNotifications(); } catch { /* ignore */ }
        ch._ref.removeEventListener('characteristicvaluechanged', sub.handler);
        delete notifyRefs.current[ch.uuid];
        setValues((v) => ({ ...v, [ch.uuid]: { ...(v[ch.uuid] || {}), notifying: false } }));
      }
    }
    addLog(`Opening ${service.name} as a serial port. Its output now shows in the Terminal.`, 'ok');
    await connectBle(new BleSerialPort(device, { serviceUuid: service.uuid }));
  };

  serialLiveRef.current = serialConnected && serialTransport === 'ble';

  // Unmount: stop notifications, drop listeners and release the GATT link, so
  // navigating to another tool never leaves the device connected.
  useEffect(() => () => {
    stopAdvertisements();
    const dev = lastDeviceRef.current;
    lastDeviceRef.current = null; // so the disconnect event is not reported as a drop
    const subs = notifyRefs.current;
    notifyRefs.current = {};
    const listener = disconnectListenerRef.current;
    disconnectListenerRef.current = null;
    // A link handed to the Terminal as a serial port belongs to that session now.
    releaseBleSession({ subs, device: dev, disconnectListener: listener, keepLink: serialLiveRef.current });
  }, [teardownNotifications, stopAdvertisements]);

  const advSupported = !!device && typeof device.watchAdvertisements === 'function';

  const handleWatchAdvertisements = async () => {
    if (!advSupported || advRef.current) return;
    const abort = new AbortController();
    const handler = (e) => {
      const mfg = [];
      if (e.manufacturerData && typeof e.manufacturerData.forEach === 'function') {
        e.manufacturerData.forEach((dv, id) => mfg.push({ companyId: id, hex: bytesToHex(dv) }));
      }
      setAdv({
        ts: Date.now(),
        rssi: typeof e.rssi === 'number' ? e.rssi : null,
        txPower: typeof e.txPower === 'number' ? e.txPower : null,
        manufacturerData: mfg
      });
    };
    advRef.current = { dev: device, handler, abort };
    device.addEventListener('advertisementreceived', handler);
    try {
      await device.watchAdvertisements({ signal: abort.signal });
      setAdvWatching(true);
      addLog('Watching advertisements for the selected device.', 'ok');
    } catch (err) {
      stopAdvertisements();
      addLog(`Advertisement watching failed: ${err.message}`, 'err');
    }
  };

  const handleStopAdvertisements = () => {
    stopAdvertisements();
    setAdvWatching(false);
  };

  const handleExportGatt = (kind) => {
    if (!tree.length) return;
    const opts = { toolVersion: pkg.version };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = `gatt_${(device?.name || 'device').replace(/[^\w-]+/g, '_')}_${stamp}`;
    if (kind === 'json') {
      downloadText(JSON.stringify(gattToJson(device, tree, values, opts), null, 2), `${base}.json`, 'application/json');
    } else {
      downloadText(gattToMarkdown(device, tree, values, opts), `${base}.md`, 'text/markdown');
    }
    addLog(`Exported GATT tree as ${kind === 'json' ? 'JSON' : 'Markdown'}.`, 'ok');
  };

  const historyTotal = Object.values(historyRef.current).reduce((a, l) => a + l.length, 0);
  const handleDownloadCsv = () => {
    if (!historyTotal) return;
    downloadText(notificationsToCsv(historyRef.current), `ble_notifications_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`, 'text/csv');
  };

  const totalChars = tree.reduce((a, s) => a + s.characteristics.length, 0);
  const totalDescs = tree.reduce((a, s) => a + s.characteristics.reduce((b, c) => b + (c.descriptors?.length || 0), 0), 0);

  // --- Render -------------------------------------------------------------
  return (
    <div className="w-full max-w-7xl mx-auto p-4 space-y-4 text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-950/60 border border-blue-500/30">
            <Bluetooth className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <p className="text-xs text-slate-400">
              Web Bluetooth GATT client — every service, characteristic, descriptor and value on the device
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleExportGatt('json')}
            disabled={tree.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/40 text-xs text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" /> Export JSON
          </button>
          <button
            onClick={() => handleExportGatt('markdown')}
            disabled={tree.length === 0}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/40 text-xs text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-3.5 h-3.5" /> Export Markdown
          </button>
        <StatusBadge
          status={status}
          label={status === 'online' ? 'GATT' : status === 'connecting' ? 'LINK' : 'IDLE'}
          value={status === 'online' ? 'Connected' : 'Offline'}
          pulse={status === 'connecting'}
        />
        </div>
      </div>

      {!bleAvailable && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-950/40 border border-amber-500/30 text-amber-300 text-sm">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <span>
            Web Bluetooth isn&apos;t available here. Use a Chromium browser (Chrome, Edge) over HTTPS
            or localhost. Safari and Firefox do not support it.
          </span>
        </div>
      )}

      <div className="flex items-start gap-2 p-3 rounded-lg bg-slate-900/60 border border-slate-700/40 text-xs text-slate-400">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-400" />
        Web Bluetooth is a GATT <em>client</em>: it connects only to a device you pick in the
        chooser and cannot passively sniff advertisements. For promiscuous BLE sniffing you need
        external hardware (e.g. an nRF/Ubertooth over serial).
      </div>

      {/* Connection + device summary */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/50 space-y-3">
        <p className="text-xs text-slate-400">{statusMsg}</p>
        {pairingHint && <PairingHelp reason={pairingHint} deviceName={lastDeviceRef.current?.name} onDismiss={() => setPairingHint(null)} />}
        <div className="flex flex-wrap items-center gap-2">
          {status !== 'online' && lastDeviceRef.current && status !== 'connecting' && (
            <button
              onClick={handleReconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/40 text-slate-200 text-sm font-semibold transition"
            >
              <RefreshCw className="w-4 h-4" />
              Reconnect {lastDeviceRef.current.name || 'device'}
            </button>
          )}
          {status !== 'online' ? (
            <button
              onClick={handleConnect}
              disabled={!bleAvailable || status === 'connecting'}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600/80 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-semibold transition"
            >
              {status === 'connecting' ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <BluetoothSearching className="w-4 h-4" />
              )}
              Scan &amp; Connect
            </button>
          ) : (
            <>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-900/60 hover:bg-rose-800 border border-rose-500/30 text-rose-200 text-sm font-semibold transition"
              >
                <Power className="w-4 h-4" />
                Disconnect
              </button>
              <button
                onClick={() => readEverything(tree)}
                disabled={reading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/40 text-slate-200 text-sm font-semibold transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${reading ? 'animate-spin' : ''}`} />
                {reading ? 'Reading…' : 'Re-read all'}
              </button>
              {lastRead && <span className="text-[11px] text-slate-500">last read {lastRead.toLocaleTimeString()}</span>}
            </>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="text-[11px] text-slate-500">
            All Bluetooth SIG services and common vendor services (Nordic UART, HM-10, Microchip, Flipper, DFU)
            are requested automatically. Add any other service UUID your device uses so the browser exposes it.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom(); }}
              placeholder="ffe0 or 0000aaaa-0000-1000-8000-00805f9b34fb"
              className="flex-1 min-w-[16rem] px-2 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs font-mono text-slate-200 placeholder:text-slate-600"
            />
            <button
              onClick={handleAddCustom}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-600/40 text-xs text-slate-200"
            >
              <Plus className="w-3.5 h-3.5" /> Add service
            </button>
          </div>
          {customServices.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {customServices.map((u) => (
                <span key={u} className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-950 text-[11px] font-mono text-slate-300">
                  {u}
                  <button title="Remove" onClick={() => saveCustom(customServices.filter((x) => x !== u))} className="text-slate-500 hover:text-rose-400">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        {device && (
          <div className="grid grid-cols-2 @sm:grid-cols-5 gap-2 text-xs">
            <Field label="Name" value={device.name || '(no name)'} />
            <Field label="Device ID" value={device.id} mono />
            <Field label="Services" value={tree.length} />
            <Field label="Characteristics" value={totalChars} />
            <Field label="Descriptors" value={totalDescs} />
          </div>
        )}
        {device && (
          <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs space-y-1" data-testid="ble-adv">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase text-slate-500">Advertisements</span>
              {advSupported && !advWatching && (
                <button onClick={handleWatchAdvertisements} className="px-2 py-0.5 rounded border border-slate-600/40 bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200">
                  Watch advertisements
                </button>
              )}
              {advSupported && advWatching && (
                <button onClick={handleStopAdvertisements} className="px-2 py-0.5 rounded border border-slate-600/40 bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200">
                  Stop watching
                </button>
              )}
            </div>
            {!advSupported && (
              <div className="text-slate-500">
                Advertisement watching is not supported in this browser (watchAdvertisements is missing; in Chrome it may be behind
                chrome://flags/#enable-experimental-web-platform-features).
              </div>
            )}
            {advSupported && !adv && (
              <div className="text-slate-500">{advWatching ? 'Waiting for the next advertisement from this device…' : 'Not watching.'}</div>
            )}
            {adv && (
              <div className="font-mono text-slate-300 space-y-0.5">
                <div>RSSI {adv.rssi ?? 'n/a'} dBm · TX power {adv.txPower ?? 'n/a'} dBm · {new Date(adv.ts).toLocaleTimeString()}</div>
                {adv.manufacturerData.length === 0 && <div className="text-slate-500">No manufacturer data in this advertisement.</div>}
                {adv.manufacturerData.map((m) => (
                  <div key={m.companyId} className="break-all">
                    manufacturer 0x{m.companyId.toString(16).padStart(4, '0')}: {m.hex || '(empty)'}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {historyTotal > 0 && (
          <div className="rounded-lg bg-slate-950/60 border border-slate-800 text-xs" data-testid="ble-history">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button onClick={() => setHistoryOpen((o) => !o)} className="flex items-center gap-1 text-slate-300 font-semibold">
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${historyOpen ? '' : '-rotate-90'}`} />
                Notification history ({historyTotal})
              </button>
              <button onClick={handleDownloadCsv} className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded border border-slate-600/40 bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-200">
                <Download className="w-3 h-3" /> Download CSV
              </button>
            </div>
            {historyOpen && (
              <div className="px-2 pb-2 space-y-2">
                {Object.entries(historyRef.current).map(([uuid, list]) => {
                  const nums = list.map((r) => r.numeric).filter((n) => n != null);
                  return (
                    <div key={uuid} className="space-y-0.5">
                      <div className="font-mono text-[11px] text-slate-400 break-all">{list[0]?.name} · {uuid} · {list.length} entries</div>
                      {nums.length > 1 && <NumericSparkline values={nums.slice(-60)} />}
                      <div className="font-mono text-[11px] max-h-32 overflow-y-auto">
                        {list.slice(-20).reverse().map((r, i) => (
                          <div key={`${r.ts}-${i}`} className="text-slate-300 break-all">
                            <span className="text-slate-600">{new Date(r.ts).toLocaleTimeString()}</span> {r.hex || '(empty)'}{r.decoded ? ` · ${r.decoded}` : ''}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {busy && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Discovering services…
        </div>
      )}

      {/* GATT tree: everything, always expanded */}
      {tree.map((service) => (
        <div key={service.uuid} className="rounded-xl bg-slate-900/60 border border-slate-700/50">
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-slate-800">
            <Radio className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold text-slate-100">{service.name}</span>
            {service.short != null && <span className="text-[11px] font-mono text-blue-300">{hex16(service.short)}</span>}
            <span className="text-[11px] font-mono text-slate-500 break-all">{service.uuid}</span>
            <span className="ml-auto text-[11px] text-slate-500">
              {service.assigned ? 'SIG-assigned' : 'vendor-specific'} · {service.characteristics.length} characteristic{service.characteristics.length === 1 ? '' : 's'}
            </span>
            {looksLikeUart(service.uuid, service.characteristics) && (
              <button
                onClick={() => handleUseAsSerial(service)}
                disabled={serialConnected && serialTransport === 'ble'}
                title={uartProfileFor(service.uuid)
                  ? 'Open this UART service in the Terminal and the other serial tools'
                  : 'This service has a notifying and a writable characteristic. Open it as a serial port'}
                className="flex items-center gap-1 px-2 py-1 rounded border border-sky-500/40 bg-sky-950/40 hover:bg-sky-900/50 text-[11px] text-sky-300 disabled:opacity-40"
              >
                <TerminalSquare className="w-3.5 h-3.5" />
                {serialConnected && serialTransport === 'ble' ? 'Serial port open' : 'Use as serial port'}
              </button>
            )}
          </div>

          <div className="p-3 space-y-2">
            {service.characteristics.length === 0 && (
              <div className="text-xs text-slate-500 px-1">No characteristics exposed.</div>
            )}
            {service.characteristics.map((ch) => {
              const val = values[ch.uuid];
              return (
                <div key={ch.uuid} className="px-3 py-2.5 rounded-lg bg-slate-950/60 border border-slate-800 space-y-2">
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-slate-200">{ch.name}</span>
                        {ch.short != null && <span className="text-[11px] font-mono text-blue-300">{hex16(ch.short)}</span>}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 break-all">{ch.uuid}</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1">
                      {(ch.properties.write || ch.properties.writeWithoutResponse) && (
                        <IconBtn title="Write" onClick={() => handleWrite(ch)}>
                          <Pencil className="w-3.5 h-3.5" />
                        </IconBtn>
                      )}
                      {(ch.properties.notify || ch.properties.indicate) && (
                        <IconBtn
                          title={val?.notifying ? 'Unsubscribe' : 'Subscribe'}
                          active={val?.notifying}
                          onClick={() => handleToggleNotify(ch)}
                        >
                          {val?.notifying ? <BellOff className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                        </IconBtn>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1">
                    {PROP_LABELS.filter(([k]) => ch.properties[k]).map(([k, label]) => (
                      <span key={k} className="px-1.5 py-0.5 rounded border border-slate-700 text-[10px] text-slate-300">{label}</span>
                    ))}
                  </div>

                  <ValueBlock val={val} canRead={ch.properties.read} canNotify={ch.properties.notify || ch.properties.indicate} />

                  {ch.descriptors?.length > 0 && (
                    <div className="pl-3 border-l border-slate-800 space-y-1.5">
                      {ch.descriptors.map((d) => {
                        const dvv = values[`${ch.uuid}/${d.uuid}`];
                        return (
                          <div key={d.uuid} className="text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <Tag className="w-3 h-3 text-slate-500" />
                              <span className="text-slate-300">{d.name}</span>
                              {d.short != null && <span className="font-mono text-[11px] text-blue-300">{hex16(d.short)}</span>}
                              <span className="font-mono text-[11px] text-slate-600 break-all">{d.uuid}</span>
                            </div>
                            {dvv?.error ? (
                              <div className="font-mono text-rose-400 ml-5">{dvv.error}</div>
                            ) : dvv ? (
                              <div className="font-mono ml-5 space-y-0.5">
                                {dvv.text && <div className="text-emerald-400">{dvv.text}</div>}
                                <div className="text-slate-400 break-all"><span className="text-slate-600">hex</span> {dvv.hex || '(empty)'}</div>
                              </div>
                            ) : (
                              <div className="font-mono text-slate-600 ml-5">reading…</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {writeTarget && (
        <WriteComposer
          key={writeTarget.uuid}
          ch={writeTarget}
          onClose={() => setWriteTarget(null)}
          onWritten={() => { if (writeTarget.properties.read) readEverything(tree); }}
          addLog={addLog}
        />
      )}
      {tree.length > 0 && <DfuPanel tree={tree} addLog={addLog} />}

      {/* Log */}
      <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
        <div className="flex items-center gap-2">
          <BluetoothConnected className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-semibold text-slate-300">Session Log</span>
        </div>
        <div className="font-mono text-xs space-y-0.5 max-h-56 overflow-y-auto">
          {log.length === 0 && <div className="text-slate-600">No activity yet.</div>}
          {log.map((entry, i) => (
            <div
              key={i}
              className={
                entry.kind === 'err'
                  ? 'text-rose-400'
                  : entry.kind === 'ok'
                    ? 'text-emerald-400'
                    : 'text-slate-400'
              }
            >
              <span className="text-slate-600">{entry.ts}</span> {entry.msg}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function NumericSparkline({ values }) {
  const w = 160;
  const h = 24;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <svg width={w} height={h} role="img" aria-label={`sparkline ${min} to ${max}`} className="text-blue-400">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Field({ label, value, mono }) {
  return (
    <div className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 min-w-0">
      <div className="text-[10px] uppercase text-slate-500">{label}</div>
      <div className={`text-slate-200 break-all ${mono ? 'font-mono text-[11px]' : ''}`}>{String(value)}</div>
    </div>
  );
}

// Everything known about a characteristic's value.
function ValueBlock({ val, canRead, canNotify }) {
  if (!canRead && !val?.hex && val?.hex !== '') {
    return (
      <div className="text-xs text-slate-500">
        {canNotify ? 'Not readable. Subscribe to see its values.' : 'Not readable (write-only).'}
      </div>
    );
  }
  if (!val) return <div className="text-xs font-mono text-slate-600">reading…</div>;
  if (val.error) return <div className="text-xs font-mono text-rose-400">Read refused: {val.error}</div>;
  return (
    <div className="text-xs font-mono space-y-0.5">
      {val.decoded && (
        <div className="text-emerald-400">{val.decoded.label}: {val.decoded.text}</div>
      )}
      {val.formatted && val.formatted !== val.decoded && (
        <div className="text-emerald-400">{val.formatted.label}: {val.formatted.text}</div>
      )}
      <div className="text-slate-300 break-all">
        <span className="text-slate-600">hex</span> {val.hex || '(empty)'}
        {val.notifying && <span className="ml-2 text-blue-400">● live</span>}
      </div>
      {val.byteLength > 0 && (
        <div className="text-slate-400 break-all"><span className="text-slate-600">ascii</span> {val.ascii}</div>
      )}
      {val.numbers?.length > 0 && (
        <div className="text-slate-400">
          {val.numbers.map(([k, n]) => (
            <span key={k} className="mr-3"><span className="text-slate-600">{k}</span> {String(n)}</span>
          ))}
        </div>
      )}
      <div className="text-slate-600">
        {val.byteLength} byte{val.byteLength === 1 ? '' : 's'}{val.ts ? ` · ${new Date(val.ts).toLocaleTimeString()}` : ''}
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick, active }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded border transition ${
        active
          ? 'bg-blue-900/50 border-blue-500/40 text-blue-300'
          : 'bg-slate-800 border-slate-600/40 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

// Web Bluetooth has no API for a page to send a passkey: the code is entered in
// the browser's or the operating system's pairing prompt. This explains how.
function PairingHelp({ reason, deviceName, onDismiss }) {
  const name = deviceName || 'the device';
  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  const isMac = typeof navigator !== 'undefined' && /Mac OS X/i.test(navigator.userAgent);
  return (
    <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-950/30 text-xs text-amber-100 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-amber-300">
          <KeyRound className="w-4 h-4" />
          {reason === 'dropped' ? `${name} dropped the connection while values were being read` : `Some values on ${name} need pairing`}
        </div>
        <button onClick={onDismiss} title="Dismiss" className="text-amber-400/70 hover:text-amber-200"><X className="w-3.5 h-3.5" /></button>
      </div>
      <p className="text-amber-100/80">
        The device wants an encrypted, paired link, often with a PIN or passkey. Browsers don&apos;t let a web page enter
        that code, so pair it once with the computer, then reconnect here:
      </p>
      <ol className="list-decimal ml-5 space-y-1 text-amber-100/90">
        <li>
          Some browser versions show their own pairing prompt when you reconnect. If one appears, type the code there.
        </li>
        <li>
          {isWindows ? (
            <>Otherwise open <a href="ms-settings:bluetooth" className="underline text-amber-300">Windows Bluetooth settings</a> → <b>Add device</b> → <b>Bluetooth</b>, pick {name} and enter its code.</>
          ) : isMac ? (
            <>Otherwise open <b>System Settings → Bluetooth</b>, click <b>Connect</b> next to {name} and enter its code.</>
          ) : (
            <>Otherwise pair {name} in your system&apos;s Bluetooth settings (or <code>bluetoothctl pair</code>) and enter its code.</>
          )}
        </li>
        <li>Click <b>Reconnect</b> above. Reads now go over the encrypted link.</li>
      </ol>
      <p className="text-amber-100/60">
        Common default codes are 000000, 123456 or 1234; devices with a screen show the code to type.
        If {name} is already paired and still refuses, remove it from the system&apos;s Bluetooth list and pair again.
      </p>
    </div>
  );
}
