# 设计：放弃卡住的规划修复会话

> 阶段目标 ② 的设计文档。**本文件只做设计，不含实现。** 按目标要求，设计确认后才写代码。

---

## 0. 先修正问题描述：真实原因和最初判断不同

最初的问题是「废弃旧运行抢界面焦点，卡住的修复会话没有干净入口」。查证后，**真实原因有两层，而且第一层是交互缺陷**。

### 已查证的事实

| 事实 | 证据 |
| --- | --- |
| 那个卡住的运行**从未被取消过** | `cmutm92i` 的 `cancelRequestedAt = None`，状态停在 `waiting_approval` |
| 它最后的命令是 09:34 的 `continue` | `DirectorRunCommand` 最近三条：`continue`、`confirm_candidate`、`generate_candidates`，全部 succeeded |
| 「退出导演模式」是**两步确认** | `NovelEdit.tsx:1683-1689` 首次点击只执行 `setIsDirectorExitActionExpanded(true)`；`1677-1682` 展开后才是真正取消 |
| **两步的按钮文案完全相同** | 两处都是 `label: "退出导演模式"` |

### 结论

用户以为点了「退出导演模式」＝已经退出，实际只是展开确认；**取消从未发生，锁从未释放**。
这不是"缺少放弃功能"，而是**同一个按钮文案对应两种行为，用户无法分辨**。

因此设计分两部分：

- **A. 修交互**（第 1 层，让"退出"名副其实）
- **B. 新增「放弃本次修复」**（第 2 层，只丢修复、保留运行）

---

## 1. 现状：状态与锁

### 状态（`PlanningRepairState.phase`）

```
assessing → repairing → reviewing → ready → committed        （正常路径）
                                    ↘ waiting_confirmation     （等用户确认）
                                    ↘ uncertain                （调用结果不确定）
                                    ↘ technical_failed         （模型/技术失败）
```

- `INACTIVE_PHASES = { waiting_confirmation, uncertain, technical_failed }`：停下等人，都不是终态。
- **终态只有一个：`committed`。**

### 锁的语义（`PlanningRepairStore.readTask`）

```js
const otherTasks = await tx.novelWorkflowTask.findMany({
  where: { novelId, id: { not: taskId }, status: { in: ["queued","running","waiting_approval"] } },
});
for (const other of otherTasks) {
  const repair = readState(parseSeed(other.seedPayloadJson));
  if (repair && repair.phase !== "committed") conflict("Another live task owns planning repair for this novel.");
}
```

**只要同书另有任务处于 `queued/running/waiting_approval` 且修复 phase ≠ `committed`，就占锁。** 三个 INACTIVE 相位同样占锁——这正是"卡住"的机制。

### 关键约束

```js
if (previous.phase === "committed" || next.phase === "committed")
  conflict("Only commit may finalize a repair session.");   // validateState
```

**`committed` 只能由 commit 写入。** 因此「放弃」**不得**复用 `committed`——那等于谎称候选已被采纳。

### 已有的释放路径

`cancelTask`（`NovelWorkflowApplicationService:326`）写入 `status="cancelled"` + `cancelRequestedAt` → 该任务不再满足 `status IN (...)` → **锁自然释放**。

**所以"结束整个运行"已经能释放锁，不需要新代码。** 缺的是：
1. 那条路径的入口文案让人误以为已经生效；
2. 想**保留运行**、只丢掉坏掉的修复会话时，没有任何办法。

---

## 2. 设计决定

### D1：新增终态 `abandoned`，不复用 `committed`

`phase` 增加一个值 `abandoned`，语义是**这次修复被用户主动放弃，工作区未发生任何改变**。

理由：候选从未提交，说 `committed` 会让"这个候选被接受过"进入历史与审计；而 `abandoned` 表达的是事实。

同时进入 `PHASES`；**不进入** `INACTIVE_PHASES`（它已是终态，不是"等用户"）。

### D2：锁判定从「≠ committed」改为「∉ {committed, abandoned}」

```js
const TERMINAL_REPAIR_PHASES = new Set(["committed", "abandoned"]);
if (repair && !TERMINAL_REPAIR_PHASES.has(repair.phase)) conflict(...)
```

这是**唯一必须改的锁语义**。保持"同一时间只有一个活跃修复会话"不变。

### D3：合法转移——任何非终态 → `abandoned`；`abandoned` 是吸收态

- 允许来源：`assessing`、`repairing`、`reviewing`、`ready`、`waiting_confirmation`、`uncertain`、`technical_failed`
- `committed → abandoned` **拒绝**
- `abandoned → 任何` **拒绝**（终态不可复活）
- 其余 `validateState` 不变量继续生效（`rounds` 单调、`history` 只追加、`affectedChapterIds` 在窗口内）

**实施更正**：`validateState` 实际由 `save` 调用，不由 `rebase` 调用（设计初版写反了）。
因此 `rebase` 另需一道终态前置拒绝，否则可复活已放弃的会话。已补。

`validateState` 需放宽一处：目前无条件拒绝任何触及 `committed` 的写入，新终态要按同一逻辑处理，并且**必须允许 `abandoned` 作为终态写入**（否则无法记录）。

### D3b：完整触碰点清单（初版设计漏了这些，逐处核实后补上）

占锁只有一处，但**按 `committed` 判断的代码有十处**，全部要处理。漏掉任何一处都会出问题。

| 位置 | 现有判断 | `abandoned` 需要的行为 | 漏掉的后果 |
| --- | --- | --- | --- |
| `PlanningRepairStore.ts:226` | `phase !== "committed"` ＝ 占锁 | 视为已终结，**不占锁** | 锁不释放，本次目标没达成 |
| `PlanningRepairStore.ts:757` | `previous.phase !== "committed"` → **复用上一会话** | **不得复用**，按"无会话"开新的 | **致命**：吸收态＋复用＝永远无法再发起修复 |
| `PlanningRepairStore.ts:927` | `previous.phase !== "ready" \|\| … \|\| INACTIVE_PHASES` | 归入"不可继续推进" | 可能允许从未放弃状态推进 |
| `planningRepairProjection.ts:24` | `committed` 决定 checkpoint 阶段 | 不再是待处理的规划暂停 | 面板继续显示冻结的暂停态 |
| `planningRepairProjection.ts:37` | 决定是否改写 headline/status | **不覆盖**，让面板显示"已放弃" | 面板继续显示旧报错——正是本次要消除的症状 |
| `planningRepairRecovery.ts:60` | `!repair \|\| committed` → return | `abandoned` 同样 return | 会对已放弃的会话发起恢复 |
| `PlanningRepairRecoveryService.ts:33,82` | 归属/状态校验 | 拒绝恢复，返回 409 语义 | 恢复入口仍可点，用户再次卡住 |
| `novelDirectorContinueRuntime.ts:262` | `phase !== "committed"` → 进入修复恢复 | **不进入** | continue 流程又去处理一个已放弃的会话 |
| `DirectorCommandService.ts:331` | `ACTIVE_COMMAND_STATUSES \|\| committed` | 需逐行确认语义后处理 | 待实现时核实 |
| `PlanningRepairCoordinator.ts:92` | `committed` 分支 | 需确认 `abandoned` 落在哪支 | 待实现时核实 |

**实现顺序建议**：先改 `Store`（226 / 757 / 927 / validateState），再改投影与恢复入口，最后改命令与协调器。每步都要有对应测试。

### D4：候选、轮次、quality 的处置

| 处置对象 | 决定 | 理由 |
| --- | --- | --- |
| `candidate`（候选文档） | **丢弃**，不写入任何计划表 | 它从未通过复核；保留会诱使后续会话误用 |
| 工作区 / `VolumePlan` | **完全不动** | 放弃的定义就是不产生改变 |
| `rounds` | **不返还**：放弃时记录 `abandonedRounds`，同一窗口重开新会话时以此为起点 | 否则"用尽预算→放弃→新会话"就成了免费重试，2 轮预算形同虚设。注意这与 D3b 的 `757` 修正**必须成对实现**：不复用会话时轮次要显式继承，否则等于重置 |
| `history` / `quality` / `technicalError` | **原样保留** | 这是唯一可查的证据；用户抱怨过"不会记录" |
| `pendingOperation` / `repairOutputPending` | **清除** | 它们是"调用进行中"的标记；不清除会让面板继续显示冻结的报错，正是本次要消除的症状 |
| `recoveryAction` | **清除** | 它指向一次待执行的恢复动作；放弃后不该再被执行 |
| 新增 `abandonedAt` / `abandonedBy` / `abandonReason` / `abandonedRounds` | **写入** | 满足"放弃动作有记录，不是静默丢数据" |

`rounds` 不返还与本设计的 `757` 修正是**最容易做错的一对**：只改 `757` 而不继承轮次，等于每次放弃都白送 2 轮；只做轮次继承而不改 `757`，则新会话根本开不起来。

### D4b：`abandoned` 之后如何重新开始

`begin` 遇到 `abandoned` 时按"该章没有进行中的会话"处理，但把 `rounds` 起点设为 `abandonedRounds`，`history` 不继承（旧历史属于已放弃的那次尝试，新会话从干净记录开始，证据仍留在被放弃会话里可查）。

### D5：不可恢复

`abandoned` 之后**不能恢复该会话**。用户要重新开始时走正常的新修复流程。

理由：卡住的状态里 `pendingOperation`/`repairOutputPending` 表示"有一次调用结果不明"；让它可恢复，等于把导致卡死的那个不确定性再请回来。候选已丢弃，也没有可恢复的对象。

### D6：与 `cancelTask` / 退出导演模式的关系

三条路径职责分开：

| 用户意图 | 路径 | 是否已存在 |
| --- | --- | --- |
| 结束整个自动导演运行 | `cancelTask` → `status=cancelled` | **已存在**，锁自动释放 |
| 退出导演模式（界面层） | 展开确认 → 真正的取消 | **已存在，但文案混淆，需修（A 部分）** |
| 只丢掉这次修复，运行继续 | 新增 `abandon` | **本次新增（B 部分）** |

三者关系：`abandon` **不改变任务状态**，因此不影响运行；`cancelTask` 会连带使该任务的修复会话失效（任务状态已不在锁查询范围内）。

### D7：界面

- **A**：把首次点击的按钮改成能看出"还要再确认一步"的文案。**已实施**：
  - 入口按钮「退出导演模式」改为 `outline`——它只展开确认，不执行任何操作，标成危险样式正是让两步无法分辨的原因。
  - 展开后的确认按钮文案由「退出导演模式」改为「**确认退出并取消任务**」，直接写明点下去会发生什么；只有它保持 `destructive`。
  - 这两个按钮从此不再共享同一个文案，两步确认仍然保留（取消是破坏性操作，确认步骤本身是对的）。
  - 同文件的任务抽屉动作里没有第二处同类模式；设置页的自动放行是开关（Switch）触发确认弹窗，不是一对同文案按钮，不属于同一问题。
- **B**：修复面板在 `INACTIVE_PHASES` 时提供一个明确的「放弃这次修复」入口：
  - 点之前必须说明后果：候选会被丢弃、已用轮次不返还、**这次修复不能恢复**、书和正文不受影响
  - 点之后：面板不再显示冻结的技术报错，改为显示"这次修复已放弃（时间）"，并给出「重新开始修复」
- 措辞遵守 UI 文案规则：写用户能做什么，不写"我们改了什么"。

---

## 3. 失败与并发

| 情形 | 处理 |
| --- | --- |
| 会话已 `committed` | 拒绝，提示计划已应用，没有可放弃的会话 |
| 会话已 `abandoned` | **幂等**：返回当前状态，不报错、不重复记录 |
| 任务已 `cancelled` / `succeeded` | 拒绝：会话随任务失效，锁已释放，无需放弃 |
| 放弃与提交并发 | 用现有 `casSeed` 事务 + CAS 语义：先到者生效，后到者失败并重新读取状态，不得覆盖 |
| 有 `pendingOperation`（调用在飞） | 允许放弃；写入 `abandoned` 后，在飞调用返回时**必须被拒绝**（沿用 `uncertain` 的处理：执行身份/相位不再匹配即丢弃结果） |
| 放弃后又在飞调用写了状态 | 不可能：`validateState` 禁止离开 `abandoned`，写入会失败 |
| 两个用户同时放弃 | 第二个幂等返回 |
| **放弃后重新发起修复** | `begin` 不复用旧会话，轮次从 `abandonedRounds` 继续（D4b）；这是初版设计漏掉、会在实现阶段造成"永远无法再修复"的一处 |

**必须补的测试**：
1. 放弃后 `readTask` 不再因该任务报冲突（**锁释放**）
2. `abandoned` 是吸收态：任何后续写入被拒（**不可恢复**）
3. `committed` 不能被放弃
4. 幂等：重复放弃不报错、不产生第二条记录
5. `rounds` 不回退
6. `pendingOperation` 被清除，且面板数据不再含 `technicalError` 作为当前错误
7. **放弃后能重新发起修复**，且新会话的 `rounds` 起点 = `abandonedRounds`（防"放弃＝免费重试"）
8. 恢复入口对 `abandoned` 返回拒绝，`continue` 流程不再进入该会话

---

## 4. 验收方式

- **真实样本**：`cmutm92i`（`planningRepair.phase = technical_failed`、`pendingManualRecovery = 1`、`cancelRequestedAt = None`）
  - 演示放弃前后：修复面板不再显示冻结报错；同书其他任务不再被 `Another live task owns planning repair` 拒绝
- **不写样本数据**：验收需要改变这条真实运行的状态，**执行前必须询问用户并做数据库备份**（安全规则）。设计中不预设会去做这件事。
- **不改正文、不恢复导演、不提交候选**：贯穿始终。

---

## 5. 实施拆分（建议顺序）

| 步骤 | 内容 | 风险 |
| --- | --- | --- |
| 1 | 交互文案修正（A 部分，纯前端） | 低，可先行 |
| 2 | `phase` 增 `abandoned` + `validateState` + 锁判定（D1/D2/D3） | 中，触碰状态机 |
| 3 | `abandon` 操作 + CAS + 清除在飞标记 + 记录（D4/D5） | 中 |
| 4 | HTTP 入口 + 面板文案与入口（D7-B） | 低 |
| 5 | 六项测试（第 3 节） | 必做 |

---

## 6. 需要用户确认的两点

1. **`rounds` 不返还**：放弃后重新修复，2 轮预算从已消耗处继续。这样可以防止"放弃＝免费重试"，但也会让用户在预算耗尽后无法重来。是否接受？
2. **不可恢复**：`abandoned` 之后只能重新发起，不能续用原会话。这是为了不再把"调用结果不明"的不确定性请回来。是否接受？

---

## 7. 本设计**不**做的事

- 不改 `committed` 的语义，不新增"半提交"状态
- 不自动放弃任何会话（**只有用户显式操作**；与自动导演"策略性暂停需显式恢复"的既有规则一致）
- 不动候选文档、不写任何计划表、不改正文
- 不在诊断类提交里夹带本改动（本文件本身即设计，不含代码）
