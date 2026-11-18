import React, { useState } from 'react';
import { decodeIso14a, decodeAccessBits, decodeEm410x, toHex } from '../../../protocols/pm3';

const inputCls =
  'w-full bg-slate-950 border border-slate-800 rounded px-2 py-1 font-mono text-slate-200 outline-none focus:border-cyan-600';
const card = 'bg-slate-900/80 border border-slate-800 rounded-lg p-2.5 space-y-2';

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-2">
    <span className="text-slate-500 w-24 flex-shrink-0">{k}</span>
    <span className="text-slate-200 break-all">{v}</span>
  </div>
);

/** Decoders that need no hardware: paste values copied from a Proxmark console or a dump. */
export default function OfflineDecoders() {
  const [uid, setUid] = useState('');
  const [atqa, setAtqa] = useState('0004');
  const [sak, setSak] = useState('08');
  const [acc, setAcc] = useState('FF078069');
  const [em, setEm] = useState('');

  const iso: any = decodeIso14a(uid, atqa, sak);
  const ab: any = decodeAccessBits(acc);
  const emr: any = em.trim() ? decodeEm410x(em) : null;

  return (
    <div className="grid grid-cols-1 @xl:grid-cols-2 gap-2 text-[11px]">
      <p className="@xl:col-span-2 text-slate-500">
        Offline decoders. Nothing is sent to a device; paste values from a Proxmark console or a dump file.
      </p>

      <section className={card} aria-label="ISO 14443A card identification">
        <h3 className="text-xs font-semibold text-slate-100">ISO 14443A: UID / ATQA / SAK</h3>
        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-3 @lg:col-span-1 text-slate-400">
            UID (hex)
            <input className={inputCls} value={uid} onChange={(e) => setUid(e.target.value)} placeholder="DE AD BE EF" />
          </label>
          <label className="text-slate-400">
            ATQA
            <input className={inputCls} value={atqa} onChange={(e) => setAtqa(e.target.value)} />
          </label>
          <label className="text-slate-400">
            SAK
            <input className={inputCls} value={sak} onChange={(e) => setSak(e.target.value)} />
          </label>
        </div>
        {iso.error ? (
          <p className="text-amber-400">{iso.error}</p>
        ) : (
          <div className="space-y-0.5 font-mono">
            <Row k="Card type" v={iso.cardType} />
            <Row k="UID size" v={iso.atqaUidSize + ' (from ATQA)'} />
            <Row k="UID complete" v={iso.uidComplete ? 'yes' : 'no, cascade level continues'} />
            <Row k="ISO 14443-4" v={iso.iso14443_4 ? 'yes (RATS supported)' : 'no'} />
            {iso.uidBytes && <Row k="UID" v={toHex(iso.uidBytes, ' ')} />}
            {iso.randomUid && <Row k="Note" v="UID starts with 08: usually a random/anticollision UID" />}
            {iso.bccValid !== null && <Row k="BCC" v={iso.bccValid ? 'valid' : 'does not match the UID XOR'} />}
            {iso.uidProblem && <p className="text-amber-400">{iso.uidProblem}</p>}
          </div>
        )}
        <p className="text-slate-500">SAK table is a heuristic; confirm with `hf search` on the real card.</p>
      </section>

      <section className={card} aria-label="Mifare Classic access bits">
        <h3 className="text-xs font-semibold text-slate-100">Mifare Classic access bits</h3>
        <label className="text-slate-400 block">
          Sector trailer bytes 6-9 (hex)
          <input className={inputCls} value={acc} onChange={(e) => setAcc(e.target.value)} />
        </label>
        {ab.error ? (
          <p className="text-amber-400">{ab.error}</p>
        ) : (
          <div className="space-y-1 font-mono">
            {ab.warning && <p className="text-rose-400">{ab.warning}</p>}
            {ab.blocks.map((b: any) => (
              <div key={b.block} className="border-l-2 border-slate-700 pl-2">
                <span className="text-cyan-400">
                  {b.trailer ? 'Trailer' : `Block ${b.block}`} [C1C2C3 = {b.c}]
                </span>
                <div className="text-slate-300">{b.rule}</div>
              </div>
            ))}
            <Row k="User byte" v={'0x' + toHex([ab.userByte])} />
          </div>
        )}
      </section>

      <section className={`${card} @xl:col-span-2`} aria-label="EM410x ID decoder">
        <h3 className="text-xs font-semibold text-slate-100">EM410x ID</h3>
        <label className="text-slate-400 block">
          5-byte ID (hex), e.g. from `lf em 410x reader`
          <input className={inputCls} value={em} onChange={(e) => setEm(e.target.value)} placeholder="0F0368568B" />
        </label>
        {emr &&
          (emr.error ? (
            <p className="text-amber-400">{emr.error}</p>
          ) : (
            <div className="space-y-0.5 font-mono">
              <Row k="ID" v={emr.idHex} />
              <Row k="Decimal (40-bit)" v={emr.decimal40} />
              <Row k="Decimal (low 32)" v={emr.decimal32} />
              <Row k="First byte" v={`${emr.customer} (0x${toHex([emr.customer])})`} />
              <Row k="64-bit frame" v={emr.frameBits.replace(/(.{8})/g, '$1 ').trim()} />
              <p className="text-slate-500">
                Frame = 9 header ones, ten 4-bit nibbles each with a row parity bit, 4 column parity bits, stop bit 0.
                Facility/card splits differ per access-control vendor, so only raw values are shown.
              </p>
            </div>
          ))}
      </section>
    </div>
  );
}
