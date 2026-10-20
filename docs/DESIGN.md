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
skills/hot-monitor/   SKILL.md + README.md + scripts/(CLI 与 lib) + references/ + evals/（自包含技能）
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

## 9. Agent Skills（v2 自包含技能，已交付）

`skills/hot-monitor/` 是**完全独立、自包含**的技能目录：不需要启动本服务、不需要数据库、不复用服务端代码；
未配置 API Key 也能用（此时只做相关性判定，真伪一律输出 unverified "待核实"）。

```
skills/hot-monitor/
  SKILL.md                    技能说明（frontmatter + 何时触发 + 工作流 + 判定话术规范）
  README.md                   安装与快速开始（给人看）
  scripts/hot-monitor.mjs     CLI 入口（8 个命令）
  scripts/install.mjs         一键安装到 .agents/skills（工作区）/ ~/.agents/skills（用户级）
  scripts/lib/relevance.mjs   相关性闸门 + 查询扩展（本地规则，零依赖）
  scripts/lib/sources.mjs     多信源采集（360资讯/必应/360搜索 + B站 + 可选 X + mock）
  scripts/lib/ai.mjs          OpenRouter 判定/扩展（可选）+ 本地规则降级
  scripts/lib/evaluate.mjs    相关性用例评测
  references/usage.md         命令详解、输出字段、排错
  references/verdicts.md      判定语义与汇报话术
  evals/cases.jsonl           相关性用例集（17 条，含"该丢弃的反例"）
  evals/evals.json            技能自测提示词
```

| 命令 | 作用 |
|---|---|
| `scan <关键词>` | 采集 + 相关性闸门 + 判定，输出信号、证据（evidence/why）、覆盖度与丢弃统计 |
| `signals <关键词>` | 同 scan，只给"强相关且未判假"的结论清单 |
| `trend [领域]` | 领域热点榜（热度分级 S/A/B/C、多源印证、检索词命中数） |
| `judge <关键词> --title "..."` | 单条内容核验：相关性 + 真伪（供其他 AI 复核用） |
| `expand <关键词>` | 等价叫法 + 建议检索词（词序调换、加减修饰词、去助词、中英边界） |
| `eval [--ai]` | 判定质量自检（准确率/精确率/召回率/F1 + 误判清单） |
| `status [--net]` | 自检：Node / Key / 用例集 / 联网探测 |
| `help` | 帮助 |

关键设计：

- **相关性闸门**：关键词拆成实体词，未命中（含等价叫法变体）的内容直接丢弃、不消耗 AI 额度；账号型关键词（UP主/官方等）改走账号匹配。
- **查询扩展**：本地规则生成"同一对象的其他叫法"，同时用于扩大检索与放行合理内容；有 Key 时由 AI 补充别称并缓存到系统临时目录。
- **判定语义**：authentic / unverified / fake / unrelated / demo，汇报话术固定在 SKILL.md 与 references/verdicts.md（不得把"待核实"说成"已确认"）。
- **评测闭环**：`eval` 跑 evals/cases.jsonl，当前本地闸门 16/16 = 100%。
- 安装：`node scripts/install.mjs [--user]` → 工作区 `.agents/skills/` 或用户级 `~/.agents/skills/`（VS Code 自动发现）。

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
