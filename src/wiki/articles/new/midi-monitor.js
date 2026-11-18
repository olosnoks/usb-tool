export default {
  id: 'midi-monitor',
  toolId: 'midi-monitor',
  category: 'utilities',
  title: 'MIDI Monitor & SysEx Librarian — Web MIDI decoder, sender, dump library and loopback latency',
  summary: 'Watch every MIDI message from your browser-visible inputs with full decoding (notes, CC names, RPN/NRPN, pitch bend, MTC, clock tempo, SysEx and manufacturer IDs), send notes, CC, program change and raw bytes, capture and manage .syx dumps, and measure loopback round-trip latency. Runs in Chromium over Web MIDI.',
  tags: ['MIDI', 'Web MIDI', 'SysEx', '.syx', 'MIDI monitor', 'RPN', 'NRPN', 'MIDI clock', 'MTC', 'Universal SysEx', 'Identity Reply', 'Latency'],
  readTime: '12 min read',
  content: `
# MIDI Monitor & SysEx Librarian

The **MIDI Monitor & SysEx Librarian** is a Web MIDI workbench. It shows the MIDI traffic that your computer receives from synths, controllers, interfaces and virtual ports, decodes each message, lets you send messages back, keeps a library of System Exclusive (SysEx) dumps, and measures how long a message takes to come back through a loopback. Nothing is simulated: the tool only shows messages the browser actually receives, and only sends what you ask it to send.

## Browser and permission requirements

- **Chromium only.** Web MIDI is implemented in Chrome, Edge and Opera. Firefox and Safari do not provide \`requestMIDIAccess\`, and the tool shows a message in those browsers instead of a working panel.
- **Secure context.** Serve the page over https or open it on \`localhost\`. Web MIDI is refused on plain http from other hosts.
- **Click Enable MIDI.** Access is requested only from a click. The browser then shows its MIDI permission prompt. The tool asks for SysEx access (\`requestMIDIAccess({ sysex: true })\`), so the same prompt covers SysEx send and receive.
- **If you deny it,** open the site settings (the icon at the left of the address bar), allow MIDI, and press Enable MIDI again.
- **Drivers.** On Windows, most USB class-compliant MIDI devices appear through the built-in driver. Devices that need a vendor driver appear once that driver exposes a MIDI port. Virtual loopback ports (such as loopMIDI) show up as ordinary ports. Hot-plugged devices appear in the port list as they connect.

## Ports

The header shows an **Output** selector used by the Send tab and the latency test. The port panel lists every input (with a checkbox to listen to it) and every output, with its name, manufacturer and state (connected or disconnected). Unticking an input stops the monitor and the SysEx capture from listening to it. Port changes are picked up automatically; the Refresh button re-reads the list.

## Monitor tab

Each received message is shown on one line with the time (seconds since the page loaded), the port it came from, a category, the decoded text and the raw hex.

**Decoding**

| Message | What is shown |
| --- | --- |
| Note On / Note Off | Note name and number, velocity, channel. Note On with velocity 0 is shown as Note Off and flagged. |
| Control change | Controller number and standard name (for example 7 Channel Volume, 64 Sustain Pedal, 74 Brightness (Cutoff)). LSBs 32-63 are labelled as LSBs. |
| RPN / NRPN | Assembled from CC 101/100 (RPN) or 99/98 (NRPN) followed by Data Entry CC 6 (MSB) and CC 38 (LSB). Registered RPNs get their names, for example 0x0000 Pitch Bend Range. RPN 127/127 is shown as null. |
| Program change | Program number and channel. |
| Pitch bend | Signed value around centre (-8192 to +8191) plus the 14-bit raw value. |
| Aftertouch | Channel pressure and polyphonic (per-note) pressure. |
| MIDI clock | Each 0xF8 tick, with a tempo estimate in BPM once two ticks have arrived. The estimate averages up to 48 ticks (two beats) and uses the browser's event timestamps. Start, Continue and Stop are shown as transport messages. |
| Active sensing | Shown under its own category. |
| MTC | Quarter-frame pieces, and a full timecode (HH:MM:SS:FF with frame rate) once all eight pieces arrive. |
| Song position / song select / tune request / system reset | Decoded in the song/system category. Song position is in sixteenth notes (14-bit). |
| SysEx | The manufacturer, with a lookup for common 1-byte IDs (Roland 41, Yamaha 43, Korg 42 and others) and 3-byte IDs written 00 xx xx (for example Alesis 00 00 0E). Universal SysEx is decoded too: Identity Request and Identity Reply (manufacturer, family, model and software version), master volume, General MIDI on/off and MMC transport commands. Unknown IDs are shown raw. |

**Controls**

- **Channel** shows one channel only. Channel messages on other channels are hidden; system and SysEx messages always show.
- **Category checkboxes** hide or show each message category. The **Hide clock + sensing** button hides the high-rate clock and active-sensing traffic, which otherwise fills the list.
- **Note names** chooses how note numbers are labelled. C4 = 60 is the scientific convention used by many manufacturers. C3 = 60 is used by Yamaha, Ableton and Logic. The MIDI number itself is unchanged.
- **Pause** freezes the list. The tool keeps decoding while paused, so the clock tempo and RPN state stay current.
- **Export JSON** saves the stored messages (up to 3000) with their timestamps and raw hex.

**Decode raw bytes** (inside the Monitor tab) takes a pasted stream of hex bytes, for example \`90 3C 64 3E 64 F8 F0 7E 7F 06 01 F7\`. It handles running status (a repeated status byte can be left out), real-time bytes inside other messages, and SysEx interrupted by a status byte. Pasted data has no timing, so no clock tempo is estimated.

## Send tab

- **Channel and velocity** apply to the note and controller messages below.
- **Note keyboard.** Click or press keys on the on-screen piano (25 keys from the base note; change the base note to move it). Releasing the pointer sends Note Off.
- **Computer keyboard.** With no text box focused and the Send tab open, the keys A W S E D F T G Y H U J K O L P ; play notes from the base note upward, like a DAW piano-key row. Holding a key sends one Note On; releasing it sends the Note Off.
- **Control change.** Choose a controller number and drag the slider; each change is sent immediately.
- **Program change.** Choose a program number (0-127) and send it.
- **Identity Request.** Sends \`F0 7E 7F 06 01 F7\` (all devices). Devices that support Universal SysEx reply with an Identity Reply, which the monitor decodes.
- **Raw hex.** Sends one message as typed. Spaces, commas and 0x prefixes are allowed. The first byte must be a status byte, and a SysEx must start with F0 and end with F7.

Every message sent is also written to the monitor log, marked as outgoing.

## SysEx Library tab

A SysEx dump is one message from F0 to F7. The library keeps dumps in this browser so you can resend them later.

- **Capture.** While the box is ticked, every complete or truncated SysEx received on a listened input is added to the library, named with the port and time. Rename dumps by editing their name.
- **Import .syx.** A .syx file can hold many messages back to back. The importer splits it at each F0...F7 and adds one library entry per message. A message that has no F7 before the next status byte is imported and marked **truncated**.
- **Export.** Export selected entries as one .syx file (the messages are concatenated in list order), or export a single entry with its .syx button.
- **Send.** Send one entry, or every selected entry in list order, to the chosen output. **Delay between messages** (0-5000 ms) waits between messages. Many devices need a pause between dumps, so start with 50 ms and increase it if a device drops data. **Stop** ends a running send after the current message.
- **Storage.** The library is saved in localStorage, which holds about 5 MB per site. Large dumps use up that space quickly; export .syx files to keep copies. The library holds up to 200 entries.

## Latency tab

The loopback test measures a round trip: the tool sends a Note On (note 60, channel 16) on the chosen output and waits for the same note to arrive on the chosen input, then sends a Note Off. Each trial times out after one second.

To run it you need a loopback route: a MIDI cable from the output device's MIDI OUT to the input device's MIDI IN, or a virtual loopback port that sends what it receives back to its input. Without a route every trial times out and no latency is reported.

Results show the count, timeouts, minimum, median, mean, maximum and standard deviation, plus each sample. The timing comes from the browser: the send time is taken just before the send call, and the receive time is the event timestamp the browser assigns to the incoming message. The figure therefore includes USB and driver latency and some browser scheduling. It is a useful comparison between setups, not a hardware-grade measurement.

## Limits and what the tool does not do

- It decodes messages; it does not edit, merge or transpose MIDI files and does not record or play back a sequence.
- It does not interpret manufacturer-specific SysEx beyond naming the manufacturer. For example it does not check Roland checksums or parse a patch format. The dump is stored and sent byte for byte.
- The manufacturer table is a partial list of well-known IDs. An ID that is not in it is shown as unknown with its raw bytes. The MIDI Manufacturers Association publishes the full list.
- Clock tempo is estimated from arrival times in the browser. Expect jitter of a few BPM when the system is busy.
- The monitor shows the most recent 400 matching messages and stores up to 3000. Older messages are dropped.
- Channel-filter and category filters apply to the display; they do not stop the decoder from tracking clock or RPN state.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| "Web MIDI is not available" | You are not in Chromium, or the page is not on https or localhost. Open it in Chrome, Edge or Opera. |
| Enable MIDI does nothing and shows an error | The permission was denied or dismissed. Allow MIDI in the site settings and press Enable MIDI again. |
| Device missing from the port list | The OS or driver does not expose it. Check that another application is not holding it and that its vendor driver is installed. Unplug and replug, then press Refresh ports. |
| Monitor is full of clock messages | Press Hide clock + sensing, or untick Clock / transport in the category list. |
| Note names look an octave off | Your device uses a different convention. Switch Note names between C4 = 60 and C3 = 60. The MIDI number is the same. |
| Sent SysEx is ignored | Check the delay (a device may need more time between messages) and that the dump is complete. Truncated imports are marked in the library. |
| Latency test times out every time | There is no loopback route from the chosen output to the chosen input. Connect them, or pick a virtual loopback port pair. |
| "Could not save the SysEx library" | localStorage is full. Export the dumps you need to .syx and delete the rest. |

## Related tools in this app

- **I2C & SPI Bus Explorer** for I2C and SPI devices (over a Bus Pirate), a different kind of bus to the one this tool watches.
- **Hash & HMAC Calculator** for checking a .syx file or a dump against a published digest.
`,
};
