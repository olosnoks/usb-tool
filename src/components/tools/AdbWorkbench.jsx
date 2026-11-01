import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  Usb, Smartphone, TerminalSquare, Upload, Download, Wifi, Power, ShieldAlert, Sparkles, Loader2, Play, Folder, FileText,
  ChevronRight, Package, ScrollText, Monitor, Square, Trash2, RefreshCw, Info
} from 'lucide-react';
import { AdbConnection, requestAdbDevice, createSimulatedAdb } from '../../utils/adbDriver';
import {
  parseGetprop, deviceSummary, parseBattery, parseWmSize, LogcatPoller, LOG_LEVELS, parsePackages, installApk, uninstallPackage,
  packagePaths, packageVersion, KEYCODES, tapCommand, inputTextCommand
} from '../../utils/adbTools';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

import { confirmAction, record } from '../../utils/sessionLog';
const REBOOT_TARGETS = [
  { id: '', label: 'System' },
  { id: 'bootloader', label: 'Bootloader' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'fastboot', label: 'Fastbootd' }
];
const TABS = [
  ['device', 'DEVICE', Info], ['shell', 'SHELL', TerminalSquare], ['files', 'FILES', Folder],
  ['apps', 'APPS', Package], ['logcat', 'LOGCAT', ScrollText], ['screen', 'SCREEN', Monitor]
];
const LEVEL_COLORS = { V: 'text-slate-500', D: 'text-sky-300', I: 'text-emerald-300', W: 'text-amber-300', E: 'text-rose-400', F: 'text-rose-500 font-bold' };
const MAX_LOGCAT = 5000;

const fmtBytes = (n) => { const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = n; while (v >= 1024 && i < 3) { v /= 1024; i++; } return `${v.toFixed(i ? 1 : 0)} ${u[i]}`; };
const saveBytes = (data, name, type = 'application/octet-stream') => {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

export default function AdbWorkbench({ initialTab = 'device' }) {
  const [adb, setAdb] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState('offline');
  const [statusMsg, setStatusMsg] = useState('No ADB device connected');
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);
  const [tab, setTab] = useState(initialTab);

  // Device
  const [props, setProps] = useState(null);
  const [battery, setBattery] = useState(null);
  const [screenSize, setScreenSize] = useState(null);
  const [tcpipPort, setTcpipPort] = useState('5555');

  // Shell
  const [cmd, setCmd] = useState('getprop ro.product.model');
  const [shellOut, setShellOut] = useState('');
  const [history, setHistory] = useState([]);

  // Files
  const [cwd, setCwd] = useState('/sdcard/');
  const [entries, setEntries] = useState(null);
  const [progress, setProgress] = useState(null);
  const uploadRef = useRef(null);

  // Apps
  const [packages, setPackages] = useState(null);
  const [showSystem, setShowSystem] = useState(false);
  const [pkgFilter, setPkgFilter] = useState('');
  const [pkgInfo, setPkgInfo] = useState({});
  const apkRef = useRef(null);

  // Logcat
  const [logcat, setLogcat] = useState([]);
  const [logcatOn, setLogcatOn] = useState(false);
  const [minLevel, setMinLevel] = useState('V');
  const [logFilter, setLogFilter] = useState('');
  const pollerRef = useRef(null);

  // Screen
  const [screen, setScreen] = useState(null); // { url, bytes }
  const [autoScreen, setAutoScreen] = useState(false);
  const [typeText, setTypeText] = useState('');

  const queue = useRef(Promise.resolve());
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const addLog = useCallback((msg, kind = 'info') => {
    record('ADB', kind, msg);
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-299), { ts, msg, kind }]);
  }, []);

  /** The connection runs one stream at a time: every use goes through this queue. */
  const serial = (fn) => {
    const p = queue.current.then(fn, fn);
    queue.current = p.catch(() => {});
    return p;
  };

  const guard = async (label, fn) => {
    if (!adb) return;
    setBusy(label);
    try { await serial(fn); } catch (err) { addLog(`${label} failed: ${err.message}`, 'err'); } finally { setBusy(''); setProgress(null); }
  };

  const loadDeviceInfo = async (conn) => {
    setProps(parseGetprop(await conn.shell('getprop')));
    setBattery(parseBattery(await conn.shell('dumpsys battery')));
    setScreenSize(parseWmSize(await conn.shell('wm size')));
  };

  const connect = async (simulated) => {
    setBusy('connect');
    try {
      const transport = simulated ? createSimulatedAdb() : await requestAdbDevice();
      const conn = new AdbConnection(transport, { logger: addLog });
      const { banner: b } = await conn.connect({ onPrompt: () => addLog('Tap "Allow USB debugging" on the device (and "always allow" to remember this computer).', 'info') });
      queue.current = Promise.resolve();
      setAdb(conn);
      setIsSimulated(simulated);
      setBanner(b);
      setStatus(simulated ? 'warning' : 'online');
      setStatusMsg(simulated ? 'Simulated device' : 'Connected');
      await serial(() => loadDeviceInfo(conn)).catch((e) => addLog(`Device info: ${e.message}`, 'err'));
    } catch (err) {
      setStatus('warning');
      setStatusMsg(err.message);
      addLog(`Connect failed: ${err.message}`, 'err');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    setLogcatOn(false);
    setAutoScreen(false);
    try { await adb?.close(); } catch (e) { /* ignore */ }
    setAdb(null); setIsSimulated(false); setBanner(''); setStatus('offline'); setStatusMsg('No ADB device connected');
    setProps(null); setBattery(null); setEntries(null); setPackages(null); setLogcat([]); setScreen(null); setPkgInfo({});
  };

  // --- Shell ------------------------------------------------------------------

  const runShell = (command = cmd) => guard('shell', async () => {
    addLog(`$ ${command}`, 'info');
    setHistory((h) => [command, ...h.filter((x) => x !== command)].slice(0, 30));
    setShellOut(await adb.shell(command));
  });

  // --- Files ------------------------------------------------------------------

  const openDir = (path) => guard('list', async () => {
    const dir = path.endsWith('/') ? path : `${path}/`;
    setEntries(await adb.list(dir));
    setCwd(dir);
  });

  const pullFile = (e) => guard('pull', async () => {
    const data = await adb.pull(cwd + e.name, { onProgress: () => {} });
    saveBytes(data, e.name);
    addLog(`Pulled ${cwd}${e.name} (${fmtBytes(data.length)}).`, 'ok');
  });

  const uploadFile = () => guard('push', async () => {
    const file = uploadRef.current?.files?.[0];
    if (!file) throw new Error('Choose a file to push.');
    const data = new Uint8Array(await file.arrayBuffer());
    await adb.push(cwd + file.name, data, { onProgress: (p) => setProgress(Math.round(p * 100)) });
    addLog(`Pushed ${file.name} → ${cwd}${file.name} (${fmtBytes(data.length)}).`, 'ok');
    uploadRef.current.value = '';
    setEntries(await adb.list(cwd));
  });

  const deleteFile = (e) => {
    if (!confirmAction(`Delete ${cwd}${e.name} on the device?`)) return;
    guard('rm', async () => {
      await adb.shell(`rm ${e.isDir ? '-r ' : ''}${quote(cwd + e.name)}`);
      setEntries(await adb.list(cwd));
    });
  };

  // --- Apps -------------------------------------------------------------------

  const loadPackages = (system = showSystem) => guard('apps', async () => {
    setPackages(parsePackages(await adb.shell(`pm list packages -f${system ? '' : ' -3'}`)));
  });

  const appInfo = (name) => guard('info', async () => {
    setPkgInfo((p) => ({ ...p, [name]: { loading: true } }));
    const v = await packageVersion(adb, name);
    setPkgInfo((p) => ({ ...p, [name]: v }));
  });

  const pullApk = (name) => guard('pull', async () => {
    const paths = await packagePaths(adb, name);
    if (!paths.length) throw new Error(`No APK path for ${name}.`);
    for (const path of paths) {
      const data = await adb.pull(path);
      saveBytes(data, paths.length > 1 ? `${name}-${path.split('/').pop()}` : `${name}.apk`, 'application/vnd.android.package-archive');
    }
    addLog(`Saved ${paths.length} APK file(s) of ${name}${paths.length > 1 ? ' (split APK: install them together)' : ''}.`, 'ok');
  });

  const appAction = (name, action) => {
    const confirms = {
      uninstall: `Uninstall ${name} from the device? Its data is deleted.`,
      clear: `Clear all data of ${name} (accounts, settings, files)?`
    };
    if (confirms[action] && !confirmAction(confirms[action])) return;
    guard(action, async () => {
      if (action === 'uninstall') { addLog(await uninstallPackage(adb, name), 'ok'); setPackages((p) => p.filter((x) => x.name !== name)); }
      if (action === 'launch') { await adb.shell(`monkey -p ${name} -c android.intent.category.LAUNCHER 1`); addLog(`Launched ${name}.`, 'ok'); }
      if (action === 'stop') { await adb.shell(`am force-stop ${name}`); addLog(`Stopped ${name}.`, 'ok'); }
      if (action === 'clear') addLog(`${name}: ${(await adb.shell(`pm clear ${name}`)).trim()}`, 'ok');
    });
  };

  const installFromFile = () => guard('install', async () => {
    const file = apkRef.current?.files?.[0];
    if (!file) throw new Error('Choose an .apk file.');
    addLog(`Installing ${file.name}...`, 'info');
    const out = await installApk(adb, new Uint8Array(await file.arrayBuffer()), { onProgress: (p) => setProgress(Math.round(p * 100)) });
    addLog(`${file.name}: ${out.split('\n').pop()}`, 'ok');
    apkRef.current.value = '';
    if (packages) setPackages(parsePackages(await adb.shell(`pm list packages -f${showSystem ? '' : ' -3'}`)));
  });

  // --- Logcat -----------------------------------------------------------------

  useEffect(() => {
    if (!logcatOn || !adb) return undefined;
    if (!pollerRef.current || pollerRef.current.conn !== adb) pollerRef.current = new LogcatPoller(adb);
    let stopped = false;
    let timer = null;
    const tick = async () => {
      try {
        const fresh = await serial(() => pollerRef.current.poll());
        if (fresh.length && !stopped) setLogcat((prev) => [...prev, ...fresh].slice(-MAX_LOGCAT));
      } catch (err) {
        addLog(`logcat: ${err.message}`, 'err');
        setLogcatOn(false);
        return;
      }
      if (!stopped) timer = setTimeout(tick, 1000);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [logcatOn, adb]);

  const levelIdx = LOG_LEVELS.indexOf(minLevel);
  const filterLower = logFilter.toLowerCase();
  const shownLogcat = logcat.filter((e) => LOG_LEVELS.indexOf(e.level) >= levelIdx && (!filterLower || e.tag.toLowerCase().includes(filterLower) || e.message.toLowerCase().includes(filterLower) || String(e.pid) === logFilter));

  // --- Screen -----------------------------------------------------------------

  // grabScreen runs inside the queue; capture() queues it.
  const grabScreen = async () => {
    const png = await adb.execOut('screencap -p');
    if (png[0] !== 0x89) throw new Error('screencap did not return a PNG (screen off, or a secure window is showing).');
    setScreen((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return { url: URL.createObjectURL(new Blob([png], { type: 'image/png' })), bytes: png };
    });
  };
  const capture = () => serial(grabScreen);

  useEffect(() => {
    if (!autoScreen || !adb) return undefined;
    let stopped = false;
    let timer = null;
    const tick = async () => {
      try { await capture(); } catch (err) { addLog(`screen: ${err.message}`, 'err'); setAutoScreen(false); return; }
      if (!stopped) timer = setTimeout(tick, 1500);
    };
    tick();
    return () => { stopped = true; clearTimeout(timer); };
  }, [autoScreen, adb]);

  const input = (command, refresh = true) => guard('input', async () => {
    await adb.shell(command);
    if (refresh && screen && !autoScreen) {
      await new Promise((r) => setTimeout(r, 400));
      await grabScreen();
    }
  });

  const onScreenClick = (e) => {
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * img.naturalWidth;
    const y = ((e.clientY - rect.top) / rect.height) * img.naturalHeight;
    input(tapCommand(x, y));
  };

  // --- Wireless / reboot ----------------------------------------------------------

  const handleTcpip = () => guard('tcpip', async () => {
    const msg = await adb.tcpip(Number(tcpipPort) || 5555);
    addLog(msg, 'ok');
    addLog(`Now run "adb connect <phone-ip>:${tcpipPort}" from a computer on the same network.`, 'info');
  });

  const handleReboot = (target) => guard('reboot', async () => {
    addLog(`Rebooting to ${target || 'system'}...`, 'info');
    await adb.reboot(target);
    await disconnect();
  });

  const btn = 'flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold disabled:opacity-40';
  const btnSm = 'px-1.5 py-0.5 rounded border border-slate-700 text-slate-300 hover:text-cyan-300 disabled:opacity-40';
  const inp = 'bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200 outline-none';

  const crumbs = cwd.split('/').filter(Boolean);
  const pkgShown = (packages || []).filter((p) => !pkgFilter || p.name.toLowerCase().includes(pkgFilter.toLowerCase()));

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated device: shell output, apps, logcat, files, the screen and reboots are invented.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>ANDROID ADB (DEBUG BRIDGE)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Connect to an Android device with <b>USB debugging</b> enabled (Settings → Developer options): device info, shell,
              file browser, app install/uninstall and APK backup, live logcat, screenshots with tap control, wireless ADB and reboot.
              The phone asks "Allow USB debugging?" the first time; tap <b>Always allow</b> so it remembers this browser&apos;s key.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'ADB' : status === 'warning' ? 'SIM' : 'IDLE'} value={status === 'online' ? 'Connected' : status === 'warning' && isSimulated ? 'Demo' : 'Offline'} />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!adb ? (
            <>
              <button onClick={() => connect(false)} disabled={!webUsbAvailable || !!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 text-xs font-bold disabled:opacity-40">
                {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} CONNECT ADB (WEBUSB)
              </button>
              <button onClick={() => connect(true)} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-emerald-300 border border-emerald-500/40 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" /> DEMO
              </button>
            </>
          ) : (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> DISCONNECT
            </button>
          )}
          {busy && busy !== 'connect' && <span className="text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> {busy}{progress != null ? ` ${progress}%` : ''}</span>}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{statusMsg}{banner ? ` — ${banner}` : ''}</p>
      </div>

      {adb && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex flex-wrap gap-1 border-b border-slate-800 pb-2">
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  if (id === 'files' && !entries) openDir(cwd);
                  if (id === 'apps' && !packages) loadPackages();
                }}
                className={`flex items-center gap-1 px-2.5 py-1 rounded font-bold border ${tab === id ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-900 text-slate-400 border-slate-800'}`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === 'device' && (
            <div className="space-y-3">
              {props && (
                <div className="grid grid-cols-1 @sm:grid-cols-2 @lg:grid-cols-3 gap-2">
                  {deviceSummary(props).map(([k, v]) => (
                    <div key={k} className="bg-slate-950 border border-slate-800 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-bold uppercase">{k}</div>
                      <div className="text-slate-200 break-all">{v}</div>
                    </div>
                  ))}
                  {battery?.level !== null && battery && (
                    <div className="bg-slate-950 border border-slate-800 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-bold uppercase">Battery</div>
                      <div className="text-slate-200">{battery.level}% · {battery.status} · {battery.plugged} · {battery.temperature}°C · {battery.voltage?.toFixed(2)} V · {battery.health}</div>
                    </div>
                  )}
                  {screenSize && (
                    <div className="bg-slate-950 border border-slate-800 rounded p-2">
                      <div className="text-[10px] text-slate-500 font-bold uppercase">Screen</div>
                      <div className="text-slate-200">{screenSize.width} × {screenSize.height}</div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => guard('info', () => loadDeviceInfo(adb))} disabled={!!busy} className={btn}><RefreshCw className="w-3.5 h-3.5" /> REFRESH</button>
                {props && <button onClick={() => saveBytes(Object.entries(props).map(([k, v]) => `[${k}]: [${v}]`).join('\n'), 'getprop.txt', 'text/plain')} className={btn}><Download className="w-3.5 h-3.5" /> ALL PROPERTIES</button>}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                <span className="font-bold text-slate-200 flex items-center gap-2"><Wifi className="w-4 h-4 text-emerald-400" /> WIRELESS</span>
                <span className="text-slate-500">port</span>
                <input value={tcpipPort} onChange={(e) => setTcpipPort(e.target.value)} className={`${inp} w-20`} />
                <button onClick={handleTcpip} disabled={!!busy} className={btn}>RESTART ADB OVER TCP/IP</button>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                <span className="font-bold text-slate-200 flex items-center gap-2"><Power className="w-4 h-4 text-amber-400" /> REBOOT</span>
                {REBOOT_TARGETS.map((t) => (
                  <button key={t.id} onClick={() => handleReboot(t.id)} disabled={!!busy} className={btn}>{t.label}</button>
                ))}
              </div>
            </div>
          )}

          {tab === 'shell' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-emerald-400">$</span>
                <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runShell()} list="adb-history" className={`${inp} flex-1`} />
                <datalist id="adb-history">{history.map((h) => <option key={h} value={h} />)}</datalist>
                <button onClick={() => runShell()} disabled={!!busy} className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40"><Play className="w-3.5 h-3.5" /> RUN</button>
              </div>
              <div className="flex flex-wrap gap-1">
                {['ps -A', 'df -h', 'ip addr', 'dumpsys wifi | grep mWifiInfo', 'settings list global', 'cat /proc/cpuinfo', 'dumpsys activity top | head -40', 'id'].map((c) => (
                  <button key={c} onClick={() => { setCmd(c); runShell(c); }} disabled={!!busy} className={btnSm}>{c}</button>
                ))}
              </div>
              {shellOut !== '' && <pre className="bg-slate-950 border border-slate-800 rounded p-2 max-h-80 overflow-auto text-slate-300 whitespace-pre-wrap">{shellOut}</pre>}
            </div>
          )}

          {tab === 'files' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1">
                <button onClick={() => openDir('/')} className="text-cyan-300 hover:underline">/</button>
                {crumbs.map((c, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <button onClick={() => openDir(`/${crumbs.slice(0, i + 1).join('/')}/`)} className="text-cyan-300 hover:underline">{c}</button>
                    <ChevronRight className="w-3 h-3 text-slate-600" />
                  </span>
                ))}
                <input defaultValue={cwd} key={cwd} onKeyDown={(e) => e.key === 'Enter' && openDir(e.currentTarget.value)} className={`${inp} ml-2 w-56`} title="Type a path and press Enter" />
                <button onClick={() => openDir(cwd)} disabled={!!busy} className={btnSm}><RefreshCw className="w-3 h-3" /></button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input type="file" ref={uploadRef} className="text-slate-400 text-[11px]" />
                <button onClick={uploadFile} disabled={!!busy} className={btn}><Upload className="w-3.5 h-3.5" /> PUSH HERE</button>
                {progress != null && <div className="w-40 h-2 bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${progress}%` }} /></div>}
              </div>
              <div className="max-h-96 overflow-y-auto border border-slate-800 rounded">
                <table className="w-full text-[11px]">
                  <tbody>
                    {cwd !== '/' && (
                      <tr className="border-b border-slate-900"><td colSpan={4} className="px-2 py-0.5"><button onClick={() => openDir(cwd.replace(/[^/]+\/$/, ''))} className="text-cyan-300">..</button></td></tr>
                    )}
                    {(entries || []).map((e) => (
                      <tr key={e.name} className="border-b border-slate-900 hover:bg-slate-900/40">
                        <td className="px-2 py-0.5">
                          {e.isDir || e.isLink ? (
                            <button onClick={() => openDir(cwd + e.name)} className="flex items-center gap-1 text-cyan-300"><Folder className="w-3.5 h-3.5" /> {e.name}{e.isLink ? ' →' : ''}</button>
                          ) : (
                            <span className="flex items-center gap-1 text-slate-300"><FileText className="w-3.5 h-3.5 text-slate-500" /> {e.name}</span>
                          )}
                        </td>
                        <td className="text-slate-400">{e.isDir ? '' : fmtBytes(e.size)}</td>
                        <td className="text-slate-500">{e.mtime ? new Date(e.mtime * 1000).toISOString().replace('T', ' ').slice(0, 16) : ''}</td>
                        <td className="text-right px-2 whitespace-nowrap">
                          {!e.isDir && <button onClick={() => pullFile(e)} disabled={!!busy} className={`${btnSm} mr-1`}>PULL</button>}
                          <button onClick={() => deleteFile(e)} disabled={!!busy} className={btnSm}><Trash2 className="w-3 h-3" /></button>
                        </td>
                      </tr>
                    ))}
                    {entries && !entries.length && <tr><td className="px-2 py-2 text-slate-500">Empty, or no permission to list this folder.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'apps' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => loadPackages()} disabled={!!busy} className={btn}><RefreshCw className="w-3.5 h-3.5" /> REFRESH</button>
                <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={showSystem} onChange={(e) => { setShowSystem(e.target.checked); loadPackages(e.target.checked); }} className="accent-emerald-500" /> include system apps</label>
                <input value={pkgFilter} onChange={(e) => setPkgFilter(e.target.value)} placeholder="filter" className={`${inp} w-48`} />
                <span className="ml-auto flex items-center gap-2">
                  <input type="file" accept=".apk" ref={apkRef} className="text-slate-400 text-[11px]" />
                  <button onClick={installFromFile} disabled={!!busy} className={btn}><Upload className="w-3.5 h-3.5" /> INSTALL APK</button>
                </span>
              </div>
              <div className="text-slate-500">{packages ? `${pkgShown.length} of ${packages.length} packages` : 'Loading...'}</div>
              <div className="max-h-96 overflow-y-auto border border-slate-800 rounded">
                {pkgShown.map((p) => (
                  <div key={p.name} className="flex flex-wrap items-center gap-2 px-2 py-1 border-b border-slate-900">
                    <span className="text-slate-200 flex-1 min-w-[12rem] break-all">{p.name}</span>
                    {pkgInfo[p.name]?.versionName && <span className="text-slate-500">v{pkgInfo[p.name].versionName} ({pkgInfo[p.name].versionCode})</span>}
                    <button onClick={() => appInfo(p.name)} disabled={!!busy} className={btnSm}>INFO</button>
                    <button onClick={() => appAction(p.name, 'launch')} disabled={!!busy} className={btnSm}>LAUNCH</button>
                    <button onClick={() => appAction(p.name, 'stop')} disabled={!!busy} className={btnSm}>STOP</button>
                    <button onClick={() => pullApk(p.name)} disabled={!!busy} className={btnSm}>SAVE APK</button>
                    <button onClick={() => appAction(p.name, 'clear')} disabled={!!busy} className={`${btnSm} text-amber-300`}>CLEAR DATA</button>
                    <button onClick={() => appAction(p.name, 'uninstall')} disabled={!!busy} className={`${btnSm} text-rose-300`}>UNINSTALL</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'logcat' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                {!logcatOn ? (
                  <button onClick={() => setLogcatOn(true)} className={btn}><Play className="w-3.5 h-3.5" /> START</button>
                ) : (
                  <button onClick={() => setLogcatOn(false)} className={btn}><Square className="w-3.5 h-3.5" /> STOP</button>
                )}
                <span className="text-slate-500">level ≥</span>
                <select value={minLevel} onChange={(e) => setMinLevel(e.target.value)} className={inp}>
                  {LOG_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
                <input value={logFilter} onChange={(e) => setLogFilter(e.target.value)} placeholder="tag, text or PID" className={`${inp} w-56`} />
                <button onClick={() => setLogcat([])} className={btn}><Trash2 className="w-3.5 h-3.5" /> CLEAR</button>
                <button onClick={() => saveBytes(logcat.map((e) => e.raw).join('\n') + '\n', `logcat-${Date.now()}.txt`, 'text/plain')} disabled={!logcat.length} className={btn}><Download className="w-3.5 h-3.5" /> SAVE</button>
                <span className="text-slate-500">{shownLogcat.length} / {logcat.length} lines{logcatOn ? ' · polling every second' : ''}</span>
              </div>
              <div className="bg-black border border-slate-800 rounded p-2 h-96 overflow-y-auto text-[11px] leading-snug">
                {shownLogcat.slice(-1500).map((e, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    <span className="text-slate-600">{e.time}</span>{' '}
                    <span className="text-slate-500">{String(e.pid).padStart(5)}</span>{' '}
                    <span className={LEVEL_COLORS[e.level]}>{e.level} {e.tag}</span>
                    <span className="text-slate-300">: {e.message}</span>
                  </div>
                ))}
                {!logcat.length && <div className="text-slate-600">{logcatOn ? 'Waiting for log lines...' : 'Press START to read the device log.'}</div>}
              </div>
            </div>
          )}

          {tab === 'screen' && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => guard('screen', grabScreen)} disabled={!!busy} className={btn}><Monitor className="w-3.5 h-3.5" /> CAPTURE</button>
                <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={autoScreen} onChange={(e) => setAutoScreen(e.target.checked)} className="accent-emerald-500" /> refresh every 1.5 s</label>
                {screen && <button onClick={() => saveBytes(screen.bytes, `screen-${Date.now()}.png`, 'image/png')} className={btn}><Download className="w-3.5 h-3.5" /> SAVE PNG</button>}
                <span className="text-slate-500">Click the screenshot to tap there.</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {[['HOME', 'HOME'], ['BACK', 'BACK'], ['APPS', 'APP_SWITCH'], ['POWER', 'POWER'], ['VOL +', 'VOLUME_UP'], ['VOL −', 'VOLUME_DOWN'], ['WAKE', 'WAKEUP'], ['ENTER', 'ENTER'], ['DEL', 'DEL']].map(([label, key]) => (
                  <button key={key} onClick={() => input(`input keyevent ${KEYCODES[key]}`)} disabled={!!busy} className={btnSm}>{label}</button>
                ))}
                <input value={typeText} onChange={(e) => setTypeText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && typeText) { input(inputTextCommand(typeText)); setTypeText(''); } }} placeholder="type text, Enter to send" className={`${inp} w-56 ml-2`} />
              </div>
              {screen && <img src={screen.url} alt="Device screen" onClick={onScreenClick} className="max-h-[70vh] border border-slate-800 rounded cursor-crosshair" />}
            </div>
          )}
        </div>
      )}

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
