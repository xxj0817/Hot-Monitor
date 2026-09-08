#!/usr/bin/env node
// Hot-Monitor skill runner - self-contained CLI for other AI agents.
// Usage: see skills/hot-monitor/SKILL.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ---------- env loading ----------
function loadEnv() {
  const candidates = [
    path.join(ROOT, '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '.env'),
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    break;
  }
}
loadEnv();

const KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const TWITTER_KEY = (process.env.TWITTER_API_KEY || '').trim();
const MODEL = process.env.HOT_MONITOR_MODEL || 'nvidia/nemotron-3-super-120b-a12b:free';
const MIN_ENG = Number(process.env.HOT_MONITOR_MIN_ENG || 100);

// ---------- common utils ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const dec = (s) => String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&ensp;/g, ' ').replace(/&emsp;/g, ' ');

async function fetchHtml(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.text();
}

// URL/title normalization for cross-engine dedupe
function normUrl(url) {
  try {
    const u = new URL(String(url));
    const drop = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid', 'msclkid', 'spm', 'from', 'igshid', 'ref_src', 'ref_url', 'mc_cid', 'mc_eid', 'yclid', '_hsenc', '_hsmi', 'sessionid', 'scene', 'sub_channel']);
    const keep = [];
    for (const [k, v] of u.searchParams) if (!drop.has(k.toLowerCase())) keep.push([k, v]);
    let out = `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
    if (keep.length) out += '?' + keep.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).sort().join('&');
    return out.toLowerCase();
  } catch { return String(url || '').trim().toLowerCase(); }
}
function normTitle(t) {
  return String(t || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '').trim();
}

// ---------- web search: no API, throttled, multi-engine ----------
let lastHit = 0;
async function throttle(gap = 3500) {
  const wait = lastHit ? Math.max(0, gap - (Date.now() - lastHit)) : 0;
  if (wait) await sleep(wait);
  lastHit = Date.now();
}

async function searchBing(q) {
  await throttle();
  const html = await fetchHtml(`https://www.bing.com/search?q=${encodeURIComponent(q)}&count=12&setlang=zh-hans&mkt=zh-CN`);
  const out = [];
  for (const block of String(html).split(/<li class="b_algo/).slice(1)) {
    const href = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"/);
    const title = block.match(/<h2[^>]*>\s*<a[^>]*>(.*?)<\/a>/s);
    if (!href || !title || !/^https?:\/\//.test(href[1])) continue;
    const p = block.match(/<p[^>]*>(.*?)<\/p>/s);
    out.push({ title: strip(title[1]), url: dec(href[1]), summary: p ? strip(p[1]) : '', source: 'bing' });
  }
  return out;
}

async function search360(q) {
  await throttle();
  const html = await fetchHtml(`https://www.so.com/s?q=${encodeURIComponent(q)}&rn=10`);
  const out = [];
  for (const block of String(html).split(/<li class="res-list/).slice(1)) {
    const a = block.match(/<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>\s*<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]+data-mdurl="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const url = dec(a[1]);
    if (!/^https?:\/\//.test(url)) continue;
    const title = strip(a[2]);
    const p = block.match(/<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    if (title) out.push({ title, url, summary: p ? strip(p[1]) : '', source: 'so360' });
  }
  return out;
}

async function searchBaidu(q) {
  await throttle();
  const html = await fetchHtml(`https://www.baidu.com/s?wd=${encodeURIComponent(q)}&rn=10`);
  const body = String(html);
  if (/wappass|百度安全验证|访问验证|安全验证/i.test(body.slice(0, 60000))) return [];
  if (!body.includes('content_left')) return [];
  const out = [];
  const re = /<h3[^>]*class="[^"]*c-title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(body))) {
    const url = dec(m[1]).replace(/^\/\/+/, 'https://');
    if (!/^https?:\/\//.test(url)) continue;
    const title = strip(m[2]);
    const tail = body.slice(m.index, m.index + 2500);
    const p = tail.match(/<span[^>]*class="[^"]*content-right[^"]*"[^>]*>([\s\S]*?)<\/span>/i)
      || tail.match(/<div[^>]*class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (title) out.push({ title, url, summary: p ? strip(p[1]) : '', source: 'baidu' });
  }
  return out;
}

// ---------- Bilibili (CN, no API key; cookie bootstrap) ----------
let biliCookie = '';
let biliCookieTried = false;
async function biliJson(url) {
  await throttle(1500);
  if (!biliCookieTried) {
    biliCookieTried = true;
    try {
      const r = await fetch('https://www.bilibili.com/', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
      const m = (r.headers.get('set-cookie') || '').match(/buvid3=[^;]+/);
      if (m) biliCookie = m[0];
    } catch { /* keep empty */ }
  }
  const headers = { 'user-agent': UA, accept: 'application/json', referer: 'https://www.bilibili.com/' };
  if (biliCookie) headers.cookie = biliCookie;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
  const j = await res.json();
  if (j.code === -412 || j.code === -799) throw new Error('bili risk ' + j.code);
  if (j.code !== 0) throw new Error('bili code ' + j.code);
  return j;
}
function isAcctKw(s) {
  return /@|博主|官方|账号|工作室|团队|频道|up\s*主|UP\s*主|号$/.test(String(s || ''));
}
function cleanBiliTitle(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}
function mapBili(v) {
  if (!v || !v.bvid) return null;
  const title = cleanBiliTitle(v.title);
  if (!title) return null;
  const pub = Number(v.pubdate || 0) * 1000;
  return {
    title,
    summary: String(v.description || '').trim(),
    author: v.author ? '@' + v.author : '',
    url: 'https://www.bilibili.com/video/' + v.bvid,
    source: 'bilibili',
    publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
    bvid: v.bvid,
    mid: String(v.mid || ''),
    play: Number(v.play) || 0,
    like: Number(v.like) || 0,
    reply: Number(v.video_review !== undefined ? v.video_review : v.review) || 0,
  };
}
async function searchBiliRaw(q, order) {
  const j = await biliJson('https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=' + encodeURIComponent(q) + '&page=1' + (order ? '&order=' + order : ''));
  const r = j.data && j.data.result;
  return Array.isArray(r) ? r : [];
}
async function searchBili(q) {
  const a = await searchBiliRaw(q, 'pubdate');
  const b = await searchBiliRaw(q, '');
  const seen = new Set();
  const rows = [];
  for (const v of [...a, ...b]) {
    if (!v || !v.bvid || seen.has(v.bvid)) continue;
    seen.add(v.bvid);
    rows.push(v);
  }
  return rows.map(mapBili).filter(Boolean);
}
async function biliAccount(name) {
  const j = await biliJson('https://api.bilibili.com/x/web-interface/search/type?search_type=bili_user&keyword=' + encodeURIComponent(name) + '&page=1');
  const arr = (j.data && j.data.result) || [];
  if (!Array.isArray(arr) || !arr.length) return null;
  const t = String(name || '').toLowerCase().trim();
  const b = arr.find((u) => String(u.uname || '').toLowerCase().trim() === t) || arr[0];
  return { mid: String(b.mid || b.uid || ''), uname: b.uname || '', fans: Number(b.fans) || 0, videos: Number(b.videos) || 0 };
}
// Keyword or account aware Bilibili collection.
async function collectBili(q) {
  const acc = isAcctKw(q) ? await biliAccount(q) : null;
  if (acc) {
    const a = await searchBiliRaw(acc.uname, 'pubdate');
    const b = await searchBiliRaw(acc.uname, '');
    const seen = new Set();
    const out = [];
    for (const v of [...a, ...b]) {
      if (!v || !v.bvid || seen.has(v.bvid)) continue;
      seen.add(v.bvid);
      if (String(v.mid || '') !== String(acc.mid)) continue;
      const it = mapBili(v);
      if (it) out.push({ ...it, acc: { mid: acc.mid, uname: acc.uname, fans: acc.fans, videos: acc.videos } });
    }
    return out;
  }
  return searchBili(q);
}

// ---------- Twitter (optional, twitterapi.io) ----------
async function searchTwitter(q) {
  if (!TWITTER_KEY) return [];
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(`"${q}" -is:retweet -is:reply since_time:${since}`)}`;
  const res = await fetch(url, { headers: { 'x-api-key': TWITTER_KEY }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('twitter http ' + res.status);
  const j = await res.json();
  if (!j || !Array.isArray(j.tweets)) throw new Error('twitter resp invalid');
  return j.tweets.map((t) => {
    const text = t.text || t.full_text || '';
    const user = t.user || {};
    const id = t.id_str || t.id || '';
    const isReply = ['in_reply_to_status_id', 'in_reply_to_status_id_str', 'in_reply_to_tweet_id', 'reply_to', 'in_reply_to_user_id']
      .some((k) => t[k] !== undefined && t[k] !== null);
    const eng = (Number(t.like_count) || 0) + (Number(t.retweet_count) || 0) + (Number(t.reply_count) || 0);
    return {
      title: text.slice(0, 90) + (text.length > 90 ? '...' : ''),
      summary: text,
      url: `https://x.com/${user.username || user.screen_name || 'u'}/status/${id}`,
      source: 'twitter',
      publishedAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
      isReply,
      engagement: eng,
      likeCount: Number(t.like_count) || 0,
      retweetCount: Number(t.retweet_count) || 0,
      replyCount: Number(t.reply_count) || 0,
    };
  }).filter((x) => x.title && /^https:\/\/x\.com\//.test(x.url) && !x.isReply && (MIN_ENG <= 0 || x.engagement >= MIN_ENG));
}

// ---------- mock data (offline demo) ----------
const PHRASES = ['官方发布技术博客并披露架构细节', '迎来大版本更新引发开发者热议', '官方演示视频成为社区焦点', '团队公布下一步路线图'];
function mockItems(kwOrQuery, action) {
  const key = String(kwOrQuery || 'kw');
  const slug = key.replace(/[^\w\u4e00-\u9fa5-]+/g, '-').slice(0, 30) || 'kw';
  const nowMs = Date.now();
  const items = [];
  for (let i = 0; i < 4; i++) {
    const t = new Date(nowMs - (6 + i * 40) * 60000).toISOString();
    items.push({
      title: action === 'keyword' ? `${key} ${PHRASES[i]}` : `【演示】${key} 热点 ${i + 1}：${PHRASES[i]}`,
      url: `https://demo.hotmonitor.local/${slug}/${i + 1}`,
      summary: '【演示数据】无 Key / --mock 模式生成，用于离线演示全链路。',
      source: 'mock',
      publishedAt: t,
      mock: true,
    });
  }
  return items;
}

// ---------- OpenRouter ----------
async function chatJSON(system, user, maxTokens = 1200) {
  if (!KEY) throw new Error('no OPENROUTER_API_KEY');
  const body = { model: MODEL, messages: [
    { role: 'system', content: system }, { role: 'user', content: user },
  ], temperature: 0.2, max_tokens: maxTokens };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, 'HTTP-Referer': 'http://localhost:3000', 'X-OpenRouter-Title': 'Hot-Monitor Skill' },
        body: JSON.stringify(attempt === 0 ? { ...body, response_format: { type: 'json_object' } } : body),
        signal: AbortSignal.timeout(90000),
      });
      const txt = await res.text().catch(() => '');
      let j = null;
      try { j = JSON.parse(txt); } catch { /* non-json */ }
      if (res.status === 429 || res.status >= 500) {
        if (attempt < 2) { await sleep(2500 * (attempt + 1)); continue; }
        throw new Error(`openrouter http ${res.status}: ${txt.slice(0, 160)}`);
      }
      if (!res.ok) {
        if (res.status === 400 && attempt === 0) { await sleep(400); continue; }
        throw new Error(`openrouter http ${res.status}: ${txt.slice(0, 160)}`);
      }
      const content = j?.choices?.[0]?.message?.content || '';
      if (!content) { if (attempt < 2) { await sleep(1500); continue; } throw new Error('openrouter empty content'); }
      const c = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      const i = c.indexOf('{');
      const e = c.lastIndexOf('}');
      return JSON.parse(i >= 0 && e > i ? c.slice(i, e + 1) : c);
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error('openrouter failed');
}

// ---------- judge / heat ----------
async function judge(item, keyword) {
  if (item.mock) return { related: 1, authentic: 1, score: 90, verdict: 'demo', reason: '演示条目，按可信处理。' };
  if (!KEY) {
    const related = String(item.title).toLowerCase().includes(String(keyword).toLowerCase()) ? 1 : 0;
    return { related, authentic: null, score: related ? 50 : 5, verdict: 'unverified', reason: '无 OpenRouter Key，本地初判未验证。' };
  }
  const sys = `你是专业资讯真伪鉴别助手。判断候选资讯是否 (1) 与监控关键词强相关（非标题党蹭词）；(2) 真实可信（非营销软文、谣言、旧闻新发、虚构）。注意：不要因为内容时间晚于你的知识截止就判假——实时搜索可能包含新进展；拿不准判 unverified。仅输出 JSON：{"related":0或1,"authentic":0或1,"score":0-100,"verdict":"authentic|fake|unrelated|unverified","reason":"一句话中文理由"}`;
  const cross = item.engineCount ? `；被 ${item.engineCount} 个独立信源报道` : '；仅单一信源';
  const pub = item.source === 'twitter' ? `发布时间：${item.publishedAt || ''}` : '发布时间：实时检索，无法确认发布日期';
  const user = `监控关键词：${keyword}\n标题：${item.title}\n摘要：${(item.summary || '').slice(0, 400)}\n链接：${item.url}\n来源：${item.source}${cross}\n${pub}`;
  try {
    const r = await chatJSON(sys, user, 500);
    return {
      related: r.related === 1 ? 1 : 0,
      authentic: r.authentic === 1 ? 1 : r.authentic === 0 ? 0 : null,
      score: Math.max(0, Math.min(100, Number(r.score) || 0)),
      verdict: ['authentic', 'fake', 'unrelated', 'unverified'].includes(r.verdict) ? r.verdict : 'unverified',
      reason: String(r.reason || '').slice(0, 240),
    };
  } catch (e) {
    return { related: 0, authentic: null, score: 0, verdict: 'unverified', reason: 'AI 调用失败：' + e.message.slice(0, 120) };
  }
}

function heatOf(item, kwHits = 0) {
  let ageH = 99;
  try { ageH = (Date.now() - Date.parse(item.publishedAt)) / 3600000; } catch { /* keep */ }
  const recency = ageH <= 6 ? 40 : ageH <= 24 ? 26 : ageH <= 72 ? 12 : 5;
  const corroborated = item.engineCount >= 2;
  const corr = corroborated ? 10 : item.engineCount === 1 && /bing|so360|baidu|duckduckgo/.test(item.source) ? -4 : 0;
  const engW = { twitter: 14, mock: 6, bing: 8, so360: 8, baidu: 6, duckduckgo: 8, bilibili: 8 }[item.source] ?? 8;
  const h = Math.max(1, Math.min(100, Math.round(recency + (item.mock ? 20 : 15) + engW + corr + Math.min(10, kwHits * 2))));
  const level = h >= 75 ? 'S' : h >= 55 ? 'A' : h >= 35 ? 'B' : 'C';
  return { heat: h, level };
}

// cross-engine corroboration on a collected list
function corroborate(items) {
  const byUrl = new Map();
  const byTitle = new Map();
  const recs = [];
  for (const it of items) {
    const rec = { it, u: normUrl(it.url), t: normTitle(it.title), srcs: new Set() };
    recs.push(rec);
    if (!byUrl.has(rec.u)) byUrl.set(rec.u, []);
    byUrl.get(rec.u).push(rec);
  }
  for (const g of byUrl.values()) {
    if (g.length === 1 && g[0].t) {
      if (!byTitle.has(g[0].t)) byTitle.set(g[0].t, []);
      byTitle.get(g[0].t).push(g[0]);
    }
  }
  for (const g of byUrl.values()) {
    const union = new Set(g.map((r) => r.it.source));
    for (const r of g) for (const s of union) r.srcs.add(s);
  }
  for (const tg of byTitle.values()) {
    if (new Set(tg.map((r) => r.u)).size < 2) continue;
    const union = new Set(tg.map((r) => r.it.source));
    for (const r of tg) for (const s of union) r.srcs.add(s);
  }
  for (const rec of recs) {
    const srcs = [...rec.srcs].filter((s) => s !== 'mock');
    rec.it.engineCount = srcs.length;
    rec.it.corroborated = srcs.length >= 2;
    if (srcs.length) rec.it.corroborators = srcs;
  }
  return items;
}

// dedupe by normalized url, keep first
function uniqueByUrl(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = normUrl(it.url);
    if (!it.title || !it.url || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

// round-robin by source so a limited result set keeps source diversity
function interleave(items) {
  const bySrc = new Map();
  for (const it of items) {
    if (!bySrc.has(it.source)) bySrc.set(it.source, []);
    bySrc.get(it.source).push(it);
  }
  const keys = [...bySrc.keys()];
  const maxLen = Math.max(0, ...[...bySrc.values()].map((a) => a.length));
  const out = [];
  for (let i = 0; i < maxLen; i++) {
    for (const k of keys) {
      if (bySrc.get(k)[i]) out.push(bySrc.get(k)[i]);
    }
  }
  return out;
}

// ---------- entry ----------
const HELP = `Hot-Monitor skill 用法:
  node monitor.mjs keyword "<关键词>" [--hours 24] [--limit 8] [--json] [--mock] [--min-eng 100]
  node monitor.mjs trend "<领域名>" [--queries "a,b,c"] [--hours 24] [--limit 10] [--json] [--mock] [--min-eng 100]
说明: 自动用 Bing + 360搜索 + 百度(尽力) + B站视频(含 UP 主/博主/官方账号抓取，无 Key) + Twitter(如有 key，去回复且赞+转+评>=门槛) 采集，
      多引擎交叉印证后由 OpenRouter 判定真伪/聚合。--mock 或缺少 OPENROUTER_API_KEY 时进入离线演示模式。`;

function parseArgv(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[k] = v;
    } else out._.push(a);
  }
  return out;
}

async function collectAll(qs, withTwitter) {
  const items = [];
  const engines = [searchBing, search360, searchBaidu];
  for (const q of qs) {
    for (const fn of engines) {
      try { items.push(...(await fn(q))); } catch { /* engine failure: keep going */ }
    }
    try { items.push(...(await collectBili(q))); } catch { /* bilibili failure: keep going */ }
  }
  if (withTwitter) {
    for (const q2 of qs.slice(0, 3)) {
      try { items.push(...(await searchTwitter(q2))); } catch { /* ignore */ }
    }
  }
  corroborate(items);
  return uniqueByUrl(items);
}

async function runKeyword(kw, hours, limit, wantJson, forceMock, minEng) {
  const useMock = forceMock || !KEY;
  let items = [];
  if (!useMock) {
    items = await collectAll([kw], true);
  } else {
    items = mockItems(kw, 'keyword');
  }
  items = interleave(items).slice(0, limit);

  const judged = [];
  for (const it of items) {
    const j = await judge(it, kw);
    judged.push({ ...it, ...j });
    if (!useMock) await sleep(350);
  }
  return { tool: 'hot-monitor', action: 'keyword', keyword: kw, mode: useMock ? 'mock' : 'openrouter', model: useMock ? null : MODEL, minEng, count: judged.length, items: judged };
}

async function runTrend(scope, queries, hours, limit, wantJson, forceMock, minEng) {
  const useMock = forceMock || !KEY;
  const qs = (queries || scope).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  let items = [];
  if (!useMock) {
    items = await collectAll(qs, true);
  } else {
    items = mockItems(scope, 'trend');
  }
  const scored = interleave(items).slice(0, Math.max(limit * 2, 12)).map((it) => {
    let kwHits = 0;
    for (const q of qs) {
      if (String(it.title).toLowerCase().includes(q.toLowerCase())) kwHits++;
    }
    return { ...it, ...heatOf(it, kwHits) };
  }).sort((a, b) => b.heat - a.heat).slice(0, limit);

  return { tool: 'hot-monitor', action: 'trend', scope, mode: useMock ? 'mock' : 'openrouter', model: useMock ? null : MODEL, minEng, count: scored.length, items: scored };
}

function printPlain(res) {
  if (res.action === 'keyword') {
    console.log(`[hot-monitor] keyword="${res.keyword}" mode=${res.mode} count=${res.count} minEng=${res.minEng}`);
    for (const it of res.items) {
      const ok = it.verdict === 'authentic' || it.verdict === 'demo';
      const cross = it.engineCount ? ` x${it.engineCount}` : '';
      console.log(`${ok ? 'PASS' : '----'} [${it.verdict}] (${it.source}${cross}) ${it.title}`);
      console.log(`      url=${it.url}`);
      if (it.reason) console.log(`      reason=${it.reason}`);
    }
    const confirmed = res.items.filter((i) => i.verdict === 'authentic' || i.verdict === 'demo').length;
    console.log(`结论：${confirmed}/${res.count} 条被判定为真实相关（authentic/demo），其余为 假/无关/待验证。`);
  } else {
    console.log(`[hot-monitor] trend="${res.scope}" mode=${res.mode} count=${res.count} minEng=${res.minEng}`);
    res.items.forEach((it, i) => {
      const cross = it.engineCount ? ` x${it.engineCount}` : '';
      console.log(`${String(i + 1).padStart(2, '0')} [${it.level}] heat=${it.heat} (${it.source}${cross}) ${it.title}`);
      console.log(`      url=${it.url}`);
    });
  }
}

async function main() {
  const a = parseArgv(process.argv.slice(2));
  const cmd = a._[0];
  const arg1 = a._[1];
  if (!cmd || !arg1 || cmd === 'help' || cmd === '-h') {
    console.log(HELP);
    process.exit(cmd && cmd !== 'help' && cmd !== '-h' ? 1 : 0);
  }
  const hours = Number(a.hours) || 24;
  const limit = Number(a.limit) || 8;
  const wantJson = a.json === true || a.json === 'true';
  const forceMock = a.mock === true || a.mock === 'true';
  const minEng = a['min-eng'] === undefined ? MIN_ENG : Number(a['min-eng']) || 0;
  let res;
  if (cmd === 'keyword') {
    res = await runKeyword(String(arg1), hours, Math.max(3, Math.min(20, limit)), wantJson, forceMock, minEng);
  } else if (cmd === 'trend') {
    res = await runTrend(String(arg1), String(a.queries || ''), hours, Math.max(3, Math.min(20, limit)), wantJson, forceMock, minEng);
  } else {
    console.error(`未知子命令: ${cmd}`);
    process.exit(1);
  }
  if (wantJson) {
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  } else {
    printPlain(res);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('hot-monitor skill error:', e.message);
  process.exit(1);
});
