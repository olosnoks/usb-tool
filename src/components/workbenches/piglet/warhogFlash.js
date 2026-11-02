// In-browser flashing for the WarHog board carousel — a faithful port of the
// official WarHog web flasher's c5flash.js (olosnoks/warhog web-flasher/c5flash.js),
// so a board flashes here exactly as it does on the hosted flasher.
//
// Same engine: esptool-js 0.7.0 loaded from unpkg, the same four ESP32-C5 ROM
// (--no-stub) patches, the same leading/trailing 0xFF trim, and the same
// compressed writeFlash + hard reset. The only adaptation is that progress is
// reported through a `report(st)` callback (for the React progress block)
// instead of writing into the card's DOM.

const ESPTOOL_JS = 'https://unpkg.com/esptool-js@0.7.0/bundle.js';
const SECTOR_SIZE = 0x1000; // 4 KB flash sector

export function isWebSerialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// Strip leading 4 KB sectors that are all 0xFF (e.g. 0x0000..0x1fff before the
// C5 bootloader at 0x2000) and trailing 0xFF padding (e.g. 8 MB-padded release
// images), returning the trimmed Uint8Array and adjusted flash start address.
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

// Patch an esptool-js 0.7.0 ESPLoader instance so ESP32-C5 boards connect,
// flash in ROM (--no-stub) mode, and hard-reset cleanly. Ported verbatim.
export function patchEspLoaderForC5(esploader, { onEraseStart } = {}) {
  // 1. 150 ms settle after USB-JTAG reset releases RTS so the C5's ROM boot
  //    banner lands before flushInput() + sync() run.
  const origUsbReset = esploader.resetConstructors?.usbJTAGSerialReset;
  if (origUsbReset) {
    esploader.resetConstructors.usbJTAGSerialReset = (transport) => {
      const resetter = origUsbReset(transport);
      const origReset = resetter.reset.bind(resetter);
      resetter.reset = async () => {
        await origReset();
        await new Promise((r) => setTimeout(r, 150));
      };
      return resetter;
    };
  }

  // 2. Fix HardReset (0.7.0 omits setRTS(true) before setRTS(false)).
  if (esploader.resetConstructors) {
    esploader.resetConstructors.hardReset = (transport) => ({
      async reset() {
        await transport.setDTR(false);
        await transport.setRTS(true);
        await new Promise((r) => setTimeout(r, 200));
        await transport.setRTS(false);
        await new Promise((r) => setTimeout(r, 200));
      }
    });
  }

  // 3. On ESP32-C5, bypass the RAM stub (which drops USB-Serial/JTAG) and set up
  //    the ROM bootloader's SPI flash interface directly.
  const origRunStub = esploader.runStub.bind(esploader);
  esploader.runStub = async function runStub() {
    const chipName = this.chip?.CHIP_NAME || '';
    if (!chipName.startsWith('ESP32-C5')) return origRunStub();
    this.IS_STUB = false;
    if (this.chip && this.chip.FLASH_WRITE_SIZE) this.FLASH_WRITE_SIZE = this.chip.FLASH_WRITE_SIZE; // 1024 in ROM mode
    this.info('Using ROM bootloader (--no-stub mode for ESP32-C5)...');
    await this.checkCommand('configure SPI flash pins', this.ESP_SPI_ATTACH, new Uint8Array(8));
    const params = new Uint8Array(24);
    const dv = new DataView(params.buffer);
    dv.setUint32(0, 0, true);               // fl_id
    dv.setUint32(4, 8 * 1024 * 1024, true); // total_size (8 MB)
    dv.setUint32(8, 64 * 1024, true);       // block_size (64 KB)
    dv.setUint32(12, 4 * 1024, true);       // sector_size (4 KB)
    dv.setUint32(16, 256, true);            // page_size (256 B)
    dv.setUint32(20, 0xffff, true);         // status_mask
    await this.checkCommand('set SPI params', 0x0b, params);
    return this.chip;
  };

  // 4. Fix flashDeflBegin in ROM mode: 0.7.0 omits the 5th uint32 for C5/C6.
  const origFlashDeflBegin = esploader.flashDeflBegin.bind(esploader);
  esploader.flashDeflBegin = async function flashDeflBegin(size, compsize, offset) {
    if (this.IS_STUB) return origFlashDeflBegin(size, compsize, offset);
    const numBlocks = Math.floor((compsize + this.FLASH_WRITE_SIZE - 1) / this.FLASH_WRITE_SIZE);
    const eraseBlocks = Math.floor((size + this.FLASH_WRITE_SIZE - 1) / this.FLASH_WRITE_SIZE);
    const writeSize = eraseBlocks * this.FLASH_WRITE_SIZE;
    const timeout = this.timeoutPerMb(this.ERASE_REGION_TIMEOUT_PER_MB, writeSize);
    this.info('Compressed ' + size + ' bytes to ' + compsize + '...');
    this.info('Erasing flash (this takes a few seconds in ROM mode)...');
    if (onEraseStart) onEraseStart();
    let pkt = this._appendArray(this._intToByteArray(writeSize), this._intToByteArray(numBlocks));
    pkt = this._appendArray(pkt, this._intToByteArray(this.FLASH_WRITE_SIZE));
    pkt = this._appendArray(pkt, this._intToByteArray(offset));
    pkt = this._appendArray(pkt, this._intToByteArray(0)); // 5th uint32: encrypted_write = 0
    await this.checkCommand('enter compressed flash mode', this.ESP_FLASH_DEFL_BEGIN, pkt, undefined, undefined, timeout);
    return numBlocks;
  };
}

const mb = (n) => (n / 1048576).toFixed(n >= 10485760 ? 0 : 1);
const mmss = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Flash one board's firmware image over Web Serial, exactly as c5flash.js does.
 *
 * @param {object}   opts
 * @param {string}   opts.binUrl     Absolute URL of the merged firmware .bin.
 * @param {string}   [opts.expectChip] Card's chip family (e.g. "ESP32-S3") for a safety check.
 * @param {function} opts.report     Called with { stage, pct, busy, sub, kind } to drive the UI.
 * @returns {Promise<{cancelled?: boolean, chip?: string}>}
 */
export async function flashBoardFirmware({ binUrl, expectChip, report }) {
  if (!isWebSerialSupported()) {
    const err = new Error('Web Serial isn’t available in this browser. Use desktop Chrome, Edge or Brave.');
    err.friendly = true;
    throw err;
  }

  let transport = null;
  let lastPct = null;
  // Request the serial port on the click gesture, before awaiting the network
  // import/download (which can expire Chrome's user activation).
  report({ stage: 'Choose the board’s serial port', sub: 'Pick it in the browser prompt.' });
  const esptoolPromise = import(/* @vite-ignore */ ESPTOOL_JS);
  const fwPromise = fetch(binUrl, { cache: 'no-store' }).then(async (resp) => {
    if (!resp.ok) throw new Error('couldn’t fetch image (' + resp.status + ')');
    return new Uint8Array(await resp.arrayBuffer());
  });

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

  try {
    report({ stage: 'Loading flasher & firmware', busy: true });
    const [{ ESPLoader, Transport }, rawData] = await Promise.all([esptoolPromise, fwPromise]);
    const { data, address } = trimFlashImage(rawData, 0);

    transport = new Transport(port, false);
    const esploader = new ESPLoader({
      transport,
      baudrate: 115200,
      terminal: { clean() {}, writeLine(s) { console.log(s); }, write(s) { console.log(s); } },
      debugLogging: false
    });

    patchEspLoaderForC5(esploader, {
      onEraseStart: () => report({ stage: 'Erasing flash', busy: true, sub: 'Takes 5–10 s. Don’t unplug the board.' })
    });

    report({ stage: 'Connecting to the board', busy: true });
    const chip = await esploader.main();
    if (expectChip && String(chip).indexOf(expectChip) === -1) {
      throw new Error('This board is ' + chip + ', but this card’s firmware is for ' + expectChip
        + ' — pick that board’s card instead');
    }

    report({ stage: 'Connected: ' + chip, busy: true, sub: 'Preparing to write ' + mb(data.length) + ' MB…' });
    const t0 = Date.now();
    await esploader.writeFlash({
      fileArray: [{ data, address }],
      flashSize: 'keep',
      flashMode: 'keep',
      flashFreq: 'keep',
      eraseAll: false,
      compress: true,
      reportProgress: (_i, written, total) => {
        lastPct = total ? (written / total) * 100 : 0;
        const elapsed = Date.now() - t0;
        let sub = mb(written) + ' of ' + mb(total) + ' MB · ' + mmss(elapsed);
        if (written > 0 && elapsed > 2000 && written < total) {
          sub += ' · ~' + mmss((elapsed * (total - written)) / written) + ' left';
        }
        report({ stage: 'Writing firmware', pct: lastPct, sub: sub + ' · don’t unplug' });
      }
    });

    report({ stage: 'Resetting the board', pct: 100, kind: 'ok' });
    try { await esploader.after('hard_reset'); } catch (_) { /* ignore */ }
    report({ stage: 'Done', pct: 100, kind: 'ok', sub: 'The board is running the new firmware. You can unplug it.' });
    return { chip: String(chip) };
  } catch (err) {
    // Re-thrown to the caller, which renders the failure with a hint. Preserve
    // the percentage reached so the bar stays where it stopped.
    err.lastPct = lastPct;
    throw err;
  } finally {
    try { if (transport) await transport.disconnect(); } catch (_) { /* ignore */ }
  }
}
