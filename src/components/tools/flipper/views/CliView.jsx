// "cli" view of the Flipper Zero workbench (FlipperWorkbench.jsx).
import { useState, useMemo } from 'react';
import { Terminal as TerminalIcon, Copy, Download, Trash2 } from 'lucide-react';
import { FLIPPER_CLI_GROUPS, stepHistory, suggestCommands, filterLogs, formatLogText } from '../../../../utils/flipperCli';

export default function CliView({
  cliInput,
  cliHistory = [],
  driver,
  handleSendCli,
  logContainerRef,
  logs,
  onClearLogs,
  setCliInput
}) {
  const [histIdx, setHistIdx] = useState(null);
  const [filter, setFilter] = useState('');
  const [group, setGroup] = useState('info');
  const [showTs, setShowTs] = useState(true);

  const shown = useMemo(() => filterLogs(logs, filter), [logs, filter]);
  const suggestions = useMemo(() => suggestCommands(cliInput, cliHistory), [cliInput, cliHistory]);
  const activeGroup = FLIPPER_CLI_GROUPS.find(g => g.id === group) || FLIPPER_CLI_GROUPS[0];

  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const r = stepHistory(cliHistory, histIdx ?? cliHistory.length, e.key === 'ArrowUp' ? -1 : 1);
      setHistIdx(r.index);
      setCliInput(r.value);
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault();
      setCliInput(suggestions[0]);
    }
  };

  const submit = (e) => {
    setHistIdx(null);
    handleSendCli(e);
  };

  const copyLog = () => navigator.clipboard?.writeText(formatLogText(shown, showTs)).catch(() => {});
  const saveLog = () => {
    const blob = new Blob([formatLogText(shown, showTs)], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `flipper_cli_${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const iconBtn = 'p-1.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded transition';

  return (
    <div className="bg-[#171920] border border-[#2b303c] rounded-xl p-2 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <TerminalIcon className="w-3.5 h-3.5 text-[#fe8a2c]" />
        <span className="font-bold text-white text-[11px] font-sans">Serial CLI</span>
        <div className="flex gap-1 ml-1" role="tablist" aria-label="Quick command groups">
          {FLIPPER_CLI_GROUPS.map(g => (
            <button
              key={g.id}
              role="tab"
              aria-selected={g.id === group}
              onClick={() => setGroup(g.id)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${g.id === group ? 'bg-[#fe8a2c] text-slate-950 border-[#fe8a2c]' : 'bg-[#1e212b] text-slate-400 border-[#2e3444] hover:text-white'}`}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          <button onClick={copyLog} className={iconBtn} title="Copy visible log" aria-label="Copy visible log"><Copy className="w-3 h-3" /></button>
          <button onClick={saveLog} className={iconBtn} title="Save visible log as .txt" aria-label="Save visible log"><Download className="w-3 h-3" /></button>
          <button onClick={onClearLogs} className={iconBtn} title="Clear log" aria-label="Clear log"><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {activeGroup.commands.map(cmd => (
          <button
            key={cmd}
            onClick={() => driver.executeCommand(cmd)}
            title={`Run: ${cmd}`}
            className="px-1.5 py-0.5 bg-[#1e212b] hover:bg-[#282d3b] text-slate-300 border border-[#2e3444] rounded text-[10px] font-mono transition"
          >
            {cmd}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter log..."
          aria-label="Filter log"
          className="flex-1 min-w-0 bg-[#1e212b] border border-[#2b303c] text-slate-100 font-mono px-2 py-1 rounded text-[11px] focus:outline-none focus:border-[#fe8a2c]"
        />
        <label className="flex items-center gap-1 text-[10px] text-slate-400 whitespace-nowrap">
          <input type="checkbox" checked={showTs} onChange={(e) => setShowTs(e.target.checked)} />
          time
        </label>
      </div>

      <div
        ref={logContainerRef}
        className="bg-[#0e1015] border border-[#232733] rounded-lg p-2 h-64 @lg:h-80 overflow-y-auto font-mono text-[11px] space-y-0.5 select-text"
      >
        {shown.map((log, idx) => (
          <div key={idx} className="flex gap-2">
            {showTs && <span className="text-slate-600 select-none">[{log.timestamp}]</span>}
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

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1 text-[10px]" aria-label="Suggestions">
          <span className="text-slate-500">Tab:</span>
          {suggestions.map(s => (
            <button key={s} onClick={() => setCliInput(s)} className="px-1.5 py-0.5 rounded bg-[#1e212b] border border-[#2e3444] text-slate-300 hover:text-white">{s}</button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex gap-1.5">
        <input
          type="text"
          value={cliInput}
          onChange={(e) => { setCliInput(e.target.value); setHistIdx(null); }}
          onKeyDown={onKeyDown}
          aria-label="CLI command"
          placeholder="device_info, storage list /ext ... (Up/Down history, Tab complete)"
          className="flex-1 min-w-0 bg-[#1e212b] border border-[#2b303c] text-slate-100 font-mono px-2.5 py-1.5 rounded-lg text-xs focus:outline-none focus:border-[#fe8a2c]"
        />
        <button
          type="submit"
          className="px-3 py-1.5 bg-[#fe8a2c] hover:bg-[#ff9722] text-slate-950 font-mono text-xs font-bold rounded-lg transition"
        >
          SEND
        </button>
      </form>
    </div>
  );
}
