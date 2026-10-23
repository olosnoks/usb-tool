import { CommandRiskLevel } from './types';

/**
 * Proxmark3 NG command opcodes, taken from RfidResearchGroup/proxmark3
 * include/pm3_cmd.h.
 */
export const PM3_COMMANDS = {
  // Generic responses
  CMD_ACK: 0x00ff,
  CMD_NACK: 0x00fe,

  // System / device interrogation
  CMD_DEBUG_PRINT: 0x0100, // CMD_DEBUG_PRINT_STRING
  CMD_VERSION: 0x0107,
  CMD_STATUS: 0x0108,
  CMD_PING: 0x0109,
  CMD_CAPABILITIES: 0x0112,
  CMD_QUIT_SESSION: 0x0113,
  CMD_WTX: 0x0116, // "wait time extension" keep-alive during long ops
  CMD_BREAK_LOOP: 0x0118,

  // Bootloader / flash entry
  CMD_HARDWARE_RESET: 0x0004,
  CMD_START_FLASH: 0x0005,

  // Low frequency (125 kHz)
  CMD_LF_EM410X_WATCH: 0x021c,
  CMD_LF_SNIFF_RAW_ADC: 0x0360,

  // High frequency ISO 14443A (13.56 MHz). Raw frames use the same opcode with ISO14A_RAW.
  CMD_HF_ISO14443A_SIMULATE: 0x0384,
  CMD_HF_ISO14443A_READER: 0x0385,

  // Antenna tuning
  CMD_MEASURE_ANTENNA_TUNING: 0x0400,

  // Not a real opcode; kept fail-closed so flashing can never silently run.
  TODO_CMD_FLASH_WRITE_BLOCK: 0x0020,
  TODO_CMD_FLASH_ERASE_CHIP: 0x0021
} as const;

/** Legacy aliases used by the UI schema / device helpers. */
export const CMD_HF_14A_READER = PM3_COMMANDS.CMD_HF_ISO14443A_READER;

/** ISO14A_* flags for CMD_HF_ISO14443A_READER arg0 */
export const ISO14A = {
  CONNECT: 1 << 0,
  NO_DISCONNECT: 1 << 1,
  APDU: 1 << 2,
  RAW: 1 << 3,
  REQUEST_TRIGGER: 1 << 4,
  APPEND_CRC: 1 << 5,
  SET_TIMEOUT: 1 << 6,
  NO_SELECT: 1 << 7,
  TOPAZMODE: 1 << 8,
  NO_RATS: 1 << 9
} as const;

export type Pm3CommandName = keyof typeof PM3_COMMANDS;
export type Pm3CommandValue = typeof PM3_COMMANDS[Pm3CommandName];

/** Mapping of Command Opcode to its designated CommandRiskLevel */
export const COMMAND_RISK_MAP: Record<number, CommandRiskLevel> = {
  [PM3_COMMANDS.CMD_ACK]: 'diagnostic',
  [PM3_COMMANDS.CMD_VERSION]: 'diagnostic',
  [PM3_COMMANDS.CMD_PING]: 'diagnostic',
  [PM3_COMMANDS.CMD_STATUS]: 'diagnostic',
  [PM3_COMMANDS.CMD_CAPABILITIES]: 'diagnostic',
  [PM3_COMMANDS.CMD_QUIT_SESSION]: 'diagnostic',
  [PM3_COMMANDS.CMD_BREAK_LOOP]: 'diagnostic',
  [PM3_COMMANDS.CMD_MEASURE_ANTENNA_TUNING]: 'diagnostic',

  [PM3_COMMANDS.CMD_HF_ISO14443A_READER]: 'read',
  [PM3_COMMANDS.CMD_HF_ISO14443A_SIMULATE]: 'magic',

  [PM3_COMMANDS.CMD_LF_EM410X_WATCH]: 'read',
  [PM3_COMMANDS.CMD_LF_SNIFF_RAW_ADC]: 'read',

  [PM3_COMMANDS.CMD_HARDWARE_RESET]: 'write',
  [PM3_COMMANDS.CMD_START_FLASH]: 'write',
  [PM3_COMMANDS.TODO_CMD_FLASH_WRITE_BLOCK]: 'write',
  [PM3_COMMANDS.TODO_CMD_FLASH_ERASE_CHIP]: 'write'
};

/**
 * Determines the risk level of a given command opcode. Defaults to 'raw' (fail-closed)
 * if the opcode is unknown or unrecognized.
 */
export function getCommandRisk(cmd: number): CommandRiskLevel {
  return COMMAND_RISK_MAP[cmd] ?? 'raw';
}
