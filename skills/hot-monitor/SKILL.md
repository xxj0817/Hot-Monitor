---
name: hot-monitor
description: >-
  AI 热点监控与发现技能。当用户想要监控某个关键词/产品的动态、第一时间了解某
  领域（如 AI 编程、大模型）的最新热点、识别资讯真伪（过滤标题党/假消息/营销
  号）时使用。自动执行：多信源采集（Bing/DuckDuckGo 网页搜索 + 可选 Twitter/X
  高级搜索）-> OpenRouter AI 判定相关性与真实性 -> 输出结构化热点/信号。
---

# hot-monitor：AI 热点雷达技能

给 AI 使用的「热点监控 + 真伪识别」工具。你（AI）调用本技能内置脚本，即可：

- 监控某关键词是否出现「真实可信」的新动态（并区分真消息 / 假消息 / 无关蹭词）。
- 自动发现某领域（范围）的最新热点，按热度输出榜单。

## 前置条件

- 需要 Node.js 18+（建议 20+），脚本无第三方依赖（仅用内置 fetch）。
- OpenRouter Key（可选，但强烈建议）：项目 `.env` 或环境变量 `OPENROUTER_API_KEY`。
  - 无 Key 时自动进入离线演示模式（结果带 `mode: "mock"` 与演示数据）。
  - 模型：默认 `minimax/minimax-m3:free`（免费可用），可用 `HOT_MONITOR_MODEL` 覆盖。
- Twitter/X（可选）：`.env` 的 `TWITTER_API_KEY`（twitterapi.io），无则自动跳过 Twitter 信源。
- 注意：脚本含中文，需以 UTF-8 保存/运行（Windows 下勿用 GBK）。

## 使用方式

先定位脚本目录：本技能文件同级下有 `monitor.mjs`。在项目根目录执行：

### 1) 监控关键词（判断某关键词是否出现真动态）

```bash
node skills/hot-monitor/monitor.mjs keyword "Claude" --hours 24 --limit 8 --json
```

参数：

| 参数 | 说明 | 默认 |
|---|---|---|
| keyword <词> | 要监控的关键词 | 必填 |
| --hours N | 只看最近 N 小时 | 24 |
| --limit N | 最多判定 N 条（控制 AI 成本） | 8 |
| --json | 输出 JSON（推荐机器解析） | 关 |
| --mock | 强制离线演示模式 | 自动 |

每条结果含 AI 判定字段：`verdict`（authentic 真实可信 / fake 假消息或营销 / unrelated 无关蹭词 / unverified 无法验证）、`related`、`authentic`、`score`、`reason`（一句话理由）。

**AI 如何解读**：只有 `verdict === "authentic"`（或 `demo`）的条目才应告知用户「确认是真消息」；`fake` 明确提醒用户是假/营销内容；`unrelated` 是标题党蹭词；`unverified` 只能说「有相关讨论，但真实性未能确认」。不要擅自把 unverified 当真实发布。

### 2) 发现领域热点（趋势榜单）

```bash
node skills/hot-monitor/monitor.mjs trend "AI 编程" --queries "AI 编程,大模型,coding agent,ai programming" --limit 10 --json
```

参数：`trend <领域名>`、`--queries "词1,词2,..."`（中英文检索词，逗号分隔，可省略）、`--limit`、`--hours`、`--json`。

返回按 `heat`（0-100）降序的榜单，含 `level`（S/A/B/C）、`title`、`url`、`source`、`summary`。

## 输出示例（--json，keyword）

```json
{
  "tool": "hot-monitor",
  "action": "keyword",
  "keyword": "Claude",
  "mode": "openrouter",
  "model": "minimax/minimax-m3:free",
  "count": 6,
  "items": [
    {
      "title": "Anthropic 发布 Claude 新版本…",
      "url": "https://example.com/...",
      "source": "bing",
      "verdict": "authentic",
      "related": 1,
      "authentic": 1,
      "score": 88,
      "reason": "官方渠道发布，信息具体可信"
    }
  ]
}
```

## 注意事项（务必转告用户或据此行事）

- 网页搜索为无 API 爬虫：**内部已控频**（请求间隔 3 秒+），不要并发调用本脚本；单个关键词扫描通常 20~60 秒。
- 免费模型有速率限制：大批量任务请分批或稍候重试。
- Twitter 高级搜索仅返回最近约 24 小时内推文（`since_time` 过滤），且 `-is:retweet` 已排除转推。
- 判定为「演示(mock)」的条目 URL 为 `demo.hotmonitor.local`，不可作为真实来源引用。
- 判定的「真实性」基于标题/摘要/域名推断，**不能替代点开原文核实**；对 high-stakes 结论应建议用户查看来源链接。
- 脚本退出码 0 = 成功；网络/Key 错误会打印错误到 stderr 并以非 0 退出。
