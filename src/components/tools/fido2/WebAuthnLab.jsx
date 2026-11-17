import React, { useEffect, useState } from 'react';
import { checkCapabilities, registerCredential, authenticateCredential, currentRpId } from '../../../utils/webauthnLab';
import { loadAaguidNames } from '../../../utils/fido2Driver';

const btn = 'px-3 py-1.5 rounded-lg border text-xs font-bold disabled:opacity-40';

function Json({ value }) {
  return <pre className="mt-2 p-2 bg-slate-950 border border-slate-800 rounded text-[11px] text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>;
}

export default function WebAuthnLab() {
  const [caps, setCaps] = useState(null);
  const [discoverable, setDiscoverable] = useState(false);
  const [uv, setUv] = useState('discouraged');
  const [attestation, setAttestation] = useState('direct');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [reg, setReg] = useState(null);
  const [credId, setCredId] = useState(null); // Uint8Array of the lab's own credential
  const [assertion, setAssertion] = useState(null);
  let rpId = '';
  try { rpId = currentRpId(); } catch (e) { rpId = ''; }

  // the authenticator-name list is fetched on demand (not bundled; see fido2Driver.js)
  useEffect(() => { checkCapabilities().then(setCaps); loadAaguidNames(); }, []);

  const register = async () => {
    setError('');
    if (discoverable && !window.confirm('A discoverable (resident) credential permanently uses one of the limited credential slots on your key until you delete it. Create it anyway?')) return;
    setBusy('register');
    try {
      const r = await registerCredential({ discoverable, confirmed: discoverable, userVerification: uv, attestation });
      setCredId(r.rawId);
      setReg(r.description);
      setAssertion(null);
    } catch (err) { setError(`${err.name || 'Error'}: ${err.message}`); }
    finally { setBusy(''); }
  };

  const authenticate = async () => {
    setError('');
    setBusy('auth');
    try {
      const r = await authenticateCredential({ credentialId: credId || undefined, userVerification: uv });
      setAssertion(r.description);
    } catch (err) { setError(`${err.name || 'Error'}: ${err.message}`); }
    finally { setBusy(''); }
  };

  const webauthn = caps ? caps.webauthn : typeof window !== 'undefined' && !!window.PublicKeyCredential;

  return (
    <div id="webauthn-lab" className="bg-[#030712] border border-cyber-border rounded-xl p-4 shadow-xl space-y-3">
      <div>
        <span className="text-[10px] text-slate-500 font-bold uppercase block">WebAuthn lab (no flag needed)</span>
        <p className="text-[11px] text-slate-400 max-w-3xl mt-1">
          Creates and uses a test credential through the browser&apos;s own WebAuthn API, so it works with the normal HID blocklist in place.
          The relying party ID is always this page&apos;s hostname{rpId ? <> (<code className="text-amber-200">{rpId}</code>)</> : ''}; the credential only works here.
          Registration decodes the attestation (format, certificate chain, flags, sign count, public key) from the response.
        </p>
      </div>

      {caps && (
        <div className="flex flex-wrap gap-1.5">
          <span className={`px-2 py-0.5 rounded border ${caps.webauthn ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-rose-300 border-rose-500/30 bg-rose-500/10'}`}>WebAuthn: {String(caps.webauthn)}</span>
          {caps.platformAuthenticator != null && <span className="px-2 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-300">platform authenticator: {String(caps.platformAuthenticator)}</span>}
          {caps.conditionalMediation != null && <span className="px-2 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-300">conditional UI: {String(caps.conditionalMediation)}</span>}
          {caps.clientCapabilities && Object.entries(caps.clientCapabilities).map(([k, v]) => (
            <span key={k} className={`px-2 py-0.5 rounded border ${v ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30' : 'bg-slate-900 text-slate-500 border-slate-800'}`}>{k}: {String(v)}</span>
          ))}
          {caps.webauthn && caps.clientCapabilities == null && <span className="px-2 py-0.5 rounded border border-slate-800 bg-slate-900 text-slate-500">getClientCapabilities() not offered by this browser</span>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-slate-300">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={discoverable} onChange={(e) => setDiscoverable(e.target.checked)} />
          Discoverable (resident) credential <span className="text-amber-300">(uses a key slot)</span>
        </label>
        <label className="flex items-center gap-1.5">User verification
          <select value={uv} onChange={(e) => setUv(e.target.value)} className="bg-slate-950 border border-slate-800 rounded p-1 text-xs">
            <option value="discouraged">discouraged</option><option value="preferred">preferred</option><option value="required">required</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5">Attestation
          <select value={attestation} onChange={(e) => setAttestation(e.target.value)} className="bg-slate-950 border border-slate-800 rounded p-1 text-xs">
            <option value="direct">direct</option><option value="indirect">indirect</option><option value="none">none</option><option value="enterprise">enterprise</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={register} disabled={!webauthn || !!busy} className={`${btn} bg-emerald-500/20 text-emerald-300 border-emerald-500/40`}>
          {busy === 'register' ? 'TOUCH YOUR KEY...' : 'REGISTER TEST CREDENTIAL'}
        </button>
        <button onClick={authenticate} disabled={!webauthn || !!busy || (!credId && !discoverable)} className={`${btn} bg-slate-900 text-cyan-300 border-slate-800`}>
          {busy === 'auth' ? 'TOUCH YOUR KEY...' : 'AUTHENTICATE'}
        </button>
      </div>
      {!credId && <p className="text-[11px] text-slate-500">Authenticate is enabled after you register here (it then asks for exactly that credential), or tick &quot;discoverable&quot; to let the key offer a resident one.</p>}

      {error && <div className="p-2.5 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold break-words">{error}</div>}
      {reg && <div><span className="text-[10px] text-slate-500 font-bold uppercase">Registration</span><Json value={reg} /></div>}
      {assertion && <div><span className="text-[10px] text-slate-500 font-bold uppercase">Assertion</span><Json value={assertion} /></div>}
    </div>
  );
}
