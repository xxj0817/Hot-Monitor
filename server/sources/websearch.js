// Multi-engine web search scraper (no API, throttled HTML crawling).
// Engines: so360news (dated fresh news), bing, so360 (360 search), baidu.
// Freshness: items carry a REAL publish date when the engine exposes one
// (extra.tsKnown=true); otherwise publishedAt is unknown and treated as
// low-trust context. Evergreen/navigational pages are flagged (extra.evergreen)
// so downstream ranking can exclude stale clutter.
import { norm, withinLookback } from './base.js';
import { touchSource } from '../db.js';
import { getSettings } from '../config.js';
import { looksEvergreen } from './corroborate.js';

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

// ---- real publish-date extraction (best effort; CJK written as escapes) ----
// absolute: 2026-09-15 / 2026/9/15 / 2026-09-15
// relative: 3 hours ago / 25 minutes ago / 2 days ago / yesterday / today
const RE_ABS = /(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})/;
const RE_ABS_CN = /(20\d{2})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/;
const RE_REL = /(\d+)\s*(\u5206\u949f|\u5c0f\u65f6|\u5929)\u524d/;
const RE_YESTERDAY = /\u6628\u5929/;
const RE_BEFORE_YESTERDAY = /\u524d\u5929/;
const RE_TODAY = /\u4eca\u5929|\u521a\u521a|\u521a\u53d1\u5e03/;

function parseDateText(txt) {
  const t = String(txt || '');
  let m = t.match(RE_ABS) || t.match(RE_ABS_CN);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now() + 864e5) return d.toISOString();
  }
  m = t.match(RE_REL);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === '\u5206\u949f' ? 60e3 : unit === '\u5c0f\u65f6' ? 3600e3 : 864e5;
    return new Date(Date.now() - n * ms).toISOString();
  }
  if (RE_YESTERDAY.test(t)) return new Date(Date.now() - 864e5).toISOString();
  if (RE_BEFORE_YESTERDAY.test(t)) return new Date(Date.now() - 2 * 864e5).toISOString();
  if (RE_TODAY.test(t)) return new Date().toISOString();
  return null;
}
function dateFromBlock(block, selector) {
  if (selector) {
    const m = block.match(selector);
    if (m) {
      const iso = parseDateText(stripTags(m[1]));
      if (iso) return iso;
    }
  }
  return parseDateText(stripTags(block).slice(0, 240));
}

// ---------------- Bing ----------------
async function searchBing(query, lookbackHours) {
  const q = encodeURIComponent(query);
  const age = lookbackHours <= 24 ? 'lt1440' : lookbackHours <= 168 ? 'lt10080' : 'lt43200';
  const url = `https://www.bing.com/search?q=${q}&count=15&setlang=zh-hans&mkt=zh-CN&qft=%2Bfilterui%3Aage-${age}`;
  const html = await enqueue(() => fetchHtml(url));
  const out = [];
  const blocks = String(html).split(/<li class="b_algo/).slice(1);
  for (const block of blocks) {
    const hrefM = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/);
    const titleM = block.match(/<h2[^>]*>\s*<a[^>]*>(.*?)<\/a>/s);
    if (!hrefM || !titleM) continue;
    const u = decodeEntities(hrefM[1]);
    if (!/^https?:\/\//.test(u)) continue;
    const title = stripTags(titleM[1]);
    const pM = block.match(/<p[^>]*>(.*?)<\/p>/s);
    const summary = pM ? stripTags(pM[1]) : '';
    const iso = dateFromBlock(block, /<span[^>]*class="[^"]*news_dt[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (title) out.push({ title, url: u, summary, source: 'bing', publishedAt: iso, tsKnown: !!iso });
  }
  return out;
}

// ---------------- 360 news (news.so.com) : dated fresh results ----------------
async function search360News(query) {
  const q = encodeURIComponent(query);
  const url = `https://news.so.com/ns?q=${q}&sort=1`;
  const html = await enqueue(() => fetchHtml(url));
  const out = [];
  const blocks = String(html).split(/<li class="full-txt res-list/).slice(1);
  for (const block of blocks) {
    const urlM = block.match(/data-url="([^"]+)"/) || block.match(/<a[^>]+href="([^"]+)"/);
    if (!urlM) continue;
    const u = decodeEntities(urlM[1]);
    if (!/^https?:\/\//.test(u)) continue;
    const tM = block.match(/<h3[^>]*class="[^"]*g-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const title = tM ? stripTags(tM[1]) : '';
    const sM = block.match(/<p[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const summary = sM ? stripTags(sM[1]) : '';
    const timeM = block.match(/<span[^>]*class="[^"]*time[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const iso = timeM ? parseDateText(stripTags(timeM[1])) : parseDateText(stripTags(block).slice(0, 240));
    if (title) out.push({ title, url: u, summary, source: 'so360news', publishedAt: iso, tsKnown: !!iso });
  }
  return out;
}

// ---------------- 360 search (so.com) ----------------
async function search360(query) {
  const q = encodeURIComponent(query);
  const url = `https://www.so.com/s?q=${q}&rn=10`;
  const html = await enqueue(() => fetchHtml(url));
  const out = [];
  const blocks = String(html).split(/<li class="res-list/).slice(1);
  for (const block of blocks) {
    const aM = block.match(/<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>\s*<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!aM) continue;
    const u = decodeEntities(aM[1]);
    if (!/^https?:\/\//.test(u)) continue;
    const title = stripTags(aM[2]);
    const pM = block.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const summary = pM ? stripTags(pM[1]) : '';
    const iso = dateFromBlock(block, /<span[^>]*class="[^"]*(res-list-time|res-site-time|time)[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (title) out.push({ title, url: u, summary, source: 'so360', publishedAt: iso, tsKnown: !!iso });
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

const RE_BAIDU_BLOCK = /wappass|\u767e\u5ea6\u5b89\u5168\u9a8c\u8bc1|\u8bbf\u95ee\u9a8c\u8bc1|antibot|\u5b89\u5168\u9a8c\u8bc1/i;
function baiduBlocked(html) {
  return RE_BAIDU_BLOCK.test(String(html).slice(0, 60000));
}

async function searchBaidu(query) {
  await ensureBaiduCookie();
  const q = encodeURIComponent(query);
  const url = `https://www.baidu.com/s?wd=${q}&rn=10`;
  const headers = baiduCookie ? { cookie: baiduCookie } : {};
  const html = await enqueue(() => fetchHtml(url, headers));
  const body = String(html);
  if (baiduBlocked(body)) throw new Error('baidu verify wall');
  if (!body.includes('content_left')) return [];
  const out = [];
  const re = /<h3[^>]*class="[^"]*c-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(body))) {
    const u = decodeEntities(m[1]).replace(/^\/\/+/, 'https://');
    if (!/^https?:\/\//.test(u)) continue;
    const title = stripTags(m[2]);
    const tail = body.slice(m.index, m.index + 2500);
    const sM = tail.match(/<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || tail.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const iso = dateFromBlock(tail, /<span[^>]*class="[^"]*c-color-gray2[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (title) out.push({ title, url: u, summary: sM ? stripTags(sM[1]) : '', source: 'baidu', publishedAt: iso, tsKnown: !!iso });
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

async function searchEngine(query, engineId, lookbackHours) {
  if (engineId === 'so360news') return search360News(query);
  if (engineId === 'bing') return searchBing(query, lookbackHours);
  if (engineId === 'so360') return search360(query);
  if (engineId === 'baidu') {
    const list = await searchBaidu(query);
    const resolved = [];
    for (let i = 0; i < list.length; i++) {
      resolved.push(await resolveBaidu(list[i]));
      if (i >= 5) break; // resolve at most 6 redirects, keep the rest raw
    }
    return resolved;
  }
  return [];
}

export const ENGINE_IDS = ['so360news', 'bing', 'so360', 'baidu'];

// Collect from all enabled engines (settings.websearchEngines). Engine
// failures are recorded and skipped. Items carry extra.tsKnown / extra.evergreen
// so callers can decide how to treat un-dated or navigational pages.
export async function searchWeb(query, lookbackHours = 24) {
  const s = getSettings();
  const configured = Array.isArray(s.websearchEngines) && s.websearchEngines.length
    ? s.websearchEngines
    : ENGINE_IDS;
  const engines = ENGINE_IDS.filter((id) => configured.includes(id));
  if (!engines.length) engines.push('so360news');
  const results = [];
  for (const engineId of engines) {
    try {
      const list = await searchEngine(query, engineId, lookbackHours);
      touchSource(`websearch:${engineId}`, { ok: true, count: list.length });
      for (const r of list) {
        const item = norm({ ...r, publishedAt: r.publishedAt });
        if (!item) continue;
        item.extra = { ...(item.extra || {}), tsKnown: !!r.tsKnown, evergreen: looksEvergreen(item) };
        if (item.extra.tsKnown && !withinLookback(item, lookbackHours)) continue;
        results.push(item);
      }
    } catch (e) {
      touchSource(`websearch:${engineId}`, { ok: false, count: 0, error: e.message });
    }
  }
  return results;
}
