# Skon's USB Tool // Hardware Hacker Workbench & Serial Tool

![GitHub Pages Deployment](https://img.shields.io/badge/deployment-GitHub%20Pages-success?style=for-the-badge&logo=github)
![Web Serial API](https://img.shields.io/badge/Web%20Serial%20API-Native%20W3C-cyan?style=for-the-badge&logo=w3c)
![License](https://img.shields.io/badge/license-MIT-amber?style=for-the-badge)

**Skon's USB Tool** is an elite client-side hardware hacker workbench and serial tool built with Vite, React, and Tailwind CSS, engineered specifically for static hosting on **GitHub Pages**.

It transforms your web browser into an industrial-grade serial station combining low-level Web Serial communication, true in-browser ESP32 ROM bootloader flashing, a 60 FPS real-time multi-channel oscilloscope, synchronized live hex memory inspection, automated U-Boot autoboot killing with root password bypass, and overnight zero-drop disk logging.

Beyond flashing and serial it has grown into a full hardware-hacking suite — raw 802.11 monitor-mode capture for Alfa / RTL8812AU adapters, protocol analyzers (logic analyzer, CAN / OBD-II, I²C / SPI, Modbus RTU), RF and badge companions (Flipper Zero, Proxmark3, PortaPack / HackRF, GPS wardriving), hardware programmers (CH341A, CMSIS-DAP, JTAG, AVR ISP, USB-PD), a BadUSB / DuckyScript studio, and an in-browser CyberChef workbench — all running client-side with no backend.

---

## 🧰 Complete Tool Suite

**Core Operations** — Terminal & Console (serial monitor + baud hunter) · Firmware Flasher (ESP32 / ESP8266 ROM bootloader) · Hardware Controls (DTR/RTS strapping, U-Boot interrupter)

**Analysis & Protocol Lab** — Packet & Protocol Lab (802.11 dissector, PCAP, hex stream) · 24 MHz Logic Analyzer · CAN Bus & OBD-II Scanner · I²C & SPI Bus Explorer · Modbus RTU & RS-485 · Oscilloscope Plotter · MitM Serial Bridge · CyberChef Workbench (Web Worker pipeline)

**RF, Wireless & Badges** — Alfa Wi-Fi (RTL8812AU WebUSB monitor mode & 802.11 capture) · Flipper Zero Suite · Proxmark3 / PM5 · PortaPack Mayhem SDR (HackRF) · GPS & Wardrive Suite

**Hardware & Payloads** — BadUSB & Payload Studio (DuckyScript) · Hardware Programmers (CH341A, CMSIS-DAP, JTAG SVF, AVR ISP) · USB-PD Power Delivery

**Device Utilities** — MicroPython Files · Improv Wi-Fi · Telemetry Gauges · Crash & Panic Alerts · Test Runner & Scripts · USB Recon & Autopsy · Silicon Memory Dump

**Setup & Reference** — In-app Knowledge Base Wiki (28+ engineering manuals) · driver setup guides · pinout diagrams · VID/PID chip-intelligence database

---

## ⚡ Power Features & Tool Suite

### 1. ⚡ Native ESP32 / ESP8266 ROM Bootloader Flashing Engine
Unlike standard web serial terminals that only spray raw bytes, Skon's USB Tool implements the **full SLIP-framed ESP ROM bootloader protocol**:
- **Automated Hardware Strapping**: Pulses DTR and RTS through the standard transistor auto-reset circuit (EN $\rightarrow$ GPIO0) to guarantee entry into ROM bootloader mode.
- **ROM Sync Handshake**: Exchanges 36-byte synchronization frames with the chip ROM.
- **SPI Flash Sector Erase & Write**: Programs target flash blocks with 32-bit sequence numbers and real-time XOR checksum verification.
- **Automatic Target Reboot**: Automatically resets the MCU into the newly flashed user firmware upon completion.

### 2. 📈 60 FPS Real-Time Multi-Channel Oscilloscope & Serial Plotter
- **Auto-Telemetry Parser**: Detects comma, space, colon, or key-value delimited numbers (e.g. `12.4, 45.1, 88.0` or `temp:24.5 volt:3.31 pid:42.0`).
- **Hardware Canvas Waveforms**: 60 FPS GPU-accelerated rolling waveform canvas with 50 to 500 sample window buffer.
- **Telemetry Statistics**: Displays instantaneous, Min, Max, and Average values per channel.
- **CSV Data Export**: One-click download of plotted session datasets for Excel, Python, or MATLAB.

### 3. 🛡️ U-Boot Exploit & Memory Dump Deck
- **Automated Autoboot Killer**: Transmits 40 Hz Spacebar bursts and **automatically halts** the millisecond a shell prompt (`=>`, `U-Boot>`, `# `) is detected.
- **1-Click Root Password Bypass**: Injects `setenv bootargs "${bootargs} init=/bin/sh"; boot` to drop directly into an unauthenticated root shell on Linux IoT devices.
- **Environment Parser**: Executes `printenv` and parses flash offsets, boot scripts, and IP configs into a searchable table.
- **Direct Flash / RAM Memory Dumper**: Streams `md.b` hex dump commands in automated chunks, parses output bytes, and compiles them into a downloadable `.bin` firmware file.

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

## 🚀 Quick Start

### Online Web App
Open directly in any Chromium browser (Chrome, Edge, Opera):  
👉 **[https://olosnoks.github.io/usb-tool/](https://olosnoks.github.io/usb-tool/)**

### Local Development
```bash
git clone https://github.com/olosnoks/usb-tool.git
cd usb-tool
npm install
npm run dev
```

---

## 🤝 Contributing & Community

- **[CONTRIBUTING.md](CONTRIBUTING.md)** — dev setup, project layout, the driver + workbench pattern for adding tools, and the PR process.
- **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** — community standards.
- **[SECURITY.md](SECURITY.md)** — responsible-disclosure policy and responsible-use notice.
- **[docs/FEATURE_TOOL_HANDOFF.md](docs/FEATURE_TOOL_HANDOFF.md)** — exhaustive blueprint for dropping a brand-new workbench into the app.

---

## 📄 License
MIT License. Open-source hardware hacking, firmware flashing, and serial analysis workbench.
