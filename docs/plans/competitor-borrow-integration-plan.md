# 竞品机制整合方案（Novel Studio → 我们的工具）

创建：2026-10-02。配套研究见 [novel-studio-competitor-review.md](novel-studio-competitor-review.md)。

**本方案只借鉴机制，不复制对方源码或 prompt 原文**；所有落地内容用我们自己的 Prompt Registry 与 schema 重写。用户已确认对方作者允许评论者免费使用、本人不商业化，但把他人 prompt 原文搬进本仓库仍会留下版权尾巴，故按下述方式处理。
**状态：规划已确认，六阶段全部要做。阶段 0（容量硬停）已完成，A–F 待实施。**

## 执行状态（新窗口从这里读）

| 项 | 状态 | 提交 / 证据 |
|---|---|---|
| **阶段 0：建议容量硬停** | ✅ 已完成 | `b17151e3`；真实输入 154956 → 122304；`planningRepairAdviceReviewContext.test.js` 15/15 |
| **阶段 A1：承诺节奏 DB 列 + 备份** | ✅ 已完成 | `server/src/prisma/schema{,.sqlite}.prisma` 加 `progressEvery`/`nextProgressChapter`/`payoffIntensity`；备份 `.codex-run/phase-a-20261002/dev-before-phase-a.db`（1.03GB，integrity ok，sha256 `77cad662…`）；`db push` 无数据丢失；行数不变 180/5/21 |
| 阶段 A2：AI 声明节奏并持久化 | ✅ 已完成 | sync prompt schema + `shared/types/payoffLedger.ts` + `mapPayoffLedgerRow` + 两处 upsert（Sync/Delta）均带三字段；prompt 升 `novel.payoff_ledger.sync@v7`（loader 与 `prompting.test.js` 同步）；shared/server 编译通过；`prompting.test.js` 50 通过 0 失败 |
| 阶段 A3：到期承诺进入写前合同 + 审查 | 🟡 A3a/A3b 已完成，A3c（审查侧）待做 | **A3a**：`services/payoff/payoffCadence.ts`（`selectDuePromises` + `renderPayoffCadenceContext`），12/12。**A3b（已完成）**：`VolumeChapterDetailPromptInput` 加可选 `payoffCadence:{dueCount,text}`（传渲染文本，避免 prompt 层反向依赖 service）；`contextBlocks.ts` 新增 `payoff_cadence` block（有到期项才 required）；`chapter_task_sheet` 升 `v7→v8` 并加规则（每一条到期承诺必须在 purpose/mustAdvance/readerExperience 有落点，只写「记得」「准备去办」不算推进，推不动须说明阻力，禁止为凑清单新造）；`volumeGenerationOrchestrator.loadPayoffCadence` 读账本并渲染（读取失败只告警不阻断细化）。验证：server 编译通过；`volumeChapterDetailContext.test.js` 7/7、`prompting.test.js` 50 通过 0 失败、`payoffCadence.test.js` 12/12、volume 回归 128 项 124 通过 0 失败。**A3c-1（已完成）**：`rollForwardNextProgressChapter` 修掉"永久到期"缺口——承诺在到期章或之后被推进后，nextProgressChapter 顺延为 `lastTouchedChapterOrder + progressEvery`；无 progressEvery 或无推进记录时保留原报值（不编造）；终态保留。同步器与章节增量两处写入均已接入，且增量路径改为 `?? previous?.x` **不再把同步器声明的节奏抹成 null**。18/18 单测。**A3c-2（已完成）**：不做 `chapterTaskSheetQuality` 的独立审查通道，改为**复用 C 阶段的标记机制**——把标记词表提成单一来源 `services/payoff/planningToken.ts`（`[承诺:key]` / `[伏笔:key]`，形态只在此一处定义，伏笔模块改为 re-export 以免出现第二套实现），`renderPayoffCadenceContext` 改为输出 `[承诺:<ledgerKey>]` 并要求 planner 在对应 `requiredElements` 项末尾原样带上，新增 `checkPromiseCoverage(due, chapters)` 按**显式标记**核对（绝不按文字相似度；引用未到期承诺记 `unexpectedTokens`）。这样一来承诺与伏笔走同一套判定、同一个出口（`mustHitNow → missingObligations → draft_obligation_unmet` 非阻断），**不新增阻断路径**。验证：`payoffCadence.test.js` 22/22（新增 4 条：渲染带标记、按标记匹配、未到期标记被报出、planner 完全忽略时全部未映射）；`foreshadowRevealObligations` 11/11、`proseForeshadowTokenLeak` 4/4 在词表提取后仍全过 |
| 阶段 B：章级 requiredElements | ✅ B1+B2 已完成，**B3 验收侧经核查为「由构造闭合」** | **B3 核查结论（本轮）**：验收侧不需要新增代码，链路已完整且非阻断——`requiredElements` 经 B2 进入 `mustAdvance` → `mustHitNow`（`chapterLayeredContext.ts:411`）；acceptance prompt 规则 6（`chapterAcceptance.prompts.ts:464`）要求把 `must hit now` 缺口写入 `missingObligations`（kind 含 `must_hit_now`，见 :472）；`ChapterAcceptanceAssessmentService.ts:276` 经 `missingObligationToReviewIssue` 转为 review issue；`chapterRuntimePackageBuilders.ts:115-128` 在**仅缺义务**时给出 `obligationCoverage.status = "partial"`（而非 `"unmet"`），`:145-151` 产出 `draft_obligation_unmet`；`chapterRepairRuntime.ts:103-122` 把它变成修复器可定向补写的目标。**AGENTS.md 明确将 `draft_obligation_unmet` 列为非阻断**（章节级质量债/局部修复）。因此**此处不应再新增一套检查**，否则重复。 |
| 阶段 B 实施细节（B1） | ✅ 已完成 | **B1**：两个生成 schema 加 `requiredElements`（`max(8).default([])`，**刻意不设 min(3)**——硬下限会让模型漏写时生成失败重试，与"局部规划缺口不阻断链路"冲突；3-8 条由 prompt 要求）；持久化槽位 `chapterScenePlanSchema` 显式声明，`normalizeChapterScenePlan` 透传清洗，旧数据默认空仍可解析；`chapterExecutionContractGeneration.ts` 三处补齐（新生成 normalize 入参/candidate/返回值 + 复用路径）。**B2（已完成）**：`chapterLayeredContext.ts` 的 `buildChapterMissionContext` 加可选 `requiredElements` 参数，**排在 `mustAdvance` 数组最前**（该数组经 `:411` 成为 writer 的 `mustHitNow`），容量上限 5→8，确保章节自身合同不会被冗长冲突列表挤掉；调用点传 `scenePlan?.requiredElements`。**验证**：`chapterRequiredElementsPersistence.test.js` 4/4（往返/旧数据/脏数据/上限）、`chapterLayeredContext.test.js` 12/12（含 2 条新用例：要素进入 mustAdvance、冲突很多时章节合同仍存活）、`chapterContractRepairBoundary` 7/7、`volumeGenerationSchemas` 19/19、`prompting` 50 通过 0 失败；尚未做：验收逐项核对 `requiredElements`（应作为 warning/质量债，不阻断）。广域回归 818 项 785 通过；19 处失败经依赖检查确认**无一由 B2 引起**（失败文件除已归因的 `chapterProgressionAcceptance` 外均不 import 该文件） |
| 阶段 C：伏笔落进 requiredElements | ✅ C1+C2（注入链路）已完成，C3 验收侧待做 | **C1**：`services/payoff/foreshadowRevealObligations.ts` —— `formatForeshadowToken`/`extractForeshadowTokens`（标记形态**只在一处定义**，planner/检查/泄漏守卫三方共用）、`selectVolumeRevealObligations`（**不需要新增 DB 列**，用已有的 `targetStart/EndChapterOrder` + `currentStatus` 表达"本卷必须回收"）、`checkRevealCoverage`（**按显式标记匹配，绝不按文字相似度**；重复只计一次；卷外引用记 `unexpectedTokens`）、`findForeshadowTokenLeaks`（标记禁止进正文）、`evaluateVolumeRevealRate`（第一卷门槛 0，第二卷起 60%，无义务时平凡通过）、`renderForeshadowObligationsContext`（渲染义务清单 + 标记约定 + 允许只推进/部分揭示/给出反证 + 禁止为凑清单挂标记）。**C2（已完成）**：`volumeGenerationOrchestrator.loadPayoffCadence` 增加本卷章节区间参数，算出"回收期限已到本章"的义务，与到期承诺渲染文本合并进已有的 `payoff_cadence` 上下文块（**复用 A3b 通道，不新增字段、不动 prompt 版本**）。**验证**：server 编译通过；`foreshadowRevealObligations.test.js` 11/11、`payoffCadence` 18/18、`volumeChapterDetailContext` 7/7、`chapterRequiredElementsPersistence` 4/4、`prompting` 50 通过 0 失败。wiki：`docs/wiki/workflows/foreshadow-reveal-tokens.md`。**C3 待做（入口已定位）**：①`services/novel/runtime/chapterRuntimePipeline.ts` —— `QualityDebtAttribution` 接口在 :55，构建函数 `buildQualityDebtAttribution` 在 :711，调用点在 :448-470（`!pass` 时构建）；把覆盖检查结果作为**建议性**条目并入，需先把账本条目与该卷各章 `requiredElements` 带进 pipeline；②对成稿跑 `findForeshadowTokenLeaks`；③确认 planner 是否**确实**按指令写了标记（当前只保证它收到了指令，尚无实际产出的观测——这一条必须等真实运行，不能靠测试代替）。**补充（本轮核查）**：只要 planner 确实把回收动作写进了 `requiredElements`，该项义务就会经 `mustAdvance → mustHitNow` 进入验收规则 6 的 `missingObligations`，**验收侧同样由构造闭合**，不必另建检查；真正仍空白的是**成稿标记泄漏检查**——**本轮已补上调用点**：`proseQuality/ProseQualityDetector.ts` 新增 `prose_foreshadow_token_leak`（severity critical）与 `scanForeshadowTokenLeak`，接入既有确定性正文检查管线（验收时随 `detectProseQuality` 一起跑），复用 C1 的 `extractForeshadowTokens` 保持标记形态单一来源；未闭合标记不算泄漏，正常叙述提到「伏笔」也不算。验证：`proseForeshadowTokenLeak.test.js` 4/4、`proseQualityDetector.test.js` 3/3、`chapterRuntimePipeline` 14/14、`chapterQualityLoop` 21/21 |
| 阶段 D：人物声音卡与不变量 | ⚠️ **需先改口径**（声音部分与现有能力重复），不变量部分仍待做 | **核查发现（本轮，代码+数据库双重证据）**：`Character.voiceTexture` **已经存在、已由 AI 生成、并且已经注入写作上下文**——`characterVisibleProfile.prompts.ts` 生成它（prompt 里明确要求"让角色对白更容易区分，包含声线、句式节奏或口头习惯"），`chapterLayeredContextCharacters.ts:19`、`chapterLayeredContextShared.ts:364`、`runtimeContextBlocks.ts:106`、`GenerationContextAssembler.ts:394` 四处把它送进写作上下文。数据库实测：30 个角色中 `personality` 有 29 个（97%），`voiceTexture` 只有 **12 个（40%）**。**结论**：再建一套 `voiceProfile` 会与现有字段重复；声音部分的真实缺口是**一致性（40% vs 97%）**而非能力缺失。**D 的建议口径**：①不再新增 voiceProfile，改为让 `voiceTexture` 可靠填充（它对白区分度最直接）；②新增**可执行的声音标记**（现有 `voiceTexture` 是描述性文字，不是可核对的清单）；③`invariants`/`stateVariables`（身份与状态不变量）确实是空白，仍值得做。**D 的不变量部分（本轮核查：已具备，无需新建）**：`characterHardFacts`（角色硬事实）就是竞品的 `invariants` + `stateVariables`，而且更完整——字段对应：`identityLabel`/`factionLabel`/`stanceLabel`/`powerLevel`/`realm` ↔ 身份不变量，`currentLocation`/`availability`/`currentState`/`currentGoal` ↔ 可变状态，`prohibitions` ↔ 禁止清单，另有竞品没有的 `pendingReviewFields`（某状态正在复核时只作参考，避免状态刚变就被硬锁死）。归属 `services/novel/characters/characterHardFacts.ts`，经上下文提供契约 `character_hard_facts` 注入写作/审查/修复三链路，`tier: hard_required`、`failureSemantics: block`、`priority 120`；渲染在 `context/chapterContextBlocks.ts` 的 `buildCharacterHardFactsText`（块标题【角色硬事实】），块首句即「以下内容是正文生成前的不可违背写作约束，优先级高于软性人物简介」——**这正是方案要求的身份锁**。空数据时仍要求「不得凭空改写角色阵营、身份、境界、所在地或行动可用性」，且限制渲染前 8 个角色以免吃满预算。wiki：`docs/wiki/architecture/character-hard-facts-as-invariants.md`。**结论：D 只剩 `voiceTexture` 一致性这一项数据问题（40% vs personality 97%），不新建任何结构。** 内部资产、不导出人读文档的原有口径不变（用户确认 3）。 |
| 阶段 E：卷级终点 gate | ✅ **E1+E2 全部完成（用户选定策略 C）** | **E1 判定**：`volumeAcceptanceEvaluation.ts` 的 `evaluateVolumeAcceptance`，聚合逐章结果为 `accepted` / `accepted_with_debt` / `needs_attention`，可选并入 C1 伏笔回收率。失败方向刻意选严：无可评估章节返回 `needs_attention` 而非 `accepted`（静默放过判断不了的用例比没有门禁更糟）。**E2 策略（用户选 C：只卡下一卷大纲）**：`decideVolumeGate` —— `needs_attention` 阻断并给出可执行说明且明说已写正文不会改动；**`accepted_with_debt` 不阻断**（债已记录且可见，对它硬停会让几乎每卷都停）；`accepted` 静默通过。`deriveVolumeOutcomes` 从章节行派生逐章结果，**如实注明局限**：行里只有 `chapterStatus`，没有阻塞项数与未兑现义务数（在验收报告中，此路径不加载），故两项报零、只区分完成与未完成。新增 `VolumeGenerationGateError`（kind `volume_gate_blocked`）便于呈现为可操作说明。接线：`generateVolumePlanDocument` 在 `assertScopeReadiness` 后调用 `assertPreviousVolumeSettled`，查找失败只告警不阻断。验证：`volumeAcceptanceEvaluation` 12/12、volume 前缀 19 个文件全部 fail 0 |
| 阶段 F：门禁分级 + 长度控制 + 排版 | 🟡 F1（排版）已完成，F2/F3 待做 | **F1（已完成）**：新增 `prompting/prompts/novel/context/typography.ts` —— `CHAPTER_TYPOGRAPHY_RULES`（写作侧：段间空行、叙述段 40-120 汉字、单段超 160 必须拆、说话人一换必须换段、对白密集处须标清说话人）与 `CHAPTER_TYPOGRAPHY_AUDIT_RULES`（审查侧：查未拆长段/叙述挤成一块/说话人混排，属可局部修复，不升级为全局重写或停止；不因段落偏短或场景安静判罚）。注入 writer（【排版要求】）、acceptance（排版与说话人审查）、chapterReview、chapterRepair 四处。5/5 测试（含通用性检查：无题材硬编码、不禁短段）。**F2（本轮核查完成，无需改代码）**：门禁分级已经正确实现，且是**三层一致**的设计，不是巧合——①`insufficient_evidence` 一律判为 severity **medium**（`acceptance/causalAssessment.ts:42` 只有 `contradicted` 才是 high；`acceptance/progressionProjection.ts:22` 直接 medium）；②阻断集合只收 high/critical（`chapterRuntimePackageBuilders.ts:379-381` `blockingIssueIds = verifiedIssues.filter(severity 为 high 或 critical)`，`hasBlockingIssues = blockingIssueIds.length > 0 或 status === "needs_manual_review"`）；③升级为修复的判定显式排除证据不足——`causalAssessment.ts:61-66` 的 `onlyUnknown` 使"全部是证据不足"时不升级，状态降为 `continue_with_risk` + `continue`；`progressionProjection.ts:34-35` 只有 `stalled` 触发修复；`acceptance/actionStateProjection.ts:55` 的 `needsRepair` 明确排除 `insufficient_evidence`。加上 prompt 规则 21（`chapterAcceptance.prompts.ts:479`）写明"局部缺口优先 repairable/continue_with_risk，不自行升级为全局停止"。**对齐竞品的 `blockerMode: "evidence"` 与"证据不足的阻断项降级为 warning"。结论：不新增代码，避免重复实现。** 唯一值得记下的**命名陷阱**：这些条目仍会被 push 进名为 `blockingIssues` 的数组（`causalAssessment.ts:40`、`progressionProjection.ts:21`），名字带 blocking 但实际由 severity 决定是否阻断——源码注释已说明是"可见债，不是虚构修复的许可"，改代码时不要被名字误导。**F3 待做**：受控扩写 prompt（在已发生场景内补足，禁止新增人物/场景/支线/伏笔）**F3（已完成）**：受控扩写与受控压缩。核查发现章节编辑器的 `expand` 操作**原本完全没有边界**——`buildPresetIntent("expand")` 只给了「补足细节」与两条通用约束（不要模板化 AI 腔、不要破坏上下文承接），**没有禁止新增人物/场景/支线/伏笔，也没有禁止推进剧情**。这正是「细腻」变成注水的成因：扩写被允许自由发明事件。已补上双向约束——expand 增加「不得新增人物、场景、支线或伏笔」「不得让剧情向前推进：扩写只补足本段已经发生的事」「不得提前兑现后续章节的安排」；compress 增加「不得删除已发生的事件、关键选择或其后果」「不得为缩短而省略因果桥」「不得把细腻的心理与关系变化压成流水账」。两者互不通用（有测试锁住），其余操作保持原有较窄约束集。验证：`chapterEditorControlledExpansion.test.js` 5/5、`chapterEditorPreview` 4/4、server 编译通过 |

**用户已确认的四点**：

1. 六个阶段全做；必须维护记忆文档与台账，避免换窗口后丢三落四。
2. 阶段 A 的 DB 列由实施者决定，**先推送 git 或备份**。
3. 阶段 D **只做内部资产**，不额外导出人读"人物卡"（避免双份维护与一致性问题）。
4. 优先把反复卡住的容量问题修掉——已完成。

**阶段 0 的关键教训（不要重犯）**：

- 曾把证据 id 从内容哈希改成顺序号以省字符，被既有用例"改变源文后旧 id 必须不再解析"当场拦下。顺序 id 会让**其他上下文的旧 id 被静默接受**，是安全属性倒退。已改回内容寻址 + 10 位十六进制。
- 没有直接调高 160000 上限：仓库内查不到与之绑定的模型上下文声明，无法证明提高安全。应先做结构性瘦身。
- 剩余可压缩项（如实测再触顶时再用）：证据目录 `path` 逐条重复（431 条约 28k，可路径驻留）；`macro` 整行传入（17k）。

---



## 一、直接来自对方 prompt 的关键机制（已读取打包资源确认）

从对方 `app.asar` 中 `production-src/desktop/main.mjs` 解码后读到的真实约束（概括，非原文照抄）：

### 1. 三层契约

- **书级**：`openingContract`（前三章 beats，`hookDeadlineChineseChars` 建议 300 / `coreQuestion` / `firstChoice` / `firstPayoff` / `revealBoundary`）+ `promises` + `payoffSystem` + `mysteries` + `styleGuide` + `reviewPolicy`
- **卷级**：`chapterBlueprints`（`phase` + `plannedRewardIntensity`）、`mysteryPlan`
- **章级**：16 个必填字段（见下）

### 2. 章级 16 字段（它推进感的来源）

`number, title, summary, pov, day, requiredElements, tags, endHook, sceneGoal, conflict, turn, consequence, readerReward, promiseActions, characterChecks, continuityRequirements`

其中三条是硬约束：

- **`requiredElements` 至少三项，且必须是正文中可明确落实的专名、事件或动作** —— 不是主题。
- **`promiseActions`**：`{promiseId, action(introduce/progress/payoff/hold), expectedEffect}`，**凡本章到期或卷内负责的承诺必须映射**。
- **`readerReward`**：`{type, setup, payoff, intensity(tiny/small/medium/major), required}`，**每章至少一次与题材匹配的有效进展或情绪兑现，不得用无后果争吵、重复震惊或机械打脸冒充爽点**。

### 3. 承诺账本带推进节奏

`promises[]` 每项：`progressEvery`、`nextProgressChapter`、`payoffDeadlineChapter`、`majorPayoffVolume`，且**所有期限必须落在全书章数内**。

`payoffSystem`：`smallWithinChapters: 5`、`mediumWithinChapters: 20`、`majorPerVolume: 1`、`genreSpecific`（**爽点按题材自适应**：悬疑用线索与局部揭谜、言情用关系确认、经营用成果落地）。

### 4. 伏笔必须落进 `requiredElements`

- `mysteries[]`：`{id, question, truth, readerInfo, status, plannedRevealVolume}`，**最多 20 条、建议 8—15 条**；"普通线索、一次性证据、场景细节和临时疑问放入章节状态更新，不得新增为独立伏笔"。
- `mysteryPlan[]`：`{mysteryId, action(埋设/推进/部分揭示/回收/保留), chapterNumbers, expectedPayoff}`。
- **关键一招**："凡 `plannedRevealVolume` 等于本卷的伏笔，必须在对应章节的 `requiredElements` 中明确写出回收动作与真相揭示要求，不能只写在 mysteryPlan"。
- 系统保留 `[伏笔:<id>]` 内部标记驱动映射，但**标记绝不能出现在正文**。
- 回收率：第一卷可只埋设推进；**从第二卷起，本卷负责的既有伏笔至少 60% 必须安排回收**。
- `foreshadowingPolicy: "strict-v1"` = 逐章回收记录 + 分卷回收率 + 完结校验；结尾最多保留一条开放主线伏笔。

### 5. 卷蓝图节奏

`chapterBlueprints` 每项含 `phase` 与 `plannedRewardIntensity`，并强制：**每 3—5 章形成一个有进展的小阶段；至少一章为 major；不得用重复危机填充章节**。

### 6. 人物声音卡与不变量

- `voiceProfile: {tone, sentenceStyle, vocabulary, habits, taboos}`，并要求"描述活人的说话差异，而不是工作流程或决策清单"，明确列出"对亲近者与陌生人的差别、常见停顿/口头填充/称呼、愤怒心虚放松时如何变化"。
- **明确禁止**："不得让所有人物都'先确认事实、再给结论、最后列方案'"。
- `voiceMarkers`：3—6 条**可迁移的口语行为提示**（例："担心时绕着问吃没吃饭""被戳中心事会突然缩短回答"），**不得写成格言、标准台词或口号**。
- `invariants: {coreValues, moralBoundaries, decisionPattern, protectedTraits}` + `stateVariables: {knowledge, resources, wounds, relationships, currentGoal}`；**核心不变量不能被普通章节更新直接覆盖，变化必须由人物弧中的明确事件触发**。

### 7. 质量门禁：分数只观察，阻断要证据

`reviewPolicy.thresholds` **"只作观察参考，不直接阻断"**；`maxRevisionAttempts` 固定 2（初稿后最多一次正文返修）；`scoringMode: "advisory"`、`blockerMode: "evidence"`。

实例：某章审稿模型提出阻断项，但因引文证据不完整被程序**忽略并降级为 warning**，章节 PASS。

### 8. 长度双向控制 + 外科修复

- 太短 → **受控扩写**："必须在原文已经发生的场景、事件与因果链内补足；不得新增人物、场景、支线、第二场冲突、设定、伏笔和结局"。
- 太长 → **压缩**："不得续写，不得增加新事件，不得改变故事"，且必须保留全部人物/事件顺序/决定/冲突结果/线索/伏笔/数字/时间/地点/物品归属/**人物知识边界**/结尾钩子。
- 连续性冲突 → **外科修复（rescueMode）**："只修复有证据的连续性冲突，优先替换最少量的日期、时刻、先后词、知识来源或因果连接；不得增加新情节，不得改变人物选择，不得重新安排场景，不得顺便润色"。

### 9. 排版硬规则

段间两个换行；普通叙述段 40—120 汉字；**单段超 160 字必须拆分**；说话人变化必须换段。

### 10. 卷级闭环

`AGENTS.md` 三条关卡：全书框架未确认→不许出卷纲；本卷大纲未确认→不许写正文；**本卷未完成并验收→不许生成下一卷正式详细大纲**。

---

## 二、与我们的现状对照

| 能力 | 我们现有 | 缺口 |
|---|---|---|
| 书级大底 | `bookStoryFoundation`（throughline/worldBoundary/characterDynamics/viewpoint/progression） | 缺**前三章契约**（结构化 beats + 完成证据） |
| 卷级 | `VolumeChapterPlan`、卷策略、节奏板 | 缺**卷级终点 gate**；缺蓝图 `phase`/`plannedRewardIntensity` |
| 章级必达 | 场景卡内 `mustAdvance` / `mustPreserve`（数组，非章级强制） | 缺**章级 `requiredElements`**（≥3 项且可落实） |
| 读者回报 | `readerExperience`（promisedReward/rewardLevel/keyTurn/netChange/…） | 缺 `intensity` 分级与**"每章至少一次"强制** |
| 承诺 | `PayoffLedgerItem`（targetStart/EndChapterOrder/currentStatus）+ `chapterPayoffDecisionSchema` | 缺 `progressEvery`/`nextProgressChapter`；缺 **cadence 配置**；缺**章→承诺显式映射** |
| 伏笔 | payoff/foreshadowing 目标窗口 | 缺 `plannedRevealVolume`、缺**落进 requiredElements**、缺回收率与总量上限 |
| 人物 | `currentGoal`/`resources`/`toneGuardrails`/`CharacterMindSnapshot` | 缺 `voiceProfile`/`voiceMarkers`/`invariants`/`stateVariables` |
| 状态机 | `actionStateChecks`（body/item/ability/knowledge/location + 时序证据）——**比对方细** | 保留优势 |
| 因果 | `sceneCausalityVerdicts`（earned/unearned/contradicted/insufficient_evidence） | 保留优势 |
| 推进审查 | `progressionChecks` 三维（event/knowledge/prior_goal） | 保留优势；但 **`insufficient_evidence` 也进阻断**需复核 |
| 长度控制 | `structured-output-budget-recovery` | 缺**受控扩写**；缺外科修复模式 |
| 治理 | Prompt Registry 完整 | 保留优势 |

---

## 三、整合方案（六阶段，按价值/风险排序）

约束（全程遵守 AGENTS）：AI 结构化理解优先，不堆关键词规则；保留两轮预算、来源指纹、已写章/锁定保护；局部质量债与结构性重规划分开；每阶段窄回归 + wiki + 台账 + 本地提交不 push。

---

### 阶段 A：承诺推进节奏（最高价值，改动最小）

**目标**：让"逾期未推进的承诺"变成**写前规划必须处理**的东西，而不是事后 warning。

**改动点**
1. `shared/types/novel/payoffPlanning.ts`（或新建 `payoffCadence.ts`）：新增
   - `payoffCadenceSchema = { smallWithinChapters, mediumWithinChapters, majorPerVolume }`
   - 承诺项增加 `progressEvery: int≥1`、`nextProgressChapter: int`、`intensity: tiny|small|medium|major`
2. `PayoffLedgerItem`（Prisma）：加 `progressEvery`、`nextProgressChapter`、`payoffIntensity` 三列；迁移走 `prisma db push` 需**先备份**（AGENTS 数据保护）。
3. 写前任务单生成（`chapterDetail.prompts.ts`）：注入"本章到期承诺清单"，要求 `promiseActions` 逐项映射（`introduce/progress/payoff/hold` + `expectedEffect`）。
4. 规划审查（`chapterTaskSheetQuality.prompts.ts`）：校验
   - 到期承诺必须被映射，否则 `issues`（AI 判断，非关键词）
   - cadence 违例（如连续 `hold` 超过 `progressEvery`）出 `issueChecks`
5. **执行层分级**：cadence 违例默认进 `repair_contract`（可修），**不直接 `replan_window`**——避免重演"弱证据卡死整批"。

**验收**：离线隔离测试（构造到期/未到期/连续 hold 三种），服务端编译；真实跑书观察第 6 章是否自动带上第 1 章承诺的推进项。

**风险**：加 DB 列必须备份；`PayoffLedgerItem` 现有 14 条数据需 seed 合理默认值（`progressEvery=5`、`nextProgressChapter=当前+5`）。

---

### 阶段 B：章级最小事件清单升格

**目标**：`requiredElements` 从"场景卡内可选数组"升格为**章级强制清单**，且写进写作 prompt。

**改动点**
1. `chapterDetailSchemas.ts`：`createChapterTaskSheetSchema` 增加章级 `requiredElements: z.array(conciseRequiredText).min(3).max(8)`。
2. 场景卡 `mustAdvance` 保留（场景级），章级 `requiredElements` 作为**验收锚点**。
3. `chapterDetail.prompts.ts`：要求"每项必须是正文中可明确落实的**专名、事件或动作**，不得写主题或意图"。
4. `chapterWriter.prompts.ts`：在【任务边界】显式列出 `requiredElements`（我们现在只有 mustAdvance）。
5. 验收 `chapterAcceptance.prompts.ts`：新增逐项核对——**但出口是 warning/quality debt，不是阻断**（对齐对方的做法）。

**验收**：schema 拒绝 <3 项的候选；离线测试构造"主题式"与"事件式"两组，确认 AI 判断（非正则）能区分。

---

### 阶段 C：伏笔计划卷 + 落进 requiredElements

**目标**：让伏笔从"账本里的承诺"变成"某一章必须写出来的动作"。

**改动点**
1. 伏笔/谜题类型加 `plannedRevealVolume: int`、`readerInfo` 与 `truth` **分开**（我们目前倾向于混在一条）。
2. 卷纲生成：`mysteryPlan` 每项 `{mysteryId, action, chapterNumbers, expectedPayoff}`，章号必须是全书绝对章号。
3. **核心规则**：`plannedRevealVolume === 本卷` 的伏笔，**必须在对应章的 `requiredElements` 中写出回收动作**（阶段 B 的字段）。
4. 内部映射标记（如 `[伏笔:<id>]`）随 `requiredElements` 保存，但写作 prompt 明确**禁止出现在正文**。
5. 卷末校验：回收率（第二卷起 ≥60%）、未回收总量上限。

**验收**：离线构造"本卷该回收但没写进 requiredElements"的候选，确认审查判 `issues`；确认标记不泄漏到正文（写作 prompt 反向检查）。

**依赖**：阶段 B 先落地。

---

### 阶段 D：人物声音卡与不变量（Q11 的更彻底实现）

**目标**：把"人物鲜活"从规则文本变成**结构化人物资产**。

**改动点**
1. `shared/types/novelCharacter.ts`：加
   - `voiceProfile: {tone, sentenceStyle, vocabulary, habits, taboos}`
   - `voiceMarkers: string[]`（3—6 条可迁移口语行为）
   - `invariants: {coreValues, moralBoundaries, decisionPattern, protectedTraits}`
   - `stateVariables: {knowledge, resources, wounds, relationships, currentGoal}`
2. 人物生成 prompt：加入"描述活人的说话差异"要求，并**明确禁止**"所有人都先确认事实、再给结论、最后列方案"。
3. `chapterWriter.prompts.ts`：注入"人物身份锁"块（姓名/简称/性别/代词严格一致，未登记简称禁用）+ 各角色 `voiceMarkers`。
4. **不变量保护**：普通章节更新不得覆盖 `invariants`，只有人物弧明确事件可改——在我们的 `characterSync` 写入路径加校验。

**验收**：离线验证"未登记简称"能被检出；验证 `invariants` 不被普通 state update 覆盖。真实跑书对比人物对话区分度（**由用户阅读判断，不用分数**）。

**说明**：这是我们现有 Q11 情绪规则的升级版——Q11 注入的是通用规则，这里给的是**逐人物的具体声音**。

---

### 阶段 E：卷级终点 gate

**目标**：给写作一个可到达的终点，避免"一直写下去"。

**改动点**
1. 卷状态机：`VOLUME_OUTLINE_REVIEW → READY_TO_WRITE ⇄ WRITING → VOLUME_REVIEW`（复用我们现有 `DirectorStepRun`/checkpoint 机制，不新造运行时）。
2. Gate：**本卷未验收不得生成下一卷正式详细大纲**；卷验收需要人工确认（源页面操作，符合我们"质量优先人工暂停"规则）。
3. 与 `completionProfile`（书级 80 章）并存：书级仍是总目标，卷级是分段终点。

**验收**：离线验证 gate 拒绝越卷；确认不破坏现有书级范围恢复逻辑。

**风险**：触碰自动导演状态机，**风险最高**，建议放最后且单独窄回归。

---

### 阶段 F：门禁分级复核 + 长度双向控制

**改动点**
1. **复核 `insufficient_evidence` 是否该阻断**：对齐对方"证据不足的阻断项被忽略并留 warning"的做法。保留真阻断（`contradicted`/`unearned` 且有证据）。
2. 新增**受控扩写** prompt：补足现有场景内的行动/对话/阻力/后果，禁止新增人物/场景/支线/伏笔。
3. 新增**外科修复模式**：只修有证据的连续性冲突，优先替换最小量的时间词/知识来源/因果连接。
4. 排版硬规则进 writer prompt：段间两换行、段长 40—120、**超 160 字拆分**、说话人变化换段。

**验收**：离线验证扩写 prompt 不含"新增"路径；排版规则渲染进 SystemMessage。

---

## 四、建议执行顺序与理由

```
A 承诺节奏  ──┐
              ├─→ C 伏笔落章 ──→ E 卷级 gate
B 章级清单  ──┘
D 人物声音   （独立，可与 A/B 并行）
F 门禁复核   （独立，低风险，可随时插入）
```

- **A + B 先做**：直接对抗"兜转"，改动集中在类型与 prompt，不动状态机。
- **C 依赖 B**。
- **D 独立**，且是 Q11 的自然升级。
- **E 风险最高**，放最后。
- **F 可随时插入**，其中"排版规则"和"受控扩写"是低成本高收益项。

每阶段节奏：**改类型/schema → 改 prompt → 服务端编译 → 离线隔离验证 → 更新 wiki/台账 → 本地提交（不 push）**。真实效果一律留给用户读稿判断，不以分数替代。

---

## 五、明确不做的事

- 不照搬对方的 `payoffCadence` 具体数值（5/20/1）——应作为**可配置默认值**，按题材调整（对方自己也有 `genreSpecific`）。
- 不引入 `[伏笔:id]` 这类"标记写进正文再靠程序剥离"的做法——我们的写作 prompt 应直接产出自然文本，标记只存在于规划层。
- 不为任何单一题材或样本书写专用分支。
- 不因为"它能跑完一卷"就放松我们已有的 `actionStateChecks`/`sceneCausalityVerdicts` 证据校验——那两项我们比它细。

## 六、待确认

1. 六个阶段是否按上述顺序全部做，还是先做 A+B 看效果？
2. 阶段 A 需要加数据库列（`PayoffLedgerItem` 三列）。**加列前我会先做备份并报告路径**，是否需要你额外确认？
3. 阶段 D 的人物声音卡是否要同时生成一份"人物卡.md"给人看（对方有 `docs/02_人物卡.md`），还是只做内部资产？
