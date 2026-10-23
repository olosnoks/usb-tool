import React, { useState } from 'react';
import { 
  Cpu, 
  RotateCcw, 
  Upload, 
  CheckCircle2, 
  AlertTriangle, 
  Sparkles, 
  Layers, 
  ShieldAlert, 
  Check, 
  Sliders, 
  FileCode,
  Zap
} from 'lucide-react';
import { 
  AvrIspClient, 
  AVR_CHIP_DATABASE 
} from '../../utils/avrIspDriver';
import StatusBadge from '../common/StatusBadge';

export default function AvrIspWorkbench() {
  const [client] = useState(() => new AvrIspClient(console.log));
  const [isConnected, setIsConnected] = useState(false);
  const [isSimulated, setIsSimulated] = useState(false);
  const [chipInfo, setChipInfo] = useState(null);

  // Fuse configuration state
  const [fuses, setFuses] = useState({
    lfuse: 0xFF,
    hfuse: 0xDE,
    efuse: 0xFD,
    lock: 0x0F
  });

  const [isBurningBootloader, setIsBurningBootloader] = useState(false);
  const [bootloaderProgress, setBootloaderProgress] = useState(0);
  const [burnResult, setBurnResult] = useState('');

  const handleConnectSimulation = async () => {
    client.connectSimulation();
    setIsConnected(true);
    setIsSimulated(true);
    const chip = await client.readSignature();
    setChipInfo(chip);
    const f = await client.readFuses();
    setFuses(f);
  };

  const handleDisconnect = () => {
    client.disconnect();
    setIsConnected(false);
    setIsSimulated(false);
    setChipInfo(null);
    setBurnResult('');
  };

  const handleBurnOptiboot = async () => {
    if (!isConnected || isBurningBootloader) return;
    try {
      setIsBurningBootloader(true);
      setBurnResult('');
      await client.burnBootloader((p) => setBootloaderProgress(p));
      setBurnResult('SUCCESS: Optiboot 8.0 burned and verified! 115200 bps bootloader active.');
    } catch (err) {
      setBurnResult(`ERROR: ${err.message}`);
    } finally {
      setIsBurningBootloader(false);
    }
  };

  const handleUpdateFuse = (type, valHex) => {
    const val = parseInt(valHex, 16);
    if (isNaN(val)) return;
    const updated = { ...fuses, [type]: val & 0xFF };
    setFuses(updated);
    client.writeFuses(updated);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Controller Bar */}
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <Cpu className="w-4 h-4 text-amber-400" />
              <span>AVR & MICROCHIP UPDI / ISP BOOTLOADER & FUSE PROGRAMMER</span>
            </h2>
            <p className="text-[11px] text-slate-400">
              Recover bricked Arduino Uno/Mega/Nano boards, burn Optiboot bootloader, and configure clock/BOD fuses.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {!isConnected ? (
              <button
                onClick={handleConnectSimulation}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/50 hover:bg-amber-500/30 text-xs font-bold transition-all shadow-amber-glow"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>CONNECT AVR ISP (ATMEGA328P DEMO)</span>
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

        {/* Chip Identification Bar */}
        {isConnected && chipInfo && (
          <div className="pt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Target Microcontroller</span>
              <span className="font-extrabold text-amber-300 text-sm">{chipInfo.name}</span>
              <span className="text-[10px] text-slate-400 block">{chipInfo.family}</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Signature (0x30)</span>
              <span className="font-extrabold text-cyan-300 text-sm font-mono">
                0x{chipInfo.signature.toString(16).toUpperCase()}
              </span>
              <span className="text-[10px] text-slate-400 block">3-Byte Hardware ID</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Flash Memory</span>
              <span className="font-extrabold text-emerald-300 text-sm">
                {(chipInfo.flashSize / 1024).toFixed(0)} KB
              </span>
              <span className="text-[10px] text-slate-400 block">EEPROM: {chipInfo.eepromSize}B</span>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">ISP Programmer</span>
              <span className="font-extrabold text-purple-300 text-sm">STK500v1 / USBasp</span>
              <span className="text-[10px] text-slate-400 block">Virtual Target</span>
            </div>
          </div>
        )}
      </div>

      {/* Fuse Calculator & Optiboot Burner */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Interactive Fuse Bit Editor */}
        <div className="lg:col-span-2 bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-cyan-400" />
              <span>AVR FUSE BIT CALCULATOR & CONFIGURATION MATRIX</span>
            </span>
            <span className="text-[10px] text-slate-500">Active Register Fuses</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Low Fuse */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">LOW FUSE (LFUSE)</span>
              <div className="text-xl font-mono font-extrabold text-amber-300">
                0x{fuses.lfuse.toString(16).padStart(2, '0').toUpperCase()}
              </div>
              <p className="text-[10px] text-slate-400">
                Clock select: 16MHz External Crystal (CKSEL=1111, SUT=11)
              </p>
              <input
                type="text"
                value={`0x${fuses.lfuse.toString(16).padStart(2, '0').toUpperCase()}`}
                onChange={(e) => handleUpdateFuse('lfuse', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono text-xs"
              />
            </div>

            {/* High Fuse */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">HIGH FUSE (HFUSE)</span>
              <div className="text-xl font-mono font-extrabold text-cyan-300">
                0x{fuses.hfuse.toString(16).padStart(2, '0').toUpperCase()}
              </div>
              <p className="text-[10px] text-slate-400">
                Bootloader size: 512B (BOOTSZ=11), SPI Programming enabled (SPIEN=0)
              </p>
              <input
                type="text"
                value={`0x${fuses.hfuse.toString(16).padStart(2, '0').toUpperCase()}`}
                onChange={(e) => handleUpdateFuse('hfuse', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono text-xs"
              />
            </div>

            {/* Extended Fuse */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">EXTENDED (EFUSE)</span>
              <div className="text-xl font-mono font-extrabold text-emerald-300">
                0x{fuses.efuse.toString(16).padStart(2, '0').toUpperCase()}
              </div>
              <p className="text-[10px] text-slate-400">
                Brown-out detector: 2.7V trigger level (BODLEVEL=101)
              </p>
              <input
                type="text"
                value={`0x${fuses.efuse.toString(16).padStart(2, '0').toUpperCase()}`}
                onChange={(e) => handleUpdateFuse('efuse', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono text-xs"
              />
            </div>

            {/* Lock Bits */}
            <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 space-y-2">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">LOCK BITS</span>
              <div className="text-xl font-mono font-extrabold text-purple-300">
                0x{fuses.lock.toString(16).padStart(2, '0').toUpperCase()}
              </div>
              <p className="text-[10px] text-slate-400">
                Memory protection: Unlocked R/W for Flash & Bootloader
              </p>
              <input
                type="text"
                value={`0x${fuses.lock.toString(16).padStart(2, '0').toUpperCase()}`}
                onChange={(e) => handleUpdateFuse('lock', e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded px-2 py-1 text-slate-200 font-mono text-xs"
              />
            </div>
          </div>
        </div>

        {/* Right: 1-Click Optiboot Burner */}
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>1-CLICK BOOTLOADER BURN</span>
              </span>
              <span className="text-[10px] text-emerald-400 font-bold">Optiboot 8.0</span>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed pt-2">
              Burn the high-speed Optiboot bootloader directly into upper flash (0x7E00). Restores responsiveness to unresponsive or bricked clone boards.
            </p>

            {isBurningBootloader && (
              <div className="space-y-1 pt-3">
                <div className="flex justify-between text-[11px] text-amber-300 font-bold">
                  <span>Burning Optiboot...</span>
                  <span>{bootloaderProgress}%</span>
                </div>
                <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-emerald-400 transition-all duration-100"
                    style={{ width: `${bootloaderProgress}%` }}
                  />
                </div>
              </div>
            )}

            {burnResult && (
              <div className={`p-2.5 rounded-lg border text-xs font-bold flex items-center gap-2 mt-3 ${
                burnResult.startsWith('SUCCESS')
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40'
                  : 'bg-rose-500/10 text-rose-300 border-rose-500/40'
              }`}>
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{burnResult}</span>
              </div>
            )}
          </div>

          <button
            onClick={handleBurnOptiboot}
            disabled={!isConnected || isBurningBootloader}
            className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 via-amber-600 to-amber-500 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow-amber-glow transition-all disabled:opacity-40"
          >
            {isBurningBootloader ? 'PROGRAMMING BOOTLOADER...' : 'BURN OPTIBOOT BOOTLOADER'}
          </button>
        </div>
      </div>
    </div>
  );
}
