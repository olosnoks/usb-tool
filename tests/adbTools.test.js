import { describe, it, expect } from 'vitest';
import {
  parseGetprop, deviceSummary, parseBattery, parseLogcatLine, LogcatPoller, parsePackages, installApk, uninstallPackage,
  packagePaths, packageVersion, inputTextCommand, tapCommand, parseWmSize, crc32, encodePng
} from '../src/utils/adbTools';
import { AdbConnection } from '../src/utils/adbDriver';
import { createSimulatedAdb } from './helpers/sim/adb';
import { generateAdbKey } from '../src/utils/adbCrypto';

const keyStore = () => {
  let key = null;
  return { async get() { if (!key) key = await generateAdbKey(); return key; } };
};

async function simConn() {
  const transport = createSimulatedAdb();
  const conn = new AdbConnection(transport, { keyStore: keyStore() });
  await conn.connect();
  return { conn, state: transport.state };
}

describe('parsers', () => {
  it('reads getprop into a device summary', () => {
    const p = parseGetprop('[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]\n[ro.build.version.sdk]: [34]\n[ro.boot.flash.locked]: [0]\n[empty]: []\n');
    expect(p['ro.product.model']).toBe('Pixel 7');
    expect(p.empty).toBe('');
    const s = Object.fromEntries(deviceSummary(p));
    expect(s).toMatchObject({ Model: 'Pixel 7', Android: '14 (API 34)', 'Bootloader lock': 'unlocked' });
  });

  it('reads dumpsys battery', () => {
    expect(parseBattery('  AC powered: false\n  USB powered: true\n  status: 5\n  health: 2\n  level: 100\n  voltage: 4350\n  temperature: 305\n'))
      .toEqual({ level: 100, status: 'full', health: 'good', plugged: 'USB', temperature: 30.5, voltage: 4.35 });
  });

  it('parses logcat threadtime lines', () => {
    expect(parseLogcatLine('05-17 12:30:01.123  1234  1250 E AndroidRuntime: FATAL EXCEPTION: main')).toMatchObject({
      date: '05-17', time: '12:30:01.123', pid: 1234, tid: 1250, level: 'E', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION: main'
    });
    expect(parseLogcatLine('--------- beginning of main')).toBeNull();
  });

  it('dedupes logcat lines at the boundary timestamp', () => {
    const p = new LogcatPoller(null);
    const a = '05-17 12:00:00.000  1  1 I A: one\n05-17 12:00:01.000  1  1 I A: two\n05-17 12:00:01.000  1  1 I A: three\n';
    expect(p.ingest(a).map((e) => e.message)).toEqual(['one', 'two', 'three']);
    const b = '05-17 12:00:01.000  1  1 I A: two\n05-17 12:00:01.000  1  1 I A: three\n05-17 12:00:01.000  1  1 I A: four\n05-17 12:00:02.000  1  1 W A: five\n';
    expect(p.ingest(b).map((e) => e.message)).toEqual(['four', 'five']);
    expect(p.last).toBe('05-17 12:00:02.000');
  });

  it('parses package lists', () => {
    expect(parsePackages('package:/data/app/~~ab==/com.foo-1/base.apk=com.foo\npackage:com.bar\n')).toEqual([
      { name: 'com.bar', apk: null }, { name: 'com.foo', apk: '/data/app/~~ab==/com.foo-1/base.apk' }
    ]);
  });

  it('builds input commands safely', () => {
    expect(inputTextCommand('hi there $USER; rm')).toBe('input text "hi%sthere%s\\$USER\\;%srm"');
    expect(tapCommand(10.4, 20.6)).toBe('input tap 10 21');
    expect(parseWmSize('Physical size: 1080x2400\nOverride size: 720x1600')).toEqual({ width: 720, height: 1600 });
  });

  it('encodes a valid PNG', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const png = encodePng(2, 2, new Uint8Array(16).fill(255));
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(new TextDecoder().decode(png.subarray(12, 16))).toBe('IHDR');
    expect(new TextDecoder().decode(png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
  });
});

describe('against the simulated device', () => {
  it('screencaps over exec: as PNG bytes', async () => {
    const { conn } = await simConn();
    const png = await conn.execOut('screencap -p');
    expect(png[0]).toBe(0x89);
    expect(png.length).toBeGreaterThan(1000);
  });

  it('lists directories with the sync protocol', async () => {
    const { conn } = await simConn();
    await conn.push('/sdcard/Download/notes.txt', new TextEncoder().encode('hello'));
    const top = await conn.list('/sdcard/');
    expect(top.map((e) => [e.name, e.isDir])).toEqual([['DCIM', true], ['Download', true]]);
    const dl = await conn.list('/sdcard/Download');
    expect(dl).toEqual([expect.objectContaining({ name: 'notes.txt', size: 5, isDir: false })]);
  });

  it('installs, inspects and uninstalls packages', async () => {
    const { conn, state } = await simConn();
    const out = await installApk(conn, new Uint8Array([0x50, 0x4b, 3, 4]));
    expect(out).toContain('Success');
    expect(state.packages).toContain('com.example.installed');
    expect(Object.keys(state.files).some((f) => f.startsWith('/data/local/tmp/skons-'))).toBe(true);
    expect(await packagePaths(conn, 'com.example.demo')).toEqual(['/data/app/com.example.demo-1/base.apk']);
    expect((await packageVersion(conn, 'com.example.demo')).versionName).toBe('1.4.2');
    await uninstallPackage(conn, 'com.example.demo');
    expect(state.packages).not.toContain('com.example.demo');
    await expect(uninstallPackage(conn, 'not.there')).rejects.toThrow(/Failure/);
    await expect(uninstallPackage(conn, 'bad; rm -rf /')).rejects.toThrow(/Not a package/);
  });

  it('polls logcat', async () => {
    const { conn } = await simConn();
    const p = new LogcatPoller(conn);
    expect((await p.poll()).length).toBe(12);
    expect((await p.poll()).length).toBeGreaterThan(0);
  });
});
