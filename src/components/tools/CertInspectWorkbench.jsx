import React, { useState } from 'react';
import { parseCertificate, toDER } from '../../utils/x509';

/**
 * X.509 certificate inspector. Accepts a PEM or DER file, parses the certificate
 * fields (subject, issuer, validity, serial, algorithms, subjectAltName) and
 * computes SHA-256 and SHA-1 fingerprints. All parsing is client-side.
 */
export default function CertInspectWorkbench({ onLogMessage }) {
  const [info, setInfo] = useState(null);
  const [fingerprints, setFingerprints] = useState(null);
  const [error, setError] = useState(null);

  const log = (msg) => onLogMessage?.(msg);

  const fingerprint = async (der, alg) => {
    const buf = await crypto.subtle.digest(alg, der);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
  };

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const buf = ev.target.result; // ArrayBuffer
        const bytes = new Uint8Array(buf);
        // Detect PEM by looking for the "-----BEGIN" marker in the leading bytes.
        const head = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
        const der = head.includes('-----BEGIN') ? toDER(new TextDecoder().decode(bytes)) : bytes;
        const parsed = parseCertificate(der);
        setInfo(parsed);
        setFingerprints({
          sha256: await fingerprint(der, 'SHA-256'),
          sha1: await fingerprint(der, 'SHA-1'),
          size: der.length,
        });
        setError(null);
        log(`Parsed certificate for ${parsed.subject}`);
      } catch (err) {
        setError(err.message);
        setInfo(null);
        setFingerprints(null);
        log(`Cert parse error: ${err.message}`);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const Row = ({ label, value, cls = '' }) => (
    <tr><td className="p-1 border border-slate-700 bg-slate-800 text-slate-200 align-top whitespace-nowrap">{label}</td><td className={`p-1 border border-slate-700 break-all ${cls}`}>{value}</td></tr>
  );

  return (
    <div className="p-4 space-y-4 font-mono text-xs">
      <p className="text-sm text-gray-400 font-sans">Load a PEM or DER certificate to view its fields and fingerprints.</p>
      <input type="file" accept=".pem,.crt,.cer,.der" onChange={handleFile} className="bg-slate-900 border border-slate-800 rounded p-1 text-gray-200" />
      {error && <p className="text-red-400">Error: {error}</p>}
      {info && (
        <table className="w-full border-collapse text-sm">
          <tbody>
            <Row label="Subject" value={info.subject} />
            <Row label="Issuer" value={info.issuer} />
            <Row label="Valid from" value={info.notBefore.toISOString()} />
            <Row label="Valid to" value={info.notAfter.toISOString()} cls={info.expired ? 'text-red-400' : info.notYetValid ? 'text-yellow-400' : 'text-green-400'} />
            <Row label="Status" value={info.expired ? 'EXPIRED' : info.notYetValid ? 'NOT YET VALID' : 'Valid'} cls={info.expired || info.notYetValid ? 'text-red-400' : 'text-green-400'} />
            <Row label="Version" value={`v${info.version}`} />
            <Row label="Serial" value={info.serial} />
            <Row label="Signature alg" value={info.signatureAlgorithm} />
            <Row label="Public key alg" value={info.publicKeyAlgorithm} />
            {info.subjectAltNames.length > 0 && <Row label="SAN" value={info.subjectAltNames.join(', ')} />}
            {fingerprints && <Row label="SHA-256" value={fingerprints.sha256} />}
            {fingerprints && <Row label="SHA-1" value={fingerprints.sha1} />}
            {fingerprints && <Row label="DER size" value={`${fingerprints.size} bytes`} />}
          </tbody>
        </table>
      )}
    </div>
  );
}
