import { isJsonObject } from "../shared/json";
import type { EventConfigValidationIssue, EventSourceConfig } from "./types";
import {
  eventConfigError as error,
  isNonEmptyString,
} from "./validation-utils";

const SAFE_ENTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateSequentialListSource(
  source: EventSourceConfig,
  issues: EventConfigValidationIssue[],
): void {
  if (source.kind !== "sequential-list") {
    return;
  }

  if (
    source["startPolicy"] !== undefined &&
    source["startPolicy"] !== "on-serve-start"
  ) {
    issues.push(
      error(
        `sources.${source.id}.startPolicy`,
        "startPolicy must be 'on-serve-start'",
      ),
    );
  }

  if (
    source["onItemFailure"] !== undefined &&
    source["onItemFailure"] !== "stop" &&
    source["onItemFailure"] !== "continue"
  ) {
    issues.push(
      error(
        `sources.${source.id}.onItemFailure`,
        "onItemFailure must be 'stop' or 'continue'",
      ),
    );
  }

  const entries = source["entries"];
  if (!Array.isArray(entries) || entries.length === 0) {
    issues.push(
      error(
        `sources.${source.id}.entries`,
        "sequential-list entries must be a non-empty array",
      ),
    );
    return;
  }

  const seenIds = new Set<string>();
  entries.forEach((entry, index) => {
    const basePath = `sources.${source.id}.entries[${String(index)}]`;
    if (!isJsonObject(entry)) {
      issues.push(error(basePath, "entry must be a JSON object"));
      return;
    }
    const id = entry["id"];
    if (!isNonEmptyString(id)) {
      issues.push(error(`${basePath}.id`, "entry id is required"));
    } else {
      if (!SAFE_ENTRY_ID_PATTERN.test(id)) {
        issues.push(
          error(
            `${basePath}.id`,
            "entry id must use letters, numbers, dot, underscore, or dash",
          ),
        );
      }
      if (seenIds.has(id)) {
        issues.push(
          error(`${basePath}.id`, `duplicate sequential-list entry id '${id}'`),
        );
      }
      seenIds.add(id);
    }

    if (!isNonEmptyString(entry["prompt"])) {
      issues.push(error(`${basePath}.prompt`, "entry prompt is required"));
    }

    if (
      entry["metadata"] !== undefined &&
      (!isJsonObject(entry["metadata"]) || Array.isArray(entry["metadata"]))
    ) {
      issues.push(
        error(`${basePath}.metadata`, "entry metadata must be a JSON object"),
      );
    }
  });
}
