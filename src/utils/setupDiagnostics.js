// Pure helpers for the Setup & Troubleshooting tool.

// Known USB-serial vendors: VID (number) -> driver guidance. Matches the cards in the tool.
export const KNOWN_BRIDGES = [
  { vid: 0x1a86, name: 'WCH CH340 / CH341 / CH9102', windows: 'WCH CH341SER driver', other: 'Built into Linux and modern macOS' },
  { vid: 0x10c4, name: 'Silicon Labs CP210x', windows: 'Silicon Labs CP210x VCP driver (also via Windows Update)', other: 'Built into Linux (cp210x) and macOS' },
  { vid: 0x0403, name: 'FTDI FT232 / FT2232 / FT231X', windows: 'FTDI VCP driver (also via Windows Update); D2XX is not used by Web Serial', other: 'Built into Linux (ftdi_sio) and macOS' },
  { vid: 0x067b, name: 'Prolific PL2303', windows: 'Prolific driver; genuine PL2303HXD/GC chips only, clones are blocked by newer drivers', other: 'Built into Linux (pl2303)' },
  { vid: 0x303a, name: 'Espressif native USB (JTAG/serial or CDC)', windows: 'None needed on Windows 10/11 (usbser.sys); the JTAG interface may need WinUSB', other: 'Built into Linux (cdc_acm)' },
  { vid: 0x2e8a, name: 'Raspberry Pi (Pico / RP2040 / RP2350)', windows: 'None needed (usbser.sys CDC-ACM)', other: 'Built into Linux (cdc_acm) and macOS' },
  { vid: 0x0483, name: 'STMicroelectronics (CDC, DFU, ST-Link)', windows: 'None for CDC; ST-Link and DFU use ST drivers or WinUSB', other: 'Built into Linux' },
  { vid: 0x2341, name: 'Arduino', windows: 'Arduino IDE drivers, or usbser.sys on Windows 10/11', other: 'Built into Linux (cdc_acm)' },
];

export function hex4(n) {
  return Number.isFinite(n) ? n.toString(16).padStart(4, '0') : '----';
}

// Accepts "1a86:7523", "0x1A86 0x7523", "VID_1A86&PID_7523", "1a86". Returns { vid, pid|null } or null.
export function parseVidPid(text) {
  if (typeof text !== 'string') return null;
  const s = text.trim();
  if (!s) return null;
  const win = /VID_([0-9a-f]{4}).*?PID_([0-9a-f]{4})/i.exec(s);
  if (win) return { vid: parseInt(win[1], 16), pid: parseInt(win[2], 16) };
  const tokens = s.replace(/0x/gi, ' ').split(/[^0-9a-f]+/i).filter(Boolean);
  if (tokens.length < 1 || tokens.length > 2) return null;
  if (!tokens.every((t) => t.length >= 1 && t.length <= 4)) return null;
  const vid = parseInt(tokens[0], 16);
  const pid = tokens[1] !== undefined ? parseInt(tokens[1], 16) : null;
  return { vid, pid };
}

export function findBridge(vid) {
  return KNOWN_BRIDGES.find((b) => b.vid === vid) || null;
}

// env: { secure, ua, serial, usb, hid, bluetooth } booleans/strings. Returns checklist rows.
export function detectCapabilities(env) {
  const ua = env.ua || '';
  const firefox = /firefox/i.test(ua);
  const safari = /safari/i.test(ua) && !/chrome|chromium|crios|edg|opr/i.test(ua);
  const rows = [
    { id: 'secure', label: 'Secure context (https or localhost)', ok: !!env.secure, fix: 'Open the app over https or http://localhost; browsers disable device APIs on plain http.' },
    { id: 'serial', label: 'Web Serial', ok: !!env.serial, fix: 'Use Chrome, Edge, Opera or Brave on desktop (or Chrome on Android with some adapters).' },
    { id: 'usb', label: 'WebUSB', ok: !!env.usb, fix: 'Use a Chromium-based browser. Firefox and Safari do not implement WebUSB.' },
    { id: 'hid', label: 'WebHID', ok: !!env.hid, fix: 'Use a Chromium-based browser.' },
    { id: 'bluetooth', label: 'Web Bluetooth', ok: !!env.bluetooth, fix: 'Use Chrome or Edge; on Linux it may be behind a flag. Not available in Firefox or iOS Safari.' },
  ];
  const notes = [];
  if (firefox) notes.push('Firefox does not support Web Serial, WebUSB or WebHID.');
  if (safari) notes.push('Safari does not support Web Serial, WebUSB or WebHID.');
  if (env.secure && !env.serial && !env.usb && !firefox && !safari) notes.push('A Chromium browser can still lack these APIs if enterprise policy or a flag disables them.');
  return { rows, notes };
}

// Short next-step advice for a granted device, by vendor and OS hint.
export function adviceFor(vid, os) {
  const b = findBridge(vid);
  if (!b) return 'Vendor not in the built-in list. If the port will not open, check Device Manager (Windows) or dmesg (Linux) for the driver bound to it.';
  if (os === 'windows') return `${b.name}: ${b.windows}.`;
  return `${b.name}: ${b.other}.`;
}

// Filters troubleshooting entries by free text over title/body/keywords.
export function filterEntries(entries, query) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return entries;
  return entries.filter((e) => {
    const hay = `${e.title} ${e.body} ${(e.keywords || []).join(' ')}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export const TROUBLE_ENTRIES = [
  { id: 'denied', title: 'Failed to open serial port / Access denied', keywords: ['busy', 'locked', 'in use', 'permission'], body: 'Only one program can hold a port. Close the Arduino IDE Serial Monitor, PlatformIO, Cura, PuTTY and other browser tabs using Web Serial. On Linux also check the dialout/uucp group or the udev rule above.' },
  { id: 'timeout', title: 'ESP32: Timed out waiting for packet header', keywords: ['esp32', 'flash', 'boot', 'sync'], body: 'Auto-reset did not reach the chip. Hold the BOOT / IO0 button while flashing starts, then release. Cheap boards may lack the EN capacitor. Also try another cable and a lower flash baud rate.' },
  { id: 'garbage', title: 'Terminal shows garbage characters', keywords: ['baud', 'framing', 'unreadable'], body: 'Baud rate mismatch. ESP8266 ROM boot output is 74880 baud, most others 115200. Use Baud Hunter in the Terminal tool.' },
  { id: 'noport', title: 'Device does not appear in the port picker', keywords: ['missing', 'not listed', 'charge only', 'cable'], body: 'Try a data cable (many are charge-only), another port, and no hub. On Windows check Device Manager for an unknown device or a yellow warning; on Linux run dmesg after plugging in. On Linux, brltty can claim CH340 ports (sudo apt remove brltty).' },
  { id: 'wcomm', title: 'Windows: port opens then immediately disconnects', keywords: ['windows', 'com', 'driver', 'prolific', 'counterfeit'], body: 'Often a driver problem. For FTDI/Prolific clones, an old driver version may be needed. Uninstall the device in Device Manager (tick "delete driver software") and replug to get a fresh driver.' },
  { id: 'winusb', title: 'WebUSB cannot claim the interface (Windows)', keywords: ['winusb', 'zadig', 'claim', 'interface', 'access denied'], body: 'WebUSB needs the interface bound to WinUSB. Class drivers such as usbser or HID block it. Installing WinUSB with a tool such as Zadig replaces the original driver for that interface, so only do this on a device you own, and be ready to roll it back in Device Manager.' },
  { id: 'macos', title: 'macOS: which device node?', keywords: ['mac', 'cu', 'tty'], body: 'Use /dev/cu.usbserial-* or /dev/cu.usbmodem*. CH340 may need the WCH driver on older macOS versions.' },
  { id: 'browser', title: 'Browser compatibility and Android OTG', keywords: ['firefox', 'safari', 'android', 'otg', 'chrome'], body: 'Web Serial needs Chrome, Edge, Opera or Brave on desktop. On Android, Chrome supports WebUSB with a USB-OTG cable; Web Serial support there is limited. Firefox and Safari support neither.' },
];
