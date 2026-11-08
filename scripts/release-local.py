#!/usr/bin/env python3
"""Build Skon's USB Tool on this PC and publish it to Cloudflare Pages, with no
GitHub Actions involved.

Does locally what .github/workflows/ci.yml did on a runner, then deploys:

  1. `npm ci` when node_modules is missing or older than package-lock.json, then
     `npm run test` (the CI gate; --skip-tests to bypass) and `npm run build`
     (Vite -> dist/).
  2. --assemble  copies dist/ to _site/ without the GitHub-Pages-only CNAME file
     and stamps the page's __VERSION__ placeholder <branch>+<sha7>, so you can
     inspect it.
  3. --deploy    does that and pushes _site/ to Cloudflare Pages with wrangler
     (`npx --yes wrangler pages deploy`), creating the project on first use.
     Cloudflare serves the files as-is; nothing is built or billed anywhere.

Usage:
  python scripts/release-local.py                     test + build -> dist/
  python scripts/release-local.py --assemble          ... and build the site into _site/
  python scripts/release-local.py --deploy            ... and publish it to Cloudflare Pages
  python scripts/release-local.py --deploy --skip-build --skip-tests
                                                      publish the existing dist/ as-is
  --project NAME   Cloudflare Pages project (default $CF_PAGES_PROJECT or "usb-tool")

Needs Node (npx runs wrangler) and Cloudflare credentials, one of: `npx wrangler
login` once (a browser sign-in that wrangler keeps for you; nothing on disk in the
repo), or CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in a `.env` file at the
repo root (git-ignored; copy .env.example). A value exported in the shell wins
over .env. Never commit .env; this script never prints its values.

Run it from a clean checkout of main; it warns otherwise and stamps "+dirty".
Exit code is non-zero if tests or the build fail, so a broken tree never
replaces the live site.
"""
import argparse, datetime, os, shutil, subprocess, sys
from pathlib import Path

DEFAULT_PROJECT = "usb-tool"
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
# GitHub-Pages-only files (public/CNAME binds the domain there); Cloudflare has no use for them.
SITE_DROP = ("CNAME", ".nojekyll", ".DS_Store", "Thumbs.db", "*.map")
# Text files the __VERSION__ placeholder is replaced in.
STAMP_SUFFIXES = {".html", ".json", ".webmanifest", ".js", ".css", ".txt", ".xml", ".svg"}


def load_dotenv(path):
    """KEY=VALUE lines from .env (git-ignored) into the environment; the shell wins on a clash."""
    if not path.exists():
        return 0
    n = 0
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip('"').strip("'")
        if k and v and k not in os.environ:
            os.environ[k] = v
            n += 1
    return n


def die(msg):
    print("error: " + msg, file=sys.stderr)
    sys.exit(1)


def run(cmd, **kw):
    print("$ " + " ".join(str(c) for c in cmd))
    return subprocess.run([str(c) for c in cmd], check=True, **kw)


def out(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, capture_output=True, text=True, **kw).stdout.strip()


def tool(name):
    """Absolute path of a CLI; on Windows shutil.which resolves npm -> npm.cmd etc."""
    found = shutil.which(name)
    if not found:
        die("%s not found on PATH" % name)
    return found


def git(*args):
    return out(["git", *args], cwd=ROOT)


def no_prompt_env():
    # CI=1 keeps npm and wrangler from ever waiting on a prompt.
    return {**os.environ, "CI": "1"}


def deps_stale():
    marker = ROOT / "node_modules" / ".package-lock.json"
    lock = ROOT / "package-lock.json"
    return not marker.exists() or (lock.exists() and lock.stat().st_mtime > marker.stat().st_mtime)


def build(skip_tests, force_install):
    npm = tool("npm")
    env = no_prompt_env()
    if force_install or deps_stale():
        print("\n=== npm ci (node_modules missing or older than package-lock.json) ===")
        if subprocess.run([npm, "ci"], cwd=ROOT, env=env).returncode != 0:
            die("npm ci failed")
    if not skip_tests:
        print("\n=== npm run test ===")
        if subprocess.run([npm, "run", "test"], cwd=ROOT, env=env).returncode != 0:
            die("tests failed — nothing deployed")
    print("\n=== npm run build ===")
    if DIST.exists():
        shutil.rmtree(DIST)
    if subprocess.run([npm, "run", "build"], cwd=ROOT, env=env).returncode != 0:
        die("build failed — nothing deployed")
    if not (DIST / "index.html").exists() or not (DIST / "wiki" / "index.html").exists():
        die("build produced no dist/index.html or dist/wiki/index.html")
    n = sum(1 for p in DIST.rglob("*") if p.is_file())
    print("built dist/ (%d files)" % n)


def make_stamp(branch, sha, dirty):
    return {"sha": sha,
            "version": "%s+%s%s" % (branch, sha[:7], "+dirty" if dirty else ""),
            "date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def assemble(stamp):
    """dist/ -> _site/, minus GitHub-Pages-only files, with __VERSION__ stamped."""
    if not DIST.exists():
        die("dist/ is missing; run without --skip-build first")
    site = ROOT / "_site"
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(DIST, site, ignore=shutil.ignore_patterns(*SITE_DROP))
    stamped = 0
    for f in site.rglob("*"):
        if f.is_file() and f.suffix in STAMP_SUFFIXES:
            data = f.read_bytes()
            if b"__VERSION__" in data:
                f.write_bytes(data.replace(b"__VERSION__", stamp["version"].encode()))
                stamped += 1
    n = sum(1 for p in site.rglob("*") if p.is_file())
    print("assembled %s (%d files, version %s, %d files stamped)" % (site, n, stamp["version"], stamped))
    return site


def wrangler(npx, *args, **kw):
    return subprocess.run([npx, "--yes", "wrangler", *args], env=no_prompt_env(), **kw)


def check_cloudflare(npx):
    # Either an API token (+ account id) from .env / the shell, or the browser login
    # wrangler keeps itself (`npx wrangler login`), which needs no secret on disk here.
    if os.environ.get("CLOUDFLARE_API_TOKEN"):
        if not os.environ.get("CLOUDFLARE_ACCOUNT_ID"):
            die("CLOUDFLARE_API_TOKEN is set but CLOUDFLARE_ACCOUNT_ID is not (see .env.example)")
        print("using CLOUDFLARE_API_TOKEN from the environment / .env")
        return
    who = wrangler(npx, "whoami", capture_output=True, text=True)
    if who.returncode != 0 or "not authenticated" in (who.stdout + who.stderr).lower():
        die("no Cloudflare credentials: either `npx wrangler login` once (browser), or put "
            "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in .env (see .env.example)")
    print("using the wrangler login on this machine")


def ensure_project(npx, project):
    """Create the Pages project on first use (wrangler would otherwise stop to ask)."""
    lst = wrangler(npx, "pages", "project", "list", capture_output=True, text=True)
    if lst.returncode != 0:
        die("could not list Cloudflare Pages projects:\n" + lst.stderr.strip())
    names = set()
    for line in lst.stdout.splitlines():
        cells = [c.strip() for c in line.split("│")]
        if len(cells) > 1 and cells[1] and cells[1] != "Project Name":
            names.add(cells[1])
    if project in names:
        return
    print("Cloudflare Pages project '%s' does not exist yet; creating it (production branch main)" % project)
    if wrangler(npx, "pages", "project", "create", project, "--production-branch", "main").returncode != 0:
        die("could not create the Pages project '%s'" % project)
    print("created. Attach the domain in the Cloudflare dashboard: Workers & Pages > %s > Custom domains." % project)


def deploy(site, project, sha):
    npx = tool("npx")
    check_cloudflare(npx)
    ensure_project(npx, project)
    r = wrangler(npx, "pages", "deploy", str(site), "--project-name", project,
                 "--branch", "main", "--commit-dirty=true", "--commit-hash", sha)
    if r.returncode != 0:
        die("wrangler pages deploy failed")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-build", action="store_true", help="reuse the existing dist/ (no npm run build)")
    ap.add_argument("--skip-tests", action="store_true", help="do not run the Vitest suite before building")
    ap.add_argument("--install", action="store_true", help="force `npm ci` even if node_modules looks current")
    ap.add_argument("--assemble", action="store_true", help="assemble the site into _site/ but do not deploy it")
    ap.add_argument("--deploy", action="store_true", help="publish the site to Cloudflare Pages")
    ap.add_argument("--project", default=None, help="Cloudflare Pages project (default: $CF_PAGES_PROJECT or %s)" % DEFAULT_PROJECT)
    a = ap.parse_args()

    if load_dotenv(ROOT / ".env"):
        print("loaded %s" % (ROOT / ".env"))
    if not a.project:
        a.project = os.environ.get("CF_PAGES_PROJECT", DEFAULT_PROJECT)

    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    sha = git("rev-parse", "HEAD")
    dirty = bool(git("status", "--porcelain", "--untracked-files=no"))
    if branch != "main":
        print("warning: releasing from branch '%s', not main" % branch)
    if dirty:
        print("warning: working tree has uncommitted changes; the build is stamped +dirty")

    if not a.skip_build:
        build(a.skip_tests, a.install)

    if a.deploy or a.assemble:
        stamp = make_stamp(branch, sha, dirty)
        site = assemble(stamp)
        if a.deploy:
            deploy(site, a.project, sha)

    print("\ndone.")


if __name__ == "__main__":
    main()
