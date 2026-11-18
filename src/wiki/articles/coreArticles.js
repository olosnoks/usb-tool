/**
 * Core Operations Wiki Articles — Exhaustive Technical Engineering Manual
 * Covering Terminal & Console, Firmware Flasher, and Hardware Controls & Bootstrapping
 * Sourced directly from Espressif ESP-IDF ROM specs, W3C WebSerial, and DENX U-Boot architecture.
 */

export const CORE_ARTICLES = [
  {
    id: 'workspace',
    toolId: null,
    category: 'core',
    title: 'Using the Workspace — Windows, Tiling & Shortcuts',
    summary: 'How the app itself works: the Start menu, the windowed desktop (drag, resize, minimize, maximize, tiling and snap), running more than one tool at once, per-window zoom, themes, the command palette, the terminal drawer, and every keyboard shortcut.',
    tags: ['Workspace', 'Windows', 'Tiling', 'Snap', 'Zoom', 'Shortcuts', 'Start Menu', 'Command Palette', 'Getting Started'],
    readTime: '9 min read',
    content: `
# Using the Workspace

Skon's USB Tool is a **windowed workspace**, like a tiny desktop inside your browser tab. Every tool opens in its own window, and several tools can run at once — each one talking to its own device. This guide explains the interface itself; the other articles cover the individual tools.

> **Browser:** the hardware tools use the WebUSB, WebSerial, WebHID and Web Bluetooth APIs, which only exist in Chromium-based desktop browsers — **Google Chrome, Microsoft Edge, Brave or Opera**. Firefox and Safari can read the docs but cannot open devices.

---

### 1. The Start menu — opening tools

Click the **START** button at the left end of the taskbar (or press \`Alt\` + \`S\`) to open the Start menu. It pops up from the taskbar like the classic Windows menu.

- **Categories** are listed in the menu. Hover or click one to open its sub-list as a flyout to the right; sub-categories cascade further. On narrow screens the flyouts stack instead.
- **Click a tool** to open it in a window. A tool you already opened is brought to the front instead of opening a second copy.
- **Search** with the box at the top ("Type to search tools"). While you type, the menu shows a ranked list of matches with each tool's category. \`Ctrl\` + \`K\` still opens the command palette.
- **Keyboard:** \`↑\` / \`↓\` move, \`→\` or \`Enter\` opens a category or launches a tool, \`←\` goes back a level, \`Esc\` clears the search and then closes the menu.
- **Recent** shows the last five tools you launched, and **All tools** lists everything in one flat list.
- The footer has shortcuts to the Wiki, the Pinouts reference and Chip Intelligence.
- Entries marked **DEMO** are interface previews without hardware support yet.

---

### 2. Windows

Each tool lives in a window you can move, size and stack like any desktop app.

- **Move:** drag the title bar.
- **Resize:** drag any edge or corner.
- **Minimize / maximize / close:** the buttons at the right of the title bar. Minimize parks the window on the taskbar; the tool keeps running and its device stays connected. Double-clicking the title bar also toggles maximize.
- **Focus:** click anywhere on a window to bring it to the front. The focused window has a coloured border.
- **Taskbar:** the strip along the bottom has the **Start** button, then lists every open window. Click an entry to focus or restore it. On the right are **Tile** (arrange all windows in a grid), **Cascade** (stack them diagonally) and **Close all**.

Your whole layout — window positions, sizes, zoom and which tools are open — is saved and restored the next time you visit.

---

### 3. Tiling & snapping

To put two tools side by side, **drag a window to an edge or corner of the desktop** and drop it. A cyan preview shows where it will land:

| Drop zone | Result |
| :--- | :--- |
| Left edge | Fills the left half |
| Right edge | Fills the right half |
| Top edge | Maximizes |
| Any corner | Fills that quarter |

You can also tile the focused window from the keyboard:

| Shortcut | Action |
| :--- | :--- |
| \`Ctrl\` + \`Alt\` + \`←\` | Left half |
| \`Ctrl\` + \`Alt\` + \`→\` | Right half |
| \`Ctrl\` + \`Alt\` + \`↑\` | Maximize |
| \`Ctrl\` + \`Alt\` + \`↓\` | Restore |

The taskbar's **Tile** button does the same for every open window at once.

---

### 4. Running more than one of the same tool

Sometimes you want two of the same tool — for example two PortaPack receivers, each on a different HackRF. There are two ways to open another instance:

- Click the **duplicate** button in a window's title bar (the copy-plus icon, left of minimize).
- **Alt-click** (or Ctrl-click) the tool in the Start menu.

Each instance is fully separate, with its own device connection, and is numbered in its title and on the taskbar — "PortaPack Mayhem SDR (2)". A plain Start-menu click still just focuses the first instance, so you never open extra windows by accident.

> A few tools keep some state shared across instances (for example the Mayhem tool's ADS-B aircraft list). Tuning, audio, capture and the like are always per window.

---

### 5. Zooming a tool

Each window has its own **content zoom**, separate from the browser's page zoom, so you can make one tool's text larger without affecting anything else.

- Use the **−** and **+** buttons in the title bar, or hold \`Ctrl\` and scroll the mouse wheel over the window.
- The percentage button toggles **FIT**, which scales the tool so its full layout fits the window width — handy after snapping a tool into a narrow half or quarter.

Because tools respond to their **window** size (not the screen), a tool in a quarter-screen tile automatically switches to its compact layout.

---

### 6. Themes

The header has a colour-theme dropdown (with a swatch preview) that restyles the whole app. It offers the popular editor palettes — Dracula, One Dark Pro, GitHub Dark, Monokai Pro, Night Owl, Tokyo Night, Nord, Solarized, Palenight, Ayu, SynthWave '84 and Catppuccin — plus the default. Your pick is remembered. The Mayhem receiver additionally has its own waterfall colour themes.

---

### 7. The command palette & the terminal drawer

- **Command palette** — press \`Ctrl\` + \`K\` (or \`⌘\` + \`K\`) to open a searchable list of every tool and common action: connect, disconnect, clear logs, set baud, export the session, open the pinouts or chip-intelligence references, and jump to any tool.
- **Terminal drawer** — press \`Ctrl\` + backtick (the \`~\` key) or \`Ctrl\` + \`J\` (or click **SERIAL** in the header) to drop a live serial console down from just below the header, above whatever tool you are using, so you can watch raw output without leaving the current window.
- **Workspace presets** — \`Alt\` + \`1\` … \`Alt\` + \`6\` jump to the preset layouts shown in the header.

---

### 8. Keyboard shortcuts at a glance

| Shortcut | Action |
| :--- | :--- |
| \`Ctrl\` + \`K\` | Command palette |
| \`Alt\` + \`S\` | Start menu |
| \`Ctrl\` + backtick or \`Ctrl\` + \`J\` | Toggle the terminal drawer |
| \`Alt\` + \`1\`…\`6\` | Workspace presets |
| \`Ctrl\` + \`Alt\` + \`←\` / \`→\` | Tile the focused window to the left / right half |
| \`Ctrl\` + \`Alt\` + \`↑\` / \`↓\` | Maximize / restore the focused window |
| \`Ctrl\` + mouse wheel (over a window) | Zoom that tool |
| Double-click a title bar | Maximize / restore |
| Alt-click a Start-menu tool | Open another instance |

---

### 9. First-time device tips

- When you click **Connect** in a tool, the browser shows a device chooser. Nothing happens until you pick a device there and confirm — the page cannot see your hardware otherwise.
- On **Windows**, some devices (the HackRF, many WebUSB gadgets) need the generic **WinUSB** driver bound with **Zadig** before the chooser can open them. Each tool's own guide says when this is needed.
- Only one browser tab (or desktop app) can hold a given device at a time. If a connect fails with the port "in use", close other tabs or apps that might have it open.
- A tool keeps its device while its window is minimized, so you can tuck a long capture out of the way and keep working.
`
  },
  {
    id: 'terminal',
    toolId: 'terminal',
    category: 'core',
    title: 'Terminal & Console — Serial Monitor & Baud Hunter Manual',
    summary: 'Comprehensive beginner-to-advanced guide to the WebSerial monitor, ANSI terminal decoding, Baud Hunter heuristics, hex streaming, and serial troubleshooting.',
    tags: ['Terminal', 'WebSerial', 'Baud Rate', 'ANSI', 'Hex Stream', 'Logging', 'UART', 'Debugging'],
    readTime: '24 min read',
    content: `
# Terminal & Console — Serial Monitor & Baud Hunter

The **Terminal & Console** is the primary diagnostic and communication interface of Skon's USB Tool. It provides real-time, bidirectional asynchronous serial communication directly between your web browser and any connected microcontroller, single-board computer (SBC), cellular modem, radio transceiver, or industrial controller over the **W3C WebSerial API** (Chromium browsers only; a Bluetooth LE serial device can also be attached with the **BLE** button).

---

### 1. What Is This Tool & Why Do You Need It?

When you connect a hardware device to your computer via USB (such as an ESP32, Arduino, Raspberry Pi Pico, or GPS module), the device communicates using **UART (Universal Asynchronous Receiver-Transmitter)** serial signals. Traditionally, interacting with UART required installing desktop utilities like PuTTY, TeraTerm, screen, minicom, or the Arduino IDE Serial Monitor.

The **Terminal & Console** eliminates all desktop software requirements. Using modern browser standards, it opens a raw hardware communication pipe, shows streaming text with ANSI colour (SGR) styling, captures a raw hexadecimal stream, injects checksummed hex frames, and provides a heuristic auto-detection engine ("Baud Hunter") to help find unknown baud rates.

---

### 2. How Serial (UART) Works Under the Hood

Unlike SPI or I2C, UART is **asynchronous** — there is no shared clock wire between the computer and the device. Both sides must independently agree on the exact timing of each transmitted bit.

#### The Physical Layer (RS-232 vs TTL)
- **TTL Serial (3.3V / 5V)**: Modern microcontrollers use TTL logic levels. A digital \`1\` (Mark/Idle) is +3.3V (or +5V), and a digital \`0\` (Space) is 0V (GND).
- **RS-232 (+12V / -12V)**: Legacy serial ports invert and amplify voltages (-12V is \`1\`, +12V is \`0\`). *Never connect raw RS-232 to an ESP32 without an RS-232 transceiver (e.g. MAX3232), or you will destroy the chip!*

<details>
<summary>Deep-Dive: UART Frame Timing, Bit Anatomy & Sampling Calculations</summary>

Every character sent over UART is encapsulated in a strict framing envelope:
1. **Idle Line**: Held continuously at logical HIGH (+3.3V).
2. **Start Bit (1 bit)**: The transmitter drives the line LOW (0V) for exactly 1 bit duration. This falling edge triggers the receiver's internal hardware timer.
3. **Data Bits (8 bits)**: Transmitted Least Significant Bit (LSB) first to Most Significant Bit (MSB).
4. **Parity Bit (None)**: Optional error checking bit (Rare in modern hardware, default: 'None').
5. **Stop Bit (1 bit)**: Pulled HIGH (+3.3V) to reset the receiver's state machine.

#### Bit Duration Formula:
\`\`\`text
Bit Duration (Seconds) = 1 / Baud Rate
\`\`\`
- At **9,600 baud**: 1 bit = \`104.16 microseconds\`.
- At **115,200 baud**: 1 bit = \`8.68 microseconds\`.
- At **921,600 baud**: 1 bit = \`1.085 microseconds\`.

The receiver samples the line at **16x oversampling** (sampling in the dead center at the 8th clock tick) to ensure noise immunity. If the clocks diverge by more than **3.0%**, sampling drifts into adjacent bit boundaries, turning text into garbage!
</details>

---

### 3. Hardware Wiring Guide (Beginner Friendly)

If connecting an external USB-to-UART bridge (CH340, CP2102, FT232R) to a bare microcontroller or GPS module:

| USB-UART Adapter Pin | Target Device Pin | Rationale |
| :--- | :--- | :--- |
| **GND (Ground)** | **GND (Ground)** | **MANDATORY.** Provides the 0V reference voltage. Without common ground, communication is 100% impossible. |
| **TXD (Transmit)** | **RXD (Receive)** | The adapter's output wire must connect to the target's input wire (Crossed). |
| **RXD (Receive)** | **TXD (Transmit)** | The adapter's input wire must connect to the target's output wire (Crossed). |
| **3.3V / 5V (Power)** | **VCC / VIN** | Only connect if you want to power the board from the USB adapter. Verify logic voltage rating! |

> **Beginner Trap #1 — The TX/RX Reversal**:
> If you connect TX to TX and RX to RX, no data will flow. Think of TX as a mouth and RX as an ear. Mouth connects to ear!

> **Beginner Trap #2 — Missing Common Ground**:
> If your microcontroller is powered by an external battery or wall adapter, you MUST still run a ground wire between the USB adapter's GND and the microcontroller's GND. Without a shared 0V reference, the logic voltages float unpredictably.

---

### 4. Interactive Console Controls & Features

**Connection controls** (the BAUD / CONNECT strip, also shown in the middle of the app header next to the **SERIAL** drawer toggle): a board selector, the **BAUD** dropdown, RX/TX activity lights, an ONLINE/OFFLINE badge, **CONNECT**, **BLE** and **DISCONNECT**. The baud list is \`300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880 (ESP8266 boot ROM), 115200, 230400, 460800, 921600, 1000000, 1500000, 2000000\` and is **locked while connected** — disconnect to change it. The advanced serial settings (data bits 8/7, stop bits 1/2, parity none/even/odd, flow control none/hardware) also cannot be changed while connected.

The **Terminal** window itself has a mode bar: a **Log view / Interactive** switch and three side-panel toggles — **Hex Stream**, **Baud Hunter** and **Protocol Injector** — next to the **ANSI STREAM CONSOLE**. The right end of the bar shows live counters: the current **Baud**, total **RX** and **TX** bytes and (once data has arrived over a measurable time) the average receive rate in B/s. They are counted over the chunks the log currently holds (the newest 1,500), so they stop growing once older chunks scroll out; TX bytes are the sent text's length when the raw bytes were not kept. The window remembers your last mode, side panel, probe mode and custom baud list in this browser (local storage). The console keeps the last 1,500 chunks; every chunk carries the real wall-clock time it arrived (to the millisecond) and a monotonic arrival time used for the deltas.

1. **STREAM / LINES / Δt TIMELINE**: STREAM is the classic colour log (RX/TX/SYS tags, one row per received chunk). **LINES** re-assembles the byte stream into whole lines, so a line that arrived in several pieces appears as one row (the **RX line end** option in the TOOLS drawer picks Auto, LF, CR or CRLF). Δt TIMELINE is a table of time, delta, direction, length, ASCII payload and hex bytes (first 16), with **all / rx / tx** filters.
2. **Search box** ("Search stream..."): highlights matching text and shows the match position and count. The **\`.*\`** button switches to regular-expression search (the box turns red and shows **ERR** on an invalid pattern); the up/down chevrons (or Enter / Shift+Enter) jump between matches, and **FILTER** hides every row that does not match.
3. **Timestamps** (clock icon): shows or hides the per-line timestamp.
4. **Disk logging**: the format dropdown chooses **RAW** (the exact bytes, \`.bin\`), **TEXT+TS** (timestamped text) or **HEX+TS** (timestamped hex). The disc icon then pipes the incoming RX byte stream to a file you pick through the File System Access API (Chrome/Edge/Opera), for long unattended logs; the stop icon closes the file. Logging also ends when the port disconnects.
5. **TOOLS**: opens a drawer with
   - **CTRL:** buttons **Ctrl-C**, **Ctrl-D**, **Ctrl-Z** and **ESC**, which send the raw control byte.
   - **Local echo (show TX)** and **RX line end** (Auto / LF / CR / CRLF).
   - **SEND FILE:** send a file **per char** or **per line** with a delay in ms between units, a byte progress counter and **Cancel**. Use the delay for devices that drop bytes on a fast paste.
   - **MACROS:** type a **Name** and a text (\`\\r\`, \`\\n\`, \`\\xNN\` escapes are expanded), then **Save macro**. It is stored with the line ending currently selected in the send bar and appears as a button that sends it. **Export** / **Import** move your macros as JSON. Macros live in the browser's local storage.
   - **HIGHLIGHT:** **Add rule** with a regex such as \`error|panic\` to colour matching text in the log; rules are saved in the browser and removed with the x.
6. **PAUSE / PAUSED**: freezes the view on a snapshot; new data keeps being logged (and streamed to disk).
7. **Auto-scroll** (down arrow): follows the newest line; scrolling up manually turns it off, scrolling back to the bottom turns it on again.
8. **Export**: in STREAM view the download icon saves the session as \`skons-serial-log-<timestamp>.log\`; in Δt TIMELINE view it saves a CSV timeline instead.
9. **Clear** (trash icon): clears the terminal buffer without disconnecting.
10. **Send bar**: type a command and press **SEND** (or Enter); the **Up/Down arrow keys** recall the last 50 commands. The line-ending dropdown offers:
   - **CRLF (\r\n)**: default; AT-command modems and many CLIs.
   - **LF (\n)**: MicroPython REPL, Linux shells.
   - **CR (\r)**: U-Boot style prompts.
   - **None (Raw)**: sends exactly what you typed.
   - **Hex Bytes**: the text box is parsed as hex bytes (e.g. \`55 AA 01\`) and sent raw.
11. **Interactive mode**: the **Interactive** button replaces the log and send bar with a keystroke-passthrough terminal. Click the screen to capture the keyboard and every key goes straight to the device (arrow keys, Tab, Ctrl combinations), so shells, the MicroPython REPL and line editors behave as in PuTTY; paste works too. Its header offers **Enter** (CR / CRLF / LF), **Backspace** (DEL 0x7F / BS 0x08), **Bracketed paste** (Auto / On / Off) and **Local echo**. It is a built-in emulator (10,000 rows of scrollback) that handles cursor movement, erase, 16-colour text and the alternate screen used by \`vi\`/\`top\`; it does not do scroll regions, 256/true colour, background colours or mouse reporting. Switching back to Log view loses no data.
12. **Hex Stream panel**: a hex + ASCII dump of the incoming and outgoing bytes (the last 4,096 bytes are kept, the newest 1,536 shown) with a row-width toggle (8/16), hex search (e.g. \`55 AA\`), auto-scroll, **Copy as Hex String**, **Copy as C-Array** and clear.
13. **Protocol Injector panel**: type hex bytes, pick a checksum (Modbus CRC-16 LE/BE, Sum8, Two's-complement Sum8, XOR/LRC, CRC-16 CCITT/XMODEM, or none), see the computed frame, and **INJECT HEX FRAME TO SERIAL BUS**. Presets (Modbus reads/writes, ESP ROM sync frame, a ping frame) are built in and you can save your own.

Press \`Ctrl+L\` while focus is anywhere in the console (including the input box) to clear it, or use the trash icon.

<details>
<summary>Deep-Dive: How Baud Hunter Automatically Detects Unknown Frequencies</summary>

Open the **Baud Hunter** panel and click **RUN BAUD SCAN** (you must be connected). The **PROBE** button toggles between **Active (\\r\\n)** and **Passive (Listen)**:
1. For each candidate rate (by default the 9 rates \`9600, 19200, 38400, 57600, 74880 (ESP8266 boot ROM), 115200, 230400, 460800, 921600\`; you can replace them under **How it works / candidate rates** with your own space- or comma-separated list of whole numbers from 50 to 4,000,000, and invalid entries are listed and ignored) the tool closes and re-opens the port at that rate with your current data bits / parity / stop bits / flow control.
2. In Active mode it sends a single \`\\r\\n\` to provoke a prompt, then listens for about 400 ms (reads time out every 150 ms).
3. It scores each sample:
   - **Printable ratio**: share of bytes in \`0x20\`–\`0x7E\` plus tab, LF and CR.
   - **Shannon entropy**: text typically scores around 3–5.8 bits per byte.
   - A penalty applies if more than half the bytes are \`0x00\` or \`0xFF\` (floating-line noise).
4. The results table lists **Baud**, **Confidence** (%), **Verdict** (HIGH PROBABILITY / MODERATE / LOW / UNLIKELY / NO DATA) and an **Apply** button per row. It does **not** auto-lock a winner: you choose and click **Apply**. Once results exist, **Apply best (baud)** sets the highest-scoring rate (only offered when its confidence is 50% or more) and **Copy report** puts a tab-separated table (baud, confidence, printable %, entropy, bytes, verdict) on the clipboard for notes or bug reports. On very narrow windows the Verdict column is hidden; hover the verdict to see the sample preview on wider layouts.
   - Similar tools: PuTTY, Tera Term, minicom/screen and the Arduino Serial Monitor are plain terminals with no baud detection. Dedicated auto-baud tools (for example the baudrate.py script from Binwalk's author) work on the same text-likelihood idea. This is a heuristic, not a guarantee.
5. While a scan runs a red **STOP** button appears next to the scan button. Stopping (or leaving the tab) ends the scan after the current rate and always restores your original baud rate and the console read loop; a status line reports "Scan stopped" or "Scan complete" (or tells you to reconnect if the original rate could not be restored).

Framing errors are not counted (WebSerial does not expose them), 300–4800 baud are not scanned, and a silent device that never answers a CR/LF scores "NO DATA" at every rate, so reset the board during an active or passive scan.
</details>

<details>
<summary>Complete ANSI / VT100 Terminal Control Sequences (CSI & TrueColor)</summary>

The **Log view** renders **SGR colour/style sequences only** (\`ESC [ ... m\`). Cursor movement, screen clearing and 24-bit colour are **not** interpreted there. For full-screen programs (\`vi\`, \`top\`, menu UIs) switch to **Interactive** mode, whose built-in emulator handles cursor movement, erase and the alternate screen (still no 256/true colour or background colours).

| Control Sequence | Supported | Effect |
| :--- | :---: | :--- |
| **\`\\x1b[0m\`** | Yes | Reset all attributes. |
| **\`\\x1b[1m\`** / **\`\\x1b[2m\`** / **\`\\x1b[4m\`** | Yes | Bold / dim / underline. |
| **\`\\x1b[30m\` - \`\\x1b[37m\`** | Yes | Foreground colours: black (grey), red, green, yellow, blue, magenta, cyan, white. |
| **\`\\x1b[90m\` - \`\\x1b[97m\`** | Yes | Bright foreground colours. |
| **\`\\x1b[40m\`–\`47m\`**, **\`38;5;N\`**, **\`38;2;R;G;B\`** | No | Background, 256-colour and TrueColor codes are ignored. |
| **\`\\x1b[2J\`**, **\`\\x1b[H\`**, **\`\\x1b[K\`** | No | Cursor/erase sequences are not emulated. |

</details>

<details>
<summary>Hardware vs Software Flow Control & Line Break Signaling</summary>

High-speed serial streams (>230,400 baud) can overflow microcontroller internal ring buffers:
1. **Hardware Flow Control (RTS / CTS)**: the advanced serial settings offer **Flow Control: none / hardware**, applied when the port is opened (WebSerial \`flowControl: 'hardware'\`). The Hardware Controls tool shows the live CTS/DSR/DCD/RI input lines.
   - **RTS (Request To Send)**: output from the computer.
   - **CTS (Clear To Send)**: input from the device; the target drives it when it can accept data.
2. **Software Flow Control (XON / XOFF)** is not a setting here (WebSerial has no such mode); you can still send \`0x13\` / \`0x11\` bytes with the **Hex Bytes** line ending if a device expects them.
3. **Serial Line Break Signaling**: use **ASSERT n ms UART BREAK** in the **Hardware Controls** tool (50–1000 ms, default 250 ms) to hold TXD low. Useful for bootloader ROMs and some consoles.

</details>

---

### 5. Common Terminal Issues & Solutions

| Symptom | Root Cause | Fix |
| :--- | :--- | :--- |
| Continuous \`x?x\` characters | Baud rate mismatch | Disconnect, choose the right baud (115200 is typical, 74880 for ESP8266 boot ROM) and reconnect, or run Baud Hunter and **Apply** a result. |
| Prompt says "No compatible devices found" | Missing USB driver or charge-only cable | Replace cable with a verified data cable; install CH340 / CP2102 drivers. |
| Terminal prints initial boot messages, then freezes | Firmware entered deep sleep or crashed | Press EN/RESET button on the board; check power supply current. |
| "Failed to open serial port: Access denied" | Port open in another app | Close Arduino IDE, VS Code serial monitor, or PuTTY. |

---

### 6. Upstream Standards & Project Attribution

| Entity / Project | Role & Contribution | Upstream Reference / Specification |
| :--- | :--- | :--- |
| **W3C WebSerial API** | W3C Community Group standard enabling direct asynchronous bidirectional serial communication between web applications and USB/UART devices. | [W3C WebSerial Spec](https://wicg.github.io/serial/) |
| **Digital Equipment Corp (DEC) & ANSI** | Creators of the VT100 / ANSI X3.64 (ECMA-48) terminal control escape sequences implemented in the WebGL/Canvas rendering pipeline. | [ECMA-48 Standard](https://www.ecma-international.org/publications-and-standards/standards/ecma-48/) |
| **xterm.js Project** | Industry-standard web terminal rendering architecture and ANSI parsing semantics upon which modern browser-based serial consoles are patterned. | [xtermjs.org](https://xtermjs.org/) |
`
  },
  {
    id: 'flasher',
    toolId: 'flasher',
    category: 'core',
    title: 'Firmware Flasher — ESP32 & ESP8266 Memory Partition Studio',
    summary: 'ESP ROM bootloader flashing from the browser: the cloud firmware catalog, multi-slot offset flashing, MD5 verification, partition table layout, and manual boot-mode recovery.',
    tags: ['Flasher', 'ESP32', 'ROM Bootloader', 'Partitions', 'esptool', 'Flash Memory', 'Firmware'],
    readTime: '26 min read',
    content: `
# Firmware Flasher — Memory Partition Studio

The **Firmware Flasher** is an in-browser flashing engine for ESP chips. It speaks the Espressif ROM bootloader protocol (SLIP framing over WebSerial) directly, so you can write bootloaders, partition tables, applications and filesystem images to ESP32-family and ESP8266 flash without installing Python, pip, or esptool.py.

---

### 1. What Is This Tool & Why Do You Need It?

Microcontrollers execute code stored in non-volatile **SPI Flash Memory**. To update the program, the microcontroller's CPU must be halted and placed into a specialized hardware bootloader mode where it listens for write commands over its primary serial port.

Historically, this required:
1. Installing Python.
2. Installing Espressif command-line tools (\`esptool.py\`).
3. Manually calculating hexadecimal byte offsets (\`0x1000\`, \`0x8000\`, \`0x10000\`).
4. Typing complex terminal commands with exact COM port numbers.

The **Firmware Flasher** handles this in your browser. It resets the chip into the ROM bootloader over DTR/RTS, syncs, identifies the silicon, writes each image at the offset you give it, and verifies each image with the chip's own MD5 (except on ESP8266, whose ROM cannot report one). You can load firmware from the built-in cloud catalog or flash your own multi-binary layout.

---

### 2. Supported Silicon Families

The chip is identified from the ROM's chip-detect register after sync. Recognised by name: **ESP8266, ESP32, ESP32-S2, ESP32-S3, ESP32-C3, ESP32-C2, ESP32-C6, ESP32-H2**. A chip whose ID is not in that list is reported as "ESP32-family (magic 0x...)" and flashing is still attempted (this is what happens with the ESP32-C5, which is not identified by name). Bootloader offsets come from the built-in layout presets:

| Silicon Family | Preset | Bootloader Offset | Partition Table | App Offset |
| :--- | :--- | :--- | :--- | :--- |
| **ESP32 (classic)** | ESP32 (Classic) | \`0x1000\` | \`0x8000\` | \`0x10000\` |
| **ESP32-S3 / C3 / C2 / C6** | ESP32-S3 / C3 / C2 / C6 | \`0x0000\` | \`0x8000\` | \`0x10000\` |
| **ESP8266** | ESP8266 / NodeMCU | n/a (all-in-one image) | n/a | \`0x00000\` |

The ESP32-S2 uses \`0x1000\` like the classic ESP32 but has no preset of its own; type the offsets yourself. Offsets for other chips (C5, H2, ...) follow your firmware's own documentation; merged images ("\`.merged.bin\`") are normally written at \`0x0\`.

**Speed:** the flasher uses the ROM bootloader directly (no RAM stub). After sync it negotiates the **BAUD** dropdown rate (115200, 230400, 460800 or 921600) with CHANGE_BAUDRATE, reopens the port at that rate and re-syncs. If the chip stops answering at the faster rate, the tool logs the failure, drops back to 115200, resets the chip into the ROM again and carries on. The ESP8266 and USB-Serial/JTAG ports always stay at 115200. After flashing, the port is returned to the rate the Terminal was using. With **COMPRESS** ticked (default) ESP32-family images are sent as a zlib stream, which cuts transfer time for compressible images; the ESP8266 ROM always writes uncompressed. Reading flash back is not offered in this tab (it needs the stub); the **ESP Flash Dump** tool covers backups.

---

### 3. Understanding Flash Memory Architecture & Partitions

When flashing an ESP32, you are not writing to a single monolithic hard drive. The SPI flash chip (typically 4MB, 8MB, or 16MB) is divided into strict memory sectors:

\`\`\`text
FLASH MEMORY MAP (Standard 4MB ESP32)
0x00000000 +-----------------------------------+
           | ROM Bootloader Vector (S3/C3/C6)  |
0x00001000 +-----------------------------------+
           | First-Stage Bootloader (Classic)  | Loads the partition table and the app
0x00008000 +-----------------------------------+
           | Partition Table (partition.bin)   | Binary index table listing all flash zones below
0x00009000 +-----------------------------------+
           | NVS (Non-Volatile Storage)        | Stores Wi-Fi SSIDs, passwords, calibration data
0x0000E000 +-----------------------------------+
           | Boot App0 (otadata)               | Selects whether factory or OTA update partition boots
0x00010000 +-----------------------------------+
           | Factory Application (firmware.bin)| YOUR COMPILED C++ / ARDUINO CODE LIVES HERE
0x00200000 +-----------------------------------+
           | SPIFFS / LittleFS Filesystem      | Web files (HTML/CSS/JS), captive portals, wordlists
0x003FFFFF +-----------------------------------+ (End of 4MB Flash)
\`\`\`

<details>
<summary>Deep-Dive: The ESP-IDF SLIP Framing & Flash Command Protocol</summary>

All communication with the ESP ROM bootloader uses **SLIP (Serial Line Internet Protocol)** framing:
- **Delimiter**: Packets begin and end with \`0xC0\`.
- **Escaping**: If \`0xC0\` occurs in data, it is escaped as \`0xDB 0xDC\`. If \`0xDB\` occurs, it is escaped as \`0xDB 0xDD\`.

#### ROM Bootloader Commands used by the tool:
| Opcode (Hex) | Command Name | Description |
| :--- | :--- | :--- |
| **\`0x08\`** | **SYNC** | Sends \`0x07 0x07 0x12 0x20\` followed by 32 \`0x55\` bytes; retried up to 8 times |
| **\`0x0A\`** | **READ_REG** | Reads the chip-detect register (\`0x40001000\`) to identify the silicon |
| **\`0x0D\`** | **SPI_ATTACH** | Attaches the SPI flash (ESP32 family) |
| **\`0x0B\`** | **SPI_SET_PARAMS** | Tells the ROM the flash geometry (the size detected from the JEDEC id, or 16 MB if it could not be read) |
| **\`0x02\`** | **FLASH_BEGIN** | Erases the target range and announces block count / size |
| **\`0x03\`** | **FLASH_DATA** | Streams 1,024-byte blocks, each with a sequence number and checksum |
| **\`0x0F\`** | **CHANGE_BAUDRATE** | Switches the chip to the selected baud rate; the port is reopened and re-synced |
| **\`0x10\` / \`0x11\` / \`0x12\`** | **FLASH_DEFL_BEGIN / DATA / END** | Compressed (zlib) writes on the ESP32 family; skipped for incompressible images and on ESP8266 |
| **\`0x13\`** | **SPI_FLASH_MD5** | Asks the chip for the MD5 of the written range (not available on ESP8266) |

FLASH_END is not used on the plain path: the tool resets the chip into the app with DTR/RTS after flashing. Before the first erase, the JEDEC id (SPI command 0x9F, read through the SPI host registers) gives the flash size; an image that would end past the detected flash is refused with "Nothing was erased". If the size cannot be read, the check is skipped and the log says so.

#### No RAM stub
The Espressif \`esptool\` normally uploads a small "stub" flasher into RAM for higher speed, compression and flash reading. This tool does **not** load a stub; it relies on the ROM's own baud switch and compressed-write commands instead.
</details>

<details>
<summary>Deep-Dive: Partition Table CSV Syntax & 32-Byte Binary Layout</summary>

The tool does not create or edit partition tables: it writes the \`partitions.bin\` you supply at the offset you give it. For reference, the table stored at \`0x8000\` consists of 32-byte binary structures defining every zone in flash memory:

\`\`\`csv
# Name,   Type, SubType, Offset,  Size, Flags
nvs,      data, nvs,     0x9000,  0x5000,
otadata,  data, ota,     0xe000,  0x2000,
app0,     app,  ota_0,   0x10000, 0x180000,
app1,     app,  ota_1,   0x190000,0x180000,
spiffs,   data, spiffs,  0x310000,0xE0000,
coredump, data, coredump,0x3F0000,0x10000,
\`\`\`

#### 32-Byte Partition Record Bitfields:
- **Bytes 0 - 1**: Magic Word (\`0xAA 0x50\`).
- **Byte 2**: Type (\`0x00\` = App, \`0x01\` = Data).
- **Byte 3**: Subtype (App: \`0x00\` = Factory, \`0x10\` = OTA_0; Data: \`0x00\` = OTA Data, \`0x02\` = NVS, \`0x82\` = SPIFFS).
- **Bytes 4 - 7**: 32-bit Starting Flash Offset (4KB aligned for data, 64KB for apps).
- **Bytes 8 - 11**: 32-bit Partition Size in bytes (4KB aligned).
- **Bytes 12 - 27**: Label string (Null-terminated ASCII, max 16 chars).
- **Bytes 28 - 31**: Flags (Bit 0 = \`1\` for Encrypted).

</details>

<details>
<summary>Flash mode, frequency and size (QIO, DIO, ...)</summary>

The flasher has **no** flash-mode, flash-frequency or flash-size options, and it does not patch the image header: bytes are written exactly as found in your file. The SPI mode (QIO / QOUT / DIO / DOUT), frequency and size are stored in the second-stage bootloader's header at build time. If a board bootloops with \`flash read err, 1000\` after flashing, rebuild with the correct flash mode for that board (DIO is the safest default) or use an image built for it.

</details>

---

### 4. Step-by-Step Flashing Procedure

The tool has two sub-tabs: **Cloud Firmware Catalog (400+ Presets)** (the default) and **Multi-Slot Partition Flasher**. The serial port is connected with the normal **CONNECT** button (BAUD strip), not from inside this tool.

#### Method A: Cloud Firmware Catalog
1. Plug your ESP board in and click **CONNECT** (choose the baud first; the ROM flasher uses it).
2. In **Cloud Firmware Catalog**, search ("Search 400+ cloud firmwares (Marauder, Meshtastic, Bruce, Piglet...)") and pick a suite and board variant. The list is downloaded from the ESP Terminator manifest (\`espterminator.com\`); **Refresh** reloads it, and a small bundled fallback list (Piglet builds) is used if it cannot be fetched.
3. Click **Load into Flasher Slots**. The firmware is downloaded in the browser (GitHub release files go through a CORS proxy) and the tool switches to the Multi-Slot tab with the files and their addresses filled in.
4. Click **FLASH n PARTITION(S)**.

#### Method B: Multi-Slot Partition Flasher (your own files)
1. Optionally click a layout preset: **ESP32 (Classic)**, **ESP32-S3 / C3 / C2 / C6**, **ESP8266 / NodeMCU** or **Single Custom Binary**. Presets fill in slot labels and offsets (bootloader \`0x1000\` or \`0x0000\`, partition table \`0x8000\`, app \`0x10000\`; optional storage slots are unticked by default).
2. For each slot, set the **OFFSET** (hex, e.g. \`0x10000\`; "Invalid Hex" is shown otherwise), tick or untick it, and select a \`.bin\`, \`.hex\` (Intel HEX) or \`.uf2\` file. For HEX/UF2 files with a start address, the offset is filled in automatically.
3. Use the add-slot button (up to **4** slots) or the trash icon on a slot (at least one must remain).
4. Under **BOOTLOADER ENGINE & TIMING CONTROLS**, leave **PROTOCOL** on **ESP ROM Bootloader (SLIP / Sync)**. **Reset Pulse Duration** (50–500 ms, default 150) and **Boot Pin (IO0) Hold Duration** (20–250 ms, default 50) tune the DTR/RTS auto-reset. **BAUD** (115200–921600) and **COMPRESS** sit in the same strip. **BLOCK SIZE** offers 256–4096 bytes but the ROM mode caps writes at 1024.
5. Click **FLASH n PARTITION(S) [size]**. The tool resets into the bootloader, syncs, detects the chip, negotiates the baud rate (falling back to 115200 on failure), checks the images against the detected flash size before erasing, flashes each enabled slot in order with a per-slot MD5 check, then resets the chip into the application. The final log line reports the baud rate used (and "fallback from ..." if it dropped), whether the write was compressed, and whether it was MD5-verified. Progress, speed, elapsed time and ETA are shown; **ABORT** (shown while flashing) stops both modes between blocks: an ESP ROM flash stops after the block in flight, skips the MD5 check and the reset, logs "Aborted", restores the port's baud rate and leaves the port connected and usable. The chip may be left with a partial image, so flash again before relying on it.

The alternative **PROTOCOL: Raw UART Block Streamer** simply writes the file bytes to the serial port in blocks (with a configurable delay). It does not talk to any bootloader, does not erase or verify, and is for custom targets that accept a raw byte stream. The dropdown labels it "Raw UART stream (no protocol, unverified)", and the final log says the target gave no acknowledgement, so it does not prove the bytes were written.

**Proxmark and other WebFlashService targets:** the built-in Proxmark flash manifests carry no real published SHA-256 hashes yet (the earlier placeholders were hashes of test strings), so those entries are disabled and flashing is refused until a real hash is supplied through a manifest generated from the release files.

<details>
<summary>Troubleshooting: Unbricking Boards with Failed Auto-Reset (Button Dance)</summary>

If the flasher fails with:
\`\`\`text
The chip did not answer SYNC. Check that it is an ESP chip, the port and cable, and hold BOOT (IO0) while resetting if auto-reset does not work.
\`\`\`
**Perform the Manual Button Dance**:
1. Locate the two physical push buttons on your board: **BOOT** (or GPIO0) and **RESET** (or EN).
2. **Press and HOLD the BOOT button**.
3. While continuing to hold BOOT, **press the RESET button once** and release it.
4. Keep holding **BOOT** and click **FLASH** again (the tool's own reset pulse is harmless while BOOT is held); release BOOT once flashing starts.

Boards with native USB (ESP32-S2/S3/C3 using USB-Serial/JTAG, VID \`0x303A\` PID \`0x1001\`) use a dedicated reset sequence automatically. Also try a longer reset pulse and a different baud rate.
</details>

---

### 5. Upstream Project & Engineering Attribution

| Project / Entity | Role & Contribution | Repository / License |
| :--- | :--- | :--- |
| **esptool-js (Espressif Systems)** | Official JavaScript implementation of the Espressif ROM bootloader protocol. Implements SLIP framing, high-speed baud switching, MD5 verification, and stub execution. | [github.com/espressif/esptool-js](https://github.com/espressif/esptool-js) (Apache-2.0) |
| **esptool.py (Espressif Systems)** | Foundational Python flash utility authored by Fredrik Ahlberg, Angus Gratton, and Espressif Systems contributors. Established ROM command opcodes, partition table specs, and register addresses. | [github.com/espressif/esptool](https://github.com/espressif/esptool) (GPL-2.0) |
| **ESP-IDF Partition Table Architecture** | The binary 32-byte partition record specification, MD5 checksum format, and SPI flash mapping defined by Espressif Systems. | [Espressif ESP-IDF Docs](https://docs.espressif.com/projects/esp-idf/) |
`
  },
  {
    id: 'hardware',
    toolId: 'hardware',
    category: 'core',
    title: 'Hardware Controls — Pin Strapping, DTR/RTS & U-Boot Interrupter',
    summary: 'Hardware-level control of USB-UART modem signals, auto-reset timing manipulation, ESP strapping pin voltages, and automated bootloader interrupts.',
    tags: ['Hardware Controls', 'DTR', 'RTS', 'Strapping Pins', 'U-Boot', 'Reset Timing', 'GPIO0', 'EN'],
    readTime: '20 min read',
    content: `
# Hardware Controls — Pin Strapping & Signal Timing

The **Hardware Controls** workbench gives you physical-level authority over the modem status signals of your USB-to-UART adapter. It is essential for troubleshooting stubborn boot sequences, unbricking development boards, testing power resets, and breaking into bootloader consoles.

---

### 1. What Is This Tool & Why Do You Need It?

USB-to-UART bridge ICs (such as the CH340, CP2102, or FT232R) have more than just TX and RX pins. They include hardware handshaking lines:
- **DTR (Data Terminal Ready)**
- **RTS (Request To Send)**

On almost all microcontroller development boards (NodeMCU, ESP32 DevKit, Arduino), these two pins are wired to a pair of bipolar junction transistors (BJTs) that control the microcontroller's **EN (RESET)** and **GPIO0 (BOOT)** pins.

The **Hardware Controls** workbench lets you bypass software automation and manually command these physical pins, run timed bootloader-entry and reset sequences, assert a UART line break, watch the input handshake lines, or spam interrupt keys to catch bootloader shells on embedded Linux systems. It needs a connected WebSerial port; the signals are driven with \`port.setSignals()\`.

---

### 2. The Classic Auto-Reset Transistor Circuit

To understand what happens when you click buttons in this workbench, examine the standard transistor auto-reset circuit used across the industry:

\`\`\`text
           +3.3V
             |
            [10k Pull-Up]
             |
DTR ----\\___/---- Base Q1 ---> Collector connected to ESP RESET (EN)
RTS ----/   \\---- Base Q2 ---> Collector connected to ESP GPIO0 (BOOT)
\`\`\`

<details>
<summary>Deep-Dive: Complete Auto-Reset Transistor Truth Table & Signal States</summary>

| DTR Line | RTS Line | Transistor Q1 (EN) | Transistor Q2 (GPIO0) | Resulting Silicon State |
| :---: | :---: | :---: | :---: | :--- |
| **1 (HIGH)** | **1 (HIGH)** | OFF (EN pulled HIGH via 10k) | OFF (GPIO0 pulled HIGH) | **Normal Run Mode** (Executes user app) |
| **0 (LOW)** | **1 (HIGH)** | **ON (Pulls EN to 0V)** | OFF (GPIO0 remains HIGH) | **Hardware Reset** (Held in reset) |
| **1 (HIGH)** | **0 (LOW)** | OFF (EN remains HIGH) | **ON (Pulls GPIO0 to 0V)** | GPIO0 pulled LOW (Prepares for download) |
| **0 (LOW)** | **0 (LOW)** | OFF (Both cancel out) | OFF (Both cancel out) | Idle protected state |

> **Polarity note:** the buttons in the tool report \`ASSERTED (HIGH)\` / \`IDLE (LOW)\` for the *software* flag passed to WebSerial (\`dataTerminalReady\` / \`requestToSend\` = true). USB-UART bridges invert these lines, so asserted means the physical pin is driven **low**. With the standard two-transistor circuit above, wiring conventions differ between boards; use a multimeter if you need to be sure.
</details>

---

### 3. Critical Strapping Pins by Architecture

When the \`EN\` pin rises from 0V to 3.3V (power-on or reset release), the internal hardware ROM samples the voltage on several specific GPIOs known as **Strapping Pins**.

#### ESP32 Classic Strapping Pins
- **GPIO0**:
  - \`HIGH (3.3V)\`: Boots from internal SPI flash.
  - \`LOW (0V)\`: Enters ROM serial download bootloader mode.
- **GPIO2**: Must be left floating or pulled LOW during boot. If pulled HIGH, entering download mode will fail on some silicon revisions.
- **GPIO12 (MTDI)**: Selects internal SPI flash voltage regulator:
  - \`LOW (0V)\`: 3.3V flash (Standard for 99% of modules).
  - \`HIGH (3.3V)\`: 1.8V flash.
  - *Warning: If an external sensor pulls GPIO12 HIGH during boot, the ESP32 under-volts its own flash chip and bootloops with a flash read error!*
- **GPIO15**: Must be pulled HIGH (or floating) during boot. Outputs UART boot log clock.

<details>
<summary>Deep-Dive: ESP32-S3 / C3 / C6 Modern Strapping Differences</summary>

In newer RISC-V and Xtensa architectures (ESP32-S3, C3, C6):
- **GPIO0 (S3) / GPIO9 (C3 / C6)**: Serves as the primary bootloader strapping pin.
- **Internal Weak Pull-Ups**: Modern Espressif SoCs integrate 45kΩ internal pull-up resistors on boot pins to eliminate floating states.
- **Native USB-JTAG/Serial Mode**: If GPIO0/GPIO9 is pulled LOW on boot, the native USB peripheral exposes the built-in USB bootloader directly, bypassing external USB-UART chips!
</details>

---

### 4. Interactive Workbench Features

#### 1. Hardware Strapping Timing Controls (ESP32 / bootloader)
Two sliders set the timing: **Reset Hold Duration** (50–500 ms, default 150) and **Boot Pin Hold Duration** (20–250 ms, default 50). Then:
- **TRIGGER ESP32 BOOTLOADER MODE** runs the sequence shown in the tool: (1) EN low, IO0 low, wait the reset duration; (2) release EN while IO0 stays low, wait the boot-pin duration; (3) release IO0. It uses RTS for EN and DTR for IO0, the common auto-reset wiring.
- **NORMAL REBOOT TO APP** pulses EN low for 120 ms and releases it with IO0 idle so the board boots its application.
- **Pro Tip**: if your board has a large capacitor on the reset line (e.g. 10uF), the default 150 ms may be marginal; raise the reset slider to **250 ms** or more.

#### 2. Reset & Bootloader Profiles
The **RESET & BOOTLOADER PROFILES** panel runs a ready-made DTR/RTS sequence for a family of boards, using the same two hold sliders as above. Pick one in **PROFILE:**; when the connected adapter's USB vendor/product ID is recognised the panel shows a **Suggested for this USB ID** badge and pre-selects it (only a suggestion, nothing runs by itself):
- **ESP32 / ESP8266 (UART bridge, DTR=IO0 RTS=EN)**: the classic auto-reset wiring.
- **ESP32-S/C native USB (USB-Serial/JTAG)**: the sequence for chips whose USB port is the built-in USB-Serial/JTAG peripheral.
- **Arduino (DTR auto-reset, serial bootloader)**: one DTR pulse; bootloader entry and reset are the same pulse because the bootloader runs after any reset.
- **STM32 (BOOT0 + NRST on DTR/RTS)**: choose which signal drives BOOT0 (**DTR (NRST on RTS)** or **RTS (NRST on DTR)**) and tick **invert BOOT0** / **invert NRST** to match your adapter.
- **RP2040 / nRF52 / Adafruit / Teensy (1200-baud touch)**: no signal sequence; the button becomes **SEND 1200-BAUD TOUCH**, which opens the port at 1200 baud with DTR/RTS low and closes it. The board re-enumerates (an RP2040 shows up as a USB drive such as RPI-RP2), so a notice appears with a **CONNECT NEW PORT** button for the new serial port.

**ENTER BOOTLOADER (PROFILE)** and **RESET (PROFILE)** run the selected profile, and **Invert DTR/RTS polarity** flips the whole sequence if your adapter or circuit is wired the other way. After a run the panel prints the measured hold times, since browser timers are not exact.

The **Custom sequence editor** (expand it) lets you build your own: each step sets DTR and RTS to **keep / assert / release** and a **hold** time; use **+ step** and **remove**, then **Run**. **Save** stores it by name in the browser (click a name under **Saved:** to reload it), and **Export JSON** / **Import JSON** exchange sequences as \`{"name":"...","steps":[{"dtr":false,"rts":true,"waitMs":100}]}\`.

#### 3. Manual UART Pin Toggles
- **DTR PIN** and **RTS PIN** are toggle buttons. Each shows \`ASSERTED (HIGH)\` or \`IDLE (LOW)\` (see the polarity note above). Use them to hold EN (reset) or IO0 (boot) while you probe voltages with a multimeter, then toggle again to release.
- **UART Line Break**: a slider (50–1000 ms, default 250) and an **ASSERT n ms UART BREAK** button that holds TXD low for that long.

#### 4. Live Hardware Input Signals
**CTS, DSR, DCD and RI** are polled from the adapter every 250 ms (\`port.getSignals()\`) and shown as HIGH/LOW.

#### 5. U-Boot Interrupt Spammer & Bootloader Halter
When working with Linux Single Board Computers (Raspberry Pi, Orange Pi, Banana Pi, OpenWrt Wi-Fi routers, IP cameras):
- The U-Boot bootloader provides a recovery shell to re-flash Linux kernels, dump flash memory, or bypass root passwords.
- U-Boot only pauses autoboot if it receives a keypress (Space, Enter, or \`Ctrl+C\`) within its autoboot countdown after power-on.
- **How to Use**: choose an **INTERRUPT KEY** (Spacebar \`0x20\`, Enter \`\\r\\n\`, Ctrl+C \`0x03\`, Escape \`0x1B\` or a custom string), set the **BURST INTERVAL** (10–100 ms, default 25 ms) and click **START SPAMMER**. Power cycle or reset your board. A burst counter runs until the tool sees one of these prompts in the received text (even without a trailing newline) and stops itself: \`=>\`, \`u-boot>\`, \`cfe>\`, \`redboot>\`, \`# \` or \`$ \` (a "Caught" badge shows the match). It never sends after the catch. Click **STOP SPAMMER** to stop manually.
- **Quick Bootloader Actions** (send commands with an LF ending): **Bypass Root Password (init=/bin/sh)** (asks for confirmation first, because it changes the target's boot behaviour) sends \`setenv bootargs "\${bootargs} init=/bin/sh"\` then \`boot\`; **Dump Environment (printenv)**; **Target Version (version)**; **Memory Hexdump (md.b)** sends \`md.b 0x80000000 0x100\` (adjust the address in the Terminal for your SoC).

<details>
<summary>U-Boot Command Prompt Environment Variable Reference & Kernel Boot Commands</summary>

Once halted at the \`=>\` prompt, engineers use these low-level U-Boot commands to recover routers and single-board computers:

| Command | Action & Example | Diagnostic Purpose |
| :--- | :--- | :--- |
| **\`printenv\`** | Dumps all active bootloader environment variables. | Inspects kernel boot arguments, MAC addresses, and memory load addresses. |
| **\`setenv bootargs\`** | \`setenv bootargs "console=ttyS0,115200 root=/dev/mmcblk0p2 rw init=/bin/sh"\` | Bypasses Linux password authentication by booting directly into root single-user shell. |
| **\`md.b <addr> <count>\`** | \`md.b 0x20000000 0x100\` | Memory Dump: Reads and prints raw hexadecimal bytes directly from physical RAM. |
| **\`mw.b <addr> <val> <cnt>\`**| \`mw.b 0x20000000 0x00 0x100\` | Memory Write: Writes byte values directly to peripheral registers or SRAM. |
| **\`tftpboot <addr> <file>\`** | \`tftpboot 0x82000000 uImage\` | Downloads recovery kernel image over Ethernet via TFTP without booting operating system. |
| **\`bootm <addr>\`** | \`bootm 0x82000000\` | Executes application or Linux kernel residing at the specified memory address. |
| **\`reset\`** | Restarts CPU and re-executes cold hardware initialization. | Reboot target. |

</details>

---

### 5. Upstream Project & Engineering Attribution

| Project / Hardware Standard | Role & Contribution | Reference & License |
| :--- | :--- | :--- |
| **NodeMCU & Espressif Dual-BJT Auto-Reset Circuit** | Open-source hardware circuit design utilizing cross-coupled NPN transistors (Q1/Q2) on DTR/RTS lines to automate EN/GPIO0 sequencing without manual button interaction. | [NodeMCU Hardware DevKit](https://github.com/nodemcu/nodemcu-devkit-v1.0) (MIT / OSHWA) |
| **Das U-Boot (Universal Boot Loader)** | The embedded Linux bootloader created by Wolfgang Denk and maintained by DENX Software Engineering. Defines the autoboot countdown interruption sequence (\`Space\` / \`Enter\` / \`Ctrl+C\`) and environment manipulation shell. | [source.denx.de/u-boot/u-boot](https://source.denx.de/u-boot/u-boot) (GPL-2.0) |
| **W3C WebSerial Signal Control API** | The \`SerialPort.prototype.setSignals()\` specification allowing direct software manipulation of DTR and RTS modem control lines from the browser. | [W3C Serial API Signals Spec](https://wicg.github.io/serial/#dom-serialport-setsignals) |
`
  }
];
