import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import {
  createMonitor, resetMonitor, monitorFeed, NODE_TIMEOUT_MS,
  fmtKb, fmtMb, fmtGbMb, fmtUp, dwellText, helloField
} from '../../../utils/pigletMonitor';

// Live htop-style dashboard for a WarHog Core: parses the Core's periodic debug
// lines (the same ones the console shows) into gauges, counters, a node roster
// with per-node channels / dwell / cluster controls, and sparklines. Ported
// from the WarHog web flasher's toolkit.js "monitor" module. Read-only except
// the per-node identify (LED blink) and cluster buttons.

function Bar({ frac, tone }) {
  const f = Math.max(0, Math.min(1, frac || 0));
  const col = tone === 'bad' ? 'bg-rose-500' : tone === 'warn' ? 'bg-amber-500' : tone === 'ok' ? 'bg-emerald-500' : 'bg-cyan-500';
  return <span className="block h-1.5 bg-slate-800 rounded overflow-hidden"><span className={`block h-full ${col}`} style={{ width: (f * 100).toFixed(1) + '%' }} /></span>;
}

function Gauge({ label, value, frac, tone, sub }) {
  const col = tone === 'bad' ? 'text-rose-400' : tone === 'warn' ? 'text-amber-300' : tone === 'ok' ? 'text-emerald-400' : 'text-cyan-300';
  return (
    <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg space-y-1 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase font-bold text-slate-500">{label}</span>
        <b className={`text-[11px] ${col}`}>{value}</b>
      </div>
      <Bar frac={frac} tone={tone} />
      {sub && <div className="text-[10px] text-slate-500 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function Spark({ data, color, hi }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const n = data.length;
    if (n < 2) return;
    const max = hi || Math.max.apply(null, data) || 1;
    const min = Math.min.apply(null, [0].concat(data));
    const span = (max - min) || 1;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * (c.width - 2) + 1;
      const y = c.height - 2 - ((data[i] - min) / span) * (c.height - 4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }, [data, color, hi, data.length]);
  return <canvas ref={ref} width={200} height={32} className="w-full" style={{ height: 32 }} />;
}

export default function PigletMonitor({ client, connected, info }) {
  const monRef = useRef(null);
  if (!monRef.current) monRef.current = createMonitor();
  const mon = monRef.current;
  const [, setTick] = useState(0);
  const dirtyRef = useRef(false);

  // Feed every firmware line; re-render on a RAF so a chatty Core doesn't thrash.
  useEffect(() => {
    const off = client.onLine((line) => { if (monitorFeed(mon, line)) dirtyRef.current = true; });
    const iv = setInterval(() => { if (dirtyRef.current) { dirtyRef.current = false; setTick((t) => t + 1); } }, 500);
    return () => { off(); clearInterval(iv); };
  }, [client, mon]);

  // Fresh session clears the previous board's roster / counters.
  useEffect(() => { if (connected) { resetMonitor(mon); setTick((t) => t + 1); } }, [connected, mon]);

  const iso = mon.iso, sys = mon.sys;
  const hasTelemetry = iso || mon.nodes.length || connected;
  const up = mon.firstMs ? Math.floor((Date.now() - mon.firstMs) / 1000) : 0;
  const sdTot = (sys && sys.sdTot != null) ? sys.sdTot : (mon.sd && mon.sd.tot);
  const sdUsed = (sys && sys.sdUsed != null) ? sys.sdUsed : (mon.sd && mon.sd.used);

  if (!hasTelemetry) {
    return (
      <div className="bg-[#12151c] border border-slate-800 rounded-xl py-10 px-4 text-center text-xs text-slate-500 space-y-2">
        <Activity className="w-7 h-7 mx-auto text-slate-600" />
        <p>Connect a WarHog Core over USB and watch it boot.</p>
        <p className="text-[11px] text-slate-600">Parses [CORE-ISO] / [NODES] / [SYS] telemetry from the serial stream (Core mode only).</p>
      </div>
    );
  }

  const Chip = ({ label, value, tone }) => (
    <div className="px-2 py-1 bg-slate-950 border border-slate-800 rounded flex flex-col min-w-0">
      <span className="text-[9px] uppercase text-slate-500">{label}</span>
      <b className={`text-[11px] truncate ${tone === 'ok' ? 'text-emerald-400' : tone === 'accent' ? 'text-purple-300' : tone === 'dim' ? 'text-slate-500' : 'text-slate-200'}`}>{value}</b>
    </div>
  );
  const Stat = ({ label, value, bad }) => (
    <div className={`px-2 py-1 rounded border flex items-center justify-between gap-2 ${bad ? 'bg-rose-950/40 border-rose-500/40' : 'bg-slate-950 border-slate-800'}`}>
      <span className="text-[10px] text-slate-400">{label}</span>
      <b className={`text-[11px] ${bad ? 'text-rose-300' : 'text-slate-200'}`}>{value == null ? '--' : String(value)}</b>
    </div>
  );

  return (
    <div className="space-y-3 font-mono">
      {/* status strip */}
      <div className="grid grid-cols-2 @sm:grid-cols-4 @lg:grid-cols-8 gap-1.5">
        <Chip label="Board" value={info ? (helloField(info, 'model') || '?') : (connected ? '?' : 'offline')} tone={connected ? 'ok' : 'dim'} />
        <Chip label="Firmware" value={info ? (helloField(info, 'fw') || '?') : '--'} />
        <Chip label="GPS" value={mon.gps || '--'} tone={mon.gps === 'LOCKED' || mon.gps === 'FIX' ? 'ok' : 'dim'} />
        <Chip label="Nodes" value={iso && iso.nodes != null ? String(iso.nodes) : String(mon.nodes.length)} tone="accent" />
        <Chip label="CPU" value={sys && sys.cpu ? sys.cpu + ' MHz' : '--'} />
        <Chip label="Up" value={sys && sys.up != null ? fmtUp(sys.up) : '--'} />
        <Chip label="Lines/s" value={mon.rate ? mon.rate.toFixed(0) : '0'} />
        <Chip label="Watching" value={up ? Math.floor(up / 60) + ':' + String(up % 60).padStart(2, '0') : '0:00'} />
      </div>
      {mon.build && <div className="text-[10px] text-slate-500 truncate">Build: {mon.build}</div>}

      {/* gauges */}
      <div className="grid grid-cols-2 @md:grid-cols-3 gap-1.5">
        {sys && sys.heapTot ? (() => { const u = sys.heapTot - sys.heapFree; return (
          <Gauge label="mem" value={fmtKb(u) + ' / ' + fmtKb(sys.heapTot)} frac={u / sys.heapTot}
            tone={sys.heapFree < 30000 ? 'bad' : sys.heapFree < 60000 ? 'warn' : 'ok'} sub={'free ' + fmtKb(sys.heapFree) + ' · low ' + fmtKb(sys.heapMin)} />
        ); })() : null}
        {sys && sys.psTot ? (() => { const pu = sys.psTot - sys.psFree; return (
          <Gauge label="psram" value={fmtMb(pu) + ' / ' + fmtMb(sys.psTot)} frac={pu / sys.psTot} tone="ok" sub={'free ' + fmtMb(sys.psFree)} />
        ); })() : null}
        {sdTot ? <Gauge label="sd card" value={fmtGbMb(sdUsed) + ' / ' + fmtGbMb(sdTot)} frac={(sdUsed || 0) / sdTot} tone={sdUsed / sdTot > 0.9 ? 'warn' : 'ok'} sub="logs land here" /> : null}
        {iso ? <Gauge label="loop max" value={(iso.loopMax / 1000).toFixed(0) + ' ms'} frac={iso.loopMax / 1000 / 300} tone={iso.loopMax > 250000 ? 'bad' : iso.loopMax > 150000 ? 'warn' : 'ok'} sub={'>5ms: ' + (iso.loopGt5 ?? '?') + '/win'} /> : null}
        {iso ? <Gauge label="rx task max" value={(iso.rtMax / 1000).toFixed(1) + ' ms'} frac={iso.rtMax / 1000 / 10} tone={iso.rtMax > 8000 ? 'bad' : iso.rtMax > 5000 ? 'warn' : 'ok'} sub="core-0 SD store" /> : null}
        {iso ? <Gauge label="sd queue" value={String(iso.depth ?? 0)} frac={(iso.depth ?? 0) / 64} tone={(iso.depth ?? 0) > 32 ? 'warn' : 'ok'} sub={'drops ' + (iso.drops ?? 0)} /> : null}
      </div>

      {/* counters */}
      {(iso || mon.ios || mon.pair) && (
        <div className="grid grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-4 gap-1.5">
          {iso && <Stat label="SD drops" value={iso.drops} bad={iso.drops > 0} />}
          {iso && <Stat label="RX txt drop" value={iso.rxTxt} bad={iso.rxTxt > 0} />}
          {iso && <Stat label="RX req drop" value={iso.rxReq} bad={iso.rxReq > 0} />}
          {mon.ios && <Stat label="BLE enq" value={mon.ios.enq} />}
          {mon.ios && <Stat label="BLE sent" value={mon.ios.sent} />}
          {mon.ios && <Stat label="BLE dropFull" value={mon.ios.dropFull} bad={mon.ios.dropFull > 0} />}
          {mon.pair && <Stat label="Pair overlap" value={(mon.pair.pct ?? 0) + '%'} bad={(mon.pair.pct ?? 0) > 40} />}
        </div>
      )}

      {/* node roster */}
      <div className="space-y-1.5">
        <div className="text-[10px] uppercase font-bold text-slate-500">Node roster</div>
        {!mon.nodes.length ? (
          <p className="text-[11px] text-slate-500">No [NODES] lines yet.</p>
        ) : (
          mon.nodes.slice().sort((a, b) => a.idx - b.idx).map((nd) => (
            <div key={nd.mac} className={`p-2 rounded-lg border ${nd.warn ? 'bg-rose-950/30 border-rose-500/30' : 'bg-slate-950 border-slate-800'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] text-slate-500">#{nd.idx}</span>
                <span className="text-[11px] font-bold text-slate-200">{nd.mac}</span>
                <div className="flex items-center gap-1.5 flex-1 min-w-[120px]">
                  <div className="flex-1"><Bar frac={nd.hb / NODE_TIMEOUT_MS} tone={nd.hb > 60000 ? 'bad' : nd.hb > 30000 ? 'warn' : 'ok'} /></div>
                  <span className="text-[10px] text-slate-400 w-12 text-right">{(nd.hb / 1000).toFixed(1)}s</span>
                </div>
                <span className="text-[10px] text-slate-400">rx {nd.rx}{nd.drx ? ' +' + nd.drx : ''}</span>
                {nd.chans ? <span className="text-[10px] text-slate-400">{nd.chans}ch/{dwellText(nd)}</span> : null}
                <button type="button" onClick={() => connected && client.meshIdent(nd.mac)} disabled={!connected}
                  title="Blink this node's LED" className="px-1.5 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-amber-300 hover:text-amber-200 disabled:opacity-40">◎</button>
                {nd.group ? (
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-slate-500">clu</span>
                    <button type="button" disabled={!connected || nd.group <= 1} onClick={() => client.meshGroup(nd.mac, nd.group - 1)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-30">−</button>
                    <b className="text-[11px] text-purple-300 w-3 text-center">{nd.group}</b>
                    <button type="button" disabled={!connected || nd.group >= 9} onClick={() => client.meshGroup(nd.mac, nd.group + 1)}
                      className="px-1.5 py-0.5 rounded text-[11px] bg-slate-900 border border-slate-700 text-slate-300 hover:text-white disabled:opacity-30">+</button>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {nd.bands === '2.4' && <span className="px-1 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300">2.4</span>}
                {nd.bands === '5' && <span className="px-1 rounded text-[9px] font-bold bg-pink-500/20 text-pink-300">5 GHz</span>}
                {nd.bands === '2.4+5' && <>
                  <span className="px-1 rounded text-[9px] font-bold bg-cyan-500/20 text-cyan-300">2.4</span>
                  <span className="px-1 rounded text-[9px] font-bold bg-pink-500/20 text-pink-300">5 GHz</span>
                </>}
                {nd.chlist && nd.chlist.length
                  ? nd.chlist.map((c) => { const d = nd.plan && nd.plan[c]; return <span key={c} className="px-1 rounded text-[9px] bg-slate-800 text-slate-400">{d ? c + ':' + d : c}</span>; })
                  : <span className="text-[9px] text-slate-600">(waiting for channel assignment)</span>}
              </div>
            </div>
          ))
        )}
      </div>

      {/* sparklines */}
      <div className="grid grid-cols-1 @sm:grid-cols-3 gap-2">
        <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Free heap</span><b className="text-[10px] text-emerald-400">{mon.hist.heap.length ? fmtKb(mon.hist.heap[mon.hist.heap.length - 1]) : '--'}</b></div>
          <Spark data={mon.hist.heap} color="#50fa7b" />
        </div>
        <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Loop max (ms)</span><b className="text-[10px] text-pink-400">{mon.hist.loop.length ? mon.hist.loop[mon.hist.loop.length - 1].toFixed(0) + ' ms' : '--'}</b></div>
          <Spark data={mon.hist.loop} color="#ff79c6" hi={300} />
        </div>
        <div className="p-2 bg-slate-950 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">Nodes</span><b className="text-[10px] text-cyan-400">{mon.hist.nodes.length ? mon.hist.nodes[mon.hist.nodes.length - 1] : '--'}</b></div>
          <Spark data={mon.hist.nodes} color="#8be9fd" hi={12} />
        </div>
      </div>
    </div>
  );
}
