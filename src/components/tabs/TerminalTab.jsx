import React, { useState, useRef, useEffect, useMemo } from 'react';
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
  Copy,
  CheckCheck
} from 'lucide-react';
import { useSerial } from '../../context/SerialContext';
import StreamConsole from '../StreamConsole';
import HexViewer from '../common/HexViewer';
import FrameInjector from '../FrameInjector';
import TerminalEmulator from '../TerminalEmulator';
import { CANDIDATE_BAUD_RATES, runBaudHunt } from '../../utils/baudScanner';
import { sessionStats, formatBytes, parseBaudList, bestBaudResult, formatHuntReport, loadPrefs, savePrefs } from '../../utils/terminalWorkspace';

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
    runBaudScan,
    reconfigureActivePort,
    subscribeRx,
    activeBoardId
  } = useSerial();

  // Layout choices are remembered between visits.
  const [prefs] = useState(() => loadPrefs());

  // Sub-panel selection
  const [activeSidePanel, setActiveSidePanel] = useState(prefs.sidePanel); // 'hex' | 'hunter' | 'injector' | 'none'
  const [hunterResults, setHunterResults] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [currentBaudTesting, setCurrentBaudTesting] = useState(null);
  const [probeMode, setProbeMode] = useState(prefs.probeMode);
  const [customBauds, setCustomBauds] = useState(prefs.customBauds);

  // 'log' = chunk/line log view (StreamConsole); 'interactive' = keystroke passthrough terminal.
  // The emulator is mounted the first time it is opened and then kept (hidden)
  // so switching modes never drops received data.
  const [termMode, setTermMode] = useState(prefs.termMode);
  const [emulatorOpened, setEmulatorOpened] = useState(prefs.termMode === 'interactive');
  useEffect(() => {
    savePrefs({ sidePanel: activeSidePanel, termMode, probeMode, customBauds });
  }, [activeSidePanel, termMode, probeMode, customBauds]);
  const stats = useMemo(() => sessionStats(entries), [entries]);
  const [copied, setCopied] = useState(false);
  const customParsed = useMemo(() => parseBaudList(customBauds), [customBauds]);
  const candidates = customParsed.rates.length > 0 ? customParsed.rates : CANDIDATE_BAUD_RATES;
  const best = bestBaudResult(hunterResults);
  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(formatHuntReport(hunterResults));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      setHunterMsg('Could not copy to the clipboard in this browser.');
    }
  };
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const openMode = (mode) => {
    setTermMode(mode);
    if (mode === 'interactive') setEmulatorOpened(true);
  };
  const getBacklog = () => entriesRef.current.filter(e => e.type === 'rx' && e.rawBytes).map(e => e.rawBytes);

  const [hunterMsg, setHunterMsg] = useState('');
  const huntAbortRef = useRef(null);

  const stopBaudHunt = () => {
    if (huntAbortRef.current) huntAbortRef.current.aborted = true;
  };

  // Leaving the tab mid-scan aborts it; runBaudHunt then restores the original
  // baud rate and the console read loop.
  useEffect(() => () => { if (huntAbortRef.current) huntAbortRef.current.aborted = true; }, []);

  const startBaudHunt = async () => {
    if (!isConnected) {
      setHunterMsg('Connect to a serial port first to run the Baud Rate Hunter.');
      return;
    }

    const originalBaud = baudRate;
    const ctl = { aborted: false };
    huntAbortRef.current = ctl;
    setHunterMsg('');
    setIsScanning(true);
    setHunterResults([]);
    addLog(`[BAUD HUNTER] Starting automated scan across ${candidates.length} candidate baud rates...`, 'sys');

    const { aborted, restoreError } = await runBaudHunt({
      candidates,
      signal: ctl,
      scan: (baud) => runBaudScan(baud, probeMode === 'active'),
      restore: () => reconfigureActivePort({ baudRate: originalBaud }),
      onProgress: (baud) => setCurrentBaudTesting(baud),
      onResult: (_entry, all) => setHunterResults(all),
      onError: (baud, err) => console.error(`Baud scan error at ${baud}:`, err)
    });

    huntAbortRef.current = null;
    setIsScanning(false);
    setCurrentBaudTesting(null);
    if (restoreError) {
      setHunterMsg(`Scan ended but the original ${originalBaud} bps could not be restored: ${restoreError.message}. Reconnect the port.`);
    } else {
      setHunterMsg(aborted ? `Scan stopped. Restored ${originalBaud} bps.` : `Scan complete. Restored ${originalBaud} bps.`);
    }
    addLog(aborted ? '[BAUD HUNTER] Scan aborted.' : '[BAUD HUNTER] Scan cycle complete.', 'sys');
  };

  return (
    <div className="flex flex-col gap-2 font-mono">
      {/* View Mode Bar */}
      <div className="flex flex-wrap items-center gap-1.5 bg-[#090e1a] p-1.5 rounded-lg border border-cyber-border text-[11px]">
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-md border border-slate-800" role="group" aria-label="Terminal view">
          {[['log', 'Log view'], ['interactive', 'Interactive']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => openMode(id)}
              aria-pressed={termMode === id}
              className={`px-2 py-0.5 rounded font-bold transition-all ${
                termMode === id ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Panel switcher */}
        <div className="flex items-center gap-1 bg-slate-950 p-0.5 rounded-md border border-slate-800" role="group" aria-label="Side panel">
          {[
            ['hex', Binary, 'Hex Stream', 'cyan'],
            ['hunter', Radar, 'Baud Hunter', 'amber'],
            ['injector', Zap, 'Protocol Injector', 'emerald']
          ].map(([id, Icon, label, c]) => (
            <button
              key={id}
              onClick={() => setActiveSidePanel(activeSidePanel === id ? 'none' : id)}
              aria-pressed={activeSidePanel === id}
              title={label}
              className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold transition-all ${
                activeSidePanel === id
                  ? c === 'cyan' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : c === 'amber' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden @sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Live session stats (over the retained log buffer) */}
        <div
          className="ml-auto flex items-center gap-2 text-[10px] text-slate-400"
          title="Counted over the log entries currently kept in memory (the newest ~1500 chunks)"
          data-testid="terminal-stats"
        >
          <span>Baud <strong className="text-amber-400">{baudRate}</strong></span>
          <span>RX <strong className="text-cyan-300">{formatBytes(stats.rxBytes)}</strong></span>
          <span>TX <strong className="text-emerald-300">{formatBytes(stats.txBytes)}</strong></span>
          {stats.rxBps > 0 && <span className="hidden @sm:inline">~<strong className="text-slate-200">{stats.rxBps}</strong> B/s</span>}
        </div>
      </div>

      {/* Main Workspace Grid */}
      <div className={`grid gap-2 transition-all ${
        activeSidePanel !== 'none' ? 'grid-cols-1 @lg:grid-cols-12' : 'grid-cols-1'
      }`}>
        {/* Serial Log Terminal */}
        <div className={activeSidePanel !== 'none' ? '@lg:col-span-7 @xl:col-span-8' : 'w-full'}>
          <div className={termMode === 'log' ? '' : 'hidden'}>
            <StreamConsole
              entries={entries}
              onSend={(text, lineEnding) => sendString(text, lineEnding)}
              onClear={clearLogs}
              isConnected={isConnected}
              boardId={activeBoardId}
              subscribeRx={subscribeRx}
              onSendRaw={sendRawBytes}
              onSys={addLog}
            />
          </div>
          {emulatorOpened && (
            <TerminalEmulator
              visible={termMode === 'interactive'}
              subscribeRx={subscribeRx}
              boardId={activeBoardId}
              sendRawBytes={sendRawBytes}
              isConnected={isConnected}
              getBacklog={getBacklog}
            />
          )}
        </div>

        {/* Secondary Side Panel */}
        {activeSidePanel !== 'none' && (
          <div className="@lg:col-span-5 @xl:col-span-4 flex flex-col gap-2">
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
              <div className="bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-col gap-2 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-1 border-b border-slate-800 pb-1.5">
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

                <details className="text-[11px] text-slate-400">
                  <summary className="cursor-pointer text-slate-300 font-bold">How it works / candidate rates</summary>
                  <p className="mt-1 leading-relaxed">
                    Cycles through {candidates.length} candidate baud rates, samples live UART bytes, and scores the printable-ASCII ratio and Shannon entropy to suggest the right one. Active probing sends CR+LF at each rate; Passive only listens.
                  </p>
                  <label className="block mt-1.5 text-[10px] text-slate-500" htmlFor="terminal-custom-bauds">
                    Custom rates (space or comma separated; empty = defaults)
                  </label>
                  <input
                    id="terminal-custom-bauds"
                    value={customBauds}
                    onChange={(e) => setCustomBauds(e.target.value)}
                    disabled={isScanning}
                    placeholder={CANDIDATE_BAUD_RATES.join(' ')}
                    className="w-full mt-0.5 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-200 focus:outline-none focus:border-amber-500/60"
                  />
                  {customParsed.invalid.length > 0 && (
                    <p className="mt-0.5 text-rose-400">Ignored: {customParsed.invalid.join(', ')} (use whole numbers 50 to 4000000)</p>
                  )}
                </details>

                <div className="flex items-center gap-2">
                  {isScanning && (
                    <button
                      onClick={stopBaudHunt}
                      className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs"
                    >
                      STOP
                    </button>
                  )}
                  <button
                    onClick={startBaudHunt}
                    disabled={isScanning || !isConnected}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs shadow-amber-glow disabled:opacity-50 transition-all"
                  >
                    <Radar className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                    <span>{isScanning ? `SCANNING ${currentBaudTesting || ''}...` : 'RUN BAUD SCAN'}</span>
                  </button>
                </div>

                {hunterMsg && <p className="text-[11px] text-amber-300">{hunterMsg}</p>}

                {hunterResults.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {best && (
                      <button
                        onClick={() => setBaudRate(best.baud)}
                        className="px-2 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-bold"
                        title="Set the console baud rate to the highest-confidence result"
                      >
                        Apply best ({best.baud})
                      </button>
                    )}
                    <button
                      onClick={copyReport}
                      className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 font-bold"
                      title="Copy the results as a tab-separated table"
                    >
                      {copied ? <CheckCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copied' : 'Copy report'}</span>
                    </button>
                  </div>
                )}

                {/* Results Table */}
                {hunterResults.length > 0 && (
                  <div className="border border-slate-800 rounded-lg overflow-hidden text-[11px]">
                    <table className="w-full text-left">
                      <thead className="bg-slate-900/80 text-slate-400 text-[10px] uppercase font-bold">
                        <tr>
                          <th className="py-1 px-2">Baud</th>
                          <th className="py-1 px-2">Confidence</th>
                          <th className="py-1 px-2 hidden @sm:table-cell">Verdict</th>
                          <th className="py-1 px-2 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 font-mono">
                        {hunterResults.map((r) => (
                          <tr key={r.baud} className="hover:bg-slate-900/40">
                            <td className="py-1 px-2 font-bold text-slate-200">{r.baud}</td>
                            <td className="py-1 px-2">
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
                            <td className="py-1 px-2 text-slate-400 text-[10px] hidden @sm:table-cell" title={r.previewText}>{r.verdict}</td>
                            <td className="py-1 px-2 text-right">
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
