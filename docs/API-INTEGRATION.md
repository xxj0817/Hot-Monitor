# API 对接与技术实现备忘（MCP 实时查证 2026-09）

> 开发前通过 MCP/官方文档实时查证的最新接入方式，防止用过时代码。

## 1. OpenRouter（AI）

- 端点 `POST https://openrouter.ai/api/v1/chat/completions`（OpenAI 兼容），头 `Authorization: Bearer <KEY>`。
- 可选追踪头 HTTP-Referer / X-OpenRouter-Title；原生 fetch 即可。
- 模型按 slug；`GET /api/v1/models` 列全部（含 :free）。
- 默认 minimax/minimax-m3:free（免费档实测可用）；付费模型需账号余额否则 402。
- Key 获取：openrouter.ai 注册 -> Keys。

## 2. twitterapi.io（Twitter/X）

- 第三方 X API，无需官方审核；免费 $0.1 起、按量 $0.15/千条。
- 头 `x-api-key: <KEY>`；Base `https://api.twitterapi.io`。
- Advanced Search：`GET /twitter/tweet/advanced_search?queryType=Latest&query=<expr>`，query 时间过滤用 `since_time`/`until_time`（Unix 秒），不支持 `since:YYYY-MM-DD...`；响应 `{tweets:[],has_next_page}`，每页最多 20 条。
- Tweet 字段防御性解析（id/text/full_text/user.username/created_at/like_count 均可变）。
- 官方另有 MCP/skill（kaitoInfra/twitterapi-io）可参考。

## 3. 无 API 网页搜索

- Bing：`https://www.bing.com/search?q=..&count=15&setlang=zh-hans&mkt=zh-CN`，解析 `li.b_algo`。
- DDG html：`https://html.duckduckgo.com/html/?q=..`，解析 `a.result__a`（uddg 还原），备用+静默失败。
- 串行 + 4~8s 间隔 + 随机 UA + 15s 超时；解析失败不抛错。

## 4. Tailwind CSS v4 + Vite

- `tailwindcss @tailwindcss/vite`；vite.config 加 tailwindcss() 插件；CSS `@import "tailwindcss";` 取代旧 directives；@theme 生成 utility。

## 5. Express 5 + better-sqlite3

- Express 5 稳定版用法兼容 v4（json/static/listen）；better-sqlite3 同步 API + WAL + 事务；Windows 预编译二进制。

## 6. 依赖版本（实测安装 2026-09）

- express 5.2 / better-sqlite3 13 / dotenv 17；react 19.2 / vite 8 / @vitejs/plugin-react 6 / tailwindcss 4.3 / concurrently 10。Node v24。

## 7. 本机编码环境备忘（重要）

- Windows 中文 locale：工具写盘 GBK，Node/Vite 期望 UTF-8。
- enc.ps1：编辑前 -Mode Tool（GBK），运行前 -Mode Node（UTF-8）。
- 源码只用 ASCII + 常用汉字 + GBK 中文标点；禁 emoji。
- 文件被外部工具反复错误保存会出现乱码与 ?/U+FFFD（部分不可逆）：repair.ps1 反转可逆部分，代码结构损坏（如引号丢失）需整文件重建。
