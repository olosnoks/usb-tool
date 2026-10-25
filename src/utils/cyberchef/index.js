/**
 * CyberChef Engine Main Export
 *
 * This engine (Operation / Dish / Chef / recipe / Magic architecture) is an
 * independent implementation modeled on GCHQ's CyberChef
 * (https://github.com/gchq/CyberChef — Crown Copyright, Apache-2.0).
 * See ACKNOWLEDGMENTS.md for full third-party attribution.
 */

import { Chef } from './core/index.js';

export { Dish, Operation, LazyOperation, Recipe, Chef, registry, OperationRegistry, ExecutionContext } from './core/index.js';
export {
  ALL_OPERATIONS,
  cryptographyOperations,
  compressionOperations,
  parsingOperations,
  extractorOperations,
  networkingOperations,
  forensicOperations,
  flowControlOperations,
  arithmeticOperations,
  dataFormatOperations,
  hashingOperations,
  dateTimeOperations,
  cipherOperations,
  obfuscationOperations,
  customOperations,
  CustomScript,
  networkParserOperations,
  UntarOperation,
  cryptanalysisOperations
} from './operations/index.js';

export { magic, calculateEntropy, calculatePrintableRatio, detectMagicBytes } from './magic.js';
export {
  calculateRollingEntropy,
  calculateByteFrequencies,
  calculateAnalyticsSummary,
  classifyByte
} from './analytics.js';
export default Chef;

