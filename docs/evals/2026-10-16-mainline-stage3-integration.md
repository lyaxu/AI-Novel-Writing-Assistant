# 阶段3A—3D离线整合记录

## 结果与版本

2026-10-16 22:53（UTC-05:00，17日03:53 UTC）收尾。仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/production-core-refactor`，从 `c716e0e3` 接续用户指定路线图。产品提交：

- `11ec8a4e`：任务用量归属、安全暂停与整书规模。
- `6495c413`：整书人物覆盖、分批完善、候选改名及身份保存。
- `32765647`：资源核对问题和证据展示、组合回归中的兼容性修正。

结论为代码实施和离线整合完成。数据库迁移未应用，服务未加载，UI和真实模型验收未进行；固定版本十章仍未通过。

## 能力与验证范围

| 范围 | 实现与检查 |
| --- | --- |
| 3A用量 | 完整任务记录，规划与正文ID可靠映射，未归属计入总量；高用量提醒，显式预算/无进展/输出额度仍暂停；恢复不清累计预算，规划后的预算检查先于正文派发 |
| 3A书级规模 | 100章整书与4—10批次隔离，完整保留seed profile的结局/承诺；缺章、跨卷、高章序、已有下一章及原任务恢复覆盖 |
| 3B人物 | AI结构化覆盖计划依据整书章数/字数/卷与故事职责；核心档案与后续覆盖分开，逐人物保存，重试只补未完成，同进程防重入，SQLite新增字段不丢旧行 |
| 3C身份 | 候选源页改名，稳定ID/别名/用户锁/CAS；补档拒绝并发旧名，重应用保留正式姓名和资料；人物候选、章节事实及两条资源路径统一明确身份解析，歧义不合并 |
| 3D资源 | AI输出具体疑问/账本事实/本章事实/原因；两条提案路径保留解释；常规消耗等不按事件严重程度强制人工核对，真正高风险/低置信/非法抽取仍保护；旧缺失事实不编造 |

人物人数由AI规划；3—6个核心档案和一次最多6个补档请求均不是整书人数上限。未批量改写原稿，也未合并本书疑似重复人物。

## 最终代码检查

- `pnpm --filter @ai-novel/shared build`：通过。
- `pnpm --filter @ai-novel/server build`：通过，最后产品修改后重新编译。
- `pnpm --filter @ai-novel/client typecheck`：通过，其后客户端仅提交、未改代码，复用本次检查。
- 综合回归：119文件、1360测试，**1352通过、0失败、8既有跳过**。不再累加此前重叠定向测试。清单 `.codex-run/mainline-20261016/test-files.json`，日志 `regression.log`，执行器 `run-regression.cjs`。

综合回归使用匹配本地SQLite驱动的Node 24.19.0，命令：

```powershell
& 'C:\Users\lyaxu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .codex-run/mainline-20261016/run-regression.cjs
```

执行器使用 `--require ./server/tests/novelProduction/offlineBootstrap.cjs --test --test-concurrency=4`，默认数据库和网络入口被阻断。真实Prisma适配器测试仅创建隔离临时SQLite文件；新增迁移保旧测试使用内存SQLite。未触达配置数据库的写路径或模型接口。

八项既有skip为六项旧节点/规划写入策略测试及两项book analysis提示测试，列表保留在日志。它们仍是覆盖缺口，不算通过。本轮新增人物、用量、安全预算和资源确认测试没有新增skip。

初次综合回归有五项失败，已保留问题结论：三个旧计划对象深比较被新增的 `usageBudget: undefined` 破坏，改为未设置时不输出该键；资源测试未装载新增身份模块，补真实纯模块与数据库查询替身；系统Node25的ABI141不匹配SQLite驱动ABI137，改用已安装Node24后真实适配器测试通过，未重装依赖。最终日志是修复后全量复跑结果。

## 现场保护复核

03:30:21.975Z与03:52:58.177Z两次只读SQLite逐项深比较：task/seed、五章hash、26条调用、最近jobs和人物列表一致。脚本 `.codex-run/mainline-20261016/verify-preservation.cjs`，前后快照 `sample-before.json` / `sample-after.json`，摘要 `preservation.json`。

- DB `D:/novel/.comparison/2026-10-10/old-test.db`，书 `cmv3wyvw40015gow0780pycx9`；任务 `cmv8d55el0033z8w0hneoiiru` 仍running/pendingManualRecovery=1、完成2/7、next=6。
- 五章字符数3013/3680/3729/3916/5808，均approved/completed；第6章未物化，历史246741提示与7章profile仍保留在数据库。本轮代码在显式恢复路径解析正确书级规模，未用手改数据库冒充修复。
- 队列无运行中job/command；唯一queued job是另一本停止样本的人工恢复记录，pendingManualRecovery=1且无owner/lease，保留。7条side-effect均succeeded。
- 3000/5190/5173/8787未监听。本轮不启动服务，不触发后台恢复。
- 三个Structured组件及WORK_LEDGER历史964行保持预存修改，未混入产品提交；其他原未跟踪资料保留。

## 真实旧库副本迁移

证据为 `.codex-run/mainline-20261016/migration-verification.json` 与 `verify-migration-copy.cjs`。成功备份路径：`.codex-run/mainline-20261016/migration-verification-1792209493292/original-backup.db`；迁移副本为同目录 `migration-copy.db`，二者各1027043328字节。源库通过node:sqlite只读连接和在线backup生成一致性快照；副本在事务中执行本次新增字段及索引SQL，Prisma读取也只连接副本。未启动应用后台worker。

首轮探针位于临时目录，无法直接定位server工作区的Prisma依赖；改用server/package.json的createRequire后完整复跑通过，没有修改产品依赖。两轮产生的备份及副本都保留在本地未跟踪验证目录，合计约4.1GB，不属于发布包，不上传或自动清理。

## 接入与验收缺口

新增字段必须先在备份副本验证迁移，再按既有隔离环境流程受控迁移和加载，不能直接启动新代码并假定旧schema兼容。03:58 UTC已补充实际旧库的一致性备份副本验证：162张表、17227行在迁移前后所有原有列逐表排序hash一致，备份与迁移副本均通过integrity_check；实际Prisma适配器成功读取本书100章目标及旧人物方案的新增字段。原库再次逐表核对未变。验证只执行该迁移SQL，未登记_prisma_migrations；正式部署流程和PostgreSQL实库仍未验收。

补档单进程防重入不等于跨进程费用恰好一次；进程崩溃后的未知模型结果不能自动重试。预算在安全边界检查，不实时打断正在执行的模型调用；创建参数支持明确预算，未提供独立预算编辑面板。

按AGENTS，未运行浏览器/截图/手工UI验收。后续由用户验收候选改名、应用重试、分批人物和资源问题是否可理解，以及实际模型是否遵守新结构。继续原6—10只能证明恢复，不等于固定版本新跑连续十章；真实写作/预算/版本冻结另行安排。断网、睡眠、重启全场景和书内agent仍是未启动的专项设计。

稳定规则见[用量与范围](../wiki/workflows/director-usage-and-book-scope.md)、[人物与身份](../wiki/workflows/book-cast-identity.md)、[资源确认](../wiki/workflows/resource-confirmation-questions.md)。
