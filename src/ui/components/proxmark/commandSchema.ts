import { CommandRiskLevel, PM3_COMMANDS } from '../../../protocols/pm3';

export type ParameterType = 'hex_bytes' | 'boolean' | 'number' | 'select';

export interface CommandParameter {
  id: string;
  name: string;
  type: ParameterType;
  description?: string;
  defaultValue?: any;
  required?: boolean;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: any }>;
}

export interface FormattedCommandPayload {
  arg0?: number;
  arg1?: number;
  arg2?: number;
  flags?: number;
  payload?: Uint8Array;
}

export interface CommandAction {
  id: string;
  name: string;
  description: string;
  risk: CommandRiskLevel;
  cmd: number;
  /**
   * Runs a decoded device operation (request framing and reply parsing chosen
   * for the connected firmware) instead of sending `cmd` as a bare frame.
   */
  op?: 'hf14aReader' | 'lfEm410x' | 'tune';
  parameters?: CommandParameter[];
  formatPayload?: (params: Record<string, any>) => FormattedCommandPayload;
}

export interface SubsystemNode {
  id: string;
  name: string;
  description: string;
  actions: CommandAction[];
}

export interface DomainNode {
  id: string;
  name: string;
  description: string;
  subsystems: SubsystemNode[];
}

/**
 * Validates a hexadecimal string (stripping whitespace and colons).
 * Returns byte array if valid, or descriptive error string.
 */
export function validateHexBytes(hexString: string): {
  valid: boolean;
  error?: string;
  bytes?: Uint8Array;
} {
  if (!hexString || typeof hexString !== 'string') {
    return { valid: false, error: 'Hex input is empty' };
  }

  const cleanHex = hexString.replace(/[\s:-]/g, '');

  if (cleanHex.length === 0) {
    return { valid: false, error: 'Hex input is empty' };
  }

  if (cleanHex.length % 2 !== 0) {
    return { valid: false, error: 'Hex string must have an even number of characters (full bytes)' };
  }

  if (!/^[0-9a-fA-F]+$/.test(cleanHex)) {
    return { valid: false, error: 'Contains non-hexadecimal characters' };
  }

  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substring(i, i + 2), 16);
  }

  return { valid: true, bytes };
}

/**
 * Validates a single parameter value against its schema definition.
 */
export function validateParameter(
  param: CommandParameter,
  value: any
): { valid: boolean; error?: string } {
  if (param.required && (value === undefined || value === null || value === '')) {
    return { valid: false, error: `"${param.name}" is required` };
  }

  if (value === undefined || value === null || value === '') {
    return { valid: true };
  }

  if (param.type === 'hex_bytes') {
    const hexCheck = validateHexBytes(value);
    if (!hexCheck.valid) {
      return { valid: false, error: hexCheck.error };
    }
  }

  if (param.type === 'number') {
    const num = Number(value);
    if (isNaN(num)) {
      return { valid: false, error: `"${param.name}" must be a valid number` };
    }
    if (param.min !== undefined && num < param.min) {
      return { valid: false, error: `"${param.name}" must be >= ${param.min}` };
    }
    if (param.max !== undefined && num > param.max) {
      return { valid: false, error: `"${param.name}" must be <= ${param.max}` };
    }
  }

  return { valid: true };
}

/**
 * Validates all parameters for a selected action.
 */
export function validateActionParameters(
  action: CommandAction,
  values: Record<string, any>
): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  let valid = true;

  if (action.parameters) {
    for (const param of action.parameters) {
      const res = validateParameter(param, values[param.id]);
      if (!res.valid && res.error) {
        errors[param.id] = res.error;
        valid = false;
      }
    }
  }

  return { valid, errors };
}

/**
 * Extensible declarative Proxmark Command Schema Tree
 */
export const COMMAND_TREE: DomainNode[] = [
  {
    id: 'hf',
    name: 'High Frequency (13.56 MHz)',
    description: 'ISO 14443A, ISO 15693, Mifare Classic & DESFire protocols',
    subsystems: [
      {
        id: '14a',
        name: 'ISO 14443A (Mifare / Ultralight / NTAG)',
        description: 'Standard 13.56 MHz proximity card interrogation and raw frame exchange',
        actions: [
          {
            id: 'reader',
            name: '14A Reader (Search / UID Scan)',
            description: 'Performs anticol and reads UID, ATQA, and SAK from nearby 14443A cards.',
            risk: 'diagnostic',
            cmd: PM3_COMMANDS.CMD_HF_14A_READER,
            op: 'hf14aReader',
            parameters: []
          },
          {
            id: 'raw',
            name: '14A Raw Frame Exchange',
            description: 'Transmits arbitrary raw hex frames into the 13.56 MHz RF field.',
            risk: 'raw',
            cmd: PM3_COMMANDS.CMD_HF_14A_RAW,
            parameters: [
              {
                id: 'hexData',
                name: 'Hex Frame Payload',
                type: 'hex_bytes',
                description: 'Hex bytes to transmit (e.g. 52 = WUPA, 26 = REQA, 9320 = SELECT)',
                defaultValue: '52',
                required: true
              },
              {
                id: 'appendCrc',
                name: 'Append CRC-A',
                type: 'boolean',
                description: 'Automatically compute and append 16-bit CRC-A polynomial bytes',
                defaultValue: false
              }
            ],
            formatPayload: (p) => {
              const hexCheck = validateHexBytes(p.hexData || '');
              return {
                flags: p.appendCrc ? 0x01 : 0x00,
                payload: hexCheck.bytes || new Uint8Array(0)
              };
            }
          },
          {
            id: 'info',
            name: '14A Detailed Card Info',
            description: 'Selects the card and shows UID, ATQA, SAK, the card family and (ISO 14443-4 cards) the ATS.',
            risk: 'read',
            cmd: PM3_COMMANDS.CMD_HF_14A_INFO,
            op: 'hf14aReader',
            parameters: []
          }
        ]
      },
      {
        id: '15',
        name: 'ISO 15693 (Vicinity Cards / ICODE)',
        description: 'Long-range 13.56 MHz RFID tagging',
        actions: [
          {
            id: 'reader',
            name: '15693 Vicinity Reader',
            description: 'Inventory scan for ISO 15693 cards in the vicinity.',
            risk: 'diagnostic',
            cmd: 0x0310,
            parameters: []
          }
        ]
      }
    ]
  },
  {
    id: 'lf',
    name: 'Low Frequency (125 / 134 kHz)',
    description: 'EM410x, HID Prox, Indala, T5577 transponders',
    subsystems: [
      {
        id: 'em410x',
        name: 'EM410x 125kHz Tags',
        description: 'Standard 40-bit EM Microelectronic transponders',
        actions: [
          {
            id: 'read',
            name: 'EM410x Read / Search',
            description:
              'Samples the 125 kHz antenna, downloads the capture and demodulates the 5-byte EM410x tag ID (legacy firmware only for now).',
            risk: 'read',
            cmd: PM3_COMMANDS.CMD_LF_ACQ_RAW_ADC,
            op: 'lfEm410x',
            parameters: []
          }
        ]
      }
    ]
  },
  {
    id: 'hw',
    name: 'Hardware & Diagnostics',
    description: 'System ping, antenna tuning, voltage levels and status',
    subsystems: [
      {
        id: 'status',
        name: 'Diagnostics & Tuning',
        description: 'Query hardware subsystem diagnostics and RF antenna voltage',
        actions: [
          {
            id: 'tune',
            name: 'Antenna Tuning (hw tune)',
            description:
              'Measures the LF antenna voltage at 125 / 134 kHz and the HF antenna voltage at 13.56 MHz. Keep cards away; takes a few seconds.',
            risk: 'diagnostic',
            cmd: PM3_COMMANDS.CMD_MEASURE_ANTENNA_TUNING,
            op: 'tune',
            parameters: []
          },
          {
            id: 'ping',
            name: 'Hardware Ping',
            description: 'Sends round-trip keepalive ping to test USB/UART latency (NG firmware).',
            risk: 'diagnostic',
            cmd: PM3_COMMANDS.CMD_PING,
            parameters: []
          },
          {
            id: 'status',
            name: 'Hardware Status',
            description: 'Asks the firmware to print its status report into the frame log (NG firmware).',
            risk: 'diagnostic',
            cmd: PM3_COMMANDS.CMD_STATUS,
            parameters: []
          }
        ]
      }
    ]
  }
];
