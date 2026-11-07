import React, { useMemo, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { decodeJwt, analyzeClaims, verifyJwt } from '../../utils/jwt.js';

/**
 * JWT inspector (jwt.io-style), fully client-side. Decode the header and
 * payload, see human-readable time claims, and verify the signature with the
 * Web Crypto API: HS256/384/512 (shared secret), or RS/PS/ES* (PEM or JWK
 * public key). The "alg":"none" footgun is flagged. Nothing leaves the browser.
 */

const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const COLORS = ['text-red-400', 'text-purple-400', 'text-sky-400'];

export default function JwtInspectorWorkbench({ onLogMessage }) {
  const [token, setToken] = useState(SAMPLE);
  const [key, setKey] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const decoded = useMemo(() => {
    try { return { value: decodeJwt(token), error: '' }; }
    catch (e) { return { value: null, error: e.message }; }
  }, [token]);

  const claims = useMemo(() => (decoded.value ? analyzeClaims(decoded.value.payload) : []), [decoded.value]);
  const alg = decoded.value?.header?.alg;
  const isHmac = /^HS/.test(alg || '');

  const doVerify = async () => {
    if (!decoded.value) return;
    setVerifying(true);
    const res = await verifyJwt(decoded.value, key);
    setVerifyResult(res);
    setVerifying(false);
    onLogMessage?.(`JWT verify (${res.alg}): ${res.reason}`);
  };

  const parts = decoded.value?.parts;

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Encoded token</div>
          <textarea
            value={token}
            onChange={(e) => { setToken(e.target.value); setVerifyResult(null); }}
            spellCheck={false}
            rows={8}
            placeholder="paste a JWT (header.payload.signature)"
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono resize-y break-all"
          />
          {parts && (
            <div className="mt-1 text-[11px] font-mono break-all leading-relaxed bg-slate-950 border border-slate-800 rounded p-2">
              <span className={COLORS[0]}>{parts[0]}</span>
              <span className="text-slate-600">.</span>
              <span className={COLORS[1]}>{parts[1]}</span>
              <span className="text-slate-600">.</span>
              <span className={COLORS[2]}>{parts[2]}</span>
            </div>
          )}
          {decoded.error && <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{decoded.error}</div>}
        </div>

        <div>
          {decoded.value && (
            <>
              <div className={`text-[10px] uppercase tracking-wide mb-1 ${COLORS[0]}`}>Header</div>
              <pre className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono overflow-auto max-h-28 text-red-200">{JSON.stringify(decoded.value.header, null, 2)}</pre>
              <div className={`text-[10px] uppercase tracking-wide mt-2 mb-1 ${COLORS[1]}`}>Payload</div>
              <pre className="bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono overflow-auto max-h-40 text-purple-200">{JSON.stringify(decoded.value.payload, null, 2)}</pre>
            </>
          )}
        </div>
      </div>

      {claims.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Time claims</div>
          <div className="flex flex-wrap gap-2">
            {claims.map((c) => (
              <div key={c.claim} className={`px-2 py-1 rounded border text-[11px] ${c.ok ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300' : 'border-red-800 bg-red-950/20 text-red-300'}`}>
                <span className="font-semibold">{c.label}</span> ({c.claim}) · {c.when} · {c.detail}
              </div>
            ))}
          </div>
        </div>
      )}

      {decoded.value && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Verify signature {alg && <span className="text-slate-400">· alg: {alg}</span>}</div>
          {alg === 'none' && (
            <div className="mb-2 p-2 border border-amber-800 rounded bg-amber-950/20 text-xs text-amber-300 flex items-center gap-1.5">
              <ShieldAlert size={14} /> This token declares <code>"alg":"none"</code> — it is unsigned. Never accept unsigned tokens in production.
            </div>
          )}
          <textarea
            value={key}
            onChange={(e) => setKey(e.target.value)}
            spellCheck={false}
            rows={3}
            placeholder={isHmac ? 'HMAC shared secret' : 'PEM public key (-----BEGIN PUBLIC KEY-----) or JWK JSON'}
            className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono resize-y"
          />
          <div className="flex items-center gap-2 mt-1">
            <button onClick={doVerify} disabled={verifying} className="px-3 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1">
              <KeyRound size={13} /> {verifying ? 'Verifying…' : 'Verify'}
            </button>
            {verifyResult && (
              <span className={`inline-flex items-center gap-1 text-xs ${verifyResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                {verifyResult.ok ? <ShieldCheck size={14} /> : <ShieldX size={14} />} {verifyResult.reason}
              </span>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            HS* uses the shared secret; RS*/PS*/ES* use the <strong>public</strong> key (PEM SPKI or JWK). Verification runs in
            the browser via Web Crypto — the secret/key never leaves this page.
          </p>
        </div>
      )}
    </div>
  );
}
