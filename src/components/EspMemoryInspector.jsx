import React, { useState } from 'react';
import { 
  Cpu, 
  Download, 
  HardDrive, 
  Play, 
  RotateCcw, 
  Sparkles, 
  Zap, 
  CheckCircle2, 
  Layers, 
  Search, 
  ShieldCheck,
  FileText
} from 'lucide-react';
import { inspectEspSilicon, dumpFlashRange, parseFlashCapacity, FLASH_MANUFACTURERS } from '../utils/espMemoryTool';

const DUMP_PRESETS = [
  {
    name: 'Bootloader Partition',
    offset: '0x00001000',
    length: 28672, // 28 KB
    description: 'First stage 2nd bootloader binary'
  },
  {
    name: 'Partition Table',
    offset: '0x00008000',
    length: 4096, // 4 KB
    description: 'Flash partition layout (app, ota, nvs)'
  },
  {
    name: 'NVS Storage (Credentials)',
    offset: '0x00009000',
    length: 20480, // 20 KB
    description: 'Non-Volatile Storage (WiFi creds, BLE keys)'
  },
  {
    name: 'Full 4MB Flash Backup',
    offset: '0x00000000',
    length: 4194304, // 4 MB
    description: 'Complete raw image backup for disaster recovery'
  }
];

export default function EspMemoryInspector({
  isConnected,
  port,
  onLogMessage
}) {
  const [siliconInfo, setSiliconInfo] = useState(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isDumping, setIsDumping] = useState(false);
  const [targetOffset, setTargetOffset] = useState('0x00009000');
  const [dumpLength, setDumpLength] = useState(20480);
  const [progress, setProgress] = useState({ percent: 0, bytesRead: 0, totalBytes: 0 });

  const handleInspectSilicon = async () => {
    if (!isConnected || !port) {
      alert('Please connect to an ESP32 serial port first.');
      return;
    }
    try {
      setIsInspecting(true);
      const info = await inspectEspSilicon(port, onLogMessage);
      setSiliconInfo(info);
    } catch (err) {
      onLogMessage?.(`[ESP RE] Inspection failed: ${err.message}`, 'sys');
    } finally {
      setIsInspecting(false);
    }
  };

  const handleStartDump = async () => {
    if (!isConnected || !port) {
      alert('Please connect to an ESP32 serial port first.');
      return;
    }
    try {
      setIsDumping(true);
      const offsetNum = parseInt(targetOffset, 16);
      await dumpFlashRange(
        port,
        offsetNum,
        Number(dumpLength),
        (percent, bytesRead, totalBytes) => {
          setProgress({ percent, bytesRead, totalBytes });
        },
        onLogMessage
      );
    } catch (err) {
      onLogMessage?.(`[DUMP ERROR] Failed: ${err.message}`, 'sys');
      alert(`Dump Error: ${err.message}`);
    } finally {
      setIsDumping(false);
    }
  };

  const applyPreset = (preset) => {
    setTargetOffset(preset.offset);
    setDumpLength(preset.length);
  };

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-cyber-amber" />
          <h2 className="font-bold text-slate-100 tracking-wider">ESP32 SILICON INSPECTION & FLASH MEMORY DUMP</h2>
        </div>

        <button
          onClick={handleInspectSilicon}
          disabled={!isConnected || isInspecting}
          className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyber-card hover:bg-slate-800 text-cyber-cyan border border-cyber-cyan/30 text-xs font-bold transition-all disabled:opacity-40"
        >
          <Search className="w-3.5 h-3.5" />
          <span>{isInspecting ? 'PROBING EFUSES...' : 'READ CHIP EFUSES'}</span>
        </button>
      </div>

      {/* Silicon Metadata Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="bg-[#030712] border border-slate-800 rounded-lg p-3">
          <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Target MAC Address</span>
          <div className="text-sm font-bold text-cyber-cyan">
            {siliconInfo?.mac || 'Click "Read Chip eFuses"'}
          </div>
        </div>

        <div className="bg-[#030712] border border-slate-800 rounded-lg p-3">
          <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Chip Architecture</span>
          <div className="text-sm font-bold text-slate-200">
            {siliconInfo?.chipFamily || 'Xtensa / RISC-V'}
          </div>
        </div>

        <div className="bg-[#030712] border border-slate-800 rounded-lg p-3">
          <span className="text-[10px] text-slate-500 uppercase font-bold block mb-1">Security Flags</span>
          <div className="text-sm font-bold text-emerald-400 flex items-center gap-1">
            <ShieldCheck className="w-4 h-4" />
            <span>Standard ROM Boot</span>
          </div>
        </div>
      </div>

      {/* Flash Backup Presets */}
      <div className="space-y-1.5 pt-1">
        <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-bold">
          Quick Backup Targets:
        </span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {DUMP_PRESETS.map((p, idx) => (
            <button
              key={idx}
              onClick={() => applyPreset(p)}
              className="text-left p-2.5 rounded-lg bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-cyber-amber transition-all group"
            >
              <div className="font-bold text-slate-200 group-hover:text-cyber-amber text-[11px] truncate">
                {p.name}
              </div>
              <div className="text-[9px] text-slate-500">{p.offset} • {(p.length / 1024).toFixed(0)} KB</div>
            </button>
          ))}
        </div>
      </div>

      {/* Custom Range & Dump Execution */}
      <div className="bg-[#030712] border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Start Offset (Hex)</label>
            <input
              type="text"
              value={targetOffset}
              onChange={(e) => setTargetOffset(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs w-32"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold block mb-0.5">Dump Size (Bytes)</label>
            <input
              type="number"
              value={dumpLength}
              onChange={(e) => setDumpLength(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 outline-none focus:border-amber-500 font-mono text-xs w-32"
            />
          </div>
        </div>

        <button
          onClick={handleStartDump}
          disabled={!isConnected || isDumping}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-bold hover:brightness-110 shadow-amber-glow transition-all disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          <span>{isDumping ? `READING FLASH (${progress.percent}%)...` : 'DUMP FLASH TO .BIN'}</span>
        </button>
      </div>

      {/* Progress Bar when Dumping */}
      {isDumping && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-400">
            <span>Reading ROM sectors...</span>
            <span>{progress.bytesRead} / {progress.totalBytes} Bytes ({progress.percent}%)</span>
          </div>
          <div className="w-full h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 to-cyber-amber transition-all duration-150"
              style={{ width: `${progress.percent}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}
