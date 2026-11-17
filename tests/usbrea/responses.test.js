// Port of usb-rea test_observations.py: 'seen <name> <value>' markers naming and scaling device readings.
// These build GET_REPORT captures with the usbmon writer and call analyze_responses directly (no pipeline,
// no report/scaffold); the make_capture based ones are in pipeline_responses.test.js.
import { describe, it, expect } from 'vitest';
import { analyze_responses, pair, _pattern } from '../../src/utils/usbrea/responses.js';
import { observations } from '../../src/utils/usbrea/actions.js';
import { read_transfers } from '../../src/utils/usbrea/pcap.js';
import { is_observation, split_observation } from '../../src/utils/usbrea/model.js';
import { UsbmonWriter, device_descriptor } from '../../src/utils/usbrea/synth.js';

const T0 = 1_760_000_000.0;

/** int.to_bytes(width, endian, signed) */
function ib(v, width, endian = 'big') {
  let x = BigInt.asUintN(width * 8, BigInt(v));
  const out = new Uint8Array(width);
  for (let i = 0; i < width; i++) {
    out[endian === 'big' ? width - 1 - i : i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}
const cat = (...p) => Uint8Array.from(p.flatMap((x) => (typeof x === 'number' ? [x] : [...x])));

/** GET_REPORT(Input 3) every 0.4 s answering 03 <raw bytes> 00, plus 'seen' markers `delay` s after the replies listed in `shown`. */
function reportCapture(raw_of, shown, { n = 20, marks = [], delay = 0.05 } = {}) {
  const w = new UsbmonWriter();
  w.control_in(T0, Uint8Array.of(0x80, 6, 0, 1, 0, 0, 18, 0), device_descriptor());
  const ms = [...marks];
  for (let i = 0; i < n; i++) {
    const tp = T0 + 0.5 + 0.4 * i;
    const data = cat(0x03, raw_of(i), 0x00);
    w.control_in(tp, Uint8Array.of(0xa1, 0x01, 0x03, 0x01, 0, 0, data.length, 0), data);
    if (i in shown) ms.push({ label: shown[i], start: tp + delay });
  }
  const transfers = read_transfers(w.save());
  const t0 = Math.min(...transfers.map((t) => t.ts));
  return analyze_responses(transfers, [], [], observations(ms, t0));
}
const poll = (rs) => rs.find((x) => x.query.startsWith('poll') || x.query.startsWith('GET_REPORT'));
const named = (r) => Object.fromEntries(r.fields.filter((f) => f.name).map((f) => [f.name, f]));
const shownFrom = (idx, fn) => Object.fromEntries(idx.map((i) => [i, fn(i)]));

describe('observation labels', () => {
  it('parses observation labels', () => {
    expect(split_observation('seen rpm 1180')).toEqual([['rpm', 1180.0]]);
    expect(split_observation('Seen RPM=1180, temp 34.5°C')).toEqual([['rpm', 1180.0], ['temp', 34.5]]);
    expect(split_observation('seen fan speed 1180rpm')).toEqual([['fan speed', 1180.0]]);
    expect(split_observation('seen pump on, alarm off')).toEqual([['pump', 1.0], ['alarm', 0.0]]);
    expect(split_observation('seen mode Turbo')).toEqual([['mode', 'turbo']]);
    expect(split_observation('seen rpm 900 fan mode quiet, led off')).toEqual([['rpm', 900.0], ['fan mode', 'quiet'], ['led', 0.0]]);
    expect(split_observation('seen temp -5°C')).toEqual([['temp', -5.0]]);
    expect(split_observation('seen silent')).toEqual([]);
    expect(split_observation('seen temp 41,5 °C, rpm 1,180')).toEqual([['temp', 41.5], ['rpm', 1180.0]]);
    expect(split_observation('seen v 12,25')).toEqual([['v', 12.25]]);
    expect(split_observation('seen rpm 1180,temp 40')).toEqual([['rpm', 1180.0], ['temp', 40.0]]);
    expect(split_observation('fan 1200')).toEqual([]);
    expect(is_observation('screen 3')).toBe(false);
    expect(is_observation('seen')).toBe(true);
  });
});

describe('naming readings from observations', () => {
  it('linear scale needs three observations', () => {
    const temps = Array.from({ length: 20 }, (_, i) => 20 + (i % 7) * 0.5); // device sends half degrees + 40
    const raw = (i) => Uint8Array.of(Math.trunc(temps[i] * 2 + 40));
    const three = shownFrom([1, 3, 5], (i) => `seen temp ${temps[i]}`); // 20.5, 21.5, 22.5
    const f = named(poll(reportCapture(raw, three))).temp;
    expect([f.scale, f.bias]).toEqual([2.0, 40.0]);
    expect(f.describe()).toContain('(raw - 40) / 2');
    const two = { 1: three[1], 5: three[5] }; // two points always fit a line: not enough
    expect(named(poll(reportCapture(raw, two)))).toEqual({});
  });

  it('two byte readings are combined as u16', () => {
    const rpms = [800, 1210, 2650, 3990, 1500, 2200]; // < 8 replies: decode keeps two u8 readings
    for (const delay of [0.05, -0.05]) { // marker typed after the reply, or just before
      const r = poll(reportCapture((i) => ib(rpms[i], 2), { 0: 'seen rpm 800', 2: 'seen rpm 2650', 4: 'seen rpm 1500' }, { n: 6, delay }));
      const f = named(r).rpm;
      expect([f.offset, f.width, f.endian]).toEqual([1, 2, 'be']);
      expect(f.limits).toEqual([800, 3990]);
      expect(r.fields.map((x) => x.offset)).toEqual([0, 1, 3]);
      expect(f.observed.map((x) => x[1])).toEqual([800, 2650, 1500]);
    }
  });

  it('four byte readings are combined as u32', () => {
    const ups = Array.from({ length: 20 }, (_, i) => 16_900_000 + 3_700_123 * i + i * i * 977); // uptime: all 4 bytes vary
    let r = poll(reportCapture((i) => ib(ups[i], 4, 'little'), shownFrom([2, 9, 15], (i) => `seen uptime ${ups[i]}`)));
    let f = named(r).uptime;
    expect([f.offset, f.width, f.endian, f.scale, f.bias]).toEqual([1, 4, 'le', 1.0, 0.0]);
    expect(r.fields.map((x) => x.offset)).toEqual([0, 1, 5]);
    // energy in Wh below 2**24 (high byte stays 0x00), shown by the app in kWh: raw = value * 1000
    const wh = Array.from({ length: 20 }, (_, i) => 70_000 + 241_000 * i + 1000 * ((i * i) % 7));
    r = poll(reportCapture((i) => ib(wh[i], 4, 'big'), shownFrom([1, 6, 12], (i) => `seen energy ${wh[i] / 1000}`)));
    f = named(r).energy;
    expect([f.offset, f.width, f.endian, f.scale, f.bias]).toEqual([1, 4, 'be', 1000.0, 0.0]);
    expect(f.limits).toEqual([70_000, wh[wh.length - 1]]);
  });

  it('wrong observations get no name', () => {
    const raw = (i) => Uint8Array.of(30 + (i % 4));
    let r = poll(reportCapture(raw, { 1: 'seen temp 70', 6: 'seen temp 12', 11: 'seen temp 99' }));
    expect(named(r)).toEqual({});
    expect(r.fields[1].kind).toBe('reading');
    expect(r.explained).toBe(2);
    // too far from any reply (> 1 s): not used at all
    r = poll(reportCapture(raw, {}, { marks: [{ label: 'seen temp 30', start: T0 + 30 }, { label: 'seen temp 31', start: T0 + 40 }] }));
    expect(named(r)).toEqual({});
  });

  it('an ambiguous name is left out', () => {
    const raw = (i) => Uint8Array.of(30 + (i % 5), i === 1 || i === 3 ? 30 + (i % 5) : 60 + (i % 3)); // equal when observed
    const r = poll(reportCapture(raw, { 1: 'seen temp 31', 3: 'seen temp 33' }));
    expect(named(r)).toEqual({});
    expect(r.notes.some((x) => x.includes('fits several readings'))).toBe(true);
  });
});

describe('flags, modes and levels', () => {
  const flags = (i) => Uint8Array.of(0x40 | (i % 2) | ((i % 3 === 2 ? 1 : 0) << 3)); // bit 0 pump, bit 3 alarm, bit 6 always set

  it('on/off flags are named by bit', () => {
    const shown = { 1: 'seen pump on alarm off', 2: 'seen pump off alarm on', 4: 'seen pump off, alarm off' };
    const r = poll(reportCapture(flags, shown));
    const n = named(r);
    expect([n.pump.offset, n.pump.bit_offset]).toEqual([1, 0]);
    expect([n.alarm.offset, n.alarm.bit_offset]).toEqual([1, 3]);
    expect(n.pump.observed.map((x) => x[1])).toEqual([1, 0, 0]);
    expect(r.explained).toBe(3);
    expect(n.alarm.describe()).toContain('bit 3: alarm (1 = on)');
    expect(r.notes.some((x) => x.includes('bits other than'))).toBe(false);
  });

  it('flags need both states and one bit', () => {
    expect(named(poll(reportCapture(flags, { 1: 'seen pump on', 3: 'seen pump on' })))).toEqual({});
    let r = poll(reportCapture((i) => Uint8Array.of(0x03 * (i % 2)), { 1: 'seen pump on', 2: 'seen pump off' })); // bits 0 and 1 always flip together
    expect(named(r)).toEqual({});
    expect(r.notes.some((x) => x.includes('fits several bits'))).toBe(true);
    r = poll(reportCapture((i) => Uint8Array.of((i % 2) | ((i % 4 === 3 ? 1 : 0) << 5)), { 1: 'seen pump on', 2: 'seen pump off' })); // bit 5 changes too but was never named
    expect(named(r).pump.bit_offset).toBe(0);
    expect(r.notes.some((x) => x.includes('mask 0x20'))).toBe(true);
  });

  const modes = (i) => Uint8Array.of(0x02 * (Math.floor(i / 5) % 2), 30 + (i % 4)); // byte 1: 00 silent / 02 turbo; byte 2: temperature

  it('modes are named from words', () => {
    const shown = { 1: 'seen mode silent', 3: 'seen mode silent', 6: 'seen mode Turbo', 12: 'seen mode silent' };
    const r = poll(reportCapture(modes, shown));
    const f = named(r).mode;
    expect([f.offset, f.bit_offset]).toEqual([1, null]);
    expect(f.table).toEqual(new Map([[0x00, 'silent'], [0x02, 'turbo']]));
    expect(f.describe()).toBe('mode: 0x00 = silent, 0x02 = turbo');
    expect(r.explained).toBe(3);
    expect(f.observed.map((x) => [x[0], x[1]])).toEqual([['silent', 0], ['silent', 0], ['turbo', 2], ['silent', 0]]);
  });

  it('modes need two words three times', () => {
    for (const shown of [{ 1: 'seen mode silent', 6: 'seen mode turbo' }, // each word only once
      { 1: 'seen mode silent', 2: 'seen mode silent', 3: 'seen mode silent' }]) { // one word
      expect(named(poll(reportCapture(modes, shown)))).toEqual({});
    }
    // a byte that is not the same for every 'silent' is not the mode (temperature drifts)
    const r = poll(reportCapture((i) => Uint8Array.of(30 + (i % 4)), { 1: 'seen mode silent', 2: 'seen mode silent', 6: 'seen mode turbo' }));
    expect(named(r)).toEqual({});
  });

  it('mode bits beside a flag', () => {
    // byte 1: bit 0 pump (flips every reply), bits 4-5 profile 0 eco / 1 normal / 2 boost, bit 7 always set
    const raw = (i) => Uint8Array.of(0x80 | (i % 2) | ((Math.floor(i / 5) % 3) << 4));
    const shown = { 1: 'seen profile eco, pump on', 2: 'seen pump off profile eco', 6: 'seen profile normal, pump off', 11: 'seen profile boost, pump on' };
    const r = poll(reportCapture(raw, shown));
    const n = named(r);
    expect(n.pump.bit_offset).toBe(0);
    expect([n.profile.offset, n.profile.bit_offset, n.profile.bit_width]).toEqual([1, 4, 2]);
    expect(n.profile.describe()).toBe('bits[4:6] profile: 0x00 = eco, 0x01 = normal, 0x02 = boost');
    expect(r.notes.some((x) => x.includes('bits other than'))).toBe(false);
  });

  it('a small level in bits beside a flag', () => {
    // byte 1: bit 0 charging (flips every reply), bits 1-3 battery bars 0..4, bits 4-7 reserved (0x50)
    const raw = (i) => Uint8Array.of(0x50 | (i % 2) | ((Math.floor(i / 4) % 6) << 1));
    const shown = { 1: 'seen charging on, battery 0', 2: 'seen charging off', 6: 'seen battery 1', 13: 'seen battery 3' };
    const n = named(poll(reportCapture(raw, shown)));
    expect(n.charging.bit_offset).toBe(0);
    expect([n.battery.offset, n.battery.bit_offset, n.battery.bit_width]).toEqual([1, 1, 3]);
    expect(n.battery.describe()).toBe('bits[1:4] battery, seen 0..4');
    // a level that two nibbles fit equally is left out with a note
    const r = poll(reportCapture((i) => Uint8Array.of((Math.floor(i / 5) % 3 + 1) * 0x11), { 1: 'seen bars 1', 6: 'seen bars 2' }));
    expect(named(r)).toEqual({});
    expect(r.notes.some((x) => x.includes("'bars' fits several bit groups (byte 1 bits 0-3, byte 1 bits 4-7)"))).toBe(true);
  });

  it('ambiguous or mixed modes are left out', () => {
    const two = (i) => Uint8Array.of(Math.floor(i / 5) % 2, 0x10 * (Math.floor(i / 5) % 2)); // bytes 1 and 2 switch together
    let r = poll(reportCapture(two, { 1: 'seen mode a b silent', 2: 'seen mode a b silent', 6: 'seen mode a b turbo' }));
    expect(named(r)).toEqual({});
    expect(r.notes.some((x) => x.includes("'mode a b' (silent, turbo) fits several places"))).toBe(true);
    // a mode byte (high) next to a drifting temperature (low) is first read as one u16: split again
    r = poll(reportCapture((i) => Uint8Array.of(30 + (i % 4), Math.floor(i / 5) % 2), { 1: 'seen mode silent', 3: 'seen mode silent', 7: 'seen mode turbo' }));
    expect(named(r).mode.offset).toBe(2);
    expect(named(r).mode.table).toEqual(new Map([[0, 'silent'], [1, 'turbo']]));
    expect(r.fields.filter((x) => !x.name).map((x) => [x.offset, x.kind, x.width, x.limits]).slice(1))
      .toEqual([[1, 'reading', 1, [30, 33]], [3, 'const', 1, null]]);
    const mixed = { 1: 'seen mode 0', 2: 'seen mode silent', 6: 'seen mode turbo' };
    r = poll(reportCapture(modes, mixed));
    expect(named(r)).toEqual({});
    expect(r.notes.some((x) => x.includes('both as a number and as a word'))).toBe(true);
  });
});

describe('signed and decimal values', () => {
  it('negative values are read as signed', () => {
    const temps = Array.from({ length: 20 }, (_, i) => -12 + ((i * 5) % 23)); // -12..10 C as one i8 byte
    let r = poll(reportCapture((i) => ib(temps[i], 1), shownFrom([1, 4, 9], (i) => `seen temp ${temps[i]}`)));
    let f = named(r).temp;
    expect([f.offset, f.width, f.signed, f.limits]).toEqual([1, 1, true, [-12, 10]]);
    expect(f.describe().startsWith('i8 temp = raw')).toBe(true);
    const lows = Array.from({ length: 20 }, (_, i) => -300 + 7 * i + ((i * i) % 5)); // i16 BE, all below zero
    r = poll(reportCapture((i) => ib(lows[i], 2), shownFrom([2, 9, 15], (i) => `seen depth ${lows[i]}`)));
    f = named(r).depth;
    expect([f.offset, f.width, f.endian, f.signed, f.limits]).toEqual([1, 2, 'be', true, [-300, Math.max(...lows)]]);
    expect(f.describe()).toContain('i16be depth = raw');
    // a device that adds a bias instead (raw = value + 40) stays unsigned: the top bit is never set
    r = poll(reportCapture((i) => Uint8Array.of(40 + temps[i]), shownFrom([1, 4, 9], (i) => `seen temp ${temps[i]}`)));
    f = named(r).temp;
    expect([f.signed, f.scale, f.bias]).toEqual([false, 1.0, 40.0]);
  });

  it('decimal values are read as tenths', () => {
    const temps = Array.from({ length: 20 }, (_, i) => 150 + ((i * 137) % 500)); // tenths of a degree, u16 BE
    const two = shownFrom([2, 7], (i) => `seen temp ${temps[i] / 10}`); // two decimals are enough
    expect(Object.values(two).every((m) => m.includes('.'))).toBe(true);
    const f = named(poll(reportCapture((i) => ib(temps[i], 2), two))).temp;
    expect([f.width, f.endian, f.scale, f.bias]).toEqual([2, 'be', 10.0, 0.0]);
    // whole numbers shown on screen are never read as tenths
    const r = poll(reportCapture((i) => ib(temps[i], 2), shownFrom([2, 7], (i) => `seen temp ${Math.floor(temps[i] / 10)}`)));
    expect('temp' in named(r)).toBe(false);
  });
});

describe('helpers', () => {
  it('_pattern marks varying bytes', () => {
    expect(_pattern([Uint8Array.of(0xaa, 1, 2), Uint8Array.of(0xaa, 3, 2)])).toBe('aa ?? 02');
  });

  it('pair returns an empty map without replies', () => {
    expect(pair(new Map(), []).size).toBe(0);
  });
});
