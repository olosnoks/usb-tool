// Test-only synthetic instrument signals (scope waveform + screenshot bitmap).
// Relocated from src/utils/scpiTools.js when demo data was removed from the app;
// used only by the simulated USBTMC/PTP transports in these tests.
export function demoScreenshotBmp(width = 160, height = 100) {
  const rowSize = (width * 3 + 3) & ~3;
  const size = 54 + rowSize * height;
  const b = new Uint8Array(size);
  const dv = new DataView(b.buffer);
  b[0] = 0x42; b[1] = 0x4d;
  dv.setUint32(2, size, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true); dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true); dv.setUint16(28, 24, true); dv.setUint32(34, rowSize * height, true);
  const px = (x, y, r, g, bl) => { const o = 54 + (height - 1 - y) * rowSize + x * 3; b[o] = bl; b[o + 1] = g; b[o + 2] = r; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const grid = x % 20 === 0 || y % 20 === 0;
    px(x, y, grid ? 40 : 0, grid ? 40 : 0, grid ? 40 : 10);
  }
  for (let x = 0; x < width; x++) {
    const y = Math.round(height / 2 - Math.sin((x / width) * Math.PI * 6) * height * 0.3);
    for (let t = -1; t <= 1; t++) if (y + t >= 0 && y + t < height) px(x, y + t, 250, 220, 0);
  }
  return b;
}

export function demoWaveform(points = 1000) {
  const xinc = 5e-6;
  const yinc = 0.02;
  const yref = 20;
  const yorig = 0;
  const data = new Uint8Array(points);
  for (let i = 0; i < points; i++) {
    const t = i * xinc;
    const v = 1.65 + 1.65 * Math.tanh(8 * Math.sin(2 * Math.PI * 1000 * t)) + Math.sin(i * 1.7) * 0.03;
    data[i] = Math.max(0, Math.min(255, Math.round(v / yinc + yref)));
  }
  const preamble = `0,0,${points},1,${xinc},${-(points / 2) * xinc},0,${yinc},${yorig},${yref}`;
  return { data, preamble };
}
