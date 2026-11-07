# Regex Tester

**Purpose**: Build and debug JavaScript regular expressions with live feedback
(regex101-style). Fully client-side; no network.

**Usage**:
- Enter a pattern and toggle flags (`g`, `i`, `m`, `s`, `u`, `y`).
- The test string shows highlighted matches; the match panel lists each match
  with its index, numbered capture groups and named groups.
- The replace field previews `String.prototype.replace` output (supports `$1`,
  `$<name>`).
- A quick-reference of common tokens is included.

**Implementation Details**:
- Uses the browser's native `RegExp` engine, so behaviour matches any JS you
  write. Global matching is capped at 10,000 matches and guards against
  zero-width infinite loops. Invalid patterns surface the engine's error.
- `src/components/tools/RegexTesterWorkbench.jsx` (no external dependency).
