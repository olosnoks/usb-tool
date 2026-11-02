import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Flame, ChevronLeft, ChevronRight, Terminal } from 'lucide-react';
import DeviceScreen from './DeviceScreen';
import { flashFromManifest, isWebSerialSupported } from './warhogFlash';

const FW_NOTE = {
  fork: "Flashing skon's fork — built from olosnoks/warhog.",
  ham: 'Flashing the official firmware — Hamspiced/piglet latest release.'
};

// Inline flash-progress block (percentage, stage, bar, detail) shown under the
// Install button, mirroring the web flasher's c5prog block in the suite's theme.
function FlashProgress({ st }) {
  if (!st) return null;
  const barColor = st.kind === 'ok' ? 'bg-emerald-400' : st.kind === 'err' ? 'bg-rose-500' : 'bg-amber-500';
  const stageColor = st.kind === 'ok' ? 'text-emerald-400' : st.kind === 'err' ? 'text-rose-400' : 'text-slate-200';
  const showPct = st.pct != null && !st.busy;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-2.5 space-y-1.5" role="status" aria-live="polite">
      <div className="flex items-baseline gap-2 flex-wrap">
        {showPct && <span className="text-xl font-bold tabular-nums text-slate-100 leading-none">{Math.round(st.pct)}%</span>}
        <span className={`text-xs font-bold ${stageColor}`}>{st.stage}</span>
      </div>
      <div className="h-2 rounded-full bg-slate-900 border border-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} ${st.busy ? 'w-1/3 animate-pulse' : 'transition-all duration-200'}`}
          style={st.busy ? undefined : { width: `${st.pct == null ? 0 : Math.max(0, Math.min(100, st.pct))}%` }}
        />
      </div>
      {st.sub && <p className={`text-[11px] break-words ${st.kind === 'err' ? 'text-rose-300' : 'text-slate-500'}`}>{st.sub}</p>}
    </div>
  );
}

// One board card. Holds its own fork/official firmware-source state when the
// board ships both (data-fw-dual in the web flasher), plus its flash progress.
function BoardCard({ preset: p, flasherUrl, isSelected, innerRef }) {
  const [source, setSource] = useState('fork');
  const [flashSt, setFlashSt] = useState(null);
  const [flashing, setFlashing] = useState(false);
  const fw = p.firmware ? p.firmware[source] : null;
  const manifest = fw ? fw.manifest : p.manifest;
  const bin = fw ? fw.bin : p.bin;
  const webSerial = isWebSerialSupported();

  const handleInstall = async () => {
    if (flashing) return;
    setFlashing(true);
    try {
      await flashFromManifest({
        manifestUrl: `${flasherUrl}manifests/${manifest}`,
        expectChip: p.chipFamily,
        report: (st) => setFlashSt(st)
      });
    } catch (err) {
      const m = (err && err.message) ? err.message : String(err);
      const portBusy = /failed to open|already open|in use/i.test(m);
      const hint = portBusy
        ? 'The port is in use: close other serial apps or flasher tabs, unplug and replug the board, then retry.'
        : 'If the board didn’t enter download mode, hold BOOT, tap RESET, release BOOT, and click Install again.';
      setFlashSt({ stage: 'Failed', kind: 'err', sub: `${m}. ${hint}` });
    } finally {
      setFlashing(false);
    }
  };

  return (
    <div
      ref={innerRef}
      className={`shrink-0 w-[272px] @sm:w-[300px] snap-start bg-slate-950 border rounded-xl p-3.5 flex flex-col gap-2.5 transition-all ${
        isSelected
          ? 'border-amber-500/70 shadow-[0_0_0_1px_rgba(245,158,11,0.35)]'
          : 'border-slate-800'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-bold text-sm text-slate-100 leading-tight">
          {p.label.replace(/^[^\w]+\s*/, '').split('—')[0].trim()}
        </h2>
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-300 shrink-0">
          {p.chipFamily}
        </span>
      </div>

      {p.screen && <DeviceScreen kind={p.screen} />}

      <p className="text-[12px] text-slate-400 flex-1 leading-snug">{p.description}</p>

      {/* fork / official firmware toggle (dual-source boards only) */}
      {p.firmware && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Firmware</span>
            <div className="inline-flex rounded-lg border border-slate-800 overflow-hidden">
              {['fork', 'ham'].map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSource(src)}
                  className={`px-2.5 py-1 text-[11px] font-bold transition ${
                    source === src
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-transparent text-slate-400 hover:text-slate-200'
                  } ${src === 'ham' ? 'border-l border-slate-800' : ''}`}
                >
                  {p.firmware[src].label}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">{FW_NOTE[source]}</p>
        </div>
      )}

      <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
        {manifest ? (
          <>
            {webSerial ? (
              <button
                type="button"
                onClick={handleInstall}
                disabled={flashing}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed text-slate-950 font-bold text-xs transition"
              >
                <Flame className={`w-3.5 h-3.5 ${flashing ? 'animate-pulse' : ''}`} />
                <span>{flashing ? 'Installing…' : 'Install — flash in browser'}</span>
              </button>
            ) : (
              <a
                href={flasherUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition"
                title="Web Serial isn’t available here — opens the hosted flasher"
              >
                <Flame className="w-3.5 h-3.5" />
                <span>Open the web flasher</span>
              </a>
            )}

            <FlashProgress st={flashSt} />

            <div className="flex items-center justify-center gap-3 text-[10px] font-mono text-slate-500">
              {bin && (
                <a
                  href={`${flasherUrl}firmware/${bin}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-slate-300"
                >
                  download .bin
                </a>
              )}
              <a
                href={`${flasherUrl}manifests/${manifest}`}
                target="_blank"
                rel="noreferrer"
                className="hover:text-slate-300"
              >
                manifest
              </a>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500 text-center py-1.5">
            <Terminal className="w-3 h-3" />
            <span>Not in the web flasher — build it with PlatformIO.</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Board carousel ported from the WarHog web flasher (olosnoks/warhog web-flasher/index.html).
 *
 * Every build stays visible in a sideways-scrolling row. The dropdown scrolls the
 * chosen board into view and highlights it; scrolling by hand (or the arrow buttons)
 * highlights the nearest card and syncs the dropdown back.
 *
 * Driven by the suite's own HARDWARE_PRESETS, so the "Flash in browser" / manifest
 * links keep pointing at the hosted flasher exactly as the old grid did.
 */
export default function WarhogBoardCarousel({ presets, flasherUrl }) {
  const entries = Object.entries(presets);
  const rowRef = useRef(null);
  const boardRefs = useRef([]);
  const [selected, setSelected] = useState(0);
  const scrollTimer = useRef(null);

  // Scroll a board into view and mark it selected.
  const goTo = useCallback((index, smooth = true) => {
    const row = rowRef.current;
    const board = boardRefs.current[index];
    if (!row || !board) return;
    setSelected(index);
    row.scrollTo({
      left: board.offsetLeft - row.offsetLeft - 8,
      behavior: smooth ? 'smooth' : 'auto'
    });
  }, []);

  // Manual scroll: highlight the card nearest the row's viewport centre and sync the dropdown.
  const handleScroll = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const centre = row.scrollLeft + row.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      boardRefs.current.forEach((b, k) => {
        if (!b) return;
        const mid = b.offsetLeft - row.offsetLeft + b.offsetWidth / 2;
        const dist = Math.abs(mid - centre);
        if (dist < bestDist) {
          bestDist = dist;
          best = k;
        }
      });
      setSelected(best);
    }, 140);
  }, []);

  useEffect(() => () => clearTimeout(scrollTimer.current), []);

  const step = (delta) => {
    const next = Math.min(entries.length - 1, Math.max(0, selected + delta));
    goTo(next, true);
  };

  return (
    <div>
      {/* Board picker: dropdown + prev/next arrows (mirrors .boardsBar) */}
      <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-2">
        Select your board — every build is below, scroll sideways or use the arrows
      </label>
      <div className="flex items-stretch gap-2 mb-3.5">
        <div className="relative flex-1">
          <select
            value={selected}
            onChange={(e) => goTo(Number(e.target.value), true)}
            aria-label="Select your board"
            className="w-full appearance-none bg-slate-950 border border-slate-800 rounded-lg pl-3 pr-9 py-2.5 text-sm font-bold text-slate-200 outline-none cursor-pointer focus:border-amber-500/60"
          >
            {entries.map(([key, p], idx) => (
              <option key={key} value={idx}>
                {p.label.replace(/^[^\w]+\s*/, '')}
              </option>
            ))}
          </select>
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-400 pointer-events-none text-xs">▾</span>
        </div>
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={selected <= 0}
          aria-label="Previous board"
          className="w-10 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40 disabled:hover:border-slate-800 disabled:hover:text-slate-300 transition"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          disabled={selected >= entries.length - 1}
          aria-label="Next board"
          className="w-10 flex items-center justify-center rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-40 disabled:hover:border-slate-800 disabled:hover:text-slate-300 transition"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Sideways-scrolling board row (mirrors .grid / .board) */}
      <div
        ref={rowRef}
        onScroll={handleScroll}
        className="flex gap-3 overflow-x-auto pb-3 pt-1 px-0.5 snap-x snap-proximity [scrollbar-width:thin]"
      >
        {entries.map(([key, p], idx) => (
          <BoardCard
            key={key}
            preset={p}
            flasherUrl={flasherUrl}
            isSelected={idx === selected}
            innerRef={(el) => (boardRefs.current[idx] = el)}
          />
        ))}
      </div>
    </div>
  );
}
