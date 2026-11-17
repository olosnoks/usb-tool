/**
 * AT command toolkit for cellular modules (SIMCom SIM7600/SIM800, Quectel EC25/BG96,
 * u-blox SARA): a request/response engine over a byte stream, plus pure parsers for the
 * replies people read (signal, registration, cell info, SMS, GNSS, APN, CME/CMS errors).
 *
 * Protocol logic only. The React workbench owns the serial port and passes bytes in.
 */

// ---------------------------------------------------------------------------
// Error code tables (3GPP TS 27.007 for +CME, TS 27.005 for +CMS). Subset.
// ---------------------------------------------------------------------------

export const CME_ERRORS = {
  0: 'Phone failure',
  1: 'No connection to phone',
  2: 'Phone-adaptor link reserved',
  3: 'Operation not allowed',
  4: 'Operation not supported',
  5: 'PH-SIM PIN required',
  6: 'PH-FSIM PIN required',
  7: 'PH-FSIM PUK required',
  10: 'SIM not inserted',
  11: 'SIM PIN required',
  12: 'SIM PUK required',
  13: 'SIM failure',
  14: 'SIM busy',
  15: 'SIM wrong',
  16: 'Incorrect password',
  17: 'SIM PIN2 required',
  18: 'SIM PUK2 required',
  20: 'Memory full',
  21: 'Invalid index',
  22: 'Not found',
  23: 'Memory failure',
  24: 'Text string too long',
  25: 'Invalid characters in text string',
  26: 'Dial string too long',
  27: 'Invalid characters in dial string',
  30: 'No network service',
  31: 'Network timeout',
  32: 'Network not allowed - emergency calls only',
  40: 'Network personalization PIN required',
  41: 'Network personalization PUK required',
  42: 'Network subset personalization PIN required',
  43: 'Network subset personalization PUK required',
  44: 'Service provider personalization PIN required',
  45: 'Service provider personalization PUK required',
  46: 'Corporate personalization PIN required',
  47: 'Corporate personalization PUK required',
  50: 'Incorrect parameters',
  100: 'Unknown error',
  103: 'Illegal MS',
  106: 'Illegal ME',
  107: 'GPRS services not allowed',
  108: 'PLMN not allowed',
  109: 'Location area not allowed',
  110: 'Roaming not allowed in this location area',
  132: 'Service option not supported',
  133: 'Requested service option not subscribed',
  134: 'Service option temporarily out of order',
  148: 'Unspecified GPRS error',
  149: 'PDP authentication failure',
  150: 'Invalid mobile class',
};

export const CMS_ERRORS = {
  1: 'Unassigned (unallocated) number',
  8: 'Operator determined barring',
  21: 'Short message transfer rejected',
  27: 'Destination out of service',
  28: 'Unidentified subscriber',
  30: 'Unknown subscriber',
  38: 'Network out of order',
  41: 'Temporary failure',
  42: 'Congestion',
  50: 'Requested facility not subscribed',
  69: 'Requested facility not implemented',
  81: 'Invalid short message reference value',
  95: 'Invalid message, unspecified',
  96: 'Invalid mandatory information',
  97: 'Message type non-existent or not implemented',
  111: 'Protocol error, unspecified',
  127: 'Interworking, unspecified',
  300: 'ME failure',
  301: 'SMS service of ME reserved',
  302: 'Operation not allowed',
  303: 'Operation not supported',
  304: 'Invalid PDU mode parameter',
  305: 'Invalid text mode parameter',
  310: 'SIM not inserted',
  311: 'SIM PIN required',
  312: 'PH-SIM PIN required',
  313: 'SIM failure',
  314: 'SIM busy',
  315: 'SIM wrong',
  316: 'SIM PUK required',
  317: 'SIM PIN2 required',
  318: 'SIM PUK2 required',
  320: 'Memory failure',
  321: 'Invalid memory index',
  322: 'Memory full',
  330: 'SMSC address unknown',
  331: 'No network service',
  332: 'Network timeout',
  500: 'Unknown error',
};

export function cmeErrorText(code) {
  return CME_ERRORS[code] || `Unknown CME error ${code}`;
}

export function cmsErrorText(code) {
  return CMS_ERRORS[code] || `Unknown CMS error ${code}`;
}

// ---------------------------------------------------------------------------
// Field splitting
// ---------------------------------------------------------------------------

/** Split an AT reply body on commas outside double quotes; strips the quotes and whitespace. */
export function splitAtFields(text) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (const ch of String(text ?? '')) {
    if (ch === '"') { quoted = !quoted; cur += ch; }
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((t) => {
    const s = t.trim();
    return s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"' ? s.slice(1, -1) : s;
  });
}

const num = (s) => {
  if (s === undefined || s === null || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Text after "+PREFIX:" for a line that starts with that prefix; null otherwise. */
function afterPrefix(line, prefix) {
  const s = String(line ?? '').trim();
  if (!s.toUpperCase().startsWith(prefix.toUpperCase())) return null;
  return s.slice(prefix.length).replace(/^\s*/, '');
}

// ---------------------------------------------------------------------------
// Final result lines
// ---------------------------------------------------------------------------

const FINAL_WORDS = new Set(['OK', 'ERROR', 'NO CARRIER', 'BUSY', 'NO ANSWER', 'NO DIALTONE']);

/** Recognise a final result line. Returns { final, ok, error } or null. */
export function parseFinalLine(line) {
  const s = String(line ?? '').trim();
  if (s === 'OK') return { final: 'OK', ok: true, error: null };
  if (FINAL_WORDS.has(s)) return { final: s, ok: false, error: { type: 'AT', code: null, text: s } };
  let m = /^\+CME ERROR:\s*(.*)$/.exec(s);
  if (m) return codedError('CME', m[1], CME_ERRORS, cmeErrorText);
  m = /^\+CMS ERROR:\s*(.*)$/.exec(s);
  if (m) return codedError('CMS', m[1], CMS_ERRORS, cmsErrorText);
  return null;
}

function codedError(type, rest, table, textFn) {
  const v = rest.trim().replace(/^"|"$/g, '');
  const code = /^\d+$/.test(v) ? Number(v) : null;
  const text = code !== null ? textFn(code) : (v || 'Unspecified error');
  return { final: `${type} ERROR`, ok: false, error: { type, code, text, known: code !== null && code in table } };
}

// Unsolicited lines the engine should route to the URC handler unless the
// pending command asked for them (its own prefixes).
const URC_RE = /^(RING$|\+CMTI:|\+CMT:|\+CDS:|\+CREG:|\+CGREG:|\+CEREG:|\+CLIP:|\+CRING:|\+QIND:|\+CGEV:)/;

// ---------------------------------------------------------------------------
// Request/response engine
// ---------------------------------------------------------------------------

/**
 * createAtEngine({ write, onLine, timeoutMs })
 *   write(Uint8Array)        sends bytes to the modem (may return a promise)
 *   onLine(line, isUrc)      every complete non-empty line, with whether it was unsolicited
 *   feed(bytes | string)     call with every received chunk
 *   send(cmd, opts)          queues one command; resolves with
 *                            { cmd, ok, final, error, lines, timedOut }
 *     opts.prefixes  reply prefixes this command expects (e.g. ['+CSQ:']); matching lines are
 *                    collected even if they look like URCs
 *     opts.prompt    for SMS entry (AT+CMGS): body text sent after the '> ' prompt, then Ctrl-Z
 *     opts.timeoutMs
 *   abort(reason)            fails the running and queued commands
 *
 * Commands run one at a time. A final line (OK / ERROR / +CME ERROR / +CMS ERROR / ...) ends the
 * running command. Echoed command text is dropped. Lines that match URC prefixes are not
 * collected into a command's reply.
 */
export function createAtEngine({ write, onLine = () => {}, timeoutMs: defaultTimeout = 5000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const encoder = new TextEncoder();
  const queue = [];
  let partial = '';
  let current = null;

  function emit(bytes) {
    try {
      const r = write(bytes);
      if (r && typeof r.then === 'function') {
        r.catch((e) => finish({ ok: false, final: null, error: { type: 'WRITE', code: null, text: e?.message || 'Write failed' }, timedOut: false }));
      }
    } catch (e) {
      finish({ ok: false, final: null, error: { type: 'WRITE', code: null, text: e?.message || 'Write failed' }, timedOut: false });
    }
  }

  function finish(result) {
    if (!current) return;
    const job = current;
    current = null;
    clearTimer(job.timer);
    const lines = job.lines.slice();
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    job.resolve({ cmd: job.cmd, ok: false, final: null, error: null, timedOut: false, ...result, lines });
    Promise.resolve().then(pump);
  }

  function pump() {
    if (current || queue.length === 0) return;
    const job = queue.shift();
    current = { ...job, lines: [], echoed: false, awaitingPrompt: job.prompt !== null, timer: null };
    const self = current;
    current.timer = setTimer(() => {
      if (current !== self) return;
      if (self.awaitingPrompt) emit(Uint8Array.from([0x1b])); // ESC cancels SMS entry
      finish({ ok: false, final: null, error: null, timedOut: true });
    }, job.timeoutMs);
    emit(encoder.encode(`${job.cmd}\r`));
  }

  function handleLine(raw) {
    const line = raw.trim();
    if (line === '') {
      if (current && current.lines.length > 0) current.lines.push('');
      return;
    }
    if (!current) { onLine(line, true); return; }
    const fin = parseFinalLine(line);
    if (fin) {
      onLine(line, false);
      finish({ ok: fin.ok, final: fin.final, error: fin.error, timedOut: false });
      return;
    }
    if (!current.echoed && current.lines.length === 0 && line === current.cmd) {
      current.echoed = true;
      onLine(line, false);
      return;
    }
    const expected = current.prefixes.some((p) => line.startsWith(p));
    if (URC_RE.test(line) && !expected) { onLine(line, true); return; }
    onLine(line, false);
    current.lines.push(line);
  }

  function feed(chunk) {
    const text = typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    if (!text) return;
    partial += text;
    const parts = partial.split(/\r\n|\r|\n/);
    partial = parts.pop();
    for (const raw of parts) handleLine(raw);
    // The SMS prompt "> " arrives without a line ending.
    if (current && current.awaitingPrompt && /^>\s?$/.test(partial)) {
      current.awaitingPrompt = false;
      partial = ''; // consume the prompt so it is not read as a reply line
      emit(encoder.encode(`${current.prompt}\x1a`));
    }
  }

  function send(cmd, opts = {}) {
    return new Promise((resolve) => {
      queue.push({
        cmd: String(cmd).trim(),
        prefixes: opts.prefixes || [],
        prompt: typeof opts.prompt === 'string' ? opts.prompt : null,
        timeoutMs: opts.timeoutMs ?? defaultTimeout,
        resolve,
      });
      pump();
    });
  }

  function abort(reason = 'Cancelled') {
    while (queue.length) {
      const job = queue.shift();
      job.resolve({ cmd: job.cmd, ok: false, final: null, error: { type: 'ABORT', code: null, text: reason }, timedOut: false, lines: [] });
    }
    partial = '';
    finish({ ok: false, final: null, error: { type: 'ABORT', code: null, text: reason }, timedOut: false });
  }

  return {
    feed,
    send,
    abort,
    get busy() { return current !== null || queue.length > 0; },
  };
}

// ---------------------------------------------------------------------------
// Identify
// ---------------------------------------------------------------------------

/** Pull the value of a bare reply line (ATI, AT+CGMI, ...), i.e. the first non-prefixed line. */
export function firstValue(lines) {
  return (lines || []).find((l) => l && !l.startsWith('+')) ?? (lines || [])[0] ?? '';
}

/** Guess the module family from the manufacturer / model strings. Guess only; check the label. */
export function detectFamily(manufacturer = '', model = '') {
  const s = `${manufacturer} ${model}`.toUpperCase();
  if (/QUECTEL|\bEC2\d|\bBG9\d|\bEG9\d|\bEM\d{2}/.test(s)) return 'quectel';
  if (/SIMCOM|SIM7600|SIM800|SIM7000|SIM7070|SIM868|SIM900/.test(s)) return 'simcom';
  if (/U-BLOX|SARA|LARA|TOBY/.test(s)) return 'ublox';
  return 'unknown';
}

/** Turn +CCID / +QCCID / +CICCID reply into the ICCID digits. */
export function parseIccid(lines) {
  for (const l of lines || []) {
    const m = /^\+(?:Q|CI)?CCID:?\s*"?([0-9A-Fa-f]{18,22})"?/.exec(l);
    if (m) return m[1];
  }
  const bare = (lines || []).find((l) => /^\d{18,22}$/.test(l));
  return bare || null;
}

/** IMSI: 15 digits, bare on its own line. */
export function parseImsi(lines) {
  return (lines || []).find((l) => /^\d{14,15}$/.test(l)) ?? null;
}

/** IMEI from AT+CGSN: 15 digits, bare. */
export function parseImei(lines) {
  return (lines || []).find((l) => /^\d{15}$/.test(l)) ?? null;
}

/** +CPIN: READY and friends. */
export function parseCpin(lines) {
  const line = (lines || []).find((l) => l.startsWith('+CPIN:'));
  if (!line) return null;
  return afterPrefix(line, '+CPIN:');
}

// ---------------------------------------------------------------------------
// Signal
// ---------------------------------------------------------------------------

export const BER_TABLE = [
  '< 0.2%', '0.2 - 0.4%', '0.4 - 0.8%', '0.8 - 1.6%', '1.6 - 3.2%', '3.2 - 6.4%', '6.4 - 12.8%', '>= 12.8%',
];

/** AT+CSQ RSSI index to dBm. 0 means <= -113 dBm, 31 means >= -51 dBm, 99 is unknown. */
export function csqToDbm(rssi) {
  const n = Number(rssi);
  if (!Number.isInteger(n) || n === 99 || n < 0 || n > 31) return null;
  return -113 + 2 * n;
}

/** AT+CSQ BER index (3GPP RXQUAL). 99 means unknown. */
export function csqBerText(ber) {
  const n = Number(ber);
  if (n === 99) return 'unknown';
  if (!Number.isInteger(n) || n < 0 || n > 7) return null;
  return BER_TABLE[n];
}

/** Parse "+CSQ: <rssi>,<ber>". */
export function parseCsq(line) {
  const rest = afterPrefix(line, '+CSQ:');
  if (rest === null) return null;
  const [rssiS, berS] = splitAtFields(rest);
  const rssi = num(rssiS);
  const ber = num(berS);
  if (rssi === null) return null;
  return { rssi, dbm: csqToDbm(rssi), ber, berText: ber === null ? null : csqBerText(ber), quality: csqQuality(csqToDbm(rssi)) };
}

/** Rough guide only, from the RSSI dBm. */
export function csqQuality(dbm) {
  if (dbm === null || dbm === undefined) return 'unknown';
  if (dbm >= -70) return 'excellent';
  if (dbm >= -85) return 'good';
  if (dbm >= -100) return 'fair';
  return 'poor';
}

/** 3GPP RSRP (dBm) from the +CESQ index: 0 means < -140, 1..97 => idx - 141, 255 unknown. */
export function cesqRsrpDbm(idx) {
  if (idx === null || idx === 255) return null;
  if (idx < 0 || idx > 97) return null;
  return idx - 141;
}

/** 3GPP RSRQ (dB) from the +CESQ index: 1..34 => -19.5 + 0.5 * (idx - 1), 0 means < -19.5, 255 unknown. */
export function cesqRsrqDb(idx) {
  if (idx === null || idx === 255) return null;
  if (idx < 0 || idx > 34) return null;
  if (idx === 0) return null;
  return -19.5 + 0.5 * (idx - 1);
}

/** RxLev index (GSM) to dBm: 1..63 => idx - 111, 99 unknown. */
export function cesqRxlevDbm(idx) {
  if (idx === null || idx === 99) return null;
  if (idx < 0 || idx > 63) return null;
  return idx - 111;
}

/** Parse "+CESQ: <rxlev>,<ber>,<rscp>,<ecno>,<rsrq>,<rsrp>". */
export function parseCesq(line) {
  const rest = afterPrefix(line, '+CESQ:');
  if (rest === null) return null;
  const f = splitAtFields(rest).map(num);
  if (f.length < 6 || f.some((v) => v === null)) return null;
  const [rxlev, ber, rscp, ecno, rsrq, rsrp] = f;
  return {
    rxlev, rxlevDbm: cesqRxlevDbm(rxlev), ber, rscp, ecno,
    rsrq, rsrqDb: cesqRsrqDb(rsrq), rsrp, rsrpDbm: cesqRsrpDbm(rsrp),
  };
}

/** Rough guides for LTE values. */
export function rsrpQuality(dbm) {
  if (dbm === null || dbm === undefined) return 'unknown';
  if (dbm >= -80) return 'excellent';
  if (dbm >= -90) return 'good';
  if (dbm >= -100) return 'fair';
  return 'poor';
}

export function rsrqQuality(db) {
  if (db === null || db === undefined) return 'unknown';
  if (db >= -10) return 'excellent';
  if (db >= -15) return 'good';
  if (db >= -20) return 'fair';
  return 'poor';
}

/**
 * Quectel AT+QENG="servingcell". Returns the serving cell for LTE; for other RATs the
 * generic fields plus the raw tail (their layouts differ by firmware).
 */
export function parseQeng(line) {
  const rest = afterPrefix(line, '+QENG:');
  if (rest === null) return null;
  const f = splitAtFields(rest);
  if (f[0] !== 'servingcell') return null; // neighbourcell rows are not the serving cell
  if (f.length < 3) return { source: 'QENG', state: f[1] || '', searching: /SEARCH/i.test(f[1] || '') };
  const rat = f[2];
  if (rat === 'LTE') {
    return {
      source: 'QENG', rat, state: f[1], duplex: f[3],
      mcc: f[4], mnc: f[5], cellId: f[6], pci: num(f[7]), earfcn: num(f[8]),
      band: f[9] ? `B${f[9]}` : null, ulBw: num(f[10]), dlBw: num(f[11]), tac: f[12],
      rsrp: num(f[13]), rsrq: num(f[14]), rssi: num(f[15]), sinr: num(f[16]),
      raw: f,
    };
  }
  return { source: 'QENG', rat, state: f[1], duplex: f[3], mcc: f[4] ?? null, mnc: f[5] ?? null, raw: f };
}

/**
 * SIMCom AT+CPSI?. Reads "<system>,<operation>,<mcc-mnc>,<tac/lac>,<cell id>, ..." and for LTE
 * the tail as PCI, band, EARFCN, DL/UL bandwidth, RSRP, RSRQ, RSSI (the SIMCom documented order).
 * Check the tail against your firmware's output before trusting it.
 */
export function parseCpsi(line) {
  const rest = afterPrefix(line, '+CPSI:');
  if (rest === null) return null;
  const f = splitAtFields(rest);
  if (/^NO SERVICE/i.test(f[0]) || /^NO SERVICE/i.test(rest)) return { source: 'CPSI', system: 'NO SERVICE', noService: true, raw: f };
  const system = f[0] || '';
  const operation = f[1] || '';
  const mm = /^(\d{3})-(\d{2,3})$/.exec(f[2] || '');
  const out = {
    source: 'CPSI', system, operation,
    mcc: mm ? mm[1] : null, mnc: mm ? mm[2] : null,
    tac: f[3] ?? null, cellId: f[4] ?? null,
    raw: f,
  };
  if (/^LTE/i.test(system)) {
    const band = /BAND(\d+)/i.exec(f[6] || '');
    Object.assign(out, {
      pci: num(f[5]),
      band: band ? `B${band[1]}` : (f[6] || null),
      earfcn: num(f[7]), dlBw: num(f[8]), ulBw: num(f[9]),
      rsrp: num(f[10]), rsrq: num(f[11]), rssi: num(f[12]),
    });
  }
  return out;
}

/** Parse any signal/cell reply line the workbench asks for. */
export function parseCellLine(line) {
  return parseQeng(line) || parseCpsi(line);
}

// ---------------------------------------------------------------------------
// Registration and operator
// ---------------------------------------------------------------------------

export const REG_STATUS = {
  0: 'not registered, not searching',
  1: 'registered, home network',
  2: 'not registered, searching',
  3: 'registration denied',
  4: 'unknown',
  5: 'registered, roaming',
  6: 'registered, SMS only, home network',
  7: 'registered, SMS only, roaming',
};

/**
 * +CREG / +CGREG / +CEREG. A query reply is "+X: <n>,<stat>[,<lac>,<ci>[,<act>]]";
 * an unsolicited reply is "+X: <stat>[,<lac>,<ci>]". Pass { query: true } for replies to X?.
 */
export function parseRegistration(line, { query = false } = {}) {
  const m = /^\+(CREG|CGREG|CEREG):\s*(.*)$/i.exec(String(line ?? '').trim());
  if (!m) return null;
  const f = splitAtFields(m[2]);
  let n = null;
  let rest = f;
  if (query) {
    n = num(f[0]);
    rest = f.slice(1);
  }
  const stat = num(rest[0]);
  return {
    kind: m[1].toUpperCase(),
    n,
    stat,
    statusText: stat === null ? 'unparsed' : (REG_STATUS[stat] ?? `unknown status ${stat}`),
    registered: stat === 1 || stat === 5,
    lac: rest[1] || null,
    ci: rest[2] || null,
    act: num(rest[3]),
  };
}

export const ACT_NAMES = {
  0: 'GSM', 1: 'GSM Compact', 2: 'UTRAN (3G)', 3: 'GSM w/ EGPRS', 4: 'UTRAN w/ HSDPA', 5: 'UTRAN w/ HSUPA',
  6: 'UTRAN w/ HSDPA+HSUPA', 7: 'E-UTRAN (LTE)', 8: 'EC-GSM-IoT', 9: 'E-UTRAN NB-S1 (NB-IoT)',
};

/** +COPS?: "+COPS: <mode>[,<format>,<oper>[,<act>]]" */
export function parseCops(line) {
  const rest = afterPrefix(line, '+COPS:');
  if (rest === null) return null;
  const f = splitAtFields(rest);
  const act = num(f[3]);
  return {
    mode: num(f[0]),
    format: num(f[1]),
    operator: f[2] || null,
    act,
    actText: act === null ? null : (ACT_NAMES[act] ?? `ACT ${act}`),
  };
}

// ---------------------------------------------------------------------------
// APN / PDP
// ---------------------------------------------------------------------------

/** +CGDCONT? lines: "+CGDCONT: <cid>,"<pdp_type>","<apn>","<addr>",..." */
export function parseCgdcont(lines) {
  const out = [];
  for (const l of lines || []) {
    const rest = afterPrefix(l, '+CGDCONT:');
    if (rest === null) continue;
    const f = splitAtFields(rest);
    out.push({ cid: num(f[0]), type: f[1] || '', apn: f[2] || '', addr: f[3] || '' });
  }
  return out;
}

const PDP_TYPES = ['IP', 'IPV6', 'IPV4V6'];

/** Build AT+CGDCONT=<cid>,"<type>","<apn>" after validating. Returns { cmd } or { error }. */
export function buildCgdcont(cid, type, apn) {
  const c = Number(cid);
  if (!Number.isInteger(c) || c < 1 || c > 16) return { error: 'Context id must be 1 to 16.' };
  if (!PDP_TYPES.includes(type)) return { error: 'PDP type must be IP, IPV6 or IPV4V6.' };
  const a = String(apn ?? '').trim();
  if (a.length > 100) return { error: 'APN is too long (max 100 characters).' };
  if (/["\r\n,]/.test(a)) return { error: 'APN must not contain quotes, commas or line breaks.' };
  return { cmd: `AT+CGDCONT=${c},"${type}","${a}"` };
}

// ---------------------------------------------------------------------------
// SMS (text mode)
// ---------------------------------------------------------------------------

/** Parse +CMTI: "SM",<index> (new message stored at index). */
export function parseCmti(line) {
  const rest = afterPrefix(line, '+CMTI:');
  if (rest === null) return null;
  const f = splitAtFields(rest);
  const index = num(f[1]);
  return index === null ? null : { mem: f[0] || '', index };
}

/** +CMGS: <mr> after a successful send. */
export function parseCmgs(lines) {
  for (const l of lines || []) {
    const rest = afterPrefix(l, '+CMGS:');
    if (rest !== null) return num(rest);
  }
  return null;
}

function smsFromLines(lines, re, withIndex) {
  const out = [];
  let cur = null;
  for (const line of lines || []) {
    const m = re.exec(line);
    if (m) {
      if (cur) out.push(cur);
      const f = splitAtFields(m[1]);
      const rest = withIndex ? f.slice(1) : f;
      cur = {
        index: withIndex ? num(f[0]) : null,
        status: rest[0] || '',
        sender: rest[1] || '',
        timestamp: rest.slice(3).find((x) => /\d{2}\/\d{2}\/\d{2},\d{2}:\d{2}/.test(x)) || '',
        body: [],
      };
    } else if (cur) {
      cur.body.push(line);
    }
  }
  if (cur) out.push(cur);
  return out.map((msg) => {
    const body = msg.body.slice();
    while (body.length && body[body.length - 1] === '') body.pop();
    return { ...msg, body: body.join('\n') };
  });
}

/** AT+CMGL="ALL" reply in text mode: header + body lines per message. */
export function parseCmgl(lines) {
  return smsFromLines(lines, /^\+CMGL:\s*(.*)$/, true);
}

/** AT+CMGR=<index> reply in text mode: one message, index not in the header. */
export function parseCmgr(lines) {
  const [m] = smsFromLines(lines, /^\+CMGR:\s*(.*)$/, false);
  return m || null;
}

/** Validate a destination number for text-mode SMS. Returns an error string or null. */
export function validateSmsNumber(n) {
  const s = String(n ?? '').trim();
  if (!s) return 'Enter a destination number.';
  if (!/^\+?\d{3,20}$/.test(s)) return 'Use digits only, optionally with a leading +, 3 to 20 digits.';
  return null;
}

/** Text-mode SMS: 160 GSM-7 characters in one part, 153 per part when concatenated. */
export function smsPartCount(text) {
  const s = String(text ?? '');
  if (!s) return 0;
  const len = [...s].length;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

/** True when the text is plain ASCII (safe for modem GSM-7 text mode). */
export function isAsciiText(text) {
  return /^[\x00-\x7f]*$/.test(String(text ?? ''));
}

// ---------------------------------------------------------------------------
// GNSS
// ---------------------------------------------------------------------------

/**
 * Convert a GNSS coordinate to signed decimal degrees.
 * Values with 4+ integer digits are ddmm.mmmm (or dddmm.mmmm); shorter values are already decimal.
 * hemi 'S' or 'W' negates; 'N' or 'E' keeps the sign positive; '' keeps the sign of the value.
 */
export function parseGnssCoord(value, hemi = '') {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const intDigits = s.replace(/^[-+]/, '').split('.')[0].length;
  const sign = n < 0 ? -1 : 1;
  const abs = Math.abs(n);
  let v = intDigits >= 4 ? Math.floor(abs / 100) + (abs % 100) / 60 : abs;
  if (/^[SW]$/i.test(hemi)) v = -v;
  else if (!/^[NE]$/i.test(hemi)) v = sign * v;
  return Math.round(v * 1e6) / 1e6;
}

/** SIMCom +CGPSINFO: <lat>,<N/S>,<lon>,<E/W>,<ddmmyy>,<hhmmss.s>,<alt>,<speed>,<course> */
export function parseCgpsinfo(line) {
  const rest = afterPrefix(line, '+CGPSINFO:');
  if (rest === null) return null;
  const f = splitAtFields(rest);
  if (!f[0]) return { fix: false };
  return {
    fix: true,
    lat: parseGnssCoord(f[0], f[1]),
    lon: parseGnssCoord(f[2], f[3]),
    date: f[4] || '',
    utc: f[5] || '',
    alt: num(f[6]),
    speed: num(f[7]),
    course: num(f[8]),
  };
}

/** Quectel +QGPSLOC: <utc>,<lat>,<lon>,<hdop>,<alt>,<fix>,<cog>,<spkm>,<spkn>,<date>,<nsat> */
export function parseQgpsloc(line) {
  const rest = afterPrefix(line, '+QGPSLOC:');
  if (rest === null) return null;
  const f = splitAtFields(rest);
  if (!f[1] || !f[2]) return { fix: false };
  return {
    fix: true,
    utc: f[0] || '',
    lat: parseGnssCoord(f[1]),
    lon: parseGnssCoord(f[2]),
    hdop: num(f[3]),
    alt: num(f[4]),
    fixType: f[5] || '',
    cog: num(f[6]),
    speedKmh: num(f[7]),
    speedKn: num(f[8]),
    date: f[9] || '',
    satellites: num(f[10]),
  };
}

// ---------------------------------------------------------------------------
// Safety and quick commands
// ---------------------------------------------------------------------------

const RISKY = [
  [/^AT\+CFUN=/i, 'changes the radio function level (can drop the network or reset the module)'],
  [/^AT\+(QPOWD|CPOF)/i, 'powers the module off'],
  [/^AT\+(QRST|CRESET)/i, 'resets the module'],
  [/^AT&F/i, 'restores factory defaults'],
  [/^AT\+CPIN=/i, 'sends a SIM PIN or PUK (wrong codes can lock the SIM)'],
  [/^AT\+CLCK=/i, 'changes a facility lock'],
  [/^AT\+CPWD=/i, 'changes a password'],
  [/^AT\+CMGD=\d+,\s*[1-4]\s*$/i, 'deletes SMS messages in bulk'],
  [/^AT\+CMGD=/i, 'deletes an SMS message'],
];

/** Returns a reason string when a command changes module state irreversibly or drops the link; else null. */
export function riskyReason(cmd) {
  const s = String(cmd ?? '').trim();
  for (const [re, why] of RISKY) if (re.test(s)) return why;
  return null;
}

export const QUICK_COMMANDS = [
  { group: 'Basics', cmd: 'AT', label: 'Ping (AT)' },
  { group: 'Basics', cmd: 'ATE0', label: 'Echo off (ATE0)' },
  { group: 'Basics', cmd: 'ATV1', label: 'Verbose results (ATV1)' },
  { group: 'Basics', cmd: 'AT+CMEE=1', label: 'Numeric errors (CMEE=1)' },
  { group: 'Basics', cmd: 'AT+CFUN?', label: 'Radio function (CFUN?)' },
  { group: 'Basics', cmd: 'AT+CPIN?', label: 'SIM status (CPIN?)' },
  { group: 'Network', cmd: 'AT+CSQ', label: 'Signal RSSI (CSQ)' },
  { group: 'Network', cmd: 'AT+CESQ', label: 'Extended signal (CESQ)' },
  { group: 'Network', cmd: 'AT+COPS?', label: 'Operator (COPS?)' },
  { group: 'Network', cmd: 'AT+CREG?', label: 'CS registration (CREG?)' },
  { group: 'Network', cmd: 'AT+CGREG?', label: 'GPRS registration (CGREG?)' },
  { group: 'Network', cmd: 'AT+CEREG?', label: 'LTE registration (CEREG?)' },
  { group: 'Data', cmd: 'AT+CGDCONT?', label: 'PDP contexts (CGDCONT?)' },
  { group: 'Data', cmd: 'AT+CGATT?', label: 'GPRS attach (CGATT?)' },
  { group: 'Data', cmd: 'AT+CGPADDR', label: 'PDP addresses (CGPADDR)' },
  { group: 'SIM', cmd: 'AT+CCLK?', label: 'Network clock (CCLK?)' },
  { group: 'SMS', cmd: 'AT+CSCA?', label: 'SMS centre (CSCA?)' },
  { group: 'SMS', cmd: 'AT+CSMP?', label: 'SMS params (CSMP?)' },
  { group: 'Module', cmd: 'AT+CPSI?', label: 'System info (CPSI?, SIMCom)' },
  { group: 'Module', cmd: 'AT+QENG="servingcell"', label: 'Serving cell (QENG, Quectel)' },
];

/** Custom quick-command text: one command per line, '#' starts a comment. */
export function parseQuickCommandText(text) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}
