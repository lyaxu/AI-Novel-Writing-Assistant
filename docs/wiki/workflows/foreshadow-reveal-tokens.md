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

## 全书伏笔表与章节动作（规划层）

账本与标记解决的是“已生成内容怎么被回收”。从故事引擎开始，还多了一层**作者侧伏笔
表**，用于在写之前就把核心谜团排进章序：

- `StoryMacroPlan` 新增两个逻辑字段：`bookBlueprint`（开局/发展/升级/高潮/结局五阶段
  及章范围、结局结果/代价/支线收束）与 `foreshadowSchedule`（3-8 条核心伏笔/谜团，
  最多 20 条）。
- 每条伏笔必须有 `question`（读者问题）、`truth`（作者真相）、`content`（正文可见
  线索）、`plannedPayoff`（计划兑现）、`plantChapter`、`progressChapters`、
  `revealChapter`，并满足 1 ≤ 埋设 < 推进 < 回收 ≤ 目标章数。
- **不新增数据库迁移**：两个字段保存在 `StoryMacroPlan` 已有 JSON 列
  （`constraintEngineJson` 的扩展 payload）里；老书没有字段时按 undefined 处理，
  规划与写作行为不变，不把“没有伏笔表”当成“没有伏笔”。
- 规划层与运行层分属不同事实：`foreshadowSchedule` 是作者计划，
  `PayoffLedgerItem` 是已生成内容的事实账本。**当前尚未做两者的自动同步**；
  伏笔表先服务规划、章纲与复核，不能用计划表冒充已写事实。

### 章节动作如何进入链路

1. 故事引擎 prompt 输出五阶段与伏笔表；服务端规范化、校验，并把 error 级问题写回
   `issues`，不阻断保存。
2. 卷规划（战略/骨架/节奏/拆章/章节细化）通过现有 macro 上下文块读取全书框架与
   伏笔表；拆章额外拿到本卷范围内的伏笔动作，并被告知按表安排章序。
3. 章纲生成（`novel.volume.chapter_execution_contract`）注入“本章伏笔动作”必选块：
   要求每条动作写入 `requiredElements`，并以该条的 `[伏笔:Fxx]` 标记开头；
   未到回收章只给可见线索，不提供作者真相。
4. 章纲生成后做确定性覆盖检查：按结构化标记找动作，缺项按“输出无效”退回一次修复，
   不静默降级成质量债。
5. 章节规划（`planner.chapter.plan`）注入同一动作块，并在 `postValidate` 里检查
   `mustAdvance` 是否携带对应标记；缺失触发一次语义纠正。
6. 正文写作上下文通过 `MacroConstraintContext.chapterForeshadowActions` 获得本章动作
   精简提示（埋设/推进只给可见线索，回收章才给作者真相与计划兑现）。

### 规则

- 判定只看 `[伏笔:Fxx]` 结构化标记，不按剧情关键词相似度猜测。
- 标记是规划内部约定，正文出现即按现有 `prose_foreshadow_token_leak` 处理。
- 缺失动作走“先修复当前章纲/规划”的路径，不进入全局重规划，也不改写已写正文。
- 目标章数用共享默认（默认 100 章），章序越界由 `validateStoryFramework` 报告。

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
