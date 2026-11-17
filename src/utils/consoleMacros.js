// Saved-command ("macro") buttons for the serial console. Stored in localStorage,
// importable/exportable as JSON.

export const MACROS_STORAGE_KEY = 'skons.console.macros';
export const MACRO_ENDINGS = ['\r\n', '\n', '\r', '', 'hex'];

function getStorage(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; }
}

/** Validate/normalise one macro; returns null when unusable. */
export function normalizeMacro(m) {
  if (!m || typeof m !== 'object') return null;
  const name = String(m.name ?? '').trim();
  const text = String(m.text ?? '');
  if (!name || !text) return null;
  const ending = MACRO_ENDINGS.includes(m.ending) ? m.ending : '\r\n';
  const id = typeof m.id === 'string' && m.id ? m.id : `m-${Math.random().toString(36).slice(2, 9)}`;
  return { id, name: name.slice(0, 40), text, ending };
}

export function loadMacros(storage) {
  const s = getStorage(storage);
  if (!s) return [];
  try {
    const parsed = JSON.parse(s.getItem(MACROS_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeMacro).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

export function saveMacros(macros, storage) {
  const s = getStorage(storage);
  if (!s) return false;
  try { s.setItem(MACROS_STORAGE_KEY, JSON.stringify(macros)); return true; } catch (e) { return false; }
}

export function exportMacros(macros) {
  return JSON.stringify({ format: 'skons-console-macros', version: 1, macros }, null, 2);
}

/** Parse an exported file (or a bare array). Throws on malformed input. */
export function importMacros(jsonText) {
  const data = JSON.parse(jsonText);
  const list = Array.isArray(data) ? data : data && Array.isArray(data.macros) ? data.macros : null;
  if (!list) throw new Error('Not a macro file');
  const macros = list.map(normalizeMacro).filter(Boolean);
  if (macros.length === 0) throw new Error('No valid macros in file');
  return macros;
}

/**
 * Expand backslash escapes in a macro/send text: \r \n \t \e \\ and \xNN.
 * Unknown escapes are left untouched.
 */
export function expandEscapes(text) {
  return String(text).replace(/\\(x[0-9a-fA-F]{2}|[rnte\\0])/g, (_, c) => {
    if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16));
    switch (c) {
      case 'r': return '\r';
      case 'n': return '\n';
      case 't': return '\t';
      case 'e': return '\x1b';
      case '0': return '\0';
      default: return '\\';
    }
  });
}
