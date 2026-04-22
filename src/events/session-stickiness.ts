import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWriteJsonFile } from "../shared/fs";
import { resolveRootDataDir } from "../workflow/paths";
import type { DivedraOptions } from "../lib";

export interface EventWorkflowSessionStickinessRecord {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly sourceId: string;
  readonly conversationId: string;
  readonly threadId?: string;
  readonly sessionId: string;
  readonly updatedAt: string;
}

interface EventWorkflowSessionStickinessKeyInput {
  readonly workflowId: string;
  readonly sourceId: string;
  readonly conversationId: string;
  readonly threadId?: string;
}

export function buildEventWorkflowSessionStickinessKey(
  input: EventWorkflowSessionStickinessKeyInput,
): string {
  return [
    input.workflowId,
    input.sourceId,
    input.conversationId,
    input.threadId ?? "",
  ].join("\u0000");
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

export async function loadEventWorkflowSessionStickiness(
  input: EventWorkflowSessionStickinessKeyInput,
  options: DivedraOptions = {},
): Promise<EventWorkflowSessionStickinessRecord | null> {
  const target = sessionStickinessFilePath(
    buildEventWorkflowSessionStickinessKey(input),
    options,
  );
  try {
    const raw = await readFile(target, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { sessionId?: unknown }).sessionId !== "string"
    ) {
      return null;
    }
    return parsed as EventWorkflowSessionStickinessRecord;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    if (message.includes("ENOENT")) {
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
    conversationId: record.conversationId,
    ...(record.threadId === undefined ? {} : { threadId: record.threadId }),
  });
  const target = sessionStickinessFilePath(key, options);
  await mkdir(path.dirname(target), { recursive: true });
  await atomicWriteJsonFile(target, record);
}
