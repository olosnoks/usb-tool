import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { MiniTerm, keyToBytes, pasteBytes } from '../utils/miniTerm';

/**
 * Interactive terminal mode: keystrokes go straight to the device (no send box)
 * and the screen is rendered from the raw RX byte stream. xterm.js is not a
 * dependency of this project, so this uses the in-house MiniTerm core
 * (src/utils/miniTerm.js); see its header for what is and is not emulated.
 *
 * Feeds from `subscribeRx` for the board it is attached to. `getBacklog()` may
 * return received chunks to replay when the component first mounts.
 */
export default function TerminalEmulator({
  subscribeRx,
  boardId,
  sendRawBytes,
  isConnected,
  getBacklog,
  visible = true,
}) {
  const [enter, setEnter] = useState('cr');           // cr | crlf | lf
  const [backspace, setBackspace] = useState('del');  // del | bs
  const [localEcho, setLocalEcho] = useState(false);
  const [bracketed, setBracketed] = useState('auto'); // auto | on | off
  const [, setTick] = useState(0);
  const [focused, setFocused] = useState(false);

  const term = useMemo(() => new MiniTerm({ cols: 80, rows: 24, scrollback: 10000 }), []);
  const hostRef = useRef(null);
  const screenRef = useRef(null);
  const rafRef = useRef(0);
  const optsRef = useRef({});
  optsRef.current = { enter, backspace, localEcho, bracketed, sendRawBytes, isConnected };

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
    rafRef.current = raf(() => { rafRef.current = 0; setTick((t) => t + 1); });
  }, []);

  // Replay what was already received once, then follow the live stream.
  useEffect(() => {
    if (getBacklog) {
      for (const chunk of getBacklog() || []) term.write(chunk);
      scheduleRender();
    }
    if (!subscribeRx) return undefined;
    return subscribeRx((bytes, id) => {
      if (boardId && id !== boardId) return;
      term.write(bytes);
      scheduleRender();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeRx, boardId, term]);

  // Fit: derive cols/rows from the host box and a measured character cell.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return undefined;
    const fit = () => {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return; // hidden
      const probe = document.createElement('span');
      probe.textContent = 'W'.repeat(20);
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
      host.appendChild(probe);
      const cw = probe.getBoundingClientRect().width / 20 || 7;
      const ch = probe.getBoundingClientRect().height || 16;
      host.removeChild(probe);
      term.resize(Math.floor((w - 16) / cw), Math.floor(h / ch));
      scheduleRender();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    fit();
    return () => ro.disconnect();
  }, [term, scheduleRender, visible]);

  useEffect(() => () => { if (rafRef.current && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafRef.current); }, []);

  // Keep scrolled to the bottom as output arrives.
  useEffect(() => {
    const el = hostRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const send = (bytes) => {
    const o = optsRef.current;
    if (!o.isConnected || !o.sendRawBytes || !bytes || !bytes.length) return;
    o.sendRawBytes(bytes);
    if (o.localEcho) { term.write(bytes); scheduleRender(); }
  };

  const onKeyDown = (e) => {
    const sel = typeof window !== 'undefined' && window.getSelection ? String(window.getSelection()) : '';
    const bytes = keyToBytes(e, { enter, backspace, hasSelection: sel.length > 0 });
    if (!bytes) return;
    e.preventDefault();
    send(bytes);
  };

  const onPaste = (e) => {
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    e.preventDefault();
    const useBracket = bracketed === 'on' || (bracketed === 'auto' && term.bracketedPaste);
    send(pasteBytes(text, { bracketed: useBracket, enter }));
  };

  const rows = term.snapshot(2000);
  const selectCls = 'bg-[#030712] border border-slate-800 text-[11px] font-mono text-slate-300 rounded-lg px-2 py-1 outline-none cursor-pointer';

  return (
    <div className={`flex flex-col h-full bg-cyber-darkest border border-cyber-border rounded-xl shadow-xl overflow-hidden ${visible ? '' : 'hidden'}`}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-[#090e1a] border-b border-cyber-border text-[11px] font-mono">
        <span className="font-bold text-slate-200 tracking-wider">INTERACTIVE TERMINAL</span>
        <span className="text-[10px] text-slate-500">built-in emulator (no xterm.js)</span>
        <label className="flex items-center gap-1 text-slate-400">
          Enter
          <select value={enter} onChange={(e) => setEnter(e.target.value)} className={selectCls}>
            <option value="cr">CR</option>
            <option value="crlf">CRLF</option>
            <option value="lf">LF</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          Backspace
          <select value={backspace} onChange={(e) => setBackspace(e.target.value)} className={selectCls}>
            <option value="del">DEL (0x7F)</option>
            <option value="bs">BS (0x08)</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          Bracketed paste
          <select value={bracketed} onChange={(e) => setBracketed(e.target.value)} className={selectCls}>
            <option value="auto">Auto</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400 cursor-pointer">
          <input type="checkbox" checked={localEcho} onChange={(e) => setLocalEcho(e.target.checked)} />
          Local echo
        </label>
      </div>
      <div
        ref={hostRef}
        tabIndex={0}
        role="textbox"
        aria-label="Interactive serial terminal"
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`flex-1 min-h-[320px] max-h-[60vh] overflow-y-auto p-2 bg-[#030712] font-mono text-xs leading-[1.25] text-slate-200 outline-none select-text ${focused ? 'ring-1 ring-cyber-cyan/60' : ''}`}
      >
        <div ref={screenRef} className="whitespace-pre">
          {rows.map((runs, i) => (
            <div key={i} className="min-h-[1.25em]">
              {runs.length === 0 ? '​' : runs.map((r, j) => <span key={j} className={r.className}>{r.text}</span>)}
            </div>
          ))}
        </div>
      </div>
      <div className="px-3 py-1.5 bg-[#090e1a] border-t border-cyber-border text-[10px] text-slate-500 font-mono">
        {isConnected
          ? (focused ? 'Keyboard captured: keys go straight to the device. Click outside to release.' : 'Click the screen to capture the keyboard.')
          : 'Connect a port to type into the device.'}
        {' '}Scrollback {term.scrollback.toLocaleString()} rows ({Math.min(term.lines.length, 2000)} shown).
      </div>
    </div>
  );
}
