import React, { useMemo, useState } from 'react';
import {
  parsePcap, compileFilter, conversations, protocolHierarchy, decodePacketDetail,
  packetsToCsv, writePcap, LINKTYPE_NAMES,
} from '../../utils/pcap';
import {
  captureSummary, endpoints, ioBuckets, tcpStreamKey, followTcpStream, bytesToAscii, bytesToHex,
  conversationsToCsv, endpointsToCsv, protocolsToCsv, formatBytes,
} from '../../utils/pcapAnalysis';

/**
 * PCAP viewer. Parses classic libpcap (.pcap) and pcapng (.pcapng) files client-side and decodes
 * Ethernet/VLAN/SLL/radiotap/raw IP -> IPv4/IPv6 -> TCP/UDP/ICMP plus DNS/HTTP/TLS SNI/DHCP/ARP one-liners.
 * Adds endpoints, an I/O graph, TCP stream following and CSV export of the statistics tables.
 * Large captures are paged; if the packet limit hides packets a banner says so. No data leaves the browser.
 */
const PAGE_SIZE = 500;

function download(name, bytesOrText, type) {
  const url = URL.createObjectURL(new Blob([bytesOrText], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hexDump(b) {
  const lines = [];
  for (let i = 0; i < b.length; i += 16) {
    const chunk = Array.from(b.subarray(i, i + 16));
    lines.push(`${i.toString(16).padStart(4, '0')}  ${chunk.map((x) => x.toString(16).padStart(2, '0')).join(' ').padEnd(47)}  ${chunk.map((x) => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('')}`);
  }
  return lines.join('\n');
}

const th = 'p-1';
const btn = 'px-2 py-0.5 text-xs bg-slate-800 rounded text-gray-200 hover:bg-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-500 disabled:opacity-40';

export default function TcpdumpViewerWorkbench({ onLogMessage }) {
  const [fileName, setFileName] = useState('');
  const [meta, setMeta] = useState(null);
  const [packets, setPackets] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('packets');
  const [streamKey, setStreamKey] = useState(null);
  const [streamMode, setStreamMode] = useState('ascii');
  const [metric, setMetric] = useState('packets');

  const log = (msg) => onLogMessage?.(msg);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPage(0);
    setSelected(null);
    setStreamKey(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const res = parsePcap(ev.target.result);
        setMeta(res);
        setPackets(res.packets);
        log(`Parsed ${file.name}: ${res.packetCount} of ${res.totalPackets} packet(s), ${res.format}, link type ${LINKTYPE_NAMES[res.linktype] || res.linktype}`);
      } catch (err) {
        setError(err.message);
        setPackets([]);
        setMeta(null);
        log(`PCAP parse error: ${err.message}`);
      }
    };
    reader.onerror = () => setError('Could not read the file');
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const shown = useMemo(() => {
    const test = compileFilter(filter);
    return filter.trim() ? packets.filter(test) : packets;
  }, [packets, filter]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const curPage = Math.min(page, pageCount - 1);
  const rows = shown.slice(curPage * PAGE_SIZE, (curPage + 1) * PAGE_SIZE);
  const t0 = packets[0]?.ts ?? 0;
  const summary = useMemo(() => captureSummary(shown), [shown]);
  const convs = useMemo(() => (view === 'conversations' ? conversations(shown) : []), [view, shown]);
  const hierarchy = useMemo(() => (view === 'protocols' ? protocolHierarchy(shown) : []), [view, shown]);
  const eps = useMemo(() => (view === 'endpoints' ? endpoints(shown) : []), [view, shown]);
  const io = useMemo(() => (view === 'graph' ? ioBuckets(shown) : null), [view, shown]);
  const layers = useMemo(() => (selected ? decodePacketDetail(selected) : []), [selected]);
  const stream = useMemo(() => (streamKey ? followTcpStream(packets, streamKey) : null), [packets, streamKey]);
  const selectedStream = selected ? tcpStreamKey(selected) : null;

  const base = fileName || 'capture';
  const exportCsv = () => download(`${base}-filtered.csv`, packetsToCsv(shown, t0), 'text/csv');
  const exportPcap = () => {
    const { bytes, skipped } = writePcap(shown);
    download(`${base}-filtered.pcap`, bytes, 'application/vnd.tcpdump.pcap');
    if (skipped) log(`PCAP export skipped ${skipped} packet(s) with a different link type`);
  };
  const follow = (key) => { setStreamKey(key); setView('stream'); };
  const exportStats = () => {
    if (view === 'conversations') download(`${base}-conversations.csv`, conversationsToCsv(convs), 'text/csv');
    else if (view === 'endpoints') download(`${base}-endpoints.csv`, endpointsToCsv(eps), 'text/csv');
    else if (view === 'protocols') download(`${base}-protocols.csv`, protocolsToCsv(hierarchy), 'text/csv');
  };
  const exportStream = () => {
    if (!stream) return;
    const total = stream.chunks.reduce((n, c) => n + c.bytes.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of stream.chunks) { out.set(c.bytes, o); o += c.bytes.length; }
    download(`${base}-stream.bin`, out, 'application/octet-stream');
  };

  const tab = (id, label) => (
    <button key={id} onClick={() => setView(id)} aria-pressed={view === id} className={`px-2 py-0.5 rounded text-xs ${view === id ? 'bg-slate-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
  );

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="pcap-file">Capture file</label>
        <input id="pcap-file" type="file" accept=".pcap,.cap,.pcapng" onChange={handleFile} className="text-xs text-gray-200 max-w-full" />
        {fileName && <span className="text-gray-300 break-all">{fileName}{meta && ` — ${meta.format}, ${LINKTYPE_NAMES[meta.linktype] || 'linktype ' + meta.linktype}`}</span>}
      </div>
      {error && <p className="text-red-400" role="alert">Error: {error}</p>}
      {meta?.truncated && (
        <p className="text-amber-400" role="alert">Showing first {meta.packetCount.toLocaleString()} of {meta.totalPackets.toLocaleString()} packets (decode limit reached).</p>
      )}
      {meta?.warnings?.map((w) => <p key={w} className="text-amber-400">{w}</p>)}
      {!packets.length && !error && (
        <details className="text-gray-400">
          <summary className="cursor-pointer">About</summary>
          <p className="mt-1">Open a .pcap, .cap or .pcapng file to decode it locally. Nothing is uploaded. Filter examples: tcp port 443, src 10.0.0.1, dns or arp, not tcp, syn, len &gt; 1000.</p>
        </details>
      )}
      {packets.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <input
              type="text"
              aria-label="Packet filter"
              placeholder="filter: tcp port 443, src/dst/host IP, dns or arp, not tcp, syn, len > 1000, text"
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(0); }}
              className="flex-1 min-w-[10rem] bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200"
            />
            <button onClick={exportCsv} title="Export the filtered packet table as CSV" className={btn}>CSV</button>
            <button onClick={exportPcap} title="Export the filtered packets as a classic pcap" className={btn}>PCAP</button>
          </div>
          <div className="text-gray-500 font-mono" data-testid="pcap-summary">
            {summary.packets.toLocaleString()} pkts · {formatBytes(summary.bytes)} · {summary.duration.toFixed(3)} s · {summary.pps.toFixed(1)} pkt/s · {(summary.bitsPerSec / 1000).toFixed(1)} kbit/s · avg {summary.avgLen.toFixed(0)} B
          </div>
          <div className="flex flex-wrap gap-1">
            {tab('packets', 'Packets')}{tab('conversations', 'Conversations')}{tab('endpoints', 'Endpoints')}{tab('protocols', 'Protocols')}{tab('graph', 'I/O graph')}{streamKey && tab('stream', 'TCP stream')}
          </div>

          {view === 'packets' && (
            <>
              <div className="overflow-auto" style={{ maxHeight: '40vh' }}>
                <table className="w-full text-xs text-gray-200 border-collapse font-mono">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr className="text-left"><th className={th}>#</th><th className={th}>Time</th><th className={th}>Src</th><th className={th}>Dst</th><th className={th}>Proto</th><th className={th}>Info</th><th className={th}>Len</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.index} onClick={() => setSelected(p)} className={`border-b border-slate-800 cursor-pointer ${selected === p ? 'bg-slate-700' : ''}`}>
                        <td className="p-1 text-gray-500">{p.index}</td>
                        <td className="p-1">{(p.ts - t0).toFixed(6)}</td>
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
              <div className="flex flex-wrap items-center gap-2 text-gray-500">
                <span>{shown.length} of {packets.length} packets match{meta?.truncated ? ` (file has ${meta.totalPackets})` : ''}</span>
                {pageCount > 1 && (
                  <>
                    <button disabled={curPage === 0} onClick={() => setPage(curPage - 1)} className="px-2 bg-slate-800 rounded disabled:opacity-40">Prev</button>
                    <span>page {curPage + 1} / {pageCount}</span>
                    <button disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)} className="px-2 bg-slate-800 rounded disabled:opacity-40">Next</button>
                  </>
                )}
                {selectedStream && <button onClick={() => follow(selectedStream)} className={btn} title="Reassemble this TCP stream">Follow TCP stream</button>}
              </div>
              {selected && (
                <div className="grid grid-cols-1 @lg:grid-cols-2 gap-2 text-gray-200 font-mono">
                  <div className="bg-slate-900 border border-slate-800 rounded p-2 overflow-auto" style={{ maxHeight: '30vh' }}>
                    {layers.map((l) => (
                      <div key={l.name} className="mb-1">
                        <div className="text-purple-300 font-bold">{l.name}</div>
                        {l.fields.map(([k, v]) => <div key={k} className="pl-3"><span className="text-gray-500">{k}:</span> {String(v)}</div>)}
                      </div>
                    ))}
                  </div>
                  <pre className="bg-slate-900 border border-slate-800 rounded p-2 overflow-auto" style={{ maxHeight: '30vh' }}>{hexDump(selected.data)}</pre>
                </div>
              )}
            </>
          )}

          {view === 'conversations' && (
            <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
              <table className="w-full text-xs text-gray-200 border-collapse font-mono">
                <thead className="sticky top-0 bg-slate-800"><tr className="text-left"><th className={th}>Proto</th><th className={th}>A</th><th className={th}>B</th><th className={th}>Packets</th><th className={th}>Bytes</th><th className={th}>Duration (s)</th><th className={th}><button onClick={exportStats} className={btn} title="Export as CSV">CSV</button></th></tr></thead>
                <tbody>
                  {convs.map((c) => (
                    <tr key={c.key} className="border-b border-slate-800">
                      <td className="p-1">{c.proto}</td><td className="p-1 break-all">{c.a}</td><td className="p-1 break-all">{c.b}</td><td className="p-1">{c.packets}</td><td className="p-1">{c.bytes}</td><td className="p-1">{c.duration.toFixed(3)}</td>
                      <td className="p-1">{c.proto === 'TCP' && <button onClick={() => follow(`${c.a}|${c.b}`)} className={btn} title="Follow this TCP stream">Follow</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-gray-500 mt-1">{convs.length} conversations, {convs.reduce((n, c) => n + c.packets, 0)} packets</p>
            </div>
          )}

          {view === 'endpoints' && (
            <div className="overflow-auto" style={{ maxHeight: '50vh' }}>
              <table className="w-full text-xs text-gray-200 border-collapse font-mono">
                <thead className="sticky top-0 bg-slate-800"><tr className="text-left"><th className={th}>Address</th><th className={th}>Packets</th><th className={th}>Bytes</th><th className={th}>Tx pkts</th><th className={th}>Tx bytes</th><th className={th}>Rx pkts</th><th className={th}>Rx bytes</th><th className={th}><button onClick={exportStats} className={btn} title="Export as CSV">CSV</button></th></tr></thead>
                <tbody>
                  {eps.map((e) => (
                    <tr key={e.address} className="border-b border-slate-800"><td className="p-1 break-all">{e.address}</td><td className="p-1">{e.packets}</td><td className="p-1">{e.bytes}</td><td className="p-1">{e.txPackets}</td><td className="p-1">{e.txBytes}</td><td className="p-1">{e.rxPackets}</td><td className="p-1">{e.rxBytes}</td><td /></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-gray-500 mt-1">{eps.length} endpoints (IP address, or MAC when there is no IP layer)</p>
            </div>
          )}

          {view === 'protocols' && (
            <table className="text-xs text-gray-200 border-collapse font-mono">
              <thead className="bg-slate-800"><tr className="text-left"><th className={th}>Protocol</th><th className={th}>Packets</th><th className={th}>Bytes</th><th className={th}><button onClick={exportStats} className={btn} title="Export as CSV">CSV</button></th></tr></thead>
              <tbody>{hierarchy.map((h) => <tr key={h.proto} className="border-b border-slate-800"><td className="p-1">{h.proto}</td><td className="p-1">{h.packets}</td><td className="p-1">{h.bytes}</td><td /></tr>)}</tbody>
            </table>
          )}

          {view === 'graph' && io && (
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1 text-gray-400">
                <label htmlFor="pcap-metric">Show</label>
                <select id="pcap-metric" value={metric} onChange={(e) => setMetric(e.target.value)} className="bg-slate-900 border border-slate-800 rounded text-gray-200">
                  <option value="packets">Packets per bucket</option>
                  <option value="bytes">Bytes per bucket</option>
                </select>
                <span>bucket {io.interval} s, {io.buckets.length} buckets (follows the filter)</span>
              </div>
              {(() => {
                const max = Math.max(1, ...io.buckets.map((b) => b[metric]));
                return (
                  <>
                    <div className="flex items-end gap-px h-32 bg-slate-900 border border-slate-800 rounded p-1" role="img" aria-label={`I/O graph, peak ${max} ${metric} per ${io.interval} s`}>
                      {io.buckets.map((b) => (
                        <div key={b.start} className="flex-1 bg-purple-400/70 min-w-px" style={{ height: `${(b[metric] / max) * 100}%` }} title={`t=${b.start.toFixed(3)} s: ${b.packets} pkts, ${b.bytes} B`} />
                      ))}
                    </div>
                    <p className="text-gray-500 mt-1">Peak {max.toLocaleString()} {metric} per bucket.</p>
                  </>
                );
              })()}
            </div>
          )}

          {view === 'stream' && (
            <div>
              {!stream ? <p className="text-gray-500">No TCP data for this stream.</p> : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-1 text-gray-400">
                    <span className="font-mono break-all">{stream.a} → {stream.b}</span>
                    <span>{stream.packets} segments, {formatBytes(stream.bytesA)} A→B, {formatBytes(stream.bytesB)} B→A</span>
                    {stream.retransmissions > 0 && <span className="text-amber-400">{stream.retransmissions} retransmitted</span>}
                    {stream.missing > 0 && <span className="text-amber-400">{stream.missing} B missing (not captured)</span>}
                    <button onClick={() => setStreamMode(streamMode === 'ascii' ? 'hex' : 'ascii')} className={btn}>{streamMode === 'ascii' ? 'Show hex' : 'Show ASCII'}</button>
                    <button onClick={exportStream} className={btn} title="Save both directions' payload, in order, as a raw file">Save raw</button>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 rounded p-2 overflow-auto font-mono whitespace-pre-wrap break-all" style={{ maxHeight: '45vh' }}>
                    {stream.chunks.length === 0 && <span className="text-gray-500">No payload bytes in this stream.</span>}
                    {stream.chunks.slice(0, 500).map((c, i) => (
                      <span key={i} className={c.dir === 'A' ? 'text-sky-300' : 'text-amber-300'}>{streamMode === 'ascii' ? bytesToAscii(c.bytes.subarray(0, 65536)) : bytesToHex(c.bytes.subarray(0, 65536))}{'\n'}</span>
                    ))}
                  </div>
                  <p className="text-gray-500 mt-1">Blue = A to B (first sender), amber = B to A. The display is capped at 64 KB per chunk and 500 chunks; Save raw writes everything. TLS payloads stay encrypted.</p>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
