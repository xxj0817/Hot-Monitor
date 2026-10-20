// 信源适配器规范：所有信源输出统一条目结构
export function norm(raw) {
  if (!raw) return null;
  const title = String(raw.title || '').trim();
  const url = String(raw.url || '').trim();
  if (!title || !url) return null;
  return {
    title,
    url,
    summary: String(raw.summary || '').trim(),
    author: raw.author ? String(raw.author) : '',
    source: raw.source || 'unknown',
    publishedAt: raw.publishedAt || new Date().toISOString(),
    extra: raw.extra || {},
  };
}

export function withinLookback(item, lookbackHours) {
  try {
    const ts = Date.parse(item.publishedAt);
    if (Number.isNaN(ts)) return true;
    return Date.now() - ts <= lookbackHours * 3600 * 1000;
  } catch {
    return true;
  }
}

// Does the item text mention the given needle? Used to keep account-type
// keywords (UP owner / official account) free of unrelated web hits.
export function mentions(item, needle) {
  const n = String(needle || '').trim().toLowerCase();
  if (!n) return true;
  const hay = `${item.title || ''} ${item.summary || ''} ${item.author || ''}`.toLowerCase();
  return hay.includes(n);
}

// Persisted subset of an item's extra payload. The UI needs interactions, the
// source engine, cross-source corroboration and account info; everything else
// is dropped so the stored JSON stays small.
const EXTRA_KEYS = [
  'play', 'like', 'reply', 'danmaku', 'duration', 'typename', 'mid', 'videoId',
  'likeCount', 'retweetCount', 'replyCount', 'viewCount', 'tweetId', 'isReply',
  'engine', 'tsKnown', 'evergreen', 'engineCount', 'corroborated', 'kwHits',
];

export function pickExtra(item) {
  const src = (item && item.extra) || {};
  const out = {};
  for (const k of EXTRA_KEYS) {
    const v = src[k];
    if (v === undefined || v === null || v === '') continue;
    out[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  }
  if (Array.isArray(src.corroborators)) out.corroborators = src.corroborators.slice(0, 8);
  if (src.account && typeof src.account === 'object') {
    out.account = {
      mid: String(src.account.mid || ''),
      uname: String(src.account.uname || '').slice(0, 80),
      fans: Number(src.account.fans) || 0,
      sign: String(src.account.sign || '').slice(0, 200),
    };
  }
  return out;
}
