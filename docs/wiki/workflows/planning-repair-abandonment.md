# 规划修复会话的放弃（abandoned 终态）

## 背景

规划修复会话卡在 `technical_failed` / `uncertain` / `waiting_confirmation` 时，会一直占着
`PlanningRepairStore.readTask` 的同书互斥锁：只要同书还有另一个处于 `queued/running/waiting_approval`
的任务，其修复相位不是终态，任何别的任务都无法开始修复。而面板只会把同一个报错反复显示，
用户无论点多少次「重新获取修复方案」都回到同一个会话。

此前唯一的出路是取消整个自动导演任务（`cancelTask` 把状态写成 `cancelled`，该任务随即退出锁查询）。
那会连带丢掉与该次修复无关的进度，代价过大。

## 决策

新增终态 `abandoned`，**不复用 `committed`**。

`validateState` 明确规定「只有 commit 能终结会话」。`committed` 表达的是"候选被接受并应用"，
而放弃从来没有应用任何东西；写入 `committed` 等于把一句假话放进历史与审计里。

## 当前规则

- **状态机**：`abandoned` 是吸收态。允许从任何非终态进入，`committed → abandoned` 拒绝，
  离开 `abandoned` 一律拒绝。
- **锁**：`readTask` 的判定是 `phase ∉ {committed, abandoned}`。共享谓词
  `isTerminalPlanningRepairPhase`（`shared/types/planningRepair/recovery.ts`）是唯一入口，
  不要再在调用点直接写 `phase === "committed"`——曾经有十处这样写，加终态时必须逐处记得，
  已经漏过一次。
- **写入路径**：`commit` 与 `abandon` 各有独立守卫的写入路径；`validateState` 只守 `rebase`，
  rebase 既不能进入也不能离开终态。
- **begin 的复用规则**：`begin` 在 `previous.phase !== "committed"` 时会复用上一会话。
  `abandoned` **必须排除**在外。吸收态 + 复用 = 该章永远无法再修复，这是本设计最容易出错的一处。
- **候选与工作区**：候选丢弃，不写入任何计划表；章节计划与正文完全不动。
- **轮次**：新会话从 0 轮开始。两轮预算约束的是**机器不要自行无限重试**，而放弃本身就是它想逼出来的
  显式干预；把已用轮次继承给新会话会让 `rounds=2/maxRounds=2` 时新会话一开局即耗尽，等于永久封死这一章。
  已用轮次作为证据记录在旧会话的 `abandonedRounds` 里。
- **证据**：`history` / `quality` / `technicalError` 原样保留；新增 `abandonedAt`、`abandonReason`、
  `abandonedRounds`。`pendingOperation` / `repairOutputPending` / `recoveryAction` 清除
  ——前两者是"调用在飞"标记，留着会让面板继续显示冻结报错。
- **记录不丢**：一个任务只有一个修复槽位，新会话会覆盖旧状态。因此新会话的 `history` 携带一条
  `kind: "abandoned_previous"` 记录（放弃时间、已用轮次、原因、原技术错误）。没有这一条，
  "放弃有记录"就是空话。
- **投影**：`planningRepairProjection.isPlanningPause` 只排除 `abandoned`，**不能排除整个终态集合**。
  `committed` 原本就会显示为暂停（修复已完成，检查点要让用户看到），一起排除等于静默删掉该行为。
- **恢复入口**：`assertPlanningRepairResumeAllowed`、`PlanningRepairRecoveryService` 的归属与执行校验、
  `novelDirectorContinueRuntime` 的 continue 分支都按终态判定，不再对已放弃的会话发起恢复。

## 失败模式

| 症状 | 原因 |
| --- | --- |
| 放弃后这一章再也无法修复 | `begin` 复用了吸收态。检查 `abandonedGaveUp` 分支是否仍在 |
| 放弃后面板仍显示同一个报错 | `pendingOperation` 未清除，或投影仍把它当作暂停 |
| 放弃后别的任务仍被挡 | 锁判定没有使用终态谓词，或该行相位未真正写入 |
| 放弃记录消失 | 新会话覆盖了槽位却没有携带 `abandoned_previous` |
| 已完成的修复不再显示检查点 | 投影里误用了整个终态集合而不是只排除 `abandoned` |

## 相关模块

- `server/src/services/novel/volume/planningRepair/PlanningRepairStore.ts`（状态与锁）
- `server/src/services/novel/director/recovery/planningRepair/`（投影与恢复）
- `shared/types/planningRepair/recovery.ts`（共享终态谓词）
- 设计文档：`docs/plans/design-abandon-planning-repair.md`

## 来源

- 用户反馈：卡住的运行让这本书无法继续，而唯一的出路是取消整个导演运行
- 查证：`cmutm92i` 的 `cancelRequestedAt` 为 None——用户以为「退出导演模式」已经退出，
  实际那一步只是展开确认，取消从未发生
