// Keyword relevance gate (pure local rules, no AI calls).
//
// Goal: drop candidate items that do not actually mention the monitored keyword
// BEFORE spending an AI judgement call, and give the AI a cheap local signal
// (coverage / matched terms) to work with.
//
// Rules (settings.relevance):
//   minCoverage : 0..1, how many keyword entities must appear (default 1 = all)
//   dropBelowMin: when true, items below minCoverage are dropped without AI
//   aliases     : { entity: [alt, ...] } extra spellings that count as a hit
//   excludeTerms: if any term appears in the text the item is dropped outright
//   mustInclude : every term here must appear in the text
//
// Everything in this file is ASCII: CJK stop words are written as \uXXXX.

const STOPWORDS = new Set([
  '\u7684', '\u4e0e', '\u548c', '\u4e86', '\u662f', '\u7248', '\u7cfb\u5217',
  '\u8f6f\u4ef6', '\u6a21\u578b', '\u53d1\u5e03', 'the', 'a', 'an', 'of', 'and',
  'for', 'to', 'in', 'on', 'with', 'vs', 'version', 'model', 'release',
]);

export const DEFAULT_RELEVANCE = {
  minCoverage: 1,
  dropBelowMin: true,
  aliases: {},
  excludeTerms: [],
  mustInclude: [],
};

export function relevanceSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const num = Number(s.minCoverage);
  return {
    minCoverage: Number.isFinite(num) ? Math.max(0, Math.min(1, num)) : DEFAULT_RELEVANCE.minCoverage,
    dropBelowMin: s.dropBelowMin === undefined ? true : s.dropBelowMin === true,
    aliases: s.aliases && typeof s.aliases === 'object' ? s.aliases : {},
    excludeTerms: Array.isArray(s.excludeTerms) ? s.excludeTerms.filter((x) => typeof x === 'string') : [],
    mustInclude: Array.isArray(s.mustInclude) ? s.mustInclude.filter((x) => typeof x === 'string') : [],
  };
}

// Lowercase, unify full-width chars, strip punctuation so "Claude  Sonnet" and
// "claude sonnet" match, while decimals such as "4.6" survive as one token.
export function normText(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[\u3000]/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1\u0001$2') // protect decimal point
    .replace(/[^0-9a-z\u4e00-\u9fff\u0001]+/g, ' ')
    .replace(/\u0001/g, '.')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normCompact(s) {
  return normText(s).replace(/ /g, '');
}

// Compact form with CJK particles removed, so "鱼皮的AI导航" and "鱼皮AI导航"
// and "AI导航鱼皮" all collapse to comparable strings.
const PARTICLES = /[\u7684\u4e4b]/g; // 的 之
export function squash(s) {
  return normCompact(s).replace(PARTICLES, '');
}

// Split a keyword into entity terms (used for coverage) and remember the full
// phrase so an exact phrase hit can short-circuit to full coverage.
export function parseKeyword(keyword) {
  const raw = String(keyword || '').trim();
  const normalized = normText(raw);
  const phrase = normCompact(raw);
  const entities = [];
  for (const tok of normalized.split(' ')) {
    if (!tok) continue;
    if (STOPWORDS.has(tok)) continue;
    if (entities.includes(tok)) continue;
    entities.push(tok);
  }
  // numeric tails like "4.6" survive; a keyword made only of stopwords keeps one term
  if (entities.length === 0 && normalized) entities.push(normalized);
  return { raw, normalized, phrase, entities };
}

function hit(text, term, aliases) {
  if (!term) return false;
  const variants = [term];
  const extra = aliases[term];
  if (Array.isArray(extra)) for (const e of extra) if (typeof e === 'string' && e.trim()) variants.push(e);
  for (const v of variants) {
    const nv = squash(v);
    if (!nv) continue;
    if (text.includes(nv)) return v;
  }
  return false;
}

// Evaluate one candidate item against the keyword.
// `variants` are query-expansion variants: hitting any of them counts as a full
// coverage match, which is what keeps reworded-but-relevant content alive.
// Returns { coverage, matched, missing, level, excluded, containsPhrase, mustMissing, hitVariant }
export function evaluateItem(item, keyword, settings, variants) {
  const s = relevanceSettings(settings);
  const { entities } = parseKeyword(keyword);
  const title = normText(item && item.title);
  const summary = normText(item && item.summary);
  const author = normText(item && item.author);
  const hay = `${title} ${summary}`;
  const hayCompact = squash(hay);
  const all = `${title} ${summary} ${author}`;

  const excluded = s.excludeTerms
    .map((t) => String(t).trim())
    .filter(Boolean)
    .find((t) => squash(all).includes(squash(t)));

  const mustMissing = s.mustInclude
    .map((t) => String(t).trim())
    .filter(Boolean)
    .filter((t) => squash(all).includes(squash(t)) === false);

  const matched = [];
  const missing = [];
  for (const e of entities) {
    if (hit(hayCompact, e, s.aliases)) matched.push(e);
    else missing.push(e);
  }

  const varList = Array.isArray(variants) ? variants.map(squash).filter((v) => v && v.length >= 2) : [];
  const hitVariant = (varList.find((v) => hayCompact.includes(v)) || '').trim();

  const phrase = squash(keyword);
  const containsPhrase = phrase.length > 1 && hayCompact.includes(phrase);
  let coverage = entities.length === 0 ? 1 : matched.length / entities.length;
  if (containsPhrase) coverage = 1;
  if (hitVariant) coverage = Math.max(coverage, 1);

  let level = 'partial';
  if (excluded || mustMissing.length || coverage === 0) level = 'none';
  else if (coverage >= 1) level = 'strong';

  return {
    coverage: Math.round(coverage * 100) / 100,
    matched,
    missing,
    level,
    excluded: excluded || '',
    mustMissing,
    containsPhrase,
    hitVariant,
    entities,
  };
}

// Gate decision for the watcher: keep / drop (+ why).
export function gate(item, keyword, settings, variants) {
  const s = relevanceSettings(settings);
  const r = evaluateItem(item, keyword, s, variants);
  if (r.excluded) return { keep: false, reason: 'excluded', ...r };
  if (r.mustMissing.length) return { keep: false, reason: 'must-include-missing', ...r };
  if (r.coverage === 0) return { keep: false, reason: 'no-term', ...r };
  if (s.dropBelowMin && r.coverage < s.minCoverage) return { keep: false, reason: 'low-coverage', ...r };
  return { keep: true, reason: 'ok', ...r };
}

// Lightweight gate for domain-level feeds (trend radar): only applies the user's
// exclude / must-include words. Coverage thresholds make no sense for broad
// topics such as "AI \u7f16\u7a0b", so those are skipped here.
export function exclusionGate(item, settings) {
  const s = relevanceSettings(settings);
  const all = squash(`${(item && item.title) || ''} ${(item && item.summary) || ''} ${(item && item.author) || ''}`);
  const excluded = s.excludeTerms
    .map((t) => String(t).trim())
    .filter(Boolean)
    .find((t) => all.includes(squash(t)));
  if (excluded) return { keep: false, reason: 'excluded', excluded };
  const mustMissing = s.mustInclude
    .map((t) => String(t).trim())
    .filter(Boolean)
    .filter((t) => all.includes(squash(t)) === false);
  if (mustMissing.length) return { keep: false, reason: 'must-include-missing', mustMissing };
  return { keep: true, reason: 'ok' };
}

// Highlight helper for the UI: returns the terms that should be emphasised.
export function highlightTerms(keyword, settings) {
  const s = relevanceSettings(settings);
  const { entities } = parseKeyword(keyword);
  const out = [];
  for (const e of entities) {
    out.push(e);
    const extra = s.aliases[e];
    if (Array.isArray(extra)) for (const x of extra) if (typeof x === 'string' && x.trim()) out.push(normText(x));
  }
  return [...new Set(out.filter(Boolean))].sort((a, b) => b.length - a.length);
}
