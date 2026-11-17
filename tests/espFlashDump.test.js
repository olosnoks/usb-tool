import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPartitionTable } from '../src/utils/espPartitions';

// Fake esptool-js: ESPLoader.main() fails at any baud above 115200 when failFast is set.
const state = { failFast: false, constructed: [], disconnects: 0, readFlashCalls: [], jedec: 0x1640ef };
vi.mock('esptool-js', () => {
  class Transport {
    constructor(port) { this.port = port; }
    async disconnect() { state.disconnects++; }
  }
  class ESPLoader {
    constructor(opts) {
      this.opts = opts;
      state.constructed.push(opts.baudrate);
      this.IS_STUB = true;
      this.chip = {
        getChipFeatures: async () => ['WiFi', 'BLE'],
        getCrystalFreq: async () => 40,
        readMac: async () => '24:6f:28:aa:bb:cc'
      };
    }
    async main() {
      if (state.failFast && this.opts.baudrate > 115200) throw new Error('lost sync at high baud');
      return 'ESP32-S3 (revision v0.1)';
    }
    async readFlashId() { return state.jedec; }
    async readFlash(addr, len) {
      state.readFlashCalls.push([addr, len]);
      if (addr === 0x8000) return buildPartitionTable([{ name: 'nvs', type: 1, subtype: 2, offset: 0x9000, size: 0x6000 }]);
      return new Uint8Array(len).fill(0xab);
    }
    async after() {}
  }
  return { ESPLoader, Transport };
});

import { identifyEsp, dumpFlashViaStub, readPartitionTable, parseFlashId, fullFlashLength } from '../src/utils/espFlashDump';

const port = {};
beforeEach(() => {
  state.failFast = false;
  state.constructed = [];
  state.disconnects = 0;
  state.readFlashCalls = [];
  state.jedec = 0x1640ef;
});

describe('esptool-js identify / dump flow (mocked)', () => {
  it('parses the JEDEC id into manufacturer, device and size', () => {
    expect(parseFlashId(0x1640ef)).toMatchObject({ manufacturerName: 'Winbond', device: '4016', sizeBytes: 4 * 1048576 });
    expect(parseFlashId(0x1740c8).sizeBytes).toBe(8 * 1048576);
    expect(parseFlashId(0xffffff)).toBeNull();
    expect(parseFlashId(0)).toBeNull();
  });

  it('identifies chip, MAC and flash size through esptool-js', async () => {
    const r = await identifyEsp({ port, baudrate: 460800 });
    expect(r.info.chip).toMatch(/ESP32-S3/);
    expect(r.info.mac).toBe('24:6f:28:aa:bb:cc');
    expect(r.info.flash.sizeBytes).toBe(4 * 1048576);
    expect(state.constructed).toEqual([460800]);
    expect(state.disconnects).toBe(1);
  });

  it('falls back to 115200 when the faster baud fails', async () => {
    state.failFast = true;
    const logs = [];
    const r = await identifyEsp({ port, baudrate: 921600, onLog: (m) => logs.push(m) });
    expect(state.constructed).toEqual([921600, 115200]);
    expect(r.info.baudrate).toBe(115200);
    expect(logs.join('\n')).toMatch(/retrying at 115200/);
  });

  it('full flash length equals the detected size and is never a hard-coded 4 MB', async () => {
    state.jedec = 0x1840ef; // 16 MB
    const { info } = await identifyEsp({ port });
    expect(fullFlashLength(info.flash)).toBe(16 * 1048576);
    expect(() => fullFlashLength(null)).toThrow(/will not assume 4 MB/);
    expect(() => fullFlashLength({ sizeBytes: null })).toThrow(/Flash size is unknown/);
  });

  it('reads and parses the partition table at 0x8000', async () => {
    const r = await readPartitionTable({ port });
    expect(state.readFlashCalls[0]).toEqual([0x8000, 0x1000]);
    expect(r.table.partitions[0]).toMatchObject({ name: 'nvs', offset: 0x9000 });
    expect(r.table.md5.valid).toBe(true);
  });

  it('dumps a partition range and refuses a range past the detected flash', async () => {
    const ok = await dumpFlashViaStub({ port, startOffset: 0x9000, length: 0x6000, baudrate: 460800 });
    expect(ok.data.length).toBe(0x6000);
    expect(state.readFlashCalls.at(-1)).toEqual([0x9000, 0x6000]);
    await expect(dumpFlashViaStub({ port, startOffset: 0x3f0000, length: 0x20000 })).rejects.toThrow(/past the detected 4 MB/);
    expect(state.disconnects).toBe(2);
  });
});
