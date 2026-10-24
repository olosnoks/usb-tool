/**
 * 802.11 High-Performance Frame Parser Web Worker
 * Offloads compute-heavy radiotap (including Noise Floor & SNR calculation), MAC, IE,
 * security (including WPA2/WPA3 Mixed-Mode and 802.11w MFP detection),
 * cleartext telemetry metadata extraction, and rolling Airtime Utilization calculation.
 * 
 * Batches structured parsed frames and airtime telemetry every 200ms to eliminate UI stutter.
 */

import { parse80211Frame } from '../utils/wifiParser.js';
import { AirtimeTracker } from '../utils/airtimeCalculator.js';

let pendingBatch = [];
let pendingL3Mappings = [];
let batchInterval = null;
let sensitivityThreshold = -100;
let lastReportedAirtime = 0;

// Maintain rolling 1-second (1000ms) airtime duration window
const airtimeTracker = new AirtimeTracker(1000);

// Flush batch of parsed frames & airtime utilization to main thread every 200ms
function flushBatch() {
  const airtime = airtimeTracker.getAirtime();
  if (pendingBatch.length > 0 || airtime.airtimePercent !== lastReportedAirtime || pendingL3Mappings.length > 0) {
    lastReportedAirtime = airtime.airtimePercent;
    self.postMessage({
      type: 'BATCH_PARSED',
      frames: pendingBatch,
      count: pendingBatch.length,
      airtimePercent: airtime.airtimePercent,
      totalAirtimeDurationUs: airtime.totalDurationUs,
      airtimeCongestionLevel: airtime.congestionLevel,
      layer3Mappings: pendingL3Mappings
    });
    pendingBatch = [];
    pendingL3Mappings = [];
  }
}

// Start timer for periodic batch flushing
batchInterval = setInterval(flushBatch, 200);

self.onmessage = function (event) {
  const data = event.data;
  if (!data) return;

  if (data.type === 'SET_THRESHOLD') {
    if (typeof data.threshold === 'number') {
      sensitivityThreshold = data.threshold;
    }
  } else if (data.type === 'PARSE_BUFFER') {
    const raw = data.buffer;
    if (!raw) return;

    try {
      const uint8 = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
      const parsed = parse80211Frame(uint8);

      if (parsed) {
        // Track duration across all observed frames in rolling 1-second window
        if (typeof parsed.duration === 'number' && parsed.duration > 0) {
          airtimeTracker.addFrame(parsed.duration, Date.now());
        }

        if (parsed.l3Metadata) {
          pendingL3Mappings.push({
            ...parsed.l3Metadata,
            timestamp: parsed.timestamp || new Date().toISOString(),
            bssid: parsed.bssid,
            channel: parsed.channel
          });
        }

        if (parsed.rssi !== undefined && parsed.rssi < sensitivityThreshold) {
          return;
        }
        if (data.channel && !parsed.channel) {
          parsed.channel = data.channel;
        }

        // Control frames are used for airtime/duration metrics but skipped for node lists
        if (parsed.frameCategory !== 'Control') {
          pendingBatch.push(parsed);
        }
      }
    } catch (err) {
      console.warn('Worker parsing error:', err);
    }
  } else if (data.type === 'PARSE_BATCH') {
    const buffers = data.buffers || [];
    for (const b of buffers) {
      try {
        const uint8 = b instanceof Uint8Array ? b : new Uint8Array(b);
        const parsed = parse80211Frame(uint8);
        if (parsed) {
          if (typeof parsed.duration === 'number' && parsed.duration > 0) {
            airtimeTracker.addFrame(parsed.duration, Date.now());
          }

          if (parsed.l3Metadata) {
            pendingL3Mappings.push({
              ...parsed.l3Metadata,
              timestamp: parsed.timestamp || new Date().toISOString(),
              bssid: parsed.bssid,
              channel: parsed.channel
            });
          }

          if (parsed.rssi !== undefined && parsed.rssi < sensitivityThreshold) {
            continue;
          }
          if (data.channel && !parsed.channel) {
            parsed.channel = data.channel;
          }

          if (parsed.frameCategory !== 'Control') {
            pendingBatch.push(parsed);
          }
        }
      } catch (e) {
        // ignore individual corrupted packet
      }
    }
  } else if (data.type === 'FLUSH') {
    flushBatch();
  }
};
