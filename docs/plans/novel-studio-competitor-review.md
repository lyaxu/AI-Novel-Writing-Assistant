# 竞品研究：伟妙云小说 Agent 3.0.11 的连载推进机制

研究日期：2026-10-02。对象为用户本机安装的第三方闭源工具（`%LOCALAPPDATA%\Programs\novel-studio`，数据目录 `C:\Users\lyaxu\Documents\Novel Studio`）。

**边界声明**：本研究只读取用户本机已生成的项目数据与打包资源，用于提炼**设计思路**；不复制其源代码、prompt 原文或配置到本仓库，也不向其程序写入任何内容。所有结论标注实际观察来源；未验证的部分明确标为未知。

## 研究缘起

用户用它写了《外卖骑手闯荡金庸群侠世界》第 1 卷 **35 章**（`chapters/chapter_001..035.md` 全部存在，`workflow.json` 记录 `latestCompletedChapter: 35`、卷终态 `VOLUME_REVIEW`），模型同样是 DeepSeek，**过程基本没有中断，剧情持续推进到卷终**。

这是对我们工具最直接的对照：我们此前的样本书在几十章后仍"兜兜转转"，而它跑完了一个完整卷。

## 观察到的机制（按重要性排序）

### 1. 卷有明确终点，且卷未验收不得开下一卷

`AGENTS.md`（项目模板，随每个项目生成）：

> 全书框架未经作者确认，不得生成正式卷纲。
> 当前卷详细大纲未经作者确认，不得写正文。
> 当前卷未完成并验收，不得生成下一卷正式详细大纲。

`runtime/workflow.json` 是一条线性持久状态机：

```
TOPIC_INPUT → BASIC_SETTINGS_CONFIRMATION → BOOK_PLAN_REVIEW → PROJECT_READY
→ VOLUME_OUTLINE_REVIEW → READY_TO_WRITE ⇄ WRITING → VOLUME_REVIEW
```

`READY_TO_WRITE` 与 `WRITING` 按批次交替（`chapter-job-started` / `chapter-batch-completed`），写完卷内最后一章才进 `VOLUME_REVIEW`。

**关键**：写作目标不是"一直写下去"，而是"写完当前这一卷"。这给模型一个可到达的终点。

### 2. 每章有 6—7 条"必须落实"，写的是事件不是主题

`outlines/volume_01_detailed_outline.md` 每章固定五段：

```
### 第 N 章 标题
- 摘要：（2—4 句，含因果）
- 视角：劳梓凡 / 黄蓉（局部切劳梓凡）
- 时间：1 / 2（章内时间刻度）
- 必须落实：6—7 条逗号分隔的具体事件（含 [伏笔:Mxxx] plant/hint 动作）
- 结尾钩子：一句具体的台词或画面
```

例（第 1 章"必须落实"之一）：

> 系统绑定：右手腕蓝色光纹，机械发布首单，收件人显示丘处机，地点襄阳城北门

这是**可逐条核对的事件**，不是"展现主角成长"这类主题。项目配置 `requireOutlineEntry: true`、`requireRequiredElements: true` 把它变成硬要求。

卷纲结构为三层：`## 卷目标`（1 条）→ `## 核心事件`（9 条）→ `## 章节规划`（35 章）。

### 3. 承诺账本带"推进节奏"和"截止章"

`data/promise_ledger.json` 每条承诺：

```json
{
  "id": "P001",
  "type": "核心类型承诺",
  "promise": "每一卷都会出现与'外卖送餐'机制强绑定的任务网络……",
  "introducedChapter": 1,
  "progressEvery": 5,            ← 每 5 章必须推进一次
  "nextProgressChapter": 37,     ← 下一次推进的章号
  "payoffDeadlineChapter": 280,  ← 兑现截止
  "majorPayoffVolume": 8,        ← 重大兑现所在卷
  "status": "active",
  "history": [ { "chapter": 15, "action": "payoff", "summary": "...", "evidence": "【订单完成·夜探驿站·取回布防图副本】" } ]
}
```

`history[].action` 取 `progress` / `payoff` 等有限集合，**每条都带正文引文**。

这是我在上一轮分析中判断我们缺失的"**阶段回报时钟**"——它有明确实现：**每 N 章必须推进 + 兑现有截止章**。

### 4. 兑现节奏写进了可执行配置

`data/review_policy.json`：

```json
"payoffCadence": {
  "smallWithinChapters": 5,     // 每 5 章至少一次小兑现
  "mediumWithinChapters": 20,   // 每 20 章至少一次中等兑现
  "majorPerVolume": 1           // 每卷至少一次重大兑现
},
"requireProgressEveryChapter": true,
"requireIndependentReview": true,
"blockOverduePromises": true,
"blockVolumeWithFailedReviews": true,
"advisoryThresholds": {
  "minSmallPayoffsPerChapter": 1,
  "minMediumPayoffsPerVolume": 2,
  "minMajorPayoffsPerVolume": 1,
  "minForeshadowingRecoveredPerVolume": 1,
  "maxOpenMysteriesAtVolumeEnd": 20,
  "maxUnresolvedPromisesAcrossVolumes": 3
}
```

注意最后两条是**上限**：控制悬置谜题和未兑现承诺的总量，防止无限挖坑。

### 5. 分数只做建议，阻断必须有证据 —— 且证据不足的阻断项会被忽略

```json
"scoringMode": "advisory",
"blockerMode": "evidence"
```

`reports/chapter_007_review.json` 是一个实例（该章经历了 5 次审稿尝试 `attempt_02..05` 才 PASS）：

```json
"status": "PASS",
"errors": [],
"warnings": [
  "已忽略证据不完整的审稿阻断项：状态更新将本章及前夜事件时间登记为'穿越后第二日晌午前后'，
   但正文只有'他早上只吃了一张饼'的馄饨摊场景，没有'晌午'字样；…"
],
"blockingIssues": []
```

**审稿模型提出了阻断项，但因为引文证据不完整，被程序忽略并降级为 warning，章节仍然 PASS。**

各维度分数都附 3 条正文引文（`dimensions.plot.evidence[]`），便于人工复核。

### 6. `chapter_001_check.json`：缺项一律是 warning，且措辞明确不做机械补写

```json
"status": "PASS", "errors": [],
"warnings": [
  "正文可能未充分落实规划要素：…（7 条 requiredElements 逐条列出）",
  "本章规划的'设定登场与第一悬念'没有被记录 Agent 确认为已发生；交由审稿 Agent 判断剧情目的是否仍然成立。",
  "承诺 P001 未按规划推进；作为编辑提醒，不要求正文配合字段。",
  "开篇目标 B1-1 没有被记录 Agent 确认为已完成；只检查阅读效果，不要求机械补写。"
]
```

三处措辞值得抄：

- "作为编辑提醒，**不要求正文配合字段**"
- "只检查阅读效果，**不要求机械补写**"
- "交由审稿 Agent 判断剧情目的**是否仍然成立**"

即：**硬要求在规划层（大纲必须写齐 requiredElements），软要求在检查层（未落实只提醒）**。这既保证了推进，又不会因为字段没对上就卡死整批。

### 7. 专职"记录者" Agent，而不是让写手自己总结

`settings.json`：

```json
"authorModel": "gpt-5.6-sol",        "authorThinking": "medium",
"recorderModel": "gpt-5.6-terra",    "recorderThinking": "low",
"reviewerModel": "gpt-5.6-terra",    "reviewerThinking": "low",
"escalationModel": "gpt-5.6-sol",    "escalationThinking": "medium",
"dialogueModel": "gpt-5.6-sol",      "dialogueThinking": "medium",
"cleanWorkerContext": true,
"timeoutSeconds": 1200, "transientRetries": 5, "maxChapterRetries": 4
```

五个角色分工：**写手 / 记录者 / 审稿者 / 升级处理 / 对话润色**。写手用强模型中思考，记录者与审稿者用弱模型低思考 —— 成本与质量分离。

`cleanWorkerContext: true` 说明每章工作上下文是干净的，不累积。

每一章后由记录者产出 `data/chapter_updates.json`：

```json
{ "number": 1, "title": "…",
  "characterStates": [ { "characterId": "C001", "currentState": "…", "evidence": "正文引文" } ],
  "foreshadowing":    [ { "id": "FS-…", "content": "…", "status": "planted", "evidence": "…" } ],
  "timeline":         [ { "time": "…", "event": "…", "evidence": "…" } ],
  "plotDatabase":     [ { "arcId": "A001", "change": "…", "evidence": "…" } ] }
```

**每一项都强制带正文引文** —— 这恰好是我们 Q25 想解决的问题（引文存在 ≠ 语义成立），他们用"记录者必须附引文"来约束。

### 8. 每章强制更新账本，且检查通过才同步

`.novel-studio.json`：

```json
"requireOutlineEntry": true, "requireRequiredElements": true,
"requireChapterUpdateLedger": true, "requirePassingCheckBeforeSync": true,
"checkRepeatedContent": true, "requireIndependentReview": true,
"maxRevisionAttempts": 6, "targetChineseChars": 3000, "maximumChineseChars": 5000
```

`AGENTS.md` 明确顺序：

> 每章完成后更新 `data/chapter_updates.json` 和受影响的专项资料。
> 每章先检查；只有检查通过后才能同步 Dashboard 并继续下一章。

### 9. 伏笔带编号、动作与计划揭晓卷

`data/foreshadowing.json`：

```json
{ "id": "M001",
  "question": "外卖系统为什么选中劳梓凡作为绑定宿主？",
  "truth": "（作者知道的真相）",
  "readerInfo": "读者在首单惩罚任务中首次看出系统并非简单工具…",
  "status": "partiallyRevealed",
  "plannedRevealVolume": 7,
  "action": "progress",
  "summary": "…", "evidence": "…", "latestChapter": 31,
  "history": [ { "chapter": 15, "action": "hint", "summary": "…" } ] }
```

`truth`（作者真相）与 `readerInfo`（读者已知）**分开存储**，`plannedRevealVolume` 锁定揭晓卷。大纲里的 `[伏笔:M001] hint：卷内仅呈现…完整答案留待第七卷` 与之对应。

### 10. 工程健壮性（从打包资源观察到）

- **实时轮转备份**：几乎每个数据文件都有 `.bak1/.bak2/.bak3`（如 `foreshadowing.json` 及其三代备份）。
- **启动自愈**：引擎含 `startup-recovery-<时间戳>` 逻辑，扫描损坏 JSON，用 `jsonrepair` 修复，修不了的隔离并归档；`registry.json` 损坏则重建项目索引。
- **分批生成**：全书框架分 3 段（foundation / characters / protocol）；卷纲超过 10 章自动走分批；章节按组生成。每段最多 2 次尝试，失败保留检查点续跑。
- **章节以独立 `.md` 落盘**（`chapters/chapter_NNN.md`，标题 `# 第 N 章 标题`），文件即真相。
- **API Key 加密**：`.secrets/<name>.json`，AES-256-GCM + 本机 install key。本次未读取该目录。

## prompt 层发现（第二轮，已读取打包资源）

用户确认对方作者允许评论者免费使用且本人不商业化后，我解码了打包 bundle 中的 Unicode 转义，读到了真实约束。以下为**概括**，不复制原文；落地一律用我们自己的 Prompt Registry 重写。

最重要的三条：

1. **章级 `requiredElements`**：每章至少三项，且**必须是正文中可明确落实的专名、事件或动作**——不是主题。这是推进感的直接来源。
2. **承诺升格为章级映射**：`promiseActions` 要求"凡本章到期或卷内负责的承诺必须映射"，配 `progressEvery` / `nextProgressChapter` / `payoffDeadlineChapter`。
3. **伏笔必须落进 `requiredElements`**："凡 `plannedRevealVolume` 等于本卷的伏笔，必须在对应章节的 `requiredElements` 中明确写出回收动作与真相揭示要求，不能只写在 mysteryPlan。"

还有一条直接命中我们的痛点——它明确禁止：

> 不得让所有人物都"先确认事实、再给结论、最后列方案"。

以及对人名的硬锁：正文中的姓名、简称、性别、代词必须严格服从，**未登记的简称禁止使用**。

完整的机制清单与逐条落地规划见 [竞品机制整合方案](competitor-borrow-integration-plan.md)。

## 与我们工具的对照

| 维度 | 它 | 我们（现状） |
|---|---|---|
| 卷级终点 | 卷状态机 + 未验收不得开下卷 | `completionProfile` 是书级（80 章），缺卷级 gate |
| 阶段回报时钟 | `progressEvery` + `payoffDeadlineChapter` + payoffCadence | `PayoffLedgerItem` 有 `targetStart/EndChapterOrder`，**无"每 N 章必推进"节奏** |
| 未落实字段 | warning，明示"不要求机械补写" | `progressionChecks=stalled` → `canEnterExecution=false` **硬阻断** |
| 分数用途 | advisory；阻断需证据；证据不足的阻断被忽略并留 warning | AGENTS 已是"不以分数代替判断"，但执行层仍有硬阻断 |
| 状态提取 | 专职 recorder Agent，逐项带引文 | acceptance 内嵌状态检查；无独立记录者 |
| 账本更新 | 每章强制，且检查通过才同步 | 有 NovelFactEntry/PayoffLedger，但**每章强制性与闭环性弱** |
| 伏笔 | 编号 + 动作 + 计划揭晓卷 + 上限控制 | `foreshadowing`/`payoff` 有目标窗口，缺"计划揭晓卷"与总量上限 |
| 崩坏恢复 | .bak 轮转 + 启动自愈 + jsonrepair | NovelSnapshot + SQLite；无启动期自愈 |
| 正文存储 | 独立 .md 文件 | SQLite `Chapter.content` |

## 可借鉴项（按对我们的价值排序）

### 第一优先：直接对抗"兜转"

1. **给承诺加推进节奏**：`PayoffLedgerItem` 增加 `progressEvery` / `nextProgressChapter`，并把"逾期未推进"变成**写前规划必须处理**的合同项，而不是写作后的 warning。
2. **加"每章至少一次小兑现"检查**：在写前任务单质量审查里加一条与 `progressionChecks` 并列的 cadence 检查。
3. **卷级终点强制**：即使书级目标是 80 章，也应有明确的卷边界与"本卷未验收不生成下卷大纲"的 gate。这直接对应我们 P2 阶段想解决的问题。

### 第二优先：让流程不再被弱证据卡死

4. **把"证据不足"从阻断降级为提醒**：区分"字段没对上"（提醒）与"语义确实断裂"（阻断）。我们的 `progressionChecks` 目前把 `insufficient_evidence` 也推进 `blockingIssues`，值得复核。
5. **引入独立记录者角色**：让正文的状态提取由专职步骤完成并强制附引文，而不是让写手或验收自述。这与我们 Q25 第二阶段方向一致，是一个更彻底的解法。
6. **悬置总量上限**：`maxOpenMysteriesAtVolumeEnd` / `maxUnresolvedPromisesAcrossVolumes` 的思想——防止无限挖坑。

### 第三优先：工程健壮性

7. **启动自愈 + .bak 轮转**：对我们的 SQLite/JSON 资产有直接参考价值。
8. **模型分工与思考档位**：写手强、记录/审稿弱，成本与质量分离。

## 需要保留的判断

- **不是"它做得全对"**：用户自己评价"文笔一般"。它的强项是**结构推进与不中断**，不是文学质量。我们不应为了推进而牺牲已有的质量门禁。
- **它是闭源商业工具**：可借鉴设计，不复制代码与 prompt 原文。
- **未验证项**：本次未逐条解码其打包 prompt（引擎为压缩 + Unicode 转义的单文件 bundle），因此"它的 prompt 怎么写"属未知；也未运行其程序、未读取 `.secrets`。可借鉴项是基于**数据产物与配置**反推的机制，不是对其内部实现的断言。
- **样本单一**：只观察了 1 个 35 章的卷（另有一个 3 章的早期项目 `novel-1002-146kjmr`）。"能跑完一卷"不等于"能跑完全书"，其第二卷以后的表现未知。

## 与现有工作的衔接

本研究的结论应并入 [工具优化目标任务书](tool-improvement-roadmap.md)：

- 第 1、2、3 项 → P2 阶段（让故事向前推进）
- 第 4、5 项 → P3-A（Q25 语义核对）+ 质量门禁复核
- 第 7 项 → 长期工程债

用户已明确"样本书不是重点，重点是修工具的通用 bug"，因此本研究的价值在于**提取机制**，而不是照搬它的输出。
