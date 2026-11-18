import { describe, it, expect } from 'vitest';
import { swipeDuration, screenrecordCommand, parseIpAddresses, adbConnectCommand, compileLogcatQuery, swipeCommand } from '../src/utils/adbTools.js';

describe('adb polish helpers', () => {
  it('clamps swipe duration', () => {
    expect(swipeDuration(5)).toBe(50);
    expect(swipeDuration(99999)).toBe(2000);
    expect(swipeDuration('x')).toBe(300);
    expect(swipeCommand(1.4, 2, 3, 4, swipeDuration(400))).toBe('input swipe 1 2 3 4 400');
  });
  it('builds a bounded screenrecord command', () => {
    expect(screenrecordCommand('/sdcard/a.mp4', { seconds: 10, bitRateMbps: 4 })).toBe("screenrecord --time-limit 10 --bit-rate 4000000 '/sdcard/a.mp4'");
    expect(screenrecordCommand('/sdcard/a.mp4', { seconds: 999, size: '720x1280' })).toContain('--time-limit 180');
    expect(screenrecordCommand('/sdcard/a.mp4', { size: '720x1280' })).toContain('--size 720x1280');
    expect(screenrecordCommand('/sdcard/a.mp4', { size: 'rm -rf' })).not.toContain('--size');
  });
  it('parses ip addresses, skipping loopback', () => {
    const oneLine = '1: lo    inet 127.0.0.1/8 scope host lo\n24: wlan0    inet 192.168.1.42/24 brd 192.168.1.255 scope global wlan0';
    expect(parseIpAddresses(oneLine)).toEqual([{ iface: 'wlan0', ip: '192.168.1.42' }]);
    const multi = '2: wlan0: <UP>\n    link/ether aa\n    inet 10.0.0.5/24 brd 10.0.0.255 scope global wlan0\n1: lo: <LOOPBACK>\n    inet 127.0.0.1/8 scope host lo';
    expect(parseIpAddresses(multi)).toEqual([{ iface: 'wlan0', ip: '10.0.0.5' }]);
    expect(adbConnectCommand('10.0.0.5', 5555)).toBe('adb connect 10.0.0.5:5555');
  });
  const e = (tag, message, pid = 1) => ({ tag, message, pid });
  it('filters logcat with terms, negation, tag, pid and regex', () => {
    const rows = [e('ActivityManager', 'Start proc com.foo', 100), e('chatty', 'uid=1 expire', 200), e('Foo', 'error code 42', 300)];
    const run = (q) => rows.filter(compileLogcatQuery(q).test).map((r) => r.tag);
    expect(run('')).toHaveLength(3);
    expect(run('tag:activity')).toEqual(['ActivityManager']);
    expect(run('-chatty')).toEqual(['ActivityManager', 'Foo']);
    expect(run('pid:300')).toEqual(['Foo']);
    expect(run('200')).toEqual(['chatty']);
    expect(run(String.raw`/code.\d+/`)).toEqual(['Foo']);
    expect(run('error -/42/')).toEqual([]);
    expect(compileLogcatQuery('/(/').error).toMatch(/Bad regular expression/);
  });
});
