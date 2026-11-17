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
        children: [t('terminal'), t('hardware'), t('bridge'), t('automation'), t('alerts')] },
      { id: 'live-data', name: 'Live Data & Industrial', icon: 'Activity', desc: 'Plot, gauge and poll serial telemetry and Modbus devices',
        children: [t('plotter'), t('telemetry'), t('modbus-rtu')] },
      { id: 'device-setup', name: 'On-device Setup', icon: 'FileCode', desc: 'MicroPython files and Wi-Fi provisioning over serial',
        children: [t('micropython'), t('improv')] }
    ]
  },
  {
    id: 'flash-program', name: 'Flash & Program', icon: 'HardDriveDownload',
    desc: 'Write, dump and debug firmware on chips and boards',
    children: [t('flasher'), t('dfu'), t('programmers'), t('esp-dump')]
  },
  {
    id: 'usb-devices', name: 'USB Devices', icon: 'Usb',
    desc: 'Inspect, reverse engineer and talk to USB devices',
    children: [
      { id: 'usb-inspect', name: 'Inspect & Identify', icon: 'ScanSearch', desc: 'Descriptors, HID, protocols, power and VID/PID lookup',
        children: [t('usb-inspector'), t('usb-rea'), t('hid'), t('usb-pd'), t('intel-modal')] },
      { id: 'usb-storage-media', name: 'Storage, Phones & Cameras', icon: 'Smartphone', desc: 'Drives, Android (ADB/Fastboot) and PTP/MTP cameras',
        children: [t('mass-storage'), t('android'), t('ptp')] },
      { id: 'usb-keys-payloads', name: 'Keys & Payloads', icon: 'Keyboard', desc: 'Security keys and BadUSB keystroke payloads',
        children: [t('fido2'), t('ducky')] }
    ]
  },
  {
    id: 'buses-instruments', name: 'Buses & Instruments', icon: 'Cpu',
    desc: 'Logic analysis, I2C/SPI, CAN/OBD-II and lab instruments',
    children: [t('logic-analyzer'), t('bus-explorer'), t('can-bus'), t('usbtmc')]
  },
  {
    id: 'radio-wireless', name: 'Radio & Wireless', icon: 'Radio',
    desc: 'Wi-Fi, wardriving, SDR, RFID/NFC and Bluetooth',
    children: [
      { id: 'wifi-wardrive', name: 'Wi-Fi & Wardriving', icon: 'Wifi', desc: 'Monitor mode, PMKID cracking, GPS and wardriver decks',
        children: [t('alfa-wifi'), t('aircrack-wifi'), t('wardrive'), t('warhog-piglet'), t('wardrive-generator')] },
      { id: 'rf-badges', name: 'SDR, RFID & Bluetooth', icon: 'RadioTower', desc: 'HackRF/PortaPack, Proxmark, Flipper Zero and BLE',
        children: [t('mayhem'), t('proxmark'), t('flipper'), t('ble')] }
    ]
  },
  {
    id: 'network-web', name: 'Network & Web', icon: 'Globe',
    desc: 'Web app testing, recon, OSINT and packet captures',
    children: [
      { id: 'web-testing', name: 'Web App Testing', icon: 'ShieldCheck', desc: 'HTTP repeater/fuzzer, site analysis and auth testing',
        children: [t('http-workbench'), t('web-analyzer'), t('hydra-bruteforce')] },
      { id: 'recon-osint', name: 'Recon & OSINT', icon: 'Radar', desc: 'Port scans, DNS, certificate transparency, Shodan and IP math',
        children: [t('nmap-scanner'), t('dns-toolkit'), t('crtsh-finder'), t('osint-clients'), t('ip-calculator')] },
      { id: 'packet-captures', name: 'Packet Captures', icon: 'Network', desc: 'Analyze and view PCAP files and raw packets',
        children: [t('packet-analyzer'), t('tcpdump-viewer')] }
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
        children: [t('cyberchef'), t('regex-tester'), t('db-browser')] }
    ]
  },
  {
    id: 'reference-setup', name: 'Reference & Setup', icon: 'BookOpen',
    desc: 'Docs, drivers, pinouts and the session report',
    children: [t('setup'), t('pinouts-modal'), t('wiki-external'), t('session-log')]
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
