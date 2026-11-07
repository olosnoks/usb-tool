import React, { useMemo, useState } from 'react';
import { ExternalLink, Search, Globe, Code2, Database, FlaskConical, Radar } from 'lucide-react';

/**
 * Web Security Toolbox — a curated launcher for well-known browser-based
 * security, OSINT, and analysis services. These are external, third-party
 * websites; this panel only links out to them (opening a new tab). Nothing is
 * proxied, scraped, or executed here. It is a convenient, organized bookmark
 * deck so the common web tools live next to the hardware workbenches.
 *
 * Use these services only against targets you own or are explicitly authorized
 * to test — the same rule the rest of the app follows.
 */

const CATEGORIES = [
  {
    id: 'recon',
    title: 'Reconnaissance, OSINT & Internet Intelligence',
    icon: Radar,
    accent: 'text-cyan-400',
    items: [
      { name: 'Shodan', url: 'https://www.shodan.io/', desc: 'Search engine for Internet-connected devices, banners, open ports and certificates.' },
      { name: 'Censys Search', url: 'https://search.censys.io/', desc: 'Index of hosts, certificates and services across the IPv4/IPv6 Internet.' },
      { name: 'urlscan.io', url: 'https://urlscan.io/', desc: 'Sandbox that loads a URL and records its requests, DOM, scripts and TLS chain.' },
      { name: 'crt.sh', url: 'https://crt.sh/', desc: 'Certificate Transparency log search — maps subdomains from public TLS issuances.' },
      { name: 'SecurityTrails', url: 'https://securitytrails.com/', desc: 'Historical DNS, passive WHOIS and subdomain topology.' },
      { name: 'DNSDumpster', url: 'https://dnsdumpster.com/', desc: 'DNS recon and subdomain mapping with a visual graph.' },
      { name: 'HackerTarget', url: 'https://hackertarget.com/', desc: 'Hosted recon checks: DNS lookups, host discovery, banner grabbing.' },
      { name: 'MXToolbox', url: 'https://mxtoolbox.com/', desc: 'DNS/mail diagnostics: MX, SPF, DKIM, DMARC, blacklist checks.' },
    ],
  },
  {
    id: 'encode',
    title: 'Data Encoding, Parsing & Analysis',
    icon: Code2,
    accent: 'text-purple-400',
    items: [
      { name: 'CyberChef', url: 'https://gchq.github.io/CyberChef/', desc: 'Client-side encode/decode/crypto/parse pipeline. (Also built in — see the CyberChef Workbench tool.)' },
      { name: 'regex101', url: 'https://regex101.com/', desc: 'Interactive regex builder and debugger with an engine step breakdown.' },
      { name: 'jwt.io', url: 'https://jwt.io/', desc: 'Decode and inspect JSON Web Tokens: header, claims and algorithm.' },
    ],
  },
  {
    id: 'audit',
    title: 'In-Browser Target Execution & Auditing',
    icon: Globe,
    accent: 'text-emerald-400',
    items: [
      { name: 'OWASP Pen-Test Kit (PTK)', url: 'https://github.com/DenizKavi/PTK', desc: 'Browser extension turning DevTools into a request-crafting and audit suite.' },
      { name: 'Adafruit WebSerial ESPTool', url: 'https://adafruit.github.io/Adafruit_WebSerial_ESPTool/', desc: 'Flash/erase ESP chips over Web Serial — no host drivers. (Compare the built-in Flasher.)' },
      { name: 'ESP Web Tools', url: 'https://esphome.github.io/esp-web-tools/', desc: 'Install firmware onto ESP devices directly from the browser.' },
      { name: 'WebUSB / WebSerial demos', url: 'https://web.dev/articles/serial', desc: 'Reference docs for the browser hardware APIs these tools build on.' },
    ],
  },
  {
    id: 'labs',
    title: 'Browser-Delivered Cloud Labs & Platforms',
    icon: FlaskConical,
    accent: 'text-amber-400',
    items: [
      { name: 'PortSwigger Web Security Academy', url: 'https://portswigger.net/web-security', desc: 'Free hands-on labs for web vulnerability classes, in the browser.' },
      { name: 'TryHackMe', url: 'https://tryhackme.com/', desc: 'Guided rooms with in-browser attack boxes over a web gateway.' },
      { name: 'OffSec Proving Grounds', url: 'https://www.offsec.com/labs/', desc: 'Practice ranges with browser-accessible target machines.' },
      { name: 'Hack The Box', url: 'https://www.hackthebox.com/', desc: 'Lab machines and challenges; Pwnbox gives an in-browser attack VM.' },
      { name: 'BeEF (project)', url: 'https://github.com/beefproject/beef', desc: 'Browser Exploitation Framework — reference the official project for authorized testing.' },
    ],
  },
];

const ICON_FOR = { recon: Radar, encode: Code2, audit: Globe, labs: FlaskConical };

export default function WebToolboxWorkbench() {
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return CATEGORIES;
    return CATEGORIES
      .map((cat) => ({ ...cat, items: cat.items.filter((it) => (it.name + ' ' + it.desc).toLowerCase().includes(term)) }))
      .filter((cat) => cat.items.length > 0);
  }, [q]);

  return (
    <div className="w-full min-w-0 max-w-full text-gray-200">
      <div className="mb-3 p-2 border border-slate-800 rounded bg-slate-900/40 text-[11px] text-slate-400">
        A launcher for well-known browser-based security, OSINT and analysis sites. Each opens the third-party service
        in a new tab — nothing is run or proxied here. Use them only against systems you own or are authorized to test.
      </div>
      <div className="relative mb-3">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter tools…"
          className="w-full bg-slate-900 border border-slate-800 rounded pl-7 pr-2 py-1.5 text-xs text-gray-200"
        />
      </div>
      <div className="space-y-4">
        {filtered.map((cat) => {
          const Icon = cat.icon || ICON_FOR[cat.id] || Globe;
          return (
            <section key={cat.id}>
              <h3 className={`text-xs font-semibold uppercase tracking-wide mb-2 flex items-center gap-1.5 ${cat.accent}`}>
                <Icon size={14} /> {cat.title}
              </h3>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
                {cat.items.map((it) => (
                  <a
                    key={it.name}
                    href={it.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group block p-2.5 border border-slate-800 rounded bg-slate-900/50 hover:border-cyan-800 hover:bg-slate-900 transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-100 group-hover:text-cyan-300 truncate">{it.name}</span>
                      <ExternalLink size={12} className="text-slate-600 group-hover:text-cyan-400 shrink-0" />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-snug">{it.desc}</p>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
        {filtered.length === 0 && <div className="text-xs text-slate-600 text-center py-8">No tools match “{q}”.</div>}
      </div>
    </div>
  );
}
