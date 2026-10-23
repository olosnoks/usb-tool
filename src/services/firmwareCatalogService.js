/**
 * Firmware Catalog Service
 * Handles fetching, caching, and searching the ESP Terminator firmware catalog (400+ presets)
 * Remote source: https://espterminator.com/firmware/manifest.json
 */

const REMOTE_MANIFEST_URL = 'https://espterminator.com/firmware/manifest.json';
const CACHE_KEY = 'skons_firmware_catalog_v1';
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 6; // 6 hours

// Curated high-priority offline fallback presets
export const BUNDLED_FALLBACK_PRESETS = [
  {
    name: 'ESP32 Marauder',
    device: 'ESP32',
    type: 'marauder',
    version: 'v0.13.10',
    description: 'Suite of Wi-Fi & Bluetooth offensive/defensive analysis tools for ESP32 with SD card logging.',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v0.13.10/esp32_marauder_v0_13_10_20231208_flipper.bin',
    files: [
      { name: 'bootloader.bin', address: '0x1000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v0.13.10/bootloader.bin' },
      { name: 'partitions.bin', address: '0x8000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v0.13.10/partitions.bin' },
      { name: 'esp32_marauder.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v0.13.10/esp32_marauder_v0_13_10_20231208_flipper.bin' }
    ],
    features: ['Wi-Fi Beacon Flood', 'Deauth Detector & Scanner', 'PMKID Capture', 'BLE Wardriving', 'PCAP to SD card'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'Meshtastic ESP32',
    device: 'ESP32',
    type: 'meshtastic',
    version: 'v2.5.4',
    description: 'Off-grid decentralized mesh communication firmware for LoRa & Wi-Fi/BLE devices.',
    downloadUrl: 'https://github.com/meshtastic/firmware/releases/download/v2.5.4.195cb9a/firmware-esp32-2.5.4.195cb9a.bin',
    files: [
      { name: 'meshtastic-esp32-factory.bin', address: '0x0', downloadUrl: 'https://github.com/meshtastic/firmware/releases/download/v2.5.4.195cb9a/firmware-esp32-2.5.4.195cb9a.bin' }
    ],
    isMergedBinary: true,
    features: ['Encrypted Mesh Networking', 'GPS Location Sharing', 'BLE / Wi-Fi Mobile App Gateway', 'Long Range LoRa Packets'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'Bruce ESP32-S3',
    device: 'ESP32-S3',
    type: 'bruce',
    version: 'v1.6.2',
    description: 'Multi-tool firmware for M5Stack, Cardputer, and CYD boards with RF, IR, Wi-Fi, and BLE capabilities.',
    downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/v1.6.2/bruce-cardputer.bin',
    files: [
      { name: 'bruce-cardputer.bin', address: '0x0', downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/v1.6.2/bruce-cardputer.bin' }
    ],
    isMergedBinary: true,
    features: ['Sub-GHz & IR Control', 'Wi-Fi & BLE Toolkit', 'M5Stack Cardputer Keyboard Support', 'SD File Explorer'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'M5Launcher',
    device: 'ESP32-S3',
    type: 'launcher',
    version: 'v2.2.0',
    description: 'Multi-bootloader firmware manager that downloads and boots multiple binaries directly from an SD card or Wi-Fi OTA.',
    downloadUrl: 'https://github.com/bmorcelli/M5Launcher/releases/download/v2.2.0/M5Launcher-S3.bin',
    files: [
      { name: 'M5Launcher-S3.bin', address: '0x0', downloadUrl: 'https://github.com/bmorcelli/M5Launcher/releases/download/v2.2.0/M5Launcher-S3.bin' }
    ],
    isMergedBinary: true,
    features: ['OTA Binary Downloader', 'Multi-boot from SD Card', 'Wi-Fi Portal', 'Auto-recovery'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'WLED ESP32',
    device: 'ESP32',
    type: 'iot',
    version: 'v0.14.4',
    description: 'Fast and feature-rich implementation of an ESP8266/ESP32 web server to control NeoPixel (WS2812B, WS2811, SK6812) LED strips.',
    downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v0.14.4/WLED_0.14.4_ESP32.bin',
    files: [
      { name: 'WLED_ESP32.bin', address: '0x10000', downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v0.14.4/WLED_0.14.4_ESP32.bin' }
    ],
    features: ['100+ Visual Effects', 'E1.31 / DMX / Art-Net Sync', 'Home Assistant & Alexa Support', 'Web UI Controller'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'MicroPython ESP32',
    device: 'ESP32',
    type: 'interpreter',
    version: 'v1.23.0',
    description: 'Official Python 3 runtime optimized to run on microcontroller boards with hardware REPL.',
    downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20240602-v1.23.0.bin',
    files: [
      { name: 'micropython-esp32.bin', address: '0x1000', downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20240602-v1.23.0.bin' }
    ],
    isMergedBinary: true,
    features: ['Python 3 REPL over Serial', 'Hardware GPIO / SPI / I2C APIs', 'Micro-file System', 'Low Power Sleep'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
  }
];

export async function fetchFirmwareCatalog(forceRefresh = false) {
  // Check local cache
  if (!forceRefresh) {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const { timestamp, options } = JSON.parse(cached);
        if (Date.now() - timestamp < CACHE_EXPIRY_MS && Array.isArray(options) && options.length > 0) {
          return { options, fromCache: true, total: options.length };
        }
      }
    } catch (e) {
      console.warn('Catalog cache read error:', e);
    }
  }

  // Fetch remote manifest
  try {
    const res = await fetch(REMOTE_MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    const options = Array.isArray(data.options) ? data.options : [];
    
    // Save to cache
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        options
      }));
    } catch (storageErr) {
      console.warn('Failed to cache catalog to localStorage:', storageErr);
    }

    return { options, fromCache: false, total: options.length };
  } catch (err) {
    console.warn('Remote manifest fetch failed, utilizing bundled fallback presets:', err);
    return { options: BUNDLED_FALLBACK_PRESETS, fromCache: true, total: BUNDLED_FALLBACK_PRESETS.length, error: err.message };
  }
}
