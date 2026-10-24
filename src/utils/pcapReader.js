/**
 * 802.11 PCAP Forensic Reader & Live Replay Engine
 * 
 * Supports:
 * - Parsing standard 24-byte PCAP global headers (Microsecond & Nanosecond, LE & BE)
 * - Validating LINKTYPE_IEEE802_11_RADIOTAP (LinkType 127)
 * - Iterating 16-byte packet records with timestamp metadata and raw payload extraction
 * - Throttled streaming replay to feed Web Workers for real-time offline simulation
 */

export const PCAP_MAGIC_LE = 0xa1b2c3d4;
export const PCAP_MAGIC_BE = 0xd4c3b2a1;
export const PCAP_MAGIC_NANO_LE = 0xa1b23c4d;
export const PCAP_MAGIC_NANO_BE = 0x4d3cb2a1;
export const PCAP_LINKTYPE_RADIOTAP = 127;

/**
 * Parses binary PCAP data from an ArrayBuffer or Uint8Array.
 * 
 * @param {ArrayBuffer|Uint8Array} input 
 * @returns {{
 *   header: {
 *     magic: number,
 *     versionMajor: number,
 *     versionMinor: number,
 *     thiszone: number,
 *     sigfigs: number,
 *     snaplen: number,
 *     linkType: number,
 *     isLittleEndian: boolean,
 *     isNanosecond: boolean
 *   },
 *   packets: Uint8Array[],
 *   packetRecords: Array<{
 *     timestamp: { sec: number, usec: number, timeMs: number },
 *     inclLen: number,
 *     origLen: number,
 *     data: Uint8Array
 *   }>
 * }}
 */
export function parsePcap(input) {
  if (!input) {
    throw new Error('No input data provided to PCAP reader');
  }

  let uint8;
  if (input instanceof Uint8Array) {
    uint8 = input;
  } else if (input instanceof ArrayBuffer) {
    uint8 = new Uint8Array(input);
  } else if (ArrayBuffer.isView(input)) {
    uint8 = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  } else {
    throw new Error('Invalid input format: Expected ArrayBuffer or Uint8Array');
  }

  if (uint8.length < 24) {
    throw new Error(`File truncated: size ${uint8.length} bytes is less than the 24-byte PCAP header`);
  }

  const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

  // 1. Determine Endianness & Timestamp Resolution via Magic Number
  const rawMagic = view.getUint32(0, true);
  let isLittleEndian = true;
  let isNanosecond = false;

  if (rawMagic === PCAP_MAGIC_LE) {
    isLittleEndian = true;
    isNanosecond = false;
  } else if (rawMagic === PCAP_MAGIC_BE) {
    isLittleEndian = false;
    isNanosecond = false;
  } else if (rawMagic === PCAP_MAGIC_NANO_LE) {
    isLittleEndian = true;
    isNanosecond = true;
  } else if (rawMagic === PCAP_MAGIC_NANO_BE) {
    isLittleEndian = false;
    isNanosecond = true;
  } else {
    throw new Error(`Invalid PCAP magic number: 0x${rawMagic.toString(16).padStart(8, '0')}. File is not a valid PCAP.`);
  }

  // 2. Parse Global Header Fields
  const versionMajor = view.getUint16(4, isLittleEndian);
  const versionMinor = view.getUint16(6, isLittleEndian);
  const thiszone = view.getInt32(8, isLittleEndian);
  const sigfigs = view.getUint32(12, isLittleEndian);
  const snaplen = view.getUint32(16, isLittleEndian);
  const linkType = view.getUint32(20, isLittleEndian);

  // 3. Verify LinkType (Must be Radiotap 127)
  if (linkType !== PCAP_LINKTYPE_RADIOTAP) {
    throw new Error(`Unsupported link type: ${linkType}. Expected 127 (LINKTYPE_IEEE802_11_RADIOTAP).`);
  }

  const header = {
    magic: rawMagic,
    versionMajor,
    versionMinor,
    thiszone,
    sigfigs,
    snaplen,
    linkType,
    isLittleEndian,
    isNanosecond
  };

  const packets = [];
  const packetRecords = [];
  let offset = 24;

  // 4. Iterate Packet Records (16-byte header + inclLen payload)
  while (offset + 16 <= uint8.length) {
    const tsSec = view.getUint32(offset, isLittleEndian);
    const tsUsec = view.getUint32(offset + 4, isLittleEndian);
    const inclLen = view.getUint32(offset + 8, isLittleEndian);
    const origLen = view.getUint32(offset + 12, isLittleEndian);

    if (offset + 16 + inclLen > uint8.length) {
      console.warn(`Truncated packet record at offset ${offset}: expected ${inclLen} bytes, available ${uint8.length - offset - 16}`);
      break;
    }

    const payload = uint8.slice(offset + 16, offset + 16 + inclLen);
    packets.push(payload);

    const timeMs = (tsSec * 1000) + Math.floor(isNanosecond ? tsUsec / 1000000 : tsUsec / 1000);
    packetRecords.push({
      timestamp: {
        sec: tsSec,
        usec: tsUsec,
        timeMs
      },
      inclLen,
      origLen,
      data: payload
    });

    offset += 16 + inclLen;
  }

  return {
    header,
    packets,
    packetRecords
  };
}

/**
 * Asynchronously reads a File or Blob object into parsed PCAP structures.
 * 
 * @param {Blob|File} file 
 * @returns {Promise<ReturnType<typeof parsePcap>>}
 */
export async function readPcapFile(file) {
  if (!file) {
    throw new Error('No file provided to readPcapFile');
  }

  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return parsePcap(buffer);
  }

  // Fallback for environments where arrayBuffer() is unavailable
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parsePcap(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read PCAP file'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Controlled PCAP Packet Replayer
 * Feeds parsed packets into a callback or Web Worker at a regulated rate (PPS).
 */
export class PcapReplayer {
  /**
   * @param {Uint8Array[]} packets 
   * @param {Object} [options]
   * @param {number} [options.rate=500] Packets per second
   * @param {number} [options.batchSize] Packets per tick (defaults to rate / 10 or minimum 10)
   * @param {function(Uint8Array[], number, number): void} [options.onBatch]
   * @param {function(Uint8Array, number, number): void} [options.onPacket]
   * @param {function({ current: number, total: number, percent: number }): void} [options.onProgress]
   * @param {function({ total: number }): void} [options.onComplete]
   * @param {function(Error): void} [options.onError]
   */
  constructor(packets, options = {}) {
    this.packets = Array.isArray(packets) ? packets : [];
    this.rate = options.rate && options.rate > 0 ? options.rate : 500;
    this.batchSize = options.batchSize && options.batchSize > 0 
      ? options.batchSize 
      : Math.max(10, Math.floor(this.rate / 10)); // e.g. 50 packets every 100ms
    
    this.onBatch = options.onBatch || null;
    this.onPacket = options.onPacket || null;
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;

    this.currentIndex = 0;
    this.timerId = null;
    this.isPlaying = false;
    this.isPaused = false;
    this.isFinished = false;
  }

  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPaused = false;
    this.isFinished = false;
    this.currentIndex = 0;
    this._scheduleNext();
  }

  pause() {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  resume() {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    this._scheduleNext();
  }

  stop() {
    this.isPlaying = false;
    this.isPaused = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }

  _scheduleNext() {
    if (!this.isPlaying || this.isPaused) return;

    if (this.currentIndex >= this.packets.length) {
      this.isPlaying = false;
      this.isFinished = true;
      if (this.onComplete) {
        this.onComplete({ total: this.packets.length });
      }
      return;
    }

    const intervalMs = Math.max(10, Math.round((this.batchSize / this.rate) * 1000));
    this.timerId = setTimeout(() => {
      try {
        const nextIndex = Math.min(this.currentIndex + this.batchSize, this.packets.length);
        const batch = this.packets.slice(this.currentIndex, nextIndex);

        if (this.onBatch) {
          this.onBatch(batch, this.currentIndex, this.packets.length);
        } else if (this.onPacket) {
          for (let i = 0; i < batch.length; i++) {
            this.onPacket(batch[i], this.currentIndex + i, this.packets.length);
          }
        }

        this.currentIndex = nextIndex;

        if (this.onProgress) {
          const total = this.packets.length;
          const percent = total > 0 ? Math.round((this.currentIndex / total) * 100) : 100;
          this.onProgress({
            current: this.currentIndex,
            total,
            percent
          });
        }

        this._scheduleNext();
      } catch (err) {
        this.isPlaying = false;
        if (this.onError) {
          this.onError(err);
        }
      }
    }, intervalMs);
  }
}
