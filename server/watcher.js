// 关键词哨兵：对启用关键词扫描多信源 -> AI 判定真伪/相关 -> 入库 -> 确认后通知
import { db, now, touchSource, getDomainFakeHits, bumpDomainFake, GREYLIST_HITS } from './db.js';
import { getSettings } from './config.js';
import { judge, aiConfigured } from './ai.js';
import { gate } from './relevance.js';
import { relevanceInputsFor, searchQueriesFor, expandKeyword } from './expand.js';
import { ic, logEvent, logDone, logErr } from './log.js';
import { notify } from './notify.js';
import { broadcast } from './bus.js';
import { norm, mentions, pickExtra } from './sources/base.js';
import { corroborate, normUrl, normTitle, looksNewsy } from './sources/corroborate.js';
import * as mockSource from './sources/mock.js';
import * as websearch from './sources/websearch.js';
import * as twitter from './sources/twitter.js';
import * as bilibili from './sources/bilibili.js';

const insertSignal = db.prepare(
  `INSERT INTO signals(keyword_id,title,url,source,summary,author,score,related,authentic,verdict,reason,evidence,why,coverage,seen_at,published_at,extra)
   VALUES(@keyword_id,@title,@url,@source,@summary,@author,@score,@related,@authentic,@verdict,@reason,@evidence,@why,@coverage,@seen_at,@published_at,@extra)`
);
const hasUrl = db.prepare('SELECT 1 FROM signals WHERE keyword_id=? AND url=?');
const getExistingMeta = db.prepare('SELECT id, published_at, extra FROM signals WHERE keyword_id=? AND url=?');
const fillMeta = db.prepare('UPDATE signals SET published_at=COALESCE(published_at,?), extra=COALESCE(extra,?) WHERE id=?');
const findRecheck = db.prepare(
  `SELECT * FROM signals WHERE keyword_id=? AND url=? AND verdict='unverified'
   AND (reason LIKE 'AI 调用失败%' OR reason LIKE '%openrouter%' OR reason LIKE '%JSON%')`
);
const updateSignal = db.prepare(
  'UPDATE signals SET score=?, related=?, authentic=?, verdict=?, reason=?, evidence=?, why=?, coverage=? WHERE id=?'
);
const updLastScan = db.prepare('UPDATE keywords SET last_scan_at=? WHERE id=?');
const deleteExpiredSignals = db.prepare('DELETE FROM signals WHERE keyword_id=? AND seen_at < ?');
const deleteNonAccountSignals = db.prepare("DELETE FROM signals WHERE keyword_id=? AND source <> 'bilibili'");
const bumpDrop = db.prepare(
  `INSERT INTO relevance_drops(keyword_id,reason,hits,last_at) VALUES(?,?,1,?)
   ON CONFLICT(keyword_id,reason) DO UPDATE SET hits=hits+1, last_at=excluded.last_at`
);

export async function scanKeyword(kw) {
  const s = getSettings();
  const lookback = Number(s.lookbackHours) || 168;
  const oldestMs = Date.now() - lookback * 3600 * 1000;
  const toggles = s.sourceToggles;
  const candidates = [];
  deleteExpiredSignals.run(kw.id, new Date(oldestMs).toISOString());
  if (bilibili.isAccountKeyword(kw.name)) deleteNonAccountSignals.run(kw.id);

  // 查询扩展：本地规则 + 已缓存的 AI 变体（命中变体视为强相关，避免误杀合理内容）
  const relSettings = s.relevance || {};
  const expandExtra = Math.max(0, Math.min(3, Number(s.expandQueries ?? 1)));
  const inputs = relevanceInputsFor(kw.name);
  if (!inputs.fromAi && aiConfigured()) {
    // 后台生成 AI 扩展，不阻塞本轮扫描（下一轮生效）
    expandKeyword(kw.name).catch(() => {});
  }
  const extraQueries = searchQueriesFor(kw.name, expandExtra);
  const searchTerms = [kw.name, ...extraQueries];

  if (toggles.websearch) {
    for (const q of searchTerms) {
      try {
        candidates.push(...(await websearch.searchWeb(q, lookback)));
      } catch (e) {
        touchSource('websearch', { ok: false, count: 0, error: e.message });
      }
    }
  }
  if (toggles.weibo) {
    try {
      candidates.push(...(await websearch.searchWeibo(kw.name, lookback)));
    } catch (e) {
      touchSource('weibo', { ok: false, count: 0, error: e.message });
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
  // B站：博主/官方/账号型关键词直接抓该账号，其余走关键词视频搜索（无需 Key）
  if (toggles.bilibili) {
    try {
      const { items } = await bilibili.collectForKeyword(kw.name, lookback);
      candidates.push(...items);
      // 非账号型关键词：用扩展变体补充检索，扩大召回
      if (extraQueries.length && !bilibili.isAccountKeyword(kw.name)) {
        for (const q of extraQueries) {
          try {
            const more = await bilibili.searchVideos(q, lookback);
            if (Array.isArray(more)) candidates.push(...more);
          } catch (e) { /* 单条扩展检索失败不影响主流程 */ }
        }
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
  // account-type keyword: web/social hits must mention the account name
  const acctBase = bilibili.isAccountKeyword(kw.name) ? bilibili.stripAccountMarker(kw.name) : '';
  if (acctBase) {
    for (let i = candidates.length - 1; i >= 0; i--) {
      const it = candidates[i];
      if (it.extra && it.extra.account) continue;
      if (!mentions(it, acctBase)) candidates.splice(i, 1);
    }
  }

  corroborate(candidates);
  const seenInBatch = new Set();
  const fresh = [];
  let added = 0;
  let confirmed = 0;
  let rechecked = 0;
  let filled = 0;
  let dropped = 0;
  const dropReasons = {};
  let recheckBudget = 10; // 每轮最多复核 10 条历史“AI 失败”待核验条目，控制成本
  for (const c of candidates) {
    const it = norm(c);
    if (!it) continue;
    const key = normUrl(it.url);
    if (seenInBatch.has(key)) continue;
    const tkey = 't:' + normTitle(it.title);
    if (it.title && seenInBatch.has(tkey)) continue;
    seenInBatch.add(key);
    if (it.title) seenInBatch.add(tkey);
    if (hasUrl.get(kw.id, it.url)) {
      // 旧行补齐：published_at / extra 是后加的列，历史数据为 NULL，
      // 再次抓到相同 URL 时把刚采到的发布时间与明细填回去
      const ex = getExistingMeta.get(kw.id, it.url);
      if (ex && (ex.published_at === null || ex.extra === null)) {
        fillMeta.run(it.publishedAt || null, JSON.stringify(pickExtra(it)), ex.id);
        filled++;
      }
      // 该 URL 已入库：若此前是因 AI 调用失败而“待核验”，自动重新判定一次
      if (recheckBudget > 0) {
        const row = findRecheck.get(kw.id, it.url);
        if (row) {
          const j2 = await judge(it, kw.name, { variants: inputs.variants, aliases: inputs.aliases, strict: true });
          updateSignal.run(j2.score, j2.related, j2.authentic, j2.verdict, j2.reason || '', j2.evidence || '', j2.why || '', j2.coverage ?? null, row.id);
          recheckBudget--;
          rechecked++;
          if (j2.related === 1 && j2.authentic === 1) {
            confirmed++;
            const signal = { id: row.id, keyword_id: kw.id, keyword: kw.name, title: row.title, url: row.url, source: row.source, summary: row.summary, author: row.author, score: j2.score, related: j2.related, authentic: j2.authentic, verdict: j2.verdict, reason: j2.reason, seen_at: row.seen_at };
            notify('signal.new', `信号确认【${kw.name}】`, row.title, { keyword: kw.name, signal });
          }
        }
      }
      continue;
    }
    // 常青/导航页（官网/百科/教程…）不属于新动态 -> 跳过
    if (it.extra && it.extra.evergreen) continue;
    // hard cutoff: anything older than the lookback window never enters the store
    const ts = Date.parse(it.publishedAt);
    if (!Number.isNaN(ts) && ts < oldestMs) continue;
    const corroborated = !!(it.extra && it.extra.corroborated);
    const tmKnown = !(it.extra && it.extra.tsKnown === false);
    // 无可靠发布时间的单源网页：仅当具备新闻特征才保留
    if (!tmKnown && !corroborated && !looksNewsy(it)) continue;
    // 低质域名（累计 >=2 次判假）且无多源交叉印证 -> 跳过
    const accountOwned = !!(it.extra && it.extra.account && it.extra.account.mid);
    if (!corroborated && !accountOwned && getDomainFakeHits(it.url) >= GREYLIST_HITS) continue;
    // 相关性闸门：未命中关键词字面/实体/扩展变体的内容直接丢弃，不消耗 AI 调用
    let rel;
    if (acctBase) {
      // 账号型关键词：上文已用 mentions 校验过账号名，直接视为强相关
      rel = { coverage: 1, matched: [acctBase], missing: [], level: 'strong', excluded: '', mustMissing: [], containsPhrase: true, hitVariant: '', entities: [] };
    } else {
      const g = gate(it, kw.name, relSettings, inputs.variants);
      if (!g.keep) {
        dropped++;
        dropReasons[g.reason] = (dropReasons[g.reason] || 0) + 1;
        bumpDrop.run(kw.id, g.reason, now());
        continue;
      }
      rel = g;
    }
    fresh.push({ it, rel });
  }

  for (const { it, rel } of fresh) {
    const j = await judge(it, kw.name, { variants: inputs.variants, aliases: inputs.aliases, relevance: rel, strict: true });
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
        evidence: j.evidence || '',
        why: j.why || '',
        coverage: j.coverage ?? null,
        seen_at: now(),
        published_at: it.publishedAt || null,
        extra: JSON.stringify(pickExtra(it)),
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
      evidence: j.evidence || '',
      why: j.why || '',
      coverage: j.coverage ?? null,
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
  const hit = added > 0 || confirmed > 0;
  const dropStr = dropped ? ` / 无关丢弃 ${dropped}(${Object.entries(dropReasons).map(([r, n]) => `${r}=${n}`).join(' ')})` : '';
  const expandStr = extraQueries.length ? ` / 扩展词 ${extraQueries.join(' ')}` : '';
  logEvent(hit ? ic.check : ic.clock, hit ? 'green' : 'dim', 'watch', `"${kw.name}": 采集 ${candidates.length} (${srcStr}) -> 新 ${fresh.length} -> 入库 ${added} / 确认 ${confirmed}${rechecked ? ' / 复核 ' + rechecked : ''}${dropStr}${expandStr}`);
  updLastScan.run(now(), kw.id);
  return { keyword: kw.name, candidates: candidates.length, fresh: fresh.length, added, confirmed, filled, dropped, dropReasons, expandTerms: extraQueries };
}

export async function scanAllKeywords() {
  const kws = db.prepare('SELECT * FROM keywords WHERE enabled=1').all();
  const results = [];
  for (const kw of kws) {
    try {
      results.push(await scanKeyword(kw));
    } catch (e) {
      logErr('watch', `"${kw.name}" 扫描异常: ${e.message}`);
      results.push({ keyword: kw.name, error: e.message, candidates: 0, fresh: 0, added: 0, confirmed: 0 });
    }
  }
  const added = results.reduce((a, r) => a + (r.added || 0), 0);
  const confirmed = results.reduce((a, r) => a + (r.confirmed || 0), 0);
  logDone('watch', `扫描完成：${results.length} 个关键词，新增 ${added} / 确认 ${confirmed}`);
  broadcast('scan.done', { at: now(), results, added, confirmed });
  if (added > 0 || confirmed > 0) {
    notify('scan.done', '关键词扫描完成', `扫描 ${results.length} 个关键词：新增 ${added} 条信号，确认 ${confirmed} 条`, { results });
  }
  return results;
}
