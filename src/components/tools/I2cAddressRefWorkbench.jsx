import React, { useMemo, useState } from 'react';
import { Search, Copy, Check, AlertTriangle, Info, ArrowLeftRight, Layers } from 'lucide-react';
import {
  I2C_DEVICES,
  I2C_CATEGORIES,
  reservedMeaning,
  devicesAtAddress,
  searchDevices,
  formatAddress,
  formatValue,
  toWriteByte,
  toReadByte,
  fromEightBitByte,
  parseAddressInput,
  checkConflicts,
  parseScanText,
  analyzeScan,
} from '../../utils/i2cAddressDb.js';
import { freeAddresses, assignSingleBus, planBuses, muxOptions, planToText } from '../../utils/i2cPlanner.js';

/**
 * Offline I2C address reference. Nothing here touches hardware: the address map, the
 * device database, the scan-output analyser, the 7/8-bit converter and the conflict checker
 * all work from the curated list in src/utils/i2cAddressDb.js.
 */

const TABS = [
  ['map', 'Address map & parts'],
  ['scan', 'Paste scan result'],
  ['convert', '7-bit / 8-bit'],
  ['conflicts', 'Conflict checker'],
];

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 focus:outline-none focus:border-cyan-700';
const cardCls = 'bg-slate-950 border border-slate-800 rounded p-2.5';
const btnCls = 'px-2 py-0.5 text-[11px] rounded border border-slate-700 text-gray-300 hover:border-cyan-700 hover:text-cyan-300 disabled:opacity-40';

const copyText = (t) => {
  if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(String(t));
};

// Hex grid: 8 rows of 16 addresses, 0x00 to 0x7F.
const GRID_ROWS = 8;
const GRID_COLS = 16;

function AddressGrid({ selected, onSelect, counts }) {
  return (
    <div className="max-w-full overflow-x-auto">
      <div className="grid gap-0.5 min-w-[20rem] max-w-[34rem]" style={{ gridTemplateColumns: `2rem repeat(${GRID_COLS}, minmax(0, 1fr))` }}>
        <div />
        {Array.from({ length: GRID_COLS }, (_, c) => (
          <div key={`h${c}`} className="text-[10px] text-slate-600 text-center font-mono">{c.toString(16).toUpperCase()}</div>
        ))}
        {Array.from({ length: GRID_ROWS }, (_, r) => (
          <React.Fragment key={`r${r}`}>
            <div className="text-[10px] text-slate-600 font-mono self-center">0x{(r * 16).toString(16).toUpperCase().padStart(2, '0')}</div>
            {Array.from({ length: GRID_COLS }, (_, c) => {
              const addr = r * GRID_COLS + c;
              const reserved = reservedMeaning(addr);
              const n = counts[addr];
              const isSel = selected === addr;
              let cls = 'border-slate-900 text-slate-600 hover:border-slate-700';
              if (reserved) cls = 'border-amber-900 bg-amber-950/30 text-amber-500/80 hover:border-amber-700';
              else if (n > 0) cls = 'border-cyan-900 bg-slate-900 text-cyan-300 hover:border-cyan-600';
              if (isSel) cls += ' ring-2 ring-cyan-400';
              const title = `${formatAddress(addr)}${reserved ? ` - ${reserved}` : ''}${!reserved ? ` - ${n} part${n === 1 ? '' : 's'} in database` : ''}`;
              return (
                <button
                  key={addr}
                  type="button"
                  onClick={() => onSelect(addr)}
                  title={title}
                  aria-label={title}
                  className={`h-6 border rounded text-[10px] font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${cls}`}
                >
                  {addr.toString(16).toUpperCase().padStart(2, '0')}
                </button>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
        <span><span className="inline-block w-3 h-3 border border-cyan-900 bg-slate-900 align-middle mr-1" />address has known parts</span>
        <span><span className="inline-block w-3 h-3 border border-slate-900 align-middle mr-1" />no entry</span>
        <span><span className="inline-block w-3 h-3 border border-amber-900 bg-amber-950/30 align-middle mr-1" />reserved by the I2C spec</span>
      </div>
    </div>
  );
}

function DeviceCard({ device }) {
  const addrText = device.addr.map(formatAddress).join(', ');
  return (
    <div className={`${cardCls} space-y-1`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm text-gray-100 font-semibold">{device.part}</div>
          <div className="text-[11px] text-slate-500">{device.mfr} &middot; {device.category}</div>
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${device.src === 'adafruit' ? 'border-emerald-900 text-emerald-400' : 'border-slate-700 text-slate-400'}`}>
          {device.src === 'adafruit' ? 'address: Adafruit list' : 'address: datasheet'}
        </span>
      </div>
      <div className="text-xs text-gray-300">{device.func}</div>
      <div className="text-xs font-mono text-cyan-300">Address{device.addr.length > 1 ? 'es' : ''}: {addrText}</div>
      {device.alt && <div className="text-[11px] text-slate-400">Alternate: {device.alt}</div>}
      {device.idCheck ? (
        <div className="text-[11px] text-emerald-300 font-mono">
          ID check: read {formatAddress(device.idCheck.reg)} and expect {formatValue(device.idCheck.expect, device.idCheck.width)}
          {device.idCheck.note ? ` (${device.idCheck.note})` : ''}
        </div>
      ) : (
        <div className="text-[11px] text-slate-500">No simple ID register in this database.</div>
      )}
      {device.note && <div className="text-[11px] text-amber-300">{device.note}</div>}
    </div>
  );
}

function MapTab() {
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    const out = new Array(128).fill(0);
    for (let a = 0; a < 128; a++) out[a] = devicesAtAddress(a).length;
    return out;
  }, []);
  const results = useMemo(() => searchDevices(query), [query]);
  const selectedDevices = selected === null ? [] : devicesAtAddress(selected);
  const reserved = selected === null ? null : reservedMeaning(selected);

  return (
    <div className="grid gap-2 @3xl:grid-cols-[auto_1fr]">
      <div>
        <AddressGrid selected={selected} onSelect={setSelected} counts={counts} />
        <div className={`${cardCls} mt-2 min-h-[4rem]`}>
          {selected === null && <div className="text-xs text-slate-500">Click an address to see the parts that use it.</div>}
          {selected !== null && (
            <>
              <div className="text-sm font-mono text-cyan-300">
                {formatAddress(selected)} (7-bit) &middot; write {formatAddress(toWriteByte(selected))} &middot; read {formatAddress(toReadByte(selected))}
              </div>
              {reserved && (
                <div className="mt-1 text-xs text-amber-300 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {reserved}
                </div>
              )}
              {!reserved && selectedDevices.length === 0 && (
                <div className="mt-1 text-xs text-slate-500">No part in this database uses this address.</div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="min-w-0 space-y-2">
        {selected !== null && !reserved && selectedDevices.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs text-slate-400">Parts that use {formatAddress(selected)}:</div>
            {selectedDevices.map((d) => <DeviceCard key={d.id} device={d} />)}
          </div>
        )}
        <div>
          <label htmlFor="i2c-part-search" className="text-[11px] text-slate-500 block mb-1">Search parts by name, function, manufacturer, category or address (e.g. "temperature", "0x3c")</label>
          <div className="relative">
            <Search size={14} className="absolute left-2 top-2.5 text-slate-600" />
            <input
              id="i2c-part-search"
              className={`${inputCls} w-full pl-7`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="BME280, OLED, 0x68, magnetometer ..."
            />
          </div>
          <div className="text-[10px] text-slate-600 mt-1">{results.length} of {I2C_DEVICES.length} parts</div>
        </div>
        <div className="max-h-[24rem] overflow-auto border border-slate-800 rounded">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-900 text-slate-400">
              <tr className="text-left">
                <th className="px-2 py-1 font-normal">Part</th>
                <th className="px-2 py-1 font-normal">Address(es)</th>
                <th className="px-2 py-1 font-normal">Category</th>
                <th className="px-2 py-1 font-normal">ID check</th>
              </tr>
            </thead>
            <tbody>
              {results.map((d) => (
                <tr key={d.id} className="border-t border-slate-900 align-top hover:bg-slate-900/60">
                  <td className="px-2 py-1 text-gray-200">
                    <button type="button" className="text-left hover:text-cyan-300" onClick={() => setSelected(d.addr[0])}>{d.part}</button>
                    <div className="text-[10px] text-slate-500">{d.mfr}</div>
                  </td>
                  <td className="px-2 py-1 font-mono text-cyan-300">
                    {d.addr.length > 6 ? `${formatAddress(d.addr[0])} to ${formatAddress(d.addr[d.addr.length - 1])}` : d.addr.map(formatAddress).join(', ')}
                  </td>
                  <td className="px-2 py-1 text-slate-400">{d.category}</td>
                  <td className="px-2 py-1 font-mono text-emerald-300">{d.idCheck ? `${formatAddress(d.idCheck.reg)} = ${formatValue(d.idCheck.expect, d.idCheck.width)}` : '-'}</td>
                </tr>
              ))}
              {results.length === 0 && (
                <tr><td colSpan={4} className="px-2 py-3 text-slate-500">No match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="text-[10px] text-slate-600">Categories: {I2C_CATEGORIES.join(' · ')}</div>
      </div>
    </div>
  );
}

function FreeAddresses({ found }) {
  const free = useMemo(() => freeAddresses(found), [found]);
  return (
    <details className="text-[11px] text-slate-400">
      <summary className="cursor-pointer text-slate-300">Free addresses on this bus ({free.length})</summary>
      <div className="mt-1 font-mono text-[10px] text-cyan-300/80 leading-relaxed break-words">{free.map(formatAddress).join(' ')}</div>
      <div className="mt-1 text-slate-500">Usable 7-bit addresses (0x08 to 0x77) that did not answer in the pasted scan. A device that is powered off or not wired will not show up, so this is only a guide.</div>
    </details>
  );
}

const SCAN_PLACEHOLDER = `Paste any of these:
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:          -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- 28 -- -- -- -- -- -- --
70: -- -- -- -- -- -- -- 77

I2C device found at address 0x3C  !
I2C device found at address 0x68  !

0x3C, 0x68, 0x77`;

function ScanTab() {
  const [text, setText] = useState('');
  const [result, setResult] = useState(null);

  const analyze = () => {
    const parsed = parseScanText(text);
    setResult({
      format: parsed.format,
      invalid: parsed.invalid || [],
      errors: parsed.errors || [],
      rows: parsed.rows,
      analysis: analyzeScan(parsed.found),
    });
  };

  const exportText = () => {
    if (!result) return;
    const lines = result.analysis.map((a) => {
      const names = a.candidates.map((c) => c.part).join(' | ') || 'not in database';
      return `${a.hex}\t${names}\t${a.suggestion}`;
    });
    copyText(lines.join('\n'));
  };

  return (
    <div className="grid gap-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-2">
        <label htmlFor="i2c-scan-input" className="text-xs text-slate-400 block">Scan output</label>
        <textarea
          id="i2c-scan-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={SCAN_PLACEHOLDER}
          spellCheck={false}
          className={`${inputCls} w-full h-48 resize-y text-[11px] leading-snug`}
        />
        <div className="flex gap-2">
          <button type="button" className={`${btnCls} text-cyan-300 border-cyan-900`} onClick={analyze} disabled={!text.trim()}>Analyze</button>
          <button type="button" className={btnCls} onClick={() => { setText(''); setResult(null); }}>Clear</button>
          <button type="button" className={btnCls} onClick={exportText} disabled={!result || result.analysis.length === 0}>
            <span className="inline-flex items-center gap-1"><Copy size={11} /> Copy table</span>
          </button>
        </div>
        <div className="text-[11px] text-slate-500 leading-relaxed">
          Accepted: i2cdetect grids (Linux i2c-tools, including the blank cells), Arduino
          "I2C device found at address 0x..." output, or a plain list of hex addresses.
          Nothing is read from a bus here; the result is only what you paste.
        </div>
      </div>

      <div className="space-y-2 min-w-0">
        {!result && <div className={`${cardCls} text-xs text-slate-500`}>Analyze a scan to list candidate parts for each address.</div>}
        {result && (
          <>
            <div className="text-xs text-slate-400">
              Format: <span className="font-mono text-gray-200">{result.format}</span>
              {' '}&middot; {result.analysis.length} address{result.analysis.length === 1 ? '' : 'es'} found
            </div>
            {result.analysis.length === 0 && (
              <div className={`${cardCls} text-xs text-slate-400`}>No addresses found in the pasted text.</div>
            )}
            {result.invalid.length > 0 && (
              <div className="text-xs text-amber-300">Ignored tokens (not 7-bit hex addresses): {result.invalid.join(', ')}</div>
            )}
            {result.errors.length > 0 && (
              <div className="text-xs text-amber-300">Scanner reported errors at: {result.errors.map((e) => formatAddress(e)).join(', ')}</div>
            )}
            <div className="space-y-2 max-h-[30rem] overflow-auto pr-1">
              {result.analysis.map((a) => (
                <div key={a.address} className={cardCls}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-cyan-300 text-sm">{a.hex}</span>
                    <span className="flex gap-1">
                      {a.inUse && <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-900 text-amber-300">in use by a driver</span>}
                      {a.reserved && <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-900 text-amber-300">reserved</span>}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-gray-200">
                    {a.candidates.length > 0 ? a.candidates.map((c) => c.part).join(' / ') : 'No part in this database'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400 flex items-start gap-1.5">
                    <Info size={11} className="mt-0.5 shrink-0 text-slate-500" /> {a.suggestion}
                  </div>
                  {a.idChecks.length > 0 && (
                    <ul className="mt-2 space-y-0.5 text-[11px] font-mono text-emerald-300">
                      {a.idChecks.map((c) => (
                        <li key={c.id}>
                          {c.part}: read {c.regHex}, expect {formatValue(c.expect, c.width)}{c.note ? ` (${c.note})` : ''}
                        </li>
                      ))}
                    </ul>
                  )}
                  {a.unverifiable.length > 0 && a.idChecks.length > 0 && (
                    <div className="mt-1 text-[10px] text-slate-500">No ID check in the database for: {a.unverifiable.join(', ')}</div>
                  )}
                </div>
              ))}
            </div>
            <FreeAddresses found={result.analysis.map((a) => a.address)} />
            {result.analysis.some((a) => a.idChecks.length > 0) && (
              <div className="text-[11px] text-slate-500 leading-relaxed">
                To confirm a part, read its ID register on the real bus with the <span className="text-slate-300">I2C &amp; SPI Bus Explorer</span> tool
                (the register listed above at that address), then compare the value with the expected one.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// Hex byte 0x00 to 0xFF (optionally 0x-prefixed or $-prefixed), or null.
function parseByteInput(text) {
  const s = String(text || '').trim().replace(/^\$/, '').replace(/^0x/i, '');
  if (!/^[0-9a-f]{1,2}$/i.test(s)) return null;
  return parseInt(s, 16);
}

function ConvertTab() {
  const [addrText, setAddrText] = useState('0x3C');
  const [byteText, setByteText] = useState('0x78');
  const addr = parseAddressInput(addrText);
  const byteVal = parseByteInput(byteText);
  const fromByte = byteVal === null ? null : fromEightBitByte(byteVal);

  return (
    <div className="grid gap-2 @xl:grid-cols-2">
      <div className={`${cardCls} space-y-2`}>
        <div className="text-xs text-slate-400 flex items-center gap-1.5"><ArrowLeftRight size={12} /> 7-bit address to bus bytes</div>
        <input className={`${inputCls} w-full`} value={addrText} onChange={(e) => setAddrText(e.target.value)} aria-label="7-bit address" />
        {addr === null ? (
          <div className="text-xs text-red-300">Enter a 7-bit address from 0x00 to 0x7F (hex).</div>
        ) : (
          <div className="text-xs font-mono space-y-1 text-gray-200">
            <div>7-bit: {formatAddress(addr)} (decimal {addr}, binary {addr.toString(2).padStart(7, '0')})</div>
            <div>Write byte: {formatAddress(toWriteByte(addr))} (address &lt;&lt; 1, R/W = 0)</div>
            <div>Read byte: {formatAddress(toReadByte(addr))} (address &lt;&lt; 1 | 1, R/W = 1)</div>
            {reservedMeaning(addr) && <div className="text-amber-300">{reservedMeaning(addr)}</div>}
          </div>
        )}
      </div>

      <div className={`${cardCls} space-y-2`}>
        <div className="text-xs text-slate-400 flex items-center gap-1.5"><ArrowLeftRight size={12} /> 8-bit bus byte to 7-bit address</div>
        <input className={`${inputCls} w-full`} value={byteText} onChange={(e) => setByteText(e.target.value)} aria-label="8-bit byte" />
        {!fromByte ? (
          <div className="text-xs text-red-300">Enter one byte from 0x00 to 0xFF (hex).</div>
        ) : (
          <div className="text-xs font-mono space-y-1 text-gray-200">
            <div>7-bit: {formatAddress(fromByte.address7)} (decimal {fromByte.address7})</div>
            <div>Operation: {fromByte.rw === 'read' ? 'read (LSB 1)' : 'write (LSB 0)'}</div>
          </div>
        )}
        <div className="text-[11px] text-slate-500">
          Datasheets often list the 8-bit write address (for example 0x78 for an SSD1306). The 7-bit address used in code and in i2cdetect is that value shifted right by one.
        </div>
      </div>
    </div>
  );
}

function PlanCard({ picked }) {
  const single = useMemo(() => assignSingleBus(picked), [picked]);
  const multi = useMemo(() => (single.ok ? null : planBuses(picked)), [single, picked]);
  if (picked.length < 2) return null;
  const muxes = multi ? muxOptions(multi.busCount) : [];
  return (
    <div className={`${cardCls} space-y-1.5`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-200 font-semibold">Suggested addressing</span>
        <button type="button" className={btnCls} onClick={() => copyText(planToText(single, multi))} title="Copy the plan as tab-separated text">
          <span className="inline-flex items-center gap-1"><Copy size={11} /> Copy</span>
        </button>
      </div>
      {single.ok ? (
        <>
          <div className="text-[11px] text-emerald-300">All selected parts fit on one bus if you set their address pins or jumpers as below.</div>
          <ul className="text-[11px] font-mono space-y-0.5">
            {single.assignment.map((a) => <li key={a.id}><span className="text-cyan-300">{a.hex}</span> <span className="text-gray-300">{a.part}</span></li>)}
          </ul>
        </>
      ) : (
        <>
          <div className="text-[11px] text-amber-300">
            No single-bus assignment exists with these parts. Split them over {multi.busCount} buses (for example I2C multiplexer channels, or separate I2C ports).
          </div>
          {multi.buses.map((bus, i) => (
            <div key={i} className="text-[11px] font-mono">
              <div className="text-slate-400">Bus / channel {i}</div>
              {bus.map((a) => <div key={a.id} className="pl-2"><span className="text-cyan-300">{a.hex}</span> <span className="text-gray-300">{a.part}</span></div>)}
            </div>
          ))}
          <div className="text-[10px] text-slate-500">
            Greedy split: the bus count is small but not guaranteed minimal.{' '}
            {muxes.length > 0 ? `Multiplexers in the database with enough channels: ${muxes.map((m) => `${m.part} (${m.channels})`).join(', ')}.` : 'More buses than one database multiplexer offers; use several multiplexers or ports.'}
          </div>
        </>
      )}
    </div>
  );
}

function ConflictsTab() {
  const [picked, setPicked] = useState([]);
  const [filter, setFilter] = useState('');
  const list = useMemo(() => searchDevices(filter), [filter]);
  const report = useMemo(() => checkConflicts(picked), [picked]);

  const toggle = (id) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="grid gap-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-2 min-w-0">
        <div className="text-xs text-slate-400 flex items-center gap-1.5"><Layers size={12} /> Pick the parts you plan to put on one bus</div>
        <input className={`${inputCls} w-full`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter parts" aria-label="filter parts" />
        <div className="max-h-72 overflow-auto border border-slate-800 rounded">
          {list.map((d) => (
            <label key={d.id} className="flex items-start gap-2 px-2 py-1 border-b border-slate-900 last:border-0 text-xs hover:bg-slate-900/60 cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={picked.includes(d.id)} onChange={() => toggle(d.id)} />
              <span className="min-w-0">
                <span className="text-gray-200">{d.part}</span>
                <span className="block text-[10px] font-mono text-cyan-400/80">{d.addr.map(formatAddress).join(', ')}</span>
              </span>
            </label>
          ))}
          {list.length === 0 && <div className="px-2 py-3 text-xs text-slate-500">No match.</div>}
        </div>
        {picked.length > 0 && <button type="button" className={btnCls} onClick={() => setPicked([])}>Clear selection ({picked.length})</button>}
      </div>

      <div className="space-y-2 min-w-0">
        {picked.length === 0 && <div className={`${cardCls} text-xs text-slate-500`}>Select two or more parts to check them for shared addresses.</div>}
        {picked.length > 0 && (
          <>
            {report.clean ? (
              <div className="text-xs text-emerald-300 flex items-center gap-1.5"><Check size={12} /> No address conflicts among the {report.chosen.length} selected part(s).</div>
            ) : (
              <div className="text-xs text-red-300 flex items-center gap-1.5"><AlertTriangle size={12} /> {report.conflicts.length} address conflict{report.conflicts.length === 1 ? '' : 's'}</div>
            )}
            {report.conflicts.map((c) => (
              <div key={c.address} className={cardCls}>
                <div className="font-mono text-sm text-red-300">{c.hex}</div>
                <ul className="mt-1 space-y-1 text-xs">
                  {c.devices.map((d) => (
                    <li key={d.id} className="text-gray-300">
                      {d.part}
                      {d.adjustable ? (
                        <span className="text-slate-400">
                          {' '}- has alternates{d.freeAlternatives.length ? `; free to move to ${d.freeAlternatives.join(', ')}` : '; no free alternate among the selected parts'}
                        </span>
                      ) : (
                        <span className="text-amber-300"> - fixed address, cannot be moved</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <PlanCard picked={picked} />
            <div className="text-[11px] text-slate-500 leading-relaxed">
              Based only on the addresses in this database. Check the actual part (solder jumpers, address pins, firmware settings) before you wire it.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function I2cAddressRefWorkbench() {
  const [tab, setTab] = useState('map');

  return (
    <div className="text-gray-200 space-y-2 font-sans">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[11px] text-slate-500">
          I2C Address Reference &middot; {I2C_DEVICES.length} parts (Adafruit list and datasheets). This tool does not talk to any bus.
        </div>
        <div className="flex gap-1 flex-wrap" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`px-2 py-0.5 text-[11px] rounded border ${tab === id ? 'border-cyan-600 text-cyan-300 bg-cyan-950/30' : 'border-slate-800 text-slate-400 hover:text-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'map' && <MapTab />}
      {tab === 'scan' && <ScanTab />}
      {tab === 'convert' && <ConvertTab />}
      {tab === 'conflicts' && <ConflictsTab />}
    </div>
  );
}
