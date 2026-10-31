// "cli" view of the PortaPack workbench (PortapackWorkbench.jsx).
// Extracted as-is; all state and handlers come in as props.


export default function CliView({
  cliInput,
  driver,
  handleSendCli,
  logContainerRef,
  logs,
  setCliInput
}) {
  return (
    <div className="space-y-3 flex-1 flex flex-col">
      <div 
        ref={logContainerRef}
        className="flex-1 bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs overflow-y-auto max-h-56 space-y-1"
      >
        {logs.length === 0 ? (
          <div className="text-slate-500 text-center py-8">
            No PortaPack serial activity yet.
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
          placeholder="e.g. freq 433920000, amp 1, lna 32, app adsb, version"
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
          { label: 'screenshot', cmd: 'screenshot' },
          { label: 'reboot', cmd: 'reboot' },
          { label: 'dfu', cmd: 'dfu' }
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
    </div>
  );
}
