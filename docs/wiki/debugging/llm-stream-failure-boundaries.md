# 模型流失败与输出预算

## 问题边界

章节计划截断和后端进程退出是两类故障。先检查 `/api/health`，再核对任务错误、LLM 请求日志和实际输出 token 数；不能把所有失败归因于供应商，也不能用无限重试掩盖程序缺陷。

## 流式完成契约

`streamTextPrompt` / `streamStructuredPrompt` 同时提供迭代器和 `complete`。
迭代器失败会抛给调用方，同时拒绝正文与用量完成 Promise。调用方往往只在正常读完后才等待 `complete`，所以仅在调用方的 `onDone` 加 catch 并不够。

- 创建完成 Promise 时立即注册拒绝观察器，包括后处理生成的最终 `complete`。
- 观察器不替换原 Promise、不把错误转换成成功；之后 `await complete` 仍拒绝。
- 迭代器提前 return/break 以 AbortError 结束完成结果，不能把部分正文记为成功。
- 不注册全局 unhandledRejection 吞错处理器。真正错误仍交由任务恢复策略处理。
- 回归测试使用独立 Node 子进程和 `--unhandled-rejections=strict`，覆盖晚等待、不等待、取消及后处理失败。

## 输出额度

章节执行合同包含章节边界、任务单、读者体验和多张场景卡，不能按短摘要配置输出预算。当前单次预算为 8192 tokens，与正文目标字数分开管理。

输出结束原因为 `length` / `max_tokens` 时，可以确认额度耗尽。供应商未提供结束原因时，可用实际输出 token 数达到请求上限作为推断；明确的正常结束优先于推断。

只对已确认或有用量证据的耗尽增加修复额度：最多加倍且本次自动增加不超过 8192。已有更大显式额度保持不变，模型能力约束仍由 factory 负责。修复次数保持原有上限，结构和语义校验不能绕过。

## 日志与诊断

- LLM 文件日志保留 `finishReason`、`actualCompletionTokens`、`outputLimitReached`，流式 chunk 中的用量和结束元数据不能在拼接正文时丢失。
- 网络异常日志保存有限深度的 `cause.code`，不序列化 socket、认证信息等对象。
- `terminated` / `UND_ERR_SOCKET` 只能证明响应链路中断，单凭它无法区分代理、本地网络和供应商断流。
- 原生 Anthropic 流也应保留 message_start/message_delta 用量与结束原因，并传播 error 帧，不能只提取 text_delta。

## 本地验证证据

2026-09-16 的故障中，章节计划及修复连续四次输出均为 3200 tokens，正文仍未生成。另一次网络中断可离线复现出两个未处理的完成 Promise 拒绝。对应回归覆盖见 `promptStreamReliability.test.js`、`llmResponseDiagnostics.test.js` 和 `structuredInvoke.test.js`。
