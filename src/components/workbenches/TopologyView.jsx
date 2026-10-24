import React, { useMemo, useState } from 'react';
import { 
  Network, 
  AlertTriangle, 
  Radio, 
  Smartphone, 
  ArrowLeft, 
  Lock, 
  ShieldCheck, 
  ShieldAlert, 
  Info,
  Maximize2
} from 'lucide-react';

/**
 * Determine node color according to encryption security:
 * Green = Secure (WPA3)
 * Yellow = Standard (WPA2 / WPA)
 * Red = Open / Insecure (None, WEP, Open)
 */
export function getTopologySecurityColor(security) {
  const sec = (security || '').toUpperCase();
  if (sec.includes('WPA3')) {
    return {
      fill: '#10b981', // Green
      stroke: '#34d399',
      glow: 'rgba(16, 185, 129, 0.4)',
      text: 'Secure (WPA3)'
    };
  }
  if (sec.includes('WPA2') || sec.includes('WPA')) {
    return {
      fill: '#eab308', // Yellow
      stroke: '#fde047',
      glow: 'rgba(234, 179, 8, 0.4)',
      text: 'Standard (WPA2)'
    };
  }
  return {
    fill: '#ef4444', // Red
    stroke: '#f87171',
    glow: 'rgba(239, 68, 68, 0.4)',
    text: 'Open / Insecure'
  };
}

export default function TopologyView({
  devices = {},
  clients = {},
  selectedItem = null,
  onSelectNode = () => {},
  onSwitchToTable = () => {}
}) {
  const [hoveredNode, setHoveredNode] = useState(null);

  const apList = useMemo(() => Object.values(devices || {}), [devices]);
  const clientList = useMemo(() => Object.values(clients || {}), [clients]);
  const totalNodes = apList.length + clientList.length;

  // Fallback: If environment has >50 nodes, display warning and provide direct return to table view
  const isDense = totalNodes > 50;

  // Calculate layout coordinates for APs and orbiting clients
  const { apNodes, clientNodes, links } = useMemo(() => {
    if (isDense || totalNodes === 0) {
      return { apNodes: [], clientNodes: [], links: [] };
    }

    const width = 860;
    const height = 520;
    const cx = width / 2;
    const cy = height / 2;

    const positionedAps = [];
    const apMap = {};

    // 1. Position Access Points
    if (apList.length === 1) {
      const ap = apList[0];
      const pos = { ...ap, x: cx, y: cy };
      positionedAps.push(pos);
      apMap[ap.bssid] = pos;
    } else if (apList.length > 1) {
      const radius = apList.length <= 6 ? 150 : 190;
      apList.forEach((ap, idx) => {
        const angle = (2 * Math.PI * idx) / apList.length - Math.PI / 2;
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);
        const pos = { ...ap, x, y };
        positionedAps.push(pos);
        apMap[ap.bssid] = pos;
      });
    }

    // 2. Group Clients by Associated AP
    const clientsByAp = {};
    const unassociated = [];

    clientList.forEach((cli) => {
      const targetBssid = cli.bssid;
      if (targetBssid && apMap[targetBssid]) {
        if (!clientsByAp[targetBssid]) clientsByAp[targetBssid] = [];
        clientsByAp[targetBssid].push(cli);
      } else {
        unassociated.push(cli);
      }
    });

    const positionedClients = [];
    const calculatedLinks = [];

    // 3. Orbit Associated Clients around each AP
    positionedAps.forEach((ap) => {
      const attached = clientsByAp[ap.bssid] || [];
      const count = attached.length;
      if (count === 0) return;

      attached.forEach((cli, cIdx) => {
        // Orbit radius around this AP
        const orbitRadius = count === 1 ? 55 : 50 + (cIdx % 2) * 18;
        // Distribute in a full circle around AP
        const angle = (2 * Math.PI * cIdx) / count;
        const x = ap.x + orbitRadius * Math.cos(angle);
        const y = ap.y + orbitRadius * Math.sin(angle);

        const cliPos = { ...cli, x, y };
        positionedClients.push(cliPos);
        calculatedLinks.push({
          id: `${cli.clientMac}-${ap.bssid}`,
          x1: x,
          y1: y,
          x2: ap.x,
          y2: ap.y,
          clientMac: cli.clientMac,
          bssid: ap.bssid
        });
      });
    });

    // 4. Position Unassociated / Probing Clients in outer orbit
    if (unassociated.length > 0) {
      const unassociatedRadius = Math.min(width, height) / 2 - 28;
      unassociated.forEach((cli, uIdx) => {
        const angle = (2 * Math.PI * uIdx) / unassociated.length;
        const x = cx + unassociatedRadius * Math.cos(angle);
        const y = cy + unassociatedRadius * Math.sin(angle);
        positionedClients.push({ ...cli, x, y, isUnassociated: true });
      });
    }

    return {
      apNodes: positionedAps,
      clientNodes: positionedClients,
      links: calculatedLinks
    };
  }, [apList, clientList, isDense, totalNodes]);

  // If environment too dense (>50 nodes), show warning fallback
  if (isDense) {
    return (
      <div className="p-8 sm:p-12 text-center space-y-4">
        <div className="inline-flex p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
          <AlertTriangle className="w-10 h-10 animate-pulse" />
        </div>
        <div className="space-y-1.5 max-w-lg mx-auto">
          <h3 className="text-base font-bold text-amber-200 uppercase tracking-wide">
            High Density Environment Detected
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Found <span className="text-white font-bold">{totalNodes} nodes</span> ({apList.length} Access Points, {clientList.length} Stations). Rendering interactive topology graphs with &gt;50 nodes can degrade browser frame rates.
          </p>
          <p className="text-xs text-amber-400/90 font-semibold">
            Defaulting to table view to ensure continuous real-time packet capture.
          </p>
        </div>
        <div className="pt-2">
          <button
            onClick={onSwitchToTable}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-bold text-xs transition shadow-cyan-glow"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Switch to Table View</span>
          </button>
        </div>
      </div>
    );
  }

  // If no nodes discovered yet
  if (totalNodes === 0) {
    return (
      <div className="p-12 text-center text-slate-500 text-xs space-y-3">
        <div className="inline-flex p-3 rounded-full bg-slate-900 border border-slate-800 text-slate-400">
          <Network className="w-8 h-8 opacity-60" />
        </div>
        <div className="text-slate-400 font-semibold">No active nodes in topology</div>
        <div className="text-slate-600 max-w-sm mx-auto">
          Start monitoring or check "Simulate RF" to begin discovering Access Points and client stations.
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full bg-slate-950/90 rounded-xl overflow-hidden select-none">
      {/* Top Bar / Controls & Legend */}
      <div className="p-3 bg-slate-900/60 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-200 flex items-center gap-1.5">
            <Network className="w-4 h-4 text-cyan-400" />
            <span>Interactive Network Topology</span>
          </span>
          <span className="px-2 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 font-mono">
            {totalNodes} / 50 Nodes ({apList.length} APs, {clientList.length} STAs)
          </span>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50"></span>
            <span>WPA3 (Secure)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-sm shadow-yellow-400/50"></span>
            <span>WPA2 (Standard)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-sm shadow-rose-500/50"></span>
            <span>Open (Insecure)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-400 shadow-sm shadow-purple-400/50"></span>
            <span>Station (Client)</span>
          </div>
        </div>
      </div>

      {/* SVG Canvas */}
      <div className="w-full overflow-x-auto flex justify-center p-2 bg-[#0d1017]">
        <svg 
          viewBox="0 0 860 520" 
          className="w-full max-w-[860px] h-auto min-h-[460px] transition-all"
        >
          <defs>
            <filter id="glow-filter" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            {/* Background grid pattern */}
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeOpacity="0.4" />
            </pattern>
          </defs>

          {/* Background Grid */}
          <rect width="860" height="520" fill="url(#grid)" />

          {/* Lines connecting Client STAs to their Associated AP BSSID */}
          {links.map((link) => {
            const isHovered = hoveredNode === link.clientMac || hoveredNode === link.bssid;
            const isSelected = selectedItem?.data?.clientMac === link.clientMac || selectedItem?.data?.bssid === link.bssid;
            return (
              <line
                key={link.id}
                x1={link.x1}
                y1={link.y1}
                x2={link.x2}
                y2={link.y2}
                stroke={isSelected ? '#38bdf8' : isHovered ? '#818cf8' : '#334155'}
                strokeWidth={isSelected ? 2.5 : isHovered ? 2 : 1.2}
                strokeDasharray={isSelected ? 'none' : '4 3'}
                strokeOpacity={isHovered || isSelected ? 0.9 : 0.6}
              />
            );
          })}

          {/* Access Point (Parent) Nodes */}
          {apNodes.map((ap) => {
            const secColor = getTopologySecurityColor(ap.security);
            const isSelected = selectedItem?.type === 'ap' && selectedItem?.data?.bssid === ap.bssid;
            const isHovered = hoveredNode === ap.bssid;
            const radius = isSelected ? 22 : 18;

            return (
              <g
                key={ap.bssid}
                className="cursor-pointer transition-transform"
                onClick={() => onSelectNode({ type: 'ap', data: ap })}
                onMouseEnter={() => setHoveredNode(ap.bssid)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Selection Halo */}
                {(isSelected || isHovered) && (
                  <circle
                    cx={ap.x}
                    cy={ap.y}
                    r={radius + 8}
                    fill="none"
                    stroke={secColor.stroke}
                    strokeWidth="2"
                    strokeOpacity="0.6"
                    className="animate-pulse"
                  />
                )}

                {/* Main AP Circle */}
                <circle
                  cx={ap.x}
                  cy={ap.y}
                  r={radius}
                  fill="#0f172a"
                  stroke={secColor.fill}
                  strokeWidth={isSelected ? 3.5 : 2.5}
                  filter="url(#glow-filter)"
                />

                {/* Inner Icon Representation */}
                <circle
                  cx={ap.x}
                  cy={ap.y}
                  r={radius - 7}
                  fill={secColor.fill}
                  fillOpacity="0.85"
                />

                {/* Node Label: SSID or BSSID */}
                <text
                  x={ap.x}
                  y={ap.y + radius + 14}
                  textAnchor="middle"
                  fill="#f1f5f9"
                  fontSize="11"
                  fontWeight="bold"
                  className="font-mono"
                >
                  {ap.ssid && ap.ssid !== '<Hidden SSID>' ? (ap.ssid.length > 14 ? ap.ssid.slice(0, 12) + '…' : ap.ssid) : ap.bssid.slice(-8)}
                </text>

                {/* Channel & Security Label */}
                <text
                  x={ap.x}
                  y={ap.y + radius + 26}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="9"
                  className="font-mono"
                >
                  CH {ap.channel} • {ap.security || 'Open'}
                </text>
              </g>
            );
          })}

          {/* Client Station (Child) Nodes */}
          {clientNodes.map((cli) => {
            const isSelected = selectedItem?.type === 'client' && selectedItem?.data?.clientMac === cli.clientMac;
            const isHovered = hoveredNode === cli.clientMac;
            const radius = isSelected ? 12 : 9;

            return (
              <g
                key={cli.clientMac}
                className="cursor-pointer transition-transform"
                onClick={() => onSelectNode({ type: 'client', data: cli })}
                onMouseEnter={() => setHoveredNode(cli.clientMac)}
                onMouseLeave={() => setHoveredNode(null)}
              >
                {/* Selection Halo */}
                {(isSelected || isHovered) && (
                  <circle
                    cx={cli.x}
                    cy={cli.y}
                    r={radius + 5}
                    fill="none"
                    stroke="#c084fc"
                    strokeWidth="1.5"
                    className="animate-ping"
                  />
                )}

                {/* Main Client Circle */}
                <circle
                  cx={cli.x}
                  cy={cli.y}
                  r={radius}
                  fill="#1e1b4b"
                  stroke={cli.isUnassociated ? '#f59e0b' : '#a855f7'}
                  strokeWidth={isSelected ? 2.5 : 1.8}
                />

                {/* Inner Dot */}
                <circle
                  cx={cli.x}
                  cy={cli.y}
                  r={radius - 4}
                  fill={cli.isUnassociated ? '#fbbf24' : '#c084fc'}
                />

                {/* Short MAC Label */}
                <text
                  x={cli.x}
                  y={cli.y + radius + 11}
                  textAnchor="middle"
                  fill="#cbd5e1"
                  fontSize="8.5"
                  className="font-mono"
                >
                  {cli.clientMac.slice(-5)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Footer Info Strip */}
      <div className="px-4 py-2 bg-slate-900/60 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
        <div>
          Click any AP or Client station to inspect detailed hardware metrics in the side-panel.
        </div>
        <button
          onClick={onSwitchToTable}
          className="text-cyan-400 hover:text-cyan-300 font-bold transition flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Table</span>
        </button>
      </div>
    </div>
  );
}
