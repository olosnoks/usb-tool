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
 * Authentic default ISP router profiles & realistic Wi-Fi datasets.
 */
export const SSID_PROFILES = [
  { id: 'prefix', label: 'Custom Text / Prefix', description: 'SSID-000001 (e.g. KEPLER-000001)' },
  { id: 'isp_mix', label: 'Realistic ISP Mix', description: 'Xfinity, AT&T, Spectrum, Netgear & TP-Link' },
  { id: 'xfinity', label: 'Xfinity / Comcast Defaults', description: 'xfinitywifi, XFINITY, Xfinity-XXXX, HOME-XXXX' },
  { id: 'att', label: 'AT&T Defaults', description: 'ATTXXX, ATT-WIFI-XXXX, attwifi, ATT-Fiber-XXXX' },
  { id: 'spectrum', label: 'Spectrum / Charter Defaults', description: 'SpectrumSetup-XX, MySpectrumWiFi, SpectrumWiFi' }
];

export const XFINITY_OUIS = [
  'A4:12:42', // Arris
  '00:CD:FE', // Technicolor
  '58:56:E8', // Cisco
  'E8:89:2C', // CommScope
  '10:05:01', // Technicolor CH
  '74:9D:79', // Arris Group
  '20:73:55', // Cisco SPVTG
  'B0:77:AC'  // Humax
];

export const ATT_OUIS = [
  '94:87:70', // Pace Plc
  'F8:E9:03', // Arris Group (BGW210)
  '3C:CE:73', // Humax (BGW320)
  'CC:7B:35', // Nokia
  '00:1E:46', // Cisco / Scientific Atlanta
  '28:16:2E', // 2Wire / Pace
  'D4:04:CD', // Motorola Solutions
  'F0:F2:49'  // Nokia Solutions
];

export const SPECTRUM_OUIS = [
  '68:02:B8', // Sagemcom
  'AC:EC:80', // Askey Computer
  'E0:22:04', // Sercomm
  '18:35:D1', // Charter Communications
  '38:35:FB'  // Hitron Technologies
];

export const COMMON_ROUTER_OUIS = [
  '20:4E:7F', // Netgear
  'C0:FF:D4', // Netgear
  '14:91:82', // Belkin / Linksys
  '60:38:E0', // TP-Link
  '70:4F:57', // TP-Link
  '04:D9:F5', // ASUSTek
  '18:31:BF'  // ASUSTek
];

const HEX_CHARS = '0123456789ABCDEF';

function randHex(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += HEX_CHARS[rng.randrange(16)];
  }
  return s;
}

function randDigits(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) {
    s += String(rng.randrange(10));
  }
  return s;
}

export function genMacFromOui(rng, oui) {
  const rest = Array.from({ length: 3 }, () => rng.randrange(256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  return `${oui}:${rest}`;
}

export function genGenericMac(rng) {
  let firstOctet = rng.randrange(256) & 0xFE; // Clear multicast bit
  firstOctet &= 0xFD;                        // Clear local/private bit
  const secondNibble = rng.choice([0, 4, 8, 12]);
  const firstHex = (((firstOctet & 0xF0) | secondNibble) >>> 0).toString(16).padStart(2, '0').toUpperCase();
  const rest = Array.from({ length: 5 }, () => rng.randrange(256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  return `${firstHex}:${rest}`;
}

/**
 * Generate an authentic AP identity (SSID, MAC with vendor OUI, AuthMode, Channel)
 * according to ISP router profiles (Xfinity, AT&T, Spectrum, or custom prefix).
 */
export function generateApIdentity(rng, pointCounter, ssidMode = 'prefix', ssidPrefix = 'DEMO') {
  let effectiveMode = ssidMode;
  if (effectiveMode === 'isp_mix') {
    const roll = rng.uniform(0, 100);
    if (roll < 42) effectiveMode = 'xfinity';
    else if (roll < 78) effectiveMode = 'att';
    else if (roll < 90) effectiveMode = 'spectrum';
    else effectiveMode = 'common';
  }

  if (effectiveMode === 'xfinity') {
    const oui = rng.choice(XFINITY_OUIS);
    const mac = genMacFromOui(rng, oui);
    const subRoll = rng.uniform(0, 100);

    if (subRoll < 26) {
      // xfinitywifi - Open public hotspot
      return {
        ssid: 'xfinitywifi',
        mac,
        auth: '[ESS]',
        channel: rng.choice([1, 6, 11, 36, 40, 44, 149, 157])
      };
    } else if (subRoll < 40) {
      // XFINITY - 802.1x Enterprise secure public hotspot
      return {
        ssid: 'XFINITY',
        mac,
        auth: '[WPA2-EAP-CCMP][ESS]',
        channel: rng.choice([1, 6, 11, 36, 44, 149, 153])
      };
    } else if (subRoll < 75) {
      // Xfinity-XXXX (e.g. Xfinity-A4B2)
      const code = randHex(rng, 4);
      return {
        ssid: `Xfinity-${code}`,
        mac,
        auth: rng.choice(['[WPA2-PSK-CCMP][ESS]', '[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]']),
        channel: rng.choice(CHANNELS)
      };
    } else if (subRoll < 93) {
      // HOME-XXXX (Arris/Cisco Xfinity gateways)
      const code = randHex(rng, 4);
      return {
        ssid: `HOME-${code}`,
        mac,
        auth: '[WPA2-PSK-CCMP][ESS]',
        channel: rng.choice([1, 6, 11])
      };
    } else {
      // xfinitywifi-5G
      return {
        ssid: 'xfinitywifi-5G',
        mac,
        auth: '[ESS]',
        channel: rng.choice([36, 44, 48, 149, 153, 157, 161])
      };
    }
  }

  if (effectiveMode === 'att') {
    const oui = rng.choice(ATT_OUIS);
    const mac = genMacFromOui(rng, oui);
    const subRoll = rng.uniform(0, 100);

    if (subRoll < 35) {
      // ATT<3digits> (e.g. ATT731, ATT592)
      const digits = randDigits(rng, 3);
      return {
        ssid: `ATT${digits}`,
        mac,
        auth: rng.choice(['[WPA2-PSK-CCMP][ESS]', '[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]']),
        channel: rng.choice(CHANNELS)
      };
    } else if (subRoll < 60) {
      // ATT-WIFI-<4digits> (e.g. ATT-WIFI-5302)
      const digits = randDigits(rng, 4);
      return {
        ssid: `ATT-WIFI-${digits}`,
        mac,
        auth: '[WPA2-PSK-CCMP][ESS]',
        channel: rng.choice(CHANNELS)
      };
    } else if (subRoll < 75) {
      // ATT<hex> (e.g. ATT4xP2, ATT82F1)
      const code = randHex(rng, 4);
      return {
        ssid: `ATT${code}`,
        mac,
        auth: '[WPA2-PSK-CCMP][ESS]',
        channel: rng.choice(CHANNELS)
      };
    } else if (subRoll < 87) {
      // attwifi - Open hotspot
      return {
        ssid: 'attwifi',
        mac,
        auth: '[ESS]',
        channel: rng.choice([1, 6, 11, 36, 44, 149])
      };
    } else {
      // ATT<3digits>_5G / ATT-Fiber-<hex>
      const isFiber = rng.uniform(0, 10) > 5;
      const ssid = isFiber ? `ATT-Fiber-${randHex(rng, 4)}` : `ATT${randDigits(rng, 3)}_5G`;
      return {
        ssid,
        mac,
        auth: '[WPA2-PSK-CCMP][ESS]',
        channel: rng.choice([36, 40, 44, 48, 149, 153, 157, 161])
      };
    }
  }

  if (effectiveMode === 'spectrum') {
    const oui = rng.choice(SPECTRUM_OUIS);
    const mac = genMacFromOui(rng, oui);
    const subRoll = rng.uniform(0, 100);

    if (subRoll < 45) {
      return {
        ssid: `SpectrumSetup-${randHex(rng, 2)}`,
        mac,
        auth: '[WPA2-PSK-CCMP][ESS]',
        channel: rng.choice(CHANNELS)
      };
    } else if (subRoll < 75) {
      const band = rng.choice(['5G', '2G']);
      return {
        ssid: `MySpectrumWiFi${randHex(rng, 2)}-${band}`,
        mac,
        auth: '[WPA2-PSK-CCMP][ESS]',
        channel: band === '5G' ? rng.choice([36, 44, 149, 157]) : rng.choice([1, 6, 11])
      };
    } else {
      return {
        ssid: subRoll < 90 ? 'SpectrumWiFi' : 'SpectrumWiFi Plus',
        mac,
        auth: subRoll < 90 ? '[ESS]' : '[WPA2-EAP-CCMP][ESS]',
        channel: rng.choice([1, 6, 11, 36, 44, 149])
      };
    }
  }

  if (effectiveMode === 'common') {
    const oui = rng.choice(COMMON_ROUTER_OUIS);
    const mac = genMacFromOui(rng, oui);
    const brands = [
      () => `NETGEAR${randDigits(rng, 2)}`,
      () => `Linksys${randDigits(rng, 5)}`,
      () => `TP-Link_${randHex(rng, 4)}`,
      () => `ASUS_${randHex(rng, 2)}`,
      () => `CenturyLink${randDigits(rng, 4)}`
    ];
    const brandFn = rng.choice(brands);
    return {
      ssid: brandFn(),
      mac,
      auth: rng.choice(AUTH_MODES),
      channel: rng.choice(CHANNELS)
    };
  }

  // Default: 'prefix' mode
  return {
    ssid: `${ssidPrefix}-${String(pointCounter).padStart(6, '0')}`,
    mac: genGenericMac(rng),
    auth: rng.choice(AUTH_MODES),
    channel: rng.choice(CHANNELS)
  };
}

/**
 * Fetches an authentic driving route snapped to actual real-world roads via OpenStreetMap's OSRM API.
 * 
 * @param {Array<{lat: number, lon: number}|[number, number]>} waypoints List of waypoints
 * @param {Object} options
 * @param {'driving'|'bike'|'foot'} [options.profile='driving']
 * @param {number} [options.timeoutMs=8000]
 * @returns {Promise<{ success: boolean, coordinates: Array<[number, number]>, distanceMeters: number, durationSeconds: number, error?: string }>}
 */
export async function fetchOsrmRoadRoute(waypoints, { profile = 'driving', timeoutMs = 8000 } = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    return {
      success: false,
      coordinates: [],
      distanceMeters: 0,
      durationSeconds: 0,
      error: 'At least 2 waypoints are required to calculate a road route.'
    };
  }

  // Format lon,lat pairs expected by OSRM API: lon1,lat1;lon2,lat2;...
  const coordsStr = waypoints.map((w) => {
    const lat = Array.isArray(w) ? Number(w[0]) : Number(w.lat);
    const lon = Array.isArray(w) ? Number(w[1]) : Number(w.lon);
    return `${lon.toFixed(6)},${lat.toFixed(6)}`;
  }).join(';');

  // Prepare direct fallback coordinates in case OSRM is unreachable
  const directCoordinates = waypoints.map((w) => {
    const lat = Array.isArray(w) ? Number(w[0]) : Number(w.lat);
    const lon = Array.isArray(w) ? Number(w[1]) : Number(w.lon);
    return [lon, lat];
  });

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coordsStr}?overview=full&geometries=geojson`;
    const response = await fetch(url, {
      signal: controller ? controller.signal : undefined
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`OSRM HTTP error: ${response.status}`);
    }

    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error(data.message || `OSRM error status: ${data.code}`);
    }

    const primaryRoute = data.routes[0];
    const coordinates = primaryRoute.geometry.coordinates; // [[lon, lat], ...]

    return {
      success: true,
      coordinates,
      distanceMeters: primaryRoute.distance || 0,
      durationSeconds: primaryRoute.duration || 0
    };
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    return {
      success: false,
      coordinates: directCoordinates,
      distanceMeters: 0,
      durationSeconds: 0,
      error: err.name === 'AbortError' ? 'Road route query timed out' : (err.message || 'Failed to fetch road route')
    };
  }
}

/**
 * Generate synthetic Access Points tracing text along a vector font path.
 * Supports density in APs per km or APs per mile (with totals up to 500k+),
 * configurable letter dimensions & scale, vehicle speed, custom start clock/date,
 * and realistic ISP router profiles (Xfinity, AT&T, Spectrum, or custom prefix).
 */
export function generateDemoAps(options = {}) {
  const {
    text = 'KEPLER',
    mode = 'text',             // 'text' | 'svg' | 'route'
    routeCoordinates = null,   // Array of [lon, lat] points along actual roads
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
    rotationDeg = 0,           // Rotation angle in degrees (0 to 360)
    svgScale = 1.0,            // Dedicated SVG scale multiplier
    flipH = false,             // Flip horizontally
    flipV = false,             // Flip vertically
    ssidMode = 'prefix',       // 'prefix' | 'isp_mix' | 'xfinity' | 'att' | 'spectrum'
    seed = 42
  } = options;

  const isSvgMode = mode === 'svg' && Array.isArray(svgStrokes) && svgStrokes.length > 0;
  const isRouteMode = mode === 'route' && Array.isArray(routeCoordinates) && routeCoordinates.length >= 2;
  const cleanText = String(text || '').trim();

  if (!isSvgMode && !isRouteMode && !cleanText) {
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
  const effectiveLat = isRouteMode && routeCoordinates.length > 0 ? routeCoordinates[0][1] : Number(latCenter);
  const latRad = (effectiveLat * Math.PI) / 180.0;
  const kmPerLonDeg = 111.0 * Math.cos(latRad);
  const kmPerLatDeg = 111.0;

  // Fine stroke interpolation step, scaled so huge letters calculate smoothly
  const effectiveStepSize = stepSize !== null && stepSize !== undefined
    ? Number(stepSize)
    : Math.max(0.0008, 0.0008 * Math.min(effectiveScale, 8.0));

  const masterPath = [];
  const x0 = Number(lonCenter);
  const y0 = Number(latCenter);

  if (isRouteMode) {
    // Road Route Mode: directly use real-world GPS coordinates along actual roads
    masterPath.push(...routeCoordinates);
  } else if (isSvgMode) {
    // In SVG mode: normalized coordinates (0 to 1) are rotated, scaled, and placed
    const effectiveSvgScale = effectiveScale * (Number(svgScale) > 0 ? Number(svgScale) : 1.0);
    const svgSpanLon = (Number(letterW) || 0.04) * 6.0 * effectiveSvgScale;
    const svgSpanLat = (Number(letterH) || 0.06) * 4.0 * effectiveSvgScale;

    const rad = ((Number(rotationDeg) || 0) * Math.PI) / 180.0;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const transformPoint = (p) => {
      let px = p[0];
      let py = p[1];
      if (flipH) px = 1.0 - px;
      if (flipV) py = 1.0 - py;

      const dx = px - 0.5;
      const dy = py - 0.5;

      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;

      const lon = x0 + (rx + 0.5) * svgSpanLon;
      const lat = y0 - (ry + 0.5) * svgSpanLat;
      return [lon, lat];
    };

    for (const stroke of svgStrokes) {
      if (!stroke || stroke.length < 2) continue;
      const strokeLocalPath = [];
      for (let i = 0; i < stroke.length - 1; i++) {
        const [lon1, lat1] = transformPoint(stroke[i]);
        const [lon2, lat2] = transformPoint(stroke[i + 1]);

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
    // Text Mode: calculate span center to support rotation and flip
    const textChars = cleanText.toUpperCase();
    const count = Math.max(1, textChars.length);
    const totalTextWidth = count * effectiveLetterW + (count - 1) * effectiveGap;
    const totalTextHeight = effectiveLetterH;

    const rad = ((Number(rotationDeg) || 0) * Math.PI) / 180.0;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);

    const centerX = x0 + totalTextWidth / 2.0;
    const centerY = y0 - totalTextHeight / 2.0;

    const transformTextPoint = (lon, lat) => {
      let dx = lon - centerX;
      let dy = lat - centerY;

      if (flipH) dx = -dx;
      if (flipV) dy = -dy;

      const rx = dx * cosR - dy * sinR;
      const ry = dx * sinR + dy * cosR;

      return [centerX + rx, centerY + ry];
    };

    let currentX = x0;

    for (const ch of textChars) {
      const strokes = VECTOR_FONTS[ch] || VECTOR_FONTS[" "];
      const letterLocalPath = [];

      for (const stroke of strokes) {
        for (let i = 0; i < stroke.length - 1; i++) {
          const p1Rel = stroke[i];
          const p2Rel = stroke[i + 1];

          let lon1 = currentX + p1Rel[0] * effectiveLetterW;
          let lat1 = y0 - p1Rel[1] * effectiveLetterH;
          let lon2 = currentX + p2Rel[0] * effectiveLetterW;
          let lat2 = y0 - p2Rel[1] * effectiveLetterH;

          if (rotationDeg !== 0 || flipH || flipV) {
            [lon1, lat1] = transformTextPoint(lon1, lat1);
            [lon2, lat2] = transformTextPoint(lon2, lat2);
          }

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
  const ssidPrefix = (cleanText ? cleanText.replace(/\s+/g, '_') : (isRouteMode ? 'ROUTE' : 'SVG_ART')).toUpperCase();

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

      // Generate authentic AP identity based on chosen profile (Xfinity, AT&T, ISP mix, or prefix)
      let apIdentity = generateApIdentity(rng, pointCounter, ssidMode, ssidPrefix);
      let mac = apIdentity.mac;

      // Keep seen bounded to prevent memory blowup on 500k+ items
      if (seen.size > 200000) seen.clear();
      while (seen.has(mac)) {
        apIdentity = generateApIdentity(rng, pointCounter, ssidMode, ssidPrefix);
        mac = apIdentity.mac;
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

      const frequency = apIdentity.frequency || channelToFrequency(apIdentity.channel);

      aps.push({
        mac,
        ssid: apIdentity.ssid,
        auth: apIdentity.auth,
        first_seen: formatTimestamp(currentTime),
        channel: apIdentity.channel,
        frequency,
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
 * Calculates frequency in MHz from standard 802.11 Wi-Fi channel numbers.
 * Supports 2.4 GHz (channels 1-14) and 5 GHz (channels 32-177).
 *
 * @param {number|string} channel
 * @returns {number} Frequency in MHz
 */
export function channelToFrequency(channel) {
  const ch = Number(channel) || 1;
  if (ch === 14) return 2484;
  if (ch >= 1 && ch <= 13) return 2407 + ch * 5;
  if (ch >= 32 && ch <= 177) return 5000 + ch * 5;
  return ch > 14 ? 5000 + ch * 5 : 2407 + ch * 5;
}

export const WIGLE_PREHEADER = "WigleWifi-1.6,appRelease=1.0.22 (Beta 3),model=Biscuit Pro,release=v1.6.2,device=Biscuit Pro,display=Biscuit Pro,board=Biscuit Pro,brand=Biscuit Shop,star=Sol,body=3,subBody=0\n";
export const WIGLE_HEADER = "MAC,SSID,AuthMode,FirstSeen,Channel,Frequency,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,RCOIs,MfgrId,Type\n";

/**
 * Generate standard WiGLE Wifi 1.6 CSV format.
 * High-performance chunked generation handles 500k+ rows easily.
 */
export function generateWigleCsv(aps, includePreheader = true) {
  const chunks = [];
  let buffer = includePreheader ? WIGLE_PREHEADER : "";
  buffer += WIGLE_HEADER;

  for (let i = 0; i < aps.length; i++) {
    const ap = aps[i];
    const freq = ap.frequency || channelToFrequency(ap.channel);
    buffer += `${ap.mac},${ap.ssid},${ap.auth},${ap.first_seen},${ap.channel},${freq},${ap.rssi},${ap.lat},${ap.lon},${ap.alt},${ap.accuracy},,,WIFI\n`;
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
 * Splits AP records into multiple standalone CSV files according to a maximum byte size.
 * If maxSizeBytes <= 0 or the entire dataset fits in one file, returns a single file chunk.
 * Each split file contains the full valid format header/preheader so it can be uploaded independently.
 *
 * @param {Array} aps
 * @param {Object} options
 * @param {'wigle'|'kepler'} [options.format='wigle']
 * @param {boolean} [options.includePreheader=true]
 * @param {number} [options.maxSizeBytes=0] Max file size in bytes (e.g. 10 * 1024 * 1024 for 10MB)
 * @param {string} [options.baseName='demo']
 * @returns {Array<{ filename: string, content: string, byteSize: number, apCount: number, part: number, totalParts: number }>}
 */
export function splitApsIntoFileChunks(aps, {
  format = 'wigle',
  includePreheader = true,
  maxSizeBytes = 0,
  baseName = 'demo'
} = {}) {
  if (!Array.isArray(aps) || aps.length === 0) {
    const emptyHeader = format === 'wigle'
      ? (includePreheader ? WIGLE_PREHEADER : "") + WIGLE_HEADER
      : "mac,ssid,auth,first_seen,channel,rssi,lat,lon\n";
    return [{
      filename: `${baseName}_${format}.csv`,
      content: emptyHeader,
      byteSize: emptyHeader.length,
      apCount: 0,
      part: 1,
      totalParts: 1
    }];
  }

  const isWigle = format === 'wigle';
  const header = isWigle
    ? (includePreheader ? WIGLE_PREHEADER : "") + WIGLE_HEADER
    : "mac,ssid,auth,first_seen,channel,rssi,lat,lon\n";

  const formatRow = isWigle
    ? (ap) => `${ap.mac},${ap.ssid},${ap.auth},${ap.first_seen},${ap.channel},${ap.frequency || channelToFrequency(ap.channel)},${ap.rssi},${ap.lat},${ap.lon},${ap.alt},${ap.accuracy},,,WIFI\n`
    : (ap) => `${ap.mac},${ap.ssid},${ap.auth},${ap.first_seen},${ap.channel},${ap.rssi},${ap.lat},${ap.lon}\n`;

  // If no size limit, return single file
  if (!maxSizeBytes || maxSizeBytes <= 0) {
    const content = isWigle ? generateWigleCsv(aps, includePreheader) : generateTestCsv(aps);
    return [{
      filename: `${baseName}_${format}.csv`,
      content,
      byteSize: content.length,
      apCount: aps.length,
      part: 1,
      totalParts: 1
    }];
  }

  const chunks = [];
  let currentRows = [];
  let currentBytes = header.length;

  for (let i = 0; i < aps.length; i++) {
    const rowStr = formatRow(aps[i]);
    const rowBytes = rowStr.length;

    if (currentRows.length > 0 && (currentBytes + rowBytes > maxSizeBytes)) {
      const chunkContent = header + currentRows.join('');
      chunks.push({
        content: chunkContent,
        byteSize: chunkContent.length,
        apCount: currentRows.length
      });
      currentRows = [rowStr];
      currentBytes = header.length + rowBytes;
    } else {
      currentRows.push(rowStr);
      currentBytes += rowBytes;
    }
  }

  if (currentRows.length > 0) {
    const chunkContent = header + currentRows.join('');
    chunks.push({
      content: chunkContent,
      byteSize: chunkContent.length,
      apCount: currentRows.length
    });
  }

  const totalParts = chunks.length;
  if (totalParts === 1) {
    chunks[0].filename = `${baseName}_${format}.csv`;
    chunks[0].part = 1;
    chunks[0].totalParts = 1;
  } else {
    for (let p = 0; p < totalParts; p++) {
      const partNum = String(p + 1).padStart(2, '0');
      const totalNum = String(totalParts).padStart(2, '0');
      chunks[p].filename = `${baseName}_${format}_part${partNum}_of_${totalNum}.csv`;
      chunks[p].part = p + 1;
      chunks[p].totalParts = totalParts;
    }
  }

  return chunks;
}

/**
 * Generates the standalone Python script with user's selected parameters ready for standalone CLI execution.
 */
export function exportPythonScriptSource({
  text = 'KEPLER',
  mode = 'text',
  routeCoordinates = null,
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
  rotationDeg = 0,
  svgScale = 1.0,
  flipH = false,
  flipV = false,
  ssidMode = 'prefix',
  includePreheader = true
} = {}) {
  const scale = Number(letterScale) || 1.0;
  const scaledW = Number((letterW * scale).toFixed(6));
  const scaledH = Number((letterH * scale).toFixed(6));
  const scaledGap = Number((gap * scale).toFixed(6));
  const preheaderLiteral = includePreheader ? 'True' : 'False';
  const startTimeStr = startTime ? (startTime instanceof Date ? formatTimestamp(startTime) : String(startTime).replace('T', ' ')) : '';
  const isSvg = mode === 'svg' && Array.isArray(svgStrokes) && svgStrokes.length > 0;
  const isRoute = mode === 'route' && Array.isArray(routeCoordinates) && routeCoordinates.length >= 2;
  const effectiveMode = isRoute ? 'route' : (isSvg ? 'svg' : 'text');

  return `import csv
import random
import math
from datetime import datetime, timedelta

# ==============================================================================
# WARDRIVING VECTOR ART & ROAD ROUTE GENERATOR
# Inspired by OSINTIAL
# Creates words, road routes, or SVG art made from generated APs to test or visualize on wardriving maps
# View your results here: https://kepler.gl/demo
# ==============================================================================

# Generation Mode: "text", "route", or "svg"
MODE = "${effectiveMode}"

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

# 6. SSID / Router Profile: "prefix", "isp_mix", "xfinity", "att", "spectrum"
SSID_MODE = "${ssidMode || 'prefix'}"

# 7. SVG / Route Transformation Settings
ROTATION_DEG = ${Number(rotationDeg) || 0}   # Rotation angle in degrees
SVG_SCALE = ${Number(svgScale) || 1.0}        # SVG scale multiplier
FLIP_H = ${flipH ? 'True' : 'False'}         # Flip horizontally
FLIP_V = ${flipV ? 'True' : 'False'}         # Flip vertically

INCLUDE_PREHEADER = ${preheaderLiteral}           

# Clean, ordered vector strokes for letters and numbers (Relative coordinates 0.0 to 1.0)
VECTOR_FONTS = ${JSON.stringify(VECTOR_FONTS, null, 4)}

# Normalized SVG Strokes (when MODE == "svg")
SVG_STROKES = ${JSON.stringify(isSvg ? svgStrokes : [], null, 4)}

# Real-world Road Coordinates (when MODE == "route")
ROUTE_COORDINATES = ${JSON.stringify(isRoute ? routeCoordinates : [], null, 4)}

AUTH_MODES = ["[WPA2-PSK-CCMP][ESS]", "[RSN-SAE-CCMP][ESS]", "[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]", "[ESS]"]
CHANNELS = [1, 6, 11, 36, 40, 44, 48, 149, 153, 157, 161]

XFINITY_OUIS = ["A4:12:42", "00:CD:FE", "58:56:E8", "E8:89:2C", "10:05:01", "74:9D:79", "B0:77:AC"]
ATT_OUIS = ["94:87:70", "F8:E9:03", "3C:CE:73", "CC:7B:35", "00:1E:46", "28:16:2E", "D4:04:CD"]
SPECTRUM_OUIS = ["68:02:B8", "AC:EC:80", "E0:22:04", "18:35:D1", "38:35:FB"]
COMMON_OUIS = ["20:4E:7F", "C0:FF:D4", "14:91:82", "60:38:E0", "70:4F:57", "04:D9:F5", "18:31:BF"]

def generate_ap_identity(point_counter, prefix):
    eff_mode = SSID_MODE
    if eff_mode == "isp_mix":
        r = random.uniform(0, 100)
        if r < 42:
            eff_mode = "xfinity"
        elif r < 78:
            eff_mode = "att"
        elif r < 90:
            eff_mode = "spectrum"
        else:
            eff_mode = "common"

    if eff_mode == "xfinity":
        oui = random.choice(XFINITY_OUIS)
        mac = f"{oui}:" + ":".join(f"{random.randrange(256):02X}" for _ in range(3))
        sub = random.uniform(0, 100)
        if sub < 26:
            return "xfinitywifi", mac, "[ESS]", random.choice([1, 6, 11, 36, 44, 149, 157])
        elif sub < 40:
            return "XFINITY", mac, "[WPA2-EAP-CCMP][ESS]", random.choice([1, 6, 11, 36, 44, 149])
        elif sub < 75:
            code = "".join(random.choices("0123456789ABCDEF", k=4))
            return f"Xfinity-{code}", mac, random.choice(["[WPA2-PSK-CCMP][ESS]", "[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]"]), random.choice(CHANNELS)
        elif sub < 93:
            code = "".join(random.choices("0123456789ABCDEF", k=4))
            return f"HOME-{code}", mac, "[WPA2-PSK-CCMP][ESS]", random.choice([1, 6, 11])
        else:
            return "xfinitywifi-5G", mac, "[ESS]", random.choice([36, 44, 48, 149, 153, 157, 161])

    if eff_mode == "att":
        oui = random.choice(ATT_OUIS)
        mac = f"{oui}:" + ":".join(f"{random.randrange(256):02X}" for _ in range(3))
        sub = random.uniform(0, 100)
        if sub < 35:
            digits = "".join(random.choices("0123456789", k=3))
            return f"ATT{digits}", mac, random.choice(["[WPA2-PSK-CCMP][ESS]", "[WPA2-PSK-CCMP][RSN-SAE-CCMP][ESS]"]), random.choice(CHANNELS)
        elif sub < 60:
            digits = "".join(random.choices("0123456789", k=4))
            return f"ATT-WIFI-{digits}", mac, "[WPA2-PSK-CCMP][ESS]", random.choice(CHANNELS)
        elif sub < 75:
            code = "".join(random.choices("0123456789ABCDEF", k=4))
            return f"ATT{code}", mac, "[WPA2-PSK-CCMP][ESS]", random.choice(CHANNELS)
        elif sub < 87:
            return "attwifi", mac, "[ESS]", random.choice([1, 6, 11, 36, 44, 149])
        else:
            is_fiber = random.random() > 0.5
            ssid = f"ATT-Fiber-{''.join(random.choices('0123456789ABCDEF', k=4))}" if is_fiber else f"ATT{''.join(random.choices('0123456789', k=3))}_5G"
            return ssid, mac, "[WPA2-PSK-CCMP][ESS]", random.choice([36, 40, 44, 48, 149, 153, 157, 161])

    if eff_mode == "spectrum":
        oui = random.choice(SPECTRUM_OUIS)
        mac = f"{oui}:" + ":".join(f"{random.randrange(256):02X}" for _ in range(3))
        sub = random.uniform(0, 100)
        if sub < 45:
            return f"SpectrumSetup-{''.join(random.choices('0123456789ABCDEF', k=2))}", mac, "[WPA2-PSK-CCMP][ESS]", random.choice(CHANNELS)
        elif sub < 75:
            band = random.choice(["5G", "2G"])
            ch = random.choice([36, 44, 149]) if band == "5G" else random.choice([1, 6, 11])
            return f"MySpectrumWiFi{''.join(random.choices('0123456789ABCDEF', k=2))}-{band}", mac, "[WPA2-PSK-CCMP][ESS]", ch
        else:
            ssid = "SpectrumWiFi" if sub < 90 else "SpectrumWiFi Plus"
            auth = "[ESS]" if sub < 90 else "[WPA2-EAP-CCMP][ESS]"
            return ssid, mac, auth, random.choice([1, 6, 11, 36, 44])

    if eff_mode == "common":
        oui = random.choice(COMMON_OUIS)
        mac = f"{oui}:" + ":".join(f"{random.randrange(256):02X}" for _ in range(3))
        brand = random.choice(["netgear", "linksys", "tplink", "asus", "centurylink"])
        if brand == "netgear":
            ssid = f"NETGEAR{''.join(random.choices('0123456789', k=2))}"
        elif brand == "linksys":
            ssid = f"Linksys{''.join(random.choices('0123456789', k=5))}"
        elif brand == "tplink":
            ssid = f"TP-Link_{''.join(random.choices('0123456789ABCDEF', k=4))}"
        elif brand == "asus":
            ssid = f"ASUS_{''.join(random.choices('0123456789ABCDEF', k=2))}"
        else:
            ssid = f"CenturyLink{''.join(random.choices('0123456789', k=4))}"
        return ssid, mac, random.choice(AUTH_MODES), random.choice(CHANNELS)

    # Prefix mode
    first_octet = random.randrange(256) & 0xFE
    first_octet &= 0xFD
    second_nibble = random.choice([0, 4, 8, 12])
    first_hex = f"{(first_octet & 0xF0) | second_nibble:02X}"
    mac = first_hex + ":" + ":".join(f"{random.randrange(256):02X}" for _ in range(5))
    return f"{prefix}-{point_counter:06d}", mac, random.choice(AUTH_MODES), random.choice(CHANNELS)

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

    if MODE == "route" and ROUTE_COORDINATES:
        master_path.extend(ROUTE_COORDINATES)
    elif MODE == "svg" and SVG_STROKES:
        rad = math.radians(ROTATION_DEG)
        cos_r = math.cos(rad)
        sin_r = math.sin(rad)
        svg_span_lon = LETTER_W * 6.0 * SVG_SCALE
        svg_span_lat = LETTER_H * 4.0 * SVG_SCALE

        def transform_point(p):
            px = 1.0 - p[0] if FLIP_H else p[0]
            py = 1.0 - p[1] if FLIP_V else p[1]
            dx = px - 0.5
            dy = py - 0.5
            rx = dx * cos_r - dy * sin_r
            ry = dx * sin_r + dy * cos_r
            return (
                current_x + (rx + 0.5) * svg_span_lon,
                y0 - (ry + 0.5) * svg_span_lat
            )

        for stroke in SVG_STROKES:
            if len(stroke) < 2:
                continue
            stroke_local_path = []
            for i in range(len(stroke) - 1):
                p1_trans = transform_point(stroke[i])
                p2_trans = transform_point(stroke[i + 1])
                pts = interpolate_segment(p1_trans, p2_trans, step_size=effective_step)
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
        text_chars = text.upper()
        total_text_w = len(text_chars) * LETTER_W + max(0, len(text_chars) - 1) * GAP
        total_text_h = LETTER_H
        center_x = current_x + total_text_w / 2.0
        center_y = y0 - total_text_h / 2.0
        rad = math.radians(ROTATION_DEG)
        cos_r = math.cos(rad)
        sin_r = math.sin(rad)

        def transform_text_point(lon, lat):
            dx = lon - center_x
            dy = lat - center_y
            if FLIP_H:
                dx = -dx
            if FLIP_V:
                dy = -dy
            rx = dx * cos_r - dy * sin_r
            ry = dx * sin_r + dy * cos_r
            return (center_x + rx, center_y + ry)

        for ch in text_chars:
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

                    if ROTATION_DEG != 0 or FLIP_H or FLIP_V:
                        lon1, lat1 = transform_text_point(lon1, lat1)
                        lon2, lat2 = transform_text_point(lon2, lat2)
                    
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

            # Generate authentic AP identity based on chosen SSID profile
            ap_ssid, mac, ap_auth, ap_ch = generate_ap_identity(point_counter, ssid_prefix)
            
            if len(seen) > 200000:
                seen.clear()
            while mac in seen:
                ap_ssid, mac, ap_auth, ap_ch = generate_ap_identity(point_counter, ssid_prefix)
            seen.add(mac)

            lat = current_pt[1] + random.uniform(-0.000001, 0.000001)
            lon = current_pt[0] + random.uniform(-0.000001, 0.000001)
            freq = 2484 if ap_ch == 14 else (5000 + ap_ch * 5 if ap_ch > 14 else 2407 + ap_ch * 5)

            aps.append({
                "mac": mac,
                "ssid": ap_ssid,
                "auth": ap_auth,
                "first_seen": current_time.strftime("%Y-%m-%d %H:%M:%S"),
                "channel": ap_ch,
                "frequency": freq,
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
            f.write("WigleWifi-1.6,appRelease=1.0.22 (Beta 3),model=Biscuit Pro,release=v1.6.2,"
                    "device=Biscuit Pro,display=Biscuit Pro,board=Biscuit Pro,brand=Biscuit Shop,"
                    "star=Sol,body=3,subBody=0\\n")
        w = csv.writer(f)
        w.writerow(["MAC", "SSID", "AuthMode", "FirstSeen", "Channel", "Frequency", "RSSI",
                    "CurrentLatitude", "CurrentLongitude", "AltitudeMeters",
                    "AccuracyMeters", "RCOIs", "MfgrId", "Type"])
        for ap in aps:
            freq = ap.get("frequency") or (2484 if ap["channel"] == 14 else (5000 + ap["channel"] * 5 if ap["channel"] > 14 else 2407 + ap["channel"] * 5))
            w.writerow([ap["mac"], ap["ssid"], ap["auth"], ap["first_seen"],
                        ap["channel"], freq, ap["rssi"], ap["lat"], ap["lon"],
                        ap["alt"], ap["accuracy"], "", "", "WIFI"])

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
