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

**Notes**: SHA family uses Web Crypto (async); MD5/MD4/NTLM run from local
implementations. A browser is far slower than native hashcat and has no GPU
access — use it for audits, teaching and CTF-scale work. Only crack hashes you
are authorized to.
