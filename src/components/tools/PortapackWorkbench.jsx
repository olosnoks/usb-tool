import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Radio,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  RotateCcw,
  RotateCw,
  Power,
  Monitor,
  Cpu,
  Send,
  Keyboard as KeyboardIcon,
  Play,
  AlertTriangle,
  Usb
} from 'lucide-react';
import { MayhemPortaPackDriver, FREQMAN_PRESETS } from '../../utils/mayhemDriver';
import StatusBadge from '../common/StatusBadge';

/**
 * PortaPack Mayhem workbench — real hardware only.
 * Mirrors the live LCD over the Mayhem USB serial console (`screenframeshort`)
 * and injects navigation via the `button` / `touch` / `keyboard` commands.
 * No simulated data.
 */
export default function PortapackWorkbench() {
  const [driver] = useState(() => new MayhemPortaPackDriver());
  const [conn, setConn] = useState({ isConnected: false, connectionType: null, firmwareVersion: null, boardId: null, frequency: null });
  const [logs, setLogs] = useState([]);
  const [isMirroring, setIsMirroring] = useState(false);
  const [frame, setFrame] = useState(null); // { width, height }
  const [busy, setBusy] = useState(false);
  const [freqInput, setFreqInput] = useState('433920000');
  const [appInput, setAppInput] = useState('');
  const [infoText, setInfoText] = useState('');
  const [kbInput, setKbInput] = useState('');

  const canvasRef = useRef(null);
  const mirrorActiveRef = useRef(false);
  const captureInFlightRef = useRef(false);

  useEffect(() => {
    driver.onLogCallback = (entry) => setLogs(prev => [...prev.slice(-199), entry]);
    driver.onStateChangeCallback = (s) => setConn(s);
    return () => { driver.onLogCallback = null; driver.onStateChangeCallback = null; };
  }, [driver]);

  useEffect(() => () => { driver.disconnect(); }, [driver]);

  const isSerial = conn.isConnected && conn.connectionType === 'serial';

  // --- Screen drawing -------------------------------------------------------
  const drawFrame = useCallback((f) => {
    const canvas = canvasRef.current;
    if (!canvas || !f) return;
    if (canvas.width !== f.width || canvas.height !== f.height) {
      canvas.width = f.width;
      canvas.height = f.height;
    }
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(f.rgba, f.width, f.height), 0, 0);
  }, []);

  const captureOnce = useCallback(async () => {
    if (captureInFlightRef.current) return;
    captureInFlightRef.current = true;
    try {
      const f = await driver.captureScreen();
      if (f) { drawFrame(f); setFrame({ width: f.width, height: f.height }); }
    } catch (e) {
      driver.log(`screenframe failed: ${e.message}`, 'error');
    } finally {
      captureInFlightRef.current = false;
    }
  }, [driver, drawFrame]);

  // Live mirror poll loop
  useEffect(() => {
    mirrorActiveRef.current = isMirroring && isSerial;
    if (!mirrorActiveRef.current) return;
    let stopped = false;
    const loop = async () => {
      while (!stopped && mirrorActiveRef.current) {
        await captureOnce();
        await new Promise(r => setTimeout(r, 600));
      }
    };
    loop();
    return () => { stopped = true; mirrorActiveRef.current = false; };
  }, [isMirroring, isSerial, captureOnce]);

  // --- Actions --------------------------------------------------------------
  const guard = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { driver.log(e.message, 'error'); } finally { setBusy(false); }
  };

  const connectSerial = () => guard(async () => {
    await driver.connectSerial();
    await captureOnce();
  });
  const connectSerialAllPorts = () => guard(() => driver.connectSerial({ noFilter: true }));
  const connectHackRf = () => guard(() => driver.connectWebUsb());
  const disconnect = () => guard(async () => { setIsMirroring(false); await driver.disconnect(); setFrame(null); });

  const press = (name) => guard(() => driver.press(name));
  const doReboot = () => guard(() => driver.reboot());
  const doDfu = () => guard(() => driver.enterDfu());

  const applyFreq = () => guard(async () => {
    const hz = parseInt(freqInput, 10);
    if (!hz || hz < 1_000_000 || hz > 6_000_000_000) throw new Error('Frequency must be 1 MHz – 6 GHz');
    await driver.setFrequency(hz);
  });
  const launchApp = () => guard(async () => { if (appInput.trim()) await driver.startApp(appInput.trim()); });
  const showInfo = (kind) => guard(async () => {
    const r = kind === 'sysinfo' ? await driver.getSysInfo()
      : kind === 'radioinfo' ? await driver.getRadioInfo()
      : kind === 'applist' ? await driver.listApps()
      : await driver.refreshInfo();
    setInfoText(r || '(no response)');
  });
  const sendKb = () => guard(async () => { if (kbInput) { await driver.sendKeyboard(kbInput); setKbInput(''); } });

  // Click on the mirror → touch at device coords
  const onScreenClick = (e) => {
    if (!isSerial || !frame) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * frame.width);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * frame.height);
    guard(() => driver.sendTouch(x, y));
  };

  const padBtn = 'flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 disabled:opacity-40 transition active:scale-95';

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Header */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Radio className="w-4 h-4 text-purple-400" />
              <span>PORTAPACK MAYHEM — LIVE SCREEN & CONTROL</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Mirrors the real PortaPack LCD and injects buttons over the Mayhem USB serial console. Keep the device in normal mode (not the blue HackRF screen).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge active={conn.isConnected} label={conn.isConnected ? (conn.connectionType === 'serial' ? 'Serial Console' : 'HackRF USB') : 'Disconnected'} />
            {!conn.isConnected ? (
              <>
                <button onClick={connectSerial} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/50 hover:bg-purple-500/30 font-bold disabled:opacity-40">
                  <Usb className="w-3.5 h-3.5" /><span>Connect Serial Console</span>
                </button>
                <button onClick={connectHackRf} disabled={busy} title="For raw IQ / ADS-B when the PortaPack is in HackRF mode" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800 font-bold disabled:opacity-40">
                  <Cpu className="w-3.5 h-3.5" /><span>HackRF Mode</span>
                </button>
              </>
            ) : (
              <button onClick={disconnect} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold disabled:opacity-40">
                <Power className="w-3.5 h-3.5" /><span>Disconnect</span>
              </button>
            )}
          </div>
        </div>
        {!conn.isConnected && (
          <div className="mt-3 flex items-start gap-2 text-[11px] text-slate-400">
            <button onClick={connectSerialAllPorts} disabled={busy} className="underline hover:text-slate-200">adapter not listed? show all serial ports</button>
          </div>
        )}
        {conn.firmwareVersion && (
          <div className="mt-2 text-[11px] text-slate-400">Firmware: <span className="text-purple-300">{conn.firmwareVersion}</span>{conn.boardId ? ` · ${conn.boardId}` : ''}</div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Live screen mirror */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 flex items-center gap-1.5"><Monitor className="w-4 h-4 text-cyan-400" /> Live LCD Mirror</span>
            <div className="flex items-center gap-2">
              <button onClick={() => guard(captureOnce)} disabled={!isSerial || busy} className="px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-cyan-300 hover:bg-slate-800 disabled:opacity-40">Refresh</button>
              <button onClick={() => setIsMirroring(v => !v)} disabled={!isSerial} className={`px-2.5 py-1 rounded border font-bold disabled:opacity-40 ${isMirroring ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50' : 'bg-slate-900 text-slate-300 border-slate-800'}`}>
                {isMirroring ? 'Mirroring ●' : 'Mirror Live'}
              </button>
            </div>
          </div>
          <div className="pt-3 flex flex-col items-center">
            <canvas
              ref={canvasRef}
              onClick={onScreenClick}
              className="rounded-md border border-slate-700 bg-black cursor-pointer"
              style={{ width: '320px', maxWidth: '100%', imageRendering: 'pixelated', aspectRatio: frame ? `${frame.width} / ${frame.height}` : '4 / 3' }}
            />
            <p className="mt-2 text-[10px] text-slate-500">
              {frame ? `${frame.width}×${frame.height} · click to touch` : (isSerial ? 'Press Refresh or Mirror Live to pull the screen' : 'Connect the serial console to mirror the screen')}
            </p>
          </div>
        </div>

        {/* Control pad */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <span className="font-bold text-slate-200 flex items-center gap-1.5"><Circle className="w-4 h-4 text-amber-400" /> Hardware Controls</span>

          <div className="flex items-center justify-center gap-6 py-2">
            {/* D-pad */}
            <div className="grid grid-cols-3 grid-rows-3 gap-1.5 w-36 h-36">
              <span />
              <button className={padBtn} disabled={!isSerial || busy} onClick={() => press('up')}><ChevronUp className="w-5 h-5" /></button>
              <span />
              <button className={padBtn} disabled={!isSerial || busy} onClick={() => press('left')}><ChevronLeft className="w-5 h-5" /></button>
              <button className={`${padBtn} bg-purple-600/30 border-purple-500/50 text-purple-200`} disabled={!isSerial || busy} onClick={() => press('select')}><Circle className="w-4 h-4 fill-current" /></button>
              <button className={padBtn} disabled={!isSerial || busy} onClick={() => press('right')}><ChevronRight className="w-5 h-5" /></button>
              <span />
              <button className={padBtn} disabled={!isSerial || busy} onClick={() => press('down')}><ChevronDown className="w-5 h-5" /></button>
              <span />
            </div>
            {/* Rotary + system */}
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-slate-500 uppercase">Rotary</span>
              <div className="flex gap-1.5">
                <button className={`${padBtn} w-10 h-10`} disabled={!isSerial || busy} onClick={() => press('rotaryLeft')} title="Rotary Left"><RotateCcw className="w-4 h-4" /></button>
                <button className={`${padBtn} w-10 h-10`} disabled={!isSerial || busy} onClick={() => press('rotaryRight')} title="Rotary Right"><RotateCw className="w-4 h-4" /></button>
              </div>
              <button className="mt-2 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40" disabled={!isSerial || busy} onClick={doReboot}>Reboot</button>
              <button className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 hover:bg-amber-500/20 disabled:opacity-40" disabled={!isSerial || busy} onClick={doDfu}>Enter DFU</button>
            </div>
          </div>

          {/* Keyboard text injection */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <KeyboardIcon className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <input value={kbInput} onChange={e => setKbInput(e.target.value)} placeholder="Type text to inject to device keyboard"
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 outline-none focus:border-cyan-500" />
            <button onClick={sendKb} disabled={!isSerial || busy || !kbInput} className="px-3 py-1.5 rounded bg-cyan-600/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40">Send</button>
          </div>
        </div>
      </div>

      {/* Tuning + apps + info */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <span className="font-bold text-slate-200 flex items-center gap-1.5"><Radio className="w-4 h-4 text-emerald-400" /> Tuning & Apps</span>
          <div className="flex items-center gap-2">
            <input value={freqInput} onChange={e => setFreqInput(e.target.value)} className="w-40 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 font-mono outline-none focus:border-emerald-500" />
            <span className="text-[10px] text-slate-500">Hz</span>
            <button onClick={applyFreq} disabled={!isSerial || busy} className="flex items-center gap-1 px-3 py-1.5 rounded bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 font-bold disabled:opacity-40"><Send className="w-3 h-3" />setfreq</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FREQMAN_PRESETS.slice(0, 6).map(p => (
              <button key={p.id} onClick={() => setFreqInput(String(p.freq))} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-400 hover:text-emerald-300 text-[10px]">{(p.freq / 1e6).toFixed(3)}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <input value={appInput} onChange={e => setAppInput(e.target.value)} placeholder="app short name (see App List)"
              className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-200 outline-none focus:border-cyan-500" />
            <button onClick={launchApp} disabled={!isSerial || busy || !appInput} className="flex items-center gap-1 px-3 py-1.5 rounded bg-purple-600/20 text-purple-300 border border-purple-500/40 font-bold disabled:opacity-40"><Play className="w-3 h-3" />appstart</button>
          </div>
        </div>

        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-bold text-slate-200 flex items-center gap-1.5"><Cpu className="w-4 h-4 text-cyan-400" /> Device Info</span>
            <div className="flex gap-1.5">
              {['info', 'sysinfo', 'radioinfo', 'applist'].map(k => (
                <button key={k} onClick={() => showInfo(k)} disabled={!isSerial || busy} className="px-2 py-1 rounded bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 text-[10px] disabled:opacity-40">{k}</button>
              ))}
            </div>
          </div>
          <pre className="bg-slate-950 border border-slate-800 rounded p-2 text-[10px] text-slate-300 whitespace-pre-wrap h-28 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800">{infoText || '—'}</pre>
        </div>
      </div>

      {/* Console log */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-3 shadow-xl">
        <span className="font-bold text-slate-200 flex items-center gap-1.5 mb-2"><AlertTriangle className="w-3.5 h-3.5 text-slate-500" /> Console Log</span>
        <div className="bg-slate-950 border border-slate-800 rounded p-2 h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-800 space-y-0.5">
          {logs.length === 0 ? <span className="text-slate-600">No activity yet.</span> : logs.map((l, i) => (
            <div key={i} className={`text-[10px] ${l.type === 'error' ? 'text-rose-400' : l.type === 'success' ? 'text-emerald-400' : l.type === 'warning' ? 'text-amber-400' : l.type === 'sent' ? 'text-cyan-400' : 'text-slate-400'}`}>
              <span className="text-slate-600">{l.time}</span> {l.text}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
