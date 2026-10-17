# 主线3A—3D开发收尾交接

## 接手摘要

2026-10-16 22:53（UTC-05:00；17日03:53 UTC）。用户要求读1535Z路线图后继续开发，本轮完成3A用量/整书规模、3B按篇幅人物、3C候选改名与身份、3D资源确认和离线组合回归。03:58 UTC已追加真实旧库副本迁移验证，下一项是受控迁移和加载准备，随后用户UI/真实模型验收；不要直接继续第6章。固定版本十章未通过。

## 环境与唯一真源

- 根目录 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/production-core-refactor`，产品HEAD `32765647`；后续交接文档提交以git log为准。
- 产品提交 `11ec8a4e`（3A）、`6495c413`（3B/3C）、`32765647`（3D/兼容性）。无push、分支合并或新chat。
- DB `D:/novel/.comparison/2026-10-10/old-test.db`，书 `cmv3wyvw40015gow0780pycx9`，4—10任务 `cmv8d55el0033z8w0hneoiiru`。
- 预存三个Structured组件与WORK_LEDGER历史964行未提交、未被覆盖。原未跟踪文件，包括运行证据、临时数据库、根目录草稿和视频，全部保留；沿原checkout交接，不清理、不stash。
- 03:51—03:53 UTC现场3000/5190/5173/8787均无监听；本轮未加载服务。不是历史快照中的在线版本。

## 用户目标与不可破坏约束

保留旧版创作能力、写法、质量门禁、原稿及原任务；新版不动，不建第三套GUI。工程检查、真实流程、文学质量分开。人物阵容以AI整书结构为主，不固定几十人；候选改名必须连同稳定身份、别名、重应用保护。本书疑似重复摊主不自动合并，已写正文不批量改名。禁止自动恢复停止样本、模型调用、破坏性迁移、发布或合并main/beta。

## 关键进程时间线

读完整AGENTS/PROJECT_CONTEXT/CURRENT/1535Z路线图及批准方案→只读确认仍五章暂停/26调用→实现3A并用真实脱敏26调用重放→并行完成3B、3C、3D→共享/服务编译和客户端类型检查→综合回归修正旧计划空字段与身份模块测试依赖→用本地Node24解决原生SQLite驱动ABI不匹配→最终119文件1352通过→逐阶段本地提交→只读保护复核和文档同步。没有模型试跑、服务启动或生产数据库写入。

## 已完成实现

1. 用量完整按task查询，规划/正文ID可靠归并，未知仍计入总量；正常高用量提醒，明确预算/无进展/输出额度暂停保留，只有显式恢复清相应用量暂停。规划消耗也在正文派发前检查预算。
2. 恢复与下一章准备使用整书profile；seed完整承诺/结局优先，批次7章不能改成整书7章。
3. 手工和导演共用人物生成/持久化；整书覆盖与核心档案分离，逐人物分批保存，失败不抹已完成批次。
4. 候选源页改名保存identityKey/别名/用户锁；CAS防并发旧名，应用事务绑定正式Character，旧候选不恢复旧名/重复建人/覆盖正式资料。同步使用明确姓名或绑定别名，歧义不猜测。
5. 资源核对展示问题、旧账事实、本章变化与证据；常规消耗/损坏/丢失不因剧情事件严重度强制人工核对，真实风险与非法抽取保护保留。

新增模型提示全部经Prompt Registry；新schema同时提供PostgreSQL/SQLite additive migration，但未应用。新能力当前是已提交代码，不是已加载产品。

## 验证与实测结果

见[整合证据](../evals/2026-10-16-mainline-stage3-integration.md)：shared build、server build、client typecheck通过；最终119文件、1360测试中1352通过/0失败/8既有skip。综合回归中的真实SQLite适配器使用临时数据库，迁移保旧测试使用内存库；offlineBootstrap阻断默认数据库与网络。真实旧库副本的额外验证见下文。

只读前后task/seed、五章hash、26调用、jobs、人物深比较一致。原任务仍running/pendingManualRecovery=1、completed2/7、next6；五章3013/3680/3729/3916/5808字符，approved/completed，第6章无行。唯一queued是另一本废弃样本的人工暂停job，owner/lease为空；commands无活跃，sideEffects全部完成。原历史错误和旧profile还在DB，不要据此认为新代码没改，也不要直接修DB。

补充03:58 UTC实际旧库副本验证：一致性备份和迁移后162表/17227行的所有原字段hash相同，完整性正常，Prisma可读新增字段，原库未变。证据及备份路径见整合记录；只验证迁移SQL，未登记正式迁移历史。两轮本地备份/副本约4.1GB保留，不上传或自动清理。

## 已知问题与临时绕过

- 系统Node25与better-sqlite3 ABI不匹配；本轮使用既有 `C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`（24.19.0/ABI137）完成全套回归，没有改依赖。
- 八项既有跳过仍属覆盖缺口，详见证据。未知126224用量不猜测章归属，不能对未知记录作无进展结论。
- 补档单进程防重入不是跨进程费用恰好一次；未知外部结果不能自动重试。预算在安全边界检查，非实时中断。
- 未做UI、真实模型、PostgreSQL实库或正式迁移部署验收；未把五章样本称为文学/十章通过。

## 未执行与待执行任务

| 优先级/状态 | 下一步、依赖与验收 |
| --- | --- |
| P0，待执行 | 一致性备份副本迁移和Prisma读取已验证；核对原环境启动及正式迁移流程，按授权受控迁移/加载并核验branch/构建指纹/端口/健康及原任务仍暂停，不能由启动隐式触发模型 |
| P1，待用户验收 | 加载后UI核对人物覆盖、规划改名、补档中断保留、旧候选再应用和资源具体疑问；真实模型测试需用户触发及确认预算 |
| 阶段4，未开始 | 冻结版本后按十章验收文档运行；保留当前五章，原6—10恢复只能验证恢复，不能拼成固定版本十章 |
| 讨论/未启动 | 断网、睡眠、重启完整续作及书内agent专项设计，继续保留原设想，不自动扩展开发 |

## 关键文件与产物索引

- [批准方案](../plans/2026-10-11-production-core-refactor.md)、[3A证据](../evals/2026-10-16-stage3a-usage-book-scope.md)、[整合证据](../evals/2026-10-16-mainline-stage3-integration.md)。
- `server/src/services/novel/director/{automation,runtime}`、`services/planner`：用量和书级范围。
- `server/src/services/novel/characterPrep/{domain,application,infrastructure}`、`characters/identity`、`dynamics/commands`：人物与身份；对应模块README说明边界。
- `server/src/prisma/migrations{,.sqlite}/20261017010000_character_cast_coverage_identity/`：新增迁移。
- `client/src/pages/novels/components/characterPrep/`、`chapterInsights/ResourceRiskPanel.tsx`：源页交互。
- `.codex-run/mainline-20261016/`：regression.log、test-files.json、构建日志、preservation.json和前后快照，仍本地未跟踪证据。
- [用量wiki](../wiki/workflows/director-usage-and-book-scope.md)、[人物wiki](../wiki/workflows/book-cast-identity.md)、[资源wiki](../wiki/workflows/resource-confirmation-questions.md)。

## 下一窗口启动顺序

1. 同目录完整AGENTS→PROJECT_CONTEXT→CURRENT→本快照和整合证据，再看方案表；核验分支/HEAD/dirty，保留历史964行及三个Structured组件。
2. 只读复核原书任务/五章hash/26调用/活跃队列/服务身份；不要执行旧“重建4—10”或“选择完整工作台”指引。
3. 先读取已完成的副本迁移证据及备份路径，再准备正式迁移/加载；不自动调用模型。若只是交接读取，先报告当前边界，跟随用户最新要求。
4. UI和真实写作由用户验收；通过后另行冻结十章版本。后续代码变化只跑被影响的最窄充分检查，不重复无效全构建。

## 待确认事项与风险

上线加载前必须处理schema迁移；不能直接对旧库运行新人物读取路径。实际模型对整书覆盖、姓名锁与资源疑问的遵循效果待验。真实验收的预算及版本冻结尚未确认。本轮内部交接不新增发布文案，三个产品提交已按readme-release-updater同步最新日期块；wiki已记录稳定规则。

交接就绪：真实旧库副本已通过新增字段SQL及Prisma读取验证，可沿当前目录接手正式迁移/加载准备，条件是保持原暂停且不触发真实生成。本轮没有自动新建chat。

## 可直接发送给新窗口的开场提示

接手旧版主线，按AGENTS读取PROJECT_CONTEXT、CURRENT和2026-10-17_0353Z_mainline-development.md。3A—3D已完成代码与离线回归，产品提交32765647，数据库未迁移、服务未加载。先核验原分支dirty、五章hash和原4—10任务暂停，再核对已完成的备份副本迁移证据，准备正式迁移与受控加载。保留预存三个Structured组件/台账964行、新版及停止样本，不自动恢复任务或调用模型；用户UI/真实模型及固定版本十章尚待验收。
