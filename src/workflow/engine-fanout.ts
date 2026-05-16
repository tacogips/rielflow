/**
 * Fanout runtime helpers extracted from engine.ts.
 *
 * This module contains pure and near-pure utilities for bounded fanout
 * execution: JSON Pointer resolution, concurrency/budget accounting,
 * runtime-variable builders, workspace preparation, the bounded branch
 * scheduler, and join output persistence.  Orchestration functions that
 * require broad engine internals remain in engine.ts and import from here.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { atomicWriteTextFile as writeRawTextFile } from "../shared/fs";
import { err, ok, type Result } from "./result";
import type {
  FanoutBranchRecord,
  FanoutGroupRunRecord,
  OutputRef,
  WorkflowSessionState,
} from "./session";
import type {
  WorkflowFanoutFailurePolicy,
  WorkflowFanoutResultOrder,
  WorkflowJson,
  WorkflowStepFanout,
} from "./types";
import { resolveWorkflowExecutionWorkingDirectory } from "./working-directory";

// ---------------------------------------------------------------------------
// Step budget
// ---------------------------------------------------------------------------

/**
 * Mutable shared step budget passed into cross-workflow fanout branch child
 * runs so that high-concurrency fanout cannot multiply the configured
 * `maxSteps` cap.
 */
export interface FanoutStepBudget {
  remaining: number;
}

// ---------------------------------------------------------------------------
// JSON Pointer helpers
// ---------------------------------------------------------------------------

function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

export function readJsonPointer(
  root: unknown,
  pointer: string,
): Result<unknown, string> {
  if (pointer === "") {
    return ok(root);
  }
  if (!pointer.startsWith("/")) {
    return err(`JSON Pointer '${pointer}' must be empty or start with '/'`);
  }
  let current: unknown = root;
  for (const rawSegment of pointer.slice(1).split("/")) {
    const segment = decodeJsonPointerSegment(rawSegment);
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return err(
          `JSON Pointer '${pointer}' array index '${segment}' is missing`,
        );
      }
      current = current[index];
      continue;
    }
    if (typeof current !== "object" || current === null) {
      return err(
        `JSON Pointer '${pointer}' cannot descend through a non-object value`,
      );
    }
    const record = current as Readonly<Record<string, unknown>>;
    if (!(segment in record)) {
      return err(`JSON Pointer '${pointer}' property '${segment}' is missing`);
    }
    current = record[segment];
  }
  return ok(current);
}

// ---------------------------------------------------------------------------
// Item resolution
// ---------------------------------------------------------------------------

export function resolveFanoutItems(input: {
  readonly fanout: WorkflowStepFanout;
  readonly outputPayload: Readonly<Record<string, unknown>>;
}): Result<readonly unknown[], string> {
  const selected = readJsonPointer(input.outputPayload, input.fanout.itemsFrom);
  if (!selected.ok) {
    return err(selected.error);
  }
  if (!Array.isArray(selected.value)) {
    return err(
      `fanout.itemsFrom '${input.fanout.itemsFrom}' must resolve to an array`,
    );
  }
  return ok(selected.value);
}

// ---------------------------------------------------------------------------
// Concurrency / budget helpers
// ---------------------------------------------------------------------------

export function resolveFanoutConcurrency(input: {
  readonly workflow: WorkflowJson;
  readonly fanout: WorkflowStepFanout;
  readonly budget?: number;
}): number {
  const authored =
    input.fanout.concurrency ?? input.workflow.defaults.fanoutConcurrency ?? 20;
  return Math.max(1, Math.min(authored, input.budget ?? authored));
}

export function resolveChildFanoutConcurrencyBudget(input: {
  readonly parentBudget: number | undefined;
  readonly parentConcurrency: number;
}): number {
  const budget = input.parentBudget ?? input.parentConcurrency;
  return Math.max(1, Math.floor(budget / Math.max(input.parentConcurrency, 1)));
}

export function buildFanoutStepBudget(input: {
  readonly options: { readonly maxSteps?: number };
  readonly parentNodeExecutionCounter: number;
}): FanoutStepBudget | undefined {
  if (input.options.maxSteps === undefined) {
    return undefined;
  }
  return {
    remaining: Math.max(
      input.options.maxSteps - input.parentNodeExecutionCounter,
      0,
    ),
  };
}

export function claimFanoutStepBudget(
  budget: FanoutStepBudget | undefined,
): boolean {
  if (budget === undefined) {
    return true;
  }
  if (budget.remaining <= 0) {
    return false;
  }
  budget.remaining -= 1;
  return true;
}

// ---------------------------------------------------------------------------
// Runtime-variable builders
// ---------------------------------------------------------------------------

export function buildFanoutRuntimeVariables(input: {
  readonly baseRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly fanout: WorkflowStepFanout;
  readonly branchIndex: number;
  readonly item: unknown;
}): Readonly<Record<string, unknown>> {
  return {
    ...input.baseRuntimeVariables,
    ...(input.fanout.itemVariable === undefined
      ? {}
      : { [input.fanout.itemVariable]: input.item }),
    fanout: {
      groupId: input.fanout.groupId,
      branchIndex: input.branchIndex,
      item: input.item,
    },
  };
}

export function buildFanoutJoinRuntimeVariables(input: {
  readonly baseRuntimeVariables: Readonly<Record<string, unknown>>;
  readonly aggregate: Readonly<Record<string, unknown>>;
}): Readonly<Record<string, unknown>> {
  return {
    ...input.baseRuntimeVariables,
    fanoutJoin: input.aggregate,
  };
}

// ---------------------------------------------------------------------------
// Workspace helpers
// ---------------------------------------------------------------------------

export function buildFanoutWorkspaceRoot(input: {
  readonly sessionId: string;
  readonly fanoutGroupRunId: string;
  readonly branchIndex: number;
}): string {
  return path.join(
    os.tmpdir(),
    "divedra-fanout-workspaces",
    input.sessionId,
    input.fanoutGroupRunId,
    `branch-${input.branchIndex}`,
  );
}

export function shouldCopyFanoutWorkspacePath(sourcePath: string): boolean {
  const parts = path.resolve(sourcePath).split(path.sep);
  return !parts.some(
    (part) =>
      part === ".git" ||
      part === ".divedra" ||
      part === "node_modules" ||
      part === "dist",
  );
}

/** Minimal options subset consumed by workspace preparation. */
interface FanoutWorkspaceInputOptions {
  readonly cwd?: string;
  readonly workflowWorkingDirectory?: string;
}

export async function prepareFanoutBranchWorkspace(input: {
  readonly fanout: WorkflowStepFanout;
  readonly options: FanoutWorkspaceInputOptions;
  readonly sessionId: string;
  readonly fanoutGroupRunId: string;
  readonly branchIndex: number;
}): Promise<Result<string | undefined, string>> {
  if (input.fanout.writeOwnership?.mode !== "isolated-workspace") {
    return ok(undefined);
  }

  let sourceWorkingDirectory: string;
  try {
    sourceWorkingDirectory = resolveWorkflowExecutionWorkingDirectory({
      ...(input.options.cwd === undefined ? {} : { cwd: input.options.cwd }),
      ...(input.options.workflowWorkingDirectory === undefined
        ? {}
        : { workflowWorkingDirectory: input.options.workflowWorkingDirectory }),
    });
  } catch (error: unknown) {
    return err(
      error instanceof Error
        ? error.message
        : "workingDirectory must be a non-empty path when provided",
    );
  }

  const workspaceRoot = buildFanoutWorkspaceRoot({
    sessionId: input.sessionId,
    fanoutGroupRunId: input.fanoutGroupRunId,
    branchIndex: input.branchIndex,
  });
  try {
    await rm(workspaceRoot, { recursive: true, force: true });
    await mkdir(path.dirname(workspaceRoot), { recursive: true });
    await cp(sourceWorkingDirectory, workspaceRoot, {
      recursive: true,
      errorOnExist: false,
      filter: shouldCopyFanoutWorkspacePath,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    return err(`failed to create isolated fanout workspace: ${message}`);
  }
  return ok(workspaceRoot);
}

// ---------------------------------------------------------------------------
// Retry workspace linkage
// ---------------------------------------------------------------------------

/**
 * Looks through prior fanout group run records to find the workspace root used
 * by an earlier attempt for the same group ID and branch index.  Returns the
 * most-recent prior workspace root, or `undefined` when no prior attempt had
 * an isolated workspace for this branch.
 *
 * Used to populate `FanoutBranchRecord.supersededWorkspaceRoot` when a retry
 * of a fanout-producing step creates a new group that repeats an earlier
 * branch index.
 */
export function findPriorBranchWorkspaceRoot(input: {
  readonly priorGroups: readonly import("./session").FanoutGroupRunRecord[];
  readonly groupId: string;
  readonly branchIndex: number;
}): string | undefined {
  // Iterate in reverse so the most recent prior attempt wins when multiple
  // prior groups share the same groupId.
  for (let i = input.priorGroups.length - 1; i >= 0; i--) {
    const group = input.priorGroups[i];
    if (group === undefined || group.groupId !== input.groupId) {
      continue;
    }
    const branch = group.branches.find(
      (b) => b.branchIndex === input.branchIndex,
    );
    if (branch?.workspaceRoot !== undefined) {
      return branch.workspaceRoot;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Bounded branch scheduler
// ---------------------------------------------------------------------------

export async function runBoundedFanoutBranches<T>(
  items: readonly unknown[],
  concurrency: number,
  runBranch: (branchIndex: number, item: unknown) => Promise<T>,
): Promise<readonly T[]> {
  const results = new Array<T>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const branchIndex = nextIndex;
      nextIndex += 1;
      if (branchIndex >= items.length) {
        return;
      }
      results[branchIndex] = await runBranch(branchIndex, items[branchIndex]);
    }
  }
  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await worker();
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// ID builders
// ---------------------------------------------------------------------------

export function buildFanoutGroupRunId(input: {
  readonly groupId: string;
  readonly sourceNodeExecId: string;
}): string {
  return `fanout-${input.groupId}-${input.sourceNodeExecId}`;
}

export interface BuildFanoutGroupRunRecordInput {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly sourceNodeExecId: string;
  readonly transitionLabel?: string;
  readonly targetStepId: string;
  readonly targetWorkflowId?: string;
  readonly joinStepId: string;
  readonly concurrency: number;
  readonly failurePolicy: WorkflowFanoutFailurePolicy;
  readonly resultOrder: WorkflowFanoutResultOrder;
  readonly branches: readonly FanoutBranchRecord[];
}

export function buildFanoutGroupRunRecord(
  input: BuildFanoutGroupRunRecordInput,
): FanoutGroupRunRecord {
  return {
    fanoutGroupRunId: input.fanoutGroupRunId,
    groupId: input.groupId,
    sourceStepId: input.sourceStepId,
    sourceNodeExecId: input.sourceNodeExecId,
    ...(input.transitionLabel === undefined
      ? {}
      : { transitionLabel: input.transitionLabel }),
    targetStepId: input.targetStepId,
    ...(input.targetWorkflowId === undefined
      ? {}
      : { targetWorkflowId: input.targetWorkflowId }),
    joinStepId: input.joinStepId,
    concurrency: input.concurrency,
    failurePolicy: input.failurePolicy,
    resultOrder: input.resultOrder,
    branches: input.branches,
  };
}

function formatFanoutBranchMessages(
  branches: readonly FanoutBranchRecord[],
): string {
  return branches
    .map(
      (branch) =>
        `branch ${branch.branchIndex}: ${branch.error ?? branch.status}`,
    )
    .join("; ");
}

export type FanoutJoinAggregate = Readonly<Record<string, unknown>> & {
  readonly fanoutGroupRunId: string;
  readonly groupId: string;
  readonly sourceStepId: string;
  readonly resultOrder: WorkflowFanoutResultOrder;
  readonly results: readonly {
    readonly branchIndex: number;
    readonly item: unknown;
    readonly status: FanoutBranchRecord["status"];
    readonly outputRef?: OutputRef;
    readonly workspaceRoot?: string;
  }[];
};

export function buildFanoutJoinAggregate(input: {
  readonly group: FanoutGroupRunRecord;
}): FanoutJoinAggregate {
  return {
    fanoutGroupRunId: input.group.fanoutGroupRunId,
    groupId: input.group.groupId,
    sourceStepId: input.group.sourceStepId,
    resultOrder: input.group.resultOrder,
    results: input.group.branches.map((branch) => ({
      branchIndex: branch.branchIndex,
      item: branch.item,
      status: branch.status,
      ...(branch.outputRef === undefined
        ? {}
        : { outputRef: branch.outputRef }),
      ...(branch.workspaceRoot === undefined
        ? {}
        : { workspaceRoot: branch.workspaceRoot }),
    })),
  };
}

export type FanoutBranchResultReduction =
  | {
      readonly outcome: "paused";
      readonly group: FanoutGroupRunRecord;
      readonly fanoutGroups: readonly FanoutGroupRunRecord[];
      readonly session: WorkflowSessionState;
      readonly pausedMessage: string;
    }
  | {
      readonly outcome: "failed";
      readonly group: FanoutGroupRunRecord;
      readonly fanoutGroups: readonly FanoutGroupRunRecord[];
      readonly session: WorkflowSessionState;
      readonly failureMessage: string;
    }
  | {
      readonly outcome: "succeeded";
      readonly group: FanoutGroupRunRecord;
      readonly fanoutGroups: readonly FanoutGroupRunRecord[];
      readonly session: WorkflowSessionState;
      readonly aggregate: FanoutJoinAggregate;
    };

export function reduceFanoutBranchResults(input: {
  readonly group: FanoutGroupRunRecord;
  readonly priorFanoutGroups: readonly FanoutGroupRunRecord[];
  readonly workingSession: WorkflowSessionState;
}): FanoutBranchResultReduction {
  const fanoutGroups = [...input.priorFanoutGroups, input.group];
  const failedBranches = input.group.branches.filter(
    (branch) => branch.status === "failed" || branch.status === "cancelled",
  );
  const pausedBranches = input.group.branches.filter(
    (branch) => branch.status === "paused",
  );

  if (pausedBranches.length > 0) {
    const lastError = formatFanoutBranchMessages(pausedBranches);
    const session: WorkflowSessionState = {
      ...input.workingSession,
      status: "paused",
      fanoutGroups,
      lastError,
    };
    return {
      outcome: "paused",
      group: input.group,
      fanoutGroups,
      session,
      pausedMessage: `fanout group '${input.group.fanoutGroupRunId}' paused: ${lastError}`,
    };
  }

  if (failedBranches.length > 0) {
    return {
      outcome: "failed",
      group: input.group,
      fanoutGroups,
      session: input.workingSession,
      failureMessage: `fanout group '${input.group.fanoutGroupRunId}' failed: ${formatFanoutBranchMessages(
        failedBranches,
      )}`,
    };
  }

  return {
    outcome: "succeeded",
    group: input.group,
    fanoutGroups,
    session: input.workingSession,
    aggregate: buildFanoutJoinAggregate({ group: input.group }),
  };
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

export function itemAsWorkflowCallPayload(
  item: unknown,
): Readonly<Record<string, unknown>> {
  if (typeof item === "object" && item !== null && !Array.isArray(item)) {
    return item as Readonly<Record<string, unknown>>;
  }
  return { item };
}

// ---------------------------------------------------------------------------
// Join output persistence
// ---------------------------------------------------------------------------

export async function persistFanoutJoinOutputRef(input: {
  readonly artifactDir: string;
  readonly workflow: WorkflowJson;
  readonly session: WorkflowSessionState;
  readonly sourceStepId: string;
  readonly sourceNodeExecId: string;
  readonly fanoutGroupRunId: string;
  readonly aggregate: Readonly<Record<string, unknown>>;
}): Promise<{ readonly outputRef: OutputRef; readonly outputRaw: string }> {
  const outputDir = path.join(
    input.artifactDir,
    "fanout-groups",
    input.fanoutGroupRunId,
    "join-output",
  );
  await mkdir(outputDir, { recursive: true });
  const outputRaw = `${JSON.stringify(input.aggregate, null, 2)}\n`;
  await writeRawTextFile(path.join(outputDir, "output.json"), outputRaw);
  return {
    outputRef: {
      kind: "node-output",
      workflowExecutionId: input.session.sessionId,
      workflowId: input.workflow.workflowId,
      outputNodeId: input.sourceStepId,
      outputStepId: input.sourceStepId,
      nodeExecId: input.sourceNodeExecId,
      artifactDir: outputDir,
    },
    outputRaw,
  };
}
