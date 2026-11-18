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
  Loader2,
  Package,
  Copy,
  Download,
  Terminal,
  Hash
} from 'lucide-react';
import {
  FastbootDevice,
  FastbootUsbTransport,
  findFastbootInterface,
  requestFastbootDevice,
  summarizeVars
} from '../../utils/fastbootDriver';
import {
  isSparse, parseSparse, imageParts, resolvePartition, flashImage, readFactoryZip, flashFactory, checkRequirements,
  sha256Hex, identifyImage, preflightChecks, prepareConsoleCommand, formatVarsText, cliFlashCommand, buildFlashAllScript
} from '../../utils/fastbootTools';
import StatusBadge from '../common/StatusBadge';

import { confirmAction, record } from '../../utils/sessionLog';
const REBOOT_TARGETS = [
  { id: '', label: 'System (Android)' },
  { id: 'bootloader', label: 'Bootloader' },
  { id: 'fastboot', label: 'Fastbootd (userspace)' },
  { id: 'recovery', label: 'Recovery' }
];

export default function FastbootWorkbench() {
  const [dev, setDev] = useState(null);
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
  const [hash, setHash] = useState('');
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleOut, setConsoleOut] = useState([]);
  const zipRef = useRef(null);
  const devRef = useRef(null);
  useEffect(() => { devRef.current = dev; }, [dev]);

  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const addLog = useCallback((msg, kind = 'info') => {
    record('Fastboot', kind, msg);
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

  const connect = async () => {
    setBusy('connect');
    try {
      const transport = await requestFastbootDevice();
      const device = new FastbootDevice(transport, { logger: addLog });
      await device.open();
      setDev(device);
      await refreshVars(device);
      setStatus('online');
      setStatusMsg('Fastboot device connected');
      addLog('Connected to fastboot device.', 'ok');
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
    setSummary(null);
    setVars(null);
    setStatus('offline');
    setStatusMsg('No fastboot device connected');
    addLog('Disconnected.', 'info');
  };

  const guard = async (label, fn, confirmMsg) => {
    if (!dev || busy) return;
    if (confirmMsg && !confirmAction(confirmMsg)) return;
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
      setHash('');
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

  const copyText = async (text, what) => {
    try { await navigator.clipboard.writeText(text); addLog(`Copied ${what}.`, 'ok'); } catch (e) { addLog(`Copy failed: ${e.message}`, 'err'); }
  };
  const downloadText = (text, name) => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const imageInfo = image && dev ? (() => {
    const sparse = isSparse(image.data);
    const raw = sparse ? parseSparse(image.data).rawSize : image.data.length;
    let parts = 1;
    try { parts = imageParts(image.data, dev.maxDownloadSize).length; } catch (e) { parts = 0; }
    return { sparse, raw, parts, kind: identifyImage(image.data), checks: preflightChecks(partition.trim(), image.data, vars || {}) };
  })() : null;

  const runConsole = () => {
    let prepared;
    try { prepared = prepareConsoleCommand(consoleInput); } catch (e) { setConsoleOut((o) => [...o.slice(-99), { cmd: consoleInput, text: e.message, err: true }]); return; }
    const { cmd, destructive, reason } = prepared;
    guard('console', async () => {
      const lines = [];
      try {
        const r = await dev.command(cmd, { onInfo: (l) => lines.push(l) });
        const text = [...lines, r.payload].filter(Boolean).join('\n') || 'OKAY';
        setConsoleOut((o) => [...o.slice(-99), { cmd, text }]);
        addLog(`> ${cmd}: ${text.split('\n')[0]}`, 'ok');
      } catch (err) {
        setConsoleOut((o) => [...o.slice(-99), { cmd, text: [...lines, err.message].join('\n'), err: true }]);
        addLog(`> ${cmd}: ${err.message}`, 'err');
      }
      if (/^(flashing|oem|set_active)/.test(cmd)) { try { await refreshVars(dev); } catch (e) { /* ignore */ } }
    }, destructive ? `Send "${cmd}"?\n\nThis ${reason}. Only do this on a device you own.` : undefined);
  };

  const btn = 'flex items-center gap-1 px-2 py-1 rounded-md font-bold disabled:opacity-40';
  const card = 'bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2';
  const head = 'font-bold text-slate-200 flex items-center gap-1.5';
  const iconBtn = 'p-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:text-cyan-300 disabled:opacity-40';

  return (
    <div className="space-y-2 font-mono text-xs">

      {/* Connect bar */}
      <div className={card}>
        <div className="flex flex-wrap items-center gap-2">
          {!dev ? (
            <button
              onClick={() => connect()}
              disabled={!webUsbAvailable || !!busy}
              className={`${btn} px-3 bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950`}
            >
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />}
              <span>CONNECT FASTBOOT</span>
            </button>
          ) : (
            <>
              <button onClick={disconnect} className={`${btn} bg-rose-500/20 text-rose-300 border border-rose-500/40`}>
                <Power className="w-3.5 h-3.5" /> DISCONNECT
              </button>
              <button onClick={() => guard('refresh', () => refreshVars(dev))} disabled={!!busy} title="Re-read all variables" className={`${btn} bg-slate-900 text-cyan-300 border border-slate-800`}>
                <RefreshCw className={`w-3.5 h-3.5 ${busy === 'refresh' ? 'animate-spin' : ''}`} /> RE-READ VARS
              </button>
            </>
          )}
          <span className="ml-auto"><StatusBadge
            status={status}
            label={status === 'online' ? 'FASTBOOT' : status === 'warning' ? 'ERR' : 'IDLE'}
            value={status === 'online' ? 'Connected' : 'Offline'}
          /></span>
        </div>
        {!webUsbAvailable && (
          <div className="flex items-start gap-2 p-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}
        <p className="text-[11px] text-slate-500">{statusMsg}</p>
        {!dev && (
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer text-slate-300">How to enter fastboot mode</summary>
            <p className="mt-1">Power the phone off, then hold Volume-Down + Power (keys vary by model), or run <code>adb reboot bootloader</code>. Then connect and pick the device.</p>
          </details>
        )}
      </div>

      {/* Device summary */}
      {dev && summary && (
        <div className={card}>
          <div className="flex items-center justify-between gap-2">
            <span className={head}><Smartphone className="w-3.5 h-3.5 text-cyan-400" /> DEVICE</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${unlocked ? 'bg-amber-500/15 text-amber-300 border-amber-500/40' : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'}`}>
              {unlocked ? 'BOOTLOADER UNLOCKED' : 'BOOTLOADER LOCKED'}
            </span>
          </div>
          <div className="grid grid-cols-2 @md:grid-cols-4 gap-1.5">
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
            <div className="flex items-center gap-1.5">
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
        <div className={card}>
          <div className="flex flex-wrap items-center gap-2">
            <span className={head}><Unlock className="w-3.5 h-3.5 text-amber-400" /> BOOTLOADER LOCK</span>
            <div className="ml-auto flex gap-1.5">
              <button onClick={handleUnlock} disabled={!!busy || unlocked} className={`${btn} bg-amber-500/20 text-amber-300 border border-amber-500/40`}>
                <Unlock className="w-3.5 h-3.5" /> {busy === 'unlock' ? 'REQUESTING...' : 'UNLOCK'}
              </button>
              <button onClick={handleLock} disabled={!!busy || !unlocked} className={`${btn} bg-slate-900 text-slate-300 border border-slate-700`}>
                <Lock className="w-3.5 h-3.5" /> RE-LOCK
              </button>
            </div>
          </div>
          <div className="flex items-start gap-2 p-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-200 text-[11px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span>Unlocking lets you flash custom images, but <b>erases all user data</b> and the phone asks you to confirm on its own screen. Only works on a device you own; it can&apos;t bypass a screen-lock PIN or a Google/Samsung account lock.</span>
          </div>
        </div>
      )}

      {/* Flash / erase / boot */}
      {dev && (
        <div className={card}>
          <span className={head}><Upload className="w-3.5 h-3.5 text-cyan-400" /> FLASH / ERASE / BOOT</span>
          {!unlocked && <p className="text-[11px] text-amber-300/80">The bootloader is locked, so flashing and erasing will be refused until you unlock.</p>}
          <div className="flex flex-wrap items-center gap-1.5">
            <label htmlFor="fb-partition" className="text-slate-500">Partition</label>
            <input id="fb-partition" value={partition} onChange={(e) => setPartition(e.target.value)} list="fb-parts" className="w-28 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
            <datalist id="fb-parts">
              {(summary?.partitionTypes || ['boot', 'recovery', 'system', 'vbmeta', 'userdata', 'dtbo', 'vendor_boot']).map((p) => <option key={p} value={p} />)}
            </datalist>
            <input type="file" ref={fileRef} onChange={pickFile} className="hidden" aria-label="Image file" />
            <button onClick={() => fileRef.current?.click()} disabled={!!busy} className={`${btn} bg-slate-900 text-cyan-300 border border-slate-800 max-w-[12rem] truncate`}>
              <span className="truncate">{image ? image.name : 'CHOOSE IMAGE...'}</span>
            </button>
            {summary?.currentSlot && (
              <>
                <label htmlFor="fb-slot" className="text-slate-500">Slot</label>
                <select id="fb-slot" value={slotChoice} onChange={(e) => setSlotChoice(e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-200">
                  <option value="current">current ({summary.currentSlot})</option>
                  <option value="a">A</option>
                  <option value="b">B</option>
                  <option value="both">both</option>
                </select>
              </>
            )}
          </div>
          {imageInfo && (
            <div className="space-y-1 text-[11px]">
              <p className="text-slate-400">
                {imageInfo.sparse ? 'Android sparse image' : imageInfo.kind.label}, {(image.data.length / 1048576).toFixed(1)} MB{imageInfo.sparse ? ` (${(imageInfo.raw / 1048576).toFixed(1)} MB written)` : ''}.{' '}
                {imageInfo.parts > 1 ? `Larger than max-download-size, so it is sent as ${imageInfo.parts} sparse pieces.` : 'Fits in one download.'}
              </p>
              {imageInfo.checks.map((c, i) => (
                <p key={i} className="text-amber-300 flex items-start gap-1"><AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> {c.text}</p>
              ))}
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  onClick={async () => { try { setHash(await sha256Hex(image.data)); } catch (e) { addLog(`SHA-256 failed: ${e.message}`, 'err'); } }}
                  className={`${btn} bg-slate-900 text-slate-300 border border-slate-800`} title="Compute the SHA-256 of the file to compare with the published checksum">
                  <Hash className="w-3 h-3" /> SHA-256
                </button>
                {hash && <code className="text-slate-300 break-all">{hash}</code>}
                {hash && <button onClick={() => copyText(hash, 'SHA-256')} title="Copy SHA-256" aria-label="Copy SHA-256" className={iconBtn}><Copy className="w-3 h-3" /></button>}
              </div>
            </div>
          )}
          {progress && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-cyan-400"><span>{progress.phase === 'download' ? 'Uploading to device' : 'Working'}{progress.parts > 1 ? ` (piece ${progress.part} of ${progress.parts})` : ''}</span><span>{progress.percent}%</span></div>
              <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-500 transition-all" style={{ width: `${progress.percent}%` }} /></div>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            <button onClick={handleFlash} disabled={!!busy || !image} className={`${btn} bg-cyan-500/20 text-cyan-300 border border-cyan-500/40`}>
              <Upload className="w-3.5 h-3.5" /> {busy === 'flash' ? 'FLASHING...' : 'FLASH IMAGE'}
            </button>
            <button onClick={handleBoot} disabled={!!busy || !image} className={`${btn} bg-purple-500/20 text-purple-300 border border-purple-500/40`}>
              <Rocket className="w-3.5 h-3.5" /> BOOT ONCE
            </button>
            <button onClick={handleErase} disabled={!!busy} className={`${btn} bg-rose-500/20 text-rose-300 border border-rose-500/40`}>
              <Trash2 className="w-3.5 h-3.5" /> ERASE
            </button>
            <button
              onClick={() => copyText(cliFlashCommand(partition.trim() || 'boot', image?.name || 'image.img', { slot: slotChoice === 'both' ? 'all' : slotChoice === 'current' ? null : slotChoice }), 'fastboot command')}
              className={`${btn} bg-slate-900 text-slate-300 border border-slate-800`} title="Copy the equivalent desktop fastboot command (export only, nothing is run)">
              <Copy className="w-3.5 h-3.5" /> COPY CLI
            </button>
          </div>
        </div>
      )}

      {/* Factory image */}
      {dev && (
        <div className={card}>
          <span className={head}><Package className="w-3.5 h-3.5 text-amber-400" /> FACTORY IMAGE (FLASH-ALL)</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input type="file" ref={zipRef} accept=".zip" onChange={onFactoryFile} className="hidden" aria-label="Factory image zip" />
            <button onClick={() => zipRef.current?.click()} disabled={!!busy} className={`${btn} bg-slate-900 text-amber-300 border border-slate-800 max-w-[14rem]`}>
              <span className="truncate">{busy === 'zip' ? 'READING...' : factory ? factory.fileName : 'OPEN FACTORY ZIP...'}</span>
            </button>
          </div>
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer text-slate-300">What this does</summary>
            <p className="mt-1">
              Open a factory image zip (for example from developers.google.com/android/images) or its inner image-*.zip. The steps follow flash-all.sh and
              fastboot update: bootloader and radio with a reboot after each, boot/vbmeta-type images in the bootloader, then the dynamic partitions in fastbootd.
              The whole zip is read into memory, so a very large zip may need its inner image zip instead.
            </p>
          </details>
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
              <div className="flex flex-wrap gap-1.5">
                {[...(factory.bootloader ? ['bootloader'] : []), ...(factory.radio ? ['radio'] : []), ...factory.images.map((i) => i.name)].map((name) => {
                  const img = factory.images.find((i) => i.name === name);
                  return (
                    <label key={name} className={`flex items-center gap-1 px-1.5 py-0.5 rounded border ${skip.includes(name) ? 'border-slate-800 text-slate-600 line-through' : 'border-slate-700 text-slate-200'}`}>
                      <input type="checkbox" checked={!skip.includes(name)} onChange={(e) => setSkip((prev) => (e.target.checked ? prev.filter((x) => x !== name) : [...prev, name]))} className="accent-amber-500" />
                      {name}{img?.logical ? ' (fastbootd)' : ''}
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1 text-rose-300"><input type="checkbox" checked={wipe} onChange={(e) => setWipe(e.target.checked)} className="accent-rose-500" /> wipe user data (like flash-all.sh -w)</label>
                <button onClick={handleFactoryFlash} disabled={!!busy || !unlocked} className={`${btn} bg-amber-500/20 text-amber-300 border border-amber-500/40`}>
                  <Upload className="w-3.5 h-3.5" /> {busy === 'factory' ? 'FLASHING...' : 'FLASH FACTORY IMAGE'}
                </button>
                <button onClick={() => downloadText(buildFlashAllScript(factory, { wipe, skip }), 'flash-all.sh')} className={`${btn} bg-slate-900 text-slate-300 border border-slate-800`} title="Download a flash-all.sh for the desktop fastboot tool (export only, the files are not included)">
                  <Download className="w-3.5 h-3.5" /> EXPORT SCRIPT
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
        <div className={card}>
          <span className={head}><Power className="w-3.5 h-3.5 text-emerald-400" /> REBOOT</span>
          <div className="flex flex-wrap gap-1.5">
            {REBOOT_TARGETS.map((t) => (
              <button key={t.id} onClick={() => handleReboot(t.id)} disabled={!!busy} className={`${btn} bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Command console */}
      {dev && (
        <details className={card}>
          <summary className={`${head} cursor-pointer`}><Terminal className="w-3.5 h-3.5 text-cyan-400" /> COMMAND CONSOLE</summary>
          <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); runConsole(); }}>
            <input value={consoleInput} onChange={(e) => setConsoleInput(e.target.value)} aria-label="Fastboot command" placeholder="getvar all, oem device-info, getvar current-slot" spellCheck={false}
              className="flex-1 min-w-0 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
            <button type="submit" disabled={!!busy || !consoleInput.trim()} className={`${btn} bg-cyan-500/20 text-cyan-300 border border-cyan-500/40`}>SEND</button>
          </form>
          <div className="flex flex-wrap gap-1 mt-1.5">
            {['getvar all', 'getvar current-slot', 'getvar is-userspace', 'getvar slot-count', 'getvar version-bootloader', 'oem device-info'].map((c) => (
              <button key={c} onClick={() => setConsoleInput(c)} className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400 text-[10px]">{c}</button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-slate-500">Sends one raw command (CLI or wire style, 64 bytes max). Erase, format, lock/unlock and layout commands ask for confirmation. File transfers use the panel above. Vendor <code>oem</code> commands vary by device and some are irreversible.</p>
          {consoleOut.length > 0 && (
            <div className="mt-1.5 max-h-40 overflow-y-auto space-y-1 text-[11px]">
              {consoleOut.map((o, i) => (
                <div key={i}><span className="text-cyan-400">&gt; {o.cmd}</span><pre className={`whitespace-pre-wrap break-all ${o.err ? 'text-rose-400' : 'text-slate-300'}`}>{o.text}</pre></div>
              ))}
            </div>
          )}
        </details>
      )}

      {/* All variables */}
      {vars && (
        <details className={card}>
          <summary className={`${head} cursor-pointer`}><Info className="w-3.5 h-3.5 text-slate-400" /> ALL VARIABLES ({Object.keys(vars).length})</summary>
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => copyText(formatVarsText(vars), 'variables')} className={`${btn} bg-slate-900 text-slate-300 border border-slate-800`}><Copy className="w-3 h-3" /> COPY</button>
            <button onClick={() => downloadText(formatVarsText(vars), `fastboot-vars-${summary?.product || 'device'}.txt`)} className={`${btn} bg-slate-900 text-slate-300 border border-slate-800`}><Download className="w-3 h-3" /> SAVE .TXT</button>
          </div>
          <div className="mt-2 grid grid-cols-1 @md:grid-cols-2 gap-x-4 gap-y-0.5 max-h-64 overflow-y-auto text-[11px]">
            {Object.entries(vars).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-slate-900 py-0.5">
                <span className="text-slate-500 truncate" title={k}>{k}</span><span className="text-slate-300 truncate" title={v}>{v}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Log */}
      <div className={card}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-slate-400">LOG</span>
          <div className="flex gap-1">
            <button onClick={() => copyText(log.map((e) => `${e.ts} ${e.msg}`).join('\n'), 'log')} disabled={!log.length} title="Copy log" aria-label="Copy log" className={iconBtn}><Copy className="w-3 h-3" /></button>
            <button onClick={() => setLog([])} disabled={!log.length} title="Clear log" aria-label="Clear log" className={iconBtn}><Trash2 className="w-3 h-3" /></button>
          </div>
        </div>
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {log.length === 0 && <p className="text-slate-600 text-[11px]">No activity yet.</p>}
          {log.map((e, i) => (
            <div key={i} className="text-[11px] flex gap-2">
              <span className="text-slate-600 shrink-0">{e.ts}</span>
              <span className={`break-all ${e.kind === 'err' ? 'text-rose-400' : e.kind === 'ok' ? 'text-emerald-400' : 'text-slate-300'}`}>{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-slate-950 p-1.5 rounded-md border border-slate-800 min-w-0">
      <span className="text-[10px] text-slate-500 font-bold uppercase block">{label}</span>
      <span className="text-slate-200 font-semibold break-all">{value ?? '—'}</span>
    </div>
  );
}
