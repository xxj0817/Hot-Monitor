# 命令详解与排错

## 运行前提

- Node.js 18+（需要内置 `fetch`、`AbortSignal.timeout`）；本技能**只依赖 Node 标准库**。
- 可选：`OPENROUTER_API_KEY`（开启 AI 真伪判定与 AI 查询扩展）、`TWITTER_API_KEY`（twitterapi.io，开启 X 信源）。
- 不需要启动 Hot-Monitor 服务、不需要 SQLite、不需要任何 npm 包。

脚本路径（相对技能目录）：`scripts/hot-monitor.mjs`。如果当前工作目录不在技能目录内，用绝对路径调用即可——脚本会自动向上查找 `.env`。

## 命令一览

```
node scripts/hot-monitor.mjs scan <关键词> [选项]
node scripts/hot-monitor.mjs signals <关键词> [选项]
node scripts/hot-monitor.mjs trend [领域] [选项]
node scripts/hot-monitor.mjs judge <关键词> --title "标题" [--summary "摘要"] [--url "链接"]
node scripts/hot-monitor.mjs expand <关键词>
node scripts/hot-monitor.mjs eval [--ai] [--cases 文件] [--limit N] [--verbose]
node scripts/hot-monitor.mjs status [--net]
```

## 输出信封（--json）

所有命令输出同一个外壳，便于程序化处理：

```json
{
  "ok": true,
  "skill": "hot-monitor",
  "version": "2.0.0",
  "action": "scan",
  "generatedAt": "2026-10-14T10:00:00.000Z",
  "mode": "ai | no-key | mock | live",
  "window": { "days": 7, "since": "..." },
  "gate": {
    "rules": { "minCoverage": 1 },
    "variants": ["Sonnet 4.6", "4.6 Sonnet Claude"],
    "expandTerms": ["Sonnet 4.6"],
    "dropped": { "no-term": 3, "low-coverage": 1 },
    "droppedSamples": [{ "title": "...", "source": "bing", "reason": "no-term", "coverage": 0 }]
  },
  "stats": { "collected": 21, "kept": 4, "engines": ["so360news", "bing", "so360"] },
  "items": [],
  "warnings": [],
  "advice": ["..."]
}
```

条目字段：

| 字段 | 含义 |
|---|---|
| `title` / `url` / `source` / `author` | 标题、链接、信源、作者 |
| `publishedAt` / `ageHours` | 发布时间与距今小时数（`null` = 来源没给时间） |
| `engineCount` / `corroborated` | 被几个独立信源同时报道 / 是否多源印证 |
| `verdict` | 判定：authentic / unverified / fake / unrelated / demo |
| `related` | 1 = 通过关键词相关性闸门 |
| `score` | 0-100：有 AI 用 AI 评分，无 AI 用本地热度分 |
| `coverage` | 关键词覆盖度 0-1（1 = 全部实体词命中） |
| `evidence` | **原文逐字摘录**的相关性证据（AI 判定时来自模型，本地判定时是命中的词/变体） |
| `why` | 该证据为何说明"与关键词相关" |
| `reason` | 真伪判定理由 |
| `model` | 实际使用的模型；`local` 表示走了本地降级 |

## 各命令细节

### scan / signals

1. **查询扩展**：本地规则生成等价叫法（换序、加减修饰词、去助词、中英边界、去版本号），有 Key 时再用 AI 补充别称；结果缓存在系统临时目录，跨调用复用。
2. **采集**：`--engines` 指定的搜索引擎（默认 `so360news,bing,so360`）依次执行；B 站默认开启（账号型关键词如 "@老耗游戏UP主" 会自动只抓该账号投稿）；`TWITTER_API_KEY` 配置时并入 X 结果。
3. **去重/印证**：按 URL 归一化 + 标题归一化去重；同一内容被多个信源报道时记 `engineCount`。
4. **相关性闸门**：未命中关键词实体词（及扩展变体）的内容直接丢弃，不进入判定，因此**不需要**为它消耗 AI 额度。账号型关键词改用"账号名是否出现/是否该账号投稿"判断。
5. **判定**：有 Key 走 AI（输出证据与真伪）；无 Key 走本地规则（`unverified`）。

`signals` 与 `scan` 的唯一区别：只保留 `related=1` 且 `verdict not in (fake, unrelated)` 的条目。

### trend

多检索词（`--queries`）采集 → 去重 → 交叉印证 → 热度分级。热度 = 新鲜度 + 来源数 + 互动量 + 命中检索词数，等级 S/A/B/C。领域话题宽泛，**不套用**覆盖度门槛，只用 `--exclude` / `--must`。

### judge

只做单条判定，不采集。适合：
- 用户贴来一条资讯要你判断可信度；
- 你已经从别处拿到内容，想用统一标准复核相关性。

`coverage=0` 且 AI 未给出证据时，结果会被强制为 `unrelated`（硬规则，防止模型"脑补相关"）。

### expand

输出 `local`（本地规则变体）、`ai`（AI 变体，需 Key）、`aliases`（实体别名）、`searchTerms`（建议直接用于检索的 1-2 个词）。适合在别处做检索时使用。

### eval

用例集默认 `evals/cases.jsonl`，每行一条：

```json
{"id":"unrelated-openclaw-0","keyword":"Claude Sonnet 4.6","title":"openClaw 使用体验","summary":"...","source":"websearch","expected":0,"note":"同领域但无关的内容，应丢弃"}
```

`expected=1` 表示"应保留"，`0` 表示"应丢弃"。输出准确率/精确率/召回率/F1 与误判清单。

## 排错

| 现象 | 原因与处理 |
|---|---|
| 某信源无结果 | 目标站点风控/改版。看 `warnings`；换 `--engines`；不影响其它信源 |
| `warnings` 里出现 `openrouter 429` | 免费模型额度用尽；稍后重试或 `--model` 换模型；此时会自动降级本地判定 |
| 全部为空 | 关键词太冷门或时间窗太窄；加大 `--days`；先用 `--mock` 验证链路 |
| 中文输出乱码（Windows） | 终端代码页问题；用 `--json` 或把输出重定向到文件后再看 |
| 想彻底离线 | `--mock`：不联网、不需要 Key |
| 采集很慢 | 控频所致（每个请求间隔约 3 秒）。减少 `--engines`、`--no-bili`、`--expand-queries 0` 可提速 |
