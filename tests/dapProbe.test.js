import { describe, it, expect } from 'vitest';
import { DapProbe, DapHidTransport, SwdTarget, CORTEX, describeCpuid } from '../src/utils/dapLink';
import { CmsisDapClient } from '../src/utils/cmsisDapDriver';
import {
  JtagClient, JtagEngine, TAP_NEXT, tmsPath, hexToBits, bitsToHex, parseIdChain, parseSvf, runSvf, decodeIdcode
} from '../src/utils/jtagDriver';

const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// A CMSIS-DAP probe with a Cortex-M4 on SWD and a JTAG chain, answering the
// real command bytes.
function fakeProbe({ packetSize = 64, chain = [], swdAlive = true } = {}) {
  const mem = new Map();
  const core = { regs: new Array(21).fill(0), halted: false, dcrdr: 0, demcr: 0 };
  core.regs[15] = 0x08000100;
  core.regs[13] = 0x20001000;
  const dp = { select: 0, ctrl: 0, csw: 0, tar: 0 };
  const log = [];

  const memRead = (a) => {
    if (a === CORTEX.CPUID) return 0x410fc241;
    if (a === CORTEX.DHCSR) return (core.halted ? CORTEX.S_HALT : 0) | CORTEX.S_REGRDY | 1;
    if (a === CORTEX.DCRDR) return core.dcrdr;
    if (a === CORTEX.DEMCR) return core.demcr;
    return mem.get(a) ?? 0;
  };
  const memWrite = (a, v) => {
    if (a === CORTEX.DHCSR && (v >>> 16) === 0xa05f) {
      if (v & CORTEX.C_HALT) core.halted = true;
      else if (v & CORTEX.C_STEP) { core.regs[15] += 2; core.halted = true; }
      else core.halted = false;
      return;
    }
    if (a === CORTEX.DCRSR) {
      const sel = v & 0x7f;
      if (v & 0x10000) core.regs[sel] = core.dcrdr; else core.dcrdr = core.regs[sel] >>> 0;
      return;
    }
    if (a === CORTEX.DCRDR) { core.dcrdr = v; return; }
    if (a === CORTEX.DEMCR) { core.demcr = v; return; }
    if (a === CORTEX.AIRCR && v === 0x05fa0004) { core.regs[15] = 0x08000000; core.halted = !!(core.demcr & 1); return; }
    if (a >= 0x08000000 && a < 0x08100000) return; // flash ignores plain writes
    mem.set(a, v >>> 0);
  };
  const apAccess = (reg, read, value) => {
    const addr = (dp.select & 0xf0) | reg;
    if (addr === 0xfc) return 0x24770011;
    if (addr === 0x00) { if (read) return dp.csw; dp.csw = value; return 0; }
    if (addr === 0x04) { if (read) return dp.tar; dp.tar = value >>> 0; return 0; }
    if (addr === 0x0c) {
      const out = read ? memRead(dp.tar) : (memWrite(dp.tar, value), 0);
      dp.tar = ((dp.tar & ~0x3ff) | ((dp.tar + 4) & 0x3ff)) >>> 0; // 1 KB auto-increment wrap
      return out;
    }
    return 0;
  };
  const dpAccess = (reg, read, value) => {
    if (reg === 0x0) return read ? 0x2ba01477 : 0;
    if (reg === 0x4) { if (read) return dp.ctrl & 0x50000000 ? (dp.ctrl | 0xa0000000) >>> 0 : dp.ctrl; dp.ctrl = value; return 0; }
    if (reg === 0x8) { if (!read) dp.select = value; return 0; }
    return 0;
  };

  // JTAG chain: index 0 nearest TDO.
  const tap = { state: 'RESET', reg: [], ir: chain.map((d) => d.idcodeOp ?? null) };
  const resetIr = () => { tap.ir = chain.map(() => 'RESET'); };
  resetIr();
  const drFor = (d, i) => {
    const op = tap.ir[i];
    if (op === 'RESET') return d.idcode != null ? Array.from({ length: 32 }, (_, k) => (d.idcode >>> k) & 1) : [0];
    if (op === d.idcodeOp) return Array.from({ length: 32 }, (_, k) => (d.idcode >>> k) & 1);
    if (op === d.sampleOp) return [...d.bsr];
    return [0];
  };
  const jtagClock = (tms, tdi) => {
    let out = 1;
    if (tap.state === 'DRSHIFT' || tap.state === 'IRSHIFT') { out = tap.reg.length ? tap.reg[0] : tdi; tap.reg = [...tap.reg.slice(1), tdi]; }
    tap.state = TAP_NEXT[tap.state][tms];
    if (tap.state === 'RESET') resetIr();
    if (tap.state === 'DRCAPTURE') tap.reg = chain.flatMap(drFor);
    if (tap.state === 'IRCAPTURE') tap.reg = chain.flatMap((d) => [1, ...new Array(d.irlen - 1).fill(0)]);
    if (tap.state === 'IRUPDATE') {
      let o = 0;
      tap.ir = chain.map((d) => { let v = 0; for (let k = 0; k < d.irlen; k++) v |= tap.reg[o + k] << k; o += d.irlen; return v === (1 << d.irlen) - 1 ? 'BYPASS' : v; });
    }
    return out;
  };

  const handle = (b) => {
    const cmd = b[0];
    log.push(cmd);
    switch (cmd) {
      case 0x00: {
        if (b[1] === 0xff) return [0, 2, packetSize & 0xff, packetSize >> 8];
        if (b[1] === 0xf0) return [0, 1, 0x03];
        if (b[1] === 0x02) return [0, 5, ...new TextEncoder().encode('Fake'), 0];
        if (b[1] === 0x04) return [0, 4, ...new TextEncoder().encode('2.1'), 0];
        return [0, 0];
      }
      case 0x02: return [0x02, b[1]];
      case 0x05: {
        const n = b[2];
        const out = [0x05, 0, 1];
        let off = 3;
        for (let i = 0; i < n; i++) {
          const req = b[off++];
          const ap = req & 1, read = (req & 2) >> 1, reg = req & 0x0c;
          let value = 0;
          if (!read) { value = rd32(b, off); off += 4; }
          if (!swdAlive) { out[1] = i; out[2] = 7; return out; }
          const v = ap ? apAccess(reg, read, value) : dpAccess(reg, read, value);
          if (read) out.push(...u32(v));
          out[1] = i + 1;
        }
        return out;
      }
      case 0x06: {
        const n = b[2] | (b[3] << 8);
        const req = b[4];
        const read = (req & 2) >> 1, reg = req & 0x0c;
        const out = [0x06, n & 0xff, n >> 8, 1];
        for (let i = 0; i < n; i++) {
          if (read) out.push(...u32(apAccess(reg, 1, 0)));
          else apAccess(reg, 0, rd32(b, 5 + i * 4));
        }
        return out;
      }
      case 0x14: {
        const count = b[1];
        let off = 2;
        const tdoBytes = [];
        for (let s = 0; s < count; s++) {
          const info = b[off++];
          const n = (info & 0x3f) || 64;
          const tms = (info >> 6) & 1;
          const cap = info >> 7;
          const nb = Math.ceil(n / 8);
          const tdi = b.slice(off, off + nb); off += nb;
          const outb = new Array(nb).fill(0);
          for (let i = 0; i < n; i++) {
            const o = jtagClock(tms, (tdi[i >> 3] >> (i & 7)) & 1);
            if (o) outb[i >> 3] |= 1 << (i & 7);
          }
          if (cap) tdoBytes.push(...outb);
        }
        if (2 + tdoBytes.length > packetSize) throw new Error('response larger than a packet');
        if (off > packetSize) throw new Error('command larger than a packet');
        return [0x14, 0, ...tdoBytes];
      }
      case 0x10: return [0x10, 0x8f];
      default: return [cmd, 0];
    }
  };

  const transport = {
    kind: 'usb', packetSize,
    async open() {}, async close() {},
    async transfer(bytes) {
      if (bytes.length > packetSize) throw new Error(`command of ${bytes.length} bytes exceeds the ${packetSize}-byte packet`);
      return Uint8Array.from(handle(Array.from(bytes)));
    }
  };
  return { transport, mem, core, log, tap };
}

async function attached(opts) {
  const fake = fakeProbe(opts);
  const probe = await new DapProbe(fake.transport).open();
  const client = new CmsisDapClient(() => {});
  const info = await client.connectHardware({ probe });
  return { client, info, ...fake };
}

describe('CMSIS-DAP over SWD', () => {
  it('attaches, reads the DP ID and names the core', async () => {
    const { info } = await attached();
    expect(info.dpidr).toBe(0x2ba01477);
    expect(info.core).toBe('Cortex-M4 r0p1');
    expect(info.probe).toBe('Fake');
  });

  it('halts, reads registers, steps and resumes', async () => {
    const { client, core } = await attached();
    core.regs[0] = 0x1234;
    const regs = await client.halt();
    expect(core.halted).toBe(true);
    expect(regs[0]).toBe(0x1234);
    expect(regs[15]).toBe(0x08000100);
    expect(regs[13]).toBe(0x20001000);
    const after = await client.step();
    expect(after[15]).toBe(0x08000102);
    await client.resume();
    expect(core.halted).toBe(false);
  });

  it('refuses to read registers while the core runs', async () => {
    const { client } = await attached();
    await expect(client.readRegisters()).rejects.toThrow(/Halt the CPU first/);
  });

  it('reads memory across a 1 KB auto-increment boundary in packet-sized blocks', async () => {
    const { client, mem } = await attached();
    for (let i = 0; i < 40; i++) mem.set(0x200003c0 + i * 4, 0x1000 + i);
    const words = await client.readMemory(0x200003c0, 40);
    expect(words.map((w) => w.value)).toEqual(Array.from({ length: 40 }, (_, i) => 0x1000 + i));
    expect(words[39].address).toBe(0x200003c0 + 39 * 4);
  });

  it('writes a word and checks it by reading back', async () => {
    const { client, mem } = await attached();
    expect(await client.writeMemoryWord(0x20000010, 0xdeadbeef)).toBe(0xdeadbeef);
    expect(mem.get(0x20000010)).toBe(0xdeadbeef);
    expect(await client.writeMemoryWord(0x08000000, 0x1)).toBe(0); // flash: read-back differs
  });

  it('resets and halts at the reset vector', async () => {
    const { client, core } = await attached();
    const regs = await client.reset({ halt: true });
    expect(core.halted).toBe(true);
    expect(regs[15]).toBe(0x08000000);
    expect(core.demcr & 1).toBe(0); // vector catch cleared again
  });

  it('explains a target that does not answer', async () => {
    const fake = fakeProbe({ swdAlive: false });
    const probe = await new DapProbe(fake.transport).open();
    await expect(new CmsisDapClient(() => {}).connectHardware({ probe })).rejects.toThrow(/no answer from the target/);
  });

  it('names Cortex-M cores from CPUID', () => {
    expect(describeCpuid(0x410cc601)).toBe('Cortex-M0+ r0p1');
    expect(describeCpuid(0x12345678)).toMatch(/unknown/);
  });

  it('talks to v1 probes through 64-byte HID reports', async () => {
    const listeners = {};
    const sent = [];
    const dev = {
      opened: false,
      collections: [{ outputReports: [{ items: [{ reportCount: 64 }] }] }],
      async open() { this.opened = true; },
      async close() {},
      addEventListener(t, f) { listeners[t] = f; },
      removeEventListener() {},
      async sendReport(id, data) {
        sent.push(data);
        const reply = new Uint8Array(64);
        reply.set([0x00, 2, 64, 0]);
        setTimeout(() => listeners.inputreport({ data: new DataView(reply.buffer) }), 0);
      }
    };
    const t = new DapHidTransport(dev);
    await t.open();
    const r = await t.transfer([0x00, 0xff]);
    expect(sent[0].length).toBe(64);
    expect(Array.from(r.slice(0, 4))).toEqual([0, 2, 64, 0]);
  });
});

describe('JTAG engine', () => {
  it('finds the shortest TMS paths', () => {
    expect(tmsPath('IDLE', 'DRSHIFT')).toEqual([1, 0, 0]);
    expect(tmsPath('IDLE', 'IRSHIFT')).toEqual([1, 1, 0, 0]);
    expect(tmsPath('DREXIT1', 'IDLE')).toEqual([1, 0]);
    expect(tmsPath('IRPAUSE', 'DRPAUSE')).toEqual([1, 1, 1, 0, 1, 0]);
    expect(tmsPath('DRSHIFT', 'RESET')).toEqual([1, 1, 1, 1, 1]);
  });

  it('converts SVF hex to bits and back', () => {
    expect(hexToBits('09', 6)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(bitsToHex(hexToBits('03628093', 32))).toBe('03628093');
  });

  it('splits SVF into statements, dropping comments', () => {
    const s = parseSvf('! hi\nSIR 6 TDI (09); // c\nSDR 32\n TDI (0)\n TDO (1);');
    expect(s.map((x) => x.cmd)).toEqual(['SIR', 'SDR']);
    expect(s[1].line).toBe(3);
  });

  it('decodes IDCODEs, including unknown parts', () => {
    expect(decodeIdcode(0x03628093)).toMatchObject({ mfr: 'Xilinx', part: 'XC6SLX9' });
    expect(decodeIdcode(0x16d4a093).mfr).toBe('Xilinx / AMD');
    expect(() => parseIdChain(new Array(64).fill(0))).toThrow(/stuck low/);
  });
});

const XC6 = { idcode: 0x03628093, irlen: 6, idcodeOp: 0x09, sampleOp: 0x01, bsr: [1, 0, 1, 1, 0, 0, 1, 0, 1, 1] };
const ARMDP = { idcode: 0x4ba00477, irlen: 4, idcodeOp: 0x0e, sampleOp: null, bsr: [] };
const NOID = { idcode: null, irlen: 8, idcodeOp: null, sampleOp: null, bsr: [] };

async function jtag(chain, packetSize = 64) {
  const fake = fakeProbe({ chain, packetSize });
  const probe = await new DapProbe(fake.transport).open();
  const client = new JtagClient(() => {});
  await client.connectHardware({ probe });
  return { client, ...fake };
}

describe('JTAG over CMSIS-DAP', () => {
  it('scans a chain with IDCODE and BYPASS-only devices', async () => {
    const { client } = await jtag([XC6, NOID, ARMDP]);
    const devs = await client.scanChain();
    expect(devs.map((d) => d.idcode)).toEqual([0x03628093, null, 0x4ba00477]);
    expect(devs[1].bypass).toBe(true);
    expect(devs[0].part).toBe('XC6SLX9');
    expect(client.tapState).toBe('Run-Test/Idle');
  });

  it('reports an empty chain', async () => {
    const { client } = await jtag([]);
    await expect(client.scanChain()).rejects.toThrow(/No devices answered/);
  });

  it('plays SVF and checks TDO with a mask', async () => {
    const { client } = await jtag([XC6]);
    const r = await client.playSvf('ENDIR IDLE;\nENDDR IDLE;\nSTATE RESET IDLE;\nSIR 6 TDI (09);\nSDR 32 TDI (00000000) TDO (03628093) MASK (0FFFFFFF);\nRUNTEST 100 TCK;\n');
    expect(r).toMatchObject({ statements: 6, checks: 1 });
  });

  it('stops at the first TDO mismatch with the line number', async () => {
    const { client } = await jtag([XC6]);
    await expect(client.playSvf('STATE RESET;\nSIR 6 TDI (09);\nSDR 32 TDI (0) TDO (12345678);'))
      .rejects.toThrow(/Line 3: SDR TDO mismatch/);
  });

  it('uses HIR/HDR/TIR/TDR to address one device in a chain', async () => {
    const { client } = await jtag([ARMDP, XC6]);
    // XC6 is index 1 (TDI side): ARMDP (index 0, TDO end) is the header.
    const svf = 'STATE RESET;\nHIR 4;\nHDR 1;\nTIR 0;\nTDR 0;\nSIR 6 TDI (09);\nSDR 32 TDI (0) TDO (03628093);';
    expect((await client.playSvf(svf)).checks).toBe(1);
  });

  it('samples a device\'s boundary-scan register', async () => {
    const { client } = await jtag([ARMDP, XC6]);
    await client.scanChain();
    const cells = await client.sampleBoundary({ target: 1, irLengths: [4, 6], opcode: 0x01, bsrLength: XC6.bsr.length });
    expect(cells).toEqual(XC6.bsr);
  });

  it('keeps every packet within the probe packet size on long shifts', async () => {
    const { client } = await jtag([XC6], 64);
    const long = 'STATE RESET;\nSIR 6 TDI (3F);\n' + `SDR 2000 TDI (${'A'.repeat(500)});\nRUNTEST 5000 TCK;\n`;
    expect((await client.playSvf(long)).statements).toBe(4);
  });

  it('engine leaves Shift with TMS=1 on the last bit and ends in the requested state', async () => {
    const fake = fakeProbe({ chain: [XC6] });
    const probe = await new DapProbe(fake.transport).open();
    const e = new JtagEngine(probe);
    e.goto('IDLE');
    e.shift('IR', hexToBits('09', 6), { endState: 'DRPAUSE' });
    await e.flush();
    expect(e.state).toBe('DRPAUSE');
    expect(fake.tap.state).toBe('DRPAUSE');
  });

  it('runSvf rejects unknown commands', async () => {
    const fake = fakeProbe({ chain: [XC6] });
    const probe = await new DapProbe(fake.transport).open();
    await expect(runSvf(new JtagEngine(probe), 'BOGUS 1;')).rejects.toThrow(/unknown SVF command/);
  });
});
