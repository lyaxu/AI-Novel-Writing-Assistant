# 最新交接入口

更新：2026-10-12 17:00 UTC。

**最新停点：第一章已完成；第二章规划修复与现场协调完成，待管理员加载修复。** 用户确认旧账本后，首章状态提交及原job成功，3013字原稿未变。第二章模型正常返回，但未来承接引用无效，被误报“外部调用中断”。完整上下文纠正、确定失败分类和人工暂停已修，130/130封网 + 5/5 Prompt、shared/server编译通过。[本轮完整证据](../evals/2026-10-12-maoshan-chapter-two-planning-recovery.md)。

**主线：旧版可靠保存、失败恢复和连续生产，保留认可文笔/创作能力/质量检查，最后固定版本十章验收。** 当前阶段4推进至第二章准备，正文仍为空，十章未完成。用户认可文笔和情节，但资源面板难懂的体验问题仍待改进与验收，展示更多字段不等于解决。

## 仓库与服务

- 仓库 D:/novel/AI-Novel-Writing-Assistant，分支 codex/production-core-refactor。接续HEAD17f1aa8ce328，本轮阶段提交以git为准。预存三份Structured客户端改动及台账历史964行未提交追加保持原样，未跟踪材料未清理。
- 旧后端3000/PID14328仍加载da52839c4fbe，应用启动14:17:11.606Z，OS启动14:17:04.3697377Z；前端5190/PID45328。新版5173/PID3960、8787/PID21116未动。
- 仅用隔离库D:/novel/.comparison/2026-10-10/old-test.db。代理非管理员，旧后端为管理员进程，待用户通过本轮cmd加载；磁盘授权不等于Windows提升令牌。

## 实证与恢复状态

- 书《外卖小哥的茅山账本》cmv3wyvw40015gow0780pycx9；导演cmv3wvaqm000sgow0l5or2pke。
- 首章cmv3x2mt600jsgow0e6kb0852为approved/completed，原job cmv3x3pr500r7gow0pt92xbmt为succeeded、journal completed。原稿3013字/hash d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6；3265字候选、原审查及已用预算保留。
- 旧账本提案cmv5bhew50019oow0j37nfjvr已committed，是用户明确确认结果，无需再次核对。
- 第二章cmv3x2mt800jtgow0la32yn38正文0字。合法后续job cmv5h9a64000j20w0uw4cxeo0范围2—2、failed/manual=1；导演范围仍1—3，引用此job。执行合同与复核已完成，恢复只处理未完成的章节规划。
- 私有脚本经过一致性备份、副本实际prepareDirector预检及13项故障/幂等回归，16:58仅协调active journal metadata并新增精确原始归档；两个误标unknown改failed，完整三次请求/响应及原因保留，未接受非法计划。162张表比对确认正文/合同/StoryPlan/job/task/预算/暂停无额外变化。
- 备份.codex-run/maoshan-chapter-two-planning-20261012/2026-10-12T16-58-52-588Z-d1c8d72c-pre-reconcile.db，1,027,043,328字节、quick_check=ok，SHA256 ee16f6a169465102b6ebfa43b7c6f6d7948874b1e257ad3c659c5f3cf61a2cc3。
- 16:59真实prepareDirector只读预检通过；active任务/命令/副作用0，10-11 17:00后模型记录18条，均为用户操作累计，代理新增0。未发继续命令。

## 下一步

本轮加载入口.codex-run/maoshan-chapter-two-planning-20261012/restart-old-planning.cmd，用户右键管理员运行。脚本校验源码、旧服务PID及启动时间、旧前端和新版端口、原第二章任务与稿件，再仅重启旧后端；不调用模型或恢复任务。不要复用前轮resource/candidate脚本，其预检停点已过期。

用户运行后读取同目录restart-last.log、loaded-health.json及原任务预检，确认本轮代码加载；再从[本书第二章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt800jtgow0la32yn38)F5，点一次“继续自动导演”。这时已不是首章审查停点，不重做首章或账本确认。

真实只拆了前两章。节奏板3—5/6—9章区段不是具体未来章纲；第二章场景卡对第3章的设想与节奏板存在层次漂移。v6不保证模型必过；若明确requires_replan，应在既有授权范围补真实后续章纲及复核，不能盲试同一空窗口。后续规划和十章验收仍待用户。

## 记录链与边界

长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。前轮[资源状态暂停](../evals/2026-10-12-maoshan-resource-state-pause.md)、[候选复审](../evals/2026-10-12-maoshan-candidate-review-recovery.md)、[原任务入口](../evals/2026-10-11-maoshan-full-entry-recovery.md)保留历史，不把旧停点当最新操作。

稳定规则见[wiki](../wiki/workflows/chapter-review-resume.md)与模块README。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍为讨论未实施。新版不动，不自动模型调用或恢复历史书，不另建GUI，不push/合并发布。旧完整交接及所有备份继续保留。
