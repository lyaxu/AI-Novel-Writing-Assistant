# 独立范围任务的源页恢复

章节 journal 是已保存步骤的真源；`GenerationJob` 是范围、取消、重试预算和父级租约的真源。本模块只把两者映射为源工作区可用的恢复动作，不能创建替代任务或猜测历史记录归属。

只认 executor 发出的 `pipeline:${jobId}:${chapterId}`。投影同时核对小说、章节顺序与任务范围、当前任务章节、原请求所属工作流、取消与人工暂停状态。带 `workflowTaskId` 的导演任务由导演源工作区处理；历史随机 operationId 不迁移。显式恢复允许 queued/running/failed 且 pendingManualRecovery；failed 必须经过同样的原稿、合同、未知结果、归属和租约预检，不能由后台轮询自动改为 queued。

GET 只读取，返回 `pipelineJobId / pipelineRange / canResumePipeline`。外部调用结果未知须先完成章节核对决议；过期的本地 running 保存步骤可由原 journal 安全恢复。POST `runtime/recovery/resume-pipeline` 接受原 operationId，重新预检后调用原 `resumePipelineJob`，预检错误同步返回，不先回复已受理。

源页恢复将任务的 updatedAt、原 payload、小说与章节交给既有恢复服务做 CAS。仅当任务仍暂停、未取消、无有效租约且快照匹配，才能解除人工暂停并调度原 job。CAS 失败不能调度；不清除并发取消、不重置重试次数。之后的章节 journal 和执行租约继续检查当前稿件与所有权。普通后台 resume 不得清人工暂停。

导演源页继续命令先调用只读 `prepareDirectorContinuation`，区分两个边界。`completed` 只接受确属本书、本导演的 succeeded job，且当前章节为空、无人工暂停、取消或有效父级租约；它表示上一章已完成，导演可以继续后续范围，不能再调用该 job 的章内恢复。`paused` 调用原 `prepareDirector`，保留章节 journal、原稿、未知调用、归属和租约的全部预检。其他状态不能借用 completed 通道绕过章内校验。旧成功 job 缺少 currentItemKey 是正常完成事实，不是丢失恢复位置。

预检只返回判别结果与原 `updatedAt / payload / novelId / chapterId` 快照，不清状态。命令接受必须检查原范围未更换，并在同事务中按对应分支重新核对 job 状态、归属、暂停与租约，再 CAS 接受导演任务并创建命令。章内恢复的执行端仍重新预检并恢复同一 job；重读后仍失败/取消/暂停则报冲突，不丢掉原 jobId 新建替代任务。冻结 pipeline.options、请求指纹及剩余预算必须回放，prepare/draft/save 已完成就不重做。

稳定规则见 [章节审查与原任务恢复](../../../../../../docs/wiki/workflows/chapter-review-resume.md)。真实现场回放及命令竞争由 firstChapterReviewRecovery、failedReviewOriginalJobRecovery、directorPausedCommandRecovery、directorOriginalJobRuntime 测试覆盖，修正后的审查响应仅为离线替身，不是模型实测。

继续命令清除导演暂停后，原 job/journal 的暂停仍须由执行入口重新核验，并优先于未来规划缺口恢复。fullContinueRecovery 从源页 HTTP 进入真实命令与恢复选择；维护脚本 reconcile-paused-director-binding 只在明确指定的新旧身份、安全预检和事务比较成功时纠正指针，不执行章节、不重置预算，先备份并演练后使用。

`pipelineSourceRecovery.test.js` 使用明确替身覆盖投影、范围归属、未知与过期本地步骤、取消竞争和薄路由；默认数据库、模型及网络不可访问。
