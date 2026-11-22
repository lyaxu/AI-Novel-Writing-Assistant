# 外部智囊项目通盘说明（2026-11-23）

给独立外脑/架构参谋的**项目全景入口**。目标不是替你修当前 bug，而是让参谋理解：这个项目从哪里来、哪些是自己长出来的、哪些是借鉴/逆向出来的、哪些是真正未解的问题。

## 一、最重要的三个事实

1. **当前主仓库是开源基座上的长期改造，不是纯自研从零项目。**
   - 上游开源基座：`https://github.com/ExplosiveCoderflome/AI-Novel-Writing-Assistant`
   - 当前 fork/远端：`https://github.com/lyaxu/AI-Novel-Writing-Assistant`
   - 当前主工作树：`D:\novel\AI-Novel-Writing-Assistant`
   - 当前分支：`codex/production-core-refactor`
   - 当前 HEAD（本文件编写时）：`02fb5368`
   - 基座的初始提交可追到 2026-03-04，产品名/README 里是 **AI 小说创作工作台 / Biz Novel Studio**。

2. **另有一个“从零重做”的兄弟项目，不要混淆。**
   - 目录：`D:\novel\ai-novelist`
   - 方案：`docs/plans/2026-10-07-rewrite-decision.md`、`docs/plans/2026-10-07-rewrite-architecture-v2.md`
   - 动机：旧工具后端已膨胀到约 371,658 行，流程变成“一张网”；重做目标是直线步骤机、低复杂度、题材库驱动。
   - 当前本文讨论的真实生产链仍主要在 `D:\novel\AI-Novel-Writing-Assistant`；不要把 `ai-novelist` 的方案当成主仓库现状。是否需要/已经合并，须以用户最新指令和两边 git 为准。

3. **“大伟 AI 小说家 4.0”是参照物，不是代码底座。**
   - 研究对象：`大伟AI小说家-4.0.0-windows-x64-setup.exe` / 本机安装目录 `C:\Users\lyaxu\AppData\Local\Programs\dawei-novelist-3`
   - 研究记录：[2026-10-06-dawei-4.0-reverse-research.md](../evals/competitor-absorb/2026-10-06-dawei-4.0-reverse-research.md)
   - 视频/ASR 与校正：[大伟AI小说家_视频转写_校正版.md](../../transcripts/大伟AI小说家_视频转写_校正版.md)
   - 借鉴原则（见 `docs/plans/competitor-borrow-integration-plan.md`）：**只借鉴机制/数据结构，不搬 prompt 原文和源码**，落地必须用自己的 Prompt Registry 与 schema 重写。

## 二、项目演进时间线

### 阶段 A：开源基座与既有创作能力

- 2026-03 起，上游仓库已有完整工作台：React + Vite + Plate、Express + Prisma、LangChain/LangGraph、SQLite、Qdrant RAG、拆书、角色、知识库、章节编辑等。
- 本仓库后来保留并改造了这些能力，而不是全部重写。
- 产品定位见 `README.md`：面向**完全不懂写作的新手**，优先“写完一整本”，再优化“写得有多好”。

### 阶段 B：早期竞品吸收

- `docs/plans/competitor-borrow-integration-plan.md`（2026-10-02）记录了 **Novel Studio** 竞品机制的吸收：三层契约、章级 16 字段、承诺节奏、伏笔回收、质量门禁只观察不阻断、受控扩写/压缩等。
- 注意：`大伟 4.0` 与 `Novel Studio` 是**两份研究**，不要混为一谈：
  - 大伟研究：`docs/evals/competitor-absorb/2026-10-06-dawei-4.0-reverse-research.md`
  - Novel Studio 研究：`docs/plans/novel-studio-competitor-review.md`

### 阶段 C：大伟 4.0 逆向与“直线架构”冲击

大伟研究的关键结论（详见上述研究文档）：

- 后端仅约 7,534 行 / 58 个 `.mjs`，却能稳定跑 30 章；
- **一次请求写完整章，永不拼接、永不打补丁，截断就整章重写**；
- 重试固定 2 次，不降级、不记债、不放行；
- 规划在开写前定死并冻结，写作阶段只读；
- 状态机是一条直线，没有并行的第二套规划修复状态机；
- 题材库是纯 JSON 数据驱动（64 题材 + 20 模块，每模板 23 字段）；
- 7 步向导、人物上限/按需增补、人物名改名全局同步、短篇一次成稿；
- 质量阈值只作观察，阻断必须带证据，固定最多两轮整章修订。

对本项目的影响：
- 题材库、7 步向导、冻结式规划、减少“半章补丁状态”、质量债与阻断边界等设计讨论，直接来自这些研究；
- 但当前主仓库并没有完全变成大伟那种 7.5k 行直线机；它是在原有复杂基座上逐步收敛、加恢复层、加质量债，因此复杂度仍是核心矛盾。

### 阶段 D：production-core 重构与质量计划

- 核心重构方案：`docs/plans/2026-10-11-production-core-refactor.md`
- 生产链边界：`docs/wiki/architecture/production-core-boundary.md`
- 质量目标：`docs/plans/novel-framework-quality-program.md`（跨题材 8–9 分框架；因果/人物/情节组织优先，文笔次之；不以单本修好代替通用能力）
- 长期上下文：`docs/handoffs/PROJECT_CONTEXT.md`
- 当前阶段摘要：`docs/handoffs/CURRENT.md` + `docs/handoffs/2026-11-23_bounded-session-handoff.md`

### 阶段 E：2026-11 的恢复链与前十章验证

- 真实书《杂役管事在黑市商城》完成第 1–10 章；
- 过程中修了规划修复轮次/容量债、writer 传输重试、陈旧 queued job、被取消任务的 chapter journal 所有权移交、已保存正文但验收 JSON 失败的降级完成等；
- 但这是“被修通”，**没有一本全新书零人工干预跑到 10 章**的证明；
- 当前已暴露的下一层问题：新书《我把必杀任务改成说服教育》第 1 章规划修复中的 **跨章 stateClaim 引用缺失**，即 `r3` 在第 1 章定义、第 2 章引用但未在本章声明。详细证据见 `BRAIN_BRIEF.md`（在外部工作树中，或向 Lead 索取）。

## 三、当前系统地图

### 技术栈

- Monorepo + pnpm workspace。
- 前端：React + Vite + Plate 编辑器 + 自有 UI primitives。
- 后端：Express + Prisma，SQLite；结构化模型调用、Prompt Registry。
- AI 编排：LangChain/LangGraph（部分旧链路）、自建自动导演/章节生产状态机。
- RAG：Qdrant + Embedding。
- 桌面：Electron 打包。

### 核心业务层（按职责）

- **自动导演**：`server/src/services/novel/director/`，含 commands、runtime、recovery、phase、projection；负责整书/范围推进、检查点、恢复。
- **章节生产**：`server/src/services/novel/production/`，写前准备、writer、验收、修复、实际状态/质量债。
- **规划与规划修复**：`server/src/services/novel/volume/planningRepair/`，容量门禁、候选、修复会话、质量债接受、扩章承接。
- **Prompt**：`server/src/prompting/`，唯一产品 prompt 入口；结构化 schema 与上下文块都在这里。
- **写法引擎**：`server/src/services/styleEngine/`，StyleProfile/Binding/Contract、写法合同、反 AI 规则。
- **长期资产**：角色/资源账本、Payoff Ledger、Reader Experience Contract、拆书/知识库、RAG。
- **任务与恢复**：NovelWorkflowTask / GenerationJob / ChapterArtifactSyncCheckpoint（journal）/ 恢复候选。
- **前端工作台**：`client/src/pages/novels/`、智能驾驶舱、章节列表/详情/大纲、Creative Hub。

### 关键约束（高频踩坑区）

- `docs/wiki/workflows/scene-causality-and-quality-evidence.md`：场景因果、stateClaims、证据边界。
- `docs/wiki/workflows/planning-repair-loop.md`：写前修复窗口、两轮预算、证据路径、跨章边界。
- `docs/wiki/workflows/chapter-production-chain.md`：章节生产链。
- `docs/wiki/workflows/chapter-review-resume.md`：验收/恢复。
- `docs/wiki/architecture/production-core-boundary.md`：单一章节生产链边界。
- `docs/wiki/architecture/character-hard-facts-as-invariants.md`：角色硬事实。
- `server/src/services/novel/volume/planningRepair/README.md`：修复模块边界。

## 四、当前真正未解/需参谋的问题

1. **跨章 stateClaim 合同边界**（当前最具体）
   - 现象：第 1 章 scene_3 exit claim `r3`，第 2 章 beforeClaimIds/prerequisites 引用 `r3`，但第 2 章 stateClaims/entryClaims 没声明它。
   - 初步判断：单章独立合同 vs 多章修复共享 claim 图不匹配。
   - 需要判断：正式支持跨章引用、禁止跨章 ID、还是自动把前章 exit 转本章 entry。

2. **情节“碎碎叨叨”**
   - 用户反馈：文笔稳定，但情节推进碎、密度低。
   - 这不是恢复链能修的；涉及规划粒度、章节职责、场景转折、回报密度。

3. **新书干净跑通未证明**
   - 3 章一验收是下一阶段默认节奏；需要观察零人工干预下是否能连续收口。
   - 当前恢复能力增加很多，但也增加了状态机复杂度。

4. **复杂度陷阱**
   - 后端约 37 万行；计划修复/恢复层非常厚；`PlanningRepairStore` 已超过项目自己 1,300 行的硬阈值。
   - 大伟研究指出的“直线架构”与当前“网状态机”是根本张力；不能只看局部 bug。

5. **验收/模型格式稳定性**
   - 已出现验收 JSON 截断、规划响应格式失败、输出预算耗尽；部分已降级/质量债处理，但根因仍在 schema/输出预算/模型可靠性。

6. **旧测试/旧期望漂移**
   - `chapterProductionRecovery.test.js`、`fullContinueRecovery.test.js` 等存在与 2026 年历史提交不一致的存量失败；不等于当前产品回归，但会干扰判断。

## 五、给外脑的阅读顺序（省上下文）

**第一层（必须，约 30–40 分钟）**
1. `AGENTS.md`（全文；最高优先级规则）
2. `docs/handoffs/PROJECT_CONTEXT.md`
3. `docs/handoffs/CURRENT.md`
4. `docs/handoffs/2026-11-23_bounded-session-handoff.md`
5. 本文件

**第二层（理解来源，按需）**
- 大伟研究：`docs/evals/competitor-absorb/2026-10-06-dawei-4.0-reverse-research.md`
- 重做方案：`docs/plans/2026-10-07-rewrite-decision.md`、`2026-10-07-rewrite-architecture-v2.md`
- 竞品机制：`docs/plans/competitor-borrow-integration-plan.md`
- 生产链边界：`docs/wiki/architecture/production-core-boundary.md`
- 质量计划：`docs/plans/novel-framework-quality-program.md`

**第三层（针对当前 bug，只读）**
- `server/src/prompting/prompts/novel/volume/planningRepair.prompts.ts` 第 60–100 行
- `server/src/prompting/prompts/novel/volume/evidence/stateClaimBinding.ts`
- `server/src/services/novel/volume/planningRepair/planningRepairDomain.ts`
- `docs/wiki/workflows/planning-repair-loop.md`
- `docs/wiki/workflows/scene-causality-and-quality-evidence.md`

**不建议默认读**：
- `docs/handoffs/archive/`、完整 release notes、全部旧 handoff 包、全站 wiki、完整 llm 日志/transcripts。先 grep/按行读。

## 六、外脑工作边界

- 只读，不改主工作树；不调用模型、不重载服务、不写数据库。
- 结论必须引用文件/行/真实数据证据；区分“已验证”“推测”“未验证”。
- 不把单本测试书修好当成通用能力完成；不写书级专用分支。
- 不复制大伟/Novel Studio 的源码或 prompt 原文；只讨论机制与结构。
- 不要用“加一层恢复/放宽校验”作为默认方案，先回答“合同边界应该是什么”。
