# 本地优化工作台账

更新：2026-10-01。本表记录状态，不授权自动执行。交接起点及任务标识以 [CURRENT](CURRENT.md) 链接的快照为准；后续现场见本表关联观察记录，稳定偏好在 [PROJECT_CONTEXT](PROJECT_CONTEXT.md)。历史验证数字不可跨阶段相加。

后续进展：《外卖箱通武侠，我送一单得一门武功》后来完成三章，用户认可紧凑度但指出二三章重复，随后授权三项通用修复。该书替代导演已完成、原导演已取消，Q09停点是历史；旧 promiseChecks 根因不因此销账。用户允许换书，不再围绕这本改稿。之后新书《外卖箱闯金庸》也有三章正文，但第三章来自单章生成、仍needs_repair，当前导演waiting_approval，并未完成恢复验收。最新全文、运行及隔离复现见[三章核验](../evals/framework-quality/observations/2026-10-01-chapter-three-quality-and-tool-audit.md)。Q11情绪专项仍未实施。

**2026-10-01 新一轮（工具优化目标任务书）**：用户确认长期方向是多题材小说创作并投稿/改编漫剧，问题根因在工具而非模型，要求有序推进并留可查记录。已建立活跃任务书 [工具优化目标任务书](../plans/tool-improvement-roadmap.md)，并完成 P1 前两步：**Q26 已修并全量校验（166/166 loader 版本一致）**、**Q24 已修并隔离验证（12/12）**。两步均通过服务端编译，尚未真实导演验收，也尚未本地提交。下一步 P1-C 由用户新开一本书跑第3→4章链路验收。

| 编号 | 事项与状态 | 已完成及证据 | 下一步与验收边界 |
| --- | --- | --- | --- |
| Q01 | 书级大底、世界边界、人物主线：工程完成，文学未全面验收 | db49bce0；book-story-foundation wiki；七题材14候选为人工开发材料 | 多题材真实构思/留出盲评；字段存在不等于大底好。不得强制所有题材用同一情节模板 |
| Q02 | 第3章规划/建议修复：多轮工程修复，旧书后来完成 | 4a317873—28f3ecf5；当前候选隔离、准确正文、独立核验、义务修订幂等与历史 | 泛化质量仍需自然复现；不重跑旧候选，不把两轮失败隐去 |
| Q03 | 下一章范围/入口：工程完成，用户跑过5—8章 | 47ae8b27、4d2f800a；正文生成与新增空白章区分 | 保留误建空白第9章，不自动删除；继续观察范围/路由投影 |
| Q04 | 第4章原地踏步与跨章承接：通用规则及一次实稿修订完成 | 29fd8956；3378→2538字符，前3章不变；用户“至少情节合理了” | 跨章净变化、重复事件/认知、前章行动兑现要继续验收，不能认定寡淡已解决 |
| Q05 | 第5章连续细化：工程与真实API验证完成 | 19337c3a；同候选复核、单章原子保存、背景不自动变义务 | 不自动重写已完成规划；UI总体可用性仍由用户观察 |
| Q06 | 场景禁令扩大/回报持续延期：工程完成、部分实测 | b1c15506；139通过2跳过；即时奖励匿名实测；局部禁止保留sceneKey，AI回报决定 | 旧5—8章没有被改写；无需训练/代价的授权金手指合法。全书持续兑现尚未验收 |
| Q07 | A/B阅读对照：完成，用户明确B更好 | reader-pull-comparison观察；B交付拿钱，A只改善句子。B更多迭代及两处人工术语校对均留档 | B方向进入后续质量目标，不能宣称自动单轮质量达到样本；不覆盖旧书 |
| Q08 | 新书第一章前引用停顿：修复完成，并被随后用户实际续写覆盖 | 0aed0312；74通过2跳过；第二轮真实只读回放通过；正式日志第一章planner v4随后成功 | 旧Payoff错误不再是当前停点；旧queued job仍残留，禁止直接清库 |
| Q09 | 新书第一章后/第2章前停顿：只读确认，未修 | promiseChecks覆盖校验失败；planningRepair uncertain/0 of2；3次模型stop响应在本机日志 | 先比对实际选定来源与返回清单，修严格校验反馈/恢复语义，保留真重复问题；原稿及已写章保护，不能清pending绕过 |
| Q10 | 第一章补写越过职责：证据确认，未定位实现根因 | 两次writer输出2410+1732+2换行=4144保存正文；合同禁止取药但后段取药 | 追补写目标/合同注入、验收修复及接受质量债；不得删掉用户认可的推进，邻章应承接事实而非重演 |
| Q11 | 情绪与人物鲜活：**情绪规则已覆盖写作、验收、审查、修复四条链路** | `context/emotionPresence.ts` 定义 `CHAPTER_EMOTION_RULES`（写作向4条）与 `CHAPTER_EMOTION_AUDIT_RULES`（审查向4条）；注入 `chapterWriter.prompts.ts`（【情绪落地要求】）、`chapterAcceptance.prompts.ts`（【情绪落地审查】）、`review.prompts.ts` 两个入口（chapterReviewPrompt【情绪落地审查】/ chapterRepairPrompt【情绪落地要求】）。服务端编译通过；离线 17/17 通过（模块、四条 prompt 渲染、规则逐条出现、无题材硬编码、克制情绪获准、acceptance 前后章推进审查无回归）。证据 `.codex-run/tool-roadmap-20261001/q11-verify.log` | 规则层已完备；真实效果需用户读稿判断，不以规则存在代替文学验收 |
| Q12 | 卷级多线因果、长线人物/关系回归、按需事实召回、单书文风校准：部分既有基础，专项未完成 | 两参考项目静态研究及质量计划 | 先书→卷→正文，AI优先，跨七题材；需用户安排下一阶段，不机械导入外部Skill |
| Q13 | 长篇质量验收：未做 | 开篇和局部片段证据仅支持局部进步 | 中段、高潮、终局、多读者盲评、误报漏检、成本延时；不把模型高分当好故事 |
| Q14 | 历史误报/验证债：未全部解决 | prose_negative_flip固定句式；旧全量测试契约/资源上限；comic内联prompt治理违规（`prompting-governance.test.js` 一项失败，`ComicFactService.ts:39/48`）；**新增确认**：`novelWorkflowRuntime.test.js` 的 "stale running auto director healing does not recurse through markTaskFailed" 失败，根因是该测试只 stub 了 `novelWorkflowTask.findUnique`，但 `healStaleAutoDirectorRunningTask`→`updateWorkflowTaskWithNotifications`→`updateWorkflowTaskWithPlanningRepairGuard` 调用的是 `findUniqueOrThrow`，未被 stub 覆盖。该守卫引入于 `6555dbcd`，早于本轮；本轮提交未触及 `healStaleDirectorRunning`/`updateWorkflowTaskWithNotifications`（已用 `git diff 94315b5d..HEAD` 核实为空）。**是预先存在的测试缺陷，不是本轮回归** | 各自先复现基线再修；不扩大为当前阻塞，不声称全套全绿。修法：测试补 stub `findUniqueOrThrow`，或让守卫在该路径改用 `findUnique`。**另一项**：`planningRepairPausedRecovery.test.js` 与 `planningRepairAdvice.test.js` 各 1 项失败，均为 `Unmocked dependency: ../pipelinePause`（该导入由 `94315b5d` 引入，测试 harness 未补 mock）；与 Q27 修复无关，本轮未触碰这两个文件。**第三项（本轮新发现，已用对照实验证明为预先存在）**：`payoffLedgerShared.test.js` 的 "buildPayoffLedgerResponse orders items by risk and computes summary counts" 在 line 182 断言 `pendingCount===1` 实得 2。对照实验：把 HEAD 改动前的该模块编译产物换回 dist 后仍为 8 通过/1 失败，与改动后完全一致 → **非本轮引入**。现象指向 `createLedgerItem({currentStatus:"overdue"})` 的条目被计入 pending（疑似 `hasExplicitPayoffWindow` 缺失时被降级），待下轮定位 |
| Q15 | 《女尊：流放矿区，下跪续命》：用户停止 | 历史8轮修复及停止决定保留在旧完整包 | 不恢复第9轮，不付费重试，不删除数据。另两历史样本厨神/打捞不自动续写 |
| Q16 | 发布：未执行 | 本地feature分支，desktop0.4.28，未push/beta/main晋级 | 依明确发布请求和AGENTS流程；不因交接发布或升级 |
| Q17 | 窗口连续性：完整更新，个人记忆注记已获授权 | PROJECT_CONTEXT、CURRENT、Oct1完整快照、台账、最新全文观察与个人记忆小型入口注记；继承/五阶段/新缺陷分层 | 新窗口同checkout只读复述；未实测自动读取，不承诺聊天逐字或注记自动注入 |
| Q18 | 自动续写跨章重复：三项通用修复工程完成，样本局部验证 | 235ee704；自动入口复核前章事实、完整问题及指令、来源一致性与逐问题补丁回执；共享/服务编译、113聚焦+3独立Store通过。最新样本二三章不重演、审查15/15引文定位正确 | 文学/语义仍漏检；首章候选被选、二章original_retained，不能把patched回执当已写正文修复。第三章活跃v3/未提交v5需新事实重新取证；旧Q09/Q10/Q11不销账 |
| Q19 | 新书技术暂停后恢复入口缺失：工程完成，用户已操作建议入口 | 《外卖箱闯金庸》前两章完成，第三章规划复核引用旧候选被拒；technical_failed遗漏暂停归类、running+pending隐藏按钮、挂起job被误认活跃均修复；80项回归、共享/服务端编译及前端类型检查通过，见[恢复入口记录](../evals/framework-quality/observations/2026-09-30-planning-recovery-entry.md) | 用户刷新后获取建议到达模型核验，但被Q20合同错误拒收；保留第一章正向反馈及正文，不宣称规划或恢复已通过 |
| Q20 | 修复建议最终方案与核验覆盖不一致：工程完成，真实建议已ready并被用户采用 | 新合同每个最终方案内嵌check，76项回归与编译通过；Oct1日志v11/v6正常stop，建议cf3ccb90-7964-4cb1-9968-3bf5d18aa78f ready且原授权已保存，见[建议核验记录](../evals/framework-quality/observations/2026-09-30-advice-review-coverage.md)与Q21现场 | 一次真实建议成功不等于规划/正文验收完成；旧不合格结果不能删项放行，人物情绪专项仍未实施 |
| Q21 | 规划恢复无推进却显示执行：工程完成，用户继续已越过原门禁 | cd2dbd09；原授权误到production_experience_required、GET用人工挂起job覆盖停点已修；119回归+编译，见[运行停顿记录](../evals/framework-quality/observations/2026-10-01-director-resume-phantom-running.md)。08:56新job越过旧门禁后遇Q22 | 用户认可二章“可圈可点”。最新三章已由单章入口生成，导演仍等确认；新Q24是旧步骤投影路径，不冒充原job修复无效或全链通过 |
| Q22 | 正常进度误报归属：工程完成，导演真实恢复仍待验收 | 94315b5d；归属与精确CAS分离，类型化规划异常、候选/预算暂停、旧监督及首次登记保护；编译+258独立回归（212复用同轮未变覆盖），见[执行归属记录](../evals/framework-quality/observations/2026-10-01-planning-repair-execution-ownership.md) | 最新第三章有正文，但POST单章生成，不是v5提交/导演恢复证据；当前waiting_approval、pending=0、原授权/1 of2/v5保留。先新事实取证，不能覆盖已写章或清预算 |
| Q23 | 新书三章质量与实际生成：全文核验完成，局部接收仍有质量债 | 第一/二章2901/2556 approved，三章3529 drafted/needs_repair；交药、拿甲、新单有进展，无二三章重复赶路。writer v12/acceptance v7各一次，无第三章patch；timeline抽取degraded | 保存不等于批准/事实资产齐全；不自动改书/续写。时间、回忆、说话人、物件及情绪问题见最新观察，模型83分不作文学评级 |
| Q24 | 旧等待步骤覆盖新执行：**已修，隔离验证通过** | `healRuntimeGateApprovalState` 增加三重通用保护：以最新 `run_resumed` 事件为执行代次新鲜度边界（旧 step 不再产生恢复决定）、本任务活跃 `DirectorRuntimeExecution` 判定、写入前重读软 CAS。服务编译通过；离线隔离 12/12 通过（旧步骤零写入、合法步骤仍可 heal、并发批准拦截、活跃命令/执行/pendingManualRecovery/非running 各自拦截）。证据 `.codex-run/tool-roadmap-20261001/` | 现场逐写因果仍缺 trace；不宣称已捕获那一次因果。真实全链由新书第3→4章验收。禁止直接改DB、清pending或忽略全部等待 |
| Q25 | 语义结论/修复前提核对：**两阶段修复完成** | **第一阶段**（b0563f7b）：`progressionEvidence.ts` 新增 `progressed_but_consequence_denied` 门禁，8/8 隔离验证通过。**第二阶段**（本次）：`chapterPatchRepair.prompts.ts` 新增规则 4f：解决 `action_state_unearned_*`/`action_state_contradicted_*` 类问题时，补丁必须先核查并建立行动前提（持有/在场/知晓），不能只替换行动结果；无法定位前提时输出 `plan_conflict`。服务端编译通过；8/8 离线验证通过（4f 渲染/action_state 词/前提词/plan_conflict/无题材硬编码/4e 无回归）。证据 `.codex-run/tool-roadmap-20261001/q25-2-verify.log` | `actionStateEvidence.ts` 已有完整结构化前提检查（`transitionStatus`/`enablingTransitionRequired`/时序验证），acceptance 层已将失败投影为 `blockingIssues`。4f 确保修复侧遵守同一约束。深层语义质量（LLM 实际执行力）需通过真实跑书验证 |
| Q26 | Prompt加载目录版本声明漂移：**已修，全量校验通过** | loader 声明 `novel.chapter.acceptance_assessment@v7`、`novel.review.patch@v6`（原 v6/v5），与资产实际版本一致。服务编译通过；离线遍历全部 166 条 loader entry 逐条比对声明与资产 `version`：0 错位、0 加载失败，两个焦点键经 `getRegisteredPromptAsset(id, version)` 正确解析。证据 `.codex-run/tool-roadmap-20261001/` | `prompting-governance.test.js` 仍有 `ComicFactService.ts:39/48` 内联 prompt 一项失败，属 Q14 历史债，本次未触碰该文件 |
| Q27 | **用户实跑新书被 CAS 误判阻断：已修，已确证复现** | 用户新开《外卖送到墓门口》自动执行，**每章交接时** ch2/ch3 批次以 `The task changed concurrently; reload planning repair before continuing.` 失败（job `cmupq16ea017jt8w0g3c605mn` 16:00:59、`cmupqf1yo01fit8w06dzydq2m` 16:11:47；task `cmuppnul40001t8w0bgbw7qev` → failed/quality_repair/chapter_batch_ready）。根因：`PlanningRepairStore.casSeed` 用**事务较早读取的旧行**（`owner(task)` 原始 status + 逐字节 `seedPayloadJson`）做精确 CAS，而 `syncActiveAutoDirectorAutoExecutionTaskState`（reconciliation:206-223，由 `healAutoDirectorTaskState` → `novelCoreCrudService:282` 等读写路径触发）会在修复窗口内写入 queued↔running 投影并重写 seed，于是正常章节交接被判成并发编辑。读取侧 `current()`（:910-924）本就用 `executionIdentity`+`repairSeedAuthority` 宽容判定，**两侧不一致**。修复：`casSeed` 改为事务内重读最新行 → 同样两个权威比较 → 将调用方意图 rebase 到最新种子（保留并发心跳）→ 以最新行原始status与完整seed做精确CAS（遵守 wiki 规则，未放宽条件）。服务编译通过；`planningRepairStore.test.js` **122/122**（新增 `raceTaskRead` 钩子：1 个正例 + 5 个保护反例：暂停/取消/换执行代次/人工暂停/受保护输入 仍拒绝）。**已确证可复现**：临时恢复旧式严格基准后该正例失败（121/122），证明测试非空转。证据 `.codex-run/cas-race-20261001/` | 与本轮 Q24 改动无关：Q24 只让 `healRuntimeGateApprovalState` **写得更少**，且 `git diff 94315b5d` 未触及 `healStaleAutoDirectorRunningTask`/`syncActiveAutoDirectorAutoExecutionTaskState`/`casSeed`。历史日志确认该错误此前从未出现，属新暴露的既有竞态。用户现场仍 failed，需从源页继续（不代其操作） |
| Q30 | **章级 requiredElements（阶段B）：schema/prompt 已加，但落库前被丢弃，当前空转** | 目标对齐竞品：每章一份 3-8 条"正文里能被看见的具体事件"清单，作为推进感与验收锚点。已做：`chapterDetailSchemas.ts` 两处 schema 加 `requiredElements`（3-8 条，≤160 字）与别名映射；`chapter_task_sheet` v8→v9、`chapter_execution_contract` v9→v10（loader 与测试同步）；prompt 明确禁止主题式写法。**⚠️ 核查发现空转**：`chapterExecutionContractGeneration.ts` 新生成路径（约 207-232 行）的 `candidate` 逐字段列举且无 `requiredElements`，模型产出后即被丢弃、从未落库；复用路径（约 148-161 行）同样缺失。**下一轮先修此处**：①candidate 加字段并在两条路径填值；②确定持久化槽位（`requiredElements` 目前不存在于 shared 类型，需确认 `serializeChapterScenePlan`/`ChapterScenePlan` 有无位置）；③shared 类型加投影；④接到 `chapterLayeredContext.ts:239-242` 的 `mustAdvance`（经 `:411` 成为 writer 的 `mustHitNow`）；⑤验收逐项核对，出口为 warning/质量债不阻断 | 教训：**只验证 schema 与 prompt 文本不算完成，必须验证到落库与投影**。上一轮曾按"已完成"提交 B1（`c4e5d484`），本轮核查才发现落库缺失，已更正方案文档与台账口径 |
| Q29 | **承诺推进节奏（阶段A）：DB 列与备份已完成，AI 声明与投影待做** | 目标：让"逾期未推进的承诺"成为**写前规划必须处理**的合同项，而不是事后 warning（对齐竞品 `progressEvery`/`nextProgressChapter` + payoffCadence）。**A1 已完成**：`PayoffLedgerItem` 在两个 schema（`schema.prisma`/`schema.sqlite.prisma`）加 `progressEvery Int?`、`nextProgressChapter Int?`、`payoffIntensity String?`；改前用 SQLite 在线备份 API 做**一致性备份**（非裸拷）`.codex-run/phase-a-20261002/dev-before-phase-a.db`（1.03GB，`integrity_check=ok`，sha256 `77cad662c72b8241a1363212c1499d9fdb9fdd4069d39623d3aa5750d32d0eef`，manifest 同目录）；`prisma db push` 报告 in sync 且**无数据丢失**；行数改前改后一致（PayoffLedgerItem 180、Novel 5、Chapter 21），`integrity ok`；`prisma generate` 成功 | **A2 待做**：`shared/types/payoffLedger.ts` 的 `PayoffLedgerItem`、payoffLedgerSync prompt 的输出 schema、以及两处 upsert（`PayoffLedgerSyncService.ts:429`、`ChapterArtifactDeltaService.ts:1025`）都要带上三个新字段。**A3 待做**：章节任务单生成注入"本章到期承诺清单"，审查校验 `promiseActions` 是否逐项映射，违例默认 `repair_contract`（不升 `replan_window`，避免重演弱证据卡整批）。注意备份是**历史点位**，不是新破坏操作的授权 |
| Q28 | **建议上下文容量反复硬停：已修（结构性瘦身）** | 用户反复遇到"相关规划与审查资料超出单次建议容量，本次未调用模型。请保持暂停…"。根因不是内容真的超限，而是**结构性重复**：语义核验证据目录把每个可引用窗口的 `quote` 完整重复了一遍，而同一段原文已以 `candidateWindow`/`chapterEvidence`/`candidatePlanningHorizon` 存在于同一 payload。用上一个窗口保存的真实技术停点输入复现：`contextJson` **154956 / 160000 = 96.8%**，目录单独占 90791 字符（59%）。修复：目录在 payload 中只给**位置**（`id`/`path`/`authority`），引文由调用方到该字段逐字复制；证据 id 保持**内容寻址**但缩短为 10 位十六进制。服务编译通过；真实输入复测 **154956 → 122304**（降 21%），`planningRepairAdviceReviewContext.test.js` 15/15（新增目录结构护栏：wire 目录不得含 quote、id 必须匹配 `^ev[0-9a-f]{10}$`、真实输入 ≤130000）。证据 `.codex-run/competitor-absorb/` | 曾误改为顺序 id，被既有用例"改变源文后旧 id 必须不再解析"当场拦下——**顺序 id 会让其他上下文的旧 id 被静默接受**，已改回内容寻址。剩余可压缩项：证据目录的 `path` 仍逐条重复（431 条约 28k），可做路径驻留；`macro` 整行传入（17k）。未直接调高 160000 上限：仓库内没有与之绑定的模型上下文声明，无法证明提高是安全的 |
| Q31 | **阶段 A（承诺推进节奏）全部完成** | A1（`80ce4447`）DB 三列 `progressEvery`/`nextProgressChapter`/`payoffIntensity` + 改前一致性备份（`.codex-run/phase-a-20261002/dev-before-phase-a.db`，1.03GB，integrity ok，SQLite 在线备份 API 而非裸拷）；A2（`3e432394`）AI 声明并持久化，prompt 升 `novel.payoff_ledger.sync@v7`；A3a（`510e012c`）`payoffCadence.ts` 的 `selectDuePromises`/`renderPayoffCadenceContext`；A3b（`8de66a83`）经 `payoff_cadence` 上下文块进入章节细化，`chapter_task_sheet` 升 v9；A3c-1（`5b29e09b`）`rollForwardNextProgressChapter` 修掉「永久到期」，并修掉我在 A2 引入的隐患（章节增量原本会把同步器声明的节奏抹成 null）；A3c-2（`22cdd737`）标记词表提为单一来源 `planningToken.ts`，`checkPromiseCoverage` 按显式标记核对。**未做**：无 | 教训：只验证 schema 与 prompt 文本不算完成，必须验证到落库（B 阶段曾因此空转一轮） |
| Q32 | **阶段 B（章级 requiredElements）端到端完成** | B1（`c4e5d484` 后由 `6c46470a` 补齐落库）：两个生成 schema 加 `requiredElements`，**刻意不设 min(3)**——硬下限会让模型漏写时生成失败重试，与「局部规划缺口不阻断链路」冲突；持久化槽位 `chapterScenePlanSchema`（zod 默认丢弃未知字段，必须显式声明），旧数据默认空仍可解析。B2（`5a10599e`）接到 `chapterLayeredContext.ts` 的 `mustAdvance`（**排最前**，容量 5→8，避免章节合同被冗长冲突列表挤掉），经 `:411` 成为 writer 的 `mustHitNow`。B3 **经核查为「由构造闭合」**：验收规则 6 把 `mustHitNow` 缺口写入 `missingObligations`，产出 `draft_obligation_unmet`，AGENTS 明确其为非阻断。 | `chapterRequiredElementsPersistence` 4/4、`chapterLayeredContext` 12/12 |
| Q33 | **阶段 C（伏笔落进 requiredElements）完成，阶段 D 口径修正** | C1（`3c8e7c55`）`foreshadowRevealObligations.ts`：**不需要新增 DB 列**，用已有 `targetStart/EndChapterOrder` + `currentStatus` 表达「本卷必须回收」；覆盖检查**按显式标记而非文字相似度**。C2（`2e357f11`）义务经 `loadPayoffCadence` 与本卷区间注入，复用 A3b 通道，不动 prompt 版本。C3（`ba3314e1`）`findForeshadowTokenLeaks` 原本无调用点，已接入既有确定性正文检查 `ProseQualityDetector`（新增 `prose_foreshadow_token_leak`，severity critical，与占位符泄漏同级）。**D 口径修正**（`b0b1e683`）：`Character.voiceTexture` **已存在、已由 AI 生成、已注入写作上下文**（四处），DB 实测 30 个角色中 `personality` 29 个（97%）而 `voiceTexture` 仅 12 个（40%）——**声音部分的真实缺口是一致性而非能力，不再新建 voiceProfile**；仅 `invariants`/`stateVariables` 仍是空白。 | wiki 新增 `foreshadow-reveal-tokens.md` |
| Q34 | **阶段 F 全部完成；六阶段仅剩 D 不变量与 E 卷级 gate** | F1（`b4e123b1`）排版合同：写作 prompt 此前**完全没有排版约束**，新增 `typography.ts`（段间空行、叙述段 40-120 汉字、单段超 160 必拆、说话人一换必换段），注入 writer/acceptance/review/repair 四处。F2 **经核查无需改代码**：门禁分级已三层一致——证据不足一律 medium、阻断只收 high/critical、升级判定显式排除证据不足；wiki 新增 `evidence-insufficiency-grading.md` 记录**命名陷阱**（证据不足条目仍在名为 `blockingIssues` 的数组里，但实际是否阻断由 severity 决定，不要把 medium 提成 high）。F3（`89ec7b38`）扩写与压缩的双向边界：`expand` 原本**完全没有边界**（可自由新增人物/场景/支线/伏笔、可推进剧情），已补「不得新增人物、场景、支线或伏笔」等三条，`compress` 补三条，两者互不通用。 | `chapterEditorControlledExpansion` 5/5、`payoffCadence` 22/22 |
| Q35 | **测试债清理与归因方法** | 我造成并已修：`chapterProgressionAcceptance`（`2d96c3b9`）因 Q11/F1 新增 `./context/emotionPresence` 与 `./context/typography` 未登记 mock 而**整个文件加载失败**，补齐后 0/1 → 15/15；同期顺带修 `chapterTaskSheetQualityGate` 断言陈旧（v15 → v16，该 prompt 最后修改于 `b1c15506`），16/17 → 17/17。预先存在（非我引入）：`chapterArtifactInfluence`（缺方法）、`chapterStructuredOutputNormalization`、`payoffLedgerShared`（已用对照实验证明）、`prompting-governance`（ComicFactService 内联提示词）、`novel*` 系列 harness 加载问题。**偶发**：`chapterRuntimeCoordinator` 并发满跑时失败，单独连跑三次均 14/14。 | 方法：判定「是否我引入」一律靠对照实验或依赖检查，不靠猜测 |
| Q36 | **会话收尾核验：全量测试、迁移缺口、端到端链路测试** | ①**全量套件**（331 文件 / 2134 项 / 2079 通过 / 41 失败）——此前只跑 chapter、volume、prompting、payoff、planner、novel 六个前缀的子集，**过滤本身漏掉了不在前缀里的文件**。②由全量抓到的**真 bug**：阶段 A1 用 `db push` 加了 `progressEvery`/`nextProgressChapter`/`payoffIntensity` 三列并改了两个 schema，但**没有建迁移文件**（`prismaMigrationCompleteness` 1/2）——新装用户跑 `migrate deploy` 会建出缺列的库，本地已有数据的机器上永远看不到。已补 `migrations` 与 `migrations.sqlite` 两个迁移，恢复到 2/2（`ad430aec`）。③同时修第二个缺 mock 的文件 `actionStateAcceptance`（0/1 → 17/17，同因：Q11/F1 新增的 context 模块未登记）。④新增**端到端链路测试** `payoffChainEndToEnd.test.js`（8/8），首次运行即抓到两个真实缺陷：**承诺标记泄漏未被检出**（detector 只查伏笔标记，`[承诺:x]` 抄进正文无人发现）、**指令里的示例标记 `[伏笔:L001]` 会被提取成真实键**（模型照抄即产生凭空键）。已修（`bd5284b5`）。 | 教训：单测全绿不代表能组合工作；测试前缀过滤会漏文件，**会话收尾至少跑一次全量**。`node --test <目录>` 在本仓库只得 1 个聚合项，须逐文件跑 |
| Q37 | **会话结束时六阶段状态与唯一剩余项** | 阶段 0 / A / B / C / D / F **全部完成**；**E 只剩 E2 执行策略**。E1 判定已实现（`volumeAcceptanceEvaluation.ts`，8/8）。**E2 阻塞于用户选择**（A 停下来等 / B 照常走记债 / C 只卡下一卷大纲），已连续七轮征询未获答复。三种选项都需要 E1，故先做判定、不猜策略。**另有若干预先存在的测试失败**已逐条归因（`p0bRealPrismaChain` 的 pnpm EINVAL、`promptContextBrokerRuntime` 缺 `written_evidence` 断言、`ragContextualChunk`/`ragJobListing`、`novel*` 系列等），**均非本会话引入，未修改**；诊断路径见 `docs/wiki/debugging/dist-loaded-test-failures.md`。 | 约束核验（`d13ca3c0`）：样本正文哈希逐字未变、未推送（分支无 upstream）、未切分支、未删稿件、未恢复导演 |
| Q38 | **阶段目标三件：合同对照检查 / 放弃卡住的修复会话 / 第3章写作缺陷** | 三件均已完成，唯一未完成项是 ② 的真实验收（需用户授权改动真实数据）。① **合同 vs 正文 可复跑核对**（`854a4eb2` `7a5822c9` `bf3fe873`）：`node server/scripts/audit-contract-vs-prose.cjs <novelId>`，语义判断走注册资产、确定性部分单独检查；三章复跑结论跨两次运行一致。② **放弃卡住的规划修复会话**（`d6dff328` 设计、`19247542` 状态与锁、`c79bbc0d` 投影与恢复、`90873fae` 接口与面板、`383debdd` 锁测试、`62710711` rebase 守卫）：新增终态 `abandoned`，锁判定收敛为共享谓词；验收要求的锁释放与不可恢复两类测试均已具备。③ **写作缺陷**：缺陷定义经三问核对后更正，检查为 `novel.audit.prose_defects@v1`（独立调用），生成侧规则加入 `sceneCausalityRules` 并验证渲染。 | **本会话被推翻的三个判断（均是我提出的）**：① 第 3 章「对话回合重复」经三问核对否定（16 轮无一轮空转，独立读者判其不拖沓），实际缺陷是「说出口的立场被推翻却没有新依据」；② 上一轮把 `manual_create` 任务当成导演运行对比，只因没先确认 lane，给出错误结论；③ 设计与 wiki 误记「`validateState` 守 rebase」，实际它由 `save` 调用，该错误导致漏掉 rebase 可复活已放弃会话的真实缺口（`62710711` 修复并更正文档）。**教训：说“某处已经守住”之前，先核实那处代码是否真的走到。** ② 的真实验收需要在 `cmutm92i` 那类运行上演示放弃前后差异，按安全规则须用户明确同意并备份，已连续多轮征询未获答复（同 Q37 的处理方式：不猜、不擅自改动真实数据）。 |

| Q39 | **会话收尾全量测试（按 Q36 教训执行）** | 全量 **2187 项 / 2134 通过 / 39 失败**。对照 Q36 基线（2134 项 / 2079 通过 / 41 失败）：测试数 +53 为本会话新增，失败数 41 → 39（本会话早前修好了两个缺 mock 的文件）。**逐条归因后确认无本会话引入的失败**。提示词相关的那几条需要单独说明：`promptWorkbench` 断言 `novel.chapter.writer@v9`，而注册表里实际是 `@v12`——版本漂移导致的测试过期，本会话从未改动 `chapter.writer`，planner 提示词同样不在本会话改动范围内。其余失败与此前记录同源：`novel*` 系列脚手架加载失败、`pipelinePause` 未 mock、RAG 系列、真实 sqlite 链（pnpm spawnSync EINVAL）、ComicFactService 内联提示词。 | **本会话未新增任何测试失败。** 但要注意：Q36 记的 41 条失败清单并不完整，本次全量显示失败**文件与条目比清单更多**（例如 `promptWorkbench`、`routes`、`simpleCreationMode`、`novelPlanningService`、`directorCandidate*` 等均不在清单内）。**下个窗口若要判断“是否自己造成的”，不能只对照 Q36 那份清单**，需要重新全量并逐条归因。 |

| Q40 | **阶段目标收尾：界面可操作性（④）与剩余待办** | ① ② ③ 见 Q38；本轮完成 ④。**设置找不到**：查证设置区有 6 个子页，分类名本身直白，真正的问题是用户按「我要改什么」找、页面按子系统分类，两边对不上。已加 `SettingsFinder` （输入想改的东西，给出所在位置与跳转），索引键用用户会说的词（通知/字数/放行/深色/密钥…），并明确写出「这里是全局设置，改某本书的字数写法去那本书的小说基础信息」——多数「找不到设置」是找错了层级。**界面文案泄漏**：核对报告的判定值 delivered/partial/absent/contradicted 与「放弃修复」失败的英文报错都会直接显示给用户，均已中文化（`94cfd4db` `b306acdc`）。**可见性核查**：本阶段所有新入口逐个验过可达（桌面版与手机版同走 `NovelEditView`/`MobileNovelEditView` → `StructuredOutlineTab` → `StructuredOutlineWorkspace`，不是两套实现）；出错时运行记录与任务抽屉都有「打开来源页面」指向可操作页；核对接口另加每请求最多 40 章的上限（客户端超时 10 分钟，整本一次跑会超时且结果全丢），超限时在报告里写明，不静默截断。 | **待处理（不在本轮范围）**：预先存在的英文报错族仍会显示给用户，以 `The task changed concurrently; reload planning repair before continuing.` 为代表（用户实际被它拦过）。同族还有 seed 权威那条含相同英文片段。本轮曾尝试翻译，因被 5 处测试断言 + 同族第二条约引发连锁失败，判断在自己改动范围之外、且处在长会话末尾，**整体还原并记录**，留待单独一轮：一次查清整族、断言一起对齐。**记住这个止损原则**：不在自己范围内、又处于会话末尾的扩大改动，风险高于收益。 |


## 授权台账

- 旧书第四章修订、第五章细化保存此前由用户明确授权DeepSeek，相关动作已完成，不自动延展为旧书更多章节改写。
- 新书同一上下文的只读DeepSeek回放：先一次，后用户说“回放十次都可以”“次数不限制”。这是核验范围授权，不是生成正文/恢复导演或无限调用指令。通过后已经停止，本轮交接没有调用模型。
- 自动审批曾因“仅旧书授权”和“一次已用完”拒绝外发，后由用户明确追加授权；不要隐去记录，也不要重复问已明确授权的同一核验范围。
- 上次交接仅授权只读核验与记录情绪要求。本轮用户明确追加三项通用工具修复，并允许另开新书配合验收；已完成代码与离线验证，不恢复旧导演、不改样本正文、不新建任务、不push。
- 最新用户要求审读第三章、排查工具bug、把继承和本窗口工作做成记忆/台账。本批只读三章/运行、隔离机制复现、内部交接文档与小型个人记忆注记；没有新应用修复、真实DB写入、付费调用或自动续写。按磁盘AGENTS要求本地文档阶段提交，不push。

## 不再采用的做法

不把局部禁令摊平到整章；不把所有逾期改成pressure；不靠秘密名字符串重合禁止整个奖励；不强制金手指苦练付代价；不以关闭审查/直接改DB/清历史/不断加轮次掩盖失败；不把emoji式表情、频繁皱眉或大段内心解释当情绪能力。


---

## 2026-10-05 断言型校验治理（本窗口）

用户把重点从"抠样书"转向"修工具的通用 bug"。主线是"同一个问题反复报错"，
共定位到四类同根缺陷：判定太死 / 报错不说现场 / 给出做不到的指令 /
用固定字符串规则冒充语义判断。

已完成（全部本地提交，分支 codex/book-story-foundation）：

- `08e99b7c` 补丁修复守卫：新增文字里若有大段重述正文已有内容则拒绝；
  同时修掉审计点名的 R1（planningQuote 仍用裸比对）与 R3（顺序敏感比对）
- `0d5d89ed` 删除 6 张中文关键词表判章节质量，改为模型自述 + 结构校验
- `2c15a3eb` 拆章补 written_evidence：排章前终于能看到已写正文
- `78b4da01` `688f9cea` `59d49dd1` R2 三批共 38 处报错补上实际值/来源
- `dfd18d9e` 整章改写不再一次索要 2-3 份完整正文（8192 输出上限的根因）
- `feeef023` 整章改写每个候选各自限时 4 分钟
- `3a3abb3e` 合同证据引用允许近似逐字（多一个代词不再卡死流水线）

未完成：R2 第三批约 8 处；节奏段重生应跳过已写章节（结构性，用户已要求）；
README/release-notes 与 wiki 本窗口未同步。

完整交接见 `docs/handoffs/SESSION-2026-10-05-assertion-validation.md`。


## 2026-10-06 情节重复根因治理（Q41）

用户新书《外卖小道士：这单是阴单》第一章完成、第二章正文与第一章基本重复。
用户明确：**问题在工具，不在样书**；要求尽快修好以便进入写书步骤。

### 关键结论：此前对本次故障的归因是错的

10-05 交接文档判断重复源于「合同层看不到已写正文」。**实测推翻**：
用 `buildVolumeChapterDetailContextBlocks` + `selectContextBlocks` 渲染第 2 章合同上下文，
`written_evidence` 以 `required`/priority 110 入选（1274 tok），第 1 章收尾句
（`通道A已于三年前停用`）与站点后台场面**都在上下文里**。模型看得见，仍照重演。

### 真实故障链（三层，检测层是好的，放行层有问题）

1. **合同层｜标题锚点白名单失效**：`chapterDetail.prompts.ts:18-36` 的
   `TITLE_EVENT_ANCHOR_HINTS` 只有 18 个中文动词。拿本书真实 5 章标题实测，
   **全部提取为空**——`翻出` 不在表内。故
   `validateBoundaryContract`/`validateAdjacentChapterBoundary` 对本书 100% 失明。
   把数据库里真实的第 2 章合同喂回 `postValidate`：**PASSED**。
2. **检测层｜其实有效**：第 2 章 `riskFlags` 已点名
   `pacing:medium:第1章结尾已完成拍符封门与背人冲楼，本章开头再次…` 与
   `coherence:high:第1章结尾劳梓凡已在后台完成查询并截图离开，本章…`。
3. **放行层｜问题所在**：`rootCauseCode=draft_repair_exhausted` →
   `terminalAction=defer_and_continue` → 章节仍存成 `approved`。
   `defer_and_continue` 无法区分「文笔一般可接受」与「本章等于没写」。

正文层面：第 2 章有 4 段 ≥40 字与第 1 章逐字相同，占其篇幅 5.8%。

### Q41 风险项已关闭：904 个提交已推送备份

分支 `codex/book-story-foundation` 已推送到用户自己的 fork
`lyaxu`（github.com/lyaxu/AI-Novel-Writing-Assistant），并设置 upstream。
本地与远端 `111aa9f7` 一致（0 ahead / 0 behind）。

**这是本项目此前最大的单点故障**：901 个提交从未推送、无 upstream、
无异地副本，main 落后 900+ 提交因而无法整体回退。现已消除。

推送前已核对：`.codex-run/`、`.playwright-cli/`、`*.db`、`start-local.bat` 等
均未被跟踪；仅有 `.env.example` 模板入库（无真实密钥）；推送内容 51MB。
`main`/`beta` 未被触碰，分支流程仍是「feature → beta → main」。

### Q41 已完成：修 A（已提交 `ccd2eaeb`）
`progressionProjection.ts`：`stalled` 判为 `high`（原与证据不足同为 `medium`），
使其能进入 `blockingIssueIds`（只有 high/critical 会进）从而真正触发重写。
`insufficient_evidence` 仍为 `medium`，不阻断——这正是
`docs/wiki/workflows/evidence-insufficiency-grading.md` 记录的三层设计意图，
此前 `stalled` 与证据不足同档导致该设计失效。

- 验证：隔离 3 例（确认重复→high/可阻断；仅证据不足→medium/不阻断；健康章不受影响）
- `chapterProgressionAcceptance` **15/15**（该测试原本断言 `medium`，其**声明意图**
  「local repair, not global replan」仍满足，已按新意图改为断言 `high` 并补
  「不得升级为全局重规划」断言，未削弱原保证）
- `chapterStructuredOutputNormalization` 与 `chapterArtifactInfluence` 仍失败，
  **已用对照实验**（stash 本次改动后重编译重跑）确认为预先存在

### Q41 已完成：修 B/C/D（`111aa9f7`）

删掉 `TITLE_EVENT_ANCHOR_HINTS`（18 词）与 `extractEventAnchorsFromTitle`，
改为**模型结构化申报 + 代码只校验结构**（与 `0d5d89ed` 删 6 张关键词表同一思路）：

- `neighborEventUse`：申报本章是否占用邻章独占事件。占用**已写**章节 → 拒；
  占用**尚未生成合同、根本没有独占事件**的邻章 → 同样拒（杜绝凭标题臆造）。
- `mustAvoidConflicts`：申报禁止项与必做项的冲突。每条必须逐字引用
  `mustAvoid` 真实分句、且指向真实存在的 `taskSheet`/`requiredElements[n]`/`sceneCards[n]`；
  **虚构引用按编造证据拒绝**。

四个资产升版 `purpose@v7`、`boundary@v6`、`task_sheet@v11`、`execution_contract@v12`，
loader 与 `prompting.test.js` 已同步（升版后全量搜过旧版本号）。

### Q41 已完成：可观测性（`ec4b74bc` + `e75391fb`）

新增 `chapterContractGuardTrace.ts`，把守卫的每次开火与最终申报写进章节**既有的
`repairHistory`**（`[contract_guard] {...}` 行）：`rejected` 附校验器报错原文，
`accepted` 附模型申报的冲突数/越界占用数。选 repairHistory 而非加列是为避免
schema 迁移（Q36 曾因只 `db push` 不建迁移导致新装用户缺列）。

读取：`python .codex-run/new-book-watch/contract-guard-trace.py [novelId]`

**现在能区分**「这章本来就干净」与「守卫把一份自相矛盾的合同改好了才放行」。

### Q41 验收结果

用户重跑《外卖小道士》第 2 章：ch1/ch2 共享 30 字以上逐字段落 **126 → 0**，
逐字重复覆盖 **5.8% → 0.0%**，字数 2853 → 5236，状态由
approved/completed（含 high 级连贯性风险）变为 drafted/needs_repair。

### 本窗口测试基线（逐文件，非前缀过滤）

**最终口径**：`TOTAL files=335 filepass=306 testfail=28 loadfail=1`
（29 失败，与修复前基线**逐文件比对零差异**：新失败 0、修复 0；
多出的 1 个文件是本轮新增的 `chapterContractGuardTrace.test.js`）。

注：`node scripts/run-tests.cjs fast` 会在首个加载失败处**直接退出**（exit 7，
`Unmocked dependency: ../pipelinePause`），拿不到全量；必须逐文件跑。
此数字**取代**10-05 记录的「2187 项 / 39 失败」口径，两者不可相加或比较。

### Q41 未完成

- **待用户实跑新书 1→2→3 章**：单章跑通不等于不靠运气。跑完用
  `contract-guard-trace.py` 确认守卫是否真的开火。
- 10-05 遗留未销账：R2 第三批约 8 处；节奏段重生跳过已写章节（B 项）；
  两处 R3（`worldDraft.prompts.ts:392` 弱势力判据、counts 独立下发）。
- 长文提示词借鉴项：见
  [长文提示词评估](../evals/competitor-absorb/2026-10-06-longform-prompt-assessment.md)，
  建议优先做「明喻频率 + 无意义小动作」两条 `antiAiRule`。

