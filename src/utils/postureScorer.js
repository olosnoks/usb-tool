/**
 * Environment Posture Scoring Engine
 * Evaluates real-time RF environment security posture (0 - 100)
 * based on open networks, legacy ciphers, default SSIDs, and identity anomalies.
 */

export const GENERIC_SSID_PATTERNS = [
  /^linksys/i,
  /^netgear/i,
  /^d-?link/i,
  /^tp-?link/i,
  /^default/i,
  /^setup/i,
  /^asus/i,
  /^belkin/i,
  /^cisco/i,
  /^wireless/i,
  /^wifi/i,
  /^router/i,
  /^tenda/i,
  /^2wire/i,
  /^motorola/i,
  /^arris/i,
  /^xfinitywifi/i,
  /^attwifi/i
];

/**
 * Checks if an SSID matches generic or out-of-the-box factory defaults.
 * @param {string} ssid 
 * @returns {boolean}
 */
export function isGenericSsid(ssid) {
  if (!ssid || typeof ssid !== 'string') return false;
  const trimmed = ssid.trim();
  if (trimmed === '' || trimmed === '<Hidden SSID>' || trimmed === '<Unknown>') return false;
  return GENERIC_SSID_PATTERNS.some(regex => regex.test(trimmed));
}

/**
 * Computes an environmental security posture score (0 - 100).
 * 
 * Penalties:
 * - Open (unencrypted) networks: -15 pts each (Heavy)
 * - Legacy encryption (WEP / WPA-TKIP): -10 pts each (Medium)
 * - Generic / default factory SSIDs: -5 pts each (Light)
 * - Suspected Identity & Rogue Anomalies: -10 pts each (Medium)
 * 
 * @param {Object|Array} devices - Discovered AP devices
 * @param {Array} [anomalies=[]] - Detected identifier or rogue anomalies
 * @returns {Object} Posture score, grade, risk level, and detailed penalties breakdown
 */
export function calculatePostureScore(devices = {}, anomalies = []) {
  const deviceList = Array.isArray(devices) ? devices : Object.values(devices || {});
  const anomalyList = Array.isArray(anomalies) ? anomalies : [];

  if (deviceList.length === 0) {
    return {
      score: 100,
      grade: 'A+',
      level: 'secure',
      penalties: [],
      breakdown: {
        totalDevices: 0,
        openCount: 0,
        legacyCount: 0,
        genericCount: 0,
        anomalyCount: 0,
        secureCount: 0
      }
    };
  }

  let openCount = 0;
  let legacyCount = 0;
  let genericCount = 0;
  let secureCount = 0;

  for (const dev of deviceList) {
    const sec = dev.security ? String(dev.security).toUpperCase() : 'OPEN';

    if (sec === 'OPEN') {
      openCount++;
    } else if (sec === 'WEP' || sec === 'WPA' || sec.includes('TKIP')) {
      legacyCount++;
    } else {
      secureCount++;
    }

    if (isGenericSsid(dev.ssid)) {
      genericCount++;
    }
  }

  // Count rogue AP suspects and rotation anomalies
  const rogueCount = deviceList.filter(d => d.isRogueSuspect).length;
  const totalAnomalyCount = Math.max(anomalyList.length, rogueCount);

  // Calculate penalties
  const openPenalty = openCount * 15;
  const legacyPenalty = legacyCount * 10;
  const genericPenalty = genericCount * 5;
  const anomalyPenalty = totalAnomalyCount * 10;

  const totalPenalties = openPenalty + legacyPenalty + genericPenalty + anomalyPenalty;
  const rawScore = 100 - totalPenalties;
  const score = Math.max(0, Math.min(100, rawScore));

  const penalties = [];
  if (openCount > 0) {
    penalties.push({
      type: 'open',
      severity: 'heavy',
      count: openCount,
      deduction: openPenalty,
      description: `${openCount} Open (Unencrypted) Access Point${openCount > 1 ? 's' : ''} detected (-${openPenalty} pts)`
    });
  }
  if (legacyCount > 0) {
    penalties.push({
      type: 'legacy',
      severity: 'medium',
      count: legacyCount,
      deduction: legacyPenalty,
      description: `${legacyCount} Legacy Encryption (WEP/WPA) network${legacyCount > 1 ? 's' : ''} detected (-${legacyPenalty} pts)`
    });
  }
  if (genericCount > 0) {
    penalties.push({
      type: 'generic_ssid',
      severity: 'light',
      count: genericCount,
      deduction: genericPenalty,
      description: `${genericCount} Default/Generic SSID${genericCount > 1 ? 's' : ''} detected (-${genericPenalty} pts)`
    });
  }
  if (totalAnomalyCount > 0) {
    penalties.push({
      type: 'anomaly',
      severity: 'medium',
      count: totalAnomalyCount,
      deduction: anomalyPenalty,
      description: `${totalAnomalyCount} Identity/Rogue Anomaly alert${totalAnomalyCount > 1 ? 's' : ''} flagged (-${anomalyPenalty} pts)`
    });
  }

  let grade = 'A';
  let level = 'secure';

  if (score >= 90) {
    grade = 'A';
    level = 'secure';
  } else if (score >= 80) {
    grade = 'B';
    level = 'warning';
  } else if (score >= 70) {
    grade = 'C';
    level = 'warning';
  } else if (score >= 50) {
    grade = 'D';
    level = 'critical';
  } else {
    grade = 'F';
    level = 'critical';
  }

  return {
    score,
    grade,
    level, // 'secure' (90-100) | 'warning' (70-89) | 'critical' (<70)
    penalties,
    breakdown: {
      totalDevices: deviceList.length,
      openCount,
      legacyCount,
      genericCount,
      anomalyCount: totalAnomalyCount,
      secureCount
    }
  };
}
