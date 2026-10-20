# hot-monitor 技能（自包含）

把 Hot-Monitor 的热点监控能力打包成一个**独立技能**：任何 AI 助手（VS Code Copilot / Claude Code / Cursor ...）加载它之后，就能帮你盯关键词、看领域热点、核验单条资讯。

**完全自包含**：不需要启动 Hot-Monitor 服务、不需要数据库、不需要 npm 依赖；未配置 API Key 也能用（只做相关性判定，真伪判定需要 Key）。

## 目录结构

```
hot-monitor/
  SKILL.md              技能说明（AI 自动阅读：何时触发 + 工作流 + 话术规范）
  README.md             本文件（给人看：安装与快速开始）
  scripts/
    hot-monitor.mjs     CLI 入口（8 个命令）
    install.mjs         一键安装到 AI 的技能目录
    lib/
      relevance.mjs     关键词相关性闸门 + 查询扩展（本地规则）
      sources.mjs       多信源采集（360资讯/必应/360搜索 + B站 + 可选 X + 演示数据）
      ai.mjs            OpenRouter 判定与扩展（可选；无 Key 自动降级本地规则）
      evaluate.mjs      相关性用例评测（准确率/误判清单）
  references/
    usage.md            命令详解、输出字段、排错
    verdicts.md         判定语义与汇报话术
  evals/
    cases.jsonl         相关性用例集（17 条，含"该丢弃的反例"）
    evals.json          技能测试提示词
```

## 安装

```bash
# 装到当前工作区（VS Code 会自动发现 .agents/skills/）
node skills/hot-monitor/scripts/install.mjs

# 装到用户级，所有项目都能用
node skills/hot-monitor/scripts/install.mjs --user      # ~/.agents/skills
node skills/hot-monitor/scripts/install.mjs --claude    # ~/.claude/skills
```

技能发现路径：`.agents/skills/`、`.github/skills/`、`.claude/skills/`（工作区级）；`~/.agents/skills/`、`~/.claude/skills/`、`~/.copilot/skills/`（用户级）。

## 快速开始

```bash
# 自检（不需要 Key）
node scripts/hot-monitor.mjs status

# 离线演示（不需要网络、不需要 Key）
node scripts/hot-monitor.mjs scan "Claude Sonnet 4.6" --mock --json

# 真实采集（未配 Key 时：只有相关性判定）
node scripts/hot-monitor.mjs scan "Claude Sonnet 4.6" --days 7 --limit 8

# 领域热点榜
node scripts/hot-monitor.mjs trend "AI 编程" --days 3 --limit 10

# 单条内容核验
node scripts/hot-monitor.mjs judge "GPT-6" --title "GPT-6 向全球用户开放！"

# 判定质量自检
node scripts/hot-monitor.mjs eval
```

## 可选配置（都不是必需的）

| 变量 | 作用 | 缺失时 |
|---|---|---|
| `OPENROUTER_API_KEY` | 启用 AI 真伪判定与 AI 查询扩展 | 降级为本地规则判定，`verdict` 一律 `unverified` |
| `TWITTER_API_KEY` | 启用 X/Twitter 信源（twitterapi.io） | 只用网页搜索 + B 站 |

脚本会从当前目录向上查找 `.env`（因此放在 Hot-Monitor 项目内可直接复用项目 `.env`），也支持直接设置环境变量。

## 与 Hot-Monitor 网页版的关系

- 网页版（本项目 `server/` + `client/`）负责**常驻运行**：定时扫描、入库、桌面通知、可视化情报台。
- 本技能负责**被 AI 按需调用**：一次性查询，结构化输出，无状态、零部署。
- 两者的判定标准一致（同一套相关性闸门 + 证据字段），但实现是独立的（技能自包含，不复用服务端代码）。
