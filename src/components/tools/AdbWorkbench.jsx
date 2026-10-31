import React, { useState, useRef, useCallback } from 'react';
import {
  Usb,
  Smartphone,
  TerminalSquare,
  Upload,
  Download,
  Wifi,
  Power,
  ShieldAlert,
  Sparkles,
  Loader2,
  Play
} from 'lucide-react';
import {
  AdbConnection,
  requestAdbDevice,
  createSimulatedAdb
} from '../../utils/adbDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const REBOOT_TARGETS = [
  { id: '', label: 'System' },
  { id: 'bootloader', label: 'Bootloader' },
  { id: 'recovery', label: 'Recovery' },
  { id: 'fastboot', label: 'Fastbootd' }
];

export default function AdbWorkbench() {
  const [adb, setAdb] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState('offline');
  const [statusMsg, setStatusMsg] = useState('No ADB device connected');
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState('');
  const [log, setLog] = useState([]);

  const [cmd, setCmd] = useState('getprop ro.product.model');
  const [shellOut, setShellOut] = useState('');
  const [remotePath, setRemotePath] = useState('/data/local/tmp/');
  const [pullPath, setPullPath] = useState('/sdcard/');
  const [tcpipPort, setTcpipPort] = useState('5555');
  const [progress, setProgress] = useState(null);
  const fileRef = useRef(null);

  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const addLog = useCallback((msg, kind = 'info') => {
    const ts = new Date().toLocaleTimeString();
    setLog((prev) => [...prev.slice(-299), { ts, msg, kind }]);
  }, []);

  const connect = async (simulated) => {
    setBusy('connect');
    try {
      const transport = simulated ? createSimulatedAdb() : await requestAdbDevice();
      const conn = new AdbConnection(transport, { logger: addLog });
      const { banner: b } = await conn.connect({ onPrompt: () => addLog('Tap "Allow USB debugging" on the device (and "always allow" to remember this computer).', 'info') });
      setAdb(conn);
      setIsSimulated(simulated);
      setBanner(b);
      setStatus(simulated ? 'warning' : 'online');
      setStatusMsg(simulated ? 'Simulated device' : 'Connected');
    } catch (err) {
      setStatus('warning');
      setStatusMsg(err.message);
      addLog(`Connect failed: ${err.message}`, 'err');
    } finally {
      setBusy('');
    }
  };

  const disconnect = async () => {
    try { await adb?.close(); } catch (e) { /* ignore */ }
    setAdb(null);
    setIsSimulated(false);
    setBanner('');
    setStatus('offline');
    setStatusMsg('No ADB device connected');
  };

  const guard = async (label, fn) => {
    if (!adb || busy) return;
    setBusy(label);
    try { await fn(); }
    catch (err) { addLog(`${label} failed: ${err.message}`, 'err'); }
    finally { setBusy(''); setProgress(null); }
  };

  const runShell = () => guard('shell', async () => {
    addLog(`$ ${cmd}`, 'info');
    const out = await adb.shell(cmd);
    setShellOut(out);
  });

  const handlePush = () => guard('push', async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) throw new Error('Choose a file to push.');
    const data = new Uint8Array(await file.arrayBuffer());
    const dest = remotePath.endsWith('/') ? remotePath + file.name : remotePath;
    await adb.push(dest, data, { onProgress: (p) => setProgress(Math.round(p * 100)) });
    addLog(`Pushed ${file.name} → ${dest} (${data.length} bytes).`, 'ok');
  });

  const handlePull = () => guard('pull', async () => {
    const data = await adb.pull(pullPath);
    const name = pullPath.split('/').filter(Boolean).pop() || 'pulled.bin';
    const url = URL.createObjectURL(new Blob([data]));
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
    addLog(`Pulled ${pullPath} (${data.length} bytes) → downloaded as ${name}.`, 'ok');
  });

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

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated device: shell output, files and reboots are invented. Only a few shell commands are canned.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-emerald-400" />
              <span>ANDROID ADB (DEBUG BRIDGE)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Connect to an Android device with <b>USB debugging</b> enabled (Settings → Developer options). Run shell commands,
              push and pull files, switch to wireless ADB, and reboot. The phone shows an "Allow USB debugging?" prompt the first time —
              tap <b>Always allow</b> so it remembers this browser&apos;s key.
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
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{statusMsg}{banner ? ` — ${banner}` : ''}</p>
      </div>

      {adb && (
        <>
          {/* Shell */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
            <span className="font-bold text-slate-200 flex items-center gap-2"><TerminalSquare className="w-4 h-4 text-cyan-400" /> SHELL</span>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400">$</span>
              <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && runShell()} className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
              <button onClick={runShell} disabled={!!busy} className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40"><Play className="w-3.5 h-3.5" /> RUN</button>
            </div>
            {shellOut !== '' && <pre className="bg-slate-950 border border-slate-800 rounded p-2 max-h-56 overflow-auto text-slate-300 whitespace-pre-wrap">{shellOut}</pre>}
          </div>

          {/* Files */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
              <span className="font-bold text-slate-200 flex items-center gap-2"><Upload className="w-4 h-4 text-emerald-400" /> PUSH FILE</span>
              <input type="file" ref={fileRef} className="block w-full text-slate-400 text-[11px]" />
              <div className="flex items-center gap-2">
                <span className="text-slate-500">to</span>
                <input value={remotePath} onChange={(e) => setRemotePath(e.target.value)} className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
              </div>
              {progress != null && (
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} /></div>
              )}
              <button onClick={handlePush} disabled={!!busy} className="px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold disabled:opacity-40">{busy === 'push' ? 'PUSHING...' : 'PUSH'}</button>
            </div>

            <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
              <span className="font-bold text-slate-200 flex items-center gap-2"><Download className="w-4 h-4 text-cyan-400" /> PULL FILE</span>
              <div className="flex items-center gap-2">
                <span className="text-slate-500">from</span>
                <input value={pullPath} onChange={(e) => setPullPath(e.target.value)} className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
              </div>
              <button onClick={handlePull} disabled={!!busy} className="px-3 py-1.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40">{busy === 'pull' ? 'PULLING...' : 'PULL & DOWNLOAD'}</button>
            </div>
          </div>

          {/* Wireless + reboot */}
          <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-slate-200 flex items-center gap-2"><Wifi className="w-4 h-4 text-emerald-400" /> WIRELESS</span>
              <span className="text-slate-500">port</span>
              <input value={tcpipPort} onChange={(e) => setTcpipPort(e.target.value)} className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
              <button onClick={handleTcpip} disabled={!!busy} className="px-3 py-1.5 rounded bg-slate-900 text-emerald-300 border border-emerald-500/40 font-bold disabled:opacity-40">RESTART ADB OVER TCP/IP</button>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
              <span className="font-bold text-slate-200 flex items-center gap-2"><Power className="w-4 h-4 text-amber-400" /> REBOOT</span>
              {REBOOT_TARGETS.map((t) => (
                <button key={t.id} onClick={() => handleReboot(t.id)} disabled={!!busy} className="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold disabled:opacity-40">{t.label}</button>
              ))}
            </div>
          </div>
        </>
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
