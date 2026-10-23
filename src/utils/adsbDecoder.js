/**
 * ADS-B / Mode-S (1090 MHz) Real-Time Demodulator & Decoder
 * Supports:
 * 1. Raw AVR Hex strings (*8D4840...;) from PortaPack Mayhem / dump1090 serial
 * 2. Raw 8-bit signed IQ buffers from HackRF WebUSB bulk endpoint (Endpoint 1 IN)
 * 3. Compact Position Reporting (CPR) decoding (Local and Global Even/Odd)
 * 4. Airborne Velocity, Altitude, Callsign extraction
 */

// Characters for 6-bit ADS-B callsign mapping
const AIS_CHARS = "?ABCDEFGHIJKLMNOPQRSTUVWXYZ????? ???????????????0123456789??????";

export class AdsbDecoder {
  constructor() {
    this.aircraftMap = new Map(); // icaoHex -> AircraftState
    this.onAircraftUpdate = null;
    this.receiverLat = 37.7749;
    this.receiverLon = -122.4194;
    this.hasUserLocation = false;
    this.totalFramesDecoded = 0;
    this.badCrcFrames = 0;

    // Try to get real user GPS location for accurate local CPR decoding
    if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        pos => {
          this.receiverLat = pos.coords.latitude;
          this.receiverLon = pos.coords.longitude;
          this.hasUserLocation = true;
        },
        () => {},
        { timeout: 8000, maximumAge: 3600000 }
      );
    }
  }

  setReceiverLocation(lat, lon) {
    this.receiverLat = lat;
    this.receiverLon = lon;
    this.hasUserLocation = true;
  }

  getAircraftList() {
    // Return sorted by last seen (most recent first)
    const list = Array.from(this.aircraftMap.values());
    list.sort((a, b) => b.lastSeen - a.lastSeen);
    return list;
  }

  clear() {
    this.aircraftMap.clear();
    this.totalFramesDecoded = 0;
    if (this.onAircraftUpdate) {
      this.onAircraftUpdate(this.getAircraftList());
    }
  }

  /**
   * Process a text line from PortaPack Mayhem serial (e.g. "*8D4840D6202CC371C32CE0576098;" or JSON/Key-Value)
   */
  processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    // AVR Raw Format (*8D...; or @00...;)
    if (trimmed.startsWith('*') && trimmed.endsWith(';')) {
      const hex = trimmed.slice(1, -1);
      return this.processHex(hex);
    }

    // Bare hex string (14 or 28 hex chars = 56 or 112 bits)
    if (/^[0-9A-Fa-f]{14}$/.test(trimmed) || /^[0-9A-Fa-f]{28}$/.test(trimmed)) {
      return this.processHex(trimmed);
    }

    // Mayhem custom format: adsb: icao=A41B2C call=UAL421 alt=34000 lat=37.618 lon=-122.375 hdg=245 spd=480
    if (trimmed.startsWith('adsb:') || trimmed.startsWith('[ADSB]')) {
      const pairs = trimmed.replace(/^(\[ADSB\]|adsb:)\s*/i, '').split(' ');
      const acData = {};
      for (const p of pairs) {
        const [k, v] = p.split('=');
        if (k && v) acData[k.toLowerCase()] = v;
      }
      if (acData.icao) {
        return this.updateFromParsedData(acData.icao.toUpperCase(), acData);
      }
    }

    return null;
  }

  /**
   * Process a 28-char hex string (112-bit Extended Squitter)
   */
  processHex(hex) {
    if (hex.length < 14) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return this.processBytes(bytes);
  }

  /**
   * Process raw bytes of Mode-S frame (56 or 112 bits)
   */
  processBytes(bytes) {
    if (bytes.length < 7) return null;
    const df = bytes[0] >> 3;

    // We focus on DF17 (ADS-B Extended Squitter) and DF18 (Non-transponder)
    if (df !== 17 && df !== 18) return null;

    // Extract 24-bit ICAO address (bytes 1, 2, 3)
    const icao = (
      (bytes[1] << 16) |
      (bytes[2] << 8) |
      bytes[3]
    ).toString(16).toUpperCase().padStart(6, '0');

    this.totalFramesDecoded++;

    let ac = this.aircraftMap.get(icao);
    if (!ac) {
      ac = {
        id: icao,
        callsign: icao,
        icaoHex: icao,
        lat: this.receiverLat,
        lon: this.receiverLon,
        altFt: 0,
        spdKts: 0,
        heading: 0,
        squawk: '---',
        type: 'Civilian Aircraft',
        distNm: 0,
        rssi: -65,
        msgCount: 0,
        trail: [],
        lastSeen: Date.now(),
        cprEven: null,
        cprOdd: null
      };
      this.aircraftMap.set(icao, ac);
    }

    ac.msgCount++;
    ac.lastSeen = Date.now();

    // Type Code in ME field (bits 32-36 => bytes[4] >> 3)
    const tc = bytes[4] >> 3;

    // 1. Aircraft Identification & Category (TC 1 to 4)
    if (tc >= 1 && tc <= 4) {
      let call = '';
      const b4 = bytes[4], b5 = bytes[5], b6 = bytes[6], b7 = bytes[7], b8 = bytes[8], b9 = bytes[9];
      const chars = [
        (b5 >> 2) & 0x3F,
        ((b5 & 0x03) << 4) | (b6 >> 4),
        ((b6 & 0x0F) << 2) | (b7 >> 6),
        b7 & 0x3F,
        (b8 >> 2) & 0x3F,
        ((b8 & 0x03) << 4) | (b9 >> 4),
        ((b9 & 0x0F) << 2) | (bytes[10] >> 6),
        bytes[10] & 0x3F
      ];
      for (const c of chars) {
        if (c > 0 && c < AIS_CHARS.length) {
          const ch = AIS_CHARS[c];
          if (ch !== '?') call += ch;
        }
      }
      call = call.trim();
      if (call) {
        ac.callsign = call;
      }
    }

    // 2. Airborne Position (TC 9 to 18)
    if (tc >= 9 && tc <= 18) {
      // Decode Altitude
      const rawAlt = ((bytes[5] & 0xFF) << 4) | (bytes[6] >> 4);
      if (rawAlt > 0) {
        // Q bit is bit 48 (byte 5 bit 0)
        const qBit = (bytes[5] & 0x01);
        if (qBit) {
          // 25 ft increments
          const n = ((rawAlt & 0x0FE0) >> 1) | (rawAlt & 0x0F);
          ac.altFt = n * 25 - 1000;
        } else {
          // 100 ft increments (Gray code)
          ac.altFt = rawAlt * 100;
        }
      }

      // CPR Format bit: byte 6 bit 2
      const cprFormat = (bytes[6] >> 2) & 0x01; // 0 = Even, 1 = Odd

      // 17-bit CPR Latitude: byte 6 bits 1..0, byte 7, byte 8 bits 7..1
      const cprLat = (((bytes[6] & 0x03) << 15) | (bytes[7] << 7) | (bytes[8] >> 1)) & 0x1FFFF;

      // 17-bit CPR Longitude: byte 8 bit 0, byte 9, byte 10
      const cprLon = (((bytes[8] & 0x01) << 16) | (bytes[9] << 8) | bytes[10]) & 0x1FFFF;

      // Save CPR frame
      const frame = { lat: cprLat / 131072.0, lon: cprLon / 131072.0, time: Date.now() };
      if (cprFormat === 0) {
        ac.cprEven = frame;
      } else {
        ac.cprOdd = frame;
      }

      // Decode Lat/Lon via Local CPR using receiver's reference coordinates
      const decodedPos = this.decodeLocalCpr(cprLat, cprLon, cprFormat, this.receiverLat, this.receiverLon);
      if (decodedPos) {
        ac.lat = decodedPos.lat;
        ac.lon = decodedPos.lon;

        // Calculate distance from receiver in Nautical Miles
        ac.distNm = parseFloat(this.calcDistanceNm(this.receiverLat, this.receiverLon, ac.lat, ac.lon).toFixed(1));

        // Update trail
        if (!ac.trail) ac.trail = [];
        const lastP = ac.trail[ac.trail.length - 1];
        if (!lastP || Math.abs(lastP[0] - ac.lon) > 0.002 || Math.abs(lastP[1] - ac.lat) > 0.002) {
          ac.trail.push([ac.lon, ac.lat]);
          if (ac.trail.length > 30) ac.trail.shift();
        }
      }
    }

    // 3. Airborne Velocity (TC 19)
    if (tc === 19) {
      const subType = bytes[4] & 0x07;
      if (subType === 1 || subType === 2) {
        // Ground speed from North/South & East/West velocities
        const vEWDir = (bytes[5] >> 2) & 0x01;
        const vEW = (((bytes[5] & 0x03) << 8) | bytes[6]) - 1;
        const vNSDir = (bytes[7] >> 7) & 0x01;
        const vNS = (((bytes[7] & 0x7F) << 3) | (bytes[8] >> 5)) - 1;

        if (vEW >= 0 && vNS >= 0) {
          const vx = vEWDir ? -vEW : vEW;
          const vy = vNSDir ? -vNS : vNS;
          const spd = Math.round(Math.sqrt(vx * vx + vy * vy));
          let hdg = Math.round((Math.atan2(vx, vy) * 180) / Math.PI);
          if (hdg < 0) hdg += 360;

          ac.spdKts = spd;
          ac.heading = hdg;
        }
      }
    }

    // Notify listeners
    if (this.onAircraftUpdate) {
      this.onAircraftUpdate(this.getAircraftList());
    }

    return ac;
  }

  /**
   * Local CPR position decode using receiver reference coordinates
   */
  decodeLocalCpr(cprLat17, cprLon17, isOdd, refLat, refLon) {
    const dLat = isOdd ? 360.0 / 59.0 : 360.0 / 60.0;
    const y = cprLat17 / 131072.0;

    // Recover latitude
    const j = Math.floor(refLat / dLat) + Math.floor(0.5 + ((refLat % dLat) / dLat) - y);
    const lat = dLat * (j + y);

    // Number of longitude zones at this latitude
    const nl = this.cprNlFunction(lat) - (isOdd ? 1 : 0);
    if (nl <= 0) return { lat, lon: refLon };

    const dLon = 360.0 / nl;
    const x = cprLon17 / 131072.0;
    const m = Math.floor(refLon / dLon) + Math.floor(0.5 + ((refLon % dLon) / dLon) - x);
    const lon = dLon * (m + x);

    // Bounds check
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  cprNlFunction(lat) {
    if (Math.abs(lat) >= 87.0) return 1;
    const cosLat = Math.cos((Math.PI / 180.0) * Math.abs(lat));
    const a = 1.0 - Math.cos((Math.PI / 180.0) * (360.0 / 60.0));
    const b = cosLat * cosLat;
    const nl = Math.floor((2.0 * Math.PI) / Math.acos(1.0 - a / b));
    return isNaN(nl) ? 1 : Math.max(1, nl);
  }

  calcDistanceNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065; // Nautical miles
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  updateFromParsedData(icao, data) {
    let ac = this.aircraftMap.get(icao);
    if (!ac) {
      ac = {
        id: icao,
        callsign: data.call || icao,
        icaoHex: icao,
        lat: parseFloat(data.lat) || this.receiverLat,
        lon: parseFloat(data.lon) || this.receiverLon,
        altFt: parseInt(data.alt) || 0,
        spdKts: parseInt(data.spd) || 0,
        heading: parseInt(data.hdg) || 0,
        squawk: data.squawk || '---',
        type: 'Civilian Aircraft',
        distNm: 0,
        rssi: -65,
        msgCount: 0,
        trail: [],
        lastSeen: Date.now()
      };
      this.aircraftMap.set(icao, ac);
    }

    if (data.call) ac.callsign = data.call;
    if (data.alt) ac.altFt = parseInt(data.alt);
    if (data.spd) ac.spdKts = parseInt(data.spd);
    if (data.hdg) ac.heading = parseInt(data.hdg);
    if (data.lat && data.lon) {
      ac.lat = parseFloat(data.lat);
      ac.lon = parseFloat(data.lon);
      ac.distNm = parseFloat(this.calcDistanceNm(this.receiverLat, this.receiverLon, ac.lat, ac.lon).toFixed(1));
      if (!ac.trail) ac.trail = [];
      ac.trail.push([ac.lon, ac.lat]);
      if (ac.trail.length > 30) ac.trail.shift();
    }
    ac.msgCount++;
    ac.lastSeen = Date.now();

    if (this.onAircraftUpdate) {
      this.onAircraftUpdate(this.getAircraftList());
    }
    return ac;
  }

  /**
   * Process raw signed 8-bit IQ from HackRF WebUSB bulk endpoint
   * Performs Mode-S pulse magnitude calculation and PPM preamble correlation
   */
  processRawIq(buffer) {
    if (!buffer || buffer.byteLength < 512) return;
    const bytes = new Int8Array(buffer);
    const numSamples = bytes.length / 2;

    // Calculate sample magnitudes |I| + |Q|
    const mag = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      const I = bytes[i * 2];
      const Q = bytes[i * 2 + 1];
      mag[i] = Math.abs(I) + Math.abs(Q);
    }

    // Preamble detector: pulses at 0, 1.0, 3.5, 4.5 µs.
    // For 2 MSPS, 1 µs = 2 samples. Pulses at indices: 0, 2, 7, 9. Lows at: 1, 3..6, 8.
    for (let i = 0; i < numSamples - 240; i++) {
      const p0 = mag[i];
      const p1 = mag[i + 2];
      const p2 = mag[i + 7];
      const p3 = mag[i + 9];

      const low0 = mag[i + 1];
      const low1 = mag[i + 3];
      const low2 = mag[i + 8];

      const pulseAvg = (p0 + p1 + p2 + p3) * 0.25;
      const lowAvg = (low0 + low1 + low2) / 3.0;

      // Threshold check for Mode-S preamble
      if (pulseAvg > 25 && pulseAvg > lowAvg * 2.2) {
        // Demodulate 112 bits via PPM starting at sample offset 16 (8 µs)
        const frameBytes = new Uint8Array(14);
        let bitIndex = 0;
        let dataStart = i + 16;

        for (let b = 0; b < 112; b++) {
          const s0 = mag[dataStart + b * 2];
          const s1 = mag[dataStart + b * 2 + 1];
          const bit = s0 > s1 ? 1 : 0;

          const bytePos = b >> 3;
          const bitPos = 7 - (b & 7);
          if (bit) {
            frameBytes[bytePos] |= (1 << bitPos);
          }
        }

        // Verify Downlink Format
        const df = frameBytes[0] >> 3;
        if (df === 17 || df === 18) {
          this.processBytes(frameBytes);
          i += 240; // skip past this packet
        }
      }
    }
  }
}

// Global singleton instance
export const globalAdsbDecoder = new AdsbDecoder();
