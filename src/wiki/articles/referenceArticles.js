/**
 * Reference & Troubleshooting Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering Setup & Driver Configuration, Hardware Bench Troubleshooting, Pinout References,
 * and Chip Intelligence / Silicon Identification.
 */

import { UDEV_RULES_TEXT, UDEV_RULES_PATH, UDEV_SETUP_COMMAND } from '../../data/udevRules.js';

export const REFERENCE_ARTICLES = [
  {
    id: 'setup',
    toolId: 'setup',
    category: 'reference',
    title: 'Complete Driver & Hardware Bench Setup Guide',
    summary: 'Master USB-to-UART drivers across Windows, Linux udev rules, ModemManager blacklisting, macOS device nodes, and WebSerial browser permissions.',
    tags: ['Setup', 'Drivers', 'Linux', 'udev', 'Windows', 'CH340', 'CP2102', 'WebSerial', 'ModemManager'],
    readTime: '18 min read',
    content: `
# Complete Driver & Hardware Bench Setup Guide

This guide details the physical and operating system level setup required to establish low-latency, uninterrupted WebSerial communication across **Linux, Windows, and macOS**.

The app's own **Setup & Troubleshooting** tool (tool id \`setup\`) has an always-visible diagnostics panel followed by three collapsed panels you click to expand.

**Browser check** shows OK/NO for secure context (https or localhost), Web Serial, WebUSB, WebHID and Web Bluetooth, with a fix hint for each missing one, and a note for Firefox or Safari. **Permitted devices** has a Scan button that lists the serial ports and USB devices this site has *already* been granted (the browser never reveals others), with VID:PID, a driver hint for known vendors, and a Forget button that revokes the permission (shown only where the browser supports \`forget()\`). **VID:PID lookup** accepts \`1a86:7523\`, \`0x10C4 0xEA60\` or a Windows hardware ID such as \`VID_0403&PID_6001\` and names the bridge vendor and the driver needed on Windows and Linux/macOS (a built-in list of 8 common vendors; it is not the full USB ID database).

The three panels are: **Linux USB permissions & udev rules** (two copy buttons: \`sudo usermod -a -G dialout $USER\`, and a per-vendor rule file written to \`${UDEV_RULES_PATH}\` that uses \`TAG+="uaccess"\` plus \`GROUP="dialout", MODE="0660"\`, followed by a udev reload and trigger; the text shown on screen is exactly the text copied), **USB-to-UART bridge drivers** (cards for CH340/CH341/CH9102, CP210x, FTDI, Prolific PL2303, Espressif native USB and RP2040, each with VID/PID, notes and a driver download link), and **Troubleshooting (searchable)** (a filter box over entries for access denied, packet header timeout, garbage characters, missing port, Windows disconnects, WebUSB claim failures with WinUSB/Zadig, macOS device nodes and browser support). Everything runs locally; nothing is sent anywhere. The sections below go further than the in-app cards: per-chip udev rules that also tell ModemManager to ignore the device, and Windows and macOS notes.

**Similar tools:** USBDeview (NirSoft) lists past and present USB devices on Windows and Zadig installs generic WinUSB/libusbK drivers. This tool cannot see system-wide devices or install drivers; it only shows what the browser has permitted and explains what to install.

---

### 1. Linux Setup (Ubuntu, Debian, Fedora, Arch)

On Linux systems, two security and daemon behaviors frequently disrupt hardware serial communication:
1. **User Group Permissions**: By default, standard users do not have read/write access to serial character devices in \`/dev/ttyUSB*\` or \`/dev/ttyACM*\`.
2. **ModemManager Interference**: The default \`ModemManager\` daemon automatically opens newly connected USB-serial adapters and spams AT modem probe commands (\`AT\\r\\n\`, \`ATI\\r\\n\`), causing bootloader synchronization failures and corrupted serial streams.

<details>
<summary>Deep-Dive: Complete Linux udev Rule & User Group Configuration</summary>

#### Step 1: Add User to the Dialout / UUCP Group
Run the following terminal command and reboot (or re-login):
\`\`\`bash
# On Ubuntu / Debian / Raspberry Pi OS:
sudo usermod -aG dialout $USER

# On Arch Linux / Fedora / Manjaro:
sudo usermod -aG uucp $USER
\`\`\`

#### Step 2: Install a per-vendor udev rule
Create \`${UDEV_RULES_PATH}\` with root privileges. This is the same text the in-app Setup tab shows and copies:
\`\`\`text
${UDEV_RULES_TEXT}
\`\`\`
Each rule matches one USB vendor, not every tty. \`TAG+="uaccess"\` lets the user logged in at the machine open the port through a systemd ACL, and \`GROUP="dialout"\` with \`MODE="0660"\` covers ssh and headless sessions for members of that group (use \`uucp\` on Arch). Avoid world-writable modes (the 0666 style) and wildcard vendor matches: they make every serial device on the machine writable by every local user.

To write the file and reload in one paste:
\`\`\`bash
${UDEV_SETUP_COMMAND}
\`\`\`

#### Step 3: Reload udev Rules (already included in the paste above)
\`\`\`bash
sudo udevadm control --reload-rules && sudo udevadm trigger
\`\`\`
Setting \`ENV{ID_MM_DEVICE_IGNORE}="1"\` permanently prevents ModemManager from interfering with your hardware workbench ports!

If a CH340 port disappears right after plug-in on Ubuntu or Debian, \`brltty\` (the Braille display daemon) may be claiming it: \`sudo apt remove brltty\`.
</details>

---

### 2. Windows 10 & 11 Driver Checklist

Modern Windows includes a native Microsoft USB CDC ACM driver (\`usbser.sys\`) that automatically binds to modern microcontrollers with native USB (ESP32-S3, RP2040, STM32). However, dedicated USB-UART bridge chips require manufacturer drivers:

- **WCH CH340 / CH341**:
  - Requires the official **WCH CH341SER.EXE** driver installer.
  - If Windows Device Manager displays a yellow exclamation triangle under **Ports (COM & LPT)** on *"USB-SERIAL CH340"*, install the signed driver from Nanjing Qinheng.
- **Silicon Labs CP2102 / CP2104**:
  - Windows Update usually installs this automatically. If missing, download the CP210x Universal Windows Driver from Silicon Labs.
- **FTDI FT232R / FT2232**:
  - Uses the FTDI D2XX / VCP driver package.
- **Prolific PL2303**:
  - Needs the official Prolific driver on Windows 11 (the in-app card lists it); counterfeit chips may be refused by it.

---

### 3. macOS Device Nodes & Permissions

On macOS, WebSerial displays devices with paths like \`/dev/cu.usbserial-*\` and \`/dev/tty.usbserial-*\`:
- **Always select the \`/dev/cu.*\` (Call-Up) node**: The \`cu\` node opens immediately without waiting for Carrier Detect (CD) line assertions.
- The \`tty.*\` node can block indefinitely if modem control signals are not asserted by the target device!
- macOS has no udev: ports appear as \`/dev/cu.usbserial-*\` and \`/dev/cu.usbmodem*\`. For example: \`cu -l /dev/cu.usbserial-0001 -s 115200\`.

---

### 3b. Browser support

Web Serial works in Chromium-based browsers (Chrome, Edge, Opera) on https or localhost only. Firefox and Safari do not support it, so the serial tools cannot open ports there.

---

### 4. Upstream Standards & Engineering Attribution

| Standard / System | Authoring Body / Maintainers | Reference & Specification |
| :--- | :--- | :--- |
| **Linux udev / systemd Device Management** | The Linux Foundation & systemd Project | [systemd.io/udev](https://systemd.io/) (LGPL-2.1) |
| **Microsoft WinUSB / USB-CDC (usbser.sys)** | Microsoft Corporation | [Microsoft Windows Driver Documentation](https://learn.microsoft.com/en-us/windows-hardware/drivers/usbcon/) |
| **WCH / Silicon Labs / FTDI USB Drivers** | Nanjing Qinheng Microelectronics, Silicon Labs, and Future Technology Devices Intl. | Official Manufacturer Port Drivers |
`
  },
  {
    id: 'troubleshooting',
    toolId: 'setup',
    category: 'reference',
    title: 'Troubleshooting & Error Matrix — Root Causes & Exact Fixes',
    summary: 'Comprehensive diagnostics matrix resolving packet header timeouts, access denied errors, framing gibberish, brownouts, and port lockups.',
    tags: ['Troubleshooting', 'Error Matrix', 'Timeout', 'Access Denied', 'Framing Error', 'Brownout', 'Diagnostics'],
    readTime: '20 min read',
    content: `
# Troubleshooting & Error Matrix — Diagnostic Guide

When working with microcontrollers and embedded serial protocols, communication failures can stem from software port contention, baud rate drift, USB cable degradation, or physical silicon failure. This matrix maps symptoms to exact engineering remedies.

---

### 1. Master Error Diagnostic Matrix

| Error Message in Browser | Physical / Electrical Root Cause | Exact Engineering Fix |
| :--- | :--- | :--- |
| **\`Failed to open serial port: Access denied\`** | The COM port is locked by another process (Arduino IDE, VS Code Serial Monitor, Cura, PuTTY). | Close all other IDEs and terminal monitors. In Windows PowerShell, run: \`Get-Process \| Where-Object {$_.Path -like "*serial*"}\`. |
| **\`Timed out waiting for packet header (0x08)\`** (esptool wording; the in-app flasher reports \`The chip did not answer SYNC...\`) | The microcontroller failed to enter ROM download mode during auto-reset. | 1. In the Flasher (ESP ROM mode) raise the **Reset Pulse Duration** slider (50-500 ms) towards **250ms**.<br>2. Perform manual button dance: Hold BOOT, press and release RESET, release BOOT. |
| **\`verify failed at 0x...: flash MD5 ..., image MD5 ...\`** (esptool: \`MD5 of file does not match data in flash\`) | Power supply voltage sag (brownout) during high-current flash write cycles, or a bad cable. | Connect board to a powered USB hub or short, shielded USB-C data cable. Avoid unpowered USB keyboard pass-through ports. |
| **\`Framing Error / Continuous \`x?x\` characters\`** | Baud rate mismatch or crystal oscillator clock drift. | Open the **Baud Hunter** panel in the Terminal tab and start a scan: it tries 9 standard baud rates and scores the output. (ESP8266 ROM boot messages use 74880 baud.) |
| **\`Brownout detector was triggered\`** | 3.3V power rail dropped below 2.80V when the Wi-Fi/Bluetooth radio calibrated its PA amplifier. | Solder a 100uF to 470uF low-ESR electrolytic capacitor directly across the board's 3.3V and GND pins. |
| **\`flash read err, 1000\`** | Microcontroller booted in Quad I/O (QIO) mode, but WP and HOLD pins are floating. | Re-flash firmware setting SPI Transfer Mode to **DIO (Dual I/O)**. |

---

### 2. Hardware Bench Smoke Test Checklist

<details>
<summary>Deep-Dive: Cold Multimeter Smoke Test Checklist for Mystery Boards</summary>

Before plugging an unknown or custom-soldered microcontroller development board into your computer's expensive USB port:

#### Test 1: Unpowered Resistance to Ground Check
1. Disconnect all cables from the board.
2. Set your digital multimeter to **Resistance Mode ($\Omega$)**.
3. Place the **Black probe on GND**, and the **Red probe on the 3.3V power pin**:
   - **Healthy Silicon**: Resistance reads $> 10\,\text{k}\Omega$ (charging internal decoupling capacitors).
   - **Shorted Silicon**: Resistance $< 100\,\Omega$ indicates a permanent silicon puncture or solder bridge across the power rails! **DO NOT PLUG INTO USB!**

#### Test 2: Diode Mode ESD Protection Check on D+ and D-
1. Set digital multimeter to **Diode Test Mode ($\rightarrow|-$)**.
2. Place the **Red probe on GND**, and probe **D+ (Green wire)** then **D- (White wire)** with the **Black probe**:
   - **Healthy Protection Diodes**: Reads between **0.500V and 0.750V** (forward voltage drop of internal silicon ESD suppression diodes).
   - **Blown Silicon**: Reads \`0.000V\` (shorted diode) or \`OL\` (open circuit / blown trace).

#### Test 3: VBUS Voltage Measurement Under Load
1. Plug board into USB.
2. Measure voltage between GND and 5V (VBUS). Voltage must read between **4.75V and 5.25V**. If voltage drops below 4.5V, your USB cable has excessive resistance!
</details>

---

### 3. Upstream Standards & Engineering Attribution

| Engineering Discipline | Standards Body & Best Practices | Reference |
| :--- | :--- | :--- |
| **Open Source Hardware Bench Diagnostics** | Open Source Hardware Association (OSHWA) & IEEE Reliability Society | [oshwa.org](https://www.oshwa.org) / [IEEE Xplore](https://ieeexplore.ieee.org) |
| **IPC-A-610 Acceptability of Electronic Assemblies** | IPC (Association Connecting Electronics Industries) | [ipc.org](https://www.ipc.org) |
`
  },
  {
    id: 'pinouts-reference',
    toolId: 'pinouts-modal',
    category: 'reference',
    title: 'Pinouts Reference — ESP32, ESP32-S3, Pico, FTDI & USB-C Wiring',
    summary: 'The in-app pinout cheat sheet (ESP32 family, ESP8266, ESP32-CAM, Pico, Arduino, Blue Pill, SWD/JTAG, flash clip, USB connectors, FTDI header, 5V to 3.3V divider) plus an ESP32 DevKit pin map and USB Type-C CC resistor rules.',
    tags: ['Pinouts', 'Wiring', 'ESP32', 'ESP32-S3', 'RP2040', 'FTDI', 'USB-C', 'Hardware'],
    readTime: '20 min read',
    content: `
# Pinouts Reference — Microcontrollers & USB Wiring

This reference compiles physical pinout maps, bus assignments, hardware strapping pins, and USB wiring standards across the most common embedded hardware targets.

The app's **Hardware Pinout & Safety Cheat Sheet** (opened from the pinouts button) is generated from one data file, so every board shows pin, name and function in the same layout. A search box at the top finds a GPIO number, pin name or function (for example \`21\`, \`SDA\`, \`MOSI\`, \`boot\`) across all boards. Press Esc (or the **Close Cheat Sheet** button) to close it; focus returns to the button that opened it. Each board is a tab; pins are grouped (for example UART, strapping, buses, JTAG, reserved), risky pins are shown in red with warnings beneath, and a "Related tools" line names the app tools that use that board. Boards and connectors:
- **ESP32-WROOM**: UART0 (GPIO1 / GPIO3), EN, strapping pins (GPIO0, GPIO2, GPIO5, GPIO12, GPIO15), default I2C / SPI pins, JTAG pins, the flash pins GPIO6-11 and the input-only GPIO34-39.
- **ESP32-S3**: native USB on D- GPIO19 / D+ GPIO20, UART0 on GPIO43 / GPIO44, strapping pins, JTAG pins and the flash/PSRAM pins.
- **ESP32-C3**: native USB on D- GPIO18 / D+ GPIO19, UART0 on GPIO21 / GPIO20, strapping pins GPIO2, GPIO8, GPIO9, JTAG pins GPIO4-7.
- **ESP8266**: UART0 and UART1, the GPIO0 / GPIO2 / GPIO15 boot pins, HSPI, the deep-sleep wake pin and the ADC range.
- **ESP32-CAM**: the programming header (no USB bridge, IO0 to GND to flash), the AI-Thinker camera bus and the LED / microSD pins.
- **Raspberry Pi Pico / Pico 2**: the full 40-pin header with default UART, I2C, SPI and ADC functions, and the power pins.
- **Arduino Uno / Nano**: serial, SPI and I2C pins, and the 6-pin ICSP header.
- **STM32 Blue Pill**: USART, USB and SWD pins and the BOOT0 / BOOT1 modes.
- **SWD 10-pin**, **ARM 20-pin JTAG**, **SOIC-8 flash clip**, **USB-A**, **USB Micro-B**, **USB-C** connector pinouts.
- **FTDI / CP2102 6-Pin**: header order GND, CTS, VCC, TXD, RXD, DTR (RTS# on the FTDI TTL-232R cable), with a warning to set VCC to 3.3V for ESP32 and modern ARM chips.
- **5V to 3.3V Divider**: a 1 kOhm / 2 kOhm divider (5V x 2000/3000 = 3.33V) for a 5V TX into a 3.3V RX, one-way signals only.

The sections below are background material and include maps the app does not draw.

---

### 1. ESP32 Family Pinout Maps

#### ESP32 Classic (38-Pin DevKit v1)
\`\`\`text
                      +-------------------+
                  3V3 | (1)          (38) | GND
                   EN | (2)          (37) | GPIO 23 (VSPI MOSI)
              GPIO 36 | (3)   ESP    (36) | GPIO 22 (I2C SCL)
              GPIO 39 | (4)  WROOM   (35) | GPIO 1  (UART0 TXD)
              GPIO 34 | (5)   32     (34) | GPIO 3  (UART0 RXD)
              GPIO 35 | (6)          (33) | GPIO 21 (I2C SDA)
              GPIO 32 | (7)          (32) | GND
              GPIO 33 | (8)          (31) | GPIO 19 (VSPI MISO)
              GPIO 25 | (9)          (30) | GPIO 18 (VSPI SCK)
              GPIO 26 | (10)         (29) | GPIO 5  (VSPI CS0)
              GPIO 27 | (11)         (28) | GPIO 17 (UART2 TXD)
              GPIO 14 | (12)         (27) | GPIO 16 (UART2 RXD)
              GPIO 12 | (13)         (26) | GPIO 4
                  GND | (14)         (25) | GPIO 0  (BOOT STRAP)
              GPIO 13 | (15)         (24) | GPIO 2  (BOOT STRAP)
              GPIO 9  | (16)         (23) | GPIO 15 (BOOT STRAP)
              GPIO 10 | (17)         (22) | GPIO 8
              GPIO 11 | (18)         (21) | GPIO 7
                  5V  | (19)         (20) | GPIO 6
                      +-------------------+
\`\`\`

> **Input-Only Pins (No Internal Pull-Up/Pull-Down)**:
> **GPIO 34, 35, 36 (VP), 39 (VN)** have no internal pull-up or pull-down resistors and cannot be used as outputs. They can be read as digital inputs or ADC inputs, but you must add any pull resistor externally.
> **GPIO 6 to 11** connect to the module's SPI flash on most boards; do not use them.

---

### 2. USB Type-C CC1 / CC2 Configuration Channel Resistor Math

<details>
<summary>Deep-Dive: USB Type-C Receptacle Wiring & 5.1k Pull-Down Resistor Rules</summary>

When designing custom development boards with a USB Type-C receptacle:
- Connect two independent **5.1kΩ (1% tolerance) pull-down resistors** ($R_d$):
  - One resistor tied from **CC1** to GND.
  - One resistor tied from **CC2** to GND.

#### The Golden Rule: Never Tie CC1 and CC2 Together!
Many beginner designs tie CC1 and CC2 together to a single shared 5.1kΩ resistor.
- **Why This Breaks**: In an E-Marked active USB-C cable (standard on 60W, 100W, and 240W cables), the cable's internal e-marker chip is powered by $V_{conn}$ supplied on the second CC pin.
- Tying CC1 and CC2 together shorts the $V_{conn}$ power supply to the CC detection line, violating the USB Type-C specification and causing smart chargers (Apple MacBook, Anker GaN, Baseus) to completely shut off power delivery ($0.0\,\text{V}$)!

</details>

---

### 3. Upstream Hardware & Engineering Attribution

| Silicon Vendor / Organization | Component / Reference | Official Documentation |
| :--- | :--- | :--- |
| **Espressif Systems** | ESP32, ESP32-S3, ESP32-C3, and ESP32-C6 Pinout & Hardware Design Guidelines | [espressif.com Hardware Design Guides](https://www.espressif.com) |
| **USB Implementers Forum (USB-IF)** | USB Type-C Cable and Connector Specification Revision 2.2 | [usb.org/type-c](https://www.usb.org/type-c) |
| **Flipper Devices Inc.** | Flipper Zero 18-Pin GPIO Header Hardware Interface Specification | [docs.flipper.net](https://docs.flipper.net) |
| **Raspberry Pi Ltd** | Raspberry Pi Pico RP2040 Pinout & Hardware Reference | [raspberrypi.com](https://www.raspberrypi.com) |
`
  },
  {
    id: 'chip-intelligence',
    toolId: 'intel-modal',
    category: 'reference',
    title: 'Chip Intelligence — VID/PID Hardware Identification Database',
    summary: 'Look up any USB Vendor ID / Product ID (curated hardware notes plus the full usb.ids list) to identify mystery boards, USB-UART bridge ICs, and development hardware, or look up a USB class code.',
    tags: ['Chip Intel', 'VID/PID', 'USB IDs', 'WCH', 'Silicon Labs', 'FTDI', 'Espressif', 'Identification'],
    readTime: '16 min read',
    content: `
# Chip Intelligence — USB Hardware Identification

Every USB device announces a 16-bit **Vendor ID (VID)** and 16-bit **Product ID (PID)** during USB enumeration. The **Hardware Intelligence** window (*USB Chip & VID:PID Specifications*) looks these identifiers up in two layers: a curated table of **41 entries** (USB-UART bridges, native-USB microcontrollers, bootloader/DFU modes, SDR hardware and Wi-Fi adapters) that carries operating voltage, auto-reset / strapping behaviour and engineer notes, and the bundled **usb.ids** list, which names any vendor and product. The usb.ids data loads lazily the first time the window opens.

When a serial port is connected, a **Currently connected USB hardware** banner shows the match. If only the vendor ID is known (the product is not curated), the vendor name is shown but voltage, auto-reset and driver notes are reported as **unknown**: the tool does not borrow another product's data from the same vendor. Below it a search box accepts:
- a **VID:PID** in any common form (\`1d6b:0002\`, \`0x10C4\`, \`ID 10c4:ea60\`), which works for any device in usb.ids, not just the curated 41. A **LOOKUP [VID:PID ...]** card shows vendor / product, whether the entry is "curated entry + usb.ids", "usb.ids only" or "not found", voltage and auto-reset, plus copy buttons: **Copy VID:PID**, **Copy hardware ID** (\`USB\\VID_xxxx&PID_xxxx\` as shown in Device Manager) and **Copy udev rule**, and links to Device Hunt and the-sz.com;
- a chip or vendor name (\`CP2102\`, \`ftdi\`, \`ch340\`), which filters the curated cards (VID:PID, chip, manufacturer or notes) and lists **usb.ids matches** (up to 40; click one to look it up);
- a class code such as \`class 02:02:01\`, which shows the USB class / subclass / protocol names.

The footer shows the usb.ids version in use ("Names: usb.ids <version> (BSD-3-Clause)"). The same lookup powers the chip analysis in USB Recon & Autopsy.

---

### Master VID / PID Reference Table

| Vendor ID | Product ID | Silicon Manufacturer | Controller Family | Typical Real-World Application |
| :---: | :---: | :--- | :--- | :--- |
| **\`0x1A86\`** | **\`0x7523\`** | WCH (Nanjing Qinheng) | CH340 / CH340G / CH340C | Ubiquitous on NodeMCU, ESP32 DevKits, and Arduino Uno clones |
| **\`0x1A86\`** | **\`0x5523\`** | WCH (Nanjing Qinheng) | CH341A | Motherboard BIOS SPI flash & I2C EEPROM programmers |
| **\`0x1A86\`** | **\`0x55D4\`** | WCH (Nanjing Qinheng) | CH9102F / CH9102X | Modern high-speed USB-UART bridge capable of up to 4 Mbps |
| **\`0x10C4\`** | **\`0xEA60\`** | Silicon Labs | CP2102 / CP2104 | High-stability VCP bridge used on official Espressif DevKits & LilyGO |
| **\`0x0403\`** | **\`0x6001\`** | FTDI | FT232R | Classic industrial USB-to-UART transceiver |
| **\`0x0403\`** | **\`0x6010\`** | FTDI | FT2232D / FT2232H | Dual-channel high-speed bridge used on JTAG and SWD hardware |
| **\`0x303A\`** | **\`0x1001\`** | Espressif Systems | ESP32-S2 / S3 / C3 / C6 | Built-in native USB CDC / JTAG controller on the SoC die |
| **\`0x2E8A\`** | **\`0x000A\`** | Raspberry Pi Ltd | RP2040 / Pico | Official Raspberry Pi dual-core ARM microcontroller CDC |
| **\`0x0483\`** | **\`0x5740\`** | STMicroelectronics / Flipper | STM32 Virtual COM Port / Flipper Zero CLI | Virtual COM port on STM32 boards; also how the Flipper Zero enumerates |
| **\`0x1D50\`** | **\`0x6089\`** | Great Scott Gadgets | HackRF One & PortaPack Mayhem | SDR radio transceiver USB interface |

The table has further entries for other bridges (CP2105/CP2108, FT4232H/FT232H/FT-X, PL2303, CH340K), Arduino Uno/Mega, ST-LINK, boot modes (STM32 DFU, RP2040/RP2350 BOOTSEL, Qualcomm EDL 9008, MediaTek preloader, Allwinner FEL, Amlogic, SAM-BA, nRF52840 DFU, CH32V ISP), HackRF DFU and Wi-Fi adapters (RT5572, RT5370, RTL8812AU). The Proxmark3 is not in the table.

---

### Upstream Standards & Engineering Attribution

| Database / Standard | Maintainer & Authority | Reference |
| :--- | :--- | :--- |
| **USB Implementers Forum (USB-IF) Vendor ID Registry** | USB-IF Board of Directors | [usb.org/developers](https://www.usb.org/developers) |
| **The Linux USB ID Repository (\`usb.ids\`)** | Stephen J. Gowdy & The Linux Kernel Organization | [linux-usb.org/usb.ids](http://www.linux-usb.org/usb.ids) |
`
  },
  {
    id: 'session-log',
    toolId: 'session-log',
    category: 'reference',
    title: 'Session Log & Audit Report — Hardware Telemetry & Export',
    summary: 'A running log of what the hardware tools did in this browser tab: devices you picked, confirmed or declined destructive actions, errors and tool log lines, filterable and exportable to Markdown or JSON.',
    tags: ['Session Log', 'Audit Report', 'Export', 'Markdown', 'JSON', 'Device Picker', 'Notes'],
    readTime: '12 min read',
    content: `
# Session Log & Audit Report — Workspace Telemetry & Verification

The **Session Log** panel keeps one chronological record of what the hardware tools did in this browser tab. It is meant for attaching to a ticket or keeping with a firmware dump. It is a plain log: entries are not signed or hashed, so it is not tamper-evident.

---

### 1. What Gets Recorded?

The session logging module (\`src/utils/sessionLog.js\`) records:

| Event Category | Level | Example |
| :--- | :--- | :--- |
| **Device pickers** | \`device\` | Every USB, HID, serial or Bluetooth device you choose in the browser's picker is noted with its VID:PID and name (\`Selected USB ... (1a86:7523)\`), and USB/HID unplug events are noted too. |
| **Confirmations** | \`action\` | Destructive actions that ask for confirmation log \`Confirmed: ...\` or \`Declined: ...\`. |
| **Errors** | \`error\` | Errors shown by tools (and picker failures other than cancelling, as \`warn\`). |
| **Tool log lines** | \`info\`, \`ok\`, \`warn\` | The lines tools write to the app log, attributed to the tool that was active. |
| **Your notes** | \`info\` | Free text you add yourself, listed under the tool name \`Note\`. |

Repeats of the same line from the same tool within 2 seconds fold into one entry with a count. The log keeps the newest 2,000 entries, survives a page reload (it is held in the tab's session storage) and is lost when the tab is closed. It does not automatically capture every flash write, register read or decoder transaction; only what each tool chooses to log.

---

### 2. Using the Panel & Export Formats

| Control | Purpose |
| :--- | :--- |
| **REPORT (.MD)** | Downloads a Markdown report (redacted unless you tick the box below). |
| **JSON** | Downloads the log as JSON (same redaction rule). |
| **COPY REPORT** | Copies the Markdown report to the clipboard. |
| **Include unredacted text in exports** | Off by default. Turn it on only when you need the raw text. |
| **Preview export** / **Hide export preview** | Shows exactly what the report will contain, so you can check it before sharing. |
| **OPEN JSON LOG** | Loads a previously exported JSON log for read-only viewing; **BACK TO THIS SESSION** returns. |
| **CLEAR** | Empties the log after a confirmation (hidden while viewing an imported log). |
| Tool selector, level buttons (\`info\`, \`ok\`, \`warn\`, \`error\`, \`action\`, \`device\`), **search** | Filter the table. Exports contain only the entries matching the current filters. |
| Note box + **ADD** | Appends a note (for example "swapped to the 3.3 V supply"). |

#### Redaction
Exports mask secret-shaped text: \`Bearer\` / \`Basic\` credentials, \`api_key=\`, \`token=\`, \`password=\`-style values, JWTs, private-key blocks, and long hex (32+ characters) or base64 (40+) strings. Ordinary text such as VID:PID pairs and hostnames is left alone. The report and JSON record whether redaction was on. MAC addresses and SSIDs are **not** masked by the panel's exports, so check the preview before sending a log taken during wireless work. Redaction is pattern-based and can miss unusual secrets; it is not a guarantee.

#### Markdown report (\`.md\`)
A title, a summary (time span, tools used, entry counts, browser, Web Serial / WebUSB / WebHID support, redaction state), a **Devices** list, an **Actions and errors** list, and a full **Timeline** code block with one line per entry.

#### JSON (\`.json\`)
\`\`\`json
{
  "format": "skon-session-log",
  "version": 1,
  "exported": "2026-11-06T09:30:00.000Z",
  "environment": { "userAgent": "...", "webSerial": true, "webUsb": true, "webHid": true },
  "redacted": true,
  "entries": [
    { "seq": 1, "t": 1793957400000, "tool": "app", "level": "device", "text": "Selected USB CP2102 (10c4:ea60)", "data": { "kind": "usb", "vid": "10c4", "pid": "ea60" } }
  ]
}
\`\`\`
Entries use millisecond timestamps (\`t\`), an optional \`data\` object (device IDs) and an optional repeat \`count\`.

---

### 3. Implementation & Architecture

- **Subsystem:** [\`src/utils/sessionLog.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/sessionLog.js) — in-memory entry list persisted to session storage, subscriber notify hooks, device-picker capture, and Markdown/JSON export and import.
- **Component:** [\`src/components/tools/SessionLogPanel.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/SessionLogPanel.jsx) — filterable event table, level filters, notes, import/export controls.
- **Tests:** [\`tests/sessionLog.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/sessionLog.test.js).
`
  }
];
