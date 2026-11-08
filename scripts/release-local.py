#!/usr/bin/env python3
"""Build Skon's USB Tool on this PC and publish it to GitHub Pages without a
GitHub Actions build.

Does locally what .github/workflows/ci.yml and deploy.yml did on a runner, so a
push to GitHub no longer starts a 3-5 minute build job:

  1. `npm ci` when node_modules is missing or older than package-lock.json, then
     `npm run test` (the CI gate; --skip-tests to bypass) and `npm run build`
     (Vite -> dist/).
  2. --assemble  copies dist/ to _site/ (plus .nojekyll) and stamps the page's
     __VERSION__ placeholder <branch>+<sha7>, so you can inspect it.
  3. --deploy    does that and commits _site/ to the `gh-pages` branch with git
     plumbing (no checkout switch), pushes it, and makes sure GitHub Pages
     publishes from that branch. GitHub then copies the files live with its own
     short "pages build and deployment" step (on a private repo GitHub bills
     that step as Actions time; there is no way around that short of making the
     repo public).

Usage:
  python scripts/release-local.py                     test + build -> dist/
  python scripts/release-local.py --assemble          ... and build the site into _site/
  python scripts/release-local.py --deploy            ... and publish it to GitHub Pages
  python scripts/release-local.py --deploy --skip-build --skip-tests
                                                      publish the existing dist/ as-is

Needs: Node (npm), `gh` logged in with access to the private repo, and push
access over the repo's normal git remote. No secrets or .env.

Run it from a clean checkout of main; it warns otherwise and stamps "+dirty".
Exit code is non-zero if tests or the build fail, so a broken tree never
replaces the live site.
"""
import argparse, datetime, json, os, shutil, subprocess, sys, tempfile, time
from pathlib import Path

REPO = "olosnoks/usb-tool"
PAGES_BRANCH = "gh-pages"
ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
# Text files the __VERSION__ placeholder is replaced in.
STAMP_SUFFIXES = {".html", ".json", ".webmanifest", ".js", ".css", ".txt", ".xml", ".svg"}


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
    # CI=1 keeps npm from ever waiting on a prompt.
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
    """dist/ -> _site/, stamped, plus .nojekyll. CNAME stays: it binds the custom domain."""
    if not DIST.exists():
        die("dist/ is missing; run without --skip-build first")
    site = ROOT / "_site"
    if site.exists():
        shutil.rmtree(site)
    shutil.copytree(DIST, site, ignore=shutil.ignore_patterns(".DS_Store", "Thumbs.db", "*.map"))
    (site / ".nojekyll").write_text("", encoding="utf-8")   # serve files as-is, no Jekyll pass
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


def commit_site(site, stamp):
    """Commit _site/ as the new tip of gh-pages without touching the working tree or index."""
    # A missing gh-pages (first deploy) is fine: the fetch fails quietly and the commit has no parent.
    subprocess.run(["git", "fetch", "origin", PAGES_BRANCH], cwd=ROOT, capture_output=True)
    parent = subprocess.run(["git", "rev-parse", "--verify", "-q", "origin/" + PAGES_BRANCH],
                            cwd=ROOT, capture_output=True, text=True).stdout.strip()
    with tempfile.TemporaryDirectory() as td:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(td) / "index"), "GIT_WORK_TREE": str(site)}
        subprocess.run(["git", "read-tree", "--empty"], cwd=ROOT, env=env, check=True)
        # Store the built bytes exactly (no CRLF conversion, no .gitignore filtering).
        subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "-A", "-f", "."],
                       cwd=ROOT, env=env, check=True)
        tree = out(["git", "write-tree"], cwd=ROOT, env=env)
    if parent and out(["git", "rev-parse", parent + "^{tree}"], cwd=ROOT) == tree:
        print("gh-pages already holds exactly this site; nothing to push")
        return parent, False
    msg = "deploy %s (%s)" % (stamp["version"], stamp["date"])
    commit = out(["git", "commit-tree", tree, "-m", msg] + (["-p", parent] if parent else []), cwd=ROOT)
    git("update-ref", "refs/heads/" + PAGES_BRANCH, commit)
    print("committed %s to %s (%s)" % (commit[:7], PAGES_BRANCH, msg))
    return commit, True


def ensure_pages_source(gh):
    """Pages must publish from gh-pages (not from the Actions workflow) for a push to go live."""
    r = subprocess.run([gh, "api", "repos/%s/pages" % REPO], capture_output=True, text=True)
    if r.returncode != 0:
        die("GitHub Pages is not enabled on %s (enable it in Settings > Pages, source: branch %s)" % (REPO, PAGES_BRANCH))
    cfg = json.loads(r.stdout)
    src = cfg.get("source") or {}
    if cfg.get("build_type") == "legacy" and src.get("branch") == PAGES_BRANCH and src.get("path", "/") == "/":
        return cfg
    print("switching GitHub Pages to publish from branch %s (was: %s, %s)"
          % (PAGES_BRANCH, cfg.get("build_type"), src.get("branch")))
    run([gh, "api", "-X", "PUT", "repos/%s/pages" % REPO, "-f", "build_type=legacy",
         "-f", "source[branch]=" + PAGES_BRANCH, "-f", "source[path]=/"], capture_output=True)
    return cfg


def wait_for_pages(gh, commit, timeout=240):
    """Poll GitHub's own publish step (it usually finishes in well under a minute)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        r = subprocess.run([gh, "api", "repos/%s/pages/builds/latest" % REPO], capture_output=True, text=True)
        if r.returncode == 0:
            b = json.loads(r.stdout)
            if b.get("commit") == commit:
                st = b.get("status")
                if st == "built":
                    return True
                if st == "errored":
                    die("GitHub Pages build errored: %s" % (b.get("error") or {}).get("message", "?"))
        time.sleep(5)
    print("warning: GitHub has not reported the Pages build yet; check `gh api repos/%s/pages/builds/latest`" % REPO)
    return False


def deploy(site, stamp):
    gh = tool("gh")
    commit, changed = commit_site(site, stamp)
    if changed:
        run(["git", "push", "origin", "refs/heads/%s:refs/heads/%s" % (PAGES_BRANCH, PAGES_BRANCH)], cwd=ROOT)
    cfg = ensure_pages_source(gh)
    url = cfg.get("html_url") or "https://%s.github.io/%s/" % tuple(REPO.split("/"))
    if changed and wait_for_pages(gh, commit):
        print("live: %s  (version %s)" % (url, stamp["version"]))
    else:
        print("site: %s" % url)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--skip-build", action="store_true", help="reuse the existing dist/ (no npm run build)")
    ap.add_argument("--skip-tests", action="store_true", help="do not run the Vitest suite before building")
    ap.add_argument("--install", action="store_true", help="force `npm ci` even if node_modules looks current")
    ap.add_argument("--assemble", action="store_true", help="assemble the site into _site/ but do not deploy it")
    ap.add_argument("--deploy", action="store_true", help="publish the site to GitHub Pages via the gh-pages branch")
    a = ap.parse_args()

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
            deploy(site, stamp)

    print("\ndone.")


if __name__ == "__main__":
    main()
