/**
 * Web NFC Reader / Writer wiki article.
 */

export default {
  id: 'web-nfc',
  toolId: 'web-nfc',
  category: 'rf',
  title: 'Web NFC Reader / Writer — NDEF scan, write, lock and offline parser',
  summary: 'Reads and writes phone-style NFC tags (NDEF) through the browser\'s Web NFC API on Chrome for Android, with an offline NDEF parser and builder that works on any browser.',
  tags: ['NFC', 'Web NFC', 'NDEF', 'NTAG', 'NDEFReader', 'Wi-Fi QR', 'WSC', 'vCard', 'Type 2 tag', 'NFC Forum', 'URI record', 'Smart poster', 'Android NFC'],
  readTime: '8 min read',
  content: `
# Web NFC Reader / Writer

The **Web NFC** tool uses the browser's \`NDEFReader\` to read and write NDEF data on NFC tags held against the back of an Android phone. It also includes an **offline NDEF parser and builder** that needs no NFC hardware at all: paste raw bytes from a tag dump and see every record, or compose records and get the exact bytes.

## Browser and hardware requirements

- **Chrome for Android** (version 89 or newer). Web NFC is not available in desktop Chrome, Edge, Firefox or Safari. On a PC the tool says so and shows the Web NFC unavailable banner.
- **HTTPS.** Web NFC only runs in a secure context.
- **NFC turned on** in the Android settings, and a user tap on the page before scanning or writing. Scanning never starts on its own.
- Tags must be NDEF-formatted (NTAG213, NTAG215 and NTAG216 are the common ones). Raw Mifare Classic or other non-NDEF tags are not handled by Web NFC; use the **Proxmark3 / PM5 Suite** or **Flipper Zero Suite** tabs for those.

Only the Offline NDEF tab works on a PC.

## Read tab

Press **Start scanning**, then hold a tag against the phone. Each successful read shows:

- the **serial number (UID)** if the browser provides it,
- every **record** with its record type, MIME type, id, text encoding and language,
- the **decoded content**:
  - **Text** is shown as text, with its encoding and language.
  - **URL** and absolute URLs are shown as text with a copy button. Nothing is opened automatically.
  - **Smart posters** show their nested records.
  - **MIME JSON** is pretty-printed. Other \`text/*\` MIME types are shown as text.
  - **Wi-Fi credentials** (\`application/vnd.wfa.wsc\`) are decoded into SSID, auth type, encryption and network key. The key is hidden until you reveal it.
  - **Android application records** (\`android.com:pkg\`) show the package name.
  - Other MIME types, external types and unknown records are shown as hex, with a **Download payload** button.

Every record also has a collapsible **payload hex** view.

**Scan history** keeps the last 200 reads in this session with their time. Click an entry to show it again. **JSON** exports the whole history (decoded records, including hex) as a file. **Clear** empties the list. History lives in memory only and is lost when the tab reloads.

## Write tab

Compose a message from one or more records. They are written in the order shown. Record types:

| Type | What it writes |
|---|---|
| **Text** | Well-known \`T\` record, UTF-8, with a language code (default \`en\`). |
| **URL** | Well-known \`U\` record. The URL is compressed with the NFC Forum URI prefix table (codes 0x00 to 0x23), so \`https://www.\` and \`https://\` are stored as one byte. |
| **Wi-Fi (WSC)** | MIME \`application/vnd.wfa.wsc\` with a Wi-Fi Simple Configuration credential: SSID (0x1045), network key (0x1027), auth type (0x1003), encryption type (0x100F), wrapped in the credential attribute (0x100E) with network index 1 (0x1026). Many Android phones offer to join the network when they read such a tag; behaviour depends on the Android version. |
| **vCard** | MIME \`text/vcard\` (vCard 3.0) from name, organization, title, phone, email and website fields. Special characters are escaped. |
| **MIME JSON** | MIME \`application/json\`. The text must be valid JSON. |
| **Android app record** | External type \`android.com:pkg\`. Android opens the named app when it reads the tag, or offers to install it. |
| **Raw MIME (hex)** | Any MIME type with a payload you type as hex. |
| **Raw external (hex)** | Any \`domain:name\` external type with a hex payload. |

The **preview** shows the NDEF message size and hex before anything is written. The sizes shown are checked against the NTAG family: NTAG213 holds 144 bytes, NTAG215 holds 504 and NTAG216 holds 888. A message larger than the tag will fail to write.

**Overwrite existing NDEF data** is on by default. When it is off, the write is refused if the tag already holds NDEF data. Press **Write to tag**, keep the tag held against the phone, and wait for the confirmation. **Abort write** cancels a pending operation.

### Make tag read-only (permanent)

This locks a tag so it can never be written again. It is **irreversible**, and most NTAG tags cannot be unlocked. The tool makes you confirm it in stages: one click to open the warning, a checkbox that you cannot undo, typing \`LOCK\`, and then a native browser confirmation dialog before the lock is sent. Lock only tags you intend to keep exactly as they are.

## Offline NDEF tab

This tab needs no NFC hardware and works on any browser.

**Parse raw NDEF.** Paste hex in either of two forms:

- a raw NDEF message, which starts with a record header whose MB flag is set (for example \`d1 01 08 54 02 65 6e 48 65 6c 6c 6f\`), or
- a **Type 2 tag memory dump** that contains a \`03\` NDEF TLV, as produced by Proxmark3 or Flipper Zero dumps. The parser skips NULL (\`00\`), lock (\`01\`) and memory-control (\`02\`) TLVs, reads the 03 TLV (including the \`FF\` three-byte length form), and stops at \`FE\`.

Spaces, colons, dashes and \`0x\` prefixes are ignored. The parser reads each record's flags (MB, ME, CF for chunked records, SR for short records, IL for an id field) and TNF (empty, well-known, MIME, absolute URI, external, unknown, unchanged). It reports record type, MIME type, id, payload and decoded content, and notes any trailing bytes or a missing ME flag. Smart posters are parsed recursively.

**Build raw bytes.** Uses the records currently in the Write tab and shows:

- the NDEF message as hex,
- the same message wrapped in a Type 2 TLV (\`03 len ... FE\`), ready for page 4 of a NTAG,
- the record types read back from the built bytes, as a check.

**Load into parser** copies the TLV output into the parser so you can see exactly what would be stored. **Download** saves the raw NDEF message as a \`.bin\` file.

## Limits and what this tool does not do

- It does not emulate a tag, and it does not read the UID-level or password-protected data of NTAG tags. Only the NDEF content that Web NFC exposes is read.
- It does not write raw TNF 1 or TNF 5 records from the composer. Web NFC only accepts MIME, external and the record types it defines, so those are composed only through the offline builder.
- Wi-Fi credentials support WPA2 and WPA/WPA2 personal networks with AES or TKIP, and open networks. WEP is decoded but not written. The passphrase must be 8 to 63 printable ASCII characters.
- Web NFC reports the serial number only when the browser supplies it.
- The Web NFC path has been written against the Web NFC specification but has not been tested on hardware in this app. The offline parser and builder are covered by unit tests with known-good vectors.

## Troubleshooting

- **"Web NFC unavailable here"**: you are on a desktop browser, a non-Chrome Android browser, or the page is not HTTPS.
- **"Permission denied" or no reaction**: tap the page first, then press Start scanning. Check the site's NFC permission.
- **"Could not read this tag"**: hold the tag still against the back of the phone and keep it there until the read finishes. Tap-range differs between phones; move the tag slightly if it fails.
- **Write refused**: the tag may already hold data with Overwrite turned off, may be read-only, or may be too small for the message. Check the size note in the preview.
- **Non-NDEF tag**: Mifare Classic or other tags are not NDEF. Use the Proxmark3 / PM5 Suite or Flipper Zero Suite tabs.

## Related tools

- **Proxmark3 / PM5 Suite**: 13.56 MHz and 125 kHz RFID on a PC, for tags and formats that Web NFC cannot reach.
- **Flipper Zero Suite**: companion tools for a Flipper Zero, which has its own NFC reader.
- **Hash & HMAC Calculator**: useful for checking the digest of a saved NDEF \`.bin\` file.
`,
};
