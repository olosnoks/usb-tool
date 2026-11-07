# Web Analyzer

**Purpose**: Analyze a web URL from one tool (merges the URL/Link Analyzer, Web
Scanner and Web Path Prober), sharing a single proxy bar. Three tabs:

- **Links & Resources** — fetch a page and map its links, scripts, stylesheets,
  images, forms (with inputs) and meta, plus a security-header assessment
  (HSTS/CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/
  Permissions-Policy). Export JSON.
- **Passive Scan** — passive findings from the target's response: headers,
  cookies, transport/TLS and CORS.
- **Path Prober** — probe common sensitive paths from a wordlist (SecLists via
  the shared picker, or a built-in list) and flag interesting responses.

**Implementation**: `src/components/tools/WebAnalyzerWorkbench.jsx` wraps the
existing `UrlInspectorWorkbench`, `OwaspZapWorkbench` and `NiktoScannerWorkbench`
(each rendered without its own proxy bar; all stay mounted so switching tabs
keeps their state). URL extractors in `src/utils/urlinspect.js` are verified in
`tests/urlinspect.test.js`.

**Notes**: The legacy ids `url-inspector`, `owasp-zap` and `nikto-scanner` still
open this tool at the matching tab. Requests go through `fetch` and are
CORS-limited; set a proxy to reach arbitrary hosts. Analyze only targets you own
or are authorized to assess.
