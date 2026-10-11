# 最新交接入口

更新：2026-10-11 13:07 UTC-5（18:07 UTC）。

**最新停点：完整恢复入口已修复，误关联已纠正，旧服务已确认加载；可由用户从第一章原任务审查继续。** 本轮用户明确要求修复至可恢复验收，禁止代理模型调用、新版改动和历史导演恢复。读取[完整入口修复及最终加载证据](../evals/2026-10-11-maoshan-full-entry-recovery.md)，历史失败见[第二次停顿](../evals/2026-10-11-maoshan-resume-second-stop.md)。

仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor。源码修复ac8925a3；用户加载HEAD1241d05cc4df，本次仅追加核验文档，最终HEAD以git为准。预存三Structured客户端改动与WORK_LEDGER历史964行未提交追加保持原样，未跟踪材料未清理。

## 实证状态

- 实时health旧后端3000为PID51304，18:06:31.203Z启动，stale=false、newerSources=[]，包含完整入口修复。旧前端5190为45328。新版5173/8787仍3960/21116，未动。
- 35文件352/352封网回归、规划恢复20/20及服务端编译通过。13项新增入口测试跨源页HTTP、命令预检、实际恢复选择和范围准备、原job resume、实际Coordinator/Adapter/管线/journal。审查响应与worker排队/外部副作用为离线替身，后续2/3章只验证连续调度；不是模型或文学验收。
- 书《外卖小哥的茅山账本》cmv3wyvw40015gow0780pycx9；导演cmv3wvaqm000sgow0l5or2pke；原job cmv3x3pr500r7gow0pt92xbmt；首章cmv3x2mt600jsgow0e6kb0852。
- 17:45已一致性备份、完整副本演练、CAS纠正导演误关联，误建job cmv42syf1002gcgw06h79ovnu保留为失败证据。原稿、job、journal、预算、范围、命令均未改写，人工暂停未解除。
- 18:07:22真实prepareDirector只读核验通过。首章3013字符，SHA256 d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6。范围1—3；原job仍第一章审查暂停。无可自动执行的任务或命令，本导演17:00后模型用量0。

## 下一步与边界

用户从[本书第一章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)刷新后点“继续自动导演”，沿原审查和1—3范围推进；不改范围、不跳质检、不单独生成第二章。运行记录只读。代理未触发恢复，真实接续、连续章节与十章全文验收仍待用户执行。

本次Windows权限阻点已通过用户管理员重启解决；无需重放重启脚本。禁止仅凭旧日志/PID再次停止进程。新版不动，不自动模型调用或恢复历史书，不另建GUI，不push/合并发布。

## 记录与整体目标

长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。旧[完整交接](2026-10-11_1615Z_maoshan-review-recovery_thread_handoff.md)保留前序实现及用户目标，其运行停点和操作限制以本页为准。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为讨论未实施。稳定恢复规则已入[wiki](../wiki/workflows/chapter-review-resume.md)。

私有证据目录 .codex-run/maoshan-full-entry-recovery-20261011/，含1,027,043,328字节一致性备份（quick_check=ok）、副本演练、真实纠正结果、最终测试日志及重启日志。保留备份和原始失败证据。
