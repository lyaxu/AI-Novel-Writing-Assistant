# 最新交接入口

2026-10-18（北京时间），现场核验11:27:46。**用户因Codex开发额度反复耗尽，要求完整文档交接给DeepSeek Harness；本轮停止扩展产品代码，只整理和核验。**

先读[完整移交包](2026-10-18_1130_deepseek-harness-handoff.md)，按需进入[全程历史](deepseek-harness-2026-10-18/HISTORY.md)、[待办与验收](deepseek-harness-2026-10-18/BACKLOG.md)、[证据/成本/维护指南](deepseek-harness-2026-10-18/EVIDENCE.md)、[Q台账与逐提交索引](deepseek-harness-2026-10-18/HISTORICAL_INDEX.md)。完整读磁盘AGENTS及PROJECT_CONTEXT，不假定Harness能自动读Codex记忆。

仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor，远端lyaxu。核验HEAD9fb7c0b71a6a923e8ff359b9fc6bc8e8135793d1与远端一致；本次文档另行提交推送，最终HEAD以Git为准。产品91f7fcab已加载，Node24.19.0/source，3000/PID21984及5190代理health正常/stale=false。固定D:/novel/.comparison/2026-10-10/old-test.db。本轮无重载/迁移/恢复/模型调用。

两书仍暂停：旧《外卖小哥的茅山账本》task cmv8d55el0033z8w0hneoiiru，五章原稿不变、第6空，32调用/1396340 tokens；用户决定冻结回归，旧6—10续写待办失效。新《零下八十度，我买下地铁站建城》novel cmvcmyfvt000c14w05b61rm5w/task cmvcmumqq000014w0ycmxc44s，无候选/两章空稿、24调用/258227 tokens；原范围1—3，纠正入口可用，用户尚未继续。两者waiting_approval/pending1、planning waiting_confirmation/0轮，业务保护hash保持。

最近通用生成/完整响应纠正/复核/初始无候选恢复代码完成，632个唯一工程用例及独立三题材模型验证；不等于真实用户恢复、UI、文学或固定版本十章已通过。人物覆盖/候选改名已有代码/迁移，独立验收待做；资源易用性、dashboard、历史验证债和讨论项见待办。

下一位先只读核对并复述，再按用户目标进行一项有界通用工作。用户可从新书“节奏 / 拆章→章节规划修复→勾选确认→纠正初始规划并继续”接续1—3；不得代点旧书或扩大十章。start-local.bat固定正确库但默认打开旧书，新书精确链接见完整包。用户已删极寒旧稿，不再索要7—8章旧稿。

三个Structured组件、台账历史964行和全部本地资料保留；完整台账/dirty补丁/提交历史有本机副本.codex-run/harness-handoff-20261018，非DB备份。沿同checkout单写入者交接，不stash/清理/切分支/改新版，不自动调用模型。Codex额度重置2—3次为用户自述，不能用书内token账替代。

## 2026-11-01 工程补充：同卷扩章承接

- 新增能力：规划修复轮次耗尽、剩余只有可延期职责/容量债、窗口内无后续未写章时，系统在同卷章节预算内自动追加一章承接（确定性章纲/任务单/场景/容量计划，债务逐条落地；来源章保留 deferable 并把入口指向新章），复核当前章通过后提交，并同步任务执行范围。
- 边界：一次触发最多扩一章，同一任务累计最多 2 章；同卷预算或全书目标章数用完则记债暂停，不无限扩、不删债、不假通过；已写/锁定/跨卷章节不动；未知外部调用/正文指纹/租约冲突仍暂停。
- 入口与验证：服务重载后由用户在来源页面触发继续/重试；真实案例《杂役管事在黑市商城》task cmvxpw1px0002osw0kuoi43p2 第3章容量债应在提交时补出第4章承接。工程侧看 `server/src/services/novel/volume/planningRepair/capacityCarryOver.ts`、`PlanningRepairStore.appendCapacityCarryOverChapter`、`PlanningRepairCoordinator.tryCapacityAutoExtension`；测试 `server/tests/capacityCarryOver.test.js` 与 `planningRepairCoordinator.test.js`。
- 文档：`docs/wiki/workflows/chapter-capacity-gate.md` 与 `server/src/services/novel/volume/planningRepair/README.md` 已写清规则与失败模式。

## 2026-11-21 工程补充：规划质量债入口覆盖与正文 writer 传输重试

- 规划质量债接受（B 策略）已覆盖复核/JIT/恢复的所有等待确认入口；扩章适用性改为“容量债确实没有后继承接章且上限/预算未到”才先扩章，后章已存在只是超容量时允许带债继续。硬边界（正文/租约/未知外部调用/所有权/跨卷/requiresUserDecision）仍拒绝，不伪造复核通过。
- 正文 writer 增加有界 transport 重试（C 口径）：本次调用零输出且为明确网络中断时自动重试一次；有 partialText 时只有来源页显式 acknowledge 未知调用后的继续才允许从零重试一次，旧 partial 归档保留、永不写入正文；无确认或非 transport 不重发。
- 真实书《杂役管事在黑市商城》第4章已写出 4238 字并 completed，第1–3章未改写；任务随后因 “Commit requires a saved, successful joint-window review.” 暂停在联合窗口复核提交边界，第5章 pending_generation。下一步是修复该联合窗口复核提交/恢复路径，而不是回退正文。
- 关键提交：`ab366127`（B 入口覆盖）、`5d54e886`（writer 传输重试）；服务已加载 `5d54e886`，`stale=false`。

## 2026-11-21 续跑：第1-8章完成，第9章卡在任务所有权

- 《杂役管事在黑市商城》第 1-8 章正文全部 completed：3104 / 4383 / 4934 / 4238 / 3471 / 4235 / 4200 / 2945 字；第 9、10 章尚未写成。
- 第 7、8 章通过单章接管任务跑通并 succeed；第 9 章先后遇到规划复核证据格式错误和范围任务/章节 journal 所有权冲突。
- 已加通用修复：`1e8cf982` 丢弃无源参考引文、`a33c2952` 未解决复核项的无源附带证据不再整份退回。
- 当前阻塞：第 9 章 chapter journal 指向旧任务 `cmwpdzuxx...`，新范围任务 `cmwptwtf...` 继续时报“章节正文、执行约定或执行所有权已变化”；chapter recovery 无 acknowledge，task retry/resume 被源页所有权检查拒绝。需要补一个“被取代范围任务的章节 journal 所有权移交/归档”通用恢复，再继续第 9、10 章。
- 本轮未改已有正文，未删除数据；第 1-8 章和候选/质量债均保留。

## 2026-11-21 工程补充：已提交规划窗口的复核证据恢复

- 根因：真实书第 4 章已写出 4238 字并 completed，但其规划修复窗口是按 B 策略的质量债接受的（`phase=committed`、失败发现留在 history、没有通过复核）。第 5 章 JIT 合同准备复用已提交窗口时，`PlanningRepairStore.begin` 再次要求“已保存且通过的联合窗口/逐章复核”，于是报 `Commit requires a saved, successful joint-window review.` 并永久暂停；错误文案来自被复用的守卫，不是正文/传输/容量问题。
- 修复（通用，无书级分支）：`committedWindowReviewRecovery.ts` + `PlanningRepairStore.begin/commit`。先尝试从只追加 history 补关联同轮完整通过的复核（`commit` 也支持）；无法补关联时，仅当已提交窗口来源/提交哈希匹配、修复章正文已保存且 completed/approved、候选合同可执行，才记录 `source=committed_window_review_unavailable` 的章节级规划质量债（历史失败发现原样保留、写 seed 债务与 `autoExecution.qualityDebtSummaries`、幂等），随后复用已提交规划继续下一章，不重写正文、不伪造复核通过。未确认外部调用、正文未保存、来源/哈希变化、无效合同、租约/所有权/CAS 冲突仍拒绝。
- 验证：`server/tests/planningRepairStore.test.js` 新增 7 项（140 通过），相关 planning 批次 75 通过；`tsc -p server/tsconfig.json` 通过。真实书用 SQLite 在线备份的数据库副本回放第 5 章 JIT `store.begin`：修复前同一状态报错，修复后 phase=committed、第 5 章合同可进入执行、质量债落库、第 1–4 章正文与任务行未变；副本已清理，结果存 `.codex-run/planning-recovery/real-book-replay-result.json`。全程 0 模型调用、未重载服务、未改原库。
- 下一步：待 Lead/用户受控重载新代码后，从《杂役管事在黑市商城》来源页点一次“继续自动导演”；任务应从第 5 章 JIT 继续，第 4 章保持 completed、第 1–4 章不改写。本次未重载、未代点。
- 提交见 Git；文档同时更新 release notes 2026-11-21、README 最新更新、`docs/wiki/workflows/chapter-review-resume.md` 与本模块 README。

## 2026-11-21 工程补充：被取消任务的章节日志所有权移交（第 9 章恢复链）

- 真实案例：《杂役管事在黑市商城》第 1-8 章 completed，第 9 章 `cmvz3djx100kt50w0d3e3aitm` 仍 pending_generation 0 字。旧范围任务 `cmwpdxe3c06pukow0x3461sx7` 已 cancelled，其范围 job `cmwpdzuxx08jqkow0x6wwx04n` failed（规划响应格式/合同校验失败）；但该 job 的 chapter journal `pipeline:cmwpdzuxx...:cmvz3djx...` 仍是 active/paused，占用第 9 章 preparation 执行所有权（steps 全是 prepare/prepare.contract/prepare.execution_contract failed，partialText=0，expectedChapter.content=""）。新单章任务 `cmwptwtf4000778w0mawexy2u`（takeover 产生，range 9-9）job `cmwptyfnn01u378w0gpcyp7p5` 启动时立即 failed（llmCallCount=0），错误“章节正文、执行约定或执行所有权已变化，已停止写入，请回到章节工作区核对。”；chapter recovery 返回 `canAcknowledge=false / canResume=false / 本章属于范围任务`，continue/retry/recovery-candidate 全被同一 ownership preflight 拒绝。
- 根因：恢复链已有 failed+丢锚点、queued stale 空壳、规划修复候选等补口，但没有“被取代/已取消旧任务的 active chapter journal 所有权移交”。新 job 用新 operationId 打开同一章时被旧 active 槽位冲突；旧任务已 cancelled，正常恢复路径不会再回旧任务执行。
- 修复（通用，无书级分支）：新增 `planSupersededJournalOwnershipHandoff`（`DirectorRecoveryConvergence.ts`）和 `ChapterJournalOwnershipHandoffService`。严格条件：新任务处于人工恢复暂停、无 active command、小说内无其它 queued/running job；新 job failed+pending、属于本任务、currentItemKey=目标章、无 owner/lease、llmCallCount/completedCount=0 且错误正是章节所有权冲突；目标章正文空、journal 的 expectedChapter.content/partialText 空、无 unknown/running 步骤、无未完成 stream/manual repair；journal paused、entry=pipeline、request.workflowTaskId=旧任务、operationId owner job=旧 job；旧任务 cancelled、旧 job failed/cancelled、均无 active command/lease、旧任务无 active job。满足时在同一事务里把旧 journal 原样归档到 `<oldOperationId>:superseded`（复用 `retirePreparationJournalIfSafe` 的严格准备阶段归档），删除 active 槽位；把新任务零调用 shell job 标记 cancelled 并保留原失败错误；清空 `autoExecution.pipelineJobId/pipelineStatus`、保持 start/end/nextChapter 指向第 9 章，写 `chapterJournalOwnershipHandoff` 回执。随后普通 continue 创建全新执行，旧的章节日志证据和旧任务/job 行全部保留。
- 入口：`DirectorRecoveryConvergenceService` 新增 step 3b，排在已完成陈旧 job（step 3）之后、displaced 指针（step 4）之前，避免新任务被误指回旧 cancelled 任务的 job；命令受理（continue/retry/resume_from_checkpoint/approve_gate 等 `RECOVERY_CONVERGENCE_COMMAND_TYPES`）和 continue 运行时都会在严格 preflight 前触发。当前书真实数据 dry-run（只读）：handoff plan=`handoff`（oldTask `cmwpdxe3c...`、oldJob `cmwpdzuxx...`、newJob `cmwptyfnn...`、chapter9），`planPreparationJournalRetirement={retire:true}`。
- 重载后验证：在第 9 章来源页（或自动导演任务来源页）点一次继续/重试；预期日志“已归档被取消旧任务遗留的章节执行记录，新任务接管未写章节”，任务创建新 job，第 9 章进入正常准备/写作；第 1-8 章正文与 completed 状态不参与任何写入；第 10 章仍 unplanned。若仍停在 ownership 错误，看 `chapterJournalOwnershipHandoff` 未写原因（journal ownership/旧任务仍活跃/目标章有正文/partial/unknown），而不是继续手点。
- 测试：新增 `server/tests/chapterJournalOwnershipHandoff.test.js`（11 项：handoff 正例、正文/partial/manuscript 漂移拒绝、lease/unknown/command/job 拒绝、旧任务仍活跃拒绝、新 job 非所有权错误/有工作/owned journal 拒绝、ownership 错误解析、service inspect→plan→apply、preparation journal 归档）；恢复链回归 252 项通过。`tsc -p server/tsconfig.json` 通过。未调用真实模型、未重载、未改已有正文、未动 WORK_LEDGER。
