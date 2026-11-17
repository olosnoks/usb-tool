# Contributing to Skon's USB Tool

Thanks for your interest in contributing! This is a client-side hardware hacker
workbench built with **Vite + React + Tailwind CSS**, served from a
Cloudflare Worker (static assets plus a tiny `/api/*` Shodan relay in `worker/index.js`) at
https://usb-tool.olosnoks.com. Everything runs in the browser over Web Serial, WebUSB, and
WASM; there is no application backend.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
For security issues, follow the [Security Policy](SECURITY.md) instead of opening
a public issue or PR.

## Getting Started

```bash
git clone https://github.com/olosnoks/usb-tool.git
cd usb-tool
npm install
npm run dev        # start the Vite dev server (http://localhost:3000)
```

Other scripts:

```bash
npm run build      # production build to dist/ (must pass before a PR)
npm run preview    # serve the production build locally
npm run test       # run the Vitest unit suite
npm run typecheck  # tsc --noEmit
```

The owner builds and publishes from a PC with `scripts/release-local.py` (see *Releasing
from your PC* in the README); contributors only need to open a PR.

Use a Chromium-based browser (Chrome, Edge, Opera) — Web Serial / WebUSB / WebHID /
Web Bluetooth are not available in Firefox or Safari.

## Project Layout

- `src/components/` — UI. `tools/` and `workbenches/` hold most tool views (`tabs/` the
  core serial tabs); `layout/` holds the shell (Header, Sidebar, Desktop and tool
  windows, drawers). `ToolRegistry.jsx` maps tool ids to workbenches.
- `src/utils/` — protocol drivers and parsers (one module per device/protocol;
  `usbrea/` is the usb-rea port).
- `src/context/SerialContext.jsx` — the shared Web Serial / WebUSB transport.
- `src/workers/` — Web Workers for heavy work (802.11 parsing, CyberChef, HackRF DSP).
- `src/wiki/` — the in-app documentation articles (`wiki/index.html` is its entry).
- `src/mayhem-mobile/` — the GPL-3.0 Mayhem Mobile receiver (TypeScript); `npm run
  build:mayhem` bundles it into `public/mayhem/build/`.
- `worker/index.js` + `wrangler.jsonc` — the Cloudflare Worker (`/api/*` Shodan relay).
- `backend/` — optional local Docker services (CORS proxy, nmap, TLS inspector, ...).
- `scripts/release-local.py` — the local test + build + deploy script.
- `tests/` — Vitest unit tests.
- `docs/FEATURE_TOOL_HANDOFF.md` — the guide for adding a brand-new tool.

## Adding a New Tool

Tools follow a **driver + workbench** pattern: a pure protocol/driver module in
`src/utils/`, a React workbench in `src/components/`, lazy-loaded and routed from
`src/components/ToolRegistry.jsx` (add its id to `KNOWN_TOOL_IDS` too), listed in
`src/components/layout/Sidebar.jsx`, and documented with a wiki article in
`src/wiki/articles/`. See
[FEATURE_TOOL_HANDOFF.md](FEATURE_TOOL_HANDOFF.md) for the full
blueprint.

Keep hardware access honest: tools must not report results they did not get from
hardware (`tests/demoHonesty.test.jsx` guards this). If a panel is interface-only or
shows synthetic data, label it clearly (`DemoBanner`) so users can tell it from real
hardware I/O.

## Pull Requests

1. Fork and create a feature branch off `main`
   (e.g. `feat/my-tool`, `fix/modbus-crc`).
2. Keep changes focused; match the surrounding code style (the repo uses plain
   JS/JSX with Tailwind classes — no separate linter config is enforced, so mirror
   nearby files for naming, formatting, and comment density).
3. Add or update Vitest tests for parser/driver logic where practical.
4. Ensure `npm run build` and `npm run test` both pass locally. Hosted CI is
   opt-in (repo variable `CI_BUILDS_ENABLED`), so it will not run them for you.
5. If you add or change a tool, update its wiki article and the README tool list.
   If you port third-party code, keep its license header and add it to
   [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md).
   Do not push to `main`; the owner merges PRs.
6. Open a PR describing what changed and how you verified it (which browser,
   which hardware, or which simulated path).

### Commit Messages

Conventional-commit style is used, e.g.:

```
feat(wifi): add channel dwell tuning to the Alfa workbench
fix(modbus): validate CRC on live RS-485 responses
docs: expand the Zadig driver walkthrough
```

## Reporting Bugs & Requesting Features

Open a GitHub issue with clear reproduction steps, the affected tool, your
browser/OS, and any relevant hardware. For anything security-sensitive, use the
[Security Policy](SECURITY.md) private reporting channel instead.
