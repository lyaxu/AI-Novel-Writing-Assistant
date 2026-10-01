# 读者体验合同

## Background

章节任务、边界合同和义务合同可以保证“这一章必须做什么”，但不能单独保证“读者为什么愿意读完并继续下一章”。如果正文只消费任务目标、事实和禁区，模型容易生成结构正确但回报不足、主角被动、场景无转折或只制造新钩子的章节。

读者体验合同用于把书级阅读承诺、卷级读者回报和章节局部执行统一成一个可被正文、验收和修复共同消费的结构化合同。

## Decision

每章只维护一份 `ReaderExperienceContract`。合同由章节细化 Prompt 通过结构化 AI 输出生成，与 `ChapterScenePlan` 一起保存在现有 `sceneCards` JSON 中。

合同字段覆盖：

- 读者进入本章时的核心问题。
- 本章必须交付的可见回报及回报级别。
- 主角的即时欲望和主要阻力。
- 本章关键转折、情绪位移和信息交付。
- 章末相对章初的净变化。
- 从上一章或短弧继承的钩子责任。
- 本章结束时的追读钩子。

场景卡同时维护 `resistance / turn / emotionalShift / readerValue`，保证场景不只是信息搬运或状态过渡。

场景的 `causality` 进一步约束前提来源、人物选择、阻力回应、结果机制和持续代价；它与读者体验合同配合，用来区分“规定的结果出现了”和“结果有可信成因”。字段、证据审查与旧数据边界见 [场景因果与质量证据](scene-causality-and-quality-evidence.md)。

## Current Rule

- 新章节执行合同必须由 AI 返回完整读者体验合同和场景体验字段。
- writer、acceptance、repair 和 patch repair 消费同一个 `reader_experience` context block，不得各自重新解释一套读者目标。
- `promisedReward`、`keyTurn` 和 `netChange` 必须能在正文中被读者直接感知。
- `rewardLevel` 表示本章计划提供的可见回报强度，合法值只有 `setup`、`partial`、`major`，不是正文对承诺的兑现比例或事后完成状态。即使 `promisedReward` 已被完整兑现，也不应改成不存在的 `full`；只有计划回报强度与章节职责不匹配时，才在三种合法级别之间调整。
- `inheritedHookResponsibilities` 优先于新增钩子；允许部分兑现，但不允许连续只加问题不给旧问题任何回报。
- 普通读者体验缺口属于章节局部修复或质量债，不得单独触发全局 `replan_required`。
- 旧章节缺少新字段时，运行时可以从已有 chapter mission、边界合同、角色目标、开放冲突和 hookTarget 生成兼容投影。兼容投影只服务旧资产，新章节仍必须依靠 AI 结构化输出。

## Context Ownership

- Book Contract：整本书对读者的长期承诺、主角幻想、升级阶梯、关系主线和 3/10/30 章阶段兑现。
- Volume Strategy：当前卷的核心读者回报与全书卷级回报梯度。
- Reader Experience Contract：当前章如何把长期承诺转成可见回报、主动行动、转折、净变化和钩子承接。
- Chapter Obligation Contract：当前章必须命中、保留、触碰和禁止越过的执行义务。
- Novel Fact Ledger：已经发生并经正文观测或验收确认的不可逆事实。
- Payoff Ledger：跨章承诺和伏笔的目标窗口、推进及兑现状态。
- Timeline：事件展示、异步抽取和诊断资产；不作为正文 Prompt 的 required context。

## Compatibility

第一阶段不增加数据库列。`ChapterScenePlan.readerExperience` 和场景体验字段都有旧资产默认值，因此旧 `sceneCards`、旧运行包和恢复记录仍可解析。

结构化生成 schema 与兼容读取 schema 必须保持区分：

- 新 AI 输出缺少核心字段时应被拒绝并进入现有语义重试。
- 旧持久化数据缺少字段时应补默认值，不得让恢复链崩溃。

## Failure Modes

- **新章节仍没有合同**：检查章节执行合同 Prompt 版本、Registry 注册版本和结构化输出 schema 是否一致。
- **合同存在但 writer 看不到**：检查 `reader_experience` 是否进入 writer required groups，以及上下文 Broker 是否允许该 group。
- **修文破坏原有爽点**：检查 repair context 是否消费同一合同，并要求保留已经兑现的 `readerValue`。
- **审查建议出现 `rewardLevel=full`**：这是把回报强度误读成兑现完成度。检查章节任务单质量 Prompt 是否保留枚举和语义边界；不要将该建议写回合同，因为 `full` 不属于结构化合同 schema。
- **卷规划有回报、章节运行时丢失**：检查当前卷 `sourceVersion.contentJson` 中的 `strategyPlan` 是否被恢复到 `VolumeWindowContext`。
- **旧章节恢复失败**：检查兼容读取是否错误使用了只适用于新生成结果的严格 schema。
- **普通读感问题阻断全书**：检查验收是否把读者体验缺口错误升级为 `needs_manual_review` 或 `replan_required`。

## Emotion Presence (Q11)

情绪规则与读者体验合同配合使用。`readerExperience.emotionalShift` 指定本章的情绪位移方向，但该字段只是标签；`context/emotionPresence.ts` 中的规则约束情绪如何在正文中**落地**：

- **写作向规则**（`CHAPTER_EMOTION_RULES`，注入 writer prompt）：情绪必须在同一段落内改变说话方式/动作选择/判断；处境压力须在行为中有可见痕迹；不强制命名情绪；不堆砌同义词。
- **审查向规则**（`CHAPTER_EMOTION_AUDIT_RULES`，注入 acceptance/review/repair prompt）：每处情绪标签后检查行为后果；克制和未命名的情绪获准；不把情绪词密度当质量指标。

规则通用（无题材/角色硬编码）。已验证覆盖四条链路：writer → acceptance → review → repair。



- `shared/types/novel/readerExperience.ts`
- `shared/types/chapterLengthControl.ts`
- `shared/types/chapterRuntime.ts`
- `server/src/prompting/prompts/novel/volume/chapterDetail.prompts.ts`
- `server/src/prompting/prompts/novel/chapterLayeredContext.ts`
- `server/src/services/novel/runtime/GenerationContextAssembler.ts`
- `server/src/prompting/prompts/novel/chapterWriter.prompts.ts`
- `server/src/prompting/prompts/novel/chapterAcceptance.prompts.ts`

## Source Documents

- `docs/plans/reader-experience-contract-phase-one.md`
- `docs/wiki/workflows/chapter-production-chain.md`
- `docs/wiki/workflows/novel-fact-ledger.md`
