import { describe, it, expect } from 'vitest';
import {
  readBytes, writeBytes, findRttControlBlock, RttClient, ItmParser, itmText, configureSwoTarget, TRACE,
  Breakpoints, Watchpoints, FPB, DWT, parseElf, parseFlm, flmSectors, parsePdsc, loadFirmwareImage, programFlash, FlashAlgoRunner,
  buildSymbolTable, formatSymbol, symbolAddress, eraseChipWithAlgorithm, nrf52EraseAll, NRF52_CTRL_AP
} from '../src/utils/cortexDebug';
import { CmsisDapClient } from '../src/utils/cmsisDapDriver';
import { DapProbe } from '../src/utils/dapLink';

const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];

// A word-addressed Cortex-M with SwdTarget's interface. `functions` maps a
// code address to a JS routine that runs when the core resumes there.
class FakeCore {
  constructor() {
    this.mem = new Map();
    this.regs = new Array(21).fill(0);
    this.halted = true;
    this.functions = new Map();
    this.flash = { base: 0x08000000, size: 0x10000 };
    this.calls = [];
    this.steps = 0;
  }
  isFlash(a) { return a >= this.flash.base && a < this.flash.base + this.flash.size; }
  async readWord(a) { return this.mem.get(a >>> 0) ?? (this.isFlash(a) ? 0xffffffff : 0); }
  async writeWord(a, v) { if (!this.isFlash(a)) this.mem.set(a >>> 0, v >>> 0); }
  async readWords(a, n) { const out = []; for (let i = 0; i < n; i++) out.push(await this.readWord(a + i * 4)); return out; }
  async writeWords(a, vals) { for (let i = 0; i < vals.length; i++) await this.writeWord(a + i * 4, vals[i]); }
  async readCoreRegister(sel) { return this.regs[sel] >>> 0; }
  async writeCoreRegister(sel, v) { this.regs[sel] = v >>> 0; }
  async halt() { this.halted = true; }
  async step() { this.steps++; this.regs[15] += 2; }
  async coreStatus() { return { halted: this.halted }; }
  async reset() { this.halted = true; }
  async resume() {
    const fn = this.functions.get(this.regs[15]);
    if (!fn) { this.halted = false; return; }
    this.calls.push(fn.name);
    this.regs[0] = fn.run(this) >>> 0;
    this.regs[15] = this.regs[14] & ~1; // returns into the BKPT
    this.halted = true;
  }
  bytesAt(a, n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(((this.mem.get((a + i) & ~3) ?? 0xffffffff) >>> (8 * ((a + i) & 3))) & 0xff);
    return out;
  }
  putBytes(a, bytes) {
    bytes.forEach((b, i) => {
      const w = (a + i) & ~3;
      const sh = 8 * ((a + i) & 3);
      const cur = this.mem.get(w) ?? 0xffffffff;
      this.mem.set(w, ((cur & ~(0xff << sh)) | (b << sh)) >>> 0);
    });
  }
}

describe('byte access', () => {
  it('reads and writes unaligned bytes without clobbering neighbours', async () => {
    const core = new FakeCore();
    await core.writeWord(0x20000000, 0x44332211);
    await core.writeWord(0x20000004, 0x88776655);
    expect(Array.from(await readBytes(core, 0x20000001, 5))).toEqual([0x22, 0x33, 0x44, 0x55, 0x66]);
    await writeBytes(core, 0x20000003, Uint8Array.from([0xaa, 0xbb]));
    expect(await core.readWord(0x20000000)).toBe(0xaa332211);
    expect(await core.readWord(0x20000004)).toBe(0x887766bb);
  });
});

describe('SEGGER RTT', () => {
  const setup = async () => {
    const core = new FakeCore();
    const cb = 0x20000400;
    const name = 0x20000300;
    core.putBytes(name, [...new TextEncoder().encode('Terminal'), 0]);
    core.putBytes(cb, [...new TextEncoder().encode('SEGGER RTT'), 0, 0, 0, 0, 0, 0, ...u32(2), ...u32(1)]);
    // up[0]: 64-byte buffer; up[1] unused; down[0]: 16-byte buffer
    core.putBytes(cb + 24, [...u32(name), ...u32(0x20000800), ...u32(64), ...u32(0), ...u32(0), ...u32(0)]);
    core.putBytes(cb + 48, new Array(24).fill(0));
    core.putBytes(cb + 72, [...u32(0), ...u32(0x20000900), ...u32(16), ...u32(0), ...u32(0), ...u32(0)]);
    return { core, cb };
  };

  it('finds the control block and lists channels', async () => {
    const { core, cb } = await setup();
    const at = await findRttControlBlock(core, { start: 0x20000000, size: 0x2000 });
    expect(at).toBe(cb);
    const rtt = new RttClient(core, at);
    const ch = await rtt.init();
    expect(ch.up.map((c) => c.name)).toEqual(['Terminal']);
    expect(ch.down).toHaveLength(1);
  });

  it('drains up data across the wrap and moves RdOff', async () => {
    const { core, cb } = await setup();
    const rtt = new RttClient(core, cb);
    await rtt.init();
    core.putBytes(0x20000800 + 60, [...new TextEncoder().encode('Hell')]);
    core.putBytes(0x20000800, [...new TextEncoder().encode('o!\n')]);
    await core.writeWord(cb + 24 + 12, 3);  // WrOff
    await core.writeWord(cb + 24 + 16, 60); // RdOff
    const [msg] = await rtt.poll();
    expect(new TextDecoder().decode(msg.bytes)).toBe('Hello!\n');
    expect(await core.readWord(cb + 24 + 16)).toBe(3);
    expect(await rtt.poll()).toEqual([]);
  });

  it('writes down data, wrapping and respecting free space', async () => {
    const { core, cb } = await setup();
    const rtt = new RttClient(core, cb);
    await rtt.init();
    await core.writeWord(cb + 72 + 12, 14); // WrOff
    await core.writeWord(cb + 72 + 16, 10); // RdOff: 11 bytes free
    const n = await rtt.write(0, new TextEncoder().encode('0123456789ABCDEF'));
    expect(n).toBe(11);
    expect(await core.readWord(cb + 72 + 12)).toBe(9);
    expect(core.bytesAt(0x20000900 + 14, 2)).toEqual([0x30, 0x31]);
    expect(String.fromCharCode(...core.bytesAt(0x20000900, 9))).toBe('23456789A');
  });
});

describe('SWO / ITM', () => {
  it('parses sync, stimulus, overflow and timestamps across chunk boundaries', () => {
    const p = new ItmParser();
    const all = [0, 0, 0, 0, 0, 0x80, 0x01, 0x48, 0x01, 0x69, 0x0b, 1, 2, 3, 4, 0x70, 0xc0, 0x81, 0x01, 0x09, 0x21];
    const out = [...p.push(all.slice(0, 7)), ...p.push(all.slice(7, 12)), ...p.push(all.slice(12))];
    expect(out.map((x) => x.type)).toEqual(['sync', 'stimulus', 'stimulus', 'stimulus', 'overflow', 'timestamp', 'stimulus']);
    expect(out[3]).toMatchObject({ port: 1, size: 4, value: 0x04030201 });
    expect(out[6]).toMatchObject({ port: 1, size: 1, value: 0x21 });
    expect(itmText(out)[0]).toBe('Hi');
  });

  it('programs the TPIU prescaler and ITM', async () => {
    const core = new FakeCore();
    const cfg = await configureSwoTarget(core, { cpuHz: 72_000_000, baud: 2_000_000, stm32: true });
    expect(cfg.prescaler).toBe(35);
    expect(await core.readWord(TRACE.TPIU_ACPR)).toBe(35);
    expect(await core.readWord(TRACE.TPIU_SPPR)).toBe(2);
    expect((await core.readWord(TRACE.DEMCR)) & TRACE.TRCENA).toBeTruthy();
    expect(await core.readWord(TRACE.ITM_LAR)).toBe(0xc5acce55);
    expect((await core.readWord(TRACE.DBGMCU_CR)) & 0x20).toBe(0x20);
  });
});

describe('breakpoints and watchpoints', () => {
  it('encodes FPB v1 and v2 comparators', async () => {
    const v1 = new FakeCore();
    await v1.writeWord(FPB.CTRL, 0x00000060);
    const bp1 = new Breakpoints(v1);
    expect(await bp1.init()).toBe(6);
    await bp1.set(0x08000102);
    expect(await v1.readWord(FPB.COMP0)).toBe(0x88000101 >>> 0);
    await expect(bp1.set(0x20000000)).rejects.toThrow(/below 0x20000000/);

    const v2 = new FakeCore();
    await v2.writeWord(FPB.CTRL, 0x10000040);
    const bp2 = new Breakpoints(v2);
    expect(await bp2.init()).toBe(4);
    await bp2.set(0x10000201);
    expect(await v2.readWord(FPB.COMP0)).toBe(0x10000201);
    await bp2.clear(0x10000200);
    expect(await v2.readWord(FPB.COMP0)).toBe(0);
  });

  it('runs out of comparators cleanly', async () => {
    const core = new FakeCore();
    await core.writeWord(FPB.CTRL, 0x00000020);
    const bp = new Breakpoints(core);
    await bp.init();
    await bp.set(0x100); await bp.set(0x200);
    await expect(bp.set(0x300)).rejects.toThrow(/All 2 hardware breakpoints/);
  });

  it('sets DWT watchpoints', async () => {
    const core = new FakeCore();
    await core.writeWord(DWT.CTRL, 0x40000000);
    const wp = new Watchpoints(core);
    expect(await wp.init()).toBe(4);
    await wp.set(0x20000010, { size: 4, access: 'write' });
    expect(await core.readWord(DWT.COMP0)).toBe(0x20000010);
    expect(await core.readWord(DWT.COMP0 + 4)).toBe(2);
    expect(await core.readWord(DWT.COMP0 + 8)).toBe(6);
    await expect(wp.set(0x20000011, { size: 4 })).rejects.toThrow(/aligned/);
  });

  it('steps off a breakpoint before resuming', async () => {
    const core = new FakeCore();
    await core.writeWord(FPB.CTRL, 0x10000040);
    const client = new CmsisDapClient(() => {});
    Object.assign(client, { connected: true, simulated: false, target: core, info: { cpuid: 0x410fc241 } });
    await client.setBreakpoint(0x08000200);
    core.regs[15] = 0x08000200;
    await client.resume();
    expect(core.steps).toBe(1);
    expect(client.breakpoints.active).toEqual([0x08000200]);
  });
});

// --- A tiny ELF writer for test flash algorithms and firmware ------------

function buildElf({ sections = [], symbols = [], segments = [] }) {
  const names = ['', ...sections.map((s) => s.name), '.symtab', '.strtab', '.shstrtab'];
  const shstr = [];
  const nameOff = names.map((n) => { const o = shstr.length; shstr.push(...new TextEncoder().encode(n), 0); return o; });
  const strtab = [0];
  const symOff = symbols.map((s) => { const o = strtab.length; strtab.push(...new TextEncoder().encode(s.name), 0); return o; });
  const symtab = [...new Array(16).fill(0)];
  symbols.forEach((s, i) => symtab.push(...u32(symOff[i]), ...u32(s.value), ...u32(s.size || 0), s.func ? 0x12 : 0x11, 0, ...u16(s.shndx)));

  const body = [];
  const at = 52 + segments.length * 32;
  const place = (bytes) => { const o = at + body.length; body.push(...bytes); while (body.length % 4) body.push(0); return o; };
  const secOff = sections.map((s) => (s.nobits ? 0 : place(s.data)));
  const segOff = segments.map((s) => place(s.data));
  const symtabOff = place(symtab);
  const strtabOff = place(strtab);
  const shstrOff = place(shstr);
  const shoff = at + body.length;
  const n = sections.length;
  const sh = [...new Array(40).fill(0)];
  sections.forEach((s, i) => sh.push(...u32(nameOff[i + 1]), ...u32(s.nobits ? 8 : 1), ...u32(s.flags ?? 6), ...u32(s.addr), ...u32(secOff[i]), ...u32(s.nobits ? s.size : s.data.length), ...u32(0), ...u32(0), ...u32(4), ...u32(0)));
  sh.push(...u32(nameOff[n + 1]), ...u32(2), ...u32(0), ...u32(0), ...u32(symtabOff), ...u32(symtab.length), ...u32(n + 2), ...u32(1), ...u32(4), ...u32(16));
  sh.push(...u32(nameOff[n + 2]), ...u32(3), ...u32(0), ...u32(0), ...u32(strtabOff), ...u32(strtab.length), ...u32(0), ...u32(0), ...u32(1), ...u32(0));
  sh.push(...u32(nameOff[n + 3]), ...u32(3), ...u32(0), ...u32(0), ...u32(shstrOff), ...u32(shstr.length), ...u32(0), ...u32(0), ...u32(1), ...u32(0));
  const ph = [];
  segments.forEach((s, i) => ph.push(...u32(1), ...u32(segOff[i]), ...u32(s.vaddr ?? s.paddr), ...u32(s.paddr), ...u32(s.data.length), ...u32(s.data.length), ...u32(5), ...u32(4)));
  const hdr = [0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0, ...new Array(8).fill(0), ...u16(2), ...u16(40), ...u32(1), ...u32(0), ...u32(segments.length ? 52 : 0), ...u32(shoff), ...u32(0), ...u16(52), ...u16(32), ...u16(segments.length), ...u16(40), ...u16(n + 4), ...u16(n + 3)];
  return Uint8Array.from([...hdr, ...ph, ...body, ...sh]);
}

function testFlm() {
  const dev = [...u16(0x101), ...new TextEncoder().encode('TEST 64KB Flash'), ...new Array(128 - 15).fill(0), ...u16(1), ...u32(0x08000000), ...u32(0x10000), ...u32(0x400), ...u32(0), 0xff, 0, 0, 0, ...u32(100), ...u32(500),
    ...u32(0x4000), ...u32(0), ...u32(0x8000), ...u32(0x8000), ...u32(0xffffffff), ...u32(0xffffffff)];
  return buildElf({
    sections: [
      { name: 'PrgCode', addr: 0, data: new Array(0x40).fill(0x00) },
      { name: 'PrgData', addr: 0x40, data: [1, 2, 3, 4] },
      { name: 'PrgData', addr: 0x44, nobits: true, size: 12, flags: 3 },
      { name: 'DevDscr', addr: 0x1000, data: dev }
    ],
    symbols: [
      { name: 'FlashDevice', value: 0x1000, shndx: 4 },
      { name: 'Init', value: 0x01, shndx: 1, func: true },
      { name: 'UnInit', value: 0x05, shndx: 1, func: true },
      { name: 'EraseSector', value: 0x09, shndx: 1, func: true },
      { name: 'ProgramPage', value: 0x0d, shndx: 1, func: true },
      { name: 'EraseChip', value: 0x11, shndx: 1, func: true }
    ]
  });
}

function wireAlgorithm(core, runner, flm) {
  const at = (name) => runner.algoBase + flm.functions[name];
  const sectors = flmSectors(flm);
  core.functions.set(at('Init'), { name: 'Init', run: (c) => (c.regs[9] === runner.staticBase && c.regs[13] === runner.stackTop && c.regs[0] === 0x08000000 ? 0 : 1) });
  core.functions.set(at('UnInit'), { name: 'UnInit', run: () => 0 });
  core.functions.set(at('EraseSector'), {
    name: 'EraseSector',
    run: (c) => {
      const sec = sectors.find((s) => s.addr === c.regs[0]);
      if (!sec) return 1;
      for (let a = sec.addr; a < sec.addr + sec.size; a += 4) c.mem.delete(a);
      return 0;
    }
  });
  core.functions.set(at('ProgramPage'), {
    name: 'ProgramPage',
    run: (c) => {
      const [addr, size, buf] = c.regs;
      for (let i = 0; i < size; i += 4) c.mem.set(addr + i, c.mem.get(buf + i) ?? 0);
      return 0;
    }
  });
  core.functions.set(at('EraseChip'), { name: 'EraseChip', run: (c) => { for (const k of [...c.mem.keys()]) if (c.isFlash(k)) c.mem.delete(k); return 0; } });
}

describe('flash algorithms', () => {
  it('parses the device description, sectors and function offsets', () => {
    const flm = parseFlm(testFlm());
    expect(flm).toMatchObject({ name: 'TEST 64KB Flash', devAddr: 0x08000000, devSize: 0x10000, pageSize: 0x400, emptyValue: 0xff });
    expect(flm.functions).toMatchObject({ Init: 0, UnInit: 4, EraseSector: 8, ProgramPage: 12, EraseChip: 16 });
    expect(flm.image.length).toBe(0x50); // code + data + zero-init
    expect(flm.dataOffset).toBe(0x40);
    expect(flmSectors(flm)).toEqual([{ addr: 0x08000000, size: 0x4000 }, { addr: 0x08004000, size: 0x4000 }, { addr: 0x08008000, size: 0x8000 }]);
  });

  it('erases the touched sectors, programs pages and verifies', async () => {
    const core = new FakeCore();
    const flm = parseFlm(testFlm());
    const runner = new FlashAlgoRunner(core, flm, { ramBase: 0x20000000, ramSize: 0x4000 });
    wireAlgorithm(core, runner, flm);
    // Stale data in a sector that the image touches must be erased.
    core.mem.set(0x08000ffc, 0x12345678);
    const fw = Uint8Array.from({ length: 1500 }, (_, i) => i & 0xff);
    const segments = [{ addr: 0x08000000, data: fw }, { addr: 0x0800c002, data: Uint8Array.from([0xde, 0xad]) }];
    const progress = [];
    const r = await programFlash(core, flm, segments, { ramBase: 0x20000000, ramSize: 0x4000, onProgress: (p, f) => progress.push(p) });
    expect(r).toEqual({ sectors: 2, pages: 3 });
    expect(core.calls.filter((c) => c === 'EraseSector')).toHaveLength(2);
    expect(Array.from(await readBytes(core, 0x08000000, 1500))).toEqual(Array.from(fw));
    expect(await core.readWord(0x08000ffc)).toBe(0xffffffff);
    expect(await core.readWord(0x0800c000)).toBe(0xaddeffff);
    expect(progress).toContain('verify');
    expect(await core.readWord(0x20000000)).toBe(0xe7febe00);
  });

  it('uses EraseChip when asked', async () => {
    const core = new FakeCore();
    const flm = parseFlm(testFlm());
    wireAlgorithm(core, new FlashAlgoRunner(core, flm, { ramBase: 0x20000000, ramSize: 0x4000 }), flm);
    await programFlash(core, flm, [{ addr: 0x08000000, data: new Uint8Array(8) }], { ramBase: 0x20000000, ramSize: 0x4000, chipErase: true });
    expect(core.calls).toContain('EraseChip');
    expect(core.calls).not.toContain('EraseSector');
  });

  it('rejects images outside the flash and too little RAM', async () => {
    const core = new FakeCore();
    const flm = parseFlm(testFlm());
    await expect(programFlash(core, flm, [{ addr: 0x08010000, data: new Uint8Array(4) }], { ramBase: 0x20000000, ramSize: 0x4000 })).rejects.toThrow(/outside/);
    expect(() => new FlashAlgoRunner(core, flm, { ramBase: 0x20000000, ramSize: 0x200 })).toThrow(/needs/);
  });

  it('reports an algorithm failure', async () => {
    const core = new FakeCore();
    const flm = parseFlm(testFlm());
    const runner = new FlashAlgoRunner(core, flm, { ramBase: 0x20000000, ramSize: 0x4000 });
    wireAlgorithm(core, runner, flm);
    core.functions.get(runner.algoBase + flm.functions.ProgramPage).run = () => 1;
    await expect(programFlash(core, flm, [{ addr: 0x08000000, data: new Uint8Array(4) }], { ramBase: 0x20000000, ramSize: 0x4000 })).rejects.toThrow(/ProgramPage\(0x08000000\) failed/);
  });
});

describe('firmware images and packs', () => {
  it('loads HEX, ELF and raw binaries', () => {
    const hex = ':020000040800F2\n:0400000001020304F2\n:0400100001020304E2\n:00000001FF\n';
    expect(loadFirmwareImage('fw.hex', new TextEncoder().encode(hex))[0].addr).toBe(0x08000000);
    const elf = buildElf({ segments: [{ paddr: 0x08000000, vaddr: 0x08000000, data: [1, 2, 3, 4] }, { paddr: 0x08001000, vaddr: 0x20000000, data: [5, 6] }] });
    const segs = loadFirmwareImage('app.elf', elf);
    expect(segs.map((s) => [s.addr, Array.from(s.data)])).toEqual([[0x08000000, [1, 2, 3, 4]], [0x08001000, [5, 6]]]);
    expect(parseElf(elf).segments).toHaveLength(2);
    expect(loadFirmwareImage('app.bin', Uint8Array.from([9]), 0x10000000)).toEqual([{ addr: 0x10000000, data: Uint8Array.from([9]) }]);
  });

  it('reads devices and algorithms from a .pdsc', () => {
    const pdsc = `<package><devices>
      <family Dfamily="STM32F1 Series">
        <subFamily DsubFamily="STM32F103">
          <memory id="IRAM1" start="0x20000000" size="0x5000" default="1"/>
          <device Dname="STM32F103C8">
            <algorithm name="CMSIS/Flash/STM32F10x_128.FLM" start="0x08000000" size="0x20000" default="1"/>
          </device>
          <device Dname="STM32F103RE">
            <memory id="IRAM1" start="0x20000000" size="0x10000" default="1"/>
            <algorithm name="CMSIS/Flash/STM32F10x_512.FLM" start="0x08000000" size="0x80000" RAMstart="0x20000000" RAMsize="0x1000" default="1"/>
          </device>
        </subFamily>
      </family></devices></package>`;
    const devices = parsePdsc(pdsc);
    expect(devices.map((d) => d.name)).toEqual(['STM32F103C8', 'STM32F103RE']);
    expect(devices[0].algorithms[0]).toMatchObject({ path: 'CMSIS/Flash/STM32F10x_128.FLM', ramStart: 0x20000000, ramSize: 0x5000 });
    expect(devices[1].algorithms[0]).toMatchObject({ ramSize: 0x1000 });
  });
});

describe('CMSIS-DAP SWO commands', () => {

  const probeWith = (caps, swoBytes, status = 0) => {
    const sent = [];
    const transport = {
      kind: 'usb', packetSize: 64, async open() {}, async close() {},
      async transfer(b) {
        sent.push(b[0]);
        if (b[0] === 0x00) return Uint8Array.from(b[1] === 0xf0 ? [0, 1, caps] : b[1] === 0xff ? [0, 2, 64, 0] : [0, 0]);
        if (b[0] === 0x19) return Uint8Array.from([0x19, ...u32(1_000_000)]);
        if (b[0] === 0x1c) return Uint8Array.from([0x1c, status, swoBytes.length, 0, ...swoBytes]);
        return Uint8Array.from([b[0], 0]);
      }
    };
    return { probe: new DapProbe(transport), sent };
  };

  it('starts capture and reads data', async () => {
    const { probe, sent } = probeWith(0x07, [0x01, 0x41]);
    await probe.open();
    expect(await probe.swoStart(2_000_000)).toBe(1_000_000);
    expect(sent).toEqual(expect.arrayContaining([0x17, 0x18, 0x19, 0x1a]));
    expect(Array.from(await probe.swoRead())).toEqual([0x01, 0x41]);
  });

  it('refuses probes without SWO and reports overruns', async () => {
    const none = probeWith(0x03, []);
    await none.probe.open();
    await expect(none.probe.swoStart(1e6)).rejects.toThrow(/does not capture SWO/);
    const over = probeWith(0x07, [], 0x40);
    await over.probe.open();
    await expect(over.probe.swoRead()).rejects.toThrow(/overrun/);
  });
});

describe('ELF symbols', () => {
  const elf = () => buildElf({
    sections: [{ name: '.text', addr: 0x08000000, data: new Array(0x200).fill(0) }],
    symbols: [
      { name: 'Reset_Handler', value: 0x08000101, size: 0x20, shndx: 1, func: true },
      { name: 'main', value: 0x08000121, size: 0x40, shndx: 1, func: true },
      { name: 'asm_stub', value: 0x08000180, size: 0, shndx: 1, func: true },
      { name: 'counter', value: 0x20000010, size: 4, shndx: 1 },
      { name: '$t', value: 0x08000100, size: 0, shndx: 1, func: true }
    ]
  });

  it('shows name+offset, strips the Thumb bit, and ignores mapping symbols', () => {
    const table = buildSymbolTable(parseElf(elf()));
    expect(table.map((s) => s.name)).not.toContain('$t');
    expect(formatSymbol(table, 0x08000100)).toBe('Reset_Handler');
    expect(formatSymbol(table, 0x08000120 + 0x12)).toBe('main+0x12');
    expect(formatSymbol(table, 0x20000012)).toBe('counter+0x2');
    expect(formatSymbol(table, 0x08000170)).toBe(''); // between symbols
    expect(formatSymbol(table, 0x08000184)).toBe('asm_stub+0x4');
    expect(symbolAddress(table, 'main')).toBe(0x08000120);
    expect(symbolAddress(table, 'nope')).toBeNull();
  });

  it('client shows nothing without an ELF and sets a breakpoint by symbol', async () => {
    const client = new CmsisDapClient(() => {});
    expect(client.symbolFor(0x08000121)).toBe('');
    expect(client.loadSymbols(elf(), 'fw.elf')).toBe(4);
    expect(client.symbolFor(0x08000130)).toBe('main+0x10');
    client.setBreakpoint = async (a) => { client.bp = a; };
    expect(await client.breakAtSymbol('main')).toBe(0x08000120);
    expect(client.bp).toBe(0x08000120);
    await expect(client.breakAtSymbol('missing')).rejects.toThrow(/No symbol/);
  });
});

describe('mass erase and unlock', () => {
  it('mass erase runs only Init, EraseChip, UnInit', async () => {
    const core = new FakeCore();
    const flm = parseFlm(testFlm());
    const runner = new FlashAlgoRunner(core, flm, { ramBase: 0x20000000, ramSize: 0x4000 });
    wireAlgorithm(core, runner, flm);
    core.mem.set(0x08000010, 0x1234);
    await eraseChipWithAlgorithm(core, flm, { ramBase: 0x20000000, ramSize: 0x4000 });
    expect(core.calls).toEqual(['Init', 'EraseChip', 'UnInit']);
    expect(core.mem.has(0x08000010)).toBe(false);
  });

  it('refuses an algorithm without EraseChip', async () => {
    const flm = { ...parseFlm(testFlm()), functions: { Init: 0, UnInit: 4 } };
    await expect(eraseChipWithAlgorithm(new FakeCore(), flm, { ramBase: 0x20000000, ramSize: 0x4000 })).rejects.toThrow(/no EraseChip/);
  });

  function fakeCtrlAp({ idr = 0x02880000, busyReads = 2 } = {}) {
    const log = [];
    let busy = busyReads;
    return {
      log,
      async readApRegister(ap, addr) {
        log.push(`r${ap}:${addr.toString(16)}`);
        if (addr === 0xfc) return idr;
        if (addr === 0x08) return busy-- > 0 ? 1 : 0;
        return 0;
      },
      async writeApRegister(ap, addr, v) { log.push(`w${ap}:${addr.toString(16)}=${v}`); }
    };
  }

  it('nRF52 ERASEALL: check IDR, erase, poll status, pulse RESET, clear ERASEALL', async () => {
    const t = fakeCtrlAp();
    await nrf52EraseAll(t, { sleepMs: 0 });
    expect(t.log).toEqual(['r1:fc', 'w1:4=1', 'r1:8', 'r1:8', 'r1:8', 'w1:0=1', 'w1:0=0', 'w1:4=0']);
  });

  it('uses the CTRL-AP register map from the nRF52 spec / pyOCD', () => {
    expect(NRF52_CTRL_AP).toMatchObject({ APSEL: 1, RESET: 0x00, ERASEALL: 0x04, ERASEALLSTATUS: 0x08, APPROTECTSTATUS: 0x0c, IDR: 0xfc, IDR_VALUE: 0x02880000 });
  });

  it('accepts any revision nibble in the CTRL-AP IDR', async () => {
    const t = fakeCtrlAp({ idr: 0x12880000 });
    await nrf52EraseAll(t, { sleepMs: 0 });
    expect(t.log[0]).toBe('r1:fc');
    expect(t.log).toContain('w1:4=1');
  });

  it('refuses a target that has no nRF52 CTRL-AP', async () => {
    const t = fakeCtrlAp({ idr: 0 });
    await expect(nrf52EraseAll(t)).rejects.toThrow(/not an nRF52 CTRL-AP/);
    expect(t.log).toEqual(['r1:fc']);
  });
});
