# HOT//MONITOR 热点雷达

面向 AI 编程博主的**热点自动发现与真伪识别**工具：多信源采集 -> AI 判定/聚合 -> Web 情报台展示 + 实时提醒，并交付可复用的 Agent Skills。

- 技术栈：Node + Express 5 + better-sqlite3 / React 19 + Vite + Tailwind CSS 4
- AI：OpenRouter（OpenAI 兼容接口），默认免费模型 `nvidia/nemotron-3-super-120b-a12b:free`（账号零充值可用，可换更强模型）
- 信源：网页搜索多引擎 Bing + 360搜索 + 百度(best-effort)（无 API 控频爬虫，多源交叉印证）、B站视频（无 Key，含 UP 主/博主/官方账号监控）、Twitter/X（twitterapi.io，去回复 + 热度门槛，可选）、演示源
- 文档：`docs/`（REQUIREMENTS / DESIGN / API-INTEGRATION / SKILLS-GUIDE）

## 快速开始

```bash
npm install                 # 安装依赖（首次）
copy .env.example .env      # Windows；然后填入 OPENROUTER_API_KEY（TWITTER_API_KEY 可选）

npm run dev                 # 开发：前端 http://localhost:5173 （代理 /api -> 3000）
npm run build && npm start  # 生产：http://localhost:3000 （单端口）
```

- 无 OpenRouter Key：AI 判定自动降级本地初判（结果标「存疑」，不误报），演示源保证全链路可跑。
- 无 twitterapi Key：Twitter 信源自动禁用并在界面提示。
- 首次启动会自动执行一轮「关键词哨兵 + 热点雷达」（默认每 30 分钟一轮，可在设置里改）。

## 功能

| 模块 | 说明 |
|---|---|
| 关键词哨兵 | 添加关键词（如 Claude）-> 定时扫描 -> AI 判定"是否真相关且可信"（拦截标题党/假消息/营销号/旧闻）-> 真信号实时提醒（页内 Toast + 浏览器桌面通知 + 通知中心） |
| 热点雷达 | 配置领域与检索词（默认"AI 编程"）-> 多信源采集 -> AI 去重聚合按热度（S/A/B/C）出榜 |
| 实时 | SSE 事件流推送新信号/新热点/扫描完成 |
| 设置 | 周期、模型、回看窗口、信源开关、领域检索词均可页面内调整 |

## 目录

```
server/    Express API + 调度器 + AI 编排 + 多信源适配器（SQLite 存储）
client/    React 情报台（Vite + Tailwind v4）
skills/hot-monitor/   Agent Skills（SKILL.md + 自包含 CLI monitor.mjs）
docs/      需求 / 设计 / API 对接备忘 / Skills 交付指南
tools/     编码工具 enc.ps1 / repair.ps1、AI 探针 probe.mjs
data/      运行时 SQLite 与 settings.json（git 忽略）
```

## Agent Skills（交给其他 AI）

把 `skills/hot-monitor/` 目录复制到目标 AI 的 skills 目录（Claude Code: `~/.claude/skills/`，Cursor: `.cursor/skills/`，VS Code Copilot: 用户 `.agents/skills/`），或在对话中直接引用脚本：

```bash
node skills/hot-monitor/monitor.mjs keyword "Claude" --limit 8 --json
node skills/hot-monitor/monitor.mjs trend "AI 编程" --queries "AI 编程,coding agent" --json
```

## 注意事项（Windows 中文机）

- 本机存在 GBK/UTF-8 编码差异：AI 编辑工具写盘为 GBK，Node/Vite 需 UTF-8。
- 统一用 `tools/enc.ps1`：编辑前 `-Mode Tool`（转 GBK），运行前 `-Mode Node`（转 UTF-8）；纯 ASCII 文件无需处理。
- 源码禁止 emoji 等 GBK 外字符；若文件被错误编码反复保存产生乱码/替换符，用 `tools/repair.ps1` 反转，不可逆则整文件重建。
- 网页爬虫已控频（请求间隔 3 秒+），请勿高频并发触发扫描。
- 免费模型有速率限制；大批量/生产使用可充值后在设置中切换更稳更强的模型。
