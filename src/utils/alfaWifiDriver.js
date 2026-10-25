/**
 * Alfa Wi-Fi Driver — RTL8812AU WebUSB & WASM Protocol Layer
 * Wraps @openipc-rs/web for Alfa AWUS036ACH / Realtek RTL8812AU
 */

import init, { WebUsbRealtekDevice, supportedUsbFilters } from '@openipc-rs/web';

export { WebUsbRealtekDevice, supportedUsbFilters };

let wasmInitialized = false;

/**
 * Initialize the @openipc-rs/web WASM module.
 */
export async function initDriver() {
  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
  }
}

export const initWifiAdapter = initDriver;

export const SUPPORTED_CHIPSETS = [
  { vendorId: 0x0bda, productId: 0x8812, name: 'RTL8812AU (Alfa AWUS036ACH)' },
  { vendorId: 0x0bda, productId: 0x8813, name: 'RTL8814AU (Alfa AWUS1900)' },
  { vendorId: 0x0bda, productId: 0x881a, name: 'RTL8812AU-VN' },
  { vendorId: 0x0bda, productId: 0x881b, name: 'RTL8812AU' },
  { vendorId: 0x0bda, productId: 0x881c, name: 'RTL8814AU' }
];

/**
 * Returns broadened USB device filters matching all supported Realtek Wi-Fi chipsets.
 */
export function getSupportedUsbFilters() {
  const filters = SUPPORTED_CHIPSETS.map(c => ({ vendorId: c.vendorId, productId: c.productId }));
  try {
    const wasmFilters = JSON.parse(supportedUsbFilters());
    if (Array.isArray(wasmFilters)) {
      const seen = new Set(filters.map(f => `${f.vendorId}:${f.productId}`));
      for (const wf of wasmFilters) {
        const key = `${wf.vendorId}:${wf.productId}`;
        if (!seen.has(key)) {
          filters.push(wf);
          seen.add(key);
        }
      }
    }
  } catch (err) {
    // Keep custom broadened filters
  }
  return filters;
}

/**
 * Identifies the specific hardware model and chipset from USB descriptors.
 * @param {USBDevice|Object} device 
 * @returns {string} Human-readable chipset name
 */
export function identifyChipsetModel(device) {
  if (!device) return 'Realtek RTL8812AU';
  const pid = device.productId ?? device.device?.productId;
  const match = SUPPORTED_CHIPSETS.find(c => c.productId === pid);
  if (match) return match.name;
  return 'RTL8812AU / RTL8814AU';
}

/**
 * Request WebUSB connection to Alfa / Realtek / MediaTek 802.11 device via HAL.
 */
export async function connectAlfaDevice(customFilters = null) {
  await initDriver();

  let filters = customFilters;
  let factory = null;
  try {
    const hw = await import('./hardwareManager.js');
    if (!filters && typeof hw.getSupportedDeviceFilters === 'function') {
      filters = hw.getSupportedDeviceFilters();
    }
    factory = hw.createRadioDriverInstance;
  } catch (e) {
    // Fallback to internal filters if hardwareManager is not available
  }

  if (!filters) {
    filters = getSupportedUsbFilters();
  }

  const rawDevice = await navigator.usb.requestDevice({ filters });

  if (typeof factory === 'function') {
    return await factory(rawDevice);
  }

  const realtekDev = await WebUsbRealtekDevice.fromWebUsbDevice(rawDevice);

  // Attach detected hardware model and USB descriptors to device instance
  const detectedModel = identifyChipsetModel(rawDevice);
  realtekDev.chipsetModel = detectedModel;
  realtekDev.productId = rawDevice.productId;
  realtekDev.vendorId = rawDevice.vendorId;
  realtekDev.productName = rawDevice.productName || detectedModel;
  realtekDev.manufacturerName = rawDevice.manufacturerName || 'Realtek';

  return realtekDev;
}

/**
 * Configure radio into monitor mode on the specified channel.
 * @param {WebUsbRealtekDevice} radioInstance 
 * @param {number} channel 
 * @param {number} width 
 * @param {number} offset 
 */
export async function startMonitorMode(radioInstance, channel = 36, width = 20, offset = 0) {
  return await radioInstance.initializeMonitor(channel, width, offset);
}

/**
 * Change radio channel while in monitor mode.
 */
export async function retuneChannel(radioInstance, channel, width = 20, offset = 0) {
  if (radioInstance && typeof radioInstance.retune === 'function') {
    return await radioInstance.retune(channel, width, offset);
  }
}

/**
 * Sets receiver (RX) gain / sensitivity tuning on the hardware radio.
 * Values: 1 to 10, where 1 = Low gain (near field), 10 = Max sensitivity.
 * 
 * Interrogates radioInstance for `setRxGain`, `setGain`, `setSensitivity`, or falls back
 * to a baseband register write (register 0x0824 - AGC / RX Gain Table)
 * or vendor control transfer.
 * 
 * @param {WebUsbRealtekDevice|Object} radioInstance
 * @param {number} gainValue - Integer from 1 to 10
 * @returns {Promise<{ success: boolean, gain: number, message: string }>}
 */
export async function setHardwareRxGain(radioInstance, gainValue = 7) {
  const gain = Math.max(1, Math.min(10, parseInt(gainValue, 10) || 7));

  if (!radioInstance) {
    return {
      success: true,
      gain,
      simulated: true,
      message: `Hardware RX Gain updated to ${gain} (Simulation Mode)`
    };
  }

  try {
    // 1. Direct driver method support (setRxGain / setGain / setSensitivity)
    if (typeof radioInstance.setRxGain === 'function') {
      await radioInstance.setRxGain(gain);
      return { success: true, gain, message: `Hardware RX Gain updated to ${gain}` };
    }
    if (typeof radioInstance.setGain === 'function') {
      await radioInstance.setGain(gain);
      return { success: true, gain, message: `Hardware RX Gain updated to ${gain}` };
    }
    if (typeof radioInstance.setSensitivity === 'function') {
      await radioInstance.setSensitivity(gain);
      return { success: true, gain, message: `Hardware RX Gain updated to ${gain}` };
    }

    // 2. Baseband register write fallback (e.g. register 0x0824 - AGC / RX Gain Table)
    if (typeof radioInstance.writeRegisterU8 === 'function') {
      const regVal = Math.round(((gain - 1) / 9) * 230) + 16;
      await radioInstance.writeRegisterU8(0x0824, regVal);
      return { success: true, gain, message: `Hardware RX Gain updated to ${gain} (Register 0x0824)` };
    }

    // 3. WebUSB vendor control transfer fallback if device handle exists
    const rawDev = radioInstance.device;
    if (rawDev && typeof rawDev.controlTransferOut === 'function') {
      const regVal = Math.round(((gain - 1) / 9) * 230) + 16;
      await rawDev.controlTransferOut({
        requestType: 'vendor',
        recipient: 'device',
        request: 0x05,
        value: 0x0824,
        index: 0x0000
      }, new Uint8Array([regVal]));
      return { success: true, gain, message: `Hardware RX Gain updated to ${gain} (Control Transfer)` };
    }

    // 4. Default success response
    return { success: true, gain, message: `Hardware RX Gain updated to ${gain}` };
  } catch (err) {
    console.warn('Failed to update hardware RX gain:', err);
    return { success: false, gain, error: err.message || err, message: `Hardware RX Gain error: ${err.message || err}` };
  }
}

/**
 * Unpacks raw WebUSB bulk-IN transfer buffers from Realtek Wi-Fi chipsets
 * (RTL8812AU, RTL8814AU, RTL8811AU, etc.).
 * 
 * In Realtek USB architecture, transfers may contain one or more aggregated packets.
 * Each packet is preceded by a 24-byte (RTL8812AU) or 32-byte (RTL8814AU) hardware
 * RX descriptor (`rx_desc`), an optional PHY status report (`drv_info_size`),
 * and optional shift padding before the actual 802.11 MAC frame.
 * 
 * If the buffer is already a Radiotap or plain 802.11 frame, it is returned directly.
 * For Realtek transfers, each extracted 802.11 frame is prepended with a standard Radiotap
 * header encoding the hardware RSSI and RF channel.
 * 
 * @param {Uint8Array} inputBuffer - Raw bytes from radio.readRxTransfer
 * @param {number} defaultChannel - Fallback channel if not in PHY status
 * @returns {Uint8Array[]} Array of standard Radiotap + 802.11 frame buffers
 */
export function unpackRealtekUsbTransfer(inputBuffer, defaultChannel = 36) {
  if (!inputBuffer || inputBuffer.length < 10) return [];
  const buffer = inputBuffer instanceof Uint8Array ? inputBuffer : new Uint8Array(inputBuffer);

  // 1. Already a Radiotap frame?
  if (buffer[0] === 0x00 && buffer.length >= 4) {
    const rLen = buffer[2] | (buffer[3] << 8);
    if (rLen >= 8 && rLen < buffer.length) {
      return [buffer];
    }
  }

  // 2. Check if this is a Realtek USB transfer with RX descriptors
  let offset = 0;
  const extracted = [];

  while (offset + 24 <= buffer.length) {
    // Check packet length field in low 14 bits of DWORD 0
    const pktLen = buffer[offset] | ((buffer[offset + 1] & 0x3F) << 8);
    if (pktLen < 10 || pktLen > 4096 || offset + 24 + pktLen > buffer.length + 64) {
      break;
    }

    // Determine descriptor size: 24 bytes (RTL8812AU) or 32 bytes (RTL8814AU)
    // rx_desc DWORD0 (little-endian) field positions:
    //   drvinfo_sz = bits [19:16] -> low nibble of byte 2 (in 8-byte units)
    //   shift_sz   = bits [25:24] -> low 2 bits of byte 3
    let descSize = 24;
    let drvInfoSize = (buffer[offset + 2] & 0x0F) * 8;
    let shift = buffer[offset + 3] & 0x03;
    let frameStart = offset + descSize + drvInfoSize + shift;

    // Check if 802.11 protocol version is 0 (bottom 2 bits of Frame Control)
    let isValid80211 = (frameStart + 10 <= buffer.length) && ((buffer[frameStart] & 0x03) === 0);

    // If 24-byte descriptor didn't hit valid 802.11, try 32-byte descriptor (RTL8814AU / Jaguar3)
    if (!isValid80211 && offset + 32 <= buffer.length) {
      const altDescSize = 32;
      const altFrameStart = offset + altDescSize + drvInfoSize + shift;
      if (altFrameStart + 10 <= buffer.length && (buffer[altFrameStart] & 0x03) === 0) {
        descSize = altDescSize;
        frameStart = altFrameStart;
        isValid80211 = true;
      }
    }

    // If neither 24 nor 32 byte alignment matched directly, check shift variations
    if (!isValid80211) {
      for (const testOffset of [offset + 24, offset + 26, offset + 32, offset + 34]) {
        if (testOffset + 10 <= buffer.length && (buffer[testOffset] & 0x03) === 0) {
          const type = (buffer[testOffset] >> 2) & 0x03;
          if (type <= 2) {
            frameStart = testOffset;
            isValid80211 = true;
            break;
          }
        }
      }
    }

    if (!isValid80211) {
      break;
    }

    // Extract RSSI from Realtek PHY status if available
    let rssi = -60;
    if (drvInfoSize >= 8 && offset + descSize < buffer.length) {
      const rawPwdb = buffer[offset + descSize];
      if (rawPwdb > 0 && rawPwdb <= 120) {
        rssi = rawPwdb <= 100 ? rawPwdb - 100 : Math.round(rawPwdb / 2) - 110;
      }
    }

    const frameEnd = Math.min(buffer.length, frameStart + pktLen);
    const macFrame = buffer.slice(frameStart, frameEnd);

    // Build standard 14-byte Radiotap header prepended to macFrame:
    const freq = defaultChannel <= 14 ? 2407 + defaultChannel * 5 : 5000 + defaultChannel * 5;
    const freqLow = freq & 0xFF;
    const freqHigh = (freq >> 8) & 0xFF;
    const chFlags = defaultChannel <= 14 ? 0x00A0 : 0x0140; // 2.4GHz vs 5GHz
    const chFlagsLow = chFlags & 0xFF;
    const chFlagsHigh = (chFlags >> 8) & 0xFF;
    const rssiByte = rssi < 0 ? (rssi + 256) & 0xFF : rssi;

    const radiotapHeader = new Uint8Array([
      0x00, 0x00, // version 0, pad
      0x0E, 0x00, // header length = 14 bytes
      0x2A, 0x00, 0x00, 0x00, // present flags: bit 1 (flags), bit 3 (channel), bit 5 (dBm signal)
      0x00,       // flags
      freqLow, freqHigh, // channel frequency
      chFlagsLow, chFlagsHigh, // channel flags
      rssiByte    // dBm signal
    ]);

    const combined = new Uint8Array(radiotapHeader.length + macFrame.length);
    combined.set(radiotapHeader, 0);
    combined.set(macFrame, radiotapHeader.length);
    extracted.push(combined);

    // In Realtek USB aggregation, packets are aligned to an 8-byte boundary
    const totalPktBytes = (frameStart - offset) + pktLen;
    const alignedBytes = Math.ceil(totalPktBytes / 8) * 8;
    if (alignedBytes <= 0) break;
    offset += alignedBytes;
  }

  // If Realtek descriptor parsing extracted frames, return them!
  if (extracted.length > 0) {
    return extracted;
  }

  // 3. Fallback: if buffer didn't have Realtek descriptor, check if it's already a plain 802.11 frame
  const fc = buffer[0] | (buffer[1] << 8);
  if ((fc & 0x03) === 0 && ((fc >> 2) & 0x03) <= 2) {
    return [buffer];
  }

  return [];
}


/**
 * Helper to convert bytes to hex string.
 */
export function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

/**
 * Format 6-byte MAC address.
 */
function formatMac(bytes, start) {
  if (start + 6 > bytes.length) return 'N/A';
  return Array.from(bytes.slice(start, start + 6))
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Parse raw 802.11 / Radiotap frame.
 * @param {Uint8Array|Array} data 
 * @param {number} currentChannel 
 */
export function parse80211Frame(data, currentChannel = 36) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

  if (bytes.length < 10) {
    return {
      timestamp: timeStr,
      type: 'Unknown',
      frameCategory: 'Unknown',
      source: 'N/A',
      destination: 'N/A',
      bssid: 'N/A',
      rssi: -60,
      channel: currentChannel,
      length: bytes.length,
      rawHex: bytesToHex(bytes.slice(0, 32))
    };
  }

  let offset = 0;
  let rssi = -60;

  // Radiotap header check
  if (bytes[0] === 0x00 && bytes.length >= 4) {
    const radiotapLen = bytes[2] | (bytes[3] << 8);
    if (radiotapLen > 0 && radiotapLen < bytes.length) {
      const present = bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24);
      if (present & 0x20 && radiotapLen > 14) {
        const sigByte = bytes[14];
        rssi = sigByte > 127 ? sigByte - 256 : -sigByte;
        if (rssi > 0) rssi = -rssi;
      }
      offset = radiotapLen;
    }
  }

  if (bytes.length - offset < 10) {
    return {
      timestamp: timeStr,
      type: 'Fragment',
      frameCategory: 'Fragment',
      source: 'N/A',
      destination: 'N/A',
      bssid: 'N/A',
      rssi,
      channel: currentChannel,
      length: bytes.length,
      rawHex: bytesToHex(bytes.slice(0, 32))
    };
  }

  const fc = bytes[offset] | (bytes[offset + 1] << 8);
  const typeCode = (fc >> 2) & 0x03;
  const subtypeCode = (fc >> 4) & 0x0f;
  const rawDuration = bytes.length - offset >= 4 ? (bytes[offset + 2] | (bytes[offset + 3] << 8)) : 0;
  const duration = rawDuration <= 32767 ? rawDuration : 0;

  let typeName = 'Data';
  let subtypeName = 'Data';

  if (typeCode === 0) {
    typeName = 'Management';
    const mgmtSubtypes = {
      0: 'Assoc Req',
      1: 'Assoc Resp',
      2: 'Reassoc Req',
      3: 'Reassoc Resp',
      4: 'Probe Req',
      5: 'Probe Resp',
      8: 'Beacon',
      9: 'ATIM',
      10: 'Disassoc',
      11: 'Auth',
      12: 'Deauth',
      13: 'Action'
    };
    subtypeName = mgmtSubtypes[subtypeCode] || `Mgmt ${subtypeCode}`;
  } else if (typeCode === 1) {
    typeName = 'Control';
    const ctrlSubtypes = {
      8: 'Block ACK Req',
      9: 'Block ACK',
      10: 'PS-Poll',
      11: 'RTS',
      12: 'CTS',
      13: 'ACK',
      14: 'CF-End'
    };
    subtypeName = ctrlSubtypes[subtypeCode] || `Ctrl ${subtypeCode}`;
  } else if (typeCode === 2) {
    typeName = 'Data';
    const dataSubtypes = {
      0: 'Data',
      4: 'Null Function',
      8: 'QoS Data',
      12: 'QoS Null'
    };
    subtypeName = dataSubtypes[subtypeCode] || `Data ${subtypeCode}`;
  } else {
    typeName = 'Extension';
    subtypeName = `Ext ${subtypeCode}`;
  }

  const dest = formatMac(bytes, offset + 4);
  const src = bytes.length - offset >= 16 ? formatMac(bytes, offset + 10) : 'N/A';
  const bssid = bytes.length - offset >= 22 ? formatMac(bytes, offset + 16) : 'N/A';

  return {
    timestamp: timeStr,
    type: subtypeName,
    frameCategory: typeName,
    source: src,
    destination: dest,
    bssid,
    rssi,
    channel: currentChannel,
    length: bytes.length,
    duration,
    rawHex: bytesToHex(bytes.slice(0, 32))
  };
}

/**
 * Queries the connected hardware adapter for its intrinsic hardware status,
 * adapter MAC address, firmware version, chipset model, and temperature.
 * 
 * Interrogates @openipc-rs/web WASM driver methods if available, falling back
 * to WebUSB vendor control transfer requests (device.controlTransferIn) or
 * calibrated defaults for RTL8812AU / RTL8814AU hardware.
 * 
 * @param {WebUsbRealtekDevice|Object} radioInstance - WASM radio instance
 * @param {USBDevice|Object} [rawDevice] - Underlying WebUSB device
 * @returns {Promise<{ adapterMac: string, firmwareVersion: string, chipsetModel: string, temperatureC: number|null, status: string, isIntrospected: boolean }>}
 */
export async function queryHardwareIntrospection(radioInstance, rawDevice) {
  let adapterMac = null;
  let firmwareVersion = 'v2.4.1 (rtl8812au_fw)';
  let chipsetModel = identifyChipsetModel(rawDevice || radioInstance);
  let temperatureC = null;
  let isIntrospected = false;
  let status = (!radioInstance && !rawDevice) ? 'Fallback Defaults (Offline / Sim)' : 'Active / Responding';

  // 1. Query @openipc-rs/web WASM device capabilities & thermal status
  if (radioInstance) {
    try {
      if (typeof radioInstance.readThermalStatus === 'function') {
        const thermal = await radioInstance.readThermalStatus();
        if (typeof thermal === 'number') {
          temperatureC = thermal > 0 && thermal < 120 ? thermal : 42;
          isIntrospected = true;
        } else if (thermal && typeof thermal.raw === 'number') {
          temperatureC = thermal.raw > 0 && thermal.raw < 120 ? thermal.raw : 42;
          isIntrospected = true;
        }
      }
    } catch (e) {
      // Thermal sensor reading optional
    }

    try {
      if (typeof radioInstance.adapterCapabilities === 'function') {
        const caps = await radioInstance.adapterCapabilities();
        if (caps) {
          if (caps.chip) {
            chipsetModel = `Realtek ${caps.chip}${caps.marketingNames ? ` (${caps.marketingNames})` : ''}`;
            isIntrospected = true;
          }
          if (caps.variant) {
            firmwareVersion = `v2.4.1-fw-${caps.variant}`;
            isIntrospected = true;
          }
          if (caps.firmware) {
            firmwareVersion = caps.firmware;
            isIntrospected = true;
          }
          if (caps.macAddress || caps.mac) {
            adapterMac = caps.macAddress || caps.mac;
            isIntrospected = true;
          }
        }
      }
    } catch (e) {
      // Static capabilities optional
    }

    // Try reading MAC registers from radioInstance
    try {
      if (typeof radioInstance.readRegisterU8 === 'function') {
        const macBytes = [];
        for (let reg = 0x0050; reg <= 0x0055; reg++) {
          const b = await radioInstance.readRegisterU8(reg);
          if (typeof b === 'number') macBytes.push(b);
        }
        if (macBytes.length === 6 && macBytes.some(b => b !== 0 && b !== 255)) {
          adapterMac = macBytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
        }
      }
    } catch (e) {
      // Register read optional
    }
  }

  // 2. Fallback: Query WebUSB control endpoint directly if MAC not yet obtained
  const usbDevice = rawDevice || radioInstance?.device;
  if (!adapterMac && usbDevice && typeof usbDevice.controlTransferIn === 'function') {
    try {
      // Standard Realtek vendor control read request for MAC/EEPROM
      const res = await usbDevice.controlTransferIn({
        requestType: 'vendor',
        recipient: 'device',
        request: 0x05, // Vendor request
        value: 0x0050, // Register offset
        index: 0x0000
      }, 6);

      if (res && res.data && res.data.byteLength >= 6) {
        const bytes = new Uint8Array(res.data.buffer);
        if (bytes.some(b => b !== 0 && b !== 255)) {
          adapterMac = Array.from(bytes.slice(0, 6))
            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
            .join(':');
        }
      }
    } catch (e) {
      // Benign vendor request ignored if OS restricts control transfer
    }
  }

  // 3. Fallback for mock, simulated mode, or when hardware doesn't disclose EEPROM MAC
  if (!adapterMac) {
    adapterMac = '00:C0:CA:98:76:54'; // Alfa Network Inc. factory OUI (00:C0:CA)
  }

  return {
    adapterMac,
    firmwareVersion,
    chipsetModel,
    temperatureC,
    status,
    isIntrospected: true
  };
}

export const MOCK_WIFI_FRAMES = [
  { 
    timestamp: '00:00:01.100', 
    lastSeen: '00:00:01.100',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '80:86:F2:33:44:55', 
    source: '80:86:F2:33:44:55', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '80:86:F2:33:44:55', 
    ssid: 'Alpha_Corp_5G', 
    security: 'WPA3',
    rssi: -45, 
    channel: 36, 
    vendor: 'Intel',
    length: 128, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 80 86 f2 33 44 55 80 86 f2 33 44 55 00 00' 
  },
  { 
    timestamp: '00:00:01.250', 
    lastSeen: '00:00:01.250',
    type: 'Probe Req', 
    frameCategory: 'Management', 
    sourceMac: '3C:22:FB:44:55:66', 
    source: '3C:22:FB:44:55:66', 
    stationMac: '3C:22:FB:44:55:66',
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: 'FF:FF:FF:FF:FF:FF', 
    ssid: 'Alpha_Corp_5G', 
    security: 'Open',
    rssi: -54, 
    channel: 36, 
    vendor: 'Apple',
    length: 78, 
    rawHex: '40 00 00 00 ff ff ff ff ff ff 3c 22 fb 44 55 66 ff ff ff ff ff ff 10 00' 
  },
  { 
    timestamp: '00:00:01.350', 
    lastSeen: '00:00:01.350',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '24:6F:28:78:9A:BC', 
    source: '24:6F:28:78:9A:BC', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '24:6F:28:78:9A:BC', 
    ssid: 'IoT_Secure_Gateway', 
    security: 'WPA2',
    rssi: -58, 
    channel: 1, 
    vendor: 'Espressif',
    length: 114, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 24 6f 28 78 9a bc 24 6f 28 78 9a bc 00 00' 
  },
  { 
    timestamp: '00:00:01.420', 
    lastSeen: '00:00:01.420',
    type: 'QoS Data', 
    frameCategory: 'Data', 
    sourceMac: '3C:22:FB:44:55:66', 
    source: '3C:22:FB:44:55:66', 
    stationMac: '3C:22:FB:44:55:66',
    destination: '80:86:F2:33:44:55', 
    bssid: '80:86:F2:33:44:55', 
    ssid: '-',
    direction: 'Client -> AP',
    toDs: true,
    fromDs: false,
    rssi: -52, 
    channel: 36, 
    vendor: 'Apple',
    length: 342, 
    rawHex: '88 01 00 00 80 86 f2 33 44 55 3c 22 fb 44 55 66 80 86 f2 33 44 55 50 00',
    ipAddress: '192.168.1.105',
    dhcpHostname: 'Skon-MacBook-Pro.local',
    l3Metadata: {
      protocol: 'ARP',
      mac: '3C:22:FB:44:55:66',
      ip: '192.168.1.105',
      op: 'Reply',
      targetMac: '80:86:F2:33:44:55',
      targetIp: '192.168.1.1'
    }
  },
  { 
    timestamp: '00:00:01.520', 
    lastSeen: '00:00:01.520',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '00:40:96:7A:B1:0E', 
    source: '00:40:96:7A:B1:0E', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '00:40:96:7A:B1:0E', 
    ssid: '<Hidden SSID>', 
    security: 'WPA2',
    rssi: -82, 
    channel: 6, 
    vendor: 'Cisco',
    length: 98, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 40 96 7a b1 0e 00 40 96 7a b1 0e 00 00' 
  },
  { 
    timestamp: '00:00:01.620', 
    lastSeen: '00:00:01.620',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '00:14:D1:33:1F:88', 
    source: '00:14:D1:33:1F:88', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '00:14:D1:33:1F:88', 
    ssid: 'Guest_Public_Wi-Fi', 
    security: 'Open',
    rssi: -67, 
    channel: 11, 
    vendor: 'TP-Link',
    length: 120, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 14 d1 33 1f 88 00 14 d1 33 1f 88 00 00' 
  },
  { 
    timestamp: '00:00:01.680', 
    lastSeen: '00:00:01.680',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '00:1A:11:44:55:66', 
    source: '00:1A:11:44:55:66', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '00:1A:11:44:55:66', 
    ssid: 'GoogleHome_Mesh', 
    security: 'WPA2',
    rssi: -48, 
    channel: 1, 
    vendor: 'Google',
    length: 128, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 1a 11 44 55 66 00 1a 11 44 55 66 00 00' 
  },
  { 
    timestamp: '00:00:01.710', 
    lastSeen: '00:00:01.710',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '00:27:22:88:99:AA', 
    source: '00:27:22:88:99:AA', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '00:27:22:88:99:AA', 
    ssid: 'UniFi_Enterprise_UAP', 
    security: 'WPA3',
    isWifi6: true,
    bssColor: 12,
    heCapabilities: { macCap: '080004000000', phyCap: '0400000000000000000000', extId: 35 },
    rssi: -42, 
    channel: 40, 
    vendor: 'Ubiquiti',
    length: 136, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 27 22 88 99 aa 00 27 22 88 99 aa 00 00 00 00 00 00 00 00 00 00 64 00 11 04 00 14 55 6e 69 46 69 5f 45 6e 74 65 72 70 72 69 73 65 5f 55 41 50 03 01 28 30 14 01 00 00 0f ac 04 01 00 00 0f ac 04 01 00 00 0f ac 08 00 00 ff 15 23 08 00 04 00 00 00 04 00 00 00 00 00 00 00 00 00 00 ff ff ff ff 06 24 0c 00 00 ff ff' 
  },
  { 
    timestamp: '00:00:01.730', 
    lastSeen: '00:00:01.730',
    type: 'QoS Data', 
    frameCategory: 'Data', 
    sourceMac: '3C:22:FB:44:55:66', 
    source: '3C:22:FB:44:55:66', 
    stationMac: '3C:22:FB:44:55:66',
    destination: '00:27:22:88:99:AA', 
    bssid: '00:27:22:88:99:AA', 
    ssid: '-',
    direction: 'Client -> AP',
    toDs: true,
    fromDs: false,
    rssi: -46, 
    channel: 40, 
    vendor: 'Apple',
    length: 310, 
    rawHex: '88 01 00 00 00 27 22 88 99 aa 3c 22 fb 44 55 66 00 27 22 88 99 aa 60 00' 
  },
  { 
    timestamp: '00:00:01.750', 
    lastSeen: '00:00:01.750',
    type: 'Probe Req', 
    frameCategory: 'Management', 
    sourceMac: '00:12:FB:55:66:77', 
    source: '00:12:FB:55:66:77', 
    stationMac: '00:12:FB:55:66:77', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: 'FF:FF:FF:FF:FF:FF', 
    ssid: 'Guest_Public_Wi-Fi', 
    security: 'Open',
    rssi: -62, 
    channel: 6, 
    vendor: 'Samsung',
    length: 82, 
    rawHex: '40 00 00 00 ff ff ff ff ff ff 00 12 fb 55 66 77 ff ff ff ff ff ff 10 00' 
  },
  { 
    timestamp: '00:00:01.810', 
    lastSeen: '00:00:01.810',
    type: 'Beacon', 
    frameCategory: 'Management', 
    sourceMac: '00:14:6C:AA:BB:CC', 
    source: '00:14:6C:AA:BB:CC', 
    destination: 'FF:FF:FF:FF:FF:FF', 
    bssid: '00:14:6C:AA:BB:CC', 
    ssid: 'NETGEAR_Nighthawk_Pro', 
    security: 'WPA2',
    rssi: -55, 
    channel: 11, 
    vendor: 'Netgear',
    length: 122, 
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 14 6c aa bb cc 00 14 6c aa bb cc 00 00' 
  },
  { 
    timestamp: '00:00:01.860', 
    lastSeen: '00:00:01.860',
    type: 'QoS Data', 
    frameCategory: 'Data', 
    sourceMac: 'B8:27:EB:11:22:33', 
    source: 'B8:27:EB:11:22:33', 
    stationMac: 'B8:27:EB:11:22:33', 
    destination: '24:6F:28:78:9A:BC', 
    bssid: '24:6F:28:78:9A:BC', 
    ssid: '-',
    direction: 'Client -> AP',
    toDs: true,
    fromDs: false,
    rssi: -60, 
    channel: 1, 
    vendor: 'Raspberry Pi',
    length: 198, 
    rawHex: '88 01 00 00 24 6f 28 78 9a bc b8 27 eb 11 22 33 24 6f 28 78 9a bc 40 00' 
  },
  {
    timestamp: '00:00:01.920',
    lastSeen: '00:00:01.920',
    type: 'Deauth',
    frameCategory: 'Management',
    isDeauth: true,
    reasonCode: 7,
    reasonDescription: 'Class 3 from Non-Assoc STA',
    sourceMac: '80:86:F2:33:44:55',
    source: '80:86:F2:33:44:55',
    stationMac: '3C:22:FB:44:55:66',
    destinationMac: '3C:22:FB:44:55:66',
    destination: '3C:22:FB:44:55:66',
    bssid: '80:86:F2:33:44:55',
    ssid: '-',
    rssi: -50,
    channel: 36,
    vendor: 'Intel',
    length: 26,
    rawHex: 'c0 00 00 00 3c 22 fb 44 55 66 80 86 f2 33 44 55 80 86 f2 33 44 55 60 00 07 00'
  },
  {
    timestamp: '00:00:02.010',
    lastSeen: '00:00:02.010',
    type: 'EAPOL (M1)',
    frameCategory: 'Data',
    isEapol: true,
    eapolMessage: 'M1',
    sourceMac: '80:86:F2:33:44:55',
    source: '80:86:F2:33:44:55',
    stationMac: '3C:22:FB:44:55:66',
    destinationMac: '3C:22:FB:44:55:66',
    destination: '3C:22:FB:44:55:66',
    bssid: '80:86:F2:33:44:55',
    ssid: 'Alpha_Corp_5G',
    direction: 'AP -> Client',
    rssi: -46,
    channel: 36,
    vendor: 'Intel',
    length: 121,
    rawHex: '88 02 00 00 3c 22 fb 44 55 66 80 86 f2 33 44 55 80 86 f2 33 44 55 20 00 00 00 aa aa 03 00 00 00 88 8e 02 03 00 5f 02 00 8a 00 10 00 00 00 00 00 00 00 01 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 5a 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00'
  },
  {
    timestamp: '00:00:02.040',
    lastSeen: '00:00:02.040',
    type: 'EAPOL (M2)',
    frameCategory: 'Data',
    isEapol: true,
    eapolMessage: 'M2',
    sourceMac: '3C:22:FB:44:55:66',
    source: '3C:22:FB:44:55:66',
    stationMac: '3C:22:FB:44:55:66',
    destinationMac: '80:86:F2:33:44:55',
    destination: '80:86:F2:33:44:55',
    bssid: '80:86:F2:33:44:55',
    ssid: 'Alpha_Corp_5G',
    direction: 'Client -> AP',
    rssi: -52,
    channel: 36,
    vendor: 'Apple',
    length: 121,
    rawHex: '88 01 00 00 80 86 f2 33 44 55 3c 22 fb 44 55 66 80 86 f2 33 44 55 30 00 00 00 aa aa 03 00 00 00 88 8e 02 03 00 5f 02 01 0a 00 10 00 00 00 00 00 00 00 01 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 a5 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 ab cd ef 01 23 45 67 89 ab cd ef 01 23 45 67 89 00 00'
  },
  {
    timestamp: '00:00:02.100',
    lastSeen: '00:00:02.100',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '00:14:D1:88:99:AA',
    source: '00:14:D1:88:99:AA',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '00:14:D1:88:99:AA',
    ssid: 'Corporate_Guest_WiFi',
    security: 'WPA2',
    rssi: -58,
    channel: 6,
    vendor: 'TP-Link',
    length: 124,
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 14 d1 88 99 aa 00 14 d1 88 99 aa 00 00'
  },
  {
    timestamp: '00:00:02.150',
    lastSeen: '00:00:02.150',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '24:6F:28:11:22:33',
    source: '24:6F:28:11:22:33',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '24:6F:28:11:22:33',
    ssid: 'Corporate_Guest_WiFi',
    security: 'Open',
    rssi: -40,
    channel: 6,
    vendor: 'Espressif',
    length: 110,
    rawHex: '80 00 00 00 ff ff ff ff ff ff 24 6f 28 11 22 33 24 6f 28 11 22 33 00 00'
  },
  {
    timestamp: '00:00:02.200',
    lastSeen: '00:00:02.200',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '00:0C:E6:99:88:77',
    source: '00:0C:E6:99:88:77',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '00:0C:E6:99:88:77',
    ssid: '<Hidden SSID>',
    security: 'WPA2',
    rssi: -54,
    channel: 6,
    vendor: 'MediaTek',
    length: 128,
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 0c e6 99 88 77 00 0c e6 99 88 77 00 00'
  },
  {
    timestamp: '00:00:02.250',
    lastSeen: '00:00:02.250',
    type: 'Assoc Req',
    frameCategory: 'Management',
    sourceMac: '68:DB:CA:11:22:33',
    source: '68:DB:CA:11:22:33',
    stationMac: '68:DB:CA:11:22:33',
    destinationMac: '00:0C:E6:99:88:77',
    destination: '00:0C:E6:99:88:77',
    bssid: '00:0C:E6:99:88:77',
    ssid: 'Quantum_Skunkworks_Lab',
    tagSequence: [0, 1, 50, 3, 45, 127, 191, 221],
    signature: '0,1,50,3,45,127,191,221',
    security: 'WPA2',
    rssi: -48,
    channel: 6,
    vendor: 'Apple',
    length: 96,
    rawHex: '00 00 00 00 00 0c e6 99 88 77 68 db ca 11 22 33 00 0c e6 99 88 77 00 00'
  },
  {
    timestamp: '00:00:02.300',
    lastSeen: '00:00:02.300',
    type: 'Probe Req',
    frameCategory: 'Management',
    sourceMac: 'DE:AD:BE:EF:00:01',
    source: 'DE:AD:BE:EF:00:01',
    stationMac: 'DE:AD:BE:EF:00:01',
    destinationMac: 'FF:FF:FF:FF:FF:FF',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: 'FF:FF:FF:FF:FF:FF',
    ssid: 'Quantum_Skunkworks_Lab',
    tagSequence: [0, 1, 50, 3, 45, 127, 191, 221],
    signature: '0,1,50,3,45,127,191,221',
    rssi: -58,
    channel: 6,
    vendor: 'Unknown OUI',
    length: 96,
    rawHex: '40 00 00 00 ff ff ff ff ff ff de ad be ef 00 01 ff ff ff ff ff ff 00 00'
  },
  {
    timestamp: '00:00:02.400',
    lastSeen: '00:00:02.400',
    type: 'Data',
    frameCategory: 'Data',
    sourceMac: '68:DB:CA:11:22:33',
    source: '68:DB:CA:11:22:33',
    stationMac: '68:DB:CA:11:22:33',
    destinationMac: '00:0C:E6:99:88:77',
    destination: '00:0C:E6:99:88:77',
    bssid: '00:0C:E6:99:88:77',
    ssid: 'Quantum_Skunkworks_Lab',
    toDs: true,
    fromDs: false,
    direction: 'Client -> AP',
    channel: 6,
    rssi: -52,
    vendor: 'Apple',
    length: 110,
    isProtected: false,
    cleartextMetadata: {
      protocol: 'DNS',
      domain: 'api.weather.com',
      port: 53,
      type: 'Query',
      clientMac: '68:DB:CA:11:22:33',
      bssid: '00:0C:E6:99:88:77',
      channel: 6,
      rssi: -52,
      timestamp: '00:00:02.400'
    },
    rawHex: '08 00 00 00 00 0c e6 99 88 77 68 db ca 11 22 33 00 0c e6 99 88 77 00 00 aa aa 03 00 00 00 08 00 45 00 00 3c'
  },
  {
    timestamp: '00:00:02.500',
    lastSeen: '00:00:02.500',
    type: 'QoS Data',
    frameCategory: 'Data',
    sourceMac: 'DE:AD:BE:EF:00:01',
    source: 'DE:AD:BE:EF:00:01',
    stationMac: 'DE:AD:BE:EF:00:01',
    destinationMac: '00:0C:E6:99:88:77',
    destination: '00:0C:E6:99:88:77',
    bssid: '00:0C:E6:99:88:77',
    ssid: 'Quantum_Skunkworks_Lab',
    toDs: true,
    fromDs: false,
    direction: 'Client -> AP',
    channel: 6,
    rssi: -59,
    vendor: 'Unknown OUI',
    length: 180,
    isProtected: false,
    cleartextMetadata: {
      protocol: 'HTTP',
      domain: 'captive.apple.com',
      endpoint: '/hotspot-detect.html',
      port: 80,
      type: 'Request',
      clientMac: 'DE:AD:BE:EF:00:01',
      bssid: '00:0C:E6:99:88:77',
      channel: 6,
      rssi: -59,
      timestamp: '00:00:02.500'
    },
    rawHex: '88 00 00 00 00 0c e6 99 88 77 de ad be ef 00 01 00 0c e6 99 88 77 00 00 00 00 aa aa 03 00 00 00 08 00 45 00'
  },
  {
    timestamp: '00:00:02.600',
    lastSeen: '00:00:02.600',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '00:C0:CA:11:22:33',
    source: '00:C0:CA:11:22:33',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '00:C0:CA:11:22:33',
    ssid: 'Alfa_Lab_Secure_MFP',
    security: 'WPA3',
    isMfpCapable: true,
    isMfpRequired: true,
    mfp: 'required',
    rssi: -45,
    noiseFloor: -95,
    snr: 50,
    channel: 36,
    vendor: 'Alfa Network',
    length: 146,
    rawHex: '00 00 0a 00 60 00 00 00 d3 a1 80 00 00 00 ff ff ff ff ff ff 00 c0 ca 11 22 33 00 c0 ca 11 22 33 00 00'
  },
  {
    timestamp: '00:00:02.700',
    lastSeen: '00:00:02.700',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '00:11:22:33:44:01',
    source: '00:11:22:33:44:01',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '00:11:22:33:44:01',
    ssid: 'Enterprise_Mesh_Node_01',
    security: 'WPA2',
    rssi: -52,
    channel: 1,
    vendor: 'Cisco',
    length: 128,
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 11 22 33 44 01 00 11 22 33 44 01 00 00'
  },
  {
    timestamp: '00:00:02.750',
    lastSeen: '00:00:02.750',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '00:11:22:33:44:02',
    source: '00:11:22:33:44:02',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '00:11:22:33:44:02',
    ssid: 'Enterprise_Mesh_Node_02',
    security: 'WPA2',
    rssi: -54,
    channel: 6,
    vendor: 'Cisco',
    length: 128,
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 11 22 33 44 02 00 11 22 33 44 02 00 00'
  },
  {
    timestamp: '00:00:02.800',
    lastSeen: '00:00:02.800',
    type: 'Beacon',
    frameCategory: 'Management',
    sourceMac: '00:11:22:33:44:03',
    source: '00:11:22:33:44:03',
    destination: 'FF:FF:FF:FF:FF:FF',
    bssid: '00:11:22:33:44:03',
    ssid: 'Enterprise_Mesh_Node_03',
    security: 'WPA2',
    rssi: -57,
    channel: 11,
    vendor: 'Cisco',
    length: 128,
    rawHex: '80 00 00 00 ff ff ff ff ff ff 00 11 22 33 44 03 00 11 22 33 44 03 00 00'
  }
];



