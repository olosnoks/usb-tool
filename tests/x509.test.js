import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCertificate, toDER, splitPemChain } from '../src/utils/x509.js';

let haveOpenssl = true;
let leafDer; let caDer; let bundlePem;

beforeAll(() => {
  let dir;
  try {
    dir = mkdtempSync(join(tmpdir(), 'x509-'));
    const P = (f) => join(dir, f);
    // Self-signed RSA CA
    execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${P('ca.key')} -out ${P('ca.pem')} -days 3650 -subj "/C=US/O=Test CA/CN=Test Root CA" -addext "basicConstraints=critical,CA:TRUE,pathlen:1" -addext "keyUsage=critical,keyCertSign,cRLSign"`, { stdio: 'ignore' });
    // EC leaf signed by CA, with SAN + EKU + keyUsage
    execSync(`openssl ecparam -name prime256v1 -genkey -noout -out ${P('leaf.key')}`, { stdio: 'ignore' });
    execSync(`openssl req -new -key ${P('leaf.key')} -out ${P('leaf.csr')} -subj "/C=US/O=Example/CN=example.com"`, { stdio: 'ignore' });
    const ext = `subjectAltName=DNS:example.com,DNS:www.example.com,IP:10.0.0.1\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth,clientAuth\nbasicConstraints=CA:FALSE`;
    execSync(`printf '%b' ${JSON.stringify(ext)} > ${P('leaf.ext')}`, { stdio: 'ignore', shell: '/bin/bash' });
    execSync(`openssl x509 -req -in ${P('leaf.csr')} -CA ${P('ca.pem')} -CAkey ${P('ca.key')} -CAcreateserial -out ${P('leaf.pem')} -days 365 -extfile ${P('leaf.ext')}`, { stdio: 'ignore' });
    leafDer = toDER(readFileSync(P('leaf.pem'), 'utf8'));
    caDer = toDER(readFileSync(P('ca.pem'), 'utf8'));
    bundlePem = readFileSync(P('leaf.pem'), 'utf8') + readFileSync(P('ca.pem'), 'utf8');
  } catch { haveOpenssl = false; }
  finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
});

describe('x509 leaf', () => {
  it('parses subject/issuer and detects CA-signed', () => {
    if (!haveOpenssl) return;
    const c = parseCertificate(leafDer);
    expect(c.subject).toContain('CN=example.com');
    expect(c.issuer).toContain('CN=Test Root CA');
    expect(c.selfSigned).toBe(false);
    expect(c.isCA).toBe(false);
  });

  it('reads EC public key with its curve', () => {
    if (!haveOpenssl) return;
    const c = parseCertificate(leafDer);
    expect(c.publicKeyAlgorithm).toBe('EC');
    expect(c.publicKey.curve).toMatch(/P-256/);
  });

  it('extracts SAN, key usage and EKU', () => {
    if (!haveOpenssl) return;
    const c = parseCertificate(leafDer);
    expect(c.subjectAltNames).toEqual(expect.arrayContaining(['DNS:example.com', 'DNS:www.example.com', 'IP:10.0.0.1']));
    expect(c.keyUsage).toContain('digitalSignature');
    expect(c.extKeyUsage).toEqual(expect.arrayContaining(['serverAuth', 'clientAuth']));
    expect(c.criticalExtensions).toContain('keyUsage');
  });

  it('computes validity window', () => {
    if (!haveOpenssl) return;
    const c = parseCertificate(leafDer);
    expect(c.expired).toBe(false);
    expect(c.daysUntilExpiry).toBeGreaterThan(300);
    expect(c.validityDays).toBeGreaterThanOrEqual(364);
  });
});

describe('x509 CA', () => {
  it('is self-signed with RSA key and CA basic constraints', () => {
    if (!haveOpenssl) return;
    const c = parseCertificate(caDer);
    expect(c.selfSigned).toBe(true);
    expect(c.isCA).toBe(true);
    expect(c.basicConstraints).toMatchObject({ ca: true, pathLen: 1 });
    expect(c.publicKeyAlgorithm).toBe('RSA');
    expect(c.publicKey.bits).toBe(2048);
    expect(c.keyUsage).toEqual(expect.arrayContaining(['keyCertSign', 'cRLSign']));
  });
});

describe('splitPemChain', () => {
  it('splits a bundle into individual certs', () => {
    if (!haveOpenssl) return;
    const blocks = splitPemChain(bundlePem);
    expect(blocks.length).toBe(2);
    expect(parseCertificate(toDER(blocks[0])).subject).toContain('example.com');
    expect(parseCertificate(toDER(blocks[1])).isCA).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DAT-3: chain building, signatures, hostname, pins, extensions, bundles
// ---------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildChain, verifyCertSignature, matchHostname, spkiPin, weaknessHints, loadCertificateBundle, pemFromDer, extractCertsFromPkcs7 } from '../src/utils/x509.js';

let fx = null;
function makeFixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'x509c-'));
  const run = (...args) => execFileSync('openssl', args, { cwd: dir, stdio: 'pipe' });
  const w = (f, t) => writeFileSync(join(dir, f), t);
  try {
    // RSA root -> ECDSA P-384 intermediate -> ECDSA P-256 leaf
    run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'root.key', '-out', 'root.pem', '-days', '3650', '-subj', '/O=Fx/CN=Fx Root', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-addext', 'subjectKeyIdentifier=hash');
    w('int.ext', 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid\ncertificatePolicies=2.23.140.1.2.1,1.2.3.4.5\nnameConstraints=permitted;DNS:example.com,excluded;DNS:bad.example.com\n');
    run('ecparam', '-name', 'secp384r1', '-genkey', '-noout', '-out', 'int.key');
    run('req', '-new', '-key', 'int.key', '-out', 'int.csr', '-subj', '/O=Fx/CN=Fx Intermediate');
    run('x509', '-req', '-in', 'int.csr', '-CA', 'root.pem', '-CAkey', 'root.key', '-CAcreateserial', '-out', 'int.pem', '-days', '1800', '-sha256', '-extfile', 'int.ext');
    w('leaf.ext', 'basicConstraints=CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:example.com,DNS:*.example.com,IP:10.0.0.1\nauthorityKeyIdentifier=keyid\nsubjectKeyIdentifier=hash\ntlsfeature=status_request\n1.2.3.4.5.6=DER:0403010203\n');
    run('ecparam', '-name', 'prime256v1', '-genkey', '-noout', '-out', 'leaf.key');
    run('req', '-new', '-key', 'leaf.key', '-out', 'leaf.csr', '-subj', '/O=Fx/CN=example.com');
    run('x509', '-req', '-in', 'leaf.csr', '-CA', 'int.pem', '-CAkey', 'int.key', '-CAcreateserial', '-out', 'leaf.pem', '-days', '90', '-sha256', '-extfile', 'leaf.ext');
    const pem = (f) => readFileSync(join(dir, f), 'utf8');
    const out = { leafPem: pem('leaf.pem'), intPem: pem('int.pem'), rootPem: pem('root.pem') };
    // Same pipeline as the acceptance criterion, done with openssl then hashed here.
    const pubDer = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { cwd: dir, input: execFileSync('openssl', ['x509', '-in', 'leaf.pem', '-pubkey', '-noout'], { cwd: dir }) });
    out.pinOpenssl = createHash('sha256').update(pubDer).digest('base64');
    try {
      run('crl2pkcs7', '-nocrl', '-certfile', 'int.pem', '-certfile', 'leaf.pem', '-certfile', 'root.pem', '-outform', 'DER', '-out', 'b.p7b');
      out.p7b = new Uint8Array(readFileSync(join(dir, 'b.p7b')));
    } catch { out.p7b = null; }
    try {
      run('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'pss.key', '-out', 'pss.pem', '-days', '30', '-subj', '/CN=pss', '-sha256', '-sigopt', 'rsa_padding_mode:pss', '-sigopt', 'rsa_pss_saltlen:32');
      out.pssPem = pem('pss.pem');
    } catch { out.pssPem = null; }
    try {
      run('genpkey', '-algorithm', 'ed25519', '-out', 'ed.key');
      run('req', '-x509', '-key', 'ed.key', '-out', 'ed.pem', '-days', '30', '-subj', '/CN=ed');
      out.edPem = pem('ed.pem');
    } catch { out.edPem = null; }
    return out;
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}
try { fx = makeFixtures(); } catch { fx = null; }
const hasFx = !!fx;
const D = (pem) => toDER(pem);

describe('chain building (needs openssl)', () => {
  it.skipIf(!hasFx)('fixtures were generated', () => { expect(fx.leafPem).toContain('BEGIN CERTIFICATE'); });

  it.skipIf(!hasFx)('lists all three certs of a bundle and validates the chain (any input order)', async () => {
    const ders = loadCertificateBundle(fx.rootPem + fx.leafPem + fx.intPem);
    expect(ders).toHaveLength(3);
    const r = await buildChain(ders);
    expect(r.chain.map((e) => e.parsed.subject)).toEqual(['O=Fx, CN=example.com', 'O=Fx, CN=Fx Intermediate', 'O=Fx, CN=Fx Root']);
    expect(r.chain.every((e) => e.sig.ok === true)).toBe(true);
    expect(r.chain[2].selfSigned).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.valid).toBe(true);
  });

  it.skipIf(!hasFx)('reports a missing intermediate', async () => {
    const r = await buildChain([D(fx.leafPem), D(fx.rootPem)]);
    expect(r.valid).toBe(false);
    expect(r.chain).toHaveLength(1);
    expect(r.chain[0].issuerMissing).toBe(true);
    expect(r.problems.join(' ')).toMatch(/issuer certificate not found/);
    expect(r.unused).toEqual([1]);
  });

  it.skipIf(!hasFx)('fails the signature of a tampered certificate', async () => {
    const leaf = D(fx.leafPem).slice();
    const needle = Array.from(new TextEncoder().encode('example.com'));
    let at = -1;
    for (let i = 0; i < leaf.length - needle.length; i++) { if (needle.every((b, k) => leaf[i + k] === b)) { at = i; break; } }
    expect(at).toBeGreaterThan(0);
    leaf[at] ^= 0x01; // one flipped byte inside the TBS (subject CN)
    const r = await buildChain([leaf, D(fx.intPem), D(fx.rootPem)]);
    expect(r.chain[0].sig.ok).toBe(false);
    expect(r.valid).toBe(false);
    expect(r.problems.join(' ')).toMatch(/signature check failed/);
  });

  it.skipIf(!hasFx)('verifies RSA and ECDSA (DER to raw) links directly', async () => {
    const root = parseCertificate(D(fx.rootPem)); const inter = parseCertificate(D(fx.intPem)); const leaf = parseCertificate(D(fx.leafPem));
    expect((await verifyCertSignature(inter, root)).ok).toBe(true); // RSA PKCS#1 v1.5
    expect((await verifyCertSignature(leaf, inter)).ok).toBe(true); // ECDSA P-384 key, SHA-256
    expect((await verifyCertSignature(leaf, root)).ok).toBe(false); // wrong issuer
  });

  it.skipIf(!hasFx)('verifies an RSASSA-PSS self-signed certificate', async () => {
    if (!fx.pssPem) return;
    const c = parseCertificate(D(fx.pssPem));
    expect(c.signatureAlgorithm).toBe('RSASSA-PSS');
    expect((await verifyCertSignature(c, c)).ok).toBe(true);
  });

  it.skipIf(!hasFx)('verifies an Ed25519 self-signed certificate where supported', async () => {
    if (!fx.edPem) return;
    const c = parseCertificate(D(fx.edPem));
    const r = await verifyCertSignature(c, c);
    expect([true, null]).toContain(r.ok);
  });

  it.skipIf(!hasFx)('reads every certificate of a PKCS#7 bundle', async () => {
    if (!fx.p7b) return;
    expect(extractCertsFromPkcs7(fx.p7b)).toHaveLength(3);
    const ders = loadCertificateBundle(fx.p7b);
    expect(ders).toHaveLength(3);
    expect((await buildChain(ders)).valid).toBe(true);
  });

  it.skipIf(!hasFx)('SPKI pin equals the openssl pipeline', async () => {
    expect(await spkiPin(parseCertificate(D(fx.leafPem)))).toBe(fx.pinOpenssl);
  });

  it.skipIf(!hasFx)('decodes policies, name constraints, must-staple and shows unknown extensions as OID + hex', () => {
    const inter = parseCertificate(D(fx.intPem));
    expect(inter.certificatePolicies.map((p) => p.oid)).toEqual(['2.23.140.1.2.1', '1.2.3.4.5']);
    expect(inter.certificatePolicies[0].name).toMatch(/DV/);
    expect(inter.nameConstraints).toEqual({ permitted: ['DNS:example.com'], excluded: ['DNS:bad.example.com'] });
    const leaf = parseCertificate(D(fx.leafPem));
    expect(leaf.mustStaple).toBe(true);
    expect(leaf.tlsFeatures).toEqual([5]);
    const unk = leaf.unknownExtensions.find((u) => u.oid === '1.2.3.4.5.6');
    expect(unk).toBeTruthy();
    expect(unk.hex).toBe('0403010203');
  });

  it.skipIf(!hasFx)('weakness hints: no SAN and long validity are flagged only where they apply', () => {
    const leaf = parseCertificate(D(fx.leafPem));
    expect(weaknessHints(leaf)).toEqual([]);
    const root = parseCertificate(D(fx.rootPem));
    expect(weaknessHints({ ...root, isCA: false, validityDays: 500, subjectAltNames: [] }).map((h) => h.text).join(' ')).toMatch(/398 days[\s\S]*No subjectAltName/);
  });
});

describe('hostname matching (RFC 6125)', () => {
  const cert = (names, cn = null) => ({ subjectAltNames: names, subjectCN: cn });
  it('wildcard matches exactly one label', () => {
    const c = cert(['DNS:*.example.com']);
    expect(matchHostname(c, 'a.example.com').match).toBe(true);
    expect(matchHostname(c, 'A.Example.COM.').match).toBe(true);
    expect(matchHostname(c, 'a.b.example.com').match).toBe(false);
    expect(matchHostname(c, 'example.com').match).toBe(false);
  });
  it('rejects partial and over-broad wildcards', () => {
    expect(matchHostname(cert(['DNS:*.com']), 'example.com').match).toBe(false);
    expect(matchHostname(cert(['DNS:f*.example.com']), 'foo.example.com').match).toBe(false);
    expect(matchHostname(cert(['DNS:a.*.example.com']), 'a.b.example.com').match).toBe(false);
  });
  it('uses the CN only when there is no SAN', () => {
    expect(matchHostname(cert([], 'legacy.example.com'), 'legacy.example.com')).toMatchObject({ match: true, via: 'CN' });
    expect(matchHostname(cert(['DNS:other.example.com'], 'legacy.example.com'), 'legacy.example.com').match).toBe(false);
  });
  it('matches IPs against IP SANs only', () => {
    const c = cert(['IP:10.0.0.1', 'IP:2001:0db8:0000:0000:0000:0000:0000:0001'], '10.0.0.2');
    expect(matchHostname(c, '10.0.0.1').match).toBe(true);
    expect(matchHostname(c, '10.0.0.2').match).toBe(false);
    expect(matchHostname(c, '[2001:db8::1]').match).toBe(true);
  });
  it('empty host is not a match', () => { expect(matchHostname(cert(['DNS:a.com']), '  ').match).toBe(false); });
  it.skipIf(!hasFx)('works on a parsed fixture', () => {
    const leaf = parseCertificate(D(fx.leafPem));
    expect(matchHostname(leaf, 'x.example.com').match).toBe(true);
    expect(matchHostname(leaf, 'x.y.example.com').match).toBe(false);
  });
});

describe('PEM output', () => {
  it('handles very large DER without overflowing the stack and round-trips', () => {
    const big = new Uint8Array(3_000_000).map((_, i) => i % 251);
    const pem = pemFromDer(big);
    expect(pem.startsWith('-----BEGIN CERTIFICATE-----\n')).toBe(true);
    expect(pem.trimEnd().endsWith('-----END CERTIFICATE-----')).toBe(true);
    const back = toDER(pem);
    expect(back.length).toBe(big.length);
    expect(createHash('sha256').update(back).digest('hex')).toBe(createHash('sha256').update(big).digest('hex'));
  });
});

describe('CertInspectWorkbench', () => {
  it('renders with the file and paste modes', async () => {
    const React = (await import('react')).default;
    const { renderToString } = await import('react-dom/server');
    const mod = await import('../src/components/tools/CertInspectWorkbench.jsx');
    const html = renderToString(React.createElement(mod.default, {}));
    expect(html).toContain('From file');
    expect(html).toContain('Paste PEM');
  });
});
