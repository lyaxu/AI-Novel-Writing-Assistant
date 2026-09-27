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
