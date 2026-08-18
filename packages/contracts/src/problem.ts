import * as Schema from "effect/Schema";

export const ProblemCodes = {
  unauthorized: "unauthorized",
  forbidden: "forbidden",
  validation: "validation",
  invalid_cursor: "invalid_cursor",
  not_found: "not_found",
  method_not_allowed: "method_not_allowed",
  unsupported_media_type: "unsupported_media_type",
  payload_too_large: "payload_too_large",
  precondition_required: "precondition_required",
  precondition_failed: "precondition_failed",
  conflict: "conflict",
  share_expired: "share_expired",
  share_revoked: "share_revoked",
  recovery_window_ended: "recovery_window_ended",
  rate_limited: "rate_limited",
  protected_access_not_available: "protected_access_not_available",
  internal: "internal",
} as const;

export type ProblemCode = (typeof ProblemCodes)[keyof typeof ProblemCodes];

export const ProblemError = Schema.Struct({
  pointer: Schema.String,
  message: Schema.String,
});

export const ProblemDetails = Schema.Struct({
  type: Schema.String,
  title: Schema.String,
  status: Schema.Int,
  detail: Schema.optionalKey(Schema.String),
  code: Schema.String,
  requestId: Schema.String,
  errors: Schema.optionalKey(Schema.Array(ProblemError)),
});
export type ProblemDetails = typeof ProblemDetails.Type;

export const ProblemContentType = "application/problem+json";

export function problem(
  status: number,
  title: string,
  code: ProblemCode,
  requestId: string,
  detail?: string,
  errors?: ReadonlyArray<{ readonly pointer: string; readonly message: string }>,
): ProblemDetails {
  return {
    type: "about:blank",
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    code,
    requestId,
    ...(errors === undefined || errors.length === 0 ? {} : { errors }),
  };
}
