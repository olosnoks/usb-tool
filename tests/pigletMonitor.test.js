import { describe, it, expect } from 'vitest';
import { createMonitor, resetMonitor, monitorFeed, dwellText, helloField, fmtUp, fmtGbMb } from '../src/utils/pigletMonitor';

describe('pigletMonitor', () => {
  it('parses CORE-ISO telemetry into gauges and history', () => {
    const m = createMonitor();
    const changed = monitorFeed(m, '[CORE-ISO] SD store q: depth=2 drops=1 | rx_drop txt=3 req=4 txtq_max=1 | rt_us max=2124 gt5ms=0 | loop_us max=178099 gt5ms=336 | nodes=5 | heap=94740 heap_min=90740');
    expect(changed).toBe(true);
    expect(m.iso.depth).toBe(2);
    expect(m.iso.drops).toBe(1);
    expect(m.iso.rxTxt).toBe(3);
    expect(m.iso.rxReq).toBe(4);
    expect(m.iso.rtMax).toBe(2124);
    expect(m.iso.loopMax).toBe(178099);
    expect(m.iso.loopGt5).toBe(336);
    expect(m.iso.nodes).toBe(5);
    expect(m.iso.heap).toBe(94740);
    expect(m.iso.heapMin).toBe(90740);
    expect(m.hist.heap).toEqual([94740]);
    expect(m.hist.loop[0]).toBeCloseTo(178.099, 2);
    expect(m.hist.nodes).toEqual([5]);
  });

  it('parses the node roster with warn flag, cluster group and rx delta', () => {
    const m = createMonitor();
    // firmware roster: " %u:%02X%02X hb=%lums rx=%lu g%u%s |" — warn '!' attaches to the group
    monitorFeed(m, '[NODES] n=2 | 0:06FC hb=888ms rx=2 g1 | 1:57C4 hb=65000ms rx=0 g2! |');
    expect(m.nodes).toHaveLength(2);
    const [a, b] = m.nodes;
    expect(a.mac).toBe('06FC'); expect(a.hb).toBe(888); expect(a.rx).toBe(2); expect(a.group).toBe(1); expect(a.warn).toBe(false);
    expect(b.mac).toBe('57C4'); expect(b.group).toBe(2); expect(b.warn).toBe(true);
    // a second roster line computes the rx delta
    monitorFeed(m, '[NODES] n=2 | 0:06FC hb=100ms rx=7 g1 | 1:57C4 hb=50ms rx=3 g2 |');
    expect(m.nodes[0].drx).toBe(5);
    expect(m.nodes[1].drx).toBe(3);
  });

  it('merges cfg channel/dwell/band info into the roster', () => {
    const m = createMonitor();
    monitorFeed(m, '[NODES] n=1 | 0:06FC hb=100ms rx=1 |');
    monitorFeed(m, '[CORE] cfg -> 06FC: channels=6,157,44,36;dwell=70;plan=6:70,157:60,44:60,36:120');
    const nd = m.nodes[0];
    expect(nd.chans).toBe(4);
    expect(nd.bands).toBe('2.4+5');     // ch 6 (2.4) + ch 157/44/36 (5)
    expect(nd.chlist).toEqual([6, 157, 44, 36]);
    expect(nd.plan['36']).toBe(120);
    expect(nd.dwellLo).toBe(60);
    expect(nd.dwellHi).toBe(120);
    expect(dwellText(nd)).toBe('60-120ms');
    // a 2.4-only plan
    monitorFeed(m, '[CORE] cfg -> 06FC: channels=1,6,11;dwell=70;plan=1:70,6:70,11:70');
    expect(m.nodes[0].bands).toBe('2.4');
    expect(dwellText(m.nodes[0])).toBe('70ms');
  });

  it('parses SYS, SD, GPS, PAIR, IOSESP and BUILD lines', () => {
    const m = createMonitor();
    monitorFeed(m, '[SYS] cpu=240 heap=120000/320000 min=90000 psram=100/8192 sd=27/30408MB up=3725');
    expect(m.sys.cpu).toBe(240);
    expect(m.sys.heapFree).toBe(120000); expect(m.sys.heapTot).toBe(320000); expect(m.sys.heapMin).toBe(90000);
    expect(m.sys.psFree).toBe(100); expect(m.sys.psTot).toBe(8192);
    expect(m.sys.sdUsed).toBe(27); expect(m.sys.sdTot).toBe(30408);
    expect(m.sys.up).toBe(3725);
    monitorFeed(m, '[SD] 30408 MB total, 27 MB used');
    expect(m.sd).toEqual({ tot: 30408, used: 27 });
    monitorFeed(m, '[GPS] LOCKED');
    expect(m.gps).toBe('LOCKED');
    monitorFeed(m, '[PAIR] grp=1 overlap both=0 either=5 pct=0%');
    expect(m.pair).toMatchObject({ grp: 1, both: 0, either: 5, pct: 0 });
    monitorFeed(m, '[IOSESP] up as "WarHog" enq=12 sent=11 dropFull=0 depth=1');
    expect(m.ios).toMatchObject({ enq: 12, sent: 11, dropFull: 0, depth: 1 });
    monitorFeed(m, '[BUILD] v2.84-fnk0104b built Nov 1 2026');
    expect(m.build).toContain('v2.84');
  });

  it('ignores unrelated lines and resets cleanly', () => {
    const m = createMonitor();
    expect(monitorFeed(m, 'some random debug noise')).toBe(false);
    monitorFeed(m, '[CORE-ISO] SD store q: depth=0 drops=0 | rx_drop txt=0 req=0 txtq_max=0 | rt_us max=0 gt5ms=0 | loop_us max=0 gt5ms=0 | nodes=1 | heap=95000 heap_min=90000');
    expect(m.iso).not.toBeNull();
    const v = m.version;
    resetMonitor(m);
    expect(m.iso).toBeNull();
    expect(m.nodes).toEqual([]);
    expect(m.version).toBe(v + 1);
  });

  it('formatting helpers', () => {
    expect(helloField('fw=1.2.3 model=c5 proto=1', 'model')).toBe('c5');
    expect(helloField('fw=1.2.3 model=c5', 'fw')).toBe('1.2.3');
    expect(helloField('', 'model')).toBeNull();
    expect(fmtUp(65)).toBe('1:05');
    expect(fmtUp(3725)).toBe('1h02');
    expect(fmtGbMb(512)).toBe('512 MB');
    expect(fmtGbMb(30408)).toBe('29.7 GB');
  });
});
