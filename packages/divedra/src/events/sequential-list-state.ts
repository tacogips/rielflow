import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { safeArtifactPathSegment } from "../shared/artifacts";
import { atomicWriteJsonFile } from "../shared/fs";
import { isJsonObject } from "../shared/json";
import type { SequentialListSourceConfig } from "./types";

export type SequentialListItemStatus =
  | "pending"
  | "dispatching"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface SequentialListItemState {
  readonly itemId: string;
  readonly index: number;
  readonly status: SequentialListItemStatus;
  readonly receiptIds: readonly string[];
  readonly workflowExecutionIds: readonly string[];
  readonly supervisedRunIds: readonly string[];
  readonly supervisorExecutionIds: readonly string[];
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly error?: string;
}

export interface SequentialListStateRecord {
  readonly sourceId: string;
  readonly configRevisionId: string;
  readonly runId: string;
  readonly currentIndex: number;
  readonly activeReceiptId?: string;
  readonly activeWorkflowExecutionId?: string;
  readonly activeSupervisedRunId?: string;
  readonly itemStatuses: readonly SequentialListItemState[];
  readonly lastError?: string;
  readonly updatedAt: string;
}

function hashJson(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .slice(0, 24);
}

export function buildSequentialListConfigRevisionId(
  source: SequentialListSourceConfig,
): string {
  return hashJson({
    entries: source.entries.map((entry) => ({
      id: entry.id,
      prompt: entry.prompt,
      metadata: entry.metadata ?? null,
    })),
    startPolicy: source.startPolicy ?? "on-serve-start",
    onItemFailure: source.onItemFailure ?? "stop",
  });
}

function buildInitialItemStates(
  source: SequentialListSourceConfig,
): readonly SequentialListItemState[] {
  return source.entries.map((entry, index) => ({
    itemId: entry.id,
    index,
    status: "pending",
    receiptIds: [],
    workflowExecutionIds: [],
    supervisedRunIds: [],
    supervisorExecutionIds: [],
  }));
}

export function buildInitialSequentialListState(input: {
  readonly source: SequentialListSourceConfig;
  readonly configRevisionId: string;
  readonly now: string;
}): SequentialListStateRecord {
  const runId = `${input.source.id}:${input.configRevisionId}`;
  return {
    sourceId: input.source.id,
    configRevisionId: input.configRevisionId,
    runId,
    currentIndex: 0,
    itemStatuses: buildInitialItemStates(input.source),
    updatedAt: input.now,
  };
}

function readStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asItemState(value: unknown): SequentialListItemState | undefined {
  if (
    !isJsonObject(value) ||
    typeof value["itemId"] !== "string" ||
    typeof value["index"] !== "number" ||
    !Number.isInteger(value["index"])
  ) {
    return undefined;
  }
  const status = value["status"];
  if (
    status !== "pending" &&
    status !== "dispatching" &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "cancelled" &&
    status !== "skipped"
  ) {
    return undefined;
  }
  return {
    itemId: value["itemId"],
    index: value["index"],
    status,
    receiptIds: readStringArray(value["receiptIds"]),
    workflowExecutionIds: readStringArray(value["workflowExecutionIds"]),
    supervisedRunIds: readStringArray(value["supervisedRunIds"]),
    supervisorExecutionIds: readStringArray(value["supervisorExecutionIds"]),
    ...(typeof value["startedAt"] === "string"
      ? { startedAt: value["startedAt"] }
      : {}),
    ...(typeof value["completedAt"] === "string"
      ? { completedAt: value["completedAt"] }
      : {}),
    ...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
  };
}

function asStateRecord(value: unknown): SequentialListStateRecord | undefined {
  if (
    !isJsonObject(value) ||
    typeof value["sourceId"] !== "string" ||
    typeof value["configRevisionId"] !== "string" ||
    typeof value["runId"] !== "string" ||
    typeof value["currentIndex"] !== "number" ||
    !Number.isInteger(value["currentIndex"]) ||
    !Array.isArray(value["itemStatuses"]) ||
    typeof value["updatedAt"] !== "string"
  ) {
    return undefined;
  }
  const itemStatuses = value["itemStatuses"]
    .map(asItemState)
    .filter((entry): entry is SequentialListItemState => entry !== undefined);
  return {
    sourceId: value["sourceId"],
    configRevisionId: value["configRevisionId"],
    runId: value["runId"],
    currentIndex: value["currentIndex"],
    ...(typeof value["activeReceiptId"] === "string"
      ? { activeReceiptId: value["activeReceiptId"] }
      : {}),
    ...(typeof value["activeWorkflowExecutionId"] === "string"
      ? { activeWorkflowExecutionId: value["activeWorkflowExecutionId"] }
      : {}),
    ...(typeof value["activeSupervisedRunId"] === "string"
      ? { activeSupervisedRunId: value["activeSupervisedRunId"] }
      : {}),
    itemStatuses,
    ...(typeof value["lastError"] === "string"
      ? { lastError: value["lastError"] }
      : {}),
    updatedAt: value["updatedAt"],
  };
}

export class SequentialListStateRepository {
  readonly #filePath: string;

  constructor(dataRoot: string, sourceId: string, configRevisionId: string) {
    this.#filePath = path.join(
      dataRoot,
      "events",
      "sequential-list",
      safeArtifactPathSegment(sourceId, "source"),
      `${safeArtifactPathSegment(configRevisionId, "revision")}.json`,
    );
  }

  get filePath(): string {
    return this.#filePath;
  }

  async load(): Promise<SequentialListStateRecord | null> {
    try {
      const content = await readFile(this.#filePath, "utf8");
      return asStateRecord(JSON.parse(content) as unknown) ?? null;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async save(record: SequentialListStateRecord): Promise<void> {
    await atomicWriteJsonFile(this.#filePath, record);
  }
}

export function updateSequentialListItemState(
  state: SequentialListStateRecord,
  index: number,
  update: Partial<SequentialListItemState>,
): SequentialListStateRecord {
  const current = state.itemStatuses[index];
  if (current === undefined) {
    throw new Error(`sequential-list item index ${String(index)} is missing`);
  }
  const itemStatuses = state.itemStatuses.map((entry) =>
    entry.index === index ? { ...entry, ...update } : entry,
  );
  return {
    ...state,
    itemStatuses,
    updatedAt: new Date().toISOString(),
  };
}
