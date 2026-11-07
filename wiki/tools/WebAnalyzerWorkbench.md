# Web Analyzer

**Purpose**: Analyze a web URL from one tool (merges the URL/Link Analyzer, Web
Scanner and Web Path Prober), sharing a single proxy bar. Three tabs:

- **Links & Resources** — fetch a page and map its links, scripts, stylesheets,
  images, forms (with inputs) and meta, plus a security-header assessment
  (HSTS/CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/
  Permissions-Policy). Export JSON.
- **Tech Fingerprint** — infer the stack (server, language, CMS, JS frameworks,
  CDN/WAF, analytics) from response headers, HTML markers, Set-Cookie names and
  script URLs, with the evidence for each hit. (OWASP PTK-style.)
- **Passive Scan** — passive findings from the target's response: headers,
  cookies, transport/TLS and CORS.
- **Cookies** — per-cookie Secure / HttpOnly / SameSite analysis with pass/warn
  verdicts, from a live fetch or a pasted Set-Cookie header (browsers hide
  Set-Cookie from fetch() unless a proxy forwards it).
- **Path Prober** — probe common sensitive paths from a wordlist (SecLists via
  the shared picker, or a built-in list) and flag interesting responses.
- **Crawler** — bounded same-origin crawl → sitemap (depth + page caps,
  stoppable), export to `sitemap.txt`.

**Implementation**: `src/components/tools/WebAnalyzerWorkbench.jsx` wraps the
existing `UrlInspectorWorkbench`, `OwaspZapWorkbench` and `NiktoScannerWorkbench`
plus the PTK-style tabs in `src/components/tools/webanalyzer/`
(TechFingerprintTab, CookieAnalyzerTab, CrawlerTab). All stay mounted so
switching tabs keeps their state. Pure logic: `src/utils/urlinspect.js`,
`src/utils/fingerprint.js`, `src/utils/cookies.js` — verified in
`tests/urlinspect.test.js` and `tests/ptkTools.test.js`.

**Export**: the header's **Export report (.md)** button compiles the latest
findings from every tab that has been run into a single Markdown file (target
URLs, per-section results; tabs not yet run are marked "Not run"). A green dot on
a tab indicates it has findings to include.

**Notes**: The legacy ids `url-inspector`, `owasp-zap` and `nikto-scanner` still
open this tool at the matching tab. Requests go through `fetch` and are
CORS-limited; set a proxy to reach arbitrary hosts. Analyze only targets you own
or are authorized to assess.
