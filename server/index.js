// Hot-Monitor 服务入口
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { env, DIST_DIR, loadSettings } from './config.js';
import './db.js';
import api from './api.js';
import { startScheduler } from './scheduler.js';

loadSettings();

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use('/api', api);

// 生产：托管前端构建产物
const indexFile = path.join(DIST_DIR, 'index.html');
if (fs.existsSync(indexFile)) {
  app.use(express.static(DIST_DIR));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) return res.sendFile(indexFile);
    next();
  });
}

app.get('/', (req, res) => {
  res.type('text/plain; charset=utf-8').send(
    'Hot-Monitor API 运行中。\n开发模式前端: http://localhost:5173\n生产模式: npm run build 后访问本端口。'
  );
});

// 统一错误处理
app.use((err, req, res, next) => {
  console.error('[http]', err);
  res.status(500).json({ error: err.message || 'internal error' });
});

app.listen(env.port, () => {
  console.log(`[hot-monitor] API 已启动: http://localhost:${env.port}`);
  startScheduler();
});
