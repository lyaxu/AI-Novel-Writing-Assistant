# 交接：规划前置验证（可回滚的最小实验）

日期：2026-10-06
分支：`codex/book-story-foundation`（已推送到 `lyaxu` fork，upstream 已设置）
HEAD：`b99c0afc` 之后（含本文件提交）
前一窗口：`SESSION-2026-10-06-repetition-root-cause.md`（重复问题，本文件之前）

**新窗口第一件事：读本文 → 读 `WORK_LEDGER.md` 的 Q41/Q42 → 再动手。**

---

## 一、本窗口要做的唯一一件事

**验证「规划前置」能否根治情节重复。**

不是重构，不是全面改造。是一个**成本低、可回滚、直接回答用户最在意的问题**的实验。

### 实验设计

**假设**：本工具的第 N 章章节合同是在**第 N-1 章正文已经存在之后**才生成的，
所以模型看得见前章却仍会重复。若在**写作之前**一次性生成并冻结多章合同，
重复在结构上不可能发生。

**做法**：
1. 取《外卖小道士》或《外卖小道士：这单是阴单》的第 3-5 章
2. **在写正文之前**，沿用现有 `chapter_list` 提示词（`novel.volume.chapter_list`
   已含 `written_evidence` 与 `protagonistAction`/`chapterPayoff` 自述校验），
   一次性生成第 3-5 章的章节合同并落库
3. 写作时**只把已冻结的合同**喂给 `chapterWriter`，不让它在写作过程中重排
4. 观察第 3 章是否还重复第 2 章

**成功判据**：第 3 章与第 2 章的 30 字以上逐字重合 = 0，且不出现「再次发现/再次调查」
类知识重演。

**失败判据**：仍然重复 → 说明根因不在规划时机，需转向上下文/提示词层。

### 为什么这个实验是对的选择

- 直接对应竞品的核心做法（`whole-chapter.mjs` + 写前冻结的章纲）
- 复用现有提示词，**不写新架构**
- 失败也能得出结论（排除一个假设），不是白做
- 不影响已完成的重复守卫（`ccd2eaeb` / `111aa9f7` / `ec4b74bc`）

---

## 二、动手前必读：现有规划链路的真实形状

```
createBeatStream（POST /:id/beats/generate）
  └─ generateBeatChunkedChapterList        ← chapter_list：按节奏段排章
       └─ volumeChapterListGeneration.generateBeatChunkedChapterList
            └─ chapterListPrompt (novel.volume.chapter_list@v14)

逐章进行时：
volumeGenerationOrchestrator → generateChapterDetail
  └─ chapterExecutionContractGeneration.generateChapterTaskSheetDetail
       └─ volumeChapterExecutionContractPrompt (@v12)
            └─ postValidate: validateDeclaredNeighborAndConflictUsage
                             validateBoundaryContract
                             validateAdjacentChapterBoundary
  └─ ChapterTaskSheetQualityGateService.assertCanEnterExecution
       └─ chapterTaskSheetQualityPrompt (@v17)
```

**关键点**：`chapter_execution_contract` 是**逐章**生成的（写完第 1 章才生成第 2 章的合同）。
本实验要做的是让第 3-5 章的合同**提前批量生成**。

已有可复用能力：
- `chapter_list` 提示词已能一次产出多章的 `protagonistAction`/`chapterPayoff`/`summary`
- `neighborEventUse` / `mustAvoidConflicts` 守卫已就位（`111aa9f7`）
- 守卫开火痕迹已落库（`ec4b74bc`，用 `contract-guard-trace.py` 读）

---

## 三、本项目的硬约束（违反会出事）

- **不自动生成正文、不恢复导演、不切分支、不改样书正文**（用户 10-05 明确的规则）
- 破坏性操作前必须有**已验证备份**（SQLite 在线备份 API，不是裸拷）+ 记录 sha256
- 改中文一律用 `edit` 工具；`Get-Content`/`Set-Content` 往返会损坏 UTF-8
- `git commit` 用 `-F <文件>`，不要用带引号的 `-m`（PowerShell 5.1）
- 改提示词必须同步：`promptAssetLoaderEntries.ts` + `server/tests/prompting.test.js`，
  **升版后全量搜一遍旧版本号**（10-05 交接第七节记的坑）
- 改 TypeScript 后**必须重编译再跑测试**，否则会看到假失败
  （本窗口踩过：`prompting.test.js` 报 48/2，实为 dist 陈旧，重编译后 50/50）
- 新增 `import` 到 `chapterExecutionContractGeneration.ts` 时，
  **必须给 `chapterContractRepairBoundary.test.js` 和
  `existingContractEvidenceReview.test.js` 登记 mock**，否则整个文件加载失败
  （本项目已因此栽 3 次：`pipelinePause` / `emotionPresence` / `chapterContractGuardTrace`）

---

## 四、当前基线

```
全量：files=335 filepass=306 testfail=28 loadfail=1（29 失败全部预先存在，逐文件零差异）

相关测试当前值：
  planningRepairStore            133/133
  planningSourceTokenVolatile      7/7
  planningRepairRecovery          20/20
  planningRepairPipelineFailure    4/4
  volumeChapterDetailContext      14/14
  chapterProgressionAcceptance    15/15
  chapterContractGuardTrace        5/5
  chapterTaskSheetQualityGate     17/17
```

改任何东西之后，重跑上述 + 全量对比。

---

## 五、环境与工具

- Node：`C:\Users\lyaxu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- Python：同目录 `..\python\python.exe`
- 测试需 `$env:SQLITE_ENABLE_WAL='false'`
- `node --test <目录>` 在本仓库只得 1 个聚合项，**必须逐文件跑**
- `node scripts/run-tests.cjs fast` 会在首个加载失败处直接退出（exit 7），拿不到全量
- 只读查库：`sqlite3.connect(f"file:{db}?mode=ro", uri=True)` + `PRAGMA query_only=ON`
- **Windows 上 sqlite URI 路径要正斜杠**，反斜杠会报 `unable to open database file`
- 数据库：`server/dev.db`（约 979 MB）
- 现有备份：`.codex-run/ch2-rewrite-20261006/`（第 2 章重置前，integrity ok，sha256 已记）

---

## 六、样书状态

| 书 | novelId | 状态 |
|---|---|---|
| 外卖小道士：这单是阴单 | `cmuvh5k4p001ce0w0b5eafvqi` | ch1 4119 字 approved；ch2 重写后 5236 字 drafted/needs_repair，**重叠 126→0**，修复生效 |
| 外卖小哥阴间配送 | `cmuwmrytv000deow0t1klatgd` | **0 章正文**。三卷（殡仪馆首单 2 章 / 旁支现身 / 两界调度）已生成。规划修复会话 `abandoned`，用户自行尝试方案 A，结果未确认 |

**《外卖小道士》第 2 章修复后仍 `needs_repair`**，是正常的——它表示"内容可用但仍有待处理项"，
不代表重复问题复发。重跑前用同一套量化方法复核：

```powershell
python .codex-run/new-book-watch/contract-guard-trace.py <novelId>   # 守卫是否开火
```

---

## 七、竞品研究结论（已落档，不要重做）

见 [大伟AI小说家 4.0 逆向研究](../evals/competitor-absorb/2026-10-06-dawei-4.0-reverse-research.md)。

一句话：**它 7,534 行跑 30 章不卡，本工具 371,658 行在第 1 章卡 5 次。**
四条关键决策：一次成稿永不拼接 / 重试固定 2 次失败即停 / 规划在写前冻结 /
状态机是单条直线。

**注意**：不要整体照搬。它以文学质量换架构稳定性，其"不卡"部分来自功能更少。

---

## 八、本窗口遗留（未完成）

- **Q43｜引导缺陷**：`waiting_confirmation` 时点"继续自动导演"必然 409，
  唯一合法出口在用户到不了的界面。修法：让主流程认识该状态，或给明确跳转引导。
- Q41 遗留：R2 第三批约 8 处；节奏段重生跳过已写章节（B 项）；两处 R3
- 长文提示词借鉴项：优先「明喻频率 + 无意义小动作」两条 `antiAiRule`
- 竞品可摘项：人设改名全局同步（`character-names.mjs` 120 行，参考思路自行实现）
