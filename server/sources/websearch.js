// 无 API 网页搜索爬虫：Bing 主用 + DuckDuckGo(html) 备用。
// 控频：全局串行队列 + 每次间隔 4~8s；随机 UA；失败静默返回空。
import { norm, withinLookback } from './base.js';
import { touchSource } from '../db.js';

const UA_POOL = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
];
const MIN_GAP_MS = 4000;
const JITTER_MS = 4000;
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

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': randUA(),
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBing(html) {
  const out = [];
  const blocks = String(html).split(/<li class="b_algo/).slice(1);
  for (const block of blocks) {
    const hrefM = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/);
    const titleM = block.match(/<h2[^>]*>\s*<a[^>]*>(.*?)<\/a>/s);
    if (!hrefM || !titleM) continue;
    const url = hrefM[1];
    if (!/^https?:\/\//.test(url)) continue;
    const title = stripTags(titleM[1]);
    const pM = block.match(/<p[^>]*>(.*?)<\/p>/s);
    const summary = pM ? stripTags(pM[1]) : '';
    if (title) out.push({ title, url, summary, source: 'bing' });
  }
  return out;
}

function parseDuck(html) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  let m;
  while ((m = re.exec(String(html)))) {
    let url = m[1];
    if (url.startsWith('//')) url = 'https:' + url;
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) {
      try { url = decodeURIComponent(uddg[1]); } catch { /* keep */ }
    }
    if (!/^https?:\/\//.test(url)) continue;
    const title = stripTags(m[2]);
    if (title) out.push({ title, url, summary: '', source: 'duckduckgo' });
  }
  return out;
}

async function searchEngine(query, engine) {
  const q = encodeURIComponent(query);
  if (engine === 'bing') {
    const url = `https://www.bing.com/search?q=${q}&count=15&setlang=zh-hans&mkt=zh-CN`;
    return parseBing(await enqueue(() => fetchHtml(url)));
  }
  const url = `https://html.duckduckgo.com/html/?q=${q}`;
  return parseDuck(await enqueue(() => fetchHtml(url)));
}

// 供采集方调用：串行抓双引擎（DDG 失败静默，不影响 Bing）
export async function searchWeb(query, lookbackHours = 24) {
  const results = [];
  const engines = ['bing', 'duckduckgo'];
  for (const engine of engines) {
    try {
      const list = await searchEngine(query, engine);
      touchSource(`websearch:${engine}`, { ok: true, count: list.length });
      for (const r of list) {
        const item = norm({ ...r, publishedAt: new Date().toISOString() });
        if (item && withinLookback(item, lookbackHours)) results.push(item);
      }
    } catch (e) {
      touchSource(`websearch:${engine}`, { ok: false, count: 0, error: e.message });
    }
  }
  return results;
}
