/**
 * Firmware Catalog Service
 * Handles fetching, caching, and searching the ESP Terminator firmware catalog (400+ presets)
 * Remote source: https://espterminator.com/firmware/manifest.json
 */

const REMOTE_MANIFEST_URL = 'https://espterminator.com/firmware/manifest.json';
const CACHE_KEY = 'skons_firmware_catalog_v1';
const CACHE_EXPIRY_MS = 1000 * 60 * 60 * 6; // 6 hours

// Structured Piglet firmware variants by author (skon's forks vs Hamspiced's official releases)
export const PIGLET_VARIANTS = {
  skon: [
    {
      id: 'freenove-s3-cyd',
      boardName: 'Freenove S3 CYD',
      fwName: 'UI4 Theme + GPS Wardrive',
      name: "Piglet — Freenove S3 CYD (skon's fork)",
      device: 'ESP32-S3',
      type: 'piglet',
      source: 'skon',
      version: 'v2.7-skon',
      description: "skon's fork of Piglet Wardriver featuring UI4 interface tailored for Freenove ESP32-S3 Cheap Yellow Display. High-speed 2.4GHz Wi-Fi/BLE reconnaissance & GPS wardriving.",
      websiteUrl: 'https://olosnoks.github.io/piglet/',
      downloadUrl: 'https://olosnoks.github.io/piglet/firmware/freenove-s3-cyd-ham-ui4.bin',
      files: [
        { name: 'freenove-s3-cyd-ham-ui4.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/freenove-s3-cyd-ham-ui4.bin' }
      ],
      isMergedBinary: true,
      features: ['UI4 Modern Interface', 'GPS Wardriving & PCAP', 'Freenove S3 CYD Display', 'Wi-Fi & BLE Recon', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
    },
    {
      id: 'guition-jc8048w550',
      boardName: 'Guition JC8048W550',
      fwName: '800x480 High-Res Cockpit',
      name: "Piglet — Guition JC8048W550 (skon's fork)",
      device: 'ESP32-S3',
      type: 'piglet',
      source: 'skon',
      version: 'v2.7-skon',
      description: "skon's fork of Piglet Wardriver compiled for Guition JC8048W550 (5.0\" / 7.0\" 800x480 S3 Display). Large format high-resolution wardriving cockpit.",
      websiteUrl: 'https://olosnoks.github.io/piglet/',
      downloadUrl: 'https://olosnoks.github.io/piglet/firmware/guition-jc8048w550.bin',
      files: [
        { name: 'guition-jc8048w550.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/guition-jc8048w550.bin' }
      ],
      isMergedBinary: true,
      features: ['800x480 Large Screen GUI', 'Guition JC8048W550 S3', 'GPS Map & Wardriving', 'Wi-Fi & BLE Recon', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 921600, eraseAll: true }
    },
    {
      id: 'xiao-c5',
      boardName: 'Seeed Studio XIAO ESP32-C5',
      fwName: 'Dual-Band 2.4/5GHz Wi-Fi 6',
      name: "Piglet Core — XIAO ESP32-C5 (skon's fork)",
      device: 'ESP32-C5',
      type: 'piglet',
      source: 'skon',
      version: 'v2.7-skon',
      description: "skon's fork of Piglet Core for Seeed Studio XIAO ESP32-C5 (dual-band 2.4GHz & 5GHz Wi-Fi 6 RISC-V). Next-generation dual-band wardriving powerhouse.",
      websiteUrl: 'https://olosnoks.github.io/piglet/',
      downloadUrl: 'https://olosnoks.github.io/piglet/firmware/xiao_c5.bin',
      files: [
        { name: 'xiao_c5.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/xiao_c5.bin' }
      ],
      isMergedBinary: true,
      features: ['Dual-Band 2.4GHz & 5GHz', 'ESP32-C5 Wi-Fi 6 RISC-V', 'Seeed XIAO Micro Form Factor', 'GPS & Wardrive Support', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    },
    {
      id: 'pigletnode-c5',
      boardName: 'PigletNode ESP32-C5',
      fwName: 'Headless Mesh Recon Node',
      name: "PigletNode C5 Mesh Node (skon's fork)",
      device: 'ESP32-C5',
      type: 'piglet',
      source: 'skon',
      version: 'v2.7-skon',
      description: "skon's fork of PigletNode for ESP32-C5. Dual-band headless mesh and remote reconnaissance node for distributed wardriving networks.",
      websiteUrl: 'https://olosnoks.github.io/piglet/',
      downloadUrl: 'https://olosnoks.github.io/piglet/firmware/pigletnode_c5.bin',
      files: [
        { name: 'pigletnode_c5.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/pigletnode_c5.bin' }
      ],
      isMergedBinary: true,
      features: ['Dual-Band 2.4GHz/5GHz Node', 'Mesh Recon Integration', 'Low-Power Continuous Capture', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    },
    {
      id: 'esp32c3-oled',
      boardName: 'ESP32-C3 0.42" OLED',
      fwName: 'Ultra-Compact OLED Node',
      name: "PigletNode C3 — 0.42\" OLED (skon's fork)",
      device: 'ESP32-C3',
      type: 'piglet',
      source: 'skon',
      version: 'v2.7-skon',
      description: "skon's fork of PigletNode for ultra-compact ESP32-C3 RISC-V boards with 0.42\" mini OLED display. Portable sensor node for Wi-Fi & BLE logging.",
      websiteUrl: 'https://olosnoks.github.io/piglet/',
      downloadUrl: 'https://olosnoks.github.io/piglet/firmware/esp32c3_oled.bin',
      files: [
        { name: 'esp32c3_oled.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/esp32c3_oled.bin' }
      ],
      isMergedBinary: true,
      features: ['0.42" OLED Mini Display', 'Ultra-Compact RISC-V Node', 'Wi-Fi & BLE Sniffer', 'Wigle Compatible CSV', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    },
    {
      id: 'waveshare-c6',
      boardName: 'Waveshare C6 Mini 1.47" LCD',
      fwName: 'Wi-Fi 6 & BLE 5 Handheld',
      name: "Piglet — Waveshare C6 Mini 1.47\" LCD (skon's fork)",
      device: 'ESP32-C6',
      type: 'piglet',
      source: 'skon',
      version: 'v2.7-skon',
      description: "skon's fork of Piglet for Waveshare ESP32-C6 1.47\" LCD board (Wi-Fi 6 & BLE 5). Handheld color screen wardriving tool.",
      websiteUrl: 'https://olosnoks.github.io/piglet/',
      downloadUrl: 'https://olosnoks.github.io/piglet/firmware/waveshare_c6.bin',
      files: [
        { name: 'waveshare_c6.bin', address: '0x0', downloadUrl: 'https://olosnoks.github.io/piglet/firmware/waveshare_c6.bin' }
      ],
      isMergedBinary: true,
      features: ['1.47" Color LCD Display', 'ESP32-C6 Wi-Fi 6 & BLE 5', 'Compact Handheld Wardrive', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    }
  ],
  ham: [
    {
      id: 'ham-xiao-c5',
      boardName: 'Seeed Studio XIAO ESP32-C5',
      fwName: 'Official Piglet Core Release',
      name: "Piglet Core — XIAO ESP32-C5 (Ham's Official)",
      device: 'ESP32-C5',
      type: 'piglet',
      source: 'ham',
      version: 'v2.7',
      description: "Hamspiced's official Piglet Core release for Seeed Studio XIAO ESP32-C5. Dual-band 2.4GHz & 5GHz wardriving with Wigle-compatible CSV and PCAP output.",
      websiteUrl: 'https://github.com/Hamspiced/piglet',
      downloadUrl: 'https://github.com/Hamspiced/piglet/releases/latest/download/Piglet.ino.merged.bin',
      files: [
        { name: 'Piglet.ino.merged.bin', address: '0x0', downloadUrl: 'https://github.com/Hamspiced/piglet/releases/latest/download/Piglet.ino.merged.bin' }
      ],
      isMergedBinary: true,
      features: ['Official Hamspiced Release', 'Dual-Band 2.4GHz / 5GHz C5', 'Wigle CSV & PCAP Logging', 'GPS Wardriving', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    },
    {
      id: 'ham-pigletnode-c5',
      boardName: 'PigletNode ESP32-C5',
      fwName: 'Official PigletNode Mesh Release',
      name: "PigletNode C5 Mesh Node (Ham's Official)",
      device: 'ESP32-C5',
      type: 'piglet',
      source: 'ham',
      version: 'v2.7',
      description: "Hamspiced's official PigletNode release for ESP32-C5. Autonomous dual-band reconnaissance sensor for distributed wardriving.",
      websiteUrl: 'https://github.com/Hamspiced/piglet',
      downloadUrl: 'https://github.com/Hamspiced/piglet/releases/latest/download/PigletNode.ino.merged.bin',
      files: [
        { name: 'PigletNode.ino.merged.bin', address: '0x0', downloadUrl: 'https://github.com/Hamspiced/piglet/releases/latest/download/PigletNode.ino.merged.bin' }
      ],
      isMergedBinary: true,
      features: ['Official Hamspiced Release', 'ESP32-C5 Autonomous Node', 'Dual-Band RF Sniffing', 'Wigle Sync', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    },
    {
      id: 'ham-tdongle-c5',
      boardName: 'LilyGo T-Dongle C5',
      fwName: 'Official T-Dongle USB Release',
      name: "Piglet — LilyGo T-Dongle C5 (Ham's Official)",
      device: 'ESP32-C5',
      type: 'piglet',
      source: 'ham',
      version: 'v2.7',
      description: "Hamspiced's official Piglet firmware for LilyGo T-Dongle ESP32-C5 with integrated color display and USB-A plug. Plug-and-play dual-band wardriving.",
      websiteUrl: 'https://github.com/Hamspiced/piglet',
      downloadUrl: 'https://github.com/Hamspiced/piglet/releases/latest/download/TDongleC5_Piglet.ino.merged.bin',
      files: [
        { name: 'TDongleC5_Piglet.ino.merged.bin', address: '0x0', downloadUrl: 'https://github.com/Hamspiced/piglet/releases/latest/download/TDongleC5_Piglet.ino.merged.bin' }
      ],
      isMergedBinary: true,
      features: ['Official Hamspiced Release', 'LilyGo T-Dongle C5 USB', 'Integrated Color LCD', 'Dual-Band 2.4G/5G', 'Factory Merged 0x0'],
      flashConfig: { flashMode: 'keep', baudRate: 460800, eraseAll: true }
    }
  ]
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
    const remoteOptions = Array.isArray(data.options) ? data.options : [];
    
    // Always preserve curated presets (Piglet, Marauder, Bruce, etc.) at the top of the catalog
    const existingNames = new Set(BUNDLED_FALLBACK_PRESETS.map(p => p.name.toLowerCase()));
    const merged = [
      ...BUNDLED_FALLBACK_PRESETS,
      ...remoteOptions.filter(opt => !existingNames.has(opt.name?.toLowerCase()))
    ];

    inMemoryCatalog = merged;
    return { options: merged, fromCache: false, total: merged.length };
  } catch (err) {
    console.warn('Remote manifest fetch failed/timed out, utilizing bundled fallback presets:', err);
    inMemoryCatalog = BUNDLED_FALLBACK_PRESETS;
    return { options: BUNDLED_FALLBACK_PRESETS, fromCache: true, total: BUNDLED_FALLBACK_PRESETS.length, error: err.message };
  }
}

/**
 * Resolves a firmware item into its primary project family/suite.
 */
export function getFirmwareFamily(item) {
  if (item.isPigletSuite || item.type === 'piglet') {
    return { id: 'piglet', name: 'Piglet Wardriver Suite', type: 'piglet' };
  }

  const name = item.name || '';
  const lowerName = name.toLowerCase();
  const lowerType = (item.type || '').toLowerCase();

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
  return { 
    id: (item.type && item.type !== 'other') ? item.type : prefix.toLowerCase(), 
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

  for (const item of catalog) {
    if (item.isPigletSuite) {
      result.push({
        id: 'piglet-suite',
        isPigletSuite: true,
        familyName: 'Piglet Wardriver Suite',
        type: 'piglet',
        item
      });
      continue;
    }

    const { id, name: familyName, type } = getFirmwareFamily(item);
    
    if (!groupsMap.has(id)) {
      const newGroup = {
        id,
        familyName,
        type,
        boards: []
      };
      groupsMap.set(id, newGroup);
      result.push(newGroup);
    }

    groupsMap.get(id).boards.push(item);
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
