/**
 * cortexDebug.js — the parts of a Cortex-M debugger built on top of SWD
 * memory access: SEGGER RTT, SWO/ITM trace, FPB breakpoints, DWT watchpoints
 * and flash programming with CMSIS-Pack flash algorithms (.FLM).
 *
 * Everything here talks to a `target` with the SwdTarget interface
 * (readWord/writeWord/readWords/writeWords, core registers, halt/resume),
 * so tests can drive it with a fake core.
 */

import JSZip from 'jszip';
import { parseIntelHex } from './firmwareParser';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hex8 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const rd32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

// ---------------------------------------------------------------------------
// Byte access on top of word access
// ---------------------------------------------------------------------------

export async function readBytes(target, addr, length) {
  const start = addr & ~3;
  const end = (addr + length + 3) & ~3;
  const words = await target.readWords(start >>> 0, (end - start) / 4);
  const out = new Uint8Array(end - start);
  words.forEach((w, i) => { out[i * 4] = w & 0xff; out[i * 4 + 1] = (w >>> 8) & 0xff; out[i * 4 + 2] = (w >>> 16) & 0xff; out[i * 4 + 3] = w >>> 24; });
  return out.subarray(addr - start, addr - start + length);
}

/** Write bytes with word accesses, reading back the partial words at either end. */
export async function writeBytes(target, addr, bytes) {
  if (!bytes.length) return;
  const start = addr & ~3;
  const end = (addr + bytes.length + 3) & ~3;
  const buf = new Uint8Array(end - start);
  if (start !== addr || end !== addr + bytes.length) {
    const head = await target.readWord(start >>> 0);
    const tail = end - 4 === start ? head : await target.readWord((end - 4) >>> 0);
    for (let i = 0; i < 4; i++) { buf[i] = (head >>> (8 * i)) & 0xff; buf[buf.length - 4 + i] = (tail >>> (8 * i)) & 0xff; }
  }
  buf.set(bytes, addr - start);
  const words = [];
  for (let i = 0; i < buf.length; i += 4) words.push(rd32(buf, i));
  await target.writeWords(start >>> 0, words);
}

/** Read `length` bytes in chunks, reporting progress (for memory dumps). */
export async function dumpMemory(target, addr, length, onProgress) {
  const out = new Uint8Array(length);
  const chunk = 4096;
  for (let off = 0; off < length; off += chunk) {
    const n = Math.min(chunk, length - off);
    out.set(await readBytes(target, (addr + off) >>> 0, n), off);
    onProgress?.((off + n) / length);
  }
  return out;
}

// ---------------------------------------------------------------------------
// SEGGER RTT
// ---------------------------------------------------------------------------

const RTT_ID = [...'SEGGER RTT'].map((c) => c.charCodeAt(0));
const RTT_BUFFER_SIZE = 24; // sName, pBuffer, SizeOfBuffer, WrOff, RdOff, Flags

function findSequence(hay, needle) {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** Scan RAM for the "SEGGER RTT" control block. Returns its address or null. */
export async function findRttControlBlock(target, { start = 0x20000000, size = 0x10000, onProgress } = {}) {
  const chunk = 0x1000;
  for (let off = 0; off < size; off += chunk) {
    const n = Math.min(chunk + 16, size - off);
    const bytes = await readBytes(target, (start + off) >>> 0, n);
    const at = findSequence(bytes, [...RTT_ID, 0]);
    if (at >= 0) return (start + off + at) >>> 0;
    onProgress?.(Math.min(1, (off + chunk) / size));
  }
  return null;
}

async function readCString(target, addr, max = 32) {
  if (!addr) return '';
  try {
    const b = await readBytes(target, addr, max);
    const end = b.indexOf(0);
    return new TextDecoder().decode(b.subarray(0, end < 0 ? max : end));
  } catch (e) {
    return '';
  }
}

export class RttClient {
  constructor(target, address) {
    this.target = target;
    this.address = address >>> 0;
    this.up = [];
    this.down = [];
  }

  async init() {
    const hdr = await readBytes(this.target, this.address, 24);
    const maxUp = rd32(hdr, 16);
    const maxDown = rd32(hdr, 20);
    if (maxUp > 32 || maxDown > 32) throw new Error(`RTT control block at ${hex8(this.address)} looks corrupt (${maxUp} up / ${maxDown} down buffers).`);
    const describe = async (base, i, dir) => {
      const addr = (base + i * RTT_BUFFER_SIZE) >>> 0;
      const b = await readBytes(this.target, addr, RTT_BUFFER_SIZE);
      return { index: i, dir, addr, name: await readCString(this.target, rd32(b, 0)), buffer: rd32(b, 4), size: rd32(b, 8), flags: rd32(b, 20) };
    };
    const upBase = this.address + 24;
    const downBase = upBase + maxUp * RTT_BUFFER_SIZE;
    this.up = [];
    for (let i = 0; i < maxUp; i++) this.up.push(await describe(upBase, i, 'up'));
    this.down = [];
    for (let i = 0; i < maxDown; i++) this.down.push(await describe(downBase, i, 'down'));
    this.up = this.up.filter((c) => c.buffer && c.size);
    this.down = this.down.filter((c) => c.buffer && c.size);
    return { up: this.up, down: this.down };
  }

  /** Drain every up channel. Returns [{ channel, bytes }] for channels with data. */
  async poll() {
    const out = [];
    for (const ch of this.up) {
      const [wr, rd] = await this.target.readWords((ch.addr + 12) >>> 0, 2);
      if (wr === rd || wr >= ch.size || rd >= ch.size) continue;
      let bytes;
      if (wr > rd) bytes = await readBytes(this.target, ch.buffer + rd, wr - rd);
      else {
        const a = await readBytes(this.target, ch.buffer + rd, ch.size - rd);
        const b = wr ? await readBytes(this.target, ch.buffer, wr) : new Uint8Array(0);
        bytes = new Uint8Array(a.length + b.length);
        bytes.set(a);
        bytes.set(b, a.length);
      }
      await this.target.writeWord((ch.addr + 16) >>> 0, wr);
      out.push({ channel: ch.index, bytes: Uint8Array.from(bytes) });
    }
    return out;
  }

  /** Queue bytes on a down channel (host -> target). Returns how many fit. */
  async write(channel, data) {
    const ch = this.down.find((c) => c.index === channel);
    if (!ch) throw new Error(`The target has no RTT down channel ${channel}.`);
    const [wr, rd] = await this.target.readWords((ch.addr + 12) >>> 0, 2);
    const free = (rd - wr - 1 + ch.size) % ch.size;
    const n = Math.min(free, data.length);
    let pos = wr;
    let done = 0;
    while (done < n) {
      const run = Math.min(n - done, ch.size - pos);
      await writeBytes(this.target, ch.buffer + pos, data.subarray(done, done + run));
      done += run;
      pos = (pos + run) % ch.size;
    }
    if (n) await this.target.writeWord((ch.addr + 12) >>> 0, pos);
    return n;
  }
}

// ---------------------------------------------------------------------------
// SWO / ITM
// ---------------------------------------------------------------------------

export const TRACE = {
  DEMCR: 0xe000edfc, TRCENA: 1 << 24,
  TPIU_CSPSR: 0xe0040004, TPIU_ACPR: 0xe0040010, TPIU_SPPR: 0xe00400f0, TPIU_FFCR: 0xe0040304,
  ITM_TER: 0xe0000e00, ITM_TPR: 0xe0000e40, ITM_TCR: 0xe0000e80, ITM_LAR: 0xe0000fb0,
  DBGMCU_CR: 0xe0042004
};

/** Set up the TPIU and ITM for UART (NRZ) SWO at `baud` from a `cpuHz` trace clock. */
export async function configureSwoTarget(target, { cpuHz, baud, stm32 = false }) {
  const prescaler = Math.round(cpuHz / baud) - 1;
  if (prescaler < 0 || prescaler > 0x1fff) throw new Error(`Can't make ${baud} baud from a ${cpuHz} Hz core clock.`);
  if (stm32) {
    const cr = await target.readWord(TRACE.DBGMCU_CR);
    await target.writeWord(TRACE.DBGMCU_CR, (cr | 0x20) & ~0xc0); // TRACE_IOEN, async mode
  }
  const demcr = await target.readWord(TRACE.DEMCR);
  await target.writeWord(TRACE.DEMCR, (demcr | TRACE.TRCENA) >>> 0);
  await target.writeWord(TRACE.TPIU_CSPSR, 1);
  await target.writeWord(TRACE.TPIU_ACPR, prescaler);
  await target.writeWord(TRACE.TPIU_SPPR, 2); // NRZ / UART
  await target.writeWord(TRACE.TPIU_FFCR, 0x100); // formatter off
  await target.writeWord(TRACE.ITM_LAR, 0xc5acce55);
  await target.writeWord(TRACE.ITM_TCR, 0x0001000d); // TraceBusID 1, TXENA, SYNCENA, ITMENA
  await target.writeWord(TRACE.ITM_TPR, 0xf);
  await target.writeWord(TRACE.ITM_TER, 0xffffffff);
  return { prescaler, actualBaud: cpuHz / (prescaler + 1) };
}

/**
 * Streaming ITM packet parser. Feed it SWO bytes; it returns stimulus-port
 * writes and other packets, and keeps partial packets for the next call.
 */
export class ItmParser {
  constructor() {
    this.pending = [];
  }

  push(bytes) {
    const buf = [...this.pending, ...bytes];
    const out = [];
    let i = 0;
    while (i < buf.length) {
      const h = buf[i];
      if (h === 0x00) { // synchronisation: zeros then 0x80
        let j = i;
        while (j < buf.length && buf[j] === 0) j++;
        if (j >= buf.length) break;
        if (buf[j] === 0x80) { out.push({ type: 'sync' }); i = j + 1; } else i = j;
        continue;
      }
      if (h === 0x70) { out.push({ type: 'overflow' }); i++; continue; }
      const size = h & 0x03;
      if (size) {
        const n = size === 3 ? 4 : size;
        if (i + n >= buf.length) break;
        let value = 0;
        for (let k = 0; k < n; k++) value |= buf[i + 1 + k] << (8 * k);
        out.push({ type: h & 0x04 ? 'hardware' : 'stimulus', port: h >> 3, size: n, value: value >>> 0 });
        i += 1 + n;
        continue;
      }
      // Timestamp and extension packets: header plus continuation bytes (bit 7 set).
      if (h & 0x80) {
        let j = i + 1;
        while (j < buf.length && buf[j] & 0x80) j++;
        if (j >= buf.length) break;
        out.push({ type: (h & 0x0f) === 0 ? 'timestamp' : 'extension' });
        i = j + 1;
      } else {
        out.push({ type: (h & 0x0f) === 0 ? 'timestamp' : 'extension' });
        i++;
      }
    }
    this.pending = buf.slice(i);
    return out;
  }
}

/** Turn stimulus writes into text per port (printf over ITM sends one byte at a time). */
export function itmText(packets) {
  const perPort = {};
  for (const p of packets) {
    if (p.type !== 'stimulus') continue;
    let s = '';
    for (let k = 0; k < p.size; k++) s += String.fromCharCode((p.value >>> (8 * k)) & 0xff);
    perPort[p.port] = (perPort[p.port] || '') + s;
  }
  return perPort;
}

// ---------------------------------------------------------------------------
// FPB breakpoints and DWT watchpoints
// ---------------------------------------------------------------------------

export const FPB = { CTRL: 0xe0002000, COMP0: 0xe0002008 };
export const DWT = { CTRL: 0xe0001000, COMP0: 0xe0001020 };

export class Breakpoints {
  constructor(target) {
    this.target = target;
    this.slots = [];
    this.rev = 0;
  }

  async init() {
    const ctrl = await this.target.readWord(FPB.CTRL);
    this.rev = ctrl >>> 28;
    const n = ((ctrl >>> 8) & 0x70) | ((ctrl >>> 4) & 0x0f);
    this.slots = new Array(n).fill(null);
    for (let i = 0; i < n; i++) await this.target.writeWord(FPB.COMP0 + i * 4, 0);
    await this.target.writeWord(FPB.CTRL, 0x3); // KEY | ENABLE
    return n;
  }

  encode(addr) {
    if (this.rev === 0) {
      if (addr >= 0x20000000) throw new Error('This FPB (v1) only breaks on code below 0x20000000.');
      return ((addr & 0x1ffffffc) | (addr & 2 ? 0x80000000 : 0x40000000) | 1) >>> 0;
    }
    return ((addr & ~1) | 1) >>> 0;
  }

  async set(addr) {
    const a = addr & ~1;
    if (this.slots.includes(a)) return;
    const i = this.slots.indexOf(null);
    if (i < 0) throw new Error(`All ${this.slots.length} hardware breakpoints are in use.`);
    await this.target.writeWord(FPB.COMP0 + i * 4, this.encode(a));
    this.slots[i] = a;
  }

  async clear(addr) {
    const i = this.slots.indexOf(addr & ~1);
    if (i < 0) return;
    await this.target.writeWord(FPB.COMP0 + i * 4, 0);
    this.slots[i] = null;
  }

  async clearAll() {
    for (const a of this.slots.filter((s) => s !== null)) await this.clear(a);
  }

  get active() { return this.slots.filter((s) => s !== null); }
}

/** DWT data watchpoints for ARMv6-M / ARMv7-M (M0+, M3, M4, M7). */
export class Watchpoints {
  constructor(target, { armv8 = false } = {}) {
    this.target = target;
    this.armv8 = armv8;
    this.slots = [];
  }

  async init() {
    const ctrl = await this.target.readWord(DWT.CTRL);
    this.slots = new Array(ctrl >>> 28).fill(null);
    return this.slots.length;
  }

  async set(addr, { size = 4, access = 'write' } = {}) {
    if (this.armv8) throw new Error('Watchpoints on ARMv8-M (M23/M33/M55) use a different DWT layout and are not supported yet.');
    if (![1, 2, 4].includes(size) || addr % size) throw new Error('Watch 1, 2 or 4 aligned bytes.');
    const i = this.slots.indexOf(null);
    if (i < 0) throw new Error(this.slots.length ? `All ${this.slots.length} watchpoints are in use.` : 'This core has no DWT comparators.');
    const fn = { read: 5, write: 6, readwrite: 7 }[access];
    const base = DWT.COMP0 + i * 16;
    await this.target.writeWord(base, addr >>> 0);
    await this.target.writeWord(base + 4, Math.log2(size));
    await this.target.writeWord(base + 8, fn);
    const demcr = await this.target.readWord(TRACE.DEMCR);
    await this.target.writeWord(TRACE.DEMCR, (demcr | TRACE.TRCENA) >>> 0);
    this.slots[i] = { addr: addr >>> 0, size, access };
  }

  async clear(addr) {
    const i = this.slots.findIndex((s) => s && s.addr === addr >>> 0);
    if (i < 0) return;
    await this.target.writeWord(DWT.COMP0 + i * 16 + 8, 0);
    this.slots[i] = null;
  }

  get active() { return this.slots.filter(Boolean); }
}

// ---------------------------------------------------------------------------
// ELF
// ---------------------------------------------------------------------------

export function parseElf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] !== 0x7f || b[1] !== 0x45 || b[2] !== 0x4c || b[3] !== 0x46) throw new Error('Not an ELF file.');
  if (b[4] !== 1 || b[5] !== 1) throw new Error('Only 32-bit little-endian ELF files are supported.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);
  const phoff = u32(0x1c);
  const shoff = u32(0x20);
  const phentsize = u16(0x2a);
  const phnum = u16(0x2c);
  const shentsize = u16(0x2e);
  const shnum = u16(0x30);
  const shstrndx = u16(0x32);
  const cstr = (off) => { let e = off; while (e < b.length && b[e]) e++; return new TextDecoder().decode(b.subarray(off, e)); };

  const sections = [];
  for (let i = 0; i < shnum; i++) {
    const o = shoff + i * shentsize;
    sections.push({ nameOff: u32(o), type: u32(o + 4), flags: u32(o + 8), addr: u32(o + 12), offset: u32(o + 16), size: u32(o + 20), link: u32(o + 24), entsize: u32(o + 36) });
  }
  const strtab = sections[shstrndx];
  for (const s of sections) {
    s.name = strtab ? cstr(strtab.offset + s.nameOff) : '';
    s.data = s.type === 8 ? new Uint8Array(s.size) : b.subarray(s.offset, s.offset + s.size); // SHT_NOBITS is zero-filled
  }

  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    segments.push({ type: u32(o), offset: u32(o + 4), vaddr: u32(o + 8), paddr: u32(o + 12), filesz: u32(o + 16), memsz: u32(o + 20), flags: u32(o + 24) });
  }

  const symbols = new Map();
  const symbolList = [];
  for (const s of sections.filter((x) => x.type === 2)) { // SHT_SYMTAB
    const names = sections[s.link];
    for (let o = s.offset; o + 16 <= s.offset + s.size; o += 16) {
      const name = cstr(names.offset + u32(o));
      if (!name) continue;
      const sym = { value: u32(o + 4), size: u32(o + 8), shndx: u16(o + 14), type: b[o + 12] & 0xf, bind: b[o + 12] >> 4 };
      symbols.set(name, sym);
      symbolList.push({ name, ...sym });
    }
  }
  return { entry: u32(0x18), sections, segments, symbols, symbolList, bytes: b };
}

// ---------------------------------------------------------------------------
// CMSIS-Pack flash algorithms
// ---------------------------------------------------------------------------

const FLM_FUNCTIONS = ['Init', 'UnInit', 'EraseChip', 'EraseSector', 'ProgramPage', 'Verify', 'BlankCheck'];

/** Parse an .FLM file: device description, sector layout and the code image to load. */
export function parseFlm(bytes) {
  const elf = parseElf(bytes);
  const dev = elf.symbols.get('FlashDevice');
  if (!dev) throw new Error('No FlashDevice description: this is not a CMSIS flash algorithm (.FLM).');
  const devSec = elf.sections[dev.shndx];
  const d = devSec.data.subarray(dev.value - devSec.addr);
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const nameBytes = d.subarray(2, 130);
  const z = nameBytes.indexOf(0);
  const info = {
    version: dv.getUint16(0, true),
    name: new TextDecoder().decode(nameBytes.subarray(0, z < 0 ? 128 : z)),
    devType: dv.getUint16(130, true),
    devAddr: dv.getUint32(132, true),
    devSize: dv.getUint32(136, true),
    pageSize: dv.getUint32(140, true),
    emptyValue: d[148],
    progTimeout: dv.getUint32(152, true),
    eraseTimeout: dv.getUint32(156, true),
    sectorTable: []
  };
  for (let o = 160; o + 8 <= d.length; o += 8) {
    const size = dv.getUint32(o, true);
    const addr = dv.getUint32(o + 4, true);
    if (size === 0xffffffff && addr === 0xffffffff) break;
    info.sectorTable.push({ size, addr });
  }
  if (!info.sectorTable.length) throw new Error('The flash algorithm lists no sectors.');

  // Load image: PrgCode and PrgData (RW + zero-init) laid out as linked.
  const load = elf.sections.filter((s) => s.name === 'PrgCode' || s.name === 'PrgData');
  if (!load.some((s) => s.name === 'PrgCode')) throw new Error('The flash algorithm has no PrgCode section.');
  const base = Math.min(...load.map((s) => s.addr));
  const end = Math.max(...load.map((s) => s.addr + s.size));
  const image = new Uint8Array((end - base + 3) & ~3);
  for (const s of load) image.set(s.data, s.addr - base);
  const dataSec = load.find((s) => s.name === 'PrgData');

  const functions = {};
  for (const f of FLM_FUNCTIONS) {
    const sym = elf.symbols.get(f);
    if (sym) functions[f] = (sym.value & ~1) - base;
  }
  for (const f of ['Init', 'UnInit', 'EraseSector', 'ProgramPage']) {
    if (functions[f] === undefined) throw new Error(`The flash algorithm has no ${f}() function.`);
  }
  return { ...info, image, functions, dataOffset: dataSec ? dataSec.addr - base : image.length };
}

/** Expand the FLM sector table into absolute sectors [{ addr, size }]. */
export function flmSectors(flm) {
  const out = [];
  const table = flm.sectorTable;
  for (let i = 0; i < table.length; i++) {
    const endOff = i + 1 < table.length ? table[i + 1].addr : flm.devSize;
    for (let off = table[i].addr; off < endOff; off += table[i].size) out.push({ addr: (flm.devAddr + off) >>> 0, size: table[i].size });
  }
  return out;
}

/** List the flash algorithms inside a CMSIS-Pack (.pack is a zip) with the devices that use them. */
export async function readPack(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const pdscName = Object.keys(zip.files).find((n) => /\.pdsc$/i.test(n));
  const devices = pdscName ? parsePdsc(await zip.file(pdscName).async('string')) : [];
  const flms = Object.keys(zip.files).filter((n) => /\.flm$/i.test(n));
  const svds = Object.keys(zip.files).filter((n) => /\.svd$/i.test(n));
  return {
    devices,
    algorithms: flms,
    svds,
    async load(path) {
      const norm = (p) => p.replace(/\\/g, '/').toLowerCase();
      const name = Object.keys(zip.files).find((n) => norm(n) === norm(path) || norm(n).endsWith(`/${norm(path)}`));
      if (!name) throw new Error(`${path} is not in the pack.`);
      return zip.file(name).async('uint8array');
    }
  };
}

/** Minimal .pdsc reader: devices with their flash algorithms and RAM, inherited from family / sub-family. */
export function parsePdsc(xml) {
  const devices = [];
  const stack = [];
  const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const num = (v) => (v === undefined ? undefined : Number(v));
  const scoped = new Set(['family', 'subFamily', 'device', 'variant']);
  // A device (or each of its variants) inherits algorithms and memory from its parents.
  const finish = (node) => {
    if (!((node.tag === 'device' && !node.hasVariants) || node.tag === 'variant')) return;
    const chain = [...stack, node];
    const memories = chain.flatMap((n) => n.memories);
    const ram = memories.find((x) => /RAM/i.test(x.id || x.name || '') && x.default !== '0');
    devices.push({
      name: node.name,
      algorithms: chain.flatMap((n) => n.algorithms).map((x) => ({
        path: x.name, start: num(x.start), size: num(x.size),
        ramStart: num(x.RAMstart ?? ram?.start), ramSize: num(x.RAMsize ?? ram?.size), default: x.default === '1'
      })),
      ram: ram ? { start: num(ram.start), size: num(ram.size) } : null
    });
  };
  for (const [, close, tag, rest, selfClose] of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    if (close) {
      if (scoped.has(tag)) finish(stack.pop());
      continue;
    }
    const a = attrs(rest);
    if (scoped.has(tag)) {
      const node = { tag, name: a.Dvariant || a.Dname || a.DsubFamily || a.Dfamily, algorithms: [], memories: [], hasVariants: false };
      if (tag === 'variant' && stack.length) stack[stack.length - 1].hasVariants = true;
      if (selfClose) finish(node); else stack.push(node);
    } else if (stack.length && tag === 'algorithm') stack[stack.length - 1].algorithms.push(a);
    else if (stack.length && tag === 'memory') stack[stack.length - 1].memories.push(a);
  }
  return devices;
}

export class FlashAlgoError extends Error {}

/**
 * Loads a flash algorithm into target RAM and calls its functions. Layout:
 *   ramBase:        BKPT; B .      (return address for every call)
 *   ramBase + 4:    algorithm image (code, data, zero-init)
 *   then:           stack, then one page buffer
 */
export class FlashAlgoRunner {
  constructor(target, flm, { ramBase = 0x20000000, ramSize = 0x4000, stackSize = 0x800, log = () => {} } = {}) {
    this.target = target;
    this.flm = flm;
    this.log = log;
    this.bkpt = ramBase >>> 0;
    this.algoBase = (ramBase + 4) >>> 0;
    const algoEnd = (this.algoBase + flm.image.length + 7) & ~7;
    this.stackTop = (algoEnd + stackSize) >>> 0;
    this.pageBuffer = this.stackTop;
    this.staticBase = (this.algoBase + flm.dataOffset) >>> 0;
    const need = this.pageBuffer + flm.pageSize - ramBase;
    if (need > ramSize) throw new FlashAlgoError(`The flash algorithm needs ${need} bytes of RAM but only ${ramSize} were given.`);
  }

  async load() {
    await this.target.writeWords(this.bkpt, [0xe7febe00]); // BKPT #0 ; B .
    const words = [];
    for (let i = 0; i < this.flm.image.length; i += 4) words.push(rd32(this.flm.image, i));
    await this.target.writeWords(this.algoBase, words);
    const back = await this.target.readWords(this.algoBase, Math.min(words.length, 16));
    if (back.some((w, i) => w !== words[i])) throw new FlashAlgoError(`RAM at ${hex8(this.algoBase)} did not keep the algorithm: wrong RAM address?`);
  }

  /** Call an algorithm function with up to 4 arguments; returns R0. */
  async call(name, args = [], timeoutMs = 2000) {
    const off = this.flm.functions[name];
    if (off === undefined) throw new FlashAlgoError(`The algorithm has no ${name}().`);
    const t = this.target;
    for (let i = 0; i < 4; i++) await t.writeCoreRegister(i, (args[i] ?? 0) >>> 0);
    await t.writeCoreRegister(9, this.staticBase);
    await t.writeCoreRegister(13, this.stackTop);
    await t.writeCoreRegister(14, (this.bkpt | 1) >>> 0);
    await t.writeCoreRegister(15, (this.algoBase + off) >>> 0);
    await t.writeCoreRegister(16, 0x01000000); // xPSR: Thumb
    await t.resume();
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if ((await t.coreStatus()).halted) break;
      if (Date.now() > deadline) {
        await t.halt();
        throw new FlashAlgoError(`${name}() did not return within ${timeoutMs} ms.`);
      }
      await sleep(2);
    }
    const pc = await t.readCoreRegister(15);
    if ((pc & ~1) !== this.bkpt) throw new FlashAlgoError(`${name}() stopped at ${hex8(pc)} instead of returning (fault or breakpoint in the algorithm).`);
    return (await t.readCoreRegister(0)) >>> 0;
  }

  async init(fnc) {
    const r = await this.call('Init', [this.flm.devAddr, 0, fnc]);
    if (r) throw new FlashAlgoError(`Init(${fnc}) failed with ${r}.`);
  }

  async uninit(fnc) {
    await this.call('UnInit', [fnc]);
  }
}

/**
 * Turn a firmware file into [{ addr, data }] segments.
 * .hex / .ihx: Intel HEX. .elf / .axf / .out: loadable segments at their
 * physical address. Anything else: raw binary at `baseAddress`.
 */
export function loadFirmwareImage(fileName, bytes, baseAddress = 0x08000000) {
  if (/\.(hex|ihx)$/i.test(fileName)) {
    const h = parseIntelHex(new TextDecoder().decode(bytes));
    if (!h.size) throw new Error('The HEX file has no data records.');
    return [{ addr: h.startAddress >>> 0, data: h.data }];
  }
  if (/\.(elf|axf|out)$/i.test(fileName) || (bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46)) {
    const elf = parseElf(bytes);
    const segs = elf.segments.filter((s) => s.type === 1 && s.filesz > 0).map((s) => ({ addr: s.paddr >>> 0, data: elf.bytes.slice(s.offset, s.offset + s.filesz) }));
    if (!segs.length) throw new Error('The ELF file has no loadable segments.');
    return segs;
  }
  return [{ addr: baseAddress >>> 0, data: bytes }];
}

/**
 * Erase, program and verify `segments` with a flash algorithm.
 * The core must be halted (ideally just after reset-and-halt).
 */
export async function programFlash(target, flm, segments, { ramBase, ramSize, chipErase = false, verify = true, onProgress = () => {}, log = () => {} } = {}) {
  const devEnd = flm.devAddr + flm.devSize;
  for (const s of segments) {
    if (s.addr < flm.devAddr || s.addr + s.data.length > devEnd) {
      throw new FlashAlgoError(`Data at ${hex8(s.addr)}-${hex8(s.addr + s.data.length - 1)} is outside ${flm.name} (${hex8(flm.devAddr)}-${hex8(devEnd - 1)}).`);
    }
  }
  const runner = new FlashAlgoRunner(target, flm, { ramBase, ramSize, log });
  await runner.load();

  // Erase.
  const sectors = flmSectors(flm).filter((sec) => segments.some((s) => s.addr < sec.addr + sec.size && s.addr + s.data.length > sec.addr));
  await runner.init(1);
  if (chipErase && flm.functions.EraseChip !== undefined) {
    onProgress('erase', 0);
    const r = await runner.call('EraseChip', [], Math.max(60000, flm.eraseTimeout * 50));
    if (r) throw new FlashAlgoError(`EraseChip() failed with ${r}.`);
    onProgress('erase', 1);
  } else {
    for (let i = 0; i < sectors.length; i++) {
      const r = await runner.call('EraseSector', [sectors[i].addr], Math.max(2000, flm.eraseTimeout * 4));
      if (r) throw new FlashAlgoError(`EraseSector(${hex8(sectors[i].addr)}) failed with ${r}.`);
      onProgress('erase', (i + 1) / sectors.length);
    }
  }
  await runner.uninit(1);
  log(`Erased ${chipErase ? 'the whole chip' : `${sectors.length} sector(s)`}.`);

  // Program page by page.
  const pages = new Map();
  for (const s of segments) {
    for (let i = 0; i < s.data.length; i++) {
      const a = s.addr + i;
      const page = flm.devAddr + Math.floor((a - flm.devAddr) / flm.pageSize) * flm.pageSize;
      if (!pages.has(page)) pages.set(page, new Uint8Array(flm.pageSize).fill(flm.emptyValue));
      pages.get(page)[a - page] = s.data[i];
    }
  }
  const order = [...pages.keys()].sort((a, b) => a - b);
  await runner.init(2);
  for (let i = 0; i < order.length; i++) {
    const page = order[i];
    const data = pages.get(page);
    const words = [];
    for (let k = 0; k < data.length; k += 4) words.push(rd32(data, k));
    await target.writeWords(runner.pageBuffer, words);
    const r = await runner.call('ProgramPage', [page, flm.pageSize, runner.pageBuffer], Math.max(2000, flm.progTimeout * 4));
    if (r) throw new FlashAlgoError(`ProgramPage(${hex8(page)}) failed with ${r}.`);
    onProgress('program', (i + 1) / order.length);
  }
  await runner.uninit(2);
  log(`Programmed ${order.length} page(s) of ${flm.pageSize} bytes.`);

  if (verify) {
    let checked = 0;
    const total = segments.reduce((n, s) => n + s.data.length, 0);
    for (const s of segments) {
      for (let off = 0; off < s.data.length; off += 4096) {
        const n = Math.min(4096, s.data.length - off);
        const got = await readBytes(target, s.addr + off, n);
        for (let k = 0; k < n; k++) {
          if (got[k] !== s.data[off + k]) throw new FlashAlgoError(`Verify failed at ${hex8(s.addr + off + k)}: wrote 0x${s.data[off + k].toString(16)}, read 0x${got[k].toString(16)}.`);
        }
        checked += n;
        onProgress('verify', checked / total);
      }
    }
    log(`Verified ${total} bytes.`);
  }
  return { sectors: sectors.length, pages: order.length };
}

// ---------------------------------------------------------------------------
// ELF symbols: "main+0x12" for addresses
// ---------------------------------------------------------------------------

const STT_OBJECT = 1;
const STT_FUNC = 2;
const SHN_ABS = 0xfff1;

/**
 * Sorted table of the functions and data objects in an ELF's symbol table.
 * Thumb function symbols carry bit 0 set; it is cleared here.
 */
export function buildSymbolTable(elf) {
  const list = elf.symbolList || [...elf.symbols].map(([name, s]) => ({ name, ...s }));
  return list
    .filter((s) => (s.type === STT_FUNC || s.type === STT_OBJECT) && s.shndx !== 0 && s.shndx !== SHN_ABS && !(s.name.startsWith('$')))
    .map((s) => ({ name: s.name, addr: (s.value & ~1) >>> 0, size: s.size, func: s.type === STT_FUNC }))
    .sort((a, b) => a.addr - b.addr || b.size - a.size);
}

// Symbols without a size (hand-written assembly) cover the bytes up to the next symbol, at most this far.
const UNSIZED_REACH = 0x400;

/** { name, offset } for the symbol that contains `addr`, or null. */
export function symbolize(table, addr) {
  if (!table?.length) return null;
  const a = addr >>> 0;
  let lo = 0;
  let hi = table.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid].addr <= a) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  // Several symbols can start at one address (aliases) or nest: walk back a few for one that covers `a`.
  for (let i = idx; i >= 0 && i > idx - 8; i--) {
    const s = table[i];
    const off = a - s.addr;
    const next = table[i + 1];
    const reach = s.size || Math.min(UNSIZED_REACH, next && next.addr > s.addr ? next.addr - s.addr : UNSIZED_REACH);
    if (off < reach) return { name: s.name, offset: off };
  }
  return null;
}

/** "main+0x12", "main" at offset 0, or '' when the address has no symbol. */
export function formatSymbol(table, addr) {
  const s = symbolize(table, addr);
  if (!s) return '';
  return s.offset ? `${s.name}+0x${s.offset.toString(16)}` : s.name;
}

/** Address of the symbol called `name` (function addresses without the Thumb bit), or null. */
export function symbolAddress(table, name) {
  const s = table?.find((x) => x.name === name);
  return s ? s.addr : null;
}

// ---------------------------------------------------------------------------
// Mass erase and unlock
// ---------------------------------------------------------------------------

/** Erase the whole chip with the flash algorithm's EraseChip() and nothing else. */
export async function eraseChipWithAlgorithm(target, flm, { ramBase, ramSize, onProgress = () => {}, log = () => {} } = {}) {
  if (flm.functions.EraseChip === undefined) throw new FlashAlgoError(`${flm.name} has no EraseChip(): this flash algorithm can only erase sectors.`);
  const runner = new FlashAlgoRunner(target, flm, { ramBase, ramSize, log });
  await runner.load();
  await runner.init(1);
  try {
    onProgress('erase', 0);
    const r = await runner.call('EraseChip', [], Math.max(60000, flm.eraseTimeout * 50));
    if (r) throw new FlashAlgoError(`EraseChip() failed with ${r}.`);
    onProgress('erase', 1);
  } finally {
    try { await runner.uninit(1); } catch (e) { /* the erase result matters more */ }
  }
  log('Erased the whole chip.');
}

// Nordic nRF52 CTRL-AP (AP index 1; the AHB-AP is AP 0). Registers per Nordic's product
// specification and pyOCD target_nRF52.py: RESET 0x00, ERASEALL 0x04, ERASEALLSTATUS 0x08
// (0 = ready, 1 = busy), APPROTECTSTATUS 0x0C (0 = protected, 1 = open), IDR 0xFC.
// The IDR's top nibble is a revision field and is ignored when matching 0x02880000.
export const NRF52_CTRL_AP = { APSEL: 1, RESET: 0x00, ERASEALL: 0x04, ERASEALLSTATUS: 0x08, APPROTECTSTATUS: 0x0c, IDR: 0xfc, IDR_VALUE: 0x02880000, IDR_REVISION_MASK: 0xf0000000 };

/**
 * Unlock a read-protected nRF52 by erasing it through the CTRL-AP (flash,
 * UICR and RAM are wiped; there is no other way in). Resets the chip afterwards.
 */
export async function nrf52EraseAll(target, { timeoutMs = 30000, sleepMs = 20 } = {}) {
  const C = NRF52_CTRL_AP;
  const idr = await target.readApRegister(C.APSEL, C.IDR);
  if (((idr & ~C.IDR_REVISION_MASK) >>> 0) !== C.IDR_VALUE) {
    throw new Error(`Access port ${C.APSEL} is not an nRF52 CTRL-AP (IDR 0x${(idr >>> 0).toString(16).toUpperCase()}, expected 0x${C.IDR_VALUE.toString(16).toUpperCase()}). This is not an nRF52 target.`);
  }
  await target.writeApRegister(C.APSEL, C.ERASEALL, 1);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if ((await target.readApRegister(C.APSEL, C.ERASEALLSTATUS)) === 0) break;
    if (Date.now() > deadline) throw new Error('The nRF52 did not finish ERASEALL in time.');
    await sleep(sleepMs);
  }
  await target.writeApRegister(C.APSEL, C.RESET, 1);
  await target.writeApRegister(C.APSEL, C.RESET, 0);
  await target.writeApRegister(C.APSEL, C.ERASEALL, 0);
}
