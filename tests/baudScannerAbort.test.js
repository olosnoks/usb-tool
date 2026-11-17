import { describe, it, expect, vi } from 'vitest';
import { runBaudHunt, CANDIDATE_BAUD_RATES } from '../src/utils/baudScanner';

// A fake port: tracks the current baud and whether a read loop is running.
function fakePort(originalBaud = 115200) {
  const state = { baud: originalBaud, reading: true, opened: [] };
  return {
    state,
    scan: async (baud) => { state.reading = false; state.baud = baud; state.opened.push(baud); return new TextEncoder().encode('hello world\r\n'); },
    restore: async () => { state.baud = originalBaud; state.reading = true; },
  };
}

describe('runBaudHunt abort', () => {
  it('scans every candidate and restores the original baud and read loop', async () => {
    const p = fakePort();
    const { results, aborted } = await runBaudHunt({ scan: p.scan, restore: p.restore });
    expect(aborted).toBe(false);
    expect(results).toHaveLength(CANDIDATE_BAUD_RATES.length);
    expect(p.state.baud).toBe(115200);
    expect(p.state.reading).toBe(true);
  });

  it('aborting mid-scan stops early, restores baud and the console receives again', async () => {
    const p = fakePort();
    const signal = { aborted: false };
    const scan = async (baud) => { const r = await p.scan(baud); if (baud === 38400) signal.aborted = true; return r; };
    const { results, aborted } = await runBaudHunt({ scan, restore: p.restore, signal });
    expect(aborted).toBe(true);
    expect(p.state.opened).toEqual([9600, 19200, 38400]);
    expect(results.length).toBeLessThan(CANDIDATE_BAUD_RATES.length);
    expect(p.state.baud).toBe(115200);
    expect(p.state.reading).toBe(true);
  });

  it('abort before start scans nothing but still restores', async () => {
    const p = fakePort();
    const restore = vi.fn(p.restore);
    const { aborted } = await runBaudHunt({ scan: p.scan, restore, signal: { aborted: true } });
    expect(aborted).toBe(true);
    expect(p.state.opened).toEqual([]);
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('a scan error is reported and the hunt continues; restore failure is surfaced', async () => {
    const errors = [];
    const scan = async (baud) => { if (baud === 19200) throw new Error('boom'); return new Uint8Array(0); };
    const { results, restoreError } = await runBaudHunt({
      candidates: [9600, 19200, 38400], scan, restore: async () => { throw new Error('nope'); }, onError: (b, e) => errors.push([b, e.message]),
    });
    expect(errors).toEqual([[19200, 'boom']]);
    expect(results.map((r) => r.baud)).toEqual([9600, 38400]);
    expect(restoreError.message).toBe('nope');
  });
});
