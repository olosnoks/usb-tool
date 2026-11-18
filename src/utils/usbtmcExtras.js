// Pure helpers for the USBTMC workbench (script expansion, logger statistics, PyVISA export).

export const MAX_SCRIPT_STEPS = 5000;

/**
 * Expand a script into a flat list of steps.
 * Syntax: one command per line, "# comment", "wait <ms>", and "repeat <n>" ... "end" (nestable).
 * Returns { steps: [{ type: 'cmd'|'wait', text|ms, line }], error }.
 */
export function expandScript(text) {
  const root = [];
  const stack = [{ count: 1, body: root, line: 0 }];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const rep = line.match(/^repeat\s+(\d+)$/i);
    if (rep) {
      const n = Number(rep[1]);
      if (n < 1 || n > MAX_SCRIPT_STEPS) return { steps: [], error: `Line ${i + 1}: repeat count must be 1-${MAX_SCRIPT_STEPS}.` };
      const block = { count: n, body: [], line: i + 1 };
      stack[stack.length - 1].body.push({ block });
      stack.push(block);
      continue;
    }
    if (/^end$/i.test(line)) {
      if (stack.length === 1) return { steps: [], error: `Line ${i + 1}: "end" without "repeat".` };
      stack.pop();
      continue;
    }
    const wait = line.match(/^wait\s+(\d+)$/i);
    stack[stack.length - 1].body.push(wait ? { type: 'wait', ms: Number(wait[1]), line: i + 1 } : { type: 'cmd', text: line, line: i + 1 });
  }
  if (stack.length > 1) return { steps: [], error: `Line ${stack[stack.length - 1].line}: "repeat" is missing its "end".` };
  const out = [];
  let overflow = false;
  const walk = (body) => {
    for (const item of body) {
      if (overflow) return;
      if (item.block) {
        for (let k = 0; k < item.block.count && !overflow; k++) walk(item.block.body);
      } else if (out.length >= MAX_SCRIPT_STEPS) overflow = true;
      else out.push(item);
    }
  };
  walk(root);
  if (overflow) return { steps: [], error: `Script expands to more than ${MAX_SCRIPT_STEPS} steps.` };
  return { steps: out, error: null };
}

/** Statistics over logger readings (non-finite values ignored). Single pass for mean, then variance. */
export function loggerStats(values) {
  const f = values.filter(Number.isFinite);
  if (!f.length) return null;
  const mean = f.reduce((a, b) => a + b, 0) / f.length;
  const variance = f.reduce((a, b) => a + (b - mean) ** 2, 0) / f.length;
  let min = Infinity;
  let max = -Infinity;
  for (const v of f) { if (v < min) min = v; if (v > max) max = v; }
  return { last: values[values.length - 1], min, max, avg: mean, std: Math.sqrt(variance), count: f.length };
}

/** Count readings outside [low, high]; blank/NaN limits are ignored. */
export function limitViolations(values, low, high) {
  const lo = low === '' || low === null || low === undefined ? NaN : Number(low);
  const hi = high === '' || high === null || high === undefined ? NaN : Number(high);
  let below = 0;
  let above = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (Number.isFinite(lo) && v < lo) below++;
    else if (Number.isFinite(hi) && v > hi) above++;
  }
  return { below, above, total: below + above };
}

export function isOutOfLimits(v, low, high) {
  return limitViolations([v], low, high).total > 0;
}

const pyStr = (s) => `'${String(s).replace(/\/g, '\\').replace(/'/g, "\'")}'`;

/**
 * Export steps as a PyVISA script (a starting point for the CLI/Python world; not executed here).
 * resource defaults to a placeholder: the browser does not expose the VISA resource string.
 */
export function toPyvisaScript(steps, { resource = 'USB0::0x0000::0x0000::SERIAL::INSTR', timeoutMs = 5000 } = {}) {
  const lines = [
    'import time',
    'import pyvisa',
    '',
    'rm = pyvisa.ResourceManager()',
    `inst = rm.open_resource(${pyStr(resource)})  # edit: run rm.list_resources() to find yours`,
    `inst.timeout = ${Math.max(100, Number(timeoutMs) || 5000)}`,
    ''
  ];
  for (const s of steps) {
    if (s.type === 'wait') lines.push(`time.sleep(${s.ms / 1000})`);
    else if (s.text.includes('?')) lines.push(`print(${pyStr(s.text)}, '->', inst.query(${pyStr(s.text)}).strip())`);
    else lines.push(`inst.write(${pyStr(s.text)})`);
  }
  lines.push('', 'inst.close()', '');
  return lines.join('\n');
}
