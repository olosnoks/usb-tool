/**
 * Firmware Catalog Service
 * Handles fetching, caching, and searching the ESP Terminator firmware catalog (400+ presets)
 * Remote source: https://espterminator.com/firmware/manifest.json
 */

const REMOTE_MANIFEST_URL = 'https://espterminator.com/firmware/manifest.json';
const CACHE_KEY = 'skons_firmware_catalog_v1';
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 6; // 6 hours

/// Authoritative Piglet boards and builds directly verified against olosnoks.github.io/piglet and Hamspiced/piglet
export const PIGLET_BOARDS = [
  {
    id: 'freenove-s3-cyd',
    boardName: 'Freenove S3 CYD',
    device: 'ESP32-S3',
    flashSize: '16 MB',
    display: '2.4" Touch Display',
    description: "2.4 GHz scanning, GPS, SD logging, 2.4″ touch display. The main CYD build from olosnoks/piglet.",
    features: ['HAM UI4 Modern Interface', '2.4" Touch Display', 'GPS Wardriving & WiGLE CSV', 'SD Card Logging', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true },
    builds: {
      skon: [
        {
          id: 'freenove-s3-cyd-ui4',
          name: "Piglet — Freenove S3 CYD (HAM UI4)",
          fwName: 'HAM UI4 Theme',
          version: 'main+fe55704',
          fileName: 'freenove-s3-cyd-ham-ui4.bin',
          downloadUrl: 'https://olosnoks.github.io/piglet/firmware/freenove-s3-cyd-ham-ui4.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/freenove-s3-cyd-ham-ui4.json',
          repoUrl: 'https://github.com/olosnoks/piglet',
          websiteUrl: 'https://olosnoks.github.io/piglet/',
          isMergedBinary: true,
          files: [{ name: 'freenove-s3-cyd-ham-ui4.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/freenove-s3-cyd-ham-ui4.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
        }
      ]
    }
  },
  {
    id: 'guition-jc8048w550',
    boardName: 'Guition JC8048W550',
    device: 'ESP32-S3',
    flashSize: '16 MB',
    display: '5" 800x480 RGB IPS (GT911)',
    description: "Same core as the Freenove build on a 5″ RGB IPS panel with GT911 touch.",
    features: ['5" 800x480 High-Res IPS', 'GT911 Capacitive Touch', 'GPS Wardriving & WiGLE CSV', 'SD Card Logging', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true },
    builds: {
      skon: [
        {
          id: 'guition-jc8048w550-s3',
          name: "Piglet — Guition JC8048W550 (5\" 800x480)",
          fwName: '5" 800x480 RGB IPS GT911',
          version: 'main+fe55704',
          fileName: 'guition-jc8048w550.bin',
          downloadUrl: 'https://olosnoks.github.io/piglet/firmware/guition-jc8048w550.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/guition-jc8048w550.json',
          repoUrl: 'https://github.com/olosnoks/piglet',
          websiteUrl: 'https://olosnoks.github.io/piglet/',
          isMergedBinary: true,
          files: [{ name: 'guition-jc8048w550.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/guition-jc8048w550.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
        }
      ]
    }
  },
  {
    id: 'xiao-c5',
    boardName: 'Seeed Studio XIAO C5',
    device: 'ESP32-C5',
    flashSize: '8 MB',
    display: 'Dual-Band 2.4/5GHz + GPS',
    description: "Piglet Core — GPS, SD, WiGLE logging, mesh. Dual-band 2.4GHz & 5GHz Wi-Fi 6.",
    note: "C5 Hardware Note: Flash at 115200 baud. The C5 USB-Serial/JTAG drops when the stub loader runs in WebSerial. If browser disconnects, flash in terminal: esptool --chip esp32c5 --no-stub write-flash 0x0 <file>.bin",
    features: ['Dual-Band 2.4GHz & 5GHz Wi-Fi 6', 'GPS & WiGLE CSV Logging', 'ESP-Now Mesh Protocol', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true },
    builds: {
      skon: [
        {
          id: 'xiao-c5-skon',
          name: "Piglet Core — XIAO C5 (skon's fork)",
          fwName: "skon's fork (GPS + Mesh)",
          version: 'main+fe55704',
          fileName: 'xiao_c5.bin',
          downloadUrl: 'https://olosnoks.github.io/piglet/firmware/xiao_c5.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/xiao_c5.json',
          repoUrl: 'https://github.com/olosnoks/piglet',
          websiteUrl: 'https://olosnoks.github.io/piglet/',
          isMergedBinary: true,
          files: [{ name: 'xiao_c5.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/xiao_c5.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true }
        }
      ],
      ham: [
        {
          id: 'xiao-c5-ham',
          name: "Piglet Core — XIAO C5 (Hamspiced Official v2.7)",
          fwName: 'v2.7 Wardrift Official',
          version: 'v2.7',
          fileName: 'Piglet.ino.merged.bin',
          downloadUrl: 'https://github.com/Hamspiced/piglet/releases/download/v2.7/Piglet.ino.merged.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/xiao_c5-ham.json',
          repoUrl: 'https://github.com/Hamspiced/piglet',
          websiteUrl: 'https://github.com/Hamspiced/piglet',
          isMergedBinary: true,
          files: [{ name: 'Piglet.ino.merged.bin', address: '0x0', downloadUrl: 'https://github.com/Hamspiced/piglet/releases/download/v2.7/Piglet.ino.merged.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true }
        }
      ]
    }
  },
  {
    id: 'pigletnode-c5',
    boardName: 'PigletNode C5',
    device: 'ESP32-C5',
    flashSize: '8 MB',
    display: 'Headless Dual-Band Node',
    description: "XIAO C5 mesh node — boots straight into ESP-Now node mode. Dual-band 2.4GHz & 5GHz, headless.",
    note: "C5 Hardware Note: Flash at 115200 baud. If stub drops, run: esptool --chip esp32c5 --no-stub write-flash 0x0 pigletnode_c5.bin",
    features: ['Dual-Band 2.4G/5G Mesh Node', 'Autonomous ESP-Now Boot', 'Headless Low-Power Sniffer', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true },
    builds: {
      skon: [
        {
          id: 'pigletnode-c5-skon',
          name: "PigletNode C5 — (skon's fork)",
          fwName: "skon's fork (Headless Mesh)",
          version: 'main+fe55704',
          fileName: 'pigletnode_c5.bin',
          downloadUrl: 'https://olosnoks.github.io/piglet/firmware/pigletnode_c5.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/pigletnode_c5.json',
          repoUrl: 'https://github.com/olosnoks/piglet',
          websiteUrl: 'https://olosnoks.github.io/piglet/',
          isMergedBinary: true,
          files: [{ name: 'pigletnode_c5.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/pigletnode_c5.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true }
        }
      ],
      ham: [
        {
          id: 'pigletnode-c5-ham',
          name: "PigletNode C5 — (Hamspiced Official v2.7)",
          fwName: 'v2.7 Official PigletNode',
          version: 'v2.7',
          fileName: 'PigletNode.ino.merged.bin',
          downloadUrl: 'https://github.com/Hamspiced/piglet/releases/download/v2.7/PigletNode.ino.merged.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/pigletnode_c5-ham.json',
          repoUrl: 'https://github.com/Hamspiced/piglet',
          websiteUrl: 'https://github.com/Hamspiced/piglet',
          isMergedBinary: true,
          files: [{ name: 'PigletNode.ino.merged.bin', address: '0x0', downloadUrl: 'https://github.com/Hamspiced/piglet/releases/download/v2.7/PigletNode.ino.merged.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true }
        }
      ]
    }
  },
  {
    id: 'tdongle-c5',
    boardName: 'LilyGo T-Dongle C5',
    device: 'ESP32-C5',
    flashSize: '8 MB',
    display: '0.96" ST7735 Color TFT + APA102 LED',
    description: "USB-A dongle — 0.96″ ST7735 TFT, APA102 LED, GPS, SD, dual-band. Flashes the official Piglet T-Dongle build; the fork tracks upstream for this board.",
    note: "C5 Hardware Note: Flash at 115200 baud. If stub drops, run: esptool --chip esp32c5 --no-stub write-flash 0x0 TDongleC5_Piglet.ino.merged.bin",
    features: ['0.96" Color ST7735 TFT', 'APA102 Status RGB LED', 'USB-A Dongle Form Factor', 'Dual-Band 2.4G/5G', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true },
    builds: {
      ham: [
        {
          id: 'tdongle-c5-ham',
          name: "Piglet — LilyGo T-Dongle C5 (Hamspiced Official v2.7)",
          fwName: 'v2.7 Official T-Dongle USB',
          version: 'v2.7',
          fileName: 'TDongleC5_Piglet.ino.merged.bin',
          downloadUrl: 'https://github.com/Hamspiced/piglet/releases/download/v2.7/TDongleC5_Piglet.ino.merged.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/tdongle_c5-ham.json',
          repoUrl: 'https://github.com/Hamspiced/piglet',
          websiteUrl: 'https://github.com/Hamspiced/piglet',
          isMergedBinary: true,
          files: [{ name: 'TDongleC5_Piglet.ino.merged.bin', address: '0x0', downloadUrl: 'https://github.com/Hamspiced/piglet/releases/download/v2.7/TDongleC5_Piglet.ino.merged.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: true }
        }
      ]
    }
  },
  {
    id: 'esp32c3-oled',
    boardName: 'PigletNode C3 (0.42" OLED)',
    device: 'ESP32-C3',
    flashSize: '4 MB',
    display: '0.42" Mini OLED',
    description: "Minimal mesh node — boots straight into ESP-Now node mode. No GPS/SD needed.",
    features: ['0.42" OLED Status Screen', 'ESP32-C3 RISC-V Node', 'Autonomous ESP-Now Boot', 'Pocket Sensor Node', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true },
    builds: {
      skon: [
        {
          id: 'esp32c3-oled-skon',
          name: "PigletNode C3 — 0.42\" OLED (skon's fork)",
          fwName: '0.42" OLED Node',
          version: 'main+fe55704',
          fileName: 'esp32c3_oled.bin',
          downloadUrl: 'https://olosnoks.github.io/piglet/firmware/esp32c3_oled.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/esp32c3_oled.json',
          repoUrl: 'https://github.com/olosnoks/piglet',
          websiteUrl: 'https://olosnoks.github.io/piglet/',
          isMergedBinary: true,
          files: [{ name: 'esp32c3_oled.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/esp32c3_oled.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
        }
      ]
    }
  },
  {
    id: 'waveshare-c6',
    boardName: 'Waveshare C6 Mini (1.47" LCD)',
    device: 'ESP32-C6',
    flashSize: '4 MB',
    display: '1.47" Color LCD (ST7789)',
    description: "Waveshare ESP32-C6 1.47″ LCD — ST7789 display, SD, GPS.",
    features: ['1.47" Color ST7789 LCD', 'ESP32-C6 Wi-Fi 6 & BLE 5', 'GPS & SD Logging', 'Handheld Form Factor', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true },
    builds: {
      skon: [
        {
          id: 'waveshare-c6-skon',
          name: "Piglet — Waveshare C6 Mini 1.47\" LCD (skon's fork)",
          fwName: '1.47" LCD Handheld',
          version: 'main+fe55704',
          fileName: 'waveshare_c6.bin',
          downloadUrl: 'https://olosnoks.github.io/piglet/firmware/waveshare_c6.bin',
          manifestUrl: 'https://olosnoks.github.io/piglet/manifests/waveshare_c6.json',
          repoUrl: 'https://github.com/olosnoks/piglet',
          websiteUrl: 'https://olosnoks.github.io/piglet/',
          isMergedBinary: true,
          files: [{ name: 'waveshare_c6.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/waveshare_c6.bin' }],
          flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
        }
      ]
    }
  }
];

// Flat lookup variants by source for backwards-compatibility
export const PIGLET_VARIANTS = {
  skon: PIGLET_BOARDS.flatMap(b => (b.builds.skon || []).map(build => ({
    ...b,
    ...build,
    source: 'skon',
    boardName: b.boardName,
    fwName: build.fwName,
    name: build.name,
    type: 'piglet',
    note: b.note
  }))),
  ham: PIGLET_BOARDS.flatMap(b => (b.builds.ham || []).map(build => ({
    ...b,
    ...build,
    source: 'ham',
    boardName: b.boardName,
    fwName: build.fwName,
    name: build.name,
    type: 'piglet',
    note: b.note
  })))
};

// Curated high-priority offline fallback presets pointing to real upstream releases
export const BUNDLED_FALLBACK_PRESETS = [
  // --- 1 Unified Interactive Piglet Wardriver Card ---
  {
    name: 'Piglet Wardriver Suite',
    isPigletSuite: true,
    device: 'ESP32-S3 / C5 / C3 / C6',
    supportedChips: ['ESP32-S3', 'ESP32-C5', 'ESP32-C3', 'ESP32-C6', 'ESP32'],
    type: 'piglet',
    version: 'v2.7',
    description: "Next-generation Wi-Fi & BLE wardriving firmware suite with GPS tracking, WiGLE CSV, and PCAP capture. Toggle between skon's customized forks and Hamspiced's official releases across all supported boards.",
    websiteUrl: 'https://olosnoks.github.io/piglet/',
    downloadUrl: 'https://olosnoks.github.io/piglet/firmware/freenove-s3-cyd-ham-ui4.bin',
    files: [
      { name: 'freenove-s3-cyd-ham-ui4.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/freenove-s3-cyd-ham-ui4.bin' }
    ],
    isMergedBinary: true,
    features: ['GPS Wardriving & WiGLE CSV', 'Wi-Fi & BLE Recon', 'Dual-Band 2.4/5GHz (C5)', 'PCAP Packet Capture', 'Merged 0x0 Binary'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },

  // --- Upstream Featured Multi-Tools (All Official Repos & Latest Releases) ---
  // ESP32 Marauder (justcallmekoko/ESP32Marauder v1.19.2)
  {
    name: 'Flipper WiFi Dev Board (Marauder)',
    device: 'ESP32-S2',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official ESP32 Marauder Wi-Fi & BLE pentesting suite compiled for Flipper Zero WiFi Dev Board.',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_flipper.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_flipper.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_flipper.bin' }
    ],
    features: ['Wi-Fi Beacon Flood', 'Deauth Detector & Scanner', 'PMKID Capture', 'BLE Wardriving', 'PCAP to Flipper'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: false }
  },
  {
    name: 'ESP32-S3 Multiboard (Marauder)',
    device: 'ESP32-S3',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official Marauder for ESP32-S3 and Flipper Zero Multiboard S3 modules with dual-core acceleration.',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_multiboardS3.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_multiboardS3.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_multiboardS3.bin' }
    ],
    features: ['Dual Core S3 Acceleration', 'High-Speed Packet Sniffing', 'RGB Status LED', 'USB CDC Serial'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'CYD 2432S028 (Marauder)',
    device: 'ESP32',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official Marauder compiled for the Cheap Yellow Display (CYD 2.8" Touch Screen).',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_cyd_2432S028.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_cyd_2432S028.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_cyd_2432S028.bin' }
    ],
    features: ['Touchscreen GUI', 'Packet Monitor', 'Deauth & Probe Sniffer', 'SD Card PCAP'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'Generic ESP32 (Marauder)',
    device: 'ESP32',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official ESP32 Marauder firmware for generic NodeMCU / WROOM boards with OLED & SD card support.',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_old_hardware.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_generic.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_old_hardware.bin' }
    ],
    features: ['Wi-Fi Packet Sniffer', 'Deauth Attack Engine', 'Probe Request Monitor', 'BLE Spam & Detection'],
    flashConfig: { flashMode: 'keep', baudRate: 115200, eraseAll: false }
  },
  {
    name: 'Dual Mini C5 (Marauder)',
    device: 'ESP32-C5',
    type: 'marauder',
    version: 'v1.19.2',
    description: 'Official ESP32 Marauder Wi-Fi 6 & dual-band pentesting firmware for ESP32-C5 Dual Mini.',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_dual_mini_c5.bin',
    files: [
      { name: 'esp32_marauder_v1_19_2_dual_mini_c5.bin', address: '0x10000', downloadUrl: 'https://github.com/justcallmekoko/ESP32Marauder/releases/download/v1.19.2/esp32_marauder_v1_19_2_20261023_dual_mini_c5.bin' }
    ],
    features: ['Dual-Band 2.4/5GHz Wi-Fi 6', 'RISC-V High Speed Capture', 'Compact Form Factor', 'Raw Frame Injection'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: false }
  },

  // Bruce Multi-Tool (pr3y/Bruce v1.16.1)
  {
    name: 'CYD 2432S028 (Bruce)',
    device: 'ESP32',
    type: 'bruce',
    version: '1.16.1',
    description: 'Official Bruce multi-tool firmware for Cheap Yellow Display (ESP32 2.8" Touch Screen). Factory merged for 0x0.',
    websiteUrl: 'https://github.com/pr3y/Bruce',
    downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-CYD-2432S028.bin',
    files: [
      { name: 'Bruce-CYD-2432S028.bin', address: '0x0', downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-CYD-2432S028.bin' }
    ],
    isMergedBinary: true,
    features: ['Full Touchscreen GUI', 'Sub-GHz / IR Transceiver', 'Wi-Fi Wardrive & Scan', 'RGB LED & Beeper'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'AWOK Mini (Bruce)',
    device: 'ESP32',
    type: 'bruce',
    version: '1.16.1',
    description: 'Official Bruce multi-tool for AWOK Mini hardware with Sub-GHz RF, IR, Wi-Fi, and BLE capabilities.',
    websiteUrl: 'https://github.com/pr3y/Bruce',
    downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-Awok-Mini.bin',
    files: [
      { name: 'Bruce-Awok-Mini.bin', address: '0x0', downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-Awok-Mini.bin' }
    ],
    isMergedBinary: true,
    features: ['Sub-GHz & IR Control', 'Wi-Fi & BLE Toolkit', 'SD File Explorer', 'Factory Merged 0x0'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'M5Stack Cardputer (Bruce)',
    device: 'ESP32-S3',
    type: 'bruce',
    version: '1.16.1',
    description: 'Official Bruce multi-tool compiled for M5Stack Cardputer with full keyboard, display, and speaker support.',
    websiteUrl: 'https://github.com/pr3y/Bruce',
    downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-m5stack-cardputer.bin',
    files: [
      { name: 'Bruce-m5stack-cardputer.bin', address: '0x0', downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-m5stack-cardputer.bin' }
    ],
    isMergedBinary: true,
    features: ['Keyboard Driven UI', 'ESP32-S3 Performance', 'Wi-Fi / BLE Pentesting', 'Factory Merged 0x0'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
  },
  {
    name: 'ESP32-C5 (Bruce)',
    device: 'ESP32-C5',
    type: 'bruce',
    version: '1.16.1',
    description: 'Official Bruce multi-tool for ESP32-C5 dual-band Wi-Fi 6 RISC-V targets.',
    websiteUrl: 'https://github.com/pr3y/Bruce',
    downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-esp32-c5.bin',
    files: [
      { name: 'Bruce-esp32-c5.bin', address: '0x0', downloadUrl: 'https://github.com/pr3y/Bruce/releases/download/1.16.1/Bruce-esp32-c5.bin' }
    ],
    isMergedBinary: true,
    features: ['ESP32-C5 Dual-Band Support', 'RF Toolkit', 'Factory Merged 0x0'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
  },

  // WLED Lighting (Aircoookie/WLED v16.0.1)
  {
    name: 'WLED ESP32 Standard',
    device: 'ESP32',
    type: 'iot',
    version: 'v16.0.1',
    description: 'Official fast web server to control NeoPixel (WS2812B, WS2811, SK6812) LED strips with 100+ effects.',
    websiteUrl: 'https://github.com/Aircoookie/WLED',
    downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v16.0.1/WLED_16.0.1_ESP32.bin',
    files: [
      { name: 'WLED_16.0.1_ESP32.bin', address: '0x10000', downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v16.0.1/WLED_16.0.1_ESP32.bin' }
    ],
    features: ['100+ Visual Effects', 'E1.31 / DMX / Art-Net Sync', 'Home Assistant & Alexa Support', 'Web UI Controller'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'WLED ESP32-S3',
    device: 'ESP32-S3',
    type: 'iot',
    version: 'v16.0.1',
    description: 'Official WLED firmware optimized for high-performance ESP32-S3 boards with 8MB flash.',
    websiteUrl: 'https://github.com/Aircoookie/WLED',
    downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v16.0.1/WLED_16.0.1_ESP32-S3_8MB_qspi.bin',
    files: [
      { name: 'WLED_16.0.1_ESP32-S3_8MB_qspi.bin', address: '0x10000', downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v16.0.1/WLED_16.0.1_ESP32-S3_8MB_qspi.bin' }
    ],
    features: ['High-Performance S3', 'Multi-Strip Parallel Output', 'Sound Reactive Audio Sync'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: false }
  },
  {
    name: 'WLED ESP32-C3',
    device: 'ESP32-C3',
    type: 'iot',
    version: 'v16.0.1',
    description: 'Official WLED firmware for ultra-compact ESP32-C3 RISC-V smart home LED controllers.',
    websiteUrl: 'https://github.com/Aircoookie/WLED',
    downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v16.0.1/WLED_16.0.1_ESP32-C3.bin',
    files: [
      { name: 'WLED_16.0.1_ESP32-C3.bin', address: '0x10000', downloadUrl: 'https://github.com/Aircoookie/WLED/releases/download/v16.0.1/WLED_16.0.1_ESP32-C3.bin' }
    ],
    features: ['Compact RISC-V C3', 'Ultra Low Power', 'Full WLED Web Interface'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: false }
  },

  // MicroPython (micropython/micropython v1.23.0)
  {
    name: 'MicroPython ESP32 Generic',
    device: 'ESP32',
    type: 'interpreter',
    version: 'v1.23.0',
    description: 'Official Python 3 runtime for standard ESP32 boards with interactive hardware REPL and filesystem.',
    websiteUrl: 'https://micropython.org',
    downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20240602-v1.23.0.bin',
    files: [
      { name: 'ESP32_GENERIC-v1.23.0.bin', address: '0x1000', downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC-20240602-v1.23.0.bin' }
    ],
    isMergedBinary: true,
    features: ['Python 3 REPL over Serial', 'Hardware GPIO / SPI / I2C APIs', 'Micro-file System', 'Low Power Sleep'],
    flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
  },
  {
    name: 'MicroPython ESP32-S3',
    device: 'ESP32-S3',
    type: 'interpreter',
    version: 'v1.23.0',
    description: 'Official Python 3 runtime compiled for ESP32-S3 boards with USB CDC REPL and vector instructions.',
    websiteUrl: 'https://micropython.org',
    downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC_S3-20240602-v1.23.0.bin',
    files: [
      { name: 'ESP32_GENERIC_S3-v1.23.0.bin', address: '0x0', downloadUrl: 'https://micropython.org/resources/firmware/ESP32_GENERIC_S3-20240602-v1.23.0.bin' }
    ],
    isMergedBinary: true,
    features: ['Native USB CDC REPL', 'ESP32-S3 Dual Core', 'Python 3 Standard Library'],
    flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
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

  // 1. Try local bundled manifest first (same-origin, 0 CORS issues, instant load)
  try {
    const baseUrl = (typeof import.meta !== 'undefined' && import.meta.env?.BASE_URL) || './';
    const localManifestUrl = `${baseUrl.replace(/\/$/, '')}/firmware-manifest.json`;
    
    const localRes = await fetch(localManifestUrl, { cache: 'default' });
    if (localRes.ok) {
      const data = await localRes.json();
      const remoteOptions = Array.isArray(data.options) ? data.options : [];
      if (remoteOptions.length > 0) {
        const existingNames = new Set(BUNDLED_FALLBACK_PRESETS.map(p => p.name.toLowerCase()));
        const merged = [
          ...BUNDLED_FALLBACK_PRESETS,
          ...remoteOptions.filter(opt => !existingNames.has(opt.name?.toLowerCase()))
        ];

        inMemoryCatalog = merged;
        return { options: merged, fromCache: false, total: merged.length };
      }
    }
  } catch (localErr) {
    console.warn('Local manifest fetch notice:', localErr.message);
  }

  // 2. Fallback to proxy mirror or direct remote URL
  const manifestMirrors = [
    `https://corsproxy.io/?${encodeURIComponent(REMOTE_MANIFEST_URL)}`,
    `https://proxy.espterminator.com/?url=${encodeURIComponent(REMOTE_MANIFEST_URL)}`,
    REMOTE_MANIFEST_URL
  ];

  for (const mirrorUrl of manifestMirrors) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000); // 6s timeout guard

      const res = await fetch(mirrorUrl, { 
        cache: 'default',
        signal: controller.signal 
      });
      clearTimeout(timeoutId);

      if (!res.ok) continue;
      const data = await res.json();
      const remoteOptions = Array.isArray(data.options) ? data.options : [];
      
      if (remoteOptions.length > 0) {
        const existingNames = new Set(BUNDLED_FALLBACK_PRESETS.map(p => p.name.toLowerCase()));
        const merged = [
          ...BUNDLED_FALLBACK_PRESETS,
          ...remoteOptions.filter(opt => !existingNames.has(opt.name?.toLowerCase()))
        ];

        inMemoryCatalog = merged;
        return { options: merged, fromCache: false, total: merged.length };
      }
    } catch (err) {
      console.warn(`Manifest mirror ${mirrorUrl.slice(0, 45)} notice:`, err.message);
    }
  }

  // 3. Fallback to bundled fallback presets
  inMemoryCatalog = BUNDLED_FALLBACK_PRESETS;
  return { options: BUNDLED_FALLBACK_PRESETS, fromCache: true, total: BUNDLED_FALLBACK_PRESETS.length };
}

export const SUITE_METADATA = {
  piglet: {
    name: 'Piglet Wardriver Suite',
    repoUrl: 'https://github.com/olosnoks/piglet',
    upstreamRepoUrl: 'https://github.com/Hamspiced/piglet',
    websiteUrl: 'https://olosnoks.github.io/piglet/',
    defaultBaud: 460800
  },
  marauder: {
    name: 'ESP32 Marauder',
    repoUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    defaultBaud: 921600
  },
  bruce: {
    name: 'Bruce Multi-Tool',
    repoUrl: 'https://github.com/BruceDevices/firmware',
    websiteUrl: 'https://github.com/BruceDevices/firmware',
    defaultBaud: 921600
  },
  wled: {
    name: 'WLED Lighting Controller',
    repoUrl: 'https://github.com/wled/WLED',
    websiteUrl: 'https://kno.wled.ge',
    defaultBaud: 921600
  },
  micropython: {
    name: 'MicroPython REPL',
    repoUrl: 'https://github.com/micropython/micropython',
    websiteUrl: 'https://micropython.org',
    defaultBaud: 460800
  },
  awokxdag: {
    name: 'AxD / AWOK Suite',
    repoUrl: 'https://github.com/dagnazty/awokxdag',
    websiteUrl: 'https://dagnazty.github.io/awokxdag/control.html',
    defaultBaud: 921600
  },
  launcher: {
    name: 'M5Launcher Suite',
    repoUrl: 'https://github.com/bmorcelli/Launcher',
    websiteUrl: 'https://bmorcelli.github.io/M5Stick-Launcher/',
    defaultBaud: 921600
  },
  meshtastic: {
    name: 'Meshtastic Mesh Radio',
    repoUrl: 'https://github.com/meshtastic/firmware',
    websiteUrl: 'https://meshtastic.org',
    defaultBaud: 115200
  },
  ghostesp: {
    name: 'GhostESP Multi-Tool',
    repoUrl: 'https://github.com/Spooks457/GhostESP',
    websiteUrl: 'https://github.com/Spooks457/GhostESP',
    defaultBaud: 115200
  },
  evilm5: {
    name: 'Evil-M5Project Suite',
    repoUrl: 'https://github.com/7h30th3r0n3/Evil-M5Project',
    websiteUrl: 'https://github.com/7h30th3r0n3/Evil-M5Project',
    defaultBaud: 115200
  },
  flipperhttp: {
    name: 'FlipperHTTP Suite',
    repoUrl: 'https://github.com/jblanked/FlipperHTTP',
    websiteUrl: 'https://flipperhttp.click',
    defaultBaud: 115200
  },
  esphoneypot: {
    name: 'ESP Honeypot',
    repoUrl: 'https://github.com/A-C-T-I-N-I-U-M/ESPHoneypot',
    websiteUrl: 'https://github.com/A-C-T-I-N-I-U-M/ESPHoneypot',
    defaultBaud: 921600
  },
  cym: {
    name: 'CYD / Cheap Yellow Monster',
    repoUrl: 'https://github.com/hexvalid/CYD-K-Menu',
    websiteUrl: 'https://github.com/hexvalid/CYD-K-Menu',
    defaultBaud: 921600
  },
  buspirate: {
    name: 'Bus Pirate ESP32-S3',
    repoUrl: 'https://github.com/DangerousPrototypes/BusPirate5-firmware',
    websiteUrl: 'https://buspirate.com',
    defaultBaud: 921600
  },
  chimerable: {
    name: 'ChimeraBLE Suite',
    repoUrl: 'https://github.com/dagnazty/chimerable',
    websiteUrl: 'https://github.com/dagnazty/chimerable',
    defaultBaud: 921600
  },
  biscuit: {
    name: 'Biscuit OS',
    repoUrl: 'https://github.com/Spooks457/BiscuitOS',
    websiteUrl: 'https://github.com/Spooks457/BiscuitOS',
    defaultBaud: 921600
  },
  squachwatch: {
    name: 'SquachWatch Wardriver',
    repoUrl: 'https://github.com/SquachWatch/SquachWatch',
    websiteUrl: 'https://github.com/SquachWatch/SquachWatch',
    defaultBaud: 921600
  },
  m5porkchop: {
    name: 'M5PorkChop Suite',
    repoUrl: 'https://github.com/m5porkchop/porkchop',
    websiteUrl: 'https://github.com/m5porkchop/porkchop',
    defaultBaud: 921600
  },
  crosspoint: {
    name: 'CrossPoint Suite',
    repoUrl: 'https://github.com/crosspoint-reader/crosspoint',
    websiteUrl: 'https://github.com/crosspoint-reader/crosspoint',
    defaultBaud: 460800
  },
  deskbuddy: {
    name: 'DeskBuddy Suite',
    repoUrl: 'https://github.com/Spooks457/DeskBuddy',
    websiteUrl: 'https://github.com/Spooks457/DeskBuddy',
    defaultBaud: 921600
  },
  eli: {
    name: 'Eli Firmware',
    repoUrl: 'https://github.com/dagnazty/eli-firmware',
    websiteUrl: 'https://github.com/dagnazty/eli-firmware',
    defaultBaud: 921600
  },
  bw16: {
    name: 'Evil-BW16 Suite',
    repoUrl: 'https://github.com/7h30th3r0n3/Evil-BW16',
    websiteUrl: 'https://github.com/7h30th3r0n3/Evil-BW16',
    defaultBaud: 1500000
  },
  hamqso: {
    name: 'HamQSO Suite',
    repoUrl: 'https://github.com/Hamspiced/HamQSO',
    websiteUrl: 'https://github.com/Hamspiced/HamQSO',
    defaultBaud: 921600
  },
  jcmkwardriver: {
    name: 'JCMK Wardriver',
    repoUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    websiteUrl: 'https://github.com/justcallmekoko/ESP32Marauder',
    defaultBaud: 921600
  },
  mimiclaw: {
    name: 'MimiClaw Suite',
    repoUrl: 'https://github.com/mimiclaw/firmware',
    websiteUrl: 'https://github.com/mimiclaw/firmware',
    defaultBaud: 460800
  },
  momentum: {
    name: 'Flipper Zero Momentum',
    repoUrl: 'https://github.com/Next-Flip/Momentum-Firmware',
    websiteUrl: 'https://momentum-fw.dev',
    defaultBaud: 115200
  },
  monstatek: {
    name: 'MonstaTek Suite',
    repoUrl: 'https://github.com/MonstaTek/firmware',
    websiteUrl: 'https://github.com/MonstaTek/firmware',
    defaultBaud: 921600
  },
  official: {
    name: 'Flipper Zero Official',
    repoUrl: 'https://github.com/flipperdevices/flipperzero-firmware',
    websiteUrl: 'https://flipperzero.one',
    defaultBaud: 115200
  },
  radioink: {
    name: 'RadioInk Suite',
    repoUrl: 'https://github.com/p1x31/radioink',
    websiteUrl: 'https://github.com/p1x31/radioink',
    defaultBaud: 921600
  },
  roguemaster: {
    name: 'Flipper Zero RogueMaster',
    repoUrl: 'https://github.com/RogueMaster/flipperzero-firmware-wPlugins',
    websiteUrl: 'https://github.com/RogueMaster/flipperzero-firmware-wPlugins',
    defaultBaud: 115200
  },
  sticksandstones: {
    name: 'Sticks & Stones',
    repoUrl: 'https://github.com/Hamspiced/sticks_and_stones',
    websiteUrl: 'https://github.com/Hamspiced/sticks_and_stones',
    defaultBaud: 460800
  },
  unleashed: {
    name: 'Flipper Zero Unleashed',
    repoUrl: 'https://github.com/DarkFlippers/unleashed-firmware',
    websiteUrl: 'https://github.com/DarkFlippers/unleashed-firmware',
    defaultBaud: 115200
  },
  deauther: {
    name: 'ESP8266 Deauther',
    repoUrl: 'https://github.com/SpacehuhnTech/esp8266_deauther',
    websiteUrl: 'https://deauther.com',
    defaultBaud: 115200
  },
  evilportal: {
    name: 'Evil Portal Suite',
    repoUrl: 'https://github.com/bigbrodude6119/flipper-zero-evil-portal',
    websiteUrl: 'https://github.com/bigbrodude6119/flipper-zero-evil-portal',
    defaultBaud: 115200
  }
};

const KNOWN_TYPE_NAMES = Object.fromEntries(
  Object.entries(SUITE_METADATA).map(([k, v]) => [k, v.name])
);

/**
 * Resolves a firmware item into its primary project family/suite.
 */
export function getFirmwareFamily(item) {
  if (item.isPigletSuite || item.type === 'piglet' || (item.name || '').toLowerCase().includes('piglet')) {
    return { id: 'piglet', name: 'Piglet Wardriver Suite', type: 'piglet' };
  }

  const name = item.name || '';
  const lowerName = name.toLowerCase();
  const lowerType = (item.type || '').toLowerCase();

  if (KNOWN_TYPE_NAMES[lowerType]) {
    return { id: lowerType, name: KNOWN_TYPE_NAMES[lowerType], type: item.type };
  }

  if (lowerName.includes('marauder') || lowerType === 'marauder') {
    return { id: 'marauder', name: 'ESP32 Marauder', type: 'marauder' };
  }
  if (lowerName.includes('bruce') || lowerType === 'bruce') {
    return { id: 'bruce', name: 'Bruce Multi-Tool', type: 'bruce' };
  }
  if (lowerName.includes('wled') || lowerType === 'wled' || lowerType === 'iot') {
    return { id: 'wled', name: 'WLED Lighting Controller', type: 'iot' };
  }
  if (lowerName.includes('micropython') || lowerType === 'interpreter' || lowerName.includes('python')) {
    return { id: 'micropython', name: 'MicroPython REPL', type: 'interpreter' };
  }
  if (lowerName.includes('axd') || lowerType === 'awokxdag' || lowerName.includes('awok')) {
    return { id: 'awokxdag', name: 'AxD / AWOK Suite', type: 'awokxdag' };
  }
  if (lowerName.includes('flipperhttp') || lowerType === 'flipperhttp') {
    return { id: 'flipperhttp', name: 'FlipperHTTP Suite', type: 'flipperhttp' };
  }
  if (lowerName.includes('meshtastic') || lowerType === 'meshtastic') {
    return { id: 'meshtastic', name: 'Meshtastic Mesh Radio', type: 'meshtastic' };
  }
  if (lowerName.includes('ghostesp') || lowerType === 'ghostesp') {
    return { id: 'ghostesp', name: 'GhostESP Multi-Tool', type: 'ghostesp' };
  }
  if (lowerName.includes('evil portal') || lowerType === 'evilportal') {
    return { id: 'evilportal', name: 'Evil Portal Suite', type: 'evilportal' };
  }
  if (lowerName.includes('deauther') || lowerType === 'deauther') {
    return { id: 'deauther', name: 'ESP8266 Deauther', type: 'deauther' };
  }

  // Generic prefix grouping: e.g. "Heltec V3", "LilyGO T-Beam", "M5Cardputer", etc.
  const match = name.match(/^([A-Za-z0-9_-]+)/);
  const prefix = match ? match[1] : name;
  const normalizedId = (item.type && item.type !== 'other') ? item.type.toLowerCase() : prefix.toLowerCase();
  return { 
    id: normalizedId, 
    name: prefix, 
    type: item.type || 'other' 
  };
}

/**
 * Collapses flat firmware presets into unified suites with boards and versions.
 */
export function groupFirmwareCatalog(catalog = []) {
  const groupsMap = new Map();
  const result = [];
  let pigletSuiteGroup = null;

  for (const item of catalog) {
    if (item.isPigletSuite || item.type === 'piglet' || (item.name || '').toLowerCase().includes('piglet')) {
      if (!pigletSuiteGroup) {
        pigletSuiteGroup = {
          id: 'piglet-suite',
          isPigletSuite: true,
          familyName: 'Piglet Wardriver Suite',
          type: 'piglet',
          item: item.isPigletSuite ? item : (catalog.find(c => c.isPigletSuite) || item)
        };
        result.push(pigletSuiteGroup);
        groupsMap.set('piglet', pigletSuiteGroup);
        groupsMap.set('piglet-suite', pigletSuiteGroup);
      }
      continue;
    }

    const { id, name: familyName, type } = getFirmwareFamily(item);
    const normalizedId = (id || 'other').toLowerCase();
    const meta = SUITE_METADATA[normalizedId] || {};
    
    if (!groupsMap.has(normalizedId)) {
      const newGroup = {
        id: normalizedId,
        familyName,
        type,
        websiteUrl: meta.websiteUrl,
        repoUrl: meta.repoUrl,
        defaultBaud: meta.defaultBaud,
        boards: []
      };
      groupsMap.set(normalizedId, newGroup);
      result.push(newGroup);
    }

    const itemWithMeta = {
      ...item,
      websiteUrl: item.websiteUrl || meta.websiteUrl,
      repoUrl: item.repoUrl || meta.repoUrl,
      flashConfig: {
        ...item.flashConfig,
        baudRate: item.flashConfig?.baudRate || meta.defaultBaud || 921600
      }
    };

    const existingBoards = groupsMap.get(normalizedId).boards;
    const boardKey = (item.name || '').trim().toLowerCase();
    if (!existingBoards.some(b => (b.name || '').trim().toLowerCase() === boardKey)) {
      existingBoards.push(itemWithMeta);
    }
  }

  return result;
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

  // Direct fetch first for origins known to send CORS headers (GitHub Pages, raw git CDN)
  if (targetUrl.includes('olosnoks.github.io') || targetUrl.includes('raw.githubusercontent.com')) {
    strategies.push(targetUrl);
  }

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
  if (!strategies.includes(targetUrl)) {
    strategies.push(targetUrl);
  }

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
