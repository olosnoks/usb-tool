/**
 * exportStandalone.js
 * Generates and downloads a self-contained, offline-compatible HTML report
 * of the entire CyberChef session (Metadata, Recipe Pipeline, Input, and Output).
 */

/**
 * Escapes HTML characters for safe embedding.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generates standalone HTML document string.
 * @param {Object} session
 * @param {string} [session.title]
 * @param {string} [session.input]
 * @param {Array<Object>} [session.recipe]
 * @param {string} [session.output]
 * @param {string} [session.outputHex]
 * @param {number} [session.durationMs]
 * @param {string} [session.format]
 * @returns {string}
 */
export function generateStandaloneHtml(session = {}) {
  const title = session.title || 'CyberChef Standalone Session';
  const input = session.input || '';
  const recipe = Array.isArray(session.recipe) ? session.recipe : [];
  const output = session.output || '';
  const outputHex = session.outputHex || '';
  const durationMs = session.durationMs !== undefined ? `${session.durationMs} ms` : 'N/A';
  const timestamp = new Date().toISOString();

  let isJson = false;
  let formattedJson = '';
  try {
    const parsed = JSON.parse(output);
    formattedJson = JSON.stringify(parsed, null, 2);
    isJson = true;
  } catch {}

  const recipeHtml = recipe.length === 0
    ? '<p class="empty-state">No operations in recipe.</p>'
    : recipe.map((step, idx) => {
        const opName = escapeHtml(step.op || step.name || 'Unknown Operation');
        const argsList = step.args && Object.keys(step.args).length > 0
          ? Object.entries(step.args)
              .map(([k, v]) => `<span class="arg-pill"><strong>${escapeHtml(k)}:</strong> ${escapeHtml(String(v))}</span>`)
              .join(' ')
          : '<span class="text-muted">Default parameters</span>';

        return `
          <div class="step-card">
            <div class="step-num">${idx + 1}</div>
            <div class="step-body">
              <div class="step-title">${opName}</div>
              <div class="step-args">${argsList}</div>
            </div>
          </div>
        `;
      }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0d0f15;
      --card-bg: #151821;
      --border: #262b3a;
      --text: #e2e8f0;
      --text-muted: #8492a6;
      --accent-cyan: #06b6d4;
      --accent-emerald: #10b981;
      --accent-purple: #a855f7;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      line-height: 1.5;
      padding: 24px;
    }
    .container { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
    .header {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }
    .header-title { font-size: 1.25rem; font-weight: 700; color: #fff; display: flex; align-items: center; gap: 10px; }
    .header-badge {
      background: rgba(6, 182, 212, 0.15);
      color: var(--accent-cyan);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid rgba(6, 182, 212, 0.3);
    }
    .meta-pills { display: flex; gap: 8px; font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-muted); }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }
    .card-title {
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
    }
    .step-list { display: flex; flex-direction: column; gap: 8px; }
    .step-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: #11131a;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 10px 14px;
    }
    .step-num {
      width: 26px;
      height: 26px;
      background: rgba(6, 182, 212, 0.2);
      color: var(--accent-cyan);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 0.8rem;
      font-family: var(--font-mono);
    }
    .step-title { font-weight: 600; font-size: 0.9rem; color: #fff; }
    .step-args { font-size: 0.75rem; margin-top: 2px; }
    .arg-pill {
      background: #1a1e29;
      border: 1px solid #2a3142;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: var(--font-mono);
      color: #94a3b8;
    }
    pre, textarea {
      width: 100%;
      background: #090a0e;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      color: #cbd5e1;
      font-family: var(--font-mono);
      font-size: 0.8rem;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .output-pre { color: var(--accent-emerald); }
    .btn {
      background: #1e2330;
      color: #cbd5e1;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 6px 12px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .btn:hover { background: #282f42; color: #fff; }
    .btn-active { background: rgba(16, 185, 129, 0.2); border-color: var(--accent-emerald); color: var(--accent-emerald); }
    .toolbar { display: flex; gap: 8px; align-items: center; }
    .footer { text-align: center; font-size: 0.75rem; color: var(--text-muted); padding: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="header-title">
        <span>⚡ ${escapeHtml(title)}</span>
        <span class="header-badge">Standalone Session</span>
      </div>
      <div class="meta-pills">
        <span>Generated: ${escapeHtml(timestamp)}</span>
        <span>Duration: ${escapeHtml(durationMs)}</span>
      </div>
    </div>

    <!-- Recipe Pipeline -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Transformation Recipe (${recipe.length} Steps)</span>
        <button class="btn" onclick="copyRecipeJson()">Copy Recipe JSON</button>
      </div>
      <div class="step-list">
        ${recipeHtml}
      </div>
    </div>

    <!-- Input Deck -->
    <div class="card">
      <div class="card-header">
        <span class="card-title">Input Payload (${input.length} chars)</span>
        <button class="btn" onclick="copyText('inputPayload')">Copy Input</button>
      </div>
      <pre id="inputPayload">${escapeHtml(input)}</pre>
    </div>

    <!-- Output Deck -->
    <div class="card">
      <div class="card-header">
        <span class="card-title" style="color: var(--accent-emerald);">Baked Output</span>
        <div class="toolbar">
          ${isJson ? '<button id="btnJson" class="btn" onclick="showFormat(&apos;json&apos;)">JSON Tree</button>' : ''}
          <button id="btnText" class="btn btn-active" onclick="showFormat('text')">Raw Text</button>
          ${outputHex ? '<button id="btnHex" class="btn" onclick="showFormat(&apos;hex&apos;)">Hex</button>' : ''}
          <button class="btn" onclick="copyText('outputContent')">Copy Output</button>
        </div>
      </div>
      <pre id="outputContent" class="output-pre">${escapeHtml(output)}</pre>
    </div>

    <div class="footer">
      Generated by Skon's USB Tool & CyberChef Workbench v3.5
    </div>
  </div>

  <script>
    const rawOutput = ${JSON.stringify(output)};
    const rawHex = ${JSON.stringify(outputHex)};
    const rawJson = ${JSON.stringify(formattedJson)};
    const recipeData = ${JSON.stringify(recipe)};

    function showFormat(fmt) {
      const el = document.getElementById('outputContent');
      document.querySelectorAll('.toolbar .btn').forEach(b => b.classList.remove('btn-active'));
      if (fmt === 'hex' && rawHex) {
        el.textContent = rawHex;
        document.getElementById('btnHex')?.classList.add('btn-active');
      } else if (fmt === 'json' && rawJson) {
        el.textContent = rawJson;
        document.getElementById('btnJson')?.classList.add('btn-active');
      } else {
        el.textContent = rawOutput;
        document.getElementById('btnText')?.classList.add('btn-active');
      }
    }

    function copyText(elemId) {
      const text = document.getElementById(elemId).textContent;
      navigator.clipboard.writeText(text);
      alert('Copied to clipboard!');
    }

    function copyRecipeJson() {
      navigator.clipboard.writeText(JSON.stringify(recipeData, null, 2));
      alert('Recipe JSON copied to clipboard!');
    }
  </script>
</body>
</html>`;
}

/**
 * Generates and automatically triggers the download of a standalone HTML file.
 * @param {Object} session
 * @param {string} [filename]
 */
export function downloadStandaloneHtml(session = {}, filename) {
  if (typeof window === 'undefined') return;
  const html = generateStandaloneHtml(session);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `cyberchef_session_${Date.now()}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

export default {
  generateStandaloneHtml,
  downloadStandaloneHtml,
  escapeHtml
};
