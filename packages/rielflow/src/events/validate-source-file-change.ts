import { isJsonObject } from "../shared/json";
import {
  FILE_CHANGE_STABILITY_WINDOW_ERROR_MESSAGE,
  isValidFileChangeStabilityWindowMs,
  validateFileChangeSuffixes,
} from "./file-change-constraints";
import {
  eventConfigError as error,
  isNonEmptyString,
} from "./validation-utils";
import type { EventConfigValidationIssue, EventSourceConfig } from "./types";

const FILE_CHANGE_TYPES = new Set(["create", "modify", "delete"]);

function addFileChangeSuffixIssues(
  source: EventSourceConfig,
  suffixes: unknown,
  issues: EventConfigValidationIssue[],
): void {
  const suffixIssues = validateFileChangeSuffixes(suffixes);
  for (const suffixIssue of suffixIssues) {
    const suffixPath =
      suffixIssue.index === undefined
        ? `sources.${source.id}.filters.suffixes`
        : `sources.${source.id}.filters.suffixes[${String(suffixIssue.index)}]`;
    issues.push(error(suffixPath, suffixIssue.message));
  }
}

export function validateFileChangeSource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (source.kind !== "file-change") {
    return;
  }
  if (!isNonEmptyString(source["directory"])) {
    issues.push(
      error(`sources.${source.id}.directory`, "directory is required"),
    );
  }
  const changeTypes = source["changeTypes"];
  if (!Array.isArray(changeTypes) || changeTypes.length === 0) {
    issues.push(
      error(
        `sources.${source.id}.changeTypes`,
        "changeTypes must be a non-empty array",
      ),
    );
  } else {
    const seen = new Set<string>();
    for (const [index, changeType] of changeTypes.entries()) {
      if (
        typeof changeType !== "string" ||
        !FILE_CHANGE_TYPES.has(changeType)
      ) {
        issues.push(
          error(
            `sources.${source.id}.changeTypes[${String(index)}]`,
            "change type must be create, modify, or delete",
          ),
        );
        continue;
      }
      if (seen.has(changeType)) {
        issues.push(
          error(
            `sources.${source.id}.changeTypes[${String(index)}]`,
            `duplicate change type '${changeType}'`,
          ),
        );
      }
      seen.add(changeType);
    }
  }
  if (
    source["recursive"] !== undefined &&
    typeof source["recursive"] !== "boolean"
  ) {
    issues.push(
      error(`sources.${source.id}.recursive`, "recursive must be a boolean"),
    );
  }
  const stabilityWindowMs = source["stabilityWindowMs"];
  if (
    stabilityWindowMs !== undefined &&
    !isValidFileChangeStabilityWindowMs(stabilityWindowMs)
  ) {
    issues.push(
      error(
        `sources.${source.id}.stabilityWindowMs`,
        FILE_CHANGE_STABILITY_WINDOW_ERROR_MESSAGE,
      ),
    );
  }
  const filters = source["filters"];
  if (filters === undefined) {
    return;
  }
  if (!isJsonObject(filters)) {
    issues.push(
      error(`sources.${source.id}.filters`, "filters must be an object"),
    );
    return;
  }
  const suffixes = filters["suffixes"];
  addFileChangeSuffixIssues(source, suffixes, issues);
}
