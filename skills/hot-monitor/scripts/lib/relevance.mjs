// 本地相关性闸门 + 查询扩展（自包含，无第三方依赖）
//
// 两个职责：
//   1) 判断一条内容是否真的在讲某个关键词（命中关键词本身或其等价叫法）
//   2) 为一个关键词生成等价叫法（词序调整、加减修饰词、中英边界等），
//      既用于扩大检索，也用于放行"换个说法"的合理内容
//
// 设计要点：中文没有空格，且常用助词"的/之"会让字面匹配漏掉合理内容，
// 所以匹配前先做 squash()：去助词 + 去空格 + 全角转半角 + 小写。

// ---------- 文本归一化 ----------

const CJK = '\u4e00-\u9fff';

export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1\u0001$2') // 保护小数（4.6 不能被拆成 4 和 6）
    .replace(new RegExp(`[^0-9a-z${CJK}\\u0001]+`, 'g'), ' ')
    .replace(/\u0001/g, '.')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normCompact(s) {
  return normText(s).replace(/ /g, '');
}

// 去掉助词后再压缩，使「鱼皮的AI导航」「鱼皮AI导航」「AI导航鱼皮」可比
const PARTICLES = /[\u7684\u4e4b]/g; // 的 之
export function squash(s) {
  return normCompact(s).replace(PARTICLES, '');
}

const STOPWORDS = new Set([
  '\u7684', '\u4e0e', '\u548c', '\u4e86', '\u662f', '\u7248', '\u7cfb\u5217',
  '\u8f6f\u4ef6', '\u6a21\u578b', '\u53d1\u5e03', 'the', 'a', 'an', 'of', 'and',
  'for', 'to', 'in', 'on', 'with', 'vs', 'version', 'model', 'release',
]);

// 关键词 -> { raw, entities }
// 实体词是"必须命中"的最小单元：Claude Sonnet 4.6 -> [claude, sonnet, 4.6]
export function parseKeyword(keyword) {
  const raw = String(keyword || '').trim();
  const normalized = normText(raw);
  const entities = [];
  for (const tok of normalized.split(' ')) {
    if (!tok || STOPWORDS.has(tok) || entities.includes(tok)) continue;
    entities.push(tok);
  }
  if (!entities.length && normalized) entities.push(normalized);
  return { raw, normalized, entities };
}

// ---------- 闸门规则 ----------

export const DEFAULT_RULES = {
  minCoverage: 1, // 需要命中多少比例的实体词（1 = 全部）
  dropBelowMin: true,
  aliases: {}, // 实体别名：{"claude":["anthropic","克劳德"]}
  excludeTerms: [], // 出现即丢弃
  mustInclude: [], // 必须全部出现
};

export function normalizeRules(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const mc = Number(s.minCoverage);
  return {
    minCoverage: Number.isFinite(mc) ? Math.max(0, Math.min(1, mc)) : 1,
    dropBelowMin: s.dropBelowMin !== false,
    aliases: s.aliases && typeof s.aliases === 'object' ? s.aliases : {},
    excludeTerms: Array.isArray(s.excludeTerms) ? s.excludeTerms.filter((x) => typeof x === 'string') : [],
    mustInclude: Array.isArray(s.mustInclude) ? s.mustInclude.filter((x) => typeof x === 'string') : [],
  };
}

function hitTerm(haySquashed, term, aliases) {
  if (!term) return false;
  const variants = [term];
  const extra = aliases[term];
  if (Array.isArray(extra)) for (const e of extra) if (typeof e === 'string' && e.trim()) variants.push(e);
  for (const v of variants) {
    const nv = squash(v);
    if (nv && haySquashed.includes(nv)) return v;
  }
  return false;
}

// 评估一条内容与关键词的相关性
// 返回 { coverage, matched, missing, level, excluded, mustMissing, hitVariant, entities }
export function evaluate(item, keyword, rules, variants) {
  const s = normalizeRules(rules);
  const { entities } = parseKeyword(keyword);
  const title = normText(item && item.title);
  const summary = normText(item && item.summary);
  const author = normText(item && item.author);
  const hay = squash(`${title} ${summary}`);
  const all = squash(`${title} ${summary} ${author}`);

  const excluded = s.excludeTerms
    .map((t) => String(t).trim())
    .filter(Boolean)
    .find((t) => all.includes(squash(t)));

  const mustMissing = s.mustInclude
    .map((t) => String(t).trim())
    .filter(Boolean)
    .filter((t) => !all.includes(squash(t)));

  const matched = [];
  const missing = [];
  for (const e of entities) {
    if (hitTerm(hay, e, s.aliases)) matched.push(e);
    else missing.push(e);
  }

  const varPairs = (Array.isArray(variants) ? variants : [])
    .map((v) => ({ raw: String(v || '').trim(), sq: squash(v) }))
    .filter((p) => p.raw && p.sq && p.sq.length >= 2);
  const hitPair = varPairs.find((p) => hay.includes(p.sq));
  const hitVariant = hitPair ? hitPair.raw : '';

  const phrase = squash(keyword);
  const containsPhrase = phrase.length > 1 && hay.includes(phrase);

  let coverage = entities.length === 0 ? 1 : matched.length / entities.length;
  if (containsPhrase) coverage = 1;
  if (hitVariant) coverage = Math.max(coverage, 1);
  coverage = Math.round(coverage * 100) / 100;

  let level = 'partial';
  if (excluded || mustMissing.length || coverage === 0) level = 'none';
  else if (coverage >= 1) level = 'strong';

  return { coverage, matched, missing, level, excluded: excluded || '', mustMissing, hitVariant, containsPhrase, entities };
}

// 闸门判定：是否保留 + 原因
export function gate(item, keyword, rules, variants) {
  const s = normalizeRules(rules);
  const r = evaluate(item, keyword, s, variants);
  if (r.excluded) return { keep: false, reason: 'excluded', ...r };
  if (r.mustMissing.length) return { keep: false, reason: 'must-include-missing', ...r };
  if (r.coverage === 0) return { keep: false, reason: 'no-term', ...r };
  if (s.dropBelowMin && r.coverage < s.minCoverage) return { keep: false, reason: 'low-coverage', ...r };
  return { keep: true, reason: 'ok', ...r };
}

// 领域级轻量过滤：只应用排除词/必须词（领域话题宽泛，不做覆盖度门槛）
export function exclusionGate(item, rules) {
  const s = normalizeRules(rules);
  const all = squash(`${(item && item.title) || ''} ${(item && item.summary) || ''} ${(item && item.author) || ''}`);
  const excluded = s.excludeTerms.map((t) => String(t).trim()).filter(Boolean).find((t) => all.includes(squash(t)));
  if (excluded) return { keep: false, reason: 'excluded', excluded };
  const mustMissing = s.mustInclude.map((t) => String(t).trim()).filter(Boolean).filter((t) => !all.includes(squash(t)));
  if (mustMissing.length) return { keep: false, reason: 'must-include-missing', mustMissing };
  return { keep: true, reason: 'ok' };
}

// ---------- 查询扩展（本地规则，确定性、免费） ----------

const MODIFIERS = ['\u7a0b\u5e8f\u5458', '\u5b98\u65b9', '\u6700\u65b0', '\u65b0\u7248', '\u5168\u65b0', '\u70ed\u95e8', '\u77e5\u540d', '\u56fd\u4ea7', '\u5f00\u6e90']; // 程序员/官方/最新/新版/全新/热门/知名/国产/开源
const PARTICLES_LIST = ['\u7684', '\u4e4b', '\u4e0e', '\u548c']; // 的/之/与/和
const SEPARATORS = [' ', '\u3000', ',', '\uff0c', '\u3001', '/', '|', '\\', '-', '_', '+', '\u00b7', '\u2022', '\uff1a', ':', '\u300a', '\u300b', '\u300c', '\u300d', '(', ')', '\uff08', '\uff09'];
const VERSION_RE = /^v?\d+(\.\d+)*$/;
const CJK_START = new RegExp(`^[${CJK}]`);

function splitParts(keyword) {
  let s = String(keyword || '').trim();
  for (const p of PARTICLES_LIST) s = s.split(p).join(' ');
  for (const sep of SEPARATORS) s = s.split(sep).join(' ');
  return s.split(/\s+/).filter(Boolean);
}

function splitBoundary(part) {
  const out = [];
  let cur = '';
  let curCjk = null;
  for (const ch of part) {
    const isCjk = new RegExp(`[${CJK}]`).test(ch);
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

// DeepSeek -> Deep Seek；GPT4 -> GPT 4
function splitCamel(part) {
  const out = [];
  for (const seg of String(part || '').split(/(?<=[a-z\d])(?=[A-Z])|(?<=[a-zA-Z])(?=\d)|(?<=\d)(?=[a-zA-Z])/)) {
    if (seg) out.push(seg);
  }
  return out.length > 1 ? out : [part];
}

function cleanKeyword(keyword) {
  let s = String(keyword || '').trim();
  for (const m of MODIFIERS) {
    if (s.startsWith(m) && s.length > m.length + 1) s = s.slice(m.length);
  }
  for (const p of PARTICLES_LIST) s = s.split(p).join('');
  return s.trim();
}

// 生成同义/等价叫法。经验规则（实测有效）：
//   鱼皮的AI导航 -> 鱼皮AI导航 / AI导航鱼皮 / 程序员鱼皮AI导航
//   Claude Sonnet 4.6 -> Claude Sonnet / Sonnet 4.6
// 注意避免生成"裸实体"（如只有 Sonnet），否则会把无关内容判为强相关。
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
    // 顺序很重要：先给"信息量不丢"的写法，再给反转写法
    // （检索时取第一个可用变体，反转出来的词作搜索词效果很差）
    push(g.join(' '));
    push(g.join(''));
    // 去版本号（Claude Sonnet 4.6 -> Claude Sonnet）
    if (g.length >= 3 && VERSION_RE.test(g[g.length - 1])) {
      const noVer = g.slice(0, -1);
      push(noVer.join(' '));
      push(noVer.join(''));
    }
    // 去开头的纯 ASCII 厂商前缀（Claude Sonnet 4.6 -> Sonnet 4.6）
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
    // 中文起始：加修饰词（程序员鱼皮的AI导航）
    if (CJK_START.test(g[0])) {
      for (const m of MODIFIERS) push(m + g.join(''));
    }
    // 词序调整放最后（信息量相同但检索效果差）
    push(rev.join(' '));
    push(rev.join(''));
    for (let i = 1; i < g.length; i++) {
      push(g.slice(i).join('') + g.slice(0, i).join(''));
      push(g.slice(i).join(' ') + ' ' + g.slice(0, i).join(' '));
    }
  }
  return out;
}

// 选取适合直接拿去检索的变体。
// 打分规则（实测）：实体覆盖越全越好，且"词序未被反转"的写法更接近真实检索习惯；
// 例：Claude Sonnet 4.6 -> 优先 "Claude Sonnet" / "Sonnet 4.6"，
//     而不是信息等价但检索效果很差的 "4.6 Sonnet Claude"。
export function searchQueries(keyword, extraVariants, maxExtra = 2) {
  const raw = String(keyword || '').trim();
  const cap = Math.max(0, Number(maxExtra) || 0);
  if (!raw || cap === 0) return [];
  const ents = parseKeyword(raw).entities;

  // 词序是否未被反转（缺失的实体不参与判断）
  const orderPreserved = (compactSquashed) => {
    let prev = -1;
    let seen = 0;
    for (const e of ents) {
      const at = compactSquashed.indexOf(squash(e));
      if (at < 0) continue;
      if (at < prev) return false;
      prev = at;
      seen++;
    }
    return seen >= 1;
  };

  const candidates = [];
  for (const [index, v] of [...(extraVariants || []), ...localVariants(raw)].entries()) {
    const text = String(v || '').trim();
    if (!text) continue;
    const nv = normText(text);
    if (normCompact(text) === normCompact(raw)) continue;
    if (nv.length < 3 || nv.length > 28) continue;
    const compact = nv.replace(/ /g, '');
    const compactSquashed = squash(text);
    const covered = ents.filter((e) => compactSquashed.includes(squash(e))).length;
    if (ents.length && covered === 0) continue;
    const score = (covered === ents.length ? 2 : 1) + (orderPreserved(compactSquashed) ? 2 : 0);
    if (score < 3) continue; // 信息完整但词序被反转的写法，作检索词效果很差
    candidates.push({ text, nv, compact, score, index });
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const pick = [];
  for (const c of candidates) {
    if (pick.length >= cap) break;
    if (pick.some((x) => normCompact(x) === normCompact(c.text) || normText(x).includes(c.nv))) continue;
    pick.push(c.text);
  }
  return pick;
}
