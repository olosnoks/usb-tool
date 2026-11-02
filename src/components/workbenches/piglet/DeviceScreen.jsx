import React, { useRef, useEffect, useState } from 'react';
import { PIG } from './pigSprites';
import './deviceScreens.css';

/**
 * Per-board device-screen demos, ported from the WarHog web flasher's screens.js.
 *
 *  - "cyd"    → the WarHog Core main screen (static CSS mockup)
 *  - "wave"   → the Waveshare ST7789 status screen (static + two live counters)
 *  - "warhog" → the XIAO C5 128x64 OLED PigWorld animation (canvas, 20 fps)
 *  - "c3"     → the WarHogNode C3 72x40 OLED PigWorld animation (canvas, 20 fps)
 */

// PigWorld sprite frame indices (from PigWorld.cpp).
const W0 = 2, W1 = 3, W2 = 4, W3 = 5, STAND = 0, BLINK = 1, CROUCH = 8, JUMP = 9, LAND = 10, HAPPY = 11;

function drawSprite(ctx, bmp, ox, oy, color, flip, w) {
  for (let y = 0; y < bmp.length; y++) {
    const row = bmp[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '1') {
        const dx = flip ? (w - 1 - x) : x;
        ctx.fillStyle = (typeof color === 'function') ? color(ox + dx, oy + y) : color;
        ctx.fillRect(ox + dx, oy + y, 1, 1);
      }
    }
  }
}

// Direct port of mountPig(): a pig walking through a side-scrolling world.
function runPig(canvas, o) {
  const W = o.W, H = o.H, P = PIG[o.size], pw = P.w, ph = P.h;
  const ctx = canvas.getContext('2d');
  const two = o.two, split = 16, g = o.ground, px = o.pigX, hopH = o.hopH;
  const ink = (x, y) => (two ? (y < split ? o.sky : o.land) : o.land);
  const trees = [];
  for (let i = 0; i < 4; i++) trees.push({ wx: 40 + i * 52, t: (i % 2 ? 'oak' : 'pine') });
  const clouds = [
    { x: W * 0.2, y: 3, s: 0.18, sp: 'cloud1' },
    { x: W * 0.7, y: 7, s: 0.10, sp: 'cloud2' },
    { x: W * 1.1, y: 2, s: 0.07, sp: 'cloud3' }
  ];
  let birds = null, birdT = 200 + Math.random() * 400;
  let tick = 0, worldX = 0, hopAt = 60 + Math.random() * 60, st = null;

  function pigFrame() {
    if (st) {
      const k = st.k;
      if (k < 2) return { f: CROUCH, dy: 0, bang: false };
      if (k < 14) { const p = (k - 2) / 12; return { f: JUMP, dy: -Math.round(Math.sin(Math.PI * p) * hopH), bang: true }; }
      if (k < 16) return { f: LAND, dy: 0, bang: false };
      if (k < 26) return { f: HAPPY, dy: 0, bang: false };
      return { f: STAND, dy: 0, bang: false };
    }
    const phase = Math.floor(tick / 2) % 4;
    let f = [W0, W1, W2, W3][phase];
    if (tick % 140 < 2) f = BLINK;
    return { f, dy: 0, bang: false };
  }

  function drawGround() {
    ctx.fillStyle = o.land; ctx.fillRect(0, g, W, 1);
    for (let x = -(worldX % 6); x < W; x += 6) ctx.fillRect(x, g + 2, 1, 1);
  }

  function step() {
    ctx.fillStyle = o.bg; ctx.fillRect(0, 0, W, H);
    if (two) {
      ctx.fillStyle = o.skyTint; ctx.fillRect(0, 0, W, split - 1);
      ctx.fillStyle = o.sky;
      const sx = W - 26, sy = 8, r = 4;
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
      for (let d = 0; d < 8; d++) {
        const ang = d * Math.PI / 4;
        ctx.fillRect(Math.round(sx + Math.cos(ang) * (r + 2)), Math.round(sy + Math.sin(ang) * (r + 2)), 1, 1);
      }
    }
    for (let c = 0; c < clouds.length; c++) {
      const cl = clouds[c], S = PIG[cl.sp], cx = Math.round(cl.x);
      drawSprite(ctx, S.d, cx, cl.y, o.sky, false, S.w);
      cl.x -= cl.s; if (cl.x < -S.w) cl.x = W + Math.random() * 10;
    }
    drawGround();
    for (let t = 0; t < trees.length; t++) {
      const tr = trees[t], T = PIG[tr.t], sx2 = Math.round(tr.wx - worldX * 1.0);
      const span = trees.length * 52, rx = ((sx2 % span) + span) % span - 10;
      if (rx > -T.w && rx < W) drawSprite(ctx, T.d, rx, g - T.h + 1, o.land, false, T.w);
    }
    if (two) {
      if (!birds && tick > birdT) birds = { x: W + 4, y: 4 + Math.random() * 7 };
      if (birds) {
        const bf = [PIG.birdU, PIG.birdM, PIG.birdD][Math.floor(tick / 2) % 3];
        drawSprite(ctx, bf.d, Math.round(birds.x), birds.y, o.sky, false, bf.w);
        birds.x -= 0.8; if (birds.x < -8) { birds = null; birdT = tick + 200 + Math.random() * 400; }
      }
    }
    const pf = pigFrame();
    drawSprite(ctx, P.f[pf.f], px, g - ph + 1 + pf.dy, ink, false, pw);
    if (pf.bang) {
      ctx.fillStyle = o.land;
      ctx.fillRect(px + pw + 1, g - ph - 3 + pf.dy, 1, 3);
      ctx.fillRect(px + pw + 1, g - ph + 1 + pf.dy, 1, 1);
    }
    if (!st) worldX += o.scroll;
    tick++;
    if (st) { st.k++; if (st.k >= 28) { st = null; hopAt = tick + 60 + Math.random() * 80; } }
    else if (tick > hopAt) st = { k: 0 };
  }

  step();
  return setInterval(step, 50);
}

const PIG_OPTS = {
  warhog: { size: 'L', W: 128, H: 64, two: true, bg: '#060709', skyTint: '#1a1403', sky: '#ffcf3a', land: '#39bffb', ground: 52, pigX: 22, hopH: 13, scroll: 1 },
  c3: { size: 'S', W: 72, H: 40, two: false, bg: '#060709', sky: '#a9e7ff', land: '#a9e7ff', ground: 32, pigX: 14, hopH: 8, scroll: 1 }
};

function PigCanvas({ kind }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const id = runPig(canvas, PIG_OPTS[kind]);
    return () => clearInterval(id);
  }, [kind]);
  const o = PIG_OPTS[kind];
  return (
    <div className="screen">
      <canvas
        ref={canvasRef}
        width={o.W}
        height={o.H}
        style={{ width: '100%', imageRendering: 'pixelated', display: 'block' }}
      />
    </div>
  );
}

function WaveScreen() {
  const [ap, setAp] = useState(37);
  const [n2g, setN2g] = useState(1203);
  useEffect(() => {
    let k = 0;
    const id = setInterval(() => {
      k++;
      if (k % 10 === 0) setAp((v) => (v > 0 ? v - 1 : v));
      if (k % 4 === 0) setN2g((v) => v + Math.floor(Math.random() * 3));
    }, 500);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="screen">
      <div className="wave">
        <div className="wv-hd">
          <span className="wv-ttl">WarHog</span>
          <span className="wv-ic"><b className="arr" /><b className="sd" /><b className="gps" /></span>
        </div>
        <div className="wv-l"><span>Scan:</span> ACTIVE</div>
        <div className="wv-l"><span>SD:</span> OK</div>
        <div className="wv-l"><span>GPS:</span> LOCK</div>
        <div className="wv-l"><span>STA:</span> NO</div>
        <div className="wv-l"><span>AP:</span> 192.168.4.1 <em className="ap">{ap}</em>s</div>
        <div className="wv-wig">WiGLE: Unknown<br /><span>-</span></div>
        <div className="wv-big">2.4G: <em className="n2g">{n2g}</em></div>
        <div className="wv-nav"><span className="wv-tri" /><em>0 km/h</em></div>
      </div>
    </div>
  );
}

function CydScreen() {
  return (
    <div className="screen">
      <div className="cyd">
        <div className="cyd-hd">
          <span className="cyd-pig">🐷</span>
          <span className="cyd-ttl">WARHOG<b>CORE</b></span>
          <span className="cyd-bat"><i />4.12V</span>
          <span className="cyd-dots"><u className="y" />GPS <u />SD <u />RF</span>
        </div>
        <div className="cyd-sec">RADIO / MESH ROLE</div>
        <div className="cyd-seg"><s>SOLO</s><s className="on">CORE</s><s>NODE</s><s>WEB</s><s>OFF</s></div>
        <div className="cyd-sec">STATUS</div>
        <div className="cyd-stat">CORE&nbsp;&nbsp;<em>0</em> workers<br />RX <em>0</em>&nbsp;&nbsp;&nbsp;admin ch 6</div>
        <div className="cyd-sec">CAPTURE</div>
        <div className="cyd-cap"><s className="on">2.4G ON</s><s className="on">5G ON</s><s className="on">BLE ON</s></div>
        <div className="cyd-cards">
          <div className="cc a"><label>2.4 GHZ</label><b>0</b></div>
          <div className="cc b"><label>5 GHZ</label><b>0</b></div>
          <div className="cc p"><label>BLE</label><b>0</b></div>
        </div>
        <div className="cyd-cards2">
          <div className="cc a"><label>SCANS</label><b>0</b></div>
          <div className="cc a"><label>CSV ROWS</label><b>0</b></div>
        </div>
        <div className="cyd-nav"><u className="on">HOME</u><u>FILE</u><u>SYS</u><u>MRDR</u></div>
      </div>
    </div>
  );
}

export default function DeviceScreen({ kind }) {
  if (!kind) return null;
  let inner = null;
  if (kind === 'cyd') inner = <CydScreen />;
  else if (kind === 'wave') inner = <WaveScreen />;
  else if (kind === 'warhog' || kind === 'c3') inner = <PigCanvas kind={kind} />;
  else return null;
  return <div className="whd">{inner}</div>;
}
