import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  installApk, installMultiple, selectApksSet, apkSetFromArchive, deviceInstallProfile, walkRemote, pullDirectory,
  createZipSink, directoryHandleSink, parseBugreportLine, runBugreport, TerminalText
} from '../src/utils/adbTools';
import { AdbConnection } from '../src/utils/adbDriver';
import { generateAdbKey } from '../src/utils/adbCrypto';
import { createSimulatedAdb } from './helpers/sim/adb';

const key = await generateAdbKey();
const keyStore = { async get() { return key; } };

async function simConn() {
  const transport = createSimulatedAdb();
  const conn = new AdbConnection(transport, { keyStore });
  await conn.connect();
  return { conn, state: transport.state };
}
const bytes = (n, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 5 + seed) & 0xff);

describe('split APK install', () => {
  it('streams every APK into one pm session and commits it', async () => {
    const { conn, state } = await simConn();
    const apks = [
      { name: 'base.apk', blob: new Blob([bytes(300000, 1)]) },
      { name: 'split_config.arm64_v8a.apk', bytes: bytes(1000, 2) },
      { name: 'split config.en.apk', bytes: bytes(10, 3) }
    ];
    const marks = [];
    const out = await installMultiple(conn, apks, { onProgress: (f) => marks.push(f) });
    expect(out).toContain('Success');
    expect(state.committed).toHaveLength(1);
    const [sess] = state.committed;
    expect(sess.args).toContain('-S 301010');
    expect(sess.writes.map((w) => w.name)).toEqual(['0_base.apk', '1_split_config.arm64_v8a.apk', '2_split_config.en.apk']);
    expect(sess.writes[0].bytes).toEqual(bytes(300000, 1));
    expect(sess.writes[1].bytes).toEqual(bytes(1000, 2));
    expect(marks.at(-1)).toBe(1);
    expect(state.packages).toContain('com.example.split');
  });

  it('abandons the session when a write fails or the user cancels', async () => {
    const { conn, state } = await simConn();
    const ctl = new AbortController();
    ctl.abort();
    await expect(installMultiple(conn, [{ name: 'a.apk', bytes: bytes(10) }], { signal: ctl.signal })).rejects.toThrow(/Cancelled/);
    expect(state.abandoned).toHaveLength(1);
    expect(state.committed).toHaveLength(0);
    await expect(installMultiple(conn, [])).rejects.toThrow(/No APK/);
  });

  it('installs a single APK from a File without loading it whole', async () => {
    const { conn, state } = await simConn();
    const out = await installApk(conn, new Blob([bytes(200000)]));
    expect(out).toContain('Success');
    expect(Object.values(state.files).some((f) => f.length === 200000)).toBe(true);
  });
});

describe('install bundles', () => {
  const names = [
    'toc.pb', 'splits/base-master.apk', 'splits/base-arm64_v8a.apk', 'splits/base-armeabi_v7a.apk', 'splits/base-x86.apk',
    'splits/base-hdpi.apk', 'splits/base-xxhdpi.apk', 'splits/base-xxxhdpi.apk', 'splits/base-en.apk', 'splits/base-fr.apk',
    'splits/feature-master.apk'
  ];

  it('picks the master, ABI, density and language splits for the device', () => {
    const { names: picked, skipped } = selectApksSet(names, { abis: ['arm64_v8a', 'armeabi_v7a'], density: 420 });
    expect(picked.sort()).toEqual(['splits/base-arm64_v8a.apk', 'splits/base-armeabi_v7a.apk', 'splits/base-en.apk', 'splits/base-master.apk', 'splits/base-xxhdpi.apk', 'splits/feature-master.apk'].sort());
    expect(skipped).toContain('splits/base-x86.apk');
    expect(skipped).toContain('splits/base-fr.apk');
  });

  it('prefers universal.apk and rejects standalone-only archives for the wrong CPU', () => {
    expect(selectApksSet(['universal.apk', 'toc.pb']).names).toEqual(['universal.apk']);
    expect(selectApksSet(['standalones/standalone-arm64_v8a_xxhdpi.apk', 'standalones/standalone-x86.apk'], { abis: ['arm64_v8a'] }).names)
      .toEqual(['standalones/standalone-arm64_v8a_xxhdpi.apk']);
    expect(() => selectApksSet(['standalones/standalone-x86.apk', 'standalones/standalone-x86_64.apk'], { abis: ['arm64_v8a'] })).toThrow(/standalone/);
  });

  it('reads an .xapk (manifest) and flags OBB files it will not install', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify({ split_apks: [{ file: 'base.apk', id: 'base' }, { file: 'config.en.apk', id: 'x' }] }));
    zip.file('base.apk', bytes(50));
    zip.file('config.en.apk', bytes(20));
    zip.file('extra.apk', bytes(5)); // not in the manifest
    zip.file('Android/obb/com.x/main.1.com.x.obb', bytes(8));
    const { apks, notes } = await apkSetFromArchive(await zip.generateAsync({ type: 'uint8array' }));
    expect(apks.map((a) => a.name).sort()).toEqual(['base.apk', 'config.en.apk']);
    expect(apks[0].bytes.length).toBeGreaterThan(0);
    expect(notes.join(' ')).toMatch(/OBB/);
  });

  it('reads a bundletool .apks using the device profile', async () => {
    const { conn } = await simConn();
    const profile = await deviceInstallProfile(conn);
    expect(profile).toEqual({ abis: ['arm64_v8a', 'armeabi_v7a', 'armeabi'], density: 420 });
    const zip = new JSZip();
    for (const n of names) zip.file(n, bytes(4));
    const { apks, notes } = await apkSetFromArchive(await zip.generateAsync({ type: 'uint8array' }), profile);
    expect(apks.map((a) => a.name)).toContain('base-arm64_v8a.apk');
    expect(apks.map((a) => a.name)).not.toContain('base-x86.apk');
    expect(notes[0]).toMatch(/skipped/);
  });

  it('falls back to root-level APKs for a plain zip and errors on an empty one', async () => {
    const zip = new JSZip();
    zip.file('a.apk', bytes(3)); zip.file('sub/b.apk', bytes(3));
    expect((await apkSetFromArchive(await zip.generateAsync({ type: 'uint8array' }))).apks.map((a) => a.name)).toEqual(['a.apk']);
    const empty = new JSZip(); empty.file('readme.txt', 'x');
    await expect(apkSetFromArchive(await empty.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/No .apk/);
  });
});

describe('folder pull', () => {
  async function withTree() {
    const { conn, state } = await simConn();
    state.files['/sdcard/Pics/a.jpg'] = bytes(150000, 1);
    state.files['/sdcard/Pics/trip/b.jpg'] = bytes(70000, 2);
    state.files['/sdcard/Pics/trip/day1/c.txt'] = bytes(5, 3);
    return { conn, state };
  }
  const memorySink = () => {
    const out = {};
    return { out, openFile(rel) { const parts = []; return { write: (c) => { parts.push(c.slice()); }, close: () => { out[rel] = parts; } }; } };
  };
  const joined = (parts) => { const n = parts.reduce((a, p) => a + p.length, 0); const r = new Uint8Array(n); let o = 0; parts.forEach((p) => { r.set(p, o); o += p.length; }); return r; };

  it('walks a tree recursively with sizes', async () => {
    const { conn } = await withTree();
    const { files } = await walkRemote(conn, '/sdcard/Pics');
    expect(files.map((f) => f.rel).sort()).toEqual(['a.jpg', 'trip/b.jpg', 'trip/day1/c.txt']);
    expect(files.find((f) => f.rel === 'a.jpg').size).toBe(150000);
  });

  it('streams every file into a sink and reports overall progress', async () => {
    const { conn } = await withTree();
    const sink = memorySink();
    const marks = [];
    const res = await pullDirectory(conn, '/sdcard/Pics/', sink, { onProgress: (p) => marks.push(p.fraction) });
    expect(res).toMatchObject({ files: 3, bytes: 220005, total: 220005, failed: [] });
    expect(joined(sink.out['trip/b.jpg'])).toEqual(bytes(70000, 2));
    expect(joined(sink.out['trip/day1/c.txt'])).toEqual(bytes(5, 3));
    expect(marks.at(-1)).toBe(1);
  });

  it('records a failing file and keeps going; cancel stops', async () => {
    const { conn } = await withTree();
    const sink = memorySink();
    const bad = { openFile: (rel) => { if (rel === 'a.jpg') throw new Error('invalid file name'); return sink.openFile(rel); } };
    const res = await pullDirectory(conn, '/sdcard/Pics', bad);
    expect(res.files).toBe(2);
    expect(res.failed).toEqual([{ path: '/sdcard/Pics/a.jpg', error: 'invalid file name' }]);
    const ctl = new AbortController(); ctl.abort();
    await expect(pullDirectory(conn, '/sdcard/Pics', sink, { signal: ctl.signal })).rejects.toThrow(/Cancelled/);
  });

  it('can build a zip', async () => {
    const { conn } = await withTree();
    const sink = await createZipSink();
    await pullDirectory(conn, '/sdcard/Pics', sink);
    const zip = await JSZip.loadAsync(await (await sink.generate()).arrayBuffer());
    expect(Object.keys(zip.files).sort()).toContain('trip/day1/c.txt');
    expect((await zip.file('a.jpg').async('uint8array')).length).toBe(150000);
  });

  it('writes into a directory handle (File System Access API shape)', async () => {
    const written = {};
    const mkDir = (path) => ({
      getDirectoryHandle: async (n) => mkDir(`${path}${n}/`),
      getFileHandle: async (n) => ({ createWritable: async () => { const parts = []; return { write: (c) => { parts.push(c.slice()); }, close: () => { written[`${path}${n}`] = joined(parts); } }; } })
    });
    const { conn } = await withTree();
    await pullDirectory(conn, '/sdcard/Pics', directoryHandleSink(mkDir('')));
    expect(Object.keys(written).sort()).toEqual(['a.jpg', 'trip/b.jpg', 'trip/day1/c.txt']);
    expect(written['a.jpg']).toEqual(bytes(150000, 1));
  });
});

describe('bugreport', () => {
  it('parses bugreportz output lines', () => {
    expect(parseBugreportLine('PROGRESS:5/20')).toEqual({ type: 'progress', done: 5, total: 20 });
    expect(parseBugreportLine('OK:/bugreports/x.zip')).toEqual({ type: 'ok', path: '/bugreports/x.zip' });
    expect(parseBugreportLine('FAIL:no space')).toEqual({ type: 'fail', message: 'no space' });
    expect(parseBugreportLine('garbage')).toBeNull();
  });

  it('runs bugreportz and returns the zip path with progress', async () => {
    const { conn } = await simConn();
    const marks = [];
    expect(await runBugreport(conn, { onProgress: (f) => marks.push(f) })).toBe('/bugreports/bugreport-sim.zip');
    expect(marks).toEqual([0.5, 1]);
  });
});

describe('TerminalText', () => {
  it('handles CRLF, carriage-return redraws and backspace', () => {
    const t = new TerminalText();
    t.append('sim:/ $ ls\r\nfile1\r\n');
    expect(t.text).toBe('sim:/ $ ls\nfile1\n');
    t.append('abc\rX');
    expect(t.text).toBe('sim:/ $ ls\nfile1\nXbc');
    t.append('\b\bZ\x1b[K');
    expect(t.text.endsWith('\nZ')).toBe(true);
  });

  it('strips colours and OSC titles, even when split across chunks', () => {
    const t = new TerminalText();
    t.append('\x1b[1;32mgreen\x1b[0m \x1b]0;title\x07done');
    expect(t.text).toBe('green done');
    const u = new TerminalText();
    u.append('a\x1b[3'); u.append('1mred\x1b[0m');
    expect(u.text).toBe('ared');
  });

  it('keeps only the last maxLines lines', () => {
    const t = new TerminalText({ maxLines: 3 });
    t.append('1\n2\n3\n4\n5\n');
    expect(t.text).toBe('3\n4\n5\n');
  });
});
