import { describe, it, expect } from 'vitest';
import {
  Stusb4500, Stusb4500Nvm, NVM, decodeNvm, encodeNvmPdos, nvmMatchesRam, nvmToText, nvmFromText, encodeSinkPdo, STUSB4500, UsbPdClient
} from '../src/utils/usbPdDriver';

// NVM image whose PDOs are: 3 PDOs, 5 V/1.5 A, 15 V/1.5 A, 20 V/1.5 A.
function nvmImage() {
  const s = [0, 1, 2, 3, 4].map(() => new Uint8Array(8));
  s[0].set([0x00, 0x00, 0xb0, 0xaa, 0x00, 0x45, 0x00, 0x00]);
  s[3][2] = (5 << 4) | (3 << 1) | 0x01; // I1 = 1.5 A, 3 PDOs, keep bit 0
  s[3][4] = 0x50 | 5;                   // I2 = 1.5 A (upper nibble is something else)
  s[3][5] = (5 << 4) | 0x0a;            // I3 = 1.5 A
  const v2 = 15 * 20;
  const v3 = 20 * 20;
  s[4][0] = 0x15 | ((v2 & 3) << 6);
  s[4][1] = v2 >> 2;
  s[4][2] = v3 & 0xff;
  s[4][3] = 0x08 | (v3 >> 8);
  return s;
}

/** An STUSB4500 register file with the NVM controller state machine. */
function fakeChip(nvm = nvmImage()) {
  const regs = new Uint8Array(256);
  regs[STUSB4500.DEVICE_ID] = 0x25;
  regs[STUSB4500.DPM_PDO_NUMB] = 3;
  const put32 = (r, v) => { regs[r] = v & 0xff; regs[r + 1] = (v >>> 8) & 0xff; regs[r + 2] = (v >>> 16) & 0xff; regs[r + 3] = v >>> 24; };
  put32(STUSB4500.DPM_SNK_PDO1, encodeSinkPdo(0x00019000, 5, 1.5));
  put32(STUSB4500.DPM_SNK_PDO1 + 4, encodeSinkPdo(0x00019000, 15, 1.5));
  put32(STUSB4500.DPM_SNK_PDO1 + 8, encodeSinkPdo(0x00019000, 20, 1.5));
  const st = { nvm: nvm.map((x) => Uint8Array.from(x)), ser: 0, pl: new Uint8Array(8), log: [] };
  const exec = () => {
    const ctrl0 = regs[NVM.CTRL_0];
    const op = regs[NVM.CTRL_1] & NVM.OPCODE;
    const unlocked = regs[NVM.PASSWORD_REG] === NVM.PASSWORD && (ctrl0 & NVM.PWR) && (ctrl0 & NVM.RST_N);
    st.log.push(op);
    if (unlocked) {
      const sect = ctrl0 & NVM.SECT;
      if (op === NVM.READ) regs.set(st.nvm[sect], NVM.RW_BUFFER);
      if (op === NVM.WRITE_SER) st.ser = (regs[NVM.CTRL_1] & NVM.SER) >> 3;
      if (op === NVM.ERASE_SECTOR) for (let i = 0; i < 5; i++) if (st.ser & (1 << i)) st.nvm[i].fill(0);
      if (op === NVM.WRITE_PL) st.pl = regs.slice(NVM.RW_BUFFER, NVM.RW_BUFFER + 8);
      if (op === NVM.PROG_SECTOR) st.nvm[sect] = st.pl.map((b, i) => st.nvm[sect][i] | b);
    }
    regs[NVM.CTRL_0] = ctrl0 & ~NVM.REQ;
  };
  return {
    st, regs,
    async i2cReadRegisters(addr, reg, n) { return Array.from(regs.subarray(reg, reg + n)); },
    async i2cWriteRegister(addr, reg, values) {
      regs.set(values, reg);
      if (reg === NVM.CTRL_0 && values[0] & NVM.REQ) exec();
    }
  };
}

describe('STUSB4500 NVM', () => {
  it('decodes PDO count, voltages and currents', () => {
    expect(decodeNvm(nvmImage())).toEqual({
      pdoCount: 3,
      pdos: [{ voltageV: 5, index: 5, currentA: 1.5 }, { voltageV: 15, index: 5, currentA: 1.5 }, { voltageV: 20, index: 5, currentA: 1.5 }]
    });
  });

  it('encodes new PDOs and leaves the neighbouring bits alone', () => {
    const before = nvmImage();
    const after = encodeNvmPdos(before, { pdoCount: 2, pdos: [{ currentA: 3 }, { voltageV: 9, currentA: 2 }, { voltageV: 12, currentA: 1 }] });
    expect(decodeNvm(after)).toMatchObject({ pdoCount: 2, pdos: [{ currentA: 3 }, { voltageV: 9, currentA: 2 }, { voltageV: 12, currentA: 1 }] });
    expect(after[3][2] & 0x01).toBe(1);
    expect(after[3][4] >> 4).toBe(5);
    expect(after[3][5] & 0x0f).toBe(0x0a);
    expect(after[4][0] & 0x3f).toBe(0x15);
    expect(after[4][3] & 0xfc).toBe(0x08);
    expect(Array.from(after[0])).toEqual(Array.from(before[0]));
    expect(() => encodeNvmPdos(before, { pdoCount: 2, pdos: [{ currentA: 1.1 }, { voltageV: 9, currentA: 2 }, { voltageV: 9, currentA: 2 }] })).toThrow(/current steps/);
    expect(() => encodeNvmPdos(before, { pdoCount: 2, pdos: [{ currentA: 1 }, { voltageV: 25, currentA: 2 }, { voltageV: 9, currentA: 2 }] })).toThrow(/5-20 V/);
  });

  it('checks the layout against the power-up PDOs', async () => {
    const chip = fakeChip();
    const ram = await new Stusb4500(chip).readSinkPdos();
    expect(nvmMatchesRam(decodeNvm(nvmImage()), ram)).toEqual({ ok: true });
    const other = encodeNvmPdos(nvmImage(), { pdoCount: 3, pdos: [{ currentA: 1.5 }, { voltageV: 9, currentA: 1.5 }, { voltageV: 20, currentA: 1.5 }] });
    expect(nvmMatchesRam(decodeNvm(other), ram)).toMatchObject({ ok: false, reason: expect.stringMatching(/PDO2/) });
  });

  it('reads, erases, programs and verifies through the controller sequence', async () => {
    const chip = fakeChip();
    const nvm = new Stusb4500Nvm(new Stusb4500(chip));
    const read = await nvm.read();
    expect(read.map((s) => Array.from(s))).toEqual(nvmImage().map((s) => Array.from(s)));
    const next = encodeNvmPdos(read, { pdoCount: 2, pdos: [{ currentA: 1.5 }, { voltageV: 12, currentA: 3 }, { voltageV: 20, currentA: 1.5 }] });
    await nvm.write(next);
    expect(decodeNvm(chip.st.nvm).pdos[1]).toMatchObject({ voltageV: 12, currentA: 3 });
    expect(chip.st.log).toEqual(expect.arrayContaining([NVM.WRITE_SER, NVM.SOFT_PROG_SECTOR, NVM.ERASE_SECTOR, NVM.WRITE_PL, NVM.PROG_SECTOR]));
    expect(chip.regs[NVM.PASSWORD_REG]).toBe(0); // left the NVM locked
  });

  it('refuses unverified writes in the client and round-trips backups', async () => {
    const chip = fakeChip();
    const c = new UsbPdClient(() => {});
    c.pd = new Stusb4500(chip);
    c.bootSink = await c.pd.readSinkPdos();
    expect((await c.readNvm()).match.ok).toBe(true);
    await c.writeNvmPdos({ pdoCount: 2, pdos: [{ currentA: 1.5 }, { voltageV: 9, currentA: 2 }, { voltageV: 20, currentA: 1.5 }] });
    c.bootSink = { count: 1, pdos: [{ voltageV: 5, currentA: 1.5 }] };
    await expect(c.writeNvmPdos({ pdoCount: 1, pdos: [{ currentA: 1.5 }, { voltageV: 9, currentA: 2 }, { voltageV: 20, currentA: 1.5 }] })).rejects.toThrow(/not verified/);
    const text = nvmToText(nvmImage());
    expect(nvmFromText(text).map((s) => Array.from(s))).toEqual(nvmImage().map((s) => Array.from(s)));
    expect(() => nvmFromText('00 11')).toThrow(/five lines/);
  });
});
