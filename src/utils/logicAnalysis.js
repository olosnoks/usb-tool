// Pure helpers for the Logic Analyzer window: edge snapping, edge counts between
// cursors, decode-table filtering and sigrok-cli command export.

const level = (buf, i, ch) => Number((buf[i] >>> ch) & 1);

/** Sample index of the edge (level change) closest to `sample` on a channel; `sample` itself when the channel has no edge. */
export function nearestEdge(buf, ch, sample) {
  if (!buf || buf.length < 2) return sample;
  const s = Math.max(1, Math.min(buf.length - 1, Math.round(sample)));
  for (let d = 0; d < buf.length; d++) {
    for (const i of d === 0 ? [s] : [s - d, s + d]) {
      if (i >= 1 && i < buf.length && level(buf, i, ch) !== level(buf, i - 1, ch)) return i;
    }
    if (s - d < 1 && s + d >= buf.length) break;
  }
  return sample;
}

/** Edge counts on one channel after sample `a` up to and including sample `b`, plus the mean rising-edge period in samples. */
export function edgesBetween(buf, ch, a, b) {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(buf.length - 1, Math.max(a, b));
  let rising = 0;
  let falling = 0;
  let firstRise = -1;
  let lastRise = -1;
  for (let i = lo + 1; i <= hi; i++) {
    const p = level(buf, i - 1, ch);
    const c = level(buf, i, ch);
    if (!p && c) { rising++; if (firstRise < 0) firstRise = i; lastRise = i; } else if (p && !c) falling++;
  }
  const periodSamples = rising > 1 ? (lastRise - firstRise) / (rising - 1) : 0;
  return { rising, falling, total: rising + falling, periodSamples };
}

/** Keep decoded items whose type, kind or label contains every word of `query` (case-insensitive). */
export function filterDecoded(items, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => {
    const hay = `${it.type} ${it.kind || ''} ${it.label}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const yn = (v) => (v ? 'yes' : 'no');

/**
 * Build a sigrok-cli command line that decodes the same capture with the same
 * settings. It is only text for the user to run in sigrok-cli; nothing is run here.
 * `chName(n)` gives the channel name stored in the exported .sr file.
 */
export function sigrokCliCommand(decoderId, chans, params = {}, { file = 'capture.sr', chName = (n) => `D${n}` } = {}) {
  const c = (role) => (chans[role] >= 0 ? chName(chans[role]) : null);
  const opt = (k, v) => (v === null || v === undefined ? null : `${k}=${v}`);
  let decoder;
  let parts;
  switch (decoderId) {
    case 'i2c':
      decoder = 'i2c'; parts = [opt('scl', c('scl')), opt('sda', c('sda'))]; break;
    case 'uart':
      decoder = 'uart';
      parts = [opt('rx', c('rx')), opt('baudrate', params.baud), opt('num_data_bits', params.dataBits), opt('parity_type', params.parity), opt('num_stop_bits', params.stopBits),
        opt('bit_order', params.msbFirst ? 'msb-first' : 'lsb-first'), opt('invert_rx', yn(params.inverted))];
      break;
    case 'spi':
      decoder = 'spi';
      parts = [opt('clk', c('clk')), opt('mosi', c('mosi')), opt('miso', c('miso')), opt('cs', c('cs')), opt('cpol', params.mode >> 1), opt('cpha', params.mode & 1),
        opt('wordsize', params.wordSize), opt('bitorder', params.msbFirst === false ? 'lsb-first' : 'msb-first'), opt('cs_polarity', params.csActiveLow === false ? 'active-high' : 'active-low')];
      break;
    case 'onewire':
      decoder = 'onewire_link'; parts = [opt('owr', c('dq'))]; break;
    case 'can':
      decoder = 'can'; parts = [opt('can_rx', c('rx')), opt('bitrate', params.bitrate)]; break;
    case 'ws2812':
      decoder = 'ws281x'; parts = [opt('din', c('din'))]; break;
    case 'ir':
      decoder = params.protocol === 'rc5' ? 'ir_rc5' : 'ir_nec';
      parts = [opt('ir', c('ir')), opt('polarity', params.activeLow === false ? 'active-high' : 'active-low')]; break;
    case 'swd':
      decoder = 'swd'; parts = [opt('swclk', c('swclk')), opt('swdio', c('swdio'))]; break;
    default:
      return '';
  }
  return `sigrok-cli -i ${file} -P ${[decoder, ...parts.filter(Boolean)].join(':')}`;
}
