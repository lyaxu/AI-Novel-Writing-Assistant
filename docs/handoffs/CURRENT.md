# 最新交接入口

更新：2026-10-12 00:19 UTC-5（05:19 UTC）。

**最新停点：用户管理员重启成功，v9审查修复已加载并核验，可从原任务审查继续。** 05:19 UTC实时health、源码hash、只读prepareDirector均通过；第一章3013字及原任务/范围/暂停保留。读[本轮完整证据](../evals/2026-10-11-maoshan-review-state-contract.md)。服务端编译及7文件71/71封网测试已通过且相关源码未再改；真实v9模型接续仍待用户执行。

本次补字段下标、冲突值与引文的纠正反馈，并修复“提示允许unknown空证据、校验却拒绝”的死路；不提高预算、不跳过审查、不自动批准。原始两回答仍被离线拒绝；手工模拟纠正只证明合同可完成，不证明真实模型已通过。前序[409时间修正](../evals/2026-10-11-maoshan-recovery-cas-timestamp.md)及[完整入口修复](../evals/2026-10-11-maoshan-full-entry-recovery.md)已被用户18:20受理和原job运行验证，仍不等于模型审查通过。

仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor。本轮源码修复c16169dd，运行HEAD623ff6c05967，随后仅核验文档更新，最终HEAD以git为准。预存三Structured客户端改动与WORK_LEDGER历史964行未提交追加保持原样，未跟踪材料未清理。

## 实证状态

- 旧后端3000为PID25564，10-12 05:15:34.618Z启动，运行623ff6c05967，源码hash覆盖v9及前序入口修复，stale=false、newerSources=[]。旧前端5190为45328。新版5173/8787仍3960/21116，未动。
- 35文件352/352封网回归、规划恢复20/20及服务端编译通过。13项新增入口测试跨源页HTTP、命令预检、实际恢复选择和范围准备、原job resume、实际Coordinator/Adapter/管线/journal。审查响应与worker排队/外部副作用为离线替身，后续2/3章只验证连续调度；不是模型或文学验收。
- 书《外卖小哥的茅山账本》cmv3wyvw40015gow0780pycx9；导演cmv3wvaqm000sgow0l5or2pke；原job cmv3x3pr500r7gow0pt92xbmt；首章cmv3x2mt600jsgow0e6kb0852。
- 17:45已一致性备份、完整副本演练、CAS纠正导演误关联，误建job cmv42syf1002gcgw06h79ovnu保留为失败证据。原稿、job、journal、预算、范围、命令均未改写，人工暂停未解除。
- 10-12 05:19 UTC真实prepareDirector只读预检通过。首章3013字符，SHA256 d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6。范围1—3；原job仍第一章审查暂停。无可自动执行的job/command/director/sideEffect；本导演10-11 17:00后模型记录仍2条，均由用户18:20触发，代理0次，重启没有新调用。

## 下一步与边界

用户从[本书第一章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)按F5刷新，点一次“继续自动导演”，沿原审查和1—3范围推进。不改范围、不跳质检、不单独生成第二章。运行记录只读；真实模型、连续章节与十章全文验收未完成。

旧后端加载已完成，不需要再次运行重启脚本。新版不动，不自动模型调用或恢复历史书，不另建GUI，不push/合并发布。

此前04:44 UTC管理员身份阻点由用户05:15管理员重启解决。新证据目录.codex-run/maoshan-review-contract-20261011/：restart-last.log、restart-process.json、loaded-health.json、live-preflight.json；本次只读CheckOnly返回修复已加载，无停启或恢复请求，服务err日志为空。

## 记录与整体目标

长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。旧[完整交接](2026-10-11_1615Z_maoshan-review-recovery_thread_handoff.md)保留前序实现及用户目标，其运行停点和操作限制以本页为准。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为讨论未实施。稳定恢复规则已入[wiki](../wiki/workflows/chapter-review-resume.md)。

私有证据目录 .codex-run/maoshan-full-entry-recovery-20261011/，含1,027,043,328字节一致性备份（quick_check=ok）、副本演练、真实纠正结果、最终测试日志及重启日志。保留备份和原始失败证据。
