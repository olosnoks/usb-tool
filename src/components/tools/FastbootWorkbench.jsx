import React, { useState, useRef, useCallback } from 'react';
import {
  Usb,
  Smartphone,
  AlertTriangle,
  ShieldAlert,
  Unlock,
  Lock,
  Power,
  RefreshCw,
  Upload,
  Trash2,
  Rocket,
  Info,
  Sparkles,
  Loader2
} from 'lucide-react';
import {
  FastbootDevice,
  requestFastbootDevice,
  createSimulatedFastboot,
  summarizeVars
} from '../../utils/fastbootDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const REBOOT_TARGETS = [
  { id: '', label: 'System (Android)' },
  { id: 'bootloader', label: 'Bootloader' },
  { id: 'fastboot', label: 'Fastbootd (userspace)' },
  { id: 'recovery', label: 'Recovery' }
];

export default function FastbootWorkbench() {
  const [dev, setDev] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState('offline');
  const [statusMsg, setStatusMsg] = useState('No fastboot device connected');
  const [summary, setSummary] = useState(null);
  const [vars, setVars] = useState(null);
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState(null);

  const [partition, setPartition] = useState('boot');
  const [image, setImage] = useState(null); // { name, data }
  const fileRef = useRef(null);

  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const addLog = useCallback((msg, kind = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-299), { ts, msg, kind }]);
  }, []);

  const refreshVars = async (device) => {
    const { vars: v } = await device.getAllVars();
    setVars(v);
    setSummary(summarizeVars(v));
  };

  const connect = async (simulated) => {
    setBusy('connect');
    try {
      const transport = simulated ? createSimulatedFastboot() : await requestFastbootDevice();
      const device = new FastbootDevice(transport, { logger: addLog });
      await device.open();
      setDev(device);
      setIsSimulated(simulated);
      await refreshVars(device);
      setStatus(simulated ? 'warning' : 'online');
      setStatusMsg(simulated ? 'Simulated bootloader' : 'Fastboot device connected');
      addLog(simulated ? 'Connected to a simulated bootloader.' : 'Connected to fastboot device.', 'ok');
    } catch (err) {
      setStatus('warning');
      setStatusMsg(err.message);
      addLog(`Connect failed: ${err.message}`, 'err');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    try { await dev?.close(); } catch (e) { /* ignore */ }
    setDev(null);
    setIsSimulated(false);
    setSummary(null);
    setVars(null);
    setStatus('offline');
    setStatusMsg('No fastboot device connected');
    addLog('Disconnected.', 'info');
  };

  const guard = async (label, fn, confirmMsg) => {
    if (!dev || busy) return;
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      addLog(`${label} failed: ${err.message}`, 'err');
    } finally {
      setBusy('');
      setProgress(null);
    }
  };

  const handleUnlock = () => guard('unlock', async () => {
    const msg = await dev.unlock();
    addLog(`Unlock: ${msg}`, 'ok');
    addLog('If the phone shows an unlock prompt, approve it with the volume/power keys. This wipes user data.', 'info');
    await refreshVars(dev);
  }, 'Unlock the bootloader?\n\nThis ERASES ALL USER DATA on the device, and the phone will ask you to confirm on its own screen with the hardware keys. Only do this on a device you own and have backed up.');

  const handleLock = () => guard('lock', async () => {
    addLog(`Lock: ${await dev.lock()}`, 'ok');
    await refreshVars(dev);
  }, 'Re-lock the bootloader? This also wipes user data on most devices.');

  const pickFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setImage({ name: file.name, data: new Uint8Array(ev.target.result) });
      addLog(`Loaded ${file.name} (${ev.target.result.byteLength} bytes).`, 'info');
    };
    reader.readAsArrayBuffer(file);
  };

  const handleFlash = () => guard('flash', async () => {
    if (!image) throw new Error('Choose an image file first.');
    if (!partition.trim()) throw new Error('Enter a partition name.');
    await dev.flash(partition.trim(), image.data, {
      onProgress: (p) => setProgress(p)
    });
    addLog(`Flashed ${image.name} to ${partition}.`, 'ok');
  }, `Flash "${image?.name || '(no file)'}" to the "${partition}" partition? Flashing the wrong image to the wrong partition can brick the device.`);

  const handleErase = () => guard('erase', async () => {
    await dev.erase(partition.trim());
    addLog(`Erased ${partition}.`, 'ok');
  }, `Erase the "${partition}" partition? Its contents are lost.`);

  const handleBoot = () => guard('boot', async () => {
    if (!image) throw new Error('Choose an image file first.');
    addLog(`Booting ${image.name} without flashing...`, 'info');
    addLog(`Boot: ${await dev.bootImage(image.data, (pct) => setProgress({ phase: 'download', percent: pct }))}`, 'ok');
  }, `Boot "${image?.name || '(no file)'}" once without flashing it?`);

  const handleReboot = (target) => guard('reboot', async () => {
    addLog(`Rebooting to ${target || 'system'}...`, 'info');
    await dev.reboot(target);
    // After a reboot the USB endpoint is gone; drop the stale handle.
    await disconnect();
  });

  const unlocked = summary?.unlocked === 'yes' || vars?.unlocked === 'yes';

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && (
        <DemoBanner>Simulated bootloader: nothing here touches a real phone. Values, partitions and flash results are invented.</DemoBanner>
      )}

      {/* Header + connect */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>ANDROID FASTBOOT (BOOTLOADER)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Talk to an Android device in fastboot/bootloader mode over WebUSB: read variables, unlock your own bootloader,
              flash or erase partitions, boot an image, and reboot. Put the phone in fastboot mode first
              (power off, then hold Volume-Down + Power, or <code>adb reboot bootloader</code>).
            </p>
          </div>
          <StatusBadge
            status={status}
            label={status === 'online' ? 'FASTBOOT' : status === 'warning' ? 'SIM' : 'IDLE'}
            value={status === 'online' ? 'Connected' : status === 'warning' && isSimulated ? 'Demo' : 'Offline'}
          />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!dev ? (
            <>
              <button
                onClick={() => connect(false)}
                disabled={!webUsbAvailable || !!busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 text-xs font-bold disabled:opacity-40"
              >
                {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />}
                <span>CONNECT FASTBOOT (WEBUSB)</span>
              </button>
              <button
                onClick={() => connect(true)}
                disabled={!!busy}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-emerald-500/40 text-xs font-bold"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>DEMO</span>
              </button>
            </>
          ) : (
            <>
              <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
                <Power className="w-3.5 h-3.5" /> DISCONNECT
              </button>
              <button onClick={() => guard('refresh', () => refreshVars(dev))} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-slate-800 text-xs font-bold disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> RE-READ VARS
              </button>
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{statusMsg}</p>
      </div>

      {/* Device summary */}
      {dev && summary && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200">DEVICE</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${unlocked ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'}`}>
              {unlocked ? 'BOOTLOADER UNLOCKED' : 'BOOTLOADER LOCKED'}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Product" value={summary.product} />
            <Field label="Bootloader" value={summary.bootloaderVersion} />
            <Field label="Serial" value={summary.serialno} />
            <Field label="Active slot" value={summary.currentSlot || '(none / A-only)'} />
            <Field label="Baseband" value={summary.basebandVersion} />
            <Field label="Secure" value={summary.secure} />
            <Field label="Max download" value={summary.maxDownloadSize} />
            <Field label="Partitions" value={summary.partitionTypes.length ? `${summary.partitionTypes.length} known` : '—'} />
          </div>
          {summary.currentSlot && (
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Set active slot:</span>
              {['a', 'b'].map((s) => (
                <button key={s} disabled={!!busy} onClick={() => guard('slot', async () => { await dev.setActiveSlot(s); await refreshVars(dev); addLog(`Active slot set to ${s}.`, 'ok'); })}
                  className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-200 disabled:opacity-40">slot {s.toUpperCase()}</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bootloader lock */}
      {dev && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <span className="font-bold text-slate-200 flex items-center gap-2"><Unlock className="w-4 h-4 text-amber-400" /> BOOTLOADER LOCK</span>
          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>Unlocking lets you flash custom images, but <b>erases all user data</b> and the phone asks you to confirm on its own screen. Only works on a device you own; it can&apos;t bypass a screen-lock PIN or a Google/Samsung account lock.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleUnlock} disabled={!!busy || unlocked} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold disabled:opacity-40">
              <Unlock className="w-3.5 h-3.5" /> {busy === 'unlock' ? 'REQUESTING...' : 'UNLOCK BOOTLOADER'}
            </button>
            <button onClick={handleLock} disabled={!!busy || !unlocked} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-700 font-bold disabled:opacity-40">
              <Lock className="w-3.5 h-3.5" /> RE-LOCK
            </button>
          </div>
        </div>
      )}

      {/* Flash / erase / boot */}
      {dev && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <span className="font-bold text-slate-200 flex items-center gap-2"><Upload className="w-4 h-4 text-cyan-400" /> FLASH / ERASE / BOOT</span>
          {!unlocked && <p className="text-[11px] text-amber-300/80">The bootloader is locked, so flashing and erasing will be refused until you unlock.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-slate-500">Partition</label>
            <input value={partition} onChange={(e) => setPartition(e.target.value)} list="fb-parts" className="w-32 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
            <datalist id="fb-parts">
              {(summary?.partitionTypes || ['boot', 'recovery', 'system', 'vbmeta', 'userdata', 'dtbo', 'vendor_boot']).map((p) => <option key={p} value={p} />)}
            </datalist>
            <input type="file" ref={fileRef} onChange={pickFile} className="hidden" />
            <button onClick={() => fileRef.current?.click()} disabled={!!busy} className="px-3 py-1 rounded bg-slate-900 text-cyan-300 border border-slate-800 font-bold disabled:opacity-40">
              {image ? image.name : 'CHOOSE IMAGE...'}
            </button>
          </div>
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-cyan-400"><span>{progress.phase === 'download' ? 'Uploading to device' : 'Working'}</span><span>{progress.percent}%</span></div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all" style={{ width: `${progress.percent}%` }} /></div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={handleFlash} disabled={!!busy || !image} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40">
              <Upload className="w-3.5 h-3.5" /> {busy === 'flash' ? 'FLASHING...' : 'FLASH IMAGE'}
            </button>
            <button onClick={handleBoot} disabled={!!busy || !image} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold disabled:opacity-40">
              <Rocket className="w-3.5 h-3.5" /> BOOT ONCE
            </button>
            <button onClick={handleErase} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold disabled:opacity-40">
              <Trash2 className="w-3.5 h-3.5" /> ERASE PARTITION
            </button>
          </div>
        </div>
      )}

      {/* Reboot */}
      {dev && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
          <span className="font-bold text-slate-200 flex items-center gap-2"><Power className="w-4 h-4 text-emerald-400" /> REBOOT</span>
          <div className="flex flex-wrap gap-2">
            {REBOOT_TARGETS.map((t) => (
              <button key={t.id} onClick={() => handleReboot(t.id)} disabled={!!busy} className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold disabled:opacity-40">
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* All variables */}
      {vars && (
        <details className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
          <summary className="font-bold text-slate-200 cursor-pointer flex items-center gap-2"><Info className="w-4 h-4 text-slate-400" /> ALL VARIABLES ({Object.keys(vars).length})</summary>
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5 max-h-72 overflow-y-auto text-[11px]">
            {Object.entries(vars).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-slate-900 py-0.5">
                <span className="text-slate-500 truncate">{k}</span><span className="text-slate-300 truncate">{v}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Log */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl">
        <span className="text-[11px] font-bold text-slate-400">LOG</span>
        <div className="mt-1 max-h-48 overflow-y-auto space-y-0.5">
          {log.length === 0 && <p className="text-slate-600 text-[11px]">No activity yet.</p>}
          {log.map((e, i) => (
            <div key={i} className="text-[11px] flex gap-2">
              <span className="text-slate-600">{e.ts}</span>
              <span className={e.kind === 'err' ? 'text-rose-400' : e.kind === 'ok' ? 'text-emerald-400' : 'text-slate-300'}>{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
      <span className="text-[10px] text-slate-500 font-bold uppercase block">{label}</span>
      <span className="text-slate-200 font-semibold break-all">{value ?? '—'}</span>
    </div>
  );
}
