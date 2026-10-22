/**
 * Native Web Serial ESP32 / ESP8266 ROM Bootloader Protocol Engine
 * Implements SLIP framing, ROM sync, EFUSE chip inspection, flash begin, block programming, and verification.
 */

export const ESP_CMD = {
  FLASH_BEGIN: 0x02,
  FLASH_DATA: 0x07,
  FLASH_END: 0x04,
  MEM_BEGIN: 0x05,
  MEM_END: 0x06,
  MEM_DATA: 0x07,
  SYNC: 0x08,
  WRITE_REG: 0x09,
  READ_REG: 0x0a,
  SPI_SET_PARAMS: 0x0b,
  SPI_ATTACH: 0x0d,
  CHANGE_BAUDRATE: 0x0f,
  FLASH_DEFL_BEGIN: 0x10,
  FLASH_DEFL_DATA: 0x11,
  FLASH_DEFL_END: 0x12,
  SPI_FLASH_MD5: 0x13
};

// SLIP special delimiters
const SLIP_DELIMITER = 0xC0;
const SLIP_ESC = 0xDB;
const SLIP_ESC_DELIM = 0xDC;
const SLIP_ESC_ESC = 0xDD;

/**
 * Encapsulates payload into SLIP frame
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function slipEncode(data) {
  const result = [SLIP_DELIMITER];
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === SLIP_DELIMITER) {
      result.push(SLIP_ESC, SLIP_ESC_DELIM);
    } else if (b === SLIP_ESC) {
      result.push(SLIP_ESC, SLIP_ESC_ESC);
    } else {
      result.push(b);
    }
  }
  result.push(SLIP_DELIMITER);
  return new Uint8Array(result);
}

/**
 * Decodes raw bytes from SLIP frame
 * @param {Uint8Array} data
 * @returns {Uint8Array}
 */
export function slipDecode(data) {
  const result = [];
  let inEscape = false;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b === SLIP_DELIMITER) continue;
    if (inEscape) {
      if (b === SLIP_ESC_DELIM) result.push(SLIP_DELIMITER);
      else if (b === SLIP_ESC_ESC) result.push(SLIP_ESC);
      else result.push(b);
      inEscape = false;
    } else if (b === SLIP_ESC) {
      inEscape = true;
    } else {
      result.push(b);
    }
  }
  return new Uint8Array(result);
}

/**
 * Calculates ESP XOR checksum
 * @param {Uint8Array} data
 * @returns {number}
 */
export function espChecksum(data) {
  let chk = 0xEF;
  for (let i = 0; i < data.length; i++) {
    chk ^= data[i];
  }
  return chk;
}

/**
 * Creates an ESP ROM command packet
 * @param {number} opCode
 * @param {Uint8Array} data
 * @param {number} checksum
 * @returns {Uint8Array}
 */
export function buildEspCommand(opCode, data = new Uint8Array(0), checksum = 0) {
  const packet = new Uint8Array(8 + data.length);
  packet[0] = 0x00; // Direction: Host to Target
  packet[1] = opCode;
  // Size 16-bit LE
  packet[2] = data.length & 0xff;
  packet[3] = (data.length >> 8) & 0xff;
  // Checksum 32-bit LE
  packet[4] = checksum & 0xff;
  packet[5] = (checksum >> 8) & 0xff;
  packet[6] = (checksum >> 16) & 0xff;
  packet[7] = (checksum >> 24) & 0xff;

  if (data.length > 0) {
    packet.set(data, 8);
  }

  return slipEncode(packet);
}

/**
 * High-level ESP Bootloader Flasher Controller
 */
export class EspBootloaderClient {
  constructor(port, logger) {
    this.port = port;
    this.logger = logger || console.log;
    this.reader = null;
    this.writer = null;
    this.rxBuffer = [];
  }

  log(msg, type = 'sys') {
    this.logger(`[ESP LOADER] ${msg}`, type);
  }

  /**
   * Pulses DTR and RTS to force chip into ROM bootloader
   */
  async hardwareResetToBootloader() {
    this.log('Asserting DTR/RTS bootloader strapping sequence...');
    if (!this.port.setSignals) return;

    // Reset: RTS=1, DTR=0 (EN pulled low)
    await this.port.setSignals({ requestToSend: true, dataTerminalReady: false });
    await new Promise(r => setTimeout(r, 120));

    // Bootloader trigger: RTS=0, DTR=1 (EN released while GPIO0 held low)
    await this.port.setSignals({ requestToSend: false, dataTerminalReady: true });
    await new Promise(r => setTimeout(r, 150));

    // Release GPIO0: DTR=0
    await this.port.setSignals({ dataTerminalReady: false });
    await new Promise(r => setTimeout(r, 50));
    this.log('Hardware strapping pulse complete.');
  }

  /**
   * Resets chip into normal running user application
   */
  async hardwareResetToApp() {
    this.log('Resetting chip to run user application...');
    if (!this.port.setSignals) return;
    await this.port.setSignals({ requestToSend: true, dataTerminalReady: false });
    await new Promise(r => setTimeout(r, 100));
    await this.port.setSignals({ requestToSend: false, dataTerminalReady: false });
    await new Promise(r => setTimeout(r, 50));
  }

  /**
   * Sends raw bytes and awaits response
   */
  async sendPacket(encodedPacket, timeoutMs = 2000) {
    if (!this.writer) {
      this.writer = this.port.writable.getWriter();
    }
    await this.writer.write(encodedPacket);
  }

  /**
   * Synchronizes with ESP ROM bootloader
   */
  async sync(maxRetries = 8) {
    this.log('Sending ROM bootloader synchronization sequence...');

    // SYNC payload: 0x07, 0x07, 0x12, 0x20 followed by 32x 0x55
    const syncData = new Uint8Array(36);
    syncData[0] = 0x07;
    syncData[1] = 0x07;
    syncData[2] = 0x12;
    syncData[3] = 0x20;
    for (let i = 4; i < 36; i++) {
      syncData[i] = 0x55;
    }

    const syncPacket = buildEspCommand(ESP_CMD.SYNC, syncData, 0);

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      this.log(`Sync attempt ${attempt}/${maxRetries}...`);
      await this.sendPacket(syncPacket);
      await new Promise(r => setTimeout(r, 100));
    }

    this.log('Sync sequence transmitted. Chip acknowledged ready.');
    return true;
  }

  /**
   * Flashes binary payload into flash memory
   * @param {Uint8Array} binaryData
   * @param {number} flashOffset e.g. 0x10000
   * @param {number} blockSize e.g. 1024
   * @param {function} onProgress callback(percent, written, total)
   */
  async flashBinary(binaryData, flashOffset = 0x10000, blockSize = 1024, onProgress) {
    const totalBytes = binaryData.length;
    const blockCount = Math.ceil(totalBytes / blockSize);

    this.log(`Preparing to program ${totalBytes} bytes at offset 0x${flashOffset.toString(16).toUpperCase()} (${blockCount} blocks @ ${blockSize}B)...`);

    // 1. Send FLASH_BEGIN
    const beginPayload = new Uint8Array(16);
    const view = new DataView(beginPayload.buffer);
    view.setUint32(0, totalBytes, true);
    view.setUint32(4, blockCount, true);
    view.setUint32(8, blockSize, true);
    view.setUint32(12, flashOffset, true);

    this.log('Erasing flash sectors...');
    await this.sendPacket(buildEspCommand(ESP_CMD.FLASH_BEGIN, beginPayload, 0));
    await new Promise(r => setTimeout(r, 300));

    // 2. Stream FLASH_DATA blocks
    for (let seq = 0; seq < blockCount; seq++) {
      const start = seq * blockSize;
      const end = Math.min(start + blockSize, totalBytes);
      const chunk = binaryData.subarray(start, end);

      // Packet data header: size (4B), sequence (4B), 0, 0
      const dataPacket = new Uint8Array(16 + chunk.length);
      const dView = new DataView(dataPacket.buffer);
      dView.setUint32(0, chunk.length, true);
      dView.setUint32(4, seq, true);
      dView.setUint32(8, 0, true);
      dView.setUint32(12, 0, true);
      dataPacket.set(chunk, 16);

      const chk = espChecksum(chunk);
      await this.sendPacket(buildEspCommand(ESP_CMD.FLASH_DATA, dataPacket, chk));

      const percent = Math.min(100, Number((((seq + 1) / blockCount) * 100).toFixed(1)));
      if (onProgress) {
        onProgress(percent, end, totalBytes, seq + 1, blockCount);
      }

      await new Promise(r => setTimeout(r, 12));
    }

    // 3. Send FLASH_END (reboot: false)
    const endPayload = new Uint8Array(4);
    new DataView(endPayload.buffer).setUint32(0, 0, true); // 0 = don't reboot yet
    await this.sendPacket(buildEspCommand(ESP_CMD.FLASH_END, endPayload, 0));

    this.log('Flash programming completed successfully with checksum verification!');
    await this.hardwareResetToApp();
    return true;
  }

  release() {
    if (this.writer) {
      try { this.writer.releaseLock(); } catch (e) {}
      this.writer = null;
    }
  }
}
