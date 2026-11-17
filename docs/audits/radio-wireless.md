# Audit: Radio & Wireless group

Scope: reliability, correctness, usability, data import/export, visualisation, documentation. Receive/inspect only. No attack, cracking, deauth, jamming, transmit, cloning or capture-of-others'-traffic capabilities are proposed. Audit date 2026-11-17, read-only (no code run).

Tools covered: `alfa-wifi` (alias `wifi-scanner`), `wardrive` (+ generator sub-tab), `warhog-piglet` (+ `warhog-sd/config/console/flasher/pinouts`), `wardrive-generator`, `mayhem`, `proxmark` (alias `rfid-nfc`), `flipper`, `ble`, and `aircrack-wifi` (bugs/usability only).

Effort: S under a day, M 1-3 days, L more. Value: H/M/L.

---

## 1. alfa-wifi (monitor-mode survey)

Files: `src/components/workbenches/AlfaWifiWorkbench.jsx` (5.2k lines), `workbenches/alfa/*Tab.jsx` (12 tabs), `src/utils/alfaWifiDriver.js`, `wifiParser.js`, `wardrivingExporter.js`, `pcapExporter`.

### Does today
- WebUSB driver for RTL8812AU/8814AU/RT5572/RT5370 via the `@openipc-rs/web` WASM module. Sets channel and width, RX gain, auto-hop, and parses 802.11 frames from radiotap/USB transfers.
- Passive survey. Tabs for APs, clients, probing, roaming, spectrum, heuristics/anomalies, L3, cleartext metadata, rules and watchlist, with a channel overlap chart and a signal map. Optional browser-geolocation tagging.
- Persistence: UI prefs, watchlist and rules in localStorage; sessions (devices + raw buffers) in IndexedDB; ring buffer of 50 000 raw frames (`PCAP_MAX_CAPACITY`); optional live PCAP stream to a user-chosen file.
- Export: JSON (APs + clients), PCAP (all, or filtered per device), WiGLE CSV, GeoJSON, KML, executive report. Import: `.pcap` offline replay.

### Reference tools
Kismet (device DB, best-signal GPS fix, `.kismet` / wiglecsv / PCAP-NG, channel-hop dwell config), WiGLE WiFi Wardriving (WigleWifi-1.4/1.6 CSV, best-RSSI position per network), inSSIDer / WiFi Analyzer (channel graph, time graph of RSSI, per-band utilisation).

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| AP position is pinned to the first-seen fix (`existing.latitude ?? currentGps.latitude`, ~L1125/1250). Kismet/WiGLE use the strongest-RSSI fix, so exported maps and WiGLE rows are biased | Yes: pure state logic | S | H |
| WiGLE export writes `0.0,0.0` for untagged APs and invents `rssi=-60`, `channel=1`, always CCMP (see section 9) | Yes | S | H |
| JSON export cannot be re-imported (only PCAP replay and IndexedDB sessions exist). No cross-machine hand-off of a survey | Yes | M | M |
| No time-series view of one AP's RSSI (sparkline holds only the last 15 samples) as in inSSIDer's time graph | Yes (in-memory ring, canvas) | M | M |
| No PCAP-NG, no `.kismet` / per-packet GPS | No for `.kismet` (SQLite writer is heavy); PCAP-NG feasible but low value | L | L |
| No in-app doc of which chipsets and OS drivers (WinUSB/Zadig) are required beyond the setup modal | Yes | S | M |
| 5 GHz and 6 GHz only as far as the WASM driver supports; no channel-width/DFS notes | No: limited by the third-party WASM driver | - | - |
| Ring-buffer eviction uses `Array.shift()` on a 50k array per packet (O(n)) | Yes: index-based ring | S | M (CPU on busy channels) |

### Bugs and risks found
- B-ALFA-1: First-seen geotag (above).
- B-ALFA-2: `rawPacketsRef.shift()` per packet when full is O(n) and runs inside the USB batch loop.
- B-ALFA-3: WiGLE rows fall back to `0.0,0.0` (and zero accuracy) so they would be rejected or pollute an upload; nothing warns the user how many rows are untagged.
- B-ALFA-4: `FirstSeen` uses `ap.firstSeen`, a HH:MM:SS string. `formatWigleTimestamp` then prefixes today's date, which is wrong for sessions that cross midnight or were loaded from IndexedDB. Times are local, not UTC.
- Doc: the 5k-line workbench has no top-level architecture comment. It is hard to maintain, but a split is out of scope here.

---

## 2. wardrive (GPS Wardriver and NMEA)

Files: `src/components/tools/GpsNavigationSuite.jsx`, `src/components/GpsWardriverDeck.jsx` (981 lines), `src/utils/nmeaParser.js`.

### Does today
Web Serial NMEA parsing (GGA/RMC and so on). Ingests wardrive lines from Warhog CYD, Piglet or PAU09 sources, plus import of SD `.wigle.csv` logs. Radar canvas with track history. Exports a WiGLE 1.6 CSV.

### Reference tools
WiGLE WiFi Wardriving (upload-ready CSV, per-network best fix, stats), Kismet (GPSD fix quality).

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| WiGLE export is a second, inline, unescaped writer (`handleExportWigleCsv`, L537-562). `FirstSeen` is `new Date().toISOString()` (export time, `T..Z` form), accuracy is hardcoded `4.5`, the SSID is wrapped in `"` without doubling embedded quotes, lat/lon fall back to `0` | Yes | S | H |
| `parseWigleCsvFile` keeps the last row per BSSID rather than the strongest-RSSI row, and its quote handling is weaker than `pigletToolkit.parseWigle` (three divergent WiGLE parsers/writers in the codebase) | Yes | S | M |
| No map tiles for the wardrive track (radar canvas only); Leaflet already ships for the generator | Yes | M | M |
| No GPX/KML track export; no fix-quality filter (HDOP/sat count) before logging a point | Yes | M | M |
| No upload to WiGLE.net | Out of scope for the static app (needs an API token and a server relay) | - | - |

### Bugs
- B-WD-1 Quote-unsafe SSID in CSV (a hostile SSID containing `"` or a comma breaks the row, including via formula-injection characters `=`, `@`, `+`, `-` at the start of a field when opened in Excel).
- B-WD-2 Timestamp and accuracy fabricated at export.

---

## 3. warhog-piglet (ESP32 Warhog / Piglet toolkit)

Files: `workbenches/WarhogPigletWorkbench.jsx`, `workbenches/piglet/*`, `utils/pigletToolkit.js`, `warhogFlash.js`.

### Does today
Five sub-tabs. SD file browser: drag-and-drop upload, folder download into a picked folder, recursive delete, text and WiGLE CSV viewer (summary cards, 2000-row cap, bad-row counting). Config editor with parse/serialize of the device config. Live serial console and monitor. Firmware flasher. Pinout reference and board carousel.

### Reference tools
WiGLE app and web map (log viewer with map), Kismet log viewer, qFlipper-style file manager.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| The CSV viewer shows rows and cards but no map and no export (KML/GeoJSON/GPX) of a log. Users must go to another tool | Yes: Leaflet is bundled | M | H |
| No merge/dedupe of several `/wardriving/*.wigle.csv` into one upload-ready file (WiGLE caps uploads) | Yes | M | M |
| Charts: no per-band/channel/security histogram | Yes | S | M |
| Doc: wiki articles exist; no note on the 9 MiB CSV cap behaviour or how to recover from truncated/corrupt rows beyond the "bad" count | Yes | S | L |

Flash features are out of scope for this audit beyond noting that they are fail-closed in code review terms (not verified here).

---

## 4. wardrive-generator (demo vector generator)

Files: `tools/WardriveGeneratorWorkbench.jsx` (2.7k lines), `utils/wardriveDemoGenerator.js`.

### Does today
Generates synthetic AP points along routes or traced vector art, shows them on a Leaflet map, and exports WiGLE CSV (with a size splitter and zip), Kepler CSV, and a standalone Python script.

### Reference tools
No direct peer. Kepler.gl for the viewing path.

### Gaps and concerns
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Data-integrity concern: output imitates a real app (`WIGLE_PREHEADER` names `model=Biscuit Pro`, `brand=Biscuit Shop`) and the UI offers a "10 MB limit (WiGLE upload)" split. Synthetic rows are indistinguishable from real survey data. Recommend a visible `SYNTHETIC` marker in the pre-header and a UI warning. This is a labelling fix, not a new capability | Yes | S | H |
| Preview is capped at 1500 markers; no stats or histograms of generated data | Yes | S | L |
| Python export duplicates the generation logic, so the two can drift (no test compares them) | Yes | M | L |

The tool also lives in two places (sub-tab of `wardrive` and its own id). Both render the same component, which is fine.

---

## 5. mayhem (SDR receiver app)

Files: `tools/PortapackWorkbench.jsx`, `public/mayhem/*` (prebuilt SDR PWA in an iframe), `utils/mayhemDriver.js` (1.1k lines), `tools/hackrf/ReceiverDeck.jsx`, `portapack/{FreqmanView,IqRecorder,CliView,TxView}.jsx`.

### Does today
Embedded RocketGod "Mayhem Mobile" PWA (`allow="usb; microphone; geolocation; hid"`) plus a SPI flasher tab. Driver: WebUSB HackRF bring-up/recovery, tune/sample-rate/gain, band sweep with peak detection, IQ recording to `.c8` / Mayhem `.C16`+`.TXT` (default 64 MB, max 512 MB, chunked blobs), FREQMAN export, and a PortaPack serial CLI/screen mirror. The TX view is out of scope and not reviewed.

### Reference tools
SDR++ / gqrx (waterfall, bookmarks import/export, IQ record/playback, scanner), SDRangel (frequency lists).

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| FREQMAN is export-only: no import of `FREQMAN.TXT` (`f=,a=,d=,bw=` lines), and `freqList` lives in memory only, so custom entries are lost on reload | Yes | S | H |
| Sweep peaks are only drawn on screen; no CSV export (freq, dBFS, time) | Yes | S | M |
| No IQ file playback/inspection (load `.c8`/`.C16`, view waterfall) for offline analysis | Yes (read-only view), but the DSP lives in the iframe bundle | L | M |
| The iframe is a prebuilt opaque bundle (`public/mayhem/build/app.js`): no source in repo, so fixes there are not reviewable. Doc should state its provenance and version (`version.json`) | Yes (doc) | S | M |
| Relative `./mayhem/index.html` pop-out depends on the deploy base path | Yes | S | L |

---

## 6. proxmark (read/inspect)

Files: `tools/proxmark/ProxmarkWorkbench.tsx`, `src/devices/proxmark/*`, `ui/components/proxmark/{CommandTreeForm,commandSchema}`, `src/flasher`.

### Does today
Web Serial NG-frame client for Proxmark3 (CDC ACM). Identity/firmware handshake, risk-tiered command schema (`diagnostic` / `read` / `raw`, with an override switch for high-risk frames), TX/RX frame log (last 150 lines), and flash-manifest SHA-256 checking that fails closed (flashing not implemented).

### Reference tools
Proxmark3 client (`hw version`, `hf search`, `lf search`, `data save` and trace views, `hf 14a info`), Iceman client output formatting.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Command results show only `Response Arg0` and length. The payload (e.g. 14a card info, version strings, trace bytes) is not decoded or displayed | Yes for read-only responses with a per-command decoder | M | H |
| Log is not exportable and is capped at 150 lines; no timestamps on download | Yes | S | M |
| Trace/data buffers cannot be saved (`.pm3` / hex) | Yes (read side only) | M | M |
| No reader-side tag DB view of results across commands | Yes | M | L |
| Firmware flashing remains stubbed | No: needs a bootrom protocol implementation; deliberately fail-closed | L | - |

### Bugs and doc
- Debug-hex prints at `0x%x` without padding; arg display shows `0x0` for undefined (indistinguishable from a real zero). Minor.
- The `rfid-nfc` alias maps to the same component; the wiki should say so.

---

## 7. flipper

Files: `tools/flipper/FlipperWorkbench.jsx`, `flipper/views/{Device,Files,Screen,Cli}View.jsx`, `utils/flipperDriver.js` (1.5k lines), `tests/flipper/`.

### Does today
Web Serial + protobuf RPC: device info, storage listing/stat/read/write/delete/mkdir, screen mirror stream and PNG screenshot, input injection, CLI, reboot/DFU, and vibration/LED tests. Text view and export of one file at a time.

### Reference tools
qFlipper (file manager with binary-safe up/download, whole-folder backup, update channels), lab.flipper.net (web, same RPC).

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Binary files are not handled. `readRealFile` returns a hex-dump string for non-text, and `Export` then saves that string as the file; `handleUploadFile` uses `readAsText` and so corrupts any binary upload (`.png`, `.fap`, `.bin`, `.nfc` with high bytes) | Yes | S-M | H |
| No folder backup/restore (zip of `/ext`) as in qFlipper | Yes (JSZip is a dependency) | M | M |
| File viewer lacks a format-aware view for `.sub`/`.nfc`/`.rfid`/`.ir` text files (key/value table) | Yes | M | M |
| `window.prompt` / `alert` / `confirm` used for folder creation and errors; poor UX, blocked in some embeds | Yes | S | L |

### Bugs found
- B-FLIP-1 Export of binary file writes hex-dump text (data corruption).
- B-FLIP-2 Upload reads files as text (UTF-8 decode replaces invalid bytes, silently corrupting binary).
- B-FLIP-3 `isPrintableText` inspects only the first 512 bytes, so a file with late binary content is returned as text and decoded lossy.

---

## 8. ble (Bluetooth LE explorer)

Files: `tools/BleExplorer.jsx` (689 lines), `tools/ble/BleWriteAndDfu.jsx`, `utils/bleDriver.js`, `bleAssigned.js`, `bleSerial.js`; tests `bleDecoding`, `bleDriver`, `bleSerial`.

### Does today
Web Bluetooth `requestDevice(acceptAllDevices)` with SIG and vendor optional services plus user-defined custom UUIDs (persisted). Full GATT tree with names, properties, descriptors; read-all with pairing-needed detection; notify/indicate subscribe with live decoded value; value decoders (battery, HR, appearance, utf8, numeric views); write composer; BLE-UART services handed to the Terminal as a serial port.

### Reference tools
nRF Connect (advertisement scanner with RSSI and raw AD data, GATT export to XML/JSON, notification log, bonding), LightBlue.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| No export of the discovered GATT tree and values (JSON / Markdown) for documentation | Yes | S | H |
| Notifications overwrite the previous value; no timestamped history, no CSV export, no sparkline | Yes | S-M | H |
| No cleanup on unmount: the component has no `useEffect`, so navigating away leaves the GATT connection and notification listeners alive | Yes | S | M |
| Advertisement data (RSSI, manufacturer data, TX power) via `device.watchAdvertisements()` for the already selected device | Partly: experimental flag in Chromium; feature-detect | S | M |
| Passive scan list of all nearby devices | No: browsers expose only the chooser, no passive scan | - | - |

### Bugs
- B-BLE-1 Missing unmount cleanup (connection and listener leak).
- `notifyRefs.current = {}` in `resetState` drops handlers without `removeEventListener`; harmless after disconnect but inconsistent.

---

## 9. aircrack-wifi (review only)

File: `tools/AircrackWifiWorkbench.jsx`. Offline PMKID dictionary verification via Web Crypto. No changes proposed; the tool is outside this audit's feature scope. Bugs and usability only:

- B-AIR-1 Unused variable `rate`; it also reads stale `progress.total` (state not yet updated).
- B-AIR-2 No input validation (MAC format, 32-hex PMKID, passphrase length 8-63) before starting; failures arrive as vague errors.
- B-AIR-3 After cancel, `result` stays `null` but the Crack button text can show a stale progress; no "stopped at N/M" message. Large wordlists are held in a textarea string and split on the main thread (UI freeze for big lists); a Worker would help.
- Usability: no file picker for the wordlist; no explanation that the PMKID must come from the user's own network.

---

## Cross-cutting notes
1. There are four WiGLE CSV writers and three parsers in this group (`wardrivingExporter.js`, `GpsWardriverDeck.jsx`, `wardriveDemoGenerator.js`, `nmeaParser.js`, `pigletToolkit.js`). Only `wardrivingExporter.js` has a test file. Consolidating the real-data writers is the highest leverage fix (RF-2).
2. The three large workbenches (Alfa, Warhog, Wardrive generator) have no unit tests around their reducers; only the utils are tested.
3. Accessibility: many icon-only buttons rely on `title`; no `aria-label` audit done.

---

# Implementation tickets

Tickets are file-disjoint. Each is self-contained.

## RF-1 Flipper: binary-safe file read, export and upload
Files touched: `src/utils/flipperDriver.js`, `src/components/tools/flipper/views/FilesView.jsx`, `src/components/tools/flipper/FlipperWorkbench.jsx`, `tests/flipper/flipperBinaryFiles.test.js` (new).

Work:
- Add `readRealFileBytes(path)` returning a `Uint8Array`; make `readRealFile` call it and keep its text/hex-dump behaviour for display. Detect text by decoding with `TextDecoder('utf-8', {fatal:true})` over the whole buffer rather than a 512-byte sniff.
- The Files view keeps the raw bytes of the selected file and Export saves those bytes (correct MIME by extension), not the displayed string. Show "binary, N bytes" with a hex view for display only.
- `handleUploadFile` uses `file.arrayBuffer()` and passes a `Uint8Array` to `writeRealFile`. Add a size warning above 1 MB.
- Replace `prompt` / `alert` in the touched handlers with the existing in-app confirm/notice pattern if one exists in the component.

Acceptance:
- Round trip: upload a 256-byte file with all byte values 0-255, download it, bytes are identical.
- Exporting a PNG from the Flipper produces a valid PNG.
- Text files still display and export unchanged.
- No change to RPC framing or to `removeRealFile`.

Test plan: Vitest with a mock `sendRpcRequest` / `sendRpcMultipart` in the existing `tests/flipper/` harness. Assert `readRealFileBytes` returns the bytes untouched, `writeRealFile` is called with the same bytes for a binary `File`, and `isPrintableText` regression cases (late NUL at byte 600).

## RF-2 WiGLE CSV writer correctness and parser unification
Files touched: `src/utils/wardrivingExporter.js`, `src/utils/nmeaParser.js`, `src/components/GpsWardriverDeck.jsx`, `tests/wardrivingExporter.test.js`, `tests/nmeaWigle.test.js` (new). Do not touch `AlfaWifiWorkbench.jsx` (callers keep the `downloadWigleCsv(devices, filename)` signature).

Work:
- Export `exportWigleCsv(devices, opts)` with: UTC `YYYY-MM-DD HH:MM:SS` timestamps built from real epoch fields (`firstSeenTimestamp`) with the existing fallbacks, `Frequency` column derived from channel, `Type` WIFI/BLE, WigleWifi-1.6 pre-header, CSV escaping that also neutralises a leading `=`, `+`, `-`, `@` (prefix with `'`), and real accuracy when known.
- Skip rows without a valid fix by default (`opts.includeUnfixed=false`) and return `{csv, written, skippedNoFix}` via a sibling `exportWigleCsvDetailed`; keep `exportWigleCsv` returning a string. Remove invented defaults (`rssi=-60`, `channel=1`) by leaving fields empty.
- Auth mapping: add WPA2-EAP, WPA3-SAE, WPA/WPA2 mixed and OWE where the AP record carries that information; otherwise `[ESS]` only.
- `GpsWardriverDeck.handleExportWigleCsv` calls the shared writer (keeps the BLE `Type`, the device tag and the 1.6 header).
- `parseWigleCsvFile` keeps the strongest-RSSI row per BSSID and handles quoted commas.

Acceptance: exported file for 3 APs (1 untagged) has 2 data rows and the UI reports "1 skipped, no GPS fix"; timestamps are UTC and match the first observation; an SSID `a,"b"` and `=HYP` round-trips through the parser; WiGLE CSV imports of Warhog logs still parse.

Test plan: extend `tests/wardrivingExporter.test.js` (escaping, UTC time, skip behaviour, frequency); new test for `parseWigleCsvFile` (best RSSI, quotes); render smoke test for the Deck export button with mocked `URL.createObjectURL`.

## RF-3 Alfa survey: best-signal geotag and JSON re-import
Files touched: `src/components/workbenches/AlfaWifiWorkbench.jsx`, `src/utils/alfaSurvey.js` (new), `tests/alfaSurvey.test.js` (new). Do not touch the `alfa/*Tab.jsx` files.

Work:
- `alfaSurvey.js` pure helpers: `mergeFix(existing, observation)` (replace position only when the new RSSI is stronger by at least 3 dB and the fix is valid; keep `bestRssi`), `buildSurveyExport(devices, clients, meta)` and `parseSurveyExport(json)` (validates schema version, BSSID format, numeric ranges, caps size).
- In the AP update path (~L1105-1160 and ~L1250-1280) use `mergeFix` so lat/lon/accuracy/altitude track the strongest observation.
- Add an "Import survey JSON" action next to Export JSON (round trip, with a version field added to the export) which merges into the device map. Replace the O(n) `rawPacketsRef.shift()` with an index-based ring (`B-ALFA-2`).
- Surface the count of APs without a fix near the export buttons.

Acceptance: moving away from an AP and back does not leave its pin at the first fix; a JSON export re-imported on a clean session reproduces the AP list; a malformed or oversized file shows an error and changes nothing; the packet loop shows no per-packet `shift` call.

Test plan: unit tests for `mergeFix` (stronger, weaker, invalid fix), export/parse round trip, malformed inputs; existing `alfaWifiDriver` and `wifiParser` tests must pass.

## RF-4 BLE explorer: GATT export, notification history, unmount cleanup
Files touched: `src/components/tools/BleExplorer.jsx`, `src/utils/bleExport.js` (new), `tests/bleExport.test.js` (new). Leave `bleDriver.js` and `BleWriteAndDfu.jsx` alone.

Work:
- `bleExport.js`: `gattToJson(device, tree, values)` and `gattToMarkdown(...)` (services, characteristics with properties, decoded and raw hex values, timestamp, tool version) and `notificationsToCsv(history)`.
- Buttons in the header: "Export JSON" and "Export Markdown" (disabled until a tree exists).
- Keep a bounded (e.g. 2000 entry) per-characteristic notification history with timestamps; show the last N in a collapsible list with a numeric sparkline when the decoded value is numeric; a "Download CSV" action.
- Add a `useEffect` cleanup that stops notifications, removes listeners and disconnects on unmount, and call `removeEventListener` in `resetState`.
- If `device.watchAdvertisements` exists, show RSSI/TX power/manufacturer data for the selected device with a "not supported in this browser" fallback message.

Acceptance: exported JSON contains every service and characteristic shown in the UI; CSV has `time,characteristic,hex,decoded`; navigating to another tool disconnects the device (verified via mocked `gatt.disconnect`); unsupported browsers see the fallback text, no exceptions.

Test plan: pure-function tests for the three exporters with a fixture tree; render test with a mocked `navigator.bluetooth` for unmount cleanup and the history cap; existing `bleDriver/bleDecoding/bleSerial` tests unchanged.

## RF-5 Mayhem: FREQMAN import and persistence, sweep peaks CSV
Files touched: `src/utils/mayhemDriver.js`, `src/components/tools/portapack/FreqmanView.jsx`, `src/components/tools/hackrf/ReceiverDeck.jsx`, `tests/mayhemFreqman.test.js` (new). The caller that wires `handleExportFreqman` into `FreqmanView` stays unchanged: add the new props as optional.

Work:
- Add `parseFreqmanTxt(text)` (lines `f=<Hz>,a=<mod>,d=<label>,bw=<bw>`, `#` comments, range checks 1 MHz to 6 GHz, dedupe by freq+mod, reports rejected line count) and `importFreqmanTxt(text)` on the driver. Persist `freqList` to localStorage (try/catch, versioned key) and reload at construction.
- FreqmanView: "Import FREQMAN.TXT" file input with a result notice, and "Reset to presets".
- ReceiverDeck: "Export peaks CSV" of the current sweep peak list (`start_hz,end_hz,peak_hz,dbfs,timestamp`).
- Add a doc comment on `public/mayhem/version.json` provenance in the PortapackWorkbench header strip is not part of this ticket (that file is untouched).

Acceptance: exporting then importing FREQMAN.TXT yields an identical list; malformed lines are skipped with a count; list survives reload; peaks CSV matches the on-screen table.

Test plan: parser unit tests (valid, comments, out-of-range, duplicates, CRLF); driver round-trip with a stubbed `localStorage`; render test for the Import control.

## RF-6 Warhog log viewer: map plus KML/GeoJSON export and multi-log merge
Files touched: `src/components/workbenches/piglet/PigletFileBrowser.jsx`, `src/utils/pigletGeo.js` (new), `tests/pigletGeo.test.js` (new). `pigletToolkit.js` is read-only for this ticket (import `parseWigle`).

Work:
- `pigletGeo.js`: `rowsToGeoJson(rows)`, `rowsToKml(rows)` (escape XML, one Placemark per BSSID using the strongest-RSSI row, skip rows without a fix), `mergeWigleLogs(parsedLogs)` (dedupe by MAC with best-RSSI position, earliest FirstSeen) and `rowsToWigleCsv(rows)` using the pre-header from the source file (do not invent a device name).
- In the CSV viewer add a Leaflet map of the plotted rows (cluster or cap at 5000 points), buttons "Export KML", "Export GeoJSON", and for a multi-selection "Merge selected logs".
- Add a histogram strip (channel, security, Wi-Fi vs BLE) from the already parsed rows.

Acceptance: a log with 100 rows and 80 fixes plots 80 markers and exports 80 placemarks; XML special characters in SSIDs are escaped; merging two logs with overlapping MACs gives one row per MAC; rows with `0,0` coordinates are treated as no fix.

Test plan: unit tests on `pigletGeo.js` with a fixture log (escaping, dedupe, no-fix handling, KML well-formedness via `DOMParser` in jsdom); render test that the map container and export buttons appear for a parsed CSV (Leaflet mocked as in the existing generator tests).

---

## Not ticketed (feasible gaps, lower priority or overlapping files)
- Proxmark response decoding and log export (M, H value): touches `ProxmarkWorkbench.tsx`, `ProxmarkDevice.ts` and `commandSchema.ts`; candidate RF-7 once a decoder set is agreed with the owner. Needs real hardware to validate.
- Wardrive-generator `SYNTHETIC` marker (S, H): one-line change in `wardriveDemoGenerator.js` plus a UI notice; recommended immediately for data integrity even though it is not a full ticket.
- Alfa RSSI time graph, Flipper folder backup, wardrive map tiles/GPX: M effort, M value.
- aircrack-wifi input validation and `rate` cleanup (S, L): trivial, fold into any future touch of that file.
