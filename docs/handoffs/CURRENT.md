# 最新交接入口

更新：2026-10-12 14:12 UTC。

**最新停点：候选失败隔离已生效，保留原稿后停在资源状态提交；“旧账本”提案待核对。** 本轮修复资源风险含义、源页指引及提案确认安全，65/65封网+2/2Prompt与双端编译通过，尚未加载。[本轮完整证据](../evals/2026-10-12-maoshan-resource-state-pause.md)。原稿3013字、候选3265字、原评估和预算保留。不要直接反复继续；加载后先从本章“资源风险”核对提案。

**主线：旧版可靠保存、失败恢复和连续生产，保留认可文笔/创作能力/质量检查，最后固定版本十章验收。** 当前阶段4真实验收仍在首章，第二章为空；阶段2/3为工程实现完成但仍补真实闭环，不能把修复次数或离线用例数当十章通过。

本轮修正not_applicable无比较主张仍索要引文；补before时序反馈。候选复审明确无效时保留已审查原稿、原债和预算，由原质量策略处理；不将候选认证通过，不吞网络未知/额度/取消/存储冲突，不解除质量优先或明确重规划暂停。前序[v9初审修复](../evals/2026-10-11-maoshan-review-state-contract.md)、[409时间修正](../evals/2026-10-11-maoshan-recovery-cas-timestamp.md)及[入口修复](../evals/2026-10-11-maoshan-full-entry-recovery.md)已有用户实证；十章验收未完成。

仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor。本轮基线81aec3b77850，运行HEAD1c0cb9a3b31c，本轮最终提交以git为准。预存三Structured客户端改动与WORK_LEDGER历史964行未提交追加保持原样，未跟踪材料未清理。

## 实证状态

- 旧后端3000为PID55320，10-12 13:23:28.714Z应用启动，运行1c0cb9a3b31c/v10，因本轮源码变化stale=true，资源抽取仍v1。旧前端5190为45328。新版5173/8787仍3960/21116，未动。
- 35文件352/352封网回归、规划恢复20/20及服务端编译通过。13项新增入口测试跨源页HTTP、命令预检、实际恢复选择和范围准备、原job resume、实际Coordinator/Adapter/管线/journal。审查响应与worker排队/外部副作用为离线替身，后续2/3章只验证连续调度；不是模型或文学验收。
- 书《外卖小哥的茅山账本》cmv3wyvw40015gow0780pycx9；导演cmv3wvaqm000sgow0l5or2pke；原job cmv3x3pr500r7gow0pt92xbmt；首章cmv3x2mt600jsgow0e6kb0852。
- 17:45已一致性备份、完整副本演练、CAS纠正导演误关联，误建job cmv42syf1002gcgw06h79ovnu保留为失败证据。原稿、job、journal、预算、范围、命令均未改写，人工暂停未解除。
- 10-12 14:11 UTC真实prepareDirector只读预检通过。首章3013字符，SHA256 d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6；候选3265字/hash dbd24c04c577d67e5a2e70681d06b230b3642fb3c0f139a0365568535c5fcd6b。review:0/repair_budget/repair均done，review:1 done且为候选拒绝，timeline/assets extract及commit done，boundary待提案；原job暂停、范围1—3。无可自动执行工作，10-11 17:00后模型记录11条（本次用户新增5），原job总调用17，代理0次。
- pending提案cmv5bhew50019oow0j37nfjvr为旧账本，high风险理由为剧情内未知债务风险；不自动降级、不重抽取、不私自确认。确认必须对照正文、持有及归属，提案失效/非法时拒绝确认。

## 下一步与边界

用户以管理员身份运行.codex-run/maoshan-resource-pause-20261012/restart-old-resources.cmd后代理核验日志/health/只读预检。随后从[本书第一章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt600jsgow0e6kb0852)F5→右侧“资源风险”→“需要判断的资源变更”，核对“旧账本”，符合正文则确认，不接受则明确忽略。之后点一次继续自动导演，复用原稿评估、时间线和assets，补状态boundary后推进。未处理提案直接继续仍停。真实后续状态同步、规划与连续十章未验收。

本轮CheckOnly核验16个源码hash、现有旧进程和暂停现场通过，尚未运行新重启。当前终端非管理员，沿已验证的管理员cmd流程，不绕过权限。新版不动，不自动模型调用或恢复历史书，不另建GUI，不push/合并发布。

本轮证据目录.codex-run/maoshan-resource-pause-20261012/含编译/65+2项测试/只读预检及重启脚本；前序candidate-review目录含本次用户真实调用日志，不可把前次重启当本轮加载。记录错误码仍沿用存储安全门、版本日志事务外等残余项见本轮完整证据。

## 记录与整体目标

长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。旧[完整交接](2026-10-11_1615Z_maoshan-review-recovery_thread_handoff.md)保留前序实现及用户目标，其运行停点和操作限制以本页为准。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为讨论未实施。稳定恢复规则已入[wiki](../wiki/workflows/chapter-review-resume.md)。

私有证据目录 .codex-run/maoshan-full-entry-recovery-20261011/，含1,027,043,328字节一致性备份（quick_check=ok）、副本演练、真实纠正结果、最终测试日志及重启日志。保留备份和原始失败证据。
