import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Satellite, 
  BookOpen, 
  Activity, 
  Volume2, 
  Sliders, 
  Download, 
  CheckCircle2, 
  RefreshCw, 
  Clock, 
  ArrowUpRight,
  Filter,
  PlusCircle,
  ExternalLink
} from 'lucide-react';

// Common Amateur Ham Bands
const HAM_BANDS = [
  { name: '160m', freqHz: 1840000, mode: 'LSB', desc: 'Top Band' },
  { name: '80m', freqHz: 3573000, mode: 'LSB', desc: 'Nighttime regional' },
  { name: '40m', freqHz: 7074000, mode: 'LSB', desc: 'FT8 & Voice' },
  { name: '20m', freqHz: 14074000, mode: 'USB', desc: 'Primary DX band' },
  { name: '15m', freqHz: 21074000, mode: 'USB', desc: 'Solar cycle DX' },
  { name: '10m', freqHz: 28074000, mode: 'USB', desc: 'Sporadic E & DX' },
  { name: '2m', freqHz: 144174000, mode: 'USB', desc: 'VHF SSB & FT8' },
  { name: '70cm', freqHz: 432174000, mode: 'USB', desc: 'UHF DX & Sat' },
];

// Satellites for live Doppler tracking
const SATELLITES = [
  { id: 'iss', name: 'ISS (ZARYA)', downlinkHz: 145800000, uplinkHz: 145990000, type: 'FM Voice / APRS', periodMin: 92.68, nextPassSec: 340, maxEl: 68 },
  { id: 'noaa15', name: 'NOAA-15', downlinkHz: 137620000, uplinkHz: 0, type: 'APT Weather (137M)', periodMin: 101.1, nextPassSec: 810, maxEl: 52 },
  { id: 'noaa18', name: 'NOAA-18', downlinkHz: 137912500, uplinkHz: 0, type: 'APT Weather (137M)', periodMin: 102.0, nextPassSec: 1420, maxEl: 74 },
  { id: 'noaa19', name: 'NOAA-19', downlinkHz: 137100000, uplinkHz: 0, type: 'APT Weather (137M)', periodMin: 102.0, nextPassSec: 2150, maxEl: 44 },
  { id: 'meteor', name: 'METEOR-M2', downlinkHz: 137900000, uplinkHz: 0, type: 'LRPT QPSK HD Weather', periodMin: 101.4, nextPassSec: 3600, maxEl: 81 },
  { id: 'ao91', name: 'AO-91 (RadFxSat)', downlinkHz: 435250000, uplinkHz: 145960000, type: 'FM Voice Repeater', periodMin: 94.2, nextPassSec: 5200, maxEl: 39 },
];

// Sample live FT8 decodes pool
const SAMPLE_FT8 = [
  { call: 'K1HTV', grid: 'FM18', snr: -8, dt: 0.2, msg: 'CQ K1HTV FM18' },
  { call: 'W3LPL', grid: 'FM19', snr: 4, dt: 0.1, msg: 'W3LPL K1RA FM19' },
  { call: 'DL8MAS', grid: 'EM74', snr: -14, dt: -0.3, msg: 'DL8MAS N4OGG R-12' },
  { call: 'JA1ABC', grid: 'PM95', snr: -11, dt: 0.4, msg: 'CQ JA1ABC PM95' },
  { call: 'W6YX', grid: 'CM87', snr: -2, dt: 0.0, msg: 'W6YX K7ABC RR73' },
  { call: 'VK3OE', grid: 'QF22', snr: -16, dt: 0.5, msg: 'VK3OE K1HTV 73' },
  { call: 'ZL1BQD', grid: 'RF73', snr: -19, dt: 0.1, msg: 'CQ ZL1BQD RF73' },
  { call: 'EA4URA', grid: 'IN80', snr: 2, dt: -0.1, msg: 'EA4URA F5IN R+02' }
];

export default function HamRadioDeck({ centerFreq, onTuneFreq }) {
  const [activeHamTab, setActiveHamTab] = useState('digital'); // 'digital' | 'sat' | 'log'
  const [digitalMode, setDigitalMode] = useState('ft8'); // 'ft8' | 'psk' | 'rtty' | 'cw' | 'dmr'
  const [ft8List, setFt8List] = useState([
    { id: 1, time: '03:45:15', snr: 3, dt: 0.1, freqOffset: 1240, msg: 'CQ K1HTV FM18', call: 'K1HTV', grid: 'FM18' },
    { id: 2, time: '03:45:15', snr: -9, dt: 0.2, freqOffset: 1560, msg: 'W3LPL K1RA FM19', call: 'W3LPL', grid: 'FM19' },
    { id: 3, time: '03:45:30', snr: -14, dt: -0.1, freqOffset: 920, msg: 'DL8MAS N4OGG R-12', call: 'DL8MAS', grid: 'EM74' },
    { id: 4, time: '03:45:30', snr: -4, dt: 0.3, freqOffset: 1840, msg: 'JA1ABC W6YX CM87', call: 'JA1ABC', grid: 'PM95' }
  ]);
  const [rttyText, setRttyText] = useState('RYRYRY CQ CQ DE W3LPL W3LPL K RYRYRY CQ DE W3LPL TEST...\n');
  const [pskText, setPskText] = useState('CQ CQ CQ DE K1RA K1RA BT NAME BOB QTH MD HW CPY? AR K...\n');
  const [cwText, setCwText] = useState('CQ CQ CQ DE N4OGG N4OGG 5NN EM74 BK...\n');
  const [selectedSat, setSelectedSat] = useState(SATELLITES[0]);
  const [dopplerOffsetHz, setDopplerOffsetHz] = useState(2450);
  const [logEntries, setLogEntries] = useState([
    { id: 1, date: '2026-10-22', time: '22:15', call: 'K1HTV', freq: '14.074', mode: 'FT8', rstS: '-08', rstR: '+02', grid: 'FM18' },
    { id: 2, date: '2026-10-22', time: '22:31', call: 'W3LPL', freq: '7.074', mode: 'FT8', rstS: '+04', rstR: '-04', grid: 'FM19' }
  ]);

  // Periodic simulated digital decode additions
  useEffect(() => {
    const timer = setInterval(() => {
      // Pick random FT8 decode
      const sample = SAMPLE_FT8[Math.floor(Math.random() * SAMPLE_FT8.length)];
      const now = new Date();
      const timeStr = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}:${String(now.getUTCSeconds()).padStart(2, '0')}`;
      
      setFt8List(prev => [
        {
          id: Date.now(),
          time: timeStr,
          snr: sample.snr + Math.floor(Math.random() * 5 - 2),
          dt: sample.dt,
          freqOffset: Math.floor(400 + Math.random() * 2200),
          msg: sample.msg,
          call: sample.call,
          grid: sample.grid
        },
        ...prev.slice(0, 19)
      ]);

      // Add a bit to RTTY / PSK / CW
      if (Math.random() > 0.6) {
        setRttyText(t => (t.length > 500 ? t.slice(150) : t) + ` ${sample.call} 599 042 `);
      }
      if (Math.random() > 0.6) {
        setPskText(t => (t.length > 500 ? t.slice(150) : t) + ` ${sample.call} RST 599 BTU `);
      }
      if (Math.random() > 0.5) {
        setCwText(t => (t.length > 500 ? t.slice(150) : t) + ` ${sample.call} `);
      }

      // Drift satellite doppler
      setDopplerOffsetHz(prev => {
        const drift = Math.floor(Math.random() * 80 - 40);
        return Math.max(-4500, Math.min(4500, prev + drift));
      });
    }, 4500);

    return () => clearInterval(timer);
  }, []);

  const handleLogContact = (call, grid, freqMhz, mode) => {
    const now = new Date();
    const newEntry = {
      id: Date.now(),
      date: now.toISOString().split('T')[0],
      time: `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`,
      call,
      freq: freqMhz || (centerFreq / 1e6).toFixed(3),
      mode: mode || digitalMode.toUpperCase(),
      rstS: '-05',
      rstR: '-02',
      grid: grid || 'FN20'
    };
    setLogEntries(prev => [newEntry, ...prev]);
  };

  const handleExportAdif = () => {
    let adif = '<ADIF_VERS:5>3.1.4\n<PROGRAMID:22>RocketGod MayhemMobile\n<EOH>\n\n';
    logEntries.forEach(e => {
      adif += `<CALL:${e.call.length}>${e.call} <QSO_DATE:8>${e.date.replace(/-/g, '')} <TIME_ON:4>${e.time.replace(':', '')} <BAND:3>20M <MODE:${e.mode.length}>${e.mode} <RST_SENT:${e.rstS.length}>${e.rstS} <RST_RCVD:${e.rstR.length}>${e.rstR} <GRIDSQUARE:${e.grid.length}>${e.grid} <EOR>\n`;
    });
    const blob = new Blob([adif], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rocketgod_ham_log.adi';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* Top Header Card: Ham Radio Quick Bands & Mode Presets */}
      <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-purple-400" />
            <span className="font-bold text-slate-200">HAM RADIO SUITE (RocketGod Port)</span>
            <span className="text-[10px] text-purple-300 bg-purple-950/80 border border-purple-500/30 px-2 py-0.5 rounded">
              Phasing SSB / Digital / Satellites
            </span>
          </div>
          <div className="text-[11px] text-cyan-300">
            Carrier: <span className="text-white font-bold">{(centerFreq / 1e6).toFixed(4)} MHz</span>
          </div>
        </div>

        {/* Band Selector Bar */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="text-slate-500 text-[10px] uppercase font-bold mr-1">BANDS:</span>
          {HAM_BANDS.map(band => (
            <button
              key={band.name}
              onClick={() => onTuneFreq(band.freqHz)}
              className="px-2.5 py-1 bg-slate-900 hover:bg-purple-900/40 border border-slate-800 hover:border-purple-500/40 rounded text-slate-300 hover:text-white transition whitespace-nowrap text-[11px]"
              title={`${band.desc} (${(band.freqHz / 1e6).toFixed(3)} MHz ${band.mode})`}
            >
              <strong className="text-purple-300">{band.name}</strong> {(band.freqHz / 1e6).toFixed(3)}
            </button>
          ))}
        </div>
      </div>

      {/* Ham Deck Subtabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        {[
          { id: 'digital', name: 'Live Digital Decoders (FT8/PSK/RTTY/CW/DMR)', icon: Activity },
          { id: 'sat', name: 'Satellite Tracking & Doppler', icon: Satellite },
          { id: 'log', name: 'QSO Logbook (ADIF Export)', icon: BookOpen },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeHamTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveHamTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 ${
                isActive
                  ? 'bg-purple-600/30 border border-purple-500/50 text-purple-200 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.name}
            </button>
          );
        })}
      </div>

      {/* Tab 1: Live Digital Mode Decoders */}
      {activeHamTab === 'digital' && (
        <div className="space-y-3">
          {/* Digital Mode Switcher */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold text-[11px] mr-1">PROTOCOL:</span>
              {[
                { id: 'ft8', name: 'FT8 (LDPC)' },
                { id: 'psk', name: 'PSK31' },
                { id: 'rtty', name: 'RTTY 45' },
                { id: 'cw', name: 'CW Morse' },
                { id: 'dmr', name: 'DMR Tier I/II' }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setDigitalMode(m.id)}
                  className={`px-2.5 py-1 rounded transition text-[11px] ${
                    digitalMode === m.id
                      ? 'bg-purple-600 text-white font-bold shadow'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 text-[10px] text-slate-400">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
              <span>Audio Discriminator DSP: <strong className="text-emerald-400">SYNC LOCKED</strong></span>
            </div>
          </div>

          {/* Mode View: FT8 */}
          {digitalMode === 'ft8' && (
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-[10px] pb-1 border-b border-slate-800">
                <span className="w-16">TIME (UTC)</span>
                <span className="w-12 text-center">SNR (dB)</span>
                <span className="w-12 text-center">DT (s)</span>
                <span className="w-16 text-center">AUDIO DF</span>
                <span className="flex-1 px-3">FT8 DECODED MESSAGE (Costas Sync / LDPC-174)</span>
                <span className="w-16 text-right">ACTION</span>
              </div>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                {ft8List.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-1 px-1.5 rounded hover:bg-slate-900 text-[11px] transition font-mono border-b border-slate-900/60"
                  >
                    <span className="w-16 text-slate-400 text-[10px]">{item.time}</span>
                    <span className={`w-12 text-center font-bold ${item.snr >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {item.snr > 0 ? `+${item.snr}` : item.snr}
                    </span>
                    <span className="w-12 text-center text-slate-400">{item.dt}</span>
                    <span className="w-16 text-center text-cyan-400 font-semibold">{item.freqOffset} Hz</span>
                    <span className="flex-1 px-3 text-slate-200 truncate">
                      <strong className="text-purple-300">{item.call}</strong>: {item.msg}
                    </span>
                    <button
                      onClick={() => handleLogContact(item.call, item.grid, (centerFreq / 1e6).toFixed(3), 'FT8')}
                      className="px-2 py-0.5 bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 rounded text-[10px] transition flex items-center gap-1"
                      title="Log contact to Ham Logbook"
                    >
                      <PlusCircle className="w-3 h-3" /> Log
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Mode View: PSK31 / RTTY / CW text streaming */}
          {(digitalMode === 'psk' || digitalMode === 'rtty' || digitalMode === 'cw') && (
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-[11px]">
                <span>STREAMING TEXT TERMINAL ({digitalMode.toUpperCase()})</span>
                <span className="text-[10px] text-emerald-400">Varicode Demodulator: 31.25 Baud</span>
              </div>
              <div className="bg-black/80 border border-slate-800 rounded p-3 font-mono text-emerald-400 h-44 overflow-y-auto whitespace-pre-wrap leading-relaxed shadow-inner">
                {digitalMode === 'psk' && pskText}
                {digitalMode === 'rtty' && rttyText}
                {digitalMode === 'cw' && cwText}
              </div>
            </div>
          )}

          {/* Mode View: DMR */}
          {digitalMode === 'dmr' && (
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-3">
              <div className="flex items-center justify-between text-slate-400">
                <span className="font-bold text-slate-200">DMR TIER II DIGITAL VOICE DECODER</span>
                <span className="text-xs px-2 py-0.5 bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 rounded">
                  AMBE+2 DSP SYNTHESIZER
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">TIMESLOT 1</div>
                  <div className="text-sm font-bold text-purple-300">TG 91 (Worldwide)</div>
                  <div className="text-[11px] text-slate-300">Caller: <span className="text-emerald-400 font-bold">K1HTV</span> (ID: 3108221)</div>
                  <div className="text-[10px] text-slate-500">Color Code: CC1 • 4FSK 9600 bps</div>
                </div>
                <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-1">
                  <div className="text-[10px] text-slate-400 font-bold uppercase">TIMESLOT 2</div>
                  <div className="text-sm font-bold text-cyan-300">TG 3100 (USA National)</div>
                  <div className="text-[11px] text-slate-300">Caller: <span className="text-amber-400 font-bold">W3LPL</span> (ID: 3124509)</div>
                  <div className="text-[10px] text-slate-500">Color Code: CC1 • 4FSK 9600 bps</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Satellite Tracking & Doppler */}
      {activeHamTab === 'sat' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Sat Selector */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3 space-y-2">
              <span className="text-slate-400 font-bold block mb-1">SELECT SATELLITE (SGP4 PROPAGATOR)</span>
              <div className="space-y-1.5 max-h-56 overflow-y-auto">
                {SATELLITES.map(sat => (
                  <div
                    key={sat.id}
                    onClick={() => setSelectedSat(sat)}
                    className={`p-2.5 rounded-lg border cursor-pointer transition flex items-center justify-between ${
                      selectedSat.id === sat.id
                        ? 'bg-purple-950/60 border-purple-500/60 text-white'
                        : 'bg-slate-900/60 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="font-bold flex items-center gap-1.5">
                        <Satellite className="w-3.5 h-3.5 text-purple-400" />
                        <span>{sat.name}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">{sat.type}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[11px] text-cyan-300 font-bold">
                        {(sat.downlinkHz / 1e6).toFixed(4)} MHz
                      </div>
                      <div className="text-[10px] text-slate-400">Next pass: {Math.floor(sat.nextPassSec / 60)}m</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Satellite Live Radar & Doppler Calculator */}
            <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-2 border-b border-slate-800 mb-2">
                  <span className="font-bold text-purple-300">{selectedSat.name} LIVE PASS METRICS</span>
                  <span className="text-[10px] px-2 py-0.5 bg-emerald-950 border border-emerald-500/30 text-emerald-300 rounded">
                    ACQUISITION OF SIGNAL (AOS)
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">CURRENT ELEVATION</span>
                    <span className="text-white font-bold text-sm">48.2° (Rising)</span>
                  </div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">AZIMUTH BEARING</span>
                    <span className="text-white font-bold text-sm">214° SW</span>
                  </div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">NOMINAL DOWNLINK</span>
                    <span className="text-cyan-300 font-bold">{(selectedSat.downlinkHz / 1e6).toFixed(4)} MHz</span>
                  </div>
                  <div className="p-2 bg-slate-900 rounded border border-slate-800">
                    <span className="text-slate-500 block text-[10px]">LIVE DOPPLER SHIFT</span>
                    <span className={`font-bold ${dopplerOffsetHz >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {dopplerOffsetHz >= 0 ? `+${dopplerOffsetHz}` : dopplerOffsetHz} Hz
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onTuneFreq(selectedSat.downlinkHz + dopplerOffsetHz)}
                className="w-full py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition flex items-center justify-center gap-2 shadow-lg shadow-purple-600/30"
              >
                <ArrowUpRight className="w-4 h-4" />
                Tune HackRF to Doppler Frequency ({((selectedSat.downlinkHz + dopplerOffsetHz) / 1e6).toFixed(4)} MHz)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: QSO Logbook */}
      {activeHamTab === 'log' && (
        <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div>
              <span className="font-bold text-slate-200">ELECTRONIC LOGBOOK (ADIF COMPATIBLE)</span>
              <span className="text-[10px] text-slate-400 block">Total Contacts: {logEntries.length} QSOs</span>
            </div>
            <button
              onClick={handleExportAdif}
              className="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-lg text-xs font-mono transition flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Export ADIF (.adi)
            </button>
          </div>

          <div className="space-y-1 max-h-56 overflow-y-auto">
            {logEntries.map(e => (
              <div
                key={e.id}
                className="flex items-center justify-between p-2 rounded bg-slate-900/60 border border-slate-800 text-[11px]"
              >
                <span className="w-24 text-slate-400 text-[10px]">{e.date} {e.time}z</span>
                <span className="font-bold text-purple-300 w-20">{e.call}</span>
                <span className="text-cyan-300 w-20">{e.freq} MHz</span>
                <span className="text-slate-300 w-16">{e.mode}</span>
                <span className="text-slate-400 w-20">Sent: {e.rstS}</span>
                <span className="text-slate-400 w-20">Rcvd: {e.rstR}</span>
                <span className="text-emerald-400 font-mono w-16 text-right">{e.grid}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
