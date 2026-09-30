# 小说通用质量优化、真实新书停点与人物情绪：完整窗口交接

核验自 **2026-09-30 13:17 UTC（纽约09:17 EDT）** 开始。本包继承[上次完整包](2026-09-29_0105Z_full_thread_handoff.md)，覆盖其后14个工程提交与当前用户实测。本窗口中途发生过上下文压缩；时间线已对照Git、观察文档、数据库和模型日志，不能视为聊天逐字副本。

## 1. 接手摘要

用户目标是让工具通用地写出有意思、可继续加工的小说，而不是每写一章就喊工程师修一次。先书级大底/世界边界/人物主线，再卷级推进，最后正文兑现。近期修复了规划循环、章节范围与入口、跨章重复、局部禁令扩大、回报持续延期；用户接受B短样本的实质推进方向。

最新书《外卖箱通武侠，我送一单得一门武功》**第1章已写完，用户评价“有点意思，有不小改进”**；目前停在第2章前规划审查。新要求特别强调**人物情绪**：恰当的情绪、有趣的情节、鲜活的人物、清晰的大底。不要把它压缩成“再优化文笔”或“多写情绪词”。

本轮用户只要求详细交接与同步记录，未要求在打包中恢复任务或改稿。下一窗口先只读复述：现稿已存在；当前错误已从第一章前Payoff引文错误变成第二章审查promiseChecks覆盖错误；第一章补写越过原职责是相关但不同的问题；情绪专项尚未实现。

## 2. 环境与唯一真源

- 唯一应用仓库 `D:/novel/AI-Novel-Writing-Assistant`。外层 `D:/novel` 分支不能用于判断应用状态。
- 分支 `codex/book-story-foundation`；本次文档前HEAD **`0aed0312a575d9054bd06c01492acfba88d30d93`**。tracked clean，随后仅做本包文档修改/提交；最终HEAD须用Git核验。没有push、beta合并或main晋级。
- 本地DB `D:/novel/AI-Novel-Writing-Assistant/server/dev.db`；本轮用Python SQLite `mode=ro`。小说及规划以数据库为准，`.codex-run`是证据副本，不能用旧快照回写覆盖现场。
- PowerShell。现成Node24：`C:/Users/lyaxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。默认Node25曾因better-sqlite ABI不匹配失败，不能当产品回归。测试环境 `SQLITE_ENABLE_WAL=false`；Python `C:/Python314/python.exe`，输出中文用 `PYTHONIOENCODING=utf-8`。
- 本地启动 `start-local.bat` 使用上述Node运行pnpm dev；停服务 `stop-local.bat`。仅关闭网页不是重启服务。本次没重启服务。不要为交接停止用户进程。
- desktop/package.json核验为 **0.4.28**，未做版本升级。项目更新说明继续日期格式。
- 未跟踪保留项：`.codex-run/`、`.playwright-cli/`、`WINDOW_HANDOFF_2026-06-28_v0320.md`、`seed-styles.bat`、`server/dev-probe-node25.db`、`start-local.bat`、`stop-local.bat`、`第1章重写.md`、`第8章（金庸风格）.md`、`第一章.md`。不要git add .、清理、stash或切分支。

### 当前书、任务与第一章

| 对象 | 现场核验 |
| --- | --- |
| 小说 | `cmunqtu1i000crow0t50zaw8b`，《外卖箱通武侠，我送一单得一门武功》 |
| 导演任务 | `cmunqrh820000row0hl6wwn2l`，auto_director；waiting_approval，step_review_required，pendingManualRecovery=1 |
| 显示 | currentStage=结构化大纲，currentItemLabel=规划修复等待确认；“上次模型调用的返回状态不确定，请确认后再追加修正，避免重复扣费。” |
| 手动工作区 | `cmunqz5lw015xrow0bzkfi47a`，manual_create，正在查看第1章执行面板；不是导演任务ID |
| 第一章 | `cmunqwrlc00t3row07pfqa9vi`，《古庙里弹出配送单》，4144原始字符，保存于2026-09-30T07:20:16.187Z |
| 第一章SHA256 | `a9c787430d852191e90b5c0e4bb33b4cc927e640fb323a7c83e3bbb380aad8d4` |
| 第二/三章 | `cmunqwrle00t4row0j1yi87ht` / `cmunqwrlf00t5row0i9uaqcl4`，正文均空 |
| 执行范围 | book / 全书，completionProfile目标80章；当前准备批次start1/end3，completed1/remaining2，不能把批次3章当整项任务只到3章 |
| 当前配置 | deepseek / deepseek-v4-flash；issuePolicy maxAutomaticRetries=1，来源global；其他偏好读当前seed，不把历史模型写成永久默认 |

## 3. 用户目标与不可破坏约束

稳定偏好已同步[PROJECT_CONTEXT](PROJECT_CONTEXT.md)。用户喜欢小人物讲宏大叙事，故事最终表达/终局选择要清楚；NPC要与主线和当前冲突有联系，各次回报与转折逐步抬升，允许讽刺、荒诞、搞笑、热血、泪目。细腻不等于重复解释和原地办事。跨时代穿插合法，但服从世界边界；当前新书现代开场的头盔/电动车不因旧样本穿帮意见就自动违规。

七题材：武侠、东方玄幻/修仙、都市异能、盗墓悬疑、风水民俗、科幻、日常装逼打脸。新增能力优先AI结构化理解和合同，不用剧情关键词路由或题材特判。

用户纠正过“人物不能凭空获得能力”：爽文允许直接金手指、突然觉醒、无代价赠予；规则授权即可，不强制训练、牺牲或长铺垫。已确认本书限制仍须遵守。人格/关系变化与力量赠予不能混为一谈。质量计划中旧“例外有成本”等措辞本轮已同步纠正，避免下窗口重新施加已撤回规则。

数据保护、规划门禁与正文质量债、只读运行记录、Prompt Registry、分支/发布/wiki/阶段提交均依磁盘AGENTS。已写正文不可被为通过规划而静默重置。用户认可第一章的进步，要保护这部分价值。

## 4. 关键进程时间线

### 继承历史（详证在旧完整包，不自动恢复旧样本）

- 早期厨神、打捞、矿区用于暴露因果、状态与规划审查问题。矿区8轮反复后用户明确停止，第9轮/第2章待办取消，保留稿件和失败证据。
- 0ef895af/d1d59861完善建议合同、已采用状态、全部裁决历史及新阻塞证据；旧快照记147pass/2skip后补2项独立测试，阶段149独立通过/2skip。不是本轮重跑结果。
- 《差评变强：外卖小哥闯金庸》三章完成，用户觉得情节进步。旧全文观察保留重复反应、工资口径、道具、未交付却送达和第三章4826字符等问题。其导演不等于后两本书。

### 本窗口工程与用户验收（Git顺序，提交时间的原始-05不能直接当纽约EDT）

| 提交 | 完成及限制 |
| --- | --- |
| db49bce0 | 书级大底、世界边界、人物自身目标与主线联系、视角/推进贯穿候选→宏观→卷章→写作；AI给宏观阶段，旧书不伪造升级。87pass/2skip，文学与七题材盲评未完成 |
| 4a317873 | 第3章“油纸包消失”与箱体残痕修正：显式revise映射、正文证据；263测试通过，未自动批准旧候选 |
| d5d479e1 | 当前候选与拒收历史区分，正文与摘要证据区分；119通过 |
| fdb7db9c | 当前节奏板前置，历史只作审计，解析失败正确分类；68通过 |
| de75eedb | 方案独立AI语义核验，来源与执行内容绑定；获取最多两次调用。48服务+8前端静态检查；最初只替身验证 |
| 0c9c02fa | 独立核验支持真实第2章正文，同源完整凭据可复验；53通过 |
| 321e1655 | 义务修订累计账本、幂等及A→B→C，避免重复修订源引用不存在；250独立测试；真实缺映射仍拒绝 |
| 28f3ecf5 | 两轮建议都隔离旧稿、稳定目录与逐问题评估；三次真实获取共6调用，前两失败第三ready/review_existing；65通过。该轮没有代用户采用/写正文 |
| 47ae8b27 | 用户后来完成第3章4230字符；修续写仍1—3的范围问题，接管默认下一章，已授权4—4不被sample3覆盖；20测试及编译 |
| 29fd8956 | 第4章重复买饼打听看箱且重复花六文，修职责/正文为早餐后无钱→接单→到店交药谈条件；3378→2538字符，前3章哈希不变。通用事件/认知/行动承接审查，160pass/2skip。用户“至少情节合理了” |
| 19337c3a | 第5章细化修当前候选审查、局部复核、背景误升义务、单章原子提交与客户端重复PUT；131pass/2skip；正常API实测成功，前4及6—8字段不变，5章正文当时空 |
| 4d2f800a | 显露生成本章正文/继续写作入口，避免误点新建空白章；没有重造后端。误建空白第9章保留 |
| b1c15506 | 局部禁令不摊平、逾期不固定pressure、秘密名不硬盖forbid，AI回报决定持久化；授权即时金手指统一。139pass/2skip，匿名即时奖励实测；A/B对照仍有失败历史 |
| 0aed0312 | 新书首章前拼接引文错误进入一次语义纠错，引用不可摘要；初次真实回放又编第4章，补反馈后第二轮通过；74pass/2skip。该轮只读，无代写/恢复 |

用户随后自行恢复新书，日志首章planner v4于07:18:22Z正常返回，首章07:20:16保存。当前停点发生在第2章规划，与0aed0312所修的首章前错误不同。

### 外部项目借鉴

用户提供 PenglongHuang/chinese-novelist-skill、jingtai123/Novel-Control-Station-Skill。已静态阅读公开README/SKILL/参考文件，未fork、安装、运行或复制源代码；本轮不再次联网。[取舍全文](../plans/novel-skill-reference-review.md)：参考分层意图、单书文风基准、时代影响落到个人、人物有意义回归、关系图按需召回、主题由选择表达；不照搬章章爽/固定句长与对话比例，不把文件字数检查宣传成可靠语义审查。

## 5. 已完成实现

关键源代码与稳定说明：

- `shared/types/novel/bookStoryFoundation.ts`；[book-story-foundation wiki](../wiki/workflows/book-story-foundation.md)：书级结构贯通，非全书质量保证。
- `server/src/services/novel/volume/planningRepair/`与`director/recovery/planningRepair/advice/semanticReview/`：计划修正、建议、证据、采用与核验。
- `server/src/services/novel/volume/chapterDetail/ChapterDetailCommitService.ts`；[单章细化一致性](../wiki/workflows/chapter-refinement-consistency.md)。
- [跨章推进规则](../wiki/workflows/narrative-progression-review.md)：重复事件/人物认知、行动目标承接；保留细腻与慢热。
- `chapterLayeredContext.ts`、`context/chapterContextBlocks.ts`、`workbench/auditPreviewContext.ts`：场景禁令保留sceneKey；写作/续写/审查/修复一致，不去掉局部限制。
- `shared/types/novel/payoffPlanning.ts`、`server/src/services/planner/payoff/{index,context}.ts`及README：AI决定、当前引文、实际未来章、剩余义务、版本/hash新鲜度。缺候选/虚构引用不默认通过；有效requires_replan不因重试被改判。
- `PlannerService.ts`与`plannerLlm.ts`、`plannerPlan.prompts.ts`：专属不可摘要证据块，正式Prompt postValidate与最终保存前同源校验。
- `ContextAssemblyService.ts`与`GenerationContextAssembler.ts`：消费当前决策，不机械把待兑变pressure或秘密重合变forbid；来源保密与拿奖励分开。
- `context/capabilityAuthorization.ts`及`acceptance/actionStateEvidence.ts`：设定授权的即时力量合法，同句授予与使用可成立；未授权解局仍不合法。
- 当前重要Prompt版本：planner.chapter.plan v4、writer v12、chapter_task_sheet_quality v16、acceptance_assessment v6、review.patch v5。详查registry，不沿用旧交接的v10等。

本轮打包只改文档、质量计划的历史措辞与台账，没有新增情绪生成/审查算法，也没有修当前第2章。

## 6. 验证与实测结果

### 可复用的已完成验证

- b1c15506：shared编译、server编译、client类型检查；14文件141项=139pass/2skip。`.codex-run/reader-pull-comparison/tests-final.log`、`build-server.log`、`typecheck-client.log`。早期dist EPERM最终完整编译成功，不能沿旧记录说仍无法编译。
- 0aed0312：server完整编译，7文件76项=74pass/2skip；`.codex-run/payoff-real-failure/build-final.log`、`tests-final.log`。仅服务端变化，没重跑无关客户端检查。
- 标准运行式：指定Node24跑`server/node_modules/typescript/bin/tsc -p server/tsconfig.json`；测试`--test`选择对应文件，先置`SQLITE_ENABLE_WAL=false`。本轮文档没有复跑这些检查，没有浏览器/UI验收。
- 旧治理测试另报ComicFactService两处内联prompt，相关文件当时相对HEAD未改；未纳入“全部通过”。更早全量旧契约/资源上限失败亦保留，不能声称完整仓库测试全绿。

### A/B证据

`.codex-run/reader-pull-comparison/`：A仅改写法保持原第5章结果，B重构推进，固定第四章末起点、模型DeepSeek v4-flash、writer v12、目标1200—1500中文字符。A首稿新增人物标记等功能，修后仍待签收；B先耗尽4500输出预算无正文，再写成欠免费跑腿，再半付报酬+箱子记线索，最后才完整交付/收款。B供阅读版人工只改两处“药价/药款”为跑腿酬金，原模型稿和失败稿留存。

用户明确B更好。A约1353汉字，B原稿约1219汉字；B更多人工定点反馈，非等调用次数/盲测，不能归功为自动导演一次成功。原《外卖箱通金庸》9条章节记录比对未变。

### 首章前真实回放

`.codex-run/payoff-real-failure/`保留真实失败request/response、fixture、replay.log、replay-final.log和结果。首轮拼接引文问题消失但引用不存在第4章，语义重试未改；补充反馈后第二轮5项通过（2seed、3out_of_scope），无重试，未产生正文或恢复任务。用户随后首章实际成功是新增证据，仍不是后续全链保证。

### 本轮最新只读验证

`.codex-run/handoff-20260930/`：state.json、jobs.json、director-seed.json、planning-repair-summary.json、chapter-1.txt、chapter1-call-index.json及抽取响应。全文读取，不以模型分数替代判断。

当前成功首章job=`cmunrx02s001tkww0ycjezynv`；第二章失败job=`cmunrzon00056kww056vtteqi`，07:21:29Z failed，无owner/lease。旧首章job=`cmunqws5k0113row0etko77r9`仍queued但pendingManualRecovery=1，无owner/lease，带旧Payoff错误；这不是当前活动生成。approve_gate命令`cmunrwzco0000kww0c4nzmr3v` succeeded。seed内pipelineStatus仍running，与真实job状态有投影残留，下一窗口不能只读这个字段。

## 7. 已知问题与临时绕过

### 当前停顿：待修，证据充分但语义根因尚未全部算清

planningRepair：chapterOrder2，rounds0/max2，phase uncertain，candidateVersionId=`cmuns03se0059kww0kx4318nm`；pendingOperation `review:cmunqtu1i000crow0t50zaw8b-chapter-3f55c198-2069-4aa2-9903-aec653ba3f48`，startedAt07:20:36.409Z。technicalError：`promiseChecks must cover every selected source exactly once; absent sources must not be invented.`

日志 `.logs/2026-09-30/2026-09-30T02-08-33-dev.llm.jsonl`（**文件名不是每条事件时间**）。请求/响应：`stream-1790752836595-12`、`stream-1790752852148-13`、`stream-1790752871531-14`；均chapter_task_sheet_quality v16，响应stop，promiseChecks分别7/7/6项。最后一次包含sellingPoint、coreConflict、protagonistPath、distinctiveEngine、earlyPayoff和openingChain[0]。须与 `selectedPlanningPromiseIds(direction, chapterOrder)` 的真实选源逐项比对，不能简单删检查或补假“通过”。

第二/三次已经报告`scene1_repeats_completed_backdoor_pickup`，指出第1章已后门取药，第2章不得重演。故不能只修清单让该真实问题丢失。`PlanningRepairCoordinator.ts`持久pendingOperation会转uncertain；当前有正常模型返回证据，需区分“返回后合同失败”与“网络是否返回未知”。本轮没修、没清状态、没加轮次。

### 第一章补写越界与情绪

[本轮完整观察](../evals/framework-quality/observations/2026-09-30-new-book-chapter-one-emotion.md)。两次writer v12：`stream-1790752702893-2` 2410字符，`stream-1790752716115-3` 1732字符；两段加两个换行逐字等于保存4144。第一章合同只允许穿越、接单、找药铺，禁止取药成功；后段已赊药、逃追踪、看到目的地。应追补写/长度补偿/验收接受路径，不直接认定规划本身授权了这些推进。目标2800/hardMax3500与原始字符口径需核对。

文学上开头疲惫窝火鲜明，后段急迫较单调，NPC工具性偏强。用户要求情绪鲜活不意味着所有人必须暴怒大哭；设计应从角色利益、关系及处境触发，有压抑、伪装和差异反应。此项仅记录目标及观察，未实施。

其他历史问题：旧5—8章仍寡淡、约1.56万字符推进薄；语义引用存在不保证推理正确；专属requires_replan自动重排恢复面板未补；台账/hash不等于独立文学评审。无绕过关闭审查或手改DB。

## 8. 未执行与待执行任务

详见[WORK_LEDGER](WORK_LEDGER.md)，每项状态/验收/授权独立保留。下一优先序建议：

1. **当前停点（未修）**：只读复现来源覆盖清单，检查模型返回/校验/pendingOperation如何持久化；修通用反馈及恢复闭环，保证重复取药的真问题仍进入规划修复。明确测试后再经源工作区恢复，不直接改DB。
2. **补写职责（未定位根因）**：追第二次writer输入与字数预算、章末边界、审查/修复/质量债；接受“用户喜欢更实在推进”的同时，让后章从已写结果开始，不能重复或用强制缩回全部进展制造新寡淡。
3. **情绪与鲜活（新目标，未实现）**：先盘点现有emotionBeat/emotionalShift、角色心理/对话快照、写法引擎，不机械追加字段。比较同剧情样本，验收情绪对决策、语言和关系的作用，而非情绪词数量/固定曲线。适用七题材，保留细腻且不增加碎念。
4. **卷级/长篇（部分基础、专项未做）**：多线因果、对手行动、人物回归、按需事实召回、单书文风、终局大底验收；七题材14人工候选无盲评成绩，前三章不能证明全书质量。
5. **历史债/发布（延后）**：prose_negative_flip误报、旧全量测试契约、状态残留；自然复现再定位。push/beta/main/打包/升级没有授权，本轮不做。

## 9. 关键文件与产物索引

- 起点：`D:/novel/AI-Novel-Writing-Assistant/AGENTS.md` → [PROJECT_CONTEXT](PROJECT_CONTEXT.md) → [CURRENT](CURRENT.md) → 本包 → [WORK_LEDGER](WORK_LEDGER.md)。
- 旧完整包及其索引保留矿区八轮、打捞/厨神、前阶段备份与验证债；旧恢复指令不自动继承。
- 质量计划 `docs/plans/novel-framework-quality-program.md`、参考研究 `novel-skill-reference-review.md`、评测 `docs/evals/framework-quality/book-foundation-{evaluation.md,cases.v1.json}`。
- 逐阶段观察（均在 `docs/evals/framework-quality/observations/`）：`2026-09-28-book-foundation-engineering.md`、`2026-09-29-delivery-box-planning-block.md`、`2026-09-29-planning-advice-verification.md`、`2026-09-29-chapter-four-continuation.md`、`2026-09-29-narrative-progression.md`、`2026-09-29-chapter-five-refinement.md`、`2026-09-30-reader-pull-comparison.md`、`2026-09-30-new-book-payoff-citation-recovery.md`、本轮第一章情绪观察。
- 本地对照稿 `D:/novel/AI-Novel-Writing-Assistant/.codex-run/reader-pull-comparison/样本A-复核稿.md`、`样本B-供阅读.md`、`验证说明.md`。该目录未入Git，不会自动出现在新worktree，下一窗口应使用同checkout。
- 新停点校验：`server/src/prompting/prompts/novel/volume/evidence/planningPromiseEvidence.ts`；`shared/types/novel/planningPromises.ts`；`PlanningRepairCoordinator.ts`及Store；具体请求见本轮快照目录。只抽所需日志，勿输出密钥或整个配置。

## 10. 下一窗口启动顺序

1. 同一目录完整读磁盘AGENTS、PROJECT_CONTEXT、CURRENT、本包和台账；读第一章观察，需要文学判断再读DB完整正文。
2. 核对root/branch/HEAD/status；文档提交会晚于0aed0312。不要切回旧CURRENT所写的codex/fix-task-cleanup-personal-style或外层master。
3. SQLite只读核查本书第一章hash、二三章内容、导演与manual workspace、实际job/command、planningRepair；若用户已操作则以新现场为准。
4. 向用户复述：B方向认可、首章真实有改善、情绪新要求、当前第2章promiseChecks卡点、两段拼接越界线索、没有替他续写/改稿。
5. 根据当时最新请求确定有界行动。不要把本包待办当自动模型调用或恢复授权；不要在交接期间POST恢复、运行旧付费脚本、创建新书/线程或删除空白第9章。

## 11. 待确认事项与风险

- **交接就绪，运行任务未解决**：无本代理在途调用或事务；用户任务保持人工确认。旧queued job挂起无租约，不能写成“所有任务均完成/没有记录”。
- 当前新书全书目标80章，准备批次1—3不是整体授权边界。用户是否先缩至3章验收尚无新明确决定，不能擅改范围。
- 用户已经允许本新书同范围只读DeepSeek回放“次数不限制”；自动审批此前两次拒绝均已由追加授权解决。但不等于无限生成/自动恢复/公开上传。通过就停，本轮未调用。
- 个人记忆辅助记录曾仍指旧包；本包是项目文件，不承诺Codex内置记忆自动同步。没有修改个人memory registry，也未新开窗口验证自动读取。
- 模型调用成功、有效规划、正文保存、文学好看是四层证据。情绪需求尚不能标为“工具已支持到位”；最重要的是保留用户认可的进步同时修通用缺陷。
- 本轮文档同步有长期价值，更新长期上下文、台账、观察及质量计划；没有运行时功能新增，因此按readme-release-updater跳过新的README/发布说明噪音条目。此前代码发布说明不回滚。

## 12. 可直接发送给新窗口的开场提示

> 接手 D:\novel\AI-Novel-Writing-Assistant。完整读取磁盘AGENTS.md、docs/handoffs/PROJECT_CONTEXT.md、CURRENT.md、最新完整交接包及WORK_LEDGER.md，先只读核对Git和当前新书状态并复述。新书《外卖箱通武侠，我送一单得一门武功》第一章我认可有明显进步，但要求情绪恰当、人物鲜活；目前停在第二章规划审查，错误已不是旧Payoff引用，而是promiseChecks来源覆盖。保留第一章与全部历史证据，注意两次写手输出拼接导致取药事件提前的线索。先说清接住的结论、未完成事项和建议的下一步，不自动恢复导演、改稿、生成、付费回放、切分支或push；按我接着给的指令推进。
