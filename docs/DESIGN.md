# Hot-Monitor 热点雷达 - 设计方案

> 版本 v2.1 | 2026-09 | React+Vite+Tailwind / Express / SQLite / 30 分钟频率

## 1. 总体架构

```
[调度器(每30min)] -> [关键词哨兵 watcher.js] ---> [OpenRouter AI judge]
                  -> [热点雷达 trend.js] -------> [OpenRouter refine/rank]
                                          |
   多信源适配层: Bing爬虫 / DuckDuckGo / Twitter(twitterapi.io) / Mock演示源
                                          v
                        SQLite(better-sqlite3)  <-  Express API + SSE  ->  React 情报台
```

## 2. 目录结构

```
server/   index.js  config.js  db.js  scheduler.js  bus.js  notify.js
          ai.js  watcher.js  trend.js  api.js
          sources/  base.js  websearch.js  twitter.js  mock.js
client/   index.html  vite.config.js  src/(main.jsx App.jsx index.css lib/api.js components/*)
skills/hot-monitor/   SKILL.md + monitor.mjs（自包含 CLI）
docs/     REQUIREMENTS / DESIGN / API-INTEGRATION / SKILLS-GUIDE
tools/    enc.ps1（GBK<->UTF-8） repair.ps1（乱码反转） probe.mjs（模型探测）
data/     hotmonitor.db + settings.json（git 忽略）
```

## 3. 数据模型（SQLite）

- keywords(id,name unique,enabled,created_at,last_scan_at)
- signals(id,keyword_id,title,url,source,summary,author,score,related,authentic,verdict,reason,seen_at,read, UNIQUE(keyword_id,url))
- trends(id,scope,title,url,source,summary,heat,level,credible 可空,first_seen,updated_at, UNIQUE(scope,url))
- trend_runs(id,scope,started_at,finished_at,status,items,note)
- notifications(id,type,title,body,payload,created_at,read)
- source_meta(source,last_ok,last_error,last_run_at,last_count)

启动自动迁移（trends.credible 放开可空）与清理残留 running 批次。

## 4. AI 编排（OpenRouter）

- `POST https://openrouter.ai/api/v1/chat/completions`，Bearer Key；默认模型 nvidia/nemotron-3-super-120b-a12b:free。
- judge: {related, authentic, score, verdict(authentic/fake/unrelated/unverified), reason}
- refine: 去重/提炼/可信度；rank: heat(0-100)+level(S/A/B/C)。
- JSON 约束（response_format，失败自动去掉重试）；失败/无 Key -> 本地规则降级（标记 unverified，不误报"真"）。

## 5. 多信源

| 适配器 | 方式 | Key | 频控 |
|---|---|---|---|
| websearch(Bing) | HTML 解析 | 无 | 4~8s/查询，随机 UA |
| websearch(DDG) | HTML 解析 | 无 | 备用引擎，失败静默 |
| twitter | twitterapi.io advanced_search | TWITTER_API_KEY | 每词 1 请求 |
| mock | 内置样例 | 无 | - |

## 6. 通知/实时

notify.js 入库 + SSE 广播（signal.new/trend.new/scan.done/notice/source.status）；前端 toast + 桌面通知。渠道适配层预留。

## 7. REST API

```
GET /api/state | keywords CRUD + POST /keywords/:id/scan | GET /signals | GET+POST /trends(/refresh)
GET /notifications + PATCH read + read-all | PATCH /settings | GET /meta/sources
POST /jobs/watch /jobs/trend | GET /events (SSE)
```

## 8. 前端设计（情报信号监视台）

深色"情报终端 x 粗野主义"：锐角粗边框、等宽字体、信号绿/告警琥珀/威胁红、雷达 LOGO、情报跑马灯、信号灯判定列表、热力编号榜、通知抽屉 + Toast + 桌面通知；Tailwind v4（@tailwindcss/vite + @import "tailwindcss"），响应式移动端单列。

## 9. Agent Skills（已交付）

skills/hot-monitor/SKILL.md + monitor.mjs：keyword/trend 两模式、--json/--mock、读取 .env Key；安装方法见 docs/SKILLS-GUIDE.md。

## 10. 里程碑（M1-M8 全部完成并实测）

骨架 -> 信源+AI -> 哨兵+通知 -> 热点雷达 -> 前端成稿 -> 测试（含 credible 迁移、编码损坏修复）-> Skills -> 验收交付。

## 11. 启动

```
npm install
copy .env.example .env   # 填入 OPENROUTER_API_KEY（TWITTER_API_KEY 可选）
npm run dev              # 开发 http://localhost:5173
npm run build && npm start  # 生产 http://localhost:3000
```

## 12. 已知环境约束（Windows 中文机）

- 工具写盘 GBK、Node/Vite 需 UTF-8：编辑前 enc.ps1 -Mode Tool，运行前 -Mode Node。
- 源码禁 emoji/GBK 外字符；外部工具反复错误保存会致乱码/替换符（不可逆时整文件重建）。
- 免费模型共享限流偶发 429（稍候重试）；付费模型需账号余额（402）。
