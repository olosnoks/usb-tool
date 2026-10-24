import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  openDatabase, 
  saveSessionData, 
  loadSessionData, 
  listSessions, 
  deleteSession, 
  clearAllSessions,
  loadDeviceAnnotations,
  saveDeviceAnnotation,
  deleteDeviceAnnotation,
  clearAllDeviceAnnotations
} from '../src/utils/localDataStore';
import { detectIdentifierAnomalies } from '../src/utils/wifiParser';

/**
 * In-memory Mock of IndexedDB conforming to W3C IDB specification subset
 * used by localDataStore.js.
 */
class MockIDBIndex {
  constructor(store, keyPath) {
    this.store = store;
    this.keyPath = keyPath;
  }

  openCursor(range, direction = 'next') {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      const records = Array.from(this.store.records.values());
      records.sort((a, b) => {
        const valA = a[this.keyPath] ?? 0;
        const valB = b[this.keyPath] ?? 0;
        return direction === 'prev' ? valB - valA : valA - valB;
      });

      let idx = 0;
      const step = () => {
        if (idx < records.length) {
          const cursor = {
            value: records[idx],
            continue: () => {
              idx++;
              step();
            }
          };
          req.result = cursor;
          if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
        } else {
          req.result = null;
          if (req.onsuccess) req.onsuccess({ target: { result: null } });
        }
      };
      step();
    }, 0);
    return req;
  }
}

class MockIDBObjectStore {
  constructor(name, options = {}) {
    this.name = name;
    this.keyPath = options.keyPath || 'id';
    this.records = new Map();
    this.indices = new Map();
    this.indexNames = {
      contains: (n) => this.indices.has(n)
    };
  }

  createIndex(name, keyPath, options) {
    const idx = new MockIDBIndex(this, keyPath);
    this.indices.set(name, idx);
    return idx;
  }

  index(name) {
    if (!this.indices.has(name)) {
      throw new Error(`Index ${name} not found`);
    }
    return this.indices.get(name);
  }

  put(value) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      const key = value[this.keyPath];
      this.records.set(key, JSON.parse(JSON.stringify(value)));
      req.result = key;
      if (req.onsuccess) req.onsuccess({ target: { result: key } });
    }, 0);
    return req;
  }

  get(key) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      const val = this.records.get(key);
      req.result = val ? JSON.parse(JSON.stringify(val)) : undefined;
      if (req.onsuccess) req.onsuccess({ target: { result: req.result } });
    }, 0);
    return req;
  }

  getAll() {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      const all = Array.from(this.records.values()).map(v => JSON.parse(JSON.stringify(v)));
      req.result = all;
      if (req.onsuccess) req.onsuccess({ target: { result: all } });
    }, 0);
    return req;
  }

  delete(key) {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      this.records.delete(key);
      req.result = undefined;
      if (req.onsuccess) req.onsuccess({ target: { result: undefined } });
    }, 0);
    return req;
  }

  clear() {
    const req = { onsuccess: null, onerror: null, result: null };
    setTimeout(() => {
      this.records.clear();
      req.result = undefined;
      if (req.onsuccess) req.onsuccess({ target: { result: undefined } });
    }, 0);
    return req;
  }
}

class MockIDBDatabase {
  constructor(name, version) {
    this.name = name;
    this.version = version;
    this.stores = new Map();
    this.objectStoreNames = {
      contains: (n) => this.stores.has(n)
    };
  }

  createObjectStore(name, options) {
    const store = new MockIDBObjectStore(name, options);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames, mode) {
    const store = this.stores.get(typeof storeNames === 'string' ? storeNames : storeNames[0]);
    return {
      objectStore: () => store
    };
  }
}

describe('localDataStore (IndexedDB Offline Persistence Engine)', () => {
  let mockDbInstance;

  beforeEach(() => {
    mockDbInstance = new MockIDBDatabase('skons_wifi_persistence_db', 1);

    globalThis.indexedDB = {
      open: vi.fn((name, version) => {
        const req = {
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
          result: mockDbInstance
        };

        setTimeout(() => {
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: { result: mockDbInstance } });
          }
          if (req.onsuccess) {
            req.onsuccess({ target: { result: mockDbInstance } });
          }
        }, 0);

        return req;
      })
    };
  });

  afterEach(() => {
    delete globalThis.indexedDB;
  });

  it('opens and initializes the capture_sessions object store', async () => {
    const db = await openDatabase();
    expect(db).toBeDefined();
    expect(mockDbInstance.stores.has('capture_sessions')).toBe(true);
    const store = mockDbInstance.stores.get('capture_sessions');
    expect(store.indices.has('timestamp')).toBe(true);
  });

  it('saves session data with AP devices, clients, and packet buffers', async () => {
    const devices = {
      '00:11:22:33:44:55': {
        bssid: '00:11:22:33:44:55',
        ssid: 'Corp_WiFi',
        rssi: -55,
        channel: 6,
        security: 'WPA2'
      }
    };
    const rawBuffers = [new Uint8Array([0x00, 0x01, 0x02]), new Uint8Array([0x03, 0x04])];
    const metadata = {
      name: 'Test Lab Capture 1',
      clients: {
        'AA:BB:CC:DD:EE:FF': { clientMac: 'AA:BB:CC:DD:EE:FF', bssid: '00:11:22:33:44:55' }
      },
      channelStats: { 6: 2 }
    };

    const saved = await saveSessionData(devices, rawBuffers, metadata);
    expect(saved).toBeDefined();
    expect(saved.id).toBeDefined();
    expect(saved.name).toBe('Test Lab Capture 1');
    expect(saved.deviceCount).toBe(1);
    expect(saved.clientCount).toBe(1);
    expect(saved.packetCount).toBe(2);
    expect(saved.devices['00:11:22:33:44:55'].ssid).toBe('Corp_WiFi');
  });

  it('loads a previously saved session by ID', async () => {
    const devices = {
      'AA:11:22:33:44:55': { bssid: 'AA:11:22:33:44:55', ssid: 'Target_Network', rssi: -45 }
    };
    const saved = await saveSessionData(devices, [], { id: 'session_target_99' });
    expect(saved.id).toBe('session_target_99');

    const loaded = await loadSessionData('session_target_99');
    expect(loaded).toBeDefined();
    expect(loaded.id).toBe('session_target_99');
    expect(loaded.devices['AA:11:22:33:44:55'].ssid).toBe('Target_Network');
  });

  it('loads the most recent session when sessionId is null or latest', async () => {
    await saveSessionData({ ap1: { bssid: '1' } }, [], { id: 'sess_old', timestamp: 1000 });
    await saveSessionData({ ap2: { bssid: '2' } }, [], { id: 'sess_new', timestamp: 2000 });

    const latest = await loadSessionData('latest');
    expect(latest).toBeDefined();
    expect(latest.id).toBe('sess_new');
  });

  it('lists saved sessions metadata in descending order', async () => {
    await saveSessionData({ a: {} }, [new Uint8Array([1])], { id: 's1', name: 'Session A', timestamp: 1000 });
    await saveSessionData({ a: {}, b: {} }, [new Uint8Array([1]), new Uint8Array([2])], { id: 's2', name: 'Session B', timestamp: 2000 });

    const list = await listSessions();
    expect(list.length).toBe(2);
    expect(list[0].id).toBe('s2');
    expect(list[0].deviceCount).toBe(2);
    expect(list[0].packetCount).toBe(2);
    expect(list[1].id).toBe('s1');
  });

  it('deletes a session by ID', async () => {
    await saveSessionData({}, [], { id: 'delete_me' });
    let loaded = await loadSessionData('delete_me');
    expect(loaded).toBeDefined();

    const ok = await deleteSession('delete_me');
    expect(ok).toBe(true);

    loaded = await loadSessionData('delete_me');
    expect(loaded).toBeNull();
  });

  it('clears all sessions store', async () => {
    await saveSessionData({}, [], { id: 's_clear_1' });
    await saveSessionData({}, [], { id: 's_clear_2' });

    const before = await listSessions();
    expect(before.length).toBe(2);

    await clearAllSessions();
    const after = await listSessions();
    expect(after.length).toBe(0);
  });
});

describe('Identifier Anomaly Tracking (detectIdentifierAnomalies)', () => {
  it('returns empty array if no clients provided', () => {
    expect(detectIdentifierAnomalies(null)).toEqual([]);
    expect(detectIdentifierAnomalies({})).toEqual([]);
    expect(detectIdentifierAnomalies([])).toEqual([]);
  });

  it('ignores clients with wildcard probes or no probes', () => {
    const clients = {
      '11:22:33:44:55:66': {
        clientMac: '11:22:33:44:55:66',
        probedSsids: ['<Wildcard Probe>', '<Hidden SSID>']
      },
      '22:33:44:55:66:77': {
        clientMac: '22:33:44:55:66:77',
        probedSsids: []
      }
    };
    const anomalies = detectIdentifierAnomalies(clients);
    expect(anomalies).toEqual([]);
  });

  it('does not flag single MAC addresses probing networks', () => {
    const clients = {
      '11:22:33:44:55:66': {
        clientMac: '11:22:33:44:55:66',
        probedSsids: ['Home_WiFi', 'Office_Guest']
      }
    };
    const anomalies = detectIdentifierAnomalies(clients);
    expect(anomalies).toEqual([]);
  });

  it('flags multiple distinct MACs broadcasting identical probed SSID sequence', () => {
    const clients = {
      'DA:A1:19:22:33:01': {
        clientMac: 'DA:A1:19:22:33:01',
        vendor: 'Apple',
        probedSsids: ['Starbucks_Free', 'Home_5GHz'],
        lastSeen: '12:00:01',
        rssi: -58,
        channel: 6
      },
      'FA:B2:44:55:66:02': {
        clientMac: 'FA:B2:44:55:66:02',
        vendor: 'Unknown (Randomized)',
        probedSsids: ['Starbucks_Free', 'Home_5GHz'],
        lastSeen: '12:02:15',
        rssi: -62,
        channel: 6
      }
    };

    const anomalies = detectIdentifierAnomalies(clients);
    expect(anomalies.length).toBe(1);
    const anomaly = anomalies[0];
    expect(anomaly.type).toBe('Potential Identifier Rotation Anomaly');
    expect(anomaly.deviceCount).toBe(2);
    expect(anomaly.observedMacs).toContain('DA:A1:19:22:33:01');
    expect(anomaly.observedMacs).toContain('FA:B2:44:55:66:02');
    expect(anomaly.probedSequence).toEqual(['Starbucks_Free', 'Home_5GHz']);
    expect(anomaly.vendors).toContain('Apple');
  });

  it('differentiates distinct probe sequences into separate groups', () => {
    const clients = {
      '11:11:11:11:11:11': {
        clientMac: '11:11:11:11:11:11',
        probedSsids: ['Airport_WiFi']
      },
      '22:22:22:22:22:22': {
        clientMac: '22:22:22:22:22:22',
        probedSsids: ['Airport_WiFi']
      },
      '33:33:33:33:33:33': {
        clientMac: '33:33:33:33:33:33',
        probedSsids: ['Cafe_Net', 'Hotel_Guest']
      },
      '44:44:44:44:44:44': {
        clientMac: '44:44:44:44:44:44',
        probedSsids: ['Cafe_Net', 'Hotel_Guest']
      }
    };

    const anomalies = detectIdentifierAnomalies(clients);
    expect(anomalies.length).toBe(2);
  });
});

describe('Device Annotations Storage (localDataStore)', () => {
  beforeEach(() => {
    let store = {};
    globalThis.localStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, val) => { store[key] = String(val); }),
      removeItem: vi.fn((key) => { delete store[key]; }),
      clear: vi.fn(() => { store = {}; })
    };
  });

  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('saves and loads device annotations keyed by MAC', () => {
    const annotations = saveDeviceAnnotation('00:11:22:33:44:55', {
      customLabel: 'Office Printer',
      customColor: '#10b981',
      notes: 'Second floor hallway'
    });

    expect(annotations['00:11:22:33:44:55']).toBeDefined();
    expect(annotations['00:11:22:33:44:55'].customLabel).toBe('Office Printer');
    expect(annotations['00:11:22:33:44:55'].customColor).toBe('#10b981');
    expect(annotations['00:11:22:33:44:55'].notes).toBe('Second floor hallway');

    const loaded = loadDeviceAnnotations();
    expect(loaded['00:11:22:33:44:55'].customLabel).toBe('Office Printer');
  });

  it('normalizes MAC address to uppercase when saving and querying', () => {
    saveDeviceAnnotation('aa:bb:cc:dd:ee:ff', { customLabel: 'Lab Router' });
    const loaded = loadDeviceAnnotations();
    expect(loaded['AA:BB:CC:DD:EE:FF']).toBeDefined();
    expect(loaded['AA:BB:CC:DD:EE:FF'].customLabel).toBe('Lab Router');
  });

  it('deletes an annotation for a specific device', () => {
    saveDeviceAnnotation('11:22:33:44:55:66', { customLabel: 'Temp Sensor' });
    let loaded = loadDeviceAnnotations();
    expect(loaded['11:22:33:44:55:66']).toBeDefined();

    deleteDeviceAnnotation('11:22:33:44:55:66');
    loaded = loadDeviceAnnotations();
    expect(loaded['11:22:33:44:55:66']).toBeUndefined();
  });

  it('clears all device annotations', () => {
    saveDeviceAnnotation('AA:11:11:11:11:11', { customLabel: 'Dev 1' });
    saveDeviceAnnotation('BB:22:22:22:22:22', { customLabel: 'Dev 2' });

    expect(Object.keys(loadDeviceAnnotations()).length).toBe(2);
    clearAllDeviceAnnotations();
    expect(Object.keys(loadDeviceAnnotations()).length).toBe(0);
  });
});

