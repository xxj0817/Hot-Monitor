// Multi-engine web search scraper (no API, throttled HTML crawling).
// Engines: bing (reliable), so360 (360 search), baidu (best-effort).
// Each engine is throttled via a shared serial queue + random UA; failures
// are recorded through touchSource and never break the caller.
import { norm, withinLookback } from './base.js';
import { touchSource } from '../db.js';
import { getSettings } from '../config.js';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
];
const MIN_GAP_MS = 2800;
const JITTER_MS = 2800;
let queue = Promise.resolve();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function randUA() {
  return UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
}
function enqueue(fn) {
  const run = queue.then(async () => {
    const gap = MIN_GAP_MS + Math.floor(Math.random() * JITTER_MS);
    await sleep(gap);
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

const BASE_HEADERS = () => ({
  'user-agent': randUA(),
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Not/A)Brand";v="99", "Google Chrome";v="126", "Chromium";v="126"',
  'sec-ch-ua-mobile': '?0',
  'upgrade-insecure-requests': '1',
});

async function fetchHtml(url, extraHeaders = {}) {
  const res = await fetch(url, {
    headers: { ...BASE_HEADERS(), ...extraHeaders },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&ensp;/g, ' ')
    .replace(/&emsp;/g, ' ');
}

// ---------------- Bing ----------------
function parseBing(html) {
  const out = [];
  const blocks = String(html).split(/<li class="b_algo/).slice(1);
  for (const block of blocks) {
    const hrefM = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/);
    const titleM = block.match(/<h2[^>]*>\s*<a[^>]*>(.*?)<\/a>/s);
    if (!hrefM || !titleM) continue;
    const url = decodeEntities(hrefM[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const title = stripTags(titleM[1]);
    const pM = block.match(/<p[^>]*>(.*?)<\/p>/s);
    const summary = pM ? stripTags(pM[1]) : '';
    if (title) out.push({ title, url, summary, source: 'bing' });
  }
  return out;
}

// ---------------- 360 search (so.com) ----------------
function parse360(html) {
  const out = [];
  const blocks = String(html).split(/<li class="res-list/).slice(1);
  for (const block of blocks) {
    // organic title anchor carries the real url in data-mdurl
    const aM = block.match(/<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>\s*<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aM) continue;
    const url = decodeEntities(aM[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const title = stripTags(aM[2]);
    const pM = block.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const summary = pM ? stripTags(pM[1]) : '';
    if (title) out.push({ title, url, summary, source: 'so360' });
  }
  return out;
}

// ---------------- Baidu (best-effort) ----------------
let baiduCookie = '';
let baiduCookieTried = false;
async function ensureBaiduCookie() {
  if (baiduCookieTried) return;
  baiduCookieTried = true;
  try {
    const res = await enqueue(() =>
      fetch('https://www.baidu.com/', { headers: BASE_HEADERS(), signal: AbortSignal.timeout(12000), redirect: 'manual' })
    );
    const sc = res.headers.get('set-cookie');
    if (sc) {
      const first = sc.split(',')[0].split(';')[0];
      if (first.includes('=')) baiduCookie = first;
    }
  } catch { /* keep empty */ }
}

function baiduBlocked(html) {
  return /wappass|百度安全验证|访问验证|antibot|安全验证/i.test(String(html).slice(0, 60000));
}

function parseBaidu(html) {
  const body = String(html);
  if (baiduBlocked(body)) throw new Error('baidu verify wall');
  if (!body.includes('content_left')) return [];
  const out = [];
  const re = /<h3[^>]*class="[^"]*c-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(body))) {
    const url = decodeEntities(m[1]).replace(/^\/\/+/, 'https://');
    if (!/^https?:\/\//.test(url)) continue;
    const title = stripTags(m[2]);
    // grab abstract within a window after the matched block
    const tail = body.slice(m.index, m.index + 2500);
    const sM = tail.match(/<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || tail.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (title) out.push({ title, url, summary: sM ? stripTags(sM[1]) : '', source: 'baidu' });
  }
  return out;
}

// Baidu uses a /link redirect; resolve a few to real urls for cross-engine dedupe.
async function resolveBaidu(item) {
  if (!/baidu\.com\/link\?/.test(item.url)) return item;
  try {
    const res = await enqueue(() =>
      fetch(item.url, { headers: BASE_HEADERS(), signal: AbortSignal.timeout(10000), redirect: 'manual' })
    );
    const loc = res.headers.get('location');
    if (loc && /^https?:\/\//.test(loc)) return { ...item, url: loc };
  } catch { /* keep original */ }
  return item;
}

async function searchEngine(query, engineId) {
  const q = encodeURIComponent(query);
  if (engineId === 'bing') {
    const url = `https://www.bing.com/search?q=${q}&count=15&setlang=zh-hans&mkt=zh-CN`;
    return parseBing(await enqueue(() => fetchHtml(url)));
  }
  if (engineId === 'so360') {
    const url = `https://www.so.com/s?q=${q}&rn=10`;
    return parse360(await enqueue(() => fetchHtml(url)));
  }
  if (engineId === 'baidu') {
    await ensureBaiduCookie();
    const url = `https://www.baidu.com/s?wd=${q}&rn=10`;
    const headers = baiduCookie ? { cookie: baiduCookie } : {};
    const list = parseBaidu(await enqueue(() => fetchHtml(url, headers)));
    const resolved = [];
    for (let i = 0; i < list.length; i++) {
      const it = await resolveBaidu(list[i]);
      resolved.push(it);
      if (i >= 5) break; // resolve at most 6 redirects, keep the rest raw
    }
    return resolved;
  }
  return [];
}

export const ENGINE_IDS = ['bing', 'so360', 'baidu'];

// Collect from all enabled engines (settings.websearchEngines). Engine
// failures are recorded and skipped; result items are time-filtered.
export async function searchWeb(query, lookbackHours = 24) {
  const s = getSettings();
  const configured = Array.isArray(s.websearchEngines) && s.websearchEngines.length
    ? s.websearchEngines
    : ENGINE_IDS;
  const engines = ENGINE_IDS.filter((id) => configured.includes(id));
  if (!engines.length) engines.push('bing');
  const results = [];
  for (const engineId of engines) {
    try {
      const list = await searchEngine(query, engineId);
      touchSource(`websearch:${engineId}`, { ok: true, count: list.length });
      for (const r of list) {
        const item = norm({ ...r, publishedAt: new Date().toISOString() });
        if (item && withinLookback(item, lookbackHours)) results.push(item);
      }
    } catch (e) {
      touchSource(`websearch:${engineId}`, { ok: false, count: 0, error: e.message });
    }
  }
  return results;
}
