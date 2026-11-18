// Pure helpers for the PortaPack/HackRF workbench: build command lines for the
// official HackRF host tools (hackrf_transfer, hackrf_sweep) and filter/sort the
// FREQMAN list. Nothing here talks to hardware; the output is text the user can
// copy and run on a PC that has the HackRF tools installed.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** LNA: 0-40 dB in 8 dB steps. VGA: 0-62 dB in 2 dB steps. */
export const snapLna = (v) => clamp(Math.round(num(v, 16) / 8) * 8, 0, 40);
export const snapVga = (v) => clamp(Math.round(num(v, 20) / 2) * 2, 0, 62);

const safeFileName = (s, fallback) => {
  const cleaned = String(s || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned || fallback;
};

/**
 * hackrf_transfer receive command. Sample rate 2-20 MHz; -n is the sample count
 * (rate x seconds) so the capture stops by itself; the baseband filter is left
 * to the tool's default.
 */
export function buildTransferCommand({ freqHz, sampleRate = 10e6, lna = 16, vga = 20, amp = false, seconds = 10, file = '' } = {}) {
  const f = Math.round(clamp(num(freqHz, 100e6), 1e6, 6e9));
  const sr = Math.round(clamp(num(sampleRate, 10e6), 2e6, 20e6));
  const secs = clamp(num(seconds, 10), 0, 3600);
  const name = safeFileName(file, `capture_${f}Hz_${sr}sps.cs8`);
  const parts = ['hackrf_transfer', '-r', name, '-f', String(f), '-s', String(sr), '-l', String(snapLna(lna)), '-g', String(snapVga(vga)), '-a', amp ? '1' : '0'];
  if (secs > 0) parts.push('-n', String(Math.round(sr * secs)));
  return parts.join(' ');
}

/** hackrf_sweep command: -f start:stop in MHz (whole MHz), -w bin width in Hz. */
export function buildSweepCommand({ startMHz = 88, stopMHz = 108, binWidthHz = 100000, lna = 16, vga = 20, amp = false, once = false, file = '' } = {}) {
  let a = Math.floor(clamp(num(startMHz, 88), 0, 7249));
  let b = Math.ceil(clamp(num(stopMHz, 108), 1, 7250));
  if (b <= a) b = a + 1;
  const w = Math.round(clamp(num(binWidthHz, 100000), 2445, 5e6));
  const parts = ['hackrf_sweep', '-f', `${a}:${b}`, '-w', String(w), '-l', String(snapLna(lna)), '-g', String(snapVga(vga)), '-a', amp ? '1' : '0'];
  if (once) parts.push('-1');
  const name = safeFileName(file, '');
  if (name) parts.push('-r', name);
  return parts.join(' ');
}

/** Rough size of a capture: 2 bytes per complex sample (8-bit I + 8-bit Q). */
export function captureBytes(sampleRate, seconds) {
  return Math.round(num(sampleRate, 0) * 2 * num(seconds, 0));
}

/** Filter FREQMAN entries by free text (label, category, modulation or a MHz value). */
export function filterFreqList(list, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((it) => {
    const mhz = (it.freq / 1e6).toString();
    return (it.label || '').toLowerCase().includes(q)
      || (it.category || '').toLowerCase().includes(q)
      || (it.mod || '').toLowerCase().includes(q)
      || mhz.startsWith(q);
  });
}

/** Sort a copy of the list: 'freq' ascending, 'name' A-Z, anything else keeps order. */
export function sortFreqList(list, by) {
  const copy = [...list];
  if (by === 'freq') copy.sort((x, y) => x.freq - y.freq);
  else if (by === 'name') copy.sort((x, y) => (x.label || '').localeCompare(y.label || ''));
  return copy;
}
