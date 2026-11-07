# Web Request Toolkit Workbench

**Purpose**: A Burp-style web request toolkit with three panels: Repeater,
Intruder, and Decoder.

**Network limitation**: A browser cannot act as a transparent intercepting proxy.
Requests go through `fetch` and are CORS-limited; configure a proxy (see the proxy
bar) to reach arbitrary hosts and read their full responses.

## Repeater

- Works over both HTTP and HTTPS. Enter a full `http://` or `https://` URL; a URL
  with no scheme defaults to `https://`.
- Choose a method, enter a URL, add request headers (one `Key: Value` per line)
  and a body for non-GET/HEAD methods.
- **Send** shows the response status, timing, size, headers, and body.
- Every send is kept in **History**; click an entry to restore that request and
  response.

## Intruder (sniper)

- Mark fuzz positions anywhere in the URL, headers, or body with `{{value}}`
  markers. The text inside the braces is the baseline default.
- Provide a payload list (one per line). The attack replaces each marker position
  with each payload in turn (positions × payloads).
- A baseline request (markers at defaults) is sent first; result rows whose status
  or length differs from the baseline are highlighted, so anomalies stand out.
- Runs with bounded concurrency and can be stopped mid-attack.

## Decoder

- Encode or decode text as Base64, URL, Hex, or HTML entities (UTF-8 safe).
- "output → input" chains transforms.

**Implementation Details**:
- `src/utils/intruder.js` (`countMarkers`, `stripMarkers`, `applyMarkers`),
  `src/utils/codec.js` (encoders/decoders), `src/utils/netClient.js` (proxy).

**Notes**:
- Some request headers (Host, Content-Length, etc.) are controlled by the browser
  and cannot be overridden from a page.
