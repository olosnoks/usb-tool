import React, { useState, useRef } from 'react';
import { 
  Cpu, 
  Play, 
  Upload, 
  RotateCcw, 
  CheckCircle2, 
  AlertTriangle, 
  Layers, 
  Sparkles, 
  FileCode, 
  Check, 
  ShieldCheck,
  Search
} from 'lucide-react';
import { 
  JtagClient, 
  JTAG_DEVICE_DATABASE 
} from '../../utils/jtagDriver';
import StatusBadge from '../common/StatusBadge';
import { DemoBanner } from '../common/DemoNotice';

const SAMPLE_SVF_TEXT = `// Sample SVF: Initialize TAP & Read IDCODE
FREQUENCY 10000000 HZ;
TRST OFF;
ENDIR IDLE;
ENDDR IDLE;
STATE RESET IDLE;
SIR 6 TDI(09);
SDR 32 TDI(00000000) TDO(03628093) MASK(0FFFFFFF);
STATE IDLE;
RUNTEST 100 TCK;
`;

export default function JtagWorkbench() {
  const [client] = useState(() => new JtagClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [tapDevices, setTapDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);

  // SVF Player state
  const [svfContent, setSvfContent] = useState(SAMPLE_SVF_TEXT);
  const [isPlayingSvf, setIsPlayingSvf] = useState(false);
  const [playProgress, setPlayProgress] = useState({ percent: 0, current: 0, total: 0, lastCmd: '' });
  const [playResult, setPlayResult] = useState(null);

  const fileInputRef = useRef(null);

  const handleConnectSimulation = () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    setTapDevices(client.detectedDevices);
  };

  const handleDisconnect = () => {
    client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setTapDevices([]);
    setPlayResult(null);
  };

  const handleScanChain = async () => {
    if (!isConnected) return;
    setIsScanning(true);
    const devices = await client.scanChain();
    setTapDevices(devices);
    setIsScanning(false);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setSvfContent(event.target.result);
      setPlayResult(null);
    };
    reader.readAsText(file);
  };

  const handleExecuteSvf = async () => {
    if (!isConnected || isPlayingSvf) return;
    try {
      setIsPlayingSvf(true);
      setPlayResult(null);
      await client.playSvf(svfContent, (p) => setPlayProgress(p));
      setPlayResult('SUCCESS: All TDO responses matched mask. CPLD / FPGA programmed.');
    } catch (err) {
      setPlayResult(`ERROR: ${err.message}`);
    } finally {
      setIsPlayingSvf(false);
    }
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      <DemoBanner demoOnly>No JTAG adapter is driven. The chain scan, pin states and SVF playback below are simulated; TDO is never checked.</DemoBanner>
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-cyan-400" />
              <span>JTAG BOUNDARY SCANNER & SVF / CPLD BITSTREAM PLAYER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Scan JTAG TAP chains, identify FPGA/CPLD IDCODEs, sample pin boundary states, and execute .svf bitstreams.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnectSimulation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 hover:bg-cyan-500/30 text-xs font-bold transition-all shadow-cyan-glow"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>CONNECT JTAG (FT2232H DEMO)</span>
              </button>
            ) : (
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold"
              >
                <span>DISCONNECT</span>
              </button>
            )}
          </div>
        </div>

        {/* TAP Scan & Chain Status */}
        <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={handleScanChain}
              disabled={!isConnected || isScanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs shadow-cyan-glow transition-all disabled:opacity-40"
            >
              <Search className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
              <span>{isScanning ? 'SCANNING CHAIN...' : 'SCAN JTAG CHAIN (READ IDCODE)'}</span>
            </button>
            <span className="text-[11px] text-slate-400">
              TAP State: <strong className="text-emerald-400">{client.tapState}</strong>
            </span>
          </div>

          <span className="text-[10px] text-slate-500">
            Detected: <strong className="text-cyan-400">{tapDevices.length}</strong> Target(s) in Chain
          </span>
        </div>
      </div>

      {/* Detected JTAG TAP Devices */}
      {tapDevices.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tapDevices.map((dev) => (
            <div key={dev.index} className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 shadow-md">
              <div className="flex items-center justify-between pb-2 border-b border-slate-850">
                <span className="font-bold text-amber-300 text-xs">
                  DEVICE #{dev.index}: {dev.mfr} {dev.part}
                </span>
                <span className="text-[10px] text-cyan-400 font-mono font-bold">
                  IDCODE: 0x{(dev.idcode ?? 0).toString(16).padStart(8, '0').toUpperCase()}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px]">
                <div>
                  <span className="text-[9px] text-slate-500 uppercase font-bold block">Silicon Family</span>
                  <span className="text-slate-300 font-semibold">{dev.family}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500 uppercase font-bold block">Package</span>
                  <span className="text-slate-300 font-semibold">{dev.package}</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500 uppercase font-bold block">Pin Count</span>
                  <span className="text-emerald-400 font-semibold">{dev.pins} Pins</span>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500 uppercase font-bold block">IR Length</span>
                  <span className="text-purple-400 font-semibold">{dev.irlen} Bits</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* SVF Player & Boundary Scan Pin Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: SVF Bitstream Player */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <FileCode className="w-4 h-4 text-purple-400" />
              <span>SVF BITSTREAM SCRIPT PLAYER</span>
            </span>
            <div className="flex items-center gap-2">
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileUpload} 
                accept=".svf,.xsvf" 
                className="hidden" 
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 text-[10px] font-bold"
              >
                <Upload className="w-3 h-3" />
                <span>LOAD .SVF FILE</span>
              </button>
            </div>
          </div>

          <textarea
            value={svfContent}
            onChange={(e) => setSvfContent(e.target.value)}
            rows={8}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-300 text-xs font-mono outline-none focus:border-cyan-500 resize-none"
            placeholder="// Paste SVF commands here..."
          />

          {isPlayingSvf && (
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] text-cyan-400 font-bold">
                <span>Programming FPGA... {playProgress.lastCmd}</span>
                <span>{playProgress.percent}%</span>
              </div>
              <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-100"
                  style={{ width: `${playProgress.percent}%` }}
                />
              </div>
            </div>
          )}

          {playResult && (
            <div className={`p-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 ${
              playResult.startsWith('SUCCESS') 
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40' 
                : 'bg-rose-500/10 text-rose-300 border-rose-500/40'
            }`}>
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{playResult}</span>
            </div>
          )}

          <button
            onClick={handleExecuteSvf}
            disabled={!isConnected || isPlayingSvf}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-500 via-indigo-600 to-purple-500 hover:from-purple-400 hover:to-indigo-500 text-white font-bold text-xs shadow-purple-glow transition-all disabled:opacity-40"
          >
            {isPlayingSvf ? 'EXECUTING SVF STREAM...' : 'EXECUTE SVF SEQUENCE'}
          </button>
        </div>

        {/* Right: Boundary Scan Pin State Matrix */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-emerald-400" />
              <span>BOUNDARY SCAN PIN STATES (SAMPLE / EXTEST)</span>
            </span>
            <span className="text-[10px] text-slate-500">Live Pin Levels</span>
          </div>

          <p className="text-[11px] text-slate-400">
            Non-intrusively sample physical I/O pads across the BGA/QFP package without halting firmware:
          </p>

          <div className="grid grid-cols-6 sm:grid-cols-8 gap-1.5 max-h-56 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-slate-800">
            {client.pins.slice(0, 48).map((pin) => {
              let bg = 'bg-slate-900 text-slate-400 border-slate-800';
              if (pin.state === 'HIGH') bg = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
              else if (pin.state === 'VCC_3V3') bg = 'bg-amber-500/20 text-amber-300 border-amber-500/40';
              else if (pin.state === 'GND') bg = 'bg-slate-800 text-slate-500 border-slate-700';

              return (
                <div key={pin.pinNumber} className={`p-1 rounded text-center border text-[9px] font-mono ${bg}`}>
                  <span className="block font-bold">P{pin.pinNumber}</span>
                  <span className="block text-[8px] opacity-80">{pin.state === 'HIGH' ? '1' : pin.state === 'LOW' ? '0' : pin.state}</span>
                </div>
              );
            })}
          </div>

          <div className="text-[10px] text-slate-500 flex items-center justify-between pt-1">
            <span>Showing first 48 pins of 144</span>
            <span className="text-emerald-400 font-bold">● Green = Logic High</span>
          </div>
        </div>
      </div>
    </div>
  );
}
