/**
 * Firmware Catalog Service
 * Handles fetching, caching, and searching the ESP Terminator firmware catalog (400+ presets)
 * Remote source: https://espterminator.com/firmware/manifest.json
 */

const REMOTE_MANIFEST_URL = 'https://espterminator.com/firmware/manifest.json';
const CACHE_KEY = 'skons_firmware_catalog_v1';
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 6; // 6 hours

// Curated high-priority offline fallback presets pointing to real upstream releases
export const BUNDLED_FALLBACK_PRESETS = [
  {
    name: 'Flipper WiFi Dev Board (Marauder)',
    device: 'ESP32-S2',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Upstream ESP32 Marauder Wi-Fi & BLE pentesting suite compiled for Flipper Zero WiFi Dev Board.',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_flipper.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_flipper.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_flipper.bin' }
    ],
    features: ['Wi-Fi Beacon Flood', 'Deauth Detector & Scanner', 'PMKID Capture', 'BLE Wardriving', 'PCAP to Flipper'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: false }
  },
  {
    name: 'Generic ESP32 (Marauder)',
    device: 'ESP32',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official ESP32 Marauder firmware for generic NodeMCU / WROOM boards with OLED & SD card support.',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_old_hardware.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_generic.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_old_hardware.bin' }
    ],
    features: ['Wi-Fi Packet Sniffer', 'Deauth Attack Engine', 'Probe Request Monitor', 'BLE Spam & Detection'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: false }
  },
  {
    name: 'ESP32-S3 Multiboard (Marauder)',
    device: 'ESP32-S3',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official Marauder for ESP32-S3 and Flipper Zero Multiboard S3 modules.',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_multiboardS3.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_multiboardS3.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_multiboardS3.bin' }
    ],
    features: ['Dual Core S3 Acceleration', 'High-Speed Packet Sniffing', 'RGB Status LED', 'USB CDC Serial'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'AWOK Mini (Bruce)',
    device: 'ESP32',
    type: 'bruce',
    version: '1.16.1',
    description: 'Multi-tool firmware for ESP32 with RF, IR, Wi-Fi, and BLE capabilities. Complete factory-merged binary for 0x0.',
    downloadUrl: 'https://github.com/BruceDevices/firmware/releases/download/1.16.1/Bruce-Awok-Mini.bin',
    files: [
      { name: 'Bruce-Awok-Mini.bin', address: '0x0', downloadUrl: 'https://github.com/BruceDevices/firmware/releases/download/1.16.1/Bruce-Awok-Mini.bin' }
    ],
    isMergedBinary: true,
    features: ['Sub-GHz & IR Control', 'Wi-Fi & BLE Toolkit', 'M5Stack / Cardputer / AWOK Support', 'SD File Explorer'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'CYD 2432S028 (Bruce)',
    device: 'ESP32',
    type: 'bruce',
    version: '1.16.1',
    description: 'Bruce portable RF/BLE multi-tool for the Cheap Yellow Display (ESP32 2.8" Touch TFT). Factory merged for 0x0.',
    downloadUrl: 'https://github.com/BruceDevices/firmware/releases/download/1.16.1/Bruce-CYD-2432S028.bin',
    files: [
      { name: 'Bruce-CYD-2432S028.bin', address: '0x0', downloadUrl: 'https://github.com/BruceDevices/firmware/releases/download/1.16.1/Bruce-CYD-2432S028.bin' }
    ],
    isMergedBinary: true,
    features: ['Full Touchscreen GUI', 'Sub-GHz / IR Transceiver', 'Wi-Fi Wardrive & Scan', 'RGB LED & Beeper'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'WLED ESP32',
    device: 'ESP32',
    type: 'iot',
    version: 'v0.14.4',
    description: 'Fast and feature-rich implementation of an ESP8266/ESP32 web server to control NeoPixel (WS2812B, WS2811, SK6812) LED strips.',
    downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v0.14.4/WLED_0.14.4_ESP32.bin',
    files: [
      { name: 'WLED_0.14.4_ESP32.bin', address: '0x10000', downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v0.14.4/WLED_0.14.4_ESP32.bin' }
    ],
    features: ['100+ Visual Effects', 'E1.31 / DMX / Art-Net Sync', 'Home Assistant & Alexa Support', 'Web UI Controller'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'MicroPython ESP32',
    device: 'ESP32',
    type: 'interpreter',
    version: 'v1.23.0',
    description: 'Official Python 3 runtime optimized to run on ESP32 boards with interactive hardware REPL.',
    downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20240602-v1.23.0.bin',
    files: [
      { name: 'ESP32_GENERIC-v1.23.0.bin', address: '0x1000', downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20240602-v1.23.0.bin' }
    ],
    isMergedBinary: true,
    features: ['Python 3 REPL over Serial', 'Hardware GPIO / SPI / I2C APIs', 'Micro-file System', 'Low Power Sleep'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
  }
];

let inMemoryCatalog = null;

export function getCachedCatalogSync() {
  if (inMemoryCatalog && inMemoryCatalog.length > 0) {
    return inMemoryCatalog;
  }
  return null;
}

export async function fetchFirmwareCatalog(forceRefresh = false) {
  // Check in-memory cache first
  if (!forceRefresh && inMemoryCatalog && inMemoryCatalog.length > 0) {
    return { options: inMemoryCatalog, fromCache: true, total: inMemoryCatalog.length };
  }

  // Fetch remote manifest
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout guard

    const res = await fetch(REMOTE_MANIFEST_URL, { 
      cache: 'default',
      signal: controller.signal 
    });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const data = await res.json();
    const options = Array.isArray(data.options) ? data.options : [];
    
    if (options.length > 0) {
      inMemoryCatalog = options;
    }

    return { options: options.length > 0 ? options : BUNDLED_FALLBACK_PRESETS, fromCache: false, total: options.length };
  } catch (err) {
    console.warn('Remote manifest fetch failed/timed out, utilizing bundled fallback presets:', err);
    inMemoryCatalog = BUNDLED_FALLBACK_PRESETS;
    return { options: BUNDLED_FALLBACK_PRESETS, fromCache: true, total: BUNDLED_FALLBACK_PRESETS.length, error: err.message };
  }
}

/**
 * Downloads a firmware binary file using a robust multi-proxy fallback chain to bypass CORS.
 * Automatically handles GitHub release redirects and relative manifest paths.
 */
export async function downloadFirmwareBinary(rawUrl, onProgress) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Invalid download URL provided');
  }

  // Normalize URL: resolve relative paths against espterminator.com
  let targetUrl = rawUrl.trim();
  if (targetUrl.startsWith('./') || targetUrl.startsWith('/')) {
    targetUrl = 'https://espterminator.com/' + targetUrl.replace(/^\.?\//, '');
  }

  const strategies = [];

  // GitHub Releases require a CORS proxy in web browsers
  if (targetUrl.includes('github.com') || targetUrl.includes('githubusercontent.com')) {
    // 1. ESP Terminator custom-domain proxy (fast Cloudflare Worker with server-side GH token)
    strategies.push(`https://proxy.espterminator.com/?url=${encodeURIComponent(targetUrl)}`);
    // 2. Jubilee Workers proxy backup
    strategies.push(`https://esp-terminator-github-proxy.jubilee333.workers.dev/?url=${encodeURIComponent(targetUrl)}`);
  }

  // 3. corsproxy.io fallback
  strategies.push(`https://corsproxy.io/?${encodeURIComponent(targetUrl)}`);

  // 4. Direct fetch (for origins allowing CORS like raw github or custom domains)
  strategies.push(targetUrl);

  let lastError = null;

  for (const fetchUrl of strategies) {
    try {
      if (onProgress) onProgress(`Contacting mirror: ${fetchUrl.slice(0, 45)}...`);
      const res = await fetch(fetchUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      const arrayBuf = await res.arrayBuffer();
      if (arrayBuf && arrayBuf.byteLength > 0) {
        return {
          data: new Uint8Array(arrayBuf),
          size: arrayBuf.byteLength
        };
      }
    } catch (err) {
      lastError = err;
      console.warn(`Proxy strategy failed for ${fetchUrl.slice(0, 50)}:`, err.message);
    }
  }

  throw new Error(`Failed to download binary from all mirrors: ${lastError?.message || 'Network error'}`);
}
