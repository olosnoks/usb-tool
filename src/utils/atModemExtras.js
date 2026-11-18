// Pure helpers for the AT Modem console: SMS PDU decoding, CSV/log export, command reference.

const GSM7_BASIC = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXT = { 0x0a: '\f', 0x14: '^', 0x28: '{', 0x29: '}', 0x2f: '\\', 0x3c: '[', 0x3d: '~', 0x3e: ']', 0x40: '|', 0x65: '€' };

function hexToBytes(hex) {
  const out = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** Unpack GSM 7-bit septets from bytes, starting skipBits bits in. */
export function unpackSeptets(bytes, count, skipBits = 0) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const bit = skipBits + i * 7;
    const idx = bit >> 3;
    const off = bit & 7;
    let v = (bytes[idx] ?? 0) >> off;
    if (off > 1) v |= (bytes[idx + 1] ?? 0) << (8 - off);
    out.push(v & 0x7f);
  }
  return out;
}

export function gsm7ToString(septets) {
  let s = '';
  for (let i = 0; i < septets.length; i++) {
    if (septets[i] === 0x1b && i + 1 < septets.length) {
      i += 1;
      s += GSM7_EXT[septets[i]] ?? ' ';
    } else {
      s += GSM7_BASIC[septets[i]] ?? '?';
    }
  }
  return s;
}

function swapNibbles(h) {
  let s = '';
  for (let i = 0; i + 1 < h.length; i += 2) s += h[i + 1] + h[i];
  return s;
}

function digitsOf(h) {
  return swapNibbles(h).replace(/F$/i, '').replace(/A/gi, '*').replace(/B/gi, '#');
}

function decodeAddress(hex, pos, isSmsc) {
  const len = parseInt(hex.slice(pos, pos + 2), 16);
  if (Number.isNaN(len)) return null;
  if (isSmsc) {
    if (len === 0) return { text: '', next: pos + 2 };
    const end = pos + 2 + len * 2;
    if (end > hex.length) return null;
    const type = parseInt(hex.slice(pos + 2, pos + 4), 16);
    return { text: `${(type & 0x70) === 0x10 ? '+' : ''}${digitsOf(hex.slice(pos + 4, end))}`, next: end };
  }
  const octets = Math.ceil(len / 2);
  const end = pos + 4 + octets * 2;
  if (end > hex.length) return null;
  const type = parseInt(hex.slice(pos + 2, pos + 4), 16);
  const body = hex.slice(pos + 4, end);
  if ((type & 0x70) === 0x50) {
    const chars = Math.floor((len * 4) / 7);
    return { text: gsm7ToString(unpackSeptets(hexToBytes(body), chars)), next: end, alpha: true };
  }
  return { text: `${(type & 0x70) === 0x10 ? '+' : ''}${digitsOf(body).slice(0, len)}`, next: end };
}

function decodeTimestamp(hex) {
  const d = swapNibbles(hex.slice(0, 12));
  if (d.length < 12 || /\D/.test(d)) return null;
  const tzByte = parseInt(hex.slice(12, 14), 16);
  const neg = (tzByte & 0x08) !== 0;
  const quarters = parseInt(swapNibbles((tzByte & 0xf7).toString(16).padStart(2, '0')), 10);
  const tzMin = quarters * 15;
  const tz = `${neg && tzMin ? "-" : "+"}${String(Math.floor(tzMin / 60)).padStart(2, '0')}:${String(tzMin % 60).padStart(2, '0')}`;
  return `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 6)} ${d.slice(6, 8)}:${d.slice(8, 10)}:${d.slice(10, 12)} ${tz}`;
}

function alphabetFromDcs(dcs) {
  const group = dcs & 0xf0;
  if (group === 0xe0) return 'ucs2';
  if (group === 0xf0) return (dcs & 4) ? '8bit' : 'gsm7';
  if ((dcs & 0xc0) === 0 || (dcs & 0xc0) === 0x40) return ['gsm7', '8bit', 'ucs2', 'gsm7'][(dcs >> 2) & 3];
  return 'gsm7';
}

/**
 * Decode an SMS-DELIVER or SMS-SUBMIT PDU given as hex (as AT+CMGR / AT+CMGL return it in PDU
 * mode, with or without the leading SMSC field). Local computation only; nothing is sent.
 */
export function decodeSmsPdu(input, { hasSmsc = true } = {}) {
  const hex = String(input || '').replace(/\s/g, '').toUpperCase();
  const fail = (error) => ({ ok: false, error });
  if (!hex) return fail('Paste a PDU as hex digits.');
  if (!/^[0-9A-F]+$/.test(hex)) return fail('PDU must contain only hex digits (0-9, A-F).');
  if (hex.length % 2) return fail('PDU has an odd number of hex digits.');
  let pos = 0;
  let smsc = '';
  if (hasSmsc) {
    const a = decodeAddress(hex, 0, true);
    if (!a) return fail('SMSC field is truncated.');
    smsc = a.text;
    pos = a.next;
  }
  const first = parseInt(hex.slice(pos, pos + 2), 16);
  if (Number.isNaN(first)) return fail('PDU ends before the first octet.');
  pos += 2;
  const mti = first & 3;
  if (mti > 1) return fail(`Message type ${mti} is not SMS-DELIVER or SMS-SUBMIT; only those are decoded.`);
  const submit = mti === 1;
  const hasUdh = (first & 0x40) !== 0;
  let reference = null;
  if (submit) { reference = parseInt(hex.slice(pos, pos + 2), 16); pos += 2; }
  const addr = decodeAddress(hex, pos, false);
  if (!addr) return fail('Address field is truncated.');
  pos = addr.next;
  const pid = parseInt(hex.slice(pos, pos + 2), 16);
  const dcs = parseInt(hex.slice(pos + 2, pos + 4), 16);
  if (Number.isNaN(dcs)) return fail('PDU ends before the data coding scheme.');
  pos += 4;
  let time = null;
  let validity = null;
  if (!submit) {
    if (pos + 14 > hex.length) return fail('Timestamp is truncated.');
    time = decodeTimestamp(hex.slice(pos, pos + 14));
    pos += 14;
  } else {
    const vpf = (first >> 3) & 3;
    if (vpf === 2) { validity = hex.slice(pos, pos + 2); pos += 2; } else if (vpf === 1 || vpf === 3) { validity = hex.slice(pos, pos + 14); pos += 14; }
  }
  const udl = parseInt(hex.slice(pos, pos + 2), 16);
  if (Number.isNaN(udl)) return fail('User data length is missing.');
  pos += 2;
  const ud = hexToBytes(hex.slice(pos));
  const alphabet = alphabetFromDcs(dcs);

  let concat = null;
  let udhLen = 0;
  if (hasUdh) {
    const l = ud[0];
    if (l === undefined || l + 1 > ud.length) return fail('User data header is truncated.');
    udhLen = l + 1;
    let i = 1;
    while (i + 1 < udhLen) {
      const iei = ud[i];
      const il = ud[i + 1];
      if (iei === 0 && il === 3) concat = { ref: ud[i + 2], total: ud[i + 3], part: ud[i + 4] };
      else if (iei === 8 && il === 4) concat = { ref: (ud[i + 2] << 8) | ud[i + 3], total: ud[i + 4], part: ud[i + 5] };
      i += 2 + il;
    }
  }
  let text;
  if (alphabet === 'gsm7') {
    const headSeptets = hasUdh ? Math.ceil((udhLen * 8) / 7) : 0;
    if (Math.ceil((udl * 7) / 8) > ud.length) return fail('User data is shorter than its length field says.');
    text = gsm7ToString(unpackSeptets(ud, Math.max(0, udl - headSeptets), headSeptets * 7));
  } else {
    if (udl > ud.length) return fail('User data is shorter than its length field says.');
    const body = ud.slice(udhLen, udl);
    if (alphabet === 'ucs2') {
      text = '';
      for (let i = 0; i + 1 < body.length; i += 2) text += String.fromCharCode((body[i] << 8) | body[i + 1]);
    } else {
      text = body.map((b) => String.fromCharCode(b)).join('');
    }
  }
  return {
    ok: true,
    type: submit ? 'SMS-SUBMIT' : 'SMS-DELIVER',
    smsc,
    address: addr.text,
    alphanumericSender: !!addr.alpha,
    pid,
    dcs,
    alphabet,
    time,
    validity,
    reference,
    concat,
    text,
  };
}

/** Signal history as CSV. rows: { t (ms since epoch), rssi, rsrp }. */
export function signalHistoryToCsv(rows) {
  const lines = ['time_iso,rssi_dbm,rsrp_dbm'];
  for (const r of rows || []) {
    lines.push(`${new Date(r.t).toISOString()},${r.rssi ?? ''},${r.rsrp ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Console log entries as plain text, optionally keeping only some directions (tx, rx, urc, sys). */
export function logToText(log, dirs) {
  return (log || [])
    .filter((e) => !dirs || dirs.includes(e.dir))
    .map((e) => `${e.ts} ${e.dir.toUpperCase()} ${e.text}`)
    .join('\n');
}

/** Common 3GPP TS 27.007 / 27.005 and vendor commands: [command, meaning]. */
export const AT_REFERENCE = [
  ['AT', 'Check the modem answers (expect OK)'],
  ['ATI', 'Product identification'],
  ['ATE0', 'Echo off'],
  ['ATV1', 'Verbose result codes'],
  ['AT+CMEE=1', 'Report errors as numeric +CME ERROR codes'],
  ['AT+CGMI', 'Manufacturer'],
  ['AT+CGMM', 'Model'],
  ['AT+CGMR', 'Firmware revision'],
  ['AT+CGSN', 'IMEI'],
  ['AT+CIMI', 'IMSI of the SIM'],
  ['AT+CCID', 'SIM ICCID (SIMCom)'],
  ['AT+QCCID', 'SIM ICCID (Quectel)'],
  ['AT+CPIN?', 'SIM PIN state'],
  ['AT+CSQ', 'Signal quality (RSSI index, BER)'],
  ['AT+CESQ', 'Extended signal quality (RSRP, RSRQ)'],
  ['AT+COPS?', 'Current operator'],
  ['AT+COPS=?', 'Scan for networks (slow, can take minutes)'],
  ['AT+CREG?', 'CS registration state'],
  ['AT+CGREG?', 'GPRS registration state'],
  ['AT+CEREG?', 'LTE registration state'],
  ['AT+CGATT?', 'Packet service attach state'],
  ['AT+CGDCONT?', 'List PDP contexts (APN)'],
  ['AT+CGACT?', 'PDP context activation state'],
  ['AT+CGPADDR', 'IP address of each PDP context'],
  ['AT+CFUN?', 'Functionality level'],
  ['AT+CMGF=1', 'SMS text mode'],
  ['AT+CMGF=0', 'SMS PDU mode'],
  ['AT+CMGL="ALL"', 'List all SMS (text mode)'],
  ['AT+CMGR=', 'Read SMS at index'],
  ['AT+CMGD=', 'Delete SMS at index'],
  ['AT+CNMI=2,1,0,0,0', 'Announce new SMS with +CMTI'],
  ['AT+CSCA?', 'SMS service centre number'],
  ['AT+CPMS?', 'SMS storage and usage'],
  ['AT+CUSD=', 'Send a USSD code'],
  ['AT+CCLK?', 'Modem clock'],
  ['AT+CBC', 'Battery or supply voltage'],
  ['AT+CPSI?', 'Serving cell (SIMCom)'],
  ['AT+QENG="servingcell"', 'Serving cell (Quectel)'],
  ['AT+QNWINFO', 'Access technology, band and channel (Quectel)'],
  ['AT+CGPS=1', 'Start GNSS (SIMCom)'],
  ['AT+QGPS=1', 'Start GNSS (Quectel)'],
];

export function searchAtReference(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return AT_REFERENCE;
  return AT_REFERENCE.filter(([c, d]) => c.toLowerCase().includes(q) || d.toLowerCase().includes(q));
}
