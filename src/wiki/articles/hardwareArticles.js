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
    summary: 'Motherboard BIOS dumping and reflashing with a CH341A, ARM Cortex-M debugging through a CMSIS-DAP probe, JTAG chain scan / SVF playback / boundary scan, and AVR fuse and bootloader programming with an ArduinoISP.',
    tags: ['CH341A', 'BIOS', 'SPI Flash', 'CMSIS-DAP', 'SWD', 'JTAG', 'AVR ISP', 'EEPROM', 'Winbond', 'Unbrick', 'flashrom'],
    readTime: '30 min read',
    content: `
# Hardware Programmers Suite — Low-Level Memory & Silicon

The **Hardware Programmers Suite** aggregates four low-level programming interfaces into a single browser workbench, selected with the tabs at the top:
1. **CH341A BIOS Flash**: 25-series SPI NOR flash and 24-series I2C EEPROM reading, erasing, and writing through a WCH CH341A (WebUSB).
2. **CMSIS-DAP Debugger**: ARM Cortex-M debugging over SWD through a CMSIS-DAP probe (WebUSB v2 or WebHID v1): halt/step/reset, registers, memory, RTT, SWO/ITM, breakpoints and flash programming.
3. **JTAG / SVF Player**: JTAG chain scan, SVF playback and boundary-scan SAMPLE/EXTEST, driven through a CMSIS-DAP probe that supports JTAG.
4. **AVR ISP & Bootloader**: fuse, lock-bit, flash and bootloader programming of 8-bit AVRs through an Arduino running ArduinoISP (or any STK500v1 programmer) over WebSerial.

All of it needs a Chromium browser (WebUSB / WebSerial / WebHID). On Windows, the CH341A needs the **WinUSB** driver bound with Zadig.

---

### 1. CH341A SPI Flash & I2C EEPROM Programmer

The **WCH CH341A** is a multi-function USB interface chip manufactured by Nanjing Qinheng Microelectronics. In hardware programming mode (SDA and SCL jumper bridged on pins 1-2), the CH341A operates as a USB bridge with an SPI master and an I2C master. The tool looks for the programmer's USB ID \`1A86:5512\`; the serial-mode ID \`1A86:7523\` is not used.

#### Supported Flash Families & Capacities:
- **25-Series SPI Flash (SOIC-8, SOIC-16, DIP-8, WSON-8)**: the JEDEC ID is looked up in a built-in database covering Winbond (\`W25Q80\` to \`W25Q256\`, \`W25Q128JV-M\`, \`W25Q64DW\`, \`W25X40\`), Macronix (\`MX25L8005\` to \`MX25L25635F\`), GigaDevice (\`GD25Q16\` to \`GD25Q128\`, \`GD25LQ64\`), Micron (\`N25Q128\`, \`N25Q256\`), EON, SST/Microchip, Adesto, ISSI, Puya, Boya, XTX, XMC, Zbit and Fudan parts. An unknown JEDEC ID is still usable: the size is taken from the chip's SFDP table, or failing that from the capacity byte of the ID. Chips above 16 MB automatically use 4-byte addressing.
- **24-Series I2C EEPROM** (selected from a drop-down, device address \`0x50\` by default): \`24C01\` (128 B), \`24C02\` (256 B), \`24C04\` (512 B), \`24C08\` (1 KB), \`24C16\` (2 KB), \`24C32\` (4 KB), \`24C64\` (8 KB), \`24C128\` (16 KB), \`24C256\` (32 KB), \`24C512\` (64 KB), \`24CM01\` (128 KB), \`24CM02\` (256 KB).

> [!WARNING]
> ### Critical 3.3V Hardware Modification Warning
> Many inexpensive "black" CH341A programmer boards sold on Amazon and AliExpress contain a severe PCB layout flaw: while the board's 3-pin power header sets the VCC pin to 3.3V, the CH341A IC's pin 28 (V3) is tied directly to 5V USB power instead of 3.3V. This forces the data output lines (MOSI, CS, SCK) to drive at **5.0V logic levels**!
> Connecting 5V logic to modern 3.3V Winbond or Macronix BIOS chips can degrade or permanently puncture the silicon substrate.
> **Verification & Fix**:
> 1. Measure the DC voltage between GND and Pin 28 (V3) on the CH341A IC using a digital multimeter.
> 2. If it measures ~5.0V, cut the PCB trace between pin 28 and the 5V rail.
> 3. Solder a thin bodge wire from pin 28 to the 3.3V output pin of the on-board AMS1117-3.3 regulator.

<details>
<summary>Deep-Dive: SPI Flash Opcode Set & Status Register 1 Bitfields</summary>

The driver uses the common 25-series command set (JEDEC JESD216 / SFDP). Opcodes the tool actually sends:

| Opcode (Hex) | Command Name | Data Bytes Sent | Data Bytes Received | Description |
| :--- | :--- | :---: | :---: | :--- |
| **\`0x9F\`** | **Read JEDEC ID** | 0 | 3 | Manufacturer, memory type, capacity. |
| **\`0x5A\`** | **Read SFDP** | 3 (Addr) + 1 (Dummy) | $N$ | Reads the density for chips missing from the database. |
| **\`0x06\`** | **Write Enable (WREN)** | 0 | 0 | Sets the Write Enable Latch (WEL). |
| **\`0x05\`** / **\`0x35\`** / **\`0x15\`** | **Read Status Register 1 / 2 / 3** | 0 | 1 | BUSY (bit 0), WEL (bit 1), block-protect and QE bits. |
| **\`0x01\`** | **Write Status Register** | 1 or 2 | 0 | Writes protection bits (BP0-BP2, SEC, TB). |
| **\`0x03\`** / **\`0x13\`** | **Read Data** (3-byte / 4-byte address) | 3 or 4 (Address) | $N$ | Streams data in 4 KB reads. |
| **\`0x20\`** / **\`0x21\`** | **Sector Erase 4 KB** (3-byte / 4-byte address) | 3 or 4 (Address) | 0 | Erases a 4,096-byte sector to \`0xFF\`. |
| **\`0xC7\`** | **Chip Erase** | 0 | 0 | Wipes the whole chip to \`0xFF\` (waits up to 4 minutes). |
| **\`0x02\`** / **\`0x12\`** | **Page Program** (3-byte / 4-byte address) | 3 or 4 (Addr) + up to 256 | 0 | Programs one 256-byte page. |

32 KB / 64 KB block erase and Fast Read are defined in the driver but not used by the buttons.

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
The **STATUS & WRITE PROTECTION** card shows SR1/SR2/SR3 and the decoded BP, TB, SEC, SRP0 and QE bits, and warns when blocks are write-protected. The tool does **not** clear protection on its own during a write: click **UNPROTECT** (it clears BP0-BP2, TB and SEC in SR1 and reads the register back). If SRP is set and WP# is held low, the bits will not clear and the tool says so. A write to a protected area fails the read-back verify with "Is the chip write-protected?". The card also has a manual **SR1** hex field with a **WRITE** button (with a confirmation, since SRP0 with WP# low can lock the register until power-off).
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
2. Plug the CH341A programmer (mode jumper on the SPI/I2C position) into your computer's USB port.
3. In Skon's USB Tool, open the **Hardware Programmers Suite** and select the **CH341A BIOS Flash** tab.
4. Click **CONNECT CH341A (WEBUSB)** and choose the device. The tool reads the JEDEC ID and status registers immediately and fills the Detected Flash Chip / Flash Capacity / JEDEC ID cards, e.g. \`0xEF4018\` Winbond W25Q128 16 MB. **READ JEDEC ID** repeats the query. An ID of \`FF FF FF\` or \`00 00 00\` means no chip answered (check the clip, pin 1 and the 3.3 V jumper).
5. Click **DUMP FULL CHIP** (or **DUMP 64 KB** for a quick test). A progress bar shows the transfer; the first 2,048 bytes appear in the buffer preview. Click **SAVE DUMP (.BIN)** to save a backup (\`bios-dump-<chip>-<time>.bin\`).
   - **READ RANGE** reads only part of the chip into the buffer: enter a **start** and a **length** (decimal or \`0x\` hex) and click it. The range is checked against the detected chip size.
   - The buffer line shows its **CRC32** and **SHA-256**, recomputed whenever the buffer changes, so you can confirm that two dumps match (read the chip twice and compare the sums before trusting a dump).
   - **BLANK CHECK CHIP** reads the whole chip and reports whether every byte is \`FF\` (erased), or how many bytes are not and where the first one is. It does not change the buffer. **BLANK?** does the same check on the buffer.
   - **COPY flashrom CMD** copies a text command line (\`flashrom -p ch341a_spi -w image.bin\`) for the same job on a PC with flashrom installed. It is only text; this tool does not run flashrom.
6. Click **LOAD .BIN FILE** and select the replacement image (\`.bin\`, \`.rom\`; the file is used as raw bytes, an Intel HEX file is not converted).
7. Optionally use **FILE vs CHIP** or **FILE vs BUFFER** to compare a file against the chip or the buffer; differing byte ranges are listed.
8. Click **WRITE BUFFER TO FLASH** and confirm. The image is written from address 0, sector by sector: sectors that already match are skipped, sectors needing a 0-to-1 change are erased, only changed pages are programmed, and every sector is read back and verified. A summary reports sectors erased, pages programmed and sectors skipped. **CHIP ERASE** (confirmation required) is available separately.

The CH341A window is laid out compactly: a connection bar (with a **Notes** toggle for the short description), a toolbar, the three cards (status and protection, compare, I2C EEPROM) and the buffer preview. It uses the window's width, so it stays usable in a narrow window.

**Similar tools**: flashrom (CLI, \`ch341a_spi\` programmer), NeoProgrammer / AsProgrammer (Windows GUI), and the vendor CH341A programmer utilities. Unlike them this tool runs in the browser over WebUSB; it does not support chip layouts or multi-file projects, and Intel HEX files are not converted.

For a 24Cxx EEPROM, put it in the programmer's 8-pin socket, choose the type and device address in the **I2C EEPROM (24Cxx)** card, then use **READ EEPROM** (loads the buffer) or **WRITE EEPROM** (writes the buffer, verified by read-back). A missing chip reads as all \`FF\`.

---

### 2. CMSIS-DAP / DAPLink ARM Cortex-M SWD Debugger

**CMSIS-DAP** is the official microcontroller debug access port standard defined by Arm Limited. With a CMSIS-DAP probe (Raspberry Pi Debug Probe, DAPLink / micro:bit, LPC-Link2, EDBG, or a Picoprobe), Skon's USB Tool talks directly to the ARM CoreSight debug infrastructure inside the target over **Serial Wire Debug (SWD)**. **ST-Link is not CMSIS-DAP** and is not supported by this tab.

Two connect buttons: **CONNECT PROBE (WEBUSB)** for CMSIS-DAP v2 probes (bulk endpoints) and **HID PROBE** for v1 probes (older DAPLink firmware, micro:bit v1) over WebHID. SWD runs at 1 MHz by default. Next to them, the **connect under reset** checkbox holds nRESET low while attaching and then halts at the reset vector, which reaches chips that sleep or remap their SWD pins.

#### Supported Microcontroller Architectures:
The core is identified from its CPUID register: **Cortex-M0, M0+, M1, M3, M4, M7, M23, M33, M55 and M85** are recognised by name (anything else shows "unknown core"). Typical examples:
- **Cortex-M0 / M0+**: Raspberry Pi RP2040, STM32F0 / G0, Microchip SAMD21.
- **Cortex-M3**: STM32F103 (BluePill).
- **Cortex-M4**: STM32F401 / F411, Nordic nRF52840.
- **Cortex-M7**: STM32H7, Teensy 4.x (NXP i.MX RT1062).

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
3. In Skon's USB Tool, open the **Hardware Programmers Suite** and select the **CMSIS-DAP Debugger** tab.
4. Click **CONNECT PROBE (WEBUSB)** (or **HID PROBE**; tick **connect under reset** first if the chip will not attach). The tool performs the line reset and \`0xE79E\` JTAG-to-SWD switch, reads DPIDR and CPUID, and shows the probe, firmware, transport, DPIDR and core (for example "Cortex-M0+ r0p1").
5. Once connected, the top bar shows the target state (RUNNING or HALTED) and the control buttons: **RESET+HALT** (system reset, halted at the first instruction), **RESET+RUN**, **HALT**, **RUN** and **STEP** (one instruction), plus **LOAD ELF** and **DISCONNECT**. While the core runs, the tool polls and notices a self-halt (breakpoint or fault).
6. **CORE REGISTERS** lists R0-R12, SP, LR, PC, xPSR, MSP, PSP and PRIMASK; click a register while halted to edit it. Registers that changed since the last stop are highlighted. Under the list, xPSR is decoded (condition flags N/Z/C/V, Q, the Thumb bit and the active exception, for example \`HardFault\` or \`IRQ 3\`) and the PRIMASK / BASEPRI / FAULTMASK / CONTROL word is split into its fields (privilege level and active stack).
7. **MEMORY**: enter an address (default \`0x20000000\`, SRAM) and press Enter or the refresh button. Choose 16, 32, 64 or 128 words, and show them as 8-, 16- or 32-bit little-endian cells with an ASCII column (16 bytes per row). The arrow buttons page backwards and forwards, and the copy button puts a plain-text hex dump on the clipboard. **WRITE WORD** writes one 32-bit word to an address you give and reads it back; it warns if the value did not stick (flash, read-only memory or a peripheral register).
8. **FAULT ANALYSIS**: **READ FAULTS** reads CFSR, HFSR, MMFAR and BFAR from the System Control Block and lists every set bit with a plain-English meaning (MemManage, BusFault and UsageFault flags such as DACCVIOL, PRECISERR, UNDEFINSTR, DIVBYZERO, and HFSR FORCED). MMFAR and BFAR are shown only when the matching VALID bit is set. If the core is halted inside an exception handler (LR holds an EXC_RETURN value), it also reads the register frame the core stacked on entry (R0-R3, R12, LR, PC, xPSR) from MSP or PSP, so the stacked PC points at the faulting instruction (with a function name once an ELF is loaded). **CLEAR** writes 1s to CFSR and HFSR to clear the sticky bits. The fault registers use the ARMv6-M/v7-M/v8-M layout; Cortex-M0 and M0+ have no CFSR, so expect zeros or meaningless bits there, and the stacked-frame view assumes a basic (non-FP) frame layout for the first eight words.
9. **WATCH**: type an address (\`0x20000100\`) or, after loading an ELF, a symbol name with an optional offset (\`counter+4\`), then **ADD**. Each entry shows a 32-bit value in hex and decimal and turns amber when it changes. **REFRESH** reads once; **live** re-reads twice a second, including while the CPU runs (memory reads go through the debug access port and do not halt the core).
10. Below these, tabs add more tools: **RTT CONSOLE** (search RAM for the SEGGER RTT control block or give its address, read and send on channels), **SWO / ITM** (set the core clock and SWO baud; ITM stimulus text per port), **FLASH**, **BREAK / WATCH**, **DUMP** and **PERIPHERALS (SVD)**.
11. **FLASH** programs internal flash with the chip vendor's **CMSIS-Pack flash algorithm**: click **OPEN .PACK / .FLM**, choose the device and algorithm, set the RAM region used by the algorithm, then choose a firmware file (\`.bin\`, \`.hex\`, \`.elf\`; a plain \`.bin\` needs a "load at" address). Options: erase whole chip, verify, reset and run after. Click **PROGRAM FLASH**. Without a pack/FLM there is no flash programming; the tool has no built-in per-chip database. **MASS ERASE** (confirmation required) resets and halts the core, then runs only the loaded algorithm's EraseChip(), so it needs a loaded algorithm too. **UNLOCK nRF52** does ERASEALL through the CTRL-AP (access port 1) to recover a read-protected nRF52; it wipes all flash, UICR and RAM and asks for confirmation first.
12. **BREAK / WATCH**: **ENABLE BREAKPOINT UNITS**, then add hardware breakpoints ("BREAK AT", or **BREAK AT SYMBOL** once an ELF is loaded) and data watchpoints (1/2/4 bytes; on read, write or read/write).
13. **DUMP**: save an address range (flash, RAM or peripherals) to a \`.bin\` with **DUMP TO FILE**. Read-protected chips return errors or zeros.
14. **PERIPHERALS (SVD)**: click **OPEN .SVD** (a file of your own, or one from a loaded pack's "SVD from pack" list; files are kept in the browser and offered under "saved SVDs") to browse the chip's peripherals, with a filter box. Select a peripheral to list its registers (address, access, value, reset value). Reads happen on demand through the debug port (the per-register refresh button, or **READ ALL**); registers whose read has side effects are never read in bulk. Expand a register to see its decoded bit fields and write a field or the **WRITE WHOLE REGISTER** value.
15. **LOAD ELF** (shown once connected) reads function and variable names from an ELF so addresses display as \`main+0x12\`, and enables **BREAK AT SYMBOL** and symbol names in **WATCH**. The button then reads "ELF: <name> (<n>)", the number of symbols found.

#### Similar tools
PyOCD, OpenOCD, Keil uVision / Arm MDK, SEGGER Ozone and the VS Code Cortex-Debug extension cover the same ground. This tab has no source-level debugging, disassembly or GDB server: it is a low-level register, memory, RTT, SWO, flash and fault viewer that runs in the browser.

---

### 3. JTAG Boundary Scan & SVF Player

**JTAG (Joint Test Action Group - IEEE 1149.1)** is the universal hardware standard for digital IC testing, boundary scanning, and FPGA configuration. Using four dedicated digital signals, JTAG allows you to test circuit board interconnects without test probes, observe physical pin logic states, and configure or program devices from SVF scripts.

> **Hardware:** the JTAG tab drives the chain through a **CMSIS-DAP probe that supports JTAG** (DAPLink, Raspberry Pi Debug Probe, LPC-Link2), connected with **CONNECT PROBE (WEBUSB)**. FTDI/other USB-JTAG adapters are not supported. Without a probe, the page shows a demo pin grid for illustration only.

#### Supported Silicon & Targets:
Any JTAG device on the chain is listed with its IDCODE, version, part number and manufacturer (decoded from the JEDEC code). A built-in table names a few parts and fills in family, package, pin count and IR length: Xilinx Spartan-6 XC6SLX9 and Artix-7 XC7A35T / XC7A100T, Altera Cyclone IV E (EP4CE6 / EP4CE10), STM32F1 and STM32F405/407 boundary-scan TAPs, ARM CoreSight JTAG-DP (Cortex-M3/M4/M7) and the ESP32 Xtensa TAP. Other FPGAs, CPLDs and SoCs appear with their manufacturer and part code only.

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

**SVF (Serial Vector Format)** is an industry-standard ASCII language created by ASSET InterTech and Texas Instruments to describe JTAG test and configuration vectors. The player supports (comments with \`!\` or \`//\`):

| SVF Command | Syntax & Example | Operational Behavior |
| :--- | :--- | :--- |
| **\`FREQUENCY\`** | \`FREQUENCY 1000000 HZ;\` | Sets the TCK clock frequency on the probe. |
| **\`TRST\`** | \`TRST ON;\` | Drives the optional TRST line (if the probe exposes it). |
| **\`STATE\`** | \`STATE IDLE;\` | Drives TMS to move the TAP state machine to a specific state. |
| **\`ENDIR\` / \`ENDDR\`** | \`ENDDR IDLE;\` | Sets the stable state after shifts (RESET, IDLE, DRPAUSE, IRPAUSE only). |
| **\`SIR\`** | \`SIR 6 TDI (02);\` | Shifts an instruction into the Instruction Register. |
| **\`SDR\`** | \`SDR 32 TDI (00000000) TDO (01260093) MASK (FFFFFFFF);\` | Shifts data in and compares TDO against the expected value under MASK; stops at the first mismatch. |
| **\`RUNTEST\`** | \`RUNTEST 10000 TCK;\` | Clocks the TAP in Run-Test/Idle (or waits the given time). |
| **\`HDR\` / \`HIR\` / \`TDR\` / \`TIR\`** | \`HIR 0;\` | Header / trailer padding for daisy-chained devices. |

\`PIO\` and \`PIOMAP\` (parallel I/O) are not supported and raise an error.

</details>

#### Step-by-Step Tutorial: Scanning a JTAG Chain & Playing an SVF Script
1. Connect TCK, TMS, TDI, TDO and GND from your CMSIS-DAP probe to the target board.
2. In Skon's USB Tool, open the **Hardware Programmers Suite** and select the **JTAG / SVF Player** tab, then click **CONNECT PROBE (WEBUSB)**.
3. Click **SCAN JTAG CHAIN (READ IDCODE)**. The tool resets the TAP, reads the IDCODEs of every device in the chain and lists each with manufacturer, family, part, package, pin count and IR length where known (e.g. \`0x03628093\` is a Xilinx Spartan-6 XC6SLX9 with a 6-bit IR).
4. In **SVF BITSTREAM SCRIPT PLAYER**, click **LOAD .SVF FILE** (or paste commands into the text box). The SVF file comes from your vendor tool's export.
5. Click **EXECUTE SVF SEQUENCE**. A progress bar shows the current command; TDO checks run as the script goes, and the result reports the statements run and checks passed, or the failing line.
6. **PROBE PINS & BOUNDARY SCAN (SAMPLE)**: **READ PROBE PINS** shows the probe's pin levels. For boundary scan, pick the device, enter the IR lengths (TDO end first), the SAMPLE opcode and the boundary length from the device's BSDL file (or click **LOAD BSDL FILE** to fill them in and name the pins), then **SAMPLE BOUNDARY CELLS**. The table lists each port with IN/OUT values and a **DRIVE (EXTEST)** control to force a pin low/high (a confirmation warns this can damage hardware); **RESET TAP** returns the chip to normal.

#### JTAG tab extras
- **SVF summary**: under the script box, one line counts the statements, IR and DR bits shifted, TDO checks, and a lower-bound run time (shifted bits plus RUNTEST clocks at the script's FREQUENCY, plus fixed RUNTEST seconds). It is computed from the text only, so it works without a probe. Unknown commands and unsupported \`PIO\`/\`PIOMAP\` lines are listed as warnings, and a syntax error (such as a missing \`;\`) shows here and disables **EXECUTE SVF SEQUENCE** until fixed.
- **Boundary-scan table tools** (after a BSDL file is loaded and cells are sampled): **Filter port or pin** narrows the table by port name or package pin; **SNAPSHOT** saves the current sample and highlights every port whose IN, OUT or driver state differs in later samples (handy with the **live** checkbox while you press a button or move a probe); **CLEAR** stops comparing; **CSV** downloads the table (port, pin, input, output, driving).
- **OpenOCD chain snippet**: after a scan, a collapsible block lists \`jtag newtap chip tapN -irlen N -expected-id 0x...\` lines in scan order (TDO end first) for use with the OpenOCD command-line tool, with a **COPY** button. This tool does not run OpenOCD; the snippet is only an export. IR lengths come from the IR lengths field or the built-in table, and devices without a known IR length get a comment asking you to add \`-irlen\` from the BSDL file.
- Rarely needed text (the tool description and how sampling works) sits in collapsible sections to keep the window compact.

**Similar tools:** OpenOCD (chain config and SVF player), UrJTAG (BSDL-driven boundary scan, \`detect\`), Xilinx iMPACT / Vivado Hardware Manager, and Lattice Diamond Programmer. Unlike them, this one runs in the browser through a CMSIS-DAP probe and does not program devices from vendor bitstream formats other than SVF.

---

### 4. AVR ISP (In-System Programmer & STK500)

**AVR ISP** is the standard SPI-based programming protocol for 8-bit Microchip / Atmel microcontrollers (ATmega328P, ATmega2560, ATtiny85, ATtiny13A). It operates by holding the microcontroller's RESET line LOW while issuing 4-byte programming commands over the SPI bus.

> **Hardware:** the tool does not drive SPI pins itself. It speaks **STK500v1 at 19200 baud over WebSerial** to an **Arduino running the ArduinoISP sketch** (or any STK500v1 programmer); that programmer does the ISP. Wire the programmer's pins 10 / 11 / 12 / 13 to the target's RESET / MOSI / MISO / SCK. USBasp and other non-serial programmers are not supported.

#### Supported Silicon:
The chip database (\`src/utils/avrChipDatabase.js\`) lists 63 signatures across tinyAVR, ATmega and AT90USB parts, each with flash size, EEPROM size and flash page size (parts sharing a signature, such as the "A" / "PA" variants, appear once under a combined name). Fuse-guard bits, the EESAVE position and the Arduino default fuses are recorded only where known; without default fuses, **BURN AS BOOTLOADER** is disabled for that chip. A signature not in the list shows "Not in the chip list" and cannot be programmed.

#### Physical Wiring (Standard 6-Pin AVR ISP Header):
\`\`\`text
6-Pin ISP Header (Top View):
    [MISO]  (1) (2)  [VCC +5V]
    [SCK]   (3) (4)  [MOSI]
    [RESET] (5) (6)  [GND]
\`\`\`

<details>
<summary>Deep-Dive: AVR ISP 4-Byte Command Protocol & Memory Architecture</summary>

The tool sends these 4-byte ISP transactions to the programmer as STK500 *Universal* commands (flash pages go through STK500 *Prog Page* with read-back verify):

| Command Name | Byte 1 | Byte 2 | Byte 3 | Byte 4 | Description & Response |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **Programming Enable** | \`0xAC\` | \`0x53\` | \`0x00\` | \`0x00\` | Syncs interface. Target echoes back \`0x53\` on Byte 3 (done by the programmer's STK500 *Enter Progmode*). |
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
- **ATmega328P**: \`0x1E 0x95 0x0F\`; **ATmega168**: \`0x1E 0x94 0x06\`; **ATmega8**: \`0x1E 0x93 0x07\`; **ATmega1284P**: \`0x1E 0x97 0x05\`.
</details>

<details>
<summary>Deep-Dive: Fuse Bits & Clock Recovery Mechanics</summary>

Fuses configure the fundamental hardware behavior of the AVR processor. The **FUSES AND LOCK BITS** card shows each fuse as hex and as 8 binary digits and lets you edit L/H/E in hex (the lock byte is read-only; it is set by the bootloader burn). For the ATmega48/88/168/328 family (including P and PB parts) a decoded summary appears under the fuse cards: clock source and effective speed (with CKDIV8 applied), startup time, boot section size and brown-out level, plus one button per single-bit fuse (CKDIV8, CKOUT, RSTDISBL, DWEN, SPIEN, WDTON, EESAVE, BOOTRST) that toggles that bit in the field you are editing. Nothing is written until **WRITE FUSES**. Other chips show only the hex and binary values, with no bit decoding. Unlike flash memory, **a fuse bit is programmed when set to \`0\` (LOW)** and unprogrammed when set to \`1\` (HIGH):

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
1. Load the **ArduinoISP** sketch onto an Arduino and wire its pins 10 / 11 / 12 / 13 to the ATmega328P's RESET / MOSI / MISO / SCK (plus VCC and GND).
2. In Skon's USB Tool, open **Hardware Programmers** and select the **AVR ISP & Bootloader** tab.
3. The tab has two modes, **ISP (ARDUINOISP)** (this tutorial) and **BOOTLOADER UPLOAD** (see below). Click **CONNECT ARDUINOISP (SERIAL)** and pick the programmer's port. After a 2-second boot delay the tool syncs with the STK500 programmer, then enters programming mode and reads the signature (validating \`0x1E 0x95 0x0F\` for ATmega328P). **RE-READ CHIP** repeats this. The chip card shows the target, signature, flash/EEPROM size and current fuses.
4. In **FUSES AND LOCK BITS**, click **use these** next to "Arduino defaults for ATmega328P" (L=\`0xFF\`, H=\`0xDE\`, E=\`0xFD\`), then **WRITE FUSES**. Writes that would disable ISP (SPIEN, RSTDISBL, DWEN) need a second confirmation, and values are read back afterwards.
5. In **FLASH & BOOTLOADER**, click **LOAD .HEX FILE** and choose the bootloader hex from the Arduino IDE (for example \`hardware/arduino/avr/bootloaders/optiboot/optiboot_atmega328.hex\`). Nothing is built in.
6. Click **BURN AS BOOTLOADER (FUSES + LOCK)**: it erases the chip, writes the chip's default fuses with a temporary lock of \`0x3F\`, writes and verifies the hex, then sets the lock byte to the chip default (\`0x0F\` for ATmega328P). The bootloader's address (\`0x7E00\` for Optiboot) comes from the hex file.
7. For ordinary application code use **ERASE, WRITE & VERIFY HEX**, or **CHIP ERASE**.

**EEPROM and chip erase.** A chip erase wipes the EEPROM unless the EESAVE fuse is programmed. Before each erase the tool reads the high fuse and shows the consequence in the confirmation dialog; if the EEPROM would be lost the dialog starts with "WARNING". Tick **Keep EEPROM** to read the EEPROM before the erase and write it back afterwards (the success message then says "EEPROM restored").

**Read, verify, EEPROM.** The **Read, verify, EEPROM** group has **READ FLASH**, **VERIFY FILE** (\`.hex\`, \`.ihx\` or \`.bin\`), **READ EEPROM** and **WRITE EEPROM** (\`.hex\`, \`.eep\`, \`.bin\`; only differing bytes are written, then read back, with a confirmation first). The **Save as Intel HEX (otherwise raw .bin)** checkbox sets the export format for the reads. EEPROM goes through ISP byte commands, so a large EEPROM is slow at 19200 baud.

**Image size check.** After loading a hex, the button shows how much of the chip's flash it occupies, and a red note appears if it ends past the end of flash (in bootloader mode, past the space the board's bootloader leaves for a sketch).

**Export as avrdude commands.** The collapsible **Export as avrdude commands** section lists command lines for the CLI tool (\`avrdude -c stk500v1 -b 19200 -p <part>\`): read signature, write the fuses currently typed in the fields, write the loaded hex, read flash and read EEPROM, each with a **COPY** button. It is text only; this page never runs avrdude, and you replace \`<port>\` yourself. It is offered only for chips with a known avrdude part id. In bootloader mode it gives the matching \`avrdude -c arduino ... -D\` line for an ATmega328P board.

**Similar tools.** avrdude (command line), Microchip Studio / Atmel Studio (device programming dialog with fuse checkboxes), AVRDUDESS (GUI for avrdude with a fuse calculator) and the Engbedded fuse calculator web page. Unlike them, this runs in the browser over WebSerial and only with STK500v1 programmers (ArduinoISP); USBasp, Atmel-ICE and high-voltage programming are not available.

**BOOTLOADER UPLOAD mode.** For an Arduino that already has a bootloader (like \`avrdude -c arduino\`), no programmer, fuses or chip erase are involved. Pick the **Board** and **Baud rate** (115200, 57600, 38400 or 19200; the board choice sets a default), click **LOAD SKETCH .HEX FILE**, then **UPLOAD SKETCH**. The board is reset with DTR and talks STK500v1 (optiboot or ATmegaBOOT); pages are written and read back. The image must be the sketch (starting at 0) and fit below the bootloader. Boards with other bootloaders (Mega 2560 uses STK500v2, Leonardo/Micro use AVR109) are not supported.

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
    title: 'USB-PD Power Delivery — STUSB4500 Fixed-Voltage Trigger',
    summary: 'Request 5-20 V USB-C Power Delivery contracts through an STUSB4500 sink board wired to a Bus Pirate, read the negotiated contract, and edit the power-up PDOs stored in its NVM.',
    tags: ['USB-PD', 'Power Delivery', 'STUSB4500', 'Bus Pirate', 'USB-C', 'Voltage Trigger', 'Power Supply', 'NVM'],
    readTime: '20 min read',
    content: `
# USB-PD Power Delivery — Voltage Trigger & Monitor Manual

The **USB-PD Workbench** drives an **STMicroelectronics STUSB4500** USB-PD sink controller (for example the SparkFun Power Delivery Board) over I2C (address \`0x28\`) through a **Bus Pirate v3/v4** in binary mode, which the tool opens as a serial port (115200 baud, I2C at 100 kHz). Other controllers (FUSB302, CH224K, IP2721) are not supported. This guide documents Biphase Mark Coding (BMC) negotiation, Power Data Object (PDO) bitfields, how the tool requests a contract, and the STUSB4500 NVM, based on the USB-IF Power Delivery 3.0 specification and \`src/utils/usbPdDriver.js\`.

---

### 1. What Is USB-PD & Why Do You Need It?

Legacy USB Type-A ports supply only **5.0 Volts DC** at up to 2.4 Amperes (12 Watts). While sufficient for basic microcontrollers, modern bench testing demands variable voltages to power:
- Single Board Computers (9V or 12V for LattePanda, Orange Pi 5).
- Soldering Irons (20V for Pinecil, TS100, TS80P).
- Fixed-voltage bench or charging inputs (for example 12 V or 15 V rails).
- High-power radio transmitters and RF amplifiers.

The **USB-PD Workbench** turns a standard USB-C charger and an STUSB4500 board into a switchable **5 V to 20 V** supply (fixed voltages only, up to 5 A requested). The chip negotiates **fixed PDOs only: no PPS, no EPR (28-48 V)**, and it **does not measure VBUS voltage or current**, so check the output with a meter. Wiring: Bus Pirate MOSI = SDA, CLK = SCL, GND to GND, and Vpu to the board's 3.3 V for the pull-ups; the Bus Pirate's own supplies stay off because the board is powered from VBUS.

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
2. **Sink Request**: The sink controller (the STUSB4500, following the PDOs the tool programmed) evaluates the broadcast list, selects a voltage/current contract, and transmits a \`Request\` data message referencing the selected PDO index.
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
<summary>Deep-Dive: STUSB4500 Registers Used by the Tool</summary>

The STUSB4500 (I2C address \`0x28\`, device ID \`0x21\` or \`0x25\`) is read and written through the Bus Pirate:

| Register Offset | Register Name | Use |
| :---: | :--- | :--- |
| **\`0x2F\`** | **DEVICE_ID** | Checked on connect (\`0x21\` / \`0x25\`); anything else is refused. |
| **\`0x0E\`** | **PORT_STATUS_1** | Bit 0: a source is attached. |
| **\`0x91\`** | **RDO_STATUS** | 32-bit Request Data Object of the current contract (source PDO position, operating and max current, capability mismatch). |
| **\`0x70\`** | **DPM_PDO_NUMB** | Number of sink PDOs (1-3). |
| **\`0x85\`** | **DPM_SNK_PDO1..3** | The three 32-bit little-endian sink PDOs (voltage in 50 mV, current in 10 mA units). |
| **\`0x51\`** / **\`0x1A\`** | **TX_HEADER_LOW** / **PD_COMMAND_CTRL** | Write \`0x0D\` then \`0x26\` to send a PD soft reset so new sink PDOs are renegotiated. |

</details>

---

### 3. Interactive Workbench Features

Click **CONNECT STUSB4500 (BUS PIRATE)** and choose the Bus Pirate's serial port. The tool checks the chip ID, records the power-up PDOs, and shows the contract, request, event log and NVM panels. Nothing is shown before you connect: there are no simulated PPS sliders or VBUS meters, because the chip has neither.

#### 1. STUSB4500 Contract panel
- Shows **SOURCE** (ATTACHED / NONE), **CONTRACT** (which source PDO was taken), **OPERATING CURRENT** and **MAX CURRENT**, refreshed every 1.5 s by default. The header has an **update rate** selector (0.5, 1.5, 3 or 5 s), a **pause / resume** button, a **refresh** button and a **copy** button that puts a plain-text status report (contract and sink PDOs with watts) on the clipboard. The three **Sink PDOs** show voltage / current and the wattage of each ("off" for unused ones). A "capability mismatch" note appears if the charger could not satisfy any requested voltage above 5 V and the board fell back to 5 V.
- **Preset buttons 5 V, 9 V, 12 V, 15 V, 20 V** and a **V at A** field with **SET** request a fixed voltage (5-20 V) at a given current (up to 5 A, default 1.5 A). After a confirmation, the tool keeps PDO1 at 5 V, rewrites PDO2 in the chip's RAM with your voltage and sends a PD soft reset so the charger renegotiates. Choosing 5 V drops back to a single PDO. The tool checks the request first (5-20 V, above 0 A and at most 5 A), shows the requested wattage, and warns when the current is above 3 A (needs a 5 A e-marked cable) or the power is above the 100 W fixed-supply limit; an invalid request cannot be sent. This only works if the connected charger offers that voltage; these changes are **lost at power-off**.

#### 2. Event log
- Below the contract panel, a log records each change the tool sees while polling: source attached or removed, contract moved to another source PDO, operating/max current changes, capability mismatch and sink PDO changes. It keeps the last 200 entries; the download button saves them to a \`.txt\` file and **CLEAR** empties it. It only sees changes at the polling rate, and it is not a CC-line protocol capture.

#### 3. NVM: Power-Up PDOs (survive power-off)
- **READ NVM** reads the chip's NVM sectors and decodes the PDOs; **BACKUP** saves them to a \`.txt\` file; **RESTORE...** writes a backup file back (all 40 bytes, after confirmation).
- The editor sets the number of PDOs (1-3), PDO2/PDO3 voltage (5-20 V) and each PDO's current from the chip's fixed steps (0.5 to 5 A). **WRITE NVM** is enabled only when the NVM decodes to exactly the PDOs the chip loaded at power-up (the tool shows "Layout verified"); otherwise writing is disabled. Power-cycle the board and reconnect before reading if it says the layout is not verified. New PDOs apply after the next power-up. Check the output with a meter before connecting anything.

---

#### Similar tools
Hardware PD analyzers such as the Total Phase USB PD Analyzer, the TI PD Analyzer and the Infineon CY4500 decode full CC-line traffic, and the ChargerLAB KM003C meters VBUS and can request specific PD profiles. This tool does neither packet capture nor metering; it is a sink-side trigger with a contract readout.

### 4. Upstream Standards & Engineering Attribution

| Standard / Component | Authoring Organization / Manufacturer | Upstream Specification & Reference |
| :--- | :--- | :--- |
| **USB Power Delivery Specification (PD 2.0 / 3.0 / 3.1)** | USB Implementers Forum (USB-IF) | [USB-IF Power Delivery Specification](https://www.usb.org/usb-charger-pd) |
| **Type-C Cable & Connector Specification** | USB-IF Working Group (CC pin signaling, BMC 300kHz modulation, SOP framing) | [USB Type-C Specification](https://www.usb.org/developers) |
| **STUSB4500 USB-PD Sink Controller** | STMicroelectronics | [STUSB4500 product page](https://www.st.com/en/interfaces-and-transceivers/stusb4500.html) |
| **Bus Pirate** | Dangerous Prototypes / community | [Bus Pirate](https://buspirate.com) |
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
This tool bypasses the operating system's native Wi-Fi drivers using the WebUSB API. It loads a Rust-based WASM driver (\`@openipc-rs/web\`) to interface directly with the Alfa AWUS036ACH (RTL8812AU chipset), allowing for raw 802.11 frame capture (monitor mode) directly in the browser. The **Adapter** dropdown offers **Alfa RTL8812AU**, **Panda PAU09 (RT5572)** and **All Supported USB**; the supported chipset list is in section 44. The workbench is receive/analysis oriented (monitor mode and frame capture); there is no deauth or other attack function.

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
| Adapter | Select | Chooses the adapter profile: Alfa RTL8812AU, Panda PAU09 (RT5572), or All Supported USB (the device picker then lists every supported VID/PID). |
| Connect via WebUSB / Connect PAU09 via WebUSB | Button | Prompts the browser's native USB device picker; replaced by **Disconnect** once connected. Disabled during an offline PCAP replay. |
| Start Monitor / Stop | Button | Starts or stops monitor-mode capture on the connected adapter. |
| Pause / Resume | Button | Freezes packet ingestion without tearing down the USB interface. |
| Channel | Select | Sets the monitor channel (2.4 GHz and 5 GHz channels). |
| Auto-Hop Channels | Checkbox | Cycles the channel through 1, 6, 11, 36, 40, 44, 48 every 500 ms. |
| Wardriving Mode | Toggle | Turns on GPS coordinate tagging and dual-band auto-hop together. |
| RF Options | Dropdown | **GPS Coordinate Tagging** (browser Geolocation \`watchPosition\`), **Desktop Alerts (WIDS)**, **Physical RX Gain** slider (1-10), **Driver Guide** and **HW Status**. |
| Filtering | Popover | Min RSSI cutoff, ignore Data / Management / Control frames, target MAC filter (the pre-worker filter pipeline). |
| Sensitivity | Slider | RF sensitivity threshold, -100 to -50 dBm. |
| Session & Actions | Dropdown | Save Current Session, Load Saved Session (IndexedDB), Timeline Replay Scrubber, Save Baseline Snapshot, Stream Live to Disk, Upload .pcap File, Clear Telemetry Buffer. |
| Upload PCAP / Clear | Buttons | Replay an offline \`.pcap\` through the parser worker; clear devices, clients and packets. |
| Access Points / Clients / Roaming / Watchlist / Probing / Spectrum / Waterfall / Interference / Topology / Anomalies / Signal Map / Frames / Hex / Cleartext / Heuristics / Layer 3 / Rules | Tabs | The analysis views described below (Probing: stations sending Probe Requests; Spectrum: channel packet density; Topology: APs with orbiting clients and security colours; Anomalies: rotating-MAC suspects). |
| Signal Trend | Column | SVG sparkline of recent RSSI per transmitter. |
| Handshake | Column | Green lock when a complete WPA/WPA2 4-way handshake (M1+M2) is captured. |
| Distance | Column | Haversine distance (m) from the operator's GPS fix to the AP. |
| Signature | Column | IE tag sequence and a possible MAC-randomization flag. |
| Posture Score | Header Gauge | Circular 0-100 environment health score from open APs, legacy ciphers and anomalies. |
| Export PCAP | Button | Appears in the **PCAP buffer full** banner (50,000-frame ring buffer reached) to download the buffer as a Wireshark PCAP. |
| Export Device PCAP | Button | In a device's detail panel: downloads a PCAP containing only that device's frames. |
| Run TX Loopback Test | Button | In the hardware panel; disabled with "Transmit not supported by this chipset." on RX-only profiles. |
| Wi-Fi 6 Badge | Badge | Blue pill for 802.11ax HE capability and BSS Color. |

> **Export menu:** the **Export** dropdown next to **Session & Actions** offers **Export JSON**, **Export Wigle CSV**, **Export Executive Report** (HTML), **Export GeoJSON** and **Export KML**. It is disabled until at least one access point or client has been captured; GeoJSON and KML also need GPS-tagged devices. Next to it, **Import survey JSON** loads a JSON saved by **Export JSON** and merges it into the current session (see section 11), and a counter shows how many APs have **no GPS fix** (those are skipped by the Wigle, GeoJSON and KML exports). PCAP export stays in the buffer-full banner and the per-device panel, and there is no simulated RF mode: capture needs real hardware or a replayed PCAP.

### 4. Step-by-Step Engineering Walkthroughs
#### Walkthrough A: Getting Hardware Access on Windows
1. Download **Zadig**.
2. Select your Alfa adapter.
3. Replace the driver with **WinUSB**.
4. Refresh the tool and click "Connect".

#### Walkthrough B: Analyzing Captures in Wireshark
1. Capture with **Session & Actions > Stream Live to Disk** (writes a \`.pcap\` as it captures), or use **Export PCAP** from the buffer-full banner, or **Export Device PCAP** from a device's detail panel.
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
- **Interactive Click-to-Retune**: Clicking any channel bar on the spectrum graph immediately retunes the Alfa radio hardware to that channel.
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
- **Best-Signal Geotagging**: As 802.11 frames arrive over WebUSB, newly discovered Access Points and Client Stations are stamped with the operator's current \`latitude\`, \`longitude\`, \`accuracy\`, and \`altitude\`. After that the pin only moves when a later frame is at least **3 dB stronger** than the RSSI the stored position was taken at (\`bestRssi\`), so each AP ends up pinned where it was heard loudest rather than where it was last heard. Invalid fixes (out of range, or the 0,0 placeholder) are ignored.
- **Survey JSON Round Trip**: **Export JSON** writes a versioned survey file (access points, client stations, monitor channel). **Import survey JSON** validates it (valid BSSID/MAC keys, sane RSSI/channel/coordinate ranges, at most 5,000 APs, 20,000 clients and 25 MB) and merges it: new devices are added, live data wins for existing ones, and an existing AP's position only improves when the imported best signal is stronger. A bad file changes nothing and the status line says why.
- **Haversine Distance Estimation**: When GPS is active, the AP table calculates the approximate line-of-sight distance in meters between the operator and each discovered transmitter using the Haversine formula:
  $$\Delta\sigma = 2\arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)}\right)$$
  $$d = R \cdot \Delta\sigma \quad (R = 6,371,000\text{ m})$$
- **Wigle CSV Export (Export menu)**: the exporter fills the \`CurrentLatitude\`, \`CurrentLongitude\` and \`AccuracyMeters\` columns with tagged coordinates (\`0.0\` / \`0\` without GPS) to produce WigleWifi-1.4 files.

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
- **Leaflet & Vector Themes**: Supports a dark Esri gray basemap and OpenStreetMap standard layers with smooth recentering and interactive popup inspection.

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
- **Standalone Single-File HTML Reports**: The generator (\`downloadExecutiveReport\`, currently without a button in the UI) compiles all session metrics into a self-contained, beautifully styled HTML document.
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
- **Sequential Record Streaming**: As raw \`Uint8Array\` packet chunks arrive from hardware or a PCAP replay, the engine formats a 16-byte PCAP record header containing second/microsecond timestamps and packet length, immediately pushing both header and raw payload to the file stream.
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
- **Export menu**: use **Export > Export GeoJSON** or **Export > Export KML** (next to **Session & Actions**). Both report an error if no device carries GPS coordinates. PCAP export is in the buffer-full banner and the per-device panel.

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
| **Ralink RT5572** | \`0x148F\` : \`0x5572\` | 802.11a/b/g/n (N600) | 2.4 GHz & 5 GHz | 2x2:2 | Monitor Mode, TX Support, Dual Band, Packet Injection, RX Tuning | Panda Wireless PAU09, Alfa AWUS051NH v2, Alfa AWUS052NH |
| **Ralink RT5370** | \`0x148F\` : \`0x5370\` | 802.11b/g/n | 2.4 GHz | 1x1:1 | Monitor Mode, TX Support, Legacy 2.4GHz Monitoring | Panda Wireless PAU05 / PAU06, Raspberry Pi Wi-Fi, Generic RT5370 |

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
  - **Dark Vector View**: Dark Esri World Dark Gray basemap optimized for tactical wardriving and night operations.
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
| PCAP buffer full | Capture session exceeded 50,000 frames. | Enable "Stream Live to Disk" (Session & Actions) for unlimited capture, or click "Export PCAP" in the banner and clear the buffer. |
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


  },
  {
    id: 'fastboot',
    toolId: 'fastboot',
    category: 'programmers',
    title: 'Android Fastboot — Bootloader Unlock, Partition Flashing & Reboot',
    summary: 'Drive an Android device in bootloader/fastboot mode over WebUSB: read variables, unlock your own bootloader, flash (sparse-aware, A/B slots) and erase partitions, boot a transient image, flash a whole factory-image zip, and reboot.',
    tags: ['Fastboot', 'Android', 'Bootloader', 'Unlock', 'Flash', 'WebUSB', 'Partition', 'Recovery', 'A/B slots', 'Homelab'],
    readTime: '18 min read',
    content: `
# Android Fastboot — Bootloader & Partition Workbench

The **Fastboot** workbench talks to an Android device that is in **bootloader / fastboot mode** over WebUSB. Fastboot is Google's small, text-based protocol spoken by the bootloader before Android boots; it is how you read device variables, unlock the bootloader of a device you own, and flash or erase partitions.

> **Scope — owner operations only.** This tool issues standard fastboot commands. It can request a bootloader unlock, but the **phone itself** displays the confirmation and you approve it with the hardware keys; the unlock **wipes all user data**. It cannot bypass a screen-lock PIN, and it cannot defeat Factory Reset Protection or a Google/Samsung account lock — those are cleared by recovering the account and doing a normal factory reset, not by fastboot.

---

### 1. What is fastboot, and when do you see it?

Android devices expose several USB modes:

| Mode | What runs | Protocol | This tool |
| :--- | :--- | :--- | :--- |
| **Android** | The OS | ADB (when enabled) | — |
| **Recovery** | Recovery image | ADB / sideload | — |
| **Bootloader / fastboot** | The bootloader | **fastboot** | **Yes** |
| **fastbootd** | Userspace fastboot (in recovery) | fastboot | Yes |
| **Download / EDL** | Vendor loaders (Odin, Qualcomm EDL) | vendor-specific | No |

Enter fastboot mode by powering the device off and holding **Volume-Down + Power** (the exact keys vary by model), or from a running device with \`adb reboot bootloader\`.

---

### 2. The fastboot protocol

Fastboot is a request/response protocol on one **bulk endpoint pair**, on the USB interface with class \`0xFF\`, subclass \`0x42\`, protocol \`0x03\`. The host writes an ASCII command (at most 64 bytes); the device replies with one or more 4-byte-tagged packets:

| Tag | Meaning |
| :--- | :--- |
| \`OKAY\` | Success; the rest of the packet is the result value. |
| \`FAIL\` | The command failed; the rest is the reason. |
| \`DATA\` + 8 hex | The device is ready to receive (or send) that many bytes. |
| \`INFO\` / \`TEXT\` | Progress text; more packets follow. |

**Flashing** is a two-step dance: the host sends \`download:<size>\`, the device answers \`DATA<size>\`, the host streams exactly that many raw bytes into the device's download buffer and reads \`OKAY\`, then the host sends \`flash:<partition>\` to write the buffer. The \`max-download-size\` variable caps a single transfer; larger system images are split into **sparse** chunks.

---

### 3. UI control mapping

The **Android** tool has two tabs, **ADB** and **Fastboot**; the sidebar entries "Fastboot" and "ADB" just open it on the matching tab (only the selected mode holds the WebUSB claim). There is no demo/simulated device.

| UI Element | Purpose |
| :--- | :--- |
| **CONNECT FASTBOOT** | Opens a device in fastboot mode, claims the fastboot interface and reads \`getvar:all\`. **DISCONNECT** and **RE-READ VARS** appear once connected. |
| **DEVICE panel** | Product, bootloader version, serial, active slot, baseband, secure, max download size, partition count, and the BOOTLOADER LOCKED / UNLOCKED badge. On A/B devices, **slot A / slot B** buttons run \`set_active\`. |
| **BOOTLOADER LOCK: UNLOCK** | Sends \`flashing unlock\` (falling back to \`oem unlock\`). The phone asks you to confirm; this **wipes user data**. **RE-LOCK** sends the lock command (also wipes on most devices). |
| **Partition / Slot / CHOOSE IMAGE...** | Partition name (suggestions come from the device's variables), slot (current / A / B / both, on A/B devices) and the image file (raw or Android sparse). The tool shows the detected format (sparse, boot, vbmeta, ext4, EROFS or unknown) and how many pieces it will be split into if larger than \`max-download-size\`. **Pre-flash warnings** appear when the image is bigger than the \`partition-size\` variable, when its type does not match the partition (for example a vbmeta image for \`boot\`), or when the target is firmware or userdata. They are hints, not guarantees. **SHA-256** hashes the file so you can compare it with the published checksum. |
| **FLASH IMAGE** | Download handshake then \`flash:<partition>\` (confirmation first). The bootloader refuses it while locked. |
| **BOOT ONCE** | Downloads an image and \`boot\`s it without flashing. |
| **ERASE** | \`erase:<partition>\` (confirmation first). |
| **COPY CLI** | Copies the equivalent desktop command (for example \`fastboot --slot=all flash boot boot.img\`) to the clipboard. This is an export; nothing is run. |
| **FACTORY IMAGE (FLASH-ALL)** | **OPEN FACTORY ZIP...** reads a factory image zip (or its inner \`image-*.zip\`), checks the bootloader/baseband requirements against the device, lets you untick individual images, optionally **wipe user data** (like \`flash-all.sh -w\`), and **FLASH FACTORY IMAGE** runs the bootloader, radio, boot-type images, and fastbootd steps in order. Requires an unlocked bootloader; the whole zip is read into memory. **EXPORT SCRIPT** downloads a \`flash-all.sh\` with the same steps and your current selection and wipe setting, for the desktop \`fastboot\` tool (script only, it does not include the image files). |
| **REBOOT** | **System (Android)**, **Bootloader**, **Fastbootd (userspace)**, **Recovery**. |
| **COMMAND CONSOLE** (collapsed) | Sends one raw command, in CLI form (\`getvar all\`, \`oem device-info\`, \`reboot bootloader\`) or wire form (\`getvar:all\`), up to 64 bytes, with quick-fill chips for common \`getvar\` queries. Erase, format, lock/unlock, vendor wipe/fuse and partition-layout commands ask for confirmation. \`download\`, \`upload\`, \`boot\` and \`flash <file>\` are refused here because they need file data; use the Flash panel. Vendor \`oem\` commands differ by device and some are irreversible. |
| **All variables / LOG** | The full \`getvar:all\` table (collapsed) with **COPY** and **SAVE .TXT** in \`(bootloader) name: value\` format, and an activity log with copy and clear buttons. |

Every destructive action asks for confirmation first, and flashing/erasing is refused by the bootloader while it is locked.

---

### 4. Walkthrough: reclaim an old phone as a homelab box

1. Back up anything you still want — unlocking erases the device.
2. If the phone has a forgotten PIN or account, first do a normal factory reset and recover the Google/Samsung account; fastboot does not bypass those.
3. Boot to the bootloader and click **CONNECT FASTBOOT (WEBUSB)**. Confirm the product and serial.
4. **UNLOCK BOOTLOADER** and approve the prompt on the phone. It reboots and wipes.
5. Flash a custom recovery (\`flash recovery twrp.img\`) or a ROM per its install guide, or just re-lock and run the stock OS with **Termux** for small always-on services.
6. For a headless server, enable ADB and use \`adb tcpip 5555\` so you can reach it over the network.

---

### 5. Similar tools

The official desktop \`fastboot\` CLI (platform-tools), PixelFlasher, Google's Android Flash Tool (web) and fastboot.js cover the same ground. This tool has no backup/restore, ROM downloads or device-specific unlock-token flows; it does need a Chromium browser with WebUSB, and on Windows the device must use the WinUSB driver (Google USB driver or Zadig) to be claimable.

---

### 6. Implementation & Architecture

- **Image tools:** [\`src/utils/fastbootTools.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/fastbootTools.js) parses and splits Android sparse images, resolves A/B partition names, and reads and runs factory-image zips.
- **Driver:** [\`src/utils/fastbootDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/fastbootDriver.js) owns the protocol with no React or \`navigator.usb\` dependency: \`FastbootDevice\` serializes commands on the shared bulk pipe, \`parseResponse\` splits the tag, \`download()\` runs the DATA handshake and chunks the upload, and \`getAllVars()\` parses \`getvar:all\` (splitting on the **last** colon, since names like \`partition-type:boot\` contain colons).
- **Transport:** \`FastbootUsbTransport\` finds the class \`ff/42/03\` interface and its bulk endpoints.
- **Workbench:** [\`src/components/tools/FastbootWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/FastbootWorkbench.jsx) renders the device summary, the lock/flash/erase/boot/reboot panels, the command console and the variable table, with a confirmation on every destructive step.
- **Pre-flash and export helpers:** \`identifyImage\`, \`preflightChecks\`, \`prepareConsoleCommand\`, \`buildFlashAllScript\` and friends live in \`fastbootTools.js\` and are covered by [\`tests/fastbootPolish.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/fastbootPolish.test.js).
- **Tests:** [\`tests/fastboot.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/fastboot.test.js) and [\`tests/fastbootTools.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/fastbootTools.test.js) run the driver and image tools against a simulated bootloader covering getvar, the download handshake, lock-gated flashing, erase, slots, boot, factory zips and reboot.

---

### 7. References

| Resource | Source |
| :--- | :--- |
| Fastboot protocol | AOSP \`platform/system/core\` — \`fastboot/README.md\` |
| Android flashing & A/B | source.android.com — Flashing, A/B (Seamless) Updates |
| WebUSB | W3C WebUSB specification |
`
  },
  {
    id: 'adb',
    toolId: 'adb',
    category: 'programmers',
    title: 'Android ADB over WebUSB — Shell, File Transfer & Wireless',
    summary: 'Connect to an Android device with USB debugging enabled: device info, an interactive shell, streaming file push/pull (including whole folders), app manager with split-APK install, logcat, screen control, bugreport, restart ADB over Wi-Fi, and reboot — all in the browser, with the RSA "Allow USB debugging" handshake handled for you.',
    tags: ['ADB', 'Android', 'Shell', 'Push', 'Pull', 'WebUSB', 'RSA', 'adbd', 'Wireless', 'Homelab', 'Termux'],
    readTime: '20 min read',
    content: `
# Android ADB over WebUSB

The **ADB** workbench speaks the Android Debug Bridge transport protocol straight from the browser to a device that has **USB debugging** turned on. It is the companion to the Fastboot tool: once a phone is set up (reset, re-logged-in, ROM of your choice), ADB is how you actually use it — run commands, move files on and off it, and turn on wireless ADB so you can manage it headless.

> **Scope.** This does exactly what desktop \`adb\` does after you approve the on-device prompt. It is not a lock bypass: an unauthorized host never receives the device's \`CNXN\`, so the connect call simply reports that the prompt wasn't accepted.

---

### 1. The authentication handshake

ADB over USB is a small framed protocol: 24-byte headers (command, two args, length, checksum, magic) followed by a payload. The commands are \`CNXN\`, \`AUTH\`, \`OPEN\`, \`OKAY\`, \`WRTE\` and \`CLSE\`.

The interesting part is **AUTH**. When you connect:

1. The host sends \`CNXN\`.
2. adbd replies \`AUTH\` with a 20-byte random **token**.
3. The host signs the token with its RSA-2048 private key — **PKCS#1 v1.5 over the SHA-1 DigestInfo of the token** — and sends \`AUTH SIGNATURE\`.
4. If the device already trusts this key, it sends \`CNXN\` back and you're in. If not, the host sends \`AUTH RSAPUBLICKEY\` with its public key in Android's custom \`android_pubkey\` format, and the phone shows **"Allow USB debugging?"**. Tap *Always allow* and it remembers the key.

Web Crypto can't do step 3 directly (adbd's token is already a hash, and \`SubtleCrypto.sign\` would hash it again), so the tool generates the key with Web Crypto but performs the modular exponentiation with BigInt. The key is stored in the browser so the device keeps trusting it across sessions.

---

### 2. Streams and services

After \`CNXN\`, everything happens on **streams**. The host \`OPEN\`s a service by name; the device answers \`OKAY\` with its stream id; data flows as \`WRTE\` packets that the other side must \`OKAY\` (that acknowledgement is the flow control); either side ends it with \`CLSE\`.

| Service | What it does |
| :--- | :--- |
| \`shell:<cmd>\` | Runs a one-shot command; the output comes back as WRTE packets. |
| \`shell,v2:\` | The interactive shell (Android 7+, feature \`shell_v2\`): a pty with 1-byte-id / 4-byte-length framed stdin, stdout, stderr, exit code and window-size packets. |
| \`exec:<cmd>\` | A raw, unframed stream; used to pipe APK bytes into \`pm install-write\`. |
| \`sync:\` | The file-transfer sub-protocol: \`SEND\`/\`DATA\`/\`DONE\` to push, \`RECV\` to pull, each a 4-char id with a length (except \`DONE\`, whose second word is an mtime). Files are streamed in chunks rather than held in memory. When the device advertises \`stat_v2\` the tool uses \`STA2\`/\`LIS2\`, so sizes above 4 GiB are reported correctly (the old \`STAT\`/\`LIST\` wrap at 4 GiB). |
| \`tcpip:<port>\` | Restarts adbd listening on TCP so you can go wireless. |
| \`reboot:<target>\` | Reboots to system / bootloader / recovery / fastbootd. |

---

### 3. UI control mapping

ADB and Fastboot share the **Android** tool (tabs **ADB** / **Fastboot**; the sidebar entries open the matching tab). There is no demo/simulated device.

| UI Element | Purpose |
| :--- | :--- |
| **CONNECT ADB (WEBUSB)** | Opens the device and runs the auth handshake (approve the prompt on the phone); **DISCONNECT** afterwards. |
| **CANCEL** | Appears next to the connect button while a transfer, install or bugreport is running; aborts it. |
| **DEVICE tab** | Device summary from \`getprop\` (model, Android version, etc.), battery and screen size; **REFRESH**, **BUGREPORT**, **FORGET KEY**, **ALL PROPERTIES** (saves \`getprop.txt\`). **BUGREPORT** runs \`bugreportz -p\` on the device (Android 7+, a minute or two, with a progress bar), then saves the zip through your browser's save dialog; the device copy is left in place. **FORGET KEY** deletes this browser's ADB key after a confirmation, so the phone asks "Allow USB debugging?" again next time (the phone keeps listing the old key until you use Developer options > Revoke USB debugging authorizations). **WIRELESS: RESTART ADB OVER TCP/IP** (port field, default 5555); afterwards run \`adb connect <ip>:5555\` from any machine. **REBOOT**: System, Bootloader, Recovery, Fastbootd. |
| **SHELL tab** | **INTERACTIVE SHELL**: **START** opens a real pty (\`shell,v2\`), then a prompt line with **SEND**, Enter to send, Up/Down for history, and **CTRL-C**, **CTRL-D**, **CLOSE** and **CLEAR** buttons. It is a line-based terminal: full-screen programs (\`vi\`, \`top\`) do not render, so press Ctrl-C to leave them. If the device lacks \`shell_v2\` (before Android 7) START is disabled and a notice points you to the box below. **ONE-SHOT COMMAND**: a box with **RUN**, a history list and quick buttons (\`ps -A\`, \`df -h\`, \`ip addr\`, \`dumpsys wifi | grep mWifiInfo\`, \`settings list global\`, \`cat /proc/cpuinfo\`, \`dumpsys activity top | head -40\`, \`id\`); each run is a separate \`shell:\` command. |
| **FILES tab** | Browsable directory listing (starts at \`/sdcard/\`, breadcrumb and a path box you can type into), with size and modified time. **PUSH HERE** uploads the chosen file(s) by streaming them into the current folder; **PULL** downloads a file and **PULL FOLDER** downloads a directory recursively; the trash button deletes. Pulls stream straight to disk through the browser's save dialog where supported; otherwise the file is assembled in memory first and the log says so. For a folder, pick a destination directory (or, in browsers without that, get a zip built in memory, so keep it small); symlinks and unreadable files are skipped and a failing file is logged without stopping the rest. |
| **APPS tab** | Package list with a filter and a show-system-apps checkbox; a file picker plus **INSTALL**; per app **INFO**, **LAUNCH**, **STOP**, **SAVE APK**, **CLEAR DATA**, **UNINSTALL**. **INSTALL** takes one \`.apk\`, several \`.apk\` files of one app (a base plus its splits, installed together as a single \`pm install\` session), or one \`.apks\` / \`.xapk\` / \`.apkm\` bundle (the tool picks the splits matching the device's ABI, screen density and language, or \`universal.apk\` if present). Mixing a bundle with loose APKs is refused; a failed or cancelled session is abandoned cleanly. |
| **LOGCAT tab** | **START** / **STOP** polling (about once a second), level filter (V, D, I, W, E, F), text/tag/PID filter, **CLEAR**, **SAVE**. |
| **SCREEN tab** | **CAPTURE** a screenshot (optionally refresh every 1.5 s), **SAVE PNG**; click the screenshot to tap there; key buttons (HOME, BACK, APPS, POWER, VOL +/-, WAKE, ENTER, ...) and a type-text box. |
| **LOG** | Activity log of what the tool did. |

---

### 4. Walkthrough: a phone as a headless homelab box

1. Enable Developer options (tap Build number 7×), then turn on **USB debugging**.
2. **CONNECT ADB (WEBUSB)** and tap **Always allow** on the phone.
3. Install **Termux** (from F-Droid, via the **APPS** tab's **INSTALL**) and push any scripts or binaries your service needs from the **FILES** tab (**PUSH HERE**).
4. In **SHELL**, press **START** for an interactive shell and start your service (or set it up to start on boot with Termux:Boot).
5. On the **DEVICE** tab, **RESTART ADB OVER TCP/IP**, note the phone's IP, and from then on manage it over Wi-Fi with no cable.

---

### 5. Implementation & Architecture

- **Crypto:** [\`src/utils/adbCrypto.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/adbCrypto.js) — RSA key generation, \`android_pubkey\` encoding (modulus, Montgomery \`n0inv\` and \`rr\`), and PKCS#1 v1.5 token signing by BigInt modexp.
- **Protocol:** [\`src/utils/adbDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/adbDriver.js) — message framing, the CNXN/AUTH handshake (the host advertises \`shell_v2\` and \`stat_v2\`), the OPEN/OKAY/WRTE/CLSE stream with flow control, and the shell / shell_v2 / sync (streaming push and pull, STA2/LIS2) / tcpip / reboot services.
- **Device tools:** [\`src/utils/adbTools.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/adbTools.js) — \`getprop\`/battery/package parsing, single and split-APK install (\`pm install-create\` / \`install-write\` / \`install-commit\`), bundle split selection, uninstall, logcat polling, recursive folder pull, \`bugreportz\` runner, the line-based terminal model, input commands and screenshot (\`screencap\`) decoding.
- **Workbench:** [\`src/components/tools/AdbWorkbench.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/AdbWorkbench.jsx).
- **Tests:** [\`tests/adbCrypto.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/adbCrypto.test.js) proves a signed token verifies as a valid PKCS#1 block and the public-key blob round-trips; [\`tests/adb.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/adb.test.js) runs the full handshake, shell, and file push/pull against a simulated adbd; \`tests/adbStreaming.test.js\` and \`tests/adbInstall.test.js\` cover shell_v2, streaming transfers, stat_v2, split-APK install and bugreport.

---

### 6. References

| Resource | Source |
| :--- | :--- |
| ADB protocol | AOSP \`system/core/adb/protocol.txt\`, \`SERVICES.TXT\` |
| Public key format | AOSP \`libcrypto_utils/android_pubkey.c\` |
| WebUSB | W3C WebUSB specification |
`
  },
  {
    id: 'dfu',
    toolId: 'dfu',
    category: 'programmers',
    title: 'WebUSB DFU Flasher — STM32 & DfuSe Firmware Download',
    summary: 'Flash firmware onto microcontrollers with USB DFU 1.1 and ST DfuSe bootloaders directly from the browser: layout-aware sector erase, DFU suffix check, .bin / .dfu / .hex files, read-back, verify and compare-with-file, .dfu export, vector-table sanity check, dfu-util command export, alt-setting selection, and detach to DFU mode.',
    tags: ['DFU', 'DfuSe', 'STM32', 'Firmware', 'WebUSB', 'Bootloader', 'Flasher', 'GD32', 'ARM'],
    readTime: '16 min read',
    content: `
# WebUSB DFU Flasher — USB DFU 1.1 & ST DfuSe Manual

The **WebUSB DFU Flasher** talks directly to USB devices exposing a **Device Firmware Upgrade (DFU)** interface. It implements both the official USB-IF DFU 1.1 standard and STMicroelectronics' proprietary **DfuSe** protocol extension, enabling in-browser flashing of STM32, GD32, and other ARM Cortex-M microcontrollers without installing ST-Link utilities or DfuSe Demonstration software.

---

### 1. What is USB DFU and ST DfuSe?

USB DFU defines a standard USB device class (\`0xFE\`, subclass \`0x01\`) that allows microcontrollers to update their on-chip firmware over a standard USB cable.

| Protocol Variant | USB BCD Version | Key Characteristics | Target Hardware |
| :--- | :--- | :--- | :--- |
| **Standard DFU 1.1** | \`0x0100\` / \`0x0110\` | Linear block download without explicit memory address pointers. | Generic MCUs, Atmel, GD32, keyboards. |
| **ST DfuSe** | \`0x011A\` | Extended protocol supporting random-access flash addresses, page erase commands, and memory map string parsing. | STM32 built-in system memory bootloaders (STM32F0/F1/F2/F3/F4/F7/G0/G4/H7). |

---

### 2. DFU Protocol Mechanics & State Machine

USB DFU executes entirely over **Control Endpoint 0** using vendor/class requests (\`bmRequestType = 0x21\` for host-to-device, \`0xA1\` for device-to-host):

| Request Code | Value | Direction | Purpose |
| :--- | :--- | :--- | :--- |
| \`DFU_DETACH\` | \`0\` | Out | Requests device transition from runtime to DFU mode. |
| \`DFU_DNLOAD\` | \`1\` | Out | Transfers a payload block of firmware data (or DfuSe command). |
| \`DFU_UPLOAD\` | \`2\` | In | Reads back flashed memory blocks for readback verification. |
| \`DFU_GETSTATUS\` | \`3\` | In | Reads the 6-byte status response: status code, poll timeout (ms), and current state. |
| \`DFU_CLRSTATUS\` | \`4\` | Out | Clears sticky error states (\`dfuERROR\`) back to \`dfuIDLE\`. |
| \`DFU_GETSTATE\` | \`5\` | In | Returns the raw 1-byte state without clearing status flags. |
| \`DFU_ABORT\` | \`6\` | Out | Aborts ongoing download or upload operations. |

#### ST DfuSe Command Framing
ST DfuSe multiplexes command transactions through \`DFU_DNLOAD\` with block number \`0\`:
- **Set Address Pointer (\`0x21\`):** \`[0x21, addr_0, addr_1, addr_2, addr_3]\` (Little-endian 32-bit base address).
- **Page Erase (\`0x41\`):** \`[0x41, addr_0, addr_1, addr_2, addr_3]\` (Triggers non-volatile flash page erase at target address).
- **Mass Erase (\`0x41\` without address):** Erases all flash sectors. The tool only sends it when you explicitly tick **Mass erase** (see below); it never falls back to a mass erase on its own.

#### DfuSe Memory Map (parsed by the tool)
DfuSe devices name each alternate interface setting with a structured string descriptor, for example:
\`\`\`text
@Internal Flash  /0x08000000/04*016Kg,01*064Kg,07*128Kg
\`\`\`
That means a base of \`0x08000000\` and sectors of 4 x 16 KB, 1 x 64 KB and 7 x 128 KB; the trailing letter says whether a group is readable / erasable / writable. The tool reads this string for every alt setting, builds the sector table, and uses it to **erase only the sectors that overlap the image** (it refuses an image that falls outside the layout or into a non-erasable sector). If a string cannot be parsed, the **Memory / alt-setting** panel shows "Layout not understood" and you fall back to the manual page-size or mass-erase options below.

---

### 3. Step-by-Step Flashing Workflow

1. **Enter DFU Bootloader Mode:**
   - Pull **BOOT0** high (to 3.3V) and momentarily toggle **RESET / NRST**.
   - Plug the board directly into your computer via a data USB cable. On Windows an ST DFU device may need the WinUSB driver (Zadig).
   - If the device is running its application and exposes only a DFU *runtime* interface (protocol 1), the tool reports that it cannot be flashed in that mode and shows **Detach to DFU mode**, which sends \`DFU_DETACH\`; wait for it to re-enumerate and select it again. Otherwise reboot it into its bootloader with the boot button or BOOT0.
2. **Connect via WebUSB:**
   - Click **Select DFU Device** in the DFU Flasher and choose the device in the browser prompt (the chooser is filtered to USB class \`0xFE\` subclass \`0x01\`; an STM32 ROM bootloader is typically VID \`0x0483\` / PID \`0xDF11\`).
   - The Device panel shows **Interface**, **Transfer** size, **DFU ver** and **Mode** (**DfuSe (ST)** or **DFU 1.1**). If the device has several alternate settings (internal flash, option bytes, external flash...), pick one in **Memory / alt-setting**; the sector count and address range of the selected one are shown, and **Target flash address** and the read length default to its start and size.
3. **Select Firmware File:**
   - Click **Load .bin / .dfu / .hex** and choose a raw binary (\`.bin\`), an Intel HEX file (\`.hex\`, which supplies its own start address), or a structured ST DfuSe image (\`.dfu\` / \`.dfuse\`). If the file has a DFU suffix, its CRC and target VID:PID are shown; a mismatch with the connected device prompts a confirmation. **Clear** unloads the file.
   - Under the file name the tool shows extra checks. For a raw image whose first two words look like a Cortex-M vector table (stack pointer in RAM, odd reset vector) it prints them and warns if the reset vector lies outside the image or the selected memory (a sign it was linked for another address). Other data is not checked. On a device with a sector layout it also shows an **Erase plan** (how many sectors and bytes will be erased, or why the image does not fit).
   - **Save as .dfu** (raw \`.bin\` / \`.hex\` only) packs the loaded image and its target address into a standard DfuSe container with a DFU suffix and downloads it. If a device is connected, the suffix carries its VID:PID and the selected alt setting; otherwise it uses wildcard IDs (\`ffff:ffff\`).
   - For a \`.bin\` on a DfuSe device, set the **Target flash address** (defaults to the start of the selected memory, \`0x08000000\` on STM32). Erasing then works in this order: the device's own sector layout if it reported one (the **Erase page size** box is hidden); otherwise the **Erase page size** you enter (STM32F1: 1024 or 2048); otherwise the explicit **Mass erase** option. If none applies the flash is refused rather than guessed. A \`.dfu\` file carries its own addresses and alternate-setting targets.
4. **Flash:**
   - Choose the options: **Verify after write (read back)** (on by default), **Jump to application after flash** (on by default), and **Mass erase (wipes the whole flash; asks to confirm)**, which wipes the whole flash after a confirmation and is only used when the device reported no sector layout.
   - Click **Flash Firmware**. The tool erases, then streams blocks of the interface's transfer size (read from the DFU functional descriptor, 1024 bytes if absent) with \`DFU_DNLOAD\`, polling \`DFU_GETSTATUS\` between blocks, and runs the manifestation phase. On DfuSe, **Verify** then reads each written range back with \`DFU_UPLOAD\` and compares it, naming the first differing address on a mismatch. Plain DFU 1.1 downloads have no read-back verification.
5. **Read back or compare (optional):**
   - **Compare with file** reads the device back over the loaded file's range(s) and reports the first differing address, without writing anything. It needs a DfuSe device or a device with a reported layout.
   - **Read length (bytes)**, a **From address** field (DfuSe) and **Read device to .bin** dump the device with \`DFU_UPLOAD\` to a file named like \`dfu-read-<address>-<length>.bin\`. The read stops at the requested length or at the first short packet, so a protected device may return less than you asked for.
   - The collapsible **dfu-util equivalent** section shows the matching \`dfu-util\` command lines (\`-d vid:pid -a alt -D file -s addr:leave\` to flash, \`-U file -s addr:length\` to read) with **Copy** buttons. It is only text for the CLI tool; this page never runs it.
6. **Reboot to Application:**
   - With **Jump to application after flash** ticked, the tool sends the DfuSe leave sequence (set address plus a zero-length download) and the device starts the new firmware. Untick it to stay in DFU mode, for example to flash another alt setting. If a plain DFU device does not restart by itself, tie BOOT0 back to GND and press reset. **Disconnect** just releases the device.

---

### 4. Implementation & Architecture

Similar tools: dfu-util (CLI), STM32CubeProgrammer and the legacy ST DfuSe Demo (GUI), dfuse-pack (.dfu packer). This page covers download, upload, verify and .dfu packing in the browser; it does not edit option bytes or run on non-WebUSB browsers.

- **Driver:** [\`src/utils/dfuDriver.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/dfuDriver.js) — USB DFU 1.1 / DfuSe driver: state machine polling, DFU interface and functional-descriptor discovery, DfuSe memory-layout parsing and sector-erase planning, DFU suffix and DfuSe image parsing, block chunking, upload, verify, leave and detach.
- **Workbench:** [\`src/components/tools/DfuFlasher.jsx\`](https://github.com/olosnoks/usb-tool/blob/main/src/components/tools/DfuFlasher.jsx) — device panel with alt-setting picker, firmware loader (.bin / .dfu / .hex) with DFU-suffix check, address/page-size inputs, erase/verify/leave options, read-back, progress bar and session log.
- **Helpers:** [\`src/utils/dfuExtras.js\`](https://github.com/olosnoks/usb-tool/blob/main/src/utils/dfuExtras.js) — .dfu container writer, vector-table check, erase-plan summary, dfu-util command builder. The DFU suffix signature is written as the standard bytes \`55 46 44\` ("UFD"); the reader accepts that and the reversed order.
- **Tests:** [\`tests/dfuExtras.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/dfuExtras.test.js), [\`tests/dfuDriver.test.js\`](https://github.com/olosnoks/usb-tool/blob/main/tests/dfuDriver.test.js).
`
  }
];
