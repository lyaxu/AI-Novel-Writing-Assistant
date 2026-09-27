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

Official Moonshot `kimi-k3` book candidate requests (`novel.director.candidates`)
use `reasoning_effort=low` and `max_completion_tokens=32768`. This is the total
reasoning-plus-answer ceiling, not a target prose length or a guarantee of success.
K3 cannot disable thinking. See the [official model guide](https://platform.kimi.com/docs/guide/kimi-k3-quickstart).
The adapter recognizes exact official API hosts, not custom gateway names. It
does not send both `max_tokens` and `max_completion_tokens`. Diagnostics retain
the effective budget. Format repair and semantic retry with the same prompt ID
retain the candidate policy; other prompts, models and provider settings are
unchanged. The earlier generic 10,000-token candidate budget still applies where
the official K3 policy does not match. Output-limit failures stop after one call.

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
