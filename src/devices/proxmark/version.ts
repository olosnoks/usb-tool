import { decodeChipId } from '../../protocols/pm3';
import { DeviceFirmwareIdentity, HardwareTarget } from './types';

/**
 * NG firmware answers CMD_VERSION with
 *   { u32 chip id, u32 section size, u32 versionstr_len, char versionstr[] }
 * optionally followed by a u32 flash size. Returns null for anything else
 * (e.g. a bare text banner).
 */
function splitNgVersionStruct(payload: Uint8Array): { chipId: number; text: Uint8Array } | null {
  if (payload.byteLength < 13) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const strLen = view.getUint32(8, true);
  const rest = payload.byteLength - 12;
  if (strLen === 0 || (strLen !== rest && strLen + 4 !== rest)) return null;
  return { chipId: view.getUint32(0, true), text: payload.subarray(12, 12 + strLen) };
}

/** Value of the first line that starts with `label` (e.g. "os: ..." or "OS......... ..."). */
function versionLine(text: string, label: RegExp): string | undefined {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (label.test(trimmed)) return trimmed.replace(label, '').trim() || undefined;
  }
  return undefined;
}

const BUILD_DATE = /\b(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)\b/;
const ESC = String.fromCharCode(27);
const NUL = String.fromCharCode(0);
const ANSI_COLOURS = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const NUL_RUNS = new RegExp(`${NUL}+`, 'g');

/**
 * Parses the raw payload bytes from a Proxmark CMD_VERSION packet into a typed DeviceFirmwareIdentity.
 * Handles the NG version structure, UTF-8 text payloads, null-separated strings, and structured banners.
 */
export function parseVersionPayload(payload: Uint8Array): DeviceFirmwareIdentity {
  if (!payload || payload.byteLength === 0) {
    return {
      rawVersionString: 'Empty version response',
      gitHash: 'unknown',
      isClean: false,
      hardwareTarget: 'UNKNOWN'
    };
  }

  const ngStruct = splitNgVersionStruct(payload);
  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const rawText = decoder.decode(ngStruct ? ngStruct.text : payload).trim();

  // Normalize null bytes and carriage returns, drop the firmware's ANSI colours
  const normalizedText = rawText
    .replace(ANSI_COLOURS, '')
    .replace(NUL_RUNS, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  // Detect Hardware Target
  let hardwareTarget: HardwareTarget = 'UNKNOWN';
  if (/RDV4/i.test(normalizedText)) {
    hardwareTarget = 'PM3RDV4';
  } else if (/ICOPYX/i.test(normalizedText)) {
    hardwareTarget = 'PM3ICOPYX';
  } else if (/PM5|PROXMARK5/i.test(normalizedText)) {
    hardwareTarget = 'PM5';
  } else if (/GENERIC|EASY/i.test(normalizedText)) {
    hardwareTarget = 'PM3GENERIC';
  } else if (ngStruct && /^\s*OS[.:\s]/im.test(normalizedText)) {
    // A well-formed NG version reply. The version text does not name the board
    // variant (that is in CMD_CAPABILITIES), so it stays unspecified.
    hardwareTarget = 'PM3';
  }

  // Detect Git Commit Hash (7 to 40 hex characters)
  // First attempt: search for explicitly tagged commit/hash
  let gitHash = 'unknown';
  const taggedCommitMatch = normalizedText.match(/(?:commit|hash|git)[\s:=]+([0-9a-fA-F]{7,40})/i);
  if (taggedCommitMatch && taggedCommitMatch[1]) {
    gitHash = taggedCommitMatch[1].toLowerCase();
  } else {
    // Fallback: look for any standalone 7-40 hex string
    const anyHashMatch = normalizedText.match(/\b([0-9a-fA-F]{7,40})\b/);
    if (anyHashMatch && anyHashMatch[1]) {
      gitHash = anyHashMatch[1].toLowerCase();
    }
  }

  // Detect Cleanliness (clean vs suspect / dirty / unclean)
  const isSuspect = /suspect|dirty|unclean|\+/i.test(normalizedText);
  const isClean = !isSuspect;

  // Detect Build Date (YYYY-MM-DD)
  const dateMatch = normalizedText.match(BUILD_DATE);
  const buildDate = dateMatch ? dateMatch[1] : undefined;

  return {
    rawVersionString: normalizedText,
    gitHash,
    isClean,
    hardwareTarget,
    buildDate,
    protocol: 'ng',
    ...(ngStruct ? decodeChipId(ngStruct.chipId) : {}),
    osVersion: versionLine(normalizedText, /^OS[.:\s]+/i),
    bootromVersion: versionLine(normalizedText, /^bootrom[.:\s]+/i)
  };
}

/**
 * Identity of a Proxmark3 on legacy (pre-NG) firmware. That firmware answers
 * CMD_VERSION with a series of debug strings ("bootrom: ...", "os: ...", FPGA
 * info) followed by CMD_ACK carrying the MCU chip ID in arg0.
 */
export function parseLegacyVersion(lines: string[], chipId: number): DeviceFirmwareIdentity {
  const text = lines.map((l) => l.trim()).filter(Boolean).join('\n');
  const osVersion = versionLine(text, /^os:\s*/i);
  const describe = (osVersion ?? '').match(/-g([0-9a-f]{7,40})\b/i);
  const dateMatch = (osVersion ?? text).match(BUILD_DATE);
  return {
    rawVersionString: text,
    gitHash: describe ? describe[1].toLowerCase() : 'unknown',
    isClean: !/suspect|dirty|unclean/i.test(osVersion ?? text),
    // Pre-NG firmware is one build for every Proxmark3 board, so the variant
    // (Easy, RDV2, RDV3...) cannot be read from it.
    hardwareTarget: 'PM3',
    buildDate: dateMatch ? dateMatch[1] : undefined,
    protocol: 'legacy',
    ...decodeChipId(chipId),
    osVersion,
    bootromVersion: versionLine(text, /^bootrom:\s*/i)
  };
}
