import { describe, it, expect } from 'vitest';
import {
  PigletToolkitClient,
  crc32,
  hex8,
  b64encode,
  b64decode,
  looksLikeConfig,
  cfgReadKey,
  cfgSetKey,
  parseWigle,
  parentOf,
  joinPath,
  baseName
} from '../src/utils/pigletToolkit';

const enc = new TextEncoder();
const dec = new TextDecoder();

// A fake SerialPort backed by a tiny model of SerialTool.cpp.
function makeFakePiglet({ files = {}, bootDelayHellos = 0, garbleFirstGet = false, busyPath = null, legacy = false, homeSsid = 'Home', wifiOk = true } = {}) {
  const dev = { session: false, scanning: true, uploads: [], rebooted: false };
  const fs = new Map(Object.entries(files).map(([p, v]) => [p, typeof v === 'string' ? enc.encode(v) : v]));
  let controller;
  let hellosIgnored = 0;
  let garbled = !garbleFirstGet;
  let put = null;
  const sent = [];
  const signals = [];
  let closed = false;

  const emit = (line) => controller.enqueue(enc.encode(line + '\r\n'));
  const handle = (line) => {
    sent.push(line);
    if (put) {
      const m = line.match(/^WT DATA ?(.*)$/);
      if (!m) { put = null; return; }
      const chunk = m[1] ? b64decode(m[1]) : new Uint8Array(0);
      put.parts.push(chunk); put.got += chunk.length;
      if (put.got >= put.size) {
        const out = new Uint8Array(put.got); let o = 0;
        for (const c of put.parts) { out.set(c, o); o += c.length; }
        if (hex8(crc32(out)) !== put.crc) emit('WT ERR crc');
        else { fs.set(put.path, out); emit(put.cfg ? 'WT OK cfg' : 'WT OK'); }
        put = null;
      }
      return;
    }
    if (line === 'WT HELLO') {
      if (hellosIgnored < bootDelayHellos) { hellosIgnored++; emit('ESP-ROM:esp32c5 boot noise'); return; }
      dev.session = true;
      emit('WT HELLO fw=1.2.3 model=c5 proto=1');
    } else if (line.startsWith('WT LS ')) {
      const dir = line.slice(6);
      const prefix = dir === '/' ? '/' : dir + '/';
      const seen = new Set();
      for (const [p, b] of fs) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf('/');
        if (slash >= 0) {
          const d = prefix + rest.slice(0, slash);
          if (!seen.has(d)) { seen.add(d); emit('WT DIR ' + d); }
        } else if (rest !== '.keep') emit('WT F ' + b.length + ' ' + p);
      }
      emit('WT END');
    } else if (line.startsWith('WT GET ')) {
      const p = line.slice(7);
      const b = fs.get(p);
      if (!b) { emit('WT ERR open'); return; }
      emit('WT BEGIN ' + b.length);
      if (!garbled) { garbled = true; emit('WT DATA ###not-base64###'); emit('WT END 00000000'); return; }
      for (let i = 0; i < b.length; i += 300) emit('WT DATA ' + b64encode(b.subarray(i, i + 300)));
      emit('WT END ' + hex8(crc32(b)));
    } else if (line.startsWith('WT PUT ') || line.startsWith('WT CFG PUT ')) {
      const cfg = line.startsWith('WT CFG PUT ');
      const parts = line.split(' ');
      const crc = parts.pop(); const size = +parts.pop();
      const path = cfg ? '/wardriver.cfg' : parts.slice(2).join(' ');
      put = { path, size, crc, cfg, parts: [], got: 0 };
      emit('WT READY');
    } else if (line.startsWith('WT RM ')) {
      const p = line.slice(6);
      if (p === busyPath) { emit('WT ERR busy'); return; }
      if (fs.delete(p)) { emit('WT OK'); return; }
      const keep = p + '/.keep';
      if (fs.delete(keep) || ![...fs.keys()].some((k) => k.startsWith(p + '/'))) emit('WT OK');
      else emit('WT ERR rm');
    } else if (line === 'WT BYE') { dev.session = false; emit('WT BYE'); }
    else if (legacy && /^WT (STAT|SCAN|UPLOAD|REBOOT)/.test(line)) emit('WT ERR unknown ' + line.split(' ')[1]);
    else if (line === 'WT STAT') {
      emit('[gps] noise');
      emit('WT STAT ' + JSON.stringify({ scanningEnabled: dev.scanning, toolSession: dev.session, found2g: 12, found5g: 3, sdOk: true }));
    } else if (line === 'WT SCAN START') { dev.scanning = true; dev.session = false; emit('WT OK scan on'); }
    else if (line === 'WT SCAN STOP') { dev.scanning = false; emit('WT OK scan off'); }
    else if (line.startsWith('WT UPLOAD')) {
      if (!homeSsid) emit('WT ERR nohome');
      else if (!wifiOk) emit('WT ERR nowifi');
      else { dev.uploads.push(line.slice(10) || 'all'); emit('[UPLOAD] working'); emit('WT OK 2 3 WiGLE: 2 uploaded, 1 failed'); }
    } else if (line === 'WT REBOOT') { dev.rebooted = true; emit('WT OK reboot'); }
    else if (line === 'TIMEOUT!') { dev.session = false; emit('WT TIMEOUT'); }
  };

  let pending = '';
  const port = {
    readable: null,
    writable: null,
    async open() {
      port.readable = new ReadableStream({ start(c) { controller = c; } });
      port.writable = new WritableStream({
        write(chunk) {
          pending += dec.decode(chunk);
          let nl;
          while ((nl = pending.indexOf('\n')) >= 0) { const l = pending.slice(0, nl); pending = pending.slice(nl + 1); handle(l); }
        }
      });
    },
    async setSignals(s) { signals.push(s); },
    async close() { closed = true; }
  };
  return { port, fs, sent, signals, dev, isClosed: () => closed, timeout: () => handle('TIMEOUT!') };
}

describe('pigletToolkit helpers', () => {
  it('crc32 matches the standard check value', () => {
    expect(hex8(crc32(enc.encode('123456789')))).toBe('CBF43926');
  });

  it('base64 round-trips bytes', () => {
    const b = new Uint8Array([0, 1, 2, 250, 255, 10, 13]);
    expect(Array.from(b64decode(b64encode(b)))).toEqual(Array.from(b));
  });

  it('path helpers', () => {
    expect(parentOf('/logs/a.csv')).toBe('/logs');
    expect(parentOf('/logs')).toBe('/');
    expect(joinPath('/', 'x.cfg')).toBe('/x.cfg');
    expect(joinPath('/logs', 'x.csv')).toBe('/logs/x.csv');
    expect(baseName('/logs/sub/')).toBe('sub');
  });

  it('looksLikeConfig accepts key=value text and refuses binary', () => {
    expect(looksLikeConfig(enc.encode('# c\nhomeSsid=Net\n'))).toBe(true);
    expect(looksLikeConfig(new Uint8Array(0))).toBe(true);
    expect(looksLikeConfig(new Uint8Array([0x41, 0x3d, 0x00, 0x42]))).toBe(false);
    expect(looksLikeConfig(enc.encode('just some prose'))).toBe(false);
  });

  it('cfgSetKey patches in place and keeps comments and unknown keys', () => {
    const src = '# header\nhomeSsid=Old\ncustomKey=keep\n';
    let out = cfgSetKey(src, 'homeSsid', 'New$1Net');
    expect(out).toBe('# header\nhomeSsid=New$1Net\ncustomKey=keep\n');
    out = cfgSetKey(out, 'scan5', 'true');
    expect(out).toContain('customKey=keep\nscan5=true\n');
    expect(cfgReadKey(out, 'scan5')).toBe('true');
    expect(cfgReadKey(out, 'missing')).toBe(null);
  });

  it('parseWigle reads rows, counts bad lines and returns null for non-WiGLE text', () => {
    const csv = [
      'WigleWifi-1.6,appRelease=1,model=x,release=1,device=Piglet-C5,display=,board=c5,brand=WarHog',
      'MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type',
      'AA:BB:CC:DD:EE:FF,"Cafe, Wifi",[WPA2-PSK-CCMP][ESS],2026-10-30 12:00:00,6,2437,-50,40.1,-74.2,10,5,,,WIFI',
      'garbage line',
      '11:22:33:44:55:66,,[ESS],2026-10-30 12:01:00,36,5180,-80,0,0,10,5,,,WIFI'
    ].join('\n');
    const r = parseWigle(csv);
    expect(r.dev).toBe('Piglet-C5');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].ssid).toBe('Cafe, Wifi');
    expect(r.rows[0].rssi).toBe(-50);
    expect(r.bad).toBe(1);
    expect(parseWigle('hello')).toBe(null);
  });
});

describe('PigletToolkitClient over a simulated Piglet', () => {
  it('drops RTS before DTR and keeps sending HELLO until the board answers', async () => {
    const dev = makeFakePiglet({ bootDelayHellos: 1 });
    const debug = [];
    const c = new PigletToolkitClient({ serial: {}, onDebugLine: (l) => debug.push(l) });
    const info = await c.connect(dev.port);
    expect(info).toBe('HELLO fw=1.2.3 model=c5 proto=1');
    expect(dev.signals).toEqual([{ requestToSend: false }, { dataTerminalReady: false }]);
    expect(dev.sent.filter((l) => l === 'WT HELLO').length).toBe(2);
    expect(debug).toContain('ESP-ROM:esp32c5 boot noise');
    await c.disconnect();
  });

  it('lists folders and files, downloads with CRC check, and retries a garbled GET', async () => {
    const big = new Uint8Array(5000).map((_, i) => i & 0xff);
    const dev = makeFakePiglet({
      files: { '/wardriver.cfg': 'homeSsid=Net\n', '/logs/a.csv': big },
      garbleFirstGet: true
    });
    const logs = [];
    const c = new PigletToolkitClient({ serial: {}, onLog: (m) => logs.push(m) });
    await c.connect(dev.port);

    const root = await c.ls('/');
    expect(root.dirs).toEqual(['/logs']);
    expect(root.files).toEqual([{ size: 13, path: '/wardriver.cfg' }]);

    const progress = [];
    const bytes = await c.getRetry('/logs/a.csv', (r, t) => progress.push([r, t]));
    expect(bytes.length).toBe(5000);
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0, 1, 2, 3]);
    expect(progress[progress.length - 1]).toEqual([5000, 5000]);
    expect(logs.some((m) => /garbled data line.*retrying/.test(m))).toBe(true);

    await expect(c.getRetry('/nope.txt')).rejects.toThrow(/open/);
    await c.disconnect();
  });

  it('uploads files and the config, and reports a busy delete', async () => {
    const dev = makeFakePiglet({ files: { '/logs/live.csv': 'x' }, busyPath: '/logs/live.csv' });
    const c = new PigletToolkitClient({ serial: {} });
    await c.connect(dev.port);

    const payload = new Uint8Array(1000).map((_, i) => (i * 7) & 0xff);
    await c.put('/notes/x.bin', payload);
    expect(Array.from(dev.fs.get('/notes/x.bin'))).toEqual(Array.from(payload));

    const r = await c.cfgPut(enc.encode('scan5=true\n'));
    expect(r).toBe('OK cfg');
    expect(dec.decode(dev.fs.get('/wardriver.cfg'))).toBe('scan5=true\n');

    await c.put('/empty.txt', new Uint8Array(0));
    expect(dev.fs.get('/empty.txt').length).toBe(0);

    await expect(c.rm('/logs/live.csv')).rejects.toThrow(/busy/);
    await c.rm('/notes/x.bin');
    expect(dev.fs.has('/notes/x.bin')).toBe(false);
    await c.disconnect();
  });

  it('sends BYE and closes the port on disconnect, and reports it', async () => {
    const dev = makeFakePiglet();
    let disconnected = null;
    const c = new PigletToolkitClient({ serial: {}, onDisconnect: (was) => { disconnected = was; } });
    await c.connect(dev.port);
    await c.disconnect();
    expect(dev.sent).toContain('WT BYE');
    expect(dev.isClosed()).toBe(true);
    expect(disconnected).toBe(true);
    expect(c.connected).toBe(false);
    await expect(c.ls('/')).rejects.toThrow(/not connected/);
  });

  it('reads device status and controls scanning without needing a session', async () => {
    const d = makeFakePiglet({ files: { '/a.txt': 'x' } });
    const c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    expect(c.sessionActive).toBe(true);

    const st = await c.stat();
    expect(st).toMatchObject({ found2g: 12, found5g: 3, toolSession: true });

    expect(await c.scan(false)).toBe('OK scan off');
    expect(d.dev.scanning).toBe(false);
    expect(await c.scan(true)).toBe('OK scan on');
    expect(c.sessionActive).toBe(false);
    expect(d.dev.session).toBe(false);

    // A file command after Start Scan re-opens the session (pausing scans) first.
    const hellosBefore = d.sent.filter((l) => l === 'WT HELLO').length;
    await c.ls('/');
    expect(d.sent.filter((l) => l === 'WT HELLO').length).toBe(hellosBefore + 1);
    expect(d.dev.session).toBe(true);

    // ...and a status poll does not.
    await c.scan(true);
    await c.stat();
    expect(d.dev.session).toBe(false);
    await c.disconnect();
  });

  it('re-opens the session after the firmware times it out', async () => {
    const d = makeFakePiglet({ files: { '/a.txt': 'x' } });
    const c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    d.timeout();
    await new Promise((r) => setTimeout(r, 10));
    expect(c.sessionActive).toBe(false);
    await c.get('/a.txt');
    expect(d.sent.slice(-2)).toEqual(['WT HELLO', 'WT GET /a.txt']);
    await c.disconnect();
  });

  it('serializes a status poll behind a running file transfer', async () => {
    const big = new Uint8Array(20000).map((_, i) => i & 0xff);
    const d = makeFakePiglet({ files: { '/big.bin': big } });
    const c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    const getP = c.get('/big.bin');
    expect(c.isIdle()).toBe(false);
    const statP = c.stat();
    const [bytes, st] = await Promise.all([getP, statP]);
    expect(bytes.length).toBe(20000);
    expect(st.found2g).toBe(12);
    const iGet = d.sent.indexOf('WT GET /big.bin'), iStat = d.sent.indexOf('WT STAT');
    expect(iGet).toBeLessThan(iStat);
    expect(c.isIdle()).toBe(true);
    await c.disconnect();
  });

  it('uploads, reports upload errors, and reboots', async () => {
    let d = makeFakePiglet();
    let c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    expect(await c.upload('wdgwars')).toEqual({ uploaded: 2, total: 3, message: 'WiGLE: 2 uploaded, 1 failed' });
    expect(d.dev.uploads).toEqual(['wdgwars']);
    await c.reboot();
    expect(d.dev.rebooted).toBe(true);
    await c.disconnect();

    d = makeFakePiglet({ homeSsid: '' });
    c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    await expect(c.upload()).rejects.toThrow('ERR nohome');
    await c.disconnect();

    d = makeFakePiglet({ wifiOk: false });
    c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    await expect(c.upload()).rejects.toThrow('ERR nowifi');
    await c.disconnect();
  });

  it('reports older firmware without device control as unknown', async () => {
    const d = makeFakePiglet({ legacy: true });
    const c = new PigletToolkitClient({ serial: {} });
    await c.connect(d.port);
    await expect(c.stat()).rejects.toThrow(/unknown STAT/);
    await c.disconnect();
  });
});
