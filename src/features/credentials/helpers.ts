import type { z } from "zod";

import { asanaUserSchema } from "../../data/asana/schemas";
import type { AsanaClientResult } from "../../data/asana/types";

/**
 * Milliseconds in one second. Converts the `retryAfterMs` carried by
 * the `rate_limited` outcome into a whole-second display value, matching
 * the project-wide unit-convention documented in
 * `src/data/asana/client.ts` and `src/shared/states/RateLimitedState.tsx`.
 *
 * Exported so the peer `summariseWorkspaceListFailure` summariser in
 * `TokenEntry.tsx` can reuse the same constant instead of an inline
 * `1000` literal — the named constant is the project-wide convention
 * every other rate-limit formatter follows.
 */
export const MS_PER_SECOND = 1_000;

/**
 * Format a `rate_limited` outcome's `retryAfterMs` as the user-facing
 * "Retry after Ns" sentence the credential flow surfaces in both the
 * user-test summary (`summariseUserValidationResult`) and the
 * post-validation workspace-listing summary
 * (`summariseWorkspaceListFailure` in `TokenEntry.tsx`). Centralised
 * so the project-wide "Rate limited by Asana." copy and the
 * `Math.round(ms / MS_PER_SECOND)` unit conversion are owned by a
 * single source of truth — a future contributor who changes the
 * sentence structure (e.g. switches to "in Ns" or adds the seconds
 * floor) updates one helper rather than two call sites.
 */
export function formatRateLimitedMessage(retryAfterMs: number): string {
  return `Rate limited by Asana. Retry after ${Math.round(
    retryAfterMs / MS_PER_SECOND,
  )}s.`;
}

export type CredentialValidationOutcomeKind =
  | "valid"
  | "invalid_token"
  | "insufficient_permission"
  | "rate_limited"
  | "network_error"
  | "validation_error";

export interface CredentialValidationSummary {
  readonly kind: CredentialValidationOutcomeKind;
  readonly message: string;
}

type AsanaUserResult = AsanaClientResult<z.infer<typeof asanaUserSchema>>;

export function summariseUserValidationResult(
  result: AsanaUserResult,
): CredentialValidationSummary {
  switch (result.outcome) {
    case "ok":
      return {
        kind: "valid",
        message: `Token valid. Authenticated as ${result.data.name}.`,
      };
    case "auth_failure":
      return {
        kind: "invalid_token",
        message: "Invalid token. Asana rejected the credential.",
      };
    case "permission_failure":
      return {
        kind: "insufficient_permission",
        message:
          "Insufficient permission to access Asana. The token may lack the required scopes.",
      };
    case "rate_limited":
      return {
        kind: "rate_limited",
        message: formatRateLimitedMessage(result.retryAfterMs),
      };
    case "network_error":
      return {
        kind: "network_error",
        message: `Network error: ${result.message}`,
      };
    case "validation_error":
      return {
        kind: "validation_error",
        message:
          "Unexpected response from Asana. The API shape may have changed.",
      };
  }
}

export function maskedIdentifierFor(token: string): string {
  if (token.length === 0) {
    return "";
  }
  if (token.length <= 4) {
    return "••••";
  }
  return token.slice(-4);
}
