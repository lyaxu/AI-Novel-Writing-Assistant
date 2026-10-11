# 首章审查与原任务恢复修复

核验：2026-10-11 16:12 UTC。用户批准修复两处并用现场离线回归；代理未执行真实恢复。仓库 `D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/production-core-refactor`，修复基线 `254e93da5479b354173890eabafa75b4fc409d76`。本报告随修复提交，提交号由git及CURRENT核验。

## 现场与根因

书 `cmv3wyvw40015gow0780pycx9`，导演 `cmv3wvaqm000sgow0l5or2pke`，原job `cmv3x3pr500r7gow0pt92xbmt`，首章 `cmv3x2mt600jsgow0e6kb0852`。隔离库为 `D:/novel/.comparison/2026-10-10/old-test.db`。首章3013字符，SHA256 `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`；16:12只读复核未变，job failed/pendingManualRecovery=1/reviewing，导演queued/pendingManualRecovery=1。

原审查请求 `stream-1791729009079-157`，DeepSeek `deepseek-v4-flash` 正常stop，返回accepted却包含错引、缺状态变化证据、把行动结果当先决条件；无比较职责的not_applicable空布尔也被误报。此前校验只投影问题，没进入已有一次纠正预算。另一处是failed暂停job不被恢复函数接受，导演可能丢弃原jobId再起任务。详见[原始诊断](2026-10-11-maoshan-first-chapter-stop.md)。

范围纠正：持久seed中 productionScope=sample3，autoExecution及directorInput.autoExecutionPlan均为chapter_range 1—3章；原单章job范围1—1。full_book_autopilot是推进策略，并不把本次目标变成无限全书。原诊断中范围不确定的提醒已被本次只读证据补充。

## 修复结果

- 接收审查资产v7→v8，证据缺项/错引进入既有一次语义纠正，明确只纠正审查JSON，不改正文。严格逐字引文与时序证据仍保留；not_applicable允许null，但后章缺前文不能冒充不适用。
- 纠正失败保留最后回答和原因，延后未核实修改建议，运行时保持CHAPTER_REVIEW_INCOMPLETE。网络未知、output_limit不伪装通过，不加预算或备用模型。
- 显式源页resume先只读检查原任务/journal/范围/正文合同/未知调用/租约；导演CAS和命令创建同事务。执行时再次预检并CAS恢复原job，取消/修改竞争不调度，后台重连不清人工暂停。
- 原job恢复失败明确报错，不替换job；沿用原operationId、pipeline.options与剩余次数，prepare/draft/save完成结果复用。真实审查若发现有效质量问题仍按原策略处理，不保证永远不修文。

## 离线证据

日志位于 `.codex-run/maoshan-review-recovery-fix-20261011/`。

- 最终服务端编译：bundled Node运行 `node_modules/typescript/bin/tsc -p server/tsconfig.json`，exit0，`server-tsc-final.log`。首次编译发生在并行实现中间态，报错已修，保留`server-tsc.log`。
- 31文件307/307通过、0跳过，`tests-green.log`及`test-files-final.txt`。命令为 bundled Node `--require ./server/tests/novelProduction/offlineBootstrap.cjs --test <清单>`，默认DB及网络在导入前封锁。
- 初轮统一301通过/6失败，全部是既有导演测试缺少只读查询替身；补严格替身后31项导演测试单跑通过，再统一307通过。没有为绿灯放宽产品守卫。
- `firstChapterReview.json`保留现场完整正文及原审查响应，仅归一化chapterId；`firstChapterPausedExecution.json`抽取真实journal、请求、合同指纹、原任务参数及步骤。回放覆盖错引、缺证据、一次纠正、纠正耗尽、网络错误、output_limit、有效负面意见、原任务恢复、不重复writer/save、人工改稿、取消竞争、原范围和预算。
- 修正审查回答是离线替身，不是新的模型结果。客户端无本轮源码修改，不重复客户端检查；不做浏览器/UI验收、不触发真实模型。

## 用户从原审查步骤继续

16:10核验旧后端33000、前端34024，health stale=true；修复尚未载入。新版5173/8787的3960/21116未变。此前自动审批拒绝启动旧服务，只给出blocked by policy，故没有换工具绕过。

在本机PowerShell执行一次：

```powershell
& 'D:\novel\AI-Novel-Writing-Assistant\.codex-run\maoshan-review-recovery-fix-20261011\restart-old-only.ps1'
```

脚本校验已知端口/PID/启动时间、原暂停状态及正文hash，无可自动续跑任务才停已知旧进程并调用原隔离启动脚本；不发送生成或恢复请求。已通过语法检查，读取预检实测通过；停止/启动部分本轮未执行。若PID、稿件或任务已变，脚本会拒绝，不能强行改脚本绕过。

16:43补充：用户运行报Backend identity changed，实际PID与启动时刻均未变化。根因为PowerShell 7把ISO时间解析成DateTime，与字符串直接比较误判；不是用户操作或权限错误。脚本已统一为UTC时刻比较，保留PID/进程创建时间/正文及暂停状态检查，增加CheckOnly。PowerShell 7.6.5和Windows PowerShell两端实跑CheckOnly均通过，没有停止/启动服务。可双击同目录`restart-old.cmd`，自动保存`restart-last.log`，发生异常由代理直接读取，不要求用户抄终端。启动仍待用户执行；命令执行审批拒绝与本次脚本错误必须分开记录，不能仅凭blocked by policy确定具体阻断层。此为本地运行脚本修正，不改变产品源码，不更新产品release notes。

服务成功后打开[本书第一章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)，刷新，点击“继续自动导演”。标准入口continuationMode=resume经命令适配带forceResume；从第一章未完成审查接回，然后按原质量策略及1—3范围推进。不要改范围、跳过质检或单独生成第二章。运行记录只读。

真实模型审查、UI原任务恢复与连续十章仍待用户验收；再次暂停应保留现场定位，不连续点重试。记录连到[CURRENT](../handoffs/CURRENT.md)、[台账](../handoffs/WORK_LEDGER.md)、[长期规则](../wiki/workflows/chapter-review-resume.md)和[断线续作/书内agent设想](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)。
