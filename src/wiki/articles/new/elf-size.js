export default {
  id: 'elf-size',
  toolId: 'elf-size',
  category: 'analysis',
  title: 'ELF / Map Size Analyzer — FLASH and RAM budget from ELF and GNU ld maps',
  summary: 'Offline firmware size analysis. Reads an ELF (32/64-bit, little or big endian) and/or a GNU ld .map file, shows FLASH and RAM totals and memory-region usage, ranks symbols and object files, draws a treemap, checks usage against a flash/RAM budget, prints arm-none-eabi-size style totals and compares two builds. Nothing is uploaded.',
  tags: ['ELF', 'Map file', 'Firmware size', 'FLASH', 'RAM', 'bss', 'arm-none-eabi-size', 'Symbol table', 'Treemap', 'Binary diff', 'Linker map'],
  readTime: '6 min read',
  content: `
# ELF / Map Size Analyzer

The **ELF / Map Size Analyzer** answers "where did my flash and RAM go?" for embedded firmware. It reads the output of your toolchain (an ELF image, a GNU ld \`-Map\` file, or both) and works entirely in the browser. Files are never uploaded.

## Inputs

- **ELF**: \`.elf\`, \`.axf\`, \`.out\` or any ELF file. 32-bit and 64-bit, little and big endian. The file type is detected from its content, not its name.
- **GNU ld map**: a \`.map\` (or text) file produced by \`-Wl,-Map=...\`. Arduino, ESP-IDF, Zephyr and STM32CubeIDE builds all produce this style. The map is detected from its content, and anything without a "Memory Configuration" block or output-section lines is rejected with a message.

Two slots are available. **Build A** is the primary build used by every view except Compare. **Build B** is the comparison build. Each slot accepts one ELF and one map, and you can select both files in one picker.

## Views

- **Summary** shows the ELF totals, a collapsible **size-style totals** block, a **Budget** panel, and loaded sections with their address, load address (LMA), size and per-section FLASH and RAM bytes. It also lists the program headers (PT_LOAD and others). For a map, it shows every memory region with its used bytes, percentage and a usage bar, plus each output section with its run and load regions.
- **Symbols** lists ELF symbols sorted by size. Filters cover name substring, type (FUNC, OBJECT, NOTYPE and others), binding (GLOBAL, LOCAL, WEAK), region, and section. The "top" selector limits rows. The "group by C++ namespace" option sums sizes by the first \`::\` segment.
- **Objects** aggregates a map by library (archive, or a loose object file) and by object file, with each share of the total. It needs a map for build A.
- **Treemap** draws squared rectangles sized in bytes. For an ELF it is region, then section, then symbol. For a map it is section, then library, then object. The region filter restricts the view to FLASH or RAM.
- **Compare** diffs build A against build B. It covers sections and symbols (ELF in both slots) and object files and libraries (map in both slots). Rows are sorted by growth, largest increase first. You can filter by status (grew, shrank, added, removed) and by minimum change. **Copy Markdown** puts a FLASH/RAM delta table plus the ten largest growths and reductions of the current view on the clipboard, ready for a PR comment.

## Size-style totals

Under the ELF stats, the collapsible "size-style totals" block prints the same columns as \`arm-none-eabi-size\` (Berkeley format): **text** (allocated read-only sections, including code and rodata), **data** (allocated writable sections with file contents), **bss** (allocated writable NOBITS, including .noinit), **dec** (their sum) and **hex**. A Copy button copies the two lines. This is computed from section headers, so it should match the \`size\` tool for the same file; it is not the output of that tool.

## Budget

The Budget panel compares the ELF's FLASH and RAM totals with limits you type: \`64K\`, \`1.5M\`, \`512KiB\`, \`0x10000\` or a plain byte count (K = 1024). The MCU preset list fills in datasheet flash and RAM sizes for a few common parts (ATmega328P, STM32F103C8, STM32F411CE, RP2040, nRF52840, ESP32-C3); these are only convenience values, so check them against your linker script. The bar turns amber above 70 % and red above 90 %, and the text shows free bytes or how far over budget you are. Limits are not saved between sessions.

Every table has a CSV export. Spreadsheet formulas in names are neutralized with a leading apostrophe.

## How the totals are counted

The FLASH and RAM figures follow the \`size\` tool convention:

| Total | Counts |
|---|---|
| **FLASH** | Every loaded section's file image: text, rodata, and the load-address image of .data |
| **RAM** | Loaded writable sections: .data (run address), .bss, and .noinit |

Non-loaded sections (.debug_*, .comment, the symbol and string tables) are excluded from both totals. For a map, a section with a load address occupies its load region, and .data also occupies its run region in RAM.

## Limits and what it does NOT do

- **No demangling.** Symbol names are shown raw. C++ names are grouped only when they are already demangled (for example \`ns::foo\`); mangled \`_Z\` names fall under \`(no ::)\`.
- **Symbol table required for symbols.** Stripped ELFs have no \`.symtab\`, so the symbol views will be empty. Use the unstripped image or the map file.
- **GNU ld maps only.** LLD, IAR and Keil map formats are not parsed.
- **No DWARF or source line data.** Sizes come from symbol and section headers and from the map.
- **Large inputs.** Each file is read fully into memory. The treemap draws at most 800 boxes: the largest 799 plus one "other" box for the rest. Tables show the first rows and can be exported in full.
- **Address precision.** 64-bit addresses are converted to JavaScript numbers, which is exact below 2^53. This covers all firmware in practice.
- **Symbol sizes are not allocation.** A symbol's size is its declared size. Padding, alignment and unreferenced data are not attributed to symbols.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Not an ELF file" | You loaded a raw \`.bin\` or \`.hex\` | Use the ELF from the build directory, or the map file |
| "ELF file is truncated or corrupt" | The download was cut short or the file is not a complete ELF | Rebuild and re-select the file |
| "Not a GNU ld map file" | The text is not a linker map, or it was produced by a different linker | Enable the GNU ld map output for your toolchain |
| Symbol table is empty | The ELF is stripped | Use the unstripped ELF |
| Compare shows no object rows | Only one slot has a map | Load a map in both A and B |

## Similar tools

I compared this against \`arm-none-eabi-size\` (totals only), Bloaty McBloatface (sections, symbols and compile units, with diffs), Puncover (needs debug info and the ARM toolchain, adds stack estimates), Mbed memap and ESP-IDF \`idf.py size\` (map-file based region reports). This tool does not do stack analysis, compile-unit grouping or C++ demangling, which those tools offer.

## Related tools

- **Hash & HMAC Calculator** (webapp category) checks that a firmware image matches its published digest.
`,
};
