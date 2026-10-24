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
  },
  {
    id: 'alfa-wifi',
    toolId: 'alfa-wifi',
    category: 'hardware',
    title: 'Alfa Wi-Fi Workbench — RTL8812AU WebUSB Engineering Manual',
    summary: 'Browser-native monitor mode and frame capture for Realtek RTL8812AU chipsets using WASM and WebUSB.',
    tags: ['WebUSB', 'WASM', 'RTL8812AU', '802.11', 'Monitor Mode'],
    readTime: '25 min read',
    content: `
# Alfa Wi-Fi Workbench — WebUSB & RTL8812AU Manual

### 1. What Is This Tool & Why Do You Need It?
This tool bypasses the operating system's native Wi-Fi drivers using the WebUSB API. It loads a Rust-based WASM driver (\`@openipc-rs/web\`) to interface directly with the Alfa AWUS036ACH (RTL8812AU chipset), allowing for raw 802.11 frame capture (monitor mode) directly in the browser.

### 2. Hardware Architecture & Physics / Protocol Theory
<details>
<summary>Deep Dive: WebUSB, WinUSB, and Firmware Loading</summary>
Browsers cannot access USB Wi-Fi adapters if the host OS claims them. Windows users MUST replace the vendor driver with WinUSB using Zadig. The WASM driver uploads the proprietary Realtek firmware to the device's RAM, initializes the MAC/BB/RF registers, and then initiates raw RX bulk transfers.
</details>

<details>
<summary>Deep Dive: Understanding 802.11 Frame Parsing & Radiotap Architecture</summary>

Raw bulk RX transfers from the RTL8812AU arrive encapsulated in a **Radiotap Header** followed by standard **IEEE 802.11 MAC frames**:

1. **Radiotap Header Anatomy**:
   - \`Byte 0\`: Version (\`0x00\`).
   - \`Byte 1\`: Padding / alignment flag.
   - \`Bytes 2-3\`: \`it_len\` (Total Radiotap length in little-endian uint16). The 802.11 payload begins precisely at offset \`it_len\`.
   - \`Bytes 4-7\`: \`it_present\` bitmask indicating telemetry fields.
     - **Bit 3**: Channel frequency in MHz (e.g. 2412 for CH 1, 5180 for CH 36).
     - **Bit 5**: Antenna signal strength in dBm (\`int8\`, e.g. -45 dBm).

2. **802.11 MAC Header & Frame Control**:
   - \`Bytes 0-1\`: Frame Control field.
     - **Type**: Bits 2-3 (\`00\` = Management, \`01\` = Control, \`10\` = Data).
     - **Subtype**: Bits 4-7 (\`1000\` = Beacon, \`0101\` = Probe Response, \`0100\` = Probe Request).
   - \`Bytes 4-9\`: Destination / Receiver MAC address (Broadcast \`FF:FF:FF:FF:FF:FF\` for Beacons).
   - \`Bytes 10-15\`: Transmitter / Source MAC address.
   - \`Bytes 16-21\`: **BSSID** (Basic Service Set Identifier, uniquely identifying the Access Point radio).

3. **Management Frame Body & Tagged Parameters (IEs)**:
   - Following 12 bytes of fixed parameters (Timestamp, Beacon Interval, Capability Info) in Beacons and Probe Responses, the frame delivers variable-length tagged parameters:
     - \`Tag 0 (SSID)\`: Network name string. A tag length of 0 represents a **Hidden SSID**.
     - \`Tag 3 (DS Parameter Set)\`: 1-byte operational channel number (1–14 for 2.4 GHz).
</details>

### 3. Complete UI Control Mapping
| UI Element | Type | Purpose & Behavior |
| :--- | :--- | :--- |
| Connect via WebUSB | Button | Prompts the browser's native USB device picker. |
| Simulate RF | Toggle | Injects synthetic 802.11 frames for testing without hardware. |
| Channel Dropdown | Select | Configures the hardware's center frequency (1-165). |
| Auto-Hop Channels | Checkbox | Automatically cycles channel through 1, 6, 11, 36, 40, 44, 48 every 500ms. |
| Pause / Resume | Button | Freezes packet ingestion buffer without tearing down the USB interface. |
| Export PCAP | Button | Downloads raw 802.11 packet buffer as a Wireshark-compatible PCAP file. |
| Export Wigle CSV | Button | Generates WigleWifi-1.4 formatted CSV for wardriving and Wigle.net uploads. |
| Export JSON | Button | Serializes the aggregated BSSID and Client directory into a downloadable JSON file. |
| Probing Clients | Tab View | Identifies client stations broadcasting Probe Requests seeking specific network SSIDs. |
| Spectrum Tab | Tab View | Bar chart visualizer displaying real-time packet density and congestion across RF channels. |
| Topology View | Tab View | Interactive SVG graph rendering physical relationships, parent APs, orbiting client stations, and encryption security colors. |
| Signal Trend | Column | Real-time SVG sparkline visualizer tracking the last 15 RSSI data points per transmitter. |
| Handshake | Column | Shows green lock indicator when a complete WPA/WPA2 4-way handshake (or M1+M2) is captured. |
| GPS Tagging | Toggle | Hooks browser Geolocation API (\`navigator.geolocation.watchPosition\`) to tag discovered devices with latitude, longitude, and accuracy. |
| Distance | Column | Displays real-time Haversine distance (in meters) from operator GPS fix to the Access Point. |
| Device Table | Tab View | Live diagnostic table listing BSSID, SSID, Handshake status, RSSI, channel, distance, and vendor. |
| Save Session | Button | Serializes and persists current AP, client, channel, and packet buffers to browser IndexedDB store. |
| Load Session | Button | Opens modal interface to hydrate state from historical IndexedDB capture sessions. |
| Anomalies | Tab View | Surfaces suspected device identity rotation anomalies where multiple MACs probe identical SSID sequences. |
| Signal Map | Tab View | Plots physical GPS coordinates and RSSI signal strength heatmaps using Leaflet and vector overlays. |
| Waterfall | Tab View | Real-time canvas-based RF spectrum waterfall showing rolling channel packet density over time. |
| Signature | Column | Displays extracted Information Element (IE) Tag sequence and flags potential MAC randomization. |
| Posture Score | Header Gauge | Circular visualizer calculating environment health (0-100) based on open APs, legacy ciphers, and threat anomalies. |
| Cleartext | Tab View | Monitors observable DNS query domains (UDP 53) and HTTP endpoints (TCP 80) from unencrypted Data frames. |
| Executive Report | Button | Generates and exports a styled standalone HTML audit report of the RF environment. |
| Roaming Tab | Tab View | Dedicated mobility audit table tracking client handoffs, source/destination BSSIDs, and roam latency (ms). |
| Upload PCAP | Button | Ingests offline .pcap binary capture files and replays raw frames through the background Web Worker. |
| Wi-Fi 6 Badge | Badge | Blue pill indicating 802.11ax High-Efficiency capabilities and spatial reuse BSS Color. |




### 4. Step-by-Step Engineering Walkthroughs
#### Walkthrough A: Getting Hardware Access on Windows
1. Download **Zadig**.
2. Select your Alfa adapter.
3. Replace the driver with **WinUSB**.
4. Refresh the tool and click "Connect".

#### Walkthrough B: Analyzing Captures in Wireshark
1. Click **Export PCAP** in the action bar to download your raw packet stream.
2. Open the resulting \`.pcap\` file directly in **Wireshark**.
3. Wireshark automatically recognizes **LinkType 127 (\`LINKTYPE_IEEE802_11_RADIOTAP\`)**:
   - Inspect full radio physical metrics (dBm RSSI, channel frequency, channel bandwidth, and data rates) decoded in the Radiotap layer.
   - Filter for handshakes using display filter \`eapol\` to locate WPA2/WPA3 4-way key exchanges.
   - Filter for beacon frames using \`wlan.fc.type_subtype == 0x08\` to analyze vendor-specific Information Elements.

### 5. Wireless Intrusion Detection (WIDS) & Threat Detection
The workbench includes automated real-time WIDS heuristics designed to catch active Wi-Fi jamming and rogue deauthentication attacks:
- **Deauth & Disassociation Inspection**: The parser monitors 802.11 Management frames with Subtype \`12\` (Deauth) and Subtype \`10\` (Disassoc).
- **Reason Code Extraction**: Inspects the 2-byte body payload to extract the deauthentication reason (e.g. Code 7: *Class 3 frame received from nonassociated station*, typically generated by automated deauth tools like \`aireplay-ng\` or ESP8266 deauthers).
- **Sliding-Window Threshold**: When $\ge 10$ Deauth events strike within a rolling 5,000ms window, the tool sounds an immediate high-priority visual alarm, flagging the targeted Client Station MAC and the spoofed AP BSSID.

### 6. Local OUI Vendor Lookup & Reconnaissance
Hardware identification is accelerated via an offline, in-memory IEEE Organizationally Unique Identifier (OUI) database:
- **Prefix Extraction**: Strips colons, hyphens, and spaces from 48-bit MAC addresses and indexes the initial 24 bits (first 3 bytes, e.g. \`00:1A:11\` $\rightarrow$ \`Google\`, \`3C:22:FB\` $\rightarrow$ \`Apple\`, \`24:6F:28\` $\rightarrow$ \`Espressif\`).
- **Zero Network Overhead**: Performs zero external HTTP queries, keeping sensitive RF reconnaissance completely offline and local.
- **Deep Table & Detail Panel Integration**: Surfaces vendor intelligence directly in AP and Client tables, enabling instant identification of IoT microcontrollers (ESP32, Tuya), consumer smartphones, and enterprise APs.

### 7. Memory Safety & PCAP Ring Buffer Architecture
Long capture runs in high-density RF environments can capture tens of thousands of frames per minute, posing severe browser heap exhaustion risks:
- **50,000 Frame Strict Ring Buffer**: The raw packet buffer for PCAP export acts as a strict circular ring buffer capped at 50,000 frames. When capacity is reached, the oldest frames are systematically shifted out to keep heap usage bounded and stable.
- **Buffer Full Alert**: A dedicated amber notification banner warns the user when the 50,000-frame ceiling is reached, providing one-click access to download the capture as a \`.pcap\` file before oldest frames rotate out.
- **Adaptive UI State Throttling**: When the discovered device count exceeds 200 nodes, the React state flush timer automatically switches from 500ms to 1500ms, decoupling high-throughput USB bulk packet processing from DOM rendering.
- **Windowed Table Pagination**: Tables slice visible rows into pages of 100 entries with previous/next controls, preventing virtual DOM recalculation lag even with 500+ active transmitters.

### 8. Capturing WPA Handshakes (EAPOL 4-Way Key Exchange)
The workbench includes a dedicated WPA/WPA2/WPA3 4-way handshake detection engine:
- **Frame Identification**: Inspects 802.11 Data frames (Frame Control Type 2) searching for the LLC/SNAP encapsulation header (EtherType \`0x888E\`).
- **Key Information Bitmask Decoding**: Decodes the 2-byte EAPOL-Key Information field to track the cryptographic handshake sequence:
  - **M1 (AP $\rightarrow$ Client)**: Authenticator sends ANonce (\`isPairwise && isAck && !isMic\`).
  - **M2 (Client $\rightarrow$ AP)**: Supplicant replies with SNonce + MIC (\`isPairwise && !isAck && isMic\`).
  - **M3 (AP $\rightarrow$ Client)**: Authenticator sends GTK + MIC (\`isPairwise && isAck && isMic && isInstall\`).
  - **M4 (Client $\rightarrow$ AP)**: Supplicant confirms handshake completion (\`isPairwise && !isAck && isMic\`).
- **Complete Handshake Determination**: Capturing M1 and M2 contains the cryptographic nonces (ANonce, SNonce) and Message Integrity Check (MIC) required for offline Pairwise Master Key (PMK) / PSK verification in tools like \`hashcat\` or \`aircrack-ng\`. Once both M1 and M2 are captured for an AP-Client pair, the tool flags the pair as a **Complete Handshake**.
- **Audio & Visual Alerts**: Upon capturing a verified handshake pair, the workbench triggers a green status banner, plays an alert chime via the Web Audio API, and displays a green lock icon in the Access Point table.

### 9. RF Spectrum & Channel Utilization Visualizer
The **Spectrum** tab provides an interactive bar chart of channel packet density across 2.4 GHz and 5 GHz bands:
- **Packet Density Tracking**: Continuously tallies frame counts per channel (\`channelStatsRef\`) without impacting frame capture throughput.
- **Spectrum Band Filtering**: Toggle between **All Channels**, **2.4 GHz (Channels 1–14)**, and **5 GHz (UNII Channels 36–165)**.
- **Congestion KPI Metrics**: Displays Total Logged Packets, Peak Congestion Channel, and an automated **Recommended Channel** recommendation based on the lowest observed packet density across non-overlapping channels.
- **Interactive Click-to-Retune**: Clicking any channel bar on the spectrum graph immediately retunes the Alfa radio hardware or simulated RF engine to that channel.
- **Optimal Channel Selection**:
  - **2.4 GHz**: Select non-overlapping channels \`1\`, \`6\`, or \`11\` to avoid adjacent channel interference.
  - **5 GHz**: UNII-1/UNII-3 channels (\`36-48\` and \`149-165\`) offer up to 80 MHz channel widths with lower interference from consumer electronics.

### 10. Detecting Evil Twins (Rogue Access Points)
The workbench actively monitors for Evil Twin attacks where an attacker broadcasts a legitimate network's SSID to intercept client credentials:
- **Multi-BSSID Clustering**: Automatically clusters discovered APs by normalized SSID, distinguishing between legitimate enterprise roaming meshes and malicious duplicates.
- **Encryption Downgrade Heuristic**: If two APs broadcast the same SSID but one offers \`WPA2\` while the duplicate is \`Open\` (or WEP), the duplicate is flagged as an active credential-harvesting rogue captive portal.
- **Vendor OUI Discrepancy Heuristic**: If multiple APs broadcast the same SSID but their hardware OUIs point to wildly conflicting vendors (e.g. \`Cisco\` vs \`Espressif\` / ESP32 WiFi Pineapple clones), the duplicate is flagged as a hardware imposter.
- **Visual Alerting**: Surfaces high-visibility amber warning banners and displays a **Rogue Suspect** pill badge directly in the AP table and inspection side-panel.

### 11. Browser Geolocation & Live Wardriving GPS Tagging
The workbench features native browser geolocation logging using the W3C Geolocation API:
- **Real-Time GPS Watcher**: When **GPS Tagging** is toggled on in the header, the engine registers an active listener via \`navigator.geolocation.watchPosition()\`, receiving continuous updates with high accuracy enabled.
- **Zero-Latency In-Memory Tagging**: As 802.11 frames arrive over WebUSB, newly discovered Access Points and Client Stations are stamped with the operator's current \`latitude\`, \`longitude\`, \`accuracy\`, and \`altitude\`.
- **Haversine Distance Estimation**: When GPS is active, the AP table calculates the approximate line-of-sight distance in meters between the operator and each discovered transmitter using the Haversine formula:
  $$\Delta\sigma = 2\arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)}\right)$$
  $$d = R \cdot \Delta\sigma \quad (R = 6,371,000\text{ m})$$
- **Standardized Wigle CSV Export**: When clicking **Wigle CSV**, the exporter populates the \`CurrentLatitude\`, \`CurrentLongitude\`, and \`AccuracyMeters\` columns with tagged coordinates (defaulting to \`0.0\` / \`0\` if GPS is disabled), producing fully compliant WigleWifi-1.4 files ready for upload.

### 12. Interactive Network Topology Map (Map View)
The **Topology** tab renders a real-time vector relationship graph showing the physical and operational structure of the RF environment:
- **AP & Client Clustering**: Parent Access Points are anchored centrally, with associated Client Stations orbiting each AP. Unassociated probing stations orbit along the outer perimeter.
- **Association Vector Links**: Dashed SVG vector links connect each active station MAC to its target BSSID, highlighting in vibrant cyan/indigo when selected or hovered.
- **Security Color Coding**:
  - **Green (\`#10b981\`)**: WPA3 Secure (SAE authenticated meshes).
  - **Yellow (\`#eab308\`)**: WPA2 / WPA Standard encryption.
  - **Red (\`#ef4444\`)**: Open / Insecure networks.
- **Deep Inspection Side-Panel Integration**: Clicking any node immediately displays comprehensive hardware telemetry, vendor OUI, RSSI history sparkline, and GPS coordinates in the right inspector drawer.
- **High-Density Safeguard**: If more than 50 total nodes are tracked simultaneously, the topology engine displays a safety banner and provides a one-click return to the paginated table view, preventing browser redraw stalls.

### 13. Offline Data Persistence Engine (IndexedDB Architecture)
Long-duration RF auditing sessions (12+ hours) can capture hundreds of thousands of frames and discover thousands of BSSIDs, leading to potential browser heap limits or tab crashes if kept purely in ephemeral React memory:
- **IndexedDB Schema & Store**: The persistence engine initializes a dedicated IndexedDB database (\`skons_wifi_persistence_db\`) with an object store named \`capture_sessions\` keyed by \`id\` and indexed by \`timestamp\`.
- **Asynchronous Serialization**: When clicking **Save Session** or triggering auto-save, the utility asynchronously writes the complete session state—including AP telemetry, client stations, channel utilization statistics, and raw frame buffers—directly to local browser disk storage.
- **Instant State Hydration**: The **Load Session** modal lists historical captures with timestamp, node counts, and packet totals. Selecting a session hydrates the active workbench state instantaneously without requiring hardware reconnection.
- **Offline Reliability**: Persisted sessions remain intact across browser restarts, page refreshes, and power outages.

### 14. Identity Anomaly Tracking (MAC Randomization & Probe Fingerprinting)
To protect user privacy and prevent physical tracking, modern client devices (Apple iOS, Android 10+, Windows 11) periodically rotate and randomize their hardware 802.11 MAC addresses (using locally administered address bit 1):
- **Behavioral Fingerprinting**: While hardware identifiers rotate, a device's internal Preferred Network List (PNL) remains constant. Devices continuously transmit Probe Requests looking for their configured home, office, and preferred networks.
- **Ordered Sequence Correlation**: The anomaly tracking engine groups stations broadcasting identical sequences of probed SSIDs (\`probedSsids\`). If two or more distinct MAC addresses broadcast the exact same probe sequence within a sliding time window (10 minutes), they are correlated and flagged as a **Potential Identifier Rotation Anomaly**.
- **OUI Discrepancy & Vendor Profiling**: Correlated MACs are analyzed against the offline IEEE OUI lookup table, identifying whether the device rotates within standard randomized bit ranges or mimics known vendor hardware.
- **Anomalies View**: The dedicated **Anomalies** tab displays all flagged rotating clusters, showing observed MACs, vendor OUIs, signal strength (RSSI), and the shared probe request sequence.

### 15. Spatial Signal Mapping & Physical RSSI Heatmaps
The **Signal Map** workbench integrates GPS coordinates with RF signal strength measurements to generate real-time spatial coverage maps:
- **Spatial Data Correlation**: When GPS Tagging is enabled, each captured 802.11 beacon or frame ties the transmitter's received signal strength (RSSI) to physical coordinates (latitude, longitude, accuracy).
- **Semi-Transparent Heatmap Overlays**: Renders circular heatmap regions anchored to the physical location where the access point was detected, with radius scaled according to GPS accuracy:
  - **Emerald Green (\`> -60 dBm\`)**: Strong signal / immediate physical proximity.
  - **Amber Yellow (\`-75 dBm to -60 dBm\`)**: Moderate signal / intermediate boundary.
  - **Rose Red (\`< -75 dBm\`)**: Weak signal / edge of radio reception.
- **Target AP Filtering**: A top toolbar dropdown allows isolating a single target BSSID or viewing all geotagged access points concurrently.
- **Leaflet & Vector Themes**: Supports high-contrast CartoDB Dark Matter tiles and OpenStreetMap standard layers with smooth recentering and interactive popup inspection.

### 16. Undisclosed Identity Correlation & Client Signature Profiling
Many 802.11 Access Points conceal their Service Set Identifier (SSID) in periodic Beacon broadcasts, reporting an empty or null string (\`<Hidden SSID>\`). However, 802.11 client devices looking for or associating to these hidden networks must explicitly transmit the SSID in cleartext inside:
- **Probe Requests (Discovery Queries, Subtype 4)**: Directed client discovery queries targeting a specific network name.
- **Association Requests (Subtype 0) & Reassociation Requests (Subtype 2)**: Client station connection requests addressed directly to the AP's BSSID.

The **Identity Correlation Engine** listens continuously for client discovery and association frames:
- **Cross-Reference Resolution**: When a client transmits a Probe Request or Association Request containing a valid cleartext SSID targeting an AP known in state to have a hidden or undisclosed SSID, the engine cross-references the destination BSSID.
- **Dynamic State Unmasking**: The AP record is updated to display the discovered SSID, marked with a lock icon and an \`(Unmasked)\` badge, preserving visibility into which networks were originally hidden.
- **Client Information Element (IE) Signature Profiling**: Management frames carry a specific sequence of Information Element (IE) Tag IDs (e.g. Supported Rates \`1\`, DS Channel \`3\`, HT Capabilities \`45\`, Extended Rates \`50\`, Extended Capabilities \`127\`, VHT Capabilities \`191\`, Vendor Specific \`221\`).
- **MAC Randomization Detection**: Operating systems that randomize their MAC addresses retain identical Wi-Fi hardware and software stack capabilities. By concatenating and tracking the sequence of Tag IDs as a signature string (\`"1,50,3,45,127,191,221"\`), the workbench correlates distinct hardware addresses broadcasting the identical signature within a 10-minute window, flagging them as **Potential Randomization**.

### 17. Real-Time Spectrum Waterfall Visualization (RF Spectrogram)
The **Waterfall** tab provides a real-time rolling spectrogram visualizer for monitoring RF channel congestion, intermittent transmissions, and spectrum interference over time:
- **High-Frequency Sampling**: Samples packet density per channel (Channels 1–165) every 100 milliseconds via a high-frequency asynchronous reference buffer (\`waterfallCountsRef\`).
- **Canvas-Accelerated Spectrogram**: Utilizes HTML5 2D canvas rendering with double-buffering for fluid 60 FPS performance without React re-render overhead:
  - **Y-Axis**: Frequency channels across 2.4 GHz and 5 GHz UNII bands with highlighted current tuned channel.
  - **X-Axis**: Time progression scrolling smoothly from right (newest / 0s) to left (historical / -20s).
  - **Color-Coded Density Colormap**: Maps frame density from deep blue (low traffic) through cyan, emerald green, and amber to crimson red/white (high congestion / channel jamming).
- **Interactive Controls**: Supports band filtering (**All Channels**, **2.4 GHz**, **5 GHz**), time freezing for packet analysis, and history clearing.

### 18. Environment Posture Scoring Engine
The workbench features an automated **Environment Posture Engine** that continuously evaluates the overall security hygiene of the local RF airspace on a scale of **0 to 100**:
- **Baseline Posture Score**: Starts at a perfect baseline score of \`100\` (Grade A+).
- **Deduction & Penalty Heuristics**:
  - **Open (Unencrypted) Networks (-15 pts each)**: Heavily penalized due to cleartext transmission risks, packet injection vulnerabilities, and susceptibility to adversary snooping.
  - **Legacy Encryption (-10 pts each)**: Medium penalty for Access Points relying on obsolete, cryptographically compromised ciphers (WEP, WPA1, or TKIP).
  - **Generic / Factory Default SSIDs (-5 pts each)**: Light penalty for default SSIDs (\`linksys\`, \`NETGEAR\`, \`default\`, \`setup\`, \`dlink\`, \`tp-link\`) that expose default administrative router credentials and WPS vulnerabilities.
  - **Threat & Identity Anomalies (-10 pts each)**: Medium penalty for each detected Rogue AP (Evil Twin duplicate) or MAC address rotation anomaly.
- **Score Classification & Visual Gauge**:
  - **90–100 (Grade A / Optimal)**: Displayed with an emerald green circular gauge.
  - **70–89 (Grade B/C / Warning)**: Displayed with an amber yellow circular gauge indicating elevated risk.
  - **< 70 (Grade D/F / Critical)**: Displayed with a crimson red circular gauge warning of widespread exposure or hostile activity.

### 19. Cleartext Telemetry Metadata Extraction (DNS & HTTP)
Unencrypted 802.11 Data frames (Frame Control Type 2, Protected bit 14 = 0) transmit Layer 3/4 payload packets over the air in cleartext:
- **LLC/SNAP & IPv4 Header Decapsulation**: Bypasses the 802.11 MAC header (24 bytes, or 26 bytes for QoS Data) and unpacks the 8-byte LLC/SNAP header (\`0xAA 0xAA 0x03 0x00 0x00 0x00 0x08 0x00\`) to access the IPv4 packet payload.
- **UDP Port 53 (DNS Query Extraction)**: Inspects the DNS Question Section, decoding length-prefixed domain labels (e.g. \`\\x06google\\x03com\\x00\` $\rightarrow$ \`google.com\`).
- **TCP Port 80 (HTTP Request Extraction)**: Inspects standard HTTP stream buffers, extracting the target Host header (\`Host: <domain>\`) and HTTP endpoint path (\`GET /path\`).
- **Privacy Boundary**: Operates in passive diagnostic mode; extracts strictly observable network routing destinations (domain names and endpoint paths) without buffering, inspecting, or storing user payload contents or credentials.
- **Dedicated Telemetry View**: Surfaces requests in the **Cleartext** tab, detailing timestamp, protocol, requesting client station MAC, target AP BSSID, channel, and RSSI.

### 20. Executive Summary Reporting & HTML Export
Auditing dense corporate or industrial Wi-Fi environments requires executive-ready reporting that translates low-level 802.11 frame telemetry into actionable security intelligence:
- **Standalone Single-File HTML Reports**: When clicking **Executive Report** in the action bar, the generator compiles all session metrics into a self-contained, beautifully styled HTML document.
- **Executive Scorecard & Risk Triage**: Prominently highlights the overall Environment Posture Score, Risk Level badge, and specific security penalties.
- **Infrastructure Inventory & Top 10 APs**: Details the 10 strongest Access Points ranked by RSSI, including encryption standards, channel allocation, handshake capture status, and vendor OUIs.
- **Threat Anomaly Ledger**: Records all identified Rogue AP Evil Twins, conflicting encryption mesh duplicates, and MAC rotation clusters.
- **Offline Portability**: The report contains zero external stylesheet or script dependencies, rendering instantly in any web browser or printable as a PDF.

### 21. Web Worker Thread Architecture (High-Throughput Offloading)
In dense RF environments with multiple access points and active client devices, the adapter can receive thousands of 802.11 frames per second. Parsing variable-length Radiotap headers, IEEE 802.11 MAC headers, Information Element (IE) tag sequences, and cleartext payloads on the main JavaScript execution thread causes significant UI lag and frames to drop:
- **Dedicated Parser Worker**: The parsing subsystem is isolated in a background Web Worker (\`src/workers/parserWorker.js\`). Raw binary \`Uint8Array\` frame buffers received over WebUSB (\`radio.readRxTransfer\`) are posted directly to the worker thread without blocking the browser's DOM rendering cycle.
- **200ms Batch Ingestion Pipeline**: Rather than posting individual messages for every packet, the worker aggregates structured JSON frame records and posts them to the main thread in batches every 200 milliseconds (\`BATCH_PARSED\`). This decouples packet processing from React component reconciliation.
- **Lifecycle & Cleanup**: The worker instance is cleanly managed with automatic termination (\`worker.terminate()\`) upon adapter disconnection, interface teardown, or workbench component unmount.

### 22. Target Watchlist & Offline Device Tracking
Surveillance and diagnostic workflows require operators to focus on specific high-priority hardware targets without getting lost in environmental radio noise:
- **Star (⭐) Pinning System**: Users can click the Star icon in the first column of either the Access Points or Clients table to add or remove any BSSID or station MAC address from the persistent target watchlist.
- **LocalStorage Persistence**: Watchlist configurations are saved immediately to \`localStorage\` under \`alfa_wifi_watchlist\`, preserving surveillance lists across browser sessions and reboots.
- **Dedicated Watchlist Tab**: The **Watchlist** tab aggregates all pinned access points and client stations into a single prioritized interface, including targets awaiting initial detection.
- **Offline Inactivity Alerts (>60s)**: If a target on the watchlist is not observed transmitting for more than 60 seconds, its row is highlighted in red with an animated **Missing (>60s)** badge, alerting operators to potential target departure, signal shielding, or power-off events.

### 23. Mixed-Mode Profile Detection (WPA2/WPA3 Downgrade Vector)
Many modern Wi-Fi routers operate in "WPA2/WPA3 Mixed Mode" for backwards compatibility with legacy devices that do not support 802.11w Protected Management Frames (PMF) or Simultaneous Authentication of Equals (SAE):
- **RSN Information Element Parsing (Tag 48)**: The parser inspects the Authentication and Key Management (AKM) suite selectors in Tag 48.
- **Simultaneous PSK & SAE Detection**: If the Beacon or Probe Response frame advertises both WPA2 (PSK, AKM suite type 2 or 6) and WPA3 (SAE, AKM suite type 8 or 9) concurrently, the network is flagged as a Mixed-Mode deployment.
- **Security Implications**: Mixed Mode allows an attacker to launch downgrade attacks against connected stations, forcing them to negotiate WPA2 4-way handshakes vulnerable to offline dictionary cracking.
- **Visual Alerting**: In the Access Points table, networks operating in Mixed Mode display a yellow warning shield icon (\`ShieldAlert\`) with a tooltip warning: *"Mixed-Mode Encryption (WPA2/WPA3)"*.

### 24. Roaming Profile Engine (802.11k/v/r Enterprise Fast BSS Transition)
Enterprise WLAN architectures rely on IEEE 802.11 amendment extensions to facilitate seamless, low-latency roaming for mobile client stations without dropping active VoIP or streaming sessions:
- **802.11k (Radio Resource Measurement - Tag 70)**: Discovered via Information Element Tag 70 (\`RM Enabled Capabilities\`). Provides client devices with neighbor reports and channel load metrics, reducing scanning latency by directing stations to the best candidate BSSID before signal degradation occurs.
- **802.11v (Wireless Network Management - Tag 127)**: Discovered via Information Element Tag 127 (\`Extended Capabilities\`, bit 19 / octet 3 bit 3). Implements BSS Transition Management, enabling the infrastructure to request or advise a client to steer toward an optimal access point or frequency band (band steering).
- **802.11r (Fast BSS Transition - Tag 54)**: Discovered via Information Element Tag 54 (\`Mobility Domain\`). Pre-negotiates PMK-R1 keys before reassociation, reducing 4-way handshake re-authentication overhead from >100ms down to <10ms ("fast roaming").
- **Visual Pill Badges**: Access points supporting any of these extensions display green indicator badges (\`k\`, \`v\`, \`r\`) in the Roaming column with hover tooltips detailing each protocol's technical role.

### 25. Baseline Diffing & Event-Driven Desktop Alerts
RF site surveys and continuous airspace surveillance require rapid identification of newly introduced rogue devices and immediate alerting when critical assets drop off the air:
- **Reference Baseline Snapshots**: Operators click **Save Baseline** to record an instantaneous snapshot of all active APs and Client STAs in local storage, capturing hardware identifiers, SSIDs, and initial detection timestamps.
- **Compare Mode (Show New Since Baseline)**: Activating the toggle filters the display tables to show exclusively new hardware discovered after the baseline snapshot was saved. Newly discovered devices are highlighted with a distinct purple border accent and a **NEW** badge.
- **Watchlist Inactivity Alarms (>60s)**: If a target pinned to the Watchlist ceases transmitting telemetry for over 60 seconds, a desktop notification is dispatched (\`Device Missing: Watchlist device [MAC/Vendor] is no longer in range.\`).
- **WIDS Telemetry Intrusion Alerts**: When management frame anomaly thresholds are breached (e.g., 10+ deauth/disassoc frames within 5 seconds), the system triggers an \`Anomaly Detected: Unusual volume of link-state frames detected.\` notification.
- **Spam Throttling**: A 60-second cooldown window is strictly enforced per event and device key, preventing browser alert flooding during high-volume anomaly storms.

### 26. Physical Layer Signal Integrity & Signal-to-Noise Ratio (SNR)
Raw Received Signal Strength Indication (RSSI) alone does not convey the full fidelity of an RF link; an AP transmitting at -50 dBm in an environment with -55 dBm ambient RF interference will experience severe frame loss:
- **Radiotap Header Telemetry**: The parser inspects the Radiotap \`it_present\` bitmask for Antenna Signal (bit 5 / \`0x0020\`, signed int8) and Antenna Noise Floor (bit 6 / \`0x0040\`, signed int8).
- **SNR Calculation**: When both physical layer parameters are provided by the hardware NIC, the engine calculates:
  \`SNR (dB) = RSSI (dBm) - NoiseFloor (dBm)\`
- **Signal Integrity Tiers & Color Coding**:
  - **Excellent (> 25 dB, Green)**: Negligible frame loss, capable of maximum modulation coding schemes (MCS 8/9/11 with 256-QAM or 1024-QAM).
  - **Fair (15 - 25 dB, Yellow)**: Moderate throughput, occasional MAC retries, adequate for standard web browsing and VoIP.
  - **Poor (< 15 dB, Red)**: Severe interference, high frame error rates (FER), packet retransmissions, and high disconnection probability.

### 27. Management Frame Protection (IEEE 802.11w / MFP)
Legacy 802.11 networks transmit management frames (such as Deauthentication, Disassociation, and Action frames) in cleartext without cryptographic message integrity checks, leaving clients vulnerable to trivial link-state spoofing attacks:
- **RSN Capabilities Extraction (Tag 48)**: Inside the Robust Security Network Information Element (Tag 48), the engine reads the 2-byte \`RSN Capabilities\` field immediately succeeding the AKM suite list.
- **Bitwise Capability Evaluation**:
  - **MFP Capable (Bit 6 / \`0x0040\`)**: The AP supports Protected Management Frames (PMF) using AES-128-CMAC / BIP (Broadcast Integrity Protocol) if negotiated by the station.
  - **MFP Required (Bit 7 / \`0x0080\`)**: The AP strictly mandates 802.11w for all associations, rejecting legacy non-MFP clients.
- **Visual Shield Badging**: In the Access Points table, networks advertising MFP display an emerald shield icon (\`ShieldCheck\`) with hover tooltips detailing *"802.11w MFP Supported"* or *"802.11w MFP Required"*, verifying resistance to deauthentication flood attacks.

### 28. Historical Timeline Replay & Session Scrubbing
Forensic analysis of prolonged capture sessions requires reviewing how the RF airspace evolved over time rather than examining an aggregated static snapshot:
- **Session Range Calculation**: When loading a session from IndexedDB (\`localDataStore.js\`), the engine computes the global \`startTime\` and \`endTime\` across all recorded devices and clients using their \`firstSeen\` and \`lastSeen\` timestamps.
- **Interactive Scrubber Slider**: A range slider (\`<input type="range">\`) allows operators to scrub smoothly across the session timeline, displaying the current scrubber timestamp and elapsed relative offset (\`+X seconds\`).
- **Dynamic Time Filtering**: As the slider moves, both Access Point and Client Station tables filter dynamically to display exclusively devices active at that exact temporal instant:
  \`device.firstSeen <= currentSliderTime && device.lastSeen >= currentSliderTime\`
- **10x Playback Simulation**: Operators can click **Play (10x Speed)** to run an automated playback loop that advances the scrubber forward at 10x real-world speed, watching networks appear, roam, and depart in real time.

### 29. Enterprise Infrastructure Clustering & MAC Sequential Addressing
Large enterprise Wi-Fi installations (e.g. Cisco Catalyst, Aruba, Ubiquiti UniFi, Ruckus) deploy multiple dual-band access points with consecutive factory-provisioned BSSIDs. Scanning dense environments produces hundreds of separate rows that represent different radios of the same physical access point chassis or neighboring ceiling nodes:
- **Sequential Addressing Heuristics**: The clustering engine (\`clusterInfrastructure\`) analyzes 48-bit MAC addresses and binds nodes into single cluster groups when:
  1. **5-Byte Identical Prefix**: The first 5 octets of the MAC address match identically (e.g., \`00:11:22:33:44:01\` and \`00:11:22:33:44:FE\`), typical for multi-SSID virtual BSSIDs broadcast from the same physical radio.
  2. **OUI Match & Sequential Proximity**: Devices share an identical 24-bit OUI (first 3 octets) and their 24-bit NIC integer address difference is within a configurable sequential delta (default \`±5\`).
- **Union-Find Disjoint Sets**: Disjoint-set forest data structures efficiently resolve transitive groupings across multi-radio access points without duplicate cluster generation.
- **Hierarchical Table Aggregation**: Operators can toggle **Group Clusters** in the Access Points view to collapse dense infrastructure clusters under unified master rows (e.g. *"Cisco - Node Group (4 APs)"*) with single-click expansion to inspect individual member BSSIDs.

### 30. RF Sensitivity Tuning & Real-Time RSSI Thresholding
In high-density environments or when targeting a specific proximate transmitter, distant ambient packets clutter the diagnostic display and generate unnecessary rendering work:
- **Dual-Layer Threshold Filtering**: The RF Sensitivity Threshold slider allows continuous adjustment from **-100 dBm** (*Show Everything / Deep Noise Floor*) to **-50 dBm** (*Strong Signals Only / Immediate Proximity*).
- **Web Worker Offload Filtering**: When adjusted, the threshold is passed via \`SET_THRESHOLD\` to \`parserWorker.js\`. Weak signals below the threshold are pruned immediately within the background thread before entering React state queues, minimizing IPC memory transfer overhead.
- **Client Table Pruning**: The reactive state filters both Access Point and Client Station views dynamically, immediately clearing out weak background nodes when increasing sensitivity.
- **Persistent Profile**: The chosen sensitivity value is stored in browser \`localStorage\` under \`alfa_rf_sensitivity_threshold\`, persisting across browser refreshes and session reloads.

### 31. Security Heuristic Engine & Vulnerability Auditing
The automated Heuristic Engine (\`heuristicEngine.js\`) passively inspects beacon and probe response frames to detect configuration anti-patterns and legacy cryptographic exposures:
- **Out-of-the-Box Default SSID Detection**: Matches broadcast network names against regex patterns for default factory hardware vendors (e.g. \`linksys\`, \`netgear\`, \`TP-LINK_XXXX\`, \`ATT-WIFI-XXXX\`, \`xfinitywifi\`, \`dlink\`, \`belkin\`, \`tenda\`, \`asus\`). Default names reveal equipment models and strongly correlate with unpatched firmware and default administrative credentials.
- **Deprecated Legacy Encryption Scanning**: Identifies networks running **WEP** (RC4 keystreams vulnerable to FMS/KoreK key reconstruction) or **WPA-TKIP** (vulnerable to Beck-Tews keystream re- **Open / Unencrypted Broadcast Warnings**: Flags unencrypted broadcast networks that transmit link-layer frames in plaintext, advising administrators to migrate to 802.1X Enterprise or Opportunistic Wireless Encryption (OWE / 802.11ow).
- **Dedicated Security Heuristics Tab**: Surfaces a dedicated audit deck categorized by severity (Critical, High, Medium) with actionable remediation guidance and direct access to inspect affected nodes.

### 32. Live Disk Streaming & File System Access API
Traditional browser memory buffers store captured 802.11 frames in a JavaScript array (\`rawPacketsRef\`), which creates memory pressure and crashes the tab during multi-hour packet auditing sessions. The Live Disk Streaming engine (\`livePcapWriter.js\`) eliminates memory constraints by streaming frames directly to local disk:
- **File System Access API Integration**: Prompts the operator via \`window.showSaveFilePicker()\` to choose a destination \`.pcap\` file on physical NVMe/SSD storage.
- **Immediate Global Header Initialization**: Upon file handle creation, the stream writer immediately creates an asynchronous writable stream (\`fileHandle.createWritable()\`) and commits the standard 24-byte PCAP file header (\`0xA1B2C3D4\`, Version 2.4, Snaplen 65535, LinkType 127: \`LINKTYPE_IEEE802_11_RADIOTAP\`).
- **Sequential Record Streaming**: As raw \`Uint8Array\` packet chunks arrive from hardware or simulation, the engine formats a 16-byte PCAP record header containing second/microsecond timestamps and packet length, immediately pushing both header and raw payload to the file stream.
- **Zero-Copy Memory Bypass**: When "Stream to Disk" is active, incoming frames completely bypass the in-memory 50,000-frame ring buffer, enabling indefinite multi-gigabyte capture sessions without browser tab exhaustion.
- **Safe Buffer Flushing & Finalization**: The stream automatically flushes buffered chunks every 5 seconds and performs clean stream termination upon stopping monitor mode or component unmount.

### 33. 2.4GHz Physical Channel Overlap & RF Interference Map
In the 2.4GHz ISM band (802.11b/g/n/ax), channels span 20MHz bandwidth but are spaced only 5MHz apart:
- **Spectral Physics of 2.4GHz Overlap**: Channels 1 (2412 MHz), 6 (2437 MHz), and 11 (2462 MHz) are the only three standard channels with sufficient 25MHz center separation to operate simultaneously without physical co-channel or adjacent-channel overlap.
- **Parabolic Bell Curve Spectral Mask**: The \`ChannelOverlapChart.jsx\` component maps channels 1 through 14 across the 2.400 GHz to 2.495 GHz frequency continuum, rendering cubic/quadratic parabolic emission masks for each active channel spanning 20MHz width (\`center ± 10MHz\`).
- **Spectral Density Blending (\`opacity: 0.5\`)**: By utilizing semi-transparent fills with 50% opacity, physical frequency overlaps between adjacent channels (e.g., Channel 1 overlapping with Channels 2, 3, 4, 5) physically blend into darker, denser collision zones that visually highlight severe radio collision risks.
- **Primary Non-Overlapping Guides**: Channels 1, 6, and 11 are permanently marked with vertical dashed alignment markers and distinct indicator pills (Emerald for CH 1, Cyan for CH 6, Purple for CH 11).
- **Automated Cleanest Channel Recommendation**: The analysis engine aggregates active access points and frame volumes across primary channels to automatically identify and recommend the least congested clean channel in the current airspace.

### 34. Custom Device Annotations & Tagging System
During complex wireless security assessments and physical facility walks, operators need to assign readable aliases, visual tags, and field notes to specific MAC addresses:
- **Side-Panel Note Editor**: An "Edit Note" action icon (\`Edit3\`) in the Device Detail panel opens an inline annotation manager allowing operators to assign custom device labels (e.g. *"Floor 2 Zebra Label Printer"*, *"Executive Boardroom AP"*), choose visual highlight colors, and input multi-line notes.
- **Custom Color Swatches**: Operators can pick curated highlight colors (Emerald, Cyan, Blue, Purple, Amber, Rose) to visually categorize authorized devices vs. unauthorized rogue hardware.
- **Persistent LocalStorage Keying**: Device annotations are serialized to \`localStorage\` under \`alfa_wifi_device_annotations\` keyed by normalized 48-bit MAC address. Annotations persist indefinitely across scans, cache wipes, and browser restarts.
- **Prominent UI Table Highlighting**: When an annotated MAC address is observed in the Access Points or Tracked Clients table, its custom alias is rendered prominently alongside the SSID/Vendor, and its custom color is applied as a bold 4px left border on the table row.

### 35. Client Roaming Handoff Analysis (802.11 Mobility Tracking)
In enterprise campus deployments, client devices (laptops, VoWiFi smartphones, medical carts) physically move across coverage cells. Diagnosing sticky clients, excessive handoff latencies, or ping-pong roaming loops is critical for real-time applications:
- **Handoff Detection Logic**: The roaming engine monitors directed Data and Reassociation frames from authenticated client station MAC addresses. When a client MAC transitions from an existing associated BSSID to a new BSSID within a 30-second temporal window, the system records a formal **Roaming Event**.
- **Roam Latency Calculation**: The engine computes exact roam delta time:
  \`Roam Time (ms) = First Seen Timestamp on New BSSID - Last Seen Timestamp on Old BSSID\`
- **Mobility KPI Metrics Deck**: Surfaces real-time statistics including Total Roams observed, Fastest Roam time, Average Roam duration across the session, and Total Unique Roaming Clients.
- **Dedicated Roaming Tab**: Features a tabular audit view tracking Client MAC, Source BSSID, Destination BSSID, Roam Time (ms) with color-coded speed indicators (emerald for <100ms fast transitions, amber for 100-300ms, rose for >300ms slow transitions), channel, and observation timestamp.

### 36. Wi-Fi 6 (802.11ax) High-Efficiency (HE) & Spatial BSS Coloring
IEEE 802.11ax introduces High-Efficiency (HE) enhancements to dramatically boost throughput in dense multi-device environments through OFDMA, 1024-QAM, and spatial reuse:
- **Information Element Tag 255 (Extension Elements)**: 802.11ax utilizes Element ID \`255\` followed by a 1-byte Element ID Extension to encapsulate HE parameters:
  - **HE Capabilities (Ext ID 35 / \`0x23\`)**: Encapsulates a 6-byte HE MAC Capabilities Information field and an 11-byte HE PHY Capabilities Information field detailing channel widths (80/160MHz), trigger frame support, and spatial stream allocation.
  - **HE Operation (Ext ID 36 / \`0x24\`)**: Encapsulates 802.11ax operational parameters, including the 6-bit **BSS Color** (\`bits 0-5\` of HE Operation Parameters) and the BSS Color Disabled flag (\`bit 7\`).
- **Spatial Reuse & BSS Coloring (0–63)**: BSS coloring assigns a 6-bit integer numerical identifier (values 1–63) to each BSSID. Spatial reuse engines allow stations to transmit simultaneously on the identical frequency channel if overlapping transmissions exhibit different BSS colors, mitigating traditional CSMA/CA clear-channel backoff delays.
- **Visual Badging & Inspector**: In the Access Points table, networks advertising 802.11ax display a blue **Wi-Fi 6** pill badge. The Device Detail inspector displays the extracted BSS Color, BSS Color Disabled flag, and hex-encoded HE MAC/PHY capability bitfields.

### 37. Offline PCAP Forensic Replay & Ingestion Pipeline
Security incidents, forensic packet captures, and RF site survey files collected in the field frequently need to be ingested and re-analyzed offline without physical hardware attached:
- **Universal PCAP Binary Parsing**: The \`pcapReader.js\` engine decodes standard libpcap binary captures (\`.pcap\`), parsing the 24-byte global header:
  - **Magic Number Validation**: Detects standard microsecond (\`0xA1B2C3D4\`) and nanosecond (\`0xA1B23C4D\`) captures in both little-endian and big-endian byte order.
  - **LinkType 127 Enforcement**: Validates that the capture utilizes \`LINKTYPE_IEEE802_11_RADIOTAP\` (\`127\`), rejecting incompatible Ethernet or raw MAC captures with descriptive error feedback.
  - **Record Iteration**: Streams 16-byte record headers (timestamp seconds, microseconds/nanoseconds, captured length, wire length) and decapsulates raw frame payloads into \`Uint8Array\` chunks.
- **Throttled Playback Rate (500 PPS)**: The \`PcapReplayer\` scheduler streams parsed packet payloads into the background Web Worker (\`parserWorker.js\`) in controlled 50-packet batches at a default 500 packets/second rate, simulating real-world packet flow and driving interactive UI animations without overloading the browser thread.
- **Forensic UI Integration**: An **Upload PCAP** button in the Action Bar allows direct drag-and-drop or file selection. During playback, the "Connect WebUSB" button is disabled, and an amber **Replaying Offline Capture** banner displays file name, live packet progress counter, and playback cancellation controls.

### 38. Understanding Airtime Utilization & Channel Congestion
In dense multi-access wireless environments, packet counts and bandwidth megabits do not tell the whole story of channel availability. Airtime utilization measures the percentage of physical radio medium capacity consumed over time:
- **802.11 MAC Duration Field Extraction**: Every 802.11 MAC header incorporates a 2-byte \`Duration/ID\` field at offset bytes 2 and 3 (immediately succeeding the 2-byte Frame Control field). In standard transmissions (where bit 15 is 0), this field represents the expected medium reservation duration in microseconds (\`µs\`) requested by the transmitting station for acknowledgments and NAV (Network Allocation Vector) reservation.
- **Microsecond Accumulation in 1-Second Sliding Window**: The background parser worker (\`parserWorker.js\`) and main-thread tracker maintain a rolling 1-second (1,000,000 µs) FIFO sliding window of observed frame durations.
- **Airtime Congestion Formula**:
  \`Airtime % = (Total Duration in 1 second / 1,000,000 µs) * 100\`
- **Dynamic KPI Strip Gauge & Congestion Grading**:
  - **Optimal Airtime (< 40%)**: Indicated in bright emerald (\`#10B981\`), representing ample channel capacity with low collision probability and clean contention windows.
  - **Moderate Congestion (40% – 70%)**: Indicated in amber (\`#F59E0B\`), reflecting active medium usage with potential for CSMA/CA backoff contention delays.
  - **Critical Congestion (> 70%)**: Indicated in vivid red (\`#EF4444\`), warning of a severely saturated channel where frame retransmissions, high packet jitter, and excessive drop rates occur.

### 39. Hardware Endpoint Introspection & Low-Level Querying
Verifying that physical USB hardware is not only recognized by the operating system but actively communicating across control and vendor endpoints is vital for diagnostic reliability:
- **Direct WASM Driver Method Queries**: The \`queryHardwareIntrospection\` routine queries the underlying \`@openipc-rs/web\` driver for low-level diagnostic telemetry:
  - **Thermal Sensor Interrogation (\`readThermalStatus\`)**: Interrogates the on-die Realtek thermal sensor to verify junction temperature (e.g. 42°C – 70°C), warning of potential thermal throttling.
  - **Adapter Capabilities (\`adapterCapabilities\`)**: Queries internal hardware registers to identify exact RF revision, firmware revision strings, and capability matrices.
  - **Register Read (\`readRegisterU8\`)**: Attempts to read the factory MAC address from non-volatile EEPROM registers (\`0x0050\` – \`0x0055\`).
- **WebUSB Vendor-Specific Control Transfer Fallback**: When the WASM driver does not expose direct register access, the tool executes standard WebUSB vendor control transfer requests (\`device.controlTransferIn\` with \`requestType: 'vendor'\`, \`request: 0x05\`, \`value: 0x0050\`) to retrieve the factory 48-bit MAC address.
- **Hardware Status Inspector Panel**: A dedicated expandable "Hardware Status" panel in the header displays Adapter MAC, Firmware Version, Chipset Model (e.g. RTL8812AU / RTL8814AU), and Endpoint Status, validating low-level USB pipe responsiveness.

### 40. Dynamic Pre-Worker Telemetry Filtering Pipeline
In high-throughput environments receiving thousands of packets per second (such as high-traffic airport terminals or enterprise venues), serializing every raw frame across Web Worker \`postMessage\` boundaries can overwhelm main-thread garbage collectors and induce UI lag:
- **Zero-Copy Main-Thread Heuristic Check**: Before passing raw frame buffers to the Web Worker, the read loop executes \`fastFilterPacket\` to evaluate packet suitability in microseconds with zero allocations.
- **Pre-Worker RSSI Threshold**: Frames with RSSI weaker than the user's configured sensitivity threshold (e.g. \`-80 dBm\`) are immediately dropped at the transfer loop boundary, avoiding unnecessary worker dispatch.
- **Selective Frame Type Discarding**:
  - **Ignore Data Frames**: Drops high-frequency QoS Data and Data payload frames, preserving CPU cycles exclusively for network discovery and beacon auditing.
  - **Ignore Management Frames**: Filters out continuous Beacons and Probe Requests during targeted data packet capture.
  - **Ignore Control Frames**: Discards high-volume ACKs, RTS, and CTS frames that lack payload information.
- **Target MAC Address Matching**: Fast byte-level comparison checks the frame's Address 1 (Destination), Address 2 (Source), and Address 3 (BSSID) against a target MAC address. Frames unrelated to the targeted network or client are pruned before serialization.
- **Action Bar Filtering Popover**: An interactive popover in the Action Bar provides one-click access to RSSI thresholds, frame type checkboxes, target MAC input, and an active filter indicator badge.

### 41. Layer 3 Visibility & Cleartext Protocol Metadata Extraction
While IEEE 802.11 monitor mode operates predominantly across Layer 2 (MAC/PHY) frames, unencrypted Data frames encapsulate higher-layer protocols that expose valuable IP-to-MAC associations:
- **LLC/SNAP Demultiplexing**: In standard unencrypted 802.11 Data transmissions, the MAC header (24 bytes, or 26 bytes for QoS Data) is followed by an 8-byte IEEE 802.2 LLC/SNAP header (\`0xAA 0xAA 0x03 0x00 0x00 0x00\`) carrying the 2-byte EtherType.
- **Address Resolution Protocol (ARP, EtherType \`0x0806\`)**: The parser extracts 28-byte ARP announcements (both Requests and Replies), mapping the Sender Hardware Address (SHA / MAC) to the Sender Protocol Address (SPA / IPv4). This enables passive mapping of static and dynamically addressed hosts without generating active network probes.
- **Dynamic Host Configuration Protocol (DHCP, UDP Port 67/68)**: IPv4 packets (EtherType \`0x0800\`) carrying UDP datagrams on ports 67 (DHCP Server) or 68 (DHCP Client) are demultiplexed to inspect BOOTP/DHCP payloads:
  - **Client Hardware MAC (\`chaddr\`)**: The physical 48-bit MAC address of the requesting station.
  - **Assigned/Offered IP (\`yiaddr\`)**: The IPv4 lease assigned by the DHCP server.
  - **DHCP Option 12 (Host Name)**: Decodes ASCII hostnames (e.g. \`iPhone-15\`, \`MacBook-Pro\`, \`DESKTOP-G784\`), linking hardware MAC addresses directly to human-readable device names.
- **Layer 3 Workbench Integration**: Discovered IP addresses populate in dedicated columns within the Access Points and Tracked Clients tables. A standalone **Layer 3 Mappings** tab catalogs all intercepted IP/MAC pairs, protocol tags, and DHCP hostnames with one-click device inspection.

### 42. Geographic Spatial Exports (GeoJSON & Google Earth KML)
To support modern Geographic Information Systems (GIS) and spatial war-driving workflows, captured wireless telemetry can be exported directly to standard geo-spatial formats:
- **GeoJSON FeatureCollection**: The \`generateGeoJSON\` engine converts all GPS-tagged access points into standard GeoJSON (\`RFC 7946\`) Point features:
  - **Geometry**: \`[longitude, latitude, altitude]\` in WGS84 coordinates.
  - **Properties**: SSID, BSSID, RSSI (dBm), Hardware Vendor, Operating Channel, Security Suite, and Last Seen timestamp.
  - **Interoperability**: Directly loadable into QGIS, ArcGIS, Mapbox Studio, and web mapping frameworks.
- **Keyhole Markup Language (KML 2.2)**: The \`generateKML\` engine constructs XML documents with \`<Placemark>\` tags formatted for **Google Earth** and Google Maps:
  - **Placemark Titles**: Formatted as \`SSID (BSSID)\` for instant identification in the 3D globe viewer.
  - **HTML CDATA Descriptions**: Richly formatted balloons displaying signal strength, channel, encryption, vendor OUI, and observation timestamps.
  - **Coordinates String**: \`lon,lat,alt\` triplets for native 3D spatial pin placement.
- **Unified Export Action Menu**: The Action Bar export button features a dropdown offering:
  - **Export PCAP**: Full packet captures for Wireshark analysis.
  - **Export Wigle CSV**: Wardriving format for community wireless mapping.
  - **Export GeoJSON**: Standard JSON geospatial format.
  - **Export KML**: Google Earth spatial overlay format.
  - **Export HTML & JSON**: Audit summaries and machine-readable dumps.

### 43. Hardware Receiver (RX) Gain & Sensitivity Tuning
Optimizing RF reception across varying physical environments requires fine-grained control over baseband receiver amplification:
- **Low-Noise Amplifier (LNA) & Baseband Gain**: Strong signals in close proximity to transmitters can overdrive receiver amplifiers (causing ADC clipping and packet corruption), while distant signals require maximum amplification to cross the decode threshold.
- **WASM Driver Integration**: The \`setHardwareRxGain\` utility interfaces with the \`@openipc-rs/web\` driver to calibrate hardware gain:
  - **Direct Driver API**: Calls \`radioInstance.setRxGain(gain)\`, \`setGain(gain)\`, or \`setSensitivity(gain)\` where supported by the driver firmware.
  - **Baseband Register Writing**: Adjusts Automatic Gain Control (AGC) and VGA registers (e.g. Realtek Baseband Register \`0x0824\` / \`0x082C\`) via \`writeRegisterU8\` or \`writeRegisterU32\`.
  - **WebUSB Vendor Control Transfers**: Dispatches vendor-specific USB setup packets (\`requestType: 'vendor'\`, \`request: 0x05\`, \`value: 0x0824\`) to adjust analog front-end gain on hardware endpoints.
- **UI Gain Slider & Real-Time Feedback**: An **RX Gain** slider (levels 1–10) in the workbench header allows operators to tune receiver sensitivity on the fly, with toast notifications confirming hardware register updates.

### 44. Universal Hardware Abstraction Layer (HAL) & Supported Hardware Matrix
To eliminate single-chipset lock-in, the workbench employs a multi-vendor **Hardware Abstraction Layer (HAL)** in \`hardwareManager.js\`. The HAL queries the USB \`vendorId\` and \`productId\` at connection time to determine driver profile, generation, and supported feature flags:

| Chipset Family | USB VID / PID | Wi-Fi Generation | Frequency Bands | MIMO | Capabilities | Reference Hardware Models |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Realtek RTL8812AU** | \`0x0BDA\` : \`0x8812\`, \`0x881A\` | 802.11ac (Wi-Fi 5) | 2.4 GHz & 5 GHz | 2x2:2 | Monitor Mode, TX Support, Dual Band, Packet Injection, RX Tuning | Alfa AWUS036ACH, TP-Link Archer T4U, Netgear A6210 |
| **Realtek RTL8814AU** | \`0x0BDA\` : \`0x8813\` | 802.11ac (Wi-Fi 5) | 2.4 GHz & 5 GHz | 4x4:4 | Monitor Mode, TX Support, Dual Band, 4-Antenna Diversity, RX Tuning | Alfa AWUS1900, TP-Link Archer T9UH, ASUS USB-AC68 |
| **Realtek RTL8811AU** | \`0x0BDA\` : \`0x0811\` | 802.11ac (Wi-Fi 5) | 2.4 GHz & 5 GHz | 1x1:1 | Monitor Mode, TX Support, Dual Band, Compact Dongle Profile | Alfa AWUS036ACS, Edimax EW-7811UTC |
| **MediaTek MT7921AU** | \`0x0E8D\` : \`0x7961\` | 802.11ax (Wi-Fi 6) | 2.4 GHz & 5 GHz | 2x2:2 | Monitor Mode, Dual Band, Wi-Fi 6 HE Tag Demux, Airtime Extraction | Alfa AWUS036AXML, Comfast CF-953AX |
| **MediaTek MT7612U** | \`0x0E8D\` : \`0x7612\` | 802.11ac (Wi-Fi 5) | 2.4 GHz & 5 GHz | 2x2:2 | Monitor Mode, TX Support, Dual Band, Packet Injection | Alfa AWUS036ACM, Netgear A6210 v2 |
| **MediaTek MT7610U** | \`0x0E8D\` : \`0x7610\` | 802.11ac (Wi-Fi 5) | 2.4 GHz & 5 GHz | 1x1:1 | Monitor Mode, Dual Band, Airtime Extraction | Alfa AWUS036AC |
| **Ralink RT5370** | \`0x148F\` : \`0x5370\` | 802.11b/g/n | 2.4 GHz | 1x1:1 | Monitor Mode, TX Support, Legacy 2.4GHz Monitoring | Raspberry Pi Wi-Fi, Generic RT5370 |

- **Dynamic UI Adaptation**: The workbench queries \`hasCapability(profile, CAPABILITIES.TX_SUPPORT)\`. When an adapter profile lacks packet transmission capability (such as pure RX monitor firmware), the **Run TX Loopback Test** button is dynamically disabled with a tooltip indicator: *"Transmit not supported by this chipset."*

### 45. Windows Driver Setup Guide (Native NDIS vs WinUSB Architecture)
On Windows, operating system security and kernel architecture restrict how user-space browser applications interact with USB network cards:
- **The Problem: Exclusive NDIS Driver Lock**: When a USB Wi-Fi dongle is plugged into Windows, the OS automatically binds its certified Network Driver Interface Specification (NDIS) miniport driver (\`rtwlanu.sys\` or \`mtkwl6ex.sys\`). The Windows WLAN AutoConfig service (\`wlanapi.dll\`) claims the adapter exclusively, locking it to managed station mode (connecting to BSSIDs) and hiding USB bulk endpoints from the browser's WebUSB API.
- **The Solution: Generic WinUSB Binding**: **WinUSB** (\`WinUSB.sys\`) is Microsoft's universal kernel-mode driver for USB devices that don't fit standard device classes. Binding WinUSB gives Chromium browsers direct access to USB endpoints 0 (Control), 1 (Interrupt), 2 (Bulk OUT), and 3 (Bulk IN), allowing the browser WASM engine to boot monitor mode firmware directly into the chip's internal RAM.
- **Step-by-Step Zadig Setup Protocol**:
  1. Download the standalone Zadig executable from [https://zadig.akeo.ie/](https://zadig.akeo.ie/) and run as Administrator.
  2. Plug the USB Wi-Fi adapter into a high-speed USB 3.0 port.
  3. In Zadig, open the **Options** menu and click **List All Devices** (required because Windows categorizes network adapters separately from generic USB devices).
  4. From the main dropdown, select your adapter (e.g., *"Realtek 8812AU Wireless LAN 802.11ac USB NIC"*).
  5. In the target driver selection box on the right side of the green arrow, select **WinUSB (v6.1.7600.16385)**.
  6. Click **Replace Driver** (or **Install Driver**) and allow Windows ~30 seconds to rebind the USB interface.
- **Operational Impact & Reverting to Normal Wi-Fi**:
  - While WinUSB is bound, Windows will temporarily **not** show this adapter in the system Wi-Fi tray, because it is no longer bound to NDIS.
  - To revert the adapter to a regular Windows Wi-Fi client card: Open **Device Manager** &rarr; locate the device under *"Universal Serial Bus devices"* &rarr; right-click and choose **Update driver** &rarr; select **Search automatically for drivers**. Windows will restore the original manufacturer NDIS driver immediately.

### 46. Automation Rule Engine & Reactive Webhooks
The **Automation Rule Engine** (\`ruleEngine.js\`) eliminates the cognitive burden of continuously monitoring real-time wireless telemetry by evaluating user-configured rules against incoming batches of dissected 802.11 frames:
- **Rule Architecture & Structure**:
  - Each rule is structured as a declarative JSON object: \`{ id, name, eventType, targetMac, actionType, actionPayload, enabled, createdAt }\`.
  - Rules are fully persisted in the browser's \`localStorage\` under \`alfa_wifi_automation_rules\` and hydrated on initial workbench boot.
- **Trigger Event Types**:
  - \`DEVICE_CONNECTED\`: Evaluates when an Access Point (BSSID) or Client Station (STA) is first observed transmitting frames on the active channel.
  - \`DEVICE_DISCONNECTED\`: Triggers when an active device has not emitted radio energy for greater than 60 seconds (inactivity / out-of-range timeout).
  - \`ANOMALY_DETECTED\`: Fires reactively when heuristic security alarms occur, including high-rate 802.11 deauthentication floods (>=10 deauths within a 5-second sliding window) or Rogue AP / Evil Twin beacon collisions.
- **Granular MAC Targeting**:
  - Operators can bind rules to a specific hardware MAC address (e.g., \`00:11:22:33:44:55\`), with automatic sanitization across colon, hyphen, and case variations.
  - Specifying \`*\` or \`ANY\` configures a wildcard rule that triggers on any discovered wireless endpoint matching the event type.
- **Supported Automated Actions**:
  - \`WEBHOOK\`: Formats and dispatches an asynchronous HTTP POST request to an external security operations center (SOC), SIEM, or Slack/Discord endpoint via \`fetch()\`, delivering detailed JSON telemetry including rule metadata, timestamp, and target device attributes.
  - \`NATIVE_NOTIFICATION\`: Interacts with the W3C Web Notification API to surface OS-level desktop push alerts without requiring window focus.
  - \`AUDIO_BEEP\`: Utilizes the browser's Web Audio API (\`AudioContext\`) to synthesize an audible oscillator tone (default 880 Hz, or user-defined frequency in Hz), providing heads-up acoustic feedback during physical field audits.

### 47. Device-Specific Targeted PCAP Extraction & Forensic Filtering
In high-density RF environments, capturing hours of promiscuous traffic yields massive multi-gigabyte PCAP files where 99% of the frames belong to unrelated network nodes. The **Targeted Extraction** engine (\`pcapExporter.js\`) allows security analysts to isolate and download forensic packet captures filtered strictly for a selected device:
- **802.11 Header & Radiotap Dissection**:
  - The extraction pipeline parses each captured frame in the in-memory circular ring buffer (\`rawPacketsRef\`), extracting the Radiotap header length (\`it_len\`) from bytes 2–3.
  - It inspects the 802.11 MAC header at offset \`it_len\`, analyzing:
    - **Address 1 (RA / Destination)**: Bytes 4–9
    - **Address 2 (TA / Source)**: Bytes 10–15
    - **Address 3 (BSSID / Filtering)**: Bytes 16–21
    - **Address 4 (WDS Intersite)**: Bytes 24–29 (when Frame Control indicates \`To DS = 1\` and \`From DS = 1\`).
- **Zero-Latency In-Memory Extraction**:
  - When the analyst clicks **Export Device PCAP** in the Device Detail Side-Panel, the engine synchronously filters only the matching \`Uint8Array\` frame buffers.
  - A standard libpcap 2.4 binary file with \`LINKTYPE_IEEE802_11_RADIOTAP\` (LinkType 127) is immediately compiled in-memory and committed to disk via an automated browser download anchor.
  - This workflow eliminates the need to load gigabyte captures into external tools like Wireshark or \`tshark\` just to isolate traffic for a single suspicious client or rogue AP.

### 48. Hardware Heartbeat Watchdog & Autonomous Re-Synchronization
USB monitor-mode hardware operating under heavy RF loads or aggressive channel hopping can experience endpoint stalls or firmware lockups. The **Hardware Heartbeat Watchdog** provides continuous health telemetry and autonomous fault recovery:
- **Packet Time Heartbeat Telemetry**:
  - The workbench tracks a high-resolution timestamp (\`lastPacketTimeRef\`) updated continuously on every valid USB RX transfer, Web Worker parsing batch, and simulated frame ingestion.
- **5-Second Watchdog Timer**:
  - A background watchdog loop evaluates hardware link liveness every 2 seconds. If greater than 5,000 ms (5 seconds) elapse without incoming frame data while monitor mode is active, the watchdog identifies a potential hardware lockup and initiates autonomous recovery.
- **Tiered Multi-Stage Self-Healing**:
  - **Stage 1 (Soft Link Retune)**: Dispatches a soft retune command to the active radio driver instance to clear the baseband FIFO and re-synchronize the synthesizer PLL.
  - **Stage 2 (Handle Re-Initialization)**: If the radio instance is unresponsive, the watchdog accesses previously granted WebUSB device permissions via \`navigator.usb.getDevices()\` to re-open the USB device configuration and reclaim Interface 0 without prompting the operator.
  - **Stage 3 (Graceful State Teardown)**: If physical hardware is disconnected or unrecoverable, the watchdog terminates the capture loop, releases worker threads, and transitions the workbench UI cleanly to the "Disconnected" state while warning the operator.

### 49. Client Device OS Fingerprinting via Information Elements (IEs)
Passive operating system identification in 802.11 monitor mode allows analysts to discern the hardware platform and software stack of client stations without injecting a single probe or packet:
- **Information Element (IE) Tag Sequencing**:
  - During network discovery, client stations broadcast 802.11 Probe Requests containing ordered sequences of Information Elements (IEs) defined in IEEE 802.11-2020.
  - The order and presence of specific tags (e.g., Tag 0: SSID, Tag 1: Supported Rates, Tag 3: DS Parameter, Tag 45: HT Capabilities, Tag 50: Extended Supported Rates, Tag 107: Interworking, Tag 127: Extended Capabilities, Tag 191: VHT Capabilities, Tag 221: Vendor-Specific) form distinct, platform-specific signatures.
- **Fingerprinting Dictionary (\`OS_SIGNATURES\`)**:
  - **Apple iOS / iPadOS**: Identified by signature profiles such as \`0,1,50,45,127,221,221\` and \`0,1,50,45,127,107,221,221\`, exhibiting strict Apple vendor-specific elements without VHT in probe frames.
  - **Apple macOS**: Identified by profiles including Tag 191 (VHT Capabilities) such as \`0,1,50,45,61,127,191,221\` and \`0,1,3,45,127,191,221\`.
  - **Google Android**: Characterized by Tag 107 (Interworking / Hotspot 2.0) positioned before or after Tag 127, as well as multiple Tag 221 vendor elements (\`0,1,50,45,127,107,221\`).
  - **Microsoft Windows**: Identified by WMM/WPS vendor elements (\`00:50:F2\`) and tag sequence \`0,1,50,3,45,127,221\`.
  - **Generic Linux / wpa_supplicant**: Clean sequences without proprietary vendor tags, typically \`0,1,50,45,127\`.
  - **IoT / Embedded Microcontrollers**: Minimalist tag sequences (typically 4 or fewer elements) such as \`0,1,50,221\` or \`0,1,45\` characteristic of Espressif ESP8266/ESP32, Tuya, and smart home appliances.
- **Multimodal Evaluation Pipeline (\`identifyOS\`)**:
  - Direct exact-match signature hash table lookup against known tag sequences.
  - Contextual resolution using DHCP option 12 hostnames (e.g., "iPhone", "Galaxy-S23", "MacBook-Pro", "desktop-") and vendor Organizationally Unique Identifiers (OUIs).
  - UI visual badges and platform-specific Lucide iconography (Apple, Smartphone, Monitor, Laptop, Cpu, Terminal) rendered inline next to MAC addresses across Station and Probing tables.

### 50. Interactive Geospatial RF Heatmapping & Multi-Tile Mapping
The **Geospatial Signal Heatmap** (\`GeospatialMap.jsx\`) maps 802.11 RF signal propagation across physical coordinates:
- **Leaflet & Dynamic Heat Layer Integration**:
  - Leverages Leaflet 1.9.4 and \`leaflet.heat\` to plot spatial signal intensity gradients across real-world GPS coordinates collected via the W3C Geolocation API.
  - Generates multi-stop heat gradients (Cyan -> Emerald -> Amber -> Rose) where point weights are normalized from live RSSI levels: \`intensity = (rssi + 100) / 60\`.
- **Accuracy-Proportional Error Radii**:
  - For each observed node, the map renders a semi-transparent circular boundary whose radius in meters is strictly proportional to the physical GPS accuracy tolerance (\`±m\`).
  - Color-coded borders immediately indicate RF signal strength: Emerald (>= -60 dBm, Strong), Cyan (-70 to -60 dBm, Good), Amber (-80 to -70 dBm, Moderate), and Rose (< -80 dBm, Weak).
- **Multi-Provider Tile Switching**:
  - **Dark Vector View**: High-contrast CartoDB dark tile basemap optimized for tactical wardriving and night operations.
  - **OSM Standard View**: OpenStreetMap cartographic vectors highlighting streets, buildings, and civil infrastructure.
  - **Satellite Imagery**: High-resolution Esri World Imagery providing aerial terrain and foliage visibility to correlate RF attenuation with physical obstacles.
- **Interactive Inspection**:
  - Clicking any node opens a rich popup with SSID, BSSID, RSSI, channel, hardware vendor, and GPS coordinates.
  - Synchronous bidirectional selection highlights the corresponding device in the workbench inspector sidebar.

### 51. Autonomous Channel Planning & Congestion Advisory
Dense 802.11 deployments frequently suffer from co-channel interference and spectrum saturation. The **Channel Planning Advisor** (\`channelAdvisor.js\`) continuously analyzes spectrum metrics to recommend optimal channel configurations:
- **Multivariate Congestion Scoring Algorithm**:
  - **Co-Channel AP Density**: Each observed access point operating on the target channel contributes +15% to baseline congestion.
  - **Strong Signal Contention**: Access points with RSSI >= -70 dBm contribute an additional +10% penalty due to direct carrier sense (CSMA/CA) preamble contention and clear channel assessment (CCA) backoffs.
  - **Packet Throughput Ratio**: Cumulative packet volumes observed on the channel contribute up to +35% weighted by overall spectrum packet volume.
  - **Airtime Utilization Integration**: When analyzing the currently tuned channel, live 1-second rolling airtime utilization (\`airtimePercent\`) contributes 50% to the overall score.
  - **2.4 GHz Spectral Overlap**: Evaluates adjacent overlapping channels (e.g., channels 2, 3, 4, 5 for channel 1) and adds an overlap penalty of +8% per adjacent network.
- **2.4 GHz Band Optimization**:
  - Evaluates standard non-overlapping primary channels (1, 6, 11) and identifies the channel with the lowest normalized congestion score.
  - Generates human-readable advisory explanations comparing the recommended channel against congested alternatives (e.g., "Channel 6 has the lowest congestion (12%), avoiding Channel 1 which is congested by 4 neighboring networks").
- **5 GHz Band Optimization**:
  - Evaluates primary UNII-1 and UNII-3 channels (36, 40, 44, 48, 149, 153, 157, 161) to identify the top 3 least congested channels with the lowest packet contention scores.
- **Workbench Dashboard Widget**:
  - Displays instant recommendations on the main workbench KPI panel with hover tooltips detailing channel traffic composition and one-click quick-retune actions.

### 52. Complete Troubleshooting & Diagnostic Matrix
| Error Message / Symptom | Root Cause | Engineering Solution |
| :--- | :--- | :--- |
| \`NotFoundError\` | User cancelled prompt or no device found. | Ensure adapter is plugged in. |
| \`NetworkError\` | Driver is claimed by OS (Windows) or cable disconnected. | Use Zadig to install WinUSB driver; verify USB-C cable connection. |
| WebUSB undefined | Unsupported browser (Safari/Firefox). | Use Google Chrome or Microsoft Edge. |
| PCAP buffer full | Capture session exceeded 50,000 frames. | Enable "Stream to Disk" for unlimited capture, or click "Export PCAP" and clear buffer. |
| GPS Not Locked / 0.0 | Location permission denied or device lacks GPS. | Grant browser location permissions in browser site settings. |
| Airtime Gauge Stuck at 0% | No frames observed or duration field missing. | Verify monitor mode is active and channel is set to an active frequency. |
| Packets Not Appearing | Pre-worker filtering pipeline discarding frames. | Open "Filtering" popover and reset filters or raise RSSI sensitivity threshold. |
| Hardware Status "Fallback Defaults" | OS restricted USB control transfer endpoint. | Device operates normally in monitor mode; install WinUSB driver via Zadig for full vendor control pipe access. |
| Hardware unresponsive (>5s) | USB endpoint stall or baseband synthesizer lockup. | Watchdog initiates autonomous retune or WebUSB handle re-synchronization; if physical cable disconnected, re-insert adapter. |
| Webhook delivery failed | Destination URL unreachable or blocked by CORS. | Ensure target webhook endpoint accepts CORS \`POST\` requests or configure a local proxy. |

### 53. Upstream Standards & Engineering Attribution
| Standard / Component | Authoring Organization / Maintainers | Reference & Specification |
| :--- | :--- | :--- |
| WebUSB API | W3C / Chromium | https://wicg.github.io/webusb/ |
| OpenIPC-RS | OpenIPC Project | https://github.com/OpenIPC/openipc-rs |
| RTL8812AU | Realtek | 802.11ac USB NIC Datasheet |
| IEEE 802.11-2020 | IEEE Computer Society | Wireless LAN Medium Access Control and Physical Layer Specifications |
| IEEE 802.11ax-2021 | IEEE Computer Society | High-Efficiency (HE) Wireless LAN Amendment (Wi-Fi 6) |
| IEEE 802.11w-2009 | IEEE Standards Association | Protected Management Frames Amendment |
| tcpdump / libpcap | The Tcpdump Group | PCAP File Format Specification (LinkType 127 Radiotap) |
| File System Access API | W3C / WHATWG | https://wicg.github.io/file-system-access/ |
| IndexedDB API 3.0 | W3C | https://www.w3.org/TR/IndexedDB-3/ |
| Leaflet.js | Vladimir Agafonkin / Leaflet | https://leafletjs.com/ |
| Wigle.net | WiGLE Project | Wireless Geographic Logging Engine v1.4 File Format Specification |
| W3C Geolocation API | W3C | https://www.w3.org/TR/geolocation/ |
`


  }
];

