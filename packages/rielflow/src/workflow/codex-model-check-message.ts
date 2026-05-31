import { compactAgentCliMessage } from "./agent-cli-parse-utils";
import type { CodexBackendModelAvailability } from "./adapters/readiness";

function hasCodexAccountFailure(value: string): boolean {
  return /subscription|not enabled|quota|billing|plan|expired|usage limit/i.test(
    value,
  );
}

function codexAvailabilityDetail(
  availability: CodexBackendModelAvailability,
): string {
  return compactAgentCliMessage(
    availability.probe.error ??
      availability.auth.error ??
      availability.probe.output ??
      availability.auth.status ??
      undefined,
    "model check failed",
  );
}

function codexAvailabilitySearchText(
  availability: CodexBackendModelAvailability,
  detail: string,
): string {
  return [
    availability.probe.error,
    availability.auth.error,
    availability.probe.output,
    availability.auth.status,
    detail,
  ]
    .filter((value): value is string => value !== null && value !== undefined)
    .join("\n");
}

export function buildCodexModelAvailabilityFailureMessage(input: {
  readonly model: string;
  readonly availability: CodexBackendModelAvailability;
  readonly accountReadiness: boolean;
}): string {
  const detail = codexAvailabilityDetail(input.availability);
  const combined = codexAvailabilitySearchText(input.availability, detail);
  if (hasCodexAccountFailure(combined)) {
    return input.accountReadiness
      ? `codex-agent account is not usable: ${detail}`
      : `codex-agent model '${input.model}' account is not usable: ${detail}`;
  }
  return input.accountReadiness
    ? `codex-agent account readiness check failed for model '${input.model}': ${detail}`
    : `codex-agent model '${input.model}' is not reachable: ${detail}`;
}
