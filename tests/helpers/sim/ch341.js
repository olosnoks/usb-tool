// Test-only simulated CH341A programmer transport (virtual W25Q64 SPI flash on
// CS0 + a 24C02 EEPROM on I2C 0x50). Recovered from ch341aDriver.js (commit
// c66f313^); parses the same CH341 byte packets the real chip gets, so the SPI
// flash / I2C protocol code can be tested without hardware. Not imported by app code.
import { SPI_CMD, CH341_USB, reverseBits } from '../../../src/utils/ch341aDriver.js';

const MB = 1024 * 1024;
const REVERSE = Uint8Array.from({ length: 256 }, (_, i) => reverseBits(i));

// --- Simulated programmer (speaks the CH341 byte protocol) -----------------------------

/**
 * A CH341A with a virtual SPI flash on CS0 and a 24C02 on I2C address 0x50.
 * It parses the same packets the real chip gets, so tests exercise the protocol code.
 */
export function createSimulatedCh341({ jedecId = 0xEF4017, size = 8 * MB, eepromSize = 256, eepromPage = 8, sfdp = true } = {}) {
  const flash = new Uint8Array(size).fill(0xff);
  const header = new TextEncoder().encode("AMI BIOS // SKON'S CH341A PROGRAMMER RECOVERY DUMP");
  flash.set(header, 0);
  flash.set([0x54, 0xee, 0x75, 0x12, 0x34, 0x56], 0x1000);
  const eeprom = new Uint8Array(eepromSize).fill(0xff);
  eeprom.set(new TextEncoder().encode('SIM-EEPROM'), 0);
  const state = { flash, eeprom, sr1: 0x1c, sr2: 0x02, sr3: 0x00, wel: false, fourByte: size > 16 * MB, csLow: false, txn: [], resp: [], log: [], simulated: true };
  const inbox = [];

  const sfdpTable = (() => {
    const t = new Uint8Array(0x100).fill(0xff);
    t.set([0x53, 0x46, 0x44, 0x50, 6, 1, 0, 0xff, 0, 6, 1, 16, 0x30, 0, 0, 0xff]);
    const d2 = size * 8 - 1;
    t.set([0xe5, 0x20, 0xf1, 0xff, d2 & 0xff, (d2 >> 8) & 0xff, (d2 >> 16) & 0xff, (d2 >>> 24) & 0xff], 0x30);
    return t;
  })();

  const addrLen = (op) => ([SPI_CMD.READ4, SPI_CMD.PAGE_PROG4, SPI_CMD.SECTOR_ERASE4].includes(op) ? 4 : 3);
  const addrOf = (b, n) => { let a = 0; for (let i = 0; i < n; i++) a = a * 256 + b[1 + i]; return a; };

  // Answer one SPI byte given everything clocked so far in this CS-low transaction.
  const spiByte = (b) => {
    const t = state.txn;
    t.push(b);
    const op = t[0];
    const i = t.length - 1;
    if (op === SPI_CMD.JEDEC_ID) return [jedecId >> 16, (jedecId >> 8) & 0xff, jedecId & 0xff][i - 1] ?? 0xff;
    if (op === SPI_CMD.RDSR) return state.sr1 | (state.wel ? 2 : 0);
    if (op === SPI_CMD.RDSR2) return state.sr2;
    if (op === SPI_CMD.RDSR3) return state.sr3;
    if (op === SPI_CMD.SFDP && sfdp) { const a = addrOf(t, 3); return i >= 5 ? sfdpTable[(a + i - 5) & 0xff] : 0xff; }
    if (op === SPI_CMD.READ || op === SPI_CMD.READ4) { const n = addrLen(op); if (i <= n) return 0xff; return flash[(addrOf(t, n) + i - n - 1) % size]; }
    return 0xff;
  };

  // Commands that change the chip take effect when CS goes high, like a real flash.
  const endTxn = () => {
    const t = state.txn;
    state.txn = [];
    if (!t.length) return;
    const op = t[0];
    state.log.push(op);
    const protectedBlocks = (state.sr1 >> 2) & 7;
    if (op === SPI_CMD.WREN) state.wel = true;
    else if (op === SPI_CMD.WRDI) state.wel = false;
    else if (op === SPI_CMD.WRSR && state.wel) { state.sr1 = t[1] & 0xfc; if (t.length > 2) state.sr2 = t[2]; state.wel = false; }
    else if ((op === SPI_CMD.SECTOR_ERASE || op === SPI_CMD.SECTOR_ERASE4) && state.wel) {
      if (!protectedBlocks) { const a = addrOf(t, addrLen(op)) & ~0xfff; flash.fill(0xff, a, a + 4096); }
      state.wel = false;
    } else if ((op === SPI_CMD.CHIP_ERASE || op === 0x60) && state.wel) {
      if (!protectedBlocks) flash.fill(0xff);
      state.wel = false;
    } else if ((op === SPI_CMD.PAGE_PROG || op === SPI_CMD.PAGE_PROG4) && state.wel) {
      const n = addrLen(op);
      const a = addrOf(t, n);
      if (!protectedBlocks) {
        const page = a & ~0xff;
        t.slice(n + 1).forEach((v, k) => { const at = page + ((a + k) & 0xff); flash[at] &= v; });
      }
      state.wel = false;
    }
  };

  // I2C: a 24Cxx at 0x50-0x57 with an address pointer; page writes commit at STOP.
  const i2c = { ptr: 0 };
  const runI2c = (cmds) => {
    let t = null; // the current START .. STOP transfer
    const commit = () => {
      if (!t || t.rw || !t.present || !t.data.length) return;
      const page = i2c.ptr - (i2c.ptr % eepromPage);
      t.data.forEach((v, k) => { eeprom[page + ((i2c.ptr - page + k) % eepromPage)] = v; });
    };
    const onByte = (b) => {
      if (t.phase === 'addr') { t.dev = b >> 1; t.rw = b & 1; t.present = (t.dev & 0x78) === 0x50; t.phase = t.rw ? 'read' : 'word'; return; }
      if (t.phase === 'word') { i2c.ptr = (((t.dev & 7) << 8) | b) % eepromSize; t.phase = 'data'; return; }
      if (t.phase === 'data') t.data.push(b);
    };
    for (let i = 1; i < cmds.length;) {
      const c = cmds[i++];
      if (c === CH341_USB.I2C_STM_END) break;
      if (c === CH341_USB.I2C_STM_START) { commit(); t = { phase: 'addr', data: [] }; continue; }
      if (c === CH341_USB.I2C_STM_STOP) { commit(); t = null; continue; }
      if ((c & 0xf8) === CH341_USB.I2C_STM_SET) continue;
      if ((c & 0xc0) === CH341_USB.I2C_STM_OUT) {
        const n = c & 0x3f;
        for (let k = 0; k < n; k++) if (t) onByte(cmds[i++]); else i++;
        continue;
      }
      if ((c & 0xc0) === CH341_USB.I2C_STM_IN) {
        const n = (c & 0x3f) || 1;
        const bytes = [];
        for (let k = 0; k < n; k++) {
          bytes.push(t?.present && t.rw ? eeprom[i2c.ptr] : 0xff);
          i2c.ptr = (i2c.ptr + 1) % eepromSize;
        }
        inbox.push(Uint8Array.from(bytes));
      }
    }
    commit();
  };

  return {
    state,
    async open() {},
    async close() {},
    async out(bytes) {
      for (let p = 0; p < bytes.length; p += CH341_USB.PACKET) {
        const pkt = Array.from(bytes.subarray(p, p + CH341_USB.PACKET));
        const cmd = pkt[0];
        if (cmd === CH341_USB.CMD_UIO_STREAM) {
          for (const c of pkt.slice(1)) {
            if (c === CH341_USB.UIO_STM_END) break;
            if ((c & 0xc0) === CH341_USB.UIO_STM_OUT) {
              const low = !(c & 1);
              if (state.csLow && !low) endTxn();
              if (!state.csLow && low) state.txn = [];
              state.csLow = low;
            }
          }
        } else if (cmd === CH341_USB.CMD_SPI_STREAM) {
          const out = pkt.slice(1).map((b) => REVERSE[state.csLow ? spiByte(REVERSE[b]) : 0xff]);
          inbox.push(Uint8Array.from(out));
        } else if (cmd === CH341_USB.CMD_I2C_STREAM) {
          runI2c(pkt);
        }
      }
    },
    async in(maxLength) {
      const next = inbox.shift();
      if (!next) return new Uint8Array(0);
      if (next.length > maxLength) { inbox.unshift(next.subarray(maxLength)); return next.subarray(0, maxLength); }
      return next;
    }
  };
}
