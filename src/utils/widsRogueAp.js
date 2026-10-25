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
 * Collapse a parsed security string into a coarse trust family for comparison.
 *
 * - 'WEP' is treated as UNRELIABLE (null): the parser falls back to WEP whenever a
 *   beacon's Privacy bit is set but its RSN/WPA IE can't be found (truncated or
 *   bad-FCS beacons), so a normal WPA2 network frequently shows a phantom "WEP"
 *   twin. Real WEP is essentially extinct, so we never flag on it.
 * - WPA2 / WPA3 / mixed all collapse to 'secured' so an SSID running transition
 *   mode across APs isn't flagged as a mismatch.
 * - 'Open' stays distinct, so a genuine open AP cloning a secured SSID still flags.
 *
 * @param {string} sec
 * @returns {'open'|'secured'|null}
 */
function securityFamily(sec) {
  if (!sec) return null;
  const s = String(sec).toLowerCase();
  if (s === 'open') return 'open';
  if (s.includes('wep')) return null; // unreliable classification — ignore
  if (s.includes('wpa') || s.includes('rsn') || s.includes('sae')) return 'secured';
  return null;
}

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

    // 1. Encryption Mismatch Check — only a genuine open-vs-secured split counts.
    // WEP is ignored (parser-misclassification noise) and WPA2/WPA3/mixed are one
    // family, so transition-mode deployments no longer trip the alert.
    const families = new Set(group.map(a => securityFamily(a.security || 'Open')).filter(Boolean));
    if (families.has('open') && families.has('secured')) {
      reasons.push('Encryption mismatch: an open BSSID is advertising a secured SSID');
    }

    // 2. Vendor OUI Mismatch Check
    const vendors = new Set(
      group.map(a => {
        const v = a.vendor || getVendor(a.bssid);
        return (v === 'Unknown' || v === 'Unknown OUI') ? null : v;
      }).filter(Boolean)
    );

    // Only treat a vendor split as suspicious for a small, clone-like set. Large
    // fleets and mesh deployments (carrier/campus SSIDs) legitimately mix vendor
    // hardware under one SSID, so flagging those is pure noise.
    if (vendors.size > 1 && uniqueBssids.length <= 2) {
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
