import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor, Play, Square, Camera, Zap } from 'lucide-react';
import { MirrorDecoder, pointerToDevice } from '../../../utils/pigletMirror';

// Live mirror of the Piglet's display over the toolkit USB session, plus remote
// touch. WT SCREEN ON streams RLE tiles (ScreenMirror.cpp); the decoder paints
// them into the canvas, and pointer events become WT TOUCH. Ported from the
// WarHog web flasher's toolkit.js "screen mirror" module.

const KEEPALIVE_MS = 8000;   // device stops after 20 s without a PING
const FPS_OPTIONS = [2, 3, 4, 6, 8];

function saveCanvasPng(canvas) {
  if (!canvas || !canvas.width) return;
  canvas.toBlob((b) => {
    if (!b) return;
    const name = 'warhog-screen-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.png';
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

export default function PigletScreenMirror({ client, connected, log }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const decoderRef = useRef(null);
  const wantRef = useRef(false);        // we asked for the mirror and keep it alive
  const keepTimerRef = useRef(0);
  const sizeRef = useRef({ w: 0, h: 0 });
  const downRef = useRef(false);
  const moveTsRef = useRef(0);

  const [on, setOn] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [fps, setFps] = useState(4);
  const [stats, setStats] = useState({ fps: 0, kbps: 0 });
  const [fpsSetting, setFpsSetting] = useState(4);

  // Build the decoder once; it paints straight into the canvas.
  if (!decoderRef.current) {
    decoderRef.current = new MirrorDecoder({
      onSize: (w, h) => {
        sizeRef.current = { w, h };
        const c = canvasRef.current;
        if (c) { c.width = w; c.height = h; ctxRef.current = c.getContext('2d'); ctxRef.current.fillStyle = '#000'; ctxRef.current.fillRect(0, 0, w, h); }
        setDims({ w, h });
      },
      onTile: (x0, y0, tw, th, rgba) => {
        const ctx = ctxRef.current;
        if (!ctx) return;
        const img = new ImageData(rgba, tw, th);
        ctx.putImageData(img, x0, y0);
      },
      onFrame: () => { const d = decoderRef.current; setStats({ fps: d.fps, kbps: d.kbps }); },
      onStop: () => {
        setOn(false);
        if (wantRef.current && client.connected) startMirror();   // timed out behind a transfer: resume
      }
    });
  }

  // Route frame lines from the client into the decoder while mounted.
  useEffect(() => client.onFrameLine((line) => decoderRef.current.feed(line)), [client]);

  const scheduleKeepalive = useCallback(() => {
    clearTimeout(keepTimerRef.current);
    if (!wantRef.current || !client.connected) return;
    keepTimerRef.current = setTimeout(async () => {
      if (!wantRef.current || !client.connected) return;
      try {
        const r = await client.screenPing();
        if (/screen off/.test(r)) { setOn(false); await startMirror(); return; }
      } catch (e) { /* ignore */ }
      scheduleKeepalive();
    }, KEEPALIVE_MS);
  }, [client]);

  const startMirror = useCallback(async () => {
    if (!client.connected || unsupported) return;
    wantRef.current = true;
    try {
      const r = await client.screenOn(fpsSetting);
      const m = r.match(/screen on (\d+) (\d+)/);
      if (m) decoderRef.current.setSize(+m[1], +m[2]);
      decoderRef.current.statT = 0; decoderRef.current.frames = 0; decoderRef.current.bytes = 0;
      setOn(true);
      log?.('Screen mirror on (' + (m ? m[1] + '×' + m[2] : '?') + ')');
      scheduleKeepalive();
    } catch (e) {
      if (/unknown|nomirror|screensub/i.test(e.message)) setUnsupported(true);
      log?.('Screen mirror failed: ' + e.message);
      wantRef.current = false; setOn(false);
    }
  }, [client, unsupported, fpsSetting, log, scheduleKeepalive]);

  const stopMirror = useCallback(async () => {
    wantRef.current = false; setOn(false);
    clearTimeout(keepTimerRef.current); keepTimerRef.current = 0;
    if (client.connected) { try { await client.screenOff(); } catch (e) { /* ignore */ } }
  }, [client]);

  // Tear down when the tool disconnects or unmounts.
  useEffect(() => {
    if (!connected) { wantRef.current = false; setOn(false); clearTimeout(keepTimerRef.current); }
    return () => { clearTimeout(keepTimerRef.current); };
  }, [connected]);

  // When the frame rate changes while streaming, re-issue ON to apply it.
  useEffect(() => { if (on && wantRef.current) startMirror(); /* eslint-disable-next-line */ }, [fpsSetting]);
  useEffect(() => { setFps(fpsSetting); }, [fpsSetting]);

  // ---- remote touch ----
  const sendTouch = (sub, x, y) => { if (client.connected) client.touch(sub, x, y); };
  const toDev = (ev) => {
    const c = canvasRef.current; if (!c) return null;
    return pointerToDevice(c.getBoundingClientRect(), ev.clientX, ev.clientY, sizeRef.current.w, sizeRef.current.h);
  };
  const onPointerDown = (ev) => {
    if (!client.connected || !sizeRef.current.w) return;
    const p = toDev(ev); if (!p) return;
    ev.preventDefault();
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    downRef.current = true;
    sendTouch('DOWN', p.x, p.y);
  };
  const onPointerMove = (ev) => {
    if (!downRef.current) return;
    const now = Date.now();
    if (now - moveTsRef.current < 40) return;     // ~25 Hz cap
    const p = toDev(ev); if (!p) return;
    moveTsRef.current = now;
    sendTouch('MOVE', p.x, p.y);
  };
  const onPointerUp = (ev) => {
    if (!downRef.current) return;
    downRef.current = false;
    try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
    sendTouch('UP');
  };

  const statusText = unsupported
    ? 'This firmware has no screen mirror: flash the latest CYD / W550 build.'
    : !connected ? 'Connect over USB first.'
      : !on ? (dims.w ? 'Screen disconnected.' : 'Start the mirror to view and control the device screen.')
        : `${dims.w}×${dims.h} · ${stats.fps.toFixed(1)} fps · ${stats.kbps.toFixed(0)} KB/s`;

  return (
    <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 @sm:p-5 space-y-4" data-pane="screen">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-purple-400" />
          <h2 className="font-bold text-slate-100 text-sm">Screen Mirror &amp; Remote Touch</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-slate-400 flex items-center gap-1">FPS
            <select value={fpsSetting} onChange={(e) => setFpsSetting(parseInt(e.target.value, 10))} disabled={!connected || unsupported}
              className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-slate-200 disabled:opacity-40">
              {FPS_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => (on ? stopMirror() : startMirror())} disabled={!connected || unsupported}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition disabled:opacity-40 ${on ? 'bg-rose-600/80 hover:bg-rose-600 text-white' : 'bg-purple-600 hover:bg-purple-500 text-white'}`}>
            {on ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {on ? 'Stop' : 'Start mirror'}
          </button>
          <button type="button" onClick={() => client.screenKey()} disabled={!connected || !on}
            title="Request a full frame (repaint)" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40">
            <Zap className="w-3.5 h-3.5" /> Refresh
          </button>
          <button type="button" onClick={() => saveCanvasPng(canvasRef.current)} disabled={!dims.w}
            title="Save a PNG of the current screen" className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-40">
            <Camera className="w-3.5 h-3.5" /> PNG
          </button>
        </div>
      </div>

      <div className="flex justify-center">
        <div className="relative bg-black rounded-lg overflow-hidden border border-slate-800 w-full" style={{ maxWidth: dims.w ? Math.min(dims.w * 3, 560) + 'px' : '420px' }}>
          <canvas
            ref={canvasRef} width={dims.w || 240} height={dims.h || 320}
            className="block w-full h-auto select-none touch-none"
            style={{ aspectRatio: dims.w ? `${dims.w} / ${dims.h}` : '3 / 4', imageRendering: 'pixelated', cursor: on ? 'pointer' : 'default' }}
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          />
          {!dims.w && (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-600 pointer-events-none px-4 text-center">
              {connected ? 'Start the mirror to see the device screen.' : 'Connect over USB first.'}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 text-center">{statusText}</p>
      {on && <p className="text-[10px] text-slate-600 text-center">Click or drag the screen to navigate the device.</p>}
    </div>
  );
}
