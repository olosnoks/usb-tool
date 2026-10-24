/**
 * Hardware Programmers & Power Delivery Wiki Articles
 * Covering CH341A, CMSIS-DAP, JTAG, AVR ISP, and USB-PD Power Delivery
 */

export const HARDWARE_ARTICLES = [
  {
    id: 'programmers',
    toolId: 'programmers',
    category: 'programmers',
    title: 'Hardware Programmers Suite — CH341A, CMSIS-DAP, JTAG & AVR',
    summary: 'Master BIOS chip flashing, 25Qxx SPI flash memory reading, ARM Cortex-M SWD debugging, FPGA JTAG boundary scan, and AVR ISP programming.',
    tags: ['CH341A', 'BIOS', 'SPI Flash', 'CMSIS-DAP', 'SWD', 'JTAG', 'AVR ISP', 'EEPROM'],
    readTime: '8 min read',
    content: `
# Hardware Programmers Suite — BIOS, SWD & JTAG

The **Hardware Programmers Suite** aggregates four essential low-level microcontroller and non-volatile memory programming interfaces into a single unified browser workbench.

---

### 1. CH341A SPI Flash & I2C EEPROM Programmer

The WCH CH341A USB interface chip is the global standard for unbricking motherboard BIOS chips, router flash, and I2C memory ICs.

#### Supported Flash Families
- **25-Series SPI Flash (SOIC-8 / DIP-8)**: Winbond (W25Q64, W25Q128), Macronix (MX25L), GigaDevice (GD25Q), Spansion.
- **24-Series I2C EEPROM**: 24C02 through 24C512.

> **CRITICAL 3.3V MODIFICATION WARNING**:
> Many cheap "black" CH341A programmer boards contain a design flaw where the data lines output 5V instead of 3.3V, which can destroy sensitive 3.3V SPI flash chips!
> Always verify that your CH341A pin 28 (V3) is tied to 3.3V or perform the 3.3V trace-cut jumper modification before connecting to motherboards or routers.

#### Operations
- **Read Chip ID**: Sends SPI command \`0x9F\` to read the 3-byte JEDEC manufacturer ID.
- **Read / Dump**: Reads the entire flash image into a downloadable \`.bin\` file.
- **Erase Chip**: Sends \`0xC7\` / \`0x60\` (Chip Erase) to reset all flash bits to \`0xFF\`.
- **Write / Verify**: Programs target binary in 256-byte pages (\`0x02\` Page Program) and verifies checksums.

---

### 2. CMSIS-DAP / DAPLink SWD Debugger

For ARM Cortex-M microcontrollers (STM32, RP2040, Nordic nRF52, Microchip SAMD):
- Uses standard **Serial Wire Debug (SWD)** two-wire interface: **SWDIO** (Bidirectional Data) and **SWCLK** (Clock).
- Halts the CPU core, inspects ARM core registers (R0-R15, SP, PC, LR), unlocks locked silicon (Readout Protection / RDP bypass), and flashes firmware binaries into internal flash memory.

---

### 3. JTAG SVF Player

For FPGAs (Xilinx Spartan/Artix, Altera Cyclone, Gowin) and CPLDs:
- Communicates over standard 4-wire JTAG: **TDI** (Test Data In), **TDO** (Test Data Out), **TCK** (Test Clock), and **TMS** (Test Mode Select).
- Plays standard Serial Vector Format (\`.svf\`) files to configure FPGA bitstreams or burn configuration PROMs.

---

### 4. AVR ISP (In-System Programmer)

For 8-bit Microchip / Atmel microcontrollers (ATmega328P, ATtiny85, ATmega2560):
- Connects via **MOSI**, **MISO**, **SCK**, and **RESET**.
- Reads and programs **Fuse Bits** (Low Fuse, High Fuse, Extended Fuse, Lock Bits) to configure internal RC oscillators vs external crystals and enable/disable bootloader reset vectors.
`
  },
  {
    id: 'usb-pd',
    toolId: 'usb-pd',
    category: 'programmers',
    title: 'USB-PD Power Delivery — PPS Voltage Trigger & VBUS Analyzer',
    summary: 'Negotiate USB-C Power Delivery contracts up to 100W/240W, trigger variable PPS voltages (3.3V-21V), and monitor real-time VBUS power.',
    tags: ['USB-PD', 'Power Delivery', 'PPS', 'USB-C', 'VBUS', 'Voltage Trigger'],
    readTime: '6 min read',
    content: `
# USB-PD Power Delivery — Voltage Trigger & Monitor

The **USB-PD Workbench** interfaces with USB Type-C Power Delivery controllers (such as FUSB302, CH224K, IP2721, or STUSB4500) over I2C or UART. It allows you to transform any standard USB-C laptop charger or power bank into an adjustable benchtop power supply.

---

### How USB-C Power Delivery Works

When a standard USB-C cable is inserted, the charger supplies only **5V VBUS** by default to prevent damaging non-PD devices.

To request higher voltages:
1. **CC Line Communication**: The charger and device communicate over the Configuration Channel (**CC1** / **CC2**) using BMC (Biphase Mark Coding) at 300 kHz.
2. **Source Capabilities (PDOs)**: The charger broadcasts its supported Power Data Objects (e.g. 5V@3A, 9V@3A, 12V@3A, 15V@3A, 20V@5A).
3. **Request & Accept**: The controller requests a specific PDO. The charger accepts, ramps its DC-DC converter to the target voltage, and sends a **PS_RDY** (Power Supply Ready) packet.

---

### Capabilities & Usage

#### 1. Fixed Voltage Contract Triggers
Click any preset voltage to trigger the charger's fixed PDO:
- **5V**: Standard USB baseline.
- **9V**: Ideal for powering Arduino boards or quick-charge devices.
- **12V / 15V**: Perfect for small SBCs, Wi-Fi routers, and audio amplifiers.
- **20V**: Powers soldering irons (TS100 / Pinecil) and laptop motherboards up to 100W.

#### 2. Programmable Power Supply (PPS) Trigger
Chargers supporting USB-PD 3.0 PPS allow smooth voltage adjustment from **3.3V to 21V in 20mV increments**:
- Use the on-screen slider or input exact voltages (e.g. \`8.40V\` for 2S Li-ion battery charging).
- Adjust current limits in 50mA steps.

#### 3. Real-Time VBUS Telemetry
- **Voltage (V)**: Real-time calibrated bus voltage with millivolt precision.
- **Current (A)**: Real-time current draw with milliamp precision.
- **Power (Watts)**: Instantaneous wattage calculation (\`V * A\`).
- **Energy (Wh / mAh)**: Integrated battery capacity counting for testing power banks.
`
  }
];
