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
    summary: 'Master MicroPython Raw REPL control sequences (0x01-0x04), memory heap inspection, in-browser code editing, and chunked LittleFS/FAT file transfers.',
    tags: ['MicroPython', 'Raw REPL', 'File Manager', 'LittleFS', 'FAT', 'Heap Memory', 'boot.py', 'main.py', 'WebFS'],
    readTime: '22 min read',
    content: `
# MicroPython REPL & File Manager — WebFS & Raw Mode Studio

The **MicroPython Workbench** provides full file system and interactive programming control over microcontrollers running MicroPython or CircuitPython (ESP32, RP2040, STM32, nRF52) without installing command-line tools like \`ampy\`, \`rshell\`, or \`mpremote\`.

---

### 1. What Is This Tool & Why Do You Need It?

When developing with MicroPython, developers frequently need to:
- Inspect files on the board's internal flash storage.
- Upload scripts (\`main.py\`, \`boot.py\`, custom libraries).
- Edit code directly on the microcontroller with instant reboot.
- Monitor free RAM to diagnose memory leaks and heap fragmentation.

The **MicroPython Workbench** communicates directly over WebSerial using MicroPython's built-in **Raw REPL mode**, providing an in-browser graphical file manager, visual flash space indicators, and code editor.

---

### 2. Under the Hood: The Raw REPL Protocol

When connected over serial, MicroPython typically runs a friendly, human-interactive REPL with prompt \`>>> \`. However, friendly REPL mode echoes back every character and inserts auto-indentation, making programmatic file transfers slow and prone to corruption.

The workbench switches the microcontroller into **Raw REPL Mode** by issuing standard ASCII control byte sequences:

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
   | <--- Script Stdout / Stderr ---------------------- | (Stream Output)
   | <--- [0x04] -------------------------------------- | (Execution Finished)
   |                                                    |
   | --- [0x02 (Ctrl+B)] -----------------------------> | (Exit Raw REPL to Normal)
\`\`\`

<details>
<summary>Deep-Dive: Chunked File Upload & Download Mechanics with SHA-256 Checksums</summary>

To transfer binary files (images, audio clips, compiled \`.mpy\` files) reliably across serial without buffer overruns:
1. **Chunked Base64 Streaming**:
   - The file is divided into 128-byte to 512-byte blocks.
   - For each block, the host executes a short Python helper script:
     \`\`\`python
     with open('target_file.ext', 'ab') as f:
         import ubinascii
         f.write(ubinascii.a2b_base64(b'BASE64_CHUNK_DATA=='))
     \`\`\`
2. **Directory Traversal**:
   - The tool lists files and folders using \`os.ilistdir('/')\`:
     - Returns tuples: \`(name, type, inode, size)\`.
     - \`type == 0x4000\`: Subdirectory.
     - \`type == 0x8000\`: Standard File.
3. **Integrity Verification**:
   - After writing all chunks, the tool executes \`uhashlib.sha256()\` on the target file and compares the digest against the host file.
</details>

<details>
<summary>Deep-Dive: Real-Time Memory Heap Profiling & Garbage Collection</summary>

Microcontrollers have extremely limited RAM (e.g. 520 KB on ESP32, 264 KB on RP2040). MicroPython allocates memory dynamically on an internal heap. Over time, allocating small strings or byte buffers causes **heap fragmentation**, leading to \`MemoryError\` exceptions even when total free bytes appear high!

The workbench periodically queries:
\`\`\`python
import gc
free = gc.mem_free()
alloc = gc.mem_alloc()
total = free + alloc
\`\`\`
- **Heap Fragmentation Warning**: If the largest continuous free block is smaller than 20% of total free RAM, the workbench flashes an alert, allowing you to click **Trigger Garbage Collector (\`gc.collect()\`)** to coalesce free memory pages!
</details>

---

### 3. Step-by-Step Walkthrough

1. Connect your MicroPython board via USB and select **115200 baud**.
2. Click **Connect & Open WebFS**:
   - The workbench interrupts any running loop, enters Raw REPL, queries \`os.uname()\`, and builds the directory tree.
3. **Download File**: Click any file in the list (e.g. \`config.json\`) to download it to your computer.
4. **Upload File**: Drag and drop any file from your desktop into the file explorer area.
5. **Edit Code**: Double-click \`main.py\`. The integrated code editor opens with syntax highlighting.
6. Click **Save & Soft Reboot**: Writes the file to flash and issues \`0x04\` to restart user code immediately.

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
    summary: 'Provision Wi-Fi credentials to ESPHome, Home Assistant, and Tasmota devices over serial without mobile apps or captive portals.',
    tags: ['Improv Wi-Fi', 'Home Assistant', 'ESPHome', 'IoT', 'Provisioning', 'Wi-Fi Credentials', 'Tasmota'],
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

**Improv Wi-Fi** replaces this entire friction-filled process. When you plug a device into USB, Skon's USB Tool automatically detects whether the device supports Improv, lists available local Wi-Fi networks, and sends the credentials over serial in under 3 seconds!

---

### 2. Under the Hood: The Improv Serial Frame Format

Improv packets are framed with a human-readable header followed by binary payload bytes:

\`\`\`text
+--------------+-----------+--------+---------------+--------------------+----------+
| Magic String | Packet    | Data   | Data Payload  | 8-Bit Checksum     | Term     |
| "IMPROV"     | Type Byte | Length | (SSID + Pass) | (Modulo 256 sum)   | "\\r\\n"   |
| (6 bytes)    | (1 byte)  | (1 B)  | (N bytes)     | (1 byte)           | (2 bytes)|
+--------------+-----------+--------+---------------+--------------------+----------+
\`\`\`

#### Checksum Calculation:
The checksum byte is calculated by summing every byte from the start of \`IMPROV\` through the end of the Data Payload and taking the modulo 256:
\`\`\`javascript
let sum = 0;
for (let i = 0; i < packetBytes.length; i++) {
  sum = (sum + packetBytes[i]) & 0xFF;
}
\`\`\`

<details>
<summary>Deep-Dive: Improv State Machine & Error Code Enums</summary>

#### The 5 Improv State Enums:
| State Code | State Name | Meaning |
| :---: | :--- | :--- |
| **\`0x00\`** | **Stopped** | Improv service is idle or not initiated. |
| **\`0x01\`** | **Awaiting Authorization** | Target device requires a physical button press before accepting credentials. |
| **\`0x02\`** | **Authorized** | Device is authorized and ready to accept Wi-Fi credentials. |
| **\`0x03\`** | **Provisioning** | Device received SSID and password and is actively authenticating with AP. |
| **\`0x04\`** | **Provisioned** | Device successfully obtained an IP address via DHCP! |

#### Master Error Codes:
- **\`0x00\` (No Error)**: Operation succeeded.
- **\`0x01\` (Invalid RPC Packet)**: Frame header missing or checksum mismatch.
- **\`0x02\` (Unknown Command)**: Unsupported packet type.
- **\`0x03\` (Unable to Connect)**: Incorrect Wi-Fi password or out-of-range SSID.
- **\`0x04\` (Not Authorized)**: Provisioning attempted without required physical authorization.

</details>

---

### 3. Step-by-Step Usage Guide

1. Plug your ESPHome, Tasmota, or custom IoT device into your computer via USB.
2. Open the **Improv Wi-Fi** workbench and select **115200 baud**.
3. Click **Connect**:
   - The workbench queries device identity and displays firmware name (e.g. \`ESPHome Room-Sensor v2024.3.0\`).
4. Type your home Wi-Fi SSID and password (or select from discovered networks).
5. Click **Save & Connect**:
   - The workbench formats the \`IMPROV\` frame and streams it over serial.
   - The device status transitions from **Provisioning** to **Provisioned** and returns its local IP address (e.g. \`192.168.1.145\`) along with a direct web link to open the device dashboard!

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
    summary: 'Extract numerical sensor values from raw serial streams and display them on responsive analog gauge dials and digital meters.',
    tags: ['Telemetry', 'Gauges', 'Analog Meter', 'Speedometer', 'Sensors', 'Metrics', 'Regex'],
    readTime: '15 min read',
    content: `
# Telemetry Gauges — Analog Dials & Digital Meters

The **Telemetry Gauges Workbench** bridges raw, unstructured text streams from serial devices (temperature probes, engine RPM sensors, solar charge controllers, digital multimeters) and transforms them into responsive, high-contrast analog dials and digital HUD instruments.

---

### 1. Under the Hood: Polar Needle Trigonometry & Regex Extraction

The analog gauge engine renders vector needles directly on an HTML5 2D canvas at 60 FPS using smooth trigonometric interpolation.

<details>
<summary>Deep-Dive: Mathematical Needle Deflection Calculations</summary>

Given a gauge with minimum value $V_{\\text{min}}$, maximum value $V_{\\text{max}}$, start angle $\\theta_{\\text{start}} = -135^\\circ$, and sweep angle $\\Delta\\theta = 270^\\circ$:

#### 1. Normalized Sensor Value:
\`\`\`text
Normalized (t) = (Current_Value - V_min) / (V_max - V_min)
(Clamped between 0.0 and 1.0)
\`\`\`

#### 2. Deflection Angle in Radians:
\`\`\`text
Angle (radians) = (theta_start + t * Delta_theta) * (PI / 180)
\`\`\`

#### 3. Needle Tip Coordinates:
\`\`\`text
X_tip = Center_X + Needle_Length * cos(Angle)
Y_tip = Center_Y + Needle_Length * sin(Angle)
\`\`\`

The engine applies exponential smoothing ($V_{\\text{display}} = V_{\\text{prev}} + \\alpha \\times (V_{\\text{target}} - V_{\\text{prev}})$) with $\\alpha = 0.15$ to eliminate needle jitter while preserving instantaneous response!
</details>

<details>
<summary>Deep-Dive: Regular Expression Parser Examples</summary>

The telemetry engine allows you to define custom regular expressions to extract numbers from any incoming string format:

| Sensor Protocol / Printout | Example Serial Line | Recommended Extraction Regex |
| :--- | :--- | :--- |
| **Key-Value String** | \`Temp: 24.5 C, Humidity: 62 %\` | \`Temp:\\s*([\\d\\.]+)\` |
| **CSV Telemetry** | \`$DATA,14.2,3.8,1250\` | \`\\$DATA,[\\d\\.]+,[\\d\\.]+,(\\d+)\` |
| **JSON Payload** | \`{"rpm": 4820, "v": 12.4}\` | \`"rpm"\\s*:\\s*(\\d+)\` |
| **Industrial Tag** | \`PV01=104.22 BAR\` | \`PV01=([\\d\\.]+)\` |

</details>

---

### 2. Configurable Dial Properties

- **Gauge Ranges**: Set minimum and maximum limits (e.g. \`0\` to \`8000\` RPM, \`-40\` to \`+120\` °C).
- **Warning & Danger Zones**: Define colored arc bands (Green = Safe, Amber = Warning, Red = Danger threshold).
- **Peak Hold Indicators**: A subtle marker remains at the maximum observed value to capture transient spikes.
- **Multi-Dial Layouts**: Create up to 6 simultaneous gauges arranged in a responsive grid.

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
    summary: 'Real-time serial scanner detecting ESP-IDF Guru Meditation Errors, Watchdog timer resets, stack overflows, and register dumps.',
    tags: ['Crash Alerts', 'Panic', 'Guru Meditation', 'Watchdog', 'ESP-IDF', 'Stack Overflow', 'addr2line'],
    readTime: '18 min read',
    content: `
# Crash & Panic Alerts Deck — Exception Analyzer

The **Crash & Panic Alerts Deck** is an automated background sentinel that monitors the serial stream for microcontroller fatal errors, architectural panics, FreeRTOS aborts, and watchdog timer resets. When a crash occurs, it isolates the register dump, analyzes the root cause, and formats the debug backtrace for instant symbol resolution.

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

Skon's USB Tool automatically parses the addresses and generates the exact command line to resolve them using GNU Binutils:

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

### 2. Automated Diagnostic Actions

When a panic arrives:
1. The deck flashes an amber emergency banner and emits an optional audio alert chime.
2. Isolates the exception cause and presents plain-English troubleshooting advice.
3. Provides a 1-click **Copy addr2line Command** button populated with all backtrace addresses.

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
    summary: 'Write sandboxed JavaScript automation routines, send timed serial sequences, assert responses, and automate quality control.',
    tags: ['Automation', 'Test Runner', 'Scripting', 'JavaScript', 'Regression Testing', 'Bench Test', 'QA'],
    readTime: '18 min read',
    content: `
# Automated Test Runner & Scripts — Bench Testing Engine

The **Automated Test Runner** enables hardware engineers, quality control technicians, and embedded developers to write and execute automated test suites against physical hardware over WebSerial. It is designed for repetitive functional testing, burn-in validation, calibration verification, and factory QA.

---

### 1. Scripting API & Execution Sandbox

Test routines are written in standard JavaScript and execute in a protected asynchronous sandbox with access to a dedicated \`session\` object:

\`\`\`javascript
async function runTest(session) {
  session.log("Initiating hardware loopback test...");
  
  // Send AT command
  await session.write("AT+GMR\\r\\n");
  
  // Assert response within 1000ms timeout
  const res = await session.expect(/VERSION:([\\d\\.]+)/, 1000);
  session.assert(res !== null, "Firmware version query failed!");
  session.log("Detected firmware version: " + res[1]);
  
  // Wait for sensor settling
  await session.delay(250);
  
  // Check voltage reading
  await session.write("GET_VBUS\\r\\n");
  const vbus = await session.expect(/VBUS:([\\d\\.]+)/, 500);
  const voltage = parseFloat(vbus[1]);
  session.assert(voltage >= 3.25 && voltage <= 3.35, "VBUS out of tolerance: " + voltage + "V");
  
  session.pass("Device passed all electrical and communication tests!");
}
\`\`\`

<details>
<summary>Deep-Dive: Full Async Session API Method Reference</summary>

| Session Method | Parameters | Return Type | Description |
| :--- | :--- | :---: | :--- |
| **\`session.write(str)\`** | \`string\` or \`Uint8Array\` | \`Promise<void>\` | Transmits raw text or binary bytes over the active serial port. |
| **\`session.expect(pattern, timeoutMs)\`**| \`RegExp | string\`, \`number\` | \`Promise<Match | null>\` | Accumulates incoming serial bytes until the regex matches or timeout expires. |
| **\`session.delay(ms)\`** | \`number\` | \`Promise<void>\` | Non-blocking asynchronous delay. |
| **\`session.assert(condition, message)\`**| \`boolean\`, \`string\` | \`void\` | Throws test assertion failure if condition evaluates to false. |
| **\`session.log(message)\`** | \`string\` | \`void\` | Outputs timestamped entry to test console. |
| **\`session.pass(summary)\`** | \`string\` | \`void\` | Marks test case as PASSED (Green badge). |
| **\`session.fail(summary)\`** | \`string\` | \`void\` | Marks test case as FAILED (Red badge). |

</details>

---

### 2. Exporting Audit Reports

Click **Export Audit Report** to generate standardized JSON or CSV logs containing:
- Test suite execution timestamp.
- Serial port VID/PID and baud rate.
- Individual test case results with exact execution durations in milliseconds.
- Complete bidirectional communication transcripts for regulatory compliance records.

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
    summary: 'Inspect USB Device, Configuration, Interface, and Endpoint descriptors, identify counterfeit bridge chips, and analyze USB capabilities.',
    tags: ['USB Recon', 'Autopsy', 'Descriptors', 'WebUSB', 'VID/PID', 'Counterfeit Chips', 'FTDI Clone'],
    readTime: '20 min read',
    content: `
# USB Recon & Device Autopsy — Descriptor Analysis & Clones

The **USB Device Autopsy Workbench** utilizes the **W3C WebUSB API** to perform low-level enumeration and descriptor reverse engineering directly against physical USB hardware. It inspects Chapter 9 USB descriptors, analyzes device capabilities, and detects counterfeit bridge silicon (such as non-genuine FTDI, Prolific, or WCH ICs).

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
<summary>Deep-Dive: Counterfeit Chip Heuristics & Identification Rules</summary>

Counterfeit and clone USB-to-UART bridge ICs are widespread on low-cost development boards. The autopsy engine tests specific silicon quirks:
1. **FTDI FT232R Clones**:
   - Authentic FTDI chips store a unique, randomized 8-character serial number (e.g. \`A104K8RZ\`).
   - Many clones implement a hardcoded static serial number (\`A50285BI\`) across thousands of produced units.
   - Genuine FT232R silicon correctly acknowledges non-standard FTDI latency timer requests (\`0x0A\`); cheap clones return a protocol stall!
2. **Prolific PL2303 Clones**:
   - Clones fail on modern Windows 11 drivers with Error Code 10 because Prolific introduced an authentication handshake in revised silicon.
3. **CH340 Variations (CH340G vs CH340C vs Clones)**:
   - Authentic CH340G requires an external 12 MHz crystal; CH340C integrates an internal oscillator.
   - Non-genuine clones drop bytes at baud rates exceeding 115,200 bps due to imprecise internal RC timing clocks.

</details>

---

### 2. Step-by-Step Reconnaissance

1. Connect any mystery USB device and click **Interrogate USB Device**.
2. Select the device in the browser's WebUSB permission dialog.
3. The autopsy workbench constructs the complete descriptor hierarchy tree on screen.
4. Claim raw interfaces and stream raw bulk or interrupt packets in real-time!

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
    summary: 'Read hardware eFuses, chip security states, MAC addresses, silicon revisions, and SPI flash geometries without flashing firmware.',
    tags: ['Silicon Dump', 'eFuses', 'Flash Geometry', 'Security State', 'ROM Bootloader', 'MAC Address', 'JEDEC'],
    readTime: '18 min read',
    content: `
# Silicon Memory Dump — eFuse & Flash Geometry

The **Silicon Memory Dump** workbench leverages low-level ESP-IDF ROM bootloader register commands (\`READ_REG\` 0x0A) to inspect hardware eFuses and physical flash chip attributes without modifying or overwriting on-chip flash memory.

---

### 1. What Are eFuses?

eFuses are microscopic, one-time programmable (OTP) physical electronic fuses inside the silicon die. Once burned (blown from 0 to 1), an eFuse can **never** be reset or restored. They store permanent hardware characteristics and cryptographic security configurations.

<details>
<summary>Deep-Dive: ESP32 eFuse Memory Map (BLOCK0 to BLOCK3) & Silicon Errata</summary>

The ESP32 family divides its eFuse controller into 4 physical blocks:

| Block | Name | Bit Length | Function & Security Significance |
| :--- | :--- | :---: | :--- |
| **BLOCK0** | System Parameters | 256 bits | Factory MAC address, silicon revision, flash voltage (1.8V vs 3.3V), JTAG disable, download mode lock. |
| **BLOCK1** | Flash Encryption Key | 256 bits | 256-bit AES key for on-the-fly hardware flash decryption. Read-protected when active. |
| **BLOCK2** | Secure Boot Key | 256 bits | 256-bit SHA-256 digest or RSA public key hash for cryptographically signed boot verification. |
| **BLOCK3** | Custom User Data | 256 bits | Free space for OEM serial numbers and device certificates. |

#### SPI Flash Silicon Geometry (JEDEC ID)
By issuing SPI command \`0x9F\` directly through the ROM bootloader SPI engine:
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

### 2. Cryptographic Security Auditing

The inspector verifies whether physical devices are protected against hardware tampering:
- **Flash Encryption**: Confirms whether flash contents are readable if desoldered with a hot air gun.
- **Secure Boot Status**: Confirms whether unsigned custom firmwares can be flashed.
- **JTAG Debug Disable**: Confirms whether physical silicon hardware debugging is locked out.

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
| **Inspect a USB device** | Opens the browser picker; the chosen device's tree is rendered. |
| **Example** | Loads an illustrative composite (CDC + Mass Storage) device so you can explore the view with no hardware (labeled as an example). |
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

It is read-only for input; it only ever writes to a device if you explicitly send an output report.

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
| **Open HID device** | Browser picker; opens the device and subscribes to its input reports. |
| **Demo** | A simulated mouse emitting random reports, to explore the live view with no hardware (labeled as simulated). |
| **Live input** | The most recent report as raw hex and as decoded, named fields. |
| **Report descriptor** | Every collection's input / output / feature reports and their fields. |

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
    summary: 'Read a USB drive at the block level over the Bulk-Only Transport: its SCSI INQUIRY identity, READ CAPACITY geometry, and raw sectors via READ(10). Strictly read-only — no WRITE command is implemented.',
    tags: ['Mass Storage', 'SCSI', 'BOT', 'INQUIRY', 'READ CAPACITY', 'Sector', 'WebUSB', 'Forensics', 'Read-only'],
    readTime: '12 min read',
    content: `
# USB Mass Storage Inspector (Read-Only)

The **Mass Storage Inspector** talks to a USB drive the way the operating system does — at the block level — but only to *read*. It reports what the drive says it is (SCSI **INQUIRY**), how big it is (**READ CAPACITY**), and lets you dump any **sector** (**READ(10)**). No WRITE command exists in the driver, so it cannot change the drive.

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
| **Inspect a drive (WebUSB)** | Claims the drive (after a warning) and reads INQUIRY + capacity. |
| **Demo** | A simulated 8 MiB drive with a boot-signature sector 0 (labeled as simulated). |
| **Identity panel** | Vendor, product, revision, device type, removable flag. |
| **Capacity panel** | Block size, block count, total capacity. |
| **Sector viewer** | Enter an LBA and dump that 512-byte sector as hex + ASCII. |

---

### 3. Implementation & Architecture

- **Driver:** [\`src/utils/massStorageDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/massStorageDriver.js) — \`buildCbw\`/\`parseCsw\`, \`parseInquiry\`/\`parseCapacity\`, and \`MassStorageDevice\` with \`testUnitReady\`/\`inquiry\`/\`readCapacity\`/\`read\`. No write path exists. \`createSimulatedMassStorage()\` backs the demo.
- **Workbench:** [\`src/components/tools/MassStorageWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/MassStorageWorkbench.jsx) — identity, capacity and a hex sector viewer, behind a claim-the-drive confirmation.
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
    summary: 'Connect a camera or phone in PTP mode and browse its files: device info, storages, object handles with filenames, formats, dimensions and dates, and one-click download of any object.',
    tags: ['PTP', 'MTP', 'Camera', 'Photos', 'WebUSB', 'Still Image', 'PIMA 15740', 'Object Info'],
    readTime: '12 min read',
    content: `
# PTP / MTP Camera

The **PTP** workbench pulls photos and their metadata off a camera or phone using the **Picture Transfer Protocol** — the standard "camera" USB mode (MTP is PTP with vendor extensions). Put the device in PTP mode (on a phone, choose **Transfer photos / PTP** from the USB notification) and you can list every file, read its info, and download it. Browsing is read-only.

---

### 1. The protocol

PTP is a transaction protocol over bulk endpoints. Everything is a **container** with a 12-byte header (length, type, operation/response code, transaction id):

- **Command** containers carry an operation and up to five 32-bit parameters.
- **Data** containers carry a dataset (device info, an object's info, or an object's bytes).
- **Response** containers end the transaction (\`0x2001\` = OK).

A read like \`GetObjectInfo\` is: send the Command (with the object handle), read the Data container (the ObjectInfo dataset), read the Response. Datasets use PTP's own encoding — little-endian integers, length-prefixed UTF-16 strings, and count-prefixed arrays.

Key operations: \`OpenSession\`, \`GetDeviceInfo\`, \`GetStorageIDs\`, \`GetObjectHandles\`, \`GetObjectInfo\`, \`GetObject\`, \`GetThumb\`, \`CloseSession\`.

---

### 2. UI control mapping

| UI Element | Purpose |
| :--- | :--- |
| **Connect Camera (WebUSB)** | Opens the device, opens a session, reads device info, and lists files. |
| **Demo** | A simulated camera with two JPEGs (labeled as simulated). |
| **Device panel** | Manufacturer, model, firmware, serial. |
| **Files table** | Filename, format, size, pixel dimensions, capture date, and a **get** button to download. |
| **Refresh** | Re-list the files (after taking a new photo, say). |

---

### 3. Implementation & Architecture

- **Driver:** [\`src/utils/ptpDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/ptpDriver.js) — \`buildContainer\`/\`parseContainerHeader\`, a \`DataReader\` for PTP strings/arrays, \`parseDeviceInfo\`/\`parseObjectInfo\`, and \`PtpDevice\` whose \`transaction()\` runs the command/data/response phases (reassembling large data across USB transfers). \`createSimulatedPtp()\` backs the demo.
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
| **Read Security Key (WebHID)** | INIT + authenticatorGetInfo; shows versions, AAGUID, options and limits. |
| **Demo** | A simulated FIDO 2.1 key (labeled as simulated). |
| **PING** | A CTAPHID_PING round-trip that checks the echoed bytes match. |

---

### 4. Implementation & Architecture

- **Driver:** [\`src/utils/fido2Driver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/fido2Driver.js) — a small CBOR decoder (\`decodeCbor\`), \`buildPackets\` for CTAP-HID framing, \`parseGetInfo\`/\`aaguidToString\`, and \`Fido2Device\` with \`init\`/\`getInfo\`/\`ping\`. \`createSimulatedFido2()\` backs the demo. No credential or reset operations exist.
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
  }
];
