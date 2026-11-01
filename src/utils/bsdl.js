/**
 * bsdl.js — read a BSDL (Boundary Scan Description Language) file and turn
 * boundary-register bits into pin levels, or pin levels into an EXTEST vector.
 *
 * Only the attributes needed for boundary scan are read: INSTRUCTION_LENGTH,
 * INSTRUCTION_OPCODE, IDCODE_REGISTER, BOUNDARY_LENGTH, BOUNDARY_REGISTER and
 * the PIN_MAP_STRING.
 */

/** Concatenate the "..." & "..." string pieces that follow `attribute NAME of ... is`. */
function attributeString(text, name) {
  const re = new RegExp(`attribute\\s+${name}\\s+of\\s+\\w+\\s*:\\s*entity\\s+is\\s*([\\s\\S]*?);`, 'i');
  const m = text.match(re);
  if (!m) return null;
  const parts = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  return parts.length ? parts.join('') : m[1].trim();
}

function constantString(text, name) {
  const re = new RegExp(`constant\\s+${name}\\s*:\\s*PIN_MAP_STRING\\s*:=\\s*([\\s\\S]*?);`, 'i');
  const m = text.match(re);
  return m ? [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]).join('') : null;
}

export function parseBsdl(text) {
  const clean = String(text).replace(/--[^\n]*/g, '');
  const entity = clean.match(/entity\s+(\w+)\s+is/i)?.[1] || 'unknown';
  const irLength = Number(attributeString(clean, 'INSTRUCTION_LENGTH'));
  const bsrLength = Number(attributeString(clean, 'BOUNDARY_LENGTH'));
  if (!irLength || !bsrLength) throw new Error('Not a BSDL file: INSTRUCTION_LENGTH or BOUNDARY_LENGTH is missing.');

  const opcodes = {};
  for (const m of (attributeString(clean, 'INSTRUCTION_OPCODE') || '').matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    opcodes[m[1].toUpperCase()] = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  }
  const idRaw = attributeString(clean, 'IDCODE_REGISTER');
  const idcode = idRaw ? idRaw.replace(/\s+/g, '') : null;

  const cells = [];
  for (const [num, body] of cellEntries(attributeString(clean, 'BOUNDARY_REGISTER') || '')) {
    const f = splitTopLevel(body);
    cells.push({
      num,
      cell: f[0],
      port: f[1] === '*' ? null : f[1],
      function: (f[2] || '').toLowerCase(),
      safe: f[3],
      control: f[4] !== undefined ? Number(f[4]) : null,
      disableValue: f[5] !== undefined ? Number(f[5]) : null,
      disableResult: f[6] || null
    });
  }
  cells.sort((a, b) => a.num - b.num);

  const pins = {};
  const mapName = clean.match(/attribute\s+PIN_MAP\s+of\s+\w+\s*:\s*entity\s+is\s+PHYSICAL_PIN_MAP/i) ? clean.match(/constant\s+(\w+)\s*:\s*PIN_MAP_STRING/i)?.[1] : null;
  const pinMap = mapName ? constantString(clean, mapName) : null;
  if (pinMap) {
    for (const m of pinMap.matchAll(/(\w+)\s*:\s*(\([^)]*\)|[\w]+)/g)) {
      pins[m[1]] = m[2].replace(/[()\s]/g, '').split(',');
    }
  }
  return { entity, irLength, bsrLength, opcodes, idcode, cells, pins };
}

/** "12 (BC_1, D(3), input, X), 13 (...)" -> [[12, 'BC_1, D(3), input, X'], ...], honouring nested parentheses. */
function cellEntries(text) {
  const out = [];
  const re = /(\d+)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < text.length && depth; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
    }
    out.push([Number(m[1]), text.slice(re.lastIndex, i - 1)]);
    re.lastIndex = i;
  }
  return out;
}

function splitTopLevel(body) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** Package pin(s) of a port: "IO_A0" or an element of a vector port "D(3)". */
export function portPins(bsdl, port) {
  const v = port.match(/^(\w+)\((\d+)\)$/);
  if (v) {
    const list = bsdl.pins[v[1]] || [];
    return list[Number(v[2])] ? [list[Number(v[2])]] : [];
  }
  return bsdl.pins[port] || [];
}

/** First opcode of an instruction as a number (BSDL writes them as bit strings, MSB first). */
export function opcodeValue(bsdl, name) {
  const s = bsdl.opcodes[name.toUpperCase()]?.[0];
  return s ? parseInt(s.replace(/[^01]/g, ''), 2) : null;
}

/** Does a 32-bit IDCODE match the BSDL's IDCODE_REGISTER (X = don't care)? */
export function idcodeMatches(bsdl, idcode) {
  if (!bsdl.idcode || bsdl.idcode.length !== 32) return null;
  for (let i = 0; i < 32; i++) {
    const want = bsdl.idcode[i];
    const bit = (idcode >>> (31 - i)) & 1;
    if ((want === '0' || want === '1') && Number(want) !== bit) return false;
  }
  return true;
}

/**
 * Pins with their sampled levels. `bits[n]` is boundary cell n (cell 0 is
 * nearest TDO, so it is the first bit out). Output pins report whether
 * their driver is enabled.
 */
export function pinStates(bsdl, bits) {
  const byPort = new Map();
  for (const c of bsdl.cells) {
    if (!c.port) continue;
    const e = byPort.get(c.port) || { port: c.port, pins: portPins(bsdl, c.port), input: null, output: null };
    if (['input', 'clock', 'observe_only', 'bidir'].includes(c.function)) e.inputCell = c.num;
    if (['output2', 'output3', 'bidir'].includes(c.function)) { e.outputCell = c.num; e.controlCell = c.control; e.disableValue = c.disableValue; }
    byPort.set(c.port, e);
  }
  return [...byPort.values()].map((e) => ({
    ...e,
    input: e.inputCell !== undefined ? bits[e.inputCell] ?? null : null,
    output: e.outputCell !== undefined ? bits[e.outputCell] ?? null : null,
    driving: e.controlCell !== undefined && e.controlCell !== null ? bits[e.controlCell] !== e.disableValue : e.outputCell !== undefined
  })).sort((a, b) => a.port.localeCompare(b.port, undefined, { numeric: true }));
}

/**
 * Boundary register contents for EXTEST: every cell at its safe value, then
 * for each driven port its output cell set and its control cell enabled.
 * drive: { portName: 0 | 1 }
 */
export function extestVector(bsdl, drive) {
  const v = new Array(bsdl.bsrLength).fill(0);
  for (const c of bsdl.cells) v[c.num] = c.safe === '1' ? 1 : 0;
  for (const [port, level] of Object.entries(drive)) {
    const out = bsdl.cells.find((c) => c.port === port && ['output2', 'output3', 'bidir'].includes(c.function));
    if (!out) throw new Error(`${port} has no output cell.`);
    v[out.num] = level ? 1 : 0;
    if (out.control !== null) v[out.control] = out.disableValue ? 0 : 1;
  }
  return v;
}
