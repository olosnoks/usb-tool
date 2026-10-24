/**
 * Operations Index & Auto-Loader
 * Registers 80+ high-value operations into the global CyberChef OperationRegistry.
 */

import registry from '../core/OperationRegistry.js';
import { cryptographyOperations } from './cryptography.js';
import { compressionOperations } from './compression.js';
import { parsingOperations } from './parsing.js';
import { extractorOperations } from './extractors.js';
import { networkingOperations } from './networking.js';
import { forensicOperations } from './forensics.js';
import { flowControlOperations } from './flowControl.js';
import { arithmeticOperations } from './arithmetic.js';
import { dataFormatOperations } from './dataFormat.js';
import { hashingOperations } from './hashing.js';
import { dateTimeOperations } from './dateTime.js';
import { cipherOperations } from './ciphers.js';
import { obfuscationOperations } from './obfuscation.js';
import { customOperations, CustomScript } from './Custom.js';
import { networkParserOperations } from './NetworkParsers.js';
import { UntarOperation } from './compression.js';
import { cryptanalysisOperations } from './Cryptanalysis.js';

export const ALL_OPERATIONS = [
  ...dataFormatOperations,
  ...cryptographyOperations,
  ...cryptanalysisOperations,
  ...compressionOperations,
  ...hashingOperations,
  ...parsingOperations,
  ...extractorOperations,
  ...networkingOperations,
  ...networkParserOperations,
  ...forensicOperations,
  ...arithmeticOperations,
  ...dateTimeOperations,
  ...cipherOperations,
  ...obfuscationOperations,
  ...flowControlOperations,
  ...customOperations
];

// Register all operations into the registry
registry.registerAll(ALL_OPERATIONS);

export {
  registry,
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
};

export default ALL_OPERATIONS;

