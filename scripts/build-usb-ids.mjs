#!/usr/bin/env node
/**
 * Regenerate src/data/usb-ids.json from the linux-usb.org usb.ids list.
 *
 *   node scripts/build-usb-ids.mjs path/to/usb.ids      # from a local copy
 *   node scripts/build-usb-ids.mjs --fetch               # download http://www.linux-usb.org/usb.ids
 *
 * usb.ids is dual-licensed BSD-3-Clause / GPL-2.0-or-later; this project uses it
 * under BSD-3-Clause. The upstream header comment is preserved in the output's
 * `header` field. Output is deterministic (same input -> same bytes).
 *
 * Output shape (compact arrays, ids are numbers):
 *   { version, date, license, source, header: [lines],
 *     vendors: [[vid, name, [[pid, name], ...]], ...],
 *     classes: [[class, name, [[subclass, name, [[protocol, name], ...]], ...]], ...] }
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, '../src/data/usb-ids.json');
const URL_UPSTREAM = 'http://www.linux-usb.org/usb.ids';

/** Parse usb.ids text into the compact structure. Exported for tests. */
export function parseUsbIds(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const header = [];
  let version = null;
  let date = null;
  const vendors = [];
  const classes = [];
  let section = 'vendor';
  let curV = null;
  let curC = null;
  let curS = null;
  let inHeader = true;

  for (const raw of lines) {
    if (inHeader) {
      if (raw.startsWith('#')) {
        header.push(raw);
        const v = /^#\s*Version:\s*(.+)$/.exec(raw);
        if (v) version = v[1].trim();
        const d = /^#\s*Date:\s*(.+)$/.exec(raw);
        if (d) date = d[1].trim();
        continue;
      }
      if (raw.trim() === '') { if (version) inHeader = false; continue; }
      inHeader = false;
    }
    if (raw === '' || raw.startsWith('#')) continue;

    if (!raw.startsWith('\t')) {
      let m;
      if ((m = /^C ([0-9a-f]{2})\s+(.+)$/i.exec(raw))) {
        section = 'class';
        curC = [parseInt(m[1], 16), m[2].trim(), []];
        classes.push(curC);
        curS = null;
      } else if (/^[A-Z]+ /.test(raw)) {
        section = 'other'; // AT, HID, R, BIAS, PHY, HUT, L, HCC, VT ...
      } else if (section === 'vendor' && (m = /^([0-9a-f]{4})\s+(.+)$/i.exec(raw))) {
        curV = [parseInt(m[1], 16), m[2].trim(), []];
        vendors.push(curV);
      }
      continue;
    }
    if (section === 'vendor' && curV) {
      let m;
      if ((m = /^\t([0-9a-f]{4})\s+(.+)$/i.exec(raw))) curV[2].push([parseInt(m[1], 16), m[2].trim()]);
      // two-tab interface lines are intentionally dropped (size)
    } else if (section === 'class' && curC) {
      let m;
      if ((m = /^\t([0-9a-f]{2})\s+(.+)$/i.exec(raw))) {
        curS = [parseInt(m[1], 16), m[2].trim(), []];
        curC[2].push(curS);
      } else if (curS && (m = /^\t\t([0-9a-f]{2})\s+(.+)$/i.exec(raw))) {
        curS[2].push([parseInt(m[1], 16), m[2].trim()]);
      }
    }
  }
  return {
    version, date,
    license: 'usb.ids (c) Stephen J. Gowdy and contributors; dual-licensed BSD-3-Clause / GPL-2.0-or-later, used here under BSD-3-Clause.',
    source: URL_UPSTREAM,
    header,
    vendors,
    classes
  };
}

async function main() {
  const arg = process.argv[2];
  if (!arg) { console.error('usage: build-usb-ids.mjs <usb.ids path> | --fetch'); process.exit(1); }
  let text;
  if (arg === '--fetch') {
    const res = await fetch(URL_UPSTREAM);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    text = await res.text();
  } else {
    text = readFileSync(arg, 'utf8');
  }
  const data = parseUsbIds(text);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(data) + '\n');
  const products = data.vendors.reduce((n, v) => n + v[2].length, 0);
  console.log(`usb.ids ${data.version}: ${data.vendors.length} vendors, ${products} products, ${data.classes.length} classes -> ${OUT}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
