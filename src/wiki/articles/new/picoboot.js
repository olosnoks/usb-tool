export default {
  id: 'picoboot',
  toolId: 'picoboot',
  category: 'core',
  title: 'Picoboot — RP2040 / RP2350 PICOBOOT flash over WebUSB',
  summary: 'Talks to a Raspberry Pi RP2040 or RP2350 in BOOTSEL mode over its PICOBOOT vendor interface: shows chip and vector-table info, reads flash to a .bin, writes a .bin or .uf2 with 4 KB erase, verifies by read-back, and reads the pico-sdk binary_info block. Untested on real hardware.',
  tags: ['RP2040', 'RP2350', 'PICOBOOT', 'BOOTSEL', 'WebUSB', 'Raspberry Pi Pico', 'UF2', 'flash', 'binary_info', 'picotool'],
  readTime: '6 min read',
  content: `
# Picoboot — RP2040 / RP2350 PICOBOOT flash over WebUSB

The **Picoboot** tool talks to a Raspberry Pi **RP2040** or **RP2350** directly over the **PICOBOOT** vendor interface. It works without picotool, without the UF2 drive and without a serial port. Everything runs in your browser.

> **Status: untested on hardware.** The protocol encoding, the UF2 and flash-layout logic, and the binary_info decoder are covered by unit tests with crafted buffers. No real RP2040 or RP2350 has been driven through this tool yet. Treat the first real write as a test of the tool itself and keep a backup of your flash.

## Supported hardware and modes

| Chip | USB id (BOOTSEL) | Reboot to app | Reboot to BOOTSEL |
|---|---|---|---|
| RP2040 (Pico, Pico W, and boards built on it) | \`2e8a:0003\` | Sent with the RP2040 REBOOT command; untested | Not implemented here; use the BOOTSEL button |
| RP2350 (Pico 2 and boards built on it) | \`2e8a:000f\` | REBOOT2 normal boot; untested | REBOOT2 BOOTSEL; untested |

The board must be in **BOOTSEL mode**: hold the BOOTSEL button while plugging it in, or reboot a running program into BOOTSEL first. In application mode the board shows a different USB id (serial or other class) and PICOBOOT is not present, so the connect step reports that.

## Requirements

- **Chromium-based browser** (Chrome, Edge, Opera) on a desktop. WebUSB is not available in Firefox or Safari, and it needs a secure context (HTTPS or localhost).
- **Windows:** the PICOBOOT interface is a vendor-class interface. If the connect step reports that the interface cannot be claimed, it may need the WinUSB driver for that interface (Zadig). This has not been checked on Windows yet.
- The board's mass-storage (UF2 drive) interface belongs to the operating system. This tool claims **only** the PICOBOOT interface, so the drive can stay mounted.

## Step by step

1. Put the board in BOOTSEL mode and press **CONNECT PICOBOOT (WEBUSB)**. Pick the Raspberry Pi device in the browser dialog.
2. The tool claims the PICOBOOT interface, resets it, requests **exclusive access** and reads the first 64 KB of flash (\`0x10000000\`).
3. Read the **Device** panel: chip name from the USB product id, interface and endpoint numbers, the vector table stack pointer and reset vector. A stack pointer in RAM and a reset vector in flash mean the flash holds a normal program.
4. Read the **binary_info** panel (see below) and the **First 256 bytes** dump.
5. To save flash, enter an offset and length (hex like \`0x010000\` or decimal) and press **READ AND DOWNLOAD**. The result is a .bin file. Reads are split into 4 KB chunks, and the progress bar shows how far along it is.
6. To write, choose a **.bin** or **.uf2** file:
   - **.uf2** carries its own target addresses. The tool converts them into flash offsets from \`0x10000000\`; the offset field is ignored.
   - **.bin** is written at the **offset** you enter (default \`0x000000\`).
   The plan line shows the erase range and the program range. Tick the confirmation box, then press **ERASE, WRITE AND VERIFY**.
7. Writing erases every 4 KB sector the image touches, programs the image padded to 256-byte pages with 0xFF, and then reads the whole range back and compares it. The result line says either "Verify OK" or the number of differing bytes and the first address that differs.
8. Use **reboot to app** to start the program, or **reboot to BOOTSEL (RP2350)** to go back into the bootloader for another write. The board disconnects during a reboot; reconnect afterwards.

## Erase behaviour

Flash is erased in 4 KB sectors. Writing a .bin at an offset that is not sector-aligned erases the whole sector(s) it touches, so any existing data in those sectors outside your image is lost. The plan line states the exact erase range before you confirm.

## binary_info (picotool info)

The pico-sdk embeds a **binary_info** table in a program's flash image: program name, version and similar strings, plus pin usage. Picoboot scans the first 64 KB of flash for the binary_info header and decodes the entries it can read:

- **String and integer entries** tagged with \`RP\` (the tag reserved for Raspberry Pi use) are listed under the panel as program information.
- **Pin entries** and other entry types are counted but **not decoded**.

The header layout used by the parser is written from the pico-sdk as remembered, not checked against a binary built by the SDK. If a known program shows "No binary_info header", that is a gap in this tool, not proof that the image lacks the block. Use picotool to confirm.

## What it does NOT do

- No **GET_INFO**, **OTP** read/write, **EXEC** or **VECTORIZE_FLASH** commands.
- No **Intel HEX** input (convert it to .bin or .uf2 first).
- No **RAM image** (UF2 blocks targeting RAM addresses are rejected).
- No flash size detection: the tool trusts the offsets you enter and rejects only addresses past 16 MB.
- No signature, secure-boot or OTP key handling.
- No reboot to BOOTSEL on RP2040 from this tool.
- No simultaneous use with picotool or another program on the same interface.

## Troubleshooting

- **"no PICOBOOT vendor interface"**: the board is in application mode or is not a Pi BOOTSEL device. Enter BOOTSEL mode and reconnect.
- **Connect fails with a claim error on Windows:** the interface is held by another driver. Use Zadig to install WinUSB on the PICOBOOT interface only, not on the mass-storage interface.
- **Verify FAILED:** the flash did not hold what was written. Retry the write, check the power supply and cable, and read the first mismatch address in the message.
- **"Bulk IN failed" or "Bulk OUT failed" in the log:** the device stalled or disconnected. Disconnect, reconnect in BOOTSEL mode and retry.
- **The reset vector is not in flash:** the flash is blank or holds a RAM image. Writing a program fixes a blank chip.

## Related tools in this app

- **Mass Storage** for the UF2 drive when the board is mounted as a disk.
- **Hardware Programmers** suite for other chips (ESP, AVR, CH341A and others).
`,
};
