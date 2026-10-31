// Constants and small helpers shared by the Wi-Fi Monitor workbench and its tabs.

export const POPULAR_CHANNELS = [
  // 2.4 GHz
  { ch: 1, freq: '2412 MHz', band: '2.4 GHz' },
  { ch: 6, freq: '2437 MHz', band: '2.4 GHz' },
  { ch: 11, freq: '2462 MHz', band: '2.4 GHz' },
  // 5 GHz UNII-1
  { ch: 36, freq: '5180 MHz', band: '5 GHz' },
  { ch: 40, freq: '5200 MHz', band: '5 GHz' },
  { ch: 44, freq: '5220 MHz', band: '5 GHz' },
  { ch: 48, freq: '5240 MHz', band: '5 GHz' },
  // 5 GHz UNII-2
  { ch: 52, freq: '5260 MHz', band: '5 GHz' },
  { ch: 60, freq: '5300 MHz', band: '5 GHz' },
  // 5 GHz UNII-2e
  { ch: 100, freq: '5500 MHz', band: '5 GHz' },
  { ch: 140, freq: '5700 MHz', band: '5 GHz' },
  // 5 GHz UNII-3
  { ch: 149, freq: '5745 MHz', band: '5 GHz' },
  { ch: 153, freq: '5765 MHz', band: '5 GHz' },
  { ch: 157, freq: '5785 MHz', band: '5 GHz' },
  { ch: 161, freq: '5805 MHz', band: '5 GHz' },
  { ch: 165, freq: '5825 MHz', band: '5 GHz' }
];

export const ALL_SPECTRUM_CHANNELS = [
  // 2.4 GHz Channels 1 - 14
  { ch: 1, freq: '2412 MHz', band: '2.4 GHz' },
  { ch: 2, freq: '2417 MHz', band: '2.4 GHz' },
  { ch: 3, freq: '2422 MHz', band: '2.4 GHz' },
  { ch: 4, freq: '2427 MHz', band: '2.4 GHz' },
  { ch: 5, freq: '2432 MHz', band: '2.4 GHz' },
  { ch: 6, freq: '2437 MHz', band: '2.4 GHz' },
  { ch: 7, freq: '2442 MHz', band: '2.4 GHz' },
  { ch: 8, freq: '2447 MHz', band: '2.4 GHz' },
  { ch: 9, freq: '2452 MHz', band: '2.4 GHz' },
  { ch: 10, freq: '2457 MHz', band: '2.4 GHz' },
  { ch: 11, freq: '2462 MHz', band: '2.4 GHz' },
  { ch: 12, freq: '2467 MHz', band: '2.4 GHz' },
  { ch: 13, freq: '2472 MHz', band: '2.4 GHz' },
  { ch: 14, freq: '2484 MHz', band: '2.4 GHz' },
  // 5 GHz UNII Channels
  { ch: 36, freq: '5180 MHz', band: '5 GHz' },
  { ch: 40, freq: '5200 MHz', band: '5 GHz' },
  { ch: 44, freq: '5220 MHz', band: '5 GHz' },
  { ch: 48, freq: '5240 MHz', band: '5 GHz' },
  { ch: 52, freq: '5260 MHz', band: '5 GHz' },
  { ch: 56, freq: '5280 MHz', band: '5 GHz' },
  { ch: 60, freq: '5300 MHz', band: '5 GHz' },
  { ch: 64, freq: '5320 MHz', band: '5 GHz' },
  { ch: 100, freq: '5500 MHz', band: '5 GHz' },
  { ch: 104, freq: '5520 MHz', band: '5 GHz' },
  { ch: 108, freq: '5540 MHz', band: '5 GHz' },
  { ch: 112, freq: '5560 MHz', band: '5 GHz' },
  { ch: 116, freq: '5580 MHz', band: '5 GHz' },
  { ch: 120, freq: '5600 MHz', band: '5 GHz' },
  { ch: 124, freq: '5620 MHz', band: '5 GHz' },
  { ch: 128, freq: '5640 MHz', band: '5 GHz' },
  { ch: 132, freq: '5660 MHz', band: '5 GHz' },
  { ch: 136, freq: '5680 MHz', band: '5 GHz' },
  { ch: 140, freq: '5700 MHz', band: '5 GHz' },
  { ch: 144, freq: '5720 MHz', band: '5 GHz' },
  { ch: 149, freq: '5745 MHz', band: '5 GHz' },
  { ch: 153, freq: '5765 MHz', band: '5 GHz' },
  { ch: 157, freq: '5785 MHz', band: '5 GHz' },
  { ch: 161, freq: '5805 MHz', band: '5 GHz' },
  { ch: 165, freq: '5825 MHz', band: '5 GHz' }
];

export const HOP_CHANNELS = [1, 6, 11, 36, 40, 44, 48];
export const PCAP_MAX_CAPACITY = 50000;
export const ROWS_PER_PAGE = 100;

// Upper bound on tracked APs/clients held in React state. Without a cap the
// dictionaries grow without limit on long or dense captures, and since each
// 500ms flush shallow-clones the whole dictionary that cost climbs with every
// new node. Once over the cap we age out the least-recently-seen entries.
export const MAX_TRACKED_NODES = 3000;

// Delete the oldest entries (by timestamp field tsKey) from a keyed object
// until it holds at most cap keys. Mutates and returns the same object.
export function pruneOldestEntries(dict, cap, tsKey) {
  const key = tsKey || 'lastSeenTimestamp';
  const keys = Object.keys(dict);
  if (keys.length <= cap) return dict;
  const sorted = keys.sort(function (a, b) {
    const ta = (dict[a] && dict[a][key]) || 0;
    const tb = (dict[b] && dict[b][key]) || 0;
    return ta - tb;
  });
  const removeCount = keys.length - cap;
  for (let i = 0; i < removeCount; i++) {
    delete dict[sorted[i]];
  }
  return dict;
}

/**
 * Lightweight SVG sparkline tracking RSSI signal trends over time.
 * Dynamic color-coding: Emerald for strong, Cyan for moderate, Rose for weak.
 */
export function Sparkline({ data = [], width = 56, height = 18 }) {
  if (!data || data.length < 2) {
    return (
      <span className="text-[10px] text-slate-600 font-mono italic select-none">
        —
      </span>
    );
  }
  const min = -95;
  const max = -30;
  const range = max - min || 1;
  const padY = 2;
  const effH = height - padY * 2;
  const points = data.map((val, idx) => {
    const clamped = Math.max(min, Math.min(max, val));
    const x = (idx / (data.length - 1)) * width;
    const y = padY + effH - ((clamped - min) / range) * effH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const lastVal = data[data.length - 1];
  const stroke = lastVal > -60 ? '#10b981' : lastVal > -75 ? '#22d3ee' : '#f43f5e';
  const lastPoint = points.split(' ').pop().split(',');

  return (
    <svg width={width} height={height} className="overflow-visible block" title={`Signal Trend (Last ${data.length} pkts): ${data.join(', ')} dBm`}>
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      <circle cx={lastPoint[0]} cy={lastPoint[1]} r="2" fill={stroke} />
    </svg>
  );
}
