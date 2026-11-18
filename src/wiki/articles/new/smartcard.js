export default {
  id: 'smartcard',
  toolId: 'smartcard',
  category: 'pentesting',
  title: 'Smart Card Toolkit — ATR, APDU, TLV and trace analysis (offline)',
  summary: 'Offline analysis for smart card data: parse an ATR per ISO 7816-3, decode command and response APDUs and status words, read a pasted trace log as a conversation, decode BER-TLV with EMV and PIV tag names, and build common APDUs to copy into a reader tool. It does not talk to a reader.',
  tags: ['Smart card', 'ATR', 'APDU', 'ISO 7816', 'TLV', 'BER-TLV', 'EMV', 'PIV', 'PC/SC', 'pcsc-tools', 'Proxmark3', 'hf 14a apdu', 'Status word', 'GlobalPlatform', 'OpenPGP'],
  readTime: '8 min read',
  content: `
# Smart Card Toolkit

The **Smart Card Toolkit** is an offline analyser for smart card data. Paste hex or a trace captured somewhere else and the tool explains it: what the card said in its ATR, what each command asked for, what each status word means, and what a TLV record contains. It has six tabs: **ATR**, **APDU**, **Trace**, **TLV**, **Build** and **Script**.

## What this tool cannot do

**It cannot drive a smart card reader.** Chrome's WebUSB blocks the smart card interface class (0x0B), so a CCID reader, contact or contactless, cannot be opened from an ordinary web page. The standard Web Smart Card API is only available to Isolated Web Apps, not to pages like this one. The tool therefore never sends an APDU and never reads a card. Every result comes from text you paste.

Capture the data with a tool that can talk to the reader, then paste it here:

- **pcsc-tools** (for example \`scriptor\` or \`pcsc_scan\`) on a PC with a PC/SC reader.
- **Proxmark3** with \`hf 14a apdu\` for ISO 14443-4 cards, or its other 14A and 14B commands.
- **Flipper Zero** NFC dumps, where the card's data was saved to a file.
- Your own **logs** from a reader library or a test rig.

## ATR tab

The Answer To Reset is the first bytes a contact card sends after power-up. Paste the hex (for example from pcsc-tools or \`pcsc_scan\`).

The parser follows ISO/IEC 7816-3 and shows:

- **Convention:** TS is \`3B\` (direct) or \`3F\` (inverse). For inverse, the bytes after TS are bit-reversed before parsing; the raw hex is still displayed unchanged.
- **T0:** the Y1 nibble (which interface bytes follow) and K, the number of historical bytes.
- **Interface bytes:** every TA, TB, TC and TD in each group, with a note on what TA1 (FI/DI), TB1 (deprecated VPP), TC1 (extra guard time) and TDi (protocol) mean.
- **Protocols:** T=0 and T=1 as listed by the TDi nibbles.
- **Transmission (FI/DI):** a bit-rate estimate from TA1 at the ISO default clock of 3.5712 MHz. Only the common FI and DI values are tabulated; others show as "not tabulated here" rather than a guessed number. With no TA1 the ISO default (9600 bps) is shown and labelled as the default.
- **TCK:** required when a protocol other than T=0 is indicated. The XOR of T0 through TCK must be zero, and the result is shown.
- **Historical bytes:** the hex, an ASCII preview, the category byte (0x00 status, 0x10 DIR reference, 0x80 compact-TLV) and, for category 0x80, the compact-TLV objects.
- **Length:** the expected length from the interface bytes, K and TCK, with errors for truncation and warnings for extra bytes.

The interface-byte table explains each byte by the protocol that governs its group (the low nibble of the previous TD): TA2 (specific mode, negotiable or not, implicit parameters), TC2 (work waiting time WI), and for T=1 groups TA3 (IFSC), TB3 (BWI and CWI) and TC3 (LRC or CRC). For T=15 groups TA shows clock-stop support and the supported voltage classes (A, B, C). Bytes outside these cases are shown as raw hex.

**Copy report** copies a plain-text summary of the parsed ATR (convention, T0, interface notes, protocols, historical bytes, TCK, errors) in a pcsc_scan-like layout, for notes or bug reports.

There is a small table of **known patterns**. These are hints, not identifications: the PC/SC pseudo-ATR that a reader synthesises for a contactless ISO 14443 tag, a historical-bytes text match for "YubiKey", and a text match for "Java". A text match does not prove the card model, so check the application list before relying on it.

## APDU tab

Paste a **command APDU** and the tool splits it into CLA, INS, P1, P2, Lc, data and Le. It recognises the four ISO 7816-4 cases in both encodings:

- **Case 1:** header only.
- **Case 2:** header and Le.
- **Case 3:** header, Lc and data.
- **Case 4:** header, Lc, data and Le.
- **Short:** one-byte Lc and Le, where an Le of 00 means 256.
- **Extended:** a leading 00 with two-byte Lc and Le, where an extended Le of 0000 means 65536.

For the CLA byte it shows the ISO chaining bit, the secure messaging mode and the logical channel. Proprietary classes are labelled as application-specific.

The INS name comes from a table of ISO 7816-4 instructions plus common GlobalPlatform, EMV, PIV and OpenPGP instructions. The same INS byte can mean different things in different applets, so the tool lists which families use it.

Paste a **response APDU** (optional) and the tool shows the status word and its meaning. The table covers \`90 00\`, \`61 xx\` (more data, use GET RESPONSE), \`6C xx\` (wrong Le, use xx), \`63 Cx\` (verification failed, x tries left), \`62\` and \`63\` warnings, \`64\`/\`65\` memory errors, \`67 00\` wrong length, \`68\` CLA not supported, \`69\` security and command-not-allowed errors (for example \`69 82\`, \`69 83\`, \`69 84\`), \`6A\` parameter and file errors (\`6A 82\` file not found, \`6A 83\` record not found, \`6A 86\` wrong P1P2), \`6B 00\`, \`6D 00\`, \`6E 00\`, and \`6F 00\`. Vendor-specific words such as \`91 xx\` are labelled as such.

## Trace tab

Paste a trace log. Reader-to-card lines start with \`>>\` (or \`>\`, \`->\` or \`TX\`) and card-to-reader lines start with \`<<\` (or \`<\`, \`<-\` or \`RX\`). Timestamps before the marker and comments after the hex are ignored.

The tool shows the conversation step by step: an ATR if the first response starts with \`3B\` or \`3F\`, then each command with its decoded fields and each response with its status word. A command with no response line is flagged. Responses without a command are flagged as orphans. Each line has a copy button for its hex.

**Convert gp -d / scriptor output** rewrites the text in the box into \`>>\` and \`<<\` lines. It understands GlobalPlatformPro debug output (\`A>>\` and \`A<<\` lines), scriptor output (\`Sending:\` and \`Response: data : SW\` lines) and lines that already have a marker. Other lines are dropped and the count is shown. The conversion is a text match on those formats, so check the result against your tool version.

The example trace in the tool is illustrative, not a capture from a real card.

## TLV tab

Paste BER-TLV data, for example the response of a READ RECORD, a GET DATA, or the FCI from a SELECT. The decoder handles:

- Multi-byte tags (for example \`9F36\`, \`9F8101\`).
- Short and long-form lengths.
- Constructed objects, shown as a collapsible tree with byte offsets.
- Padding bytes (00 and FF) between top-level objects.

It flags truncated values and indefinite lengths (BER only, not supported here) and stops descending past 12 levels.

Names come from an **EMV dictionary** of about 80 common tags (for example \`4F\` AID, \`5A\` PAN, \`5F24\` expiry, \`82\` AIP, \`94\` AFL, \`9F26\` cryptogram, \`9F27\` CID, \`9F36\` ATC, \`9F38\` PDOL, \`BF0C\` issuer data, \`A5\`, \`6F\`, \`70\`, \`77\`, \`80\`, \`61\`), then a **PIV dictionary** (NIST SP 800-73: \`53\`, \`5C\`, the \`5FC1xx\` data objects such as CHUID \`5FC102\` and the PIV authentication certificate \`5FC105\`, plus \`7E\`, \`7F21\`, \`7F49\`). Where the two dictionaries overlap, the EMV meaning is shown. Tags not in either dictionary show no name.

## Build tab

Build an APDU and copy the hex:

- **SELECT by AID:** choose from a list of known AIDs (PIV, OpenPGP, Visa, Mastercard, Maestro, the GlobalPlatform default Issuer Security Domain, the NFC Forum NDEF application, and the PPSE payment directories), or enter a custom AID of 5 to 16 bytes. The output is \`00 A4 04 00 Lc AID 00\`.
- **GET RESPONSE:** the Le from a \`61 xx\` response.
- **READ RECORD:** record number, SFI (0 means the currently selected file) and Le.
- **GET DATA:** a one- or two-byte tag.
- **VERIFY:** a note only. A VERIFY command carries a PIN, and this tool does not build PIN APDUs. Watch the retry counter: a wrong PIN returns \`63 Cx\`, and a blocked PIN returns \`69 83\` or \`69 84\`.
- **Custom:** CLA, INS, P1, P2, optional data, optional Le, and an option to force extended length.

Short encoding is used unless the data or Le needs extended length. Paste the hex into the raw APDU field of your reader tool, or the hex payload of \`hf 14a apdu\` on a Proxmark3 (check \`hf 14a apdu -h\` for your client version).

## Script tab

Write or paste a scriptor-style script: one command APDU per line in hex, \`#\`, \`;\` or \`//\` comments, and lines starting with \`/\` (for example \`/reset\`) kept as directives. Each line is checked as an APDU and listed with its INS name; lines that are not valid APDUs are reported with their line number.

Commands that change card state or use secrets get a warning: VERIFY, CHANGE and RESET RETRY COUNTER, EXTERNAL AUTHENTICATE, INITIALIZE UPDATE, DELETE, INSTALL, PUT KEY, PUT DATA, UPDATE BINARY and RECORD, APPEND RECORD, CREATE and DELETE FILE, and SET STATUS. A wrong PIN or key can lower a retry counter or lock the card, so only run such a script on your own card.

The export box turns the script into text for another tool: a **scriptor file** (with a leading \`/reset\`), one \`opensc-tool -s\` command per APDU, a single \`gp -a\` command line, or a **pyscard** snippet. These are strings to copy. The page never runs them and never contacts a reader.

## Similar tools

The toolkit was compared with pcsc-tools (pcsc_scan, scriptor and the ATR_analysis parser with its smartcard_list.txt database), online ATR parsers, pyscard and GlobalPlatformPro. Unlike those, it does not talk to a reader and does not include an ATR-to-card-model database, so an ATR is parsed but not identified.

## Browser requirements

Nothing special. The tool runs in any modern browser, including Firefox and Safari, because it uses no hardware API. Copy buttons use the clipboard API, which needs a secure context (https or localhost).

## Limits

- It does not read or write any card or reader, and it has no simulation mode. Scripts are checked and exported, never executed. Everything shown comes from the text you pasted.
- The FI table covers the common values only; others are reported as not tabulated.
- The historical-byte category interpretation follows ISO 7816-4 at a basic level. Vendor structures inside the historical bytes are shown raw.
- The EMV and PIV dictionaries are incomplete by design. Unknown tags are shown without a name.
- A pattern hint is not a card identification.
- Trace parsing uses the leading hex run after each marker. A line with no marker, or whose marker is not one of the listed forms, is counted as ignored.

## Troubleshooting

- **"Not a hex string":** remove anything that is not hex. Separators (spaces, colons, commas, dashes) and a 0x prefix are accepted.
- **"Hex has an odd number of digits":** a byte is cut in half; check the copy.
- **TCK check failed:** the ATR was altered, truncated or copied wrongly. Re-capture it.
- **Command shows "does not match any APDU case":** the length does not fit any of the four cases. A common cause is a trailing byte from a log timestamp pasted into the hex field.
- **Trace shows many ignored lines:** the markers are not one of the forms listed above. Add \`>>\` and \`<<\` markers, or reformat the log.
- **A TLV tag shows no name:** it is outside the dictionaries. Search the EMV book or the issuer specification for that tag.

## Related tools in this app

The Proxmark3 and Flipper Zero tools can capture the raw card exchanges that this toolkit analyses. The FIDO2 workbench covers a different authenticator protocol (CTAP) that also runs over USB. Use the Hash Calculator to check a dump file's integrity before analysing it.
`,
};
