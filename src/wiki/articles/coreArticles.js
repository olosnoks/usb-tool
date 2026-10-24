/**
 * Core Operations Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering Terminal & Console, Firmware Flasher, and Hardware Controls & Bootstrapping
 * Sourced directly from Espressif ESP-IDF ROM specs, W3C WebSerial, and DENX U-Boot architecture.
 */

export const CORE_ARTICLES = [
  {
    id: 'terminal',
    toolId: 'terminal',
    category: 'core',
    title: 'Terminal & Console — Serial Monitor & Baud Hunter Manual',
    summary: 'Comprehensive beginner-to-advanced guide to the WebSerial monitor, ANSI terminal decoding, Baud Hunter heuristics, hex streaming, and serial troubleshooting.',
    tags: ['Terminal', 'WebSerial', 'Baud Rate', 'ANSI', 'Hex Stream', 'Logging', 'UART', 'Debugging'],
    readTime: '24 min read',
    content: `
# Terminal & Console — Serial Monitor & Baud Hunter

The **Terminal & Console** is the primary diagnostic and communication interface of Skon's USB Tool. It provides real-time, bidirectional asynchronous serial communication directly between your web browser and any connected microcontroller, single-board computer (SBC), cellular modem, radio transceiver, or industrial controller over the **W3C WebSerial API**.

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

### 4. Interactive Console Controls & Features

The Terminal toolbar provides full operational authority over the serial connection:

1. **Baud Rate Selector**: Dropdown supporting all standard and non-standard baud rates:
   \`300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880 (ESP8266 boot ROM), 115200, 230400, 460800, 921600\`.
2. **Baud Hunter Button**: Runs automated heuristic baud rate detection on active ports.
3. **Display Modes**:
   - **ASCII Mode**: Formatted text with ANSI escape sequence color rendering.
   - **Hex View Mode**: Dual-column hexadecimal and printable ASCII inspection for binary protocols.
4. **Line Endings Selector**:
   - **CRLF (\\r\\n - 0x0D 0x0A)**: Standard for AT command modems and ESP-IDF CLI.
   - **LF (\\n - 0x0A)**: Standard for MicroPython REPL, Linux shells, and Arduino \`Serial.println()\`.
   - **CR (\\r - 0x0D)**: Standard for U-Boot bootloader prompts.
   - **None**: Sends raw keystrokes without appending line terminators.
5. **Local Echo Toggle**: Displays transmitted characters directly in the console log.
6. **Timestamp Toggle**: Prefixes every incoming line with millisecond-precision timestamps (\`[12:34:56.789]\`).
7. **Auto-Scroll Toggle**: Automatically scrolls to the newest line; pauses scrolling when user manually scrolls up.
8. **Clear Buffer Button (\`Ctrl+L\`)**: Clears active terminal display without disconnecting.
9. **Export Session Log**: Downloads the complete interaction history as a timestamped \`.txt\` file.
10. **Macro Keypads**: Customizable shortcut buttons to transmit frequent commands with a single click.

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

<details>
<summary>Complete ANSI / VT100 Terminal Control Sequences (CSI & TrueColor)</summary>

Skon's USB Tool embeds a full ECMA-48 / VT100 ANSI terminal emulator supporting cursor control, screen clearing, and 24-bit RGB TrueColor palettes:

| Control Sequence | Function | Description |
| :--- | :--- | :--- |
| **\`\\x1b[2J\`** | Clear Entire Screen | Clears the terminal buffer without resetting cursor. |
| **\`\\x1b[H\`** / **\`\\x1b[1;1H\`** | Cursor Home | Moves cursor to row 1, column 1 (top-left). |
| **\`\\x1b[K\`** | Clear Line to Right | Erases characters from active cursor position to end of line. |
| **\`\\x1b[0m\`** | Reset All Attributes | Returns text styling to default grey-on-dark. |
| **\`\\x1b[1m\`** | Bold / Bright | Enhances font weight and luminance. |
| **\`\\x1b[31m\` - \`\\x1b[37m\`** | 16-Color Palette | Red (31), Green (32), Yellow (33), Blue (34), Magenta (35), Cyan (36), White (37). |
| **\`\\x1b[38;2;R;G;Bm\`** | 24-Bit RGB TrueColor | Sets 16.7 million color foreground (e.g. \`\\x1b[38;2;0;255;255m\` for Neon Cyan). |
| **\`\\x1b[48;2;R;G;Bm\`** | 24-Bit Background | Sets 24-bit background fill color. |

</details>

<details>
<summary>Hardware vs Software Flow Control & Line Break Signaling</summary>

High-speed serial streams (>230,400 baud) can overflow microcontroller internal ring buffers:
1. **Hardware Flow Control (RTS / CTS)**:
   - **RTS (Request To Send)**: Output from computer. Asserted LOW when the PC is ready to receive data.
   - **CTS (Clear To Send)**: Input to computer from device. Target drives LOW when its internal FIFO has free space.
2. **Software Flow Control (XON / XOFF)**:
   - Transmits in-band ASCII control codes: \`0x13\` (XOFF / DC3) commands the sender to halt; \`0x11\` (XON / DC1) resumes transmission.
3. **Serial Line Break Signaling**:
   - Holding the TXD line LOW (Space condition) for longer than one full character frame (typically **250ms**) asserts a hardware BREAK. Used to enter bootloader ROMs or reset microcontrollers without toggling DTR/RTS.

</details>

---

### 5. Common Terminal Issues & Solutions

| Symptom | Root Cause | Fix |
| :--- | :--- | :--- |
| Continuous \`x?x\` characters | Baud rate mismatch | Switch baud rate to 115200 (or run Baud Hunter). |
| Prompt says "No compatible devices found" | Missing USB driver or charge-only cable | Replace cable with a verified data cable; install CH340 / CP2102 drivers. |
| Terminal prints initial boot messages, then freezes | Firmware entered deep sleep or crashed | Press EN/RESET button on the board; check power supply current. |
| "Failed to open serial port: Access denied" | Port open in another app | Close Arduino IDE, VS Code serial monitor, or PuTTY. |

---

### 6. Upstream Standards & Project Attribution

| Entity / Project | Role & Contribution | Upstream Reference / Specification |
| :--- | :--- | :--- |
| **W3C WebSerial API** | W3C Community Group standard enabling direct asynchronous bidirectional serial communication between web applications and USB/UART devices. | [W3C WebSerial Spec](https://wicg.github.io/serial/) |
| **Digital Equipment Corp (DEC) & ANSI** | Creators of the VT100 / ANSI X3.64 (ECMA-48) terminal control escape sequences implemented in the WebGL/Canvas rendering pipeline. | [ECMA-48 Standard](https://www.ecma-international.org/publications-and-standards/standards/ecma-48/) |
| **xterm.js Project** | Industry-standard web terminal rendering architecture and ANSI parsing semantics upon which modern browser-based serial consoles are patterned. | [xtermjs.org](https://xtermjs.org/) |
`
  },
  {
    id: 'flasher',
    toolId: 'flasher',
    category: 'core',
    title: 'Firmware Flasher — ESP32 & ESP8266 Memory Partition Studio',
    summary: 'Master ESP-IDF ROM bootloader synchronization, high-speed baud auto-negotiation, partition tables, factory offsets, and unbricking stubs.',
    tags: ['Flasher', 'ESP32', 'ROM Bootloader', 'Partitions', 'esptool', 'Flash Memory', 'Firmware'],
    readTime: '26 min read',
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

\`\`\`text
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
| **\`0x02\`** | **FLASH_BEGIN**| Prepares flash controller, specifies byte count to write |
| **\`0x03\`** | **FLASH_DATA** | Streams 1,024-byte data blocks with sequence numbers |
| **\`0x04\`** | **FLASH_END**  | Reboots or runs uploaded stub application |
| **\`0x13\`** | **MD5_CHECK**  | Requests silicon to compute hardware MD5 hash of written bytes |

#### The RAM Stub Bootloader:
Why can the tool flash at **921,600 baud** when the ROM bootloader defaults to 115,200?
The tool uploads a tiny flasher program ("Stub Bootloader") directly into on-chip SRAM (\`0x40090000\`). The stub runs at full 240MHz CPU frequency, reconfigures the SPI peripheral for hardware DMA transfers, and validates MD5 hashes on the fly, unlocking blazing flash speeds!
</details>

<details>
<summary>Deep-Dive: Partition Table CSV Syntax & 32-Byte Binary Layout</summary>

The partition table stored at \`0x8000\` consists of 32-byte binary structures defining every zone in flash memory:

\`\`\`csv
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
app0,     app,  ota_0,   0x10000, 0x180000,
app1,     app,  ota_1,   0x190000,0x180000,
spiffs,   data, spiffs,  0x310000,0xE0000,
coredump, data, coredump,0x3F0000,0x10000,
\`\`\`

#### 32-Byte Partition Record Bitfields:
- **Bytes 0 - 1**: Magic Word (\`0xAA 0x50\`).
- **Byte 2**: Type (\`0x00\` = App, \`0x01\` = Data).
- **Byte 3**: Subtype (\`0x00\` = Factory App, \`0x10\` = OTA_0, \`0x01\` = OTA Data, \`0x82\` = SPIFFS, \`0x02\` = NVS).
- **Bytes 4 - 7**: 32-bit Starting Flash Offset (4KB aligned).
- **Bytes 8 - 11**: 32-bit Partition Size in bytes (4KB aligned).
- **Bytes 12 - 27**: Label string (Null-terminated ASCII, max 16 chars).
- **Bytes 28 - 31**: Flags (Bit 0 = \`1\` for Encrypted with hardware AES-256).

</details>

<details>
<summary>Flash Memory Clock Dividers & SPI Transfer Modes (QIO, QOUT, DIO, DOUT)</summary>

Choosing the wrong SPI transfer mode in your flasher settings will cause the microcontroller to boot-loop with \`flash read err, 1000\`!

| SPI Mode | Data Pins Used | Max Frequency | Description & Safety Rule |
| :--- | :--- | :--- | :--- |
| **QIO (Quad I/O)** | 4 lines (D0, D1, D2, D3) | 80 MHz | Fastest read speed. Requires WP and HOLD pins to be routed to flash. |
| **QOUT (Quad Output)**| 4 lines (Out only) | 80 MHz | Fast output, standard 1-line address phase. |
| **DIO (Dual I/O)** | 2 lines (D0, D1) | 40 MHz / 80 MHz | **RECOMMENDED DEFAULT.** Compatible with 100% of ESP32 DevKits. |
| **DOUT (Dual Output)**| 2 lines (Out only) | 40 MHz | Safest fallback mode for noisy breadboard wiring. |

</details>

---

### 4. Step-by-Step Flashing Procedure

#### Method A: 1-Click Curated Preset Flashing
1. Plug your ESP32 or ESP8266 development board into USB.
2. Open the **Firmware Flasher** tab in Skon's USB Tool.
3. Select a preset suite from the **Curated Firmware Presets** dropdown:
   - **ESP32 Marauder** (Wi-Fi/Bluetooth offensive auditing).
   - **Piglet Wardriver** (GPS wardriving for CYD and T-Display).
   - **Bruce Multi-Tool** (M5Stack Cardputer Swiss-Army Knife).
4. Select your exact board revision from the Board selector.
5. Click the glowing **Connect & Flash** button.
6. Select your serial port in the browser prompt.
7. The flasher automatically executes the reset sequence, connects to the ROM, negotiates 921,600 baud, erases targeted sectors, and burns the image with 100% MD5 verification!

#### Method B: Custom Multi-Binary Flashing
1. Switch to the **Custom Multi-Binary Layout** mode.
2. In Slot 1, select your bootloader binary and set offset to \`0x1000\` (Classic) or \`0x0000\` (S3/C3/C6).
3. In Slot 2, select your partition table binary and set offset to \`0x8000\`.
4. In Slot 3, select your application firmware binary and set offset to \`0x10000\`.
5. Click **Connect & Flash**.

<details>
<summary>Troubleshooting: Unbricking Boards with Failed Auto-Reset (Button Dance)</summary>

If the flasher displays:
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

---

### 5. Upstream Project & Engineering Attribution

| Project / Entity | Role & Contribution | Repository / License |
| :--- | :--- | :--- |
| **esptool-js (Espressif Systems)** | Official JavaScript implementation of the Espressif ROM bootloader protocol. Implements SLIP framing, high-speed baud switching, MD5 verification, and stub execution. | [github.com/espressif/esptool-js](https://github.com/espressif/esptool-js) (Apache-2.0) |
| **esptool.py (Espressif Systems)** | Foundational Python flash utility authored by Fredrik Ahlberg, Angus Gratton, and Espressif Systems contributors. Established ROM command opcodes, partition table specs, and register addresses. | [github.com/espressif/esptool](https://github.com/espressif/esptool) (GPL-2.0) |
| **ESP-IDF Partition Table Architecture** | The binary 32-byte partition record specification, MD5 checksum format, and SPI flash mapping defined by Espressif Systems. | [Espressif ESP-IDF Docs](https://docs.espressif.com/projects/esp-idf/) |
`
  },
  {
    id: 'hardware',
    toolId: 'hardware',
    category: 'core',
    title: 'Hardware Controls — Pin Strapping, DTR/RTS & U-Boot Interrupter',
    summary: 'Hardware-level control of USB-UART modem signals, auto-reset timing manipulation, ESP strapping pin voltages, and automated bootloader interrupts.',
    tags: ['Hardware Controls', 'DTR', 'RTS', 'Strapping Pins', 'U-Boot', 'Reset Timing', 'GPIO0', 'EN'],
    readTime: '20 min read',
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

\`\`\`text
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

<details>
<summary>U-Boot Command Prompt Environment Variable Reference & Kernel Boot Commands</summary>

Once halted at the \`=>\` prompt, engineers use these low-level U-Boot commands to recover routers and single-board computers:

| Command | Action & Example | Diagnostic Purpose |
| :--- | :--- | :--- |
| **\`printenv\`** | Dumps all active bootloader environment variables. | Inspects kernel boot arguments, MAC addresses, and memory load addresses. |
| **\`setenv bootargs\`** | \`setenv bootargs "console=ttyS0,115200 root=/dev/mmcblk0p2 rw init=/bin/sh"\` | Bypasses Linux password authentication by booting directly into root single-user shell. |
| **\`md.b <addr> <count>\`** | \`md.b 0x20000000 0x100\` | Memory Dump: Reads and prints raw hexadecimal bytes directly from physical RAM. |
| **\`mw.b <addr> <val> <cnt>\`**| \`mw.b 0x20000000 0x00 0x100\` | Memory Write: Writes byte values directly to peripheral registers or SRAM. |
| **\`tftpboot <addr> <file>\`** | \`tftpboot 0x82000000 uImage\` | Downloads recovery kernel image over Ethernet via TFTP without booting operating system. |
| **\`bootm <addr>\`** | \`bootm 0x82000000\` | Executes application or Linux kernel residing at the specified memory address. |
| **\`reset\`** | Restarts CPU and re-executes cold hardware initialization. | Reboot target. |

</details>

---

### 5. Upstream Project & Engineering Attribution

| Project / Hardware Standard | Role & Contribution | Reference & License |
| :--- | :--- | :--- |
| **NodeMCU & Espressif Dual-BJT Auto-Reset Circuit** | Open-source hardware circuit design utilizing cross-coupled NPN transistors (Q1/Q2) on DTR/RTS lines to automate EN/GPIO0 sequencing without manual button interaction. | [NodeMCU Hardware DevKit](https://github.com/nodemcu/nodemcu-devkit-v1.0) (MIT / OSHWA) |
| **Das U-Boot (Universal Boot Loader)** | The embedded Linux bootloader created by Wolfgang Denk and maintained by DENX Software Engineering. Defines the autoboot countdown interruption sequence (\`Space\` / \`Enter\` / \`Ctrl+C\`) and environment manipulation shell. | [source.denx.de/u-boot/u-boot](https://source.denx.de/u-boot/u-boot) (GPL-2.0) |
| **W3C WebSerial Signal Control API** | The \`SerialPort.prototype.setSignals()\` specification allowing direct software manipulation of DTR and RTS modem control lines from the browser. | [W3C Serial API Signals Spec](https://wicg.github.io/serial/#dom-serialport-setsignals) |
`
  }
];
