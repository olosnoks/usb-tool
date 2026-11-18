import React, { useState } from 'react';
import { ShieldAlert, Trash2 } from 'lucide-react';
import { summariseFaults, decodeExcReturn, labelStackFrame, exceptionName, decodeXpsr } from '../../../utils/cortexRegs';

const h8 = (v) => `0x${(v >>> 0).toString(16).toUpperCase().padStart(8, '0')}`;
const btn = 'flex items-center gap-1 px-2 py-0.5 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 text-[11px] font-bold disabled:opacity-40';

/**
 * Reads the Cortex-M fault status registers (CFSR, HFSR, MMFAR, BFAR) and, when
 * the CPU is halted inside an exception handler, the register frame the core
 * stacked on entry, so the PC that faulted can be read directly.
 */
export default function FaultPanel({ client, guard, busy, targetState, registers }) {
  const [report, setReport] = useState(null);
  const [frame, setFrame] = useState(null);

  const check = () => guard('faults', async () => {
    const raw = await client.readFaultRegisters();
    setReport({ raw, ...summariseFaults(raw) });
    setFrame(null);
    if (targetState !== 'halted') return;
    const lr = registers[14];
    const ret = lr === undefined ? null : decodeExcReturn(lr);
    if (!ret) return;
    const sp = registers[ret.stack === 'PSP' ? 18 : 17];
    if (!sp) return;
    const words = await client.readWordsAt(sp, 8);
    setFrame({ ret, sp, words: labelStackFrame(words) });
  });

  const clear = () => guard('faults', async () => {
    await client.clearFaultRegisters();
    const raw = await client.readFaultRegisters();
    setReport({ raw, ...summariseFaults(raw) });
  });

  const activeExc = registers[16] !== undefined ? decodeXpsr(registers[16]).exception : 0;

  return (
    <div className="bg-[#030712] border border-cyber-border rounded-lg p-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-bold text-[11px] text-slate-200 flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400" /> FAULT ANALYSIS
        </span>
        <div className="flex gap-1">
          <button onClick={check} disabled={!!busy} className={btn} title="Read CFSR / HFSR / MMFAR / BFAR and decode them">READ FAULTS</button>
          <button onClick={clear} disabled={!!busy || !report} className={btn} title="Write 1s to CFSR and HFSR to clear the sticky bits">
            <Trash2 className="w-3 h-3" /> CLEAR
          </button>
        </div>
      </div>
      {!report && <p className="text-[10px] text-slate-500">After a crash, halt the CPU and read the fault registers to see why it faulted.</p>}
      {report && (
        <div className="text-[11px] flex flex-col gap-1">
          <div className="grid grid-cols-2 @md:grid-cols-4 gap-1 text-[10px]">
            {[['CFSR', report.raw.cfsr], ['HFSR', report.raw.hfsr], ['MMFAR', report.raw.mmfar], ['BFAR', report.raw.bfar]].map(([n, v]) => (
              <div key={n} className="flex justify-between gap-1 px-1.5 py-0.5 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-500 font-bold">{n}</span><span className="text-cyan-300 font-bold">{h8(v)}</span>
              </div>
            ))}
          </div>
          {report.faulted ? (
            <ul className="space-y-0.5 text-amber-300">
              {report.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
          ) : (
            <p className="text-emerald-300">No fault bits set.</p>
          )}
        </div>
      )}
      {frame && (
        <div className="border-t border-slate-800 pt-1.5 text-[11px]">
          <p className="text-slate-400 mb-1">
            Handler is running ({exceptionName(activeExc)}); returning to {frame.ret.returnTo} on {frame.ret.stack}. Frame at {h8(frame.sp)}
            {frame.ret.fpFrame ? ' (FP frame: extra words follow)' : ''}:
          </p>
          <div className="grid grid-cols-2 @md:grid-cols-4 gap-1 text-[10px]">
            {frame.words.map((w) => (
              <div key={w.name} className={`flex justify-between gap-1 px-1.5 py-0.5 rounded border ${w.name === 'PC' ? 'bg-rose-500/10 border-rose-500/40' : 'bg-slate-950 border-slate-800'}`}>
                <span className="text-slate-500 font-bold">{w.name}</span>
                <span className="text-slate-200 font-bold" title={w.name === 'PC' || w.name === 'LR' ? client.symbolFor(w.value) : undefined}>{h8(w.value)}</span>
              </div>
            ))}
          </div>
          {client.symbolFor(frame.words[6].value) && (
            <p className="text-emerald-300 mt-1">Stacked PC: {client.symbolFor(frame.words[6].value)}</p>
          )}
        </div>
      )}
    </div>
  );
}
