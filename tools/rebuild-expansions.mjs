// 重建查询扩展缓存：按当前生效的关键词重算本地变体（规则调整或缓存被污染后使用）
//
// 用法：node tools/rebuild-expansions.mjs [--keep-ai]

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(ROOT, 'data', 'expansions.json');
const DB = path.join(ROOT, 'data', 'hotmonitor.db');
const keepAi = process.argv.includes('--keep-ai');

const { localVariants } = await import('../server/expand.js');

const db = new Database(DB, { readonly: true });
const kws = db.prepare('SELECT name FROM keywords WHERE enabled=1').all().map((r) => r.name);
db.close();

let prev = {};
try {
  if (keepAi && fs.existsSync(CACHE)) prev = JSON.parse(fs.readFileSync(CACHE, 'utf8')) || {};
} catch (e) {
  prev = {};
}

const out = {};
for (const k of kws) {
  const old = prev[k] || {};
  out[k] = {
    local: localVariants(k),
    ai: Array.isArray(old.ai) ? old.ai : [],
    aliases: old.aliases || {},
    model: old.model || '',
    at: new Date().toISOString(),
  };
  console.log(`${k}: ${out[k].local.length} 个本地变体${out[k].ai.length ? ` + ${out[k].ai.length} 个 AI 变体` : ''}`);
}
fs.writeFileSync(CACHE, JSON.stringify(out, null, 2), 'utf8');
console.log(`\n已重建 ${Object.keys(out).length} 个关键词的扩展缓存：${path.relative(ROOT, CACHE)}`);
