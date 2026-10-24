/**
 * history.js
 * CyberChef Session History ("Time Machine")
 * Stores in-memory bake snapshots capped at 20 entries with state restoration and subscriber notifications.
 */

const MAX_HISTORY_ENTRIES = 20;

export class HistoryManager {
  constructor(maxEntries = MAX_HISTORY_ENTRIES) {
    this.maxEntries = maxEntries;
    this.snapshots = [];
    this.subscribers = new Set();
  }

  /**
   * Adds a bake snapshot to history. Caps at maxEntries (default 20).
   * Prevents recording redundant consecutive snapshots if input and recipe are unchanged.
   * @param {Object} snapshotData
   * @param {string} snapshotData.input
   * @param {Array<Object>} snapshotData.recipe
   * @param {string} [snapshotData.output]
   * @param {string} [snapshotData.outputHex]
   * @param {number} [snapshotData.durationMs]
   * @returns {Object|null}
   */
  addSnapshot({ input = '', recipe = [], output = '', outputHex = '', durationMs = 0 } = {}) {
    const serializedRecipe = JSON.stringify(recipe || []);

    // Check if identical to most recent snapshot
    if (this.snapshots.length > 0) {
      const latest = this.snapshots[0];
      if (latest.input === input && latest.serializedRecipe === serializedRecipe) {
        // Update output and duration in place
        latest.output = output;
        latest.outputHex = outputHex;
        latest.durationMs = durationMs;
        this.notify();
        return latest;
      }
    }

    const snapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      isoDate: new Date().toISOString(),
      input,
      inputPreview: input.length > 40 ? input.substring(0, 40) + '...' : input,
      recipe: JSON.parse(serializedRecipe),
      serializedRecipe,
      stepCount: recipe.length,
      recipeSummary: recipe.length > 0
        ? recipe.map(r => r.op || r.name).join(' → ')
        : 'Empty Pipeline',
      output,
      outputPreview: output.length > 60 ? output.substring(0, 60) + '...' : output,
      outputHex,
      durationMs
    };

    this.snapshots.unshift(snapshot);
    if (this.snapshots.length > this.maxEntries) {
      this.snapshots = this.snapshots.slice(0, this.maxEntries);
    }

    this.notify();
    return snapshot;
  }

  /**
   * Returns copy of all snapshots in reverse chronological order.
   * @returns {Array<Object>}
   */
  getSnapshots() {
    return [...this.snapshots];
  }

  /**
   * Retrieves specific snapshot by ID.
   * @param {string} id
   * @returns {Object|null}
   */
  getSnapshot(id) {
    return this.snapshots.find(s => s.id === id) || null;
  }

  /**
   * Clears all session snapshots.
   */
  clear() {
    this.snapshots = [];
    this.notify();
  }

  /**
   * Subscribes a listener to history changes.
   * @param {Function} callback
   * @returns {Function} unsubscribe function
   */
  subscribe(callback) {
    if (typeof callback === 'function') {
      this.subscribers.add(callback);
      return () => this.subscribers.delete(callback);
    }
    return () => {};
  }

  /**
   * Notifies all registered subscribers.
   */
  notify() {
    for (const sub of this.subscribers) {
      try {
        sub(this.getSnapshots());
      } catch (err) {
        console.error('History subscriber error:', err);
      }
    }
  }
}

// Global default singleton instance
export const sessionHistory = new HistoryManager(MAX_HISTORY_ENTRIES);
export default sessionHistory;
