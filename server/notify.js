import { db, now } from './db.js';
import { broadcast } from './bus.js';

// 通知中心：入库 + 广播。payload 同时作为业务事件载荷。
export function notify(type, title, body, payload = {}) {
  const created = now();
  const info = db
    .prepare('INSERT INTO notifications(type,title,body,payload,created_at) VALUES(?,?,?,?,?)')
    .run(type, title, body || '', JSON.stringify(payload), created);
  const rec = {
    id: Number(info.lastInsertRowid),
    type,
    title,
    body: body || '',
    payload,
    created_at: created,
    read: 0,
  };
  broadcast('notice', rec);
  if (type === 'signal.new') broadcast('signal.new', payload);
  if (type === 'trend.new') broadcast('trend.new', payload);
  if (type === 'scan.done') broadcast('scan.done', payload);
  if (type === 'source.status') broadcast('source.status', payload);
  return rec;
}
