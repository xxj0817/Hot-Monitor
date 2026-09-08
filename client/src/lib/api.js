// 前端 API 客户端
const BASE = '/api';

async function req(method, url, body) {
  const opt = { method, headers: {} };
  if (body !== undefined) {
    opt.headers['content-type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await fetch(BASE + url, opt);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && j.error) msg = j.error;
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  state: () => req('GET', '/state'),
  keywords: () => req('GET', '/keywords'),
  addKeyword: (name) => req('POST', '/keywords', { name }),
  delKeyword: (id) => req('DELETE', `/keywords/${id}`),
  patchKeyword: (id, patch) => req('PATCH', `/keywords/${id}`, patch),
  scanKeyword: (id) => req('POST', `/keywords/${id}/scan`),
  signals: (kw, limit) => req('GET', `/signals?keyword=${encodeURIComponent(kw || '')}&limit=${limit || 60}`),
  trends: (scope, limit) => req('GET', `/trends?scope=${encodeURIComponent(scope || '')}&limit=${limit || 60}`),
  refreshTrends: () => req('POST', '/trends/refresh'),
  notifications: (limit) => req('GET', `/notifications?limit=${limit || 60}`),
  markRead: (id) => req('PATCH', `/notifications/${id}/read`),
  readAll: () => req('POST', '/notifications/read-all'),
  saveSettings: (patch) => req('PATCH', '/settings', patch),
  runWatch: () => req('POST', '/jobs/watch'),
  runTrend: () => req('POST', '/jobs/trend'),
  metaSources: () => req('GET', '/meta/sources'),
  domains: () => req('GET', '/meta/domains'),
  clearDomains: () => req('DELETE', '/meta/domains'),
};

// 订阅 SSE 事件：返回取消函数
export function useEventStream(onEvent) {
  let es = null;
  try {
    es = new EventSource(`${BASE}/events`);
  } catch {
    return () => {};
  }
  const handlers = {
    hello: () => {},
    notice: (d) => onEvent('notice', d),
    'signal.new': (d) => onEvent('signal.new', d),
    'trend.new': (d) => onEvent('trend.new', d),
    'scan.done': (d) => onEvent('scan.done', d),
    'source.status': (d) => onEvent('source.status', d),
  };
  es.onmessage = (e) => {
    try {
      onEvent('message', JSON.parse(e.data));
    } catch { /* ignore */ }
  };
  Object.entries(handlers).forEach(([name, fn]) => {
    es.addEventListener(name, (e) => {
      try {
        fn(JSON.parse(e.data));
      } catch { /* ignore */ }
    });
  });
  return () => es.close();
}

// 相对时间格式化（中文）
export function relTime(iso) {
  if (!iso) return '-';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '-';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 10) return '刚刚';
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  return `${d} 天前`;
}

export function fmtTime(iso) {
  if (!iso) return '--:--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
