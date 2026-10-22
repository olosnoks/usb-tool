# Skon's Web Flasher // Hardware Hacker Workbench & Serial Tool

![GitHub Pages Deployment](https://img.shields.io/badge/deployment-GitHub%20Pages-success?style=for-the-badge&logo=github)
![Web Serial API](https://img.shields.io/badge/Web%20Serial%20API-Native%20W3C-cyan?style=for-the-badge&logo=w3c)
![License](https://img.shields.io/badge/license-MIT-amber?style=for-the-badge)

**Skon's Web Flasher** is a client-side React single-page application (SPA) built with Vite and Tailwind CSS, engineered specifically for static hosting on **GitHub Pages**.

It serves as a universal hardware hacker workbench and serial tool combining low-level Web Serial API terminal communication, live dual-view Hex memory inspection, real-time hardware line manipulation, reverse-engineering diagnostics, in-line frame injection with automatic checksum generation, and chunked firmware binary flashing.

---

## ⚡ Key Features

### 1. Low-Level Web Serial Terminal (`navigator.serial`)
- Native browser-to-hardware communication via W3C Web Serial API (Chrome, Edge, Opera, Chromium).
- **ANSI Stream Decoding**: Full color code parsing (3-bit/4-bit ANSI colors, bold, dim, underline, reset) for embedded RTOS and Linux kernels.
- **Auto-scroll Lock & Freeze**: Inspect high-frequency serial streams without losing position.
- **Search & Filter**: Real-time substring query filtering in serial logs.
- **Session Export**: One-click timestamped `.log` and `.txt` session log download.
- **Configurable Framing**: Baud rates from 300 to 2,000,000 bps, 7/8 data bits, 1/2 stop bits, parity (None, Even, Odd), and hardware flow control.

### 2. Synchronized Live Dual-View Hex Inspection Pane
- Standard hardware hex dump layout: `Offset (8 hex digits) | Hex bytes (8-byte / 16-byte grid) | ASCII decode`.
- **Directional Tagging**: Visually differentiates incoming RX bytes (Cyan/Emerald) from transmitted TX bytes (Amber/Gold).
- **Byte Telemetry Inspector**: Hover any byte to instantly inspect its memory offset, hexadecimal, decimal, 8-bit binary representation, ASCII character, and transfer direction.
- **Export & Copy Modes**: Copy inspection memory directly as Raw Hex, C Array (`const uint8_t[]`), or ASCII string.

### 3. Live Hardware Bus Line Manipulation & Signal Polling
- **Outputs (Click to Toggle)**:
  - **DTR** (Data Terminal Ready)
  - **RTS** (Request To Send)
  - **250ms Sustained UART Break**: Drives TX line to space level (0V) for breaking into boot roms, console debuggers, and Magic SysRq triggers.
- **Inputs (Polled in Real-Time)**:
  - **CTS** (Clear To Send)
  - **DSR** (Data Set Ready)
  - **DCD** (Data Carrier Detect)
  - **RI** (Ring Indicator)

### 4. Reverse-Engineering Diagnostics
- **Automated Baud Rate Hunter**:
  - Sweeps standard baud rates (9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600).
  - Evaluates sample Shannon Entropy ($H(X) = -\sum p(x) \log_2 p(x)$) and printable ASCII ratio to determine true baud rate with confidence scoring.
  - One-click "Apply" button to switch port clock immediately.
- **High-Frequency U-Boot / Bootloader Interrupt Spammer**:
  - 20ms burst loop (50 Hz) transmitting Space (`0x20`), Enter, Ctrl+C, or custom escape keys to reliably halt autoboot countdowns (Das U-Boot, RedBoot, CFE, OpenWrt).
- **ESP32 Hardware Bootloader Strapping State Machine**:
  - Automatically pulses DTR and RTS through the standard transistor auto-reset circuit (EN low $\rightarrow$ GPIO0 low $\rightarrow$ EN release $\rightarrow$ GPIO0 release) to boot into ROM bootloader mode. Includes optional inverted polarity toggle.

### 5. In-Line Hex Frame Injector with Checksum Engine
- Craft custom binary packets using space-separated hex, continuous hex, `\x..`, or comma-separated bytes.
- Automatic live checksum calculation:
  - **Modbus CRC-16 (Little Endian & Big Endian)**
  - **Sum8 (Additive modulo 256)**
  - **Two's Complement Sum8**
  - **XOR Checksum (LRC)**
  - **CRC-16 CCITT (XMODEM)**
  - **Raw Payload (No checksum)**
- Visual packet telemetry preview with checksum bytes highlighted.
- Built-in Modbus RTU, ESP sync, and custom user preset storage (persisted in `localStorage`).

### 6. Local Firmware Binary Flasher (.bin, .hex, .uf2)
- Drag-and-drop file loader supporting:
  - **Raw Binary (.bin)**
  - **Intel HEX (.hex)**: Parsed with record checksum verification and linear address offsets.
  - **Microsoft UF2 (.uf2)**: Parsed 512-byte blocks with magic numbers and target flash addresses.
- Configurable target memory offset (e.g. `0x00000000`, `0x08000000`).
- Chunked block transmission (32 to 4096 bytes).
- Inter-block throttling delay (0 to 100ms) to prevent UART buffer overruns.
- Live telemetry: progress bar, transfer rate (KB/s), block count, elapsed time, and ETA.

### 7. Hardware Hacker Macro Decks
- **MicroPython / CircuitPython REPL Deck**: Quick buttons for Ctrl+A (Raw REPL), Ctrl+B (Normal REPL), Ctrl+C (KeyboardInterrupt), Ctrl+D (Soft reboot), Ctrl+E (Paste mode), plus memory & system diagnostic snippets.
- **Hayes AT Command Deck**: One-click test commands (`AT`, `AT+GMR`, `AT+RST`, `AT+CSQ`, `AT+CWLAP`, `AT+CIFSR`, `AT+RESTORE`).
- **Programmable Macro Bank**: 8 custom user-definable macro slots with in-place editing.

---

## 🚀 Quick Start & Development

### Prerequisites
- Node.js 18+ (tested on Node 20 / 24)
- Google Chrome, Microsoft Edge, Opera, or any Chromium browser with Web Serial API enabled.

### Installation
```bash
# Clone the repository
git clone https://github.com/skons/skons-usb-tool.git
cd skons-usb-tool

# Install dependencies
npm install

# Start local dev server
npm run dev
```

### Production Build
```bash
npm run build
```
The output will be generated in `dist/` with relative asset links (`base: './'`), ready for direct deployment to GitHub Pages or any static file host.

---

## 🌐 Deploy to GitHub Pages

This repository includes an automated GitHub Actions deployment workflow in `.github/workflows/deploy.yml`.

To deploy:
1. Push this repository to GitHub.
2. In your GitHub repository settings, navigate to **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, select **GitHub Actions**.
4. The deployment workflow will automatically build and deploy the application to:
   ```text
   https://<your-username>.github.io/<repo-name>/
   ```

---

## 🛠️ Cyberpunk Palette & Design System
- **Base Background**: Slate-950 (`#020617`) with CRT scanline texture and cyber-card elevation.
- **Primary Accents**: Amber-400 (`#fbbf24`) with tactile golden glow.
- **Data Telemetry**: Cyan-400 (`#22d3ee`) for serial RX bytes and signal bus status.
- **Hardware LEDs**: Emerald-400 (`#34d399`) for active CTS/logic indicators.
- **Alarms & Interrupts**: Rose-500 (`#f43f5e`) for UART break and U-Boot spammer.
- **Typography**: JetBrains Mono + Rajdhani display fonts.

---

## 📄 License
MIT License. Open-source hardware hacking and serial debugging tool.
