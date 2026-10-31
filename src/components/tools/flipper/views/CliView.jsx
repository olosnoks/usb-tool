// "cli" view of the Flipper Zero workbench (FlipperWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.
import { Terminal as TerminalIcon } from 'lucide-react';

export default function CliView({
  cliInput,
  driver,
  handleSendCli,
  logContainerRef,
  logs,
  setCliInput
}) {
  return (
    <div className="bg-[#171920] border border-[#2b303c] rounded-3xl p-6 shadow-2xl flex flex-col space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-[#232733]">
        <div className="flex items-center gap-2 font-sans">
          <TerminalIcon className="w-4 h-4 text-[#fe8a2c]" />
          <span className="font-bold text-white text-sm">FLIPPER SERIAL CLI SHELL</span>
        </div>

        {/* Quick CLI actions */}
        <div className="flex flex-wrap gap-1.5">
          {['device_info', 'power info', 'storage info /ext', 'vibro 1', 'vibro 0', 'led r 255', 'led off', 'uptime', 'date'].map(cmd => (
            <button
              key={cmd}
              onClick={() => driver.executeCommand(cmd)}
              className="px-2 py-1 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded text-[10px] font-mono transition"
            >
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {/* Log Output Box */}
      <div 
        ref={logContainerRef}
        className="bg-[#0e1015] border border-[#232733] rounded-2xl p-4 h-96 overflow-y-auto font-mono text-[11px] space-y-1 select-text"
      >
        {logs.map((log, idx) => (
          <div key={idx} className="flex gap-2">
            <span className="text-slate-600 select-none">[{log.timestamp}]</span>
            <span className={
              log.type === 'error' ? 'text-rose-400' :
              log.type === 'success' ? 'text-emerald-400' :
              log.type === 'warning' ? 'text-amber-400' :
              log.type === 'tx' ? 'text-cyan-300' :
              'text-slate-300'
            }>
              {log.msg}
            </span>
          </div>
        ))}
      </div>

      {/* Command Input Bar */}
      <form onSubmit={handleSendCli} className="flex gap-2">
        <input
          type="text"
          value={cliInput}
          onChange={(e) => setCliInput(e.target.value)}
          placeholder="e.g. device_info, power info, storage list /ext, subghz rx, reboot"
          className="flex-1 bg-[#1e212b] border border-[#2b303c] text-slate-100 font-mono px-3.5 py-2 rounded-xl text-xs focus:outline-none focus:border-[#fe8a2c]"
        />
        <button
          type="submit"
          className="px-5 py-2 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-mono text-xs font-bold rounded-xl transition shadow-md shadow-[#fe8a2c]/25"
        >
          SEND
        </button>
      </form>
    </div>
  );
}
