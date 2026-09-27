# Structured Output Budget Recovery

## Failure Boundary

`finish_reason=length` / `stop_reason=max_tokens`, or completion usage reaching the
request limit when no finish reason exists, means `output_limit`, not a transport
failure. A normal stop takes precedence over usage-based inference.

An output-limit response must not trigger JSON repair, format-strategy fallback,
transport retry, or a fallback model. This applies to empty reasoning-only output
and partial JSON. Usage is published before parsing so failed calls stay visible.
Real transport failures retain their bounded retry policy. Empty output without
limit evidence keeps its existing compatibility behavior.

## Explicit Recovery

The opening workspace's failed/cancelled task retry (including pre-project manual
recovery after restart) uses the current provider,
model and temperature through the existing director retry command. The command
persists the override before requeuing the same task. Ordinary continuation of
an approval checkpoint retains resume semantics and must not reset planning repair
budgets or expand the chapter range.

Official Moonshot `kimi-k3` structured requests use at least 32768 total completion
tokens, preserving a larger explicitly requested budget. K3 counts reasoning and
answer together; legacy answer-only budgets (for example 1680 for a short chapter
list) can otherwise be exhausted entirely by reasoning. Planning and replanning
calls use low reasoning effort; review effort preferences and plain prose calls
remain unchanged. The adapter matches exact official API hosts and never sends
both `max_tokens` and `max_completion_tokens`. Format repair retains the policy.
An output-limit response still stops instead of silently starting another call.

## 世界准备与重试状态

本书世界生成同样使用官方 K3 的低思考强度与 32768 总输出预算，单次等待上限为五分钟。
这只控制世界准备调用，不修改正文写作偏好，也不承诺模型一定在时限内成功。
世界势力的 `factionId` 允许省略或为 null，均表示未归属阵营；持久化归一化本来就采用 null。
接收合同必须与该语义一致，避免因无归属势力丢弃完整结果后再次请求模型。无效对象类型仍拒绝。

后台命令完成调度与步骤开始之间存在时间窗口。状态协调只能同步本次恢复之后的失败；
早于最新 `run_resumed` 的失败记录属于历史，不能将运行中的总任务改回失败。
步骤重开必须清空结束时间和错误并设置新起始时间，心跳则保留本次起始时间。
恢复后的真实失败仍按正常终态处理，不能为了保持运行状态而隐藏错误。

## 样章范围与断点恢复

角色、节奏板或章节列表齐备，只表示可进入生产，不能代表用户已选择写作范围。
从失败断点恢复时，即使按已有产物直接跳到章节执行，也必须在尚未选择创作界面和范围时
保存 `production_experience_required` 检查点。选择前3章后，执行计划必须固定为1—3章；
旧全书任务的流水线绑定不能带入新的样章范围。已明确选择过范围的任务恢复时保留原选择，
不重复设门、不扩大章节范围，也不重置规划修正预算。
流水线执行器必须遵守调用方传入的 `endOrder`；`full_book_autopilot` 控制推进策略，
不能据此将批次扩大到小说预计总章数。后续章节由导演调度，JIT 规划仍在授权范围内工作。

增量拆章的 `chapter_list_partial:active` 表示仍可编辑的卷，前缀只记录拆章进度。
规划保护必须读取其原始卷状态；`chapter_list_partial:frozen` 仍禁止自动修改。
因这一兼容问题而在首次评估前误停的记录，只能在确认无正文、无模型调用或候选、
规划源与保存基线一致后修复资格快照，保留原来的 0/2 次预算。
技术修正不等于追加修复轮次，也不能用于解除真实的规划质量确认或冻结保护。
简洁 / 专业界面选择属于展示偏好，不应让规划源失效；章节字数、创作设定等生成输入仍受保护。
已取消任务的心跳和后台进度不能清除取消状态。用户显式重试必须走独立的生命周期更新，
在事务中重新核验规划修复可恢复后解除取消，继续保留修复快照、预算及历史。
待确认、不确定结果、技术失败或尚有调用未结算的修复，仍需原恢复路径处理。
如果取消后初始任务单完整返回，只能在校验响应来源、格式及边界合同后保存待复核候选。
技术重放须匹配原调用时间和精确任务快照、来源指纹，保留取消状态和 0/2 次预算；
后续显式重试进入语义与窗口审查，不能把日志响应直接视为审查通过，也不重复请求初始任务单。

## Upgrade Guards

The opening workspace keeps observing task status after a transient first-read
failure and after a failed snapshot, including in background tabs. Focus and
reconnection refresh status; an explicit not-found response stops polling. These
are read-only requests, never generation retries. Apply optimistic retry progress
before invalidating queries so a completed candidate checkpoint remains visible.
`client/tests/directorTaskPolling.test.js` exercises recovery with QueryObserver
and simulated time, without model calls.

Preserve the error category, no-automatic-retry boundary, current-model retry
payload, and pre-parse usage publishing. Regression coverage lives in
`structuredInvoke.test.js`, `novelWorkflowContinue.test.js`,
`directorRunCommandService.test.js` and the client workspace contract tests.
