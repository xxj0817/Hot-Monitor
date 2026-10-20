// 多信源采集（自包含，仅用 Node 内置 fetch，无第三方依赖）
//
// 信源：
//   web-search: so360news（带真实发布时间，质量最高）/ bing / so360
//   bilibili:   公开搜索接口（无 Key；支持账号型关键词直接抓该 UP 主）
//   twitter:    可选（需要 TWITTER_API_KEY，走 twitterapi.io）
//   mock:       离线演示数据
//
// 爬虫礼貌：串行 + 每请求间隔 throttling，单源失败不影响整体（抛错由上层捕获）。

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastHit = 0;
async function throttle(gap = 3000) {
  const wait = lastHit ? Math.max(0, gap - (Date.now() - lastHit)) : 0;
  if (wait) await sleep(wait);
  lastHit = Date.now();
}

async function fetchText(url, { timeout = 15000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.text();
}

const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const decodeEntities = (s) =>
  String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;|&ensp;|&emsp;/g, ' ');

// ---------- URL / 时间工具 ----------

const DROP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid',
  'msclkid', 'spm', 'from', 'igshid', 'ref_src', 'ref_url', 'mc_cid', 'mc_eid', 'yclid',
  '_hsenc', '_hsmi', 'sessionid', 'scene', 'sub_channel',
]);

export function normUrl(url) {
  try {
    const u = new URL(String(url));
    const keep = [];
    for (const [k, v] of u.searchParams) if (!DROP_PARAMS.has(k.toLowerCase())) keep.push([k, v]);
    let out = `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
    if (keep.length) out += '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort().join('&');
    return out.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

export function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '').trim();
}

const RE_ABS = /(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/;
const RE_ABS_CN = /(20\d{2})\u5e74(\d{1,2})\u6708(\d{1,2})\u65e5/; // 2026年10月14日
const RE_REL = /(\d+)\s*(\u5206\u949f|\u5c0f\u65f6|\u5929)\u524d/; // 5分钟前 / 3小时前 / 2天前

export function parseDateText(txt) {
  const t = String(txt || '');
  let m = t.match(RE_ABS) || t.match(RE_ABS_CN);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  m = t.match(RE_REL);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    const ms = unit === '\u5206\u949f' ? 60e3 : unit === '\u5c0f\u65f6' ? 3600e3 : 864e5;
    return new Date(Date.now() - n * ms).toISOString();
  }
  if (/\u6628\u5929/.test(t)) return new Date(Date.now() - 864e5).toISOString();
  if (/\u4eca\u5929|\u521a\u521a/.test(t)) return new Date().toISOString();
  return null;
}

// 常青页（官网/百科/教程/入门课/工具集）不是"新动态"；无时间的单源结果需要"像新闻"才保留
const EVERGREEN_HINT = /\u5b98\u7f51|\u9996\u9875|\u767e\u79d1|\u7ef4\u57fa|\u6559\u7a0b|\u6307\u5357|\u5de5\u5177\u96c6|\u4e0b\u8f7d|\u6ce8\u518c|\u767b\u5f55|\u5165\u95e8|\u4ece\u96f6|\u8be6\u89e3|\u653b\u7565|\u5408\u96c6|\u8bfe\u7a0b|\u57f9\u8bad|\u96f6\u57fa\u7840/i;
const NEWS_HINT = /\u53d1\u5e03|\u4e0a\u7ebf|\u5f00\u6e90|\u5ba3\u5e03|\u516c\u5f00|\u6cc4\u9732|\u878d\u8d44|\u66f4\u65b0|\u6d4b\u8bd5|\u8bc4\u6d4b|\u5b9e\u6d4b|20\d{2}/i;

export const looksEvergreen = (item) => EVERGREEN_HINT.test(`${item.title || ''} ${item.url || ''}`);
export const looksNewsy = (item) => NEWS_HINT.test(`${item.title || ''} ${item.summary || ''}`);

// 统一质量过滁（采集后、判定前）：
//   1) 常青/教程/官网类内容不是"新动态"
//   2) 无发布时间的单源内容，必须"像新闻"才保留
//   3) B 站低播放视频多为软广/教程，按年龄设最低播放门槛
function qualityFilter(items, { minPlay = { fresh: 1000, old: 3000 } } = {}) {
  return items.filter((it) => {
    if (looksEvergreen(it)) return false;
    const srcCount = it.engineCount || 1;
    if (it.tsKnown === false && srcCount < 2 && !looksNewsy(it)) return false;
    if (it.source === 'bilibili') {
      const play = (it.interactions && it.interactions.play) || 0;
      const age = it.ageHours === null || it.ageHours === undefined ? 999 : it.ageHours;
      if (play < (age <= 24 ? minPlay.fresh : minPlay.old)) return false;
    }
    return true;
  });
}

export function ageHoursOf(item, nowMs = Date.now()) {
  const t = Date.parse(item && item.publishedAt);
  return Number.isNaN(t) ? null : Math.round(((nowMs - t) / 3600e3) * 10) / 10;
}

export function withinDays(item, days, tsKnown) {
  if (!days || days <= 0) return true;
  if (tsKnown === false && !item.tsKnown) return true; // 无时间信息：交给"像新闻"判断
  const t = Date.parse(item && item.publishedAt);
  if (Number.isNaN(t)) return true;
  return Date.now() - t <= days * 864e5;
}

// ---------- 网页搜索 ----------

export async function searchBing(q) {
  await throttle();
  const html = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=12&setlang=zh-hans&mkt=zh-CN`);
  const out = [];
  for (const block of String(html).split(/<li class="b_algo/).slice(1)) {
    const href = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/);
    const title = block.match(/<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/);
    if (!href || !title || !/^https?:\/\//.test(href[1])) continue;
    const p = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const t = decodeEntities(strip(title[1]));
    if (t) out.push({ title: t, url: decodeEntities(href[1]), summary: p ? decodeEntities(strip(p[1])) : '', source: 'bing', tsKnown: false });
  }
  return out;
}

export async function search360(q) {
  await throttle();
  const html = await fetchText(`https://www.so.com/s?q=${encodeURIComponent(q)}&rn=10`);
  const out = [];
  for (const block of String(html).split(/<li class="res-list/).slice(1)) {
    const a =
      block.match(/<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>\s*<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
      block.match(/<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = decodeEntities(a[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const title = decodeEntities(strip(a[2]));
    const p = block.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    if (title) out.push({ title, url, summary: p ? decodeEntities(strip(p[1])) : '', source: 'so360', tsKnown: false });
  }
  return out;
}

// 360 资讯：唯一带真实发布时间的搜索源，质量最高
export async function search360News(q) {
  await throttle();
  const html = await fetchText(`https://news.so.com/ns?q=${encodeURIComponent(q)}&sort=1`);
  const out = [];
  for (const block of String(html).split(/<li class="full-txt res-list/).slice(1)) {
    const uM = block.match(/data-url="([^"]+)"/) || block.match(/<a[^>]+href="([^"]+)"/);
    if (!uM) continue;
    const url = decodeEntities(uM[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const tM = block.match(/<h3[^>]*class="[^"]*g-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
    const sM = block.match(/<p[^>]*class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const timeM = block.match(/<span[^>]*class="[^"]*time[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const iso = timeM ? parseDateText(strip(timeM[1])) : null;
    const title = tM ? decodeEntities(strip(tM[1])) : '';
    if (!title) continue;
    out.push({
      title,
      url,
      summary: sM ? decodeEntities(strip(sM[1])) : '',
      source: 'so360news',
      publishedAt: iso || '',
      tsKnown: !!iso,
    });
  }
  return out;
}

// ---------- B 站（无 Key） ----------

let biliCookie = '';
let biliCookieTried = false;

async function biliJson(url) {
  await throttle(1600);
  if (!biliCookieTried) {
    biliCookieTried = true;
    try {
      const r = await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
      const m = (r.headers.get('set-cookie') || '').match(/buvid3=[^;]+/);
      if (m) biliCookie = m[0];
    } catch { /* 拿不到 cookie 也继续，可能触发风控 */ }
  }
  const headers = { 'user-agent': UA, accept: 'application/json', referer: 'https://www.bilibili.com/' };
  if (biliCookie) headers.cookie = biliCookie;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  const j = await res.json();
  if (j.code === -412 || j.code === -799) throw new Error(`bilibili risk control ${j.code}`);
  if (j.code !== 0) throw new Error(`bilibili code ${j.code}`);
  return j;
}

// @ / 博主 / 官方 / 账号 / UP主 / 频道 等后缀视为账号型
export const isAccountKeyword = (s) => /@|\u535a\u4e3b|\u5b98\u65b9|\u8d26\u53f7|\u5de5\u4f5c\u5ba4|\u56e2\u961f|\u9891\u9053|up\s*\u4e3b|UP\s*\u4e3b|\u53f7$/.test(String(s || ''));

export function stripAccountMarker(name) {
  return String(name || '')
    .replace(/@/g, '')
    .replace(/\u535a\u4e3b|\u5b98\u65b9|\u8d26\u53f7|\u5de5\u4f5c\u5ba4|\u56e2\u961f|\u9891\u9053|up\s*\u4e3b|UP\s*\u4e3b/g, '')
    .replace(/\u53f7$/, '')
    .trim();
}

function mapBili(v) {
  if (!v || !v.bvid) return null;
  const title = String(v.title || '').replace(/<[^>]+>/g, '').trim();
  if (!title) return null;
  const pub = Number(v.pubdate || 0) * 1000;
  return {
    title: decodeEntities(title),
    summary: String(v.description || '').trim(),
    author: v.author ? `@${v.author}` : '',
    url: `https://www.bilibili.com/video/${v.bvid}`,
    source: 'bilibili',
    publishedAt: pub ? new Date(pub).toISOString() : '',
    tsKnown: !!pub,
    bvid: v.bvid,
    mid: String(v.mid || ''),
    interactions: {
      play: Number(v.play) || 0,
      like: Number(v.like) || 0,
      reply: Number(v.video_review !== undefined ? v.video_review : v.review) || 0,
      danmaku: Number(v.danmaku) || 0,
      duration: v.duration || '',
    },
  };
}

async function biliRaw(q, order) {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&page=1${order ? `&order=${order}` : ''}`;
  const j = await biliJson(url);
  const r = j.data && j.data.result;
  return Array.isArray(r) ? r : [];
}

export async function searchBilibili(q) {
  const [a, b] = [await biliRaw(q, 'pubdate'), await biliRaw(q, '')];
  const seen = new Set();
  const out = [];
  for (const v of [...a, ...b]) {
    if (!v || !v.bvid || seen.has(v.bvid)) continue;
    seen.add(v.bvid);
    const it = mapBili(v);
    if (it) out.push(it);
  }
  return out;
}

export async function lookupAccount(name) {
  const j = await biliJson(`https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=${encodeURIComponent(name)}&page=1`);
  const arr = (j.data && j.data.result) || [];
  if (!Array.isArray(arr) || !arr.length) return null;
  const target = String(name || '').toLowerCase().trim();
  const best = arr.find((u) => String(u.uname || '').toLowerCase().trim() === target) || arr[0];
  return { mid: String(best.mid || best.uid || ''), uname: best.uname || '', fans: Number(best.fans) || 0, videos: Number(best.videos) || 0 };
}

// 账号型关键词 -> 只取该账号投稿；否则普通关键词搜索
export async function collectBilibili(q) {
  if (!isAccountKeyword(q)) return searchBilibili(q);
  const acc = await lookupAccount(stripAccountMarker(q));
  if (!acc || !acc.mid) return searchBilibili(stripAccountMarker(q));
  const [a, b] = [await biliRaw(acc.uname, 'pubdate'), await biliRaw(acc.uname, '')];
  const seen = new Set();
  const out = [];
  for (const v of [...a, ...b]) {
    if (!v || !v.bvid || seen.has(v.bvid)) continue;
    if (String(v.mid || '') !== String(acc.mid)) continue;
    seen.add(v.bvid);
    const it = mapBili(v);
    if (it) out.push({ ...it, account: acc });
  }
  return out;
}

// ---------- Twitter / X（可选） ----------

export async function searchTwitter(q, { key, minEngagement = 0 } = {}) {
  if (!key) return [];
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const query = `"${q}" -is:retweet -is:reply since_time:${since}`;
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'x-api-key': key }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`twitter http ${res.status}`);
  const j = await res.json();
  const tweets = Array.isArray(j && j.tweets) ? j.tweets : [];
  return tweets
    .map((t) => {
      const text = t.text || t.full_text || '';
      const user = t.user || {};
      const id = t.id_str || t.id || '';
      const engagement = (Number(t.like_count) || 0) + (Number(t.retweet_count) || 0) + (Number(t.reply_count) || 0);
      return {
        title: text.slice(0, 90) + (text.length > 90 ? '...' : ''),
        summary: text,
        url: `https://x.com/${user.username || user.screen_name || 'u'}/status/${id}`,
        source: 'twitter',
        author: user.username ? `@${user.username}` : '',
        publishedAt: t.created_at ? new Date(t.created_at).toISOString() : '',
        tsKnown: !!t.created_at,
        interactions: { like: Number(t.like_count) || 0, retweet: Number(t.retweet_count) || 0, reply: Number(t.reply_count) || 0 },
        engagement,
      };
    })
    .filter((x) => x.title && /^https:\/\/x\.com\//.test(x.url) && (minEngagement <= 0 || x.engagement >= minEngagement));
}

// ---------- 演示数据（离线 / 无 Key） ----------

const MOCK_PHRASES = [
  '\u5b98\u65b9\u53d1\u5e03\u6280\u672f\u535a\u5ba2\uff0c\u62ab\u9732\u4e86\u67b6\u6784\u4e0e\u6027\u80fd\u7ec6\u8282',
  '\u6b63\u5f0f\u53d1\u5e03\u65b0\u7248\u672c\uff0c\u591a\u5bb6\u5a92\u4f53\u7b2c\u4e00\u65f6\u95f4\u62a5\u9053',
  '\u8fce\u6765\u5927\u7248\u672c\u5347\u7ea7\uff0c\u5f00\u53d1\u8005\u793e\u533a\u51fa\u73b0\u5927\u91cf\u5b9e\u6218\u6559\u7a0b',
  '\u5b98\u65b9\u6f14\u793a\u5f15\u53d1\u70ed\u8bae\uff0c\u7f51\u53cb\u9010\u6761\u5206\u6790\u65b0\u7279\u6027',
];

export function mockItems(keywordOrQuery, kind = 'keyword') {
  const key = String(keywordOrQuery || 'kw');
  const slug = key.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 30) || 'kw';
  const nowMs = Date.now();
  const items = [];
  for (let i = 0; i < 4; i++) {
    const publishedAt = new Date(nowMs - (6 + i * 40) * 60000).toISOString();
    items.push({
      title: kind === 'keyword' ? `${key} ${MOCK_PHRASES[i]}` : `\u3010\u6f14\u793a\u3011${key} \u70ed\u70b9 ${i + 1} \u2014 ${MOCK_PHRASES[i]}`,
      url: `https://demo.hotmonitor.local/${slug}/${i + 1}`,
      summary: `\u3010\u6f14\u793a\u6570\u636e\u3011\u5173\u4e8e\u300c${key}\u300d\u7684\u793a\u4f8b\u52a8\u6001\uff0c\u7528\u4e8e\u65e0\u7f51\u7edc\u73af\u5883\u6f14\u793a\u5b8c\u6574\u6d41\u7a0b\u3002`,
      author: 'demo-bot',
      source: 'mock',
      publishedAt,
      tsKnown: true,
      mockIndex: i + 1,
    });
  }
  return items;
}

// ---------- 归一化 / 去重 / 交叉印证 ----------

export function normalizeItem(raw, nowMs = Date.now()) {
  if (!raw || !raw.title || !raw.url) return null;
  const publishedAt = raw.publishedAt || '';
  const ts = Date.parse(publishedAt);
  const ageHours = Number.isNaN(ts) ? null : Math.round(((nowMs - ts) / 3600e3) * 10) / 10;
  return {
    ...raw,
    title: String(raw.title).trim(),
    url: String(raw.url).trim(),
    summary: raw.summary ? String(raw.summary).trim() : '',
    author: raw.author ? String(raw.author).trim() : '',
    publishedAt: Number.isNaN(ts) ? '' : new Date(ts).toISOString(),
    tsKnown: raw.tsKnown === undefined ? !Number.isNaN(ts) : !!raw.tsKnown,
    ageHours,
  };
}

// 跨引擎验证：同一内容被多个独立信源报道 -> engineCount / corroborated
export function corroborate(items) {
  const byUrl = new Map();
  for (const it of items) {
    const key = normUrl(it.url);
    if (!key) continue;
    const prev = byUrl.get(key);
    if (!prev) {
      byUrl.set(key, { item: it, sources: new Set([it.source]), titles: [it.title] });
      continue;
    }
    prev.sources.add(it.source);
    prev.titles.push(it.title);
  }
  const out = [];
  for (const { item, sources } of byUrl.values()) {
    const engineCount = sources.size;
    out.push({
      ...item,
      engineCount,
      corroborated: engineCount >= 2,
      corroborators: [...sources],
    });
  }
  return out;
}

export function dedupe(items) {
  const seenUrl = new Set();
  const seenTitle = new Set();
  const out = [];
  for (const it of items) {
    const u = normUrl(it.url);
    if (!u || seenUrl.has(u)) continue;
    const t = normTitle(it.title);
    if (t && seenTitle.has(t)) continue;
    seenUrl.add(u);
    if (t) seenTitle.add(t);
    out.push(it);
  }
  return out;
}

// ---------- 采集编排 ----------

function enginesFor(query, { engines, days }) {
  const list = [];
  if (engines.includes('so360news')) list.push(() => search360News(query));
  if (engines.includes('bing')) list.push(() => searchBing(query));
  if (engines.includes('so360')) list.push(() => search360(query));
  return list;
}

// 单关键词采集：网页搜索（含扩展检索词）+ B 站（+ 可选 Twitter / mock）
export async function collectKeyword(keyword, opts = {}) {
  const {
    engines = ['so360news', 'bing', 'so360'],
    queries = [keyword],
    days = 7,
    withBilibili = true,
    twitterKey = '',
    minEngagement = 0,
    mock = false,
    onWarn = () => {},
  } = opts;

  if (mock) return mockItems(keyword, 'keyword').map((i) => normalizeItem(i)).filter(Boolean);

  const raw = [];
  for (const q of queries) {
    for (const run of enginesFor(q, { engines, days })) {
      try {
        raw.push(...(await run()));
      } catch (e) {
        onWarn(`搜索引擎失败（${q}）：${e.message}`);
      }
    }
  }
  if (withBilibili) {
    for (const q of queries.slice(0, 2)) {
      try {
        raw.push(...(await collectBilibili(q)));
      } catch (e) {
        onWarn(`B站失败（${q}）：${e.message}`);
      }
    }
  }
  if (twitterKey) {
    try {
      raw.push(...(await searchTwitter(keyword, { key: twitterKey, minEngagement })));
    } catch (e) {
      onWarn(`X/Twitter 失败：${e.message}`);
    }
  }

  const normalized = raw.map((i) => normalizeItem(i)).filter(Boolean).filter((it) => withinDays(it, days, it.tsKnown));
  return qualityFilter(corroborate(dedupe(normalized)));
}

// 领域采集：多查询词 -> 合并 -> 去重 -> 交叉印证 -> 质量过滁
export async function collectTrend(scope, queries, opts = {}) {
  const {
    engines = ['so360news', 'bing', 'so360'],
    days = 3,
    withBilibili = true,
    mock = false,
    minPlay = { fresh: 10000, old: 5000 },
    onWarn = () => {},
  } = opts;
  if (mock) return mockItems(scope, 'trend').map((i) => normalizeItem(i)).filter(Boolean);

  const raw = [];
  const list = Array.isArray(queries) && queries.length ? queries : [scope];
  for (const q of list) {
    for (const run of enginesFor(q, { engines, days })) {
      try {
        raw.push(...(await run()));
      } catch (e) {
        onWarn(`搜索引擎失败（${q}）：${e.message}`);
      }
    }
  }
  if (withBilibili) {
    for (const q of list.slice(0, 3)) {
      try {
        raw.push(...(await searchBilibili(q)));
      } catch (e) {
        onWarn(`B站失败（${q}）：${e.message}`);
      }
    }
  }
  const normalized = raw.map((i) => normalizeItem(i)).filter(Boolean).filter((it) => withinDays(it, days, it.tsKnown));
  const merged = qualityFilter(corroborate(dedupe(normalized)), { minPlay });
  // 记录被多少个查询词命中（热度信号之一）
  const kwHits = new Map();
  for (const q of list) {
    const key = String(q).toLowerCase();
    for (const it of merged) {
      if (`${it.title} ${it.summary}`.toLowerCase().includes(key)) kwHits.set(it.url, (kwHits.get(it.url) || 0) + 1);
    }
  }
  return merged.map((it) => ({ ...it, kwHits: kwHits.get(it.url) || 0 }));
}
