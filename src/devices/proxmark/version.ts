import { DeviceFirmwareIdentity, HardwareTarget } from './types';

/**
 * Parses the raw payload bytes from a Proxmark CMD_VERSION packet into a typed DeviceFirmwareIdentity.
 * Handles UTF-8 encoded text payloads, null-separated strings, and structured banners.
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

  const decoder = new TextDecoder('utf-8', { fatal: false, ignoreBOM: true });
  const rawText = decoder.decode(payload).trim();

  // Normalize null bytes and carriage returns
  const normalizedText = rawText.replace(/\0+/g, '\n').replace(/\r\n/g, '\n');

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
  const dateMatch = normalizedText.match(/\b(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2})?)\b/);
  const buildDate = dateMatch ? dateMatch[1] : undefined;

  return {
    rawVersionString: normalizedText,
    gitHash,
    isClean,
    hardwareTarget,
    buildDate
  };
}
