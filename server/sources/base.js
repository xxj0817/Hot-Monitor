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
