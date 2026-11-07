// Shared wordlist loader backed by SecLists via the jsDelivr CDN.
// jsDelivr serves GitHub content with `Access-Control-Allow-Origin: *`, so these
// fetch directly from the browser (no proxy needed); the proxy is still honored.

import { proxiedFetch } from './netClient';

const CDN = 'https://cdn.jsdelivr.net/gh/danielmiessler/SecLists@master/';

// Curated, reasonably-sized SecLists entries by category.
// `lines` is an approximate count shown to the user before loading.
export const WORDLISTS = {
  paths: [
    { name: 'Common web paths (dirb)', path: 'Discovery/Web-Content/common.txt', lines: 4700 },
    { name: 'Quickhits (interesting files)', path: 'Discovery/Web-Content/quickhits.txt', lines: 2400 },
    { name: 'API endpoints', path: 'Discovery/Web-Content/api/api-endpoints.txt', lines: 2800 },
    { name: 'RAFT small directories', path: 'Discovery/Web-Content/raft-small-directories.txt', lines: 20000 },
    { name: 'RAFT small files', path: 'Discovery/Web-Content/raft-small-files.txt', lines: 11000 },
    { name: 'Big list', path: 'Discovery/Web-Content/big.txt', lines: 20500 },
  ],
  passwords: [
    { name: 'Top passwords shortlist', path: 'Passwords/Common-Credentials/top-passwords-shortlist.txt', lines: 20 },
    { name: '500 worst passwords', path: 'Passwords/Common-Credentials/500-worst-passwords.txt', lines: 500 },
    { name: '10k most common', path: 'Passwords/Common-Credentials/10k-most-common.txt', lines: 10000 },
    { name: '100k NCSC most used', path: 'Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt', lines: 100000 },
    { name: 'WiFi WPA probable top 4800', path: 'Passwords/WiFi-WPA/probable-v2-wpa-top4800.txt', lines: 4800 },
    { name: 'Default credentials (passwords)', path: 'Passwords/Default-Credentials/default-passwords.txt', lines: 440 },
  ],
  usernames: [
    { name: 'Top usernames shortlist', path: 'Usernames/top-usernames-shortlist.txt', lines: 17 },
    { name: 'Common names', path: 'Usernames/Names/names.txt', lines: 10000 },
    { name: 'Default usernames', path: 'Usernames/cirt-default-usernames.txt', lines: 810 },
  ],
  subdomains: [
    { name: 'Subdomains top 5,000', path: 'Discovery/DNS/subdomains-top1million-5000.txt', lines: 5000 },
    { name: 'Subdomains top 20,000', path: 'Discovery/DNS/subdomains-top1million-20000.txt', lines: 20000 },
    { name: 'Fierce hostlist', path: 'Discovery/DNS/fierce-hostlist.txt', lines: 2000 },
  ],
  fuzzing: [
    { name: 'Command injection (commix)', path: 'Fuzzing/command-injection-commix.txt', lines: 120 },
    { name: 'LFI (Jhaddix)', path: 'Fuzzing/LFI/LFI-Jhaddix.txt', lines: 950 },
  ],
};

export const CATEGORY_LABELS = {
  paths: 'Web paths', passwords: 'Passwords', usernames: 'Usernames',
  subdomains: 'Subdomains', fuzzing: 'Fuzzing payloads',
};

const cache = new Map();

export function wordlistUrl(entry) {
  return CDN + entry.path;
}

/**
 * Fetch a wordlist by URL. Returns { lines, total, truncated }.
 * Comment (#) and blank lines are dropped. `max` caps how many lines are kept.
 */
export async function fetchWordlist(url, { max = 50000 } = {}) {
  if (cache.has(url)) return cache.get(url);
  const resp = await proxiedFetch(url, { cache: 'force-cache' });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching wordlist`);
  const text = await resp.text();
  const all = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.length > 0 && !l.startsWith('#'));
  const lines = all.slice(0, max);
  const result = { lines, total: all.length, truncated: all.length > lines.length };
  cache.set(url, result);
  return result;
}
