// 关键词哨兵：对启用关键词扫描多信源 -> AI 判定真伪/相关 -> 入库 -> 确认后通知
import { db, now, touchSource, getDomainFakeHits, bumpDomainFake, GREYLIST_HITS } from './db.js';
import { getSettings } from './config.js';
import { judge } from './ai.js';
import { notify } from './notify.js';
import { broadcast } from './bus.js';
import { norm } from './sources/base.js';
import { corroborate, normUrl } from './sources/corroborate.js';
import * as mockSource from './sources/mock.js';
import * as websearch from './sources/websearch.js';
import * as twitter from './sources/twitter.js';
import * as bilibili from './sources/bilibili.js';

const insertSignal = db.prepare(
  `INSERT INTO signals(keyword_id,title,url,source,summary,author,score,related,authentic,verdict,reason,seen_at)
   VALUES(@keyword_id,@title,@url,@source,@summary,@author,@score,@related,@authentic,@verdict,@reason,@seen_at)`
);
const hasUrl = db.prepare('SELECT 1 FROM signals WHERE keyword_id=? AND url=?');
const updLastScan = db.prepare('UPDATE keywords SET last_scan_at=? WHERE id=?');

export async function scanKeyword(kw) {
  const s = getSettings();
  const lookback = s.lookbackHours;
  const toggles = s.sourceToggles;
  const candidates = [];

  if (toggles.websearch) {
    try {
      candidates.push(...(await websearch.searchWeb(kw.name, lookback)));
    } catch (e) {
      touchSource('websearch', { ok: false, count: 0, error: e.message });
    }
  }
  if (toggles.twitter && twitter.isConfigured()) {
    try {
      candidates.push(...(await twitter.searchTweets(`"${kw.name}"`, lookback)));
    } catch (e) {
      // 缺 key / 失败：记录即可，不阻断流程
      touchSource('twitter', { ok: false, count: 0, error: e.message });
    }
  }
  // B站：博主/官方/账号型关键词直接抓该账号，其余走关键词视频搜索（无 Key）
  if (toggles.bilibili) {
    try {
      if (bilibili.isAccountKeyword(kw.name)) {
        const { account, items } = await bilibili.collectAccount(kw.name, lookback);
        if (account && items.length) candidates.push(...items);
        else if (!account) candidates.push(...(await bilibili.searchVideos(kw.name, lookback)));
      } else {
        candidates.push(...(await bilibili.searchVideos(kw.name, lookback)));
      }
    } catch (e) {
      touchSource('bilibili', { ok: false, count: 0, error: e.message });
    }
  }
  if (toggles.mock) {
    try {
      candidates.push(...(await mockSource.collectByKeyword(kw.name, lookback)));
    } catch (e) { /* ignore */ }
  }

  // 跨源交叉印证（extra.engineCount/corroborated）-> 归一化去重 -> 过滤历史已见/低质域名
  corroborate(candidates);
  const seenInBatch = new Set();
  const fresh = [];
  for (const c of candidates) {
    const it = norm(c);
    if (!it) continue;
    const key = normUrl(it.url);
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    if (hasUrl.get(kw.id, it.url)) continue;
    // 低质域名（累计 >=2 次判假）且无多源交叉印证 -> 跳过
    const corroborated = !!(it.extra && it.extra.corroborated);
    if (!corroborated && getDomainFakeHits(it.url) >= GREYLIST_HITS) continue;
    fresh.push(it);
  }

  let added = 0;
  let confirmed = 0;
  for (const it of fresh) {
    const j = await judge(it, kw.name);
    // AI 判为假：给来源域名累计一次灰名单记录
    if (j.authentic === 0) bumpDomainFake(it.url);
    else if (j.authentic === 1) bumpDomainFake(it.url, true);
    let id = null;
    try {
      const info = insertSignal.run({
        keyword_id: kw.id,
        title: it.title,
        url: it.url,
        source: it.source,
        summary: (it.summary || '').slice(0, 2000),
        author: it.author || '',
        score: j.score,
        related: j.related,
        authentic: j.authentic,
        verdict: j.verdict,
        reason: j.reason || '',
        seen_at: now(),
      });
      id = Number(info.lastInsertRowid);
    } catch (e) {
      if (!String(e.message).includes('UNIQUE')) throw e;
      continue;
    }
    added++;
    const signal = {
      id,
      keyword_id: kw.id,
      keyword: kw.name,
      title: it.title,
      url: it.url,
      source: it.source,
      summary: it.summary,
      author: it.author,
      score: j.score,
      related: j.related,
      authentic: j.authentic,
      verdict: j.verdict,
      reason: j.reason,
      seen_at: now(),
    };
    if (j.related === 1 && j.authentic === 1) {
      confirmed++;
      notify('signal.new', `信号确认【${kw.name}】`, it.title, { keyword: kw.name, signal });
    }
  }
  const bySrc = {};
  for (const c of candidates) bySrc[c.source] = (bySrc[c.source] || 0) + 1;
  const srcStr = Object.entries(bySrc).map(([s, n]) => `${s}=${n}`).join(' ');
  console.log(`[watch] "${kw.name}": 采集 ${candidates.length} (${srcStr}) -> 新 ${fresh.length} -> 入库 ${added} / 确认 ${confirmed}`);
  updLastScan.run(now(), kw.id);
  return { keyword: kw.name, candidates: candidates.length, fresh: fresh.length, added, confirmed };
}

export async function scanAllKeywords() {
  const kws = db.prepare('SELECT * FROM keywords WHERE enabled=1').all();
  const results = [];
  for (const kw of kws) {
    try {
      results.push(await scanKeyword(kw));
    } catch (e) {
      console.error(`[watcher] ${kw.name} scan error:`, e.message);
      results.push({ keyword: kw.name, error: e.message, candidates: 0, fresh: 0, added: 0, confirmed: 0 });
    }
  }
  const added = results.reduce((a, r) => a + (r.added || 0), 0);
  const confirmed = results.reduce((a, r) => a + (r.confirmed || 0), 0);
  broadcast('scan.done', { at: now(), results, added, confirmed });
  if (added > 0 || confirmed > 0) {
    notify('scan.done', '关键词扫描完成', `扫描 ${results.length} 个关键词：新增 ${added} 条信号，确认 ${confirmed} 条`, { results });
  }
  return results;
}
