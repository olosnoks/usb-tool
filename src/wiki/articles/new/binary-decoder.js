export default {
  id: 'binary-decoder',
  toolId: 'binary-decoder',
  category: 'analysis',
  title: 'Binary Payload Decoder — Protobuf, CBOR, MessagePack, BSON and framing (offline)',
  summary: 'Schema-less, offline decoder for serialized binary payloads: protobuf (like protoc --decode_raw), CBOR (RFC 8949), MessagePack and BSON, with byte offsets, auto-detection and COBS, COBS/R, SLIP and HDLC-style framing. Also encodes JSON to CBOR or MessagePack. Runs entirely in the browser.',
  tags: ['Protobuf', 'protoc decode_raw', 'CBOR', 'RFC 8949', 'MessagePack', 'BSON', 'COBS', 'COBS/R', 'SLIP', 'HDLC', 'Framing', 'Deserialize', 'Hex dump', 'Base64', 'Binary Decoder'],
  readTime: '10 min read',
  content: `
# Binary Payload Decoder

The **Binary Payload Decoder** takes a serialized payload and shows what is inside it as a tree, with the byte offset and length of every item. It needs no schema and no device. Everything runs in your browser; the bytes you paste or open are never uploaded.

It has four tabs:

| Tab | What it does |
|---|---|
| **Decode** | Unwraps text encodings, optionally splits frames, detects or forces the payload format and shows a collapsible tree next to a hex view. |
| **Struct** | Decodes bytes against a small C-like field template (like an ImHex pattern or a 010 Editor template, but much simpler). |
| **Encode JSON** | Turns JSON text into CBOR or MessagePack bytes, then decodes the result again as a check. |
| **Framing** | Encodes a payload with COBS, COBS/R, SLIP or HDLC-style stuffing, or splits a stream into frames and decodes each one. |

## Input

- **Text**: hex (spaces, colons, commas and 0x prefixes are ignored), base64, base64url or base32.
- **File**: open any file up to 16 MB. Its contents are used as raw bytes, unless it is plain ASCII text that looks like base-N text.
- **Text encoding** selector: Auto (recommended), Raw bytes / UTF-8, or a forced hex, base64, base64url or base32.

Auto only unwraps text that clearly looks like an encoding. Hex with an even number of digits is taken as hex. Base64 is unwrapped when it contains a digit or one of + / = - _. Plain lower-case words such as test stay text. Choose the encoding yourself when Auto guesses wrong. The candidates and their confidence are listed under the input box.

## Formats

### Protobuf (raw, no schema)

The same idea as protoc --decode_raw. Each field shows its number and wire type.

- **Varint** shows uint, sint (zigzag decoded) and bool when the value is 0 or 1.
- **Fixed32** shows uint, int and float. **Fixed64** shows uint, int and double.
- **Length-delimited** fields are ambiguous. The default follows protoc: printable UTF-8 text first, then a nested message if the bytes parse as one, then packed varints, then raw bytes. Each length-delimited field has a selector that switches it to bytes, string, nested message or packed varints. Protobuf has no schema, so a message-looking parse is only a suggestion.
- **Groups** (deprecated wire types 3 and 4) are supported.
- Field number 0, wire types 6 and 7, truncated varints and lengths that run past their container are reported with the byte offset.

### CBOR (RFC 8949)

All major types, definite and indefinite lengths, and the simple values including half, single and double floats. Tags are shown with their diagnostic form, for example 1(1363896240) or 2(h'010000000000000000'). The following tags are interpreted:

- Tag 0 and tag 1: date/time (tag 1 also shows the ISO time).
- Tags 2 and 3: bignums, decoded to exact integers.
- Tag 24: embedded CBOR. The inner item is decoded as a child node with the correct offsets.
- Tag 55799: self-described CBOR. It is transparent.

The Diagnostic export writes RFC 8949 diagnostic notation. The JSON export uses $-wrappers for values JSON cannot hold, so the Encode JSON tab can write the same bytes back: {"$hex": ...} for byte strings, {"$int": ...} for large integers, {"$float": "NaN"} for non-finite floats, {"$simple": n} and {"$tag": n, "$value": ...} for other tagged items. Several concatenated items are shown as a sequence.

### MessagePack

The full specification: fixint, fixmap, fixarray, fixstr, bin, ext, float, all integer widths and the fixext forms. The timestamp extension (type -1) is shown as ISO time in its 4, 8 and 12 byte forms. Other ext types are shown as hex with their type number. 0xc1 is rejected because the specification reserves it.

### BSON

Documents, arrays and every element type in the BSON 1.1 specification, including the deprecated ones (undefined, DBPointer, symbol, code with scope, old binary subtype 2). Dates, ObjectIds and decimal128 values are shown in their usual notation. The length prefix must match the input, and the trailing bytes after the document are reported.

## Hex view, search and data inspector

The hex view is shared by the Decode and Struct tabs.

- **Click a byte** to select it. The data inspector under the hex view then shows the bytes at that offset as u8, i8, u16, i16, u24, i24, u32, i32, u64, i64, f32 and f64, plus binary, ASCII character and a Unix time (u32 seconds, shown in UTC). Only the widths that fit before the end of the data are shown. The **little-endian / big-endian** button switches the byte order.
- **Search** finds a hex pattern (for example de ad ?? ef, where ?? matches any byte) or UTF-8 text. Enter or the Next and Prev buttons step through the matches, which are selected in the hex view. At most 1000 matches are listed.

## Struct tab

Write one field per line and the tool reads the bytes in order, showing each field's value, type, offset and length. Click a field to highlight its bytes.

| Syntax | Meaning |
|---|---|
| name: u16 | Scalar. Types: u8 i8 u16 i16 u32 i32 u64 i64 f32 f64 bool |
| endian le or endian be | Default byte order from that line on (little-endian if omitted) |
| name: u16be, name: u32le | Byte order for one field |
| name: u8[4] | Array with a fixed count |
| name: u8[len] | Count taken from an earlier numeric field named len |
| name: u8[*] | As many items as fit in the rest of the data |
| name: char[8], name: cstr | UTF-8 text with a fixed length, or zero-terminated |
| name: bytes[n], name: skip[n] | Raw bytes shown as hex, or bytes to skip |
| name: u32 hex | Number format: hex, bin or dec |
| # comment | Ignored |

The **Start offset** box begins decoding part-way into the data. You can paste hex or base64, or open a file up to 16 MB. **JSON** exports the field values as text. A field that does not fit in the remaining data stops decoding with an error message that gives the offset. Template mistakes are listed under the template with their line number.

Not supported: nested structs, unions, bitfields, conditions and loops, and enums. Use a full tool such as ImHex, 010 Editor or Kaitai Struct for those.

## Auto-detection

Auto-detect tries every format and ranks the ones that decode the whole input. The score is a heuristic, not proof:

- BSON scores high when the length prefix matches the input and the document parses.
- CBOR and MessagePack both accept many byte strings. The one that uses tags, floats or extensions scores higher.
- Protobuf scores by the number of fields, small field numbers and the absence of groups.

Very short inputs are capped at a low confidence. Pick a format explicitly when you know it.

## Framing

Framing wraps a payload so that it can travel over a byte stream. Choose a framing in the Decode tab to split the input into frames. Each frame is listed with its offset, its length and any error. Click a frame to decode its payload. The Framing tab does the same work directly.

| Mode | Encoding | Notes |
|---|---|---|
| **COBS** | Removes all 0x00 bytes, then the frame ends with 0x00. | Overhead is at most one byte per 254 bytes. The encoder can append the 0x00 delimiter. |
| **COBS/R** | Standard COBS, but the final code byte is dropped when the last data byte is at least as large as the code it would replace. | Saves a byte in some cases. Inputs that end in 0x00 encode exactly as COBS. |
| **SLIP (RFC 1055)** | END is 0xC0, ESC is 0xDB, ESC_END is 0xDC and ESC_ESC is 0xDD. Frames are wrapped in END. | Invalid escape sequences are reported. |
| **HDLC-style** | Flag 0x7E, escape 0x7D, the escaped byte is XORed with 0x20. | The frame check sequence (CRC) is not checked. The 0x7D 0x7E abort sequence is reported. |

Every encoder result is decoded again as a round-trip check.

## Using the tool

1. Open **Decode**. The example protobuf payload is already loaded. Click another example to try the other formats.
2. Paste hex or base64, or open a file. Check the text encoding line under the input.
3. Leave the format on Auto and read the ranking, or force the format.
4. For a framed stream, choose the framing, then click a frame.
5. Click a node in the tree. Its bytes are highlighted in the hex view, which pages through the payload in 2 KB blocks. Click any byte to see it in the data inspector.
6. For protobuf, use the selector on a length-delimited field to change its interpretation.
7. Export JSON, or the CBOR diagnostic notation. Send the payload to the Framing tab to re-frame it.

## Limits and what it does not do

- It does not know your schema. Field names, enum values and types are not recovered. Protobuf output is a field-number tree.
- Heuristic choices (text versus nested message, auto-detected format) can be wrong. The tree always shows the interpretation that was used.
- The tree shows at most 500 children per node. Export JSON for everything.
- Inputs above 200,000 items are refused for the tree view to keep the page responsive.
- The encoders take JSON-like values only. There is no BSON encoder. CBOR tags and simple values are written only through the $tag and $simple wrappers, and MessagePack rejects tags and simple values because it has neither.
- COBS/R is implemented from the public description of the variant. Compare it with another implementation before relying on it for interoperability.
- The encoder for MessagePack always writes floats as 64-bit values.
- The Struct tab is a flat template only (see above), and the data inspector reads one value at the selected offset.
- Nothing is saved between visits. Use the export buttons to keep results.

## Troubleshooting

| Symptom | Cause | What to do |
|---|---|---|
| Input is rejected as hex | Odd number of digits, or a non-hex character | Check for a stray character, or pick Base64 explicitly |
| Protobuf shows strange nested messages | A byte string happens to parse as a message | Use the field selector to choose bytes or string |
| Auto picks the wrong format | Several formats decode the same bytes | Choose the format explicitly |
| "unexpected break code" (CBOR) | An indefinite-length item was closed too early or the input is not CBOR | Check the start of the input |
| "invalid UTF-8" | A text string holds non-UTF-8 bytes | The payload is probably binary, not text; try protobuf or raw bytes |
| "no frames found" | Framing does not match the stream | Try a different framing mode |
| COBS frame shows "zero byte inside frame" | Frame was split in the wrong place, or is not COBS | Check the delimiter and the framing |

## Similar tools

The Struct tab, data inspector and search were modelled on features of Kaitai Struct Web IDE (live tree next to a hex view), ImHex (pattern language and data inspector), 010 Editor (binary templates) and Hex Fiend (templates). Those tools offer much richer languages; this one runs in a browser tab with no install.

## Related tools in this app

- **Hash and HMAC calculator**, to checksum a payload.
- **JWT inspector**, for another structured-data format decoded in the browser.
- **Packet Lab**, for payloads captured from a live serial link.

## Standards and references

- Protocol Buffers wire format (varints, wire types, groups), as used by protoc --decode_raw.
- RFC 8949: Concise Binary Object Representation (CBOR), including appendix A test vectors.
- The MessagePack specification (msgpack.org), including the timestamp extension.
- BSON specification 1.1 (bsonspec.org).
- RFC 1055: SLIP. HDLC-style flag and escape stuffing as used by PPP and similar links.
- COBS (Cheshire and Baker, 1999) and the COBS/R variant as described in its public documentation.
`,
};
