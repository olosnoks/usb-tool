// Pure helpers for the RTL-SDR workbench: band presets, bookmarks, trace hold/average,
// peak search and rtl_power-style CSV export. No browser APIs except in the storage helpers.

export const MIN_FREQ_HZ = 24e6;
export const MAX_FREQ_HZ = 1766e6;

// Receive-only reference frequencies. Mode is a suggestion matching the workbench modes.
export const BAND_PRESETS = [
  { name: 'FM broadcast 98.0', hz: 98.0e6, mode: 'WFM' },
  { name: 'Airband 121.5 guard', hz: 121.5e6, mode: 'AM' },
  { name: 'Airband 127.5', hz: 127.5e6, mode: 'AM' },
  { name: 'Marine VHF ch16', hz: 156.8e6, mode: 'NFM' },
  { name: 'NOAA weather 162.550', hz: 162.55e6, mode: 'NFM' },
  { name: '2 m amateur calling', hz: 145.5e6, mode: 'NFM' },
  { name: '70 cm amateur calling', hz: 446.0e6, mode: 'NFM' },
  { name: 'ADS-B 1090', hz: 1090e6, mode: 'ADSB' },
];

export const STEP_OPTIONS = [1e3, 5e3, 12.5e3, 25e3, 100e3, 200e3, 1e6];

export function clampFreqHz(hz) {
  if (!Number.isFinite(hz)) return null;
  return Math.min(MAX_FREQ_HZ, Math.max(MIN_FREQ_HZ, Math.round(hz)));
}

export function stepFreqHz(hz, stepHz, direction) {
  return clampFreqHz(hz + Math.sign(direction) * stepHz);
}

export function formatFreq(hz) {
  return `${(hz / 1e6).toFixed(3)} MHz`;
}

// Frequency of a horizontal position (0..1) across a spectrum centred on centerHz.
export function fracToHz(frac, centerHz, sampleRate) {
  const f = Math.min(1, Math.max(0, frac));
  return centerHz - sampleRate / 2 + f * sampleRate;
}

// Peak hold: element-wise max. Pass null to start.
export function updatePeakHold(hold, spec) {
  if (!hold || hold.length !== spec.length) return Float32Array.from(spec);
  for (let i = 0; i < spec.length; i++) if (spec[i] > hold[i]) hold[i] = spec[i];
  return hold;
}

// Exponential moving average in dB (alpha 0..1, higher is faster).
export function updateAverage(avg, spec, alpha = 0.2) {
  if (!avg || avg.length !== spec.length) return Float32Array.from(spec);
  for (let i = 0; i < spec.length; i++) avg[i] += alpha * (spec[i] - avg[i]);
  return avg;
}

function binHz(i, len, centerHz, sampleRate) {
  return centerHz - sampleRate / 2 + ((i + 0.5) / len) * sampleRate;
}

// Strongest bin: { index, db, hz } or null.
export function findPeak(spec, centerHz, sampleRate) {
  if (!spec || !spec.length) return null;
  let index = 0;
  for (let i = 1; i < spec.length; i++) if (spec[i] > spec[index]) index = i;
  return { index, db: spec[index], hz: binHz(index, spec.length, centerHz, sampleRate) };
}

// Up to `count` local maxima above minDb, at least minSepBins apart, strongest first.
export function findPeaks(spec, centerHz, sampleRate, { count = 5, minDb = -Infinity, minSepBins = 8 } = {}) {
  const cand = [];
  for (let i = 1; i < spec.length - 1; i++) {
    if (spec[i] >= minDb && spec[i] > spec[i - 1] && spec[i] >= spec[i + 1]) cand.push(i);
  }
  cand.sort((a, b) => spec[b] - spec[a]);
  const out = [];
  for (const i of cand) {
    if (out.length >= count) break;
    if (out.every((j) => Math.abs(j - i) >= minSepBins)) out.push(i);
  }
  return out.map((i) => ({ index: i, db: spec[i], hz: binHz(i, spec.length, centerHz, sampleRate) }));
}

// rtl_power-style row: date, time, Hz low, Hz high, Hz step, samples, dB, dB, ...
// Values are this tool's FFT dBFS, not calibrated dBm.
export function toRtlPowerCsv(spec, centerHz, sampleRate, date = new Date(), samples = 1) {
  const pad = (n) => String(n).padStart(2, '0');
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  const low = Math.round(centerHz - sampleRate / 2);
  const high = Math.round(centerHz + sampleRate / 2);
  const step = (high - low) / spec.length;
  const vals = Array.from(spec, (v) => v.toFixed(2)).join(', ');
  return `${d}, ${t}, ${low}, ${high}, ${step.toFixed(2)}, ${samples}, ${vals}\n`;
}

export function spectrumFileName(centerHz, date = new Date()) {
  const stamp = date.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `rtlsdr_${Math.round(centerHz / 1000)}kHz_${stamp}.csv`;
}

const BOOKMARK_KEY = 'usb-tool.rtl-sdr.bookmarks.v1';
const MODE_IDS = ['WFM', 'NFM', 'AM', 'ADSB'];

export function normalizeBookmarks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((b) => b && Number.isFinite(b.hz) && b.hz >= MIN_FREQ_HZ && b.hz <= MAX_FREQ_HZ)
    .map((b) => ({
      name: String(b.name || formatFreq(b.hz)).slice(0, 40),
      hz: Math.round(b.hz),
      mode: MODE_IDS.includes(b.mode) ? b.mode : 'WFM',
    }))
    .slice(0, 100);
}

export function addBookmark(list, bm) {
  const kept = list.filter((b) => !(b.hz === bm.hz && b.mode === bm.mode));
  return normalizeBookmarks([...kept, bm]).sort((a, b) => a.hz - b.hz);
}

export function removeBookmark(list, hz, mode) {
  return list.filter((b) => !(b.hz === hz && b.mode === mode));
}

export function loadBookmarks() {
  try {
    return normalizeBookmarks(JSON.parse(globalThis.localStorage?.getItem(BOOKMARK_KEY) || '[]'));
  } catch { return []; }
}

export function saveBookmarks(list) {
  try { globalThis.localStorage?.setItem(BOOKMARK_KEY, JSON.stringify(list)); } catch { /* storage blocked */ }
}
