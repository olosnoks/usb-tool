// Pure helpers for the USB-PD workbench (STUSB4500 fixed-voltage trigger).

export const PD_MIN_V = 5;
export const PD_MAX_V = 20;
export const PD_MAX_A = 5;
export const POLL_RATES = [500, 1500, 3000, 5000];

/** Watts for a voltage/current pair, rounded to 0.1 W. */
export function watts(voltageV, currentA) {
  const w = Number(voltageV) * Number(currentA);
  return Number.isFinite(w) ? Math.round(w * 10) / 10 : 0;
}

/** Check a manual voltage request. Returns { ok, volts, amps, watts, errors, warnings }. */
export function validateRequest(voltage, current) {
  const volts = Number(voltage);
  const amps = Number(current);
  const errors = [];
  const warnings = [];
  if (voltage === '' || !Number.isFinite(volts) || volts < PD_MIN_V || volts > PD_MAX_V) errors.push(`Voltage must be ${PD_MIN_V}-${PD_MAX_V} V.`);
  if (current === '' || !Number.isFinite(amps) || amps <= 0 || amps > PD_MAX_A) errors.push(`Current must be above 0 and at most ${PD_MAX_A} A.`);
  if (errors.length) return { ok: false, volts, amps, watts: 0, errors, warnings };
  const w = watts(volts, amps);
  if (amps > 3) warnings.push('Above 3 A needs a 5 A (e-marked) cable and a charger that offers it.');
  if (w > 100) warnings.push(`${w} W is above the 100 W USB-PD fixed-supply limit; the charger will not offer it.`);
  else if (w > 60 && amps <= 3) warnings.push('Above 60 W the charger must offer more than 3 A.');
  return { ok: true, volts, amps, watts: w, errors, warnings };
}

/** Describe what changed between two readHardwareStatus() results. Returns an array of strings. */
export function diffStatus(prev, next) {
  if (!next) return [];
  if (!prev) {
    return [next.attached ? `Source attached${next.rdo ? `, contract on source PDO #${next.rdo.position}` : ''}` : 'No source attached'];
  }
  const out = [];
  if (prev.attached !== next.attached) out.push(next.attached ? 'Source attached' : 'Source removed');
  const a = prev.rdo;
  const b = next.rdo;
  if (!a && b) out.push(`Contract: source PDO #${b.position}, ${b.operatingCurrentA.toFixed(2)} A operating / ${b.maxCurrentA.toFixed(2)} A max`);
  else if (a && !b) out.push('Contract lost');
  else if (a && b) {
    if (a.position !== b.position) out.push(`Contract moved from source PDO #${a.position} to #${b.position}`);
    if (a.operatingCurrentA !== b.operatingCurrentA || a.maxCurrentA !== b.maxCurrentA) {
      out.push(`Current now ${b.operatingCurrentA.toFixed(2)} A operating / ${b.maxCurrentA.toFixed(2)} A max`);
    }
    if (!a.capabilityMismatch && b.capabilityMismatch) out.push('Capability mismatch: the charger could not meet the request');
  }
  const sig = (s) => s.sink.pdos.slice(0, s.sink.count).map((p) => `${p.voltageV}/${p.currentA}`).join(',');
  if (sig(prev) !== sig(next)) out.push(`Sink PDOs changed: ${next.sink.pdos.slice(0, next.sink.count).map((p) => `${p.voltageV.toFixed(2)} V/${p.currentA.toFixed(2)} A`).join(', ')}`);
  return out;
}

/** Plain-text report of a status snapshot, for copying into notes or bug reports. */
export function formatStatusReport(status, chipId) {
  if (!status) return '';
  const lines = [`STUSB4500${chipId ? ` (ID 0x${chipId.toString(16)})` : ''}`, `Source: ${status.attached ? 'attached' : 'none'}`];
  const r = status.rdo;
  lines.push(r ? `Contract: source PDO #${r.position}, ${r.operatingCurrentA.toFixed(2)} A operating, ${r.maxCurrentA.toFixed(2)} A max${r.capabilityMismatch ? ' (capability mismatch)' : ''}` : 'Contract: none');
  lines.push('Sink PDOs:');
  status.sink.pdos.forEach((p, i) => {
    lines.push(`  PDO${i + 1}: ${p.voltageV.toFixed(2)} V / ${p.currentA.toFixed(2)} A = ${watts(p.voltageV, p.currentA)} W${i < status.sink.count ? '' : ' (off)'}`);
  });
  return lines.join('\n');
}

/** Format event-log entries [{t, text}] as text lines. */
export function formatEventLog(events) {
  return events.map((e) => `${new Date(e.t).toISOString()}  ${e.text}`).join('\n');
}
