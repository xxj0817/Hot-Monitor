// 查询扩展（Query Expansion）
//
// 目的：严格的关键词匹配会漏掉“换个说法”的合理内容，例如监控《鱼皮的AI导航》时
// 《程序员鱼皮的AI导航》《AI导航鱼皮》《鱼皮AI编程教程》其实都是同一个对象。
// 这里为每个关键词生成变体，变体同时用于两处：
//   1) 信源检索：把变体作为额外搜索词，扩大召回；
//   2) 相关性闸门：命中任意变体即视为“强相关”，不会被误杀。
//
// 变体来源：本地规则（免费、确定性）+ AI 扩展（可选，结果缓存到 data/expansions.json）

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { aiExpand } from './ai.js';
import { normText, normCompact, parseKeyword } from './relevance.js';

const CACHE_PATH = path.join(DATA_DIR, 'expansions.json');

// 允许作为“修饰语”被前置/剥离的词
const MODIFIERS = ['程序员', '官方', '最新', '新版', '全新', '热门', '知名', '国产', '开源'];
// 需要从变体中剥离的助词
const PARTICLES = ['的', '之', '与', '和'];
const SEPARATORS = [' ', '\u3000', ',', '，', '、', '/', '|', '\\', '-', '_', '+', '·', '??', '：', ':', '《', '》', '「', '」', '(', ')', '（', '）'];

function splitParts(keyword) {
  let s = String(keyword || '').trim();
  for (const p of PARTICLES) s = s.split(p).join(' ');
  for (const sep of SEPARATORS) s = s.split(sep).join(' ');
  return s.split(/\s+/).filter(Boolean);
}

// 仅按“中文/ASCII 边界”切分，处理“鱼皮AI导航”这类无分隔写法
function splitBoundary(part) {
  const out = [];
  let cur = '';
  let curCjk = null;
  for (const ch of part) {
    const isCjk = /[\u4e00-\u9fff]/.test(ch);
    if (curCjk === null) curCjk = isCjk;
    if (isCjk !== curCjk) {
      out.push(cur);
      cur = '';
      curCjk = isCjk;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// 驼峰/连写拆分：DeepSeek -> Deep Seek，GPT4 -> GPT 4（只在大小写交界或数字交界处切）
function splitCamel(part) {
  const out = [];
  for (const seg of String(part || '').split(/(?<=[a-z\d])(?=[A-Z])|(?<=[a-zA-Z])(?=\d)|(?<=\d)(?=[a-zA-Z])/)) {
    if (seg) out.push(seg);
  }
  return out.length > 1 ? out : [part];
}

const VERSION_RE = /^v?\d+(\.\d+)*$/;
const CJK_START = /^[\u4e00-\u9fff]/;

function cleanKeyword(keyword) {
  let s = String(keyword || '').trim();
  for (const m of MODIFIERS) {
    if (s.startsWith(m) && s.length > m.length + 1) s = s.slice(m.length);
  }
  for (const p of PARTICLES) s = s.split(p).join('');
  return s.trim();
}

// 本地规则扩展：免费、确定性，覆盖常见改写（换序、去修饰、加修饰、去助词、中英边界、驼峰拆分）
export function localVariants(keyword) {
  const raw = String(keyword || '').trim();
  if (!raw) return [];
  const out = [];
  const seen = new Set([normCompact(raw)]);
  const push = (v) => {
    const t = String(v || '').trim();
    if (!t || out.length >= 14) return;
    const key = normCompact(t);
    if (!key || key.length < 2 || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };

  const rawParts = splitParts(raw);
  const core = cleanKeyword(raw);
  const groups = [];
  const decompose = (parts) => {
    const outParts = [];
    for (const p of parts) {
      const boundary = splitBoundary(p);
      if (boundary.length > 1) outParts.push(...boundary);
      else outParts.push(...splitCamel(p));
    }
    return outParts;
  };
  if (rawParts.length > 1) groups.push(decompose(rawParts));
  else {
    const b = decompose(rawParts);
    if (b.length > 1) groups.push(b);
  }
  if (core && normCompact(core) !== normCompact(raw)) {
    push(core);
    const d = decompose(splitParts(core));
    if (d.length > 1) groups.push(d);
  }

  for (const g of groups) {
    if (g.length < 2) continue;
    const rev = [...g].reverse();
    // 带空格写法优先（更接近搜索引擎习惯）
    push(g.join(' '));
    push(rev.join(' '));
    push(g.join(''));
    push(rev.join(''));
    // 去掉版本号后缀（Claude Sonnet 4.6 -> Claude Sonnet）；
    // 剩余部分至少两个词才做，避免退化成“裸实体”（GPT-6 -> GPT）
    if (g.length >= 3 && VERSION_RE.test(g[g.length - 1])) {
      const noVer = g.slice(0, -1);
      push(noVer.join(' '));
      push(noVer.join(''));
    }
    // 去掉开头的厂商/作者前缀（Claude Sonnet 4.6 -> Sonnet 4.6）：
    // 仅当前缀是纯 ASCII 时启用（中文前缀如“鱼皮”是对象名的一部分，不能丢），
    // 且剩余部分至少还要有两个词，避免退化成“裸实体”（Sonnet）而放过无关内容
    if (g.length >= 3 && /^[\x20-\x7F]+$/.test(g[0])) {
      const tail = g.slice(1);
      push(tail.join(' '));
      push(tail.join(''));
      if (tail.length >= 3 && VERSION_RE.test(tail[tail.length - 1])) {
        const tv = tail.slice(0, -1);
        push(tv.join(' '));
        push(tv.join(''));
      }
    }
    // 修饰词前缀仅对中文起始的写法有意义（程序员鱼皮的AI导航）
    if (CJK_START.test(g[0])) {
      for (const m of MODIFIERS) push(m + g.join(''));
    }
    for (let i = 1; i < g.length; i++) {
      push(g.slice(i).join('') + g.slice(0, i).join(''));
      push(g.slice(i).join(' ') + ' ' + g.slice(0, i).join(' '));
    }
  }
  return out;
}

function readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return {};
    const j = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch (e) {
    return {};
  }
}

function writeCache(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.warn('[expand] 缓存写入失败:', e.message);
  }
}

function mergeAliases(a, b) {
  const out = {};
  for (const src of [a, b]) {
    if (!src || typeof src !== 'object') continue;
    for (const k of Object.keys(src)) {
      const list = Array.isArray(src[k]) ? src[k].filter((x) => typeof x === 'string' && x.trim()) : [];
      if (!list.length) continue;
      out[normText(k)] = [...new Set([...(out[normText(k)] || []), ...list])];
    }
  }
  return out;
}

// 同步读取：本地变体 + 缓存中的 AI 变体
export function getExpansion(keyword) {
  const raw = String(keyword || '').trim();
  const local = localVariants(raw);
  const cache = readCache();
  const hit = raw ? cache[raw] : null;
  const ai = hit && Array.isArray(hit.ai) ? hit.ai : [];
  const aliases = (hit && hit.aliases) || {};
  return {
    keyword: raw,
    local,
    ai,
    aliases,
    variants: [...new Set([...local, ...ai])],
    updatedAt: (hit && hit.at) || '',
    fromAi: ai.length > 0,
  };
}

// 生成（或刷新）某关键词的扩展：本地规则总是重建；AI 变体按需调用并缓存
export async function expandKeyword(keyword, { refresh = false, useAi = true } = {}) {
  const raw = String(keyword || '').trim();
  if (!raw) return { keyword: '', local: [], ai: [], aliases: {}, variants: [] };
  const cache = readCache();
  const prev = cache[raw] || {};
  const local = localVariants(raw);
  let ai = Array.isArray(prev.ai) ? prev.ai : [];
  let aliases = prev.aliases || {};
  let model = prev.model || '';
  if (useAi && (refresh || !ai.length)) {
    try {
      const r = await aiExpand(raw);
      const got = Array.isArray(r.variants) ? r.variants : [];
      if (got.length) {
        ai = [...new Set(got.map((x) => String(x || '').trim()).filter(Boolean))]
          .filter((v) => normCompact(v) !== normCompact(raw))
          .slice(0, 8);
        aliases = mergeAliases(prev.aliases, r.aliases);
        model = r.model || model;
      }
    } catch (e) {
      console.warn(`[expand] AI 扩展失败（保留本地变体）: ${e.message}`);
    }
  }
  const rec = { local, ai, aliases, model, at: new Date().toISOString() };
  cache[raw] = rec;
  writeCache(cache);
  return { keyword: raw, ...rec, variants: [...new Set([...local, ...ai])], fromAi: ai.length > 0 };
}

// 供相关性闸门使用：变体列表 + 实体别名
export function relevanceInputsFor(keyword) {
  const e = getExpansion(keyword);
  return { variants: e.variants, aliases: e.aliases };
}

// 供检索使用：在原关键词之外追加少量高价值变体（AI 变体优先，更接近真实检索词）
// 只保留“包含全部关键词实体”的变体，避免拼出无法检索的怪词
export function searchQueriesFor(keyword, maxExtra = 2) {
  const raw = String(keyword || '').trim();
  const cap = Math.max(0, Number(maxExtra) || 0);
  if (!raw || cap === 0) return [];
  const e = getExpansion(raw);
  const ents = parseKeyword(raw).entities.map((x) => x);
  const pick = [];
  for (const v of [...e.ai, ...e.local]) {
    if (pick.length >= cap) break;
    const nv = normText(v);
    if (normCompact(v) === normCompact(raw)) continue;
    if (nv.length < 3 || nv.length > 28) continue;
    const squashed = nv.replace(/ /g, '');
    if (ents.length && !ents.every((x) => squashed.includes(String(x).replace(/ /g, '')))) continue;
    if (pick.some((x) => normCompact(x) === normCompact(v) || normText(x).includes(nv))) continue;
    pick.push(v);
  }
  return pick;
}

export function listExpansions() {
  const cache = readCache();
  const out = {};
  for (const k of Object.keys(cache)) {
    const e = getExpansion(k);
    out[k] = { local: e.local, ai: e.ai, aliases: e.aliases, updatedAt: e.updatedAt };
  }
  return out;
}

export function clearExpansion(keyword) {
  const raw = String(keyword || '').trim();
  const cache = readCache();
  if (cache[raw]) {
    delete cache[raw];
    writeCache(cache);
    return true;
  }
  return false;
}

// 关键词分词的对外便捷导出（闸门/评测共用）
export { parseKeyword };
