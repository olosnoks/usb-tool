/**
 * RF, Wireless & Badges Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering Flipper Zero, Proxmark3/PM5, PortaPack Mayhem, GPS Wardrive, Piglet Suite, and Marauder CLI
 * Sourced directly from upstream project specifications, driver implementations, and protocol schemas.
 */

export const RF_ARTICLES = [
  {
    id: 'flipper',
    toolId: 'flipper',
    category: 'rf',
    title: 'Flipper Zero Suite — WebSerial Protobuf RPC, Framebuffer Streaming & Storage',
    summary: 'Exhaustive companion manual: Google Protocol Buffers (PB_Main) RPC session negotiation, ST7567 1024-byte monochrome LCD mirroring, virtual D-pad keystrokes, storage operations, and Sub-GHz replay.',
    tags: ['Flipper Zero', 'RPC', 'Protobuf', 'Screen Streaming', 'BadUSB', 'Sub-GHz', 'qFlipper', 'NFC', 'RFID', 'ST7567', 'STM32WB55'],
    readTime: '22 min read',
    content: `
# Flipper Zero Suite — RPC Bridge, Screen Stream & Storage Manual

The **Flipper Zero Suite** communicates directly with your Flipper Zero device over USB CDC serial. Sourced directly from official firmware documentation and the native \`flipperDriver.js\` implementation, this guide documents the binary RPC session protocol, 128x64 LCD framebuffer decoding, virtual D-pad controls, storage file manipulation, and wireless triggers without needing desktop qFlipper.

---

### 1. What Is This Tool & Why Do You Need It?

The **Flipper Zero** is an open-source multi-tool based on the **STMicroelectronics STM32WB55RG** dual-core ARM Cortex-M4/M0+ microcontroller. While the device features a physical 1.4-inch display and five-button navigation pad, operating it on a workbench or lab bench has significant limitations:
- The tiny display is hard to monitor during bench testing.
- Typing text or developing BadUSB scripts requires tedious on-screen keyboard navigation.
- Managing files on the microSD card usually requires taking the card out or installing qFlipper.

The **Flipper Zero Suite** turns your browser into an interactive hardware workbench. It mirrors the physical LCD screen at up to 30 FPS, routes keyboard arrow keys to the Flipper operating system, uploads/downloads files to the microSD card, and triggers Sub-GHz and NFC replays over a single WebSerial connection.

---

### 2. Physical Layer & USB CDC Enumeration

When connected via USB-C, the Flipper Zero's USB 2.0 Full-Speed PHY enumerates with:
- **Vendor ID (VID)**: \`0x20A0\`
- **Product ID (PID)**: \`0x415A\`
- **Manufacturer String**: \`Flipper Devices Inc.\`
- **Product String**: \`Flipper <Nickname>\` (e.g. \`Flipper K3v1n\`)
- **Device Class**: USB Communication Device Class (CDC ACM - Class \`0x02\`).

The virtual COM port operates with an 8-N-1 frame configuration. Although baud rate is ignored by USB CDC endpoints, configuring the port to **115,200 baud** in the browser provides optimal buffer scheduling.

---

### 3. How the Protobuf RPC Session Protocol Works Under the Hood

The Flipper's serial port starts in an interactive human CLI mode (displaying ASCII art and the \`>: \` prompt).
To transition the device into high-speed binary control mode:

#### Step 1: Session Initiation
The browser sends:
\`\`\`text
start_rpc_session\r\n
\`\`\`
The Flipper halts the CLI shell and responds with a binary acknowledgment (\`\\n\\r\`), switching the UART pipe into **Google Protocol Buffers (Protobuf)** framing.

#### Step 2: Protocol Buffer Envelope Structure
Every packet exchanged in RPC mode adheres to this binary structure:
\`\`\`
+-----------------------+----------------------------------------------------+
| Varint Length (1-4 B) | PB_Main Serialized Message (PB_Main Envelope)      |
+-----------------------+----------------------------------------------------+
\`\`\`
1. **Varint Length Header**: A standard Google Protocol Buffer variable-length integer indicating the exact size in bytes of the following \`PB_Main\` payload.
2. **PB_Main Envelope**: Contains metadata common to all commands:
   - \`command_id\` (uint32): A monotonically incrementing integer (1, 2, 3...) used to match asynchronous responses to requests.
   - \`has_next\` (bool): True if the command payload spans multiple sequential frames (e.g. file streaming or screen streaming).
   - \`command_status\` (enum): Returned by Flipper (\`OK\`, \`ERROR_STORAGE_NOT_READY\`, \`ERROR_INVALID_PARAMETERS\`, etc.).
   - **Specific Sub-Message Payload**: One of 50+ specialized Protobuf messages.

---

### 4. LCD Framebuffer Streaming & ST7567 Canvas Rendering

When you click **Start Screen Stream**:
1. The browser sends a \`PB_Main\` packet containing \`gui_start_screen_stream_request\`.
2. The Flipper's FreeRTOS GUI task hooks the display buffer and streams \`gui_screen_frame\` packets continuously at 15–30 FPS.
3. **The 1024-Byte Framebuffer Anatomy**:
   - The Flipper physical display is a **Sitronix ST7567** monochrome LCD: **128 pixels wide by 64 pixels tall**.
   - Total pixels = \`128 * 64 = 8,192 pixels\`.
   - Each pixel is exactly **1 bit** (\`0\` = Off/Orange, \`1\` = On/Black).
   - \`8,192 bits / 8 bits per byte = exactly 1,024 bytes\`.
   - **Page-Column Memory Layout**: The display is divided vertically into **8 horizontal Pages** (Page 0 to Page 7), each 8 pixels tall. Each page contains **128 vertical 1-byte columns**:
     \`\`\`text
     Byte Index = X_Column + (floor(Y_Row / 8) * 128)
     Bit Mask   = 1 << (Y_Row % 8)
     \`\`\`
4. **Canvas Pipeline**: The \`renderFlipperLcdToCanvas\` function unpacks each byte, checks the bitmask, maps orientation transforms (0°, 90°, 180°, 270°), and generates an RGBA pixel buffer rendered on an HTML5 canvas with authentic Flipper orange backlight styling (\`#FF8200\`).

---

### 5. Virtual D-Pad & Key Event Injection

To control the Flipper without touching its physical buttons, the browser sends \`gui_send_input_event_request\` messages.

#### Supported Keys:
- \`InputKey.UP\` (0)
- \`InputKey.DOWN\` (1)
- \`InputKey.RIGHT\` (2)
- \`InputKey.LEFT\` (3)
- \`InputKey.OK\` (4)
- \`InputKey.BACK\` (5)

#### Supported Event Types:
- \`InputType.PRESS\` (0): Physical contact made.
- \`InputType.RELEASE\` (1): Physical contact broken.
- \`InputType.SHORT\` (2): Quick click (emulates a press followed by release after 50ms).
- \`InputType.LONG\` (3): Long press (holds button for 1,000ms, used to open menus or exit apps).
- \`InputType.REPEAT\` (4): Auto-repeat when button is held down.

#### Keyboard Mappings:
| Target Flipper Action | Desktop Key | Desktop Alternate |
| :--- | :--- | :--- |
| **Navigate Up** | Arrow Up | <kbd>W</kbd> |
| **Navigate Down** | Arrow Down | <kbd>S</kbd> |
| **Navigate Left** | Arrow Left | <kbd>A</kbd> |
| **Navigate Right** | Arrow Right | <kbd>D</kbd> |
| **Select / OK** | <kbd>Enter</kbd> | <kbd>Space</kbd> |
| **Back / Exit** | <kbd>Backspace</kbd> | <kbd>Esc</kbd> |
| **Long Press Action** | <kbd>Shift</kbd> + Key | Long click on button |

---

### 6. MicroSD Card Storage Architecture

The Flipper Zero mounts standard FAT32 / exFAT microSD cards under the root mount point \`/ext/\`.

#### Standard Directory Hierarchy:
\`\`\`
/ext/
├── subghz/        # Recorded Sub-GHz remote signals (.sub files)
├── nfc/           # Saved NFC 13.56MHz card dumps (.nfc files)
├── lfrfid/        # 125kHz RFID badge keys (.rfid files)
├── infrared/      # Learned IR remote control files (.ir files)
├── badusb/        # DuckyScript keystroke injection payloads (.txt files)
├── ibutton/       # Dallas / Maxim 1-Wire iButton keys (.ibtn files)
└── dolphin/       # Virtual pet XP, level, and mood state
\`\`\`

#### File Operations via RPC:
- **List Directory (\`storage_list_request\`)**: Retrieves directory entries with file name, type (File vs Directory), and file size in bytes.
- **Read File (\`storage_read_request\`)**: Streams binary file contents in 512-byte blocks.
- **Write File (\`storage_write_request\`)**: Writes data in 512-byte blocks and flushes cache.
- **Delete File / Directory (\`storage_delete_request\`)**: Permanently removes files or directories recursively.
- **Make Directory (\`storage_mkdir_request\`)**: Creates new folders.

---

### 7. Anatomy of a Flipper \`.sub\` Radio File

When reviewing or creating Sub-GHz files in the storage manager:
\`\`\`text
Filetype: Flipper SubGhz Key File
Version: 1
Frequency: 433920000
Preset: FuriHalSubGhzPreset2FSKDev47k6
Protocol: Princeton
Bit: 24
Key: 00 00 00 00 00 A1 B2 C3
TE: 400
\`\`\`
- **Frequency**: Center frequency in Hertz (\`433920000\` = 433.92 MHz).
- **Preset**: Modulation profile configured in the CC1101 transceiver chip (\`FuriHalSubGhzPresetOok650KhzAsync\`, \`FuriHalSubGhzPreset2FSKDev47k6\`).
- **Protocol**: Decoding protocol (\`Princeton\`, \`Nice FLO\`, \`Came\`, \`Linear\`, or \`RAW\`).
- **Key**: Hexadecimal transmitter ID and button payload.

---

### 8. Step-by-Step Usage Walkthrough

1. Connect your Flipper Zero via USB-C to your computer.
2. In the Flipper Zero Suite, click **Connect Flipper**.
3. Select your Flipper in the browser serial prompt.
4. The workbench will initialize the RPC session, query device identity (Device Nickname, Firmware Version, Battery Level, Hardware Target), and render the live display.
5. Use your keyboard arrow keys or click on-screen D-pad buttons to navigate menus.
6. Switch to the **Storage** tab to browse folders, download recorded card dumps, or drag-and-drop BadUSB \`.txt\` payloads.
7. Click **Take Screenshot** to capture a pixel-perfect PNG of the Flipper LCD canvas!
`
  },
  {
    id: 'proxmark',
    toolId: 'proxmark',
    category: 'rf',
    title: 'Proxmark3 / PM5 Suite — RFID & NFC Auditing Laboratory & Flasher',
    summary: 'Exhaustive Proxmark3 guide: PM3 NG framing protocol (magic 0x424d5033), CommandTree schema, risk classification, HF 14A card analysis, LF EM410x/T5577 cloning, and WebFlash firmware burning.',
    tags: ['Proxmark3', 'RFID', 'NFC', 'Mifare', '125kHz', '13.56MHz', 'T5577', 'EM4100', 'Iceman', 'WebFlash', 'PM3RDV4'],
    readTime: '24 min read',
    content: `
# Proxmark3 / PM5 Suite — RFID & NFC Laboratory Manual

The **Proxmark3 Suite** is a full-featured browser client and flashing workbench for Proxmark3 Easy, RDV4, and PM5 hardware. Sourced directly from official RFID Research Group (Iceman) protocol specifications and the internal \`src/protocols/pm3/\` codebase, this guide documents the binary NG packet framing, command execution schema, risk classification, card cracking workflows, and recovery flashing.

---

### 1. What Is This Tool & Why Do You Need It?

The **Proxmark3** by Jonathan Westhues and expanded by the open-source **RfidResearchGroup (Iceman fork)** is the undisputed gold standard for RFID and NFC research. It combines an FPGA and ARM Cortex-M micro-controller with high-Q tuned antennas to intercept, sniff, emulate, and clone radio transponders spanning 125kHz Low Frequency (LF) and 13.56MHz High Frequency (HF).

Traditionally, using a Proxmark3 required installing Linux, compiling large C/C++ codebases, compiling custom flash tools, and memorizing hundreds of command-line flags.
The **Proxmark3 Suite** communicates with the hardware over WebSerial at **115,200** or **460,800 baud**, provides a declarative **CommandTree** form with parameter validation, and includes an in-browser **WebFlash Service** to recover bricked hardware.

---

### 2. The Proxmark3 "NG" Framing Protocol Specification

Communication with modern Proxmark3 Iceman firmware uses the **NG (Next Generation)** binary packet protocol implemented in \`src/protocols/pm3/packet.ts\`:

\`\`\`
+-----------------------+------------------+-------------------+-------------------+-------------------+-------------------+------------------+---------------------+
| Magic (4 Bytes)       | Length (2 Bytes) | Cmd Code (2 Bytes)| Arg 0 (8 Bytes)   | Arg 1 (8 Bytes)   | Arg 2 (8 Bytes)   | Flags (4 Bytes)  | Payload Data (N B)  |
+-----------------------+------------------+-------------------+-------------------+-------------------+-------------------+------------------+---------------------+
\`\`\`

#### Header Field Breakdown:
1. **Magic Preamble (4 Bytes)**: Exactly \`0x42 0x4D 0x50 0x33\` (\`"PM3B"\` in ASCII). Every valid packet MUST begin with this marker to prevent desynchronization over noisy USB endpoints.
2. **Length (2 Bytes uint16)**: Little-endian integer specifying the byte length of the trailing payload data (0 to 512 bytes).
3. **Command Code (2 Bytes uint16)**: The 16-bit command identifier defined in \`commands.ts\`:
   - \`0x0100\` (\`CMD_PING\`): Round-trip latency test.
   - \`0x0104\` (\`CMD_STATUS\`): Hardware status and voltage readout.
   - \`0x0380\` (\`CMD_HF_14A_READER\`): ISO 14443A search & UID acquisition.
   - \`0x0381\` (\`CMD_HF_14A_RAW\`): Raw RF frame transmission.
   - \`0x0382\` (\`CMD_HF_14A_INFO\`): Detailed card architecture query.
   - \`0x0210\` (\`CMD_LF_EM410X_READ\`): EM4100 125kHz badge reader.
4. **Arg 0, Arg 1, Arg 2 (8 Bytes uint64 each)**: 64-bit integer arguments passed directly to the ARM firmware routines.
5. **Flags (4 Bytes uint32)**: Bitmask controlling execution options (e.g. \`0x0001\` = Automatically calculate and append 16-bit CRC-A).
6. **Payload Data (N Bytes)**: Variable payload (raw bytes, encrypted sectors, or memory blocks).

---

### 3. Declarative CommandTree & Risk Level Classification

To prevent accidental hardware damage or card corruption, every action in the **CommandTree** is tagged with a strict risk level:

| Risk Level | Visual Badge | Behavior | Allowed Operations |
| :--- | :--- | :--- | :--- |
| **\`diagnostic\`** | Blue Pill | Non-invasive system checks | Hardware ping, antenna coil tuning, battery voltage check |
| **\`read\`** | Green Pill | Read-only RF carrier activation | Reading EM4100 tag ID, scanning ISO 14443A UID, reading card info |
| **\`raw\`** | Amber Warning | Direct raw frame transmission | Sending arbitrary hex frames into the RF field without safety validation |
| **\`dangerous\`** | Red Alert | Permanent memory modification | Writing to T5577 configuration block 0, overwriting Mifare Block 0 UID |

---

### 4. Low Frequency (125kHz) Transponder Cloning Manual

#### EM4100 Protocol Details:
- **Frequency**: 125 kHz carrier frequency.
- **Modulation**: Manchester encoding, Amplitude Shift Keying (ASK), RF/64 clock rate.
- **Data Size**: 64 bits total:
  - 9 leading preamble bits (\`111111111\`).
  - 10 line parity bits (even parity).
  - 4 column parity bits.
  - 1 stop bit (\`0\`).
  - **40 actual data bits (5 Bytes)**: 1 byte Customer ID + 4 bytes Unique Tag ID.

#### How to Clone an EM4100 Badge to an Atmel T5577 Rewriteable Card:
1. In the CommandTree, select **Domain: Low Frequency (125 / 134 kHz)** -> **Subsystem: EM410x 125kHz Tags** -> **Action: EM410x Read / Search**.
2. Place your source keyfob or badge onto the Proxmark's circular LF antenna coil. Click **Execute Command**.
3. The PM3 captures the 40-bit ID and prints:
   \`\`\`text
   [+] EM410x Tag Found!
   [+] ID: 01 02 03 04 05
   [+] Facility Code: 01, Card Number: 030405
   \`\`\`
4. Remove the source badge and place a blank **T5577 card / blue keyfob** onto the coil.
5. In the CommandTree, select **EM410x Clone to T5577**, input the 10-digit hex string (\`0102030405\`), and click **Execute**.
6. **Under the Hood**: The PM3 programs Block 0 with configuration word \`0x00148040\` (configuring T5577 for RF/64, Manchester, MaxBlock 2) and writes the decoded bits into Blocks 1 and 2. Your clone badge is ready!

---

### 5. High Frequency (13.56MHz) Mifare Classic Security Analysis

Mifare Classic 1K cards (NXP S50) divide memory into **16 sectors** (Sector 0 to Sector 15). Each sector contains **4 blocks** of 16 bytes each (64 bytes per sector = 1,024 bytes total).

#### The Sector Trailer Format (Block 3 of each Sector):
\`\`\`
+---------------------+-----------------------+---------------------+
| Key A (6 Bytes)     | Access Bits (4 Bytes) | Key B (6 Bytes)     |
+---------------------+-----------------------+---------------------+
\`\`\`
- To read or write any block in a sector, the reader must authenticate against either **Key A** or **Key B**.
- If access bits are set to \`0x7F 0x07 0x88\` (transport default), Key A and Key B default to \`FF FF FF FF FF FF\`.

#### Key Recovery Attacks:
1. **Dictionary Check (\`hf mf chk\`)**:
   - Tests hundreds of known factory default keys (\`FFFFFFFFFFFF\`, \`A0A1A2A3A4A5\`, \`D3F7D3F7D3F7\`, \`000000000000\`).
   - If even one key is discovered, it serves as the pivot for the nested attack.
2. **Nested Attack (\`hf mf nested\`)**:
   - Exploits weakness in the Crypto-1 stream cipher's linear feedback shift register (LFSR) pseudo-random number generator (PRNG).
   - Authenticates using the known key, requests an encrypted authentication challenge for an unknown sector, and measures the exact PRNG state divergence.
   - Derives all 32 sector keys in under 60 seconds!
3. **Dump & Magic Card Clone**:
   - The recovered keys are used to read all 64 blocks into \`dump.bin\`.
   - The dump is written to a **Gen1A "Magic" card** (responds to backdoor unlock commands \`0x40\` and \`0x43\` to overwrite Block 0 UID) or **Gen2 "CUID" card** (accepts direct write to Block 0 without backdoors).

---

### 6. Built-in WebFlash Service (Hardware Recovery)

If your Proxmark3 is bricked or stuck in bootloader mode (e.g. following a failed flash):
1. Hold down the physical button on the PM3 while connecting USB to force bootloader mode.
2. In the **WebFlash** tab, select your target hardware:
   - \`PM3RDV4\`: Official Proxmark3 RDV4 with AT91SAM7S512.
   - \`PM3GENERIC\`: Proxmark3 Easy (512k or 256k AT91SAM7S).
3. The tool loads the verified firmware manifest from \`manifest.ts\` with SHA-256 integrity validation.
4. Click **Flash Bootrom & Fullimage**. The service streams the binaries over the bootloader protocol and restarts the device!
`
  },
  {
    id: 'mayhem',
    toolId: 'mayhem',
    category: 'rf',
    title: 'PortaPack Mayhem SDR — Tactical Radar, ADS-B, FREQMAN & Spectrum Studio',
    summary: 'Exhaustive SDR companion guide: ADS-B 1090MHz Mode-S aircraft radar with TacticalMapDeck, LookingGlass wideband spectrum sweeper, SensorHub weather/TPMS decoders, HamRadio CTCSS repeaters, and FREQMAN editor.',
    tags: ['PortaPack', 'Mayhem', 'HackRF', 'SDR', 'FREQMAN', 'ADS-B', 'TacticalMap', 'LookingGlass', 'HamRadio', 'SensorHub'],
    readTime: '25 min read',
    content: `
# PortaPack Mayhem SDR — Tactical Radar & Spectrum Studio

The **PortaPack Mayhem SDR** workbench is a browser companion for the HackRF One software-defined radio equipped with a PortaPack H1/H2 running Mayhem firmware. Sourced directly from the native \`mayhemDriver.js\`, \`adsbDecoder.js\`, and the specialized deck implementations (\`TacticalMapDeck\`, \`LookingGlassDeck\`, \`HamRadioDeck\`, \`SensorHubDeck\`), this guide documents every radio feature and sub-receiver in the toolkit.

---

### 1. Hardware Architecture & Technical Specifications

The **HackRF One** by Great Scott Gadgets is an open-source Software Defined Radio transceiver:
- **RF Synthesizer**: Maxim MAX2837 transceiver IC covering 2.3 GHz to 2.7 GHz, paired with an RFFC5072 mixer to achieve continuous coverage from **1 MHz to 6 GHz**.
- **Baseband ADC/DAC**: Maxim MAX5864 dual-channel 8-bit converter operating at up to **20 MSps (Mega-Samples Per Second)**.
- **Main Microcontroller**: NXP LPC4320 dual-core ARM Cortex-M4/M0 running at 204 MHz.
- **CPLD**: Xilinx CoolRunner-II handling real-time high-speed digital IQ sample formatting between the ADC and USB/LPC interfaces.
- **Half-Duplex Transceiver**: Capable of transmitting and receiving, but not simultaneously on the same hardware.

The **PortaPack** attaches via two header strips, adding an LCD screen, navigation wheel, audio codec, and microSD slot. The **Mayhem Workbench** bridges your browser to this hardware over WebSerial at **115,200 baud** or WebUSB.

---

### 2. Gain Architecture (LNA, VGA, and AMP)

Proper gain staging is the difference between clean reception and completely blowing out the receiver:
1. **AMP (Internal RF Preamp - 0 dB or 14 dB)**:
   - Located before the mixer.
   - **Rule**: Keep OFF (\`0 dB\`) by default. Only enable for faint high-frequency signals (>2 GHz like satellite downlinks). Enabling on strong signals will overload the mixer and create phantom signals.
2. **LNA Gain (Low Noise Amplifier - 0 to 40 dB in 8dB steps)**:
   - Located in the RF front-end.
   - Adjusts RF sensitivity: \`0, 8, 16, 24, 32, 40 dB\`.
3. **VGA Gain (Variable Gain Amplifier - 0 to 62 dB in 2dB steps)**:
   - Located in the baseband section after the mixer.
   - Amplifies the downconverted analog signal before it enters the 8-bit ADC.

---

### 3. ADS-B 1090 MHz Aircraft Radar & TacticalMapDeck

The workbench includes a Mode-S ADS-B (Automatic Dependent Surveillance-Broadcast) receiver powered by \`adsbDecoder.js\` and rendered on the **TacticalMapDeck**:

#### Mode-S Signal Physics:
- **Center Frequency**: Exactly \`1090.000 MHz\` (\`1.090 GHz\`).
- **Modulation**: Pulse Position Modulation (PPM) at a data rate of 1 Mbit/s.
- **Packet Length**: Short squitter (56 bits) or Extended squitter (112 bits).

#### Downlink Format (DF) Types Decoded:
- **DF0 / DF4 / DF5**: Altitude request / reply.
- **DF11**: All-Call Reply (announces 24-bit ICAO aircraft address).
- **DF17 / DF18 (Extended Squitter - 112 bits)**:
  - **Type Code 1-4**: Aircraft Identification & Callsign (e.g. \`UAL123\`, \`DAL456\`).
  - **Type Code 9-18**: Airborne Position (Decoded using Compact Position Reporting / CPR math to compute exact latitude and longitude).
  - **Type Code 19**: Airborne Velocity (Ground speed in knots, heading in degrees, vertical climb/descent rate in feet/minute).

#### TacticalMapDeck Display:
- Real-time OpenStreetMap canvas plotting all tracked aircraft with direction vectors.
- Altitude flight levels (e.g. \`FL350\` = 35,000 feet) and squawk codes (e.g. \`7700\` Emergency, \`7600\` Radio Failure, \`7500\` Hijack).

---

### 4. LookingGlassDeck — Wideband Spectrum Sweeper

Standard SDR waterfalls can only display the instantaneous bandwidth of the ADC (up to 20 MHz wide).
The **LookingGlassDeck** implements a high-speed synthesizer sweeper:
- **Sweeping Algorithm**: Rapidly retunes the HackRF's mixer across a wide frequency span (e.g. from 24 MHz up to 1.8 GHz) in fast hops.
- **FFT Binning**: Computes Fast Fourier Transforms at each hop, stitches the spectrum slices together, and renders a panoramic real-time spectrum graph.
- **Peak Hold & Threshold Markers**: Automatically identifies rogue RF spikes, wireless microphones, or hidden analog bugs.

---

### 5. SensorHubDeck — Environmental & TPMS Decoders

The **SensorHubDeck** decodes Sub-GHz consumer sensors transmitting on ISM bands:
- **Weather Stations (433.92 MHz & 868 MHz)**:
  - Oregon Scientific protocols (v1, v2.1, v3.0).
  - Ambient Weather, Acurite, and LaCrosse temperature and humidity sensors.
- **Automotive TPMS (Tire Pressure Monitoring Systems - 315 MHz & 433.92 MHz)**:
  - Decodes Schrader, Continental, and Pacific tire sensors.
  - Displays individual wheel sensor IDs, tire pressure in PSI / bar, and temperature in °C.

---

### 6. HamRadioDeck — Repeaters & CTCSS Tones

For amateur radio operators, the **HamRadioDeck** provides tuning controls for VHF (2-meter band: 144–148 MHz) and UHF (70-centimeter band: 420–450 MHz):
- **Repeater Offset Generator**: Automatically applies standard transmit frequency offsets (+600 kHz or -600 kHz on 2m; +5.0 MHz on 70cm).
- **CTCSS (Continuous Tone-Coded Squelch System)**: Generates and decodes standard sub-audible tone frequencies (from 67.0 Hz up to 254.1 Hz) to open commercial and amateur repeaters.

---

### 7. FREQMAN Frequency Manager Table

Mayhem stores channels in text files under \`/FREQMAN/\` on the SD card. The workbench provides built-in presets:
| Preset ID | Frequency | Modulation | Category | Description |
| :--- | :--- | :--- | :--- | :--- |
| **\`ism-433\`** | 433.920 MHz | NFM (12.5 kHz) | ISM | Keyfobs, wireless doorbells & weather sensors |
| **\`ism-868\`** | 868.300 MHz | NFM (25.0 kHz) | ISM | European LoRa, smart meters & alarm sensors |
| **\`ism-915\`** | 915.000 MHz | NFM (25.0 kHz) | ISM | North American LoRa, utility meters |
| **\`adsb-1090\`**| 1090.000 MHz| SPEC (2.0 MHz) | Aviation | Mode-S aircraft transponder squitters |
| **\`air-guard\`**| 121.500 MHz | AM (25.0 kHz) | Aviation | International civilian VHF distress frequency |
| **\`noaa-wx1\`** | 162.400 MHz | NFM (16.0 kHz) | Weather | NOAA continuous weather broadcast |
| **\`marine-16\`**| 156.800 MHz | NFM (25.0 kHz) | Marine | VHF Channel 16 international distress & calling |
| **\`aprs-2m\`** | 144.390 MHz | NFM (12.5 kHz) | Ham Radio | Automatic Packet Reporting System |
| **\`iss-down\`** | 145.800 MHz | NFM (12.5 kHz) | Satellite | International Space Station FM downlink / SSTV |
| **\`subghz-315\`**| 315.000 MHz | ASK (50.0 kHz) | Automotive | North American car keyfobs & tire sensors |
`
  },
  {
    id: 'wardrive',
    toolId: 'wardrive',
    category: 'rf',
    title: 'GPS & Wardrive Suite — NMEA 0183 Sentences, UBX Binary Protocol & Tactical Map',
    summary: 'Master GPS/GNSS receiver integration: decode NMEA 0183 sentences ($GPGGA, $GPRMC), configure u-blox binary rates (UBX-CFG-RATE, UBX-CFG-PRT) with Fletcher-8 checksums, and track live coordinates on OpenStreetMap.',
    tags: ['GPS', 'Wardrive', 'NMEA', 'u-blox', 'UBX', 'Leaflet Map', 'WiGLE', 'Satellites', 'GNSS', 'Fletcher-8'],
    readTime: '20 min read',
    content: `
# GPS & Wardrive Suite — NMEA Sentences & UBX Binary Manual

The **GPS & Wardrive Suite** connects directly to standard GPS/GNSS receiver modules (u-blox NEO-6M, NEO-7M, NEO-8M, M10, ATGM336H) to decode satellite constellations, compute real-time geographic position, and configure receiver hardware registers.

---

### 1. What Is Wardriving & Why Is GPS Essential?

**Wardriving** is the practice of mapping wireless networks (Wi-Fi, Bluetooth beacons, cellular towers) while mobile. To accurately map an access point, a wardriving rig must pair the network's BSSID, encryption flags, and signal strength (RSSI) with an exact geographic coordinate (Latitude, Longitude, Altitude).

The **GPS & Wardrive Suite** provides:
- Live NMEA sentence decoding with millisecond timestamp synchronization.
- Satellite constellation health monitoring (GPS, GLONASS, Galileo, BeiDou).
- An interactive OpenStreetMap tracking canvas with real-time breadcrumb trails.
- A binary **UBX Protocol Engine** to boost receiver update rates from 1Hz up to 10Hz for high-speed vehicle tracking.

---

### 2. NMEA 0183 Protocol Deep-Dive

GNSS modules stream comma-delimited ASCII sentences starting with \`$\` and ending with \`*<checksum>\\r\\n\`:

#### Sentence 1: $GPGGA (Fix Data)
\`\`\`text
$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47
\`\`\`
1. \`123519\`: UTC Time (\`12:35:19\`).
2. \`4807.038,N\`: Latitude \`48° 07.038'\` North.
3. \`01131.000,E\`: Longitude \`011° 31.000'\` East.
4. \`1\`: Fix Quality (\`0\` = Invalid, \`1\` = GPS Fix, \`2\` = DGPS, \`4\` = RTK Fixed).
5. \`08\`: Number of active satellites tracked.
6. \`0.9\`: Horizontal Dilution of Precision (HDOP — lower is better).
7. \`545.4,M\`: Altitude above sea level in meters.

#### Sentence 2: $GPRMC (Recommended Minimum Data)
\`\`\`text
$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230324,,,A*6D
\`\`\`
- \`022.4\`: Ground speed in knots.
- \`084.4\`: True course heading in degrees.
- \`230324\`: Date (\`23 March 2024\`).

---

### 3. u-blox UBX Binary Protocol & The Fletcher-8 Checksum

Standard NMEA only outputs 1 position update per second (1 Hz / 1000ms). When wardriving in a car at 60 mph (100 km/h), your vehicle travels 27 meters between updates!

To boost update rates, the tool communicates using u-blox's proprietary binary **UBX Protocol** (\`src/utils/ubxProtocol.js\`):
\`\`\`
+--------------+--------------+---------------+--------------+-------------------+--------------------+------------------+------------------+
| SYNC 1 (0xB5)| SYNC 2 (0x62)| Class (1 Byte)| ID (1 Byte)  | Length (2 Bytes)  | Payload (N Bytes)  | Checksum A (1 B) | Checksum B (1 B) |
+--------------+--------------+---------------+--------------+-------------------+--------------------+------------------+------------------+
\`\`\`

#### The 8-bit Fletcher Checksum Algorithm:
Every UBX message concludes with two 8-bit checksum bytes calculated over the Class, ID, Length, and Payload fields:
\`\`\`javascript
let ck_a = 0, ck_b = 0;
for (let i = 2; i < buffer.length - 2; i++) {
  ck_a = (ck_a + buffer[i]) & 0xFF;
  ck_b = (ck_b + ck_a) & 0xFF;
}
\`\`\`

#### Essential UBX Configuration Commands:
- **UBX-CFG-RATE (Class \`0x06\`, ID \`0x08\`)**:
  - Sets measurement period in milliseconds: \`1000ms\` (1Hz), \`200ms\` (**5Hz**), or \`100ms\` (**10Hz**).
- **UBX-CFG-PRT (Class \`0x06\`, ID \`0x00\`)**:
  - Reconfigures the receiver's UART baud rate from 9600 to **115200 bps** to prevent high-speed NMEA sentences from overflowing the receiver's internal transmit FIFO.
- **UBX-CFG-NAV5 (Class \`0x06\`, ID \`0x24\`)**:
  - Sets dynamic platform model: \`0\` Portable, \`2\` Stationary, \`3\` Pedestrian, \`4\` **Automotive** (enables Kalman velocity filtering for moving vehicles).
`
  },
  {
    id: 'piglet-suite',
    toolId: 'flasher',
    category: 'rf',
    title: 'Piglet Wardriver Suite — Full Setup Guide for All 7 Boards',
    summary: 'The ultimate guide to configuring, flashing, and running Piglet Wardriver across all 7 supported boards with GPS wiring, C5 stub bypass, and WiGLE CSV.',
    tags: ['Piglet', 'Wardriver', 'ESP32-S3', 'ESP32-C5', 'WiGLE', 'GPS', 'NEO-6M', 'CYD', 'T-Display', 'M5StickC'],
    readTime: '20 min read',
    content: `
# Piglet Wardriver Suite — Complete Hardware & Firmware Guide

The **Piglet Wardriver Suite** turns compact ESP32 development boards into high-efficiency Wi-Fi, Bluetooth, and cellular wardriving devices that log geolocated network data into standard WiGLE CSV format.

---

### 1. All 7 Supported Hardware Targets

| Board Model | CPU Architecture | Supported Bands | GPS UART Pins | Storage / Screen |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32-S3 Zero** | S3 Dual-Core LX7 | 2.4 GHz | TX: GPIO43, RX: GPIO44 | MicroSD via SPI / External I2C OLED |
| **ESP32-C3 SuperMini** | C3 RISC-V 32-bit | 2.4 GHz | TX: GPIO20, RX: GPIO21 | MicroSD via SPI (GPIO4-7) |
| **ESP32-C5 Beta** | C5 RISC-V 32-bit | **Dual-Band 2.4 & 5 GHz** | TX: GPIO2, RX: GPIO3 | MicroSD SPI / Internal Flash |
| **ESP32-C6 DevBoard** | C6 RISC-V 32-bit | 2.4 GHz Wi-Fi 6 + Zigbee | TX: GPIO16, RX: GPIO17 | MicroSD SPI |
| **LilyGO T-Display S3** | S3 Dual-Core LX7 | 2.4 GHz | Dedicated Grove Connector | Integrated 1.9" ST7789 Color LCD |
| **M5StickC-Plus2** | ESP32-PICO-V3-02 | 2.4 GHz | Top Hat Connector | Built-in 1.14" TFT + LiPo Battery |
| **CYD Cheap Yellow Display**| ESP32 Classic | 2.4 GHz | Extended IO Port | 2.8" Resistive Touchscreen + SD |

---

### 2. The ESP32-C5 Dual-Band Flashing Fix
> **Critical Silicon Notice for ESP32-C5 Users**:
> ESP32-C5 is Espressif's first dual-band 2.4 GHz and 5 GHz RISC-V processor. Because it is early engineering silicon, standard \`esptool\` flasher stubs fail with memory allocation crashes when writing to C5 flash memory.
> **The Automatic Fix**: Skon's Web Flasher automatically identifies C5 chips from their eFuse MAC registers and forces **Direct ROM Mode (No-Stub)** at 115,200 baud, bypassing the stub and successfully burning firmware every time!

---

### 3. Step-by-Step Hardware Assembly Guide

#### Parts Needed:
1. One of the 7 supported ESP32 boards listed above.
2. A GPS module with external ceramic patch antenna (e.g. u-blox NEO-6M, NEO-8M, or ATGM336H).
3. A MicroSD card SPI breakout board (unless using CYD or LilyGO with built-in slot).
4. MicroSD card (32GB or smaller, formatted as **FAT32**).

#### General Wiring Diagram:
\`\`\`
GPS Module       Target ESP32 Board
VCC -------------> 3.3V or 5V (Check if board has 5V pin)
GND -------------> GND
TX  -------------> ESP RX (See table above for board-specific RX pin)
RX  -------------> ESP TX (See table above for board-specific TX pin)
\`\`\`

---

### 4. Step-by-Step Flashing Procedure

1. Open the **Firmware Flasher** tab in Skon's USB Tool.
2. Select **Piglet Wardriver Suite** from the curated presets dropdown.
3. Select your exact board model from the Board selector.
4. Plug in your board via USB.
5. Click **Connect & Flash**. Select your serial port in the browser prompt.
6. Once flashing finishes (100%), the board automatically restarts and launches Piglet Wardriver!

---

### 5. WiGLE CSV File Format & Uploading

Piglet generates logs conforming to the official **WiGLE CSV Format v2**:
\`\`\`text
WigleWifi-1.4,appRelease=Piglet-1.0,model=ESP32S3,osVersion=1.0.0,device=ESP32
MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type
AA:BB:CC:DD:EE:FF,CoffeeShop,[WPA2-PSK-CCMP],2024-03-23 12:45:10,6,-68,48.123456,11.654321,520.4,3.5,WIFI
\`\`\`

#### How to Upload to WiGLE:
1. Power down your board and remove the MicroSD card (or connect to the Terminal and download the log).
2. Log into your account on [WiGLE.net](https://wigle.net).
3. Click **Uploads** -> **Upload a file**.
4. Select your \`piglet_wardrive_YYYYMMDD.csv\` file.
5. Your discovered access points will be added to the global wireless map and your user rank will increase!
`
  },
  {
    id: 'marauder',
    toolId: 'terminal',
    category: 'rf',
    title: 'ESP32 Marauder CLI Manual — Wi-Fi & Bluetooth Auditing',
    summary: 'Complete command manual for JustCallMeKoko’s ESP32 Marauder: target discovery, raw promiscuous sniffing, beacon flooding, deauth testing, and pcap save.',
    tags: ['Marauder', 'CLI', 'Wi-Fi Audit', 'Beacon', 'Deauth', 'PMKID', 'pcap', 'Bluetooth', 'Sniffing'],
    readTime: '18 min read',
    content: `
# ESP32 Marauder CLI Manual

**ESP32 Marauder** is a portable firmware suite created by security researcher **JustCallMeKoko** for offensive and defensive Wi-Fi and Bluetooth analysis. When connected to Skon's USB Tool, you can control Marauder via the integrated WebSerial terminal or stream live packets into the Packet Lab.

---

### 1. Connecting to Marauder

1. Flash official Marauder using the **Firmware Flasher** or plug in a pre-flashed Marauder board.
2. Open the **Terminal & Console**.
3. Select **115200 baud** and click **Connect**.
4. Press Enter. Marauder will display its startup banner and \`> \` prompt.

---

### 2. Scanning & Target Discovery Commands

| Command | Description | Example Usage |
| :--- | :--- | :--- |
| \`scanap\` | Scans for nearby 802.11 Access Points across all channels | \`scanap\` |
| \`scansta\` | Scans for client devices (phones, laptops) | \`scansta\` |
| \`sniffraw\` | Streams all raw promiscuous frames over serial | \`sniffraw\` |
| \`sniffbeacon\` | Sniffs only AP beacon frames | \`sniffbeacon\` |
| \`sniffdeauth\` | Detects rogue deauthentication attacks | \`sniffdeauth\` |
| \`sniffpmkid\` | Captures PMKID key material from routers | \`sniffpmkid\` |
| \`stopscan\` | **Halts any active scanning or attack loop** | \`stopscan\` |

---

### 3. Target Selection & Management

After running \`scanap\`:
- \`list -a\`: Prints the numbered table of discovered Access Points:
  \`\`\`text
  [0] -62dBm ch: 6  CoffeeShop_Guest [WPA2] 00:11:22:33:44:55
  [1] -78dBm ch: 11 Home_Network     [WPA3] 66:77:88:99:AA:BB
  \`\`\`
- \`select -a <index>\`: Selects a specific target (e.g. \`select -a 0\`).
- \`select -a all\`: Selects all discovered APs.
- \`clearlist -a\`: Clears the internal AP cache to start fresh.

---

### 4. Active Transmission & Attack Commands
> **Legal Notice**: Only test networks and devices that you own or have explicit written authorization to audit.

- \`attack -t beacon -l\`: Generates beacon frames mimicking a list of random SSIDs.
- \`attack -t beacon -a\`: Clones SSIDs of all selected APs and broadcasts duplicate beacon floods.
- \`attack -t deauth\`: Transmits standard IEEE 802.11 deauthentication management frames to test client reconnection and capture WPA 4-way handshakes.
- \`attack -t probe\`: Floods probe requests to map hidden networks.

---

### 5. Settings, Channels & PCAP Capture
- \`channel\`: Displays the current 2.4GHz Wi-Fi channel.
- \`channel -s <1-14>\`: Locks the radio to a specific channel (e.g. \`channel -s 6\`).
- \`settings\`: Displays all internal settings (auto-save PCAP, LED color, force packets).
- \`settings -s ForcePackets enable\`: Forces raw packet streaming over UART into Skon's Packet Lab!
`
  }
];
