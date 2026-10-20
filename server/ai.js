// OpenRouter AI 封装：judge(真伪/相关判定) / refine(去重提炼) / rank(热度分级) / aiExpand(查询扩展)
// 无 Key 或调用失败时自动降级为本地规则（返回 unverified 存疑态，不误报为"真"）。
import { env, getSettings } from './config.js';
import { evaluateItem } from './relevance.js';

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
  try {
    return JSON.parse(s);
  } catch (e) {
    // 模型偶尔输出解释性文字而非 JSON -> 标记为可重试错误
    throw new Error('openrouter bad json: ' + String(txt).slice(0, 120));
  }
}

// 本地相关性评估：合并设置里的别名 + 该关键词的查询扩展变体
function localRelevance(item, keyword, ctx) {
  const base = getSettings().relevance || {};
  const aliases = { ...(base.aliases || {}), ...((ctx && ctx.aliases) || {}) };
  return evaluateItem(item, keyword, { ...base, aliases }, (ctx && ctx.variants) || []);
}

// 本地兜底判定：命中关键词字面/实体/扩展变体才算相关（无 Key 或 AI 失败时使用）
function localJudge(item, keyword, ctx, rel, reasonText) {
  const r = rel || localRelevance(item, keyword, ctx);
  const related = r.coverage > 0 ? 1 : 0;
  return {
    related,
    authentic: null,
    score: related ? 50 : 5,
    verdict: 'unverified',
    reason: reasonText,
    evidence: r.hitVariant || r.matched.join(' / '),
    why: related
      ? `原文命中关键词或其扩展叫法（覆盖度 ${r.coverage}），是否蹭词仍待 AI 复核。`
      : '原文未出现关键词及其扩展叫法，与监控主题没有直接关联。',
    coverage: r.coverage,
    model: 'local',
    relevance: r,
  };
}

// ---------- 判定：候选内容是否与关键词强相关且真实可信 ----------
// ctx: { variants, aliases, relevance, strict } —— 由 watcher/trend 传入查询扩展与本地预判结果
// 返回 { related, authentic, score, verdict, reason, evidence, why, coverage, model, relevance }
//   reason   = 真伪判定理由（一句话）
//   evidence = 相关性证据：从原文逐字摘录的片段
//   why      = 该片段为何说明“与关键词相关”
//   coverage = 关键词覆盖度 0~1
export async function judge(item, keyword, ctx = {}) {
  const kw = String(keyword || '');
  const rel = ctx.relevance || localRelevance(item, kw, ctx);
  // 演示源不走真实 AI，避免把演示数据误判为“假”或消耗额度
  if (item.source === 'mock') {
    return {
      related: 1,
      authentic: 1,
      score: 90,
      verdict: 'demo',
      reason: '演示信源样例，按可信处理以演示全链路。',
      evidence: '',
      why: '演示数据，跳过相关性判定。',
      coverage: 1,
      model: 'mock',
      relevance: rel,
    };
  }
  if (!aiConfigured()) {
    return localJudge(item, kw, ctx, rel, 'OPENROUTER_API_KEY 未配置，使用本地规则初判，结果未经 AI 验证。');
  }
  const system = `你是资讯相关性审查员。给定监控关键词，判断候选资讯是否同时满足：
(1) 【强相关】标题或摘要中必须实际出现关键词或其等价叫法（含查询扩展变体），或明确在讨论同一个对象/产品/话题。仅仅"属于同一领域、同一大类"不算相关；蹭词、标题党、只提到同公司的其他产品也不算相关。
(2) 【真实可信】非营销号软文、非谣言、非旧闻新发、非明显虚构。
硬规则：
- 若标题与摘要里都找不到关键词或其等价叫法，也没有具体讨论该对象，则 related 必须为 0、verdict 必须为 "unrelated"。
- evidence 必须从标题或摘要中逐字摘录，不得改写、不得编造；找不到可摘录的片段就不要判 related=1。
- evidence 与 why 只说明"为什么和关键词有关"，不要用它们介绍文章内容（内容摘要由另一个环节生成）。
- 不要因为内容发布/声称的时间晚于你的知识截止时间就判定为假——实时搜索可能包含你未见过的新进展；无法仅凭记忆确认时，结合标题、摘要与多信源报道判断，仍拿不准就判 unverified 存疑。
仅输出 JSON，格式：{"related":0或1,"authentic":0或1,"score":0到100整数,"verdict":"authentic"或"fake"或"unrelated"或"unverified","reason":"一句话真伪判定理由","evidence":"从标题或摘要逐字摘录的相关性证据（不超过60字）","why":"一句话说明该证据为何与关键词相关（不超过60字）","coverage":0到1的小数}`;
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
  const relLine = ctx.variants && ctx.variants.length
    ? `查询扩展变体（这些叫法视为同一对象）：${ctx.variants.slice(0, 8).join(' / ')}`
    : '查询扩展变体：无';
  const localLine = `本地字面匹配：命中 [${rel.matched.join(', ') || '无'}]，缺失 [${rel.missing.join(', ') || '无'}]，覆盖度 ${rel.coverage}${rel.hitVariant ? `，命中扩展变体“…${rel.hitVariant}…”` : ''}`;
  const user = `监控关键词：${kw}
候选资讯（来源 ${item.source}）：
标题：${item.title}
摘要：${(item.summary || '').slice(0, 500)}
链接：${item.url}
${pubLine}
${srcMeta}
${relLine}
${localLine}
请判定。`;
  try {
    const r = await chat(system, user, { maxTokens: 600 });
    const score = Math.max(0, Math.min(100, Number(r.score) || 0));
    const covNum = Number(r.coverage);
    const coverage = Number.isFinite(covNum)
      ? Math.round(Math.max(0, Math.min(1, covNum)) * 100) / 100
      : rel.coverage;
    let related = r.related === 1 ? 1 : 0;
    let verdict = ['authentic', 'fake', 'unrelated', 'unverified'].includes(r.verdict) ? r.verdict : 'unverified';
    const evidence = String(r.evidence || '').slice(0, 200);
    // 硬规则兜底：本地完全没命中、模型也没给证据时，不允许判为相关
    if (related === 1 && ctx.strict && rel.coverage === 0 && !evidence.trim()) {
      related = 0;
      verdict = 'unrelated';
    }
    return {
      related,
      authentic: r.authentic === 1 ? 1 : r.authentic === 0 ? 0 : null,
      score,
      verdict,
      reason: String(r.reason || '').slice(0, 300),
      evidence,
      why: String(r.why || '').slice(0, 200),
      coverage,
      model: getSettings().model,
      relevance: rel,
    };
  } catch (e) {
    // AI 失败 -> 本地规则兜底（标记 unverified，不自动"确认"）
    return localJudge(item, kw, ctx, rel, `AI 调用失败已降级本地初判：${e.message}`.slice(0, 300));
  }
}

// ---------- 查询扩展：为关键词生成“同一对象”的其他叫法，用于提高召回 ----------
export async function aiExpand(keyword) {
  if (!aiConfigured()) throw new Error('OPENROUTER_API_KEY 未配置');
  const system = `你是检索词扩展助手。给定一个监控关键词（账号名、产品名、模型名或话题），列出"指向同一对象/同一话题"的其他常见叫法与写法，用于搜索引擎与内容平台检索。
要求：
1) 只输出确实指向同一对象的变体，不要输出无关联想，也不要输出上位类目（如"大模型""AI工具"）。
2) 覆盖这些改写方式：加/去修饰词（程序员、官方、最新）、词序调整、简称与全称、中英文混排的空格差异、常见别称。
3) 最多 8 条，每条不超过 20 个字，不要包含引号或标点。
4) 同时给出关键词中每个实体的常见同义词 aliases。
仅输出 JSON，格式：{"variants":["程序员鱼皮的AI导航"],"aliases":{"claude":["anthropic","克劳德"]}}`;
  const r = await chat(system, `监控关键词：${keyword}`, { maxTokens: 500, temperature: 0.4 });
  const variants = Array.isArray(r.variants)
    ? r.variants.map((x) => String(x || '').trim()).filter(Boolean)
    : [];
  const aliases = {};
  if (r.aliases && typeof r.aliases === 'object') {
    for (const k of Object.keys(r.aliases)) {
      const v = Array.isArray(r.aliases[k])
        ? r.aliases[k].map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      if (v.length) aliases[String(k)] = v.slice(0, 6);
    }
  }
  return { variants: variants.slice(0, 12), aliases, model: getSettings().model };
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
  const system = `你是信息聚合助手。以下是某领域 ${scopeName} 的候选资讯，请：只去掉完全重复、明显无关或广告条目；为保留下来的条目给出更精炼的中文标题与一句话摘要，并评估可信度 credible(0到1)。注意：被多个独立信源同时报道(engineCount>=2)的条目可信度应偏高。
**重要：不要因为发布时间不确定(ts_known=false)就删除条目——时效判断交给后续打分环节；尽量保留有价值的条目（可保留到 12 条）。**
仅输出 JSON：{"items":[{"url":"原样保留的url","title":"新标题","summary":"一句话摘要","credible":0.0-1.0}]}。`;
  const user = JSON.stringify(
    list.slice(0, 25).map((it) => ({
      url: it.url,
      title: it.title,
      summary: (it.summary || '').slice(0, 200),
      source: it.source,
      engineCount: (it.extra && it.extra.engineCount) || 1,
      corroborated: !!(it.extra && it.extra.corroborated),
      ts_known: !(it.extra && it.extra.tsKnown === false),
      publishedAt: it.publishedAt || '',
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
  const system = `你是热点分析师。对领域「${scopeName}」的候选热点条目打分（0-100 整数 heat，综合时效性/影响力/讨论度/可信度）并分级 level：S=爆炸性大瓜(>=75)，A=高热度(>=55)，B=有热度(>=35)，C=一般。被多个独立信源同时报道(条目含 crossSources>=2)或互动量高的给更高分，仅单一信源的要保守。**时效优先：ts_known=false（无可靠发布时间）或明显过时/常青的条目给低 heat(<=30)。** 为每条给一句话中文摘要。
仅输出 JSON：{"items":[{"url":"...","heat":数字,"level":"S|A|B|C","summary":"..."}]}`;
  const user = JSON.stringify(items.map((it) => ({
    url: it.url, title: it.title, source: it.source,
    ts: it.publishedAt,
    ts_known: !(it.extra && it.extra.tsKnown === false),
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
  // evergreen pages should never rank as hot news
  if (item.extra && item.extra.evergreen) {
    return { ...item, heat: 1, level: 'C', summary: item.summary || '' };
  }
  let ageH = 99;
  try {
    ageH = (Date.now() - Date.parse(item.publishedAt)) / 3600000;
  } catch { /* keep */ }
  // unknown publish time cannot be trusted as "fresh" -> heavy penalty
  const tsKnown = !(item.extra && item.extra.tsKnown === false);
  const recency = !tsKnown ? 3 : ageH <= 6 ? 40 : ageH <= 24 ? 26 : ageH <= 72 ? 12 : 5;
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
