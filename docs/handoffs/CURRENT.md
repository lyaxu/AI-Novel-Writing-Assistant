# 最新交接入口

更新：2026-10-11 23:43 UTC-5（10-12 04:43 UTC）。

**最新停点：用户已恢复原任务，但两次真实审查重复状态字段矛盾后暂停。** v9审查契约修正已完成，服务端编译及7文件71/71封网测试通过；旧后端仍未加载，暂不要再点继续。读[本轮完整证据](../evals/2026-10-11-maoshan-review-state-contract.md)。原稿3013字未变，没有重建job或重写第一章。

本次补字段下标、冲突值与引文的纠正反馈，并修复“提示允许unknown空证据、校验却拒绝”的死路；不提高预算、不跳过审查、不自动批准。原始两回答仍被离线拒绝；手工模拟纠正只证明合同可完成，不证明真实模型已通过。前序[409时间修正](../evals/2026-10-11-maoshan-recovery-cas-timestamp.md)及[完整入口修复](../evals/2026-10-11-maoshan-full-entry-recovery.md)已被用户18:20受理和原job运行验证，仍不等于模型审查通过。

仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor。本轮基线e055c35c，运行HEAD1241d05c，最终HEAD以git为准。预存三Structured客户端改动与WORK_LEDGER历史964行未提交追加保持原样，未跟踪材料未清理。

## 实证状态

- 旧后端3000为PID51304，18:06:31.203Z启动，仍提示v8，因本轮源码变更stale=true；包含上一轮入口修复。旧前端5190为45328。新版5173/8787仍3960/21116，未动。
- 35文件352/352封网回归、规划恢复20/20及服务端编译通过。13项新增入口测试跨源页HTTP、命令预检、实际恢复选择和范围准备、原job resume、实际Coordinator/Adapter/管线/journal。审查响应与worker排队/外部副作用为离线替身，后续2/3章只验证连续调度；不是模型或文学验收。
- 书《外卖小哥的茅山账本》cmv3wyvw40015gow0780pycx9；导演cmv3wvaqm000sgow0l5or2pke；原job cmv3x3pr500r7gow0pt92xbmt；首章cmv3x2mt600jsgow0e6kb0852。
- 17:45已一致性备份、完整副本演练、CAS纠正导演误关联，误建job cmv42syf1002gcgw06h79ovnu保留为失败证据。原稿、job、journal、预算、范围、命令均未改写，人工暂停未解除。
- 10-12 04:41 UTC真实prepareDirector只读预检通过。首章3013字符，SHA256 d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6。范围1—3；原job仍第一章审查暂停。无可自动执行的job/command/director/sideEffect；本导演17:00后模型记录2条，均由用户18:20触发，代理0次。

## 下一步与边界

先加载本轮新入口`.codex-run/maoshan-review-contract-20261011/restart-old-review.cmd`，仅核验并重启旧后端，不提交恢复命令。确认health加载v9、稿件hash和原任务暂停后，用户从[本书第一章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)刷新点“继续自动导演”，沿原审查和1—3范围推进。不改范围、不跳质检、不单独生成第二章。运行记录只读；真实模型、连续章节与十章全文验收未完成。

旧后端属于管理员进程，需要管理员权限加载本次修复；不要重跑上一版固定旧PID脚本。新入口绑定当前PID、启动时间、源码hash、原隔离配置并前后核验暂停与原稿。新版不动，不自动模型调用或恢复历史书，不另建GUI，不push/合并发布。

## 记录与整体目标

长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。旧[完整交接](2026-10-11_1615Z_maoshan-review-recovery_thread_handoff.md)保留前序实现及用户目标，其运行停点和操作限制以本页为准。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为讨论未实施。稳定恢复规则已入[wiki](../wiki/workflows/chapter-review-resume.md)。

私有证据目录 .codex-run/maoshan-full-entry-recovery-20261011/，含1,027,043,328字节一致性备份（quick_check=ok）、副本演练、真实纠正结果、最终测试日志及重启日志。保留备份和原始失败证据。
