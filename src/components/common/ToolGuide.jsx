import React, { useState, useEffect } from 'react';
import { 
  HelpCircle, 
  ChevronDown, 
  ChevronUp, 
  Sparkles, 
  Lightbulb, 
  CheckCircle2, 
  AlertTriangle,
  Zap,
  Info,
  BookOpen
} from 'lucide-react';

export const TOOL_GUIDES = {
  flasher: {
    title: 'Firmware Flasher & Partition Engine',
    shortDesc: 'Program binary images (.bin, .hex, .uf2) into microcontroller flash at hexadecimal offsets.',
    steps: [
      'Click "CONNECT" in the top bar to select your USB-UART serial port.',
      'Select a memory layout preset (e.g. ESP32 Classic, ESP32-S3/C3, or ESP8266).',
      'Drag and drop your firmware files (.bin, .hex, or .uf2) into the partition slots.',
      'Verify the hex offset for each partition (e.g. Bootloader @ 0x1000, App @ 0x10000).',
      'Click "FLASH PARTITIONS" and monitor the progress bar and checksum verification.'
    ],
    tips: [
      'If you see "Timed out waiting for packet header", hold the physical BOOT/IO0 button on your board while clicking Flash, then release it once flashing starts.',
      'Intel HEX and UF2 files automatically detect their starting address.',
      'Adjust the Reset & Boot timing sliders in the flasher settings if your dev board uses slow capacitors.'
    ],
    shortcuts: 'Use Alt+1 for Flasher workspace'
  },
  terminal: {
    title: 'Diagnostic Terminal & Console',
    shortDesc: 'Full-duplex ANSI serial console with live hex stream, automated baud rate scanner, and frame injector.',
    steps: [
      'Select your baud rate (default: 115200 bps) and click "CONNECT" in the top bar.',
      'Incoming device logs appear in real-time with microsecond timestamps.',
      'Type commands in the bottom input bar and select line ending (CRLF, LF, CR, None, or Hex).',
      'Click "Hex Stream" to inspect raw incoming and outgoing bytes side-by-side.',
      'If output displays garbage characters, click "Baud Hunter" to automatically find the correct baud rate.'
    ],
    tips: [
      'Click "Protocol Injector" to calculate and send Modbus CRC, CCITT, and XOR frames.',
      'Use Ctrl+L to clear terminal log history.',
      'Click the download button in the console toolbar to export logs as a .txt file.'
    ],
    shortcuts: 'Use Alt+2 for Terminal workspace'
  },
  hardware: {
    title: 'Hardware & Bootloader Strapping Controls',
    shortDesc: 'Drive DTR/RTS strapping pins, configure pulse hold timings, assert line breaks, and halt U-Boot autoboot.',
    steps: [
      'Connect your microcontroller via USB-UART.',
      'Adjust "Reset Hold Duration" (50–500ms) and "Boot Pin Hold Duration" (20–250ms).',
      'Click "TRIGGER ESP32 BOOTLOADER" to put the chip into ROM download mode without touching hardware buttons.',
      'Use manual DTR and RTS toggles to assert continuous logic levels.',
      'Use the U-Boot Spammer to broadcast 25ms keystroke bursts to halt bootloader countdowns.'
    ],
    tips: [
      'The U-Boot Spammer automatically detects prompts ("=>", "u-boot>", "#") and stops spamming.',
      'Use the 1-click "Bypass Root Password" button to inject single-user init=/bin/sh arguments.',
      'Input signals (CTS, DSR, DCD, RI) are polled live from the USB-UART bridge every 250ms.'
    ],
    shortcuts: 'Use Alt+3 for Hardware workspace'
  },
  plotter: {
    title: 'Oscilloscope & Multi-Channel Serial Plotter',
    shortDesc: 'Visualize numeric serial telemetry as live real-time waveforms with auto-scaling.',
    steps: [
      'Have your microcontroller print numeric values separated by commas, spaces, or key:value pairs (e.g. "24.5, 60.1" or "temp:25 hum:60").',
      'Connect the serial port at your firmware\'s baud rate.',
      'Watch multi-channel colored waveforms render in real-time.',
      'Pause the graph to inspect specific data points or freeze high-frequency signals.'
    ],
    tips: [
      'CSV output (val1, val2, val3) is automatically separated into distinct colored channels.',
      'Keep the Live Terminal Drawer open at the bottom to verify incoming raw numbers.',
      'Hover over waveforms to view exact point values.'
    ],
    shortcuts: 'Use Alt+4 for Telemetry workspace'
  },
  hex: {
    title: 'Hex Stream Inspector',
    shortDesc: 'Live 8-byte and 16-byte hexdump inspector with byte breakdown, ASCII decode, and search.',
    steps: [
      'Connect your device to begin streaming raw UART packets.',
      'Incoming RX bytes appear in cyan; outgoing TX bytes appear in amber.',
      'Hover over any byte to see its offset, hexadecimal, decimal, binary, and ASCII values.',
      'Use the search bar to locate specific hex byte sequences (e.g. 55 AA 01).',
      'Click "HEX" or "C[]" to copy displayed data directly to your clipboard.'
    ],
    tips: [
      'Toggle between 8-byte and 16-byte grid views depending on your screen size.',
      'Click the auto-scroll arrow to follow new incoming bytes automatically.'
    ],
    shortcuts: 'Inspect raw UART byte telemetry'
  },
  packets: {
    title: 'Binary Packet Framer & Protocol Decoder',
    shortDesc: 'Slice raw serial streams into discrete packets using SLIP, COBS, or custom start/end delimiters.',
    steps: [
      'Select your framing protocol (SLIP 0xC0, COBS 0x00, or Custom Delimiters).',
      'Incoming stream is automatically segmented into numbered packet frames.',
      'Inspect frame headers, payload bytes, and CRC integrity.',
      'Export parsed packet buffers for protocol reverse engineering.'
    ],
    tips: [
      'SLIP framing (0xC0 delimiters) is the protocol used by ESP32 ROM bootloader.',
      'COBS eliminates delimiter bytes from the payload with zero overhead.'
    ],
    shortcuts: 'Protocol analysis & packet carving'
  },
  bridge: {
    title: 'MitM Serial Bridge & Bus Sniffer',
    shortDesc: 'Bidirectional bridge between 2 connected USB serial ports with packet logging and delta timing.',
    steps: [
      'Plug in two USB-UART adapters (Board A connected to target, Board B connected to controller).',
      'Connect both ports in the tool.',
      'Toggle the MitM Bridge to "Active".',
      'All bytes received from Port A are forwarded to Port B, and vice versa.',
      'Inspect the bidirectional transaction log with millisecond delta timing.'
    ],
    tips: [
      'Great for sniffing serial communication between proprietary touchscreens and mainboards.',
      'Export the conversation log to analyze command-response patterns.'
    ],
    shortcuts: 'Man-in-the-Middle serial sniffer'
  },
  ubx: {
    title: 'u-blox GPS Configurator (UBX)',
    shortDesc: 'Query and configure u-blox GPS/GNSS modules (NEO-6M, NEO-7M, NEO-8M) using binary UBX protocol.',
    steps: [
      'Connect GPS module UART lines (TX to RX, RX to TX) at 9600 bps.',
      'Click "Query Receiver Info" to fetch hardware model and ROM version.',
      'Select a navigation update rate (1Hz, 5Hz, or 10Hz) and click Apply.',
      'Configure UART port baud rate or toggle specific NMEA output sentences.',
      'Click "Save to BBR/Flash" (UBX-CFG-CFG) to make settings permanent across reboots.'
    ],
    tips: [
      'Default factory baud rate for u-blox modules is 9600 bps.',
      'Increase baud rate to 115200 before configuring 5Hz or 10Hz update rates.'
    ],
    shortcuts: 'u-blox GNSS hardware tuning'
  },
  micropython: {
    title: 'MicroPython On-Chip File Manager',
    shortDesc: 'Explore, upload, download, and manage files on your ESP32 or Raspberry Pi Pico running MicroPython.',
    steps: [
      'Connect your MicroPython board at 115200 bps.',
      'Click "Scan Filesystem" to list root files and directories (`main.py`, `boot.py`, lib).',
      'Click on any script to edit it, or drag and drop files from your PC to upload.',
      'Use the Live Terminal Drawer at the bottom as your interactive Python REPL prompt.'
    ],
    tips: [
      'Press Ctrl+C in the bottom drawer to interrupt a running script and drop into the REPL `>>>`.',
      'MicroPython raw REPL protocol is used to reliably transfer files over the serial connection.'
    ],
    shortcuts: 'Use Alt+5 for Python workspace'
  },
  improv: {
    title: 'Improv Wi-Fi Serial Provisioner',
    shortDesc: 'Configure Wi-Fi credentials on ESP32, ESPHome, and Home Assistant devices via standard Improv protocol.',
    steps: [
      'Connect your ESP32 running Improv-compatible firmware.',
      'Click "Scan for Wi-Fi Networks" to discover nearby access points.',
      'Select your network SSID, enter your Wi-Fi password, and click "Provision".',
      'Watch live provisioning states (Authorized -> Connecting -> Provisioned).',
      'Upon success, the device returns its local IP address and launches your smart home service.'
    ],
    tips: [
      'Standard protocol used by ESPHome, Tasmota, and Home Assistant smart home devices.',
      'Ensure your 2.4GHz Wi-Fi network is available (ESP32 does not support 5GHz).'
    ],
    shortcuts: '1-click smart home Wi-Fi setup'
  },
  telemetry: {
    title: 'Telemetry Dashboard & Gauges',
    shortDesc: 'Speedometer dials, analog indicators, and sensor values parsed from serial key-value pairs.',
    steps: [
      'Have your firmware output key-value telemetry (e.g. "speed:45, volt:12.4, rpm:3200").',
      'The dashboard automatically creates and binds visual dials to detected keys.',
      'Configure high/low warning limits and gauge color schemes.'
    ],
    tips: [
      'Click any gauge to switch between digital numeric readout and analog needle.',
      'Useful for robotics, automotive CAN-to-UART bridges, and weather stations.'
    ],
    shortcuts: 'Analog & digital instrument cluster'
  },
  wardrive: {
    title: 'GPS Wardriver & NMEA Sentence Tracker',
    shortDesc: 'Parse NMEA 0183 GPS sentences ($GPRMC, $GPGGA, $GPGSV), monitor fixes, and log tracks.',
    steps: [
      'Connect your GPS receiver at 9600 bps.',
      'Incoming NMEA sentences are automatically decoded into Latitude, Longitude, Altitude, and Speed.',
      'Monitor satellite constellation lock and Dilution of Precision (DOP).',
      'Click "Export GPX / CSV" to save waypoints for mapping in Google Earth or QGIS.'
    ],
    tips: [
      'GPS receivers require an outdoor view of the open sky to acquire a satellite lock.',
      'A 3D fix requires signals from at least 4 satellites.'
    ],
    shortcuts: 'Geospatial GPS logging'
  },
  alerts: {
    title: 'Crash & Watchdog Alert Monitor',
    shortDesc: 'Detect ESP-IDF Guru Meditation panics, Watchdog resets, and CPU backtraces in real-time.',
    steps: [
      'Keep this monitor active while debugging experimental firmware.',
      'If the target crashes, the alert deck captures register state (PC, EXCVADDR, Backtrace).',
      'Copy the decoded backtrace into `addr2line` or `esp-stack-trace` to identify the faulty code line.',
      'Toggle audio beeps on or off for hands-free lab notifications.'
    ],
    tips: [
      'Guru Meditation "LoadProhibited" or "StoreProhibited" indicates a null pointer dereference.',
      'Watchdog reset indicates a task starved the FreeRTOS idle task without yielding.'
    ],
    shortcuts: 'Automatic firmware crash analysis'
  },
  automation: {
    title: 'Test Runner & Automated Scripting',
    shortDesc: 'Run automated JavaScript test routines with send/expect assertions over UART.',
    steps: [
      'Write or load a test sequence with `send("command")` and `expect("expected response")`.',
      'Click "RUN TEST SUITE" to execute the test script automatically.',
      'Watch live assertion status and timing benchmarks.',
      'Export automated PASS/FAIL test validation reports.'
    ],
    tips: [
      'Ideal for automated factory testing, production flashing validation, and regression suites.',
      'Set custom timeouts for slow bootup operations.'
    ],
    shortcuts: 'Automated QA testing'
  },
  autopsy: {
    title: 'USB Recon & Mystery Chip Autopsy',
    shortDesc: 'Inspect USB descriptors, endpoint configurations, and probe mystery chips or disposable vapes.',
    steps: [
      'Plug in any unknown USB hardware.',
      'Click "Read Device Descriptors" to view VID, PID, manufacturer strings, and endpoints.',
      'Test manufacturer bootloader handshakes to identify hidden flash modes.',
      'Run the automated baud rate scanner to listen for debug printouts.'
    ],
    tips: [
      'Many disposable devices use inexpensive WCH CH32V, Puya, or Geehy microcontrollers.',
      'Check endpoint 0x81 (IN) and 0x02 (OUT) for CDC serial communication.'
    ],
    shortcuts: 'Hardware reverse-engineering'
  },
  'esp-dump': {
    title: 'Silicon Memory Dump & eFuse Inspector',
    shortDesc: 'Low-level inspector for reading ESP32 eFuse security registers, MAC address, and raw SPI flash.',
    steps: [
      'Connect your ESP32 and enter ROM bootloader mode.',
      'Click "Read eFuse Table" to inspect Secure Boot, Flash Encryption, and Chip Revision.',
      'Specify a start memory address and length (e.g. 0x1000, 4KB) to dump raw flash bytes to file.'
    ],
    tips: [
      'eFuse values are burned irreversibly into silicon. This tool only reads their state safely.',
      'Use flash hexdump to inspect partition tables and NVS encryption keys.'
    ],
    shortcuts: 'Silicon hardware introspection'
  },
  setup: {
    title: 'Linux Permissions & Bridge Drivers Setup',
    shortDesc: 'Troubleshooting guide for Linux dialout groups, udev rules, and USB-to-UART bridge drivers.',
    steps: [
      'If you encounter "Permission Denied" on Linux, copy the `sudo usermod -a -G dialout $USER` command.',
      'Alternatively, apply the universal `udev` rule to grant read/write access without logging out.',
      'On Windows, download the matching driver for your bridge chip (CH340, CP2102, FTDI, PL2303).',
      'Review the troubleshooting checklist for capacitor issues and port locks.'
    ],
    tips: [
      'Only one application can open a COM port at a time. Close Arduino IDE or Cura if the port is busy.',
      'Use Chrome, Edge, or Opera for native Web Serial API support.'
    ],
    shortcuts: 'Use Alt+6 for Setup workspace'
  },
  ch341a: {
    title: 'CH341A USB SPI/I2C BIOS & Flash Programmer',
    shortDesc: 'Directly unbrick motherboards, GPUs, and routers by reading and writing 24/25 series SPI NOR Flash.',
    steps: [
      'Set the physical jumper on your CH341A programmer to pins 2-3 (Parallel / SPI mode).',
      'Click "CONNECT CH341A (WEBUSB)" or select "DEMO SIMULATION" to test.',
      'Click "READ JEDEC ID" to auto-detect your Winbond, Macronix, or GigaDevice flash chip.',
      'Click "DUMP FLASH" to read memory directly into the interactive browser Hex Viewer.',
      'Load a replacement BIOS image (.bin) and click "WRITE BUFFER TO FLASH" to program and verify.'
    ],
    tips: [
      'Ensure the chip pin 1 (marked with a small circle dot) matches pin 1 on the ZIF socket or SOIC8 test clip.',
      'Always save a backup dump of the original chip before erasing or writing.',
      '3.3V vs 5V: Standard CH341A black boards output 5V on data lines unless modified with a 3.3V LDO fix.'
    ],
    shortcuts: 'BIOS & SPI Flash unbricker'
  },
  'cmsis-dap': {
    title: 'CMSIS-DAP / ARM Cortex-M SWD Debugger',
    shortDesc: 'Low-level in-system debugger for ARM Cortex-M microcontrollers (STM32, RP2040, nRF52, micro:bit).',
    steps: [
      'Connect your CMSIS-DAP probe (Raspberry Pi Pico Probe, DAPLink, or ST-Link) to the target SWDIO/SWCLK pins.',
      'Click "CONNECT DAP PROBE (WEBHID)" or choose "VIRTUAL TARGET DEMO".',
      'Click "HALT CPU" to freeze target execution into debug mode.',
      'Inspect core registers (R0-R15, SP, PC, xPSR) with live change diff highlighting.',
      'Use "STEP" to single-step instructions, or edit 32-bit SRAM values directly in the memory table.'
    ],
    tips: [
      'Address 0x20000000 is the standard base address for SRAM on almost all Cortex-M devices.',
      'Flash memory begins at 0x08000000 on STM32 or 0x10000000 on RP2040.',
      'The DHCSR register allows non-intrusive memory inspection while the core is running.'
    ],
    shortcuts: 'ARM CoreSight SWD debugging'
  },
  'can-bus': {
    title: 'Automotive CAN Bus & OBD-II Diagnostic Deck',
    shortDesc: 'Sniff CAN bus packets with live byte diffing, send custom arbitration frames, and read OBD-II PIDs.',
    steps: [
      'Connect your USB-CAN adapter (CANable / Candlelight / SLCAN) or ELM327 OBD-II interface.',
      'Select your bus baud rate (standard automotive high-speed is 500 kbps, low-speed is 125 kbps).',
      'Click "START SNIFFER" to monitor real-time arbitration IDs and 8-byte payloads.',
      'Bytes that change value automatically flash in bright amber so you can easily identify signals.',
      'Switch to "OBD-II Scanner" to read Engine RPM, vehicle speed, and check engine trouble codes.'
    ],
    tips: [
      'CAN Bus requires a 120-ohm termination resistor at both physical ends of the twisted pair (CAN_H and CAN_L).',
      'Use the filter input box to isolate specific ECU IDs (e.g. 0x1DC for engine or 0x205 for wheel speed).'
    ],
    shortcuts: 'CAN packet sniffer & OBD-II scanner'
  },
  'logic-analyzer': {
    title: '24MHz 8-Channel USB Logic Analyzer',
    shortDesc: 'Capture digital waveforms up to 24MS/s over WebUSB with interactive zoom, timeline cursors, and protocol decoders.',
    steps: [
      'Connect your $5 Saleae / USBee FX2LP 8-channel logic analyzer via USB.',
      'Select your sample rate (1 MHz to 24 MHz) and sample depth (10k to 100k samples).',
      'Click "CAPTURE SIGNAL" to acquire digital levels across channels D0–D7.',
      'Use the zoom buttons and timeline pan slider to navigate high-frequency transitions.',
      'View automatic I2C and UART protocol decoder bubbles rendered directly below the waveforms.'
    ],
    tips: [
      'Nyquist rule: Your sample rate should be at least 4x to 5x higher than the highest signal frequency (e.g. use 4MHz+ for 400kHz I2C).',
      'Move cursors A and B to measure precise time differences (ΔT) and calculated frequency (1/ΔT).'
    ],
    shortcuts: 'Digital waveform analysis & decoding'
  },
  'usb-pd': {
    title: 'USB-PD Power Delivery Analyzer & Variable Voltage Trigger',
    shortDesc: 'Negotiate Power Delivery 3.0 / PPS contracts (5V, 9V, 12V, 15V, 20V) and measure real-time VBUS power & energy.',
    steps: [
      'Connect your USB-PD trigger dongle (CH224K, Power-Z, or RP2040) to a USB-C power adapter.',
      'Click "CONNECT USB-PD DONGLE" or select "DEMO SIMULATION".',
      'Click on any fixed PDO contract (e.g. 9V, 12V, 15V, 20V) to negotiate VBUS voltage.',
      'Enable "PPS Variable Mode" to dial voltage between 3.3V and 21.0V in 100mV steps.',
      'Monitor live VBUS voltage, load current, wattage, connector temp, and cumulative mAh/mWh.'
    ],
    tips: [
      'Always verify target component voltage tolerance before negotiating 12V or 20V.',
      'To unlock 100W (20V @ 5A) or 240W EPR, use an E-Marked 5A rated USB-C cable.',
      'Click the reset icon next to Capacity to zero out accumulated mAh when testing batteries.'
    ],
    shortcuts: 'USB-PD trigger & VBUS analyzer'
  },
  'bus-explorer': {
    title: 'I2C & SPI Multi-Protocol Bus Explorer & Sensor Identifier',
    shortDesc: '1-click I2C bus scanner (0x08 - 0x77), automatic chip identification, and interactive live register read/write.',
    steps: [
      'Connect your I2C/SPI adapter (Bus Pirate, FT232H, or microcontroller bridge) to the target sensor.',
      'Click "CONNECT BUS EXPLORER" or start in demo simulation mode.',
      'Click "SCAN I2C BUS (7-BIT SWEEP)" to scan addresses from 0x08 to 0x77.',
      'Click any green detected address in the hex matrix to view its chip name and specs.',
      'Inspect the live 32-byte register table or enter a register address to write values.'
    ],
    tips: [
      'I2C requires 4.7kΩ pull-up resistors on both SDA and SCL lines to 3.3V.',
      'Address 0x68 is commonly shared between MPU-6050 and DS3231 RTCs.',
      'Click "REFRESH REGISTERS" to re-read volatile accelerometer and sensor registers.'
    ],
    shortcuts: 'I2C/SPI bus scanner & register inspector'
  },
  'jtag-programmer': {
    title: 'JTAG Boundary Scanner & SVF / CPLD Bitstream Player',
    shortDesc: 'Scan JTAG TAP chains, identify FPGA/CPLD IDCODEs, sample pin boundary states, and execute .svf bitstreams.',
    steps: [
      'Connect your JTAG programmer (FT2232H, ESP32-S3 JTAG, or Pico) to TMS, TCK, TDI, and TDO.',
      'Click "CONNECT JTAG" or choose "FT2232H DEMO".',
      'Click "SCAN JTAG CHAIN" to shift 32 bits into the DR register and read the hardware IDCODE.',
      'Load or paste a .svf bitstream script and click "EXECUTE SVF SEQUENCE" to program your FPGA or CPLD.',
      'Review the boundary scan matrix to inspect physical I/O pin levels across the chip.'
    ],
    tips: [
      'Keep JTAG wire leads under 15cm (6 inches) to prevent signal ringing at 10MHz+ TCK.',
      'If chain scan returns 0x00000000 or 0xFFFFFFFF, check TDO and TDI continuity.',
      'SVF player verifies expected TDO responses against the mask after each SDR shift.'
    ],
    shortcuts: 'JTAG chain scan & SVF player'
  },
  'modbus-rtu': {
    title: 'Industrial Modbus RTU & RS-485 Field Deck',
    shortDesc: 'Poll Coils, Inputs, and Holding Registers from PLCs, solar inverters, and energy meters over USB-RS485 adapters.',
    steps: [
      'Connect your USB-to-RS485 adapter (A+ and B-) to the target industrial instrument.',
      'Set the target device Slave ID (1–247) and baud rate (standard is 9600 bps, 8-N-1).',
      'Click "CONNECT RS-485" or start the virtual solar inverter demo.',
      'Click "POLL ONCE" or click "START AUTO-POLL" to read holding registers 40001–40008.',
      'View auto-scaled physical units (Voltage, Current, Active Power, Grid Frequency, Yield kWh).',
      'Use the Write Register bar to adjust setpoints or configuration parameters.'
    ],
    tips: [
      'RS-485 requires a 120Ω termination resistor between A+ and B- at both bus endpoints.',
      'If you receive timeout errors, try swapping the A+ and B- differential wires.',
      'All frames automatically calculate and append a 16-bit CRC checksum.'
    ],
    shortcuts: 'Modbus RTU & RS-485 field deck'
  },
  'avr-isp': {
    title: 'AVR & Microchip UPDI / ISP Bootloader & Fuse Programmer',
    shortDesc: 'Recover bricked Arduino Uno/Mega/Nano boards, burn Optiboot bootloader, and configure clock/BOD fuses.',
    steps: [
      'Connect your ISP programmer (USBasp or Arduino as ISP) to the 6-pin ICSP header.',
      'Click "CONNECT AVR ISP" to read the 3-byte chip signature (e.g. 0x1E950F for ATmega328P).',
      'Inspect the active LFUSE, HFUSE, EFUSE, and Lock bits.',
      'Edit fuse hex values to change clock source (16MHz crystal vs internal 8MHz RC) or BOD level.',
      'Click "BURN OPTIBOOT BOOTLOADER" to restore an unprogrammed or corrupted chip in 2 seconds.'
    ],
    tips: [
      'WARNING: Never disable the RSTDISBL fuse (Reset Pin Disable) unless using a High-Voltage programmer.',
      'Optiboot bootloader operates at 115200 bps and takes only 512 bytes of flash memory.',
      'Ensure the target board is powered with 5V or 3.3V during ISP programming.'
    ],
    shortcuts: 'AVR ISP bootloader & fuse editor'
  },
  'rfid-nfc': {
    title: 'RFID / NFC Badge Deck & Proxmark3 Companion',
    shortDesc: 'Read, decode, and clone 125kHz LF badges (EM4100, HID Prox) and 13.56MHz NFC smart cards (Mifare Classic 1K, NTAG215).',
    steps: [
      'Connect your Proxmark3 or USB CCID contactless smart card reader.',
      'Select carrier band: "125 kHz (LF)" for access keyfobs or "13.56 MHz (HF)" for NFC cards.',
      'Click "SCAN PROXIMITY CARD" to interrogate the RF field.',
      'View decoded UID, chip technology, and HID Wiegand Facility Code / Card Number.',
      'For 125kHz badges, click "CLONE BADGE TO T5577" to write into a rewritable transponder.',
      'For 13.56MHz cards, inspect all 16 memory sectors with Key A/B and access bits.'
    ],
    tips: [
      'T5577 chips can emulate EM4100, HID Prox, and Indala badges on the same hardware.',
      'Standard factory Mifare Classic 1K keys are typically 0xFFFFFFFFFFFF or 0xA0A1A2A3A4A5.',
      'Keep cards parallel to the antenna at a distance of 1–3cm for clean resonance.'
    ],
    shortcuts: 'RFID & NFC badge cloner'
  },
  'mayhem': {
    title: 'PortaPack Mayhem & HackRF One Suite',
    shortDesc: 'Control HackRF One + PortaPack Mayhem firmware over Web Serial, manage FREQMAN database, inspect raw C16 IQ captures, and navigate virtual 320x240 LCD display.',
    steps: [
      'Connect HackRF One with PortaPack H1/H2/H2+/H3/H4 attached via USB.',
      'Click "CONNECT WEB SERIAL (PORTAPACK)" (or test the rich built-in simulation).',
      'Use the on-screen D-Pad and Rotary Jog Dial to navigate the 320x240 LCD display and launch apps (ADS-B, Audio RX, Capture, Sub-GHz).',
      'Use the "RF Tuner & Gains" tab to adjust Frequency (1MHz–6GHz), LNA Gain (0–40dB), VGA Gain (0–62dB), and toggle the +14dB RF amplifier.',
      'In the "FREQMAN" tab, browse standard presets, add custom frequencies, tune in 1-click, and export FREQMAN.TXT directly to your MicroSD card.',
      'Drag and drop raw .C16 files into the IQ Inspector to verify sample rate, center frequency, duration, and FFT power spectrum.'
    ],
    tips: [
      'To enter DFU mode for firmware flashing, click the "DFU" button or hold the DFU button while plugging in USB.',
      'PortaPack Mayhem serial CLI communicates at 115,200 baud, 8-N-1.',
      'Format MicroSD cards as FAT32 (32KB clusters) for maximum C16 capture write speeds.',
      'Turn off the +14dB RF amp when receiving strong local signals to prevent front-end saturation.'
    ],
    shortcuts: 'PortaPack Mayhem & HackRF Suite'
  }
};

export default function ToolGuide({ toolId }) {
  // Always default to collapsed (false) so instructions are hidden in a dropdown until the user explicitly clicks it
  const [isOpen, setIsOpen] = useState(false);

  // Automatically collapse when navigating between tools so the workspace remains clean
  useEffect(() => {
    setIsOpen(false);
  }, [toolId]);

  const guide = TOOL_GUIDES[toolId] || TOOL_GUIDES.flasher;

  const handleToggle = () => {
    setIsOpen(prev => !prev);
  };

  return (
    <div className="mb-3 font-mono text-xs select-none">
      <div
        className={`border rounded-xl transition-all duration-200 overflow-hidden shadow-lg ${
          isOpen 
            ? 'bg-[#040818] border-cyan-500/40 shadow-cyan-glow' 
            : 'bg-[#030712]/90 border-slate-800 hover:border-slate-700'
        }`}
      >
        {/* Dropdown Header Bar */}
        <div
          onClick={handleToggle}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggle(); }}
          className="px-3.5 py-2.5 flex items-center justify-between gap-3 cursor-pointer select-none transition-colors hover:bg-slate-900/50"
        >
          <div className="flex items-center gap-2.5 truncate flex-1">
            <div className={`p-1 rounded-lg border shrink-0 ${
              isOpen ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' : 'bg-slate-900 text-amber-400 border-slate-800'
            }`}>
              <Lightbulb className="w-4 h-4" />
            </div>

            <div className="flex flex-wrap items-center gap-2 truncate">
              <span className="font-bold text-slate-200 tracking-wider text-xs flex items-center gap-1.5">
                <span>HOW TO USE:</span>
                <span className="text-cyan-400 font-bold">{guide.title.toUpperCase()}</span>
              </span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="text-[11px] text-slate-400 truncate hidden md:inline">
                {guide.shortDesc}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5 ${
              isOpen 
                ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' 
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-cyan-500/40 hover:text-cyan-300'
            }`}>
              <span>{isOpen ? 'HIDE GUIDE' : 'HOW TO USE (CLICK TO EXPAND)'}</span>
              {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </span>
          </div>
        </div>

        {/* Expanded Guide Content */}
        {isOpen && (
          <div className="p-3.5 sm:p-4 border-t border-slate-900 bg-[#020510] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
            {/* Column 1: Step-by-Step Instructions */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-850 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-cyan-400 font-bold text-xs pb-1 border-b border-slate-850">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>STEP-BY-STEP WORKFLOW</span>
              </div>
              <ol className="space-y-1.5 text-[11px] text-slate-300 list-decimal list-inside leading-relaxed">
                {guide.steps.map((step, idx) => (
                  <li key={idx} className="pl-1">
                    <span className="text-slate-300">{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Column 2: Pro Tips & Gotchas */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-850 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold text-xs pb-1 border-b border-slate-850">
                <Sparkles className="w-3.5 h-3.5" />
                <span>PRO TIPS & TROUBLESHOOTING</span>
              </div>
              <ul className="space-y-1.5 text-[11px] text-slate-300 list-disc list-inside leading-relaxed">
                {guide.tips.map((tip, idx) => (
                  <li key={idx} className="pl-1 text-slate-300">
                    <span>{tip}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Column 3: Quick Summary & Keybinds */}
            <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-850 flex flex-col justify-between gap-2.5 md:col-span-2 lg:col-span-1">
              <div>
                <div className="flex items-center gap-1.5 text-emerald-400 font-bold text-xs pb-1 border-b border-slate-850">
                  <Info className="w-3.5 h-3.5" />
                  <span>OVERVIEW & SHORTCUTS</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
                  {guide.shortDesc}
                </p>
              </div>

              {guide.shortcuts && (
                <div className="bg-slate-900/90 p-2 rounded-lg border border-slate-800 text-[10px] text-slate-400 flex items-center justify-between">
                  <span className="font-bold text-slate-300">Shortcut:</span>
                  <span className="text-cyan-400 font-bold">{guide.shortcuts}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
