# 最新交接入口

更新：2026-10-13 08:37 UTC（用户时区03:37 UTC-5）。

**最新停点：第二章3652字已保存，用户继续v13后因漏填故事时序再次暂停；v14已冷启动并核验，可从原审查继续。** 主线仍为旧版可靠保存、失败恢复和连续生产，保留认可文笔、创作能力、质量检查与防丢稿，最后固定版本十章验收。当前仅首章完成、第二章保存；真实v14审查、后续章纲和固定版本十章仍未通过。

## 当前证据

- 当前仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor，已加载生产代码c660f2e15a42，本轮提交以Git为准。预存三个Structured客户端改动及台账历史964行保留，未跟踪资料未清理。
- 旧后端3000/PID18844已加载c660f2e15a42/acceptance v14，应用启动2026-10-13T08:36:57.995Z；08:37实时health stale=false，33项源码hash通过。
- 电脑08:27:50 UTC重启后所有对照端口关闭；仅按原隔离配置冷启动旧前端5190/PID8500与后端3000，新版5173/8787保持关闭。数据库仍为D:/novel/.comparison/2026-10-10/old-test.db，未发恢复命令或模型调用。
- 书cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke；当前job cmv5h9a64000j20w0uw4cxeo0，failed/manual=1，job范围2—2、导演原范围1—3保留。
- 首章cmv3x2mt600jsgow0e6kb0852为approved/completed，3013字/hash d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6。原首章job succeeded，旧账本提案committed，历史候选与质量证据保留。
- 第二章cmv3x2mt800jtgow0la32yn38为drafted，3652字/hash 461051846359919e84f43627c317c07ed07eff7da652caa434303bcc37489b91。prepare/合同/章计划/draft/save_draft保持done，review:0和evaluation失败、journal paused；章节行generating不代表任务活跃。
- 用户08:03触发v13审查、格式修复和语义纠正三次，均正常stop，没有规划/正文重生成。模型记录累计27，代理0；08:37原job prepareDirector只读预检通过，active任务/命令/副作用全部0。

## 根因与修复

08:03用户继续v13后，证据编号均可定位；首答把场景说明写成编号对象，格式修复后漏行动状态证据，语义纠正补了证据却仍漏拳术的回叙时序声明，原review再次暂停。v14显式列明编号/说明字段边界，每个状态强制故事时间判断及完整示例；缺字段与其他证据错误一次性汇总，沿用一次完整上下文纠正，缺失时序不交给无正文的JSON修复猜测。115项封网及shared/server编译通过，正确时序是人工模拟，真实模型仍待验。两章hash、原任务/预算/范围保留，模型记录27均用户触发、代理0。v14已于08:37核验加载成功。[本轮完整证据](../evals/2026-10-13-review-timing-contract.md)。证据编号机制保留，不能用去标点、自动补语义或放宽门禁处理漏项；先前[编号修复](../evals/2026-10-13-review-evidence-references.md)记录保留。

## 下一步

本轮目录.codex-run/review-timing-contract-20261013/。原restart脚本依赖历史前端PID，电脑重启后提前退出，未动进程；start-old-after-reboot.ps1经空端口/33项源码/任务预检后只启动旧版，两端启动身份见cold-start-processes.json，运行核验见verified-loaded-health.json和live-preflight.json。无需再次运行脚本。

用户从[第二章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt800jtgow0la32yn38)F5，点一次继续自动导演，恢复原审查；不重写正文、不重做首章或账本确认。

## 未完成与记录链

- 两次审查的场景自由文本仍把“交代来源/木匣震动”“收钱/拍照”的顺序写反。不是本次停点，属于后续语义审查风险，不能以精准引用检查证明整个审查结论可靠。
- 实际只拆前两章，后续章纲、资源面板可理解性、任意倒叙after/transition证据、固定版本十章均待验；此前边修边测不等于固定版本通过。
- 长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。
- 前序[审查时序与加载](../evals/2026-10-12-maoshan-chapter-two-review-timing.md)、[第二章规划](../evals/2026-10-12-maoshan-chapter-two-planning-recovery.md)、[资源状态](../evals/2026-10-12-maoshan-resource-state-pause.md)、[候选复审](../evals/2026-10-12-maoshan-candidate-review-recovery.md)保留历史，不把旧恢复入口当当前步骤。
- 稳定规则见[wiki](../wiki/workflows/chapter-review-resume.md)与acceptance模块README；[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍讨论未实施。新版不动、不自动模型或恢复历史书、不另建GUI、不push/合并发布，前轮备份全部保留。
