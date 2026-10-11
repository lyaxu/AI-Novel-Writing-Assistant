# 单章持久执行边界

## 职责与真源

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

- 完成步骤持久保存输出；普通重入只执行未完成步骤。审查、候选、修订预算、选稿保存、提交及最终同步使用确定步骤键。`pipeline.options` 冻结本次修订策略，重启传入的剩余额度为 0 不能丢弃已有候选。
- 精确的结构格式错误、空正文及不可应用补丁是有确定结果的失败；网络中断、进程在外部调用中退出、外部输出尚未持久化是未知结果。未知结果和额度耗尽不能自动补发。
- 持久化步骤输出失败后保留 running/unknown 边界，不以回调成功推断落盘成功。租约 token、正文和本章合同均须匹配才能写入。
- 同章重复请求不会双跑；活跃请求返回忙提示，完成请求复用产物。原稿/候选仍按已有质量策略选择，不为了恢复改写判断。
- 人工编辑可以照常保存；它使旧执行失效，不能把旧候选覆盖回当前稿。失败后变更参数或稿件须显式新操作，先归档旧执行，不能把普通重试变成重写许可。
- 流中途关闭时不调用完整保存。无人接收流或迟迟不完成 onDone 时释放租约；流部分稿仍在检查点。
- `NovelPipelineExecutor` 收到四类 `CHAPTER_PRODUCTION_*` 错误后保留章节位置并进入 pendingManualRecovery，不调用 AI 治理再发起尝试。

## 源工作区接口

`GET /api/novels/:id/chapters/:chapterId/runtime/recovery` 只返回当前操作、步骤摘要、部分稿和该执行保存的稿件快照；`savedDraft` 不是并发人工编辑后的实时正文。读取不领取租约、不续期、不修复、不调用模型。原始请求、上下文和供应商错误不通过该投影返回。

既有生成/修文 POST 可带 `productionOperationId`。同标识恢复；不同且明确提供的标识在无活跃租约时归档旧执行并以当前稿为新基线。调用方只能在用户明确选择新操作后更换标识，不能由轮询或自动恢复随机生成。任务中心仍只读。

本阶段只提供源接口，未新增前端恢复按钮或改变原有编辑器；未知结果核对后发起新操作尚需源页交互验收，不能声称现有 GUI 已完成这条流程。

## 验证与限制

离线测试使用 `server/tests/novelProduction/offlineBootstrap.cjs` 拦截默认 Prisma 和网络。journal 仿真、真实 SQLite 内存事务、真实 pipeline/流编排分别验证持久化故障、重启、重复请求、人工改稿及未知输出。测试命令与证据见仓库阶段报告。

本章正文与生命周期状态具备同事务 CAS；审查报告、时间线、事实等各资产仍有原服务事务与检查点。时间线长调用后增加了写前版本检查，但尚不是所有事实表与章级 token 的同事务提交，不能宣称跨资产原子性。规划服务内部写入的版本归属、审查来源/质量债分流和事实提交收敛属于阶段 3。准备中途发生不确定写入会安全停止，不能自动猜测继续。
