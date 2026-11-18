// Pure helpers for DuckyScript Studio: lint, timing estimate, dialect conversion, code export.

export const DIALECTS = {
  ducky1: 'Rubber Ducky 1.0',
  ducky3: 'DuckyScript 3.0',
  flipper: 'Flipper Zero BadUSB',
};

const MODIFIERS = {
  GUI: 'GUI', WINDOWS: 'GUI', COMMAND: 'GUI', CTRL: 'CTRL', CONTROL: 'CTRL', ALT: 'ALT', SHIFT: 'SHIFT',
};

const KEY_ALIASES = {
  ENTER: ['ENTER'], ESCAPE: ['ESCAPE', 'ESC'], TAB: ['TAB'], SPACE: ['SPACE'], BACKSPACE: ['BACKSPACE'],
  DELETE: ['DELETE', 'DEL'], INSERT: ['INSERT'], HOME: ['HOME'], END: ['END'], PAGEUP: ['PAGEUP'],
  PAGEDOWN: ['PAGEDOWN'], UP: ['UP', 'UPARROW'], DOWN: ['DOWN', 'DOWNARROW'], LEFT: ['LEFT', 'LEFTARROW'],
  RIGHT: ['RIGHT', 'RIGHTARROW'], CAPSLOCK: ['CAPSLOCK'], NUMLOCK: ['NUMLOCK'], SCROLLLOCK: ['SCROLLLOCK'],
  PRINTSCREEN: ['PRINTSCREEN'], PAUSE: ['PAUSE', 'BREAK'], MENU: ['MENU', 'APP'],
};
for (let i = 1; i <= 12; i++) KEY_ALIASES[`F${i}`] = [`F${i}`];

const KEY_LOOKUP = {};
for (const [canon, list] of Object.entries(KEY_ALIASES)) for (const a of list) KEY_LOOKUP[a] = canon;

const V3_ONLY = ['DEFINE', 'VAR', 'IF', 'ELSE', 'END_IF', 'WHILE', 'END_WHILE', 'FUNCTION', 'END_FUNCTION', 'RETURN',
  'ATTACKMODE', 'LED_R', 'LED_G', 'LED_OFF', 'WAIT_FOR_CAPS_ON', 'WAIT_FOR_CAPS_OFF', 'WAIT_FOR_NUM_ON',
  'WAIT_FOR_NUM_OFF', 'WAIT_FOR_SCROLL_ON', 'WAIT_FOR_SCROLL_OFF', 'STRING_BLOCK', 'END_STRING', 'STRINGLN_BLOCK',
  'END_STRINGLN', 'REM_BLOCK', 'END_REM', 'EXFIL', 'DISABLE_BUTTON', 'ENABLE_BUTTON', 'JITTER', 'INJECT_MOD',
  'SAVE_HOST_KEYBOARD_LOCK_STATE', 'RESTORE_HOST_KEYBOARD_LOCK_STATE', 'HIDE_PAYLOAD', 'RESTORE_PAYLOAD', 'RESET',
  'STRING_DELAY', 'DEFAULT_STRING_DELAY', 'DEFAULTSTRINGDELAY', 'STRINGLN', 'HOLD', 'RELEASE'];
const FLIPPER_ONLY = ['ID', 'ALTSTRING', 'ALTCODE', 'ALTCHAR', 'SYSRQ', 'WAIT_FOR_BUTTON_PRESS', 'STRING_DELAY',
  'DEFAULT_STRING_DELAY', 'DEFAULTSTRINGDELAY', 'HOLD', 'RELEASE', 'MOUSE_CLICK', 'MOUSE_MOVE', 'MOUSE_SCROLL',
  'GLOBE', 'FN', 'STRINGLN'];
const FLIPPER_UNSUPPORTED = ['DEFINE', 'VAR', 'IF', 'ELSE', 'END_IF', 'WHILE', 'END_WHILE', 'FUNCTION', 'END_FUNCTION',
  'RETURN', 'ATTACKMODE', 'EXFIL', 'STRING_BLOCK', 'END_STRING', 'STRINGLN_BLOCK', 'END_STRINGLN'];
const FLIPPER_MEDIA = ['PLAY', 'STOP', 'NEXTSONG', 'PREVIOUSSONG', 'MUTE', 'VOLUMEUP', 'VOLUMEDOWN',
  'POWER', 'WAKEUP', 'SLEEP', 'BRIGHTNESSUP', 'BRIGHTNESSDOWN', 'EJECT'];

const BLOCKS = { STRING_BLOCK: 'END_STRING', STRINGLN_BLOCK: 'END_STRINGLN', REM_BLOCK: 'END_REM' };
const DELAY_CMDS = ['DELAY', 'DEFAULT_DELAY', 'DEFAULTDELAY', 'DEFAULT_STRING_DELAY', 'DEFAULTSTRINGDELAY'];

/** Normalise one key token (e.g. "esc", "a", "F5") to a canonical key, or null. */
export function normalizeKey(tok) {
  if (!tok) return null;
  const up = tok.toUpperCase();
  if (KEY_LOOKUP[up]) return KEY_LOOKUP[up];
  if (/^[A-Z0-9]$/.test(up)) return up;
  if (tok.length === 1) return tok;
  return null;
}

/** Parse "CTRL ALT DELETE" or "CTRL-SHIFT ESC" into {mods, key, error}. */
export function parseKeyCombo(line) {
  const toks = line.trim().split(/[\s-]+/).filter(Boolean);
  if (line.trim().endsWith('-') && toks.length > 1) toks.push('-');
  const mods = [];
  let key = null;
  for (const tok of toks) {
    const up = tok.toUpperCase();
    if (MODIFIERS[up]) { mods.push(MODIFIERS[up]); continue; }
    const k = normalizeKey(tok);
    if (!k || key) return { mods, key: null, error: `Unknown key "${tok}"` };
    key = k;
  }
  return { mods, key, error: null };
}

function splitCmd(line) {
  const t = line.trim();
  const m = t.match(/^(\S+)(?:\s+([\s\S]*))?$/);
  return m ? { cmd: m[1].toUpperCase(), raw: m[1], arg: m[2] ?? '' } : { cmd: '', raw: '', arg: '' };
}

function keyLine(cmd, arg) {
  const combo = parseKeyCombo(`${cmd} ${arg}`);
  return { ok: !combo.error && (combo.key || combo.mods.length > 0), combo };
}

/**
 * Lint a script. Returns [{line, severity: 'error'|'warning'|'info', message}].
 * dialect: 'ducky1' | 'ducky3' | 'flipper'
 */
export function lintDucky(text, dialect = 'ducky3') {
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  const stack = [];
  let block = null;
  let lastExecutable = false;
  let seenReal = false;
  const add = (line, severity, message) => out.push({ line, severity, message });

  lines.forEach((rawLine, idx) => {
    const n = idx + 1;
    if (block) {
      if (splitCmd(rawLine).cmd === block.end) block = null;
      return;
    }
    const t = rawLine.trim();
    if (!t) return;
    const { cmd, raw, arg } = splitCmd(t);
    if (cmd === 'REM') return;
    const first = !seenReal;
    seenReal = true;

    if (BLOCKS[cmd]) {
      if (dialect !== 'ducky3') add(n, 'error', `${cmd} needs DuckyScript 3.0.`);
      block = { end: BLOCKS[cmd], start: n };
      return;
    }
    if (DELAY_CMDS.includes(cmd)) {
      const a = arg.trim();
      if (!a) add(n, 'error', `${cmd} needs a number of milliseconds.`);
      else if (!/^\d+$/.test(a)) {
        if (dialect === 'ducky3' && /^[$#A-Za-z_]/.test(a)) { /* variable or constant */ }
        else add(n, 'error', `${cmd} value "${a}" is not a whole number.`);
      } else if (cmd === 'DELAY' && Number(a) > 60000) add(n, 'warning', 'DELAY longer than 60 s.');
      else if (Number(a) > 65535 && dialect !== 'flipper') add(n, 'warning', 'Delay above 65535 ms may overflow on some encoders.');
      if (/STRING_DELAY|STRINGDELAY/.test(cmd) && dialect === 'ducky1') add(n, 'error', `${cmd} is not in Rubber Ducky 1.0.`);
      return;
    }
    if (cmd === 'STRING' || cmd === 'STRINGLN') {
      if (cmd === 'STRINGLN' && dialect === 'ducky1') add(n, 'error', 'STRINGLN is not in Rubber Ducky 1.0.');
      if (!arg) add(n, 'error', `${cmd} has nothing to type.`);
      else if (/[^\x00-\x7F]/.test(arg)) add(n, 'warning', 'Non-ASCII characters depend on the target keyboard layout and may type wrongly.');
      lastExecutable = true;
      return;
    }
    if (cmd === 'STRING_DELAY') {
      if (dialect === 'ducky1') add(n, 'error', 'STRING_DELAY is not in Rubber Ducky 1.0.');
      if (!/^\d+\s+\S/.test(arg)) add(n, 'error', 'STRING_DELAY needs "ms text", e.g. STRING_DELAY 50 hello.');
      lastExecutable = true;
      return;
    }
    if (cmd === 'REPEAT') {
      if (!/^\d+$/.test(arg.trim())) add(n, 'error', 'REPEAT needs a count, e.g. REPEAT 3.');
      else if (!lastExecutable) add(n, 'warning', 'REPEAT has no previous command to repeat.');
      return;
    }
    if (cmd === 'DEFINE') {
      if (dialect !== 'ducky3') add(n, 'error', 'DEFINE needs DuckyScript 3.0.');
      else if (!/^#?[A-Za-z_]\w*\s+\S/.test(arg)) add(n, 'error', 'DEFINE needs a name and a value.');
      return;
    }
    if (cmd === 'IF' || cmd === 'WHILE' || cmd === 'FUNCTION') {
      stack.push({ type: cmd, n });
      if (dialect !== 'ducky3') add(n, 'error', `${cmd} is only available in DuckyScript 3.0.`);
      return;
    }
    if (cmd === 'END_IF' || cmd === 'END_WHILE' || cmd === 'END_FUNCTION') {
      const want = cmd.slice(4);
      const top = stack.pop();
      if (!top || top.type !== want) add(n, 'error', `${cmd} has no matching ${want}.`);
      return;
    }
    if (cmd === 'ELSE') {
      const top = stack[stack.length - 1];
      if (!top || top.type !== 'IF') add(n, 'error', 'ELSE without IF.');
      return;
    }
    if (cmd === 'ID') {
      if (dialect !== 'flipper') add(n, 'warning', 'ID is a Flipper extension; other devices ignore or reject it.');
      else if (!first) add(n, 'error', 'ID must be the first line of a Flipper script.');
      if (!/^[0-9A-Fa-f]{4}:[0-9A-Fa-f]{4}(\s|$)/.test(arg.trim())) add(n, 'error', 'ID format is VID:PID, e.g. ID 046D:C31C Vendor:Product.');
      return;
    }
    if (cmd === 'HOLD' || cmd === 'RELEASE') {
      if (dialect === 'ducky1') add(n, 'error', `${cmd} is not in Rubber Ducky 1.0.`);
      const a = arg.trim().toUpperCase();
      if (!a || !(normalizeKey(a) || MODIFIERS[a])) add(n, 'error', `${cmd} needs one key.`);
      lastExecutable = true;
      return;
    }
    if (['ALTSTRING', 'ALTCODE', 'ALTCHAR', 'SYSRQ', 'GLOBE', 'FN', 'WAIT_FOR_BUTTON_PRESS'].includes(cmd) || cmd.startsWith('MOUSE_')) {
      if (dialect !== 'flipper') add(n, 'warning', `${cmd} is a Flipper extension.`);
      lastExecutable = true;
      return;
    }
    if (dialect === 'flipper' && FLIPPER_MEDIA.includes(cmd)) { lastExecutable = true; return; }
    if (['VAR', 'ATTACKMODE', 'RETURN', 'EXFIL', 'JITTER', 'INJECT_MOD', 'DISABLE_BUTTON', 'ENABLE_BUTTON', 'RESET',
      'HIDE_PAYLOAD', 'RESTORE_PAYLOAD'].includes(cmd) || cmd.startsWith('LED_') || cmd.startsWith('WAIT_FOR_') ||
      cmd.startsWith('RANDOM_') || cmd.endsWith('HOST_KEYBOARD_LOCK_STATE')) {
      if (dialect !== 'ducky3') add(n, 'error', `${cmd} is only available in DuckyScript 3.0.`);
      lastExecutable = true;
      return;
    }
    const k = keyLine(cmd, arg);
    if (k.ok) {
      const { mods, key } = k.combo;
      if (!key && mods.length > 0 && /\s|-/.test(t)) add(n, 'error', 'Modifier combination has no final key.');
      else if (new Set(mods).size !== mods.length) add(n, 'warning', 'Repeated modifier in combination.');
      lastExecutable = true;
      return;
    }
    if (dialect === 'ducky3' && (raw.startsWith('$') || /^[A-Za-z_]\w*\(\)$/.test(raw))) { lastExecutable = true; return; }
    if (/^[A-Z_]+$/.test(cmd) && !arg) add(n, 'error', `Unknown command "${raw}".`);
    else if (k.combo.error && MODIFIERS[cmd]) add(n, 'error', k.combo.error);
    else add(n, 'error', `Unknown command "${raw}".`);
  });

  if (block) add(block.start, 'error', `Block opened here is never closed with ${block.end}.`);
  stack.forEach((s) => add(s.n, 'error', `${s.type} is never closed with END_${s.type}.`));
  return out;
}

/** Flatten a script into executable operations (REPEAT and default delays resolved). */
export function expandScript(text, maxOps = 5000) {
  const ops = [];
  let defaultDelay = 0;
  let stringDelay = 0;
  let block = null;
  let buf = [];
  let last = null;
  const push = (op) => {
    if (ops.length >= maxOps) return;
    ops.push(op);
    last = op;
  };
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const t = raw.trim();
    if (block) {
      if (splitCmd(t).cmd === block.end) {
        if (block.kind !== 'REM') push({ type: 'string', text: buf.join(block.kind === 'STRINGLN' ? '\n' : ''), enter: block.kind === 'STRINGLN', line: block.kind + '_BLOCK', stringDelay, defaultDelay });
        block = null; buf = [];
      } else buf.push(t);
      continue;
    }
    if (!t) continue;
    const { cmd, arg } = splitCmd(t);
    if (cmd === 'REM') continue;
    if (cmd === 'STRING_BLOCK') { block = { end: 'END_STRING', kind: 'STRING' }; continue; }
    if (cmd === 'STRINGLN_BLOCK') { block = { end: 'END_STRINGLN', kind: 'STRINGLN' }; continue; }
    if (cmd === 'REM_BLOCK') { block = { end: 'END_REM', kind: 'REM' }; continue; }
    if (cmd === 'DEFAULT_DELAY' || cmd === 'DEFAULTDELAY') { defaultDelay = parseInt(arg, 10) || 0; continue; }
    if (cmd === 'DEFAULT_STRING_DELAY' || cmd === 'DEFAULTSTRINGDELAY') { stringDelay = parseInt(arg, 10) || 0; continue; }
    if (cmd === 'STRING_DELAY') {
      const m = arg.match(/^(\d+)\s+([\s\S]*)$/);
      if (m) push({ type: 'string', text: m[2], enter: false, line: t, stringDelay: parseInt(m[1], 10), defaultDelay });
      continue;
    }
    if (cmd === 'REPEAT') {
      const n = parseInt(arg, 10);
      if (last && n > 0) { const base = last; for (let i = 0; i < n; i++) push({ ...base, repeated: true }); }
      continue;
    }
    if (cmd === 'DELAY') { push({ type: 'delay', ms: parseInt(arg, 10) || 0, line: t, defaultDelay: 0 }); continue; }
    if (cmd === 'STRING' || cmd === 'STRINGLN') {
      push({ type: 'string', text: arg, enter: cmd === 'STRINGLN', line: t, stringDelay, defaultDelay });
      continue;
    }
    const k = keyLine(cmd, arg);
    if (k.ok) { push({ type: 'key', mods: k.combo.mods, key: k.combo.key, line: t, defaultDelay }); continue; }
    push({ type: 'other', line: t, defaultDelay: 0 });
  }
  return ops;
}

/** Estimate run time: ~10 ms per typed char, ~20 ms per key press, plus delays. */
export function estimateTiming(text, opts = {}) {
  const msPerChar = opts.msPerChar ?? 10;
  const msPerKey = opts.msPerKey ?? 20;
  let total = 0, chars = 0, keys = 0, delays = 0;
  for (const op of expandScript(text)) {
    if (op.type === 'delay') { total += op.ms; delays += op.ms; }
    else if (op.type === 'string') {
      const n = op.text.length + (op.enter ? 1 : 0);
      chars += n; keys += n;
      total += n * (msPerChar + (op.stringDelay || 0));
    } else if (op.type === 'key') { keys += 1; total += msPerKey; }
    if (op.type === 'string' || op.type === 'key') total += op.defaultDelay || 0;
  }
  return { totalMs: total, typedChars: chars, keystrokes: keys, delays };
}

export function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

/** Rewrite a script toward a target dialect. Returns {text, notes[]}. */
export function convertDialect(text, target) {
  const notes = [];
  const out = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    const { cmd, arg } = splitCmd(t);
    let line = raw;
    if (cmd === 'DEFAULTDELAY') line = `DEFAULT_DELAY ${arg}`;
    else if (target === 'ducky1' || target === 'flipper') {
      if (cmd === 'WINDOWS' || cmd === 'COMMAND') line = `GUI${arg ? ' ' + arg : ''}`;
      else if (cmd === 'ESC') line = `ESCAPE${arg ? ' ' + arg : ''}`;
    }
    if (target === 'ducky1') {
      if (cmd === 'STRINGLN') { out.push(`STRING ${arg}`, 'ENTER'); notes.push(`Line ${i + 1}: STRINGLN split into STRING + ENTER.`); return; }
      if (V3_ONLY.includes(cmd) || FLIPPER_ONLY.includes(cmd) || cmd.startsWith('LED_') || cmd.startsWith('WAIT_FOR_') || cmd.startsWith('RANDOM_')) {
        out.push(`REM [unsupported in 1.0] ${t}`); notes.push(`Line ${i + 1}: ${cmd} commented out (not in 1.0).`); return;
      }
    }
    if (target === 'flipper' && (FLIPPER_UNSUPPORTED.includes(cmd) || cmd.startsWith('LED_') || cmd.startsWith('RANDOM_') || (cmd.startsWith('WAIT_FOR_') && cmd !== 'WAIT_FOR_BUTTON_PRESS'))) {
      out.push(`REM [unsupported on Flipper] ${t}`); notes.push(`Line ${i + 1}: ${cmd} commented out (needs a manual rewrite).`); return;
    }
    out.push(line);
  });
  return { text: out.join('\n'), notes };
}

const ARDUINO_KEYS = {
  ENTER: 'KEY_RETURN', ESCAPE: 'KEY_ESC', TAB: 'KEY_TAB', SPACE: "' '", BACKSPACE: 'KEY_BACKSPACE', DELETE: 'KEY_DELETE',
  INSERT: 'KEY_INSERT', HOME: 'KEY_HOME', END: 'KEY_END', PAGEUP: 'KEY_PAGE_UP', PAGEDOWN: 'KEY_PAGE_DOWN',
  UP: 'KEY_UP_ARROW', DOWN: 'KEY_DOWN_ARROW', LEFT: 'KEY_LEFT_ARROW', RIGHT: 'KEY_RIGHT_ARROW', CAPSLOCK: 'KEY_CAPS_LOCK',
  PRINTSCREEN: 'KEY_PRINT_SCREEN', SCROLLLOCK: 'KEY_SCROLL_LOCK', PAUSE: 'KEY_PAUSE', MENU: 'KEY_MENU', NUMLOCK: 'KEY_NUM_LOCK',
};
for (let i = 1; i <= 12; i++) ARDUINO_KEYS[`F${i}`] = `KEY_F${i}`;
const ARDUINO_MODS = { GUI: 'KEY_LEFT_GUI', CTRL: 'KEY_LEFT_CTRL', ALT: 'KEY_LEFT_ALT', SHIFT: 'KEY_LEFT_SHIFT' };

const CP_KEYS = {
  ENTER: 'ENTER', ESCAPE: 'ESCAPE', TAB: 'TAB', SPACE: 'SPACEBAR', BACKSPACE: 'BACKSPACE', DELETE: 'DELETE', INSERT: 'INSERT',
  HOME: 'HOME', END: 'END', PAGEUP: 'PAGE_UP', PAGEDOWN: 'PAGE_DOWN', UP: 'UP_ARROW', DOWN: 'DOWN_ARROW', LEFT: 'LEFT_ARROW',
  RIGHT: 'RIGHT_ARROW', CAPSLOCK: 'CAPS_LOCK', PRINTSCREEN: 'PRINT_SCREEN', SCROLLLOCK: 'SCROLL_LOCK', PAUSE: 'PAUSE',
  MENU: 'APPLICATION', NUMLOCK: 'KEYPAD_NUMLOCK',
};
for (let i = 1; i <= 12; i++) CP_KEYS[`F${i}`] = `F${i}`;
const CP_MODS = { GUI: 'GUI', CTRL: 'CONTROL', ALT: 'ALT', SHIFT: 'SHIFT' };
const CP_DIGITS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const CP_CHAR = { '-': 'MINUS', '=': 'EQUALS', '[': 'LEFT_BRACKET', ']': 'RIGHT_BRACKET', '\\': 'BACKSLASH', ';': 'SEMICOLON', "'": 'QUOTE', '`': 'GRAVE_ACCENT', ',': 'COMMA', '.': 'PERIOD', '/': 'FORWARD_SLASH' };

const quote = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** Export to an Arduino sketch. Returns {code, skipped[]} (skipped = lines that could not be converted). */
export function toArduino(text) {
  const skipped = [];
  let code = '#include "Keyboard.h"\n\nvoid setup() {\n  Keyboard.begin();\n  delay(1000);\n\n';
  for (const op of expandScript(text)) {
    if (op.type === 'delay') code += `  delay(${op.ms});\n`;
    else if (op.type === 'string') {
      if (op.stringDelay) code += `  for (const char *p = ${quote(op.text)}; *p; p++) { Keyboard.write(*p); delay(${op.stringDelay}); }\n`;
      else code += `  Keyboard.print(${quote(op.text)});\n`;
      if (op.enter) code += '  Keyboard.write(KEY_RETURN);\n';
    } else if (op.type === 'key') {
      const mods = op.mods.map((m) => ARDUINO_MODS[m]);
      let k = null;
      if (op.key) k = ARDUINO_KEYS[op.key] || (op.key.length === 1 ? `'${op.key === "'" || op.key === '\\' ? '\\' + op.key : op.key.toLowerCase()}'` : null);
      if (op.key && !k) { skipped.push(op.line); continue; }
      if (!mods.length && k) code += `  Keyboard.write(${k});\n`;
      else {
        mods.forEach((m) => { code += `  Keyboard.press(${m});\n`; });
        if (k) code += `  Keyboard.press(${k});\n`;
        code += '  delay(50);\n  Keyboard.releaseAll();\n';
      }
    } else { skipped.push(op.line); continue; }
    if (op.defaultDelay) code += `  delay(${op.defaultDelay});\n`;
  }
  code += '  Keyboard.end();\n}\n\nvoid loop() {}\n';
  return { code, skipped };
}

/** Export to CircuitPython (adafruit_hid). Returns {code, skipped[]}. */
export function toCircuitPython(text) {
  const skipped = [];
  let code = 'import time\nimport usb_hid\nfrom adafruit_hid.keyboard import Keyboard\nfrom adafruit_hid.keyboard_layout_us import KeyboardLayoutUS\nfrom adafruit_hid.keycode import Keycode\n\ntime.sleep(1)\nkbd = Keyboard(usb_hid.devices)\nlayout = KeyboardLayoutUS(kbd)\n\n';
  for (const op of expandScript(text)) {
    if (op.type === 'delay') code += `time.sleep(${op.ms / 1000})\n`;
    else if (op.type === 'string') {
      if (op.stringDelay) code += `for ch in ${quote(op.text)}:\n    layout.write(ch)\n    time.sleep(${op.stringDelay / 1000})\n`;
      else code += `layout.write(${quote(op.text)})\n`;
      if (op.enter) code += 'kbd.send(Keycode.ENTER)\n';
    } else if (op.type === 'key') {
      const parts = op.mods.map((m) => `Keycode.${CP_MODS[m]}`);
      if (op.key) {
        const name = CP_KEYS[op.key] || (/^\d$/.test(op.key) ? CP_DIGITS[Number(op.key)] : /^[A-Z]$/.test(op.key) ? op.key : CP_CHAR[op.key]);
        if (!name) { skipped.push(op.line); continue; }
        parts.push(`Keycode.${name}`);
      }
      code += `kbd.send(${parts.join(', ')})\n`;
    } else { skipped.push(op.line); continue; }
    if (op.defaultDelay) code += `time.sleep(${op.defaultDelay / 1000})\n`;
  }
  return { code, skipped };
}
