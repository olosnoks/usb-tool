import { describe, it, expect } from 'vitest';
import {
  calculateEntropy,
  calculateRollingEntropy,
  calculateByteFrequencies,
  calculateAnalyticsSummary,
  classifyByte,
  toUint8Array
} from '../../src/utils/cyberchef/analytics.js';
import { Dish, LazyOperation, Operation } from '../../src/utils/cyberchef/core/index.js';

describe('CyberChef Visual Analytics Engine (analytics.js)', () => {
  it('calculateEntropy returns 0 for empty or single-character repetitive inputs', () => {
    expect(calculateEntropy('')).toBe(0);
    expect(calculateEntropy('AAAAAA')).toBe(0);
    expect(calculateEntropy(new Uint8Array([0x55, 0x55, 0x55, 0x55]))).toBe(0);
  });

  it('calculateEntropy returns expected values for text and high-entropy streams', () => {
    const plainText = 'The quick brown fox jumps over the lazy dog';
    const entropy = calculateEntropy(plainText);
    expect(entropy).toBeGreaterThan(3.5);
    expect(entropy).toBeLessThan(5.5);

    // Uniformly distributed 256 distinct bytes should yield theoretical maximum 8.0 bits/byte
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) allBytes[i] = i;
    const maxEntropy = calculateEntropy(allBytes);
    expect(maxEntropy).toBeCloseTo(8.0, 1);
  });

  it('calculateRollingEntropy divides input into blocks and computes block metrics', () => {
    const data = new Uint8Array(1024);
    // First 512 bytes: all zeros (entropy 0)
    data.fill(0, 0, 512);
    // Next 512 bytes: 256 pairs of uniform bytes (entropy 8)
    for (let i = 512; i < 1024; i++) {
      data[i] = (i - 512) % 256;
    }

    const blocks = calculateRollingEntropy(data, 256);
    expect(blocks.length).toBe(4);
    expect(blocks[0].offset).toBe(0);
    expect(blocks[0].length).toBe(256);
    expect(blocks[0].entropy).toBe(0);

    expect(blocks[1].offset).toBe(256);
    expect(blocks[1].entropy).toBe(0);

    expect(blocks[2].offset).toBe(512);
    expect(blocks[2].entropy).toBeCloseTo(8.0, 1);

    expect(blocks[3].offset).toBe(768);
    expect(blocks[3].entropy).toBeCloseTo(8.0, 1);
  });

  it('calculateRollingEntropy handles small payloads gracefully by adapting block size', () => {
    const shortText = 'Small payload';
    const blocks = calculateRollingEntropy(shortText, 256);
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0].offset).toBe(0);
  });

  it('calculateByteFrequencies calculates 256 bins and correct classifications', () => {
    const input = new Uint8Array([0, 10, 65, 66, 65, 200]);
    const freqs = calculateByteFrequencies(input);

    expect(freqs.length).toBe(256);

    // Byte 0x00: Null
    const nullBin = freqs[0];
    expect(nullBin.count).toBe(1);
    expect(nullBin.type).toBe('null');

    // Byte 0x0A (10): Control LF
    const lfBin = freqs[10];
    expect(lfBin.count).toBe(1);
    expect(lfBin.type).toBe('printable'); // tab, lf, cr considered printable formatting

    // Byte 65 ('A'): Count 2
    const aBin = freqs[65];
    expect(aBin.count).toBe(2);
    expect(aBin.char).toBe('A');
    expect(aBin.type).toBe('printable');

    // Byte 200: High byte
    const highBin = freqs[200];
    expect(highBin.count).toBe(1);
    expect(highBin.type).toBe('high');
  });

  it('calculateAnalyticsSummary computes complete telemetry metrics', () => {
    const sample = 'Hello World! 12345';
    const summary = calculateAnalyticsSummary(sample);

    expect(summary.totalBytes).toBe(sample.length);
    expect(summary.meanEntropy).toBeGreaterThan(2.5);
    expect(summary.printableRatio).toBe(1.0); // 100% printable
    expect(summary.nullRatio).toBe(0.0);
    expect(summary.topBytes.length).toBeGreaterThan(0);
  });

  it('classifyByte classifies boundaries properly', () => {
    expect(classifyByte(0)).toBe('null');
    expect(classifyByte(1)).toBe('control');
    expect(classifyByte(31)).toBe('control');
    expect(classifyByte(32)).toBe('printable');
    expect(classifyByte(126)).toBe('printable');
    expect(classifyByte(127)).toBe('control');
    expect(classifyByte(128)).toBe('high');
    expect(classifyByte(255)).toBe('high');
  });
});

describe('Hardware Piping Rolling Buffer Mechanics', () => {
  it('correctly appends and trims streaming data within a rolling buffer window', () => {
    const limit = 20; // 20 bytes limit
    let current = new Uint8Array(0);

    function append(newBytes) {
      const combined = new Uint8Array(current.length + newBytes.length);
      combined.set(current, 0);
      combined.set(newBytes, current.length);
      if (limit > 0 && combined.length > limit) {
        current = combined.slice(combined.length - limit);
      } else {
        current = combined;
      }
      return current;
    }

    // Packet 1: 10 bytes
    const p1 = new TextEncoder().encode('0123456789');
    append(p1);
    expect(current.length).toBe(10);
    expect(new TextDecoder().decode(current)).toBe('0123456789');

    // Packet 2: 8 bytes (total 18 < 20)
    const p2 = new TextEncoder().encode('ABCDEFGH');
    append(p2);
    expect(current.length).toBe(18);
    expect(new TextDecoder().decode(current)).toBe('0123456789ABCDEFGH');

    // Packet 3: 10 bytes (total 28 > 20, should keep only last 20 bytes)
    const p3 = new TextEncoder().encode('!@#$%^&*()');
    append(p3);
    expect(current.length).toBe(20);
    // Last 20 bytes: 2 bytes from p1 ('89') + 8 bytes from p2 ('ABCDEFGH') + 10 bytes from p3 ('!@#$%^&*()')
    expect(new TextDecoder().decode(current)).toBe('89ABCDEFGH!@#$%^&*()');
  });
});


describe('LazyOperation Dynamic Code Splitting Support', () => {
  it('defers loading until execute() is called and processes dish data', async () => {
    let loadCalled = false;

    class MockHeavyImplementation extends Operation {
      constructor() {
        super({ name: 'Heavy Mock' });
      }
      run(input) {
        return `HEAVY_PROCESSED: ${input}`;
      }
    }

    const lazyOp = new LazyOperation(
      {
        name: 'Lazy Heavy Op',
        description: 'Simulates lazy loaded cryptographic module'
      },
      async () => {
        loadCalled = true;
        return { default: MockHeavyImplementation };
      }
    );

    expect(lazyOp.loaded).toBe(false);
    expect(loadCalled).toBe(false);

    const dish = new Dish('secret_payload', 'string');
    const result = await lazyOp.execute(dish);

    expect(lazyOp.loaded).toBe(true);
    expect(loadCalled).toBe(true);
    expect(result.toString()).toBe('HEAVY_PROCESSED: secret_payload');
  });
});
