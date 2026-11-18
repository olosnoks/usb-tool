export default {
  id: 'arduino-uploader',
  toolId: 'arduino-uploader',
  category: 'core',
  title: 'Arduino Bootloader Uploader — write sketches through the board\'s own bootloader',
  summary: 'Uploads a compiled sketch (.hex or .bin) to an Arduino Uno, Nano, Pro Mini, Leonardo, Micro or Pro Micro through the bootloader already on the board, over its own Web Serial port. It writes, reads every page back to compare, and can read the flash back out to a file.',
  tags: ['Arduino', 'bootloader', 'Optiboot', 'Caterina', 'STK500', 'AVR109', 'Uno', 'Nano', 'Leonardo', 'Pro Micro', 'flash', 'Intel HEX', 'Web Serial'],
  readTime: '6 min read',
  content: `
# Arduino Bootloader Uploader

The **Arduino Bootloader Uploader** puts a sketch onto an Arduino board using the bootloader that is already there. It needs no programmer and no ISP wiring. It opens its own serial port, which is separate from the Serial Monitor or the shared serial connection in this app, so you can keep another tool connected to something else.

It does the same job as the Arduino IDE's upload button for these boards, and it reads the flash back so you can check the result or keep a backup.

## Supported boards

| Preset | Protocol | Baud | Bootloader | Sketch area |
|---|---|---|---|---|
| Arduino Uno | STK500v1 (Optiboot) | 115200 | Optiboot, 512 bytes | 0x0000 to 0x7E00 |
| Arduino Nano, new bootloader | STK500v1 (Optiboot) | 115200 | Optiboot, 512 bytes | 0x0000 to 0x7E00 |
| Arduino Nano, old bootloader | STK500v1 (ATmegaBOOT) | 57600 | ATmegaBOOT, 2 KB | 0x0000 to 0x7800 |
| Arduino Pro Mini (ATmega328P) | STK500v1 (ATmegaBOOT) | 57600 | ATmegaBOOT, 2 KB | 0x0000 to 0x7800 |
| Arduino Leonardo | AVR109 (Caterina) | USB | Caterina, 4 KB | 0x0000 to 0x7000 |
| Arduino Micro | AVR109 (Caterina) | USB | Caterina, 4 KB | 0x0000 to 0x7000 |
| Arduino Pro Micro | AVR109 (Caterina) | USB | Caterina, 4 KB | 0x0000 to 0x7000 |

Pick the preset that matches the board's bootloader. On STK500v1 boards a wrong preset is caught early: the signature is read first, and a mismatch stops the run before anything is written. (Caterina boards have no signature command, so that check does not apply to them.) The old Nano and most Pro Minis use ATmegaBOOT at 57600 baud. If you are unsure, try the Nano old-bootloader preset.

Each preset has a sketch area. The image must end below the bootloader, which sits at the top of flash. A .hex that starts inside the bootloader is refused, so you cannot overwrite the bootloader by accident.

## Browser and drivers

- Use **Chrome or Edge on desktop**, from \`https://\` or \`localhost\`. Web Serial is not available in Firefox or Safari.
- Clone boards often use a **CH340** USB-serial chip. On Windows they may need the CH340 driver before the board shows up as a COM port.
- Close the Arduino IDE's Serial Monitor and any other tool using the same port. The browser picker lists ports by name, so check the one you choose.

## Step by step: STK500v1 boards (Uno, Nano, Pro Mini)

1. Pick the **board preset**.
2. Click **Load .hex or .bin** and pick the sketch. The compiled .hex from the Arduino IDE is the usual choice. The panel shows its size and address range and flags anything that does not fit.
3. Leave **Write and verify sketch** selected and click **Program board**. Confirm the dialog.
4. Choose the board's serial port in the browser picker.
5. The tool pulses DTR and RTS to reset the board into its bootloader, syncs, reads the signature, writes the sketch page by page, reads every page back and compares it, and then starts the sketch.

The button only reports success after the read-back comparison matched every page.

## Step by step: Caterina boards (Leonardo, Micro, Pro Micro)

Caterina boards are a little different, because the bootloader is a separate USB device.

1. Pick the **board preset** and load the sketch as above.
2. Click **Step 1: start bootloader (1200-baud touch)** and choose the board's normal Arduino port. The tool opens the port at 1200 baud and closes it again. That makes the board reset into the bootloader.
3. The board drops off and comes back as a **new serial port**, so the browser's picker shows a new entry. Click **Step 2** and choose that new entry. It is not the port you picked in step 1, and if you pick the old one you will see an error.
4. The tool identifies the bootloader (it must answer CATERIN), writes the sketch in 128-byte blocks, reads them back and compares them, and then exits the bootloader to start the sketch.

If the board does not come back as a port, reset it (press the RESET button on the Leonardo or Micro) and try step 1 again.

## Read flash back

Choose **Read flash back** and run the same steps. The tool reads the whole flash, \`flashSize\` bytes, one page at a time. Download the result as a raw .bin or as an Intel HEX .hex file.

The read-back covers the sketch area and the bootloader area. Whatever the bootloader returns for its own area is shown as it comes back; the tool does not check those bytes against anything. After a read the board starts its sketch again.

## What it does and does not do

**Does**
- Writes only the flash pages the sketch needs, padding the last page with 0xFF (erased flash).
- Verifies every written page by reading it back and comparing every byte.
- Shows a page-by-page progress bar, a log and a **Stop** button. Stopping ends the run at the next page. The board may then hold a partly written sketch, so upload again before running it.
- Reads the whole flash to a .bin or .hex file.

**Does not**
- Change fuses, lock bits or EEPROM.
- Write, erase or update the bootloader.
- Use ISP (the 6-pin programming header) or do a chip erase. For those, use the AVR ISP tool in this app.
- Check the Caterina signature. AVR109 has no signature command, so the preset's signature is shown for reference and is not read from the board.
- Support boards other than the presets above, or bootloaders with a different protocol.

## Troubleshooting

- **"The board did not answer the STK500v1 sync."** Check that the board is powered and the baud rate matches the bootloader (115200 for Optiboot, 57600 for ATmegaBOOT). Try the other Nano preset. Make sure no other program holds the port.
- **"The board reports signature ..., not ..."** The preset does not match the chip. Nothing was written. Pick the right board.
- **"The port answered ... instead of CATERIN."** In step 2 you chose the sketch's normal port, not the bootloader port. Start again from step 1.
- **"Verify failed at 0x...".** A byte did not read back the same. Upload again. If it repeats, check the cable, the USB port and the CH340 driver.
- **"Past the 32256 bytes"** (or the equivalent for your board). The sketch is too big for the sketch area, so it would overlap the bootloader. Shrink the sketch or use a board with more flash.
- **No port in the picker after step 1.** Some boards need the reset button. Press it, then click Step 1 again.

## Related tools

- **AVR ISP** (the \`avr-isp\` tool) programs through the ISP header and can also burn bootloaders and set fuses. Use it when the bootloader is gone or the board needs fuses changed.
- **Terminal** (the \`terminal\` tool) is the place to watch a sketch's serial output after the upload. This tool closes its port as soon as it finishes, so it does not stay connected for that.
`,
};
