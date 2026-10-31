import React, { useState } from 'react';
import { 
  Terminal as TerminalIcon, 
  Binary, 
  Radar, 
  Zap, 
  Send, 
  Search, 
  Trash2, 
  Download, 
  SlidersHorizontal,
  ChevronDown,
  Sparkles,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import StreamConsole from '../StreamConsole';
import HexViewer from '../common/HexViewer';
import FrameInjector from '../FrameInjector';
import { CANDIDATE_BAUD_RATES, evaluateSample } from '../../utils/baudScanner';

export default function TerminalTab() {
  const {
    isConnected,
    entries,
    hexByteStream,
    sendString,
    sendRawBytes,
    addLog,
    clearLogs,
    clearHexStream,
    baudRate,
    setBaudRate,
    runBaudScan
  } = useSerial();

  // Sub-panel selection
  const [activeSidePanel, setActiveSidePanel] = useState('hex'); // 'hex' | 'hunter' | 'injector' | 'none'
  const [hunterResults, setHunterResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [currentBaudTesting, setCurrentBaudTesting] = useState(null);
  const [probeMode, setProbeMode] = useState('active');

  const startBaudHunt = async () => {
    if (!isConnected) {
      alert('Please connect to a serial port first to run the Baud Rate Hunter.');
      return;
    }

    setIsScanning(true);
    setHunterResults([]);
    addLog('[BAUD HUNTER] Starting automated scan across 9 candidate baud rates...', 'sys');

    const results = [];
    for (const baud of CANDIDATE_BAUD_RATES) {
      setCurrentBaudTesting(baud);
      try {
        const sampleBytes = await runBaudScan(baud, probeMode === 'active');
        const evalResult = evaluateSample(sampleBytes);
        const entry = {
          baud,
          byteCount: sampleBytes ? sampleBytes.length : 0,
          printableRatio: evalResult.printableRatio,
          entropy: evalResult.entropy,
          confidence: evalResult.confidence,
          verdict: evalResult.verdict,
          previewText: evalResult.previewText
        };
        results.push(entry);
        setHunterResults([...results]);
      } catch (err) {
        console.error(`Baud scan error at ${baud}:`, err);
      }
    }

    setIsScanning(false);
    setCurrentBaudTesting(null);
    addLog('[BAUD HUNTER] Scan cycle complete.', 'sys');
  };

  return (
    <div className="flex flex-col gap-3 font-mono">
      {/* View Mode Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#090e1a] p-2 rounded-xl border border-cyber-border text-xs">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-4 h-4 text-cyan-400" />
          <span className="font-bold text-slate-100">DIAGNOSTIC TERMINAL WORKSPACE</span>
          <span className="text-[10px] text-slate-500">|</span>
          <span className="text-slate-400 text-[11px] hidden sm:inline">
            Active: <strong className="text-amber-400">{baudRate} bps</strong>
          </span>
        </div>

        {/* Panel Switcher Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'hex' ? 'none' : 'hex')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition-all ${
              activeSidePanel === 'hex' 
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-cyan-glow' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Binary className="w-3.5 h-3.5" />
            <span>Hex Stream</span>
          </button>

          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'hunter' ? 'none' : 'hunter')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition-all ${
              activeSidePanel === 'hunter' 
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-amber-glow' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Radar className="w-3.5 h-3.5" />
            <span>Baud Hunter</span>
          </button>

          <button
            onClick={() => setActiveSidePanel(activeSidePanel === 'injector' ? 'none' : 'injector')}
            className={`flex items-center gap-1 px-2.5 py-1 rounded-md font-bold transition-all ${
              activeSidePanel === 'injector' 
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-emerald-glow' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Protocol Injector</span>
          </button>
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className={`grid gap-3 transition-all ${
        activeSidePanel !== 'none' ? 'grid-cols-1 lg:grid-cols-12' : 'grid-cols-1'
      }`}>
        {/* Serial Log Terminal */}
        <div className={activeSidePanel !== 'none' ? 'lg:col-span-7 xl:col-span-8' : 'w-full'}>
          <StreamConsole
            entries={entries}
            onSend={(text, lineEnding) => sendString(text, lineEnding)}
            onClear={clearLogs}
            isConnected={isConnected}
          />
        </div>

        {/* Secondary Side Panel */}
        {activeSidePanel !== 'none' && (
          <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-3">
            {/* Hex Stream Viewer */}
            {activeSidePanel === 'hex' && (
              <div className="flex flex-col gap-2">
                <HexViewer
                  byteStream={hexByteStream}
                  onClear={clearHexStream}
                  maxDisplayBytes={1536}
                />
              </div>
            )}

            {/* Baud Rate Hunter */}
            {activeSidePanel === 'hunter' && (
              <div className="bg-[#030712] border border-slate-800 rounded-xl p-3.5 flex flex-col gap-3 shadow-xl">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Radar className="w-4 h-4 text-amber-400" />
                    <h3 className="font-bold text-slate-100 text-xs">AUTOMATED BAUD HUNTER</h3>
                  </div>
                  <div className="flex items-center gap-1 text-[10px]">
                    <span className="text-slate-500">PROBE:</span>
                    <button
                      onClick={() => setProbeMode(probeMode === 'active' ? 'passive' : 'active')}
                      className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-amber-300 font-bold"
                    >
                      {probeMode === 'active' ? 'Active (\\r\\n)' : 'Passive (Listen)'}
                    </button>
                  </div>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Automatically cycles through 9 candidate baud rates, samples live UART bytes, and computes entropy & printable ASCII ratio to pinpoint the correct baud.
                </p>

                <div className="flex items-center gap-2">
                  <button
                    onClick={startBaudHunt}
                    disabled={isScanning || !isConnected}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow disabled:opacity-50 transition-all"
                  >
                    <Radar className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                    <span>{isScanning ? `SCANNING ${currentBaudTesting || ''}...` : 'RUN BAUD SCAN'}</span>
                  </button>
                </div>

                {/* Results Table */}
                {hunterResults.length > 0 && (
                  <div className="border border-slate-800 rounded-lg overflow-hidden text-[11px]">
                    <table className="w-full text-left">
                      <thead className="bg-slate-900/80 text-slate-400 text-[10px] uppercase font-bold">
                        <tr>
                          <th className="py-1 px-2">Baud</th>
                          <th className="py-1 px-2">Confidence</th>
                          <th className="py-1 px-2">Verdict</th>
                          <th className="py-1 px-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {hunterResults.map((r) => (
                          <tr key={r.baud} className="hover:bg-slate-900/40">
                            <td className="py-1.5 px-2 font-bold text-slate-200">{r.baud}</td>
                            <td className="py-1.5 px-2">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                r.confidence > 70 
                                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/40' 
                                  : r.confidence > 35 
                                  ? 'bg-amber-950 text-amber-400 border border-amber-500/40' 
                                  : 'text-slate-500'
                              }`}>
                                {r.confidence}%
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-slate-400 text-[10px]">{r.verdict}</td>
                            <td className="py-1.5 px-2 text-right">
                              <button
                                onClick={() => setBaudRate(r.baud)}
                                className="px-2 py-0.5 rounded bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[10px] font-bold"
                              >
                                Apply
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Protocol Injector */}
            {activeSidePanel === 'injector' && (
              <FrameInjector
                isConnected={isConnected}
                onSendRawBytes={sendRawBytes}
                onLogMessage={addLog}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
