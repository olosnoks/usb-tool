/**
 * CMSIS-DAP / ARM Cortex-M SWD In-System Debugger Driver
 * Connects to DAPLink, Raspberry Pi Pico Probe, micro:bit, and ST-Link probes
 * via WebHID or WebUSB. Controls CPU halt, single-step, core registers, and SRAM inspection.
 */

export const DAP_CMD = {
  DAP_INFO: 0x00,
  DAP_HOST_STATUS: 0x01,
  DAP_CONNECT: 0x02,
  DAP_DISCONNECT: 0x03,
  DAP_TRANSFER_CONFIGURE: 0x04,
  DAP_TRANSFER: 0x05,
  DAP_TRANSFER_BLOCK: 0x06,
  DAP_SWJ_CLOCK: 0x11,
  DAP_SWJ_SEQUENCE: 0x12,
  DAP_SWD_CONFIGURE: 0x13,
  DAP_RESET_TARGET: 0x0A
};

// ARM Core Debug Registers (ARMv6-M / ARMv7-M / ARMv8-M)
export const ARM_DEBUG = {
  DHCSR: 0xE000EDF0, // Debug Halting Control and Status Register
  DCRSR: 0xE000EDF4, // Debug Core Register Selector Register
  DCRDR: 0xE000EDF8, // Debug Core Register Data Register
  DEMCR: 0xE000EDFC, // Debug Exception and Monitor Control Register

  // DHCSR Keys & Bits
  DBGKEY: 0xA05F0000,
  C_DEBUGEN: (1 << 0),
  C_HALT: (1 << 1),
  C_STEP: (1 << 2),
  C_MASKINTS: (1 << 3),
  S_REGRDY: (1 << 16),
  S_HALT: (1 << 17),
  S_SLEEP: (1 << 18),
  S_LOCKUP: (1 << 19),
  S_RESTART_ST: (1 << 24),
  S_RESET_ST: (1 << 25)
};

export const CORTEX_REG_NAMES = [
  'R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7',
  'R8', 'R9', 'R10', 'R11', 'R12', 'SP (R13)', 'LR (R14)', 'PC (R15)',
  'xPSR', 'MSP', 'PSP', 'PRIMASK'
];

export const CMSIS_DAP_HW_UNSUPPORTED =
  'Real CMSIS-DAP probes are not supported yet: halt, step, register and memory access are not implemented over WebHID. Use the demo target to explore the interface.';

export class CmsisDapClient {
  constructor(logger = console.log) {
    this.hidDevice = null;
    this.usbDevice = null;
    this.logger = logger;
    this.connected = false;
    this.simulated = false;
    this.targetState = 'disconnected'; // 'running' | 'halted' | 'disconnected'

    // Virtual target state for simulation
    this.virtualRegisters = new Uint32Array(20);
    this.virtualSram = new Uint32Array(1024); // 4KB virtual SRAM (0x20000000)
    this.initVirtualState();
  }

  log(msg, type = 'sys') {
    this.logger?.(`[CMSIS-DAP] ${msg}`, type);
  }

  initVirtualState() {
    this.virtualRegisters[13] = 0x20001000; // SP (top of SRAM)
    this.virtualRegisters[14] = 0x08000425; // LR (Return address in Flash)
    this.virtualRegisters[15] = 0x080001D0; // PC (Reset Handler / Main)
    this.virtualRegisters[16] = 0x01000000; // xPSR (Thumb mode active)

    // Fill some realistic SRAM variables
    this.virtualSram[0] = 0xDEADBEEF; // 0x20000000: Magic signature
    this.virtualSram[1] = 42;         // 0x20000004: Global loop counter
    this.virtualSram[2] = 0x000003E8; // 0x20000008: Delay ms (1000)
  }

  /**
   * Connect via WebHID (CMSIS-DAP v1)
   */
  async connectHid() {
    // The CMSIS-DAP command set (DAP_Transfer, DHCSR/DCRSR access, memory
    // reads/writes) is not implemented yet. The old hardware path opened the
    // probe and then reported success for halt/step/write without sending a
    // single report, so it is refused rather than pretending.
    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }

  // Kept for when the DAP protocol is implemented: opens the HID probe only.
  async openHidProbe() {
    if (typeof navigator === 'undefined' || !navigator.hid) {
      throw new Error('WebHID API not available in this browser. Please use Chrome, Edge, or Opera.');
    }

    try {
      this.log('Requesting CMSIS-DAP debug probe (HID)...');
      const devices = await navigator.hid.requestDevice({
        filters: [
          { vendorId: 0x0D28 }, // ARM / DAPLink (micro:bit, NXP, etc.)
          { vendorId: 0x2E8A, productId: 0x000C }, // Raspberry Pi Pico Debug Probe
          { vendorId: 0x0483 }  // STMicroelectronics (ST-Link V2/V3)
        ]
      });

      if (!devices || devices.length === 0) throw new Error('No probe selected.');
      this.hidDevice = devices[0];
      await this.hidDevice.open();

      this.connected = true;
      this.simulated = false;
      this.targetState = 'running';
      this.log(`Connected to physical debug probe: ${this.hidDevice.productName}!`);
      return true;
    } catch (err) {
      this.log(`Probe connection cancelled: ${err.message}`, 'sys');
      throw err;
    }
  }

  /**
   * Enables simulated live Cortex-M target for testing
   */
  connectSimulation() {
    this.connected = true;
    this.simulated = true;
    this.targetState = 'running';
    this.initVirtualState();
    this.log('[SIMULATION] Connected to virtual ARM Cortex-M4 target (STM32F4 / RP2040). CPU Running.');
    return true;
  }

  disconnect() {
    if (this.hidDevice && this.hidDevice.opened) {
      try { this.hidDevice.close(); } catch (e) {}
    }
    this.hidDevice = null;
    this.connected = false;
    this.simulated = false;
    this.targetState = 'disconnected';
    this.log('Disconnected from probe.');
  }

  /**
   * Halts the target CPU via DHCSR
   */
  async halt() {
    if (!this.connected) throw new Error('Probe not connected.');

    this.log('Asserting DHCSR C_DEBUGEN | C_HALT (0xA05F0003)...');
    if (this.simulated) {
      await new Promise(r => setTimeout(r, 100));
      this.targetState = 'halted';
      this.virtualRegisters[15] = 0x0800021A; // PC halted in main loop
      this.virtualRegisters[0] = 0x00000001;  // R0
      this.virtualRegisters[1] = this.virtualSram[1]++; // Incremented counter
      this.log(`CPU Halted at PC: 0x${this.virtualRegisters[15].toString(16).toUpperCase()}`);
      return this.virtualRegisters;
    }

    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }

  /**
   * Resumes normal CPU execution
   */
  async resume() {
    if (!this.connected) throw new Error('Probe not connected.');

    this.log('Releasing DHCSR halt. Resuming CPU execution...');
    if (this.simulated) {
      await new Promise(r => setTimeout(r, 80));
      this.targetState = 'running';
      this.log('CPU resumed and running.');
      return true;
    }

    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }

  /**
   * Single-steps a single assembly instruction
   */
  async step() {
    if (!this.connected) throw new Error('Probe not connected.');

    this.log('Executing single instruction step (C_STEP)...');
    if (this.simulated) {
      this.targetState = 'halted';
      this.virtualRegisters[15] += 2; // Advance Thumb PC by 2 bytes
      this.virtualRegisters[2] = (this.virtualRegisters[2] + 1) & 0xFFFFFFFF;
      this.log(`Stepped to PC: 0x${this.virtualRegisters[15].toString(16).toUpperCase()}`);
      return this.virtualRegisters;
    }

    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }

  /**
   * Reads all ARM Cortex-M core registers (R0-R12, SP, LR, PC, xPSR)
   */
  async readRegisters() {
    if (!this.connected) throw new Error('Probe not connected.');

    if (this.simulated) {
      await new Promise(r => setTimeout(r, 50));
      return Array.from(this.virtualRegisters);
    }

    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }

  /**
   * Reads 32-bit words from SRAM or Flash memory address
   */
  async readMemory(address = 0x20000000, wordCount = 16) {
    if (!this.connected) throw new Error('Probe not connected.');

    if (this.simulated) {
      await new Promise(r => setTimeout(r, 60));
      const words = [];
      const sramBase = 0x20000000;
      for (let i = 0; i < wordCount; i++) {
        const curAddr = address + (i * 4);
        if (curAddr >= sramBase && curAddr < sramBase + (this.virtualSram.length * 4)) {
          const idx = (curAddr - sramBase) / 4;
          words.push({ address: curAddr, value: this.virtualSram[idx] || 0 });
        } else {
          // Flash simulation
          words.push({ address: curAddr, value: 0x4800B510 ^ (i * 0x1010) });
        }
      }
      return words;
    }

    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }

  /**
   * Writes a 32-bit word directly to target memory address
   */
  async writeMemoryWord(address, value) {
    if (!this.connected) throw new Error('Probe not connected.');

    this.log(`Writing 0x${value.toString(16).toUpperCase().padStart(8, '0')} to [0x${address.toString(16).toUpperCase().padStart(8, '0')}]...`);
    if (this.simulated) {
      const sramBase = 0x20000000;
      if (address >= sramBase && address < sramBase + (this.virtualSram.length * 4)) {
        const idx = (address - sramBase) / 4;
        this.virtualSram[idx] = value >>> 0;
      }
      this.log('Write confirmed!');
      return true;
    }

    throw new Error(CMSIS_DAP_HW_UNSUPPORTED);
  }
}
