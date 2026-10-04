/**
 * Raised when volume planning is gated because the previous volume is not finished.
 *
 * This is a planning-only gate. It stops the next volume's outline from being generated on top of
 * an unfinished volume; it never rolls back or rewrites already written prose. Callers should
 * surface the message as an actionable explanation (what is unfinished, and the two ways forward)
 * rather than as an internal failure.
 */
export class VolumeGenerationGateError extends Error {
  readonly kind = "volume_gate_blocked";

  constructor(message: string) {
    super(message);
    this.name = "VolumeGenerationGateError";
  }
}

export function isVolumeGenerationGateError(error: unknown): error is VolumeGenerationGateError {
  return error instanceof VolumeGenerationGateError;
}
