// Small pure helpers for console / terminal behaviour (kept separate so they can be unit-tested).

/** True for a plain Ctrl+L (no Alt/Shift/Meta), the "clear console" shortcut. */
export function isClearShortcut(e) {
  return !!e && !!e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey && String(e.key).toLowerCase() === 'l';
}

/**
 * Find the first prompt the received text currently ends with. Trailing
 * whitespace is ignored on both sides, so prompts such as '# ' and '$ ' match
 * regardless of whether the device's last space arrived. Returns the prompt
 * as listed, or null.
 */
export function matchPrompt(rxText, prompts) {
  if (!rxText) return null;
  const tail = String(rxText).toLowerCase().trimEnd();
  for (const p of prompts) {
    const needle = p.toLowerCase().trimEnd();
    if (needle && tail.endsWith(needle)) return p;
  }
  return null;
}
