import React, { useMemo, useState } from 'react';
import { Bluetooth, Upload, Download, Play, Activity, Network, Layers, AlertTriangle } from 'lucide-react';
import {
  parseCapture,
  analyzeCapture,
  buildGattModel,
  filterPackets,
  packetsToCsv,
  parseHandle,
  hexDump,
  toHex,
  utf8Preview,
  makeExampleCapture,
  hex16,
  propNames,
} from '../../utils/btsnoop.js';

/**
 * Bluetooth HCI log viewer (offline). Opens an Android btsnoop_hci.log, or a pcap / pcapng
 * file with LINKTYPE 201, and decodes it in the browser. Nothing is captured from hardware
 * and nothing is uploaded.
 */

const TYPE_FILTERS = [
  ['all', 'All'],
  ['cmd', 'Commands'],
  ['evt', 'Events'],
  ['acl', 'ACL'],
  ['sco', 'SCO'],
  ['iso', 'ISO'],
];
const TABS = [
  ['packets', 'Packets', Activity],
  ['gatt', 'GATT', Layers],
  ['conns', 'Connections', Network],
];
const PAGE = 400;
const EXAMPLE_LABEL = 'Built-in example (synthetic, invented session, not captured from a device)';

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200';
const btnCls = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs border-slate-700 bg-slate-900 hover:border-cyan-600 text-gray-200';
const TYPE_BADGE = {
  cmd: 'bg-amber-950/60 text-amber-300 border-amber-900',
  evt: 'bg-slate-800 text-slate-300 border-slate-700',
  acl: 'bg-cyan-950/60 text-cyan-300 border-cyan-900',
  sco: 'bg-purple-950/60 text-purple-300 border-purple-900',
  iso: 'bg-emerald-950/60 text-emerald-300 border-emerald-900',
  unknown: 'bg-rose-950/60 text-rose-300 border-rose-900',
};

function download(name, text, mime = 'text/csv') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Stat({ label, value }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-sm text-gray-100">{value}</div>
    </div>
  );
}

function Fields({ fields }) {
  if (!fields || fields.length === 0) return null;
  return (
    <table className="w-full text-xs font-mono">
      <tbody>
        {fields.map(([k, v], i) => (
          <tr key={`${k}-${i}`} className="border-b border-slate-900 last:border-0 align-top">
            <td className="py-0.5 pr-3 text-slate-500 whitespace-nowrap">{k}</td>
            <td className="py-0.5 text-gray-200 break-all">{String(v)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TreeNode({ node, depth = 0 }) {
  return (
    <div className={depth ? 'pl-3 border-l border-slate-800 mt-1' : ''}>
      <div className="text-xs text-cyan-200 font-mono">{node.title}</div>
      <Fields fields={node.fields} />
      {(node.sub || []).map((c, i) => <TreeNode key={i} node={c} depth={depth + 1} />)}
    </div>
  );
}

function PacketDetail({ pk, connLabel }) {
  if (!pk) {
    return <div className="text-xs text-slate-500 p-3">Select a packet to see its decoded fields and hex dump.</div>;
  }
  const dumpBytes = pk.h4;
  return (
    <div className="space-y-2 p-3 bg-slate-950 border border-slate-800 rounded">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_BADGE[pk.type] || TYPE_BADGE.unknown}`}>{pk.type}</span>
        <span className="text-xs text-gray-200 font-mono">#{pk.no}</span>
        <span className="text-xs text-slate-400 font-mono">{pk.name}</span>
        {connLabel && <span className="text-[10px] text-slate-500 font-mono">{connLabel}</span>}
      </div>
      <div className="text-xs text-gray-300 font-mono break-all">{pk.summary}</div>
      <Fields fields={pk.fields} />
      {pk.l2cap && (
        <div className="text-xs font-mono text-slate-400">
          L2CAP: CID {hex16(pk.l2cap.cid)} {pk.l2cap.cidName}, SDU {pk.l2cap.length} bytes, fragments {pk.l2cap.fragments} (packets {pk.l2cap.firstNo}-{pk.l2cap.lastNo})
        </div>
      )}
      {pk.fragment && pk.fragment.state !== 'partial' && (
        <div className="text-xs text-amber-300 font-mono">Fragment state: {pk.fragment.state}</div>
      )}
      {(pk.sub || []).map((n, i) => <TreeNode key={i} node={n} />)}
      {pk.att && pk.att.value && utf8Preview(pk.att.value) && (
        <div className="text-xs font-mono text-emerald-300">Text: {utf8Preview(pk.att.value)}</div>
      )}
      <details>
        <summary className="text-[11px] text-slate-500 cursor-pointer">Hex dump (H4 bytes, indicator first)</summary>
        <pre className="text-[11px] font-mono text-gray-300 overflow-auto mt-1">{hexDump(dumpBytes)}</pre>
      </details>
    </div>
  );
}

function PacketsTab({ analysis }) {
  const [type, setType] = useState('all');
  const [handleText, setHandleText] = useState('');
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState(null);

  const handle = parseHandle(handleText);
  const badHandle = handleText.trim() !== '' && handle === null;
  const filtered = useMemo(
    () => filterPackets(analysis.packets, { type, handle, text }),
    [analysis, type, handle, text],
  );
  const shown = filtered.slice(0, limit);
  const selectedPk = selected === null ? null : analysis.packets[selected - 1] || null;
  const connLabel = (pk) => {
    if (pk.connId === null || pk.connId === undefined) return '';
    const c = analysis.connections[pk.connId];
    return c ? `conn #${c.id} ${hex16(c.handle)}` : '';
  };

  const exportCsv = () => {
    download('bt-hci-filtered.csv', packetsToCsv(filtered));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[10px] text-slate-500">Type
          <select className={`${inputCls} block`} value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label className="text-[10px] text-slate-500">Handle
          <input
            className={`${inputCls} block w-24 ${badHandle ? 'border-red-700' : ''}`}
            placeholder="0x0040"
            value={handleText}
            onChange={(e) => setHandleText(e.target.value)}
            aria-label="Connection handle filter"
          />
        </label>
        <label className="text-[10px] text-slate-500 flex-1 min-w-[160px]">Text
          <input
            className={`${inputCls} block w-full`}
            placeholder="ATT, Write, name..."
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Text filter"
          />
        </label>
        <button className={btnCls} onClick={exportCsv} disabled={filtered.length === 0}>
          <Download size={12} /> Export filtered CSV ({filtered.length})
        </button>
      </div>
      {badHandle && <div className="text-[11px] text-red-300">Handle must be a hex number, e.g. 0x0040.</div>}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="max-h-[420px] overflow-auto border border-slate-800 rounded">
            <table className="w-full text-[11px] font-mono">
              <thead className="sticky top-0 bg-slate-900 text-slate-500">
                <tr>
                  <th className="text-left px-2 py-1">#</th>
                  <th className="text-left px-2 py-1">Time s</th>
                  <th className="text-left px-2 py-1">Dir</th>
                  <th className="text-left px-2 py-1">Type</th>
                  <th className="text-left px-2 py-1">Summary</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr
                    key={p.no}
                    onClick={() => setSelected(p.no)}
                    className={`cursor-pointer border-t border-slate-900 hover:bg-slate-900 ${selected === p.no ? 'bg-cyan-950/40' : ''}`}
                  >
                    <td className="px-2 py-0.5 text-slate-500">{p.no}</td>
                    <td className="px-2 py-0.5 text-slate-400 whitespace-nowrap">{(p.relUs / 1e6).toFixed(6)}</td>
                    <td className="px-2 py-0.5 text-slate-500">{p.direction === 'sent' ? 'TX' : p.direction === 'received' ? 'RX' : '?'}</td>
                    <td className="px-2 py-0.5"><span className={`px-1 rounded border ${TYPE_BADGE[p.type] || TYPE_BADGE.unknown}`}>{p.type}</span></td>
                    <td className="px-2 py-0.5 text-gray-200 truncate max-w-[360px]" title={p.summary}>{p.summary}</td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-3 text-slate-500">No packets match the filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500">
            <span>Showing {shown.length} of {filtered.length} matching packets ({analysis.packets.length} in file)</span>
            {filtered.length > shown.length && (
              <button className="text-cyan-400 hover:text-cyan-300" onClick={() => setLimit((l) => l + PAGE)}>Show more</button>
            )}
          </div>
        </div>
        <div className="min-w-0 max-h-[520px] overflow-auto">
          <PacketDetail pk={selectedPk} connLabel={selectedPk ? connLabel(selectedPk) : ''} />
        </div>
      </div>
    </div>
  );
}

function GattTab({ analysis, connId, setConnId }) {
  const conns = analysis.connections;
  const conn = conns.find((c) => c.id === connId) || null;
  const model = useMemo(() => (conn ? buildGattModel(conn) : null), [conn]);
  const [sel, setSel] = useState(null);

  if (!conn) {
    return <div className="text-xs text-slate-500 p-3">No connections in this capture.</div>;
  }
  const selHandle = sel === null || !model ? null : model.handles.find((h) => h.handle === sel) || null;
  const attOps = conn.attOps;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span className="text-slate-500">Connection</span>
        <select className={inputCls} value={conn.id} onChange={(e) => { setConnId(Number(e.target.value)); setSel(null); }}>
          {conns.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.id} {c.transport} {hex16(c.handle)} {c.peerAddr || ''} ({c.attOps} ATT)
            </option>
          ))}
        </select>
        {model && model.mtu && <span className="text-slate-400 font-mono">ATT MTU {model.mtu}</span>}
      </div>
      {attOps === 0 && (
        <div className="text-xs text-slate-500">No ATT traffic on this connection in the capture.</div>
      )}
      {model && attOps > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="Services" value={model.services.length} />
            <Stat label="Characteristics" value={model.characteristics.length} />
            <Stat label="Handles accessed" value={model.handles.length} />
            <Stat label="ATT errors" value={model.errors.length} />
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Services (from Read By Group Type responses)</div>
            <div className="overflow-auto border border-slate-800 rounded">
              <table className="w-full text-[11px] font-mono">
                <thead className="bg-slate-900 text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1">Handles</th>
                    <th className="text-left px-2 py-1">UUID</th>
                    <th className="text-left px-2 py-1">Name</th>
                    <th className="text-left px-2 py-1">Characteristics</th>
                  </tr>
                </thead>
                <tbody>
                  {model.services.map((s) => (
                    <tr key={`${s.startHandle}-${s.endHandle}`} className="border-t border-slate-900 align-top">
                      <td className="px-2 py-0.5 text-slate-400">{hex16(s.startHandle)}-{hex16(s.endHandle)}</td>
                      <td className="px-2 py-0.5 text-gray-200">{s.uuid}</td>
                      <td className="px-2 py-0.5 text-cyan-200">{s.uuidName || (s.primary ? 'Primary' : 'Secondary')}</td>
                      <td className="px-2 py-0.5">
                        {s.characteristics.map((ch) => (
                          <div key={ch.declHandle} className="text-slate-300">
                            <span className="text-slate-500">{hex16(ch.declHandle)} / value {hex16(ch.valueHandle)}</span>{' '}
                            {ch.uuidName || ch.uuid} <span className="text-slate-500">[{propNames(ch.props).join(', ') || 'none'}]</span>
                          </div>
                        ))}
                        {s.characteristics.length === 0 && <span className="text-slate-600">none discovered</span>}
                      </td>
                    </tr>
                  ))}
                  {model.services.length === 0 && (
                    <tr><td colSpan={4} className="px-2 py-2 text-slate-500">No service discovery responses seen in this capture.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <div className="text-[11px] text-slate-500 mb-1">Per-handle access (reads, writes, notifications) - click a row for every value</div>
            <div className="overflow-auto max-h-72 border border-slate-800 rounded">
              <table className="w-full text-[11px] font-mono">
                <thead className="sticky top-0 bg-slate-900 text-slate-500">
                  <tr>
                    <th className="text-left px-2 py-1">Handle</th>
                    <th className="text-left px-2 py-1">Name</th>
                    <th className="text-right px-2 py-1">R</th>
                    <th className="text-right px-2 py-1">W</th>
                    <th className="text-right px-2 py-1">N</th>
                    <th className="text-right px-2 py-1">I</th>
                    <th className="text-left px-2 py-1">Last value (hex / UTF-8)</th>
                  </tr>
                </thead>
                <tbody>
                  {model.handles.map((h) => {
                    const text = h.last ? utf8Preview(h.last) : null;
                    return (
                      <tr
                        key={h.handle}
                        onClick={() => setSel(h.handle)}
                        className={`cursor-pointer border-t border-slate-900 hover:bg-slate-900 ${sel === h.handle ? 'bg-cyan-950/40' : ''}`}
                      >
                        <td className="px-2 py-0.5 text-slate-300">{hex16(h.handle)}</td>
                        <td className="px-2 py-0.5 text-cyan-200 truncate max-w-[200px]">{h.name || '-'}</td>
                        <td className="px-2 py-0.5 text-right">{h.reads}</td>
                        <td className="px-2 py-0.5 text-right">{h.writes}</td>
                        <td className="px-2 py-0.5 text-right">{h.notifies}</td>
                        <td className="px-2 py-0.5 text-right">{h.indications}</td>
                        <td className="px-2 py-0.5 text-gray-200 break-all">
                          {h.last ? `${toHex(h.last)}${text ? `  "${text}"` : ''}` : '-'}
                        </td>
                      </tr>
                    );
                  })}
                  {model.handles.length === 0 && (
                    <tr><td colSpan={7} className="px-2 py-2 text-slate-500">No reads, writes or notifications decoded.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {selHandle && (
              <div className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded">
                <div className="text-[11px] text-slate-400 font-mono mb-1">
                  {hex16(selHandle.handle)} {selHandle.name || ''}: {selHandle.values.length} event(s)
                </div>
                <div className="max-h-48 overflow-auto font-mono text-[11px]">
                  {selHandle.values.slice(0, 200).map((v, i) => {
                    const t = v.value ? utf8Preview(v.value) : null;
                    return (
                      <div key={i} className="border-b border-slate-900 py-0.5">
                        <span className="text-slate-500">#{v.no} {v.dir === 'sent' ? 'TX' : 'RX'} {v.kind}</span>{' '}
                        <span className="text-gray-200">{v.value ? toHex(v.value) || '(empty)' : '(no value)'}</span>
                        {t ? <span className="text-emerald-300">{`  "${t}"`}</span> : null}
                        {v.status ? <span className="text-amber-300">{`  [${v.status}]`}</span> : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <div className="text-[10px] text-slate-600">
            Descriptor handles are inferred from the handle range after each characteristic value unless a Find Information response named them.
            Encrypted ATT payloads (after pairing) cannot be decoded from the capture.
          </div>
        </>
      )}
    </div>
  );
}

function ConnsTab({ analysis, onPick }) {
  if (analysis.connections.length === 0) {
    return <div className="text-xs text-slate-500 p-3">No connections seen in this capture.</div>;
  }
  return (
    <div className="overflow-auto max-h-[480px] border border-slate-800 rounded">
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 bg-slate-900 text-slate-500">
          <tr>
            <th className="text-left px-2 py-1">#</th>
            <th className="text-left px-2 py-1">Transport</th>
            <th className="text-left px-2 py-1">Handle</th>
            <th className="text-left px-2 py-1">Role</th>
            <th className="text-left px-2 py-1">Peer</th>
            <th className="text-left px-2 py-1">Start / end pkt</th>
            <th className="text-left px-2 py-1">Interval</th>
            <th className="text-right px-2 py-1">Pkts</th>
            <th className="text-right px-2 py-1">ATT</th>
            <th className="text-left px-2 py-1">End reason</th>
          </tr>
        </thead>
        <tbody>
          {analysis.connections.map((c) => (
            <tr key={c.id} onClick={() => onPick(c.id)} className="cursor-pointer border-t border-slate-900 hover:bg-slate-900">
              <td className="px-2 py-0.5">{c.id}</td>
              <td className="px-2 py-0.5 text-slate-300">{c.transport}</td>
              <td className="px-2 py-0.5">{hex16(c.handle)}</td>
              <td className="px-2 py-0.5 text-slate-400">{c.role === 0 ? 'Central' : c.role === 1 ? 'Peripheral' : '-'}</td>
              <td className="px-2 py-0.5 text-gray-200">{c.peerAddr || '-'}</td>
              <td className="px-2 py-0.5 text-slate-400">{c.startNo} / {c.endNo ?? 'open'}</td>
              <td className="px-2 py-0.5 text-slate-400">{c.interval !== null && c.interval !== undefined ? `${(c.interval * 1.25).toFixed(2)} ms` : '-'}</td>
              <td className="px-2 py-0.5 text-right">{c.packets}</td>
              <td className="px-2 py-0.5 text-right">{c.attOps}</td>
              <td className="px-2 py-0.5 text-slate-400 truncate max-w-[220px]">{c.status ? `failed: ${c.reason}` : c.reason || (c.endNo ? '-' : 'open at end of capture')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-[10px] text-slate-600 px-2 py-1">Click a connection to open its GATT view.</div>
    </div>
  );
}

export default function BtHciLogWorkbench({ onLogMessage }) {
  const [analysis, setAnalysis] = useState(null);
  const [sourceLabel, setSourceLabel] = useState('');
  const [format, setFormat] = useState({ name: '', linkType: null });
  const [error, setError] = useState('');
  const [tab, setTab] = useState('packets');
  const [connId, setConnId] = useState(null);
  const [showWarnings, setShowWarnings] = useState(false);

  const ingest = (bytes, label) => {
    try {
      const cap = parseCapture(bytes);
      const an = analyzeCapture(cap);
      setAnalysis(an);
      setSourceLabel(label);
      setFormat({ name: cap.format, linkType: cap.linkType });
      setError('');
      setShowWarnings(false);
      const firstAtt = an.connections.find((c) => c.attOps > 0) || an.connections[0] || null;
      setConnId(firstAtt ? firstAtt.id : null);
      onLogMessage?.(`BT HCI log: ${cap.format} with ${an.packets.length} packet(s) from ${label}`, 'info');
    } catch (e) {
      setAnalysis(null);
      setError(e.message || String(e));
      onLogMessage?.(`BT HCI log: ${e.message || e}`, 'error');
    }
  };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const buf = await f.arrayBuffer();
      ingest(new Uint8Array(buf), f.name);
    } catch (err) {
      setError(`Could not read the file: ${err.message || err}`);
    }
  };

  const stats = analysis ? analysis.stats : null;

  return (
    <div className="p-3 space-y-3 text-gray-200 bg-slate-950 min-h-full">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Bluetooth size={18} className="text-cyan-400" />
          <div>
            <div className="text-sm font-semibold">Bluetooth HCI Log Viewer</div>
            <div className="text-[11px] text-slate-500">Offline decoder for btsnoop_hci.log, pcap and pcapng (link 201). Parsed in your browser; nothing is uploaded or captured.</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className={`${btnCls} cursor-pointer`}>
            <Upload size={12} /> Open capture file
            <input type="file" accept=".log,.cfa,.btsnoop,.pcap,.pcapng,.bin,application/octet-stream" className="hidden" onChange={onFile} />
          </label>
          <button className={btnCls} onClick={() => ingest(makeExampleCapture(), EXAMPLE_LABEL)}>
            <Play size={12} /> Load example
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      {!analysis && !error && (
        <div className="p-4 border border-dashed border-slate-800 rounded text-xs text-slate-400 space-y-2">
          <div>Open an Android <span className="font-mono">btsnoop_hci.log</span> (or a pcap/pcapng with link type 201) to decode it.</div>
          <div className="text-slate-500">
            On Android, enable Developer options, then "Bluetooth HCI snoop log", reproduce the session, and pull the log
            (for example from a bug report). The file is parsed locally.
          </div>
        </div>
      )}

      {analysis && stats && (
        <>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono flex-wrap">
            <span className="text-slate-300">{sourceLabel}</span>
            <span>{format.name} capture, link type {format.linkType}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
            <Stat label="Packets" value={stats.total} />
            <Stat label="Commands" value={stats.cmd} />
            <Stat label="Events" value={stats.evt} />
            <Stat label="ACL" value={stats.acl} />
            <Stat label="L2CAP SDUs" value={stats.sdus} />
            <Stat label="ATT PDUs" value={stats.attOps} />
            <Stat label="Connections" value={analysis.connections.length} />
            <Stat label="Warnings" value={analysis.warnings.length} />
          </div>

          {analysis.warnings.length > 0 && (
            <div className="text-[11px]">
              <button className="text-amber-300 hover:text-amber-200" onClick={() => setShowWarnings((s) => !s)}>
                {showWarnings ? 'Hide' : 'Show'} {analysis.warnings.length} parser warning(s)
              </button>
              {showWarnings && (
                <ul className="mt-1 max-h-32 overflow-auto font-mono text-amber-200/80 list-disc pl-5">
                  {analysis.warnings.slice(0, 200).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              )}
            </div>
          )}

          <div className="flex gap-1 border-b border-slate-800">
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`px-3 py-1.5 text-xs inline-flex items-center gap-1.5 border-b-2 -mb-px ${tab === id ? 'border-cyan-500 text-cyan-300' : 'border-transparent text-slate-400 hover:text-gray-200'}`}
              >
                <Icon size={12} /> {label}
              </button>
            ))}
          </div>

          {tab === 'packets' && <PacketsTab analysis={analysis} />}
          {tab === 'gatt' && <GattTab analysis={analysis} connId={connId} setConnId={setConnId} />}
          {tab === 'conns' && (
            <ConnsTab
              analysis={analysis}
              onPick={(id) => {
                setConnId(id);
                setTab('gatt');
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
