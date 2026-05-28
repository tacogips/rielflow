import type { UserActionNodeConfig, ValidationIssue } from "../types";
import { normalizeOptionalBooleanField } from "./output-contracts-and-callees";
import type { UnknownRecord } from "./validation-types-and-runtime-options";
import { isRecord, makeIssue } from "./validation-types-and-runtime-options";

export function normalizeUserActionNodeConfig(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): UserActionNodeConfig | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(makeIssue("error", path, "must be an object"));
    return undefined;
  }

  const allowedKeys = new Set([
    "messageToolIds",
    "notificationToolIds",
    "replyPolicy",
    "allowStructuredReply",
    "allowFreeTextReply",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      issues.push(
        makeIssue(
          "error",
          `${path}.${key}`,
          "uses an unsupported userAction field",
        ),
      );
    }
  }

  const messageToolIds = normalizeNamedStringArrayField(
    value,
    "messageToolIds",
    path,
    issues,
  );
  const notificationToolIds = normalizeOptionalNamedStringArrayField(
    value,
    "notificationToolIds",
    path,
    issues,
  );

  if (messageToolIds !== null && messageToolIds.length === 0) {
    issues.push(
      makeIssue(
        "error",
        `${path}.messageToolIds`,
        "must contain at least one tool id",
      ),
    );
  }

  const replyPolicyRaw = value["replyPolicy"];
  let replyPolicy: UserActionNodeConfig["replyPolicy"];
  if (replyPolicyRaw !== undefined) {
    if (replyPolicyRaw === "first-valid-reply-wins") {
      replyPolicy = replyPolicyRaw;
    } else {
      issues.push(
        makeIssue(
          "error",
          `${path}.replyPolicy`,
          "must be 'first-valid-reply-wins' when provided",
        ),
      );
    }
  }

  const allowStructuredReply = normalizeOptionalBooleanField(
    value,
    "allowStructuredReply",
    path,
    issues,
  );
  const allowFreeTextReply = normalizeOptionalBooleanField(
    value,
    "allowFreeTextReply",
    path,
    issues,
  );

  if (messageToolIds === null) {
    return undefined;
  }

  return {
    messageToolIds,
    ...(notificationToolIds === undefined ? {} : { notificationToolIds }),
    ...(replyPolicy === undefined ? {} : { replyPolicy }),
    ...(allowStructuredReply === undefined ? {} : { allowStructuredReply }),
    ...(allowFreeTextReply === undefined ? {} : { allowFreeTextReply }),
  };
}

export function normalizeNamedStringArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | null {
  const value = record[key];
  if (!Array.isArray(value)) {
    issues.push(makeIssue("error", `${path}.${key}`, "must be an array"));
    return null;
  }
  const normalized = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (normalized.length !== value.length) {
    issues.push(
      makeIssue(
        "error",
        `${path}.${key}`,
        "must contain only non-empty strings",
      ),
    );
  }
  return normalized;
}

export function normalizeOptionalNamedStringArrayField(
  record: UnknownRecord,
  key: string,
  path: string,
  issues: ValidationIssue[],
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  const normalized = normalizeNamedStringArrayField(record, key, path, issues);
  return normalized === null ? undefined : normalized;
}
