// Post-build license compliance step (runs after `vite build`, see package.json "build").
//
// 1. dist/THIRD_PARTY_NOTICES.txt — the license text of every production dependency that can end up in
//    the bundle (the dependency tree of package.json "dependencies"), plus code ported into src/.
//    MIT/BSD/ISC require their notices to travel with copies of the software.
// 2. dist/mayhem/mayhem-mobile-source.zip + dist/mayhem/LICENSE.txt — Mayhem Mobile is GPL-3.0 and the
//    site serves it compiled, so the corresponding source is offered from the same place.
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const dist = path.join(root, 'dist');
if (!fs.existsSync(dist)) throw new Error('dist/ not found: run vite build first');

// ---------- 1. third-party notices ----------
function findPkgDir(name, fromDir) {
  let dir = fromDir;
  for (;;) {
    const cand = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(cand, 'package.json'))) return cand;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;
const BSD3_TEXT = [
  'Redistribution and use in source and binary forms, with or without modification, are permitted',
  'provided that the following conditions are met:',
  '1. Redistributions of source code must retain the above copyright notice, this list of conditions',
  '   and the following disclaimer.',
  '2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions',
  '   and the following disclaimer in the documentation and/or other materials provided with the distribution.',
  '3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or',
  '   promote products derived from this software without specific prior written permission.',
  '',
  'THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED',
  'WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A',
  'PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY',
  'DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,',
  'PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER',
  'CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE',
  'OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH',
  'DAMAGE.',
].join('\n');
const MIT_TEXT = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
  .split('\n').slice(4).join('\n').split('\n----')[0].trim(); // the permission + warranty paragraphs of our own MIT LICENSE
const seen = new Map(); // "name@version" -> { name, version, license, text, homepage }

function visit(name, fromDir) {
  const dir = findPkgDir(name, fromDir);
  if (!dir) return;
  const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const key = `${pj.name}@${pj.version}`;
  if (seen.has(key)) return;
  const license = typeof pj.license === 'object' ? pj.license.type
    : pj.license || (pj.licenses || []).map((l) => l.type).join(' OR ') || 'UNKNOWN';
  const files = fs.readdirSync(dir).filter((f) => LICENSE_FILE.test(f)).sort();
  let text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8').trim()).join('\n\n');
  if (!text && license === 'MIT') {
    // the package ships no license file; MIT still asks for its notice, so write the standard text
    const author = typeof pj.author === 'string' ? pj.author.replace(/\s*<[^>]*>|\s*\([^)]*\)/g, '') : pj.author?.name;
    text = `MIT License\n\nCopyright (c) ${author || `the ${pj.name} authors`}\n\n${MIT_TEXT}`;
  }
  const homepage = pj.homepage || (typeof pj.repository === 'string' ? pj.repository : pj.repository?.url) || '';
  seen.set(key, { name: pj.name, version: pj.version, license, text, homepage });
  for (const dep of Object.keys(pj.dependencies || {})) visit(dep, dir);
}

const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
for (const dep of Object.keys(rootPkg.dependencies || {})) visit(dep, root);

const bar = '-'.repeat(78);
const out = [
  "Third-party notices for Skon's USB Tool (https://usb-tool.olosnoks.com)",
  'Generated at build time from the production dependency tree. The project itself is MIT; see LICENSE.',
  '',
  bar,
  'usb-rea (ported into src/utils/usbrea/) — MIT',
  'https://github.com/emirmrkaljevic/usb-rea',
  '',
  fs.readFileSync(path.join(root, 'src/utils/usbrea/LICENSE'), 'utf8').trim(),
  '',
  bar,
  'usb.ids (bundled as src/data/usb-ids.json) — BSD-3-Clause (upstream is dual BSD-3-Clause / GPL-2.0-or-later)',
  'http://www.linux-usb.org/usb.ids',
  '',
  'Copyright (c) Stephen J. Gowdy and the usb.ids contributors. All rights reserved.',
  '',
  BSD3_TEXT,
  '',
  bar,
  'Mayhem Mobile (served at /mayhem/) — GPL-3.0-only, built from PortaPack Mayhem',
  'Source: /mayhem/mayhem-mobile-source.zip   License: /mayhem/LICENSE.txt',
  '',
];
const pkgs = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
for (const p of pkgs) {
  out.push(bar, `${p.name} ${p.version} — ${p.license}`);
  if (p.homepage) out.push(p.homepage.replace(/^git\+/, ''));
  out.push('', p.text || `(No license file in the package; declared license: ${p.license}.)`, '');
}
fs.writeFileSync(path.join(dist, 'THIRD_PARTY_NOTICES.txt'), out.join('\n'));

// copyleft without an MIT option, or no license text at all, needs a human look
const flagged = pkgs.filter((p) => (/(^|[^L])GPL|AGPL/i.test(p.license) && !/\bMIT\b/.test(p.license)) || !p.text);
if (flagged.length) {
  console.warn('[notices] check these licenses:', flagged.map((p) => `${p.name} (${p.license})`).join(', '));
}

// ---------- 2. Mayhem Mobile corresponding source ----------
const mayhemSrc = path.join(root, 'src/mayhem-mobile');
const mayhemOut = path.join(dist, 'mayhem');
if (fs.existsSync(mayhemSrc) && fs.existsSync(mayhemOut)) {
  const zip = new JSZip();
  const SKIP = new Set(['node_modules', '.git', 'dist']);
  const add = (dir, rel) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) add(abs, r);
      else zip.file(`mayhem-mobile/${r}`, fs.readFileSync(abs));
    }
  };
  add(mayhemSrc, '');
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(mayhemOut, 'mayhem-mobile-source.zip'), buf);
  fs.copyFileSync(path.join(mayhemSrc, 'LICENSE'), path.join(mayhemOut, 'LICENSE.txt'));
}

console.log(`[notices] ${pkgs.length} packages -> dist/THIRD_PARTY_NOTICES.txt; Mayhem source zip written`);
