import { isJsonObject } from "../shared/json";
import {
  eventConfigError as error,
  isNonEmptyString,
} from "./validation-utils";
import type { EventConfigValidationIssue, EventSourceConfig } from "./types";

const FILE_CHANGE_TYPES = new Set(["create", "modify", "delete"]);

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
    (typeof stabilityWindowMs !== "number" ||
      !Number.isInteger(stabilityWindowMs) ||
      stabilityWindowMs < 0)
  ) {
    issues.push(
      error(
        `sources.${source.id}.stabilityWindowMs`,
        "stabilityWindowMs must be a non-negative integer",
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
  if (
    suffixes !== undefined &&
    (!Array.isArray(suffixes) ||
      suffixes.length === 0 ||
      !suffixes.every((entry) => typeof entry === "string" && entry.length > 0))
  ) {
    issues.push(
      error(
        `sources.${source.id}.filters.suffixes`,
        "suffixes must be a non-empty string array when set",
      ),
    );
  }
}
