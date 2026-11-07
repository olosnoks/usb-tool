# HTTP Workbench

**Purpose**: One tool combining the HTTP/HTTPS Repeater and the OpenAPI API
Client, sharing a single proxy bar. An outer switch selects the section:

- **Request Toolkit** (the former HTTP/HTTPS Repeater):
  - *Repeater* — craft HTTP/HTTPS requests, multi-view response, history, curl /
    raw-HTTP import, export to curl.
  - *Intruder* — sniper / battering-ram / pitchfork / cluster-bomb with
    grep-match; payloads from SecLists.
  - *Comparer* — line diff of two responses/texts.
  - *Decoder* — Base64/URL/Hex/HTML, JWT decode, hashing, smart-decode.
- **API Client (OpenAPI)** (the former API Client): import an OpenAPI 3 /
  Swagger 2 spec, browse endpoints, auto-generated param forms and example
  bodies, `{{variables}}` + Bearer/Basic/API-key auth, send via the proxy, and
  schema-based negative fuzzing.

**Implementation**: `src/components/tools/HttpWorkbench.jsx` wraps the existing
`BurpProxyWorkbench` and `ApiClientWorkbench` (each rendered without its own
proxy bar; both stay mounted so switching keeps their state).

**Notes**: The legacy ids `burp-proxy` and `api-client` still open this tool at
the Request / API section respectively. All requests go through `fetch` and are
CORS-limited; set a proxy to reach arbitrary hosts. Test only targets you own or
are authorized to assess.
