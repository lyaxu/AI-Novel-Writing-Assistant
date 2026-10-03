# 证据不足的判定如何避免变成阻断

## 背景

章节验收会产出多种判定，其中 `insufficient_evidence`（提供的文本不足以判断）最容易
被误用成阻断：模型一旦无法核证某件事，就倾向于把它当成问题上报，而"我查不到"与
"这里确实错了"是两种完全不同的事。前者判罚会让链路因为**信息缺失**停下来，而缺失
往往是上下文覆盖范围的限制，不是正文的缺陷。

竞品的处理方式是把门禁设为建议模式，并让"证据不足"的阻断项被忽略、降级为提醒。

## 决策

我们不靠单点代码，而是**三层一致**地保证 `insufficient_evidence` 不阻断：

1. **严重度分级**：`insufficient_evidence` 一律判为 `medium`。
   - `acceptance/causalAssessment.ts:42` —— 只有 `contradicted` 是 `high`，其余（含
     证据不足）是 `medium`。
   - `acceptance/progressionProjection.ts:22` —— 直接 `medium`。
2. **阻断集合按严重度收口**：`chapterRuntimePackageBuilders.ts:379-381` 只把
   `high`/`critical` 收进 `blockingIssueIds`，`hasBlockingIssues` 再由它决定。
3. **升级为修复显式排除证据不足**：
   - `causalAssessment.ts:61-66`：`onlyUnknown`（失败项全是证据不足）时不升级为
     `repairable`，而是把 `accepted` 降为 `continue_with_risk` + `continue`。
   - `progressionProjection.ts:34-35`：只有 `stalled` 触发修复，证据不足从不触发。
   - `actionStateProjection.ts:55`：`needsRepair` 明确排除 `insufficient_evidence`。

提示词层同样写明：`chapterAcceptance.prompts.ts:479` 要求"局部缺口优先
repairable/continue_with_risk，遵守既有继续策略，**不自行升级为全局停止**"。

## 当前规则

- 证据不足是**可见的债**，不是虚构修复的许可，也不是停写的理由。
- 它的修复建议是"核对前后章节原文与覆盖范围"，而不是"补写一段桥段"——因为缺失的
  是证据，不是情节。
- 只有 `stalled`（有前后原文证明职责重复且无相应变化）与 `unearned`/`contradicted`
  这类**有证据的**判定才会触发局部修复。

## 失败模式与陷阱

**命名陷阱（重要）**：证据不足的条目仍然会被 push 进一个名为 `blockingIssues` 的
数组（`causalAssessment.ts:40`、`progressionProjection.ts:21`）。名字带 blocking，
但**实际是否阻断由 severity 决定**。改动这段代码时不要因为它在 `blockingIssues` 里
就以为它阻断了链路；反过来，也不要把 medium 提升为 high 来"让问题更显眼"——那会
立刻把信息缺失变成硬停。

**诊断路径**：若观察到因为"证据不足"而停写，按上面三层依次查——先看该条目的
severity，再看 `blockingIssueIds` 的过滤条件，最后看 `promotesToRepair` 的判定，
而不是先去改提示词。

## 相关模块

- `server/src/services/novel/runtime/acceptance/causalAssessment.ts`
- `server/src/services/novel/runtime/acceptance/progressionProjection.ts`
- `server/src/services/novel/runtime/acceptance/actionStateProjection.ts`
- `server/src/services/novel/runtime/chapterRuntimePackageBuilders.ts`
- `server/src/prompting/prompts/novel/chapterAcceptance.prompts.ts`
