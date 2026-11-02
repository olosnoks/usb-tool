// In-browser flashing for the WarHog board carousel.
//
// Works the way the official WarHog web flasher does: read the board's ESP Web
// Tools manifest from the hosted site, fetch its firmware part(s), and write
// them over Web Serial — but using the usb-tool's own pure-ROM EspBootloaderClient
// (src/utils/espLoader.js) instead of esptool-js. The client already talks the
// ROM bootloader protocol with no RAM stub, which is exactly what the ESP32-C5's
// native USB-Serial/JTAG link needs (the stub drops that link mid-connect).
//
// Trailing/leading 0xFF trimming mirrors the web flasher's trimFlashImage so
// an 8 MB-padded release image isn't written in full over the slow ROM path.
import { EspBootloaderClient } from '../../../utils/espLoader';

const SECTOR_SIZE = 0x1000; // 4 KB flash sector

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Strip leading 4 KB sectors that are all 0xFF (e.g. 0x0000..0x1fff before the
// C5 bootloader at 0x2000) and trailing 0xFF padding, returning the trimmed
// view and the adjusted flash start address. Ported from c5flash.js.
export function trimFlashImage(data, baseAddress = 0) {
  let start = 0;
  while (start + SECTOR_SIZE <= data.length) {
    let allFF = true;
    for (let i = start; i < start + SECTOR_SIZE; i++) {
      if (data[i] !== 0xff) { allFF = false; break; }
    }
    if (!allFF) break;
    start += SECTOR_SIZE;
  }
  let end = data.length;
  while (end > start + SECTOR_SIZE && data[end - 1] === 0xff) end--;
  end = Math.min(data.length, (end + 3) & ~3);
  return { data: data.subarray(start, end), address: baseAddress + start };
}

const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1);
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Flash a board from its hosted manifest.
 *
 * @param {object}   opts
 * @param {string}   opts.manifestUrl  Absolute URL of the board's ESP Web Tools manifest.
 * @param {string}   [opts.expectChip] Card's chip family (e.g. "ESP32-S3") for a safety check.
 * @param {function} opts.report       Called with { stage, pct, busy, sub, kind } to drive the UI.
 * @returns {Promise<{cancelled?: boolean, chip?: string}>}
 */
export async function flashFromManifest({ manifestUrl, expectChip, report }) {
  if (!isWebSerialSupported()) {
    const err = new Error('Web Serial isn’t available in this browser. Use desktop Chrome, Edge or Brave.');
    err.friendly = true;
    throw err;
  }

  // Kick the manifest + firmware downloads off, but request the port FIRST on the
  // click gesture so Chrome's user activation hasn't expired by the time we ask.
  report({ stage: 'Choose the board’s serial port', sub: 'Pick it in the browser prompt.' });

  const assetsPromise = (async () => {
    const mResp = await fetch(manifestUrl, { cache: 'no-store' });
    if (!mResp.ok) throw new Error(`couldn’t fetch manifest (${mResp.status})`);
    const manifest = await mResp.json();
    const builds = Array.isArray(manifest.builds) ? manifest.builds : [];
    const build = (expectChip && builds.find((b) => b.chipFamily === expectChip)) || builds[0];
    if (!build || !Array.isArray(build.parts) || build.parts.length === 0) {
      throw new Error('manifest has no firmware parts');
    }
    const parts = [];
    for (const part of build.parts) {
      const partUrl = new URL(part.path, manifestUrl).href;
      const resp = await fetch(partUrl, { cache: 'no-store' });
      if (!resp.ok) throw new Error(`couldn’t fetch firmware (${resp.status})`);
      const bytes = new Uint8Array(await resp.arrayBuffer());
      parts.push(trimFlashImage(bytes, part.offset || 0));
    }
    return { build, parts };
  })();

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (pickErr) {
    if (pickErr && pickErr.name === 'NotFoundError') {
      report({ stage: 'No port selected', sub: 'Click Install to try again.' });
      return { cancelled: true };
    }
    throw pickErr;
  }

  report({ stage: 'Loading flasher & firmware', busy: true });
  const { build, parts } = await assetsPromise;
  const totalBytes = parts.reduce((n, p) => n + p.data.length, 0);

  await port.open({ baudRate: 115200 });
  const client = new EspBootloaderClient(port, () => {});
  try {
    report({ stage: 'Connecting to the board', busy: true, sub: 'Don’t unplug the board.' });
    // Reset into the ROM, sync, detect the chip, attach SPI flash.
    await client.connect(150, 50, 8);
    const chip = client.chip || 'ESP32-family';

    // Guard against flashing, say, an S3 image onto a C3. The ROM reports newer
    // chips (C5/C2) as a generic "ESP32-family (magic …)", so only enforce the
    // check when it identified a specific chip.
    const wanted = build.chipFamily || expectChip;
    if (wanted && !/family/i.test(chip) && !chip.includes(wanted)) {
      throw new Error(`this board is ${chip}, but the selected firmware is for ${wanted} — pick that board’s card instead`);
    }

    report({ stage: `Connected: ${chip}`, busy: true, sub: `Preparing to write ${mb(totalBytes)} MB…` });
    const t0 = Date.now();
    let writtenPrior = 0;
    for (let i = 0; i < parts.length; i++) {
      const { data, address } = parts[i];
      // rebootAfter=false here; we hard-reset once after the last part.
      // eslint-disable-next-line no-await-in-loop
      await client.flashPartition(data, address, 0x400, (_pct, written) => {
        const overall = writtenPrior + written;
        const elapsed = Date.now() - t0;
        let sub = `${mb(overall)} of ${mb(totalBytes)} MB · ${mmss(elapsed)}`;
        if (overall > 0 && elapsed > 2000 && overall < totalBytes) {
          sub += ` · ~${mmss((elapsed * (totalBytes - overall)) / overall)} left`;
        }
        report({ stage: 'Writing firmware', pct: totalBytes ? (overall / totalBytes) * 100 : 0, sub: `${sub} · don’t unplug` });
      }, false);
      writtenPrior += data.length;
    }

    report({ stage: 'Resetting the board', pct: 100, kind: 'ok' });
    try { await client.hardwareResetToApp(); } catch (_) { /* ignore */ }
    report({ stage: 'Done', pct: 100, kind: 'ok', sub: 'The board is running the new firmware. You can unplug it.' });
    return { chip };
  } finally {
    try { await client.release(); } catch (_) { /* ignore */ }
    try { await port.close(); } catch (_) { /* ignore */ }
  }
}
