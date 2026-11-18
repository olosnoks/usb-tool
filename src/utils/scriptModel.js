// Script model for the Test Runner: step schema, escape parser, variables,
// expect matching, the flow-control engine and report builders. Pure (no React,
// no globals except optional injected storage/clock) so it is easy to test.

import { waitForMatch } from './serialExpect';

export const LINE_ENDINGS = { none: '', cr: '\r', lf: '\n', crlf: '\r\n' };
export const STEP_TYPES = ['send', 'delay', 'dtr', 'rts', 'baud'];
export const EXPECT_MODES = ['plain', 'regex', 'any', 'not'];
export const FAIL_POLICIES = ['stop', 'continue', 'goto'];
export const ANY_SEPARATOR = '||';

const enc = new TextEncoder();

/** Fill in defaults so old ({id,send,expect,timeoutMs}) steps keep working. */
export function normalizeStep(step = {}) {
  return {
    id: String(step.id ?? Date.now() + Math.random().toString(36).slice(2, 6)),
    type: STEP_TYPES.includes(step.type) ? step.type : 'send',
    send: step.send ?? '',
    sendFormat: step.sendFormat === 'hex' ? 'hex' : 'text',
    disabled: step.disabled === true,
    lineEnding: Object.prototype.hasOwnProperty.call(LINE_ENDINGS, step.lineEnding) ? step.lineEnding : 'none',
    expect: step.expect ?? '',
    expectMode: EXPECT_MODES.includes(step.expectMode) ? step.expectMode : 'plain',
    caseSensitive: step.caseSensitive !== false,
    timeoutMs: Number.isFinite(Number(step.timeoutMs)) ? Number(step.timeoutMs) : 1000,
    value: step.value ?? '',          // delay ms / dtr,rts 0|1 / baud rate
    loopMode: step.loopMode === 'until' ? 'until' : 'count',
    loopCount: Math.max(1, Math.floor(Number(step.loopCount) || 1)),
    retries: Math.max(0, Math.floor(Number(step.retries) || 0)),
    onFail: FAIL_POLICIES.includes(step.onFail) ? step.onFail : 'stop',
    gotoId: step.gotoId ?? '',
  };
}

// ---------------------------------------------------------------------------
// Send: escapes + ${var} -> bytes

function hexVal(c) { return /^[0-9a-fA-F]$/.test(c) ? parseInt(c, 16) : -1; }

/** "AA 55 0x10, ff" -> bytes. Separators: whitespace, commas, colons. Throws on bad input. */
export function parseHex(text) {
  const tokens = String(text).split(/[\s,:]+/).filter(Boolean);
  const out = [];
  for (const raw of tokens) {
    const t = raw.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2) throw new Error(`invalid hex "${raw}"`);
    for (let i = 0; i < t.length; i += 2) out.push(parseInt(t.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Template -> bytes. Supports \r \n \t \0 \e \\ \xNN \$ and ${var}; other text
 * is UTF-8. An unknown ${var} is kept literally (so mistakes stay visible).
 */
export function encodeSend(template, { vars = {}, lineEnding = 'none', format = 'text' } = {}) {
  if (format === 'hex') {
    return Uint8Array.from([...parseHex(template), ...enc.encode(LINE_ENDINGS[lineEnding] ?? '')]);
  }
  const out = [];
  const push = (str) => { for (const b of enc.encode(str)) out.push(b); };
  const s = String(template);
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === '\\' && i + 1 < s.length) {
      const n = s[i + 1];
      if (n === 'r') { out.push(13); i += 2; continue; }
      if (n === 'n') { out.push(10); i += 2; continue; }
      if (n === 't') { out.push(9); i += 2; continue; }
      if (n === '0') { out.push(0); i += 2; continue; }
      if (n === 'e') { out.push(0x1b); i += 2; continue; }
      if (n === '\\') { out.push(0x5c); i += 2; continue; }
      if (n === '$') { out.push(0x24); i += 2; continue; }
      if (n === 'x' && hexVal(s[i + 2] ?? '') >= 0 && hexVal(s[i + 3] ?? '') >= 0) {
        out.push(hexVal(s[i + 2]) * 16 + hexVal(s[i + 3])); i += 4; continue;
      }
      push(ch); i += 1; continue;
    }
    if (ch === '$' && s[i + 1] === '{') {
      const end = s.indexOf('}', i + 2);
      const name = end > 0 ? s.slice(i + 2, end) : '';
      if (end > 0 && /^[A-Za-z0-9_]+$/.test(name) && Object.prototype.hasOwnProperty.call(vars, name)) {
        push(String(vars[name])); i = end + 1; continue;
      }
    }
    // Copy one full code point
    const cp = s.codePointAt(i);
    const str = String.fromCodePoint(cp);
    push(str); i += str.length;
  }
  push(LINE_ENDINGS[lineEnding] ?? '');
  return Uint8Array.from(out);
}

/** Replace ${var} in plain text (unknown vars stay literal). */
export function substituteVars(text, vars = {}) {
  return String(text).replace(/\$\{([A-Za-z0-9_]+)\}/g, (m, name) => (
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m));
}

// ---------------------------------------------------------------------------
// Expect

/**
 * Build a matcher for a step. matcher(text) -> { captures } on a hit, else null.
 * Modes: plain, regex (capture groups -> captures 1..n and named groups),
 * any (patterns separated by "||"), not (plain/any text that must NOT appear;
 * the engine inverts the result). Throws on an invalid regex.
 */
export function buildMatcher(step, vars = {}) {
  const mode = step.expectMode || 'plain';
  const ci = step.caseSensitive === false;
  if (mode === 'regex') {
    const re = new RegExp(step.expect, ci ? 'i' : '');
    return (text) => {
      const m = re.exec(text);
      if (!m) return null;
      const captures = {};
      for (let i = 1; i < m.length; i++) if (m[i] !== undefined) captures[String(i)] = m[i];
      if (m.groups) Object.assign(captures, m.groups);
      return { captures };
    };
  }
  const list = (mode === 'any' || mode === 'not'
    ? substituteVars(step.expect, vars).split(ANY_SEPARATOR)
    : [substituteVars(step.expect, vars)]
  ).filter((p) => p !== '');
  const norm = (t) => (ci ? t.toLowerCase() : t);
  const needles = list.map(norm);
  return (text) => {
    const hay = norm(text);
    return needles.some((n) => hay.includes(n)) ? { captures: {} } : null;
  };
}

// ---------------------------------------------------------------------------
// Engine

const trimOut = (t) => (t.length > 4000 ? t.slice(-4000) : t);

/**
 * Run `steps`. io: { send(bytes), setSignals({dataTerminalReady|requestToSend}),
 * setBaud(n), buffer ({text, clear()}), isActive(), now, sleep, onUpdate(id, result), log(msg) }.
 * Returns { results, passed, aborted, vars }.
 */
export async function runScript(inputSteps, io, { gapMs = 200, maxExecutions = 10000, initialVars = {} } = {}) {
  const steps = inputSteps.map(normalizeStep);
  const now = io.now || Date.now;
  const sleep = io.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const isActive = io.isActive || (() => true);
  const vars = { ...initialVars };
  const results = {};
  let executions = 0;
  let passed = true;
  let aborted = false;

  const update = (step, patch) => {
    results[step.id] = { ...(results[step.id] || { iterations: [] }), ...patch };
    io.onUpdate?.(step.id, results[step.id]);
  };

  const sleepActive = async (ms) => {
    const end = now() + ms;
    while (isActive() && now() < end) await sleep(Math.min(100, Math.max(1, end - now())));
  };

  // One attempt of a step; returns { ok, output, captures, error, aborted }.
  const attempt = async (step) => {
    if (step.type === 'delay') {
      await sleepActive(Number(step.value) || 0);
      return isActive() ? { ok: true, output: '', captures: {} } : { ok: false, aborted: true, output: '', captures: {} };
    }
    if (step.type === 'dtr' || step.type === 'rts') {
      const on = ['1', 'true', 'high', 'on'].includes(String(step.value).toLowerCase());
      try {
        await io.setSignals?.(step.type === 'dtr' ? { dataTerminalReady: on } : { requestToSend: on });
        return { ok: true, output: '', captures: {} };
      } catch (e) { return { ok: false, error: e.message, output: '', captures: {} }; }
    }
    if (step.type === 'baud') {
      try {
        await io.setBaud?.(Number(step.value));
        return { ok: true, output: '', captures: {} };
      } catch (e) { return { ok: false, error: e.message, output: '', captures: {} }; }
    }
    // send (+ optional expect)
    let matcher = null;
    if (step.expect !== '') {
      try { matcher = buildMatcher(step, vars); } catch (e) {
        return { ok: false, error: `invalid pattern: ${e.message}`, output: '', captures: {} };
      }
    }
    io.buffer.clear();
    if (step.send !== '' || step.lineEnding !== 'none') {
      try { await io.send(encodeSend(step.send, { vars, lineEnding: step.lineEnding, format: step.sendFormat })); } catch (e) {
        return { ok: false, error: `send failed: ${e.message}`, output: '', captures: {} };
      }
    }
    if (!matcher) return { ok: true, output: '', captures: {} };
    const negate = step.expectMode === 'not';
    const w = await waitForMatch(io.buffer, matcher, step.timeoutMs, { isActive, now, sleep });
    const output = trimOut(io.buffer.text);
    if (w.aborted) return { ok: false, aborted: true, output, captures: {} };
    if (negate) {
      return w.matched
        ? { ok: false, error: `unexpected text "${step.expect}" appeared`, output, captures: {} }
        : { ok: true, output, captures: {} };
    }
    return w.matched
      ? { ok: true, output, captures: w.result.captures }
      : { ok: false, error: `expected "${step.expect}" timed out (${step.timeoutMs}ms)`, output, captures: {} };
  };

  const withRetries = async (step) => {
    let last;
    for (let a = 0; a <= step.retries; a++) {
      last = await attempt(step);
      if (last.ok || last.aborted) return { ...last, attempts: a + 1 };
    }
    return { ...last, attempts: step.retries + 1 };
  };

  let i = 0;
  mainLoop:
  while (i < steps.length) {
    if (!isActive()) { aborted = true; break; }
    const step = steps[i];
    let nextIndex = i + 1;
    if (step.disabled) {
      update(step, { status: 'skipped', timeMs: 0, iterations: [] });
      i = nextIndex;
      continue;
    }
    update(step, { status: 'running', timeMs: 0, iterations: [] });
    let stepTime = 0;
    const iterations = [];
    let stepFailed = false;
    let lastError = '';

    for (let it = 0; it < step.loopCount; it++) {
      if (++executions > maxExecutions) {
        update(step, { status: 'fail', error: 'execution limit reached (loop guard)', iterations });
        passed = false; aborted = true; break mainLoop;
      }
      const t0 = now();
      const r = await withRetries(step);
      const dt = now() - t0;
      stepTime += dt;
      if (r.aborted) {
        iterations.push({ ok: false, aborted: true, timeMs: dt, output: r.output });
        update(step, { status: 'aborted', timeMs: stepTime, iterations });
        passed = false; aborted = true; break mainLoop;
      }
      Object.assign(vars, r.captures);
      iterations.push({ ok: r.ok, timeMs: dt, output: r.output, captures: r.captures, error: r.error, attempts: r.attempts });
      update(step, { status: 'running', timeMs: stepTime, iterations: [...iterations] });
      if (step.loopMode === 'until') {
        if (r.ok) { stepFailed = false; break; }
        stepFailed = true; lastError = r.error || '';
        continue; // keep trying until max iterations
      }
      if (!r.ok) {
        stepFailed = true; lastError = r.error || '';
        if (step.onFail === 'continue') continue;
        break; // stop / goto: abandon remaining iterations
      }
    }

    const last = iterations[iterations.length - 1] || {};
    const status = stepFailed ? 'fail' : 'pass';
    update(step, {
      status, timeMs: stepTime, iterations,
      output: last.output || '', captures: last.captures || {}, error: stepFailed ? lastError : undefined,
    });
    if (stepFailed) {
      passed = false;
      if (step.onFail === 'stop') break;
      if (step.onFail === 'goto') {
        const target = steps.findIndex((x) => x.id === step.gotoId);
        if (target < 0) break;
        nextIndex = target;
      }
    }
    i = nextIndex;
    if (gapMs > 0 && i < steps.length && isActive()) await sleepActive(gapMs);
  }

  return { results, passed, aborted, vars };
}

// ---------------------------------------------------------------------------
// Reports

const xmlEsc = (v) => String(v ?? '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '?')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function stepLabel(step, idx) {
  const s = normalizeStep(step);
  const what = s.type === 'send' ? (s.send || s.expect || 'step') : `${s.type} ${s.value}`;
  return `#${idx + 1} ${what}`;
}

export function buildJUnit(suiteName, steps, results, { timestamp = new Date().toISOString() } = {}) {
  let failures = 0; let skipped = 0;
  const cases = steps.map((step, idx) => {
    const r = results[step.id];
    const time = ((r?.timeMs || 0) / 1000).toFixed(3);
    let inner = '';
    if (!r || r.status === 'running' || r.status === 'aborted' || r.status === 'skipped') {
      skipped++;
      inner = `<skipped message="${r?.status === 'aborted' ? 'aborted' : r?.status === 'skipped' ? 'disabled' : 'not run'}"/>`;
    } else if (r.status === 'fail') {
      failures++;
      inner = `<failure message="${xmlEsc(r.error || 'step failed')}"/>`;
    }
    const out = r?.output ? `<system-out>${xmlEsc(r.output)}</system-out>` : '';
    return `    <testcase name="${xmlEsc(stepLabel(step, idx))}" classname="${xmlEsc(suiteName)}" time="${time}">${inner}${out}</testcase>`;
  });
  const totalTime = (steps.reduce((a, s) => a + (results[s.id]?.timeMs || 0), 0) / 1000).toFixed(3);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="${xmlEsc(suiteName)}" tests="${steps.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${totalTime}" timestamp="${xmlEsc(timestamp)}">\n${cases.join('\n')}\n  </testsuite>\n</testsuites>\n`;
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(steps, results) {
  const head = ['index', 'type', 'send', 'expect', 'mode', 'status', 'iterations', 'time_ms', 'error', 'output'];
  const rows = steps.map((step, idx) => {
    const s = normalizeStep(step);
    const r = results[step.id];
    return [idx + 1, s.type, s.send, s.expect, s.expectMode, r?.status || 'untested',
      r?.iterations?.length || 0, r?.timeMs || 0, r?.error || '', r?.output || ''].map(csvCell).join(',');
  });
  return [head.join(','), ...rows].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Saved suites (localStorage-like storage + JSON import/export)

export const SUITES_KEY = 'skon.scriptSuites.v1';

export function loadSuites(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SUITES_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}
export function saveSuite(storage, name, steps) {
  const all = loadSuites(storage);
  all[name] = steps.map(normalizeStep);
  storage?.setItem(SUITES_KEY, JSON.stringify(all));
  return all;
}
export function deleteSuite(storage, name) {
  const all = loadSuites(storage);
  delete all[name];
  storage?.setItem(SUITES_KEY, JSON.stringify(all));
  return all;
}
export function exportSuiteJson(name, steps) {
  return JSON.stringify({ format: 'skon-script-suite', version: 1, name, steps: steps.map(normalizeStep) }, null, 2);
}
export function parseSuiteJson(text) {
  const data = JSON.parse(text);
  if (!data || !Array.isArray(data.steps)) throw new Error('not a script suite (missing "steps")');
  return { name: String(data.name || 'Imported suite'), steps: data.steps.map(normalizeStep) };
}

/** Reorder / duplicate helpers (pure). */
export function moveStep(steps, index, delta) {
  const j = index + delta;
  if (j < 0 || j >= steps.length) return steps;
  const next = steps.slice();
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}
export function duplicateStep(steps, index) {
  const copy = { ...steps[index], id: `${Date.now()}${Math.random().toString(36).slice(2, 5)}` };
  return [...steps.slice(0, index + 1), copy, ...steps.slice(index + 1)];
}
