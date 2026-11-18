// Pure helpers for the Smart Card toolkit: ATR interface-byte explanations, scriptor-style
// script parsing with a safety lint, export of a script for CLI tools, conversion of tool
// output (gp -d, scriptor) into trace lines, and an ATR report. Offline: nothing here talks
// to a reader.
import { parseHex, toHex, decodeCommandApdu, insName } from './smartcardTools.js';

const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');

/**
 * Explain one interface byte of an ATR group.
 * `index` is the group number (1 = TA1/TB1/TC1/TD1), `kind` is TA, TB, TC or TD, and
 * `protocol` is the protocol (low nibble of the previous TD) that governs the group.
 */
export function explainInterfaceByte(index, kind, value, protocol = null) {
  if (value === null || value === undefined) return '';
  if (index === 1) {
    if (kind === 'TA') return 'TA1: FI (clock rate conversion) and DI (bit rate adjustment)';
    if (kind === 'TB') return 'TB1: deprecated programming voltage/current (VPP)';
    if (kind === 'TC') return `TC1: extra guard time N=${value}${value === 255 ? ' (T=0: minimum delay; T=1: 11 etu)' : ''}`;
  }
  if (index === 2) {
    if (kind === 'TA') {
      const proto = value & 0x0f;
      const negotiable = (value & 0x80) === 0;
      const implicit = (value & 0x10) !== 0;
      return `TA2: specific mode, T=${proto}, ${negotiable ? 'mode can change (negotiable)' : 'mode cannot change'}, ${implicit ? 'parameters implicit (use defaults)' : 'parameters from the interface bytes'}`;
    }
    if (kind === 'TB') return 'TB2: deprecated (PI2, VPP)';
    if (kind === 'TC') return `TC2: T=0 work waiting time integer WI=${value}${value === 0 ? ' (RFU)' : ''}`;
  }
  if (kind === 'TD') {
    const p = value & 0x0f;
    return `TD${index}: next group is for ${p === 15 ? 'T=15 (global interface bytes)' : `T=${p}${p > 1 ? ' (RFU or proprietary)' : ''}`}`;
  }
  if (protocol === 1) {
    if (kind === 'TA') return `TA${index}: T=1 IFSC (information field size, card) = ${value} bytes${value < 16 || value === 255 ? ' (outside the 16 to 254 range)' : ''}`;
    if (kind === 'TB') return `TB${index}: T=1 BWI=${value >> 4} (block wait time), CWI=${value & 0x0f} (character wait time exponent)`;
    if (kind === 'TC') return `TC${index}: T=1 error detection ${value & 1 ? 'CRC' : 'LRC'}`;
  }
  if (protocol === 15) {
    if (kind === 'TA') {
      const xi = value >> 6;
      const ui = value & 0x3f;
      const classes = [ui & 1 ? 'A (5V)' : null, ui & 2 ? 'B (3V)' : null, ui & 4 ? 'C (1.8V)' : null].filter(Boolean);
      const stop = ['clock stop not supported', 'clock stop low', 'clock stop high', 'clock stop low or high'][xi];
      return `TA${index} (T=15): ${stop}; supported classes: ${classes.length ? classes.join(', ') : 'not stated'}`;
    }
    return `${kind}${index} (T=15): ${h2(value)} (not decoded here)`;
  }
  return `${kind}${index}: ${h2(value)}${protocol !== null && protocol > 1 ? ` (T=${protocol}, not decoded here)` : ''}`;
}

/** Per-group notes for a parsed ATR (the structure returned by parseAtr). */
export function explainAtrInterface(atr) {
  if (!atr || !Array.isArray(atr.interface)) return [];
  return atr.interface.map((g, i) => {
    const prev = i > 0 ? atr.interface[i - 1] : null;
    const protocol = prev && prev.TD !== null ? prev.TD & 0x0f : null;
    const notes = ['TA', 'TB', 'TC', 'TD']
      .filter((k) => g[k] !== null && g[k] !== undefined)
      .map((k) => explainInterfaceByte(g.index, k, g[k], protocol));
    return { index: g.index, protocol, notes };
  });
}

/** Plain-text ATR report in the spirit of pcsc_scan, for notes or bug reports. */
export function formatAtrReport(atr, rawHex = '') {
  if (!atr) return '';
  const hx = (v) => (v === null || v === undefined ? '-' : h2(v));
  const lines = [`ATR: ${rawHex}`.trim()];
  lines.push(`+ TS = ${hx(atr.TS)} --> ${atr.convention || 'unknown'} convention`);
  lines.push(`+ T0 = ${hx(atr.T0)}, Y(1): ${atr.Y1 === null ? '-' : atr.Y1.toString(2).padStart(4, '0')}, K: ${atr.K} (historical bytes)`);
  explainAtrInterface(atr).forEach((g) => g.notes.forEach((n) => lines.push(`  ${n}`)));
  if (atr.fiDi) lines.push(`+ FI/DI: F=${atr.fiDi.F ?? '?'}, D=${atr.fiDi.D ?? '?'}${atr.fiDi.baud ? `, about ${atr.fiDi.baud} bps` : ''}${atr.fiDi.defaulted ? ' (ISO default)' : ''}`);
  lines.push(`+ Protocols: ${atr.protocols && atr.protocols.length ? atr.protocols.map((p) => `T=${p}`).join(', ') : 'T=0 only'}`);
  if (atr.historical) lines.push(`+ Historical bytes: ${atr.historical.hex || '(none)'}${atr.historical.ascii ? `  "${atr.historical.ascii}"` : ''}`);
  if (atr.tck) lines.push(`+ TCK: ${!atr.tck.required ? 'not required' : atr.tck.present ? `${hx(atr.tck.value)} ${atr.tck.ok ? 'ok' : 'FAILED'}` : 'missing'}`);
  (atr.errors || []).forEach((e) => lines.push(`! ${e}`));
  (atr.warnings || []).forEach((w) => lines.push(`? ${w}`));
  return lines.join('\n');
}

// ---------------------------------------------------------------- scripts

/** Instructions that change card state, secrets or keys. A script using one gets a warning. */
export const RISKY_INS = {
  0x20: 'VERIFY (sends a PIN; a wrong value lowers the retry counter)',
  0x24: 'CHANGE REFERENCE DATA (changes a PIN)',
  0x2c: 'RESET RETRY COUNTER (unblocks a PIN)',
  0x82: 'EXTERNAL AUTHENTICATE (key use; failures can count towards a lockout)',
  0x50: 'INITIALIZE UPDATE (opens a GlobalPlatform secure channel; wrong keys can lock the card)',
  0xe4: 'DELETE (removes card content)',
  0xe6: 'INSTALL (changes card content)',
  0xd8: 'PUT KEY (replaces keys)',
  0xd6: 'UPDATE BINARY (writes)',
  0xdc: 'UPDATE RECORD (writes)',
  0xda: 'PUT DATA (writes)',
  0xe2: 'APPEND RECORD (writes)',
  0xe0: 'CREATE FILE (writes)',
  0xe5: 'DELETE FILE (writes)',
  0xf0: 'SET STATUS (can lock or terminate the card)',
};

/**
 * Parse a scriptor-style script: one APDU per line as hex, `#`, `;` or `//` comments,
 * and `/reset`-style directive lines kept as directives.
 */
export function parseScript(text) {
  const commands = [];
  const directives = [];
  const errors = [];
  const warnings = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.replace(/(#|;|\/\/).*$/, '').trim();
    if (!line) return;
    if (line.startsWith('/')) { directives.push({ line: lineNo, text: line }); return; }
    let bytes;
    try { bytes = parseHex(line); } catch (e) { errors.push({ line: lineNo, message: e.message }); return; }
    const apdu = decodeCommandApdu(bytes);
    if (!apdu.ok) { errors.push({ line: lineNo, message: apdu.error || 'Not a valid command APDU' }); return; }
    const risky = RISKY_INS[bytes[1]] || null;
    const info = insName(bytes[1]);
    commands.push({ line: lineNo, bytes, hex: toHex(bytes), ins: h2(bytes[1]), name: (info && info.name) || (typeof info === 'string' ? info : ''), risky });
    if (risky) warnings.push({ line: lineNo, message: `Line ${lineNo}: ${risky}` });
  });
  return { commands, directives, errors, warnings };
}

const compact = (hex) => hex.replace(/\s+/g, '');

/** Export a parsed script as text for an external tool. The page never runs these. */
export function exportScript(parsed, format) {
  const cmds = parsed?.commands ?? [];
  if (format === 'scriptor') return ['/reset', ...cmds.map((c) => c.hex)].join('\n') + '\n';
  if (format === 'opensc') return cmds.map((c) => `opensc-tool -s ${compact(c.hex)}`).join('\n');
  if (format === 'gp') return cmds.length ? `gp ${cmds.map((c) => `-a ${compact(c.hex)}`).join(' ')}` : '';
  if (format === 'pyscard') {
    return ['from smartcard.System import readers', 'conn = readers()[0].createConnection()', 'conn.connect()',
      ...cmds.map((c) => `print(conn.transmit([${Array.from(c.bytes, (b) => `0x${h2(b)}`).join(', ')}]))`)].join('\n');
  }
  throw new Error(`Unknown export format: ${format}`);
}

/**
 * Convert output of other tools into the `>>` / `<<` trace format the Trace tab reads.
 * Understands gp -d ("A>>" / "A<<"), scriptor ("Sending:" / "Response:") and lines that
 * already carry a marker. Other lines are dropped and counted.
 */
export function convertToolOutputToTrace(text) {
  const out = [];
  let skipped = 0;
  const hexOf = (s) => toHex(parseHex(s));
  String(text ?? '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    let m;
    try {
      if ((m = /^A>>\s*(?:T=\d\s*)?(?:\([^)]*\)\s*)?([0-9A-Fa-f ]+)$/.exec(line))) { out.push(`>> ${hexOf(m[1])}`); return; }
      if ((m = /^A<<\s*(?:\([^)]*\)\s*)*([0-9A-Fa-f ]+)$/.exec(line))) { out.push(`<< ${hexOf(m[1])}`); return; }
      if ((m = /^Sending:\s*([0-9A-Fa-f ]+)$/i.exec(line))) { out.push(`>> ${hexOf(m[1])}`); return; }
      if ((m = /^Response:\s*([0-9A-Fa-f ]*?)\s*:\s*([0-9A-Fa-f]{2}\s*[0-9A-Fa-f]{2})\b/i.exec(line))) { out.push(`<< ${hexOf(`${m[1]} ${m[2]}`)}`); return; }
    } catch { skipped++; return; }
    if (/^(>>|<<|>|<|->|<-|TX|RX)\s/i.test(line)) { out.push(line); return; }
    skipped++;
  });
  return { trace: out.join('\n'), skipped };
}
