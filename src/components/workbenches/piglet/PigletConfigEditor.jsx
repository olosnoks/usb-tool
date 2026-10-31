import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, Save, Sliders } from 'lucide-react';
import { CFG_FIELDS, cfgReadKey, cfgSetKey, looksLikeConfig } from '../../../utils/pigletToolkit';

// Form-only wardriver.cfg editor, same rules as the web flasher's Toolkit:
//  - the file text on the card is the source of truth; each form field patches
//    its own key=value line in place, so comments and unknown keys are kept;
//  - a missing file is created on save;
//  - a file that isn't readable text is never overwritten.
export default function PigletConfigEditor({ client, connected, busy, setBusy, setStatus, log, onConfigText }) {
  const [raw, setRaw] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [valid, setValid] = useState(false);
  const [note, setNote] = useState({ text: '', bad: false });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!connected) { setRaw(''); setLoaded(false); setValid(false); setNote({ text: '', bad: false }); setDirty(false); }
  }, [connected]);

  const update = (text) => {
    setRaw(text);
    setDirty(true);
    if (onConfigText) onConfigText(text);
  };

  const loadCfg = async () => {
    setBusy(true);
    setStatus('loading wardriver.cfg…');
    try {
      let bytes;
      let missing = false;
      try { bytes = await client.cfgGet(); }
      catch (e) {
        if (!/open/i.test(e.message)) throw e;
        bytes = new Uint8Array(0);           // no file on the card yet: saving creates it
        missing = true;
      }
      const ok = looksLikeConfig(bytes);
      setValid(ok);
      setLoaded(true);
      setDirty(false);
      if (!ok) {
        setRaw('');
        setNote({
          bad: true,
          text: 'The wardriver.cfg on the card is not readable text (' + bytes.length +
            ' B of binary data), so it can’t be edited here. Saving is disabled to avoid overwriting it.'
        });
        log('CFG GET: file is not text (' + bytes.length + ' B) — editing disabled');
        setStatus('wardriver.cfg is not readable text');
        return;
      }
      const text = new TextDecoder().decode(bytes);
      setRaw(text);
      if (onConfigText) onConfigText(text);
      setNote(missing
        ? { bad: false, text: 'No wardriver.cfg on the card yet — Save will create one.' }
        : { bad: false, text: '' });
      setStatus('wardriver.cfg loaded (' + bytes.length + ' B)');
    } catch (e) {
      log('CFG GET failed: ' + e.message);
      setStatus('config load failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveCfg = async () => {
    if (!valid) { window.alert('The config on the card isn’t readable text, so saving is disabled.'); return; }
    const bytes = new TextEncoder().encode(raw);
    if (!window.confirm('Write wardriver.cfg to the SD card and reload it on the device?')) return;
    setBusy(true);
    setStatus('saving wardriver.cfg…');
    try {
      await client.cfgPut(bytes);
      setStatus('wardriver.cfg saved + reloaded (' + bytes.length + ' B)');
      log('Saved wardriver.cfg (' + bytes.length + ' B)');
      setDirty(false);
      setNote((n) => (n.bad ? n : { bad: false, text: '' }));
    } catch (e) {
      log('CFG PUT failed: ' + e.message);
      window.alert('Save failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const downloadCfg = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([raw], { type: 'text/plain;charset=utf-8' }));
    a.download = 'wardriver.cfg';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed';
  const input = 'w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-amber-500/50 disabled:opacity-50';

  return (
    <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="font-bold text-slate-100 text-sm flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <span>wardriver.cfg</span>
            {dirty && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300">unsaved</span>}
          </h3>
          <p className="text-xs text-slate-400">
            Reads <code className="text-amber-300">/wardriver.cfg</code> from the card. Each field edits its own line, so comments and other keys are kept.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}
            disabled={!connected || busy} onClick={loadCfg}>
            <RefreshCw className="w-3.5 h-3.5" /><span>{loaded ? 'Reload config' : 'Load config'}</span>
          </button>
          <button type="button" className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}
            disabled={!connected || busy || !loaded || !valid} onClick={saveCfg}>
            <Save className="w-3.5 h-3.5" /><span>Save &amp; reload</span>
          </button>
          <button type="button" className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-200`}
            disabled={!loaded || !valid} onClick={downloadCfg} title="Save a copy of this config to your computer">
            <Download className="w-3.5 h-3.5" /><span>Download .cfg</span>
          </button>
        </div>
      </div>

      {!connected && (
        <p className="text-xs text-slate-500">Connect the Piglet over USB to load its config.</p>
      )}
      {note.text && (
        <p className={`text-xs p-2.5 rounded-lg border ${note.bad ? 'text-rose-300 border-rose-500/40 bg-rose-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10'}`}>
          {note.text}
        </p>
      )}

      {loaded && valid && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2.5">
          {CFG_FIELDS.map((f) => {
            const cur = cfgReadKey(raw, f.k);
            if (f.type === 'bool') {
              return (
                <label key={f.k} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-300">
                  <span>{f.label}</span>
                  <input type="checkbox" className="accent-amber-500" disabled={busy}
                    checked={cur === 'true' || cur === '1'}
                    onChange={(e) => update(cfgSetKey(raw, f.k, e.target.checked ? 'true' : 'false'))} />
                </label>
              );
            }
            return (
              <label key={f.k} className="block text-xs">
                <span className="text-slate-400 block mb-0.5">{f.label} <code className="text-slate-600">{f.k}</code></span>
                {f.type === 'select' ? (
                  <select className={input} disabled={busy} value={cur != null ? cur : ''}
                    onChange={(e) => update(cfgSetKey(raw, f.k, e.target.value))}>
                    {cur == null && <option value="">(not set)</option>}
                    {cur != null && !f.opts.includes(cur) && <option value={cur}>{cur}</option>}
                    {f.opts.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : (
                  <input type="text" className={input} disabled={busy} value={cur != null ? cur : ''}
                    onChange={(e) => update(cfgSetKey(raw, f.k, e.target.value))} />
                )}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
