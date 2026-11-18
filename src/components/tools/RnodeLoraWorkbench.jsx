import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Radio, Calculator, Send, Power, PowerOff, RefreshCw, Activity, Cpu, Plug } from 'lucide-react';
import { useOptionalSerial } from '../../context/SerialContext';
import {
  KissDecoder, decodeFrame, buildDetect, buildQuery, buildRomRead, buildRadioState, buildSetRadio,
  validateRadioParams, decodeEeprom, timeOnAir, bitRateBps, sensitivityDbm, linkBudget,
  dutyCycleAllowance, symbolTimeMs, ldroAuto, toHex, CMD, RNODE_BAUD, BANDWIDTHS_HZ,
  TXPOWER_MIN_DBM, TXPOWER_MAX_DBM, REGIONS, regionCheck, rnodeconfCommand, reticulumInterfaceConfig,
  sampleStats, sparklinePoints, maxPayloadForToa,
} from '../../utils/rnodeLora.js';

/**
 * RNode & LoRa tool.
 *  - RNode: talks the RNode KISS command protocol over the shared serial port at 115200 baud
 *    (the same protocol Reticulum's RNodeInterface uses). Reads device info and EEPROM, sets
 *    radio parameters, switches the radio on/off, and shows RSSI/SNR/airtime as the device reports them.
 *  - LoRa calculator: offline Semtech AN1200.13 time-on-air, sensitivity, link budget, duty cycle.
 * Flashing and EEPROM provisioning are not done here; use the app's Firmware Flasher.
 */

const TABS = [['rnode', 'RNode (Reticulum)', Radio], ['calc', 'LoRa calculator', Calculator]];
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200';
const btnCls = 'px-2.5 py-1 text-xs rounded border border-slate-700 bg-slate-800 text-gray-200 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5';
const SF_OPTIONS = [5, 6, 7, 8, 9, 10, 11, 12];
const CR_OPTIONS = [5, 6, 7, 8];
const MAX_LOG = 120;
const MAX_SAMPLES = 60;

const fmt = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '-' : Number(v).toFixed(d));
const fmtHz = (hz) => (hz ? `${(hz / 1e6).toFixed(3)} MHz` : '-');
const fmtBw = (hz) => (hz ? `${(hz / 1000).toFixed(hz % 1000 ? 2 : 1)} kHz` : '-');
const nowStamp = () => new Date().toLocaleTimeString([], { hour12: false });

function Stat({ label, value, unit, tone = 'text-cyan-300' }) {
  return (
    <div className="bg-slate-950 border border-slate-800 rounded p-2 min-w-[7rem]">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-sm ${tone}`}>{value}{unit && <span className="text-[10px] text-slate-500 ml-1">{unit}</span>}</div>
    </div>
  );
}

function KV({ k, v }) {
  return (
    <div className="flex justify-between gap-3 py-0.5 border-b border-slate-900 last:border-0">
      <span className="text-slate-500 text-xs">{k}</span>
      <span className="font-mono text-xs text-gray-200 text-right break-all">{v}</span>
    </div>
  );
}

function Spark({ samples, label, tone = 'stroke-cyan-400' }) {
  const pts = sparklinePoints(samples, 120, 24);
  if (!pts) return <span className="text-slate-600 text-xs">-</span>;
  return (
    <svg viewBox="0 0 120 24" className="w-28 h-6" role="img" aria-label={label}>
      <polyline points={pts} fill="none" className={tone} strokeWidth="1.5" />
    </svg>
  );
}

function RnodeTab({ onLogMessage }) {
  const serial = useOptionalSerial();
  const connected = !!serial?.isConnected;
  const baud = serial?.baudRate;
  const decoderRef = useRef(null);
  if (!decoderRef.current) decoderRef.current = new KissDecoder();
  const logRef = useRef(onLogMessage);
  logRef.current = onLogMessage;

  const [log, setLog] = useState([]);
  const [info, setInfo] = useState({ detected: null, fwVersion: null, platform: null, mcu: null, board: null });
  const [eeprom, setEeprom] = useState(null);
  const [eepromError, setEepromError] = useState('');
  const [reported, setReported] = useState({}); // values the device echoed back
  const [sent, setSent] = useState(null); // last parameters this tool sent
  const [stats, setStats] = useState({ rxData: 0, rssi: null, snr: null, rssiSamples: [], snrSamples: [], deviceRx: null, deviceTx: null, channel: null, errors: [] });
  const [radioOn, setRadioOn] = useState(null);
  const [form, setForm] = useState({ freqMhz: '868.000', bwHz: 125000, sf: 7, cr: 5, txPower: 14 });
  const [formErrors, setFormErrors] = useState([]);
  const [busy, setBusy] = useState(false);
  const [region, setRegion] = useState('eu868');
  const [portName, setPortName] = useState('/dev/ttyUSB0');
  const [copied, setCopied] = useState('');

  const addLog = (text, kind = 'info') => {
    setLog((prev) => {
      const next = [...prev, { t: nowStamp(), text, kind }];
      return next.length > MAX_LOG ? next.slice(-MAX_LOG) : next;
    });
    if (logRef.current) logRef.current(text, kind === 'err' ? 'error' : 'info');
  };

  const handleFrame = (frame) => {
    const d = decodeFrame(frame);
    switch (d.type) {
      case 'detect':
        setInfo((s) => ({ ...s, detected: d.detected }));
        addLog(d.detected ? 'Device answered RNode detect (0x46).' : 'Detect reply did not match RNode (not an RNode, or wrong baud).', d.detected ? 'ok' : 'err');
        break;
      case 'fwVersion': setInfo((s) => ({ ...s, fwVersion: d.value })); addLog(`Firmware version ${d.value ?? '?'}`); break;
      case 'platform': setInfo((s) => ({ ...s, platform: d.value })); break;
      case 'mcu': setInfo((s) => ({ ...s, mcu: d.value })); break;
      case 'board': setInfo((s) => ({ ...s, board: d.value })); break;
      case 'rom': {
        try {
          setEeprom(decodeEeprom(frame.payload));
          setEepromError('');
          addLog(`EEPROM read: ${frame.payload.length} bytes.`, 'ok');
        } catch (e) {
          setEeprom(null);
          setEepromError(e.message);
          addLog(e.message, 'err');
        }
        break;
      }
      case 'frequency': case 'bandwidth': case 'txPower': case 'sf': case 'cr':
        setReported((r) => ({ ...r, [d.type]: d.value }));
        addLog(`Device reports ${d.type}: ${d.value}`);
        break;
      case 'rssi':
        if (d.value !== null) {
          setStats((s) => ({ ...s, rssi: d.value, rssiSamples: [...s.rssiSamples, d.value].slice(-MAX_SAMPLES) }));
        }
        break;
      case 'snr':
        if (d.value !== null) {
          setStats((s) => ({ ...s, snr: d.value, snrSamples: [...s.snrSamples, d.value].slice(-MAX_SAMPLES) }));
        }
        break;
      case 'data':
        setStats((s) => ({ ...s, rxData: s.rxData + 1 }));
        addLog(`Received data frame, ${d.length} bytes.`);
        break;
      case 'statRx': setStats((s) => ({ ...s, deviceRx: d.value })); break;
      case 'statTx': setStats((s) => ({ ...s, deviceTx: d.value })); break;
      case 'channelStats': setStats((s) => ({ ...s, channel: d.value })); break;
      case 'radioState': setRadioOn(d.on); break;
      case 'error':
        setStats((s) => ({ ...s, errors: [...s.errors, `${nowStamp()} ${d.value.name}`].slice(-20) }));
        addLog(`Device error: ${d.value.name}`, 'err');
        break;
      default: break;
    }
  };

  // Receive every chunk on the shared port and decode KISS frames from it.
  const handleFrameRef = useRef(handleFrame);
  handleFrameRef.current = handleFrame;
  useEffect(() => {
    if (!connected || !serial?.subscribeRx) return undefined;
    const dec = decoderRef.current;
    dec.reset();
    const unsub = serial.subscribeRx((bytes) => {
      for (const f of dec.push(bytes)) handleFrameRef.current(f);
    });
    return unsub;
  }, [connected, serial?.subscribeRx]);

  const send = async (bytes, label) => {
    if (!serial?.isConnected) {
      addLog('Not connected: connect the board first.', 'err');
      return false;
    }
    try {
      await serial.sendRawBytes(bytes);
      addLog(`TX ${label}: ${toHex(bytes)}`, 'tx');
      return true;
    } catch (e) {
      addLog(`Send failed: ${e.message}`, 'err');
      return false;
    }
  };

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const applyRadio = () => run(async () => {
    const freqHz = Math.round(Number(form.freqMhz) * 1e6);
    const params = { freqHz, bwHz: Number(form.bwHz), sf: Number(form.sf), cr: Number(form.cr), txPowerDbm: Number(form.txPower) };
    const errs = validateRadioParams(params);
    const reg = regionCheck(region, Number(form.freqMhz), Number(form.txPower));
    setFormErrors([...errs, ...reg.messages]);
    if (errs.length || !reg.ok) return;
    const ok = await send(buildSetRadio(params), 'radio parameters');
    if (ok) setSent({ ...params, at: nowStamp() });
  });

  const freqNum = Number(form.freqMhz);
  const powerNum = Number(form.txPower);
  const regionResult = useMemo(() => regionCheck(region, freqNum, powerNum), [region, freqNum, powerNum]);
  const exportData = useMemo(() => {
    const params = { freqHz: Math.round(freqNum * 1e6), bwHz: Number(form.bwHz), sf: Number(form.sf), cr: Number(form.cr), txPowerDbm: powerNum };
    try {
      return { cmd: rnodeconfCommand(params, portName || '/dev/ttyUSB0'), cfg: reticulumInterfaceConfig(params, portName || '/dev/ttyUSB0'), err: '' };
    } catch (e) {
      return { cmd: '', cfg: '', err: e.message };
    }
  }, [form, portName]);
  const copyText = async (key, text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(''), 1500);
    } catch { setCopied(''); }
  };
  const rssiStats = sampleStats(stats.rssiSamples);
  const snrStats = sampleStats(stats.snrSamples);

  const hasPort = connected;
  const baudMismatch = hasPort && baud && Number(baud) !== RNODE_BAUD;

  return (
    <div className="space-y-2">
      <div className="bg-slate-950 border border-slate-800 rounded p-2 flex flex-wrap items-center gap-2">
        <Plug size={14} className={connected ? 'text-emerald-400' : 'text-slate-500'} />
        <span className="text-xs text-gray-300">
          {connected ? `Serial connected${baud ? ` at ${baud} baud` : ''}` : 'No serial port connected.'}
        </span>
        {!connected && serial?.connect && (
          <button className={btnCls} onClick={() => serial.connect()}>Connect serial port</button>
        )}
        {baudMismatch && (
          <button className={`${btnCls} border-amber-800 text-amber-300`} onClick={() => serial.setBaudRate(RNODE_BAUD)}>
            Set {RNODE_BAUD} baud (RNode default)
          </button>
        )}
        {!serial && <span className="text-[11px] text-amber-300">Serial context unavailable in this view.</span>}
        <span className="ml-auto text-[10px] text-slate-500" title={`RNode firmware runs at ${RNODE_BAUD} baud`}>Shared port, {RNODE_BAUD} baud</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button className={btnCls} disabled={!hasPort || busy} onClick={() => run(() => send(buildDetect(), 'detect'))}>
          <RefreshCw size={12} /> Detect RNode
        </button>
        <button className={btnCls} disabled={!hasPort || busy} onClick={() => run(async () => {
          await send(buildQuery(CMD.FW_VERSION), 'firmware version');
          await send(buildQuery(CMD.PLATFORM), 'platform');
          await send(buildQuery(CMD.MCU), 'mcu');
          await send(buildQuery(CMD.BOARD), 'board');
        })}>
          <Cpu size={12} /> Read device info
        </button>
        <button className={btnCls} disabled={!hasPort || busy} onClick={() => run(() => send(buildRomRead(), 'EEPROM read'))}>
          Read EEPROM
        </button>
        <button className={btnCls} disabled={!hasPort || busy} onClick={() => run(() => send(buildRadioState(true), 'radio on'))}>
          <Power size={12} /> Radio on
        </button>
        <button className={btnCls} disabled={!hasPort || busy} onClick={() => run(() => send(buildRadioState(false), 'radio off'))}>
          <PowerOff size={12} /> Radio off
        </button>
        <button className={btnCls} disabled={!hasPort || busy} onClick={() => run(() => send(buildQuery(CMD.STAT_CHTM), 'channel stats'))}>
          <Activity size={12} /> Poll channel stats
        </button>
      </div>

      <div className="grid grid-cols-2 @md:grid-cols-4 gap-2">
        <Stat label="Detect" value={info.detected === null ? '-' : info.detected ? 'RNode' : 'no reply'} tone={info.detected ? 'text-emerald-300' : 'text-slate-400'} />
        <Stat label="Firmware" value={info.fwVersion ?? '-'} />
        <Stat label="Platform" value={info.platform ? info.platform.name : '-'} />
        <Stat label="MCU" value={info.mcu ? info.mcu.name : '-'} />
        <Stat label="Radio" value={radioOn === null ? '-' : radioOn ? 'on' : 'off'} tone={radioOn ? 'text-emerald-300' : 'text-slate-400'} />
        <Stat label="RSSI (last)" value={fmt(stats.rssi)} unit="dBm" />
        <Stat label="SNR (last)" value={fmt(stats.snr, 2)} unit="dB" />
        <Stat label="Data frames" value={stats.rxData} />
      </div>

      <div className="grid @lg:grid-cols-2 gap-2">
        <section className="bg-slate-950 border border-slate-800 rounded p-2.5">
          <h3 className="text-xs font-semibold text-gray-200 mb-2">Radio parameters</h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-1 text-slate-400">Frequency (MHz)
              <input className={inputCls} value={form.freqMhz} onChange={(e) => setForm({ ...form, freqMhz: e.target.value })} aria-label="Frequency MHz" />
            </label>
            <label className="flex flex-col gap-1 text-slate-400">Bandwidth
              <select className={inputCls} value={form.bwHz} onChange={(e) => setForm({ ...form, bwHz: Number(e.target.value) })} aria-label="Bandwidth">
                {BANDWIDTHS_HZ.map((b) => <option key={b} value={b}>{fmtBw(b)}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-slate-400">Spreading factor
              <select className={inputCls} value={form.sf} onChange={(e) => setForm({ ...form, sf: Number(e.target.value) })} aria-label="Spreading factor">
                {SF_OPTIONS.map((s) => <option key={s} value={s}>SF{s}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-slate-400">Coding rate
              <select className={inputCls} value={form.cr} onChange={(e) => setForm({ ...form, cr: Number(e.target.value) })} aria-label="Coding rate">
                {CR_OPTIONS.map((c) => <option key={c} value={c}>4/{c}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-slate-400">TX power (dBm, {TXPOWER_MIN_DBM}-{TXPOWER_MAX_DBM})
              <input type="number" className={inputCls} value={form.txPower} onChange={(e) => setForm({ ...form, txPower: e.target.value })} aria-label="TX power dBm" />
            </label>
            <label className="flex flex-col gap-1 text-slate-400">Regulatory region
              <select className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Regulatory region">
                {Object.entries(REGIONS).map(([id, r]) => <option key={id} value={id}>{r.label}</option>)}
              </select>
            </label>
          </div>
          {region !== 'none' && (
            <div className={`mt-2 p-1.5 rounded border text-[11px] ${regionResult.ok ? 'border-emerald-900 bg-emerald-950/20 text-emerald-300' : 'border-amber-900 bg-amber-950/30 text-amber-300'}`} data-testid="region-check">
              {regionResult.ok
                ? `Within ${regionResult.band.note}. Duty cycle ${regionResult.duty * 100}%; max ${regionResult.maxDbm} dBm.`
                : regionResult.messages.join(' ')}
              {!regionResult.ok && ' Apply is blocked; pick "Other / licensed" only if you hold the right licence.'}
            </div>
          )}
          {formErrors.length > 0 && (
            <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-[11px] text-red-300">{formErrors.join(' ')}</div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button className={btnCls} disabled={!hasPort || busy || !regionResult.ok} onClick={applyRadio}>
              <Send size={12} /> Apply to device
            </button>
            <span className="text-[10px] text-slate-500">Sends freq, BW, TX power, SF, CR. Radio state unchanged. The region check is advisory and ignores antenna gain; you are responsible for local rules.</span>
          </div>
          <details className="mt-2 text-[11px]">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Export for rnodeconf / Reticulum</summary>
            <label className="flex flex-col gap-1 text-slate-400 mt-1">Port name in the export
              <input className={inputCls} value={portName} onChange={(e) => setPortName(e.target.value)} aria-label="Export port name" />
            </label>
            {exportData.err ? <div className="mt-1 text-red-300">{exportData.err}</div> : (
              <div className="mt-1 space-y-1">
                <div className="text-slate-500">Text only: run it yourself with the CLI; this tool does not execute it.</div>
                <pre className="bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-[11px] text-gray-200 whitespace-pre-wrap break-all">{exportData.cmd}</pre>
                <button className={btnCls} onClick={() => copyText('cmd', exportData.cmd)}>{copied === 'cmd' ? 'Copied' : 'Copy command'}</button>
                <pre className="bg-slate-900 border border-slate-800 rounded p-1.5 font-mono text-[11px] text-gray-200 whitespace-pre-wrap">{exportData.cfg}</pre>
                <button className={btnCls} onClick={() => copyText('cfg', exportData.cfg)}>{copied === 'cfg' ? 'Copied' : 'Copy Reticulum config'}</button>
              </div>
            )}
          </details>
          <div className="mt-3 text-[11px] text-slate-400 space-y-1">
            <div className="text-slate-500 uppercase text-[10px] tracking-wide">Last applied by this tool</div>
            {sent ? (
              <div className="font-mono text-xs text-gray-200">{fmtHz(sent.freqHz)} · {fmtBw(sent.bwHz)} · SF{sent.sf} · 4/{sent.cr} · {sent.txPowerDbm} dBm <span className="text-slate-500">({sent.at})</span></div>
            ) : <div className="text-slate-600">None yet.</div>}
            {Object.keys(reported).length > 0 && (
              <>
                <div className="text-slate-500 uppercase text-[10px] tracking-wide mt-2">Echoed by device</div>
                <div className="font-mono text-xs text-gray-200">
                  {reported.frequency !== undefined && `${fmtHz(reported.frequency)} `}
                  {reported.bandwidth !== undefined && `· ${fmtBw(reported.bandwidth)} `}
                  {reported.sf !== undefined && `· SF${reported.sf} `}
                  {reported.cr !== undefined && `· 4/${reported.cr} `}
                  {reported.txPower !== undefined && `· ${reported.txPower} dBm`}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="bg-slate-950 border border-slate-800 rounded p-2.5">
          <h3 className="text-xs font-semibold text-gray-200 mb-2">Live statistics</h3>
          <KV k="RSSI (last 60)" v={rssiStats ? `min ${rssiStats.min} / avg ${fmt(rssiStats.mean, 1)} / max ${rssiStats.max} dBm` : '-'} />
          <div className="py-0.5"><Spark samples={stats.rssiSamples} label="RSSI trend" /></div>
          <KV k="SNR (last 60)" v={snrStats ? `min ${fmt(snrStats.min, 2)} / avg ${fmt(snrStats.mean, 2)} / max ${fmt(snrStats.max, 2)} dB` : '-'} />
          <div className="py-0.5"><Spark samples={stats.snrSamples} label="SNR trend" tone="stroke-amber-400" /></div>
          <KV k="Device RX counter" v={stats.deviceRx ?? '-'} />
          <KV k="Device TX counter" v={stats.deviceTx ?? '-'} />
          <KV k="Channel airtime (short / long)" v={stats.channel ? `${fmt(stats.channel.shortAirtimePct, 2)}% / ${fmt(stats.channel.longAirtimePct, 2)}%` : '-'} />
          <KV k="Channel load (short / long)" v={stats.channel ? `${fmt(stats.channel.shortLoadPct, 2)}% / ${fmt(stats.channel.longLoadPct, 2)}%` : '-'} />
          <KV k="Noise floor" v={stats.channel ? `${stats.channel.noiseFloor} dBm` : '-'} />
          <KV k="Device errors" v={stats.errors.length ? stats.errors.slice(-3).join(' | ') : 'none'} />
          <details className="mt-2"><summary className="text-[10px] text-slate-500 cursor-pointer">About these numbers</summary>
            <p className="text-[10px] text-slate-500 mt-1">
              RSSI and SNR arrive from the device with each received packet. Channel airtime is sent only when the device
              answers the stats query. Counters and airtime replies are decoded from RNode/RNS sources but not yet verified on hardware.
            </p>
          </details>
        </section>
      </div>

      <section className="bg-slate-950 border border-slate-800 rounded p-2.5">
        <h3 className="text-xs font-semibold text-gray-200 mb-2">EEPROM (provisioned data, read only)</h3>
        {eepromError && <div className="mb-2 p-2 border border-red-900 rounded bg-red-950/30 text-[11px] text-red-300">{eepromError}</div>}
        {!eeprom ? (
          <p className="text-xs text-slate-500">Press "Read EEPROM" to decode the device's provisioned product, serial and stored radio config.</p>
        ) : (
          <div className="grid @lg:grid-cols-2 gap-3">
            <div>
              <KV k="Provisioned" v={eeprom.provisioned ? 'yes (info lock 0x73)' : 'no'} />
              <KV k="Product" v={`${eeprom.productName} (0x${eeprom.product.toString(16).padStart(2, '0')})`} />
              <KV k="Model" v={`0x${eeprom.model.toString(16).padStart(2, '0')}`} />
              <KV k="Hardware revision" v={eeprom.hwRev} />
              <KV k="Serial (raw)" v={eeprom.serialHex} />
              <KV k="Made (raw)" v={eeprom.madeHex} />
              <KV k="Checksum (MD5 of product..made)" v={eeprom.checksumOk ? 'matches' : 'MISMATCH'} />
              <KV k="Signature block" v={eeprom.signaturePresent ? '128 bytes present (not verified here)' : 'blank'} />
            </div>
            <div>
              <KV k="Stored config valid" v={eeprom.configValid ? 'yes' : 'no'} />
              <KV k="Stored frequency" v={eeprom.config.freqHz ? fmtHz(eeprom.config.freqHz) : '-'} />
              <KV k="Stored bandwidth" v={eeprom.config.bwHz ? fmtBw(eeprom.config.bwHz) : '-'} />
              <KV k="Stored SF" v={`SF${eeprom.config.sf}`} />
              <KV k="Stored CR" v={`4/${eeprom.config.cr}`} />
              <KV k="Stored TX power" v={`${eeprom.config.txPowerDbm} dBm`} />
            </div>
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-2">
          Read only. EEPROM provisioning, signing and firmware flashing are not done by this tool; use the app's Firmware Flasher.
        </p>
      </section>

      <section className="bg-slate-950 border border-slate-800 rounded p-2.5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-gray-200">Protocol log</h3>
          <button className="text-[10px] text-slate-500 hover:text-slate-300" onClick={() => setLog([])}>Clear</button>
        </div>
        <div className="h-32 overflow-auto font-mono text-[11px] space-y-0.5">
          {log.length === 0 && <div className="text-slate-600">No traffic yet.</div>}
          {log.map((l, i) => (
            <div key={i} className={l.kind === 'err' ? 'text-red-300' : l.kind === 'ok' ? 'text-emerald-300' : l.kind === 'tx' ? 'text-cyan-300' : 'text-slate-400'}>
              <span className="text-slate-600">{l.t}</span> {l.text}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function CalcTab() {
  const [f, setF] = useState({
    sf: 7, bwHz: 125000, cr: 5, payload: 20, preamble: 8, implicit: false, crc: true, ldro: 'auto',
    txPower: 14, txGain: 2.15, rxGain: 2.15, cable: 0, freqMhz: 868, nf: 6, fade: 10, duty: 1, interval: 60,
  });
  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setF((s) => ({ ...s, [k]: v }));
  };
  const num = (v) => (v === '' || v === null ? NaN : Number(v));

  const result = useMemo(() => {
    try {
      const sf = Number(f.sf);
      const bwHz = Number(f.bwHz);
      const cr = Number(f.cr);
      const toa = timeOnAir({ payloadBytes: num(f.payload), sf, bwHz, cr, preamble: num(f.preamble), implicitHeader: f.implicit, crc: f.crc, ldro: f.ldro });
      const sens = sensitivityDbm({ bwHz, sf, noiseFigureDb: num(f.nf) });
      const lb = linkBudget({
        txPowerDbm: num(f.txPower), txGainDbi: num(f.txGain), rxGainDbi: num(f.rxGain), cableLossDb: num(f.cable),
        freqMhz: num(f.freqMhz), sensitivity: sens, fadeMarginDb: num(f.fade),
      });
      const duty = dutyCycleAllowance({ toaMs: toa.totalMs, dutyFraction: num(f.duty) / 100 });
      const perSf = [];
      for (let s = 7; s <= 12; s += 1) {
        perSf.push({ sf: s, toa: timeOnAir({ payloadBytes: num(f.payload), sf: s, bwHz, cr, preamble: num(f.preamble), implicitHeader: f.implicit, crc: f.crc, ldro: f.ldro }).totalMs });
      }
      const intervalS = num(f.interval);
      const maxPayload = Number(f.duty) >= 100 || !(intervalS > 0) ? null
        : maxPayloadForToa(intervalS * 1000 * (num(f.duty) / 100), { sf, bwHz, cr, preamble: num(f.preamble), implicitHeader: f.implicit, crc: f.crc, ldro: f.ldro });
      return {
        error: '', toa, sens, lb, duty, perSf, maxPayload,
        symbolMs: symbolTimeMs(sf, bwHz), bitrate: bitRateBps({ sf, bwHz, cr }), ldroAuto: ldroAuto(sf, bwHz),
        warn: sf === 6 && !f.implicit ? 'SF6 is normally used with an implicit header only.' : '',
      };
    } catch (e) {
      return { error: e.message };
    }
  }, [f]);

  const inp = `${inputCls} w-full`;
  const lab = 'flex flex-col gap-1 text-[11px] text-slate-400';

  return (
    <div className="grid @lg:grid-cols-[18rem_1fr] gap-2">
      <section className="bg-slate-950 border border-slate-800 rounded p-2.5 space-y-2">
        <h3 className="text-xs font-semibold text-gray-200">Modulation</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className={lab}>Spreading factor
            <select className={inp} value={f.sf} onChange={set('sf')} aria-label="Calc spreading factor">
              {SF_OPTIONS.map((s) => <option key={s} value={s}>SF{s}</option>)}
            </select>
          </label>
          <label className={lab}>Bandwidth
            <select className={inp} value={f.bwHz} onChange={set('bwHz')} aria-label="Calc bandwidth">
              {[7800, 10400, 15600, 20800, 31250, 41700, 62500, 125000, 250000, 500000].map((b) => <option key={b} value={b}>{fmtBw(b)}</option>)}
            </select>
          </label>
          <label className={lab}>Coding rate
            <select className={inp} value={f.cr} onChange={set('cr')} aria-label="Calc coding rate">
              {CR_OPTIONS.map((c) => <option key={c} value={c}>4/{c}</option>)}
            </select>
          </label>
          <label className={lab}>Low data rate opt.
            <select className={inp} value={f.ldro} onChange={set('ldro')} aria-label="LDRO">
              <option value="auto">auto (&gt;16 ms symbol)</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </select>
          </label>
          <label className={lab}>Payload (bytes)
            <input type="number" min="0" max="255" className={inp} value={f.payload} onChange={set('payload')} aria-label="Payload bytes" />
          </label>
          <label className={lab}>Preamble (symbols)
            <input type="number" min="0" className={inp} value={f.preamble} onChange={set('preamble')} aria-label="Preamble" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={f.implicit} onChange={set('implicit')} /> Implicit header</label>
        <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={f.crc} onChange={set('crc')} /> Payload CRC on</label>

        <h3 className="text-xs font-semibold text-gray-200 pt-2">Link budget</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className={lab}>Frequency (MHz)<input type="number" className={inp} value={f.freqMhz} onChange={set('freqMhz')} aria-label="Frequency" /></label>
          <label className={lab}>TX power (dBm)<input type="number" className={inp} value={f.txPower} onChange={set('txPower')} aria-label="TX power" /></label>
          <label className={lab}>TX antenna (dBi)<input type="number" step="0.1" className={inp} value={f.txGain} onChange={set('txGain')} aria-label="TX gain" /></label>
          <label className={lab}>RX antenna (dBi)<input type="number" step="0.1" className={inp} value={f.rxGain} onChange={set('rxGain')} aria-label="RX gain" /></label>
          <label className={lab}>Cable/connector loss (dB)<input type="number" step="0.1" className={inp} value={f.cable} onChange={set('cable')} aria-label="Cable loss" /></label>
          <label className={lab}>Noise figure (dB)<input type="number" step="0.5" className={inp} value={f.nf} onChange={set('nf')} aria-label="Noise figure" /></label>
          <label className={lab}>Fade margin (dB)<input type="number" step="1" className={inp} value={f.fade} onChange={set('fade')} aria-label="Fade margin" /></label>
          <label className={lab}>Duty cycle
            <select className={inp} value={f.duty} onChange={set('duty')} aria-label="Duty cycle">
              <option value="1">1% (EU868 default)</option>
              <option value="0.1">0.1%</option>
              <option value="10">10% (869.4-869.65 MHz)</option>
              <option value="100">no limit (100%)</option>
            </select>
          </label>
        </div>
      </section>

      <section className="space-y-2">
        {result.error ? (
          <div className="p-3 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{result.error}</div>
        ) : (
          <>
            {result.warn && <div className="p-2 border border-amber-900 rounded bg-amber-950/30 text-[11px] text-amber-300">{result.warn}</div>}
            <div className="grid grid-cols-2 @xl:grid-cols-4 gap-2">
              <Stat label="Time on air" value={fmt(result.toa.totalMs, 2)} unit="ms" />
              <Stat label="Symbol time" value={fmt(result.symbolMs, 3)} unit="ms" />
              <Stat label="Bit rate" value={fmt(result.bitrate, 1)} unit="bps" />
              <Stat label="LDRO in use" value={result.toa.ldro ? 'on' : 'off'} />
              <Stat label="Sensitivity (est.)" value={fmt(result.sens, 1)} unit="dBm" tone="text-amber-300" />
              <Stat label="Max path loss" value={fmt(result.lb.maxPathLossDb, 1)} unit="dB" />
              <Stat label="Free-space range" value={fmt(result.lb.rangeKm, result.lb.rangeKm < 10 ? 2 : 0)} unit="km" tone="text-emerald-300" />
              <Stat label="Max msgs / hour" value={f.duty === '100' ? 'unlimited' : result.duty.maxMessagesPerHour} tone="text-emerald-300" />
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
              <KV k="Preamble time" v={`${fmt(result.toa.preambleMs, 2)} ms`} />
              <KV k="Payload symbols" v={result.toa.payloadSymbols} />
              <KV k="Payload time" v={`${fmt(result.toa.payloadMs, 2)} ms`} />
              <KV k="Duty-cycle budget per hour" v={`${fmt(result.duty.allowedMsPerHour / 1000, 0)} s (${f.duty}%)`} />
              <KV k="Minimum off time after one message" v={f.duty === '100' ? 'none' : `${fmt(result.duty.minOffTimeMs / 1000, 2)} s`} />
              <KV k="Path loss at 1 km (free space)" v={`${fmt(result.lb.fsplAt1kmDb, 2)} dB`} />
              <KV k="Longest payload at the duty limit, one message per" v={
                <span className="inline-flex items-center gap-1">
                  <input type="number" min="1" className={`${inputCls} w-16`} value={f.interval} onChange={set('interval')} aria-label="Message interval seconds" /> s:
                  <span>{result.maxPayload === null ? '-' : result.maxPayload < 0 ? 'none fits' : `${result.maxPayload} bytes`}</span>
                </span>
              } />
            </div>
            <div className="bg-slate-950 border border-slate-800 rounded p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Time on air by spreading factor (same bandwidth, payload, CR)</div>
              <table className="w-full text-xs font-mono">
                <thead className="text-slate-500 text-left"><tr><th className="font-normal">SF</th><th className="font-normal">ToA (ms)</th><th className="font-normal">Msgs/h at duty</th></tr></thead>
                <tbody>
                  {result.perSf.map((r) => (
                    <tr key={r.sf} className={r.sf === Number(f.sf) ? 'text-cyan-300' : 'text-gray-300'}>
                      <td>SF{r.sf}</td>
                      <td>{fmt(r.toa, 2)}</td>
                      <td>{f.duty === '100' ? '-' : dutyCycleAllowance({ toaMs: r.toa, dutyFraction: num(f.duty) / 100 }).maxMessagesPerHour}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-[10px] text-slate-500">
          Time on air follows Semtech AN1200.13. Sensitivity is the -174 + 10log10(BW) + NF + SNR-limit estimate, not a datasheet value.
          Range is free-space only and is an upper bound; terrain and obstructions reduce it a lot. The calculator runs offline and does not use the device.
        </p>
      </section>
    </div>
  );
}

export default function RnodeLoraWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('rnode');
  return (
    <div className="space-y-2 text-gray-200">
      <nav className="flex gap-1" role="tablist" aria-label="RNode and LoRa">
        {TABS.map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-2.5 py-1 text-xs rounded inline-flex items-center gap-1.5 border ${tab === id ? 'bg-cyan-900/40 border-cyan-800 text-cyan-200' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'}`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </nav>
      {tab === 'rnode' ? <RnodeTab onLogMessage={onLogMessage} /> : <CalcTab />}
    </div>
  );
}
