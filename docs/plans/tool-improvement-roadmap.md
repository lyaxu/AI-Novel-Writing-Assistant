# 工具优化目标任务书

更新：2026-10-01。本文是正在进行中的活跃任务书，实时记录每个阶段的目标、进展、验收标准和交接要点。不替代 WORK_LEDGER 和交接包；与台账交叉引用。

---

## 一、为什么要优化

用户想用自己的 AIGC 工具（语宙）写多部题材小说（修仙、武侠、穿越武侠、都市修仙、民俗悬疑、科幻、末世），并投稿/改编漫剧。核心问题：

1. 单独丢脑洞给 LLM 能写出不错内容，但写着写着就飞了
2. 工具断断续续改了很久，几十章了情节还在兜兜转转
3. 不是 LLM 能力问题，是工具没给 LLM 足够的"骨架约束"
4. 修了这里坏了那里，需要有序推进、有据可查

**根本症结**：
- 规划层缺书级终局锚点，LLM 写章节时看不到终点
- 写作层缺"阶段回报时钟"，每章酝酿但不落地
- 各模块耦合点多，局部修复引发下游问题

---

## 二、优先级与阶段划分

### 阶段 P1：让导演真正跑起来（当前阶段）

| # | 问题 | 状态 | 验收标准 |
|---|------|------|---------|
| P1-A | **Q26** Prompt 加载目录版本声明漂移 | ✅ 已修（待提交） | loader 声明与资产版本一致；166/166 校验通过 |
| P1-B | **Q24** 旧等待步骤覆盖新执行 | ✅ 已修（待提交） | 新鲜度（run_resumed 分界）+活跃执行判定+写入前重读；隔离 12/12 通过 |
| P1-C | 新开一本书跑第3→4章完整链路验证 | 🔲 待做（用户操作） | 导演能从第3章自动推进到第4章规划并等待批准，不回退 |

### 阶段 P2：让故事向前推进（P1 完成后）

| # | 问题 | 状态 | 验收标准 |
|---|------|------|---------|
| P2-A | 书级终局锚点进入写作上下文 | 🔲 待做 | writer prompt 包含书级终局目标和当前卷阶段目标；可在生成章节中验证 |
| P2-B | 本章必须兑现一件事（immediatePayoff 字段） | 🔲 待做 | chapterTaskSheet schema 加非空 immediatePayoff；规划审查验证字段存在 |
| P2-C | **Q11** 情绪最小实现 | 🔲 待做 | writer prompt 每个出场人物加"处境压力→影响行动/说话"描述；不堆表情词 |

### 阶段 P3：语义质量与跨题材泛化（P2 完成后）

| # | 问题 | 状态 | 验收标准 |
|---|------|------|---------|
| P3-A | **Q25** 语义结论/修复前提核对扩展 | 🟡 结构门禁已修，深层语义待扩 | 跨字段矛盾门禁已落地并验证；行动者/时序/事实等级/指令前提的 AI 合同扩展待做 |
| P3-B | 题材回报模板（修仙/武侠/末世等节奏差异） | 🔲 待做 | 规划阶段按题材给出"合格本章兑现"标准；七题材各有样例验证 |
| P3-C | 漫剧改编链路打通 | 🔲 待做 | 小说章节事件序列→分镜卡，保留因果链和人物状态一致性 |

### 持续维护

| # | 问题 | 状态 |
|---|------|------|
| Q09 | 旧书 promiseChecks 来源覆盖语义修复 | 🔲 暂缓（旧书不再围绕）|
| Q10 | 补写越过章节职责根因定位 | 🔲 暂缓 |
| Q12 | 卷级多线/按需召回/文风校准 | 🔲 长期 |
| Q13 | 长篇盲评/中段高潮终局验收 | 🔲 长期 |
| Q14 | 历史测试债/误报治理 | 🔲 长期 |

---

## 三、当前阶段详细进展

### P1-A：Q26 Prompt 版本声明漂移

**问题**：`server/src/prompting/registry/promptAssetLoaderEntries.ts`
- 第285行声明 `novel.chapter.acceptance_assessment@v6`，资产实际 v7
- 第465行声明 `novel.review.patch@v5`，资产实际 v6

**影响**：精确版本查找和按需加载可靠性下降；本次v7实际已运行，不是调用旧提示词，但声明不一致需修正。

**状态**：✅ 已完成

**实现**：`promptAssetLoaderEntries.ts` 第285行改为 `novel.chapter.acceptance_assessment@v7`，第465行改为 `novel.review.patch@v6`。

**验证**：服务端 TypeScript 编译通过。离线校验脚本遍历全部 166 条 loader entry，逐条比对声明版本与资产真实 `version` 字段：0 处错位、0 处加载失败；两个焦点键均能通过 `getRegisteredPromptAsset(id, version)` 正确解析。证据：`.codex-run/tool-roadmap-20261001/verify-q26-loader-versions.cjs`、`q26-verification-result.json`、`q26-verify.log`。

**边界**：`prompting-governance.test.js` 仍有一项失败，内容是 `ComicFactService.ts:39/48` 两处内联 prompt，属文档已记录的 Q14 历史测试债，两个文件均未被本次修改触碰。

---

### P1-B：Q24 旧等待步骤覆盖新执行

**问题**：`NovelWorkflowHealingService.healRuntimeGateApprovalState`（行268）取本任务最新 `DirectorStepRun`，不比较步骤时间/节点/执行身份；`updateTaskWithRetry` 的 where 仅 `{id: taskId}`，无 CAS。旧 06:13Z 步骤可把11:35Z approve 后的 running 任务写回 waiting_approval。

**状态**：✅ 已完成

**实现**（三处通用保护，不含任何书名/章节号/报错文案特判）：
1. **新鲜度分界**：取本任务最新 `run_resumed` 事件作为执行代次边界；若最新 step 的 `updatedAt` 早于该事件，判定它属于旧执行代次，直接跳过，不产生恢复决定。此范式与文件内既有的 `healRuntimeFailedState` 一致。
2. **活跃执行判定**：查询本任务名下状态为 queued/running 的 `DirectorRuntimeExecution`；存在即说明管线仍在跑，不得投影为等待。
3. **写入前重读（软 CAS）**：提交写入前重读最新任务行，只有仍为 `running` 才落笔，防止并发批准/恢复命令被覆盖。

保留不变：`pendingManualRecovery` 仍强制跳过（质量优先人工暂停不被清掉）；存在活跃 `DirectorRunCommand` 仍跳过；取消请求仍跳过；非 running 任务不进入本路径。写入仍走带 `planningRepair` 写保护的 `updateTaskWithRetry`。

**验证**：服务端 TypeScript 编译通过。离线隔离验证 12/12 通过，直接转译真实源码方法、替身全部数据依赖，不触真实 DB/HTTP/模型：
- 旧 06:13Z 步骤在 11:35Z 恢复之后 → 不 heal、零写入（复现原缺陷已消除）
- 恢复之后更新的步骤 → 正常 heal（合法路径未被误伤）
- 无 `run_resumed` 历史 → 退回原有行为，仍可 heal
- 恢复期间并发批准 → 拦截、零写入
- 活跃命令 / 活跃运行时执行 / pendingManualRecovery / 非 running → 各自拦截

证据：`.codex-run/tool-roadmap-20261001/verify-q24-stale-gate.cjs`、`q24-verification-result.json`、`q24-verify.log`。

**尚未证明**：现场究竟哪一次 GET 触发了写入，仍缺逐写 trace；本次证明的是机制层面缺陷已闭合，不等于已捕获现场那一次因果。真实导演全链验收由 P1-C 覆盖。

**跑前快照对照**：所有 `DirectorStepRun.updatedAt` 均为 2026-09-30T17:09—10-01T06:13Z 旧批次；最新 `run_resumed` 为 2026-10-01T11:35:11.762Z。修复后该旧步骤不再产生恢复决定。

---

### P1-C：新书链路验证（用户操作）

**前置**：P1-A 和 P1-B 完成并本地提交后，用户新开一本书（题材自选），跑自动导演直到第3章完成，观察：
1. 第3章 approved 后导演能否自动推进到第4章规划
2. 是否出现"回到等待"的假循环
3. 第4章规划审查是否正常等待用户批准

**状态**：🔲 等 P1-A/B 完成

---

## 四、交接要点（窗口满时直接引用）

- 仓库：`D:/novel/AI-Novel-Writing-Assistant`，分支 `codex/book-story-foundation`
- 当前代码 HEAD：ce06f384（文档提交），代码基线 94315b5d
- 未 push、未晋级 beta/main，desktop 0.4.28
- 保留 10 项 untracked，不清理、不切分支
- 当前样本书《外卖箱闯金庸》`cmuocysv9000c4ww0dqghfyhk`，第3章 drafted/needs_repair，导演 waiting_approval
- 不自动恢复导演、不采用旧候选、不改已有正文
- Q24/Q25/Q26 是本窗口新发现的工具 bug，见 WORK_LEDGER 和三章观察文件
- 详细失败历史/验收边界/授权台账见 `docs/handoffs/2026-10-01_1153Z_three-chapter-audit_thread_handoff.md`

---

## 五、完成记录

（每完成一个阶段在此追加，包括提交 hash、验收结果和备注）

| 日期 | 阶段 | 提交 | 结果 | 备注 |
|------|------|------|------|------|
| 2026-10-01 | P1-A Q26 | 待提交 | ✅ 服务编译通过；166/166 loader entries 版本一致；acceptance@v7/patch@v6 焦点键正确解析 | `ComicFactService` 内联 prompt 是 Q14 历史债，与本次无关 |
| 2026-10-01 | P1-B Q24 | 待提交 | ✅ 服务编译通过；隔离验证 12/12 通过（旧步骤不触发/合法步骤正常 heal/并发批准拦截/活跃命令拦截/活跃执行拦截/pendingManualRecovery 保护/非 running 不触发） | 现场逐写因果仍无 trace；P1-C 新书验证待用户操作 |
