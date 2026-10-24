/**
 * Channel Planning Advisor
 * Evaluates 2.4 GHz and 5 GHz wireless channel congestion using airtime utilization,
 * packet throughput counts, and co-channel access point density to provide
 * actionable channel planning recommendations.
 */

export const CHANNELS_24_PRIMARY = [1, 6, 11];
export const CHANNELS_5_PRIMARY = [36, 40, 44, 48, 149, 153, 157, 161];

/**
 * Calculates a normalized congestion score (0–100%) for a given Wi-Fi channel.
 * 
 * @param {number} channel - Target channel number
 * @param {object|Array} devices - Map or array of discovered APs
 * @param {object} [channelStats] - Channel packet counts { [ch]: count }
 * @param {number} [airtimePercent] - Live airtime utilization percentage (0–100)
 * @param {number} [activeChannel] - Currently tuned hardware channel
 * @returns {object} { congestionScore, apCount, packetCount, strongApCount, reason }
 */
export function calculateChannelCongestion(
  channel,
  devices = {},
  channelStats = {},
  airtimePercent = 0,
  activeChannel = null
) {
  const apList = Array.isArray(devices) ? devices : Object.values(devices || {});
  
  // Find APs on this channel
  const coChannelAps = apList.filter(d => Number(d.channel) === Number(channel));
  const apCount = coChannelAps.length;
  
  // Strong APs (> -70 dBm) cause severe co-channel contention
  const strongApCount = coChannelAps.filter(d => (d.rssi || -90) >= -70).length;

  // Packet volume weighting
  const chPktCount = channelStats[channel] || 0;
  const totalPkts = Object.values(channelStats).reduce((a, b) => a + (Number(b) || 0), 0);
  const pktRatio = totalPkts > 0 ? (chPktCount / totalPkts) : 0;

  // Baseline score components:
  // - Each AP adds ~15% congestion
  // - Each strong AP adds an extra ~10%
  // - Packet traffic ratio contributes up to 35%
  let score = (apCount * 15) + (strongApCount * 10) + (pktRatio * 35);

  // If this channel is the one currently being monitored, integrate real-time airtime
  if (activeChannel && Number(activeChannel) === Number(channel) && airtimePercent > 0) {
    score = (score * 0.5) + (airtimePercent * 0.5);
  }

  // Adjacent channel interference check for 2.4 GHz (channels ±1 and ±2 overlap heavily)
  if (channel <= 14) {
    const overlappingChannels = [channel - 2, channel - 1, channel + 1, channel + 2].filter(c => c >= 1 && c <= 14);
    let overlapApCount = 0;
    for (const oc of overlappingChannels) {
      overlapApCount += apList.filter(d => Number(d.channel) === oc).length;
    }
    score += overlapApCount * 8;
  }

  const congestionScore = Math.max(0, Math.min(100, Math.round(score)));

  // Generate explanation
  let reason = '';
  if (apCount === 0 && chPktCount === 0) {
    reason = `Channel ${channel} is completely clear with 0 detected networks.`;
  } else if (apCount === 0) {
    reason = `Channel ${channel} has 0 detected APs with minimal ambient traffic (${chPktCount.toLocaleString()} pkts).`;
  } else {
    reason = `Channel ${channel} has ${apCount} active network${apCount > 1 ? 's' : ''} (${strongApCount} strong)`;
    if (chPktCount > 0) {
      reason += ` and ${chPktCount.toLocaleString()} observed packets.`;
    } else {
      reason += '.';
    }
  }

  return {
    channel,
    congestionScore,
    apCount,
    packetCount: chPktCount,
    strongApCount,
    reason
  };
}

/**
 * Evaluates candidate 2.4 GHz and 5 GHz channels and provides optimal recommendations.
 * 
 * @param {object} params
 * @param {object|Array} [params.devices]
 * @param {object} [params.channelStats]
 * @param {number} [params.airtimePercent]
 * @param {number} [params.currentChannel]
 * @returns {object} Recommendations and detailed rankings
 */
export function getChannelRecommendations({
  devices = {},
  channelStats = {},
  airtimePercent = 0,
  currentChannel = 36
} = {}) {
  // 1. Evaluate 2.4 GHz non-overlapping channels (1, 6, 11)
  const scores24 = CHANNELS_24_PRIMARY.map(ch => 
    calculateChannelCongestion(ch, devices, channelStats, airtimePercent, currentChannel)
  );

  scores24.sort((a, b) => a.congestionScore - b.congestionScore);
  const best24 = scores24[0] || { channel: 6, congestionScore: 0, reason: 'Default clear channel' };

  // Contextual reason comparing best with runner-ups
  let detailedReason24 = best24.reason;
  const worst24 = scores24[scores24.length - 1];
  if (worst24 && worst24.channel !== best24.channel && worst24.apCount > best24.apCount) {
    detailedReason24 = `Channel ${best24.channel} has the lowest congestion (${best24.congestionScore}%), avoiding Channel ${worst24.channel} which is congested by ${worst24.apCount} neighboring network${worst24.apCount > 1 ? 's' : ''}.`;
  }

  // 2. Evaluate 5 GHz primary channels
  const scores5 = CHANNELS_5_PRIMARY.map(ch => 
    calculateChannelCongestion(ch, devices, channelStats, airtimePercent, currentChannel)
  );

  scores5.sort((a, b) => a.congestionScore - b.congestionScore);
  const top3_5GHz = scores5.slice(0, 3);
  const top5ChNames = top3_5GHz.map(s => s.channel).join(', ');

  const detailedReason5 = `Channels ${top5ChNames} exhibit minimal co-channel congestion with the lowest packet contention scores.`;

  return {
    recommended24: {
      channel: best24.channel,
      congestionScore: best24.congestionScore,
      apCount: best24.apCount,
      packetCount: best24.packetCount,
      reason: detailedReason24
    },
    recommended5: top3_5GHz.map(item => ({
      channel: item.channel,
      congestionScore: item.congestionScore,
      apCount: item.apCount,
      packetCount: item.packetCount,
      reason: item.reason
    })),
    reason5: detailedReason5,
    rankings24: scores24,
    rankings5: scores5
  };
}
