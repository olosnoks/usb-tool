import { describe, it, expect } from 'vitest';
import { lintDucky, estimateTiming, convertDialect, toArduino, toCircuitPython, parseKeyCombo, expandScript, formatDuration } from '../src/utils/duckyScript';

describe('lintDucky', () => {
  it('accepts a clean script', () => {
    expect(lintDucky('REM hi\nDEFAULT_DELAY 100\nGUI r\nDELAY 500\nSTRING notepad\nENTER\nCTRL-SHIFT ESC\nCTRL ALT DELETE', 'ducky1')).toEqual([]);
  });
  it('flags unknown commands and bad delays', () => {
    const r = lintDucky('FOO bar\nDELAY abc\nDELAY\nSTRING', 'ducky1');
    expect(r.map((x) => x.line)).toEqual([1, 2, 3, 4]);
    expect(r.every((x) => x.severity === 'error')).toBe(true);
  });
  it('flags v3 constructs in 1.0 and unclosed blocks in 3.0', () => {
    expect(lintDucky('DEFINE X 1', 'ducky1').length).toBe(1);
    expect(lintDucky('IF $A == 1 THEN\nENTER', 'ducky3').some((x) => /never closed/.test(x.message))).toBe(true);
    expect(lintDucky('IF $A == 1 THEN\nENTER\nEND_IF', 'ducky3')).toEqual([]);
    expect(lintDucky('END_WHILE', 'ducky3').length).toBe(1);
  });
  it('checks Flipper ID placement and format', () => {
    expect(lintDucky('ID 046D:C31C Logi:Kbd\nENTER', 'flipper')).toEqual([]);
    expect(lintDucky('ENTER\nID 046D:C31C', 'flipper').length).toBe(1);
    expect(lintDucky('ID nonsense', 'flipper').length).toBe(1);
  });
  it('warns REPEAT without a target and ignores block bodies', () => {
    expect(lintDucky('REPEAT 3', 'ducky3')[0].severity).toBe('warning');
    expect(lintDucky('STRING_BLOCK\nnot a command\nEND_STRING', 'ducky3')).toEqual([]);
    expect(lintDucky('STRING_BLOCK\nx', 'ducky3').length).toBe(1);
  });
  it('flags bad keys and dangling modifiers', () => {
    expect(lintDucky('GUI zz', 'ducky1').length).toBe(1);
    expect(lintDucky('GUI SHIFT', 'ducky1').length).toBe(1);
    expect(lintDucky('ENTER', 'ducky1')).toEqual([]);
  });
});

describe('timing', () => {
  it('sums delays, typing and default delay', () => {
    const t = estimateTiming('DEFAULT_DELAY 100\nGUI r\nDELAY 500\nSTRING abcde\nENTER');
    expect(t.totalMs).toBe(120 + 500 + 150 + 120);
    expect(t.typedChars).toBe(5);
  });
  it('expands REPEAT', () => {
    expect(expandScript('TAB\nREPEAT 3').length).toBe(4);
    expect(estimateTiming('DELAY 10\nREPEAT 2').delays).toBe(30);
  });
  it('formats durations', () => {
    expect(formatDuration(250)).toBe('250 ms');
    expect(formatDuration(2500)).toBe('2.5 s');
    expect(formatDuration(125000)).toBe('2 min 5 s');
  });
});

describe('dialect conversion', () => {
  it('maps aliases and comments out unsupported lines', () => {
    const r = convertDialect('WINDOWS r\nSTRINGLN hi\nVAR $A = 1\nDEFAULTDELAY 5', 'ducky1');
    expect(r.text.split('\n')).toEqual(['GUI r', 'STRING hi', 'ENTER', 'REM [unsupported in 1.0] VAR $A = 1', 'DEFAULT_DELAY 5']);
    expect(r.notes.length).toBe(2);
  });
  it('comments out v3 control flow for Flipper', () => {
    expect(convertDialect('IF $A THEN\nEND_IF\nENTER', 'flipper').text).toContain('REM [unsupported on Flipper] IF');
  });
});

describe('exporters', () => {
  it('parses combos', () => {
    expect(parseKeyCombo('CTRL-ALT DEL')).toEqual({ mods: ['CTRL', 'ALT'], key: 'DELETE', error: null });
  });
  it('exports Arduino with combos, arrows and escaping', () => {
    const { code, skipped } = toArduino('GUI r\nSTRING say "hi"\nCTRL ALT DELETE\nDOWN\nBOGUS');
    expect(code).toContain('Keyboard.press(KEY_LEFT_GUI);');
    expect(code).toContain("Keyboard.press('r');");
    expect(code).toContain('Keyboard.print("say \\"hi\\"");');
    expect(code).toContain('Keyboard.press(KEY_DELETE);');
    expect(code).toContain('Keyboard.write(KEY_DOWN_ARROW);');
    expect(skipped).toEqual(['BOGUS']);
  });
  it('exports CircuitPython', () => {
    const { code } = toCircuitPython('GUI r\nDELAY 500\nSTRINGLN x\nCTRL SHIFT ESC\nF5');
    expect(code).toContain('kbd.send(Keycode.GUI, Keycode.R)');
    expect(code).toContain('time.sleep(0.5)');
    expect(code).toContain('layout.write("x")\nkbd.send(Keycode.ENTER)');
    expect(code).toContain('kbd.send(Keycode.CONTROL, Keycode.SHIFT, Keycode.ESCAPE)');
    expect(code).toContain('kbd.send(Keycode.F5)');
  });
});
