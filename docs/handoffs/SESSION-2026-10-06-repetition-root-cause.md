# 交接：情节重复的根因定位与第一阶段修复

日期：2026-10-06
分支：`codex/book-story-foundation`（已推送到 `lyaxu` fork，upstream 已设置）
HEAD：`711fcdac`（已推送，本地与远端 0/0 一致）
本窗口起点：`64d44edb`

**先读本文，再读 [WORK_LEDGER](WORK_LEDGER.md) 的 Q41 节。**
本文只记录**已被证据推翻的判断**和**已验证的修复**，避免下一个窗口重走弯路。

---

## 一、用户诉求（务必遵守）

- 用户新书《外卖小道士：这单是阴单》第一章完成，**第二章正文与第一章基本重复**。
- 用户原话要点："重点是修工具的通用 bug"、"尽快把工具的这些问题搞定，尽快进入写书的步骤"。
- 用户判断准确且应被信任：**情节、节奏已有明显进步，不考虑重复的话能看了**；
  反复出现的重复问题是当前唯一拦路虎。
- **授权**：修完之后**顺手把《外卖小道士》第 2 章处理掉**（用户等全部修好后再重新生成测试）。
- **授权**：按本窗口规划的顺序逐个推进修法。
- **要求**：记忆文档与台账及时同步，避免上下文过长丢失关键细节。
- 沿用 10-05 的工作规则：不自动生成正文、不 push、不切分支、界面验收归用户。

---

## 二、⚠️ 已被证据推翻的判断（最重要）

### 1. 「合同层看不到已写正文」——**错**

10-05 交接文档的 `成因 A` 假设重复源于合同生成时拿不到前章正文。
**实测推翻**：用 `buildVolumeChapterDetailContextBlocks` + `selectContextBlocks`
渲染第 2 章合同的真实上下文：

```
written_evidence  req=true  tok=1274  (priority 110, 最高)
第 1 章收尾句在上下文里: true
第 1 章站点后台场面在上下文里: true
VERDICT: 合同层确实拿到了第 1 章完整正文
```

`written_evidence` 块是 `required: true` 且优先级最高，`selectContextBlocks`
会先收它。**模型看得见前章正文，然后照样重演。**
不要再往"上下文没送到"这个方向排查。

### 2. 「检测不到重复」——**也错**

第 2 章 `riskFlags` 原文：

```
"artifactType": "chapter_retention_contract", "status": "risk",
  "pacing:medium:第1章结尾已完成拍符封门与背人冲楼，本章开头再次..."
"artifactType": "continuity_state", "status": "risk",
  "coherence:high:第1章结尾劳梓凡已在后台完成查询并截图离开，本章..."
```

**检测层一字不差地点名了重复，severity 最高到 `high`。**
问题不在检测灵敏度。

### 3. 我本窗口的一次自我误引（已更正）

我曾把第 1 章 repairHistory 里的「首章无前章正文，无法核验事件重演」当作第 2 章
放行的证据。**那句话属于 ch1**（它确实是首章，没有前章可比，判断正确）。
**不要**把它当作第 2 章的门禁记录。

---

## 三、真实故障链

| 层 | 本该做什么 | 实际 |
|---|---|---|
| 排章 `chapter_list` | 看到已写正文 | ✓ 已修（`2c15a3eb`），本次未触发 |
| 合同 `chapter_execution_contract` | 合同层拿到已写正文 | ✓ 拿到了（见上） |
| `validateBoundaryContract` | 独占事件不越界 | ✗ 只查字面锚点 |
| `validateAdjacentChapterBoundary` | 场景不偷跑邻章 | ✗ 同上，且只看 `exclusiveEvent` 不看 `sceneCards` |
| 质量门禁 `progressionChecks` | 判重并强制修 | ⚠️ **判出来了，但被降级成不可阻断** |
| `defer_and_continue` | 决定放行 | ✗ 分不清「文笔一般」与「本章等于没写」 |

### 合同层为什么失明

`server/src/prompting/prompts/novel/volume/chapterDetail.prompts.ts:18-36`
的 `TITLE_EVENT_ANCHOR_HINTS` 只有 18 个中文动词（激活/入手/兑现/…/松动），
用于从章节标题提取"独占事件锚点"。拿本书**真实 5 章标题**实测：

| 章 | 标题 | 提取结果 |
|---|---|---|
| ch1 | 加价三倍的凶宅单 | **[] 失明** |
| ch2 | 最后一张真符 | **[] 失明** |
| ch3 | **翻出**停用通道 | **[] 失明**（"翻出"不在表内） |
| ch4 | 套话反被逐 | **[] 失明** |
| ch5 | 妖记烫，骨牌落 | **[] 失明** |

**5/5 全部提取失败。** 这道守卫对本书完全无效。
第 3 章《翻出停用通道》的职责正是"翻查后台、发现通道 A 停用"，
第 2 章合同把这一幕整段演了一遍。把数据库里**真实的第 2 章合同**
喂回它自己的 `postValidate`：**PASSED**，一个字都没拦。

### 合同自身还自相矛盾

```
mustAvoid : 不得让劳梓凡在本章再次'发现'通道A停用三年这一第1章已知信息
taskSheet : 回站点后台复核第1章已截图的通道A记录
scene_3   : 回站点后台查订单来源 / 发现非本人操作的查询痕迹
```

一边禁止重演，一边把同一场戏写进必做场景卡。**无任何检查发现此矛盾。**

### 正文层面

第 2 章有 **4 段 ≥40 字**与第 1 章逐字相同，占其篇幅 **5.8%**。例：

```
"通道A已于三年前停用，当前订单由通道B统一调度。"他盯着那行字，后肩的伤口又烫…
"。他退出系统，把电脑关了。黑暗中，他站在老邱的工位旁边，听见自己的呼吸声粗重。外…
```

第 1 章 4277 字、第 2 章 2853 字（只有前章 2/3），却要重演整个结尾。

---

## 四、已完成：修 A（`ccd2eaeb`）

**问题**：`progressionProjection.ts` 对 `stalled` 与 `insufficient_evidence`
**一律判 `medium`**。而只有 `high`/`critical` 进入 `blockingIssueIds`
（`chapterRuntimePackageBuilders.ts:379-381`）→ "已证实的重复"结构上**永远无法阻断**。

**修法**：`severity: unknown ? "medium" : "high"`。证据不足仍 medium，不阻断。

**为什么 `stalled` 可以安全升档**：`validateProgressionEvidence`
（`progressionEvidence.ts:45-47, 56`）要求 `stalled` 必须同时携带**前章逐字引文**
与**本章逐字引文**，任一不成立即降级为 `insufficient_evidence`。
所以 `stalled` 在结构上不可能表示"信息缺失"。

**验证**：
- 隔离 3 例全过：确认重复→`high`/可阻断；仅证据不足→`medium`/不阻断；健康章不受影响
- `chapterProgressionAcceptance` **15/15**
- 该测试原断言 `severity === "medium"`。其**声明意图**是
  "local repair, not global replan"，仍然满足；已改为断言 `high`
  **并补上 `assert.notEqual(replanRecommendation?.recommended, true)`**，
  显式锁住"不得升级为全局重规划"。未削弱原保证。
- `chapterStructuredOutputNormalization`、`chapterArtifactInfluence` 仍失败，
  **已用对照实验**（`git stash` 本次改动 → 重编译 → 重跑）确认**预先存在**。

---

## 五、未完成：修 B / C / D（同一改造面，须一起做）

三处都在合同层，根子是同一个：**代码用固定字符串猜语义**。

### 已探明的设计约束（做之前必读）

`VolumeChapterPlan` 表**只有** `title / summary / purpose / mustAvoid / taskSheet /
sceneCards / conflictLevel / revealLevel` 等列，**没有** `exclusiveEvent`、
`endingState`、`nextChapterEntryState`。实测未细化的 ch3/ch4/ch5 这些字段全为 null。
→ 任何"与邻章 `exclusiveEvent` 比对"的校验，对**尚未细化**的邻章拿不到任何数据。

### 修 B｜标题锚点白名单

`TITLE_EVENT_ANCHOR_HINTS`（18 词）应删除。`0d5d89ed` 已经因为同类问题
删过 6 张中文关键词表并改为"模型自述 + 结构校验"——**这是同一个错误的第二次出现**。
正确方向同样是让模型声明，而非扩充词表（扩充永远补不全「翻出」这类词）。

### 修 C｜合同自洽（mustAvoid vs sceneCards）——⚠️ 字符串方案已尝试并**主动放弃**

我先尝试了纯代码方案（`mustAvoid` 每条禁令 vs `taskSheet`/`requiredElements`/
`sceneCards` 的最长公共连续串）。**实测不可用**：

```
clause: 不得让劳梓凡在本章再次'发现'通道A停用三年这一第1章已知信息  (31字)
  taskSheet        shared="第1章已"  len=4  ratio=0.13
  reqElem[3]       shared="通道A"    len=3  ratio=0.10
  scene_3.purpose  shared="第1章已"  len=4  ratio=0.13
  scene_3.mustAdvance[2] shared="发现" len=2 ratio=0.06
```

禁止项与必做项是**改写关系，不是逐字重合**。字符级匹配在原理上抓不到。
且按 AGENTS.md 的 **AI-first 规则**，语义一致性判断不得用固定字符串实现。
→ 必须由模型结构化声明"本章是否消费了 mustAvoid 禁止的事"，代码只校验结构。

### 修 D｜相邻章越界校验扩到 `sceneCards`

现在只查 `exclusiveEvent` 字段，而重复发生在场景卡里，等于没查。
与修 B 同一改造面。

### 建议的落地形态（供参考，未实施）

给合同 schema 加一个模型自述字段，例如
`mustAvoidConflicts: [{ forbidden: string, scheduledIn: string, reason: string }]`，
提示词要求模型**逐条自查 mustAvoid 与必做项是否冲突**并显式声明；
代码只做结构校验（`scheduledIn` 必须指向真实存在的场景/清单项，
`forbidden` 必须是 `mustAvoid` 的某条），**不判断语义**。
这样既符合 AI-first，又能在第 2 章那种自相矛盾上真正失败重试。

---

## 五之二、修 B/C/D 已完成（`111aa9f7`）

**采纳方案：模型结构化申报 + 代码只做结构校验。** 删除了
`TITLE_EVENT_ANCHOR_HINTS`（18 词）与 `extractEventAnchorsFromTitle`。

- `neighborEventUse`：申报本章是否占用邻章独占事件。占用**已写**章节 → 拒；
  占用**尚未生成合同、根本没有独占事件**的邻章 → 同样拒（杜绝凭标题臆造）。
- `mustAvoidConflicts`：申报禁止项与必做项的冲突。每条必须逐字引用
  `mustAvoid` 真实分句、且指向真实存在的 `taskSheet` / `requiredElements[n]` /
  `sceneCards[n]` 槽位；**虚构引用按编造证据拒绝**。

四个资产升版 `purpose@v7`、`boundary@v6`、`task_sheet@v11`、
`execution_contract@v12`，loader 与 `prompting.test.js` 已同步（升版后全量搜过旧版本号）。

测试：`volumeChapterDetailContext` 14/14（新增 6 例真实场景回归 + 1 例白名单确已删除）、
`prompting` 52/52、`chapterProgressionAcceptance` 15/15、`chapterTaskSheetQualityGate` 17/17。

**全量回归**（逐文件 334）：`334/305/28/1`，与修前基线**逐文件比对零差异**
（新失败 0，修复 0）。

---

## 六、待办

1. **用户实跑验收**（见下节）——这是唯一能证明修复生效的方式
2. 10-05 遗留未销账：R2 第三批约 8 处；节奏段重生跳过已写章节（B 项）；
   两处 R3（`worldDraft.prompts.ts:392` 弱势力判据、counts 独立下发）
3. 长文提示词借鉴项（见 `docs/evals/competitor-absorb/2026-10-06-longform-prompt-assessment.md`）：
   建议优先做「明喻频率 + 无意义小动作」两条 `antiAiRule`（数据驱动，可按书禁用）
4. 文档：本窗口已同步 `WORK_LEDGER`(Q41)、`CURRENT.md`、
   `evidence-insufficiency-grading.md`、`release-notes.md`、`README.md`

---

## 六之二、用户实跑结果（2026-10-06 08:17）——**修复生效**

用户重新生成了《外卖小道士》第 2 章，量化复核：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| ch1/ch2 共享 30 字以上逐字段落 | **126** | **0** |
| ch2 中逐字重复覆盖比例 | **5.8%** | **0.0%** |
| ch2 正文字数 | 2853 | 5236 |
| ch2 状态 | approved/completed（带 high 级连贯性风险） | drafted/needs_repair |

用户主观反馈："绝大部分内容基本没有重复了……情节在推进中。"

**这只证明这一次**。按 AI-first 规则，"机制存在 ≠ 机制生效"，
仍需新书跑第 1→2→3 章才能排除"恰好这次合同没写重复内容"。

### ⚠️ 由此暴露的可观测性缺口（下轮应补）

`neighborEventUse` / `mustAvoidConflicts` **只用于校验，没有落库**。
`Chapter` / `VolumeChapterPlan` / `AuditReport` 都没有这两列
（`Chapter` 只有同名不同义的 `conflictLevel`）。

后果：**事后无法回答"模型这次申报了什么、守卫有没有开火"**。

唯一能看到开火的是 `promptQualityTelemetry` 的 `semantic_retry_start`
（`promptRunner.ts:586`，postValidate 抛错时记录），
但它存在 `promptQualityAggregates` 这个 **Map 内存变量**里
（`promptQualityTelemetry.ts:140`），**进程一重启就没**，且**没有 HTTP 出口**
（`getPromptQualitySnapshot` 只被测试引用）。

→ 新书实跑时**看不到守卫是否真的拦下过东西**。
下轮建议：把合同声明落库（`Chapter` 加两列，或写进 `repairHistory` 一行），
并把 `semantic_retry_start` 的失败原因落到 `ChapterTaskSheetQualityAssessment` 或日志文件。

### 监控脚本

`.codex-run/new-book-watch/watch-chapter-contract.mjs`（只读，轮询 dev.db）

```powershell
node .codex-run/new-book-watch/watch-chapter-contract.mjs <秒> <轮询秒>
# 输出 .codex-run/new-book-watch/chapter-samples.log（UTF-8）
```

只采样**持久化**的章节状态（书名/章序/标题/generationState/chapterStatus/
字数/updatedAt）。这能回答"新章是否生成、是否卡在 needs_repair、是否停写"，
**不能**回答"合同守卫是否开火"（见上述缺口）。

⚠️ 控制台输出会因 PowerShell 编码显示为乱码，**日志文件本身是 UTF-8、正常**。

---

## 六之三、《外卖小道士》第 2 章已退回待生成（用户自行跑）

用户选择**自己跑**而非由我调用模型重写。

- 备份：`.codex-run/ch2-rewrite-20261006/dev-before-ch2-rewrite.db`
  （SQLite 在线备份 API，非裸拷），979.46 MB，`integrity_check=ok`，
  sha256 `0c5d014c023afaafd6a9620e3d64b61bdff6a4fc840fc9c902683666b84d0bf3`，
  `Novel=10 / Chapter=61`，manifest 同目录
- 旧第 2 章快照：`ch2-before-reset.json`（正文 sha256 `e3e9496…`，含导致重复的
  `mustAvoid` 与 `taskSheet` 原文）
- 重置走**正规入口** `PUT /api/novels/:id/chapters/:chapterId`：
  `content=""`、`chapterStatus=pending_generation`，
  `taskSheet/sceneCards/mustAvoid/repairHistory/riskFlags` 与四个分数全部置空
- **第 1 章逐字未动**：4119 字、`generationState=approved`、`updatedAt` 未变
- 第 3-5 章未动；`Novel=10 / Chapter=61` 不变；`integrity_check=ok`

**注意**：`generationState` 仍为 `approved`（`PUT` 的 zod schema 不含该字段，
无法经该入口改）。经查**不影响生成**：
`getCurrentChapterArtifactSyncOutcome` 对空正文直接返回 `null`
（`ChapterArtifactSyncBoundary.ts:18`），故 `isCurrentChapterProductionCompleted`
为 `false`，`skipCompleted` 不会跳过第 2 章。仅前端"就绪"步骤图标会显示为已完成。

**验收步骤（用户）**：重启服务 → 对第 2 章点「写本章」→ 检查
① 第 2 章正文是否仍重演第 1 章结尾的站点后台场景
② 合同 `mustAvoidConflicts` 是否被模型如实申报
③ 章节 `riskFlags` 是否仍出现 `chapter_progression_event_repetition_stalled`

**验收边界**：这只能证明**这一次**不再重复。AI-first 规则下，
"机制存在 ≠ 机制生效"，需新开一本书跑第 1→2→3 章才能验证不靠运气。

---

## 七、测试基线（2026-10-06）

```
TOTAL files=334  filepass=305  testfail=28  loadfail=1
```

29 个失败**全部预先存在**（RAG 系列、`novel*` 脚手架、`pipelinePause` 未 mock、
`ComicFactService` 内联提示词、`promptWorkbench` 版本漂移等）。

**口径警告**：
- `node scripts/run-tests.cjs fast` 会在**首个加载失败处直接退出**（exit 7，
  `Unmocked dependency: ../pipelinePause`），拿不到全量结果。**必须逐文件跑。**
- 本数字**取代** 10-05 记录的「2187 项 / 39 失败」。两者口径不同，不可相加或比较。
- 判定"是否我引入"一律用**对照实验**（stash 改动 → 重编译 → 重跑），不靠猜测。

---

## 八、环境备忘

- Node：`C:\Users\lyaxu\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- 测试需 `$env:SQLITE_ENABLE_WAL='false'`
- 改中文一律用 `edit` 工具；`Get-Content`/`Set-Content` 往返会损坏 UTF-8
- `git commit` 用 `-F <文件>`，不要用带引号的 `-m`（PowerShell 5.1）
- 样书 novelId `cmuvh5k4p001ce0w0b5eafvqi`（外卖小道士）
