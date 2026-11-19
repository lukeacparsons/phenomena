// Adapted from surf-cam-wall. Bunny addresses are either masked or completely removed.
// A masked-address overlap is evidence, never proof of an exact crawler identity.
export const PULL_ZONE = '7049405';
export const ORIGIN_HOST = 'vobarna.com';

// Crawlers by the token in their user agent: [name, purpose]. Search and answer engines first, then the
// training crawlers, which robots.txt also admits (Luke's call: the guide is written to be read).
export const CRAWLERS = [
  ['Googlebot', 'Google search'], ['GoogleOther', 'Google research crawler'],
  ['Google-Agent', 'Google-hosted agents such as Gemini, a user\'s request'], ['Google-NotebookLM', 'NotebookLM, a user\'s source'],
  ['Google-CloudVertexBot', 'Vertex AI agents'], ['Google-InspectionTool', 'Search Console URL inspection'],
  ['Mediapartners-Google', 'AdSense'], ['AdsBot-Google', 'Google Ads landing-page checks'],
  ['bingbot', 'Bing search and Copilot'], ['Applebot', 'Apple search and Siri'],
  ['DuckAssistBot', 'DuckDuckGo answers'], ['YandexBot', 'Yandex search'],
  ['PerplexityBot', 'Perplexity search index'], ['Perplexity-User', 'Perplexity, a user\'s question'],
  ['OAI-SearchBot', 'ChatGPT search index'], ['ChatGPT-User', 'ChatGPT, a user\'s question'], ['GPTBot', 'OpenAI training'],
  ['Claude-SearchBot', 'Claude search index'], ['Claude-User', 'Claude, a user\'s question'], ['ClaudeBot', 'Anthropic training'],
  ['Meta-WebIndexer', 'Meta AI search index'], ['meta-externalagent', 'Meta training'],
  ['MistralAI-Index', 'Mistral search index'], ['MistralAI-User', 'Mistral, a user\'s question'], ['MistralAI-Training', 'Mistral training'],
  ['Amazonbot', 'Amazon Alexa'], ['Bytespider', 'ByteDance'], ['CCBot', 'Common Crawl'],
];
const GOOGLE_RANGES = 'https://developers.google.com/static/search/apis/ipranges/';
const GOOGLE_COMMON = [`${GOOGLE_RANGES}googlebot.json`];
const GOOGLE_SPECIAL = [`${GOOGLE_RANGES}special-crawlers.json`];
const GOOGLE_FETCHERS = [`${GOOGLE_RANGES}user-triggered-fetchers-google.json`, `${GOOGLE_RANGES}user-triggered-fetchers.json`];
const ANTHROPIC = ['https://claude.com/crawling/bots.json'];
export const ADDRESS_LISTS = {
  bingbot: ['https://www.bing.com/toolbox/bingbot.json'],
  Applebot: ['https://search.developer.apple.com/applebot.json'],
  DuckAssistBot: ['https://duckduckgo.com/duckassistbot.json'],
  'MistralAI-Index': ['https://mistral.ai/mistralai-index-ips.json'],
  'MistralAI-User': ['https://mistral.ai/mistralai-user-ips.json'],
  Googlebot: GOOGLE_COMMON, GoogleOther: GOOGLE_COMMON, 'Google-CloudVertexBot': GOOGLE_COMMON, 'Google-InspectionTool': GOOGLE_COMMON,
  'Mediapartners-Google': GOOGLE_SPECIAL, 'AdsBot-Google': GOOGLE_SPECIAL,
  'Google-Agent': [`${GOOGLE_RANGES}user-triggered-agents.json`, ...GOOGLE_FETCHERS], 'Google-NotebookLM': GOOGLE_FETCHERS,
  PerplexityBot: ['https://www.perplexity.com/perplexitybot.json'], 'Perplexity-User': ['https://www.perplexity.com/perplexity-user.json'],
  'OAI-SearchBot': ['https://openai.com/searchbot.json'], 'ChatGPT-User': ['https://openai.com/chatgpt-user.json'], GPTBot: ['https://openai.com/gptbot.json'],
  'Claude-SearchBot': ANTHROPIC, 'Claude-User': ANTHROPIC, ClaudeBot: ANTHROPIC,
};

export const ANSWER_ENGINES = { 'perplexity.ai': 'Perplexity', 'chatgpt.com': 'ChatGPT', 'chat.openai.com': 'ChatGPT', 'claude.ai': 'Claude', 'copilot.microsoft.com': 'Copilot', 'gemini.google.com': 'Gemini', 'you.com': 'You.com', 'meta.ai': 'Meta AI', 'chat.mistral.ai': 'Le Chat' };
export const SEARCH_ENGINES = { 'google.': 'Google', 'bing.com': 'Bing', 'duckduckgo.com': 'DuckDuckGo', 'yahoo.com': 'Yahoo', 'ecosia.org': 'Ecosia', 'qwant.com': 'Qwant', 'yandex.': 'Yandex', 'search.brave.com': 'Brave' };

export function parseAddress(text) {
  if (text.includes(':')) {
    const halves = text.split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [], right = halves[1] ? halves[1].split(':') : [];
    if (halves.length === 2 ? left.length + right.length > 7 : left.length !== 8) return null;
    const groups = [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
    let bits = 0n;
    for (const group of groups) { if (!/^[0-9a-f]{1,4}$/i.test(group)) return null; bits = (bits << 16n) | BigInt(parseInt(group, 16)); }
    return { bits, length: 128 };
  }
  const octets = text.split('.');
  if (octets.length !== 4) return null;
  let bits = 0n;
  for (const octet of octets) { if (!/^\d{1,3}$/.test(octet) || Number(octet) > 255) return null; bits = (bits << 8n) | BigInt(octet); }
  return { bits, length: 32 };
}

export function parsePrefix(text) {
  const [address, length] = String(text).split('/');
  const parsed = parseAddress(address);
  if (!parsed) return null;
  const mask = length === undefined ? parsed.length : Number(length);
  if (!Number.isInteger(mask) || mask < 0 || mask > parsed.length) return null;
  return { ...parsed, mask };
}

// Whether a logged address, anonymised by Bunny to its /24 (IPv6 /64), overlaps a published prefix.
export function addressMatches(address, prefix) {
  if (address.length !== prefix.length) return false;
  const kept = Math.min(prefix.mask, address.length === 32 ? 24 : 64);
  const shift = BigInt(address.length - kept);
  return (address.bits >> shift) === (prefix.bits >> shift);
}

export const crawlerOf = agent => CRAWLERS.find(([token]) => new RegExp(`(^|[^a-z0-9_-])${token}([-/; )]|$)`, 'i').test(agent ?? ''))?.[0] ?? null;
const USER_TRIGGERED = new Set(['ChatGPT-User', 'Claude-User', 'Perplexity-User', 'MistralAI-User', 'Google-Agent', 'Google-NotebookLM', 'Google-CloudVertexBot', 'Google-InspectionTool', 'Mediapartners-Google', 'AdsBot-Google']);
export function providerOf(crawler) {
  if (/Google|Mediapartners/.test(crawler)) return 'Google';
  if (/^(GPTBot|OAI-SearchBot|ChatGPT-User)$/.test(crawler)) return 'OpenAI';
  if (/^Claude/.test(crawler)) return 'Anthropic';
  if (/^Perplexity/.test(crawler)) return 'Perplexity';
  if (/^Mistral/.test(crawler)) return 'Mistral';
  if (/^(Meta|meta-)/.test(crawler)) return 'Meta';
  return { bingbot: 'Bing', Applebot: 'Apple', DuckAssistBot: 'DuckDuckGo', YandexBot: 'Yandex', Amazonbot: 'Amazon', Bytespider: 'ByteDance', CCBot: 'Common Crawl' }[crawler] ?? null;
}
export const isAutonomous = crawler => Boolean(crawler && providerOf(crawler) && !USER_TRIGGERED.has(crawler));
export const hasAddress = address => Boolean(address && !['0.0.0.0', '::', '-'].includes(address) && parseAddress(address));
export const isOwn = r => {
  if (/VO[ -]?Barna[ /-](?:test|check|monitor)|vobarna-alert-preview/i.test(r.agent)) return true;
  try {
    const url = new URL(r.url);
    return url.searchParams.get('internal') === '1' || ['rollout-check', 'seo_check', 'tracking_check', 'notification_test'].some(k => url.searchParams.has(k));
  } catch { return false; }
};

export function kindOfPath(path) {
  if (/^\/(robots\.txt|sitemap[^/]*\.xml|llms(-full)?\.txt)$/.test(path)) return 'crawler files';
  if (/\.(js|css|png|jpe?g|webp|svg|gif|woff2?|ico|map|webmanifest|mp4)$/.test(path)) return 'assets';
  if (/^\/(api\/|.*\.json$)/.test(path)) return 'data';
  if (/^\/(?:index\.html|cinemas\.html|(?:en|es|ca)(?:\/index\.html|\/)?)?$/.test(path)) return 'programme';
  if (/^\/(en|es|ca)\/(films|peliculas|pellicules)(\/|$)/.test(path)) return 'films';
  if (/^\/(en|es|ca)\/(cinemas|cines|cinemes)(\/|$)/.test(path)) return 'cinemas';
  if (/^\/(en|es|ca)\//.test(path)) return 'guides';
  return 'other';
}
export const isPage = path => ['programme', 'films', 'cinemas', 'guides'].includes(kindOfPath(path));
export const siteRequest = r => {
  try { return ['vobarna.com', 'www.vobarna.com'].includes(new URL(r.url).hostname) && String(r.zone) === PULL_ZONE; }
  catch { return false; }
};

export function parseLine(line) {
  const f = line.split('|');
  if (f.length !== 12) return null;
  const [cache, status, ms, bytes, zone, address, referer, url, , agent, id, country] = f;
  const at = new Date(Number(ms));
  if (!Number.isFinite(at.getTime()) || !/^\d{3}$/.test(status)) return null;
  return { cache, status: +status, at, bytes: +bytes, zone, address, referer: referer === '-' ? null : referer, url, agent, id, country };
}

export function parseEntry(entry) {
  const at = new Date(entry.timestamp);
  if (!Number.isFinite(at.getTime()) || !Number.isInteger(entry.statusCode) || !entry.requestId || !entry.url) throw Error('Malformed Bunny v2 log entry');
  return { at, zone: String(entry.pullZoneId), id: entry.requestId, cache: entry.cacheStatus, status: entry.statusCode,
    bytes: entry.bytesSent ?? 0, address: entry.remoteIp ?? null, country: entry.countryCode ?? '??',
    referer: entry.referer === '-' ? null : entry.referer, url: entry.url, agent: entry.userAgent ?? '', asn: entry.asn, organization: entry.asnOrganization };
}

// Fixed time bounds plus overlap on subsequent polls protect against late log arrival.
// Fail the entire interval if any page fails; callers must never advance a cursor on partial data.
export async function fetchLogs({ key, from, to, zone = PULL_ZONE, fetchImpl = fetch, limit = 10000, search }) {
  if (!key) throw Error('BUNNY_API_KEY is missing');
  const records = new Map();
  for (let offset = 0; offset < 2000000; offset += limit) {
    const url = new URL(`https://logging.bunnycdn.com/v2/pullzones/${zone}/logs`);
    url.search = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: String(limit), offset: String(offset), order: 'asc', includeOriginShield: 'false' });
    if (search) url.searchParams.set('search', search);
    const res = await fetchImpl(url, { headers: { AccessKey: key, Accept: 'application/json' }, signal: AbortSignal.timeout(45000), redirect: 'error' });
    if (!res.ok) throw Error(`Bunny logs: HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.data) || typeof data.pagination?.hasMore !== 'boolean') throw Error('Malformed Bunny v2 response');
    for (const entry of data.data) { const r = parseEntry(entry); records.set(r.id, r); }
    if (!data.pagination.hasMore) return [...records.values()].sort((a, b) => a.at - b.at);
    if (!data.data.length) throw Error('Bunny pagination made no progress');
  }
  throw Error('Bunny pagination exceeded safety limit; narrow the interval');
}

export async function fetchAddressLists({ fetchImpl = fetch } = {}) {
  const urls = [...new Set(Object.values(ADDRESS_LISTS).flat())];
  const files = new Map(await Promise.all(urls.map(async url => {
    try {
      const response = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) return [url, null];
      const data = await response.json();
      const prefixes = data.prefixes?.map(entry => parsePrefix(entry.ipv4Prefix ?? entry.ipv6Prefix)).filter(Boolean);
      return [url, prefixes?.length ? prefixes : null];
    } catch { return [url, null]; }
  })));
  return new Map(Object.entries(ADDRESS_LISTS).map(([crawler, sources]) => {
    const parts = sources.map(url => files.get(url));
    return [crawler, parts.includes(null) ? null : parts.flat()];
  }));
}

export function addressEvidence(record, lists = new Map()) {
  const crawler = crawlerOf(record.agent);
  if (!hasAddress(record.address)) return 'address removed';
  if (!ADDRESS_LISTS[crawler]) return 'no published list configured';
  const prefixes = lists.get(crawler);
  if (!prefixes) return 'list unavailable';
  const address = parseAddress(record.address);
  return prefixes.some(prefix => addressMatches(address, prefix)) ? 'published range overlap' : 'outside published ranges';
}
