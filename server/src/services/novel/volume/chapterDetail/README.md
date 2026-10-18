# 章节执行合同细化边界

## 职责

本目录负责卷规划进入单章生产前的最后一层结构化细化：章节目的、边界、任务单、读者体验合同与场景卡 Schema，以及对应的 AI 生成和质量门禁调用。

## 依赖规则

- Prompt 资产可以通过 `volumeGenerationSchemas.ts` 的兼容导出取得 Schema；Schema 文件不得反向加载 Prompt 或生成服务，避免模块初始化循环。
- AI 生成只通过 Prompt Registry 资产与 `runStructuredPrompt` 进入，不允许在服务内新增内联业务 Prompt。
- `volumeGenerationHelpers.ts` 是兼容门面；外部调用方不应深层导入本目录内部文件。
- 已有任务单和场景卡在无新 guidance 时继续复用；质量门禁、读者体验字段和场景体验字段不得在兼容层放宽。

## 可复用的状态声明

保存的任务单、完整执行合同和规划修复共用 `stateClaims`。声明包含主体、命题、`prior/planned` 时序、`fact/intention/attempt/outcome` 模态和来源。已写来源只选当前正文目录的 ID；本章建立的状态绑定具体场景及 entry/action/exit；未知状态必须显式说明未知。决定、尝试和既成结果不能相互替代，已有事实也不能禁止人物在本章作出不同的新选择。

模型 wire 与保存结构分开：顶层 `stateClaims` 只放前文上下文；本章声明只出现在所属场景 `stateTransition.entryClaims/actionClaims/afterClaims`，不再重复填写 `sceneKey/phase` 及反向 action/after ID。`beforeClaimIds` 引用上下文或此前场景声明；本场 entry 声明自动进入 before。程序由归属生成统一声明表与阶段 ID，投影兼容的 entryState/exitState 及前提 condition/sourceKind/reference。投影不截断，入口/离场合并文本各不超过240字符，超限作为明确结构问题交回纠正。阶段引用禁止提前使用本场动作、离场或后场景的条件。

首章没有前文仍可通过本场 entry 声明建立符合书级设定的初始处境；它是计划呈现，不是历史已证事实。声明放到 entry 不能成为绕过证据的办法：不存在的既得资源、权限、能力或未知旧史仍须由语义复核识别。所有自由叙述仍需 AI 检查是否符合声明，结构有效不等于命题正确。

保存的 scenePlan 同时保留声明和引用，旧合同读取格式不变。新 Prompt 使用保真 JSON 接收层，在 postValidate 执行严格 wire schema 和关系校验；接收层不是放宽准入，也不调用只看到局部字段的 JSON 修复。完整拒收响应保留给既有有界纠正，关系错误聚合 path、claimId、expected、actual，避免每轮只发现一个图错误。实际发送的完整骨架来自共享连贯占位示例，测试必须执行追加骨架→严格 schema→关系绑定，不以手写正确 fixture 替代模型协议覆盖。修复旧候选须把其 planned 声明迁回场景归属位置再生成，不照抄旧 wire。

章节列表在服务装配阶段读取真实 `writtenEvidence`，细化继续读取同一权威来源。跨卷列表的读取边界使用全书章序，不能把节奏段的卷内序号传给正文查询。已写事实限制计划可行性；旧节奏、标题和摘要只提供叙事职责，冲突时保留职责并重新安排可实现的动作。

## 单章细化的保存边界

`chapter_detail` 的 slim HTTP 请求在生成后经 `ChapterDetailCommitService` 提交。生成服务保留不可由客户端伪造的来源凭据；提交事务核对卷版本和章节修订时间，再只把目标章合入来源工作区。目标 Chapter 执行字段、卷规划与版本在同一事务内保存，正文、顺序及生产状态不在更新字段中。目标章 StoryPlan 单独失效，由后续正式规划入口重建。

来源工作区必须取自实际保存结果，不能使用请求携带的整卷编辑草稿作为提交基线；草稿仅提供生成上下文与目标章输入。首次细化没有正文行时可在同一事务创建目标空 Chapter，不要求用户先整卷同步，也不创建相邻空章。已有 chapterId 断链或顺序改变则拒绝。任务所有权 writeGuard 随来源凭据保存并在事务首尾复核。

任务单细化仍必须通过完整生成语义门禁及提交时结构核验。目的/边界单字段编辑不冒充完整执行合同。相邻半成品的场景卡不参与目标章准入，也不获准写入其他 Chapter；不能用全局 `allowIncompleteExecutionContracts` 消除错误。

提交前不能先持久化工作区、再读取 Chapter 反向 hydrate、最后尝试同步：中途失败会把新工作区与旧执行行混合。普通全卷显式同步也必须由同步事务统一保存。slim 单章成功后客户端仅刷新，不重复 PUT 全卷；并发修改导致来源失效时保留原结果，要求刷新重试。
