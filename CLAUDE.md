# Skon's USB Tool — notes for Claude Code

Static Vite + React app (`index.html`, `wiki/index.html`) served from a Cloudflare Worker (static assets + the `/api/*` Shodan relay in `worker/index.js`) at
https://usb-tool.olosnoks.com. See `README.md` for the architecture and `docs/CONTRIBUTING.md`
for conventions.

## Releasing
- **Nothing builds on GitHub by default.** `.github/workflows/ci.yml` and `deploy.yml` are
  gated on the repo variable `CI_BUILDS_ENABLED == 'true'` and show as *skipped* otherwise.
  The owner builds and publishes from a PC with `scripts/release-local.py` (test + build +
  `wrangler deploy` per `wrangler.jsonc`; details under *Releasing from your PC* in the README).
  **Never run its `--deploy` unless explicitly asked.**
- Re-enable hosted CI only when asked: `gh variable set CI_BUILDS_ENABLED --body true
  --repo olosnoks/usb-tool`.
- `gh` is logged in as the owner; always pass `--repo olosnoks/usb-tool`.
- `dist/` and `_site/` are build output and git-ignored; never commit them.
- **Never commit secrets.** The Cloudflare token lives in the git-ignored `.env` (see
  `.env.example`); never read it back or echo it. If a secret is committed, say so
  immediately — it must be rotated, not just removed.

## Conventions
- Run `npm run test` and `npm run build` before opening a PR; CI will not do it for you.
- Do not push to `main` directly; branch, push, and open a PR for the owner to merge.
