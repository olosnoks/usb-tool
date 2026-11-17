import CryptoJS from 'crypto-js';
import { describe, it, expect } from 'vitest';
import { EspBootloaderClient, FlashAbortedError } from '../src/utils/espLoader';
import { isClearShortcut, matchPrompt } from '../src/utils/consoleShortcuts';
import { CANDIDATE_BAUD_RATES } from '../src/utils/baudScanner';

describe('ESP ROM flash abort', () => {
  function fakeClient() {
    const c = Object.create(EspBootloaderClient.prototype);
    c.isEsp8266 = false; c.chip = 'ESP32'; c.log = () => {};
    c._ensurePrepared = async () => {};
    c.cmds = [];
    c.command = async (op) => { c.cmds.push(op); return { data: new Uint8Array(0), value: 0 }; };
    c.hardwareResetToApp = async () => { c.cmds.push('reset'); };
    return c;
  }

  it('stops between blocks, skips verify and reset', async () => {
    const c = fakeClient();
    const ac = new AbortController();
    const data = new Uint8Array(1024 * 5);
    await expect(c.flashPartition(data, 0, 1024, (p, w, t, blk) => { if (blk === 2) ac.abort(); }, true, ac.signal))
      .rejects.toBeInstanceOf(FlashAbortedError);
    // BEGIN + 2 data blocks only; no MD5, no reset
    expect(c.cmds.length).toBe(3);
    expect(c.cmds).not.toContain('reset');
  });

  it('does nothing when already aborted, and aborts multi-partition runs', async () => {
    const c = fakeClient();
    const ac = new AbortController(); ac.abort();
    await expect(c.flashMultiplePartitions([{ data: new Uint8Array(8), offset: 0, label: 'a' }], 1024, null, ac.signal))
      .rejects.toMatchObject({ aborted: true });
    expect(c.cmds.length).toBe(0);
  });

  it('flashes normally without a signal', async () => {
    const c = fakeClient();
    const img = new Uint8Array(8);
    const md5 = CryptoJS.MD5(CryptoJS.lib.WordArray.create(img)).toString();
    c.command = async (op) => { c.cmds.push(op); return { data: new TextEncoder().encode(md5), value: 0 }; };
    await c.flashMultiplePartitions([{ data: img, offset: 0, label: 'a' }], 1024);
    expect(c.cmds).toContain('reset');
  });
});

describe('prompt matching', () => {
  const P = ['=>', 'u-boot>', 'cfe>', 'redboot>', '# ', '$ '];
  it('matches prompts with trailing spaces regardless of trimming', () => {
    expect(matchPrompt('root@box:~# ', P)).toBe('# ');
    expect(matchPrompt('root@box:~#', P)).toBe('# ');
    expect(matchPrompt('user@h:~$ ', P)).toBe('$ ');
    expect(matchPrompt('U-Boot> \n', P)).toBe('u-boot>');
    expect(matchPrompt('Hit any key to stop autoboot: 3', P)).toBeNull();
    expect(matchPrompt('', P)).toBeNull();
  });
});

describe('console shortcuts', () => {
  it('detects plain Ctrl+L only', () => {
    expect(isClearShortcut({ ctrlKey: true, key: 'l' })).toBe(true);
    expect(isClearShortcut({ ctrlKey: true, key: 'L' })).toBe(true);
    expect(isClearShortcut({ ctrlKey: true, shiftKey: true, key: 'l' })).toBe(false);
    expect(isClearShortcut({ key: 'l' })).toBe(false);
  });
  it('baud candidate list is non-empty (UI derives its count from it)', () => {
    expect(CANDIDATE_BAUD_RATES.length).toBeGreaterThan(0);
  });
});
