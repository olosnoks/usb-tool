# Certificate Inspector Workbench

**Purpose**: Parse and display the fields of an X.509 certificate. Fully
client-side; the file never leaves the browser.

**Usage**:
- Load a certificate file (`.pem`, `.crt`, `.cer`, or `.der`). PEM and DER are both
  detected automatically.
- The tool shows subject, issuer, validity window (with an expired / not-yet-valid
  status), version, serial, signature algorithm, public-key algorithm,
  subjectAltName entries, and SHA-256 / SHA-1 fingerprints.

**Implementation Details**:
- DER/ASN.1 parsing is implemented in `src/utils/x509.js` (no external ASN.1
  dependency). It targets the RFC 5280 certificate structure.
- `toDER()` converts PEM text or raw bytes to DER; the file is read as an
  ArrayBuffer and PEM is detected by the `-----BEGIN` marker.
- Fingerprints use `crypto.subtle.digest`.

**Dependencies**: `src/utils/x509.js`.

**Notes**:
- Verified against OpenSSL-generated certificates including multi-entry SANs.
- The parser reads common fields; it does not validate chains or signatures.
