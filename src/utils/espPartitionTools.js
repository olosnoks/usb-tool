// Extra pure helpers for the ESP partition editor: layout presets, layout lint (OTA sanity),
// usage statistics, "fill to end of flash" and build-system snippets. No React, no I/O.
import {
  TYPE_APP, TYPE_DATA, FIRST_FREE_OFFSET, APP_ALIGN, DATA_ALIGN, resolveOffsets, subtypeName
} from './espNvs/partitionTable.js';

export const FLASH_SIZES = [0x100000, 0x200000, 0x400000, 0x800000, 0x1000000, 0x2000000, 0x4000000];

const SUB_FACTORY = 0x00;
const SUB_OTA0 = 0x10;
const SUB_OTA15 = 0x1f;
const SUB_OTADATA = 0x00;
const SUB_NVS = 0x02;
const SUB_PHY = 0x01;
const SUB_SPIFFS = 0x82;
const SUB_FAT = 0x81;
const SUB_LITTLEFS = 0x83;
const FS_SUBTYPES = [SUB_SPIFFS, SUB_FAT, SUB_LITTLEFS];

const row = (name, type, subtype, size, offset = null) => ({ name, type, subtype, offset, size, encrypted: false, readonly: false });

export const PRESETS = [
  { id: 'single', label: 'Single app (ESP-IDF default)', desc: 'nvs, phy_init, one 1 MiB factory app' },
  { id: 'ota', label: 'Two OTA slots', desc: 'nvs, otadata, phy_init, ota_0, ota_1 (equal slots)' },
  { id: 'ota-fs', label: 'Two OTA slots + filesystem', desc: 'As above plus a SPIFFS partition using the rest of the flash' },
  { id: 'factory-ota', label: 'Factory + two OTA slots', desc: 'factory, ota_0, ota_1 and otadata' }
];

/** Largest multiple of `align` that is <= n. */
const floorTo = (n, align) => n - (n % align);
const alignUp = (n, align) => (n % align ? n + (align - (n % align)) : n);

/**
 * Build a numeric row list for a preset on a flash of `flashSize` bytes. Offsets are left blank (auto).
 * App slots are sized so the layout fits; throws when the flash is too small.
 */
export function buildPreset(id, flashSize) {
  if (!PRESETS.some((p) => p.id === id)) throw new Error(`Unknown preset "${id}".`);
  if (!Number.isInteger(flashSize) || flashSize < 0x100000) throw new Error('Flash size must be at least 1 MiB.');
  const head = [row('nvs', TYPE_DATA, SUB_NVS, 0x6000)];
  if (id === 'single') {
    return [...head, row('phy_init', TYPE_DATA, SUB_PHY, 0x1000), row('factory', TYPE_APP, SUB_FACTORY, 0x100000)];
  }
  const withOta = [...head, row('otadata', TYPE_DATA, SUB_OTADATA, 0x2000), row('phy_init', TYPE_DATA, SUB_PHY, 0x1000)];
  const fixed = FIRST_FREE_OFFSET + 0x6000 + 0x2000 + 0x1000;
  const slots = id === 'factory-ota' ? 3 : 2;
  const fsReserve = id === 'ota-fs' ? Math.max(0x100000 - 0x10000, floorTo(Math.floor(flashSize / 4), 0x1000)) : 0;
  const budget = flashSize - alignUp(fixed, APP_ALIGN) - fsReserve;
  let slot = floorTo(Math.floor(budget / slots), APP_ALIGN);
  if (slot > 0x300000) slot = 0x300000;
  if (slot < 0x80000) throw new Error('Flash is too small for this preset (app slots would be under 512 KiB).');
  const apps = id === 'factory-ota'
    ? [row('factory', TYPE_APP, SUB_FACTORY, slot), row('ota_0', TYPE_APP, SUB_OTA0, slot), row('ota_1', TYPE_APP, SUB_OTA0 + 1, slot)]
    : [row('ota_0', TYPE_APP, SUB_OTA0, slot), row('ota_1', TYPE_APP, SUB_OTA0 + 1, slot)];
  const out = [...withOta, ...apps];
  if (id === 'ota-fs') {
    const resolved = resolveOffsets(out);
    const last = resolved[resolved.length - 1];
    const start = alignUp(last.offset + last.size, DATA_ALIGN);
    const size = floorTo(flashSize - start, DATA_ALIGN);
    if (size >= 0x4000) out.push(row('spiffs', TYPE_DATA, SUB_SPIFFS, size));
  }
  return out;
}

/**
 * Grow (or shrink) the last placed partition so it ends at the end of flash (4 KiB aligned).
 * Returns { rows, name, oldSize, newSize } or throws when impossible. Offsets must be resolved.
 */
export function fillToEnd(resolvedRows, flashSize) {
  const placed = resolvedRows.map((r, i) => ({ r, i })).filter(({ r }) => Number.isInteger(r.offset) && Number.isInteger(r.size));
  if (!placed.length) throw new Error('No partitions to resize.');
  const last = placed.reduce((a, b) => (b.r.offset > a.r.offset ? b : a));
  const newSize = floorTo(flashSize - last.r.offset, DATA_ALIGN);
  if (newSize <= 0) throw new Error(`"${last.r.name}" starts at or past the end of the flash.`);
  const rows = resolvedRows.map((r, i) => (i === last.i ? { ...r, size: newSize } : r));
  return { rows, name: last.r.name, oldSize: last.r.size, newSize };
}

/** Used / free bytes of a resolved layout. `span` is the flash size or the highest end. */
export function layoutStats(resolvedRows, flashSize) {
  const placed = resolvedRows.filter((r) => Number.isInteger(r.offset) && Number.isInteger(r.size) && r.size > 0);
  const span = Math.max(flashSize || 0, FIRST_FREE_OFFSET, ...placed.map((r) => r.offset + r.size));
  let app = 0;
  let data = 0;
  let highest = FIRST_FREE_OFFSET;
  for (const r of placed) {
    if (r.type === TYPE_APP) app += r.size; else data += r.size;
    highest = Math.max(highest, r.offset + r.size);
  }
  const used = FIRST_FREE_OFFSET + app + data;
  return { span, app, data, reserved: FIRST_FREE_OFFSET, used, free: Math.max(0, span - used), highest, tail: Math.max(0, span - highest) };
}

/**
 * Layout advice beyond gen_esp32part's hard errors (all warnings): OTA slots without otadata,
 * otadata size, unequal OTA slots, no boot target, no nvs, phy missing.
 */
export function lintLayout(resolvedRows) {
  const out = [];
  const apps = resolvedRows.filter((r) => r.type === TYPE_APP);
  const data = resolvedRows.filter((r) => r.type === TYPE_DATA);
  const otaSlots = apps.filter((r) => r.subtype >= SUB_OTA0 && r.subtype <= SUB_OTA15);
  const otadata = data.filter((r) => r.subtype === SUB_OTADATA);
  if (otaSlots.length > 0 && otadata.length === 0) out.push('OTA app slots exist but there is no otadata partition (data, ota). The bootloader cannot pick a slot without it.');
  if (otaSlots.length === 0 && otadata.length > 0) out.push('An otadata partition exists but there are no ota_N app partitions.');
  for (const o of otadata) if (o.size !== 0x2000) out.push(`${o.name}: otadata is normally exactly 0x2000 bytes (two sectors); this one is 0x${o.size.toString(16)}.`);
  if (otaSlots.length === 1) out.push('Only one OTA slot: an update has nowhere to be written while it is running. Use at least two.');
  if (new Set(otaSlots.map((r) => r.size)).size > 1) out.push('OTA slots have different sizes; a firmware that fits one slot may not fit the other.');
  if (otaSlots.length > 0 && !apps.some((r) => r.subtype === SUB_FACTORY) && !otaSlots.some((r) => r.subtype === SUB_OTA0)) {
    out.push('No factory app and no ota_0: the bootloader has no default app to start.');
  }
  if (apps.length === 0) out.push('No app partition: nothing can boot.');
  if (!data.some((r) => r.subtype === SUB_NVS)) out.push('No nvs partition: Wi-Fi calibration data, Preferences and many libraries need one.');
  if (apps.length > 0 && !data.some((r) => r.subtype === SUB_PHY)) out.push('No phy_init partition: fine for builds that embed PHY init data, otherwise RF calibration data is not stored.');
  if (data.filter((r) => FS_SUBTYPES.includes(r.subtype)).length > 1) out.push('More than one filesystem partition; most libraries mount only one, selected by label.');
  return out;
}

/** One-line description of a row for tooltips. */
export const describeRow = (r) => `${r.name}: ${r.type === TYPE_APP ? 'app' : 'data'}/${subtypeName(r.type, r.subtype)}`;

/**
 * Build-system snippets for using the exported CSV. These are text to copy; the browser cannot
 * apply them to a project for you.
 */
export function buildSnippets(filename = 'partitions.csv', flashSize) {
  const flash = flashSize ? `${flashSize / 0x100000}MB` : null;
  return {
    platformio: `; platformio.ini\nboard_build.partitions = ${filename}${flash ? `\nboard_upload.flash_size = ${flash}` : ''}\n`,
    sdkconfig: `# sdkconfig.defaults (ESP-IDF)\nCONFIG_PARTITION_TABLE_CUSTOM=y\nCONFIG_PARTITION_TABLE_CUSTOM_FILENAME="${filename}"\nCONFIG_PARTITION_TABLE_OFFSET=0x8000${flash ? `\nCONFIG_ESPTOOLPY_FLASHSIZE_${flash}=y` : ''}\n`,
    gen: `python gen_esp32part.py --verify ${filename} partitions.bin\n`
  };
}
