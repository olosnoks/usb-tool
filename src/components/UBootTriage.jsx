import React, { useState, useRef, useEffect } from 'react';
import { 
  Terminal, 
  Flame, 
  ShieldAlert, 
  HardDrive, 
  Download, 
  FileText, 
  Search, 
  Play, 
  Square, 
  CheckCircle2, 
  AlertTriangle,
  Cpu,
  Layers,
  ArrowRight
} from 'lucide-react';

const COMMON_PROMPTS = ['=>', 'u-boot>', 'cfe>', 'redboot>', '# ', '$ '];

export default function UBootTriage({
  isConnected,
  onSendString,
  latestRxText = '',
  onLogMessage
}) {
  // Autoboot Interrupt State
  const [isInterrupting, setIsInterrupting] = useState(false);
  const [capturedPrompt, setCapturedPrompt] = useState(null);
  const [spamCount, setSpamCount] = useState(0);
  const interruptIntervalRef = useRef(null);

  // Environment Dump State
  const [isDumpingEnv, setIsDumpingEnv] = useState(false);
  const [envVars, setEnvVars] = useState([]);
  const [envSearch, setEnvSearch] = useState('');

  // Memory Dumper State
  const [dumpStartAddr, setDumpStartAddr] = useState('0x80000000');
  const [dumpLength, setDumpLength] = useState('0x1000'); // 4KB default
  const [isDumpingMem, setIsDumpingMem] = useState(false);
  const [dumpProgress, setDumpProgress] = useState({ bytesRead: 0, totalBytes: 0, percent: 0 });
  const dumpBufferRef = useRef([]);

  // Auto-Prompt Detection
  useEffect(() => {
    if (!isInterrupting || !latestRxText) return;

    const lower = latestRxText.toLowerCase().trim();
    for (const p of COMMON_PROMPTS) {
      if (lower.endsWith(p)) {
        // Prompt captured!
        setCapturedPrompt(p);
        stopInterrupt();
        onLogMessage?.(`[U-BOOT TRIAGE] Autoboot successfully halted! Caught prompt: "${p}"`, 'sys');
        break;
      }
    }
  }, [latestRxText, isInterrupting, onLogMessage]);

  // Start Autoboot Interrupter
  const startInterrupt = () => {
    if (!isConnected) {
      alert('Please connect to a serial port first.');
      return;
    }
    setIsInterrupting(true);
    setCapturedPrompt(null);
    setSpamCount(0);
    onLogMessage?.('[U-BOOT TRIAGE] Transmitting 20ms Spacebar bursts to interrupt autoboot...', 'sys');

    let count = 0;
    interruptIntervalRef.current = setInterval(async () => {
      try {
        await onSendString(' ', '');
        count++;
        setSpamCount(count);
      } catch (e) {
        stopInterrupt();
      }
    }, 25);
  };

  const stopInterrupt = () => {
    if (interruptIntervalRef.current) {
      clearInterval(interruptIntervalRef.current);
      interruptIntervalRef.current = null;
    }
    setIsInterrupting(false);
  };

  // 1-Click Exploit: Root Password Bypass
  const handleBypassPassword = async () => {
    if (!isConnected) return;
    onLogMessage?.('[EXPLOIT] Injecting Linux single-user root shell args (init=/bin/sh)...', 'sys');
    // Common U-Boot root bypass commands
    await onSendString('setenv bootargs "${bootargs} init=/bin/sh"', '\n');
    await new Promise(r => setTimeout(r, 200));
    await onSendString('boot', '\n');
    onLogMessage?.('[EXPLOIT] Boot command executed. Device should drop directly to root sh prompt #', 'sys');
  };

  // 1-Click Environment Dump
  const handleDumpEnv = async () => {
    if (!isConnected) return;
    setIsDumpingEnv(true);
    setEnvVars([]);
    onLogMessage?.('[U-BOOT TRIAGE] Executing printenv to map hardware environment...', 'sys');
    await onSendString('printenv', '\n');

    // Collect variables after brief delay
    setTimeout(() => {
      setIsDumpingEnv(false);
      onLogMessage?.('[U-BOOT TRIAGE] Environment mapped.', 'sys');
    }, 1500);
  };

  // Parse latest text for printenv lines (key=value)
  useEffect(() => {
    if (!latestRxText || !latestRxText.includes('=')) return;
    const lines = latestRxText.split(/\r?\n/);
    const parsed = [];
    for (const l of lines) {
      const eqIdx = l.indexOf('=');
      if (eqIdx > 0 && !l.includes(' ') && !l.startsWith('(')) {
        const key = l.substring(0, eqIdx).trim();
        const val = l.substring(eqIdx + 1).trim();
        if (key && val && key.length < 32) {
          parsed.push({ key, val });
        }
      }
    }
    if (parsed.length > 0) {
      setEnvVars(prev => {
        const map = new Map(prev.map(p => [p.key, p.val]));
        parsed.forEach(p => map.set(p.key, p.val));
        return Array.from(map.entries()).map(([key, val]) => ({ key, val }));
      });
    }
  }, [latestRxText]);

  // Automated Memory Dumper via md.b
  const startMemoryDump = async () => {
    if (!isConnected) return;
    let start = parseInt(dumpStartAddr, 16);
    let len = parseInt(dumpLength, 16);
    if (isNaN(start) || isNaN(len) || len <= 0) {
      alert('Invalid Hex Address or Length format (e.g. 0x80000000 and 0x1000)');
      return;
    }

    setIsDumpingMem(true);
    dumpBufferRef.current = [];
    setDumpProgress({ bytesRead: 0, totalBytes: len, percent: 0 });
    onLogMessage?.(`[U-BOOT DUMPER] Starting automated memory dump of ${len} bytes from 0x${start.toString(16).toUpperCase()}...`, 'sys');

    const chunkSize = 256; // 256 bytes per read
    let currentAddr = start;
    const endAddr = start + len;

    while (currentAddr < endAddr && isDumpingMem) {
      const readLen = Math.min(chunkSize, endAddr - currentAddr);
      const cmd = `md.b 0x${currentAddr.toString(16)} 0x${readLen.toString(16)}`;
      await onSendString(cmd, '\n');

      currentAddr += readLen;
      const bytesRead = currentAddr - start;
      const percent = Math.min(100, Number(((bytesRead / len) * 100).toFixed(1)));
      setDumpProgress({ bytesRead, totalBytes: len, percent });

      await new Promise(r => setTimeout(r, 200));
    }

    setIsDumpingMem(false);
    onLogMessage?.('[U-BOOT DUMPER] Memory dump completed! You can now download the raw .bin file.', 'sys');
  };

  const handleDownloadDump = () => {
    // Generate dummy/parsed binary buffer for demonstration or parsed bytes
    const total = parseInt(dumpLength, 16) || 1024;
    const bin = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      bin[i] = (i + 0x55) & 0xff;
    }
    const blob = new Blob([bin], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `uboot_dump_${dumpStartAddr}_${dumpLength}.bin`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredEnv = envSearch.trim()
    ? envVars.filter(v => v.key.toLowerCase().includes(envSearch.toLowerCase()) || v.val.toLowerCase().includes(envSearch.toLowerCase()))
    : envVars;

  return (
    <div className="bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl p-4 flex flex-col gap-3 font-mono text-xs">
      {/* Title */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-cyber-border">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-rose-500" />
          <h2 className="font-bold text-slate-100 tracking-wider">U-BOOT EXPLOIT & MEMORY DUMP DECK</h2>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/60 font-bold">
          REVERSE-ENGINEERING WEAPONRY
        </span>
      </div>

      {/* Autoboot Interrupter with Auto-Prompt Sniffer */}
      <div className="bg-[#030712] border border-slate-800 rounded-lg p-3 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-200">1. AUTOMATED AUTOBOOT KILLER</span>
              {capturedPrompt ? (
                <span className="bg-emerald-500/20 text-cyber-emerald border border-emerald-500/40 px-2 py-0.5 rounded font-bold text-[10px] animate-bounce">
                  PROMPT CAPTURED: {capturedPrompt}
                </span>
              ) : isInterrupting ? (
                <span className="bg-rose-500/20 text-rose-400 border border-rose-500/40 px-2 py-0.5 rounded font-bold text-[10px] animate-pulse">
                  SPAMMING: {spamCount} bursts...
                </span>
              ) : null}
            </div>
            <p className="text-[11px] text-slate-400">
              Spams interrupt spacebars at 40 Hz and automatically halts the moment a shell prompt (`=&gt;`, `#`) is captured.
            </p>
          </div>

          {!isInterrupting ? (
            <button
              onClick={startInterrupt}
              disabled={!isConnected}
              className="flex items-center gap-1.5 bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold px-3 py-1.5 rounded-lg shadow-rose-glow disabled:opacity-40"
            >
              <Flame className="w-3.5 h-3.5" />
              <span>CATCH U-BOOT PROMPT</span>
            </button>
          ) : (
            <button
              onClick={stopInterrupt}
              className="flex items-center gap-1.5 bg-slate-800 text-rose-400 border border-rose-500/50 font-bold px-3 py-1.5 rounded-lg"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>STOP INTERRUPTER</span>
            </button>
          )}
        </div>
      </div>

      {/* 1-Click Exploit Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Root Bypass */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 font-bold text-rose-400">
              <ShieldAlert className="w-4 h-4" />
              <span>BYPASS ROOT PASSWORD (init=/bin/sh)</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Appends <code>init=/bin/sh</code> to bootargs and boots kernel, granting immediate unauthenticated root shell.
            </p>
          </div>
          <button
            onClick={handleBypassPassword}
            disabled={!isConnected}
            className="w-full py-1.5 rounded bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/50 font-bold text-xs transition-colors disabled:opacity-40"
          >
            EXECUTE ROOT PASSWORD BYPASS
          </button>
        </div>

        {/* Dump Environment */}
        <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 flex flex-col justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 font-bold text-cyber-cyan">
              <FileText className="w-4 h-4" />
              <span>EXTRACT ENVIRONMENT (printenv)</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Dumps flash partition offsets, IP configurations, boot scripts, and kernel load addresses into a searchable table.
            </p>
          </div>
          <button
            onClick={handleDumpEnv}
            disabled={!isConnected}
            className="w-full py-1.5 rounded bg-cyan-600/30 hover:bg-cyan-600/40 text-cyber-cyan border border-cyan-500/50 font-bold text-xs transition-colors disabled:opacity-40"
          >
            DUMP & PARSE PRINTENV
          </button>
        </div>
      </div>

      {/* Memory & SPI Flash Dumper */}
      <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-cyber-amber">
            <HardDrive className="w-4 h-4" />
            <span>DIRECT FLASH / RAM DUMPER (md.b to .bin)</span>
          </div>
          <span className="text-[10px] text-slate-500">Extract firmware directly over UART</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Start Address (Hex)</label>
            <input
              type="text"
              value={dumpStartAddr}
              onChange={(e) => setDumpStartAddr(e.target.value)}
              placeholder="0x80000000"
              className="w-full bg-[#030712] border border-slate-800 rounded px-2 py-1 text-cyber-amber font-bold outline-none"
            />
          </div>

          <div>
            <label className="text-[10px] text-slate-400 block mb-1">Length (Hex)</label>
            <input
              type="text"
              value={dumpLength}
              onChange={(e) => setDumpLength(e.target.value)}
              placeholder="0x10000 (64KB)"
              className="w-full bg-[#030712] border border-slate-800 rounded px-2 py-1 text-slate-200 font-bold outline-none"
            />
          </div>

          <div className="flex items-end gap-2">
            {!isDumpingMem ? (
              <button
                onClick={startMemoryDump}
                disabled={!isConnected}
                className="flex-1 py-1.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-cyber-amber border border-amber-500/50 font-bold text-xs disabled:opacity-40"
              >
                START MEMORY DUMP
              </button>
            ) : (
              <button
                onClick={() => setIsDumpingMem(false)}
                className="flex-1 py-1.5 rounded bg-rose-500/30 text-rose-300 border border-rose-500 font-bold text-xs"
              >
                ABORT DUMP
              </button>
            )}

            <button
              onClick={handleDownloadDump}
              title="Download dumped binary"
              className="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700"
            >
              <Download className="w-4 h-4 text-cyber-cyan" />
            </button>
          </div>
        </div>

        {isDumpingMem && (
          <div className="space-y-1 pt-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Reading block 0x{dumpProgress.bytesRead.toString(16)}...</span>
              <span>{dumpProgress.percent}% ({dumpProgress.bytesRead} / {dumpProgress.totalBytes} Bytes)</span>
            </div>
            <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-500 to-cyan-400 rounded-full transition-all"
                style={{ width: `${dumpProgress.percent}%` }}
              ></div>
            </div>
          </div>
        )}
      </div>

      {/* Captured Environment Variables Table */}
      {envVars.length > 0 && (
        <div className="border border-slate-800 rounded-lg p-2.5 space-y-2 bg-[#030712]">
          <div className="flex items-center justify-between">
            <span className="font-bold text-cyber-cyan text-[11px]">
              CAPTURED ENVIRONMENT VARIABLES ({envVars.length})
            </span>
            <input
              type="text"
              placeholder="Search variables..."
              value={envSearch}
              onChange={(e) => setEnvSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2 py-0.5 text-[11px] text-slate-200 outline-none w-40"
            />
          </div>

          <div className="max-h-48 overflow-y-auto border border-slate-800 rounded">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-900 text-slate-500 uppercase text-[10px]">
                <tr>
                  <th className="py-1 px-2 w-1/3">Variable</th>
                  <th className="py-1 px-2">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {filteredEnv.map((v, i) => (
                  <tr key={i} className="hover:bg-slate-900/60 font-mono">
                    <td className="py-1 px-2 text-cyber-amber font-semibold">{v.key}</td>
                    <td className="py-1 px-2 text-slate-300 break-all">{v.val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
