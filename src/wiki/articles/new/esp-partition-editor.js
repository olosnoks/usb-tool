export default {
  id: 'esp-partition-editor',
  toolId: 'esp-partition-editor',
  category: 'core',
  title: 'ESP32 Partition Table & NVS Editor — partitions, flash map and NVS values, offline',
  summary: 'Open an ESP32 full flash dump or a standalone partitions.bin or nvs.bin, edit the partition table or NVS key/value storage, and write the result back. Everything runs in the browser on your files; no device is needed.',
  tags: ['ESP32', 'ESP-IDF', 'partition table', 'partitions.bin', 'NVS', 'nvs.bin', 'flash dump', 'gen_esp32part', 'MD5', 'Wi-Fi credentials', 'esptool'],
  readTime: '8 min read',
  content: `
# ESP32 Partition Table & NVS Editor

The **ESP32 Partition Table & NVS Editor** works offline on files you already have: a full flash dump (for example from \`esptool.py read_flash\`), a standalone \`partitions.bin\`, or an NVS partition image (\`nvs.bin\`). It reads and writes the formats ESP-IDF uses. Nothing is uploaded and no serial or USB connection is made.

## Supported inputs

| File | What the tool does with it |
|---|---|
| Full flash dump (at least 0x9000 bytes, with a partition table at 0x8000) | Reads the table, edits it, and can write a patched copy of the dump. NVS partitions in the dump can be edited and written back. |
| \`partitions.bin\` (table only) | Reads the table and can write a new 0xC00 table. |
| \`nvs.bin\` (a multiple of 4096 bytes of NVS pages) | Lists namespaces, keys and values, and edits values. |
| CSV in ESP-IDF \`gen_esp32part.py\` syntax | Imported from a file or pasted; see below. |

## Partition table tab

1. Open the dump or \`partitions.bin\`, import a CSV, paste CSV text, or insert the default ESP-IDF template.
2. The **flash map** shows the bootloader, the table, every partition and any unallocated gaps, drawn to scale.
3. Edit each row: name, type (app or data), subtype, offset, size, and the **encrypted** and **readonly** flags. A blank offset is **auto**. It is placed after the previous partition and aligned to 64 KiB for app partitions and 4 KiB for data partitions, as \`gen_esp32part.py\` does. Sizes accept \`K\` and \`M\` suffixes, for example \`64K\` or \`1M\`.
4. Errors are shown per row and block the binary and dump outputs. The checks are: alignment (app 0x10000, data 0x1000); app size a multiple of 0x1000; nothing below 0x9000; no overlaps; unique names of at most 16 characters; the flash size (when a dump is loaded); an \`nvs\` partition smaller than 0x3000 must be readonly; ota and coredump data cannot be readonly; at most one otadata; and at most 95 entries.

Layout helpers:
- **Preset** replaces the table with one of four layouts: single app (the ESP-IDF default), two OTA slots, two OTA slots plus a SPIFFS partition that takes the rest of the flash, or factory plus two OTA slots. Slot sizes are computed for the selected flash size (up to 3 MiB each, 64 KiB aligned). If no flash size is chosen, 4 MiB is used. Offsets stay on auto.
- **Flash** selects the flash size (1 to 64 MiB) when no dump is loaded, so size checks and the map work on a CSV alone. With a dump loaded, the dump size is used and the selector is locked.
- **Fill to end** resizes the last partition (by offset) so it ends at the end of flash, rounded down to 4 KiB.
- **Move up / down** (arrows in each row) reorders rows. This changes auto-placed offsets, because they follow list order.
- **Copy CSV** copies the CSV text to the clipboard.
- A **summary line** shows app, data and reserved bytes, and free space and any unallocated tail when the flash size is known.
- **Layout advice** (amber, only shown when there are no errors) warns about things gen_esp32part accepts but that usually cause trouble: OTA slots without otadata, otadata not 0x2000 bytes, a single OTA slot, OTA slots of different sizes, no factory app or ota_0, no app, no nvs, no phy_init, and several filesystem partitions.
- **Build-system snippets** (collapsed) give text for \`platformio.ini\` (\`board_build.partitions\`), ESP-IDF \`sdkconfig.defaults\` and the \`gen_esp32part.py --verify\` command. They are text to copy; the tool cannot apply them to a project.

Outputs:
- **Export CSV** writes the table in gen_esp32part syntax with resolved offsets.
- **partitions.bin (0xC00)** writes the binary table with its MD5 entry, at the 0xC00 size ESP-IDF uses.
- **Patch table into dump** writes a copy of the full dump with the table at 0x8000. The table occupies 0xC00 bytes; the rest of its 4 KiB sector is set to 0xFF. The original file is not changed.

Limits: bootloader and partition-table entries are not created here, and secure-boot signature blocks are not generated. This tool does not flash anything. Write the result with \`esptool.py write_flash\` or your usual programmer.

## NVS tab

The tool parses the ESP-IDF NVS page format (version 2) and reports the state of every page. Each page has a state, a sequence number, a header CRC over bytes 4 to 27, and a 2-bit-per-entry bitmap that marks entries as written, erased or empty. Each 32-byte entry has a namespace index, a type, a span, a chunk index, a CRC and a 16-byte key.

- **Namespaces** are listed with their index. Keys are grouped under them.
- **Live values** are the newest valid write for each namespace and key, judged by page sequence number. Erased entries are ignored.
- **Types** decoded: u8, i8, u16, i16, u32, i32, u64, i64, strings, and blobs. Blobs include both the legacy single-entry blob and the chunked form (an index entry plus data chunks); chunks are reassembled and the length is checked. Float and double are shown as values.
- **Highlighting**: keys such as \`sta.ssid\`, \`sta.pswd\` and \`sta.authmode\` in the Wi-Fi namespace (\`nvs.net80211\`) are marked. Use "credentials only" to filter, and "mask secrets on screen" to hide the values while you work.
- **Export** to JSON or CSV. Blobs export as full hex.

### Editing

- **Integers** can be rewritten. Input may be decimal or 0x hex, and is range-checked for the stored type. The entry CRC is recomputed.
- **Strings** can be rewritten only with a value of the same byte length (the stored length includes the terminating NUL). The data CRC and entry CRC are recomputed, and the padding after the string is left as it was.
- **Blobs, floats and doubles** are read-only. An entry whose CRC already fails is read-only too.

After each edit the image is parsed again. Save the result with **NVS partition .bin** (for a dump, just the NVS partition) or **Dump with NVS edits** (the whole dump).

## Limits and what it does not do

- **Encrypted NVS** (an \`nvs_keys\` partition with NVS encryption) cannot be read. The entries fail their CRCs and the tool warns that the partition may be encrypted. Decryption needs the keys, which this tool does not handle.
- Version-1 NVS pages (version byte 0xFF) are parsed and flagged as not version 2.
- Pages whose header CRC is wrong are ignored for live values and reported.
- Creating or deleting keys and namespaces, and garbage collection, are not implemented. Values are changed in place only.
- No hardware is contacted, so no browser-specific device API is needed. Any modern browser works.

## Troubleshooting

- *"Image is smaller than 0x9000 bytes"* or *"no table at 0x8000"*: the file is not a full dump. Use \`partitions.bin\`, or a dump read from flash offset 0.
- *"Not a valid partition table: bad entry magic"*: the table at 0x8000 is damaged, or the dump was read from the wrong offset.
- *"The table MD5 entry does not match"*: the table was edited or corrupted after it was built.
- *"Every page is erased"*: the NVS partition has never been written, or the wrong partition was opened.
- *"Most entries fail their CRC"*: the partition is probably encrypted, or the offset is wrong.
- An edit reports "must stay exactly N bytes": a string edit must keep the same length. Change other lengths in your firmware instead.

## Similar tools

Compared against: ESP-IDF \`gen_esp32part.py\` and its \`--verify\` option, ESP-IDF menuconfig partition table settings, PlatformIO custom \`partitions.csv\` support, and browser partition generators. Unlike gen_esp32part, this editor works on binary dumps in both directions and also edits NVS. It does not run menuconfig, and it does not check a table against the firmware you build.

## Related tools

Read a dump from a board with the ESP flash tools in this app, then use this editor to change its partition table or NVS values, and write the result back with \`esptool.py\`.
`,
};
