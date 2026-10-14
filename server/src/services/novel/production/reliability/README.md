# 单章持久执行边界

## 职责与真源

未完成审查的完整返回属于私有失败证据：rejectedReviews保存CHAPTER_REVIEW_INCOMPLETE的原答、诊断和deferred意见，不能充当步骤output或成功缓存。语义纠正调用本身失败时，保留此前完整回答，但原外部错误仍决定failed/unknown；已有首答不能证明第二次调用的结果已知。显式恢复与后续成功保留历史失败证据和预算，持久化失败保持结果未知保护。

本模块是 `ChapterRuntimeCoordinator` 的执行适配层，不是另一套导演、任务队列或 GUI。`GenerationJob` 继续拥有范围、取消、人工暂停与父级执行租约；`Chapter` 继续拥有用户正文。现有 `ChapterArtifactSyncCheckpoint` 记录本章步骤输出及章节互斥所有权。

- `types.ts`：正文/合同指纹、存储协议、已结构化错误分类。
- `session.ts`：章节租约、步骤回放、未知结果隔离、部分稿、显式新操作及只读投影。
- `repository.ts`：Prisma 事务适配；正文/合同比较、正文或终态写入、检查点版本推进在同一事务中完成。
- `executionContext.ts`：把执行会话传到已有保存路径；流片段先持久化后发送。
- `ChapterProductionExecution.ts`：普通调用及跨 `stream` / `onDone` 的会话生命周期。
- 外部模块只从 `index.ts` 导入。

活动行固定为 `contentHash=active / artifactType=production_execution / syncMode=journal`。不能按正文 hash 建锁，否则改稿或不同入口会得到两把锁。旧执行归档以 operationId 区分，不删除原记录。其他资产检查点继续由各自服务维护。

## 实际执行与写入图

```text
导演/批量执行 → GenerationJob lease + onCheckCancelled
手动生成/修文 ──────────────────────────────┐
                                          ↓
                     ChapterRuntimeCoordinator → chapter journal lease
                                          ↓
                 preparation（沿用写前门禁）→ prepared 上下文快照
                                          ↓
       writer stream → partialText（不是 Chapter.content）
              → 完整 writer 结果检查点 → ChapterLifecycleService CAS 保存
                                          ↓
             原稿审查 → 一次预算领取 → 修订候选 → 复核 → 原有择稿
                                          ↓
            已选稿 CAS 保存 → 接收结果/时间线/事实提交 → 资产同步 → 终态
```

writer 在 journal 会话中返回完整输出，由调用者先记录结果，再单独保存正文。保存失败只恢复保存；没有会话的历史内部调用保留原 writer 保存语义，生产入口均由 Coordinator 建立会话。

## 恢复合同

- 写前规划的确定暂停必须由规划所有者提供结构化回执：repairKey、轮次、候选版本及settled/unknown。只有已落盘且无待确认调用或待应用响应的settled结论是明确失败；仅有错误code不能证明结果已知。回执随失败步骤保存，真正未知调用继续阻止重发。
- 规划追加授权不创建新的章级执行身份。源页复用已有授权时，先事务核对原导演、范围、规划来源、候选、原job与journal归属、章稿/合同指纹、取消及租约，再恢复原job。错误创建但未执行的后续job只保留为历史，不替换暂停journal；新operation仍只能接替completed记录。
- 旧版本把规划门禁记成unknown时，只能在显式授权恢复事务中，以完整已付费修复/复核历史、匹配候选及来源、原job和多层journal诊断一致性证明这次规划已结算，并先归档旧记录再标记其准备步骤可重入。不能按中文错误关键词判断，不能清理其他unknown、已完成产物、原稿或调用次数。来源改变、证据不足或真正未知回执继续暂停。

- 模型完整返回后，内容语义校验耗尽属于明确失败，不是网络结果未知。`PROMPT_POST_VALIDATION_FAILED` 保留 prompt/version、完整拒绝回答、修复次数和原因；失败步骤不能当作合法规划或审查输出复用。整章自动重试不得因此重新领取一轮语义纠正额度；只有源页明确继续才进入新尝试，旧证据保留。
- `prepare.contract` 仅编排子步骤，不单独代表模型调用；实际外部边界在 `prepare.execution_contract` 和 `prepare.chapter_plan`。子步骤真实未知仍阻止原任务恢复。日志保存失败仍属于存储安全门，不能仅凭模型返回便把未保存结果认定可重发。
- 完成步骤持久保存输出；普通重入只执行未完成步骤。审查、候选、修订预算、选稿保存、提交及最终同步使用确定步骤键。`pipeline.options` 冻结本次修订策略，重启传入的剩余额度为 0 不能丢弃已有候选。
- 精确的结构格式错误、空正文、不可应用补丁及审查证据不足 `CHAPTER_REVIEW_INCOMPLETE` 是有确定结果的失败；网络中断、进程在外部调用中退出、外部输出尚未持久化是未知结果。未知结果和额度耗尽不能自动补发。审查证据不足保留稿件并等待显式恢复审查，不能算作审查通过或自动改正文。
- 上述审查暂停针对尚无有效评估的原稿。若原稿评估已完成，仅修订候选在有界纠正后返回CHAPTER_REVIEW_INCOMPLETE，管线保留原稿及其有效评估和质量债，将候选审查结果记录为明确拒绝；不生成虚构候选评分、不覆盖原稿、不把候选patched回执算作原稿已修。最终是否继续由既有质量策略决定，质量优先人工暂停和原稿明确重规划仍保留。
- pipeline.review:1持久化候选复审失败结果及原始无效回答，pipeline.repair保留候选和尝试回执；后续提交/同步失败重入时复用这些结果，不重复领取预算或复审。候选内部evaluation失败证据保留；整个操作完成时只清顶层未完成错误，不清历史step.error。取消、所有权/存储冲突、未知调用和额度终止均不适用候选降级。
- 持久化步骤输出失败后保留 running/unknown 边界，不以回调成功推断落盘成功。租约 token、正文和本章合同均须匹配才能写入。
- 同章重复请求不会双跑；活跃请求返回忙提示，完成请求复用产物。原稿/候选仍按已有质量策略选择，不为了恢复改写判断。
- 人工编辑可以照常保存；它使旧执行失效，不能把旧候选覆盖回当前稿。失败后变更参数或稿件须显式新操作，先归档旧执行，不能把普通重试变成重写许可。
- 流中途关闭时不调用完整保存。无人接收流或迟迟不完成 onDone 时释放租约；流部分稿仍在检查点。
- `NovelPipelineExecutor` 收到四类 `CHAPTER_PRODUCTION_*` 或 `CHAPTER_REVIEW_INCOMPLETE` 错误后保留章节位置并进入 pendingManualRecovery，不调用 AI 治理再发起尝试。
- 范围执行的操作标识固定为 `pipeline:${jobId}:${chapterId}`，同一任务重入复用已完成步骤。新任务只能归档并替换 completed 记录，不能越过旧任务的暂停或未知结果。旧版本随机标识的暂停记录不自动迁移：没有可靠 job 归属时不能仅凭章节、请求相同或父工作流相同推断同一次执行。

## 源工作区接口

`GET /api/novels/:id/chapters/:chapterId/runtime/recovery` 只返回当前操作、步骤摘要、部分稿和该执行保存的稿件快照；`savedDraft` 不是并发人工编辑后的实时正文。读取不领取租约、不续期、不修复、不调用模型。原始请求、上下文和供应商错误不通过该投影返回。

既有生成/修文 POST 可带 `productionOperationId`。同标识恢复；不同且明确提供的标识在无活跃租约时归档旧执行并以当前稿为新基线。调用方只能在用户明确选择新操作后更换标识，不能由轮询或自动恢复随机生成。任务中心仍只读。

源工作区“稿件与恢复”读取步骤和保留稿；`POST runtime/recovery/resume` 只接受原操作标识，从服务器私有记录复用原 stream/repair 参数。活跃租约、人工改动、未知结果或历史缺少原请求时拒绝普通恢复；展示安全原因。父级范围任务须从其源工作区恢复，不能从章级端点越过预算或取消。明确核对后允许一次新生成/修文，旧记录归档保留。UI 操作验收仍由用户执行。

`POST runtime/recovery/acknowledge` 仅接受 `{operationId, acceptPossibleDuplicate: true}`，表示用户已在源工作区核对保留稿与调用结果，并接受未确认调用可能已执行的风险。服务端重新检查操作身份、租约与当前稿件/合同；活跃租约或输入变化一律拒绝。只读投影的 `canAcknowledge` 同时包含显式 unknown 和未完成的流启动标记，客户端不通过文字猜测状态。

核对事务先以独立 decision 标识归档原记录及受影响步骤，再把未确定步骤转为 failed；原 operationId、请求、done 输出和部分稿全部保留。未完成 normalize 的 stream.started 和未获得完整修文的 manual_repair.started 标记被清除，避免同一步永远卡在未知状态。这一步不调用模型、不执行章节步骤、不修改父任务 pendingManualRecovery。之后用户另行从原入口恢复，同一操作仅执行未完成步骤；范围任务必须从原父任务的源工作区恢复。重复提交同一已处理决议没有新副作用。

## 验证与限制

离线测试使用 `server/tests/novelProduction/offlineBootstrap.cjs` 拦截默认 Prisma 和网络。journal 仿真、真实 SQLite 内存事务、真实 pipeline/流编排分别验证持久化故障、重启、重复请求、人工改稿及未知输出。测试命令与证据见仓库阶段报告。

本章正文与生命周期状态具备同事务 CAS。审查报告、时间线和实际资产按独立持久步骤提交，各步骤的本地写入与完成标记共用章级 token/版本校验事务；外部提取在事务外缓存，实际资产的 8 类消费者共用本地事务。不是覆盖模型调用到全部资产的一笔长事务。关键同步失败保留正文并停在失败步骤，前章的精确正文 hash 与当前操作完成边界匹配后才允许下一章。详见 [actualState README](../actualState/README.md)。准备中途发生不确定写入会安全停止，不能自动猜测继续。
