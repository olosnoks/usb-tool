import React, { useState } from 'react';
import { KeyRound, Usb, Power, ShieldAlert, Activity, Loader2 } from 'lucide-react';
import { Fido2Device, requestFido2Device, loadAaguidNames, aaguidName } from '../../utils/fido2Driver';
import StatusBadge from '../common/StatusBadge';
import WebAuthnLab from './fido2/WebAuthnLab';

import { useSessionError } from '../../utils/sessionLog';
export default function Fido2Workbench() {
  const [dev, setDev] = useState(null);
  const [status, setStatus] = useState('offline');
  const [ctap, setCtap] = useState(null); // CTAPHID init info
  const [info, setInfo] = useState(null); // getInfo
  const [ping, setPing] = useState(null);
  const [busy, setBusy] = useState('');
  const [winked, setWinked] = useState(false);
  const [error, setError] = useSessionError('FIDO2');
  const webHidAvailable = typeof navigator !== 'undefined' && 'hid' in navigator;

  const connect = async () => {
    setBusy('connect'); setError('');
    try {
      const transport = await requestFido2Device();
      const d = new Fido2Device(transport);
      await d.open();
      const ci = await d.init();
      setCtap(ci);
      // U2F-only keys have no CBOR / getInfo. Names come from the community AAGUID list, fetched on demand.
      const gi = ci.capCbor ? await d.getInfo() : null;
      if (gi?.aaguid) { await loadAaguidNames(); gi.aaguidName = aaguidName(gi.aaguid); }
      setInfo(gi);
      setDev(d); setStatus('online');
    } catch (err) { setError(err.message); setStatus('warning'); }
    finally { setBusy(''); }
  };

  const disconnect = async () => {
    try { await dev?.close(); } catch (e) { /* ignore */ }
    setDev(null); setStatus('offline'); setCtap(null); setInfo(null); setPing(null); setWinked(false);
  };

  const doWink = async () => {
    setBusy('wink'); setError('');
    try { await dev.wink(); setWinked(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const doPing = async () => {
    setBusy('ping'); setError('');
    try { setPing(await dev.ping(32)); }
    catch (err) { setError(err.message); }
    finally { setBusy(''); }
  };

  const optionChips = info ? Object.entries(info.options) : [];

  return (
    <div className="space-y-4 font-mono text-xs">
      <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <p className="text-[11px] text-slate-400 max-w-3xl">
              Read a FIDO2 / U2F authenticator over CTAP-HID: its supported versions, AAGUID, capabilities and limits, with a PING
              round-trip. Read-only — it does not create, list or delete credentials, change the PIN, or reset the key.
            </p>
          </div>
          <StatusBadge status={status} label={status === 'online' ? 'CTAP' : status === 'warning' ? 'ERR' : 'IDLE'} value={dev ? 'Connected' : 'Offline'} />
        </div>

        {!webHidAvailable && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
            <ShieldAlert className="w-4 h-4 shrink-0" /> WebHID needs a Chromium browser (Chrome/Edge) over HTTPS or localhost.
          </div>
        )}
        <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-slate-700 bg-slate-900/60 text-slate-300 text-[11px]">
          <ShieldAlert className="w-4 h-4 shrink-0 text-amber-300" />
          <span>
            Chrome and Edge hide security keys (HID usage page F1D0) from web pages, so the device chooser normally shows nothing here.
            To read a key you own, start the browser with <code className="text-amber-200">--disable-hid-blocklist</code> for this session only,
            then close it again: that flag lets every site you visit ask for blocked HID devices.
            No flag needed for the <a href="#webauthn-lab" className="text-amber-200 underline">WebAuthn lab</a> below: it talks to the key through the browser&apos;s own WebAuthn stack.
          </span>
        </div>
        {error && (
          <div className="mt-3 flex items-start gap-2 p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold">
            <ShieldAlert className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        <div className="pt-3 flex flex-wrap items-center gap-2">
          {!dev ? (
            <button onClick={() => connect()} disabled={!webHidAvailable || !!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 text-xs font-bold disabled:opacity-40">
              {busy === 'connect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Usb className="w-3.5 h-3.5" />} READ SECURITY KEY (WEBHID)
            </button>
          ) : (
            <>
              <button onClick={disconnect} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-xs font-bold">
                <Power className="w-3.5 h-3.5" /> DISCONNECT
              </button>
              <button onClick={doPing} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-slate-800 text-xs font-bold disabled:opacity-40">
                <Activity className="w-3.5 h-3.5" /> {busy === 'ping' ? 'PINGING...' : 'PING'}
              </button>
              {ctap?.capWink && (
                <button onClick={doWink} disabled={!!busy} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-cyan-300 border border-slate-800 text-xs font-bold disabled:opacity-40">
                  {busy === 'wink' ? 'WINKING...' : 'WINK'}
                </button>
              )}
              {winked && <span className="text-emerald-400">winked ✓</span>}
              {ping != null && <span className={ping ? 'text-emerald-400' : 'text-rose-400'}>{ping ? 'echo matched ✓' : 'echo mismatch ✗'}</span>}
            </>
          )}
        </div>
      </div>

      {ctap && !ctap.capCbor && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200">
          <ShieldAlert className="w-4 h-4 shrink-0" /> This key is U2F-only (CTAPHID version {ctap.protocolVersion}, firmware {ctap.deviceVersion}): it has no CTAP2 / CBOR support, so there is no AAGUID, options or algorithm list to read.
        </div>
      )}

      {info && (
        <div className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
          <div className="grid grid-cols-2 @sm:grid-cols-4 gap-3">
            <Field label="CTAPHID version" value={ctap?.protocolVersion} />
            <Field label="Device version" value={ctap?.deviceVersion} />
            <Field label="AAGUID" value={info.aaguid} />
            <Field label="Authenticator" value={info.aaguidName || (info.aaguid ? 'Unknown (not in the community AAGUID list)' : null)} />
            <Field label="Max msg size" value={info.maxMsgSize} />
            <Field label="Firmware version" value={info.firmwareVersion} />
            <Field label="Min PIN length" value={info.minPinLength} />
            <Field label="Max cred ID length" value={info.maxCredentialIdLength} />
            <Field label="Max creds in list" value={info.maxCredentialCountInList} />
            <Field label="Max cred blob" value={info.maxCredBlobLength} />
            <Field label="Max large blob array" value={info.maxSerializedLargeBlobArray} />
            <Field label="Remaining discoverable creds" value={info.remainingDiscoverableCredentials} />
            <Field label="Force PIN change" value={info.forcePinChange == null ? null : String(info.forcePinChange)} />
          </div>
          <div>
            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Versions</span>
            <div className="flex flex-wrap gap-1.5">
              {info.versions.map((v) => <span key={v} className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">{v}</span>)}
            </div>
          </div>
          {optionChips.length > 0 && (
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Options</span>
              <div className="flex flex-wrap gap-1.5">
                {optionChips.map(([k, v]) => (
                  <span key={k} className={`px-2 py-0.5 rounded border ${v ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>{k}: {String(v)}</span>
                ))}
              </div>
            </div>
          )}
          {info.extensions.length > 0 && <ChipList label="Extensions" items={info.extensions} />}
          {info.algorithms.length > 0 && <ChipList label="Algorithms" items={info.algorithms.map((a) => `${a.name || a.alg}${a.type ? ` (${a.type})` : ''}`)} />}
          {info.attestationFormats.length > 0 && <ChipList label="Attestation formats" items={info.attestationFormats} />}
          {Object.keys(info.certifications).length > 0 && <ChipList label="Certifications" items={Object.entries(info.certifications).map(([k, v]) => `${k}: ${v}`)} />}
          {(info.transports.length > 0 || info.pinUvAuthProtocols.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {info.transports.length > 0 && <Field label="Transports" value={info.transports.join(', ')} />}
              {info.pinUvAuthProtocols.length > 0 && <Field label="PIN/UV protocols" value={info.pinUvAuthProtocols.join(', ')} />}
            </div>
          )}
        </div>
      )}
      <WebAuthnLab />
    </div>
  );
}

function ChipList({ label, items }) {
  return (
    <div>
      <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {items.map((v) => <span key={v} className="px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">{v}</span>)}
      </div>
    </div>
  );
}

function Field({ label, value }) {
  return (
    <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
      <span className="text-[10px] text-slate-500 font-bold uppercase block">{label}</span>
      <span className="text-slate-200 font-semibold break-all">{value ?? '—'}</span>
    </div>
  );
}
