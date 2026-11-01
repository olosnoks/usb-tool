import React, { useState, useEffect, useRef } from 'react';
import { Thermometer, Download, Play, Square, Monitor } from 'lucide-react';
import { SENSOR_DRIVERS, detectSensor, ssd1306Fill } from '../../../utils/sensorDrivers';
import { identifyChip } from '../../../utils/ch341aDriver';

const fmt = (v, digits = 2) => (typeof v === 'number' ? v.toFixed(digits) : String(v));
const hex2 = (a) => `0x${a.toString(16).toUpperCase().padStart(2, '0')}`;
const btn = 'flex items-center gap-1 px-2.5 py-1 rounded border font-bold text-xs disabled:opacity-40';

/**
 * Live sensor readouts for the selected I2C address and an SPI flash dumper,
 * both through the Bus Explorer client. `guard(label, fn)` runs one job at a time.
 */
export default function SensorFlashPanels({ client, isConnected, selectedAddr, guard, busy }) {
  const [driverId, setDriverId] = useState(null);
  const [readings, setReadings] = useState(null);
  const [live, setLive] = useState(false);
  const [flashChip, setFlashChip] = useState(null);
  const [flashLen, setFlashLen] = useState('65536');
  const [flashProgress, setFlashProgress] = useState(null);
  const [dump, setDump] = useState(null);
  const liveRef = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => { setDriverId(null); setReadings(null); setLive(false); }, [selectedAddr, isConnected]);

  const detect = () => guard('detect', async () => {
    const id = await detectSensor(client.sensorBus(), selectedAddr);
    setDriverId(id);
    if (!id) throw new Error(`No built-in driver recognises ${hex2(selectedAddr)}. Use the register view instead.`);
  });

  const readOnce = async () => {
    const d = SENSOR_DRIVERS[driverId];
    if (!d?.read) return false;
    setReadings(await d.read(client.sensorBus(), selectedAddr));
    return true;
  };

  useEffect(() => {
    liveRef.current = live;
    if (!live) return undefined;
    let timer = null;
    const tick = async () => {
      if (!liveRef.current) return;
      // Skip this tick if another Bus Pirate job is running; never interleave on the link.
      if (!busyRef.current) {
        const ok = await guard('sensor', readOnce);
        if (ok !== true) { setLive(false); return; }
      }
      timer = setTimeout(tick, 1000);
    };
    tick();
    return () => { liveRef.current = false; clearTimeout(timer); };
  }, [live, driverId]);

  const readFlashId = () => guard('flash-id', async () => {
    const id = await client.spiFlashId();
    if (id === 0xffffff || id === 0) throw new Error('No SPI flash answered (ID FF FF FF). Check MISO/MOSI/CLK/CS and power.');
    const c = identifyChip(id);
    setFlashChip(c);
    if (c.sizeBytes) setFlashLen(String(c.sizeBytes));
  });

  const dumpFlash = () => guard('flash-read', async () => {
    const len = Number(flashLen);
    if (!len || len < 1) throw new Error('Enter how many bytes to read.');
    setFlashProgress(0);
    const t0 = performance.now();
    try {
      const data = await client.spiFlashRead(0, len, setFlashProgress);
      setDump({ data, seconds: (performance.now() - t0) / 1000 });
    } finally {
      setFlashProgress(null);
    }
  });

  const save = () => {
    const url = URL.createObjectURL(new Blob([dump.data]));
    const a = document.createElement('a');
    a.href = url;
    a.download = `spi-flash-${flashChip?.model?.replace(/\W+/g, '_') || 'dump'}.bin`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const driver = driverId ? SENSOR_DRIVERS[driverId] : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 flex items-center gap-1.5"><Thermometer className="w-3.5 h-3.5 text-emerald-400" /> SENSOR READOUT ({hex2(selectedAddr)})</span>
          {driver && <span className="text-emerald-300">{driver.label}</span>}
        </div>
        <p className="text-slate-500">Built-in drivers: BME280/BMP280, MPU-6050 family, DS3231, ADS1115, INA219, SSD1306.</p>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={detect} disabled={!isConnected || !!busy} className={`${btn} border-slate-700 text-slate-200`}>IDENTIFY</button>
          {driver?.read && (
            <>
              <button onClick={() => guard('sensor', readOnce)} disabled={!!busy} className={`${btn} border-emerald-500/40 text-emerald-300`}>READ</button>
              <button onClick={() => setLive((v) => !v)} className={`${btn} ${live ? 'border-amber-500/50 text-amber-300' : 'border-slate-700 text-slate-200'}`}>
                {live ? <><Square className="w-3 h-3" /> STOP</> : <><Play className="w-3 h-3" /> LIVE (1 s)</>}
              </button>
            </>
          )}
          {driverId === 'ssd1306' && ['checker', 'full', 'clear'].map((p) => (
            <button key={p} onClick={() => guard('oled', () => ssd1306Fill(client.sensorBus(), selectedAddr, p))} disabled={!!busy} className={`${btn} border-cyan-500/40 text-cyan-300`}>
              <Monitor className="w-3 h-3" /> {p.toUpperCase()}
            </button>
          ))}
        </div>
        {readings && (
          <div className="grid grid-cols-2 gap-1.5">
            {readings.map((r) => (
              <div key={r.name} className="bg-slate-950 border border-slate-800 rounded p-2">
                <div className="text-[10px] text-slate-500 font-bold uppercase">{r.name}</div>
                <div className="text-emerald-300 font-bold text-sm">{fmt(r.value, r.digits)} <span className="text-slate-500 text-[10px]">{r.unit}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-2">
        <div className="flex items-center justify-between pb-2 border-b border-slate-800">
          <span className="font-bold text-slate-200 flex items-center gap-1.5"><Download className="w-3.5 h-3.5 text-amber-400" /> SPI FLASH DUMP</span>
          {flashChip && <span className="text-amber-300">{flashChip.manufacturer} {flashChip.model}</span>}
        </div>
        <p className="text-slate-500">Reads a 25-series flash through the Bus Pirate (CS, CLK, MOSI, MISO, 3.3 V). Expect roughly 10-20 KB/s over the serial link; a CH341A is much faster for big chips.</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={readFlashId} disabled={!isConnected || !!busy} className={`${btn} border-slate-700 text-slate-200`}>READ JEDEC ID</button>
          <span className="text-slate-500">bytes</span>
          <input value={flashLen} onChange={(e) => setFlashLen(e.target.value)} className="w-28 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-slate-200" />
          <button onClick={dumpFlash} disabled={!isConnected || !!busy} className={`${btn} border-amber-500/40 text-amber-300`}><Download className="w-3 h-3" /> DUMP</button>
          {dump && <button onClick={save} className={`${btn} border-emerald-500/40 text-emerald-300`}>SAVE .BIN</button>}
        </div>
        {flashProgress !== null && (
          <div className="h-1.5 bg-slate-900 rounded"><div className="h-1.5 bg-amber-400 rounded" style={{ width: `${Math.round(flashProgress * 100)}%` }} /></div>
        )}
        {dump && (
          <div className="text-slate-400">
            Read {dump.data.length.toLocaleString()} bytes in {dump.seconds.toFixed(1)} s · first bytes:{' '}
            <span className="text-cyan-300">{Array.from(dump.data.subarray(0, 16)).map((b) => b.toString(16).padStart(2, '0')).join(' ')}</span>
          </div>
        )}
      </div>
    </div>
  );
}
