# Audit: Flash & Program, Buses & Instruments

Scope: `flasher`, `dfu`, `programmers` (CH341A, CMSIS-DAP, JTAG, AVR ISP), `esp-dump`, `logic-analyzer`, `bus-explorer`, `can-bus`, `usbtmc`.
Method: read each component and its driver/util (working tree on `main`), compared with the reference tools from knowledge. No code was changed.

Legend: Effort S/M/L, Value H/M/L. "Feasible" is judged inside this architecture: static browser app, WebSerial / WebUSB / WebHID, WASM, plus the Worker `/api/*` relay. Anything needing raw sockets, kernel drivers or proprietary host libraries is marked "no".

Cross-cutting limits for every USB tool here:
- WebUSB cannot claim an interface that has an OS driver bound (Windows: needs WinUSB via Zadig/libwdi; Linux: udev rule). Vendor drivers (NI-VISA, Keysight IO Libraries, ST-Link/J-Link, FTDI VCP) block WebUSB.
- A browser has no raw TCP/UDP: VXI-11, HiSLIP, raw-socket SCPI, OpenOCD/GDB servers are impossible without a native bridge. The Worker relay is HTTP only.
- WebUSB blocks some classes (HID, mass storage, audio, video) from `requestDevice`. DFU, USBTMC and vendor-class devices are allowed. HID probes use WebHID.

---

## 1. `flasher` (`tabs/FlasherTab.jsx`, `utils/espLoader.js`, `utils/firmwareParser.js`, `src/flasher/*`)

### Does today
- Multi-slot (1-4) image flasher with absolute offsets, partition presets (`partitionPresets.js`), .bin / Intel HEX / UF2 loading, cloud firmware catalog (`CloudFirmwareCatalog.jsx`).
- Mode `esp-rom`: own SLIP/ROM client (`EspBootloaderClient`): DTR/RTS reset into bootloader, SYNC, chip detect by magic register, SPI_ATTACH, SPI_SET_PARAMS (hard-coded 16 MB), uncompressed FLASH_BEGIN/DATA (1 KB blocks), SPI_FLASH_MD5 verify afterwards (not ESP8266), abort, borrows the terminal's port. ROM only, no stub.
- Mode `raw-stream`: sends raw bytes to the open UART with a delay (no bootloader protocol).
- `src/flasher/WebFlashService.ts`: manifest + SHA-256 validated flashing for Proxmark targets; WebUSB-DFU path implemented, `webserial-bootloader` path throws `NotImplementedError`.

### Reference tools
esptool.py, esptool-js, ESP Web Tools (manifest install), `idf.py flash`.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Baud change (ROM CHANGE_BAUDRATE 0x0F, reopen port at 460800-921600). Everything runs at 115200, so 1 MB takes minutes | Yes, WebSerial can reopen at a new rate; must go through `borrowPort` | M | H |
| Compressed write: FLASH_DEFL_BEGIN/DATA/END are declared in `ESP_CMD` but unused (needs zlib in JS) | Yes | M | H |
| Flash size/ID detect: SPI_SET_PARAMS hard-codes 16 MB, so over-size images are not rejected; no JEDEC read; no header size patch | Yes (SPI register pokes per chip, as esptool does) | M | M |
| Stub loader (MEM_BEGIN/DATA/END) for erase, read, fast write on S2/S3/C3/C6 | Yes; reusing esptool-js is cheaper than porting | L | H |
| Erase flash / region (stub-only opcodes) | Yes with stub | M | M |
| Wider chip coverage (C5/C6/H2/P4 magic values and quirks) | Yes, needs real boards to verify | M | M |
| ESP Web Tools style one-click manifest install | Yes | M | L (catalog covers it) |
| Real SHA-256 for built-in Proxmark manifests (see Bugs) and a SAM-BA serial write path | Yes in principle, needs hardware validation | L | L |
| `raw-stream` mode semantics (reports success with no ack) | n/a | S | L |
| UF2 copy to a mounted RP2040/others drive | WebUSB no (mass storage blocked); File System Access API write to the mounted drive yes | S | M |
| J-Link / ST-Link / WCH-Link flashing | No (proprietary protocols) | - | - |

---

## 2. `dfu` (`tools/DfuFlasher.jsx`, `utils/dfuDriver.js`)

### Does today
- WebUSB DFU 1.1 + ST DfuSe download. Discovers the class 0xFE/sub 0x01 interface, reads the functional descriptor (transfer size, bcdDFU, attributes), parses `.dfu` suffix (CRC32 plus VID/PID cross-check) and DfuSe container (targets, elements), set-address / erase-page / mass-erase, block download, manifest phase tolerant of device reset. Tests in `tests/dfuDriver.test.js`.
- Raw `.bin` to DfuSe needs a typed target address and erase page size (defaults 0x08000000 / 2048).

### Reference tools
dfu-util (`-a`, `-s addr:leave`, `-U` upload, `-e` detach, `-l`), STM32CubeProgrammer (DFU), WebDFU/dfu.js.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Parse the DfuSe memory layout from the alt-setting string (`@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg`, available as `alt.interfaceName`). One fixed `erasePageSize` is wrong on STM32F2/F4/F7/H7 (variable sectors) | Yes | M | H |
| Alt-setting selection (Internal Flash / Option Bytes / OTP / external). `discoverDfuInterface` returns only the first DFU alt | Yes | S | H |
| Upload / read-out (DFU_UPLOAD is declared, unused): backup and verify-after-write | Yes (not on read-protected parts, same as dfu-util) | M | H |
| DFU_DETACH from runtime mode and re-pick the re-enumerated device | Yes (needs a user gesture to re-grant if the PID changes) | M | M |
| Explicit `:leave` (jump to app), option-bytes write (RDP) | Yes | S | M |
| `.hex` / `.elf` input for DfuSe (reuse `parseIntelHex`) | Yes | S | M |
| Filter lists runtime-mode devices (protocol 1) that cannot download | Yes | S | M |
| Windows WinUSB hint for "STM32 BOOTLOADER" | Docs only | S | L |

---

## 3. `programmers` suite (`tools/HardwareProgrammersSuite.jsx`, tabs `ch341a`, `cmsis-dap`, `jtag-programmer`, `avr-isp`)

### 3a. CH341A (`Ch341aProgrammer.jsx`, `utils/ch341aDriver.js`)

**Does today:** WebUSB CH341A in SPI mode. JEDEC ID plus SFDP fallback, 40-chip database (unknown chips guessed from capacity byte), 3- and 4-byte addressing, status register read and block-protect clear, read, smart write (per 4 KB sector: skip if equal, erase only on 0->1, program only changed pages, read-back verify), chip erase (240 s timeout), file-vs-chip and file-vs-buffer diff, 24Cxx I2C EEPROM read/write (24C01..24CM02). Close to AsProgrammer/flashrom parity for 25xx.

**Reference:** flashrom `-p ch341a_spi`, AsProgrammer, NeoProgrammer.

| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Microwire 93Cxx, SPI NAND, 25xx EEPROM, 95xxx | Partial (93Cxx via SPI bit-bang; NAND needs ECC/bad-block layer) | L | L |
| Larger flash DB (page size, 64K block erase, erase times); unknown chips fall back to 4 KB sectors | Yes | M | M |
| 64 KB block erase (D8h) for big writes instead of looping 4 KB sectors | Yes | S | M |
| Dump checksum report and hex preview | Yes | S | M |
| File picker accepts `.hex`: confirm it is parsed, not written raw (Bugs #11) | Yes | S | M |
| SPI speed control; 1.8 V chips | Hardware-limited / needs adapter | - | - |

### 3b. CMSIS-DAP (`CmsisDapDebugger.jsx`, `cmsis/DebugFeaturesPanel.jsx`, `utils/cmsisDapDriver.js`, `dapLink.js`, `cortexDebug.js`)

**Does today:** CMSIS-DAP v1 (WebHID) and v2 (WebUSB bulk). SWD connect, DPIDR/CPUID/core name, halt/resume/step/reset (reset-halt), core register read/write, memory read/write, hex dump to file, FPB hardware breakpoints and DWT watchpoints, SEGGER RTT (control block search, polling), SWO/ITM text via UART capture, CMSIS-Pack flash programming (parses `.pack` zip + `.pdsc` and `.FLM`, runs the algorithm in target RAM: erase chip/sector, program, verify; images .bin/.hex/.elf/.axf). Tests: `cortexDebug.test.js`, `dapProbe.test.js`. Already pyOCD-class for Cortex-M.

**Reference:** pyOCD, OpenOCD, probe-rs, STM32CubeProgrammer, Keil/IAR.

| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Connect under reset (nRST via DAP_SWJ_PINS, already wrapped in `dapLink.js`), mass erase / unlock for locked parts (CTRL-AP ERASEALL on nRF52, RDP regression on STM32) | Yes | M | H |
| SVD peripheral register viewer (from pack `.svd`) with bitfield decode and live read/write | Yes (pure JS XML) | M | H |
| ELF symbols: names for PC/LR/breakpoints, `_SEGGER_RTT` lookup (`parseElf` exists) | Yes | M | M |
| Cache packs/algorithms (IndexedDB); device-to-FLM catalog like pyOCD's cmsis-pack-manager | Cache yes; Keil pack index is not CORS-open, so a catalog needs an allow-listed Worker proxy | M | M |
| Multi-drop SWD (TARGETSEL, RP2040/RP2350 dual core), dormant-to-SWD, multiple APs | Yes | M | M |
| JTAG-DP transport for ARM (JTAG tab has its own engine, never speaks ARM JTAG-DP) | Yes | L | L |
| RISC-V debug module, Cortex-A, ETM trace | RISC-V DM partly; ETM/parallel trace no (probe hardware) | L | L |
| GDB remote stub / OpenOCD server | No (no sockets) | - | - |
| ST-Link / J-Link probes | No (proprietary / driver conflict) | - | - |

### 3c. JTAG (`JtagWorkbench.jsx`, `utils/jtagDriver.js`)

**Does today:** CMSIS-DAP-class probe used as raw JTAG. TAP state machine and TMS path generator, chain scan by IDCODE with device DB and manufacturer decode, probe pin read, SVF player (`runSvf`: SIR/SDR/STATE/RUNTEST/FREQUENCY/TRST/ENDDR/ENDIR, progress), boundary-scan SAMPLE and EXTEST (user supplies IR lengths, opcodes, BSR length), TAP reset.

**Reference:** OpenOCD (`jtag newtap`, `svf`, `xsvf`), UrJTAG (BSDL), openFPGALoader, Vivado/Quartus programmers.

| Gap | Feasible | Effort | Value |
|---|---|---|---|
| BSDL import to auto-fill IR length, BSR length, opcodes and pin map (user types these today) | Yes (regex subset parser) | M | H |
| XSVF player; direct bitstream programming (Xilinx `.bit`, Lattice) like openFPGALoader | XSVF yes; vendor flows need hardware validation | L | M |
| Arbitrary IR/DR shift console (`irscan`/`drscan`) if not already exposed | Yes | S | M |
| FTDI FT232H/FT2232 MPSSE probes (very common and cheap) | Yes via WebUSB (WinUSB on Windows), new driver | L | M |
| Larger device DB | Yes | M | L |

### 3d. AVR ISP (`AvrIspWorkbench.jsx`, `utils/avrIspDriver.js`)

**Does today:** STK500v1 over Web Serial at 19200 baud (ArduinoISP or any STK500v1 programmer). Sync, version, signature read, chip DB (13 AVRs), LFUSE/HFUSE/EFUSE/lock read/write with hazard warnings (RSTDISBL/SPIEN/DWEN) and read-back, chip erase, paged flash write with per-page read-back verify, burn bootloader (erase, default fuses, flash, lock). Test: `tests/avrIsp.test.js`.

**Reference:** avrdude (`-c arduino|stk500v1|usbasp|usbtiny|avrisp2|jtag2updi`), Arduino IDE "Burn Bootloader", Microchip Studio, PlatformIO.

| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Flash read / dump to `.hex`/`.bin` (`readPage` is used only for verify) and verify-against-file | Yes | S | H |
| EEPROM read/write; EESAVE awareness (chip erase before flash wipes EEPROM) | Yes (paged EEPROM via STK500) | S | H |
| Direct sketch upload to Arduino bootloaders (optiboot STK500v1 = avrdude `-c arduino`, AVR109 for Leonardo/Micro, STK500v2 for Mega) | Yes (same Web Serial path, DTR reset, different params) | M | H |
| Chip DB only 13 parts (no ATtiny85/84/13, ATmega2560, 32U4...) | Yes (extract from avrdude.conf) | M | M |
| USBasp / USBtiny / AVRISP mkII over WebUSB | Yes (vendor-class; WinUSB on Windows) | L | M |
| UPDI (tinyAVR 0/1/2, AVR Dx) via serial break and half-duplex | Yes with a single-wire adapter; timing risky in a browser | L | M |
| Fuse bit-level editor with names and clock presets | Yes | M | M |
| TPI / PDI | Yes in theory | L | L |
| debugWIRE / JTAG ICE | No (proprietary) | - | - |

---

## 4. `esp-dump` (`EspMemoryInspector.jsx`, `utils/espMemoryTool.js`, `utils/espFlashDump.js`)

### Does today
- "Read chip eFuses": own ROM client, chip family plus MAC for ESP32, S3, C3 (hard-coded eFuse addresses; other chips show "not readable").
- Dump flash range: loads **esptool-js 0.7.0 from `https://unpkg.com/esptool-js@0.7.0/bundle.js` at runtime** (`espFlashDump.js`, `/* @vite-ignore */`), requests its own port, uploads the stub, `readFlash`, resets, downloads a `.bin`. Presets: bootloader, partition table, NVS, "Full 4MB". Baud fixed at 115200.
- `espMemoryTool.js::dumpFlashRange` (ROM READ_FLASH_SLOW) is no longer called by the UI.

### Reference tools
esptool.py (`read_flash`, `flash_id`, `chip_id`, `read_mac`, `get_security_info`, `verify_flash`), espefuse.py, `gen_esp32part.py` / parttool.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Runtime CDN dependency (unpkg): no SRI, not in the lockfile, breaks offline or under strict CSP; duplicated in `workbenches/piglet/warhogFlash.js`. Vendor `esptool-js` as an npm dependency (lazy chunk) | Yes | S | H |
| Baud fixed at 115200 (a 4 MB dump takes minutes); esptool-js can switch after the stub is up | Yes | S | H |
| Flash size/ID, chip features, crystal, security info (secure boot / flash encryption flags). "Full 4MB" is hard-coded and wrong for 2/8/16 MB parts | Yes (esptool-js `main()` / flash-id helpers) | M | H |
| Partition table parser and one-click dump per partition (fixed presets only match the default layout) | Yes | M | H |
| Verify (MD5), erase, write via stub | Yes | M | M (overlaps `flasher`) |
| Full eFuse summary (read-only); burning | Read-only yes (per-chip maps are large); burning no (dangerous) | L | M |
| NVS page parser so credential partitions are readable | Yes | M | M |
| MAC for C6/H2/S2/C2/C5 | Yes (esptool-js already supports them) | S | M |
| Dead code `dumpFlashRange`; `alert()` in the dump flow | n/a | S | L |

---

## 5. `logic-analyzer` (`tools/LogicAnalyzerWorkbench.jsx`, `utils/logicAnalyzerDriver.js`, `utils/logicDecoders.js`)

### Does today
- Hardware: SUMP/OLS over Web Serial (single 8-ch group, `FLAGS 0x38`, divider-based rate, up to 262144 samples, 8-bit mask/value level trigger); fx2lafw over WebUSB with firmware upload from a user-supplied `.fw`/`.hex` (Saleae clones, USBee, "24 MHz 8CH"): 20 kHz-24 MHz, fixed-depth bulk capture.
- Viewer: canvas waveform with zoom/pan, two cursors with delta/frequency, per-channel measurements, software trigger search (rising/falling/pattern/pulse width), channel names.
- Decoders (JS): UART (baud, bits, parity, stop, invert, MSB), I2C (transactions, device names), SPI (modes, word size), 1-Wire (ROM functions/families), CAN, WS2812, IR NEC/RC5, SWD; baud estimator.
- Import/export: VCD import/export, sigrok `.sr` import/export, decoded CSV. Tests: `logicDecoders.test.js`, `logicCapture.test.js`.
- Dead code: `logicAnalyzerDriver.js::decodeUart/decodeI2C/generateSyntheticSignalBuffer` (unused anywhere in src or tests).

### Reference tools
sigrok/PulseView (libsigrokdecode, stackable decoders), Saleae Logic 2 (analog, HLAs), sigrok-pico, DSView/DSLogic, OLS client.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| SUMP: use device metadata (`parseSumpMetadata`): 16/32 channels, real sample memory, RLE, pre-trigger (read/delay split), edge and multi-stage triggers. Today group 0 only and one level-trigger stage | Yes | M | H |
| fx2lafw 16-channel wide mode; continuous streaming beyond the capture size | Wide yes; streaming is memory-bound | M | M |
| Pre-trigger view | Yes in software for continuous modes | M | M |
| Decoder stacking (SPI -> SPI-flash, I2C -> EEPROM/IMU, UART -> NMEA, CAN -> UDS/J1939) | Yes (pure JS) | M | H |
| More decoders (I2S, JTAG, LIN, MIDI, DMX512, Manchester, USB LS/FS, I3C...). Pyodide + real libsigrokdecode is possible but ~10 MB; port the most used in JS | JS yes; Pyodide yes but heavy | M each | M |
| sigrok-pico (documented serial protocol) | Yes | M | M |
| Saleae Logic 8/Pro, DSLogic, analog channels | No (closed protocols / FPGA bitstreams) | - | - |
| Session save/load (capture + config) | Yes | S | M |
| Remove dead code | n/a | S | L |
| Rates above ~24 MHz or real hardware trigger on generic FX2 | No (device limits) | - | - |

---

## 6. `bus-explorer` (`tools/BusExplorerWorkbench.jsx`, `utils/busExplorerDriver.js`)

### Does today
- Bus Pirate **v3/v4 binary mode (BBIO)** over Web Serial at 115200: enter BBIO, raw I2C or raw SPI, power and pull-up control, I2C speed (5/50/100/400 kHz), SPI speed (30 kHz-8 MHz), I2C 7-bit scan with a ~28-entry chip database, register read/write, raw I2C write/read, SPI full-duplex transfer, SPI flash JEDEC ID and 0x03 sequential read. No simulation; real hardware only.

### Reference tools
Bus Pirate 5/6 (BPIO2 + text terminal), pyBusPirate, flashrom `-p buspirate_spi`, i2c-tools, Total Phase Aardvark/Beagle.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| **Bus Pirate 5 / 6** (current hardware; v3/v4 discontinued). BP5 uses BPIO2 (FlatBuffers over a second CDC port) plus a text terminal; BBIO is not available | Yes (Web Serial; hand-encode the small FlatBuffers command set) | L | H |
| More modes: UART bridge, 1-Wire, raw-wire, ADC voltage, PWM/frequency | Yes | M | M |
| SPI flash write/erase/status (read-only today) and I2C EEPROM dump/restore, reusing `SpiFlash`/`I2cEeprom` from `ch341aDriver.js` over a transport abstraction | Yes | M | M |
| Bigger I2C DB (~28 addresses; many map to several parts) with WHO_AM_I probing | Yes | M | M |
| Other adapters with the same I2C/SPI API: FT232H (MPSSE), MCP2221A (WebHID), CH341A, Pico | Yes each; MPSSE and MCP2221A most useful | M-L | M |
| Macro scripts in Bus Pirate syntax (`[0x50 0 r:16]`) / raw terminal | Yes | M | M |
| I2C bus sniffing | Partial (BBIO has none) | M | L |

---

## 7. `can-bus` (`tools/CanBusWorkbench.jsx`, `utils/canBusDriver.js`, `utils/canTools.js`)

### Does today
- SLCAN adapter (CANable/Candlelight/any Lawicel ASCII) on the shared Web Serial port: open/close, bitrate S3-S8 (100 kbps-1 Mbps), frame TX, sniffer table (grouped per ID with count, delta ms, byte-diff highlight), ID filter expressions, DBC import and signal decode (endianness, scaling), candump log import/export, CSV export, replay with speed/loop, OBD-II mode 01 PIDs, VIN, DTC read/clear, supported-PID scan, ISO-TP (segmentation, flow control, timeouts), UDS client (session control, ECU reset, tester-present keep-alive, read DID, identification, read DTCs, clear DTCs). Tests: `canObd.test.js`, `canTools.test.js`.
- `canBusDriver.js` header mentions "ELM327 OBD-II AT commands"; no ELM327 code exists.

### Reference tools
SavvyCAN, cangaroo, python-can, can-utils (`candump`, `cansend`, `isotpsend`), udsoncan, ELM327 apps, CANalyzer.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| SLCAN: RTR (`r`/`R`), CAN FD (`d`/`D`/`b`/`B`, `Y` data bitrate), timestamps (`Z1`), listen-only (`L`), length validation. `parseSlcanFrame` handles only `t`/`T` and yields NaN data for malformed lines | Yes | S-M | H |
| Native gs_usb/Candlelight over WebUSB (hardware timestamps, listen-only/loopback, FD, no ASCII overhead) | Yes (vendor class; WinUSB on Windows) | L | H |
| UDS: SecurityAccess (manual seed/key), RoutineControl, WriteDataByIdentifier, CommunicationControl, ControlDTCSetting, ReadMemoryByAddress, RequestDownload/TransferData (flashing). Names exist in `UDS_SERVICES`, only 7 requests implemented | Yes (flash services gated behind explicit confirm) | M | H |
| J1939: PGN/SPN decode, TP.CM/TP.DT, request PGN, address claim, DM1 | Yes | M | M |
| NMEA 2000 fast-packet, CANopen SDO/PDO/NMT, DBC multiplexing and value tables | Yes | M | M |
| Signal plotter from DBC signals, bus load / frame-rate stats | Yes | M | M |
| Bitrate auto-detect (listen-only, try rates) | Yes with SLCAN `L` | M | M |
| ELM327 mode for cheap OBD dongles | Yes (Web Serial; BLE ones in `ble`) | M | M |
| PCAN-USB, Vector, Kvaser, Intrepid | No (proprietary APIs) | - | - |
| Adapter hardware filters (`M`/`m`) | Adapter dependent | S | L |

---

## 8. `usbtmc` (`tools/UsbTmcWorkbench.jsx`, `utils/usbtmcDriver.js`, `utils/scpiTools.js`)

### Does today
- WebUSB USBTMC (class 0xFE/sub 0x03): DEV_DEP_MSG_OUT / REQUEST_DEV_DEP_MSG_IN framing with bTag, multi-fragment reads, `*IDN?` vendor profile (Rigol, Keysight, Siglent, Tektronix, generic), SCPI console with presets, script runner (`wait N`), scope waveform fetch (preamble parse, IEEE 488.2 block parse, stats, CSV, multi-channel SVG plot), screenshot (PNG/BMP detection), DMM logging to CSV with interval. Test: `usbtmc.test.js`.

### Reference tools
NI-VISA / NI MAX, pyvisa (+ pyvisa-py USBTMC), Keysight Connection Expert / BenchVue, instrument vendor utilities.

### Gaps
| Gap | Feasible | Effort | Value |
|---|---|---|---|
| Timeouts and error recovery. `transferIn` has no timeout: a query the instrument never answers hangs forever and, because `_serialize` chains every operation, **deadlocks the whole session** (console, logging loop, script runner). Needs per-call timeout plus INITIATE_ABORT_BULK_IN / CHECK_ABORT_STATUS / INITIATE_CLEAR / CLEAR_FEATURE(HALT) | Yes | M | H |
| USB488: READ_STATUS_BYTE, SRQ via interrupt-IN, REN_CONTROL/GO_TO_LOCAL (front-panel lock after use), TRIGGER, INDICATOR_PULSE | Yes | M | M |
| GET_CAPABILITIES instead of hard-coded assumptions | Yes | S | M |
| SCPI error-queue pane (`SYST:ERR?`), history/completion | Yes | S | M |
| Control panels: function generator and arb upload, PSU on/off/limits, scope trigger/timebase, built-in measurements, FFT | Yes (SCPI; per-vendor tables) | M-L | M |
| Deep-memory waveform paging, other vendors' binary formats (LeCroy, R&S, Pico) | Yes | M | M |
| Serial-class (CDC/VCP) instruments as an alternate transport for the same UI | Yes (Web Serial) | M | M |
| LAN SCPI/VXI-11/HiSLIP, GPIB adapters, VISA resource strings | No (no raw sockets) | - | - |
| Devices bound to NI-VISA/Keysight drivers on Windows | No (OS driver conflict); document the WinUSB swap | - | - |

---

## Bugs and risks found

1. `src/flasher/manifest.ts`: built-in Proxmark manifests use placeholder hashes: `9f86d081...0a08` is SHA-256 of `"test"`, `5e884898...42d8` is SHA-256 of `"password"`, and the same `bootrom.bin` hash and 32768-byte size are shared by every target. No real image can match, so `prepareFlashSession` always fails closed (safe, but the feature is dead until real hashes are generated at release time). Also the `webserial-bootloader` path is `NotImplementedError`.
2. `dfuDriver.js::dfuseDownloadElement` erases at a fixed `erasePageSize` from the start address (UI default 2048). On STM32F2/F4/F7/H7 the first sectors are 16 KB then 64/128 KB, so erase commands land mid-sector and the rest of a sector is left unerased or neighbours are touched; with page size 0 it silently falls back to a full mass erase without a confirm (FLB-1).
3. `DfuFlasher.jsx` filter `{classCode:0xfe, subclassCode:0x01}` also lists devices in DFU runtime mode (protocol 1), which cannot download; the flow then fails with a generic error.
4. `usbtmcDriver.js`: no read timeout; one stuck transfer blocks the serialized chain forever (FLB-3).
5. `espFlashDump.js` and `warhogFlash.js`: esptool-js loaded from `unpkg.com` at runtime without SRI and not pinned by the lockfile; fails offline or under a strict CSP. `espMemoryTool.js::dumpFlashRange` is unused.
6. `espLoader.js`: SPI_SET_PARAMS claims 16 MB regardless of the real flash, so an over-size image on a 4 MB board is not rejected; no baud increase and no compression make large images very slow.
7. `FlasherTab.jsx` `raw-stream` mode streams bytes with no bootloader protocol and reports success with no ack or verification.
8. `canBusDriver.js::parseSlcanFrame`: no DLC/length validation (DLC>8 or short lines give NaN bytes via `|| 0`), no RTR/FD handling; header comment advertises ELM327 support that does not exist.
9. `logicAnalyzerDriver.js`: SUMP `FLAGS 0x38` hard-codes group 0 and a 262144-sample cap; legacy `decodeUart/decodeI2C/generateSyntheticSignalBuffer` are dead code (the synthetic generator also contradicts the "no simulation" stance).
10. `avrIspDriver.js::flashImage` chip-erases by default, which wipes EEPROM unless EESAVE is set; the UI does not warn. The 13-entry `AVR_CHIP_DATABASE` means common parts report "not in the chip list" and cannot be flashed.
11. `Ch341aProgrammer.jsx` file picker accepts `.hex`: verify that Intel HEX is parsed to binary rather than written as raw bytes (DFU and AVR paths parse it).

---

## Implementation tickets

Ordered by value. Each ticket owns a disjoint file set. Shared exception: `package.json`/`package-lock.json` (FLB-2 adds `esptool-js`; FLB-8 may add a zlib library, so sequence those two or give them to one agent). Each ticket adds or extends only its own test files. Run `npm run test` and `npm run build` per ticket.

### FLB-1: DFU memory layout, alt-settings, upload/backup, correct erase
- **Why:** fixes bugs 2 and 3; dfu-util parity for STM32/nRF/RP/Atmel flows.
- **Files:** `src/utils/dfuDriver.js`, `src/components/tools/DfuFlasher.jsx`, `tests/dfuDriver.test.js` (extend). Do not touch `src/flasher/WebFlashService.ts`: keep `dfuseDownloadElement(address, data, { erasePageSize })` backwards compatible and add a new `layout` option.
- **Scope:**
  1. `parseDfuseLayout(name)` for strings like `@Internal Flash /0x08000000/04*016Kg,01*064Kg,07*128Kg` (units B/K/M, flag letters a-g) and `listDfuAlternates(usbDevice)` using `alt.interfaceName`.
  2. UI: alt-setting dropdown; default target address from the selected region; per-sector erase using the layout (only sectors overlapping the image). Mass erase only via an explicit checkbox plus confirm.
  3. `upload(length, onProgress)` using DFU_UPLOAD (plain DFU and DfuSe set-address); "Read device to .bin" button; optional verify-after-write by upload and compare.
  4. "Jump to application after flash" option (leave).
  5. List only DFU-mode interfaces (protocol 2) with a clear message for runtime-mode devices; optional DFU_DETACH plus re-request.
  6. Accept `.hex` for DfuSe targets via `parseIntelHex`.
- **Acceptance criteria:**
  - Layout parser returns `[ {start, size, flags} ]` for the F4 example and rejects malformed strings with a clear error; the free-text page size is ignored when a layout exists.
  - Flashing a 40 KB image at 0x08000000 on the mocked F4 layout erases sectors 0..2 only and nothing beyond the image rounded up to the sector.
  - Default flow never issues mass erase.
  - Upload returns exactly N bytes for a mock device ending with a short packet; verify reports the first mismatch offset.
  - Runtime-mode selection shows an actionable message.
- **Test plan:** extend `tests/dfuDriver.test.js` with its mock USB device (layout table tests, erase command sequence, upload round trip, verify mismatch, leave sequence). Manual pass on an STM32F4 and an RP2040/nRF52 in DFU mode.

### FLB-2: ESP dump/inspect: vendor esptool-js, higher baud, flash ID/size, partition-aware dumps
- **Why:** removes the unpkg supply-chain/offline risk (bug 5), speeds dumps up to 8x, fixes wrong sizes on non-4 MB boards.
- **Files:** `package.json`, `package-lock.json` (add `esptool-js`, pinned, lazy chunk), `src/utils/espFlashDump.js`, `src/utils/espMemoryTool.js`, `src/components/EspMemoryInspector.jsx`, new `src/utils/espPartitions.js`, new `tests/espPartitions.test.js`. Follow-up (not in this ticket): switch `src/components/workbenches/piglet/warhogFlash.js` to the same import.
- **Scope:**
  1. Replace `import(/* @vite-ignore */ ESPTOOL_JS)` with `await import('esptool-js')`; keep `requestPort` on the click gesture before awaiting.
  2. Baud selector (115200/460800/921600) via `ESPLoader({ baudrate, romBaudrate: 115200 })` with fallback to 115200 on failure.
  3. Identify panel: chip, features, crystal, MAC (all chips esptool-js supports, retiring the three hard-coded eFuse addresses), flash manufacturer/device and detected size; "Full flash backup" uses the detected size.
  4. `parsePartitionTable(bytes)` (0x50AA entries, MD5 entry, name/type/subtype/offset/size/flags), a "Read partition table" button and one-click dump per partition; keep current presets when no table was read.
  5. Remove or test-only-mark the unused ROM `dumpFlashRange`.
- **Acceptance criteria:**
  - No runtime request to unpkg or any CDN (`grep -R unpkg src/utils/espFlashDump.js src/components/EspMemoryInspector.jsx` is empty); `npm run build` emits esptool-js as a separate lazy chunk.
  - Baud failure offers retry at 115200.
  - Partition parser tests: default Arduino-ESP32 table, IDF factory+ota table, truncated/garbage table gives a clear error, MD5 entry validated.
  - "Full flash" length equals the detected size (mocked); no hard-coded 4 MB.
- **Test plan:** unit tests for `espPartitions.js` with fixture bytes; a component test with `esptool-js` mocked for the baud/identify flow; manual dump on an ESP32 and an ESP32-S3.

### FLB-3: USBTMC timeouts, abort/clear, USB488 control requests
- **Why:** fixes the session-deadlock bug (4); matches pyvisa behaviour on stuck instruments.
- **Files:** `src/utils/usbtmcDriver.js`, `src/utils/scpiTools.js`, `src/components/tools/UsbTmcWorkbench.jsx`, `tests/usbtmc.test.js` (extend).
- **Scope:**
  1. Per-operation timeout (default 5 s, configurable; longer for screenshots/waveforms) via `Promise.race` and a transport cancel hook.
  2. On timeout: INITIATE_ABORT_BULK_IN / CHECK_ABORT_STATUS (and OUT equivalents), INITIATE_CLEAR / CHECK_CLEAR_STATUS, `clearHalt`; `_serialize` must always settle.
  3. `getCapabilities()`, `readStatusByte()`, `indicatorPulse()`, `goToLocal()`/`remoteEnable()` (unlock front panel on disconnect).
  4. Workbench: timeout field, "Abort / Clear" button, `SYST:ERR?` drain after each command, status byte display.
- **Acceptance criteria:**
  - A mock transport that never answers makes `query()` reject with a timeout `UsbTmcError` in the configured time; a following `query('*IDN?')` on the recovered mock succeeds (no deadlock); abort/clear control requests are issued in spec order with `requestType: 'class'`, `recipient: 'interface'` (`'endpoint'` for abort-bulk) and the right indexes from `findUsbtmcInterface`.
  - Existing waveform, screenshot and DMM tests pass.
- **Test plan:** extend `tests/usbtmc.test.js` with a fake transport implementing `controlTransfer`; manual: send an invalid query to a scope and confirm recovery.

### FLB-4: AVR ISP: flash/EEPROM read and verify, bigger chip list, Arduino bootloader upload
- **Why:** removes write-only limits and covers the most common Arduino workflow.
- **Files:** `src/utils/avrIspDriver.js`, `src/components/tools/AvrIspWorkbench.jsx`, `tests/avrIsp.test.js` (extend); optional new `src/utils/avrChipDatabase.js` if the DB is split out.
- **Scope:**
  1. `readFlash` to `.hex`/`.bin`; "Verify against file"; EEPROM read/write (`.hex`/`.eep`); read hfuse and warn that chip erase wipes EEPROM unless EESAVE is set; offer "preserve EEPROM" (dump, erase, restore).
  2. Extend `AVR_CHIP_DATABASE` from avrdude.conf data to 60+ parts (ATtiny13/25/45/85/24/44/84/2313, ATmega8/16/32/48/88/168/328/644/1284/2560/32U4/16U2, AT90USB); `defaultFuses` only where known (disable "Burn bootloader" otherwise).
  3. "Upload to Arduino bootloader" mode: STK500v1 (optiboot) at 115200/57600 with DTR reset, board dropdown (Uno, Nano old/new bootloader, Pro Mini), reusing `Stk500Programmer` page write/verify without entering ISP mode.
- **Acceptance criteria:**
  - Read-back after a simulated write equals the image; HEX export round-trips through `parseIntelHex`.
  - Chip erase reads hfuse and shows a confirm that mentions EEPROM loss when EESAVE is clear.
  - Bootloader-upload mode never issues fuse or erase commands; test asserts the exact command byte stream for a 2-page image.
  - ATtiny85 and ATmega2560 signatures resolve to named chips with correct page sizes; DB sanity test (unique signatures, page size power of two, flash size multiple of page size).
- **Test plan:** extend `tests/avrIsp.test.js` using its fake serial link.

### FLB-5: CAN: SLCAN hardening, CAN FD/RTR/timestamps, UDS service completion, J1939
- **Why:** fixes parse bug 8, enables FD adapters, covers UDS/J1939 workflows SavvyCAN users expect.
- **Files:** `src/utils/canBusDriver.js`, `src/utils/canTools.js`, `src/components/tools/CanBusWorkbench.jsx`, `tests/canTools.test.js` (extend), new `tests/slcanFrames.test.js`. Native gs_usb/Candlelight transport is a later ticket (new `src/utils/gsUsbDriver.js`, effort L).
- **Scope:**
  1. `parseSlcanFrame`/`buildSlcanFrame`: validate DLC (0-8; up to 64 for FD), reject short lines, add `r`/`R` RTR, `d`/`D`/`b`/`B` FD (BRS flag), optional timestamp (`Z1`), result `{ rtr, fd, brs, timestamp }`; keep `SlcanLineReader` API. Add FD data bitrate (`Y`), listen-only (`L`) open mode and an auto-detect-bitrate helper.
  2. `UdsClient`: `securityAccess(level, keyProvider)` (manual hex seed/key in the UI), `routineControl`, `writeDid`, `readMemory`, `communicationControl`, `controlDtcSetting`; write services behind `confirmAction` (`utils/sessionLog`). No RequestDownload/TransferData here.
  3. J1939: `decodeJ1939Id(id)` (priority, PGN, SA, DA), PGN name table (~60 common), SPN decode for common PGNs, address-claim display, "J1939" tab with PGN request.
  4. Fix header comment; expand DTC description table.
- **Acceptance criteria:**
  - Table-driven tests for valid/invalid `t`, `T`, `r`, `R`, `d`, `D` lines (DLC 9, odd hex length, trailing timestamp) return expected frames or `null`, never NaN data.
  - UDS requests produce exact bytes (27 01 / 27 02 key, 31 01 FF00, 2E F190 ..., 28 00 01); negative responses map via `UDS_NRC`, including 0x78 response pending.
  - J1939 `0x18FEF100` decodes to priority 6, PGN 65265 (CCVS), SA 0; an EEC1 sample decodes RPM.
  - Existing sniffer/replay/OBD tests unchanged.
- **Test plan:** unit tests as above; manual check with a CANable in loopback/listen-only.

### FLB-6: Logic analyzer: full SUMP capability, trigger options, stackable decoders
- **Why:** use the hardware's real channel count and triggers; add the most useful decoder stacks.
- **Files:** `src/utils/logicAnalyzerDriver.js`, `src/utils/logicDecoders.js`, `src/components/tools/LogicAnalyzerWorkbench.jsx`, `tests/logicCapture.test.js` (extend), `tests/logicDecoders.test.js` (extend).
- **Scope:**
  1. SUMP: apply `parseSumpMetadata` (channel groups via flags, sample memory limit, 16/32-bit unpacking); pre-trigger via read/delay counts; stage-0 mask/value plus rising/falling edge on one channel; widen the sample buffer type (`Uint16/32Array`) in viewer and decoders while keeping an 8-bit fast path.
  2. fx2lafw 16-channel wide mode when the firmware reports it.
  3. Stackable decoders: `DECODERS` entries may declare `stack`; add SPI-flash command annotator (0x03/0x9F/0x06/0x02/0x20/0xD8), I2C -> EEPROM/register-name annotator, UART -> NMEA 0183 with checksum, CAN -> UDS/J1939 names (import from `canTools`).
  4. Delete dead `decodeUart`, `decodeI2C`, `generateSyntheticSignalBuffer` after re-confirming no importer.
  5. Session JSON save/load (capture plus config).
- **Acceptance criteria:**
  - A mock SUMP link reporting 16 channels / 64K samples yields a 16-bit capture decoded correctly on channel 12; trigger bytes match the expected command stream; the pre-trigger fraction moves the trigger index.
  - The SPI-flash stack turns a recorded 0x9F transaction into "JEDEC ID EF 40 18 (Winbond W25Q128)".
  - `npm run build` clean; existing decoder tests pass.
- **Test plan:** extend `logicCapture.test.js` with a fake SUMP link; fixtures for stacked decoders; manual run with an OLS/FX2 board.

### FLB-7: CMSIS-DAP: connect under reset, mass erase/unlock, SVD register viewer, ELF symbols
- **Why:** most common reasons pyOCD succeeds where this tool fails (sleeping or locked MCUs), plus peripheral inspection.
- **Files:** `src/utils/cmsisDapDriver.js`, `src/utils/cortexDebug.js`, `src/utils/dapLink.js` (only if `SwdTarget.connect` needs a reset hook), `src/components/tools/CmsisDapDebugger.jsx`, `src/components/tools/cmsis/DebugFeaturesPanel.jsx`, new `src/utils/svd.js`, new `src/components/tools/cmsis/PeripheralsPanel.jsx`, `tests/cortexDebug.test.js` and `tests/dapProbe.test.js` (extend), new `tests/svd.test.js`.
- **Scope:**
  1. "Connect under reset": assert nRST via SWJ_PINS, line reset / JTAG-to-SWD, halt (DHCSR plus DEMCR VC_CORERESET), release nRST. "Mass erase" using the loaded algorithm's `EraseChip`, and CTRL-AP ERASEALL for nRF52.
  2. `parseSvd(xml)` (peripherals, registers, fields, access, base, derivedFrom, dim arrays), from the pack's `.svd` or a user file; Peripherals panel with live read, bitfield decode, guarded write.
  3. `symbolize(addr)` from `parseElf` symbols; show `main+0x12` for PC/LR and breakpoints; "break at symbol".
  4. Persist loaded packs/FLMs/SVDs in IndexedDB keyed by pack name.
- **Acceptance criteria:**
  - Mock-probe test shows the exact pin/transfer sequence for under-reset connect and that nRST is released on error paths.
  - SVD parser tests with an STM32/nRF snippet (derivedFrom, clusters, dim arrays); field decode round trip.
  - PC shown symbolically when an ELF with symbols is loaded; unchanged for raw `.bin`.
  - Existing flash/RTT/SWO tests unchanged.
- **Test plan:** probe-level unit tests with the existing fake DAP transport; SVD fixtures; manual on an RP2040 Debug Probe and an STM32 target.

### FLB-8: ESP ROM flasher: baud change, compressed write, flash-size awareness, clarify raw-stream
- **Why:** closes the speed/safety gap in the app's own ROM client (bugs 6 and 7); independent of FLB-2 (different files), may later converge once esptool-js is vendored.
- **Files:** `src/utils/espLoader.js`, `src/components/tabs/FlasherTab.jsx`, `tests/espRomSimulated.test.js` (extend); touch `tests/flashAbortAndShortcuts.test.js` only if it asserts flasher UI text. Possible shared file with FLB-2: `package.json` (zlib library).
- **Scope:**
  1. CHANGE_BAUDRATE (0x0F) then reopen the port at the new rate through `borrowPort`; selector 115200/230400/460800/921600 with automatic fallback on sync failure; ESP8266 ROM stays 115200.
  2. FLASH_DEFL_BEGIN/DATA/END with a small zlib lib (`fflate` or `pako`); verify via the existing SPI_FLASH_MD5; ESP8266 falls back to uncompressed.
  3. Flash size: read JEDEC through SPI registers (per-chip register table for ESP32/S2/S3/C3/C6) to set SPI_SET_PARAMS correctly and reject images that end past the flash; optional header size/freq patch like esptool `--flash_size detect`.
  4. `raw-stream` mode: rename to "Raw UART stream (no protocol, unverified)" with an explicit confirm, or remove.
- **Acceptance criteria:**
  - Simulated ROM test: compressed write of a compressible 64 KB image sends fewer DATA bytes than raw, passes MD5 verify, and ESP8266 falls back to uncompressed.
  - Baud change sequence (command, reopen, re-sync) asserted against the fake port; failure falls back to 115200 and still flashes.
  - An image that would exceed the detected flash size is rejected before any erase command.
  - Existing abort/shortcut tests pass.
- **Test plan:** extend `espRomSimulated.test.js` (scripted fake port with compressed blocks); manual flash of a 1 MB image on an ESP32 at 921600 vs 115200 to confirm speedup and MD5 verify.

### Not ticketed (backlog and reasons)
- Bus Pirate 5/6 (BPIO2) support plus SPI-flash write/EEPROM tools for `bus-explorer` (value H/M, effort L, needs hardware; touches only `busExplorerDriver.js`/`BusExplorerWorkbench.jsx`, so it is filename-disjoint from FLB-1..8 and can be added as FLB-9).
- Native gs_usb/Candlelight WebUSB (CAN), USBasp/USBtiny WebUSB and UPDI (AVR), FTDI MPSSE transports, sigrok-pico, BSDL import and XSVF (JTAG), CH341A DB and block-erase tuning.
- Impossible here: ST-Link/J-Link, OpenOCD/GDB servers, VXI-11/HiSLIP/LXI/GPIB, PCAN/Vector/Kvaser APIs, Saleae Logic 8/DSLogic protocols, ETM/parallel trace, debugWIRE/JTAG ICE.
