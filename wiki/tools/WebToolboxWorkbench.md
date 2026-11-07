# Web Security Toolbox

**Purpose**: A categorized launcher for well-known browser-based security,
OSINT, encoding and lab services, so the common web tools sit next to the
hardware workbenches.

**Usage**:
- Browse or filter the cards and click one to open that third-party service in
  a new tab. Categories: Reconnaissance & OSINT (Shodan, Censys, urlscan.io,
  crt.sh, SecurityTrails, DNSDumpster, HackerTarget, MXToolbox); Encoding &
  Analysis (CyberChef, regex101, jwt.io); In-browser Execution & Auditing
  (OWASP PTK, Adafruit WebSerial ESPTool, ESP Web Tools, WebUSB/WebSerial docs);
  Cloud Labs (PortSwigger Web Security Academy, TryHackMe, OffSec Proving
  Grounds, Hack The Box, BeEF project).

**Implementation Details**:
- `src/components/tools/WebToolboxWorkbench.jsx` — a static, data-driven list of
  external links. Nothing is fetched, proxied or executed here; each entry is a
  plain `target="_blank"` link.

**Notes**:
- Several entries have richer built-in counterparts in this app (CyberChef
  Workbench, the ESP Firmware Flasher, Certificate Inspector).
- Use the linked services only against systems you own or are authorized to
  test.
