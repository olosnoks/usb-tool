import React, { useState } from 'react';
import { parsePcap } from '../../utils/pcap';

/**
 * PCAP viewer. Parses a classic libpcap (.pcap) file client-side and decodes
 * Ethernet/IPv4/IPv6/TCP/UDP/ICMP into a packet list. pcapng is detected and
 * reported (convert with editcap). No data leaves the browser.
 */
const LINKTYPES = { 0: 'NULL/Loopback', 1: 'Ethernet', 101: 'Raw IP' };

export default function TcpdumpViewerWorkbench({ onLogMessage }) {
  const [fileName, setFileName] = useState('');
  const [meta, setMeta] = useState(null);
  const [packets, setPackets] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const log = (msg) => onLogMessage?.(msg);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const { linktype, packetCount, packets: pkts } = parsePcap(ev.target.result);
        setMeta({ linktype, packetCount });
        setPackets(pkts);
        log(`Parsed ${file.name}: ${packetCount} packet(s), link type ${LINKTYPES[linktype] || linktype}`);
      } catch (err) {
        setError(err.message);
        setPackets([]);
        setMeta(null);
        log(`PCAP parse error: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const shown = filter
    ? packets.filter((p) => `${p.proto} ${p.src} ${p.dst} ${p.sport} ${p.dport} ${p.info || ''}`.toLowerCase().includes(filter.toLowerCase()))
    : packets;

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">PCAP Viewer</h2>
      <p className="text-sm text-gray-400 mb-3">Upload a classic .pcap capture to decode its packets.</p>
      <input type="file" accept=".pcap,.cap" onChange={handleFile} className="mb-3 text-gray-200" />
      {fileName && <div className="mb-2 text-sm text-gray-200"><strong>File:</strong> {fileName}{meta && ` — ${meta.packetCount} packets, ${LINKTYPES[meta.linktype] || 'linktype ' + meta.linktype}`}</div>}
      {error && <p className="text-red-400 text-sm mb-2">Error: {error}</p>}
      {packets.length > 0 && (
        <>
          <input
            type="text"
            placeholder="filter (e.g. TCP, 443, 192.168)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="mb-2 w-full bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200"
          />
          <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
            <table className="w-full text-xs text-gray-200 border-collapse font-mono">
              <thead className="sticky top-0 bg-slate-800">
                <tr className="text-left"><th className="p-1">#</th><th className="p-1">Time</th><th className="p-1">Src</th><th className="p-1">Dst</th><th className="p-1">Proto</th><th className="p-1">Info</th><th className="p-1">Len</th></tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.index} className="border-b border-slate-800">
                    <td className="p-1 text-gray-500">{p.index}</td>
                    <td className="p-1">{new Date(p.ts * 1000).toISOString().slice(11, 23)}</td>
                    <td className="p-1 break-all">{p.src ? `${p.src}${p.sport ? ':' + p.sport : ''}` : p.ethSrc || '—'}</td>
                    <td className="p-1 break-all">{p.dst ? `${p.dst}${p.dport ? ':' + p.dport : ''}` : p.ethDst || '—'}</td>
                    <td className="p-1">{p.proto || p.l3}</td>
                    <td className="p-1">{p.info || ''}</td>
                    <td className="p-1 text-gray-500">{p.origlen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-1">{shown.length} of {packets.length} packets shown</p>
        </>
      )}
    </div>
  );
}
