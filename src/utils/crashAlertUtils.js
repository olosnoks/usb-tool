// Pure helpers for the Crash Alerts tool: pattern presets, address extraction,
// addr2line command building, cooldown and log export. Nothing here touches the browser.

export const PATTERN_PRESETS = {
  'ESP32 / ESP-IDF': ['Guru Meditation Error', 'abort() was called', 'CORRUPT HEAP', 'assert failed', 'Task watchdog got triggered', 'Brownout detector was triggered', 'Backtrace:', '/rst:0x[0-9a-f]+ \\((?:TG\\dWDT|RTCWDT|WDT)/i'],
  'ESP8266': ['Exception (', 'wdt reset', 'Soft WDT reset'],
  'ARM Cortex-M / Zephyr': ['HardFault', 'MemManage', 'BusFault', 'UsageFault', 'ZEPHYR FATAL ERROR', 'Stack overflow'],
  'Linux / U-Boot': ['Kernel panic', 'Oops:', 'BUG: ', 'Call Trace:', 'Segmentation fault', 'Out of memory: Kill'],
  'Arduino / AVR': ['Watchdog Reset', 'stack overflow', 'Fatal exception'],
  'MicroPython / CircuitPython': ['Traceback (most recent call last)', 'MemoryError', 'Fatal MicroPython error']
};

/** Add `patterns` to `current` without duplicates, keeping order. */
export function mergePatterns(current, patterns) {
  const seen = new Set(current);
  const out = [...current];
  for (const p of patterns) if (!seen.has(p)) { seen.add(p); out.push(p); }
  return out;
}

/**
 * Pull code addresses out of a crash dump: the PC half of `Backtrace: 0xPC:0xSP ...` pairs and
 * values after PC / EPC / MEPC / RA / LR / A0 labels. Duplicates are removed, order is kept.
 * Values below 0x1000 (NULL-ish) are ignored.
 */
export function extractAddresses(text, { limit = 32 } = {}) {
  const out = [];
  const seen = new Set();
  const add = (hex) => {
    const n = parseInt(hex, 16);
    if (!Number.isFinite(n) || n < 0x1000) return;
    const norm = '0x' + n.toString(16).padStart(8, '0');
    if (!seen.has(norm)) { seen.add(norm); out.push(norm); }
  };
  for (const line of String(text || '').split(/\r?\n/)) {
    const pairs = line.match(/0x[0-9a-f]{4,8}:0x[0-9a-f]{4,8}/gi);
    if (pairs) { for (const p of pairs) add(p.split(':')[0].slice(2)); continue; }
    const labelled = line.match(/\b(?:PC|EPC\d?|A0|MEPC|RA|LR)\s*[:=]\s*0x[0-9a-f]{4,8}/gi) || [];
    for (const l of labelled) add(l.replace(/^.*0x/i, ''));
  }
  return out.slice(0, limit);
}

export const TOOLCHAINS = {
  esp32: 'xtensa-esp32-elf-addr2line',
  esp32s3: 'xtensa-esp32s3-elf-addr2line',
  esp32c3: 'riscv32-esp-elf-addr2line',
  esp8266: 'xtensa-lx106-elf-addr2line',
  arm: 'arm-none-eabi-addr2line',
  generic: 'addr2line'
};

/** Build a shell command for the user to run themselves. The browser cannot resolve symbols. */
export function buildAddr2line(addresses, { toolchain = 'esp32', elf = 'build/firmware.elf' } = {}) {
  const bin = TOOLCHAINS[toolchain] || TOOLCHAINS.generic;
  const safeElf = /^[\w./\\:-]+$/.test(elf) ? elf : `"${String(elf).replace(/["`$]/g, '')}"`;
  return `${bin} -pfiaC -e ${safeElf} ${addresses.join(' ')}`.trim();
}

/** The "(LoadProhibited)" style cause name from a Guru Meditation line, or ''. */
export function extractExceptionCause(text) {
  const m = /Guru Meditation Error:[^\n]*?\(([A-Za-z0-9_ ]+)\)/.exec(String(text || ''));
  return m ? m[1].trim() : '';
}

/** True when an alert should trigger alarm/pause; false while inside the cooldown window. */
export function shouldAct(lastActMs, nowMs, cooldownSec) {
  if (!cooldownSec || cooldownSec <= 0 || lastActMs == null) return true;
  return nowMs - lastActMs >= cooldownSec * 1000;
}

export function formatLogText(history) {
  if (!history.length) return '';
  return history.map((c) => `=== ${c.time}  ${c.signature} ===\n${c.snippet}`).join('\n\n') + '\n';
}

export function formatLogJson(history) {
  return JSON.stringify(history.map(({ time, signature, snippet }) => ({ time, signature, snippet })), null, 2);
}
