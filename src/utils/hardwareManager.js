/**
 * Hardware Abstraction Layer (HAL) & Device Registry
 * 
 * Provides unified device identification, capability discovery, and driver instantiation
 * for WebUSB-compatible 802.11 wireless network interfaces (Realtek RTL8812AU, RTL8814AU, MediaTek MT7921AU, etc.).
 */

import { initDriver, WebUsbRealtekDevice } from './alfaWifiDriver.js';

/**
 * Standard Hardware Capabilities Flags
 * @readonly
 */
export const CAPABILITIES = {
  MONITOR_MODE: 'MONITOR_MODE',
  TX_SUPPORT: 'TX_SUPPORT',
  DUAL_BAND: 'DUAL_BAND',
  TRI_BAND: 'TRI_BAND',
  HE_WIFI6: 'HE_WIFI6',
  PACKET_INJECTION: 'PACKET_INJECTION',
  HARDWARE_RX_GAIN: 'HARDWARE_RX_GAIN',
  AIRTIME_EXTRACTION: 'AIRTIME_EXTRACTION'
};

/**
 * Universal Device Registry of WebUSB-compatible Wi-Fi Adapters
 */
export const DEVICE_REGISTRY = [
  // --- Realtek RTL8812AU Family (802.11ac 2x2:2) ---
  {
    vendorId: 0x0BDA,
    productId: 0x8812,
    chipsetName: 'Realtek RTL8812AU',
    family: 'RTL8812AU',
    driverType: 'realtek',
    standard: '802.11a/b/g/n/ac (Wi-Fi 5)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '2x2:2',
    defaultAntennas: 2,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.TX_SUPPORT,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.PACKET_INJECTION,
      CAPABILITIES.HARDWARE_RX_GAIN,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Alfa AWUS036ACH', 'TP-Link Archer T4U v1/v2', 'Netgear A6210']
  },
  {
    vendorId: 0x0BDA,
    productId: 0x881A,
    chipsetName: 'Realtek RTL8812AU (Alt ID)',
    family: 'RTL8812AU',
    driverType: 'realtek',
    standard: '802.11a/b/g/n/ac (Wi-Fi 5)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '2x2:2',
    defaultAntennas: 2,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.TX_SUPPORT,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.PACKET_INJECTION,
      CAPABILITIES.HARDWARE_RX_GAIN,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Alfa AWUS036EAC']
  },
  {
    vendorId: 0x0BDA,
    productId: 0x0811,
    chipsetName: 'Realtek RTL8811AU',
    family: 'RTL8811AU',
    driverType: 'realtek',
    standard: '802.11a/b/g/n/ac (Wi-Fi 5 1x1)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '1x1:1',
    defaultAntennas: 1,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.TX_SUPPORT,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.HARDWARE_RX_GAIN,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Alfa AWUS036ACS', 'Edimax EW-7811UTC']
  },

  // --- Realtek RTL8814AU Family (802.11ac 4x4:4 High Power) ---
  {
    vendorId: 0x0BDA,
    productId: 0x8813,
    chipsetName: 'Realtek RTL8814AU',
    family: 'RTL8814AU',
    driverType: 'realtek',
    standard: '802.11a/b/g/n/ac (Wi-Fi 5 4x4)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '4x4:4',
    defaultAntennas: 4,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.TX_SUPPORT,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.PACKET_INJECTION,
      CAPABILITIES.HARDWARE_RX_GAIN,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Alfa AWUS1900', 'TP-Link Archer T9UH', 'ASUS USB-AC68']
  },

  // --- MediaTek MT7921AU Family (802.11ax Wi-Fi 6) ---
  {
    vendorId: 0x0E8D,
    productId: 0x7961,
    chipsetName: 'MediaTek MT7921AU',
    family: 'MT7921AU',
    driverType: 'mediatek',
    standard: '802.11a/b/g/n/ac/ax (Wi-Fi 6)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '2x2:2',
    defaultAntennas: 2,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.HE_WIFI6,
      CAPABILITIES.AIRTIME_EXTRACTION
      // Note: TX_SUPPORT deliberately omitted for pure RX monitor profiles
    ],
    commonModels: ['Alfa AWUS036AXML', 'Comfast CF-953AX']
  },

  // --- MediaTek MT7612U Family (802.11ac 2x2:2) ---
  {
    vendorId: 0x0E8D,
    productId: 0x7612,
    chipsetName: 'MediaTek MT7612U',
    family: 'MT7612U',
    driverType: 'mediatek',
    standard: '802.11a/b/g/n/ac (Wi-Fi 5)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '2x2:2',
    defaultAntennas: 2,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.TX_SUPPORT,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.PACKET_INJECTION,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Alfa AWUS036ACM', 'Netgear A6210 (v2)']
  },

  // --- MediaTek MT7610U Family (802.11ac 1x1:1) ---
  {
    vendorId: 0x0E8D,
    productId: 0x7610,
    chipsetName: 'MediaTek MT7610U',
    family: 'MT7610U',
    driverType: 'mediatek',
    standard: '802.11a/b/g/n/ac (Wi-Fi 5)',
    frequencyBands: ['2.4GHz', '5GHz'],
    maxMimo: '1x1:1',
    defaultAntennas: 1,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.DUAL_BAND,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Alfa AWUS036AC']
  },

  // --- Ralink / MediaTek RT5370 (802.11b/g/n 2.4GHz Legacy) ---
  {
    vendorId: 0x148F,
    productId: 0x5370,
    chipsetName: 'Ralink RT5370',
    family: 'RT5370',
    driverType: 'ralink',
    standard: '802.11b/g/n (2.4GHz)',
    frequencyBands: ['2.4GHz'],
    maxMimo: '1x1:1',
    defaultAntennas: 1,
    capabilities: [
      CAPABILITIES.MONITOR_MODE,
      CAPABILITIES.TX_SUPPORT,
      CAPABILITIES.AIRTIME_EXTRACTION
    ],
    commonModels: ['Raspberry Pi Wi-Fi Dongle', 'Generic RT5370']
  }
];

/**
 * Fallback Generic Device Profile
 */
export const GENERIC_DEVICE_PROFILE = {
  vendorId: null,
  productId: null,
  chipsetName: 'Generic 802.11 USB Wireless Adapter',
  family: 'Generic',
  driverType: 'generic',
  standard: '802.11 Monitor Mode',
  frequencyBands: ['2.4GHz', '5GHz'],
  maxMimo: '1x1:1',
  defaultAntennas: 1,
  capabilities: [CAPABILITIES.MONITOR_MODE, CAPABILITIES.AIRTIME_EXTRACTION],
  commonModels: ['Generic WebUSB Wi-Fi']
};

/**
 * Lookup device profile matching vendorId and productId.
 * Falls back to vendorId match, and finally to GENERIC_DEVICE_PROFILE.
 * 
 * @param {number} vendorId 
 * @param {number} [productId] 
 * @returns {typeof DEVICE_REGISTRY[0]}
 */
export function getDeviceProfile(vendorId, productId = null) {
  if (vendorId == null) return GENERIC_DEVICE_PROFILE;

  // 1. Exact match on both vendorId and productId
  if (productId != null) {
    const exact = DEVICE_REGISTRY.find(
      d => d.vendorId === vendorId && d.productId === productId
    );
    if (exact) return exact;
  }

  // 2. Fallback match on vendorId alone
  const vendorMatch = DEVICE_REGISTRY.find(d => d.vendorId === vendorId);
  if (vendorMatch) {
    return {
      ...vendorMatch,
      chipsetName: `${vendorMatch.family} (VID 0x${vendorId.toString(16).padStart(4, '0').toUpperCase()})`
    };
  }

  // 3. Fallback generic profile
  return {
    ...GENERIC_DEVICE_PROFILE,
    vendorId,
    productId
  };
}

/**
 * Checks if a profile or device instance supports a specific capability.
 * 
 * @param {Object} profileOrDevice - Device profile object or connected driver instance
 * @param {string} capability - Capability flag from CAPABILITIES
 * @returns {boolean}
 */
export function hasCapability(profileOrDevice, capability) {
  if (!profileOrDevice) return false;
  const caps = profileOrDevice.capabilities || profileOrDevice.profile?.capabilities || [];
  return Array.isArray(caps) && caps.includes(capability);
}

/**
 * Generates an array of WebUSB filter objects for `navigator.usb.requestDevice({ filters })`.
 * 
 * @returns {Array<{ vendorId: number, productId?: number }>}
 */
export function getSupportedDeviceFilters() {
  const filters = [];
  const seen = new Set();

  for (const entry of DEVICE_REGISTRY) {
    const key = `${entry.vendorId}:${entry.productId}`;
    if (!seen.has(key)) {
      seen.add(key);
      const filter = { vendorId: entry.vendorId };
      if (entry.productId != null) {
        filter.productId = entry.productId;
      }
      filters.push(filter);
    }
  }

  return filters;
}

/**
 * Creates a MediaTek or generic driver wrapper exposing a uniform radio interface.
 * 
 * @param {USBDevice} rawUsbDevice 
 * @param {Object} profile 
 * @returns {Object} Radio driver instance
 */
function createGenericUsbDriverWrapper(rawUsbDevice, profile) {
  let isMonitor = false;
  let currentChannel = 36;
  let currentWidth = 20;

  return {
    device: rawUsbDevice,
    profile,
    chipsetModel: profile.chipsetName,
    capabilities: profile.capabilities,
    vendorId: rawUsbDevice.vendorId,
    productId: rawUsbDevice.productId,
    productName: rawUsbDevice.productName || profile.chipsetName,
    manufacturerName: rawUsbDevice.manufacturerName || 'Generic',

    async initializeMonitor(channel = 36, width = 20, offset = 0) {
      currentChannel = channel;
      currentWidth = width;
      isMonitor = true;
      return true;
    },

    async retune(channel, width = 20, offset = 0) {
      currentChannel = channel;
      currentWidth = width;
      return true;
    },

    async shutdownMonitor() {
      isMonitor = false;
      return true;
    },

    async write(payload) {
      if (!hasCapability(profile, CAPABILITIES.TX_SUPPORT)) {
        throw new Error(`Transmit not supported by ${profile.chipsetName}`);
      }
      if (rawUsbDevice && typeof rawUsbDevice.transferOut === 'function') {
        const endpoint = 2; // Default bulk out endpoint
        return await rawUsbDevice.transferOut(endpoint, payload);
      }
      return true;
    },

    async setRxGain(gain) {
      return { success: true, gain };
    },

    free() {
      isMonitor = false;
    }
  };
}

/**
 * Factory Function: Instantiates the appropriate radio driver based on device profile.
 * 
 * Inspects `rawDevice.vendorId` and `rawDevice.productId`, looks up the device profile,
 * and instantiates the proper WASM or WebUSB driver wrapper with uniform API surface.
 * 
 * @param {USBDevice} rawDevice - The raw WebUSB device instance
 * @returns {Promise<Object>} The instantiated and decorated radio driver instance
 */
export async function createRadioDriverInstance(rawDevice) {
  if (!rawDevice) throw new Error('No WebUSB device supplied to driver factory');

  try {
    await initDriver();
  } catch (err) {
    // In Node.js / unit-testing environments without WASM asset server, proceed gracefully
  }

  const profile = getDeviceProfile(rawDevice.vendorId, rawDevice.productId);

  let driverInstance = null;

  if (profile.driverType === 'realtek') {
    if (typeof WebUsbRealtekDevice?.fromWebUsbDevice !== 'function') {
      // WASM Realtek binding genuinely unavailable (e.g. SSR / unit-test env with no WASM).
      throw new Error('Realtek WASM driver unavailable; cannot initialize RTL8812AU monitor mode.');
    }
    // The constructor exists, so any failure here is a real device error (USB interface
    // claim, missing WinUSB/Zadig driver, etc.). Propagate it so the UI reports the actual
    // cause — do NOT fall back to the generic wrapper, which lacks readRxTransfer and would
    // only fail later mid-capture with "readRxTransfer is not a function".
    driverInstance = await WebUsbRealtekDevice.fromWebUsbDevice(rawDevice);
  } else {
    // MediaTek or Generic WebUSB device wrapper
    driverInstance = createGenericUsbDriverWrapper(rawDevice, profile);
  }

  // Decorate with profile and metadata
  driverInstance.profile = profile;
  driverInstance.chipsetModel = profile.chipsetName;
  driverInstance.capabilities = profile.capabilities;
  driverInstance.productId = rawDevice.productId;
  driverInstance.vendorId = rawDevice.vendorId;
  driverInstance.productName = rawDevice.productName || profile.chipsetName;
  driverInstance.manufacturerName = rawDevice.manufacturerName || (profile.driverType === 'realtek' ? 'Realtek' : 'MediaTek');

  // Attach capability helper directly to instance
  driverInstance.hasCapability = (cap) => hasCapability(profile, cap);

  return driverInstance;
}
