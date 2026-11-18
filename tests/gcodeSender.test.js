import { describe, it, expect } from 'vitest';
import {
  GRBL_CHAR_LIMIT, REALTIME, utf8Length, stripGcode, prepareGcodeLines, marlinChecksum, marlinNumbered,
  encodeForFirmware, fmtNum, parseTempReport, parseMarlinFirmware, parseGrblVersion, parseGrblSetting,
  parseGrblStatus, resolveCoordinates, classifyLine, buildJog, homeLines, zeroLines, hotendLines, bedLines,
  fanLines, autoReportLines, extrudeLines, normalizeConsoleLine, makeTempSample, appendTempSample,
  createLineSplitter, estimateRemainingMs, GcodeStreamer,
} from '../src/utils/gcodeSender';

const enc = new TextEncoder();

describe('line preparation', () => {
  it('strips semicolon and parenthesis comments and collapses spaces', () => {
    expect(stripGcode('G1 X10 Y20 ; move')).toBe('G1 X10 Y20');
    expect(stripGcode('G1 (rapid) X10   (to)  Y20')).toBe('G1 X10 Y20');
    expect(stripGcode('  ; only a comment')).toBe('');
    expect(stripGcode('(only parens)')).toBe('');
    expect(stripGcode('')).toBe('');
  });

  it('removes an existing N line number and *checksum so lines are not double-numbered', () => {
    expect(stripGcode('N10 G1 X5*67')).toBe('G1 X5');
  });

  it('prepares a file, skipping blanks, comments and % delimiters', () => {
    const text = '%\r\n; header\nG21\n\n(comment)\nG90 ; abs\r\nG1 X1\r%\n';
    const { commands, skipped } = prepareGcodeLines(text);
    expect(commands).toEqual(['G21', 'G90', 'G1 X1']);
    // %, "; header", blank, "(comment)", %, and the empty string after the final newline.
    expect(skipped).toBe(6);
  });

  it('handles empty and missing input', () => {
    expect(prepareGcodeLines('')).toEqual({ commands: [], skipped: 1 });
    expect(prepareGcodeLines(undefined).commands).toEqual([]);
  });
});

describe('Marlin checksum and line numbers', () => {
  it('matches the known vector for "N0 M110 N0" (checksum 125)', () => {
    expect(marlinChecksum('N0 M110 N0')).toBe(125);
    expect(marlinNumbered('M110 N0', 0)).toBe('N0 M110 N0*125');
  });

  it('matches the hand-computed vector for "N1 G28" (checksum 18)', () => {
    expect(marlinNumbered('G28', 1)).toBe('N1 G28*18');
  });

  it('XOR is over every character including the N and the space', () => {
    expect(marlinChecksum('')).toBe(0);
    expect(marlinChecksum('A')).toBe(65);
    expect(marlinChecksum('AA')).toBe(0);
  });

  it('encodes Marlin lines with a newline and GRBL lines with a newline and no numbering', () => {
    expect(encodeForFirmware('marlin', 'G28', 1)).toBe('N1 G28*18\n');
    expect(encodeForFirmware('grbl', '$H', 7)).toBe('$H\n');
  });
});

describe('number formatting and byte length', () => {
  it('formats without exponents or trailing zeros', () => {
    expect(fmtNum(10)).toBe('10');
    expect(fmtNum(10.5)).toBe('10.5');
    expect(fmtNum(0.0000001)).toBe('0');
    expect(fmtNum(-0.00001)).toBe('0');
    expect(fmtNum(-2.25)).toBe('-2.25');
    expect(fmtNum(100)).toBe('100');
    expect(() => fmtNum(Number.NaN)).toThrow();
  });

  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });

  it('exposes the GRBL buffer constants and realtime bytes', () => {
    expect(GRBL_CHAR_LIMIT).toBe(127);
    expect(REALTIME.STATUS).toBe(0x3f);
    expect(REALTIME.FEED_HOLD).toBe(0x21);
    expect(REALTIME.CYCLE_START).toBe(0x7e);
    expect(REALTIME.SOFT_RESET).toBe(0x18);
  });
});

describe('Marlin temperature reports', () => {
  it('parses an M105 reply with hotend and bed targets', () => {
    const r = parseTempReport('ok T:201.23 /210.00 B:60.00 /60.00 @:127 B@:0');
    expect(r.hotends).toEqual([{ index: 0, actual: 201.23, target: 210 }]);
    expect(r.bed).toEqual({ actual: 60, target: 60 });
    expect(r.chamber).toBeNull();
  });

  it('parses multiple hotends as T0/T1 and sorts them', () => {
    const r = parseTempReport('T1:25.0 /0.0 T0:100.0 /200.0 B:50.0 /60.0');
    expect(r.hotends).toEqual([
      { index: 0, actual: 100, target: 200 },
      { index: 1, actual: 25, target: 0 },
    ]);
    expect(r.bed.actual).toBe(50);
  });

  it('parses an auto-report line (M155) with a leading space', () => {
    const r = parseTempReport(' T:21.00 /0.00 B:20.5 /0.00 @:0 B@:0');
    expect(r.hotends[0]).toEqual({ index: 0, actual: 21, target: 0 });
    expect(r.bed).toEqual({ actual: 20.5, target: 0 });
  });

  it('leaves the bed null when the bed reports no value (B:@0 form)', () => {
    const r = parseTempReport('T:20.5 /0.0 B:@0');
    expect(r.hotends[0].actual).toBe(20.5);
    expect(r.bed).toBeNull();
  });

  it('accepts negative values and missing targets', () => {
    const r = parseTempReport('T:-3.5 B:12');
    expect(r.hotends[0]).toEqual({ index: 0, actual: -3.5, target: null });
    expect(r.bed).toEqual({ actual: 12, target: null });
  });

  it('returns null for text that is not a temperature report', () => {
    expect(parseTempReport('echo:busy: processing')).toBeNull();
    expect(parseTempReport('Count X: 0 Y: 0')).toBeNull();
    expect(parseTempReport('Tool: 3')).toBeNull();
    expect(parseTempReport('')).toBeNull();
  });

  it('builds chart samples and keeps only the newest points', () => {
    const r = parseTempReport('T:200.0 /210.0 B:60.0 /60.0');
    expect(makeTempSample(1.5, r)).toEqual({ t: 1.5, hotend: 200, hotendTarget: 210, bed: 60, bedTarget: 60 });
    let h = [];
    for (let i = 0; i < 5; i++) h = appendTempSample(h, { t: i }, 3);
    expect(h.map((s) => s.t)).toEqual([2, 3, 4]);
  });
});

describe('firmware identification', () => {
  it('parses an M115 FIRMWARE_NAME line into fields and a version', () => {
    const info = parseMarlinFirmware(
      'FIRMWARE_NAME:Marlin 2.1.2.1 (Nov 15 2023 10:00:00) SOURCE_CODE_URL:https://github.com/MarlinFirmware/Marlin PROTOCOL_VERSION:1.0 MACHINE_TYPE:Ender-3 EXTRUDER_COUNT:1 UUID:abc',
    );
    expect(info.name).toBe('Marlin 2.1.2.1 (Nov 15 2023 10:00:00)');
    expect(info.version).toBe('2.1.2.1');
    expect(info.fields.SOURCE_CODE_URL).toBe('https://github.com/MarlinFirmware/Marlin');
    expect(info.fields.MACHINE_TYPE).toBe('Ender-3');
    expect(info.fields.EXTRUDER_COUNT).toBe('1');
  });

  it('reads the GRBL banner and the $I [VER:] reply', () => {
    expect(parseGrblVersion("Grbl 1.1h ['$' for help]")).toBe('1.1h');
    expect(parseGrblVersion('[VER:1.1h.20190825:]')).toBe('1.1h.20190825');
    expect(parseGrblVersion('ok')).toBeNull();
  });
});

describe('GRBL settings and status', () => {
  it('parses $$ lines with and without a comment', () => {
    expect(parseGrblSetting('$100=250.000')).toEqual({ id: 100, value: '250.000', comment: '' });
    expect(parseGrblSetting('$32=0 (Laser mode disable)')).toEqual({ id: 32, value: '0', comment: 'Laser mode disable' });
    expect(parseGrblSetting('ok')).toBeNull();
    expect(parseGrblSetting('$H')).toBeNull();
  });

  it('parses an Idle status with MPos, FS and WCO', () => {
    const s = parseGrblStatus('<Idle|MPos:0.000,0.000,0.000|FS:0,0|WCO:1.000,2.000,3.000>');
    expect(s.state).toBe('Idle');
    expect(s.substate).toBeNull();
    expect(s.mpos).toEqual([0, 0, 0]);
    expect(s.feed).toBe(0);
    expect(s.speed).toBe(0);
    expect(s.wco).toEqual([1, 2, 3]);
  });

  it('parses a Run status with WPos, buffer, overrides and feed', () => {
    const s = parseGrblStatus('<Run|WPos:1.000,2.000,3.500|Bf:15,127|FS:500,0|Ov:100,100,100>');
    expect(s.state).toBe('Run');
    expect(s.wpos).toEqual([1, 2, 3.5]);
    expect(s.buffer).toEqual({ planner: 15, rx: 127 });
    expect(s.feed).toBe(500);
    expect(s.overrides).toEqual({ feed: 100, rapid: 100, spindle: 100 });
  });

  it('keeps the substate of states such as Hold:0', () => {
    const s = parseGrblStatus('<Hold:1|MPos:5.000,5.000,5.000|FS:0,0>');
    expect(s.state).toBe('Hold');
    expect(s.substate).toBe('1');
  });

  it('reads the legacy F: feed field and the pin string', () => {
    const s = parseGrblStatus('<Idle|MPos:0,0,0|F:250|Pn:XY>');
    expect(s.feed).toBe(250);
    expect(s.pins).toBe('XY');
  });

  it('rejects lines that are not status reports', () => {
    expect(parseGrblStatus('ok')).toBeNull();
    expect(parseGrblStatus('<>')).toBeNull();
    expect(parseGrblStatus('<Idle|MPos:a,b,c>').mpos).toBeNull();
    expect(parseGrblStatus('<Idle')).toBeNull();
  });

  it('derives MPos from WPos and WCO, using a cached WCO when the report omits it', () => {
    const s = parseGrblStatus('<Run|WPos:10.000,20.000,0.000>');
    expect(resolveCoordinates(s, [1, 2, 3])).toEqual({
      mpos: [11, 22, 3], wpos: [10, 20, 0], wco: [1, 2, 3],
    });
    const m = parseGrblStatus('<Run|MPos:11.000,22.000,3.000|WCO:1.000,2.000,3.000>');
    expect(resolveCoordinates(m).wpos).toEqual([10, 20, 0]);
    expect(resolveCoordinates(parseGrblStatus('<Run|WPos:1,2,3>')).mpos).toBeNull();
  });
});

describe('reply classification', () => {
  it('classifies acknowledgements', () => {
    expect(classifyLine('ok').type).toBe('ok');
    expect(classifyLine('ok\r').type).toBe('ok');
    expect(classifyLine('ok N5 P15 B3').type).toBe('ok');
    expect(classifyLine('okay').type).toBe('text');
  });

  it('treats an M105 reply as an ok that also carries temperatures', () => {
    const c = classifyLine('ok T:20.0 /0.0 B:19.0 /0.0');
    expect(c.type).toBe('ok');
    expect(c.temp.hotends[0].actual).toBe(20);
  });

  it('classifies Marlin resend requests in both spellings', () => {
    expect(classifyLine('Resend: 12')).toEqual({ type: 'resend', lineNumber: 12 });
    expect(classifyLine('rs N7')).toEqual({ type: 'resend', lineNumber: 7 });
  });

  it('classifies Marlin errors, flagging line-number and checksum errors', () => {
    expect(classifyLine('Error:Line Number is not Last Line Number+1, Last Line: 11')).toMatchObject({ type: 'marlin-error', lineError: true });
    expect(classifyLine('Error:checksum mismatch, Last Line: 4')).toMatchObject({ type: 'marlin-error', lineError: true });
    expect(classifyLine('Error:Heating failed')).toMatchObject({ type: 'marlin-error', lineError: false });
  });

  it('classifies GRBL errors, alarms, busy and echo lines', () => {
    expect(classifyLine('error:20')).toEqual({ type: 'grbl-error', code: 20 });
    expect(classifyLine('ALARM:1')).toEqual({ type: 'grbl-alarm', code: 1 });
    expect(classifyLine('echo:busy: processing')).toEqual({ type: 'busy' });
    expect(classifyLine('echo:Unknown command: "$I"')).toEqual({ type: 'echo', text: 'Unknown command: "$I"' });
  });

  it('classifies status, settings, version and firmware lines and empty lines', () => {
    expect(classifyLine('<Idle|MPos:0,0,0>').type).toBe('grbl-status');
    expect(classifyLine('$110=500.000').type).toBe('grbl-setting');
    expect(classifyLine('[VER:1.1h.20190825:]').type).toBe('grbl-version');
    expect(classifyLine('FIRMWARE_NAME:Marlin 2.1.2').type).toBe('marlin-firmware');
    expect(classifyLine('   ').type).toBe('empty');
    expect(classifyLine('Something else').type).toBe('text');
  });

  it('classifies a bare auto-report temperature line as temp, not ok', () => {
    expect(classifyLine(' T:21.00 /0.00 B:20.5 /0.00')).toMatchObject({ type: 'temp' });
  });
});

describe('command builders', () => {
  it('builds GRBL and Marlin jogs', () => {
    expect(buildJog('grbl', { axis: 'x', distance: 10, feed: 1000 })).toEqual(['$J=G21G91X10F1000']);
    expect(buildJog('grbl', { axis: 'Z', distance: -0.1, feed: 300 })).toEqual(['$J=G21G91Z-0.1F300']);
    expect(buildJog('marlin', { axis: 'Y', distance: 1, feed: 3000 })).toEqual(['G91', 'G1 Y1 F3000', 'G90']);
  });

  it('rejects bad jog input', () => {
    expect(() => buildJog('grbl', { axis: 'Q', distance: 1, feed: 1 })).toThrow(/axis/);
    expect(() => buildJog('grbl', { axis: 'X', distance: 0, feed: 1 })).toThrow(/distance/);
    expect(() => buildJog('grbl', { axis: 'X', distance: 1, feed: 0 })).toThrow(/feed/);
    expect(() => buildJog('klipper', { axis: 'X', distance: 1, feed: 1 })).toThrow(/firmware/i);
  });

  it('builds home and zero commands', () => {
    expect(homeLines('grbl')).toEqual(['$H']);
    expect(homeLines('marlin')).toEqual(['G28']);
    expect(zeroLines('grbl', ['X', 'Y'])).toEqual(['G10 L20 P1 X0 Y0']);
    expect(zeroLines('marlin', ['Z'])).toEqual(['G92 Z0']);
    expect(() => zeroLines('marlin', [])).toThrow();
  });

  it('builds temperature, fan and auto-report commands with range checks', () => {
    expect(hotendLines(210)).toEqual(['M104 S210']);
    expect(bedLines(60.4)).toEqual(['M140 S60.4']);
    expect(() => hotendLines(999)).toThrow(/Hotend/);
    expect(() => bedLines(-1)).toThrow(/Bed/);
    expect(fanLines(255)).toEqual(['M106 S255']);
    expect(fanLines(0)).toEqual(['M107']);
    expect(fanLines('off')).toEqual(['M107']);
    expect(() => fanLines(300)).toThrow();
    expect(autoReportLines(2)).toEqual(['M155 S2']);
    expect(autoReportLines(0)).toEqual(['M155 S0']);
  });

  it('builds relative extrude and retract moves that restore absolute E', () => {
    expect(extrudeLines(5, 300)).toEqual(['M83', 'G1 E5 F300', 'M82']);
    expect(extrudeLines(-3, 1800)).toEqual(['M83', 'G1 E-3 F1800', 'M82']);
    expect(() => extrudeLines(0, 300)).toThrow();
    expect(() => extrudeLines(1, 0)).toThrow();
  });

  it('normalises console input to one line', () => {
    expect(normalizeConsoleLine('  M115\r\n')).toBe('M115');
    expect(normalizeConsoleLine(undefined)).toBe('');
  });
});

describe('receive framing and ETA', () => {
  it('splits a byte stream on newlines and keeps partial lines', () => {
    const s = createLineSplitter();
    expect(s.push(enc.encode('ok\r\nT:20.0 /0.0'))).toEqual(['ok']);
    expect(s.push(enc.encode(' B:19\n'))).toEqual(['T:20.0 /0.0 B:19']);
    expect(s.push(enc.encode('partial'))).toEqual([]);
    expect(s.flush()).toEqual(['partial']);
    expect(s.flush()).toEqual([]);
  });

  it('decodes a multi-byte character split across chunks', () => {
    const s = createLineSplitter();
    const bytes = enc.encode('é\n');
    expect(s.push(bytes.slice(0, 1))).toEqual([]);
    expect(s.push(bytes.slice(1))).toEqual(['é']);
  });

  it('estimates remaining time from the pace so far', () => {
    expect(estimateRemainingMs({ done: 0, total: 10, elapsedMs: 1000 })).toBeNull();
    expect(estimateRemainingMs({ done: 5, total: 10, elapsedMs: 1000 })).toBe(1000);
    expect(estimateRemainingMs({ done: 10, total: 10, elapsedMs: 5000 })).toBe(0);
  });
});

/** Drive a streamer like the workbench does; `replies` is a list of classified-line inputs. */
function drive(streamer, firstOut, replies) {
  const sent = [...firstOut];
  for (const r of replies) {
    streamer.receive(typeof r === 'string' ? classifyLine(r) : r);
    sent.push(...streamer.pump());
  }
  return sent;
}

describe('GcodeStreamer (Marlin)', () => {
  const cmds = ['G21', 'G90', 'G1 X10 F1200'];

  it('opens with M110 N0 and sends one numbered line per ok', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    const out = s.start();
    expect(out).toEqual(['N0 M110 N0*125\n']);
    expect(s.pump()).toEqual([]); // one line in flight
    expect(s.receive(classifyLine('ok'))).toEqual([{ type: 'ack', index: 0 }]);
    expect(drive(s, [], [])).toEqual([]);
    const next = s.pump();
    expect(next).toEqual([`${marlinNumbered('G21', 1)}\n`]);
  });

  it('runs to done and reports progress', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    const sent = drive(s, s.start(), ['ok', 'ok', 'ok', 'ok']);
    expect(sent).toHaveLength(4); // M110 + 3 commands
    expect(s.state).toBe('done');
    expect(s.progress()).toMatchObject({ state: 'done', total: 3, done: 3, percent: 100, resends: 0, errors: 0 });
  });

  it('rewinds to the requested line on Resend and ignores the trailing ok', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    const first = s.start();
    const afterM110 = drive(s, first, ['ok']);            // now G21 (N1) is in flight
    const g21 = `${marlinNumbered('G21', 1)}\n`;
    expect(afterM110[afterM110.length - 1]).toBe(g21);

    // Marlin rejects N1 and asks for N1 again, followed by its ok for the rejected line.
    const ev = s.receive(classifyLine('Resend: 1'));
    expect(ev).toEqual([{ type: 'resend', lineNumber: 1 }]);
    expect(s.pump()).toEqual([]);                          // waiting for the trailing ok
    expect(s.receive(classifyLine('ok'))).toEqual([{ type: 'resend-ok' }]);
    expect(s.pump()).toEqual([g21]);                       // the same line is resent
    expect(s.progress().resends).toBe(1);
    expect(s.acked).toBe(1);                               // rewinding does not un-ack earlier lines
  });

  it('a line-number error is a warning and does not halt the stream', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    s.start();
    const ev = s.receive(classifyLine('Error:Line Number is not Last Line Number+1, Last Line: 0'));
    expect(ev[0].type).toBe('warning');
    expect(s.state).toBe('running');
  });

  it('halts on an unrelated Marlin error', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    s.start();
    const ev = s.receive(classifyLine('Error:Heating failed'));
    expect(ev[0]).toMatchObject({ type: 'error' });
    expect(s.state).toBe('halted');
    expect(s.pump()).toEqual([]);
    expect(s.progress().errors).toBe(1);
    expect(s.reason).toMatch(/Heating failed/);
  });

  it('halts when Marlin asks for a line that is not in the stream', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    s.start();
    s.receive(classifyLine('ok'));
    s.receive(classifyLine('Resend: 99'));
    expect(s.state).toBe('halted');
    expect(s.reason).toMatch(/99/);
  });

  it('pauses without sending and resumes with the next line', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    s.start();
    s.receive(classifyLine('ok'));          // M110 acked
    expect(s.pump()).toEqual([`${marlinNumbered('G21', 1)}\n`]);
    s.pause();
    expect(s.state).toBe('paused');
    expect(s.receive(classifyLine('ok'))).toEqual([{ type: 'ack', index: 1 }]); // in-flight ack still counts
    expect(s.pump()).toEqual([]);
    const out = s.resume();
    expect(out).toEqual([`${marlinNumbered('G90', 2)}\n`]);
    expect(s.state).toBe('running');
  });

  it('stops and forgets the in-flight line', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    s.start();
    s.stop();
    expect(s.state).toBe('stopped');
    expect(s.inflight).toEqual([]);
    expect(s.receive(classifyLine('ok'))).toEqual([]);
    expect(s.pump()).toEqual([]);
  });

  it('treats an ok with nothing in flight as a stray and does not advance', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    s.start();
    s.receive(classifyLine('ok')); // acks M110; nothing pumped yet
    expect(s.receive(classifyLine('ok'))).toEqual([{ type: 'stray-ok' }]);
    expect(s.acked).toBe(1);
    expect(s.state).toBe('running');
  });

  it('a stream that has finished ignores late oks', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    expect(drive(s, s.start(), ['ok', 'ok', 'ok', 'ok'])).toHaveLength(4);
    expect(s.state).toBe('done');
    expect(s.receive(classifyLine('ok'))).toEqual([]);
  });

  it('an empty file finishes after the M110 preamble', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: [] });
    expect(s.start()).toEqual(['N0 M110 N0*125\n']);
    s.receive(classifyLine('ok'));
    expect(s.state).toBe('done');
    expect(s.total).toBe(0);
  });

  it('ignores a resend from a stream that is not running', () => {
    const s = new GcodeStreamer({ firmware: 'marlin', commands: cmds });
    expect(s.receive(classifyLine('Resend: 1'))).toEqual([]);
    expect(s.resends).toBe(0);
  });
});

describe('GcodeStreamer (GRBL character counting)', () => {
  // Each 30-character command is 31 bytes with its newline.
  const longCmd = (i) => `G1 X${String(i).padStart(2, '0')}.000 Y0.000 F1000 `.trimEnd().padEnd(30, ' ');

  it('fills the controller buffer up to 127 bytes and no further', () => {
    const cmds = [0, 1, 2, 3, 4, 5].map(longCmd);
    expect(cmds[0].length).toBe(30);
    const s = new GcodeStreamer({ firmware: 'grbl', commands: cmds });
    const out = s.start();
    expect(out).toHaveLength(4);            // 4 x 31 = 124; a 5th would be 155
    expect(s.inflightBytes).toBe(124);
    expect(out.every((t) => t.endsWith('\n'))).toBe(true);
  });

  it('frees space with each ok and sends the next line', () => {
    const cmds = [0, 1, 2, 3, 4, 5].map(longCmd);
    const s = new GcodeStreamer({ firmware: 'grbl', commands: cmds });
    s.start();
    const after = drive(s, [], ['ok']);
    expect(after).toEqual([`${cmds[4]}\n`]);  // 93 + 31 = 124 fits
    expect(s.inflightBytes).toBe(124);
    // Five lines remain unacknowledged (1..5); cmds[5] goes out as the buffer drains.
    drive(s, [], ['ok', 'ok', 'ok', 'ok', 'ok']);
    expect(s.state).toBe('done');
    expect(s.inflightBytes).toBe(0);
  });

  it('never has more than 127 bytes unacknowledged', () => {
    const cmds = Array.from({ length: 50 }, (_, i) => `G1 X${i} Y${i} F${100 + i}`);
    const s = new GcodeStreamer({ firmware: 'grbl', commands: cmds });
    let max = 0;
    const sendAll = (texts) => { max = Math.max(max, s.inflightBytes); return texts; };
    sendAll(s.start());
    let guard = 0;
    while (s.state === 'running' && guard++ < 500) {
      s.receive(classifyLine('ok'));
      sendAll(s.pump());
      max = Math.max(max, s.inflightBytes);
    }
    expect(max).toBeLessThanOrEqual(GRBL_CHAR_LIMIT);
    expect(s.state).toBe('done');
    expect(s.progress().done).toBe(50);
  });

  it('counts UTF-8 bytes for the buffer budget', () => {
    const cmd = `G4 P1 ${'é'.repeat(20)}`; // 6 + 40 bytes
    const s = new GcodeStreamer({ firmware: 'grbl', commands: [cmd] });
    s.start();
    expect(s.inflightBytes).toBe(utf8Length(cmd) + 1);
  });

  it('refuses a line that can never fit the buffer', () => {
    expect(() => new GcodeStreamer({ firmware: 'grbl', commands: ['G1 X'.padEnd(127, '0')] })).toThrow(/longer/);
  });

  it('halts on error:N, removes the failed line and sends nothing more', () => {
    const cmds = ['G1 X1', 'G1 X2', 'G1 X3'];
    const s = new GcodeStreamer({ firmware: 'grbl', commands: cmds });
    s.start();
    const events = s.receive(classifyLine('error:20'));
    expect(events[0]).toMatchObject({ type: 'error' });
    expect(s.reason).toMatch(/error:20/);
    expect(s.reason).toMatch(/G1 X1/);
    expect(s.state).toBe('halted');
    expect(s.pump()).toEqual([]);
    expect(s.progress().errors).toBe(1);
    // Lines already buffered on the controller still get their ok; no new lines are sent.
    s.receive(classifyLine('ok'));
    expect(s.inflight.length).toBe(1);
    s.receive(classifyLine('ok'));
    expect(s.inflight.length).toBe(0);
    expect(s.pump()).toEqual([]);
  });

  it('an ALARM clears the in-flight queue and halts', () => {
    const s = new GcodeStreamer({ firmware: 'grbl', commands: ['G1 X1', 'G1 X2'] });
    s.start();
    s.receive(classifyLine('ALARM:1'));
    expect(s.state).toBe('halted');
    expect(s.inflight).toEqual([]);
    expect(s.inflightBytes).toBe(0);
    expect(s.reason).toMatch(/ALARM:1/);
  });

  it('pauses and resumes with the buffer still counted', () => {
    const s = new GcodeStreamer({ firmware: 'grbl', commands: ['G1 X1', 'G1 X2', 'G1 X3'] });
    s.start(); // all three lines fit (18 bytes), so all are already on the controller
    s.pause();
    expect(s.receive(classifyLine('ok'))).toEqual([{ type: 'ack', index: 0 }]);
    expect(s.pump()).toEqual([]);
    expect(s.resume()).toEqual([]);      // nothing left to transmit
    expect(s.state).toBe('running');
    s.receive(classifyLine('ok'));
    s.receive(classifyLine('ok'));
    expect(s.state).toBe('done');
  });

  it('resume sends the lines that were held back by the buffer budget', () => {
    const cmds = [0, 1, 2, 3, 4, 5].map((i) => `G1 X${String(i).padStart(2, '0')}.000 Y0.000 F1000`.padEnd(30, ' '));
    const s = new GcodeStreamer({ firmware: 'grbl', commands: cmds });
    s.start();
    s.pause();
    s.receive(classifyLine('ok'));
    expect(s.resume()).toEqual([`${cmds[4]}\n`]);
  });

  it('ignores resend lines and Marlin errors', () => {
    const s = new GcodeStreamer({ firmware: 'grbl', commands: ['G1 X1'] });
    s.start();
    expect(s.receive(classifyLine('Resend: 0'))).toEqual([]);
    expect(s.receive(classifyLine('Error:Heating failed'))).toEqual([]);
    expect(s.state).toBe('running');
  });

  it('keeps a finished stream done and a stopped stream stopped', () => {
    const s = new GcodeStreamer({ firmware: 'grbl', commands: ['$H'] });
    s.start();
    s.receive(classifyLine('ok'));
    expect(s.state).toBe('done');
    s.stop();
    expect(s.state).toBe('done');
  });

  it('start() twice is an error', () => {
    const s = new GcodeStreamer({ firmware: 'grbl', commands: ['G1 X1'] });
    s.start();
    expect(() => s.start()).toThrow();
  });

  it('rejects an unknown firmware', () => {
    expect(() => new GcodeStreamer({ firmware: 'klipper', commands: [] })).toThrow(/firmware/);
  });
});
