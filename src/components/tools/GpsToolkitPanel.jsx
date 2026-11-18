import React, { useState, useMemo } from 'react';
import { Send, Copy } from 'lucide-react';
import {
  buildNmeaSentence, decodeNmeaSentence, parseHexBytes, bytesToHex, decodeUbxFrames,
  hzToMeasRateMs, buildCfgMsgRate, buildUbxPoll, parseCoordinate, toDms, toDdm,
  toMaidenhead, haversineMeters, initialBearing, compassPoint
} from '../../utils/gpsTools';
import { buildCfgRate } from '../../utils/ubxProtocol';

const card = 'bg-[#030712] border border-slate-800 rounded-lg p-2.5 flex flex-col gap-2';
const label = 'text-[10px] text-slate-500 uppercase font-bold';
const input = 'w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-cyan-500';
const btn = 'px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 hover:border-cyan-500 text-[11px] font-bold text-cyan-300 transition disabled:opacity-40 disabled:cursor-not-allowed';

const NMEA_SAMPLE = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';

const NMEA_MSGS = [
  ['GGA', 0xf0, 0x00], ['GLL', 0xf0, 0x01], ['GSA', 0xf0, 0x02], ['GSV', 0xf0, 0x03], ['RMC', 0xf0, 0x04], ['VTG', 0xf0, 0x05]
];
const POLLS = [['MON-VER', 0x0a, 0x04], ['MON-HW', 0x0a, 0x09], ['CFG-RATE', 0x06, 0x08], ['CFG-PRT', 0x06, 0x00], ['CFG-NAV5', 0x06, 0x24]];

function NmeaCard() {
  const [text, setText] = useState(NMEA_SAMPLE);
  const res = useMemo(() => decodeNmeaSentence(text), [text]);
  return (
    <div className={card}>
      <span className={label}>NMEA checksum and field decoder</span>
      <input aria-label="NMEA sentence" className={input} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {!res.ok ? (
        <p className="text-[11px] text-amber-400">{res.error}</p>
      ) : (
        <>
          <p className="text-[11px]">
            <span className="text-slate-300">{res.talker} {res.type}</span>{' '}
            {res.hasChecksum ? (
              res.checksumOk
                ? <span className="text-emerald-400">checksum OK ({res.expected})</span>
                : <span className="text-red-400">checksum BAD: sentence says {res.given}, computed {res.expected}</span>
            ) : <span className="text-amber-400">no checksum, computed {res.expected}</span>}
          </p>
          <div className="max-h-40 overflow-auto border border-slate-800 rounded">
            <table className="w-full text-[11px]">
              <tbody>
                {res.fields.map((f, i) => (
                  <tr key={i} className="border-b border-slate-900 last:border-0">
                    <td className="px-1.5 py-0.5 text-slate-500 whitespace-nowrap">{f.name}</td>
                    <td className="px-1.5 py-0.5 text-slate-200 break-all">{f.value || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="flex gap-1.5">
        <button className={btn} title="Replace the checksum with the correct one" onClick={() => setText(buildNmeaSentence(text))}>Fix checksum</button>
        <button className={btn} title="Copy sentence" onClick={() => navigator.clipboard?.writeText(text)}><Copy className="w-3 h-3" /></button>
      </div>
    </div>
  );
}

function UbxCard({ isConnected, onSendRawBytes, onLogMessage }) {
  const [hz, setHz] = useState('10');
  const [hex, setHex] = useState(() => bytesToHex(buildCfgRate(100)));
  const [sent, setSent] = useState('');
  const [msgSel, setMsgSel] = useState('GSV');
  const [msgRate, setMsgRate] = useState('1');

  const ms = hzToMeasRateMs(hz);
  const frames = useMemo(() => {
    const b = parseHexBytes(hex);
    return b ? decodeUbxFrames(b) : null;
  }, [hex]);

  const send = async (bytes, desc) => {
    if (!isConnected) { onLogMessage?.('[UBX] Connect a GPS serial port first.', 'warn'); return; }
    const h = bytesToHex(bytes);
    setSent(h);
    onLogMessage?.(`[UBX TX] ${desc} (${bytes.length} bytes): ${h}`, 'tx', bytes);
    await onSendRawBytes?.(bytes);
  };

  const msg = NMEA_MSGS.find((m) => m[0] === msgSel);
  return (
    <div className={card}>
      <span className={label}>UBX frame builder and decoder</span>
      <div className="flex flex-wrap items-end gap-1.5">
        <label className="flex flex-col gap-0.5 w-20 text-[10px] text-slate-500">Rate (Hz)
          <input className={input} inputMode="decimal" value={hz} onChange={(e) => setHz(e.target.value)} />
        </label>
        <button className={btn} disabled={!ms} title="Build and send UBX-CFG-RATE" onClick={() => send(buildCfgRate(ms), `CFG-RATE ${ms} ms`)}>
          <Send className="w-3 h-3 inline mr-1" />Send {ms ? `${ms} ms` : ''}
        </button>
        <button className={btn} disabled={!ms} title="Show the frame without sending" onClick={() => setHex(bytesToHex(buildCfgRate(ms)))}>To box</button>
      </div>
      <div className="flex flex-wrap items-end gap-1.5">
        <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">NMEA message
          <select className={input} value={msgSel} onChange={(e) => setMsgSel(e.target.value)}>
            {NMEA_MSGS.map((m) => <option key={m[0]} value={m[0]}>{m[0]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 w-16 text-[10px] text-slate-500">Rate
          <input className={input} inputMode="numeric" value={msgRate} onChange={(e) => setMsgRate(e.target.value)} />
        </label>
        <button className={btn} title="UBX-CFG-MSG: 0 disables, 1 outputs every fix" onClick={() => send(buildCfgMsgRate(msg[1], msg[2], Math.min(255, Math.max(0, parseInt(msgRate, 10) || 0))), `CFG-MSG ${msgSel} rate ${msgRate}`)}>Set</button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {POLLS.map(([n, c, i]) => (
          <button key={n} className={btn} title={`Poll UBX-${n} (response appears in the raw stream)`} onClick={() => send(buildUbxPoll(c, i), `Poll ${n}`)}>Poll {n}</button>
        ))}
      </div>
      {sent && <code className="text-[10px] text-cyan-300 break-all">TX: {sent}</code>}
      <label className="flex flex-col gap-0.5 text-[10px] text-slate-500">Hex to decode (checksum is verified)
        <textarea className={`${input} h-14 resize-y`} value={hex} onChange={(e) => setHex(e.target.value)} spellCheck={false} />
      </label>
      {frames === null ? (
        <p className="text-[11px] text-amber-400">Not valid hex.</p>
      ) : frames.length === 0 ? (
        <p className="text-[11px] text-slate-500">No UBX frame (B5 62 ...) found.</p>
      ) : frames.map((f, i) => (
        <p key={i} className="text-[11px]">
          <span className="text-slate-200">UBX-{f.name}</span> <span className="text-slate-500">len {f.length}</span>{' '}
          {f.truncated ? <span className="text-amber-400">truncated</span>
            : f.checksumOk ? <span className="text-emerald-400">checksum OK</span> : <span className="text-red-400">checksum BAD</span>}
          {f.summary && <span className="text-slate-400"> - {f.summary}</span>}
        </p>
      ))}
    </div>
  );
}

function CoordCard() {
  const [a, setA] = useState('48.1173');
  const [b, setB] = useState('11.5167');
  const [c, setC] = useState('');
  const [d, setD] = useState('');
  const lat = parseCoordinate(a);
  const lon = parseCoordinate(b);
  const ok = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const lat2 = parseCoordinate(c);
  const lon2 = parseCoordinate(d);
  const ok2 = ok && lat2 !== null && lon2 !== null && Math.abs(lat2) <= 90 && Math.abs(lon2) <= 180;
  const dist = ok2 ? haversineMeters(lat, lon, lat2, lon2) : null;
  const brg = ok2 ? initialBearing(lat, lon, lat2, lon2) : null;
  return (
    <div className={card}>
      <span className={label}>Coordinate converter and distance</span>
      <div className="grid grid-cols-2 gap-1.5">
        <input aria-label="Latitude" placeholder="Latitude" className={input} value={a} onChange={(e) => setA(e.target.value)} />
        <input aria-label="Longitude" placeholder="Longitude" className={input} value={b} onChange={(e) => setB(e.target.value)} />
      </div>
      {ok ? (
        <div className="text-[11px] text-slate-300 space-y-0.5 break-all">
          <p><span className="text-slate-500">DD </span>{lat.toFixed(6)}, {lon.toFixed(6)}</p>
          <p><span className="text-slate-500">DDM </span>{toDdm(lat, true)} {toDdm(lon, false)}</p>
          <p><span className="text-slate-500">DMS </span>{toDms(lat, true)} {toDms(lon, false)}</p>
          <p><span className="text-slate-500">Grid </span>{toMaidenhead(lat, lon)}</p>
        </div>
      ) : <p className="text-[11px] text-amber-400">Enter decimal degrees, "48 07.038 N" or 48d07'02"N.</p>}
      <span className={label}>Second point (optional)</span>
      <div className="grid grid-cols-2 gap-1.5">
        <input aria-label="Second latitude" placeholder="Latitude" className={input} value={c} onChange={(e) => setC(e.target.value)} />
        <input aria-label="Second longitude" placeholder="Longitude" className={input} value={d} onChange={(e) => setD(e.target.value)} />
      </div>
      {ok2 && (
        <p className="text-[11px] text-slate-300">
          {dist >= 1000 ? `${(dist / 1000).toFixed(3)} km` : `${dist.toFixed(1)} m`} at {brg.toFixed(1)}&deg; {compassPoint(brg)}
          <span className="text-slate-500"> (great circle)</span>
        </p>
      )}
    </div>
  );
}

export default function GpsToolkitPanel({ isConnected = false, onSendRawBytes, onLogMessage }) {
  return (
    <div className="grid grid-cols-1 @xl:grid-cols-3 gap-2 font-mono text-xs">
      <NmeaCard />
      <UbxCard isConnected={isConnected} onSendRawBytes={onSendRawBytes} onLogMessage={onLogMessage} />
      <CoordCard />
    </div>
  );
}
