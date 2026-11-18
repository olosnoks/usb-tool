export default {
  id: 'esp-backtrace',
  toolId: 'esp-backtrace',
  category: 'core',
  title: 'ESP Backtrace Decoder — Crash Text + ELF to Function and File:Line',
  summary: 'Offline decoder for ESP32 (Xtensa and RISC-V) and ESP8266 crashes. Paste a Guru Meditation or Exception block, or take the latest one from the serial port, load the firmware .elf, and get function names, file:line, registers and stack-dump code candidates.',
  tags: ['ESP32', 'ESP8266', 'Backtrace', 'Crash', 'Guru Meditation', 'Exception Decoder', 'addr2line', 'DWARF', 'ELF', 'RISC-V', 'Xtensa', 'Panic', 'Stack Trace', 'idf.py monitor'],
  readTime: '8 min read',
  content: `
# ESP Backtrace Decoder

When an ESP32 or ESP8266 crashes it prints raw addresses: a program counter, a return address, a stack dump. The **ESP Backtrace Decoder** turns those into function names and source lines using the firmware **.elf** from the build that crashed. It does what \`idf.py monitor\` does with \`addr2line\` and what the Arduino "EspExceptionDecoder" does, but in the browser and fully offline. Nothing you paste or load is uploaded.

## What you need

| Input | Where it comes from | Required? |
|---|---|---|
| Crash text | Copied from the serial monitor, or captured from the shared serial port | Yes |
| Firmware \`.elf\` | The \`build/<app>.elf\` (ESP-IDF) or the \`.elf\` from your Arduino build folder | Optional, but without it you only get raw addresses |

The ELF must come from **the same build** that crashed. A different build shifts every address and produces plausible but wrong names.

## Supported crash formats

- **Xtensa (ESP32, ESP32-S2, ESP32-S3):** the \`Guru Meditation Error: Core N panic'ed (Cause)\` banner, the \`Core N register dump:\` block (PC, PS, A0 to A15, EXCVADDR, EXCCAUSE), and the \`Backtrace: PC:SP PC:SP ...\` line. A \`|<-CORRUPTED\` marker is reported and the frames after it are not trusted.
- **RISC-V (ESP32-C3, C6, H2):** the same banner, with MEPC, RA, SP, MTVAL and MCAUSE, plus the \`Stack memory:\` dump. The cause name comes from the banner, or from the MCAUSE table when the banner has none.
- **ESP8266 (Arduino SDK):** \`Fatal exception (n):\` or \`Exception (n):\` with \`epc1\`, \`excvaddr\` and the \`stack>>>\` ... \`<<<stack<<<\` dump. The cause numbers use the Xtensa LX106 cause table.
- **ESP-IDF abort and assert:** \`abort() was called at PC 0x... on core N\` (its PC is the exact frame 0) and \`assert failed: func file.c:line (expr)\`.
- **Reset reason:** \`rst:0x.. (NAME)\` and \`boot:0x.. (NAME)\` (ESP-IDF), or \`rst cause:N\` (ESP8266). The names printed by the boot ROM are shown verbatim; a code without a name is looked up in the ESP32 table.

## Step by step

1. **Load the ELF.** Click *Choose .elf file*. The panel shows the architecture, the number of functions, and whether line numbers are available.
2. **Get the crash text.** Either paste it into *Crash text*, or:
   - connect the serial port in the header so the app buffers incoming text, then click *Use latest from serial*. The tool takes the most recent panic block, from the first panic marker after the previous \`Rebooting...\` up to the next one.
3. **Read the result.** The tool decodes as soon as both the text and the ELF are present (the ELF is optional).
   - *Cause*: kind, architecture, core, cause name with a short explanation, fault address (EXCVADDR or MTVAL), assert and reset details.
   - *Backtrace*: frame, address, function and offset, file:line, and where the address came from.
   - *Registers*: every register in the dump. Any value that points into executable code is symbolised.
   - *Stack-dump code candidates*: values in the stack dump that point into the ELF's executable sections.
   - *Notes*: anything the decoder could not do or that looks wrong (no ELF, architecture mismatch, unsupported DWARF, corrupted backtrace).
4. **Copy as text.** *Copy as text* puts the whole decode on the clipboard as a plain-text report for an issue or chat.

## How addresses are looked up

Return addresses are not the call instruction, so they are mapped back before lookup:

- **Frame 0** (PC, MEPC, epc1, or the abort PC) is the faulting instruction and is looked up as it is.
- **Xtensa return address** (Backtrace entries after the first, and A0): the top two bits carry the windowed-call size, so they are replaced with \`0x40000000\` and the 3-byte call is backed up: \`site = ((ra & 0x3FFFFFFF) | 0x40000000) - 3\`.
- **ESP8266 return address** (call0 ABI): \`site = ra - 3\`.
- **RISC-V return address** (RA): \`site = ra - 1\`, which stays inside the 2- or 4-byte call.
- **Stack-dump candidates** are looked up at their exact value and labelled as candidates, because they may be data or stale return addresses.

Function names come from the ELF \`.symtab\` FUNC symbols: the nearest symbol at or below the address whose size covers it. An address past the end of a function's size shows \`??\`.

File and line numbers come from DWARF \`.debug_line\`, versions 2 to 5, 32- and 64-bit DWARF, including the DWARF 5 directory and file entry formats (\`line_strp\`, \`strp\`, \`string\`, \`udata\`, \`data1/2/4/8/16\`, \`block\`). Sequences that start at address 0 (sections removed by \`--gc-sections\`) are dropped.

## Limits (read these before trusting a result)

- **Multi-core dumps:** only the first register dump and the first Backtrace line are read. A crash on core 1 that prints both cores is decoded for the first dump only.
- **Line info needs debug info.** Build with \`-g\`. Without \`.debug_line\` you get function names only, and the notes say so.
- **Unsupported DWARF** (strx and addrx forms, compressed debug sections, DWARF below 2 or above 5) falls back to function names only. The note names the construct.
- **VLIW op_index** is not modelled. ESP targets are not VLIW, so this does not matter for them.
- **Stripped ELF:** if \`.symtab\` was removed there are no function names. The decoder says so.
- **Architecture mismatch:** an ESP8266 or Xtensa crash decoded against a RISC-V ELF (or the reverse) prints a warning. The names will be wrong in that case.
- **No stack unwinding.** The decoder does not walk the stack itself. It shows the frames the chip printed, plus candidates from the dump. A corrupted stack gives an incomplete backtrace, and the decoder cannot repair it.
- **Serial capture** only fills while the shared serial port is connected, and only holds the last 200,000 characters.
- **Not tested on hardware in this app.** The decoder is verified against crafted ELF images and crash text written to ESP-IDF and ESP8266 SDK output formats. Compare a real crash from your own build with \`idf.py monitor\` before relying on it for a release.

## Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Every address shows \`??\` | ELF from a different build, or stripped | Use the \`.elf\` from the exact build that crashed |
| Names but no file:line | No \`-g\`, or unsupported DWARF | Rebuild with debug info; read the note for the reason |
| "architecture mismatch" note | ELF is for another chip | Load the ELF for the chip that crashed |
| "No ESP panic markers" | Text is only a log line, or the block was cut | Copy the whole block from the Guru Meditation line to the end |
| Serial button finds nothing | Port not connected when the crash happened | Connect before reproducing the crash, or paste the text |
| Frames after \`|<-CORRUPTED\` look wrong | The stack was overwritten | Trust only the frames before the marker |

## Related tools

- **Terminal & Console:** the source of most crash text. This tool's serial buffer is the same shared port the console uses.
- **ELF / Map Size Analyzer:** the same ELF, for FLASH and RAM budgets.
- **Firmware Flasher:** for re-flashing the build that matches the ELF you are decoding.
- **Silicon Memory Dump:** reads eFuse and flash from a live chip, useful when the crash may come from a bad partition or image.
`,
};
