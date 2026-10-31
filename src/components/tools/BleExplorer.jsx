import React, { useState, useRef, useCallback } from 'react';
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
  Tag
} from 'lucide-react';
import {
  buildGattTree,
  readAllValues,
  parseCharacteristicValue,
  bytesToHex
} from '../../utils/bleDriver';
import StatusBadge from '../common/StatusBadge';

const PROP_LABELS = [
  ['read', 'Read'],
  ['write', 'Write'],
  ['writeWithoutResponse', 'Write without response'],
  ['notify', 'Notify'],
  ['indicate', 'Indicate']
];

const hex16 = (n) => `0x${n.toString(16).padStart(4, '0')}`;

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
    setValues({});
    setLastRead(null);
    notifyRefs.current = {};
    setStatus('offline');
    setStatusMsg('No BLE device connected');
  };

  // Read every readable characteristic and every descriptor, showing each
  // value as it arrives.
  const readEverything = async (gattTree) => {
    setReading(true);
    try {
      const all = await readAllValues(gattTree, (key, v) => {
        setValues((prev) => ({ ...prev, [key]: { ...v, notifying: prev[key]?.notifying } }));
      });
      const failed = Object.values(all).filter((v) => v.error).length;
      setLastRead(new Date());
      addLog(`Read ${Object.keys(all).length} value(s)${failed ? `, ${failed} refused by the device` : ''}.`, failed ? 'info' : 'ok');
    } finally {
      setReading(false);
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

      setStatus('online');
      setStatusMsg(`${dev.name || 'Unnamed device'} • ${gattTree.length} service(s)`);
      const totalChars = gattTree.reduce((a, s) => a + s.characteristics.length, 0);
      addLog(
        `Connected to ${dev.name || dev.id} — ${gattTree.length} services, ${totalChars} characteristics.`,
        'ok'
      );
      await readEverything(gattTree);
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
      if (ch.properties.read) await readEverything(tree);   // show the result of the write
    } catch (err) {
      addLog(`Write ${ch.name} failed: ${err.message}`, 'err');
    }
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
            <h2 className="text-xl font-bold text-blue-300">Bluetooth LE Explorer</h2>
            <p className="text-xs text-slate-400">
              Web Bluetooth GATT client — every service, characteristic, descriptor and value on the device
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

      {/* Connection + device summary */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-700/50 space-y-3">
        <p className="text-xs text-slate-400">{statusMsg}</p>
        <div className="flex flex-wrap items-center gap-2">
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
        {device && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
            <Field label="Name" value={device.name || '(no name)'} />
            <Field label="Device ID" value={device.id} mono />
            <Field label="Services" value={tree.length} />
            <Field label="Characteristics" value={totalChars} />
            <Field label="Descriptors" value={totalDescs} />
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
