// Pure helpers for the BLE Explorer view: chooser filters and GATT tree filtering.

/**
 * Build the options object for navigator.bluetooth.requestDevice().
 * With no filter text every device is listed (acceptAllDevices). With a name
 * prefix, the chooser only lists devices whose advertised name starts with it.
 * `optionalServices` is always passed so GATT access is granted either way.
 */
export function buildRequestOptions({ namePrefix = '', optionalServices = [] } = {}) {
  const prefix = String(namePrefix || '').trim();
  if (!prefix) return { acceptAllDevices: true, optionalServices };
  return { filters: [{ namePrefix: prefix }], optionalServices };
}

const FLAG_PROPS = {
  read: ['read'],
  write: ['write', 'writeWithoutResponse'],
  notify: ['notify', 'indicate']
};

/**
 * Filter a GATT tree for display. `query` matches (case-insensitive) service or
 * characteristic name, UUID or 4-digit short id (with or without 0x). `flag` is
 * '' | 'read' | 'write' | 'notify' and keeps only characteristics with that
 * capability. A service whose own name/UUID matches keeps all its characteristics
 * that pass the flag. Services left empty are dropped. Returns new objects that
 * keep the original `_ref` handles.
 */
export function filterGattTree(tree, { query = '', flag = '' } = {}) {
  const q = String(query || '').trim().toLowerCase().replace(/^0x/, '');
  const props = FLAG_PROPS[flag] || null;
  const matches = (item) => {
    if (!q) return true;
    const short = item.short != null ? item.short.toString(16).padStart(4, '0') : '';
    return (
      String(item.name || '').toLowerCase().includes(q) ||
      String(item.uuid || '').toLowerCase().includes(q) ||
      (short && short.includes(q))
    );
  };
  const out = [];
  for (const svc of tree || []) {
    const svcMatch = matches(svc);
    const chars = (svc.characteristics || []).filter((ch) => {
      if (props && !props.some((p) => ch.properties?.[p])) return false;
      return svcMatch || matches(ch);
    });
    if (chars.length) out.push({ ...svc, characteristics: chars });
  }
  return out;
}

/** Count characteristics in a tree. */
export function countCharacteristics(tree) {
  return (tree || []).reduce((a, s) => a + (s.characteristics?.length || 0), 0);
}
