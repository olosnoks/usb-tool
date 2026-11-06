/**
 * Wardrive Demo & Map Art Data Generator
 * Generates synthetic Wi-Fi Access Point trails forming readable vector text or SVG images
 * on geolocation maps (Kepler.gl / WiGLE).
 */

export {
  parseSvgToNormalizedStrokes,
  parseSvgPathToStrokes,
  extractAllSvgStrokes,
  SVG_PRESETS
} from './svgPathParser.js';

export const VECTOR_FONTS = {
  "A": [
    [[0.0, 1.0], [0.5, 0.0], [1.0, 1.0]],
    [[0.2, 0.6], [0.8, 0.6]]
  ],
  "B": [
    [[0.0, 0.0], [0.0, 1.0]],
    [[0.0, 0.0], [0.7, 0.0], [1.0, 0.25], [0.7, 0.5], [0.0, 0.5]],
    [[0.0, 0.5], [0.7, 0.5], [1.0, 0.75], [0.7, 1.0], [0.0, 1.0]]
  ],
  "C": [
    [[1.0, 0.1], [0.7, 0.0], [0.0, 0.2], [0.0, 0.8], [0.7, 1.0], [1.0, 0.9]]
  ],
  "D": [
    [[0.0, 0.0], [0.0, 1.0]],
    [[0.0, 0.0], [0.6, 0.0], [1.0, 0.3], [1.0, 0.7], [0.6, 1.0], [0.0, 1.0]]
  ],
  "E": [
    [[1.0, 0.0], [0.0, 0.0], [0.0, 1.0], [1.0, 1.0]],
    [[0.0, 0.5], [0.7, 0.5]]
  ],
  "F": [
    [[1.0, 0.0], [0.0, 0.0], [0.0, 1.0]],
    [[0.0, 0.5], [0.7, 0.5]]
  ],
  "G": [
    [[1.0, 0.2], [0.7, 0.0], [0.0, 0.2], [0.0, 0.8], [0.7, 1.0], [1.0, 0.8], [1.0, 0.5], [0.5, 0.5]]
  ],
  "H": [
    [[0.0, 0.0], [0.0, 1.0]],
    [[1.0, 0.0], [1.0, 1.0]],
    [[0.0, 0.5], [1.0, 0.5]]
  ],
  "I": [
    [[0.2, 0.0], [0.8, 0.0]],
    [[0.5, 0.0], [0.5, 1.0]],
    [[0.2, 1.0], [0.8, 1.0]]
  ],
  "J": [
    [[0.2, 0.0], [0.8, 0.0]],
    [[0.6, 0.0], [0.6, 0.8], [0.4, 1.0], [0.0, 0.8]]
  ],
  "K": [
    [[0.0, 0.0], [0.0, 1.0]],
    [[1.0, 0.0], [0.0, 0.5]],
    [[0.0, 0.5], [1.0, 1.0]]
  ],
  "L": [
    [[0.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
  ],
  "M": [
    [[0.0, 1.0], [0.0, 0.0], [0.5, 0.6], [1.0, 0.0], [1.0, 1.0]]
  ],
  "N": [
    [[0.0, 1.0], [0.0, 0.0], [1.0, 1.0], [1.0, 0.0]]
  ],
  "O": [
    [[0.3, 0.0], [0.7, 0.0], [1.0, 0.3], [1.0, 0.7], [0.7, 1.0], [0.3, 1.0], [0.0, 0.7], [0.0, 0.3], [0.3, 0.0]]
  ],
  "P": [
    [[0.0, 1.0], [0.0, 0.0], [0.7, 0.0], [1.0, 0.25], [0.7, 0.5], [0.0, 0.5]]
  ],
  "Q": [
    [[0.3, 0.0], [0.7, 0.0], [1.0, 0.3], [1.0, 0.7], [0.7, 1.0], [0.3, 1.0], [0.0, 0.7], [0.0, 0.3], [0.3, 0.0]],
    [[0.6, 0.6], [1.0, 1.0]]
  ],
  "R": [
    [[0.0, 1.0], [0.0, 0.0], [0.7, 0.0], [1.0, 0.25], [0.7, 0.5], [0.0, 0.5]],
    [[0.4, 0.5], [1.0, 1.0]]
  ],
  "S": [
    [[1.0, 0.1], [0.7, 0.0], [0.0, 0.2], [1.0, 0.8], [0.3, 1.0], [0.0, 0.9]]
  ],
  "T": [
    [[0.0, 0.0], [1.0, 0.0]],
    [[0.5, 0.0], [0.5, 1.0]]
  ],
  "U": [
    [[0.0, 0.0], [0.0, 0.8], [0.5, 1.0], [1.0, 0.8], [1.0, 0.0]]
  ],
  "V": [
    [[0.0, 0.0], [0.5, 1.0], [1.0, 0.0]]
  ],
  "W": [
    [[0.0, 0.0], [0.2, 1.0], [0.5, 0.5], [0.8, 1.0], [1.0, 0.0]]
  ],
  "X": [
    [[0.0, 0.0], [1.0, 1.0]],
    [[1.0, 0.0], [0.0, 1.0]]
  ],
  "Y": [
    [[0.0, 0.0], [0.5, 0.5], [1.0, 0.0]],
    [[0.5, 0.5], [0.5, 1.0]]
  ],
  "Z": [
    [[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]]
  ],
  "0": [
    [[0.3, 0.0], [0.7, 0.0], [1.0, 0.3], [1.0, 0.7], [0.7, 1.0], [0.3, 1.0], [0.0, 0.7], [0.0, 0.3], [0.3, 0.0]]
  ],
  "1": [
    [[0.3, 0.3], [0.5, 0.0], [0.5, 1.0]],
    [[0.2, 1.0], [0.8, 1.0]]
  ],
  "2": [
    [[0.0, 0.2], [0.5, 0.0], [1.0, 0.3], [0.0, 1.0], [1.0, 1.0]]
  ],
  "3": [
    [[0.0, 0.0], [1.0, 0.0], [0.5, 0.5], [1.0, 1.0], [0.0, 1.0]]
  ],
  "4": [
    [[0.8, 0.0], [0.0, 0.6], [1.0, 0.6]],
    [[0.8, 0.0], [0.8, 1.0]]
  ],
  "5": [
    [[1.0, 0.0], [0.0, 0.0], [0.0, 0.5], [1.0, 0.6], [1.0, 0.9], [0.0, 1.0]]
  ],
  "6": [
    [[1.0, 0.0], [0.0, 0.3], [0.0, 0.8], [0.7, 1.0], [1.0, 0.7], [0.0, 0.6]]
  ],
  "7": [
    [[0.0, 0.0], [1.0, 0.0], [0.3, 1.0]]
  ],
  "8": [
    [[0.3, 0.0], [0.7, 0.0], [1.0, 0.2], [0.0, 0.5], [1.0, 0.8], [0.7, 1.0], [0.3, 1.0], [0.0, 0.8], [1.0, 0.2], [0.0, 0.2], [0.3, 0.0]]
  ],
  "9": [
    [[1.0, 0.4], [0.0, 0.2], [0.0, 0.0], [0.7, 0.0], [1.0, 0.4], [1.0, 1.0], [0.0, 1.0]]
  ],
  "-": [
    [[0.1, 0.5], [0.9, 0.5]]
  ],
  "_": [
    [[0.0, 1.0], [1.0, 1.0]]
  ],
  "!": [
    [[0.5, 0.0], [0.5, 0.7]],
    [[0.5, 0.9], [0.5, 1.0]]
  ],
  " ": []
};

export const AUTH_MODES = [
  "[WPA2-PSK-CCMP][ESS]",
  "[RSN-SAE-CCMP][ESS]",
  "[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]",
  "[ESS]"
];

export const CHANNELS = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161];

/**
 * Creates a pseudo-random number generator.
 * If seed is a number, uses mulberry32 for deterministic generation; otherwise uses Math.random.
 */
export function createPrng(seed = 42) {
  if (seed === null || seed === undefined) {
    return {
      random: () => Math.random(),
      randrange: (n) => Math.floor(Math.random() * n),
      randint: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
      uniform: (min, max) => Math.random() * (max - min) + min,
      choice: (arr) => arr[Math.floor(Math.random() * arr.length)]
    };
  }

  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    random: next,
    randrange: (n) => Math.floor(next() * n),
    randint: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    uniform: (min, max) => next() * (max - min) + min,
    choice: (arr) => arr[Math.floor(next() * arr.length)]
  };
}

/**
 * Interpolate points smoothly along a straight line segment.
 * p1 and p2 are [lon, lat] coordinates.
 */
export function interpolateSegment(p1, p2, stepSize = 0.001) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) {
    return [p1];
  }
  const steps = Math.max(2, Math.floor(dist / stepSize));
  const segmentPts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = p1[0] + t * dx;
    const y = p1[1] + t * dy;
    segmentPts.push([x, y]);
  }
  return segmentPts;
}

/**
 * Format a Date object to YYYY-MM-DD HH:MM:SS
 */
export function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

/**
 * Format a Date object to HTML datetime-local format: YYYY-MM-DDTHH:mm
 */
export function dateToLocalDatetimeString(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

/**
 * Parse a datetime-local or ISO string into a valid local Date object.
 */
export function localDatetimeStringToDate(str) {
  if (!str) return new Date();
  const d = new Date(str);
  return isNaN(d.getTime()) ? new Date() : d;
}

/**
 * Generate synthetic Access Points tracing text along a vector font path.
 * Supports density in APs per km or APs per mile (with totals up to 500k+),
 * configurable letter dimensions & scale, vehicle speed, and custom start clock/date.
 */
export function generateDemoAps(options = {}) {
  const {
    text = 'KEPLER',
    mode = 'text',             // 'text' | 'svg'
    svgStrokes = null,         // Array of normalized strokes [[[x, y], ...], ...]
    latCenter = 32.25,
    lonCenter = -90.13,
    letterW = 0.04,
    letterH = 0.06,
    letterScale = 1.0,
    gap = 0.02,
    densityUnit = 'km',        // 'km' or 'mile'
    apsPerUnit = 100.0,        // APs per km or mile (e.g. 50, 500, 5000)
    targetApCount = null,      // Optional explicit total AP count override
    speedKmh = 50.0,
    stepSize = null,
    startTime = null,          // Custom start clock/date (Date, ISO string, or ms timestamp)
    endTime = null,
    seed = 42
  } = options;

  const isSvgMode = mode === 'svg' && Array.isArray(svgStrokes) && svgStrokes.length > 0;
  const cleanText = String(text || '').trim();

  if (!isSvgMode && !cleanText) {
    return { 
      aps: [], 
      masterPath: [], 
      bounds: null, 
      totalPathLengthKm: 0, 
      durationSeconds: 0,
      apsPerUnit: Number(apsPerUnit) || 100
    };
  }

  const effectiveScale = Number(letterScale) > 0 ? Number(letterScale) : 1.0;
  const effectiveLetterW = (Number(letterW) || 0.04) * effectiveScale;
  const effectiveLetterH = (Number(letterH) || 0.06) * effectiveScale;
  const effectiveGap = (Number(gap) || 0.02) * effectiveScale;

  // Local metric conversions at given latitude
  const latRad = (Number(latCenter) * Math.PI) / 180.0;
  const kmPerLonDeg = 111.0 * Math.cos(latRad);
  const kmPerLatDeg = 111.0;

  // Fine stroke interpolation step, scaled so huge letters calculate smoothly
  const effectiveStepSize = stepSize !== null && stepSize !== undefined
    ? Number(stepSize)
    : Math.max(0.0008, 0.0008 * Math.min(effectiveScale, 8.0));

  const masterPath = [];
  const x0 = Number(lonCenter);
  const y0 = Number(latCenter);

  if (isSvgMode) {
    // In SVG mode: normalized coordinates (0 to 1) are scaled across the geographic span
    const svgSpanLon = effectiveLetterW * 6.0;
    const svgSpanLat = effectiveLetterH * 4.0;

    for (const stroke of svgStrokes) {
      if (!stroke || stroke.length < 2) continue;
      const strokeLocalPath = [];
      for (let i = 0; i < stroke.length - 1; i++) {
        const p1 = stroke[i];
        const p2 = stroke[i + 1];

        const lon1 = x0 + p1[0] * svgSpanLon;
        const lat1 = y0 - p1[1] * svgSpanLat;
        const lon2 = x0 + p2[0] * svgSpanLon;
        const lat2 = y0 - p2[1] * svgSpanLat;

        const pts = interpolateSegment([lon1, lat1], [lon2, lat2], effectiveStepSize);
        if (strokeLocalPath.length > 0) {
          strokeLocalPath.push(...pts.slice(1));
        } else {
          strokeLocalPath.push(...pts);
        }
      }

      if (strokeLocalPath.length > 0) {
        if (masterPath.length > 0) {
          const endPt = masterPath[masterPath.length - 1];
          const startPt = strokeLocalPath[0];
          const bridgePts = interpolateSegment(endPt, startPt, effectiveStepSize);
          masterPath.push(...bridgePts.slice(1));
        }
        masterPath.push(...strokeLocalPath);
      }
    }
  } else {
    let currentX = x0;

    for (const ch of cleanText.toUpperCase()) {
      const strokes = VECTOR_FONTS[ch] || VECTOR_FONTS[" "];
      const letterLocalPath = [];

      for (const stroke of strokes) {
        for (let i = 0; i < stroke.length - 1; i++) {
          const p1Rel = stroke[i];
          const p2Rel = stroke[i + 1];

          const lon1 = currentX + p1Rel[0] * effectiveLetterW;
          const lat1 = y0 - p1Rel[1] * effectiveLetterH;
          const lon2 = currentX + p2Rel[0] * effectiveLetterW;
          const lat2 = y0 - p2Rel[1] * effectiveLetterH;

          const pts = interpolateSegment([lon1, lat1], [lon2, lat2], effectiveStepSize);
          if (letterLocalPath.length > 0) {
            letterLocalPath.push(...pts.slice(1));
          } else {
            letterLocalPath.push(...pts);
          }
        }
      }

      if (letterLocalPath.length > 0) {
        if (masterPath.length > 0) {
          const endPt = masterPath[masterPath.length - 1];
          const startPt = letterLocalPath[0];
          const bridgePts = interpolateSegment(endPt, startPt, effectiveStepSize);
          masterPath.push(...bridgePts.slice(1));
        }
        masterPath.push(...letterLocalPath);
      }

      currentX += effectiveLetterW + effectiveGap;
    }
  }

  const aps = [];
  if (masterPath.length === 0) {
    return { 
      aps, 
      masterPath, 
      bounds: null, 
      totalPathLengthKm: 0, 
      durationSeconds: 0,
      apsPerUnit: Number(apsPerUnit) || 100
    };
  }

  // Calculate total path distance in km
  let totalPathLengthKm = 0;
  for (let i = 0; i < masterPath.length - 1; i++) {
    const p1 = masterPath[i];
    const p2 = masterPath[i + 1];
    const dxKm = (p2[0] - p1[0]) * kmPerLonDeg;
    const dyKm = (p2[1] - p1[1]) * kmPerLatDeg;
    totalPathLengthKm += Math.sqrt(dxKm * dxKm + dyKm * dyKm);
  }

  // Determine step distance in km based on APs per km/mile
  const kmPerUnit = densityUnit === 'mile' ? 1.609344 : 1.0;
  const effectiveApsPerKm = (Number(apsPerUnit) || 100.0) / kmPerUnit;

  let stepDistKm;
  if (targetApCount && Number(targetApCount) > 1 && totalPathLengthKm > 0) {
    stepDistKm = totalPathLengthKm / Number(targetApCount);
  } else {
    stepDistKm = 1.0 / Math.max(0.0001, effectiveApsPerKm);
  }

  const effectiveSpeedKmh = Math.max(0.1, Number(speedKmh) || 50.0);
  const totalDriveSeconds = (totalPathLengthKm / effectiveSpeedKmh) * 3600.0;
  const expectedTotalAps = Math.max(1, Math.round(totalPathLengthKm / stepDistKm));
  const timeStepSeconds = totalDriveSeconds / expectedTotalAps;

  const baseEndTime = endTime instanceof Date ? new Date(endTime.getTime()) : (endTime ? new Date(endTime) : null);
  let currentTime;
  if (startTime) {
    const parsedStart = startTime instanceof Date ? new Date(startTime.getTime()) : new Date(startTime);
    currentTime = isNaN(parsedStart.getTime()) ? new Date(Date.now() - 24 * 3600 * 1000) : parsedStart;
  } else if (baseEndTime && !isNaN(baseEndTime.getTime())) {
    currentTime = new Date(baseEndTime.getTime() - totalDriveSeconds * 1000);
  } else {
    currentTime = new Date(Date.now() - 24 * 3600 * 1000);
  }

  const driveStartTime = new Date(currentTime.getTime());

  let pointCounter = 1;
  const rng = createPrng(seed);
  const seen = new Set();
  const ssidPrefix = (cleanText ? cleanText.replace(/\s+/g, '_') : 'SVG_ART').toUpperCase();

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  // Polyline walker using metric distance stepDistKm
  let currentSegmentIdx = 0;
  let currentPt = masterPath[0];
  let distanceToNextApKm = stepDistKm;

  while (currentSegmentIdx < masterPath.length - 1) {
    const nextVertex = masterPath[currentSegmentIdx + 1];
    const dxLon = nextVertex[0] - currentPt[0];
    const dyLat = nextVertex[1] - currentPt[1];
    const dxKm = dxLon * kmPerLonDeg;
    const dyKm = dyLat * kmPerLatDeg;
    const segDistKm = Math.sqrt(dxKm * dxKm + dyKm * dyKm);

    if (segDistKm === 0) {
      currentSegmentIdx++;
      currentPt = nextVertex;
      continue;
    }

    if (segDistKm < distanceToNextApKm) {
      currentPt = nextVertex;
      distanceToNextApKm -= segDistKm;
      currentSegmentIdx++;
    } else {
      const fraction = distanceToNextApKm / segDistKm;
      currentPt = [
        currentPt[0] + dxLon * fraction,
        currentPt[1] + dyLat * fraction
      ];
      distanceToNextApKm = stepDistKm;

      if (pointCounter > 1) {
        currentTime = new Date(currentTime.getTime() + timeStepSeconds * 1000);
      }

      // Generate globally unique, unicast MAC address
      const genMac = () => {
        let firstOctet = rng.randrange(256) & 0xFE; // Clear multicast bit
        firstOctet &= 0xFD;                        // Clear local/private bit
        const secondNibble = rng.choice([0, 4, 8, 12]);
        const firstHex = (((firstOctet & 0xF0) | secondNibble) >>> 0).toString(16).padStart(2, '0').toUpperCase();
        const rest = Array.from({ length: 5 }, () => rng.randrange(256).toString(16).padStart(2, '0').toUpperCase()).join(':');
        return `${firstHex}:${rest}`;
      };

      let mac = genMac();
      // Keep seen bounded to prevent memory blowup on 500k+ items
      if (seen.size > 200000) seen.clear();
      while (seen.has(mac)) {
        mac = genMac();
      }
      seen.add(mac);

      const latJitter = rng.uniform(-0.000001, 0.000001);
      const lonJitter = rng.uniform(-0.000001, 0.000001);
      const lat = Number((currentPt[1] + latJitter).toFixed(6));
      const lon = Number((currentPt[0] + lonJitter).toFixed(6));

      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;

      aps.push({
        mac,
        ssid: `${ssidPrefix}-${String(pointCounter).padStart(6, '0')}`,
        auth: rng.choice(AUTH_MODES),
        first_seen: formatTimestamp(currentTime),
        channel: rng.choice(CHANNELS),
        rssi: rng.randint(-90, -45),
        lat,
        lon,
        alt: 15,
        accuracy: Number(rng.uniform(3, 8).toFixed(1))
      });
      pointCounter += 1;
    }
  }

  const bounds = isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;

  return {
    aps,
    masterPath,
    bounds,
    totalPathLengthKm,
    durationSeconds: totalDriveSeconds,
    startTime: driveStartTime,
    endTime: new Date(currentTime.getTime()),
    apsPerUnit: Number(apsPerUnit) || 100,
    densityUnit
  };
}

/**
 * Generate standard WiGLE Wifi 1.4 CSV format.
 * High-performance chunked generation handles 500k+ rows easily.
 */
export function generateWigleCsv(aps, includePreheader = true) {
  const chunks = [];
  let buffer = includePreheader
    ? "WigleWifi-1.4,appRelease=1.0,model=Simulator,release=1.0,device=simulator,display=sim,board=sim,brand=Synthetic\n"
    : "";
  buffer += "MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type\n";

  for (let i = 0; i < aps.length; i++) {
    const ap = aps[i];
    buffer += `${ap.mac},${ap.ssid},${ap.auth},${ap.first_seen},${ap.channel},${ap.rssi},${ap.lat},${ap.lon},${ap.alt},${ap.accuracy},WIFI\n`;
    if (buffer.length > 131072) {
      chunks.push(buffer);
      buffer = '';
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks.join('');
}

/**
 * Generate Kepler.gl / generic test CSV format.
 */
export function generateTestCsv(aps) {
  const chunks = [];
  let buffer = "mac,ssid,auth,first_seen,channel,rssi,lat,lon\n";

  for (let i = 0; i < aps.length; i++) {
    const ap = aps[i];
    buffer += `${ap.mac},${ap.ssid},${ap.auth},${ap.first_seen},${ap.channel},${ap.rssi},${ap.lat},${ap.lon}\n`;
    if (buffer.length > 131072) {
      chunks.push(buffer);
      buffer = '';
    }
  }
  if (buffer.length > 0) chunks.push(buffer);
  return chunks.join('');
}

/**
 * Generates the standalone Python script with user's selected parameters ready for standalone CLI execution.
 */
export function exportPythonScriptSource({
  text = 'KEPLER',
  mode = 'text',
  svgStrokes = null,
  latCenter = 32.25,
  lonCenter = -90.13,
  letterW = 0.04,
  letterH = 0.06,
  letterScale = 1.0,
  gap = 0.02,
  densityUnit = 'km',
  apsPerUnit = 100.0,
  speedKmh = 50.0,
  startTime = null,
  includePreheader = true
} = {}) {
  const scale = Number(letterScale) || 1.0;
  const scaledW = Number((letterW * scale).toFixed(6));
  const scaledH = Number((letterH * scale).toFixed(6));
  const scaledGap = Number((gap * scale).toFixed(6));
  const preheaderLiteral = includePreheader ? 'True' : 'False';
  const startTimeStr = startTime ? (startTime instanceof Date ? formatTimestamp(startTime) : String(startTime).replace('T', ' ')) : '';
  const isSvg = mode === 'svg' && Array.isArray(svgStrokes) && svgStrokes.length > 0;

  return `import csv
import random
import math
from datetime import datetime, timedelta

# ==============================================================================
# WARDRIVING VECTOR ART GENERATOR
# Creates words or SVG art made from generated APs to test or visualize on wardriving maps
# View your results here: https://kepler.gl/demo
# ==============================================================================

# Generation Mode: "text" or "svg"
MODE = "${isSvg ? 'svg' : 'text'}"

# 1. Location Coordinates
LAT_CENTER = ${latCenter}   # Origin Latitude (click map or edit here)
LON_CENTER = ${lonCenter}  # Origin Longitude

# 2. Letter / Vector Scale & Spacing
LETTER_SCALE = ${scale}
LETTER_W = ${scaledW}        # Letter width in degrees (~${(scaledW * 111).toFixed(1)} km)
LETTER_H = ${scaledH}        # Letter height in degrees (~${(scaledH * 111).toFixed(1)} km)
GAP = ${scaledGap}                 # Spacing between letters

# 3. AP Density per KM or Mile (Can produce totals from 1,000 to 500,000+)
DENSITY_UNIT = "${densityUnit}"    # "km" or "mile"
APS_PER_UNIT = ${apsPerUnit}       # Number of APs per km (or per mile)
# e.g., 50/km = sparse, 500/km = dense, 5000/km = ultra-high density (totals ~500k)

# 4. Wardrive Vehicle Speed
SPEED_KMH = ${speedKmh}            # Simulated driving speed in km/h

# 5. Wardrive Start Clock & Date
START_TIME_ISO = "${startTimeStr}"  # e.g., "2026-11-05 14:00:00" or empty to default to 24h ago
if START_TIME_ISO.strip():
    try:
        START_TIME = datetime.fromisoformat(START_TIME_ISO.strip().replace(" ", "T"))
    except Exception:
        START_TIME = datetime.now() - timedelta(days=1)
else:
    START_TIME = datetime.now() - timedelta(days=1)

INCLUDE_PREHEADER = ${preheaderLiteral}           

# Clean, ordered vector strokes for letters and numbers (Relative coordinates 0.0 to 1.0)
VECTOR_FONTS = ${JSON.stringify(VECTOR_FONTS, null, 4)}

# Normalized SVG Strokes (when MODE == "svg")
SVG_STROKES = ${JSON.stringify(isSvg ? svgStrokes : [], null, 4)}

AUTH_MODES = ["[WPA2-PSK-CCMP][ESS]", "[RSN-SAE-CCMP][ESS]", "[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]", "[ESS]"]
CHANNELS = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161]

def interpolate_segment(p1, p2, step_size=0.001):
    """Interpolate points smoothly along a straight line segment."""
    dist = math.sqrt((p2[0] - p1[0])**2 + (p2[1] - p1[1])**2)
    if dist == 0:
        return [p1]
    steps = max(2, int(dist / step_size))
    segment_pts = []
    for i in range(steps + 1):
        t = i / steps
        x = p1[0] + t * (p2[0] - p1[0])
        y = p1[1] + t * (p2[1] - p1[1])
        segment_pts.append((x, y))
    return segment_pts

def generate_aps(text):
    master_path = []
    current_x = LON_CENTER
    y0 = LAT_CENTER
    effective_step = max(0.0008, 0.0008 * min(LETTER_SCALE, 8.0))

    if MODE == "svg" and SVG_STROKES:
        svg_span_lon = LETTER_W * 6.0
        svg_span_lat = LETTER_H * 4.0
        for stroke in SVG_STROKES:
            if len(stroke) < 2:
                continue
            stroke_local_path = []
            for i in range(len(stroke) - 1):
                p1 = stroke[i]
                p2 = stroke[i + 1]
                lon1 = current_x + p1[0] * svg_span_lon
                lat1 = y0 - p1[1] * svg_span_lat
                lon2 = current_x + p2[0] * svg_span_lon
                lat2 = y0 - p2[1] * svg_span_lat
                pts = interpolate_segment((lon1, lat1), (lon2, lat2), step_size=effective_step)
                if stroke_local_path:
                    stroke_local_path.extend(pts[1:])
                else:
                    stroke_local_path.extend(pts)
            if stroke_local_path:
                if master_path:
                    bridge_pts = interpolate_segment(master_path[-1], stroke_local_path[0], step_size=effective_step)
                    master_path.extend(bridge_pts[1:])
                master_path.extend(stroke_local_path)
    else:
        for ch in text.upper():
            strokes = VECTOR_FONTS.get(ch, VECTOR_FONTS.get(" ", []))
            letter_local_path = []
            
            for stroke in strokes:
                for i in range(len(stroke) - 1):
                    p1_rel = stroke[i]
                    p2_rel = stroke[i+1]
                    
                    lon1 = current_x + p1_rel[0] * LETTER_W
                    lat1 = y0 - p1_rel[1] * LETTER_H
                    lon2 = current_x + p2_rel[0] * LETTER_W
                    lat2 = y0 - p2_rel[1] * LETTER_H
                    
                    pts = interpolate_segment((lon1, lat1), (lon2, lat2), step_size=effective_step)
                    if letter_local_path:
                        letter_local_path.extend(pts[1:])  
                    else:
                        letter_local_path.extend(pts)
            
            if letter_local_path:
                if master_path:
                    end_pt = master_path[-1]
                    start_pt = letter_local_path[0]
                    bridge_pts = interpolate_segment(end_pt, start_pt, step_size=effective_step)
                    master_path.extend(bridge_pts[1:])
                master_path.extend(letter_local_path)
                
            current_x += LETTER_W + GAP

    aps = []
    if not master_path:
        return aps

    # Local metric scale at LAT_CENTER
    lat_rad = math.radians(LAT_CENTER)
    km_per_lon = 111.0 * math.cos(lat_rad)
    km_per_lat = 111.0

    # Calculate total stroke distance in km
    total_km = 0.0
    for i in range(len(master_path) - 1):
        dx_km = (master_path[i+1][0] - master_path[i][0]) * km_per_lon
        dy_km = (master_path[i+1][1] - master_path[i][1]) * km_per_lat
        total_km += math.sqrt(dx_km*dx_km + dy_km*dy_km)

    # Determine step distance in km from APs per unit
    unit_km = 1.609344 if DENSITY_UNIT.lower() == "mile" else 1.0
    effective_aps_per_km = APS_PER_UNIT / unit_km
    step_dist_km = 1.0 / max(0.0001, effective_aps_per_km)

    total_seconds = (total_km / max(0.1, SPEED_KMH)) * 3600.0
    expected_aps = max(1, round(total_km / step_dist_km))
    time_step_sec = total_seconds / float(expected_aps)

    current_time = START_TIME
    point_counter = 1
    random.seed(42)
    seen = set()
    ssid_prefix = text.replace(" ", "_").upper()

    current_segment_idx = 0
    current_pt = master_path[0]
    dist_to_next_km = step_dist_km

    while current_segment_idx < len(master_path) - 1:
        next_v = master_path[current_segment_idx + 1]
        dx_lon = next_v[0] - current_pt[0]
        dy_lat = next_v[1] - current_pt[1]
        dx_km = dx_lon * km_per_lon
        dy_km = dy_lat * km_per_lat
        seg_dist_km = math.sqrt(dx_km*dx_km + dy_km*dy_km)

        if seg_dist_km == 0:
            current_segment_idx += 1
            current_pt = next_v
            continue

        if seg_dist_km < dist_to_next_km:
            current_pt = next_v
            dist_to_next_km -= seg_dist_km
            current_segment_idx += 1
        else:
            fraction = dist_to_next_km / seg_dist_km
            current_pt = (
                current_pt[0] + dx_lon * fraction,
                current_pt[1] + dy_lat * fraction
            )
            dist_to_next_km = step_dist_km

            if point_counter > 1:
                current_time += timedelta(seconds=time_step_sec)

            # Generate globally unique, unicast MAC address
            first_octet = random.randrange(256) & 0xFE
            first_octet &= 0xFD
            second_nibble = random.choice([0, 4, 8, 12])
            first_hex = f"{(first_octet & 0xF0) | second_nibble:02X}"
            mac = first_hex + ":" + ":".join(f"{random.randrange(256):02X}" for _ in range(5))
            
            if len(seen) > 200000:
                seen.clear()
            while mac in seen:
                first_octet = random.randrange(256) & 0xFE
                first_octet &= 0xFD
                first_hex = f"{(first_octet & 0xF0) | second_nibble:02X}"
                mac = first_hex + ":" + ":".join(f"{random.randrange(256):02X}" for _ in range(5))
            seen.add(mac)

            lat = current_pt[1] + random.uniform(-0.000001, 0.000001)
            lon = current_pt[0] + random.uniform(-0.000001, 0.000001)

            aps.append({
                "mac": mac,
                "ssid": f"{ssid_prefix}-{point_counter:06d}",
                "auth": random.choice(AUTH_MODES),
                "first_seen": current_time.strftime("%Y-%m-%d %H:%M:%S"),
                "channel": random.choice(CHANNELS),
                "rssi": random.randint(-90, -45),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "alt": 15,
                "accuracy": round(random.uniform(3, 8), 1),
            })
            point_counter += 1

    return aps

def write_wigle(aps, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        if INCLUDE_PREHEADER:
            f.write("WigleWifi-1.4,appRelease=1.0,model=Simulator,release=1.0,"
                    "device=simulator,display=sim,board=sim,brand=Synthetic\\n")
        w = csv.writer(f)
        w.writerow(["MAC", "SSID", "AuthMode", "FirstSeen", "Channel", "RSSI",
                    "CurrentLatitude", "CurrentLongitude", "AltitudeMeters",
                    "AccuracyMeters", "Type"])
        for ap in aps:
            w.writerow([ap["mac"], ap["ssid"], ap["auth"], ap["first_seen"],
                        ap["channel"], ap["rssi"], ap["lat"], ap["lon"],
                        ap["alt"], ap["accuracy"], "WIFI"])

def write_test(aps, path):
    cols = ["mac", "ssid", "auth", "first_seen", "channel", "rssi", "lat", "lon"]
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for ap in aps:
            w.writerow([ap[c] for c in cols])

if __name__ == "__main__":
    user_text = ${JSON.stringify(text)}
    print(f"Generating clean vector access points with global MACs for '{user_text}'.")
    aps = generate_aps(user_text)
    
    filename_base = "".join(c if c.isalnum() else "_" for c in user_text).lower()
    wigle_filename = f"{filename_base}_wigle.csv"
    test_filename = f"{filename_base}_test.csv"
    
    write_wigle(aps, wigle_filename)
    write_test(aps, test_filename)
    print(f"Successfully wrote {len(aps)} access points to '{wigle_filename}' and '{test_filename}'.")
`;
}
