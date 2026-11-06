/**
 * SVG Path & Shape Parser for Wardriving Map Art
 * Extracts vector line strokes from SVG markup and normalizes coordinates.
 */

/**
 * Tokenize an SVG path 'd' attribute string into command letters and numerical coordinates.
 */
export function tokenizeSvgPath(d) {
  if (!d || typeof d !== 'string') return [];
  const tokens = [];
  const re = /([a-df-z])|([-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?)/gi;
  let match;
  while ((match = re.exec(d)) !== null) {
    if (match[1]) {
      tokens.push(match[1]);
    } else if (match[2] !== undefined) {
      tokens.push(parseFloat(match[2]));
    }
  }
  return tokens;
}

/**
 * Sample points along a cubic Bezier curve.
 */
function sampleCubicBezier(p0, p1, p2, p3, steps = 10) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    const x = uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0];
    const y = uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Sample points along a quadratic Bezier curve.
 */
function sampleQuadraticBezier(p0, p1, p2, steps = 8) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;

    const x = uu * p0[0] + 2 * u * t * p1[0] + tt * p2[0];
    const y = uu * p0[1] + 2 * u * t * p1[1] + tt * p2[1];
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Linearize / sample an SVG elliptical arc segment into polyline points.
 */
function sampleArc(x0, y0, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, x1, y1, steps = 12) {
  // Degenerate arc -> straight line
  if (rx === 0 || ry === 0 || (x0 === x1 && y0 === y1)) {
    return [[x1, y1]];
  }

  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Compute (x0', y0')
  const dx = (x0 - x1) / 2;
  const dy = (y0 - y1) / 2;
  const x0p = cosPhi * dx + sinPhi * dy;
  const y0p = -sinPhi * dx + cosPhi * dy;

  let cr = (x0p * x0p) / (rx * rx) + (y0p * y0p) / (ry * ry);
  if (cr > 1) {
    const s = Math.sqrt(cr);
    rx *= s;
    ry *= s;
  }

  // Center (cx', cy')
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const num = Math.max(0, rx * rx * ry * ry - rx * rx * y0p * y0p - ry * ry * x0p * x0p);
  const den = rx * rx * y0p * y0p + ry * ry * x0p * x0p;
  const coef = sign * (den > 0 ? Math.sqrt(num / den) : 0);
  const cxp = coef * ((rx * y0p) / ry);
  const cyp = coef * (-(ry * x0p) / rx);

  // Transform center back
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) / 2;

  // Angles theta1 and dTheta
  const v1x = (x0p - cxp) / rx;
  const v1y = (y0p - cyp) / ry;
  const v2x = (-x0p - cxp) / rx;
  const v2y = (-y0p - cyp) / ry;

  const theta1 = Math.atan2(v1y, v1x);
  let dTheta = Math.atan2(v2y, v2x) - theta1;

  if (sweepFlag && dTheta < 0) dTheta += 2 * Math.PI;
  if (!sweepFlag && dTheta > 0) dTheta -= 2 * Math.PI;

  const pts = [];
  const numSteps = Math.max(4, steps);
  for (let i = 1; i <= numSteps; i++) {
    const t = i / numSteps;
    const th = theta1 + t * dTheta;
    const cosTh = Math.cos(th);
    const sinTh = Math.sin(th);
    const xp = rx * cosTh;
    const yp = ry * sinTh;
    const x = cosPhi * xp - sinPhi * yp + cx;
    const y = sinPhi * xp + cosPhi * yp + cy;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * Parse an SVG path 'd' attribute string into a list of polyline strokes.
 * Each stroke is an array of [x, y] coordinates.
 */
export function parseSvgPathToStrokes(d) {
  const tokens = tokenizeSvgPath(d);
  if (tokens.length === 0) return [];

  const strokes = [];
  let currentStroke = [];
  let penX = 0;
  let penY = 0;
  let startX = 0;
  let startY = 0;
  let lastCtrlX = 0;
  let lastCtrlY = 0;
  let lastCmd = '';

  let i = 0;
  let currentCmd = '';

  while (i < tokens.length) {
    const tok = tokens[i];
    if (typeof tok === 'string') {
      currentCmd = tok;
      i++;
    } else if (!currentCmd) {
      i++;
      continue;
    }

    const isRel = currentCmd === currentCmd.toLowerCase();
    const cmdUpper = currentCmd.toUpperCase();

    switch (cmdUpper) {
      case 'M': {
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];
        if (currentStroke.length > 1) {
          strokes.push(currentStroke);
        }
        currentStroke = [[x, y]];
        penX = x;
        penY = y;
        startX = x;
        startY = y;
        lastCtrlX = x;
        lastCtrlY = y;
        // Subsequent numbers after M/m are treated as L/l
        currentCmd = isRel ? 'l' : 'L';
        break;
      }

      case 'L': {
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];
        currentStroke.push([x, y]);
        penX = x;
        penY = y;
        lastCtrlX = x;
        lastCtrlY = y;
        break;
      }

      case 'H': {
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        currentStroke.push([x, penY]);
        penX = x;
        lastCtrlX = x;
        lastCtrlY = penY;
        break;
      }

      case 'V': {
        const y = isRel ? penY + tokens[i++] : tokens[i++];
        currentStroke.push([penX, y]);
        penY = y;
        lastCtrlX = penX;
        lastCtrlY = y;
        break;
      }

      case 'C': {
        const x1 = isRel ? penX + tokens[i++] : tokens[i++];
        const y1 = isRel ? penY + tokens[i++] : tokens[i++];
        const x2 = isRel ? penX + tokens[i++] : tokens[i++];
        const y2 = isRel ? penY + tokens[i++] : tokens[i++];
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];

        const curvePts = sampleCubicBezier([penX, penY], [x1, y1], [x2, y2], [x, y], 10);
        currentStroke.push(...curvePts);

        lastCtrlX = x2;
        lastCtrlY = y2;
        penX = x;
        penY = y;
        break;
      }

      case 'S': {
        // Smooth cubic: first control point is reflection of previous control point
        let x1 = penX;
        let y1 = penY;
        if (lastCmd === 'C' || lastCmd === 'S' || lastCmd === 'c' || lastCmd === 's') {
          x1 = 2 * penX - lastCtrlX;
          y1 = 2 * penY - lastCtrlY;
        }
        const x2 = isRel ? penX + tokens[i++] : tokens[i++];
        const y2 = isRel ? penY + tokens[i++] : tokens[i++];
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];

        const curvePts = sampleCubicBezier([penX, penY], [x1, y1], [x2, y2], [x, y], 10);
        currentStroke.push(...curvePts);

        lastCtrlX = x2;
        lastCtrlY = y2;
        penX = x;
        penY = y;
        break;
      }

      case 'Q': {
        const x1 = isRel ? penX + tokens[i++] : tokens[i++];
        const y1 = isRel ? penY + tokens[i++] : tokens[i++];
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];

        const curvePts = sampleQuadraticBezier([penX, penY], [x1, y1], [x, y], 8);
        currentStroke.push(...curvePts);

        lastCtrlX = x1;
        lastCtrlY = y1;
        penX = x;
        penY = y;
        break;
      }

      case 'T': {
        let x1 = penX;
        let y1 = penY;
        if (lastCmd === 'Q' || lastCmd === 'T' || lastCmd === 'q' || lastCmd === 't') {
          x1 = 2 * penX - lastCtrlX;
          y1 = 2 * penY - lastCtrlY;
        }
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];

        const curvePts = sampleQuadraticBezier([penX, penY], [x1, y1], [x, y], 8);
        currentStroke.push(...curvePts);

        lastCtrlX = x1;
        lastCtrlY = y1;
        penX = x;
        penY = y;
        break;
      }

      case 'A': {
        const rx = tokens[i++];
        const ry = tokens[i++];
        const rot = tokens[i++];
        const largeArc = tokens[i++];
        const sweep = tokens[i++];
        const x = isRel ? penX + tokens[i++] : tokens[i++];
        const y = isRel ? penY + tokens[i++] : tokens[i++];

        const arcPts = sampleArc(penX, penY, rx, ry, rot, largeArc, sweep, x, y, 12);
        currentStroke.push(...arcPts);

        lastCtrlX = x;
        lastCtrlY = y;
        penX = x;
        penY = y;
        break;
      }

      case 'Z': {
        if (currentStroke.length > 0) {
          currentStroke.push([startX, startY]);
        }
        penX = startX;
        penY = startY;
        lastCtrlX = startX;
        lastCtrlY = startY;
        if (currentStroke.length > 1) {
          strokes.push(currentStroke);
          currentStroke = [];
        }
        break;
      }

      default:
        // Skip unknown command
        i++;
        break;
    }
    lastCmd = currentCmd;
  }

  if (currentStroke.length > 1) {
    strokes.push(currentStroke);
  }

  return strokes;
}

/**
 * Parse an SVG XML string and extract all vector strokes from shapes:
 * <path>, <polyline>, <polygon>, <line>, <rect>, <circle>, <ellipse>.
 */
export function extractAllSvgStrokes(svgString) {
  if (!svgString || typeof svgString !== 'string') return [];
  const strokes = [];

  // Parse using DOMParser when available (in browser)
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgString, 'image/svg+xml');

      // 1. Paths
      const pathEls = doc.querySelectorAll('path');
      pathEls.forEach((p) => {
        const d = p.getAttribute('d');
        if (d) strokes.push(...parseSvgPathToStrokes(d));
      });

      // 2. Polylines
      const polylineEls = doc.querySelectorAll('polyline');
      polylineEls.forEach((pl) => {
        const ptsAttr = pl.getAttribute('points');
        if (ptsAttr) {
          const nums = ptsAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
          const line = [];
          for (let i = 0; i < nums.length - 1; i += 2) {
            line.push([nums[i], nums[i + 1]]);
          }
          if (line.length > 1) strokes.push(line);
        }
      });

      // 3. Polygons
      const polygonEls = doc.querySelectorAll('polygon');
      polygonEls.forEach((pg) => {
        const ptsAttr = pg.getAttribute('points');
        if (ptsAttr) {
          const nums = ptsAttr.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
          const line = [];
          for (let i = 0; i < nums.length - 1; i += 2) {
            line.push([nums[i], nums[i + 1]]);
          }
          if (line.length > 1) {
            line.push([...line[0]]); // Close polygon
            strokes.push(line);
          }
        }
      });

      // 4. Lines
      const lineEls = doc.querySelectorAll('line');
      lineEls.forEach((l) => {
        const x1 = parseFloat(l.getAttribute('x1') || '0');
        const y1 = parseFloat(l.getAttribute('y1') || '0');
        const x2 = parseFloat(l.getAttribute('x2') || '0');
        const y2 = parseFloat(l.getAttribute('y2') || '0');
        strokes.push([[x1, y1], [x2, y2]]);
      });

      // 5. Rectangles
      const rectEls = doc.querySelectorAll('rect');
      rectEls.forEach((r) => {
        const x = parseFloat(r.getAttribute('x') || '0');
        const y = parseFloat(r.getAttribute('y') || '0');
        const w = parseFloat(r.getAttribute('width') || '0');
        const h = parseFloat(r.getAttribute('height') || '0');
        if (w > 0 && h > 0) {
          strokes.push([
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
            [x, y]
          ]);
        }
      });

      // 6. Circles
      const circleEls = doc.querySelectorAll('circle');
      circleEls.forEach((c) => {
        const cx = parseFloat(c.getAttribute('cx') || '0');
        const cy = parseFloat(c.getAttribute('cy') || '0');
        const r = parseFloat(c.getAttribute('r') || '0');
        if (r > 0) {
          const circlePts = [];
          const steps = 32;
          for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * 2 * Math.PI;
            circlePts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
          }
          strokes.push(circlePts);
        }
      });

      if (strokes.length > 0) return strokes;
    } catch (e) {
      // Fallback to regex
    }
  }

  // Regex fallback (for non-DOM or test environments)
  const pathRegex = /<path[^>]*\bd=["']([^"']+)["']/gi;
  let m;
  while ((m = pathRegex.exec(svgString)) !== null) {
    strokes.push(...parseSvgPathToStrokes(m[1]));
  }

  const polylineRegex = /<polyline[^>]*\bpoints=["']([^"']+)["']/gi;
  while ((m = polylineRegex.exec(svgString)) !== null) {
    const nums = m[1].trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    const line = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      line.push([nums[i], nums[i + 1]]);
    }
    if (line.length > 1) strokes.push(line);
  }

  const polygonRegex = /<polygon[^>]*\bpoints=["']([^"']+)["']/gi;
  while ((m = polygonRegex.exec(svgString)) !== null) {
    const nums = m[1].trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    const line = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      line.push([nums[i], nums[i + 1]]);
    }
    if (line.length > 1) {
      line.push([...line[0]]);
      strokes.push(line);
    }
  }

  const lineRegex = /<line\b([^>]*)\/?>/gi;
  while ((m = lineRegex.exec(svgString)) !== null) {
    const attrs = m[1];
    const x1 = parseFloat(attrs.match(/\bx1=["']([^"']+)["']/i)?.[1] || '0');
    const y1 = parseFloat(attrs.match(/\by1=["']([^"']+)["']/i)?.[1] || '0');
    const x2 = parseFloat(attrs.match(/\bx2=["']([^"']+)["']/i)?.[1] || '0');
    const y2 = parseFloat(attrs.match(/\by2=["']([^"']+)["']/i)?.[1] || '0');
    strokes.push([[x1, y1], [x2, y2]]);
  }

  const rectRegex = /<rect\b([^>]*)\/?>/gi;
  while ((m = rectRegex.exec(svgString)) !== null) {
    const attrs = m[1];
    const x = parseFloat(attrs.match(/\bx=["']([^"']+)["']/i)?.[1] || '0');
    const y = parseFloat(attrs.match(/\by=["']([^"']+)["']/i)?.[1] || '0');
    const w = parseFloat(attrs.match(/\bwidth=["']([^"']+)["']/i)?.[1] || '0');
    const h = parseFloat(attrs.match(/\bheight=["']([^"']+)["']/i)?.[1] || '0');
    if (w > 0 && h > 0) {
      strokes.push([
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
        [x, y]
      ]);
    }
  }

  const circleRegex = /<circle\b([^>]*)\/?>/gi;
  while ((m = circleRegex.exec(svgString)) !== null) {
    const attrs = m[1];
    const cx = parseFloat(attrs.match(/\bcx=["']([^"']+)["']/i)?.[1] || '0');
    const cy = parseFloat(attrs.match(/\bcy=["']([^"']+)["']/i)?.[1] || '0');
    const r = parseFloat(attrs.match(/\br=["']([^"']+)["']/i)?.[1] || '0');
    if (r > 0) {
      const circlePts = [];
      const steps = 32;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        circlePts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
      }
      strokes.push(circlePts);
    }
  }

  return strokes;
}

/**
 * Parse an SVG XML string, extract all strokes, and normalize coordinates:
 * - Computes the bounding box [minX, minY, maxX, maxY].
 * - Preserves aspect ratio with X normalized to [0, 1.0] and Y scaled proportionally.
 * Returns { strokes, originalBounds, aspectRatio, width, height }
 */
export function parseSvgToNormalizedStrokes(svgString) {
  const rawStrokes = extractAllSvgStrokes(svgString);
  if (!rawStrokes || rawStrokes.length === 0) {
    return {
      strokes: [],
      originalBounds: null,
      aspectRatio: 1.0,
      width: 0,
      height: 0
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const stroke of rawStrokes) {
    for (const pt of stroke) {
      if (pt[0] < minX) minX = pt[0];
      if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1];
      if (pt[1] > maxY) maxY = pt[1];
    }
  }

  const spanX = maxX - minX;
  const spanY = maxY - minY;

  if (spanX <= 0 || spanY <= 0) {
    return {
      strokes: [],
      originalBounds: null,
      aspectRatio: 1.0,
      width: 0,
      height: 0
    };
  }

  const normBase = Math.max(spanX, spanY);
  const aspectRatio = spanY / spanX;

  const normalizedStrokes = rawStrokes.map((stroke) =>
    stroke.map(([x, y]) => [
      (x - minX) / normBase,
      (y - minY) / normBase
    ])
  );

  return {
    strokes: normalizedStrokes,
    originalBounds: { minX, minY, maxX, maxY },
    aspectRatio,
    width: spanX / normBase,
    height: spanY / normBase
  };
}

/**
 * Premade SVG Presets (cleared - user uploads or pastes custom SVGs).
 */
export const SVG_PRESETS = [];
