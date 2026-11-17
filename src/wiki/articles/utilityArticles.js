/**
 * Utility & Automation Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering MicroPython REPL & Filesystem, Improv Wi-Fi, Telemetry Gauges, Crash/Panic Alerts,
 * Automated Test Runner, USB Device Autopsy, and Silicon eFuse / Memory Dumper.
 */

export const UTILITY_ARTICLES = [
  {
    id: 'micropython',
    toolId: 'micropython',
    category: 'utilities',
    title: 'MicroPython REPL & File Manager — WebFS & Raw Mode Studio',
    summary: 'Master MicroPython Raw REPL control sequences (0x01-0x04), on-board file browsing and in-browser editing, one-liner execution, and the bundled driver installer.',
    tags: ['MicroPython', 'CircuitPython', 'Raw REPL', 'File Manager', 'LittleFS', 'FAT', 'boot.py', 'main.py', 'mip', 'WebFS'],
    readTime: '22 min read',
    content: `
# MicroPython REPL & File Manager — WebFS & Raw Mode Studio

The **MicroPython Workbench** provides full file system and interactive programming control over microcontrollers running MicroPython or CircuitPython (ESP32, RP2040, STM32, nRF52) without installing command-line tools like \`ampy\`, \`rshell\`, or \`mpremote\`.

---

### 1. What Is This Tool & Why Do You Need It?

When developing with MicroPython, developers frequently need to:
- Inspect files on the board's internal flash storage.
- Upload scripts (\`main.py\`, \`boot.py\`, custom libraries).
- Edit code directly on the microcontroller's flash.
- Check free and total flash space.
- Drop common sensor and display drivers into \`/lib\`.

The **MicroPython Workbench** communicates directly over WebSerial using MicroPython's built-in **Raw REPL mode**, providing an in-browser graphical file manager, a free/total flash readout, a text editor, and a one-line code runner.

---

### 2. Under the Hood: The Raw REPL Protocol

When connected over serial, MicroPython typically runs a friendly, human-interactive REPL with prompt \`>>> \`. However, friendly REPL mode echoes back every character and inserts auto-indentation, making programmatic file transfers slow and prone to corruption.

For every operation (scan, read, write, delete, one-liner) the workbench enters **Raw REPL Mode**, runs one generated script, and leaves again, using standard ASCII control byte sequences:

\`\`\`text
Host (PC)                                   Target Microcontroller
   |                                                    |
   | --- [0x03 (Ctrl+C)] [0x03 (Ctrl+C)] -------------> | (Interrupt running code)
   | --- [0x01 (Ctrl+A)] -----------------------------> | (Request Raw REPL Mode)
   | <--- "raw REPL; CTRL-B to exit\\r\\n>" ------------- | (Acknowledge Raw REPL)
   |                                                    |
   | --- Python Code Chunks (Max 256 bytes) ----------> | (Buffer script in RAM)
   | --- [0x04 (Ctrl+D)] -----------------------------> | (Execute buffered code)
   | <--- "OK" ---------------------------------------- | (Execution Started)
   | <--- Script Stdout [0x04] Stderr [0x04] ">" ------- | (Output, then traceback if any)
   |                                                    |
   | --- [0x02 (Ctrl+B)] -----------------------------> | (Exit Raw REPL to Normal)
\`\`\`

<details>
<summary>Deep-Dive: File Upload, Download & Directory Listing Mechanics</summary>

Files cross the serial link as Base64 text embedded in short Python scripts, with marker lines that the host searches for in the output:
1. **Upload / save**:
   - The file's bytes (uploads are read as raw bytes; editor text is UTF-8 encoded) are Base64-encoded in the browser and sent as a single script (itself written to the wire in 256-byte pieces):
     \`\`\`python
     import ubinascii
     with open('target_file.ext', 'wb') as f:
         f.write(ubinascii.a2b_base64('BASE64_DATA'))
     print("__FILE_WRITE_SUCCESS__")
     \`\`\`
   - There is no per-chunk streaming and no checksum verification; success is the \`__FILE_WRITE_SUCCESS__\` marker. Very large files may not fit in one script, and the transfer is text-based (see the note below).
2. **Download / edit**:
   - The device reads the file as bytes, prints it as Base64 between \`__FILE_DATA_START__\` and \`__FILE_DATA_END__\`, and the browser decodes it.
3. **Directory Traversal**:
   - The tool lists files and folders using \`os.ilistdir(path)\` (falling back to \`os.listdir\`):
     - Entries are \`(name, type, inode, size)\`.
     - \`type & 0x4000\`: Subdirectory.
   - Free and total flash come from \`os.statvfs('/')\`.

> Uploads and downloads are byte-exact, so binary files (images, \`.mpy\`) transfer intact. Paths are quoted as Python string literals, so names containing quotes or backslashes are safe. The in-browser editor decodes files as UTF-8, so only edit text files there.
</details>

<details>
<summary>Deep-Dive: The Bundled Driver Installer (mip tab)</summary>

The **PACKAGE MANAGER (mip)** tab lists a small built-in catalog of drivers (SSD1306 OLED, BME280, AHT10/AHT20, MPU6050, uMQTT Simple, VL53L0X). The source of each driver ships inside the app. **INSTALL TO /lib/** creates \`/lib\` (and \`/lib/umqtt\`) if needed and writes the file; nothing is downloaded from a package index and the real \`mip\` tool is not invoked. The search box filters by name, description or category.
</details>

---

### 3. Step-by-Step Walkthrough

1. Connect your MicroPython or CircuitPython board with the app's serial connection (set the port and baud rate in the Terminal / connection controls; the workbench uses that shared port and has no baud selector of its own). If several boards are connected, pick one in the **TARGET** selector.
2. Click **SCAN FILES**:
   - The workbench interrupts any running loop, enters Raw REPL, reads \`sys.platform\` and flash usage, and lists the current directory. The platform shows as a badge in the header.
3. **Navigate**: click a folder name or **ENTER**; use **UP** or the \`.. [Parent Directory]\` row to go back.
4. **Edit File**: click **EDIT** on a text file. A plain text editor with a line-number gutter opens.
5. **Download File**: click the download icon on a file row to save it to your computer.
6. **Upload File**: click **UPLOAD** and choose a file; it is written into the current directory (there is no drag-and-drop).
7. **NEW SCRIPT**: enter a filename and initial content, then **CREATE & FLASH**.
8. Click **SAVE TO ON-CHIP FLASH** in the editor to write the file. It does not reboot the board; reset it yourself (or use the one-liner below) to run the new code.
9. The trash icon deletes a file (after a confirmation). It uses \`os.remove\`, so it only removes files, not folders.
10. **EXECUTE REPL**: type a one-liner and press Enter or **RUN**; the output appears in the session log.

---

### 4. Upstream Project & Engineering Attribution

| Project / Component | Author(s) / Organization | Repository & Reference | License |
| :--- | :--- | :--- | :--- |
| **MicroPython (Python for Microcontrollers)** | Damien P. George, Paul Sokolovsky, and MicroPython contributors | [micropython.org](https://micropython.org) / [github.com/micropython/micropython](https://github.com/micropython/micropython) | MIT |
| **MicroPython Raw REPL Protocol Specification** | MicroPython Core Architecture | [docs.micropython.org](https://docs.micropython.org) | MIT |
| **LittleFS / FAT Filesystem Ports** | ARM Limited (LittleFS) / ChaN (FatFs) / MicroPython | [github.com/littlefs-project/littlefs](https://github.com/littlefs-project/littlefs) | BSD-3-Clause |
`
  },
  {
    id: 'improv',
    toolId: 'improv',
    category: 'utilities',
    title: 'Improv Wi-Fi — Standardized Serial IoT Wi-Fi Provisioner',
    summary: 'Provision Wi-Fi credentials over serial using the Improv protocol (ESPHome, ESP Web Tools firmware) or the MicroPython / ESP-AT fallbacks, without mobile apps or captive portals.',
    tags: ['Improv Wi-Fi', 'Home Assistant', 'ESPHome', 'IoT', 'Provisioning', 'Wi-Fi Credentials', 'ESP-AT', 'MicroPython'],
    readTime: '16 min read',
    content: `
# Improv Wi-Fi — Serial Provisioner

The **Improv Wi-Fi Workbench** implements the open **Improv Wi-Fi Serial Protocol** developed by the open-source smart home community (Home Assistant, ESPHome, and Nabu Casa). It allows you to provision Wi-Fi credentials (SSID and passphrase) to IoT devices over a standard serial cable without requiring temporary Wi-Fi access points, captive portals, or dedicated mobile applications.

---

### 1. What Is Improv Wi-Fi & Why Do You Need It?

Traditionally, setting up a new smart home device required:
1. Powering the device and waiting for it to broadcast a temporary Wi-Fi network (e.g. \`ESPHome-123456\`).
2. Disconnecting your computer/phone from your home Wi-Fi and connecting to the device's network.
3. Navigating an unreliable captive portal web page.
4. Reconnecting your computer to your home network.

**Improv Wi-Fi** replaces this entire friction-filled process. When you plug a device into USB, Skon's USB Tool asks it for its state and identity over the serial port, can ask it to scan for local Wi-Fi networks, and sends the credentials over serial.

---

### 2. Under the Hood: The Improv Serial Frame Format

Improv packets are framed with a human-readable header followed by binary payload bytes:

\`\`\`text
+--------------+---------+-----------+--------+---------------+--------------------+
| Magic String | Version | Packet    | Data   | Data Payload  | 8-Bit Checksum     |
| "IMPROV"     | 0x01    | Type Byte | Length | (N bytes)     | (Modulo 256 sum)   |
| (6 bytes)    | (1 B)   | (1 byte)  | (1 B)  |               | (1 byte)           |
+--------------+---------+-----------+--------+---------------+--------------------+

Packet types: 0x01 Current State, 0x02 Error State, 0x03 RPC Command, 0x04 RPC Result.
RPC commands: 0x01 Wi-Fi Settings (SSID + password), 0x02 Get Current State, 0x03 Get Device Info, 0x04 Scan Networks.
RPC data is: command byte, length of the rest, then length-prefixed strings.
\`\`\`

#### Checksum Calculation:
The checksum byte is calculated by summing every byte from the start of \`IMPROV\` through the end of the data payload and taking the modulo 256 (there is no trailing \`\r\n\`):
\`\`\`javascript
let sum = 0;
for (let i = 0; i < packetBytes.length; i++) {
  sum = (sum + packetBytes[i]) & 0xFF;
}
\`\`\`

<details>
<summary>Deep-Dive: Improv State Machine & Error Code Enums</summary>

#### The Improv State Enums:
| State Code | State Name | Meaning |
| :---: | :--- | :--- |
| **\`0x00\`** | **Unknown / Initializing** | The workbench has not received a state from the device yet. |
| **\`0x01\`** | **Awaiting Authorization** | Target device requires a physical button press before accepting credentials. |
| **\`0x02\`** | **Authorized** | Device is authorized and ready to accept Wi-Fi credentials. |
| **\`0x03\`** | **Provisioning** | Device received SSID and password and is actively authenticating with AP. |
| **\`0x04\`** | **Provisioned** | Device successfully obtained an IP address via DHCP! |

#### Master Error Codes:
- **\`0x00\` (No Error)**: Operation succeeded.
- **\`0x01\` (Invalid RPC Packet)**: Frame header missing or checksum mismatch.
- **\`0x02\` (Unknown Command)**: Unsupported packet type.
- **\`0x03\` (Unable to Connect)**: Incorrect Wi-Fi password or out-of-range SSID.
- **\`0x04\` (Not Authorized)**: Provisioning attempted without required physical authorization. The workbench has no dedicated text for this code and shows it as a generic error code.
- **\`0xFF\` (Unknown Error)**.

</details>

---

### 3. Step-by-Step Usage Guide

1. Plug your ESP32, ESP8266, Pico or other IoT device into your computer via USB and connect to its serial port with the app's shared connection (the workbench has no baud selector of its own).
2. Choose the **Mode**:
   - **IMPROV RPC (Standard)**: for firmware that implements the Improv serial protocol (for example ESPHome or ESP Web Tools firmware). On connect the workbench sends *Get Current State* and *Get Device Info*; the device line shows the returned firmware name, version, chip and device name.
   - **MICROPYTHON REPL**: types a \`network.WLAN\` scan or connect one-liner into the normal REPL.
   - **ESP-AT CMD**: sends \`AT+CWLAP\` to scan and \`AT+CWMODE=1\` + \`AT+CWJAP\` to connect.
3. Click **SCAN APs** (optional). The device's networks are listed with signal in dBm and a lock icon for secured networks; click one to fill the SSID. If the device never answers, the scan gives up after 15 seconds.
4. Type the **Network SSID** and **Wi-Fi Password** (the lock icon toggles password visibility).
5. Click **CONNECT BOARD TO WI-FI**:
   - In Improv mode the workbench sends the Wi-Fi Settings RPC. The status banner follows the state the device reports (provisioning, then provisioned) and shows the URL the device returns, if any, as an **OPEN** button.
   - In the MicroPython and ESP-AT modes the workbench watches the text output for an IP address (for example from \`ifconfig\` or \`CIFSR\`) or a failure message.

> The MicroPython and AT modes send plain text to whatever is on the port; they are best-effort fallbacks, not a standard protocol.

---

### 4. Upstream Project & Engineering Attribution

| Standard / Component | Author(s) / Organization | Repository & Reference | License |
| :--- | :--- | :--- | :--- |
| **Improv Wi-Fi Open Standard** | Paulus Schoutsen (Home Assistant), Otto Winter (ESPHome), and Nabu Casa Inc. | [improv-wifi.com](https://www.improv-wifi.com) / [github.com/improv-wifi](https://github.com/improv-wifi) | Apache-2.0 |
| **ESPHome Firmware Integration** | ESPHome Core Development Team | [esphome.io](https://esphome.io) | Dual-licensed GPL / MIT |
| **Tasmota Open-Source Firmware** | Theo Arends and Tasmota Community | [tasmota.github.io](https://tasmota.github.io) | GPL-3.0 |
`
  },
  {
    id: 'telemetry',
    toolId: 'telemetry',
    category: 'utilities',
    title: 'Telemetry Gauges — Analog Speedometer & Metric Dials',
    summary: 'Parse JSON, key=value and CSV lines from the serial stream into named channels shown on an artificial horizon, a circular speedometer and live min/max metric cards.',
    tags: ['Telemetry', 'Gauges', 'Speedometer', 'Artificial Horizon', 'Sensors', 'Metrics', 'JSON', 'CSV'],
    readTime: '15 min read',
    content: `
# Telemetry Gauges — Analog Dials & Digital Meters

The **Telemetry Gauges Workbench** (window title *Telemetry & Attitude Dashboard*) turns text lines arriving on the serial port (temperature probes, engine RPM sensors, IMUs, multimeters) into named numeric channels and shows them on three panels: an attitude horizon, a circular speedometer, and a grid of live metric cards.

---

### 1. Under the Hood: Line Parsing & Needle Math

Every new line from the serial stream is tried against three parsers in order; the first one that matches wins. There is no custom regular expression field and no format selector.

<details>
<summary>Deep-Dive: Supported Line Formats</summary>

| Order | Format | Example Serial Line | Result |
| :---: | :--- | :--- | :--- |
| 1 | **JSON object** (line starts with \`{\` and ends with \`}\`) | \`{"rpm": 4820, "temp": 24.5}\` | One channel per key with a numeric value. |
| 2 | **Key-Value** (\`key=number\` or \`key:number\`) | \`temp=24.5 rpm=3200\` or \`Temp: 24.5 C, Humidity: 62 %\` | One channel per pair, key lower-cased with non-alphanumerics removed. |
| 3 | **CSV / sentence** (contains a comma, optional \`$TAG,\` prefix, at least 2 numbers) | \`$DATA,12.5,-4.2,24.5,12.1,2400\` | Numbers map by position to \`pitch, roll, temp, volts, rpm, altitude\`, then \`ch_7\`, \`ch_8\`... |

Channel names are used as-is, so send \`pitch\` and \`roll\` to move the horizon, and names containing \`temp\`, \`volt\`, \`rpm\` or \`alt\` get a \`°C\`, \`V\`, \`RPM\` or \`m\` unit. Any other new key creates a new channel automatically. The dashboard starts with six placeholder channels (pitch, roll, temp, volts, rpm, altitude) holding sample values until real data arrives.
</details>

<details>
<summary>Deep-Dive: Needle Deflection Calculation</summary>

The speedometer is an SVG arc plus a rotating needle (not a canvas). The needle sweeps 270 degrees from -135 to +135:

\`\`\`text
Normalized (t) = (Current_Value - Observed_Min) / (Observed_Max - Observed_Min)
(Clamped between 0.0 and 1.0; if min equals max the scale falls back to 0 to 100)
Needle angle (degrees) = -135 + t * 270
\`\`\`

The scale is **auto-ranging**: the minimum and maximum are the lowest and highest values seen so far for that channel, not user-set limits. The needle movement is smoothed with a short CSS transition; there is no exponential filter.
</details>

---

### 2. The Panels

- **Attitude Horizon**: an artificial horizon driven by the \`pitch\` and \`roll\` channels, with the current pitch/roll in degrees in its header.
- **Circular Speedometer**: pick any channel from the dropdown (or click a metric card) to show it on the dial, with its value, unit, and observed MIN / MAX underneath.
- **Live Telemetry Feeds**: one card per channel with the latest value and the lowest and highest values seen (arrows down and up). Click a card to put it on the speedometer.
- **RESET STATS**: collapses every channel's min and max to its current value, so the auto-range starts over.

There are no warning or danger zones, peak-hold markers, or limits to set.

---

### 3. Upstream Standards & Engineering Attribution

| Standard / Component | Authoring Entity | Purpose & Reference |
| :--- | :--- | :--- |
| **W3C WebSerial Telemetry Standard** | W3C Web Incubator Community Group (WICG) | Standardized browser streaming endpoint for real-time binary telemetry. [W3C Spec](https://wicg.github.io/serial/) |
| **HTML5 Canvas Polar Trigonometry Engine** | W3C / WHATWG | High-performance immediate-mode vector needle deflection and arc render pipeline. |
`
  },
  {
    id: 'alerts',
    toolId: 'alerts',
    category: 'utilities',
    title: 'Crash & Panic Alerts Deck — Kernel Exceptions & Guru Meditation',
    summary: 'Serial watcher that matches crash signatures (Guru Meditation, watchdog resets, HardFault, failed asserts), sounds an alarm, pauses the terminal and keeps a log of the dumps.',
    tags: ['Crash Alerts', 'Panic', 'Guru Meditation', 'Watchdog', 'ESP-IDF', 'HardFault', 'addr2line'],
    readTime: '18 min read',
    content: `
# Crash & Panic Alerts Deck — Exception Analyzer

The **Crash & Panic Alerts Deck** (window title *Hardware Crash Trigger & Audio Alert Watcher*) monitors the serial stream for text that matches a list of crash signatures: fatal errors, panics, aborts, and watchdog resets. When one matches, it logs the incident with the received text, plays an alarm, and can pause the terminal so the dump is not scrolled away. It does not decode the dump itself.

---

### 1. Understanding ESP-IDF Guru Meditation Errors

When an unhandled CPU exception occurs on an ESP32, the core halts user execution, saves register state, and outputs a **Guru Meditation Error** banner:

\`\`\`text
Guru Meditation Error: Core 0 panic'ed (LoadProhibited). Exception was unhandled.
Core 0 register dump:
PC      : 0x400d1820  PS      : 0x00060030  A0      : 0x800d195c  A1      : 0x3ffb1d90  
A2      : 0x00000000  A3      : 0x3ffb1dc0  A4      : 0x00000001  A5      : 0x00000000  
EXCVADDR: 0x00000000  LBEG    : 0x4000c2e0  LEND    : 0x4000c2f6  LCOUNT  : 0x00000000  
\`\`\`

<details>
<summary>Deep-Dive: Master Exception Cause Dictionary & Register Meanings</summary>

| Exception Cause | Hardware Meaning | Root Cause in C/C++ Code |
| :--- | :--- | :--- |
| **\`LoadProhibited\`** | Attempted to read from an invalid memory address (e.g. \`EXCVADDR == 0x00000000\`). | Dereferencing a NULL pointer or reading from freed memory. |
| **\`StoreProhibited\`** | Attempted to write to a protected or invalid memory region. | Writing through a NULL pointer or writing to Flash ROM. |
| **\`IntegerDivideByZero\`** | Division by zero executed in ALU. | Unchecked math operation: \`x / 0\`. |
| **\`IllegalInstruction\`** | CPU attempted to execute unrecognized opcode. | Function pointer pointing to corrupt RAM or mismatched compiler ISA. |
| **\`InstrFetchProhibited\`** | Program Counter (PC) jumped to non-executable memory zone. | Calling NULL function pointer or stack corruption overwriting return address. |
| **\`UnhandledDebugException\`**| Software breakpoint triggered without active debugger. | Hardcoded \`assert()\` failure or \`abort()\` call. |

#### Key Register Roles:
- **PC (Program Counter)**: The exact memory address of the instruction that caused the panic.
- **EXCVADDR (Exception Virtual Address)**: The invalid memory address that the code attempted to access. If \`EXCVADDR == 0x00000004\`, code attempted to read a struct member at offset 4 from a NULL struct pointer!
- **A0 (Return Address)**: The address the calling function expects execution to return to.
- **A1 (Stack Pointer)**: Current top of the execution stack.
</details>

<details>
<summary>Deep-Dive: Symbolic Resolution using GNU addr2line</summary>

Hexadecimal addresses in register dumps (e.g. \`PC: 0x400d1820\`) are difficult to correlate with source code without the compiler's symbol table.

The deck does not parse addresses or build this command for you. Copy the dump with **COPY DUMP**, pick out the addresses, and resolve them yourself with GNU Binutils:

\`\`\`bash
xtensa-esp32-elf-addr2line -pfiaC -e build/my_project.elf 0x400d1820 0x400d195c
\`\`\`
- **Output**:
  \`\`\`text
  0x400d1820: process_packet at /home/user/esp/main/network.c:84
  0x400d195c: app_main at /home/user/esp/main/main.c:112
  \`\`\`
Directly pinpointing line 84 of \`network.c\` as the exact crash site!
</details>

---

### 2. What the Deck Does

**Default watch patterns** (matched as case-insensitive substrings): \`Guru Meditation Error\`, \`Kernel panic\`, \`wdt reset\`, \`Watchdog Reset\`, \`assert failed\`, \`HardFault\`, \`abort() was called\`, \`CORRUPT HEAP\`.

When a pattern appears in newly received serial text:
1. The incident is added to **Detected Crash Incidents** with a timestamp, the matched signature and the received text (the newest 50 incidents are kept; **Clear Log** empties the list).
2. If **Audio Chime** is on (default), an alarm sound plays.
3. If **Auto-Pause Terminal** is on (default), the main terminal is paused.
4. A line is written to the session log.
5. **COPY DUMP** copies the stored text of that incident to the clipboard.

The Deck keeps a rolling buffer of the last ~4 KB of received text and matches against it, so a signature split across two serial chunks is still caught, and one panic fires only once even though it stays in the buffer. Only the first matching pattern counts per received chunk. The stored text starts a little before the match and runs to the end of the buffer.

**Editing the watch list**: remove a pattern with its x, or type a new one in the **+ text or /regex/i** box and press Enter. Plain entries are matched as case-insensitive text; an entry written as \`/pattern/flags\` (for example \`/guru\s+meditation/i\`) is treated as a regular expression. If the regex is invalid, it is matched as plain text and a small warning is shown. The list resets to the defaults when the window is reopened.

---

### 3. Upstream Project & Engineering Attribution

| Project / Tool | Authoring Organization / Maintainers | Reference & License |
| :--- | :--- | :--- |
| **ESP-IDF Panic & Guru Meditation Architecture** | Espressif Systems (ESP32 SoC Architecture Team) | [docs.espressif.com (ESP-IDF Fatal Errors)](https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-guides/fatal-errors.html) (Apache-2.0) |
| **GNU Binutils (\`addr2line\`)** | Free Software Foundation (FSF GNU Project) | [gnu.org/software/binutils](https://www.gnu.org/software/binutils/) (GPL-3.0) |
`
  },
  {
    id: 'automation',
    toolId: 'automation',
    category: 'utilities',
    title: 'Automated Test Runner & Scripts — Bench Testing Engine',
    summary: 'Build a table of send / expect / timeout steps, run them against the connected serial device, and export a JSON pass/fail report.',
    tags: ['Automation', 'Test Runner', 'Scripting', 'Expect', 'Regression Testing', 'Bench Test', 'QA'],
    readTime: '18 min read',
    content: `
# Automated Test Runner & Scripts — Bench Testing Engine

The **Automated Test Runner** (window title *Automated Serial Test Runner & Scripting*) lets you define a short sequence of steps, each of which sends text to the connected serial device and waits for a response containing an expected string. It suits repetitive functional checks, modem or bootloader handshakes, and simple factory QA. It is a step table, not a JavaScript scripting environment.

---

### 1. Steps, Presets & Execution

Each step has three fields:

| Field | Meaning |
| :--- | :--- |
| **Send** | The text transmitted to the device. It is sent exactly as stored, with no line ending added. |
| **Expect** | A plain substring (not a regular expression) that must appear in the received serial text. |
| **Timeout** | How long to wait for the substring, in milliseconds. |

Use **Add Step** to append a step (default \`AT\r\n\` expecting \`OK\`, 1000 ms) and the trash icon to remove one (the last remaining step cannot be removed). Fields are locked while a suite is running.

> The preset steps contain real control characters (carriage return, line feed, Ctrl+C). The Send box shows them as whitespace. Typing a backslash followed by the letter r sends those two characters literally; it is not converted to a carriage return.

**Presets** (the buttons in the header) replace the step list:
- **AT**: *AT Command Modem Test* (\`AT\`, \`ATE0\`, \`AT+CSQ\`).
- **MicroPython**: *MicroPython REPL Handshake* (Ctrl+C twice expecting \`>>>\`, then print \`sys.platform\`).
- **U-Boot**: *U-Boot Bootloader Interrupt* (three spaces expecting \`=>\`, then \`version\`).

**RUN TEST SUITE** executes the steps in order: clear the receive buffer, send, then keep collecting everything the device sends after that step's transmit and pass as soon as the expected text shows up in it, or fail when the timeout elapses (text received before the step was sent is not counted). A step shows **PASSED** or **FAILED** with the time taken. The suite keeps going after a failure, pauses 200 ms between steps, and plays a success chime or a warning chirp at the end. The button turns into **ABORT SUITE** while running. Results are also written to the session log.

---

### 2. Exporting Reports

Click **Export Audit Report** to download \`test_report_<timestamp>.json\` containing:
- The suite name and an ISO timestamp.
- Every step (send, expect, timeout) with its result status and duration, or \`untested\` if it has not run.

It does not include port VID/PID, baud rate, a CSV format, or a transcript of the serial traffic.

---

### 3. Upstream Architecture & Engineering Attribution

| Framework / Architecture | Originator & Best Practices | Reference |
| :--- | :--- | :--- |
| **Hardware-in-the-Loop (HIL) Automated Bench Testing** | Embedded Systems Testing Methodologies & CI/CD Bench Testing Standards | [IEEE Embedded Systems Standards](https://standards.ieee.org) |
| **W3C WebSerial Asynchronous Command Pipeline** | W3C Web Incubator Community Group (WICG) | [W3C WebSerial Spec](https://wicg.github.io/serial/) |
`
  },
  {
    id: 'autopsy',
    toolId: 'autopsy',
    category: 'utilities',
    title: 'USB Recon & Device Autopsy — Descriptor Analysis & Clones',
    summary: 'Interrogate any USB device over WebUSB: identify the silicon from its VID/PID, claim interfaces, send and listen on raw endpoints, and trigger bootloader entry sequences.',
    tags: ['USB Recon', 'Autopsy', 'Descriptors', 'WebUSB', 'VID/PID', 'Bootloader', 'DFU', '1200-baud'],
    readTime: '20 min read',
    content: `
# USB Recon & Device Autopsy — Descriptor Analysis & Clones

The **USB Recon & Autopsy** tab (in the *USB Explorer & Autopsy* window, next to the **Descriptor Explorer** tab covered in the USB Descriptors article) uses the **W3C WebUSB API** to open any USB device you pick, show what the browser reports about it, look its VID/PID up in a built-in chip database, and let you talk to its endpoints directly. A second tab holds bootloader-entry sequences and a third a smart-vape / PCB teardown guide. It does not detect counterfeit chips.

---

### 1. Under the Hood: USB Chapter 9 Descriptor Hierarchy

When a USB device is plugged in, the host controller issues standard \`GET_DESCRIPTOR\` control requests (Request Type \`0x80\`, Request \`0x06\`) to read the device's hierarchical descriptor tree:

\`\`\`text
[Device Descriptor] (VID / PID / Max Packet Size / Classes)
       |
       +---> [Configuration Descriptor] (Power / Attributes / Interfaces)
                   |
                   +---> [Interface 0: CDC Management]
                   |           |
                   |           +---> [Endpoint 1: Interrupt IN (Status)]
                   |
                   +---> [Interface 1: CDC Data]
                               |
                               +---> [Endpoint 2: Bulk OUT (Tx Data)]
                               +---> [Endpoint 3: Bulk IN  (Rx Data)]
\`\`\`

The Recon tab shows the parts of this tree that WebUSB exposes (VID/PID, names, serial, USB version, class codes, and for each interface of the active configuration its first alternate setting's class/subclass/protocol and endpoints). For the full raw descriptor dump use the **Descriptor Explorer** tab.

<details>
<summary>Deep-Dive: Complete 18-Byte Device Descriptor Bitfield Mapping</summary>

| Offset | Field Name | Size | Typical Value | Description |
| :---: | :--- | :---: | :---: | :--- |
| **0** | \`bLength\` | 1 B | \`0x12\` | Length of descriptor in bytes (Strictly 18 bytes). |
| **1** | \`bDescriptorType\` | 1 B | \`0x01\` | \`0x01\` = DEVICE Descriptor. |
| **2** | \`bcdUSB\` | 2 B | \`0x0200\` | USB specification version (e.g. USB 2.0 = \`0x0200\`, USB 1.1 = \`0x0110\`). |
| **4** | \`bDeviceClass\` | 1 B | \`0x02\` / \`0x00\` | \`0x02\` = Communications Device Class (CDC), \`0x00\` = Interface-defined. |
| **5** | \`bDeviceSubClass\` | 1 B | \`0x00\` | Subclass code. |
| **6** | \`bDeviceProtocol\` | 1 B | \`0x00\` | Protocol code. |
| **7** | \`bMaxPacketSize0\` | 1 B | \`64\` | Maximum packet size for Endpoint 0 (typically 64 bytes). |
| **8** | \`idVendor\` (VID) | 2 B | \`0x1A86\` | 16-bit USB Vendor ID assigned by USB-IF. |
| **10**| \`idProduct\` (PID) | 2 B | \`0x7523\` | 16-bit Product ID assigned by manufacturer. |
| **12**| \`bcdDevice\` | 2 B | \`0x0264\` | Device release number in binary-coded decimal. |
| **14**| \`iManufacturer\` | 1 B | \`1\` | String descriptor index for manufacturer name. |
| **15**| \`iProduct\` | 1 B | \`2\` | String descriptor index for product name. |
| **16**| \`iSerialNumber\` | 1 B | \`3\` | String descriptor index for unique serial number. |
| **17**| \`bNumConfigurations\`| 1 B | \`1\` | Number of supported configurations (almost always 1). |

</details>

<details>
<summary>Deep-Dive: Chip Identification & Bootloader Forcers</summary>

**Silicon fingerprint.** The VID/PID pair is looked up in a built-in table (\`usbDatabase\`) of common USB-to-UART bridges, native-USB microcontrollers and similar parts. A match shows the chip name, notes and operating-logic voltage under **CHIP ANALYSIS**. This is a lookup by ID only: it does not probe the silicon, check serial numbers or latency timers, and cannot tell a genuine FTDI/CH340/PL2303 from a clone.

**BOOTLOADER FORCERS tab** (most need the app's serial port connected and use its DTR/RTS lines and baud rate):
| Button | What it does |
| :--- | :--- |
| **PULSE 1200-BAUD KNOCK** | Sets 1200 baud, toggles DTR, then restores 115200. Works on boards that enter their bootloader on the 1200-baud touch (Pico BOOTSEL/UF2, Arduino Leonardo, SAMD21). |
| **EXECUTE ESP32 STRAPPING** | Toggles RTS (to EN) and DTR (to GPIO0) so an ESP32/ESP8266 with the usual auto-reset circuit boots into ROM download mode. |
| **SEND DFU_DETACH REQUEST** | Sends the DFU class \`DFU_DETACH\` control transfer through WebUSB. Requires a device selected with **INTERROGATE ANY USB DEVICE**. |
| **FIRE AUTOBOOT ABORT STORM** | Sends Space / Ctrl+C / Enter about 26 times at 40 ms intervals; power-cycle the target while it runs to stop U-Boot's autoboot countdown. |
| **TRANSMIT REBOOT STRINGS** | Sends eight command strings 80 ms apart (\`reboot bootloader\`, \`reboot edl\`, \`reboot fastboot\`, \`machine.bootloader()\`, \`sys bootloader\`, \`boot\`, \`B\`, \`AT+REBOOT\`). |

The sequences are generic; whether any of them works depends on the target firmware. A status line under the cards reports what was done.
</details>

---

### 2. Step-by-Step Reconnaissance

1. Connect any mystery USB device and click **INTERROGATE ANY USB DEVICE** (**DEVICE AUTOPSY** tab).
2. Select the device in the browser's WebUSB permission dialog (the request has no filters, so any device the browser can access is listed; devices held by an OS driver may fail to open or claim).
3. The **SILICON FINGERPRINT** panel shows product, manufacturer, VID/PID and the chip analysis. The right panel lists the enumerated interfaces with their endpoints and a USB version / serial header.
4. Click **CLAIM** on an interface to claim it (this fails if the OS or another program owns it).
5. Pick an **ENDPOINT** and click **LISTEN** to read IN transfers (64 bytes per read, last 50 shown with timestamp, hex and ASCII), or type hex bytes (for example \`41 54 0D 0A\`) and click **SEND BYTES** to write to an OUT endpoint.
6. **BOOTLOADER FORCERS** and **VAPE & PCB TEARDOWN** (a collapsible step-by-step guide to opening disposable vapes and finding GND, 3.3 V, UART and SWD pads) are the other two tabs.

---

### 3. Upstream Standards & Engineering Attribution

| Standard / Database | Authoring Organization / Maintainers | Reference & Specification |
| :--- | :--- | :--- |
| **USB 2.0 / 3.0 Device Class Specification** | USB Implementers Forum (USB-IF) | [usb.org/documents](https://www.usb.org/documents) |
| **The Linux USB ID Repository** | Stephen J. Gowdy & Linux USB Community | [linux-usb.org/usb.ids](http://www.linux-usb.org/usb.ids) (Public Domain) |
| **W3C WebUSB API Specification** | W3C Web Platform Incubator Community Group (WICG) | [wicg.github.io/webusb](https://wicg.github.io/webusb/) |
`
  },
  {
    id: 'esp-dump',
    toolId: 'esp-dump',
    category: 'utilities',
    title: 'Silicon Memory Dump — Hardware eFuses & Flash Geometry',
    summary: 'Identify an ESP chip and read its eFuse MAC address through the ROM bootloader, then dump any range of SPI flash to a .bin file via the esptool-js RAM stub.',
    tags: ['Silicon Dump', 'eFuses', 'Flash Dump', 'esptool', 'ROM Bootloader', 'MAC Address', 'ESP32'],
    readTime: '18 min read',
    content: `
# Silicon Memory Dump — eFuse & Flash Geometry

The **Silicon Memory Dump** workbench (window title *ESP32 Silicon Inspection & Flash Memory Dump*) has two functions, neither of which writes to the chip's flash:
- **READ CHIP EFUSES**: uses the ROM bootloader's register-read command (\`READ_REG\`) on the app's connected serial port to identify the chip family and read the factory **MAC address** from eFuse registers. The MAC is only decoded for ESP32, ESP32-S3 and ESP32-C3; for other chips only the family is shown.
- **DUMP FLASH TO .BIN**: reads a flash range and downloads it as a file, using the esptool-js RAM stub.

It does not read or display the other eFuse blocks, security flags, silicon revision or the flash chip's JEDEC ID.

---

### 1. What Are eFuses?

eFuses are microscopic, one-time programmable (OTP) physical electronic fuses inside the silicon die. Once burned (blown from 0 to 1), an eFuse can **never** be reset or restored. They store permanent hardware characteristics and cryptographic security configurations.

<details>
<summary>Background: ESP32 eFuse Memory Map (BLOCK0 to BLOCK3) & SPI Flash IDs</summary>

For reference, the original ESP32 divides its eFuse controller into 4 physical blocks (the workbench itself only reads the MAC words in BLOCK0):

| Block | Name | Bit Length | Function & Security Significance |
| :--- | :--- | :---: | :--- |
| **BLOCK0** | System Parameters | 256 bits | Factory MAC address, silicon revision, flash voltage (1.8V vs 3.3V), JTAG disable, download mode lock. |
| **BLOCK1** | Flash Encryption Key | 256 bits | 256-bit AES key for on-the-fly hardware flash decryption. Read-protected when active. |
| **BLOCK2** | Secure Boot Key | 256 bits | 256-bit SHA-256 digest or RSA public key hash for cryptographically signed boot verification. |
| **BLOCK3** | Custom User Data | 256 bits | Free space for OEM serial numbers and device certificates. |

#### SPI Flash JEDEC ID (background only; not read by this tool)
SPI flash chips answer the JEDEC command \`0x9F\` with a manufacturer byte and a capacity byte:
- **Manufacturer Byte**:
  - \`0xEF\`: Winbond Electronics
  - \`0xC8\`: GigaDevice
  - \`0xC2\`: Macronix
  - \`0x20\`: Micron / XMC
- **Capacity Byte**:
  - \`0x16\`: 32 Mbit (4 Megabytes)
  - \`0x17\`: 64 Mbit (8 Megabytes)
  - \`0x18\`: 128 Mbit (16 Megabytes)

</details>

---

### 2. Using the Tool

1. **READ CHIP EFUSES**: connect the board's serial port in the app first (the button is disabled otherwise). The workbench borrows the port from the terminal, talks to the ROM bootloader, and shows **Target MAC Address** and **Chip Architecture**. The board may need to be in download mode (see the Bootloader Forcers). The workbench does not report Secure Boot, flash encryption or JTAG state; the earlier fixed "Security Flags" label was removed because it was not a measurement.
2. **Pick a range**: click a **Quick Backup Targets** preset (Bootloader Partition 0x1000 / 28 KB, Partition Table 0x8000 / 4 KB, NVS Storage 0x9000 / 20 KB, Full 4MB Flash Backup 0x0 / 4 MB) or type a **Start Offset (Hex)** and **Dump Size (Bytes)**.
3. Click **DUMP FLASH TO .BIN**. This does not use the port already connected in the app: the browser asks you to choose a serial port, then esptool-js (loaded from a CDN, so internet access is needed) opens it at 115200 baud, uploads the RAM stub, and reads flash with a progress bar. Because the stub is used, it works on newer ESP chips (S2, S3, C2, C3, C6, H2) as well as the ESP8266 and ESP32.
4. The result downloads as \`esp_flash_dump_0x<offset>_<length>B.bin\`. If the port is busy, disconnect it in the Terminal and close other serial tabs first.

Dumps from a chip with flash encryption enabled are read as stored (ciphertext).

---

### 3. Upstream Project & Engineering Attribution

| Project / Tool | Authoring Organization / Maintainers | Repository & Reference | License |
| :--- | :--- | :--- | :--- |
| **espefuse.py / esptool.py** | Espressif Systems (Fredrik Ahlberg, Angus Gratton, et al.) | [github.com/espressif/esptool](https://github.com/espressif/esptool) | GPL-2.0 |
| **ESP32 Technical Reference Manual (eFuse Controller)** | Espressif Systems | [espressif.com Documentation](https://www.espressif.com) | Hardware Specification |
| **JEDEC Solid State Technology Association Standard** | JEDEC Standard JESD216 (Serial Flash Discoverable Parameters - SFDP) | [jedec.org](https://www.jedec.org) | Open Industry Standard |
`
  },
  {
    id: 'usb-descriptors',
    toolId: 'usb-descriptors',
    category: 'utilities',
    title: 'USB Descriptor Explorer — lsusb -v in the Browser',
    summary: 'Pick any USB device and read its descriptor tree — configurations, interfaces, alternate settings, endpoints and string descriptors — with class / subclass / protocol codes decoded into plain language. Read-only.',
    tags: ['USB', 'Descriptor', 'lsusb', 'WebUSB', 'Endpoint', 'Interface', 'Class Codes', 'Enumeration'],
    readTime: '10 min read',
    content: `
# USB Descriptor Explorer

The **USB Descriptor Explorer** is a WebUSB equivalent of \`lsusb -v\`: choose a device from the browser's picker and see exactly how it describes itself to the host — how many configurations it has, what interfaces and alternate settings each one exposes, and the endpoints under each interface. Every class / subclass / protocol triple is decoded into a human label. It is strictly **read-only**: it reads the descriptors the browser already parsed and never sends data to the device.

It's the natural first stop before driving an unfamiliar device with any of the other tools — it tells you which interface and endpoints a protocol lives on.

---

### 1. How USB devices describe themselves

When a device is plugged in, it answers a fixed series of **GET_DESCRIPTOR** requests. The descriptors nest:

\`\`\`
Device
 └─ Configuration (power, number of interfaces)
     └─ Interface (a function: HID, CDC, Mass Storage, vendor...)
         ├─ Alternate setting (e.g. different bandwidth for a camera)
         └─ Endpoint (a one-way pipe: control / bulk / interrupt / isochronous)
\`\`\`

- **Class codes** identify the function. They live either at the device level, or — far more commonly — per interface, so a single gadget can be several things at once (a "composite" device: serial + storage + HID).
- **Endpoint addresses** carry a direction bit: \`0x81\` is endpoint 1 **IN** (device → host), \`0x01\` is endpoint 1 **OUT**.

---

### 2. What the tool decodes

| Field | Example | Meaning |
| :--- | :--- | :--- |
| VID:PID | \`04e8:6860\` | Vendor and product ID (hex). |
| USB version | \`2.00\` | bcdUSB. |
| Class triple | \`[255/66/3]\` → "Android fastboot" | Interface class / subclass / protocol. |
| Endpoint | \`0x81 Bulk 512B\` | Address, transfer type, max packet size. |

Known triples it names on sight include SCSI Bulk-Only mass storage (\`8/6/50\`), HID boot keyboard/mouse, CDC ACM serial, DFU, PTP still-image, USBTMC, and Android ADB/fastboot.

---

### 3. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **INSPECT A USB DEVICE** | Opens the browser picker; the chosen device's tree is rendered. |
| **Previously allowed devices** | Re-inspect a device the page was already granted, without the picker. |
| **Copy report** | Copies a plain-text, \`lsusb\`-style dump for pasting into a bug report. |

---

### 4. Implementation & Architecture

- **Driver:** [\`src/utils/usbDescriptors.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/usbDescriptors.js) — all pure functions. \`describeDevice\` walks the USBDevice tree into a named structure, \`classDetail\` decodes class/subclass/protocol, \`describeEndpoint\` rebuilds the address byte and names the transfer type, and \`toTextReport\` renders the copyable dump.
- **Workbench:** [\`src/components/tools/UsbDescriptorExplorer.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/UsbDescriptorExplorer.jsx) renders the summary, the nested configuration/interface/endpoint view, and the granted-device list (\`navigator.usb.getDevices()\`).
- **Tests:** [\`tests/usbDescriptors.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/usbDescriptors.test.js) checks class decoding, BCD/ID formatting, endpoint address assembly and the full tree against hand-built device objects.

---

### 5. References

| Resource | Source |
| :--- | :--- |
| Descriptor layout | USB 2.0 Specification, Chapter 9 |
| Class codes | USB-IF "Defined Class Codes" |
| WebUSB device model | W3C WebUSB specification |
`
  },
  {
    id: 'hid',
    toolId: 'hid',
    category: 'utilities',
    title: 'HID Inspector — Decode Keyboards, Mice, Gamepads & Their Live Reports',
    summary: 'Open any HID device over WebHID, read its report descriptor decoded into named usages, and watch input reports turn into named fields — buttons, axes, keys — in real time.',
    tags: ['HID', 'WebHID', 'Keyboard', 'Mouse', 'Gamepad', 'Report Descriptor', 'Usage Tables', 'Input Report'],
    readTime: '12 min read',
    content: `
# HID Inspector

The **HID Inspector** opens a Human Interface Device over WebHID and shows two things: the **report descriptor** (what fields the device defines, decoded from USB HID usage codes into names like "X", "Button 2", "Caps Lock") and the **live input reports** (each movement or keypress decoded into those named fields in real time). It's the quickest way to understand an unfamiliar controller, macro pad, or vendor gadget.

It only ever writes to a device when you explicitly send an output or feature report.

---

### 1. How HID describes itself

Every HID device ships a **report descriptor**: a compact program of items that defines one or more **reports**, each a packed bit-field. An item says "the next N fields are M bits each, they mean usage U on page P, their range is min..max." The browser parses this for you into \`device.collections\`, and this tool turns those into readable field lists.

- A **usage page** groups usages: Generic Desktop (axes, mouse, keyboard), Button, LED, Consumer (media keys), Digitizer, Vendor-defined.
- A **variable** item is one value per usage (X, Y, each button bit). An **array** item is a list of slots that each hold a usage code — how keyboards report "these keys are currently down."

---

### 2. Decoding a live report

When the device sends an input report, WebHID hands you the report id and a \`DataView\` (without the id byte). The tool walks the matching report's fields bit by bit (LSB-first, sign-extending signed axes) and labels each value by its usage. A boot mouse becomes \`Button 1 = 1, X = +5, Y = -3\`; a keyboard becomes the set of key usages currently held.

---

### 3. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **OPEN HID DEVICE** | Browser picker; opens the device and subscribes to its input reports. **CLOSE** disconnects. |
| **LIVE INPUT** | The most recent report as raw hex and as decoded, named fields (array items such as pressed keys list the active usages). |
| **REPORT DESCRIPTOR** | Every collection's input / output / feature reports with their sizes and fields (constant padding shows as \`pad\`). |
| **SEND REPORTS** | Pick an output report, enter hex bytes and press **SEND**; if the device exposes keyboard LED usages, toggle buttons for them appear. For feature reports, **GET** reads one and **SET** writes the hex bytes you typed (after a confirmation). A small log shows what was sent and received. |
| **REPORT RATE** | Rate (Hz), mean interval, jitter, min, max and sample count over the last 3 seconds of input reports. |
| **RECORD & PLAY BACK** | **RECORD** / **STOP** capture input reports with timing; **SAVE** downloads them as JSON and **OPEN** loads a saved file; **PLAY** feeds them back through the decoder with their original timing. Playback only drives the on-screen decoder; nothing is typed or clicked on your computer. |

There is no simulated demo device: the tool needs a real HID device.

---

### 4. Implementation & Architecture

- **Driver:** [\`src/utils/hidInspector.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/hidInspector.js) — pure functions: usage-page/usage naming, \`describeCollections\` to summarize the descriptor, \`readBits\` for LSB-first signed/unsigned bit extraction, and \`decodeReport\` to turn report bytes into named fields (handling both variable and array items).
- **Workbench:** [\`src/components/tools/HidInspectorWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/HidInspectorWorkbench.jsx) subscribes to \`inputreport\` events and renders the decoded fields live.
- **Tests:** [\`tests/hidInspector.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/hidInspector.test.js) decodes a boot mouse (buttons + signed motion) and a boot keyboard (modifiers + key array) from raw report bytes.

---

### 5. References

| Resource | Source |
| :--- | :--- |
| HID class | USB Device Class Definition for HID 1.11 |
| Usage codes | USB-IF HID Usage Tables 1.4 |
| WebHID | W3C WebHID specification |
`
  },
  {
    id: 'mass-storage',
    toolId: 'mass-storage',
    category: 'utilities',
    title: 'USB Mass Storage Inspector — SCSI Identity, Capacity & Raw Sectors',
    summary: 'Read a USB drive at the block level over the Bulk-Only Transport: SCSI identity and capacity, MBR/GPT partitions, FAT/exFAT file browsing with deleted-file recovery, raw sectors, and full images with SHA-256. Strictly read-only: no WRITE command is implemented.',
    tags: ['Mass Storage', 'SCSI', 'BOT', 'INQUIRY', 'READ CAPACITY', 'Sector', 'WebUSB', 'Forensics', 'FAT', 'exFAT', 'GPT', 'Disk Image', 'Read-only'],
    readTime: '12 min read',
    content: `
# USB Mass Storage Inspector (Read-Only)

The **Mass Storage Inspector** talks to a USB drive the way the operating system does — at the block level — but only to *read*. It reports what the drive says it is (SCSI **INQUIRY**), how big it is (**READ CAPACITY**), lists its **MBR / GPT partitions** and filesystems, lets you browse FAT12/16/32 and exFAT volumes (including deleted entries), dump any **sector** (**READ(10)**), and save a whole drive or partition as a disk image with its SHA-256. No WRITE command exists in the driver, so it cannot change the drive.

> **It claims the drive.** WebUSB takes exclusive control of the interface for the tab, so the OS loses access to that drive until you disconnect. Use a drive that is **not mounted / in use**, and never one with data you cannot afford to disturb. Reading is safe; yanking a mounted disk out from under the OS is not.

---

### 1. Bulk-Only Transport (BOT)

Mass-storage devices (class \`08\`, protocol \`50\`) wrap SCSI commands in three phases over two bulk endpoints:

1. **CBW** — a 31-byte *Command Block Wrapper* (signature \`USBC\`, a tag, the data length, a direction flag, and the SCSI command bytes) sent on bulk OUT.
2. **Data** — the payload moves on bulk IN or OUT.
3. **CSW** — a 13-byte *Command Status Wrapper* (signature \`USBS\`, the matching tag, a residue, and a status byte: 0 = passed).

The SCSI commands used here are **INQUIRY** (0x12), **READ CAPACITY(10)** (0x25) and **READ(10)** (0x28) — all read-only.

---

### 2. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **INSPECT A DRIVE (WEBUSB)** | Claims the drive (after a confirmation warning) and reads INQUIRY, capacity and the partition table. **DISCONNECT** releases it. |
| **Identity / capacity fields** | Vendor, Product, Revision, Type, Removable, Block size, Blocks, Capacity. |
| **PARTITIONS** | Table of partitions (scheme, start LBA, size, detected filesystem). Per row: **BROWSE** (FAT12/16/32 and exFAT only), **LBA** (puts the partition's first sector into the sector viewer), **IMAGE** (saves that partition). **IMAGE WHOLE DRIVE** saves the entire drive. |
| **Imaging progress** | Shows bytes done, speed and time left, with **CANCEL**; the finished image's SHA-256 is displayed. Where the browser supports it (Chrome/Edge) it streams straight to a file you choose; otherwise it buffers in memory and images over 1 GB are refused. Files are named \`<name>.img\`. |
| **File browser** | Breadcrumb navigation, name / size / modified (UTC) / attributes. Deleted entries are listed and marked; **VIEW** previews the first 64 KB (text or hex), **SAVE** downloads a file, and **RECOVER** replaces SAVE for deleted ones. Files over 512 MB are not extracted this way (use a full image). |
| **SECTOR VIEWER** | Enter an LBA and press **READ SECTOR** (or Enter) to dump that one block (the drive's block size, normally 512 bytes) as hex + ASCII. |

Deleted-file recovery reads contiguous clusters from the file's first cluster, so it works for files that were not fragmented and whose space has not been reused. There is no simulated demo drive in the UI.

---

### 3. Implementation & Architecture

- **Driver:** [\`src/utils/massStorageDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/massStorageDriver.js) — \`buildCbw\`/\`parseCsw\`, \`parseInquiry\`/\`parseCapacity\`, and \`MassStorageDevice\` with \`testUnitReady\`/\`inquiry\`/\`readCapacity\`/\`read\`. No write path exists.
- **Workbench:** [\`src/components/tools/MassStorageWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/MassStorageWorkbench.jsx) — identity, capacity, partitions, file browser, imaging and a hex sector viewer, behind a claim-the-drive confirmation. Partition and filesystem parsing live in \`src/utils/diskImage.js\`.
- **Tests:** [\`tests/massStorage.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/massStorage.test.js) checks CBW/CSW framing and INQUIRY/capacity/sector reads against a simulated drive.

> SMART and ATA pass-through (SAT) are not included; this is a block-level inspector, not a health tool.

---

### 4. References

| Resource | Source |
| :--- | :--- |
| BOT | USB Mass Storage Class — Bulk-Only Transport 1.0 |
| SCSI commands | SCSI Primary (SPC) and Block (SBC) command sets |
| WebUSB | W3C WebUSB specification |
`
  },
  {
    id: 'ptp',
    toolId: 'ptp',
    category: 'utilities',
    title: 'PTP / MTP Camera — Pull Photos & Metadata over WebUSB',
    summary: 'Connect a camera or phone in PTP mode and browse its files: device info, storage and battery, thumbnails, filenames, formats, dimensions and dates, single or bulk download, and (where the device allows) delete and remote capture.',
    tags: ['PTP', 'MTP', 'Camera', 'Photos', 'WebUSB', 'Still Image', 'PIMA 15740', 'Object Info'],
    readTime: '12 min read',
    content: `
# PTP / MTP Camera

The **PTP** workbench pulls photos and their metadata off a camera or phone using the **Picture Transfer Protocol** — the standard "camera" USB mode (MTP is PTP with vendor extensions). Put the device in PTP mode (on a phone, choose **Transfer photos / PTP** from the USB notification) and you can list every file, read its info, preview thumbnails, and download it. Deleting files and triggering the shutter are also available when the device advertises those operations; the file listing itself is read-only.

---

### 1. The protocol

PTP is a transaction protocol over bulk endpoints. Everything is a **container** with a 12-byte header (length, type, operation/response code, transaction id):

- **Command** containers carry an operation and up to five 32-bit parameters.
- **Data** containers carry a dataset (device info, an object's info, or an object's bytes).
- **Response** containers end the transaction (\`0x2001\` = OK).

A read like \`GetObjectInfo\` is: send the Command (with the object handle), read the Data container (the ObjectInfo dataset), read the Response. Datasets use PTP's own encoding — little-endian integers, length-prefixed UTF-16 strings, and count-prefixed arrays.

Key operations: \`OpenSession\`, \`GetDeviceInfo\`, \`GetStorageIDs\`, \`GetStorageInfo\`, \`GetObjectHandles\`, \`GetObjectInfo\`, \`GetObject\`, \`GetThumb\`, \`DeleteObject\`, \`InitiateCapture\`, \`CloseSession\`.

---

### 2. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **CONNECT CAMERA (WEBUSB)** | Opens the device, opens a session, reads device info, storage and battery, and lists files. **DISCONNECT** closes the session. |
| **Device panel** | Manufacturer, Model, Firmware, Serial, Battery (if reported), and one field per storage with free / total space. |
| **FILES table** | Checkbox, thumbnail, Filename, Format, Size, Dimensions, Date, and a per-row download button. The header shows the object count and how many are selected. |
| **THUMBNAILS** | Fetches embedded thumbnails for the listed files. |
| **DOWNLOAD SELECTED / DOWNLOAD ALL** | Saves several files into a folder you pick (Chrome/Edge), or as a single zip if the browser cannot pick a folder. |
| **DELETE** | Appears only if the device supports \`DeleteObject\`; deletes the selected files after a confirmation. This cannot be undone. |
| **CAPTURE** | Appears only if the device supports \`InitiateCapture\`; fires the shutter, then re-lists files and selects the new ones. |
| **REFRESH** | Re-list the files (after taking a new photo, say). |

There is no simulated demo camera.

---

### 3. Implementation & Architecture

- **Driver:** [\`src/utils/ptpDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/ptpDriver.js) — \`buildContainer\`/\`parseContainerHeader\`, a \`DataReader\` for PTP strings/arrays, \`parseDeviceInfo\`/\`parseObjectInfo\`, and \`PtpDevice\` whose \`transaction()\` runs the command/data/response phases (reassembling large data across USB transfers).
- **Workbench:** [\`src/components/tools/PtpWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/PtpWorkbench.jsx).
- **Tests:** [\`tests/ptp.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/ptp.test.js) covers container framing, PTP string/array decoding, and the session/device-info/handles/object-info/download flow against a simulated camera.

---

### 4. References

| Resource | Source |
| :--- | :--- |
| PTP | PIMA 15740 / ISO 15740 |
| MTP | Microsoft Media Transfer Protocol (PTP extension) |
| WebUSB | W3C WebUSB specification |
`
  },
  {
    id: 'fido2',
    toolId: 'fido2',
    category: 'utilities',
    title: 'FIDO2 / U2F Security Key Inspector — CTAP-HID over WebHID',
    summary: 'Read a FIDO2 / U2F authenticator over CTAP-HID: allocate a channel with CTAPHID_INIT, read authenticatorGetInfo (versions, AAGUID, options, limits), and run a PING round-trip. Strictly read-only.',
    tags: ['FIDO2', 'U2F', 'CTAP', 'CTAP-HID', 'WebAuthn', 'Security Key', 'CBOR', 'AAGUID', 'WebHID'],
    readTime: '12 min read',
    content: `
# FIDO2 / U2F Security Key Inspector

The **FIDO2** workbench reads what a security key (YubiKey, SoloKey, Titan, a platform authenticator, …) says about itself over **CTAP-HID**. It allocates a channel, asks the key for its capabilities with **authenticatorGetInfo**, and can run a **PING** round-trip. It is read-only: it never creates, lists, or deletes credentials, never changes the PIN, and never resets the key.

---

### 1. CTAP-HID framing

A security key is a HID device on usage page \`0xF1D0\`. Messages travel in 64-byte reports:

- An **init packet**: channel id (4), command (1, high bit set), payload length (2, big-endian), and up to 57 bytes of data.
- **Continuation packets**: channel id (4), a sequence number (1), and up to 59 bytes.

You start with **CTAPHID_INIT** on the broadcast channel \`0xFFFFFFFF\`, sending an 8-byte nonce; the key echoes the nonce and returns a freshly allocated channel id plus its CTAPHID capabilities (does it do CBOR? wink?). Everything after uses that channel.

### 2. CTAP2 and CBOR

FIDO2 commands are **CBOR**-encoded. \`authenticatorGetInfo\` is CTAP2 command \`0x04\` with no parameters; the reply is a status byte (0 = OK) followed by a CBOR map keyed by small integers:

| Key | Field |
| :--- | :--- |
| 1 | versions (e.g. \`U2F_V2\`, \`FIDO_2_0\`, \`FIDO_2_1\`) |
| 3 | AAGUID (the 16-byte model identifier) |
| 4 | options (\`rk\` resident keys, \`uv\` user verification, \`clientPin\`, …) |
| 5 | maxMsgSize |
| 6 | PIN/UV auth protocols |
| 9 | transports |

---

### 3. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **READ SECURITY KEY (WEBHID)** | INIT + authenticatorGetInfo; shows CTAPHID and device version, AAGUID, max message size, versions, options, transports and PIN/UV protocols. **DISCONNECT** closes it. |
| **PING** | A CTAPHID_PING round-trip with 32 bytes; shows "echo matched" or "echo mismatch". |

> **Browser blocklist.** Chrome and Edge hide security keys (HID usage page \`F1D0\`) from web pages, so the device chooser normally shows nothing. The page warns about this: to read a key you own you must start the browser with \`--disable-hid-blocklist\` for that session only, which lets every site you visit request blocked HID devices, so close the browser afterwards. There is no simulated demo key.

---

### 4. Implementation & Architecture

- **Driver:** [\`src/utils/fido2Driver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/fido2Driver.js) — a small CBOR decoder (\`decodeCbor\`), \`buildPackets\` for CTAP-HID framing, \`parseGetInfo\`/\`aaguidToString\`, and \`Fido2Device\` with \`init\`/\`getInfo\`/\`ping\`. No credential or reset operations exist.
- **Workbench:** [\`src/components/tools/Fido2Workbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/Fido2Workbench.jsx).
- **Tests:** [\`tests/fido2.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/fido2.test.js) covers CBOR decoding, AAGUID formatting, packet framing, and INIT / GetInfo / PING against a simulated key.

---

### 5. References

| Resource | Source |
| :--- | :--- |
| CTAP | FIDO Alliance Client to Authenticator Protocol 2.1 |
| CBOR | RFC 8949 |
| WebHID | W3C WebHID specification |
`
  },
  {
    id: 'usb-rea',
    toolId: 'usb-rea',
    category: 'utilities',
    title: 'USB Protocol RE — Turn a Labeled Capture into a Driver',
    summary: 'Load a usbmon or USBPcap capture plus a list of what you clicked in the vendor app, and get the device protocol inferred: a Markdown report, a Python driver scaffold and a Wireshark Lua dissector. An in-browser port of usb-rea.',
    tags: ['USB', 'Reverse Engineering', 'usbmon', 'USBPcap', 'pcapng', 'Wireshark', 'Dissector', 'Protocol Inference', 'usb-rea'],
    readTime: '8 min read',
    content: `
# USB Protocol RE (usb-rea)

Vendor apps for RGB controllers, AIO coolers, lamps and LCD panels talk to their device over a private USB protocol. This tool works the protocol out from a recording. Run the vendor app, capture the USB traffic, note what you clicked and when, and the analyzer lines up each action with the bytes that changed.

It is a browser port of [usb-rea](https://github.com/emirmrkaljevic/usb-rea) by Emir Mrkaljević (MIT). Analysis runs entirely in the page and the capture never leaves your computer. The only network use is an optional OpenDeviceDB lookup that sends just a VID:PID.

---

### 1. Workflow

1. **Look it up first.** The **VID:PID lookup** tab checks a bundled table of devices already supported by liquidctl, rivalcfg, OpenRGB, turing-smart-screen and others. A checkbox adds an online OpenDeviceDB query (it sends only the VID:PID).
2. **Capture** with Wireshark + USBPcap (Windows) or usbmon (Linux) while the vendor app drives the device. The **How to capture** tab has the steps. The analyzer reads pcap or pcapng files (gzip is fine); there is no live capture in the browser.
3. **Mark actions.** In the **Action marker** tab, type a label such as \`brightness 50%\` and press Enter (or **Mark**) just before you click it in the app. Start the capture on the same computer: the timestamps use this PC's clock. **End current action**, **Undo last**, **Download .actions.json**, **Clear** and **Use in Analyze →** manage the list. Record at least 3 values per setting. Labels starting with \`seen\` (\`seen rpm 1180, temp 34\`) record what the app displayed, which is used to decode device replies.
4. **Analyze.** In **Analyze capture**, load the capture, optionally pick the **Target device** (default: the device with the most host-to-device data), load or paste the markers JSON, and click **3. Infer protocol**. **Try the demo (synthetic lamp capture)** runs the whole pipeline on a generated capture with no files.

If you have no markers, click each action with a pause between them, switch to **Labels only (split on pauses)** and list the labels in order, one per line. The traffic is split at the pauses.

---

### 2. What it infers

| Role | Example |
| :--- | :--- |
| Command IDs / constant headers | \`5a 10 …\` vs \`5a 20 …\` |
| Linear values, 8/16/32-bit LE/BE | \`fan 2650\` → \`0a 5a\` |
| Bitfields, lookup tables | DPI 250→\`08\`, 500→\`07\` |
| Rolling counters, checksums | sum8, xor8, CRC8, CRC16 (CCITT, XMODEM, MODBUS, KERMIT) |
| Device replies and readings | RPM \`u16le\`, temperature \`(raw - 40) / 2\` |
| Handshakes, session tokens, state-gated commands | step 2 echoes bytes of the reply to step 1 |
| Image streams to a screen | JPEG/PNG/BMP/WebP/RGB565 frames, kept apart from the commands |

Linear fits must survive a leave-one-out check; otherwise the result falls back to a lookup table and says so.

---

### 3. Outputs

| Output | Use |
| :--- | :--- |
| **Report (.md)** | Every command with its byte layout, value formulas, replies and caveats. |
| **Python driver** | A standalone pyusb scaffold with one function per command. Run it on your own machine. |
| **Wireshark dissector** | Drop the \`.lua\` into Wireshark's plugins folder to name the fields in future captures. |
| **Protocol JSON** | The raw inferred model. |

Each output has **Copy** and **Download** buttons.

---

### 4. Limits

- The browser cannot sniff USB, so capture with the OS tools.
- You still need the vendor app during the recording. Document a device's protocol before the vendor drops support.
- A matching VID:PID in the lookup is a hint, not proof. Vendors reuse IDs.
`
  }
];
