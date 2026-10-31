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
   `requiredElements`（可延期职责因此被移出本章），并校验每条 `deferable` 在窗口内更晚章节
   确有承接；没有承接就拒绝保存并提示需要进入卷规划修复，而不是静默丢掉职责。
5. **复用/写前准备**：已保存合同在复用、读取就绪和正文准备入口会重新跑容量评估；
   带容量计划但不合格的合同不会被当作可复用合同，旧合同缺字段则保持兼容。
6. **必须写正文前的最终边界**：容量门禁失败 → 生成/规划修复失败 → 不进入 writer。
   已写正文、已批准章节、锁定章节和跨卷章节不能被修复窗口修改。

### 自动拆分（不新增插章）

当前卷链没有安全的“插入新章并重排后续章节”能力，因此自动拆分复用规划修复窗口：
把来源章超载的可延期职责写进当前章之后的一到两个未写同卷章节的任务单/场景，并保持各章
原始字数预算不变。窗口内没有后续可写章节（下一章已写/锁定，或跨卷）时，系统不硬塞，
规划修复返回 `requiresUserDecision`（或 domain 拒绝保存）并提示进入卷规划修复。

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
- 无后续可写章：来源章仍有可延期职责，但后两章已写/跨卷 → 不自动拆，提示进入
  卷规划修复；不删除职责，也不把超出容量强行交给正文。

## Failure Modes

- **只改 prompt 不加确定性门禁。** 模型仍会输出超载清单；必须有代码侧容量判定与结构化失败。
- **用关键词猜“事件数量”。** 判定只读 `capacityPlan` 的结构化字段；不按剧情词表或题材规则统计。
- **把可延期职责从来源章删掉却没有承接章。** `applyPlanningRepairCandidate` 必须拒绝保存，
  否则“拆分”会退化成静默丢职责。
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
- `server/src/services/novel/volume/planningRepair/`（窗口重分配与保存边界）
- `server/src/prompting/prompts/novel/volume/chapterDetail.prompts.ts`
  （`novel.volume.chapter_execution_contract@v15`）
- `server/src/prompting/prompts/novel/volume/planningRepair.prompts.ts`
  （`novel.volume.planning_repair@v15`）

## Source Documents

- `server/src/services/novel/volume/chapterDetail/README.md`
- `server/src/services/novel/volume/planningRepair/README.md`
- `docs/wiki/workflows/chapter-production-chain.md`
