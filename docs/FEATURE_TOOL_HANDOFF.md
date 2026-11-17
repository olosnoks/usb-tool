# AI Developer Handoff Guide: Dropping a New Tool into Skon's USB Tool

This document is an exhaustive engineering blueprint for an AI coding assistant (or human contributor) to implement and cleanly drop a brand-new hardware workbench tool into the **Skon's USB Tool** codebase.

---

## 1. High-Level Architecture Overview

- **Frontend Core**: React 18 + Vite (SPA) + Tailwind CSS (vanilla utility styling) + Lucide React icons.
- **Hardware Communication**: Client-side **W3C WebSerial, WebUSB, WebHID and Web Bluetooth APIs**. No backend daemon or native drivers required. (The only server-side code is the `/api/*` Shodan relay in `worker/index.js`.)
- **State & Plumbing**: `src/context/SerialContext.jsx` manages active COM ports, baud rate switching, raw byte buffers, hex streams, and disconnection cleanup.
- **Dual Entrypoints**:
  1. Main Web Application (`index.html` -> `src/main.jsx` -> `src/App.jsx`)
  2. Technical Documentation Wiki (`wiki/index.html` -> `src/wiki/main.jsx` -> `src/wiki/WikiApp.jsx`)
- **Windowed workspace**: every tool opens in its own window on the `Desktop`; `src/components/ToolRegistry.jsx` maps a tool id to its (lazy) workbench.

---

## 2. Directory Structure & Key Locations

```
skons-usb-tool/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.jsx           # App top bar & global connection indicators
│   │   │   └── Sidebar.jsx          # SIDEBAR_SECTIONS: category groupings & tool list
│   │   ├── ToolRegistry.jsx         # renderTool() switch + KNOWN_TOOL_IDS
│   │   ├── tools/                   # Most tool workbenches
│   │   │   ├── ProtocolPacketLab.jsx
│   │   │   ├── UsbReaWorkbench.jsx
│   │   │   └── ...
│   │   └── workbenches/             # Larger decks (Alfa Wi-Fi, WarHog/Piglet) and CyberChef parts
│   │       ├── AlfaWifiWorkbench.jsx
│   │       ├── WarhogPigletWorkbench.jsx
│   │       └── ...
│   ├── utils/                       # Low-level protocol drivers & packet parsers
│   │   ├── flipperDriver.js
│   │   ├── mayhemDriver.js
│   │   ├── ubxProtocol.js
│   │   ├── usbrea/                  # usb-rea port (pure modules)
│   │   └── ...
│   ├── workers/                     # Web Workers (CyberChef, 802.11 parser, HackRF DSP)
│   ├── wiki/
│   │   ├── WikiApp.jsx              # Standalone interactive docs app
│   │   ├── wikiArticles.js          # Aggregates the article modules + WIKI_CATEGORIES
│   │   └── articles/                # 8 article modules
│   │       ├── coreArticles.js
│   │       ├── analysisArticles.js
│   │       ├── rfArticles.js
│   │       ├── webappArticles.js
│   │       ├── payloadArticles.js
│   │       ├── hardwareArticles.js
│   │       ├── utilityArticles.js
│   │       └── referenceArticles.js
│   ├── App.jsx                      # Shell: Header, Sidebar, Desktop (tool windows), drawers
│   └── context/SerialContext.jsx    # Global WebSerial state
├── worker/index.js                  # Cloudflare Worker for /api/* (Shodan relay)
├── wrangler.jsonc                   # Worker + static-assets config
├── scripts/release-local.py         # test + build + deploy from a PC
└── tests/                           # Vitest unit test suites (tests/usbrea/, ...)
```

---

## 3. The 5-Step Process to Drop In a New Feature Tool

### Step 1: Create the Protocol / Driver Layer
*Location: `src/utils/<featureDriver>.js`*

1. **Protocol Framing**: Implement the binary or ASCII packet framing logic (e.g., CRC-16, Fletcher checksums, SLIP/COBS, Protobuf, or magic preambles).
2. **Serial Stream Ingestion**: Export functions to transform incoming `Uint8Array` byte chunks from `SerialContext` into structured JavaScript objects.
3. **Test Fixtures, not Fake Output**: Export deterministic sample frames (or use a fake port such as `FakeSerialPort` in `src/utils/serialLink.js`) so Vitest can exercise the driver without a physical USB device. The shipped UI must not present them as device data.

```javascript
// src/utils/myNewDriver.js
export function parseMyProtocolPacket(rawBytes) {
  // 1. Verify magic preamble
  if (rawBytes[0] !== 0xAA || rawBytes[1] !== 0x55) return null;
  // 2. Extract payload & calculate checksum
  // ...
  return { id: rawBytes[2], payload: rawBytes.slice(3, -2) };
}

// Test fixture only; never shown in the UI as real telemetry.
export const SAMPLE_TELEMETRY = [
  { timestamp: '00:00:01.200', metricA: 142.5, status: 'NORMAL' },
  { timestamp: '00:00:01.300', metricA: 148.0, status: 'WARNING' }
];
```

---

### Step 2: Build the Workbench UI Component
*Location: `src/components/workbenches/<NewToolWorkbench>.jsx` or `src/components/tools/<NewToolWorkbench>.jsx`*

1. **Design System & Aesthetics**:
   - Use the established dark cyber/engineering palette:
     - Backgrounds: `#171920` (card surface), `#0f1015` (canvas background), `slate-950` (inputs/terminals).
     - Borders: `#2b303c` or `slate-800`.
     - Accents: Tailwind neon colors (`cyan`, `purple`, `emerald`, `amber`, `rose`).
   - Font: `font-mono` for all telemetry, hexadecimal readouts, and packet logs.
2. **Essential UI Components**:
   - **Header Card**: Tool title, category pill badge, and connection controls.
   - **Telemetry KPI Strip**: 3–4 metric cards showing packet rates, detected nodes, voltages, or hardware state.
   - **Empty State**: Until a device is connected the tool shows an empty state, not simulated readings (the app has no simulated device modes; `tests/demoHonesty.test.jsx` guards this). Panels that are interface-only must say so with `DemoBanner` (`src/components/common/DemoNotice.jsx`).
   - **Action Bar**: Clear buffer, Pause/Resume, Export (JSON, CSV, PCAP, or VCD).

---

### Step 3: Register in Sidebar & Navigation
*Location: `src/components/layout/Sidebar.jsx`*

Find the appropriate section in `SIDEBAR_SECTIONS` (`core`, `analysis`, `rf`, `webapp`, `programmers`, `utilities`, or `setup`) and add the item to its `items`:

```javascript
// In src/components/layout/Sidebar.jsx:
{
  id: 'my-new-tool',
  name: 'My New Tool Name',
  icon: Radio,               // from 'lucide-react'
  accent: 'cyan',            // 'cyan' | 'purple' | 'amber' | 'emerald' | 'rose'
  desc: 'Short 1-line engineering description of what this hardware tool does',
  keywords: ['search', 'terms']   // used by the sidebar filter and the command palette
}
```

Ensure active tool matching is updated in `Sidebar.jsx`:
```javascript
const isActive = 
  activeTool === item.id ||
  (item.id === 'my-new-tool' && ['my-new-tool', 'my-sub-tab'].includes(activeTool));
```

---

### Step 4: Lazy-Load and Render in the Tool Registry
*Location: `src/components/ToolRegistry.jsx`*

1. Add lazy import near the top:
   ```javascript
   const MyNewToolWorkbench = React.lazy(() => import('./tools/MyNewToolWorkbench'));
   ```
2. Add the id to `KNOWN_TOOL_IDS` and a case to the `renderTool` switch:
   ```jsx
   case 'my-new-tool': return <MyNewToolWorkbench onLogMessage={addLog} />;
   ```
3. If the tool is a sub-tab or alias of another tool's window, map it in `TOOL_GROUPS` in `src/utils/windowManager.js`. If it needs a wider default window, add it to `TOOL_NATURAL_WIDTH`.
4. Add the id to `TOOL_TO_ARTICLE_MAP` in `src/wiki/WikiApp.jsx` if its wiki article id differs from the tool id.

---

### Step 5: Author the Technical Wiki Article
*Location: `src/wiki/articles/<category>Articles.js`*

Every tool in Skon's USB Tool **must** have an exhaustive engineering article in the documentation wiki so that users can read low-level documentation directly in the app.

#### Mandatory Article Structure:
```javascript
{
  id: 'my-new-tool',
  toolId: 'my-new-tool',
  category: 'analysis',       // an id from WIKI_CATEGORIES (src/wiki/wikiArticles.js):
                              // core, analysis, rf, webapp, pentesting, programmers, utilities, reference
  title: 'My New Tool — Full Engineering & Protocol Manual',
  summary: '1-sentence high-density summary of protocol, bitfields, and capabilities.',
  tags: ['Tag1', 'Tag2', 'Silicon', 'Protocol'],
  readTime: '20 min read',
  content: `
# My New Tool — Protocol & Workbench Manual

### 1. What Is This Tool & Why Do You Need It?
...

### 2. Hardware Architecture & Physics / Protocol Theory
...
<details>
<summary>Deep Dive: Binary Framing & Register Bitfield Layout</summary>
...
</details>

### 3. Complete UI Control Mapping
| UI Element | Type | Purpose & Behavior |
...

### 4. Step-by-Step Engineering Walkthroughs
#### Walkthrough A: Connecting and Executing...
...

### 5. Complete Troubleshooting & Diagnostic Matrix
| Error Message / Symptom | Root Cause | Engineering Solution |
...

### 6. Upstream Standards & Engineering Attribution
| Standard / Component | Authoring Organization / Maintainers | Reference & Specification |
...
`
}
```

> [!CRITICAL]
> **Escape All Backticks Inside Template Literals**:
> Because article files use JavaScript template strings (`content: \`...\``), any markdown backticks (`\`code\``) inside the string **MUST** be escaped with a backslash (`\``). Unescaped backticks will break Vite's Rollup AST parser and cause `npm run build` to fail!
> 
> Also avoid raw LaTeX `\u` sequences like `\uparrow` (which JavaScript interprets as an invalid Unicode escape). Use standard characters like `↑` instead.

---

## 4. Verification & Testing Checklist

Before considering the new tool complete, run these commands in the terminal:

```bash
# 1. Verify AST syntax of all article modules
node -e "
const fs = require('fs');
fs.readdirSync('src/wiki/articles').forEach(f => {
  const code = fs.readFileSync('src/wiki/articles/' + f, 'utf8');
  new Function(code.replace('export const', 'const'));
  console.log(f + ': PASSED');
});
"

# 2. Run the Vitest unit test suite (every test must pass)
npm run test

# 3. Compile the production bundle (verify zero warnings or chunk errors)
npm run build
```

---

## 5. Security & Safety Guidelines

- **Dual-Use / Defensive Focus**: Design wireless, serial, and protocol tools for diagnostic, educational, monitoring, and defensive analysis purposes (e.g. signal capture, packet dissection, WIDS intrusion alerts, device cataloging).
- **Client-Side Isolation**: Do not introduce remote server dependencies unless connecting to local services (e.g., `localhost:2501` for Kismet, or the optional `backend/` Docker services) over standard REST/WebSocket endpoints. The one hosted piece is the `/api/*` Shodan relay (`worker/index.js`). Never send user hardware keys or firmware dumps to external clouds.
- **Third-Party Ports**: If you port someone else's code, keep its license and copyright note in the file header and add it to `docs/ACKNOWLEDGMENTS.md` (see `src/utils/usbrea/` for the pattern).
