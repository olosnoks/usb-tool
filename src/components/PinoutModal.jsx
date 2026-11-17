import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, AlertTriangle, Search } from 'lucide-react';
import { PINOUT_BOARDS, getBoard, searchPins } from '../data/pinouts';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function PinoutModal({ isOpen, onClose, initialBoard }) {
  const [selectedBoard, setSelectedBoard] = useState(initialBoard || PINOUT_BOARDS[0].id);
  const [query, setQuery] = useState('');
  const dialogRef = useRef(null);
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus management: move focus into the dialog on open, return it to the opener on close.
  useEffect(() => {
    if (!isOpen) return undefined;
    openerRef.current = document.activeElement;
    const t = setTimeout(() => dialogRef.current?.focus(), 0);
    const onEsc = (e) => { if (e.key === 'Escape') onCloseRef.current?.(); };
    document.addEventListener('keydown', onEsc);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onEsc);
      const opener = openerRef.current;
      if (opener && typeof opener.focus === 'function') opener.focus();
    };
  }, [isOpen]);

  const results = useMemo(() => searchPins(query), [query]);
  const board = getBoard(selectedBoard) || PINOUT_BOARDS[0];

  if (!isOpen) return null;

  const onKeyDown = (e) => {
    if (e.key === 'Tab' && dialogRef.current) {
      const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  };

  const pickResult = (id) => { setSelectedBoard(id); setQuery(''); };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4" onKeyDown={onKeyDown}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pinout-title"
        tabIndex={-1}
        className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full p-4 space-y-3 font-mono text-xs shadow-2xl animate-in zoom-in-95 max-h-[90vh] overflow-y-auto outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyber-amber" />
            <h3 id="pinout-title" className="font-bold text-slate-100 tracking-wider">HARDWARE PINOUT & SAFETY CHEAT SHEET</h3>
          </div>
          <button onClick={onClose} aria-label="Close pinout reference" className="text-slate-400 hover:text-slate-200 text-base font-bold">&times;</button>
        </div>

        {/* Search by GPIO / pin / function */}
        <label className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1.5">
          <Search className="w-3.5 h-3.5 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a GPIO, pin or function (e.g. 21, SDA, MOSI, boot)"
            aria-label="Search pins"
            className="flex-1 bg-transparent outline-none text-slate-200 placeholder-slate-600"
          />
        </label>

        {query.trim() ? (
          <div className="bg-[#030712] p-2 rounded-lg border border-slate-800 space-y-1 max-h-72 overflow-y-auto" data-testid="pin-results">
            {results.length === 0 && <div className="text-slate-500">No pin matches "{query}".</div>}
            {results.map(({ board: b, pin }) => (
              <button
                key={`${b.id}:${pin.pin}`}
                onClick={() => pickResult(b.id)}
                className="w-full text-left px-2 py-1 rounded hover:bg-slate-800 flex gap-2"
              >
                <span className="text-slate-500 w-32 shrink-0 truncate">{b.label}</span>
                <span className="text-cyber-amber w-24 shrink-0">{pin.pin}</span>
                <span className="text-slate-300">{pin.name} - {pin.fn}</span>
              </button>
            ))}
          </div>
        ) : (
          <>
            {/* Board Tabs */}
            <div role="tablist" aria-label="Boards" className="flex flex-wrap gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
              {PINOUT_BOARDS.map((b) => (
                <button
                  key={b.id}
                  role="tab"
                  aria-selected={selectedBoard === b.id}
                  onClick={() => setSelectedBoard(b.id)}
                  className={`px-2.5 py-1 rounded font-bold transition-all ${
                    selectedBoard === b.id ? 'bg-amber-500/20 text-cyber-amber border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <div className="space-y-2.5 bg-[#030712] p-3 rounded-lg border border-slate-800" role="tabpanel">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-cyber-amber">{board.title}</span>
                {board.voltage && <span className="text-[10px] text-emerald-400">Operating: {board.voltage}</span>}
              </div>

              {board.diagram && (
                <pre className="bg-slate-950 p-2.5 rounded border border-slate-800 text-[11px] leading-relaxed overflow-x-auto">{board.diagram.join('\n')}</pre>
              )}
              {board.formula && <div className="text-[10px] text-emerald-400">Formula: {board.formula}</div>}

              {board.groups.map((g) => {
                const rows = board.pins.filter((p) => p.group === g.id);
                if (!rows.length) return null;
                return (
                  <div key={g.id} className="bg-slate-950 p-2 rounded border border-slate-800">
                    <span className="text-slate-500 block uppercase text-[9px] font-bold mb-1">{g.title}</span>
                    <table className="w-full text-[11px]">
                      <tbody>
                        {rows.map((p) => (
                          <tr key={p.pin} className="align-top">
                            <td className={`pr-2 py-0.5 whitespace-nowrap font-bold ${p.warn ? 'text-rose-400' : 'text-cyber-amber'}`}>{p.pin}</td>
                            <td className="pr-2 py-0.5 whitespace-nowrap text-cyber-cyan">{p.name}</td>
                            <td className="py-0.5 text-slate-300">{p.fn}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}

              {board.warnings.map((w) => (
                <div key={w} className="text-[10px] text-rose-400 flex items-start gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
              {board.notes.map((n) => (
                <p key={n} className="text-[10px] text-slate-400 italic">* {n}</p>
              ))}
              {board.tools.length > 0 && (
                <div className="text-[10px] text-slate-500">Related tools: {board.tools.map((t) => t.label).join(', ')}</div>
              )}
            </div>
          </>
        )}

        <button
          onClick={onClose}
          className="w-full py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold"
        >
          Close Cheat Sheet
        </button>
      </div>
    </div>
  );
}
