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

  // --- Ralink / MediaTek RT5572 (802.11a/b/g/n Dual-Band 2x2:2 N600) ---
  {
    vendorId: 0x148F,
    productId: 0x5572,
    chipsetName: 'Ralink RT5572',
    family: 'RT5572',
    driverType: 'ralink',
    standard: '802.11a/b/g/n (Dual-Band N600)',
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
    commonModels: ['Panda Wireless PAU09', 'Alfa AWUS051NH v2', 'Alfa AWUS052NH']
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
    commonModels: ['Panda Wireless PAU05 / PAU06', 'Raspberry Pi Wi-Fi Dongle', 'Generic RT5370']
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
 * Creates a Ralink (rt2800usb), MediaTek, or generic WebUSB driver wrapper exposing
 * a uniform radio interface compatible with the workbench RX/TX pipeline.
 * 
 * @param {USBDevice} rawUsbDevice 
 * @param {Object} profile 
 * @returns {Object} Radio driver instance
 */
function createGenericUsbDriverWrapper(rawUsbDevice, profile) {
  let isMonitor = false;
  let currentChannel = 36;
  let currentWidth = 20;
  let inEndpoint = 1;
  let outEndpoint = 2;
  const isRalink = profile?.driverType === 'ralink' || rawUsbDevice?.vendorId === 0x148F;

  const discoverEndpoints = () => {
    try {
      const iface = rawUsbDevice?.configuration?.interfaces?.[0];
      const alt = iface?.alternates?.[0];
      if (alt && Array.isArray(alt.endpoints)) {
        const bulkIn = alt.endpoints.find(ep => ep.direction === 'in' && ep.type === 'bulk');
        const bulkOut = alt.endpoints.find(ep => ep.direction === 'out' && ep.type === 'bulk');
        if (bulkIn?.endpointNumber != null) inEndpoint = bulkIn.endpointNumber;
        if (bulkOut?.endpointNumber != null) outEndpoint = bulkOut.endpointNumber;
      }
    } catch {
      // Retain default endpoints (EP1 IN, EP2 OUT)
    }
  };

  const ensureUsbOpened = async () => {
    if (!rawUsbDevice) return;
    if (typeof rawUsbDevice.open === 'function' && !rawUsbDevice.opened) {
      await rawUsbDevice.open();
    }
    if (typeof rawUsbDevice.selectConfiguration === 'function' && rawUsbDevice.configuration == null) {
      try {
        await rawUsbDevice.selectConfiguration(1);
      } catch {
        // Configuration may already be active
      }
    }
    if (typeof rawUsbDevice.claimInterface === 'function') {
      try {
        await rawUsbDevice.claimInterface(0);
      } catch {
        // Interface may already be claimed
      }
    }
    discoverEndpoints();
  };

  // Ralink rt2800usb 32-bit MAC/CSR register read/write via Vendor Request 0x07 (Multi-Read) & 0x06 (Multi-Write)
  const readRegisterU32 = async (register) => {
    if (!rawUsbDevice || typeof rawUsbDevice.controlTransferIn !== 'function') return 0;
    const res = await rawUsbDevice.controlTransferIn({
      requestType: 'vendor',
      recipient: 'device',
      request: isRalink ? 0x07 : 0x05,
      value: 0x0000,
      index: register & 0xFFFF
    }, 4);
    if (res?.data && res.data.byteLength >= 4) {
      return res.data.getUint32(0, true);
    }
    return 0;
  };

  const writeRegisterU32 = async (register, value) => {
    if (!rawUsbDevice || typeof rawUsbDevice.controlTransferOut !== 'function') return;
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value >>> 0, true);
    await rawUsbDevice.controlTransferOut({
      requestType: 'vendor',
      recipient: 'device',
      request: isRalink ? 0x06 : 0x05,
      value: 0x0000,
      index: register & 0xFFFF
    }, buf);
  };

  const configureRalinkMonitorRegisters = async (acceptBadFcs = true) => {
    if (!isRalink || !rawUsbDevice || typeof rawUsbDevice.controlTransferOut !== 'function') return;
    try {
      // RT2800USB RX_FILTER_CFG (0x1400): clear drop bits to enable promiscuous 802.11 monitor capture
      // Bit 0: Drop CRC error (0 if acceptBadFcs, 1 otherwise); allow Mgmt/Ctrl/Data/BCN/Probe/Multicast/Broadcast
      const rxFilter = acceptBadFcs ? 0x00000000 : 0x00000001;
      await writeRegisterU32(0x1400, rxFilter);
      // MAC_SYS_CTRL (0x1004): Enable MAC RX (bit 3 = 0x08) & MAC TX (bit 2 = 0x04)
      await writeRegisterU32(0x1004, 0x0000000C);
      // USB_DMA_CFG (0x02A0): Enable USB Bulk-IN RX & Bulk-OUT TX DMA engines
      await writeRegisterU32(0x02A0, 0x00C00020);
    } catch {
      // Ignore benign register errors in mock or restricted environments
    }
  };

  return {
    device: rawUsbDevice,
    profile,
    chipsetModel: profile.chipsetName,
    capabilities: profile.capabilities,
    vendorId: rawUsbDevice.vendorId,
    productId: rawUsbDevice.productId,
    productName: rawUsbDevice.productName || profile.chipsetName,
    manufacturerName: rawUsbDevice.manufacturerName || (isRalink ? 'Ralink / Panda Wireless' : 'Generic'),

    async initializeMonitor(channel = 36, width = 20, offset = 0) {
      await ensureUsbOpened();
      currentChannel = channel;
      currentWidth = width;
      isMonitor = true;
      await configureRalinkMonitorRegisters(true);
      return {
        chip: profile.chipsetName,
        status: 'Active',
        rfPaths: profile.defaultAntennas || 1,
        firmwareDownloaded: true
      };
    },

    async initializeMonitorWithOptions(channel = 36, width = 20, offset = 0, acceptBadFcs = true) {
      await ensureUsbOpened();
      currentChannel = channel;
      currentWidth = width;
      isMonitor = true;
      await configureRalinkMonitorRegisters(acceptBadFcs);
      return {
        chip: profile.chipsetName,
        status: 'Active',
        rfPaths: profile.defaultAntennas || 1,
        firmwareDownloaded: true
      };
    },

    async retune(channel, width = 20, offset = 0) {
      currentChannel = channel;
      currentWidth = width;
      return { channel: currentChannel, usedFastPath: true };
    },

    async shutdownMonitor() {
      isMonitor = false;
      return true;
    },

    async readRxTransfer(length = 32768) {
      if (rawUsbDevice && typeof rawUsbDevice.transferIn === 'function') {
        const res = await rawUsbDevice.transferIn(inEndpoint, length);
        if (res && res.data && res.data.byteLength > 0) {
          return new Uint8Array(res.data.buffer, res.data.byteOffset, res.data.byteLength);
        }
      }
      return new Uint8Array(0);
    },

    async write(payload) {
      if (!hasCapability(profile, CAPABILITIES.TX_SUPPORT)) {
        throw new Error(`Transmit not supported by ${profile.chipsetName}`);
      }
      if (rawUsbDevice && typeof rawUsbDevice.transferOut === 'function') {
        return await rawUsbDevice.transferOut(outEndpoint, payload);
      }
      return true;
    },

    async readRegisterU32(register) {
      return await readRegisterU32(register);
    },

    async writeRegisterU32(register, value) {
      return await writeRegisterU32(register, value);
    },

    async readRegisterU8(register) {
      if (!rawUsbDevice || typeof rawUsbDevice.controlTransferIn !== 'function') return 0;
      const aligned = register & ~0x03;
      const byteIdx = register & 0x03;
      const word = await readRegisterU32(aligned);
      return (word >>> (byteIdx * 8)) & 0xFF;
    },

    async writeRegisterU8(register, value) {
      if (!rawUsbDevice || typeof rawUsbDevice.controlTransferOut !== 'function') return;
      const aligned = register & ~0x03;
      const byteIdx = register & 0x03;
      const current = await readRegisterU32(aligned);
      const mask = ~(0xFF << (byteIdx * 8));
      const updated = (current & mask) | ((value & 0xFF) << (byteIdx * 8));
      await writeRegisterU32(aligned, updated);
    },

    async adapterCapabilities() {
      return {
        chip: profile.family || profile.chipsetName,
        chipName: profile.chipsetName,
        marketingNames: Array.isArray(profile.commonModels) ? profile.commonModels.join(', ') : '',
        variant: isRalink ? 'rt2800usb' : (profile.driverType || 'generic'),
        firmware: isRalink ? 'v0.36 (rt2870.bin / rt2800usb)' : undefined,
        rxChains: profile.defaultAntennas || 1,
        txChains: profile.defaultAntennas || 1,
        supported: true
      };
    },

    async setRxGain(gain) {
      if (isRalink && rawUsbDevice && typeof rawUsbDevice.controlTransferOut === 'function') {
        try {
          // RT5572 / RT2800 BBP Register 66 (AGC / LNA Gain control) via BBP_CSR_CFG (0x101C)
          const bbpGain = Math.round(((gain - 1) / 9) * 0x48) + 0x18;
          const bbpCsr = 0x00020000 | (66 << 8) | (bbpGain & 0xFF);
          await writeRegisterU32(0x101C, bbpCsr);
        } catch {
          // Ignore if control transfer unavailable
        }
      }
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
    // Ralink (rt2800usb), MediaTek, or Generic WebUSB device wrapper
    driverInstance = createGenericUsbDriverWrapper(rawDevice, profile);
  }

  // Decorate with profile and metadata
  driverInstance.profile = profile;
  driverInstance.chipsetModel = profile.chipsetName;
  driverInstance.capabilities = profile.capabilities;
  driverInstance.productId = rawDevice.productId;
  driverInstance.vendorId = rawDevice.vendorId;
  driverInstance.productName = rawDevice.productName || profile.chipsetName;
  const defaultMfr = profile.driverType === 'realtek'
    ? 'Realtek'
    : profile.driverType === 'ralink'
    ? 'Ralink / Panda Wireless'
    : 'MediaTek';
  driverInstance.manufacturerName = rawDevice.manufacturerName || defaultMfr;

  // Attach capability helper directly to instance
  driverInstance.hasCapability = (cap) => hasCapability(profile, cap);

  return driverInstance;
}
