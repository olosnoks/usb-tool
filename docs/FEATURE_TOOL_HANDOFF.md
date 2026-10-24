# AI Developer Handoff Guide: Dropping a New Tool into Skon's USB Tool

This document is an exhaustive engineering blueprint for an AI coding assistant (or human contributor) to implement and cleanly drop a brand-new hardware workbench tool into the **Skon's USB Tool** codebase.

---

## 1. High-Level Architecture Overview

- **Frontend Core**: React 18 + Vite (SPA) + Tailwind CSS (vanilla utility styling) + Lucide React icons.
- **Hardware Communication**: Client-side **W3C WebSerial API** and **WebUSB API**. No backend daemon or native drivers required.
- **State & Plumbing**: `src/context/SerialContext.jsx` manages active COM ports, baud rate switching, raw byte buffers, hex streams, and disconnection cleanup.
- **Dual Entrypoints**:
  1. Main Web Application (`index.html` -> `src/main.jsx` -> `src/App.jsx`)
  2. Technical Documentation Wiki (`wiki/index.html` -> `src/wiki/main.jsx` -> `src/wiki/WikiApp.jsx`)

---

## 2. Directory Structure & Key Locations

```
skons-usb-tool/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.jsx           # App top bar & global connection indicators
│   │   │   └── Sidebar.jsx          # Category groupings & tool selector list
│   │   ├── tools/                   # Tool suites & modular workbenches
│   │   │   ├── ProtocolPacketLab.jsx
│   │   │   ├── KismetStudioWorkbench.jsx
│   │   │   └── ...
│   │   └── workbenches/             # Standalone hardware decks
│   │       ├── FlipperWorkbench.jsx
│   │       ├── ProxmarkWorkbench.jsx
│   │       └── ...
│   ├── utils/                       # Low-level protocol drivers & packet parsers
│   │   ├── flipperDriver.js
│   │   ├── mayhemDriver.js
│   │   ├── ubxProtocol.js
│   │   └── ...
│   ├── wiki/
│   │   ├── WikiApp.jsx              # Standalone interactive docs app
│   │   └── articles/                # 7 Article category modules
│   │       ├── coreArticles.js
│   │       ├── hardwareArticles.js
│   │       ├── rfArticles.js
│   │       ├── analysisArticles.js
│   │       ├── payloadArticles.js
│   │       ├── utilityArticles.js
│   │       └── referenceArticles.js
│   ├── App.jsx                      # Main router & lazy component loader
│   └── context/SerialContext.jsx    # Global WebSerial state
└── tests/                           # Vitest unit test suites
```

---

## 3. The 5-Step Process to Drop In a New Feature Tool

### Step 1: Create the Protocol / Driver Layer
*Location: `src/utils/<featureDriver>.js`*

1. **Protocol Framing**: Implement the binary or ASCII packet framing logic (e.g., CRC-16, Fletcher checksums, SLIP/COBS, Protobuf, or magic preambles).
2. **Serial Stream Ingestion**: Export functions to transform incoming `Uint8Array` byte chunks from `SerialContext` into structured JavaScript objects.
3. **Simulation / Fallback Data**: Always export a deterministic set of sample frames or mock responses so the tool can be rendered and tested without a physical USB device connected.

```javascript
// src/utils/myNewDriver.js
export function parseMyProtocolPacket(rawBytes) {
  // 1. Verify magic preamble
  if (rawBytes[0] !== 0xAA || rawBytes[1] !== 0x55) return null;
  // 2. Extract payload & calculate checksum
  // ...
  return { id: rawBytes[2], payload: rawBytes.slice(3, -2) };
}

export const MOCK_TELEMETRY = [
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
   - **Offline / Simulation Toggle**: A checkbox or toggle button (e.g. `Simulate RF` or `Demo Mode`) allowing users and automated Vitest tests to test the full UI without real hardware.
   - **Action Bar**: Clear buffer, Pause/Resume, Export (JSON, CSV, PCAP, or VCD).

---

### Step 3: Register in Sidebar & Navigation
*Location: `src/components/layout/Sidebar.jsx`*

Find the appropriate category array (`core`, `analysis`, `rf`, `payload`, `hardware`, or `utilities`) and add the item:

```javascript
// In src/components/layout/Sidebar.jsx:
{
  id: 'my-new-tool',
  name: 'My New Tool Name',
  icon: Radio,               // from 'lucide-react'
  accent: 'cyan',            // 'cyan' | 'purple' | 'amber' | 'emerald' | 'rose'
  desc: 'Short 1-line engineering description of what this hardware tool does'
}
```

Ensure active tool matching is updated in `Sidebar.jsx`:
```javascript
const isActive = 
  activeTool === item.id ||
  (item.id === 'my-new-tool' && ['my-new-tool', 'my-sub-tab'].includes(activeTool));
```

---

### Step 4: Lazy-Load and Render in App Router
*Location: `src/App.jsx`*

1. Add lazy import near the top:
   ```javascript
   const MyNewToolWorkbench = React.lazy(() => import('./components/workbenches/MyNewToolWorkbench'));
   ```
2. Render in the main tool switch section:
   ```jsx
   {activeTool === 'my-new-tool' && (
     <div className="w-full">
       <MyNewToolWorkbench />
     </div>
   )}
   ```

---

### Step 5: Author the Technical Wiki Article
*Location: `src/wiki/articles/<category>Articles.js`*

Every tool in Skon's USB Tool **must** have an exhaustive engineering article in the documentation wiki so that users can read low-level documentation directly in the app.

#### Mandatory Article Structure:
```javascript
{
  id: 'my-new-tool',
  toolId: 'my-new-tool',
  category: 'analysis',       // or 'core', 'rf', 'hardware', 'payload', 'utilities'
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

# 2. Run the Vitest unit test suite (ensure 92+ tests pass)
npm test -- --run

# 3. Compile the production bundle (verify zero warnings or chunk errors)
npm run build
```

---

## 5. Security & Safety Guidelines

- **Dual-Use / Defensive Focus**: Design wireless, serial, and protocol tools for diagnostic, educational, monitoring, and defensive analysis purposes (e.g. signal capture, packet dissection, WIDS intrusion alerts, device cataloging).
- **Client-Side Isolation**: Do not introduce remote server dependencies unless connecting to local services (e.g., `localhost:2501` for Kismet) over standard REST/WebSocket endpoints. Never send user hardware keys or firmware dumps to external clouds.
