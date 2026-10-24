import React, { useState, useMemo } from 'react';
import {
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Search,
  Filter,
  Shield,
  Key,
  Layers,
  Clock,
  Table as TableIcon,
  Maximize2,
  Minimize2,
  Info
} from 'lucide-react';

/**
 * Recursive JSON Tree Node
 */
function JsonTreeNode({ keyName, value, depth = 0, isLast = true, searchQuery = '' }) {
  const [collapsed, setCollapsed] = useState(depth > 2);
  const [copied, setCopied] = useState(false);

  const isObject = value !== null && typeof value === 'object';
  const isArray = Array.isArray(value);

  const matchesSearch = useMemo(() => {
    if (!searchQuery) return false;
    const q = searchQuery.toLowerCase();
    if (keyName && keyName.toLowerCase().includes(q)) return true;
    if (!isObject && String(value).toLowerCase().includes(q)) return true;
    return false;
  }, [keyName, value, isObject, searchQuery]);

  const copyVal = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(JSON.stringify(value, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  let valueDisplay;
  if (value === null) {
    valueDisplay = <span className="text-rose-400 font-bold">null</span>;
  } else if (typeof value === 'boolean') {
    valueDisplay = <span className="text-amber-400 font-bold">{value ? 'true' : 'false'}</span>;
  } else if (typeof value === 'number') {
    valueDisplay = <span className="text-cyan-400">{value}</span>;
  } else if (typeof value === 'string') {
    valueDisplay = <span className="text-emerald-300">"{value}"</span>;
  }

  if (!isObject) {
    return (
      <div
        className={`flex items-center gap-1 font-mono text-[11px] py-0.5 px-1.5 rounded transition ${
          matchesSearch ? 'bg-amber-400/20 text-amber-200' : 'hover:bg-[#1a1d26]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {keyName && (
          <>
            <span className="text-slate-400">"{keyName}"</span>
            <span className="text-slate-600 mr-1">:</span>
          </>
        )}
        {valueDisplay}
        {!isLast && <span className="text-slate-600">,</span>}
      </div>
    );
  }

  const entries = isArray ? value.map((v, i) => [i, v]) : Object.entries(value);
  const isEmpty = entries.length === 0;

  return (
    <div className="font-mono text-[11px] select-text">
      <div
        onClick={() => setCollapsed(!collapsed)}
        className={`flex items-center gap-1 py-0.5 px-1.5 rounded cursor-pointer transition ${
          matchesSearch ? 'bg-amber-400/20 text-amber-200' : 'hover:bg-[#1a1d26]'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {!isEmpty ? (
          collapsed ? (
            <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 text-cyan-400 shrink-0" />
          )
        ) : (
          <span className="w-3 shrink-0" />
        )}

        {keyName && (
          <>
            <span className="text-slate-300 font-bold">"{keyName}"</span>
            <span className="text-slate-600">:</span>
          </>
        )}

        <span className="text-slate-400">
          {isArray ? '[' : '{'}
          {collapsed && (
            <span className="text-slate-500 text-[10px] mx-1">
              {entries.length} item{entries.length !== 1 ? 's' : ''}...
            </span>
          )}
          {collapsed && (isArray ? ']' : '}')}
        </span>

        <button
          onClick={copyVal}
          className="ml-auto opacity-0 group-hover:opacity-100 hover:text-cyan-300 p-0.5 text-slate-500"
          title="Copy node value"
          type="button"
        >
          {copied ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
        </button>
      </div>

      {!collapsed && !isEmpty && (
        <div>
          {entries.map(([k, val], idx) => (
            <JsonTreeNode
              key={k}
              keyName={isArray ? null : String(k)}
              value={val}
              depth={depth + 1}
              isLast={idx === entries.length - 1}
              searchQuery={searchQuery}
            />
          ))}
          <div style={{ paddingLeft: `${depth * 16 + 4}px` }} className="text-slate-400 py-0.5 px-1.5">
            {isArray ? ']' : '}'}
            {!isLast && <span className="text-slate-600">,</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * JWT Structured Decoder Component
 */
function JwtView({ data }) {
  const jwtParts = useMemo(() => {
    let raw = String(data || '').trim();
    // If output is already JSON parsed JWT (e.g. from Parse JWT op)
    try {
      const parsed = JSON.parse(raw);
      if (parsed && (parsed.header || parsed.payload || parsed.claims)) {
        return {
          header: parsed.header || { alg: 'HS256', typ: 'JWT' },
          payload: parsed.payload || parsed.claims || parsed,
          signature: parsed.signature || 'Verified / Embedded'
        };
      }
    } catch {}

    // Parse dot-separated JWT token
    const parts = raw.split('.');
    if (parts.length >= 2) {
      try {
        const decodeB64 = (b64) => {
          const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
          return JSON.parse(atob(padded));
        };
        const header = decodeB64(parts[0]);
        const payload = decodeB64(parts[1]);
        const signature = parts[2] || '';
        return { header, payload, signature };
      } catch {}
    }

    return null;
  }, [data]);

  if (!jwtParts) {
    return (
      <div className="py-12 text-center text-slate-500 text-xs font-mono">
        Unable to decode payload as JSON Web Token (JWT).
      </div>
    );
  }

  const expDate = jwtParts.payload?.exp ? new Date(jwtParts.payload.exp * 1000) : null;
  const isExpired = expDate ? expDate.getTime() < Date.now() : false;

  return (
    <div className="space-y-3 font-mono text-xs">
      {/* Expiration Banner */}
      {expDate && (
        <div
          className={`p-2.5 rounded-xl border flex items-center justify-between text-xs ${
            isExpired
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            <span>
              {isExpired ? 'Token EXPIRED at:' : 'Token VALID until:'} {expDate.toUTCString()}
            </span>
          </div>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-black/30">
            {isExpired ? 'Expired' : 'Active'}
          </span>
        </div>
      )}

      {/* Header Card (Red/Rose) */}
      <div className="bg-[#12141a] border border-rose-500/40 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between border-b border-[#232733] pb-1.5">
          <span className="font-bold text-rose-400 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Key className="w-3.5 h-3.5" />
            <span>HEADER: ALGORITHM & TOKEN TYPE</span>
          </span>
          <span className="text-[10px] text-slate-500">RFC 7519</span>
        </div>
        <pre className="text-rose-300 text-xs bg-[#0b0d12] p-2.5 rounded-lg border border-[#1e222d] overflow-x-auto">
          {JSON.stringify(jwtParts.header, null, 2)}
        </pre>
      </div>

      {/* Payload Card (Purple/Violet) */}
      <div className="bg-[#12141a] border border-purple-500/40 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between border-b border-[#232733] pb-1.5">
          <span className="font-bold text-purple-400 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />
            <span>PAYLOAD: CLAIMS & USER DATA</span>
          </span>
          <span className="text-[10px] text-slate-500">
            {Object.keys(jwtParts.payload || {}).length} claims
          </span>
        </div>
        <pre className="text-purple-300 text-xs bg-[#0b0d12] p-2.5 rounded-lg border border-[#1e222d] overflow-x-auto">
          {JSON.stringify(jwtParts.payload, null, 2)}
        </pre>
      </div>

      {/* Signature Card (Cyan) */}
      <div className="bg-[#12141a] border border-cyan-500/40 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between border-b border-[#232733] pb-1.5">
          <span className="font-bold text-cyan-400 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            <span>SIGNATURE</span>
          </span>
          <span className="text-[10px] text-slate-500">Base64URL</span>
        </div>
        <pre className="text-cyan-300 text-xs bg-[#0b0d12] p-2.5 rounded-lg border border-[#1e222d] break-all whitespace-pre-wrap">
          {jwtParts.signature || 'No signature present'}
        </pre>
      </div>
    </div>
  );
}

/**
 * Table View Component for CSV, TSV, or Extracted Line Lists
 */
function TableView({ data }) {
  const [filterQuery, setFilterQuery] = useState('');

  const tableData = useMemo(() => {
    const raw = String(data || '').trim();
    if (!raw) return { headers: [], rows: [] };

    // Try CSV/TSV parsing
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return { headers: [], rows: [] };

    const delimiter = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : null;

    if (delimiter) {
      const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^["']|["']$/g, ''));
      const rows = lines.slice(1).map((line) => {
        return line.split(delimiter).map((cell) => cell.trim().replace(/^["']|["']$/g, ''));
      });
      return { headers, rows };
    }

    // Line list (e.g. extracted IP addresses, hashes, emails)
    return {
      headers: ['Index', 'Extracted Value'],
      rows: lines.map((l, idx) => [idx + 1, l])
    };
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!filterQuery) return tableData.rows;
    const q = filterQuery.toLowerCase();
    return tableData.rows.filter((row) =>
      row.some((cell) => String(cell).toLowerCase().includes(q))
    );
  }, [tableData.rows, filterQuery]);

  if (tableData.headers.length === 0) {
    return (
      <div className="py-12 text-center text-slate-500 text-xs font-mono">
        No tabular data detected in output.
      </div>
    );
  }

  return (
    <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-3 space-y-3 font-mono text-xs">
      {/* Table Filter Input */}
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter table rows..."
            className="w-full bg-[#171920] border border-[#282d3a] rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400"
          />
        </div>

        <span className="text-[11px] text-slate-400">
          Showing {filteredRows.length} of {tableData.rows.length} rows
        </span>
      </div>

      {/* HTML Table Container */}
      <div className="overflow-x-auto scrollbar-thin rounded-lg border border-[#1f232d] max-h-96">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-[#161822] text-slate-400 border-b border-[#262b3a] text-left">
              {tableData.headers.map((h, i) => (
                <th key={i} className="px-3 py-2 font-bold uppercase tracking-wider">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={tableData.headers.length} className="text-center py-6 text-slate-500">
                  No matching rows found.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, rIdx) => (
                <tr
                  key={rIdx}
                  className="border-b border-[#141620] hover:bg-[#181b26] transition-colors"
                >
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-1.5 text-slate-200 truncate max-w-xs">
                      {String(cell)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * CyberChefStructuredView
 * Orchestrates JSON Tree, JWT Decoder, and Table View visualizers.
 */
export default function CyberChefStructuredView({ mode = 'tree', data }) {
  const [searchQuery, setSearchQuery] = useState('');

  const parsedJson = useMemo(() => {
    try {
      return JSON.parse(String(data || ''));
    } catch {
      return null;
    }
  }, [data]);

  if (mode === 'jwt') {
    return <JwtView data={data} />;
  }

  if (mode === 'table') {
    return <TableView data={data} />;
  }

  // JSON Tree View default
  if (!parsedJson) {
    return (
      <div className="py-12 text-center text-slate-500 text-xs font-mono bg-[#12141a] rounded-xl border border-[#282d3a] p-6 space-y-2">
        <Info className="w-6 h-6 mx-auto text-slate-600" />
        <p>Output is not valid JSON.</p>
        <p className="text-[11px] text-slate-600">Apply an operation like "JSON Beautify" or output structured data to view in Tree mode.</p>
      </div>
    );
  }

  return (
    <div className="bg-[#12141a] border border-[#282d3a] rounded-xl p-3 space-y-3">
      {/* Search Bar for Tree */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search JSON keys & values..."
            className="w-full bg-[#171920] border border-[#282d3a] rounded-lg pl-8 pr-3 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
          />
        </div>

        <button
          onClick={() => {
            navigator.clipboard.writeText(JSON.stringify(parsedJson, null, 2));
          }}
          className="px-2.5 py-1 bg-[#1a1d26] hover:bg-[#232733] text-slate-300 border border-[#282d3a] rounded-lg text-xs font-mono transition flex items-center gap-1.5"
          type="button"
        >
          <Copy className="w-3 h-3 text-slate-400" />
          <span>Copy Formatted JSON</span>
        </button>
      </div>

      {/* Collapsible Tree Container */}
      <div className="bg-[#0b0d12] border border-[#1e222d] rounded-lg p-3 max-h-[460px] overflow-y-auto scrollbar-thin">
        <JsonTreeNode value={parsedJson} searchQuery={searchQuery} />
      </div>
    </div>
  );
}
