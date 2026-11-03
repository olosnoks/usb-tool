// Full-chip flash reading via esptool-js's RAM stub.
//
// The ROM-only reader in espMemoryTool.js (READ_FLASH_SLOW) works on just the
// ESP8266 and the original ESP32. Every newer ESP (S2/S3/C2/C3/C6/H2) has no
// ROM read command — reading needs esptool's RAM stub, which implements the
// stub-only READ_FLASH command. esptool-js uploads that stub for us, so routing
// the dump through it makes "Dump flash to .bin" work on all of them.
//
// Same engine and loading strategy as the WarHog flasher (warhogFlash.js):
// esptool-js 0.7.0 from unpkg, and a self-owned serial port (requestPort +
// esptool opens/closes it) rather than the Terminal's borrowed port — esptool's
// internal read loop holds the port's reader for its whole session, which would
// deadlock against the Terminal's own read loop on a shared port.

const ESPTOOL_JS = 'https://unpkg.com/esptool-js@0.7.0/bundle.js';

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Download a Uint8Array as a .bin file.
function downloadBin(data, startOffset) {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `esp_flash_dump_0x${startOffset.toString(16).toUpperCase()}_${data.length}B.bin`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Read a flash range from any stub-supported ESP and download it as a .bin.
 *
 * @param {object}   opts
 * @param {number}   opts.startOffset  Flash offset to start reading at.
 * @param {number}   opts.length       Number of bytes to read.
 * @param {function} [opts.report]     Called with { stage, pct, bytesRead, totalBytes, busy } for the UI.
 * @param {function} [opts.onLog]      Called with (message, type) for the system log.
 * @returns {Promise<{cancelled?: boolean, data?: Uint8Array, chip?: string}>}
 */
export async function dumpFlashViaStub({ startOffset, length, report, onLog }) {
  if (!isWebSerialSupported()) {
    const err = new Error('Web Serial isn’t available in this browser. Use desktop Chrome, Edge or Brave.');
    err.friendly = true;
    throw err;
  }

  // Request the port on the click gesture, before awaiting the network import
  // (which can expire Chrome's user activation).
  report?.({ stage: 'Choose the board’s serial port', busy: true });
  const esptoolPromise = import(/* @vite-ignore */ ESPTOOL_JS);

  let port;
  try {
    port = await navigator.serial.requestPort();
  } catch (pickErr) {
    if (pickErr && pickErr.name === 'NotFoundError') {
      report?.({ stage: 'No port selected' });
      return { cancelled: true };
    }
    throw pickErr;
  }

  let transport = null;
  try {
    report?.({ stage: 'Connecting & loading the stub', busy: true });
    const { ESPLoader, Transport } = await esptoolPromise;

    transport = new Transport(port, false);
    const esploader = new ESPLoader({
      transport,
      baudrate: 115200,
      terminal: { clean() {}, writeLine(s) { onLog?.(String(s), 'sys'); }, write() {} },
      debugLogging: false
    });

    const chip = await esploader.main();
    onLog?.(`[DUMP] Connected to ${chip}.`, 'sys');
    if (!esploader.IS_STUB) {
      throw new Error(`${chip}: esptool's RAM stub isn't available for this chip, so its flash can't be read here.`);
    }

    onLog?.(`[DUMP] Reading ${length} bytes from 0x${startOffset.toString(16).toUpperCase()} via the stub...`, 'sys');
    report?.({ stage: `Reading flash (${chip})`, pct: 0, bytesRead: 0, totalBytes: length, busy: false });
    const raw = await esploader.readFlash(startOffset, length, (_packet, readSoFar, total) => {
      const totalBytes = total || length;
      const pct = totalBytes ? Math.min(100, Number(((readSoFar / totalBytes) * 100).toFixed(1))) : 0;
      report?.({ stage: `Reading flash (${chip})`, pct, bytesRead: readSoFar, totalBytes });
    });
    const data = raw instanceof Uint8Array ? raw : new Uint8Array(raw);

    report?.({ stage: 'Resetting the board', pct: 100 });
    try { await esploader.after('hard_reset'); } catch (_) { /* ignore */ }

    onLog?.(`[DUMP] Read ${data.length} bytes from flash.`, 'sys');
    downloadBin(data, startOffset);
    report?.({ stage: 'Done', pct: 100 });
    return { data, chip: String(chip) };
  } finally {
    try { if (transport) await transport.disconnect(); } catch (_) { /* ignore */ }
  }
}
