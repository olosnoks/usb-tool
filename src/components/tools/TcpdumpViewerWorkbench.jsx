import React, { useMemo, useState } from 'react';
import {
  parsePcap, compileFilter, conversations, protocolHierarchy, decodePacketDetail,
  packetsToCsv, writePcap, LINKTYPE_NAMES,
} from '../../utils/pcap';

/**
 * PCAP viewer. Parses classic libpcap (.pcap) and pcapng (.pcapng) files client-side and decodes
 * Ethernet/VLAN/SLL/radiotap/raw IP -> IPv4/IPv6 -> TCP/UDP/ICMP plus DNS/HTTP/TLS SNI/DHCP/ARP one-liners.
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

export default function TcpdumpViewerWorkbench({ onLogMessage }) {
  const [fileName, setFileName] = useState('');
  const [meta, setMeta] = useState(null);
  const [packets, setPackets] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('packets');

  const log = (msg) => onLogMessage?.(msg);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setError(null);
    setPage(0);
    setSelected(null);
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
  const convs = useMemo(() => (view === 'conversations' ? conversations(shown) : []), [view, shown]);
  const hierarchy = useMemo(() => (view === 'protocols' ? protocolHierarchy(shown) : []), [view, shown]);
  const layers = useMemo(() => (selected ? decodePacketDetail(selected) : []), [selected]);

  const exportCsv = () => download(`${fileName || 'capture'}-filtered.csv`, packetsToCsv(shown, t0), 'text/csv');
  const exportPcap = () => {
    const { bytes, skipped } = writePcap(shown);
    download(`${fileName || 'capture'}-filtered.pcap`, bytes, 'application/vnd.tcpdump.pcap');
    if (skipped) log(`PCAP export skipped ${skipped} packet(s) with a different link type`);
  };

  const th = 'p-1';
  const tab = (id, label) => (
    <button key={id} onClick={() => setView(id)} className={`px-2 py-0.5 rounded text-xs ${view === id ? 'bg-slate-700 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
  );

  return (
    <div className="p-4">
      <p className="text-sm text-gray-400 mb-3">Upload a .pcap or .pcapng capture to decode its packets.</p>
      <input type="file" accept=".pcap,.cap,.pcapng" onChange={handleFile} className="mb-3 text-gray-200" />
      {fileName && <div className="mb-2 text-sm text-gray-200"><strong>File:</strong> {fileName}{meta && ` — ${meta.format}, ${meta.packetCount} packets, ${LINKTYPE_NAMES[meta.linktype] || 'linktype ' + meta.linktype}`}</div>}
      {error && <p className="text-red-400 text-sm mb-2">Error: {error}</p>}
      {meta?.truncated && (
        <p className="text-amber-400 text-sm mb-2" role="alert">Showing first {meta.packetCount.toLocaleString()} of {meta.totalPackets.toLocaleString()} packets (decode limit reached).</p>
      )}
      {meta?.warnings?.map((w) => <p key={w} className="text-amber-400 text-xs mb-1">{w}</p>)}
      {packets.length > 0 && (
        <>
          <div className="flex gap-2 mb-2 items-center">
            <input
              type="text"
              placeholder="filter (e.g. tcp, udp, dns, port 443, host 10.0.0.1, example.com)"
              value={filter}
              onChange={(e) => { setFilter(e.target.value); setPage(0); }}
              className="flex-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200"
            />
            <button onClick={exportCsv} className="px-2 py-1 text-xs bg-slate-800 rounded text-gray-200">CSV</button>
            <button onClick={exportPcap} className="px-2 py-1 text-xs bg-slate-800 rounded text-gray-200">PCAP</button>
          </div>
          <div className="flex gap-1 mb-2">{tab('packets', 'Packets')}{tab('conversations', 'Conversations')}{tab('protocols', 'Protocols')}</div>

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
              <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                <span>{shown.length} of {packets.length} packets match{meta?.truncated ? ` (file has ${meta.totalPackets})` : ''}</span>
                {pageCount > 1 && (
                  <>
                    <button disabled={curPage === 0} onClick={() => setPage(curPage - 1)} className="px-2 bg-slate-800 rounded disabled:opacity-40">Prev</button>
                    <span>page {curPage + 1} / {pageCount}</span>
                    <button disabled={curPage >= pageCount - 1} onClick={() => setPage(curPage + 1)} className="px-2 bg-slate-800 rounded disabled:opacity-40">Next</button>
                  </>
                )}
              </div>
              {selected && (
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-gray-200 font-mono">
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
                <thead className="sticky top-0 bg-slate-800"><tr className="text-left"><th className={th}>Proto</th><th className={th}>A</th><th className={th}>B</th><th className={th}>Packets</th><th className={th}>Bytes</th><th className={th}>Duration (s)</th></tr></thead>
                <tbody>
                  {convs.map((c) => (
                    <tr key={c.key} className="border-b border-slate-800"><td className="p-1">{c.proto}</td><td className="p-1 break-all">{c.a}</td><td className="p-1 break-all">{c.b}</td><td className="p-1">{c.packets}</td><td className="p-1">{c.bytes}</td><td className="p-1">{c.duration.toFixed(3)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-1">{convs.length} conversations, {convs.reduce((n, c) => n + c.packets, 0)} packets</p>
            </div>
          )}

          {view === 'protocols' && (
            <table className="text-xs text-gray-200 border-collapse font-mono">
              <thead className="bg-slate-800"><tr className="text-left"><th className={th}>Protocol</th><th className={th}>Packets</th><th className={th}>Bytes</th></tr></thead>
              <tbody>{hierarchy.map((h) => <tr key={h.proto} className="border-b border-slate-800"><td className="p-1">{h.proto}</td><td className="p-1">{h.packets}</td><td className="p-1">{h.bytes}</td></tr>)}</tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
