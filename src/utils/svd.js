/**
 * CMSIS-SVD reader: peripherals, registers and bit fields of a Cortex-M
 * device, from the .svd file in a CMSIS-Pack or one the user supplies.
 *
 * Handles derivedFrom (peripherals, clusters, registers, fields), dim arrays
 * (%s / [%s] names, lists and ranges), clusters, inherited size / access /
 * reset defaults, enumerated values and the three bit-range spellings.
 * No DOM needed: a small XML tokenizer builds the tree, so it runs in tests.
 */

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (t) => t.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? m;
});

function parseXml(xml) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[6] !== undefined) { top.text += decode(m[6]); continue; }
    if (m[3] === undefined) continue; // comment, PI, doctype
    if (m[2]) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const attrs = {};
    for (const a of m[4].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decode(a[2] ?? a[3]);
    const node = { tag: m[3], attrs, children: [], text: '' };
    top.children.push(node);
    if (!m[5]) stack.push(node);
  }
  return root;
}

const kids = (n, tag) => n.children.filter((c) => c.tag === tag);
const kid = (n, tag) => n.children.find((c) => c.tag === tag);
const txt = (n, tag) => { const c = kid(n, tag); return c ? c.text.trim() : undefined; };

// ---------------------------------------------------------------------------
// Numbers, names, dim arrays
// ---------------------------------------------------------------------------

/** SVD scaled non-negative integer: decimal, 0x hex, #binary. Returns undefined when absent or unparseable. */
export function svdNumber(s) {
  if (s === undefined || s === null) return undefined;
  const t = String(s).trim();
  if (!t) return undefined;
  let v;
  if (/^[+-]?0x[0-9a-f]+$/i.test(t)) v = parseInt(t, 16);
  else if (/^#[01]+$/.test(t)) v = parseInt(t.slice(1), 2);
  else if (/^0b[01]+$/i.test(t)) v = parseInt(t.slice(2), 2);
  else if (/^[+-]?\d+$/.test(t)) v = parseInt(t, 10);
  else return undefined;
  return Number.isNaN(v) ? undefined : v;
}

/** dimIndex: "0,1,2", "0-3", "A-C" or a mix. Without one the indexes are 0..dim-1. */
function dimIndexes(dim, dimIndex) {
  if (!dimIndex) return Array.from({ length: dim }, (_, i) => String(i));
  const out = [];
  for (const part of dimIndex.split(',').map((x) => x.trim()).filter(Boolean)) {
    const r = part.match(/^(\d+)\s*-\s*(\d+)$/) || null;
    const c = part.match(/^([A-Za-z])\s*-\s*([A-Za-z])$/);
    if (r) for (let i = Number(r[1]); i <= Number(r[2]); i++) out.push(String(i));
    else if (c) for (let i = c[1].charCodeAt(0); i <= c[2].charCodeAt(0); i++) out.push(String.fromCharCode(i));
    else out.push(part);
  }
  return out;
}

const fillName = (name, idx) => (name === undefined ? name : name.replace(/\[%s\]/g, idx).replace(/%s/g, idx));

/** Elements with <dim>: [{ node, index, i }] for each copy (a single one without dim). */
function expandDim(node) {
  const dim = svdNumber(txt(node, 'dim'));
  if (!dim) return [{ index: null, i: 0 }];
  const idx = dimIndexes(dim, txt(node, 'dimIndex'));
  return idx.slice(0, dim).map((index, i) => ({ index, i }));
}

const ACCESS = { 'read-only': 'read-only', 'write-only': 'write-only', 'read-write': 'read-write', writeOnce: 'writeOnce', 'read-writeOnce': 'read-writeOnce' };

// ---------------------------------------------------------------------------
// SVD model
// ---------------------------------------------------------------------------

/**
 * Parse an SVD document.
 * @returns {{ name, description, cpu, width, peripherals: Array }}
 *   peripherals[]: { name, description, baseAddress, groupName, registers[] }
 *   registers[]:   { name, path, description, address, size, access, resetValue, sideEffects, fields[] }
 *   fields[]:      { name, description, bitOffset, bitWidth, access, enums[] }
 */
export function parseSvd(xml) {
  const doc = parseXml(xml);
  const dev = kid(doc, 'device');
  if (!dev) throw new Error('Not an SVD file: no <device> element.');

  const defaults = (n, parent = {}) => ({
    size: svdNumber(txt(n, 'size')) ?? parent.size,
    access: ACCESS[txt(n, 'access')] ?? parent.access,
    resetValue: svdNumber(txt(n, 'resetValue')) ?? parent.resetValue,
    resetMask: svdNumber(txt(n, 'resetMask')) ?? parent.resetMask
  });
  const devDefaults = { size: 32, access: 'read-write', resetValue: 0, ...defaults(dev) };

  // Peripheral nodes by name for derivedFrom (a derived node takes the base's children where it has none).
  const periphNodes = new Map();
  const periphElems = kid(dev, 'peripherals')?.children.filter((c) => c.tag === 'peripheral') ?? [];
  for (const p of periphElems) periphNodes.set(txt(p, 'name'), p);

  const resolveBase = (node, lookup, seen = new Set()) => {
    const from = node.attrs.derivedFrom;
    if (!from || seen.has(node)) return null;
    seen.add(node);
    return lookup(from);
  };

  // Children of `node` with the base's added for tags the node lacks.
  const withBase = (node, lookup, tags) => {
    const base = resolveBase(node, lookup);
    const out = { node, base: base ? withBase(base, lookup, tags).merged : null };
    const merged = {};
    for (const t of tags) {
      const own = kids(node, t);
      merged[t] = own.length ? own : (out.base ? out.base[t] : []);
    }
    out.merged = merged;
    return out;
  };

  const lookupPeripheral = (name) => periphNodes.get(name);

  const makeFields = (regNode, regLookup) => {
    const { merged } = withBase(regNode, regLookup, ['fields']);
    const fieldsEl = merged.fields[0];
    const fields = [];
    const fieldNodes = fieldsEl ? kids(fieldsEl, 'field') : [];
    const fieldLookup = (name) => fieldNodes.find((f) => txt(f, 'name') === name);
    for (const f of fieldNodes) {
      const base = resolveBase(f, fieldLookup);
      const pick = (t) => txt(f, t) ?? (base ? txt(base, t) : undefined);
      for (const { index } of expandDim(f)) {
        let bitOffset = svdNumber(pick('bitOffset'));
        let bitWidth = svdNumber(pick('bitWidth'));
        const range = pick('bitRange')?.match(/\[\s*(\d+)\s*:\s*(\d+)\s*\]/);
        const lsb = svdNumber(pick('lsb'));
        const msb = svdNumber(pick('msb'));
        if (range) { bitOffset = Number(range[2]); bitWidth = Number(range[1]) - Number(range[2]) + 1; }
        else if (lsb !== undefined && msb !== undefined) { bitOffset = lsb; bitWidth = msb - lsb + 1; }
        if (bitOffset === undefined) continue;
        if (bitWidth === undefined) bitWidth = 1;
        const enumsEl = kid(f, 'enumeratedValues') ?? (base ? kid(base, 'enumeratedValues') : undefined);
        const enums = enumsEl
          ? kids(enumsEl, 'enumeratedValue')
            .map((e) => ({ name: txt(e, 'name'), value: svdNumber(txt(e, 'value')), description: txt(e, 'description') }))
            .filter((e) => e.value !== undefined && e.name)
          : [];
        const dimStep = svdNumber(txt(f, 'dimIncrement')) ?? bitWidth;
        const i = index === null ? 0 : expandDim(f).findIndex((x) => x.index === index);
        fields.push({
          name: fillName(pick('name'), index ?? ''),
          description: fillName(pick('description') ?? '', index ?? ''),
          bitOffset: bitOffset + (index === null ? 0 : i * dimStep),
          bitWidth,
          access: ACCESS[pick('access')],
          readAction: pick('readAction'),
          enums
        });
      }
    }
    return fields;
  };

  // Registers of a peripheral or cluster, flattened with absolute addresses.
  const collect = (container, regLookup, base, defs, prefix, out) => {
    const { merged } = withBase(container, regLookup, ['registers', 'cluster']);
    const regsEl = merged.registers[0] ? merged.registers : [];
    const registerNodes = regsEl.length ? kids(merged.registers[0], 'register') : kids(container, 'register');
    const clusterNodes = merged.cluster.length ? merged.cluster : kids(container, 'cluster');
    // SVD puts <register>/<cluster> directly under <registers> (peripheral) or <cluster>.
    const directRegs = container.tag === 'cluster' ? kids(container, 'register') : [];
    const allRegs = [...registerNodes, ...directRegs.filter((r) => !registerNodes.includes(r))];
    const regByName = (name) => allRegs.find((r) => txt(r, 'name') === name);
    const lookup = (name) => regByName(name) ?? regLookup(name);

    for (const r of allRegs) {
      const rbase = resolveBase(r, lookup);
      const pick = (t) => txt(r, t) ?? (rbase ? txt(rbase, t) : undefined);
      const rd = { ...defs, ...stripUndef(defaults(r, defs)) };
      const baseDims = expandDim(r);
      const incr = svdNumber(pick('dimIncrement')) ?? 0;
      const offset = svdNumber(pick('addressOffset')) ?? 0;
      baseDims.forEach(({ index, i }) => {
        const name = fillName(pick('name'), index ?? '');
        const reg = {
          name: prefix ? `${prefix}.${name}` : name,
          localName: name,
          displayName: fillName(pick('displayName'), index ?? ''),
          description: fillName(pick('description') ?? '', index ?? ''),
          address: (base + offset + i * incr) >>> 0,
          size: rd.size,
          access: ACCESS[pick('access')] ?? rd.access,
          resetValue: svdNumber(pick('resetValue')) ?? rd.resetValue,
          readAction: pick('readAction'),
          fields: makeFields(rbase && !kid(r, 'fields') ? rbase : r, lookup)
        };
        reg.sideEffects = !!reg.readAction || reg.fields.some((f) => f.readAction);
        out.push(reg);
      });
    }

    for (const c of clusterNodes) {
      const cbase = resolveBase(c, (n) => clusterNodes.find((x) => txt(x, 'name') === n));
      const cname = txt(c, 'name') ?? (cbase ? txt(cbase, 'name') : '');
      const source = kid(c, 'register') || kid(c, 'cluster') ? c : (cbase ?? c);
      const cdefs = { ...defs, ...stripUndef(defaults(c, defs)) };
      const coffset = svdNumber(txt(c, 'addressOffset')) ?? (cbase ? svdNumber(txt(cbase, 'addressOffset')) : 0) ?? 0;
      const cincr = svdNumber(txt(c, 'dimIncrement')) ?? 0;
      for (const { index, i } of expandDim(c)) {
        const label = fillName(cname, index ?? '');
        collect(source, lookup, base + coffset + i * cincr, cdefs, prefix ? `${prefix}.${label}` : label, out);
      }
    }
  };

  const peripherals = [];
  for (const p of periphElems) {
    const base = resolveBase(p, lookupPeripheral);
    const pick = (t) => txt(p, t) ?? (base ? txt(base, t) : undefined);
    const pdefs = { ...devDefaults, ...stripUndef(defaults(base ?? p, devDefaults)), ...stripUndef(defaults(p, devDefaults)) };
    const baseAddress = svdNumber(pick('baseAddress')) ?? 0;
    const pincr = svdNumber(txt(p, 'dimIncrement')) ?? 0;
    for (const { index, i } of expandDim(p)) {
      const registers = [];
      const baseNode = base && !kid(p, 'registers') ? base : p;
      const regsContainer = kid(baseNode, 'registers') ?? baseNode;
      const lookup = (name) => {
        const found = kids(regsContainer, 'register').find((r) => txt(r, 'name') === name);
        if (found) return found;
        const dot = name.indexOf('.');
        if (dot > 0) {
          const other = periphNodes.get(name.slice(0, dot));
          const oc = other && (kid(other, 'registers') ?? other);
          return oc ? kids(oc, 'register').find((r) => txt(r, 'name') === name.slice(dot + 1)) : undefined;
        }
        return undefined;
      };
      collect(regsContainer.tag === 'registers' ? asContainer(regsContainer) : regsContainer, lookup, (baseAddress + i * pincr) >>> 0, pdefs, '', registers);
      registers.sort((a, b) => a.address - b.address);
      peripherals.push({
        name: fillName(txt(p, 'name'), index ?? ''),
        description: fillName(pick('description') ?? '', index ?? ''),
        baseAddress: (baseAddress + i * pincr) >>> 0,
        groupName: pick('groupName'),
        derivedFrom: p.attrs.derivedFrom,
        registers
      });
    }
  }

  const cpu = kid(dev, 'cpu');
  return {
    name: txt(dev, 'name'),
    description: txt(dev, 'description'),
    cpu: cpu ? { name: txt(cpu, 'name'), revision: txt(cpu, 'revision'), endian: txt(cpu, 'endian'), nvicPrioBits: svdNumber(txt(cpu, 'nvicPrioBits')) } : null,
    width: svdNumber(txt(dev, 'width')) ?? 32,
    peripherals
  };
}

// A <registers> element behaves as a cluster-like container of <register> and <cluster>.
function asContainer(registersEl) {
  return { tag: 'cluster-like', attrs: {}, children: registersEl.children, text: '' };
}

function stripUndef(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

// ---------------------------------------------------------------------------
// Register value <-> fields
// ---------------------------------------------------------------------------

const maskOf = (width) => (width >= 32 ? 0xffffffff : ((1 << width) - 1) >>> 0);

/** Value of `field` inside register value `regValue`. */
export function extractField(regValue, field) {
  return (((regValue >>> 0) >>> field.bitOffset) & maskOf(field.bitWidth)) >>> 0;
}

/** Register value with `field` set to `fieldValue` (range-checked). */
export function insertField(regValue, field, fieldValue) {
  const max = maskOf(field.bitWidth);
  if (!Number.isInteger(fieldValue) || fieldValue < 0 || fieldValue > max) {
    throw new Error(`${field.name} is ${field.bitWidth} bit(s) wide: use a value from 0 to ${max} (0x${max.toString(16)}).`);
  }
  const mask = (max << field.bitOffset) >>> 0;
  return (((regValue >>> 0) & ~mask) | ((fieldValue << field.bitOffset) >>> 0)) >>> 0;
}

/** Decode a register value into its fields: [{ name, bitOffset, bitWidth, value, enumName, enumDescription }]. */
export function decodeRegister(reg, value) {
  return reg.fields.map((f) => {
    const v = extractField(value, f);
    const e = f.enums.find((x) => x.value === v);
    return { name: f.name, description: f.description, bitOffset: f.bitOffset, bitWidth: f.bitWidth, access: f.access ?? reg.access, value: v, enumName: e?.name, enumDescription: e?.description };
  });
}

/** Is a register writable by its access type? */
export const isWritable = (access) => access !== 'read-only';
/** Does reading it return real data? */
export const isReadable = (access) => access !== 'write-only';

/** The peripheral and register at an address, or null. */
export function findRegisterAt(svd, address) {
  const a = address >>> 0;
  for (const p of svd.peripherals) {
    for (const r of p.registers) {
      const bytes = Math.max(1, (r.size || 32) >> 3);
      if (a >= r.address && a < r.address + bytes) return { peripheral: p, register: r };
    }
  }
  return null;
}
