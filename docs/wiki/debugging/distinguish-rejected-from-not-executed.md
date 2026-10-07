# 诊断原则：先分清「被拒绝」与「没执行」

## 背景

2026-10-06，《外卖小哥阴间配送》开书后连续五次停在 20%，界面提示
「请回到节奏 / 拆章工作区补充修复方向，并确认追加一轮规划修复。」

前三次排查时，我看到任务行的 `updatedAt` 长时间不变，判定为
**「这轮点击根本没执行」**，于是转向去查数据库写入与并发判定，连修四个缺陷
（其中三个是真实存在的 bug）。但真正的拦路虎从一开始就在另一个地方。

## 核心区分

`NovelWorkflowTask.updatedAt` 不变，**有两种完全不同的原因**：

| 现象 | 真实含义 | 查证方法 |
|---|---|---|
| 更新入口在**进入业务流程之前**就拒绝了请求 | 从没开始跑 | `DirectorRunCommand` 无新行；`GenerationJob` 的 `startedAt/finishedAt` 不推进 |
| 流程跑到一半失败 | 跑过，失败了 | `GenerationJob` 有新行，`error` 字段有内容 |

本次属于**第一种**：`assertPlanningRepairResumeAllowed`
（`server/src/services/novel/director/recovery/planningRepair/planningRepairRecovery.ts:58-65`）
在 `waiting_confirmation` 状态下必然抛 409，因为那条恢复通道要求先在
拆章工作区补充修复方向并确认追加一轮。请求从未进入生成流程，
所以 `updatedAt` 自然不变 —— 但原因是**被正确地拒绝**，不是没执行。

## 诊断顺序

判断「重复发生后是不是又被放行」时，按此顺序取证，不要凭直觉：

1. **看 `GenerationJob` 最新一行**：`startedAt` / `finishedAt` / `error` / `llmCallCount`。
   这是流程是否真的跑过、跑了多久、花了多少 token 的直接证据。
2. **看 `DirectorRunCommand` 有没有新行**。有 = 用户操作已受理。
3. **最后才看 `NovelWorkflowTask.updatedAt`**，且把它当作辅助信号而非判据。
4. **`riskFlags.qualityLoop.technicalError`** 常常是上一次残留的，
   不代表这一次也发生了同样的错。必须与时间戳对照。

## 为什么会反复踩

因为「卡住」有两种完全相反的成因：

- **流程内部死锁**：改了代码就能解开
- **入口条件不满足**：改了业务逻辑、或者用户换了个界面才能解开

不先分清这两类，就会在内部死锁的假设下连续修四个真实但无关的 bug，
既消耗预算，又让用户以为「怎么改了这么多还是不行」。

## 推论：拦住用户的地方要对

`assertPlanningRepairResumeAllowed` 拦得没错 —— `waiting_confirmation` 确实
需要用户先确认。但它给出的提示把人指向一个**需要先具备权限才能到达的界面**，
主流程的「继续自动导演」按钮也不满足它的前置条件，于是形成死路。

**规则**：当一条恢复路径把用户挡在门外时，除了「拒绝」，还必须提供
「去哪里做什么」。只抛 409 而不给可达的出口，等于把设计缺陷转嫁给用户。

## 同源教训：判断「这条路走不通」之前要真的走一次

2026-10-06 我据这段代码得出结论：「用户被挡在闭环里，方案 A 无解，只能放弃整本书」。
**该结论是错的。** 随后实测 `GET /api/novel-workflows/<taskId>/planning-repair/advice`
返回成功，且已存在一条历史建议——建议通道的前置条件
（`isPlanningRepairTaskPaused` 与 `isPlanningRepairConfirmationPhase`）**全部满足**。

错因：只读了 `assertAdvicePaused` 里的两个 guard，就断定另一条通道也走不通，
**没有实际调用接口**。两个 guard 看起来像闭锁，但「看起来需要某状态」与
「实际拿不到该状态」是两件事。

**规则**：断言某条路径不可用之前，先跑一次它。只读代码得出的可用性结论，
默认当作待验证假设，而不是结论。

## 相关模块

- `server/src/services/novel/director/recovery/planningRepair/planningRepairRecovery.ts`
- `server/src/services/novel/volume/planningRepair/PlanningRepairStore.ts`
- `server/src/services/novel/quality/ChapterQualityLoopService.ts`
- `server/src/services/novel/production/completion/ChapterProductionCompletionPolicy.ts`
