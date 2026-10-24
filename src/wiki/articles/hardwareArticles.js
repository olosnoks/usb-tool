/**
 * Hardware Programmers & Power Delivery Wiki Articles — Comprehensive Technical Manual
 * Covering CH341A, CMSIS-DAP, JTAG, AVR ISP, and USB-PD Power Delivery
 */

export const HARDWARE_ARTICLES = [
  {
    id: 'programmers',
    toolId: 'programmers',
    category: 'programmers',
    title: 'Hardware Programmers Suite — CH341A, CMSIS-DAP, JTAG & AVR ISP',
    summary: 'Master motherboard BIOS unbricking, Winbond 25Qxx SPI flash memory reading, ARM Cortex-M SWD debugging, FPGA JTAG boundary scan, and AVR ISP programming.',
    tags: ['CH341A', 'BIOS', 'SPI Flash', 'CMSIS-DAP', 'SWD', 'JTAG', 'AVR ISP', 'EEPROM', 'Winbond', 'Unbrick'],
    readTime: '17 min read',
    content: `
# Hardware Programmers Suite — Low-Level Memory & Silicon

The **Hardware Programmers Suite** aggregates four essential low-level microcontroller and non-volatile memory programming interfaces into a single unified browser workbench:
1. **CH341A Programmer**: SPI Flash & I2C EEPROM burning.
2. **CMSIS-DAP / DAPLink**: ARM Cortex-M SWD debugging and flashing.
3. **JTAG SVF Player**: FPGA / CPLD configuration.
4. **AVR ISP**: Atmel / Microchip ATmega fuse and flash programming.

---

### 1. CH341A SPI Flash & I2C EEPROM Programmer

The WCH CH341A USB interface chip is the global standard for unbricking motherboard BIOS chips, router flash memory, and I2C automotive memory ICs.

#### Supported Flash Families
- **25-Series SPI Flash (SOIC-8 / DIP-8)**: Winbond (W25Q32, W25Q64, W25Q128), Macronix (MX25L), GigaDevice (GD25Q), Spansion.
- **24-Series I2C EEPROM**: 24C02 through 24C512.

> **CRITICAL 3.3V HARDWARE MODIFICATION WARNING**:
> Many cheap "black" CH341A programmer boards sold online contain a severe design flaw: while the VCC pin is set to 3.3V, the data signal lines (MOSI, MISO, SCK, CS) are tied to 5V!
> Connecting 5V logic to sensitive 3.3V SPI flash chips can permanently burn the silicon die.
> **Verification**: Check pin 28 (V3) on the CH341A IC with a multimeter. If it measures 5V, perform the standard 3.3V trace-cut jumper fix before connecting to motherboard BIOS chips!

#### Operational Workflow:
1. Clip the SOIC-8 test clip onto the target flash chip (ensure Pin 1 red wire aligns with the dot/indent on the chip).
2. Click **Read JEDEC ID**: The tool issues SPI opcode \`0x9F\` to read the 3-byte manufacturer identification (e.g. \`0xEF 0x40 0x18\` for Winbond 16MB).
3. Click **Read / Dump Flash**: Streams the full flash image into a downloadable \`.bin\` file.
4. Click **Erase & Write**: Erases sectors (\`0x20\` Sector Erase or \`0xC7\` Chip Erase) and writes the new firmware binary with 100% verification.

---

### 2. CMSIS-DAP / DAPLink SWD Debugger

For ARM Cortex-M microcontrollers (STM32F1/F4, Raspberry Pi Pico RP2040, Nordic nRF52, Microchip SAMD):
- Uses standard **Serial Wire Debug (SWD)**:
  - **SWDIO**: Bidirectional data line.
  - **SWCLK**: Clock line.
  - **GND**: Shared ground reference.
- **Features**:
  - Halts the core and inspects CPU registers (R0-R15, Program Counter PC, Stack Pointer SP).
  - Unlocks silicon locked by Readout Protection (RDP Level 1 bypass).
  - Flashes compiled \`.bin\` or \`.hex\` binaries directly into internal micro-controller flash memory.

---

### 3. JTAG SVF Player

For FPGAs (Xilinx Spartan/Artix, Altera Cyclone, Gowin) and CPLDs:
- Connects over 4-wire JTAG:
  - **TDI (Test Data In)**
  - **TDO (Test Data Out)**
  - **TCK (Test Clock)**
  - **TMS (Test Mode Select)**
- **SVF File Player**: Uploads and executes standard Serial Vector Format (\`.svf\`) test suites to perform boundary scans or configure FPGA gate arrays in real time.

---

### 4. AVR ISP (In-System Programmer)

For 8-bit Microchip / Atmel microcontrollers (ATmega328P, ATtiny85, ATmega2560):
- Connects via **MOSI**, **MISO**, **SCK**, and **RESET**.
- **Fuse Bit Calculator**: Reads and burns Low, High, and Extended Fuse bytes (e.g. configuring external 16MHz crystal vs internal 8MHz RC oscillator, enabling brownout detection, or toggling the bootloader reset vector).
`
  },
  {
    id: 'usb-pd',
    toolId: 'usb-pd',
    category: 'programmers',
    title: 'USB-PD Power Delivery — PPS Voltage Trigger & VBUS Analyzer',
    summary: 'Negotiate USB-C Power Delivery contracts up to 100W/240W, trigger variable PPS voltages (3.3V-21V), and monitor real-time VBUS power and current draw.',
    tags: ['USB-PD', 'Power Delivery', 'PPS', 'USB-C', 'VBUS', 'Voltage Trigger', 'Power Supply'],
    readTime: '14 min read',
    content: `
# USB-PD Power Delivery — Voltage Trigger & Monitor

The **USB-PD Workbench** interfaces with USB Type-C Power Delivery controller chips (such as FUSB302, CH224K, IP2721, or STUSB4500) over I2C or UART. It allows you to transform any standard USB-C laptop charger or power bank into an adjustable benchtop power supply.

---

### 1. How USB-C Power Delivery Negotiation Works

When you plug a standard USB-C cable into a charger, the charger supplies only **5V VBUS** by default to protect non-PD 5V electronics.

To request higher voltages:
1. **CC Line Communication**: The charger and sink communicate over the Configuration Channel (**CC1** or **CC2**) using Biphase Mark Coding (BMC) at 300 kHz.
2. **Source Capabilities (PDOs)**: The power brick broadcasts its supported **Power Data Objects (PDOs)**:
   - Fixed PDOs: e.g. \`5V @ 3A\`, \`9V @ 3A\`, \`12V @ 3A\`, \`15V @ 3A\`, \`20V @ 5A\` (100 Watts).
   - Augmented PDOs (PPS): \`3.3V to 21V @ 5A\`.
3. **Request & Accept**: The workbench controller requests a chosen PDO. The charger accepts, ramps its internal DC-DC converter to the target voltage, and sends a **PS_RDY (Power Supply Ready)** packet.

---

### 2. Capabilities & Interactive Features

#### 1. 1-Click Fixed Voltage Contract Triggers
Click preset buttons to command standard voltages:
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
