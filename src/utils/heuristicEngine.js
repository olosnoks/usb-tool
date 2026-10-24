/**
 * Security Heuristic Engine for 802.11 Telemetry
 * Scans discovered Access Points for out-of-the-box default SSIDs,
 * deprecated legacy encryption (WEP / WPA-TKIP), and open unencrypted networks.
 */

export const DEFAULT_SSID_PATTERNS = [
  /^linksys/i,
  /^netgear/i,
  /^tp-link/i,
  /^tplink/i,
  /^d-?link/i,
  /^att-?wifi/i,
  /^att[0-9a-z_-]*/i,
  /^xfinitywifi/i,
  /^spectrumwifi/i,
  /^optimumwifi/i,
  /^cablewifi/i,
  /^default$/i,
  /^belkin/i,
  /^asus/i,
  /^tenda/i,
  /^zyxel/i,
  /^huawei/i,
  /^arris/i,
  /^motorola/i,
  /^centurylink/i,
  /^fios-/i,
  /^2wire/i,
  /^ubnt$/i,
  /^smc/i
];

/**
 * Checks if an SSID matches known vendor out-of-the-box default patterns.
 * @param {string} ssid 
 * @returns {boolean}
 */
export function isDefaultSSID(ssid) {
  if (!ssid || typeof ssid !== 'string') return false;
  const clean = ssid.trim();
  if (!clean || clean === '<Hidden SSID>' || clean === '-') return false;
  return DEFAULT_SSID_PATTERNS.some(pat => pat.test(clean));
}

/**
 * Checks if an AP uses deprecated weak encryption (WEP or TKIP).
 * @param {Object} device 
 * @returns {boolean}
 */
export function isWeakEncryption(device) {
  if (!device) return false;
  const sec = (device.security || '').toUpperCase();
  const cipher = (device.cipher || '').toUpperCase();
  const ciphers = Array.isArray(device.ciphers) ? device.ciphers.join(' ').toUpperCase() : '';

  if (sec.includes('WEP') || cipher.includes('WEP') || ciphers.includes('WEP')) {
    return true;
  }
  if (sec.includes('TKIP') || cipher.includes('TKIP') || ciphers.includes('TKIP')) {
    return true;
  }
  return false;
}

/**
 * Checks if an AP operates an open, unencrypted wireless network.
 * @param {Object} device 
 * @returns {boolean}
 */
export function isOpenNetwork(device) {
  if (!device) return false;
  const sec = (device.security || '').toUpperCase();
  if (sec === 'OPEN' || sec === 'NONE' || sec === 'UNENCRYPTED') {
    return true;
  }
  if (device.privacy === false && !sec) {
    return true;
  }
  return false;
}

/**
 * Generates an automated heuristic security report across discovered devices.
 * 
 * @param {Array<Object>|Object} devices - Array or map of AP devices
 * @returns {Object} Categorized heuristic report object containing:
 *   - defaultSSIDs: Array of devices matching default factory naming
 *   - weakEncryption: Array of devices using legacy WEP or TKIP
 *   - openNetworks: Array of unencrypted devices
 *   - totalVulnerabilities: Aggregate count of detected issues
 *   - scannedCount: Total devices evaluated
 *   - timestamp: ISO 8601 evaluation timestamp
 */
export function generateHeuristicReport(devices = []) {
  const deviceList = Array.isArray(devices) ? devices : Object.values(devices || {});

  const defaultSSIDs = [];
  const weakEncryption = [];
  const openNetworks = [];

  for (const dev of deviceList) {
    if (!dev) continue;

    // 1. Default SSID Check
    if (isDefaultSSID(dev.ssid)) {
      defaultSSIDs.push({
        ...dev,
        vulnerabilityType: 'default_ssid',
        severity: 'Medium',
        riskSummary: `Default factory SSID "${dev.ssid}" reveals router vendor/model and signals unhardened configuration.`,
        recommendation: 'Rename SSID to a non-identifying custom name and verify default administrative passwords are changed.'
      });
    }

    // 2. Weak Legacy Encryption Check (WEP or TKIP)
    if (isWeakEncryption(dev)) {
      const isWep = (dev.security || '').toUpperCase().includes('WEP');
      weakEncryption.push({
        ...dev,
        vulnerabilityType: 'weak_encryption',
        severity: 'Critical',
        riskSummary: isWep 
          ? 'WEP uses flawed RC4 keystream generation subject to statistical FMS/KoreK key recovery in under 60 seconds.'
          : 'WPA-TKIP uses Michael MIC and 64-bit keystream vulnerable to Beck-Tews keystream recovery and forgery.',
        recommendation: 'Immediately migrate radio profile to WPA2-AES (CCMP) or WPA3-SAE. Disable TKIP/WEP cipher suites.'
      });
    }

    // 3. Open Unencrypted Network Check
    if (isOpenNetwork(dev)) {
      openNetworks.push({
        ...dev,
        vulnerabilityType: 'open_network',
        severity: 'High',
        riskSummary: 'Broadcast traffic is transmitted in cleartext without link-layer cryptographic confidentiality.',
        recommendation: 'Enable WPA2/WPA3 Personal (PSK) or Enterprise (802.1X). If public guest access is required, deploy Opportunistic Wireless Encryption (OWE / 802.11ow).'
      });
    }
  }

  return {
    defaultSSIDs,
    weakEncryption,
    openNetworks,
    totalVulnerabilities: defaultSSIDs.length + weakEncryption.length + openNetworks.length,
    scannedCount: deviceList.length,
    timestamp: new Date().toISOString()
  };
}
