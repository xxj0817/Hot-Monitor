# Agent Skills 交付指南

把「热点监控 + AI 真伪识别」封装为可复用技能，交给其他 AI 使用。

## 1. 交付物

```
skills/hot-monitor/
  SKILL.md      技能元信息 + 完整使用说明（AI 自动阅读）
  monitor.mjs   自包含 CLI（无第三方依赖，Node 18+，内置 fetch）
```

不依赖本仓库服务端/数据库，仅需 `.env`（或环境变量）中的 OpenRouter Key。

## 2. 安装到目标 AI

复制整个 hot-monitor 文件夹到目标技能目录：

| AI 工具 | 目录 |
|---|---|
| Claude Code | `~/.claude/skills/hot-monitor/` |
| Cursor | `.cursor/skills/hot-monitor/` |
| VS Code Copilot（本机） | `C:\Users\<你>\.agents\skills\hot-monitor\` |
| 其他实现 | 按其约定放置含 SKILL.md 的目录 |

放置后重启/重载即可被发现。**保留 UTF-8 编码**（Windows 勿用 GBK）。

## 3. 使用示例（对 AI 说话触发）

- 「帮我盯着 Claude 有没有大新闻」-> `node skills/hot-monitor/monitor.mjs keyword "Claude" --limit 8 --json`
- 「最近 AI 编程圈有啥热点」-> `node skills/hot-monitor/monitor.mjs trend "AI 编程" --queries "AI 编程,大模型,coding agent,ai programming" --limit 10 --json`

无 Key 自动 mock 演示；`--mock` 强制。解读规则见 SKILL.md：仅 authentic/demo 为确认真消息，fake 警示，unverified 表述为「有讨论但未证实」。

## 4. Key 注入

- `.env`（脚本自动向上查找）或环境变量 `OPENROUTER_API_KEY`。
- 默认模型 minimax/minimax-m3:free，可用 `HOT_MONITOR_MODEL` 覆盖。
- `TWITTER_API_KEY`（twitterapi.io）可选。

## 5. 已验证（实测）

- keyword：Claude 官方来源判 authentic，镜像站/软广判 fake。
- trend：抓取当日 Twitter 讨论并排 A 级，Bing/知乎来源正常上榜。
- mock：无网/无 Key 可完整演示。

## 6. 注意事项

- 爬虫已控频（3s+），勿并发；单次 keyword 约 20-60s。
- 判定基于标题/摘要/域名，重要结论附来源链接人工核实。
- 目标环境无法联网时仅能 --mock。
