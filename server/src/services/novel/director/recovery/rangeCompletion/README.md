# 已完成任务的范围缺章恢复

`workflow_completed` 是历史运行结论，不能覆盖保存范围内的真实缺章。`resolveIncompleteCompletedRange` 仅检查已授权范围和实际章号，复用自动执行状态计算进度；读取方可以覆盖展示为待继续，但不能在 GET 写入任务、创建命令或调用模型。

作者在源工作区明确继续时，命令接受事务重新核对原范围、成功章节任务归属、活跃工作和任务版本。仅原 `succeeded/workflow_completed` 任务通过 CAS 进入 queued，创建同导演命令；保留范围、质量策略、修复预算和既有正文。成功的旧章节 job 不恢复、不重审，仅将其 ID 留在 `rangeCompletionRecovery` 历史记录，清除运行关联。

ContinueRuntime 识别该显式恢复记录后交给原范围自动执行，由逐章规划补齐下一缺章，再创建正常的章节 job。记录不是扩大范围或重置预算的授权。真正完整、取消、关联变化、正在运行、CAS 冲突均不能走此恢复。
