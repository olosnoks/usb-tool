import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, ShieldCheck, ShieldAlert, ShieldX, PenLine, Search, CloudDownload, Copy } from 'lucide-react';
import { decodeJwt, analyzeClaims, verifyJwt, signJwt, headerWarnings, fetchJwks, fetchJwksForIssuer, SIGN_ALGS } from '../../utils/jwt.js';
import { proxiedFetch, describeNetworkError } from '../../utils/netClient.js';

/**
 * JWT inspector (jwt.io-style), fully client-side. Decode the header and
 * payload, see live time claims and expected iss/aud/sub checks, and verify the
 * signature with the Web Crypto API: HS* (secret as text/hex/base64), RS/PS/ES*
 * and EdDSA (PEM public key, certificate, JWK or a JWKS chosen by kid). The
 * Encode/Sign tab builds tokens. The "alg":"none" footgun is flagged. Nothing
 * leaves the browser except an explicitly requested JWKS fetch.
 */

const SAMPLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

const COLORS = ['text-red-400', 'text-purple-400', 'text-sky-400'];
const ENCODINGS = [['text', 'Text'], ['hex', 'Hex'], ['base64', 'Base64'], ['base64url', 'Base64url']];
const inputCls = 'bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs font-mono';
const btnCls = 'px-3 py-1 bg-cyan-900/50 border border-cyan-800 text-cyan-200 rounded text-xs hover:bg-cyan-900/70 disabled:opacity-50 inline-flex items-center gap-1';

export default function JwtInspectorWorkbench({ onLogMessage }) {
  const [tab, setTab] = useState('decode');
  const [token, setToken] = useState(SAMPLE);
  const [key, setKey] = useState('');
  const [secretEnc, setSecretEnc] = useState('text');
  const [verifyState, setVerifyState] = useState(null); // { for, res }
  const [verifying, setVerifying] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [expIss, setExpIss] = useState('');
  const [expAud, setExpAud] = useState('');
  const [expSub, setExpSub] = useState('');
  const [leeway, setLeeway] = useState('0');
  const [jwksBusy, setJwksBusy] = useState(false);
  const [jwksMsg, setJwksMsg] = useState('');

  // Sign tab
  const [sAlg, setSAlg] = useState('HS256');
  const [sHeader, setSHeader] = useState('{\n  "typ": "JWT"\n}');
  const [sPayload, setSPayload] = useState(() => JSON.stringify({ sub: '1234567890', name: 'John Doe', iat: Math.floor(Date.now() / 1000) }, null, 2));
  const [sKey, setSKey] = useState('');
  const [sEnc, setSEnc] = useState('text');
  const [signed, setSigned] = useState('');
  const [signError, setSignError] = useState('');
  const [signing, setSigning] = useState(false);

  // Keep "expires in" live.
  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const decoded = useMemo(() => {
    try { return { value: decodeJwt(token), error: '' }; }
    catch (e) { return { value: null, error: e.message }; }
  }, [token]);

  const claims = useMemo(
    () => (decoded.value ? analyzeClaims(decoded.value.payload, nowSec, { leeway, iss: expIss, aud: expAud, sub: expSub }) : []),
    [decoded.value, nowSec, leeway, expIss, expAud, expSub],
  );
  const warnings = useMemo(() => (decoded.value ? headerWarnings(decoded.value.header) : []), [decoded.value]);
  const alg = decoded.value?.header?.alg;
  const isHmac = /^HS/.test(typeof alg === 'string' ? alg : '');
  const header = decoded.value?.header;

  // A verify result only counts for the exact token + key + encoding it was computed from.
  const inputKey = `${token}\u0000${key}\u0000${secretEnc}`;
  const verifyResult = verifyState && verifyState.for === inputKey ? verifyState.res : null;

  const doVerify = async () => {
    if (!decoded.value) return;
    const forKey = inputKey;
    setVerifying(true);
    const res = await verifyJwt(decoded.value, key, { secretEncoding: secretEnc });
    setVerifyState({ for: forKey, res });
    setVerifying(false);
    onLogMessage?.(`JWT verify (${res.alg}): ${res.ok ? 'signature valid' : 'not verified'}`);
  };

  const fetchFromJku = async () => {
    setJwksBusy(true); setJwksMsg('');
    try {
      const doc = await fetchJwks(header.jku, proxiedFetch);
      setKey(JSON.stringify(doc, null, 2));
      setJwksMsg(`Loaded ${doc.keys.length} key(s) from jku.`);
    } catch (e) { setJwksMsg(describeNetworkError(e)); }
    setJwksBusy(false);
  };

  const fetchFromIss = async () => {
    setJwksBusy(true); setJwksMsg('');
    try {
      const { jwks, url } = await fetchJwksForIssuer(decoded.value.payload.iss, proxiedFetch);
      setKey(JSON.stringify(jwks, null, 2));
      setJwksMsg(`Loaded ${jwks.keys.length} key(s) from ${url}.`);
    } catch (e) { setJwksMsg(describeNetworkError(e)); }
    setJwksBusy(false);
  };

  const doSign = async () => {
    setSigning(true); setSignError(''); setSigned('');
    try {
      const t = await signJwt({ alg: sAlg, header: sHeader, payload: sPayload, key: sKey, secretEncoding: sEnc });
      setSigned(t);
      onLogMessage?.(`JWT sign (${sAlg}): ok`);
    } catch (e) {
      setSignError(e.message);
      onLogMessage?.(`JWT sign (${sAlg}): failed`);
    }
    setSigning(false);
  };

  const useSigned = () => {
    setToken(signed);
    if (/^HS/.test(sAlg)) { setKey(sKey); setSecretEnc(sEnc); }
    setTab('decode');
  };

  const parts = decoded.value?.parts;
  const issString = typeof decoded.value?.payload?.iss === 'string' && decoded.value.payload.iss.startsWith('https://');
  const sIsHmac = /^HS/.test(sAlg);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="flex rounded overflow-hidden border border-slate-800 text-xs w-fit mb-3">
        {[['decode', 'Decode / Verify', Search], ['sign', 'Encode / Sign', PenLine]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 inline-flex items-center gap-1.5 ${tab === id ? 'bg-cyan-900/50 text-cyan-200' : 'bg-slate-900 text-gray-400 hover:text-gray-200'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'sign' && (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[10px] uppercase tracking-wide text-slate-500" htmlFor="jwt-sign-alg">Algorithm</label>
              <select id="jwt-sign-alg" value={sAlg} onChange={(e) => setSAlg(e.target.value)} className={inputCls}>
                {SIGN_ALGS.map((a) => <option key={a} value={a}>{a}</option>)}
                <option value="none">none (unsigned, testing only)</option>
              </select>
            </div>
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Header (alg is set from the selector)</div>
            <textarea value={sHeader} onChange={(e) => setSHeader(e.target.value)} spellCheck={false} rows={4} className={`w-full resize-y ${inputCls}`} />
            <div className="text-[10px] uppercase tracking-wide text-slate-500 mt-2 mb-1">Payload</div>
            <textarea value={sPayload} onChange={(e) => setSPayload(e.target.value)} spellCheck={false} rows={8} className={`w-full resize-y ${inputCls}`} />
          </div>
          <div>
            {sAlg !== 'none' && (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] uppercase tracking-wide text-slate-500">{sIsHmac ? 'Secret' : 'Private key'}</span>
                  {sIsHmac && (
                    <select value={sEnc} onChange={(e) => setSEnc(e.target.value)} aria-label="Secret encoding" className={inputCls}>
                      {ENCODINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  )}
                </div>
                <textarea
                  value={sKey}
                  onChange={(e) => setSKey(e.target.value)}
                  spellCheck={false}
                  rows={6}
                  placeholder={sIsHmac ? 'HMAC shared secret (or an "oct" JWK)' : 'PKCS#8 PEM private key (-----BEGIN PRIVATE KEY-----) or private JWK'}
                  className={`w-full resize-y ${inputCls}`}
                />
              </>
            )}
            {sAlg === 'none' && <div className="p-2 border border-amber-800 rounded bg-amber-950/20 text-xs text-amber-300 flex items-center gap-1.5"><ShieldAlert size={14} /> An unsigned token has an empty signature. Use it only to test that your verifier rejects it.</div>}
            <div className="flex items-center gap-2 mt-2">
              <button onClick={doSign} disabled={signing} className={btnCls}><PenLine size={13} /> {signing ? 'Signing…' : 'Sign'}</button>
            </div>
            {signError && <div className="mt-2 p-2 border border-red-900 rounded bg-red-950/30 text-xs text-red-300">{signError}</div>}
            {signed && (
              <div className="mt-2">
                <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Signed token</div>
                <textarea readOnly value={signed} rows={5} className={`w-full break-all ${inputCls}`} />
                <div className="flex gap-2 mt-1">
                  <button onClick={() => navigator.clipboard?.writeText(signed)} className={btnCls}><Copy size={13} /> Copy</button>
                  <button onClick={useSigned} className={btnCls}><Search size={13} /> Open in decoder</button>
                </div>
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-2">Signing happens in your browser with Web Crypto. Keys and secrets are never logged or sent anywhere. Private keys must be PKCS#8 PEM or JWK.</p>
          </div>
        </div>
      )}

      {tab === 'decode' && (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(20rem,1fr))]">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Encoded token</div>
              <textarea
                value={token}
                onChange={(e) => setToken(e.target.value)}
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

          {warnings.length > 0 && (
            <div className="mt-3 space-y-1">
              {warnings.map((w) => (
                <div key={w} className="p-2 border border-amber-800 rounded bg-amber-950/20 text-xs text-amber-300 flex items-start gap-1.5"><ShieldAlert size={14} className="shrink-0 mt-0.5" /> {w}</div>
              ))}
            </div>
          )}

          {decoded.value && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Claim checks (independent of the signature)</div>
              <div className="flex flex-wrap items-center gap-2 mb-2 text-[11px]">
                <input value={expIss} onChange={(e) => setExpIss(e.target.value)} placeholder="expected iss" aria-label="Expected issuer" className={`w-44 ${inputCls}`} />
                <input value={expAud} onChange={(e) => setExpAud(e.target.value)} placeholder="expected aud" aria-label="Expected audience" className={`w-44 ${inputCls}`} />
                <input value={expSub} onChange={(e) => setExpSub(e.target.value)} placeholder="expected sub" aria-label="Expected subject" className={`w-44 ${inputCls}`} />
                <label className="inline-flex items-center gap-1 text-slate-400">leeway
                  <input type="number" min="0" value={leeway} onChange={(e) => setLeeway(e.target.value)} className={`w-16 ${inputCls}`} /> s
                </label>
              </div>
              {claims.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {claims.map((c) => (
                    <div key={`${c.claim}-${c.detail}`} className={`px-2 py-1 rounded border text-[11px] ${c.ok ? 'border-emerald-800 bg-emerald-950/20 text-emerald-300' : 'border-red-800 bg-red-950/20 text-red-300'}`}>
                      <span className="font-semibold">{c.label}</span> ({c.claim}) · {c.when} · {c.detail}{c.human ? ` (${c.human})` : ''}
                    </div>
                  ))}
                </div>
              ) : <div className="text-xs text-slate-500">No exp / nbf / iat claims in this token. Enter expected iss / aud / sub above to check them.</div>}
            </div>
          )}

          {decoded.value && (
            <div className="mt-3">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1">Verify signature {alg && <span className="text-slate-400">· alg: {String(alg)}</span>}</div>
              {typeof alg === 'string' && alg.toLowerCase() === 'none' && (
                <div className="mb-2 p-2 border border-amber-800 rounded bg-amber-950/20 text-xs text-amber-300 flex items-center gap-1.5">
                  <ShieldAlert size={14} /> This token declares <code>"alg":"{alg}"</code> — it is unsigned. Never accept unsigned tokens in production.
                </div>
              )}
              {isHmac && (
                <div className="flex items-center gap-2 mb-1 text-[11px] text-slate-400">
                  Secret encoding
                  <select value={secretEnc} onChange={(e) => setSecretEnc(e.target.value)} aria-label="Secret encoding" className={inputCls}>
                    {ENCODINGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              )}
              <textarea
                value={key}
                onChange={(e) => setKey(e.target.value)}
                spellCheck={false}
                rows={3}
                placeholder={isHmac ? 'HMAC shared secret (or an "oct" JWK)' : 'PEM public key / certificate, JWK, or a JWKS (the key is chosen by the token kid)'}
                className="w-full bg-slate-900 border border-slate-800 rounded p-2 text-xs font-mono resize-y"
              />
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <button onClick={doVerify} disabled={verifying} className={btnCls}>
                  <KeyRound size={13} /> {verifying ? 'Verifying…' : 'Verify'}
                </button>
                {header?.jku && typeof header.jku === 'string' && (
                  <button onClick={fetchFromJku} disabled={jwksBusy} title={`Fetch ${header.jku}`} className={btnCls}>
                    <CloudDownload size={13} /> Fetch JWKS from jku (untrusted)
                  </button>
                )}
                {issString && (
                  <button onClick={fetchFromIss} disabled={jwksBusy} title={`Discover keys from ${decoded.value.payload.iss}`} className={btnCls}>
                    <CloudDownload size={13} /> Fetch JWKS from iss
                  </button>
                )}
                {verifyResult && (
                  <span className={`inline-flex items-center gap-1 text-xs ${verifyResult.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                    {verifyResult.ok ? <ShieldCheck size={14} /> : <ShieldX size={14} />} {verifyResult.reason}
                  </span>
                )}
              </div>
              {jwksMsg && <div className="text-[11px] text-slate-400 mt-1">{jwksMsg}</div>}
              {verifyResult && verifyResult.notes?.length > 0 && <div className="text-[11px] text-slate-400 mt-1">{verifyResult.notes.join(' ')}</div>}
              {verifyResult && verifyResult.warnings?.filter((w) => !warnings.includes(w)).map((w) => (
                <div key={w} className="mt-1 p-2 border border-amber-800 rounded bg-amber-950/20 text-xs text-amber-300 flex items-start gap-1.5"><ShieldAlert size={14} className="shrink-0 mt-0.5" /> {w}</div>
              ))}
              <p className="text-[10px] text-slate-500 mt-1">
                HS* uses the shared secret; RS*/PS*/ES*/EdDSA use the <strong>public</strong> key (PEM SPKI, certificate, JWK or JWKS). Verification runs in
                the browser via Web Crypto — the secret/key never leaves this page. The signature result clears whenever the token, key or encoding changes.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
