/**
 * Arithmetic and Bitwise Logic Operations
 * Sum, Mean, Median, Bit-shift, Bitwise AND/OR/XOR
 */

import { Operation } from '../core/Operation.js';
import { Dish } from '../core/Dish.js';

function extractNumbers(text) {
  if (!text) return [];
  const matches = text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g);
  if (!matches) return [];
  return matches.map(Number).filter(n => !isNaN(n));
}

export class SumOperation extends Operation {
  constructor() {
    super({
      name: 'Sum',
      id: 'sum',
      module: 'Arithmetic',
      description: 'Parses all integers and floating-point numbers from the input and calculates their arithmetic sum.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    const nums = extractNumbers(input);
    if (nums.length === 0) return '0';
    return String(nums.reduce((acc, val) => acc + val, 0));
  }
}

export class MeanOperation extends Operation {
  constructor() {
    super({
      name: 'Mean',
      id: 'mean',
      module: 'Arithmetic',
      description: 'Calculates the arithmetic mean (average) of all numbers extracted from input text.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    const nums = extractNumbers(input);
    if (nums.length === 0) return '0';
    return String(nums.reduce((acc, val) => acc + val, 0) / nums.length);
  }
}

export class MedianOperation extends Operation {
  constructor() {
    super({
      name: 'Median',
      id: 'median',
      module: 'Arithmetic',
      description: 'Calculates the statistical median of all numbers extracted from the input text.',
      inputType: 'string',
      outputType: 'string',
      args: []
    });
  }

  async run(input) {
    const nums = extractNumbers(input);
    if (nums.length === 0) return '0';
    nums.sort((a, b) => a - b);
    const mid = Math.floor(nums.length / 2);
    return String(nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid]);
  }
}

export class BitShiftOperation extends Operation {
  constructor() {
    super({
      name: 'Bit-shift',
      id: 'bit_shift',
      module: 'Arithmetic',
      description: 'Performs bitwise shift on byte streams or numeric arrays.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'direction', label: 'Direction', type: 'select', options: ['Left (<<)', 'Right (>>)', 'Zero-fill Right (>>>)'], default: 'Left (<<)' },
        { name: 'amount', label: 'Shift Amount', type: 'number', default: 1 }
      ]
    });
  }

  async run(dish, { direction = 'Left (<<)', amount = 1 } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const uint8 = inputDish.toUint8Array();
    const out = new Uint8Array(uint8.length);
    const amt = Number(amount) || 1;

    for (let i = 0; i < uint8.length; i++) {
      if (direction.startsWith('Left')) {
        out[i] = (uint8[i] << amt) & 0xff;
      } else if (direction.includes('>>>')) {
        out[i] = (uint8[i] >>> amt) & 0xff;
      } else {
        out[i] = (uint8[i] >> amt) & 0xff;
      }
    }

    return new Dish(out.buffer, 'ArrayBuffer');
  }
}

export class BitwiseLogicOperation extends Operation {
  constructor() {
    super({
      name: 'Bitwise AND/OR/XOR',
      id: 'bitwise_logic',
      module: 'Arithmetic',
      description: 'Applies bitwise AND, OR, XOR, or NOT masking with a hex/integer operand across bytes.',
      inputType: 'Dish',
      outputType: 'Dish',
      args: [
        { name: 'operator', label: 'Operator', type: 'select', options: ['AND', 'OR', 'XOR', 'NOT'], default: 'AND' },
        { name: 'operand', label: 'Operand (Hex or Dec)', type: 'text', default: '0xFF' }
      ]
    });
  }

  async run(dish, { operator = 'AND', operand = '0xFF' } = {}) {
    const inputDish = dish instanceof Dish ? dish : new Dish(dish);
    const uint8 = inputDish.toUint8Array();
    const out = new Uint8Array(uint8.length);

    let opVal = 0xff;
    const cleanOp = (operand || '').trim();
    if (cleanOp.startsWith('0x') || cleanOp.startsWith('0X')) {
      opVal = parseInt(cleanOp, 16) & 0xff;
    } else {
      opVal = (Number(cleanOp) || 0xff) & 0xff;
    }

    for (let i = 0; i < uint8.length; i++) {
      if (operator === 'AND') out[i] = uint8[i] & opVal;
      else if (operator === 'OR') out[i] = uint8[i] | opVal;
      else if (operator === 'XOR') out[i] = uint8[i] ^ opVal;
      else if (operator === 'NOT') out[i] = (~uint8[i]) & 0xff;
    }

    return new Dish(out.buffer, 'ArrayBuffer');
  }
}

export const arithmeticOperations = [
  new SumOperation(),
  new MeanOperation(),
  new MedianOperation(),
  new BitShiftOperation(),
  new BitwiseLogicOperation()
];
