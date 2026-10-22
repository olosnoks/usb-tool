/**
 * Firmware Parser Utility
 * Supports Intel HEX (.hex), Microsoft UF2 (.uf2), and Raw Binary (.bin)
 */

/**
 * Parses an Intel HEX formatted text string into raw binary Uint8Array and lowest base address
 * @param {string} hexText
 * @returns {{ data: Uint8Array, startAddress: number, size: number, totalRecords: number }}
 */
export function parseIntelHex(hexText) {
  const lines = hexText.split(/\r?\n/);
  let upperAddress = 0;
  const memoryMap = new Map(); // address -> byte
  let minAddress = Infinity;
  let maxAddress = 0;
  let recordCount = 0;

  for (let line of lines) {
    line = line.trim();
    if (!line.startsWith(':')) continue;
    if (line.length < 11) continue;

    const byteCount = parseInt(line.substr(1, 2), 16);
    const address = parseInt(line.substr(3, 4), 16);
    const recordType = parseInt(line.substr(7, 2), 16);
    const dataStr = line.substr(9, byteCount * 2);
    const checksum = parseInt(line.substr(9 + byteCount * 2, 2), 16);

    // Verify record checksum
    let sum = byteCount + (address >> 8) + (address & 0xff) + recordType;
    for (let i = 0; i < byteCount; i++) {
      sum += parseInt(dataStr.substr(i * 2, 2), 16);
    }
    if (((~sum + 1) & 0xff) !== checksum) {
      console.warn(`Intel HEX Checksum mismatch at line: ${line}`);
    }

    recordCount++;

    if (recordType === 0x00) {
      // Data record
      const fullAddress = upperAddress + address;
      for (let i = 0; i < byteCount; i++) {
        const byte = parseInt(dataStr.substr(i * 2, 2), 16);
        const currentAddr = fullAddress + i;
        memoryMap.set(currentAddr, byte);
        if (currentAddr < minAddress) minAddress = currentAddr;
        if (currentAddr > maxAddress) maxAddress = currentAddr;
      }
    } else if (recordType === 0x01) {
      // End Of File
      break;
    } else if (recordType === 0x02) {
      // Extended Segment Address
      upperAddress = parseInt(dataStr, 16) << 4;
    } else if (recordType === 0x04) {
      // Extended Linear Address
      upperAddress = parseInt(dataStr, 16) << 16;
    }
  }

  if (memoryMap.size === 0) {
    return { data: new Uint8Array(0), startAddress: 0, size: 0, totalRecords: 0 };
  }

  const startAddress = minAddress === Infinity ? 0 : minAddress;
  const totalLength = (maxAddress - startAddress) + 1;
  const data = new Uint8Array(totalLength);
  data.fill(0xff); // Default unprogrammed flash byte is 0xFF

  for (const [addr, byte] of memoryMap.entries()) {
    data[addr - startAddress] = byte;
  }

  return {
    data,
    startAddress,
    size: data.length,
    totalRecords: recordCount
  };
}

/**
 * Parses Microsoft UF2 (USB Flashing Format) binary data
 * 512-byte blocks with magic numbers 0x0A324655 and 0x9E5D5157
 * @param {ArrayBuffer} buffer
 * @returns {{ data: Uint8Array, startAddress: number, size: number, familyId: number }}
 */
export function parseUF2(buffer) {
  const UF2_MAGIC_START0 = 0x0A324655;
  const UF2_MAGIC_START1 = 0x9E5D5157;
  const UF2_MAGIC_END = 0x0AB16F30;

  const uint8 = new Uint8Array(buffer);
  if (uint8.length % 512 !== 0) {
    throw new Error('Invalid UF2 file: length must be a multiple of 512 bytes');
  }

  const view = new DataView(buffer);
  let minAddress = Infinity;
  let maxAddress = 0;
  const chunks = [];
  let familyId = 0;

  for (let offset = 0; offset < buffer.byteLength; offset += 512) {
    const magic0 = view.getUint32(offset, true);
    const magic1 = view.getUint32(offset + 4, true);
    const magicEnd = view.getUint32(offset + 508, true);

    if (magic0 !== UF2_MAGIC_START0 || magic1 !== UF2_MAGIC_START1 || magicEnd !== UF2_MAGIC_END) {
      throw new Error(`UF2 Block magic mismatch at offset 0x${offset.toString(16)}`);
    }

    const flags = view.getUint32(offset + 8, true);
    const targetAddr = view.getUint32(offset + 12, true);
    const payloadSize = view.getUint32(offset + 16, true);
    const blockNo = view.getUint32(offset + 20, true);
    const numBlocks = view.getUint32(offset + 24, true);
    familyId = view.getUint32(offset + 28, true);

    const payload = uint8.subarray(offset + 32, offset + 32 + payloadSize);
    chunks.push({ targetAddr, payload });

    if (targetAddr < minAddress) minAddress = targetAddr;
    if (targetAddr + payloadSize > maxAddress) maxAddress = targetAddr + payloadSize;
  }

  const startAddress = minAddress === Infinity ? 0 : minAddress;
  const totalLength = maxAddress - startAddress;
  const data = new Uint8Array(totalLength);
  data.fill(0xff);

  for (const chunk of chunks) {
    data.set(chunk.payload, chunk.targetAddr - startAddress);
  }

  return {
    data,
    startAddress,
    size: data.length,
    familyId
  };
}

/**
 * Universal file loader: processes file based on name and content
 * @param {File} file
 * @returns {Promise<{ data: Uint8Array, startAddress: number, type: string, size: number }>}
 */
export async function loadFirmwareFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.hex')) {
    const text = await file.text();
    const parsed = parseIntelHex(text);
    return {
      data: parsed.data,
      startAddress: parsed.startAddress,
      type: 'Intel HEX',
      size: parsed.size
    };
  } else if (name.endsWith('.uf2')) {
    const buffer = await file.arrayBuffer();
    const parsed = parseUF2(buffer);
    return {
      data: parsed.data,
      startAddress: parsed.startAddress,
      type: 'Microsoft UF2',
      size: parsed.size
    };
  } else {
    // Default to raw binary (.bin or unknown)
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    return {
      data,
      startAddress: 0,
      type: 'Raw Binary (.bin)',
      size: data.length
    };
  }
}
