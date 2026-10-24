/**
 * Device OS Fingerprinting Engine
 * Analyzes 802.11 Information Element (IE) tag sequences, vendor-specific tags,
 * and DHCP/L3 metadata to identify operating system families.
 */

/**
 * Standard known 802.11 Information Element tag signatures mapped to OS families.
 * Tags: 0=SSID, 1=Rates, 3=DS Parameter, 45=HT Caps, 50=Ext Rates, 61=HT Op,
 *       107=Interworking, 127=Ext Caps, 191=VHT Caps, 221=Vendor Specific.
 */
export const OS_SIGNATURES = {
  // Apple iOS / iPadOS
  '0,1,50,45,127,221,221': 'iOS',
  '0,1,50,45,127,221': 'iOS',
  '0,1,50,45,127,107,221,221': 'iOS',
  '0,1,45,127,221,221': 'iOS',

  // Apple macOS
  '0,1,50,45,61,127,191,221': 'macOS',
  '0,1,50,45,127,191,221': 'macOS',
  '0,1,3,45,127,191,221': 'macOS',
  '0,1,45,127,191,221': 'macOS',

  // Google Android
  '0,1,50,45,127,107,221': 'Android',
  '0,1,50,45,127,221,107': 'Android',
  '0,1,50,45,107,127,221': 'Android',
  '0,1,50,3,45,127,107,221': 'Android',
  '0,1,50,45,127,107,221,221,221': 'Android',
  '0,1,45,127,107,221': 'Android',

  // Microsoft Windows
  '0,1,50,3,45,127,221': 'Windows',
  '0,1,3,45,127,221': 'Windows',
  '0,1,50,45,61,127,221': 'Windows',
  '0,1,45,127,221': 'Windows',
  '0,1,50,45,127,221,221,221': 'Windows',

  // Generic Linux / wpa_supplicant
  '0,1,50,45,127': 'Linux',
  '0,1,3,50,45,127': 'Linux',
  '0,1,45,127': 'Linux',

  // Microcontrollers / IoT / Smart Home
  '0,1,50,221': 'IoT / Embedded',
  '0,1,50': 'IoT / Embedded',
  '0,1,50,45': 'IoT / Embedded',
  '0,1,45': 'IoT / Embedded',
  '0,1,221': 'IoT / Embedded',
  '0,1': 'IoT / Embedded'
};

/**
 * Normalizes an IE signature representation into a comma-delimited numeric string.
 * @param {string|Array<number|string>} sig 
 * @returns {string}
 */
export function normalizeSignature(sig) {
  if (!sig) return '';
  if (Array.isArray(sig)) {
    return sig.map(v => String(v).trim()).filter(Boolean).join(',');
  }
  if (typeof sig === 'string') {
    return sig
      .replace(/[[\]\s]/g, '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .join(',');
  }
  return '';
}

/**
 * Evaluates an IE signature and optional device metadata to determine the operating system.
 * 
 * @param {string|Array<number|string>} ieSignature - Comma-delimited tag string or tag sequence array
 * @param {object} [metadata] - Supplementary hints (dhcpHostname, vendor, signatureHex, etc.)
 * @returns {string} Detected OS ('iOS' | 'macOS' | 'Android' | 'Windows' | 'Linux' | 'IoT / Embedded' | 'Unknown')
 */
export function identifyOS(ieSignature, metadata = {}) {
  const normalized = normalizeSignature(ieSignature);

  // 1. Direct dictionary lookup
  if (normalized && OS_SIGNATURES[normalized]) {
    // If exact match indicates Apple, distinguish macOS vs iOS using hostname or VHT tags
    const directMatch = OS_SIGNATURES[normalized];
    if (directMatch === 'iOS' || directMatch === 'macOS') {
      const host = (metadata.dhcpHostname || '').toLowerCase();
      if (/macbook|imac|macmini|macpro|darwin/i.test(host)) return 'macOS';
      if (/iphone|ipad|ipod/i.test(host)) return 'iOS';
      if (normalized.includes('191')) return 'macOS';
      return directMatch;
    }
    return directMatch;
  }

  // 2. Metadata & Hostname Heuristics
  const hostname = (metadata.dhcpHostname || metadata.hostname || '').toLowerCase();
  if (hostname) {
    if (/iphone|ipad|ipod/i.test(hostname)) return 'iOS';
    if (/macbook|imac|macmini|macpro/i.test(hostname)) return 'macOS';
    if (/android|galaxy|pixel|redmi|oneplus|xperia|huawei|oppo|vivo/i.test(hostname)) return 'Android';
    if (/desktop-|laptop-|win-|windows/i.test(hostname)) return 'Windows';
    if (/ubuntu|debian|fedora|arch|raspberrypi|openwrt|linux/i.test(hostname)) return 'Linux';
    if (/esp8266|esp32|tasmota|sonoff|shelly|tuya|wled|esphome|cam/i.test(hostname)) return 'IoT / Embedded';
  }

  // 3. Vendor OUI Pattern Matching
  const vendor = (metadata.vendor || '').toLowerCase();
  const rawSig = typeof ieSignature === 'string' ? ieSignature.toLowerCase() : '';
  const vendorOuis = typeof metadata.vendorOuis === 'string' ? metadata.vendorOuis.toLowerCase() : '';

  // Microsoft WPS / WMM OUI (00:50:F2)
  if (rawSig.includes('00:50:f2') || rawSig.includes('0050f2') || vendorOuis.includes('00:50:f2')) {
    return 'Windows';
  }

  // Apple Specific Vendor OUI (00:17:F2)
  if (rawSig.includes('00:17:f2') || rawSig.includes('0017f2') || vendorOuis.includes('00:17:f2')) {
    if (normalized.includes('191') || /macbook|imac/i.test(hostname)) return 'macOS';
    return 'iOS';
  }

  // Espressif / Smart Home Vendor match
  if (vendor.includes('espressif') || vendor.includes('tuya') || vendor.includes('smart') || vendor.includes('shenzhen')) {
    return 'IoT / Embedded';
  }

  // Apple Hardware OUI without signature differentiation
  if (vendor.includes('apple')) {
    if (normalized.includes('191')) return 'macOS';
    return 'iOS';
  }

  // Google / Samsung Mobile hardware
  if (vendor.includes('google') || vendor.includes('samsung') || vendor.includes('xiaomi') || vendor.includes('oneplus')) {
    return 'Android';
  }

  // 4. Structural Tag Heuristics
  if (normalized) {
    const tags = normalized.split(',').map(Number);
    // Interworking element (Tag 107) is characteristic of modern Android Hotspot 2.0 implementations
    if (tags.includes(107) && tags.includes(127)) {
      return 'Android';
    }
    // High-Efficiency / VHT without vendor element
    if (tags.length <= 4 && tags.includes(0) && tags.includes(1) && tags.every(t => [0, 1, 3, 45, 50, 221].includes(t))) {
      return 'IoT / Embedded';
    }
    // Standard wpa_supplicant stack
    if (tags.includes(45) && tags.includes(127) && !tags.includes(221)) {
      return 'Linux';
    }
  }

  return 'Unknown';
}

/**
 * Returns visual badge styles and Lucide icon name for a detected OS.
 * @param {string} os 
 * @returns {object}
 */
export function getOsPresentation(os) {
  switch (os) {
    case 'iOS':
      return {
        icon: 'Smartphone',
        badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        label: 'Apple iOS'
      };
    case 'macOS':
      return {
        icon: 'Laptop',
        badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
        label: 'Apple macOS'
      };
    case 'Android':
      return {
        icon: 'Smartphone',
        badge: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        label: 'Google Android'
      };
    case 'Windows':
      return {
        icon: 'Monitor',
        badge: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
        label: 'Microsoft Windows'
      };
    case 'Linux':
      return {
        icon: 'Terminal',
        badge: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        label: 'GNU / Linux'
      };
    case 'IoT / Embedded':
      return {
        icon: 'Cpu',
        badge: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
        label: 'IoT / Microcontroller'
      };
    default:
      return {
        icon: 'HelpCircle',
        badge: 'bg-slate-800 text-slate-500 border-slate-700',
        label: 'Unknown OS'
      };
  }
}
