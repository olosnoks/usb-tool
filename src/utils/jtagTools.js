// Pure helpers for the JTAG workbench: SVF summary, boundary-scan snapshot
// compare / CSV export / filtering, and an OpenOCD chain snippet.
import { parseSvf } from './jtagDriver';

const KNOWN_SVF = new Set([
  'FREQUENCY', 'TRST', 'ENDIR', 'ENDDR', 'STATE', 'SIR', 'SDR', 'HIR', 'HDR', 'TIR', 'TDR', 'RUNTEST', 'PIO', 'PIOMAP'
]);

/**
 * Static summary of an SVF script (nothing is sent to hardware).
 * Never throws: a parse failure is returned as `error`.
 */
export function analyzeSvf(text) {
  let stmts;
  try {
    stmts = parseSvf(text);
  } catch (e) {
    return { error: e.message };
  }
  const counts = {};
  const warnings = [];
  let sirBits = 0;
  let sdrBits = 0;
  let tdoChecks = 0;
  let runtestClocks = 0;
  let runtestSeconds = 0;
  let frequencyHz = null;
  for (const s of stmts) {
    counts[s.cmd] = (counts[s.cmd] || 0) + 1;
    const words = s.text.split(/\s+/).slice(1);
    if (!KNOWN_SVF.has(s.cmd)) warnings.push(`Line ${s.line}: unknown command ${s.cmd}`);
    if (s.cmd === 'PIO' || s.cmd === 'PIOMAP') warnings.push(`Line ${s.line}: ${s.cmd} is not supported by the player`);
    if (s.cmd === 'FREQUENCY' && words[0] && !Number.isNaN(Number(words[0]))) frequencyHz = Number(words[0]);
    if (s.cmd === 'SIR' || s.cmd === 'SDR') {
      const n = Number(words[0]);
      if (Number.isFinite(n)) { if (s.cmd === 'SIR') sirBits += n; else sdrBits += n; }
      if (/\bTDO\s*\(/i.test(s.text)) tdoChecks++;
    }
    if (s.cmd === 'RUNTEST') {
      for (let k = 0; k < words.length - 1; k++) {
        const unit = words[k + 1].toUpperCase();
        const n = Number(words[k]);
        if (Number.isNaN(n)) continue;
        if (unit === 'TCK' || unit === 'SCK') runtestClocks += n;
        else if (unit === 'SEC' && words[k - 1]?.toUpperCase() !== 'MAXIMUM') runtestSeconds += n;
      }
    }
  }
  // Rough lower bound: shifted bits + RUNTEST clocks at the script's FREQUENCY, plus fixed waits.
  const estSeconds = frequencyHz ? (sirBits + sdrBits + runtestClocks) / frequencyHz + runtestSeconds : null;
  return { statements: stmts.length, counts, sirBits, sdrBits, tdoChecks, runtestClocks, runtestSeconds, frequencyHz, estSeconds, warnings };
}

/** One-line description of an analyzeSvf result. */
export function formatSvfSummary(a) {
  if (a.error) return a.error;
  if (!a.statements) return 'No SVF statements.';
  const parts = [`${a.statements} statements`, `${a.sirBits} IR bits`, `${a.sdrBits} DR bits`, `${a.tdoChecks} TDO check(s)`];
  if (a.estSeconds !== null) parts.push(`>= ${a.estSeconds < 1 ? `${Math.round(a.estSeconds * 1000)} ms` : `${a.estSeconds.toFixed(1)} s`} at ${a.frequencyHz / 1e6} MHz`);
  return parts.join(' | ');
}

/** Boundary cell indexes that differ between two samples (different lengths: the extra cells count as changed). */
export function diffCells(prev, next) {
  if (!prev || !next) return [];
  const out = [];
  const n = Math.max(prev.length, next.length);
  for (let i = 0; i < n; i++) if (prev[i] !== next[i]) out.push(i);
  return out;
}

/** Set of port names whose input, output or driver state differs between two pinStates() results. */
export function changedPorts(prevRows, nextRows) {
  const prev = new Map((prevRows || []).map((r) => [r.port, r]));
  const out = new Set();
  for (const r of nextRows || []) {
    const p = prev.get(r.port);
    if (!p || p.input !== r.input || p.output !== r.output || p.driving !== r.driving) out.add(r.port);
  }
  return out;
}

/** Case-insensitive filter on port name or package pin. */
export function filterPins(rows, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.port.toLowerCase().includes(q) || (r.pins || []).some((p) => String(p).toLowerCase().includes(q)));
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

/** CSV of pinStates() rows: port,pin,input,output,driving. */
export function pinsToCsv(rows) {
  const lines = ['port,pin,input,output,driving'];
  for (const r of rows) {
    lines.push([r.port, (r.pins || []).join(' '), r.input ?? '', r.output ?? '', r.outputCell !== undefined ? (r.driving ? 1 : 0) : ''].map(csvCell).join(','));
  }
  return lines.join('\n');
}

/**
 * OpenOCD `jtag newtap` lines for a scanned chain. Devices are in scan order
 * (TDO end first), which is the order OpenOCD wants them declared.
 * irLengths: array of numbers (or null) per device.
 */
export function openocdChainConfig(devices, irLengths = []) {
  const lines = ['# Generated from a chain scan in Skon USB Tool; check against the part BSDL file.'];
  devices.forEach((d, i) => {
    const ir = Number(irLengths[i] ?? d.irlen);
    const name = `tap${i}`;
    if (!Number.isInteger(ir) || ir < 2) {
      lines.push(`# ${name}: IR length unknown - add "-irlen N" from the BSDL file`);
      return;
    }
    const id = d.idcode == null ? '' : ` -expected-id 0x${(d.idcode >>> 0).toString(16).padStart(8, '0')}`;
    lines.push(`jtag newtap chip ${name} -irlen ${ir}${id}`);
  });
  return lines.join('\n');
}
