# 章节自动恢复与预算所有权

## 背景

自动导演命令和章节流水线是两层不同的运行单元。导演命令负责推进、监督和投影整本创作；章节流水线作业负责具体章节的生成、审校、修复与保存。服务中断后两层都可能被重新调度，如果各自独立计算重试次数，会重复调用模型，也可能覆盖质量优先策略留下的人工暂停。

## 决策

章节自动处理预算由 `GenerationJob + Chapter` 唯一预约拥有。质量修复和章节运行异常重试共享这一预约，并在模型调用前领取。导演命令的 `attempt` 只表示 Worker 租约领取次数，不是章节模型预算。

章节流水线的跨进程执行权由 `GenerationJob` 上的 owner 与到期时间持有。它覆盖首次正文生成、验收、修复和状态写回；逐章预算只覆盖额外自动处理，不能替代作业租约。

导演租约过期时，恢复逻辑先核对任务保存的 `autoExecution.pipelineJobId`，再验证作业所属小说和作业 payload 中的 `workflowTaskId`。显式保存的作业标识不存在或身份不匹配时属于数据完整性异常，必须暂停，不能退化成“尚未创建作业”并重新调用。已绑定作业仍处于可继续状态时，只重新排队导演监督命令，由章节执行器读取原作业的持久预约；不创建新的章节预算。

## 当前规则

- 同一作业、同一章节最多存在一条自动处理预约；预约成功后即视为额度已使用，崩溃、取消或模型异常不退款。
- 新建作业拥有独立预算；旧作业没有预约记录时按未预约兼容，不根据任务总重试次数猜测历史章节消耗。
- 导演任务或关联流水线任一侧标记 `pendingManualRecovery` 后，后台租约扫描只能保持或传播暂停，不能清除它。只有来源工作台上的显式恢复命令可以继续。
- 无法验证任务与作业的绑定关系或无法读取恢复状态时，按数据完整性风险暂停，不自动调用模型。
- 尚未进入章节流水线的规划类命令继续使用导演问题治理；不能随意映射到某个章节预约。
- 作业只有在 queued/running、未取消、未人工暂停，且没有有效 owner 时才能被新执行者领取。续租必须同时满足当前到期时间尚未过去且小于新到期时间，迟到的旧续租不能缩短有效租约。
- owner 的进度和普通终态写回必须同时满足作业仍为 queued/running、未取消、未人工暂停且租约有效。取消收尾使用独立条件，只能收束已取消或已有取消请求的作业。
- 旧 owner 在租约过期、作业取消、进入人工暂停或被接管后停止普通写入，不把失权解释成任务失败。租约表结构缺失时，安全暂停使用只包含旧字段且不返回完整模型的兼容更新；其他领取异常只能暂停没有 owner 或 owner 已过期的作业，不能覆盖仍有效的执行者。
- 章节执行中的长耗时操作返回后，进入终态提交、资产同步和 generation state 写回前必须重新确认 owner。审校、修复或同步期间已失权的执行者必须在提交前退出，不能把旧正文、审计或资产写入新执行者的作业。
- OpenAI 兼容客户端关闭 SDK 隐式重试。结构化策略切换、JSON 修复和业务重试仍是显式调用，并受各自合同约束。

## 已完成章节与放弃修复的收敛（stale-but-finished）

事实已完成、但技术状态仍停在失败/暂停的边界，不能靠用户在章节源页反复核对来解开。显式「继续自动导演」或「重试」入口（命令受理与 continue 运行时）会在严格恢复预检**之前**执行一次有界收敛；读接口、轮询和后台扫描都不参与收敛，也不直接改状态。

- **已完成章节的陈旧范围任务**：目标是 `currentItemKey` 的章节行已 `chapterStatus=completed`、正文非空；该章活动执行记录的 `operationId` 必须是 `pipeline:<jobId>:<chapterId>`、状态 `completed`、父任务匹配，且没有 `unknown`/`running` 外部步骤、没有活跃租约、没有稿件变化、没有待核对结果。满足时用 CAS（updatedAt/status/pendingManualRecovery/payload/租约）把该 job 收敛为 `succeeded` 并清空当前项，随后按正常路径继续下一章。任一条件不满足（未知调用、正文未完成、稿件/执行约定变化、活跃租约、journal 属于别的 operation）→ 不收敛，仍走严格预检并在章节源页提示核对。
- **终态规划修复**：`abandoned` / `committed` 都是终态，不再持有预算授权或执行绑定。显式重试不得被终态会话挡住（写守卫使用 `isTerminalPlanningRepairPhase`）；收敛可清理终态会话遗留的 `planningRepairRecovery` / `planningRepairPipelineRecovery` 执行绑定，但保留 `planningRepair` 的放弃/提交证据、候选与正文。存在 `pendingGrant` 时不清，交给显式修复入口处理。
- **停在复核阶段的陈旧修复会话**：仅当相位是 `reviewing` 或已无在途调用的 `technical_failed`、任务处于暂停、没有活跃命令、没有 `pendingOperation` / `repairOutputPending` / `pendingGrant` 时，**不带规划修复授权键**的普通继续才把它收敛为 `abandoned`（写明自动收敛原因），让未写章节按原任务重新规划。带 `planningRepairRecoveryKey` 的继续表示用户要重试该修复，必须保留会话。
- **任务指针指向错误的替换任务**：失败重试可能把 `autoExecution.pipelineJobId` 写成自己，但章节日志仍属于原范围 job，于是每次继续都因「目标章既未完成也不是该 job 的暂停」被拒。只有同时证明：替换 job 与原 job 同书、同父任务、同范围、同一 payload，替换 job failed+pending 且 `llmCallCount/totalTokens/completedCount` 全为 0、没有任何 journal 归属、没有取消/活跃租约；原 job failed+pending 且拥有该章 active journal（paused、未过期、无 unknown/running 步骤、正文/执行约定指纹匹配）；当前没有活跃命令、活跃作业，且规划修复终态或不存在 —— 才把任务指针 CAS 回原 job，并把零调用的替换 job 标记结束（保留原 failed 证据）。原 journal、预算和候选一律不动，仍由原 job 恢复。
- **规划修复终止 + 旧 job 丢失章节锚点 → 从候选重建第一章执行**：终态规划修复（或有记录的 `technical_failed`、无在途调用）之后，旧范围 job 可能 `currentItemKey=null` 且 `pendingManualRecovery=false`，此时普通恢复只会报「原章节任务缺少可核对的恢复位置」。重建前先做两步：① **候选采纳**——若 `planningRepair.candidateVersionId` 存在且仍是 `draft`，并且候选卷/章与修复元数据（volumeId、chapterId、chapterOrder、eligibleChapterIds）一致、任务书/场景卡通过共享执行合同形状与容量门禁、已写正文指纹 `writtenSourceFingerprint` 未变、目标章无正文且无执行合同、旧 job 是失败且未持有活跃 journal，则在一个事务内：校验已写正文指纹 → 归档并移除旧 job 的准备阶段 journal（仅限 paused、只含 `prepare*` 步骤、无 unknown/running、无 partial 正文、`expectedFingerprint` 与当前章一致）→ 写回目标章执行合同 → 启用候选版本并持久化卷工作区 → 在 seed 写 `planningRepairCandidateAdoption` 回执；修复相位保持 `abandoned`（会话确实被放弃），不伪造“复核通过”。② **执行重建**——把旧 job 标记 `cancelled` 并保留原 `error`/token 记录，清空 `autoExecution.pipelineJobId/pipelineStatus`，把 `nextChapterId/nextChapterOrder` 指向第一章，写入 `planningRepairExecutionRebuild` 回执；新 job 由正常自动执行运行时创建并绑定。候选不是 draft、合同不完整、正文已存在、已写正文变化、journal 有未知/已完成工作、存在活跃命令/作业/租约时一律不采纳、不重建，保留原暂停。
- **候选不丢、正文不改**：候选采纳只应用候选里已有的计划文本，不重新调用规划模型生成候选；`planningRepair` 的历史、放弃记录、候选版本与 `planningRepairCandidateAdoption` 都保留为审计证据。目标章已有正文或已有执行合同时不采纳（前者交给正文审查恢复，后者走正常执行）。

失败模式：

| 症状 | 原因 |
| --- | --- |
| 章节已完成，继续仍要求源页核对 | 只看 job 状态，没有用章节行 + 完整 journal 证明完成 |
| 放弃修复后重试永远报「仍需确认」 | 写守卫把 `abandoned` 当成未完成修复 |
| 普通继续把用户刚要重试的修复会话结束掉 | 收敛没有区分是否带显式修复授权键 |
| 重新规划时又创建了替代 job，原 journal 被归档 | 没有把指针收敛回 journal 所有者 |
| 收敛覆盖了另一条暂停或人工稿 | 缺少 CAS、租约检查或正文指纹校验 |
| 规划修复已结束，继续仍报「缺少可核对的恢复位置」 | 旧 job 已丢锚点（currentItemKey=null），没有按“候选采纳 + 执行重建”路径收敛；或把 `pendingManualRecovery=false` 误判成“作业仍可恢复” |
| 候选已经可用却又重新生成规划 | 恢复只检查 Chapter/taskSheet，没有读取 planningRepair 的 draft 候选版本 |
| 新 job 启动即报「章节执行所有权已变化」 | 旧 job 的 paused 准备阶段 journal 仍占 active 槽位；重建必须按严格条件归档并移除该记录 |
| 采纳候选时覆盖了已写正文或人工改动 | 缺少 writtenSourceFingerprint / chapterFingerprint / 正文非空检查 |

## 恢复顺序

1. 读取导演任务及其持久化的流水线作业标识。
2. 校验小说、任务和作业身份。
3. 若存在人工暂停，收束过期命令并保留暂停原因。
4. 若作业仍可继续，重新排队导演监督命令；章节流水线按原 job 恢复。
5. 章节调度器原子领取 job 级执行租约，并在执行期间续租；领取失败表示已有有效执行者，不重复进入。
6. 章节执行器在每章入口读取预约；已有预约时将自动修复额度设为零。
7. 若租约或预约读取、写入失败，在任何新增模型调用前停止。
8. 正常结束时仅由当前 owner 释放租约；失权执行者的释放不会清除新 owner。

## 失败模式

- 把 `DirectorRunCommand.attempt` 当作章节重试次数：规划阶段与章节阶段混用额度，恢复结果不稳定。
- 后台扫描直接写 `pendingManualRecovery=false`：会越过质量优先策略的人工确认边界。
- 只在修复成功后计数：模型已调用但异常返回时，恢复会再次付费调用。
- 把逐章自动处理预约当作完整执行租约：它只阻止第二次自动修复，不能阻止两个进程同时进入首次章节生成。
- 只按 owner 写状态而不检查到期时间：事件循环长时间停顿后，过期执行者仍可能继续写回。
- 允许过期 owner 续租：失主会在尚未接管时复活，破坏租约到期即失权的合同。
- 只按 owner 和租约写成功终态：最后一次取消检查之后到达的取消请求可能被成功状态覆盖。
- 显式关联作业失踪后按普通 stale 重试：无法证明原作业状态，可能重复生成正文或消耗模型额度。

## 调用计量边界

现有 usage tracking 会分别累计每个成功返回 token usage 的显式 invoke/stream。供应商未在失败响应中返回 usage 时，系统无法确认请求是否到达模型或是否计费；此时只能记录业务尝试和错误日志，不能承诺物理请求数或计费次数绝对精确。关闭 SDK 隐式重试的目的，是让可控重试都出现在产品显式流程中，而不是伪造无法观测的上游事实。

## 相关模块

- `server/src/services/novel/production/attempts/`
- `server/src/services/novel/production/executionLease/`
- `server/src/services/novel/production/NovelPipelineExecutor.ts`
- `server/src/services/novel/director/commands/leases/DirectorCommandLeaseService.ts`
- `server/src/services/novel/NovelPipelineRuntimeService.ts`
