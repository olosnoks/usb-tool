import React, { useState, useEffect, useRef } from 'react';
import {
  Zap,
  BatteryCharging,
  Sliders,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
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
  FIXED_PDO_PROFILES,
  PPS_PROFILE,
  SAMPLE_CABLE_EMARKERS,
  NVM_CURRENTS,
  nvmToText,
  nvmFromText
} from '../../utils/usbPdDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

export default function UsbPdWorkbench() {
  const [client] = useState(() => new UsbPdClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);

  // Active PDO / Voltage settings
  const [activePdoId, setActivePdoId] = useState(1);
  const [isPps, setIsPps] = useState(false);
  const [ppsVoltage, setPpsVoltage] = useState(5.0);

  // Live VBUS Telemetry
  const [telemetry, setTelemetry] = useState({
    voltageV: 5.0,
    currentA: 0.0,
    powerW: 0.0,
    tempC: 25.0,
    accumulatedMah: 0,
    accumulatedMwh: 0
  });

  const [cable, setCable] = useState(SAMPLE_CABLE_EMARKERS[0]);

  // Telemetry loop
  useEffect(() => {
    let interval = null;
    if (isConnected && isSimulated) {
      interval = setInterval(() => {
        const data = client.readTelemetry();
        setTelemetry(data);
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, isSimulated, client]);

  const handleConnectSimulation = () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    setActivePdoId(1);
    setIsPps(false);
    setPpsVoltage(5.0);
    setCable(SAMPLE_CABLE_EMARKERS[0]);
  };

  const [error, setError] = useState('');
  const [connecting, setConnecting] = useState(false);

  const handleConnectHardware = async () => {
    setError('');
    setConnecting(true);
    try {
      await client.connectHardware();
      setIsConnected(true);
      setIsSimulated(false);
    } catch (err) {
      setError(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    await client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setTelemetry({
      voltageV: 0,
      currentA: 0,
      powerW: 0,
      tempC: 25.0,
      accumulatedMah: 0,
      accumulatedMwh: 0
    });
  };

  const handleSelectPdo = (pdoId) => {
    if (!isConnected) return;
    setActivePdoId(pdoId);
    setIsPps(false);
    client.requestFixedPdo(pdoId);
  };

  const handleSetPpsVoltage = (volts) => {
    if (!isConnected) return;
    const clamped = Math.max(3.3, Math.min(21.0, volts));
    setPpsVoltage(Number(clamped.toFixed(2)));
    setIsPps(true);
    setActivePdoId(6);
    client.requestPpsVoltage(clamped);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {isSimulated && <DemoBanner>Simulated 100 W charger: the voltages, currents and cable data below are invented.</DemoBanner>}
      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>USB-PD POWER DELIVERY ANALYZER & VARIABLE VOLTAGE TRIGGER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Request fixed USB-PD voltages (5-20 V) and read the negotiated contract from an STUSB4500 sink controller (e.g. SparkFun Power Delivery Board) wired to a Bus Pirate's I2C pins. The demo adds PPS, VBUS metering and e-marker views.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                <button
                  onClick={handleConnectHardware}
                  disabled={connecting}
                  title="STUSB4500 at I2C 0x28 through a Bus Pirate v3/v4 (binary mode)"
                  className="disabled:opacity-40 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all active:scale-95"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>{connecting ? 'CONNECTING...' : 'CONNECT STUSB4500 (BUS PIRATE)'}</span>
                </button>
                <button
                  onClick={handleConnectSimulation}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>DEMO</span>
                </button>
              </>
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

        {/* Live VBUS Multimeter Dials (simulation only: the STUSB4500 has no VBUS meter) */}
        {(isSimulated || !isConnected) && (
        <div className="pt-4 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {/* Voltage */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">VBUS VOLTAGE</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-400 font-mono tracking-tight my-1">
              {telemetry.voltageV.toFixed(3)} <span className="text-xs text-amber-500 font-bold">V</span>
            </div>
            <span className="text-[10px] text-slate-400">Target: {client.targetVoltageV.toFixed(1)}V</span>
          </div>

          {/* Current */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">LOAD CURRENT</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-cyan-400 font-mono tracking-tight my-1">
              {telemetry.currentA.toFixed(3)} <span className="text-xs text-cyan-500 font-bold">A</span>
            </div>
            <span className="text-[10px] text-slate-400">Limit: 5.000A</span>
          </div>

          {/* Power */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">ACTIVE POWER</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-400 font-mono tracking-tight my-1">
              {telemetry.powerW.toFixed(2)} <span className="text-xs text-emerald-500 font-bold">W</span>
            </div>
            <span className="text-[10px] text-slate-400">Max Rating: 100W</span>
          </div>

          {/* Temperature */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">CONNECTOR TEMP</span>
            <div className="text-2xl sm:text-3xl font-extrabold text-rose-400 font-mono tracking-tight my-1">
              {telemetry.tempC.toFixed(1)} <span className="text-xs text-rose-500 font-bold">°C</span>
            </div>
            <span className="text-[10px] text-slate-400">Safe: &lt; 50°C</span>
          </div>

          {/* Energy mAh */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">CAPACITY</span>
              <button
                onClick={() => client.resetEnergyCounter()}
                title="Reset capacity counters"
                className="text-[10px] text-slate-500 hover:text-cyan-400"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
            <div className="text-xl sm:text-2xl font-extrabold text-purple-400 font-mono tracking-tight my-1">
              {telemetry.accumulatedMah} <span className="text-[10px] text-purple-500 font-bold">mAh</span>
            </div>
            <span className="text-[10px] text-slate-400">Cumulative</span>
          </div>

          {/* Energy mWh */}
          <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
            <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">ENERGY</span>
            <div className="text-xl sm:text-2xl font-extrabold text-blue-400 font-mono tracking-tight my-1">
              {telemetry.accumulatedMwh} <span className="text-[10px] text-blue-500 font-bold">mWh</span>
            </div>
            <span className="text-[10px] text-slate-400">Watt-Hours</span>
          </div>
        </div>
        )}
      </div>

      {isConnected && !isSimulated && <Stusb4500Panel client={client} onError={setError} />}

      {/* Contract Negotiator & PPS Slider */}
      {(isSimulated || !isConnected) && (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Fixed PDO Contract Buttons */}
        <div className="lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-2">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>FIXED VOLTAGE CONTRACTS (POWER DATA OBJECTS)</span>
            </span>
            <span className="text-[10px] text-slate-400">Click to Negotiate</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {FIXED_PDO_PROFILES.map((pdo) => {
              const isActive = isConnected && activePdoId === pdo.id && !isPps;
              return (
                <button
                  key={pdo.id}
                  onClick={() => handleSelectPdo(pdo.id)}
                  disabled={!isConnected}
                  className={`p-3 rounded-xl border flex flex-col items-center justify-center transition-all ${
                    isActive
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-amber-glow scale-102 font-extrabold'
                      : 'bg-slate-950 text-slate-300 border-slate-800 hover:border-slate-700 hover:bg-slate-900/60'
                  } disabled:opacity-40 disabled:cursor-not-allowed`}
                >
                  <span className="text-lg font-black">{pdo.voltageV}V</span>
                  <span className="text-[10px] text-slate-400 font-semibold mt-0.5">{pdo.maxCurrentA}A Max</span>
                  <span className="text-[9px] text-cyan-400 font-mono mt-1 font-bold">{pdo.maxPowerW}W</span>
                </button>
              );
            })}
          </div>

          {/* PPS (Programmable Power Supply) Fine Tuner */}
          <div className="pt-2 border-t border-slate-900 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <BatteryCharging className="w-4 h-4 text-purple-400" />
                <span>PPS VARIABLE VOLTAGE MODE (3.3V - 21.0V)</span>
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                isPps ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40' : 'bg-slate-900 text-slate-500'
              }`}>
                {isPps ? 'PPS ACTIVE' : 'INACTIVE'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="range"
                min="3.3"
                max="21.0"
                step="0.1"
                value={ppsVoltage}
                disabled={!isConnected}
                onChange={(e) => handleSetPpsVoltage(Number(e.target.value))}
                className="flex-1 accent-purple-500 cursor-pointer disabled:opacity-40"
              />
              <span className="w-16 text-right font-extrabold text-purple-300 text-base">
                {ppsVoltage.toFixed(1)}V
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {[-1.0, -0.1, +0.1, +1.0].map((step) => (
                <button
                  key={step}
                  onClick={() => handleSetPpsVoltage(ppsVoltage + step)}
                  disabled={!isConnected}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-bold disabled:opacity-40"
                >
                  {step > 0 ? `+${step}V` : `${step}V`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right: E-Marker Cable Diagnostics */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <Cpu className="w-4 h-4 text-emerald-400" />
                <span>E-MARKER CABLE DECODER</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-bold">Decoded</span>
            </div>

            <div className="space-y-2 pt-2 text-[11px]">
              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Manufacturer</span>
                <span className="font-bold text-slate-200">{cable.manufacturer}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Max Power Rating</span>
                <span className="font-bold text-amber-300">{cable.maxCurrent} • {cable.maxVoltage}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">USB Data Capability</span>
                <span className="font-bold text-cyan-300">{cable.speed}</span>
              </div>

              <div>
                <span className="text-[10px] text-slate-500 uppercase font-bold block">Cable Type</span>
                <span className="text-slate-300">{cable.type}</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-850 text-[10px] text-slate-400 flex items-center gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>5A / 240W cables require an internal E-Marker chip to unlock &gt;60W charging.</span>
          </div>
        </div>
      </div>
      )}
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
    if (!window.confirm(`Ask the charger for ${volts} V at up to ${amps} A? Whatever is connected to the board's output will get that voltage.`)) return;
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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <NvmPanel client={client} onError={onError} busyRef={busyRef} />
      <div className="lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
    if (!window.confirm(`Write these power-up PDOs to the STUSB4500 NVM?\n\n${summary}\n\nAfter the next power-up the board asks for the highest of these. Check its output with a meter before connecting anything, and keep the backup to restore.`)) return;
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
    if (!window.confirm(`Write the backup ${file.name} back into the NVM? It replaces all 40 bytes.`)) return;
    run('restore', async () => { await client.restoreNvm(sectors); setNvm(await client.readNvm()); });
  };

  const setPdo = (i, key, value) => setForm((f) => ({ ...f, pdos: f.pdos.map((p, k) => (k === i ? { ...p, [key]: Number(value) } : p)) }));
  const btn = 'px-2 py-1 rounded border font-bold disabled:opacity-40';

  return (
    <div className="lg:col-span-3 order-last bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3 text-xs">
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
