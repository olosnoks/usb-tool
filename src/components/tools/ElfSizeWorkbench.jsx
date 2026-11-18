import React, { useMemo, useState } from 'react';
import { Ruler, Upload, Trash2, FileDown, Search, LayoutGrid, GitCompare, List, Layers } from 'lucide-react';
import {
  isElf, parseElf, parseMapFile, aggregateMap, filterSymbols, groupByNamespace, formatBytes,
  buildTree, layoutTree, capItems, diffRows, toCsv,
} from '../../utils/elfSize.js';

/**
 * ELF / GNU ld map size analyzer. Fully offline: files are read in the browser and never uploaded.
 * Slot A is the primary build; slot B is the comparison build (Compare tab). Each slot takes an
 * ELF and/or a GNU ld .map file (detected by content, not by extension).
 */

const TABS = [
  ['summary', 'Summary', Ruler],
  ['symbols', 'Symbols', List],
  ['objects', 'Objects', Layers],
  ['treemap', 'Treemap', LayoutGrid],
  ['compare', 'Compare', GitCompare],
];
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200';
const btnCls = 'px-2 py-1 text-[11px] rounded border border-slate-700 bg-slate-800 text-gray-300 hover:bg-slate-700 inline-flex items-center gap-1';
const SLOT_LABEL = { A: 'Build A (primary)', B: 'Build B (compare)' };
const emptySlot = () => ({ elf: null, map: null, errors: [] });

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function hashHue(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function UsageBar({ pct }) {
  const p = Math.min(100, Math.max(0, pct || 0));
  const color = pct > 90 ? 'bg-rose-500' : pct > 70 ? 'bg-amber-500' : 'bg-cyan-500';
  return (
    <div className="w-40 h-2 bg-slate-800 rounded overflow-hidden" role="meter" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full ${color}`} style={{ width: `${p}%` }} />
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-xs text-slate-500 border border-dashed border-slate-800 rounded p-4">{children}</div>;
}

function Table({ head, rows, empty = 'No rows.', maxHeight = 'max-h-80' }) {
  return (
    <div className={`overflow-auto ${maxHeight} border border-slate-800 rounded`}>
      <table className="w-full text-[11px] font-mono">
        <thead className="sticky top-0 bg-slate-900 text-slate-400">
          <tr>{head.map((h) => <th key={h} className="text-left font-normal px-2 py-1 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={head.length} className="px-2 py-3 text-slate-600">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-slate-900 hover:bg-slate-900/60 align-top">
              {r.map((cell, j) => <td key={j} className="px-2 py-0.5 text-gray-200 break-all">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-2 min-w-[8rem]">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-sm font-mono text-cyan-300">{value}</div>
      {sub && <div className="text-[10px] text-slate-600 font-mono">{sub}</div>}
    </div>
  );
}

function SummaryTab({ slot }) {
  const elf = slot.elf;
  const map = slot.map;
  if (!elf && !map) return <Empty>Load an ELF (.elf, .axf, .out) and/or a GNU ld map (.map) for build A.</Empty>;
  return (
    <div className="space-y-4">
      {elf && (
        <section className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Stat label="ELF" value={`${elf.bits}-bit ${elf.endian}`} sub={`${elf.machineName} · ${elf.typeName}`} />
            <Stat label="FLASH (image)" value={formatBytes(elf.flashBytes)} sub="text + rodata + data LMA" />
            <Stat label="RAM (static)" value={formatBytes(elf.ramBytes)} sub="data + bss + noinit" />
            <Stat label="Sections" value={elf.sections.filter((s) => s.loaded).length} sub={`${elf.sections.length} total`} />
            <Stat label="Symbols" value={elf.symbols.length} sub={elf.symbolTableName || 'no symbol table'} />
          </div>
          <div className="text-[11px] text-slate-400">Loaded sections ({elf.name})</div>
          <Table
            head={['Section', 'Type', 'Flags', 'Region', 'Address', 'LMA', 'Size', 'Flash', 'RAM']}
            rows={elf.sections.filter((s) => s.index > 0 && (s.loaded || s.size > 0)).map((s) => [
              s.name || '(none)', s.typeName, s.flagStr, s.region, `0x${s.addr.toString(16)}`, `0x${s.lma.toString(16)}`,
              formatBytes(s.size), s.flashBytes ? formatBytes(s.flashBytes) : '-', s.ramBytes ? formatBytes(s.ramBytes) : '-',
            ])}
            empty="No sections."
          />
          {elf.segments.length > 0 && (
            <>
              <div className="text-[11px] text-slate-400">Program headers</div>
              <Table
                head={['#', 'Type', 'Flags', 'Virtual addr', 'Physical (LMA)', 'File size', 'Mem size']}
                rows={elf.segments.map((p) => [
                  p.index, p.typeName, p.flagStr, `0x${p.vaddr.toString(16)}`, `0x${p.paddr.toString(16)}`,
                  formatBytes(p.filesz), formatBytes(p.memsz),
                ])}
              />
            </>
          )}
        </section>
      )}
      {map && (
        <section className="space-y-2">
          <div className="text-[11px] text-slate-400">Memory regions from {map.name}</div>
          {map.regions.length === 0 && <Empty>This map has no "Memory Configuration" block, so there are no region usage bars.</Empty>}
          {map.regions.length > 0 && (
            <Table
              head={['Region', 'Origin', 'Length', 'Attributes', 'Used', '%', 'Usage']}
              rows={map.regions.map((r) => [
                r.name, `0x${r.origin.toString(16)}`, formatBytes(r.length), r.attributes || '-',
                formatBytes(r.used), `${r.usedPct.toFixed(1)}%`, <UsageBar key={r.name} pct={r.usedPct} />,
              ])}
            />
          )}
          <div className="text-[11px] text-slate-400">Output sections</div>
          <Table
            head={['Section', 'Address', 'Load address', 'Size', 'Region (run)', 'Region (load)']}
            rows={map.outputSections.filter((s) => s.size).map((s) => [
              s.name, `0x${s.addr.toString(16)}`, `0x${s.lma.toString(16)}`, formatBytes(s.size), s.region, s.lmaRegion,
            ])}
            empty="No output sections found."
          />
          {!map.hasLinkerMap && <div className="text-[11px] text-amber-400">Note: no "Linker script and memory map" header; input-section detail may be missing.</div>}
        </section>
      )}
    </div>
  );
}

function SymbolsTab({ elf }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [bind, setBind] = useState('all');
  const [region, setRegion] = useState('all');
  const [section, setSection] = useState('all');
  const [topN, setTopN] = useState('200');
  const [byNs, setByNs] = useState(false);
  const sectionNames = useMemo(() => (elf ? [...new Set(elf.symbols.map((s) => s.section))].sort() : []), [elf]);
  const filtered = useMemo(() => (elf ? filterSymbols(elf.symbols, { query, type, bind, region, section }).sort((a, b) => b.size - a.size || a.name.localeCompare(b.name)) : []), [elf, query, type, bind, region, section]);
  const namespaces = useMemo(() => (byNs ? groupByNamespace(filtered) : []), [byNs, filtered]);
  if (!elf) return <Empty>Load an ELF file for build A to browse its symbol table.</Empty>;

  const limit = topN === 'all' ? Infinity : Number(topN);
  const shown = filtered.slice(0, limit);
  const total = filtered.reduce((a, s) => a + s.size, 0);
  const csvRows = byNs ? namespaces : filtered;
  const exportCsv = () => {
    const cols = byNs
      ? [{ key: 'name', label: 'namespace' }, { key: 'size', label: 'size' }, { key: 'count', label: 'symbols' }]
      : [{ key: 'name', label: 'name' }, { key: 'size', label: 'size' }, { key: 'typeName', label: 'type' }, { key: 'bindName', label: 'bind' }, { key: 'section', label: 'section' }, { key: 'region', label: 'region' }, { key: 'value', label: 'value' }];
    downloadText(`${elf.name.replace(/\.[^.]+$/, '')}-symbols.csv`, toCsv(csvRows, cols));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-2">
          <Search size={12} className="text-slate-500" />
          <input aria-label="Filter symbols" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter by name" className="bg-transparent text-xs font-mono py-1 outline-none w-44" />
        </div>
        <select aria-label="Symbol type" value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
          {['all', 'FUNC', 'OBJECT', 'NOTYPE', 'TLS', 'IFUNC', 'COMMON', 'SECTION', 'FILE'].map((t) => <option key={t} value={t}>{t === 'all' ? 'all types' : t}</option>)}
        </select>
        <select aria-label="Symbol binding" value={bind} onChange={(e) => setBind(e.target.value)} className={inputCls}>
          {['all', 'GLOBAL', 'LOCAL', 'WEAK'].map((t) => <option key={t} value={t}>{t === 'all' ? 'all bindings' : t}</option>)}
        </select>
        <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls}>
          {['all', 'FLASH', 'RAM', 'DEBUG', 'ABS', 'UNDEF', 'COMMON', 'OTHER'].map((t) => <option key={t} value={t}>{t === 'all' ? 'all regions' : t}</option>)}
        </select>
        <select aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)} className={`${inputCls} max-w-[12rem]`}>
          <option value="all">all sections</option>
          {sectionNames.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <select aria-label="Show top" value={topN} onChange={(e) => setTopN(e.target.value)} className={inputCls}>
          {['50', '200', '1000', 'all'].map((n) => <option key={n} value={n}>top {n}</option>)}
        </select>
        <label className="text-[11px] text-slate-400 inline-flex items-center gap-1">
          <input type="checkbox" checked={byNs} onChange={(e) => setByNs(e.target.checked)} />
          group by C++ namespace (first '::')
        </label>
        <button onClick={exportCsv} className={`${btnCls} ml-auto`}><FileDown size={11} /> Export CSV</button>
      </div>
      <div className="text-[11px] text-slate-500 font-mono">{filtered.length} matching symbols, {formatBytes(total)} total. Names are shown raw (not demangled).</div>
      {byNs ? (
        <Table
          head={['Namespace', 'Symbols', 'Size']}
          rows={namespaces.slice(0, limit).map((g) => [g.name, g.count, formatBytes(g.size)])}
          empty="No symbols match the filter."
        />
      ) : (
        <Table
          head={['Size', 'Name', 'Type', 'Bind', 'Section', 'Region', 'Value']}
          rows={shown.map((s) => [formatBytes(s.size), s.name || '(unnamed)', s.typeName, s.bindName, s.section, s.region, `0x${s.value.toString(16)}`])}
          empty="No symbols match the filter."
          maxHeight="max-h-[28rem]"
        />
      )}
    </div>
  );
}

function ObjectsTab({ map }) {
  const [query, setQuery] = useState('');
  const agg = useMemo(() => (map ? aggregateMap(map) : null), [map]);
  if (!map) return <Empty>Load a GNU ld .map file for build A to see sizes per library and object file.</Empty>;
  const q = query.trim().toLowerCase();
  const libs = agg.byLibrary.filter((g) => !q || g.name.toLowerCase().includes(q));
  const objs = agg.byObject.filter((g) => !q || g.name.toLowerCase().includes(q));
  const total = agg.byLibrary.reduce((a, g) => a + g.size, 0);
  const exportCsv = () => downloadText(`${map.name.replace(/\.[^.]+$/, '')}-objects.csv`, toCsv(objs, [
    { key: 'name', label: 'file' }, { key: 'library', label: 'library' }, { key: 'size', label: 'size' }, { key: 'count', label: 'input sections' },
  ]));
  const pct = (n) => (total ? `${((n / total) * 100).toFixed(1)}%` : '-');
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-2">
          <Search size={12} className="text-slate-500" />
          <input aria-label="Filter objects" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter by library or object" className="bg-transparent text-xs font-mono py-1 outline-none w-56" />
        </div>
        <span className="text-[11px] text-slate-500 font-mono">input total {formatBytes(total)} from {map.inputs.length} input sections</span>
        <button onClick={exportCsv} className={`${btnCls} ml-auto`}><FileDown size={11} /> Export object CSV</button>
      </div>
      <div className="text-[11px] text-slate-400">By library (archive, or loose object file)</div>
      <Table head={['Library', 'Size', '%', 'Input sections']} rows={libs.slice(0, 500).map((g) => [g.name, formatBytes(g.size), pct(g.size), g.count])} empty="Nothing matches." />
      <div className="text-[11px] text-slate-400">By object file</div>
      <Table head={['Object file', 'Library', 'Size', '%', 'Input sections']} rows={objs.slice(0, 500).map((g) => [g.name, g.library, formatBytes(g.size), pct(g.size), g.count])} empty="Nothing matches." />
      {(libs.length > 500 || objs.length > 500) && <div className="text-[11px] text-slate-500">Showing the first 500 rows; use the filter or export CSV for everything.</div>}
    </div>
  );
}

function TreemapTab({ slot }) {
  const [source, setSource] = useState('elf');
  const [regionSel, setRegionSel] = useState('all');
  const hasElf = !!slot.elf;
  const hasMap = !!slot.map;
  const src = source === 'elf' && hasElf ? 'elf' : hasMap ? 'map' : 'elf';

  const { items, regions } = useMemo(() => {
    if (src === 'elf' && slot.elf) {
      const all = slot.elf.symbols.filter((s) => s.size > 0).map((s) => ({ value: s.size, path: [s.region, s.section, s.name || '(unnamed)'], region: s.region }));
      return { items: all, regions: [...new Set(all.map((i) => i.region))].sort() };
    }
    if (slot.map) {
      const all = slot.map.inputs.map((i) => ({
        value: i.size,
        path: i.member ? [i.section, i.library, i.member] : [i.section, i.library],
        region: i.region,
      }));
      return { items: all, regions: [...new Set(all.map((i) => i.region))].sort() };
    }
    return { items: [], regions: [] };
  }, [src, slot.elf, slot.map]);

  if (!hasElf && !hasMap) return <Empty>Load an ELF or a map file for build A to draw the treemap.</Empty>;

  const W = 1000;
  const H = 520;
  const filtered = items.filter((i) => regionSel === 'all' || i.region === regionSel);
  const total = filtered.reduce((a, i) => a + i.value, 0);
  const MAX = 800;
  const capped = capItems(filtered, MAX);
  const laid = layoutTree(buildTree(capped), 0, 0, W, H);
  const rects = laid.filter((r) => r.depth > 0 && r.leaf);
  const groups = laid.filter((r) => r.depth === 1);
  const colorFor = (r) => {
    const key = (r.key || '').split('\u0001')[1] || '';
    if (src === 'elf') {
      if (r.key.startsWith('\u0001FLASH')) return 'hsl(190 70% 40%)';
      if (r.key.startsWith('\u0001RAM')) return 'hsl(38 85% 45%)';
      return 'hsl(220 10% 35%)';
    }
    return `hsl(${hashHue(key)} 55% 40%)`;
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        {hasElf && hasMap && (
          <select aria-label="Treemap source" value={src} onChange={(e) => setSource(e.target.value)} className={inputCls}>
            <option value="elf">ELF symbols: region &gt; section &gt; symbol</option>
            <option value="map">Map inputs: section &gt; library &gt; object</option>
          </select>
        )}
        <select aria-label="Region filter" value={regionSel} onChange={(e) => setRegionSel(e.target.value)} className={inputCls}>
          <option value="all">all regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <span className="text-[11px] text-slate-500 font-mono">{formatBytes(total)} in {filtered.length} items{filtered.length > MAX ? `, ${MAX - 1} largest shown` : ''}</span>
      </div>
      {capped.length === 0 ? (
        <Empty>Nothing to draw for this selection.</Empty>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto bg-slate-950 border border-slate-800 rounded" role="img" aria-label="Size treemap">
          {rects.map((r, i) => (
            <g key={i}>
              <rect x={r.x} y={r.y} width={Math.max(0, r.w - 1)} height={Math.max(0, r.h - 1)} fill={colorFor(r)} stroke="#0b0d12" strokeWidth={0.5}>
                <title>{`${r.key.split('\u0001').slice(1).join(' > ')}: ${formatBytes(r.value)}`}</title>
              </rect>
              {r.w > 70 && r.h > 14 && (
                <text x={r.x + 3} y={r.y + 11} fontSize={10} fill="#e2e8f0" fontFamily="monospace" style={{ pointerEvents: 'none' }}>
                  {r.name.length * 6 > r.w ? r.name.slice(0, Math.max(1, Math.floor(r.w / 6) - 2)) + '..' : r.name}
                </text>
              )}
            </g>
          ))}
          {groups.filter((g) => g.w > 2 && g.h > 2).map((g, i) => (
            <rect key={`g${i}`} x={g.x} y={g.y} width={g.w} height={g.h} fill="none" stroke="#94a3b8" strokeWidth={1} style={{ pointerEvents: 'none' }} />
          ))}
        </svg>
      )}
      <div className="text-[11px] text-slate-500">
        Rectangles are sized by bytes; outlines mark top-level groups. Hover for the full path. Symbol sizes come from the ELF symbol table; FLASH/RAM here are run-address regions, so .data appears under RAM.
      </div>
    </div>
  );
}

function CompareTab({ a, b }) {
  const [what, setWhat] = useState('symbols');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [minDelta, setMinDelta] = useState('0');
  const hasA = !!(a.elf || a.map);
  const hasB = !!(b.elf || b.map);
  const diffs = useMemo(() => {
    const out = {};
    if (a.elf && b.elf) {
      const secRows = (elf) => elf.sections.filter((s) => s.loaded).map((s) => ({ key: s.name, size: s.size }));
      out.sections = diffRows(secRows(a.elf), secRows(b.elf));
      out.symbols = diffRows(a.elf.symbols.map((s) => ({ key: s.name, size: s.size })), b.elf.symbols.map((s) => ({ key: s.name, size: s.size })));
    }
    if (a.map && b.map) {
      const oa = aggregateMap(a.map);
      const ob = aggregateMap(b.map);
      out.objects = diffRows(oa.byObject.map((g) => ({ key: g.name, size: g.size })), ob.byObject.map((g) => ({ key: g.name, size: g.size })));
      out.libraries = diffRows(oa.byLibrary.map((g) => ({ key: g.name, size: g.size })), ob.byLibrary.map((g) => ({ key: g.name, size: g.size })));
    }
    return out;
  }, [a, b]);

  const available = ['sections', 'symbols', 'objects', 'libraries'].filter((k) => diffs[k]);
  const active = diffs[what] ? what : available[0];
  const rows = (active && diffs[active]) || [];
  const q = query.trim().toLowerCase();
  const min = Number(minDelta) || 0;
  const shown = rows.filter((r) => (filter === 'all' || r.status === filter || (filter === 'changed' && r.delta !== 0)) && Math.abs(r.delta) >= min && (!q || r.key.toLowerCase().includes(q)));

  const totals = a.elf && b.elf ? { fa: a.elf.flashBytes, fb: b.elf.flashBytes, ra: a.elf.ramBytes, rb: b.elf.ramBytes } : null;
  const sign = (n) => (n > 0 ? `+${formatBytes(n)}` : n < 0 ? `-${formatBytes(-n)}` : '0 B');
  if (!hasA || !hasB) return <Empty>Load build A and build B (Slots at the top) to compare. Symbol diffs need an ELF in both slots; object diffs need a map in both.</Empty>;
  if (!Object.keys(diffs).length) return <Empty>Nothing to compare yet: load an ELF in both slots (symbols and sections) and/or a map in both slots (objects and libraries).</Empty>;

  const exportCsv = () => downloadText(`compare-${active}.csv`, toCsv(shown, [
    { key: 'key', label: active === 'symbols' ? 'symbol' : active === 'sections' ? 'section' : active === 'objects' ? 'object' : 'library' },
    { key: 'before', label: 'build A bytes' }, { key: 'after', label: 'build B bytes' }, { key: 'delta', label: 'delta bytes' }, { key: 'status', label: 'status' },
  ]));

  return (
    <div className="space-y-2">
      {totals && (
        <div className="flex flex-wrap gap-2">
          <Stat label="FLASH A to B" value={sign(totals.fb - totals.fa)} sub={`${formatBytes(totals.fa)} to ${formatBytes(totals.fb)}`} />
          <Stat label="RAM A to B" value={sign(totals.rb - totals.ra)} sub={`${formatBytes(totals.ra)} to ${formatBytes(totals.rb)}`} />
        </div>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <select aria-label="Compare what" value={active} onChange={(e) => setWhat(e.target.value)} className={inputCls}>
          {available.map((k) => (
            <option key={k} value={k}>{{ sections: 'sections (ELF)', symbols: 'symbols (ELF)', objects: 'object files (map)', libraries: 'libraries (map)' }[k]}</option>
          ))}
        </select>
        <select aria-label="Change filter" value={filter} onChange={(e) => setFilter(e.target.value)} className={inputCls}>
          {['all', 'changed', 'grew', 'shrank', 'added', 'removed'].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <label className="text-[11px] text-slate-400 inline-flex items-center gap-1">
          min |delta| <input aria-label="Minimum delta" value={minDelta} onChange={(e) => setMinDelta(e.target.value)} className={`${inputCls} w-20`} />
        </label>
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded px-2">
          <Search size={12} className="text-slate-500" />
          <input aria-label="Filter compare" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="filter" className="bg-transparent text-xs font-mono py-1 outline-none w-40" />
        </div>
        <button onClick={exportCsv} className={`${btnCls} ml-auto`}><FileDown size={11} /> Export CSV</button>
      </div>
      <div className="text-[11px] text-slate-500 font-mono">{shown.length} of {rows.length} rows. Sorted by growth (largest increase first). Duplicate symbol names are summed.</div>
      <Table
        head={['Key', 'A', 'B', 'Delta', 'Status']}
        rows={shown.slice(0, 1000).map((r) => [
          r.key || '(unnamed)', formatBytes(r.before), formatBytes(r.after),
          <span key="d" className={r.delta > 0 ? 'text-rose-400' : r.delta < 0 ? 'text-emerald-400' : 'text-slate-500'}>{sign(r.delta)}</span>,
          r.status,
        ])}
        empty="No rows match."
        maxHeight="max-h-[28rem]"
      />
      {shown.length > 1000 && <div className="text-[11px] text-slate-500">Showing the first 1000 rows; export CSV for all.</div>}
    </div>
  );
}

export default function ElfSizeWorkbench({ onLogMessage }) {
  const [slots, setSlots] = useState({ A: emptySlot(), B: emptySlot() });
  const [tab, setTab] = useState('summary');
  const [busy, setBusy] = useState(false);

  const loadInto = async (key, fileList) => {
    setBusy(true);
    const errors = [];
    let elf = null;
    let map = null;
    for (const f of Array.from(fileList || [])) {
      try {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (isElf(bytes)) elf = { name: f.name, fileSize: f.size, ...parseElf(bytes) };
        else map = { name: f.name, fileSize: f.size, ...parseMapFile(new TextDecoder().decode(bytes)) };
      } catch (e) {
        errors.push(`${f.name}: ${e.message}`);
      }
    }
    setSlots((s) => ({ ...s, [key]: { elf: elf || s[key].elf, map: map || s[key].map, errors } }));
    setBusy(false);
    if (errors.length) onLogMessage?.(`ELF/map load failed: ${errors.join('; ')}`, 'error');
    else if (elf || map) onLogMessage?.(`Loaded ${[elf && elf.name, map && map.name].filter(Boolean).join(' + ')} as build ${key}`, 'info');
  };

  const clear = (key) => setSlots((s) => ({ ...s, [key]: emptySlot() }));
  const a = slots.A;
  const b = slots.B;

  const slotPicker = (key) => {
    const s = slots[key];
    return (
      <div className="bg-slate-950 border border-slate-800 rounded p-2 flex-1 min-w-[16rem]">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-slate-300">{SLOT_LABEL[key]}</span>
          <button onClick={() => clear(key)} className="text-[10px] text-slate-500 hover:text-rose-400 inline-flex items-center gap-1" disabled={!s.elf && !s.map}><Trash2 size={10} /> clear</button>
        </div>
        <label className={`${btnCls} cursor-pointer w-fit`}>
          <Upload size={11} /> Choose ELF and/or .map
          <input
            type="file"
            multiple
            accept=".elf,.axf,.out,.map,.txt,.o"
            className="sr-only"
            aria-label={`Load files for build ${key}`}
            onChange={(e) => { loadInto(key, e.target.files); e.target.value = ''; }}
          />
        </label>
        <div className="mt-1 text-[10px] font-mono text-slate-400 break-all">
          {s.elf ? <div>ELF: {s.elf.name} ({formatBytes(s.elf.fileSize)})</div> : <div className="text-slate-600">no ELF loaded</div>}
          {s.map ? <div>MAP: {s.map.name} ({formatBytes(s.map.fileSize)})</div> : <div className="text-slate-600">no map loaded</div>}
          {s.errors.map((er, i) => <div key={i} className="text-rose-400">{er}</div>)}
        </div>
      </div>
    );
  };

  return (
    <div className="p-3 text-gray-200 space-y-3">
      <div className="flex items-center gap-2">
        <Ruler size={16} className="text-cyan-400" />
        <h2 className="text-sm font-semibold">ELF / Map Size Analyzer</h2>
        <span className="text-[10px] text-slate-500">offline: files are read in this browser only</span>
        {busy && <span className="text-[10px] text-amber-400">reading...</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {slotPicker('A')}
        {slotPicker('B')}
      </div>
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs inline-flex items-center gap-1 border-b-2 -mb-px ${tab === id ? 'border-cyan-400 text-cyan-300' : 'border-transparent text-slate-400 hover:text-slate-200'}`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>
      {tab === 'summary' && <SummaryTab slot={a} />}
      {tab === 'symbols' && <SymbolsTab elf={a.elf} />}
      {tab === 'objects' && <ObjectsTab map={a.map} />}
      {tab === 'treemap' && <TreemapTab slot={a} />}
      {tab === 'compare' && <CompareTab a={a} b={b} />}
    </div>
  );
}
