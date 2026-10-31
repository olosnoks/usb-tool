import React, { useState, useRef, useCallback } from 'react';
import { Gauge, Usb, Power, ShieldAlert, Sparkles, Play, Loader2 } from 'lucide-react';
import { UsbTmcDevice, requestUsbTmcDevice, createSimulatedUsbTmc } from '../../utils/usbtmcDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const QUICK = ['*IDN?', '*RST', '*CLS', 'SYST:ERR?', 'MEAS:VOLT:DC?'];

export default function UsbTmcWorkbench() {
  const [inst, setInst] = useState(null);
  const [isSimulated, setIsSimulated] = useState(false);
  const [status, setStatus] = useState('offline');
  const [idn, setIdn] = useState('');
  const [cmd, setCmd] = useState('*IDN?');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const webUsbAvailable = typeof navigator !== 'undefined' && 'usb' in navigator;

  const addLog = useCallback((dir, text) => {
    setLog((prev) => [...prev.slice(-299), { ts: new Date().toLocaleTimeString(), dir, text }]);
  }, []);

  const connect = async (simulated) => {
    setBusy(true);
    try {
      const transport = simulated ? createSimulatedUsbTmc() : await requestUsbTmcDevice();
      const d = new UsbTmcDevice(transport);
      await d.open();
      const id = await d.identify();
      setInst(d); setIsSimulated(simulated); setIdn(id); setStatus(simulated ? 'warning' : 'online');
      addLog('in', id);
    } catch (err) {
      setStatus('warning'); addLog('err', err.message);
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    try { await inst?.close(); } catch (e) { /* ignore */ }
    setInst(null); setIsSimulated(false); setIdn(''); setStatus('offline');
  };

  const run = async (command) => {
    if (!inst || busy) return;
    setBusy(true);
    try {
      addLog('out', command);
      if (command.includes('?')) addLog('in', await inst.query(command));
      else await inst.write(command);
    } catch (err) { addLog('err', err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated instrument: *IDN? and measurements are invented, not from a device.</DemoBanner>}

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-cyan-400" /> <span>USBTMC INSTRUMENT (SCPI)</span>
            </h2>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Control a USBTMC test instrument — oscilloscope, DMM, power supply, signal generator — with SCPI commands over WebUSB.
              Query values, send settings, and read waveform/measurement data.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'SCPI' : status === 'warning' ? 'SIM' : 'IDLE'} value={inst ? (isSimulated ? 'Demo' : 'Connected') : 'Offline'} />
        </div>

        {!webUsbAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebUSB needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!inst ? (
            <>
              <button onClick={() => connect(false)} disabled={!webUsbAvailable || busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 text-xs font-bold disabled:opacity-40">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} CONNECT INSTRUMENT (WEBUSB)
              </button>
              <button onClick={() => connect(true)} disabled={busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-cyan-500/40 text-xs font-bold">
                <Sparkles className="w-3.5 h-3.5" /> DEMO
              </button>
            </>
          ) : (
            <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
              <Power className="w-3.5 h-3.5" /> DISCONNECT
            </button>
          )}
        </div>
        {idn && <p className="mt-2 text-[11px] text-emerald-400">{idn}</p>}
      </div>

      {inst && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-cyan-400">SCPI</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run(cmd)} className="flex-1 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
            <button onClick={() => run(cmd)} disabled={busy} className="flex items-center gap-1 px-3 py-1 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold disabled:opacity-40"><Play className="w-3.5 h-3.5" /> SEND</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} onClick={() => run(q)} disabled={busy} className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 disabled:opacity-40">{q}</button>
            ))}
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2 max-h-72 overflow-auto space-y-0.5">
            {log.length === 0 && <p className="text-slate-600">No exchanges yet.</p>}
            {log.map((e, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-slate-600">{e.ts}</span>
                <span className={e.dir === 'out' ? 'text-amber-300' : e.dir === 'err' ? 'text-rose-400' : 'text-emerald-300'}>{e.dir === 'out' ? '»' : e.dir === 'err' ? '✗' : '«'}</span>
                <span className="text-slate-300 whitespace-pre-wrap break-all">{e.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
