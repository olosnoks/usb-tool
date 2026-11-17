// Start-menu taxonomy for the tool list. Each node is a category or a tool leaf.
//   category:  { id, name, icon (lucide-react export name), desc, children: [node, ...] }
//   tool leaf: { toolId }  -> name/icon/desc come from the SIDEBAR_SECTIONS item at render time.
// Max nesting depth is 3 (top category > sub-category > tool).
const t = (toolId) => ({ toolId });

export const TOOL_CATEGORIES = [
  {
    id: 'serial-console', name: 'Serial & Console', icon: 'Terminal',
    desc: 'Talk to boards over UART: consoles, bridges, live data and on-device files',
    children: [
      { id: 'console-control', name: 'Console & Control', icon: 'SquareTerminal', desc: 'Serial terminal, boot-mode control, sniffing, scripts and crash alerts',
        children: [t('terminal'), t('hardware'), t('bridge'), t('automation'), t('alerts'), t('at-modem')] },
      { id: 'live-data', name: 'Live Data & Industrial', icon: 'Activity', desc: 'Plot, gauge and poll serial telemetry and Modbus devices',
        children: [t('plotter'), t('telemetry'), t('modbus-rtu')] },
      { id: 'device-setup', name: 'On-device Setup', icon: 'FileCode', desc: 'MicroPython files and Wi-Fi provisioning over serial',
        children: [t('micropython'), t('improv')] },
      { id: 'makers-rc', name: 'Printers, Drones & RC', icon: 'Printer', desc: '3D printers and CNC, flight controllers and ExpressLRS radio links',
        children: [t('gcode-sender'), t('fc-configurator'), t('elrs-crsf')] }
    ]
  },
  {
    id: 'flash-program', name: 'Flash & Program', icon: 'HardDriveDownload',
    desc: 'Write, dump and debug firmware on chips and boards',
    children: [
      { id: 'flash-upload', name: 'Flash & Upload', icon: 'Upload', desc: 'ESP, DFU, Arduino bootloader, RP2040 PICOBOOT and iCE40 FPGA',
        children: [t('flasher'), t('dfu'), t('arduino-uploader'), t('picoboot'), t('fpga-programmer')] },
      { id: 'programmers-dumps', name: 'Programmers & Dumps', icon: 'Cpu', desc: 'SPI flash, SWD/JTAG, AVR ISP and ESP flash/eFuse dumps',
        children: [t('programmers'), t('esp-dump')] },
      { id: 'firmware-files', name: 'Firmware Files & Crashes', icon: 'FileSearch', desc: 'Convert, analyze and size firmware images; ESP partitions, NVS and backtraces',
        children: [t('firmware-converter'), t('firmware-analyzer'), t('esp-partition-editor'), t('elf-size'), t('esp-backtrace')] }
    ]
  },
  {
    id: 'usb-devices', name: 'USB Devices', icon: 'Usb',
    desc: 'Inspect, reverse engineer and talk to USB devices',
    children: [
      { id: 'usb-inspect', name: 'Inspect & Identify', icon: 'ScanSearch', desc: 'Descriptors, HID, protocols, power and VID/PID lookup',
        children: [t('usb-inspector'), t('usb-rea'), t('hid'), t('usb-pd'), t('intel-modal')] },
      { id: 'usb-storage-media', name: 'Storage, Phones & Cameras', icon: 'Smartphone', desc: 'Drives, Android (ADB/Fastboot) and PTP/MTP cameras',
        children: [t('mass-storage'), t('android'), t('ptp')] },
      { id: 'usb-keys-payloads', name: 'Keys & Payloads', icon: 'Keyboard', desc: 'Security keys, smart-card APDUs and BadUSB keystroke payloads',
        children: [t('fido2'), t('ducky'), t('smartcard')] },
      { id: 'usb-input-midi', name: 'Keyboards, Controllers & MIDI', icon: 'Gamepad2', desc: 'Key and VIA testing, gamepads and mice, MIDI monitor and SysEx',
        children: [t('keyboard-tester'), t('input-tester'), t('midi-monitor')] }
    ]
  },
  {
    id: 'buses-instruments', name: 'Buses & Instruments', icon: 'Cpu',
    desc: 'Logic analysis, I2C/SPI, CAN/OBD-II, lab instruments and power measurement',
    children: [t('logic-analyzer'), t('bus-explorer'), t('can-bus'), t('usbtmc'), t('power-profiler'), t('usb-power-meter')]
  },
  {
    id: 'radio-wireless', name: 'Radio & Wireless', icon: 'Radio',
    desc: 'Wi-Fi, wardriving, SDR, RFID/NFC, Bluetooth and LoRa mesh',
    children: [
      { id: 'wifi-wardrive', name: 'Wi-Fi & Wardriving', icon: 'Wifi', desc: 'Monitor mode, PMKID cracking, GPS and wardriver decks',
        children: [t('alfa-wifi'), t('aircrack-wifi'), t('wardrive'), t('warhog-piglet'), t('wardrive-generator')] },
      { id: 'sdr', name: 'SDR & Signal Decoding', icon: 'RadioTower', desc: 'HackRF/PortaPack, RTL-SDR and offline 433/868/915 MHz decoding',
        children: [t('mayhem'), t('rtl-sdr'), t('ism-decoder')] },
      { id: 'rf-badges', name: 'RFID, NFC & Bluetooth', icon: 'Nfc', desc: 'Proxmark, Flipper Zero, BLE and Web NFC',
        children: [t('proxmark'), t('flipper'), t('ble'), t('web-nfc')] },
      { id: 'mesh-lora', name: 'Mesh & LoRa', icon: 'Waypoints', desc: 'Meshtastic nodes, RNode/Reticulum and LoRa airtime',
        children: [t('meshtastic'), t('rnode-lora')] }
    ]
  },
  {
    id: 'network-web', name: 'Network & Web', icon: 'Globe',
    desc: 'Web app testing, recon, OSINT and packet captures',
    children: [
      { id: 'web-testing', name: 'Web App & IoT Clients', icon: 'ShieldCheck', desc: 'HTTP repeater/fuzzer, site analysis, auth testing and MQTT',
        children: [t('http-workbench'), t('web-analyzer'), t('hydra-bruteforce'), t('mqtt-client')] },
      { id: 'recon-osint', name: 'Recon & OSINT', icon: 'Radar', desc: 'Port scans, DNS, certificate transparency, Shodan and IP math',
        children: [t('nmap-scanner'), t('dns-toolkit'), t('crtsh-finder'), t('osint-clients'), t('ip-calculator')] },
      { id: 'packet-captures', name: 'Packet Captures', icon: 'Network', desc: 'Analyze PCAP files, raw packets and Bluetooth HCI logs',
        children: [t('packet-analyzer'), t('tcpdump-viewer'), t('bt-hci-log')] }
    ]
  },
  {
    id: 'crypto-data', name: 'Crypto & Data', icon: 'KeyRound',
    desc: 'Hashing, cracking, tokens, certificates and data transforms',
    children: [
      { id: 'hash-crack', name: 'Hashing & Cracking', icon: 'Hash', desc: 'Hash/HMAC, dictionary and mask attacks, breached passwords',
        children: [t('hash-calculator'), t('hashcat-cracker'), t('pwned-passwords')] },
      { id: 'tokens-certs', name: 'Tokens & Certificates', icon: 'BadgeCheck', desc: 'Decode and verify JWTs and X.509 certificates',
        children: [t('jwt-inspector'), t('cert-inspect')] },
      { id: 'data-workbench', name: 'Data Workbench', icon: 'Database', desc: 'CyberChef recipes, regex and SQLite browsing',
        children: [t('cyberchef'), t('regex-tester'), t('db-browser')] },
      { id: 'binary-checksums', name: 'Binary, Bits & Checksums', icon: 'Binary', desc: 'Protobuf/CBOR/MessagePack decoding, number and float conversion, CRC reverse-engineering',
        children: [t('binary-decoder'), t('bit-converter'), t('crc-reverse')] }
    ]
  },
  {
    id: 'reference-setup', name: 'Reference & Setup', icon: 'BookOpen',
    desc: 'Docs, drivers, pinouts, calculators, I2C addresses and the session report',
    children: [t('setup'), t('pinouts-modal'), t('electronics-calc'), t('i2c-address-ref'), t('wiki-external'), t('session-log')]
  }
];

/** Every toolId in the tree, depth-first, in display order. */
export function flattenToolIds(nodes = TOOL_CATEGORIES) {
  const out = [];
  for (const node of nodes) {
    if (node.toolId) out.push(node.toolId);
    else if (node.children) out.push(...flattenToolIds(node.children));
  }
  return out;
}

/** Category ids from root to the tool's parent category, or null if not found. */
export function findCategoryPath(toolId, nodes = TOOL_CATEGORIES) {
  for (const node of nodes) {
    if (node.toolId) continue;
    if (node.children?.some((c) => c.toolId === toolId)) return [node.id];
    const sub = findCategoryPath(toolId, node.children || []);
    if (sub) return [node.id, ...sub];
  }
  return null;
}
