// Cross-engine corroboration helpers (pure ASCII).
// Goal: count how many independent sources/engines surfaced the same story,
// so low-quality single-source hits can be down-weighted or skipped.

const TRACK_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
  'igshid', 'ref_src', 'ref_url', 'spm', 'from', 'from_id', 'source',
  'yclid', 'wickedid', '_hsenc', '_hsmi', 'vero_id', 'campaign_id',
  'ivk_sa', 'ivk_sch', 'sessionid', 'scene', 'sub_channel', 'k', 'w',
]);

// Normalize a URL for cross-engine dedupe: lowercase host, strip hash &
// tracking params, drop trailing slash, drop www.
export function normUrl(url) {
  try {
    const u = new URL(String(url));
    const keep = [];
    for (const [k, v] of u.searchParams) {
      if (!TRACK_PARAMS.has(k.toLowerCase())) keep.push([k, v]);
    }
    let out = `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
    if (keep.length) {
      const q = keep
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .sort()
        .join('&');
      out += '?' + q;
    }
    return out.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

// Normalize a title for fuzzy cross-engine matching (letters/digits/CJK only).
export function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .trim();
}

// The source bucket of an item (web engine id, twitter, mock).
function bucketOf(it) {
  const s = String((it && it.source) || '');
  return s === 'twitter' || s === 'mock' || !s ? s || '?' : s;
}
// ---- evergreen / navigational detection -------------------------------
// Evergreen pages (official homepages, wiki/baike entries, tutorials, tool
// directories) look "fresh" to search engines but are NOT news. Flagging them
// lets the hot-trend ranking exclude stale clutter.
// CJK words are written as escapes so this file stays pure ASCII.
const EVERGREEN_WORDS = [
  '\u5b98\u7f51', // 官网
  '\u9996\u9875', // 首页
  '\u767e\u79d1', // 百科
  '\u8bcd\u5178', // 词典
  '\u8bcd\u6761', // 词条
  '\u7ef4\u57fa', // 维基
  '\u6559\u7a0b', // 教程
  '\u5165\u95e8', // 入门
  '\u662f\u4ec0\u4e48', // 是什么
  '\u5927\u5168', // 大全
  '\u5408\u96c6', // 合集
  '\u5bfc\u822a', // 导航
  '\u5de5\u5177\u96c6', // 工具集
  '\u4e00\u6587\u8bfb\u61c2', // 一文读懂
  '\u4e00\u6b21\u641e\u61c2', // 一次搞懂
  '\u6307\u5357', // 指南
  '\u624b\u518c', // 手册
  '\u4e0b\u8f7d\u4e2d\u5fc3', // 下载中心
  '\u6392\u884c\u699c', // 排行榜
  '\u6b63\u7248', // 正版
  '\u7834\u89e3', // 破解
  '\u5728\u7ebf\u5de5\u5177', // 在线工具
  '\u751f\u6210\u5668', // 生成器
  '\u7eaf\u51c0\u7248', // 纯净版
];
const EVERGREEN_HOSTS = [
  'baike.baidu.com', 'baike.so.com', 'baike.sogou.com',
  'zh.wikipedia.org', 'en.wikipedia.org', 'wikiwand.com',
  'runoob.com', 'w3schools.com', 'w3school.com.cn',
];

export function looksEvergreen(item) {
  if (!item) return false;
  const title = String(item.title || '');
  const url = String(item.url || '');
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (EVERGREEN_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return true;
    // zhihu question pages are evergreen Q&A, not news
    if (host === 'zhihu.com' && /^\/question\//.test(u.pathname)) return true;
    // root / near-root paths are homepages / section indexes
    const p = u.pathname.replace(/\/+$/, '');
    if (p === '' || p === '/index.html' || p === '/home') return true;
    // download / software aggregator pages
    if (/^\/(download|soft|xiazai|down)\b/i.test(u.pathname)) return true;
    if (/(^|\.)(down|xiazai|soft|pcsoft|onlinedown|cr173|duote|ddooo|pc6)\b/.test(host)) return true;
  } catch { /* keep */ }
  if (EVERGREEN_WORDS.some((w) => title.includes(w))) return true;
  return false;
}

// News-like signal words / recent year-month, used to admit undated pages that
// clearly describe a recent development (while still rejecting evergreen docs).
const NEWS_WORDS = [
  '\u53d1\u5e03', // 发布
  '\u4e0a\u7ebf', // 上线
  '\u63a8\u51fa', // 推出
  '\u5ba3\u5e03', // 宣布
  '\u516c\u5f00', // 公开
  '\u66dd\u5149', // 曝光
  '\u6cc4\u9732', // 泄露
  '\u5f00\u6e90', // 开源
  '\u53d1\u552e', // 发售
  '\u4e0a\u5e02', // 上市
  '\u5185\u6d4b', // 内测
  '\u516c\u6d4b', // 公测
  '\u56de\u5e94', // 回应
  '\u81f4\u6b49', // 致歉
  '\u91cd\u78c5', // 重磅
  '\u9884\u544a', // 预告
  '\u6536\u8d2d', // 收购
  '\u878d\u8d44', // 融资
  '\u5347\u7ea7', // 升级
  '\u66f4\u65b0', // 更新
  '\u7a81\u7834', // 突破
  '\u53d1\u5e03\u4f1a', // 发布会
];
export function looksNewsy(item) {
  if (!item) return false;
  const title = String(item.title || '');
  if (NEWS_WORDS.some((w) => title.includes(w))) return true;
  return /20\d{2}\s*[-\/.\u5e74]\s*\d{1,2}/.test(title);
}


// Annotate each item with extra.engineCount / extra.corroborated /
// extra.corroborators by cross-source matching. Matching is URL-first
// (normalized URL), then normalized-title fallback for single-URL items.
export function corroborate(items) {
  const list = Array.isArray(items) ? items : [];
  const byUrl = new Map();
  const byTitle = new Map();
  const recs = [];

  for (const it of list) {
    const u = normUrl(it.url);
    const t = normTitle(it.title);
    const rec = { it, u, t, srcs: new Set() };
    recs.push(rec);
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(rec);
  }
  // Title fallback only for url-groups of size 1 (avoids false merges).
  for (const g of byUrl.values()) {
    if (g.length > 1) continue;
    const t = g[0].t;
    if (!t) continue;
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(g[0]);
  }

  // URL-level corroboration: every rec sees union of sources in its group.
  for (const g of byUrl.values()) {
    if (g.length < 1) continue;
    const union = new Set(g.map((r) => bucketOf(r.it)));
    for (const r of g) for (const s of union) r.srcs.add(s);
  }
  // Title-level corroboration only when distinct URLs (>1) share a title.
  for (const tg of byTitle.values()) {
    const distinctUrls = new Set(tg.map((r) => r.u));
    if (distinctUrls.size < 2) continue;
    const union = new Set(tg.map((r) => bucketOf(r.it)));
    for (const r of tg) for (const s of union) r.srcs.add(s);
  }

  for (const rec of recs) {
    const srcs = [...rec.srcs].filter((s) => s !== 'mock').sort();
    const extra = { ...(rec.it.extra || {}) };
    extra.engineCount = srcs.length;
    extra.corroborated = srcs.length >= 2;
    if (srcs.length) extra.corroborators = srcs;
    rec.it.extra = extra;
  }
  return list;
}
