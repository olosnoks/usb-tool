// Docker backend registry for the browser security tools.
//
// The app is static and runs in the browser. Some tools need capabilities a
// browser does not have (cross-origin fetches, real port scans, live TLS
// handshakes, arbitrary DNS). Those are provided by small local Docker services,
// one per capability, defined in /backend. This module is the single source of
// truth the UI uses to:
//   - list the services and which tools use them,
//   - generate a self-contained docker-compose.yml to download/copy, and
//   - resolve the base URL each tool should call (see backendClient.js).
//
// The real, maintainable service sources live in /backend/<svc>/server.cjs. We
// import them raw so the generated single-file compose can never drift from the
// code that was tested.

import corsProxySrc from '../../backend/cors-proxy/server.cjs?raw';
import nmapSrc from '../../backend/nmap/server.cjs?raw';
import tlsSrc from '../../backend/tls-inspector/server.cjs?raw';
import dnsSrc from '../../backend/dns/server.cjs?raw';
import hydraSrc from '../../backend/hydra/server.cjs?raw';

// Real on-disk files, for the "download all files" bundle.
import corsProxyDockerfile from '../../backend/cors-proxy/Dockerfile?raw';
import nmapDockerfile from '../../backend/nmap/Dockerfile?raw';
import tlsDockerfile from '../../backend/tls-inspector/Dockerfile?raw';
import dnsDockerfile from '../../backend/dns/Dockerfile?raw';
import hydraDockerfile from '../../backend/hydra/Dockerfile?raw';
import repoCompose from '../../backend/docker-compose.yml?raw';
import backendReadme from '../../backend/README.md?raw';

// Every service. `src` present => a Node service we can embed in a single-file
// compose; `image`-only services (zap) run a stock image with their own command.
// Ports are an uncommon, contiguous 471xx block chosen to avoid the common dev
// ports (3000/5000/8000/8080/9000) and Windows' reserved/excluded ranges.
export const SERVICES = [
  {
    id: 'cors-proxy', name: 'CORS Proxy', port: 47101, baseImage: 'node:20-alpine', src: corsProxySrc,
    description: 'Generic HTTP(S) forwarder that adds permissive CORS so the browser-fetch tools can read any target. Also reaches sibling services by name.',
    role: 'Sets the shared proxy URL used by netClient.',
  },
  {
    id: 'nmap', name: 'Nmap', port: 47102, baseImage: 'node:20-alpine', apk: ['nmap', 'nmap-scripts'], src: nmapSrc,
    description: 'Runs the real nmap binary for true service/version detection and non-HTTP ports.',
    role: 'POST /scan { target, ports, profile }.',
  },
  {
    id: 'tls-inspector', name: 'TLS Inspector', port: 47103, baseImage: 'node:20-alpine', src: tlsSrc,
    description: "Live TLS handshake to fetch the certificate a server actually serves now (vs. Certificate Transparency history).",
    role: 'GET /cert?host=&port=.',
  },
  {
    id: 'dns', name: 'DNS', port: 47104, baseImage: 'node:20-alpine', src: dnsSrc,
    description: 'Resolves any record type against the system resolver or a custom nameserver.',
    role: 'GET /resolve?name=&type=&server=.',
  },
  {
    id: 'zap', name: 'OWASP ZAP', port: 47105, image: 'ghcr.io/zaproxy/zaproxy:stable',
    command: 'zap.sh -daemon -host 0.0.0.0 -port 47105 -config api.disablekey=true -config api.addrs.addr.name=.* -config api.addrs.addr.regex=true',
    description: 'OWASP ZAP daemon with its REST API. The browser reaches it through the CORS proxy.',
    role: 'Reached via cors-proxy at http://zap:47105.',
    viaProxy: true,
  },
  {
    id: 'hydra', name: 'Hydra', port: 47106, baseImage: 'node:20-alpine', apk: ['hydra'], src: hydraSrc,
    offensive: true,
    description: 'THC-Hydra online credential testing. AUTHORIZED TESTING ONLY. Off by default; needs the offensive profile and an authorization flag.',
    role: 'POST /attack { target, service, ... }.',
  },
];

export const serviceById = (id) => SERVICES.find((s) => s.id === id) || null;

// The full /backend tree, so the tool can hand over the real Docker files (not
// just the single-file compose): the build-based compose, every Dockerfile and
// server, and the README. Paths are relative to the zip root.
export function backendFileBundle() {
  return [
    { path: 'docker-compose.yml', content: repoCompose },
    { path: 'README.md', content: backendReadme },
    { path: 'cors-proxy/Dockerfile', content: corsProxyDockerfile },
    { path: 'cors-proxy/server.cjs', content: corsProxySrc },
    { path: 'nmap/Dockerfile', content: nmapDockerfile },
    { path: 'nmap/server.cjs', content: nmapSrc },
    { path: 'tls-inspector/Dockerfile', content: tlsDockerfile },
    { path: 'tls-inspector/server.cjs', content: tlsSrc },
    { path: 'dns/Dockerfile', content: dnsDockerfile },
    { path: 'dns/server.cjs', content: dnsSrc },
    { path: 'hydra/Dockerfile', content: hydraDockerfile },
    { path: 'hydra/server.cjs', content: hydraSrc },
  ];
}

// Which backend service each tool uses. Tools not listed need no backend.
export const TOOL_BACKENDS = {
  // Browser-fetch tools share the generic proxy.
  'web-analyzer': 'cors-proxy', 'nikto-scanner': 'cors-proxy', 'url-inspector': 'cors-proxy',
  'http-workbench': 'cors-proxy', 'api-client': 'cors-proxy', 'burp-proxy': 'cors-proxy',
  'osint-clients': 'cors-proxy', 'crtsh-finder': 'cors-proxy', 'pwned-passwords': 'cors-proxy',
  'db-browser': 'cors-proxy',
  // Kismet Studio reaches a user-run Kismet REST server; the proxy gets an https
  // page past a non-CORS/plain-http Kismet. Kismet does the radio capture itself.
  'kismet-studio': 'cors-proxy',
  // Tools with a dedicated capability image.
  'nmap-scanner': 'nmap',
  'cert-inspect': 'tls-inspector',
  'dns-toolkit': 'dns', 'dns-enumerator': 'dns',
  'owasp-zap': 'zap',
  'hydra-bruteforce': 'hydra',
};

export const backendForTool = (toolId) => serviceById(TOOL_BACKENDS[toolId]);

// ---- single-file compose generation -----------------------------------------

// Indent each line of `text` by `n` spaces for a YAML block scalar.
function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => (l.length ? pad + l : '')).join('\n').replace(/\s+$/,'');
}

// Docker Compose interpolates $ in the file, so a literal $ must be written $$.
const escDollar = (t) => t.replace(/\$/g, '$$$$');

// Build a self-contained docker-compose.yml: stock images, each Node service's
// source embedded as an env var and run with `node -e`-style bootstrap. No extra
// files are needed — save this one file and run `docker compose up -d`.
export function buildComposeYaml({ includeOffensive = false, authorizeHydra = false } = {}) {
  const header = [
    "# Skon's USB Tool — self-contained local backends (single file).",
    '#',
    '# Save as docker-compose.yml and run:',
    '#   docker compose up -d                      # safe services',
    includeOffensive ? '#   docker compose --profile offensive up -d  # also Hydra (authorized use only)' : '#   docker compose --profile offensive up -d  # also Hydra (authorized use only)',
    '#   docker compose down                       # stop',
    '#',
    '# Only use these against systems you own or are explicitly authorized to assess.',
    '',
    'services:',
    '',
  ];

  const blocks = [];
  for (const s of SERVICES) {
    if (s.offensive && !includeOffensive) continue;
    if (s.src) {
      const apk = s.apk ? `apk add --no-cache ${s.apk.join(' ')} && ` : '';
      // "$$SRC" so Compose passes a literal $SRC through to the shell.
      const run = `${apk}printf '%s' "$$SRC" > /srv.cjs && exec node /srv.cjs`;
      const b = [];
      b.push(`  ${s.id}:`);
      b.push(`    # ${s.description}`);
      b.push(`    image: ${s.baseImage}`);
      if (s.offensive) b.push(`    profiles: ["offensive"]`);
      b.push(`    container_name: skons-${s.id}`);
      b.push(`    command: ["sh", "-lc", ${JSON.stringify(run)}]`);
      b.push(`    ports:`);
      b.push(`      - "${s.port}:${s.port}"`);
      b.push(`    environment:`);
      b.push(`      PORT: "${s.port}"`);
      if (s.id === 'hydra') b.push(`      I_HAVE_AUTHORIZATION: "${authorizeHydra ? 'yes' : 'no'}"`);
      b.push(`      SRC: |`);
      b.push(indent(escDollar(s.src), 8));
      b.push(`    restart: unless-stopped`);
      blocks.push(b.join('\n'));
    } else {
      // image-only service (ZAP)
      const b = [];
      b.push(`  ${s.id}:`);
      b.push(`    # ${s.description}`);
      b.push(`    image: ${s.image}`);
      if (s.command) b.push(`    command: ${JSON.stringify(s.command)}`);
      b.push(`    container_name: skons-${s.id}`);
      b.push(`    ports:`);
      b.push(`      - "${s.port}:${s.port}"`);
      b.push(`    restart: unless-stopped`);
      blocks.push(b.join('\n'));
    }
  }
  return header.join('\n') + blocks.join('\n\n') + '\n';
}
