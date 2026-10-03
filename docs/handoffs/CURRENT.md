# 最新交接入口

最新核验：**2026-10-01（工具优化本轮完整推进窗口）**。完整读磁盘AGENTS.md → [长期上下文](PROJECT_CONTEXT.md) → [完整交接包](2026-10-01_1153Z_three-chapter-audit_thread_handoff.md) → [工作台账](WORK_LEDGER.md) → [工具优化目标任务书](../plans/tool-improvement-roadmap.md)。旧Sept30包归档保留。

- **Q28 建议容量反复硬停已修**：用户反复遇到"相关规划与审查资料超出单次建议容量"。根因是语义核验证据目录把每个可引用窗口的 `quote` 完整重复，而同一段原文已存在于同一 payload（结构性重复，非真实超限）。真实技术停点输入复现 154956/160000 = 96.8%，目录占 59%。修复后 **154956 → 122304**；15/15 离线回归（含结构护栏）。提交 `b17151e3`。证据 `.codex-run/competitor-absorb/`。
- **竞品机制研究与六阶段整合方案已就绪**：[竞品研究](../plans/novel-studio-competitor-review.md)（含从打包资源读取的真实约束）、[整合方案](../plans/competitor-borrow-integration-plan.md)（**执行状态表在该文档开头，新窗口从这里读**）。用户已确认六阶段全做、阶段 A 加 DB 列前先备份、阶段 D 只做内部资产。
- **Q27 用户实跑阻断已修**：新书《外卖送到墓门口》每章交接时以 `The task changed concurrently; reload planning repair before continuing.` 失败。根因是 `PlanningRepairStore.casSeed` 用事务较早读取的旧行（原始status+逐字节seed）做精确CAS，而自动执行同步会在修复窗口内写入 queued↔running 投影并重写seed；读取侧 `current()` 本已宽容判定，两侧不一致。修复：事务内重读→同两个权威比较→rebase到最新种子→以最新行做精确CAS。`planningRepairStore.test.js` 122/122，新增竞态用例并已确证可复现（旧基准下121/122）。证据 `.codex-run/cas-race-20261001/summary.json`。
- 唯一应用仓库 D:/novel/AI-Novel-Writing-Assistant；分支 **codex/book-story-foundation**，HEAD **最新提交见 git log -1**。未push、未beta/main晋级、desktop仍0.4.28。保留原有10项untracked，不切外层master。
- 用户确认长期方向：多题材小说（修仙/武侠/穿越武侠/都市修仙/民俗悬疑/科幻/末世），投稿番茄/七猫/起点，后续用自研AIGC工具"语宙"改编漫剧。问题在工具而非模型能力。已建立活跃[工具优化目标任务书](../plans/tool-improvement-roadmap.md)分阶段推进。

## 本轮已完成（均已提交）

| 提交 | 项目 | 验证 |
|---|---|---|
| 2a8ae404 | **Q26** Prompt版本漂移修复：acceptance@v7/patch@v6（166/166 loader entries全部对齐） | 服务编译通过 |
| 2a8ae404 | **Q24** 旧等待步骤覆盖修复：healRuntimeGateApprovalState 三重保护（run_resumed新鲜度/活跃执行/软CAS） | 隔离12/12 |
| b0563f7b | **Q25 第一阶段** 跨字段矛盾门禁：progressed_but_consequence_denied | 隔离8/8 |
| 344c203c | **Q11 writer侧** 情绪规则注入：context/emotionPresence.ts + chapterWriter | 离线8/8 |
| eaa8cc8f | **Q11 acceptance侧** 情绪审查规则注入：chapterAcceptance.prompts.ts | 离线13/13 |
| 0e91b0cd | **Q11 review/repair侧** 情绪规则注入：review.prompts.ts两个入口 | 离线17/17 |

Q11 情绪规则已覆盖**四条链路**：writer（生成）→ acceptance（验收）→ review（审查）→ repair（修复）。

## 重要调查结论（P2-A/P2-B，无需改代码）

- **P2-A 书级终局锚点**：`bookStoryFoundation` 已在 writer 上下文中（`chapterLayeredContext.ts:556-565`，`required=true`）。当前书大底完整。如某书写作时该字段为 null，是开书阶段没有生成宏观规划的数据问题，不是代码缺陷。
- **P2-B 本章必须兑现一件事**：`readerExperience.netChange`/`promisedReward`/`keyTurn` 已是强制字段（`min(1)`），chapterTaskSheetQuality v16 已有 progressionChecks 三维校验。不需要加 `immediatePayoff` 字段。真正需要验证的是 `progressionChecks=stalled` 是否真正阻断了规划。

## 待用户操作

- **P1-C 新书全链验收**：重启服务（stop-local.bat → start-local.bat），新开一本书，自动导演跑到第三章完成后看是否还出现"批准后回退假等待"。这是 Q24 的真实验收。
- **P1-C 情绪效果验收**：读第一章和第三章，看情绪词是否驱动了行为/对话/选择，而不是只挂标签。这是 Q11 的文学验收。

## 继承未修

- **Q25 第二阶段**：行动者/时序/事实-推断-计划等级 AI 合同扩展（LLM 判断层，需要 acceptance prompt 加结构化字段，比第一阶段复杂）
- **Q09/Q10**：旧书 promiseChecks 停点与补写越界根因（用户已说旧书不用再抠，但根因未解决）
- **Q12/Q13/Q14**：卷级多线/长篇盲评/历史测试债
- `prompting-governance.test.js` 一项失败：`ComicFactService.ts:39/48` 内联 prompt，Q14 历史债，与本批无关

## 证据目录

`.codex-run/tool-roadmap-20261001/`：verify-q24-stale-gate.cjs、q24-verification-result.json、q24-verify.log、verify-q26-loader-versions.cjs、q26-verification-result.json、q26-verify.log、verify-q25-progression-evidence.cjs、q25-verification-result.json、q25-verify.log、verify-q11-emotion-rules.cjs、q11-verification-result.json、q11-verify.log、server-build.log、q25-build.log
