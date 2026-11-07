# API Client (OpenAPI) Workbench

**Purpose**: Import an OpenAPI 3 / Swagger 2 spec, browse its endpoints, send
requests, and run schema-based negative fuzzing. Inspired by Hoppscotch, Swagger
UI, and Schemathesis. Fully client-side; requests go through the configurable proxy.

**Import a spec**:
- Paste the spec (JSON or a common subset of YAML) into the box and click **Load
  spec**, or enter a spec URL and **Fetch** it (through the proxy if one is set).
- The base URL is taken from the spec's `servers` (OpenAPI 3) or `host`/`basePath`
  (Swagger 2) and can be edited; a dropdown appears when several servers exist.

**Send requests**:
- Pick an endpoint from the filterable list (method + path + summary).
- Parameter inputs are generated from the spec (path / query / header, required
  flagged). The request body is prefilled with an example built from the schema.
- **Variables**: define `NAME=value` lines and reference them anywhere as
  `{{NAME}}` (base URL, params, body, auth token).
- **Auth**: Bearer, Basic, or API-key header injection.
- **Send** shows the response status, timing, size, and body.

**Schema fuzzing** (Schemathesis-style negative tests):
- **Fuzz endpoint** generates cases from the operation's schema: omitting each
  required parameter, wrong-typed values, injection payloads in string parameters,
  and malformed/empty JSON bodies.
- Results are listed per case; 5xx responses and request errors are highlighted,
  since a well-behaved API should reject bad input with 4xx, not crash with 5xx.

**Implementation**: `src/utils/openapi.js` (spec parsing incl. a small YAML
subset, operation listing, `$ref` resolution, example generation, request building,
fuzz-case generation), `src/utils/netClient.js` (proxy).

**Limitations**:
- YAML support is a subset; complex YAML specs are best provided as JSON.
- Cross-origin requests need CORS or a proxy (same as the other web tools).
- OAuth2 interactive flows are not supported; supply a token via Bearer/variables.
