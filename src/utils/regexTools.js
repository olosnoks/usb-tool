// Pure helpers for the Regex tester: flag normalization, the match function
// that runs inside the Web Worker (kept pure so it can be tested directly),
// a timeout-guarded runner, highlight segmentation, a pattern explainer, a code
// generator and permalink encoding. No network access anywhere in here.

export const ENGINE_LABEL = 'JavaScript (ECMAScript)';
export const DEFAULT_TIMEOUT_MS = 2000;
export const MAX_MATCHES = 10000;
/** Inputs this short are matched on the main thread (cannot hang in practice). */
export const TINY_TEXT_LENGTH = 12;

const FLAG_ORDER = 'dgimsuvy';

/** Keep only valid flags, drop duplicates, canonical order. `v` wins over `u`. */
export function normalizeFlags(input) {
  const seen = new Set(String(input ?? '').split('').filter((c) => FLAG_ORDER.includes(c)));
  if (seen.has('v')) seen.delete('u');
  return FLAG_ORDER.split('').filter((c) => seen.has(c)).join('');
}

// ------------------------------------------------------------- matching ----

const advance = (text, i, unicode) => {
  if (unicode && i < text.length) {
    const cp = text.codePointAt(i);
    return i + (cp > 0xffff ? 2 : 1);
  }
  return i + 1;
};

function toMatch(m) {
  const out = {
    index: m.index,
    length: m[0].length,
    text: m[0],
    groups: Array.from(m).slice(1),
    named: m.groups ? { ...m.groups } : {},
  };
  if (m.indices) out.indices = Array.from(m.indices).map((p) => (p ? [p[0], p[1]] : null));
  return out;
}

/**
 * The worker protocol function. Takes a plain request, returns a plain
 * (structured-cloneable) result:
 *   { matches: [{index,length,text,groups,named,indices?}], error, truncated,
 *     replaced?, split? }
 * modes: 'matches' (honours the g flag), 'matchAll' (forces g), 'split'.
 */
export function runMatch(req) {
  const { pattern = '', text = '', replacement = '', mode = 'matches', maxMatches = MAX_MATCHES } = req || {};
  let flags = normalizeFlags(req?.flags);
  const result = { matches: [], error: '', truncated: false, flags };
  if (!pattern) return result;
  if (mode === 'matchAll' && !flags.includes('g')) flags = normalizeFlags(`${flags}g`);
  let re;
  try { re = new RegExp(pattern, flags); } catch (e) { return { ...result, error: e.message }; }

  if (mode === 'split') {
    result.split = text.split(re).map((p) => (p === undefined ? null : p));
    if (result.split.length > maxMatches) { result.split = result.split.slice(0, maxMatches); result.truncated = true; }
  } else if (!flags.includes('g')) {
    const m = re.exec(text);
    if (m) result.matches.push(toMatch(m));
  } else {
    const unicode = flags.includes('u') || flags.includes('v');
    let m;
    while ((m = re.exec(text)) !== null) {
      result.matches.push(toMatch(m));
      if (m[0].length === 0) re.lastIndex = advance(text, re.lastIndex, unicode);
      if (result.matches.length >= maxMatches) { result.truncated = true; break; }
    }
  }
  if (replacement !== '' || mode !== 'split') {
    try { result.replaced = text.replace(new RegExp(pattern, flags), replacement); } catch { result.replaced = ''; }
  }
  return result;
}

/**
 * Create a runner that matches inside a Web Worker with a timeout.
 * `createWorker` returns a Worker-like ({postMessage, terminate, onmessage, onerror}).
 * Without it (or for tiny inputs) the match runs synchronously.
 */
export function createRegexRunner({ createWorker, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let worker = null;
  let pending = null; // { id, resolve, timer }
  let nextId = 1;
  let limit = timeoutMs;

  const kill = () => {
    if (pending) { clearTimeout(pending.timer); pending.resolve({ matches: [], error: '', superseded: true }); pending = null; }
    if (worker) { try { worker.terminate(); } catch { /* ignore */ } worker = null; }
  };

  const ensure = () => {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = (e) => {
      if (!pending || e.data?.id !== pending.id) return;
      clearTimeout(pending.timer);
      const { resolve } = pending;
      pending = null;
      resolve(e.data.result);
    };
    worker.onerror = (e) => {
      if (!pending) return;
      clearTimeout(pending.timer);
      const { resolve } = pending;
      pending = null;
      resolve({ matches: [], error: `Worker error: ${e?.message || 'unknown'}`, truncated: false });
    };
    return worker;
  };

  return {
    setTimeoutMs(ms) { limit = ms; },
    run(req) {
      const tiny = (req.text || '').length <= TINY_TEXT_LENGTH;
      if (!createWorker || tiny) {
        if (pending) kill();
        return Promise.resolve(runMatch(req));
      }
      kill();
      return new Promise((resolve) => {
        const id = nextId++;
        const w = ensure();
        const timer = setTimeout(() => {
          if (!pending || pending.id !== id) return;
          pending = null;
          try { w.terminate(); } catch { /* ignore */ }
          worker = null;
          resolve({ matches: [], error: '', truncated: false, timedOut: true, timeoutMs: limit });
        }, limit);
        pending = { id, resolve, timer };
        w.postMessage({ id, req });
      });
    },
    dispose: kill,
  };
}

export const timeoutMessage = (ms) =>
  `Timed out after ${ms / 1000} s: likely catastrophic backtracking. Avoid nested quantifiers such as (a+)+ or overlapping alternatives, or shorten the test string.`;

// ------------------------------------------------------------ highlighting ----

/**
 * Segment text for highlighting. Zero-width matches become { empty: true,
 * text: '' } marker segments, so the displayed text is never altered.
 */
export function highlightSegments(text, matches) {
  const segs = [];
  let pos = 0;
  matches.forEach((m, i) => {
    const start = m.index;
    const end = start + (m.length ?? m.text?.length ?? 0);
    if (start > pos) segs.push({ text: text.slice(pos, start), hit: false });
    if (end === start) segs.push({ text: '', hit: true, empty: true, i });
    else segs.push({ text: text.slice(start, end), hit: true, i });
    pos = Math.max(pos, end);
  });
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false });
  if (!segs.length && text) segs.push({ text, hit: false });
  return segs;
}

/** Did a case pass? expect: 'any' | 'match' | 'nomatch'. */
export function caseVerdict(matchCount, expect) {
  if (expect === 'match') return matchCount > 0;
  if (expect === 'nomatch') return matchCount === 0;
  return null;
}

// ------------------------------------------------------------- explainer ----

const ESC_DESC = {
  d: 'a digit (0-9)', D: 'any character that is not a digit', w: 'a word character (letter, digit or _)',
  W: 'any character that is not a word character', s: 'a whitespace character', S: 'any non-whitespace character',
  n: 'a line feed', r: 'a carriage return', t: 'a tab', f: 'a form feed', v: 'a vertical tab', 0: 'a NUL character',
};

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function quantDesc(min, max, lazy) {
  let base;
  if (min === 0 && max === Infinity) base = '0 or more times';
  else if (min === 1 && max === Infinity) base = '1 or more times';
  else if (min === 0 && max === 1) base = '0 or 1 time (optional)';
  else if (max === min) base = `exactly ${plural(min, 'time')}`;
  else if (max === Infinity) base = `${min} or more times`;
  else base = `between ${min} and ${max} times`;
  return `${base}, ${lazy ? 'as few as possible (lazy)' : 'as many as possible (greedy)'}`;
}

/**
 * Tokenize a JS regex into a tree of { type, text, desc, quantifier?, children? }.
 * Returns { nodes, error } (error is a string and nodes may be partial).
 */
export function explainPattern(pattern) {
  const src = String(pattern ?? '');
  let i = 0;
  let groupCount = 0;
  const fail = (msg) => { const e = new Error(msg); e.explain = true; throw e; };

  function parseEscape(inClass) {
    const start = i;
    i++; // backslash
    if (i >= src.length) fail('Pattern ends with a lone backslash');
    const c = src[i++];
    let type = 'escape';
    let desc;
    if (c === 'k' && src[i] === '<') {
      const end = src.indexOf('>', i);
      if (end < 0) fail('Unterminated \\k<name> reference');
      const name = src.slice(i + 1, end);
      i = end + 1;
      type = 'backreference'; desc = `Backreference to the named group "${name}"`;
    } else if (!inClass && c >= '1' && c <= '9') {
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++;
      type = 'backreference'; desc = `Backreference: the same text group ${src.slice(start + 1, i)} matched`;
    } else if (c === 'u' && src[i] === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) fail('Unterminated \\u{...} escape');
      desc = `Unicode code point U+${src.slice(i + 1, end).toUpperCase()}`; i = end + 1;
    } else if (c === 'u') {
      desc = `Unicode character U+${src.slice(i, i + 4).toUpperCase()}`; i += 4;
    } else if (c === 'x') {
      desc = `Character with hex code ${src.slice(i, i + 2).toUpperCase()}`; i += 2;
    } else if ((c === 'p' || c === 'P') && src[i] === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) fail('Unterminated \\p{...} escape');
      desc = `Any character ${c === 'p' ? 'with' : 'without'} the Unicode property ${src.slice(i + 1, end)}`; i = end + 1;
    } else if (c === 'c' && /[A-Za-z]/.test(src[i] || '')) {
      desc = `Control character ^${src[i].toUpperCase()}`; i++;
    } else if (c === 'b') {
      if (inClass) desc = 'a backspace character';
      else { type = 'anchor'; desc = 'Word boundary (between a word and a non-word character)'; }
    } else if (c === 'B') {
      type = 'anchor'; desc = 'Not a word boundary';
    } else if (ESC_DESC[c]) {
      desc = ESC_DESC[c];
      desc = desc[0].toUpperCase() + desc.slice(1);
    } else {
      type = 'literal'; desc = `Literal "${c}" (escaped)`;
    }
    return { type, text: src.slice(start, i), desc };
  }

  function parseClass() {
    const start = i;
    i++; // [
    const negate = src[i] === '^';
    if (negate) i++;
    const items = [];
    const readItem = () => {
      if (src[i] === '\\') { const e = parseEscape(true); return { text: e.text, desc: e.desc }; }
      const ch = String.fromCodePoint(src.codePointAt(i));
      i += ch.length;
      return { text: ch, desc: null };
    };
    while (i < src.length && src[i] !== ']') {
      const a = readItem();
      if (src[i] === '-' && src[i + 1] !== undefined && src[i + 1] !== ']') {
        i++;
        const b = readItem();
        items.push({ text: `${a.text}-${b.text}`, desc: 'range' });
      } else items.push(a);
    }
    if (src[i] !== ']') fail('Unterminated character class');
    i++;
    const list = items.length
      ? items.map((it) => (it.desc && it.desc !== 'range' ? `${it.text} (${it.desc})` : it.text)).join(', ')
      : '(nothing)';
    return {
      type: 'class',
      text: src.slice(start, i),
      desc: negate ? `Any single character except: ${list}` : `Any single character from: ${list}`,
      items: items.map((it) => it.text),
      negated: negate,
    };
  }

  function parseQuantifier(node) {
    const c = src[i];
    let min; let max; let qtext;
    if (c === '*') { min = 0; max = Infinity; qtext = '*'; i++; }
    else if (c === '+') { min = 1; max = Infinity; qtext = '+'; i++; }
    else if (c === '?') { min = 0; max = 1; qtext = '?'; i++; }
    else if (c === '{') {
      const m = /^\{(\d+)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (!m) return;
      min = Number(m[1]);
      max = m[2] ? (m[3] === '' ? Infinity : Number(m[3])) : min;
      qtext = m[0]; i += m[0].length;
    } else return;
    let lazy = false;
    if (src[i] === '?') { lazy = true; qtext += '?'; i++; }
    node.quantifier = { text: qtext, min, max: max === Infinity ? null : max, lazy, desc: quantDesc(min, max, lazy) };
  }

  function parseGroup() {
    const start = i;
    i++; // (
    let node;
    const rest = src.slice(i);
    if (rest.startsWith('?:')) { i += 2; node = { type: 'group', kind: 'non-capturing', desc: 'Non-capturing group' }; }
    else if (rest.startsWith('?=')) { i += 2; node = { type: 'lookaround', kind: 'lookahead', desc: 'Positive lookahead: what follows must match, without consuming it' }; }
    else if (rest.startsWith('?!')) { i += 2; node = { type: 'lookaround', kind: 'negative-lookahead', desc: 'Negative lookahead: what follows must not match' }; }
    else if (rest.startsWith('?<=')) { i += 3; node = { type: 'lookaround', kind: 'lookbehind', desc: 'Positive lookbehind: what precedes must match, without consuming it' }; }
    else if (rest.startsWith('?<!')) { i += 3; node = { type: 'lookaround', kind: 'negative-lookbehind', desc: 'Negative lookbehind: what precedes must not match' }; }
    else if (rest.startsWith('?<')) {
      const end = src.indexOf('>', i);
      if (end < 0) fail('Unterminated group name');
      const name = src.slice(i + 2, end);
      i = end + 1;
      node = { type: 'group', kind: 'named', name, number: ++groupCount, desc: `Named capture group "${name}" (group ${groupCount})` };
    } else if (/^\?[a-z-]+:/i.test(rest)) {
      const m = /^\?([a-z-]+):/i.exec(rest);
      i += m[0].length;
      node = { type: 'group', kind: 'modifiers', desc: `Non-capturing group with inline flags "${m[1]}"` };
    } else if (rest.startsWith('?')) fail('Unknown group syntax');
    else { node = { type: 'group', kind: 'capturing', number: ++groupCount, desc: `Capture group ${groupCount}` }; }
    node.children = parseAlternatives();
    if (src[i] !== ')') fail('Unterminated group: missing )');
    i++;
    node.text = src.slice(start, i);
    return node;
  }

  function parseAlternatives() {
    const alts = [[]];
    const starts = [i];
    const ends = [];
    while (i < src.length && src[i] !== ')') {
      if (src[i] === '|') { ends.push(i); i++; alts.push([]); starts.push(i); continue; }
      const seq = alts[alts.length - 1];
      const c = src[i];
      let node;
      if (c === '(') node = parseGroup();
      else if (c === '[') node = parseClass();
      else if (c === '\\') node = parseEscape(false);
      else if (c === '^') { i++; node = { type: 'anchor', text: '^', desc: 'Start of the string (or of each line with the m flag)' }; }
      else if (c === '$') { i++; node = { type: 'anchor', text: '$', desc: 'End of the string (or of each line with the m flag)' }; }
      else if (c === '.') { i++; node = { type: 'any', text: '.', desc: 'Any character except a line break (any character with the s flag)' }; }
      else if (c === '*' || c === '+' || c === '?') fail(`Nothing to repeat before "${c}"`);
      else { const ch = String.fromCodePoint(src.codePointAt(i)); i += ch.length; node = { type: 'literal', text: ch, desc: `Literal "${ch}"` }; }
      parseQuantifier(node);
      const prev = seq[seq.length - 1];
      if (node.type === 'literal' && !node.quantifier && node.desc.indexOf('escaped') < 0
        && prev && prev.type === 'literal' && !prev.quantifier && prev.merged !== false && prev.desc.indexOf('escaped') < 0) {
        prev.text += node.text;
        prev.desc = `Literal text "${prev.text}"`;
      } else seq.push(node);
    }
    ends.push(i);
    if (alts.length === 1) return alts[0];
    return [{
      type: 'alternation',
      text: src.slice(starts[0], ends[ends.length - 1]),
      desc: `Alternation: match one of ${alts.length} alternatives`,
      children: alts.map((seq, k) => ({ type: 'alternative', text: src.slice(starts[k], ends[k]), desc: `Alternative ${k + 1}`, children: seq })),
    }];
  }

  try {
    const nodes = parseAlternatives();
    if (i < src.length) fail('Unmatched )');
    return { nodes, error: '' };
  } catch (e) {
    if (e.explain) return { nodes: [], error: e.message };
    throw e;
  }
}

const full = (n) => n.text + (n.quantifier ? n.quantifier.text : '');

/** Flatten an explanation tree to indented lines (also used by tests). */
export function explainLines(nodes, depth = 0) {
  const out = [];
  for (const n of nodes) {
    out.push(`${'  '.repeat(depth)}${full(n)}  ${n.desc}${n.quantifier ? `, repeated ${n.quantifier.desc}` : ''}`);
    if (n.children) out.push(...explainLines(n.children, depth + 1));
  }
  return out;
}

// -------------------------------------------------------- code generator ----

export const LANGUAGES = [
  { id: 'js', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
  { id: 'php', label: 'PHP' },
  { id: 'go', label: 'Go' },
  { id: 'csharp', label: 'C#' },
];

const pyStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`;
const phpStr = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const jsonStr = (s) => JSON.stringify(String(s)).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');

/** Tokenize a JS replacement string: $$, $&, $n, $<name>, literal text. */
function replTokens(r) {
  const out = [];
  let lit = '';
  const flush = () => { if (lit) { out.push({ lit }); lit = ''; } };
  for (let i = 0; i < r.length; i++) {
    if (r[i] === '$') {
      const rest = r.slice(i + 1);
      let m;
      if (rest[0] === '$') { flush(); out.push({ dollar: true }); i++; continue; }
      if (rest[0] === '&') { flush(); out.push({ ref: '0' }); i++; continue; }
      if ((m = /^(\d{1,2})/.exec(rest))) { flush(); out.push({ ref: String(Number(m[1])) }); i += m[1].length; continue; }
      if ((m = /^<([A-Za-z_]\w*)>/.exec(rest))) { flush(); out.push({ ref: m[1] }); i += m[0].length; continue; }
    }
    lit += r[i];
  }
  flush();
  return out;
}

function convertReplacement(lang, r) {
  const toks = replTokens(r);
  switch (lang) {
    case 'python': return toks.map((t) => (t.lit !== undefined ? t.lit.replace(/\\/g, '\\\\') : t.dollar ? '$' : `\\g<${t.ref}>`)).join('');
    case 'php': return toks.map((t) => (t.lit !== undefined ? t.lit.replace(/\\/g, '\\\\') : t.dollar ? '\\$' : `\${${/^\d+$/.test(t.ref) ? t.ref : '1'}}`)).join('');
    case 'go': return toks.map((t) => (t.lit !== undefined ? t.lit.replace(/\$/g, '$$$$') : t.dollar ? '$$' : `\${${t.ref}}`)).join('');
    case 'csharp': return toks.map((t) => (t.lit !== undefined ? t.lit.replace(/\$/g, '$$$$') : t.dollar ? '$$' : t.ref === '0' ? '$&' : `\${${t.ref}}`)).join('');
    default: return r;
  }
}

const hasNamedRef = (r) => replTokens(r).some((t) => t.ref !== undefined && !/^\d+$/.test(t.ref));
const hasLookaround = (p) => /\(\?<?[=!]/.test(p);
const hasBackref = (p) => /\\[1-9]|\\k</.test(p);
const toNamedP = (p) => p.replace(/\(\?<(?![=!])([A-Za-z_]\w*)>/g, '(?P<$1>').replace(/\\k<([A-Za-z_]\w*)>/g, '(?P=$1)');

/**
 * Generate a runnable snippet for `lang`. state = { pattern, flags, text, replacement }.
 * The snippet iterates matches and, when a replacement is set, performs the substitution.
 */
export function generateCode(lang, state) {
  const pattern = String(state.pattern ?? '');
  const flags = normalizeFlags(state.flags);
  const text = String(state.text ?? '');
  const repl = String(state.replacement ?? '');
  const g = flags.includes('g');
  const notes = [];
  const unsupported = (names) => `Flags not supported in this language and ignored: ${names}`;
  let code;

  if (lang === 'js') {
    const lit = /[/\n\r]/.test(pattern) || pattern.includes(String.fromCharCode(0x2028)) || pattern.includes(String.fromCharCode(0x2029)) || !pattern ? `new RegExp(${jsonStr(pattern)}, ${jsonStr(flags)})` : `/${pattern}/${flags}`;
    const lines = [`const re = ${lit};`, `const text = ${jsonStr(text)};`];
    if (g) lines.push('for (const m of text.matchAll(re)) {', '  console.log(m.index, m[0], m.slice(1), m.groups);', '}');
    else lines.push('const m = re.exec(text);', 'console.log(m);');
    if (repl !== '') lines.push(`const result = text.replace(re, ${jsonStr(repl)});`, 'console.log(result);');
    code = lines.join('\n');
  } else if (lang === 'python') {
    const map = { i: 're.IGNORECASE', m: 're.MULTILINE', s: 're.DOTALL' };
    const pf = flags.split('').filter((f) => map[f]).map((f) => map[f]);
    const ignored = flags.split('').filter((f) => !map[f] && f !== 'g' && f !== 'u');
    if (ignored.length) notes.push(unsupported(ignored.join('')));
    const p = toNamedP(pattern);
    const raw = !/["\n\r]/.test(p) && !/(^|[^\\])(\\\\)*\\$/.test(p) && p !== '' ? `r"${p}"` : pyStr(p);
    const lines = ['import re', '', `pattern = re.compile(${raw}${pf.length ? `, ${pf.join(' | ')}` : ''})`, `text = ${pyStr(text)}`];
    if (g) lines.push('for m in pattern.finditer(text):', '    print(m.start(), m.group(0), m.groups())');
    else lines.push('m = pattern.search(text)', 'print(m and (m.start(), m.group(0), m.groups()))');
    if (repl !== '') { const rp = convertReplacement('python', repl); const lit = !/["\n\r]/.test(rp) && !/(^|[^\\])(\\\\)*\\$/.test(rp) ? `r"${rp}"` : pyStr(rp); lines.push(`result = pattern.sub(${lit}, text${g ? '' : ', count=1'})`, 'print(result)'); }
    code = lines.join('\n');
  } else if (lang === 'php') {
    const map = { i: 'i', m: 'm', s: 's', u: 'u' };
    const pf = flags.split('').filter((f) => map[f]).join('');
    const ignored = flags.split('').filter((f) => !map[f] && f !== 'g');
    if (ignored.length) notes.push(unsupported(ignored.join('')));
    let esc = '';
    for (let k = 0; k < pattern.length; k++) {
      if (pattern[k] === '\\') { esc += pattern.slice(k, k + 2); k++; continue; }
      esc += pattern[k] === '/' ? '\\/' : pattern[k];
    }
    const lines = ['<?php', `$pattern = ${phpStr(`/${esc}/${pf}`)};`, `$text = ${phpStr(text)};`];
    if (g) lines.push('preg_match_all($pattern, $text, $matches, PREG_SET_ORDER);', 'print_r($matches);');
    else lines.push('preg_match($pattern, $text, $m);', 'print_r($m);');
    if (repl !== '') {
      if (hasNamedRef(repl)) notes.push('preg_replace has no named references; replaced with ${1}, edit by hand.');
      lines.push(`$result = preg_replace($pattern, ${phpStr(convertReplacement('php', repl))}, $text${g ? '' : ', 1'});`, 'echo $result;');
    }
    code = lines.join('\n');
  } else if (lang === 'go') {
    const map = { i: 'i', m: 'm', s: 's' };
    const pf = flags.split('').filter((f) => map[f]).join('');
    const ignored = flags.split('').filter((f) => !map[f] && f !== 'g');
    if (ignored.length) notes.push(unsupported(ignored.join('')));
    if (hasLookaround(pattern) || hasBackref(pattern)) notes.push('Go RE2 has no lookarounds or backreferences: this pattern will not compile.');
    const p = `${pf ? `(?${pf})` : ''}${toNamedP(pattern).replace(/\(\?P=(\w+)\)/g, '(?P=$1)')}`;
    const lit = p.includes('`') ? jsonStr(p) : `\`${p}\``;
    const lines = [
      'package main', '', 'import (', '\t"fmt"', '\t"regexp"', ')', '', 'func main() {',
      `\tre := regexp.MustCompile(${lit})`, `\ttext := ${jsonStr(text)}`,
      g ? '\tfmt.Println(re.FindAllStringSubmatch(text, -1))' : '\tfmt.Println(re.FindStringSubmatch(text))',
    ];
    if (repl !== '') {
      if (!g) notes.push('Go has no replace-first helper; ReplaceAllString replaces every match.');
      lines.push(`\tfmt.Println(re.ReplaceAllString(text, ${jsonStr(convertReplacement('go', repl))}))`);
    }
    lines.push('}');
    code = lines.join('\n');
  } else if (lang === 'csharp') {
    const map = { i: 'RegexOptions.IgnoreCase', m: 'RegexOptions.Multiline', s: 'RegexOptions.Singleline' };
    const pf = flags.split('').filter((f) => map[f]).map((f) => map[f]);
    const ignored = flags.split('').filter((f) => !map[f] && f !== 'g' && f !== 'u');
    if (ignored.length) notes.push(unsupported(ignored.join('')));
    const lines = ['using System;', 'using System.Text.RegularExpressions;', '',
      `var re = new Regex(@"${pattern.replace(/"/g, '""')}"${pf.length ? `, ${pf.join(' | ')}` : ''});`,
      `var text = ${jsonStr(text)};`];
    if (g) lines.push('foreach (Match m in re.Matches(text))', '{', '    Console.WriteLine($"{m.Index}: {m.Value}");', '}');
    else lines.push('var m = re.Match(text);', 'Console.WriteLine(m.Success ? $"{m.Index}: {m.Value}" : "no match");');
    if (repl !== '') lines.push(`var result = re.Replace(text, ${jsonStr(convertReplacement('csharp', repl))}${g ? '' : ', 1'});`, 'Console.WriteLine(result);');
    code = lines.join('\n');
  } else {
    throw new Error(`Unknown language: ${lang}`);
  }
  const cmt = lang === 'python' ? '#' : lang === 'php' ? '//' : '//';
  return notes.length ? `${notes.map((n) => `${cmt} ${n}`).join('\n')}\n${code}` : code;
}

// -------------------------------------------------------------- library ----

export const PATTERN_LIBRARY = [
  { name: 'Email address', pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', flags: 'gi', sample: 'Write to alice@example.com or bob.smith+tag@mail.example.org.' },
  { name: 'URL (http/https)', pattern: 'https?:\\/\\/[^\\s/$.?#].[^\\s]*', flags: 'gi', sample: 'See https://example.com/a?b=1 and http://test.org.' },
  { name: 'IPv4 address', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', flags: 'g', sample: 'Hosts 192.168.1.10, 10.0.0.255 and 999.1.1.1.' },
  { name: 'MAC address', pattern: '\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b', flags: 'g', sample: 'AA:BB:CC:DD:EE:FF and 00-11-22-33-44-55' },
  { name: 'UUID', pattern: '\\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\b', flags: 'gi', sample: 'id=123e4567-e89b-12d3-a456-426614174000' },
  { name: 'Hex color', pattern: '#(?:[0-9a-fA-F]{3}){1,2}\\b', flags: 'g', sample: 'colors #fff, #1a2B3c and #12' },
  { name: 'ISO date (named groups)', pattern: '(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})', flags: 'g', sample: 'From 2024-03-09 to 2025-12-31.' },
  { name: 'Semantic version', pattern: '\\bv?(\\d+)\\.(\\d+)\\.(\\d+)(?:-([\\w.]+))?\\b', flags: 'g', sample: 'v1.2.3, 2.0.0-rc.1 and 10.20.30' },
  { name: 'Hex byte string', pattern: '(?:\\b[0-9a-fA-F]{2}\\b[ :]?)+', flags: 'g', sample: 'dump: de ad be ef 00 ff' },
  { name: 'Duplicate words', pattern: '\\b(\\w+)\\s+\\1\\b', flags: 'gi', sample: 'This is is a test test of the the system.' },
];

// -------------------------------------------------------------- permalink ----

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const HASH_KEY = 'regex=';

/** State -> hash fragment payload (without '#'). */
export function encodeState(state) {
  const s = {
    p: String(state.pattern ?? ''),
    f: normalizeFlags(state.flags),
    t: String(state.text ?? ''),
    r: String(state.replacement ?? ''),
    m: state.mode || 'matches',
  };
  if (Array.isArray(state.cases) && state.cases.length) s.c = state.cases.map((c) => [String(c.text ?? ''), c.expect || 'any']);
  return `${HASH_KEY}${b64urlEncode(JSON.stringify(s))}`;
}

/** Parse "#regex=..." (or the bare payload). Returns null when absent or malformed. */
export function decodeState(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  if (!h.startsWith(HASH_KEY)) return null;
  try {
    const s = JSON.parse(b64urlDecode(h.slice(HASH_KEY.length)));
    if (!s || typeof s.p !== 'string') return null;
    return {
      pattern: s.p,
      flags: normalizeFlags(s.f),
      text: typeof s.t === 'string' ? s.t : '',
      replacement: typeof s.r === 'string' ? s.r : '',
      mode: ['matches', 'matchAll', 'split'].includes(s.m) ? s.m : 'matches',
      cases: Array.isArray(s.c) ? s.c.filter((c) => Array.isArray(c)).map((c) => ({ text: String(c[0] ?? ''), expect: ['any', 'match', 'nomatch'].includes(c[1]) ? c[1] : 'any' })) : [],
    };
  } catch { return null; }
}

/** Full shareable URL. The ?tool= query makes the app open the Regex Tester; the state rides in the hash. */
export function buildPermalink(state, loc = { origin: '', pathname: '/' }) {
  return `${loc.origin}${loc.pathname}?tool=regex-tester#${encodeState(state)}`;
}
