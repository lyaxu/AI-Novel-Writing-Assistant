# 原任务完整恢复入口修复与误关联纠正

本轮基线：`codex/production-core-refactor` / `c2319022`。用户明确授权修复完整入口、离线回归、安全处理误关联、核验服务加载；禁止模型调用、新版改动和历史导演恢复。前序[第二次停顿](2026-10-11-maoshan-resume-second-stop.md)的失败事实保留。

**最终加载核验：2026-10-11 13:07 UTC-5（18:07 UTC）通过。** 用户管理员运行新版入口后，旧后端PID51304，startedAt=18:06:31.203Z，运行HEAD1241d05cc4df包含修复ac8925a3；实时health stale=false、newerSources为空。旧前端45328、新版5173/8787仍3960/21116。启动错误日志为空，正常日志仅启动及health访问。

18:07:22只读真实恢复预检再次通过：关联原job cmv3x3pr500r7gow0pt92xbmt、原chapter cmv3x2mt600jsgow0e6kb0852，首章3013字符及下文hash不变，范围1—3、人工暂停保留。所有可自动运行job/task/command/side-effect计数0，本导演17:00后模型用量记录0。证据为同私有目录restart-last.log、loaded-health.json、restart-process.json及live-preflight.json。下文权限阻点是已解决的历史记录。

可以打开[本书第一章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)，刷新后点击“继续自动导演”，按原1—3章范围从第一章未完成审查接续。代理没有点击该动作。此结论是修复、离线回归、数据安全与加载完成；真实模型接续、连续三章/十章和文学验收仍由用户进行，不能宣称未来所有故障已排除。

## 实现与根因闭环

正常继续被未来规划缺口分流，规划完成进入章节节点时未携原任务身份，错误新建job撞上保留稿journal。属于恢复链路未闭合，不是用户操作或模型故障。

- 继续入口重新检查真实job/journal暂停；命令已清导演暂停标记也不能丢失恢复意图。已保存章的恢复先于未来未写章规划。
- 原job处于reviewing时，以原恢复位置覆盖陈旧重规划投影；不重规划、跳章或跳审查。
- 规划→章节适配传递原job、执行范围状态和显式授权；缺身份、关联变化或恢复失败时拒绝新建替代任务。
- 已成功job向后续章正常推进，授权规划修复仍保留原语义；孤立failed绑定不能仅凭章节approved投影宣称完成。
- 原范围、请求、写法、模型、质量检查和剩余预算保留。

## 离线证据

最终服务端tsc通过。35个测试文件 **352/352** 全封网通过；规划恢复专用 **20/20** 通过（数据库替身、仅本地回环HTTP），均0跳过。两组单列，不与旧307/417结果相加。

新增13项完整入口测试使用实际现场workspace和原暂停journal：源页HTTP→实际命令受理与预检→实际Continue→范围准备→core原任务resume→实际Coordinator/Adapter/章节管线/journal，writer和首稿保存禁止重复。覆盖再次审查失败后仍显式恢复同job、陈旧replan、改范围、改稿、取消、错误绑定、缺授权和漏身份。

测试中的worker调度由内存drain替身承接；审查响应和外部持久副作用为离线替身。后续第2/3章以执行替身确认顺序和范围；真实Executor的租约、预算、恢复检查由同组pipelineExecutorRecovery等覆盖。不是模型实测、浏览器验收或连续三章文学验收，不保证未来没有其他类型故障。

初次扩大回归348/349，旧测试允许failed孤立绑定直接宣称完成；保留正常无绑定完成测试，孤立绑定改为明确拒绝。规划恢复授权边界也重新回归，未通过放宽原稿保护使测试变绿。

日志：`.codex-run/maoshan-full-entry-recovery-20261011/final-tsc.log`、`final-offline-tests.log`、`final-planning-recovery-tests.log`；精确清单`test-files.txt`。

## 真实数据纠正

17:45 UTC完成用户授权的单行事务纠正。导演`cmv3wvaqm000sgow0l5or2pke`从误建`cmv42syf1002gcgw06h79ovnu`关联回原`cmv3x3pr500r7gow0pt92xbmt`；仅更换seed内job指针和原暂停错误显示、更新时间。两个job均保留，未改状态、正文、journal、预算、范围或命令。

先使用SQLite backup API做含WAL的一致性备份：`.codex-run/maoshan-full-entry-recovery-20261011/before-reconciliation.db`，**1,027,043,328字节**，quick_check=ok。另建完整副本演练，校验正文、job、journal与命令全行不变。维护工具11项安全测试通过；实际回写采用快照CAS，验证唯一journal归属、合同/正文指纹、任务范围/父级、无取消/租约/活动命令、误建任务零模型调用且无journal。事务未清人工暂停。

随后只读运行真实ChapterPipelineRecoveryService.prepareDirector预检通过。首章3013字符、SHA256 `d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6`未变，原审查failed，范围1—3，17:00后本导演模型用量记录0。证据：`live-reconciliation-result.json`、`live-preflight.json`及副本演练记录。

## 运行加载与剩余边界

代码修复已提交`ac8925a3`，数据已完成核验。17:49代理在完成原稿/任务/进程身份预检后尝试停止旧后端34144，被Windows以“拒绝访问”拒绝；当前会话非管理员，旧后端为用户管理员启动。这是Windows进程权限，不是本轮工具自动审批拒绝，不可把磁盘权限当作进程控制权限。

17:50 health仍34144、stale=true，新版5173/8787仍3960/21116，旧前端仍45328。当时修复尚未加载、不能继续验收；该阻点已在顶部最终核验中解除。 唯一剩余依赖为管理员重启；源码/离线测试/数据修复已完成，不再让用户反复尝试恢复按钮。

已准备`.codex-run/maoshan-full-entry-recovery-20261011/restart-repaired-old.cmd`，右键以管理员身份运行；日志固定同目录`restart-last.log`。实际执行的是同目录ps1，仅重启旧后端3000，保留旧前端及新版；验证5个源码SHA256、原稿/关联/暂停、无可自动执行任务和命令、端口及进程启动时间。PowerShell7与Windows PowerShell两种CheckOnly已实跑通过；停止/启动部分因权限未执行。启动配置保留隔离库、RAG=false、日志清理false。启动后脚本校验health新PID/源码HEAD/stale=false并再做原任务预检，不发送恢复或模型请求。

后续核验要求（已按顶部记录完成）：用户运行后代理须先读restart-last.log、loaded-health.json与实际health，再只读核验原job/journal/首章hash/模型用量以及新版PID；完成后才能告知用户从源页继续。不得重放上轮旧PID脚本。

服务核验通过后的源页仍是本书第一章工作区，动作“继续自动导演”；按原1—3章范围从审查接回。真正模型运行由用户触发。源页操作链接沿用[前序报告](2026-10-11-maoshan-review-recovery-fix.md)；运行记录仅查看。

稳定规则已同步[wiki](../wiki/workflows/chapter-review-resume.md)，本轮状态同步[CURRENT](../handoffs/CURRENT.md)与[台账](../handoffs/WORK_LEDGER.md)。原三客户端未提交改动、台账下方历史964行和未跟踪材料均保留；不push或合并发布。
