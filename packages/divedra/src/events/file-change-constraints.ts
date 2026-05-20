export const FILE_CHANGE_DEFAULT_STABILITY_WINDOW_MS = 200;
export const FILE_CHANGE_MAX_STABILITY_WINDOW_MS = 60_000;

export const FILE_CHANGE_STABILITY_WINDOW_ERROR_MESSAGE = `stabilityWindowMs must be an integer between 0 and ${String(FILE_CHANGE_MAX_STABILITY_WINDOW_MS)}`;

export interface FileChangeSuffixValidationIssue {
  readonly index?: number;
  readonly message: string;
}

const FILE_CHANGE_SUFFIX_SEPARATOR_PATTERN = /[/\\]/u;

export function isValidFileChangeStabilityWindowMs(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= FILE_CHANGE_MAX_STABILITY_WINDOW_MS
  );
}

export function resolveFileChangeStabilityWindowMs(
  value: number | undefined,
): number {
  const stabilityWindowMs = value ?? FILE_CHANGE_DEFAULT_STABILITY_WINDOW_MS;
  if (!isValidFileChangeStabilityWindowMs(stabilityWindowMs)) {
    throw new Error(
      `file-change ${FILE_CHANGE_STABILITY_WINDOW_ERROR_MESSAGE}`,
    );
  }
  return stabilityWindowMs;
}

export function formatFileChangeSuffixValidationIssues(
  issues: readonly FileChangeSuffixValidationIssue[],
): string {
  return issues
    .map((issue) =>
      issue.index === undefined
        ? issue.message
        : `${String(issue.index)}: ${issue.message}`,
    )
    .join("; ");
}

export function validateFileChangeSuffixes(
  suffixes: unknown,
): readonly FileChangeSuffixValidationIssue[] {
  if (suffixes === undefined) {
    return [];
  }
  if (!Array.isArray(suffixes) || suffixes.length === 0) {
    return [{ message: "suffixes must be a non-empty string array when set" }];
  }

  const issues: FileChangeSuffixValidationIssue[] = [];
  const seen = new Set<string>();
  for (const [index, suffix] of suffixes.entries()) {
    if (typeof suffix !== "string" || suffix.length === 0) {
      issues.push({ index, message: "suffix must be a non-empty string" });
      continue;
    }
    if (FILE_CHANGE_SUFFIX_SEPARATOR_PATTERN.test(suffix)) {
      issues.push({
        index,
        message: "suffix must not contain path separators",
      });
      continue;
    }
    if (seen.has(suffix)) {
      issues.push({ index, message: `duplicate suffix '${suffix}'` });
      continue;
    }
    seen.add(suffix);
  }
  return issues;
}

export function resolveFileChangeSuffixes(
  suffixes: unknown,
): readonly string[] | undefined {
  const issues = validateFileChangeSuffixes(suffixes);
  if (issues.length > 0) {
    throw new Error(
      `file-change filters.suffixes invalid: ${formatFileChangeSuffixValidationIssues(issues)}`,
    );
  }
  return suffixes as readonly string[] | undefined;
}
