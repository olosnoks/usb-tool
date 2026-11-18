/**
 * fastbootTools.js — what the fastboot CLI does on top of the wire protocol:
 * Android sparse images (parse, convert, split to max-download-size), slot-aware
 * partition names, and flashing a factory image zip the way `flash-all.sh` /
 * `fastboot update` do (bootloader and radio, then physical partitions in the
 * bootloader, then logical partitions in fastbootd after update-super).
 *
 * The flashing functions take a FastbootDevice-like object, so tests run them
 * against the simulated bootloader.
 */

import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Sparse images (system/core/libsparse)
// ---------------------------------------------------------------------------

export const SPARSE_MAGIC = 0xed26ff3a;
export const CHUNK = { RAW: 0xcac1, FILL: 0xcac2, DONT_CARE: 0xcac3, CRC32: 0xcac4 };
const FILE_HDR = 28;
const CHUNK_HDR = 12;

export function isSparse(bytes) {
  return bytes.length >= FILE_HDR && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === SPARSE_MAGIC;
}

/** Parse a sparse image: { blockSize, totalBlocks, chunks: [{ type, blocks, offset (data), length }] }. */
export function parseSparse(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== SPARSE_MAGIC) throw new Error('Not an Android sparse image.');
  const fileHdr = dv.getUint16(8, true);
  const chunkHdr = dv.getUint16(10, true);
  const blockSize = dv.getUint32(12, true);
  const totalBlocks = dv.getUint32(16, true);
  const totalChunks = dv.getUint32(20, true);
  const chunks = [];
  let off = fileHdr;
  let block = 0;
  for (let i = 0; i < totalChunks; i++) {
    const type = dv.getUint16(off, true);
    const blocks = dv.getUint32(off + 4, true);
    const total = dv.getUint32(off + 8, true);
    chunks.push({ type, blocks, startBlock: block, offset: off + chunkHdr, length: total - chunkHdr });
    if (type !== CHUNK.CRC32) block += blocks;
    off += total;
  }
  if (block !== totalBlocks) throw new Error(`Sparse image covers ${block} blocks but its header says ${totalBlocks}.`);
  return { blockSize, totalBlocks, chunks, rawSize: totalBlocks * blockSize };
}

function sparseHeader(blockSize, totalBlocks, totalChunks) {
  const h = new Uint8Array(FILE_HDR);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, SPARSE_MAGIC, true);
  dv.setUint16(4, 1, true); dv.setUint16(6, 0, true);
  dv.setUint16(8, FILE_HDR, true); dv.setUint16(10, CHUNK_HDR, true);
  dv.setUint32(12, blockSize, true); dv.setUint32(16, totalBlocks, true); dv.setUint32(20, totalChunks, true);
  return h;
}

function chunkHeader(type, blocks, dataLength) {
  const h = new Uint8Array(CHUNK_HDR);
  const dv = new DataView(h.buffer);
  dv.setUint16(0, type, true);
  dv.setUint32(4, blocks, true);
  dv.setUint32(8, CHUNK_HDR + dataLength, true);
  return h;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Expand a sparse image to raw bytes (for tests and small images). */
export function unsparse(bytes) {
  const s = parseSparse(bytes);
  const out = new Uint8Array(s.rawSize);
  for (const c of s.chunks) {
    const at = c.startBlock * s.blockSize;
    const n = c.blocks * s.blockSize;
    if (c.type === CHUNK.RAW) out.set(bytes.subarray(c.offset, c.offset + n), at);
    else if (c.type === CHUNK.FILL) {
      const fill = bytes.subarray(c.offset, c.offset + 4);
      for (let i = 0; i < n; i += 4) out.set(fill, at + i);
    }
  }
  return out;
}

/**
 * Convert a raw image to sparse: blocks that repeat one 32-bit word become
 * FILL chunks, everything else RAW. The image is padded to whole blocks.
 */
export function toSparse(raw, blockSize = 4096) {
  const totalBlocks = Math.ceil(raw.length / blockSize);
  const padded = raw.length % blockSize ? concat([raw, new Uint8Array(totalBlocks * blockSize - raw.length)]) : raw;
  const dv = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  const fillOf = (b) => {
    const base = b * blockSize;
    const w = dv.getUint32(base, true);
    for (let i = 4; i < blockSize; i += 4) if (dv.getUint32(base + i, true) !== w) return null;
    return w;
  };
  const chunks = [];
  let b = 0;
  while (b < totalBlocks) {
    const f = fillOf(b);
    let e = b + 1;
    if (f !== null) {
      while (e < totalBlocks && fillOf(e) === f) e++;
      const word = new Uint8Array(4);
      new DataView(word.buffer).setUint32(0, f, true);
      chunks.push(chunkHeader(CHUNK.FILL, e - b, 4), word);
    } else {
      while (e < totalBlocks && fillOf(e) === null) e++;
      chunks.push(chunkHeader(CHUNK.RAW, e - b, (e - b) * blockSize), padded.subarray(b * blockSize, e * blockSize));
    }
    b = e;
  }
  return concat([sparseHeader(blockSize, totalBlocks, chunks.length / 2), ...chunks]);
}

/**
 * Split a sparse image into sparse images of at most `maxSize` bytes each.
 * Every piece covers the whole partition: blocks outside it are DONT_CARE, so
 * flashing the pieces one after another writes the full image.
 */
export function splitSparse(bytes, maxSize) {
  const s = parseSparse(bytes);
  const bs = s.blockSize;
  const overhead = FILE_HDR + CHUNK_HDR * 2; // header plus leading/trailing DONT_CARE
  if (maxSize < overhead + CHUNK_HDR + bs) throw new Error('max-download-size is too small to split this image.');
  // Break RAW chunks that can't fit in one piece into smaller RAW chunks.
  const pieces = [];
  const limit = maxSize - overhead;
  for (const c of s.chunks) {
    if (c.type === CHUNK.CRC32) continue;
    if (c.type === CHUNK.RAW && CHUNK_HDR + c.length > limit) {
      const per = Math.floor((limit - CHUNK_HDR) / bs);
      for (let k = 0; k < c.blocks; k += per) {
        const n = Math.min(per, c.blocks - k);
        pieces.push({ type: CHUNK.RAW, blocks: n, startBlock: c.startBlock + k, data: bytes.subarray(c.offset + k * bs, c.offset + (k + n) * bs) });
      }
    } else {
      pieces.push({ type: c.type, blocks: c.blocks, startBlock: c.startBlock, data: c.length ? bytes.subarray(c.offset, c.offset + c.length) : new Uint8Array(0) });
    }
  }
  const out = [];
  let group = [];
  let size = FILE_HDR;
  const flush = () => {
    if (!group.length) return;
    const parts = [];
    const first = group[0].startBlock;
    const last = group[group.length - 1].startBlock + group[group.length - 1].blocks;
    let count = 0;
    if (first > 0) { parts.push(chunkHeader(CHUNK.DONT_CARE, first, 0)); count++; }
    for (const p of group) { parts.push(chunkHeader(p.type, p.blocks, p.data.length), p.data); count++; }
    if (last < s.totalBlocks) { parts.push(chunkHeader(CHUNK.DONT_CARE, s.totalBlocks - last, 0)); count++; }
    out.push(concat([sparseHeader(bs, s.totalBlocks, count), ...parts]));
    group = [];
    size = FILE_HDR;
  };
  for (const p of pieces) {
    if (p.type === CHUNK.DONT_CARE) continue; // gaps are recreated per piece
    const need = CHUNK_HDR + p.data.length;
    if (size + need + CHUNK_HDR * 2 > maxSize) flush();
    group.push(p);
    size += need;
  }
  flush();
  if (!out.length) out.push(concat([sparseHeader(bs, s.totalBlocks, 1), chunkHeader(CHUNK.DONT_CARE, s.totalBlocks, 0)]));
  return out;
}

/** The pieces to download for one image, splitting into sparse parts when it is too big. */
export function imageParts(data, maxDownloadSize) {
  if (data.length <= maxDownloadSize) return [data];
  return splitSparse(isSparse(data) ? data : toSparse(data), maxDownloadSize);
}

/** The size the image has once written (raw size of a sparse image). */
export function imageRawSize(data) {
  return isSparse(data) ? parseSparse(data).rawSize : data.length;
}

// ---------------------------------------------------------------------------
// Slots and flashing
// ---------------------------------------------------------------------------

/** "boot" -> "boot_a" on A/B devices (has-slot:boot = yes), otherwise unchanged. */
export async function resolvePartition(fb, partition, slot = null) {
  if (/_(a|b)$/.test(partition)) return partition;
  let hasSlot = 'no';
  try { hasSlot = await fb.getVar(`has-slot:${partition}`); } catch (e) { /* older bootloaders */ }
  if (hasSlot !== 'yes') return partition;
  const s = slot || (await fb.getVar('current-slot').catch(() => 'a')).replace(/^_/, '');
  return `${partition}_${s}`;
}

/** Download and flash one image, splitting sparse pieces as needed. */
export async function flashImage(fb, partition, data, { onProgress, onInfo } = {}) {
  const parts = imageParts(data, fb.maxDownloadSize);
  for (let i = 0; i < parts.length; i++) {
    await fb.download(parts[i], (p) => onProgress?.({ part: i + 1, parts: parts.length, fraction: (i + p) / parts.length }));
    await fb.command(`flash:${partition}`, { onInfo });
  }
  return parts.length;
}

// ---------------------------------------------------------------------------
// Factory images
// ---------------------------------------------------------------------------

/** Partitions that live inside `super` on devices with dynamic partitions. */
export const LOGICAL_PARTITIONS = ['system', 'system_ext', 'product', 'vendor', 'vendor_dlkm', 'odm', 'odm_dlkm', 'system_dlkm'];
/** Order images are flashed in (fastboot's image table). */
const IMAGE_ORDER = ['boot', 'init_boot', 'vendor_boot', 'vendor_kernel_boot', 'dtbo', 'pvmfw', 'recovery', 'vbmeta', 'vbmeta_system', 'vbmeta_vendor', ...LOGICAL_PARTITIONS];

/** android-info.txt: "require board=foo|bar" lines -> [{ name, values, product? }]. */
export function parseAndroidInfo(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^require(?:-for-product:(\S+))?\s+(\S+)=(.+)$/);
    if (m) out.push({ product: m[1] || null, name: m[2] === 'board' ? 'product' : m[2], values: m[3].split('|').map((v) => v.trim()) });
  }
  return out;
}

/** Check requirements against the device's variables. Returns [{ name, want, have, ok }]. */
export function checkRequirements(reqs, vars) {
  const product = vars.product;
  return reqs
    .filter((r) => !r.product || r.product === product)
    .map((r) => {
      const have = vars[r.name] ?? null;
      const ok = have !== null && r.values.some((v) => (v.endsWith('*') ? have.startsWith(v.slice(0, -1)) : v === have));
      return { name: r.name, want: r.values.join(' | '), have, ok };
    });
}

/**
 * Read a factory zip (outer zip with bootloader/radio and an inner image-*.zip)
 * or an image zip. Returns a plan: { bootloader, radio, images: [{ name, file, logical }],
 * superEmpty, requirements, load(name) }.
 */
export async function readFactoryZip(bytes) {
  let zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const base = (n) => n.split('/').pop();
  const outer = { zip, bootloader: null, radio: null };
  const innerName = names.find((n) => /image-[^/]*\.zip$/i.test(base(n)));
  outer.bootloader = names.find((n) => /^bootloader.*\.img$/i.test(base(n))) || null;
  outer.radio = names.find((n) => /^radio.*\.img$/i.test(base(n))) || null;
  let images = zip;
  if (innerName) images = await JSZip.loadAsync(await zip.file(innerName).async('uint8array'));
  const imgNames = Object.keys(images.files).filter((n) => !images.files[n].dir);
  const info = imgNames.find((n) => base(n) === 'android-info.txt');
  const requirements = info ? parseAndroidInfo(await images.file(info).async('string')) : [];
  const superEmpty = imgNames.find((n) => base(n) === 'super_empty.img') || null;
  const list = imgNames
    .filter((n) => /\.img$/.test(n))
    .map((n) => ({ name: base(n).replace(/\.img$/, ''), file: n }))
    .filter((x) => IMAGE_ORDER.includes(x.name))
    .sort((a, b) => IMAGE_ORDER.indexOf(a.name) - IMAGE_ORDER.indexOf(b.name))
    .map((x) => ({ ...x, logical: !!superEmpty && LOGICAL_PARTITIONS.includes(x.name) }));
  if (!list.length && !outer.bootloader) throw new Error('No flashable images found: expected a factory zip or an image-*.zip.');
  return {
    bootloader: outer.bootloader,
    radio: outer.radio,
    innerZip: innerName || null,
    images: list,
    superEmpty,
    requirements,
    load: async (file) => {
      const z = file === outer.bootloader || file === outer.radio ? outer.zip : images;
      return z.file(file).async('uint8array');
    }
  };
}

/**
 * Flash a factory image plan. `fb()` returns the current device; `reconnect()`
 * waits for the device to come back after a reboot and returns the new one.
 * onStep(text) narrates; onProgress(fraction) tracks the current image.
 */
export async function flashFactory(plan, { fb, reconnect, wipe = false, skip = [], onStep = () => {}, onProgress = () => {} }) {
  const vars = (await fb().getAllVars()).vars;
  const failed = checkRequirements(plan.requirements, vars).filter((r) => !r.ok && r.name === 'product');
  if (failed.length) throw new Error(`This image is for ${failed[0].want}, but the device is ${failed[0].have}.`);
  if (vars.unlocked !== 'yes') throw new Error('The bootloader is locked: unlock it before flashing a factory image.');
  const flashOne = async (partition, file) => {
    const data = await plan.load(file);
    const target = await resolvePartition(fb(), partition);
    onStep(`Flashing ${target} (${(data.length / 1048576).toFixed(1)} MB)`);
    await flashImage(fb(), target, data, { onProgress: (p) => onProgress(p.fraction) });
    return data;
  };
  const rebootBootloader = async () => {
    onStep('Rebooting into the bootloader');
    await fb().reboot('bootloader');
    await reconnect();
  };

  if (plan.bootloader && !skip.includes('bootloader')) { await flashOne('bootloader', plan.bootloader); await rebootBootloader(); }
  if (plan.radio && !skip.includes('radio')) { await flashOne('radio', plan.radio); await rebootBootloader(); }

  const physical = plan.images.filter((i) => !i.logical && !skip.includes(i.name));
  const logical = plan.images.filter((i) => i.logical && !skip.includes(i.name));
  for (const img of physical) await flashOne(img.name, img.file);

  if (logical.length) {
    if ((await fb().getVar('is-userspace').catch(() => 'no')) !== 'yes') {
      onStep('Rebooting into fastbootd to write the dynamic partitions');
      await fb().reboot('fastboot');
      await reconnect();
    }
    if (plan.superEmpty) {
      onStep(`Updating the super partition layout${wipe ? ' (wiping)' : ''}`);
      await fb().download(await plan.load(plan.superEmpty));
      await fb().command(`update-super:super${wipe ? ':wipe' : ''}`);
    }
    for (const img of logical) {
      const data = await plan.load(img.file);
      const target = await resolvePartition(fb(), img.name);
      onStep(`Resizing ${target} and flashing it`);
      await fb().command(`resize-logical-partition:${target}:${imageRawSize(data)}`);
      await flashImage(fb(), target, data, { onProgress: (p) => onProgress(p.fraction) });
    }
  }

  if (wipe) {
    onStep('Erasing userdata and metadata');
    for (const p of ['userdata', 'metadata']) {
      try { await fb().erase(p); } catch (e) { onStep(`(${p}: ${e.message})`); }
    }
  }
  onStep('Done. Reboot when ready.');
}

// ---------------------------------------------------------------------------
// Pre-flash checks, console command safety and CLI export
// ---------------------------------------------------------------------------

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of an image as lowercase hex (WebCrypto). */
export async function sha256Hex(data) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto is not available in this context.');
  return toHex(new Uint8Array(await subtle.digest('SHA-256', data)));
}

/** Identify an image from its first bytes. A sparse image is reported as sparse (its contents are not inspected). */
export function identifyImage(data) {
  const ascii = (o, n) => String.fromCharCode(...data.subarray(o, o + n));
  const u32 = (o) => new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(o, true);
  if (isSparse(data)) return { kind: 'sparse', label: 'Android sparse image' };
  if (data.length >= 8 && ascii(0, 8) === 'ANDROID!') return { kind: 'boot', label: 'Android boot image (ANDROID!)' };
  if (data.length >= 8 && ascii(0, 8) === 'VNDRBOOT') return { kind: 'vendor_boot', label: 'Vendor boot image (VNDRBOOT)' };
  if (data.length >= 4 && ascii(0, 4) === 'AVB0') return { kind: 'vbmeta', label: 'AVB vbmeta image (AVB0)' };
  if (data.length >= 4 && ascii(0, 4) === 'LpMe') return { kind: 'super', label: 'Dynamic partition metadata (LpMe)' };
  if (data.length >= 1084 && data[1080] === 0x53 && data[1081] === 0xef) return { kind: 'ext4', label: 'ext4 filesystem' };
  if (data.length >= 1028 && u32(1024) === 0xe0f5e1e2) return { kind: 'erofs', label: 'EROFS filesystem' };
  return { kind: 'unknown', label: 'Unrecognised format (raw blob)' };
}

/** Parse a fastboot size variable ("0x4000000" or decimal) to a number, or null. */
export function parseSizeVar(v) {
  if (v == null) return null;
  const s = String(v).trim();
  const n = /^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Sanity-check an image against a partition before flashing. Returns
 * [{ level: 'warn', text }]. `vars` is the getvar:all object. These are hints, not guarantees.
 */
export function preflightChecks(partition, data, vars = {}) {
  const out = [];
  const id = identifyImage(data);
  const base = partition.replace(/_(a|b)$/, '');
  const size = imageRawSize(data);
  const cap = parseSizeVar(vars[`partition-size:${partition}`]) ?? parseSizeVar(vars[`partition-size:${base}`]);
  if (cap !== null && size > cap) out.push({ level: 'warn', text: `Image is ${size} bytes but partition ${partition} is only ${cap} bytes.` });
  const bootLike = { boot: 'boot', init_boot: 'boot', recovery: 'boot', vendor_boot: 'vendor_boot', vbmeta: 'vbmeta', vbmeta_system: 'vbmeta', vbmeta_vendor: 'vbmeta' }[base];
  if (bootLike && id.kind !== 'sparse' && id.kind !== bootLike) out.push({ level: 'warn', text: `${base} normally holds a ${bootLike} image, but this file looks like: ${id.label}.` });
  if (LOGICAL_PARTITIONS.includes(base) && ['boot', 'vbmeta', 'vendor_boot'].includes(id.kind)) out.push({ level: 'warn', text: `${base} is a filesystem partition, but this file looks like: ${id.label}.` });
  if (base === 'userdata' || base === 'metadata') out.push({ level: 'warn', text: `Flashing ${base} replaces user data.` });
  if (['bootloader', 'radio', 'modem', 'aboot', 'sbl1', 'xbl', 'abl'].includes(base)) out.push({ level: 'warn', text: `${base} is firmware. A wrong or interrupted flash can leave the device unbootable${vars.product ? ` (device product: ${vars.product})` : ''}.` });
  return out;
}

const DESTRUCTIVE = [
  [/^erase:/i, 'erases a partition'],
  [/^format[:\s]/i, 'formats a partition'],
  [/^flash:/i, 'flashes the download buffer to a partition'],
  [/^flashing\s+(unlock|lock|unlock_critical|lock_critical)/i, 'changes the bootloader lock and usually wipes user data'],
  [/^oem\s+(unlock|lock)/i, 'changes the bootloader lock and usually wipes user data'],
  [/^oem\s+(wipe|erase|format|fuse|rpmb|ramdump)/i, 'is a vendor wipe/fuse/debug command'],
  [/^(set_active|update-super|create-logical-partition|delete-logical-partition|resize-logical-partition|snapshot-update|wipe-super)/i, 'changes the active slot or the partition layout']
];

const COLON_VERBS = /^(getvar|erase|format|set_active|snapshot-update|create-logical-partition|delete-logical-partition|resize-logical-partition|update-super)\s+/i;

/**
 * Turn what the user typed into a wire command and describe its risk.
 * Accepts CLI style ("getvar all", "oem device-info", "reboot bootloader") or wire style ("getvar:all").
 * Returns { cmd, destructive, reason }; throws for empty, over-long or file-transfer commands.
 */
export function prepareConsoleCommand(input) {
  let s = String(input || '').trim().replace(/^fastboot\s+/i, '');
  if (!s) throw new Error('Type a command first.');
  if (/^(download|upload|boot|flash)(\s|:|$)/i.test(s) && !/^flash:\S/i.test(s)) {
    throw new Error('download, upload, boot and flash take file data: use the FLASH / ERASE / BOOT panel.');
  }
  if (/^download:|^upload\b|^boot$/i.test(s)) throw new Error('download and upload take file data: use the FLASH / ERASE / BOOT panel.');
  const rb = s.match(/^reboot(?:[\s-]+(bootloader|recovery|fastboot))?$/i);
  if (rb) s = rb[1] ? `reboot-${rb[1].toLowerCase()}` : 'reboot';
  else if (/^(oem|flashing)[:\s]/i.test(s)) s = s.replace(/^(oem|flashing):\s*/i, '$1 ');
  else if (COLON_VERBS.test(s)) s = s.replace(/^(\S+)\s+/, '$1:').replace(/\s+/g, ' ');
  if (new TextEncoder().encode(s).length > 64) throw new Error('Fastboot commands are limited to 64 bytes.');
  const hit = DESTRUCTIVE.find(([re]) => re.test(s));
  return { cmd: s, destructive: !!hit, reason: hit ? hit[1] : '' };
}

/** Variables as `fastboot getvar all` prints them ("(bootloader) name: value"). */
export function formatVarsText(vars) {
  return Object.entries(vars || {}).map(([k, v]) => `(bootloader) ${k}: ${v}`).join('\n');
}

const sh = (s) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "'\\''")}'`);

/** The desktop fastboot command for one flash. Export only: the browser tool does not run it. */
export function cliFlashCommand(partition, fileName, { slot = null } = {}) {
  const slotArg = slot === 'all' ? ' --slot=all' : slot ? ` --slot=${slot}` : '';
  return `fastboot${slotArg} flash ${sh(partition)} ${sh(fileName)}`;
}

/**
 * A flash-all.sh style script for a factory plan (same order as flashFactory).
 * Export only: it is text for the desktop fastboot tool.
 */
export function buildFlashAllScript(plan, { wipe = false, skip = [] } = {}) {
  const L = ['#!/bin/sh', '# Generated by Skon\'s USB Tool. Run with the files extracted next to this script.', 'set -e'];
  const base = (f) => f.split('/').pop();
  if (plan.bootloader && !skip.includes('bootloader')) L.push(`fastboot flash bootloader ${sh(base(plan.bootloader))}`, 'fastboot reboot-bootloader', 'sleep 5');
  if (plan.radio && !skip.includes('radio')) L.push(`fastboot flash radio ${sh(base(plan.radio))}`, 'fastboot reboot-bootloader', 'sleep 5');
  const phys = plan.images.filter((i) => !i.logical && !skip.includes(i.name));
  const logi = plan.images.filter((i) => i.logical && !skip.includes(i.name));
  for (const i of phys) L.push(`fastboot flash ${i.name} ${sh(base(i.file))}`);
  if (logi.length) {
    L.push('fastboot reboot-fastboot', 'sleep 5');
    if (plan.superEmpty) L.push(`fastboot update-super super ${sh(base(plan.superEmpty))}${wipe ? ' --wipe' : ''}`);
    for (const i of logi) L.push(`fastboot flash ${i.name} ${sh(base(i.file))}`);
  }
  if (wipe) L.push('fastboot erase userdata', 'fastboot erase metadata');
  L.push('fastboot reboot');
  return L.join('\n') + '\n';
}
