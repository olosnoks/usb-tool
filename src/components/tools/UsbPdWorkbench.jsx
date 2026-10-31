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
  Power
} from 'lucide-react';
import { 
  UsbPdClient, 
  FIXED_PDO_PROFILES, 
  PPS_PROFILE, 
  SAMPLE_CABLE_EMARKERS 
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
    if (isConnected) {
      interval = setInterval(() => {
        const data = client.readTelemetry();
        setTelemetry(data);
      }, 100);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, client]);

  const handleConnectSimulation = () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    setActivePdoId(1);
    setIsPps(false);
    setPpsVoltage(5.0);
    setCable(SAMPLE_CABLE_EMARKERS[0]);
  };

  const handleConnectHardware = async () => {
    try {
      await client.connectHardware();
      setIsConnected(true);
      setIsSimulated(false);
    } catch (err) {
      alert(`Hardware connection failed: ${err.message}`);
    }
  };

  const handleDisconnect = () => {
    client.disconnect();
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
      <DemoBanner demoOnly>No USB-PD trigger or VBUS meter protocol is implemented. Voltages, currents and PDO requests below come from a simulated 100 W charger.</DemoBanner>
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-400" />
              <span>USB-PD POWER DELIVERY ANALYZER & VARIABLE VOLTAGE TRIGGER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Negotiate Power Delivery 3.0 / PPS contracts (5V, 9V, 12V, 15V, 20V) and measure real-time VBUS power & energy.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <>
                <button
                  onClick={handleConnectHardware}
                  disabled
                  title="No PD trigger or VBUS meter protocol is implemented yet."
                  className="disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow transition-all active:scale-95"
                >
                  <Power className="w-3.5 h-3.5" />
                  <span>CONNECT USB-PD DONGLE (NOT SUPPORTED YET)</span>
                </button>
                <button
                  onClick={handleConnectSimulation}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 text-xs font-bold transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>DEMO SIMULATION</span>
                </button>
              </>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold hover:bg-rose-500/30 transition-all"
              >
                <span>EMERGENCY DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* Live VBUS Multimeter Dials */}
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
      </div>

      {/* Contract Negotiator & PPS Slider */}
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
    </div>
  );
}
