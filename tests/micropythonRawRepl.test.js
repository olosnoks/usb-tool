import { describe, it, expect } from 'vitest';
import { runInRawRepl } from '../src/utils/micropythonRawRepl';

const enc = new TextEncoder(), dec = new TextDecoder();

// Fake MicroPython board: friendly REPL until Ctrl-A, raw REPL after; runs
// "print(<string literal>)" or raises; answers in small chunks.
function makeBoard({ ignoreCtrlA = false, slowMs = 0 } = {}) {
  const listeners = new Set();
  let raw = false, code = '';
  const received = [];
  const emit = (s) => { const b = enc.encode(s); for (let i = 0; i < b.length; i += 7) { const c = b.slice(i, i + 7); setTimeout(() => listeners.forEach((f) => f(c)), slowMs); } };
  const write = async (bytes) => {
    for (const ch of dec.decode(bytes)) {
      received.push(ch);
      if (ch === '\x01' && !ignoreCtrlA) { raw = true; code = ''; emit('raw REPL; CTRL-B to exit\r\n>'); continue; }
      if (ch === '\x02') { raw = false; emit('\r\nMicroPython v1.22\r\n>>> '); continue; }
      if (ch === '\x03') { emit('\r\nKeyboardInterrupt\r\n>>> '); continue; }
      if (!raw) continue;
      if (ch === '\x04') {
        const m = code.match(/print\((['"])([\s\S]*)\1\)/);
        emit('OK');
        if (m) emit(m[2] + '\r\n\x04\x04>');
        else emit('\x04Traceback (most recent call last):\r\n  File "<stdin>", line 1\r\nSyntaxError: invalid syntax\r\n\x04>');
        code = '';
        continue;
      }
      code += ch;
    }
  };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  return { write, subscribe, received };
}

describe('MicroPython raw REPL', () => {
  it('runs code and returns stdout, including long output split into chunks', async () => {
    const b = makeBoard();
    const big = 'x'.repeat(5000);
    const out = await runInRawRepl(b.write, b.subscribe, `print('${big}')`);
    expect(out.trim()).toBe(big);
    expect(b.received.at(-1)).toBe('\x02');                 // left the raw REPL
  });

  it('returns the traceback when the code fails', async () => {
    const b = makeBoard();
    const out = await runInRawRepl(b.write, b.subscribe, 'this is not python');
    expect(out).toMatch(/SyntaxError/);
  });

  it('waits for slow boards instead of guessing a fixed delay', async () => {
    const b = makeBoard({ slowMs: 400 });
    const out = await runInRawRepl(b.write, b.subscribe, "print('late')", 5000);
    expect(out.trim()).toBe('late');
  });

  it('fails clearly when the board never enters the raw REPL', async () => {
    const b = makeBoard({ ignoreCtrlA: true });
    await expect(runInRawRepl(b.write, b.subscribe, "print('x')")).rejects.toThrow(/did not enter the raw REPL/);
  }, 10000);
});
