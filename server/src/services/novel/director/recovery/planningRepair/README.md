# 规划修复的人工恢复边界

- 修复候选、质量判定、章节窗口和原子提交由 volume/planningRepair 管理。本模块只负责导演暂停、明确授权和原入口恢复。
- `PLANNING_REPAIR_CONFIRMATION_REQUIRED` 与 `PLANNING_REPAIR_CONFLICT` 均保存为 `waiting_approval / step_review_required / pendingManualRecovery`。源页面是 `structured`，不是 pipeline 重规划。
- HTTP 状态查询不调用 workflow healing。恢复按钮只在节奏 / 拆章工作区出现；导演进度提供导航，运行记录不提供操作。
- 手动追加需要 repairKey、非空 guidance、幂等请求标识。先 CAS 预留请求，再读取最新工作区并 rebase，最后 CAS 追加一轮。保留 rounds、历史与不受影响的数据。失败不追加预算。
- rebase 必须在事务读取任务后比较 `expectedSeedPayloadJson`，防止旧请求重置另一请求的授权状态。源内容发生变化时由 store 建立安全的新快照，不能把旧候选直接提交到新源。
- 普通继续、批准关卡和跳过质量都不能越过 waiting/uncertain/technical_failed、pendingOperation 或尚未完成的预算授权。干净的 assessing/repairing/reviewing/ready 可在原预算内恢复并复用完成结果。授权请求使用固定幂等键；同一次执行的 HTTP 重放合并，不重复授予预算。
- 执行命令幂等与预算授权幂等分开：原恢复命令已结束但本任务仍真实暂停时，用户显式继续可以沿用原授权派发下一次命令。新命令键由原授权与前一条命令ID构成，重复点击合并；原命令、请求与预算保留。在途命令、活跃批次租约、待核实操作、待完成授权和取消中的任务不能被重新派发。GET、轮询和后台看门狗不使用此入口。
- seed.planningRepairRecovery 保存原 `structured_outline` 或 `chapter_execution` 锚点。前者恢复指定章规划，后者清掉失败 job 引用并重新走 JIT，不调用 replanNovel，不跳过当前章。
- 已开启自动执行且恢复键严格匹配时，章节规划恢复复用原范围。历史任务缺少 `productionExperience` 显示偏好不能把恢复退回首次开写选择；没有授权键或没有已开启执行范围的任务仍需经过首次生产确认。批准章节节点也必须传递明确的人工恢复标识。
- pipeline job 丢失异常 code 时，通过 durable planningRepair 的 waiting_confirmation / uncertain / technical_failed 状态补回导演暂停。技术失败保留原阶段及技术原因，不能归入普通质量修复后让源页面失去操作。生产执行器仍必须立即收束该异常，不得降级为成功或继续下一章。
- 暂停状态由前后端共享判断：waiting_approval / failed，或历史 running / queued 且明确 pendingManualRecovery；取消中的任务不可恢复。历史兼容只读展示，不在GET中清挂起标记或修复数据库。是否允许生成建议还需核对可修复阶段、任务归属及后台执行冲突。
- 已挂起的批次不是活跃生成。建议入口只忽略seed中本导演当前pipelineJobId指向、pendingManualRecovery且无executionOwner/执行租约的job；其他任务、仍有执行归属或租约的job和活跃命令仍阻止建议，不能按所有pending记录一概放行。
- 离线测试 `server/tests/planningRepairRecovery.test.js` 在导入服务前封锁数据库模块，验证 HTTP、CAS、错误映射和两类恢复路径；`PLANNING_REPAIR_TEST_SOURCE=1` 可直接转译最新源码测试而不触发 server build。
