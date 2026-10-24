/**
 * Setup, Reference & Troubleshooting Wiki Articles
 * Covering Linux Setup & Drivers, Troubleshooting Matrix, Pinouts Reference, and Chip Intelligence
 */

export const REFERENCE_ARTICLES = [
  {
    id: 'setup',
    toolId: 'setup',
    category: 'reference',
    title: 'Linux Setup & Drivers — udev Rules, Permissions & Serial Bridges',
    summary: 'Configure Linux udev permissions, Windows VCP drivers, and macOS serial port nodes for seamless WebSerial connectivity.',
    tags: ['Linux', 'udev', 'Drivers', 'Permissions', 'dialout', 'Windows', 'macOS'],
    readTime: '6 min read',
    content: `
# Linux Setup & Drivers — Permissions & udev Guide

When using WebSerial with development hardware on Linux, Windows, and macOS, operating system permissions and device drivers determine whether your browser can open the port.

---

### Linux Permission Architecture

On Linux distributions (Ubuntu, Debian, Fedora, Arch, Mint), the kernel creates device nodes like \`/dev/ttyUSB0\` or \`/dev/ttyACM0\` when a USB bridge connects. By default, these nodes belong to the \`root\` user and the \`dialout\` or \`uucp\` system group with mode \`0660\` (read/write only for owner and group).

If your user account is not a member of this group, Chromium will throw:
\`\`\`text
NetworkError: Failed to open serial port. Access denied.
\`\`\`

#### Step 1: Add User to the Serial Group
Run the following in your terminal:
\`\`\`bash
# Ubuntu, Debian, Raspberry Pi OS, Linux Mint:
sudo usermod -aG dialout,plugdev $USER

# Arch Linux, Manjaro, EndeavourOS:
sudo usermod -aG uucp $USER

# Fedora, RHEL, CentOS:
sudo usermod -aG dialout $USER
\`\`\`

#### Step 2: Create a Universal udev Rules File
To grant non-root access to all major USB-UART chips without permission prompts, create \`/etc/udev/rules.d/99-serial.rules\`:
\`\`\`bash
sudo tee /etc/udev/rules.d/99-serial.rules << 'EOF'
# CH340 / CH341
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", MODE="0666", GROUP="dialout"
# CP210x (Silicon Labs)
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", MODE="0666", GROUP="dialout"
# FTDI FT232R / FT2232
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", MODE="0666", GROUP="dialout"
# Raspberry Pi Pico / RP2040
SUBSYSTEM=="tty", ATTRS{idVendor}=="2e8a", MODE="0666", GROUP="dialout"
# Espressif Native USB-JTAG/Serial (ESP32-S2/S3/C3/C6)
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", MODE="0666", GROUP="dialout"
EOF
\`\`\`

#### Step 3: Reload udev Rules
\`\`\`bash
sudo udevadm control --reload-rules && sudo udevadm trigger
\`\`\`
> **Log Out and Log In**: Group membership updates only take effect upon starting a new login session.

---

### Windows Driver Checklist
- **CH340 / CH341**: Requires the official WCH CH341SER Windows driver. If Windows Device Manager shows a yellow exclamation mark on "USB-SERIAL CH340", download and run the installer.
- **CP2102 / CP2104**: Windows Update usually downloads the Silicon Labs driver automatically; standalone VCP drivers are available if needed.
- **CDC ACM (ESP32 Native USB)**: Modern Windows 10/11 includes the native \`usbser.sys\` driver and requires no third-party installation.

---

### macOS Device Nodes
On macOS, WebSerial displays devices with paths like \`/dev/cu.usbserial-*\` and \`/dev/tty.usbserial-*\`. Always select the \`cu.*\` (Call-Up) device node for reliable bidirectional streaming.
`
  },
  {
    id: 'troubleshooting',
    toolId: 'troubleshooting',
    category: 'reference',
    title: 'Troubleshooting & Error Matrix — Root Causes & Exact Fixes',
    summary: 'Comprehensive diagnostics matrix resolving packet header timeouts, access denied errors, framing gibberish, and brownouts.',
    tags: ['Troubleshooting', 'Error Matrix', 'Timeout', 'Access Denied', 'Framing Error', 'Brownout'],
    readTime: '8 min read',
    content: `
# Troubleshooting & Error Matrix

This reference table outlines every common failure state encountered during serial monitoring, flashing, and workbench operations, with root causes and confirmed solutions.

---

### The Master Error Matrix

| Error Message / Symptom | Root Cause | Exact Solution |
| :--- | :--- | :--- |
| **"Failed to connect to ESP32: Timed out waiting for packet header"** | The ESP microcontroller did not enter ROM download mode during the DTR/RTS auto-reset cycle. | 1. Press and **hold the BOOT button** on the board.<br>2. Click **Connect & Flash**.<br>3. When the tool shows *Connecting...*, press the **RESET (EN) button once**.<br>4. Release the BOOT button. |
| **"NetworkError: Failed to open serial port / Access denied"** | Another process on your PC holds an exclusive lock on the COM port, or Linux user lacks group permissions. | 1. Close Arduino IDE, Cura, PuTTY, or VS Code Serial Monitor.<br>2. On Linux, ensure your user belongs to \`dialout\` / \`uucp\` groups.<br>3. Unplug and replug the USB cable. |
| **Garbage characters / gibberish in Terminal (\`?x\`)** | Baud rate mismatch or missing common ground reference between devices. | 1. Use the **Baud Hunter** tool to automatically identify the true rate.<br>2. Ensure the baud rate matches the firmware's \`Serial.begin()\` speed.<br>3. Check that GND is firmly connected. |
| **"Brownout detector was triggered" loop** | Target board experiences voltage dips below 2.43V, usually when activating Wi-Fi radio. | 1. Avoid unpowered USB hubs or keyboard passthrough ports.<br>2. Use a short, thick, low-resistance USB data cable.<br>3. Solder a 100uF–470uF electrolytic capacitor across 3.3V and GND. |
| **"A transfer error occurred / Packet sequence mismatch"** | Baud rate is too high for the USB-UART bridge or cable quality. | 1. Drop flashing baud rate from \`921600\` to \`460800\` or \`115200\` bps.<br>2. Avoid cheap unshielded breadboard jumper wires longer than 15 cm. |
| **Port selector dialog does not show target device** | Missing bridge driver, charge-only USB cable, or fried USB protection diode. | 1. Verify your cable is a **data cable** (connect a smartphone to confirm data transfer).<br>2. Check Windows Device Manager or run \`lsusb\` on Linux to confirm VID/PID enumeration. |
| **ESP32-C5 flashing fails at 0% with "Stub error"** | ESP32-C5 early engineering silicon memory architecture conflicts with standard esptool stubs. | Select **Direct ROM Mode (No-Stub)** in the Flasher settings. Skon's tool flashes C5 directly through native ROM routines at 115,200 baud. |
`
  },
  {
    id: 'pinouts-reference',
    toolId: 'pinouts-modal',
    category: 'reference',
    title: 'Pinouts Reference — ESP32, S3, C3, C6 & USB Wiring Maps',
    summary: 'Hardware pinout diagrams, SPI/I2C/UART pin assignments, strapping pins, and USB Type-A / Type-C pinout specifications.',
    tags: ['Pinouts', 'Wiring', 'ESP32', 'ESP32-S3', 'ESP32-C3', 'ESP32-C6', 'USB-C'],
    readTime: '6 min read',
    content: `
# Pinouts Reference — Microcontrollers & USB Wiring

Pinout mismatches are the leading cause of communication failure on the test bench. Use this comprehensive reference when wiring sensors, GPS modules, displays, and logic probes.

---

### 1. Default Hardware Bus Pins by ESP Architecture

| Bus / Function | ESP32 Classic | ESP32-S3 | ESP32-C3 | ESP32-C6 |
| :--- | :--- | :--- | :--- | :--- |
| **UART0 TX / RX** | GPIO 1 / 3 | GPIO 43 / 44 | GPIO 21 / 20 | GPIO 16 / 17 |
| **UART1 TX / RX** | GPIO 10 / 9 | GPIO 17 / 18 | GPIO 0 / 1 | GPIO 4 / 5 |
| **I2C SCL / SDA** | GPIO 22 / 21 | GPIO 9 / 8 | GPIO 9 / 8 | GPIO 7 / 6 |
| **SPI MOSI / MISO** | GPIO 23 / 19 | GPIO 11 / 13 | GPIO 6 / 5 | GPIO 21 / 20 |
| **SPI SCK / CS** | GPIO 18 / 5 | GPIO 12 / 10 | GPIO 4 / 7 | GPIO 22 / 19 |
| **Boot Mode Pin** | GPIO 0 | GPIO 0 | GPIO 9 | GPIO 9 |

---

### 2. Critical Boot Strapping Pin Rules

- **GPIO 0 / GPIO 9**: Must be pulled HIGH (3.3V) for normal flash boot; pull LOW (0V) only to force ROM download bootloader mode.
- **GPIO 12 (MTDI on ESP32 Classic)**: Selects internal SPI flash voltage. If pulled HIGH on 3.3V flash modules, the flash memory will be under-volted to 1.8V and the board will not boot!
- **GPIO 15**: Must be pulled HIGH or floating during boot.
- **GPIO 2**: Must be floating or pulled LOW during boot on ESP8266.

---

### 3. USB Type-C Pinout & Resistor Requirements
When designing custom ESP32 boards with a USB-C receptacle:
- Connect two independent **5.1kΩ pull-down resistors** (one from **CC1** to GND, one from **CC2** to GND).
- *Never tie CC1 and CC2 together to a single resistor!* Doing so violates the USB-C specification and will cause smart chargers (e.g. Apple or Anker PD chargers) to deliver 0V.
`
  },
  {
    id: 'chip-intelligence',
    toolId: 'intel-modal',
    category: 'reference',
    title: 'Chip Intelligence — VID/PID Hardware Identification Database',
    summary: 'Lookup USB Vendor IDs (VID) and Product IDs (PID) to identify mystery boards, USB-UART bridge ICs, and development hardware.',
    tags: ['Chip Intel', 'VID/PID', 'USB IDs', 'WCH', 'Silicon Labs', 'FTDI', 'Espressif'],
    readTime: '5 min read',
    content: `
# Chip Intelligence — USB Hardware Identification

Every USB peripheral announces a 16-bit **Vendor ID (VID)** and 16-bit **Product ID (PID)**. The **Chip Intelligence** engine inspects these numbers to instantly determine what silicon bridge or microcontroller you have plugged in.

---

### Master VID / PID Reference Table

| VID | PID | Silicon IC / Hardware Family | Description |
| :--- | :--- | :--- | :--- |
| **\`0x1A86\`** | **\`0x7523\`** | WCH CH340 / CH340G / CH340C | The most ubiquitous USB-to-UART bridge on NodeMCU & Arduino clones |
| **\`0x1A86\`** | **\`0x5523\`** | WCH CH341A | Multi-mode USB bridge used on BIOS programmers & I2C/SPI dongles |
| **\`0x1A86\`** | **\`0x55D4\`** | WCH CH9102F | Modern high-speed USB-UART bridge capable of up to 4 Mbps |
| **\`0x10C4\`** | **\`0xEA60\`** | Silicon Labs CP2102 / CP2104 | High-stability VCP bridge on official Espressif DevKits & LilyGO |
| **\`0x0403\`** | **\`0x6001\`** | FTDI FT232R | Industry-standard FTDI USB-UART transceiver |
| **\`0x0403\`** | **\`0x6010\`** | FTDI FT2232D / FT2232H | Dual-channel high-speed bridge used on JTAG and SWD hardware |
| **\`0x303A\`** | **\`0x1001\`** | Espressif ESP32-S3 / C3 / C6 | Built-in native USB CDC / JTAG controller directly on the SoC die |
| **\`0x2E8A\`** | **\`0x000A\`** | Raspberry Pi Pico / RP2040 | Official Raspberry Pi dual-core RISC-V / ARM microcontroller CDC |
| **\`0x0483\`** | **\`0x5740\`** | STMicroelectronics STM32 | Virtual COM Port on STM32F103 (BluePill), F401, F411 BlackPill |
| **\`0x1D50\`** | **\`0x6089\`** | Great Scott Gadgets HackRF One | PortaPack SDR radio transceiver USB interface |
| **\`0x20A0\`** | **\`0x415A\`** | Flipper Devices Flipper Zero | Flipper Zero USB virtual communication port & RPC interface |
| **\`0x9AC4\`** | **\`0x4B8F\`** | Proxmark3 RDV4 / Easy | RFID & NFC research and emulation instrument |
`
  }
];
