import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryManager } from '../../src/utils/cyberchef/history.js';

describe('CyberChef Session History / Time Machine (history.js)', () => {
  let history;

  beforeEach(() => {
    history = new HistoryManager(20);
  });

  it('records bake snapshots in reverse chronological order', () => {
    history.addSnapshot({
      input: 'hello world',
      recipe: [{ op: 'To Base64', args: {} }],
      output: 'aGVsbG8gd29ybGQ=',
      outputHex: '61 47 56 73 62 47 38 67 64 32 39 79 62 47 51 3D',
      durationMs: 2.5
    });

    const snapshots = history.getSnapshots();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].input).toBe('hello world');
    expect(snapshots[0].output).toBe('aGVsbG8gd29ybGQ=');
    expect(snapshots[0].stepCount).toBe(1);
    expect(snapshots[0].recipeSummary).toBe('To Base64');
  });

  it('strictly caps the history list at 20 items to conserve memory', () => {
    for (let i = 1; i <= 25; i++) {
      history.addSnapshot({
        input: `Payload_${i}`,
        recipe: [{ op: 'To Hex', args: {} }],
        output: `HexOutput_${i}`,
        durationMs: 1.0
      });
    }

    const snapshots = history.getSnapshots();
    expect(snapshots.length).toBe(20);
    // Most recent is item 25
    expect(snapshots[0].input).toBe('Payload_25');
    // Oldest preserved is item 6 (1 to 5 evicted)
    expect(snapshots[19].input).toBe('Payload_6');
  });

  it('updates in place without duplicating when identical consecutive bakes occur', () => {
    history.addSnapshot({
      input: 'static-token',
      recipe: [{ op: 'MD5', args: {} }],
      output: 'd41d8cd98f00b204e9800998ecf8427e',
      durationMs: 1.2
    });

    // Re-bake with identical input & recipe (e.g. debounced auto-bake tick)
    history.addSnapshot({
      input: 'static-token',
      recipe: [{ op: 'MD5', args: {} }],
      output: 'd41d8cd98f00b204e9800998ecf8427e',
      durationMs: 0.8
    });

    const snapshots = history.getSnapshots();
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].durationMs).toBe(0.8);
  });

  it('notifies subscribers upon snapshot additions and purges', () => {
    let callCount = 0;
    let lastSnapshots = [];

    const unsubscribe = history.subscribe((items) => {
      callCount++;
      lastSnapshots = items;
    });

    history.addSnapshot({
      input: 'sample',
      recipe: [{ op: 'To Base64', args: {} }],
      output: 'c2FtcGxl'
    });

    expect(callCount).toBe(1);
    expect(lastSnapshots.length).toBe(1);

    history.clear();
    expect(callCount).toBe(2);
    expect(lastSnapshots.length).toBe(0);

    unsubscribe();
    history.addSnapshot({ input: 'after unsubscribe', recipe: [] });
    expect(callCount).toBe(2); // no further calls
  });

  it('retrieves specific snapshot by ID', () => {
    const snap = history.addSnapshot({
      input: 'find-me',
      recipe: [{ op: 'SHA-256', args: {} }],
      output: 'abc123hash'
    });

    const found = history.getSnapshot(snap.id);
    expect(found).not.toBeNull();
    expect(found.id).toBe(snap.id);
    expect(found.input).toBe('find-me');
  });
});
