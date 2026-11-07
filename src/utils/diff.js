// Minimal line-level diff (LCS) for the Comparer panel.
// Returns an array of { type: 'eq' | 'add' | 'del', text } rows.

export function lineDiff(aText, bText) {
  const a = (aText || '').split('\n');
  const b = (bText || '').split('\n');
  const n = a.length;
  const m = b.length;
  // LCS length table
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: 'eq', text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: 'del', text: a[i] }); i++; }
    else { rows.push({ type: 'add', text: b[j] }); j++; }
  }
  while (i < n) rows.push({ type: 'del', text: a[i++] });
  while (j < m) rows.push({ type: 'add', text: b[j++] });
  return rows;
}

export function diffStats(rows) {
  return {
    added: rows.filter((r) => r.type === 'add').length,
    removed: rows.filter((r) => r.type === 'del').length,
    same: rows.filter((r) => r.type === 'eq').length,
  };
}
