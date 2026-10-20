// AI 判定层（OpenRouter，OpenAI 兼容；可选）
//
// 关键设计：AI 是"增强"而不是"必需"。
//   - 有 Key：AI 输出结构化判定 {related, authentic, score, verdict, evidence, why, coverage}
//     evidence 必须是原文逐字引用，用来解释"为什么这条和关键词相关"（而不是复述内容）
//   - 无 Key / 调用失败：降级为本地规则判定（相关性来自闸门的字面/变体匹配，真伪判 unverified）
// 这样没有 Key 的用户依然能用，只是拿不到"真伪"结论。

import { normCompact } from './relevance.mjs';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function hasKey(key) {
  return !!(key && String(key).trim());
}

function extractJson(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const i = s.indexOf('{');
  const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) s = s.slice(i, j + 1);
  return JSON.parse(s);
}

// 带重试的 JSON 调用。免费模型经常 429/上游过载，做少量退避重试。
export async function chatJson({ key, model = DEFAULT_MODEL, system, user, maxTokens = 700, temperature = 0.2, timeoutMs = 120000, onWarn = () => {} }) {
  if (!hasKey(key)) throw new Error('OPENROUTER_API_KEY 未配置');
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  };
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${String(key).trim()}`,
    'HTTP-Referer': 'https://github.com/xxj0817/Hot-Monitor',
    'X-OpenRouter-Title': 'Hot-Monitor Skill',
  };
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const payload = attempt === 0 ? { ...body, response_format: { type: 'json_object' } } : body;
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const txt = await res.text().catch(() => '');
      let j = null;
      try {
        j = JSON.parse(txt);
      } catch { /* 非 JSON 响应体 */ }
      const providerErr = j && j.error && !j.choices;
      const transient = res.status === 429 || res.status >= 500 || (providerErr && /rate|overload|temporar|upstream/i.test(String(j.error.message || '')));
      if (providerErr) throw new Error(`openrouter ${res.status}: ${String(j.error.message || '').slice(0, 160)}`);
      if (!res.ok) {
        if (res.status === 400 && attempt === 0) {
          await sleep(400);
          continue;
        }
        throw new Error(`openrouter http ${res.status}: ${txt.slice(0, 160)}`);
      }
      const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (!content) throw new Error('openrouter empty content');
      return extractJson(content);
    } catch (e) {
      lastErr = e;
      if (attempt < 2) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr || new Error('openrouter call failed');
}

// ---------- 相关性 + 真伪判定 ----------

export function localJudge(item, keyword, relevance) {
  const rel = relevance || { coverage: 0, matched: [], missing: [], hitVariant: '' };
  const related = rel.coverage > 0 ? 1 : 0;
  return {
    related,
    authentic: null,
    score: related ? 50 : 5,
    verdict: 'unverified',
    reason: related
      ? '未配置 AI Key，仅用本地规则确认了"与关键词相关"，真伪待人工核实。'
      : '本地规则未发现关键词或其等价叫法，判定为无关。',
    evidence: rel.hitVariant || (rel.matched || []).join(' / '),
    why: related
      ? `原文出现关键词或其等价叫法（覆盖度 ${rel.coverage}），但未做真伪核验。`
      : '标题与摘要都没有出现该关键词及其等价叫法，属于关键词无关内容。',
    coverage: rel.coverage,
    model: 'local',
  };
}

// ctx: { variants, aliases, relevance } —— 由调用方传入查询扩展与本地闸门结果
export async function judge(item, keyword, ctx = {}) {
  const { key, model, variants = [], onWarn = () => {} } = ctx;
  const rel = ctx.relevance || { coverage: 0, matched: [], missing: [], hitVariant: '' };
  if (!hasKey(key)) return localJudge(item, keyword, rel);

  const system = `你是资讯相关性审查员。给定监控关键词，判断候选资讯是否同时满足：
(1) 【强相关】标题或摘要中必须实际出现关键词或其等价叫法（含查询扩展变体），或明确在讨论同一个对象/产品/话题。仅仅"属于同一领域、同一大类"不算相关；蹭词、标题党、只提到同公司的其他产品也不算相关。
(2) 【真实可信】非营销号软文、非谣言、非旧闻新发、非明显虚构。
硬规则：
- 若标题与摘要里都找不到关键词或其等价叫法，也没有具体讨论该对象，则 related 必须为 0、verdict 必须为 "unrelated"。
- evidence 必须从标题或摘要中逐字摘录，不得改写、不得编造；找不到可摘录的片段就不要判 related=1。
- evidence 与 why 只说明"为什么和关键词有关"，不要用它们介绍文章内容。
- 不要因为内容发布/声称的时间晚于你的知识截止时间就判定为假；无法确认时给 unverified。
仅输出 JSON：{"related":0或1,"authentic":0或1,"score":0到100整数,"verdict":"authentic"或"fake"或"unrelated"或"unverified","reason":"一句话真伪判定理由","evidence":"逐字摘录的相关性证据（不超过60字）","why":"该证据为何与关键词相关（不超过60字）","coverage":0到1的小数}`;

  const srcMeta = [
    `信源：${item.source || 'unknown'}`,
    item.engineCount && item.engineCount >= 2 ? `被 ${item.engineCount} 个独立信源同时报道` : '仅单一信源报道',
    item.interactions ? `互动：${Object.entries(item.interactions).map(([k, v]) => `${k}=${v}`).join(' ')}` : '',
  ]
    .filter(Boolean)
    .join('；');
  const relLine = variants.length ? `查询扩展变体（视为同一对象）：${variants.slice(0, 8).join(' / ')}` : '查询扩展变体：无';
  const localLine = `本地字面匹配：命中 [${(rel.matched || []).join(', ') || '无'}]，缺失 [${(rel.missing || []).join(', ') || '无'}]，覆盖度 ${rel.coverage}${rel.hitVariant ? `，命中变体 "${rel.hitVariant}"` : ''}`;
  const user = `监控关键词：${keyword}
候选资讯（来源 ${item.source || 'unknown'}）：
标题：${item.title}
摘要：${String(item.summary || '').slice(0, 500)}
链接：${item.url}
发布时间：${item.publishedAt || '未知'}
${srcMeta}
${relLine}
${localLine}
请判定。`;

  try {
    const r = await chatJson({ key, model, system, user, maxTokens: 700, onWarn });
    const score = Math.max(0, Math.min(100, Number(r.score) || 0));
    const covNum = Number(r.coverage);
    const coverage = Number.isFinite(covNum) ? Math.round(Math.max(0, Math.min(1, covNum)) * 100) / 100 : rel.coverage;
    let related = r.related === 1 ? 1 : 0;
    let verdict = ['authentic', 'fake', 'unrelated', 'unverified'].includes(r.verdict) ? r.verdict : 'unverified';
    const evidence = String(r.evidence || '').slice(0, 200);
    // 硬规则兜底：本地完全没命中且模型也没给证据 -> 不许判相关
    if (related === 1 && rel.coverage === 0 && !evidence.trim()) {
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
      model: model || DEFAULT_MODEL,
    };
  } catch (e) {
    onWarn(`AI 判定失败，降级本地规则：${e.message}`);
    const brief = /429|rate limit/i.test(e.message) ? '免费模型额度已用尽（429）' : String(e.message || '').slice(0, 60);
    return { ...localJudge(item, keyword, rel), reason: `AI 暂不可用，已降级本地判定（${brief}）。` };
  }
}

// ---------- 查询扩展（AI 变体，可选） ----------

export async function aiExpand(keyword, { key, model, onWarn = () => {} } = {}) {
  if (!hasKey(key)) throw new Error('OPENROUTER_API_KEY 未配置');
  const system = `你是检索词扩展助手。给定一个监控关键词（账号名、产品名、模型名或话题），列出"指向同一对象/同一话题"的其他常见叫法与写法。
要求：
1) 只输出确实指向同一对象的变体，不要输出无关联想，也不要输出上位类目（如"大模型""AI工具"）。
2) 覆盖：加/去修饰词（程序员、官方、最新）、词序调整、简称与全称、中英文混排空格差异、常见别称。
3) 最多 8 条，每条不超过 20 个字，不含引号与标点。
4) 同时给出关键词中每个实体的常见同义词 aliases。
仅输出 JSON：{"variants":["程序员鱼皮的AI导航"],"aliases":{"claude":["anthropic","克劳德"]}}`;
  const r = await chatJson({ key, model, system, user: `监控关键词：${keyword}`, maxTokens: 500, temperature: 0.4, onWarn });
  const variants = Array.isArray(r.variants) ? r.variants.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const aliases = {};
  if (r.aliases && typeof r.aliases === 'object' && !Array.isArray(r.aliases)) {
    for (const k of Object.keys(r.aliases)) {
      const v = Array.isArray(r.aliases[k]) ? r.aliases[k].map((x) => String(x || '').trim()).filter(Boolean) : [];
      if (v.length) aliases[String(k)] = v.slice(0, 6);
    }
  }
  return { variants: variants.filter((v) => normCompact(v) !== normCompact(keyword)).slice(0, 8), aliases };
}

// ---------- 热度（本地启发式；无 Key 时的排序依据） ----------

export function heatOf(item, kwHits = 0) {
  const age = item.ageHours === null || item.ageHours === undefined ? null : item.ageHours;
  const recency = age === null ? 2 : age <= 6 ? 5 : age <= 24 ? 4 : age <= 72 ? 3 : age <= 168 ? 2 : 1;
  const corr = item.engineCount || 1;
  let eng = 0;
  const it = item.interactions || {};
  const raw = (it.play || 0) / 1000 + (it.like || 0) / 100 + (it.reply || 0) / 50 + (it.retweet || 0) / 20;
  eng = Math.min(4, Math.log10(1 + raw) * 2);
  // 领域榜单里"没有任何检索词命中"的条目通常是被搜索页顺带带出来的，降权
  const hitBonus = kwHits > 0 ? Math.min(kwHits, 4) * 4 : -8;
  const heat = Math.round((recency * 12 + Math.min(corr, 5) * 8 + eng * 6 + hitBonus) * 10) / 10;
  const level = heat >= 72 ? 'S' : heat >= 56 ? 'A' : heat >= 40 ? 'B' : 'C';
  return { heat, level, recency, engineCount: corr, kwHits };
}
