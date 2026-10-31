import { describe, it, expect } from 'vitest';
import {
  FastbootDevice, FastbootError, parseResponse, findFastbootInterface, summarizeVars
} from '../src/utils/fastbootDriver';

const te = new TextEncoder();
const td = new TextDecoder();

/**
 * A fake fastboot bootloader. Speaks the real protocol over an injected
 * transport: getvar, download (DATA handshake + raw bytes), flash, erase,
 * reboot, and the unlock confirmation flow.
 */
function fakeBootloader(opts = {}) {
  const state = {
    unlocked: opts.unlocked ?? 'no',
    partitions: {},
    erased: [],
    rebooted: null,
    booted: null,
    activeSlot: 'a',
    maxDownload: opts.maxDownload ?? 0x8000000, // 128 MiB
    vars: {
      product: opts.product ?? 'starqltechn',
      'version-bootloader': 'G973FXXU1',
      serialno: opts.serialno ?? 'CAFEBABE1234',
      secure: 'yes',
      'current-slot': 'a',
      'partition-type:boot': 'raw',
      'partition-type:system': 'ext4',
      ...opts.vars
    }
  };
  let downloadBuf = null; // Uint8Array being filled
  let downloadGot = 0;
  const queue = []; // pending response packets (strings)
  const push = (s) => queue.push(s);

  const onCommand = (cmd) => {
    if (cmd.startsWith('getvar:')) {
      const name = cmd.slice(7);
      if (name === 'all') {
        state.vars.unlocked = state.unlocked;
        state.vars['max-download-size'] = '0x' + state.maxDownload.toString(16);
        for (const [k, v] of Object.entries(state.vars)) push(`INFO${k}:${v}`);
        push('OKAY');
      } else if (name === 'max-download-size') {
        push('OKAY0x' + state.maxDownload.toString(16));
      } else if (name === 'unlocked') {
        push(`OKAY${state.unlocked}`);
      } else if (name in state.vars) {
        push(`OKAY${state.vars[name]}`);
      } else {
        push('FAILunknown variable');
      }
    } else if (cmd.startsWith('download:')) {
      const size = parseInt(cmd.slice(9), 16);
      if (size > state.maxDownload) { push('FAILdata too large'); return; }
      downloadBuf = new Uint8Array(size);
      downloadGot = 0;
      push(`DATA${size.toString(16).padStart(8, '0')}`);
      if (size === 0) push('OKAY');
    } else if (cmd.startsWith('flash:')) {
      if (state.unlocked !== 'yes') { push('FAILdevice is locked. Cannot flash this partition.'); return; }
      const part = cmd.slice(6);
      state.partitions[part] = downloadBuf ? downloadBuf.slice() : new Uint8Array();
      push('INFOWriting flash...');
      push('OKAY');
    } else if (cmd.startsWith('erase:')) {
      if (state.unlocked !== 'yes') { push('FAILdevice is locked.'); return; }
      state.erased.push(cmd.slice(6));
      push('OKAY');
    } else if (cmd === 'boot') {
      state.booted = downloadBuf ? downloadBuf.slice() : new Uint8Array();
      push('OKAY');
    } else if (cmd.startsWith('set_active:')) {
      state.activeSlot = cmd.slice(11);
      push('OKAY');
    } else if (cmd === 'flashing unlock' || cmd === 'oem unlock') {
      // The real device waits for an on-screen key press; model instant approval.
      state.unlocked = 'yes';
      push('INFOUnlocking bootloader erases all user data. Confirm on device.');
      push('OKAY');
    } else if (cmd === 'flashing lock' || cmd === 'oem lock') {
      state.unlocked = 'no';
      push('OKAY');
    } else if (cmd === 'reboot' || cmd.startsWith('reboot-')) {
      state.rebooted = cmd === 'reboot' ? 'system' : cmd.slice(7);
      push('OKAY');
    } else {
      push('FAILunknown command');
    }
  };

  const transport = {
    state,
    async open() {},
    async close() { state.closed = true; },
    async write(bytes) {
      if (downloadBuf && downloadGot < downloadBuf.length) {
        downloadBuf.set(bytes, downloadGot);
        downloadGot += bytes.length;
        if (downloadGot >= downloadBuf.length) push('OKAY');
        return;
      }
      onCommand(td.decode(bytes));
    },
    async read() {
      if (!queue.length) return new Uint8Array(); // nothing pending yet
      return te.encode(queue.shift());
    }
  };
  return { transport, state };
}

async function connected(opts) {
  const fake = fakeBootloader(opts);
  const dev = new FastbootDevice(fake.transport);
  await dev.open();
  return { dev, ...fake };
}

describe('fastboot response parsing', () => {
  it('splits the 4-char tag from the payload', () => {
    expect(parseResponse(te.encode('OKAY0x8000000'))).toEqual({ tag: 'OKAY', payload: '0x8000000' });
    expect(parseResponse(te.encode('FAILlocked'))).toEqual({ tag: 'FAIL', payload: 'locked' });
    expect(parseResponse(te.encode('DATA00001000')).tag).toBe('DATA');
    expect(parseResponse(te.encode('WATx')).tag).toBe('FAIL'); // garbage -> treated as failure
  });
});

describe('findFastbootInterface', () => {
  it('matches the class ff / 42 / 03 interface and its bulk endpoints', () => {
    const cfg = { interfaces: [
      { interfaceNumber: 0, alternates: [{ interfaceClass: 0x08, interfaceSubclass: 0, interfaceProtocol: 0, endpoints: [] }] },
      { interfaceNumber: 1, alternates: [{ interfaceClass: 0xff, interfaceSubclass: 0x42, interfaceProtocol: 0x03, alternateSetting: 0, endpoints: [
        { type: 'bulk', direction: 'out', endpointNumber: 1, packetSize: 512 },
        { type: 'bulk', direction: 'in', endpointNumber: 1, packetSize: 512 }
      ] }] }
    ] };
    expect(findFastbootInterface(cfg)).toMatchObject({ interfaceNumber: 1, epOut: 1, epIn: 1, inPacketSize: 512 });
    expect(findFastbootInterface({ interfaces: [] })).toBe(null);
  });
});

describe('fastboot device', () => {
  it('reads max-download-size on open', async () => {
    const { dev } = await connected({ maxDownload: 0x4000000 });
    expect(dev.maxDownloadSize).toBe(0x4000000);
  });

  it('reads variables and getvar:all', async () => {
    const { dev } = await connected();
    expect(await dev.getVar('product')).toBe('starqltechn');
    const { vars } = await dev.getAllVars();
    expect(vars.serialno).toBe('CAFEBABE1234');
    expect(summarizeVars(vars).partitionTypes).toContain('boot');
  });

  it('throws a FastbootError with the reason on FAIL', async () => {
    const { dev } = await connected();
    await expect(dev.getVar('nonsense')).rejects.toThrow(/unknown variable/);
  });

  it('refuses to flash while locked, then flashes after unlock', async () => {
    const { dev, state } = await connected();
    const img = new Uint8Array(4096).fill(0xab);
    await expect(dev.flash('boot', img)).rejects.toThrow(/locked/);
    const msg = await dev.unlock();
    expect(msg).toMatch(/confirm on device|erases/i);
    expect(state.unlocked).toBe('yes');
    await dev.flash('boot', img);
    expect(state.partitions.boot).toEqual(img);
  });

  it('does the DATA handshake and reports progress during download', async () => {
    const { dev, state } = await connected();
    await dev.unlock();
    const img = new Uint8Array(3 * 1024 * 1024).map((_, i) => i & 0xff);
    const seen = [];
    await dev.flash('system', img, { onProgress: (p) => p.phase === 'download' && seen.push(p.percent) });
    expect(state.partitions.system).toEqual(img);
    expect(seen[seen.length - 1]).toBe(100);
    expect(seen.length).toBeGreaterThan(1); // chunked
  });

  it('rejects an image larger than max-download-size before sending bytes', async () => {
    const { dev } = await connected({ maxDownload: 1024 });
    await dev.unlock();
    await expect(dev.flash('boot', new Uint8Array(4096))).rejects.toThrow(/max-download-size/);
  });

  it('erases, sets the active slot and boots a transient image', async () => {
    const { dev, state } = await connected();
    await dev.unlock();
    await dev.erase('userdata');
    expect(state.erased).toContain('userdata');
    await dev.setActiveSlot('b');
    expect(state.activeSlot).toBe('b');
    const boot = new Uint8Array(2048).fill(7);
    await dev.bootImage(boot);
    expect(state.booted).toEqual(boot);
  });

  it('reboots to the requested target', async () => {
    const { dev, state } = await connected();
    await dev.reboot('bootloader');
    expect(state.rebooted).toBe('bootloader');
  });

  it('treats a dropped link during reboot as success', async () => {
    const fake = fakeBootloader();
    fake.transport.write = async () => { throw new FastbootError('USB OUT disconnect'); };
    const dev = new FastbootDevice(fake.transport);
    expect(await dev.reboot()).toBe('rebooting');
  });
});
