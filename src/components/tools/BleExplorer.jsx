import React, { useState, useRef, useCallback } from 'react';
import {
  Bluetooth,
  BluetoothConnected,
  BluetoothSearching,
  ChevronRight,
  ChevronDown,
  Eye,
  Bell,
  BellOff,
  Pencil,
  Power,
  ShieldAlert,
  Info,
  Loader2,
  Radio
} from 'lucide-react';
import {
  buildGattTree,
  readCharacteristic,
  parseCharacteristicValue,
  bytesToHex
} from '../../utils/bleDriver';
import StatusBadge from '../common/StatusBadge';

export default function BleExplorer() {
  const [device, setDevice] = useState(null);
  const [server, setServer] = useState(null);
  const [tree, setTree] = useState([]); // services with characteristics
  const [expanded, setExpanded] = useState({});
  const [values, setValues] = useState({}); // uuid -> { hex, decoded, byteLength, ts }
  const [status, setStatus] = useState('offline');
  const [statusMsg, setStatusMsg] = useState('No BLE device connected');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  // Live notify subscriptions: uuid -> { characteristic, handler }
  const notifyRefs = useRef({});

  const bleAvailable = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

  const addLog = useCallback((msg, kind = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-199), { ts, msg, kind }]);
  }, []);

  const resetState = () => {
    setDevice(null);
    setServer(null);
    setTree([]);
    setExpanded({});
    setValues({});
    notifyRefs.current = {};
    setStatus('offline');
    setStatusMsg('No BLE device connected');
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
      const dev = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          0x1800, 0x1801, 0x180a, 0x180d, 0x180f, 0x181a, 0x1812, 0x1826,
          0x1816, 0x1818, 0xfe59
        ]
      });

      dev.addEventListener('gattserverdisconnected', () => {
        addLog('Device disconnected.', 'err');
        resetState();
      });

      setStatusMsg('Connecting GATT…');
      const gatt = await dev.gatt.connect();

      setBusy(true);
      const gattTree = await buildGattTree(gatt);
      setBusy(false);

      setDevice(dev);
      setServer(gatt);
      setTree(gattTree);
      // Expand the first service by default.
      if (gattTree[0]) setExpanded({ [gattTree[0].uuid]: true });

      setStatus('online');
      setStatusMsg(`${dev.name || 'Unnamed device'} • ${gattTree.length} service(s)`);
      const totalChars = gattTree.reduce((a, s) => a + s.characteristics.length, 0);
      addLog(
        `Connected to ${dev.name || dev.id} — ${gattTree.length} services, ${totalChars} characteristics.`,
        'ok'
      );
    } catch (err) {
      setBusy(false);
      setStatus(device ? 'online' : 'warning');
      setStatusMsg(err.message || 'Connection cancelled');
      addLog(`Connect failed: ${err.message}`, 'err');
    }
  };

  const handleDisconnect = () => {
    try {
      if (server?.connected) server.disconnect();
    } catch {
      /* ignore */
    }
    addLog('Disconnected.', 'info');
    resetState();
  };

  // --- Characteristic actions --------------------------------------------
  const handleRead = async (ch) => {
    try {
      const result = await readCharacteristic(ch._ref);
      setValues((v) => ({ ...v, [ch.uuid]: { ...result, ts: Date.now() } }));
      addLog(
        `Read ${ch.name}: ${result.decoded ? result.decoded.text : result.hex}`,
        'ok'
      );
    } catch (err) {
      addLog(`Read ${ch.name} failed: ${err.message}`, 'err');
    }
  };

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
        const dv = e.target.value;
        const parsed = parseCharacteristicValue(ch.uuid, dv);
        setValues((v) => ({
          ...v,
          [ch.uuid]: { ...parsed, ts: Date.now(), notifying: true }
        }));
      };
      await ch._ref.startNotifications();
      ch._ref.addEventListener('characteristicvaluechanged', handler);
      notifyRefs.current[ch.uuid] = { characteristic: ch._ref, handler };
      addLog(`Subscribed to ${ch.name} notifications.`, 'ok');
    } catch (err) {
      addLog(`Notify ${ch.name} failed: ${err.message}`, 'err');
    }
  };

  const handleWrite = async (ch) => {
    const input = window.prompt(
      `Write to "${ch.name}" — enter hex bytes (e.g. 01 ff a0):`,
      ''
    );
    if (input == null) return;
    const clean = input.replace(/[^0-9a-fA-F]/g, '');
    if (clean.length === 0 || clean.length % 2 !== 0) {
      addLog('Write cancelled: hex must be whole bytes.', 'err');
      return;
    }
    const bytes = new Uint8Array(clean.match(/.{2}/g).map((h) => parseInt(h, 16)));
    try {
      if (ch.properties.writeWithoutResponse && !ch.properties.write) {
        await ch._ref.writeValueWithoutResponse(bytes);
      } else {
        await ch._ref.writeValueWithResponse(bytes);
      }
      addLog(`Wrote ${bytesToHex(bytes)} to ${ch.name}.`, 'ok');
    } catch (err) {
      addLog(`Write ${ch.name} failed: ${err.message}`, 'err');
    }
  };

  const toggleExpand = (uuid) =>
    setExpanded((e) => ({ ...e, [uuid]: !e[uuid] }));

  // --- Render -------------------------------------------------------------
  return (
    <div className="w-full max-w-5xl mx-auto p-4 space-y-4 text-slate-200">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-950/60 border border-blue-500/30">
            <Bluetooth className="w-6 h-6 text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-blue-300">Bluetooth LE Explorer</h2>
            <p className="text-xs text-slate-400">
              Web Bluetooth GATT client — enumerate services, read/write/subscribe characteristics
            </p>
          </div>
        </div>
        <StatusBadge
          status={status}
          label={status === 'online' ? 'GATT' : status === 'connecting' ? 'LINK' : 'IDLE'}
          value={status === 'online' ? 'Connected' : 'Offline'}
          pulse={status === 'connecting'}
        />
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

      {/* Connection */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/50 space-y-3">
        <p className="text-xs text-slate-400">{statusMsg}</p>
        <div className="flex gap-2">
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
            <button
              onClick={handleDisconnect}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-rose-900/60 hover:bg-rose-800 border border-rose-500/30 text-rose-200 text-sm font-semibold transition"
            >
              <Power className="w-4 h-4" />
              Disconnect
            </button>
          )}
        </div>
      </div>

      {/* GATT tree */}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="w-4 h-4 animate-spin" /> Discovering services…
        </div>
      )}

      {tree.length > 0 && (
        <div className="rounded-xl bg-slate-900/60 border border-slate-700/50 divide-y divide-slate-800">
          {tree.map((service) => (
            <div key={service.uuid}>
              <button
                onClick={() => toggleExpand(service.uuid)}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-slate-800/40 transition"
              >
                {expanded[service.uuid] ? (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                )}
                <Radio className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold text-slate-200">{service.name}</span>
                <span className="text-[11px] font-mono text-slate-500">
                  {service.short != null
                    ? `0x${service.short.toString(16)}`
                    : service.uuid.slice(0, 8)}
                </span>
                <span className="ml-auto text-[11px] text-slate-500">
                  {service.characteristics.length} char
                </span>
              </button>

              {expanded[service.uuid] && (
                <div className="pb-2">
                  {service.characteristics.map((ch) => {
                    const val = values[ch.uuid];
                    return (
                      <div
                        key={ch.uuid}
                        className="mx-4 mb-1.5 px-3 py-2 rounded-lg bg-slate-950/60 border border-slate-800"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm text-slate-200">{ch.name}</span>
                          <span className="text-[10px] font-mono text-slate-500">
                            {ch.short != null ? `0x${ch.short.toString(16)}` : ch.uuid.slice(0, 8)}
                          </span>
                          <PropBadges props={ch.properties} />
                          <div className="ml-auto flex items-center gap-1">
                            {ch.properties.read && (
                              <IconBtn title="Read" onClick={() => handleRead(ch)}>
                                <Eye className="w-3.5 h-3.5" />
                              </IconBtn>
                            )}
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
                                {val?.notifying ? (
                                  <BellOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Bell className="w-3.5 h-3.5" />
                                )}
                              </IconBtn>
                            )}
                          </div>
                        </div>

                        {val && (
                          <div className="mt-1.5 text-xs font-mono space-y-0.5">
                            {val.decoded && (
                              <div className="text-emerald-400">
                                {val.decoded.label}: {val.decoded.text}
                              </div>
                            )}
                            <div className="text-slate-400 break-all">
                              <span className="text-slate-600">hex</span> {val.hex || '(empty)'}
                              {val.notifying && (
                                <span className="ml-2 text-blue-400">● live</span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

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

function PropBadges({ props }) {
  const items = [];
  if (props.read) items.push(['R', 'text-emerald-400 border-emerald-500/30']);
  if (props.write) items.push(['W', 'text-amber-400 border-amber-500/30']);
  if (props.writeWithoutResponse) items.push(['Wn', 'text-amber-400 border-amber-500/30']);
  if (props.notify) items.push(['N', 'text-blue-400 border-blue-500/30']);
  if (props.indicate) items.push(['I', 'text-blue-400 border-blue-500/30']);
  return (
    <span className="flex items-center gap-1">
      {items.map(([t, cls], i) => (
        <span key={i} className={`px-1 py-0.5 rounded border text-[9px] font-mono ${cls}`}>
          {t}
        </span>
      ))}
    </span>
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
