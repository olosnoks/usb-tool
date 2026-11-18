/**
 * fido2Report.js - pure helpers that turn a parsed authenticatorGetInfo into a readable assessment and an
 * exportable report. Nothing here talks to a device; it only interprets what the key already reported.
 */

/** Plain-English meaning of the CTAP2 option ids a key can report. */
export const OPTION_HELP = {
  rk: 'Can store discoverable (resident) credentials, so it can sign in without a username (passkeys).',
  up: 'Checks user presence (a touch).',
  uv: 'Has a built-in user verification method (fingerprint, on-key PIN pad). true = configured.',
  plat: 'Platform authenticator (built into the device) rather than a roaming key.',
  clientPin: 'Supports a client PIN. true = a PIN is set, false = supported but no PIN set yet.',
  credMgmt: 'Credential management: stored credentials can be listed and deleted.',
  credentialMgmtPreview: 'Preview version of credential management (pre-CTAP 2.1 keys).',
  bioEnroll: 'Built-in biometric enrollment. true = at least one fingerprint enrolled.',
  userVerificationMgmtPreview: 'Preview version of biometric enrollment.',
  largeBlobs: 'Can store large blobs (for example certificates) per credential.',
  ep: 'Enterprise attestation: can return identifying attestation when an organisation asks for it. true = enabled.',
  alwaysUv: 'Always requires user verification, even for operations that normally need only a touch.',
  makeCredUvNotRqd: 'Can create non-discoverable credentials without user verification even when a PIN is set.',
  authnrCfg: 'Supports authenticator configuration commands (enable enterprise attestation, set min PIN length).',
  setMinPINLength: 'The minimum PIN length can be raised.',
  pinUvAuthToken: 'Supports PIN/UV auth tokens with permissions (CTAP 2.1 style).',
  noMcGaPermissionsWithClientPin: 'MakeCredential/GetAssertion permissions are not allowed with a plain PIN token.',
  perCredProtect: 'Per-credential protection levels are supported.'
};

const rank = (v) => ({ U2F_V2: 1, FIDO_2_0: 2, FIDO_2_1_PRE: 3, FIDO_2_1: 4, FIDO_2_2: 5 }[v] || 0);

/** Highest CTAP version string in a versions list, or null. */
export function highestVersion(versions = []) {
  let best = null;
  for (const v of versions) if (rank(v) > (best ? rank(best) : 0)) best = v;
  return best;
}

/** PIN state from the options map: 'set' | 'not-set' | 'unsupported'. */
export function pinState(options = {}) {
  if (options.clientPin === true) return 'set';
  if (options.clientPin === false) return 'not-set';
  return 'unsupported';
}

/**
 * Assessment of a key: a list of {label, value, tone} rows, tone being 'good' | 'warn' | 'info'.
 * Only reports what the key stated; missing options are reported as "not reported", never guessed.
 */
export function summarizeGetInfo(info, ctap = null) {
  if (!info) return [];
  const o = info.options || {};
  const rows = [];
  const top = highestVersion(info.versions);
  rows.push({ label: 'Highest protocol', value: top || 'unknown', tone: rank(top) >= 4 ? 'good' : 'info' });
  const pin = pinState(o);
  rows.push({
    label: 'PIN',
    value: pin === 'set' ? 'set' : pin === 'not-set' ? 'supported but NOT set' : 'not supported',
    tone: pin === 'set' ? 'good' : pin === 'not-set' ? 'warn' : 'info'
  });
  if (o.uv !== undefined) rows.push({ label: 'Built-in user verification', value: o.uv ? 'configured' : 'supported, not set up', tone: o.uv ? 'good' : 'info' });
  if (o.bioEnroll !== undefined) rows.push({ label: 'Fingerprints', value: o.bioEnroll ? 'enrolled' : 'sensor present, none enrolled', tone: o.bioEnroll ? 'good' : 'warn' });
  const passkey = o.rk === true && (info.versions || []).some((v) => rank(v) >= 2);
  rows.push({ label: 'Passkeys (discoverable credentials)', value: passkey ? 'supported' : o.rk === false ? 'not supported' : 'not reported', tone: passkey ? 'good' : 'info' });
  if (info.remainingDiscoverableCredentials != null) rows.push({ label: 'Free passkey slots', value: String(info.remainingDiscoverableCredentials), tone: info.remainingDiscoverableCredentials > 0 ? 'info' : 'warn' });
  if (o.credMgmt !== undefined || o.credentialMgmtPreview !== undefined) rows.push({ label: 'Credential management', value: o.credMgmt || o.credentialMgmtPreview ? 'available' : 'not available', tone: 'info' });
  if (o.ep !== undefined) rows.push({ label: 'Enterprise attestation', value: o.ep ? 'ENABLED (identifying attestation possible)' : 'supported, disabled', tone: o.ep ? 'warn' : 'info' });
  if (o.alwaysUv !== undefined) rows.push({ label: 'Always require UV', value: o.alwaysUv ? 'on' : 'off', tone: o.alwaysUv ? 'good' : 'info' });
  if (info.forcePinChange) rows.push({ label: 'PIN change', value: 'the key demands a PIN change', tone: 'warn' });
  if (info.minPinLength != null) rows.push({ label: 'Minimum PIN length', value: String(info.minPinLength), tone: info.minPinLength >= 6 ? 'good' : 'info' });
  if (ctap && !ctap.capCbor) rows.push({ label: 'CTAP2', value: 'not supported (U2F only)', tone: 'warn' });
  return rows;
}

/** Explain each option the key reported: [{id, value, help}]. Unknown ids get an honest note. */
export function explainOptions(options = {}) {
  return Object.entries(options).map(([id, value]) => ({ id, value, help: OPTION_HELP[id] || 'Option not known to this tool.' }));
}

/** Structured report object for export. Timestamp can be injected for tests. */
export function buildReport(ctap, info, now = new Date()) {
  return {
    tool: 'Skon USB Tool - FIDO2 inspector',
    generatedAt: now.toISOString(),
    ctapHid: ctap ? { protocolVersion: ctap.protocolVersion, deviceVersion: ctap.deviceVersion, capCbor: !!ctap.capCbor, capWink: !!ctap.capWink } : null,
    getInfo: info || null,
    assessment: summarizeGetInfo(info, ctap).map(({ label, value }) => ({ label, value }))
  };
}

/** Plain-text report (what the Copy button puts on the clipboard). */
export function reportToText(report) {
  const lines = [report.tool, `Generated: ${report.generatedAt}`, ''];
  if (report.ctapHid) lines.push(`CTAPHID version ${report.ctapHid.protocolVersion}, device version ${report.ctapHid.deviceVersion}`);
  const g = report.getInfo;
  if (g) {
    lines.push(`AAGUID: ${g.aaguid ?? 'n/a'}${g.aaguidName ? ` (${g.aaguidName})` : ''}`);
    lines.push(`Versions: ${(g.versions || []).join(', ')}`);
    if (g.extensions?.length) lines.push(`Extensions: ${g.extensions.join(', ')}`);
    lines.push(`Options: ${Object.entries(g.options || {}).map(([k, v]) => `${k}=${v}`).join(', ') || 'none'}`);
    if (g.algorithms?.length) lines.push(`Algorithms: ${g.algorithms.map((a) => a.name || a.alg).join(', ')}`);
  }
  if (report.assessment?.length) { lines.push('', 'Assessment:'); for (const r of report.assessment) lines.push(`  ${r.label}: ${r.value}`); }
  return lines.join('\n');
}
