import React, { useState, useRef, useEffect, useReducer, useCallback } from 'react';
import { Keyboard, Usb, Power, ShieldAlert, RotateCcw, Upload, Grid3x3, Activity, Play, Square, Copy } from 'lucide-react';
import StatusBadge from '../common/StatusBadge';
import { useSessionError } from '../../utils/sessionLog';
import {
  VIA_USAGE_PAGE, VIA_USAGE, ViaClient, decodeKeycode, parseKeycodeText, parseViaDefinition
} from '../../utils/keyboardVia';
import {
  buildKeyboardLayout, layoutKeyCodes, applyKeyEvent, createTesterState, rolloverVerdict, DEFAULT_CHATTER_MS,
  dwellSummary, untestedKeys, testCoverage, COMBO_PRESETS, comboStatus, buildReport, modifierLabel
} from '../../utils/keyboardVia/keyTester';

const LOCATION = ['standard', 'left', 'right', 'numpad'];
const hex4 = (n) => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

function testerReducer(state, action) {
  switch (action.type) {
    case 'event': return applyKeyEvent(state, action.evt);
    case 'reset': return createTesterState(state.chatterMs);
    case 'chatterMs': return { ...state, chatterMs: action.value };
    default: return state;
  }
}

function KeyCap({ item, st }) {
  const isDown = st.down[item.c] !== undefined;
  const everSeen = !!st.ever[item.c];
  const count = st.counts[item.c] || 0;
  const chatter = st.chatter[item.c] || 0;
  let cls = 'border-slate-700 bg-slate-900 text-slate-400';
  if (everSeen) cls = 'border-emerald-700/70 bg-emerald-950/40 text-emerald-300';
  if (chatter) cls = 'border-rose-500/70 bg-rose-950/50 text-rose-300';
  if (isDown) cls = 'border-cyan-300 bg-cyan-500/40 text-white shadow-[0_0_10px_rgba(34,211,238,0.5)]';
  return (
    <div
      title={`${item.c}${count ? ` - ${count} press(es)` : ''}${chatter ? ` - ${chatter} chatter` : ''}`}
      style={{ width: `${item.w * 2.4}rem` }}
      className={`relative h-9 rounded border flex items-center justify-center text-[10px] font-bold select-none ${cls}`}
    >
      {item.l}
      {count > 0 && <span className="absolute bottom-0 right-0.5 text-[8px] text-slate-400">{count}</span>}
    </div>
  );
}

function KeyBlock({ rows, st }) {
  return (
    <div className="flex flex-col gap-[3px]">
      {rows.map((row, ri) => (
        <div key={ri} className="flex gap-[3px] h-9 items-stretch">
          {row.map((it, i) => (it.c
            ? <KeyCap key={`${ri}-${i}`} item={it} st={st} />
            : <div key={`${ri}-${i}`} style={{ width: `${it.w * 2.4}rem` }} />))}
        </div>
      ))}
    </div>
  );
}

function KeyTesterPanel() {
  const [st, dispatch] = useReducer(testerReducer, undefined, () => createTesterState(DEFAULT_CHATTER_MS));
  const [tkl, setTkl] = useState(false);
  const [iso, setIso] = useState(false);
  const [focused, setFocused] = useState(false);
  const [last, setLast] = useState(null);
  const [comboId, setComboId] = useState('wasd');
  const [copied, setCopied] = useState(false);
  const layout = buildKeyboardLayout({ tkl, iso });
  const pressedNow = Object.keys(st.down);
  const verdict = rolloverVerdict(st.maxSimultaneous);
  const chatterTotal = Object.values(st.chatter).reduce((a, b) => a + b, 0);
  const keyNames = (codes) => codes.map((c) => layoutKeyCodes(layout).find((k) => k.c === c)?.l || c.replace(/^Key/, ''));

  const toEvt = (type, e) => ({
    type, code: e.code, key: e.key, location: e.location, repeat: e.repeat, timeStamp: e.timeStamp
  });
  const remember = (e) => setLast({ code: e.code, key: e.key, keyCode: e.keyCode, location: e.location, mods: modifierLabel(e) });
  const onDown = (e) => { e.preventDefault(); remember(e); dispatch({ type: 'event', evt: toEvt('down', e) }); };
  const onUp = (e) => { e.preventDefault(); dispatch({ type: 'event', evt: toEvt('up', e) }); };

  const cov = testCoverage(st, layout);
  const missingKeys = untestedKeys(st, layout);
  const combo = COMBO_PRESETS.find((c) => c.id === comboId) || COMBO_PRESETS[0];
  const comboRes = comboStatus(pressedNow, combo.codes);
  const lastDwell = last ? dwellSummary(st, last.code || `Key:${last.key}`) : null;
  const copyReport = async () => {
    try { await navigator.clipboard.writeText(buildReport(st, layout)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) { /* clipboard blocked */ }
  };

  const verdictCls = { none: 'text-slate-500', short: 'text-amber-300', '6kro': 'text-cyan-300', nkro: 'text-emerald-300' }[verdict.level];

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-200 flex items-center gap-2"><Keyboard className="w-4 h-4 text-cyan-400" /> KEY TESTER</span>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={tkl} onChange={(e) => setTkl(e.target.checked)} /> TKL (no numpad)</label>
          <label className="flex items-center gap-1 text-slate-400"><input type="checkbox" checked={iso} onChange={(e) => setIso(e.target.checked)} /> ISO layout</label>
          <label className="flex items-center gap-1 text-slate-400">
            Chatter window
            <input
              type="number" min={1} max={200} value={st.chatterMs}
              onChange={(e) => dispatch({ type: 'chatterMs', value: Math.min(200, Math.max(1, Number(e.target.value) || 1)) })}
              className="w-16 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-slate-200"
            />
            ms
          </label>
          <button onClick={() => dispatch({ type: 'reset' })} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
            <RotateCcw className="w-3 h-3" /> RESET
          </button>
          <button onClick={copyReport} title="Copy a plain-text summary (counts and problems only, no key sequence)" className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800">
            <Copy className="w-3 h-3" /> {copied ? 'COPIED' : 'COPY SUMMARY'}
          </button>
        </div>
      </div>

      <div
        tabIndex={0}
        role="application"
        aria-label="Key test area"
        onKeyDown={onDown}
        onKeyUp={onUp}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`rounded-lg border p-2 outline-none overflow-x-auto ${focused ? 'border-cyan-500/70 bg-slate-950' : 'border-dashed border-slate-700 bg-slate-950/60'}`}
      >
        {!focused && (
          <p className="text-center text-slate-500 text-[11px] mb-2">Click here to focus, then press keys. Keys are captured (Tab too); click outside to stop.</p>
        )}
        <div className="flex flex-wrap gap-4 items-start">
          <KeyBlock rows={layout.main} st={st} />
          <KeyBlock rows={layout.nav} st={st} />
          {layout.numpad && <KeyBlock rows={layout.numpad} st={st} />}
        </div>
        <p className="mt-2 text-[10px] text-slate-600">Cyan = held now. Green = pressed at least once. Rose = chatter flagged. Number = press count.</p>
      </div>

      <div className="grid grid-cols-1 @md:grid-cols-3 gap-2">
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
          <div className="text-slate-400">Held now ({pressedNow.length})</div>
          <div className="text-cyan-300 break-words min-h-[1rem]">{keyNames(pressedNow).join(' + ') || '-'}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
          <div className="text-slate-400">Rollover</div>
          <div className="text-slate-200">Most keys at once: <span className="font-bold">{st.maxSimultaneous}</span></div>
          <div className={verdictCls}>{verdict.text}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
          <div className="text-slate-400">Chatter</div>
          <div className={chatterTotal ? 'text-rose-300 font-bold' : 'text-slate-200'}>{chatterTotal} flagged</div>
          <div className="text-[10px] text-slate-500">A key pressed again within {st.chatterMs} ms of its own release. Browser timing, not electrical bounce.</div>
        </div>
      </div>

      <div className="grid grid-cols-1 @md:grid-cols-3 gap-2">
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
          <div className="text-slate-400">Last key</div>
          {last ? (
            <div className="text-[11px] text-slate-200 break-words">
              <div><span className="text-slate-500">code</span> {last.code || '-'} <span className="text-slate-500">key</span> {JSON.stringify(last.key)}</div>
              <div><span className="text-slate-500">keyCode (legacy)</span> {last.keyCode} <span className="text-slate-500">location</span> {LOCATION[last.location] || last.location}</div>
              <div><span className="text-slate-500">modifiers</span> {last.mods}{lastDwell ? <> <span className="text-slate-500">hold</span> {lastDwell.avg.toFixed(0)} ms avg ({lastDwell.min.toFixed(0)}-{lastDwell.max.toFixed(0)}, {lastDwell.n}x)</> : null}</div>
            </div>
          ) : <div className="text-slate-600">-</div>}
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
          <div className="text-slate-400">Coverage: {cov.tested}/{cov.total} keys ({cov.percent}%)</div>
          <div className="h-1.5 rounded bg-slate-800 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${cov.percent}%` }} /></div>
          <details className="text-[10px] text-slate-500">
            <summary className="cursor-pointer">Not pressed yet ({missingKeys.length})</summary>
            <div className="mt-1 text-slate-300 break-words">{missingKeys.map((k2) => k2.l).join(' ') || 'all keys seen'}</div>
          </details>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded p-2 space-y-1">
          <div className="flex items-center justify-between gap-2 text-slate-400">
            <span>Ghosting combo</span>
            <select aria-label="Combo preset" value={comboId} onChange={(e) => setComboId(e.target.value)} className="bg-slate-900 border border-slate-700 rounded px-1 text-[10px] text-slate-200 max-w-[10rem]">
              {COMBO_PRESETS.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className={comboRes.ok ? 'text-emerald-300' : 'text-slate-300'}>{comboRes.held}/{comboRes.total} held{comboRes.ok ? ': all registered' : comboRes.held ? `: missing ${comboRes.missing.map((c) => c.replace(/^Key/, '')).join(' ')}` : ''}</div>
          <div className="text-[10px] text-slate-500">Hold the whole combo. A missing key means the browser never got it (ghosting or keyboard blocking).</div>
        </div>
      </div>

      <div className="text-[10px] text-slate-500">
        Rollover can only count keys the browser receives. A 6KRO board that ghosts shows fewer keys, which this test cannot tell apart from a dropped key. Use the VIA matrix test for the electrical view.
        Browser or OS shortcuts (for example Ctrl+W, Alt+F4) may never reach the page.
      </div>

      <div>
        <div className="flex items-center justify-between text-slate-400 mb-1">
          <span>Event log ({st.events} events, newest first)</span>
        </div>
        <div className="max-h-40 overflow-auto border border-slate-800 rounded">
          <table className="w-full text-[10px]">
            <thead className="sticky top-0 bg-slate-900 text-slate-500">
              <tr>
                <th className="text-left px-1">#</th><th className="text-left px-1">type</th><th className="text-left px-1">code</th>
                <th className="text-left px-1">key</th><th className="text-left px-1">location</th><th className="text-left px-1">repeat</th>
                <th className="text-left px-1">time (ms)</th><th className="text-left px-1">flag</th>
              </tr>
            </thead>
            <tbody>
              {st.log.slice().reverse().slice(0, 150).map((e) => (
                <tr key={e.seq} className="border-t border-slate-900 text-slate-300">
                  <td className="px-1">{e.seq}</td>
                  <td className={`px-1 ${e.type === 'down' ? 'text-cyan-300' : 'text-slate-400'}`}>{e.type}</td>
                  <td className="px-1">{e.code}</td>
                  <td className="px-1">{JSON.stringify(e.key)}</td>
                  <td className="px-1">{LOCATION[e.location] || e.location}</td>
                  <td className="px-1">{e.repeat ? 'yes' : 'no'}</td>
                  <td className="px-1">{e.t.toFixed(1)}</td>
                  <td className="px-1 text-rose-300">{e.chatter ? `CHATTER (${e.gapMs} ms)` : ''}</td>
                </tr>
              ))}
              {st.log.length === 0 && <tr><td colSpan={8} className="px-1 py-2 text-slate-600">No events yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KeymapCell({ code, selected, onClick, label }) {
  return (
    <button
      onClick={onClick}
      title={`${label} (${hex4(code)})`}
      className={`h-12 rounded border text-[10px] font-bold px-1 break-all leading-tight ${selected ? 'border-cyan-300 bg-cyan-500/30 text-white' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-600'}`}
    >
      {label}
      <div className="text-[8px] font-normal text-slate-500">{hex4(code)}</div>
    </button>
  );
}

function ViaPanel({ onLogMessage }) {
  const [error, setError] = useSessionError('VIA');
  const [device, setDevice] = useState(null);
  const [info, setInfo] = useState(null); // { protocol, layers, uptimeMs, layoutOptions }
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(12);
  const [defName, setDefName] = useState('');
  const [defText, setDefText] = useState('');
  const [keymap, setKeymap] = useState(null);
  const [layer, setLayer] = useState(0);
  const [sel, setSel] = useState(null); // { row, col }
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(null);
  const [newCode, setNewCode] = useState('');
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [readBack, setReadBack] = useState(null);
  const [matrixOn, setMatrixOn] = useState(false);
  const [matrix, setMatrix] = useState(null);
  const [seen, setSeen] = useState(null);

  const clientRef = useRef(null);
  const deviceRef = useRef(null);
  const handlerRef = useRef(null);
  const matrixTimer = useRef(null);
  const matrixBusy = useRef(false);

  const webHidAvailable = typeof navigator !== 'undefined' && !!navigator.hid;
  const log = useCallback((t, l) => { if (onLogMessage) onLogMessage(t, l); }, [onLogMessage]);

  const stopMatrix = useCallback(() => {
    if (matrixTimer.current) clearInterval(matrixTimer.current);
    matrixTimer.current = null;
    setMatrixOn(false);
  }, []);

  const teardown = useCallback(async () => {
    stopMatrix();
    const dev = deviceRef.current;
    if (dev && handlerRef.current) {
      try { dev.removeEventListener('inputreport', handlerRef.current); } catch (e) { /* ignore */ }
    }
    if (dev) { try { await dev.close(); } catch (e) { /* ignore */ } }
    deviceRef.current = null;
    handlerRef.current = null;
    clientRef.current = null;
    setDevice(null);
  }, [stopMatrix]);

  useEffect(() => () => { teardown(); }, [teardown]);

  const connect = async () => {
    setError('');
    if (!webHidAvailable) { setError('WebHID is not available here. Use Chrome or Edge over HTTPS or localhost.'); return; }
    try {
      const [dev] = await navigator.hid.requestDevice({ filters: [{ usagePage: VIA_USAGE_PAGE, usage: VIA_USAGE }] });
      if (!dev) return;
      if (!dev.opened) await dev.open();
      const client = new ViaClient({ send: (packet) => dev.sendReport(0, packet), timeoutMs: 1000 });
      const handler = (e) => {
        const bytes = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
        client.handleInput(bytes);
      };
      dev.addEventListener('inputreport', handler);
      deviceRef.current = dev;
      handlerRef.current = handler;
      clientRef.current = client;
      setDevice(dev);
      const protocol = await client.protocolVersion();
      const layers = await client.layerCount();
      const uptimeMs = await client.uptimeMs();
      const layoutOptions = await client.layoutOptions();
      setInfo({ protocol, layers, uptimeMs, layoutOptions });
      log(`VIA protocol ${protocol}, ${layers} layer(s) on ${dev.productName || 'keyboard'}`, 'ok');
    } catch (err) {
      setError(err.message);
      await teardown();
    }
  };

  const disconnect = async () => {
    await teardown();
    setInfo(null);
    setKeymap(null);
    setMatrix(null);
    setSeen(null);
    setSel(null);
    setReadBack(null);
  };

  const withBusy = async (label, fn) => {
    if (!clientRef.current) return;
    setBusy(label);
    setError('');
    try { return await fn(clientRef.current); } catch (err) { setError(err.message); return undefined; } finally { setBusy(''); }
  };

  const refreshUptime = () => withBusy('uptime', async (c) => {
    const uptimeMs = await c.uptimeMs();
    setInfo((i) => ({ ...i, uptimeMs }));
  });

  const applyDefinition = () => {
    try {
      const d = parseViaDefinition(defText);
      setRows(d.rows);
      setCols(d.cols);
      setDefName(d.name);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  const readKeymap = () => withBusy('keymap', async (c) => {
    const layers = info?.layers || 0;
    if (!layers) throw new Error('Layer count unknown. Reconnect the keyboard.');
    if (rows < 1 || cols < 1) throw new Error('Set rows and columns first.');
    setProgress({ done: 0, total: layers * rows * cols * 2 });
    const map = await c.readKeymap(layers, rows, cols, (done, total) => setProgress({ done, total }));
    setKeymap(map);
    setLayer(0);
    setSel(null);
    setProgress(null);
    log(`Read keymap: ${layers} layer(s), ${rows}x${cols}`, 'ok');
  }).finally(() => setProgress(null));

  const readSelected = () => withBusy('read', async (c) => {
    const code = await c.getKeycode(layer, sel.row, sel.col);
    setReadBack(code);
    setKeymap((km) => {
      if (!km) return km;
      const copy = km.map((l) => l.map((r) => r.slice()));
      copy[layer][sel.row][sel.col] = code;
      return copy;
    });
  });

  const writeSelected = () => withBusy('write', async (c) => {
    const code = parseKeycodeText(newCode);
    if (code === null) throw new Error('Not a keycode: use hex (0x0004), a KC_ name such as KC_A, or MO(n) / TG(n) / OSL(n) / DF(n) / TT(n).');
    await c.setKeycode(layer, sel.row, sel.col, code);
    // The set reply only echoes what was sent, so read the key back to confirm the write.
    const back = await c.getKeycode(layer, sel.row, sel.col);
    setReadBack(back);
    setKeymap((km) => {
      if (!km) return km;
      const copy = km.map((l) => l.map((r) => r.slice()));
      copy[layer][sel.row][sel.col] = back;
      return copy;
    });
    setConfirmWrite(false);
    setNewCode('');
    log(`Wrote ${hex4(code)} to layer ${layer} row ${sel.row} col ${sel.col}; keyboard reported ${hex4(back)}`, back === code ? 'ok' : 'warn');
  });

  const pollMatrix = useCallback(async () => {
    const c = clientRef.current;
    if (!c || matrixBusy.current) return;
    matrixBusy.current = true;
    try {
      const m = await c.readMatrix(rows, cols);
      setMatrix(m);
      setSeen((prev) => {
        const base = prev || Array.from({ length: rows }, () => Array(cols).fill(false));
        return base.map((r, ri) => r.map((v, ci) => v || !!(m[ri] && m[ri][ci])));
      });
    } catch (err) {
      setError(err.message);
      stopMatrix();
    } finally {
      matrixBusy.current = false;
    }
  }, [rows, cols, stopMatrix]);

  const startMatrix = () => {
    if (!clientRef.current || matrixTimer.current) return;
    setSeen(null);
    setMatrixOn(true);
    matrixTimer.current = setInterval(pollMatrix, 150);
    pollMatrix();
  };

  useEffect(() => { if (!device) stopMatrix(); }, [device, stopMatrix]);

  const sized = rows > 0 && cols > 0;
  const selCode = keymap && sel ? keymap[layer][sel.row][sel.col] : null;
  const selDecoded = selCode !== null ? decodeKeycode(selCode) : null;
  const parsedNew = newCode ? parseKeycodeText(newCode) : null;
  const layerCount = info?.layers || 0;

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-200 flex items-center gap-2"><Usb className="w-4 h-4 text-purple-400" /> VIA KEYBOARD (WEBHID)</span>
        <StatusBadge status={device ? 'online' : 'offline'} label="VIA" value={device ? 'Connected' : 'Idle'} pulse={!!device} />
      </div>

      {!webHidAvailable && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
          <ShieldAlert className="w-4 h-4 shrink-0" /> WebHID needs Chrome or Edge over HTTPS or localhost.
        </div>
      )}
      {error && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold break-words">
          <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {!device ? (
          <button onClick={connect} disabled={!webHidAvailable} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-purple-500 to-indigo-600 text-white text-xs font-bold disabled:opacity-40">
            <Usb className="w-3.5 h-3.5" /> OPEN VIA KEYBOARD
          </button>
        ) : (
          <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
            <Power className="w-3.5 h-3.5" /> CLOSE
          </button>
        )}
        <span className="text-[11px] text-slate-500">Looks for usage page 0xFF60 / usage 0x61 (VIA raw HID). Needs a VIA-enabled firmware.</span>
      </div>

      {device && info && (
        <div className="grid grid-cols-2 @md:grid-cols-4 gap-2 text-[11px]">
          <div className="bg-slate-950 border border-slate-800 rounded p-2"><div className="text-slate-500">VIA protocol</div><div className="text-slate-200 font-bold">{info.protocol}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2"><div className="text-slate-500">Layers</div><div className="text-slate-200 font-bold">{info.layers}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2">
            <div className="text-slate-500">Uptime (QMK timer)</div>
            <div className="text-slate-200 font-bold">{Math.round(info.uptimeMs / 1000)} s</div>
            <button onClick={refreshUptime} disabled={!!busy} className="text-[10px] text-cyan-300 underline disabled:opacity-40">refresh</button>
          </div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2"><div className="text-slate-500">Layout options</div><div className="text-slate-200 font-bold">{info.layoutOptions !== null ? hex4(info.layoutOptions) : '-'}</div></div>
          <div className="bg-slate-950 border border-slate-800 rounded p-2 text-slate-500 @md:col-span-4">Definition: <span className="text-slate-300">{defName || 'none loaded (enter rows and columns below)'}</span></div>
        </div>
      )}

      {device && (
        <div className="space-y-2 border-t border-slate-800 pt-3">
          <div className="flex flex-wrap items-end gap-2 text-[11px]">
            <label className="flex flex-col text-slate-400">Rows
              <input type="number" min={1} max={64} value={rows} onChange={(e) => setRows(Math.max(0, Number(e.target.value) || 0))} className="w-20 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-slate-200" />
            </label>
            <label className="flex flex-col text-slate-400">Columns (max 32)
              <input type="number" min={1} max={32} value={cols} onChange={(e) => setCols(Math.max(0, Math.min(32, Number(e.target.value) || 0)))} className="w-24 bg-slate-950 border border-slate-800 rounded px-1 py-0.5 text-slate-200" />
            </label>
            <button onClick={readKeymap} disabled={!!busy || !sized || !layerCount} className="flex items-center gap-1 px-3 py-1.5 rounded border border-purple-500/50 text-purple-200 font-bold disabled:opacity-40">
              <Grid3x3 className="w-3.5 h-3.5" /> READ KEYMAP
            </button>
            {busy && <span className="text-amber-300">{busy}...</span>}
            {progress && <span className="text-slate-400">{progress.done}/{progress.total} bytes</span>}
          </div>
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer text-slate-300">Matrix size from a VIA definition JSON</summary>
            <div className="mt-2 space-y-2">
              <textarea value={defText} onChange={(e) => setDefText(e.target.value)} rows={4} placeholder='Paste a VIA keyboard definition, e.g. {"name":"...","matrix":{"rows":4,"cols":12}, ...}' className="w-full bg-slate-950 border border-slate-800 rounded p-2 text-slate-200" />
              <button onClick={applyDefinition} disabled={!defText.trim()} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-700 text-slate-300 disabled:opacity-40"><Upload className="w-3 h-3" /> use matrix from definition</button>
              <div className="text-[10px] text-slate-500">Only matrix.rows and matrix.cols are read. Physical key shapes from the layout are not drawn; the grid is by matrix position.</div>
            </div>
          </details>

          {keymap && (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {keymap.map((_, li) => (
                  <button key={li} onClick={() => { setLayer(li); setSel(null); setReadBack(null); setConfirmWrite(false); }} className={`px-2 py-1 rounded border text-[11px] font-bold ${li === layer ? 'border-cyan-400 text-cyan-200 bg-cyan-500/20' : 'border-slate-700 text-slate-400'}`}>Layer {li}</button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(4.5rem, 1fr))`, minWidth: `${cols * 4.75}rem` }}>
                  {keymap[layer].map((r, ri) => r.map((code, ci) => {
                    const d = decodeKeycode(code);
                    return (
                      <KeymapCell
                        key={`${ri}-${ci}`}
                        code={code}
                        label={d.label}
                        selected={!!sel && sel.row === ri && sel.col === ci}
                        onClick={() => { setSel({ row: ri, col: ci }); setReadBack(null); setConfirmWrite(false); setNewCode(''); }}
                      />
                    );
                  }))}
                </div>
              </div>

              {sel && selDecoded && (
                <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-2 text-[11px]">
                  <div className="text-slate-300">Layer {layer}, row {sel.row}, col {sel.col}: <span className="text-cyan-300 font-bold">{selDecoded.label}</span> <span className="text-slate-500">{hex4(selCode)} ({selDecoded.kind})</span></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button onClick={readSelected} disabled={!!busy} className="px-2 py-1 rounded border border-slate-700 text-slate-300 disabled:opacity-40">Read this key from keyboard</button>
                    {readBack !== null && <span className="text-slate-400">last reply: {hex4(readBack)}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input value={newCode} onChange={(e) => { setNewCode(e.target.value); setConfirmWrite(false); }} placeholder="new keycode: KC_A, 0x0004, MO(1)" className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 w-56" />
                    {newCode && parsedNew === null && <span className="text-rose-300">not a keycode</span>}
                    {newCode && parsedNew !== null && <span className="text-slate-400">= {decodeKeycode(parsedNew).label} {hex4(parsedNew)}</span>}
                  </div>
                  {!confirmWrite ? (
                    <button onClick={() => setConfirmWrite(true)} disabled={!!busy || parsedNew === null} className="px-2 py-1 rounded border border-amber-500/50 text-amber-200 disabled:opacity-40">Write to keyboard...</button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 p-2 border border-amber-500/40 bg-amber-500/10 rounded text-amber-100">
                      <span>Write {hex4(parsedNew)} to layer {layer}, row {sel.row}, col {sel.col}? This changes the keyboard's saved keymap.</span>
                      <button onClick={writeSelected} disabled={!!busy} className="px-2 py-1 rounded bg-amber-500 text-black font-bold">Confirm write</button>
                      <button onClick={() => setConfirmWrite(false)} className="px-2 py-1 rounded border border-slate-600 text-slate-300">Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-slate-800 pt-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="font-bold text-slate-200 flex items-center gap-1"><Activity className="w-3.5 h-3.5 text-emerald-400" /> LIVE MATRIX TEST</span>
              {!matrixOn ? (
                <button onClick={startMatrix} disabled={!sized} className="flex items-center gap-1 px-2 py-1 rounded border border-emerald-500/50 text-emerald-200 disabled:opacity-40"><Play className="w-3 h-3" /> start polling</button>
              ) : (
                <button onClick={stopMatrix} className="flex items-center gap-1 px-2 py-1 rounded border border-slate-600 text-slate-300"><Square className="w-3 h-3" /> stop</button>
              )}
              <button onClick={() => setSeen(null)} className="px-2 py-1 rounded border border-slate-700 text-slate-400">clear seen</button>
              <span className="text-slate-500">Reads the switch matrix state (about every 150 ms). Locked readout shows nothing pressed.</span>
            </div>
            {matrix && sized && (
              <div className="overflow-x-auto">
                <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 1.25rem)` }}>
                  {matrix.map((r, ri) => r.map((on, ci) => (
                    <div
                      key={`${ri}-${ci}`}
                      title={`row ${ri} col ${ci}`}
                      className={`h-5 w-5 rounded-sm border ${on ? 'bg-cyan-400 border-cyan-200' : seen && seen[ri] && seen[ri][ci] ? 'bg-emerald-900 border-emerald-700' : 'bg-slate-900 border-slate-800'}`}
                    />
                  )))}
                </div>
              </div>
            )}
            {matrix && <div className="text-[10px] text-slate-500">Cyan = pressed now. Dark green = pressed at least once since the last clear.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function KeyboardTesterWorkbench({ onLogMessage }) {
  return (
    <div className="space-y-2 font-mono text-xs">
      <details className="text-[11px] text-slate-400">
        <summary className="cursor-pointer text-slate-300">About this tool</summary>
        <p className="mt-1 max-w-3xl">
          The <span className="text-cyan-300">key tester</span> needs no hardware: it shows the keys your browser receives, with an event
          log, rollover, chatter, hold time and ghosting-combo checks. Nothing you type is stored or sent anywhere. The{' '}
          <span className="text-purple-300">VIA panel</span> talks to a VIA-enabled keyboard over WebHID to read the keymap, write one
          key after confirmation, and poll the switch matrix.
        </p>
      </details>
      <KeyTesterPanel />
      <ViaPanel onLogMessage={onLogMessage} />
    </div>
  );
}
