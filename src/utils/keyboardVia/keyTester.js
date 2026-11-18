/**
 * keyTester.js — browser key-event tester logic: on-screen layout data, the event
 * reducer (pressed / ever pressed / counts / log), chatter detection and rollover verdict.
 *
 * Pure: no DOM. The workbench feeds it KeyboardEvent fields (code, key, location,
 * repeat, timeStamp) and renders the state. It measures what the browser delivers,
 * not electrical behaviour: chatter here means a key pressed again within the window
 * after its own release, as the browser sees it.
 */

export const DEFAULT_CHATTER_MS = 20;
export const MAX_LOG = 300;

// Key sizes are in key units (1u = one standard key). Each block is a list of rows;
// a row is a list of { c: KeyboardEvent.code, l: label, w: width } or { w } spacers.
const k = (c, l, w = 1) => ({ c, l, w });
const gap = (w) => ({ w });

const MAIN_ANSI = [
  [k('Escape', 'Esc'), gap(0.5), k('F1', 'F1'), k('F2', 'F2'), k('F3', 'F3'), k('F4', 'F4'), gap(0.5),
    k('F5', 'F5'), k('F6', 'F6'), k('F7', 'F7'), k('F8', 'F8'), gap(0.5), k('F9', 'F9'), k('F10', 'F10'), k('F11', 'F11'), k('F12', 'F12')],
  [k('Backquote', '`'), ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((d) => k(`Digit${d}`, d)),
    k('Minus', '-'), k('Equal', '='), k('Backspace', 'Backspace', 2)],
  [k('Tab', 'Tab', 1.5), ...'QWERTYUIOP'.split('').map((l) => k(`Key${l}`, l)),
    k('BracketLeft', '['), k('BracketRight', ']'), k('Backslash', '\\', 1.5)],
  [k('CapsLock', 'Caps', 1.75), ...'ASDFGHJKL'.split('').map((l) => k(`Key${l}`, l)),
    k('Semicolon', ';'), k('Quote', "'"), k('Enter', 'Enter', 2.25)],
  [k('ShiftLeft', 'Shift', 2.25), ...'ZXCVBNM'.split('').map((l) => k(`Key${l}`, l)),
    k('Comma', ','), k('Period', '.'), k('Slash', '/'), k('ShiftRight', 'Shift', 2.75)],
  [k('ControlLeft', 'Ctrl', 1.25), k('MetaLeft', 'Win', 1.25), k('AltLeft', 'Alt', 1.25), k('Space', 'Space', 6.25),
    k('AltRight', 'Alt', 1.25), k('MetaRight', 'Win', 1.25), k('ContextMenu', 'Menu', 1.25), k('ControlRight', 'Ctrl', 1.25)]
];

const NAV = [
  [k('PrintScreen', 'PrtSc'), k('ScrollLock', 'ScrLk'), k('Pause', 'Pause')],
  [k('Insert', 'Ins'), k('Home', 'Home'), k('PageUp', 'PgUp')],
  [k('Delete', 'Del'), k('End', 'End'), k('PageDown', 'PgDn')],
  [],
  [gap(1), k('ArrowUp', '↑')],
  [k('ArrowLeft', '←'), k('ArrowDown', '↓'), k('ArrowRight', '→')]
];

const NUMPAD = [
  [k('NumLock', 'Num'), k('NumpadDivide', '/'), k('NumpadMultiply', '*'), k('NumpadSubtract', '-')],
  [k('Numpad7', '7'), k('Numpad8', '8'), k('Numpad9', '9'), k('NumpadAdd', '+')],
  [k('Numpad4', '4'), k('Numpad5', '5'), k('Numpad6', '6')],
  [k('Numpad1', '1'), k('Numpad2', '2'), k('Numpad3', '3'), k('NumpadEnter', 'Ent')],
  [k('Numpad0', '0', 2), k('NumpadDecimal', '.')]
];

/**
 * Layout for the on-screen board. `tkl` drops the numpad (87 keys); `iso` swaps in the
 * ISO keys (IntlBackslash plus the ISO hash key). The ISO shape is simplified:
 * the codes are right, the Enter key is not drawn tall.
 */
export function buildKeyboardLayout({ tkl = false, iso = false } = {}) {
  let main = MAIN_ANSI.map((row) => row.slice());
  if (iso) {
    // ANSI backslash sits at the end of row 2 on ANSI; on ISO that key is the hash key after Quote.
    main[2] = main[2].filter((it) => it.c !== 'Backslash').concat([gap(1.5)]);
    main[3] = main[3].slice(0, -1).concat([k('Backslash', '#'), k('Enter', 'Enter', 1.25)]);
    main[4] = [k('ShiftLeft', 'Shift', 1.25), k('IntlBackslash', '\\', 1), ...main[4].slice(1)];
  }
  const nav = NAV.map((row) => row.slice());
  return {
    main,
    nav,
    numpad: tkl ? null : NUMPAD
  };
}

/** Flat list of { c, l } for every key on the board (spacers removed). */
export function layoutKeyCodes(layout) {
  const out = [];
  const visit = (rows) => { if (!rows) return; for (const row of rows) for (const it of row) if (it.c) out.push(it); };
  visit(layout.main);
  visit(layout.nav);
  visit(layout.numpad);
  return out;
}

/** The identity used for a key: its physical code, falling back to the logical key. */
export function keyIdentity(evt) {
  if (evt.code) return evt.code;
  return `Key:${evt.key || 'unknown'}`;
}

export function createTesterState(chatterMs = DEFAULT_CHATTER_MS) {
  return {
    chatterMs,
    down: {},        // code -> timeStamp of the current press
    ever: {},        // code -> true once seen
    counts: {},      // code -> number of real (non-repeat) presses
    lastUp: {},      // code -> timeStamp of the last release
    chatter: {},     // code -> chatter events flagged
    dwell: {},       // code -> { n, sum, min, max } hold time in ms (down to up)
    maxSimultaneous: 0,
    events: 0,
    log: []          // newest last, capped at MAX_LOG
  };
}

/**
 * Apply one key event. evt: { type: 'down'|'up', code, key, location, repeat, timeStamp }.
 * Returns a new state object (the input is not mutated).
 */
export function applyKeyEvent(state, evt) {
  if (!evt || (!evt.code && !evt.key)) return state;
  const code = keyIdentity(evt);
  const t = Number(evt.timeStamp) || 0;
  const next = { ...state, events: state.events + 1 };
  const entry = {
    seq: next.events,
    type: evt.type,
    code,
    key: evt.key || '',
    location: typeof evt.location === 'number' ? evt.location : 0,
    repeat: !!evt.repeat,
    t,
    chatter: false,
    gapMs: null
  };

  if (evt.type === 'down') {
    if (evt.repeat) {
      // Auto-repeat while held: logged, but not a new press.
    } else if (state.down[code] === undefined) {
      next.counts = { ...state.counts, [code]: (state.counts[code] || 0) + 1 };
      const lastUp = state.lastUp[code];
      if (lastUp !== undefined && t >= lastUp && t - lastUp < state.chatterMs) {
        entry.chatter = true;
        entry.gapMs = Math.round((t - lastUp) * 10) / 10;
        next.chatter = { ...state.chatter, [code]: (state.chatter[code] || 0) + 1 };
      }
    }
    // A second non-repeat down while already held (missed keyup) is logged, not counted.
    next.down = { ...state.down, [code]: state.down[code] !== undefined ? state.down[code] : t };
    next.ever = { ...state.ever, [code]: true };
    next.maxSimultaneous = Math.max(state.maxSimultaneous, Object.keys(next.down).length);
  } else if (evt.type === 'up') {
    const rest = { ...state.down };
    const downAt = state.down[code];
    if (downAt !== undefined && t >= downAt) {
      const held = t - downAt;
      const d = (state.dwell || {})[code];
      next.dwell = {
        ...(state.dwell || {}),
        [code]: d
          ? { n: d.n + 1, sum: d.sum + held, min: Math.min(d.min, held), max: Math.max(d.max, held) }
          : { n: 1, sum: held, min: held, max: held }
      };
    }
    delete rest[code];
    next.down = rest;
    next.lastUp = { ...state.lastUp, [code]: t };
  } else {
    return state;
  }

  next.log = state.log.length >= MAX_LOG ? state.log.slice(state.log.length - MAX_LOG + 1).concat(entry) : state.log.concat(entry);
  return next;
}

/** What the rollover numbers mean. max = most keys held at once that the browser reported. */
export function rolloverVerdict(max) {
  if (!max) return { level: 'none', text: 'No keys tested yet. Hold 6 or more keys together.' };
  if (max < 6) return { level: 'short', text: `Only ${max} key(s) held at once. Hold 6 or more together to test rollover.` };
  if (max === 6) {
    return {
      level: '6kro',
      text: '6 keys registered together: at least 6KRO. Hold 7 or more to check for NKRO.'
    };
  }
  return {
    level: 'nkro',
    text: `${max} keys registered together: more than 6KRO, consistent with NKRO.`
  };
}

/** Hold-time summary for one key: { n, avg, min, max } in ms, or null when never released. */
export function dwellSummary(state, code) {
  const d = state.dwell && state.dwell[code];
  if (!d || !d.n) return null;
  return { n: d.n, avg: d.sum / d.n, min: d.min, max: d.max };
}

/** Keys on the board that have not been pressed yet, in layout order: [{ c, l }]. */
export function untestedKeys(state, layout) {
  return layoutKeyCodes(layout).filter((it) => !state.ever[it.c]);
}

/** { tested, total, percent } over the keys drawn on the board. */
export function testCoverage(state, layout) {
  const all = layoutKeyCodes(layout);
  const tested = all.filter((it) => state.ever[it.c]).length;
  return { tested, total: all.length, percent: all.length ? Math.round((tested / all.length) * 100) : 0 };
}

/** Combo presets for the simultaneous-keys (ghosting) check. */
export const COMBO_PRESETS = [
  { id: 'wasd', name: 'WASD + Space + Shift', codes: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft'] },
  { id: 'arrows', name: 'Arrows + Space', codes: ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space'] },
  { id: 'qwe', name: 'Q W E A S D (matrix block)', codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyA', 'KeyS', 'KeyD'] },
  { id: 'ghost', name: 'Classic ghost trio: Q A Z + W', codes: ['KeyQ', 'KeyA', 'KeyZ', 'KeyW'] }
];

/**
 * Compare the keys currently held with a target combo. Browser-side only: a missing
 * key means "the browser did not report it", which is ghosting or blocking by the keyboard
 * (or the OS), not proof of which.
 */
export function comboStatus(downCodes, targetCodes) {
  const held = new Set(downCodes);
  const missing = targetCodes.filter((c) => !held.has(c));
  const extra = downCodes.filter((c) => !targetCodes.includes(c));
  return { held: targetCodes.length - missing.length, total: targetCodes.length, missing, extra, ok: missing.length === 0 };
}

/** Plain-text summary of the session: counts and problems only, no key sequence or timing log. */
export function buildReport(state, layout) {
  const cov = testCoverage(state, layout);
  const missing = untestedKeys(state, layout).map((it) => it.l);
  const chat = Object.entries(state.chatter).filter(([, n]) => n > 0).map(([c, n]) => `${c} x${n}`);
  return [
    'Keyboard test summary (browser key events)',
    `Keys tested: ${cov.tested}/${cov.total} (${cov.percent}%)`,
    `Most keys held at once: ${state.maxSimultaneous}`,
    `Chatter window: ${state.chatterMs} ms; flagged: ${chat.length ? chat.join(', ') : 'none'}`,
    `Not pressed yet: ${missing.length ? missing.join(' ') : 'none'}`
  ].join('\n');
}

/** Modifier state label from a KeyboardEvent-like object, e.g. "Ctrl+Shift". */
export function modifierLabel(e) {
  return [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Meta'].filter(Boolean).join('+') || 'none';
}
