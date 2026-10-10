export type EngineErrorCode =
  | "CONFIG_INVALID"
  | "INVALID_TRANSITION"
  | "NOT_FOUND"
  | "UNSAFE_PATH"
  | "OVERWRITE_REFUSED"
  | "VALIDATION_FAILED"
  | "PROVIDER_ERROR"
  | "PROVIDER_REFUSED"
  | "PROVIDER_NOT_CONFIGURED"
  | "DUPLICATE"
  | "LIMIT_EXCEEDED"
  | "UNAUTHORIZED"
  | "BAD_INPUT"
  | "HOST_ERROR";

/** Errors the engine raises on purpose. `code` is stable and safe to show in the admin UI. */
export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "EngineError";
  }
}

export const isEngineError = (e: unknown): e is EngineError => e instanceof EngineError;
