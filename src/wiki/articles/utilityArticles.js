/**
 * Device Utilities Wiki Articles
 * Covering MicroPython Files, Improv Wi-Fi, Telemetry Gauges, Crash Alerts, Test Runner, USB Autopsy, and Silicon Dump
 */

export const UTILITY_ARTICLES = [
  {
    id: 'micropython',
    toolId: 'micropython',
    category: 'utilities',
    title: 'MicroPython Filesystem Explorer — Raw REPL & On-Chip Files',
    summary: 'Browse on-chip flash storage, upload boot.py and main.py, download logs, and execute Python code via MicroPython Raw REPL mode.',
    tags: ['MicroPython', 'CircuitPython', 'Raw REPL', 'Filesystem', 'boot.py', 'main.py'],
    readTime: '6 min read',
    content: `
# MicroPython Filesystem Explorer — On-Chip Storage

The **MicroPython Filesystem Explorer** interacts directly with microcontrollers running MicroPython or CircuitPython (ESP32, RP2040, STM32) without requiring native desktop utilities like Thonny or ampy.

---

### How the Raw REPL Protocol Works

Standard interactive Python shells (friendly REPL) echo back every keystroke, render prompts (\`>>>\`), and auto-indent lines, making programmatic file transfers difficult.

To overcome this, the tool switches the device into **Raw REPL Mode**:
1. Sends **Ctrl+A** (\`0x01\`): The microcontroller halts any running code, disables character echoing, and prints \`raw REPL; CTRL-B to exit\\r\\n>\`.
2. Sends small Python introspection payloads:
   \`\`\`python
   import os
   print(os.listdir())
   \`\`\`
3. Executes and verifies output terminated by **Ctrl+D** (\`0x04\`).
4. Sends **Ctrl+B** (\`0x02\`) upon disconnection to restore standard friendly REPL.

---

### Key Workbench Actions

#### 1. File & Directory Browsing
- Live tree view of files and subdirectories stored in on-chip flash memory (FAT or LittleFS).
- Displays file sizes and timestamps.

#### 2. File Upload & Download
- **Download**: Click any file (\`boot.py\`, \`main.py\`, or sensor logs) to download it directly to your PC.
- **Upload**: Drag and drop \`.py\` scripts or asset files from your computer to flash storage. The tool streams the file in chunks using chunked \`f.write()\` operations with SHA-256 validation.

#### 3. In-Browser Script Editor
- Click any Python script to open it in the built-in syntax-highlighted code editor.
- Make edits and click **Save to Board** to overwrite and perform an immediate soft reset (**Ctrl+D**).
`
  },
  {
    id: 'improv',
    toolId: 'improv',
    category: 'utilities',
    title: 'Improv Wi-Fi — Standardized Serial IoT Wi-Fi Provisioner',
    summary: 'Provision Wi-Fi credentials to ESPHome, Home Assistant, and Tasmota devices over serial without mobile apps or captive portals.',
    tags: ['Improv Wi-Fi', 'Home Assistant', 'ESPHome', 'IoT', 'Provisioning', 'Wi-Fi Credentials'],
    readTime: '5 min read',
    content: `
# Improv Wi-Fi — Serial Provisioner

**Improv Wi-Fi** is an open standard established by the Home Assistant, ESPHome, and Nabu Casa communities to allow frictionless, secure Wi-Fi credential provisioning to IoT devices over serial or BLE.

---

### The Improv Serial Framing Standard

An Improv serial packet follows this exact binary structure:
\`\`\`
[Header "IMPROV"] [Version 0x01] [Packet Type 1B] [Data Length 1B] [Payload NB] [Checksum 1B]
\`\`\`
The checksum is the 8-bit sum of all preceding bytes modulo 256.

---

### Packet Types & Workflow

1. **Current State Request / Response (\`0x01\`)**:
   - \`0x00\`: Stopped.
   - \`0x01\`: Awaiting Authorization.
   - \`0x02\`: Authorized.
   - \`0x03\`: Provisioning in progress.
   - \`0x04\`: Successfully Provisioned.
2. **Error State (\`0x02\`)**: Notifies the browser if credentials failed, SSID wasn't found, or DHCP timed out.
3. **RPC Commands (\`0x03\`)**:
   - **Command 0x01 (Send Wi-Fi Settings)**: Sends SSID and Password payloads.
   - **Command 0x02 (Identify)**: Blinks the device's physical onboard LED to confirm physical identity.
   - **Command 0x03 (Scan Networks)**: Instructs device to perform a Wi-Fi scan and stream back available SSIDs and RSSI levels.

---

### How to Use the Provisioner

1. Connect your ESPHome, Tasmota, or custom IoT device over WebSerial.
2. The tool automatically handshakes and displays the device's firmware name and version.
3. Select your local Wi-Fi network from the auto-scanned list, enter your password, and click **Connect**.
4. The device connects to your router, acquires an IP address, and returns its local IP address and HTTP redirect link.
`
  },
  {
    id: 'telemetry',
    toolId: 'telemetry',
    category: 'utilities',
    title: 'Telemetry Gauges — Analog Speedometer & Metric Dials',
    summary: 'Extract numerical sensor values from raw serial streams and display them on responsive analog gauge dials and digital meters.',
    tags: ['Telemetry', 'Gauges', 'Analog Meter', 'Speedometer', 'Sensors', 'Metrics'],
    readTime: '5 min read',
    content: `
# Telemetry Gauges — Responsive Metric Dials

The **Telemetry Dashboard** converts noisy text streams into beautiful, high-contrast analog dials, digital speedometers, and warning meters. It is ideal for monitoring robotics, automotive CAN bus telemetries, and environmental sensor pods.

---

### How Regex Extraction Works

The telemetry engine allows you to map incoming serial lines to dials using standard Named Capture Groups in Regular Expressions:

\`\`\`regex
temp:(?<temperature>\\d+\\.\\d+)\\s+rpm:(?<rpm>\\d+)
\`\`\`

When a matching line arrives:
1. The engine extracts the captured values.
2. Computes gauge needle deflection angle:
   \`\`\`text
   Angle = MinAngle + ((Value - Min) / (Max - Min)) * (MaxAngle - MinAngle)
   \`\`\`
3. Updates the SVG needle and digital readout smoothly at 60 FPS using requestAnimationFrame.

---

### Configurable Dial Properties
- **Range & Limits**: Set Minimum and Maximum values (e.g. \`0\` to \`8000\` RPM).
- **Warning & Danger Zones**: Define colored arc bands (Yellow for warning, Red for redline/danger).
- **Peak Hold**: Leaves a subtle glowing marker at the highest measured value during the session.
- **Units Label**: Customizable text indicator (e.g. \`°C\`, \`km/h\`, \`V\`, \`mA\`, \`PSI\`).
`
  },
  {
    id: 'alerts',
    toolId: 'alerts',
    category: 'utilities',
    title: 'Crash & Panic Alerts Deck — Kernel Exceptions & Guru Meditation',
    summary: 'Real-time serial scanner detecting ESP-IDF Guru Meditation Errors, Watchdog timer resets, stack overflows, and register dumps.',
    tags: ['Crash Alerts', 'Panic', 'Guru Meditation', 'Watchdog', 'ESP-IDF', 'Stack Overflow'],
    readTime: '6 min read',
    content: `
# Crash & Panic Alerts Deck — Exception Analyzer

The **Crash & Panic Alerts Deck** acts as a sentinel on your serial connection, continuously scanning incoming text buffers for firmware panics, unhandled exceptions, and hardware watchdog resets.

---

### Common Exception Signatures Detected

#### 1. ESP-IDF Guru Meditation Error
Occurs when the Xtensa or RISC-V CPU triggers an unhandled architectural exception:
- **LoadProhibited / StoreProhibited**: Attempting to read or write to an invalid memory address (e.g. dereferencing a \`NULL\` pointer \`0x00000000\`).
- **InstrFetchProhibited**: Jumping execution to an unmapped memory region.
- **IllegalInstruction**: CPU encountered an invalid opcode (often caused by corrupted flash memory or mismatched compiler architecture flags).

#### 2. Watchdog Timer Resets (TWDT / RWDT)
- **Task Watchdog Reset**: Occurs when a high-priority FreeRTOS task runs continuously without yielding execution (\`vTaskDelay\` or waiting on a queue), starving the idle task.
- **Interrupt Watchdog Reset**: Occurs when an Interrupt Service Routine (ISR) takes too long to execute.

#### 3. Brownout Detector Reset
Triggered when the ESP32's internal supply voltage dips below the brownout threshold (~2.43V). Almost always caused by:
- Weak USB power from unpowered hubs.
- High current surges during Wi-Fi / Bluetooth transmission without adequate decoupling capacitors.

---

### Automated Diagnostic Decoding
When a crash occurs:
- The alert panel flashes an emergency warning banner and sounds an optional audio alert.
- **Registers Extracted**: Automatically extracts **PC** (Program Counter), **PS** (Processor Status), **A0-A15** (Return address and general registers), and **EXCVADDR** (Faulty memory address).
- **CLI Decode Command**: Generates the exact \`xtensa-esp32-elf-addr2line\` command needed to translate the raw hexadecimal PC address into the exact source code file and line number in your project!
`
  },
  {
    id: 'automation',
    toolId: 'automation',
    category: 'utilities',
    title: 'Automated Test Runner & Scripts — Bench Testing Engine',
    summary: 'Write sandboxed JavaScript automation routines, send timed serial sequences, assert responses, and automate quality control.',
    tags: ['Automation', 'Test Runner', 'Scripting', 'JavaScript', 'Regression Testing', 'Bench Test'],
    readTime: '6 min read',
    content: `
# Automated Test Runner & Scripts — Bench Testing

The **Test Runner & Automation Deck** provides a sandboxed execution environment for automating repetitive serial tasks, hardware production testing, firmware regression suites, and burn-in tests.

---

### The Scripting API

Automation scripts are written in standard JavaScript using asynchronous helper primitives exposed by the runner:

\`\`\`javascript
// Sample Automated AT Modem Diagnostic Test
async function runTest(session) {
  session.log("Checking AT command response...");
  await session.send("AT\r\n");
  
  const response = await session.expect("OK", 1000);
  if (!response.matched) {
    throw new Error("Modem failed to respond with OK!");
  }
  
  session.log("Querying firmware version...");
  await session.send("AT+GMR\r\n");
  await session.delay(500);
  
  session.pass("Device passed all initialization checks!");
}
\`\`\`

#### Available API Primitives
| Function | Description |
| :--- | :--- |
| \`session.send(text)\` | Transmits a string over the active serial port |
| \`session.sendBytes([0xAA, ...])\` | Transmits raw binary byte arrays |
| \`session.expect(pattern, timeoutMs)\` | Waits for a string or regex in the serial stream |
| \`session.delay(ms)\` | Pauses script execution for specified milliseconds |
| \`session.log(message)\` | Prints informational message to the test console |
| \`session.assert(condition, message)\` | Evaluates a truthy assertion |
| \`session.pass(message)\` / \`fail(msg)\` | Marks test verdict and advances queue |

---

### Use Cases & Test Report Export
- **Factory Production Testing**: Verify that newly soldered boards communicate, report correct silicon MAC addresses, and pass loopback checks.
- **Stress & Burn-in Testing**: Send thousands of commands over 24 hours and log failure rates.
- **Exporting Results**: Click **Export Report** to generate clean JSON / CSV test audit logs.
`
  },
  {
    id: 'autopsy',
    toolId: 'autopsy',
    category: 'utilities',
    title: 'USB Recon & Device Autopsy — Descriptor Analysis & Clones',
    summary: 'Inspect USB Device, Configuration, Interface, and Endpoint descriptors, identify counterfeit bridge chips, and analyze USB capabilities.',
    tags: ['USB Recon', 'Autopsy', 'Descriptors', 'WebUSB', 'VID/PID', 'Counterfeit Chips'],
    readTime: '6 min read',
    content: `
# USB Recon & Device Autopsy — Descriptor Analysis

The **USB Recon & Autopsy** workbench performs deep interrogation of USB hardware descriptors using the browser's WebUSB and WebSerial capabilities to reveal silicon identity, endpoint architectures, and clone ICs.

---

### Anatomy of USB Descriptors

Every USB device presents a hierarchical tree of descriptors upon enumeration:
1. **Device Descriptor**:
   - \`idVendor\` (VID) & \`idProduct\` (PID): Registered manufacturer and device identifiers.
   - \`bcdUSB\`: USB specification compliance (e.g. 0x0200 for USB 2.0).
   - \`bDeviceClass\`: Standard class (e.g. 0x02 for Communication Device Class, 0x00 for composite interfaces).
   - String descriptors: Manufacturer Name, Product String, and Hardware Serial Number.
2. **Configuration Descriptor**: Power requirements (Bus-powered vs Self-powered) and \`bMaxPower\` (current consumption in 2mA units).
3. **Interface Descriptors**: Logical function groups (e.g. CDC Control vs CDC Data).
4. **Endpoint Descriptors**:
   - Direction: IN (Device to Host) vs OUT (Host to Device).
   - Transfer Type: Control, Bulk, Interrupt, or Isochronous.
   - \`wMaxPacketSize\`: Maximum packet payload (e.g. 64 bytes for Full-Speed bulk).

---

### Counterfeit & Clone IC Forensics
The workbench includes heuristic detection for counterfeit USB-UART bridge ICs:
- **FTDI FT232RL Clones**: Identifies cloned FTDI chips by checking response to non-standard EEPROM read requests and timing jitter on CTS/RTS handshakes.
- **CH340 Variations**: Differentiates between authentic WCH CH340G (requires external crystal), CH340C (built-in clock), CH340N (8-pin compact), and non-genuine third-party clones.
- **Prolific PL2303**: Detects legacy discontinued revision chips that fail on modern Windows 11 drivers.
`
  },
  {
    id: 'esp-dump',
    toolId: 'esp-dump',
    category: 'utilities',
    title: 'Silicon Memory Dump — Hardware eFuses & Flash Geometry',
    summary: 'Read hardware eFuses, chip security states, MAC addresses, silicon revisions, and SPI flash geometries without flashing firmware.',
    tags: ['Silicon Dump', 'eFuses', 'Flash Geometry', 'Security State', 'ROM Bootloader', 'MAC Address'],
    readTime: '6 min read',
    content: `
# Silicon Memory Dump — eFuse & Flash Geometry

The **Silicon Memory Dump** workbench leverages low-level ESP-IDF ROM bootloader register commands (\`READ_REG\` 0x0A) to inspect hardware eFuses and physical flash chip attributes without modifying or overwriting on-chip flash memory.

---

### What are eFuses?

eFuses are microscopic, one-time programmable (OTP) physical electronic fuses inside the silicon die. Once burned (blown from 0 to 1), an eFuse can **never** be reset or restored. They store permanent hardware characteristics and cryptographic security configurations.

---

### Data Extracted by the Memory Inspector

#### 1. Chip Identification & Silicon Errata
- **Exact Silicon Revision**: (e.g. ESP32 v3.0 ECO with fixed TWAI CAN bugs vs v1.0 silicon).
- **Factory MAC Address**: Burned directly in BLOCK0 by Espressif.
- **Feature Flags**: Embedded PSRAM detection, integrated flash size, dual-core vs single-core verification.

#### 2. Cryptographic Security Auditing
- **Flash Encryption Status**: Indicates whether hardware AES-256 flash encryption is enabled and whether the encryption key is permanently locked from read access.
- **Secure Boot State**: Checks whether Secure Boot v1 or Secure Boot v2 RSA-3072 signature verification is enforced.
- **JTAG Debug Disable**: Checks whether physical silicon hardware debugging via JTAG pins is permanently burned disabled.
- **Download Mode Disable**: Confirms whether the ROM download bootloader is permanently locked for production security.

#### 3. Flash Chip Hardware Geometry
By sending the standard SPI command \`0x9F\` (Read JEDEC ID) directly through the ROM:
- **Manufacturer ID**: (e.g. \`0xEF\` for Winbond, \`0xC8\` for GigaDevice, \`0xC2\` for Macronix).
- **Memory Type & Capacity**: (e.g. \`0x4016\` = 4MB, \`0x4017\` = 8MB, \`0x4018\` = 16MB).
`
  }
];
