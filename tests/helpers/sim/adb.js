// Test-only simulated adbd transport. Recovered from adbDriver.js (commit
// 1ec15c4^); speaks the same ADB wire protocol the real path uses, with canned
// shell replies and an in-memory filesystem, so adb framing/sync can be tested
// without a device. Not imported by app code.
import { packMessage, parseHeader, syncPacket, packShellPacket, ShellPacketDecoder, SHELL, ADB_COMMANDS } from '../../../src/utils/adbDriver.js';
import { encodePng } from '../../../src/utils/adbTools.js';

const { A_CNXN, A_OPEN, A_OKAY, A_CLSE, A_WRTE } = ADB_COMMANDS;
const A_VERSION = 0x01000001;
const MAX_PAYLOAD = 256 * 1024;
const td = new TextDecoder();
const te = new TextEncoder();

function demoPhoneScreen(width = 216, height = 432) {
  const px = new Uint8Array(width * height * 4);
  const fill = (x0, y0, w, h, [r, g, b]) => {
    for (let y = y0; y < Math.min(height, y0 + h); y++) for (let x = x0; x < Math.min(width, x0 + w); x++) {
      const o = (y * width + x) * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  };
  fill(0, 0, width, height, [16, 24, 40]);
  fill(0, 0, width, 16, [0, 0, 0]);
  const colors = [[52, 211, 153], [34, 211, 238], [251, 191, 36], [244, 114, 182], [129, 140, 248], [248, 113, 113]];
  colors.forEach((c, i) => fill(24 + (i % 3) * 64, 60 + Math.floor(i / 3) * 72, 40, 40, c));
  fill(width / 2 - 30, height - 24, 60, 6, [148, 163, 184]);
  return encodePng(width, height, px);
}

/**
 * `features` is the device's advertised list (default includes shell_v2 and
 * stat_v2; pass 'cmd' alone to simulate an old device). `state.fakeSizes` maps a
 * path to a size to report (lets tests show a >4 GiB file without the bytes).
 */
export function createSimulatedAdb({ features = 'shell_v2,cmd,stat_v2' } = {}) {
  let inBuf = new Uint8Array(0);
  const out = [];
  const state = { files: {}, streams: {}, remote: 100, rebooted: null, tcpipPort: null, simulated: true, fakeSizes: {}, sessions: {}, nextSession: 1000, committed: [], abandoned: [], shellStdin: [], winsize: null, hostBanner: null };
  const send = (c, a0, a1, p) => out.push(packMessage(c, a0, a1, p));
  const PROPS = {
    'ro.product.manufacturer': 'Google', 'ro.product.model': 'Pixel 3 (simulated)', 'ro.product.device': 'blueline',
    'ro.build.version.release': '12', 'ro.build.version.sdk': '31', 'ro.build.version.security_patch': '2022-10-05',
    'ro.build.display.id': 'SP1A.210812.016.C2', 'ro.product.cpu.abi': 'arm64-v8a', 'ro.product.cpu.abilist': 'arm64-v8a,armeabi-v7a,armeabi', 'ro.hardware': 'blueline',
    'ro.serialno': 'SIM0000001', 'ro.boot.flash.locked': '1', 'ro.boot.verifiedbootstate': 'green', 'ro.debuggable': '0'
  };
  state.packages = ['com.android.chrome', 'com.example.demo', 'org.fdroid.fdroid'];
  state.logSeq = 0;
  const two = (n) => String(n).padStart(2, '0');
  const logLines = (n) => {
    const tags = [['I', 'ActivityManager', 'Start proc 4242:com.example.demo/u0a123 for activity'], ['D', 'WifiService', 'RSSI changed: -61'], ['W', 'BatteryStats', 'Battery temperature high: 41.2C'], ['E', 'AndroidRuntime', 'FATAL EXCEPTION: main (simulated)'], ['I', 'chatty', 'uid=1000 system_server expire 3 lines']];
    const out = [];
    for (let i = 0; i < n; i++) {
      const d = new Date(Date.now() - (n - i) * 7);
      const [lvl, tag, msg] = tags[(state.logSeq++) % tags.length];
      out.push(`${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}  1234  1250 ${lvl} ${tag}: ${msg}`);
    }
    return out.join('\n') + '\n';
  };
  const shellReply = (cmd) => {
    if (cmd === 'echo hi') return 'hi\n';
    if (cmd === 'getprop') return Object.entries(PROPS).map(([k, v]) => `[${k}]: [${v}]`).join('\n') + '\n';
    if (cmd.startsWith('getprop ')) return `${PROPS[cmd.slice(8).trim()] ?? ''}\n`;
    if (cmd.startsWith('logcat')) return logLines(cmd.includes('-T') ? 2 : 12);
    if (cmd.startsWith('pm list packages')) return state.packages.map((p) => (cmd.includes('-f') ? `package:/data/app/${p}-1/base.apk=${p}` : `package:${p}`)).join('\n') + '\n';
    if (cmd.startsWith('pm path ')) return `package:/data/app/${cmd.slice(8).trim()}-1/base.apk\n`;
    if (cmd.startsWith('pm uninstall')) { const p = cmd.split(/\s+/).pop(); const had = state.packages.includes(p); state.packages = state.packages.filter((x) => x !== p); return had ? 'Success\n' : 'Failure [DELETE_FAILED_INTERNAL_ERROR]\n'; }
    if (cmd.startsWith('pm install-create')) { const id = state.nextSession++; state.sessions[id] = { writes: [], args: cmd }; return `Success: created install session [${id}]\n`; }
    if (cmd.startsWith('pm install-commit ')) { const id = Number(cmd.split(/\s+/)[2]); const ss = state.sessions[id]; if (!ss) return 'Failure [INSTALL_FAILED_INTERNAL_ERROR: session not found]\n'; state.committed.push(ss); state.packages.push('com.example.split'); delete state.sessions[id]; return 'Success\n'; }
    if (cmd.startsWith('pm install-abandon ')) { const id = Number(cmd.split(/\s+/)[2]); state.abandoned.push(id); delete state.sessions[id]; return ''; }
    if (cmd.startsWith('pm install')) { state.packages.push('com.example.installed'); return 'Performing Streamed Install\nSuccess\n'; }
    if (cmd.startsWith('dumpsys package ')) return 'versionCode=42 minSdk=24 targetSdk=33\n    versionName=1.4.2\n    firstInstallTime=2024-05-17 12:30:00\n    lastUpdateTime=2024-06-01 09:00:00\n';
    if (cmd === 'dumpsys battery') return 'Current Battery Service state:\n  AC powered: false\n  USB powered: true\n  status: 2\n  health: 2\n  level: 76\n  voltage: 4012\n  temperature: 291\n';
    if (cmd === 'bugreportz -p') return 'PROGRESS:1/2\nPROGRESS:2/2\nOK:/bugreports/bugreport-sim.zip\n';
    if (cmd === 'wm size') return 'Physical size: 216x432\n';
    if (cmd === 'wm density') return 'Physical density: 420\n';
    if (cmd.startsWith('input ') || cmd.startsWith('rm ') || cmd.startsWith('am ') || cmd.startsWith('monkey')) { state.lastInput = cmd; return ''; }
    return `/system/bin/sh: ${cmd}: simulated — only a few commands are canned\n`;
  };
  const handleSync = (st, data) => {
    const m = new Uint8Array(st.buf.length + data.length); m.set(st.buf); m.set(data, st.buf.length); st.buf = m;
    for (;;) {
      if (st.buf.length < 8) break;
      const dv = new DataView(st.buf.buffer, st.buf.byteOffset, 8);
      const id = String.fromCharCode(st.buf[0], st.buf[1], st.buf[2], st.buf[3]);
      if (id === 'DONE') {
        st.buf = st.buf.slice(8);
        let t = 0; st.fileBuf.forEach((c) => (t += c.length));
        const all = new Uint8Array(t); let o = 0; st.fileBuf.forEach((c) => { all.set(c, o); o += c.length; });
        state.files[st.sendPath] = all; send(A_WRTE, st.remoteId, st.localId, syncPacket('OKAY')); continue;
      }
      const len = dv.getUint32(4, true);
      if (st.buf.length < 8 + len) break;
      const body = st.buf.slice(8, 8 + len); st.buf = st.buf.slice(8 + len);
      if (id === 'SEND') { st.sendPath = td.decode(body).split(',')[0]; st.fileBuf = []; }
      else if (id === 'DATA') st.fileBuf.push(body);
      else if (id === 'RECV') {
        const f = state.files[td.decode(body)];
        if (!f) send(A_WRTE, st.remoteId, st.localId, syncPacket('FAIL', te.encode('No such file')));
        else { for (let o = 0; o < f.length; o += 65536) send(A_WRTE, st.remoteId, st.localId, syncPacket('DATA', f.subarray(o, o + 65536))); send(A_WRTE, st.remoteId, st.localId, syncPacket('DONE')); }
      } else if (id === 'STAT' || id === 'STA2') {
        const path = td.decode(body);
        const isDir = path === '/sdcard' || ['/sdcard/DCIM', '/sdcard/Download'].includes(path) || Object.keys(state.files).some((f) => f.startsWith(`${path}/`));
        const f = state.files[path];
        const exists = isDir || f !== undefined || state.fakeSizes[path] !== undefined;
        const size = state.fakeSizes[path] ?? (f ? f.length : 0);
        const mode = !exists ? 0 : isDir ? 0o40755 : 0o100644;
        if (id === 'STAT') {
          const pkt = new Uint8Array(16); const pv = new DataView(pkt.buffer);
          pkt.set(te.encode('STAT')); pv.setUint32(4, mode, true); pv.setUint32(8, size >>> 0, true); pv.setUint32(12, exists ? 1700000000 : 0, true);
          send(A_WRTE, st.remoteId, st.localId, pkt);
        } else {
          const pkt = new Uint8Array(72); const pv = new DataView(pkt.buffer);
          pkt.set(te.encode('STA2')); pv.setUint32(4, exists ? 0 : 2, true); pv.setUint32(24, mode, true);
          pv.setBigUint64(40, BigInt(size), true); pv.setBigInt64(56, BigInt(exists ? 1700000000 : 0), true);
          send(A_WRTE, st.remoteId, st.localId, pkt);
        }
      } else if (id === 'LIST' || id === 'LIS2') {
        const v2 = id === 'LIS2';
        const dir = td.decode(body).replace(/\/?$/, '/');
        const dent = (name, mode, size) => {
          const n = te.encode(name);
          if (v2) {
            const pkt = new Uint8Array(76 + n.length); const pv = new DataView(pkt.buffer);
            pkt.set(te.encode('DNT2')); pv.setUint32(24, mode, true); pv.setBigUint64(40, BigInt(size), true);
            pv.setBigInt64(56, 1700000000n, true); pv.setUint32(72, n.length, true); pkt.set(n, 76);
            return pkt;
          }
          const pkt = new Uint8Array(20 + n.length);
          const pv = new DataView(pkt.buffer);
          pkt.set(te.encode('DENT'));
          pv.setUint32(4, mode, true); pv.setUint32(8, size >>> 0, true); pv.setUint32(12, 1700000000, true); pv.setUint32(16, n.length, true);
          pkt.set(n, 20);
          return pkt;
        };
        const names = new Map();
        for (const [path, data] of Object.entries(state.files)) {
          if (!path.startsWith(dir)) continue;
          const rest = path.slice(dir.length).split('/');
          names.set(rest[0], rest.length > 1 ? null : (state.fakeSizes[path] ?? data.length));
        }
        for (const [path, size] of Object.entries(state.fakeSizes)) { if (path.startsWith(dir) && !state.files[path] && !path.slice(dir.length).includes('/')) names.set(path.slice(dir.length), size); }
        if (dir === '/sdcard/') { names.set('DCIM', null); names.set('Download', null); }
        const parts = [dent('.', 0o40755, 0), ...[...names].map(([n, size]) => dent(n, size === null ? 0o40755 : 0o100644, size || 0)), new Uint8Array([68, 79, 78, 69, ...new Array(v2 ? 72 : 16).fill(0)])];
        const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
        let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
        send(A_WRTE, st.remoteId, st.localId, all);
      } else if (id === 'QUIT') send(A_CLSE, st.remoteId, st.localId);
    }
  };
  // shell,v2: framed stdin/stdout/stderr/exit. With ",pty" it is an interactive
  // shell that echoes input and prints a prompt; otherwise it runs one command.
  const PROMPT = 'sim:/ $ ';
  const shellPkt = (st, id, data) => send(A_WRTE, st.remoteId, st.localId, packShellPacket(id, data));
  const runLine = (st, line) => {
    const cmd = line.trim();
    if (cmd === 'exit') { shellPkt(st, SHELL.EXIT, new Uint8Array([0])); send(A_CLSE, st.remoteId, st.localId); return false; }
    if (cmd === 'echo err >&2') shellPkt(st, SHELL.STDERR, 'err\n');
    else if (cmd) shellPkt(st, SHELL.STDOUT, shellReply(cmd).replace(/\n/g, '\r\n'));
    return true;
  };
  const startShellV2 = (st) => {
    st.dec = new ShellPacketDecoder(); st.line = '';
    const head = st.service.slice(0, st.service.indexOf(':'));
    const rest = st.service.slice(st.service.indexOf(':') + 1);
    st.pty = /,pty/.test(head);
    if (st.pty) { shellPkt(st, SHELL.STDOUT, PROMPT); return; }
    if (rest === 'echo err >&2') shellPkt(st, SHELL.STDERR, 'err\n');
    else shellPkt(st, SHELL.STDOUT, shellReply(rest));
    shellPkt(st, SHELL.EXIT, new Uint8Array([rest.startsWith('false') ? 1 : 0]));
    send(A_CLSE, st.remoteId, st.localId);
  };
  const handleShellV2 = (st, data) => {
    for (const pkt of st.dec.push(data)) {
      if (pkt.id === SHELL.WINDOW_SIZE) { state.winsize = td.decode(pkt.data); continue; }
      if (pkt.id !== SHELL.STDIN || !st.pty) continue;
      state.shellStdin.push(pkt.data);
      for (const b of pkt.data) {
        if (b === 0x03) { shellPkt(st, SHELL.STDOUT, `^C\r\n${PROMPT}`); st.line = ''; state.interrupts = (state.interrupts || 0) + 1; }
        else if (b === 0x04) { if (!st.line) { shellPkt(st, SHELL.EXIT, new Uint8Array([0])); send(A_CLSE, st.remoteId, st.localId); return; } }
        else if (b === 0x0d || b === 0x0a) {
          shellPkt(st, SHELL.STDOUT, '\r\n');
          const alive = runLine(st, st.line); st.line = '';
          if (!alive) return;
          shellPkt(st, SHELL.STDOUT, PROMPT);
        } else { st.line += String.fromCharCode(b); shellPkt(st, SHELL.STDOUT, String.fromCharCode(b)); }
      }
    }
  };
  // exec:pm install-write -S <size> <session> <name> - : reads stdin until <size> bytes arrive.
  const handleInstallWrite = (st, data) => {
    st.install.got.push(data); st.install.have += data.length;
    if (st.install.have < st.install.size) return;
    const all = new Uint8Array(st.install.have); let o = 0; st.install.got.forEach((c) => { all.set(c, o); o += c.length; });
    const ss = state.sessions[st.install.session];
    if (!ss) { send(A_WRTE, st.remoteId, st.localId, te.encode('Failure [INSTALL_FAILED_INTERNAL_ERROR: no session]\n')); send(A_CLSE, st.remoteId, st.localId); return; }
    ss.writes.push({ name: st.install.name, bytes: all });
    send(A_WRTE, st.remoteId, st.localId, te.encode(`Success: streamed ${all.length} bytes\n`));
    send(A_CLSE, st.remoteId, st.localId);
  };
  const onMsg = (m) => {
    if (m.command === A_CNXN) { state.hostBanner = td.decode(m.data).replace(/\u0000+$/, ''); send(A_CNXN, A_VERSION, MAX_PAYLOAD, te.encode(`device::ro.product.name=sim_device;features=${features}\u0000`)); }
    else if (m.command === A_OPEN) {
      const service = td.decode(m.data).replace(/\u0000+$/, ''); const localId = m.arg0; const remoteId = state.remote++;
      send(A_OKAY, remoteId, localId);
      const st = { service, localId, remoteId, buf: new Uint8Array(0) }; state.streams[remoteId] = st;
      if (service.startsWith('shell,v2')) startShellV2(st);
      else if (service.startsWith('shell:')) { const reply = shellReply(service.slice(6)); if (reply) send(A_WRTE, remoteId, localId, te.encode(reply)); send(A_CLSE, remoteId, localId); }
      else if (service.startsWith('exec:pm install-write')) { const m2 = service.match(/-S (\d+) (\d+) (\S+) -$/); st.install = { size: Number(m2[1]), session: Number(m2[2]), name: m2[3], got: [], have: 0 }; if (st.install.size === 0) handleInstallWrite(st, new Uint8Array()); }
      else if (service.startsWith('exec:')) { const c = service.slice(5); const out2 = c.startsWith('screencap') ? demoPhoneScreen() : te.encode(shellReply(c)); for (let o = 0; o < out2.length; o += MAX_PAYLOAD) send(A_WRTE, remoteId, localId, out2.subarray(o, o + MAX_PAYLOAD)); send(A_CLSE, remoteId, localId); }
      else if (service.startsWith('tcpip:')) { state.tcpipPort = Number(service.slice(6)); send(A_WRTE, remoteId, localId, te.encode(`restarting in TCP mode port: ${state.tcpipPort}\n`)); send(A_CLSE, remoteId, localId); }
      else if (service.startsWith('reboot:')) { state.rebooted = service.slice(7); send(A_CLSE, remoteId, localId); }
    } else if (m.command === A_WRTE) { const st = state.streams[m.arg1]; if (st) { send(A_OKAY, st.remoteId, st.localId); if (st.service === 'sync:') handleSync(st, m.data); else if (st.service.startsWith('shell,v2')) handleShellV2(st, m.data); else if (st.install) handleInstallWrite(st, m.data); } }
  };
  return {
    state,
    async open() {}, async close() {},
    async write(bytes) {
      const m = new Uint8Array(inBuf.length + bytes.length); m.set(inBuf); m.set(bytes, inBuf.length); inBuf = m;
      for (;;) { if (inBuf.length < 24) break; const h = parseHeader(inBuf.slice(0, 24)); if (inBuf.length < 24 + h.length) break; const data = inBuf.slice(24, 24 + h.length); inBuf = inBuf.slice(24 + h.length); onMsg({ ...h, data }); }
    },
    async read() { return out.length ? out.shift() : new Uint8Array(); }
  };
}
