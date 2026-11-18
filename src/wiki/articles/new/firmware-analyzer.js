export default {
  id: 'firmware-analyzer',
  toolId: 'firmware-analyzer',
  category: 'analysis',
  title: 'Firmware Image Analyzer — signature scan, entropy, strings, hex and carving',
  summary: 'A binwalk-style offline analyzer. It finds known headers (U-Boot, device tree and FIT, SquashFS, UBI/UBIFS, JFFS2, ext, gzip, xz, zstd, ELF, PE, ESP32 and more) in a firmware image, parses and checks them, and gives an entropy profile, strings, a hex view, carving and gzip/zlib decompression. Nothing is uploaded.',
  tags: ['firmware', 'binwalk', 'signature scan', 'entropy', 'carving', 'U-Boot', 'uImage', 'SquashFS', 'UBI', 'JFFS2', 'ESP32', 'hex viewer', 'strings', 'decompress'],
  readTime: '8 min read',
  content: `
# Firmware Image Analyzer

The **Firmware Image Analyzer** opens a firmware image (or any binary) and tells you what is inside it. It scans every byte offset for known file-format signatures, parses the header of each match and checks it where the format allows, then offers an entropy profile, a strings list, a hex view, carving and decompression. Everything runs in your browser on the file you choose. Nothing is uploaded.

It is an analysis aid, not an unpacker. It does not extract filesystems or unpack archives into a tree. Carve a region you care about, then run the normal tools on it (for example \`unsquashfs\`, \`ubireader\` or \`7z\`).

## What it recognises

Signatures are grouped by category. A hit is reported only when its header parses and passes the checks the format provides (CRC, reserved bits, sizes, checksums). Entries marked **heuristic** are weaker: a few bytes plus plausibility checks. Treat those as hints.

| Category | Formats |
|---|---|
| Boot and firmware headers | U-Boot uImage (header CRC and data CRC), device tree blob and FIT image, TRX (Broadcom), Android boot image, ESP32 application image, ESP-IDF partition table |
| Filesystems | SquashFS 4 (little and big endian), CramFS, JFFS2 nodes, UBI erase-counter and volume headers, UBIFS nodes (superblock fields), ext2/3/4 superblock |
| Compression | gzip, xz (stream header CRC), zstd, bzip2, LZ4 frame, zlib (heuristic), LZMA "alone" header (heuristic) |
| Containers and archives | ZIP local file header, 7z (start header CRC), tar (ustar checksum), CPIO newc |
| Executables and images | ELF (class, machine and section table size), PE/COFF (MZ and PE signature), ARM exception vector table (heuristic), PNG |
| Keys and certificates | PEM certificates, CRLs, public keys and private keys (flagged as sensitive), SSH public keys (RSA, Ed25519, ECDSA) |
| Text encodings | Intel HEX (every record checksum must be valid) |

Each hit shows its offset in hex and decimal, its type, its parsed size where the header gives one, and the header fields (for example the uImage name, load and entry addresses, the SquashFS compression, or the ESP32 chip and app version).

## Using it

1. Click **Choose firmware file** or drop a file on the page. Files up to 64 MiB are accepted.
2. The scan runs in chunks so the page stays responsive. **Cancel** stops it.
3. Read the **Signatures** tab. Filter by any text. Click a row to select it, then:
   - **Hex** opens the hex view at that offset.
   - **Carve** downloads the bytes of the hit. The end is the parsed size when the header states one, otherwise the next hit, otherwise the end of the file. The status line says which rule applied.
   - **Decompress** (gzip and zlib hits) opens the Decompress tab at that offset.
4. **Entropy** draws the entropy of each block: green is structured data, amber is mixed, red (7.5 bits per byte and above) is likely compressed or encrypted. Click the plot, or a red region, to open that block in the hex view.
5. **Strings** extracts ASCII runs and UTF-16LE runs of at least the minimum length (default 6). Filter the list, export all of it as text, or click an offset to jump to it.
6. **Hex view** shows 256 to 4096 bytes at any offset. Type an offset as decimal or with a 0x prefix.
7. **Decompress** runs gzip, zlib or raw deflate from an offset, using the browser's built-in decompressor. If the stream is damaged or has trailing bytes you still get the output produced so far, with the reason it stopped. Download it to inspect it.
8. **Report** downloads the analysis as JSON or Markdown. The report has the hits, their fields and notes, the entropy summary and high-entropy regions, and the string count. It does not include the image bytes or the string text.

## Browser requirements

- Any current Chromium, Firefox or Safari. Decompression uses \`DecompressionStream\`, which needs a recent browser (Chromium 80+, Firefox 113+, Safari 16.4+). The rest of the tool works without it.
- No hardware, drivers, or special permissions are needed. The file is read with the normal file picker or drag and drop.

## Limits: what it does NOT do

- It does not unpack filesystems, extract archive contents, or follow fragmented data. Carving takes a contiguous range.
- It does not decrypt anything. Encrypted or compressed regions show high entropy; the tool cannot tell you what is in them.
- The header checks are shallow. A hit means a header parses and passes its own checks. It does not prove the rest of the file is intact.
- The TRX CRC and the UBI and UBIFS node CRCs are shown but not recomputed.
- The ESP32 image size is computed from the segment headers; Android boot image size uses the v0 layout and does not count v1+ trailing sections.
- The ARM vector table check is heuristic and only matches the common LDR PC or B forms in the first eight words.
- Scans cap the number of hits per signature (for example 2000 for heuristic matches and 5000 for JFFS2 and UBIFS nodes). The Signatures tab says when a cap was reached.
- It reads the whole file into memory. Very large images (over 64 MiB) are refused.

## Troubleshooting

- **No hits on a firmware you know is valid.** Many firmware files are a vendor wrapper around the real image, or are encrypted. Check the entropy tab: a flat red plot means the content is compressed or encrypted and no header can be read.
- **Many heuristic hits.** These come from short byte patterns (zlib, LZMA, ARM vectors) and can appear by chance in compressed data. Use the filter and check the parsed fields.
- **Decompress reports "Partial".** The stream is truncated, has a bad checksum, or has data after its end. The output shown is what was decoded before the error.
- **Strings list is empty.** Lower the minimum length, or enable both ASCII and UTF-16LE.
- **Page is slow with a large file.** Scans and entropy run in chunks, but a 64 MiB image still takes a few seconds. Larger block sizes make the entropy plot quicker.

## Related tools in this app

- **Hash & HMAC Calculator** checks a file against a known digest. Use it to confirm a firmware file matches its published hash before you analyze it.
`,
};
