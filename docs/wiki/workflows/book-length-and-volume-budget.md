# 篇幅默认值与分卷章节预算

## 背景

长篇规划长期存在两个隐患：

1. 默认篇幅在客户端和服务端各写死为 80 章，客户端改默认值不会自动影响卷规划、
   自动导演范围或章节准备的兜底值。
2. 卷规划只给“建议卷数”，不给每卷应拆多少章。模型容易把大量章节塞进第一卷，
   后面几卷再临时找内容，阶段节奏和结局回收都被挤压。

竞品的做法是“约 50 章一卷”：先按目标章数确定卷数和每卷章数，再把预算交给卷骨架
与拆章执行。本仓库采用同样的流程，但用确定性代码计算预算，不交给模型自由决定。

## 决策

### 单一默认值

`shared/types/planningScale.ts` 的 `DEFAULT_ESTIMATED_CHAPTER_COUNT = 100` 是唯一默认值。
客户端基础信息、`novelBasicInfo.shared.ts`、服务端 `novelCoreShared.ts` re-export、
`directorCompletion` 兜底、卷生成、自动导演范围、章节准备等全部引用它，不允许再出现
本地 `?? 80` 或第二个 `DEFAULT_ESTIMATED_CHAPTER_COUNT`。

原因：默认值影响的不只是表单显示，还会进入完成度档案、卷战略、结构化大纲、章节契约
和自动导演范围。多个默认值并存时，用户看到 100 章，实际规划却从 80 章开始，问题很难
从 UI 上察觉。

### 篇幅预设

客户端基础信息提供短篇 20 / 中篇 50 / 长篇 100（默认选中）/ 超长篇 200 / 自定义，
并保留手填章节数。总字数按“章数 × 默认章节字数”估算显示。预设值是 UI 选项，
真正传入服务端的仍然是 `estimatedChapterCount` 数字，所以旧接口、旧书和自动导演
不需要新的字段。

### 确定性分卷预算

`buildVolumeChapterBudget(targetChapterCount, { maxVolumeCount })`：

- 卷数 = `ceil(章数 / 50)`，限制在 1-30（服务端传 `MAX_VOLUME_COUNT` 时再收敛到 24）；
- 章节尽量均分，余数优先给前面的卷；
- 例：100 → 2 卷 × 50；80 → 2 卷 × 40；130 → 3 卷 44/43/43。

`buildVolumeCountGuidance` 现在以该预算作为 `systemRecommendedVolumeCount` 和唯一
`decisionVolumeCountRange`。用户明确指定卷数或已有草稿结构时仍优先沿用用户选择，
但 AI 不能自行偏离“约 50 章一卷”的预算。

## 当前规则

- 卷战略 prompt 通过 `volume_count_guidance` 上下文块拿到逐卷章数预算和
  “不得把所有章节挤进第一卷”的要求。
- 卷骨架 prompt 的 `chapter_budget` 块同样携带逐卷预算，而不是只有总数。
- 拆章（章节列表）上下文每个目标卷都会注入 `volume_chapter_budget`：本卷应拆多少章、
  对应全书第几章到第几章。
- 章节列表、卷骨架、卷战略等都复用现有 `buildVolumeCountGuidance` / context block
  管线，没有新建并行流。
- 旧调用方没有传 `volumeChapterBudget` 时，提示层按 `chapterBudget` 现算，保证老数据
  仍可规划。

## 失败模式

- **只改表单默认值。** 服务端兜底仍是旧值时，新书 100 章会走 80 章路径；因此要有
  代码级断言测试（`server/tests/planningScale.test.js`）扫描旧默认值残留。
- **提示词预算与 schema 范围冲突。** 如果预算说 2 卷、`decisionVolumeCountRange` 仍是
  3-4 卷，模型输出会被 schema 判失败。预算、推荐卷数和 schema 允许范围必须同源。
- **把预算只写进静态 prompt。** 每本书的目标章数不同，预算必须作为上下文数据渲染，
  不能写死在 prompt 模板里。
- **超长篇盲目加卷。** 卷数上限与服务端 `MAX_VOLUME_COUNT` 对齐，避免拆出无法管理的卷数。

## 相关模块

- `shared/types/planningScale.ts`（默认值、预设、总字数、分卷预算）
- `shared/types/volumePlanning.ts`（卷数指导与预算同源）
- `client/src/pages/novels/components/basicInfoForm/ChapterLengthPresetField.tsx`
- `server/src/prompting/prompts/novel/volume/shared.ts` / `contextBlocks.ts`
- `server/src/services/novel/volume/volumeGenerationOrchestrator.ts`
