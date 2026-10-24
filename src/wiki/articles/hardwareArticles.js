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
    readTime: '30 min read',
    content: `
# Hardware Programmers Suite — Low-Level Memory & Silicon

The **Hardware Programmers Suite** aggregates four essential low-level microcontroller, FPGA, and non-volatile memory programming interfaces into a single unified browser workbench:
1. **CH341A Programmer**: SPI Flash (25-series) & I2C EEPROM (24-series) reading, erasing, and burning.
2. **CMSIS-DAP / DAPLink Debugger**: ARM Cortex-M SWD debugging, memory inspection, and flashing.
3. **JTAG SVF Player**: IEEE 1149.1 boundary scan interrogation and FPGA/CPLD bitstream burning.
4. **AVR ISP Engine**: Microchip / Atmel 8-bit AVR microcontroller fuse bit calculation and flash programming.

---

### 1. CH341A SPI Flash & I2C EEPROM Programmer

The **WCH CH341A** is a multi-function USB interface chip manufactured by Nanjing Qinheng Microelectronics. In hardware programming mode (SDA and SCL jumper bridged on pins 1-2), the CH341A operates as a full-speed USB 2.0 host bridge supporting high-speed SPI master transfers up to 3 MHz and I2C master transfers up to 400 kHz.

#### Supported Flash Families & Capacities:
- **25-Series SPI Flash (SOIC-8, SOIC-16, DIP-8, WSON-8)**:
  - Winbond: \`W25Q08\` (1MB), \`W25Q16\` (2MB), \`W25Q32\` (4MB), \`W25Q64\` (8MB), \`W25Q128\` (16MB), \`W25Q256\` (32MB).
  - Macronix: \`MX25L4006\`, \`MX25L8006\`, \`MX25L1606\`, \`MX25L3206\`, \`MX25L6406\`, \`MX25L12835\`.
  - GigaDevice: \`GD25Q16\`, \`GD25Q32\`, \`GD25Q64\`, \`GD25Q128\`.
  - Spansion / Cypress: \`S25FL032P\`, \`S25FL064P\`, \`S25FL128P\`.
- **24-Series I2C EEPROM**:
  - \`24C02\` (256 bytes), \`24C04\` (512 bytes), \`24C08\` (1KB), \`24C16\` (2KB), \`24C32\` (4KB), \`24C64\` (8KB), \`24C128\` (16KB), \`24C256\` (32KB), \`24C512\` (64KB), \`24C1024\` (128KB).

> [!WARNING]
> ### Critical 3.3V Hardware Modification Warning
> Many inexpensive "black" CH341A programmer boards sold on Amazon and AliExpress contain a severe PCB layout flaw: while the board's 3-pin power header sets the VCC pin to 3.3V, the CH341A IC's pin 28 (V3) is tied directly to 5V USB power instead of 3.3V. This forces the data output lines (MOSI, CS, SCK) to drive at **5.0V logic levels**!
> Connecting 5V logic to modern 3.3V Winbond or Macronix BIOS chips can degrade or permanently puncture the silicon substrate.
> **Verification & Fix**:
> 1. Measure the DC voltage between GND and Pin 28 (V3) on the CH341A IC using a digital multimeter.
> 2. If it measures ~5.0V, cut the PCB trace between pin 28 and the 5V rail.
> 3. Solder a thin bodge wire from pin 28 to the 3.3V output pin of the on-board AMS1117-3.3 regulator.

<details>
<summary>Deep-Dive: Master SPI Flash Opcode Set & Status Register 1 Bitfields</summary>

The CH341A driver implements the universal SPI flash command set conforming to JEDEC JESD216 SFDP:

| Opcode (Hex) | Command Name | Data Bytes Sent | Data Bytes Received | Description |
| :--- | :--- | :---: | :---: | :--- |
| **\`0x9F\`** | **Read JEDEC ID** | 0 | 3 | Queries 1-byte Manufacturer, 1-byte Memory Type, 1-byte Capacity. |
| **\`0x06\`** | **Write Enable (WREN)** | 0 | 0 | Sets the Write Enable Latch (WEL) bit in Status Register 1. |
| **\`0x04\`** | **Write Disable (WRDI)** | 0 | 0 | Clears the WEL bit, locking memory against writes. |
| **\`0x05\`** | **Read Status Register 1** | 0 | 1 | Samples the BUSY (bit 0) and WEL (bit 1) flags. |
| **\`0x01\`** | **Write Status Register** | 1 or 2 | 0 | Writes protection bits (BP0-BP2, SEC, TB) to unlock flash. |
| **\`0x03\`** | **Read Data Bytes** | 3 (Address) | $N$ | Streams continuous data bytes at normal SPI read clock. |
| **\`0x0B\`** | **Fast Read** | 3 (Addr) + 1 (Dummy) | $N$ | Reads flash bytes at higher clock frequencies with dummy cycle. |
| **\`0x20\`** | **Sector Erase (4KB)** | 3 (Address) | 0 | Erases a 4,096-byte sector to \`0xFF\` (~45ms). |
| **\`0x52\`** | **Block Erase (32KB)** | 3 (Address) | 0 | Erases a 32,768-byte half-block to \`0xFF\` (~120ms). |
| **\`0xD8\`** | **Block Erase (64KB)** | 3 (Address) | 0 | Erases a 65,536-byte block to \`0xFF\` (~150ms). |
| **\`0xC7\`** / **\`0x60\`** | **Chip Erase** | 0 | 0 | Wipes entire flash memory die to \`0xFF\` (2 to 30 seconds). |
| **\`0x02\`** | **Page Program** | 3 (Addr) + up to 256 | 0 | Programs 1 to 256 bytes into a single memory page (~0.8ms). |

#### Status Register 1 (SR1) Bit Anatomy:
\`\`\`text
Bit 7: SPR0 / SRP (Status Register Protect 0)
Bit 6: SEC        (Sector Protect / Block Protect Size)
Bit 5: TB         (Top / Bottom Protect: 0 = Top, 1 = Bottom)
Bit 4: BP2        (Block Protect Bit 2)
Bit 3: BP1        (Block Protect Bit 1)
Bit 2: BP0        (Block Protect Bit 0)
Bit 1: WEL        (Write Enable Latch: 1 = Enabled, 0 = Write Protected)
Bit 0: BUSY / WIP (Write In Progress: 1 = Erase/Write Active, 0 = Ready)
\`\`\`

#### How to Clear Hardware Write Protection:
If \`Read Status Register\` returns \`0x1C\` or \`0x3C\` (BP0-BP2 set), flash memory is hardware write-protected. Skon's USB Tool automatically issues \`WREN (0x06)\` followed by \`WRSR (0x01 0x00 0x00)\` to clear all protection bits before erasing or programming!
</details>

<details>
<summary>Deep-Dive: In-Circuit SOIC-8 Clip Flashing Challenges & Solutions</summary>

Flashing a BIOS chip directly on a motherboard using a spring-loaded SOIC-8 test clip is convenient, but introduces significant electrical challenges:
1. **Parasitic Power-Drain**: When you feed 3.3V into pin 8 (VCC) of the BIOS chip, that 3.3V rail often feeds backward into the motherboard's Intel/AMD Southbridge/PCH chipset, Super I/O chip, and LEDs, drawing up to 800mA from the CH341A and pulling the voltage down to 2.1V.
   - *Fix*: Power the motherboard in Standby mode (plugged into ATX power or wall charger with power OFF) and do **NOT** connect the CH341A VCC wire. Only connect MOSI, MISO, SCK, CS, and GND!
2. **Chip Select (CS) Contention**: The motherboard's onboard chipset holds the BIOS chip's CS pin HIGH or LOW.
   - *Fix*: Use a 100-ohm resistor between the CH341A CS pin and the flash chip, or short the motherboard's main reset line to ground to hold the chipset in reset during flashing.
3. **Contact Resistance**: SOIC-8 clip pins easily accumulate oxidation. Always clean the chip pins with 99% isopropyl alcohol and a toothbrush before clipping on.
</details>

#### Step-by-Step Tutorial: Reading & Unbricking a Motherboard BIOS
1. Align the red wire of the SOIC-8 test clip with **Pin 1** of the flash chip (indicated by a small circular dot/indent on the plastic casing).
2. Plug the CH341A programmer into your computer's USB port.
3. In Skon's USB Tool, open the **Hardware Programmers Suite** and select the **CH341A Programmer** tab.
4. Click **Read JEDEC ID**:
   - The tool transmits opcode \`0x9F\` and displays the detected silicon:
     \`\`\`text
     JEDEC ID: EF 40 18
     Manufacturer: Winbond Electronics (0xEF)
     Memory Type: SPI Flash (0x40)
     Capacity: 16,777,216 Bytes (16 MB / 128 Mbit - W25Q128FV)
     \`\`\`
5. Click **Read / Dump Flash**:
   - The tool streams the entire 16MB image over USB, displaying a real-time progress bar and throughput rate (typically ~180 KB/s).
   - Once completed, click **Save Dump (.bin)** to save a backup of the original BIOS.
6. Click **Select Firmware File** and select your clean motherboard BIOS update file (\`.bin\` or \`.rom\`).
7. Click **Auto Flash (Erase -> Write -> Verify)**:
   - **Stage 1 (Erase)**: Clears all sectors from \`0x000000\` to end of flash.
   - **Stage 2 (Write)**: Programs flash memory in 256-byte chunks via opcode \`0x02\`.
   - **Stage 3 (Verify)**: Reads back the entire chip and compares the SHA-256 hash against the source file. If hashes match, the chip is 100% verified!

---

### 2. CMSIS-DAP / DAPLink ARM Cortex-M SWD Debugger

**CMSIS-DAP** is the official microcontroller debug access port standard defined by Arm Limited. When paired with a CMSIS-DAP compatible probe (such as the Raspberry Pi Debug Probe, DAPLink, ST-Link v2 running DAP firmware, or an RP2040 running Picoprobe), Skon's USB Tool communicates directly with the ARM CoreSight debug infrastructure inside the target microcontroller over **Serial Wire Debug (SWD)**.

#### Supported Microcontroller Architectures:
- **ARM Cortex-M0 / M0+**: Raspberry Pi RP2040, STM32F0, Microchip SAMD21, NXP LPC800.
- **ARM Cortex-M3**: STM32F103 (BluePill), Microchip SAM3X8E (Arduino Due).
- **ARM Cortex-M4**: STM32F401 / F411 (BlackPill), Nordic nRF52840, TI CC2652.
- **ARM Cortex-M7**: STM32H7, Teensy 4.0 / 4.1 (NXP i.MX RT1062).

#### The 2-Wire SWD Physical Layer:
- **SWDIO (Serial Wire Data Input/Output)**: Bidirectional data line with internal pull-up.
- **SWCLK (Serial Wire Clock)**: Host-driven clock line (typically 100 kHz to 10 MHz).
- **GND (Ground)**: Common electrical ground reference.
- **RESET / nRST (Optional)**: Hardware reset control line.

<details>
<summary>Deep-Dive: SWD Line Reset, Protocol Switching & CoreSight DPIDR Table</summary>

To switch a target microcontroller from legacy JTAG mode to SWD mode without toggling a reset pin:
1. **Send 50+ Clock Cycles with SWDIO HIGH**: Clears any partial command states.
2. **Send 16-Bit JTAG-to-SWD Switching Pattern**:
   - Transmit: \`0xE7 0x9E\` (\`0b1110011110011110\` LSB first).
3. **Send 50+ Clock Cycles with SWDIO HIGH**: Locks the internal debug logic into SWD mode.
4. **Send 4+ Idle Clocks with SWDIO LOW**: Prepares the Debug Port (DP) state machine.
5. **Read DPIDR (Debug Port ID Register at offset 0x00)**:
   - Every ARM Cortex-M silicon core returns a unique 32-bit identifier:

| Core Architecture | Part Number | DPIDR Value (Hex) | Example Microcontroller |
| :--- | :--- | :---: | :--- |
| **Cortex-M0+** | Arm CoreSight SW-DP v1 | \`0x0BC11477\` | Raspberry Pi RP2040, STM32G0 |
| **Cortex-M0** | Arm CoreSight SW-DP v1 | \`0x0BB11477\` | STM32F030, NXP LPC1114 |
| **Cortex-M3** | Arm CoreSight SW-DP v1 | \`0x1BA01477\` | STM32F103C8T6 (BluePill) |
| **Cortex-M4** | Arm CoreSight SW-DP v1 | \`0x2BA01477\` | STM32F401, STM32F411, nRF52832 |
| **Cortex-M7** | Arm CoreSight SW-DP v1 | \`0x5BA02477\` | STM32H743, Teensy 4.1 |

</details>

<details>
<summary>Deep-Dive: Core Halting & Memory Access via DHCSR, DCRSR & MEM-AP</summary>

To inspect registers or dump firmware, the debugger must take control of the ARM CPU core:

#### 1. Halting the Core via DHCSR:
The **Debug Halting Control and Status Register (DHCSR)** resides at memory address \`0xE000EDF0\`:
- Writing \`0xA05F0003\` (\`DBGKEY\` = \`0xA05F\`, \`C_DEBUGEN\` = bit 0, \`C_HALT\` = bit 1) commands the CPU core to halt on the current instruction boundary.
- Reading DHCSR and sampling bit 17 (\`S_HALT\`) verifies when the CPU has successfully halted.

#### 2. Reading General-Purpose CPU Registers (R0-R15, PC, SP, LR):
- Write the register index (e.g. \`0x0F\` for PC - Program Counter) to **DCRSR (Debug Core Register Selector Register at 0xE000EDF4)**.
- Read the sampled register value from **DCRDR (Debug Core Register Data Register at 0xE000EDF8)**.

#### 3. Accessing Physical Memory via MEM-AP:
The **Memory Access Port (MEM-AP)** allows direct reading and writing of SRAM, flash, and peripheral registers without CPU execution:
- Write target 32-bit physical address to **TAR (Transfer Address Register)**.
- Read or write 32-bit words from **DRW (Data Read/Write Register)**. The internal address pointer automatically increments on sequential accesses for maximum transfer speed!
</details>

#### Step-by-Step Tutorial: Connecting to an STM32 or RP2040 Target
1. Connect your CMSIS-DAP probe (e.g. Raspberry Pi Debug Probe) to your PC via USB.
2. Wire the probe's SWCLK, SWDIO, and GND pins to the target board's SWD header.
3. In Skon's USB Tool, navigate to **Hardware Programmers** -> **CMSIS-DAP**.
4. Click **Connect Probe & Detect Target**:
   - The tool performs the \`0xE79E\` SWD line switch, reads DPIDR, halts the core, and displays:
     \`\`\`text
     Connected: CMSIS-DAP v2 (Raspberry Pi Picoprobe)
     Target Architecture: ARM Cortex-M0+ (DPIDR: 0x0BC11477)
     Core State: HALTED
     Program Counter (PC): 0x10000184
     Stack Pointer (SP):   0x20041F00
     \`\`\`
5. **Inspect Memory**: Enter memory start address \`0x20000000\` (SRAM) and length \`0x100\` to inspect RAM variables in real time.
6. **Flash Firmware**: Select your compiled \`.bin\` or \`.hex\` file and click **Program Flash**. The debugger writes pages directly through the MEM-AP and triggers a hardware system reset.

---

### 3. JTAG Boundary Scan & SVF Player

**JTAG (Joint Test Action Group - IEEE 1149.1)** is the universal hardware standard for digital IC testing, boundary scanning, and FPGA configuration. Using four dedicated digital signals, JTAG allows you to test circuit board interconnects without test probes, observe physical pin logic states, and program FPGA bitstreams into non-volatile configuration memory.

#### Supported Silicon & Targets:
- **FPGAs**: Xilinx Spartan-6, Artix-7, Kintex-7; Altera Cyclone IV / V; Gowin GW1N / GW2A; Lattice iCE40 / ECP5.
- **CPLDs**: Xilinx XC9500, CoolRunner-II; Altera MAX II / MAX V.
- **Processors**: Broadcom BCM2835/2837 (Raspberry Pi), Allwinner H3/H6, NXP i.MX.

#### The 4-Wire JTAG Interface:
- **TCK (Test Clock)**: Synchronizes data transfers on rising/falling clock edges.
- **TMS (Test Mode Select)**: Navigates the 16-state TAP finite state machine (sampled on rising TCK).
- **TDI (Test Data In)**: Serial data shifted into instruction or data registers.
- **TDO (Test Data Out)**: Serial data shifted out from the target (driven on falling TCK).
- **TRST (Test Reset - Optional)**: Asynchronous hardware reset for the TAP controller.

<details>
<summary>Deep-Dive: The 16-State IEEE 1149.1 TAP Controller State Machine</summary>

Every JTAG operation is governed by a 16-state finite state machine inside the target IC. The state machine transitions on every rising edge of **TCK** depending strictly on whether **TMS** is \`0\` or \`1\`:

\`\`\`text
                  +--------------------------------+
                  |       Test-Logic-Reset         | <--- Holding TMS=1 for 5 clocks
                  +--------------------------------+      always forces this state
                                  | (TMS=0)
                  +--------------------------------+
                  |         Run-Test/Idle          |
                  +--------------------------------+
                                  | (TMS=1)
                  +--------------------------------+
                  |         Select-DR-Scan         |
                  +--------------------------------+
                   / (TMS=0)                      \\ (TMS=1)
    +-------------------------+        +-------------------------+
    |       Capture-DR        |        |       Select-IR-Scan    |
    +-------------------------+        +-------------------------+
                 | (TMS=0)                          | (TMS=0)
    +-------------------------+        +-------------------------+
    |        Shift-DR         |        |        Shift-IR         | <--- Bits shift in TDI
    +-------------------------+        +-------------------------+      and out TDO
                 | (TMS=1)                          | (TMS=1)
    +-------------------------+        +-------------------------+
    |        Exit1-DR         |        |        Exit1-IR         |
    +-------------------------+        +-------------------------+
        | (TMS=0)    | (TMS=1)             | (TMS=0)    | (TMS=1)
    +------------+ +------------+      +------------+ +------------+
    |  Pause-DR  | | Update-DR  |      |  Pause-IR  | | Update-IR  |
    +------------+ +------------+      +------------+ +------------+
\`\`\`

#### Key Instructions in the Instruction Register (IR):
- **\`BYPASS\` (All 1s)**: Connects a 1-bit shift register between TDI and TDO, allowing downstream chips in a daisy chain to be addressed with minimal latency.
- **\`IDCODE\`**: Connects the 32-bit Device Identification Register to TDO.
- **\`SAMPLE/PRELOAD\`**: Samples physical I/O pins into the boundary scan register during normal operation.
- **\`EXTEST\`**: Drives boundary scan register values onto physical IC output pins to test trace continuity and detect solder bridges.
</details>

<details>
<summary>Deep-Dive: SVF (Serial Vector Format) File Execution Engine</summary>

**SVF (Serial Vector Format)** is an industry-standard ASCII language created by ASSET InterTech and Texas Instruments to describe JTAG test and configuration vectors:

| SVF Command | Syntax & Example | Operational Behavior |
| :--- | :--- | :--- |
| **\`FREQUENCY\`** | \`FREQUENCY 1000000 HZ;\` | Sets the maximum TCK clock frequency (e.g. 1 MHz). |
| **\`STATE\`** | \`STATE IDLE;\` | Drives TMS transitions to move the TAP state machine to a specific state. |
| **\`SIR\`** | \`SIR 6 TDI (02);\` | Shifts a 6-bit instruction opcode into the Instruction Register. |
| **\`SDR\`** | \`SDR 32 TDI (00000000) TDO (01260093);\` | Shifts 32 data bits into TDI while asserting expected output bits on TDO. |
| **\`RUNTEST\`** | \`RUNTEST 10000 TCK;\` | Holds the TAP in Run-Test/Idle for 10,000 clocks to allow internal FPGA PLLs or flash charge pumps to settle. |
| **\`HDR\` / \`HIR\`** | \`HIR 0;\` | Sets header bits for daisy-chained multi-chip scan chains. |

</details>

#### Step-by-Step Tutorial: Scanning a JTAG Chain & Playing an SVF Bitstream
1. Connect TCK, TMS, TDI, TDO, and GND from your USB-JTAG bridge to the target board.
2. In Skon's USB Tool, select **Hardware Programmers** -> **JTAG SVF Player**.
3. Click **Scan JTAG Chain**:
   - The tool holds TMS HIGH for 5 clock cycles to reset the TAP, shifts out the 32-bit IDCODE, and parses the silicon manufacturer:
     \`\`\`text
     Chain Scan Result: 1 Device Detected
     Device #0: Xilinx Spartan-6 XC6SLX9 (IDCODE: 0x04001093)
     Instruction Register Length: 6 bits
     \`\`\`
4. Click **Load SVF File** and select your synthesized FPGA bitstream (\`.svf\` file generated by Xilinx ISE, Vivado, or Gowin EDA).
5. Click **Execute SVF**:
   - The engine parses commands sequentially, streams configuration vectors into the FPGA configuration SRAM, verifies the DONE pin transition, and logs success!

---

### 4. AVR ISP (In-System Programmer & STK500)

**AVR ISP** is the standard SPI-based programming protocol for 8-bit Microchip / Atmel microcontrollers (ATmega328P, ATmega2560, ATtiny85, ATtiny13A). It operates by holding the microcontroller's RESET line LOW while issuing 4-byte programming commands over the SPI bus.

#### Supported Silicon:
- **ATmega Series**: \`ATmega328P\` (Arduino Uno / Nano / Pro Mini), \`ATmega2560\` (Arduino Mega), \`ATmega32U4\` (Arduino Leonardo / Pro Micro), \`ATmega168\`, \`ATmega8\`.
- **ATtiny Series**: \`ATtiny85\`, \`ATtiny45\`, \`ATtiny84\`, \`ATtiny13A\`, \`ATtiny2313\`.

#### Physical Wiring (Standard 6-Pin AVR ISP Header):
\`\`\`text
6-Pin ISP Header (Top View):
    [MISO]  (1) (2)  [VCC +5V]
    [SCK]   (3) (4)  [MOSI]
    [RESET] (5) (6)  [GND]
\`\`\`

<details>
<summary>Deep-Dive: AVR ISP 4-Byte Command Protocol & Memory Architecture</summary>

The AVR ISP protocol communicates through synchronous 4-byte transactions:

| Command Name | Byte 1 | Byte 2 | Byte 3 | Byte 4 | Description & Response |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Programming Enable** | \`0xAC\` | \`0x53\` | \`0x00\` | \`0x00\` | Syncs interface. Target echoes back \`0x53\` on Byte 3. |
| **Chip Erase** | \`0xAC\` | \`0x80\` | \`0x00\` | \`0x00\` | Erases entire flash memory and lock bits to \`0xFF\` (~10ms). |
| **Read Device Signature** | \`0x30\` | \`0x00\` | \`Address\` | Output | Addr \`0x00\`=Vendor, \`0x01\`=Part Family, \`0x02\`=Part Number. |
| **Read Low Fuse** | \`0x50\` | \`0x00\` | \`0x00\` | Output | Returns 8-bit Low Fuse byte. |
| **Read High Fuse** | \`0x58\` | \`0x08\` | \`0x00\` | Output | Returns 8-bit High Fuse byte. |
| **Read Extended Fuse** | \`0x50\` | \`0x08\` | \`0x00\` | Output | Returns 8-bit Extended Fuse byte. |
| **Write Low Fuse** | \`0xAC\` | \`0xA0\` | \`0x00\` | \`Data\` | Burns Low Fuse bits into non-volatile fuse cells. |
| **Write High Fuse** | \`0xAC\` | \`0xA8\` | \`0x00\` | \`Data\` | Burns High Fuse bits. |
| **Write Extended Fuse**| \`0xAC\` | \`0xA4\` | \`0x00\` | \`Data\` | Burns Extended Fuse bits. |
| **Load Flash Page** | \`0x40\` | \`Addr Low\`| \`Data\` | 0 | Buffers low byte of 16-bit instruction into page buffer. |
| **Write Flash Page** | \`0x4C\` | \`Addr High\`|\`Addr Low\`| 0 | Burns page buffer into physical flash memory. |

#### Device Signature Byte Verification Table:
- **ATmega328P**: \`0x1E 0x95 0x0F\` (Atmel, 32KB Flash, Model 0F).
- **ATmega2560**: \`0x1E 0x98 0x01\` (Atmel, 256KB Flash, Model 01).
- **ATmega32U4**: \`0x1E 0x95 0x87\` (Atmel, 32KB Flash, Native USB).
- **ATtiny85**: \`0x1E 0x93 0x0B\` (Atmel, 8KB Flash).
</details>

<details>
<summary>Deep-Dive: Interactive Fuse Bit Calculator & Clock Recovery Mechanics</summary>

Fuses configure the fundamental hardware behavior of the AVR processor. Unlike flash memory, **a fuse bit is programmed when set to \`0\` (LOW)** and unprogrammed when set to \`1\` (HIGH):

#### 1. Low Fuse (CKSEL, SUT, CKDIV8):
- **CKSEL[3:0] (Clock Source Selection)**:
  - \`0010\`: Internal 8 MHz calibrated RC oscillator.
  - \`1111\`: External low-power crystal oscillator (16 MHz on Arduino Uno).
- **CKDIV8 (Divide Clock by 8)**: If programmed (\`0\`), the system clock runs at 1/8th speed (1 MHz from 8 MHz internal). Must be disabled (\`1\`) for standard 16 MHz Arduino operation!

#### 2. High Fuse (SPIEN, WDTON, EESAVE, BOOTSZ):
- **SPIEN (SPI Programming Enable)**: Defaults to \`0\` (enabled). *Never unprogram this bit over serial ISP, or you will lock yourself out permanently!*
- **EESAVE**: Preserves EEPROM memory during Chip Erase cycles when set to \`0\`.
- **BOOTRST (Select Reset Vector)**: If \`0\`, the microcontroller jumps directly to the bootloader address (e.g. \`0x7E00\` for Optiboot) upon reset instead of \`0x0000\`.

#### 3. Unbricking Microcontrollers with Invalid Clock Fuses:
If an ATmega is configured for an external crystal but no crystal is connected, the processor core ceases execution, causing ISP synchronization to fail with \`Expected 0x53, received 0x00\`.
- **The XTAL1 Clock Recovery Fix**: Connect a 1 MHz to 8 MHz square-wave clock source (such as an Arduino \`tone(3, 8000000)\` pin or logic generator) directly to **XTAL1 (Pin 9 on ATmega328P)**. This revives internal clock distribution, allowing the AVR ISP workbench to synchronize and reprogram the Low Fuse to internal RC oscillator mode!
</details>

#### Step-by-Step Tutorial: Burning Optiboot Bootloader onto a Raw ATmega328P
1. Connect your programmer (e.g. Arduino as ISP or USBasp) to the ATmega328P.
2. In Skon's USB Tool, open **Hardware Programmers** -> **AVR ISP**.
3. Click **Sync & Read Signature**:
   - The tool pulses RESET LOW, issues \`0xAC 0x53\`, reads signature bytes, and validates \`0x1E 0x95 0x0F\`.
4. Click **Set Standard Arduino Uno Fuses**:
   - Automatically populates: Low Fuse = \`0xFF\`, High Fuse = \`0xDE\`, Extended Fuse = \`0xFD\`.
   - Click **Write Fuses**: Burns fuse cells and verifies byte readbacks.
5. Click **Load Optiboot Hex** (built-in \`optiboot_atmega328.hex\`).
6. Click **Burn Bootloader & Lock Bits**:
   - Executes chip erase, writes bootloader pages to memory offset \`0x7E00\`, and sets Lock Byte to \`0x0F\` (protecting bootloader space from application overwrites).

---

### 5. Upstream Project & Engineering Attribution

| Tool / Interface | Original Upstream Project / Specification | Authors & Maintainers | License / Reference |
| :--- | :--- | :--- | :--- |
| **CH341A SPI/I2C Engine** | flashrom (universal flash programming utility) | The flashrom Project (Stefan Tauner, Carl-Daniel Hailfinger, Peter Stuge, et al.) & Nanjing Qinheng Microelectronics (WCH) | [flashrom.org](https://flashrom.org) (GPL-2.0) |
| **CMSIS-DAP Debugger** | Arm Cortex Microcontroller Software Interface Standard (CMSIS-DAP / DAPLink) | Arm Limited & Raspberry Pi Ltd (Debug Probe) | [github.com/ARM-software/CMSIS_5](https://github.com/ARM-software/CMSIS_5) (Apache-2.0) |
| **JTAG SVF Player** | IEEE 1149.1 Standard Test Access Port & Serial Vector Format (SVF) | Joint Test Action Group (JTAG) / ASSET InterTech | [IEEE 1149.1 Standard](https://standards.ieee.org) (Open Engineering Standard) |
| **AVR ISP Engine** | AVR In-System Programming (AVR910 / STK500) & avrdude | Atmel Corporation / Microchip Technology Inc., Brian Dean, Joerg Wunsch | [github.com/avrdudes/avrdude](https://github.com/avrdudes/avrdude) (GPL-2.0) |
`
  },
  {
    id: 'usb-pd',
    toolId: 'usb-pd',
    category: 'programmers',
    title: 'USB-PD Power Delivery — PPS Voltage Trigger & VBUS Analyzer',
    summary: 'Negotiate USB-C Power Delivery contracts up to 100W/240W, trigger variable PPS voltages (3.3V-21V), and monitor real-time VBUS power and current draw.',
    tags: ['USB-PD', 'Power Delivery', 'PPS', 'USB-C', 'VBUS', 'Voltage Trigger', 'Power Supply', 'FUSB302'],
    readTime: '20 min read',
    content: `
# USB-PD Power Delivery — Voltage Trigger & Monitor Manual

The **USB-PD Workbench** interfaces with USB Type-C Power Delivery controller hardware (such as the ON Semiconductor FUSB302, WCH CH224K, Ingenic IP2721, or STMicroelectronics STUSB4500) over I2C or serial UART. Sourced directly from the official USB-IF Power Delivery 3.0 specification and \`src/utils/usbPdDriver.js\`, this guide documents Biphase Mark Coding (BMC) negotiation, Power Data Object (PDO) bitfield analysis, Programmable Power Supply (PPS) dynamic voltage requests, and real-time VBUS telemetry logging.

---

### 1. What Is USB-PD & Why Do You Need It?

Legacy USB Type-A ports supply only **5.0 Volts DC** at up to 2.4 Amperes (12 Watts). While sufficient for basic microcontrollers, modern bench testing demands variable voltages to power:
- Single Board Computers (9V or 12V for LattePanda, Orange Pi 5).
- Soldering Irons (20V for Pinecil, TS100, TS80P).
- Battery Charging Circuits (custom 3.3V to 21.0V CC/CV curves for 2S, 3S, 4S Li-ion battery packs).
- High-power radio transmitters and RF amplifiers.

The **USB-PD Workbench** transforms any standard USB-C GaN laptop charger into an intelligent, programmable bench power supply capable of delivering from **5V up to 48V (EPR)** and up to **5 Amperes (100W to 240W)** directly from your web browser without buying dedicated bench lab equipment.

---

### 2. Physical Layer: The Configuration Channel (CC)

USB Power Delivery does not communicate over the D+ and D- data wires. Instead, communication occurs exclusively over the dedicated **Configuration Channel (CC1 / CC2)** pins in the USB Type-C connector:

1. **Cable Orientation Detection**: When a cable is inserted, the charger monitors pull-down resistors ($R_d = 5.1\,\text{k}\Omega$) to detect which CC pin is active (CC1 or CC2). The unselected pin is repurposed to supply $V_{conn}$ (5V @ 1W) to power active E-Marked electronic marker chips inside high-power cables.
2. **BMC (Biphase Mark Coding) Modulation**:
   - Communication operates at a nominal bit rate of **300 kHz** (tolerance: 270 kHz to 330 kHz).
   - Every bit period starts with an electrical transition. A logical \`1\` contains an additional transition in the middle of the bit period; a logical \`0\` has no intermediate transition.
   - This ensures continuous clock synchronization and DC balance regardless of data content.

<details>
<summary>Deep-Dive: SOP Packet Framing, Preamble & Protocol Handshake</summary>

Every USB-PD message is framed by a strict transmission envelope:

\`\`\`text
+----------+---------------+----------------+-------------------+--------------+----------+
| Preamble | Sync-1 Sync-1 | Message Header | Extended / Data   | 32-bit CRC   | EOP /    |
| (64 bits)| Sync-1 Sync-2 | (16 bits)      | Objects (0-7 PDOs)| (Polynomial) | Postamble|
+----------+---------------+----------------+-------------------+--------------+----------+
\`\`\`

#### 1. Start-of-Packet (SOP) Markers:
- **SOP**: Transmits 4 K-codes (\`Sync-1\`, \`Sync-1\`, \`Sync-1\`, \`Sync-2\`). Directs message to port partner.
- **SOP' (SOP Prime)**: \`Sync-1\`, \`Sync-1\`, \`Sync-2\`, \`Sync-2\`. Communicates with the cable's near-end E-Marker chip.
- **SOP'' (SOP Double Prime)**: Communicates with the cable's far-end E-Marker chip.

#### 2. The Power Negotiation State Machine:
1. **Source Capabilities Broadcast**: Upon connection, the power supply broadcasts a \`Source_Capabilities\` message containing an array of 32-bit Power Data Objects (PDOs).
2. **Sink Request**: The tool evaluates the broadcast list, selects the desired voltage/current contract, and transmits a \`Request\` data message referencing the selected PDO index.
3. **Accept**: The power supply responds with an \`Accept\` control message.
4. **Transition & PS_RDY**: The charger ramps its internal DC-DC converter at a controlled slew rate ($30\,\text{mV/ms}$). Once the new voltage stabilizes within the specified $\pm 5\%$ regulation window, the charger transmits a \`PS_RDY (Power Supply Ready)\` message.

</details>

<details>
<summary>Deep-Dive: 32-Bit Power Data Object (PDO) Bitfield Breakdown</summary>

The 32-bit integer transmitted for each supported supply mode defines electrical capabilities with exact mathematical precision:

#### 1. Fixed Supply PDO (Bits 31:30 = 00):
- **Bit 31:30**: \`00b\` = Fixed Supply.
- **Bit 29**: Dual-Role Power (DRP) capability.
- **Bit 28**: USB Suspend Supported.
- **Bit 27**: Unconstrained Power (Wall outlet vs battery).
- **Bit 26**: USB Communications Capable.
- **Bit 25**: Data Role Swap Supported.
- **Bits 19:10**: Voltage in 50 mV increments:
  \`\`\`text
  Voltage (V) = Raw_Value * 0.05
  (Example: 400 * 0.05 = 20.0 Volts)
  \`\`\`
- **Bits 9:0**: Maximum Current in 10 mA increments:
  \`\`\`text
  Current (A) = Raw_Value * 0.01
  (Example: 300 * 0.01 = 3.0 Amperes -> 60 Watts)
  \`\`\`

#### 2. Augmented PPS PDO (Bits 31:28 = 1100):
- **Bits 31:28**: \`1100b\` = Augmented Power Data Object (APDO) / Programmable Power Supply (PPS).
- **Bits 24:17**: Maximum Voltage in 100 mV increments (e.g. \`210 * 0.1 = 21.0 Volts\`).
- **Bits 15:8**: Minimum Voltage in 100 mV increments (e.g. \`33 * 0.1 = 3.3 Volts\`).
- **Bits 6:0**: Maximum Current in 50 mA increments (e.g. \`100 * 0.05 = 5.0 Amperes\`).
</details>

<details>
<summary>Deep-Dive: FUSB302 Controller Hardware Registers & I2C Control</summary>

For hardware builds utilizing the ON Semiconductor **FUSB302B** USB-PD PHY controller over I2C (Address \`0x22\`):

| Register Offset | Register Name | Bitfield Function |
| :---: | :--- | :--- |
| **\`0x01\`** | **DEVICE_ID** | Silicon revision identification (Returns \`0x91\` or \`0x92\`). |
| **\`0x02\`** | **SWITCHES0** | Connects internal BMC transmitter and receiver to CC1 or CC2 pin. |
| **\`0x03\`** | **SWITCHES1** | Configures internal BMC pull-down resistors ($R_d = 5.1\,\text{k}\Omega$). |
| **\`0x07\`** | **RESET** | Resets internal transmit and receive FIFO buffers. |
| **\`0x0A\`** | **MASKA** | Interrupt mask register for SOP detection, CRC errors, and packet arrival. |
| **\`0x43\`** | **FIFOS** | Direct 64-byte burst read/write port for incoming and outgoing USB-PD frames. |

</details>

---

### 3. Interactive Workbench Features

#### 1. 1-Click Fixed Contract Triggers
Click any preset contract button to immediately trigger standard voltages:
- **5.0V**: Safe default for microcontrollers, logic analyzers, and sensors.
- **9.0V**: Ideal for Arduino Uno VIN pins and quick-charge power banks.
- **12.0V**: Standard voltage for automotive sensors, 3.5-inch hard drives, and Wi-Fi routers.
- **15.0V**: Common for audio amplifiers and USB-C monitors.
- **20.0V**: Maximum standard power for Pinecil/TS100 soldering irons and laptop mainboards (up to 100W).

#### 2. Programmable Power Supply (PPS) Variable Slider
For chargers broadcasting an Augmented PPS PDO:
- Adjust voltage smoothly between **3.30V and 21.00V in fine 20mV increments**.
- Adjust current compliance limits in **50mA increments**.
- **Constant Current / Constant Voltage (CC/CV) Simulation**: If target load current exceeds the programmed compliance threshold, the power supply automatically throttles voltage downward to maintain constant current, mimicking an industrial bench supply!

#### 3. Real-Time VBUS Power Telemetry Visualizer
The telemetry HUD samples onboard voltage and current sensors (e.g. INA219, INA226, or internal controller ADCs) at 20 Hz:
- **Voltage Meter (V)**: Calibrated bus voltage displayed with millivolt precision.
- **Current Meter (A)**: Real-time current consumption in amperes.
- **Wattage Gauge (W)**: Instantaneous power delivery ($P = V \times I$).
- **Accumulated Energy (Wh / mAh)**: Continuous integration of power over time, essential for battery capacity profiling and thermal dissipation testing.

---

### 4. Upstream Standards & Engineering Attribution

| Standard / Component | Authoring Organization / Manufacturer | Upstream Specification & Reference |
| :--- | :--- | :--- |
| **USB Power Delivery Specification (PD 2.0 / 3.0 / 3.1)** | USB Implementers Forum (USB-IF) | [USB-IF Power Delivery Specification](https://www.usb.org/usb-charger-pd) |
| **Type-C Cable & Connector Specification** | USB-IF Working Group (CC pin signaling, BMC 300kHz modulation, SOP framing) | [USB Type-C Specification](https://www.usb.org/developers) |
| **FUSB302 / CH224K USB-PD Controller Architecture** | ON Semiconductor / Fairchild & Nanjing Qinheng Microelectronics (WCH) | [onsemi FUSB302 Datasheet](https://www.onsemi.com) |
`
  }
];
