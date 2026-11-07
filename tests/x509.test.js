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
