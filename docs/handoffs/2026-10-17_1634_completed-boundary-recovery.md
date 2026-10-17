# 章间暂停恢复修复：已推送，等待服务重载

## 接手摘要
2026-10-17 16:34（北京时间）。用户在原书源页点击继续自动导演，报“原章节任务缺少可核对的恢复位置”。已修复两处实现缺陷并推送 a2452c7bde2cd48c6d2a9a28ee06e48a2dd31c00。自动审批拦截服务脚本，运行后端尚未加载本次修复；不能让用户立即再点继续。

## 环境与唯一真源
仓库 D:/novel/AI-Novel-Writing-Assistant；分支 codex/production-core-refactor；个人远端 lyaxu，修复提交与远端SHA一致，无main/beta合并。数据库 D:/novel/.comparison/2026-10-10/old-test.db。仍运行后端3000/PID31072（Node24.19.0，加载e6c25c73368a，16:06:48启动）和前端5190/PID56660。当前health stale=true。

## 用户目标与不可破坏约束
保留五章正文、原任务4—10、模型及质量设置、调用记录；代理不发恢复POST或模型请求。三个Structured组件、台账历史964行及未跟踪资料均保持。现书验收恢复；固定版本十章和新人物独立样本验收仍待安排。

## 关键进程时间线
用户报错→核对日志和真实DB→确认第5章job成功且currentItemKey为空→预检增加成功章间边界→发现ContinueRuntime还会因未来缺章转入结构规划并修复→73预检/命令测试→server编译→126相关恢复测试及4项新增整链测试→真实库只读预检→修复提交推送并核对SHA。两次服务脚本准备被自动审批拒绝（原方案含停止旧后端，替代方案仅空闲端口启动），原因只返回blocked by policy；均未执行、未生成脚本。

## 已完成实现
ChapterPipelineRecoveryService.prepareDirectorContinuation区分completed与paused。成功job核验真实归属、终态、无取消/暂停/有效租约；章内中断继续原journal严格核对。DirectorCommandService以原job和导演版本事务CAS受理。ContinueRuntime重新核验成功边界后进入原范围自动执行，未来缺章交逐章规划，不重新生成整段。成功job不resume、不改写；预算沿用。

## 验证与实测结果
server tsc成功；7个相关测试文件126通过，新增completedJobContinueRecovery文件4通过，二者不重叠。整链离线从HTTP→命令→ContinueRuntime→自动执行→第6章规划入口，保留4—10范围、100章书级目标及预算；采用合成正文和规划/预算读替身，不是模型实测或十章文学验收。证据目录 .codex-run/completed-boundary-20261017/，含server-build.log、recovery-tests.log、completed-chain-tests.log、before.json、readonly-preflight.json、health-before-restart.json。

真实书cmv3wyvw40015gow0780pycx9《外卖小哥的茅山账本》，导演cmv8d55el0033z8w0hneoiiru，job cmvancw5f004hu0w0dp5lfxfa为第5章succeeded/pending=false/currentItemKey=null；导演running/pending=true、next6、4—10完成2/7。五章approved/completed，字符3013/3680/3729/3916/5808及原SHA256均未变，任务调用26/全库151。最新保护基线16:27:50；相对16:10旧基线仅另一个手动工作区任务导航字段和时间变化（16:19:58），不是原导演或正文变化；本轮基线之后保护摘要一致。

## 已知问题与临时绕过
代码已完成/已推送，未加载/未用户验收。旧进程继续服务，暂勿重试继续。需要在获准的执行环境或用户手动重载同一DB的后端，健康检查stale=false后再继续。原库无Prisma迁移历史，不能用全量迁移解决此问题；不需要本轮数据库写入。

start-local.bat仍为用户原未跟踪脚本，仅pnpm dev：运行当前分支源码，默认前端5173、后端3000、server/dev.db；不是当前5190/old-test.db入口。旧一次性start.ps1依赖过时manifest及保护基线，不能直接复用。未更改这些启动器。原来的旧dashboard阶段/实时状态展示残留仍是待UI验收项。

## 未执行与待执行任务
P0：安全重载旧后端（源源码、Node24、web模式、明确old-test.db、127.0.0.1:3000/CORS5190，RAG=false/关闭日志自动清理）；重新核对队列、健康和五章/调用保护后，由用户在5190源页继续第6—10章。P1：续写结束检查连续性、人物身份、资源归属、暂停恢复与累计用量。另行固定版本十章和人物独立样本验收；不能提前标通过。

## 关键文件与产物索引
生产恢复：server/src/services/novel/production/recovery/；命令：director/commands/DirectorCommandService.ts；继续：director/runtime/novelDirectorContinueRuntime.ts。稳定规则见../wiki/workflows/chapter-review-resume.md。原迁移/备份见2026-10-17_1610_mainline-loaded-and-pushed.md；一致性备份 .codex-run/mainline-load-20261017/pre-migration-backup.db（1027043328字节）保留。本轮没有新迁移。

## 下一窗口启动顺序
1. 完整AGENTS→PROJECT_CONTEXT→CURRENT→本快照；核对Git和dirty。
2. 只读核对31072/56660及真实DB状态，不能把旧PID和时间当永久事实。
3. 完成服务重载及只读验证，再交用户继续；不自动付费生成。
4. 验收反馈写回CURRENT、台账与个人记忆增量。

## 待确认事项与风险
自动审批阻塞重载，不是用户拒绝。真实UI/模型行为仍未验证；测试通过只证明恢复边界和离线链路。当前可以条件交接，边界是必须先完成加载。

## 可直接发送给新窗口的开场提示
读取AGENTS和docs/handoffs/CURRENT.md，接手章间暂停恢复修复。a2452c7b已推送但后端仍旧进程；先核对五章/26调用/人工暂停和端口，安全重载同一隔离库，不发恢复或模型请求。
