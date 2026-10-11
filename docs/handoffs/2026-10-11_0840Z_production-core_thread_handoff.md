# 旧版核心重构执行交接

核验时间：2026-10-11 08:40 UTC。本文只记录本地证据；此前多次上下文压缩，历史明细以所列报告为准，不宣称逐字保留所有聊天。

## 1. 接手摘要

用户已批准[核心重构方案](../plans/2026-10-11-production-core-refactor.md)：以旧版为基础，保留已认可创作能力，重构生产主链。最新问题是是否新开窗口执行；本窗口明确建议新开，仍用旧版同一 checkout、本地模式，不另建第三项目，不在新版实施。

本窗口完成准备：建立专用分支、冻结原有工作树差异、记录方案、替换过时交接入口。**核心实现尚未开始。** 新窗口先核验并汇报，再执行阶段2“单章可靠保存与恢复”，不要重新把对照测试或10月6日实验当当前任务。

## 2. 环境与唯一真源

- 应用：`D:/novel/AI-Novel-Writing-Assistant`。父目录 `D:/novel` 的 master 是另一个仓库。
- 从 `codex/book-story-foundation` / `8814525d1dd5dd28c7915afad7ed19aa88687b44` 新建 **`codex/production-core-refactor`**。当前阶段只有文档提交，接手以 `git log -1` 获取最新文档提交；运行代码基线仍8814525d加原有三客户端文件。
- 原有跟踪 dirty：`client/src/pages/novels/components/StructuredChapterDetailCard.tsx`、`StructuredChapterListCard.tsx`、`StructuredOutlineWorkspace.tsx`、`docs/handoffs/WORK_LEDGER.md`。全部保留，未纳入本阶段文档提交。
- 未跟踪的 `.codex-run/`、脚本、旧交接、媒体、probe DB、零散源码和稿件原样保留，不 `git add .`、不清理、不搬进新版。
- 新版 `D:/novel/ai-novelist`：`codex/planning-output-recovery`，HEAD `4d6e20621acac23b8d32c8c08d478c24a2047e9f`，6文件dirty（见第7节），本次只读核验，停止修改。
- 已核验监听：旧后端3000/PID33384、旧前端5190/PID26356；新后端8787/PID21116、新前端5173/PID3960。这仅证明监听，不证明业务健康、空闲或已加载当前代码；未重启、未调用可变状态接口。
- 对照旧网页使用 `D:/novel/.comparison/2026-10-10/old-test.db`，不是 `server/dev.db`；隔离首章在 `old-controlled-ch1.db`。新版原运行库为 `D:/novel/ai-novelist/server/data/novelist.db`。这些路径来自已核实对照记录，本次不更换数据源。
- 参考 Node24：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。默认 PATH 版本可能不同，运行前再查；不要用通用停服脚本同时杀两边。

## 3. 用户目标与不可破坏约束

稳定产出有意思、可由作者精修的小说原型，比完成一堆表格重要。小人物、细腻但不拖沓、情绪驱动行动、混合题材与奇遇自由都要保留。模型不背工具缺陷的锅；不换模型、关闭检查或扩字数掩盖问题。

保留编辑防丢稿、已认可写法、字数预算、候选原稿、写前检查及同卷最多三章/两轮修正边界。运行记录只读。历史“书稿不重要”不是删除数据库/密钥/写法的授权。

本次普通实施已获批准，真实模型验收仍需明确范围、预算、停止点；历史单章授权不能扩展为自动整本生成。旧版两份数据库及新版正文是证据，不继续修样稿来美化结果。

## 4. 关键时间线

1. 早期反复优化旧版，后尝试新版；用户不满意两者均反复卡点，要求同想法基线对照，随后叫停无边界修新版。
2. 冻结起点旧190f2b5c+既有dirty，新e842a2d6。旧同题一本，新同题重开两次，原始都0正文。不能称两轮完美配对A/B。
3. 新版三次修复2100645、e09c4d7、4d6e206后出首章；另有6文件未完成补丁已叫停。
4. 用户允许旧版一个最小引文反馈修复；隔离副本通过原有复核和单章主链保存首章，第二章未写。生产补丁提交8814525d。
5. 用户读后旧版“及格、可加工”，新版“不好看”；要求核对运行证据与中途修复再讨论。最终对照报告纠正旧版全部DeepSeek、早期新版只有2章等旧说法。
6. 用户批准以旧版创作能力为基础的核心重构；本次为新执行窗口准备分支和文档，不继续对照样本。

## 5. 已完成实现与本次改动

先前最小生产补丁只在 `server/src/prompting/prompts/novel/volume/evidence/planningPromiseEvidence.ts` 改进错误反馈：区分来源、引用准确原文，最多1200字符；没有放宽校验、改模型或加重试。测试及报告随8814525d固化。

本次仅新增方案、稳定架构决策、本快照，归档旧 CURRENT 并更新入口/长期上下文。没有修改应用源码、数据库、模型设置、服务或新版。已在新分支准备文档阶段提交；无push、无beta/main合并。

切分支前后原有diff导出为证据根目录的 `pre-core-refactor-20261011.patch` 和 `post-branch-20261011.patch`，SHA256均 `cff9f07557cf83e8d5389afe87f8ab0fc0d06d87a4bcbe6e580cab9aa82e5a07`。这是跟踪文件补丁，不是完整untracked备份；未跟踪内容保留原地。

## 6. 验证及实测证据

本次核验 Git、旧/新dirty、报告文件存在、监听端口、分支前后diff一致。文档阶段只核验链接和提交范围，不重复跑编译或模型。尚未做新窗口自动接手实测。

历史修复测试：旧planningPromiseContinuity 18/18、服务端tsc --noEmit通过，见仓库单章报告；新版各修复阶段195/196/198项为历史记录，不是今天全量通过。不能加总或冒充核心重构验收。

关键原始结果：旧书 `cmv2i1pvh000crcw0j9u771bl`，任务 `cmv2hz0yw0000rcw0dptw6ysb`，作业 `cmv2id02r00qircw0swrvilsb`，停在审查引文拼接调序，technical_failed/0 of 2，0正文。新版 `6f4f45c0-5199-4880-b228-7a15c712967a` 和 `ee3471f1-f490-4ed5-93e4-10aa38ad76c8` 都曾在第6步失败，前置分卷已有截断/缺字段。

旧版扩展在UTC 2026-10-11 04:01:59至04:03:59约120秒：review_existing复核既存候选 `cmv2idea500qlrcw04tqyfj2v`，不改候选/轮数；首章 `cmv2i48f300i5rcw0o149gv3z` 生成、保存、审校、一次修订、复核、保留原稿、事实提取完成。不是全书导演恢复，原网页库仍是旧停点。

- 旧正文2744字符/去空白2626，reviewed/needs_repair，pass=false；SHA256 `c7374ff06ce1c9ddb7f2149d0436940d440b3e466b06cba89fd6203456ec2d45`。
- 新正文3140字符/去空白2984/应用计数2510，revision0原稿保留；SHA256 `a2fb051631049026ab0267d27db9794789a64a35c3fc6b8d97edba1bb59085a3`。
- 旧主写deepseek-v4-flash/0.7/2800字/写法 `cmugh26y40000vkw0i94nzwam`（市井见微·细腻推进）。新版修复后deepseek-flash/写作0.85/不同写法及总篇幅，不是同参数模型排名。
- 原旧服务日志25响应为22 DeepSeek+3 MiniMax-M2.7-highspeed（payoff_ledger.sync），部分缺书ID；新版llm_attempt仅记录修复后10次，7成功3额度失败，不能横比成本。
- 旧受控扩展缺普通完整请求响应日志，不能逐字确定首次无效回答原因；不补跑凑证据。新第7步及正文可证思考耗尽，不能倒推缺完整响应的原第6步必是同因。

## 7. 已知问题与临时绕过

- 旧版审查会把首章无前文当不足证据、常规标点高等级、1—3章承诺提前到期送进修订；是待收敛机制，不再逐条打样本补丁。电动车异界到现代位置也有真连续性疑点。
- 新版近似词匹配误报伏笔，可能误导删钩子；用户点击过灵位牌“按第一章埋”，不要擅自恢复22章。
- 新版未完成6文件：`client/src/pages/StepWriting.tsx`、`WizardPage.tsx`，`server/src/prompts/registry.ts`，`server/src/writing/consistency.ts`、`contextBuilder.ts`、`writingService.ts`。不验收、不提交、不移植。
- 原 CURRENT 的“预先冻结就结构上不可能重复”未证实；作为历史归档，不能做方案前提。旧版已有审查前保存和近期规划，不重做已有机制。
- 旧网页无法直接看到隔离首章是预期数据隔离，不是丢稿；阅读导出文件，不覆盖原停点库。

## 8. 待执行与边界

| 优先级 | 任务/状态 | 依赖及验收 |
|---|---|---|
| P0 | 阶段2已批准未实现，单章可靠链 | 先读5个源码入口（第9节），画写入/恢复图，补离线故障测试；出稿后任何下游失败不重写，重复点击不双跑，人工修改不覆盖 |
| P1 | 阶段3已批准未实现，规划和质量/实际状态收敛 | 阶段2完成；统一合同与质量分流，不新增多层审查，不把计划当事实，状态同步失败可独立恢复 |
| P1 | 阶段4已批准目标但未运行，固定版本十章 | 阶段2/3验证；先明确真实运行预算，1/3/5/10章阅读；遇新卡点保留，不边补边算无干预成功 |
| 暂停 | 新版修复、旧样本续写、历史台账其他支线 | 历史待办保留但不自动恢复；新版仅作对照，阶段执行范围不能被旧报告扩大 |

每阶段独立提交与证据，版本目标为本功能分支，不新增语义版本。先稳定单章，再验证连续性，不做大范围目录搬家或UI重写。

## 9. 关键文件与产物

源码定位（仓库相对）：
- `server/src/services/novel/production/preparation/ChapterExecutionPreparationService.ts`
- `server/src/services/novel/runtime/ChapterRuntimeCoordinator.ts`
- `server/src/services/novel/runtime/ChapterPipelineRuntimeAdapter.ts`
- `server/src/services/novel/runtime/ChapterStreamGenerationOrchestrator.ts`
- `server/src/services/novel/runtime/chapterRuntimePipeline.ts`

本地私有证据根：`D:/novel/.comparison/2026-10-10/`。已确认以下文件存在，不上传数据库/日志/含用户输入的全量证据：
- `TWO_ROUNDS_FINAL_COMPARISON.md`、`two-rounds-audit.json`、`audit-two-rounds.cjs`：最新结论与只读审计。
- `ROUND2_COMPARISON.md`、`CONTROLLED_EXTENSION.md`：早期对照及扩展，按时序读，不覆盖旧结论。
- `baseline.json`、`old-working-tree.patch`、`old-baseline.db`、`new-baseline.db`：冻结起点。
- `old-test.db`、`old-before-minimal-repair.db`：旧原始停点；`old-controlled-ch1.db`：旧隔离成功单章；`new-before-repair.db`：新修复前。
- `old-chapter-01.md`、`new-chapter-01.md`：给用户阅读的两份正文。
- `old-controlled-ch1-result.json`、`controlled-verification.json`、`old-controlled-ch1.log`、`old-controlled-ch1.llm-repair.jsonl`：受控扩展；普通完整LLM日志不存在。
- `20261010-091759-old-server.llm.jsonl`：旧原始停点调用。新版调用在novelist.db的run_log/llm_attempt。
- `run-old-controlled-ch1.cjs`：已执行一次的隔离驱动，不再次运行。

长期理由见[生产链边界](../wiki/architecture/production-core-boundary.md)；旧台账 WORK_LEDGER 保留但不是当前自动待办。旧交接完整归档于 `2026-10-11_previous-current.md`。

## 10. 下一窗口启动顺序

1. 本地项目根选 `D:/novel/AI-Novel-Writing-Assistant`，不用新worktree，避免漏掉dirty。一个checkout只留一个写入窗口，本窗口交接后停止代码工作。
2. 完整读AGENTS → PROJECT_CONTEXT → CURRENT → 本快照 → 实施方案 → 两轮最终对照报告。
3. 核验root、branch、HEAD、status；汇报用户目标/真实状态/缺口/第一段范围。若见master，先查是不是父目录，不直接切master。
4. 读现有单章保存、任务恢复与状态写入代码，形成最小迁移点清单和故障注入测试。测试数据库隔离，不调用有副作用的状态GET作探测。
5. 进入已批准阶段2实施；不等待用户再描述整套历史，但不自动调用模型、恢复导演、改新版或切换运行库。

## 11. 风险与待确认

这是一条旧版基底上的渐进重构，不是已完成的新产品。十章可靠性和文学持续性仍未证实。阶段2审计后才能确定数据库字段需求；如需迁移先备份和验证恢复，不能reset。

当前服务监听不等于空闲；修改被watch的文件前检查运行中的写作任务，必要时协调有范围的停服。旧源码已经有状态服务和草稿保存，新增层必须证明消除了重复权威。单章生产核验不能当网页全书导演验收。

## 12. 新窗口开场提示

在 D:/novel/AI-Novel-Writing-Assistant 本地模式继续，分支 codex/production-core-refactor。按 AGENTS.md 读取 CURRENT 的最新交接和已批准核心重构方案，先核验分支、dirty与两版证据并汇报。随后实施阶段2单章可靠保存与恢复，先离线测试；保留旧版创作、写法、质量检查和防丢稿，新版不动，不自动调用模型或恢复旧导演。不要重新执行历史规划冻结实验，不要另建第三版GUI。
