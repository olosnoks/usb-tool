import React, { useState, useMemo } from 'react';
import {
  Activity,
  BarChart2,
  TrendingUp,
  Info,
  Maximize2,
  FileText,
  ShieldAlert,
  ShieldCheck,
  Zap
} from 'lucide-react';
import {
  calculateRollingEntropy,
  calculateByteFrequencies,
  calculateAnalyticsSummary,
  toUint8Array
} from '../../utils/cyberchef/analytics.js';

/**
 * CyberChefCharts
 * Renders rolling Shannon Entropy line chart and 256-bin byte frequency histogram.
 *
 * @param {Object} props
 * @param {string|ArrayBuffer|Uint8Array} props.data - Active output data to visualize
 * @param {number} [props.blockSize=256] - Rolling entropy window size
 */
export default function CyberChefCharts({ data, blockSize = 256 }) {
  const [activeTab, setActiveTab] = useState('entropy'); // 'entropy' | 'frequency' | 'both'
  const [hoveredBlock, setHoveredBlock] = useState(null);
  const [hoveredByte, setHoveredByte] = useState(null);
  const [freqFilter, setFreqFilter] = useState('all'); // 'all' | 'printable' | 'high' | 'nonzero'

  const bytes = useMemo(() => toUint8Array(data), [data]);
  const summary = useMemo(() => calculateAnalyticsSummary(bytes), [bytes]);
  const rollingEntropy = useMemo(() => calculateRollingEntropy(bytes, blockSize), [bytes, blockSize]);
  const byteFrequencies = useMemo(() => calculateByteFrequencies(bytes), [bytes]);

  const filteredFrequencies = useMemo(() => {
    if (freqFilter === 'printable') {
      return byteFrequencies.filter((f) => f.type === 'printable');
    }
    if (freqFilter === 'high') {
      return byteFrequencies.filter((f) => f.type === 'high');
    }
    if (freqFilter === 'nonzero') {
      return byteFrequencies.filter((f) => f.count > 0);
    }
    return byteFrequencies;
  }, [byteFrequencies, freqFilter]);

  const maxFreq = useMemo(() => {
    return Math.max(...byteFrequencies.map((f) => f.count), 1);
  }, [byteFrequencies]);

  // SVG Chart Dimensions
  const chartWidth = 720;
  const chartHeight = 220;
  const padding = { top: 20, right: 30, bottom: 35, left: 45 };
  const innerWidth = chartWidth - padding.left - padding.right;
  const innerHeight = chartHeight - padding.top - padding.bottom;

  // Compute points for rolling entropy line chart
  const points = useMemo(() => {
    if (rollingEntropy.length === 0) return [];
    const count = rollingEntropy.length;
    return rollingEntropy.map((b, idx) => {
      const x = count === 1 ? innerWidth / 2 : (idx / (count - 1)) * innerWidth;
      const y = innerHeight - (Math.min(8, Math.max(0, b.entropy)) / 8) * innerHeight;
      return { x: padding.left + x, y: padding.top + y, ...b, index: idx };
    });
  }, [rollingEntropy, innerWidth, innerHeight, padding.left, padding.top]);

  // SVG path string for the line
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, pt, idx) => {
      return `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
    }, '');
  }, [points]);

  // SVG path string for filled area under the line
  const areaPath = useMemo(() => {
    if (points.length === 0) return '';
    const bottomY = padding.top + innerHeight;
    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    return `${linePath} L ${endX},${bottomY} L ${startX},${bottomY} Z`;
  }, [linePath, points, padding.top, innerHeight]);

  if (!bytes || bytes.length === 0) {
    return (
      <div className="py-16 text-center text-slate-500 bg-[#12141a] rounded-xl border border-[#282d3a] p-6 space-y-2">
        <Activity className="w-8 h-8 mx-auto text-slate-600 animate-pulse" />
        <p className="text-xs font-mono">No output bytes available to analyze.</p>
        <p className="text-[11px] text-slate-600">Bake a recipe or stream hardware telemetry to inspect entropy and frequency charts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Analytics Summary Header Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase block font-mono">Mean Shannon Entropy</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-base font-bold font-mono ${
              summary.meanEntropy > 7.2 ? 'text-purple-400' : summary.meanEntropy > 5.0 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {summary.meanEntropy.toFixed(2)}
            </span>
            <span className="text-[10px] text-slate-500 font-mono">/ 8.0</span>
          </div>
          <span className="text-[10px] text-slate-400 block mt-0.5 truncate">
            {summary.meanEntropy > 7.2
              ? 'Encrypted / Compressed'
              : summary.meanEntropy > 5.0
              ? 'Structured / Base64'
              : 'Plaintext / Sparse'}
          </span>
        </div>

        <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase block font-mono">Payload Size</span>
          <span className="text-base font-bold font-mono text-cyan-300 block mt-0.5">
            {summary.totalBytes.toLocaleString()} <span className="text-xs font-normal text-slate-400">bytes</span>
          </span>
          <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
            {rollingEntropy.length} block{rollingEntropy.length !== 1 ? 's' : ''} ({blockSize}B)
          </span>
        </div>

        <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase block font-mono">Printable ASCII</span>
          <span className="text-base font-bold font-mono text-emerald-400 block mt-0.5">
            {(summary.printableRatio * 100).toFixed(1)}%
          </span>
          <span className="text-[10px] text-slate-500 font-mono block mt-0.5">
            Nulls: {(summary.nullRatio * 100).toFixed(1)}%
          </span>
        </div>

        <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-2.5">
          <span className="text-[10px] text-slate-500 uppercase block font-mono">Min / Max Entropy</span>
          <div className="flex items-center gap-2 mt-0.5 font-mono text-xs text-slate-200">
            <span className="text-cyan-400">{summary.minEntropy.toFixed(2)}</span>
            <span className="text-slate-500">→</span>
            <span className="text-purple-400">{summary.maxEntropy.toFixed(2)}</span>
          </div>
          <span className="text-[10px] text-slate-500 font-mono block mt-0.5 truncate">
            Range: {(summary.maxEntropy - summary.minEntropy).toFixed(2)} bits
          </span>
        </div>
      </div>

      {/* Navigation Pills */}
      <div className="flex items-center justify-between border-b border-[#232733] pb-2 text-xs">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setActiveTab('entropy')}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition flex items-center gap-1.5 ${
              activeTab === 'entropy'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 bg-[#12141a]'
            }`}
            type="button"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Entropy Curve</span>
          </button>

          <button
            onClick={() => setActiveTab('frequency')}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition flex items-center gap-1.5 ${
              activeTab === 'frequency'
                ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 bg-[#12141a]'
            }`}
            type="button"
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Byte Frequency (256 Bins)</span>
          </button>

          <button
            onClick={() => setActiveTab('both')}
            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition ${
              activeTab === 'both'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                : 'text-slate-400 hover:text-slate-200 bg-[#12141a]'
            }`}
            type="button"
          >
            All Charts
          </button>
        </div>

        {activeTab !== 'entropy' && (
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className="text-slate-500 mr-1">Filter:</span>
            {[
              { id: 'all', label: 'All' },
              { id: 'printable', label: 'ASCII' },
              { id: 'high', label: 'High' },
              { id: 'nonzero', label: 'Non-Zero' }
            ].map((f) => (
              <button
                key={f.id}
                onClick={() => setFreqFilter(f.id)}
                className={`px-1.5 py-0.5 rounded transition ${
                  freqFilter === f.id
                    ? 'bg-slate-700 text-slate-100 font-bold'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
                type="button"
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart 1: Rolling Shannon Entropy Line Chart */}
      {(activeTab === 'entropy' || activeTab === 'both') && (
        <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                <span>Rolling Shannon Entropy Profile</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                (Window: {blockSize} bytes)
              </span>
            </div>

            {hoveredBlock && (
              <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-300">
                Offset 0x{hoveredBlock.offset.toString(16).toUpperCase()} (Block {hoveredBlock.index + 1}/{rollingEntropy.length}):{' '}
                <span className="font-bold">{hoveredBlock.entropy.toFixed(3)}</span> bits/byte
              </div>
            )}
          </div>

          <div className="relative w-full overflow-x-auto scrollbar-none">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              className="w-full h-auto min-w-[500px]"
              style={{ maxHeight: '240px' }}
            >
              <defs>
                <linearGradient id="entropyGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a855f7" stopOpacity="0.45" />
                  <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.05" />
                </linearGradient>
                <linearGradient id="lineGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#06b6d4" />
                  <stop offset="50%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#a855f7" />
                </linearGradient>
              </defs>

              {/* Gridlines & Y-axis labels */}
              {[0, 2, 4, 6, 8].map((val) => {
                const y = padding.top + innerHeight - (val / 8) * innerHeight;
                return (
                  <g key={val}>
                    <line
                      x1={padding.left}
                      y1={y}
                      x2={chartWidth - padding.right}
                      y2={y}
                      stroke="#232733"
                      strokeDasharray={val === 0 ? '' : '3 3'}
                    />
                    <text
                      x={padding.left - 8}
                      y={y + 3}
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="monospace"
                      textAnchor="end"
                    >
                      {val}.0
                    </text>
                  </g>
                );
              })}

              {/* Threshold indicator: 7.2 bits (Encrypted/Compressed threshold) */}
              <line
                x1={padding.left}
                y1={padding.top + innerHeight - (7.2 / 8) * innerHeight}
                x2={chartWidth - padding.right}
                y2={padding.top + innerHeight - (7.2 / 8) * innerHeight}
                stroke="#a855f7"
                strokeOpacity="0.4"
                strokeDasharray="4 2"
              />
              <text
                x={chartWidth - padding.right - 4}
                y={padding.top + innerHeight - (7.2 / 8) * innerHeight - 4}
                fill="#c084fc"
                fontSize="8"
                fontFamily="monospace"
                textAnchor="end"
              >
                7.2 (Compressed / Cipher)
              </text>

              {/* Area Under Curve */}
              {areaPath && <path d={areaPath} fill="url(#entropyGradient)" />}

              {/* Polyline */}
              {linePath && (
                <path
                  d={linePath}
                  fill="none"
                  stroke="url(#lineGradient)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Data points with interactive hitboxes */}
              {points.map((pt, idx) => (
                <g key={idx}>
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={hoveredBlock?.index === idx ? 4.5 : 2}
                    fill={hoveredBlock?.index === idx ? '#38bdf8' : '#06b6d4'}
                    stroke="#0f172a"
                    strokeWidth="1"
                    className="transition-all"
                  />
                  {/* Invisible larger hover target */}
                  <rect
                    x={pt.x - 12}
                    y={padding.top}
                    width={24}
                    height={innerHeight}
                    fill="transparent"
                    onMouseEnter={() => setHoveredBlock(pt)}
                    onMouseLeave={() => setHoveredBlock(null)}
                    className="cursor-pointer"
                  />
                </g>
              ))}

              {/* X-axis offset indicators */}
              {points.length > 0 && (
                <>
                  <text
                    x={padding.left}
                    y={chartHeight - 12}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                  >
                    0x00
                  </text>
                  <text
                    x={chartWidth - padding.right}
                    y={chartHeight - 12}
                    fill="#64748b"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    0x{bytes.length.toString(16).toUpperCase()}
                  </text>
                </>
              )}
            </svg>
          </div>
        </div>
      )}

      {/* Chart 2: 256-Bin Byte Frequency Histogram */}
      {(activeTab === 'frequency' || activeTab === 'both') && (
        <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <BarChart2 className="w-3.5 h-3.5 text-purple-400" />
                <span>Byte Frequency Distribution (0x00 - 0xFF)</span>
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {filteredFrequencies.length} bins shown
              </span>
            </div>

            {hoveredByte && (
              <div className="text-[11px] font-mono px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-300">
                Byte 0x{hoveredByte.hex} ({hoveredByte.byte}, '{hoveredByte.char}'):{' '}
                <span className="font-bold">{hoveredByte.count.toLocaleString()}</span> ({hoveredByte.percent}%)
              </div>
            )}
          </div>

          {/* Bar Chart Container */}
          <div className="h-44 flex items-end gap-[1px] bg-[#0c0e13] p-2 rounded-lg border border-[#1e222d] overflow-x-auto scrollbar-none relative">
            {filteredFrequencies.map((f) => {
              const heightPercent = maxFreq > 0 ? (f.count / maxFreq) * 100 : 0;
              let barColor = 'bg-slate-600';
              if (f.type === 'null') barColor = 'bg-blue-500';
              else if (f.type === 'printable') barColor = 'bg-emerald-400';
              else if (f.type === 'control') barColor = 'bg-amber-400';
              else if (f.type === 'high') barColor = 'bg-purple-400';

              return (
                <div
                  key={f.byte}
                  className="flex-1 min-w-[2px] h-full flex flex-col justify-end group relative"
                  onMouseEnter={() => setHoveredByte(f)}
                  onMouseLeave={() => setHoveredByte(null)}
                >
                  <div
                    style={{ height: `${Math.max(heightPercent > 0 ? 3 : 0, heightPercent)}%` }}
                    className={`w-full rounded-t-sm transition-all ${barColor} group-hover:brightness-125 group-hover:scale-y-105`}
                  />
                </div>
              );
            })}
          </div>

          {/* Legend and Axis markers */}
          <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 flex-wrap gap-2 pt-1 border-t border-[#1e222d]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span>Null (0x00)</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Control (0x01-1F)</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Printable (0x20-7E)</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-purple-400" />
                <span>High (0x80-FF)</span>
              </span>
            </div>

            <div className="text-slate-500">
              Max Frequency: {maxFreq.toLocaleString()} hits
            </div>
          </div>
        </div>
      )}

      {/* Top Occurrences Chips */}
      {summary.topBytes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs bg-[#12141a] p-2.5 rounded-xl border border-[#282d3a]">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono mr-1">
            Top Bytes:
          </span>
          {summary.topBytes.map((b) => (
            <span
              key={b.byte}
              className="px-2 py-0.5 rounded-lg bg-[#1a1e27] border border-[#2d3342] text-[11px] font-mono text-slate-300 flex items-center gap-1.5"
            >
              <span className="font-bold text-cyan-400">0x{b.hex}</span>
              <span className="text-slate-400">('{b.char}')</span>
              <span className="text-slate-500 text-[10px]">{b.count}x ({b.percent}%)</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
