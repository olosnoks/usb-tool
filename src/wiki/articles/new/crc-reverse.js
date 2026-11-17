export default {
  id: 'crc-reverse',
  toolId: 'crc-reverse',
  category: 'analysis',
  title: 'CRC Reverse & Checksum Catalogue — model calculator, reverse-engineering and frame locator',
  summary: 'Offline checksum toolkit: calculate every RevEng catalogue CRC and common sum of a value, recover the CRC model (poly, init, refin, refout, xorout) from sample frames, and find which byte range a trailing checksum covers.',
  tags: ['CRC', 'CRC-16', 'CRC-32', 'CRC-8', 'checksum', 'reverse engineering', 'RevEng', 'Modbus', 'Fletcher', 'Adler-32', 'LRC', 'frame', 'protocol analysis'],
  readTime: '7 min read',
  content: `
# CRC Reverse & Checksum Catalogue

The **CRC Reverse & Checksum Catalogue** helps when a protocol frame ends with a checksum and you do not know which algorithm produced it. It runs entirely in the browser, with no hardware and no network. It has three tabs.

## Calculator

Paste bytes as hex (spaces and common separators are ignored) or switch to **ASCII text**. The tool computes every entry of the RevEng CRC catalogue (widths 3 to 64, including CRC-8/SMBUS, CRC-8/MAXIM-DOW, CRC-16/MODBUS, CRC-16/XMODEM, CRC-16/KERMIT, CRC-16/IBM-3740 (CCITT-FALSE), CRC-16/ARC, CRC-16/USB, CRC-32/ISO-HDLC, CRC-32/ISCSI, CRC-32/MPEG-2 and CRC-64/XZ) and the simple sums: Sum-8, Sum-16, XOR-8, LRC, Fletcher-16, Fletcher-32 (both word orders), Adler-32 and the Internet checksum.

Type an **expected value** in hex and the rows that produce it are highlighted. Use the filter box to narrow the list by name.

## Reverse

Give one or more sample frames whose checksum you know.

- **Layout:** *frame (checksum at tail)* takes the last 1, 2, 3, 4 or 8 bytes of each line as the stored checksum. *payload:checksum* takes each line as two hex strings separated by a colon.
- **Byte order:** tick big-endian, little-endian, or both. The checksum integer is read in the chosen order.

The solver runs these stages and checks every candidate against **all** samples before reporting it:

1. **Catalogue:** every RevEng model whose check value fits all samples.
2. **Simple sums:** the sums listed above.
3. **Brute force, width 8 and 16:** the search covers odd polynomials with all four refin/refout combinations. It uses the *differential method*: the XOR of two equal-length payloads cancels init and xorout, so the checksum XOR equals the CRC of the payload XOR. That filters the poly space quickly. init and xorout are then solved by Gaussian elimination over GF(2).
4. **Width 32:** a list of known 32-bit polynomials (CRC-32, CRC-32C, CRC-32D, AUTOSAR, MEF and others), with init and xorout solved the same way.

Results show the RevEng-style string (\`width=16 poly=0x8005 init=0xffff refin=true refout=true xorout=0x0000 check=0x4b37 residue=...\`). A model marked **init/xorout not fully determined** matches all samples, but the samples cannot separate some bits. Add samples with different payload lengths to pin them down.

The search runs in chunks, shows progress and can be cancelled. Cancelled runs show partial results.

## Locate

Enter one frame. Its last *k* bytes are treated as a stored checksum. Every payload range that ends just before them is tested against each catalogue CRC of width up to 8k bits and each simple sum, in both byte orders. Matches print the start and end of the covered bytes. Frames can be up to 1024 bytes.

## Limits and what it does not do

- The brute force covers widths 8 and 16 only. Width 32 uses only the known polynomial list. Other widths and unknown 32-bit polynomials are not searched.
- Only odd polynomials are searched for widths 8 and 16. Practical CRCs use odd polynomials, so this is a deliberate narrowing.
- Brute force needs at least two samples. Width 16 also needs two samples with equal payload length (the differential method). With two samples, several models can fit by chance. Three or more samples remove most false matches.
- Sample checksums must all have the same byte length.
- The residue value is computed by this tool from the model, not copied from the RevEng page.
- Locate tests only the tail-checksum layout. It does not search for a checksum at the head of a frame.
- Sums and CRCs are checked only against the parameters given. A real device may use a variant that is not in the catalogue, in which case the reverse search reports no match.

## Troubleshooting

- **No model found:** check the byte order (try both), the checksum width (1, 2 or 4 bytes), and whether the frame includes a start marker or length byte that the checksum does not cover.
- **Many matches with two samples:** that is expected for 8-bit results. Add a third sample.
- **Locate shows nothing:** the checksum may cover bytes after it, or be a CRC over a different field entirely.

## Related tools

- **Hash & HMAC Calculator** computes CRC-32 and Adler-32 for files and text, and verifies digests.
- **Modbus** and **Packet Analyzer** are where frames that carry CRCs usually come from.
- **Protocol Packet Lab** lets you build and check custom frames.
`,
};
