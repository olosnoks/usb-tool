/**
 * Custom.js
 * User-Defined Custom Scripting Operation for CyberChef.
 * Allows power users to write arbitrary JavaScript transformations directly inside recipes.
 */

import { Operation } from '../core/Operation.js';

export class CustomScript extends Operation {
  constructor() {
    super({
      name: 'Custom Script',
      id: 'custom_script',
      module: 'User',
      description: 'Executes user-defined JavaScript code to perform custom transformations.',
      inputType: 'string',
      outputType: 'string',
      args: [
        {
          name: 'code',
          type: 'text',
          label: 'JavaScript Code',
          default: `// Custom transformation script
// Available variables: input (string)
// Return the transformed output (string or ArrayBuffer)
return input.split('').reverse().join('');`
        }
      ]
    });
  }

  /**
   * Executes user code in a function sandbox.
   * @param {string} input
   * @param {Object} args
   * @returns {string|ArrayBuffer}
   */
  async run(input, args = {}) {
    const rawCode = typeof args === 'string'
      ? args
      : (args.code !== undefined ? args.code : (args[0] !== undefined ? args[0] : 'return input;'));

    if (!rawCode || !rawCode.trim()) {
      return input;
    }

    try {
      // Create isolated function wrapper
      // "use strict" prevents implicit global leakage
      const fn = new Function('input', `"use strict";\n${rawCode}`);
      const result = await fn(input);

      if (result === undefined || result === null) {
        return '';
      }
      return result;
    } catch (err) {
      throw new Error(`Custom Script Execution Error: ${err.message}`);
    }
  }
}

export const customOperations = [
  new CustomScript()
];

export default customOperations;
