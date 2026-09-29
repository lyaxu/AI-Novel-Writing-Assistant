import { ZodError } from "zod";
import { StructuredOutputError } from "../../../../../../llm/structuredOutput";
import { AppError } from "../../../../../../middleware/errorHandler";

export function describeAdviceFailure(error: unknown, receivedOutput?: unknown) {
  const category = error instanceof StructuredOutputError ? error.category
    : error instanceof ZodError ? "schema_mismatch"
      : error instanceof Error && error.name === "TimeoutError" ? "timeout"
        : error instanceof Error && error.name === "AbortError" ? "aborted" : "unknown";
  const failureDiagnostics = {
    category,
    detail: error instanceof Error ? error.message : String(error),
    ...(error instanceof StructuredOutputError && error.rejectedOutput
      ? { rejectedOutput: error.rejectedOutput }
      : receivedOutput !== undefined ? { rejectedOutput: { parsed: receivedOutput } } : {}),
  };
  let message: string;
  switch (category) {
    case "schema_mismatch": case "malformed_json": case "incomplete_json": case "thinking_pollution":
      message = "AI 返回的方案格式不完整，本次未执行修复。可重新获取方案。"; break;
    case "output_limit":
      message = "AI 方案超出本次输出容量，本次未执行修复。请调整模型输出设置后重新获取方案。"; break;
    case "timeout":
      message = "获取方案超时，本次未执行修复。可重新获取方案。"; break;
    case "aborted":
      message = "获取方案已中止，本次未执行修复。需要时可重新获取方案。"; break;
    case "transport_error":
      message = "与 AI 服务的连接未完成，本次未执行修复。请检查连接后重新获取方案。"; break;
    case "unsupported_native_json":
      message = "所选模型无法按要求返回方案，本次未执行修复。请检查模型设置后重新获取方案。"; break;
    default:
      message = error instanceof AppError ? error.message : "未能取得修复方案，本次未执行修复。可重新获取方案。";
  }
  return { error: message, failureDiagnostics };
}
