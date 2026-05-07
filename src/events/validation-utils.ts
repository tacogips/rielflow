import type { EventConfigValidationIssue } from "./types";

const SAFE_ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

export function eventConfigError(
  path: string,
  message: string,
): EventConfigValidationIssue {
  return { severity: "error", path, message };
}

export function eventConfigWarning(
  path: string,
  message: string,
): EventConfigValidationIssue {
  return { severity: "warning", path, message };
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

export function validateEnvName(
  value: unknown,
  pathName: string,
  label: string,
  issues: EventConfigValidationIssue[],
): void {
  if (value === undefined) {
    return;
  }
  if (!isNonEmptyString(value) || !SAFE_ENV_NAME_PATTERN.test(value)) {
    issues.push(
      eventConfigError(pathName, `${label} must be an uppercase env name`),
    );
  }
}

export function validateSecretEnvName(
  value: unknown,
  pathName: string,
  issues: EventConfigValidationIssue[],
): void {
  validateEnvName(value, pathName, "secret env var name", issues);
}

export function validateSafeObjectPrefix(
  value: unknown,
  pathName: string,
  issues: EventConfigValidationIssue[],
): void {
  if (
    value !== undefined &&
    (!isNonEmptyString(value) || value.startsWith("/") || value.includes(".."))
  ) {
    issues.push(
      eventConfigError(
        pathName,
        "root prefix must be a safe object-key prefix",
      ),
    );
  }
}
