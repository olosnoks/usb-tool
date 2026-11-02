import React, { useEffect, useRef } from 'react';

// Static PCB circuit board layout: renders authentic octilinear (45-degree chamfered) traces,
// IC packages, bus ribbons, annular ring vias, and silkscreen labels once on mount/resize.
// Completely static (0% CPU/GPU overhead, no animation loops) to ensure maximum UI fluidity.
export default function CircuitBoardBackground({ className = '' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let resizeTimer = null;

    function renderStaticCircuit() {
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(300, Math.floor(rect.width));
      const h = Math.max(300, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);

      ctx.clearRect(0, 0, w, h);

      const GRID = 24;
      const snap = (v) => Math.round(v / GRID) * GRID;

      // 1. Subtle background ground-plane dot grid
      ctx.fillStyle = 'rgba(51, 65, 85, 0.15)'; // slate-700
      const dotStep = 32;
      for (let x = 16; x < w; x += dotStep) {
        for (let y = 16; y < h; y += dotStep) {
          ctx.beginPath();
          ctx.arc(x, y, 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 2. Define IC Chip Packages
      const chips = [
        { x: snap(w * 0.18), y: snap(h * 0.28), w: 120, h: 80, name: 'MCU_SOC' },
        { x: snap(w * 0.78), y: snap(h * 0.32), w: 96, h: 96, name: 'FPGA_PHY' },
        { x: snap(w * 0.45), y: snap(h * 0.75), w: 140, h: 72, name: 'RADIO_BASEBAND' },
      ];

      if (w > 1200 && h > 700) {
        chips.push({ x: snap(w * 0.75), y: snap(h * 0.80), w: 80, h: 60, name: 'FLASH_EEPROM' });
      }

      // Collect all trace paths
      const allPaths = [];

      // Helper: Generate parallel Bus Ribbons
      function addBus(startX, startY, dirX, dirY, count, spacing, len1, bendDir, len2) {
        for (let i = 0; i < count; i++) {
          const offset = (i - (count - 1) / 2) * spacing;
          const p1 = { x: startX + (dirY !== 0 ? offset : 0), y: startY + (dirX !== 0 ? offset : 0) };
          let p2, p3, p4;
          const bendDist = 36;

          if (dirX !== 0) {
            p2 = { x: p1.x + dirX * len1, y: p1.y };
            p3 = { x: p2.x + dirX * bendDist, y: p2.y + bendDir * bendDist };
            p4 = { x: p3.x + dirX * (len2 || 80), y: p3.y };
          } else {
            p2 = { x: p1.x, y: p1.y + dirY * len1 };
            p3 = { x: p2.x + bendDir * bendDist, y: p2.y + dirY * bendDist };
            p4 = { x: p3.x, y: p3.y + dirY * (len2 || 80) };
          }

          allPaths.push({ pts: [p1, p2, p3, p4], isBus: true });
        }
      }

      // Generate major bus interconnects
      addBus(chips[0].x + chips[0].w / 2, chips[0].y, 1, 0, 4, 10, snap(w * 0.15), 1, snap(w * 0.16));
      addBus(chips[0].x, chips[0].y + chips[0].h / 2, 0, 1, 3, 12, snap(h * 0.16), 1, snap(h * 0.12));
      addBus(chips[1].x, chips[1].y, -1, 0, 4, 10, snap(w * 0.14), -1, snap(w * 0.12));
      addBus(chips[2].x + chips[2].w / 2, chips[2].y, 1, 0, 4, 10, snap(w * 0.12), -1, snap(w * 0.15));

      // Procedural single traces across the board
      const traceCount = Math.min(50, Math.floor((w * h) / 22000));
      for (let i = 0; i < traceCount; i++) {
        let curX = snap(Math.random() * (w - 120) + 60);
        let curY = snap(Math.random() * (h - 120) + 60);
        const pts = [{ x: curX, y: curY }];
        let isHoriz = Math.random() > 0.5;

        for (let s = 0; s < 3; s++) {
          const dist = snap(Math.random() * 110 + 40);
          if (isHoriz) {
            curX += (Math.random() > 0.5 ? 1 : -1) * dist;
          } else {
            curY += (Math.random() > 0.5 ? 1 : -1) * dist;
          }
          curX = Math.max(30, Math.min(w - 30, curX));
          curY = Math.max(30, Math.min(h - 30, curY));
          pts.push({ x: curX, y: curY });

          // 45-degree chamfer bend
          const chamfer = snap(28);
          const dx = (Math.random() > 0.5 ? 1 : -1) * chamfer;
          const dy = (Math.random() > 0.5 ? 1 : -1) * chamfer;
          curX = Math.max(30, Math.min(w - 30, curX + dx));
          curY = Math.max(30, Math.min(h - 30, curY + dy));
          pts.push({ x: curX, y: curY });

          isHoriz = !isHoriz;
        }

        allPaths.push({ pts, isBus: false, accent: i % 7 === 0 ? 'cyan' : i % 11 === 0 ? 'emerald' : null });
      }

      // 3. Draw Copper Traces
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      allPaths.forEach((path) => {
        ctx.beginPath();
        ctx.moveTo(path.pts[0].x, path.pts[0].y);
        for (let i = 1; i < path.pts.length; i++) {
          ctx.lineTo(path.pts[i].x, path.pts[i].y);
        }

        if (path.accent === 'cyan') {
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)'; // subtle cyan accent
          ctx.lineWidth = 1.6;
        } else if (path.accent === 'emerald') {
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)'; // subtle emerald accent
          ctx.lineWidth = 1.6;
        } else {
          ctx.strokeStyle = 'rgba(30, 41, 59, 0.65)'; // slate-800
          ctx.lineWidth = 1.4;
        }
        ctx.stroke();
      });

      // 4. Draw Vias (annular rings with center drill hole) at endpoints
      allPaths.forEach((path) => {
        [path.pts[0], path.pts[path.pts.length - 1]].forEach((pt) => {
          // Copper outer ring
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = path.accent === 'cyan' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(51, 65, 85, 0.7)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.5)';
          ctx.lineWidth = 0.9;
          ctx.stroke();

          // Center drill hole
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#020617';
          ctx.fill();
        });
      });

      // 5. Draw IC Chip Packages & Footprints
      chips.forEach((chip) => {
        const { x, y, w: cw, h: ch, name } = chip;
        const left = x - cw / 2;
        const top = y - ch / 2;

        // Draw IC solder pins around perimeter
        ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
        const pinLen = 5;
        const pinPitch = 8;

        for (let px = left + 10; px <= left + cw - 10; px += pinPitch) {
          ctx.fillRect(px - 1, top - pinLen, 2.5, pinLen);
          ctx.fillRect(px - 1, top + ch, 2.5, pinLen);
        }
        for (let py = top + 10; py <= top + ch - 10; py += pinPitch) {
          ctx.fillRect(left - pinLen, py - 1, pinLen, 2.5);
          ctx.fillRect(left + cw, py - 1, pinLen, 2.5);
        }

        // Chip main package body
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)'; // slate-900
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

      // 6. Silkscreen Labels
      const silkscreenLabels = ['+3V3', 'GND', 'TXD', 'RXD', 'CLK', 'MOSI', 'MISO', 'D+', 'D-', 'VBUS', 'RF_IN', 'ANT1'];
      ctx.font = '600 7px monospace';
      ctx.fillStyle = 'rgba(71, 85, 105, 0.45)';
      ctx.textAlign = 'left';

      allPaths.slice(0, 16).forEach((p, idx) => {
        const pt = p.pts[0];
        const label = silkscreenLabels[idx % silkscreenLabels.length];
        ctx.fillText(label, pt.x + 6, pt.y - 4);
      });
    }

    renderStaticCircuit();

    // Debounced resize so window resizing doesn't repeatedly re-render
    function onResize() {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(renderStaticCircuit, 150);
    }

    window.addEventListener('resize', onResize);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      data-testid="circuit-board-background"
      aria-hidden="true"
      className={`absolute inset-0 pointer-events-none w-full h-full opacity-40 ${className}`}
    />
  );
}
