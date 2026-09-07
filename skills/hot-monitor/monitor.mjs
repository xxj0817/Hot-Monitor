#!/usr/bin/env node
// Hot-Monitor skill runner - 自包含可移植脚本（供其他 AI 调用）
// 用法见 skills/hot-monitor/SKILL.md
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ---------- env 加载 ----------
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
const MODEL = process.env.HOT_MONITOR_MODEL || 'minimax/minimax-m3:free';

// ---------- 通用工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const strip = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchHtml(url, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html', 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error('http ' + res.status);
  return res.text();
}

// ---------- 网页搜索（无 API，控频） ----------
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
    out.push({ title: strip(title[1]), url: href[1], summary: p ? strip(p[1]) : '', source: 'bing' });
  }
  return out;
}

async function searchDdg(q) {
  await throttle();
  const html = await fetchHtml(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`);
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)<\/a>/gs;
  let m;
  while ((m = re.exec(String(html)))) {
    let url = m[1];
    if (url.startsWith('//')) url = 'https:' + url;
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) { try { url = decodeURIComponent(uddg[1]); } catch { /* keep */ } }
    if (!/^https?:\/\//.test(url)) continue;
    const title = strip(m[2]);
    if (title) out.push({ title, url, summary: '', source: 'duckduckgo' });
  }
  return out;
}

// ---------- Twitter（可选，twitterapi.io） ----------
async function searchTwitter(q) {
  if (!TWITTER_KEY) return [];
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const url = `https://api.twitterapi.io/twitter/tweet/advanced_search?queryType=Latest&query=${encodeURIComponent(`"${q}" -is:retweet since_time:${since}`)}`;
  const res = await fetch(url, { headers: { 'x-api-key': TWITTER_KEY }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('twitter http ' + res.status);
  const j = await res.json();
  if (!j || !Array.isArray(j.tweets)) throw new Error('twitter resp invalid');
  return j.tweets.map((t) => {
    const text = t.text || t.full_text || '';
    const user = t.user || {};
    const id = t.id_str || t.id || '';
    return {
      title: text.slice(0, 90) + (text.length > 90 ? '...' : ''),
      summary: text,
      url: `https://x.com/${user.username || user.screen_name || 'u'}/status/${id}`,
      source: 'twitter',
      publishedAt: t.created_at ? new Date(t.created_at).toISOString() : new Date().toISOString(),
    };
  }).filter((x) => x.title && /^https:\/\/x\.com\//.test(x.url));
}

// ---------- 演示数据 ----------
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
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}`, 'HTTP-Referer': 'http://localhost:3000', 'X-OpenRouter-Title': 'Hot-Monitor Skill' },
      body: JSON.stringify(attempt === 0 ? { ...body, response_format: { type: 'json_object' } } : body),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      if (res.status === 400 && attempt === 0) { await sleep(400); continue; }
      throw new Error(`openrouter http ${res.status}: ${txt.slice(0, 160)}`);
    }
    const j = await res.json();
    let content = j?.choices?.[0]?.message?.content || '';
    content = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    const i = content.indexOf('{');
    const e = content.lastIndexOf('}');
    return JSON.parse(i >= 0 && e > i ? content.slice(i, e + 1) : content);
  }
  throw new Error('openrouter failed');
}

// ---------- 判定 / 热度 ----------
async function judge(item, keyword) {
  if (item.mock) return { related: 1, authentic: 1, score: 90, verdict: 'demo', reason: '演示条目，按可信处理。' };
  if (!KEY) {
    const related = String(item.title).toLowerCase().includes(String(keyword).toLowerCase()) ? 1 : 0;
    return { related, authentic: null, score: related ? 50 : 5, verdict: 'unverified', reason: '无 OpenRouter Key，本地初判未验证。' };
  }
  const sys = `你是资讯真伪鉴别助手。判断候选资讯是否 (1) 与监控关键词强相关（非标题党蹭词）；(2) 真实可信（非营销号、谣言、旧闻炒作、虚构）。仅输出 JSON：{"related":0或1,"authentic":0或1,"score":0-100,"verdict":"authentic|fake|unrelated|unverified","reason":"一句话中文理由"}`;
  const user = `监控关键词：${keyword}\n标题：${item.title}\n摘要：${(item.summary || '').slice(0, 400)}\n链接：${item.url}\n来源：${item.source}\n发布时间：${item.publishedAt || ''}`;
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
  const engW = { twitter: 14, mock: 6, bing: 10, duckduckgo: 10 }[item.source] ?? 8;
  const h = Math.max(1, Math.min(100, Math.round(recency + (item.mock ? 20 : 15) + engW + Math.min(10, kwHits * 2))));
  const level = h >= 75 ? 'S' : h >= 55 ? 'A' : h >= 35 ? 'B' : 'C';
  return { heat: h, level };
}

// ---------- 入口 ----------
const HELP = `Hot-Monitor skill 用法:
  node monitor.mjs keyword "<关键词>" [--hours 24] [--limit 8] [--json] [--mock]
  node monitor.mjs trend "<领域名>" [--queries "a,b,c"] [--hours 24] [--limit 10] [--json] [--mock]
说明: 自动用 Bing/DuckDuckGo 搜索 + Twitter(如有 key) 采集，并用 OpenRouter 判定真伪/聚合。
      --mock 或缺少 OPENROUTER_API_KEY 时进入离线演示模式。`;

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

async function runKeyword(kw, hours, limit, wantJson, forceMock) {
  const useMock = forceMock || !KEY;
  let items = [];
  if (!useMock) {
    for (const q of [kw]) {
      for (const fn of [searchBing, searchDdg]) {
        try { items.push(...(await fn(q))); } catch { /* ignore */ }
      }
    }
    try { items.push(...(await searchTwitter(kw))); } catch { /* ignore */ }
  } else {
    items = mockItems(kw, 'keyword');
  }
  const seen = new Set();
  items = items.filter((it) => {
    if (!it.title || !it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  }).slice(0, limit);

  const judged = [];
  for (const it of items) {
    const j = await judge(it, kw);
    judged.push({ ...it, ...j });
    if (!useMock) await sleep(350); // 轻控频
  }
  return { tool: 'hot-monitor', action: 'keyword', keyword: kw, mode: useMock ? 'mock' : 'openrouter', model: useMock ? null : MODEL, count: judged.length, items: judged };
}

async function runTrend(scope, queries, hours, limit, wantJson, forceMock) {
  const useMock = forceMock || !KEY;
  const qs = (queries || scope).split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  let items = [];
  if (!useMock) {
    for (const q of qs) {
      for (const fn of [searchBing, searchDdg]) {
        try { items.push(...(await fn(q))); } catch { /* ignore */ }
      }
    }
    for (const q of qs.slice(0, 3)) {
      try { items.push(...(await searchTwitter(q))); } catch { /* ignore */ }
    }
  } else {
    items = mockItems(scope, 'trend');
  }
  const seen = new Set();
  items = items.filter((it) => {
    if (!it.title || !it.url || seen.has(it.url)) return false;
    seen.add(it.url);
    return true;
  });

  const scored = items.slice(0, Math.max(limit * 2, 12)).map((it) => {
    let kwHits = 0;
    for (const q of qs) {
      if (String(it.title).toLowerCase().includes(q.toLowerCase())) kwHits++;
    }
    return { ...it, ...heatOf(it, kwHits) };
  }).sort((a, b) => b.heat - a.heat).slice(0, limit);

  return { tool: 'hot-monitor', action: 'trend', scope, mode: useMock ? 'mock' : 'openrouter', model: useMock ? null : MODEL, count: scored.length, items: scored };
}

function printPlain(res) {
  if (res.action === 'keyword') {
    console.log(`[hot-monitor] keyword="${res.keyword}" mode=${res.mode} count=${res.count}`);
    for (const it of res.items) {
      const ok = it.verdict === 'authentic' || it.verdict === 'demo';
      console.log(`${ok ? 'PASS' : '----'} [${it.verdict}] (${it.source}) ${it.title}`);
      console.log(`      url=${it.url}`);
      if (it.reason) console.log(`      reason=${it.reason}`);
    }
    const confirmed = res.items.filter((i) => i.verdict === 'authentic' || i.verdict === 'demo').length;
    console.log(`结论：${confirmed}/${res.count} 条被判定为真实相关（authentic/demo），其余为 假/无关/待验证。`);
  } else {
    console.log(`[hot-monitor] trend="${res.scope}" mode=${res.mode} count=${res.count}`);
    res.items.forEach((it, i) => {
      console.log(`${String(i + 1).padStart(2, '0')} [${it.level}] heat=${it.heat} (${it.source}) ${it.title}`);
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
  let res;
  if (cmd === 'keyword') {
    res = await runKeyword(String(arg1), hours, Math.max(3, Math.min(20, limit)), wantJson, forceMock);
  } else if (cmd === 'trend') {
    res = await runTrend(String(arg1), String(a.queries || ''), hours, Math.max(3, Math.min(20, limit)), wantJson, forceMock);
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
