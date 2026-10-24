/**
 * 802.11 Airtime Utilization & Frame Duration Calculation Utility
 * 
 * Extracts 2-byte Duration field from 802.11 MAC headers and maintains
 * a rolling 1-second window to compute channel airtime congestion percentage.
 */

/**
 * Extracts the 802.11 duration value in microseconds from a MAC header offset.
 * Duration is located at bytes 2 and 3 of the 802.11 MAC header.
 * @param {Uint8Array|Array} buffer - Frame buffer
 * @param {number} macOffset - Offset where the 802.11 MAC header begins (after Radiotap)
 * @returns {number} Duration in microseconds (0 - 32767 µs)
 */
export function extractDurationUs(buffer, macOffset = 0) {
  if (!buffer || buffer.length < macOffset + 4) return 0;
  const rawDuration = buffer[macOffset + 2] | (buffer[macOffset + 3] << 8);
  // In IEEE 802.11, duration values are in microseconds when bit 15 is 0 (0..32767 µs).
  // Values with bit 15 set (e.g. AID in PS-Poll) are not standard frame duration intervals.
  return rawDuration <= 32767 ? rawDuration : 0;
}

/**
 * Calculates Airtime Utilization percentage over a 1-second (1,000,000 µs) rolling window.
 * Formula: Airtime % = (Total Duration in 1 second / 1,000,000) * 100
 * 
 * @param {Array<{ timestamp: number, duration: number }>} records - Array of duration records
 * @param {number} now - Current timestamp in milliseconds (defaults to Date.now())
 * @param {number} windowMs - Rolling window duration in ms (defaults to 1000ms)
 * @returns {{ airtimePercent: number, totalDurationUs: number, frameCount: number, congestionLevel: 'normal'|'warning'|'critical' }}
 */
export function calculateAirtime(records, now = Date.now(), windowMs = 1000) {
  if (!Array.isArray(records) || records.length === 0) {
    return {
      airtimePercent: 0,
      totalDurationUs: 0,
      frameCount: 0,
      congestionLevel: 'normal'
    };
  }

  const cutoff = now - windowMs;
  let totalDurationUs = 0;
  let frameCount = 0;

  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r && typeof r.duration === 'number' && r.duration > 0) {
      if (typeof r.timestamp === 'number' && r.timestamp >= cutoff && r.timestamp <= now + 500) {
        totalDurationUs += r.duration;
        frameCount++;
      }
    }
  }

  // Calculate Airtime % = (Total Duration in 1s / 1,000,000 µs) * 100
  const rawPercent = (totalDurationUs / 1000000) * 100;
  // Clamp between 0.0% and 100.0%
  const airtimePercent = Math.min(100, Math.max(0, Number(rawPercent.toFixed(1))));

  let congestionLevel = 'normal';
  if (airtimePercent > 70) {
    congestionLevel = 'critical'; // Red (>70%)
  } else if (airtimePercent >= 40) {
    congestionLevel = 'warning'; // Yellow (40-70%)
  }

  return {
    airtimePercent,
    totalDurationUs,
    frameCount,
    congestionLevel
  };
}

/**
 * AirtimeTracker maintains a rolling duration buffer over a sliding window
 * for real-time channel congestion tracking.
 */
export class AirtimeTracker {
  constructor(windowMs = 1000) {
    this.windowMs = windowMs;
    this.records = [];
  }

  /**
   * Adds an observed frame duration to the rolling buffer.
   * @param {number} durationUs - Duration in microseconds
   * @param {number} timestamp - Observation timestamp in ms (defaults to Date.now())
   */
  addFrame(durationUs, timestamp = Date.now()) {
    if (typeof durationUs === 'number' && durationUs > 0) {
      this.records.push({ timestamp, duration: durationUs });
    }
    this.prune(timestamp);
  }

  /**
   * Prunes records older than the sliding window.
   * @param {number} now 
   */
  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    while (this.records.length > 0 && this.records[0].timestamp < cutoff) {
      this.records.shift();
    }
  }

  /**
   * Returns current Airtime metrics over the sliding window.
   * @param {number} now 
   * @returns {{ airtimePercent: number, totalDurationUs: number, frameCount: number, congestionLevel: string }}
   */
  getAirtime(now = Date.now()) {
    this.prune(now);
    return calculateAirtime(this.records, now, this.windowMs);
  }

  /**
   * Clears all recorded frame durations.
   */
  reset() {
    this.records = [];
  }
}
