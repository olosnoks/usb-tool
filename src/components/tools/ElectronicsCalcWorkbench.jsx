import React, { useState } from 'react';
import { Calculator } from 'lucide-react';
import {
  parseSI, formatSI, formatDuration, STD_BAUDS, I2C_MODES, RESISTOR_COLOURS, E_SERIES_NAMES,
  uartAvr, uartStm32, uartEsp32, uartGeneric, uartBaudTable,
  i2cPullup, solveDivider, dividerPairs, ledResistor, decodeResistor, encodeResistor,
  nearestESeries, seriesTotal, parallelTotal, resistorCombos,
  rcTimeConstant, chargeTimeToPercent, lcResonance, rlcSeries,
  batteryLife, traceWidth, traceCurrent, traceTempRise, solveOhm,
  adcLsb, voltageToCode, codeToVoltage, dividerAdcVoltage, dividerFullScaleInput,
  timer555Astable, timer555Monostable, timer555Design, REGULATOR_PRESETS, regulatorVout, regulatorPairs,
  capReactance, indReactance, seriesImpedance, dividerTolerance,
} from '../../utils/electronicsCalc.js';

/**
 * Electronics calculators: UART baud error, I2C pull-ups, resistors (divider, LED, colour
 * code, E-series, combos), RC/RLC, battery life, PCB trace width + Ohm's law, and ADC.
 * Everything is computed locally from the numbers you type. Nothing is read from hardware.
 * Values accept SI suffixes: 4.7k, 100n, 10u, 2M2, 1e3.
 */

const TABS = [
  ['uart', 'UART baud'],
  ['i2c', 'I2C pull-up'],
  ['res', 'Resistors'],
  ['rc', 'RC / RLC'],
  ['tim', '555 / Reg'],
  ['batt', 'Battery'],
  ['pcb', 'PCB & Ohm'],
  ['adc', 'ADC'],
];

const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono text-gray-200 w-full focus:outline-none focus:border-amber-600';
const btnCls = 'px-2.5 py-1 rounded text-xs border border-slate-700 text-slate-300 hover:border-amber-600 hover:text-amber-300';
const TONE = { ok: 'text-emerald-400', marginal: 'text-amber-400', bad: 'text-rose-400' };
const TONE_BG = { ok: 'bg-emerald-950/40 border-emerald-800 text-emerald-300', marginal: 'bg-amber-950/40 border-amber-800 text-amber-300', bad: 'bg-rose-950/40 border-rose-800 text-rose-300' };

/** Run a calculation; return { v } or { err } so a bad input shows a message instead of throwing. */
function calc(fn) {
  try { return { v: fn() }; } catch (e) { return { err: e.message }; }
}

/** Throw a readable error for any blank/invalid number. pairs = [[label, number], ...] */
function need(pairs) {
  for (const [label, n] of pairs) {
    if (!Number.isFinite(n)) throw new Error(`Enter a valid value for ${label}.`);
  }
}

/** Blank string -> null (optional input); otherwise parsed SI value (NaN if unreadable). */
function optional(s) {
  return String(s ?? '').trim() === '' ? null : parseSI(s);
}

function Field({ label, value, onChange, hint, placeholder, disabled = false }) {
  return (
    <label className={`flex flex-col gap-0.5 text-[11px] min-w-0 ${disabled ? 'text-slate-700' : 'text-slate-400'}`}>
      <span>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} className={`${inputCls} disabled:opacity-40`} spellCheck={false} />
      {hint && <span className="text-[10px] text-slate-600">{hint}</span>}
    </label>
  );
}

function Pick({ label, value, onChange, options }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-slate-400 min-w-0">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

function Card({ title, formula, children }) {
  return (
    <section className="bg-slate-950 border border-slate-800 rounded p-2.5 space-y-2">
      <header>
        <h3 className="text-xs font-semibold text-amber-300 uppercase tracking-wide">{title}</h3>
        {formula && <p className="text-[10px] text-slate-500 font-mono mt-0.5">{formula}</p>}
      </header>
      {children}
    </section>
  );
}

function Grid({ children, cols = '@md:grid-cols-3' }) {
  return <div className={`grid grid-cols-1 gap-2 ${cols}`}>{children}</div>;
}

function Out({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 border-b border-slate-900 last:border-0">
      <span className="text-slate-500 text-xs">{label}</span>
      <span className={`font-mono text-xs break-all text-right ${tone ? TONE[tone] : 'text-gray-200'}`}>{value}</span>
    </div>
  );
}

function Notice({ tone = 'bad', children }) {
  return <div className={`text-xs border rounded px-2 py-1.5 ${TONE_BG[tone] ?? TONE_BG.bad}`}>{children}</div>;
}

function Warn({ children }) {
  return <div className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-900 rounded px-2 py-1">{children}</div>;
}

function Result({ r, children }) {
  if (!r) return null;
  if (r.err) return <Notice tone="bad">{r.err}</Notice>;
  return <div>{children(r.v)}</div>;
}

function SubTabs({ value, onChange, items }) {
  return (
    <div className="flex flex-wrap gap-1">
      {items.map(([id, label]) => (
        <button key={id} onClick={() => onChange(id)} className={`px-2 py-1 rounded text-xs border ${value === id ? 'border-amber-600 bg-amber-950/40 text-amber-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}>{label}</button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. UART baud
// ---------------------------------------------------------------------------

function StatusCell({ cell }) {
  if (!cell) return <span className="text-slate-600">n/a</span>;
  return <span className={`font-mono ${TONE[cell.status]}`}>{`${cell.errorPct >= 0 ? '+' : ''}${cell.errorPct.toFixed(2)}%`}</span>;
}

function UartTab() {
  const [clock, setClock] = useState('16M');
  const [baud, setBaud] = useState('115200');
  const [esp, setEsp] = useState('80M');
  const [stmOver, setStmOver] = useState('16');
  const [genOver, setGenOver] = useState('16');
  const fcpu = parseSI(clock);
  const b = parseSI(baud);
  const espClk = parseSI(esp);
  const ok = Number.isFinite(fcpu) && fcpu > 0 && Number.isFinite(b) && b > 0;

  const r = ok ? {
    avrN: uartAvr({ fosc: fcpu, baud: b }),
    avrU: uartAvr({ fosc: fcpu, baud: b, u2x: true }),
    stm: uartStm32({ fck: fcpu, baud: b, oversample: Number(stmOver) }),
    esp: Number.isFinite(espClk) && espClk > 0 ? uartEsp32({ clockHz: espClk, baud: b }) : null,
    gen: uartGeneric({ fclk: fcpu, baud: b, oversample: Number(genOver) }),
  } : null;

  const table = ok ? uartBaudTable({ fcpu, esp32Clock: Number.isFinite(espClk) ? espClk : 80e6 }) : [];

  const exportCsv = () => {
    const head = 'baud,avr_normal_pct,avr_u2x_pct,stm32_pct,esp32_pct';
    const rows = table.map((t) => [t.baud, ...['avrNormal', 'avrU2x', 'stm32', 'esp32'].map((k) => (t[k] ? t[k].errorPct.toFixed(3) : ''))].join(','));
    navigator.clipboard?.writeText([head, ...rows].join('\n'));
  };

  const Method = ({ title, sub, res, extraLabel, extra }) => (
    <div className="bg-slate-900/60 border border-slate-800 rounded p-2 space-y-1">
      <div className="text-[11px] text-slate-300 font-semibold">{title}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
      {!res && <div className="text-[11px] text-slate-600">Needs a valid clock and baud.</div>}
      {res && !res.ok && <Notice tone="bad">{res.reason}</Notice>}
      {res && res.ok && (
        <>
          <Out label={extraLabel} value={extra(res)} />
          <Out label="Actual baud" value={Math.round(res.actualBaud).toLocaleString()} />
          <Out label="Error" value={`${res.errorPct >= 0 ? '+' : ''}${res.errorPct.toFixed(3)} %`} tone={res.status} />
          <div className={`text-[10px] px-1.5 py-0.5 rounded inline-block border ${TONE_BG[res.status]}`}>{res.status === 'ok' ? 'OK (within ±2 %)' : res.status === 'marginal' ? 'Marginal (±2 to ±3.5 %)' : 'Bad (beyond ±3.5 %)'}</div>
        </>
      )}
    </div>
  );

  return (
    <div className="space-y-2">
      <Card title="Inputs" formula="Error = (actual − target) / target. Limits: ±2 % ok, ±3.5 % marginal.">
        <Grid cols="@md:grid-cols-3">
          <Field label="MCU clock (Hz)" value={clock} onChange={setClock} hint="e.g. 16M, 8M, 72M" />
          <Field label="Target baud" value={baud} onChange={setBaud} hint="e.g. 115200" />
          <Field label="ESP32 APB clock (Hz)" value={esp} onChange={setEsp} hint="default 80M" />
          <Pick label="STM32 oversampling" value={stmOver} onChange={setStmOver} options={[['16', '16x (OVER8=0)'], ['8', '8x (OVER8=1)']]} />
          <Pick label="Generic oversampling" value={genOver} onChange={setGenOver} options={[['16', '16x'], ['8', '8x'], ['4', '4x'], ['1', '1x']]} />
        </Grid>
        {!ok && <Notice tone="marginal">Enter a clock and a baud rate (SI suffixes allowed).</Notice>}
      </Card>

      {r && (
        <Card title="Results" formula="AVR: UBRR = fosc/(16·baud) − 1 (U2X: /8). STM32: BRR = mantissa<<4 | fraction. ESP32: CLKDIV + FRAG/16.">
          <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
            <Method title="AVR USART, normal" sub="UBRRn = fosc/(16·baud) − 1" res={r.avrN} extraLabel="UBRR" extra={(x) => x.ubrr} />
            <Method title="AVR USART, U2X" sub="UBRRn = fosc/(8·baud) − 1" res={r.avrU} extraLabel="UBRR" extra={(x) => x.ubrr} />
            <Method title={`STM32 USART (${stmOver}x)`} sub="USARTDIV = fck/(oversample·baud); BRR holds mantissa and fraction" res={r.stm} extraLabel="BRR (hex)" extra={(x) => `0x${x.brr.toString(16).toUpperCase()} (${x.mantissa} + ${x.fraction}/${x.oversample})`} />
            <Method title="ESP32 UART" sub="APB clock divided by CLKDIV + FRAG/16" res={r.esp} extraLabel="CLKDIV + FRAG/16" extra={(x) => `${x.clkdiv} + ${x.frag}/16`} />
            <Method title={`Generic integer divider (${genOver}x)`} sub="divider = round(fclk / (oversample·baud))" res={r.gen} extraLabel="Divider" extra={(x) => x.divider} />
          </div>
        </Card>
      )}

      {ok && (
        <Card title="Standard bauds" formula="Each cell is the error for that method at the MCU clock above. n/a = divider out of range.">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="text-slate-500 text-left">
                  <th className="py-1 pr-3 font-normal">Baud</th>
                  <th className="py-1 pr-3 font-normal">AVR</th>
                  <th className="py-1 pr-3 font-normal">AVR U2X</th>
                  <th className="py-1 pr-3 font-normal">STM32 {stmOver}x</th>
                  <th className="py-1 pr-3 font-normal">ESP32</th>
                </tr>
              </thead>
              <tbody>
                {table.map((t) => (
                  <tr key={t.baud} className="border-t border-slate-900">
                    <td className="py-1 pr-3 text-gray-300">{t.baud}</td>
                    <td className="py-1 pr-3"><StatusCell cell={t.avrNormal} /></td>
                    <td className="py-1 pr-3"><StatusCell cell={t.avrU2x} /></td>
                    <td className="py-1 pr-3"><StatusCell cell={t.stm32} /></td>
                    <td className="py-1 pr-3"><StatusCell cell={t.esp32} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={exportCsv} className={btnCls}>Copy table as CSV</button>
          <p className="text-[10px] text-slate-600">STM32 and AVR use the MCU clock above; ESP32 uses its APB clock. The table lists {STD_BAUDS.length} standard rates.</p>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. I2C pull-up
// ---------------------------------------------------------------------------

function I2cTab() {
  const [vdd, setVdd] = useState('3.3');
  const [cb, setCb] = useState('100p');
  const [mode, setMode] = useState('400k');
  const [vol, setVol] = useState('');
  const [iol, setIol] = useState('');
  const m = I2C_MODES[mode];
  const r = calc(() => {
    const v = parseSI(vdd); const c = parseSI(cb);
    need([['Vdd', v], ['bus capacitance Cb', c]]);
    if (v <= 0 || c <= 0) throw new Error('Vdd and Cb must be positive.');
    const volV = optional(vol); const iolA = optional(iol);
    if (volV !== null && !Number.isFinite(volV)) throw new Error('VOL is not a valid number.');
    if (iolA !== null && !Number.isFinite(iolA)) throw new Error('IOL is not a valid number.');
    return i2cPullup({ vdd: v, cb: c, mode, vol: volV ?? undefined, iol: iolA ?? undefined });
  });
  return (
    <div className="space-y-2">
      <Card title="Pull-up window" formula="Rp min = (Vdd − VOL) / IOL     Rp max = tr / (0.8473 · Cb)     (NXP UM10204)">
        <Grid cols="@md:grid-cols-2 @lg:grid-cols-5">
          <Field label="Vdd (V)" value={vdd} onChange={setVdd} />
          <Field label="Bus capacitance Cb (F)" value={cb} onChange={setCb} hint="e.g. 100p" />
          <Pick label="Mode" value={mode} onChange={setMode} options={Object.entries(I2C_MODES).map(([k, x]) => [k, x.label])} />
          <Field label="VOL override (V)" value={vol} onChange={setVol} placeholder={`${m.vol}`} hint="blank = spec default" />
          <Field label="IOL override (A)" value={iol} onChange={setIol} placeholder={formatSI(m.iol, 'A')} hint="blank = spec default" />
        </Grid>
        <p className="text-[10px] text-slate-500">Spec limits for {m.label}: tr max {formatSI(m.tr, 's')}, Cb max {formatSI(m.cbMax, 'F')}, IOL {formatSI(m.iol, 'A')}, VOL {m.vol} V.</p>
      </Card>
      <Result r={r}>{(v) => (
        <Card title="Result">
          <Out label="Rp min (sink current limit)" value={`${formatSI(v.rpMin, 'Ω')}  (${v.rpMin.toFixed(0)} Ω)`} />
          <Out label="Rp max (rise time limit)" value={`${formatSI(v.rpMax, 'Ω')}  (${v.rpMax.toFixed(0)} Ω)`} />
          <Out label="Window" value={v.feasible ? 'Feasible' : 'Not feasible'} tone={v.feasible ? 'ok' : 'bad'} />
          <Out label="Recommended E24 value" value={v.recommended ? formatSI(v.recommended, 'Ω') : '—'} tone={v.recommended ? 'ok' : 'marginal'} />
          {v.warnings.map((w) => <Warn key={w}>{w}</Warn>)}
        </Card>
      )}</Result>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Resistors (divider, LED, colour code, E-series, combos)
// ---------------------------------------------------------------------------

function DividerPart() {
  const [vin, setVin] = useState('5');
  const [r1, setR1] = useState('10k');
  const [r2, setR2] = useState('');
  const [vout, setVout] = useState('');
  const [series, setSeries] = useState('E24');
  const blanks = [r1, r2, vout, vin].filter((x) => String(x).trim() === '').length;
  const r = blanks === 1 ? calc(() => {
    const parts = { vin: optional(vin), r1: optional(r1), r2: optional(r2), vout: optional(vout) };
    return solveDivider(parts);
  }) : null;
  const [tolPct, setTolPct] = useState('1');
  const tolRes = blanks === 0 ? calc(() => {
    const t = parseSI(tolPct);
    need([['tolerance', t]]);
    return dividerTolerance({ vin: parseSI(vin), r1: parseSI(r1), r2: parseSI(r2), tolPct: t });
  }) : null;
  const pairsWanted = String(r1).trim() === '' && String(r2).trim() === '' && String(vout).trim() !== '' && String(vin).trim() !== '';
  const pairs = pairsWanted ? calc(() => {
    const vi = parseSI(vin); const vo = parseSI(vout);
    need([['Vin', vi], ['Vout', vo]]);
    return dividerPairs({ vin: vi, vout: vo, series, count: 8 });
  }) : null;
  return (
    <Card title="Voltage divider" formula="Vout = Vin · R2 / (R1 + R2). R1 on top, R2 to ground. Leave exactly one field blank to solve it.">
      <Grid cols="@md:grid-cols-4">
        <Field label="Vin (V)" value={vin} onChange={setVin} />
        <Field label="R1 (top, Ω)" value={r1} onChange={setR1} />
        <Field label="R2 (bottom, Ω)" value={r2} onChange={setR2} />
        <Field label="Vout (V)" value={vout} onChange={setVout} />
      </Grid>
      {blanks === 1 && r && (r.err ? <Notice tone="bad">{r.err}</Notice> : (
        <div>
          <Out label="Vin" value={formatSI(r.v.vin, 'V')} />
          <Out label="R1" value={formatSI(r.v.r1, 'Ω')} />
          <Out label="R2" value={formatSI(r.v.r2, 'Ω')} />
          <Out label="Vout" value={`${r.v.vout.toPrecision(4)} V (ratio ${r.v.ratio.toFixed(4)})`} />
        </div>
      ))}
      {blanks === 0 && (
        <div className="space-y-1">
          <Notice tone="marginal">All four boxes are filled. Clear one to solve it, or use the worst-case check below on Vin, R1 and R2.</Notice>
          <div className="max-w-[10rem]"><Field label="Resistor tolerance (%)" value={tolPct} onChange={setTolPct} /></div>
          <Result r={tolRes}>{(v) => (
            <div>
              <Out label="Nominal Vout" value={formatSI(v.nominal, 'V')} />
              <Out label="Worst-case low" value={`${formatSI(v.min, 'V')} (${v.minPct.toFixed(2)} %)`} tone="marginal" />
              <Out label="Worst-case high" value={`${formatSI(v.max, 'V')} (+${v.maxPct.toFixed(2)} %)`} tone="marginal" />
            </div>
          )}</Result>
        </div>
      )}
      {blanks === 2 && pairsWanted && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Pick label="Series" value={series} onChange={setSeries} options={E_SERIES_NAMES.slice(0, 4).map((s) => [s, s])} />
          </div>
          <Result r={pairs}>{(list) => (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead><tr className="text-slate-500 text-left"><th className="py-1 pr-3 font-normal">R1</th><th className="py-1 pr-3 font-normal">R2</th><th className="py-1 pr-3 font-normal">Vout</th><th className="py-1 font-normal">Error</th></tr></thead>
                <tbody>{list.map((p) => (
                  <tr key={`${p.r1}/${p.r2}`} className="border-t border-slate-900">
                    <td className="py-1 pr-3">{formatSI(p.r1, 'Ω')}</td>
                    <td className="py-1 pr-3">{formatSI(p.r2, 'Ω')}</td>
                    <td className="py-1 pr-3">{p.vout.toFixed(4)} V</td>
                    <td className={`py-1 ${Math.abs(p.errorPct) <= 1 ? 'text-emerald-400' : 'text-amber-400'}`}>{`${p.errorPct >= 0 ? '+' : ''}${p.errorPct.toFixed(2)} %`}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}</Result>
        </div>
      )}
      {blanks !== 1 && blanks !== 0 && !pairsWanted && <Notice tone="marginal">Leave exactly one of R1, R2, Vout, Vin blank to solve it, or leave both R1 and R2 blank to search E-series pairs for Vin and Vout.</Notice>}
    </Card>
  );
}

function LedPart() {
  const [vs, setVs] = useState('5');
  const [vf, setVf] = useState('2.0');
  const [ma, setMa] = useState('20m');
  const [series, setSeries] = useState('E24');
  const r = calc(() => {
    const s = parseSI(vs); const f = parseSI(vf); const i = parseSI(ma);
    need([['supply Vs', s], ['LED Vf', f], ['LED current', i]]);
    return ledResistor({ vs: s, vf: f, currentA: i, series });
  });
  return (
    <Card title="LED series resistor" formula="R = (Vs − Vf) / I, rounded up to a standard value. P = I²·R.">
      <Grid cols="@md:grid-cols-4">
        <Field label="Supply Vs (V)" value={vs} onChange={setVs} />
        <Field label="LED Vf (V)" value={vf} onChange={setVf} />
        <Field label="Current (A)" value={ma} onChange={setMa} hint="20m = 20 mA" />
        <Pick label="Series" value={series} onChange={setSeries} options={E_SERIES_NAMES.slice(0, 4).map((x) => [x, x])} />
      </Grid>
      <Result r={r}>{(v) => (
        <div>
          <Out label="Ideal R" value={formatSI(v.rIdeal, 'Ω')} />
          <Out label="Standard R (rounded up)" value={formatSI(v.rStd, 'Ω')} tone="ok" />
          <Out label="Actual current" value={formatSI(v.iActual, 'A')} />
          <Out label="Resistor dissipation" value={formatSI(v.power, 'W')} />
          <Out label="Suggested power rating (2× margin)" value={v.recommendedWatt ? `${v.recommendedWatt} W` : 'above 5 W, use a power resistor'} />
        </div>
      )}</Result>
    </Card>
  );
}

function ColourPart() {
  const [bands, setBands] = useState(4);
  const [colours, setColours] = useState(['yellow', 'violet', 'red', 'gold', 'brown', 'red']);
  const [ohmsText, setOhmsText] = useState('4.7k');
  const [encBands, setEncBands] = useState(4);
  const [tol, setTol] = useState('5');
  const setBandColour = (i, v) => setColours((cs) => cs.map((c, j) => (j === i ? v : c)));
  const colourOpts = RESISTOR_COLOURS.map((c) => [c, c]);
  const dec = calc(() => decodeResistor(colours.slice(0, bands)));
  const digitBands = bands === 4 ? 2 : 3;
  const enc = calc(() => {
    const o = parseSI(ohmsText);
    need([['resistance', o]]);
    const tolerancePct = Number(tol);
    return encodeResistor({ ohms: o, bands: encBands, tolerancePct, tempco: 100 });
  });
  return (
    <Card title="Colour code" formula="4 bands: d d × 10^x tol.  5 bands: d d d × 10^x tol.  6 bands: + tempco (ppm/K).">
      <div className="flex flex-wrap gap-2 items-end">
        <Pick label="Bands to decode" value={String(bands)} onChange={(v) => setBands(Number(v))} options={[['4', '4'], ['5', '5'], ['6', '6']]} />
        {Array.from({ length: bands }).map((_, i) => (
          <Pick
            key={`${bands}-${i}`}
            label={i < digitBands ? `Digit ${i + 1}` : i === digitBands ? 'Multiplier' : i === digitBands + 1 ? 'Tolerance' : 'Tempco'}
            value={colours[i]}
            onChange={(v) => setBandColour(i, v)}
            options={i === digitBands ? colourOpts : colourOpts.filter(([c]) => !['gold', 'silver'].includes(c) || i > digitBands)}
          />
        ))}
      </div>
      <Result r={dec}>{(v) => (
        <div>
          <Out label="Decoded" value={`${formatSI(v.ohms, 'Ω')}  (${v.ohms} Ω)`} tone="ok" />
          <Out label="Tolerance" value={`±${v.tolerancePct} %`} />
          {v.tempco !== null && <Out label="Tempco" value={`${v.tempco} ppm/K`} />}
        </div>
      )}</Result>
      <div className="border-t border-slate-900 pt-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-end">
          <Field label="Encode resistance" value={ohmsText} onChange={setOhmsText} hint="e.g. 4.7k, 1M, 330" />
          <Pick label="Bands" value={String(encBands)} onChange={(v) => setEncBands(Number(v))} options={[['4', '4'], ['5', '5'], ['6', '6']]} />
          <Pick label="Tolerance" value={tol} onChange={setTol} options={[['5', '±5 % gold'], ['10', '±10 % silver'], ['1', '±1 % brown'], ['2', '±2 % red'], ['0.5', '±0.5 % green'], ['0.25', '±0.25 % blue'], ['0.1', '±0.1 % violet'], ['0.05', '±0.05 % grey']]} />
        </div>
        <Result r={enc}>{(v) => (
          <div>
            <Out label="Bands (left to right)" value={v.bands.join(' · ')} tone="ok" />
            {!v.exact && <Warn>The value needs rounding for this band count; the code represents {formatSI(v.exactValue, 'Ω')}.</Warn>}
          </div>
        )}</Result>
      </div>
    </Card>
  );
}

function ESeriesPart() {
  const [val, setVal] = useState('4k');
  const [series, setSeries] = useState('E24');
  const x = parseSI(val);
  const r = calc(() => {
    need([['value', x]]);
    const nearest = nearestESeries(x, series, 'nearest');
    return { nearest, up: nearestESeries(x, series, 'up'), down: nearestESeries(x, series, 'down') };
  });
  return (
    <Card title="E-series nearest value" formula="Nearest value by relative error, plus the standard value just above and just below.">
      <Grid cols="@md:grid-cols-3">
        <Field label="Value (Ω, F or other)" value={val} onChange={setVal} />
        <Pick label="Series" value={series} onChange={setSeries} options={E_SERIES_NAMES.map((s) => [s, s])} />
      </Grid>
      <Result r={r}>{(v) => (
        <div>
          <Out label="Nearest" value={`${v.nearest.value} (${v.nearest.errorPct >= 0 ? '+' : ''}${v.nearest.errorPct.toFixed(2)} %)`} tone="ok" />
          <Out label="Next up" value={v.up ? v.up.value : '—'} />
          <Out label="Next down" value={v.down ? v.down.value : '—'} />
        </div>
      )}</Result>
    </Card>
  );
}

function CombosPart() {
  const [target, setTarget] = useState('1.2k');
  const [series, setSeries] = useState('E12');
  const [list, setList] = useState('100, 220');
  const t = parseSI(target);
  const combos = calc(() => {
    need([['target', t]]);
    return resistorCombos({ target: t, series, count: 8 });
  });
  const values = list.split(/[,\s]+/).filter(Boolean).map((s) => parseSI(s));
  const listRes = values.length && values.every((v) => Number.isFinite(v) && v > 0)
    ? { series: seriesTotal(values), parallel: parallelTotal(values) }
    : null;
  return (
    <Card title="Series / parallel" formula="Series: Σ R.   Parallel: 1 / Σ(1/R).   Combos use up to two standard values.">
      <Grid cols="@md:grid-cols-2">
        <Field label="Your values (comma separated)" value={list} onChange={setList} hint="e.g. 100, 220, 1k" />
        <div className="text-xs space-y-1 pt-5">
          {listRes ? (
            <>
              <Out label="Series total" value={formatSI(listRes.series, 'Ω')} />
              <Out label="Parallel total" value={formatSI(listRes.parallel, 'Ω')} />
            </>
          ) : <Notice tone="marginal">Enter one or more positive values.</Notice>}
        </div>
      </Grid>
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="Target resistance" value={target} onChange={setTarget} />
        <Pick label="Standard series" value={series} onChange={setSeries} options={E_SERIES_NAMES.slice(0, 4).map((s) => [s, s])} />
      </div>
      <Result r={combos}>{(list2) => (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead><tr className="text-slate-500 text-left"><th className="py-1 pr-3 font-normal">Combination</th><th className="py-1 pr-3 font-normal">Total</th><th className="py-1 font-normal">Error</th></tr></thead>
            <tbody>{list2.map((c, i) => (
              <tr key={i} className="border-t border-slate-900">
                <td className="py-1 pr-3">{c.mode === 'single' ? formatSI(c.parts[0], 'Ω') : `${formatSI(c.parts[0], 'Ω')} ${c.mode === 'series' ? '+' : '∥'} ${formatSI(c.parts[1], 'Ω')}`}</td>
                <td className="py-1 pr-3">{formatSI(c.total, 'Ω')}</td>
                <td className={`py-1 ${Math.abs(c.errorPct) <= 1 ? 'text-emerald-400' : 'text-amber-400'}`}>{`${c.errorPct >= 0 ? '+' : ''}${c.errorPct.toFixed(2)} %`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}</Result>
    </Card>
  );
}

function ResistorsTab() {
  const [sub, setSub] = useState('divider');
  const items = [['divider', 'Divider'], ['led', 'LED'], ['colour', 'Colour code'], ['eseries', 'E-series'], ['combos', 'Series / parallel']];
  return (
    <div className="space-y-2">
      <SubTabs value={sub} onChange={setSub} items={items} />
      {sub === 'divider' && <DividerPart />}
      {sub === 'led' && <LedPart />}
      {sub === 'colour' && <ColourPart />}
      {sub === 'eseries' && <ESeriesPart />}
      {sub === 'combos' && <CombosPart />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. RC / RLC
// ---------------------------------------------------------------------------

function ReactanceCard({ r, c, l }) {
  const [f, setF] = useState('1k');
  const res = calc(() => {
    const fv = parseSI(f); const rv = parseSI(r); const cv = parseSI(c); const lv = parseSI(l);
    need([['frequency', fv], ['R', rv], ['C', cv], ['L', lv]]);
    const xc = capReactance({ f: fv, c: cv });
    const xl = indReactance({ f: fv, l: lv });
    return { xc, xl, rc: seriesImpedance({ r: rv, x: -xc }), rl: seriesImpedance({ r: rv, x: xl }) };
  });
  return (
    <Card title="Reactance at a frequency" formula="Xc = 1/(2π·f·C)   Xl = 2π·f·L   |Z| = √(R² + X²). Uses R, C and L above.">
      <div className="max-w-[10rem]"><Field label="Frequency (Hz)" value={f} onChange={setF} /></div>
      <Result r={res}>{(v) => (
        <div>
          <Out label="Xc (capacitor)" value={formatSI(v.xc, 'Ω')} />
          <Out label="Xl (inductor)" value={formatSI(v.xl, 'Ω')} />
          <Out label="Series R + C: |Z|, phase" value={`${formatSI(v.rc.mag, 'Ω')}, ${v.rc.phaseDeg.toFixed(1)}°`} />
          <Out label="Series R + L: |Z|, phase" value={`${formatSI(v.rl.mag, 'Ω')}, +${v.rl.phaseDeg.toFixed(1)}°`} />
        </div>
      )}</Result>
    </Card>
  );
}

function RcTab() {
  const [r, setR] = useState('1k');
  const [c, setC] = useState('1u');
  const [l, setL] = useState('1m');
  const [rl, setRl] = useState('10');
  const [pct, setPct] = useState('63.2');
  const rc = calc(() => {
    const rv = parseSI(r); const cv = parseSI(c);
    need([['R', rv], ['C', cv]]);
    return rcTimeConstant({ r: rv, c: cv });
  });
  const lc = calc(() => {
    const lv = parseSI(l); const cv = parseSI(c);
    need([['L', lv], ['C', cv]]);
    return lcResonance({ l: lv, c: cv });
  });
  const rlc = calc(() => {
    const rv = parseSI(rl); const lv = parseSI(l); const cv = parseSI(c);
    need([['R', rv], ['L', lv], ['C', cv]]);
    return rlcSeries({ r: rv, l: lv, c: cv });
  });
  const charge = calc(() => {
    const rv = parseSI(r); const cv = parseSI(c); const p = parseSI(pct);
    need([['R', rv], ['C', cv], ['percent', p]]);
    return { t: chargeTimeToPercent({ r: rv, c: cv, percent: p }), tau: rv * cv };
  });
  return (
    <div className="space-y-2">
      <Grid cols="@md:grid-cols-4">
        <Field label="R (Ω)" value={r} onChange={setR} />
        <Field label="C (F)" value={c} onChange={setC} hint="1u = 1 µF" />
        <Field label="L (H)" value={l} onChange={setL} hint="1m = 1 mH" />
        <Field label="R for series RLC (Ω)" value={rl} onChange={setRl} />
      </Grid>
      <Card title="RC low-pass" formula="τ = R·C      fc = 1 / (2π·R·C)">
        <Result r={rc}>{(v) => (
          <div>
            <Out label="Time constant τ" value={formatDuration(v.tau)} />
            <Out label="Cutoff frequency fc" value={formatSI(v.fc, 'Hz')} />
            <Out label="5τ (≈ settled)" value={formatDuration(v.t5)} />
          </div>
        )}</Result>
      </Card>
      <ReactanceCard r={r} c={c} l={l} />
      <Card title="Capacitor charge to a percentage" formula="t = −R·C·ln(1 − p) from 0 toward the source. 63.2 % = 1τ, 99.3 % ≈ 5τ.">
        <Grid cols="@md:grid-cols-2">
          <Field label="Target % of final voltage" value={pct} onChange={setPct} />
          <div />
        </Grid>
        <Result r={charge}>{(v) => (
          <div>
            <Out label="Time to reach that level" value={formatDuration(v.t)} />
            <Out label="In time constants" value={`${(v.t / v.tau).toFixed(3)} τ`} />
          </div>
        )}</Result>
      </Card>
      <Card title="LC resonance" formula="f0 = 1 / (2π·√(L·C))      Z0 = √(L/C)">
        <Result r={lc}>{(v) => (
          <div>
            <Out label="Resonant frequency f0" value={formatSI(v.f0, 'Hz')} tone="ok" />
            <Out label="ω0" value={`${formatSI(v.w0, 'rad/s')}`} />
            <Out label="Characteristic impedance Z0" value={formatSI(v.z0, 'Ω')} />
          </div>
        )}</Result>
      </Card>
      <Card title="Series RLC damping" formula="ζ = (R/2)·√(C/L)   ζ < 1 underdamped (ringing), = 1 critical, > 1 overdamped">
        <Result r={rlc}>{(v) => (
          <div>
            <Out label="Damping ratio ζ" value={v.zeta.toPrecision(4)} />
            <Out label="Behaviour" value={v.kind} tone={v.kind === 'underdamped' ? 'marginal' : 'ok'} />
            <Out label="Resonant f0" value={formatSI(v.f0, 'Hz')} />
            <Out label="Damped ringing frequency" value={v.fd ? formatSI(v.fd, 'Hz') : 'not ringing'} />
          </div>
        )}</Result>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4b. 555 timer and regulator feedback
// ---------------------------------------------------------------------------

function TimerCard() {
  const [r1, setR1] = useState('1k');
  const [r2, setR2] = useState('10k');
  const [c, setC] = useState('100n');
  const [rm, setRm] = useState('100k');
  const [freq, setFreq] = useState('1k');
  const [duty, setDuty] = useState('60');
  const [dc, setDc] = useState('100n');
  const astable = calc(() => {
    const a = parseSI(r1); const b = parseSI(r2); const cv = parseSI(c);
    need([['R1', a], ['R2', b], ['C', cv]]);
    return timer555Astable({ r1: a, r2: b, c: cv });
  });
  const mono = calc(() => {
    const rv = parseSI(rm); const cv = parseSI(c);
    need([['R', rv], ['C', cv]]);
    return timer555Monostable({ r: rv, c: cv });
  });
  const design = calc(() => {
    const f = parseSI(freq); const d = parseSI(duty); const cv = parseSI(dc);
    need([['frequency', f], ['duty', d], ['C', cv]]);
    return timer555Design({ freq: f, c: cv, dutyPct: d });
  });
  return (
    <Card title="555 timer (NE555, ln2 model)" formula="Astable f = 1/(ln2·(R1 + 2·R2)·C), high = ln2·(R1+R2)·C. Monostable t = ln3·R·C. CMOS 555s differ slightly.">
      <Grid cols="@md:grid-cols-4">
        <Field label="R1 (Ω)" value={r1} onChange={setR1} />
        <Field label="R2 (Ω)" value={r2} onChange={setR2} />
        <Field label="C (F)" value={c} onChange={setC} />
        <Field label="Monostable R (Ω)" value={rm} onChange={setRm} hint="uses C" />
      </Grid>
      <Result r={astable}>{(v) => (
        <div>
          <Out label="Astable frequency" value={formatSI(v.freq, 'Hz')} tone="ok" />
          <Out label="High / low time" value={`${formatDuration(v.tHigh)} / ${formatDuration(v.tLow)}`} />
          <Out label="Duty cycle" value={`${v.dutyPct.toFixed(2)} %`} />
        </div>
      )}</Result>
      <Result r={mono}>{(v) => <Out label="Monostable pulse width" value={formatDuration(v.width)} tone="ok" />}</Result>
      <div className="border-t border-slate-900 pt-2 space-y-2">
        <Grid cols="@md:grid-cols-3">
          <Field label="Design: target freq (Hz)" value={freq} onChange={setFreq} />
          <Field label="Duty (% high, above 50)" value={duty} onChange={setDuty} />
          <Field label="Chosen C (F)" value={dc} onChange={setDc} />
        </Grid>
        <Result r={design}>{(v) => (
          <div>
            <Out label="Ideal R1 / R2" value={`${formatSI(v.r1, 'Ω')} / ${formatSI(v.r2, 'Ω')}`} />
            <Out label="Nearest E24 R1 / R2" value={`${formatSI(v.stdR1, 'Ω')} / ${formatSI(v.stdR2, 'Ω')}`} tone="ok" />
            <Out label="Resulting freq, duty" value={`${formatSI(v.actual.freq, 'Hz')}, ${v.actual.dutyPct.toFixed(1)} %`} />
          </div>
        )}</Result>
      </div>
    </Card>
  );
}

function RegulatorCard() {
  const [preset, setPreset] = useState('lm317');
  const [vref, setVref] = useState('1.25');
  const [iadj, setIadj] = useState('50u');
  const [vout, setVout] = useState('5');
  const [series, setSeries] = useState('E96');
  const [rtop, setRtop] = useState('');
  const [rbot, setRbot] = useState('');
  const pick = (k) => {
    setPreset(k);
    if (REGULATOR_PRESETS[k]) { setVref(String(REGULATOR_PRESETS[k].vref)); setIadj(String(REGULATOR_PRESETS[k].iadj)); }
  };
  const pairs = calc(() => {
    const vr = parseSI(vref); const ia = parseSI(iadj); const vo = parseSI(vout);
    need([['Vref', vr], ['adjust current', ia], ['target Vout', vo]]);
    return regulatorPairs({ vref: vr, vout: vo, iadj: ia, series, count: 6 });
  });
  const check = String(rtop).trim() && String(rbot).trim() ? calc(() => {
    const vr = parseSI(vref); const ia = parseSI(iadj); const a = parseSI(rtop); const b = parseSI(rbot);
    need([['Vref', vr], ['adjust current', ia], ['Rtop', a], ['Rbot', b]]);
    return regulatorVout({ vref: vr, rtop: a, rbot: b, iadj: ia });
  }) : null;
  return (
    <Card title="Adjustable regulator feedback" formula="Vout = Vref·(1 + Rtop/Rbot) + Iadj·Rtop. Rtop: output to feedback pin. Rbot: feedback pin to ground.">
      <Grid cols="@md:grid-cols-4">
        <Pick label="Preset" value={preset} onChange={pick} options={[...Object.entries(REGULATOR_PRESETS).map(([k, x]) => [k, x.label]), ['custom', 'Custom']]} />
        <Field label="Vref (V)" value={vref} onChange={(v) => { setVref(v); setPreset('custom'); }} />
        <Field label="Adjust pin current (A)" value={iadj} onChange={(v) => { setIadj(v); setPreset('custom'); }} hint="typical, check datasheet" />
        <Field label="Target Vout (V)" value={vout} onChange={setVout} />
      </Grid>
      <Pick label="Series" value={series} onChange={setSeries} options={E_SERIES_NAMES.slice(0, 5).map((x) => [x, x])} />
      <Result r={pairs}>{(list) => (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead><tr className="text-slate-500 text-left"><th className="py-0.5 pr-3 font-normal">Rtop</th><th className="py-0.5 pr-3 font-normal">Rbot</th><th className="py-0.5 pr-3 font-normal">Vout</th><th className="py-0.5 font-normal">Error</th></tr></thead>
            <tbody>{list.map((p) => (
              <tr key={`${p.rtop}/${p.rbot}`} className="border-t border-slate-900">
                <td className="py-0.5 pr-3">{formatSI(p.rtop, 'Ω')}</td>
                <td className="py-0.5 pr-3">{formatSI(p.rbot, 'Ω')}</td>
                <td className="py-0.5 pr-3">{p.vout.toFixed(4)} V</td>
                <td className={`py-0.5 ${Math.abs(p.errorPct) <= 1 ? 'text-emerald-400' : 'text-amber-400'}`}>{`${p.errorPct >= 0 ? '+' : ''}${p.errorPct.toFixed(2)} %`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}</Result>
      <div className="border-t border-slate-900 pt-2 space-y-2">
        <Grid cols="@md:grid-cols-3">
          <Field label="Check: Rtop (Ω)" value={rtop} onChange={setRtop} />
          <Field label="Check: Rbot (Ω)" value={rbot} onChange={setRbot} />
        </Grid>
        {check && <Result r={check}>{(v) => <Out label="Resulting Vout" value={formatSI(v, 'V')} tone="ok" />}</Result>}
      </div>
    </Card>
  );
}

function TimerRegTab() {
  return (
    <div className="space-y-2">
      <TimerCard />
      <RegulatorCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Battery life
// ---------------------------------------------------------------------------

function BatteryTab() {
  const [cap, setCap] = useState('1000');
  const [act, setAct] = useState('20m');
  const [slp, setSlp] = useState('10u');
  const [duty, setDuty] = useState('10');
  const [derate, setDerate] = useState('20');
  const r = calc(() => {
    const c = parseSI(cap); const a = parseSI(act); const s = parseSI(slp);
    const d = parseSI(duty); const dr = parseSI(derate);
    need([['capacity', c], ['active current', a], ['sleep current', s], ['duty cycle', d], ['derating', dr]]);
    return batteryLife({ capacityMah: c, activeA: a, sleepA: s, dutyPct: d, deratePct: dr });
  });
  return (
    <div className="space-y-2">
      <Card title="Battery runtime" formula="I_avg = d·I_active + (1 − d)·I_sleep     runtime = C·(1 − derate) / I_avg">
        <Grid cols="@md:grid-cols-5">
          <Field label="Capacity (mAh)" value={cap} onChange={setCap} />
          <Field label="Active current (A)" value={act} onChange={setAct} hint="20m = 20 mA" />
          <Field label="Sleep current (A)" value={slp} onChange={setSlp} hint="10u = 10 µA" />
          <Field label="Duty cycle (% active)" value={duty} onChange={setDuty} />
          <Field label="Derating (%)" value={derate} onChange={setDerate} hint="temperature, ageing, cut-off" />
        </Grid>
      </Card>
      <Result r={r}>{(v) => (
        <Card title="Result">
          <Out label="Average current" value={formatSI(v.avgA, 'A')} />
          <Out label="Usable capacity after derating" value={`${v.usableMah.toFixed(0)} mAh`} />
          <Out label="Runtime" value={`${v.hours.toFixed(2)} h  (${v.days.toFixed(2)} days)`} tone="ok" />
          <Out label="Human readable" value={formatDuration(v.hours * 3600)} />
        </Card>
      )}</Result>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 6. PCB trace width + Ohm's law
// ---------------------------------------------------------------------------

function TraceCard() {
  const [mode, setMode] = useState('width');
  const [current, setCurrent] = useState('1');
  const [rise, setRise] = useState('10');
  const [oz, setOz] = useState('1');
  const [layer, setLayer] = useState('external');
  const [width, setWidth] = useState('0.3');
  const r = calc(() => {
    const i = parseSI(current); const dt = parseSI(rise); const w = parseSI(width); const cu = parseSI(oz);
    if (mode === 'width') {
      need([['current', i], ['temperature rise', dt], ['copper weight', cu]]);
      const t = traceWidth({ currentA: i, tempRiseC: dt, copperOz: cu, layer });
      return { kind: 'width', ...t };
    }
    if (mode === 'current') {
      need([['width', w], ['temperature rise', dt], ['copper weight', cu]]);
      return { kind: 'current', current: traceCurrent({ widthMm: w, tempRiseC: dt, copperOz: cu, layer }) };
    }
    need([['current', i], ['width', w], ['copper weight', cu]]);
    return { kind: 'temp', rise: traceTempRise({ currentA: i, widthMm: w, copperOz: cu, layer }) };
  });
  return (
    <Card title="PCB trace width (IPC-2221)" formula="I = k · ΔT^0.44 · A^0.725, A in mil². k = 0.048 external, 0.024 internal. 1 oz copper = 1.37 mil.">
      <Grid cols="@md:grid-cols-5">
        <Pick label="Solve for" value={mode} onChange={setMode} options={[['width', 'Width'], ['current', 'Current'], ['temp', 'Temperature rise']]} />
        <Field label="Current (A)" value={current} onChange={setCurrent} disabled={mode === 'current'} />
        <Field label="Temp rise (°C)" value={rise} onChange={setRise} disabled={mode === 'temp'} />
        <Field label="Trace width (mm)" value={width} onChange={setWidth} disabled={mode === 'width'} />
        <Pick label="Copper" value={oz} onChange={setOz} options={[['0.5', '0.5 oz'], ['1', '1 oz'], ['2', '2 oz'], ['3', '3 oz']]} />
      </Grid>
      <Pick label="Layer" value={layer} onChange={setLayer} options={[['external', 'External (outer)'], ['internal', 'Internal']]} />
      <Result r={r}>{(v) => (
        <div>
          {v.kind === 'width' && (
            <>
              <Out label="Minimum width" value={`${v.widthMm.toFixed(3)} mm  (${v.widthMil.toFixed(2)} mil)`} tone="ok" />
              <Out label="Cross-section" value={`${v.areaMil2.toFixed(2)} mil²`} />
            </>
          )}
          {v.kind === 'current' && <Out label="Max current" value={`${v.current.toFixed(3)} A`} tone="ok" />}
          {v.kind === 'temp' && <Out label="Temperature rise" value={`${v.rise.toFixed(1)} °C`} tone={v.rise > 30 ? 'marginal' : 'ok'} />}
        </div>
      )}</Result>
      <p className="text-[10px] text-slate-600">IPC-2221 closed form, the standard's sizing equation. Real boards also depend on plane adjacency, length and ambient temperature; treat results as a starting point.</p>
    </Card>
  );
}

const OHM_FIELDS = [['V', 'Voltage (V)'], ['I', 'Current (A)'], ['R', 'Resistance (Ω)'], ['P', 'Power (W)']];

function OhmCard() {
  const [vals, setVals] = useState({ V: '12', I: '2', R: '', P: '' });
  const set = (k) => (v) => setVals((s) => ({ ...s, [k]: v }));
  const given = OHM_FIELDS.filter(([k]) => String(vals[k]).trim() !== '');
  const r = given.length === 2 ? calc(() => {
    const parsed = {};
    for (const [k] of OHM_FIELDS) parsed[k] = optional(vals[k]);
    return solveOhm(parsed);
  }) : null;
  return (
    <Card title="Ohm's law & power" formula="V = I·R    P = V·I = I²·R = V²/R. Fill exactly two boxes.">
      <Grid cols="@md:grid-cols-4">
        {OHM_FIELDS.map(([k, label]) => <Field key={k} label={label} value={vals[k]} onChange={set(k)} />)}
      </Grid>
      {given.length !== 2 && <Notice tone="marginal">Fill exactly two of V, I, R, P ({given.length} filled).</Notice>}
      <Result r={r}>{(v) => (
        <div>
          <Out label="V" value={formatSI(v.V, 'V')} />
          <Out label="I" value={formatSI(v.I, 'A')} />
          <Out label="R" value={formatSI(v.R, 'Ω')} />
          <Out label="P" value={formatSI(v.P, 'W')} />
        </div>
      )}</Result>
    </Card>
  );
}

function PcbOhmTab() {
  return (
    <div className="space-y-2">
      <TraceCard />
      <OhmCard />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 7. ADC
// ---------------------------------------------------------------------------

function AdcTab() {
  const [bits, setBits] = useState('12');
  const [vref, setVref] = useState('3.3');
  const [volt, setVolt] = useState('1.65');
  const [code, setCode] = useState('2048');
  const [vin, setVin] = useState('12');
  const [r1, setR1] = useState('10k');
  const [r2, setR2] = useState('10k');
  const base = calc(() => {
    const n = Number(bits); const v = parseSI(vref);
    need([['Vref', v]]);
    return adcLsb({ bits: n, vref: v });
  });
  const toCode = calc(() => {
    const n = Number(bits); const v = parseSI(vref); const x = parseSI(volt);
    need([['voltage', x]]);
    return voltageToCode({ voltage: x, bits: n, vref: v });
  });
  const toVolt = calc(() => {
    const n = Number(bits); const v = parseSI(vref); const c = Number(code);
    if (!Number.isInteger(c)) throw new Error('Code must be a whole number.');
    return { v: codeToVoltage({ code: c, bits: n, vref: v }), centre: codeToVoltage({ code: c, bits: n, vref: v, centre: true }) };
  });
  const divider = calc(() => {
    const n = Number(bits); const v = parseSI(vref); const i = parseSI(vin); const a = parseSI(r1); const b = parseSI(r2);
    need([['Vin', i], ['R1', a], ['R2', b]]);
    const pin = dividerAdcVoltage({ vin: i, r1: a, r2: b });
    const maxIn = dividerFullScaleInput({ vref: v, r1: a, r2: b });
    const c = voltageToCode({ voltage: pin, bits: n, vref: v });
    return { pin, maxIn, code: c.code, clipped: c.clipped };
  });
  return (
    <div className="space-y-2">
      <Grid cols="@md:grid-cols-2">
        <Pick label="ADC resolution (bits)" value={bits} onChange={setBits} options={[8, 10, 12, 14, 16, 24].map((b) => [String(b), `${b}-bit`])} />
        <Field label="Vref (V)" value={vref} onChange={setVref} />
      </Grid>
      <Result r={base}>{(v) => (
        <Card title="LSB" formula="LSB = Vref / 2^N     full-scale code = 2^N − 1">
          <Out label="LSB" value={`${formatSI(v.lsb, 'V')}  (${v.lsb.toExponential(4)} V)`} tone="ok" />
          <Out label="Levels" value={v.levels.toLocaleString()} />
          <Out label="Max code" value={v.maxCode.toLocaleString()} />
          <Out label="Quantisation error" value={`±${formatSI(v.lsb / 2, 'V')} (rounding), up to 1 LSB (truncation)`} />
        </Card>
      )}</Result>
      <Card title="Voltage → code" formula="code = floor(V / LSB), clamped to 0..max">
        <Grid cols="@md:grid-cols-2">
          <Field label="Voltage at pin (V)" value={volt} onChange={setVolt} />
          <div />
        </Grid>
        <Result r={toCode}>{(v) => (
          <div>
            <Out label="Code" value={`${v.code}  (0x${v.code.toString(16).toUpperCase()})`} tone="ok" />
            {v.clipped && <Warn>Input is outside 0..Vref and the code is clipped.</Warn>}
          </div>
        )}</Result>
      </Card>
      <Card title="Code → voltage" formula="V = code · LSB (bottom of the bin); centre = (code + 0.5) · LSB">
        <Grid cols="@md:grid-cols-2">
          <Field label="Code (integer)" value={code} onChange={setCode} />
          <div />
        </Grid>
        <Result r={toVolt}>{(v) => (
          <div>
            <Out label="Bin bottom" value={formatSI(v.v, 'V')} tone="ok" />
            <Out label="Bin centre" value={formatSI(v.centre, 'V')} />
          </div>
        )}</Result>
      </Card>
      <Card title="Divider-scaled input" formula="V_pin = Vin · R2 / (R1 + R2). Full-scale input = Vref · (R1 + R2) / R2.">
        <Grid cols="@md:grid-cols-3">
          <Field label="Input voltage Vin (V)" value={vin} onChange={setVin} />
          <Field label="R1 top (Ω)" value={r1} onChange={setR1} />
          <Field label="R2 bottom (Ω)" value={r2} onChange={setR2} />
        </Grid>
        <Result r={divider}>{(v) => (
          <div>
            <Out label="Voltage at ADC pin" value={formatSI(v.pin, 'V')} />
            <Out label="ADC code" value={`${v.code}`} tone="ok" />
            <Out label="Full-scale input" value={formatSI(v.maxIn, 'V')} tone={v.maxIn < parseSI(vin) ? 'bad' : undefined} />
            {v.clipped && <Warn>This input would clip the ADC (above Vref at the pin).</Warn>}
          </div>
        )}</Result>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

export default function ElectronicsCalcWorkbench() {
  const [tab, setTab] = useState('uart');
  return (
    <div className="h-full flex flex-col bg-slate-950 text-gray-200 text-sm">
      <div className="px-2 py-1.5 border-b border-slate-800 flex flex-wrap items-center gap-1" role="tablist" aria-label="Electronics Calculators">
        <Calculator size={14} className="text-amber-400 mr-1" aria-hidden="true" />
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-2 py-0.5 rounded text-xs border ${tab === id ? 'border-amber-600 bg-amber-950/40 text-amber-300' : 'border-slate-800 text-slate-400 hover:text-slate-200'}`}>{label}</button>
        ))}
        <span className="text-[10px] text-slate-500 ml-auto" title="Offline. Values accept SI suffixes: 4.7k, 100n, 10u, 2M2, 1e3">SI suffixes ok: 4.7k 100n 10u</span>
      </div>
      <div className="flex-1 overflow-auto p-0.5">
        {tab === 'uart' && <UartTab />}
        {tab === 'i2c' && <I2cTab />}
        {tab === 'res' && <ResistorsTab />}
        {tab === 'rc' && <RcTab />}
        {tab === 'tim' && <TimerRegTab />}
        {tab === 'batt' && <BatteryTab />}
        {tab === 'pcb' && <PcbOhmTab />}
        {tab === 'adc' && <AdcTab />}
      </div>
    </div>
  );
}
