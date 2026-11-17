// Chip identification and flash reading via esptool-js's RAM stub.
//
// The ROM-only reader in espMemoryTool.js (READ_FLASH_SLOW) works on just the
// ESP8266 and the original ESP32. Every newer ESP (S2/S3/C2/C3/C6/H2) has no
// ROM read command — reading needs esptool's RAM stub, which implements the
// stub-only READ_FLASH command. esptool-js uploads that stub for us.
//
// esptool-js 0.7.0 is an npm dependency, loaded as a lazy chunk with
// `import('esptool-js')` (no CDN request at runtime). Like the WarHog flasher
// (warhogFlash.js) it owns its serial port (requestPort + esptool opens/closes
// it) instead of using the Terminal's borrowed port: esptool's read loop holds
// the port's reader for its whole session, which would deadlock a shared port.
import { FLASH_MANUFACTURERS } from './espMemoryTool';
import { parsePartitionTable, PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE } from './espPartitions';

export const ESP_BAUD_RATES = [115200, 460800, 921600];
const ROM_BAUD = 115200;

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

/** Lazy esptool-js chunk. */
export function loadEsptool() {
  return import('esptool-js');
}

/**
 * Decode the 24-bit SPI flash JEDEC id as esptool-js's readFlashId() returns it
 * (byte0 manufacturer, byte1 memory type, byte2 capacity = log2 of the size).
 * Size is null when the capacity byte is not a plain power-of-two code.
 */
export function parseFlashId(id) {
  const v = Number(id) >>> 0;
  if (v === 0 || v === 0xffffff) return null;
  const manufacturer = v & 0xff;
  const memType = (v >> 8) & 0xff;
  const capacity = (v >> 16) & 0xff;
  const sizeBytes = capacity >= 0x12 && capacity <= 0x1c ? 2 ** capacity : null;
  const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
  return {
    id: v,
    manufacturer,
    manufacturerName: FLASH_MANUFACTURERS[manufacturer] || `unknown (0x${hex(manufacturer)})`,
    device: `${hex(memType)}${hex(capacity)}`,
    sizeBytes
  };
}

export function formatBytes(n) {
  if (n == null) return '--';
  if (n >= 1048576) return `${n / 1048576} MB`;
  if (n >= 1024) return `${n / 1024} KB`;
  return `${n} B`;
}

/** Length of a "full flash" backup: the detected size; throws if it was not detected. */
export function fullFlashLength(flashInfo) {
  if (!flashInfo?.sizeBytes) throw new Error('Flash size is unknown. Run "Identify chip" first; this tool will not assume 4 MB.');
  return flashInfo.sizeBytes;
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

async function pickPort(report) {
  if (!isWebSerialSupported()) {
    const err = new Error('Web Serial isn’t available in this browser. Use desktop Chrome, Edge or Brave.');
    err.friendly = true;
    throw err;
  }
  report?.({ stage: 'Choose the board’s serial port', busy: true });
  try {
    return await navigator.serial.requestPort();
  } catch (pickErr) {
    if (pickErr && pickErr.name === 'NotFoundError') {
      report?.({ stage: 'No port selected' });
      return null;
    }
    throw pickErr;
  }
}

async function connectWithFallback(mod, port, baudrate, onLog) {
  const { ESPLoader, Transport } = mod;
  const attempts = baudrate > ROM_BAUD ? [baudrate, ROM_BAUD] : [ROM_BAUD];
  let lastErr;
  for (let i = 0; i < attempts.length; i++) {
    const baud = attempts[i];
    const transport = new Transport(port, false);
    const esploader = new ESPLoader({
      transport,
      baudrate: baud,
      romBaudrate: ROM_BAUD,
      terminal: { clean() {}, writeLine(s) { onLog?.(String(s), 'sys'); }, write() {} },
      debugLogging: false
    });
    try {
      const chip = await esploader.main();
      return { esploader, transport, chip: String(chip), baudrate: baud };
    } catch (e) {
      lastErr = e;
      try { await transport.disconnect(); } catch (_) { /* ignore */ }
      if (i < attempts.length - 1) onLog?.(`[ESP] Connecting at ${baud} baud failed (${e?.message || e}); retrying at ${ROM_BAUD}.`, 'sys');
    }
  }
  throw lastErr;
}

/**
 * Run `fn({ esploader, chip, flash, baudrate })` inside one esptool-js session:
 * pick the port (unless given), connect (falling back to 115200 if a faster
 * baud fails), read the flash id, and always disconnect afterwards.
 * Resolves { cancelled: true } if the port picker is dismissed.
 */
export async function withEspSession({ port, baudrate = ROM_BAUD, report, onLog }, fn) {
  // Request the port on the click gesture before awaiting the chunk import.
  const modPromise = loadEsptool();
  if (!port) {
    port = await pickPort(report);
    if (!port) return { cancelled: true };
  }
  let transport = null;
  try {
    report?.({ stage: 'Connecting & loading the stub', busy: true });
    const mod = await modPromise;
    const conn = await connectWithFallback(mod, port, baudrate, onLog);
    transport = conn.transport;
    const { esploader, chip } = conn;
    let flash = null;
    try { flash = parseFlashId(await esploader.readFlashId()); } catch (_) { /* reported as unknown */ }
    onLog?.(`[ESP] Connected to ${chip} at ${conn.baudrate} baud.`, 'sys');
    const result = await fn({ esploader, chip, flash, baudrate: conn.baudrate, port });
    try { await esploader.after('hard_reset'); } catch (_) { /* ignore */ }
    return { ...result, chip, port };
  } finally {
    try { if (transport) await transport.disconnect(); } catch (_) { /* ignore */ }
  }
}

/** Chip, features, crystal, MAC and flash identity through esptool-js (every chip it supports). */
export function identifyEsp(opts) {
  return withEspSession(opts, async ({ esploader, chip, flash, baudrate }) => {
    const safe = async (f) => { try { return await f(); } catch (_) { return null; } };
    const info = {
      chip,
      features: await safe(() => esploader.chip.getChipFeatures(esploader)),
      crystalMHz: await safe(() => esploader.chip.getCrystalFreq(esploader)),
      mac: await safe(() => esploader.chip.readMac(esploader)),
      flash,
      baudrate
    };
    return { info };
  });
}

/** Read the partition table at 0x8000 and parse it. */
export function readPartitionTable(opts) {
  return withEspSession(opts, async ({ esploader, chip }) => {
    opts.report?.({ stage: `Reading partition table (${chip})`, busy: true });
    const raw = await esploader.readFlash(PARTITION_TABLE_OFFSET, PARTITION_TABLE_SIZE);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    return { table: parsePartitionTable(bytes) };
  });
}

/**
 * Read a flash range from any stub-supported ESP and download it as a .bin.
 *
 * @param {object}   opts
 * @param {number}   opts.startOffset  Flash offset to start reading at.
 * @param {number}   opts.length       Number of bytes to read.
 * @param {number}   [opts.baudrate]   115200 (default), 460800 or 921600; falls back to 115200 on failure.
 * @param {object}   [opts.port]       Already-selected Web Serial port (otherwise the picker opens).
 * @param {function} [opts.report]     Called with { stage, pct, bytesRead, totalBytes, busy } for the UI.
 * @param {function} [opts.onLog]      Called with (message, type) for the system log.
 */
export async function dumpFlashViaStub({ startOffset, length, baudrate = ROM_BAUD, port, report, onLog }) {
  const result = await withEspSession({ port, baudrate, report, onLog }, async ({ esploader, chip, flash }) => {
    if (!esploader.IS_STUB) {
      throw new Error(`${chip}: esptool's RAM stub isn't available for this chip, so its flash can't be read here.`);
    }
    if (flash?.sizeBytes && startOffset + length > flash.sizeBytes) {
      throw new Error(`Range 0x${startOffset.toString(16)}+${length} runs past the detected ${formatBytes(flash.sizeBytes)} flash.`);
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
    onLog?.(`[DUMP] Read ${data.length} bytes from flash.`, 'sys');
    downloadBin(data, startOffset);
    return { data };
  });
  if (!result.cancelled) report?.({ stage: 'Done', pct: 100 });
  return result;
}
