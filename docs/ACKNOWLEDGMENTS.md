# Acknowledgments & Third-Party Attribution

Skon's USB Tool stands on a large amount of open-source and open-standard work.
This file attributes everything the project **did not create itself** — the
libraries it depends on, the code it is ported from or modeled on, the external hardware and
firmware it controls or flashes, and the standards and data sources it uses.
Each dependency remains under its own license; see the respective projects for
full terms.

The in-app Knowledge Base (Wiki) additionally credits the specific upstream
project in each tool's article.

---

## Runtime Dependencies (npm)

| Package | Used For | Author / Project | License |
| :--- | :--- | :--- | :--- |
| `react`, `react-dom` | UI framework | Meta (Facebook) | MIT |
| `leaflet` | Interactive maps (Signal Map, Wardrive) | Vladimir Agafonkin & Leaflet maintainers | BSD-2-Clause |
| `leaflet.heat` | Heatmap overlay | Vladimir Agafonkin | BSD-2-Clause |
| `lucide-react` | Icon set | Lucide contributors (fork of Feather) | ISC |
| `crypto-js` | CyberChef AES/DES/RC4/hashes | Evan Vosberg | MIT (unmaintained) |
| `jszip` | Zip packaging/extraction | Stuart Knightley | MIT / GPLv3 |
| `pako` | zlib (inflate/deflate) in JS | Vitaly Puzrin & Andrey Tupitsin | MIT |
| `jwt-decode` | JWT inspection (CyberChef) | Auth0 | MIT |
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | Drag-and-drop (CyberChef recipe) | Claudéric Demers | MIT |
| `@uiw/react-codemirror`, `@codemirror/lang-json`, `@codemirror/lang-sql`, `@codemirror/state`, `@codemirror/view` (CodeMirror 6) | Code/JSON/SQL editor | Marijn Haverbeke & CodeMirror / uiwjs | MIT |
| `sql.js` | SQLite compiled to WASM (DB Browser) | sql.js contributors (SQLite is public domain) | MIT |
| `@openipc-rs/web` | Realtek RTL8812AU WebUSB monitor-mode WASM driver | OpenIPC project, [OpenIPC/openipc-rs](https://github.com/OpenIPC/openipc-rs) | MIT |

## Build & Dev Tooling

| Package | Used For | Author / Project | License |
| :--- | :--- | :--- | :--- |
| `vite`, `@vitejs/plugin-react`, `vite-plugin-wasm`, `vite-plugin-top-level-await` | Bundler / dev server / WASM support | Evan You & Vite contributors | MIT |
| `tailwindcss`, `@tailwindcss/container-queries`, `postcss`, `autoprefixer` | Styling pipeline | Tailwind Labs & PostCSS | MIT |
| `terser` | Production minifier | Mihai Bazon & contributors | BSD-2-Clause |
| `typescript` | Type checking | Microsoft | Apache-2.0 |
| `vitest` | Unit tests | Vitest contributors | MIT |
| `@types/react`, `@types/react-dom` | Type definitions | DefinitelyTyped contributors | MIT |

## Fonts

- **JetBrains Mono** (JetBrains, SIL OFL-1.1) and **Rajdhani** (Indian Type Foundry, SIL OFL-1.1), loaded via Google Fonts.

---

## Code We Ported or Modeled On

### Ported

- **usb-rea** — the *USB Protocol RE* tool (`src/components/tools/UsbReaWorkbench.jsx`,
  `src/utils/usbrea/`, `tests/usbrea/`) is an in-browser JavaScript port of **usb-rea**
  by **Emir Mrkaljević**: capture parsing, action markers, protocol inference,
  checksum detection, HID descriptor decoding, handshake and state analysis, the
  report, Python driver scaffold and Wireshark Lua dissector generators, and the
  VID:PID lookup. [github.com/emirmrkaljevic/usb-rea](https://github.com/emirmrkaljevic/usb-rea)
  — **MIT**, (c) 2026 Emir Mrkaljević. The port keeps that notice in each module header
  and lists its deviations from the Python original there.
- **Mayhem Mobile** (RocketGod) — the PortaPack receiver bundle (`src/mayhem-mobile/`,
  built to `public/mayhem/`, and the HackRF demodulation shape in
  `src/utils/hackrfDemod.js`) is [RocketGod-git/mayhem-mobile](https://github.com/RocketGod-git/mayhem-mobile),
  **GPL-3.0**, itself built from PortaPack Mayhem (GPL-3.0) and the HackRF project.
  Its in-app credits list the upstream authors, including dump1090 (Salvatore Sanfilippo),
  multimon-ng (Thomas Sailer, Elias Oenal, Craig Shelley), rtlamr (Douglas Hall),
  acarsdec (Thierry Leconte), rtl_433 (Benjamin Larsson and contributors), librtlsdr, mbelib,
  and the Flipper Zero SubGHz protocols (Flipper Devices); each keeps its own license.
  The GPL-3.0 terms apply to that part of the app.
- **WarHog web flasher** — the Warhog & Piglet suite's board carousel, flashing, device
  screens, pig sprites and Piglet toolkit/monitor are ports of the web flasher in
  [olosnoks/warhog](https://github.com/olosnoks/warhog) (same author as this project).
- **aircrack-js** (georg95), a browser port of aircrack-ng, provides the optional SIMD
  `public/wasm/aircrack.wasm` accelerator; the aircrack-ng project is GPL-2.0.
  See each upstream repository for its license text.

### Modeled on

- **CyberChef** — the in-app CyberChef engine (`src/utils/cyberchef/`, the
  `Operation` / `Dish` / `Chef` / recipe / Magic architecture) is an
  independent implementation **modeled on GCHQ's CyberChef**.
  [github.com/gchq/CyberChef](https://github.com/gchq/CyberChef) — Crown
  Copyright, Apache-2.0.

---

## External Hardware & Firmware We Integrate

Skon's USB Tool controls, flashes, or mirrors these third-party projects and
devices over Web Serial / WebUSB. The firmware and hardware are their authors'
work; this project only talks to them.

| Project / Device | Author(s) | Reference | License |
| :--- | :--- | :--- | :--- |
| ESP-IDF ROM protocol, `esptool` / `esptool-js` | Espressif Systems | [espressif/esptool-js](https://github.com/espressif/esptool-js) | GPL-2.0 / Apache-2.0 |
| Flipper Zero firmware & qFlipper RPC | Flipper Devices Inc. | [flipperdevices/flipperzero-firmware](https://github.com/flipperdevices/flipperzero-firmware) | GPL-3.0 |
| Proxmark3 (Iceman fork) & NG framing | Jonathan Westhues, Christian Herrmann (@iceman1001), RRG | [RfidResearchGroup/proxmark3](https://github.com/RfidResearchGroup/proxmark3) | GPL-3.0 |
| PortaPack Mayhem firmware & USB serial console | Jared Boone (ShareBrained), Furrtek, Mayhem team | [portapack-mayhem/mayhem-firmware](https://github.com/portapack-mayhem/mayhem-firmware) | GPL-2.0 |
| HackRF One & libhackrf | Michael Ossmann, Great Scott Gadgets | [greatscottgadgets/hackrf](https://github.com/greatscottgadgets/hackrf) | GPL-2.0 |
| ESP32 Marauder | JustCallMeKoko (@JustCallMeKoko) | [JustCallMeKoko/ESP32Marauder](https://github.com/JustCallMeKoko/ESP32Marauder) | GPL-3.0 / MIT |
| Bruce multi-tool firmware | pr3y & contributors | [pr3y/Bruce](https://github.com/pr3y/Bruce) | AGPL-3.0 |
| Piglet wardriver | Ham Spiced (@hamspiced) | [hamspiced/piglet](https://github.com/hamspiced/piglet) | Open Source |
| Cheap Yellow Display (CYD) | Brian Lough (@witnessmenow) & community | [witnessmenow/ESP32-Cheap-Yellow-Display](https://github.com/witnessmenow/ESP32-Cheap-Yellow-Display) | Open Hardware |
| NodeMCU dual-BJT auto-reset circuit | NodeMCU / Espressif | [nodemcu/nodemcu-devkit-v1.0](https://github.com/nodemcu/nodemcu-devkit-v1.0) | MIT / OSHWA |
| sigrok / fx2lafw (logic-analyzer decoding reference) | Uwe Hermann, Bert Vermeulen & sigrok | [sigrok.org](https://sigrok.org) | GPL-3.0 |

---

## Standards & Specifications

W3C WebSerial & WebUSB; IEEE 802.11 (Wi-Fi) & Radiotap; Modbus (Modicon /
Schneider Electric) & TIA/EIA-485; CAN 2.0 / ISO 11898 (Robert Bosch GmbH) &
SLCAN (Lawicel / Lars Wictorsson); SAE J1979 OBD-II; I²C (NXP / Philips) & SPI
(Motorola / NXP); NMEA 0183 & u-blox UBX; libpcap / PCAP (The Tcpdump Group);
Wireshark dissector conventions; ChibiOS/RT (PortaPack shell); DuckyScript
(Hak5); and the ESP-IDF partition/flash format (Espressif).

## Map & Data Providers

- **OpenStreetMap** contributors (base map tiles) — ODbL.
- **Esri** World Imagery / World Dark Gray Base (satellite & dark basemaps).
- **WiGLE.net** (WiGLE CSV wardriving format) — Bobzilla & Arkasha.
- **OUI / MAC vendor data** derived from the IEEE registration authority.
- **SecLists** (wordlists for the web/security tools) — Daniel Miessler, Jason Haddix & contributors — MIT; fetched on demand from the **jsDelivr** CDN.
- **HaveIBeenPwned** Pwned Passwords range API (k-anonymity) — Troy Hunt.
- **Google Public DNS** DNS-over-HTTPS endpoint (DNS Toolkit).
- **crt.sh** (Sectigo) Certificate Transparency search (crt.sh Subdomain Finder, Certificate Inspector).
- **Shodan**, **urlscan.io** and **HackerTarget** APIs (OSINT API Clients; bring your own key).
- **OpenDeviceDB** (optional online lookup in USB Protocol RE).

---

If you believe something is used but not credited here, please open an issue —
correct attribution is a goal of this project.
