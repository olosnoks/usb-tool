/**
 * Device Utilities Wiki Articles — Comprehensive Technical Manual
 * Covering MicroPython Files, Improv Wi-Fi, Telemetry Gauges, Crash Alerts, Test Runner, USB Autopsy, and Silicon Dump
 */

export const UTILITY_ARTICLES = [
  {
    id: 'micropython',
    toolId: 'micropython',
    category: 'utilities',
    title: 'MicroPython Filesystem Explorer — Raw REPL & On-Chip Files',
    summary: 'Browse on-chip flash storage, upload boot.py and main.py, download logs, and execute Python code via MicroPython Raw REPL mode without desktop apps.',
    tags: ['MicroPython', 'CircuitPython', 'Raw REPL', 'Filesystem', 'boot.py', 'main.py', 'Python', 'Thonny'],
    readTime: '16 min read',
    content: `
# MicroPython Filesystem Explorer — On-Chip Storage

The **MicroPython Filesystem Explorer** interacts directly with microcontrollers running MicroPython or CircuitPython (ESP32, RP2040, STM32) without requiring native desktop utilities like Thonny, Mu, or ampy.

---

### 1. What Is MicroPython & The Raw REPL Protocol?

MicroPython is a lean, efficient implementation of Python 3 optimized to run on bare-metal microcontrollers. While the interactive terminal prompt (\`>>>\`) is great for humans typing commands, transferring files over it is error-prone because the shell echoes back every character and auto-indents new lines.

To solve this, MicroPython features **Raw REPL Mode**:

<details>
<summary>MicroPython Raw REPL Protocol & Control Byte Handshake</summary>

The browser communicates with the microcontroller using standard ASCII control characters:

1. **Ctrl+C (\`0x03\`)**: Transmitted twice to interrupt any currently running user scripts or infinite loops.
2. **Ctrl+A (\`0x01\`)**: Enters Raw REPL mode. The microcontroller responds with:
   \`\`\`text
   raw REPL; CTRL-B to exit\r\n>
   \`\`\`
   In this mode, character echoing is disabled and newline auto-indentation is bypassed.
3. **Command Payload**: Transmitted in 256-byte chunks.
4. **Ctrl+D (\`0x04\`)**: Executes the uploaded Python snippet. The board responds with:
   \`\`\`text
   OK<stdout_bytes>\x04<stderr_bytes>\x04>
   \`\`\`
   - If \`stderr_bytes\` is non-empty, a Python exception occurred.
5. **Ctrl+B (\`0x02\`)**: Exits raw mode and performs a soft reboot, returning to the normal interactive \`>>>\` REPL.

</details>

<details>
<summary>Chunked File Transfer & SHA-256 Checksum Validation Script</summary>

When uploading files, Skon's USB Tool injects an ephemeral memory-efficient stream writer directly through the Raw REPL:

\`\`\`python
import ubinascii, uhashlib
def __write_chunk(filename, offset, b64_chunk):
    mode = 'wb' if offset == 0 else 'ab'
    with open(filename, mode) as f:
        f.seek(offset)
        f.write(ubinascii.a2b_base64(b64_chunk))

def __verify_sha256(filename, expected_sha):
    h = uhashlib.sha256()
    with open(filename, 'rb') as f:
        while True:
            chunk = f.read(512)
            if not chunk: break
            h.update(chunk)
    digest = ubinascii.hexlify(h.digest()).decode()
    return digest == expected_sha
\`\`\`
This atomic chunking mechanism allows files up to tens of megabytes to be written reliably without causing MicroPython out-of-memory (\`MemoryError\`) crashes.

</details>

---

### 2. Key Workbench Capabilities

- **Live Flash Tree Explorer**: Lists all files and folders in FAT or LittleFS partitions with byte sizes and directory depth.
- **File Upload & Download**: Drag and drop scripts directly to the board; click any file to download to your PC.
- **In-Browser Code Editor**: Edit \`boot.py\` and \`main.py\` with syntax highlighting and click **Save & Soft Reboot**.
- **Memory Heap Monitor**: Periodically queries \`gc.mem_free()\` and \`gc.mem_alloc()\` to track RAM usage.

---

### 3. Upstream Project & Engineering Attribution

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
    readTime: '14 min read',
    content: `
# Improv Wi-Fi — Serial Provisioner

**Improv Wi-Fi** is an open standard established by the Home Assistant, ESPHome, and Nabu Casa communities to allow frictionless, secure Wi-Fi credential provisioning to IoT devices over serial or BLE.

---

### 1. Why Improv Wi-Fi Matters

Traditionally, setting up Wi-Fi on a new IoT device required connecting your phone to an unsecured temporary Wi-Fi access point, waiting for a captive portal, and submitting passwords over unencrypted HTTP.

**Improv Wi-Fi over Serial** eliminates this entirely. By plugging the device into USB, the browser handshakes with the board, discovers available home Wi-Fi networks, and securely provisions credentials over physical wires in under 5 seconds!

---

### 2. The Improv Serial Packet Framing Standard

<details>
<summary>Improv Wi-Fi Serial Framing & Error Codes Specification</summary>

An Improv packet conforms to this binary format:
\`\`\`
+------------------+--------------+------------------+------------------+------------------+--------------+
| Header "IMPROV"  | Version 0x01 | Packet Type (1B) | Data Length (1B) | Data Bytes (N B) | Checksum (1B)|
+------------------+--------------+------------------+------------------+------------------+--------------+
\`\`\`

#### Checksum Equation
The 8-bit checksum is calculated as:
$$\text{Checksum} = \left(\sum \text{all preceding bytes from 'I' to last data byte}\right) \pmod{256}$$

#### Master Packet Types & State Enum
| Packet Type | Name | Direction | Description |
| :--- | :--- | :--- | :--- |
| **\`0x01\`** | Current State | Device -> Host | \`0x01\`=Stopped, \`0x02\`=Awaiting Auth, \`0x03\`=Authorized, \`0x04\`=Provisioning, \`0x05\`=Provisioned. |
| **\`0x02\`** | Error State | Device -> Host | \`0x01\`=Invalid RPC, \`0x02\`=Unknown Cmd, \`0x03\`=Unable to Connect, \`0x04\`=Not Authorized. |
| **\`0x03\`** | Command | Host -> Device | \`0x01\`=Send Wi-Fi, \`0x02\`=Identify (Blink LED), \`0x03\`=Scan Wi-Fi. |
| **\`0x04\`** | Command Result | Device -> Host | Returns array of strings (e.g. Device Name, Firmware Version, Local IP address). |

</details>

---

### 3. Step-by-Step Usage Guide

1. Plug your ESPHome or Tasmota smart home sensor into USB.
2. Open the **Improv Wi-Fi** workbench.
3. The tool automatically handshakes and displays the device's firmware name and version.
4. Select your home Wi-Fi SSID from the dropdown list and type your password.
5. Click **Save & Connect**.
6. The device connects to your Wi-Fi router, obtains an IP address via DHCP, and returns its local IP address and HTTP redirect link!

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
    readTime: '13 min read',
    content: `
# Telemetry Gauges — Responsive Metric Dials

The **Telemetry Dashboard** converts noisy text streams into beautiful, high-contrast analog dials, digital speedometers, and warning meters. It is ideal for monitoring robotics, automotive CAN bus telemetries, and environmental sensor pods.

---

### 1. How Regex Extraction Works

The telemetry engine allows you to map incoming serial lines to dials using standard Named Capture Groups in Regular Expressions:

\`\`\`regex
temp:(?<temperature>\\d+\\.\\d+)\\s+rpm:(?<rpm>\\d+)
\`\`\`

<details>
<summary>Mathematical Needle Deflection & Rolling Min/Max Equations</summary>

When a matching value arrives, the dial needle deflection angle is calculated across a $240^\circ$ sweep:

$$\theta = \theta_{\min} + \left(\frac{V - V_{\min}}{V_{\max} - V_{\min}}\right) \times (\theta_{\max} - \theta_{\min})$$

Where:
- $\theta_{\min} = -120^\circ$, $\theta_{\max} = +120^\circ$.
- $V$: Current extracted sensor reading.
- $V_{\min}, V_{\max}$: Configured dial range bounds.

#### Peak-Hold Memory
The dial retains the highest recorded value ($V_{\text{peak}} = \max(V_{\text{peak}}, V)$) indicated by a luminous neon tick mark on the outer bezel, resetting only when manually cleared.

</details>

---

### 2. Configurable Dial Properties
- **Range & Limits**: Set Minimum and Maximum values (e.g. \`0\` to \`8000\` RPM).
- **Warning & Danger Zones**: Define colored arc bands (Yellow for warning, Red for redline/danger).
- **Units Label**: Customizable text indicator (e.g. \`°C\`, \`km/h\`, \`V\`, \`mA\`, \`PSI\`).

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
    readTime: '15 min read',
    content: `
# Crash & Panic Alerts Deck — Exception Analyzer

The **Crash & Panic Alerts Deck** acts as a sentinel on your serial connection, continuously scanning incoming text buffers for firmware panics, unhandled exceptions, and hardware watchdog resets.

---

### 1. Common Exception Signatures Detected

- **LoadProhibited / StoreProhibited**: Attempting to read or write to an invalid memory address (e.g. dereferencing a \`NULL\` pointer \`0x00000000\`).
- **InstrFetchProhibited**: Jumping execution to an unmapped memory region.
- **IllegalInstruction**: CPU encountered an invalid opcode (often caused by corrupted flash memory or mismatched compiler architecture flags).
- **Task Watchdog Reset (TWDT)**: High-priority FreeRTOS task starved the idle task.
- **Brownout Detector Reset**: Internal 3.3V supply dipped below 2.43V during Wi-Fi transmission.

<details>
<summary>ESP-IDF Guru Meditation Register Dump Reference & addr2line Syntax</summary>

When an ESP32 panics, the ROM bootloader outputs a register frame:

| Register | Architectural Meaning | Diagnostic Clue |
| :--- | :--- | :--- |
| **PC** | Program Counter | Exact memory address of the machine code instruction that crashed. |
| **PS** | Processor Status | CPU privilege level, interrupt mask, and ALU condition codes. |
| **A0** | Return Address | Address that called the crashing function (one level back in call stack). |
| **A1 (SP)** | Stack Pointer | Top of active FreeRTOS task stack. If close to stack limit, task experienced a stack overflow! |
| **EXCVADDR** | Exception Virtual Address | The illegal memory pointer that the CPU tried to read or write (e.g. \`0x00000004\` indicates struct member access on NULL). |

#### Translating PC Address to Source Line with addr2line
The workbench generates the exact command to find the bug in your source code:
\`\`\`bash
# For ESP32 Classic (Xtensa):
xtensa-esp32-elf-addr2line -pfia -e build/my_project.elf 0x400d1a44

# For ESP32-C3 / C6 (RISC-V):
riscv32-esp-elf-addr2line -pfia -e build/my_project.elf 0x420042a8
\`\`\`
Output prints the exact C/C++ file name and line number:
\`\`\`text
0x400d1a44: sensor_read at /home/user/esp/main/sensor.c:142
\`\`\`

</details>

---

### 2. Automated Diagnostic Actions
When a panic arrives:
- The alert panel flashes an emergency warning banner and sounds an optional audio chime.
- Extracts registers and provides root cause diagnosis.
- Copies the \`addr2line\` command to clipboard in 1 click.

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
    readTime: '15 min read',
    content: `
# Automated Test Runner & Scripts — Bench Testing

The **Test Runner & Automation Deck** provides a sandboxed execution environment for automating repetitive serial tasks, hardware production testing, firmware regression suites, and burn-in tests.

---

### 1. The Scripting API

Automation scripts are written in standard JavaScript using asynchronous helper primitives:

<details>
<summary>Full Test Runner API Specification & Automated Regression Recipes</summary>

| API Function | Parameters | Description |
| :--- | :--- | :--- |
| \`session.send(text)\` | \`text: string\` | Transmits text string followed by configured line endings. |
| \`session.sendBytes(arr)\` | \`arr: number[]\` | Transmits raw binary bytes (e.g. \`[0xAA, 0x55, 0x01]\`). |
| \`session.expect(pat, timeoutMs)\` | \`pat: string \| RegExp\` | Awaits matching pattern in incoming buffer. Returns \`{matched: bool, text: string}\`. |
| \`session.delay(ms)\` | \`ms: number\` | Non-blocking execution delay. |
| \`session.log(msg)\` | \`msg: string\` | Appends info message to the test runner audit log. |
| \`session.assert(cond, msg)\` | \`cond: bool, msg: string\` | Throws test failure if condition is false. |
| \`session.pass(msg)\` | \`msg: string\` | Explicitly marks test step passed. |
| \`session.fail(msg)\` | \`msg: string\` | Explicitly aborts test queue with failure verdict. |

#### Complete Factory Quality Control Recipe
\`\`\`javascript
async function runFactoryQA(session) {
  session.log("Checking AT bootloader response...");
  await session.send("AT\r\n");
  const res = await session.expect("OK", 1000);
  session.assert(res.matched, "Target failed to respond to AT command within 1s");
  
  session.log("Querying MAC address...");
  await session.send("AT+CIPSTAMAC?\r\n");
  const macRes = await session.expect(/\+CIPSTAMAC:"([0-9a-f:]+)"/i, 1500);
  session.assert(macRes.matched, "MAC address query failed");
  
  session.log("Target MAC: " + macRes.text);
  session.pass("Board passed electrical and serial smoke checks!");
}
\`\`\`

</details>

---

### 2. Exporting Audit Reports
Click **Export Report** to generate clean JSON / CSV test audit logs with pass/fail timestamps and complete serial interaction transcripts.

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
    readTime: '15 min read',
    content: `
# USB Recon & Device Autopsy — Descriptor Analysis

The **USB Recon & Autopsy** workbench performs deep interrogation of USB hardware descriptors using the browser's WebUSB and WebSerial capabilities to reveal silicon identity, endpoint architectures, and clone ICs.

---

### 1. Anatomy of USB Descriptors

Every USB peripheral presents a hierarchical tree of descriptors during USB enumeration:

<details>
<summary>USB Device Descriptor Hierarchy & WCH / FTDI Clone Detection Rules</summary>

#### USB Descriptor Hierarchy (USB 2.0 / 3.0 Chapter 9)
1. **Device Descriptor (18 Bytes)**:
   - \`bLength\`: \`0x12\` (18 bytes).
   - \`bDescriptorType\`: \`0x01\` (DEVICE).
   - \`bcdUSB\`: USB specification compliance (e.g. \`0x0200\` for USB 2.0).
   - \`bDeviceClass\`: \`0x02\` (CDC), \`0x00\` (Composite / Interface-specific).
   - \`idVendor\` (VID) & \`idProduct\` (PID): 16-bit identifiers.
   - \`iManufacturer\`, \`iProduct\`, \`iSerialNumber\`: String descriptor index pointers.
2. **Configuration Descriptor (9 Bytes)**:
   - \`wTotalLength\`: Cumulative size of config, interfaces, and endpoints.
   - \`bmAttributes\`: Bus-powered vs Self-powered, Remote Wakeup support.
   - \`bMaxPower\`: Maximum current draw expressed in 2mA units (e.g. \`50\` = 100mA, \`250\` = 500mA).
3. **Interface Descriptor (9 Bytes)**:
   - \`bInterfaceClass\`: \`0x03\` (HID), \`0x0A\` (CDC Data), \`0xFF\` (Vendor Specific).
4. **Endpoint Descriptor (7 Bytes)**:
   - \`bEndpointAddress\`: Bit 7 indicates direction (\`0\` = OUT / Host-to-Device, \`1\` = IN / Device-to-Host). Bits 0-3 specify endpoint number (1 to 15).
   - \`bmAttributes\`: \`00\`=Control, \`01\`=Isochronous, \`10\`=Bulk, \`11\`=Interrupt.
   - \`wMaxPacketSize\`: Maximum transfer payload (typically 64 bytes for Full-Speed bulk).

#### Counterfeit Silicon Detection Heuristics
- **FTDI FT232R Clones**: Non-genuine chips often implement static serial numbers (e.g. \`A50285BI\`) or corrupt internal EEPROM registers upon receiving non-standard FTDI latency timer requests.
- **CH340 Variations**: Differentiates between authentic WCH CH340G (requires external 12MHz crystal oscillator), CH340C (integrated internal clock), and unbranded Chinese clones that drop packets at bauds above 115,200.

</details>

---

### 2. Step-by-Step Reconnaissance

1. Connect any mystery device via USB and click **Interrogate USB Device**.
2. Select the target device in the browser's native WebUSB prompt.
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
    readTime: '15 min read',
    content: `
# Silicon Memory Dump — eFuse & Flash Geometry

The **Silicon Memory Dump** workbench leverages low-level ESP-IDF ROM bootloader register commands (\`READ_REG\` 0x0A) to inspect hardware eFuses and physical flash chip attributes without modifying or overwriting on-chip flash memory.

---

### 1. What Are eFuses?

eFuses are microscopic, one-time programmable (OTP) physical electronic fuses inside the silicon die. Once burned (blown from 0 to 1), an eFuse can **never** be reset or restored. They store permanent hardware characteristics and cryptographic security configurations.

<details>
<summary>ESP32 eFuse Memory Map (BLOCK0 to BLOCK3) & Silicon Errata</summary>

The ESP32 family divides its eFuse controller into 4 physical blocks:

| Block | Name | Bit Length | Function & Security Significance |
| :--- | :--- | :--- | :--- |
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
  }
];
