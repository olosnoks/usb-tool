/**
 * Wireless Intrusion Detection System (WIDS): Rogue AP / Evil Twin Detector
 * Identifies malicious rogue access points mimicking legitimate SSIDs
 * through encryption discrepancies and vendor OUI spoofing heuristics.
 */

import { getVendor } from './ouiLookup.js';

const IGNORED_SSIDS = new Set([
  '',
  '<Hidden SSID>',
  '<Wildcard Probe>',
  '<Unknown>',
  '<Corrupted SSID>'
]);

/**
 * Analyze discovered access points to detect potential Evil Twin / Rogue APs.
 * 
 * Heuristics:
 * 1. Encryption Mismatch: Same SSID broadcasted by multiple BSSIDs with conflicting security modes (e.g. Open vs WPA2).
 * 2. Vendor OUI Discrepancy: Same SSID broadcasted by hardware from conflicting manufacturers (e.g. Cisco vs Espressif).
 * 
 * @param {Object|Array} devices AP dictionary { [bssid]: apInfo } or AP array
 * @returns {{ rogueSuspects: Array, flaggedBssids: Object }}
 */
export function detectRogueAps(devices) {
  if (!devices) {
    return { rogueSuspects: [], flaggedBssids: {} };
  }

  const apList = Array.isArray(devices) ? devices : Object.values(devices);
  const ssidMap = new Map();

  // Group APs by valid, non-hidden SSID
  for (const ap of apList) {
    if (!ap || !ap.bssid || !ap.ssid) continue;
    const trimmedSsid = ap.ssid.trim();
    if (IGNORED_SSIDS.has(trimmedSsid) || trimmedSsid.length === 0) continue;

    if (!ssidMap.has(trimmedSsid)) {
      ssidMap.set(trimmedSsid, []);
    }
    ssidMap.get(trimmedSsid).push(ap);
  }

  const rogueSuspects = [];
  const flaggedBssids = {};

  for (const [ssid, group] of ssidMap.entries()) {
    // Collect unique BSSIDs for this SSID
    const uniqueBssids = Array.from(new Set(group.map(a => a.bssid)));
    if (uniqueBssids.length < 2) {
      continue; // Normal single AP
    }

    const reasons = [];

    // 1. Encryption Mismatch Check
    const securityTypes = new Set(group.map(a => a.security || 'Open'));
    if (securityTypes.size > 1) {
      reasons.push(`Encryption mismatch: ${Array.from(securityTypes).join(' vs ')}`);
    }

    // 2. Vendor OUI Mismatch Check
    const vendors = new Set(
      group.map(a => {
        const v = a.vendor || getVendor(a.bssid);
        return (v === 'Unknown' || v === 'Unknown OUI') ? null : v;
      }).filter(Boolean)
    );

    if (vendors.size > 1) {
      reasons.push(`Vendor OUI mismatch: ${Array.from(vendors).join(' vs ')}`);
    }

    if (reasons.length > 0) {
      const combinedReason = reasons.join('; ');
      rogueSuspects.push({
        ssid,
        bssids: uniqueBssids,
        reasons,
        reason: combinedReason,
        aps: group
      });

      for (const bssid of uniqueBssids) {
        flaggedBssids[bssid] = {
          isRogueSuspect: true,
          reason: combinedReason,
          ssid
        };
      }
    }
  }

  return {
    rogueSuspects,
    flaggedBssids
  };
}
