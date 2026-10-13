# 最新交接入口

更新：2026-10-13 05:37 UTC（用户时区00:37 UTC-5）。

**最新停点：第二章3652字已保存，用户继续原审查后仍因错引暂停；v12引用反馈修复和85项封网验证完成，待管理员加载。** 主线仍为旧版可靠保存、失败恢复和连续生产，保留认可文笔、创作能力、质量检查与防丢稿，最后固定版本十章验收。当前仅首章完成、第二章保存；真实v12审查、后续章纲和固定版本十章仍未通过。

## 当前证据

- 当前仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor，接续HEAD71e3f9344e0e，本轮提交以Git为准。预存三个Structured客户端改动及台账历史964行保留，未跟踪资料未清理。
- 旧后端3000/PID16620仍加载976c727b1176/acceptance v11，应用启动2026-10-13T05:05:19.044Z、OS启动05:04:32.6501231Z。05:04管理员启动时脚本健康等待先超时，服务47秒后就绪；05:13已核验成功，此次是用户后续继续审查又暂停。
- 旧前端5190/PID45328；新版前端5173关闭、新后端8787/PID21116。新版未动。数据库仅D:/novel/.comparison/2026-10-10/old-test.db，本轮只读，无真实协调或模型调用。
- 书cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke；当前job cmv5h9a64000j20w0uw4cxeo0，failed/manual=1，job范围2—2、导演原范围1—3保留。
- 首章cmv3x2mt600jsgow0e6kb0852为approved/completed，3013字/hash d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6。原首章job succeeded，旧账本提案committed，历史候选与质量证据保留。
- 第二章cmv3x2mt800jtgow0la32yn38为drafted，3652字/hash 461051846359919e84f43627c317c07ed07eff7da652caa434303bcc37489b91。prepare/合同/章计划/draft/save_draft保持done，review:0和evaluation失败、journal paused；章节行generating不代表任务活跃。
- 用户05:22触发v11审查两次，18.837秒和14.759秒，均正常stop，无规划/写作调用。模型记录累计24，增加2条均用户触发，代理0。05:35原job prepareDirector只读预检通过，active任务/命令/副作用全部0。

## 根因与修复

AI把对白内部“我上个月丢过手机，后来补了卡。”摘成带额外引号的独立句，正文没有该完整引文；两答均原样保留。拒绝错引正确，但程序将未定位引文再次报为after时序失败，纠正提示误导。第一答另一项敲门前知情已在第二答用前章真引修正；旧练拳检查本次改选身体/物品维度，不能声称所有回叙已实证通过。

v12精确指出来源、数组索引和错引；引文存在、来源用途正确后才比较时序。错误action锚点、前章充当after、计划来源分别拒绝；不自动改引文、不去标点放行、不改正文、不加重试预算。85/85封网及server编译通过，共享契约未变复用既有shared编译。两真实错答仍拒绝，准确引用通过是手工模拟，不代表真实模型已通过。[完整证据及残余问题](../evals/2026-10-13-maoshan-review-citation-feedback.md)。

## 下一步

本轮目录.codex-run/maoshan-review-v11-stop-20261013/，加载入口restart-old-review.cmd。源码manifest、原任务和正文只读预检保护24条调用和原review；仅用户管理员重启旧后端，不恢复任务或调用模型。脚本允许新版前端关闭，核对新版及旧前端实际状态前后一致；健康等待180轮，超时先实查是否仍在启动，不能盲目重复重启。旧目录脚本的PID/22调用条件已过期，不使用。

加载后核验restart-last.log、loaded-health.json、protected-services-after.json及原job预检，再由用户从[第二章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt800jtgow0la32yn38)F5、点一次“继续自动导演”，恢复原审查。不要重写第二章、重跑已完成规划、重做首章或账本确认。

## 未完成与记录链

- 两次审查的场景自由文本仍把“交代来源/木匣震动”“收钱/拍照”的顺序写反。不是本次停点，属于后续语义审查风险，不能以精准引用检查证明整个审查结论可靠。
- 实际只拆前两章，后续章纲、资源面板可理解性、任意倒叙after/transition证据、固定版本十章均待验；此前边修边测不等于固定版本通过。
- 长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。
- 前序[审查时序与加载](../evals/2026-10-12-maoshan-chapter-two-review-timing.md)、[第二章规划](../evals/2026-10-12-maoshan-chapter-two-planning-recovery.md)、[资源状态](../evals/2026-10-12-maoshan-resource-state-pause.md)、[候选复审](../evals/2026-10-12-maoshan-candidate-review-recovery.md)保留历史，不把旧恢复入口当当前步骤。
- 稳定规则见[wiki](../wiki/workflows/chapter-review-resume.md)与acceptance模块README；[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍讨论未实施。新版不动、不自动模型或恢复历史书、不另建GUI、不push/合并发布，前轮备份全部保留。
