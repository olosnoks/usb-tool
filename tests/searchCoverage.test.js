import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SIDEBAR_SECTIONS } from '../src/components/layout/Sidebar.jsx';
import { KNOWN_TOOL_IDS } from '../src/components/ToolRegistry.jsx';
// Same matching function the sidebar, command palette and wiki use.
import { searchTools, matchesTool } from '../src/utils/toolSearch.js';

const ITEMS = SIDEBAR_SECTIONS.flatMap((s) => s.items);
// The palette builds its action list inside the component, so read the sub-tab deep-link entries from source.
const paletteSrc = readFileSync(new URL('../src/components/CommandPalette.jsx', import.meta.url), 'utf8');
const PALETTE_TOOL_IDS = new Set([...paletteSrc.matchAll(/toolId:\s*'([^']+)'/g)].map((m) => m[1]));

describe('search coverage: every tool is reachable', () => {
  it('every sidebar item has keywords', () => {
    for (const item of ITEMS) {
      expect(Array.isArray(item.keywords) && item.keywords.length > 0, `${item.id} has no keywords`).toBe(true);
    }
  });

  it('every KNOWN_TOOL_IDS entry is a sidebar item, a palette action, or searchable by its id via a sidebar item', () => {
    for (const id of KNOWN_TOOL_IDS) {
      const direct = ITEMS.some((i) => i.id === id) || PALETTE_TOOL_IDS.has(id);
      const viaAlias = searchTools(ITEMS, id).length > 0;
      expect(direct || viaAlias, `tool id "${id}" is unreachable from search`).toBe(true);
    }
  });

  it('every sub-tab alias has its own palette entry or is a sidebar item', () => {
    const sidebarIds = new Set(ITEMS.map((i) => i.id));
    for (const id of KNOWN_TOOL_IDS) {
      expect(sidebarIds.has(id) || PALETTE_TOOL_IDS.has(id), `alias "${id}" has no sidebar item or palette action`).toBe(true);
    }
  });

  it('every sidebar item is found by its own name and id', () => {
    for (const item of ITEMS) {
      expect(matchesTool(item, item.name), `${item.id} by name`).toBe(true);
      expect(matchesTool(item, item.id), `${item.id} by id`).toBe(true);
    }
  });
});

// [query, expected sidebar item id]. The item must be among the top 5 results.
const QUERIES = [
  ['lsusb', 'usb-inspector'],
  ['firmware dump', 'esp-dump'],
  ['baud', 'terminal'],
  ['putty', 'terminal'],
  ['shodan', 'osint-clients'],
  ['sqlite', 'db-browser'],
  ['protocol reverse', 'usb-rea'],
  ['usbpcap', 'usb-rea'],
  ['wireshark dissector', 'usb-rea'],
  ['esptool', 'flasher'],
  ['efuse', 'esp-dump'],
  ['swd', 'programmers'],
  ['ch341a', 'programmers'],
  ['bios chip', 'programmers'],
  ['atmega', 'programmers'],
  ['i2c', 'bus-explorer'],
  ['bus pirate', 'bus-explorer'],
  ['saleae', 'logic-analyzer'],
  ['pulseview', 'logic-analyzer'],
  ['obd2', 'can-bus'],
  ['slcan', 'can-bus'],
  ['modbus', 'modbus-rtu'],
  ['scpi', 'usbtmc'],
  ['burp', 'http-workbench'],
  ['swagger', 'http-workbench'],
  ['nikto', 'web-analyzer'],
  ['owasp zap', 'web-analyzer'],
  ['hashcat', 'hashcat-cracker'],
  ['pmkid', 'aircrack-wifi'],
  ['pcap', 'tcpdump-viewer'],
  ['nmap', 'nmap-scanner'],
  ['dkim', 'dns-toolkit'],
  ['nslookup', 'dns-toolkit'],
  ['subdomain', 'crtsh-finder'],
  ['jwt', 'jwt-inspector'],
  ['regex101', 'regex-tester'],
  ['cidr', 'ip-calculator'],
  ['sha256sum', 'hash-calculator'],
  ['hibp', 'pwned-passwords'],
  ['openssl x509', 'cert-inspect'],
  ['rubber ducky', 'ducky'],
  ['dfu-util', 'dfu'],
  ['fastboot', 'android'],
  ['logcat', 'android'],
  ['mifare', 'proxmark'],
  ['flipper', 'flipper'],
  ['hackrf', 'mayhem'],
  ['wigle', 'wardrive'],
  ['cheap yellow display', 'warhog-piglet'],
  ['web bluetooth', 'ble'],
  ['webhid', 'hid'],
  ['fat32', 'mass-storage'],
  ['yubikey', 'fido2'],
  ['dslr', 'ptp'],
  ['usb-c power', 'usb-pd'],
  ['mpremote', 'micropython'],
  ['guru meditation', 'alerts'],
  ['udev', 'setup'],
  ['vid pid lookup', 'intel-modal'],
  ['cyberchef', 'cyberchef'],
  ['xor', 'cyberchef'],
  ['mitm', 'bridge'],
  ['serial plotter', 'plotter'],
  ['pinout', 'pinouts-modal'],
];

describe('search coverage: realistic queries (shared searchTools matcher)', () => {
  for (const [query, expected] of QUERIES) {
    it(`"${query}" finds ${expected}`, () => {
      const ids = searchTools(ITEMS, query).map((i) => i.id);
      expect(ids, `no results for "${query}"`).toContain(expected);
      expect(ids.indexOf(expected), `"${query}" ranks ${expected} at ${ids.indexOf(expected)}: ${ids.slice(0, 5).join(', ')}`).toBeLessThan(5);
    });
  }
});
