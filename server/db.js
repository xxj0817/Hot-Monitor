import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DATA_DIR, DB_PATH } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS keywords(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_scan_at TEXT
);
CREATE TABLE IF NOT EXISTS signals(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT,
  author TEXT,
  score INTEGER NOT NULL DEFAULT 0,
  related INTEGER NOT NULL DEFAULT 1,
  authentic INTEGER,
  verdict TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT,
  seen_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  UNIQUE(keyword_id, url)
);
CREATE TABLE IF NOT EXISTS trends(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT,
  heat INTEGER NOT NULL DEFAULT 0,
  level TEXT NOT NULL DEFAULT 'C',
  credible INTEGER,
  first_seen TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope, url)
);
CREATE TABLE IF NOT EXISTS trend_runs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  items INTEGER NOT NULL DEFAULT 0,
  note TEXT
);
CREATE TABLE IF NOT EXISTS notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS source_meta(
  source TEXT PRIMARY KEY,
  last_ok TEXT,
  last_error TEXT,
  last_run_at TEXT,
  last_count INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS domain_meta(
  domain TEXT PRIMARY KEY,
  fake_hits INTEGER NOT NULL DEFAULT 0,
  confirmed_hits INTEGER NOT NULL DEFAULT 0,
  first_hit_at TEXT,
  last_hit_at TEXT
);
`);

export const now = () => new Date().toISOString();

// 迁移：旧版本 trends.credible 为 NOT NULL，放开为可空（credible=null 表示未验证）
try {
  const col = db.prepare('PRAGMA table_info(trends)').all().find((c) => c.name === 'credible');
  if (col && col.notnull === 1) {
    db.exec(`
      ALTER TABLE trends RENAME TO trends_old;
      CREATE TABLE trends(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT,
        heat INTEGER NOT NULL DEFAULT 0,
        level TEXT NOT NULL DEFAULT 'C',
        credible INTEGER,
        first_seen TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(scope, url)
      );
      INSERT INTO trends(scope,title,url,source,summary,heat,level,credible,first_seen,updated_at)
        SELECT scope,title,url,source,summary,heat,level,credible,first_seen,updated_at FROM trends_old;
      DROP TABLE trends_old;
    `);
    console.log('[db] 迁移完成：trends.credible 已放开为可空');
  }
} catch (e) {
  console.warn('[db] credible 迁移失败（忽略）:', e.message);
}

// 启动清理：把上次异常退出遗留的 running 批次标记为中断
try {
  db.prepare("UPDATE trend_runs SET status='interrupted', finished_at=?, note=COALESCE(note,'')||' (服务重启中断)' WHERE status='running'").run(now());
} catch { /* ignore */ }

export function touchSource(name, { ok, count, error }) {
  db.prepare(
    `INSERT INTO source_meta(source,last_ok,last_error,last_run_at,last_count)
     VALUES(?,?,?,?,?)
     ON CONFLICT(source) DO UPDATE SET
       last_ok=excluded.last_ok, last_error=excluded.last_error,
       last_run_at=excluded.last_run_at, last_count=excluded.last_count`
  ).run(name, ok ? now() : null, error ? String(error).slice(0, 300) : null, now(), count || 0);
}

// ---------- 低质域名自动灰名单 ----------
function hostOf(url) {
  try {
    return String(new URL(url).hostname).replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// 累计一次“AI 判定为假”记录到来源域名；authentic=true 时累计可信记录
export function bumpDomainFake(url, confirmed = false) {
  const host = hostOf(url);
  if (!host) return 0;
  db.prepare(
    `INSERT INTO domain_meta(domain,fake_hits,confirmed_hits,first_hit_at,last_hit_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(domain) DO UPDATE SET
       fake_hits=domain_meta.fake_hits+excluded.fake_hits,
       confirmed_hits=domain_meta.confirmed_hits+excluded.confirmed_hits,
       last_hit_at=excluded.last_hit_at`
  ).run(host, confirmed ? 0 : 1, confirmed ? 1 : 0, now(), now());
  return getDomainFakeHits(url);
}

// 读取某域名灰名单命中数（>= GREYLIST_HITS 即视为低质域名）
export function getDomainFakeHits(url) {
  const host = hostOf(url);
  if (!host) return 0;
  const row = db.prepare('SELECT fake_hits FROM domain_meta WHERE domain=?').get(host);
  return row ? Number(row.fake_hits) || 0 : 0;
}

export const GREYLIST_HITS = 2;

export function listDomains() {
  return db
    .prepare('SELECT * FROM domain_meta ORDER BY fake_hits DESC, last_hit_at DESC')
    .all();
}

export function clearDomains() {
  db.prepare('DELETE FROM domain_meta').run();
}
