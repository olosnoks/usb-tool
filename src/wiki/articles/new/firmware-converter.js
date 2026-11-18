export default {
  id: 'firmware-converter',
  toolId: 'firmware-converter',
  category: 'core',
  title: 'Firmware File Converter & Inspector — BIN, HEX, S-record, UF2 and ELF',
  summary: 'Open a firmware file, see its segment map, gaps, CRC-32, SHA-256 and start address, then convert it between raw binary, Intel HEX, Motorola S-record and UF2, relocate, crop, pad, checksum, split or merge it. Fully offline; nothing is uploaded.',
  tags: ['firmware', 'converter', 'UF2', 'Intel HEX', 'S-record', 'SREC', 'srec', 'S19', 'ELF', 'bin', 'hex', 'CRC32', 'SHA256', 'family ID', 'RP2040', 'segment map', 'offline'],
  readTime: '8 min read',
  content: `
# Firmware File Converter & Inspector

The **Firmware File Converter** opens a firmware image, shows what is in it, and writes it back out in another format. Every step runs in your browser. The file is never uploaded, and no hardware is needed. It does not flash anything; use the Firmware Flasher for that.

## Supported formats

| Format | Read | Write | Notes |
|---|---|---|---|
| **Raw binary (.bin)** | yes | yes | Has no addresses. You supply the base address on input. Gaps are filled with the fill byte on output. |
| **Intel HEX (.hex, .ihx)** | yes | yes | Reads record types 00 to 05. Writes 00, 01, 04 (upper address) and 05 (start address). |
| **Motorola S-record (.srec, .s19, .s28, .s37, .mot)** | yes | yes | Reads S0 to S9. Writes S1, S2 or S3 data records (chosen from the highest address) and the matching S9, S8 or S7 entry record. S5 and S6 counts are checked but not written. |
| **UF2 (.uf2)** | yes | yes | 512-byte blocks with the family ID flag. Writes blocks of 32 to 476 payload bytes (256 is typical). |
| **ELF32 / ELF64 (.elf, .axf, .out)** | yes | no | Reads every PT_LOAD segment into a memory image at its physical load address. ELF is input only. |

Input format is detected from the content (UF2 and ELF magic numbers, then a leading colon for HEX or S0 to S9 for S-records). If detection is wrong, pick the format in the **Input format** box.

## Step by step

1. **Load.** Drop one or more files onto the drop zone, or click **Choose file(s)**. For a raw .bin, set the **base address** first (decimal or 0x hex). The base applies only to raw binary.
2. **Read the inspector.** The inspector shows the format, data bytes, address range, number of segments and gaps, the start address, the CRC-32 and SHA-256, any UF2 family IDs, and the warnings.
3. **Relocate (optional).** Enter an **offset**. It is added to every address in the view and in every output. Negative offsets are allowed as long as no address goes below zero.
4. **Choose the output.** Pick the output format and its options (below), an optional split, and press **Build output**.
5. **Check and download.** Each output is re-read and compared with the source. Only a file that matches gets a **Download** button. If the comparison fails, the badge says which check failed.

## Inspector panels

- **KPI strip.** Format, data bytes, address range, segment and gap counts, gap bytes, and start address (with its kind: EIP, CS:IP or entry).
- **Digests.** CRC-32 and SHA-256 over the flattened image, with gaps counted as 0xFF, which is what a default .bin would contain. If the address span is too large to expand (over 64 MiB), the digests are over the data bytes only and the panel says so.
- **Segment map.** Each contiguous run with its start, end (exclusive), size and the gap that follows it.
- **UF2 blocks.** For UF2 input, one row per block: target address, payload size, flags, family ID, and block number out of the block count.
- **Warnings.** Overlaps (bytes written more than once; the last write wins), misaligned UF2 blocks (target or payload not a multiple of 4), mixed UF2 families, UF2 blocks without a family flag, NotMainFlash blocks, numBlocks or blockNo values that do not match the file, a missing EOF record, data after EOF, and zero-fill (.bss) in ELF segments.

Checksum errors, malformed lines, bad magic numbers and truncated ELF headers are errors, not warnings. The file is rejected and the message gives the line number or block offset.

## Output options

- **Fill byte for gaps.** Hex from 00 to FF, default FF. Raw .bin always writes the full span with this byte in the gaps. For HEX, S-record and UF2, gaps are left out unless **Fill gaps** is ticked, which writes one contiguous run.
- **Bytes per record** (HEX and S-record): 8, 16, 32 or 64.
- **S0 header text** (S-record, optional): stored in the S0 record.
- **UF2 payload per block:** 32, 64, 128, 256 or 476 bytes.
- **UF2 family ID:**
  - *Keep source family* writes the family only when the source has exactly one.
  - *No family ID* clears the flag.
  - A list of common families (RP2040, the three RP2350 variants, nRF52840, SAMD21, SAMD51, ESP32-S2, ESP32-S3, STM32F4) is provided, and *Custom hex* accepts any 32-bit value. The list was hand-entered; check it against the upstream UF2 family table before relying on it for a flash.
- **Start address.** Intel HEX writes it as a type 05 record. S-record writes it as the entry record. Raw .bin and UF2 have no start address field, so it is not written.

## Edit before converting

Open the **Edit** section under the offset box. Edits run in this order on the image shown (after relocation) and feed the inspector, the outputs, split and verification:

1. **Crop (keep only ranges).** Ranges are written \`start-end\` (end included) or \`start+length\`, separated by commas, for example \`0x08000000-0x0800FFFF, 0x08010000+0x100\`. Everything outside is dropped. A start address outside the kept data is dropped too.
2. **Exclude (remove ranges).** Same syntax, applied after crop.
3. **Pad end to a multiple of N bytes.** Extends the last segment with the fill byte.
4. **Insert a 32-bit checksum word.** Choose CRC-32 (IEEE, same as the inspector) or the negated byte sum, little- or big-endian, and an address (empty means the end of the image). The checksum covers every byte from the lowest address up to the slot, with gaps counted as the fill byte. Data after the slot is not covered, and any data in the four slot bytes is replaced. The computed value and range are shown.

The **Fill byte** box in this section is the same setting as the one in the output options.

## srec_cat command

Under the output options, **Equivalent srec_cat command** shows a command line for SRecord that approximates the current input, crop, exclude, offset, fill and record-size settings. It is only text to copy; nothing is run. Pad, checksum and split are not included. srec_cat cannot read UF2 or ELF or write UF2, and the panel says so when that applies. Check the command against the SRecord manual before relying on it.

## Split and merge

- **Merge.** Load several files and choose **Merge all**. Files are combined in load order, and a later file wins on overlap. The first start address found is kept. A warning is shown if the merged files carry different UF2 family IDs; in that case no family is written unless you choose one.
- **Split at an address.** Produces two files: everything below the address, and everything at or above it. A start address goes with the side that contains it.
- **One file per segment.** Produces one output per contiguous run. A start address goes with the segment that contains it.

## Verification

After a build, each output is parsed again and checked against the source:

- the data (compared segment by segment, or flattened with the same fill byte when gaps are filled or the format is raw .bin),
- the base address,
- the start address (HEX and S-record),
- the UF2 family ID.

A failed check blocks the download. A check shown as n/a could not be run, usually because the span is too large to expand.

## Browser requirements

Any modern browser: Chrome, Edge, Firefox or Safari. No USB, serial or Bluetooth permission is needed. Very large images (tens of megabytes) work but use memory and take a moment to digest.

## What it does NOT do

- It does not flash, erase or write to any device.
- It does not check a UF2 MD5 extension or decode UF2 extension tags. Their presence is reported as a warning.
- It does not unpack UF2 file containers.
- It does not run srec_cat, objcopy or uf2conv.py; the command shown is text only.
- It does not write ELF, Intel HEX type 03 start records, or S5 and S6 count records.
- It does not sign, encrypt, decrypt or compress images, and it does not know bootloader or partition layouts (ESP32 partition tables are handled by the ESP partition tools).
- It does not preserve the raw .bin base address; a .bin file has nowhere to store one. Note the base shown in the inspector.
- It does not expand address spans larger than 64 MiB. The segment map and data-only digests still work.
- ELF input uses the physical load address (p_paddr). Hosted programs that set p_paddr to zero will be placed at address zero.

## Troubleshooting

- **"checksum mismatch" on a HEX or S-record file.** The file is corrupt or was edited by hand. The line number is given. Re-export the image from the build tool.
- **"bad magic numbers" on UF2.** The file is not UF2 or is truncated. Its length must be a multiple of 512.
- **"Mixed families" warning.** The file contains blocks for more than one chip. Pick a family in the output options if you need one, or split the file by segment and convert each part.
- **Verification failed.** Report it with the file; a failed round trip means a bug in the converter or an input it does not handle.

## Similar tools

SRecord (srec_cat) offers crop, exclude, offset, fill and checksum filters on the command line; uf2conv.py and picotool convert BIN and HEX to UF2 with a family ID; the IntelHex Python library merges files and pads with a chosen byte. This tool covers the same everyday conversions in the browser, with a segment map and a re-read check on each output. It has no scripting, no random fill and no CRC variants beyond the two above.

## Related tools

- **Firmware Flasher** (Core Operations) writes firmware to ESP32 and ESP8266 devices. Use it after converting a file into the format your flasher expects.
- **ESP partition tools** show partition tables and offsets.
- **Hash & HMAC Calculator** computes SHA-256 and other digests over any file, for checking a converted image against a published checksum.
`,
};
