# 独立范围任务的源页恢复

章节 journal 是已保存步骤的真源；`GenerationJob` 是范围、取消、重试预算和父级租约的真源。本模块只把两者映射为源工作区可用的恢复动作，不能创建替代任务或猜测历史记录归属。

只认 executor 发出的 `pipeline:${jobId}:${chapterId}`。投影同时核对小说、章节顺序与任务范围、当前任务章节、原请求所属工作流、取消与人工暂停状态。带 `workflowTaskId` 的导演任务由导演源工作区处理；历史随机 operationId 不迁移。当前任务必须为 queued/running 且 pendingManualRecovery，不能把 failed 任务偷偷改为 queued。

GET 只读取，返回 `pipelineJobId / pipelineRange / canResumePipeline`。外部调用结果未知须先完成章节核对决议；过期的本地 running 保存步骤可由原 journal 安全恢复。POST `runtime/recovery/resume-pipeline` 接受原 operationId，重新预检后调用原 `resumePipelineJob`，预检错误同步返回，不先回复已受理。

源页恢复将任务的 updatedAt、原 payload、小说与章节交给既有恢复服务做 CAS。仅当任务仍暂停、未取消、无有效租约且快照匹配，才能解除人工暂停并调度原 job。CAS 失败不能调度；不清除并发取消、不重置重试次数。之后的章节 journal 和执行租约继续检查当前稿件与所有权。其他既有 resume 调用保持原接口行为。

`pipelineSourceRecovery.test.js` 使用明确替身覆盖投影、范围归属、未知与过期本地步骤、取消竞争和薄路由；默认数据库、模型及网络不可访问。
