/**
 * Core Operations Wiki Articles — Comprehensive Interactive Technical Manual
 * Covering Terminal & Console, Firmware Flasher, and Hardware Controls & Bootstrapping
 * Utilizing interactive <details> and <summary> disclosure elements for deep technical reference
 */

export const CORE_ARTICLES = [
  {
    id: 'terminal',
    toolId: 'terminal',
    category: 'core',
    title: 'Terminal & Console — Serial Monitor & Baud Hunter Manual',
    summary: 'Comprehensive beginner-to-advanced guide to the WebSerial monitor, ANSI terminal decoding, Baud Hunter heuristics, hex streaming, and serial troubleshooting.',
    tags: ['Terminal', 'WebSerial', 'Baud Rate', 'ANSI', 'Hex Stream', 'Logging', 'UART', 'Debugging'],
    readTime: '14 min read',
    content: `
# Terminal & Console — Serial Monitor & Baud Hunter

The **Terminal & Console** is the primary diagnostic and communication interface of Skon's USB Tool. It provides real-time, bidirectional asynchronous serial communication directly between your web browser and any connected microcontroller, single-board computer (SBC), cellular modem, radio transceiver, or industrial controller.

---

### 1. What Is This Tool & Why Do You Need It?

When you connect a hardware device to your computer via USB (such as an ESP32, Arduino, Raspberry Pi Pico, or GPS module), the device communicates using **UART (Universal Asynchronous Receiver-Transmitter)** serial signals. Traditionally, interacting with UART required installing desktop utilities like PuTTY, TeraTerm, screen, minicom, or the Arduino IDE Serial Monitor.

The **Terminal & Console** eliminates all desktop software requirements. Using modern browser standards, it opens a raw hardware communication pipe, decodes streaming text, colors terminal output using ANSI VT100 escape sequences, captures raw hexadecimal streams, and provides an intelligent auto-detection engine ("Baud Hunter") to discover unknown baud rates.

---

### 2. How Serial (UART) Works Under the Hood

Unlike SPI or I2C, UART is **asynchronous** — there is no shared clock wire between the computer and the device. Both sides must independently agree on the exact timing of each transmitted bit.

#### The Physical Layer (RS-232 vs TTL)
- **TTL Serial (3.3V / 5V)**: Modern microcontrollers use TTL logic levels. A digital \`1\` (Mark/Idle) is +3.3V (or +5V), and a digital \`0\` (Space) is 0V (GND).
- **RS-232 (+12V / -12V)**: Legacy serial ports invert and amplify voltages (-12V is \`1\`, +12V is \`0\`). *Never connect raw RS-232 to an ESP32 without an RS-232 transceiver (e.g. MAX3232), or you will destroy the chip!*

<details>
<summary>Deep-Dive: UART Frame Timing, Bit Anatomy & Sampling Calculations</summary>

Every character sent over UART is encapsulated in a strict framing envelope:
1. **Idle Line**: Held continuously at logical HIGH (+3.3V).
2. **Start Bit (1 bit)**: The transmitter drives the line LOW (0V) for exactly 1 bit duration. This falling edge triggers the receiver's internal hardware timer.
3. **Data Bits (8 bits)**: Transmitted Least Significant Bit (LSB) first to Most Significant Bit (MSB).
4. **Parity Bit (None)**: Optional error checking bit (Rare in modern hardware, default: 'None').
5. **Stop Bit (1 bit)**: Pulled HIGH (+3.3V) to reset the receiver's state machine.

#### Bit Duration Formula:
\`\`\`text
Bit Duration (Seconds) = 1 / Baud Rate
\`\`\`
- At **9,600 baud**: 1 bit = \`104.16 microseconds\`.
- At **115,200 baud**: 1 bit = \`8.68 microseconds\`.
- At **921,600 baud**: 1 bit = \`1.085 microseconds\`.

The receiver samples the line at **16x oversampling** (sampling in the dead center at the 8th clock tick) to ensure noise immunity. If the clocks diverge by more than **3.0%**, sampling drifts into adjacent bit boundaries, turning text into garbage!
</details>

---

### 3. Hardware Wiring Guide (Beginner Friendly)

If connecting an external USB-to-UART bridge (CH340, CP2102, FT232R) to a bare microcontroller or GPS module:

| USB-UART Adapter Pin | Target Device Pin | Rationale |
| :--- | :--- | :--- |
| **GND (Ground)** | **GND (Ground)** | **MANDATORY.** Provides the 0V reference voltage. Without common ground, communication is 100% impossible. |
| **TXD (Transmit)** | **RXD (Receive)** | The adapter's output wire must connect to the target's input wire (Crossed). |
| **RXD (Receive)** | **TXD (Transmit)** | The adapter's input wire must connect to the target's output wire (Crossed). |
| **3.3V / 5V (Power)** | **VCC / VIN** | Only connect if you want to power the board from the USB adapter. Verify logic voltage rating! |

> **Beginner Trap #1 — The TX/RX Reversal**:
> If you connect TX to TX and RX to RX, no data will flow. Think of TX as a mouth and RX as an ear. Mouth connects to ear!

> **Beginner Trap #2 — Missing Common Ground**:
> If your microcontroller is powered by an external battery or wall adapter, you MUST still run a ground wire between the USB adapter's GND and the microcontroller's GND. Without a shared 0V reference, the logic voltages float unpredictably.

---

### 4. Step-by-Step Walkthrough in Skon's USB Tool

1. **Plug in your device**: Connect your development board via USB.
2. **Select Baud Rate**: Click the Baud Rate dropdown in the header or terminal toolbar.
   - For ESP32 boot logs and firmware: Select **115200**.
   - For standard Arduino Uno/Nano: Select **9600** or **115200**.
   - For GPS modules: Select **9600** (default NMEA) or **115200**.
   - For 3D Printers (Marlin/Klipper): Select **115200** or **250000**.
3. **Open Port**: Click the glowing **CONNECT** button.
4. **Grant Browser Permission**: A browser prompt will appear listing all detected serial devices. Select your device (e.g., *USB-Serial Controller*, *CP2102 USB to UART Bridge*, or *USB JTAG/serial debug unit*) and click **Connect**.
5. **Observe Real-Time Stream**: The terminal displays incoming data instantly with millisecond timestamps and ANSI syntax highlighting.

---

### 5. Advanced Terminal Features

<details>
<summary>Deep-Dive: How Baud Hunter Automatically Detects Unknown Frequencies</summary>

When you click **Baud Hunter**, the engine executes a multi-stage heuristic analysis:
1. Temporarily claims the WebSerial port and loops through standard test rates:
   \`300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880 (ESP8266 boot ROM), 115200, 230400, 460800, 921600\`.
2. For each baud rate, it listens for a 250ms sample window.
3. It counts:
   - **UART Framing Errors**: Occurs when stop bits fail to settle HIGH.
   - **Printable ASCII Distribution**: Checks if received bytes fall within \`0x20\` to \`0x7E\` or common control bytes (\`\\r\`, \`\\n\`, \`\\t\`).
   - **Shannon Entropy**: Measures randomness vs linguistic patterns.
4. The candidate with the highest ASCII density and lowest framing error count is automatically locked and set as active!
</details>

#### Line Endings (CR / LF / CRLF / HEX)
When typing commands into the bottom input bar, choose the appropriate terminator for your firmware:
- **CRLF (\\r\\n - 0x0D 0x0A)**: Required by AT command cellular/Wi-Fi modems and ESP-IDF CLI.
- **LF (\\n - 0x0A)**: Standard for MicroPython REPL, Linux shells, and Arduino \`Serial.readStringUntil('\\n')\`.
- **CR (\\r - 0x0D)**: Used by classic U-Boot bootloader prompts.
- **HEX Mode**: Type raw hexadecimal bytes separated by spaces (e.g. \`AA 55 01 FE 00\`) to test custom binary protocols.

---

### 6. Common Terminal Issues & Solutions

| Symptom | Root Cause | Fix |
| :--- | :--- | :--- |
| Continuous \`x?x\` characters | Baud rate mismatch | Switch baud rate to 115200 (or run Baud Hunter). |
| Prompt says "No compatible devices found" | Missing USB driver or charge-only cable | Replace cable with a verified data cable; install CH340 / CP2102 drivers. |
| Terminal prints initial boot messages, then freezes | Firmware entered deep sleep or crashed | Press EN/RESET button on the board; check power supply current. |
| "Failed to open serial port: Access denied" | Port open in another app | Close Arduino IDE, VS Code serial monitor, or PuTTY. |
`
  },
  {
    id: 'flasher',
    toolId: 'flasher',
    category: 'core',
    title: 'Firmware Flasher — ESP32 & ESP8266 Memory Partition Studio',
    summary: 'Master ESP-IDF ROM bootloader synchronization, high-speed baud auto-negotiation, partition tables, factory offsets, and unbricking stubs.',
    tags: ['Flasher', 'ESP32', 'ROM Bootloader', 'Partitions', 'esptool', 'Flash Memory', 'Firmware'],
    readTime: '17 min read',
    content: `
# Firmware Flasher — Memory Partition Studio

The **Firmware Flasher** is an industrial-grade in-browser microcontroller flashing engine. Built on the Espressif ESP-IDF ROM bootloader protocol, it allows you to burn complete operating systems, partition tables, bootloaders, and filesystems into flash memory across the entire ESP32 and ESP8266 silicon families without installing Python, pip, or esptool.py.

---

### 1. What Is This Tool & Why Do You Need It?

Microcontrollers execute code stored in non-volatile **SPI Flash Memory**. To update the program, the microcontroller's CPU must be halted and placed into a specialized hardware bootloader mode where it listens for write commands over its primary serial port.

Historically, this required:
1. Installing Python.
2. Installing Espressif command-line tools (\`esptool.py\`).
3. Manually calculating hexadecimal byte offsets (\`0x1000\`, \`0x8000\`, \`0x10000\`).
4. Typing complex terminal commands with exact COM port numbers.

The **Firmware Flasher** handles all of this automatically in your browser. It auto-identifies your connected silicon, negotiates the fastest reliable transfer speed, checks MD5 checksums block-by-block, and flashes curated security/diagnostic suites or custom multi-binary partition layouts with 1 click.

---

### 2. Supported Silicon Families

| Silicon Family | CPU Architecture | Max Flashing Baud | Bootloader Offset | App0 Offset |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32 Classic** | Dual-Core Xtensa LX6 @ 240MHz | 921,600 bps | \`0x1000\` | \`0x10000\` |
| **ESP32-S2** | Single-Core Xtensa LX7 (USB OTG) | 921,600 bps | \`0x1000\` | \`0x10000\` |
| **ESP32-S3** | Dual-Core Xtensa LX7 + Vector AI | 921,600 bps | \`0x0000\` | \`0x10000\` |
| **ESP32-C3** | Single-Core RISC-V 32-bit | 921,600 bps | \`0x0000\` | \`0x10000\` |
| **ESP32-C5 Beta**| Single-Core RISC-V Dual-Band 2.4/5GHz | 115,200 bps (Direct ROM) | \`0x0000\` | \`0x10000\` |
| **ESP32-C6** | Single-Core RISC-V Wi-Fi 6 + Zigbee | 921,600 bps | \`0x0000\` | \`0x10000\` |
| **ESP8266** | Tensilica L106 32-bit | 460,800 bps | N/A | \`0x00000\` |

---

### 3. Understanding Flash Memory Architecture & Partitions

When flashing an ESP32, you are not writing to a single monolithic hard drive. The SPI flash chip (typically 4MB, 8MB, or 16MB) is divided into strict memory sectors:

\`\`\`
FLASH MEMORY MAP (Standard 4MB ESP32)
0x00000000 +-----------------------------------+
           | ROM Bootloader Vector (S3/C3/C6)  |
0x00001000 +-----------------------------------+
           | First-Stage Bootloader (Classic)  | Initializes DDR/Flash cache, loads partition table
0x00008000 +-----------------------------------+
           | Partition Table (partition.bin)   | Binary index table listing all flash zones below
0x00009000 +-----------------------------------+
           | NVS (Non-Volatile Storage)        | Stores Wi-Fi SSIDs, passwords, calibration data
0x0000E000 +-----------------------------------+
           | Boot App0 (otadata)               | Selects whether factory or OTA update partition boots
0x00010000 +-----------------------------------+
           | Factory Application (firmware.bin)| YOUR COMPILED C++ / ARDUINO CODE LIVES HERE
0x00200000 +-----------------------------------+
           | SPIFFS / LittleFS Filesystem      | Web files (HTML/CSS/JS), captive portals, wordlists
0x003FFFFF +-----------------------------------+ (End of 4MB Flash)
\`\`\`

<details>
<summary>Deep-Dive: The ESP-IDF SLIP Framing & Flash Command Protocol</summary>

All communication with the ESP32 ROM bootloader uses **SLIP (Serial Line Internet Protocol)** framing:
- **Delimiter**: Packets begin and end with \`0xC0\`.
- **Escaping**: If \`0xC0\` occurs in data, it is escaped as \`0xDB 0xDC\`. If \`0xDB\` occurs, it is escaped as \`0xDB 0xDD\`.

#### Master ROM Bootloader Command Opcodes:
| Opcode (Hex) | Command Name | Description |
| :--- | :--- | :--- |
| **\`0x08\`** | **SYNC** | Sends \`0x07 0x07 0x12 0x20\` to sync UART baud timing |
| **\`0x0A\`** | **READ_REG** | Reads 32-bit hardware register or eFuse word |
| **\`0x09\`** | **WRITE_REG**| Writes 32-bit register value |
| **\`0x24\`** | **CHANGE_BAUD**| Commands ROM to accelerate from 115,200 to 921,600 baud |
| **\`0x02\`** | **FLASH_BEGIN**| Erases flash sectors and prepares for incoming blocks |
| **\`0x03\`** | **FLASH_DATA** | Transmits 4,096-byte flash block with sequence number |
| **\`0x04\`** | **FLASH_END** | Flushes write buffers and resets flash status |
| **\`0x13\`** | **SPI_ATTACH** | Initializes hardware SPI pins for flash communication |
</details>

---

### 4. Step-by-Step Usage Guide

#### Option A: 1-Click Curated Presets
1. Select your target suite from the **Curated Presets** dropdown:
   - *Piglet Wardriver Suite* (All 7 hardware targets).
   - *RocketGod Pentesting Suite* (Evil Portal, Marauder WROOM, Minino C6, Hash Monster).
   - *Bruce Multi-Tool* (M5Stack, Cardputer, ESP32).
   - *ESP32 Marauder Official* (JustCallMeKoko).
2. Choose your exact board model from the Board selector.
3. Connect your board via USB.
4. Click **Connect & Flash**. Select your COM port in the browser popup.
5. Watch the real-time progress bar. Once completed, your board will reboot with the new firmware running!

#### Option B: Flashing Custom Multi-Binary Layouts
1. Switch the mode toggle to **Custom Binaries**.
2. Click **+ Add Partition**.
3. Enter the target hexadecimal offset (e.g. \`0x10000\` for firmware or \`0x8000\` for partition tables).
4. Browse and select your \`.bin\` file from your local disk.
5. Repeat for any additional partitions (e.g. SPIFFS at \`0x200000\`).
6. Optional: Check **Full Chip Erase** if wiping old credentials or upgrading across major SDK versions.
7. Click **Flash Partitions**.

<details>
<summary>Manual Bootloader Recovery Guide: The Two-Button Reset Dance</summary>

If your development board has weak pull-up resistors or lacks the transistor auto-reset circuit, it may get stuck on:
\`\`\`text
Connecting... (Timed out waiting for packet header)
\`\`\`
**Perform the Manual Button Dance**:
1. Locate the two physical push buttons on your board: **BOOT** (or GPIO0) and **RESET** (or EN).
2. **Press and HOLD the BOOT button**.
3. While continuing to hold BOOT, **press the RESET button once** and release it.
4. Release the **BOOT button**.
5. Your board is now locked in ROM download mode. Click **Connect & Flash** in the web tool, and it will sync immediately!
</details>
`
  },
  {
    id: 'hardware',
    toolId: 'hardware',
    category: 'core',
    title: 'Hardware Controls — Pin Strapping, DTR/RTS & U-Boot Interrupter',
    summary: 'Hardware-level control of USB-UART modem signals, auto-reset timing manipulation, ESP strapping pin voltages, and automated bootloader interrupts.',
    tags: ['Hardware Controls', 'DTR', 'RTS', 'Strapping Pins', 'U-Boot', 'Reset Timing', 'GPIO0', 'EN'],
    readTime: '12 min read',
    content: `
# Hardware Controls — Pin Strapping & Signal Timing

The **Hardware Controls** workbench gives you physical-level authority over the modem status signals of your USB-to-UART adapter. It is essential for troubleshooting stubborn boot sequences, unbricking development boards, testing power resets, and breaking into bootloader consoles.

---

### 1. What Is This Tool & Why Do You Need It?

USB-to-UART bridge ICs (such as the CH340, CP2102, or FT232R) have more than just TX and RX pins. They include hardware handshaking lines:
- **DTR (Data Terminal Ready)**
- **RTS (Request To Send)**

On almost all microcontroller development boards (NodeMCU, ESP32 DevKit, Arduino), these two pins are wired to a pair of bipolar junction transistors (BJTs) that control the microcontroller's **EN (RESET)** and **GPIO0 (BOOT)** pins.

The **Hardware Controls** workbench lets you bypass software automation and manually command these physical pins, send timed reset pulses, or continuously spam interrupt keys to catch bootloader shells on embedded Linux systems.

---

### 2. The Classic Auto-Reset Transistor Circuit

To understand what happens when you click buttons in this workbench, examine the standard transistor auto-reset circuit used across the industry:

\`\`\`
           +3.3V
             |
            [10k Pull-Up]
             |
DTR ----\\___/---- Base Q1 ---> Collector connected to ESP RESET (EN)
RTS ----/   \\---- Base Q2 ---> Collector connected to ESP GPIO0 (BOOT)
\`\`\`

<details>
<summary>Deep-Dive: Complete Auto-Reset Transistor Truth Table & Signal States</summary>

| DTR Line | RTS Line | Transistor Q1 (EN) | Transistor Q2 (GPIO0) | Resulting Silicon State |
| :---: | :---: | :---: | :---: | :--- |
| **1 (HIGH)** | **1 (HIGH)** | OFF (EN pulled HIGH via 10k) | OFF (GPIO0 pulled HIGH) | **Normal Run Mode** (Executes user app) |
| **0 (LOW)** | **1 (HIGH)** | **ON (Pulls EN to 0V)** | OFF (GPIO0 remains HIGH) | **Hardware Reset** (Held in reset) |
| **1 (HIGH)** | **0 (LOW)** | OFF (EN remains HIGH) | **ON (Pulls GPIO0 to 0V)** | GPIO0 pulled LOW (Prepares for download) |
| **0 (LOW)** | **0 (LOW)** | OFF (Both cancel out) | OFF (Both cancel out) | Idle protected state |
</details>

---

### 3. Critical Strapping Pins by Architecture

When the \`EN\` pin rises from 0V to 3.3V (power-on or reset release), the internal hardware ROM samples the voltage on several specific GPIOs known as **Strapping Pins**.

#### ESP32 Classic Strapping Pins
- **GPIO0**:
  - \`HIGH (3.3V)\`: Boots from internal SPI flash.
  - \`LOW (0V)\`: Enters ROM serial download bootloader mode.
- **GPIO2**: Must be left floating or pulled LOW during boot. If pulled HIGH, entering download mode will fail on some silicon revisions.
- **GPIO12 (MTDI)**: Selects internal SPI flash voltage regulator:
  - \`LOW (0V)\`: 3.3V flash (Standard for 99% of modules).
  - \`HIGH (3.3V)\`: 1.8V flash.
  - *Warning: If an external sensor pulls GPIO12 HIGH during boot, the ESP32 under-volts its own flash chip and bootloops with a flash read error!*
- **GPIO15**: Must be pulled HIGH (or floating) during boot. Outputs UART boot log clock.

<details>
<summary>Deep-Dive: ESP32-S3 / C3 / C6 Modern Strapping Differences</summary>

In newer RISC-V and Xtensa architectures (ESP32-S3, C3, C6):
- **GPIO0 (S3) / GPIO9 (C3 / C6)**: Serves as the primary bootloader strapping pin.
- **Internal Weak Pull-Ups**: Modern Espressif SoCs integrate 45kΩ internal pull-up resistors on boot pins to eliminate floating states.
- **Native USB-JTAG/Serial Mode**: If GPIO0/GPIO9 is pulled LOW on boot, the native USB peripheral exposes the built-in USB bootloader directly, bypassing external USB-UART chips!
</details>

---

### 4. Interactive Workbench Features

#### 1. Manual DTR / RTS Line Toggles
Click the **DTR** or **RTS** buttons to force lines HIGH or LOW:
- Set **DTR to LOW** to hold your microcontroller in permanent hardware reset while you inspect pin voltages with a multimeter or wire logic probes.
- Set **DTR to HIGH** to release reset and allow the processor to run.

#### 2. Trigger Auto-Reset
Generates a hardware-timed reset cycle:
- Pulses the \`EN\` line LOW for a configurable duration (50ms to 500ms).
- **Pro Tip**: If your board has a large capacitor on the reset line (e.g. 10uF for noise filtering), standard 50ms pulses might not discharge the capacitor completely. Increase the pulse slider to **250ms** for 100% reliable reset triggering.

#### 3. U-Boot Console Interrupter
When working with Linux Single Board Computers (Raspberry Pi, Orange Pi, Banana Pi, OpenWrt Wi-Fi routers, IP cameras):
- The U-Boot bootloader provides a recovery shell to re-flash Linux kernels, dump flash memory, or bypass root passwords.
- U-Boot only pauses autoboot if it receives a keypress (Space, Enter, or \`Ctrl+C\`) within a narrow 1-second countdown window after power-on.
- **How to Use**: Click **Start U-Boot Interrupter**. Power cycle or reset your board. The tool spams interrupt characters 50 times per second until U-Boot halts and opens the \`=>\` prompt!
`
  }
];
