import React, { useState, useRef, useCallback, useEffect } from 'react';
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
  Loader2,
  Package
} from 'lucide-react';
import {
  FastbootDevice,
  FastbootUsbTransport,
  findFastbootInterface,
  requestFastbootDevice,
  createSimulatedFastboot,
  summarizeVars
} from '../../utils/fastbootDriver';
import {
  isSparse, parseSparse, imageParts, resolvePartition, flashImage, readFactoryZip, flashFactory, checkRequirements
} from '../../utils/fastbootTools';
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
  const [slotChoice, setSlotChoice] = useState('current');
  const [image, setImage] = useState(null); // { name, data }
  const fileRef = useRef(null);

  // Factory image
  const [factory, setFactory] = useState(null); // plan + fileName
  const [skip, setSkip] = useState([]);
  const [wipe, setWipe] = useState(false);
  const [steps, setSteps] = useState([]);
  const zipRef = useRef(null);
  const devRef = useRef(null);
  useEffect(() => { devRef.current = dev; }, [dev]);

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

  /** After a reboot into the bootloader or fastbootd, find the same phone again (no new permission prompt needed). */
  const reconnect = async (timeoutMs = 90000) => {
    const old = devRef.current;
    if (!old) throw new Error('No device.');
    if (isSimulated) return old; // the simulated bootloader keeps its state across "reboots"
    const serial = old.transport.device?.serialNumber;
    try { await old.close(); } catch (e) { /* already gone */ }
    addLog('Waiting for the device to come back in fastboot mode...', 'info');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const devices = await navigator.usb.getDevices();
      const found = devices.find((d) => (!serial || d.serialNumber === serial) && (d.configurations || []).some((c) => findFastbootInterface(c)));
      if (!found) continue;
      try {
        const fresh = new FastbootDevice(new FastbootUsbTransport(found), { logger: addLog });
        await fresh.open();
        devRef.current = fresh;
        setDev(fresh);
        addLog('Reconnected.', 'ok');
        return fresh;
      } catch (e) { /* still enumerating */ }
    }
    throw new Error('The device did not come back in fastboot mode. Reconnect it manually and continue.');
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
    const slots = slotChoice === 'both' ? ['a', 'b'] : slotChoice === 'current' ? [null] : [slotChoice];
    for (const slot of slots) {
      const target = await resolvePartition(dev, partition.trim(), slot);
      const n = await flashImage(dev, target, image.data, {
        onProgress: (p) => setProgress({ phase: 'download', percent: Math.round(p.fraction * 100), part: p.part, parts: p.parts })
      });
      addLog(`Flashed ${image.name} to ${target}${n > 1 ? ` in ${n} sparse pieces` : ''}.`, 'ok');
    }
  }, `Flash "${image?.name || '(no file)'}" to the "${partition}" partition${slotChoice === 'both' ? ' on both slots' : slotChoice !== 'current' ? ` (slot ${slotChoice})` : ''}? Flashing the wrong image to the wrong partition can brick the device.`);

  const onFactoryFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy('zip');
    try {
      addLog(`Reading ${file.name} (${(file.size / 1048576).toFixed(0)} MB)...`, 'info');
      const plan = await readFactoryZip(new Uint8Array(await file.arrayBuffer()));
      setFactory({ ...plan, fileName: file.name });
      setSkip([]);
      setSteps([]);
    } catch (err) {
      addLog(`Could not read ${file.name}: ${err.message}${/allocation|memory|Array buffer/i.test(err.message) ? ' (too big for the browser: open the inner image-*.zip instead)' : ''}`, 'err');
    } finally {
      setBusy('');
    }
  };

  const handleFactoryFlash = () => guard('factory', async () => {
    setSteps([]);
    await flashFactory(factory, {
      fb: () => devRef.current,
      reconnect,
      wipe,
      skip,
      onStep: (st) => { setSteps((prev) => [...prev, st]); addLog(st, 'info'); },
      onProgress: (f) => setProgress({ phase: 'download', percent: Math.round(f * 100) })
    });
    await refreshVars(devRef.current);
    addLog('Factory image flashed. Reboot to system when ready.', 'ok');
  }, `Flash ${factory?.fileName}?\n\nThis rewrites the bootloader, radio and system partitions${wipe ? ' and ERASES ALL USER DATA' : ''}. Use only an image built for this exact device, and keep the cable connected until it finishes.`);

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
    if (target === 'bootloader' || target === 'fastboot') {
      // Still a fastboot device afterwards: wait for it and carry on.
      const fresh = await reconnect();
      await refreshVars(fresh);
      return;
    }
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
              flash (sparse images split automatically, either or both A/B slots) or erase partitions, boot an image, flash a whole
              factory image zip, and reboot. Put the phone in fastboot mode first
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
            {summary?.currentSlot && (
              <>
                <label className="text-slate-500">Slot</label>
                <select value={slotChoice} onChange={(e) => setSlotChoice(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200">
                  <option value="current">current ({summary.currentSlot})</option>
                  <option value="a">A</option>
                  <option value="b">B</option>
                  <option value="both">both</option>
                </select>
              </>
            )}
          </div>
          {image && (
            <p className="text-[11px] text-slate-400">
              {(() => {
                const sparse = isSparse(image.data);
                const raw = sparse ? parseSparse(image.data).rawSize : image.data.length;
                const parts = imageParts(image.data, dev.maxDownloadSize).length;
                return `${sparse ? 'Android sparse image' : 'Raw image'}, ${(image.data.length / 1048576).toFixed(1)} MB${sparse ? ` (${(raw / 1048576).toFixed(1)} MB written)` : ''}. ${parts > 1 ? `Larger than max-download-size, so it is sent as ${parts} sparse pieces.` : 'Fits in one download.'}`;
              })()}
            </p>
          )}
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-cyan-400"><span>{progress.phase === 'download' ? 'Uploading to device' : 'Working'}{progress.parts > 1 ? ` (piece ${progress.part} of ${progress.parts})` : ''}</span><span>{progress.percent}%</span></div>
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

      {/* Factory image */}
      {dev && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <span className="font-bold text-slate-200 flex items-center gap-2"><Package className="w-4 h-4 text-amber-400" /> FACTORY IMAGE (FLASH-ALL)</span>
          <p className="text-[11px] text-slate-400">
            Open a factory image zip (for example from developers.google.com/android/images) or its inner image-*.zip. The steps follow flash-all.sh and
            fastboot update: bootloader and radio with a reboot after each, boot/vbmeta-type images in the bootloader, then the dynamic partitions in fastbootd.
            The whole zip is read into memory, so a very large zip may need its inner image zip instead.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input type="file" ref={zipRef} accept=".zip" onChange={onFactoryFile} className="hidden" />
            <button onClick={() => zipRef.current?.click()} disabled={!!busy} className="px-3 py-1 rounded bg-slate-900 text-amber-300 border border-slate-800 font-bold disabled:opacity-40">
              {busy === 'zip' ? 'READING...' : factory ? factory.fileName : 'OPEN FACTORY ZIP...'}
            </button>
          </div>
          {factory && (
            <>
              {factory.requirements.length > 0 && vars && (
                <div className="space-y-0.5">
                  {checkRequirements(factory.requirements, vars).map((r) => (
                    <div key={r.name} className={r.ok ? 'text-emerald-300' : r.name === 'product' ? 'text-rose-300 font-bold' : 'text-amber-300'}>
                      {r.ok ? '✓' : '✗'} {r.name}: needs {r.want}, device has {r.have ?? 'unknown'}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {[...(factory.bootloader ? ['bootloader'] : []), ...(factory.radio ? ['radio'] : []), ...factory.images.map((i) => i.name)].map((name) => {
                  const img = factory.images.find((i) => i.name === name);
                  return (
                    <label key={name} className={`flex items-center gap-1 px-2 py-0.5 rounded border ${skip.includes(name) ? 'border-slate-800 text-slate-600 line-through' : 'border-slate-700 text-slate-200'}`}>
                      <input type="checkbox" checked={!skip.includes(name)} onChange={(e) => setSkip((prev) => (e.target.checked ? prev.filter((x) => x !== name) : [...prev, name]))} className="accent-amber-500" />
                      {name}{img?.logical ? ' (fastbootd)' : ''}
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1 text-rose-300"><input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="accent-rose-500" /> wipe user data (like flash-all.sh -w)</label>
                <button onClick={handleFactoryFlash} disabled={!!busy || !unlocked} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold disabled:opacity-40">
                  <Upload className="w-3.5 h-3.5" /> {busy === 'factory' ? 'FLASHING...' : 'FLASH FACTORY IMAGE'}
                </button>
                {!unlocked && <span className="text-amber-300/80">Unlock the bootloader first.</span>}
              </div>
              {steps.length > 0 && (
                <ol className="list-decimal list-inside text-[11px] text-slate-300 space-y-0.5">
                  {steps.map((st, i) => <li key={i} className={i === steps.length - 1 && busy === 'factory' ? 'text-cyan-300' : ''}>{st}</li>)}
                </ol>
              )}
            </>
          )}
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
