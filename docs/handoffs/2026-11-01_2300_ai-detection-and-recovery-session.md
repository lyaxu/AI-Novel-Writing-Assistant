# 2026-11-01 夜间交接：正文自然度、容量门禁与恢复链

## 当前基线

- 仓库：`D:/novel/AI-Novel-Writing-Assistant`
- 分支：`codex/production-core-refactor`（远端 `lyaxu`）
- 本次交接时 HEAD：`34cafdd9`（本文件随交接单独提交，最终 HEAD 以提交记录为准）
- 本地服务：`scripts/local-test/start.ps1 -NoBrowser`，固定库 `D:/novel/.comparison/2026-10-10/old-test.db`
- Node24：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`
- 本窗口未改 `docs/handoffs/WORK_LEDGER.md`、三个未提交 `Structured*` 组件和用户未跟踪资料；本文件是本次窗口的工作记录，避免覆盖受保护的旧台账。

## 用户目标

1. 不再出现明显 100% AI 的正文；不以朱雀分数为唯一目标，人工痕迹不等于好看。
2. 规划、容量、恢复链要自动继续，不要求用户手点修复方向。
3. 通用机制优先，不逐本书打补丁；已有正文不自动改写。
4. 已提交的修复要能解释根因、验证方式和剩余风险。

## 本窗口完成

### 正文自然度（重要）

根因不是朱雀、不是模型、也不是市井见微文风本身，而是正文写作提示在重构后增加了三层检查表：

- `本轮输出必须逐条体现上述规则`
- `【正文完成前自查】`
- `执行顺序：先按语言与节奏合同…`

同时正文提示还注入了完整通用创作规则和写法合同字段清单、反 AI 规则清单。旧同文风提示没有这些内容。实测同一文风从明显 100% AI 降到朱雀 `AI特征 43.72% / 疑似AI 56.28% / 人工特征 0%`，说明方向成立，但还没有恢复到旧书的人工程度。

已做：
- `c82f4442` 正文提示去掉清单式自查、逐条规则加码、写法合同速览重复注入；
- `34cafdd9` 正文不再注入整块通用创作规则和反 AI 规则清单，只保留三条写作底线；详细规则留给规划/复核/验收；
- `3a001066` 容量预算为 2400 字以上章节保留至少两项必须兑现，避免正常开篇被误卡。

当前正文提示的关键约束：
- `server/src/services/settings/storyCraftContractContext.ts` 的 `appendWriterStoryCraftBrief`（正文只拿简短底线）；
- `server/src/services/styleEngine/styleContractText.ts` 的 `buildWriterStyleContractText`（正文只拿写法方向，不拿反 AI 清单/自查/执行顺序）；
- 规划/复核仍使用完整规则。

### 容量门禁

- `a15594f4` 新增章节容量计划：一个主事件、一个明确转折、`mustDeliver/deferable/seedOnly` 三分类；写前确定性门禁。
- `c7260bcd` 可延期职责无承接时，优先自动补写后续未写章节；窗口放不下则记规划容量质量债继续，不整本暂停。
- `5bc69150` 复合职责与后章承接按结构化文本相似度识别；修复建议证据上限放宽到 12 条。
- `3a001066` 容量预算为正常长章保留至少两项兑现，避免“只埋线索多导致只能兑现 1 项”。

### 规划/复核格式兼容

- 证据编号截断按当前正文证据目录唯一纠正（`b5571cee`）；
- 已声明前置条件自动补入场景入口（`66185b3f`）；
- 复核可引用修复窗口上下文证据；数值型容量字段可作证据（`c12b19a9`、`bb13a0f6`）；
- 复核问题决策的陌生关系词自动归一（`2e727c4f`）；
- 章节根字段与 `sceneCards` 内部同名字段路径可互相识别（`1537f2fe`）；
- 计划内状态统一按“计划内建立”处理，不再要求更早正文（`556d8a4e`/`3dbc97bd`/`f884d8c3`）。

### 恢复链

- `2efa6342` 规划修复结束后旧执行任务丢失章节锚点时，自动采纳已保存候选并重建第一章执行；旧任务标记结束保留失败记录，旧准备 journal 归档。
- 该链路已在《身份租约倒计时》上真实验证：旧 job `cmvw3lcf9...` cancelled，新 job 接管第一章。

## 同卷自动扩章承接（本窗口新增，未完全解决当前书）

- `90eb8909` 新增容量债无承接时的同卷自动扩章：在卷预算内追加下一章，债务逐条写入 `mustDeliver/requiredElements/scene mustAdvance`，扩展任务范围并重跑当前章复核；自动扩章上限 2，失败保留债务暂停。
- `71e7840f`/`da4071f9` 补了扩章承接章节的复核证据定位：同源章节摘要/入口/容量计划可互相定位，不因容器名或索引不同而误报。
- 真实书《杂役管事在黑市商城》第 3 章在第 7/8 轮复核后仍停：扩章已触发 2 次（pending 第 4/5 章），但剩余缺陷不只是容量债，还包括 scene4 亏损交易的资源/松口机制、儿子资质线索未落到场景动作等真实合同缺口，因此自动扩章没有合法放行，任务范围仍为 1–3、第 3 章仍为空。当前状态是“已达自动扩章上限，保留债务暂停”，不是格式 bug。

## B 策略：规划质量债继续（2026-11-02 接续）

- 用户已明确接受：规划修复轮次和自动扩章上限都耗尽后，允许按可见的规划质量债接受最后候选并继续写当前章，不再永远停在 planning 确认。
- 实现：`PlanningRepairCoordinator.tryAcceptPlanningQualityDebt` + `PlanningRepairStore.acceptPlanningQualityDebt`；分类器 `planningQualityDebt.ts` 只把容量/延期、`selected_direction_drift`、非致命场景/叙述合同缺陷、复核响应格式错误视为可继续；未知外部调用、正文指纹变化、活跃租约、已写/锁定冲突、跨卷硬边界和 `requiresUserDecision` 仍拒绝。
- 债务不伪造通过：`planningQualityDebt` 记录复核 findings/reasons/候选版本/`capacityDebt`，写入任务 seed、规划修复 state/history、未写章节 `repairHistory`、运行日志和 `autoExecution.qualityDebtSummaries`；`capacityDebt` 保留给后续章节承接。
- 顺序：有自动扩章空间/剩余轮次时先走扩章或修复；扩章上限/预算耗尽后，恢复/继续入口才直接按债提交，第 3 章进入 writer，不再买复核/修复轮。
- 当前书下一步：重载后从来源页恢复/继续；预期第 3 章按 B 策略接受候选（保留两条容量债与复核非致命 findings），任务范围保持 1–3，writer 开始写第 3 章；不修改第 1/2 章正文。

## 当前测试书

### 《杂役管事在黑市商城》`cmvxpy883000eosw0hadfpe7c`

- task `cmvxpw1px0002osw0kuoi43p2`，市井见微·细腻推进。
- 第 1 章《盐袋夹层》完成 3104 字；朱雀：`AI特征 43.72% / 疑似AI 56.28% / 人工特征 0%`（比明显 100% AI 好，仍偏机器，但用户认为可用于阶段性验证）。
- 第 2 章《铜钱补账》完成 4383 字。
- 第 3 章《烧酒换批条》最终按 B 策略接受规划质量债并完成：4934 字；任务 `succeeded`，第 1–3 章正文全部 completed。任务范围保持 1–3，未改写第 1/2 章。
- B 接受记录：`planningRepair.planningQualityDebt`，`acceptedByPolicy=true`，保留 `zhao_son_qualification_bridge_missing`、`zhao_batch_authority_unestablished` 两条复核发现的可见债务；`capacityDebt` 仍保留“批条去城外药铺提货交付”等职责，留给后续章节承接。
- 自动扩章 count=2/max=2，pending 第 5 章未提交；后续继续写第 4 章起时按正常规划/复核路径处理，不自动把第 5 章并入本轮。

### 其他书

- 《杂役的权限藏经阁》`cmvx9scp9004yqkw08toqse71`：第 1 章完成 3442 字，第 2 章未完成；该章是旧提示产物，不适合作为最新提示对比样本。
- 《身份租约倒计时》`cmvwg59hs008zecw0f8pjuikz`：第 1、2 章完成，用于恢复链验证。
- 《天台武馆》《魔尊的异界农场》《破妄眼》等为历史测试样本，按用户决定不回滚、不改已有正文。

## 当前服务与验证

- 最新提交后服务已重载，health `stale=false`。
- 本窗口重点回归：
  - `chapterCapacityGate.test.js` 21 项通过；
  - `styleContractExecution.test.js` 7 项通过；
  - `chapterPlanningEvidence.test.js` 18 项通过；
  - `planningPromiseContinuity.test.js` 存在仓库既有的测试 harness 缺 mock（`chapterCapacityGate` 未 mock），本轮未修，非产品回归。
- 已知既有失败（与本窗口改动无直接关系）：`novelDirectorRetry` 旧 fixture、`fullContinueRecovery` 与自动重审特性的旧期望、`productionChoiceFailedRecovery` 缺 stub、`directorDirectoryBoundary` 根 facade。

## 下一步建议

1. 等《杂役管事在黑市商城》第 3 章落库，观察 1-3 章是否完成；若出现新停点，按错误类别处理，不回溯修改已完成正文。
2. 继续观察朱雀：只要求“不明显 100% AI”，不追求人工特征数字；若再次明显 100%，先对比正文写作提示是否又出现了规则清单/自查块。
3. 后续真正要补的产品能力：
   - 章节容量质量债的后续章节可见性和自动承接；
   - `selected_direction_drift` 在修复轮次耗尽后的可控债务化策略（目前仍可能需要一次明确恢复）；
   - 旧测试 harness 漂移清理（不阻塞真实链路）。
4. 不重载、不切分支、不清理未提交资料；再次改写作提示时先用同文风旧提示做差异对比，再提交。

## 恢复链补口：queued 无租约陈旧范围任务（2026-11-04 接续）

- 真实案例：《杂役管事在黑市商城》`cmvxpy883000eosw0hadfpe7c`，range task `cmvz3d625003b50w0heed4zqm`（第 4-6 章）。第 4 章 planning repair 因 12000 输出上限失败后，job `cmvz3ecac00te50w0cts7crrx` 停在 `queued`、`currentItemKey=null`、无 owner/lease/heartbeat，却仍被恢复链当成活跃任务；随后 lead 手动放弃修复（`abandoned`，候选版本 `cmvz3f4x800tj50w0fqdt29f5`，v26 draft），继续仍报「原章节任务的范围或执行权已变化 / 缺少可核对的恢复位置」。
- 根因：上一轮补口只处理 `failed + 丢锚点`；queued/running 无租约/心跳的空壳仍算活跃作业，adoption/rebuild 被 `active_job`/`job_not_retried` 挡住；旧准备 journal 的 `prepare.execution_contract` 因输出上限记成 `unknown`，journal 归档与重建也拒绝。
- 已修（见本轮 commit）：新增 `StaleRangeJobActivity` 严格判定（queued/running + 无当前章 + 无 owner/lease + 心跳缺失或过旧 + 更新/开始超过空闲窗口 + 父任务/小说匹配 + 结构化无输出错误 + `completedCount=0`）；`DirectorRecoveryConvergence`、`PlanRepairExecutionRebuildService`、`PlanningRepairCandidateAdoptionService` 都接受这种陈旧空壳；journal 归档新增“确定无输出 unknown”窄例外（job/journal 根/每个步骤同一结构化代码时才允许，running 或普通未知仍拒绝）；候选合同形状必须通过，容量门禁失败只有在修复会话已持久化有界 `capacityDebt` 时才带债采纳，并把 `capacityDebt` 写进 `planningRepairCandidateAdoption` 回执。
- 当前书 dry-run（只读）：`isStaleRangeJobWithoutAnchor=true`、journal definitive code=`STRUCTURED_OUTPUT:output_limit`、journalRetirement `{retire:true}`、候选 shape `canEnterExecution=true`、`capacityPassed=false` 但有 2 条 `capacityDebt`、adoption plan=`adopt`、rebuild plan=`rebuild_execution`（旧 job `cmvz3ecac…`、目标章 4）。
- 重载后建议：对 task `cmvz3d625003b50w0heed4zqm` 触发一次「继续自动导演」（`POST /api/novel-workflows/<task>/continue` body `{"continuationMode":"resume"}`）或 recovery-candidate resume；预期日志「采纳保存的候选规划」→「旧任务不可恢复，已按现有章纲重建章节执行绑定」→ 任务 queued/running，新 job 从第 4 章开写；第 1-3 章正文不动。若仍停，应是最新章合同/复核的真实失败，不再报缺锚点；候选与 journal 证据保留。
- 本轮测试：`staleRangeJobActivity`、`planRepairExecutionRebuild`（queued stale/active lease/正文/journal 未知）、`planningRepairCandidateAdoption`（含容量债与 definitive unknown）、`directorRecoveryConvergenceService` 等定向通过；server `tsc --noEmit` 0 错误。未调用模型、不重载服务、未动 WORK_LEDGER。

## 2026-11-04 续：第4章 JIT 合同复核

- `b23664b9`：规划修复调用预算 12000→32K，解决 `planning_repair@v16` output_limit。
- `902a2457`：queued + 无租约 + 无当前章锚点的陈旧范围 job 可恢复；第4章候选与容量债已采纳，旧 job 结束保留错误；第 1-3 章未改写。
- `aa0159dd`：非冲突问题的无效 premiseEvidence 不再整份退回。
- 当前第4章仍未开写：任务在规划修复确认处，rounds=3/3，候选有 4 条容量债但复核仍失败；B 质量债路径在这次 JIT/review-existing 入口未触发，任务摘要“原候选复核仍未通过，请选择具体修复方向或确认规划来源”。下一步需要让 B/扩章覆盖 JIT 合同复核入口，或接受当前候选的可见质量债后直接写第4章。
- 本轮未改 WORK_LEDGER；新增记录均在本文件与代码提交。

## 关键命令

```powershell
# 健康
Invoke-RestMethod http://127.0.0.1:3000/api/health

# 本地服务
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-test/start.ps1 -NoBrowser

# 构建/定向验证
pnpm --filter @ai-novel/shared build
node node_modules/typescript/bin/tsc -p server/tsconfig.json
node --test server/tests/chapterCapacityGate.test.js server/tests/styleContractExecution.test.js
```
