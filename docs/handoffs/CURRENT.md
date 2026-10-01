# 最新交接入口

最新核验：**2026-10-01（工具优化新一轮窗口）**。完整读磁盘AGENTS.md → [长期上下文](PROJECT_CONTEXT.md) → [完整交接包](2026-10-01_1153Z_three-chapter-audit_thread_handoff.md) → [工作台账](WORK_LEDGER.md) → [工具优化目标任务书](../plans/tool-improvement-roadmap.md)。旧Sept30包归档保留。

- 唯一应用仓库 D:/novel/AI-Novel-Writing-Assistant；分支 **codex/book-story-foundation**，上批代码基线 **94315b5deef754d5cdb81be96e535021b1306ebd**，上批文档提交 ce06f384。本批修复随后本地提交，最终HEAD以Git为准；未push、未beta/main晋级、desktop仍0.4.28。保留原有10项untracked，不切外层master。
- 用户确认长期方向：要写多题材小说（修仙、武侠、穿越武侠、都市修仙、民俗悬疑/盗墓风水、科幻、末世），投稿番茄/七猫/起点，后续用自研AIGC工具“语宙”改编漫剧。判断问题在工具而非模型能力。已建立活跃[工具优化目标任务书](../plans/tool-improvement-roadmap.md)分阶段推进。
- **P1-A Q26 已完成（待提交）**：`promptAssetLoaderEntries.ts` 两处版本声明对齐资产真实版本（`novel.chapter.acceptance_assessment@v7`、`novel.review.patch@v6`，原为v6/v5）。服务端编译通过；离线遍历全部166条loader entry逐条比对声明与资产version：0错位、0加载失败，两个焦点键经`getRegisteredPromptAsset(id, version)`正确解析。
- **P1-B Q24 已完成（待提交）**：`NovelWorkflowHealingService.healRuntimeGateApprovalState` 新增三重通用保护：①以最新`run_resumed`事件为执行代次新鲜度边界，旧step不再产生恢复决定；②本任务活跃`DirectorRuntimeExecution`判定；③写入前重读软CAS。保留`pendingManualRecovery`（质量优先暂停）、活跃命令、取消请求的原有拦截；写入仍走带`planningRepair`写保护的`updateTaskWithRetry`。服务端编译通过；离线隔离12/12通过（旧步骤零写入、合法步骤仍可heal、并发批准拦截、活跃命令/活跃执行/人工恢复/非running各自拦截）。
- **P1-C 待用户操作**：用户倾向新开一本书，跑自动导演第3→4章完整链路，验证导演在批准后不再回退到假等待。
- 当前样本书《外卖箱闯金庸》cmuocysv9000c4ww0dqghfyhk、导演 cmuoc448h00004ww0son4x49c：三章2901/2556/3529原始字符，前两章 approved/completed，第三章 drafted/needs_repair（来自单章入口）。导演仍 waiting_approval、checkpointType=null、pendingManualRecovery=0、lastError=null。保留全部书稿、历史失败记录、旧候选、修复1/2预算与未提交v5。
- **继承未修不能销账**：Q25（引文可定位但语义漏检、事实/推断/计划等级不清、无持有依据的修复备选）、Q09（旧书第二章promiseChecks来源覆盖停点）、Q10（补写越过章节职责根因）、Q11（情绪与人物鲜活专项）、Q12/Q13/Q14（卷级多线、长篇盲评、历史测试债）。旧书用户已说不用再抠，不恢复原导演或改稿。
- **矿区用户明确停止，不第9轮。** 其他旧样本、误建空白第9章、全部失败历史与书稿保留。不自动生成、付费调用、采用候选、恢复导演、开书、切分支或push。
- **证据目录**：`.codex-run/tool-roadmap-20261001/`（verify-q24-stale-gate.cjs、q24-verification-result.json、q24-verify.log、verify-q26-loader-versions.cjs、q26-verification-result.json、q26-verify.log、server-build.log）。
- 已知遗留：`prompting-governance.test.js` 仍有一项失败，内容为 `ComicFactService.ts:39/48` 两处内联 prompt，属Q14历史测试债，本次未触碰该文件，不代表本批引入回归。
