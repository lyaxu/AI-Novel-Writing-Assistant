# 规划修复的人工恢复边界

- 修复候选、质量判定、章节窗口和原子提交由 volume/planningRepair 管理。本模块只负责导演暂停、明确授权和原入口恢复。
- `PLANNING_REPAIR_CONFIRMATION_REQUIRED` 与 `PLANNING_REPAIR_CONFLICT` 均保存为 `waiting_approval / step_review_required / pendingManualRecovery`。源页面是 `structured`，不是 pipeline 重规划。
- HTTP 状态查询不调用 workflow healing。恢复按钮只在节奏 / 拆章工作区出现；导演进度提供导航，运行记录不提供操作。
- 手动追加需要 repairKey、非空 guidance、幂等请求标识。先 CAS 预留请求，再读取最新工作区并 rebase，最后 CAS 追加一轮。保留 rounds、历史与不受影响的数据。失败不追加预算。
- rebase 必须在事务读取任务后比较 `expectedSeedPayloadJson`，防止旧请求重置另一请求的授权状态。源内容发生变化时由 store 建立安全的新快照，不能把旧候选直接提交到新源。
- 普通继续、批准关卡和跳过质量都不能越过 waiting/uncertain/technical_failed、pendingOperation 或尚未完成的预算授权。干净的 assessing/repairing/reviewing/ready 可在原预算内恢复并复用完成结果。明确授权的命令使用固定幂等键，HTTP 重放不重复授予预算或创建执行命令。
- seed.planningRepairRecovery 保存原 `structured_outline` 或 `chapter_execution` 锚点。前者恢复指定章规划，后者清掉失败 job 引用并重新走 JIT，不调用 replanNovel，不跳过当前章。
- pipeline job 丢失异常 code 时，通过 durable planningRepair 的 waiting/uncertain 状态补回导演暂停。生产执行器仍必须立即收束该异常，不得降级为成功或继续下一章。
- 离线测试 `server/tests/planningRepairRecovery.test.js` 在导入服务前封锁数据库模块，验证 HTTP、CAS、错误映射和两类恢复路径；`PLANNING_REPAIR_TEST_SOURCE=1` 可直接转译最新源码测试而不触发 server build。
