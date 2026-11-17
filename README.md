# Skon's USB Tool // Hardware Hacker Workbench & Serial Tool

![Cloudflare Workers Deployment](https://img.shields.io/badge/deployment-Cloudflare%20Workers-success?style=for-the-badge&logo=cloudflare)
![Web Serial API](https://img.shields.io/badge/Web%20Serial%20API-Native%20W3C-cyan?style=for-the-badge&logo=w3c)
![License](https://img.shields.io/badge/license-MIT-amber?style=for-the-badge)

**Skon's USB Tool** is a client-side hardware workbench and serial tool built with Vite, React, and Tailwind CSS, designed for static hosting on **Cloudflare Workers** (static assets plus a tiny `/api/*` Shodan relay Worker), live at https://usb-tool.olosnoks.com.

It turns a Chromium browser into a serial bench: Web Serial terminal and logging, in-browser ESP32 / ESP8266 ROM bootloader flashing with MD5 verification, a multi-channel serial plotter, live hex inspection, U-Boot autoboot interruption and `md.b` memory dumps, and long-running disk logging.

Beyond serial it covers 802.11 monitor-mode capture for Alfa / RTL8812AU and Panda PAU09 adapters, protocol tools (CAN / OBD-II, Modbus RTU), companions for the Flipper Zero, Proxmark3, PortaPack / HackRF and WarHog / Piglet wardrivers, a CH341A SPI flash programmer, a DuckyScript studio, an in-browser CyberChef workbench, USB inspectors (descriptors, HID, mass storage, PTP/MTP, FIDO2), and USB Protocol RE (turn a USB capture into a protocol report, driver scaffold and Wireshark dissector), all running client-side; the only server-side code is the small Shodan relay. A few PortaPack/HackRF panels (HAM digital decoders, rtl_433 sensor hub) are interface-only until they work over USB; they carry a demo banner in the app.

---

## 🧰 Complete Tool Suite

Sections match the app's sidebar.

**Core Operations** — Terminal & Console (serial monitor + baud hunter) · Firmware Flasher (ESP32 / ESP8266 ROM bootloader) · Hardware Controls (DTR/RTS strapping, U-Boot interrupter)

**Analysis & Protocol Lab** — Packet & Protocol Lab (802.11 dissector, PCAP, hex stream, packet framer, Kismet Studio) · 24 MHz Logic Analyzer (SUMP / fx2lafw, with I²C, UART, SPI, 1-Wire, CAN, WS2812, IR and SWD decoders) · CAN Bus & OBD-II Scanner (DBC decoding, replay, UDS) · I²C & SPI Bus Explorer (Bus Pirate) · Modbus RTU & RS-485 · Oscilloscope Plotter · MitM Serial Bridge · USBTMC Instrument (SCPI) · CyberChef Workbench (Web Worker pipeline)

**RF, Wireless & Badges** — Wi-Fi Monitor (Alfa RTL8812AU / Panda PAU09 over WebUSB) · Flipper Zero Suite · Proxmark3 / PM5 Suite · PortaPack Mayhem SDR (HackRF receiver plus a Flash & First-Time Setup tab: Mayhem or stock firmware over WebUSB, DFU rescue, SD-card files) · GPS & Wardrive Suite · Warhog CYD & Piglet Suite (SD explorer, wardriver.cfg editor, device control, serial console, live Core monitor dashboard, and a screen mirror with remote touch over the WT protocol) · Demo Wardrive Generator (synthetic map data, on purpose) · Bluetooth LE Explorer (Web Bluetooth GATT client, Nordic DFU) · Hash Cracker (dictionary, rule and mask attacks; MD5/SHA/NTLM/MySQL/salted modes; optional WebGPU for MD5 masks) · WPA PMKID Cracker (offline, Web Crypto) · PCAP Viewer

**Web App Testing** — HTTP Workbench (Repeater, Intruder with four attack types, Comparer diff, Decoder with JWT/hashing, plus an OpenAPI/Swagger API client with auto-generated forms, variables, auth and schema fuzzing) · Web Analyzer (URL links/resources/forms + security headers, OWASP-PTK-style tech fingerprinting, passive header/cookie/CORS/TLS scan, cookie-security analysis, sensitive-path probing from SecLists wordlists, and a bounded same-origin crawler) · HTTP Basic Auth Tester · Port Scanner (browser connect-timing; toggleable profiles + custom ports, nmap-style timing templates, concurrency, export) · DNS Toolkit (DoH records + SPF/DMARC/DKIM/DNSBL email auth + subdomain brute-force) · Certificate Inspector (X.509 from URL via crt.sh, file or PEM; SAN, usages, constraints, key size/curve, OCSP/CRL, fingerprints) · Pwned Passwords (HIBP k-anonymity) · Lite DB Browser (a DB Browser for SQLite-style studio on sql.js: create/open, design tables, browse and edit, pragmas, Execute SQL, import/export, combine databases, write back to the file; plus an HTTP database/REST endpoint query tab: PostgREST, CouchDB, Elasticsearch, Datasette) · Regex Tester · JWT Inspector (decode claims, verify HS/RS/ES/PS signatures via Web Crypto) · crt.sh Subdomain Finder (passive Certificate-Transparency enumeration) · IP / CIDR Calculator (IPv4 & IPv6, offline) · Hash & HMAC Calculator (MD5/SHA + HMAC for text & files, offline) · OSINT API Clients (Shodan query builder with filters, facets, host, DNS & exploits modes; urlscan; HackerTarget; bring your own key). These are client-side; a configurable proxy reaches non-CORS hosts (the optional local Docker services in `backend/` cover raw sockets, nmap and live TLS), Shodan goes through the site's own `/api/shodan` relay, and wordlists load from SecLists via the jsDelivr CDN.

**Hardware & Payloads** — BadUSB & Payload Studio (DuckyScript) · Hardware Programmers (CH341A SPI flash, CMSIS-DAP debugger with RTT/SWO/flash, JTAG / SVF, AVR ISP) · USB-PD Power Delivery (STUSB4500) · WebUSB DFU Flasher (USB DFU 1.1 and ST DfuSe: STM32, nRF and more) · Android (ADB & Fastboot in one tool: shell, files, apps, logcat, screen, wireless ADB; bootloader unlock, sparse flashing, A/B slots, factory zips)

**Device Utilities** — MicroPython Files · Improv Wi-Fi · Telemetry Gauges · Crash & Panic Alerts · Test Runner & Scripts · USB Explorer & Autopsy (mystery-chip recon, baud hunting, `lsusb -v`-style descriptor explorer) · **USB Protocol RE** (in-browser port of [usb-rea](https://github.com/emirmrkaljevic/usb-rea): load a usbmon/USBPcap capture plus action markers and get a protocol report, a Python driver scaffold and a Wireshark Lua dissector, with an offline VID:PID lookup; everything stays local) · HID Inspector (WebHID) · Mass Storage Inspector (read-only partitions, FAT/exFAT, deleted-file recovery, SHA-256 imaging) · PTP / MTP Camera · FIDO2 Security Key (read-only)

**Setup & Reference** — In-app Knowledge Base Wiki · Session Log & Report (everything the hardware tools did this session, exported as Markdown / JSON) · Linux Setup & Drivers (udev, USB-UART drivers) · Silicon Memory Dump · Pinouts Reference · Chip Intelligence (VID/PID database) · app-wide colour themes (Dracula, One Dark Pro, GitHub Dark, Monokai Pro, Night Owl, Tokyo Night, Nord, Solarized, Palenight, Ayu, SynthWave '84, Catppuccin) from the header

**Windowed workspace** — every tool opens in its own draggable, resizable window (minimize, maximize, tile, cascade); drag a window to a desktop edge or corner to snap-tile it (half, quarter, or maximize, with a live preview), or Ctrl+Alt+Arrow the focused window; open several at once to work with multiple devices side by side, including more than one instance of the same tool (the window title bar's duplicate button, or Alt-click a sidebar tool) so two of the same tool can each drive a different device. Each window has its own content zoom (−/+, Ctrl+wheel, or FIT to scale the tool to the window width) that never touches the browser's page zoom, and tools use container-query breakpoints so their layout follows the window, not the screen. The layout is remembered between visits.

### Hardware support status

| Status | Tools |
|---|---|
| Real hardware | Terminal, ESP flasher, Hardware Controls, U-Boot deck, Plotter, Serial Bridge, Modbus RTU, CAN / OBD-II (SLCAN adapters), Wi-Fi Monitor, Flipper Zero, Proxmark3, PortaPack (serial console and HackRF WebUSB), GPS & Wardrive, Warhog & Piglet, CH341A, BLE Explorer, WebUSB DFU, MicroPython, Improv, USB Explorer (descriptors), HID Inspector, USBTMC Instrument, Mass Storage Inspector, PTP/MTP Camera, FIDO2 Security Key |
| No hardware needed | USB Protocol RE (analyzes a capture file you load), CyberChef, Regex / JWT / Hash / IP calculators, PCAP Viewer, Lite DB Browser (SQLite files), WPA PMKID Cracker, Hash Cracker |
| Real hardware, with limits | Silicon Memory Dump: chip ID and MAC on ESP32 / S3 / C3; flash reads only on ESP32 and ESP8266 (newer ROMs need the esptool stub). Kismet Studio: live devices and alerts from a Kismet server's REST API; the server must allow requests from this page (CORS), and from the hosted https page it must be on localhost. PortaPack / HackRF: the receiver (spectrum, audio, sweep, ADS-B, IQ recording) is real; transmit, HAM digital decoders and the rtl_433 sensor hub are hidden until they work over USB. The Mayhem Flash & First-Time Setup tab: SPI flash write + verify and DFU rescue are implemented against the libhackrf / LPC43xx DFU protocols and tested against a simulated board, not yet on hardware. |
| Real hardware, new and not yet tried on devices | AVR ISP (Arduino running the ArduinoISP sketch, STK500v1 at 19200 baud) · I²C / SPI Bus Explorer (Bus Pirate v3/v4 binary mode) · Logic Analyzer (SUMP devices over serial; FX2 boards over WebUSB with user-supplied fx2lafw firmware, WinUSB driver needed on Windows) · CMSIS-DAP debugger (SWD halt/step/reset, registers and memory through a CMSIS-DAP v2 WebUSB or v1 WebHID probe) · JTAG (chain scan, SVF with TDO checking and boundary-scan SAMPLE through a CMSIS-DAP probe with JTAG) · USB-PD (STUSB4500 sink controller over a Bus Pirate: fixed 5-20 V requests and contract readout; no PPS or VBUS metering) · Android (ADB & Fastboot), over WebUSB (Fastboot: read variables, unlock your own bootloader, flash/erase partitions, boot an image, reboot; ADB: shell, file push/pull, wireless ADB and reboot, with the RSA auth handshake). Their protocol logic is implemented to spec and exercised in development, but has not yet been confirmed against physical hardware. |

The app shows only real data: there are no simulated device modes. Hardware tools display data from a connected device (or an empty state until one is connected), and the Web App Testing tools run real requests client-side. The exception kept by design is the clearly-named **Demo Wardrive Generator**, which produces synthetic map data on purpose.

---

## ⚡ Power Features & Tool Suite

### 1. ⚡ ESP32 / ESP8266 ROM Bootloader Flashing
The flasher speaks the SLIP-framed ESP ROM bootloader protocol directly (ROM mode, like `esptool.py --no-stub`) and checks every reply:
- **Reset into the bootloader**: classic DTR/RTS auto-reset, or the USB-Serial/JTAG sequence on native-USB chips (303A:1001).
- **Sync and chip detection**: retries SYNC until the ROM answers (and fails clearly if it never does), then identifies the chip from its magic register.
- **Erase and write**: SPI attach, `FLASH_BEGIN` with an erase timeout scaled to the image, and status-checked 1 KB `FLASH_DATA` blocks with sequence numbers and checksums.
- **Verify**: each image is checked with the ROM's `SPI_FLASH_MD5` (the ESP8266 ROM has no MD5 command, so its writes are reported as unverified).
- **Reboot**: hard-resets the chip into the new firmware.

ROM mode is uncompressed and runs at the console baud rate, so large images take a while. ESP32-C5 boards are best flashed with the WarHog web flasher, which carries the C5-specific fixes.

### 2. 📈 Real-Time Multi-Channel Serial Plotter
- **Auto-Telemetry Parser**: Detects comma, space, colon, or key-value delimited numbers (e.g. `12.4, 45.1, 88.0` or `temp:24.5 volt:3.31 pid:42.0`).
- **Rolling Canvas Waveforms**: `requestAnimationFrame`-driven 2D canvas with a 50 to 500 sample window.
- **Telemetry Statistics**: Displays instantaneous, Min, Max, and Average values per channel.
- **CSV Data Export**: One-click download of plotted session datasets for Excel, Python, or MATLAB.

### 3. 🛡️ U-Boot Console & Memory Dump Deck
- **Autoboot Interrupter**: Sends Spacebar bursts and stops as soon as a shell prompt (`=>`, `U-Boot>`, `# `) appears.
- **Single-user boot helper**: Injects `setenv bootargs "${bootargs} init=/bin/sh"; boot` to boot Linux straight to a shell on devices you own or are authorized to test.
- **Environment Parser**: Executes `printenv` and parses flash offsets, boot scripts, and IP configs into a searchable table.
- **Memory Dumper**: Sends `md.b` in 256-byte chunks, parses the returned bytes by address, and saves a `.bin` only when every byte was received.

### 4. 🔬 USB-UART Chip Identification & Bench Guide
- Automatically queries USB Vendor ID (VID) and Product ID (PID) from `port.getInfo()`.
- Fingerprints the physical USB bridge chip:
  - `10C4:EA60` $\rightarrow$ Silicon Labs CP2102 / CP2104
  - `0403:6001` $\rightarrow$ FTDI FT232R
  - `1A86:7523` $\rightarrow$ WCH CH340G / CH340C
  - `2E8A:000A` $\rightarrow$ Raspberry Pi Pico (RP2040)
  - `303A:1001` $\rightarrow$ Espressif ESP32-S3 Native USB Serial/JTAG
- Displays operating logic voltage levels (3.3V vs 5V warning), auto-reset strapping capability, and engineer notes.

### 5. 💾 Overnight Zero-Drop Disk Logging (File System Access API)
- Connects directly to the native browser File System Access API (`window.showSaveFilePicker`).
- Streams high-frequency serial streams directly to a local `.log` or `.txt` file on your hard drive with zero memory accumulation—preventing browser crashes during 24-hour hardware burn-in tests.

### 6. 🔍 Synchronized Dual-View Hex Inspection Grid
- Standard hardware hex memory layout: `Offset (8 hex digits) | Hex bytes (8-byte / 16-byte grid) | ASCII decode`.
- Directional color-coding: RX bytes in Cyan/Emerald, TX bytes in Amber/Gold.
- Byte-by-byte telemetry tooltips (Decimal, Hex, Binary, ASCII, Offset, Direction).
- Copy as Raw Hex, C Array (`const uint8_t[]`), or ASCII text.

### 7. 🎯 Reverse-Engineering Diagnostics
- **Automated Baud Rate Hunter**: Scans standard baud rates (9600 to 921600 bps), computes Shannon Entropy ($H(X)$) and printable ASCII ratios, and rates candidate confidence.
- **250ms Sustained UART Break**: Drives TX line to space level (0V) for breaking into boot roms and Magic SysRq triggers.
- **ESP32 Strapping State Machine**: Step-by-step visual sequencer with polarity inversion toggle.

### 8. 📦 In-Line Hex Frame Injector with Checksum Engine
- Craft custom frames with automatic live checksum calculation:
  - Modbus CRC-16 (Little Endian & Big Endian)
  - Sum8 (Additive modulo 256) & Two's Complement Sum8
  - Bitwise XOR Checksum (LRC)
  - CRC-16 CCITT (XMODEM)
- Preset library for Modbus RTU, ESP sync, and saved user commands.

### 9. 🕹️ MicroPython REPL & AT Command Decks
- Quick control buttons for `Ctrl+A`, `Ctrl+B`, `Ctrl+C`, `Ctrl+D`, `Ctrl+E`.
- One-click Hayes AT command triggers (`AT`, `AT+GMR`, `AT+CSQ`, `AT+CWLAP`, `AT+CIFSR`, `AT+RESTORE`).
- 8 customizable programmable macro buttons.

---

## 🏗️ Architecture & How It Works

Skon's USB Tool is a **client-side single-page app** — no telemetry and no build
step on the user's side. Everything (serial I/O, firmware flashing, 802.11 parsing,
crypto) runs in the browser tab. The only server-side code is `worker/index.js`, a
small Cloudflare Worker that relays the Shodan API (see *Build & Deploy*); the
optional Docker services in `backend/` run on your own machine. That choice drives
the whole design: it installs nothing, leaks nothing to a backend, and deploys as
static files to Cloudflare Workers (static assets).

### Stack & Entry Points
- **Vite + React + Tailwind CSS.** Vite bundles two HTML entry points —
  `index.html` (the app) and `wiki/index.html` (the standalone docs) — with
  `base: './'` so the whole thing works from any static subpath.
- `src/main.jsx` mounts `src/App.jsx`, which renders the shell: a persistent
  `Header`, a collapsible `Sidebar`, the `Desktop` that hosts the tool windows, a
  dockable `TerminalDrawer`, and global modals (command palette, pinouts, chip intel).

### Tool Routing & Memory Discipline
- Every tool is a window on the `Desktop`; a tool can also be opened from a `?tool=`
  or `#tool=` URL param. `renderTool()` in `src/components/ToolRegistry.jsx` maps a
  tool id to its workbench, and each workbench is a **`React.lazy(() => import(...))`**.
  The sidebar list is `SIDEBAR_SECTIONS` in `src/components/layout/Sidebar.jsx`.
- The practical effect: a tool's code isn't even downloaded until you open it,
  and closing its window **unmounts** it — tearing down its effects, timers, and
  (for hardware tools) releasing the device. Nothing sits idle eating memory at
  launch. Capture-heavy tools additionally cap their in-memory state and age out
  stale entries.

### The Shared Transport Layer (`SerialContext`)
`src/context/SerialContext.jsx` is the heart of the app — one provider that owns
every serial connection so all tools behave consistently:
- Opens ports via the **Web Serial API**, with a **WebUSB OTG fallback** for
  Android/Chrome where Web Serial is unavailable.
- Also opens **Bluetooth LE serial devices** (Nordic UART, HM-10/JDY, Microchip
  Transparent UART, Flipper Zero) through `src/utils/bleSerial.js`, from the
  header's BLE button or the BLE Explorer's "Use as serial port". Writes go out
  in 20-byte packets; baud rate and signal lines don't apply over BLE.
- Runs a continuous RX read loop, tracks byte/packet stats, and exposes
  `sendString` / `sendRawBytes`, DTR/RTS signal control, UART BREAK, and an
  automated baud-scan.
- Provides a **`transceive(bytes, {expectedLength, timeoutMs})`** request/response
  primitive and `reconfigureActivePort()` so protocol decks (e.g. Modbus RTU) can
  do synchronous polling over the same connection the Terminal uses.

### The Driver + Workbench Pattern
Every tool is two pieces:
1. A **pure driver/parser module** in `src/utils/` (e.g. `modbusDriver.js`,
   `wifiParser.js`, `canBusDriver.js`) — framing, CRCs, decoders, no UI. These
   are unit-tested in isolation with Vitest.
2. A **React workbench** in `src/components/` that wires the driver to the shared
   transport and renders the UI.

This separation is what makes the tool list long without the app becoming
unmaintainable, and it's documented end-to-end in
[`docs/FEATURE_TOOL_HANDOFF.md`](docs/FEATURE_TOOL_HANDOFF.md).

### Offloading Heavy Work: Web Workers & WASM
- **Web Workers** (`src/workers/`) keep the UI at 60 FPS under load. The 802.11
  parser worker digests raw frames off the main thread and batches results every
  ~200 ms; the CyberChef worker runs recipe pipelines without stuttering the DOM; the HackRF
  DSP worker does spectrum and demodulation for the PortaPack receiver.
- **WASM** is loaded on demand: `@openipc-rs/web` (a Rust driver) powers raw
  Realtek RTL8812AU monitor-mode capture over WebUSB, and CyberChef operations
  use native/WASM crypto. `sql.js` (SQLite) loads `public/sql/sql-wasm.wasm` for the
  DB Browser. WASM assets are resolved through Vite so they're served with the
  correct MIME type and hashed URLs. Optional engines under `public/wasm/` are
  described in [`docs/WASM_ENGINES.md`](docs/WASM_ENGINES.md).

### Data Flow Example — the Alfa Wi-Fi Capture Pipeline
A good illustration of how the pieces fit:

```
WebUSB  →  @openipc-rs/web WASM  →  readRxTransfer()  →  unpackRealtekUsbTransfer()
(raw RTL8812AU bulk transfer)      (Realtek rx_desc)     (→ Radiotap + 802.11 frames)
   →  fastFilterPacket()  →  parserWorker (wifiParser)  →  ~200ms batched flush
   →  throttled React state (APs/clients, capped + LRU-aged)  →  tables / map / WIDS
```

### Persistence (all local)
- **IndexedDB** stores capture/session snapshots.
- The **File System Access API** streams high-rate serial logs and live PCAP
  straight to disk with zero memory growth (overnight burn-in friendly).
- **localStorage** holds per-viewer UI preferences. None of it leaves the device.

### Build & Deploy
`npm run build` (Vite → `dist/`) is a static bundle of HTML/JS/WASM assets, served by
**Cloudflare Workers** (static assets + a tiny `/api/*` Worker) at https://usb-tool.olosnoks.com.
The Worker (`worker/index.js`, configured in `wrangler.jsonc`) answers only `/api/*`:
`/api/shodan` and `/api/shodan-exploits` relay to Shodan and `/api/health` reports
status; `npm run dev` proxies the same two Shodan paths from Vite. It is built on a developer PC and
pushed with wrangler, not built by GitHub Actions or Cloudflare — see *Releasing from
your PC* below.

### Releasing from your PC (nothing runs on GitHub)
Hosted CI is **opt-in**: `.github/workflows/ci.yml` and `deploy.yml` only run while the
repo variable `CI_BUILDS_ENABLED` is `true`. Until then every push shows as *skipped*
in the Actions tab and bills nothing. The normal path is `scripts/release-local.py`
(Python 3, no dependencies):

```bash
python scripts/release-local.py                     # npm ci (if stale) + test + build -> dist/
python scripts/release-local.py --assemble          # ... and build the site into _site/ to inspect it
python scripts/release-local.py --deploy            # ... and publish it to Cloudflare
python scripts/release-local.py --deploy --skip-build --skip-tests   # republish the existing dist/
python scripts/release-local.py --install           # force npm ci even if node_modules looks current
```

On Windows, run it as `python -X utf8 scripts/release-local.py ...`. Its subprocess
output is otherwise decoded as cp1252, which can fail on non-ASCII output from npm or
wrangler.

1. Runs the Vitest suite and `npm run build`, exactly what CI did. Any failure stops
   before anything is published.
2. `--deploy` assembles `_site/` (`dist/` minus the GitHub-Pages-only `CNAME`, with the
   `__VERSION__` placeholder in both HTML entry points stamped `<branch>+<sha7>`) and
   runs `npx --yes wrangler deploy` with `wrangler.jsonc`: `_site/` becomes the static
   assets of the Worker `usb-tool`, and `worker/index.js` is uploaded with it. That
   Worker runs only for `/api/*` (`run_worker_first`), where it relays the Shodan API
   for the OSINT client so the browser is not blocked by CORS; every other path is
   served straight from the asset store. No build anywhere, and the repo stays private.

Needs Node (npx runs wrangler) and Cloudflare credentials, one of: `npx wrangler login`
once (browser sign-in that wrangler keeps for you, nothing stored in the repo), or
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in a `.env` at the repo root
(git-ignored; copy `.env.example`; a value exported in the shell wins). GitHub secrets
can't be read back, so a token for `.env` means a new one from the Cloudflare dashboard
(My Profile → API Tokens, "Edit Cloudflare Workers" template). Run it from a
clean checkout of `main`; it warns and stamps `+dirty` otherwise. `_site/` is
git-ignored. The deployed stamp is the `<meta name="build-version">` tag in the page
source (`curl -s https://usb-tool.olosnoks.com | grep build-version`).

**First deploy / moving the domain.** After the first `--deploy`, open Cloudflare →
Workers & Pages → `usb-tool` → *Custom domains* and add `usb-tool.olosnoks.com`; the zone's
DNS is already on Cloudflare, so it rewrites the CNAME for you. Then disable GitHub
Pages on the repo (Settings → Pages). `public/CNAME` stays in the repo only so the
gated GitHub Pages workflow still works as a fallback.

To use hosted CI again: `gh variable set CI_BUILDS_ENABLED --body true --repo
olosnoks/usb-tool` (and `gh variable delete CI_BUILDS_ENABLED --repo olosnoks/usb-tool`
to turn it off). `deploy.yml` still targets GitHub Pages; it is the fallback, not the
normal path.

---

## 🚀 Quick Start

### Online Web App
Open directly in any Chromium browser (Chrome, Edge, Opera):  
👉 **[https://usb-tool.olosnoks.com](https://usb-tool.olosnoks.com)**

### Local Development
```bash
git clone https://github.com/olosnoks/usb-tool.git
cd usb-tool
npm install
npm run dev        # Vite dev server on http://localhost:3000
npm run test       # Vitest
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
```

Node 20 is what CI uses. Web Serial, WebUSB, WebHID and Web Bluetooth need a Chromium
browser (Chrome, Edge, Opera).

---

## 🤝 Contributing & Community

- **[CONTRIBUTING.md](docs/CONTRIBUTING.md)** — dev setup, project layout, the driver + workbench pattern for adding tools, and the PR process.
- **[CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md)** — community standards.
- **[SECURITY.md](docs/SECURITY.md)** — responsible-disclosure policy and responsible-use notice.
- **[ACKNOWLEDGMENTS.md](docs/ACKNOWLEDGMENTS.md)** — third-party dependencies, the projects ported or modeled on (usb-rea, Mayhem Mobile, CyberChef, the WarHog web flasher), and the external firmware/hardware it integrates.
- **[docs/FEATURE_TOOL_HANDOFF.md](docs/FEATURE_TOOL_HANDOFF.md)** — exhaustive blueprint for dropping a brand-new workbench into the app.

---

## 📄 License
MIT License. Open-source hardware hacking, firmware flashing, and serial analysis workbench. The Mayhem Mobile code under `src/mayhem-mobile/` and `public/mayhem/` is GPL-3.0 (derived from PortaPack Mayhem); see [ACKNOWLEDGMENTS.md](docs/ACKNOWLEDGMENTS.md).
