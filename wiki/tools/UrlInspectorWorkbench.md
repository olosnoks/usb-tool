# URL / Link Analyzer

**Purpose**: Fetch a page and map what it references — read-only recon of a
single URL.

**Usage**: Enter a URL and Analyze. Shows the response status/size/timing and
final URL, a security-header assessment (HSTS, CSP, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy), the page title and
meta tags, and de-duplicated absolute lists of links, scripts, stylesheets,
images and forms (with their inputs). Export the full analysis as JSON.

**Implementation**: pure regex extractors in `src/utils/urlinspect.js`
(title/links/resources/meta/forms + header assessment), verified in
`tests/urlinspect.test.js`; the component fetches via the shared proxy.

**Notes**: Most sites block cross-origin browser requests, so a proxy is usually
needed. It fetches once and parses — nothing is submitted. Analyze only sites you
own or are authorized to assess.
