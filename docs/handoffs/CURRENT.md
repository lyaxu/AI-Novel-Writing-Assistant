# 最新交接入口

更新：2026-10-13 09:32 UTC（用户时区04:32 UTC-5）。

**最新：阶段3审查契约v15与纠正反馈整体收敛，43文件453项完整封网回归通过，旧后端已加载并核验，可由用户从原审查继续。** 两章正文保留，仅首章完整完成；工程回归不代表真实模型或固定版本十章验收通过。

## 当前证据

- 仓库D:/novel/AI-Novel-Writing-Assistant，分支codex/production-core-refactor，生产代码0988e0dca456，加载后文档提交以Git为准。预存三个Structured客户端改动、台账历史964行及未跟踪资料保留。
- 09:32 UTC受控加载核验完成：旧后端11680已加载0988e0dca456/v15，应用启动2026-10-13T09:31:48.092Z，health stale=false，37项源码hash通过；旧前端8500身份未变，新版5173/8787保持关闭。加载后原review只读预检通过，两章hash、原任务/范围/预算/账本不变，调用仍29、代理0、活跃工作0。无需用户重启，从第二章源页F5后一次继续自动导演。
- 隔离DB D:/novel/.comparison/2026-10-10/old-test.db；书cmv3wyvw40015gow0780pycx9，导演cmv3wvaqm000sgow0l5or2pke；原job cmv5h9a64000j20w0uw4cxeo0 failed/manual1，job范围2—2、导演1—3。
- 首章3013字/completed/hash d4fb3b8f6b9230632a4bafe29740ae8744950ab105bc1e5e08562e7f883dcda6；第二章3652字/drafted/hash 461051846359919e84f43627c317c07ed07eff7da652caa434303bcc37489b91。原账本committed。准备、合同、章计划、draft/save_draft done，review:0 failed；章节行generating不等于任务活跃。
- 本轮只读prepareDirector预检通过；活跃任务/命令/副作用0，模型记录29，代理新增0。shared/server编译和453项封网通过，详细见[统一回归快照](../evals/2026-10-13-review-contract-convergence.md)。

## 本轮修复及边界

阶段3审查契约整体收敛：v15将行动前提与结果变化分开交给AI判断，程序汇总重复裁决；来源、范围、时序、状态和推进错误一次性完整反馈，仍只用一次既有语义纠正。未完成审查不进成功缓存，失败原答/诊断/补文建议完整留证且不改稿。43文件453项封网回归通过，覆盖14份真实失败回答及1份有效原稿对照；人工语义模拟不等于真实模型验收。09:24只读核验两章3013/3652字hash、原job审查暂停、范围/预算/账本不变，调用29、代理0、活跃工作0。修复已加载；实际v15模型审查仍待用户触发验证。

主线依次是可靠保存和恢复、规划/审查/实际状态收敛、固定版本十章。v15把前提和结果分开，程序派生重复字段；集中反馈全部错误；未完成回答保留原始快照且不入成功缓存。真实缺陷仍执行质量政策。14份真实失败及1份有效对照保留原文；新判断是人工模拟，不能冒充AI成功。

## 下一步

本轮目录.codex-run/review-contract-convergence-20261013/；旧维护脚本27调用基线已过期，禁止复用。源清单、进程身份、29调用及原审查只读预检已通过，仅重启旧3000后端。无需再运行维护脚本。用户从[第二章源工作区](http://127.0.0.1:5190/novels/cmv3wyvw40015gow0780pycx9/edit?directorTaskId=cmv3wvaqm000sgow0l5or2pke&stage=chapter&chapterId=cmv3x2mt800jtgow0la32yn38)F5刷新，再点一次“继续自动导演”，沿原job的review恢复。运行记录只读，不在那里操作恢复。

## 未完成与记录链

- 两次审查的场景自由文本仍把“交代来源/木匣震动”“收钱/拍照”的顺序写反。不是本次停点，属于后续语义审查风险，不能以精准引用检查证明整个审查结论可靠。
- 实际只拆前两章，后续章纲、资源面板可理解性、任意倒叙after/transition证据、固定版本十章均待验；此前边修边测不等于固定版本通过。
- 长期约束[PROJECT_CONTEXT](PROJECT_CONTEXT.md)，统一[台账](WORK_LEDGER.md)，[批准方案](../plans/2026-10-11-production-core-refactor.md)，[十章验收单](../evals/2026-10-11-ten-chapter-acceptance.md)。
- 前序[审查时序与加载](../evals/2026-10-12-maoshan-chapter-two-review-timing.md)、[第二章规划](../evals/2026-10-12-maoshan-chapter-two-planning-recovery.md)、[资源状态](../evals/2026-10-12-maoshan-resource-state-pause.md)、[候选复审](../evals/2026-10-12-maoshan-candidate-review-recovery.md)保留历史，不把旧恢复入口当当前步骤。
- 稳定规则见[wiki](../wiki/workflows/chapter-review-resume.md)与acceptance模块README；[断线续作与书内agent](../plans/2026-10-11-resilient-writing-and-book-agent-ideas.md)仍讨论未实施。新版不动、不自动模型或恢复历史书、不另建GUI、不push/合并发布，前轮备份全部保留。
