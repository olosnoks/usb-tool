// Payload-marker helpers for the Intruder panel.
// Markers use {{default}} syntax anywhere in the URL, headers, or body. The text
// inside the braces is the default value used for positions not currently being
// fuzzed; it is replaced by a payload when that position is attacked.

const MARK = /\{\{([\s\S]*?)\}\}/g;

export function countMarkers(fields) {
  return fields.reduce((n, f) => n + ((f || '').match(MARK) || []).length, 0);
}

// Remove markers, leaving their default inner text (the baseline request).
export function stripMarkers(str) {
  return (str || '').replace(MARK, (_, inner) => inner);
}

/**
 * Produce {url, headers, body} where the marker at global `positionIndex` is set
 * to `payload` and all other markers fall back to their default inner text.
 */
export function applyMarkers({ url, headers, body }, positionIndex, payload) {
  let counter = 0;
  const apply = (s) => (s || '').replace(MARK, (_, inner) => {
    const value = counter === positionIndex ? payload : inner;
    counter += 1;
    return value;
  });
  return { url: apply(url), headers: apply(headers), body: apply(body) };
}
