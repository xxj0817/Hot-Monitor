// Bilibili source (CN, no API key required).
// Uses Bilibili public JSON search endpoints; a buvid3 cookie is bootstrapped
// from the homepage to pass risk control. Best-effort by design: failures are
// recorded and never break callers.
// Supports:
//   - keyword video search          (search_type=video)
//   - account mode: resolve an UP owner (search_type=bili_user) then fetch that
//     author's own videos via video search filtered by author mid.
import { norm, withinLookback } from './base.js';
import { touchSource } from '../db.js';
import { getSettings } from '../config.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HOME = 'https://www.bilibili.com/';
const SEARCH = 'https://api.bilibili.com/x/web-interface/search/type';

let cookie = '';
let cookieTried = false;
let lastHit = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function throttle(gap = 1500) {
  const wait = lastHit ? Math.max(0, gap - (Date.now() - lastHit)) : 0;
  if (wait) await sleep(wait);
  lastHit = Date.now();
}

async function ensureCookie() {
  if (cookieTried) return;
  cookieTried = true;
  try {
    const res = await fetch(HOME, {
      headers: { 'user-agent': UA, accept: 'text/html' },
      signal: AbortSignal.timeout(10000),
    });
    const sc = res.headers.get('set-cookie') || '';
    const m = sc.match(/buvid3=[^;]+/);
    if (m) cookie = m[0];
  } catch { /* keep empty, still try without */ }
}

async function api(url) {
  await throttle();
  await ensureCookie();
  const headers = { 'user-agent': UA, accept: 'application/json', referer: HOME };
  if (cookie) headers.cookie = cookie;
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error('bilibili http ' + res.status);
      const j = await res.json();
      if (!j) throw new Error('bilibili bad json');
      if (j.code === -412 || j.code === -799) {
        lastErr = new Error('bilibili risk ' + j.code);
        await sleep(1600);
        continue;
      }
      if (j.code !== 0) throw new Error('bilibili code ' + j.code + ' ' + String(j.message || ''));
      return j;
    } catch (e) {
      lastErr = e;
      if (!String(e.message).startsWith('bilibili http') && attempt === 0) await sleep(1200);
    }
  }
  throw lastErr || new Error('bilibili failed');
}

export function isConfigured() {
  return true; // no key required
}

// A keyword that looks like an account (blogger/official/UP owner/@handle).
export function isAccountKeyword(name) {
  const s = String(name || '');
  return /@|博主|官方|账号|工作室|团队|频道|up\s*主|UP\s*主|号$/.test(s);
}

function cleanTitle(s) {
  return String(s || '').replace(/<[^>]+>/g, '').trim();
}

function mapVideo(v) {
  if (!v || !v.bvid) return null;
  const title = cleanTitle(v.title);
  if (!title) return null;
  const author = String(v.author || '').trim();
  const pub = Number(v.pubdate || 0) * 1000;
  return norm({
    title,
    summary: String(v.description || '').trim(),
    author: author ? '@' + author : '',
    source: 'bilibili',
    url: 'https://www.bilibili.com/video/' + v.bvid,
    publishedAt: pub ? new Date(pub).toISOString() : new Date().toISOString(),
    extra: {
      videoId: String(v.bvid),
      mid: String(v.mid || ''),
      play: Number(v.play) || 0,
      like: Number(v.like) || 0,
      reply: Number(v.video_review !== undefined ? v.video_review : v.review) || 0,
      danmaku: Number(v.danmaku) || 0,
      duration: String(v.duration || ''),
      typename: String(v.typename || ''),
    },
  });
}

// Adaptive play floor so fresh videos can pass without letting junk flood in:
//   <24h  -> >= 1000 plays (brand-new but getting traction)
//   24-72h -> >= max(3000, 10% of bilibiliMinPlay)
//   older  -> >= bilibiliMinPlay (0 disables the gate entirely)
function passGate(it) {
  const minPlay = Number(getSettings().bilibiliMinPlay) || 0;
  if (minPlay <= 0) return true;
  const play = (it.extra && it.extra.play) || 0;
  let ageH = 99;
  try { ageH = (Date.now() - Date.parse(it.publishedAt)) / 3600000; } catch { /* keep */ }
  let floor = minPlay;
  if (ageH <= 24) floor = 1000;
  else if (ageH <= 72) floor = Math.max(3000, Math.round(minPlay * 0.1));
  return play >= floor;
}

async function videoSearchRaw(q, order) {
  const suffix = order ? '&order=' + order : '';
  const j = await api(`${SEARCH}?search_type=video&keyword=${encodeURIComponent(q)}&page=1${suffix}`);
  const res = j.data && j.data.result;
  return Array.isArray(res) ? res : [];
}

async function userSearchRaw(q) {
  const j = await api(`${SEARCH}?search_type=bili_user&keyword=${encodeURIComponent(q)}&page=1`);
  const res = j.data && j.data.result;
  return Array.isArray(res) ? res : [];
}

function dedupeByBvid(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r || !r.bvid || seen.has(r.bvid)) continue;
    seen.add(r.bvid);
    out.push(r);
  }
  return out;
}

// Keyword video search -> normalized items within lookback. Merges newest-first
// (order=pubdate) with comprehensive ranking to cover fresh and popular items.
export async function searchVideos(query, lookbackHours = 24) {
  const rows = dedupeByBvid([
    ...(await videoSearchRaw(query, 'pubdate')),
    ...(await videoSearchRaw(query, '')),
  ]);
  const items = rows
    .map(mapVideo)
    .filter(Boolean)
    .filter(passGate)
    .filter((it) => withinLookback(it, lookbackHours));
  touchSource('bilibili', { ok: true, count: items.length });
  return items;
}

// Resolve an account name to a Bilibili UP owner profile (best match).
export async function lookupAccount(name) {
  const users = await userSearchRaw(name);
  if (!users.length) {
    touchSource('bilibili:account', { ok: true, count: 0 });
    return null;
  }
  const n = (s) => String(s || '').toLowerCase().trim();
  const target = n(name);
  const best = users.find((u) => n(u.uname) === target) || users[0];
  const acc = {
    mid: String(best.mid || best.uid || ''),
    uname: String(best.uname || '').trim(),
    fans: Number(best.fans) || 0,
    videos: Number(best.videos) || 0,
    sign: String(best.usign || '').trim(),
  };
  touchSource('bilibili:account', { ok: true, count: acc.mid ? 1 : 0 });
  return acc;
}

// Fetch the account's own recent videos: search its display name and keep
// results whose author mid equals the resolved account (newest first).
export async function accountVideos(acc, lookbackHours = 24) {
  if (!acc || !acc.mid) return [];
  const rows = dedupeByBvid([
    ...(await videoSearchRaw(acc.uname, 'pubdate')),
    ...(await videoSearchRaw(acc.uname, '')),
  ]);
  const items = rows
    .filter((v) => String(v.mid || '') === String(acc.mid))
    .map((v) => {
      const it = mapVideo(v);
      if (it) {
        it.extra.account = {
          mid: acc.mid,
          uname: acc.uname,
          fans: acc.fans,
          videos: acc.videos,
          sign: acc.sign,
        };
      }
      return it;
    })
    .filter(Boolean)
    .filter(passGate)
    .filter((it) => withinLookback(it, lookbackHours));
  touchSource('bilibili:account', { ok: true, count: items.length });
  return items;
}

// Convenience for watcher/trend: resolve + fetch account items if the keyword
// resolves to an account, otherwise returns account:null.
export async function collectAccount(name, lookbackHours = 24) {
  const acc = await lookupAccount(name);
  if (!acc) return { account: null, items: [] };
  const items = await accountVideos(acc, lookbackHours);
  return { account: acc, items };
}
