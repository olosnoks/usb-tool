import { describe, it, expect } from 'vitest';
import { parseTelemetryLine, parseNumberToken } from '../src/utils/rxLines.js';
import { samplePairs, applySamples, buildTelemetryCsv, resetChannelStats } from '../src/utils/telemetryModel.js';

describe('parseNumberToken', () => {
  it('handles decimal, scientific and hex', () => {
    expect(parseNumberToken('1e-3')).toBeCloseTo(0.001);
    expect(parseNumberToken('-2.5E+2')).toBe(-250);
    expect(parseNumberToken('0xFF')).toBe(255);
    expect(parseNumberToken('-0x10')).toBe(-16);
    expect(parseNumberToken('abc')).toBeNaN();
  });
});

describe('parseTelemetryLine', () => {
  it('parses a JSON object (flattening nested)', () => {
    const p = parseTelemetryLine('{"temp": 24.5, "rpm": 3200, "gps": {"lat": 1.5}, "s": "x"}');
    expect(p.kind).toBe('json');
    expect(p.labels).toEqual(['temp', 'rpm', 'gps.lat']);
    expect(p.values).toEqual([24.5, 3200, 1.5]);
  });

  it('parses key=value with scientific notation and hex', () => {
    const p = parseTelemetryLine('i=1e-3 v:3.3 reg=0x10');
    expect(p.labels).toEqual(['i', 'v', 'reg']);
    expect(p.values[0]).toBeCloseTo(0.001);
    expect(p.values.slice(1)).toEqual([3.3, 16]);
  });

  it('does not treat prose or clock times as data', () => {
    expect(parseTelemetryLine('I (123) wifi: connected to the access point')).toBeNull();
    expect(parseTelemetryLine('12:30:45 something happened here today')).toBeNull();
  });

  it('parses CSV and whitespace rows', () => {
    expect(parseTelemetryLine('12.4, 45.1, -8.0').values).toEqual([12.4, 45.1, -8]);
    expect(parseTelemetryLine('100 200\t150').values).toEqual([100, 200, 150]);
    expect(parseTelemetryLine('1;2;3').labels).toBeNull();
    expect(parseTelemetryLine('0x1F,2').values).toEqual([31, 2]);
  });

  it('parses $TAG,CSV and keeps the tag', () => {
    const p = parseTelemetryLine('$DATA,12.5,-4.2,24.5');
    expect(p.tag).toBe('DATA');
    expect(p.values).toEqual([12.5, -4.2, 24.5]);
  });

  it('supports a custom delimiter with non-numeric columns', () => {
    const p = parseTelemetryLine('t|1.5|abc|3', { delimiter: '|' });
    expect(p.values[1]).toBe(1.5);
    expect(p.values[2]).toBeNaN();
    expect(p.values[3]).toBe(3);
  });

  it('ignores boot noise and empty input', () => {
    expect(parseTelemetryLine('rst:0x1 (POWERON_RESET),boot:0x13')).toBeNull();
    expect(parseTelemetryLine('')).toBeNull();
    expect(parseTelemetryLine('hello world')).toBeNull();
  });
});

describe('telemetry model', () => {
  it('names unnamed columns ch_1.. and starts empty', () => {
    expect(applySamples({}, [])).toEqual({});
    expect(samplePairs(parseTelemetryLine('1,2'))).toEqual([['ch_1', 1], ['ch_2', 2]]);
  });

  it('keeps history capped and tracks min/max', () => {
    let ch = {};
    for (let i = 0; i < 30; i++) ch = applySamples(ch, [[['a', i]]], 20);
    expect(ch.a.history.length).toBe(20);
    expect(ch.a.history[19]).toBe(29);
    expect(ch.a.min).toBe(0);
    expect(ch.a.max).toBe(29);
    expect(resetChannelStats(ch).a.history).toEqual([29]);
  });

  it('builds a CSV with names and units', () => {
    const csv = buildTelemetryCsv([{ t: 0, pairs: [['a', 1]] }, { t: 1000, pairs: [['b', 2]] }], { a: { label: 'Temp', unit: 'C' } });
    expect(csv.split('\n')[0]).toBe('timestamp,Temp (C),b');
    expect(csv.split('\n')[2]).toBe('1970-01-01T00:00:01.000Z,,2');
  });
});

describe('telemetry ingestion from raw chunks', () => {
  it('turns two identical consecutive chunks into two samples', async () => {
    const { createLineAssembler } = await import('../src/utils/rxLines.js');
    const a = createLineAssembler();
    const enc = (s) => new TextEncoder().encode(s);
    let ch = {};
    for (const chunk of ['temp:24.5\n', 'temp:24.5\n', 'tem', 'p:2', '5.5\n']) {
      const batch = a.push(enc(chunk)).map((l) => samplePairs(parseTelemetryLine(l.text))).filter((p) => p.length);
      ch = applySamples(ch, batch, 20);
    }
    expect(ch.temp.history).toEqual([24.5, 24.5, 25.5]);
  });
});
