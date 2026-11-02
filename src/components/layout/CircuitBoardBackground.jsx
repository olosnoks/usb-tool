import React, { useEffect, useRef } from 'react';

// Generates an authentic PCB layout with octilinear (45-degree chamfered) traces,
// IC footprints, via annular rings, parallel bus ribbons, and animated light pulses.
export default function CircuitBoardBackground({ className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = null;
    let isTabVisible = true;
    let width = 0;
    let height = 0;
    let dpr = 1;

    // Static cached layer containing traces, vias, silkscreen and IC footprints
    let offscreenCanvas = null;
    let offscreenCtx = null;

    // Array of paths: each is an array of points [{x, y}], with segment lengths and totalLength
    let paths = [];
    // Active light pulses travelling along paths
    let pulses = [];
    // Active via/pin contact bursts
    let bursts = [];

    const PALETTES = [
      { head: '#38bdf8', glow: 'rgba(56, 189, 248, 0.85)', rgb: '56, 189, 248' },   // Cyan (data / USB)
      { head: '#34d399', glow: 'rgba(52, 211, 153, 0.85)', rgb: '52, 211, 153' },   // Emerald (RF / signal)
      { head: '#fbbf24', glow: 'rgba(251, 191, 36, 0.85)', rgb: '251, 191, 36' },   // Amber (clock / power)
      { head: '#a78bfa', glow: 'rgba(167, 139, 250, 0.85)', rgb: '167, 139, 250' }, // Violet (logic / debug)
    ];

    // Helper: calculate total path distance and segment breakdown
    function preparePath(points) {
      if (points.length < 2) return null;
      let totalLength = 0;
      const segments = [];
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy);
        segments.push({ p1, p2, dist, startDist: totalLength, endDist: totalLength + dist });
        totalLength += dist;
      }
      return { points, segments, totalLength };
    }

    // Helper: get coordinate along a prepared path at a given distance
    function getPointAtDistance(path, dist) {
      if (dist <= 0) return path.points[0];
      if (dist >= path.totalLength) return path.points[path.points.length - 1];
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i];
        if (dist >= seg.startDist && dist <= seg.endDist) {
          const t = seg.dist === 0 ? 0 : (dist - seg.startDist) / seg.dist;
          return {
            x: seg.p1.x + (seg.p2.x - seg.p1.x) * t,
            y: seg.p1.y + (seg.p2.y - seg.p1.y) * t,
          };
        }
      }
      return path.points[path.points.length - 1];
    }

    // Generate circuit topology (ICs, buses, dogleg traces, vias)
    function buildCircuitLayout(w, h) {
      paths = [];
      pulses = [];
      bursts = [];

      const GRID = 24;
      const snap = (v) => Math.round(v / GRID) * GRID;

      // Define 2 to 4 IC chip packages
      const chips = [
        { x: snap(w * 0.18), y: snap(h * 0.28), w: 120, h: 80, name: 'MCU_SOC' },
        { x: snap(w * 0.78), y: snap(h * 0.32), w: 96, h: 96, name: 'FPGA_PHY' },
        { x: snap(w * 0.45), y: snap(h * 0.75), w: 140, h: 72, name: 'RADIO_BASEBAND' },
      ];

      // Add a 4th chip on large screens
      if (w > 1200 && h > 700) {
        chips.push({ x: snap(w * 0.75), y: snap(h * 0.80), w: 80, h: 60, name: 'FLASH_EEPROM' });
      }

      // 1. Generate parallel Bus Ribbons between ICs or edge connectors
      // A bus is 3 to 6 parallel traces running side-by-side with 45° bends
      function createBus(startX, startY, dirX, dirY, count, spacing, len1, bendDir, len2, len3) {
        for (let i = 0; i < count; i++) {
          const offset = (i - (count - 1) / 2) * spacing;
          const p1 = { x: startX + (dirY !== 0 ? offset : 0), y: startY + (dirX !== 0 ? offset : 0) };
          
          let p2, p3, p4;
          if (dirX !== 0) {
            // Horizontal bus initially
            p2 = { x: p1.x + dirX * len1, y: p1.y };
            const bendDist = 40;
            p3 = { x: p2.x + dirX * bendDist, y: p2.y + bendDir * bendDist };
            p4 = { x: p3.x + dirX * (len2 || 80), y: p3.y };
          } else {
            // Vertical bus initially
            p2 = { x: p1.x, y: p1.y + dirY * len1 };
            const bendDist = 40;
            p3 = { x: p2.x + bendDir * bendDist, y: p2.y + dirY * bendDist };
            p4 = { x: p3.x, y: p3.y + dirY * (len2 || 80) };
          }

          const pts = [p1, p2, p3, p4];
          if (len3) {
            const p5 = { x: p4.x + (dirX !== 0 ? dirX * len3 : 0), y: p4.y + (dirY !== 0 ? dirY * len3 : 0) };
            pts.push(p5);
          }
          const prepared = preparePath(pts);
          if (prepared && prepared.totalLength > 40) {
            paths.push(prepared);
          }
        }
      }

      // Add major buses
      createBus(chips[0].x + chips[0].w / 2, chips[0].y, 1, 0, 4, 10, snap(w * 0.15), 1, snap(w * 0.18));
      createBus(chips[0].x, chips[0].y + chips[0].h / 2, 0, 1, 3, 12, snap(h * 0.18), 1, snap(h * 0.12));
      createBus(chips[1].x, chips[1].y, -1, 0, 5, 10, snap(w * 0.14), -1, snap(w * 0.12));
      createBus(chips[2].x + chips[2].w / 2, chips[2].y, 1, 0, 4, 10, snap(w * 0.12), -1, snap(w * 0.15));

      // 2. Generate procedural octilinear traces across the board
      const traceCount = Math.min(60, Math.floor((w * h) / 18000));
      for (let i = 0; i < traceCount; i++) {
        let x = snap(Math.random() * (w - 100) + 50);
        let y = snap(Math.random() * (h - 100) + 50);
        const pts = [{ x, y }];
        let curX = x;
        let curY = y;
        const segments = Math.floor(Math.random() * 3) + 2;

        let isHoriz = Math.random() > 0.5;
        for (let s = 0; s < segments; s++) {
          const dist = snap((Math.random() * 120 + 40));
          if (isHoriz) {
            curX += (Math.random() > 0.5 ? 1 : -1) * dist;
          } else {
            curY += (Math.random() > 0.5 ? 1 : -1) * dist;
          }
          curX = Math.max(30, Math.min(w - 30, curX));
          curY = Math.max(30, Math.min(h - 30, curY));
          pts.push({ x: curX, y: curY });

          // 45-degree chamfer transition segment
          const chamfer = snap(36);
          const diagX = (Math.random() > 0.5 ? 1 : -1) * chamfer;
          const diagY = (Math.random() > 0.5 ? 1 : -1) * chamfer;
          curX = Math.max(30, Math.min(w - 30, curX + diagX));
          curY = Math.max(30, Math.min(h - 30, curY + diagY));
          pts.push({ x: curX, y: curY });

          isHoriz = !isHoriz;
        }

        const prepared = preparePath(pts);
        if (prepared && prepared.totalLength > 60) {
          paths.push(prepared);
        }
      }

      // Pre-seed pulses along these paths
      const pulseCount = Math.min(36, Math.max(16, Math.floor(paths.length * 0.55)));
      for (let i = 0; i < pulseCount; i++) {
        const pathIndex = Math.floor(Math.random() * paths.length);
        const p = paths[pathIndex];
        pulses.push({
          pathIndex,
          progress: Math.random() * p.totalLength,
          speed: 0.12 + Math.random() * 0.18, // pixels per millisecond
          length: 35 + Math.random() * 40,
          palette: PALETTES[Math.floor(Math.random() * PALETTES.length)],
        });
      }

      // Pre-render the static PCB backdrop (traces, vias, IC footprints) to offscreen canvas
      offscreenCanvas = document.createElement('canvas');
      offscreenCanvas.width = Math.floor(w * dpr);
      offscreenCanvas.height = Math.floor(h * dpr);
      offscreenCtx = offscreenCanvas.getContext('2d');
      offscreenCtx.scale(dpr, dpr);

      renderStaticPcb(offscreenCtx, w, h, chips);
    }

    // Render the static circuit board layers (runs once per resize)
    function renderStaticPcb(ctx, w, h, chips) {
      ctx.clearRect(0, 0, w, h);

      // Subtle background dot matrix / PCB ground plane vias
      ctx.fillStyle = 'rgba(51, 65, 85, 0.12)';
      const dotStep = 32;
      for (let x = 16; x < w; x += dotStep) {
        for (let y = 16; y < h; y += dotStep) {
          ctx.beginPath();
          ctx.arc(x, y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 1. Draw all copper traces
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.55)'; // slate-800
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      paths.forEach((path) => {
        ctx.beginPath();
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
      });

      // 2. Draw Vias (annular rings with center drill hole) at trace endpoints & vertices
      paths.forEach((path) => {
        // Start and end vias
        [path.points[0], path.points[path.points.length - 1]].forEach((pt) => {
          // Copper outer ring
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(51, 65, 85, 0.7)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.4)';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Drill hole center
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#020617'; // slate-950
          ctx.fill();
        });
      });

      // 3. Draw IC Chip Packages & Footprints
      chips.forEach((chip) => {
        const { x, y, w: cw, h: ch, name } = chip;
        const left = x - cw / 2;
        const top = y - ch / 2;

        // Draw IC solder pins around the perimeter
        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        const pinLen = 6;
        const pinPitch = 8;

        // Top & bottom pins
        for (let px = left + 10; px <= left + cw - 10; px += pinPitch) {
          ctx.fillRect(px - 1, top - pinLen, 2.5, pinLen);
          ctx.fillRect(px - 1, top + ch, 2.5, pinLen);
        }
        // Left & right pins
        for (let py = top + 10; py <= top + ch - 10; py += pinPitch) {
          ctx.fillRect(left - pinLen, py - 1, pinLen, 2.5);
          ctx.fillRect(left + cw, py - 1, pinLen, 2.5);
        }

        // Chip main package body
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'; // slate-900/90
        ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)'; // slate-700
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(left, top, cw, ch, 4);
        ctx.fill();
        ctx.stroke();

        // Pin 1 orientation notch
        ctx.beginPath();
        ctx.arc(left + 8, top + 8, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(100, 116, 139, 0.6)';
        ctx.fill();

        // Silkscreen text on chip
        ctx.font = '700 8px monospace';
        ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, x, y);
      });

      // 4. Silkscreen Labels & Test Point Markers
      const silkscreenLabels = ['+3V3', 'GND', 'TXD', 'RXD', 'CLK', 'MOSI', 'MISO', 'D+', 'D-', 'VBUS', 'RF_IN', 'ANT1'];
      ctx.font = '600 7px monospace';
      ctx.fillStyle = 'rgba(71, 85, 105, 0.4)';
      ctx.textAlign = 'left';

      paths.slice(0, 16).forEach((p, idx) => {
        const pt = p.points[0];
        const label = silkscreenLabels[idx % silkscreenLabels.length];
        ctx.fillText(label, pt.x + 6, pt.y - 4);
      });
    }

    // Resize handler
    function handleResize() {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(300, Math.floor(rect.width));
      height = Math.max(300, Math.floor(rect.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      buildCircuitLayout(width, height);
    }

    handleResize();
    window.addEventListener('resize', handleResize);

    // Visibility change handler (pauses requestAnimationFrame on tab blur)
    function handleVisibility() {
      isTabVisible = !document.hidden;
      if (isTabVisible && !animId) {
        lastTime = performance.now();
        animId = requestAnimationFrame(loop);
      }
    }
    document.addEventListener('visibilitychange', handleVisibility);

    // Animation Loop
    let lastTime = performance.now();

    function loop(now) {
      if (!isTabVisible) {
        animId = null;
        return;
      }

      const dt = Math.min(50, now - lastTime);
      lastTime = now;

      // 1. Draw cached static circuit layer
      ctx.clearRect(0, 0, width, height);
      if (offscreenCanvas) {
        ctx.drawImage(offscreenCanvas, 0, 0, width, height);
      }

      // 2. Animate and draw active light pulses
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      pulses.forEach((pulse) => {
        const path = paths[pulse.pathIndex];
        if (!path) return;

        // Advance pulse along path
        pulse.progress += pulse.speed * dt;

        // If pulse reached end of trace, emit a via flash and recycle
        if (pulse.progress > path.totalLength) {
          const endPt = path.points[path.points.length - 1];
          bursts.push({
            x: endPt.x,
            y: endPt.y,
            radius: 2,
            maxRadius: 10,
            palette: pulse.palette,
            alpha: 1,
          });

          // Reset pulse on another path or same path
          pulse.pathIndex = Math.floor(Math.random() * paths.length);
          pulse.progress = 0;
          pulse.speed = 0.12 + Math.random() * 0.18;
          pulse.palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
          return;
        }

        const headPt = getPointAtDistance(path, pulse.progress);
        const tailDist = Math.max(0, pulse.progress - pulse.length);
        const tailPt = getPointAtDistance(path, tailDist);

        // Draw glowing comet trail
        const grad = ctx.createLinearGradient(tailPt.x, tailPt.y, headPt.x, headPt.y);
        grad.addColorStop(0, `rgba(${pulse.palette.rgb}, 0)`);
        grad.addColorStop(0.7, `rgba(${pulse.palette.rgb}, 0.4)`);
        grad.addColorStop(1, pulse.palette.head);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(tailPt.x, tailPt.y);
        ctx.lineTo(headPt.x, headPt.y);
        ctx.stroke();

        // Draw glowing pulse head
        ctx.beginPath();
        ctx.arc(headPt.x, headPt.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = pulse.palette.glow;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0; // Reset
      });

      // 3. Draw active via contact bursts
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.radius += 0.35 * (dt / 16);
        b.alpha -= 0.04 * (dt / 16);

        if (b.alpha <= 0 || b.radius >= b.maxRadius) {
          bursts.splice(i, 1);
          continue;
        }

        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${b.palette.rgb}, ${Math.max(0, b.alpha)})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      animId = requestAnimationFrame(loop);
    }

    animId = requestAnimationFrame(loop);

    return () => {
      if (animId) cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="circuit-board-background"
      aria-hidden="true"
      className={`absolute inset-0 pointer-events-none w-full h-full opacity-60 transition-opacity duration-700 ${className}`}
    />
  );
}
