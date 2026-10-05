# 最新交接入口

## 阶段目标三件（合同对照检查 / 放弃卡住的修复会话 / 第3章写作缺陷）

执行口径、验收标准与全部证据见 [阶段目标三件](../plans/phase-goal-three-items.md)，
② 的设计见 [放弃规划修复会话设计](../plans/design-abandon-planning-repair.md)，
运行时契约见 [规划修复放弃](../wiki/workflows/planning-repair-abandonment.md)。三件均已完成：

- **① 章节合同 vs 正文 可复跑检查**（`854a4eb2`）：`node server/scripts/audit-contract-vs-prose.cjs <novelId>`。
  语义判断走注册的 `novel.audit.contract_vs_prose@v2`，确定性部分单独检查。三章复跑结论跨两次运行稳定。
  **一处验收偏差要记住**：目标写「第1章清单全部落实」，实际是 4 delivered + 2 partial，
  核对更严格且是对的（未修订检查去迎合标准）。
- **② 放弃卡住的规划修复会话**（`19247542` `c79bbc0d` `90873fae` `383debdd`）：新增终态
  `abandoned`，锁判定收敛为共享谓词 `isTerminalPlanningRepairPhase`。**唯一未完成项**：
  真实运行 `cmutm92i` 的演示需要改动真实数据，须用户同意并备份后再做。
- **③ 第3章两类写作缺陷**（`7a5822c9` `bf3fe873`）：**原缺陷定义是错的**——「对话回合重复」
  经三问核对否定（16 轮无一轮空转，独立读者判其不拖沓）；实际命中并已实现的是
  「说出口的立场被推翻却没有新依据」。检查为 `novel.audit.prose_defects@v1`（独立调用，
  批量提问会稀释它）；生成侧规则已加入 `sceneCausalityRules` 并经渲染验证。

**给下一轮的提醒**：不要照着目标文本里 ③ 的旧定义（"对话回合重复"）继续做事，它已被证据否定。

最新核验：**2026-10-05（阶段目标三件）**。完整读磁盘AGENTS.md → [长期上下文](PROJECT_CONTEXT.md) → [阶段目标三件](../plans/phase-goal-three-items.md) → [完整交接包](2026-10-01_1153Z_three-chapter-audit_thread_handoff.md) → [工作台账](WORK_LEDGER.md) → [工具优化目标任务书](../plans/tool-improvement-roadmap.md)。旧Sept30包归档保留。

- **Q28 建议容量反复硬停已修**：用户反复遇到"相关规划与审查资料超出单次建议容量"。根因是语义核验证据目录把每个可引用窗口的 `quote` 完整重复，而同一段原文已存在于同一 payload（结构性重复，非真实超限）。真实技术停点输入复现 154956/160000 = 96.8%，目录占 59%。修复后 **154956 → 122304**；15/15 离线回归（含结构护栏）。提交 `b17151e3`。证据 `.codex-run/competitor-absorb/`。
- **竞品机制研究与六阶段整合方案已就绪**：[竞品研究](../plans/novel-studio-competitor-review.md)（含从打包资源读取的真实约束）、[整合方案](../plans/competitor-borrow-integration-plan.md)（**执行状态表在该文档开头，新窗口从这里读**）。用户已确认六阶段全做、阶段 A 加 DB 列前先备份、阶段 D 只做内部资产。
- **Q27 用户实跑阻断已修**：新书《外卖送到墓门口》每章交接时以 `The task changed concurrently; reload planning repair before continuing.` 失败。根因是 `PlanningRepairStore.casSeed` 用事务较早读取的旧行（原始status+逐字节seed）做精确CAS，而自动执行同步会在修复窗口内写入 queued↔running 投影并重写seed；读取侧 `current()` 本已宽容判定，两侧不一致。修复：事务内重读→同两个权威比较→rebase到最新种子→以最新行做精确CAS。`planningRepairStore.test.js` 122/122，新增竞态用例并已确证可复现（旧基准下121/122）。证据 `.codex-run/cas-race-20261001/summary.json`。
- 唯一应用仓库 D:/novel/AI-Novel-Writing-Assistant；分支 **codex/book-story-foundation**，HEAD **最新提交见 git log -1**。未push、未beta/main晋级、desktop仍0.4.28。保留原有10项untracked，不切外层master。
- 用户确认长期方向：多题材小说（修仙/武侠/穿越武侠/都市修仙/民俗悬疑/科幻/末世），投稿番茄/七猫/起点，后续用自研AIGC工具"语宙"改编漫剧。问题在工具而非模型能力。已建立活跃[工具优化目标任务书](../plans/tool-improvement-roadmap.md)分阶段推进。

## 当前阶段进度（竞品机制整合，六阶段）

以 [竞品机制整合方案](../plans/competitor-borrow-integration-plan.md) 开头的执行状态表为准；下表是概览，细节与提交号见该文档与台账 Q31–Q35。

- **阶段 0 建议容量硬停**：已完成（`b17151e3`）。真实输入 154956 → 122304。
- **阶段 A 承诺推进节奏**：**全部完成**（`80ce4447`/`3e432394`/`510e012c`/`8de66a83`/`5b29e09b`/`22cdd737`）。含 DB 三列与改前一致性备份、AI 声明节奏、到期清单进章节细化、推进后自动顺延（并修掉我引入的"章节增量抹掉节奏"隐患）、承诺标记与覆盖检查。
- **阶段 B 章级 requiredElements**：**端到端完成**（`c4e5d484`/`6c46470a`/`5a10599e`）。生成→落库→进 writer 的 mustHitNow；验收侧经核查为"由构造闭合"，不另建检查。
- **阶段 C 伏笔落进 requiredElements**：**完成**（`3c8e7c55`/`2e357f11`/`ba3314e1`）。不需要新增 DB 列；覆盖按显式标记而非文字相似度；正文标记泄漏检查已接入既有确定性正文检查管线。
- **阶段 D 人物声音卡与不变量**：**口径已修正**（`b0b1e683`）。`Character.voiceTexture` 已存在、已由 AI 生成、已注入写作上下文，不再新建 voiceProfile；实测 30 个角色中 personality 29 个、voiceTexture 12 个，真实缺口是一致性。**仅 `invariants`/`stateVariables` 仍是空白。**
- **阶段 E 卷级终点 gate**：**完成**（`ab08f264`/`ab6419e1`）。E1 判定（`volumeAcceptanceEvaluation.ts`，无法评估时返回 `needs_attention` 而非通过）；E2 策略由用户选定 **C：只卡下一卷大纲**——`needs_attention` 阻断并说明原因与出路，`accepted_with_debt` **不阻断**（债已记录且可见，对它硬停会让几乎每卷都停），已写正文永不回滚。接线在 `generateVolumePlanDocument` 的 `assertScopeReadiness` 之后，查找失败只告警不阻断。
- **阶段 F 门禁分级/长度/排版**：**全部完成**（`b4e123b1`/`fa49118b`/`89ec7b38`）。排版合同注入四条链路；门禁分级经核查无需改码（证据不足一律 medium，阻断只收 high/critical）；扩写与压缩补上双向边界。

**六阶段已全部完成**（0 / A / B / C / D / E / F）。D 的结论是"已具备、无需新建"（`characterHardFacts` 即不变量）；D 唯一遗留是 `voiceTexture` 填充率 40% 对 `personality` 97% 的一致性问题，属数据补齐，不是能力缺失，**未做也不阻塞任何阶段**。

**尚未由真实运行验证的一件事**：planner 是否确实按指令在 `requiredElements` 里写下 `[承诺:<key>]` / `[伏笔:<key>]` 标记。机制、落库、注入、检查四条链路均已通过测试验证，但"机制存在 ≠ 机制生效"——这一条只能由用户实跑观测。

## 本轮会话核验证据（2026-10-03 实测）

新窗口可直接复用这些结论，不必重跑：

- **仓库与分支**：唯一仓库 `D:/novel/AI-Novel-Writing-Assistant`；分支 `codex/book-story-foundation`；会话基线 `94315b5d`；本会话新增 38 个提交（全部本地）。
- **未推送**：该分支**没有配置 upstream**，远程分支上不存在本地提交。`main` 停在 `62dd5996`，未被触碰，也没有任何测试分支外的内容进入 main/beta。
- **样本正文未被修改**（用户硬约束）：三个样本的章节内容 sha256 与本会话早前记录**逐字一致**——《外卖箱闯金庸》ch1 `fb066423a8cd`（2901 字）/ ch2 `2921f45543a4`（2556 字）/ ch3 `8256480e61dc`（3529 字，`needs_repair`）；《外卖箱通武侠》3 章；《外卖送到墓门口》3 章。**所有章节的 `updatedAt` 均不晚于 2026-10-01**，而今天是 10-03——本会话动过数据库（阶段 A1 的 `db push`），但没有写入过任何正文。
- **未删除稿件**：`Novel` 表 5 本书齐全；《女尊：流放矿区，下跪续命》仍为停止状态，未恢复。
- **未恢复导演 / 未生成正文**：上述 ch3 仍为空且状态 `pending_generation`，自 2026-10-01T16:11 起未变。
- **数据库**：`server/dev.db` 1.03 GB；阶段 A1 的三列由 `prisma db push` 加入，**未提示数据丢失**，改前一致性备份在 `.codex-run/phase-a-20261002/`（sha256 `77cad662c72b8241a1363212c1499d9fdb9fdd4069d39623d3aa5750d32d0eef`）。
- **工作树**：干净；未跟踪文件 10 项，与会话开始时相同。

### 会话收尾核验追加（同日均已提交）

- **全量测试**（此前只跑前缀子集，过滤漏过文件）：331 文件 / 2134 项 / 2079 通过 / 41 失败。
- **抓到并修复的真 bug**：阶段 A1 三列只做了 `db push` 而**没建迁移文件**，新装用户跑 `migrate deploy` 会建出缺列的库（本地已有数据的机器上不可见）。已补两个迁移目录下的迁移，`prismaMigrationCompleteness` 恢复 2/2（`ad430aec`）。
- **新增端到端链路测试** `payoffChainEndToEnd.test.js`（8/8），首次运行即抓到：承诺标记泄漏未被检出、渲染指令里的示例标记会被提取成真实键。均已修（`bd5284b5`）。
- **其余预先存在的失败**逐条归因，**非本会话引入，未修改**；诊断路径见 [dist 加载失败类失败的诊断路径](../wiki/debugging/dist-loaded-test-failures.md)。
- **两条方法教训**（已写入 wiki 与台账 Q36）：单测全绿不代表能组合工作；测试前缀过滤会漏文件，会话收尾应至少跑一次全量，且须逐文件跑（`node --test <目录>` 在本仓库只得 1 个聚合项）。

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
