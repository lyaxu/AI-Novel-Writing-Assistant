# 规划修复的人工恢复边界

- 修复候选、质量判定、章节窗口和原子提交由 volume/planningRepair 管理。本模块只负责导演暂停、明确授权和原入口恢复。
- 正文生产模块通过本目录 `index.ts` 使用恢复服务和类型化错误识别，不读取内部恢复种子或修改规划候选。
- `PLANNING_REPAIR_CONFIRMATION_REQUIRED` 与 `PLANNING_REPAIR_CONFLICT` 均保存为 `waiting_approval / step_review_required / pendingManualRecovery`。源页面是 `structured`，不是 pipeline 重规划。
- HTTP 状态查询不调用 workflow healing。恢复按钮只在节奏 / 拆章工作区出现；导演进度提供导航，运行记录不提供操作。
- 手动追加需要 repairKey、非空 guidance、幂等请求标识。先 CAS 预留请求，再读取最新工作区并 rebase，最后 CAS 追加一轮。保留 rounds、历史与不受影响的数据。失败不追加预算。
- rebase 必须在事务读取任务后比较 `expectedSeedPayloadJson`，防止旧请求重置另一请求的授权状态。源内容发生变化时由 store 建立安全的新快照，不能把旧候选直接提交到新源。
- 普通继续、批准关卡和跳过质量都不能越过 waiting/uncertain/technical_failed、pendingOperation 或尚未完成的预算授权。干净的 assessing/repairing/reviewing/ready 可在原预算内恢复并复用完成结果。授权请求使用固定幂等键；同一次执行的 HTTP 重放合并，不重复授予预算。
- 执行命令幂等与预算授权幂等分开：原恢复命令已结束但本任务仍真实暂停时，用户显式继续可以沿用原授权派发下一次命令。新命令键由原授权与前一条命令ID构成，重复点击合并；原命令、请求与预算保留。在途命令、活跃批次租约、待核实操作、待完成授权和取消中的任务不能被重新派发。GET、轮询和后台看门狗不使用此入口。
- seed.planningRepairRecovery 保存原 `structured_outline` 或 `chapter_execution` 锚点。前者恢复指定章规划；后者若存在章节生产日志，必须接回该日志所属的原 job，沿原准备步骤进入 JIT，不清引用另起 job、不调用 replanNovel、不跳过当前章。仅尚未建立章节生产操作的规划恢复可以走首次执行路径。
- `application/PlanningRepairPipelineRecoveryService` 只在明确授权的继续命令内执行：同一事务核对授权、候选和完整规划源、正文指纹、原范围、任务归属及租约，再 CAS 恢复原关联。误建但零调用、零产物的失败 job 保留为历史。它不追加预算、不生成内容，也不在 GET 中运行。
- `domain/settledPipelinePause` 仅证明合同准备步骤的确定规划暂停：优先使用结构化暂停回执；历史记录须完整关联已保存修复回答、最终未通过复核、原轮次及同一停点。归类前归档原日志，只有该步骤的 `unknown` 可转为 `failed`；其他未知调用、变更过的正文/规划源、未应用付费输出都拒绝恢复。不能通过放宽生产日志的未完成操作覆盖保护修复关联错误。
- 已开启自动执行且恢复键严格匹配时，章节规划恢复复用原范围。历史任务缺少 `productionExperience` 显示偏好不能把恢复退回首次开写选择；没有授权键或没有已开启执行范围的任务仍需经过首次生产确认。批准章节节点也必须传递明确的人工恢复标识。
- pipeline job 丢失异常 code 时，通过 durable planningRepair 的 waiting_confirmation / uncertain / technical_failed 状态补回导演暂停。技术失败保留原阶段及技术原因，不能归入普通质量修复后让源页面失去操作。生产执行器仍必须立即收束该异常，不得降级为成功或继续下一章。
- 执行器还持有异常发生前的只读身份快照。类型化规划冲突仅在小说、执行次数、启动时间、repairKey、授权幂等键及当前 job 绑定均未变化时暂停；候选、历史、轮次和 pendingOperation 原样保留，原始错误进入 technicalError。新授权、取消、待完成授权或并发 CAS 变化必须拒绝旧写回。
- 自动执行监督使用原始只读任务状态，不触发 healing；正常 queued/running 切换可继续，人工暂停、换执行/授权/job 时旧监督退出。获准运行的章节步骤必须先登记开始，初始化 startedAt 后再捕获身份；初始化本身不得清除人工暂停。
- 暂停状态由前后端共享判断：waiting_approval / failed，或历史 running / queued 且明确 pendingManualRecovery；取消中的任务不可恢复。历史兼容只读展示，不在GET中清挂起标记或修复数据库。是否允许生成建议还需核对可修复阶段、任务归属及后台执行冲突。
- 已挂起的批次不是活跃生成。建议入口只忽略seed中本导演当前pipelineJobId指向、pendingManualRecovery且无executionOwner/执行租约的job；其他任务、仍有执行归属或租约的job和活跃命令仍阻止建议，不能按所有pending记录一概放行。
- 离线测试 `server/tests/planningRepairRecovery.test.js` 在导入服务前封锁数据库模块，验证 HTTP、CAS、错误映射和两类恢复路径；`PLANNING_REPAIR_TEST_SOURCE=1` 可直接转译最新源码测试而不触发 server build。

## 保留候选的明确重核

`application/PlanningRepairReviewExistingService` 为源页提供保留候选的只读预检及提交入口。它只处理空稿准备阶段的已保存候选：复核结果未知、已收到但被合同校验拒绝的复核，或有 settled 回执及当前章 assessment 的确定质量暂停。来源和候选通过 `PlanningRepairStore.assertPipelineRecoverySnapshot` 验证，禁止 rebase；变化的来源不能使“重核候选”悄悄变成重新生成。前端确认绑定预检 token，轮询取得不同 token 后必须重新勾选。

提交事务保留原任务暂停，按生产日志既有归档格式保存原记录和用户确认，仅将执行合同准备的 unknown 改为 failed，并保存固定 `review_existing` 授权。原轮次、预算、范围和候选不变。存在其他未知步骤、正文、prepared 结果、活跃章节任务、命令或导演执行租约时拒绝。归档、日志、job 和任务 CAS 任一失败须整体回滚；HTTP 重放沿用请求键，enqueue 失败后可恢复同次授权。

`domain/reviewExistingAcknowledgement` 验证专用授权和不可变归档，作为独立于 `settledPipelinePause` 的用户确认凭据。未知调用从未被宣称为已完成。后续恢复仍核对原 job、来源、正文及租约，不得创建替代 job 或开启自动修复。候选复核未通过立即保持暂停；通过后才能沿用户明确确认的原执行范围继续。UI 必须同时说明复核费用和通过后的后续写作费用。

## 按原策略继续与只复核的区别

`GET/POST /planning-repair/resume-policy` 固定授权 `resume_existing_policy`。它复用候选确认事务和恢复凭据，但必须证明任务保存了全书自动模式、自动复核及自动修复授权，并且 `rounds < maxRounds`。普通继续、轮询、重启和质量暂停都不能自行获得这个授权。用户应看到剩余轮次、可能修复、通过后原范围写作与模型费用；未知结果还须明确说明重新调用的费用风险。

本入口不调用通用追加轮次的 grant，不增加 `maxRounds`，不 rebase，不生成替代初始候选。先重核保存候选，随后由 `PlanningRepairCoordinator` 与正常执行共用 `nextPlanningRepairAction`：需要创作决定就暂停，剩余预算内可修复并复核，耗尽则暂停，两层复核通过才提交。`review_existing` 则在未通过时立即暂停，不能被隐式改成自动修复。

授权同时将原执行策略、范围、费用预算及修复上限指纹写入归档；派发前重新比对，防止两份当前范围同时扩大绕过原确认。已结算质量暂停的原 job 可以是 pendingManualRecovery=false，授权事务只将它标回人工恢复等待，导演保持暂停，真正执行仍由原命令和原 job 接回。未知调用仍要求原 job 的暂停标记为 true，且仅允许执行合同准备复核这一未知步骤。

派发失败后，状态返回同次候选 token 和请求键，客户端继续走对应专用端点；不得退入会追加轮次的普通 retry。候选、源、预算、归档或策略漂移时旧授权不能重放。这个边界恢复已有策略，不替用户选择新的创作方向，也不以一次重核保证候选必然通过。

## 初始响应拒收与单次纠正

初始执行合同的 `rejected_response` 是已返回但未通过校验的模型响应，不是候选。无 `candidateVersionId` 时不得伪造候选、复用候选重核证明，也不能先收取修复建议费用再在候选前置检查处失败。源页独立的 `GET/POST /planning-repair/initial-contract` 固定 `retry_initial_contract`；通用建议和追加轮次入口拒绝这一边界。

`PlanningRepairInitialContractService` 只读预检绑定完整拒收响应/历史、原来源快照和已选方向、原 job 和 settled 准备回执、原范围和策略。必须无正文、无 prepared/partial、无 pendingOperation、无未知步骤、无活跃执行权或其他请求。`PlanningRepairStore.assertInitialContractRecoverySnapshot` 独立验证无候选的来源，不削弱候选恢复保护。授权和归档在事务内 CAS，原任务保持暂停；提交命令后仍接回原 job。普通继续不能替代专用恢复键。

每次明确确认只增加一次初始响应纠正授权；`initialContractCorrection` 持久记录累计次数、允许上限、拒收响应指纹及历史位置，Coordinator 在模型调用前消费。一次纠正失败保存新响应并暂停，下一次必须获得新 token 和新的明确确认；HTTP 重放、enqueue 失败和进程重启不增加额度。未知响应不能走此入口。纠正成功后才建立真实候选，进入正常语义/窗口复核和原策略修复，全部通过才能提交和按原章节范围继续。

新 session 的 `initialGenerationAttempts` 记录正常初始生成的外层调用，最多两次并跨重启保留；历史缺字段不推断为零。它与初始单次授权纠正、候选语义修复 `rounds/maxRounds` 分开。更早的格式纠正等底层调用以 LLM 用量记录为准，不能用候选 `0/2` 表示此前无消费。UI 明确一次纠正、后续复核/必要修复和写作的费用与范围，并将勾选绑定当前 token。状态轮询不会自动确认或发送模型请求。

服务单进程并发、事务 CAS 和执行租约防重复，并不提供跨进程崩溃后未知外部结果的 exactly-once 保证；该情况保留暂停，禁止自动再送。聚焦离线证据见 `planningInitialContractRecovery.test.js`、`planningRepairCoordinator.test.js` 及源页 `planningRepairAdvice.test.mjs`，不替代真实模型或页面验收。

初始纠正确认还绑定任务顶层模型、温度、指导方向、写法、问题策略、完成目标及启动输入，与 Store 的稳定生成输入权限保持一致；运行进度和 pipelineStatus 不属于这类输入。确认后改变这些输入必须重新预检和明确确认，不能沿用旧 token。已存在但格式损坏的初始调用计数拒绝授权；仅历史缺字段显示未知，不伪造成零。
