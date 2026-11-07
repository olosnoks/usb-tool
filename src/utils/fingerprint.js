// Technology fingerprinting (OWASP PTK-style) — pure, dependency-free.
// Given a page's response headers, HTML, Set-Cookie names and script URLs, it
// matches a compact signature set and returns detected technologies by
// category with the evidence that triggered each. Heuristic, best-effort.

// Each rule: { name, category, test(ctx) -> evidence string | false }.
// ctx = { headers (lowercased keys→value), html, cookieNames[], scripts[] }.
const H = (ctx, name) => (ctx.headers?.[name] || '');
const htmlHas = (ctx, re) => (re.test(ctx.html || '') ? true : false);
const scriptHas = (ctx, re) => (ctx.scripts || []).some((s) => re.test(s));
const cookieHas = (ctx, re) => (ctx.cookieNames || []).some((c) => re.test(c));

const RULES = [
  // Web servers / infrastructure
  { name: 'Nginx', category: 'Server', test: (c) => /nginx/i.test(H(c, 'server')) && `Server: ${H(c, 'server')}` },
  { name: 'Apache', category: 'Server', test: (c) => /apache/i.test(H(c, 'server')) && `Server: ${H(c, 'server')}` },
  { name: 'Microsoft IIS', category: 'Server', test: (c) => /iis|microsoft/i.test(H(c, 'server')) && `Server: ${H(c, 'server')}` },
  { name: 'LiteSpeed', category: 'Server', test: (c) => /litespeed/i.test(H(c, 'server')) && `Server: ${H(c, 'server')}` },
  { name: 'Caddy', category: 'Server', test: (c) => /caddy/i.test(H(c, 'server')) && `Server: ${H(c, 'server')}` },
  // Languages / app frameworks
  { name: 'PHP', category: 'Language', test: (c) => (/php/i.test(H(c, 'x-powered-by')) && `X-Powered-By: ${H(c, 'x-powered-by')}`) || (cookieHas(c, /^PHPSESSID$/i) && 'cookie PHPSESSID') },
  { name: 'ASP.NET', category: 'Language', test: (c) => (/asp\.net/i.test(H(c, 'x-powered-by')) && `X-Powered-By: ${H(c, 'x-powered-by')}`) || (H(c, 'x-aspnet-version') && `X-AspNet-Version: ${H(c, 'x-aspnet-version')}`) || (cookieHas(c, /^ASP\.NET_SessionId$/i) && 'cookie ASP.NET_SessionId') },
  { name: 'Java', category: 'Language', test: (c) => cookieHas(c, /^JSESSIONID$/i) && 'cookie JSESSIONID' },
  { name: 'Express', category: 'Framework', test: (c) => /express/i.test(H(c, 'x-powered-by')) && `X-Powered-By: ${H(c, 'x-powered-by')}` },
  { name: 'Ruby on Rails', category: 'Framework', test: (c) => cookieHas(c, /^_.*_session$/i) && /rails|ruby/i.test(H(c, 'x-powered-by') + H(c, 'server')) && 'session cookie + header' },
  { name: 'Django', category: 'Framework', test: (c) => cookieHas(c, /^csrftoken$/i) && cookieHas(c, /^sessionid$/i) && 'cookies csrftoken + sessionid' },
  { name: 'Laravel', category: 'Framework', test: (c) => (cookieHas(c, /^laravel_session$/i) && 'cookie laravel_session') || (cookieHas(c, /^XSRF-TOKEN$/i) && 'cookie XSRF-TOKEN') },
  // CMS / platforms
  { name: 'WordPress', category: 'CMS', test: (c) => (htmlHas(c, /wp-(content|includes)\//i) && 'wp-content/ path') || (cookieHas(c, /^wordpress/i) && 'wordpress cookie') },
  { name: 'Drupal', category: 'CMS', test: (c) => (htmlHas(c, /Drupal\.settings|sites\/(all|default)\/|drupal\.js/i) && 'Drupal markers') || (/drupal/i.test(H(c, 'x-generator')) && `X-Generator: ${H(c, 'x-generator')}`) },
  { name: 'Joomla', category: 'CMS', test: (c) => htmlHas(c, /\/media\/jui\/|Joomla!|option=com_/i) && 'Joomla markers' },
  { name: 'Shopify', category: 'CMS', test: (c) => (/shopify/i.test(H(c, 'x-shopid') + H(c, 'server') + H(c, 'x-powered-by')) && 'Shopify header') || scriptHas(c, /cdn\.shopify\.com/i) && 'cdn.shopify.com' },
  { name: 'Ghost', category: 'CMS', test: (c) => htmlHas(c, /content=["']Ghost|ghost-/i) && 'Ghost markers' },
  // JS frameworks
  { name: 'Next.js', category: 'JS framework', test: (c) => (htmlHas(c, /__NEXT_DATA__|\/_next\//i) && '__NEXT_DATA__ / _next/') || scriptHas(c, /\/_next\//i) && '_next/ scripts' },
  { name: 'Nuxt.js', category: 'JS framework', test: (c) => htmlHas(c, /__NUXT__|\/_nuxt\//i) && '__NUXT__ / _nuxt/' },
  { name: 'React', category: 'JS framework', test: (c) => (htmlHas(c, /data-reactroot|data-reactid/i) && 'data-react* attribute') || scriptHas(c, /react(-dom)?(\.production)?\.min\.js|react@/i) && 'react script' },
  { name: 'Angular', category: 'JS framework', test: (c) => htmlHas(c, /ng-version=|ng-app|_nghost|_ngcontent/i) && 'ng-* attribute' },
  { name: 'Vue.js', category: 'JS framework', test: (c) => (htmlHas(c, /data-v-app|data-v-[0-9a-f]{8}/i) && 'data-v-* attribute') || scriptHas(c, /vue(@|\.min\.js|\/dist)/i) && 'vue script' },
  { name: 'Svelte', category: 'JS framework', test: (c) => htmlHas(c, /svelte-[0-9a-z]+/i) && 'svelte class' },
  { name: 'Gatsby', category: 'JS framework', test: (c) => htmlHas(c, /id=["']___gatsby|\/page-data\//i) && '___gatsby' },
  // Libraries
  { name: 'jQuery', category: 'Library', test: (c) => scriptHas(c, /jquery(-|\.|@)/i) && 'jquery script' },
  { name: 'Bootstrap', category: 'Library', test: (c) => scriptHas(c, /bootstrap(\.|\.min|@)/i) || htmlHas(c, /class=["'][^"']*\b(container|row|col-(xs|sm|md|lg))\b/i) ? 'bootstrap markers' : false },
  // Analytics / tags
  { name: 'Google Analytics', category: 'Analytics', test: (c) => scriptHas(c, /google-analytics\.com|googletagmanager\.com|gtag\/js/i) && 'GA/GTM script' },
  // CDN / WAF / edge
  { name: 'Cloudflare', category: 'CDN / WAF', test: (c) => (H(c, 'cf-ray') && `cf-ray: ${H(c, 'cf-ray')}`) || (/cloudflare/i.test(H(c, 'server')) && 'Server: cloudflare') },
  { name: 'Sucuri', category: 'CDN / WAF', test: (c) => (H(c, 'x-sucuri-id') && 'x-sucuri-id header') || /sucuri/i.test(H(c, 'server')) && 'Server: sucuri' },
  { name: 'Imperva Incapsula', category: 'CDN / WAF', test: (c) => (H(c, 'x-iinfo') && 'x-iinfo header') || cookieHas(c, /^incap_ses|^visid_incap/i) && 'incapsula cookie' },
  { name: 'Akamai', category: 'CDN / WAF', test: (c) => (H(c, 'x-akamai-transformed') && 'x-akamai-transformed') || /akamai/i.test(H(c, 'server')) && 'Server: akamai' },
  { name: 'Fastly', category: 'CDN / WAF', test: (c) => /fastly/i.test(H(c, 'x-served-by') + H(c, 'via') + H(c, 'server')) && 'fastly header' },
  { name: 'Varnish', category: 'CDN / WAF', test: (c) => (H(c, 'x-varnish') && 'x-varnish header') || /varnish/i.test(H(c, 'via')) && 'Via: varnish' },
  { name: 'AWS', category: 'Hosting', test: (c) => /awselb|amazons3|aws/i.test(H(c, 'server') + H(c, 'x-amz-cf-id') + (c.headers?.['x-amz-request-id'] ? 'aws' : '')) && 'AWS header' },
  { name: 'Vercel', category: 'Hosting', test: (c) => /vercel/i.test(H(c, 'server') + H(c, 'x-vercel-id')) && 'Vercel header' },
  { name: 'Netlify', category: 'Hosting', test: (c) => /netlify/i.test(H(c, 'server') + H(c, 'x-nf-request-id')) && 'Netlify header' },
  { name: 'GitHub Pages', category: 'Hosting', test: (c) => /github\.com|github pages/i.test(H(c, 'server')) && `Server: ${H(c, 'server')}` },
];

/** Parse <meta name="generator" content="..."> into a tech entry if present. */
function metaGenerator(html) {
  const m = (html || '').match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1].trim() : null;
}

/**
 * Detect technologies. Returns an array of { name, category, evidence },
 * de-duplicated by name and sorted by category then name.
 */
export function detectTech(ctx) {
  const out = new Map();
  for (const rule of RULES) {
    let ev;
    try { ev = rule.test(ctx); } catch { ev = false; }
    if (ev) out.set(rule.name, { name: rule.name, category: rule.category, evidence: typeof ev === 'string' ? ev : 'matched' });
  }
  const gen = metaGenerator(ctx.html);
  if (gen && !out.has(gen)) out.set(gen, { name: gen, category: 'Generator', evidence: 'meta generator' });
  return [...out.values()].sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
}
