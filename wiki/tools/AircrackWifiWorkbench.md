# WPA PMKID Cracker Workbench

**Purpose**: Offline dictionary attack on a captured WPA/WPA2 **PMKID**. Runs
entirely in the browser via the Web Crypto API; no backend and no WASM required.

**Important limitation**: Capturing a PMKID needs monitor-mode WiFi hardware and
cannot be done in a browser. This tool performs the offline cracking step on a
PMKID you already captured (e.g. with `hcxdumptool`).

**Usage**:
- Enter the SSID (network name).
- Enter the AP MAC / BSSID and the client (station) MAC. Colons are optional.
- Paste the captured PMKID (32 hex characters).
- Enter a wordlist, one passphrase per line. WPA passphrases must be 8–63
  characters; shorter or longer candidates are skipped automatically.
- Click **Crack**. Progress and a stop button are shown; a match reveals the
  passphrase.

**Implementation Details**:
- `PMK = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096 iterations, 32 bytes)`.
- `PMKID = HMAC-SHA1(PMK, "PMK Name" || AP_MAC || STA_MAC)` truncated to 16 bytes.
- Both primitives come from `crypto.subtle`. The PBKDF2 path is verified against
  the IEEE 802.11i WPA PSK test vectors.
- Logic lives in `src/utils/aircrackWrapper.js` (`computePmkid`, `crackPmkid`).

**Dependencies**: `src/utils/aircrackWrapper.js` (Web Crypto). Optional SIMD
accelerator `public/wasm/aircrack.wasm`, documented in
[docs/WASM_ENGINES.md](../../docs/WASM_ENGINES.md) but not currently used.

**Notes**:
- Web Crypto PBKDF2 is correct but not fast; use modest wordlists.
- Only the PMKID attack is implemented; EAPOL 4-way handshake cracking is not.
