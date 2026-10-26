# Contributing to Skon's USB Tool

Thanks for your interest in contributing! This is a client-side hardware hacker
workbench built with **Vite + React + Tailwind CSS**, hosted statically on
GitHub Pages. Everything runs in the browser over Web Serial, WebUSB, and WASM —
there is no backend.

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
```

Use a Chromium-based browser (Chrome, Edge, Opera) — Web Serial / WebUSB are not
available in Firefox or Safari.

## Project Layout

- `src/components/` — UI. `tabs/` and `workbenches/` hold the tool views;
  `layout/` holds the shell (Header, Sidebar, drawers).
- `src/utils/` — protocol drivers and parsers (one module per device/protocol).
- `src/context/SerialContext.jsx` — the shared Web Serial / WebUSB transport.
- `src/workers/` — Web Workers for heavy parsing (802.11, CyberChef).
- `src/wiki/` — the in-app documentation articles.
- `tests/` — Vitest unit tests.
- `docs/FEATURE_TOOL_HANDOFF.md` — the guide for adding a brand-new tool.

## Adding a New Tool

Tools follow a **driver + workbench** pattern: a pure protocol/driver module in
`src/utils/`, a React workbench in `src/components/`, lazy-loaded and routed from
`src/App.jsx`, listed in `src/components/layout/Sidebar.jsx`, and documented with
a wiki article in `src/wiki/articles/`. See
[FEATURE_TOOL_HANDOFF.md](FEATURE_TOOL_HANDOFF.md) for the full
blueprint.

Keep hardware access honest: if a workbench offers a simulation/demo mode,
label it clearly so users can tell synthetic data from real hardware I/O.

## Pull Requests

1. Fork and create a feature branch off `main`
   (e.g. `feat/my-tool`, `fix/modbus-crc`).
2. Keep changes focused; match the surrounding code style (the repo uses plain
   JS/JSX with Tailwind classes — no separate linter config is enforced, so mirror
   nearby files for naming, formatting, and comment density).
3. Add or update Vitest tests for parser/driver logic where practical.
4. Ensure `npm run build` and `npm run test` both pass.
5. If you add or change a tool, update its wiki article and the README tool list.
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
