/**
 * Hardware Programmers & Power Delivery Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering CH341A, CMSIS-DAP, JTAG, AVR ISP, and USB-PD Power Delivery
 * Sourced directly from upstream project specifications (flashrom, ARM ADIv5, IEEE 1149.1, AVR910, USB-IF PD 3.0) and driver implementations.
 */

export const HARDWARE_ARTICLES = [
  {
    id: 'programmers',
    toolId: 'programmers',
    category: 'programmers',
    title: 'Hardware Programmers Suite — CH341A, CMSIS-DAP, JTAG & AVR ISP',
    summary: 'Master motherboard BIOS unbricking, Winbond 25Qxx SPI flash memory reading, ARM Cortex-M SWD debugging, FPGA JTAG boundary scan, and AVR ISP programming.',
    tags: ['CH341A', 'BIOS', 'SPI Flash', 'CMSIS-DAP', 'SWD', 'JTAG', 'AVR ISP', 'EEPROM', 'Winbond', 'Unbrick', 'flashrom'],
    readTime: '22 min read',
    content: `
# Hardware Programmers Suite — Low-Level Memory & Silicon

The **Hardware Programmers Suite** aggregates four essential low-level microcontroller and non-volatile memory programming interfaces into a single unified browser workbench:
1. **CH341A Programmer**: SPI Flash & I2C EEPROM burning (based on the upstream \`flashrom\` and \`ch341aDriver.js\` specifications).
2. **CMSIS-DAP / DAPLink**: ARM Cortex-M SWD debugging and flashing (based on ARM Debug Interface v5 and \`cmsisDapDriver.js\`).
3. **JTAG SVF Player**: FPGA / CPLD configuration (based on IEEE 1149.1 and \`jtagDriver.js\`).
4. **AVR ISP**: Atmel / Microchip ATmega fuse and flash programming (based on AVR910 / STK500 and \`avrIspDriver.js\`).

---

### 1. CH341A SPI Flash & I2C EEPROM Programmer

The WCH CH341A USB interface chip is the global standard for unbricking motherboard BIOS chips, router flash memory, and I2C automotive memory ICs.

#### Supported Flash Families:
- **25-Series SPI Flash (SOIC-8 / DIP-8)**: Winbond (W25Q32, W25Q64, W25Q128), Macronix (MX25L), GigaDevice (GD25Q), Spansion.
- **24-Series I2C EEPROM**: 24C02 through 24C512.

> **CRITICAL 3.3V HARDWARE MODIFICATION WARNING**:
> Many cheap "black" CH341A programmer boards sold online contain a severe design flaw: while the VCC pin is set to 3.3V, the data signal lines (MOSI, MISO, SCK, CS) are tied to 5V!
> Connecting 5V logic to sensitive 3.3V SPI flash chips can permanently burn the silicon die.
> **Verification**: Check pin 28 (V3) on the CH341A IC with a multimeter. If it measures 5V, perform the standard 3.3V trace-cut jumper fix before connecting to motherboard BIOS chips!

#### Master SPI Flash Opcode Table (flashrom standard):
| Opcode (Hex) | Command Name | Description | Response / Behavior |
| :--- | :--- | :--- | :--- |
| **\`0x9F\`** | **Read JEDEC ID** | Queries 3-byte silicon identification | Returns: [Manufacturer ID] [Memory Type] [Capacity ID] |
| **\`0x06\`** | **Write Enable (WREN)** | Sets the WEL bit in Status Register | Required before every erase or write operation |
| **\`0x04\`** | **Write Disable (WRDI)**| Clears the WEL bit | Protects memory from accidental writes |
| **\`0x05\`** | **Read Status Reg (RDSR)**| Samples BUSY bit (bit 0) and WEL (bit 1) | Polled during erase/write until \`BUSY == 0\` |
| **\`0x03\`** | **Read Data** | Reads continuous bytes from 24-bit address | Streams flash bytes at normal SPI clock |
| **\`0x20\`** | **Sector Erase (4KB)** | Sets all bits in 4,096-byte sector to \`0xFF\` | Takes ~45ms per sector |
| **\`0xD8\`** | **Block Erase (64KB)** | Sets all bits in 65,536-byte block to \`0xFF\` | Takes ~200ms per block |
| **\`0xC7\`** / **\`0x60\`** | **Chip Erase** | Wipes entire flash chip to \`0xFF\` | Takes 2 to 20 seconds depending on capacity |
| **\`0x02\`** | **Page Program** | Programs up to 256 bytes per page | Writes \`0\` bits (cannot turn a \`0\` back to a \`1\`) |

#### Operational Workflow:
1. Clip the SOIC-8 test clip onto the target flash chip (ensure Pin 1 red wire aligns with the dot/indent on the chip).
2. Click **Read JEDEC ID**: The tool sends \`0x9F\` to read the 3-byte manufacturer identification (e.g. \`0xEF 0x40 0x18\` for Winbond W25Q128 16MB).
3. Click **Read / Dump Flash**: Streams the full flash image into a downloadable \`.bin\` file.
4. Click **Erase & Write**: Erases sectors and writes the new firmware binary with 100% verification.

---

### 2. CMSIS-DAP / DAPLink SWD Debugger

For ARM Cortex-M microcontrollers (STM32F1/F4, Raspberry Pi Pico RP2040, Nordic nRF52, Microchip SAMD):

#### The Two-Wire Serial Wire Debug (SWD) Interface:
- **SWDIO**: Bidirectional data line.
- **SWCLK**: Clock line driven by the host.
- **GND**: Shared ground reference.

#### JTAG-to-SWD Switch Sequence:
To wake up an ARM Cortex-M chip from JTAG mode into SWD mode:
1. Transmit at least **50 continuous clock cycles with SWDIO HIGH**.
2. Transmit the 16-bit JTAG-to-SWD switching sequence: \`0xE7 0x9E\` (\`0b1110011110011110\` LSB first).
3. Transmit another 50 clocks with SWDIO HIGH followed by a line reset.
4. Read **DPIDR (Debug Port ID Register at offset 0x00)**:
   - For Cortex-M0/M0+: Returns \`0x0BB11477\`.
   - For Cortex-M3: Returns \`0x1BA01477\`.
   - For Cortex-M4: Returns \`0x2BA01477\`.

#### Halting the CPU Core via DHCSR:
To inspect memory or flash firmware without the CPU running user code, the debugger writes to the **Debug Halting Control and Status Register (DHCSR at 0xE000EDF0)**:
- Write \`0xA05F0003\` (\`DBGKEY\` \`0xA05F\` + \`C_DEBUGEN\` bit 0 + \`C_HALT\` bit 1).
- The Cortex-M core halts on the next instruction boundary.

---

### 3. JTAG SVF Player

For FPGAs (Xilinx Spartan/Artix, Altera Cyclone, Gowin) and CPLDs:
- Connects over standard 4-wire JTAG:
  - **TDI (Test Data In)**
  - **TDO (Test Data Out)**
  - **TCK (Test Clock)**
  - **TMS (Test Mode Select)**

#### The 16-State JTAG TAP State Machine:
Every state transition is controlled strictly by the level of **TMS** on the rising edge of **TCK**:
\`\`\`
Test-Logic-Reset -> Run-Test/Idle -> Select-DR-Scan -> Capture-DR -> Shift-DR -> Exit1-DR -> Pause-DR -> Update-DR
                                  -> Select-IR-Scan -> Capture-IR -> Shift-IR -> Exit1-IR -> Pause-IR -> Update-IR
\`\`\`

#### SVF (Serial Vector Format) File Execution:
- **SIR**: Shifts an Instruction Register opcode (e.g. \`IDCODE\`, \`BYPASS\`, \`SAMPLE/PRELOAD\`).
- **SDR**: Shifts Data Register bits (e.g. reading 32-bit FPGA silicon ID or streaming configuration bitstreams).
- **RUNTEST**: Holds the TAP in Run-Test/Idle for a specified clock cycle count to allow internal PLLs or programming charge pumps to settle.

---

### 4. AVR ISP (In-System Programmer)

For 8-bit Microchip / Atmel microcontrollers (ATmega328P, ATtiny85, ATmega2560):
- Connects via **MOSI**, **MISO**, **SCK**, and **RESET**.

#### The Programming Enable Protocol:
1. Pull **RESET LOW** to halt the ATmega core.
2. Send the 4-byte synchronization sequence:
   \`\`\`text
   0xAC  0x53  0x00  0x00
   \`\`\`
   - The chip must echo back \`0x53\` on the second byte.
3. **Read Device Signature**:
   - \`0x30 0x00 0x00\` -> Manufacturer (e.g. \`0x1E\` Atmel).
   - \`0x30 0x00 0x01\` -> Part Family (e.g. \`0x95\` 32KB Flash).
   - \`0x30 0x00 0x02\` -> Part Number (e.g. \`0x0F\` ATmega328P).
4. **Fuse Bit Calculator**:
   - **Low Fuse**: Selects oscillator clock source (external 16MHz crystal vs internal 8MHz RC) and startup delay.
   - **High Fuse**: Toggles SPI programming enable (SPIEN), Watchdog timer, and bootloader reset vector size.
   - **Extended Fuse**: Sets brownout detection voltage threshold (1.8V, 2.7V, 4.3V).
`
  },
  {
    id: 'usb-pd',
    toolId: 'usb-pd',
    category: 'programmers',
    title: 'USB-PD Power Delivery — PPS Voltage Trigger & VBUS Analyzer',
    summary: 'Negotiate USB-C Power Delivery contracts up to 100W/240W, trigger variable PPS voltages (3.3V-21V), and monitor real-time VBUS power and current draw.',
    tags: ['USB-PD', 'Power Delivery', 'PPS', 'USB-C', 'VBUS', 'Voltage Trigger', 'Power Supply', 'FUSB302'],
    readTime: '18 min read',
    content: `
# USB-PD Power Delivery — Voltage Trigger & Monitor Manual

The **USB-PD Workbench** interfaces with USB Type-C Power Delivery controller chips (such as FUSB302, CH224K, IP2721, or STUSB4500) over I2C or UART. Sourced directly from the official USB-IF Power Delivery 3.0 specification and \`src/utils/usbPdDriver.js\`, this guide documents BMC negotiation, Power Data Object (PDO) structures, Programmable Power Supply (PPS) dynamic voltage requests, and real-time VBUS telemetry.

---

### 1. How USB-C Power Delivery Negotiation Works

When you plug a standard USB-C cable into a power brick, the charger supplies only **5V VBUS** by default to protect legacy 5V devices.

To request higher voltages:
1. **CC Line Physical Layer**: Communication occurs over the Configuration Channel (**CC1** or **CC2** depending on cable orientation) using **Biphase Mark Coding (BMC)** at **300 kHz**.
2. **SOP Packets**: Messages are framed with Start-of-Packet (SOP) preambles: \`Sync-1\`, \`Sync-1\`, \`Sync-1\`, \`Sync-2\`.
3. **Source Capabilities (PDOs)**: The power brick broadcasts its supported **Power Data Objects (PDOs)**:
   - Fixed Supply PDOs: e.g. \`5V @ 3A\`, \`9V @ 3A\`, \`12V @ 3A\`, \`15V @ 3A\`, \`20V @ 5A\` (100 Watts).
   - Augmented PDOs (PPS): \`3.3V to 21V @ 5A\`.
4. **Request & Accept**: The sink requests a chosen PDO object index. The charger accepts, ramps its internal DC-DC converter to the requested voltage within the specified slew rate (typically 30 mV/ms), and sends a **PS_RDY (Power Supply Ready)** packet.

---

### 2. Anatomy of Power Data Objects (PDOs)

Every 32-bit PDO broadcast by the power supply indicates its capabilities:

#### Fixed Supply PDO (Bits 31-30 = 00):
- **Bits 31-30**: \`00\` (Fixed Supply).
- **Bits 19-10**: Voltage in 50mV units:
  \`\`\`text
  Voltage (V) = Raw_Value * 0.05
  (e.g. 400 * 0.05 = 20.0 Volts)
  \`\`\`
- **Bits 9-0**: Maximum current in 10mA units:
  \`\`\`text
  Current (A) = Raw_Value * 0.01
  (e.g. 500 * 0.01 = 5.0 Amperes)
  \`\`\`

#### Augmented PPS PDO (Bits 31-30 = 11, Bits 29-28 = 00):
- **Bits 31-28**: \`1100\` (Augmented PDO / Programmable Power Supply).
- **Bits 24-17**: Maximum Voltage in 100mV units (e.g. \`210 * 0.1 = 21.0V\`).
- **Bits 15-8**: Minimum Voltage in 100mV units (e.g. \`33 * 0.1 = 3.3V\`).
- **Bits 6-0**: Maximum Current in 50mA units (e.g. \`100 * 0.05 = 5.0A\`).

---

### 3. Capabilities & Interactive Features

#### 1. Fixed Voltage Contract Triggers
Click any preset button to trigger standard voltage contracts:
- **5V**: Baseline USB power.
- **9V**: Powers quick-charge devices and Arduino projects.
- **12V / 15V**: Perfect for small SBCs, Wi-Fi routers, and audio amplifiers.
- **20V**: Powers smart soldering irons (TS100, Pinecil, TS80P) and laptop motherboards up to 100W.

#### 2. Programmable Power Supply (PPS) Trigger
For chargers supporting USB-PD 3.0 PPS:
- Adjust voltage smoothly between **3.3V and 21.0V in 20mV increments**.
- Adjust current limits in **50mA increments**.
- Ideal for testing battery charging curves (e.g. setting exact \`8.40V\` for 2S Li-ion battery packs).

#### 3. Real-Time VBUS Telemetry Visualizer
- **Voltage (V)**: Real-time calibrated bus voltage with millivolt precision.
- **Current (A)**: Real-time current consumption in milliamps.
- **Power (Watts)**: Instantaneous wattage calculation (\`V * A\`).
- **Energy Meter (Wh / mAh)**: Capacity counter for profiling battery discharge rates.
`
  }
];
