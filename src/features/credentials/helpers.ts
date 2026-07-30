import type { z } from "zod";

import { asanaUserSchema } from "../../data/asana/schemas";
import type { AsanaClientResult } from "../../data/asana/types";

/**
 * Milliseconds in one second. Converts the `retryAfterMs` carried by
 * the `rate_limited` outcome into a whole-second display value, matching
 * the project-wide unit-convention documented in
 * `src/data/asana/client.ts` and `src/shared/states/RateLimitedState.tsx`.
 */
const MS_PER_SECOND = 1_000;

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
        message: `Rate limited by Asana. Retry after ${Math.round(
          result.retryAfterMs / MS_PER_SECOND,
        )}s.`,
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
