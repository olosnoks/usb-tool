import { describe, it, expect } from 'vitest';
import { diffBytes, trimLog, filterLog, seenReportIds, logToCsv, logToText, deviceInfoJson } from '../src/utils/hidLog';

const e = (t, reportId, hex, delta = null) => ({ t, reportId, hex, delta });

describe('hidLog', () => {
  it('diffs bytes', () => {
    expect(diffBytes([1, 2, 3], [1, 9, 3])).toEqual([1]);
    expect(diffBytes(null, [1, 2])).toEqual([0, 1]);
    expect(diffBytes([1], [1, 5])).toEqual([1]);
    expect(diffBytes([1, 2], [1, 2])).toEqual([]);
  });
  it('trims to newest', () => {
    expect(trimLog([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(trimLog([1], 2)).toEqual([1]);
  });
  it('filters and lists ids', () => {
    const l = [e(0, 1, '01 aa'), e(1, 2, '02 bb'), e(2, 1, '01 cc')];
    expect(filterLog(l, { reportId: '1' })).toHaveLength(2);
    expect(filterLog(l, { reportId: 'all', hex: 'BB' })).toHaveLength(1);
    expect(filterLog(l, { hex: '01 c' })).toHaveLength(1);
    expect(seenReportIds(l)).toEqual([1, 2]);
  });
  it('exports csv and text', () => {
    const l = [e(0, 1, '01 aa'), e(1.5, 1, '01 bb', 1.5)];
    const csv = logToCsv(l).trim().split('\n');
    expect(csv[0]).toBe('index,time_ms,delta_ms,report_id,length,hex');
    expect(csv[1]).toBe('0,0.000,,1,2,"01 aa"');
    expect(csv[2]).toBe('1,1.500,1.500,1,2,"01 bb"');
    expect(logToText(l)).toContain('id=1  01 bb');
  });
  it('serializes device info', () => {
    const j = JSON.parse(deviceInfoJson({ vendorId: 0x46d, productId: 0xc077, productName: 'M' }, [{
      usagePage: 1, usage: 2, name: 'Mouse',
      inputReports: [{ reportId: 0, byteLength: 1, fields: [{ isConstant: true, usages: [], bitSize: 8, count: 1, logicalMinimum: 0, logicalMaximum: 0 }] }],
      outputReports: [], featureReports: []
    }]));
    expect(j.vendorId).toBe('046d');
    expect(j.collections[0].reports[0]).toMatchObject({ kind: 'input', bytes: 1 });
    expect(j.collections[0].reports[0].fields[0].name).toBe('padding');
  });
});
