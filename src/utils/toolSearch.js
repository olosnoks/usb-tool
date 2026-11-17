// Shared, dependency-free fuzzy-ish search used by the sidebar, command palette and wiki.
//
// - case / diacritic / punctuation insensitive ('usb-pd' == 'usb pd' == 'usbpd', 'i2c' matches 'I²C')
// - every query token must match somewhere (AND)
// - prefix / word-prefix / substring matches, plus 1-edit typo tolerance for tokens >= 5 chars
// - ranked: exact id/name > name prefix > name word > keyword > description > body

export const DEFAULT_FIELDS = {
  name: ['name', 'title'],
  id: ['id', 'toolId'],
  keywords: ['keywords', 'tags'],
  desc: ['desc', 'summary', 'category'],
  body: [],
};

const TIER_WEIGHT = { name: 100, id: 90, keywords: 40, desc: 15, body: 3 };
const TIERS = ['name', 'id', 'keywords', 'desc', 'body'];

export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenize(query) {
  const n = normalizeText(query);
  return n ? n.split(' ') : [];
}

function toStrings(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toStrings);
  return [String(v)];
}

function makeEntry(raw) {
  const text = normalizeText(raw);
  if (!text) return null;
  const words = text.split(' ');
  return { words, compact: words.join('') };
}

const cache = new WeakMap();

function prepare(item, fields) {
  const sig = JSON.stringify(fields);
  const hit = cache.get(item);
  if (hit && hit.sig === sig) return hit.data;
  const data = {};
  for (const tier of TIERS) {
    const entries = [];
    for (const key of fields[tier] || []) {
      for (const raw of toStrings(item[key])) {
        const e = makeEntry(raw);
        if (e) entries.push(e);
      }
    }
    data[tier] = entries;
  }
  cache.set(item, { sig, data });
  return data;
}

// true when a and b are within one insertion / deletion / substitution
function withinOne(a, b) {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (i === la && i === lb) return true;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1);
  if (la > lb) return a.slice(i + 1) === b.slice(i);
  return b.slice(i + 1) === a.slice(i);
}

function strength(entry, tok, allowTypo) {
  if (entry.compact === tok) return 1;
  if (entry.compact.startsWith(tok)) return 0.9;
  const words = entry.words;
  for (let i = 0; i < words.length; i++) if (words[i].startsWith(tok)) return 0.7;
  if (entry.compact.includes(tok)) return 0.3;
  if (allowTypo) {
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (withinOne(w, tok) || (w.length > tok.length && withinOne(w.slice(0, tok.length), tok))) return 0.25;
    }
  }
  return 0;
}

function scoreToken(data, tok, tiers) {
  const allowTypo = tok.length >= 5;
  let best = 0;
  for (const tier of tiers) {
    const entries = data[tier];
    if (!entries.length) continue;
    const weight = TIER_WEIGHT[tier];
    // body text is large: no typo matching there
    const typo = allowTypo && tier !== 'body';
    for (let i = 0; i < entries.length; i++) {
      const s = strength(entries[i], tok, typo) * weight;
      if (s > best) best = s;
    }
  }
  return best;
}

function scoreItem(item, tokens, joined, fields) {
  const data = prepare(item, fields);
  const tiers = TIERS.filter((t) => data[t].length);
  let total = scoreTokens(data, tokens, tiers);
  if (total === 0 && tokens.length > 1) {
    // 'usb pd' should still find 'usbpd'
    total = scoreTokens(data, [joined], tiers);
  }
  if (total === 0) return 0;
  // whole-query bonuses on name / id
  for (const tier of ['name', 'id']) {
    for (const e of data[tier]) {
      if (e.compact === joined) total += 1000;
      else if (e.compact.startsWith(joined)) total += 200;
    }
  }
  return total;
}

function scoreTokens(data, tokens, tiers) {
  let total = 0;
  for (const tok of tokens) {
    const s = scoreToken(data, tok, tiers);
    if (s === 0) return 0;
    total += s;
  }
  return total;
}

function resolveFields(fields) {
  if (!fields) return DEFAULT_FIELDS;
  return { ...DEFAULT_FIELDS, ...fields };
}

/**
 * Search `items`, returning matches ranked best-first (ties keep original order).
 * Empty / punctuation-only query returns all items in their original order.
 * `fields` optionally overrides which item properties feed each tier:
 *   { name: [...], id: [...], keywords: [...], desc: [...], body: [...] }
 */
export function searchTools(items, query, { fields } = {}) {
  const list = Array.isArray(items) ? items : [];
  const tokens = tokenize(query);
  if (tokens.length === 0) return list.slice();
  const f = resolveFields(fields);
  const joined = tokens.join('');
  const scored = [];
  for (let i = 0; i < list.length; i++) {
    const s = scoreItem(list[i], tokens, joined, f);
    if (s > 0) scored.push({ item: list[i], s, i });
  }
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  return scored.map((x) => x.item);
}

export function matchesTool(item, query, { fields } = {}) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return true;
  return scoreItem(item, tokens, tokens.join(''), resolveFields(fields)) > 0;
}
