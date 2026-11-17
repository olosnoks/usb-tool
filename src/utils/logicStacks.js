/**
 * logicStacks.js — second-level ("stacked") decoders for the Logic Analyzer.
 *
 * A stack takes the annotation items one base decoder produced (SPI words,
 * I2C transactions, UART bytes, CAN frames) and returns higher-level items:
 *   { type, start, end, kind: 'data' | 'control' | 'error', label, ...fields }
 * with start/end in sample indexes, so they draw in the same time base.
 * Each stack is { id, label, params, run(items, params, ctx) } and is listed
 * under `stack` on its base decoder in DECODERS (logicDecoders.js).
 */

import { I2C_CHIP_DATABASE } from './busExplorerDriver';
import { decodeJ1939Frame, UDS_SERVICES, UDS_NRC, UDS_DIDS } from './canTools';

const hex = (v, w = 2) => Number(v).toString(16).toUpperCase().padStart(w, '0');
const hexList = (bytes, max = 8) => `${bytes.slice(0, max).map((b) => hex(b)).join(' ')}${bytes.length > max ? ' ...' : ''}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------
// SPI -> serial flash commands
// ---------------------------------------------------------------------------

const JEDEC_MANUFACTURERS = {
  0x01: 'Spansion/Cypress', 0x0b: 'XTX', 0x1f: 'Adesto/Atmel', 0x20: 'Micron', 0x5e: 'Zbit', 0x68: 'Boya',
  0x85: 'Puya', 0x9d: 'ISSI', 0xbf: 'SST/Microchip', 0xc2: 'Macronix', 0xc8: 'GigaDevice', 0xef: 'Winbond'
};

// "manufacturer, memory type, capacity" -> part number, only for IDs published in vendor datasheets.
const JEDEC_PARTS = {
  'EF 40 14': 'W25Q80', 'EF 40 15': 'W25Q16', 'EF 40 16': 'W25Q32', 'EF 40 17': 'W25Q64', 'EF 40 18': 'W25Q128', 'EF 40 19': 'W25Q256',
  'EF 70 17': 'W25Q64JV', 'EF 70 18': 'W25Q128JV', 'EF 70 19': 'W25Q256JV',
  'C2 20 15': 'MX25L1606E', 'C2 20 16': 'MX25L3206E', 'C2 20 17': 'MX25L6406E', 'C2 20 18': 'MX25L12805D',
  'C8 40 15': 'GD25Q16', 'C8 40 16': 'GD25Q32', 'C8 40 17': 'GD25Q64', 'C8 40 18': 'GD25Q128',
  '20 BA 16': 'N25Q032', '20 BA 17': 'N25Q064', '20 BA 18': 'N25Q128', '20 BA 19': 'N25Q256'
};

/** "JEDEC ID EF 40 18 (Winbond W25Q128)". `id` is the 3 bytes the chip returned for 0x9F. */
export function describeJedecId(id) {
  const key = id.slice(0, 3).map((b) => hex(b)).join(' ');
  const mfr = JEDEC_MANUFACTURERS[id[0]] || null;
  const part = JEDEC_PARTS[key] || null;
  const cap = id[2] >= 10 && id[2] <= 30 ? 2 ** id[2] : null;
  const capText = cap ? (cap >= 2 ** 20 ? `${cap / 2 ** 20} MiB` : `${cap / 1024} KiB`) : null;
  const detail = [mfr && part ? `${mfr} ${part}` : mfr || null, !part && capText ? capText : null].filter(Boolean).join(', ');
  return `JEDEC ID ${key}${detail ? ` (${detail})` : ' (unknown manufacturer)'}`;
}

const addr24 = (m, at = 1) => (m.length >= at + 3 ? (m[at] << 16) | (m[at + 1] << 8) | m[at + 2] : null);
const STATUS_BITS = [[0, 'BUSY'], [1, 'WEL'], [2, 'BP0'], [3, 'BP1'], [4, 'BP2'], [5, 'TB'], [6, 'SEC'], [7, 'SRP']];
const statusText = (v) => STATUS_BITS.filter(([b]) => v & (1 << b)).map(([, n]) => n).join('|') || 'idle';

/** Annotate one chip-select transaction of 8-bit SPI words. */
function flashCommand(mosi, miso) {
  const cmd = mosi[0];
  const a = addr24(mosi);
  const A = (v) => `0x${hex(v, 6)}`;
  switch (cmd) {
    case 0x9f: {
      if (miso.length < 4) return { kind: 'error', label: 'JEDEC ID (cut short)' };
      const id = miso.slice(1, 4);
      return { kind: 'data', label: describeJedecId(id), jedec: id };
    }
    case 0x90: return miso.length >= 6 ? { kind: 'data', label: `MFR/DEVICE ID ${hex(miso[4])} ${hex(miso[5])}` } : { kind: 'control', label: 'MFR/DEVICE ID' };
    case 0xab: return { kind: 'control', label: miso.length >= 5 ? `RELEASE POWER-DOWN / ID ${hex(miso[4])}` : 'RELEASE POWER-DOWN' };
    case 0xb9: return { kind: 'control', label: 'POWER-DOWN' };
    case 0x66: return { kind: 'control', label: 'ENABLE RESET' };
    case 0x99: return { kind: 'control', label: 'RESET' };
    case 0x06: return { kind: 'control', label: 'WRITE ENABLE' };
    case 0x04: return { kind: 'control', label: 'WRITE DISABLE' };
    case 0x05: return miso.length >= 2 ? { kind: 'data', label: `READ STATUS 1 = 0x${hex(miso[1])} (${statusText(miso[1])})`, status: miso[1] } : { kind: 'control', label: 'READ STATUS 1' };
    case 0x35: return miso.length >= 2 ? { kind: 'data', label: `READ STATUS 2 = 0x${hex(miso[1])}` } : { kind: 'control', label: 'READ STATUS 2' };
    case 0x01: return { kind: 'control', label: `WRITE STATUS${mosi.length > 1 ? ` = ${hexList(mosi.slice(1))}` : ''}` };
    case 0x03: {
      if (a === null) return { kind: 'error', label: 'READ (address cut short)' };
      const data = miso.slice(4);
      return { kind: 'data', label: `READ ${A(a)}, ${plural(data.length, 'byte')}${data.length ? `: ${hexList(data)}` : ''}`, address: a, data };
    }
    case 0x0b: {
      if (a === null) return { kind: 'error', label: 'FAST READ (address cut short)' };
      const data = miso.slice(5);
      return { kind: 'data', label: `FAST READ ${A(a)}, ${plural(data.length, 'byte')}${data.length ? `: ${hexList(data)}` : ''}`, address: a, data };
    }
    case 0x5a: return { kind: 'data', label: `READ SFDP ${a === null ? '' : A(a)}, ${plural(Math.max(0, miso.length - 5), 'byte')}`.replace('  ', ' ') };
    case 0x02: {
      if (a === null) return { kind: 'error', label: 'PAGE PROGRAM (address cut short)' };
      const data = mosi.slice(4);
      return { kind: 'data', label: `PAGE PROGRAM ${A(a)}, ${plural(data.length, 'byte')}${data.length ? `: ${hexList(data)}` : ''}`, address: a, data };
    }
    case 0x20: return a === null ? { kind: 'error', label: 'SECTOR ERASE (address cut short)' } : { kind: 'control', label: `SECTOR ERASE 4 KB ${A(a)}`, address: a };
    case 0x52: return a === null ? { kind: 'error', label: 'BLOCK ERASE (address cut short)' } : { kind: 'control', label: `BLOCK ERASE 32 KB ${A(a)}`, address: a };
    case 0xd8: return a === null ? { kind: 'error', label: 'BLOCK ERASE (address cut short)' } : { kind: 'control', label: `BLOCK ERASE 64 KB ${A(a)}`, address: a };
    case 0xc7:
    case 0x60: return { kind: 'control', label: 'CHIP ERASE' };
    default: return { kind: 'data', label: `cmd 0x${hex(cmd)} (${plural(mosi.length - 1, 'more byte')})` };
  }
}

function spiTransactions(items) {
  const words = items.filter((i) => i.type === 'word' && !i.partial && i.bits === 8);
  const frames = items.filter((i) => i.type === 'cs');
  if (!frames.length) return words.length ? [{ start: words[0].start, end: words[words.length - 1].end, words }] : [];
  return frames
    .map((cs) => ({ start: cs.start, end: cs.end, words: words.filter((w) => w.start >= cs.start && w.end <= cs.end) }))
    .filter((t) => t.words.length);
}

export function stackSpiFlash(items) {
  return spiTransactions(items).map((t) => {
    const mosi = t.words.map((w) => w.mosi);
    const miso = t.words.map((w) => w.miso);
    const r = flashCommand(mosi, miso);
    return { type: 'spiflash', start: t.start, end: t.end, cmd: mosi[0], ...r };
  });
}

// ---------------------------------------------------------------------------
// I2C -> EEPROM / register names
// ---------------------------------------------------------------------------

const REGISTERS = {
  mpu6050: { 0x19: 'SMPLRT_DIV', 0x1a: 'CONFIG', 0x1b: 'GYRO_CONFIG', 0x1c: 'ACCEL_CONFIG', 0x23: 'FIFO_EN', 0x37: 'INT_PIN_CFG', 0x38: 'INT_ENABLE', 0x3a: 'INT_STATUS', 0x3b: 'ACCEL_XOUT_H', 0x41: 'TEMP_OUT_H', 0x43: 'GYRO_XOUT_H', 0x6a: 'USER_CTRL', 0x6b: 'PWR_MGMT_1', 0x6c: 'PWR_MGMT_2', 0x75: 'WHO_AM_I' },
  ds3231: { 0x00: 'SECONDS', 0x01: 'MINUTES', 0x02: 'HOURS', 0x03: 'DAY', 0x04: 'DATE', 0x05: 'MONTH', 0x06: 'YEAR', 0x07: 'ALARM1_SEC', 0x0e: 'CONTROL', 0x0f: 'STATUS', 0x11: 'TEMP_MSB' },
  bmx280: { 0xd0: 'ID', 0xe0: 'RESET', 0xf2: 'CTRL_HUM', 0xf3: 'STATUS', 0xf4: 'CTRL_MEAS', 0xf5: 'CONFIG', 0xf7: 'PRESS_MSB', 0xfa: 'TEMP_MSB', 0xfd: 'HUM_MSB' }
};
const SSD1306_CMDS = {
  0xae: 'display off', 0xaf: 'display on', 0x81: 'set contrast', 0xa4: 'resume RAM display', 0xa5: 'all pixels on', 0xa6: 'normal display',
  0xa7: 'inverse display', 0x20: 'set memory addressing mode', 0x21: 'set column address', 0x22: 'set page address', 0x8d: 'charge pump',
  0xd3: 'display offset', 0xd5: 'clock divide / oscillator', 0xa8: 'set multiplex ratio', 0xda: 'COM pins config', 0xc8: 'COM scan remapped', 0xc0: 'COM scan normal'
};

function registerMap(addr) {
  if (addr === 0x68) return { name: 'MPU-6050 / DS3231', lookup: (r) => REGISTERS.mpu6050[r] || (r <= 0x12 ? REGISTERS.ds3231[r] : null) };
  if (addr === 0x69) return { name: 'MPU-6050', lookup: (r) => REGISTERS.mpu6050[r] || null };
  if (addr === 0x76 || addr === 0x77) return { name: 'BMx280', lookup: (r) => REGISTERS.bmx280[r] || null };
  return null;
}

/** Group decoded I2C items into address phases: [{ addr, read, ack, bytes, acks, start, end }]. */
function i2cSegments(items) {
  const segs = [];
  let cur = null;
  for (const it of items) {
    if (it.type === 'start') { cur = null; continue; }
    if (it.type === 'stop') { cur = null; continue; }
    if (it.type === 'address') {
      cur = { addr: it.addr, read: it.read, ack: it.ack, bytes: [], acks: [], start: it.start, end: it.end };
      segs.push(cur);
    } else if (it.type === 'data' && cur) {
      cur.bytes.push(it.byte);
      cur.acks.push(it.ack);
      cur.end = it.end;
    }
  }
  return segs;
}

/**
 * I2C transactions -> EEPROM accesses (0x50-0x57, `addrBytes` of memory address)
 * and register read/writes with names for the MPU-6050, DS3231, BMx280 and
 * SSD1306 command bytes. A write of one register/address followed by a read
 * from the same device is shown as one register read.
 */
export function stackI2cRegisters(items, { addrBytes = 1 } = {}) {
  const segs = i2cSegments(items);
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const next = segs[i + 1];
    const name = I2C_CHIP_DATABASE[s.addr]?.name || null;
    const dev = `0x${hex(s.addr)}`;
    const base = { type: 'i2c-reg', start: s.start, end: s.end };
    if (!s.ack) { out.push({ ...base, kind: 'error', label: `${dev} no device answered (NACK)` }); continue; }
    const isEeprom = s.addr >= 0x50 && s.addr <= 0x57;
    const isOled = s.addr === 0x3c || s.addr === 0x3d;

    if (!s.read && s.bytes.length >= (isEeprom ? addrBytes : 1) && next && next.read && next.addr === s.addr) {
      // pointer write + read = a read from that register / memory address
      const pointer = isEeprom ? s.bytes.slice(0, addrBytes).reduce((v, b) => (v << 8) | b, 0) : s.bytes[0];
      const data = next.bytes;
      if (isEeprom) {
        out.push({ ...base, end: next.end, kind: 'data', label: `EEPROM ${dev} read @0x${hex(pointer, addrBytes * 2)}, ${plural(data.length, 'byte')}: ${hexList(data)}`, address: pointer, data });
      } else {
        const m = registerMap(s.addr);
        const rn = m?.lookup(pointer);
        out.push({ ...base, end: next.end, kind: 'data', label: `${dev}${name ? ` ${name}` : ''} read reg 0x${hex(pointer)}${rn ? ` ${rn}` : ''} = ${hexList(data)}`, register: pointer, data });
      }
      i++;
      continue;
    }

    if (isOled && !s.read && s.bytes.length) {
      const control = s.bytes[0];
      const rest = s.bytes.slice(1);
      if (control === 0x00) {
        const cmdName = rest.length ? SSD1306_CMDS[rest[0]] : null;
        out.push({ ...base, kind: 'control', label: `${dev} OLED commands: ${hexList(rest)}${cmdName ? ` (${cmdName})` : ''}` });
      } else if (control === 0x40) {
        out.push({ ...base, kind: 'data', label: `${dev} OLED display data, ${plural(rest.length, 'byte')}` });
      } else {
        out.push({ ...base, kind: 'data', label: `${dev} OLED control 0x${hex(control)}, ${plural(rest.length, 'byte')}` });
      }
      continue;
    }

    if (isEeprom && !s.read) {
      if (s.bytes.length < addrBytes) { out.push({ ...base, kind: 'error', label: `EEPROM ${dev} address cut short` }); continue; }
      const pointer = s.bytes.slice(0, addrBytes).reduce((v, b) => (v << 8) | b, 0);
      const data = s.bytes.slice(addrBytes);
      out.push({ ...base, kind: data.length ? 'data' : 'control', label: data.length ? `EEPROM ${dev} write @0x${hex(pointer, addrBytes * 2)}, ${plural(data.length, 'byte')}: ${hexList(data)}` : `EEPROM ${dev} set address @0x${hex(pointer, addrBytes * 2)}`, address: pointer, data });
      continue;
    }
    if (isEeprom && s.read) {
      out.push({ ...base, kind: 'data', label: `EEPROM ${dev} read (current address), ${plural(s.bytes.length, 'byte')}: ${hexList(s.bytes)}`, data: s.bytes });
      continue;
    }

    if (!s.read && s.bytes.length) {
      const m = registerMap(s.addr);
      const rn = m?.lookup(s.bytes[0]);
      const vals = s.bytes.slice(1);
      out.push({ ...base, kind: 'data', label: `${dev}${name ? ` ${name}` : ''} write reg 0x${hex(s.bytes[0])}${rn ? ` ${rn}` : ''}${vals.length ? ` = ${hexList(vals)}` : ''}`, register: s.bytes[0], data: vals });
    } else if (s.read) {
      out.push({ ...base, kind: 'data', label: `${dev}${name ? ` ${name}` : ''} read ${plural(s.bytes.length, 'byte')}: ${hexList(s.bytes)}`, data: s.bytes });
    } else {
      out.push({ ...base, kind: 'control', label: `${dev}${name ? ` ${name}` : ''} present (address ACK, no data)` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// UART -> NMEA 0183
// ---------------------------------------------------------------------------

const nmeaCoord = (v, hemi, degDigits) => {
  if (!v || !hemi) return null;
  const deg = Number(v.slice(0, degDigits));
  const min = Number(v.slice(degDigits));
  if (Number.isNaN(deg) || Number.isNaN(min)) return null;
  const dec = deg + min / 60;
  return `${(hemi === 'S' || hemi === 'W' ? -dec : dec).toFixed(5)}`;
};
const nmeaTime = (t) => (t && t.length >= 6 ? `${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}` : null);

/** "GGA 12:35:19 48.11730, 11.51667 fix 1, 8 sats, alt 545.4 M" from the comma fields of a sentence. */
function nmeaSummary(type, f) {
  const lat = (i) => nmeaCoord(f[i], f[i + 1], 2);
  const lon = (i) => nmeaCoord(f[i], f[i + 1], 3);
  const parts = [];
  switch (type) {
    case 'GGA':
      parts.push(nmeaTime(f[1]), lat(2) && lon(4) ? `${lat(2)}, ${lon(4)}` : 'no position', `fix ${f[6] || '?'}`, `${f[7] || '?'} sats`, f[9] ? `alt ${f[9]} ${f[10] || 'M'}` : null);
      break;
    case 'RMC':
      parts.push(nmeaTime(f[1]), f[2] === 'A' ? 'valid' : 'void', lat(3) && lon(5) ? `${lat(3)}, ${lon(5)}` : 'no position', f[7] ? `${f[7]} kn` : null, f[8] ? `course ${f[8]}` : null, f[9] ? `date ${f[9]}` : null);
      break;
    case 'GLL':
      parts.push(nmeaTime(f[5]), lat(1) && lon(3) ? `${lat(1)}, ${lon(3)}` : 'no position', f[6] === 'A' ? 'valid' : 'void');
      break;
    case 'VTG':
      parts.push(f[1] ? `course ${f[1]}` : null, f[5] ? `${f[5]} kn` : null, f[7] ? `${f[7]} km/h` : null);
      break;
    case 'GSA':
      parts.push(`mode ${f[1] || '?'}${f[2] || ''}`, f[16] ? `PDOP ${f[16]}` : null);
      break;
    case 'GSV':
      parts.push(`msg ${f[2] || '?'}/${f[1] || '?'}`, `${f[3] || '?'} sats in view`);
      break;
    case 'ZDA':
      parts.push(nmeaTime(f[1]), f[2] && f[3] && f[4] ? `${f[4]}-${f[3]}-${f[2]}` : null);
      break;
    default:
  }
  return parts.filter(Boolean).join(' ');
}

/** Assemble UART bytes into NMEA 0183 sentences and verify their checksums. */
export function stackNmea(items) {
  const out = [];
  let buf = '';
  let first = null;
  let last = null;
  const finish = () => {
    if (buf && first) {
      const text = buf;
      const star = text.lastIndexOf('*');
      const body = text.slice(1, star >= 0 ? star : undefined);
      let sum = 0;
      for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
      const given = star >= 0 ? text.slice(star + 1, star + 3).toUpperCase() : null;
      const expected = hex(sum);
      const fields = body.split(',');
      const id = fields[0] || '';
      const type = id.length === 5 ? id.slice(2) : id;
      const ok = given === null ? null : given === expected;
      const summary = nmeaSummary(type, fields);
      out.push({
        type: 'nmea', start: first.start, end: last.end, sentence: text, checksumOk: ok,
        kind: ok === false ? 'error' : 'data',
        label: `${id}${summary ? ` ${summary}` : ''}${ok === false ? ` CHECKSUM BAD (got ${given || '--'}, expected ${expected})` : ok === null ? ' (no checksum)' : ''}`
      });
    }
    buf = ''; first = null; last = null;
  };
  for (const it of items) {
    if (it.type !== 'uart' || it.errors?.length) { if (it.type === 'uart' && buf) { buf += '?'; last = it; } continue; }
    const ch = it.byte;
    if (ch === 0x24 || ch === 0x21) { finish(); buf = String.fromCharCode(ch); first = it; last = it; continue; }
    if (ch === 0x0a || ch === 0x0d) { finish(); continue; }
    if (buf) {
      if (buf.length > 120) { finish(); continue; } // NMEA sentences are at most 82 characters
      buf += ch >= 0x20 && ch < 0x7f ? String.fromCharCode(ch) : '?';
      last = it;
    }
  }
  finish();
  return out;
}

// ---------------------------------------------------------------------------
// CAN -> UDS / OBD / J1939 names
// ---------------------------------------------------------------------------

const OBD_MODES = { 0x01: 'Show current data', 0x02: 'Show freeze frame data', 0x03: 'Show stored DTCs', 0x04: 'Clear DTCs', 0x07: 'Show pending DTCs', 0x09: 'Request vehicle information', 0x0a: 'Permanent DTCs' };

function describeDiagPayload(p) {
  const sid = p[0];
  if (sid === 0x7f) {
    const svc = UDS_SERVICES[p[1]] || OBD_MODES[p[1]] || `service 0x${hex(p[1] ?? 0)}`;
    return { text: `NEGATIVE ${svc}: ${UDS_NRC[p[2]] || 'unknown'} (NRC 0x${hex(p[2] ?? 0)})`, kind: p[2] === 0x78 ? 'control' : 'error' };
  }
  const isResp = (sid >= 0x41 && sid <= 0x4a) || (sid >= 0x50 && UDS_SERVICES[sid - 0x40] !== undefined && UDS_SERVICES[sid] === undefined);
  const req = isResp ? (sid - 0x40) & 0xff : sid;
  const name = req < 0x10 ? OBD_MODES[req] : UDS_SERVICES[req];
  const proto = req < 0x10 ? 'OBD' : 'UDS';
  let extra = '';
  if (req === 0x22 && !isResp && p.length >= 3) {
    const dids = [];
    for (let i = 1; i + 1 < p.length; i += 2) dids.push((p[i] << 8) | p[i + 1]);
    extra = dids.map((d) => `DID ${hex(d, 4)}${UDS_DIDS[d] ? ` ${UDS_DIDS[d]}` : ''}`).join(', ');
  } else if (req === 0x22 && isResp && p.length >= 3) {
    const d = (p[1] << 8) | p[2];
    extra = `DID ${hex(d, 4)}${UDS_DIDS[d] ? ` ${UDS_DIDS[d]}` : ''}`;
  } else if (req === 0x10 && p.length >= 2) extra = `session 0x${hex(p[1])}`;
  else if (req === 0x31 && p.length >= 4) extra = `${['', 'start', 'stop', 'results'][p[1]] || `type ${p[1]}`} routine ${hex((p[2] << 8) | p[3], 4)}`;
  else if (req === 0x27 && p.length >= 2) extra = `level 0x${hex(p[1])}`;
  else if (req === 0x2e && p.length >= 3) extra = `DID ${hex((p[1] << 8) | p[2], 4)}`;
  else if (req === 0x3e) extra = '';
  else if (req < 0x10 && p.length >= 2) extra = `PID/IC 0x${hex(p[1])}`;
  const label = name || `service 0x${hex(req)}`;
  return { text: `${proto} ${label} ${isResp ? 'response' : 'request'}${extra ? `: ${extra}` : ''}`, kind: 'data' };
}

/** CAN frames -> J1939 PGN names (29-bit) and UDS/OBD services over ISO-TP (11-bit 7DF/7E0-7EF, 29-bit 18DAxxxx). */
export function stackCanNames(items) {
  const out = [];
  for (const f of items) {
    if (f.type !== 'frame') continue;
    const data = f.data || [];
    const base = { start: f.start, end: f.end };
    const diag29 = f.extended && ((f.id >>> 16) === 0x18da || (f.id >>> 16) === 0x18db);
    const diag11 = !f.extended && (f.id === 0x7df || (f.id >= 0x7e0 && f.id <= 0x7ef));
    if (diag11 || diag29) {
      if (f.rtr || !data.length) continue;
      const pci = data[0] >> 4;
      let text = null;
      let kind = 'data';
      if (pci === 0 && (data[0] & 0x0f) > 0) {
        const d = describeDiagPayload(data.slice(1, 1 + Math.min(7, data[0] & 0x0f)));
        text = d.text; kind = d.kind;
      } else if (pci === 1 && data.length >= 3) {
        const len = ((data[0] & 0x0f) << 8) | data[1];
        const d = describeDiagPayload(data.slice(2, 8));
        text = `ISO-TP first frame (${len} bytes) ${d.text}`; kind = d.kind;
      } else if (pci === 2) text = `ISO-TP consecutive frame ${data[0] & 0x0f}`;
      else if (pci === 3) text = `ISO-TP flow control ${['continue', 'wait', 'overflow'][data[0] & 0x0f] || '?'}`;
      if (text) {
        const who = diag29 ? ` ${hex((f.id >>> 8) & 0xff)}<-${hex(f.id & 0xff)}` : '';
        out.push({ ...base, type: 'can-diag', kind, id: f.id, label: `${text}${who}` });
      }
      continue;
    }
    if (f.extended && !f.rtr) {
      const j = decodeJ1939Frame({ id: f.id, isExtended: true, data: Uint8Array.from(data) });
      const sigs = j.signals.filter((s) => s.value !== null).slice(0, 3).map((s) => `${s.name} ${s.value}${s.unit ? ` ${s.unit}` : ''}`);
      out.push({
        ...base, type: 'j1939', kind: 'data', id: f.id, pgn: j.pgn, sa: j.sa,
        label: `${j.acronym || `PGN ${j.pgn}`} SA ${hex(j.sa)}${j.pdu1 ? ` DA ${hex(j.da)}` : ''}${j.name && !j.acronym ? '' : ''}${sigs.length ? `: ${sigs.join(', ')}` : ''}`
      });
    }
  }
  return out;
}

/** The stacks, keyed by base decoder id (logicDecoders.js attaches them as DECODERS[id].stack). */
export const STACKS = {
  spi: [{ id: 'spiflash', label: 'SPI flash commands', params: {}, run: (items) => stackSpiFlash(items) }],
  i2c: [{ id: 'i2c-registers', label: 'EEPROM / register names', params: { addrBytes: 1 }, run: (items, p) => stackI2cRegisters(items, p) }],
  uart: [{ id: 'nmea', label: 'NMEA 0183 (GPS)', params: {}, run: (items) => stackNmea(items) }],
  can: [{ id: 'can-names', label: 'UDS / OBD / J1939 names', params: {}, run: (items) => stackCanNames(items) }]
};
