# Skon's USB Tool

A browser-based toolkit for working with USB, serial and other hardware devices, plus a set of network, crypto and data utilities. It is a static single-page app: serial I/O, firmware flashing, packet parsing and cryptography run in the browser tab using WebSerial, WebUSB, WebHID, Web Bluetooth, Web Workers and WASM. Nothing needs to be installed.

Live site: https://usb-tool.olosnoks.com

## Contents

- [Using the app](#using-the-app)
- [Tools](#tools)
- [Browser requirements](#browser-requirements)
- [Privacy and network access](#privacy-and-network-access)
- [Optional local backend](#optional-local-backend)
- [Development](#development)
- [Project layout](#project-layout)
- [Releases](#releases)
- [Contributing](#contributing)
- [Acknowledgments](#acknowledgments)
- [License](#license)

## Using the app

The interface is a windowed desktop (`src/components/layout/Desktop.jsx`).

- Tools open in their own windows. Windows can be moved, resized, minimized, maximized, tiled and cascaded. A taskbar at the bottom has a Start button, one button per open window, and tile / cascade / close-all controls.
- The Start menu (`src/components/layout/StartMenu.jsx`) is a cascading category menu. Typing in its search field replaces the cascade with a ranked flat list of matching tools. The category tree is defined in `src/components/layout/toolCategories.js`; tool names and descriptions come from `SIDEBAR_SECTIONS` in `src/components/layout/Sidebar.jsx`.
- A tool can also be opened from a `?tool=` or `#tool=` URL parameter.
- A header holds the global serial connection controls, themes and a dockable terminal drawer. Serial connections are owned by one shared provider (`src/context/SerialContext.jsx`), so the Terminal and other tools use the same port.
- A standalone documentation site is served at `/wiki/` (`wiki/index.html`, `src/wiki/`).

## Tools

Grouped as in the Start menu. Descriptions are taken from the app's tool registry.

### Serial & Console

| Tool | Description |
|---|---|
| Terminal & Console | Real-time serial log and baud rate hunter |
| Hardware Controls | Strapping timers, DTR/RTS, U-Boot |
| MitM Serial Bridge | Dual-port pass-through sniffer |
| Test Runner & Scripts | Automated JS test routines |
| Crash & Panic Alerts | Auto-detect kernel panics |
| Oscilloscope Plotter | Multi-channel live waveforms |
| Telemetry Gauges | Speedometer-style sensor dials |
| Modbus RTU & RS-485 | Industrial holding registers and inverter telemetry |
| MicroPython Files | On-chip filesystem explorer |
| Improv Wi-Fi | Standard serial Wi-Fi provisioner |

### Flash & Program

| Tool | Description |
|---|---|
| Firmware Flasher | Multi-binary partition flashing (ESP32 / ESP8266 ROM bootloader) |
| WebUSB DFU Flasher | USB DFU 1.1 and ST DfuSe firmware download: STM32, nRF and others |
| Hardware Programmers | CH341A SPI flash, CMSIS-DAP debugger (RTT, SWO, flash), JTAG / SVF and AVR ISP |
| Silicon Memory Dump | Direct eFuse and flash reader |

### USB Devices

| Tool | Description |
|---|---|
| USB Explorer & Autopsy | Mystery-chip recon, baud hunting, and an `lsusb -v`-style descriptor explorer |
| USB Protocol RE | Turns a labeled usbmon/USBPcap capture into a protocol report, Python driver scaffold and Wireshark dissector (port of [usb-rea](https://github.com/emirmrkaljevic/usb-rea)) |
| HID Inspector | Decode live reports, report rate, record/playback, output and feature reports (WebHID) |
| USB-PD Trigger (STUSB4500) | STUSB4500 sink: contract readout, voltage requests and verified NVM |
| Chip Intelligence | VID/PID device identification |
| Mass Storage Inspector | Read-only: partitions, FAT/exFAT browsing, deleted-file recovery, imaging with SHA-256 |
| Android (ADB & Fastboot) | ADB (device info, shell, files, apps, logcat, screen, wireless) and Fastboot (unlock, sparse flashing, A/B slots, factory zips, reboot) over WebUSB |
| PTP / MTP Camera | Storage, thumbnails, bulk download, delete and remote capture over WebUSB |
| FIDO2 Security Key | Read a security key: versions, AAGUID, options (WebHID, read-only) |
| BadUSB & Payload Studio | DuckyScript keystroke compiler, syntax validator and live simulator |

### Buses & Instruments

| Tool | Description |
|---|---|
| 24MHz Logic Analyzer | 8-channel capture (SUMP, fx2lafw, VCD/.sr) with I2C, UART, SPI, 1-Wire, CAN, WS2812, IR and SWD decoders |
| I2C & SPI Bus Explorer | I2C scan, registers, live sensor readouts, OLED test and SPI flash dumps via Bus Pirate |
| CAN Bus & OBD-II Scanner | Sniffer with DBC decoding, replay, OBD-II and UDS diagnostics |
| USBTMC Instrument | SCPI console, scope waveforms and screenshots, DMM logging and scripts over WebUSB |

### Radio & Wireless

| Tool | Description |
|---|---|
| Wi-Fi Monitor (Alfa / Panda PAU09) | WebUSB monitor mode and 802.11 frame capture for Alfa RTL8812AU and Panda PAU09 (RT5572) |
| WPA PMKID Cracker | Offline WPA/WPA2 PMKID dictionary attack |
| GPS & Wardrive Suite | Warhog CYD, Piglet, Panda PAU09, NMEA tracker and u-blox UBX |
| Warhog CYD & Piglet Suite | Warhog CYD (ESP32-2432S028R) and Piglet ESP32-C5/S3 wardriver deck |
| Demo Wardrive Generator | Synthetic wardriving vector art for Kepler.gl and WiGLE (generates synthetic data on purpose) |
| PortaPack Mayhem SDR | HackRF receiver: spectrum and waterfall, audio, sweep, ADS-B, IQ recorder, firmware flasher and first-time setup |
| Proxmark3 / PM5 Suite | 13.56 MHz and 125 kHz RFID cloner, raw NG framing, WebFlash |
| Flipper Zero Suite | qFlipper companion: 128x64 LCD, BadUSB, Sub-GHz, NFC and SD |
| Bluetooth LE Explorer | Web Bluetooth GATT client: services, notify, typed writes, Nordic DFU updates |

### Network & Web

| Tool | Description |
|---|---|
| HTTP Workbench | Repeater, Intruder, Comparer and Decoder, plus an OpenAPI/Swagger API client with schema fuzzing |
| Web Analyzer | Analyze a URL: links, resources, forms, security headers, passive header/cookie/CORS/TLS scan, sensitive-path probing |
| HTTP Basic Auth Tester | Try credential lists against HTTP Basic auth |
| Port Scanner | Connect-timing TCP scan with port profiles, custom ports, timing templates, concurrency and export |
| DNS Toolkit | All records plus email auth (SPF/DMARC/DKIM/DNSBL), subdomain brute-force, Markdown export |
| crt.sh Subdomain Finder | Passive subdomain enumeration from Certificate Transparency logs (via proxy) |
| OSINT API Clients | Shodan, urlscan.io and HackerTarget clients; bring your own API key |
| IP / CIDR Calculator | IPv4 and IPv6 subnet math, offline |
| Packet & Protocol Lab | Wi-Fi 802.11, PCAP, hex stream and packet framer |
| PCAP Viewer | Parse and filter `.pcap` captures in the browser |

### Crypto & Data

| Tool | Description |
|---|---|
| Hash & HMAC Calculator | MD5 / SHA-1 / SHA-256/384/512 and HMAC for text and files via Web Crypto, offline |
| Hash Cracker | Dictionary, rule-based and mask attacks; MD5/SHA/NTLM/MySQL/salted modes; multi-hash potfile; optional WebGPU for MD5 masks |
| Pwned Passwords | Check passwords (k-anonymity) and emails for known breaches; search the breach catalog |
| JWT Inspector | Decode JWT header and claims; verify HS/RS/ES/PS signatures with Web Crypto, offline |
| Certificate Inspector | Inspect X.509 certificates from a URL (crt.sh), file or pasted PEM |
| CyberChef Workbench | 200+ crypto, encoding, compression and parsing operations |
| Regex Tester | Live match highlighting, capture groups and replace preview, offline |
| DB Browser (SQLite) | SQLite studio (browse, edit, query, import/export, combine) plus DB/REST endpoints (PostgREST, CouchDB, Elasticsearch, Datasette) |

### Reference & Setup

| Tool | Description |
|---|---|
| Linux Setup & Drivers | udev rules and USB-UART drivers |
| Pinouts Reference | ESP32 and USB wiring diagrams |
| Knowledge Base Wiki | Standalone documentation and firmware manual |
| Session Log & Report | Devices, actions and errors from the current session; export as Markdown or JSON |

## Browser requirements

Use a Chromium-based desktop browser (Chrome, Edge, Opera). Firefox and Safari do not implement WebSerial, WebUSB, WebHID or Web Bluetooth, so the hardware tools will not connect there; the offline utilities (hash, regex, JWT, CyberChef, IP calculator and similar) do not depend on those APIs. The serial connection layer has a WebUSB fallback for Android/Chrome where WebSerial is unavailable. WebUSB, WebHID, WebSerial and Web Bluetooth require a secure context (HTTPS or `localhost`).

API used by tool, as described in the tool registry:

| API | Tools |
|---|---|
| WebSerial | Terminal, Flasher, Hardware Controls, Plotter, Bridge, Modbus RTU, CAN (SLCAN), MicroPython, Improv, Flipper, Proxmark3, PortaPack console, Bus Pirate based tools, SUMP logic analyzers |
| WebUSB | DFU Flasher, Wi-Fi Monitor, Android (ADB/Fastboot), PTP/MTP Camera, USBTMC, HackRF (PortaPack), FX2 logic analyzers, CMSIS-DAP v2, USB Explorer |
| WebHID | HID Inspector, FIDO2 Security Key, CMSIS-DAP v1 |
| Web Bluetooth | Bluetooth LE Explorer, BLE serial in the header |
| File System Access API | Streaming serial logs and PCAP to disk (Chromium only) |
| WebGPU (optional) | Hash Cracker, MD5 masks |

## Privacy and network access

- Device I/O, parsing, flashing, hashing, cracking and decoding run locally in the browser. Capture snapshots go to IndexedDB, UI preferences to localStorage, and logs to files you choose through the File System Access API.
- Tools that query a third party (crt.sh, DoH resolvers, Shodan, HIBP, urlscan.io, HackerTarget, jsDelivr for SecLists wordlists) send requests to those services.
- The only server-side code is the Cloudflare Worker in `worker/index.js`. It runs only for `/api/*`; all other paths are served directly from the static asset store. It is read-only (GET, HEAD, OPTIONS), forwards no cookies, sends `cache-control: no-store`, refuses `sec-fetch-site: cross-site` and `same-site` requests, and has no storage bindings (see `wrangler.jsonc`). Routes:

| Route | Upstream |
|---|---|
| `/api/shodan/*` | `https://api.shodan.io` |
| `/api/shodan-exploits/*` | `https://exploits.shodan.io/api` |
| `/api/hibp/breachedaccount/:email` | `https://haveibeenpwned.com/api/v3/breachedaccount/:email` |
| `/api/hibp/pasteaccount/:email` | `https://haveibeenpwned.com/api/v3/pasteaccount/:email` |
| `/api/health` | Answered by the Worker; lists the relay prefixes |

- Shodan: the caller's own API key is sent in the query string, as the client built it. The Worker holds no keys.
- HIBP: only the two paths above, a fixed query-parameter allowlist and a validated email are accepted; the caller's `hibp-api-key` header is forwarded and nothing else. Passwords are checked with the k-anonymity range API, not through the Worker.
- Other cross-origin tools use a configurable proxy; the local `cors-proxy` service below can serve that role.

## Optional local backend

`backend/` contains Docker services that run on your own machine for things a browser cannot do (raw sockets, `nmap`, live TLS, arbitrary DNS, cross-origin fetch). See `backend/README.md`.

| Service | Port | Purpose |
|---|---|---|
| `cors-proxy` | 47101 | HTTP(S) forwarder with permissive CORS |
| `nmap` | 47102 | Real `nmap` scans |
| `tls-inspector` | 47103 | Live TLS handshake and certificate chain |
| `dns` | 47104 | DNS queries against any nameserver |
| `zap` | 47105 | OWASP ZAP daemon |
| `hydra` | 47106 | THC-Hydra; only under the `offensive` Compose profile and requires `I_HAVE_AUTHORIZATION=yes` |

```bash
cd backend
docker compose up -d                       # default services
docker compose --profile offensive up -d   # also Hydra
```

Use these only against systems you own or are authorized to assess.

## Development

Requirements: Node.js 20 (the version the CI workflows use; `package.json` has no `engines` field and there is no `.nvmrc`).

```bash
npm install
npm run dev        # Vite dev server on http://localhost:3000
```

The dev server proxies `/api/hibp`, `/api/shodan-exploits` and `/api/shodan` to the same upstreams as the Worker (`vite.config.js`).

| Script | Command |
|---|---|
| `npm run dev` | `vite` |
| `npm run build` | `vite build` (output in `dist/`) |
| `npm run preview` | `vite preview` |
| `npm run test` | `vitest run` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build:mayhem` | esbuild bundles of `src/mayhem-mobile/src/main.ts` and `dsp.worker.ts` into `public/mayhem/build/` |

Stack: Vite, React 18, Tailwind CSS 3, Vitest, with `sql.js`, `@openipc-rs/web` (WASM), CodeMirror, Leaflet and others (see `package.json`).

Conventions: run `npm run test` and `npm run build` before opening a PR; do not push to `main` directly.

## Project layout

| Path | Contents |
|---|---|
| `index.html`, `wiki/index.html` | The two Vite entry points (app and standalone wiki) |
| `src/main.jsx`, `src/App.jsx` | App entry and shell (header, desktop, terminal drawer, modals) |
| `src/components/` | Tool workbenches, `ToolRegistry.jsx` (lazy-loaded tool map), and `layout/` (Header, Desktop, StartMenu, Sidebar registry, `toolCategories.js`) |
| `src/context/` | Shared providers, including `SerialContext.jsx` |
| `src/utils/` | Drivers, parsers and helpers (framing, CRCs, decoders) with no UI |
| `src/devices/`, `src/protocols/`, `src/services/`, `src/flasher/` | Device-specific and protocol code |
| `src/workers/` | Web Workers (802.11 parser, CyberChef, HackRF DSP) |
| `src/mayhem-mobile/` | PortaPack Mayhem receiver bundle (GPL-3.0) |
| `src/wiki/` | Wiki app and articles |
| `public/` | Static assets: manifest, icons, service worker, `sql/` and `wasm/` engines, `mayhem/` |
| `worker/index.js` | Cloudflare Worker for `/api/*` |
| `backend/` | Optional local Docker services |
| `tests/` | Vitest suites |
| `scripts/release-local.py` | Local test, build and deploy script |
| `docs/` | Contributing, acknowledgments, security, code of conduct, WASM engine notes, tool handoff blueprint |
| `wrangler.jsonc` | Cloudflare Worker and static assets configuration |
| `.github/workflows/` | `ci.yml` and `deploy.yml` (disabled by default) |

Each tool is a pure driver or parser module in `src/utils/` (unit-tested) plus a React workbench in `src/components/` that wires it to the shared transport. Workbenches are loaded with `React.lazy` and unmounted when their window closes. See `docs/FEATURE_TOOL_HANDOFF.md`.

## Releases

Builds do not run on GitHub by default. `.github/workflows/ci.yml` and `deploy.yml` run only when the repository variable `CI_BUILDS_ENABLED` is `true`; otherwise they show as skipped. To enable them:

```bash
gh variable set CI_BUILDS_ENABLED --body true --repo olosnoks/usb-tool
```

The normal path is `scripts/release-local.py` (Python 3, no dependencies), run from a PC:

```bash
python scripts/release-local.py                     # npm ci (if stale), tests, build into dist/
python scripts/release-local.py --assemble          # also assemble _site/ without deploying
python scripts/release-local.py --deploy            # also publish to Cloudflare
python scripts/release-local.py --deploy --skip-build --skip-tests
python scripts/release-local.py --install           # force npm ci
```

| Flag | Effect |
|---|---|
| `--skip-build` | Reuse the existing `dist/` |
| `--skip-tests` | Do not run the Vitest suite |
| `--install` | Force `npm ci` even if `node_modules` looks current |
| `--assemble` | Assemble the site into `_site/` but do not deploy |
| `--deploy` | Publish with `npx --yes wrangler deploy` |

On Windows, run it as `python -X utf8 scripts/release-local.py ...` to avoid cp1252 decoding errors on npm/wrangler output.

With `--deploy`, `_site/` is assembled from `dist/` with the `__VERSION__` placeholder in both HTML files stamped as `<branch>+<sha7>`, and `wrangler.jsonc` publishes it as the static assets of the Worker `usb-tool`, together with `worker/index.js` (run first only for `/api/*`). The deployed version is the `build-version` meta tag in the page source. Credentials come from `npx wrangler login` or from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in a git-ignored `.env` (template: `.env.example`). `dist/` and `_site/` are git-ignored.

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for setup, conventions and the pull request process. Related documents: [docs/CODE_OF_CONDUCT.md](docs/CODE_OF_CONDUCT.md), [docs/SECURITY.md](docs/SECURITY.md), [docs/FEATURE_TOOL_HANDOFF.md](docs/FEATURE_TOOL_HANDOFF.md).

Several tools can perform security testing or send keystrokes and credentials to real targets. Use them only on devices and systems you own or are authorized to test.

## Acknowledgments

Third-party dependencies, projects ported or modeled on (usb-rea, Mayhem Mobile, CyberChef, the WarHog web flasher) and the firmware and hardware the app integrates with are listed in [docs/ACKNOWLEDGMENTS.md](docs/ACKNOWLEDGMENTS.md).

## License

MIT; see [LICENSE](LICENSE). Exceptions:

- `src/mayhem-mobile/` and the bundle built from it (`public/mayhem/`) are GPL-3.0, built from PortaPack Mayhem. The site serves its source at `/mayhem/mayhem-mobile-source.zip` and the license at `/mayhem/LICENSE.txt`; see [src/mayhem-mobile/LICENSE](src/mayhem-mobile/LICENSE).
- `src/utils/usbrea/` is a port of [usb-rea](https://github.com/emirmrkaljevic/usb-rea) (MIT, Emir Mrkaljević); see [src/utils/usbrea/LICENSE](src/utils/usbrea/LICENSE).
- Bundled third-party packages keep their own licenses. `npm run build` writes their notices to `dist/THIRD_PARTY_NOTICES.txt`, served at `/THIRD_PARTY_NOTICES.txt`.
