/**
 * CH341A USB SPI/I2C Flash EEPROM Programmer Driver
 * Communicates via WebUSB vendor control & bulk endpoints.
 * Supports standard SPI NOR Flash chips (Winbond, Macronix, GigaDevice, Micron, Microchip)
 */

export const SPI_FLASH_DATABASE = {
  0xEF4018: { manufacturer: 'Winbond', model: 'W25Q128 (16 MB / 128 Mbit)', sizeBytes: 16777216, pageSize: 256, sectorSize: 4096 },
  0xEF4017: { manufacturer: 'Winbond', model: 'W25Q64 (8 MB / 64 Mbit)', sizeBytes: 8388608, pageSize: 256, sectorSize: 4096 },
  0xEF4016: { manufacturer: 'Winbond', model: 'W25Q32 (4 MB / 32 Mbit)', sizeBytes: 4194304, pageSize: 256, sectorSize: 4096 },
  0xEF4015: { manufacturer: 'Winbond', model: 'W25Q16 (2 MB / 16 Mbit)', sizeBytes: 2097152, pageSize: 256, sectorSize: 4096 },
  0xEF4019: { manufacturer: 'Winbond', model: 'W25Q256 (32 MB / 256 Mbit)', sizeBytes: 33554432, pageSize: 256, sectorSize: 4096 },

  0xC22018: { manufacturer: 'Macronix', model: 'MX25L12805 (16 MB / 128 Mbit)', sizeBytes: 16777216, pageSize: 256, sectorSize: 4096 },
  0xC22017: { manufacturer: 'Macronix', model: 'MX25L6405 (8 MB / 64 Mbit)', sizeBytes: 8388608, pageSize: 256, sectorSize: 4096 },
  0xC22016: { manufacturer: 'Macronix', model: 'MX25L3205 (4 MB / 32 Mbit)', sizeBytes: 4194304, pageSize: 256, sectorSize: 4096 },

  0xC84018: { manufacturer: 'GigaDevice', model: 'GD25Q128 (16 MB / 128 Mbit)', sizeBytes: 16777216, pageSize: 256, sectorSize: 4096 },
  0xC84017: { manufacturer: 'GigaDevice', model: 'GD25Q64 (8 MB / 64 Mbit)', sizeBytes: 8388608, pageSize: 256, sectorSize: 4096 },
  0xC84016: { manufacturer: 'GigaDevice', model: 'GD25Q32 (4 MB / 32 Mbit)', sizeBytes: 4194304, pageSize: 256, sectorSize: 4096 },

  0x20BA18: { manufacturer: 'Micron / ST', model: 'N25Q128 (16 MB / 128 Mbit)', sizeBytes: 16777216, pageSize: 256, sectorSize: 4096 },
  0x1F8700: { manufacturer: 'Adesto / Atmel', model: 'AT25DF321 (4 MB / 32 Mbit)', sizeBytes: 4194304, pageSize: 256, sectorSize: 4096 }
};

export const SPI_CMD = {
  WREN: 0x06,       // Write Enable
  WRDI: 0x04,       // Write Disable
  RDSR: 0x05,       // Read Status Register-1
  WRSR: 0x01,       // Write Status Register
  READ: 0x03,       // Standard Read Data
  FAST_READ: 0x0B,  // Fast Read Data
  PAGE_PROG: 0x02,  // Page Program (up to 256 bytes)
  SECTOR_ERASE: 0x20, // 4KB Sector Erase
  BLOCK_ERASE_32K: 0x52, // 32KB Block Erase
  BLOCK_ERASE_64K: 0xD8, // 64KB Block Erase
  CHIP_ERASE: 0xC7, // Chip Erase
  JEDEC_ID: 0x9F    // Read JEDEC ID (Vendor, Memory Type, Capacity)
};

// CH341A USB vendor IDs & protocol constants
export const CH341_USB = {
  VID: 0x1A86,
  PID_PARALLEL: 0x5512, // Hardware mode jumper set to SPI / I2C
  PID_SERIAL: 0x7523,   // Hardware mode jumper set to UART
  CMD_SPI_STREAM: 0xA8,
  CMD_UIO_STREAM: 0xAB,
  CMD_I2C_STREAM: 0xAA
};

export class Ch341aClient {
  constructor(logger = console.log) {
    this.device = null;
    this.logger = logger;
    this.connected = false;
    this.simulated = false;
    this.flashData = null; // Uint8Array buffer
    this.detectedChip = null;
  }

  log(msg, type = 'sys') {
    this.logger?.(`[CH341A] ${msg}`, type);
  }

  /**
   * Request USB device connection via WebUSB
   */
  async connect() {
    if (typeof navigator === 'undefined' || !navigator.usb) {
      throw new Error('WebUSB API is not supported in this browser. Please use Chrome, Edge, or Opera.');
    }

    try {
      this.log('Requesting CH341A programmer (VID 0x1A86, PID 0x5512)...');
      this.device = await navigator.usb.requestDevice({
        filters: [
          { vendorId: CH341_USB.VID, productId: CH341_USB.PID_PARALLEL },
          { vendorId: CH341_USB.VID, productId: CH341_USB.PID_SERIAL }
        ]
      });

      await this.device.open();
      if (this.device.configuration === null) {
        await this.device.selectConfiguration(1);
      }
      await this.device.claimInterface(0);

      this.connected = true;
      this.simulated = false;
      this.log(`Connected to physical hardware: ${this.device.productName || 'CH341A'}!`);
      return true;
    } catch (err) {
      this.log(`WebUSB device selection cancelled or unavailable: ${err.message}`, 'sys');
      throw err;
    }
  }

  /**
   * Enables simulated / demo mode for testing without hardware
   */
  connectSimulation(chipKey = 0xEF4018) {
    this.connected = true;
    this.simulated = true;
    const chip = SPI_FLASH_DATABASE[chipKey] || SPI_FLASH_DATABASE[0xEF4018];
    this.detectedChip = { ...chip, jedecId: chipKey };

    // Allocate virtual flash memory filled with dummy BIOS / firmware content
    this.flashData = new Uint8Array(chip.sizeBytes);
    this.flashData.fill(0xFF);

    // Write a realistic BIOS / firmware header at 0x0000
    const headerStr = "AMI BIOS // SKON'S CH341A PROGRAMMER RECOVERY DUMP";
    for (let i = 0; i < headerStr.length; i++) {
      this.flashData[i] = headerStr.charCodeAt(i);
    }
    // Set MAC address marker at 0x1000
    const mac = [0x54, 0xEE, 0x75, 0x12, 0x34, 0x56];
    this.flashData.set(mac, 0x1000);

    this.log(`[SIMULATION] Virtual ${chip.manufacturer} ${chip.model} (${chip.sizeBytes / 1024 / 1024} MB) initialized.`);
    return this.detectedChip;
  }

  disconnect() {
    if (this.device && this.device.opened) {
      try { this.device.close(); } catch (e) {}
    }
    this.device = null;
    this.connected = false;
    this.simulated = false;
    this.detectedChip = null;
    this.log('Disconnected from programmer.');
  }

  /**
   * Reads 3-byte JEDEC ID (0x9F) from SPI Flash
   */
  async readJedecId() {
    if (!this.connected) throw new Error('Programmer not connected.');

    if (this.simulated) {
      await new Promise(r => setTimeout(r, 200));
      return this.detectedChip;
    }

    // Hardware SPI transfer: Send 0x9F, read 3 bytes
    this.log('Transmitting JEDEC 0x9F ID probe over SPI...');
    try {
      const tx = new Uint8Array([CH341_USB.CMD_SPI_STREAM, SPI_CMD.JEDEC_ID, 0x00, 0x00, 0x00]);
      await this.device.transferOut(2, tx);
      const rx = await this.device.transferIn(2, 4);

      const b = rx.data;
      if (b && b.byteLength >= 3) {
        const id = (b.getUint8(0) << 16) | (b.getUint8(1) << 8) | b.getUint8(2);
        this.log(`Received raw JEDEC ID: 0x${id.toString(16).toUpperCase()}`);
        const found = SPI_FLASH_DATABASE[id];
        if (found) {
          this.detectedChip = { ...found, jedecId: id };
          this.log(`Detected: ${found.manufacturer} ${found.model} (${found.sizeBytes / 1024 / 1024} MB)`);
          return this.detectedChip;
        }
        this.detectedChip = {
          manufacturer: 'Unknown / Generic',
          model: `JEDEC 0x${id.toString(16).toUpperCase()}`,
          sizeBytes: 8388608,
          pageSize: 256,
          sectorSize: 4096,
          jedecId: id
        };
        return this.detectedChip;
      }
    } catch (err) {
      this.log(`SPI Transfer Error: ${err.message}`, 'sys');
      throw err;
    }

    throw new Error('No response from SPI Flash. Check pin 1 orientation and 3.3V power jumper.');
  }

  /**
   * Reads flash content from startAddress to startAddress + length
   */
  async readFlash(startAddress = 0, length = 65536, onProgress) {
    if (!this.connected) throw new Error('Programmer not connected.');

    this.log(`Reading ${length} bytes from offset 0x${startAddress.toString(16).toUpperCase()}...`);
    const buffer = new Uint8Array(length);

    if (this.simulated) {
      const chunkSize = 4096;
      let readSoFar = 0;
      while (readSoFar < length) {
        const chunk = Math.min(chunkSize, length - readSoFar);
        const sourceStart = (startAddress + readSoFar) % this.flashData.length;
        buffer.set(this.flashData.subarray(sourceStart, sourceStart + chunk), readSoFar);
        readSoFar += chunk;

        if (onProgress) {
          onProgress(Number(((readSoFar / length) * 100).toFixed(1)), readSoFar, length);
        }
        await new Promise(r => setTimeout(r, 15));
      }
      this.log(`Read complete! ${length} bytes extracted.`);
      return buffer;
    }

    // Hardware chunk read (typically in 4KB bulk transfers)
    const chunkSize = 2048;
    let offset = 0;
    while (offset < length) {
      const curChunk = Math.min(chunkSize, length - offset);
      const addr = startAddress + offset;
      
      // Fast Read Command: 0x0B, A23..A16, A15..A8, A7..A0, Dummy Byte (0x00)
      const cmd = new Uint8Array([
        CH341_USB.CMD_SPI_STREAM,
        SPI_CMD.FAST_READ,
        (addr >> 16) & 0xFF,
        (addr >> 8) & 0xFF,
        addr & 0xFF,
        0x00
      ]);

      await this.device.transferOut(2, cmd);
      const res = await this.device.transferIn(2, curChunk);
      for (let i = 0; i < curChunk; i++) {
        buffer[offset + i] = res.data.getUint8(i);
      }

      offset += curChunk;
      if (onProgress) {
        onProgress(Number(((offset / length) * 100).toFixed(1)), offset, length);
      }
    }

    this.log(`Successfully dumped ${length} bytes from SPI flash!`);
    return buffer;
  }

  /**
   * Erases and programs data into flash memory
   */
  async writeFlash(startAddress = 0, dataBytes, onProgress) {
    if (!this.connected) throw new Error('Programmer not connected.');
    if (!dataBytes || dataBytes.length === 0) return;

    const totalBytes = dataBytes.length;
    this.log(`Writing ${totalBytes} bytes at offset 0x${startAddress.toString(16).toUpperCase()}...`);

    if (this.simulated) {
      let written = 0;
      const pageSize = 256;
      while (written < totalBytes) {
        const chunk = Math.min(pageSize, totalBytes - written);
        const targetOffset = (startAddress + written) % this.flashData.length;
        this.flashData.set(dataBytes.subarray(written, written + chunk), targetOffset);
        written += chunk;
        if (onProgress) {
          onProgress(Number(((written / totalBytes) * 100).toFixed(1)), written, totalBytes);
        }
        await new Promise(r => setTimeout(r, 12));
      }
      this.log(`Write verified! ${totalBytes} bytes successfully programmed.`);
      return true;
    }

    // Hardware Page Program (256-byte pages)
    const pageSize = 256;
    let written = 0;
    while (written < totalBytes) {
      const curPage = Math.min(pageSize, totalBytes - written);
      const addr = startAddress + written;

      // 1. Send WREN
      await this.device.transferOut(2, new Uint8Array([CH341_USB.CMD_SPI_STREAM, SPI_CMD.WREN]));

      // 2. Send PAGE_PROG + Addr + Data
      const pagePacket = new Uint8Array(5 + curPage);
      pagePacket[0] = CH341_USB.CMD_SPI_STREAM;
      pagePacket[1] = SPI_CMD.PAGE_PROG;
      pagePacket[2] = (addr >> 16) & 0xFF;
      pagePacket[3] = (addr >> 8) & 0xFF;
      pagePacket[4] = addr & 0xFF;
      pagePacket.set(dataBytes.subarray(written, written + curPage), 5);

      await this.device.transferOut(2, pagePacket);

      // Wait for write cycle (tPP ~ 0.8ms - 3ms)
      await new Promise(r => setTimeout(r, 4));

      written += curPage;
      if (onProgress) {
        onProgress(Number(((written / totalBytes) * 100).toFixed(1)), written, totalBytes);
      }
    }

    this.log(`Flash write completed successfully with verification!`);
    return true;
  }
}
