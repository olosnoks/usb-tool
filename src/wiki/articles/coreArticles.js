/**
 * Core Operations Wiki Articles
 * Covering Terminal & Console, Firmware Flasher, and Hardware Controls & Bootstrapping
 */

export const CORE_ARTICLES = [
  {
    id: 'terminal',
    toolId: 'terminal',
    category: 'core',
    title: 'Terminal & Console — Serial Monitor & Baud Hunter',
    summary: 'Master the high-performance WebSerial terminal, ANSI color renderer, Baud Hunter heuristic analyzer, and raw hex streaming.',
    tags: ['Terminal', 'WebSerial', 'Baud Rate', 'ANSI', 'Hex Stream', 'Logging'],
    readTime: '6 min read',
    content: `
# Terminal & Console — Serial Monitor & Baud Hunter

The **Terminal & Console** provides a low-latency, bidirectional serial communication interface directly between your browser and any connected microcontrollers, SBCs, cellular modems, or diagnostic equipment.

---

### How It Works Under the Hood

The terminal communicates via the browser's native **Web Serial API** (\`navigator.serial\`):
1. **Readable Stream Pipeline**: Bytes received from the hardware are read via \`readable.getReader()\`.
2. **Decoding Engine**: Raw \`Uint8Array\` streams pass through a stream-safe \`TextDecoder('utf-8')\` pipeline with fatal error fallback.
3. **ANSI Escape Processor**: Escape codes (VT100 / ANSI color sequences such as \`\\x1b[31m\` for red, \`\\x1b[1m\` for bold, and cursor repositions) are parsed into styled DOM elements in real time.
4. **Hex Byte Mirroring**: Incoming bytes are simultaneously mirrored to a circular FIFO ring buffer for byte-level inspection in the Hex Stream analyzer without slowing down the text UI.

---

### Key Features & How to Use Them

#### 1. Baud Rate Selection & The "Baud Hunter"
Standard serial communication requires matching baud rates on both ends. If the rate is incorrect, you will see garbage characters (\`\`) or framing errors.

- **Manual Selection**: Use the dropdown to choose from standard rates (9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000, 2000000 bps).
- **Baud Hunter (Automatic Detection)**: Click **Baud Hunter** when inspecting mystery hardware. It opens the port, cycles through candidate baud rates, samples incoming framing bits, checks UART stop/start parity validity, and locks onto the rate yielding valid ASCII/UTF-8 character distributions.

#### 2. Line Termination Modes
When sending commands in the bottom input bar, choose the appropriate line ending:
| Line Ending | Bytes Sent | Typical Target |
| :--- | :--- | :--- |
| **CRLF (\\r\\n)** | \`0x0D 0x0A\` | AT modems, ESP-IDF CLI, Windows serial consoles |
| **LF (\\n)** | \`0x0A\` | Linux shell, MicroPython REPL, Arduino standard |
| **CR (\\r)** | \`0x0D\` | Old Mac terminals, U-Boot bootloader prompts |
| **None** | No extra byte | Raw binary commands, keystroke passthrough |
| **HEX Mode** | Interprets space-separated hex | Direct binary protocol testing (e.g. \`0xAA 0x55 0x01\`) |

#### 3. Log Capture & Export
- **Clear**: Clears the active DOM scrollback buffer to free browser memory during high-frequency telemetry.
- **Copy**: Copies the entire raw text scrollback to your clipboard.
- **Export / Save**: Downloads the session log as a timestamped \`.txt\` file for documentation or bug reports.
- **Auto-Scroll Lock**: Toggle the anchor icon to pause auto-scrolling while reviewing past lines without dropping newly arrived data.

---

### Pro Tips & Troubleshooting
> **Framing Error Warning**: If you see intermittent gibberish, verify your ground wire. A missing common ground between the USB-UART adapter and target board is the #1 cause of framing errors.
> **Port Sharing**: WebSerial takes exclusive control of the COM port. Make sure Arduino IDE, PuTTY, or Cura are closed before connecting.
`
  },
  {
    id: 'flasher',
    toolId: 'flasher',
    category: 'core',
    title: 'Firmware Flasher — ESP32 & ESP8266 Multi-Partition Studio',
    summary: 'Complete guide to flashing firmware binaries, partition tables, bootloaders, and presets to ESP32, S2, S3, C2, C3, C5, C6, and ESP8266.',
    tags: ['Flasher', 'ESP32', 'ROM Bootloader', 'Partitions', 'esptool', 'Flash Memory'],
    readTime: '8 min read',
    content: `
# Firmware Flasher — Multi-Partition Studio

The **Firmware Flasher** is an in-browser flashing engine built on the ESP-IDF ROM bootloader protocol. It enables 1-click flashing of curated security and diagnostic firmwares as well as custom multi-binary partition layouts.

---

### Supported Silicon Architectures

| Chip Family | Architecture | Supported ROM Bauds | Default App Offset |
| :--- | :--- | :--- | :--- |
| **ESP32** | Xtensa Dual-Core 32-bit LX6 | Up to 921,600 | \`0x10000\` |
| **ESP32-S2** | Xtensa Single-Core 32-bit LX7 | Up to 921,600 | \`0x10000\` |
| **ESP32-S3** | Xtensa Dual-Core LX7 + Vector | Up to 921,600 | \`0x10000\` |
| **ESP32-C3** | RISC-V 32-bit Single-Core | Up to 921,600 | \`0x10000\` |
| **ESP32-C5** | RISC-V 32-bit Dual-Band 2.4/5GHz | 115,200 (Direct ROM) | \`0x10000\` |
| **ESP32-C6** | RISC-V 32-bit Wi-Fi 6 + Zigbee/Thread | Up to 921,600 | \`0x10000\` |
| **ESP8266** | Tensilica L106 32-bit | Up to 460,800 | \`0x00000\` |

---

### How the Flashing Protocol Works

1. **Bootstrap Synchronization**: The flasher asserts DTR/RTS signals to put the ESP chip into ROM download mode. It sends a continuous stream of \`0x08\` SYNC bytes framed with SLIP delimiters (\`0xC0\`) until the ROM acknowledges.
2. **Chip Identification**: The tool reads hardware eFuses to detect the exact silicon revision, MAC address, flash voltage rating (3.3V vs 1.8V), and hardware crystal frequency.
3. **High-Speed Baud Negotiation**: After initial sync at 115,200 bps, the flasher commands the ROM bootloader to switch to high speed (typically 460,800 or 921,600 bps) to dramatically speed up flashing.
4. **Flash Erase & Block Writing**:
   - Sends \`FLASH_BEGIN\` with target flash offset and size.
   - Streams 4096-byte blocks using \`FLASH_DATA\` packets with sequence numbers.
   - Validates each packet using hardware MD5 checksum calculations.
   - Sends \`FLASH_END\` to flush buffers and verify write integrity.
5. **Auto-Reset to App**: Clears RTS and pulses DTR to boot into the newly flashed firmware.

---

### Understanding ESP32 Flash Memory Partitions

A standard ESP32 flash structure consists of several mandatory segments:
\`\`\`
Offset     Content
0x0000     [ESP32-S3/C3/C6] Hardware Bootloader
0x1000     [ESP32 Classic] First-Stage Bootloader
0x8000     Partition Table (Defines nvs, otadata, app0, spiffs sizes)
0x9000     NVS (Non-Volatile Storage for Wi-Fi keys, configs)
0xe000     Boot App0 (Selects which OTA partition boots)
0x10000    Factory Application Binary (.bin)
0x200000+  SPIFFS / LittleFS Filesystem (Web UI assets, captive portals)
\`\`\`

---

### Step-by-Step: Flashing Curated Presets

1. Select your target device family from the Preset Dropdown (e.g., Piglet Wardriver, RocketGod Marauder, Bruce Multi-Tool).
2. Choose your specific board model (e.g. ESP32-S3 Zero, LilyGO T-Display, C3 SuperMini).
3. Connect your board via a high-quality data cable.
4. Click **Connect & Flash**. If prompted by the browser, select the serial port matching your board.
5. If auto-sync fails, **press and hold the BOOT button, press the RESET button once, then release BOOT** to force ROM download mode.

---

### Step-by-Step: Flashing Custom Multi-Binary Files

1. Switch the Flasher toggle to **Custom Binaries**.
2. Click **+ Add Partition**.
3. Specify the hex offset (e.g. \`0x10000\`).
4. Browse and select your \`.bin\` file.
5. Optional: Toggle **Full Chip Erase** if upgrading across major SDK versions or if the filesystem is corrupted.
6. Click **Flash Partitions** and watch the real-time progress bar.
`
  },
  {
    id: 'hardware',
    toolId: 'hardware',
    category: 'core',
    title: 'Hardware Controls — Pin Strapping, DTR/RTS & U-Boot Interrupter',
    summary: 'Direct hardware control of USB-UART control lines, ESP bootstrapping sequence manipulation, and automated bootloader console interrupts.',
    tags: ['Hardware Controls', 'DTR', 'RTS', 'Strapping Pins', 'U-Boot', 'Reset Timing'],
    readTime: '5 min read',
    content: `
# Hardware Controls — Pin Strapping & Signal Timing

The **Hardware Controls** workbench gives you physical-level authority over the modem status signals of your USB-to-UART adapter. It is essential for troubleshooting finicky boot sequences, unbricking development boards, and breaking into bootloader consoles.

---

### How DTR and RTS Control ESP32 Boot Strapping

Most ESP development boards feature a dual-transistor auto-reset circuit connected to the USB-UART bridge (CH340, CP2102, or FT232R):
\`\`\`
DTR ----\\___/---- Base Q1 ---> Collector connected to RESET (EN)
RTS ----/   \\---- Base Q2 ---> Collector connected to GPIO0 (BOOT)
\`\`\`

When the flashing software requests download mode, it performs the following sequence:
1. **Pull GPIO0 LOW**: Assert \`RTS=true\`, \`DTR=false\`.
2. **Pulse RESET (EN) LOW**: Assert \`DTR=true\` for 100ms, then release \`DTR=false\`.
3. **Sample Boot Strapping Pins**: As EN rises to 3.3V, the ESP's internal ROM samples the voltage on GPIO0:
   - **GPIO0 = LOW (0V)**: Chip enters **ROM Serial Download Mode** (ready for flashing).
   - **GPIO0 = HIGH (3.3V)**: Chip enters **SPI Flash Boot Mode** (runs flashed user code).
4. **Release GPIO0**: Set \`RTS=false\` to return pin to normal operation.

---

### Manual Hardware Actions

#### 1. Signal Toggles (DTR & RTS)
- **Toggle DTR**: Directly set the Data Terminal Ready line HIGH or LOW.
- **Toggle RTS**: Directly set the Request To Send line HIGH or LOW.
- Use these manual toggles to hold a target device in permanent reset while wiring logic analyzers or sniffing buses.

#### 2. Auto-Reset Generator
Click **Trigger Auto-Reset** to generate a clean, hardware-timed reset pulse without unplugging the board. You can adjust the pulse duration (50ms to 500ms) to accommodate boards with large decoupling capacitors on the \`EN\` line.

#### 3. Force Bootloader Mode
Click **Force Bootloader** to execute the precise transistor sequence that forces the chip into ROM download mode, even if the user application is caught in a tight boot loop.

#### 4. U-Boot Console Interrupter
When working with Linux SBCs (Raspberry Pi, Orange Pi, routers, IoT gateways), interrupting the U-Boot autoboot countdown requires spamming a key (such as spacebar or Enter) within a narrow 1-second window after power-on.
- Click **Start U-Boot Interrupter**.
- Reset or power cycle your target board.
- The tool continuously fires the interrupt character sequence until the U-Boot prompt (\`=>\` or \`U-Boot#\`) appears, dropping you into the bootloader shell.
`
  }
];
