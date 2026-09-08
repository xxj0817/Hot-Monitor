import { Router } from 'express';
import { db, now, listDomains, clearDomains } from './db.js';
import { getSettings, saveSettings } from './config.js';
import { addClient } from './bus.js';
import { scanKeyword } from './watcher.js';
import { refreshTrend } from './trend.js';
import { runWatchOnce, runTrendOnce, restartScheduler } from './scheduler.js';
import { aiConfigured } from './ai.js';
import * as twitter from './sources/twitter.js';

const router = Router();

const kwAll = db.prepare('SELECT * FROM keywords ORDER BY id');
const sigRecent = db.prepare(
  `SELECT s.*, k.name AS keyword FROM signals s JOIN keywords k ON k.id=s.keyword_id
   ORDER BY s.id DESC LIMIT @lim`
);
const sigByKw = db.prepare(
  `SELECT s.*, k.name AS keyword FROM signals s JOIN keywords k ON k.id=s.keyword_id
   WHERE (@kw IS NULL OR k.name=@kw) ORDER BY s.id DESC LIMIT @lim`
);
const trendsRecent = db.prepare(
  `SELECT * FROM trends WHERE (@scope IS NULL OR scope=@scope)
   ORDER BY heat DESC, id DESC LIMIT @lim`
);
const notifRecent = db.prepare('SELECT * FROM notifications ORDER BY id DESC LIMIT @lim');
const sourceMeta = db.prepare('SELECT * FROM source_meta ORDER BY source');
const trendRuns = db.prepare('SELECT * FROM trend_runs ORDER BY id DESC LIMIT 10');

// ---------- 汇总状态 ----------
router.get('/state', (req, res) => {
  res.json({
    keywords: kwAll.all(),
    signals: sigRecent.all({ lim: 40 }),
    trends: trendsRecent.all({ scope: null, lim: 60 }),
    notifications: notifRecent.all({ lim: 30 }),
    sources: sourceMeta.all(),
    trendRuns: trendRuns.all(),
    settings: sanitize(getSettings()),
    health: {
      ai: aiConfigured(),
      twitter: twitter.isConfigured(),
      now: now(),
    },
  });
});

function sanitize(s) {
  return JSON.parse(
    JSON.stringify(s, (k, v) => (k.toLowerCase().includes('key') ? undefined : v))
  );
}

// ---------- 关键词 ----------
router.get('/keywords', (req, res) => res.json(kwAll.all()));

router.post('/keywords', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '关键词不能为空' });
  try {
    const info = db
      .prepare('INSERT INTO keywords(name,enabled,created_at) VALUES(?,?,?)')
      .run(name, 1, now());
    res.json(db.prepare('SELECT * FROM keywords WHERE id=?').get(Number(info.lastInsertRowid)));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '关键词已存在' });
    throw e;
  }
});

router.delete('/keywords/:id', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM keywords WHERE id=?').run(id);
  db.prepare('DELETE FROM signals WHERE keyword_id=?').run(id);
  res.json({ ok: true });
});

router.patch('/keywords/:id', (req, res) => {
  const id = Number(req.params.id);
  const kw = db.prepare('SELECT * FROM keywords WHERE id=?').get(id);
  if (!kw) return res.status(404).json({ error: 'not found' });
  if (req.body?.name) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: '关键词不能为空' });
    try {
      db.prepare('UPDATE keywords SET name=? WHERE id=?').run(name, id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: '关键词已存在' });
      throw e;
    }
  }
  if (req.body?.enabled !== undefined) {
    db.prepare('UPDATE keywords SET enabled=? WHERE id=?').run(req.body.enabled ? 1 : 0, id);
  }
  res.json(db.prepare('SELECT * FROM keywords WHERE id=?').get(id));
});

router.post('/keywords/:id/scan', async (req, res) => {
  const id = Number(req.params.id);
  const kw = db.prepare('SELECT * FROM keywords WHERE id=?').get(id);
  if (!kw) return res.status(404).json({ error: 'not found' });
  const result = await scanKeyword(kw);
  res.json(result);
});

// ---------- 信号 ----------
router.get('/signals', (req, res) => {
  const kw = req.query.keyword || null;
  const lim = Math.min(200, Number(req.query.limit) || 60);
  const rows = kw ? sigByKw.all({ kw, lim }) : sigRecent.all({ lim });
  res.json(rows);
});

// ---------- 热点 ----------
router.get('/trends', (req, res) => {
  const scope = req.query.scope || null;
  const lim = Math.min(200, Number(req.query.limit) || 60);
  res.json(trendsRecent.all({ scope, lim }));
});

router.post('/trends/refresh', async (req, res) => {
  const result = await refreshTrend(true);
  res.json(result);
});

// ---------- 通知 ----------
router.get('/notifications', (req, res) => {
  const lim = Math.min(200, Number(req.query.limit) || 50);
  res.json(notifRecent.all({ lim }));
});

router.patch('/notifications/:id/read', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE notifications SET read=1 WHERE id=?').run(id);
  res.json({ ok: true });
});

router.post('/notifications/read-all', (req, res) => {
  db.prepare('UPDATE notifications SET read=1').run();
  res.json({ ok: true });
});

// ---------- 设置 ----------
router.patch('/settings', (req, res) => {
  const patch = req.body || {};
  const allowed = [
    'pollMinutes', 'model', 'lookbackHours', 'topTrends',
    'sourceToggles', 'scope', 'twitterMinEngagement', 'websearchEngines', 'bilibiliMinPlay',
  ];
  const clean = {};
  for (const k of allowed) {
    if (patch[k] !== undefined) clean[k] = patch[k];
  }
  if (clean.pollMinutes !== undefined) clean.pollMinutes = Math.max(1, Number(clean.pollMinutes) || 30);
  if (clean.lookbackHours !== undefined) clean.lookbackHours = Math.max(1, Number(clean.lookbackHours) || 24);
  if (clean.topTrends !== undefined) clean.topTrends = Math.max(3, Math.min(50, Number(clean.topTrends) || 12));
  if (clean.twitterMinEngagement !== undefined) {
    clean.twitterMinEngagement = Math.max(0, Number(clean.twitterMinEngagement) || 0);
  }
  if (clean.bilibiliMinPlay !== undefined) {
    clean.bilibiliMinPlay = Math.max(0, Number(clean.bilibiliMinPlay) || 0);
  }
  if (clean.websearchEngines !== undefined) {
    const known = ['bing', 'so360', 'baidu'];
    clean.websearchEngines = (Array.isArray(clean.websearchEngines) ? clean.websearchEngines : [])
      .filter((e) => known.includes(e));
    if (!clean.websearchEngines.length) clean.websearchEngines = ['bing'];
  }
  saveSettings(clean);
  // 周期变化需重启调度
  const changed = clean.pollMinutes !== undefined;
  if (changed) restartScheduler();
  res.json(sanitize(getSettings()));
});

// ---------- 元信息 ----------
router.get('/meta/sources', (req, res) => {
  const s = getSettings();
  res.json({
    sources: sourceMeta.all(),
    config: {
      ai: aiConfigured(),
      twitter: twitter.isConfigured(),
      model: s.model,
      toggles: s.sourceToggles,
      websearchEngines: s.websearchEngines,
      twitterMinEngagement: s.twitterMinEngagement,
    },
  });
});

// ---------- 低质域名自动灰名单 ----------
router.get('/meta/domains', (req, res) => {
  res.json(listDomains());
});

router.delete('/meta/domains', (req, res) => {
  clearDomains();
  res.json({ ok: true });
});

// ---------- 手动任务 ----------
router.post('/jobs/watch', async (req, res) => {
  const results = await runWatchOnce();
  res.json({ results });
});

router.post('/jobs/trend', async (req, res) => {
  const result = await runTrendOnce();
  res.json(result);
});

// ---------- SSE 事件流 ----------
router.get('/events', (req, res) => {
  res.set({
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();
  res.write(`event: hello\ndata: ${JSON.stringify({ at: now() })}\n\n`);
  addClient(res);
  req.on('close', () => {});
});

export default router;
