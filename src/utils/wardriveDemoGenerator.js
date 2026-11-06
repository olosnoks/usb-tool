/**
 * Wardrive Demo & Map Art Data Generator
 * Generates synthetic Wi-Fi Access Point trails forming readable vector text on geolocation maps (Kepler.gl / WiGLE).
 */

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
 * Generate synthetic Access Points tracing text along a vector font path.
 */
export function generateDemoAps(options = {}) {
  const {
    text = 'KEPLER',
    latCenter = 32.25,
    lonCenter = -90.13,
    letterW = 0.04,
    letterH = 0.06,
    gap = 0.02,
    stepSize = 0.0008,
    speedDegPerSec = 0.00015,
    stepIntervalSeconds = 3,
    endTime = null,
    seed = 42
  } = options;

  const cleanText = String(text || '').trim();
  if (!cleanText) {
    return { aps: [], masterPath: [], bounds: null };
  }

  const masterPath = [];
  let currentX = Number(lonCenter);
  const y0 = Number(latCenter);

  for (const ch of cleanText.toUpperCase()) {
    const strokes = VECTOR_FONTS[ch] || VECTOR_FONTS[" "];
    const letterLocalPath = [];

    for (const stroke of strokes) {
      for (let i = 0; i < stroke.length - 1; i++) {
        const p1Rel = stroke[i];
        const p2Rel = stroke[i + 1];

        const lon1 = currentX + p1Rel[0] * letterW;
        const lat1 = y0 - p1Rel[1] * letterH;
        const lon2 = currentX + p2Rel[0] * letterW;
        const lat2 = y0 - p2Rel[1] * letterH;

        const pts = interpolateSegment([lon1, lat1], [lon2, lat2], stepSize);
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
        const bridgePts = interpolateSegment(endPt, startPt, stepSize);
        masterPath.push(...bridgePts.slice(1));
      }
      masterPath.push(...letterLocalPath);
    }

    currentX += letterW + gap;
  }

  const aps = [];
  if (masterPath.length === 0) {
    return { aps, masterPath, bounds: null };
  }

  const baseEndTime = endTime instanceof Date ? new Date(endTime.getTime()) : new Date(Date.now() - 24 * 3600 * 1000);
  let currentTime = new Date(baseEndTime.getTime() - 2 * 3600 * 1000);

  let currentPt = masterPath[0];
  let pathIdx = 0;
  let pointCounter = 1;
  const rng = createPrng(seed);
  const seen = new Set();
  const ssidPrefix = cleanText.replace(/\s+/g, '_').toUpperCase();

  const stepDist = speedDegPerSec * stepIntervalSeconds;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;

  while (pathIdx < masterPath.length - 1) {
    const targetPt = masterPath[pathIdx + 1];
    const dx = targetPt[0] - currentPt[0];
    const dy = targetPt[1] - currentPt[1];
    const segDist = Math.sqrt(dx * dx + dy * dy);

    if (segDist === 0) {
      pathIdx += 1;
      continue;
    }

    if (segDist <= stepDist) {
      currentPt = targetPt;
      pathIdx += 1;
    } else {
      const fraction = stepDist / segDist;
      currentPt = [
        currentPt[0] + dx * fraction,
        currentPt[1] + dy * fraction
      ];
    }

    currentTime = new Date(currentTime.getTime() + stepIntervalSeconds * 1000);

    // Generate a globally unique, unicast MAC address
    const genMac = () => {
      let firstOctet = rng.randrange(256) & 0xFE; // Clear multicast bit
      firstOctet &= 0xFD;                        // Clear local/private bit
      const secondNibble = rng.choice([0, 4, 8, 12]);
      const firstHex = (((firstOctet & 0xF0) | secondNibble) >>> 0).toString(16).padStart(2, '0').toUpperCase();
      const rest = Array.from({ length: 5 }, () => rng.randrange(256).toString(16).padStart(2, '0').toUpperCase()).join(':');
      return `${firstHex}:${rest}`;
    };

    let mac = genMac();
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

  const bounds = isFinite(minLat) ? { minLat, maxLat, minLon, maxLon } : null;

  return {
    aps,
    masterPath,
    bounds,
    durationSeconds: aps.length * stepIntervalSeconds
  };
}

/**
 * Generate standard WiGLE Wifi 1.4 CSV format.
 */
export function generateWigleCsv(aps, includePreheader = true) {
  const lines = [];
  if (includePreheader) {
    lines.push("WigleWifi-1.4,appRelease=1.0,model=Simulator,release=1.0,device=simulator,display=sim,board=sim,brand=Synthetic");
  }
  lines.push("MAC,SSID,AuthMode,FirstSeen,Channel,RSSI,CurrentLatitude,CurrentLongitude,AltitudeMeters,AccuracyMeters,Type");
  for (const ap of aps) {
    lines.push([
      ap.mac,
      ap.ssid,
      ap.auth,
      ap.first_seen,
      ap.channel,
      ap.rssi,
      ap.lat,
      ap.lon,
      ap.alt,
      ap.accuracy,
      "WIFI"
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * Generate Kepler.gl / generic test CSV format.
 */
export function generateTestCsv(aps) {
  const lines = ["mac,ssid,auth,first_seen,channel,rssi,lat,lon"];
  for (const ap of aps) {
    lines.push([
      ap.mac,
      ap.ssid,
      ap.auth,
      ap.first_seen,
      ap.channel,
      ap.rssi,
      ap.lat,
      ap.lon
    ].join(","));
  }
  return lines.join("\n") + "\n";
}

/**
 * Generates the standalone Python script with user's selected parameters ready for standalone CLI execution.
 */
export function exportPythonScriptSource({
  text = 'KEPLER',
  latCenter = 32.25,
  lonCenter = -90.13,
  letterW = 0.04,
  letterH = 0.06,
  gap = 0.02
} = {}) {
  return `import csv
import random
import math
from datetime import datetime, timedelta

# Creates words made from generated APs to poison or decorate war driving maps
# Test Here: kepler.gl/demo

LAT_CENTER, LON_CENTER = ${latCenter}, ${lonCenter}  # Selected origin coordinates
LETTER_W, LETTER_H = ${letterW}, ${letterH}        # Physical size in degrees
GAP = ${gap}                             # Clean spacing between letters
INCLUDE_PREHEADER = True           
END_TIME = datetime.now() - timedelta(days=1)    

# Clean, ordered vector strokes for letters and numbers (Relative coordinates 0.0 to 1.0)
VECTOR_FONTS = ${JSON.stringify(VECTOR_FONTS, null, 4)}

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
                
                pts = interpolate_segment((lon1, lat1), (lon2, lat2), step_size=0.0008)
                if letter_local_path:
                    letter_local_path.extend(pts[1:])  
                else:
                    letter_local_path.extend(pts)
        
        if letter_local_path:
            if master_path:
                end_pt = master_path[-1]
                start_pt = letter_local_path[0]
                bridge_pts = interpolate_segment(end_pt, start_pt, step_size=0.0008)
                master_path.extend(bridge_pts[1:])
            master_path.extend(letter_local_path)
            
        current_x += LETTER_W + GAP

    aps = []
    current_time = END_TIME - timedelta(hours=2)
    speed_deg_per_sec = 0.00015  
    
    if not master_path:
        return aps

    current_pt = master_path[0]
    path_idx = 0
    point_counter = 1
    random.seed(42)
    seen = set()

    ssid_prefix = text.replace(" ", "_").upper()

    while path_idx < len(master_path) - 1:
        target_pt = master_path[path_idx + 1]
        
        dx = target_pt[0] - current_pt[0]
        dy = target_pt[1] - current_pt[1]
        seg_dist = math.sqrt(dx*dx + dy*dy)
        
        if seg_dist == 0:
            path_idx += 1
            continue

        step_dist = speed_deg_per_sec * 3  
        if seg_dist <= step_dist:
            current_pt = target_pt
            path_idx += 1
        else:
            fraction = step_dist / seg_dist
            current_pt = (
                current_pt[0] + dx * fraction,
                current_pt[1] + dy * fraction
            )

        current_time += timedelta(seconds=3)

        first_octet = random.randrange(256) & 0xFE
        first_octet &= 0xFD
        second_nibble = random.choice([0, 4, 8, 12])
        first_hex = f"{(first_octet & 0xF0) | second_nibble:02X}"
        mac = first_hex + ":" + ":".join(f"{random.randrange(256):02X}" for _ in range(5))
        
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
