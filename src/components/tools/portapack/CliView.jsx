// "cli" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { buildTransferCommand, buildSweepCommand, captureBytes } from '../../../utils/hackrfCommands';

export default function CliView({
  state,
  cliInput,
  driver,
  handleSendCli,
  logContainerRef,
  logs,
  setCliInput
}) {
  const [secs, setSecs] = useState(10);
  const [sweepStart, setSweepStart] = useState(88);
  const [sweepStop, setSweepStop] = useState(108);
  const [binKhz, setBinKhz] = useState(100);
  const [copied, setCopied] = useState('');
  const st = state || {};
  const xfer = buildTransferCommand({ freqHz: st.frequency, sampleRate: st.sampleRate, lna: st.lnaGain, vga: st.vgaGain, amp: !!st.amp, seconds: secs });
  const sweep = buildSweepCommand({ startMHz: sweepStart, stopMHz: sweepStop, binWidthHz: binKhz * 1000, lna: st.lnaGain, vga: st.vgaGain, amp: !!st.amp });
  const copy = async (id, text) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(''), 1500); } catch (_) { setCopied('failed'); }
  };
  const field = 'bg-slate-900 border border-slate-700 text-slate-200 px-1.5 py-0.5 rounded text-xs w-16';
  return (
    <div className="space-y-2 flex-1 flex flex-col">
      <div 
        ref={logContainerRef}
        className="flex-1 bg-slate-950 border border-slate-800 rounded-lg p-2 font-mono text-xs overflow-y-auto max-h-56 space-y-1"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-8">
            No activity yet. Connect a HackRF (WebUSB) or a PortaPack console (serial).
          </div>
        ) : (
          logs.map((l, i) => (
            <div 
              key={i} 
              className={`leading-relaxed ${
                l.type === 'error' ? 'text-rose-400 font-bold' :
                l.type === 'warning' ? 'text-amber-400' :
                l.type === 'success' ? 'text-emerald-400' :
                l.type === 'sent' ? 'text-cyan-400' :
                'text-slate-300'
              }`}
            >
              <span className="text-slate-600 mr-2">[{l.time}]</span>
              {l.text}
            </div>
          ))
        )}
      </div>

      {/* Command Input Bar */}
      <form onSubmit={handleSendCli} className="flex gap-2">
        <input
          type="text"
          value={cliInput}
          onChange={(e) => setCliInput(e.target.value)}
          placeholder="HackRF: freq 433920000 · lna 32 · vga 20 · amp 1 · rate 8000000 · agc on   |   Mayhem serial: info, applist, appstart <name>, setfreq <Hz>"
          className="flex-1 bg-slate-950 border border-slate-800 text-slate-100 font-mono px-3 py-1.5 rounded-lg text-xs focus:outline-none focus:border-purple-500"
        />
        <button
          type="submit"
          className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-bold rounded-lg transition"
        >
          SEND
        </button>
      </form>

      {/* Quick CLI actions */}
      <div className="flex flex-wrap gap-1.5">
        {[
          { label: 'version', cmd: 'version' },
          { label: 'amp 1', cmd: 'amp 1' },
          { label: 'amp 0', cmd: 'amp 0' },
          { label: 'agc on', cmd: 'agc on' },
          { label: 'rate 2000000', cmd: 'rate 2000000' },
          { label: 'info (serial)', cmd: 'info' },
          { label: 'applist (serial)', cmd: 'applist' },
          { label: 'reboot (serial)', cmd: 'reboot' },
          { label: 'dfu (serial)', cmd: 'dfu' }
        ].map(b => (
          <button
            key={b.label}
            onClick={() => driver.sendCommand(b.cmd)}
            className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[10px] font-mono transition"
          >
            {b.label}
          </button>
        ))}
      </div>
      <details className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs font-mono">
        <summary className="cursor-pointer text-slate-300">Command-line export (hackrf_transfer / hackrf_sweep)</summary>
        <p className="text-[11px] text-slate-500 mt-1.5">
          Builds commands for the official HackRF host tools from the current tuner settings. They are text only: copy and run them on a PC with the HackRF tools installed. This page does not run them.
        </p>
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-slate-400">
            <span>Record</span>
            <label>seconds <input type="number" min="0" max="3600" value={secs} onChange={(e) => setSecs(Number(e.target.value))} className={field} /></label>
            <span className="text-slate-500">about {(captureBytes(st.sampleRate || 0, secs) / 1048576).toFixed(0)} MB</span>
          </div>
          <div className="flex items-start gap-1.5">
            <code className="flex-1 break-all bg-slate-900 border border-slate-800 rounded px-2 py-1 text-cyan-300" data-testid="xfer-cmd">{xfer}</code>
            <button type="button" onClick={() => copy('x', xfer)} title="Copy command" aria-label="Copy hackrf_transfer command" className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300"><Copy className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-slate-400">
            <span>Sweep</span>
            <label>start MHz <input type="number" value={sweepStart} onChange={(e) => setSweepStart(Number(e.target.value))} className={field} /></label>
            <label>stop MHz <input type="number" value={sweepStop} onChange={(e) => setSweepStop(Number(e.target.value))} className={field} /></label>
            <label>bin kHz <input type="number" min="3" value={binKhz} onChange={(e) => setBinKhz(Number(e.target.value))} className={field} /></label>
          </div>
          <div className="flex items-start gap-1.5">
            <code className="flex-1 break-all bg-slate-900 border border-slate-800 rounded px-2 py-1 text-cyan-300" data-testid="sweep-cmd">{sweep}</code>
            <button type="button" onClick={() => copy('s', sweep)} title="Copy command" aria-label="Copy hackrf_sweep command" className="p-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300"><Copy className="w-3.5 h-3.5" /></button>
          </div>
        </div>
        {copied && <div role="status" className="mt-1 text-[11px] text-slate-400">{copied === 'failed' ? 'Clipboard not available; select and copy the text.' : 'Copied.'}</div>}
      </details>
    </div>
  );
}
