// AI 自动标注：从数据库抽样真实条目，用“严格标注员”提示词打相关性标签，扩充回归用例集
//
// 用法：
//   node tools/eval/autolabel.mjs --limit 20         # 抽样 20 条（会消耗 AI 额度）
//   node tools/eval/autolabel.mjs --limit 20 --dry   # 只打印结果，不写入文件
//   node tools/eval/autolabel.mjs --limit 20 --trends # 从热点榜抽样而不是关键词信号
//
// 说明：标注只判断“是否与关键词强相关”，不判断真伪；已存在的用例（关键词+标题相同）会自动跳过。

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CASES_PATH = path.join(__dirname, 'cases.jsonl');
const DB_PATH = path.join(ROOT, 'data', 'hotmonitor.db');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : d;
};
const limit = Math.max(1, Number(opt('--limit', '15')) || 15);
const dry = flag('--dry');
const fromTrends = flag('--trends');

const { aiConfigured, askJson } = await import('../../server/ai.js');
if (!aiConfigured()) {
  console.log('未配置 OPENROUTER_API_KEY：无法自动标注。');
  process.exit(0);
}
if (!fs.existsSync(DB_PATH)) {
  console.log(`数据库不存在：${DB_PATH}`);
  process.exit(0);
}

const db = new Database(DB_PATH, { readonly: true });

function sampleSignals() {
  const rows = db
    .prepare(
      `SELECT k.name AS keyword, s.title, s.summary, s.source, s.verdict, s.related, s.published_at
       FROM signals s JOIN keywords k ON k.id = s.keyword_id
       WHERE s.title IS NOT NULL AND length(s.title) > 3
       ORDER BY s.id DESC LIMIT 400`
    )
    .all();
  return rows;
}

function sampleTrends() {
  const rows = db
    .prepare(
      `SELECT scope AS keyword, title, summary, source, 'trend' AS verdict, NULL AS related, published_at
       FROM trends WHERE title IS NOT NULL ORDER BY heat DESC, id DESC LIMIT 400`
    )
    .all();
  return rows;
}

function pickEvenly(rows, n) {
  if (rows.length <= n) return rows;
  const step = rows.length / n;
  const out = [];
  for (let i = 0; i < n; i++) out.push(rows[Math.floor(i * step)]);
  return out;
}

function readKeys() {
  const keys = new Set();
  if (!fs.existsSync(CASES_PATH)) return keys;
  for (const line of fs.readFileSync(CASES_PATH, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const c = JSON.parse(t);
      keys.add(`${String(c.keyword).toLowerCase()}||${String(c.title).slice(0, 40).toLowerCase()}`);
    } catch (e) {
      /* 忽略坏行 */
    }
  }
  return keys;
}

const system = `你是严格的相关性标注员。给定“监控关键词”和一条内容，判断该内容是否与关键词强相关（1）还是无关（0）。
判定标准：
- related=1：标题或摘要中出现关键词本身、其等价叫法（含词序调整、加去修饰词、简称全称），或内容确实在讨论同一个对象/产品/话题。
- related=0：仅仅属于同一大类/同一厂商其他产品、蹭词标题党、只有上位类目。宁严不松。
只输出 JSON：{"related":0或1,"why":"不超过30字的判断依据"}`;

const rows = pickEvenly(fromTrends ? sampleTrends() : sampleSignals(), limit);
const keys = readKeys();
const newCases = [];
let skipped = 0;
let mismatch = 0;

for (const r of rows) {
  const key = `${String(r.keyword).toLowerCase()}||${String(r.title).slice(0, 40).toLowerCase()}`;
  if (keys.has(key)) {
    skipped++;
    continue;
  }
  try {
    const res = await askJson(
      system,
      `监控关键词：${r.keyword}\n标题：${r.title}\n摘要：${String(r.summary || '').slice(0, 400)}\n来源：${r.source}`,
      { maxTokens: 200, temperature: 0 }
    );
    const expected = res.related === 1 ? 1 : 0;
    const note = String(res.why || '').slice(0, 60);
    const caseObj = {
      id: `auto-${Date.now()}-${newCases.length}`,
      keyword: r.keyword,
      title: r.title,
      summary: String(r.summary || '').slice(0, 400),
      source: r.source,
      expected,
      note: `AI 自动标注：${note}`,
      labeledBy: 'ai',
      systemVerdict: r.verdict || null,
      systemRelated: r.related ?? null,
    };
    newCases.push(caseObj);
    if (r.related !== null && r.related !== undefined && Number(r.related) !== expected) mismatch++;
    console.log(`${expected === 1 ? '相关  ' : '无关  '} [${r.keyword}] ${String(r.title).slice(0, 46)} :: ${note}`);
  } catch (e) {
    console.log(`标注失败（跳过）：${e.message}`);
  }
}

console.log(`\n抽样 ${rows.length} 条，新增标注 ${newCases.length} 条，跳过重复 ${skipped} 条`);
if (mismatch) console.log(`其中 ${mismatch} 条与系统当时的判定不一致（不一致不一定是标注错，建议人工抽查）`);

if (!newCases.length) process.exit(0);
if (dry) {
  console.log('\n--dry 模式：未写入文件。');
  process.exit(0);
}
fs.appendFileSync(CASES_PATH, newCases.map((c) => JSON.stringify(c)).join('\n') + '\n', 'utf8');
console.log(`已追加到 ${CASES_PATH}`);
