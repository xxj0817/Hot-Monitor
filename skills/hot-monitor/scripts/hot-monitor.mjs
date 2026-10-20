#!/usr/bin/env node
// hot-monitor 技能 CLI（自包含：不需要本机服务、不需要数据库、不需要 API Key）
//
// 用法：
//   node scripts/hot-monitor.mjs <action> [参数] [选项]
//
// action: scan | signals | trend | judge | expand | eval | status | help
// 详见 SKILL.md 与 references/usage.md

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gate, exclusionGate, evaluate, localVariants, searchQueries, normalizeRules } from './lib/relevance.mjs';
import { collectKeyword, collectTrend, mockItems, normalizeItem, isAccountKeyword, stripAccountMarker } from './lib/sources.mjs';
import { judge, aiExpand, heatOf, hasKey } from './lib/ai.mjs';
import { loadCases, runEval, formatEvalReport } from './lib/evaluate.mjs';

const VERSION = '2.0.0';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..');
const CACHE_DIR = path.join(os.tmpdir(), 'hot-monitor-skill');
const CACHE_FILE = path.join(CACHE_DIR, 'expansions.json');
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

// ---------- 环境变量（.env 向上查找） ----------

function loadEnv() {
  const tried = [
    path.join(process.cwd(), '.env'),
    path.join(SKILL_DIR, '.env'),
    path.join(SKILL_DIR, '..', '.env'),
    path.join(SKILL_DIR, '..', '..', '.env'),
  ];
  for (const f of tried) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

// ---------- 参数解析 ----------

const BOOL_FLAGS = new Set(['json', 'mock', 'no-bili', 'no-ai', 'verbose', 'net']);

function parseArgv(argv) {
  const out = { action: 'help', positionals: [], flags: {}, values: {} };
  const rest = [...argv];
  if (rest.length && !rest[0].startsWith('-')) out.action = rest.shift();
  while (rest.length) {
    const token = rest.shift();
    if (!token.startsWith('-')) {
      out.positionals.push(token);
      continue;
    }
    const key = token.replace(/^--?/, '');
    if (BOOL_FLAGS.has(key)) out.flags[key] = true;
    else out.values[key] = rest.length && !rest[0].startsWith('-') ? rest.shift() : true;
  }
  return out;
}

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

// ---------- AI 变体缓存（跨调用复用，避免每次烧额度） ----------

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeCache(obj) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj, null, 2), 'utf8');
  } catch { /* 缓存失败不影响主流程 */ }
}

async function variantsFor(keyword, { key, model, useAi, warnings }) {
  const local = localVariants(keyword);
  const cached = readCache()[keyword];
  let ai = cached && Array.isArray(cached.variants) ? cached.variants : [];
  let aliases = (cached && cached.aliases) || {};
  if (useAi && hasKey(key) && !ai.length) {
    try {
      const r = await aiExpand(keyword, { key, model, onWarn: (m) => warnings.push(m) });
      if (r.variants.length) {
        ai = r.variants;
        aliases = { ...aliases, ...r.aliases };
        const cache = readCache();
        cache[keyword] = { variants: ai, aliases, at: new Date().toISOString() };
        writeCache(cache);
      }
    } catch (e) {
      warnings.push(`AI 扩展失败（不影响后续判定）：${e.message}`);
    }
  }
  return { local, ai, aliases, all: [...new Set([...local, ...ai])] };
}

// ---------- 判定语义话术 ----------

export const VERDICT_LABEL = {
  authentic: '已确认（可信）',
  fake: '疑似假消息（勿采信）',
  unrelated: '与关键词无关',
  unverified: '待核实（有讨论但未证实）',
  demo: '演示数据',
};

function adviceFor(envelope) {
  const out = [];
  const items = Array.isArray(envelope.items) ? envelope.items : [];
  if (envelope.mode === 'no-key') {
    out.push('未配置 OPENROUTER_API_KEY：本次只完成了"相关性"判定，真伪未核验（unverified）。要拿到真伪结论，请在 .env 或环境变量里配置 Key。');
  }
  if (envelope.mode === 'ai-degraded') {
    out.push('已配置 Key 但 AI 本次不可用（多为免费额度用尽或网络问题），已降级为本地规则判定：相关性可用，真伪未核验，稍后重试或换个模型即可。');
  }
  if (envelope.mode === 'mock') {
    out.push('当前为演示模式（mock 数据），仅用于验证链路与输出格式，不代表真实情报。');
  }
  const dropped = envelope.gate && envelope.gate.dropped ? Object.values(envelope.gate.dropped).reduce((a, b) => a + b, 0) : 0;
  if (dropped > 0) {
    out.push(`已按关键词闸门丢弃 ${dropped} 条无关内容（原因：${Object.entries(envelope.gate.dropped).map(([k, v]) => `${k}=${v}`).join(' ')}）。`);
  }
  if (envelope.items && !items.length) {
    out.push('本次没有产出条目：可能是关键词偏冷门、网络受限或时间窗口过窄。可尝试加大 --days、或先用 --mock 验证链路。');
  }
  const fakes = items.filter((x) => x.verdict === 'fake').length;
  if (fakes) out.push(`其中有 ${fakes} 条被判定为疑似假消息，汇报时不要当成事实陈述。`);
  const unv = items.filter((x) => x.verdict === 'unverified').length;
  if (unv) out.push(`有 ${unv} 条为待核实状态，只能说"有讨论"，不要说"已确认"。`);
  return out;
}

// ---------- 输出 ----------

function emit(envelope, { json, out, render }) {
  envelope.advice = adviceFor(envelope);
  if (out) {
    fs.writeFileSync(out, JSON.stringify(envelope, null, 2), 'utf8');
  }
  if (json) {
    process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
    return;
  }
  process.stdout.write(render(envelope) + '\n');
}

function fmtAge(h) {
  if (h === null || h === undefined) return '时间未知';
  if (h < 1) return `${Math.round(h * 60)} 分钟前`;
  if (h < 24) return `${Math.round(h * 10) / 10} 小时前`;
  return `${Math.round(h / 24)} 天前`;
}

function modeLabel(mode) {
  if (mode === 'ai') return 'AI（相关性+真伪）';
  if (mode === 'ai-degraded') return 'AI 不可用 -> 本地规则（真伪待核实）';
  if (mode === 'mock') return '演示数据';
  return '本地规则（无 Key）';
}

function renderScan(e) {
  const L = [];
  L.push(`[${e.action}] 关键词：${e.keyword} | 时间窗：${e.window.days} 天 | 判定模式：${modeLabel(e.mode)}`);
  if (e.gate.expandTerms.length) L.push(`扩展检索词：${e.gate.expandTerms.join(' / ')}`);
  const droppedTotal = Object.values(e.gate.dropped).reduce((a, b) => a + b, 0);
  L.push(`采集 ${e.stats.collected} 条，闸门丢弃 ${droppedTotal} 条${droppedTotal ? `（${Object.entries(e.gate.dropped).map(([k, v]) => `${k}=${v}`).join(' ')}）` : ''}`);
  L.push('');
  L.push(e.items.length ? `信号 ${e.items.length} 条（按评分排序）：` : '信号 0 条。');
  e.items.forEach((it, i) => {
    L.push(`${i + 1}. [${it.verdict}][${it.score}] ${it.title}`);
    L.push(`   来源 ${it.source} | ${fmtAge(it.ageHours)} | 覆盖度 ${Math.round((it.coverage || 0) * 100)}%${it.engineCount >= 2 ? ` | ${it.engineCount} 源印证` : ''}`);
    if (it.evidence) L.push(`   依据：「${it.evidence}」`);
    if (it.why) L.push(`   相关性：${it.why}`);
    if (it.reason) L.push(`   判定：${it.reason}`);
    L.push(`   ${it.url}`);
  });
  if (e.advice.length) {
    L.push('');
    L.push('提示：');
    e.advice.forEach((a) => L.push(`- ${a}`));
  }
  return L.join('\n');
}

function renderTrend(e) {
  const L = [];
  L.push(`[trend] 领域：${e.scope} | 时间窗：${e.window.days} 天 | 检索词：${e.queries.join(' / ')}`);
  L.push(`采集 ${e.stats.collected} 条，榜上 ${e.items.length} 条：`);
  e.items.forEach((it, i) => {
    L.push(`${i + 1}. [${it.level}][热度 ${it.heat}] ${it.title}`);
    L.push(`   来源 ${it.source} | ${fmtAge(it.ageHours)}${it.engineCount >= 2 ? ` | ${it.engineCount} 源印证` : ''}${it.kwHits ? ` | ${it.kwHits} 个检索词命中` : ''}`);
    if (it.summary) L.push(`   摘要：${String(it.summary).slice(0, 120)}`);
    L.push(`   ${it.url}`);
  });
  if (e.advice.length) {
    L.push('');
    L.push('提示：');
    e.advice.forEach((a) => L.push(`- ${a}`));
  }
  return L.join('\n');
}

function renderJudge(e) {
  const L = [];
  L.push(`[judge] 关键词：${e.keyword} | 模式：${modeLabel(e.mode)}`);
  L.push(`结论：${e.result.verdict}（${VERDICT_LABEL[e.result.verdict] || ''}）  相关=${e.result.related} 覆盖度=${Math.round((e.result.coverage || 0) * 100)}% 评分=${e.result.score}`);
  if (e.result.evidence) L.push(`依据：「${e.result.evidence}」`);
  if (e.result.why) L.push(`相关性：${e.result.why}`);
  if (e.result.reason) L.push(`判定：${e.result.reason}`);
  if (e.advice.length) {
    L.push('');
    L.push('提示：');
    e.advice.forEach((a) => L.push(`- ${a}`));
  }
  return L.join('\n');
}

function renderExpand(e) {
  const L = [];
  L.push(`[expand] 关键词：${e.keyword}`);
  L.push(`本地规则变体（${e.local.length}）：${e.local.join(' / ') || '（无）'}`);
  if (e.ai.length) L.push(`AI 扩展变体（${e.ai.length}）：${e.ai.join(' / ')}`);
  if (Object.keys(e.aliases).length) L.push(`实体别名：${Object.entries(e.aliases).map(([k, v]) => `${k} -> ${v.join('、')}`).join('；')}`);
  L.push(`建议检索词：${e.searchTerms.join(' / ') || '（无需扩展）'}`);
  return L.join('\n');
}

// ---------- 各 action 实现 ----------

async function actionScan(ctx) {
  const keyword = ctx.positionals[0];
  if (!keyword) throw new Error('用法：scan <关键词> [--limit 8] [--days 7] [--exclude 词1,词2] [--json]');
  const days = Number(ctx.values.days || 7);
  const limit = Number(ctx.values.limit || 8);
  const mock = !!ctx.flags.mock;
  const warnings = [];
  const rules = normalizeRules({
    minCoverage: ctx.values['min-coverage'] !== undefined ? Number(ctx.values['min-coverage']) : 1,
    excludeTerms: list(ctx.values.exclude),
    mustInclude: list(ctx.values.must),
  });

  const { ai, aliases, all } = await variantsFor(keyword, { key: ctx.key, model: ctx.model, useAi: !ctx.flags['no-ai'] && !mock, warnings });
  const expandTerms = searchQueries(keyword, ai, Number(ctx.values['expand-queries'] ?? 1));
  const engines = ctx.values.engines ? list(ctx.values.engines) : ['so360news', 'bing', 'so360'];

  const collected = await collectKeyword(keyword, {
    engines,
    queries: [keyword, ...expandTerms],
    days,
    withBilibili: !ctx.flags['no-bili'],
    twitterKey: ctx.twitterKey,
    minEngagement: Number(ctx.values['min-eng'] || 0),
    mock,
    onWarn: (m) => warnings.push(m),
  });

  // 账号型关键词：不套用覆盖度门槛（内容标题里通常不会出现账号名）
  const accountMode = isAccountKeyword(keyword);
  const dropped = {};
  const droppedSamples = [];
  const items = [];
  let aiOk = false;
  for (const it of collected) {
    let relevance;
    if (accountMode) {
      const base = stripAccountMarker(keyword);
      const hay = `${it.title} ${it.summary} ${it.author}`.toLowerCase();
      const owned = !!(it.account && it.account.mid) || (base && hay.includes(base.toLowerCase()));
      relevance = { coverage: owned ? 1 : 0, matched: owned ? [base || it.author] : [], missing: [], hitVariant: '', level: owned ? 'strong' : 'none' };
      if (!owned) {
        dropped['account-mismatch'] = (dropped['account-mismatch'] || 0) + 1;
        continue;
      }
    } else {
      const g = gate(it, keyword, rules, all);
      if (!g.keep) {
        dropped[g.reason] = (dropped[g.reason] || 0) + 1;
        if (droppedSamples.length < 5) droppedSamples.push({ title: it.title, source: it.source, reason: g.reason, coverage: g.coverage });
        continue;
      }
      relevance = g;
    }
    const j = mock
      ? {
          verdict: 'demo',
          related: 1,
          authentic: 1,
          score: 90,
          coverage: relevance.coverage,
          evidence: relevance.hitVariant || (relevance.matched || []).join(' / '),
          why: '演示数据：跳过真伪判定。',
          reason: '演示信源（--mock），仅用于验证链路与输出格式。',
          model: 'mock',
        }
      : await judge(it, keyword, { key: ctx.key, model: ctx.model, variants: all, aliases, relevance, onWarn: (m) => warnings.push(m) });
    const score = j.model === 'local' || !j.score ? heatOf(it, 0).heat : j.score;
    if (j.model && j.model !== 'local' && j.model !== 'mock') aiOk = true;
    items.push({
      title: it.title,
      url: it.url,
      source: it.source,
      author: it.author || '',
      publishedAt: it.publishedAt || '',
      ageHours: it.ageHours,
      engineCount: it.engineCount || 1,
      corroborated: !!it.corroborated,
      interactions: it.interactions || null,
      verdict: j.verdict,
      related: j.related,
      authentic: j.authentic,
      score,
      coverage: j.coverage,
      evidence: j.evidence,
      why: j.why,
      reason: j.reason,
      model: j.model,
    });
  }
  items.sort((a, b) => b.score - a.score);

  return {
    envelope: {
      ok: true,
      skill: 'hot-monitor',
      version: VERSION,
      action: 'scan',
      keyword,
      generatedAt: new Date().toISOString(),
      mode: mock ? 'mock' : !hasKey(ctx.key) || ctx.flags['no-ai'] ? 'no-key' : aiOk ? 'ai' : 'ai-degraded',
      window: { days, since: new Date(Date.now() - days * 864e5).toISOString() },
      gate: { rules, variants: all, expandTerms, dropped, droppedSamples },
      stats: { collected: collected.length, kept: items.length, engines },
      items: items.slice(0, limit),
      warnings,
    },
    render: renderScan,
  };
}

async function actionSignals(ctx) {
  const res = await actionScan(ctx);
  const e = res.envelope;
  e.action = 'signals';
  // signals 只保留"值得看的"：强相关且未判假
  e.items = e.items.filter((x) => x.related === 1 && x.verdict !== 'fake' && x.verdict !== 'unrelated');
  return { envelope: e, render: renderScan };
}

async function actionTrend(ctx) {
  const scope = ctx.positionals[0] || 'AI 编程';
  const days = Number(ctx.values.days || 3);
  const limit = Number(ctx.values.limit || 10);
  const queries = ctx.values.queries ? list(ctx.values.queries) : scope === 'AI 编程' ? ['AI 编程', '大模型', 'llm', 'coding agent'] : [scope];
  const warnings = [];
  const mock = !!ctx.flags.mock;
  const rules = normalizeRules({ excludeTerms: list(ctx.values.exclude), mustInclude: list(ctx.values.must) });

  const collected = await collectTrend(scope, queries, {
    engines: ctx.values.engines ? list(ctx.values.engines) : ['so360news', 'bing', 'so360'],
    days,
    withBilibili: !ctx.flags['no-bili'],
    mock,
    onWarn: (m) => warnings.push(m),
  });

  const dropped = {};
  const items = [];
  for (const it of collected) {
    const ex = exclusionGate(it, rules);
    if (!ex.keep) {
      dropped[ex.reason] = (dropped[ex.reason] || 0) + 1;
      continue;
    }
    const scored = heatOf(it, it.kwHits || 0);
    items.push({
      title: it.title,
      url: it.url,
      source: it.source,
      publishedAt: it.publishedAt || '',
      ageHours: it.ageHours,
      engineCount: it.engineCount || 1,
      corroborated: !!it.corroborated,
      kwHits: it.kwHits || 0,
      summary: it.summary || '',
      heat: scored.heat,
      level: scored.level,
      credible: it.corroborated ? 1 : null,
    });
  }
  items.sort((a, b) => b.heat - a.heat);

  return {
    envelope: {
      ok: true,
      skill: 'hot-monitor',
      version: VERSION,
      action: 'trend',
      scope,
      generatedAt: new Date().toISOString(),
      mode: mock ? 'mock' : 'live',
      window: { days, since: new Date(Date.now() - days * 864e5).toISOString() },
      queries,
      gate: { dropped },
      stats: { collected: collected.length, kept: items.length },
      items: items.slice(0, limit),
      warnings,
    },
    render: renderTrend,
  };
}

async function actionJudge(ctx) {
  const keyword = ctx.positionals[0];
  const title = ctx.values.title;
  if (!keyword || !title) throw new Error('用法：judge <关键词> --title "标题" [--summary "摘要"] [--url "链接"]');
  const warnings = [];
  const rules = normalizeRules({ minCoverage: ctx.values['min-coverage'] !== undefined ? Number(ctx.values['min-coverage']) : 1, excludeTerms: list(ctx.values.exclude) });
  const { all, aliases } = await variantsFor(keyword, { key: ctx.key, model: ctx.model, useAi: !ctx.flags['no-ai'], warnings });
  const item = normalizeItem({
    title,
    summary: ctx.values.summary || '',
    url: ctx.values.url || 'https://example.local/item',
    source: ctx.values.source || 'manual',
    tsKnown: false,
  });
  const relevance = evaluate(item, keyword, rules, all);
  const j = await judge(item, keyword, { key: ctx.key, model: ctx.model, variants: all, aliases, relevance, onWarn: (m) => warnings.push(m) });
  return {
    envelope: {
      ok: true,
      skill: 'hot-monitor',
      version: VERSION,
      action: 'judge',
      keyword,
      generatedAt: new Date().toISOString(),
      mode: !hasKey(ctx.key) || ctx.flags['no-ai'] ? 'no-key' : j.model && j.model !== 'local' ? 'ai' : 'ai-degraded',
      item: { title: item.title, url: item.url, source: item.source },
      gate: { coverage: relevance.coverage, matched: relevance.matched, missing: relevance.missing, hitVariant: relevance.hitVariant },
      result: j,
      warnings,
    },
    render: renderJudge,
  };
}

async function actionExpand(ctx) {
  const keyword = ctx.positionals[0];
  if (!keyword) throw new Error('用法：expand <关键词> [--json]');
  const warnings = [];
  const { local, ai, aliases } = await variantsFor(keyword, { key: ctx.key, model: ctx.model, useAi: !ctx.flags['no-ai'], warnings });
  return {
    envelope: {
      ok: true,
      skill: 'hot-monitor',
      version: VERSION,
      action: 'expand',
      keyword,
      generatedAt: new Date().toISOString(),
      mode: ai.length ? 'ai' : 'local',
      local,
      ai,
      aliases,
      searchTerms: searchQueries(keyword, ai, Number(ctx.values['expand-queries'] ?? 2)),
      warnings,
    },
    render: renderExpand,
  };
}

async function actionEval(ctx) {
  const casesFile = ctx.values.cases ? path.resolve(String(ctx.values.cases)) : path.join(SKILL_DIR, 'evals', 'cases.jsonl');
  if (!fs.existsSync(casesFile)) throw new Error(`用例集不存在：${casesFile}`);
  const cases = loadCases(casesFile);
  const warnings = [];
  const useAi = !!ctx.flags.ai && hasKey(ctx.key) && !ctx.flags['no-ai'];
  const result = await runEval({
    cases,
    rules: normalizeRules({}),
    key: ctx.key,
    model: ctx.model,
    useAi,
    limit: Number(ctx.values.limit || 0),
    onWarn: (m) => warnings.push(m),
  });
  const report = formatEvalReport(result, { verbose: !!ctx.flags.verbose });
  return {
    envelope: {
      ok: true,
      skill: 'hot-monitor',
      version: VERSION,
      action: 'eval',
      generatedAt: new Date().toISOString(),
      mode: useAi ? 'ai' : 'local',
      cases: cases.length,
      result,
      warnings,
      report,
    },
    render: (e) => e.report + (e.warnings.length ? `\n提示：\n- ${e.warnings.join('\n- ')}` : ''),
  };
}

async function actionStatus(ctx) {
  const casesFile = path.join(SKILL_DIR, 'evals', 'cases.jsonl');
  const lines = [];
  const net = {};
  if (ctx.flags.net) {
    const probe = async (name, url) => {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'hot-monitor-skill' }, signal: AbortSignal.timeout(8000) });
        net[name] = res.ok ? 'ok' : `http ${res.status}`;
      } catch (e) {
        net[name] = e.message;
      }
    };
    await probe('so360news', 'https://news.so.com/ns?q=test');
    await probe('bing', 'https://www.bing.com/search?q=test');
    // 注意：这里不带 cookie 探测，B 站大概率返回 412（风控）；真实采集时会先取 cookie 再请求
    await probe('bilibili(裸探测，412 属预期)', 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=test');
  }
  lines.push(`技能：hot-monitor v${VERSION}（自包含，无需服务/数据库）`);
  lines.push(`Node：${process.version}（建议 18+，需要内置 fetch）`);
  lines.push(`AI Key：${hasKey(ctx.key) ? '已配置（可做真伪判定）' : '未配置（仅本地相关性判定）'}`);
  lines.push(`模型：${ctx.model}`);
  lines.push(`用例集：${fs.existsSync(casesFile) ? `${loadCases(casesFile).length} 条（node scripts/hot-monitor.mjs eval）` : '缺失'}`);
  lines.push(`AI 扩展缓存：${CACHE_FILE}`);
  lines.push(`工作目录：${process.cwd()}`);
  lines.push(`技能目录：${SKILL_DIR}`);
  if (ctx.flags.net) lines.push(`联网探测：${Object.entries(net).map(([k, v]) => `${k}=${v}`).join(' | ')}`);
  return {
    envelope: {
      ok: true,
      skill: 'hot-monitor',
      version: VERSION,
      action: 'status',
      generatedAt: new Date().toISOString(),
      node: process.version,
      hasKey: hasKey(ctx.key),
      model: ctx.model,
      cache: CACHE_FILE,
      skillDir: SKILL_DIR,
      net: ctx.flags.net ? net : null,
    },
    render: () => lines.join('\n'),
  };
}

const HELP = `hot-monitor 技能 CLI v${VERSION}（自包含：无需服务/数据库/Key）

用法：node scripts/hot-monitor.mjs <命令> [参数] [选项]

命令：
  scan <关键词>            采集 + 相关性闸门 + AI 判定（输出信号与丢弃统计）
  signals <关键词>         同 scan，但只输出"强相关且未判假"的信号
  trend [领域]             领域热点榜（默认 "AI 编程"）
  judge <关键词> --title "标题" [--summary "摘要"] [--url "链接"]
                          单条内容判定：相关性 + 真伪（供别的 AI 复核用）
  expand <关键词>          查询扩展：等价叫法 + 建议检索词
  eval [--ai] [--cases 文件]
                          跑相关性用例集，输出准确率/误判清单
  status [--net]           自检：Node / Key / 用例集 / 联网探测
  help                     显示本帮助

通用选项：
  --json                   输出结构化 JSON（AI 调用时推荐）
  --limit N                最多输出多少条（默认 scan=8 / trend=10）
  --days N                 时间窗天数（默认 scan=7 / trend=3）
  --queries "a,b,c"        trend 的检索词
  --exclude "词1,词2"      出现即丢弃（排除词）
  --must "词1,词2"         必须全部出现（必须包含词）
  --min-coverage 0|0.5|1   关键词命中要求（默认 1 = 全部实体词）
  --expand-queries N       额外用几个扩展检索词（默认 1）
  --engines "so360news,bing,so360"
  --no-bili                不采 B 站
  --no-ai                  不使用 AI（即使配置了 Key）
  --mock                   离线演示数据
  --model 模型名           覆盖默认模型
  --out 文件.json          同时把结果写入文件
  --verbose                更多细节（eval 输出逐条）

示例：
  node scripts/hot-monitor.mjs scan "Claude Sonnet 4.6" --json --limit 5
  node scripts/hot-monitor.mjs trend "AI 编程" --days 3 --json
  node scripts/hot-monitor.mjs judge "GPT-6" --title "GPT-6 向全球用户开放" --json
  node scripts/hot-monitor.mjs eval
`;

async function main() {
  const argv = process.argv.slice(2);
  const ctx = parseArgv(argv);
  ctx.key = (process.env.OPENROUTER_API_KEY || '').trim();
  ctx.twitterKey = (process.env.TWITTER_API_KEY || '').trim();
  ctx.model = String(ctx.values.model || process.env.HOT_MONITOR_MODEL || DEFAULT_MODEL);

  if (ctx.action === 'help' || ctx.flags.help) {
    process.stdout.write(HELP);
    return;
  }

  const runners = {
    scan: actionScan,
    signals: actionSignals,
    trend: actionTrend,
    judge: actionJudge,
    expand: actionExpand,
    eval: actionEval,
    status: actionStatus,
  };
  const run = runners[ctx.action];
  if (!run) {
    process.stderr.write(`未知命令：${ctx.action}\n\n${HELP}`);
    process.exit(2);
  }
  try {
    const { envelope, render } = await run(ctx);
    emit(envelope, { json: !!ctx.flags.json, out: ctx.values.out ? String(ctx.values.out) : '', render: render || (() => JSON.stringify(envelope, null, 2)) });
    if (!envelope.ok) process.exit(1);
  } catch (e) {
    const payload = { ok: false, skill: 'hot-monitor', action: ctx.action, error: e.message };
    if (ctx.flags.json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    else process.stderr.write(`[error] ${e.message}\n`);
    process.exit(1);
  }
}

main();
