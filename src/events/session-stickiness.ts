import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../shared/fs";
import { resolveRootDataDir } from "../workflow/paths";
import type { DivedraOptions } from "../lib";

export interface EventWorkflowSessionStickinessRecord {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}

interface EventWorkflowSessionStickinessKeyInput {
  readonly workflowId: string;
  readonly sourceId: string;
  readonly bindingId: string;
  readonly conversationId: string;
  readonly threadId?: string;
}

export function buildEventWorkflowSessionStickinessKey(
  input: EventWorkflowSessionStickinessKeyInput,
): string {
  return [
    input.workflowId,
    input.sourceId,
    input.bindingId,
    input.conversationId,
    input.threadId ?? "",
  ].join("\u0000");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  value: Readonly<Record<string, unknown>>,
  key: keyof EventWorkflowSessionStickinessRecord,
): string | null {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : null;
}

function readOptionalString(
  value: Readonly<Record<string, unknown>>,
  key: keyof EventWorkflowSessionStickinessRecord,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function parseEventWorkflowSessionStickinessRecord(
  value: unknown,
): EventWorkflowSessionStickinessRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const workflowId = readRequiredString(value, "workflowId");
  const workflowName = readRequiredString(value, "workflowName");
  const sourceId = readRequiredString(value, "sourceId");
  const bindingId = readRequiredString(value, "bindingId");
  const conversationId = readRequiredString(value, "conversationId");
  const sessionId = readRequiredString(value, "sessionId");
  const updatedAt = readRequiredString(value, "updatedAt");
  if (
    workflowId === null ||
    workflowName === null ||
    sourceId === null ||
    bindingId === null ||
    conversationId === null ||
    sessionId === null ||
    updatedAt === null
  ) {
    return null;
  }

  const threadId = readOptionalString(value, "threadId");
  return {
    workflowId,
    workflowName,
    sourceId,
    bindingId,
    conversationId,
    ...(threadId === undefined ? {} : { threadId }),
    sessionId,
    updatedAt,
  };
}

function stickinessRecordMatchesKey(
  record: EventWorkflowSessionStickinessRecord,
  input: EventWorkflowSessionStickinessKeyInput,
): boolean {
  if (
    record.workflowId !== input.workflowId ||
    record.sourceId !== input.sourceId ||
    record.bindingId !== input.bindingId ||
    record.conversationId !== input.conversationId
  ) {
    return false;
  }
  return (record.threadId ?? "") === (input.threadId ?? "");
}

function sessionStickinessDirectory(options: DivedraOptions = {}): string {
  return path.join(resolveRootDataDir(options), "events", "session-stickiness");
}

function sessionStickinessFilePath(
  key: string,
  options: DivedraOptions = {},
): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(sessionStickinessDirectory(options), `${digest}.json`);
}

function sessionStickinessTargetPath(
  input: EventWorkflowSessionStickinessKeyInput,
  options: DivedraOptions = {},
): string {
  return sessionStickinessFilePath(
    buildEventWorkflowSessionStickinessKey(input),
    options,
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export async function deleteEventWorkflowSessionStickiness(
  input: EventWorkflowSessionStickinessKeyInput,
  options: DivedraOptions = {},
): Promise<void> {
  await rm(sessionStickinessTargetPath(input, options), { force: true });
}

export async function loadEventWorkflowSessionStickiness(
  input: EventWorkflowSessionStickinessKeyInput,
  options: DivedraOptions = {},
): Promise<EventWorkflowSessionStickinessRecord | null> {
  const target = sessionStickinessTargetPath(input, options);
  try {
    const raw = await readFile(target, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      await deleteEventWorkflowSessionStickiness(input, options);
      return null;
    }
    const record = parseEventWorkflowSessionStickinessRecord(parsed);
    if (record === null || !stickinessRecordMatchesKey(record, input)) {
      await deleteEventWorkflowSessionStickiness(input, options);
      return null;
    }
    return record;
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveEventWorkflowSessionStickiness(
  record: EventWorkflowSessionStickinessRecord,
  options: DivedraOptions = {},
): Promise<void> {
  const key = buildEventWorkflowSessionStickinessKey({
    workflowId: record.workflowId,
    sourceId: record.sourceId,
    bindingId: record.bindingId,
    conversationId: record.conversationId,
    ...(record.threadId === undefined ? {} : { threadId: record.threadId }),
  });
  const target = sessionStickinessFilePath(key, options);
  await mkdir(path.dirname(target), { recursive: true });
  await atomicWriteJsonFile(target, record);
}
