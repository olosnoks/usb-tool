/**
 * USB UART Chip Identifier Database
 * Maps USB Vendor IDs (VID) and Product IDs (PID) to hardware IC models, 
 * operating voltages, driver notes, and pinout quirks.
 */

export const USB_CHIP_DATABASE = {
  // Silicon Labs
  '10c4:ea60': {
    manufacturer: 'Silicon Labs',
    chip: 'CP2102 / CP2104 USB-to-UART Bridge',
    voltage: '3.3V Logic (5V Tolerant Inputs)',
    autoReset: 'DTR + RTS Transistor Strapping Supported',
    notes: 'Common on NodeMCU, ESP32-WROOM dev boards. High stability up to 2 Mbps.'
  },
  '10c4:ea70': {
    manufacturer: 'Silicon Labs',
    chip: 'CP2105 Dual USB to UART Bridge',
    voltage: '3.3V Logic',
    autoReset: 'Dual COM Ports (Enhanced + Standard port)',
    notes: 'Dual channel interface. Port 0 supports modern hardware flow control.'
  },
  '10c4:ea71': {
    manufacturer: 'Silicon Labs',
    chip: 'CP2108 Quad USB to UART Bridge',
    voltage: '3.3V Logic',
    autoReset: 'Quad COM Ports',
    notes: '4 independent UART channels on a single USB device.'
  },

  // FTDI (Future Technology Devices International)
  '0403:6001': {
    manufacturer: 'FTDI',
    chip: 'FT232R / FT232RL USB UART IC',
    voltage: 'Configurable (5V / 3.3V / 2.8V / 1.8V via VCCIO)',
    autoReset: 'DTR / RTS Supported',
    notes: 'Industry standard. Ensure latency timer is set to 1ms in OS driver for high-speed transfers.'
  },
  '0403:6010': {
    manufacturer: 'FTDI',
    chip: 'FT2232D / FT2232H Dual USB UART/FIFO',
    voltage: '3.3V / 5V (FT2232H: High-Speed 480 Mbps USB 2.0)',
    autoReset: 'Channel A: JTAG/SWD/UART | Channel B: UART',
    notes: 'Used in ESP-Prog, JTAG debuggers, and high-speed embedded test equipment.'
  },
  '0403:6011': {
    manufacturer: 'FTDI',
    chip: 'FT4232H Quad USB UART Controller',
    voltage: '3.3V (5V Tolerant Inputs)',
    autoReset: '4 Independent Channels',
    notes: 'Industrial grade 4-port serial bridge supporting MPSSE engines.'
  },
  '0403:6014': {
    manufacturer: 'FTDI',
    chip: 'FT232H Single Channel Hi-Speed USB UART/FIFO',
    voltage: '3.3V (5V Tolerant)',
    autoReset: 'DTR / RTS / GPIO Bit-bang',
    notes: 'Up to 12 Mbaud UART speed. Supports SPI, I2C, JTAG bitbang modes.'
  },
  '0403:6015': {
    manufacturer: 'FTDI',
    chip: 'FT-X Series (FT230X / FT231X)',
    voltage: '1.8V to 3.3V Logic',
    autoReset: 'Full Modem Control Lines',
    notes: 'Modern low-power compact FTDI serial chip.'
  },

  // WCH (Jiangsu Qinheng Co.)
  '1a86:7523': {
    manufacturer: 'WCH',
    chip: 'CH340G / CH340C / CH340N USB Serial',
    voltage: '5V or 3.3V (Selectable via V3 pin)',
    autoReset: 'DTR/RTS Auto-Reset supported on ESP8266/ESP32 dev boards',
    notes: 'Extremely popular on budget Arduino clones, ESP8266 D1 Mini, and IoT boards.'
  },
  '1a86:7522': {
    manufacturer: 'WCH',
    chip: 'CH340K / CH340X USB Serial',
    voltage: '3.3V / 5V',
    autoReset: 'Built-in crystal oscillator',
    notes: 'Compact 8-pin package with internal clock.'
  },
  '1a86:5523': {
    manufacturer: 'WCH',
    chip: 'CH341 / CH341A USB Serial / Parallel / Programmer',
    voltage: '5V default (Check for 3.3V jumper on black programmer dongles!)',
    autoReset: 'Serial / SPI / I2C hardware modes',
    notes: 'CAUTION: Many CH341A SPI programmers route 5V to 3.3V flash chips unless modified.'
  },
  '1a86:55d4': {
    manufacturer: 'WCH',
    chip: 'CH9102F / CH9102X High-Speed USB Serial',
    voltage: '3.3V Logic',
    autoReset: 'Full DTR + RTS Transistor Reset Supported',
    notes: 'Common drop-in replacement for CP2104 on newer LilyGO and NodeMCU boards. Up to 4 Mbps.'
  },

  // Prolific
  '067b:2303': {
    manufacturer: 'Prolific',
    chip: 'PL2303 USB-to-Serial Bridge (HXD / TA / GS)',
    voltage: '3.3V / 5V',
    autoReset: 'DTR / RTS Supported',
    notes: 'Check for driver rev compatibility on modern Windows 11 systems.'
  },

  // Espressif Native USB
  '303a:1001': {
    manufacturer: 'Espressif Systems',
    chip: 'ESP32-S3 / C3 / C6 USB Serial/JTAG Controller',
    voltage: '3.3V Logic',
    autoReset: 'Native Direct USB (No USB-UART bridge chip required)',
    notes: 'Integrated inside ESP32-S3 and C3 chips. Provides CDC serial and JTAG interface.'
  },
  '303a:0002': {
    manufacturer: 'Espressif Systems',
    chip: 'ESP32-S2 USB CDC Serial',
    voltage: '3.3V Logic',
    autoReset: 'Native USB Peripheral',
    notes: 'Native OTG USB controller on ESP32-S2.'
  },

  // Raspberry Pi
  '2e8a:000a': {
    manufacturer: 'Raspberry Pi Foundation',
    chip: 'Raspberry Pi Pico (RP2040) USB CDC',
    voltage: '3.3V Logic',
    autoReset: '1200 bps touch pulse enters USB BOOTSEL mode',
    notes: 'RP2040 MicroPython / CircuitPython default serial communication port.'
  },
  '2e8a:0005': {
    manufacturer: 'Raspberry Pi Foundation',
    chip: 'Picoprobe / Debug Probe CMSIS-DAP + VCP',
    voltage: '3.3V Logic',
    autoReset: 'SWD + UART Dual Interface',
    notes: 'Official Raspberry Pi hardware debug probe.'
  },

  // Arduino
  '2341:0043': {
    manufacturer: 'Arduino LLC',
    chip: 'Arduino Uno Rev 3 (ATmega16U2 USB)',
    voltage: '5V Logic',
    autoReset: 'DTR line pulses RESET pin through 100nF cap',
    notes: 'Standard Arduino Uno R3 ATmega328P target.'
  },
  '2341:0042': {
    manufacturer: 'Arduino LLC',
    chip: 'Arduino Mega 2560 Rev 3',
    voltage: '5V Logic',
    autoReset: 'DTR Pulse Supported',
    notes: 'ATmega2560 target.'
  },

  // STMicroelectronics
  '0483:5740': {
    manufacturer: 'STMicroelectronics / Flipper',
    chip: 'STM32 Virtual COM Port / Flipper Zero CLI',
    voltage: '3.3V Logic',
    autoReset: 'Direct USB CDC interface',
    notes: 'Standard CDC serial firmware running on STM32F1/F4/G4/H7 or Flipper Zero.'
  },
  '0483:374b': {
    manufacturer: 'STMicroelectronics',
    chip: 'ST-LINK/V2-1 or ST-LINK/V3 VCP',
    voltage: '3.3V Logic',
    autoReset: 'SWD + Virtual COM Port',
    notes: 'Embedded on Nucleo and Discovery development boards.'
  },
  '0483:df11': {
    manufacturer: 'STMicroelectronics',
    chip: 'STM32 DFU System Bootloader',
    voltage: '3.3V Logic',
    autoReset: 'Active ROM Bootloader (BOOT0 asserted)',
    notes: 'Device is in built-in hardware DFU flashing mode. Can write firmware via WebUSB DFU protocol.'
  },

  // Raspberry Pi
  '2e8a:0003': {
    manufacturer: 'Raspberry Pi',
    chip: 'RP2040 BootROM (BOOTSEL Mode)',
    voltage: '3.3V Logic',
    autoReset: 'Active ROM Bootloader',
    notes: 'Raspberry Pi Pico in bootloader state. Exposes UF2 USB mass storage and USB flashing.'
  },
  '2e8a:0005': {
    manufacturer: 'Raspberry Pi',
    chip: 'RP2040 MicroPython / CircuitPython CDC',
    voltage: '3.3V Logic',
    autoReset: '1200-baud magic knock resets to BOOTSEL',
    notes: 'Standard Pico serial REPL. Open at 1200 bps to force back into bootloader.'
  },
  '2e8a:000f': {
    manufacturer: 'Raspberry Pi',
    chip: 'RP2350 BootROM (Pico 2 BOOTSEL)',
    voltage: '3.3V Logic',
    autoReset: 'Active ROM Bootloader',
    notes: 'Next-gen RP2350 dual Hazard3 RISC-V / Cortex-M33 in bootloader mode.'
  },

  // Espressif Native USB
  '303a:1001': {
    manufacturer: 'Espressif Systems',
    chip: 'ESP32-S2/S3/C3/C6 USB-JTAG/Serial Port',
    voltage: '3.3V Logic',
    autoReset: 'Native USB CDC + JTAG Controller',
    notes: 'Native on-chip USB peripheral. RTS/DTR strapping toggles internal bootloader.'
  },
  '303a:0002': {
    manufacturer: 'Espressif Systems',
    chip: 'ESP32-S2/S3 USB DFU Bootloader',
    voltage: '3.3V Logic',
    autoReset: 'Active ROM DFU mode',
    notes: 'Chip is in native DFU download mode ready for firmware flashing.'
  },

  // Mobile / SoC Emergency Download (EDL / BROM)
  '05c6:9008': {
    manufacturer: 'Qualcomm',
    chip: 'Qualcomm HS-USB QDLoader 9008 (EDL Mode)',
    voltage: '1.8V / 3.3V Logic',
    autoReset: 'Emergency Download Mode',
    notes: 'Snapdragon primary bootloader recovery mode. Used to unbrick cellular modems and phones.'
  },
  '0e8d:0003': {
    manufacturer: 'MediaTek',
    chip: 'MediaTek MTK Preloader / BROM Port',
    voltage: '1.8V / 3.3V Logic',
    autoReset: 'BootROM Handshake Mode',
    notes: 'Device is in low-level MTK BROM flash mode.'
  },
  '1f3a:efe8': {
    manufacturer: 'Allwinner Technology',
    chip: 'Allwinner FEL Bootloader Mode',
    voltage: '3.3V Logic',
    autoReset: 'FEL Mode',
    notes: 'Sunxi / Allwinner SOC in low-level USB flashing mode (Pine64, TV boxes, smart displays).'
  },
  '1b8e:c003': {
    manufacturer: 'Amlogic',
    chip: 'Amlogic WorldCup USB Burning Mode',
    voltage: '3.3V Logic',
    autoReset: 'Burning Mode (Amlogic SOC)',
    notes: 'Found in Android TV boxes and smart media devices ready for USB image burning.'
  },

  // Microchip / Atmel
  '03eb:6124': {
    manufacturer: 'Microchip / Atmel',
    chip: 'Atmel SAM-BA CDC Bootloader (SAMD21 / SAMD51)',
    voltage: '3.3V Logic',
    autoReset: 'Double-tap reset bootloader',
    notes: 'Found on Arduino Zero, Adafruit Feather M0/M4, and ATSAMD boards.'
  },
  '03eb:2111': {
    manufacturer: 'Microchip / Atmel',
    chip: 'ATmega32U4 USB CDC (Arduino Leonardo / BadUSB)',
    voltage: '5V / 3.3V Logic',
    autoReset: '1200-baud reset pulse',
    notes: 'Common in keystroke injection dongles (Rubber Ducky clones), custom mechanical keyboards, and Arduino Pro Micro.'
  },

  // Nordic Semiconductor
  '1915:521f': {
    manufacturer: 'Nordic Semiconductor',
    chip: 'nRF52840 USB DFU Bootloader',
    voltage: '3.3V Logic',
    autoReset: 'Adafruit / Nordic UF2 Bootloader',
    notes: 'Found on Bluetooth BLE dongles, smart beacons, and wearable health trackers.'
  },

  // WCH (WinChipHead) Bootloaders
  '1a86:55e0': {
    manufacturer: 'WCH (WinChipHead)',
    chip: 'CH32V USB ISP Mode (CH32V003 / CH32X035 / CH32V203)',
    voltage: '3.3V / 5V Logic',
    autoReset: 'WCH Bootloader (BOOT0 asserted)',
    notes: 'Ultra-cheap 10-cent RISC-V microcontroller in ISP download mode. Found in smart vapes, toys, and USB dongles.'
  },

  // Mystery Consumer Hardware & Smart Vapes
  '3358:0001': {
    manufacturer: 'Puya Semiconductor',
    chip: 'Puya PY32F0xx USB Bootloader / Bridge',
    voltage: '3.3V Logic',
    autoReset: 'SWD / Serial Bootloader',
    notes: 'Extremely popular in disposable smart screen vapes (Geek Bar Pulse, Lost Mary MO20000, Spaceman) for running the color LCD animations.'
  },
  '4c4a:0001': {
    manufacturer: 'Zhuhai Jieli (JL / Jerry)',
    chip: 'Jieli AC69 / AC70 USB Debug & Audio Bridge',
    voltage: '3.3V Logic',
    autoReset: 'Proprietary JL Flash Tool',
    notes: 'Found in Bluetooth audio gadgets, smart vape motherboards, and cheap smart toys.'
  },
  '3171:0100': {
    manufacturer: 'Geehy Semiconductor',
    chip: 'Geehy APM32F0 / APM32F1 USB CDC',
    voltage: '3.3V Logic',
    autoReset: 'STM32-compatible Bootloader',
    notes: 'High-speed Chinese ARM microcontroller clone widely used in industrial controllers and consumer IoT.'
  }
};

/**
 * Identifies USB device based on VID and PID
 * @param {number|string} vendorId
 * @param {number|string} productId
 * @returns {{ known: boolean, manufacturer: string, chip: string, voltage: string, autoReset: string, notes: string, key: string }}
 */
export function identifyUsbChip(vendorId, productId) {
  if (!vendorId) {
    return {
      known: false,
      manufacturer: 'Generic UART',
      chip: 'Unknown USB-Serial Device',
      voltage: 'Unknown (Check hardware before connecting!)',
      autoReset: 'Standard DTR/RTS lines',
      notes: 'No USB Vendor/Product ID reported by browser Web Serial driver.',
      key: 'unknown'
    };
  }

  const vHex = Number(vendorId).toString(16).padStart(4, '0').toLowerCase();
  const pHex = productId ? Number(productId).toString(16).padStart(4, '0').toLowerCase() : '0000';
  const key = `${vHex}:${pHex}`;

  if (USB_CHIP_DATABASE[key]) {
    return {
      known: true,
      ...USB_CHIP_DATABASE[key],
      key
    };
  }

  // Check by VID only if specific PID is not matched
  const vidOnlyMatches = Object.entries(USB_CHIP_DATABASE).filter(([k]) => k.startsWith(`${vHex}:`));
  if (vidOnlyMatches.length > 0) {
    const fallback = vidOnlyMatches[0][1];
    return {
      known: true,
      manufacturer: fallback.manufacturer,
      chip: `${fallback.manufacturer} Device (VID: 0x${vHex.toUpperCase()} PID: 0x${pHex.toUpperCase()})`,
      voltage: fallback.voltage,
      autoReset: fallback.autoReset,
      notes: fallback.notes,
      key
    };
  }

  return {
    known: false,
    manufacturer: `Vendor 0x${vHex.toUpperCase()}`,
    chip: `USB Device (VID: 0x${vHex.toUpperCase()} PID: 0x${pHex.toUpperCase()})`,
    voltage: 'Check voltage specification (typically 3.3V or 5V)',
    autoReset: 'Standard serial lines',
    notes: 'Unrecognized chip. Operates as standard UART serial bus.',
    key
  };
}
