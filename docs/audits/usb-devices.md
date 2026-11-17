# Audit: "USB Devices" group

Scope: `usb-inspector` (Recon and Descriptor Explorer), `usb-rea`, `hid`, `usb-pd`, `intel-modal` (Chip Intelligence), `mass-storage`, `android` (ADB + fastboot), `ptp`, `fido2`, plus a correctness/usability-only review of `ducky`.
Method: read the components and utils named below; compared against established tools from knowledge (nothing was run, no hardware was available). Statements about Chrome behaviour (protected interface classes, HID blocklist) come from the WebUSB/WebHID specs and Chromium behaviour as I know it. Verify them on real hardware before relying on them (marked "verify").
Date: 2026-11-17. Audit only, no code changed.

## Architecture constraints that decide feasibility

| Constraint | Effect on this group |
|---|---|
| WebUSB protected interface classes (audio 01, HID 03, mass storage 08, smart card 0B, video 0E, audio/video 10, wireless controller E0) | `claimInterface()` rejects with SecurityError on those interfaces on every OS. Devices exposing only protected classes are normally not offered in the chooser (verify). Hits `mass-storage` hardest, and rules out reading HID report descriptors or UVC/UAC streams over WebUSB. |
| WebUSB needs an OS driver slot | Windows: the device needs WinUSB (Zadig / vendor driver) for ADB, fastboot, PTP, DFU. macOS: `ptpcamerad` grabs cameras. Linux: needs udev rules (the "Linux Setup" tool covers this). |
| WebUSB cannot sniff other software's traffic | No usbmon/Wireshark replacement. `usb-rea` has to stay capture-file based. |
| WebHID blocklist | FIDO (usage page F1D0) and some vendor devices are hidden. Keyboards/mice expose only their non-protected collections. |
| WebAuthn is not blocklisted | `navigator.credentials` works with security keys with no flag, but gives only high-level registration/assertion. |
| No raw block-device access from a web page | `File` / File System Access API can open disk image files, not `\\.\PhysicalDriveN` or `/dev/sdX`. |
| Browser-only | No local TCP listener (so no `adb forward/reverse` into the host), no TLS-over-USB wireless pairing. |

Test coverage seen (tests/): `usbDescriptors`, `hidInspector`, `hidReports`, `massStorage`, `diskImage`, `adb*`, `fastboot*`, `ptp`, `fido2`, `usbPd`, `stusbNvm`, `usbChipLabel`, `usbrea/*`. There are no tests for `UsbReconDeck`, `UsbDescriptorExplorer`, `DuckyScriptStudio`, the PTP/HID/Mass-storage components, or `HardwareIntelligenceModal`.

---

## 1. usb-inspector (Recon and Autopsy + Descriptor Explorer)

Files: `src/components/tools/UsbInspectorWorkbench.jsx` (tab host), `src/components/UsbReconDeck.jsx` (908 lines), `src/components/tools/UsbDescriptorExplorer.jsx`, `src/utils/usbDescriptors.js`, `src/utils/usbDatabase.js`.
The ids `autopsy`, `usb-descriptors` route to the same workbench.

### Does today
- **Descriptor Explorer** is a "WebUSB lsusb -v". It uses `requestDevice({filters: []})` or lists previously granted devices, and calls pure `describeDevice(device)`. That reads only what WebUSB already populates (VID/PID, bcdUSB, bcdDevice, manufacturer/product/serial strings, configurations, interfaces, alternates, endpoints). It decodes class/subclass/protocol through a small table (about 12 known triples) and shows endpoint address/type/packet size. It offers "Copy report" as text. It never sends data.
- **Recon and Autopsy** opens any device (empty filter), calls `selectConfiguration(1)` if needed, shows VID/PID/strings plus the UART-chip fingerprint (`identifyUsbChip`, 44 entries). It can claim an interface, do raw `transferOut` (hex payload) and a `transferIn` listen loop (64-byte reads), and has a "Bootloader forcers" tab: 1200-baud touch, ESP32 DTR/RTS strapping, DFU_DETACH control transfer, reboot-string storm, U-Boot autoboot-abort storm. It also has a text-only teardown guide tab.

### Reference tools
lsusb -v / `usbutils`, USBView, USB Device Tree Viewer (Uwe Sieber), Wireshark + usbmon / USBPcap, `usb.ids`, Chrome `chrome://usb-internals`.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Raw descriptor bytes + hex dump: full configuration descriptor via `controlTransferIn(GET_DESCRIPTOR type 2)`, device descriptor, device qualifier, other-speed config | Yes. Device-recipient standard requests do not need a claimed interface. | S | H |
| Class-specific descriptors (CDC functional, DFU functional, HID descriptor with report-descriptor length, UVC/UAC headers, hub, IAD, SS endpoint companion) decoded from the raw config blob | Yes (parse the raw bytes; WebUSB hides them) | M | H |
| BOS descriptor: USB 2.0 extension, SuperSpeed caps, WebUSB landing page URL, Microsoft OS 2.0 platform cap, Container ID | Yes (GET_DESCRIPTOR type 0x0F; WebUSB landing page URL via vendor request) | M | M |
| String descriptors in all LANGIDs, raw string index list | Yes | S | M |
| Vendor/product names from `usb.ids` (lsusb prints them; this tool shows only the UART-chip table and `productName`) | Yes, bundle a trimmed `usb.ids` (see ticket USB-2) | M | H |
| Device tree / topology (hubs, ports, speed, power draw `bMaxPower`) | Partly. `bMaxPower` and self-powered bit are in the config descriptor, speed is not exposed by WebUSB, topology is not exposed. | S (power only) | M |
| Plug/unplug events (`navigator.usb` `connect`/`disconnect`) and auto-refresh of granted devices | Yes | S | M |
| JSON export, diff of two devices | Yes | S | M |
| HID report descriptor, UVC/UAC, mass-storage-class control requests | No. HID/MSC/video/audio are protected classes (interface-recipient requests need a claim). | | |
| Real speed, port path, driver bound, USB power negotiation | No (not exposed to the web) | | |
| Traffic capture | No (see usb-rea) | | |

### Bugs and quality notes
1. `UsbReconDeck` DFU detach sends the request to `selectedInterface || 0`, i.e. whichever interface is highlighted, not the DFU interface (class FE/01/01). On a composite device this pokes the wrong interface. It needs to find the DFU runtime interface itself and refuse if there is none.
2. `UsbReconDeck` endpoint selection is by endpoint number only (`selectedEndpoint` is a number, `<option key={ep.endpointNumber}>`). An IN and an OUT endpoint with the same number (very common: 0x81/0x01) collide in the select, and `transferOut(1)`/`transferIn(1)` use the same value regardless of what was picked. The UI also never checks the interface was claimed first.
3. The `transferIn` listen loop is not stopped on unmount (no cleanup `useEffect`). It keeps polling a device the user navigated away from, and `device.close()`/`releaseInterface()` are never called anywhere in the file.
4. `transferIn(ep, 64)` is hard-coded rather than the endpoint's `packetSize`. Bulk or high-speed endpoints that send more than 64 bytes raise an overflow error, which the loop swallows as a 200 ms retry. The TextDecoder ASCII column shows garbage for binary data.
5. `parseInt` hex parsing for the OUT payload silently drops a trailing odd nibble and ignores non-hex characters, so "41 5" sends `0x41` and says it sent the payload.
6. `usbVersion` is rendered `${usbVersionMajor}.${usbVersionMinor}`: minor is BCD nibbles (0x10 for 2.1 becomes "2.1"), and the sub-minor is dropped. `usbDescriptors.js` formats it correctly; the Recon deck should reuse it.
7. The fingerprint panel always shows an "IDENTIFIED" badge, even when `intel.known === false`.
8. Boot forcers: the 1200-baud touch toggles DTR via `onToggleSignal('dtr')` (a toggle, not set) after changing baud, so the result depends on the current DTR state. It then forces `onBaudRateChange(115200)` instead of restoring `currentBaudRate`. The ESP32 strapping sequence has the same toggle problem (it assumes both lines start deasserted). These are serial-port tools living in a USB tool, and are not verifiable without hardware. Consider moving them to the serial side or showing state before/after.
9. `alert()` is used for errors (blocks the UI, inconsistent with the rest of the app, which uses `useSessionError`). Typo "Pypasses" in the banner copy.
10. `UsbDescriptorExplorer.jsx` has a dangling comment "An illustrative device ... exploring the view without hardware" with no demo code. The UI does not offer a demo/sample either. Either add a sample device or delete the comment.
11. Both panes use different WebUSB paths: the Explorer does not call `device.open()` and relies on the cached descriptors Chrome exposes without opening. That is fine for reading, but string descriptors may be `undefined` on a device that has not been opened. The Explorer should open (read-only) before describing, or say "open to read strings".

---

## 2. usb-rea (USB Protocol RE)

Files: `src/components/tools/UsbReaWorkbench.jsx` (349 lines), `src/utils/usbrea/*` (18 modules, about 7.6k lines, a port of upstream usb-rea, MIT, (c) 2026 Emir Mrkaljevic).

### Does today
Loads a pcap/pcapng (gzip OK, usbmon DLT 189/220, USBPcap 249), parses to transfers (`pcap.js`), then runs the upstream pipeline (`pipeline.js`: stream/background removal, action assignment by markers or by gaps, command/field inference, bitfields, lookup tables, counters, checksums, handshake, state, response analysis, HID descriptor mapping) and renders a Markdown report, Python driver scaffold, Wireshark Lua dissector and protocol JSON. Extras: in-browser "Action marker" (replaces `usb-rea mark`), VID:PID lookup (offline table + optional OpenDeviceDB fetch, sends only VID:PID), capture guide, a synthetic demo capture. Test coverage is good (`tests/usbrea/*` has 10 files).

### Reference tools
Upstream usb-rea CLI (mark / analyze / lookup), Wireshark + USBPcap / usbmon dissectors, `usbhid-dump`, Beagle/Total Phase Data Center (packet browser), usbrip.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Packet / transfer browser (Wireshark-style list: time, dev, ep, dir, type, setup decoded, hex, ASCII), filter by device/endpoint/direction, search hex | Yes (the transfers are already parsed) | M | H |
| Standard-request decode of control transfers (GET_DESCRIPTOR, SET_CONFIGURATION, HID SET_REPORT, CDC) and device/config descriptors recovered from the capture (lsusb -v of a capture) | Yes, reuse `usbDescriptors.js` classifiers on raw bytes (needs the raw-parsing added by USB-3) | M | M |
| Large captures: analysis runs on the main thread, and the whole file is read into memory | Yes: move `analyze()` into a Web Worker, show progress | M | H |
| usb.ids names in lookup (the port dropped local usb.ids reading) | Yes via USB-2 data | S | M |
| Marker clock alignment helper (offset field when the capture machine differs, or pcap timestamps relative) | Yes | S | M |
| Capture inside the browser | No (WebUSB cannot sniff). Keep the guide. | | |
| Replaying inferred commands to a real device through WebUSB | Partly: possible for vendor/bulk interfaces, blocked for HID/MSC. It is a separate, risky feature. | L | M |
| pcapng features: multiple interfaces mixed, comments, `.pcapng.zst`, USBPcap isochronous | Partly | M | L |

### Bugs and quality notes
1. `pipeline.js: analyze()` computes `Math.min(...ts.map(t => t.ts))`. Spreading more than roughly 120k arguments throws `RangeError: Maximum call stack size exceeded` in V8, so any capture with more than about 100k transfers fails with an unhelpful error. Replace with a loop.
2. `_iter_pcap` does not bound-check `incl` against the remaining bytes. A truncated capture yields short frames that can then be mis-parsed instead of being reported as truncated. `_iter_pcapng` Simple Packet Blocks get timestamp `0.0`, which breaks the time-based marker assignment silently.
3. Analyze runs synchronously in a click handler wrapped in `setBusy(true)`; React never gets a frame to paint "Analyzing...", and the UI freezes for large captures.
4. `UsbReaWorkbench` `LookupTab` and `GuideTab` are unmounted when you switch away, but `AnalyzeTab`/`MarkerTab` stay mounted (good). However, the Marker tab keeps marks only in React state: a refresh loses a long marking session. Persist to `sessionStorage`.
5. Markers use `Date.now()` (browser clock). If the capture was made in a VM or on another machine, assignment fails with no hint. See the offset gap.
6. `accept=".pcap,.pcapng,.gz,.cap"` lets a non-capture through and fails only after reading the file. The error string "Could not read capture" does not say which magic was expected.

---

## 3. hid (HID Inspector)

Files: `src/components/tools/HidInspectorWorkbench.jsx`, `src/components/tools/hid/HidReportTools.jsx`, `src/utils/hidInspector.js`. (`src/utils/usbrea/hid.js` already contains a full raw report-descriptor parser, from the usb-rea port.)

### Does today
WebHID chooser, opens the device and decodes the descriptor into collections, reports and fields (usage names from a built-in table). Live input decode into named fields (buttons, axes, key arrays), hex of the last report, report-rate meter, input-report record/playback/export, send output report, send/get feature report, keyboard LED helper (output bits via usage page 08), confirm dialogs before writes.

### Reference tools
hidapitester, `hid-recorder` / `hid-decode` (hid-tools), `usbhid-dump`, USBlyzer / USBTreeView report-descriptor views, eleccelerator HID descriptor parser, Wireshark HID dissector, gamepad-tester sites.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Paste/upload raw HID report descriptor hex and decode (from lsusb -v, Wireshark, `usbhid-dump`, or a vendor PDF). The parser already exists in `usbrea/hid.js`. | Yes | S | H |
| Display the descriptor in raw item form (Usage Page / Usage / Logical Min... lines) and a reconstructed byte stream | Partly. WebHID exposes parsed collections, not raw bytes; reconstruction is lossy (no item ordering guarantees). Show parsed items, not claim raw bytes. | M | M |
| `navigator.hid` connect/disconnect events, multiple devices | Yes | S | M |
| CSV/JSON export of live samples, plot axes over time | Yes | S | M |
| Physical min/max/unit/exponent scaling shown beside values (decode uses logical only) | Yes if the item fields are passed through (WebHID gives `physicalMinimum`, `unitExponent`, `unit`) | S | M |
| Keyboard/mouse top-level collections | No: browser blocks them (shows only the non-protected collections). Say so in the UI. | | |
| FIDO devices | No (see fido2) | | |
| Writing to vendor devices safely (known-safe presets) | Partly, it is up to the user; UI already confirms | | |

### Bugs and quality notes
1. `readBits` does not sign-extend fields with size >= 32 bits (and `1 << size` overflows at 31/32). Rare in practice.
2. `onInputReport` falls back to the report-id-0 layout (`reportMapRef.current[0]`) for any unknown id. With a multi-report device that can mis-decode a report whose id is missing from the map (for example a protected collection that WebHID filtered out) into the wrong fields, with no warning.
3. No handling of devices that disconnect (the `device` stays set; sends then fail with a raw DOMException).
4. When the descriptor has several report IDs, `HidReportTools` defaults the output/feature id to the first report only; the unit tests cover helpers, not these components.

---

## 4. usb-pd (USB Power Delivery)

Files: `src/components/tools/UsbPdWorkbench.jsx`, `src/utils/usbPdDriver.js` (438 lines), shared Bus Pirate link (`SerialLink`).

### Does today
Talks to an STUSB4500 sink controller through a Bus Pirate v3/v4 (binary I2C): reads chip ID, decoded sink PDOs and the current RDO, requests a fixed voltage (RAM) with a confirm dialog, shows the contract with auto-refresh every 1.5 s, and has a **verified** NVM backup/decode/write of the power-up PDOs (write is gated on the NVM matching what the chip loaded at power-up). It correctly states that the STUSB4500 has no VBUS meter, so it does not measure voltage/current.

### Reference tools
ChargerLAB Power-Z KM003C / FNB, Total Phase Beagle USB-C PD analyzer, Twinkie (FUSB302 sniffer), Sigrok PD decoder (used with the Logic Analyzer tool), STSW-STUSB002 GUI, TI PD tools, USB-IF PD spec tables, Microchip/Cypress PD utilities.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| PD message decoder: paste hex of Source_Capabilities / Request / e-marker VDOs / Discover Identity and decode PDOs (fixed/variable/battery/PPS/AVS), RDOs and cable VDOs | Yes (pure function, no hardware) | M | M |
| Source capabilities as seen by the sink (STUSB4500 does not expose them in registers; RDO position only) | No on this chip | | |
| Real-time voltage/current (needs an INA219 / USB-C meter on I2C) | Partly: an INA219/INA226 on the same I2C bus is easy through the Bus Pirate | M | M |
| PPS/AVS requests | No (STUSB4500 is fixed-PDO only; the UI says so) | | |
| Other sink chips (FUSB302, CYPD3177, AP33772) | Partly | L | L |
| Sniffing the CC line | No via browser; use the Logic Analyzer tool + Sigrok-style decode (see below) | | |
| PD decode of a Logic Analyzer capture of CC (BMC) | Yes in principle (BMC + 4b5b decode) | L | M |

### Bugs and quality notes
1. `usbPdDriver.js` still contains dead simulation code that nothing in the UI uses: `SAMPLE_CABLE_EMARKERS` (fabricated "Apple Inc." / "Anker" cables with invented VDOs), `FIXED_PDO_PROFILES`, `PPS_PROFILE` (3.3-21 V "PPS"), `requestFixedPdo`, `requestPpsVoltage`, `resetEnergyCounter`, `accumulatedMah/Mwh`, and `UsbPdClient.cableInfo = SAMPLE_CABLE_EMARKERS[0]`. The tool is hardware-only and honest in the UI, so this is leftover. It is also misleading if anyone ever surfaces it (PPS is explicitly unsupported). Delete it and trim the matching tests.
2. `new UsbPdClient(console.log)` in the component: logs go to the browser console, not the Session Log. Wire to `record('USB-PD', ...)` like ADB does.
3. The description of the tool in the sidebar and the tool's name ("USB-PD Power Delivery") promise more than a single-chip sink board; the first paragraph is accurate, the title is not. Consider "STUSB4500 PD Sink (Bus Pirate)".

---

## 5. intel-modal (Chip Intelligence)

Files: `src/components/HardwareIntelligenceModal.jsx`, `src/utils/usbDatabase.js` (416 lines, 44 VID:PID entries), opened from the sidebar and `?tool=intel-modal` (`src/App.jsx`).

### Does today
Searchable list of 44 curated USB-UART / MCU-bootloader VID:PIDs (CP210x, FTDI, CH340/CH9102, PL2303, ESP32-S2/S3/C3, RP2040, STM32, etc.) with chip, voltage, auto-reset behaviour and notes. Highlights the currently connected serial port's chip. A VID-only fallback ("Silicon Labs Device (VID...)") reuses the first entry of the vendor, including that entry's voltage/notes.

### Reference tools
`usb.ids` (linux-usb.org, used by lsusb, used by `usbutils`), the-sz.com USB ID lookup, devicehunt.com, Linux `lsusb`, Windows Device Manager hardware IDs, OpenDeviceDB (used by usb-rea).

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Full `usb.ids` vendor and product names (about 3.4k vendors, about 20k products, about 700 KB raw / about 150 KB gzipped) as a lazily loaded static asset | Yes (BSD-3 option of the dual license; add attribution) | M | H |
| Lookup of an arbitrary typed VID:PID with no connected hardware (the modal only searches the curated list; a typed unknown ID just shows no results) | Yes | S | H |
| USB class code lookup (`usb.ids` also lists classes) | Yes | S | M |
| Link-outs (devicehunt, the-sz, linux-usb.org) and a "copy as udev rule / Windows hardware ID" | Yes | S | M |
| Online lookup (OpenDeviceDB) | Yes, already done in usb-rea; opt-in | S | L |
| Chip clone detection (fake FT232/CH340) from descriptors | Partly | M | L |

### Bugs and quality notes
1. `activeVidPid` uses `portInfo?.usbVendorId && portInfo?.usbProductId`, which is falsy for PID 0x0000 and so hides the connected chip for those (rare). Use `!= null`.
2. The VID-only fallback returns the **first** database entry's `voltage`, `autoReset` and `notes` for any other PID of that vendor. For example an unknown FTDI PID shows the FT232R note. That is plausible for FTDI but wrong for vendors with unrelated products (Espressif, STMicro). Mark the fallback fields as "vendor default, check the datasheet", or drop them.
3. The modal is a modal (not a registry tool) so it cannot be opened side-by-side with the Descriptor Explorer, which is where an analyst wants it.

---

## 6. mass-storage (Mass Storage Inspector)

Files: `src/components/tools/MassStorageWorkbench.jsx` (415 lines), `src/utils/massStorageDriver.js` (BOT + SCSI: INQUIRY, TEST UNIT READY, READ CAPACITY(10), READ(10), REQUEST SENSE), `src/utils/diskImage.js` (717 lines: MBR/GPT parse, filesystem detect, FAT12/16/32 + exFAT read-only volumes with deleted-entry listing, streaming SHA-256, demo FAT builders).

### Does today
Connects over WebUSB (filters class 08), claims the BOT interface, reads INQUIRY and capacity, parses MBR/GPT, detects NTFS/ext/HFS+/APFS (type label only), browses FAT/exFAT with a "show deleted" toggle, previews/saves/recovers files (contiguous-cluster recovery for deleted files), reads a single sector as hex, and images a whole drive or one partition to a file (File System Access API streaming, or in-memory under 1 GB) with SHA-256. It never issues WRITE. A confirm dialog warns it claims the drive from the OS.

### Reference tools
FTK Imager (E01/raw, MD5+SHA1 verify, bad-sector handling, file tree for NTFS/FAT/ext/HFS), Autopsy / The Sleuth Kit (NTFS/ext/HFS/APFS, timeline, keyword search, carving), testdisk/photorec (partition recovery, carving), `dd`/`ddrescue` (error handling, retry log), `lsblk`/`smartctl`.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Open a disk image file (.img/.dd/.raw/.bin; File picker; slices read lazily) and run the same partition / filesystem / browse / carve pipeline | Yes. `diskImage.js` already takes an async `read(offset, length)`, and `memoryReader` exists. Needs a `File` adapter. | S | H |
| Live-drive access working at all: `claimInterface` on class 08 hits Chrome's protected-class block on every OS (verify; reports from users of WebUSB flash-drive demos are consistent), and on Windows the Microsoft mass-storage driver owns the device. The tool as shipped probably cannot connect to a typical USB stick on stock Chrome. | Not fixable in-browser. Mitigate: detect the SecurityError, explain, and offer the image-file path ("make an image with `dd`/FTK Imager, open it here"). | S | H |
| Imaging robustness: on a read error the whole job aborts. Add: continue on bad sectors (zero-fill + error log, like `ddrescue`), retry with BOT reset recovery, skip-size back-off | Yes | M | M (only if a device ever connects) |
| MD5 + SHA-1 alongside SHA-256 (court/forensic norm; `src/utils/md5.js` exists) | Yes | S | M |
| Image verify pass (re-read and compare hash), hash an opened image file | Yes | S | M |
| NTFS browse (MFT parsing, deleted entries via `$MFT` flags) | Yes | L | H |
| ext2/3/4 browse | Yes | L | M |
| Signature file carving (JPEG/PNG/PDF/ZIP/SQLite/office headers + footers) on unallocated space or the whole image | Yes | M | H |
| Hex viewer for arbitrary offset ranges (not just one 512-byte sector), search | Yes | S | M |
| UASP devices, USB 3 streams | No (WebUSB is not suited, and UASP needs streams) | | |
| Write-blocker semantics (hardware) | n/a (read-only is software only; say so) | | |
| E01/AFF/VHD output | Partly (E01 writer is large) | L | L |

### Bugs and quality notes
1. Capacity uses READ CAPACITY(10) only. Drives over 2 TiB (block count >= 2^32) return `0xFFFFFFFF`; there is no READ CAPACITY(16)/READ(16). `read()` also builds `lba` into four bytes (`>>> 24`), so LBAs above 2^32 silently wrap.
2. `MassStorageDevice._command` ignores STALL handling: on a halt it should `clearHalt` and read the CSW again (BOT section 6.7). On a phase error (status 2) it throws but never does a Reset Recovery, leaving the device wedged for the session.
3. The in-memory path for imaging (`parts.push(data)`) for non-Chromium or no `showSaveFilePicker` only protects above 1 GB; at 1 GB the Blob concatenation may still fail on mobile.
4. `readEntry` refuses files over 512 MB but `Uint8Array` reads of up to 512 MB are held in memory; streaming to a file handle would remove the cap.
5. `detectFilesystem` identifies NTFS/ext/HFS+/APFS but the "Browse" button then says "can't be browsed here"; for the commonest forensic case (NTFS) users get a dead end. Keep the label but surface an "Image the partition and open it in Autopsy" hint.
6. No test for the component or for the SecurityError path.

---

## 7. android (ADB + fastboot)

Files: `src/components/tools/AndroidWorkbench.jsx` (mode tabs), `AdbWorkbench.jsx` (568), `FastbootWorkbench.jsx` (503), `src/utils/adbDriver.js`, `adbTools.js`, `adbCrypto.js`, `fastbootDriver.js`, `fastbootTools.js`.
Registry ids `android`, `adb`, `fastboot` all open the same workbench.

### Does today
- **ADB over WebUSB** (own CNXN/AUTH/OPEN/WRTE implementation, RSA key persisted in `localStorage`): one-shot shell commands, `exec:` for binary output, sync LIST/SEND/RECV file browser with push/pull/delete, package list/install/uninstall/pull APK(s), logcat poller with level filter, screenshot (`screencap` PNG, optional auto-refresh), tap/key/text input, battery/props/summary, `tcpip` and reboot targets. Operations are serialized through a queue.
- **Fastboot over WebUSB**: getvar/all vars, bootloader unlock/lock (with confirms), flash (sparse images split to `max-download-size`, A/B slot handling), erase, boot a one-shot image, factory-image zip flashing following `flash-all.sh` including requirement checks and reconnect, reboot targets.

### Reference tools
`adb` (platform-tools), `fastboot`, scrcpy, ya-webadb / Tango (WebADB, shell_v2, scrcpy in the browser, WebCodecs), Android Flash Tool (flash.android.com), Odin/Heimdall for Samsung, `adb sideload`, Magisk / `payload-dumper` tools.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Interactive shell (`shell,v2:`/pty): streaming output, long-running commands (`top`, `logcat -f`), stdin, Ctrl-C. The connect banner advertises `shell_v2` but `shell()` is the legacy collect-until-close call, so anything that does not exit hangs the queue. | Yes (ya-webadb has done it) | M | H |
| Streaming pull/push to/from disk (File System Access API): `pull()` buffers the entire file in memory; `push()` reads the whole `File` into memory; `list()` uses sync v1 (32-bit size, no stat_v2 so > 4 GiB sizes are wrong) | Yes | M | H |
| Recursive folder pull (zip) and folder push | Yes | M | M |
| `install-multiple` / split APK (.apks, .xapk) install and `pm install-create/write/commit` session streaming | Yes | M | M |
| `adb sideload` in recovery (OTA zip) | Yes (`sideload-host:` protocol) | M | M |
| `adb bugreport` / `dumpsys` snapshots, `pm` helpers, permission viewer | Yes | S | M |
| Screen mirroring with control (scrcpy): push scrcpy-server, `app_process`, `localabstract` tunnel, H.264 via WebCodecs | Yes (proven by ya-webadb), needs the server jar (Apache-2, bundle or fetch) | L | H |
| `adb forward`/`reverse`, wireless pairing, `adb connect ip:port` | No: no listening sockets, no TLS-over-USB pairing in WebUSB. (`adb tcpip` is there but needs a host `adb` to use it.) | | |
| Fastbootd (userspace) logical-partition ops: `create-logical-partition`, `delete-logical-partition`, `resize-logical-partition`, `snapshot-update cancel`, `fetch:` (partition dump), `oem` passthrough | Yes (just commands) | S | M |
| Multiple devices at once / device switcher | Partly (the transport objects allow it, the UI is single-device) | M | L |
| Samsung Odin / Qualcomm EDL / MediaTek | No (separate protocols, out of scope) | | |

### Bugs and quality notes
1. `AdbConnection` identifies as `host::features=shell_v2,cmd,stat_v2` but implements none of the three (it uses `shell:`, `exec:` and sync LIST v1). It works because adbd falls back, but it is misleading, and `cmd` on Android 11+ changes `pm`/`am` behaviour only if used.
2. `defaultKeyStore` writes the ADB private key as JSON to `localStorage` under `adb.hostKey`. Any script on the same origin (including the wiki or an XSS in an imported file) can read it, and the key authorizes the host against every device the user ticked "always allow" for. Prefer a non-extractable CryptoKey in IndexedDB (sign with WebCrypto). ADB's `AUTH_SIGNATURE` uses RSA PKCS#1 v1.5 over a pre-hashed token, which WebCrypto cannot do for SHA-1 prehash directly (verify; ya-webadb works around it with a JS RSA implementation, `adbCrypto.js` seems to do the same), so keep the existing implementation but store the key wrapped (AES-GCM with a non-extractable key held in IndexedDB), and say so in the privacy notes.
3. `AdbWorkbench` `deleteFile` runs `rm -r` on a device path after a confirm that names the path; there is no extra warning when the path is outside `/sdcard`.
4. Pull progress uses `onProgress: () => {}` (no-op) in `pullFile`, so large pulls show no progress.
5. Requires closing any local `adb server` (it holds the USB interface) and needs WinUSB on Windows. Put a one-line preflight hint in the connect error ("claimInterface failed: another program, usually `adb server`, owns this device. Run `adb kill-server`.").

---

## 8. ptp (PTP / MTP camera)

Files: `src/components/tools/PtpWorkbench.jsx` (268), `src/utils/ptpDriver.js` (320).

### Does today
Connects by class 06 / subclass 01 filter, opens a session, reads DeviceInfo (manufacturer, model, version, serial, supported operations/properties), storage info, battery level (property 0x5001), lists all objects with ObjectInfo, thumbnails, single and bulk download (to a picked folder or zip), delete (with confirm), and remote capture with `InitiateCapture` + polling for new handles.

### Reference tools
gphoto2 / libgphoto2 (device properties, config tree, live view, tethering, events), digiCamControl, Image Capture (macOS), Windows Photos import, Android File Transfer (MTP), `mtp-tools`/libmtp, go-mtpfs, ya-webadb (MTP is not covered).

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Device properties: `GetDevicePropDesc` + `SetDevicePropValue` (ISO, aperture, shutter, white balance, image size/quality, focus mode) with names for the standard PTP codes | Yes (ops already listed; needs property tables and enum/range decode) | M | H |
| Event polling on the interrupt endpoint (ObjectAdded, DevicePropChanged, CaptureComplete) instead of polling handle lists | Yes | M | M |
| Large files: `getObject` buffers whole files in memory (RAW/video can be hundreds of MB); use `GetPartialObject` (0x101B, already named in `PTP_OP`) and stream to a file handle | Yes | M | M |
| EXIF/metadata view (from the first 64 KiB of JPEG) and capture-date sorting, file type filter | Yes | S | M |
| Folder tree (Association objects with parent handle) instead of a flat list; the driver supports `parent` already | Yes | S | M |
| MTP (Android phones): `GetObjectPropList`, `SendObjectInfo/SendObject` (upload), MTP-ext operation set. Phones expose class 06 / 01 / 01 for MTP so the existing filter already lists them, but only core PTP is spoken. | Yes (upload is the high-value part) | M | H |
| Upload to camera (SendObjectInfo + SendObject) | Yes | M | L |
| Live view / vendor-specific tether (Canon EOS, Nikon, Sony) | Partly: vendor opcodes, large effort per vendor | L | M |
| macOS/Windows driver contention | No: needs WinUSB/Zadig on Windows, unload `ptpcamerad` on macOS (document it) | | |

### Bugs and quality notes
1. `OBJECT_FORMATS` declares key `0x3000` twice and lists `0x380d` as plain TIFF; check the table against the PTP spec object-format codes. Harmless but sloppy.
2. `transaction()` rejects any non-OK response with a generic string; PTP response codes (0x2002 GeneralError, 0x2005 OperationNotSupported, 0x2019 DeviceBusy, 0x201E SessionAlreadyOpen) deserve names so the user sees "camera busy" not hex.
3. `getObjectInfo` is called per handle in a loop on connect (`loadObjects`): thousands of photos mean thousands of USB round trips before the list renders. Show handles first and load info lazily (or paginate).
4. `capture` only works for cameras that support InitiateCapture (many Canon/Nikon need `InitiateCapture` with the storage and format params, others need vendor commands); it checks `supports()` elsewhere but the error text blames focus/lens cap.

---

## 9. fido2 (FIDO2 / CTAP-HID reader)

Files: `src/components/tools/Fido2Workbench.jsx` (138), `src/utils/fido2Driver.js` (236).

### Does today
Opens a security key over WebHID usage page F1D0, CTAPHID_INIT, `authenticatorGetInfo` (CBOR), CTAPHID_PING echo, shows protocol/device version, AAGUID, max message size, versions, options, transports and PIN/UV protocols. It states honestly that Chrome and Edge hide FIDO devices from WebHID and suggests `--disable-hid-blocklist` for the session. It never creates, lists or deletes credentials, never changes PIN, never resets.

### Reference tools
Yubico Authenticator / ykman fido (info, credentials list/delete, PIN set/change, reset, fingerprints), `fido2-token -L/-I` (libfido2), `fido2-tools`, Chrome `chrome://settings/securityKeys` (PIN, reset, sign-in data), FIDO Alliance Conformance Tools, webauthn.io / webauthn.me debuggers, passkeys.guru.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| AAGUID to authenticator name/icon (Yubico, Google Titan, Feitian, SoloKeys, Windows Hello, iCloud Keychain, 1Password...) from the community AAGUID list (about 150 KB json, MIT) | Yes | S | H |
| Show the fields already parsed but not rendered: `extensions` (hmac-secret, credProtect, largeBlobKey), `algorithms`, `maxCredentialCountInList`, `maxCredentialIdLength`; and parse the missing getInfo keys (0x0B maxSerializedLargeBlobArray, 0x0C forcePINChange, 0x0D minPINLength, 0x0E firmwareVersion, 0x14 remainingDiscoverableCredentials ...) | Yes | S | H |
| **WebAuthn lab via `navigator.credentials`** (works with the key through the browser's own CTAP stack, no `--disable-hid-blocklist` needed): register (non-discoverable by default, extensions credProtect/hmac-secret/prf/largeBlob), authenticate, decode attestation object (fmt, attStmt, x5c cert, AAGUID), authenticatorData flags (UP/UV/BE/BS/AT/ED), signCount, COSE key; `PublicKeyCredential.getClientCapabilities()` and conditional-UI support check | Yes (RP ID = the app origin; credentials created for that RP only) | M | H |
| Credential management, PIN set/change, reset, fingerprint enrol (CTAP2 clientPIN with ECDH PIN protocol v1/v2, `credentialManagement`, `authenticatorReset`) over WebHID | Partly: only when WebHID can see the key (the blocklist flag, or an unblocked non-FIDO-usage device); needs CBOR encoder, ECDH P-256 + AES-CBC/HMAC in WebCrypto (all available). Destructive (reset) paths need strong confirmation. | L | M |
| U2F (CTAP1) version/Wink, `authenticatorSelection`, `selectionRequest` (touch to identify, blink) | Yes (CTAPHID_WINK is a one-byte command) | S | M |
| FIDO MDS metadata (certification level, FIPS, supported algorithms) for the AAGUID | Partly: MDS3 blob is big and signed; ship a trimmed JSON | M | L |
| NFC / BLE FIDO | BLE: Web Bluetooth could read the FIDO service (0xFFFD) partly; NFC no | M | L |

### Bugs and quality notes
1. `Fido2Device._recv()` has no timeout. A key that never answers (or answers on a different channel, because the device chooser was a non-FIDO HID) hangs the connect button forever behind the `busy` flag. CTAPHID spec allows UP/UV flows of 30 s with KEEPALIVE; `_recv` should honour an overall deadline and also drop packets for another channel id (currently it accepts any CID after INIT).
2. `getInfo()` is called unconditionally after INIT; a U2F-only key (CAPABILITY_CBOR bit 0x04 unset; the driver already computes `capCbor`) answers ERR_INVALID_CMD and the user sees "CTAPHID error 0x1" with no explanation. Check `capCbor` first and show "U2F only (CTAP1)".
3. The `--disable-hid-blocklist` advice is accurate but dangerous; the warning is present, which is good. Add "or use the WebAuthn lab below, which needs no flag" once that exists.
4. `crypto.getRandomValues ?` fallback in `init()` makes the nonce predictable (`0..7`) when `crypto` is missing; there is no browser where WebHID exists and `crypto.getRandomValues` does not, so it is dead code, but remove it rather than carry a weak-nonce path.

---

## 10. ducky (BadUSB and Payload Studio) review: correctness and usability only

Files: `src/components/tools/DuckyScriptStudio.jsx` (390 lines). No `src/utils` module, no tests.

### Does today
Editor with four presets, an in-browser "playback simulation" (line-by-line highlighting), three export formats (Flipper `.txt` as-is, Arduino `Keyboard.h` sketch, CircuitPython `adafruit_hid` script), copy/download, and upload to a connected Flipper at `/ext/badusb/skon_script.txt`.

### Gaps (correctness/usability only; no new payload capabilities)
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| A real tokenizer/validator (the sidebar copy advertises "DuckyScript keystroke compiler, syntax validator & live simulator"; there is no validator at all) with line-numbered errors and warnings for unknown commands, bad DELAY values, unbalanced modifier combos | Yes | M | H |
| Converters that cover the commands the presets and Flipper's BadUSB format actually use: `DEFAULT_DELAY`/`DEFAULTDELAY`, `STRINGLN`, `REPEAT n`, modifiers (`CTRL`, `ALT`, `SHIFT`, `GUI`, combos like `CTRL ALT DELETE`, `CTRL-SHIFT`), special keys (`TAB`, `ESC`, `SPACE`, arrows, `F1`-`F12`, `DELETE`, `HOME`, `PAGEUP`, `CAPSLOCK`...), `REM` comments | Yes | M | H |
| Simulator honouring `DEFAULT_DELAY`, `REPEAT`, real delay scale option, and showing typed text in a mock window | Yes | S | M |
| Keyboard layout awareness warning (Flipper `BADUSB_LAYOUT`, `layout.write` is US) | Yes | S | M |
| Persist the script locally (it is lost on refresh) | Yes | S | M |

### Bugs
1. The Arduino converter handles only `DELAY`, `STRING`, `ENTER`, `GUI/WINDOWS <key>`; **every other line is silently dropped** (including `DEFAULT_DELAY`, `CTRL`, `ALT`, `SHIFT`, `TAB`, `ESC`, arrows, `REPEAT`). The presets themselves contain `DEFAULT_DELAY` and are converted without it. The generated sketch types the wrong thing with no warning.
2. Arduino `GUI` with no key (a bare Windows key press) produces `Keyboard.press('')`, a compile error. `Keyboard.press('<key>')` also breaks for key names longer than one character (`GUI SPACE`, `GUI DOWN`) because it wraps the word in single quotes. Python converter emits `Keycode.${key.toUpperCase()}`, which for characters such as `/` or `.` is not a valid attribute name.
3. `STRING` text escaping handles `\` and `"` but not `%`, newlines (Windows CRLF input leaves a trailing `\r` in the C string) or non-ASCII; `trimmed = line.trim()` also strips intentional leading/trailing spaces from `STRING` payloads.
4. `uploadToFlipper` overwrites `/ext/badusb/skon_script.txt` with no confirmation and with a fixed name (a prior user script is lost); no check that `/ext/badusb` exists.
5. The component declares `DuckyScriptStudio()` with no props although `ToolRegistry` passes `onLogMessage` (never used, so uploads are not in the Session Log).
6. `downloadFile` never revokes the object URL (small leak).
7. The preview simulation caps every delay at 1500 ms and treats `DEFAULT_DELAY` as an ordinary line (200 ms), so the visualised timing is wrong for every preset. Sidebar `desc`/`keywords` claim "compiler" and "syntax validator": change after the validator exists (Sidebar.jsx belongs to another group; do not edit from this ticket).

---

## Cross-cutting findings
- **usb.ids is the one shared missing dataset** (inspector Explorer, Chip Intelligence modal, usb-rea lookup, HID/PTP/ADB device headers all show VID:PID only). One lazily loaded module serves all of them.
- **Raw descriptor parsing is the second shared missing piece.** The Explorer needs it for class-specific descriptors; usb-rea needs it to decode descriptors out of a capture; the HID tool could use the HID descriptor length it contains.
- Several tools say "read-only" or "never writes" (descriptor explorer, mass storage, fido2). Those claims hold in the code read, except the Recon deck, which does `transferOut` and control transfers by design (it is labelled raw).
- None of the WebUSB tools handles `navigator.usb` `disconnect` events (stale `device` references after unplug).
- Tools that claim WebUSB interfaces do not release them on unmount (confirmed by grep: the Recon deck, `AdbWorkbench`, `FastbootWorkbench`, `PtpWorkbench` and `MassStorageWorkbench` have no unmount cleanup that releases the interface. Switching the Android ADB/Fastboot tab unmounts one mode without closing its WebUSB claim, contrary to the comment in `AndroidWorkbench.jsx`. Add this to USB-4 for ADB and to the PTP/fastboot follow-ups).

---

## Implementation tickets

Rules for all tickets: branch + PR (never push to main), run `npm run test` and `npm run build`, no deploys. File sets below do not overlap between tickets, except for the stated dependency of USB-3 on the data module from USB-2 (USB-3 must degrade gracefully when the module is absent, so they can proceed in parallel and merge in either order).

### USB-1: Mass Storage: open disk-image files, explain protected-class failure, robust imaging
Priority 1. Value H, effort M.
Files touched:
- `src/components/tools/MassStorageWorkbench.jsx`
- `src/utils/massStorageDriver.js`
- `src/utils/diskImage.js` (add `fileReader(file)` adapter and a carving helper; keep exports backward compatible)
- `tests/massStorage.test.js`, `tests/diskImage.test.js`
- (new) `src/utils/carve.js`, `tests/carve.test.js`

Work:
1. "Open disk image file" mode: `<input type=file>` or `showOpenFilePicker`, a `DiskReader` over `file.slice(...).arrayBuffer()`. Same partition table, filesystem detection, FAT/exFAT browse, deleted-file listing, sector viewer, hashing. Imaging buttons become "Hash image".
2. Map `claimInterface` SecurityError / "protected class" and `NotFoundError` to a plain explanation in the UI with the image-file alternative; keep the live-device mode, labelled "experimental, usually blocked by Chrome for storage class".
3. Driver: READ CAPACITY(16) + READ(16) when capacity is `0xFFFFFFFF`; BOT STALL handling (`clearHalt`, re-read CSW) and Reset Recovery after phase error; fix LBA > 2^32.
4. Imaging: MD5 and SHA-1 next to SHA-256; continue-on-error mode (zero-fill bad ranges, error log shown and downloadable); optional verify pass.
5. Signature carving over the image (JPEG, PNG, PDF, ZIP/OOXML, SQLite, GIF, MP4/MOV headers; footer where defined; size cap), results list with save/preview.
Acceptance criteria:
- Opening a FAT16/FAT32/exFAT/MBR/GPT fixture image (built with `buildMbrDisk`/`buildFatVolume`) as a `File` yields the same partition table, filesystem labels, directory listing and deleted entries as the in-memory path, without loading the whole file into memory (read calls are range-sliced; assert via a mock `File.slice` counter).
- A 3 TiB capacity response (READ CAPACITY(10) = `0xFFFFFFFF`) triggers READ CAPACITY(16); `read(lba >= 2**32)` produces a 16-byte CDB with the correct 64-bit LBA.
- A simulated STALL on the CSW read results in `clearHalt` then a successful retry; phase error triggers reset recovery and the next command works.
- Imaging with an injected read error at LBA N produces an image of full length with zero-filled bad range, a log listing the range, and matching hashes of the expected bytes. Default behaviour (stop on error) unchanged.
- MD5/SHA-1/SHA-256 outputs match known test vectors.
- Carving finds N planted files in a synthetic image with correct offsets/lengths.
- SecurityError path shows the explanatory message (unit test with a mocked `claimInterface` that throws a `DOMException('...protected class', 'SecurityError')`).
Test plan: extend `massStorage.test.js` (CSW/STALL/capacity16 with the injected transport), `diskImage.test.js` (File adapter with a fake `File`), new `carve.test.js`; manual: open a real `.img` of a FAT USB stick and an exFAT SD card; verify hashes with `sha256sum`/`md5sum`.

### USB-2: Chip Intelligence: bundle usb.ids, arbitrary VID:PID lookup, fix fallback bugs
Priority 2. Value H, effort M.
Files touched:
- (new) `src/utils/usbIds.js` (lazy `import('../data/usb-ids.json')`, `lookupVendor(vid)`, `lookupProduct(vid, pid)`, `lookupClass(c, s, p)`, `searchIds(query)`)
- (new) `src/data/usb-ids.json` (generated from linux-usb.org `usb.ids`, trimmed to vendors/products/classes; compact arrays) and (new) `scripts/build-usb-ids.mjs` to regenerate it
- `src/utils/usbDatabase.js` (fix VID-only fallback; add `identifyUsbDevice(vid, pid)` that merges curated and usb.ids data)
- `src/components/HardwareIntelligenceModal.jsx` (typed VID:PID/name lookup over the full list, vendor/product/class results, link-outs, copy as udev rule / hardware ID, fix `activeVidPid` falsy check)
- `docs/ACKNOWLEDGMENTS.md` (usb.ids attribution, BSD-3 option)
- `tests/usbIds.test.js` (new), `tests/usbChipLabel.test.js`
Acceptance criteria:
- Typing `1d6b:0002` shows "Linux Foundation / 2.0 root hub"; `0x10C4`, `10c4:ea60`, `ID 10c4:ea60` and `10C4 EA60` all parse; name search ("ch340", "ftdi") returns usb.ids products as well as curated entries; curated entries keep their voltage/auto-reset/notes.
- An unknown PID of a known vendor shows the vendor name and clearly labels voltage/auto-reset as "unknown for this product" instead of reusing the first curated entry's notes.
- The JSON loads only when the modal is first opened (separate chunk in `npm run build` output; main bundle size unchanged within 1 KB).
- VID known, PID 0x0000 now highlights the connected device.
- `scripts/build-usb-ids.mjs` is deterministic; the data file records the usb.ids version/date in a header field shown in the modal footer.
Test plan: unit tests for parsing, lookup, search ranking, and fallback labelling; snapshot a handful of known IDs; `npm run build` and check for a separate chunk; manual smoke in the modal.
Note: other tools (Explorer in USB-3, usb-rea lookup) should consume `usbIds.js` in follow-ups; USB-3 is written to use it when present.

### USB-3: Descriptor Explorer: raw descriptors, class-specific decode, BOS, hotplug, export
Priority 3. Value H, effort M.
Files touched:
- `src/utils/usbDescriptors.js` (new pure parsers: `parseConfigDescriptor(bytes)`, `parseBos(bytes)`, `parseStringDescriptor`, class-specific decoders; fix `usbVersion` handling shared with Recon)
- `src/components/tools/UsbDescriptorExplorer.jsx` (raw fetch via `controlTransferIn`, new sections, hotplug events, JSON export, `open()` before reading strings, remove the dangling comment, vendor/product names via `usbIds.js` if available)
- `src/components/tools/UsbInspectorWorkbench.jsx` (only if tab wiring for a "Raw" sub-view is needed)
- `tests/usbDescriptors.test.js`
Work: GET_DESCRIPTOR for device (0x01), configuration (0x02, full `wTotalLength`), BOS (0x0F), device qualifier (0x06), all string LANGIDs; parse the config blob into IADs, interfaces, endpoints (SS companion), and class-specific descriptors (CDC header/call-management/ACM/union, DFU functional, HID descriptor with report-descriptor length, UVC/UAC headers, hub); BOS capabilities including WebUSB landing page and MS OS 2.0 descriptor set length; `bMaxPower`/self-powered/remote-wakeup from `bmAttributes`; hex dump pane for each raw blob; `navigator.usb` connect/disconnect listeners refreshing the "previously allowed" list and marking an inspected device as unplugged; JSON export and "copy as lsusb -v style text".
Acceptance criteria:
- Given a hand-built configuration descriptor (composite CDC + MSC + HID with IAD), the parser returns the same interface/endpoint tree as `describeDevice` plus CDC functional descriptors and the HID report-descriptor length.
- `parseBos` decodes a fixture containing USB 2.0 Extension, SuperSpeed and Platform capabilities (WebUSB UUID `3408b638-09a9-47a0-8bfd-a0768815b665` with landing-page index, MS OS 2.0 UUID `d8dd60df-4589-4cc7-9cd2-659d9e648a9f`).
- Truncated/garbled descriptors (bLength 0, bLength overrunning the buffer) never throw; they produce a "malformed at offset N" note.
- The Explorer never sends anything other than standard GET_DESCRIPTOR device-recipient control reads (assert in a mocked-device test that only those `controlTransferIn` setups are issued, and `controlTransferOut`/`transferOut` are never called).
- Unplugging an inspected device updates the status badge to "Disconnected" without a console error.
Test plan: extend `usbDescriptors.test.js` with byte fixtures (an Arduino Leonardo composite config, a Pi Pico CDC+MSC, a WebUSB-enabled device BOS); mocked `USBDevice` for the Explorer logic if factored into a hook; manual with a hub, a keyboard (HID blocked: expect graceful "interface protected" note), an Arduino.

### USB-4: Android ADB: interactive shell, streaming file transfer, split-APK install, preflight hints
Priority 4. Value H, effort M-L.
Files touched:
- `src/utils/adbDriver.js` (shell_v2 framing, streaming pull/push APIs, stat_v2/LIS2, honest feature banner)
- `src/utils/adbTools.js` (install-multiple / session install helpers, bugreport helper)
- `src/components/tools/AdbWorkbench.jsx` (Shell tab becomes interactive; file progress; folder pull; install .apks/.xapk; cleanup on unmount; connect-error hints)
- `tests/adb.test.js`, `tests/adbTools.test.js`
Work:
1. `shell,v2:` stream with stdin/stdout/stderr/exit packets; streaming UI with Ctrl-C (sends the interrupt byte), local line editing; keep the one-shot `shell()` for tools. Either a small ANSI-stripping `<pre>` view or the new dependency `@xterm/xterm` (the repo has no terminal emulator; adding it needs owner approval).
2. `pullTo(remotePath, writable, {onProgress})` and `pushFrom(file, remotePath)` with `File.stream()`/File System Access API; `list` via `LIS2`/`STA2` when the device advertises `stat_v2` (fixes sizes above 4 GiB); real progress callbacks in the UI.
3. Recursive directory pull to a chosen folder or zip (JSZip is already a dependency).
4. `pm install-create` / `install-write` / `install-commit` streaming; accept multiple `.apk` files and `.apks`/`.xapk` archives.
5. Detect `claimInterface` failure and show the "another program (usually `adb server`) owns this device; run `adb kill-server` and, on Windows, install a WinUSB driver" message.
6. Release the interface on unmount; store the host key wrapped (see bug 2 in the android section) or at least document the `localStorage` exposure.
Acceptance criteria:
- With the existing mock transport harness, a `shell,v2:` echo test delivers stdout and stderr separately and the exit code; sending Ctrl-C ends a mock long-running command.
- Pulling a 300 MB mocked file never holds more than a bounded number of chunks in memory (assert via a writable stub that counts chunk sizes).
- A mocked `STA2` response with a size over 2^32 is shown correctly.
- `install-multiple` of two APKs issues create, two writes, commit in the correct sequence and surfaces the device's failure string on error.
- The advertised host feature string only lists features actually implemented.
Test plan: extend `adb.test.js` / `adbTools.test.js` with the mock transport used by existing tests; manual on a real phone: `top`, `logcat`, pull a 1 GB video, install a split APK.
Out of scope for this ticket (separate, L): scrcpy-style screen mirroring (push server jar, `localabstract` tunnel, WebCodecs H.264).

### USB-5: usb-rea: large-capture robustness, packet browser, in-capture descriptor decode
Priority 5. Value M-H, effort M.
Files touched:
- `src/utils/usbrea/pipeline.js` (replace `Math.min(...spread)`; progress callbacks)
- `src/utils/usbrea/pcap.js` (truncation bound checks, report truncated captures, SPB timestamps)
- (new) `src/utils/usbrea/worker.js` (runs `analyze` off the main thread; plain `new Worker(new URL(...), { type: 'module' })` as Vite supports)
- `src/components/tools/UsbReaWorkbench.jsx` (use the worker, progress/cancel, new "Packets" tab, timestamp offset field, persist markers to `sessionStorage`, file-type validation message)
- (new) `src/components/tools/usbrea/PacketBrowser.jsx`
- `tests/usbrea/pcap.test.js`, `tests/usbrea/pipeline_infer.test.js`, (new) `tests/usbrea/bigCapture.test.js`
Work: transfer list with time/bus/device/endpoint/direction/type/length/setup-decoded/ASCII, filters (device, endpoint, direction, type, hex substring), click-to-hexdump, decode of standard setup requests (GET_DESCRIPTOR, SET_CONFIGURATION, SET_INTERFACE, CDC SET_LINE_CODING, HID SET_REPORT/GET_REPORT) and a "descriptors found in capture" panel using the pure parsers (reuse from USB-3 when merged; until then a local minimal decode of device/config descriptors).
Acceptance criteria:
- A synthetic capture with 300k transfers (built by `synth.js`/a test builder) analyzes without `RangeError` and with the UI thread not blocked (worker; progress messages observed).
- A capture truncated mid-packet loads the good part and shows "truncated at frame N".
- The marker offset field shifts assignment by the entered seconds (unit test on `assign`).
- The packet browser filters 100k rows without freezing (virtualised list or capped page size) and shows the VID:PID from `find_ids`.
- Existing usbrea tests still pass.
Test plan: new tests above; manual with a real USBPcap and usbmon capture.

### USB-6: FIDO2: AAGUID names, full getInfo, WebAuthn lab (no blocklist flag needed)
Priority 6. Value M-H, effort M.
Files touched:
- `src/components/tools/Fido2Workbench.jsx` (U2F-only handling, new fields, new "WebAuthn lab" panel)
- `src/utils/fido2Driver.js` (full `parseGetInfo`, receive timeout, CID filtering, CTAPHID_WINK, drop weak-nonce fallback)
- (new) `src/utils/webauthnLab.js` (build options, decode attestation/authenticatorData/COSE, capability checks)
- (new) `src/data/aaguids.json` (community AAGUID list; MIT)
- `tests/fido2.test.js`, (new) `tests/webauthnLab.test.js`
Work: render extensions, algorithms, limits; parse getInfo keys 0x0B-0x16; name/icon from AAGUID; `capCbor` check before `getInfo`; 10 s default / 30 s for interactive timeout; WebAuthn lab: register (non-discoverable by default, a toggle for resident key with a confirm because it consumes a slot), authenticate, decode attestation `fmt`/`attStmt`/`x5c` (subject, issuer, validity), flags, signCount, COSE key; show `getClientCapabilities()` results; link in the existing flag warning to the lab.
Acceptance criteria:
- `parseGetInfo` on a YubiKey 5 fixture (CBOR bytes in the test) returns extensions, algorithms and firmwareVersion and the AAGUID maps to "YubiKey 5 Series".
- Unknown AAGUID shows the UUID only.
- `_recv` rejects with a timeout error after the deadline when the transport never answers; frames for other CIDs are ignored.
- Attestation decoding of a captured `none`, `packed`, and `fido-u2f` fixture yields the expected fields; malformed CBOR gives a message, not an exception.
- Lab never registers a discoverable credential without the explicit toggle and confirm, and the RP ID is always the page's `location.hostname`.
Test plan: fixtures in unit tests; manual with a hardware key and webauthn.io for cross-checking the decode.

### USB-7: Small-fix bundle: Recon deck, HID inspector, USB-PD dead code
Priority 7. Value M, effort S-M.
Files touched:
- `src/components/UsbReconDeck.jsx`
- `src/components/tools/HidInspectorWorkbench.jsx`, `src/components/tools/hid/HidReportTools.jsx`, `src/utils/hidInspector.js`, (new) `src/components/tools/hid/HidDescriptorDecoder.jsx`
- `src/utils/usbPdDriver.js`, `src/components/tools/UsbPdWorkbench.jsx`
- `tests/hidInspector.test.js`, `tests/usbPd.test.js`, (new) `tests/usbRecon.test.jsx`
Work:
- Recon: fix bugs 1-9 in section 1 (DFU interface selection, direction-aware endpoint picker, claim check, cleanup/close on unmount, `packetSize` reads, strict hex validation, BCD version, "known/unknown" badge, replace `alert`, restore `currentBaudRate`).
- HID: "Descriptor decoder" panel taking pasted hex (accept `lsusb -v` dump lines, space/comma/0x forms) using `usbrea/hid.js` `parse`; connect/disconnect events; show physical min/max/unit when WebHID provides them; do not silently fall back to report 0 for unknown ids; note blocked top-level collections; sign-extend >= 32-bit.
- PD: delete `SAMPLE_CABLE_EMARKERS`, `FIXED_PDO_PROFILES`, `PPS_PROFILE`, `requestFixedPdo`, `requestPpsVoltage`, `resetEnergyCounter`, `accumulated*`, `cableInfo`; pass a Session Log logger instead of `console.log`; rename the title to say STUSB4500.
Acceptance criteria:
- Recon: with a mocked `USBDevice` having 0x81 IN and 0x01 OUT bulk endpoints, both are selectable and each action uses the right direction; DFU detach is sent to the DFU interface index and is refused when none exists; unmount stops the listener and releases claimed interfaces; payload "41 5" is rejected with a message.
- HID decoder reproduces `hid.test.js` fixtures (keyboard, mouse, gamepad descriptors) and shows an error with the byte offset for malformed input.
- No references to the removed PD symbols remain (`grep`); `usbPd.test.js` and `stusbNvm.test.js` still pass.
Test plan: unit tests above; manual with an Arduino (Recon), a gamepad (HID), an STUSB4500 board (PD).

### USB-8: DuckyScript Studio: real parser/validator and converters (correctness only)
Priority 8. Value M, effort M.
Files touched:
- `src/components/tools/DuckyScriptStudio.jsx`
- (new) `src/utils/duckyScript.js` (tokenizer, validator, simulator timeline, Arduino and CircuitPython converters)
- (new) `tests/duckyScript.test.js`
Work: one parser feeding validation, simulation and both exporters; support `REM`, `DEFAULT_DELAY`/`DEFAULTDELAY`, `DELAY`, `STRING`, `STRINGLN`, `REPEAT`, modifiers and combinations, standard key names, and F-keys; line-numbered diagnostics in the editor; export refuses (or warns and lists skipped lines) when a command cannot be translated instead of dropping it; `STRING` payload keeps spaces and escapes correctly (`\`, `"`, `%`, CRLF input); simulator honours default delay and `REPEAT`; confirm before overwriting the Flipper file and let the user choose the filename; use `onLogMessage` for upload events; persist script in `localStorage`; revoke download URLs. Do not add new payload capabilities or presets.
Acceptance criteria:
- All four built-in presets convert to Arduino and CircuitPython with every command present (test counts translated vs source commands) and produce syntactically valid output (string checks: balanced quotes/braces, no `Keyboard.press('')`).
- `DEFAULT_DELAY 250` inserts a delay after each subsequent command in both exports and in the simulation timeline.
- Unknown command `FOOBAR` yields a diagnostic with line number; the export button then lists "1 line skipped" rather than silently proceeding.
- A `STRING` line with leading spaces, a quote and a backslash round-trips to the correct C and Python literals.
Test plan: unit tests on the util; manual: compile an exported sketch in the Arduino IDE (Leonardo/Pro Micro) and run an exported script on a CircuitPython board.
Follow-up outside this ticket (Sidebar.jsx belongs to a different group): once the validator exists, the sidebar `desc` ("compiler, syntax validator and live simulator") becomes accurate; until then it overstates.

---

## Items deliberately not ticketed (lower value, not feasible, or L effort)
- **PTP property control, event polling, MTP upload and partial-object streaming** (gap list in section 8): feasible and valuable (H for device properties), but it would be the ninth ticket. Recommended as the next one; files would be `src/components/tools/PtpWorkbench.jsx`, `src/utils/ptpDriver.js`, `tests/ptp.test.js`. It does not overlap with any ticket above.
- **scrcpy-style mirroring** (L), **NTFS/ext browsing** (L), **CTAP2 PIN/credential management over WebHID** (L, depends on the blocklist flag), **PD message decoder / INA219 power meter** (M, M value).
- Not feasible here: sniffing USB traffic, live-drive access to protected classes (MSC/HID/video/audio) via WebUSB, `adb forward/reverse`, wireless ADB pairing, UASP.

## Bug index (quick list)
| Tool | Bug | Severity |
|---|---|---|
| usb-rea | `Math.min(...ts.map())` stack overflow for large captures (`pipeline.js`) | High |
| usb-rea | main-thread blocking analysis; truncated-frame and SPB-timestamp handling in `pcap.js` | Medium |
| usb-inspector (Recon) | DFU_DETACH sent to the selected interface, not the DFU interface | High |
| usb-inspector (Recon) | IN/OUT endpoints with the same number collide; interface claim not enforced | Medium |
| usb-inspector (Recon) | listener not stopped / interfaces never released on unmount | Medium |
| usb-inspector (Recon) | odd-nibble hex silently truncated; 64-byte reads; BCD version formatting; always-"IDENTIFIED" badge | Low |
| mass-storage | connect probably blocked by Chrome's protected-class rule, no explanation, no file-image alternative | High |
| mass-storage | no READ CAPACITY(16)/READ(16) (> 2 TiB wraps), no STALL clear / reset recovery | Medium |
| android | advertises `shell_v2,cmd,stat_v2` it does not implement; shell hangs on long-running commands | Medium |
| android | ADB private key in `localStorage`; whole-file memory buffering for pull/push; no pull progress | Medium |
| fido2 | `_recv` has no timeout and does not filter channel id; U2F-only keys give an opaque error | Medium |
| intel-modal | VID-only fallback reuses another product's notes/voltage; PID 0 hides connected chip | Low-Med |
| usb-pd | dead simulation code with fabricated cable e-marker data; logger is `console.log` | Low |
| ducky | converters silently drop most commands (including `DEFAULT_DELAY` used by the presets); invalid Arduino/Python output for bare/long key names; no validator despite sidebar claim; Flipper upload overwrites a fixed file silently | High (for correctness) |
| ptp | duplicate/incorrect `OBJECT_FORMATS` entries; per-object `GetObjectInfo` storm on connect; generic error text | Low |
| hid | wrong-layout fallback for unknown report ids; no disconnect handling | Low |
