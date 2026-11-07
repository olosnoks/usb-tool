# Web Security Scanner Workbench (OWASP ZAP-style)

**Purpose**: Assess a web target's security posture from the browser.

**How it works**: By default it runs a real **passive scan**
(`src/utils/webScan.js`) on the target's HTTP response, reporting findings with a
severity and CWE:

- Cleartext HTTP, missing HSTS (CWE-319).
- Missing Content-Security-Policy and X-Frame-Options / clickjacking (CWE-693, 1021).
- Missing X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Information disclosure via Server, X-Powered-By, X-AspNet-Version (CWE-200).
- Permissive CORS, including `*` with credentials (CWE-942).
- Insecure cookies: missing Secure / HttpOnly / SameSite (CWE-614, 1004, 1275).

**Active scanning** (crafting malicious requests) cannot be done from a browser. If
a WebAssembly engine is present at `public/wasm/zap.wasm` its findings are merged in.
See [docs/WASM_ENGINES.md](../../docs/WASM_ENGINES.md).

**Usage**:
- Optionally set a proxy (empty = direct).
- Enter a target URL and click **Start Scan**. Findings are listed by severity.

**Honest limitations**:
- Reading cross-origin response headers requires CORS. Without a proxy, most
  targets expose only a few headers, so the passive scan is incomplete; a proxy
  returns the full response for analysis.
- Browsers strip `Set-Cookie` from `fetch` responses, so cookie-flag checks only
  fire when a proxy forwards that header.
- This is a passive posture check, not a full active vulnerability scan.
