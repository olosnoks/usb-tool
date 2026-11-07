# Skon's USB Tool — local backend services

The web app is a static, browser-only site. Browsers can't open raw sockets, do
TLS handshakes, run `nmap`, or fetch most cross-origin URLs. These small Docker
services give the security tools those capabilities **on your own machine**. Each
tool talks to its own service on `localhost`.

> Only use these against systems you own or are explicitly authorized to assess.

## Two ways to run

### 1. One file, from the app (easiest)
Open the **Docker Backends** tool in the app and click **Download** (or **Copy**).
You get a single self-contained `docker-compose.yml` with each Node service's
source embedded — no other files needed. Then:

```bash
docker compose up -d                       # safe services
docker compose --profile offensive up -d   # also Hydra (authorized use only)
docker compose down                        # stop
```

### 2. From this folder (for development)
This directory holds the real, maintainable sources (`<svc>/server.cjs` +
`Dockerfile`). The `docker-compose.yml` here builds them:

```bash
cd backend
docker compose up -d
```

## Services

| Service | Port | Image | Backs | Capability |
|---|---|---|---|---|
| `cors-proxy` | 47101 | node:20-alpine | Web Analyzer, HTTP Workbench, API Client, URL Inspector, Burp, OSINT, crt.sh, Pwned Passwords, DB Browser | Forwards HTTP(S) with permissive CORS; reaches sibling services by name |
| `nmap` | 47102 | node:20-alpine + nmap | Port Scanner | Real `nmap` scans with service/version detection |
| `tls-inspector` | 47103 | node:20-alpine | Certificate Inspector | Live TLS handshake → the cert the server serves now |
| `dns` | 47104 | node:20-alpine | DNS Toolkit | Any record type against any nameserver |
| `zap` | 47105 | ghcr.io/zaproxy/zaproxy:stable | OWASP ZAP | ZAP daemon + REST API (reached via cors-proxy) |
| `hydra` | 47106 | node:20-alpine + hydra | HTTP Basic Auth Tester | **Authorized testing only.** Off by default |

## Wiring in the app

In the **Docker Backends** tool you can, per service: set its base URL, run a
health check, and (for `cors-proxy`) set it as the proxy for every fetch tool in
one click. The Port Scanner and Certificate Inspector call their services
directly once configured; the other services are reachable and health-checked,
and their tools can be pointed at them as integrations land.

## Safety

- **Hydra** performs online credential attacks. It only starts under the
  `offensive` Compose profile **and** refuses every request unless
  `I_HAVE_AUTHORIZATION=yes`.
- `cors-proxy` accepts an optional `ALLOW_HOSTS` allowlist.
- All services bind to the published port on your host; don't expose them to
  untrusted networks.
