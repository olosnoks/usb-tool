/**
 * Offline Data Persistence Engine for WebUSB 802.11 Monitor Sessions
 * Uses native IndexedDB to store capture sessions, devices, clients, and raw frame buffers.
 * Prevents browser memory bloat and tabs crashing during 12+ hour capture sessions.
 */

const DB_NAME = 'skons_wifi_persistence_db';
const DB_VERSION = 1;
const STORE_NAME = 'capture_sessions';

/**
 * Open or initialize the IndexedDB instance.
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB is not supported in this environment'));
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(event.target?.error || new Error('Failed to open IndexedDB database'));
    };
  });
}

/**
 * Save current capture session to IndexedDB.
 * @param {Object} devices - Map of BSSID -> AP telemetry objects
 * @param {Array<Uint8Array>} [rawBuffers=[]] - Captured raw frame binary chunks
 * @param {Object} [metadata={}] - Optional metadata (clients, channelStats, notes, name, id)
 * @returns {Promise<Object>} The saved session record
 */
export async function saveSessionData(devices = {}, rawBuffers = [], metadata = {}) {
  const db = await openDatabase();
  const timestamp = metadata.timestamp || Date.now();
  const id = metadata.id || `sess_${timestamp}_${Math.random().toString(36).slice(2, 7)}`;

  const sessionRecord = {
    id,
    name: metadata.name || `Session ${new Date(timestamp).toLocaleDateString()} ${new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    timestamp,
    devices: devices || {},
    clients: metadata.clients || {},
    channelStats: metadata.channelStats || {},
    rawBuffers: rawBuffers || [],
    packetCount: (rawBuffers && rawBuffers.length) || metadata.packetCount || 0,
    deviceCount: Object.keys(devices || {}).length,
    clientCount: Object.keys(metadata.clients || {}).length,
    notes: metadata.notes || ''
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(sessionRecord);

    req.onsuccess = () => resolve(sessionRecord);
    req.onerror = () => reject(req.error || new Error('Failed to save session data'));
  });
}

/**
 * Load session data from IndexedDB by sessionId.
 * If sessionId is null or 'latest', retrieves the most recent session.
 * @param {string} [sessionId]
 * @returns {Promise<Object|null>}
 */
export async function loadSessionData(sessionId) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    if (!sessionId || sessionId === 'latest') {
      if (store.indexNames.contains('timestamp')) {
        const index = store.index('timestamp');
        const req = index.openCursor(null, 'prev');
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            resolve(cursor.value);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => reject(req.error || new Error('Failed to load latest session cursor'));
        return;
      }

      const req = store.getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        if (all.length === 0) return resolve(null);
        all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        resolve(all[0]);
      };
      req.onerror = () => reject(req.error || new Error('Failed to load sessions'));
      return;
    }

    const req = store.get(sessionId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error || new Error(`Failed to load session ${sessionId}`));
  });
}

/**
 * List all saved sessions metadata (lightweight, omitting rawBuffers).
 * @returns {Promise<Array<Object>>}
 */
export async function listSessions() {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const list = [];

    if (store.indexNames.contains('timestamp')) {
      const index = store.index('timestamp');
      const req = index.openCursor(null, 'prev');
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const val = cursor.value;
          list.push({
            id: val.id,
            name: val.name,
            timestamp: val.timestamp,
            deviceCount: val.deviceCount ?? Object.keys(val.devices || {}).length,
            clientCount: val.clientCount ?? Object.keys(val.clients || {}).length,
            packetCount: val.packetCount ?? (val.rawBuffers ? val.rawBuffers.length : 0),
            notes: val.notes || ''
          });
          cursor.continue();
        } else {
          resolve(list);
        }
      };
      req.onerror = () => reject(req.error || new Error('Failed to iterate sessions cursor'));
      return;
    }

    const req = store.getAll();
    req.onsuccess = () => {
      const all = (req.result || []).map(val => ({
        id: val.id,
        name: val.name,
        timestamp: val.timestamp,
        deviceCount: val.deviceCount ?? Object.keys(val.devices || {}).length,
        clientCount: val.clientCount ?? Object.keys(val.clients || {}).length,
        packetCount: val.packetCount ?? (val.rawBuffers ? val.rawBuffers.length : 0),
        notes: val.notes || ''
      }));
      all.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      resolve(all);
    };
    req.onerror = () => reject(req.error || new Error('Failed to get all sessions'));
  });
}

/**
 * Delete a saved session by ID.
 * @param {string} sessionId 
 * @returns {Promise<boolean>}
 */
export async function deleteSession(sessionId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(sessionId);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error(`Failed to delete session ${sessionId}`));
  });
}

/**
 * Clear all saved capture sessions from IndexedDB.
 * @returns {Promise<boolean>}
 */
export async function clearAllSessions() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error || new Error('Failed to clear sessions store'));
  });
}

const BASELINE_STORAGE_KEY = 'alfa_wifi_baseline_snapshot';

/**
 * Save baseline snapshot to local persistence.
 * @param {Object} devices - Snapshot of active devices (APs)
 * @param {Object} [clients={}] - Snapshot of active client stations
 * @returns {Object} Baseline snapshot record
 */
export function saveBaselineSnapshot(devices = {}, clients = {}) {
  const timestamp = Date.now();
  const snapshot = {
    timestamp,
    savedAt: new Date(timestamp).toLocaleTimeString(),
    deviceCount: Object.keys(devices || {}).length,
    clientCount: Object.keys(clients || {}).length,
    devices: { ...devices },
    clients: { ...clients },
    knownBssids: Object.keys(devices || {}).map(b => b.toUpperCase()),
    knownClientMacs: Object.keys(clients || {}).map(m => m.toUpperCase())
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BASELINE_STORAGE_KEY, JSON.stringify(snapshot));
    }
  } catch (e) {
    console.warn('Failed to save baseline to localStorage:', e);
  }

  return snapshot;
}

/**
 * Load saved baseline snapshot from storage.
 * @returns {Object|null}
 */
export function loadBaselineSnapshot() {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(BASELINE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    console.warn('Failed to load baseline snapshot:', e);
    return null;
  }
}

/**
 * Clear saved baseline snapshot from storage.
 * @returns {boolean}
 */
export function clearBaselineSnapshot() {
  try {
    if (typeof localStorage === 'undefined') return true;
    localStorage.removeItem(BASELINE_STORAGE_KEY);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Filter devices/clients to keep only those discovered after the baseline was saved,
 * or not present in the baseline snapshot.
 * 
 * @param {Array|Object} items - Devices or clients
 * @param {Object} baseline - Saved baseline snapshot
 * @returns {Array} List of newly discovered items
 */
export function filterNewSinceBaseline(items = [], baseline = null) {
  if (!baseline) return Array.isArray(items) ? items : Object.values(items || {});
  const list = Array.isArray(items) ? items : Object.values(items || {});

  const baselineTime = baseline.timestamp || 0;
  const knownBssids = new Set((baseline.knownBssids || []).map(b => b.toUpperCase()));
  const knownMacs = new Set((baseline.knownClientMacs || []).map(m => m.toUpperCase()));

  return list.filter(item => {
    if (!item) return false;
    const identifier = (item.bssid || item.clientMac || item.targetIdentifier || '').toUpperCase();

    // If identifier was not present in the baseline snapshot, it's definitely new
    if (identifier && !knownBssids.has(identifier) && !knownMacs.has(identifier)) {
      return true;
    }

    // Check firstSeen timestamp if numeric
    if (typeof item.firstSeenTimestamp === 'number') {
      return item.firstSeenTimestamp > baselineTime;
    }

    // Check firstSeen timestamp if parseable
    if (item.firstSeen) {
      const parts = item.firstSeen.split(/[:.]/);
      if (parts.length >= 3) {
        const itemDate = new Date();
        itemDate.setHours(parseInt(parts[0], 10), parseInt(parts[1], 10), parseInt(parts[2], 10), parseInt(parts[3] || 0, 10));
        if (itemDate.getTime() > baselineTime) {
          return true;
        }
      }
    }

    return false;
  });
}

const DEVICE_ANNOTATIONS_KEY = 'alfa_wifi_device_annotations';

/**
 * Load all device annotations from localStorage.
 * @returns {Record<string, { customLabel?: string, customColor?: string, notes?: string, updatedAt?: number }>}
 */
export function loadDeviceAnnotations() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(DEVICE_ANNOTATIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('Failed to load device annotations from localStorage:', e);
    return {};
  }
}

/**
 * Save or update annotation for a specific MAC address / BSSID.
 * @param {string} mac - Device MAC or BSSID (case-insensitive normalized to uppercase)
 * @param {{ customLabel?: string, customColor?: string, notes?: string }} annotation
 * @returns {Object} Updated annotations dictionary
 */
export function saveDeviceAnnotation(mac, annotation = {}) {
  if (!mac) return loadDeviceAnnotations();
  const normalizedMac = mac.toUpperCase();
  const current = loadDeviceAnnotations();

  current[normalizedMac] = {
    ...current[normalizedMac],
    ...annotation,
    updatedAt: Date.now()
  };

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_ANNOTATIONS_KEY, JSON.stringify(current));
    }
  } catch (e) {
    console.warn('Failed to save device annotation to localStorage:', e);
  }

  return current;
}

/**
 * Delete annotation for a specific MAC address.
 * @param {string} mac
 * @returns {Object} Updated annotations dictionary
 */
export function deleteDeviceAnnotation(mac) {
  if (!mac) return loadDeviceAnnotations();
  const normalizedMac = mac.toUpperCase();
  const current = loadDeviceAnnotations();
  delete current[normalizedMac];

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEVICE_ANNOTATIONS_KEY, JSON.stringify(current));
    }
  } catch (e) {
    console.warn('Failed to delete device annotation from localStorage:', e);
  }

  return current;
}

/**
 * Clear all device annotations from localStorage.
 * @returns {boolean}
 */
export function clearAllDeviceAnnotations() {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(DEVICE_ANNOTATIONS_KEY);
    }
    return true;
  } catch (e) {
    return false;
  }
}
