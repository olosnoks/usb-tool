// Linux udev rule for USB serial adapters and dev boards.
//
// Safe by design: one rule per USB vendor (not every tty), no world-writable
// device nodes. TAG+="uaccess" gives the user who is logged in at the machine
// access through a systemd ACL; GROUP + MODE="0660" is the fallback for ssh /
// headless sessions (add yourself to that group). ID_MM_DEVICE_IGNORE keeps
// ModemManager from probing the port.
//
// UDEV_SETUP_COMMAND is the single source of truth: the Setup tab displays this
// exact string and the copy button copies this exact string.

export const UDEV_RULES_PATH = '/etc/udev/rules.d/99-usb-serial-tools.rules';

export const UDEV_VENDORS = [
  { vid: '1a86', name: 'WCH CH340 / CH341 / CH9102' },
  { vid: '10c4', name: 'Silicon Labs CP210x' },
  { vid: '0403', name: 'FTDI' },
  { vid: '067b', name: 'Prolific PL2303' },
  { vid: '303a', name: 'Espressif native USB' },
  { vid: '2e8a', name: 'Raspberry Pi (Pico, RP2040 / RP2350)' },
  { vid: '0483', name: 'STMicroelectronics (Flipper Zero, Blue Pill USB CDC)' },
];

export function buildUdevRules(vendors = UDEV_VENDORS, group = 'dialout') {
  const lines = [
    '# USB serial adapters and dev boards: per-vendor, no world-writable ports.',
    '# uaccess: the user logged in at the machine gets access. GROUP/MODE: fallback for ssh sessions.',
  ];
  for (const v of vendors) {
    lines.push(`# ${v.name}`);
    lines.push(`SUBSYSTEM=="tty", ATTRS{idVendor}=="${v.vid}", TAG+="uaccess", GROUP="${group}", MODE="0660", ENV{ID_MM_DEVICE_IGNORE}="1"`);
  }
  return lines.join('\n');
}

export const UDEV_RULES_TEXT = buildUdevRules();

export const UDEV_SETUP_COMMAND = [
  `sudo tee ${UDEV_RULES_PATH} >/dev/null <<'EOF'`,
  UDEV_RULES_TEXT,
  'EOF',
  'sudo udevadm control --reload-rules && sudo udevadm trigger',
].join('\n');

export const DIALOUT_COMMAND = 'sudo usermod -a -G dialout $USER';
