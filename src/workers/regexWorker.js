// Regex matching worker. Runs user patterns off the main thread so a
// catastrophic-backtracking pattern can be terminated by the caller's timeout.
import { runMatch } from '../utils/regexTools.js';

self.onmessage = (e) => {
  const { id, req } = e.data || {};
  let result;
  try {
    result = runMatch(req);
  } catch (err) {
    result = { matches: [], error: String(err?.message || err), truncated: false };
  }
  self.postMessage({ id, result });
};
