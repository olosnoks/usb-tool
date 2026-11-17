import React, { useState, useEffect, useRef } from 'react';
import {
  Zap,
  AlertTriangle,
  CheckCircle2,
  ShieldAlert,
  Flame,
  Info,
  Activity,
  Cpu,
  Power,
  Usb,
  RefreshCw
} from 'lucide-react';
import {
  UsbPdClient,
  NVM_CURRENTS,
  nvmToText,
  nvmFromText
} from '../../utils/usbPdDriver';
import StatusBadge from '../common/StatusBadge';

import { confirmAction, useSessionError, record } from '../../utils/sessionLog';
export default function UsbPdWorkbench() {
  const [client] = useState(() => new UsbPdClient((m) => record('USB-PD', 'info', m)));
  const [isConnected, setIsConnected] = useState(false);

  const [error, setError] = useSessionError('USB-PD');
  const [connecting, setConnecting] = useState(false);

  const handleConnectHardware = async () => {
    setError('');
    setConnecting(true);
    try {
      await client.connectHardware();
      setIsConnected(true);
    } catch (err) {
      setError(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400">
              Request fixed USB-PD voltages (5-20 V) and read the negotiated contract from an STUSB4500 sink controller (e.g. SparkFun Power Delivery Board) wired to a Bus Pirate's I2C pins.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnectHardware}
                disabled={connecting}
                title="STUSB4500 at I2C 0x28 through a Bus Pirate v3/v4 (binary mode)"
                className="disabled:opacity-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all active:scale-95"
              >
                <Power className="w-3.5 h-3.5" />
                <span>{connecting ? 'CONNECTING...' : 'CONNECT STUSB4500 (BUS PIRATE)'}</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold hover:bg-rose-500/30 transition-all"
              >
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {!isConnected && (
          <p className="pt-3 text-[11px] text-slate-500">
            Connect a Bus Pirate wired to an STUSB4500 to read the negotiated contract and request a voltage. The STUSB4500 has no VBUS meter, so voltage and current are not measured here.
          </p>
        )}
      </div>

      {isConnected && <Stusb4500Panel client={client} onError={setError} />}

    </div>
  );
}

const PD_PRESETS = [5, 9, 12, 15, 20];

// Live view of an STUSB4500: contract, sink PDOs, and voltage requests.
function Stusb4500Panel({ client, onError }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [voltage, setVoltage] = useState('9');
  const [current, setCurrent] = useState('1.5');
  const busyRef = useRef(false);

  const refresh = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      setStatus(await client.readHardwareStatus());
    } catch (e) {
      onError(`Reading the STUSB4500 failed: ${e.message}`);
    } finally {
      busyRef.current = false;
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, []);

  const request = async (v) => {
    const volts = Number(v);
    const amps = Number(current);
    if (!confirmAction(`Ask the charger for ${volts} V at up to ${amps} A? Whatever is connected to the board's output will get that voltage.`)) return;
    setBusy(true);
    busyRef.current = true;
    onError('');
    try {
      await client.requestHardwareVoltage(volts, amps);
      await new Promise((r) => setTimeout(r, 600)); // let the new contract settle
    } catch (e) {
      onError(e.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
      refresh();
    }
  };

  const rdo = status?.rdo;
  return (
    <div className="grid grid-cols-1 @lg:grid-cols-3 gap-4">
      <NvmPanel client={client} onError={onError} busyRef={busyRef} />
      <div className="@lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 text-xs flex items-center gap-2">
            <Usb className="w-4 h-4 text-amber-400" />
            STUSB4500 CONTRACT {client.chipId ? `(ID 0x${client.chipId.toString(16)})` : ''}
          </span>
          <button onClick={refresh} className="p-1 rounded bg-slate-900 text-cyan-400 border border-slate-800" title="Read again">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
        {!status ? (
          <p className="text-slate-500">Reading...</p>
        ) : (
          <div className="grid grid-cols-2 @sm:grid-cols-4 gap-3">
            <Stat label="SOURCE" value={status.attached ? 'ATTACHED' : 'NONE'} tone={status.attached ? 'text-emerald-400' : 'text-slate-500'} />
            <Stat label="CONTRACT" value={rdo ? `source PDO #${rdo.position}` : 'none'} tone="text-amber-400" />
            <Stat label="OPERATING CURRENT" value={rdo ? `${rdo.operatingCurrentA.toFixed(2)} A` : '-'} tone="text-cyan-400" />
            <Stat label="MAX CURRENT" value={rdo ? `${rdo.maxCurrentA.toFixed(2)} A` : '-'} tone="text-cyan-400" />
          </div>
        )}
        {rdo?.capabilityMismatch && (
          <p className="text-amber-300">Capability mismatch: the charger couldn't meet any requested voltage above 5 V, so the board took 5 V.</p>
        )}
        <div>
          <span className="text-[10px] text-slate-500 font-bold uppercase">Sink PDOs (what the board asks for, highest number preferred)</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {status?.sink.pdos.map((p, i) => (
              <div key={i} className={`p-2 rounded-lg border ${i < status.sink.count ? 'border-amber-500/40 bg-amber-500/10 text-amber-200' : 'border-slate-800 bg-slate-950 text-slate-600'}`}>
                PDO{i + 1}: {p.voltageV.toFixed(2)} V / {p.currentA.toFixed(2)} A{i < status.sink.count ? '' : ' (off)'}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
        <span className="font-bold text-slate-200 text-xs flex items-center gap-2 pb-2 border-b border-slate-800">
          <Zap className="w-4 h-4 text-amber-400" /> REQUEST A VOLTAGE
        </span>
        <div className="grid grid-cols-5 gap-1.5">
          {PD_PRESETS.map((v) => (
            <button key={v} disabled={busy} onClick={() => request(v)} className="py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 font-bold disabled:opacity-40">
              {v}V
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input value={voltage} onChange={(e) => setVoltage(e.target.value)} className="w-16 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
          <span className="text-slate-500">V at</span>
          <input value={current} onChange={(e) => setCurrent(e.target.value)} className="w-14 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
          <span className="text-slate-500">A</span>
          <button disabled={busy} onClick={() => request(voltage)} className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold disabled:opacity-40">SET</button>
        </div>
        <p className="text-[10px] text-slate-500 leading-relaxed">
          Fixed voltages only (the STUSB4500 has no PPS). Changes go to RAM and are lost when the board loses power; NVM is never written.
          The chip doesn't measure VBUS, so check the output with a meter. Wiring: Bus Pirate MOSI = SDA, CLK = SCL, GND to GND, and Vpu to the board's 3.3 V for the pull-ups.
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-slate-950 p-3 rounded-xl border border-slate-800">
      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">{label}</span>
      <span className={`text-sm font-extrabold ${tone}`}>{value}</span>
    </div>
  );
}

// Read, back up and (only when the bit layout is proven on this chip) rewrite the STUSB4500's NVM.
function NvmPanel({ client, onError, busyRef }) {
  const [nvm, setNvm] = useState(null); // { sectors, decoded, match }
  const [form, setForm] = useState(null);
  const [working, setWorking] = useState('');
  const fileRef = useRef(null);

  const run = async (label, fn) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setWorking(label);
    onError('');
    try { await fn(); } catch (e) { onError(e.message); } finally { busyRef.current = false; setWorking(''); }
  };

  const read = () => run('read', async () => {
    const r = await client.readNvm();
    setNvm(r);
    setForm({ pdoCount: r.decoded.pdoCount || 1, pdos: r.decoded.pdos.map((p) => ({ voltageV: p.voltageV, currentA: p.currentA ?? 1.5 })) });
  });

  const write = () => {
    const f = form;
    const summary = f.pdos.slice(0, f.pdoCount).map((p, i) => `PDO${i + 1}: ${p.voltageV} V / ${p.currentA} A`).join('\n');
    if (!confirmAction(`Write these power-up PDOs to the STUSB4500 NVM?\n\n${summary}\n\nAfter the next power-up the board asks for the highest of these. Check its output with a meter before connecting anything, and keep the backup to restore.`)) return;
    run('write', async () => { await client.writeNvmPdos(f); await new Promise((r) => setTimeout(r, 50)); setNvm(await client.readNvm()); });
  };

  const backup = () => {
    const url = URL.createObjectURL(new Blob([nvmToText(nvm.sectors)], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `stusb4500-nvm-${Date.now()}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const restore = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let sectors;
    try { sectors = nvmFromText(await file.text()); } catch (err) { onError(err.message); return; }
    if (!confirmAction(`Write the backup ${file.name} back into the NVM? It replaces all 40 bytes.`)) return;
    run('restore', async () => { await client.restoreNvm(sectors); setNvm(await client.readNvm()); });
  };

  const setPdo = (i, key, value) => setForm((f) => ({ ...f, pdos: f.pdos.map((p, k) => (k === i ? { ...p, [key]: Number(value) } : p)) }));
  const btn = 'px-2 py-1 rounded border font-bold disabled:opacity-40';

  return (
    <div className="@lg:col-span-3 order-last bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <span className="font-bold text-slate-200">NVM: POWER-UP PDOs (SURVIVE POWER-OFF)</span>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={read} disabled={!!working} className={`${btn} border-slate-700 text-slate-200`}>{working === 'read' ? 'READING...' : 'READ NVM'}</button>
          <button onClick={backup} disabled={!nvm} className={`${btn} border-slate-700 text-slate-200`}>BACKUP</button>
          <button onClick={() => fileRef.current?.click()} disabled={!!working} className={`${btn} border-amber-500/40 text-amber-300`}>RESTORE…</button>
          <input ref={fileRef} type="file" accept=".txt" className="hidden" onChange={restore} />
        </div>
      </div>
      <p className="text-slate-500">
        Voltage requests above only change RAM and are lost at power-off. The NVM holds what the board asks for at power-up.
        Writing is allowed only when the NVM decodes to exactly the PDOs the chip loaded at power-up, which proves the bit layout on this chip.
      </p>
      {nvm && (
        <>
          <div className="font-mono text-slate-400">{nvm.sectors.map((sct, i) => <div key={i}>sector {i}: {Array.from(sct, (b) => b.toString(16).padStart(2, '0')).join(' ')}</div>)}</div>
          <div className={nvm.match.ok ? 'text-emerald-300' : 'text-amber-300'}>
            {nvm.match.ok ? 'Layout verified: the NVM matches the power-up PDOs.' : `Layout not verified, writing disabled: ${nvm.match.reason} (Power-cycle the board and reconnect before reading, so RAM still holds the NVM values.)`}
          </div>
          {form && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-slate-400">PDOs
                <select value={form.pdoCount} onChange={(e) => setForm({ ...form, pdoCount: Number(e.target.value) })} className="bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-200">
                  {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              {form.pdos.map((p, i) => (
                <span key={i} className={`flex items-center gap-1 ${i < form.pdoCount ? 'text-slate-300' : 'text-slate-600'}`}>
                  PDO{i + 1}
                  {i === 0 ? <span className="text-slate-500">5 V</span> : (
                    <input type="number" min="5" max="20" step="0.05" value={p.voltageV} onChange={(e) => setPdo(i, 'voltageV', e.target.value)} className="w-16 bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-200" />
                  )}
                  <select value={p.currentA} onChange={(e) => setPdo(i, 'currentA', e.target.value)} className="bg-slate-950 border border-slate-800 rounded px-1 py-1 text-slate-200">
                    {NVM_CURRENTS.filter(Boolean).map((c) => <option key={c} value={c}>{c} A</option>)}
                  </select>
                </span>
              ))}
              <button onClick={write} disabled={!nvm.match.ok || !!working} className={`${btn} border-rose-500/40 text-rose-300`}>{working === 'write' ? 'WRITING...' : 'WRITE NVM'}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
