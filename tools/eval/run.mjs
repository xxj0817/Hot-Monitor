// 相关性闸门评测脚本
//
// 用法：
//   node tools/eval/run.mjs                     # 只跑本地闸门（免费、确定性）
//   node tools/eval/run.mjs --ai                 # 额外跑 AI 判定（消耗额度）
//   node tools/eval/run.mjs --ai --limit 5       # 只跑前 5 条（省额度）
//   node tools/eval/run.mjs --fail-under 0.9     # 准确率低于阈值时以退出码 1 结束（可用于 CI）
//   node tools/eval/run.mjs --verbose            # 打印每条判定明细
//
// 评测目标：related 的二分类质量（1=与关键词强相关，0=无关）
// 指标：准确率 / 精确率 / 召回率 / F1 + 混淆矩阵 + 误判清单

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_PATH = path.join(__dirname, 'cases.jsonl');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};

const useAi = flag('--ai');
const verbose = flag('--verbose');
const limit = Number(opt('--limit', '0')) || 0;
const failUnder = Number(opt('--fail-under', '0')) || 0;

const { loadSettings, getSettings } = await import('../../server/config.js');
const { gate, evaluateItem } = await import('../../server/relevance.js');
const { aiConfigured } = await import('../../server/ai.js');
const { relevanceInputsFor } = await import('../../server/expand.js');

function readCases() {
  if (!fs.existsSync(CASES_PATH)) return [];
  return fs
    .readFileSync(CASES_PATH, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, idx) => {
      try {
        return JSON.parse(l);
      } catch (e) {
        console.error(`第 ${idx + 1} 行 JSON 解析失败: ${e.message}`);
        return null;
      }
    })
    .filter(Boolean);
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

const pct = (x) => `${(x * 100).toFixed(1)}%`;

function report(title, rows, m) {
  console.log(`\n===== ${title} =====`);
  console.log(
    `样本 ${m.total} 条 | 准确率 ${pct(m.accuracy)} | 精确率 ${pct(m.precision)} | 召回率 ${pct(m.recall)} | F1 ${pct(m.f1)}`
  );
  console.log(`混淆矩阵: TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}`);
  const wrong = rows.filter((r) => r.pred !== r.expected);
  if (!wrong.length) {
    console.log('没有误判。');
    return;
  }
  console.log(`误判 ${wrong.length} 条：`);
  for (const r of wrong) {
    const kind = r.expected === 1 ? '漏杀（应保留被丢弃）' : '误收（应丢弃被保留）';
    console.log(`  [${kind}] id=${r.id} keyword=${r.keyword}`);
    console.log(`     标题: ${r.title}`);
    console.log(`     判定: pred=${r.pred} expected=${r.expected} | ${r.detail || ''}`);
  }
}

const cases = readCases();
if (!cases.length) {
  console.log('用例集为空：请先运行 node tools/eval/autolabel.mjs 生成，或手动补充 tools/eval/cases.jsonl');
  process.exit(0);
}
const list = limit > 0 ? cases.slice(0, limit) : cases;
console.log(`用例 ${list.length} 条${limit ? `（已限制前 ${limit} 条）` : ''}`);

// ---------- 本地闸门 ----------
const localRows = [];
for (const c of list) {
  const settings = { ...(getSettings().relevance || {}), ...(c.settings || {}) };
  const inputs = relevanceInputsFor(c.keyword);
  if (c.pipeline === 'account') {
    localRows.push({
      ...c,
      pred: 1,
      detail: '账号型关键词：由 mentions 过滤处理，闸门不介入',
    });
    continue;
  }
  if (c.aiOnly) {
    localRows.push({ ...c, pred: 1, skipMetric: true, detail: '本地闸门不具备真伪判定能力，不计入本地指标' });
    continue;
  }
  const g = gate({ title: c.title, summary: c.summary, source: c.source }, c.keyword, settings, inputs.variants);
  localRows.push({
    ...c,
    pred: g.keep ? 1 : 0,
    detail: `gate=${g.reason} cov=${g.coverage} variant=${g.hitVariant || '-'} matched=[${g.matched.join(',')}]`,
  });
  if (verbose) console.log(`  ${g.keep ? 'KEEP' : 'DROP'} ${c.id} :: ${c.title.slice(0, 40)} :: ${g.reason} cov=${g.coverage}`);
}
const localScored = localRows.filter((r) => !r.skipMetric);
const localM = metrics(localScored);
report(`本地相关性闸门（免费、确定性；参加统计 ${localScored.length}/${localRows.length} 条）`, localScored, localM);

// ---------- AI 判定 ----------
let aiM = null;
if (useAi) {
  loadSettings();
  if (!aiConfigured()) {
    console.log('\n[跳过 AI 判定] 未配置 OPENROUTER_API_KEY');
  } else {
    const { judge } = await import('../../server/ai.js');
    const aiRows = [];
    for (const c of list) {
      const settings = { ...(getSettings().relevance || {}), ...(c.settings || {}) };
      const inputs = relevanceInputsFor(c.keyword);
      const item = { title: c.title, summary: c.summary, source: c.source || 'websearch', url: 'https://example.com/' + c.id };
      const rel = evaluateItem(item, c.keyword, settings, inputs.variants);
      const j = await judge(item, c.keyword, {
        variants: inputs.variants,
        aliases: inputs.aliases,
        relevance: rel,
        strict: true,
      });
      const pred = j.verdict === 'unrelated' ? 0 : j.related === 1 ? 1 : 0;
      aiRows.push({
        ...c,
        pred,
        detail: `verdict=${j.verdict} related=${j.related} cov=${j.coverage} model=${j.model} why=${String(j.why || '').slice(0, 40)}`,
      });
      if (verbose) console.log(`  ${pred ? 'KEEP' : 'DROP'} ${c.id} :: ${j.verdict} :: ${String(j.why || '').slice(0, 60)}`);
    }
    aiM = metrics(aiRows);
    report('AI 判定（含真伪与相关性的联合判定）', aiRows, aiM);
    const localById = new Map(localRows.map((r) => [r.id, r]));
    const disagree = aiRows.filter((r) => {
      const l = localById.get(r.id);
      return l && !l.skipMetric && r.pred !== l.pred;
    }).length;
    console.log(`\n本地闸门与 AI 判定不一致 ${disagree} 条（不一致未必是错，需人工抽查）`);
  }
}

// ---------- 结论 ----------
loadSettings();
if (failUnder > 0) {
  const worst = aiM ? Math.min(localM.accuracy, aiM.accuracy) : localM.accuracy;
  if (worst < failUnder) {
    console.log(`\n[未达标] 最低准确率 ${pct(worst)} < 阈值 ${pct(failUnder)}`);
    process.exit(1);
  }
  console.log(`\n[达标] 最低准确率 ${pct(worst)} >= 阈值 ${pct(failUnder)}`);
}
