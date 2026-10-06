# 交接：断言型校验治理与生成侧重复修复

日期：2026-10-05
分支：`codex/book-story-foundation`（无上游，全部提交在本地，未 push）
HEAD：`3a3abb3e`

本文档写给下一个接手窗口。**先读本文，再读 `docs/handoffs/CURRENT.md` 与其快照。**
本窗口的工作是"让工具不再用固定字符串规则冒充语义判断，并让报错带上现场"。

---

## 一、本窗口的出发点

用户原话：

> 这几部测试小说不是重点，重点是修工具的通用 bug。我可以另开新书配合修复，
> 不需要反复把同一本样书抠到完美。

用户反复表达的三条不满：

1. **修了状态不更新**
2. **重新点击修复不知道拦截**
3. **同一个问题反复报错**

第 3 条是本窗口的主线。本窗口共定位到 **四类** 同一根因的缺陷：
**判定太死 + 报错不说现场 + 给出做不到的指令。**

---

## 二、用户明确的工作规则（务必遵守）

- **不要闭门造车地改。** 用户说："你说的这一大堆我都没看完，晚些再看吧。" → 回复要短，
  只针对他报告的阻塞点行动。
- **不要为了省 token 压数值。** 原话："不要为了省token特意把这个数值控制住，token管够。"
- **报错要带证据，一次性收掉。** 原话："这类'报错要带证据'的问题，支持你一次性收掉。"
- **每批完成后一句话说明，不写长报告。**
- **数据都是测试数据，可以随便动**（但破坏性操作前仍要有备份）。
- **界面观感验收归用户**，我这边只做代码级验证。
- **绝不自动生成正文、不恢复导演、不切分支、不改样书正文。**
- **提交保持在本地。**

---

## 三、已完成的提交（按时间顺序，全部本地）

| 提交 | 内容 |
|---|---|
| `08e99b7c` | 正文大段重复的成因（补丁守卫）+ 审计点名的 R1/R3 两处 |
| `0d5d89ed` | **删掉用 6 张中文关键词表判章节质量**，改成模型自述 + 结构校验 |
| `2c15a3eb` | **拆章时看不到已写正文** → `chapter_list` 补 `written_evidence` |
| `78b4da01` | R2 第一批 11 处：`plannerPlan` 9 + `payoffLedgerSync` 2 |
| `688f9cea` | R2 第二批 15 处：三个连续性证据校验文件 |
| `59d49dd1` | R2 第三批上半 12 处：`shortStory` 8 + `creationIntent` 4 |
| `dfd18d9e` | **整章改写不再一次索要 2-3 份完整正文**（8192 报错根因） |
| `feeef023` | 整章改写每个候选各自限时 4 分钟，卡住的模型不拖垮整次 |
| `3a3abb3e` | 合同证据引用允许近似逐字（多一个代词不再卡死流水线） |

更早的（本窗口之前或早期）见 `git log`。

---

## 四、四类缺陷的根因与修法（核心知识）

### 类型 1：该忽略的差异没忽略（R1）

**现象**：模型引用一段逐字正确的原文，只因格式差异被拒。

已修三处：

- `services/planner/payoff/index.ts` 契约证据校验
  - 第一次修：字段是 JSON 时，原始序列化里的转义导致匹配不上
  - 第二次修：`mustAvoid`/`expectation`/`hook` 是**纯文本**，走原样 `includes`，
    多一个换行或缩进空格就失败 → 改为忽略空白比对
  - 第三次修（`3a3abb3e`）：模型引文前多写一个"他"字 → 增加**最长公共子串占比 ≥85%**
    的近似判定；引文短于 16 字不做近似
  - 同一函数上方的 `planningQuote` 是姊妹检查，曾长期漏改，已一并修正
- `semanticReview/index.ts` 的 `affectedChapterIds` 用 `JSON.stringify` 逐字符比对，
  而 schema 与提示词都没规定顺序 → 改为按集合比对

**教训**：修一处时，**先搜同一文件/同一函数的姊妹检查**，否则同类报错会换个字段继续出现。

### 类型 2：报错不说现场（R2）—— 数量最多

**现象**：报错只说"不匹配"，不说实际值、来源、是哪一条。

已修 38 处（三批）。修法是**只加实际值/来源，不动判定逻辑**：

- R2 第一批 11 处：`prompting/prompts/planner/plannerPlan.prompts.ts`（9）、
  `prompting/prompts/payoff/payoffLedgerSync.prompts.ts`（2）
- R2 第二批 15 处：`volume/evidence/narrativeProgressionEvidence.ts`（6）、
  `planningPromiseEvidence.ts`（6）、`issueCheckProjection.ts`（3）
- R2 第三批上半 12 处：`shortStory/shortStory.prompts.ts`（8）、
  `creation/creationIntent.prompts.ts`（4）

**未完成：第三批剩下约 8 处**，见第六节。

### 类型 3：给出做不到的指令（R3）

- 章节规划修复要求模型改 `title`，而修复提示词**禁止**改 `title`、补丁 schema 里
  **没有** `title` 字段 → 硬死锁，每次重试都撞同一面墙。（本窗口之前已修）
- 审计仍列出 2 处未修的 R3：
  - `services/novel/director/recovery/planningRepair/advice/semanticReview/index.ts`
    （顺序敏感，已在本窗口修掉，见类型 1）
  - `prompting/prompts/world/worldDraft.prompts.ts:392`（"弱势力"判据要求每个势力
    都有地点，但提示词没写这条规则）—— **未修**

### 类型 4：用固定字符串规则冒充语义判断（违反 AI-first）

- `chapterList.prompts.ts` 的 `getChapterFunctionQualityIssue` 曾用 **6 张中文正则表**
  判断章节质量（摘要空泛、主动行动不足、连续被动、缺少兑现、结尾钩子）。
  **已改为**：模型自己在输出里声明每章的 `protagonistAction` 与 `chapterPayoff`，
  代码只检查**声明在不在**、以及**相邻两章是否声明同一件事**。
  净删 58 行。提示词 `novel.volume.chapter_list` v12→v14。
- 新增字段在 schema 里设为 **可选**（避免模型偶发漏填时在 schema 层硬失败），
  由校验点名到具体章节，走既有重试回路补齐。

---

## 五、正文大段重复：两个独立成因（重要）

### 成因 A：合同本身要求重复已写过的场面

样书《外卖小哥的茅山葫芦》第 4 章的 `requiredElements[1]` 写着
"王姨追问钱来路，劳梓凡谎称客户打赏"，而第 2 章正文已经写过这一幕。

**根因不在合同生成，在更上游的拆章**：

```
节奏段(拆章) → 章节细化(合同) → 正文生成
```

`chapter_list` 提示词的 `contextPolicy.requiredGroups` 只有
`["book_contract","target_volume","target_beat_contract"]`，**没有 `written_evidence`**，
所以**排章时看不到已经写了什么**，排出"再次交租、再被问一遍"，合同再照着细化。

合同生成侧其实**已有**规则"旧计划若要求重复已完成事件，不得把它当成仍必须完成的新事件"
（`chapterDetail.prompts.ts` 的 `progressionRule`），但它手里只有计划、没有已写正文可对照，
**规则落不了地**。

已修：`written_evidence` 加进 `requiredGroups`（该上下文块早已存在，
见 `volume/contextBlocks.ts:318`），并新增两条规则（v13→v14）。

### 成因 B：补丁式修复把已有段落又写了一遍

第 4 章只有一次自动尝试，类型 `quality_repair`（`light_repair`，`retryCount=1`，
17 次模型调用），正文 `updatedAt` 比它晚 53 秒 → 正文就是这次产出的。

补丁应用代码本身是安全的（每次重新定位、目标有歧义就拒绝、是替换不是追加），
**重复来自模型给出的 `replacement` 文本**。提示词写了"不要改写无关段落""压缩无增量重复"，
但**没有任何代码检查**。

已修（`08e99b7c`）：`applyChapterPatchRepairPlan` 增加守卫——查"这次新加的文字里
是否有 ≥24 字是正文已有的"，有则拒绝并说明重复的是哪一段。
只查补丁新增部分，不查全章是否重复（后者会把补丁没造成的重复算在它头上）。

### 还有一个未修的结构性问题（B 项）

**重新生成一个节奏段时，会把它覆盖的已写章节也重新规划一遍。**

用户实跑：第 1-4 章已全部 `completed`，他重生开篇节奏段 `first_escalation`，
得到的 4 章内容正是第 1-3 章已写内容的重排（交租、亮出葫芦、被偷拍）。
他看到的还只是预览（`VolumeChapterPlan` 的标题未变）。

**根因**：`volumeChapterListGeneration.generateBeatChunkedChapterList`（约 L298）
拿到 `targetVolume` 但**无法从中看出哪些章已有正文**（document 里只有 `title` 这类计划字段），
所以照单全收地重排。

**修法（已摸清，待落地）**：在该函数入口按章节序号查一次数据库，取到已写章节，然后

- 全部已写 → 直接拒绝，并告知哪几章已写、无需重生
- 部分已写 → **只生成未写的那几章**，已写的原样保留

触发路径：`POST /:id/beats/generate` → `novelService.createBeatStream`
→ `generateBeatChunkedChapterList`。

**注意**：新书一章未写，永远不会触发此问题 —— 用户新开书重跑不受影响。

---

## 六、未完成事项

### 1. R2 第三批剩余约 8 处（审计已点名）

`chapterDetail.prompts.ts`、`characterMind.prompts.ts`、`chapterArtifactDelta.prompts.ts`、
`characterResource.prompts.ts`、`storyMode.prompts.ts`、`image.prompts.ts` 等。
做法与前三批一致：只加实际值/来源，不动判定逻辑；改完升版本 + 同步 loader 与
`prompting.test.js`；跑对应回归。

### 2. 上述 B 项（节奏段重生跳过已写章节）

### 3. 未修的两处 R3

- `worldDraft.prompts.ts:392` 的"弱势力"判据
- `worldDraft` 相关的 `counts.forces` / `counts.locations` 独立下发问题

### 4. 审计中"无法判定"的条目

审计报告列了 5 条无法判定的（`planningPromiseEvidence.ts:32` 的 `handoffStatus` 自洽规则、
`chapterDetail.prompts.ts:125`、`newIssueEvidence.ts:61` 的归因是否夸大、
`chapterAcceptance.prompts.ts:409`、`plannerPlan.prompts.ts:161-217` 是否死代码）。
详见该次审计的完整报告（本窗口内由子代理产出）。

### 5. 文档

- `docs/releases/release-notes.md` 与 `README.md` 的最新更新**本窗口未同步**
  （违反 AGENTS.md 的 README Release Notes Workflow）。下一个窗口应补。
- 本次改动涉及的 wiki 页面（prompting 边界、章节生产链）**未更新**。

---

## 七、环境与坑（新窗口必读）

- **Node**：`C:\Users\lyaxu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- **Python**：同目录 `..\python\python.exe`
- 测试需 `$env:SQLITE_ENABLE_WAL='false'`
- PowerShell 5.1：无 `?.`；**`git commit` 一律用 `-F <文件>`**，不要用带引号的 `-m`
- **`Get-Content`/`Set-Content` 往返会损坏 UTF-8 中文**：改中文一律用 `edit` 工具，
  或用 Python 显式 `encoding="utf-8"`
- Python 脚本里**多行字符串必须用三引号**（本窗口踩过两次语法错误，
  而且失败是静默的 —— 补丁根本没应用）
- **不要用内联 `python -c` 写带引号的代码**（会被 PowerShell 引号规则吃掉），
  写成 `.py` 文件再执行
- 只读查库：`sqlite3.connect(f"file:{db}?mode=ro", uri=True)` + `PRAGMA query_only=ON`
- 数据库：`server/dev.db`；样书 novelId `cmutopjpz000cisw0956kxe8m`

### 版本升级的连带影响（本窗口踩过 4 次）

改提示词后必须同步：`promptAssetLoaderEntries.ts`、`server/tests/prompting.test.js`，
**以及按 `(id, version)` 分开取值、不会被字符串替换命中的测试**。
本窗口因此被打断的测试有：`planningRepairAdvice`、`chapterTaskSheetQualityGate`、
`shortStoryWorkflowContracts`、`plannerPayoffSemanticRetry`。
**升版本后务必全量搜一遍旧版本号。**

### 测试基线（2026-10-05）

- 全量约 2187 项，**既有失败**（非本窗口造成，判据是错误文本可复现）：
  - `planningRepairAdvice` 与 `planningRepairPausedRecovery`：
    `Unmocked dependency/boundary: ../pipelinePause`
  - `prompting-governance` 8/9：`ComicFactService` 内联提示词
  - `payoffLedgerShared` 8/9
  - `promptContextBrokerRuntime`：断言 chapterWriter 的上下文组列表已过时
  - `promptWorkbench`：断言 `novel.chapter.writer@v9`，注册的是 `@v12`
  - RAG 系列、real-sqlite-chain、`novel*` harness 加载错误

---

## 八、两条被证据推翻的判断（记下来，避免重犯）

1. 曾判断"第 3 章对话回合重复"——三方探针反驳：16 个回合没有一个是无信息量的，
   真实缺陷是"说出口的立场被推翻却没有新依据"。
2. 曾把 `manual_create` 任务与 `auto_director` 任务直接对比得出结论，
   **没有先检查 `lane`** —— 结论错误。

**还有一次更该记住的**：设计文档与 wiki 曾**错误地**声称 `validateState` 守卫了
`rebase`（实际守卫的是 `save`），导致 `rebase` 的缺口被漏掉，放弃了的修复会话能被复活。

> **用户最在意的一条**：说"已经守住了"之前，**必须先验证那个守卫真的在执行路径上**。

---

## 九、样书当前状态

《外卖小哥的茅山葫芦》novelId `cmutopjpz000cisw0956kxe8m`

- 第 1-4 章 `completed`（第 4 章 4103 字，仍有"交租 + 王姨追问"的重复）
- 第 5-27 章 `unplanned`
- 第 4 章合同仍是旧的：`requiredElements[1]` = "王姨追问钱来路，劳梓凡谎称客户打赏"，
  `scenes` 含 `scene1_rent_payment`（三楼楼道交租）
- `VolumeChapterPlan`：卷 1 有 27 章计划，标题未变（用户那次重生只是预览）
- **用户已决定放弃在这本书上继续纠缠**，改为新开书测试

另有一处历史遗留：卡住的任务 `cmuuxlxjb0000low0xynuz0i3`
（`status=running`、`pendingManualRecovery=1`、`created=updated=2026-10-05T07:31:56`），
可用「退出导演模式」→「确认退出并取消任务」清掉。

---

## 十、建议的下一步（按优先级）

1. **R2 第三批剩余 8 处**收尾（与前 38 处同法，风险低）
2. **B 项**：节奏段重生跳过已写章节（结构性问题，用户明确要求做）
3. **补 `docs/releases/release-notes.md` 与 `README.md`**（本窗口欠账）
4. 更新 wiki：`docs/wiki/prompts/` 补"引用校验的容错边界"，
   `docs/wiki/workflows/` 补"节奏段重生与已写章节的关系"
5. 未修的两处 R3

---

## 十一、关于 K3 的事实（避免重复排查）

代码 `llm/factory.ts:302-306` 对 `kimi-k3` 有专门通道：

```ts
const kimiCompletionBudget = requestProtocol === "openai_compatible"
  && model.toLowerCase() === "kimi-k3"
  && ["api.moonshot.cn", "api.moonshot.ai"].includes(new URL(baseURL).hostname)
  ? Math.max(32_768, resolvedMaxTokens ?? 0)
  : undefined;
```

即：**精确的模型名 `kimi-k3` + Moonshot 官方域名** 时给 32768，并跳过 8192 的族限制。

用户的配置（自定义厂商 `custom_k3`，地址 `https://api.moonshot.cn/v1`，模型 `kimi-k3`）
看起来满足条件，但**实际仍报 8192** —— 原因未查明。用户已换回 DeepSeek。

`factory.ts:299` 的注释说明 K3 的**思考与正文共用一个预算**，
这既解释了卡顿，也解释了反复撞输出上限。用户反馈 K3 经常卡住、DeepSeek 稳定。

**结论：这一项不值得再投入，除非用户主动要求。**

---

## 十二、其他可用的记忆点

- 客户端请求超时 **10 分钟**（`client/src/lib/constants.ts` 的 `DEFAULT_API_TIMEOUT_MS`）
- 整章改写现在**分 3 次调用、每次 1 个候选**，每次限时 **4 分钟**，
  部分失败仍返回已到达的候选
- `8192` 来自两处：`llm/providers.ts:29`（DeepSeek 供应商）与
  `llm/structuredOutput.ts` 各族的 `safeStructuredMaxTokens`，
  由 `llm/factory.ts:336-339` 取小值
- 报错里的 token 数是**真实上限**，来自
  `llm/structuredInvokeParser.ts:400` 的 `input.maxTokens`
