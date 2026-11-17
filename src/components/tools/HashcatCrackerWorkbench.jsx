import React, { useState, useRef, useMemo } from 'react';
import { Play, Square, Download, Zap, KeyRound, Cpu } from 'lucide-react';
import WordlistPicker from './common/WordlistPicker';
import { HASH_MODES, RULE_SETS, hashOne, parseTargets, maskPassword, expandRules, ruleMultiplier, parseMask, maskKeyspace, maskCandidates } from '../../utils/hashCrack';
import { gpuAvailable, GpuMd5Cracker } from '../../utils/gpuCrack';

/**
 * Hash cracker (password-audit / CTF), hashcat-style but fully client-side.
 *  - Hash modes: MD5, SHA-1/256/384/512, NTLM, md5(md5), MySQL4.1+, and salted
 *    md5/sha1/sha256 variants (with hashcat mode numbers).
 *  - Attack modes: dictionary (-a 0), dictionary + rules, and mask / brute-force
 *    (-a 3, e.g. ?l?l?l?d).
 *  - Cracks one or many target hashes at once into a potfile-style table, with
 *    live H/s, candidates tried, elapsed and ETA. Nothing leaves the browser.
 */
export default function HashcatCrackerWorkbench({ onLogMessage }) {
  const [modeId, setModeId] = useState('md5');
  const [attack, setAttack] = useState('dict'); // dict | rules | mask
  const [salt, setSalt] = useState('');
  const [targetsText, setTargetsText] = useState('');
  const [wordlist, setWordlist] = useState('');
  const [ruleSet, setRuleSet] = useState('none');
  const [mask, setMask] = useState('?l?l?l?l');
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ tried: 0, rate: 0, elapsed: 0, total: 0, found: 0 });
  const [pot, setPot] = useState([]); // [{ hash, password|null }]
  const [targetError, setTargetError] = useState('');
  const [useGpu, setUseGpu] = useState(false);
  const [gpuNote, setGpuNote] = useState('');
  const cancelRef = useRef(false);
  const gpuRef = useRef(null);

  const log = (m) => onLogMessage?.(m);
  const mode = HASH_MODES.find((m) => m.id === modeId);
  const gpuEligible = gpuAvailable() && modeId === 'md5' && attack === 'mask';

  const words = useMemo(() => wordlist.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean), [wordlist]);
  const maskSets = useMemo(() => parseMask(mask), [mask]);
  const maskSpace = useMemo(() => maskKeyspace(maskSets), [maskSets]);

  const estTotal = useMemo(() => {
    if (attack === 'dict') return words.length;
    if (attack === 'rules') return words.length * ruleMultiplier(ruleSet);
    return maskSpace;
  }, [attack, words.length, ruleSet, maskSpace]);

  // Build the candidate generator for the chosen attack.
  function* candidateGen() {
    if (attack === 'mask') { yield* maskCandidates(maskSets); return; }
    for (const w of words) {
      if (attack === 'rules') { for (const c of expandRules(w, ruleSet)) yield c; }
      else yield w;
    }
  }

  const start = async () => {
    const { targets: parsed, errors: badLines } = parseTargets(targetsText, modeId, salt);
    if (badLines.length) {
      const first = badLines[0];
      setTargetError(`Line ${first.line}: ${first.error}${badLines.length > 1 ? ` (+${badLines.length - 1} more problem line(s))` : ''}`);
      log(`Target hashes rejected: ${badLines.length} problem line(s)`);
      return;
    }
    setTargetError('');
    if (parsed.length === 0) { log('Enter at least one target hash'); return; }
    const targets = parsed.map((t) => t.hash);
    const keyOf = (t) => `${t.salt}\u0000${t.hash}`;
    if (attack !== 'mask' && words.length === 0) { log('Load a wordlist first'); return; }
    if (attack === 'mask' && maskSpace === 0) { log('Invalid mask'); return; }

    setRunning(true); cancelRef.current = false;
    // Group targets by salt so each candidate is hashed once per distinct salt (once overall for unsalted modes).
    const bySalt = new Map();
    for (const t of parsed) { if (!bySalt.has(t.salt)) bySalt.set(t.salt, new Set()); bySalt.get(t.salt).add(t.hash); }
    const found = new Map();
    let remainingCount = parsed.length;
    setPot(parsed.map((t) => ({ hash: t.hash, salt: t.salt, password: null })));
    setStats({ tried: 0, rate: 0, elapsed: 0, total: estTotal, found: 0 });

    // --- GPU (WebGPU) path: MD5 + mask only, self-tested before trusting ---
    if (useGpu && gpuEligible) {
      try {
        if (!gpuRef.current) { const g = new GpuMd5Cracker(); await g.init(); const ok = await g.selfTest(); if (!ok) throw new Error('self-test mismatch'); gpuRef.current = g; log(`WebGPU engine verified (${g.adapterInfo?.vendor || 'gpu'} ${g.adapterInfo?.architecture || ''})`); }
        setGpuNote('Running on GPU (WebGPU).');
        const t0 = performance.now();
        await gpuRef.current.crackMask(maskSets, targets, {
          shouldStop: () => cancelRef.current,
          onFound: (hit) => { found.set(hit.hex, hit.password); setPot((prev) => prev.map((row) => (row.hash === hit.hex ? { ...row, password: hit.password } : row))); log(`Cracked ${hit.hex.slice(0, 16)}… ${maskPassword(hit.password)} (GPU)`); },
          onProgress: (done, total) => { const el = (performance.now() - t0) / 1000; setStats({ tried: done, rate: Math.round(done / Math.max(el, 0.001)), elapsed: Math.round(el * 10) / 10, total, found: found.size }); },
        });
        log(cancelRef.current ? `Stopped — ${found.size}/${targets.length} cracked (GPU)` : `Done — ${found.size}/${targets.length} cracked (GPU)`);
        setRunning(false);
        return;
      } catch (e) {
        setGpuNote(`GPU unavailable (${e.message}). Falling back to CPU.`);
        log(`GPU path failed: ${e.message} — using CPU`);
      }
    }

    log(`Cracking ${targets.length} ${mode.label} hash(es), attack=${attack}${attack === 'rules' ? `(${ruleSet})` : ''}${attack === 'mask' ? ` mask of ${maskSets.length} position(s) (${maskSpace.toLocaleString()} candidates)` : ''}…`);

    const t0 = performance.now();
    let tried = 0;
    const flush = () => {
      const elapsed = (performance.now() - t0) / 1000;
      setStats({ tried, rate: Math.round(tried / Math.max(elapsed, 0.001)), elapsed: Math.round(elapsed * 10) / 10, total: estTotal, found: found.size });
    };

    for (const cand of candidateGen()) {
      if (cancelRef.current) { log(`Stopped after ${tried} candidate(s) — ${found.size} cracked`); break; }
      tried++;
      for (const [sl, hashes] of bySalt) {
        const h = await hashOne(modeId, cand, sl);
        const key = `${sl}\u0000${h}`;
        if (hashes.has(h) && !found.has(key)) {
          found.set(key, cand);
          remainingCount--;
          setPot((prev) => prev.map((row) => (keyOf(row) === key ? { ...row, password: cand } : row)));
          // The plaintext stays in the pot table / potfile only; the exportable session log gets a masked form.
          log(`Cracked ${h.slice(0, 16)}… ${maskPassword(cand)}`);
        }
      }
      if (remainingCount === 0) { flush(); break; }
      if (tried % 400 === 0) { flush(); await new Promise((r) => setTimeout(r, 0)); }
    }
    flush();
    if (!cancelRef.current) log(`Done — ${found.size}/${targets.length} cracked in ${tried} candidate(s)`);
    setRunning(false);
  };

  const pct = stats.total ? Math.min(100, Math.round((stats.tried / stats.total) * 100)) : 0;
  const eta = stats.rate && stats.total > stats.tried ? Math.round((stats.total - stats.tried) / stats.rate) : 0;
  const crackedRows = pot.filter((r) => r.password !== null);

  const exportPot = () => {
    const txt = pot.map((r) => `${r.hash}:${r.salt ? `${r.salt}:` : ''}${r.password ?? ''}`).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'cracked.potfile'; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="p-4 text-gray-200">
      <p className="text-xs text-gray-400 mb-3">
        Client-side password-audit / CTF hash cracker. Dictionary, rule-based and mask attacks against one or many hashes.
        Everything runs in your browser — nothing is uploaded.
      </p>

      <div className="flex flex-wrap gap-3 mb-3 items-end">
        <label className="text-xs text-slate-400">Hash mode
          <select value={modeId} onChange={(e) => setModeId(e.target.value)} className="block mt-1 bg-slate-900 border border-slate-800 rounded p-1.5 text-sm text-gray-200 font-mono">
            {HASH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label} · -m {m.code}</option>)}
          </select>
        </label>
        {mode.salt && (
          <label className="text-xs text-slate-400">Salt
            <input value={salt} onChange={(e) => setSalt(e.target.value)} className="block mt-1 w-40 bg-slate-900 border border-slate-800 rounded p-1.5 text-sm font-mono" placeholder="shared salt (if no hash:salt)" />
          </label>
        )}
        <div className="flex rounded overflow-hidden border border-slate-800 text-xs">
          {[['dict', 'Dictionary'], ['rules', 'Dictionary + rules'], ['mask', 'Mask / brute-force']].map(([id, lbl]) => (
            <button key={id} onClick={() => setAttack(id)} className={`px-3 py-1.5 ${attack === id ? 'bg-amber-900/50 text-amber-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>{lbl}</button>
          ))}
        </div>
      </div>

      <label className="block text-xs text-slate-400 mb-1">Target hash(es) — one per line{mode.salt ? ' (hash:salt per line, or use the shared Salt box)' : ''}</label>
      <textarea value={targetsText} onChange={(e) => setTargetsText(e.target.value)} rows={3} spellCheck={false} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono mb-3" placeholder={'5d41402abc4b2a76b9719d911017c592\n8846f7eaee8fb117ad06bdd830b7586c'} />
      {targetError && <div className="text-xs text-red-300 mb-3 -mt-2">{targetError}</div>}

      {attack !== 'mask' ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs text-slate-400">Wordlist (one candidate per line)</label>
            {attack === 'rules' && (
              <label className="text-xs text-slate-400">Rules
                <select value={ruleSet} onChange={(e) => setRuleSet(e.target.value)} className="ml-1 bg-slate-900 border border-slate-800 rounded p-1 text-xs text-gray-200">
                  {RULE_SETS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
            )}
          </div>
          <WordlistPicker category="passwords" max={100000} label="Password list" onLoad={(lines) => setWordlist(lines.join('\n'))} />
          <textarea value={wordlist} onChange={(e) => setWordlist(e.target.value)} rows={5} spellCheck={false} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono mt-1" />
          <div className="text-[11px] text-slate-500 mt-1">{words.length.toLocaleString()} word(s){attack === 'rules' ? ` × ~${ruleMultiplier(ruleSet)} rules ≈ ${estTotal.toLocaleString()} candidates` : ''}</div>
        </div>
      ) : (
        <div className="mb-3">
          <label className="block text-xs text-slate-400 mb-1">Mask — <span className="font-mono">?l</span> lower · <span className="font-mono">?u</span> upper · <span className="font-mono">?d</span> digit · <span className="font-mono">?s</span> symbol · <span className="font-mono">?a</span> all · literals allowed</label>
          <input value={mask} onChange={(e) => setMask(e.target.value)} className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-sm font-mono" placeholder="?l?l?l?d" />
          <div className={`text-[11px] mt-1 ${maskSpace > 5_000_000 ? 'text-red-400' : maskSpace > 500_000 ? 'text-amber-400' : 'text-slate-500'}`}>
            keyspace: {maskSpace.toLocaleString()} candidate(s){maskSpace > 5_000_000 ? ' — large; GPU recommended' : ''}
          </div>
          {gpuEligible && (
            <label className="flex items-center gap-1.5 text-xs text-gray-300 mt-2">
              <input type="checkbox" checked={useGpu} onChange={(e) => { setUseGpu(e.target.checked); setGpuNote(''); }} />
              <Cpu size={13} className="text-emerald-400" /> Use GPU (WebGPU) — MD5 mask only; verified on-device before use
            </label>
          )}
          {!gpuEligible && gpuAvailable() && <div className="text-[10px] text-slate-500 mt-1">GPU acceleration is available for MD5 + mask attacks.</div>}
          {gpuNote && <div className="text-[11px] text-emerald-400 mt-1">{gpuNote}</div>}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        {!running
          ? <button onClick={start} className="px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-500 inline-flex items-center gap-1"><Play size={14} /> Crack</button>
          : <button onClick={() => { cancelRef.current = true; }} className="px-3 py-1.5 bg-slate-700 text-gray-200 rounded hover:bg-slate-600 inline-flex items-center gap-1"><Square size={14} /> Stop</button>}
        {pot.length > 0 && <button onClick={exportPot} className="px-3 py-1.5 bg-slate-800 border border-slate-700 text-gray-200 rounded text-xs hover:bg-slate-700 inline-flex items-center gap-1"><Download size={13} /> potfile</button>}
      </div>

      {(running || stats.tried > 0) && (
        <div className="mb-3">
          <div className="flex items-center gap-4 text-xs text-slate-400 flex-wrap mb-1 font-mono">
            <span className="inline-flex items-center gap-1"><Zap size={12} className="text-amber-400" /> {stats.rate.toLocaleString()} H/s</span>
            <span>{stats.tried.toLocaleString()} / {stats.total.toLocaleString()} tried</span>
            <span>{stats.elapsed}s elapsed</span>
            {running && eta > 0 && <span>ETA ~{eta}s</span>}
            <span className="inline-flex items-center gap-1 text-emerald-400"><KeyRound size={12} /> {stats.found} cracked</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded overflow-hidden"><div className="h-full bg-amber-500" style={{ width: `${pct}%` }} /></div>
        </div>
      )}

      {pot.length > 0 && (
        <div className="border border-slate-800 rounded bg-slate-950 overflow-auto max-h-[40vh]">
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="sticky top-0 bg-slate-900"><tr className="text-left"><th className="px-2 py-1">Hash</th><th className="px-2 py-1">Password</th></tr></thead>
            <tbody>
              {pot.map((r, i) => (
                <tr key={i} className="border-b border-slate-900 last:border-0">
                  <td className="px-2 py-1 text-slate-400 break-all">{r.hash}{r.salt ? `:${r.salt}` : ''}</td>
                  <td className={`px-2 py-1 ${r.password !== null ? 'text-emerald-400' : 'text-slate-600'}`}>{r.password !== null ? r.password : (running ? '…' : 'not cracked')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!running && pot.length > 0 && <div className="text-xs text-slate-500 mt-2">{crackedRows.length}/{pot.length} cracked.</div>}
    </div>
  );
}
