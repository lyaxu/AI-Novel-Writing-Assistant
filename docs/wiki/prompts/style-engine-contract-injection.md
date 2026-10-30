# 写法引擎：从写法资产到正文合同

## 背景

用户反馈“写法引擎看起来是空壳”：选了金庸、天下霸唱或个人的市井细腻写法，正文却没有明显变化。逐段核对链路后，链路本身没有断：

- 书级 `StyleBinding` 存在；
- 导演任务 seed 带 `styleProfileId`；
- runtime 能解析出 `ResolvedStyleContext`；
- writer 上下文块 `style_contract` 确实出现在提示词里。

真正的问题有三类：

1. **同优先级绑定的合并顺序反了。** 用户从“这本书的默认写法”里重新选择写法时，前端固定传 `priority=1`；旧版 `resolveForGeneration` 按低优先级先合并、同优先级沿用查询顺序（新绑定在前），结果旧写法的规则最后写入并覆盖新写法。界面显示已切换，正文仍按旧写法生成。
2. **内置写法的合同不可执行。** 金庸、天下霸唱等内置模板把规则存成 `legend_arc`、`classical_vernacular`、`medium_fast`、`action_and_dialogue` 这类枚举 token，旧编译器原样输出 `narrative.progressionMode: must keep legend_arc`。模型拿到的是配置键，不是写作指导；只有 summary 行可读。
3. **未选写法时仍会注入空壳合同。** 只有全局反 AI 底线时，编译器仍会输出 `Narrative contract`、`Character contract` 等空标题，看起来像“有写法但没规则”。

另外，写法合同在上下文预算紧张时可能被摘要，旧实现没有为“优先保留语言/节奏/叙事核心”做安排，也没有告警日志。

## 决策

写法资产要真正影响正文，必须满足四个条件；缺一不可：

1. **选择要落在可竞争的绑定上。** 新建书级/章节级绑定时，服务端归一化优先级：新绑定自动排到已有绑定之前；重复选择同一套写法时提升原绑定，不重复创建。合并顺序固定为“从宽到具体、从低优先级到高优先级、从旧到新”，越靠后越优先，保证“刚选的写法”一定赢。
2. **合同要是可执行的中文写作指令。** 编辑器把已知枚举翻译成具体写法（例如 `classical_vernacular` → “文白相间、不掉书袋”，`medium_fast` → “中快节奏：推进为主，关键处放慢”），未知字段保留原值。合同顺序为叙事 → 语言 → 节奏 → 人物 → 反 AI → 自查。
3. **正文提示里要能看见并使用。** writer context 的 `style_contract` 块保持不变（review/repair/增量补写也带）；未选写法时改用独立的 `anti_ai_baseline` 块，不再产生空壳写法合同。
4. **预算压缩要保住核心。** 合同正文前增加“写法合同速览”（叙事/人物/语言/节奏各一行），合同末尾增加执行顺序与写作前自查；上下文预算不足时优先保留速览与语言/节奏方向。压缩或丢弃时写运行日志。

## 当前规则

### 链路

```
StyleProfile（规则 JSON）
  → StyleBinding（书/章/任务，priority + weight）
  → 导演任务 seed.styleProfileId / runtime request.taskStyleProfileId
  → StyleRuntimeResolver.resolve（命中绑定 + 反 AI 规则）
  → StyleCompiler.compile（可执行合同 + meta）
  → chapter writer context block style_contract
  → chapterWriterPrompt 上下文
```

- 选择与持久化：`POST /style-bindings`；书架页“这本书的默认写法”和应用导演开书都会创建书级绑定；导演任务 seed 保存 `styleProfileId` 与 `styleIntentSummary`，运行时同时支持 `taskStyleProfileId` 直接覆盖。
- 解析：`StyleBindingService.resolveForGeneration`。同字段冲突时，更具体（书 < 章 < 任务）、更高优先级、更新的绑定覆盖前面来源；`effectiveStyleProfileId` 与实际合并结果保持一致。
- 编译：`StyleCompiler` + `styleRuleText`。枚举翻译、字段中文标签、权重档位（必须/优先/自然使用）都在这一层完成；`maturity` 只用于诊断。
- 注入：`buildChapterWriterContextBlocks` 生成 `style_contract`（有写法规则时）或 `anti_ai_baseline`（只有全局反 AI 时）；`buildChapterWriteContext` 从 runtime `styleContext.compiledBlocks.contract` 取合同。
- 预算：`style_contract` 为 required 块，`allowSummary` 保持默认；合同速览在最前，压缩时先保留。写作/续写调用结束后，若 `style_contract`/`anti_ai_baseline` 被摘要或丢弃，`ChapterWritingGraph` 记录告警日志（章节、阶段、摘要/丢弃的块 ID）。
- 降级：未选写法或合同为空时，正文照常生成，只是没有 style 约束；编译/解析失败不会阻断写作（选择缺失时仅保留全局反 AI 底线）。
- 写后评审：没有命中真实写法（只有反 AI 底线）时不运行写后写法评审，避免把空合同当风格标准。

### 内置写法

金庸古典武侠写法、天下霸唱诡谲探险写法等内置资产来自 `server/src/services/styleEngine/defaults.ts`，规则字段保持结构化 token（便于编辑与兼容），但在正文合同里必须翻译成可执行描述。个人写法（如 `docs/style-profiles/shijing-xini.json`）本身已经是中文规则，原样进入合同并带示例。

### 与开发调试的关系

- 排查“选了写法没效果”时，先看 writer 提示词 meta 的 `contextBlockIds` 是否包含 `style_contract`，再看 `ResolvedStyleContext.effectiveStyleProfileId` 与合同 narrative 段是否来自新写法。
- 若日志出现 `Style contract context was compressed by the prompt budget`，说明上下文预算挤掉了部分合同；优先看速览与语言/节奏段是否还在。
- 不要用关键词或作者名做固定路由；写法选择、收益与反制判断都交给结构化 AI 与已保存规则。

## 示例

推荐：

- 用户把书级写法从细腻切到金庸：新绑定 priority 自动 +1，合并顺序让金庸规则最后写入；正文合同出现“传奇式成长弧/文白相间/中快节奏”。
- 未选写法：writer 没有 `style_contract`，只有 `anti_ai_baseline` 的“禁止总结主题”等底线，仍可正常写作。

不推荐：

- 直接修改数据库把两套写法置为同一 priority 后期待“后选的赢”；判断应依赖服务端归一化与合并顺序。
- 在编译器里删掉内置模板的枚举字段；这些字段仍用于编辑与兼容，展示层负责翻译。
- 为了“风格更强”把所有规则堆成超长块而不留速览；预算压缩时反而会丢掉方向。

## 失败模式

- 同优先级绑定旧规则覆盖新规则：症状是界面已切换、正文没变化；修复后由 `createBinding` 归一化优先级，若仍怀疑旧数据，检查 `StyleBinding` 的 priority/updatedAt。
- 合同只有标题没有规则：曾由“只有全局反 AI 底线”触发；现在改为 `anti_ai_baseline` 块，不再伪造写法合同。
- 合同被摘要后只剩第一段：现在速览在最前，语言/节奏方向优先保留；日志会提示压缩。
- 把写法合同只注入 planner 不注入 writer：正文仍会丢风格；本链路要求 writer context 必有（有写法时）。
- 直接改 prompt 文案但不升版本：写法合同属于 Prompt 上下文，不是 PromptAsset 正文；改动合同渲染后必须跑 writer context 定向测试。

## 相关模块

- `server/src/services/styleEngine/StyleCompiler.ts`
- `server/src/services/styleEngine/styleRuleText.ts`
- `server/src/services/styleEngine/styleContractText.ts`
- `server/src/services/styleEngine/StyleBindingService.ts`
- `server/src/services/styleEngine/AntiAiPolicyResolver.ts`
- `server/src/prompting/prompts/novel/context/chapterContextBlocks.ts`
- `server/src/services/novel/chapterWritingGraph.ts`
- `server/src/services/novel/runtime/PostGenerationStyleReviewRunner.ts`（无写法时跳过评审）
- `shared/types/styleEngine.ts`
- `docs/style-profiles/shijing-xini.json`

## 来源文档

- 用户反馈：金庸/天下霸唱/市井细腻三个写法选后“像空壳、正文没变化”。
- `docs/wiki/prompts/platform-writing-profiles.md`
- `docs/wiki/workflows/personal-style-and-task-cleanup.md`
