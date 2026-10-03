# 角色硬事实即人物不变量（不要另建 invariants 结构）

## 背景

竞品把人物的稳定属性拆成 `invariants`（身份不变量）与 `stateVariables`（可变状态），
并在写作提示里加"身份锁"，防止模型换了一轮就把人物的阵营、境界、所在地写漂。

在动手补这套结构之前先做了核查，结论是**我们已经有等价物，而且更完整**：它叫
**角色硬事实**（`characterHardFacts`）。

## 决策

**不再新建 `invariants` / `stateVariables` 结构。** 字段对应关系：

| 竞品概念 | 我们的字段 |
| --- | --- |
| `invariants`（身份不变量） | `identityLabel`、`factionLabel`、`stanceLabel`、`powerLevel`、`realm` |
| `stateVariables`（可变状态） | `currentLocation`、`availability`、`currentState`、`currentGoal` |
| 禁止清单 | `prohibitions` |
| 竞品没有的 | `pendingReviewFields`（待复核字段） |

`pendingReviewFields` 是竞品没有的一层：某个状态字段正在被复核时，它只作为参考，
与最新剧情冲突时可依合理逻辑调整。这避免了"状态刚变化但复核未完成时被硬锁死"。

## 当前规则

- **归属模块**：`services/novel/characters/characterHardFacts.ts`。
- **注入范围**：写作、审查、修复三条链路，经上下文提供契约 `character_hard_facts`
  注册——`tier: hard_required`、`failureSemantics: "block"`、`priority: 120`、
  `tokenBudget: 900`。也就是说它不是可选上下文，缺失会被当成硬错误。
- **渲染位置**：`prompting/prompts/novel/context/chapterContextBlocks.ts` 的
  `buildCharacterHardFactsText`，块标题为【角色硬事实】。
- **身份锁文案**：块首句明确写「以下内容是正文生成前的**不可违背写作约束，优先级高于
  软性人物简介**」。这就是竞品所谓 identity lock 的等价物。
- **空数据也要设边界**：没有已登记硬事实时，提示词仍要求「不得凭空改写角色阵营、身份、
  境界、所在地或行动可用性」，并要求「如章节任务没有明确要求，不要新增不可逆角色状态」。
  空上下文不等于没有约束。
- **人数上限**：渲染时取前 8 个角色，避免长篇里角色表膨胀吃满预算。

## 失败模式

- **重复造结构**：看到竞品的 `invariants` 就新建一套字段，会与 `characterHardFacts`
  并行存在、各填一半，两套都不可靠。**先查 `characterHardFacts` 再决定。**
- **把竞品的字段名当需求**：竞品的命名不等于我们的缺口。核对"字段对应关系"而不是
  "字段名字"，是本项目里已经重复出现过三次的教训（另见 `voiceTexture` 与门禁分级）。

## 相关模块

- `server/src/services/novel/characters/characterHardFacts.ts`
- `server/src/services/novel/runtime/context/chapterContextProviderContracts.ts`
- `server/src/prompting/prompts/novel/context/chapterContextBlocks.ts`
- `server/src/services/novel/runtime/repair/chapterRepairRuntime.ts`
- `server/src/services/novel/runtime/GenerationContextAssembler.ts`
