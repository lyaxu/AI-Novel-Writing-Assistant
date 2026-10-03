# 规划标记约定（[承诺:<key>] / [伏笔:<key>]）

## 背景

伏笔与承诺如果只存在于账本（`PayoffLedgerItem`）里，正文永远读不到它：规划阶段
没有任何一条要素指向"这一章要回收哪一条承诺"。结果是账本越积越多、正文照旧兜转。

竞品的做法是在章节的 `requiredElements` 里写出回收动作，并用内部标记把"这条要素在
回收哪一条承诺"说清楚。我们采用同样的思路，但把标记形态固定在一个地方。

## 决策

标记形态：`[伏笔:<ledgerKey>]`（伏笔回收）与 `[承诺:<ledgerKey>]`（承诺推进），
其中 `ledgerKey` 就是 `PayoffLedgerItem.ledgerKey`。

**形态只在 `services/payoff/planningToken.ts` 一处定义。** planner 渲染、覆盖检查、
正文泄漏守卫三方共用同一个函数，避免三处各自拼字符串导致形态漂移（一处改了、另两处
没跟上，检查会静默失效）。伏笔模块 `foreshadowRevealObligations.ts` 只做 re-export，
不保留自己的实现——**同一个约定不允许存在两份实现**。

**承诺与伏笔共用同一套机制。** 两者都是"这一章欠账本的一件事"，判定、覆盖检查、
泄漏检查与出口完全一致，因此不建第二套通道。

**不需要新增数据库列。** `PayoffLedgerItem` 已有的 `targetStartChapterOrder` /
`targetEndChapterOrder` + `currentStatus` 足以表达"本卷必须回收"：窗口落在本卷章节区间
内且非终态的，才是本卷义务；窗口在更后面的留给后面的卷。

## 当前规则

1. **覆盖判定按显式标记，绝不按文字相似度。** 某章用文字描述了同一件事但没带标记，
   仍然判为未覆盖。理由是"看着像写了"与"确实安排了"是两件事；用相似度判定会让检查
   变成猜谜，也无法在正文改动后稳定复现。
2. **标记只属于规划层。** 成稿正文里出现标记即报告为缺陷。调用点：
   `services/novel/runtime/proseQuality/ProseQualityDetector.ts` 的
   `prose_foreshadow_token_leak`（severity `critical`，与 `prose_placeholder_leak` 同级——
   两者都是"读者看见了账目"）。它随 `detectProseQuality` 在验收时一起跑，
   因此复用了既有的确定性正文检查管线，而不是另建一条通路。
   未闭合标记不算泄漏；正常叙述里提到「伏笔」一词也不算（那是 soft 工程词信号）。
3. **重复引用只计一次**，最早章节胜。
4. **引用卷外承诺记为 `unexpectedTokens`**，不静默接受——这通常意味着 planner 引用了
   不属于本卷的义务。
5. **未闭合标记直接忽略**，不猜。
6. **第一卷门槛为 0，第二卷起默认 60%**（`evaluateVolumeRevealRate`）。第一卷允许只
   埋设与推进；无义务时平凡通过（`plannedRate = 1`），不报假缺口。
7. **回收不等于一次揭光。** 渲染出的指令明确允许只推进、部分揭示或给出反证，但必须
   让读者看到相对于前文的新信息；留待后卷的真相不得提前说出。
8. **缺口不阻断链路。** 未覆盖的义务进审查记录作为质量债，而不是让章节生成失败。

## 失败模式

- **只验证 schema 与 prompt 文本就认为完成。** 阶段 B 曾因此把"已生成"误记为"已落库"，
  实际模型产出在写入前被丢弃。判定标准必须是"能不能读回来"。
- **把标记写进 prompt 静态规则。** 标记要跟随数据走（渲染进上下文），否则 planner
  看不到具体要引用哪一条，只看到一条抽象约定。
- **用最小条数硬约束 schema。** `requiredElements` 用 `max(8).default([])` 而非
  `min(3)`：硬下限会让模型漏写时生成失败并重试，与"局部规划缺口不阻断链路"冲突。

## 相关模块

- `server/src/services/payoff/foreshadowRevealObligations.ts`（判定、覆盖、泄漏、回收率）
- `server/src/services/payoff/payoffCadence.ts`（承诺推进节奏，与本文档同源）
- `server/src/services/novel/volume/volumeGenerationOrchestrator.ts`（`loadPayoffCadence`
  组装本卷义务并注入章节细化上下文）
- `server/src/prompting/prompts/novel/volume/contextBlocks.ts`（`payoff_cadence` 块）
- `server/src/prompting/prompts/novel/chapterLayeredContext.ts`（`requiredElements` →
  `mustAdvance` → writer 的 `mustHitNow`）
