# 最新交接入口

更新：2026-10-12 17:50 UTC。

**最新停点：第二章3652字已保存，停在审查；本轮v11修复和72项封网回归通过，尚待管理员加载。** 用户17:33继续后planner v6一次成功、正文一次完成，审查两次正常返回后因证据时序问题暂停。修复区分后文补述和实际事后获得，shared/server编译通过；没有改正文或自动认可旧审查。[本轮证据](../evals/2026-10-12-maoshan-chapter-two-review-timing.md)。

**主线：旧版可靠保存、失败恢复和连续生产，保留认可文笔/创作能力/质量检查，最后固定版本十章验收。** 用户最不满意反复停顿。首章完成、第二章保存均已有实证，第二章审查、后续章纲和固定版本十章仍未完成。资源面板难懂仍为独立体验问题，不能靠展示更多字段宣称解决。

## 仓库、服务与数据

- 仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor，接续HEAD420d742fa66e；本轮提交以git为准。预存三份Structured客户端改动与台账历史964行仍未提交，未跟踪材料未清理。
- 旧后端3000/PID58352加载4b4aa6fdd3e3、acceptance v10，应用启动17:19:50.720Z、OS启动17:19:40.5630667Z；旧前端5190/PID45328。新版5173/PID3960和8787/PID21116未动。
- 仅用隔离库D:/novel/.comparison/2026-10-10/old-test.db。本轮只读，无数据库协调/正文写入/任务恢复/模型调用。
- 书cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke；当前job cmv5h9a64000j20w0uw4cxeo0，failed/manual=1，范围2—2；导演原范围仍1—3。
- 首章cmv3x2mt600jsgow0e6kb0852为approved/completed，3013字/hash d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6。旧账本提案committed；原首章job succeeded，候选与历史质量证据保留。
- 第二章cmv3x2mt800jtgow0la32yn38为drafted，3652字/hash 461051846359919e84f43627c317c07ed07eff7da652caa434303bcc37489b91。prepare/执行合同/章计划/draft/save_draft全部done，review:0及evaluation failed，journal paused。章节行chapterStatus仍generating，不代表job仍活跃。
- 17:43原job prepareDirector只读预检通过，active工作0，模型记录累计22（本次用户增加4，代理0）。本次4调用为规划12.8秒、写作160秒、审查16.3秒、纠正12.5秒，均stop。

## 根因与修复边界

正文行动后补述“他练了十几年”，validator按引文字符位置误认能力晚于行动才有，反馈使AI删掉真实前提证据改unknown却仍earned。完整前章已进入written_evidence，无上下文缺失。首轮另外两项空transitionEvidence已在第二答补齐。

修复增加AI结构化beforeEvidenceTiming，显式区分回叙既有状态、实际事后条件和未知，并保留准确来源/字段相容/必要前置过渡检查；不是关键词豁免，不改小说或写作Prompt，不自动把旧审查变通过。after/必要transition尚有线性位置边界，不能宣称任意倒叙完整支持。

## 下一步

本轮文件在.codex-run/maoshan-chapter-two-review-20261012/，新加载入口restart-old-review.cmd。72项封网及双包编译完成，源码/进程/原任务CheckOnly用于最后加载预检；用户管理员运行，仅重启旧后端，不恢复任务或调用模型。不要复用前轮planning脚本，其0字/18调用预检已过期。

加载后先核验restart-last.log、loaded-health.json及原任务预检，再从[本书第二章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt800jtgow0la32yn38)F5，点一次“继续自动导演”，从原审查步骤继续。不要重写第二章，不重跑已完成规划，不重做首章或账本确认。

## 记录链

长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。前序[第二章规划恢复](../evals/2026-10-12-maoshan-chapter-two-planning-recovery.md)、[资源状态暂停](../evals/2026-10-12-maoshan-resource-state-pause.md)、[候选复审](../evals/2026-10-12-maoshan-candidate-review-recovery.md)保留历史，不把旧停点当当前入口。

稳定规则见[wiki](../wiki/workflows/chapter-review-resume.md)与acceptance模块README。[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍讨论未实施。未来只拆前两章，节奏板跨度不是后续具体章纲；规划漂移和连续十章待验。新版不动、不自动模型或恢复历史书、不另建GUI、不push/合并发布。前轮备份全部保留。
