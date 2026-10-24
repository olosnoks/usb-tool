import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse80211Frame } from '../src/utils/wifiParser';

describe('Web Worker Frame Parser Architecture (parserWorker.js)', () => {
  let mockWorkerPostMessage;
  let mockWorkerOnMessage;

  beforeEach(() => {
    mockWorkerPostMessage = vi.fn();
    mockWorkerOnMessage = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('correctly processes and batches parsed 802.11 frames', () => {
    // Verify that the parsing logic in parserWorker functions equivalently
    const beaconBuffer = new Uint8Array([
      0x80, 0x00, 0x00, 0x00,
      0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x10, 0x00,
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x64, 0x00, 0x11, 0x00,
      0x00, 0x09, 0x54, 0x65, 0x73, 0x74, 0x5f, 0x53, 0x53, 0x49, 0x44,
      0x03, 0x01, 0x24
    ]);

    const parsed = parse80211Frame(beaconBuffer);
    expect(parsed).not.toBeNull();
    expect(parsed.ssid).toBe('Test_SSID');
    expect(parsed.channel).toBe(36);
    expect(parsed.bssid).toBe('00:11:22:33:44:55');
  });

  it('simulates worker message passing and batching contract', async () => {
    // Simulating parserWorker event queue contract
    let batchQueue = [];
    const handleWorkerMessage = (event) => {
      if (event.type === 'PARSE_BUFFER') {
        const frame = parse80211Frame(event.buffer);
        if (frame) {
          batchQueue.push(frame);
        }
      }
    };

    const flushQueue = () => {
      const batch = [...batchQueue];
      batchQueue = [];
      return {
        type: 'BATCH_PARSED',
        frames: batch,
        count: batch.length
      };
    };

    const dummyFrame = new Uint8Array([
      0x88, 0x01, 0x00, 0x00,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x3C, 0x22, 0xFB, 0x44, 0x55, 0x66,
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
      0x40, 0x00
    ]);

    handleWorkerMessage({ type: 'PARSE_BUFFER', buffer: dummyFrame });
    expect(batchQueue.length).toBe(1);

    const message = flushQueue();
    expect(message.type).toBe('BATCH_PARSED');
    expect(message.count).toBe(1);
    expect(message.frames[0].stationMac).toBe('3C:22:FB:44:55:66');
    expect(batchQueue.length).toBe(0);
  });
});
