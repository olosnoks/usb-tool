// Pure helpers for the Flipper Zero serial CLI console (history, suggestions, log export).

// Read-only / harmless commands the Flipper CLI documents. Grouped for the quick-command picker.
export const FLIPPER_CLI_GROUPS = [
  { id: 'info', label: 'Info', commands: ['device_info', 'power info', 'uptime', 'date', 'free', 'free_blocks', 'ps', 'top', 'loader list', 'log'] },
  { id: 'storage', label: 'Storage', commands: ['storage info /ext', 'storage info /int', 'storage list /ext', 'storage list /int', 'storage tree /ext'] },
  { id: 'io', label: 'Output', commands: ['vibro 1', 'vibro 0', 'led r 255', 'led g 255', 'led b 255', 'led off'] },
  { id: 'misc', label: 'Misc', commands: ['help', '?', 'gpio mode 0 0', 'bt hci_info', 'subghz chat'] }
];

export const FLIPPER_CLI_COMMANDS = FLIPPER_CLI_GROUPS.flatMap(g => g.commands);

export const MAX_HISTORY = 100;

/** Append a command to history: trims, ignores empty and consecutive duplicates, caps length. */
export function pushHistory(history, cmd, max = MAX_HISTORY) {
  const c = String(cmd ?? '').trim();
  if (!c) return history;
  if (history.length && history[history.length - 1] === c) return history;
  const next = [...history, c];
  return next.length > max ? next.slice(next.length - max) : next;
}

/**
 * Move through history. `index` is the current position (history.length = "new line").
 * direction -1 = older (ArrowUp), +1 = newer (ArrowDown). Returns { index, value }.
 */
export function stepHistory(history, index, direction) {
  const len = history.length;
  const cur = Number.isInteger(index) ? Math.min(Math.max(index, 0), len) : len;
  const idx = Math.min(Math.max(cur + direction, 0), len);
  return { index: idx, value: idx >= len ? '' : history[idx] };
}

/** Known commands that start with the typed text (case-insensitive), excluding exact matches. */
export function suggestCommands(input, extra = [], limit = 6) {
  const q = String(input ?? '').trim().toLowerCase();
  if (!q) return [];
  const pool = [...new Set([...extra.slice().reverse(), ...FLIPPER_CLI_COMMANDS])];
  return pool.filter(c => c.toLowerCase().startsWith(q) && c.toLowerCase() !== q).slice(0, limit);
}

/** Case-insensitive substring filter over log entries, optionally restricted to log types. */
export function filterLogs(logs, text = '', types = null) {
  const q = String(text ?? '').trim().toLowerCase();
  return logs.filter(l => {
    if (types && types.length && !types.includes(l.type)) return false;
    return !q || String(l.msg ?? '').toLowerCase().includes(q);
  });
}

/** Plain-text transcript of the log for copy / .txt download. */
export function formatLogText(logs, withTimestamps = true) {
  return logs
    .map(l => `${withTimestamps && l.timestamp ? `[${l.timestamp}] ` : ''}${l.type === 'tx' ? '> ' : ''}${l.msg}`)
    .join('\n');
}
