// 相关性判定自评测（技能自带，任何 AI 都能用它验证判定质量）
//
// 用例集格式（JSONL，每行一条）：
//   {"id":"...","keyword":"Claude Sonnet 4.6","title":"...","summary":"...","source":"websearch",
//    "expected":1,"note":"为什么期望这个结果"}
// 语义：expected=1 表示"应当被判定为与关键词相关并保留"，0 表示"应当被丢弃"。

import fs from 'node:fs';
import { gate, evaluate, localVariants, normalizeRules } from './relevance.mjs';
import { judge } from './ai.mjs';

export function loadCases(file) {
  const txt = fs.readFileSync(file, 'utf8');
  const out = [];
  let lineNo = 0;
  for (const line of txt.split(/\r?\n/)) {
    lineNo++;
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    try {
      out.push(JSON.parse(t));
    } catch (e) {
      out.push({ id: `bad-${lineNo}`, parseError: e.message });
    }
  }
  return out;
}

function metrics(rows) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of rows) {
    if (r.expected === 1 && r.pred === 1) tp++;
    else if (r.expected === 0 && r.pred === 1) fp++;
    else if (r.expected === 1 && r.pred === 0) fn++;
    else tn++;
  }
  const total = rows.length || 1;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, total: rows.length, accuracy: (tp + tn) / total, precision, recall, f1 };
}

// 跑本地闸门 + （可选）AI 判定，返回逐条结果与指标
export async function runEval({ cases, rules, key, model, useAi = false, limit = 0, onWarn = () => {} }) {
  const list = limit > 0 ? cases.slice(0, limit) : cases;
  const localRows = [];
  const aiRows = [];

  for (const c of list) {
    if (c.parseError) continue;
    const r = normalizeRules({ ...rules, ...(c.rules || {}) });
    const variants = localVariants(c.keyword);
    const item = { title: c.title, summary: c.summary, source: c.source || 'websearch', url: c.url || 'https://example.com/' + encodeURIComponent(c.id || 'x') };

    // 账号型关键词不走覆盖度门槛（内容标题里通常不会出现账号名），与 scan 的行为保持一致
    if (c.pipeline === 'account') {
      localRows.push({
        id: c.id,
        keyword: c.keyword,
        title: c.title,
        expected: c.expected === 1 ? 1 : 0,
        pred: 1,
        detail: '账号型关键词：由账号名匹配处理，不套用覆盖度门槛',
      });
    } else {
      const g = gate(item, c.keyword, r, variants);
      const aiOnly = c.aiOnly === true;
      localRows.push({
        id: c.id,
        keyword: c.keyword,
        title: c.title,
        expected: c.expected === 1 ? 1 : 0,
        pred: g.keep ? 1 : 0,
        skipMetric: aiOnly,
        detail: `gate=${g.reason} cov=${g.coverage} variant=${g.hitVariant || '-'} matched=[${g.matched.join(',')}]${aiOnly ? '（需 AI 判真伪，本地闸门不计入指标）' : ''}`,
      });
    }

    if (useAi && key) {
      const relevance = evaluate(item, c.keyword, r, variants);
      const j = await judge(item, c.keyword, { key, model, variants, relevance, onWarn });
      const pred = j.verdict === 'unrelated' ? 0 : j.related === 1 ? 1 : 0;
      aiRows.push({
        id: c.id,
        keyword: c.keyword,
        title: c.title,
        expected: c.expected === 1 ? 1 : 0,
        pred,
        detail: `verdict=${j.verdict} related=${j.related} cov=${j.coverage} why=${String(j.why || '').slice(0, 60)}`,
      });
    }
  }

  const scoredLocal = localRows.filter((r) => !r.skipMetric);
  return {
    local: { metrics: metrics(scoredLocal), rows: localRows, scored: scoredLocal.length },
    ai: aiRows.length ? { metrics: metrics(aiRows), rows: aiRows, scored: aiRows.length } : null,
  };
}

export function formatEvalReport(result, { verbose = false } = {}) {
  const lines = [];
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const section = (title, part) => {
    const m = part.metrics;
    lines.push(`== ${title} ==`);
    if (part.scored && part.scored !== part.rows.length) {
      lines.push(`（参加统计 ${part.scored}/${part.rows.length} 条，其余为已知不适用本地闸门的用例）`);
    }
    lines.push(`样本 ${m.total} | 准确率 ${pct(m.accuracy)} | 精确率 ${pct(m.precision)} | 召回率 ${pct(m.recall)} | F1 ${pct(m.f1)}`);
    lines.push(`混淆矩阵 TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}`);
    const wrong = part.rows.filter((r) => !r.skipMetric && r.pred !== r.expected);
    if (!wrong.length) {
      lines.push('没有误判。');
    } else {
      lines.push(`误判 ${wrong.length} 条：`);
      for (const r of wrong) {
        lines.push(`  - [${r.expected === 1 ? '漏杀' : '误收'}] ${r.id} 关键词=${r.keyword}`);
        lines.push(`    ${String(r.title).slice(0, 60)}`);
        lines.push(`    ${r.detail}`);
      }
    }
    if (verbose) {
      lines.push('逐条：');
      for (const r of part.rows) lines.push(`  ${r.pred === r.expected ? 'OK  ' : 'FAIL'} ${r.id} :: ${r.detail}`);
    }
    return lines;
  };
  section('本地相关性闸门（免费、确定性）', result.local);
  if (result.ai) {
    lines.push('');
    section('AI 判定（相关性 + 真伪）', result.ai);
  }
  return lines.join('\n');
}
