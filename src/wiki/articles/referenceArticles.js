/**
 * Reference & Troubleshooting Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering Setup & Driver Configuration, Hardware Bench Troubleshooting, Pinout References,
 * and Chip Intelligence / Silicon Identification.
 */

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

#### Step 2: Install Universal udev Rule
Create \`/etc/udev/rules.d/99-usb-serial-workbench.rules\` with root privileges:
\`\`\`text
# WCH CH340 / CH341
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="7523", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"
SUBSYSTEM=="tty", ATTRS{idVendor}=="1a86", ATTRS{idProduct}=="5523", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"

# Silicon Labs CP2102 / CP2104
SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"

# FTDI FT232R / FT2232H
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6001", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"
SUBSYSTEM=="tty", ATTRS{idVendor}=="0403", ATTRS{idProduct}=="6010", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"

# Espressif ESP32-S2 / S3 / C3 / C6 Native USB CDC
SUBSYSTEM=="tty", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="1001", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"

# Flipper Zero CDC
SUBSYSTEM=="tty", ATTRS{idVendor}=="20a0", ATTRS{idProduct}=="415a", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"

# Proxmark3 RDV4 / Easy
SUBSYSTEM=="tty", ATTRS{idVendor}=="9ac4", ATTRS{idProduct}=="4b8f", MODE="0666", ENV{ID_MM_DEVICE_IGNORE}="1"
\`\`\`

#### Step 3: Reload udev Rules
\`\`\`bash
sudo udevadm control --reload-rules && sudo udevadm trigger
\`\`\`
Setting \`ENV{ID_MM_DEVICE_IGNORE}="1"\` permanently prevents ModemManager from interfering with your hardware workbench ports!
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

---

### 3. macOS Device Nodes & Permissions

On macOS, WebSerial displays devices with paths like \`/dev/cu.usbserial-*\` and \`/dev/tty.usbserial-*\`:
- **Always select the \`/dev/cu.*\` (Call-Up) node**: The \`cu\` node opens immediately without waiting for Carrier Detect (CD) line assertions.
- The \`tty.*\` node can block indefinitely if modem control signals are not asserted by the target device!

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
    toolId: 'troubleshooting',
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
| **\`Timed out waiting for packet header (0x08)\`** | The microcontroller failed to enter ROM download mode during auto-reset. | 1. Increase auto-reset pulse width to **250ms**.<br>2. Perform manual button dance: Hold BOOT, press and release RESET, release BOOT. |
| **\`MD5 of file does not match byte written\`** | Power supply voltage sag (brownout) during high-current flash write cycles. | Connect board to a powered USB hub or short, shielded USB-C data cable. Avoid unpowered USB keyboard pass-through ports. |
| **\`Framing Error / Continuous \`x?x\` characters\`** | Baud rate mismatch or crystal oscillator clock drift. | Click **Baud Hunter** in the terminal toolbar to automatically identify the target's transmission frequency. |
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
    title: 'Pinouts Reference — ESP32, S3, C3, C6 & USB Wiring Maps',
    summary: 'Hardware pinout diagrams, SPI/I2C/UART pin assignments, strapping pins, and USB Type-A / Type-C CC resistor specifications.',
    tags: ['Pinouts', 'Wiring', 'ESP32', 'ESP32-S3', 'ESP32-C3', 'ESP32-C6', 'USB-C', 'Hardware'],
    readTime: '20 min read',
    content: `
# Pinouts Reference — Microcontrollers & USB Wiring

This reference compiles physical pinout maps, bus assignments, hardware strapping pins, and USB wiring standards across the most common embedded hardware targets.

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
> **GPIO 34, 35, 36 (VP), 39 (VN)** have no internal pull-up or pull-down resistors and cannot be used as digital outputs. They are strictly ADC analog inputs!

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
    summary: 'Lookup USB Vendor IDs (VID) and Product IDs (PID) to identify mystery boards, USB-UART bridge ICs, and development hardware.',
    tags: ['Chip Intel', 'VID/PID', 'USB IDs', 'WCH', 'Silicon Labs', 'FTDI', 'Espressif', 'Identification'],
    readTime: '16 min read',
    content: `
# Chip Intelligence — USB Hardware Identification

Every USB device announces a 16-bit **Vendor ID (VID)** and 16-bit **Product ID (PID)** during USB enumeration. The **Chip Intelligence Engine** inspects these identifiers against an embedded database of over 1,000 silicon definitions to identify mystery development boards, bridge chips, and RF instruments.

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
| **\`0x303A\`** | **\`0x1001\`** | Espressif Systems | ESP32-S3 / C3 / C6 | Built-in native USB CDC / JTAG controller on the SoC die |
| **\`0x2E8A\`** | **\`0x000A\`** | Raspberry Pi Ltd | RP2040 / Pico | Official Raspberry Pi dual-core ARM microcontroller CDC |
| **\`0x0483\`** | **\`0x5740\`** | STMicroelectronics | STM32F103 / F401 / F411 | Virtual COM Port on BluePill and BlackPill development boards |
| **\`0x1D50\`** | **\`0x6089\`** | Great Scott Gadgets | HackRF One | PortaPack SDR radio transceiver USB interface |
| **\`0x20A0\`** | **\`0x415A\`** | Flipper Devices Inc. | Flipper Zero | Flipper Zero USB virtual communication port & RPC interface |
| **\`0x9AC4\`** | **\`0x4B8F\`** | RFID Research Group | Proxmark3 RDV4 / Easy | RFID & NFC research and emulation instrument |

---

### Upstream Standards & Engineering Attribution

| Database / Standard | Maintainer & Authority | Reference |
| :--- | :--- | :--- |
| **USB Implementers Forum (USB-IF) Vendor ID Registry** | USB-IF Board of Directors | [usb.org/developers](https://www.usb.org/developers) |
| **The Linux USB ID Repository (\`usb.ids\`)** | Stephen J. Gowdy & The Linux Kernel Organization | [linux-usb.org/usb.ids](http://www.linux-usb.org/usb.ids) |
| **Silicon Decapping & Reverse Engineering Archives** | Zeptobars Silicon Photography & SparkFun Electronics Counterfeit IC Archives | [zeptobars.com](https://zeptobars.com) / [sparkfun.com](https://www.sparkfun.com) |
`
  }
];
