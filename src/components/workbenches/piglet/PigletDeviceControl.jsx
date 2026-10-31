import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Play, Square, Upload, RotateCcw, Sliders, RefreshCw } from 'lucide-react';

// Device control over the toolkit's USB session: the same status / start / stop
// / upload / reboot the firmware's Web UI offers on the SoftAP, via the WT STAT,
// WT SCAN, WT UPLOAD and WT REBOOT commands in SerialTool.cpp.

const POLL_MS = 3000;

const UPLOAD_ERRORS = {
  nohome: 'No home Wi-Fi is set in wardriver.cfg (homeSsid), so the Piglet can’t get online to upload.',
  nowifi: 'The Piglet couldn’t join the home Wi-Fi. Check homeSsid / homePsk and that the network is in range.',
  nosd: 'The SD card isn’t available.'
};

function Card({ label, value, tone = 'text-slate-200', sub }) {
  return (
    <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg space-y-1 min-w-0">
      <div className="text-[10px] uppercase font-bold text-slate-500">{label}</div>
      <div className={`text-sm font-bold truncate ${tone}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function scanState(st) {
  if (!st) return { value: '--' };
  if (!st.sdOk) return { value: 'NO SD CARD', tone: 'text-rose-400' };
  if (st.toolSession) return { value: 'PAUSED', tone: 'text-amber-300', sub: 'Toolkit has the SD card · resumes 30 s after the last file action' };
  if (!st.scanningEnabled) return { value: 'STOPPED', tone: 'text-slate-400', sub: 'Stopped by the user' };
  if (st.allowScan) return { value: 'SCANNING', tone: 'text-emerald-400' };
  if (st.wifiConnected) return { value: 'PAUSED', tone: 'text-amber-300', sub: 'On home Wi-Fi' };
  if (st.apActive) return { value: 'PAUSED', tone: 'text-amber-300', sub: 'Setup access point is up' };
  return { value: 'PAUSED', tone: 'text-amber-300', sub: 'Auto-paused' };
}

export default function PigletDeviceControl({ client, connected, active, busy, setBusy, setStatus, log, onEditConfig }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [updated, setUpdated] = useState(null);
  const [action, setAction] = useState('');        // label of the action in flight
  const [result, setResult] = useState({ text: '', bad: false });
  const [uploadTarget, setUploadTarget] = useState('all');
  const pollingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!client.connected || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const s = await client.stat();
      setSt(s);
      setErr('');
      setUpdated(new Date());
    } catch (e) {
      if (/unknown/i.test(e.message)) setUnsupported(true);
      else setErr(e.message);
    } finally {
      pollingRef.current = false;
    }
  }, [client]);

  useEffect(() => {
    if (!connected) { setSt(null); setErr(''); setUnsupported(false); setUpdated(null); setAction(''); }
  }, [connected]);

  // Poll while this tab is open. Polls wait their turn behind file transfers,
  // and a poll is skipped if anything else is queued.
  useEffect(() => {
    if (!active || !connected || unsupported) return undefined;
    refresh();
    const iv = setInterval(() => { if (client.isIdle()) refresh(); }, POLL_MS);
    return () => clearInterval(iv);
  }, [active, connected, unsupported, refresh, client]);

  const run = async (label, fn) => {
    if (action || busy) return;
    setAction(label);
    setBusy(true);
    setResult({ text: '', bad: false });
    try {
      await fn();
    } catch (e) {
      if (/unknown/i.test(e.message)) setUnsupported(true);
      const key = e.message.replace(/^ERR\s+/, '').trim();
      const text = UPLOAD_ERRORS[key] || (label + ' failed: ' + e.message);
      setResult({ text, bad: true });
      log(label + ' failed: ' + e.message);
    } finally {
      setAction('');
      setBusy(false);
    }
    refresh();
  };

  const startScan = () => run('Start scan', async () => {
    await client.scan(true);
    setResult({ text: 'Scanning started. The toolkit session was closed so the Piglet can use the SD card.', bad: false });
    log('Scanning started');
  });

  const stopScan = () => run('Stop scan', async () => {
    await client.scan(false);
    setResult({ text: 'Scanning stopped.', bad: false });
    log('Scanning stopped');
  });

  const upload = () => run('Upload', async () => {
    setStatus('uploading logs (the Piglet joins home Wi-Fi if needed)…');
    const r = await client.upload(uploadTarget);
    const text = 'Uploaded ' + r.uploaded + ' of ' + r.total + ' file' + (r.total === 1 ? '' : 's') + (r.message ? ' · ' + r.message : '');
    setResult({ text, bad: r.total > 0 && r.uploaded === 0 });
    setStatus('upload finished');
    log('Upload (' + uploadTarget + '): ' + text);
  });

  const reboot = () => {
    if (!window.confirm('Reboot the Piglet? The USB connection will drop; reconnect once it has restarted.')) return;
    run('Reboot', async () => {
      await client.reboot();
      log('Reboot requested');
      setResult({ text: 'Rebooting. Reconnect in a few seconds.', bad: false });
      await client.disconnect();
    });
  };

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-bold text-xs transition disabled:opacity-40 disabled:cursor-not-allowed';
  const disabled = !connected || unsupported || busy || !!action;
  const scan = scanState(st);
  const services = st ? [st.hasWdgwars && 'WDGoWars', st.hasWigle && 'WiGLE', st.hasWardrift && 'Wardrift'].filter(Boolean) : [];

  return (
    <div className="bg-[#12151c] border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h2 className="font-bold text-slate-100 text-sm">Device Control</h2>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">USB</span>
          </div>
          <p className="text-xs text-slate-400">
            Status and controls from the Piglet&apos;s Web UI, over the USB cable instead of the SoftAP.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          {updated && <span>updated {updated.toLocaleTimeString()}</span>}
          <button type="button" onClick={refresh} disabled={!connected || unsupported}
            className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40" title="Refresh now">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!connected && (
        <p className="text-xs text-slate-500">Connect the Piglet over USB (button above) to see its status.</p>
      )}
      {unsupported && (
        <p className="text-xs p-2.5 rounded-lg border text-rose-300 border-rose-500/40 bg-rose-500/10">
          This firmware doesn&apos;t have device control over USB yet. Flash the latest WarHog firmware from the Web Flasher tab, then reconnect.
          File browsing and the config editor still work.
        </p>
      )}
      {err && !unsupported && (
        <p className="text-xs p-2.5 rounded-lg border text-amber-300 border-amber-500/30 bg-amber-500/10">Status read failed: {err}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <Card label="Scanning" value={scan.value} tone={scan.tone} sub={scan.sub} />
        <Card label="GPS" value={st ? (st.gpsFix ? 'FIX' : 'SEARCHING') : '--'} tone={st?.gpsFix ? 'text-emerald-400' : 'text-rose-400'} />
        <Card label="Found 2.4 GHz" value={st ? st.found2g.toLocaleString() : '--'} tone="text-amber-400" />
        <Card label="Found 5 GHz" value={st ? (st.c5Connected ? st.found5g.toLocaleString() : 'n/a') : '--'} tone="text-pink-400" />
        <Card label="Home Wi-Fi" value={st ? (st.wifiConnected ? 'CONNECTED' : 'OFFLINE') : '--'}
          tone={st?.wifiConnected ? 'text-emerald-400' : 'text-slate-400'}
          sub={st ? (st.wifiConnected ? st.staIp : (st.homeSsidSet ? 'homeSsid set' : 'no homeSsid in config')) : ''} />
        <Card label="Logging to" value={st ? (st.logFile ? st.logFile.split('/').pop() : 'none') : '--'} sub={st?.logFile || ''} />
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={startScan} disabled={disabled} className={`${btn} bg-emerald-600 hover:bg-emerald-500 text-white`}>
          <Play className="w-3.5 h-3.5" /><span>{action === 'Start scan' ? 'Starting…' : 'Start Scan'}</span>
        </button>
        <button type="button" onClick={stopScan} disabled={disabled} className={`${btn} bg-rose-600 hover:bg-rose-500 text-white`}>
          <Square className="w-3.5 h-3.5" /><span>{action === 'Stop scan' ? 'Stopping…' : 'Stop Scan'}</span>
        </button>
        <div className="inline-flex items-stretch rounded-lg overflow-hidden border border-cyan-700">
          <button type="button" onClick={upload} disabled={disabled}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-bold text-xs bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            title="Joins home Wi-Fi if needed, uploads pending logs, then goes back to wardriving">
            <Upload className="w-3.5 h-3.5" /><span>{action === 'Upload' ? 'Uploading…' : 'Upload Logs'}</span>
          </button>
          <select value={uploadTarget} onChange={(e) => setUploadTarget(e.target.value)} disabled={disabled}
            className="bg-slate-900 text-xs text-slate-200 px-2 outline-none border-l border-cyan-700 disabled:opacity-40">
            <option value="all">WDGoWars + WiGLE</option>
            <option value="wdgwars">WDGoWars only</option>
            <option value="wardrift">Wardrift only</option>
          </select>
        </div>
        <button type="button" onClick={onEditConfig} className={`${btn} bg-amber-500 hover:bg-amber-400 text-slate-950`}>
          <Sliders className="w-3.5 h-3.5" /><span>Edit wardriver.cfg</span>
        </button>
        <button type="button" onClick={reboot} disabled={disabled} className={`${btn} bg-slate-800 hover:bg-slate-700 text-slate-300`}>
          <RotateCcw className="w-3.5 h-3.5" /><span>Reboot</span>
        </button>
      </div>

      {st && (
        <p className="text-[11px] text-slate-500">
          Upload services in wardriver.cfg: {services.length ? services.join(', ') : 'none set'}.
          {action === 'Upload' && ' Uploading can take a few minutes; the Piglet stays quiet until it finishes.'}
        </p>
      )}
      {result.text && (
        <p className={`text-xs p-2.5 rounded-lg border ${result.bad ? 'text-rose-300 border-rose-500/40 bg-rose-500/10' : 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'}`}>
          {result.text}
        </p>
      )}
      {st?.uploadLastResult && !result.text && (
        <p className="text-[11px] text-slate-500">Last upload result: {st.uploadLastResult}</p>
      )}
    </div>
  );
}
