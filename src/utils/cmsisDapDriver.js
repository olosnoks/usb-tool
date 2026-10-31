/**
 * CMSIS-DAP / ARM Cortex-M SWD In-System Debugger Driver
 * Connects to CMSIS-DAP probes (DAPLink, Raspberry Pi Debug Probe, micro:bit,
 * LPC-Link2, EDBG) over WebUSB (v2) or WebHID (v1). Halts, steps and resets the
 * core, and reads registers and memory over SWD. ST-Link is not CMSIS-DAP.
 */

import { DapProbe, SwdTarget, requestDapTransport, describeCpuid, CORTEX } from './dapLink';

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

export class CmsisDapClient {
  constructor(logger = console.log) {
    this.probe = null;
    this.target = null;
    this.info = null;
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
   * Connect a real probe and attach to the target over SWD.
   * kind: 'usb' (CMSIS-DAP v2, faster) or 'hid' (v1, older DAPLink firmware).
   * `probe` (an opened DapProbe) is for tests.
   */
  async connectHardware({ kind = 'usb', probe = null, clockHz = 1_000_000 } = {}) {
    const p = probe || await new DapProbe(await requestDapTransport(kind)).open();
    try {
      if (p.capabilities && !p.capabilities.swd) throw new Error(`${p.product} does not support SWD.`);
      const target = new SwdTarget(p);
      const { dpidr } = await target.connect({ clockHz });
      const cpuid = await target.readWord(CORTEX.CPUID);
      const status = await target.coreStatus();
      this.probe = p;
      this.target = target;
      this.connected = true;
      this.simulated = false;
      this.targetState = status.halted ? 'halted' : 'running';
      this.info = {
        probe: p.product,
        firmware: p.firmware,
        transport: p.transport.kind === 'hid' ? 'WebHID (CMSIS-DAP v1)' : 'WebUSB (CMSIS-DAP v2)',
        dpidr,
        cpuid,
        core: describeCpuid(cpuid)
      };
      this.log(`Attached through ${p.product}: DPIDR 0x${dpidr.toString(16).toUpperCase()}, ${this.info.core}.`);
      return this.info;
    } catch (e) {
      try { await p.close(); } catch (x) { /* ignore */ }
      throw e;
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

  async disconnect() {
    const p = this.probe;
    this.probe = null;
    this.target = null;
    if (p) {
      try { await p.disconnect(); } catch (e) { /* ignore */ }
      try { await p.close(); } catch (e) { /* ignore */ }
    }
    this.info = null;
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

    await this.target.halt();
    this.targetState = 'halted';
    const regs = await this.target.readCoreRegisters();
    this.log(`CPU halted at PC 0x${regs[15].toString(16).toUpperCase()}`);
    return regs;
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

    await this.target.resume();
    this.targetState = 'running';
    return true;
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

    await this.target.step();
    this.targetState = 'halted';
    return this.target.readCoreRegisters();
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

    if (this.targetState !== 'halted') throw new Error('Halt the CPU first: core registers are only readable while halted.');
    return this.target.readCoreRegisters();
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

    const values = await this.target.readWords(address & ~3, wordCount);
    return values.map((value, i) => ({ address: ((address & ~3) + i * 4) >>> 0, value }));
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

    await this.target.writeWord(address & ~3, value >>> 0);
    const back = await this.target.readWord(address & ~3);
    if (back !== (value >>> 0)) this.log(`Read back 0x${back.toString(16).toUpperCase()}: the location is read-only, a peripheral register, or flash.`);
    else this.log('Write confirmed by read-back.');
    return back;
  }

  /** Reset the target; with halt, stop at the first instruction. */
  async reset({ halt = false } = {}) {
    if (!this.connected) throw new Error('Probe not connected.');
    if (this.simulated) {
      this.initVirtualState();
      this.targetState = halt ? 'halted' : 'running';
      return halt ? Array.from(this.virtualRegisters) : null;
    }
    await this.target.reset({ halt });
    this.targetState = halt ? 'halted' : 'running';
    this.log(halt ? 'Reset and halted at the reset vector.' : 'Target reset.');
    return halt ? this.target.readCoreRegisters() : null;
  }

  /** Poll whether the core is halted (e.g. hit a breakpoint) or running. */
  async pollState() {
    if (!this.connected || this.simulated) return this.targetState;
    const st = await this.target.coreStatus();
    this.targetState = st.halted ? 'halted' : 'running';
    return this.targetState;
  }
}
