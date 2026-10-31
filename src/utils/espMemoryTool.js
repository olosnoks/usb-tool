import { EspBootloaderClient } from './espLoader';

/**
 * ESP32 / ESP8266 Flash Memory Dumper & Silicon Inspector
 */

// Well-known eFuse registers for MAC and Chip Revision
export const EFUSE_REGS = {
  ESP32_MAC_LOW: 0x3FF5A004,
  ESP32_MAC_HIGH: 0x3FF5A008,
  ESP32_SYS_CONF: 0x3FF5A000,
  ESP32S3_MAC_LOW: 0x60007044,
  ESP32S3_MAC_HIGH: 0x60007048,
  ESP32C3_MAC_LOW: 0x60008844,
  ESP32C3_MAC_HIGH: 0x60008848
};

// Flash Manufacturer JEDEC IDs
export const FLASH_MANUFACTURERS = {
  0xEF: 'Winbond',
  0xC8: 'GigaDevice',
  0xC2: 'Macronix (MXIC)',
  0x1C: 'EON',
  0x20: 'Micron / XMC',
  0x9D: 'ISSI',
  0x68: 'BoyaMicro',
  0x85: 'Puya'
};

// Flash Sizes based on JEDEC capacity byte (e.g. 0x14 = 1MB, 0x15 = 2MB, 0x16 = 4MB, 0x17 = 8MB, 0x18 = 16MB)
export function parseFlashCapacity(capacityByte) {
  switch (capacityByte) {
    case 0x13: return '512 KB';
    case 0x14: return '1 MB';
    case 0x15: return '2 MB';
    case 0x16: return '4 MB';
    case 0x17: return '8 MB';
    case 0x18: return '16 MB';
    case 0x19: return '32 MB';
    default: return `${capacityByte} (Unknown)`;
  }
}

// eFuse MAC registers for the families whose addresses are known here.
const MAC_REGS = {
  'ESP32': [EFUSE_REGS.ESP32_MAC_LOW, EFUSE_REGS.ESP32_MAC_HIGH],
  'ESP32-S3': [EFUSE_REGS.ESP32S3_MAC_LOW, EFUSE_REGS.ESP32S3_MAC_HIGH],
  'ESP32-C3': [EFUSE_REGS.ESP32C3_MAC_LOW, EFUSE_REGS.ESP32C3_MAC_HIGH]
};

async function withRomSession(port, onLog, fn) {
  const client = new EspBootloaderClient(port, (m, t) => onLog?.(m, t));
  try {
    await client.connect();
    return await fn(client);
  } finally {
    try { await client.hardwareResetToApp(); } catch (e) { /* ignore */ }
    await client.release();
  }
}

/**
 * Identify the chip through its ROM bootloader and read its MAC from eFuses
 * (ESP32, ESP32-S3, ESP32-C3). Throws if the chip doesn't answer; never
 * returns a placeholder identity.
 */
export async function inspectEspSilicon(port, onLog) {
  onLog?.('[ESP RE] Resetting into the ROM bootloader to identify the chip...', 'sys');
  return withRomSession(port, onLog, async (client) => {
    const result = { chipFamily: client.chip, mac: null };
    const regs = MAC_REGS[client.chip];
    if (regs) {
      const macLow = await client.readReg(regs[0]);
      const macHigh = await client.readReg(regs[1]);
      const bytes = [(macHigh >> 8) & 0xFF, macHigh & 0xFF, (macLow >>> 24) & 0xFF, (macLow >> 16) & 0xFF, (macLow >> 8) & 0xFF, macLow & 0xFF];
      result.mac = bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
      result.rawMacLow = (macLow >>> 0).toString(16);
      result.rawMacHigh = (macHigh >>> 0).toString(16);
      onLog?.(`[ESP RE] ${client.chip} MAC: ${result.mac}`, 'sys');
    } else {
      onLog?.(`[ESP RE] ${client.chip}: MAC eFuse layout not known here, so no MAC is shown.`, 'sys');
    }
    return result;
  });
}

/**
 * Read a flash range through the ROM and download it as a .bin.
 * Supported on the ESP8266 and original ESP32 (ROM READ_FLASH_SLOW); other
 * chips throw a clear error instead of returning invented data.
 */
export async function dumpFlashRange(port, startOffset, lengthBytes, onProgress, onLog) {
  onLog?.(`[DUMP] Reading ${lengthBytes} bytes from 0x${startOffset.toString(16).toUpperCase()} through the ROM bootloader...`, 'sys');
  const data = await withRomSession(port, onLog, (client) =>
    client.readFlashSlow(startOffset, lengthBytes, (percent, bytesRead, total) => onProgress?.(percent, bytesRead, total)));
  onLog?.(`[DUMP] Read ${data.length} bytes from flash.`, 'sys');
  if (typeof document !== 'undefined') {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `esp_flash_dump_0x${startOffset.toString(16).toUpperCase()}_${data.length}B.bin`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return data;
}
