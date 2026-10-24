/**
 * Operation.js
 * Base class for all CyberChef operations.
 */

import { Dish } from './Dish.js';

export class Operation {
  /**
   * @param {Object} options
   * @param {string} options.name
   * @param {string} [options.id]
   * @param {string} [options.module] - Category/module name (e.g., 'Cryptography', 'Compression')
   * @param {string} [options.description]
   * @param {'string'|'ArrayBuffer'|'Dish'} [options.inputType='string']
   * @param {'string'|'ArrayBuffer'|'Dish'} [options.outputType='string']
   * @param {Array<Object>} [options.args=[]]
   */
  constructor(options = {}) {
    this.name = options.name || this.constructor.name || 'Unnamed Operation';
    this.id = options.id || this.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    this.module = options.module || options.category || 'General';
    this.description = options.description || options.desc || '';
    this.inputType = options.inputType || 'string';
    this.outputType = options.outputType || 'string';
    this.args = Array.isArray(options.args) ? options.args : [];
  }

  /**
   * Abstract run method to be implemented by child classes.
   * @param {string|ArrayBuffer|Dish} input
   * @param {Object} [args={}]
   * @returns {Promise<string|ArrayBuffer|Dish>|string|ArrayBuffer|Dish}
   */
  async run(input, args = {}) {
    throw new Error(`Operation "${this.name}" has not implemented the run() method.`);
  }

  /**
   * Normalizes input Dish, invokes run(), and wraps the result in a new Dish.
   * @param {Dish} dish
   * @param {Object} [args={}]
   * @returns {Promise<Dish>}
   */
  async execute(dish, args = {}) {
    if (typeof this.load === 'function' && !this.loaded) {
      await this.load();
      this.loaded = true;
    }

    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    let resolvedInput;

    if (this.inputType === 'ArrayBuffer') {
      resolvedInput = inputDish.toArrayBuffer();
    } else if (this.inputType === 'Dish') {
      resolvedInput = inputDish;
    } else {
      resolvedInput = inputDish.toString();
    }

    const output = await this.run(resolvedInput, args);

    if (output instanceof Dish) {
      return output;
    }

    if (this.outputType === 'ArrayBuffer') {
      return new Dish(output, 'ArrayBuffer');
    }
    return new Dish(output, 'string');
  }
}

/**
 * LazyOperation
 * Defers loading of heavy operational modules until recipe execution time,
 * preserving fast initial load and small bundle footprints.
 */
export class LazyOperation extends Operation {
  /**
   * @param {Object} options - Operation metadata (name, module, description, args, etc.)
   * @param {Function} loader - Async import function e.g. () => import('./heavyModule.js')
   */
  constructor(options = {}, loader) {
    super(options);
    this._loader = loader;
    this.loaded = false;
    this._delegate = null;
  }

  async load() {
    if (this.loaded) return;
    if (typeof this._loader === 'function') {
      const mod = await this._loader();
      // Handle class export, object export, or instance export
      if (typeof mod.default === 'function') {
        this._delegate = new mod.default();
      } else if (mod[this.constructor.name]) {
        this._delegate = new mod[this.constructor.name]();
      } else if (typeof mod.run === 'function') {
        this._delegate = mod;
      } else {
        this._delegate = mod.default || mod;
      }
    }
    this.loaded = true;
  }

  async run(input, args = {}) {
    if (!this.loaded) {
      await this.load();
    }
    if (this._delegate && typeof this._delegate.run === 'function') {
      return await this._delegate.run(input, args);
    }
    throw new Error(`Lazy operation "${this.name}" failed to load implementation.`);
  }
}

export default Operation;

