// Cross-engine corroboration helpers (pure ASCII).
// Goal: count how many independent sources/engines surfaced the same story,
// so low-quality single-source hits can be down-weighted or skipped.

const TRACK_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid',
  'igshid', 'ref_src', 'ref_url', 'spm', 'from', 'from_id', 'source',
  'yclid', 'wickedid', '_hsenc', '_hsmi', 'vero_id', 'campaign_id',
  'ivk_sa', 'ivk_sch', 'sessionid', 'scene', 'sub_channel', 'k', 'w',
]);

// Normalize a URL for cross-engine dedupe: lowercase host, strip hash &
// tracking params, drop trailing slash, drop www.
export function normUrl(url) {
  try {
    const u = new URL(String(url));
    const keep = [];
    for (const [k, v] of u.searchParams) {
      if (!TRACK_PARAMS.has(k.toLowerCase())) keep.push([k, v]);
    }
    let out = `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
    if (keep.length) {
      const q = keep
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .sort()
        .join('&');
      out += '?' + q;
    }
    return out.toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

// Normalize a title for fuzzy cross-engine matching (letters/digits/CJK only).
export function normTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '')
    .trim();
}

// The source bucket of an item (web engine id, twitter, mock).
function bucketOf(it) {
  const s = String((it && it.source) || '');
  return s === 'twitter' || s === 'mock' || !s ? s || '?' : s;
}

// Annotate each item with extra.engineCount / extra.corroborated /
// extra.corroborators by cross-source matching. Matching is URL-first
// (normalized URL), then normalized-title fallback for single-URL items.
export function corroborate(items) {
  const list = Array.isArray(items) ? items : [];
  const byUrl = new Map();
  const byTitle = new Map();
  const recs = [];

  for (const it of list) {
    const u = normUrl(it.url);
    const t = normTitle(it.title);
    const rec = { it, u, t, srcs: new Set() };
    recs.push(rec);
    if (!byUrl.has(u)) byUrl.set(u, []);
    byUrl.get(u).push(rec);
  }
  // Title fallback only for url-groups of size 1 (avoids false merges).
  for (const g of byUrl.values()) {
    if (g.length > 1) continue;
    const t = g[0].t;
    if (!t) continue;
    if (!byTitle.has(t)) byTitle.set(t, []);
    byTitle.get(t).push(g[0]);
  }

  // URL-level corroboration: every rec sees union of sources in its group.
  for (const g of byUrl.values()) {
    if (g.length < 1) continue;
    const union = new Set(g.map((r) => bucketOf(r.it)));
    for (const r of g) for (const s of union) r.srcs.add(s);
  }
  // Title-level corroboration only when distinct URLs (>1) share a title.
  for (const tg of byTitle.values()) {
    const distinctUrls = new Set(tg.map((r) => r.u));
    if (distinctUrls.size < 2) continue;
    const union = new Set(tg.map((r) => bucketOf(r.it)));
    for (const r of tg) for (const s of union) r.srcs.add(s);
  }

  for (const rec of recs) {
    const srcs = [...rec.srcs].filter((s) => s !== 'mock').sort();
    const extra = { ...(rec.it.extra || {}) };
    extra.engineCount = srcs.length;
    extra.corroborated = srcs.length >= 2;
    if (srcs.length) extra.corroborators = srcs;
    rec.it.extra = extra;
  }
  return list;
}
