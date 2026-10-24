/**
 * Real-Time Live PCAP Streaming Engine
 * Leverages the browser File System Access API (showSaveFilePicker + createWritable)
 * to stream captured 802.11 Radiotap frames directly to the user's local disk.
 * Bypasses in-memory buffers to enable indefinite capture sessions without memory exhaustion.
 */

export const PCAP_MAGIC = 0xa1b2c3d4;
export const PCAP_VERSION_MAJOR = 2;
export const PCAP_VERSION_MINOR = 4;
export const PCAP_LINKTYPE_RADIOTAP = 127; // IEEE 802.11 plus radiotap header
export const PCAP_SNAPLEN = 65535;

/**
 * Creates the standard 24-byte libpcap global file header.
 * @returns {Uint8Array}
 */
export function createPcapGlobalHeader() {
  const header = new Uint8Array(24);
  const view = new DataView(header.buffer);
  view.setUint32(0, PCAP_MAGIC, true); // Magic Number (Little-Endian)
  view.setUint16(4, PCAP_VERSION_MAJOR, true); // Major Version (2)
  view.setUint16(6, PCAP_VERSION_MINOR, true); // Minor Version (4)
  view.setInt32(8, 0, true); // Timezone GMT offset (0)
  view.setUint32(12, 0, true); // Timestamp accuracy (0)
  view.setUint32(16, PCAP_SNAPLEN, true); // Snaplen (65535)
  view.setUint32(20, PCAP_LINKTYPE_RADIOTAP, true); // LinkType (127 = Radiotap)
  return header;
}

/**
 * Creates a 16-byte PCAP packet record header.
 * @param {number} len - Captured packet length in bytes
 * @param {number} [origLen=len] - Original un-truncated packet length
 * @param {number} [timestampMs=Date.now()] - Timestamp in milliseconds
 * @returns {Uint8Array}
 */
export function createPcapPacketHeader(len, origLen = len, timestampMs = Date.now()) {
  const header = new Uint8Array(16);
  const view = new DataView(header.buffer);
  const sec = Math.floor(timestampMs / 1000);
  const usec = Math.floor((timestampMs % 1000) * 1000);

  view.setUint32(0, sec, true);
  view.setUint32(4, usec, true);
  view.setUint32(8, len, true);
  view.setUint32(12, origLen, true);
  return header;
}

/**
 * Live PCAP Streaming Controller using File System Access API.
 */
export class LivePcapWriter {
  constructor(fileHandle = null, writableStream = null) {
    this.fileHandle = fileHandle;
    this.writable = writableStream;
    this.isOpen = false;
    this.packetCount = 0;
    this.bytesWritten = 0;
    this.fileName = fileHandle?.name || 'wifi_capture.pcap';
    this.flushInterval = null;
    this.writeQueue = Promise.resolve();
  }

  /**
   * Check if the current browser environment supports the File System Access API.
   * @returns {boolean}
   */
  static isSupported() {
    return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
  }

  /**
   * Prompts the user to pick a destination file on their local disk and initializes the stream.
   * @param {string} [suggestedName]
   * @returns {Promise<LivePcapWriter>}
   */
  static async requestFileAndOpen(suggestedName) {
    if (!LivePcapWriter.isSupported()) {
      throw new Error('File System Access API (showSaveFilePicker) is not supported in this browser. Please use Chrome or Edge.');
    }

    const defaultName = suggestedName || `wifi_capture_${new Date().toISOString().replace(/[:.]/g, '-')}.pcap`;

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: defaultName,
      types: [
        {
          description: 'Wireshark PCAP Capture (*.pcap)',
          accept: {
            'application/vnd.tcpdump.pcap': ['.pcap']
          }
        }
      ]
    });

    const writer = new LivePcapWriter(fileHandle);
    await writer.open();
    return writer;
  }

  /**
   * Initialize writable stream and write the standard 24-byte PCAP global header.
   */
  async open() {
    if (!this.fileHandle) {
      throw new Error('No file handle provided to LivePcapWriter.');
    }

    this.writable = await this.fileHandle.createWritable();
    const globalHeader = createPcapGlobalHeader();
    await this.writable.write(globalHeader);
    this.bytesWritten += globalHeader.length;
    this.isOpen = true;

    // Periodic flush timer (every 5 seconds) to trigger sync
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 5000);
  }

  /**
   * Writes a raw 802.11 frame buffer and its 16-byte record header directly to disk.
   * Serializes writes to guarantee chronological frame integrity.
   * 
   * @param {Uint8Array} rawBytes - Raw frame buffer including Radiotap header
   * @param {number} [timestampMs=Date.now()] - Frame timestamp in milliseconds
   * @returns {Promise<void>}
   */
  writePacket(rawBytes, timestampMs = Date.now()) {
    if (!this.isOpen || !this.writable) {
      return Promise.resolve();
    }
    if (!rawBytes || rawBytes.length === 0) {
      return Promise.resolve();
    }

    const capLen = Math.min(rawBytes.length, PCAP_SNAPLEN);
    const slice = capLen === rawBytes.length ? rawBytes : rawBytes.slice(0, capLen);
    const pktHeader = createPcapPacketHeader(capLen, rawBytes.length, timestampMs);

    // Merge record header and packet buffer into a single Uint8Array chunk
    const chunk = new Uint8Array(16 + capLen);
    chunk.set(pktHeader, 0);
    chunk.set(slice, 16);

    // Queue write operation sequentially
    this.writeQueue = this.writeQueue.then(async () => {
      if (!this.isOpen || !this.writable) return;
      try {
        await this.writable.write(chunk);
        this.bytesWritten += chunk.length;
        this.packetCount++;
      } catch (err) {
        console.warn('LivePcapWriter stream write error:', err);
      }
    });

    return this.writeQueue;
  }

  /**
   * Periodic sync flush
   */
  async flush() {
    // Awaiting the current write queue ensures all pending packets have cleared
    await this.writeQueue;
  }

  /**
   * Closes the writable stream cleanly, flushes remaining frames, and finalizes the PCAP file.
   * @returns {Promise<{ packetCount: number, bytesWritten: number }>}
   */
  async close() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }

    await this.writeQueue;

    if (this.writable && this.isOpen) {
      this.isOpen = false;
      try {
        await this.writable.close();
      } catch (err) {
        console.warn('LivePcapWriter close error:', err);
      }
      this.writable = null;
    }

    return {
      packetCount: this.packetCount,
      bytesWritten: this.bytesWritten
    };
  }
}
