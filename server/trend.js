// 热点雷达：领域多查询 -> 多信源采集 -> 交叉印证 -> AI 去重/提炼/热度分级 -> 热点榜
import { db, now, getDomainFakeHits, GREYLIST_HITS } from './db.js';
import { getSettings } from './config.js';
import { refine, rank } from './ai.js';
import { exclusionGate } from './relevance.js';
import { ic, logEvent, logErr, logDone } from './log.js';
import { notify } from './notify.js';
import { broadcast } from './bus.js';
import { norm, mentions, pickExtra } from './sources/base.js';
import { corroborate, normUrl, normTitle, looksEvergreen, looksNewsy } from './sources/corroborate.js';
import * as mockSource from './sources/mock.js';
import * as websearch from './sources/websearch.js';
import * as twitter from './sources/twitter.js';
import * as bilibili from './sources/bilibili.js';

const upsertTrend = db.prepare(
  `INSERT INTO trends(scope,title,url,source,summary,heat,level,credible,first_seen,updated_at,published_at,extra)
   VALUES(@scope,@title,@url,@source,@summary,@heat,@level,@credible,@first_seen,@updated_at,@published_at,@extra)
   ON CONFLICT(scope,url) DO UPDATE SET
     title=excluded.title, summary=excluded.summary, heat=excluded.heat,
     level=excluded.level, credible=excluded.credible, updated_at=excluded.updated_at,
     published_at=excluded.published_at, extra=excluded.extra`
);
const existsTrend = db.prepare('SELECT 1 FROM trends WHERE scope=? AND url=?');
const insRun = db.prepare('INSERT INTO trend_runs(scope,started_at,status) VALUES(?,?,?)');
const finRun = db.prepare('UPDATE trend_runs SET finished_at=?,status=?,items=?,note=? WHERE id=?');

export async function refreshTrend(manual = false) {
  const s = getSettings();
  const scope = s.scope;
  const name = scope.name || 'AI 编程';
  // 热点榜至少回看 72h（仍需真实发布时间），避免时效过滤后榜单过薄
  const lookback = Math.max(Number(s.lookbackHours) || 168, 72);
  const toggles = s.sourceToggles;
  const runInfo = insRun.run(name, now(), 'running');
  const runId = Number(runInfo.lastInsertRowid);
  const t0 = Date.now();

  const queries = Array.isArray(scope.queries) && scope.queries.length ? scope.queries : ['AI 编程'];
  const raw = [];

  // 网页搜索：所有查询词（控频由 websearch 内部串行处理）
  if (toggles.websearch) {
    for (const q of queries) {
      try {
        raw.push(...(await websearch.searchWeb(q, lookback)));
      } catch (e) { /* ignore */ }
    }
  }
  // Twitter：最多取前 3 个查询词控成本
  if (toggles.weibo) {
    for (const q of queries.slice(0, 5)) {
      try {
        raw.push(...(await websearch.searchWeibo(q, lookback)));
      } catch (e) { /* ignore */ }
    }
  }
  if (toggles.twitter && twitter.isConfigured()) {
    for (const q of queries.slice(0, 3)) {
      try {
        raw.push(...(await twitter.searchTweets(`"${q}"`, lookback)));
      } catch (e) { /* 已记录 */ }
    }
  }
  // B站：检索词若是博主/官方/账号则直接抓账号，否则关键词视频搜索（无 Key）
  if (toggles.bilibili) {
    for (const q of queries.slice(0, 5)) {
      try {
        const { items } = await bilibili.collectForKeyword(q, lookback);
        raw.push(...items);
      } catch (e) { /* 已记录 */ }
    }
  }
  // 演示源：仅按领域名生成，避免与查询词重复过多
  if (toggles.mock) {
    try {
      raw.push(...(await mockSource.collectByQuery(name, lookback)));
    } catch (e) { /* ignore */ }
  }

  // 关键词命中次数（用于热度粗算）
  const kwHits = new Map();
  for (const q of queries) {
    const lower = q.toLowerCase();
    for (const it of raw) {
      const t = String(it.title || '').toLowerCase();
      if (t.includes(lower)) kwHits.set(it.url, (kwHits.get(it.url) || 0) + 1);
    }
  }

  // 跨源交叉印证（extra.engineCount/corroborated）-> 归一化去重 -> 低质域名过滤
  // account-type query: web hits must mention the account name, otherwise they
  // are unrelated to the account being tracked
  const acctQuery = queries.find((q) => bilibili.isAccountKeyword(q));
  if (acctQuery) {
    const base = bilibili.stripAccountMarker(acctQuery);
    for (let i = raw.length - 1; i >= 0; i--) {
      const it = raw[i];
      if (it.extra && it.extra.account) continue;
      if (!mentions(it, base)) raw.splice(i, 1);
    }
  }
  corroborate(raw);
  const seen = new Set();
  const uniq = [];
  let tDrops = 0;
  const trendDrop = {};
  for (const c of raw) {
    const it = norm(c);
    if (!it) continue;
    const key = normUrl(it.url);
    if (seen.has(key)) continue;
    const tkey = 't:' + normTitle(it.title);
    if (it.title && seen.has(tkey)) continue;
    seen.add(key);
    if (it.title) seen.add(tkey);
    // 常青/导航页（官网/百科/教程/工具集…）不属于热点 -> 跳过
    if (it.extra && it.extra.evergreen) continue;
    // 无可靠发布时间的单源网页：仅当具备新闻特征(发布/上线/开源/年份…)才保留
    const tmKnown = !(it.extra && it.extra.tsKnown === false);
    const corr = !!(it.extra && it.extra.corroborated);
    if (!tmKnown && !corr && !looksNewsy(it)) continue;
    // 低质域名（累计 >=2 次判假）且无多源交叉印证 -> 跳过
    const accountOwned = !!(it.extra && it.extra.account && it.extra.account.mid);
    if (!corr && !accountOwned && getDomainFakeHits(it.url) >= GREYLIST_HITS) continue;
    // 排除词/必须词：领域热点只做轻量相关过滤（话题宽泛，不做词覆盖度门槛）
    const ex = exclusionGate(it, s.relevance || {});
    if (!ex.keep) {
      tDrops++;
      trendDrop[ex.reason] = (trendDrop[ex.reason] || 0) + 1;
      continue;
    }
    it.extra = { ...(it.extra || {}), kwHits: kwHits.get(it.url) || 0 };
    uniq.push(it);
  }

  const refined = await refine(uniq, name);
  const scored = await rank(refined, name);
  const top = scored.slice(0, Number(s.topTrends) || 12);

  let added = 0;
  for (const sc of top) {
    const firstSeen = existsTrend.get(name, sc.url) ? null : now();
    upsertTrend.run({
      scope: name,
      title: sc.title,
      url: sc.url,
      source: sc.source,
      summary: (sc.summary || '').slice(0, 2000),
      heat: sc.heat || 0,
      level: sc.level || 'C',
      credible: sc.credible === undefined ? null : sc.credible,
      first_seen: firstSeen || now(),
      published_at: sc.publishedAt || null,
      extra: JSON.stringify(pickExtra(sc)),
      updated_at: now(),
    });
    if (firstSeen) {
      added++;
      broadcast('trend.new', { scope: name, item: sc });
    }
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  const tHit = added > 0;
  const tDropStr = tDrops ? ` 无关丢弃=${tDrops}` : '';
  logEvent(tHit ? ic.spark : ic.eye, tHit ? 'yellow' : 'dim', 'trend', `"${name}": raw=${raw.length} 去重=${uniq.length} 提炼=${refined.length} 打分=${scored.length} 上榜=${top.length} 新增=${added} 耗时=${elapsed}s${manual ? ' (手动)' : ''}`);
  finRun.run(now(), 'done', top.length, `added=${added}${manual ? ' (手动刷新)' : ''}`, runId);
  if (added > 0) {
    notify('notice', '热点雷达更新', `领域「${name}」发现 ${added} 条新热点`, { scope: name, added });
  }
  return { scope: name, candidates: uniq.length, kept: top.length, added, drops: tDrops, dropReasons: trendDrop };
}
