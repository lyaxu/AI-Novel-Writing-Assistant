# 章节容量门禁（写前规划）

## Background

章节执行合同过去只要求“必须完成项清单”。模型会把一章能塞十件事当成“信息密度高”，
合同里出现秘境入口、卷入、预判、救人、传功、试招、答应请求、要账、约定次日、债务线索
这类并列动作；正文只能逐项赶任务，读者感受到的是清单而不是故事。

只在正文生成后再审已经太晚：超载的合同必然产出流水账，修复也只能重写正文。容量问题
必须在写前规划阶段解决，并且用结构化字段判定，而不是靠关键词或文笔评价。

## Decision

在章节执行合同里增加 **capacityPlan（容量计划）**，作为章纲的一部分随场景计划持久化：

```json
{
  "coreEvent": "本章唯一主事件，必须与 exclusiveEvent 是同一件事",
  "keyTurn": "本章唯一明确转折，不能复述主事件",
  "mustDeliver": ["本章必须兑现的可见结果"],
  "deferable": ["本章不兑现、交给后续未写章节承接的职责"],
  "seedOnly": ["只埋设线索、本章不兑现真相"],
  "estimatedCoreWordCount": 2400
}
```

规则：

1. 每章只允许 **一个主事件**（coreEvent）和 **一个明确转折**（keyTurn）。
2. 合同里的必须完成项必须全部归类；`requiredElements` 由 `mustDeliver + seedOnly` 组成，
   并且必须包含全部 `mustDeliver`。
3. `deferable` 不得出现在本章 `requiredElements` 或场景 `mustAdvance` 中。
4. 引用了 `deferable` 的职责不能“本章不做就算了”：必须由规划修复写入章序更晚的未写章节，
   在后章 `mustDeliver` / `requiredElements` / 场景 mustAdvance 里真实承接。
5. 容量计划随 scenePlan JSON 持久化，不新增数据库列；旧合同没有该字段时按旧合同兼容读取。

## Current Rule

### 确定性容量预算

`shared/types/chapterCapacity.ts` 由目标字数推导预算，不按题材写死：

- 叙事固定开销 = 目标字数 × `narrativeOverheadRatio`（默认 28%）；
- 每个 `mustDeliver` 至少 `minWordsPerMustDeliver`（默认 560 字），每个 `seedOnly`
  至少 `minWordsPerSeedOnly`（默认 240 字）；
- `mustDeliverLimit` 由剩余可用字数推导，并受绝对上限约束；
- 场景数不能多到把章节切碎（单场景至少约 320 字），也不能少到无法分别承载必须兑现项；
- `estimatedCoreWordCount` 不得超过目标字数允许的上浮比例。

权重集中在 `CHAPTER_CAPACITY_POLICY`，可整体覆盖；不按“玄幻/都市/悬疑”等题材分支。

### 门禁落点（按执行顺序）

1. **章节执行合同生成**：新合同缺少容量计划直接按输出无效退回；本地最多一次上下文纠正。
   分类/一致性类问题走 `repair_contract`，结构性超载（必须兑现项/总字数超预算、场景不足、
   可延期无承接）走 `replan_window`，不在单章内反复横跳。
2. **质量门禁 `ChapterTaskSheetQualityGateService.evaluate`**：形状检查通过后先跑确定性
   容量门禁，再决定是否调用语义复核。容量失败直接返回可修复结果（含 `capacity` 决策），
   不消耗语义复核调用。
3. **规划修复窗口**：协调器复核时第 0 轮允许旧合同无容量计划，修复轮次起必须带容量计划；
   结构性超载使用现有“当前章 + 后续两个未写同卷章节”窗口，规划修复 prompt 要求把
   `deferable` 写进后章并在后章返回可执行的 `capacityPlan` / `requiredElements` / 场景。
4. **修复结果边界**：`applyPlanningRepairCandidate` 用 `capacityPlan` 重建来源章的
   `requiredElements`（可延期职责因此被移出本章），然后按最早顺序做确定性兜底：
   先找窗口内已有承接；没有则尝试把职责写入最早的后继未写章节（`capacityPlan.mustDeliver`
   + `requiredElements` + 至少一个场景 `mustAdvance`），每步都重新过容量预算；所有后继章都
   放不下时，职责保留在来源章 `capacityPlan.deferable`，并生成一份显式的规划容量质量债。
   兜底不会删除职责，也不会把职责硬塞回当前章。
5. **复用/写前准备**：已保存合同在复用、读取就绪和正文准备入口会重新跑容量评估；
   带容量计划但不合格的合同不会被当作可复用合同，旧合同缺字段则保持兼容。
6. **恢复已保存候选**：暂停会话继续/复核时，先对已保存候选执行同一套确定性兜底再复核。
   能补写承接章的照常进入窗口复核；产生容量质量债的，章节复核通过后直接继续提交，
   不再因为窗口 AI 复核无法安置这条职责而整本卡在规划确认。
7. **必须写正文前的最终边界**：容量门禁失败 → 生成/规划修复失败 → 不进入 writer。
   已写正文、已批准章节、锁定章节和跨卷章节不能被修复窗口修改。

### 自动拆分（不新增插章）与质量债兜底

当前卷链没有安全的“插入新章并重排后续章节”能力，因此自动拆分复用规划修复窗口：
把来源章超载的可延期职责按最早顺序写进当前章之后仍有容量的未写同卷章节，保持各章
原始字数预算不变。写入内容必须落到后章 `capacityPlan.mustDeliver`、`requiredElements`
和至少一个场景 `mustAdvance`（动作以“承接前章延期职责：…”呈现），不是只改字段。

窗口内没有现成承接、或所有后章都超出容量时：
- 职责不删除，保留在来源章 `capacityPlan.deferable`；
- 生成规划容量质量债（记录来源章、职责原文、原因、最早后继未写章），随规划修复 session
  持久化，并写入未写来源章的 `repairHistory`；
- 章节级容量门禁在修复轮次允许 `deferable` 存在，后续章节规划/卷规划通过近期章节上下文
  与卷卡片继续看到这条顺延职责；
- 会话不再为了这条职责停留在规划确认，也不再额外消耗模型轮次去“想办法安置”。

### 质量债边界

规划容量质量债是**写前规划债**，不是正文质量债：不要求正文已经存在，也不能用
`autoExecution.qualityDebt*` 冒充已写正文的验收债（那样会让章节被误当成已产出的问题章）。
它的可追踪来源是：规划修复 session 的 `capacityDebt` + 未写章节 `repairHistory` +
来源章 `capacityPlan.deferable` + 运行日志。已写正文、锁定章节和跨卷章节永远不进入兜底；
出现正文指纹变化、活跃执行租约或真正未知调用时仍按原保护边界暂停，不接受兜底。

### 可观测

- 运行日志：`[chapter.capacity] event=rejected|redistributed|repair_committed`，含章节、
  violation code、是否需窗口重规划、可延期职责数量。
- 章节执行历史：容量拒绝/顺延会追加 `[chapter_capacity ...]` 记录到未写章节的
  `repairHistory`，导出可见；已写正文的行不会被写入。
- 场景计划 JSON 内的 `capacityPlan` 是持久化事实来源，可直接核查这章被认定为几个主事件。

## Examples

- 合规章：一个核心事件「验货确认账目被改」+ 一个转折「发现印章是伪造的」+
  2 条只埋线索，2800 字章节通过。
- 超载章：一章列出 8-10 条必须兑现（进秘境、卷入、救人、传功、试招、要账……），
  2000-3000 字目标 → 容量拒绝；规划修复把可延期职责拆到后续章，来源章
  `requiredElements` 减少，后章承接。
- 无后续可写章：来源章仍有可延期职责，但后两章已写/跨卷 → 保留来源章 `deferable`
  并记规划质量债，来源章继续写前流程；不删除职责，也不把超出容量强行交给正文。
- 后章容量不足：先尝试下一章；仍无容量则同样记质量债继续，不因一条延期职责停整本。

## Failure Modes

- **只改 prompt 不加确定性门禁。** 模型仍会输出超载清单；必须有代码侧容量判定与结构化失败。
- **用关键词猜“事件数量”。** 判定只读 `capacityPlan` 的结构化字段；不按剧情词表或题材规则统计。
- **把可延期职责从来源章删掉却没有承接章。** 兜底必须自动补写或生成可追踪质量债；
  静默删除仍视为缺陷，因为后续章节无法再看到这条职责。
- **以为质量债等于静默通过。** 债必须持久化到 session / 未写章节历史 / 来源章
  `capacityPlan.deferable` 并进入后续规划上下文；只打 console 不算记录。
- **单章本地反复重试结构性超载。** 单章再生成无法把职责交给后章；结构性超载应走窗口重规划。
- **旧合同被判死。** 持久化/读取 schema 对 `capacityPlan` 保持可选，新生成合同才强制要求；
  否则旧书续写会被升级阻断。
- **已写正文被规划审计改动。** 容量审计只写入未写章节的 `repairHistory`，不触碰正文。

## Related Modules

- `shared/types/chapterCapacity.ts`（结构、预算、确定性判定）
- `shared/types/chapterLengthControl.ts`（scenePlan 持久化 `capacityPlan`）
- `server/src/services/novel/volume/chapterDetail/chapterCapacityGate.ts`（候选适配与 issue 映射）
- `server/src/services/novel/volume/chapterDetail/chapterExecutionContractGeneration.ts`（生成/纠正/审计）
- `server/src/services/novel/volume/ChapterTaskSheetQualityGateService.ts`（写前质量门禁）
- `server/src/services/novel/volume/planningRepair/`（窗口重分配、确定性补写、质量债与保存边界）
- `server/src/prompting/prompts/novel/volume/chapterDetail.prompts.ts`
  （`novel.volume.chapter_execution_contract@v15`）
- `server/src/prompting/prompts/novel/volume/planningRepair.prompts.ts`
  （`novel.volume.planning_repair@v16`）

## Source Documents

- `server/src/services/novel/volume/chapterDetail/README.md`
- `server/src/services/novel/volume/planningRepair/README.md`
- `docs/wiki/workflows/chapter-production-chain.md`
