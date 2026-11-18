import { describe, it, expect } from 'vitest';
import { buildNmapCommand, explainNmapCommand, parseNmapXml, parseGrepable, parseNmapOutput, scanToCsv, diffScans, summarizeScan } from '../src/utils/nmapTools.js';

const XML = `<?xml version="1.0"?><nmaprun scanner="nmap" args="nmap -sV 10.0.0.1">
<host><status state="up"/><address addr="10.0.0.1" addrtype="ipv4"/><hostnames><hostname name="router.lan" type="PTR"/></hostnames>
<ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh" product="OpenSSH" version="9.2"/></port>
<port protocol="tcp" portid="80"><state state="closed"/><service name="http"/></port></ports></host>
<host><status state="down"/><address addr="10.0.0.2" addrtype="ipv4"/></host></nmaprun>`;
const XML2 = XML.replace('9.2', '9.6').replace('<state state="closed"/>', '<state state="open"/>');

describe('nmapTools', () => {
  it('builds commands', () => {
    expect(buildNmapCommand({ scanType: '-sT', serviceVersion: true, timing: 4, ports: '22, 80', target: '10.0.0.1' })).toBe('nmap -sT -sV -T4 -p 22,80 10.0.0.1');
    expect(buildNmapCommand({ topPorts: 100 })).toBe('nmap --top-ports 100 <target>');
  });
  it('explains commands', () => {
    const e = explainNmapCommand('nmap -sS -p 1-100 -oX out.xml host');
    expect(e.tokens.map((t) => t.text)).toEqual(['nmap', '-sS', '-p 1-100', '-oX out.xml', 'host']);
    expect(e.warnings.join()).toMatch(/root/);
    expect(explainNmapCommand('nmap -sT').warnings.join()).toMatch(/No target/);
  });
  it('parses XML', () => {
    const s = parseNmapXml(XML);
    expect(s.hosts).toHaveLength(2);
    expect(s.hosts[0].hostname).toBe('router.lan');
    expect(s.hosts[0].ports[0]).toMatchObject({ port: 22, state: 'open', product: 'OpenSSH' });
    expect(summarizeScan(s)).toMatchObject({ hosts: 2, up: 1, open: 1, closed: 1 });
    expect(() => parseNmapXml('hello')).toThrow();
  });
  it('parses grepable', () => {
    const g = 'Host: 10.0.0.1 (r)\tStatus: Up\nHost: 10.0.0.1 (r)\tPorts: 22/open/tcp//ssh//OpenSSH 9.2/, 80/closed/tcp//http///\tIgnored State: x\n';
    const s = parseNmapOutput(g);
    expect(s.hosts).toHaveLength(1);
    expect(s.hosts[0].ports.map((p) => p.port)).toEqual([22, 80]);
    expect(() => parseGrepable('nothing')).toThrow();
  });
  it('exports CSV with formula guard', () => {
    const csv = scanToCsv({ hosts: [{ addr: '1.1.1.1', hostname: '=x', ports: [{ port: 1, proto: 'tcp', state: 'open', service: 'a,b' }] }] });
    expect(csv).toContain("'=x");
    expect(csv).toContain('"a,b"');
  });
  it('diffs scans', () => {
    const d = diffScans(parseNmapXml(XML), parseNmapXml(XML2));
    expect(d.opened.map((r) => r.port)).toEqual([80]);
    expect(d.changed[0]).toMatchObject({ port: 22, before: 'ssh OpenSSH 9.2', after: 'ssh OpenSSH 9.6' });
    expect(diffScans(parseNmapXml(XML2), parseNmapXml(XML)).closed.map((r) => r.port)).toEqual([80]);
  });
});
