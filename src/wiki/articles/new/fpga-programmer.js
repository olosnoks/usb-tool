export default {
  id: 'fpga-programmer',
  toolId: 'fpga-programmer',
  category: 'programmers',
  title: 'FPGA Programmer — Lattice iCE40 over FTDI MPSSE (WebUSB)',
  summary: 'Loads iCE40 bitstreams (.bin) into the FPGA SRAM or into the board SPI flash through an FTDI FT2232H or FT232H, using MPSSE over WebUSB. The flash path erases, programs and verifies, like iceprog. It can also dump the flash to a .bin file, erase the whole chip, and show equivalent iceprog and openFPGALoader command lines. Not yet tested on hardware.',
  tags: ['FPGA', 'iCE40', 'iCEstick', 'iCEBreaker', 'UPduino', 'Alchitry Cu', 'FTDI', 'MPSSE', 'FT2232H', 'FT232H', 'iceprog', 'bitstream', 'SPI flash', 'WebUSB', 'Zadig'],
  readTime: '7 min read',
  content: `
# FPGA Programmer (Lattice iCE40)

The **FPGA Programmer** configures Lattice iCE40 FPGAs from a \`.bin\` bitstream. It talks to the board's FTDI chip directly from the browser: the FTDI runs in MPSSE mode, so the app drives SPI and the control pins itself, the same way the open-source \`iceprog\` tool does. Nothing is installed on the PC except the WinUSB driver on Windows (see below).

> **Not tested on hardware.** The protocol code is covered by unit tests against a simulated FTDI, flash and FPGA, but it has not been run on a real iCEstick, iCEBreaker, UPduino or Alchitry board. Treat the first run as a test: check the pin mapping for your board, and read back or keep a copy of the existing flash contents before you write it.

## Supported hardware

| Board | FTDI chip | Preset |
|---|---|---|
| iCEstick | FT2232H (interface A used) | iCEstick (HX1K) |
| iCEBreaker | FT2232H (interface A used) | iCEBreaker (UP5K) |
| UPduino v3 | FT232H | UPduino v3 (UP5K) |
| Alchitry Cu | FT232H | Alchitry Cu (HX8K) |
| Other iCE40 boards | FT2232H or FT232H | Generic |

The presets set the labels, notes and default settings only. All of them use the iceprog pin mapping below. The UPduino and Alchitry presets assume that mapping too; check your board schematic first, because a board that routes SPI differently will not program correctly.

The FTDI channel used is **interface A (interface 0)**. The UART on channel B of an FT2232H is not touched.

## Pin mapping

| FTDI pin | Signal | Direction |
|---|---|---|
| ADBUS0 | SCK | output |
| ADBUS1 | MOSI | output |
| ADBUS2 | MISO | input |
| ADBUS4 | CS (FPGA SS and flash CS) | output |
| ADBUS6 | CDONE | input |
| ADBUS7 | CRESET | output |

## Requirements

- **Chromium-based browser** (Chrome, Edge, Opera) over HTTPS or localhost. WebUSB is not available in Firefox or Safari.
- **Windows:** WebUSB needs the WinUSB driver on interface A. Open **Zadig**, choose the FTDI device, and select the entry for **Interface 0** (for an FT2232H it is labelled something like "Dual RS232-HS (Interface 0)"). Install **WinUSB** for that interface only. Do not replace the driver on the other interface: the second channel is the board's UART and stays on the FTDI driver. Installing WinUSB on interface 0 also means the serial port of that channel stops working in other apps until you restore the driver.
- **Linux:** the kernel \`ftdi_sio\` driver claims interface 0. Unbind it from interface 0 (or use udev rules for WebUSB access) before connecting.

## Step by step

1. Pick the **board preset** and the **SPI clock**. 15 MHz is the default; use a lower clock if the wiring is long or the programming fails.
2. Click **CONNECT FTDI (WEBUSB)** and choose the device. The log shows the MPSSE setup.
3. Click **DETECT FLASH** to read the SPI flash JEDEC ID. It shows the manufacturer and capacity. If no flash answers, the tool stops with a message; check power, wiring and the preset.
4. Click **CHOOSE .BIN** and pick an icepack bitstream. The file must contain the iCE40 sync word \`7E AA 99 7E\` within its first 8 KB. A missing \`FF 00\` leader is only a warning.
5. Choose what to do:
   - **PROGRAM SRAM (VOLATILE):** loads the bitstream into the FPGA. It is lost at power-off. The panel shows CDONE after the load: HIGH means the FPGA started.
   - **PROGRAM FLASH (ERASE + VERIFY):** erases the 4 KB sectors (64 KB blocks where a full block fits) that cover the bitstream, programs it page by page, reads it back and compares, and then releases reset so the FPGA boots from flash. The **flash offset** (decimal, or hex with a 0x prefix) is where byte 0 of the bitstream goes; it defaults to 0.
   - **VERIFY FLASH:** reads back the bitstream range at the offset and compares it with the loaded file. It does not change the flash.
   - **DUMP FLASH:** reads flash from the **flash offset** for the **dump length** (decimal or 0x hex; leave it blank to read to the end of the chip, which needs the size from DETECT FLASH) and saves it as \`flash-<offset>-<length>.bin\`. The result line shows the CRC-32 of the dump and whether the range is blank (all 0xFF). The FPGA is held in reset while reading and released afterwards. Use it to back up a board before you reflash it.
   - **ERASE CHIP:** after a confirmation prompt, sends the chip-erase command (0xC7) and waits for the flash to finish (up to 2 minutes). This removes everything on the flash.
6. **STOP** ends the job after the current USB transfer. A stopped flash write leaves the FPGA held in reset; load the bitstream again or power-cycle the board.
7. **DISCONNECT** releases CRESET so the FPGA runs again.

## Other panels

- The loaded file line shows its size and CRC-32, so you can compare a file with a dump.
- **EQUIVALENT CLI COMMANDS** (collapsed) lists \`iceprog\` and \`openFPGALoader\` command lines for SRAM, flash and verify, using your file name and flash offset. They are text to copy; the app never runs them. The openFPGALoader board and cable names are generic (\`-b ice40_generic\`, \`-c ft2232\` or \`ft232\`); check \`--list-boards\` and \`--list-cables\` for your board.
- The log can be copied or cleared.

## How the flows work

- **SRAM:** CRESET is pulled low with CS low, released, and the bitstream is clocked out on MOSI with CS still low, followed by 8 zero bytes (64 clocks, the iCE40 needs at least 49). CDONE is then read.
- **Flash:** the FPGA is held in reset so it does not drive the shared SPI bus. The app reads the JEDEC ID (0x9F), erases with 0x20 (4 KB) or 0xD8 (64 KB), and sets the write enable (0x06) before each erase and each page program (0x02, 256-byte pages). It polls the status register (0x05) until WIP clears after every erase and page. Readback (verify and dump) uses 0x03; chip erase uses 0xC7.

## Limits and what it does NOT do

- Not tested on hardware (see the warning above).
- No status-register protection changes, no OTP or SPI-flash security settings.
- No \`.asc\`, \`.hex\` or \`.bin\` conversion; use icepack first and load the \`.bin\` output.
- No cancellation inside a single USB transfer; a stalled transfer waits for the device.
- Flash speed is limited by one USB round trip per page, so a large image takes a while.
- Multi-board or hot-plug handling is not implemented; reconnect after unplugging.

## Troubleshooting

- **"WebUSB is not available"**: use Chrome or Edge on HTTPS or localhost.
- **"Could not claim interface A"**: WinUSB is not bound to interface 0. Run Zadig again, or unbind ftdi_sio on Linux.
- **"No SPI flash answered"**: check the flash power and the ADBUS wiring, and that the preset matches the board. A JEDEC of all 0x00 or all 0xFF means nothing is driving the bus.
- **CDONE stays LOW after SRAM load**: the bitstream may be for a different FPGA part, or the SPI wiring is wrong. Confirm the part (UP5K, HX1K, HX8K) matches the one on the board.
- **Verify failed**: the readback did not match the file at the reported address. The FPGA stays in reset; reprogram. A consistent failure at one address can mean a worn or faulty flash, or a too-fast clock.
- **Timed out waiting for FTDI data**: the device stopped answering. Disconnect, reconnect, and try a lower clock.

## Similar tools

This tool follows the flow of iceprog (SRAM, flash, verify, offset, chip erase, read) and the open-source openFPGALoader, which supports many more vendors and cables. Vivado Hardware Manager is the equivalent for Xilinx devices and is not related to this code. Unlike the command-line tools, this one is limited to iCE40 with FTDI MPSSE adapters.

## Related tools in this app

- **Hardware Programmers** (the sidebar entry for CH341A, CMSIS-DAP, JTAG and AVR) covers other programming jobs.
- **CH341A** and **FX2** tools also need WinUSB bound with Zadig on Windows; the steps are the same.
`,
};
