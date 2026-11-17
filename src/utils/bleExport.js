// Pure exporters for the BLE explorer: GATT tree (JSON / Markdown) and the
// notification history (CSV).

export const BLE_EXPORT_TOOL = 'skons-usb-tool ble-explorer';
export const BLE_EXPORT_VERSION = '1.0.0';
export const NOTIFY_HISTORY_CAP = 2000;

const PROP_KEYS = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'];

const decodedText = (v) => (v?.decoded ? `${v.decoded.label}: ${v.decoded.text}` : null);

/** Numeric reading of a value for charts: decoded text number, else the first integer view. */
export function numericValue(v) {
  if (!v || v.error) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)/.exec(v.decoded?.text ?? '');
  if (m) return Number(m[1]);
  const first = v.numbers?.[0]?.[1];
  return typeof first === 'number' && Number.isFinite(first) ? first : null;
}

function valueRecord(v) {
  if (!v) return null;
  if (v.error) return { error: String(v.error) };
  return {
    hex: v.hex ?? '',
    decoded: decodedText(v),
    byteLength: v.byteLength ?? null,
    timestamp: v.ts ? new Date(v.ts).toISOString() : null
  };
}

const propsOf = (ch) => PROP_KEYS.filter((k) => ch.properties?.[k]);

/** Strip live handles (`_ref`) and shape the tree for export. */
export function gattToJson(device, tree, values = {}, opts = {}) {
  return {
    tool: BLE_EXPORT_TOOL,
    toolVersion: opts.toolVersion || BLE_EXPORT_VERSION,
    exportedAt: opts.exportedAt || new Date().toISOString(),
    device: { name: device?.name || null, id: device?.id || null },
    services: (tree || []).map((s) => ({
      uuid: s.uuid,
      name: s.name,
      assigned: Boolean(s.assigned),
      characteristics: (s.characteristics || []).map((c) => ({
        uuid: c.uuid,
        name: c.name,
        properties: propsOf(c),
        value: valueRecord(values[c.uuid]),
        descriptors: (c.descriptors || []).map((d) => ({
          uuid: d.uuid,
          name: d.name,
          value: valueRecord(values[`${c.uuid}/${d.uuid}`])
        }))
      }))
    }))
  };
}

const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function gattToMarkdown(device, tree, values = {}, opts = {}) {
  const j = gattToJson(device, tree, values, opts);
  const lines = [];
  lines.push(`# GATT dump: ${j.device.name || '(unnamed device)'}`);
  lines.push('');
  lines.push(`- Device ID: \`${j.device.id || 'unknown'}\``);
  lines.push(`- Exported: ${j.exportedAt}`);
  lines.push(`- Tool: ${j.tool} v${j.toolVersion}`);
  lines.push('');
  for (const s of j.services) {
    lines.push(`## ${mdCell(s.name)}`);
    lines.push('');
    lines.push(`\`${s.uuid}\` (${s.assigned ? 'SIG-assigned' : 'vendor-specific'})`);
    lines.push('');
    if (!s.characteristics.length) {
      lines.push('_No characteristics exposed._');
      lines.push('');
      continue;
    }
    lines.push('| Characteristic | UUID | Properties | Hex | Decoded | Time |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const c of s.characteristics) {
      const v = c.value;
      lines.push(
        `| ${mdCell(c.name)} | \`${c.uuid}\` | ${c.properties.join(', ') || '-'} | ` +
          `${v?.error ? `error: ${mdCell(v.error)}` : v ? `\`${v.hex || '(empty)'}\`` : '-'} | ` +
          `${mdCell(v?.decoded || '')} | ${v?.timestamp || ''} |`
      );
      for (const d of c.descriptors) {
        const dv = d.value;
        lines.push(
          `| &nbsp;&nbsp;descriptor ${mdCell(d.name)} | \`${d.uuid}\` | | ` +
            `${dv?.error ? `error: ${mdCell(dv.error)}` : dv ? `\`${dv.hex || '(empty)'}\`` : '-'} | ${mdCell(dv?.decoded || '')} | |`
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

const csvCell = (s) => {
  let t = String(s ?? '');
  // Neutralise spreadsheet formula injection from device-supplied text.
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/**
 * `history` is an array of { ts, characteristic, hex, decoded }, or a map of
 * uuid -> array of those. Columns: time,characteristic,hex,decoded.
 */
export function notificationsToCsv(history) {
  const rows = Array.isArray(history) ? history : Object.values(history || {}).flat();
  const sorted = [...rows].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const out = ['time,characteristic,hex,decoded'];
  for (const r of sorted) {
    out.push(
      [new Date(r.ts).toISOString(), r.characteristic, r.hex, r.decoded ?? ''].map(csvCell).join(',')
    );
  }
  return out.join('\n') + '\n';
}

/** Append to a bounded list (mutates, returns it). */
export function pushBounded(list, entry, cap = NOTIFY_HISTORY_CAP) {
  list.push(entry);
  if (list.length > cap) list.splice(0, list.length - cap);
  return list;
}

/**
 * Stop notifications and remove the listeners in a `uuid -> { characteristic,
 * handler }` map. Never throws. Returns how many subscriptions were released.
 */
export function teardownSubscriptions(subs) {
  let n = 0;
  for (const sub of Object.values(subs || {})) {
    try { sub.characteristic.removeEventListener('characteristicvaluechanged', sub.handler); } catch { /* ignore */ }
    try {
      const p = sub.characteristic.stopNotifications?.();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* ignore */ }
    n += 1;
  }
  return n;
}

/**
 * Release everything held for a device on unmount: subscriptions, the
 * disconnect listener and (unless `keepLink`) the GATT connection.
 */
export function releaseBleSession({ subs, device, disconnectListener, keepLink = false }) {
  teardownSubscriptions(subs);
  if (disconnectListener) {
    try { disconnectListener.dev.removeEventListener('gattserverdisconnected', disconnectListener.fn); } catch { /* ignore */ }
  }
  if (!keepLink && device?.gatt?.connected) {
    try { device.gatt.disconnect(); } catch { /* ignore */ }
    return true;
  }
  return false;
}
