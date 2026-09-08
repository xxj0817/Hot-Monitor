// OpenRouter AI 封装：judge(真伪/相关判定) / refine(去重提炼) / rank(热度分级)
// 无 Key 或调用失败时自动降级为本地规则（返回 unverified 存疑态，不误报为"真"）。
import { env, getSettings } from './config.js';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export function aiConfigured() {
  return !!env.openrouterKey;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function chat(system, user, opts = {}) {
  if (!aiConfigured()) throw new Error('OPENROUTER_API_KEY 未配置');
  const s = getSettings();
  const body = {
    model: s.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxTokens ?? 1600,
  };
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${env.openrouterKey}`,
    'HTTP-Referer': 'http://localhost:3000',
    'X-OpenRouter-Title': 'Hot-Monitor',
  };
  // 部分模型不支持 response_format，先带 json 约束请求，400 则去掉重试；
  // 免费模型偶发 429/上游过载/空响应，做少量退避重试。
  for (let attempt = 0; attempt < 3; attempt++) {
    const jsonFormat = attempt === 0;
    const payload = jsonFormat ? { ...body, response_format: { type: 'json_object' } } : body;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120000),
      });
      const txt = await res.text().catch(() => '');
      let j = null;
      try { j = JSON.parse(txt); } catch { /* non-json body */ }
      const providerErr = j && j.error && !j.choices;
      const transient = res.status === 429 || res.status >= 500 || (providerErr && (j.error.code === 429 || /overload|rate|temporar|upstream/i.test(String(j.error.message || ''))));
      if (providerErr) {
        if (transient && attempt < 2) { await sleep(2500 * (attempt + 1)); continue; }
        throw new Error(`openrouter ${res.status}: ${String(j.error.message || '').slice(0, 220)}`);
      }
      if (!res.ok) {
        if (res.status === 400 && attempt === 0) { await sleep(400); continue; }
        if (transient && attempt < 2) { await sleep(2500 * (attempt + 1)); continue; }
        throw new Error(`openrouter http ${res.status}: ${txt.slice(0, 220)}`);
      }
      const content = j?.choices?.[0]?.message?.content;
      if (!content) {
        if (attempt < 2) { await sleep(1500 * (attempt + 1)); continue; }
        throw new Error('openrouter empty content');
      }
      return extractJson(content);
    } catch (e) {
      if (attempt >= 2 || (e.message && !String(e.message).includes('http ') && !String(e.message).includes('empty content') && !String(e.message).includes('openrouter '))) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw new Error('openrouter call failed');
}

function extractJson(txt) {
  let s = String(txt).trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return JSON.parse(s);
}

function hasKeyword(title, keyword) {
  const t = String(title || '').toLowerCase();
  return t.includes(String(keyword).toLowerCase());
}

// ---------- 判定：候选内容是否与关键词强相关且真实可信 ----------
export async function judge(item, keyword) {
  const kw = String(keyword || '');
  // 演示源不走真实 AI，避免把演示数据误判为"假"或消耗额度
  if (item.source === 'mock') {
    return {
      related: 1,
      authentic: 1,
      score: 90,
      verdict: 'demo',
      reason: '演示信源样例，按可信处理以演示全链路。',
      model: 'mock',
    };
  }
  if (!aiConfigured()) {
    const related = hasKeyword(item.title, kw) ? 1 : 0;
    return {
      related,
      authentic: null,
      score: related ? 50 : 10,
      verdict: 'unverified',
      reason: 'OPENROUTER_API_KEY 未配置，使用本地规则初判，结果未经 AI 验证。',
      model: 'local',
    };
  }
  const system = `你是专业资讯真伪鉴别助手。判断一条候选资讯是否：(1) 与用户监控的关键词强相关（不是标题党蹭词）；(2) 内容真实可信（非营销号软文、非谣言、非旧闻新发、非明显虚构）。
注意：不要因为内容发布/声称的时间晚于你的知识截止时间就判定为假——实时搜索可能包含你未见过的新进展；无法仅凭记忆确认时，结合标题、摘要与多信源报道判断，仍拿不准就判 unverified 存疑。
仅输出 JSON，格式：{"related":0或1,"authentic":0或1,"score":0到100整数,"verdict":"authentic"或"fake"或"unrelated"或"unverified","reason":"一句话中文理由"}`;
  const extra = item.extra || {};
  const srcMeta =
    `信源：${item.source}` +
    (extra.engineCount
      ? `；被 ${extra.engineCount} 个独立信源同时报道`
      : '；仅单一信源报道') +
    (item.source === 'twitter'
      ? `；互动量：赞${extra.likeCount || 0}/转${extra.retweetCount || 0}/评${extra.replyCount || 0}`
      : '');
  // 网页搜索拿不到真实发布日期，不要给“当前时间”误导模型判假
  const pubLine = item.source === 'twitter'
    ? `发布时间：${item.publishedAt || ''}`
    : '发布时间：实时检索，无法确认发布日期';
  const user = `监控关键词：${kw}
候选资讯（来源 ${item.source}）：
标题：${item.title}
摘要：${(item.summary || '').slice(0, 500)}
链接：${item.url}
${pubLine}
${srcMeta}
请判定。`;
  try {
    const r = await chat(system, user, { maxTokens: 500 });
    const score = Math.max(0, Math.min(100, Number(r.score) || 0));
    return {
      related: r.related === 1 ? 1 : 0,
      authentic: r.authentic === 1 ? 1 : r.authentic === 0 ? 0 : null,
      score,
      verdict: ['authentic', 'fake', 'unrelated', 'unverified'].includes(r.verdict) ? r.verdict : 'unverified',
      reason: String(r.reason || '').slice(0, 300),
      model: getSettings().model,
    };
  } catch (e) {
    // AI 失败 -> 本地规则兜底（标记 unverified，不自动"确认"）
    const related = hasKeyword(item.title, kw) ? 1 : 0;
    return {
      related,
      authentic: null,
      score: related ? 45 : 5,
      verdict: 'unverified',
      reason: `AI 调用失败已降级本地初判：${e.message}`.slice(0, 300),
      model: 'local',
    };
  }
}

// ---------- 提炼：对原始采集条目去重、清洗、可信度估计 ----------
export async function refine(items, scopeName) {
  const list = dedupe(items);
  const fallback = () =>
    list.map((it) => ({
      ...it,
      credible:
        it.source === 'mock'
          ? 1
          : it.extra && it.extra.corroborated
            ? 1
            : null,
    }));
  if (list.length <= 3) return fallback();
  if (!aiConfigured()) return fallback();
  const system = `你是信息聚合助手。以下是某领域 ${scopeName} 的候选资讯，请：去掉完全重复或低质量(广告/无关)条目；为保留下来的条目给出更精炼的中文标题与一句话摘要，并评估可信度 credible(0到1)。注意：被多个独立信源同时报道(engineCount>=2)的条目可信度应偏高；仅单一信源、疑似营销或小道消息的要给低值。
仅输出 JSON：{"items":[{"url":"原样保留的url","title":"新标题","summary":"一句话摘要","credible":0.0-1.0}]}。只保留有把握的，最多输出 12 条。`;
  const user = JSON.stringify(
    list.slice(0, 25).map((it) => ({
      url: it.url,
      title: it.title,
      summary: (it.summary || '').slice(0, 200),
      source: it.source,
      engineCount: (it.extra && it.extra.engineCount) || 1,
      corroborated: !!(it.extra && it.extra.corroborated),
    }))
  );
  try {
    const r = await chat(system, user, { maxTokens: 1800 });
    const kept = Array.isArray(r.items) ? r.items : [];
    const byUrl = new Map(list.map((it) => [it.url, it]));
    return kept
      .map((k) => {
        const ori = byUrl.get(k.url);
        if (!ori) return null;
        return {
          ...ori,
          title: String(k.title || ori.title).trim(),
          summary: String(k.summary || ori.summary || '').trim(),
          credible: k.credible === undefined || k.credible === null ? null : Math.max(0, Math.min(1, Number(k.credible))),
        };
      })
      .filter(Boolean);
  } catch {
    return fallback();
  }
}

// ---------- 排名：热度打分与 S/A/B/C 分级 ----------
export async function rank(items, scopeName) {
  if (!aiConfigured() || items.length === 0) {
    return items.map(heuristic);
  }
  const system = `你是热点分析师。对领域「${scopeName}」的候选热点条目打分（0-100 整数 heat，综合时效性/影响力/讨论度/可信度）并分级 level：S=爆炸性大瓜(>=75)，A=高热度(>=55)，B=有热度(>=35)，C=一般。被多个独立信源同时报道(条目含 crossSources>=2)或互动量高的给更高分，仅单一信源的要保守。为每条给一句话中文摘要。
仅输出 JSON：{"items":[{"url":"...","heat":数字,"level":"S|A|B|C","summary":"..."}]}`;
  const user = JSON.stringify(items.map((it) => ({
    url: it.url, title: it.title, source: it.source,
    ts: it.publishedAt,
    crossSources: (it.extra && it.extra.engineCount) || 1,
    social: it.extra ? { like: it.extra.likeCount || 0, rt: it.extra.retweetCount || 0, reply: it.extra.replyCount || 0 } : null,
  })));
  try {
    const r = await chat(system, user, { maxTokens: 2000 });
    const scored = Array.isArray(r.items) ? r.items : [];
    const byUrl = new Map(items.map((it) => [it.url, it]));
    return scored
      .map((k) => {
        const ori = byUrl.get(k.url);
        if (!ori) return null;
        const heat = Math.max(0, Math.min(100, Math.round(Number(k.heat) || 0)));
        const level = ['S', 'A', 'B', 'C'].includes(k.level) ? k.level : toLevel(heat);
        return { ...ori, heat, level, summary: String(k.summary || ori.summary || '') };
      })
      .filter(Boolean);
  } catch {
    return items.map(heuristic);
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = String(it.url || it.title || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export function toLevel(heat) {
  if (heat >= 75) return 'S';
  if (heat >= 55) return 'A';
  if (heat >= 35) return 'B';
  return 'C';
}

export function heuristic(item) {
  let ageH = 99;
  try {
    ageH = (Date.now() - Date.parse(item.publishedAt)) / 3600000;
  } catch { /* keep */ }
  const recency = ageH <= 6 ? 40 : ageH <= 24 ? 26 : ageH <= 72 ? 12 : 5;
  const cred = item.credible === 1 ? 30 : item.credible === null ? 15 : 0;
  // 多引擎交叉印证加分；仅单信源的网页条目不加分（相当于降权）
  const extra = item.extra || {};
  const corr =
    extra.corroborated
      ? 10
      : extra.engineCount === 1 && (item.source === 'bing' || item.source === 'so360' || item.source === 'baidu' || item.source === 'duckduckgo')
        ? -4
        : 0;
  const baseEng = { twitter: 14, mock: 6, bing: 8, so360: 8, baidu: 6, duckduckgo: 8 }[item.source] ?? 8;
  const engW = baseEng + corr;
  const social = item.extra ? Math.min(16, Math.round(Math.log10(1 + (item.extra.likeCount || 0)) * 6)) : 0;
  const kwHits = item.extra && item.extra.kwHits ? Math.min(8, item.extra.kwHits * 2) : 0;
  const heat = Math.max(1, Math.min(100, Math.round(recency + cred + engW + social + kwHits)));
  return { ...item, heat, level: toLevel(heat), summary: item.summary || '' };
}
