# Hash Cracker

**Purpose**: Client-side password-audit / CTF hash cracking, hashcat-style. All
work runs in the browser; nothing is uploaded.

**Hash modes** (with hashcat `-m` numbers): MD5 (0), SHA-1 (100), SHA-256 (1400),
SHA-384 (10800), SHA-512 (1700), NTLM (1000), md5(md5($pass)) (2600), MySQL4.1+
(300), and salted variants md5/sha1/sha256 `$pass.$salt` / `$salt.$pass`
(10/20/110/120/1410) with a shared salt field.

**Attack modes**:
- **Dictionary** (`-a 0`) — hash each wordlist candidate.
- **Dictionary + rules** — expand each word with a rule set: case & reverse,
  leetspeak, append digits/suffixes, or **best64-lite** (all combined).
- **Mask / brute-force** (`-a 3`) — `?l ?u ?d ?s ?a` charset tokens plus literal
  characters (e.g. `admin?d?d`), with a live keyspace count and a warning when
  it gets large.

**Multi-hash potfile**: paste many target hashes (one per line); each is tracked
in a table and filled in as it cracks. Live status shows H/s, candidates tried /
total, elapsed and ETA. Export results as a `hash:password` potfile.

**Implementation**: `src/utils/hashCrack.js` (hash modes, rule expansion, mask
keyspace/iteration), `src/utils/md5.js`, `src/utils/md4.js` (for NTLM). Verified
in `tests/hashCrack.test.js` against RFC MD4 vectors, NTLM("password"), MD5/SHA
digests, salted ordering, rule expansion and mask iteration.

**GPU acceleration (WebGPU)**: for **MD5 + mask** attacks, tick "Use GPU" to run
the brute-force as a WGSL compute shader on the GPU (`src/utils/gpuCrack.js`),
which is dramatically faster than the CPU loop for large keyspaces. The engine
**self-tests on your actual hardware** (cracks a known plaintext) before it is
trusted; if the self-test fails or WebGPU is unavailable, it falls back to the
CPU engine and says so. GPU path limits: MD5 only, candidate length ≤ 55,
keyspace ≤ 2³².

**Notes**: SHA family uses Web Crypto (async); MD5/MD4/NTLM run from local
implementations. Apart from the WebGPU MD5 path, cracking runs on the CPU and is
far slower than native hashcat — use it for audits, teaching and CTF-scale work.
Only crack hashes you are authorized to.
