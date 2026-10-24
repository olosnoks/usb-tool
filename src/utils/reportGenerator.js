/**
 * Executive Summary Report Generator
 * Builds standalone, styled HTML diagnostic audit reports for RF environments.
 */

/**
 * Generates a self-contained HTML audit report string.
 * 
 * @param {Object|Array} devicesArg - Discovered AP devices
 * @param {Object|number} postureScoreArg - Posture evaluation object or numerical score
 * @param {Array} anomaliesArg - Detected identifier or rogue anomalies
 * @param {Object|Array} [clientsArg={}] - Tracked client devices
 * @param {Array} [cleartextMetadataArg=[]] - Observed cleartext protocol queries
 * @returns {string} Full HTML document
 */
export function generateHTMLReport(
  devicesArg = {}, 
  postureScoreArg = 100, 
  anomaliesArg = [], 
  clientsArg = {}, 
  cleartextMetadataArg = []
) {
  // Support positional or single options object
  let devices = devicesArg;
  let posture = postureScoreArg;
  let anomalies = anomaliesArg;
  let clients = clientsArg;
  let cleartext = cleartextMetadataArg;

  if (devicesArg && typeof devicesArg === 'object' && !Array.isArray(devicesArg) && devicesArg.devices) {
    devices = devicesArg.devices;
    posture = devicesArg.postureScore ?? devicesArg.posture ?? 100;
    anomalies = devicesArg.anomalies ?? [];
    clients = devicesArg.clients ?? {};
    cleartext = devicesArg.cleartextMetadata ?? [];
  }

  const deviceList = Array.isArray(devices) ? devices : Object.values(devices || {});
  const clientList = Array.isArray(clients) ? clients : Object.values(clients || {});
  const anomalyList = Array.isArray(anomalies) ? anomalies : [];
  const metadataList = Array.isArray(cleartext) ? cleartext : [];

  const scoreNum = typeof posture === 'number' 
    ? posture 
    : (typeof posture?.score === 'number' ? posture.score : 100);

  const grade = posture?.grade || (scoreNum >= 90 ? 'A' : scoreNum >= 80 ? 'B' : scoreNum >= 70 ? 'C' : scoreNum >= 50 ? 'D' : 'F');
  const level = posture?.level || (scoreNum >= 90 ? 'secure' : scoreNum >= 70 ? 'warning' : 'critical');

  const statusColor = level === 'secure' ? '#10b981' : level === 'warning' ? '#f59e0b' : '#ef4444';
  const statusLabel = level === 'secure' ? 'OPTIMAL / SECURE' : level === 'warning' ? 'DEGRADED / ELEVATED RISK' : 'CRITICAL / HIGH RISK';

  // Sort top 10 strongest APs
  const top10Aps = [...deviceList]
    .sort((a, b) => (b.rssi ?? -100) - (a.rssi ?? -100))
    .slice(0, 10);

  const generatedDate = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RF Environment Executive Audit Report — ${new Date().toISOString().slice(0, 10)}</title>
  <style>
    :root {
      --bg: #070b14;
      --card-bg: #0f172a;
      --border: #1e293b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
      --cyan: #06b6d4;
      --purple: #a855f7;
      --green: #10b981;
      --amber: #f59e0b;
      --rose: #ef4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 32px 24px;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
    }
    header {
      border-bottom: 1px solid var(--border);
      padding-bottom: 24px;
      margin-bottom: 32px;
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-end;
      gap: 16px;
    }
    h1 {
      font-size: 26px;
      font-weight: 800;
      color: #fff;
      letter-spacing: -0.02em;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-secure { background: rgba(16, 185, 129, 0.15); color: var(--green); border: 1px solid var(--green); }
    .badge-warning { background: rgba(245, 158, 11, 0.15); color: var(--amber); border: 1px solid var(--amber); }
    .badge-critical { background: rgba(239, 68, 68, 0.15); color: var(--rose); border: 1px solid var(--rose); }

    .score-card {
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.9), rgba(15, 23, 42, 0.6));
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px;
      margin-bottom: 32px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .score-display {
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .score-circle {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 4px solid ${statusColor};
      box-shadow: 0 0 24px ${statusColor}40;
    }
    .score-num { font-size: 32px; font-weight: 900; line-height: 1; color: #fff; }
    .score-max { font-size: 10px; color: var(--text-muted); font-weight: 600; }
    
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .kpi-title { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
    .kpi-value { font-size: 28px; font-weight: 800; color: #fff; margin-top: 4px; font-family: monospace; }

    .section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      margin-bottom: 32px;
      overflow-x: auto;
    }
    .section-title {
      font-size: 16px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    th {
      padding: 10px 14px;
      background: rgba(30, 41, 59, 0.5);
      color: var(--text-muted);
      font-size: 11px;
      text-transform: uppercase;
      font-weight: 600;
      border-bottom: 1px solid var(--border);
    }
    td {
      padding: 12px 14px;
      border-bottom: 1px solid rgba(30, 41, 59, 0.6);
      font-family: monospace;
    }
    tr:hover { background: rgba(30, 41, 59, 0.3); }

    .pill {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 700;
    }
    .pill-green { background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.4); }
    .pill-amber { background: rgba(245, 158, 11, 0.2); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.4); }
    .pill-rose { background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4); }
    .pill-cyan { background: rgba(6, 182, 212, 0.2); color: #67e8f9; border: 1px solid rgba(6, 182, 212, 0.4); }

    footer {
      text-align: center;
      font-size: 12px;
      color: var(--text-muted);
      padding-top: 24px;
      border-top: 1px solid var(--border);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <div style="font-size: 11px; font-weight: 700; color: var(--cyan); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 4px;">
          Skons 802.11 Diagnostic Suite
        </div>
        <h1>RF Environment Executive Summary</h1>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          Generated: ${generatedDate} • Autonomous WebUSB Passive Audit
        </div>
      </div>
      <div>
        <span class="badge badge-${level}">${statusLabel}</span>
      </div>
    </header>

    <!-- Posture Scorecard -->
    <div class="score-card">
      <div class="score-display">
        <div class="score-circle">
          <div class="score-num">${scoreNum}</div>
          <div class="score-max">OUT OF 100</div>
        </div>
        <div>
          <div style="font-size: 12px; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">Overall Posture Score</div>
          <div style="font-size: 22px; font-weight: 800; color: #fff; margin-top: 2px;">
            Grade: <span style="color: ${statusColor};">${grade}</span> (${statusLabel})
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; max-width: 500px;">
            Calculated based on presence of open Wi-Fi networks, legacy ciphers (WEP/TKIP), generic factory SSIDs, and identity rotation anomalies.
          </div>
        </div>
      </div>
      <div>
        ${posture?.penalties?.length > 0 ? `
          <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px;">Active Health Penalties</div>
          <ul style="list-style: none; font-size: 12px; space-y: 6px;">
            ${posture.penalties.map(p => `
              <li style="color: #fca5a5; margin-bottom: 4px;">⚠️ ${p.description}</li>
            `).join('')}
          </ul>
        ` : `
          <div style="color: var(--green); font-size: 13px; font-weight: 600;">
            ✓ No security posture penalties detected in this environment.
          </div>
        `}
      </div>
    </div>

    <!-- KPI Grid -->
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-title">Discovered Access Points</div>
        <div class="kpi-value" style="color: var(--cyan);">${deviceList.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Tracked Client Stations</div>
        <div class="kpi-value" style="color: var(--purple);">${clientList.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Detected Threat Anomalies</div>
        <div class="kpi-value" style="color: ${anomalyList.length > 0 ? 'var(--rose)' : 'var(--green)'};">${anomalyList.length}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-title">Cleartext Metadata Streams</div>
        <div class="kpi-value" style="color: var(--amber);">${metadataList.length}</div>
      </div>
    </div>

    <!-- Section 1: Top 10 Strongest APs -->
    <div class="section">
      <div class="section-title">
        <span>Top 10 Highest-Power Access Points (RSSI)</span>
        <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">Ranked by received signal strength</span>
      </div>
      ${top10Aps.length === 0 ? `
        <div style="padding: 24px; text-align: center; color: var(--text-muted);">No access points logged in session.</div>
      ` : `
        <table>
          <thead>
            <tr>
              <th>BSSID</th>
              <th>SSID (Network Name)</th>
              <th>Security</th>
              <th>Channel</th>
              <th>Signal (RSSI)</th>
              <th>Handshake</th>
              <th>Vendor OUI</th>
            </tr>
          </thead>
          <tbody>
            ${top10Aps.map(ap => `
              <tr>
                <td style="color: #fff; font-weight: bold;">${ap.bssid}</td>
                <td style="color: var(--cyan);">${ap.ssid || '<Hidden SSID>'} ${ap.isUnmasked ? '<span class="pill pill-amber">(Unmasked)</span>' : ''}</td>
                <td>
                  <span class="pill ${ap.security === 'Open' ? 'pill-rose' : ap.security === 'WEP' ? 'pill-amber' : 'pill-green'}">
                    ${ap.security || 'Open'}
                  </span>
                </td>
                <td>CH ${ap.channel || '—'}</td>
                <td style="color: ${ap.rssi > -60 ? 'var(--green)' : ap.rssi > -75 ? 'var(--amber)' : 'var(--rose)'}; font-weight: bold;">
                  ${ap.rssi} dBm
                </td>
                <td>
                  ${ap.hasHandshake ? '<span class="pill pill-green">Captured</span>' : '<span style="color: var(--text-muted);">—</span>'}
                </td>
                <td style="color: var(--text-muted);">${ap.vendor || 'Unknown OUI'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <!-- Section 2: Detected Threat Anomalies -->
    <div class="section">
      <div class="section-title">
        <span>Threat Anomalies & Identifier Randomization</span>
        <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">Phase 8 & 9 Heuristics</span>
      </div>
      ${anomalyList.length === 0 ? `
        <div style="padding: 20px; text-align: center; color: var(--green); font-size: 13px;">
          ✓ Zero rogue APs or MAC address rotation anomalies detected.
        </div>
      ` : `
        <table>
          <thead>
            <tr>
              <th>Anomaly ID</th>
              <th>Type</th>
              <th>Observed Identifiers</th>
              <th>Correlated Fingerprint / Reason</th>
            </tr>
          </thead>
          <tbody>
            ${anomalyList.map(a => `
              <tr>
                <td style="color: var(--rose); font-weight: bold;">${a.id || 'ANOMALY'}</td>
                <td><span class="pill pill-rose">${a.type || 'Identifier Rotation'}</span></td>
                <td>${(a.clients || []).map(c => c.mac || c.clientMac).join(', ') || a.targetMac || '—'}</td>
                <td style="color: var(--text-muted);">${a.probedSsids ? a.probedSsids.join(', ') : (a.reason || 'Multiple MACs broadcasting identical fingerprint')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <!-- Section 3: Cleartext Protocol Telemetry -->
    <div class="section">
      <div class="section-title">
        <span>Observed Cleartext Protocol Telemetry</span>
        <span style="font-size: 11px; color: var(--text-muted); font-weight: normal;">Unencrypted DNS & HTTP Request Streams</span>
      </div>
      ${metadataList.length === 0 ? `
        <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 13px;">
          No unencrypted cleartext DNS queries or HTTP streams captured during this session.
        </div>
      ` : `
        <table>
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Protocol</th>
              <th>Requesting Client MAC</th>
              <th>Target AP BSSID</th>
              <th>Observed Domain / Endpoint</th>
            </tr>
          </thead>
          <tbody>
            ${metadataList.slice(0, 25).map(m => `
              <tr>
                <td style="color: var(--text-muted);">${m.timestamp || '—'}</td>
                <td><span class="pill ${m.protocol === 'DNS' ? 'pill-cyan' : 'pill-purple'}">${m.protocol}</span></td>
                <td style="color: #fff;">${m.clientMac || '—'}</td>
                <td style="color: var(--text-muted);">${m.bssid || '—'}</td>
                <td style="color: var(--amber); font-weight: bold;">${m.domain}${m.endpoint ? ` (${m.endpoint})` : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}
    </div>

    <footer>
      Report generated autonomously by Skons USB Diagnostic Suite • IEEE 802.11 Monitor Mode Telemetry Engine
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Generates and triggers a browser download for the HTML Executive Summary.
 */
export function downloadExecutiveReport(devices, postureScore, anomalies, clients, cleartextMetadata) {
  const html = generateHTMLReport(devices, postureScore, anomalies, clients, cleartextMetadata);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `RF_Executive_Report_${ts}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates a standard GeoJSON FeatureCollection from devices with valid GPS tags.
 * 
 * @param {Object|Array} devices - Access points map or array
 * @returns {{ type: 'FeatureCollection', features: Array<Object> }} GeoJSON FeatureCollection
 */
export function generateGeoJSON(devices) {
  const list = !devices
    ? []
    : Array.isArray(devices)
      ? devices
      : Object.values(devices);

  const features = [];

  for (const d of list) {
    if (!d) continue;
    const lat = typeof d.latitude === 'number' ? d.latitude : parseFloat(d.latitude);
    const lon = typeof d.longitude === 'number' ? d.longitude : parseFloat(d.longitude);
    const alt = typeof d.altitude === 'number' ? d.altitude : (parseFloat(d.altitude) || 0);

    // Validate geographic coordinates: -90 <= lat <= 90, -180 <= lon <= 180, non-zero
    if (
      !isNaN(lat) &&
      !isNaN(lon) &&
      lat >= -90 &&
      lat <= 90 &&
      lon >= -180 &&
      lon <= 180 &&
      (lat !== 0 || lon !== 0)
    ) {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [lon, lat, alt]
        },
        properties: {
          SSID: d.ssid || '<Unknown>',
          BSSID: d.bssid || d.clientMac || d.sourceMac || '',
          RSSI: typeof d.rssi === 'number' ? d.rssi : -60,
          Vendor: d.vendor || 'Unknown',
          ssid: d.ssid || '<Unknown>',
          bssid: d.bssid || d.clientMac || d.sourceMac || '',
          rssi: typeof d.rssi === 'number' ? d.rssi : -60,
          vendor: d.vendor || 'Unknown',
          channel: d.channel || null,
          security: d.security || 'Open',
          lastSeen: d.lastSeen || d.timestamp || ''
        }
      });
    }
  }

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * Generates standard KML XML string containing <Placemark> tags for Google Earth ingestion.
 * 
 * @param {Object|Array} devices - Access points map or array
 * @returns {string} Standard KML XML document string
 */
export function generateKML(devices) {
  const list = !devices
    ? []
    : Array.isArray(devices)
      ? devices
      : Object.values(devices);

  const validDevices = list.filter(d => {
    if (!d) return false;
    const lat = typeof d.latitude === 'number' ? d.latitude : parseFloat(d.latitude);
    const lon = typeof d.longitude === 'number' ? d.longitude : parseFloat(d.longitude);
    return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 && (lat !== 0 || lon !== 0);
  });

  const placemarks = validDevices.map(d => {
    const lat = Number(d.latitude);
    const lon = Number(d.longitude);
    const alt = Number(d.altitude || 0);
    const ssid = (d.ssid || '<Unknown>').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bssid = d.bssid || d.clientMac || d.sourceMac || '';
    const rssi = typeof d.rssi === 'number' ? d.rssi : -60;
    const vendor = (d.vendor || 'Unknown').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const channel = d.channel || '—';
    const security = d.security || 'Open';

    return `    <Placemark>
      <name>${ssid} (${bssid})</name>
      <description><![CDATA[
        <b>SSID:</b> ${ssid}<br/>
        <b>BSSID:</b> ${bssid}<br/>
        <b>Signal:</b> ${rssi} dBm<br/>
        <b>Vendor:</b> ${vendor}<br/>
        <b>Channel:</b> ${channel}<br/>
        <b>Security:</b> ${security}<br/>
        <b>Last Seen:</b> ${d.lastSeen || d.timestamp || '—'}
      ]]></description>
      <Point>
        <coordinates>${lon},${lat},${alt}</coordinates>
      </Point>
    </Placemark>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Skons USB Tool RF Spatial Telemetry</name>
    <description>Exported 802.11 Monitor Mode Geographic Wi-Fi Capture</description>
${placemarks}
  </Document>
</kml>`;
}

/**
 * Downloads a string or object as a file in the browser.
 */
export function downloadFile(content, fileName, mimeType = 'text/plain;charset=utf-8;') {
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

