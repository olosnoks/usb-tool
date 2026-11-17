# Audit: "Serial & Console" category

Scope: `terminal`, `hardware`, `bridge`, `automation`, `alerts`, `plotter`, `telemetry`, `modbus-rtu`, `micropython`, `improv`.
Method: read the components and utils (no code run). Effort S/M/L; value H/M/L. "Feasible" is judged against what a browser can do
(Web Serial, Web Bluetooth, File System Access, Notification API, Web Audio, WASM) with no native helper.

## Architecture facts that matter for every tool

- `src/context/SerialContext.jsx` is the single serial layer. Per board it keeps `entries` (capped at 1500, one entry per received **chunk**),
  `hexByteStream` (last 4096 bytes) and `latestRxText` (the **last chunk only**, decoded with a fresh `TextDecoder` per chunk).
  `subscribeRx(fn)` delivers every raw chunk unbatched; `transceive()` does request/response.
- Tools that take the `latestRxText` prop (plotter, telemetry, alerts, hardware spammer) see only what React happened to render last.
  Tools that use `subscribeRx` (script runner, bridge, raw REPL, improv) are correct. This split is the root of the main bugs below.
- Web Serial cannot: open ports without a user gesture/permission prompt, enumerate ports not granted, do RS-485 auto-direction or
  9-bit/mark/space parity, set rates the OS driver rejects, or create virtual/pty ports. Raw TCP/telnet/SSH needs a Worker relay (out of scope).

## Bugs found

| # | Where | Bug | Severity |
|---|-------|-----|----------|
| B1 | `TelemetryDashboard.jsx` (RX effect) | `newText = latestTextStream.slice(lastParsedTextRef.current.length)` assumes `latestRxText` is cumulative; it is the last chunk only. A chunk longer than the previous one loses its first N characters (N = previous chunk length): lines silently truncated or dropped. | High |
| B2 | `SerialPlotter.jsx` (RX effect) | Splits each chunk on newlines with no line buffer: a line split across two chunks (normal at 115200 baud) becomes two bogus partial lines. `latestTextStream === lastProcessedTextRef.current` drops a chunk identical to the previous one, so a constant reading (`"512\n"` repeated) plots as one point. | High |
| B3 | `CrashAlertDeck.jsx` (monitor effect) | Scans `latestRxText` only, same drop-identical-chunk guard; two chunks within one render lose the first. A repeated identical crash banner is never re-alerted; a panic arriving in two quick chunks can be missed. | Medium |
| B4 | `HardwareControlsTab.jsx` (spammer effect) | Auto-halt uses `matchPrompt(latestRxText)`: a prompt split over chunks (`"="`, `"> "`) or lost between renders is not detected, so the spammer keeps injecting keys into a live shell. | Medium |
| B5 | `StreamConsole.jsx` (`entriesWithDeltas`) | Delta view fabricates timing: entries have no `rawTime`, so the `else` branch computes `(idx*7)%23*0.42+0.15` ms. The "+x ms" column and the CSV `Delta_ms` are invented numbers shown as measurements. | High (honesty) |
| B6 | `StreamConsole.jsx` (disk-stream effect) | Disk logging writes only `entries[entries.length-1]` whenever `entries` changes. Entries are batched per render, so bursts lose intermediate chunks, and a re-fire without a new entry writes the last one twice. The log file is not a faithful capture. | High |
| B7 | `SerialContext.jsx` (`ingestIncomingBytes`) | Each chunk is decoded with a fresh `TextDecoder` (no `stream:true`): a UTF-8 character split across chunks becomes U+FFFD in console, export, search and `latestRxText`. | Medium |
| B8 | `ModbusWorkbench.jsx` / `modbusDriver.js` | The register table applies hard-coded solar-inverter scaling and units (V/A/W/Hz/kWh) and labels ("AC Grid Voltage"...) to addresses 0-7 of whatever device is polled. Intro text promises "Coils, Inputs, and Holding Registers" but only FC03/FC06 exist. | Medium (honesty) |
| B9 | `ModbusWorkbench.jsx` (auto-poll) | `setInterval` with an async body: a poll slower than 1 s (800 ms timeout) overlaps the next and interleaves on the single bus. Response slave ID / function code is never checked against the request (only CRC). Exception replies (5 bytes) wait for the full timeout of a `5+2n` expected length. | Medium |
| B10 | `ScriptRunner.jsx` | Send field is raw text: typing `\r\n` sends literal backslash characters (presets only work because they are JS strings with real control chars), so users cannot enter CR/LF/Ctrl bytes. An aborted run leaves the in-flight step shown as "running". | Medium |
| B11 | `MicroPythonFileManager.jsx` / `micropythonFiles.js` | Whole file is base64'd into one Python literal compiled on the device at once: beyond roughly 10-20 KB small boards raise `MemoryError`. Reads `print` the whole base64 in one line, same issue. `executeInRawRepl` swallows errors and returns `''`, so a failure looks like an empty result. | Medium |
| B12 | `TerminalTab.jsx` (Baud Hunter) | Closes/reopens the port per candidate rate with no abort and no restore of the original baud/read loop if the user leaves mid-scan; uses `alert()` for the not-connected case. | Low |

---

## 1. `terminal` (TerminalTab + StreamConsole + FrameInjector + HexViewer)

### Does today
- Line-oriented "ANSI stream console": one row per RX/TX/SYS chunk, SGR colours only (16 colours, bold, dim, underline), timestamps, direction filter, plain-text search with highlight, pause/freeze (shared flag), auto-scroll, command history (Up/Down, 50), line-ending selector incl. `hex` mode, Ctrl/Cmd-K clear.
- Export `.log` and CSV timeline; "log to disk" via File System Access (`showSaveFilePicker`).
- Side panels: hex stream viewer (last 4096 bytes), Baud Hunter (candidate list, printable-ratio/entropy scoring, "Apply"), Protocol Injector (frame builder).
- Serial settings, DTR/RTS, break and multi-board tabs live in header/hardware tab; BLE UART transport supported in the context.

### Reference tools
PuTTY/minicom/picocom (true VT100/xterm emulation, keystroke passthrough, local echo toggle, ZMODEM/XMODEM/YMODEM, CR/LF mapping both ways, capture-to-file), CoolTerm (hex view, capture, macros, send-text-file with delays, connection profiles), Tera Term (macros, XMODEM/YMODEM/Kermit, per-line timestamps), Serial Studio (frames/dashboards; see plotter).

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Real terminal emulation (cursor addressing, clear, line editing, tab completion, vi/htop, Ctrl/arrow keys) with keystroke passthrough instead of a send box | Yes: `@xterm/xterm` (+fit) is pure JS, fed by `subscribeRx`, keys via `sendRawBytes`; not currently a dependency | L | H |
| Chunk-per-row log rather than line-per-row; partial lines pollute search/export | Yes: line assembler in the console | M | H |
| Trustworthy timing (B5), disk log (B6), UTF-8-safe decode (B7) | Yes: timestamp at ingest (`performance.now()`), write to disk from `subscribeRx` bytes | M | H |
| Local echo toggle, separate TX/RX line-ending mapping, ctrl-key buttons | Yes | S | M |
| Send text/binary file with per-char/per-line delay | Yes: File picker + paced `sendRawBytes` | S | M |
| XMODEM/YMODEM (bootloaders, embedded Linux `rx`/`sx`) | Yes in JS (CRC + framing; needs exclusive RX while active). ZMODEM feasible but L | M | M |
| Macro / saved-command buttons with import/export | Yes: localStorage + JSON | S | M |
| Regex search, next/prev, filter-to-matches, highlight rules | Yes | S | M |
| Scrollback beyond 1500 chunks with virtualised rendering | Yes: ring buffer + windowed list (free with xterm) | M | M |
| Persistent per-device profiles (baud, framing, line endings, macros keyed by VID:PID) | Yes: localStorage | S | M |
| 256-colour/truecolor SGR, OSC titles | Yes (free with xterm) | S | L |
| Telnet/SSH/raw-TCP (PuTTY) | No in-browser: no arbitrary TCP sockets; would need a Worker WebSocket relay (abuse/security concerns) | L | L |
| Virtual/pty ports, sharing a port with desktop apps | No: needs OS drivers | - | - |

---

## 2. `hardware` (HardwareControlsTab)

### Does today
- ESP32/ESP8266 strapping via DTR/RTS with adjustable pulse timings: enter ROM bootloader, normal hard reset.
- Manual DTR/RTS toggles, live CTS/DSR/DCD/RI indicators (250 ms polling), UART break with duration.
- U-Boot triage: autoboot interrupt "spammer" (space/enter/Ctrl-C/Esc/custom, burst interval), prompt auto-detect, root bypass (`setenv bootargs ... init=/bin/sh`; `boot`), canned `printenv`/`version`/`md.b`.

### Reference tools
esptool (`--before default_reset/usb_reset`), Arduino IDE auto-reset, minicom/Tera Term modem-line controls, picocom break, `stty`/`setserial`, 1200-baud-touch bootloader entry (Arduino, Pico, Adafruit, Teensy).

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Spammer prompt detection unreliable (B4) | Yes: line-buffered `subscribeRx` matcher | S | M |
| Reset/boot profiles beyond ESP: Arduino (DTR pulse), STM32 (BOOT0/NRST via RTS/DTR, polarity options), RP2040/nRF/Adafruit/Teensy (open at 1200 baud, DTR low, close), ESP32-S/C native USB (usb_reset) | Yes: DTR/RTS timing or 1200-baud touch; native USB re-enumerates so a new `requestPort` grant is needed | M | H |
| User-defined DTR/RTS sequence editor ({dtr,rts,waitMs}) with save/import and inversion for inverting adapters | Yes | M | M |
| Auto-suggest profile from `port.getInfo()` VID:PID | Yes | S | M |
| Pulse accuracy: `setTimeout` jitter (UI already notes it) | Partial: cannot be fixed; can measure and display actual elapsed time | S | L |
| Signal timeline for CTS/DSR/DCD/RI | Partial: 250 ms polling, slow signals only | S | L |
| GPIO/I2C/SPI via a plain UART | No: needs a bridge chip (FT232H/CH341, covered by other tools) | - | - |

Note: root bypass mutates the target's U-Boot env (RAM only); add a confirm and label it a security-assessment action.

---

## 3. `bridge` (SerialBridgeDeck)

### Does today
Relays every chunk received on port A to port B and back (`subscribeRx` + `sendRawToBoard`), logs each chunk with direction, inter-chunk delta, hex and ASCII, search, auto-scroll, JSON export. Inline add-port/connect, guidance text, legacy parent-driven props.

### Reference tools
socat, `tio`, com0com + Portmon, Eltima Serial Port Monitor, pyserial MITM scripts, Bus Pirate UART bridge.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Chunk-level logging only; no idle-gap frame grouping | Yes: group bytes by inter-byte gap | M | M |
| Hex/ASCII toggle, per-direction colour, byte/rate counters, baud-mismatch warning | Yes | S | M |
| Pcap/CSV export with direction (livePcapWriter exists) | Yes | S | M |
| MITM rules: replace/drop/inject per direction (hex/regex), delay | Yes: transform in relay callback | M | M |
| Bridge to BLE UART | Yes (transport exists) | M | L |
| Passive "tap" of a port someone else uses | No: Web Serial ports are exclusive | - | - |

---

## 4. `automation` (ScriptRunner + serialExpect)

### Does today
Linear steps `{send, expect, timeoutMs}` with presets (AT modem, MicroPython handshake, U-Boot interrupt). Sends text with no line ending added, waits for a **substring** in a buffer fed by `subscribeRx` (correct stream decoding), pass/fail/time per step, audio chime, JSON report, abort.

### Reference tools
pyserial + pexpect scripts, `expect`/`chat`, Tera Term TTL macros, minicom runscript, Robot Framework SerialLibrary, `mpremote` scripted exec, pytest-embedded.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Escape sequences in Send (`\r \n \t \xNN`), hex mode, per-step line ending (B10) | Yes | S | H |
| Regex expect with capture groups, any-of, not-expect, case-insensitive | Yes: extend `waitForExpect` | S | H |
| Variables from captures (`${ver}`) used in later steps | Yes | M | M |
| Step types: delay, set DTR/RTS, reset profile, set baud, loop N/until, retry, on-fail policy | Yes | M | H |
| Save/load named suites, reorder/duplicate steps | Yes (localStorage + JSON) | S | M |
| JUnit XML/CSV report with captured output, repeat runs | Yes | M | M |
| Run on connect / schedule | Partial: only while tab open | M | L |
| Headless CI runs | No: browser-only app | - | - |

---

## 5. `alerts` (CrashAlertDeck)

### Does today
Pattern list (default ESP32/Zephyr/Linux/ARM signatures; `/regex/flags` supported, invalid regex falls back to text with a warning), rolling 4 KB tail so split dumps are found, alarm sound, auto-pause of the terminal, history with snippet and copy, log line. `scanChunk`/`compilePattern` are exported pure functions.

### Reference tools
Tera Term triggers, `grep --line-buffered` pipelines, ESP-IDF monitor (backtrace decoding via addr2line), esp-decoder, Zephyr/ARM addr2line, Sentry-style capture.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Missed/duplicate detection (B3): feed from `subscribeRx` | Yes | S | H |
| Notification API / title flash when tab hidden (soak tests) | Yes (one permission prompt) | S | M |
| Backtrace decode with a user-supplied ELF/map (function names from symtab; DWARF lines are L) | Yes | L | H |
| Context-after capture saved to file; per-pattern actions (pause, run script, reset) | Yes | M | M |
| Reboot-loop detection and per-pattern counters | Yes | S | M |
| Persist patterns, per-board patterns | Yes | S | L |
| Webhook (Slack/Discord/ntfy) | Partial: CORS blocks most; needs the Worker as relay | M | L |

---

## 6. `plotter` (SerialPlotter)

### Does today
Parses each line as `key:value`/`key=value` pairs (>=40 % coverage) or numeric rows (space/comma/semicolon/tab); ignores boot-log prefixes. Canvas line chart, coloured channels, window 50-500 samples, pause, auto/manual Y scale, channel visibility, CSV export, clear, sketch generator (Arduino and others).

### Reference tools
Arduino IDE Serial Plotter, Serial Studio (frame parsing, dashboards, FFT, XY, project files), BetterSerialPlotter (per-channel scales, triggers, zoom), SerialPlot (binary formats), Teleplot (`>name:value`, XY).

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Split-line and identical-chunk bugs (B2) | Yes: shared line assembler on `subscribeRx` | S | H |
| Real time axis with labels; per-line timestamps (currently per chunk) | Yes | S | M |
| Scientific notation, hex, custom delimiter, column mapping | Yes | S | M |
| Zoom/pan, cursors with readouts, per-channel min/max/mean/RMS | Yes | M | H |
| Per-channel scale/offset/unit/colour, simple filters | Yes | M | M |
| Trigger (rising/falling) + single-shot | Yes | M | M |
| FFT (repo has `utils/fft.js`) and XY mode | Yes | M | M |
| Binary frame parsing (sync, length, int16/float32, endianness, CRC) | Yes | L | M |
| Save/load plot config, PNG export, CSV re-import | Yes | S | M |
| Very high rates (100 kS/s+) | Partial: min/max decimation reaches a few hundred kS/s; WebGL beyond that | L | L |
| Gauges/maps/MQTT dashboards | Gauges yes (telemetry); MQTT needs a WebSocket broker | L | L |

---

## 7. `telemetry` (TelemetryDashboard)

### Does today
Parses lines as JSON object, `k=v`/`k:v` pairs, or `$TAG,CSV` (CSV columns hard-mapped to pitch, roll, temp, volts, rpm, altitude, then `ch_N`). 20-sample history per channel, min/max, one gauge for a selected channel, sparkline cards, reset stats, board selector. Starts with six pre-filled placeholder channels (pitch 0, temp 24.5, volts 12.1, rpm 2400, altitude 145) before any data arrives, which look like readings. `demoIntervalRef` exists but no live demo path was found in render.

### Reference tools
Serial Studio (gauge/bar/compass/accelerometer/GPS/LED widgets, JSON/CSV frame definitions), Grafana+Telegraf, Teleplot, ThingsBoard/Blynk, Mission Planner HUD.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Chunk truncation (B1), no line buffering | Yes | S | H |
| Placeholder channels with fake values shown before data (dishonest): start empty | Yes | S | H |
| User-defined column names/units/ranges (CSV mapped to flight-telemetry names is wrong for most devices) | Yes | M | H |
| Persistent channel config / dashboard project save-load | Yes | M | M |
| Only 20 history points; no real chart, thresholds/alarms, CSV export | Yes (reuse plotter canvas) | M | M |
| More widgets (bar, LED, attitude indicator, NMEA map via GPS suite) | Yes | M | L |
| MAVLink v1/2 parser | Yes in JS | L | L |
| MQTT/HTTP publish | HTTP via Worker only; MQTT needs WebSocket broker | L | L |

(Telemetry and plotter overlap; long term make telemetry a dashboard mode over the same parser.)

---

## 8. `modbus-rtu` (ModbusWorkbench + modbusDriver)

### Does today
Reopens the connected port at a chosen baud (4800-115200, fixed 8-N-1), CRC-16 build/verify, reads 8 holding registers at address 0 (FC03), manual poll and 1 s auto-poll, single-register write (FC06) with echo verification and exception decoding, frames logged to the terminal, int16/hex columns, hard-coded inverter labels/scalings (B8).

### Reference tools
modpoll/mbpoll (all FCs, data types, `-r/-c`, parity, timeout), QModMaster / Modbus Poll / ModScan (register maps, float/32-bit word orders, logging, scan), pymodbus, ModbusMechanic.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Selectable start address and quantity (<=125); generic labels (B8) | Yes | S | H |
| FC01/02/04/05/15/16/17 and 0x2B/0x0E device ID (also FC08) | Yes: simple frames over `transceive` | M | H |
| Parity none/even/odd, stop bits, more bauds (1200/2400/230400); many meters use 8E1/8N2 | Yes: `reconfigureActivePort` already takes these | S | H |
| Data types u16/i16/u32/i32/f32/f64/ASCII, word/byte order ABCD/CDAB/BADC/DCBA, scale/offset/unit | Yes | M | H |
| Slave-ID scan (1..247) and baud/parity auto-detect | Yes (cancelable; minutes at 9600) | M | M |
| Register-map import/export, example maps for common meters | Yes | M | M |
| Non-overlapping poll loop (B9), interval, error counters, response-time stats, CSV log, value-vs-time plot | Yes | M | M |
| Validate response slave ID/FC; end wait on valid exception frame | Yes | S | M |
| Modbus ASCII; Modbus TCP | ASCII yes; TCP no (no sockets, LAN devices) | M | L |
| RTS-controlled RS-485 direction | Yes for adapters without auto-direction; timing jitter limits high baud | M | L |
| Slave/simulator mode | Partial: turn-around timing limited | L | L |

---

## 9. `micropython` (MicroPythonFileManager + micropythonRawRepl + micropythonFiles)

### Does today
Raw-REPL client following `pyboard.py` (Ctrl-C x2, Ctrl-A, 256-byte chunks, Ctrl-D, stdout/stderr terminators). File browser (`os.ilistdir`), read/download, save from editor, upload, delete, up-directory, platform info, one-line quick exec (output to the shared log), and a "package installer" that writes a bundled catalogue of driver sources to `/lib` (labelled MIP but it is not `mip`). Python literals escaped safely (`pyStr`). MicroPython/CircuitPython.

### Reference tools
Thonny (REPL, editor, run/stop, soft reset, file trees), `mpremote` (`fs cp -r`, `mip install`, `run`, `soft-reset`, `repl`, `mount`), ampy, rshell, MicroPico, Mu, code.circuitpython.org (Web Serial + File System Access to CIRCUITPY).

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Chunked read/write with progress and cancel (B11), real error surfacing | Yes | M | H |
| Run editor buffer / device file, Stop (Ctrl-C), soft/hard reset, free space (`os.statvfs`), `gc.mem_free` | Yes | S | H |
| Interactive REPL on this screen (history, completion) | Yes if xterm lands (SER-3) or mini console | M | H |
| mkdir, rename, recursive delete/download (zip), drag-drop, directory upload | Yes | M | M |
| Real `mip`: fetch package.json + files in the browser (raw.githubusercontent.com has CORS) and write to `/lib`; install from URL; list installed | Yes | M | H |
| Editor highlighting, open/save local, diff vs device copy | Yes (lazy-loaded editor) | M | M |
| Folder sync to device (File System Access dir handle, hash-based) | Yes in Chromium | L | M |
| CircuitPython: write directly to mounted CIRCUITPY via File System Access | Yes in Chromium | M | M |
| WebREPL | Partial: `ws://` blocked as mixed content except localhost | M | L |
| `mpremote mount` | No: needs a continuous bidirectional FS protocol | - | - |

---

## 10. `improv` (ImprovWifiDeck + improvSerial)

### Does today
Improv Wi-Fi Serial implemented to spec (header, checksum, state/error/RPC-result parser that resyncs on false headers; Wi-Fi settings, get state, get info, scan), plus text provisioners for AT firmware (`AT+CWLAP`, `CWJAP`, `CIFSR`) and MicroPython. RSSI-sorted network list, password reveal, device info, result URL/IP. Uses `subscribeRx` and a line buffer: correct.

### Reference tools
esp-web-tools Improv dialog, improv-wifi.com SDK, ESPHome onboarding, Tasmota serial config, `nmcli`/`wpa_cli` over console.

### Gaps
| Gap | Feasible? | Effort | Value |
|---|---|---|---|
| Identify RPC (0x05), authorization-timeout display | Yes | S | L |
| WPA-Enterprise, static IP | No: not in the protocol | - | - |
| More console provisioners (Tasmota, ESPEasy, OpenWrt `uci`, Pi `nmcli`) | Yes | M | M |
| Remember recent SSIDs (never passwords) | Yes | S | L |
| mDNS lookup after success | No from browser | - | - |

---

## Cross-cutting recommendations
1. One shared RX line assembler (stream-decoded, CR/LF/CRLF, partial-line carry, timestamps) used everywhere instead of `latestRxText`; fixes B1-B4 and B7.
2. Use `subscribeRx` for every consumer; keep `latestRxText` for display only.
3. Add a honesty test in the style of `tests/demoHonesty.test.jsx`: no tool renders fake values before data (telemetry placeholders, modbus labels, delta timings).

---

# Implementation tickets

Ordered by value. Tickets are file-disjoint except where a dependency is noted. SER-1 delivers a shared util (`rxLines.js`) imported by SER-4 and SER-8 (they can inline a stub and rebase). SER-3 touches `TerminalTab.jsx` with SER-2: land SER-2 first.

## SER-1: Shared RX line assembler; fix Telemetry and Alerts (B1, B3, telemetry honesty)
Files (new): `src/utils/rxLines.js`, `tests/rxLines.test.js`, `tests/telemetryParse.test.js`, `tests/crashAlertSubscribe.test.jsx`
Files (edit): `src/components/TelemetryDashboard.jsx`, `src/components/CrashAlertDeck.jsx`
Must not touch: `SerialPlotter.jsx`, `HardwareControlsTab.jsx`, `StreamConsole.jsx`, `SerialContext.jsx`.
Scope:
- `rxLines.js`: `createLineAssembler({ maxLine })` with `push(bytes, tMs) -> [{ text, t }]`, one persistent `TextDecoder({stream:true})`, CR/LF/CRLF split across chunks, partial-line carry, line cap, `flush()`. Also `parseTelemetryLine(line)` (JSON, key=value incl. scientific notation, CSV, `$TAG,...`) shared with the plotter.
- Telemetry: subscribe via `useSerial().subscribeRx` + assembler; remove the six pre-filled channels (empty state "waiting for data"); CSV columns `ch_1..` unless named; inline rename/unit/min/max per channel; CSV export; history length selectable (20/100/500).
- Alerts: feed `scanChunk` from `subscribeRx`; drop the identical-chunk guard; Notification API toggle (permission on click), title flash while hidden, per-pattern counters, "N lines after" context capture, persist patterns in `localStorage`.
Acceptance criteria:
- Line split across chunks (`"temp:2"` + `"4.5\n"`) yields one sample 24.5; a chunk longer than its predecessor loses no characters.
- Two identical consecutive chunks each give a Telemetry sample and each re-fire an alert.
- Telemetry shows no channel/value before data; a UTF-8 character split across chunks decodes correctly.
- A panic delivered in 3 chunks within one tick fires exactly once; notification only when permitted and tab hidden.
Test plan: unit tests for the assembler (CR/LF/CRLF boundaries, multibyte split, cap, flush) and `parseTelemetryLine` (JSON, `1e-3`, hex, CSV, `$TAG`); component tests with a fake `subscribeRx` (follow `tests/componentsRender.test.jsx` patterns); existing `scanChunk` tests unchanged.

## SER-2: Terminal console fidelity: honest timing, faithful logging, line view (B5, B6, B7, B12)
Files (edit): `src/components/StreamConsole.jsx`, `src/components/tabs/TerminalTab.jsx`, `src/context/SerialContext.jsx` (only `ingestIncomingBytes` / `addLogToBoard`), `src/utils/baudScanner.js` (abort support)
Files (new): `src/utils/consoleMacros.js`, `tests/streamConsole.test.jsx`, `tests/consoleMacros.test.js`, `tests/baudScannerAbort.test.js`
Scope:
- Store `performance.now()` + wall clock on each entry at ingest; Delta view uses real values; delete the synthetic formula.
- One persistent `TextDecoder` per board with `stream:true`.
- Disk logging driven by `subscribeRx` raw bytes (each byte once, in order, closed on disconnect; optional timestamped-text and hex modes).
- Line view option (chunks assembled into lines, timestamp = first byte), regex search with next/prev, highlight rules.
- Local echo toggle, TX/RX line-ending map, send-file with char/line delay and cancel, macro buttons (localStorage, import/export), Ctrl-key buttons (Ctrl-C/D/Z, ESC).
- Baud Hunter: Stop button, restore original baud and read loop on abort/unmount, inline message instead of `alert`.
Acceptance criteria:
- 200 chunks emitted in one tick all reach the disk log in order; Delta equals real arrival differences (injected clock); no U+FFFD for a split emoji.
- Aborting Baud Hunter restores the baud and the console receives again.
- Macros survive reload; send-file at 10 ms/char is ordered, with progress and cancel.
Test plan: mocked `FileSystemWritableFileStream` and fake clock; component test for delta and line view; baud scanner abort test with a fake port; manual two-adapter loopback noted in the PR.

## SER-3: True terminal emulation mode (xterm.js) with keystroke passthrough
Files (new): `src/components/TerminalEmulator.jsx`, `tests/terminalEmulator.test.jsx`
Files (edit): `package.json` + lockfile (add `@xterm/xterm`, `@xterm/addon-fit`, lazy-loaded), `src/components/tabs/TerminalTab.jsx` (single mode toggle and render branch; conflicts with SER-2, land after it).
Scope: "Interactive" mode beside "Log view": xterm instance fed raw bytes from `subscribeRx` (`write(Uint8Array)`), keystrokes via `onData` -> `sendRawBytes`, fit/resize, local echo option, copy/paste, bracketed paste, scrollback 10 000, app theme, Backspace (DEL vs BS) and Enter (CR/CRLF) mapping settings. It shares the context stream, so the log view keeps working.
Acceptance criteria: arrow-key history, Tab completion and Ctrl-C work on an ESP32 MicroPython REPL and a Linux serial console; `vi`/`top` render; switching modes loses no data; xterm is in a separate lazy chunk (not in the main bundle).
Test plan: vitest with a mocked xterm module asserting write/onData wiring and line-ending mapping; build-output check for a separate chunk; manual hardware test.

## SER-4: Plotter: correct ingestion + Serial-Studio-class analysis (B2)
Files (edit): `src/components/SerialPlotter.jsx`
Files (new): `src/utils/plotterCore.js` (parser config, decimation, stats, trigger), `tests/plotterCore.test.js`, `tests/serialPlotterIngest.test.jsx`
Depends on SER-1 (`rxLines.js`, `parseTelemetryLine`).
Scope: ingest via `subscribeRx` + line assembler (fixes split and identical-chunk bugs; per-line timestamps); real time X axis with labels; scientific/hex numbers, custom delimiter and column mapping; zoom/pan, hover cursors, per-channel min/max/mean/RMS, offset/scale/unit; trigger (edge, level, pre-trigger, single-shot); FFT view using `src/utils/fft.js`; XY mode; 50 k-point buffer with min/max decimation; PNG export; save/load config; CSV with true per-sample timestamps.
Acceptance criteria: 10 000 lines delivered as 7-byte chunks plot exactly 10 000 samples; repeated identical lines each add a sample; trigger captures a pre-roll window around a synthetic edge; FFT of a synthetic 50 Hz sine at 1 kHz lands in the right bin; UI stays smooth with 50 k points (manual check).
Test plan: pure-function tests (parser, decimation, stats, trigger); component test feeding chunked input through a fake `subscribeRx`; CSV column snapshot.

## SER-5: Modbus RTU: full function set, data types, honest generic register view (B8, B9)
Files (edit): `src/components/tools/ModbusWorkbench.jsx`, `src/utils/modbusDriver.js`
Files (new): `src/utils/modbusTypes.js` (word/byte order, int32/float32/float64, scale), `tests/modbusDriver.test.js`, `tests/modbusTypes.test.js`, `tests/modbusWorkbench.test.jsx`
Scope:
- Driver: generic `request(fc, addr, qty|values)` for FC01/02/03/04/05/06/15/16/17 and 0x2B/0x0E; validate response slave ID, function code, length and CRC; exception frames end the wait immediately; serialised request queue; error counters and response-time stats.
- UI: start address and quantity (<=125; 2000 for coils), table selector, parity none/even/odd, stop bits, bauds 1200-230400, timeout/retries, poll interval, per-range data type and word order with scale/offset/unit, multi-write, cancelable slave-ID scan, CSV log, register-map JSON import/export.
- Remove hard-coded inverter labels (keep as an importable "Example: solar inverter" map); correct the intro text.
Acceptance criteria: against a mocked slave every FC round-trips and CRC/exception/slave-ID-mismatch are reported distinctly; float32 CDAB decodes correctly from known vectors; never two requests in flight; 8E1 reaches `reconfigureActivePort`; unmapped devices show generic labels.
Test plan: spec known vectors (e.g. `01 03 00 00 00 0A C5 CD`), mocked `transceive` slave behaviours, component test for table switching and scan cancel; manual USB-RS485 test against `diagslave`/`modpoll`.

## SER-6: Automation: expressive scripts (escapes, regex expect, flow control, reports) (B10)
Files (edit): `src/components/ScriptRunner.jsx`, `src/utils/serialExpect.js`
Files (new): `src/utils/scriptModel.js` (schema, escape parser, variables, JUnit/CSV builders), `tests/scriptModel.test.js`, `tests/scriptRunnerFlow.test.jsx`
Scope: Send supports `\r \n \t \xNN`, `${var}`, per-step line ending; Expect supports plain/regex/any-of/not-expect with capture groups into variables and a case option; new step types delay, set DTR/RTS, set baud, loop N/until, retry, on-fail policy (stop/continue/goto); reorder/duplicate; save/load named suites (localStorage + JSON); per-step captured output; JUnit XML and CSV export; abort marks the running step aborted; presets keep working.
Acceptance criteria: presets unchanged; `AT\r\n` transmits CR LF bytes; `/\+CSQ: (\d+),/` stores `${1}`; a loop of 5 with a failing 3rd iteration honours the policy; JUnit output passes a minimal structure check; abort status is correct.
Test plan: pure tests for escapes, captures, substitution, reports; runner tests with a fake serial and injected clock (`waitForExpect` already accepts `now`/`sleep`).

## SER-7: MicroPython workbench: large-file transfer, run/reset controls, real `mip`, folders (B11)
Files (edit): `src/components/MicroPythonFileManager.jsx`, `src/utils/micropythonFiles.js`, `src/utils/micropythonRawRepl.js`
Files (new): `src/utils/micropythonMip.js` (package resolution, host allow-list, GitHub raw fetch), `tests/micropythonTransfer.test.js`, `tests/micropythonMip.test.js`
Scope:
- Blockwise writes (512-1024 B `a2b_base64` chunks in one raw-REPL session) and reads with per-block length/checksum, progress and cancel; `executeInRawRepl` returns real errors to the UI.
- Run buffer / device file, Stop, soft and hard reset, `os.statvfs` space bar, `gc.mem_free`/`os.uname`.
- mkdir, rename, recursive delete, recursive download as zip, drag-drop and directory upload.
- `mip`: install `github:`/micropython-lib names and `.json`/URL packages by fetching in the browser (https only, allow-listed hosts such as `raw.githubusercontent.com`, `micropython.org`), write to `/lib`; keep the bundled catalogue as "offline drivers"; list/remove installed.
Acceptance criteria: a 200 KB file round-trips byte-identical (hash); cancel leaves a valid raw-REPL state; device exceptions show in the UI; `mip install umqtt.simple` writes the right files; hostile paths stay safe via `pyStr`.
Test plan: fake `RawRepl` device simulations (extend `micropythonRawRepl.test.js` patterns) for blocks, checksum, cancel, exceptions; mip tests with mocked `fetch` and allow-list rejection; manual run on ESP32 and RP2040.

## SER-8: Hardware tab: reliable prompt catching and multi-platform reset/bootloader profiles (B4)
Files (edit): `src/components/tabs/HardwareControlsTab.jsx`
Files (new): `src/utils/resetProfiles.js`, `tests/resetProfiles.test.js`, `tests/hardwareSpammerPrompt.test.jsx`
Depends on SER-1 (`rxLines.js`) or an inline small line buffer.
Scope: spammer uses `subscribeRx` + line assembler and matches prompts on partial lines (so `=>` without newline is caught) and stops within one burst; reset profiles as data (`[{dtr, rts, waitMs}]`): ESP32 classic, ESP32-S/C native USB, Arduino, STM32 (BOOT0/NRST mapping with polarity options), RP2040/nRF/Adafruit/Teensy 1200-baud touch (open at 1200, DTR low, close, prompt for re-enumerated port); auto-suggest via `port.getInfo()`; user-defined sequence editor with save/import/export and inversion toggle; display measured step durations; confirm before the U-Boot root bypass.
Acceptance criteria: with a fake port each profile issues the documented `setSignals`/`open`/`close` sequence within timing tolerance; a prompt split across chunks halts the spammer exactly once; 1200-baud touch re-opens correctly and prompts for the new port when needed.
Test plan: fake `SerialPort` recording calls plus fake clock; spammer component test via fake `subscribeRx`; manual verification on ESP32, Pico (BOOTSEL mass storage) and an STM32 board.

---

### Not ticketed
- Bridge improvements (frame grouping, MITM rules, pcap export, baud-mismatch warning): value M-L, S-M effort each; follow-up in `SerialBridgeDeck.jsx` (+ `livePcapWriter.js` reuse).
- Improv: spec already correct; only minor extras (Identify RPC, more console provisioners).
- XMODEM/YMODEM: feasible (M, value M); natural follow-up after SER-2/SER-3 (`src/utils/xymodem.js` + file-transfer dialog).
- Not feasible in a browser-only architecture: telnet/SSH/TCP transports, ZMODEM (L, low value), `mpremote mount`, passive port tap, virtual ports.
