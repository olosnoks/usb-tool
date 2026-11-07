# Certificate Inspector

**Purpose**: Inspect X.509 (TLS/SSL) certificates from three sources, fully
client-side.

**Sources**:
- **From URL** — enter a hostname; the tool pulls that host's certificates from
  Certificate Transparency logs (crt.sh), lists the most recent, and parses the
  one you pick. Requires the proxy (crt.sh has no CORS). CT logs show the most
  recent *issued* certificate, which can differ from the one the server serves
  right now.
- **From file** — load a `.pem`/`.crt`/`.cer`/`.der` (PEM or DER auto-detected).
- **Paste PEM** — paste certificate text; bundles/chains are split and each cert
  is selectable.

**Fields parsed**: subject & issuer DNs, self-signed detection, validity window
with days-until-expiry (amber ≤ 30 days) and total validity period, version,
serial, signature algorithm, public key (RSA key size / EC curve / exponent),
subjectAltName (DNS/email/URI/IPv4/IPv6), key usage, extended key usage, basic
constraints (CA / pathlen), subject & authority key identifiers, CRL
distribution points, OCSP and CA-Issuer URLs, and which extensions are critical.
SHA-256 / SHA-1 fingerprints via Web Crypto, and a re-export to PEM.

**Implementation**: `src/utils/x509.js` — dependency-free DER/ASN.1 parser,
verified in `tests/x509.test.js` against OpenSSL-generated RSA CA and EC leaf
certificates (SAN, EKU, key usage, basic constraints, curve, key size, chain
split). The component fetches CT certs via `src/utils/netClient.js`.

**Notes**: It parses and displays fields; it does not validate the chain,
signatures, revocation or hostname binding. Inspect only certificates you are
authorized to review.
