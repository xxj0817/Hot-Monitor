# Agent Skills 交付指南

把「热点监控 + 相关性/真伪判定」封装为可复用技能，交给其他 AI 使用。

技能 v2 是**完全自包含**的：不需要启动 Hot-Monitor 服务、不需要数据库、不复用服务端代码；
未配置 API Key 也能用（此时只做相关性判定，真伪一律输出 unverified「待核实」）。

## 1. 交付物

```
skills/hot-monitor/
  SKILL.md                    技能说明（AI 自动阅读：何时触发 + 工作流 + 判定话术规范）
  README.md                   安装与快速开始（给人看）
  scripts/hot-monitor.mjs     CLI 入口（8 个命令）
  scripts/install.mjs         一键安装脚本
  scripts/lib/relevance.mjs   相关性闸门 + 查询扩展（本地规则，零依赖）
  scripts/lib/sources.mjs     多信源采集（360资讯/必应/360搜索 + B站 + 可选 X + mock）
  scripts/lib/ai.mjs          OpenRouter 判定/扩展（可选）+ 本地规则降级
  scripts/lib/evaluate.mjs    相关性用例评测
  references/usage.md         命令详解、输出字段、排错
  references/verdicts.md      判定语义与汇报话术
  evals/cases.jsonl           相关性用例集（17 条，含「该丢弃的反例」）
  evals/evals.json            技能自测提示词
```

运行要求：Node 18+（需要内置 `fetch`）；可选 `OPENROUTER_API_KEY`（真伪判定与 AI 查询扩展）、`TWITTER_API_KEY`（X 信源）。

## 2. 安装到目标 AI

```bash
# 安装到当前工作区（VS Code 会自动发现 .agents/skills/）
node skills/hot-monitor/scripts/install.mjs

# 安装到用户级（所有项目可用）
node skills/hot-monitor/scripts/install.mjs --user     # ~/.agents/skills/
node skills/hot-monitor/scripts/install.mjs --claude   # ~/.claude/skills/
```

| AI 工具 | 目录 |
|---|---|
| VS Code Copilot（工作区级） | `<项目>/.agents/skills/hot-monitor/` 或 `.github/skills/hot-monitor/` |
| VS Code Copilot（用户级） | `C:\Users\<你>\.agents\skills\hot-monitor\` |
| Claude Code | `~/.claude/skills/hot-monitor/` |
| Cursor | `.cursor/skills/hot-monitor/` |

放置后重启/重载即可被发现。**保留 UTF-8 编码**（Windows 勿用 GBK）。

## 3. 使用示例（对 AI 说话触发）

- 「帮我盯着 Claude Sonnet 4.6 有没有新动态」→ `node scripts/hot-monitor.mjs scan "Claude Sonnet 4.6" --days 7 --json`
- 「AI 圈最近有什么热点」→ `node scripts/hot-monitor.mjs trend "AI 编程" --days 3 --json`
- 「这条消息可信吗」→ `node scripts/hot-monitor.mjs judge "GPT-6" --title "..." --json`
- 「这个关键词还有哪些等价叫法」→ `node scripts/hot-monitor.mjs expand "鱼皮的AI导航"`
- 「你判得准吗」→ `node scripts/hot-monitor.mjs eval`

无 Key 时只做相关性判定（verdict 一律 unverified）；`--mock` 可完全离线演示；`--json` 输出结构化结果。

## 4. Key 注入

- `.env`（脚本会向上查找：当前目录 → 技能目录 → 上级目录）或环境变量 `OPENROUTER_API_KEY`。
- 默认模型 `nvidia/nemotron-3-super-120b-a12b:free`，可用 `HOT_MONITOR_MODEL` 覆盖。
- `TWITTER_API_KEY`（twitterapi.io）可选；免费模型额度用尽（429）时自动降级本地判定。

## 5. 已验证（2026-10-14 实测）

- `eval`：本地相关性闸门 **16/16 = 100%**（含 openClaw 反例、鱼皮改写例子、版本号差异用例）。
- 真机 `scan "Claude Sonnet 4.6"`：采集 40 条 → 闸门丢弃 27 条（no-term=4 / low-coverage=23）→ 5 条信号，带 evidence/why/coverage。
- 真机 `trend "AI 编程"`：采集 35~45 条 → 榜单以当日新闻与高播放视频为主（教程类与低播放视频已被质量过滤剔除）。
- `judge` 反例：「openClaw 使用体验」对关键词 `Claude Sonnet 4.6` → 相关=0、覆盖度 0%。

## 6. 注意事项

- 采集为串行 + 控频（每请求约 3 秒），单次 `scan` 约 30~90 秒；不要并发调用多次。
- 目标站点可能风控（如百度/X），失败只少一个信源，不影响整体结论。
- 判定语义严格：`unverified` 只能说「有讨论、未证实」；`fake` 不得当事实引用；每条结论都要带来源链接。
- Key 只从环境变量/`.env` 读取，不要写进任何输出或提交到仓库。
