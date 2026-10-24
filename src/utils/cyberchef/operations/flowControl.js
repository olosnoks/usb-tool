/**
 * Flow Control Operations
 * Fork, Merge, Register, Subsection, Label, Jump
 */

import { Operation } from '../core/Operation.js';

export class ForkOperation extends Operation {
  constructor() {
    super({
      name: 'Fork',
      id: 'fork',
      module: 'Flow Control',
      description: 'Splits input by delimiter, applying subsequent operations to each element independently until a Merge step.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'splitDelimiter', label: 'Split Delimiter', type: 'text', default: '\\n' },
        { name: 'mergeDelimiter', label: 'Merge Delimiter', type: 'text', default: '\\n' }
      ]
    });
  }

  async run(input, { splitDelimiter = '\\n' } = {}) {
    const delim = splitDelimiter === '\\n' ? '\n' : splitDelimiter;
    return input.split(delim).join('\n');
  }
}

export class MergeOperation extends Operation {
  constructor() {
    super({
      name: 'Merge',
      id: 'merge',
      module: 'Flow Control',
      description: 'Terminates a Fork block and merges the split elements back into a single string using a delimiter.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'delimiter', label: 'Delimiter', type: 'text', default: '\\n' }
      ]
    });
  }

  async run(input, { delimiter = '\\n' } = {}) {
    const delim = delimiter === '\\n' ? '\n' : delimiter;
    const lines = input.split(/\r?\n/);
    return lines.join(delim);
  }
}

export class RegisterOperation extends Operation {
  constructor() {
    super({
      name: 'Register',
      id: 'register',
      module: 'Flow Control',
      description: 'Stores or retrieves named variables in recipe memory, with regex extraction and $variable replacement.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'mode', label: 'Mode', type: 'select', options: ['Set', 'Get', 'Inject / Replace'], default: 'Set' },
        { name: 'register', label: 'Register Name', type: 'text', default: 'R0' },
        { name: 'pattern', label: 'Extract Regex (Set mode)', type: 'text', default: '' }
      ]
    });
  }

  async run(input) {
    // Execution handled by Recipe.js context
    return input;
  }
}

export class SubsectionOperation extends Operation {
  constructor() {
    super({
      name: 'Subsection',
      id: 'subsection',
      module: 'Flow Control',
      description: 'Applies subsequent operations only to lines matching a regex pattern until an End Subsection step.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'action', label: 'Action', type: 'select', options: ['Start', 'End'], default: 'Start' },
        { name: 'regex', label: 'Match Regex', type: 'text', default: '.*' },
        { name: 'invert', label: 'Invert Match', type: 'select', options: ['No', 'Yes'], default: 'No' }
      ]
    });
  }

  async run(input) {
    // Execution handled by Recipe.js context
    return input;
  }
}

export class LabelOperation extends Operation {
  constructor() {
    super({
      name: 'Label',
      id: 'label',
      module: 'Flow Control',
      description: 'Defines a named checkpoint marker for control-flow jumps and looping.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'name', label: 'Label Name', type: 'text', default: 'loop_start' }
      ]
    });
  }

  async run(input) {
    return input;
  }
}

export class JumpOperation extends Operation {
  constructor() {
    super({
      name: 'Jump',
      id: 'jump',
      module: 'Flow Control',
      description: 'Jumps execution back to a named Label step with iteration limits and conditions.',
      inputType: 'string',
      outputType: 'string',
      args: [
        { name: 'label', label: 'Target Label', type: 'text', default: 'loop_start' },
        { name: 'maxJumps', label: 'Max Jumps Limit', type: 'number', default: 5 },
        { name: 'condition', label: 'Condition', type: 'select', options: ['Always', 'If Input Not Empty', 'If Matches Regex'], default: 'Always' },
        { name: 'regex', label: 'Condition Regex', type: 'text', default: '' }
      ]
    });
  }

  async run(input) {
    return input;
  }
}

export const flowControlOperations = [
  new ForkOperation(),
  new MergeOperation(),
  new RegisterOperation(),
  new SubsectionOperation(),
  new LabelOperation(),
  new JumpOperation()
];
