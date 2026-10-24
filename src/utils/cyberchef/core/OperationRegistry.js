/**
 * OperationRegistry.js
 * Central registry for all CyberChef operations.
 */

export class OperationRegistry {
  constructor() {
    this._operations = new Map();
    this._lookup = new Map();
  }

  /**
   * Register an Operation instance.
   * @param {Operation} operation
   */
  register(operation) {
    if (!operation || !operation.name) {
      throw new Error('Cannot register invalid operation without name.');
    }
    const key = operation.id || operation.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    this._operations.set(key, operation);
    this._lookup.set(operation.name.toLowerCase(), operation);
    this._lookup.set(key.toLowerCase(), operation);
    if (operation.id) {
      this._lookup.set(operation.id.toLowerCase(), operation);
    }
  }

  /**
   * Register multiple operations.
   * @param {Array<Operation>} ops
   */
  registerAll(ops) {
    for (const op of ops) {
      this.register(op);
    }
  }

  /**
   * Retrieve an Operation by ID or name (case-insensitive).
   * @param {string} identifier
   * @returns {Operation|undefined}
   */
  get(identifier) {
    if (!identifier) return undefined;
    const clean = String(identifier).trim().toLowerCase();
    const cleanKey = clean.replace(/[^a-z0-9]+/g, '_');
    return this._lookup.get(clean) || this._lookup.get(cleanKey) || this._operations.get(cleanKey);
  }

  /**
   * Check if operation exists.
   * @param {string} identifier
   * @returns {boolean}
   */
  has(identifier) {
    return this.get(identifier) !== undefined;
  }

  /**
   * Returns an array of all registered operations.
   * @returns {Array<Operation>}
   */
  getAll() {
    return Array.from(this._operations.values());
  }

  /**
   * Returns list of unique categories/modules.
   * @returns {Array<string>}
   */
  getCategories() {
    const set = new Set();
    for (const op of this._operations.values()) {
      set.add(op.module || 'General');
    }
    return Array.from(set);
  }

  /**
   * Returns operations matching a given category.
   * @param {string} category
   * @returns {Array<Operation>}
   */
  getByCategory(category) {
    return this.getAll().filter(op => (op.module || 'General') === category);
  }

  /**
   * Clear all registered operations.
   */
  clear() {
    this._operations.clear();
    this._lookup.clear();
  }
}

export const registry = new OperationRegistry();
export default registry;
